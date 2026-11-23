// Cada tarea confirmada por la persona, convertida en tarea del informe: con su nota, su margen, su fuente y sus
// competencias. Ninguna tarea se descarta: sin nota ni estimación, aparece como información insuficiente.
// Sin ocupación ESCO, las competencias de una tarea oficial son las que ESCO liga a esa tarea en las
// ocupaciones de su grupo, sin relación con una ocupación concreta («sin-ocupacion»).

import { recortarEnPalabras } from '../comun/recorte.ts';
import { textoDeTareaEn } from './datos-en-idioma.ts';
import { EntradaInvalida } from './errores.ts';
import { franja, franjasDelMargen, PESOS } from './franjas.ts';
import { ocupacionesDelGrupo } from './grupos.ts';
import type { Lengua } from './lengua.ts';
import type { OcupacionConfirmada } from './ocupacion-confirmada.ts';
import type { TextosInforme } from './textos-informe.ts';
import type { Entrada, TareaEntrada } from './tipos-entrada.ts';
import type { Competencia, TareaInforme } from './tipos-informe.ts';
import type { Datos, DatosOit, EstadoTexto } from './tipos-paquete.ts';

/** Longitud máxima de la tarea oficial en inglés cuando se cita sin su texto corto en castellano. */
const MAX_CARACTERES_CITA = 80;

type Estimacion = NonNullable<TareaEntrada['estimacion']>;
type ReferenciaOit = NonNullable<TareaEntrada['referencia']>;
type TareaOitConNota = DatosOit['tareas'][string] & { nota: number };

/**
 * Lo que necesita cada tarea de su informe, además de la propia tarea: los datos, la ocupación, su lengua y si a Faro
 * le faltan referencias para estimar las tareas de su grupo (`sinReferencias`, en dominio/grupos.ts).
 */
export interface Ambito {
  datos: Datos;
  ocupacion: OcupacionConfirmada;
  lengua: Lengua;
  sinReferencias: boolean;
  /** Tareas cuya estimación numérica retiró la API para que el informe pueda continuar sin nota. */
  tareasSinEstimacion?: ReadonlySet<string>;
}

/** Lo común a toda tarea del informe, venga de donde venga su nota. */
type Comun = Pick<TareaInforme, 'id' | 'texto' | 'tiempo' | 'peso'>;

// Título de cada competencia ESCO por su URI: se construye una vez por paquete de datos, no en cada informe.
const titulosPorDatos = new WeakMap<Datos, Map<string, string>>();

function tituloPorUri(datos: Datos): Map<string, string> {
  const guardados = titulosPorDatos.get(datos);
  if (guardados) {
    return guardados;
  }
  const titulos = new Map(datos.esco.competencias.map(([uri, titulo]) => [uri, titulo]));
  titulosPorDatos.set(datos, titulos);
  return titulos;
}

/** Relación de la competencia con la ocupación según ESCO («e», «o»); la que ESCO no relaciona la ha propuesto Faro. */
function relacionSegunEsco(codigo: 'e' | 'o' | undefined): Competencia['relacion'] {
  if (codigo === 'e') {
    return 'esencial';
  }
  if (codigo === 'o') {
    return 'opcional';
  }
  return 'propuesta-faro';
}

/** Relación de cada competencia con la ocupación ESCO de la persona; sin ocupación ESCO, ninguna. */
function relacionesConLaOcupacion(datos: Datos, esco: string | null): Map<string, 'e' | 'o'> | null {
  if (esco === null) {
    return null;
  }
  const propias = new Map<string, 'e' | 'o'>();
  // La ocupación ya está confirmada y los índices de sus competencias pertenecen al catálogo validado.
  const ocupacion = datos.esco.ocupaciones[esco] as Datos['esco']['ocupaciones'][string];
  for (const [indice, relacion] of ocupacion.competencias) {
    const competencia = datos.esco.competencias[indice] as Datos['esco']['competencias'][number];
    propias.set(competencia[0], relacion);
  }
  return propias;
}

