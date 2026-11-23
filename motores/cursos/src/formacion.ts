// Formación oficial relacionada con la ocupación de la persona: especialidades formativas (SEPE) y cursos abiertos
// (SOC). Cadena de datos oficiales, sin IA: ocupación ESCO → códigos de la CNO-11 (tabla EURES) → especialidades del
// SEPE con esas ocupaciones relacionadas (la misma ocupación o su grupo de 4 cifras) → cursos abiertos del SOC de esas
// especialidades.
// Si un curso está abierto lo deciden sus fechas y la fecha de la consulta (vigencia-cursos.ts), no la etiqueta de
// estado del SOC, que marca «en període d'inscripció» cursos que ya han empezado. Un curso terminado no se ofrece.
// Reglas fijas y visibles, por este orden: su misma ocupación; una ocupación oficial más general que incluye la suya;
// su grupo de 4 cifras; una variante más específica. Nunca «te falta».
// No se amplía al grupo desde una variante más específica (correspondencia «estrecha»): puede estar en otro grupo
// (en EURES, «bombero» incluye «bombero de buque», del grupo de marineros de cubierta, y saldrían cursos de cruceros).
// Con vectores de significado, dentro de cada nivel se ordena por parecido con la ocupación, y si el SEPE relaciona
// menos de MIN_OFICIALES especialidades, se añaden como mucho MAX_SUGERENCIAS parecidas, marcadas como sugerencia de
// Faro.
// Sin ocupación ESCO, la formación se busca a nivel de grupo: grupo ISCO-08 → códigos CNO-11 de la
// correspondencia oficial del INE → especialidades del SEPE de esos grupos, ordenadas por parecido con las tareas
// oficiales del grupo (sin el vector del nombre ni los enlaces EURES, que son de cada ocupación ESCO).
// Si se piden, las ediciones del Consorci (cursos gratuitos para personas que trabajan) acompañan a los cursos del SOC,
// de las mismas especialidades elegidas (formacion-consorci.ts). Se devuelven todos los cursos que no han terminado, en
// el orden de las convocatorias (vigencia-cursos.ts): el informe y el plan deciden cuántos se ven.
// El bloque de formación digital transversal, igual para todas las ocupaciones, está en formacion-transversal.ts; el
// vector de consulta con que se mide el parecido, en consulta-de-vectores.ts; los nombres legibles, en
// nombres-legibles.ts.

import type {
  Correspondencia,
  CursoRelacionado,
  DatosConsorci,
  DatosFormacion,
  EspecialidadRelacionada,
  EspecialidadTransversal,
  FormacionRelacionada,
  MomentoCurso,
  ProgramasSepe,
} from '../../../compartido/contratos/tipos-formacion.ts';
import {
  cargarIndice,
  type IndiceVectores,
  similitudCon,
  type VectoresGuardados,
} from '../../../src/comun/vectores.ts';
import { InvarianteRoto } from '../../../src/dominio/errores.ts';
import { nombreLegible } from '../../../src/dominio/nombres-legibles.ts';
import { programaOficial } from './enlaces-comprobados.ts';
import { edicionesDelConsorci, porPrimerCodigo } from './formacion-consorci.ts';
import { ordenDeEnlaces, ordenEspecialidades } from './orden-formacion.ts';
import { esADistancia, esCopiaAntigua, momentoDelCurso, ordenDeConvocatorias } from './vigencia-cursos.ts';

/** Con menos especialidades relacionadas por el SEPE que estas, Faro sugiere otras parecidas. */
const MIN_OFICIALES = 3;
/** Sugerencias de Faro que se añaden como mucho. */
const MAX_SUGERENCIAS = 4;
/** Parecido mínimo (similitud del coseno) para que una especialidad se sugiera. */
const UMBRAL_SUGERENCIA = 0.55;
/** Cifras del grupo primario de la CNO-11: las 4 primeras de un código de ocupación del SEPE (8 cifras). */
const CIFRAS_DEL_GRUPO = 4;
/** Especialidades que se muestran si quien llama no dice cuántas. */
const MAX_ESPECIALIDADES_POR_DEFECTO = 8;
/** El parecido de una sugerencia se da con 3 decimales. */
const PRECISION_PARECIDO = 1000;
/**
 * Cómo se lee cada tipo de la correspondencia del INE (CIUO-08 → CNO-11) con los niveles de EURES, solo para ordenar:
 * 1:1, la misma; n:1, el código español agrupa varios y es más amplio; 1:n, es más específico; n:m, cercano.
 */
