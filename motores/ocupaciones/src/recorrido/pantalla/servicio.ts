// Servicio de pantalla: interpreta el texto, calcula la siguiente pregunta, permite búsqueda manual
// y recorre las familias CNO-11 con los datos del dispositivo.

import type { Idioma } from '../../../../../src/comun/idioma.ts';
import { normalizar } from '../../../../../src/comun/texto.ts';
import { textoDeTareaEn, tituloCnoEn, tituloEscoEn, tituloIscoEn } from '../../../../../src/dominio/datos-en-idioma.ts';
import { ocupacionesDelGrupo } from '../../../../../src/dominio/grupos.ts';
import type { Datos } from '../../../../../src/dominio/tipos-paquete.ts';
import { MAX_BUSQUEDA, MAX_RELATO } from '../../../../../src/seguridad/limites.ts';
import { limpiarDatosPersonales } from '../../../../../src/seguridad/privacidad.ts';
import { textoParaBuscar } from '../../../../../src/seguridad/texto-para-buscar.ts';
import { buscarConContexto, type ResultadoDeBusqueda } from '../../busqueda/analisis.ts';
import type { Area } from '../../busqueda/area.ts';
import { DENOMINACIONES_DE_DICCIONARIO } from '../../busqueda/denominaciones-de-diccionario.ts';
import { palabrasDe } from '../../busqueda/palabras.ts';
import sectores from '../../busqueda/sectores.json' with { type: 'json' };
import { siguientePasoConPropuestas } from '../preguntas/motor.ts';
import { generoDeTexto, tituloEnGenero } from '../preguntas/ocupaciones.ts';
import { PROPUESTA } from '../preguntas/textos.ts';
import type {
  AreaDeTexto,
  Atributos,
  CandidataBusqueda,
  Configuracion,
  Hipotesis,
  OcupacionProbable,
  Opcion,
  Paso,
  Pregunta,
  PreviaExplicita,
  Respuesta,
} from '../preguntas/tipos.ts';
import { quitarCortesia, type TipoDeCortesia } from './cortesia.ts';
import { previaCalibrada } from './previa-fusion.ts';
import {
  aparece,
  formasDeLaTarea,
  formasDelRelato,
  type SimilitudDeTareas,
  similitudLexica,
  type TareaComparable,
} from './tareas.ts';

/** Un texto en los dos idiomas de la web; en catalán, el castellano si Faro aún no lo tiene traducido. */
export interface Versiones {
  readonly es: string;
  readonly ca: string;
}

/** Candidatas del buscador que se piden: las que caben en «Prefiero buscarla yo» y dan base al motor de preguntas. */
const LIMITE_CANDIDATAS = 12;
/** Tareas típicas que acompañan a un grupo en las listas (familias, búsqueda a mano). */
const TAREAS_DE_MUESTRA = 2;
/**
 * Parecido mínimo (suma de IDF, tareas.ts) para dar una tarea por «la has contado» y premarcarla. Con una palabra rara
 * compartida basta; con solo palabras comunes del grupo, no.
 */
const UMBRAL_PREMARCAR = 1.2;
/** Parecido mínimo para proponer «Se parece a…» al enlazar una tarea escrita por la persona. */
const UMBRAL_ENLAZAR = 1.2;

// ---------------------------------------------------------------------------------------------------------------
// Textos de los datos en los dos idiomas

function versiones(dato: (idioma: Idioma) => string | null | undefined): Versiones {
  const es = dato('es') ?? '';
  return { es, ca: dato('ca') ?? es };
}

export function tituloGrupo(datos: Datos, isco08: string): Versiones {
  return versiones((idioma) => tituloIscoEn(datos, isco08, idioma)?.texto);
}

export function tituloOcupacion(datos: Datos, esco: string): Versiones {
  return datos.esco.ocupaciones[esco]
    ? versiones((idioma) => tituloEscoEn(datos, esco, idioma).texto)
    : { es: '', ca: '' };
}

function textoTarea(datos: Datos, id: string, campo: 'corto' | 'texto'): Versiones {
  return versiones((idioma) => textoDeTareaEn(datos, id, campo, idioma)?.texto);
}

// ---------------------------------------------------------------------------------------------------------------
// Tareas oficiales de un grupo

interface TareaDelGrupo {
  readonly id: string;
  readonly corto: Versiones;
  readonly texto: Versiones;
}

const tareasPorDatos = new WeakMap<Datos, Map<string, TareaDelGrupo[]>>();

/** Una tarea oficial con sus textos de Faro, o null si no tiene ninguno. */
function tareaConTextos(datos: Datos, id: string): TareaDelGrupo | null {
  const corto = textoTarea(datos, id, 'corto');
  const texto = textoTarea(datos, id, 'texto');
  if (!(corto.es || texto.es)) {
    return null;
  }
  return { id, corto: corto.es ? corto : texto, texto: texto.es ? texto : corto };
}

function indiceDeTareas(datos: Datos): Map<string, TareaDelGrupo[]> {
  const porGrupo = new Map<string, { indice: number; tarea: TareaDelGrupo }[]>();
  for (const [id, oficial] of Object.entries(datos.oit.tareas)) {
    const tarea = tareaConTextos(datos, id);
    if (tarea) {
      porGrupo.set(oficial.isco08, [...(porGrupo.get(oficial.isco08) ?? []), { indice: oficial.indice, tarea }]);
    }
  }
  return new Map([...porGrupo].map(([g, l]) => [g, l.sort((a, b) => a.indice - b.indice).map((x) => x.tarea)]));
}

/** Las tareas oficiales de la OIT de cada grupo, en su orden oficial, con sus textos de Faro. */
export function tareasDelGrupo(datos: Datos, isco08: string): readonly TareaDelGrupo[] {
  let indice = tareasPorDatos.get(datos);
  if (!indice) {
    indice = indiceDeTareas(datos);
    tareasPorDatos.set(datos, indice);
  }
  return indice.get(isco08) ?? [];
}

// ---------------------------------------------------------------------------------------------------------------
// Entender el texto (léxico 1A)

/** El texto como lo busca el buscador: limpio de datos personales y recortado. */
export function textoDeBusqueda(texto: string): string {
  return textoParaBuscar(texto, { omitirCorchetes: true }).slice(0, MAX_BUSQUEDA);
}