/**
 * Competencias ESCO de una tarea, con su relación con la ocupación de la persona («sin-ocupacion» si no la hay). Sus
 * títulos están en castellano: Faro no los traduce.
 */
function competencias(ambito: Ambito, esco: string | null, uris: string[]): Competencia[] {
  if (!uris.length) {
    return [];
  }
  const { datos, lengua } = ambito;
  const propias = relacionesConLaOcupacion(datos, esco);
  const porUri = tituloPorUri(datos);
  return uris.map((uri) => {
    const titulo = porUri.get(uri);
    if (!titulo) {
      throw new EntradaInvalida(`Competencia ESCO desconocida: ${uri}`);
    }
    const relacion = propias ? relacionSegunEsco(propias.get(uri)) : 'sin-ocupacion';
    return { uri, titulo: lengua.original(titulo, 'es'), relacion };
  });
}

/**
 * La ocupación ESCO con que se leen las competencias de una tarea oficial: la de la persona, salvo para las tareas de
 * su segundo grupo, que no son de su ocupación ESCO. Una tarea «equivalente» (uso interno) no cambia la ocupación
 * confirmada por la persona: sus competencias conservan la relación con esa ocupación ESCO.
 */
function escoDeLaTarea(ocupacion: OcupacionConfirmada, isco: string): string | null {
  return isco === ocupacion.secundario ? null : ocupacion.esco;
}

/**
 * Enlaces editoriales de Faro entre tarea y competencias ESCO. Manda el enlace específico; si falta, se conserva
 * la orientación disponible en otras ocupaciones del mismo grupo, identificada como tal.
 */
function competenciasDeTareaOficial(ambito: Ambito, tareaOit: string, isco: string): Competencia[] {
  const { datos, ocupacion } = ambito;
  const porOcupacion = datos.textos.competencias_por_ocupacion;
  const esco = escoDeLaTarea(ocupacion, isco);
  const propias = esco === null ? [] : (porOcupacion[esco]?.[tareaOit] ?? []);
  if (propias.length) {
    return competencias(ambito, esco, propias);
  }
  const delGrupo = ocupacionesDelGrupo(datos, isco).flatMap(
    (ocupacion) => porOcupacion[ocupacion.esco]?.[tareaOit] ?? [],
  );
  return competencias(ambito, esco, [...new Set(delGrupo)]).map((competencia) => ({
    ...competencia,
    alcance: 'grupo',
  }));
}

/** De dónde sale una estimación de Faro, contado para la persona: método, margen y si es incierta. */
function origenEstimacion(estimacion: Estimacion, textos: TextosInforme['origen']): string {
  const incierta = estimacion.incierta ? textos.incierta : '';
  if (estimacion.origen === 'ejemplo') {
    return `${incierta}${textos.ejemplo}`;
  }
  const margen = estimacion.origen === 'faro' ? textos.margenMedido : textos.margenProvisional;
  if (estimacion.referencias === 'oit') {
    return `${incierta}${textos.metodoOit(margen)}`;
  }
  if (estimacion.referencias === 'subgrupo') {
    return `${incierta}${textos.subgrupo}`;
  }
  return `${incierta}${textos.rubrica(margen)}`;
}

/** La tarea se nombra con las palabras de la persona, sin la puntuación del final. */
function nombreDe(tarea: TareaEntrada): string {
  return tarea.texto.trim().replace(/[\s.;:]+$/, '');
}

/**
 * Tarea oficial de referencia, comprobada: debe tener nota y, si es «propia», ser de la ocupación de la persona (de su
 * grupo o de su segundo grupo, si lo tiene).
 *
 * @param ambito - Los datos y los códigos de ocupación ya comprobados.
 * @param tarea - La tarea confirmada, cuyo identificador aparece en un posible error.
 * @param referencia - La referencia oficial que se comprueba sin usar el texto de la tarea.
 * @returns La tarea oficial con nota.
 * @throws {EntradaInvalida} Si la referencia no tiene nota o no pertenece a los grupos admitidos.
 */
