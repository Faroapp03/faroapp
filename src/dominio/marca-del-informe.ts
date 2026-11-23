// La marca legible por máquina de un informe (dominio/marca-ia.ts): qué campos escribió la IA y de dónde sale lo
// demás. Conserva la procedencia de la nota y frases de estimaciones aportadas, las frases de las tareas oficiales
// redactadas al preparar los datos y las traducciones usadas (las del paquete y las aportadas al constructor).
// Lo demás son datos oficiales, reglas y textos fijos de Faro, o lo que confirmó la
// persona. Se calcula sin IA a partir del informe ya hecho, así que nunca cambia lo que se ve.
// Todo campo del informe queda cubierto por alguna entrada de la marca (salvo la propia marca): un apartado entero o,
// dentro de él, un campo concreto. Si dos entradas cubren el mismo campo, manda la más concreta (dominio/marca-ia.ts):
// el apartado da el origen por defecto, y lo que escribió la persona o la IA dentro de él lleva el suyo.

import { IDIOMA_DE_LOS_DATOS, IDIOMA_POR_DEFECTO, type Idioma } from '../comun/idioma.ts';
import { textoDeTareaEn } from './datos-en-idioma.ts';
import { conIaDe, conIaDelPaquete, type FragmentoConIa, type MarcaIa, marcaIa, type OrigenSinIa } from './marca-ia.ts';
import { esRedaccionManual } from './tareas.ts';
import type { TareaEntrada } from './tipos-entrada.ts';
import type { Informe, TareaInforme } from './tipos-informe.ts';
import type { Datos } from './tipos-paquete.ts';

/**
 * De dónde sale cada apartado del informe hecho sin IA. Solo se apuntan los que lleva el informe. La versión, la fecha,
 * el idioma y la marca de informe hecho sin IA los pone Faro. La formación abierta es una selección de Faro con su
 * criterio publicado, no un dato oficial. El tipo exige un origen para cada apartado de Informe salvo las tareas (van
 * campo a campo, CAMPOS_SIN_IA y marcaDeLaTarea) y la propia marca: un apartado nuevo o renombrado no compila sin él.
 */
const APARTADOS_SIN_IA: Readonly<Record<Exclude<keyof Informe, 'tareas' | 'marcaIa'>, OrigenSinIa>> = {
  version: 'reglas-de-faro',
  idioma: 'reglas-de-faro',
  fecha: 'reglas-de-faro',
  sinIa: 'reglas-de-faro',
  ocupacion: 'datos-oficiales',
  semana: 'reglas-de-faro',
  hallazgos: 'reglas-de-faro',
  contexto: 'datos-oficiales',
  fichaBarcelonaActiva: 'datos-oficiales',
  caminos: 'reglas-de-faro',
  formacion: 'datos-oficiales',
  formacionTransversal: 'datos-oficiales',
  usoDeclaradoIa: 'datos-oficiales',
  necesidades: 'datos-oficiales',
  acreditacion: 'datos-oficiales',
  citilab: 'datos-oficiales',
  formacionAbierta: 'reglas-de-faro',
  aprendizaje: 'datos-oficiales',
  plan: 'reglas-de-faro',
  fuentes: 'reglas-de-faro',
  limites: 'reglas-de-faro',
  avisos: 'reglas-de-faro',
  sinTraducir: 'datos-oficiales',
  formacionNoDisponible: 'reglas-de-faro',
};

/**
 * Dentro de las tareas y de los apartados, lo que no es del origen del conjunto: el reparto, la franja y el resto de
 * cada tarea los calculan las reglas de Faro; la tarea oficial y las competencias son de ESCO y de la OIT; el texto y
 * el tiempo, de la persona. La nota, su margen y sus frases van tarea a tarea (marcaDeLaTarea).
 */
const CAMPOS_SIN_IA: Record<string, OrigenSinIa> = {
  '/tareas/*': 'reglas-de-faro',
  '/tareas/*/nombre': 'persona',
  '/tareas/*/texto': 'persona',
  '/tareas/*/tiempo': 'persona',
  '/tareas/*/referencia': 'datos-oficiales',
  '/tareas/*/competencias': 'datos-oficiales',
  '/aprendizaje/objetivos': 'reglas-de-faro',
  '/aprendizaje/objetivos/*/tarea/texto': 'persona',
};

/**
 * Cómo confirmó la persona su ocupación, si el informe lo dice: la frase la escriben las reglas de Faro y la palabra
 * con que nombra su trabajo es suya.
 */
function marcaDeLaConfirmacion(confirmada: Informe['ocupacion']['confirmada']): Record<string, OrigenSinIa> {
  if (!confirmada) {
    return {};
  }
  const palabra: Record<string, OrigenSinIa> =
    confirmada.palabra === null ? {} : { '/ocupacion/confirmada/palabra': 'persona' };
  return { '/ocupacion/confirmada': 'reglas-de-faro', ...palabra };
}

/** Contexto interno de la marca, con los originales identificados por el ID único y estable de cada tarea. */
export interface ContextoTraduccionesMarca {
  /** Original → traducción aportada al construir el informe. */
  frasesTraducidas?: ReadonlyMap<string, string>;
  /** Entrada preparada con que se construyó el informe; su orden puede diferir del informe. */
  tareasOriginales?: ReadonlyMap<string, TareaEntrada>;
}

/** Lo que necesita la marca para saber quién escribió cada frase. */
interface AmbitoDeLaMarca {
  datos: Datos;
  idioma: Idioma;
  /** Las traducciones aportadas a este informe: original → traducción. */
  frasesTraducidas: ReadonlyMap<string, string>;
  tareasOriginales: ReadonlyMap<string, TareaEntrada>;
}

