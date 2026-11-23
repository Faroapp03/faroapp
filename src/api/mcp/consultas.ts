// Lo que responde cada herramienta del servidor MCP: las mismas consultas factuales que usan la API y el informe, sin
// duplicar ninguna regla, con su procedencia y topes para las listas de ocupaciones, formación y certificados. Cada
// lista recortada dice cuántos elementos tiene en total; herramientas.ts comprueba además el tamaño de la respuesta.

import type { FormacionRelacionada } from '../../../motores/cursos/src/index.ts';
import { buscarOcupaciones } from '../../../motores/ocupaciones/src/index.ts';
import type { DatosGlobales } from '../../datos-globales/datos.ts';
import { bloqueDeAcreditacion } from '../../dominio/acreditacion.ts';
import { contextoCataluna } from '../../dominio/contexto.ts';
import { UMBRALES } from '../../dominio/franjas.ts';
import { citasDelGrupo } from '../../dominio/fuentes-y-avisos.ts';
import { hijosDe, tituloIsco } from '../../dominio/grupos.ts';
import { crearLengua } from '../../dominio/lengua.ts';
import { conIaDelPaquete, type MarcaIa, marcaIa } from '../../dominio/marca-ia.ts';
import { resolverOcupacion } from '../../dominio/ocupacion-confirmada.ts';
import type { Datos, PoliticaReferencias } from '../../dominio/tipos-paquete.ts';
import { usoDeclaradoDeLaIa } from '../../dominio/uso-declarado-de-la-ia.ts';
import {
  type EstadoDelMotor,
  mensajeDe,
  type PuertaDelMotor,
  type ResultadoDelMotor,
  type SinMotor,
} from '../../plataforma/motor-de-cursos.ts';
import { textoParaBuscar } from '../../seguridad/texto-para-buscar.ts';
import { conTareasTipicas, fichaGrupo } from '../fichas.ts';
import {
  fuenteEsco,
  fuenteIne,
  fuenteNotasPorTarea,
  fuenteOit,
  LICENCIAS,
  oficial,
  type Procedencia,
  procedencia,
} from './procedencia.ts';

/** Topes de las listas proyectadas; no limitan el conjunto de tareas oficiales de una ficha. */
const TOPES = { ocupaciones: 40, especialidades: 12, cursos: 12, ediciones: 10, certificados: 12 } as const;

/** Con qué se responde: los datos, la política de referencias de la API y la fecha de hoy (AAAA-MM-DD). */
export interface AmbitoConsulta {
  datos: Datos;
  politica: PoliticaReferencias;
  hoy: string;
  /** Captura territorial opcional; su ausencia afecta solo a las consultas de datos globales. */
  datosGlobales?: DatosGlobales | null;
  /** La puerta del motor de cursos (plataforma/motor-de-cursos.ts), por la que se pide antes de una consulta de formación. */
  puertaDeCursos?: PuertaDelMotor;
  /**
   * La formación de la ocupación de la consulta, ya calculada por el motor de cursos con la operación
   * formacionDeLaOcupacion de su puerta (llamarHerramientaConElMotor), en su trabajador si lo tiene. Solo la usa la
   * formación oficial; sin ella, esa consulta dice que no está disponible y las demás responden igual.
   */
  formacionDeCursos?: ResultadoDelMotor<FormacionRelacionada | null>;
  /** El motor ya cargado en este hilo, solo para las pruebas de las consultas; la app manda formacionDeCursos. */
  motorDeCursos?: EstadoDelMotor;
}

/** Una respuesta de herramienta: lo consultado y su procedencia. */
export type Consulta = Record<string, unknown> & { procedencia: Procedencia };

/** Los primeros `tope` elementos de una lista y cuántos tiene en total. */
function acotada<Elemento>(lista: readonly Elemento[], tope: number) {
  return { total: lista.length, elementos: lista.slice(0, tope) };
}

