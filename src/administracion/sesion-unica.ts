/**
 * Sesión única del Panel de Control: solo una persona puede tenerlo abierto, y cada entrada y cada sesión quedan en
 * un registro de accesos. La persona se identifica por su correo verificado por Access; los identificadores legibles
 * son de cada entrada (E-) y de cada sesión (S-), nunca de la persona, y no guardan relación con el token.
 */
import { type AccesoSesionPanel, leerEstadoSesionPanel, type SesionPanelActiva } from './sesion.ts';

/** 90 días: un trimestre basta para revisar quién abrió el panel antes de un cambio. */
export const RETENCION_REGISTRO_PANEL_MS = 7_776_000_000;
/** La vista muestra las filas más recientes; el resto sigue en el almacén hasta su retención. */
export const FILAS_LECTURA_REGISTRO_PANEL = 100;
export const RUTA_REGISTRO_PANEL_DURABLE = '/panel/registro';
/** Base32 de Crockford: sin I, L, O ni U, para que nadie confunda caracteres al leerlos o dictarlos. */
const ALFABETO_ID = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const LARGO_ID = 8;
const ID_ENTRADA = /^E-[0-9A-HJKMNP-TV-Z]{8}$/;
const ID_SESION = /^S-[0-9A-HJKMNP-TV-Z]{8}$/;
const HUELLA = /^[0-9a-f]{64}$/;
/** Longitud máxima de una dirección de correo (RFC 5321), medida en bytes. */
const CORREO_MAX_BYTES = 254;
/**
 * Parte local en ASCII imprimible, sin comillas, barra invertida ni arroba; dominio en ASCII por etiquetas (los
 * dominios internacionales llegan en punycode). Al ser todo ASCII visible no caben espacios, controles ni caracteres
 * de formato como U+202E, que harían que un correo se viera distinto de lo que es.
 */
const PARTE_LOCAL = String.raw`[\x21\x23-\x3F\x41-\x5B\x5D-\x7E]+`;
const ETIQUETA_DOMINIO = '[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?';
const CORREO = new RegExp(String.raw`^${PARTE_LOCAL}@${ETIQUETA_DOMINIO}(?:\.${ETIQUETA_DOMINIO})*$`);
const CODIFICADOR = new TextEncoder();

export const TIPOS_REGISTRO_PANEL = [
  'entrada',
  'sesion-abierta',
  'sesion-cerrada',
  'sesion-caducada',
  'sesion-retomada',
  'apertura-rechazada',
  'administrador-anadido',
  'administrador-retirado',
  'cloudflare-actualizado',
  'cloudflare-fallido',
] as const;
export type TipoRegistroPanel = (typeof TIPOS_REGISTRO_PANEL)[number];
export type MotivoCaducidad = 'inactividad' | 'duracion';
/**
 * Solo las entradas y los rechazos tienen además un tope por número de filas: son los que puede multiplicar quien
 * llega al panel sin tenerlo. Las filas de sesión dicen quién lo tuvo y solo caducan por la retención, para que
 * ninguna ráfaga de entradas o rechazos pueda borrarlas. Un tipo nuevo queda fuera del tope si no se añade aquí.
 */
export const TIPOS_CON_TOPE_REGISTRO_PANEL: readonly TipoRegistroPanel[] = ['entrada', 'apertura-rechazada'];
export const MAX_FILAS_CON_TOPE_REGISTRO_PANEL = 2000;

/** Identidad verificada de una petición: huella de la persona, su correo y la huella de su sesión de Access. */
export interface IdentidadPanel {
  readonly huellaPrincipal: string;
  readonly correo: string;
  /** Huella de emisor, sujeto e instante de emisión del JWT: una por cada sesión de Access, no por petición. */
  readonly huellaEntrada: string;
}
export interface OcupacionPanel {
  /** null solo para una sesión abierta antes de que existiera la sesión única: se sabe que está viva, no de quién. */
  readonly correo: string | null;
  readonly desde: number;
  /** Previsto ahora: se aplaza con cada acción de quien tiene la sesión, así que no es un «como tarde». */
  readonly cierrePorInactividadEn: number;
  /** Límite absoluto de 8 horas: el único «como tarde» real. */
  readonly limiteEn: number;
  /** Solo si la sesión es de quien pregunta: con ellos la banda se recupera al recargar la página. */
  readonly idSesion: string | null;
  readonly idEntrada: string | null;
  readonly propia: boolean;
}
export interface BienvenidaPanel {
  readonly correo: string;
  readonly idEntrada: string;
  /** Primera vez que esta sesión de Access llegó al panel. */
  readonly entradaEn: number;
  readonly ocupacion: OcupacionPanel | null;
}
export type ResultadoAperturaUnica =
  | {
      readonly estado: 'abierta';
      readonly idSesion: string;
      readonly idEntrada: string;
      readonly sesion: SesionPanelActiva;
    }
  | { readonly estado: 'ocupada'; readonly ocupacion: OcupacionPanel };