/** El relato con que se comparan las tareas: limpio de datos personales y recortado a MAX_RELATO. */
function textoDelRelato(texto: string): string {
  return limpiarDatosPersonales(texto.slice(0, MAX_RELATO)).texto;
}

/** Palabras que acompañan a un sector sin cambiarlo («el sector de la hostelería», «el mundo del comercio»). */
const RELLENO_DE_SECTOR = new Set(['sector', 'ramo', 'mundo', 'rama', 'mon']);
/** Puntos (escala del buscador) del oficio más común del sector y lo que baja cada uno de los siguientes. */
const PUNTOS_DEL_SECTOR = 60;
const PASO_DEL_SECTOR = 4;
/** Oficios del sector en «¿Qué haces sobre todo en…?»: los más comunes; los demás quedan para «Otra cosa». */
const OFICIOS_EN_LA_PREGUNTA_DEL_SECTOR = 4;

/** Un sector escrito: la forma que usó la persona, sus oficios comunes y la frase de la pregunta. */
interface SectorEscrito {
  readonly forma: string;
  readonly ocupaciones: readonly string[];
  readonly frase: { readonly es: string; readonly ca: string };
}

/** Cada forma de sector, en palabras normalizadas, con su forma escrita, sus oficios comunes y su frase. */
const FORMAS_DE_SECTOR = new Map<string, SectorEscrito>();
for (const s of sectores.sectores) {
  for (const forma of s.formas) {
    const clave = palabrasDe(forma).join(' ');
    // La primera forma de la tabla gana: es la escrita con tilde («hostelería», no «hosteleria»).
    if (!FORMAS_DE_SECTOR.has(clave)) {
      FORMAS_DE_SECTOR.set(clave, { forma, ocupaciones: s.ocupaciones, frase: s.frase });
    }
  }
}

/** El sector que nombra el texto si no dice nada más («hostelería», «trabajo en limpieza»), o null. */
function sectorSolo(texto: string): SectorEscrito | null {
  const frase = palabrasDe(textoDeBusqueda(texto))
    .filter((p) => !RELLENO_DE_SECTOR.has(p))
    .join(' ');
  return frase ? (FORMAS_DE_SECTOR.get(frase) ?? null) : null;
}

/** La búsqueda de un sector solo: sus oficios comunes, en orden, en vez de los títulos que contienen la palabra. */
function conOficiosDelSector(datos: Datos, busqueda: ResultadoDeBusqueda, sector: SectorEscrito): ResultadoDeBusqueda {
  const { area: _area, necesitaPrecision: _precision, ...resto } = busqueda;
  const candidatas = sector.ocupaciones.flatMap((esco, i) => {
    const o = datos.esco.ocupaciones[esco];
    return o
      ? [
          {
            esco,
            titulo: o.titulo,
            isco08: o.isco08,
            tituloIsco: '',
            descripcion: '',
            puntos: PUNTOS_DEL_SECTOR - PASO_DEL_SECTOR * i,
            cno11: [],
          },
        ]
      : [];
  });
  return { ...resto, candidatas, soloSector: sector.forma, fraseDelSector: sector.frase };
}

export function buscar(datos: Datos, texto: string, idioma: Idioma): ResultadoDeBusqueda {
  const busqueda = buscarConContexto(datos, textoDeBusqueda(texto), { idioma, limite: LIMITE_CANDIDATAS });
  const sector = sectorSolo(texto);
  return sector ? conOficiosDelSector(datos, busqueda, sector) : busqueda;
}

// ---------------------------------------------------------------------------------------------------------------
// Previa: de la búsqueda a las candidatas del motor de preguntas

/** Lo que el motor de preguntas recibe de la previa. */
interface EntradaPrevia {
  readonly candidatas: readonly CandidataBusqueda[];
  readonly configuracion?: Partial<Configuracion>;
  /** La previa explícita de la fusión calibrada (previa-fusion.ts): el motor la usa tal cual. */
  readonly previa?: PreviaExplicita;
  /** Los grupos del clasificador para completar la última lista (Entrada.reserva). */
  readonly reserva?: readonly string[];
  /** Si la reserva completa también las alternativas (Entrada.reservaEnAlternativas). */
  readonly reservaEnAlternativas?: boolean;
}

/**
 * Distribución inicial del motor de preguntas. Combina la búsqueda léxica con las señales disponibles
 * mediante una firma común: puede añadir CandidataBusqueda.extra o devolver otra lista de candidatas.
 */
export type Previa = (datos: Datos, busqueda: ResultadoDeBusqueda, contexto: ContextoDePrevia) => EntradaPrevia;

/** Lo que la previa sabe además de la búsqueda: lo escrito, el idioma y el contexto del recorrido. */
export interface ContextoDePrevia {
  readonly texto: string;
  readonly idioma: Idioma;
  /** Los atributos del motor de preguntas (ocupados de cada grupo en Cataluña, para la fusión). */
  readonly atributos?: Atributos;
  /**
   * Lo que la persona ha contado con sus palabras durante las preguntas («Lo cuento con mis palabras») o al aclarar: ya
   * va dentro de `texto`, y además sus tareas dan pistas de grupo (tareasContadas).
   */
  readonly anadido?: string;
  /**
   * Si la persona ya ha dicho «No» a una propuesta. Desde entonces no se propone sin preguntar: la propuesta directa
   * (previa-fusion.ts) vale solo hasta el primer «No».
   */
  readonly rechazada?: boolean;
  /**
   * Si la persona ya ha respondido algo. La primera pantalla se decide sin el suelo del clasificador; desde
   * la primera respuesta, con él (previa-fusion.ts, conSueloDelClasificador).
   */
  readonly conRespuestas?: boolean;
}

/** Grupos que se proponen por las tareas contadas cuando el nombre del puesto no da ninguno. */
const GRUPOS_POR_TAREAS = 8;
/** Puntos (escala del buscador) por cada unidad de parecido con las tareas de un grupo, y su tope. */
const PUNTOS_POR_PARECIDO = 12;
const MAX_PUNTOS_POR_TAREAS = 60;
/** Palabras mínimas de un relato para buscar también por tareas («archivo papeles y contesto el teléfono»). */
const MIN_PALABRAS_RELATO = 3;