const CORRESPONDENCIA_INE: Readonly<Record<string, Correspondencia>> = {
  '1:1': 'exacta',
  'n:1': 'amplia',
  '1:n': 'estrecha',
  'n:m': 'cercana',
};
/** Un código CNO-11 de 4 cifras de la correspondencia oficial del INE, con su tipo (1:1, n:1, 1:n o n:m). */
interface CorrespondenciaIne {
  cno11: string;
  tipo: string;
}

/** Para ordenar por parecido: los vectores de los nombres de las especialidades y el vector de la ocupación. */
interface Relevancia {
  especialidades: VectoresGuardados;
  consulta: Float32Array;
}

/** Cuánta formación se muestra. Sin `relevancia`, se ordena por relación, correspondencia y nombre. */
interface OpcionesFormacion {
  maxEspecialidades?: number;
  /** Cursos del SOC que se devuelven como mucho; por defecto, todos los que no han terminado. */
  maxCursos?: number;
  relevancia?: Relevancia | null;
  /** Con el Consorci, sus ediciones y acciones previstas de las mismas especialidades (formacion-consorci.ts). */
  consorci?: DatosConsorci | null;
  /** Los programas del SEPE comprobados: solo esos se enlazan (enlaces-comprobados.ts). Sin ellos, ninguno. */
  programas?: ProgramasSepe;
}

/** Cómo llega una especialidad a la ocupación de la persona por los datos oficiales. */
interface Enlace {
  relacion: 'ocupacion' | 'incluye' | 'grupo' | 'variante';
  correspondencia: Correspondencia;
  ocupacionOficial?: string;
}
/** Enlaces por código de ocupación del SEPE y por grupo CNO-11 de 4 cifras. */
interface Enlaces {
  porCodigoOcupacion: Map<string, Enlace>;
  porGrupo: Map<string, Enlace>;
}
type EspecialidadOficial = DatosFormacion['especialidades'][string];
type CursoOficial = DatosFormacion['cursos'][number];
/** Parecido del nombre de una especialidad con la ocupación; null si no hay vectores para medirlo. */
type MedirParecido = (codigo: string) => number | null;
/** Lo que un curso toma de su especialidad: su código, su nombre (si el curso no trae uno) y su programa. */
type EspecialidadDeLaFicha = Pick<EspecialidadRelacionada, 'codigo' | 'nombre' | 'programa'>;
/** Por qué especialidad se ofrece un curso y si es una sugerencia de Faro. */
interface EspecialidadDeUnCurso {
  especialidad: EspecialidadDeLaFicha;
  sugerencia: boolean;
}
/** La especialidad por la que se ofrece un curso; undefined si no es de ninguna de las elegidas. */
type EspecialidadDelCurso = (curso: CursoOficial) => EspecialidadDeUnCurso | undefined;

/**
 * Posiciones calculadas una vez por índice; este módulo es dueño de la caché, que vive lo que vive su índice.
 * Los índices no se mutan tras cargarse (contrato de vectores.ts).
 */
const posicionesPorIndice = new WeakMap<IndiceVectores, Map<string, number>>();

/**
 * La posición de una especialidad en un índice de vectores.
 *
 * @param indice - Índice cargado con cargarIndice.
 * @param codigo - El código de la especialidad.
 * @returns Su posición en `indice.ids`, o undefined si el índice no la tiene.
 */
function posicionEn(indice: IndiceVectores, codigo: string): number | undefined {
  const guardadas = posicionesPorIndice.get(indice);
  if (guardadas) {
    return guardadas.get(codigo);
  }
  const posiciones = new Map(indice.ids.map((id, i) => [id, i]));
  posicionesPorIndice.set(indice, posiciones);
  return posiciones.get(codigo);
}