export function comprobarReferenciaOit(
  ambito: Pick<Ambito, 'datos' | 'ocupacion'>,
  tarea: TareaEntrada,
  referencia: ReferenciaOit,
): TareaOitConNota {
  const { isco08, secundario } = ambito.ocupacion;
  const oit = ambito.datos.oit.tareas[referencia.tareaOit];
  if (!oit || oit.nota === null) {
    throw new EntradaInvalida(`Tarea OIT sin nota: ${referencia.tareaOit}`);
  }
  const esDeSusGrupos = oit.isco08 === isco08 || oit.isco08 === secundario;
  if (referencia.relacion === 'propia' && !esDeSusGrupos) {
    throw new EntradaInvalida(`La tarea ${tarea.id} no pertenece a la ocupación ${isco08}`);
  }
  return { ...oit, nota: oit.nota };
}

/**
 * De dónde sale la nota de una tarea oficial. Con dos grupos, cada tarea dice de cuál viene; con uno, basta su
 * código.
 */
function origenOficial(
  ambito: Ambito,
  oit: TareaOitConNota,
  relacion: ReferenciaOit['relacion'],
  cita: string,
): string {
  const textos = ambito.lengua.textos.origen;
  const citada = { cita, indice: oit.indice, isco08: oit.isco08, titulo: '' };
  if (relacion !== 'propia') {
    return textos.oficialEquivalente(citada);
  }
  // El título del grupo solo se nombra con dos grupos: sin ellos, no es un dato que muestre el informe.
  if (ambito.ocupacion.secundario !== null) {
    return textos.oficialDelGrupo({ ...citada, titulo: ambito.lengua.tituloIsco(oit.isco08) });
  }
  return textos.oficialPropia(citada);
}

/**
 * Cómo se cita la tarea oficial: su texto corto en el idioma del informe (o en castellano) o, si no lo hay, el inglés
 * recortado sin partir palabras (comun/recorte.ts), como la cita del relato.
 */
function citaOficial(lengua: Lengua, textoCorto: string | null, textoIngles: string): string {
  if (textoCorto !== null) {
    return textoCorto;
  }
  return lengua.original(recortarEnPalabras(textoIngles, MAX_CARACTERES_CITA), 'en');
}

/** El estado del texto de una tarea oficial que no escribió la IA: lo redactó una persona. */
const REDACCION_MANUAL: EstadoTexto = 'redacción manual';

/**
 * La regla de autoría de los textos de una tarea oficial del paquete, en un solo sitio para el aviso visible del
 * informe y para su marca legible por máquina: los escribió la IA salvo los de redacción manual.
 *
 * @param estado - Estado del texto en el paquete, o undefined si la tarea no tiene texto.
 * @returns Si el texto lo redactó una persona (y no la IA).
 */
export function esRedaccionManual(estado: EstadoTexto | undefined): boolean {
  return estado === REDACCION_MANUAL;
}

/**
 * «La IA podría» y «Lo tuyo» de una tarea oficial, traducidos si se pide otro idioma y los hay (en los datos o
 * aportados por quien construye el informe), y si los ha escrito la IA: todos salvo la redacción manual, y cualquier traducción, que
 * también es de la IA.
 */
function textosDeLaTareaOficial(
  ambito: Ambito,
  tareaOit: string,
): Pick<TareaInforme, 'iaPodria' | 'loTuyo' | 'textosIa'> {
  const { datos, lengua } = ambito;
  const texto = datos.textos.tareas[tareaOit];
  const frase = (campo: 'ia_podria' | 'lo_tuyo') => {
    const dato = textoDeTareaEn(datos, tareaOit, campo, lengua.idioma);
    return dato ? lengua.fraseDeIa(dato) : null;
  };
  const iaPodria = frase('ia_podria');
  const loTuyo = frase('lo_tuyo');
  const traducidos = lengua.idioma !== 'es' && iaPodria?.idioma === lengua.idioma;
  return {
    iaPodria: iaPodria ? lengua.usar(iaPodria) : null,
    loTuyo: loTuyo ? lengua.usar(loTuyo) : null,
    textosIa: !!texto?.ia_podria && (!esRedaccionManual(texto.estado) || traducidos),
  };
}

