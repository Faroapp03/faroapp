// De cada aviso técnico del navegador solo se extrae, para la línea del registro, el tipo, un código de vocabulario
// fijo, el origen propio y la hora en punto; Faro no lo guarda en ningún almacén propio. No se copia la ruta ni el
// texto libre del informe. Los códigos desconocidos con forma válida se
// representan como «otro»; los controles de origen, forma, edad y fallos HTTP siguen aplicándose.
// pruebas/plataforma/plataforma-avisos.test.ts comprueba la reducción de campos, los descartes y los topes de recepción.

import { esObjeto } from '../comun/json.ts';
import { MS_POR_MINUTO, MS_POR_SEGUNDO } from '../comun/tiempo.ts';
import { VIGENCIA_DE_LOS_AVISOS_S } from './cabeceras-web.ts';

/** Los tipos de informe que piden las cabeceras de Faro: la CSP (CSP3, 6.4) y NEL (NEL, 3.3). */
const TIPOS_DE_AVISO = ['csp-violation', 'network-error'] as const;
/** Una directiva de la CSP: letras y guiones (CSP3, 2.3), como «script-src-elem» o «require-trusted-types-for». */
const DIRECTIVA = /^[a-z][a-z-]{0,39}$/;
/** Un tipo de error de NEL: grupos en minúsculas separados por puntos (NEL, 6), como «tcp.timed_out». */
const ERROR_DE_RED = /^[a-z][a-z0-9_]{0,19}(?:\.[a-z0-9_]{1,30}){0,3}$/;
/** Vocabulario acotado a las directivas de nuestras cabeceras y a «script-src-elem» para guiones de una etiqueta. */
const CODIGOS_CSP: ReadonlySet<string> = new Set([
  'default-src',
  'script-src',
  'script-src-elem',
  'frame-src',
  'style-src',
  'img-src',
  'font-src',
  'connect-src',
  'manifest-src',
  'worker-src',
  'object-src',
  'frame-ancestors',
  'base-uri',
  'form-action',
  'require-trusted-types-for',
  'trusted-types',
  'report-to',
]);
/** Códigos de red que se conservan con su nombre; los demás de forma válida se reducen a «otro». */
const CODIGOS_RED: ReadonlySet<string> = new Set([
  'http.error',
  'dns.name_not_resolved',
  'dns.address_changed',
  'tcp.timed_out',
]);

/**
 * Lo que NEL cuenta y no es un fallo de Faro: «abandoned» dice que la persona dejó la página antes de que cargara, una
 * conducta, no una avería; «ok», una petición que salió bien, que Faro nunca pide (success_fraction 0).
 */
const NO_SON_FALLOS: ReadonlySet<string> = new Set(['abandoned', 'ok']);
/**
 * Un 4xx es una respuesta que el propio servidor decidió dar y ya conoce, y puede contar qué hizo alguien (un texto que
 * la moderación rechaza es un 422): de las respuestas fallidas solo se guardan las 5xx, que pueden venir de Cloudflare
 * sin pasar por el Worker (un límite de CPU superado) y que el Worker no ve.
 */
const PRIMER_ESTADO_DE_FALLO = 500;
/** El límite superior de la clase de respuestas 5xx (RFC 9110, 15). */
const ULTIMO_ESTADO = 599;
/** El tipo de aviso de NEL (Network Error Logging) cuando la respuesta llegó con un estado de error HTTP. */
const ERROR_HTTP_DE_NEL = 'http.error';
/** Los caracteres de «AAAA-MM-DDTHH» en una fecha ISO: hasta la hora, sin minutos. */
const LARGO_HASTA_LA_HORA = 13;
/** La hora es la precisión con que el registro anota cuándo ocurrió un aviso. */
const MS_POR_HORA = 60 * MS_POR_MINUTO;
/** La edad máxima de un aviso: la vigencia de su política en el navegador (VIGENCIA_DE_LOS_AVISOS_S). */
const MAX_EDAD_MS = VIGENCIA_DE_LOS_AVISOS_S * MS_POR_SEGUNDO;

/** Un tipo de informe que Faro pide. */
type TipoDeAviso = (typeof TIPOS_DE_AVISO)[number];

/** Lo único que se extrae de un aviso para la línea del registro. */
export interface AvisoMinimo {
  tipo: TipoDeAviso;
  /** Un código técnico admitido, o «otro» para los desconocidos con forma válida. */
  codigo: string;
  /** El código HTTP de una respuesta 5xx, solo en los avisos de red que la tienen. */
  estado?: number;
  origen: string;
  /** La hora en punto, en UTC (ISO 8601): «2026-10-11T03:00Z». */
  hora: string;
}

/** Por qué se descarta un informe entero. */
export type MotivoDeDescarte = 'forma' | 'tipo' | 'origen' | 'edad' | 'no_es_fallo';

/** Lo que se queda de un envío: los avisos mínimos y cuántos informes se descartaron, por motivo. */
export interface AvisosDelEnvio {
  avisos: AvisoMinimo[];
  descartados: Partial<Record<MotivoDeDescarte | 'exceso', number>>;
}

/** Si `valor` es uno de los tipos de informe que Faro pide (TIPOS_DE_AVISO). */
function esTipoDeAviso(valor: unknown): valor is TipoDeAviso {
  return typeof valor === 'string' && TIPOS_DE_AVISO.some((tipo) => tipo === valor);
}