/** La ocupación de una consulta: el grupo y, si se da, una ocupación ESCO de ese grupo. Lanza si no encajan. */
export function ocupacionDe(datos: Datos, isco: string, esco: string | undefined) {
  return resolverOcupacion(datos, { isco08: isco, ...(esco === undefined ? {} : { ocupacionEsco: esco }) });
}

/**
 * La licencia de cada cita de la formación, por su cita: el SEPE, el SOC, la correspondencia de EURES y el Consorci.
 * Una cita que no es de ninguna de ellas no tiene licencia conocida y lanza: darle la de otra fuente afirmaría unos
 * derechos de reutilización que nadie ha comprobado.
 *
 * @param datos - El paquete de datos.
 * @returns Una función que da la licencia de una cita.
 */
export function licenciasDeLaFormacion(datos: Datos): (cita: string) => string {
  const citas = datos.formacion?.fuentes;
  const pares: [string | undefined, string][] = [
    [citas?.sepe, LICENCIAS.sepe],
    [citas?.soc, LICENCIAS.soc],
    [citas?.eures, LICENCIAS.esco],
    [datos.consorci?.fuente, LICENCIAS.consorci],
  ];
  const licencias = new Map(pares.filter((par): par is [string, string] => par[0] !== undefined));
  return (cita) => {
    const licencia = licencias.get(cita);
    if (licencia === undefined) {
      throw new Error(`La cita de formación «${cita}» no tiene licencia conocida`);
    }
    return licencia;
  };
}

/**
 * Ocupaciones ESCO candidatas para un texto, por palabras, con su grupo y tres tareas oficiales para distinguirlas.
 *
 * @param ambito - El ámbito de la consulta (sus datos).
 * @param texto - Lo que escribe la persona.
 * @param maximo - Cuántas candidatas como mucho.
 * @returns El resultado con las candidatas y su procedencia.
 */
export function buscarOcupacion({ datos }: AmbitoConsulta, texto: string, maximo: number): Consulta {
  const lengua = crearLengua(datos);
  const candidatas = conTareasTipicas(datos, buscarOcupaciones(datos, textoParaBuscar(texto), maximo)).map(
    ({ esco, titulo, isco08, tituloIsco: grupo, tareasTipicas }) => ({ esco, titulo, isco08, grupo, tareasTipicas }),
  );
  return {
    candidatas,
    procedencia: procedencia(
      [fuenteEsco(lengua), fuenteOit(datos, lengua), fuenteIne(lengua)],
      'Los títulos de las ocupaciones son los de ESCO; los grupos, los de la CIUO-08 (ISCO-08) en español.',
      'El orden lo da el buscador de Faro por parecido de palabras: son candidatas, no una clasificación. La persona confirma su grupo; los nombres cortos de las tareas los redactó Faro.',
    ),
  };
}

/**
 * Los grupos hijos de un código de la CIUO-08 (los diez grandes grupos, sin padre). Null si el padre no existe.
 *
 * @param ambito - El ámbito de la consulta (sus datos).
 * @param padre - El código del grupo padre; vacío para los grandes grupos.
 * @returns Los hijos con su procedencia, o null si el padre no existe.
 */
export function explorarGrupos({ datos }: AmbitoConsulta, padre: string): Consulta | null {
  const hijos = hijosDe(datos, padre);
  if (!hijos) {
    return null;
  }
  const lengua = crearLengua(datos);
  return {
    padre: padre ? { isco08: padre, titulo: tituloIsco(datos, padre) } : null,
    hijos,
    procedencia: procedencia(
      [oficial(datos.oit.fuente.cita, LICENCIAS.oit), fuenteEsco(lengua)],
      'La jerarquía y los títulos son los de la CIUO-08 (ISCO-08) en español.',
      'Faro cuenta cuántas ocupaciones ESCO caen dentro de cada grupo.',
    ),
  };
}

