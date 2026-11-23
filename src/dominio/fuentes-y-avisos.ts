// Qué fuentes cita el informe y qué advierte, según los datos y lo que ha confirmado la persona. Las reglas están
// aquí; sus textos, en el idioma del informe, en textos-informe.ts. Cada cita de una fuente se da tal como la publica
// la fuente, en su idioma, y en un informe traducido se apunta como dato sin traducir.

import { fechaConBarras } from '../comun/formato.ts';
import type { Lengua } from './lengua.ts';
import type { OcupacionConfirmada } from './ocupacion-confirmada.ts';
import type { Entrada, TareaEntrada } from './tipos-entrada.ts';
import type { Informe, TareaInforme } from './tipos-informe.ts';
import type { Datos, EstadoTexto } from './tipos-paquete.ts';

/** Estados de los textos de las tareas oficiales hechos con IA, de los que el informe avisa (Ley de IA, art. 50). */
const HECHOS_CON_IA: ReadonlySet<EstadoTexto | undefined> = new Set(['redactado con IA', 'traducido con IA']);

/**
 * Con qué se escriben los avisos: la formación del informe, sus textos y si a Faro le faltan referencias para estimar.
 */
interface AvisosDelInforme {
  formacion: Informe['formacion'];
  textos: Lengua['textos'];
  sinReferencias: boolean;
  /** Si el motor de cursos no estaba: el informe ya lo dice con su aviso, y no hace falta decir que no hay formación. */
  formacionNoDisponible?: boolean;
}

/** De dónde viene la estimación de una tarea de la entrada. */
type OrigenDeLaEstimacion = NonNullable<TareaEntrada['estimacion']>['origen'];

/** Una fuente oficial del informe. */
function oficial(texto: string): { texto: string; nivel: 'oficial' } {
  return { texto, nivel: 'oficial' };
}

/**
 * La cita de la OIT con los dos avisos que exige su licencia, literales y en inglés: el de adaptación, porque las notas
 * y las medias son una adaptación del WP140, y el de traducción, porque las tareas oficiales salen traducidas por Faro
 * en castellano y en catalán. Los dos van en todos los informes.
 *
 * @param datos - El paquete de datos.
 * @param lengua - La lengua del informe.
 * @returns La cita con los dos avisos de la licencia.
 */
export function citaOit(datos: Datos, lengua: Lengua): string {
  const { cita, aviso_adaptacion: avisoAdaptacion } = datos.oit.fuente;
  return lengua.original(`${cita} ${avisoAdaptacion} ${datos.textos.aviso_traduccion}`, 'en');
}

/**
 * La cita de los nombres oficiales en catalán de los grupos (Idescat), con la fecha de la consulta y la dirección del
 * Idescat, como piden sus condiciones: solo en un informe en catalán, el único que los enseña.
 */
function citaNombresCatalanes(datos: Datos, lengua: Lengua): string[] {
  const fuente = datos.catalan?.fuente_grupos;
  if (lengua.idioma !== 'ca' || !fuente) {
    return [];
  }
  return [lengua.textos.fuentes.nombresIdescat(fechaConBarras(fuente.consultado))];
}

/** Las citas de los datos de Cataluña: el censo del INE, en castellano, y el Observatori del Treball, en catalán. */
function citasCataluna(datos: Datos, lengua: Lengua): string[] {
  if (!datos.cataluna) {
    return [];
  }
  const { censo, observatori } = datos.cataluna.fuentes;
  return [lengua.original(censo, 'es'), lengua.original(observatori, 'ca')];
}

/**
 * Las citas de los datos oficiales del grupo que muestra el informe, en castellano, como las publica cada fuente: solo
 * las de los bloques que tienen alguna cifra.
 *
 * @param datos - El paquete de datos.
 * @param informe - El contexto y el uso declarado de la IA del informe.
 * @param lengua - La lengua del informe.
 * @returns Las citas presentes, en el orden de los bloques del grupo.
 */
export function citasDelGrupo(
  datos: Datos,
  { contexto, usoDeclaradoIa }: Pick<Informe, 'contexto' | 'usoDeclaradoIa'>,
  lengua: Lengua,
): string[] {
  const citas = [
    contexto.ocupados.some((grupo) => grupo.organismo === 'Idescat') ? datos.ocupados?.fuentes.idescat : undefined,
    contexto.perfil.length ? datos.censo?.fuentes.censo : undefined,
    contexto.salario ? datos.salarios?.fuentes.salarios : undefined,
    usoDeclaradoIa ? datos.tich?.fuentes.tich : undefined,
    usoDeclaradoIa?.noSabianComo ? datos.tich?.motivos_no_uso.fuente : undefined,
  ];
  return citas.filter((cita) => cita !== undefined).map((cita) => lengua.original(cita, 'es'));
}

/**
 * Las citas de la formación de fuera del catálogo oficial que lleva el informe: Citilab, que publica sus propios cursos
 * (oficial), y la formación abierta, que es una selección de Faro.
 */
function citasDeOtraFormacion(
  { citilab, formacionAbierta }: Pick<Informe, 'citilab' | 'formacionAbierta'>,
  textos: Lengua['textos']['fuentes'],
): Informe['fuentes'] {
  return [
    ...(citilab ? [oficial(textos.citilab(fechaConBarras(citilab.consultado)))] : []),
    ...(formacionAbierta
      ? [{ texto: textos.formacionAbierta(formacionAbierta.criterio), nivel: 'faro' as const }]
      : []),
    // Barcelona Activa publica sus formaciones: su cita, en catalán, como la publica (informe.ts la marca).
    ...(formacionAbierta?.cibernarium ? [oficial(formacionAbierta.cibernarium.fuente)] : []),
  ];
}