export interface FilaRegistroPanel {
  readonly instante: number;
  readonly tipo: TipoRegistroPanel;
  readonly correo: string;
  readonly idEntrada: string | null;
  readonly idSesion: string | null;
  readonly motivo: MotivoCaducidad | null;
  /**
   * La otra persona del hecho: en apertura-rechazada, quién tenía el panel abierto; en las altas, retiradas y cambios
   * en Cloudflare Access, el administrador al que se refieren.
   */
  readonly titular: string | null;
}

export class DatosSesionUnicaNoValidos extends Error {
  override readonly name = 'DatosSesionUnicaNoValidos';
  constructor() {
    super('Datos de la sesión única no válidos');
  }
}
function exigir(condicion: boolean): asserts condicion {
  if (!condicion) {
    throw new DatosSesionUnicaNoValidos();
  }
}

/** 256 es múltiplo de 32: tomar cinco bits de cada byte reparte los símbolos por igual. */
export function crearIdLegible(
  prefijo: 'E' | 'S',
  aleatorio: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array = (bytes) => crypto.getRandomValues(bytes),
): string {
  const bytes = aleatorio(new Uint8Array(LARGO_ID));
  let id = `${prefijo}-`;
  for (const byte of bytes) {
    id += ALFABETO_ID[byte % ALFABETO_ID.length];
  }
  return id;
}
export function esIdEntrada(valor: unknown): valor is string {
  return typeof valor === 'string' && ID_ENTRADA.test(valor);
}
export function esIdSesion(valor: unknown): valor is string {
  return typeof valor === 'string' && ID_SESION.test(valor);
}
/** Correo tal como lo entrega Access, con una sola arroba y una forma que se lee igual que se guarda. */
export function esCorreoVerificado(valor: unknown): valor is string {
  return typeof valor === 'string' && CODIFICADOR.encode(valor).byteLength <= CORREO_MAX_BYTES && CORREO.test(valor);
}
/**
 * Cota de la respuesta del registro, en bytes UTF-8 del JSON que de verdad envía el objeto durable: la fila más
 * larga posible (correos de 254 bytes, que en JSON no crecen porque no admiten comillas ni barra invertida, el tipo
 * y el motivo más largos y el instante mayor) por el número de filas de la lectura, con sus comas y corchetes.
 */
function bytesFilaRegistroMaxima(): number {
  const correo = `${'a'.repeat(CORREO_MAX_BYTES - '@b'.length)}@b`;
  const tipo = TIPOS_REGISTRO_PANEL.reduce((largo, actual) => (actual.length > largo.length ? actual : largo));
  const fila: FilaRegistroPanel = {
    instante: Number.MAX_SAFE_INTEGER,
    tipo,
    correo,
    idEntrada: `E-${'0'.repeat(LARGO_ID)}`,
    idSesion: `S-${'0'.repeat(LARGO_ID)}`,
    motivo: 'inactividad',
    titular: correo,
  };
  return CODIFICADOR.encode(JSON.stringify(fila)).byteLength;
}
export const MAX_RESPUESTA_REGISTRO_PANEL = FILAS_LECTURA_REGISTRO_PANEL * (bytesFilaRegistroMaxima() + 1) + 1;
export function leerIdentidadPanel(entrada: unknown): IdentidadPanel {
  exigir(entrada !== null && typeof entrada === 'object' && !Array.isArray(entrada));
  const copia = entrada as Record<string, unknown>;
  exigir(Object.keys(copia).sort().join(',') === 'correo,huellaEntrada,huellaPrincipal');
  exigir(typeof copia.huellaPrincipal === 'string' && HUELLA.test(copia.huellaPrincipal));
  exigir(typeof copia.huellaEntrada === 'string' && HUELLA.test(copia.huellaEntrada));
  exigir(esCorreoVerificado(copia.correo));
  return { huellaPrincipal: copia.huellaPrincipal, correo: copia.correo, huellaEntrada: copia.huellaEntrada };
}