/** Tarea emparejada con una tarea oficial de la OIT: su nota es la publicada y la tarea oficial se cita como fuente. */
function tareaConNotaOit(ambito: Ambito, tarea: TareaEntrada, referencia: ReferenciaOit, comun: Comun): TareaInforme {
  const { lengua } = ambito;
  const oit = comprobarReferenciaOit(ambito, tarea, referencia);
  const cita = citaOficial(lengua, lengua.textoDeTarea(referencia.tareaOit, 'corto'), oit.texto_en);
  return {
    ...comun,
    nombre: nombreDe(tarea),
    valor: oit.nota,
    margen: oit.margen,
    franja: franja(oit.nota),
    franjasPosibles: franjasDelMargen(oit.margen),
    evidencia: 'estimacion-oit',
    incierta: false,
    origenValor: origenOficial(ambito, oit, referencia.relacion, cita),
    referencia: {
      tareaOit: referencia.tareaOit,
      isco08: oit.isco08,
      ocupacion: lengua.tituloIsco(oit.isco08),
      relacion: referencia.relacion,
    },
    ...textosDeLaTareaOficial(ambito, referencia.tareaOit),
    competencias: competenciasDeTareaOficial(ambito, referencia.tareaOit, oit.isco08),
  };
}

/** Misma comprobación numérica para la preparación web y el generador estricto, con el margen primero. */
function motivoEstimacionInvalida(estimacion: Estimacion): 'margen' | 'escala' | null {
  const dentroDelMargen = estimacion.margen[0] <= estimacion.valor && estimacion.valor <= estimacion.margen[1];
  if (!dentroDelMargen) {
    return 'margen';
  }
  if ([estimacion.valor, ...estimacion.margen].some((nota) => !Number.isFinite(nota) || nota < 0 || nota > 1)) {
    return 'escala';
  }
  return null;
}

/** La nota y los extremos pertenecen a la escala 0–1; primero se conserva el error de pertenencia al margen. */
function comprobarEstimacion(tarea: TareaEntrada, estimacion: Estimacion): void {
  const motivo = motivoEstimacionInvalida(estimacion);
  if (motivo === 'margen') {
    throw new EntradaInvalida(`Estimación fuera de su margen: ${tarea.id}`);
  }
  if (motivo === 'escala') {
    throw new EntradaInvalida(`Estimación fuera de escala 0–1: ${tarea.id}`);
  }
}

/**
 * Prepara el informe web retirando solo estimaciones numéricamente inválidas, después de comprobar las firmas exigidas.
 * Conserva todas las tareas y su orden, y la prioridad OIT; no toca textos ni captura errores de otros contratos.
 * Sin cambios devuelve la misma entrada; construir el informe directamente sigue siendo estricto.
 *
 * @param entrada - Entrada con su forma comprobada y las firmas exigidas verificadas.
 * @returns La entrada preparada y los identificadores de las tareas que deben explicar que quedaron sin estimación.
 */
export function prepararEstimacionesParaInforme(entrada: Entrada): {
  entrada: Entrada;
  tareasSinEstimacion: ReadonlySet<string>;
} {
  const tareasSinEstimacion = new Set<string>();
  const tareas = entrada.tareas.map((tarea) => {
    const { estimacion, ...sinEstimacion } = tarea;
    if (tarea.referencia || !estimacion || motivoEstimacionInvalida(estimacion) === null) {
      return tarea;
    }
    tareasSinEstimacion.add(tarea.id);
    return sinEstimacion;
  });
  return { entrada: tareasSinEstimacion.size ? { ...entrada, tareas } : entrada, tareasSinEstimacion };
}