/**
 * Fuentes citadas en el informe, cada una con su nivel: las fijas, las de la formación del informe y `delGrupo`, las
 * de los datos oficiales del grupo.
 *
 * @param datos - El paquete de datos.
 * @param informe - La formación del informe.
 * @param delGrupo - Las citas de los datos oficiales del grupo.
 * @param lengua - La lengua del informe.
 * @returns Las fuentes, cada una con su nivel.
 */
export function fuentesInforme(
  datos: Datos,
  {
    formacion,
    formacionTransversal,
    ...otraFormacion
  }: Pick<Informe, 'formacion' | 'formacionTransversal' | 'citilab' | 'formacionAbierta'>,
  delGrupo: string[],
  lengua: Lengua,
): Informe['fuentes'] {
  const textos = lengua.textos.fuentes;
  // La cita del estudio de la Cambra está en catalán, como se publicó; la frase que la sigue es de Faro.
  const cambra = `${lengua.original(datos.cambra.fuente, 'ca')} ${textos.cifrasVerificadas}`;
  return [
    oficial(citaOit(datos, lengua)),
    { texto: textos.notasPorTarea, nivel: 'complementaria' },
    oficial(textos.esco),
    oficial(textos.ine),
    ...citaNombresCatalanes(datos, lengua).map(oficial),
    ...citasCataluna(datos, lengua).map(oficial),
    ...delGrupo.map(oficial),
    oficial(cambra),
    ...(formacion ? formacion.fuentes.map((fuente) => oficial(lengua.original(fuente, 'es'))) : []),
    // La ACTIC del bloque digital: sus disposiciones del DOGC y su portal, citadas como en el paquete.
    ...(formacionTransversal?.certificacion
      ? [oficial(lengua.original(formacionTransversal.certificacion.fuente, 'es'))]
      : []),
    ...citasDeOtraFormacion(otraFormacion, textos),
    { texto: textos.elaboracionFaro, nivel: 'faro' },
  ];
}

/**
 * Avisos sobre la calidad de lo que muestra el informe: nada se presenta como más seguro de lo que es. Si faltan notas
 * porque Faro no tiene referencias para estimar las tareas del grupo, el aviso da ese motivo.
 *
 * @param entrada - La entrada del informe.
 * @param datos - El paquete de datos.
 * @param tareas - Las tareas del informe.
 * @param informe - La formación, los textos y si faltan referencias.
 * @returns Los avisos.
 */
export function avisosInforme(
  entrada: Entrada,
  datos: Datos,
  tareas: TareaInforme[],
  { formacion, textos, sinReferencias, formacionNoDisponible = false }: AvisosDelInforme,
): string[] {
  const avisos: string[] = [];
  const { avisos: texto } = textos;
  const hayEstimacionDeOrigen = (origen: OrigenDeLaEstimacion): boolean =>
    entrada.tareas.some((tarea) => tarea.estimacion?.origen === origen);
  const textosConIa = entrada.tareas.some(
    (tarea) => tarea.referencia && HECHOS_CON_IA.has(datos.textos.tareas[tarea.referencia.tareaOit]?.estado),
  );
  if (hayEstimacionDeOrigen('ejemplo')) {
    avisos.push(texto.ejemplo);
  }
  if (hayEstimacionDeOrigen('faro-sin-validar')) {
    avisos.push(texto.sinValidar);
  }
  if (textosConIa) {
    avisos.push(texto.textosConIa);
  }
  if (!datos.cataluna) {
    avisos.push(texto.sinCataluna);
  }
  if (!formacion && !formacionNoDisponible) {
    avisos.push(texto.sinFormacion);
  }
  if (tareas.some((tarea) => tarea.incierta)) {
    avisos.push(texto.inciertas);
  }
  if (tareas.some((tarea) => tarea.evidencia === 'insuficiente')) {
    avisos.push(sinReferencias ? texto.sinReferencias : texto.insuficientes);
  }
  return avisos;
}

/**
 * Avisos de una ocupación confirmada a nivel de grupo, sin ocupación ESCO: qué describe el grupo entero y por qué las
 * competencias no dicen si son esenciales u opcionales. Con ocupación ESCO, ninguno.
 *
 * @param ocupacion - La ocupación confirmada.
 * @param tareas - Las tareas del informe.
 * @param lengua - La lengua del informe.
 * @returns Los avisos; ninguno con ocupación ESCO.
 */
export function avisosDeOcupacion(ocupacion: OcupacionConfirmada, tareas: TareaInforme[], lengua: Lengua): string[] {
  if (ocupacion.esco !== null) {
    return [];
  }
  const avisos = [lengua.textos.avisos.grupoSinEsco];
  const sinRelacion = tareas.some((tarea) =>
    tarea.competencias.some((competencia) => competencia.relacion === 'sin-ocupacion'),
  );
  if (sinRelacion) {
    avisos.push(lengua.textos.avisos.competenciasSinOcupacion);
  }
  return avisos;
}

/**
 * Solo en un informe traducido: que las traducciones de los datos oficiales están hechas con IA, y que algunos
 * datos siguen en su idioma. Se piden al final, cuando el informe ya ha usado todos sus datos.
 *
 * @param lengua - La lengua del informe.
 * @returns Los avisos; ninguno si el informe no está traducido.
 */
export function avisosDeTraduccion(lengua: Lengua): string[] {
  const { traduccion } = lengua.textos;
  if (!traduccion) {
    return [];
  }
  const avisos: string[] = [];
  if (lengua.hayTraducciones()) {
    avisos.push(traduccion.deFaro);
  }
  if (lengua.sinTraducir().length) {
    avisos.push(traduccion.sinTraducir);
  }
  return avisos;
}