const formasPorDatos = new WeakMap<Datos, { grupo: string; formas: string[] }[]>();

/**
 * Relato sin modelo de lenguaje: los grupos cuyas tareas oficiales se parecen a lo contado. Para cada grupo, el
 * mejor parecido de una de sus tareas (palabras compartidas ponderadas por su rareza entre todas las tareas).
 */
export function gruposPorTareas(datos: Datos, texto: string): { grupo: string; parecido: number }[] {
  const delRelato = formasDelRelato(textoDelRelato(texto));
  if (delRelato.length < MIN_PALABRAS_RELATO) {
    return [];
  }
  let indice = formasPorDatos.get(datos);
  if (!indice) {
    indice = Object.keys(datos.clasificaciones.isco08_es).flatMap((grupo) =>
      comparables(tareasDelGrupo(datos, grupo)).map((t) => ({ grupo, formas: formasDeLaTarea(t) })),
    );
    formasPorDatos.set(datos, indice);
  }
  const tareas = indice;
  const idf = delRelato.map((formas) => {
    const con = tareas.filter((t) => aparece(formas, t.formas)).length;
    return con === 0 ? 0 : Math.log(1 + tareas.length / con);
  });
  const mejor = new Map<string, number>();
  for (const t of tareas) {
    const p = delRelato.reduce((s, formas, i) => s + (aparece(formas, t.formas) ? (idf[i] ?? 0) : 0), 0);
    if (p > (mejor.get(t.grupo) ?? 0)) {
      mejor.set(t.grupo, p);
    }
  }
  return [...mejor]
    .map(([grupo, parecido]) => ({ grupo, parecido }))
    .sort((a, b) => b.parecido - a.parecido || (a.grupo < b.grupo ? -1 : 1))
    .slice(0, GRUPOS_POR_TAREAS);
}

/** Puntos sobre la 1.ª candidata del buscador que recibe el grupo cuyas tareas más se parecen a lo contado. */
const VENTAJA_TAREAS_CONTADAS = 12;
/** Lo rápido que baja esa ventaja para los grupos que se parecen menos (por unidad de parecido). */
const CAIDA_TAREAS_CONTADAS = 3;

/**
 * «Lo cuento con mis palabras»: las tareas contadas durante las preguntas pesan como pista de grupo además del nombre
 * del puesto. El grupo cuyas tareas más se parecen queda por encima de la 1.ª candidata del buscador
 * (VENTAJA_TAREAS_CONTADAS) y los demás, menos cuanto menos se parecen. Las respuestas ya dadas se conservan: el motor
 * las vuelve a aplicar sobre esta nueva partida.
 */
function sumarTareasContadas(
  datos: Datos,
  candidatas: readonly CandidataBusqueda[],
  anadido: string,
): CandidataBusqueda[] {
  const grupos = gruposPorTareas(datos, anadido);
  const mejor = grupos[0]?.parecido ?? 0;
  if (!mejor) {
    return [...candidatas];
  }
  const base = Math.max(0, ...candidatas.map((c) => c.puntos));
  const ventaja = new Map(
    grupos.map(({ grupo, parecido }) => [
      grupo,
      base + VENTAJA_TAREAS_CONTADAS * Math.exp(-CAIDA_TAREAS_CONTADAS * (mejor - parecido)),
    ]),
  );
  const subidas = candidatas.map((c) => ({ ...c, puntos: Math.max(c.puntos, ventaja.get(c.isco08) ?? 0) }));
  const nuevas = [...ventaja]
    .filter(([grupo]) => !candidatas.some((c) => c.isco08 === grupo))
    .map(([isco08, puntos]) => ({ isco08, puntos }));
  return [...subidas, ...nuevas];
}

/**
 * Candidatas del léxico y, si el nombre del puesto no da ninguna, grupos cuyas tareas se parecen a lo contado.
 */
export const previaLexica: Previa = (datos, busqueda, { texto, anadido }) => {
  const candidatas: CandidataBusqueda[] = busqueda.candidatas.map((c) => {
    const ca = tituloOcupacion(datos, c.esco).ca;
    return { esco: c.esco, isco08: c.isco08, puntos: c.puntos, titulo: c.titulo, ...(ca ? { tituloCa: ca } : {}) };
  });
  if (candidatas.length === 0) {
    for (const { grupo, parecido } of gruposPorTareas(datos, texto)) {
      candidatas.push({ isco08: grupo, puntos: Math.min(MAX_PUNTOS_POR_TAREAS, PUNTOS_POR_PARECIDO * parecido) });
    }
  }
  const conTareas = sumarTareasContadas(datos, candidatas, anadido ?? '');
  return { candidatas: conTareas };
};

// ---------------------------------------------------------------------------------------------------------------
// El paso: pregunta o resultado

export interface Lectura {
  /** Lo que el buscador ha leído como lugar de trabajo («en la generalitat»). */
  readonly lugar?: string;
  readonly sectores: readonly string[];
  readonly correcciones: readonly { readonly de: string; readonly a: string }[];
  readonly necesitaPrecision?: string;
  /** Si el buscador no ha encontrado nada parecido. */
  readonly sinCandidatas: boolean;
  /**
   * Faro no ha entendido el texto: ni el buscador (sin candidatas, o `sinComprension` de 1A) ni las tareas contadas dan
   * por dónde empezar. La pantalla no pasa a preguntas generales: pide que se cuente un día normal.
   */
  readonly sinComprension: boolean;
  /**
   * Si la tabla de vectores y el clasificador de fragmentos estaban cargados al calcular el paso (una frase concreta
   * puede no usarlos: textoParaVectores en previa-fusion.ts). Los pone la ruta del dispositivo (ruta-local.ts, con
   * estadoDeLaIa de previa-fusion.ts); con alguno a falso, la pantalla lo avisa.
   */
  readonly conVectores?: boolean;
  readonly conClasificador?: boolean;
  /**
   * Lo escrito era solo cortesía: un saludo, «¿qué tal?», «gracias», «adiós» o una pregunta sobre Faro (cortesia.ts).
   * La pantalla responde con amabilidad en la entrada y no gasta la aclaración. Con algo más, la cortesía se quita
   * antes
   * de buscar y este campo no va.
   */
  readonly cortesia?: readonly TipoDeCortesia[];
}