/** La hora en punto en que se generó un informe, o null si su edad no es creíble. */
function horaDelInforme(edad: unknown, ahoraMs: number): string | null {
  if (typeof edad !== 'number' || !Number.isFinite(edad) || edad < 0 || edad > MAX_EDAD_MS) {
    return null;
  }
  const enPunto = Math.floor((ahoraMs - edad) / MS_POR_HORA) * MS_POR_HORA;
  return `${new Date(enPunto).toISOString().slice(0, LARGO_HASTA_LA_HORA)}:00Z`;
}

/** La dirección del informe si es del propio origen; si no se puede leer o es de otro sitio, null. */
function direccionPropia(url: unknown, origenPropio: string): URL | null {
  if (typeof url !== 'string') {
    return null;
  }
  try {
    const direccion = new URL(url);
    return direccion.origin === origenPropio ? direccion : null;
  } catch {
    // Una dirección que no lo es: el informe se descarta por su origen.
    return null;
  }
}

/** El código de un aviso de la CSP: la directiva incumplida, o null si no tiene la forma de una. */
function codigoDeLaCsp(cuerpo: Record<string, unknown>): string | null {
  const directiva = cuerpo.effectiveDirective;
  if (typeof directiva !== 'string' || !DIRECTIVA.test(directiva)) {
    return null;
  }
  return CODIGOS_CSP.has(directiva) ? directiva : 'otro';
}

/** El código HTTP de un aviso de red, si es una respuesta 5xx; undefined si no la hay o no se guarda. */
function estadoDeFallo(cuerpo: Record<string, unknown>): number | undefined {
  const estado = cuerpo.status_code;
  if (typeof estado !== 'number' || !Number.isInteger(estado)) {
    return undefined;
  }
  return estado >= PRIMER_ESTADO_DE_FALLO && estado <= ULTIMO_ESTADO ? estado : undefined;
}

/** El código de un aviso y, si es un fallo HTTP, su estado. */
type CodigoDelAviso = Pick<AvisoMinimo, 'codigo' | 'estado'>;

/** El código (y el estado) de un aviso de red, o el motivo por el que no se guarda. */
function codigoDeRed(cuerpo: Record<string, unknown>): CodigoDelAviso | MotivoDeDescarte {
  const tipo = cuerpo.type;
  if (typeof tipo !== 'string' || !ERROR_DE_RED.test(tipo)) {
    return 'forma';
  }
  if (NO_SON_FALLOS.has(tipo)) {
    return 'no_es_fallo';
  }
  if (tipo !== ERROR_HTTP_DE_NEL) {
    return { codigo: CODIGOS_RED.has(tipo) ? tipo : 'otro' };
  }
  const estado = estadoDeFallo(cuerpo);
  return estado === undefined ? 'no_es_fallo' : { codigo: tipo, estado };
}

/** El código de un informe ya reconocido por su tipo, o el motivo por el que se descarta. */
function codigoDelInforme(tipo: TipoDeAviso, cuerpo: Record<string, unknown>): CodigoDelAviso | MotivoDeDescarte {
  if (tipo === 'network-error') {
    return codigoDeRed(cuerpo);
  }
  const codigo = codigoDeLaCsp(cuerpo);
  return codigo === null ? 'forma' : { codigo };
}

/**
 * Lo único que se extrae de un informe del navegador para la línea del registro (Reporting API, 2.4: type, url, age y
 * body), o el motivo por el que se descarta entero: sin la forma esperada, de un tipo que Faro no pide, de otro origen,
 * con una edad que no es creíble o de algo que no es un fallo.
 *
 * @param informe - Un informe del navegador, sin fiar.
 * @param origenPropio - El origen propio de la web.
 * @param ahoraMs - El instante actual, en milisegundos.
 * @returns El aviso reducido a lo imprescindible, o el motivo del descarte.
 */
export function avisoMinimo(informe: unknown, origenPropio: string, ahoraMs: number): AvisoMinimo | MotivoDeDescarte {
  if (!esObjeto(informe) || !esObjeto(informe.body)) {
    return 'forma';
  }
  if (!esTipoDeAviso(informe.type)) {
    return 'tipo';
  }
  const direccion = direccionPropia(informe.url, origenPropio);
  if (direccion === null) {
    return 'origen';
  }
  const hora = horaDelInforme(informe.age, ahoraMs);
  if (hora === null) {
    return 'edad';
  }
  const codigo = codigoDelInforme(informe.type, informe.body);
  if (typeof codigo === 'string') {
    return codigo;
  }
  return { tipo: informe.type, ...codigo, origen: direccion.origin, hora };
}

/**
 * Los avisos de un envío (application/reports+json: una lista de informes), los `maximo` primeros; los que pasan de ahí
 * se cuentan como «exceso» sin leerlos. null si el envío no es una lista.
 *
 * @param datos - El cuerpo del envío, sin fiar.
 * @param origenPropio - El origen propio de la web.
 * @param ahoraMs - El instante actual, en milisegundos.
 * @param maximo - Cuántos informes se miran como mucho: un entero mayor o igual que 0.
 * @returns Los avisos y el recuento de descartados, o null si no es una lista.
 */
export function avisosDelEnvio(
  datos: unknown,
  origenPropio: string,
  ahoraMs: number,
  maximo: number,
): AvisosDelEnvio | null {
  if (!Array.isArray(datos)) {
    return null;
  }
  const resultado: AvisosDelEnvio = { avisos: [], descartados: {} };
  for (const informe of datos.slice(0, maximo)) {
    const aviso = avisoMinimo(informe, origenPropio, ahoraMs);
    if (typeof aviso === 'string') {
      resultado.descartados[aviso] = (resultado.descartados[aviso] ?? 0) + 1;
    } else {
      resultado.avisos.push(aviso);
    }
  }
  if (datos.length > maximo) {
    resultado.descartados.exceso = datos.length - maximo;
  }
  return resultado;
}