/** Mide el parecido de cada especialidad con la consulta; sin índice, sin consulta o sin su vector, null. */
function medidorDeParecido(indice: IndiceVectores | null, consulta: Float32Array | undefined): MedirParecido {
  return (codigo) => {
    const posicion = indice ? posicionEn(indice, codigo) : undefined;
    if (!indice || !consulta || posicion === undefined) {
      return null;
    }
    return similitudCon(indice, posicion, consulta);
  };
}

/** El enlace que manda: el de relación más cercana y, a igualdad, el de correspondencia más fiable. */
function mejorEnlace(actual: Enlace | undefined, candidato: Enlace): Enlace {
  return !actual || ordenDeEnlaces(candidato, actual) < 0 ? candidato : actual;
}

/** Enlace de un código de ocupación del SEPE según cómo corresponde, en EURES, a la ocupación ESCO. */
function enlaceDirecto(correspondencia: Correspondencia, etiqueta: string): Enlace {
  if (correspondencia === 'exacta' || correspondencia === 'cercana') {
    return { relacion: 'ocupacion', correspondencia };
  }
  const relacion = correspondencia === 'amplia' ? 'incluye' : 'variante';
  return { relacion, correspondencia, ocupacionOficial: nombreLegible(etiqueta) };
}

/**
 * El grupo primario de la CNO-11 de un código de ocupación del SEPE.
 *
 * @param codigo - Un código de ocupación del SEPE (8 cifras) o un grupo (4 cifras).
 * @returns Sus CIFRAS_DEL_GRUPO primeras cifras.
 */
function grupoDe(codigo: string): string {
  return codigo.slice(0, CIFRAS_DEL_GRUPO);
}

/** Cómo se relaciona cada código de ocupación del SEPE, y cada grupo de 4 cifras, con la ocupación de la persona. */
function enlacesDe(codigos: DatosFormacion['ocupaciones'][string]): Enlaces {
  const porCodigoOcupacion = new Map<string, Enlace>();
  const porGrupo = new Map<string, Enlace>();
  for (const [codigo, correspondencia, etiqueta] of codigos) {
    const directo = enlaceDirecto(correspondencia, etiqueta);
    porCodigoOcupacion.set(codigo, mejorEnlace(porCodigoOcupacion.get(codigo), directo));
    // Una variante más específica no abre su grupo: puede estar en otro (ver la cabecera).
    if (correspondencia === 'estrecha') {
      continue;
    }
    const grupo = grupoDe(codigo);
    porGrupo.set(grupo, mejorEnlace(porGrupo.get(grupo), { relacion: 'grupo', correspondencia }));
  }
  return { porCodigoOcupacion, porGrupo };
}

/**
 * Enlaces a nivel de grupo: cada código CNO-11 del INE abre su grupo de 4 cifras, sin enlaces por ocupación.
 *
 * @param correspondencias - Los códigos CNO-11 del INE para el grupo ISCO-08, con su tipo.
 * @returns Los enlaces, solo por grupo.
 * @throws {InvarianteRoto} Si un tipo de correspondencia no es uno de los cuatro del INE.
 */
function enlacesDelGrupo(correspondencias: readonly CorrespondenciaIne[]): Enlaces {
  const porGrupo = new Map<string, Enlace>();
  for (const { cno11, tipo } of correspondencias) {
    if (!Object.hasOwn(CORRESPONDENCIA_INE, tipo)) {
      throw new InvarianteRoto(`Tipo de correspondencia del INE desconocido: ${tipo} (${cno11})`);
    }
    // hasOwn comprueba que tipo es una de las claves de esta tabla local de correspondencias conocidas.
    const candidato: Enlace = { relacion: 'grupo', correspondencia: CORRESPONDENCIA_INE[tipo] as Correspondencia };
    porGrupo.set(cno11, mejorEnlace(porGrupo.get(cno11), candidato));
  }
  return { porCodigoOcupacion: new Map(), porGrupo };
}