/** Operaciones de la sesión única que expone la autoridad, también a través del objeto durable. */
export interface AlmacenSesionUnica {
  recibirEnPanel(identidad: IdentidadPanel): Promise<BienvenidaPanel>;
  abrirSesionUnica(
    acceso: AccesoSesionPanel,
    identidad: IdentidadPanel,
    retomar: boolean,
  ): Promise<ResultadoAperturaUnica>;
  leerRegistroPanel(): Promise<readonly FilaRegistroPanel[]>;
}

function registro(entrada: unknown, esperadas: string): Record<string, unknown> {
  exigir(entrada !== null && typeof entrada === 'object' && !Array.isArray(entrada));
  exigir(Object.getPrototypeOf(entrada) === Object.prototype);
  const copia = { ...(entrada as Record<string, unknown>) };
  exigir(Object.keys(copia).sort().join(',') === esperadas);
  return copia;
}
function instante(valor: unknown): valor is number {
  return typeof valor === 'number' && Number.isSafeInteger(valor) && valor >= 0;
}
function leerOcupacion(entrada: unknown): OcupacionPanel {
  const copia = registro(entrada, 'cierrePorInactividadEn,correo,desde,idEntrada,idSesion,limiteEn,propia');
  exigir(copia.idSesion === null || (copia.propia === true && esIdSesion(copia.idSesion)));
  exigir(copia.idEntrada === null || (copia.propia === true && esIdEntrada(copia.idEntrada)));
  exigir(copia.correo === null || esCorreoVerificado(copia.correo));
  exigir(instante(copia.desde) && instante(copia.cierrePorInactividadEn) && instante(copia.limiteEn));
  exigir(copia.cierrePorInactividadEn > copia.desde && copia.limiteEn > copia.desde);
  exigir(typeof copia.propia === 'boolean');
  return {
    correo: copia.correo,
    desde: copia.desde,
    cierrePorInactividadEn: copia.cierrePorInactividadEn,
    limiteEn: copia.limiteEn,
    idSesion: copia.idSesion,
    idEntrada: copia.idEntrada,
    propia: copia.propia,
  };
}
export function leerBienvenidaPanel(entrada: unknown): BienvenidaPanel {
  const copia = registro(entrada, 'correo,entradaEn,idEntrada,ocupacion');
  exigir(esCorreoVerificado(copia.correo) && esIdEntrada(copia.idEntrada) && instante(copia.entradaEn));
  return {
    correo: copia.correo,
    idEntrada: copia.idEntrada,
    entradaEn: copia.entradaEn,
    ocupacion: copia.ocupacion === null ? null : leerOcupacion(copia.ocupacion),
  };
}
export function leerResultadoAperturaUnica(entrada: unknown): ResultadoAperturaUnica {
  exigir(entrada !== null && typeof entrada === 'object' && 'estado' in entrada);
  if (entrada.estado === 'ocupada') {
    const copia = registro(entrada, 'estado,ocupacion');
    return { estado: 'ocupada', ocupacion: leerOcupacion(copia.ocupacion) };
  }
  const copia = registro(entrada, 'estado,idEntrada,idSesion,sesion');
  exigir(copia.estado === 'abierta' && esIdSesion(copia.idSesion) && esIdEntrada(copia.idEntrada));
  const sesion = leerEstadoSesionPanel(copia.sesion);
  exigir(sesion.estado === 'activa');
  return { estado: 'abierta', idSesion: copia.idSesion, idEntrada: copia.idEntrada, sesion };
}
function leerFilaRegistroPanel(entrada: unknown): FilaRegistroPanel {
  const copia = registro(entrada, 'correo,idEntrada,idSesion,instante,motivo,tipo,titular');
  exigir(instante(copia.instante) && TIPOS_REGISTRO_PANEL.includes(copia.tipo as TipoRegistroPanel));
  exigir(esCorreoVerificado(copia.correo) && (copia.titular === null || esCorreoVerificado(copia.titular)));
  exigir(copia.idEntrada === null || esIdEntrada(copia.idEntrada));
  exigir(copia.idSesion === null || esIdSesion(copia.idSesion));
  exigir(copia.motivo === null || copia.motivo === 'inactividad' || copia.motivo === 'duracion');
  return {
    instante: copia.instante,
    tipo: copia.tipo as TipoRegistroPanel,
    correo: copia.correo,
    idEntrada: copia.idEntrada,
    idSesion: copia.idSesion,
    motivo: copia.motivo,
    titular: copia.titular,
  };
}
export function leerRegistroPanel(entrada: unknown): readonly FilaRegistroPanel[] {
  exigir(Array.isArray(entrada) && entrada.length <= FILAS_LECTURA_REGISTRO_PANEL);
  return entrada.map(leerFilaRegistroPanel);
}