interface HipotesisEnIdiomas {
  readonly grupo: string;
  readonly confianza: number;
  readonly tituloGrupo: Versiones;
  readonly ocupacion?: { readonly esco: string; readonly titulo: Versiones };
}

/** Una alternativa visible bajo la propuesta: `id` es lo que se responde al elegirla (contrato 1B: `alt:<grupo>:<esco>`). */
interface AlternativaEnIdiomas {
  readonly id: string;
  readonly hipotesis: HipotesisEnIdiomas;
}

/**
 * El paso que pinta la pantalla. Faro no afirma: propone y la persona confirma (patrón de Akinator).
 * - `pregunta`: una pregunta cerrada del motor de 1B.
 * - `propuesta`: «¿Es esta tu ocupación?», con las opciones del motor (Sí, es esta · Se parece, pero no · No) y 2
 *   alternativas elegibles. Con `local`, el motor ya no tenía nada que preguntar ni proponer (motivo «confianza» o
 *   «tope»): la pantalla decide sola con «Sí» (al resultado) y «No» (a las familias).
 * - `decidida`: la persona ha confirmado la propuesta, «se parece» (el grupo vale) o ha elegido una alternativa.
 * - `no_encontrada`: ha rechazado todas las propuestas: la pantalla abre «No encuentro la mía».
 */
export type PasoDePantalla =
  | {
      readonly tipo: 'pregunta';
      readonly pregunta: Pregunta;
      readonly numero: number;
      readonly maximo: number;
    }
  | {
      readonly tipo: 'propuesta';
      readonly id: string;
      readonly local: boolean;
      readonly mejor: HipotesisEnIdiomas;
      readonly opciones: readonly Opcion[];
      readonly alternativas: readonly AlternativaEnIdiomas[];
      /** Número de esta propuesta (1, 2…) y tope de propuestas. */
      readonly numero: number;
      readonly maximo: number;
      readonly preguntasHechas: number;
    }
  | {
      readonly tipo: 'decidida';
      readonly grupo: string;
      readonly esco?: string;
      /** «Se parece, pero no»: el grupo vale y la ocupación no. */
      readonly soloGrupo: boolean;
      readonly preguntasHechas: number;
    }
  | { readonly tipo: 'no_encontrada'; readonly preguntasHechas: number };

interface PeticionDePaso {
  readonly texto: string;
  readonly idioma: Idioma;
  /** Todas las respuestas, también las de las propuestas (el motor de 1B no guarda estado). */
  readonly respuestas: readonly Respuesta[];
  /** Lo que ha añadido con sus palabras durante las preguntas (ya va también dentro de `texto`). */
  readonly anadido?: string;
}

function enIdiomas(datos: Datos, h: Hipotesis, ocupaciones: readonly OcupacionProbable[] = []): HipotesisEnIdiomas {
  // La ocupación: la más probable del grupo tras las respuestas (incluida «¿Cuál de estos es tu puesto?»).
  const esco = h.ocupacion?.esco ?? ocupaciones.find((o) => o.grupo === h.grupo)?.esco;
  return {
    grupo: h.grupo,
    confianza: h.confianza,
    tituloGrupo: tituloGrupo(datos, h.grupo),
    ...(esco && datos.esco.ocupaciones[esco] ? { ocupacion: { esco, titulo: tituloOcupacion(datos, esco) } } : {}),
  };
}

/**
 * Si no se ha entendido nada: el buscador dice que no ha entendido el oficio (`sinComprension` de 1A) o no da ninguna
 * candidata, y tampoco hay tareas contadas que den por dónde empezar (`sinTareas`).
 */
function sinComprension(busqueda: ResultadoDeBusqueda, sinTareas: boolean): boolean {
  const dicho = (busqueda as ResultadoDeBusqueda & { sinComprension?: boolean }).sinComprension === true;
  return (dicho || busqueda.candidatas.length === 0) && sinTareas;
}

export function lectura(busqueda: ResultadoDeBusqueda, sinTareas = true): Lectura {
  return {
    ...(busqueda.lugar ? { lugar: busqueda.lugar } : {}),
    sectores: [...new Set(busqueda.pistasDeSector.map((p) => p.sector))],
    correcciones: busqueda.correcciones ?? [],
    ...(busqueda.necesitaPrecision ? { necesitaPrecision: busqueda.necesitaPrecision } : {}),
    sinCandidatas: busqueda.candidatas.length === 0,
    sinComprension: sinComprension(busqueda, sinTareas),
  };
}

/** Las opciones de la propuesta que decide la pantalla sola, con los textos de la propuesta de 1B. */
function opcionesLocales(idioma: Idioma): Opcion[] {
  return [
    { id: 'si', texto: PROPUESTA.si[idioma] },
    { id: 'no', texto: PROPUESTA.no[idioma] },
  ];
}

/**
 * Una propuesta con los títulos de sus ocupaciones en el género con que se expresa la persona: «cocinero» ve
 * «Cocinero» y no «cocinero/cocinera». Sin género claro, los títulos quedan como están.
 */
/** Un nombre sin el género de sus palabras: minúsculas, sin tildes y sin la vocal final («doctora» → «doctor»). */
function raizSinGenero(nombre: string): string {
  return normalizar(nombre)
    .split(' ')
    .map((p) => p.replace(/[aeo]$/, ''))
    .join(' ');
}

/** Cuántas palabras del nombre acaban en «a» (la del femenino: «doctora», «tendera»). */
function palabrasEnA(nombre: string): number {
  return normalizar(nombre)
    .split(' ')
    .filter((p) => p.endsWith('a')).length;
}

/**
 * Los pares masculino/femenino de una lista de nombres del diccionario («doctor» y «doctora» → «doctor/doctora»), en
 * la forma «masculino/femenino» que lee generoDeTexto. Los nombres sin pareja no se usan para el género.
 */
function paresDeGenero(nombres: readonly string[]): string[] {
  const pares: string[] = [];
  for (const [i, a] of nombres.entries()) {
    for (const b of nombres.slice(i + 1)) {
      if (raizSinGenero(a) === raizSinGenero(b) && palabrasEnA(a) !== palabrasEnA(b)) {
        pares.push(palabrasEnA(a) > palabrasEnA(b) ? `${b}/${a}` : `${a}/${b}`);
      }
    }
  }
  return pares;
}