/** El mejor enlace de una especialidad con la ocupación, por cualquiera de sus ocupaciones relacionadas. */
function enlaceDeEspecialidad(especialidad: EspecialidadOficial, enlaces: Enlaces): Enlace | undefined {
  let enlace: Enlace | undefined;
  for (const ocupacion of especialidad.ocupaciones) {
    const directo = enlaces.porCodigoOcupacion.get(ocupacion);
    if (directo) {
      enlace = mejorEnlace(enlace, directo);
    }
    const delGrupo = enlaces.porGrupo.get(grupoDe(ocupacion));
    if (delGrupo) {
      enlace = mejorEnlace(enlace, delGrupo);
    }
  }
  return enlace;
}

/**
 * Lo que se muestra de una especialidad, con los nombres oficiales ya legibles y su programa si está comprobado. La
 * dirección del PDF que trae el catálogo no se usa: la mayoría da 404 (enlaces-comprobados.ts).
 *
 * @param codigo - El código de la especialidad en el catálogo.
 * @param especialidad - Su registro en el catálogo del paquete.
 * @param programas - Los programas del SEPE comprobados; sin ellos, ningún enlace.
 * @returns La ficha de la especialidad.
 */
export function fichaDeEspecialidad(
  codigo: string,
  especialidad: EspecialidadOficial,
  programas: ProgramasSepe | undefined,
): EspecialidadTransversal {
  return {
    codigo,
    nombre: nombreLegible(especialidad.nombre),
    nivel: especialidad.nivel,
    horas: especialidad.horas,
    familia: nombreLegible(especialidad.familia),
    modalidad: especialidad.modalidad,
    programa: programaOficial(codigo, programas),
  };
}

/** Especialidades que el SEPE relaciona con la ocupación, en el orden en que se muestran. */
function especialidadesRelacionadas(
  formacion: DatosFormacion,
  enlaces: Enlaces,
  medirParecido: MedirParecido,
  programas: ProgramasSepe | undefined,
): EspecialidadRelacionada[] {
  const relacionadas: EspecialidadRelacionada[] = [];
  for (const [codigo, especialidad] of Object.entries(formacion.especialidades)) {
    const enlace = enlaceDeEspecialidad(especialidad, enlaces);
    if (!enlace) {
      continue;
    }
    relacionadas.push({
      ...fichaDeEspecialidad(codigo, especialidad, programas),
      ...enlace,
      parecido: medirParecido(codigo) ?? undefined,
    });
  }
  return relacionadas.sort(ordenEspecialidades);
}

/** Una especialidad puede estar varias veces con el mismo nombre (versiones o códigos distintos): queda la primera. */
function sinNombresRepetidos(especialidades: EspecialidadRelacionada[]): EspecialidadRelacionada[] {
  const vistas = new Set<string>();
  return especialidades.filter((especialidad) => {
    const nombre = especialidad.nombre.toLowerCase();
    if (vistas.has(nombre)) {
      return false;
    }
    vistas.add(nombre);
    return true;
  });
}

/** Especialidades que el SEPE no relaciona pero cuyo nombre se parece a la ocupación, marcadas como sugerencia. */
function sugerencias(
  formacion: DatosFormacion,
  oficiales: EspecialidadRelacionada[],
  medirParecido: MedirParecido,
  programas: ProgramasSepe | undefined,
): EspecialidadRelacionada[] {
  const codigosOficiales = new Set(oficiales.map((especialidad) => especialidad.codigo));
  const nombresVistos = new Set(oficiales.map((especialidad) => especialidad.nombre.toLowerCase()));
  const candidatas = Object.entries(formacion.especialidades)
    .filter(([codigo]) => !codigosOficiales.has(codigo))
    .map(([codigo, especialidad]) => ({ codigo, especialidad, parecido: medirParecido(codigo) ?? 0 }))
    .filter((candidata) => candidata.parecido >= UMBRAL_SUGERENCIA)
    .sort((a, b) => b.parecido - a.parecido);
  const elegidas: EspecialidadRelacionada[] = [];
  for (const { codigo, especialidad, parecido } of candidatas) {
    if (elegidas.length >= MAX_SUGERENCIAS) {
      break;
    }
    const ficha = fichaDeEspecialidad(codigo, especialidad, programas);
    const nombre = ficha.nombre.toLowerCase();
    if (nombresVistos.has(nombre)) {
      continue;
    }
    nombresVistos.add(nombre);
    const parecidoRedondeado = Math.round(parecido * PRECISION_PARECIDO) / PRECISION_PARECIDO;
    elegidas.push({ ...ficha, relacion: 'sugerencia', correspondencia: null, parecido: parecidoRedondeado });
  }
  return elegidas;
}