/** Tarea sin tarea oficial equivalente, valorada por Faro con la rúbrica de la OIT. */
function tareaConEstimacion(ambito: Ambito, tarea: TareaEntrada, estimacion: Estimacion, comun: Comun): TareaInforme {
  comprobarEstimacion(tarea, estimacion);
  const { lengua } = ambito;
  // Las frases de la estimación están en castellano; pueden venir acompañadas de traducciones.
  const enCastellano = (texto: string | undefined): string | null =>
    texto === undefined ? null : lengua.usar(lengua.fraseDeIa({ texto, idioma: 'es' }));
  const deEjemplo = estimacion.origen === 'ejemplo';
  // Aquí `nombre` va después de `evidencia`: cambiar el orden de las claves cambiaría el JSON del informe.
  return {
    ...comun,
    valor: estimacion.valor,
    margen: estimacion.margen,
    franja: franja(estimacion.valor),
    franjasPosibles: franjasDelMargen(estimacion.margen),
    evidencia: 'estimacion-faro',
    nombre: nombreDe(tarea),
    incierta: estimacion.incierta ?? false,
    origenValor: origenEstimacion(estimacion, lengua.textos.origen),
    ...(deEjemplo ? { ejemplo: true } : {}),
    referencia: null,
    iaPodria: enCastellano(estimacion.iaPodria),
    loTuyo: enCastellano(estimacion.loTuyo),
    // Los textos de una nota de ejemplo vienen escritos en su caso, como la nota: no los redactó la IA.
    textosIa: !deEjemplo && !!(estimacion.iaPodria || estimacion.loTuyo),
    competencias: competencias(ambito, ambito.ocupacion.esco, estimacion.competencias ?? []),
  };
}

/**
 * Sin nota publicada ni estimación (por ejemplo, una ocupación sin tareas en la OIT): la tarea aparece igualmente,
 * marcada como información insuficiente. No se rellena con un valor inventado. Si su grupo no tiene referencias para
 * estimar, lo dice: es el motivo.
 */
function tareaSinNota(ambito: Ambito, tarea: TareaEntrada, comun: Comun): TareaInforme {
  const { origen } = ambito.lengua.textos;
  const estimacionNoDisponible = ambito.tareasSinEstimacion?.has(tarea.id) ?? false;
  let origenValor = ambito.sinReferencias ? origen.sinReferencias : origen.insuficiente;
  if (estimacionNoDisponible) {
    origenValor = origen.estimacionNoDisponible;
  }
  return {
    ...comun,
    nombre: nombreDe(tarea),
    valor: null,
    margen: null,
    franja: null,
    evidencia: 'insuficiente',
    incierta: false,
    origenValor,
    ...(estimacionNoDisponible ? { motivoSinNota: 'estimacion-no-disponible' as const } : {}),
    referencia: null,
    iaPodria: null,
    loTuyo: null,
    textosIa: false,
    competencias: [],
  };
}

/**
 * Tarea del informe a partir de una tarea confirmada, escrita en la lengua del informe. Manda la tarea oficial de
 * referencia; si no la hay, la estimación de Faro; sin ninguna de las dos, la tarea aparece como información
 * insuficiente.
 *
 * @param ambito - Lo común a todas las tareas del informe: datos, lengua y ocupación.
 * @param tarea - Tarea confirmada por la persona.
 * @returns La tarea del informe, con su nota, su margen, su fuente y sus competencias, o sin nota si no hay ninguna.
 */
export function tareaInforme(ambito: Ambito, tarea: TareaEntrada): TareaInforme {
  const comun: Comun = { id: tarea.id, texto: tarea.texto, tiempo: tarea.tiempo, peso: PESOS[tarea.tiempo] };
  if (tarea.referencia) {
    return tareaConNotaOit(ambito, tarea, tarea.referencia, comun);
  }
  if (tarea.estimacion) {
    return tareaConEstimacion(ambito, tarea, tarea.estimacion, comun);
  }
  return tareaSinNota(ambito, tarea, comun);
}