/**
 * La marca legible por máquina de la ficha (dominio/marca-ia.ts): el texto en castellano de cada tarea lo tradujo la IA
 * al preparar los datos, salvo la redacción manual; lo demás son datos oficiales o reglas de Faro. Sin `texto_es`, la
 * tarea va en el inglés de la OIT y no lleva nada escrito con IA.
 */
function marcaDeLaFicha(datos: Datos, tareas: readonly { id: string; texto_es?: string | null }[]): MarcaIa {
  const traducidas = tareas.flatMap(({ id, texto_es: textoEs }, indice) =>
    textoEs && datos.textos.tareas[id]?.estado !== 'redacción manual'
      ? [conIaDelPaquete(`/tareas/${indice}/texto`, 'traducido')]
      : [],
  );
  return marcaIa(traducidas, {
    '/isco08': 'datos-oficiales',
    '/titulo': 'datos-oficiales',
    '/exposicionOit': 'datos-oficiales',
    '/franjas': 'reglas-de-faro',
    '/tareas/*/texto': 'datos-oficiales',
    '/tareas/*/original': 'datos-oficiales',
    '/tareas/*/traduccion': 'reglas-de-faro',
    '/tareas/*/nota': 'datos-oficiales',
    '/tareas/*/margen': 'datos-oficiales',
    '/tareas/*/franja': 'reglas-de-faro',
    '/ocupacionesEsco': 'datos-oficiales',
    '/procedencia': 'reglas-de-faro',
  });
}

/**
 * La ficha de un grupo de 4 cifras: tareas oficiales con su nota de exposición a la IA generativa según la OIT.
 *
 * @param ambito - El ámbito de la consulta (sus datos y su política).
 * @param isco - El código del grupo de 4 cifras.
 * @returns La ficha con su procedencia.
 */
export function fichaDelGrupo({ datos, politica }: AmbitoConsulta, isco: string): Consulta {
  const lengua = crearLengua(datos);
  const ficha = fichaGrupo(datos, isco, politica);
  const tareas = ficha.tareas.map((tarea) => ({
    texto: tarea.texto_es ?? tarea.texto_en,
    original: tarea.texto_en,
    traduccion: datos.textos.tareas[tarea.id]?.estado ?? 'sin traducir',
    nota: tarea.nota,
    margen: tarea.margen,
    franja: tarea.franja,
  }));
  const ocupaciones = acotada(ficha.ocupaciones, TOPES.ocupaciones);
  return {
    isco08: ficha.isco08,
    titulo: ficha.titulo,
    exposicionOit: ficha.oit,
    franjas: {
      alta: `nota ≥ ${UMBRALES.alta}`,
      media: `${UMBRALES.media} ≤ nota < ${UMBRALES.alta}`,
      baja: `nota < ${UMBRALES.media}`,
    },
    tareas,
    ocupacionesEsco: { total: ocupaciones.total, ocupaciones: ocupaciones.elementos },
    procedencia: procedencia(
      [fuenteOit(datos, lengua), fuenteNotasPorTarea(lengua), fuenteEsco(lengua)],
      'Las tareas (en inglés, «original»), la media y el gradiente del grupo son de la OIT (WP140, 2025); la nota de cada tarea (0 a 1) y su margen, de las notas por tarea que enlaza la OIT.',
      'La franja la calcula Faro con sus umbrales, y el texto en castellano de cada tarea es una traducción de Faro («traduccion» dice cómo se hizo). La nota mide exposición de la tarea, no si un empleo desaparece.',
    ),
    marcaIa: marcaDeLaFicha(datos, ficha.tareas),
  };
}

/** Lo que dice la consulta de formación cuando el motor de cursos no está: ausente, averiado o bloqueado. */
const MOTOR_NO_DISPONIBLE =
  'La formación oficial no está disponible ahora mismo: el motor de cursos de esta instalación no responde. Las demás consultas funcionan';

/**
 * El motor de cursos no está para la consulta: el motivo, para la respuesta, y el motivo, al registro, como en
 * /api/cursos (responderSinMotorDeCursos, api/rutas/cursos.ts).
 */