/**
 * Un curso es de la primera de sus especialidades que está entre las elegidas; sin ninguna, no se ofrece.
 *
 * @param porCodigo - Las especialidades elegidas, por el código con que las citan los cursos.
 * @param esSugerencia - Si una especialidad elegida es una sugerencia de Faro.
 * @returns La especialidad de cada curso, o undefined si no es de ninguna de las elegidas.
 */
export function porEspecialidadElegida<E extends EspecialidadDeLaFicha>(
  porCodigo: ReadonlyMap<string, E>,
  esSugerencia: (especialidad: E) => boolean,
): EspecialidadDelCurso {
  return (curso) => {
    for (const codigo of curso.especialidades) {
      const especialidad = porCodigo.get(codigo);
      if (especialidad) {
        return { especialidad, sugerencia: esSugerencia(especialidad) };
      }
    }
    return undefined;
  };
}

/** Un curso de la copia del SOC tal como lo enseña el informe, con su especialidad y su momento. */
function cursoRelacionado(
  curso: CursoOficial,
  { especialidad, sugerencia }: EspecialidadDeUnCurso,
  momento: MomentoCurso,
  comprobado: string,
): CursoRelacionado {
  return {
    id: curso.id,
    nombre: curso.nombre || especialidad.nombre,
    especialidad: especialidad.codigo,
    modalidad: curso.modalidad,
    municipio: curso.municipio,
    inicio: curso.inicio,
    fin: curso.fin,
    horas: curso.horas,
    centro: curso.centro,
    enlace: curso.enlace,
    sugerencia,
    momento,
    destinatarios: curso.destinatarios ?? null,
    comprobado,
    inscripcion: 'sin-verificar',
    aDistancia: esADistancia(curso.modalidad),
    programa: especialidad.programa,
  };
}

/**
 * Cursos de la copia que se ofrecen el día `hoy`: los que son de una especialidad elegida y no han terminado, en el
 * orden de las convocatorias. Que no hayan terminado no acredita que queden plazas.
 *
 * @param formacion - El catálogo y los cursos del paquete.
 * @param hoy - El día de la consulta (AAAA-MM-DD).
 * @param especialidadDelCurso - La especialidad elegida de cada curso (porEspecialidadElegida).
 * @returns Los cursos que se ofrecen, en el orden de las convocatorias.
 */
export function cursosOfrecidos(
  formacion: DatosFormacion,
  hoy: string,
  especialidadDelCurso: EspecialidadDelCurso,
): CursoRelacionado[] {
  const cursos: CursoRelacionado[] = [];
  for (const curso of formacion.cursos) {
    const momento = momentoDelCurso(curso, hoy);
    const elegida = especialidadDelCurso(curso);
    if (momento === 'terminado' || !elegida) {
      continue;
    }
    cursos.push(cursoRelacionado(curso, elegida, momento, formacion.fecha_cursos));
  }
  return cursos.sort(ordenDeConvocatorias);
}