function conGenero(paso: PasoDePantalla, texto: string): PasoDePantalla {
  if (paso.tipo !== 'propuesta') {
    return paso;
  }
  const hipotesis = [paso.mejor, ...paso.alternativas.map((a) => a.hipotesis)];
  // También los nombres de diccionario de cada ocupación («dependiente/dependienta» para la vendedora general), solo
  // en pares de género: la lista entera («médico/doctor/doctora/MIR») se leía como masculino/femenino y «doctor» salía
  // en femenino.
  const deDiccionario = (esco: string) => {
    const d = DENOMINACIONES_DE_DICCIONARIO.get(esco);
    return d ? [...paresDeGenero(d.es), ...paresDeGenero(d.ca)] : [];
  };
  const titulos = hipotesis.flatMap((h) =>
    h.ocupacion ? [h.ocupacion.titulo.es, h.ocupacion.titulo.ca, ...deDiccionario(h.ocupacion.esco)] : [],
  );
  const genero = generoDeTexto(texto, titulos);
  if (!genero) {
    return paso;
  }
  const enGenero = (h: HipotesisEnIdiomas): HipotesisEnIdiomas =>
    h.ocupacion
      ? {
          ...h,
          ocupacion: {
            ...h.ocupacion,
            titulo: {
              es: tituloEnGenero(h.ocupacion.titulo.es, genero, 'es'),
              ca: tituloEnGenero(h.ocupacion.titulo.ca, genero, 'ca'),
            },
          },
        }
      : h;
  return {
    ...paso,
    mejor: enGenero(paso.mejor),
    alternativas: paso.alternativas.map((a) => ({ ...a, hipotesis: enGenero(a.hipotesis) })),
  };
}

/**
 * Con tantas ocupaciones de primer nivel en ESCO (código «grupo.n»), un grupo es heterogéneo: ninguna lo representa.
 * Los conductores de 8322 son de furgón blindado, de reparto, de coche fúnebre, de ambulancia, chóferes…; ante
 * «chofer», «conductor de servicios de transporte de enfermos» no nombra el grupo. Mediana de los grupos: 3.
 */
const OCUPACIONES_DE_UN_GRUPO_HETEROGENEO = 4;

/** Cuántas ocupaciones de primer nivel tiene cada grupo CIUO-08, preparado una vez por paquete. */
const primerNivelPorDatos = new WeakMap<Datos, ReadonlyMap<string, number>>();

function ocupacionesDePrimerNivel(datos: Datos): ReadonlyMap<string, number> {
  const guardadas = primerNivelPorDatos.get(datos);
  if (guardadas) {
    return guardadas;
  }
  const cuantas = new Map<string, number>();
  for (const [codigo, { isco08 }] of Object.entries(datos.esco.ocupaciones)) {
    if (codigo.split('.').length === 2) {
      cuantas.set(isco08, (cuantas.get(isco08) ?? 0) + 1);
    }
  }
  primerNivelPorDatos.set(datos, cuantas);
  return cuantas;
}

/**
 * En «¿Cuál de estos es tu trabajo?», un grupo heterogéneo se nombra con su título oficial («Conductores de
 * automóviles,
 * taxis y camionetas») y no con una de sus ocupaciones, que engañaría («Profesor de equitación» ante «docente»).
 */
function conEtiquetasDeGrupo(paso: PasoDePantalla, datos: Datos, atributos: Atributos, idioma: Idioma): PasoDePantalla {
  if (paso.tipo !== 'pregunta' || paso.pregunta.tipo !== 'grupo') {
    return paso;
  }
  const cuantas = ocupacionesDePrimerNivel(datos);
  const opciones = paso.pregunta.opciones.map((o) => {
    const heterogeneo = (cuantas.get(o.id) ?? 0) >= OCUPACIONES_DE_UN_GRUPO_HETEROGENEO;
    const etiqueta = heterogeneo ? atributos.etiquetas4[o.id]?.[idioma] : undefined;
    return etiqueta ? { ...o, texto: etiqueta } : o;
  });
  return { ...paso, pregunta: { ...paso.pregunta, opciones } };
}

/** Del paso del motor de 1B al de la pantalla, con los títulos en los dos idiomas. */
function pasoEnIdiomas(datos: Datos, paso: Paso, idioma: Idioma): PasoDePantalla {
  switch (paso.tipo) {
    case 'pregunta':
      return { tipo: 'pregunta', pregunta: paso.pregunta, numero: paso.numero, maximo: paso.maximo };
    case 'propuesta':
      return {
        tipo: 'propuesta',
        id: paso.id,
        local: false,
        mejor: enIdiomas(datos, paso.propuesta),
        opciones: paso.opciones,
        alternativas: paso.alternativas.map((a) => ({ id: a.id, hipotesis: enIdiomas(datos, a.hipotesis) })),
        numero: paso.numero,
        maximo: paso.maximo,
        preguntasHechas: paso.preguntasHechas,
      };
    default:
      return pasoDeResultado(datos, paso, idioma);
  }
}

function pasoDeResultado(datos: Datos, paso: Extract<Paso, { tipo: 'resultado' }>, idioma: Idioma): PasoDePantalla {
  const { mejor, preguntasHechas } = paso;
  if (paso.motivo === 'confirmada' || paso.motivo === 'confirmada_grupo') {
    const soloGrupo = paso.motivo === 'confirmada_grupo';
    const esco = soloGrupo ? undefined : mejor.ocupacion?.esco;
    return { tipo: 'decidida', grupo: mejor.grupo, soloGrupo, preguntasHechas, ...(esco ? { esco } : {}) };
  }
  if (paso.motivo === 'no_encontrada' || !mejor.grupo) {
    return { tipo: 'no_encontrada', preguntasHechas };
  }
  // «confianza» o «tope»: la pantalla tampoco afirma; propone y decide ella con «Sí» y «No».
  return {
    tipo: 'propuesta',
    id: 'local',
    local: true,
    mejor: enIdiomas(datos, mejor, paso.ocupaciones),
    opciones: opcionesLocales(idioma),
    alternativas: paso.alternativas
      .filter((h) => h.grupo)
      .map((h) => ({
        id: `alt:${h.grupo}:${h.ocupacion?.esco ?? ''}`,
        hipotesis: enIdiomas(datos, h, paso.ocupaciones),
      })),
    numero: paso.rechazos + 1,
    maximo: paso.rechazos + 1,
    preguntasHechas,
  };
}