function sinElMotor({ motivo }: Pick<SinMotor, 'motivo' | 'detalle'>): { disponible: false; motivo: string } {
  console.warn(`Faro: el motor de cursos no está disponible (${motivo}).`);
  return { disponible: false, motivo };
}

/**
 * La formación oficial de una ocupación, calculada por el motor de cursos ya cargado por su puerta. Un error del motor
 * cuenta como motor averiado: la consulta lo dice y no se cae, y el motivo queda en el registro.
 */
function formacionDelMotor(
  { datos, hoy, motorDeCursos, formacionDeCursos }: AmbitoConsulta,
  ocupacion: ReturnType<typeof ocupacionDe>,
): { disponible: true; formacion: FormacionRelacionada | null } | { disponible: false; motivo: string } {
  if (formacionDeCursos !== undefined) {
    return formacionDeCursos.disponible
      ? { disponible: true, formacion: formacionDeCursos.valor }
      : sinElMotor(formacionDeCursos);
  }
  if (!motorDeCursos?.disponible) {
    return sinElMotor(motorDeCursos ?? { motivo: 'ausente', detalle: 'la consulta no tiene el motor de cursos' });
  }
  try {
    return { disponible: true, formacion: motorDeCursos.motor.formacionDeLaOcupacion(datos, ocupacion, hoy) };
  } catch (error) {
    return sinElMotor({ motivo: 'averiado', detalle: mensajeDe(error) });
  }
}

/**
 * La formación oficial relacionada: especialidades del SEPE, cursos del SOC y ediciones del Consorci en Cataluña.
 *
 * @param ambito - El ámbito de la consulta (sus datos y la fecha de hoy).
 * @param isco - El código del grupo.
 * @param esco - El código de la ocupación ESCO, si se eligió.
 * @returns La formación oficial y su procedencia, o un aviso si el paquete no la trae.
 */
export function formacionOficial(ambito: AmbitoConsulta, isco: string, esco?: string): Consulta {
  const { datos } = ambito;
  const ocupacion = ocupacionDe(datos, isco, esco);
  const delMotor = formacionDelMotor(ambito, ocupacion);
  if (!delMotor.disponible) {
    const aviso = `${MOTOR_NO_DISPONIBLE} (${delMotor.motivo}).`;
    return { formacion: null, aviso, procedencia: procedencia([], '', aviso) };
  }
  const formacion = delMotor.formacion;
  const sinFormacion = 'El paquete de esta instalación no trae la formación oficial.';
  if (!formacion) {
    return { formacion: null, aviso: sinFormacion, procedencia: procedencia([], '', sinFormacion) };
  }
  const especialidades = acotada(formacion.especialidades, TOPES.especialidades);
  const cursos = acotada(formacion.cursos, TOPES.cursos);
  const ediciones = formacion.consorci ? acotada(formacion.consorci.ediciones, TOPES.ediciones) : null;
  const licencia = licenciasDeLaFormacion(datos);
  const fuentes = formacion.fuentes.map((cita) => oficial(cita, licencia(cita)));
  return {
    nivel: formacion.nivel ?? 'ocupacion',
    especialidades: { total: formacion.totalEspecialidades, mostradas: especialidades.elementos },
    cursos: {
      total: cursos.total,
      fechaCopia: formacion.fechaCursos,
      copiaAntigua: formacion.copiaAntigua,
      mostrados: cursos.elementos,
    },
    consorci:
      formacion.consorci && ediciones
        ? {
            total: ediciones.total,
            fechaCopia: formacion.consorci.fechaCopia,
            buscador: formacion.consorci.buscador,
            mostradas: ediciones.elementos,
          }
        : null,
    procedencia: procedencia(
      fuentes,
      'Las especialidades y su relación con la ocupación son del SEPE; los cursos, del SOC; las ediciones, del Consorci per a la Formació Contínua. Las fechas son las de la copia.',
      'Las especialidades marcadas como «sugerencia» y el orden por parecido son de Faro. Antes de inscribirse, hay que confirmar plazas y fechas con la entidad.',
    ),
  };
}