/** Las frases de una estimación aportada y las traducciones aplicadas; su autor y modelo no constan. */
function frasesEstimadas(tarea: TareaInforme, ruta: string, ambito: AmbitoDeLaMarca): FragmentoConIa[] {
  const { idioma, frasesTraducidas, tareasOriginales } = ambito;
  return (['iaPodria', 'loTuyo'] as const).flatMap((campo) => {
    const texto = tarea[campo];
    if (texto === null) {
      return [];
    }
    const redactado = conIaDe(`${ruta}/${campo}`, 'redactado');
    const original = tareasOriginales.get(tarea.id)?.estimacion?.[campo];
    const traducida =
      idioma !== IDIOMA_DE_LOS_DATOS && original !== undefined && frasesTraducidas.get(original) === texto;
    return traducida ? [redactado, conIaDe(`${ruta}/${campo}`, 'traducido')] : [redactado];
  });
}

/**
 * Las frases de una tarea oficial: redactadas con IA al preparar los datos (salvo la redacción manual) y, en otro
 * idioma, traducidas con IA en el paquete o mediante una traducción aportada al constructor.
 */
function frasesOficiales(tarea: TareaInforme, ruta: string, ambito: AmbitoDeLaMarca): FragmentoConIa[] {
  const { datos, idioma, frasesTraducidas } = ambito;
  const tareaOit = tarea.referencia?.tareaOit ?? '';
  const manual = esRedaccionManual(datos.textos.tareas[tareaOit]?.estado);
  const campos = [
    ['iaPodria', 'ia_podria'],
    ['loTuyo', 'lo_tuyo'],
  ] as const;
  return campos.flatMap(([campo, enDatos]) => {
    const texto = tarea[campo];
    if (texto === null) {
      return [];
    }
    const redactado = manual ? [] : [conIaDelPaquete(`${ruta}/${campo}`, 'redactado')];
    if (idioma === IDIOMA_DE_LOS_DATOS) {
      return redactado;
    }
    const original = textoDeTareaEn(datos, tareaOit, enDatos, idioma);
    if (original?.idioma === idioma) {
      return [...redactado, conIaDelPaquete(`${ruta}/${campo}`, 'traducido')];
    }
    const traducida = original !== null && frasesTraducidas.get(original.texto) === texto;
    return traducida ? [...redactado, conIaDe(`${ruta}/${campo}`, 'traducido')] : redactado;
  });
}

/** Lo que la IA escribió en una tarea y lo que no: la nota estimada o la publicada, y sus frases. */
function marcaDeLaTarea(
  tarea: TareaInforme,
  indice: number,
  ambito: AmbitoDeLaMarca,
): { conIa: FragmentoConIa[]; sinIa: Record<string, OrigenSinIa> } {
  const ruta = `/tareas/${indice}`;
  const sinIa: Record<string, OrigenSinIa> = {};
  // Una nota de ejemplo y sus frases vienen escritas en el caso de la página de ejemplo: no las escribió la IA.
  if (tarea.ejemplo) {
    return { conIa: [], sinIa };
  }
  if (tarea.evidencia === 'estimacion-faro') {
    sinIa[`${ruta}/margen`] = 'reglas-de-faro';
    const conIa = [conIaDe(`${ruta}/valor`, 'estimado'), ...frasesEstimadas(tarea, ruta, ambito)];
    return { conIa, sinIa };
  }
  if (tarea.evidencia !== 'estimacion-oit') {
    return { conIa: [], sinIa };
  }
  sinIa[`${ruta}/valor`] = 'datos-oficiales';
  sinIa[`${ruta}/margen`] = 'datos-oficiales';
  return { conIa: frasesOficiales(tarea, ruta, ambito), sinIa };
}

/**
 * La marca de un informe. Los campos generados con autor desconocido quedan sin modo ni modelo.
 * `traducciones` conserva los originales de cada campo para atribuir solo las traducciones usadas en el informe.
 *
 * @param informe - El informe ya hecho, sin su marca.
 * @param datos - Paquete de datos con que se hizo.
 * @param traducciones - Traducciones por original y tareas de la entrada preparada por ID.
 * @returns La marca: los campos que escribió la IA y el origen de todos los demás.
 */
export function marcaDelInforme(
  informe: Omit<Informe, 'marcaIa'>,
  datos: Datos,
  traducciones: ContextoTraduccionesMarca = {},
): MarcaIa {
  const idioma: Idioma = informe.idioma ?? IDIOMA_POR_DEFECTO;
  const ambito = {
    datos,
    idioma,
    frasesTraducidas: traducciones.frasesTraducidas ?? new Map(),
    tareasOriginales: traducciones.tareasOriginales ?? new Map(),
  };
  const conIa: FragmentoConIa[] = [];
  const sinIa: Record<string, OrigenSinIa> = {
    ...CAMPOS_SIN_IA,
    ...marcaDeLaConfirmacion(informe.ocupacion.confirmada),
  };
  if (informe.ocupacion.confirmada?.propuestoPorIa) {
    conIa.push(conIaDe('/ocupacion/isco08', 'propuesto'));
  }
  for (const [indice, tarea] of informe.tareas.entries()) {
    const deLaTarea = marcaDeLaTarea(tarea, indice, ambito);
    conIa.push(...deLaTarea.conIa);
    Object.assign(sinIa, deLaTarea.sinIa);
  }
  for (const [apartado, origen] of Object.entries(APARTADOS_SIN_IA)) {
    if (apartado in informe) {
      sinIa[`/${apartado}`] = origen;
    }
  }
  return marcaIa(conIa, sinIa);
}