/** La formación que se muestra a partir de los enlaces oficiales, ya ordenada, con sugerencias y cursos abiertos. */
function formacionConEnlaces(
  formacion: DatosFormacion,
  enlaces: Enlaces,
  hoy: string,
  {
    maxEspecialidades = MAX_ESPECIALIDADES_POR_DEFECTO,
    maxCursos = Number.POSITIVE_INFINITY,
    relevancia = null,
    consorci = null,
    programas,
  }: OpcionesFormacion,
): FormacionRelacionada {
  const indice = relevancia ? cargarIndice(relevancia.especialidades) : null;
  const medirParecido = medidorDeParecido(indice, relevancia?.consulta);
  const relacionadas = especialidadesRelacionadas(formacion, enlaces, medirParecido, programas);
  const especialidades = sinNombresRepetidos(relacionadas);
  // Sugerencias de Faro, marcadas como tales, si el SEPE relaciona pocas y hay vectores para medir el parecido.
  if (relevancia && especialidades.length < MIN_OFICIALES) {
    especialidades.push(...sugerencias(formacion, especialidades, medirParecido, programas));
  }
  // Los cursos pueden ser de cualquier especialidad relacionada, también de las que no se muestran por repetidas.
  const porCodigo = new Map(
    [...relacionadas, ...especialidades].map((especialidad) => [especialidad.codigo, especialidad]),
  );
  const deUnaSugerencia = (especialidad: EspecialidadRelacionada): boolean => especialidad.relacion === 'sugerencia';
  const cursos = cursosOfrecidos(formacion, hoy, porEspecialidadElegida(porCodigo, deUnaSugerencia));
  const relacionada: FormacionRelacionada = {
    especialidades: especialidades.slice(0, maxEspecialidades),
    totalEspecialidades: especialidades.length,
    cursos: cursos.slice(0, maxCursos),
    fechaCursos: formacion.fecha_cursos,
    copiaAntigua: esCopiaAntigua(formacion.fecha_cursos, hoy),
    fuentes: [formacion.fuentes.sepe, formacion.fuentes.soc, formacion.fuentes.eures],
  };
  if (!consorci) {
    return relacionada;
  }
  const ediciones = edicionesDelConsorci(consorci, porPrimerCodigo(porCodigo.values()), hoy, porCodigo.keys());
  return { ...relacionada, fuentes: [...relacionada.fuentes, consorci.fuente], consorci: ediciones };
}

/**
 * Formación oficial relacionada con una ocupación ESCO, en un orden fijo y explicable (ver la cabecera).
 *
 * @param formacion - El catálogo y los cursos del paquete.
 * @param esco - El identificador de la ocupación ESCO.
 * @param hoy - El día de la consulta (AAAA-MM-DD): decide el momento de cada curso y deja fuera los terminados.
 * @param opciones - Cuántas especialidades (`maxEspecialidades`) y cursos (`maxCursos`, por defecto todos) se
 *   devuelven como mucho, el parecido, el Consorci y los programas comprobados.
 * @returns La formación relacionada con la ocupación.
 */
export function formacionPara(
  formacion: DatosFormacion,
  esco: string,
  hoy: string,
  opciones: OpcionesFormacion = {},
): FormacionRelacionada {
  return formacionConEnlaces(formacion, enlacesDe(formacion.ocupaciones[esco] ?? []), hoy, opciones);
}

/**
 * Formación oficial a nivel de grupo, sin ocupación ESCO: las especialidades del SEPE de los grupos CNO-11 que el INE
 * hace corresponder con el grupo ISCO-08. Va marcada con `nivel: 'grupo'` y cita solo las fuentes que usa.
 *
 * @param formacion - El catálogo y los cursos del paquete.
 * @param correspondencias - Los códigos CNO-11 del INE para el grupo ISCO-08, con su tipo.
 * @param hoy - El día de la consulta (AAAA-MM-DD).
 * @param opciones - Como en formacionPara; para ordenar, `relevancia` lleva el vector de las tareas del grupo
 *   (consultaGrupo, consulta-de-vectores.ts).
 * @returns La formación relacionada con el grupo.
 * @throws {InvarianteRoto} Si un tipo de correspondencia no es uno de los cuatro del INE.
 */
export function formacionDelGrupo(
  formacion: DatosFormacion,
  correspondencias: readonly CorrespondenciaIne[],
  hoy: string,
  opciones: OpcionesFormacion = {},
): FormacionRelacionada {
  const relacionada = formacionConEnlaces(formacion, enlacesDelGrupo(correspondencias), hoy, opciones);
  // Sin enlaces por ocupación, EURES no interviene: se citan las demás (el INE va en las fuentes del informe).
  const fuentes = relacionada.fuentes.filter((fuente) => fuente !== formacion.fuentes.eures);
  return { ...relacionada, fuentes, nivel: 'grupo' };
}