/**
 * La acreditación de competencias: certificados de profesionalidad relacionados y cómo pedirla en Cataluña.
 *
 * @param ambito - El ámbito de la consulta (sus datos y la fecha de hoy).
 * @param isco - El código del grupo.
 * @param esco - El código de la ocupación ESCO, si se eligió.
 * @returns La acreditación y su procedencia, o un aviso si el paquete no la trae.
 */
export function acreditacionDeCompetencias(ambito: AmbitoConsulta, isco: string, esco?: string): Consulta {
  const { datos, hoy } = ambito;
  const bloque = bloqueDeAcreditacion(datos, ocupacionDe(datos, isco, esco), hoy);
  const sinBloque = 'El paquete de esta instalación no trae la acreditación de competencias.';
  if (!bloque) {
    return { acreditacion: null, aviso: sinBloque, procedencia: procedencia([], '', sinBloque) };
  }
  const certificados = acotada(bloque.certificados, TOPES.certificados);
  const { certificados: _todos, ...resto } = bloque;
  return {
    ...resto,
    certificados: { total: certificados.total, mostrados: certificados.elementos },
    procedencia: procedencia(
      [oficial(bloque.fuente, LICENCIAS.acreditacion)],
      `Los certificados y las ocupaciones que les relaciona cada real decreto son del BOE; la convocatoria, de la Agència FP.CAT (comprobado el ${bloque.comprobado}).`,
      'Faro relaciona la ocupación con los certificados; los del SEPE que Faro no ha comprobado van aparte, con su aviso. Los requisitos se confirman en el servicio de acreditación.',
    ),
  };
}

/**
 * El contexto del grupo en Cataluña: personas ocupadas, contratos, perfil, salario y uso declarado de la IA.
 *
 * @param ambito - El ámbito de la consulta (sus datos y la fecha de hoy).
 * @param isco - El código del grupo.
 * @param esco - El código de la ocupación ESCO, si se eligió.
 * @returns El contexto con su procedencia.
 */
export function contextoDelGrupo(ambito: AmbitoConsulta, isco: string, esco?: string): Consulta {
  const { datos } = ambito;
  const ocupacion = ocupacionDe(datos, isco, esco);
  const lengua = crearLengua(datos);
  const contexto = contextoCataluna(datos, ocupacion.esco, ocupacion.isco08, lengua);
  const usoDeclaradoIa = usoDeclaradoDeLaIa(datos, ocupacion.isco08, lengua);
  const citas = citasDelGrupo(datos, { contexto, usoDeclaradoIa }, lengua);
  const citasIdescat = new Set([datos.ocupados?.fuentes.idescat, datos.tich?.motivos_no_uso.fuente]);
  const fuentes = citas.map((cita) => oficial(cita, citasIdescat.has(cita) ? LICENCIAS.idescat : LICENCIAS.ine));
  if (datos.cataluna) {
    fuentes.push(oficial(datos.cataluna.fuentes.censo, LICENCIAS.ine));
    fuentes.push(oficial(datos.cataluna.fuentes.observatori, LICENCIAS.observatori));
  }
  const { ocupados, contratacion, periodo, genero, zona, perfil, salario, avisoCenso, provincias } = contexto;
  return {
    ocupados,
    contratacion,
    periodo,
    genero,
    zona,
    perfil,
    salario,
    avisoCenso,
    provincias,
    usoDeclaradoIa,
    procedencia: procedencia(
      fuentes,
      'Las cifras son oficiales (INE, Idescat y Observatori del Treball), con su año; describen el grupo de la estadística, que puede ser más amplio que la ocupación.',
      'Faro elige qué grupos de la estadística corresponden a la ocupación y no estima ninguna cifra; si una ocupación cae en varios grupos, salen todos.',
    ),
  };
}