/** Preposiciones con que se dice dónde se trabaja: la frase del área ha de empezar por una. */
const PREPOSICIONES_DE_LUGAR = new Set(['en', 'a', 'al', 'con', 'amb']);
/** Lo que puede ir entre la preposición y el área: artículos y contracciones («en el», «a l'», «al», «en una»). */
const ANTES_DEL_AREA = new Set([
  ...PREPOSICIONES_DE_LUGAR,
  ...['el', 'la', 'los', 'las', 'lo', 'un', 'una', 'unos', 'unas', 'del', 'els', 'les', 'uns', 'unes', 'l'],
]);

/**
 * Cómo dijo la persona dónde trabaja, con su preposición y su artículo («en el puerto», «al port», «en un taller»),
 * para el enunciado: «¿Qué haces sobre todo en el puerto?» y no «… en puerto?». Va desde la preposición que precede al
 * área hasta su última palabra, tal como se escribió. Sin preposición delante («recursos humanos»), no hay frase y el
 * enunciado es el general.
 */
export function fraseDelArea(texto: string, area: Pick<Area, 'texto'>): string | undefined {
  const palabras = texto.trim().split(/\s+/u);
  const delArea = palabrasDe(area.texto);
  const inicio = palabras.findIndex((palabra) => partesDe(palabra).includes(delArea[0] ?? ''));
  if (inicio < 0) {
    return undefined;
  }
  const fin = finDelArea(palabras, inicio, delArea);
  let desde = inicio;
  while (desde > 0 && partesDe(palabras[desde - 1] ?? '').every((parte) => ANTES_DEL_AREA.has(parte))) {
    desde -= 1;
  }
  // «a l'hospital»: el artículo puede ir pegado a la palabra del área; cuenta la primera parte.
  if (!PREPOSICIONES_DE_LUGAR.has(partesDe(palabras[desde] ?? '')[0] ?? '')) {
    return undefined;
  }
  return palabras
    .slice(desde, fin + 1)
    .join(' ')
    .replace(/[.,;:!?…]+$/u, '')
    .toLocaleLowerCase();
}

/** Las partes normalizadas de una palabra escrita («l'hospital» → «l», «hospital»). */
function partesDe(palabra: string): string[] {
  return normalizar(palabra).split(' ');
}

/** Dónde acaba el área en lo escrito: la palabra con su última palabra, cerca del inicio («estación de tren»). */
function finDelArea(palabras: readonly string[], inicio: number, delArea: readonly string[]): number {
  const ultima = delArea.at(-1) ?? '';
  const hasta = Math.min(palabras.length, inicio + 2 * delArea.length);
  for (let i = inicio; i < hasta; i++) {
    if (partesDe(palabras[i] ?? '').includes(ultima)) {
      return i;
    }
  }
  return inicio;
}

/**
 * El área del buscador con el título de cada ocupación en los dos idiomas: la pregunta del área nombra cada opción con
 * ellos, para que una opción que junta varios grupos no se nombre con sus códigos («1411+1439»). Con la frase con
 * que la persona dijo dónde trabaja (fraseDelArea), en su idioma; en el otro, la general.
 */
function areaConTitulos(datos: Datos, area: Area, texto: string, idioma: Idioma): AreaDeTexto {
  const frase = fraseDelArea(texto, area);
  const deSiempre = { es: `en ${area.texto}`, ca: `a ${area.texto}` };
  return {
    ...area,
    ...(frase ? { frase: { ...deSiempre, [idioma]: frase } } : {}),
    ocupaciones: area.ocupaciones.map((o) => {
      const titulo = tituloOcupacion(datos, o.esco);
      return { ...o, titulo: titulo.es, tituloCa: titulo.ca };
    }),
  };
}

/**
 * El área de la pregunta «¿Qué haces sobre todo en…?» del motor (preguntaDeArea): la de un sector solo («hostelería»),
 * con sus oficios más comunes, o la del buscador («recursos humanos»), con los títulos de sus ocupaciones.
 */
function areaDelMotor(
  datos: Datos,
  busqueda: ResultadoDeBusqueda,
  texto: string,
  idioma: Idioma,
): { area?: AreaDeTexto } {
  if (busqueda.soloSector) {
    const ocupaciones = busqueda.candidatas.slice(0, OFICIOS_EN_LA_PREGUNTA_DEL_SECTOR).map((c) => ({
      esco: c.esco,
      isco08: c.isco08,
      titulo: c.titulo,
      tituloCa: tituloOcupacion(datos, c.esco).ca,
    }));
    return {
      area: {
        nombre: busqueda.soloSector,
        ...(busqueda.fraseDelSector ? { frase: busqueda.fraseDelSector } : {}),
        ocupaciones,
      },
    };
  }
  return busqueda.area ? { area: areaConTitulos(datos, busqueda.area, texto, idioma) } : {};
}

/**
 * La petición sin saludos ni cortesía (cortesia.ts): «hola, ¿cómo estás? corto verdura» se busca como «corto verdura».
 * Sin cortesía, la misma petición.
 */
function sinCortesia(peticion: PeticionDePaso): { peticion: PeticionDePaso; cortesia: readonly TipoDeCortesia[] } {
  const { texto, cortesia } = quitarCortesia(peticion.texto);
  if (cortesia.length === 0) {
    return { peticion, cortesia };
  }
  const anadido = peticion.anadido ? quitarCortesia(peticion.anadido).texto : '';
  const { anadido: _anadido, ...resto } = peticion;
  return { peticion: { ...resto, texto, ...(anadido ? { anadido } : {}) }, cortesia };
}

/** El paso cuando lo escrito es solo cortesía: nada que buscar; la pantalla responde en la entrada. */
function pasoDeCortesia(cortesia: readonly TipoDeCortesia[]): { lectura: Lectura; paso: PasoDePantalla } {
  return {
    lectura: { sectores: [], correcciones: [], sinCandidatas: true, sinComprension: true, cortesia },
    paso: { tipo: 'no_encontrada', preguntasHechas: 0 },
  };
}

