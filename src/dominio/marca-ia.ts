// Procedencia legible por máquina de los campos generados con IA y de los campos oficiales, de reglas o de la persona.
// La marca acompaña la salida de texto (Reglamento europeo de IA, art. 50.2) sin incorporar los valores del cuerpo.
// Las rutas son punteros JSON (RFC 6901); Faro añade `*` para cualquier posición de una lista. Una entrada cubre
// el campo y sus descendientes: prevalece la ruta con más niveles y, a igual profundidad, la que no lleva `*`.
// Los tipos de fuente digital pertenecen al vocabulario IPTC: trainedAlgorithmicMedia para un fragmento generado
// y compositeSynthetic para una salida que incluye alguno. Faro no genera contenido por una API de IA;
// conserva la procedencia del paquete y la de aportes generados cuyo autor no consta.

/** Vocabulario de IPTC para el tipo de fuente digital. */
const VOCABULARIO_IPTC = 'http://cv.iptc.org/newscodes/digitalsourcetype/';
/** Contenido creado con IA generativa. */
export const ESCRITO_CON_IA = `${VOCABULARIO_IPTC}trainedAlgorithmicMedia`;
/** Una mezcla de varios elementos, al menos uno de ellos de IA generativa. */
export const MEZCLA_CON_IA = `${VOCABULARIO_IPTC}compositeSynthetic`;
/** Versión de la forma de la marca: sube si cambia lo que significa un campo. */
const VERSION_MARCA = 1;

/**
 * Qué hizo la IA con un campo: lo redactó, estimó su nota, lo tradujo, propuso un grupo que la persona confirmó o
 * eligió un dato oficial (el texto elegido es el oficial; la elección, de la IA).
 */
export type AccionDeLaIa = 'redactado' | 'estimado' | 'traducido' | 'propuesto' | 'elegido';

/**
 * Un campo escrito con IA. `modo` «paquete»: se escribió una vez al preparar los datos de Faro (el paquete no guarda
 * el modelo, así que `modelo` es null). `modo` null: quien hizo el informe no atendía con IA, y no consta con qué modo
 * ni modelo se escribió.
 */
export interface FragmentoConIa {
  campo: string;
  accion: AccionDeLaIa;
  modo: 'paquete' | null;
  modelo: null;
  fuenteDigital: typeof ESCRITO_CON_IA;
}

/**
 * De dónde sale un campo hecho sin IA: datos oficiales, reglas y textos fijos de Faro, o lo que confirmó la persona.
 */
export type OrigenSinIa = 'datos-oficiales' | 'reglas-de-faro' | 'persona';

/** Un campo hecho sin IA y de dónde sale. */
interface CampoSinIa {
  campo: string;
  origen: OrigenSinIa;
}

/** La marca de una respuesta o de un informe. */
export interface MarcaIa {
  version: typeof VERSION_MARCA;
  /** IPTC: la mezcla si algún campo lo escribió la IA; null si no hay ninguno. */
  fuenteDigital: typeof MEZCLA_CON_IA | null;
  /** Autoría generativa de la respuesta, no uso de IA local para buscar, clasificar o calcular. */
  modo: 'sin-ia';
  /** No se atribuye la respuesta a un modelo generador. */
  modelo: null;
  conIa: FragmentoConIa[];
  sinIa: CampoSinIa[];
}

/**
 * Un campo generado cuyo modo y modelo no constan; no atribuye al servicio local su autoría.
 *
 * @param campo - El puntero JSON del campo dentro de la respuesta.
 * @param accion - Qué hizo la IA con el campo.
 * @returns El fragmento marcado.
 */
export function conIaDe(campo: string, accion: AccionDeLaIa): FragmentoConIa {
  return {
    campo,
    accion,
    modo: null,
    modelo: null,
    fuenteDigital: ESCRITO_CON_IA,
  };
}

/**
 * Un campo que escribió la IA al preparar los datos de Faro.
 *
 * @param campo - El puntero JSON del campo dentro de la respuesta.
 * @param accion - Qué hizo la IA con el campo.
 * @returns El fragmento marcado.
 */
export function conIaDelPaquete(campo: string, accion: AccionDeLaIa): FragmentoConIa {
  return {
    campo,
    accion,
    modo: 'paquete',
    modelo: null,
    fuenteDigital: ESCRITO_CON_IA,
  };
}

/**
 * La marca con sus campos: la fuente digital del conjunto sale de si hay alguno escrito con IA.
 *
 * @param conIa - Los campos escritos con IA.
 * @param sinIa - El origen de los campos escritos sin IA, por puntero JSON.
 * @returns La marca completa.
 */
export function marcaIa(conIa: FragmentoConIa[], sinIa: Record<string, OrigenSinIa>): MarcaIa {
  return {
    version: VERSION_MARCA,
    fuenteDigital: conIa.length > 0 ? MEZCLA_CON_IA : null,
    modo: 'sin-ia',
    modelo: null,
    conIa,
    sinIa: Object.entries(sinIa).map(([campo, origen]) => ({ campo, origen })),
  };
}