/** El siguiente paso de la pantalla: una pregunta, una propuesta o la decisión, con los títulos en los dos idiomas. */
export function pasoDePantalla(
  datos: Datos,
  atributos: Atributos,
  peticionEscrita: PeticionDePaso,
  previa: Previa = previaCalibrada,
): { lectura: Lectura; paso: PasoDePantalla } {
  const { peticion, cortesia } = sinCortesia(peticionEscrita);
  // Sin letras tras quitar la cortesía, no se busca: «hola» o «¿quién eres?» no son un oficio.
  if (cortesia.length > 0 && !/[\p{L}\p{N}]/u.test(peticion.texto)) {
    return pasoDeCortesia(cortesia);
  }
  const busqueda = buscar(datos, peticion.texto, peticion.idioma);
  // «Lo cuento con mis palabras»: lo añadido ya va dentro de `texto`, así que la búsqueda y la fusión calibrada lo
  // usan.
  // Antes se cambiaba aquí a la previa léxica, y daba opciones absurdas («limpio casas particulares» → «Acarreadores de
  // agua | Trabajo social | Abogados»): la calibrada se queda siempre.
  const entrada = previa(datos, busqueda, {
    texto: peticion.texto,
    idioma: peticion.idioma,
    atributos,
    ...(peticion.anadido ? { anadido: peticion.anadido } : {}),
    ...(peticion.respuestas.some((r) => r.pregunta.startsWith('propuesta:') && r.opcion === 'no')
      ? { rechazada: true }
      : {}),
    ...(peticion.respuestas.length > 0 ? { conRespuestas: true } : {}),
  });
  const paso = siguientePasoConPropuestas(atributos, {
    candidatas: entrada.candidatas,
    idioma: peticion.idioma,
    // Lo escrito (con lo añadido), para que las opciones salgan en el género de la persona («maestra», no «maestro o
    // maestra»).
    texto: peticion.texto,
    respuestas: peticion.respuestas,
    pistas: busqueda.pistasDeSector,
    ...(busqueda.necesitaPrecision ? { necesitaPrecision: busqueda.necesitaPrecision } : {}),
    ...areaDelMotor(datos, busqueda, peticion.texto, peticion.idioma),
    ...(entrada.configuracion ? { configuracion: entrada.configuracion } : {}),
    ...(entrada.previa ? { previa: entrada.previa } : {}),
    ...(entrada.reserva ? { reserva: entrada.reserva } : {}),
    ...(entrada.reservaEnAlternativas ? { reservaEnAlternativas: true } : {}),
  });
  return {
    lectura: lectura(busqueda, gruposPorTareas(datos, peticion.texto).length === 0),
    paso: conEtiquetasDeGrupo(
      conGenero(pasoEnIdiomas(datos, paso, peticion.idioma), peticion.texto),
      datos,
      atributos,
      peticion.idioma,
    ),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// «Prefiero buscarla yo»: las ocupaciones del buscador

interface OcupacionEnLista {
  readonly esco: string;
  readonly titulo: Versiones;
  readonly grupo: string;
  readonly tituloGrupo: Versiones;
  readonly tareas: readonly Versiones[];
}

function muestraDeTareas(datos: Datos, isco08: string): Versiones[] {
  return tareasDelGrupo(datos, isco08)
    .slice(0, TAREAS_DE_MUESTRA)
    .map((t) => t.corto);
}

/** Las ocupaciones que el buscador encuentra para el texto, con su grupo y dos tareas de muestra. */
export function buscarAMano(datos: Datos, escrito: string, idioma: Idioma): OcupacionEnLista[] {
  // Sin saludos, como el paso (cortesia.ts): «hola, busco camarero» busca «busco camarero».
  const texto = quitarCortesia(escrito).texto;
  return buscar(datos, texto, idioma).candidatas.map((c) => ({
    esco: c.esco,
    titulo: tituloOcupacion(datos, c.esco),
    grupo: c.isco08,
    tituloGrupo: tituloGrupo(datos, c.isco08),
    tareas: muestraDeTareas(datos, c.isco08),
  }));
}

// ---------------------------------------------------------------------------------------------------------------
// «No encuentro la mía»: las 62 familias de la CNO-11 y sus grupos

export interface Familia {
  /** Subgrupo principal de la CNO-11 (2 cifras). */
  readonly codigo: string;
  /** Gran grupo de la CNO-11 (1 cifra). */
  readonly gran: string;
  /** Título oficial de la CNO-11 (en catalán, el de la CCO-2011 si lo hay). */
  readonly oficial: Versiones;
  /** Grupos CIUO-08 de 4 cifras con tareas de la OIT que caen en la familia. */
  readonly grupos: readonly string[];
}

const familiasPorDatos = new WeakMap<Datos, Familia[]>();
/** Cifras del subgrupo, el subgrupo principal y el gran grupo CIUO-08 con que se busca la correspondencia que falta. */
const SUBGRUPO = 3;
const SUBGRUPO_PRINCIPAL = 2;
const GRAN_GRUPO = 1;
const CIFRAS_DE_RESPALDO = [SUBGRUPO, SUBGRUPO_PRINCIPAL, GRAN_GRUPO] as const;

/**
 * Las familias de la CNO-11 de un grupo CIUO-08, por la correspondencia oficial del INE. Unos pocos grupos no tienen
 * correspondencia propia (p. ej. 3221, 6310): toman la de los grupos de su mismo subgrupo de 3 cifras o, si tampoco,
 * la de su subgrupo principal o su gran grupo (los 63xx, agricultura de subsistencia, que la CNO-11 no separa),
 * para que nadie se quede sin poder elegirlos.
 */
function familiasDelGrupo(datos: Datos, isco08: string): Set<string> {
  const correspondencia = datos.clasificaciones.isco08_a_cno11;
  const propias = correspondencia[isco08] ?? [];
  const delPrefijo = (cifras: number) =>
    Object.entries(correspondencia)
      .filter(([g]) => g !== isco08 && g.startsWith(isco08.slice(0, cifras)))
      .flatMap(([, e]) => e);
  const enlaces = [propias, ...CIFRAS_DE_RESPALDO.map(delPrefijo)].find((e) => e.length) ?? [];
  return new Set(enlaces.map(({ cno11 }) => cno11.slice(0, 2)));
}

/** El ejército (00) va al final de la lista. */
function ordenDeFamilia(codigo: string): string {
  return codigo === '00' ? '99z' : codigo;
}

/** Las familias (subgrupos principales de la CNO-11) con sus grupos CIUO-08, por la correspondencia oficial del INE. */
export function familias(datos: Datos): readonly Familia[] {
  const guardadas = familiasPorDatos.get(datos);
  if (guardadas) {
    return guardadas;
  }
  const porFamilia = new Map<string, Set<string>>();
  for (const isco08 of Object.keys(datos.clasificaciones.isco08_es)) {
    if (/^\d{4}$/.test(isco08) && tareasDelGrupo(datos, isco08).length > 0) {
      for (const familia of familiasDelGrupo(datos, isco08)) {
        porFamilia.set(familia, (porFamilia.get(familia) ?? new Set()).add(isco08));
      }
    }
  }
  const lista = Object.entries(datos.clasificaciones.cno11)
    .filter(([codigo, v]) => v.nivel === '2' && /^\d{2}$/.test(codigo))
    .map(([codigo, v]) => ({
      codigo,
      gran: v.padre,
      oficial: versiones((idioma) => tituloCnoEn(datos, codigo, idioma)?.texto),
      grupos: [...(porFamilia.get(codigo) ?? [])].sort(),
    }))
    .sort((a, b) => ordenDeFamilia(a.codigo).localeCompare(ordenDeFamilia(b.codigo)));
  familiasPorDatos.set(datos, lista);
  return lista;
}

interface GrupoEnLista {
  readonly isco08: string;
  readonly titulo: Versiones;
  readonly tareas: readonly Versiones[];
}

export function gruposDeFamilia(datos: Datos, codigo: string): GrupoEnLista[] {
  const familia = familias(datos).find((f) => f.codigo === codigo);
  return (familia?.grupos ?? [])
    .map((isco08) => ({ isco08, titulo: tituloGrupo(datos, isco08), tareas: muestraDeTareas(datos, isco08) }))
    .sort((a, b) => a.titulo.es.localeCompare(b.titulo.es, 'es'));
}

// ---------------------------------------------------------------------------------------------------------------
// Resultado: ocupación, tareas oficiales ordenadas por parecido y enlace de tareas propias

interface TareaDelResultado extends TareaDelGrupo {
  readonly parecido: number;
  /** Se parece a lo que la persona ha contado: va primero y marcada, para que la revise. */
  readonly premarcada: boolean;
}

export interface Resultado {
  readonly grupo: string;
  readonly tituloGrupo: Versiones;
  readonly ocupacion?: { readonly esco: string; readonly titulo: Versiones; readonly descripcion: string };
  /** Las ocupaciones ESCO del grupo, para «Se parece, pero no». */
  readonly ocupacionesDelGrupo: readonly { readonly esco: string; readonly titulo: Versiones }[];
  readonly tareas: readonly TareaDelResultado[];
}

function comparables(tareas: readonly TareaDelGrupo[]): TareaComparable[] {
  return tareas.map((t) => ({ id: t.id, textos: [t.corto.es, t.corto.ca, t.texto.es, t.texto.ca] }));
}

const REDONDEO = 100;

export function resultado(
  datos: Datos,
  peticion: {
    readonly grupo: string;
    readonly esco?: string;
    readonly texto: string;
    /** Tareas que la persona ha elegido al responder «¿Cuál de estas cosas haces más?»: van marcadas. */
    readonly elegidas?: readonly string[];
  },
  similitud: SimilitudDeTareas = similitudLexica,
): Resultado | null {
  const tareas = tareasDelGrupo(datos, peticion.grupo);
  if (!datos.clasificaciones.isco08_es[peticion.grupo] || tareas.length === 0) {
    return null;
  }
  const parecidos = similitud(textoDelRelato(peticion.texto), comparables(tareas));
  const ordenadas = tareas
    .map((t, i) => {
      const parecido = Math.round((parecidos[i] ?? 0) * REDONDEO) / REDONDEO;
      const elegida = peticion.elegidas?.includes(t.id) ?? false;
      return { ...t, parecido, premarcada: elegida || parecido >= UMBRAL_PREMARCAR, orden: i };
    })
    .sort((a, b) => Number(b.premarcada) - Number(a.premarcada) || b.parecido - a.parecido || a.orden - b.orden)
    .map(({ orden: _orden, ...t }) => t);
  const ocupacion = peticion.esco ? datos.esco.ocupaciones[peticion.esco] : undefined;
  return {
    grupo: peticion.grupo,
    tituloGrupo: tituloGrupo(datos, peticion.grupo),
    ...(ocupacion && peticion.esco && ocupacion.isco08 === peticion.grupo
      ? {
          ocupacion: {
            esco: peticion.esco,
            titulo: tituloOcupacion(datos, peticion.esco),
            descripcion: ocupacion.descripcion ?? '',
          },
        }
      : {}),
    ocupacionesDelGrupo: ocupacionesDelGrupo(datos, peticion.grupo).map((o) => ({
      esco: o.esco,
      titulo: tituloOcupacion(datos, o.esco),
    })),
    tareas: ordenadas,
  };
}

/** La tarea oficial del grupo más parecida a una que escribe la persona, si pasa el umbral; si no, null. */
export function enlazar(
  datos: Datos,
  peticion: { readonly grupo: string; readonly tarea: string },
  similitud: SimilitudDeTareas = similitudLexica,
): { readonly tarea: TareaDelGrupo; readonly parecido: number } | null {
  const tareas = tareasDelGrupo(datos, peticion.grupo);
  const parecidos = similitud(textoDelRelato(peticion.tarea), comparables(tareas));
  let mejor = -1;
  parecidos.forEach((p, i) => {
    if (p >= UMBRAL_ENLAZAR && (mejor < 0 || p > (parecidos[mejor] ?? 0))) {
      mejor = i;
    }
  });
  const tarea = tareas[mejor];
  return tarea ? { tarea, parecido: Math.round((parecidos[mejor] ?? 0) * REDONDEO) / REDONDEO } : null;
}
