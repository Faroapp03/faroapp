/** Puerta web del portal: el limitador es una autoridad durable compartida, no memoria de la instancia aislada del Worker. */
import { aBase64Url, deBase64Url } from '../../comun/base64url.js';
import { ESTADO_HTTP } from '../../comun/estados-http.ts';
import {
  type DecisionDelLimite,
  type IdentificadoresLimite,
  VENTANA_MS,
} from '../acceso-publico/limite-continuo-sqlite.ts';
import { RUTA_ESTADO_DEL_PORTAL } from '../estado-del-portal.ts';
import { esEnvioDeAvisos } from './canales-portal.ts';
import { identificadoresLimitePortal } from './limite-portal.ts';
import { DEL_PORTAL_PRIVADO, PANTALLA_ACCESO, respuestaSinSesion } from './sin-sesion.ts';
import { CABECERA_LIMITE, LIMITE_SATURADO } from './textos-acceso.ts';

export interface OpcionesAccesoPortal {
  readonly clave: unknown;
  readonly firma: unknown;
  readonly claveLimite: unknown;
  readonly registrarSesion: (huella: string, caduca: number) => Promise<void>;
  readonly sesionActiva: (huella: string) => Promise<boolean>;
  readonly revocarSesion: (huella: string) => Promise<void>;
  /** Si el almacén puede guardar ahora una sesión más; se pregunta antes de mirar las credenciales. */
  readonly sesionesDisponibles: () => Promise<boolean>;
  readonly consumirIntento: (huella: IdentificadoresLimite) => Promise<DecisionDelLimite>;
  readonly paginaAcceso: (peticion: Request) => Response | Promise<Response>;
  readonly delegar: (peticion: Request) => Promise<Response>;
  readonly ahora?: () => number;
}
const COOKIE = '__Host-faro-portal';
const SEGUNDOS = 3600;
const MILISEGUNDOS = 1000;
const MIN_SECRETO = 32;
const BASE_HEXADECIMAL = 16;
const MAX_CLAVE = 256;
const MAX_CUERPO = 2048;
const BYTES_ALEATORIOS = 16;
const TRES_PARTES = 3;
const HMAC = { name: 'HMAC', hash: 'SHA-256' } as const;
const encoder = new TextEncoder();
/**
 * Espera que anuncia el 429. El limitador cuenta los intentos en una ventana deslizante y no registra los que rechaza:
 * en el peor caso, el intento más antiguo deja de contar al cumplirse la ventana entera. La ventana es, por tanto, una
 * cota superior de la espera. El resto real exigiría que la autoridad durable devolviera la caducidad del
 * intento más antiguo, no solo si se permite el siguiente. Es la misma espera que dice el aviso de la pantalla.
 */
const ESPERA_TRAS_LIMITE_S = String(VENTANA_MS / MILISEGUNDOS);

function noDisponible(): Response {
  return new Response(null, { status: ESTADO_HTTP.noDisponible, headers: { 'cache-control': 'no-store' } });
}
/** Un rechazo del portal (403, 405 o 429), con x-faro-portal: privado (DEL_PORTAL_PRIVADO). */
function sinAcceso(estado: number): Response {
  return new Response(null, {
    status: estado,
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...DEL_PORTAL_PRIVADO },
  });
}
function clavesValidas(
  opciones: OpcionesAccesoPortal,
): opciones is OpcionesAccesoPortal & { clave: string; firma: string; claveLimite: string } {
  const { clave, firma, claveLimite } = opciones;
  return (
    typeof clave === 'string' &&
    clave.length > 0 &&
    clave.length <= MAX_CLAVE &&
    typeof firma === 'string' &&
    encoder.encode(firma).length >= MIN_SECRETO &&
    typeof claveLimite === 'string' &&
    encoder.encode(claveLimite).length >= MIN_SECRETO &&
    firma !== clave &&
    claveLimite !== clave &&
    claveLimite !== firma
  );
}
async function hmac(secreto: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secreto), HMAC, false, ['sign', 'verify']);
}
function mensaje(caduca: string, nonce: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(`faro/sesion-portal/v2.${caduca}.${nonce}`);
}
async function huellaDeNonce(nonce: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(`faro/sesion-portal/huella/v1.${nonce}`));
  return Array.from(new Uint8Array(hash), (b) => b.toString(BASE_HEXADECIMAL).padStart(2, '0')).join('');
}
async function cookieNueva(firma: string, ahora: number): Promise<{ cookie: string; huella: string; caduca: number }> {
  const caduca = String(Math.floor(ahora / MILISEGUNDOS) + SEGUNDOS);
  const nonce = aBase64Url(crypto.getRandomValues(new Uint8Array(BYTES_ALEATORIOS)));
  const mac = aBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', await hmac(firma), mensaje(caduca, nonce))));
  return {
    cookie: `${COOKIE}=${caduca}.${nonce}.${mac}; Path=/; Max-Age=${SEGUNDOS}; Secure; HttpOnly; SameSite=Strict`,
    huella: await huellaDeNonce(nonce),
    caduca: Number(caduca),
  };
}
async function sesionValida(peticion: Request, firma: string, ahora: number): Promise<{ huella: string } | null> {
  const coincidencias = (peticion.headers.get('cookie') ?? '')
    .split(';')
    .map((c) => c.trim())
    .filter((c) => c.startsWith(`${COOKIE}=`));
  if (coincidencias.length !== 1) {
    return null;
  }
  const partes = coincidencias[0]?.slice(COOKIE.length + 1).split('.');
  if (
    partes?.length !== TRES_PARTES ||
    !/^\d+$/.test(partes[0] ?? '') ||
    !/^[A-Za-z0-9_-]{22}$/.test(partes[1] ?? '') ||
    !/^[A-Za-z0-9_-]{43}$/.test(partes[2] ?? '')
  ) {
    return null;
  }
  const [caduca = '', nonce = '', macTexto = ''] = partes;
  const tiempo = Number(caduca);
  const presente = Math.floor(ahora / MILISEGUNDOS);
  if (!Number.isSafeInteger(tiempo) || tiempo <= presente || tiempo > presente + SEGUNDOS) {
    return null;
  }
  const mac = deBase64Url(macTexto);
  const aleatorio = deBase64Url(nonce);
  if (
    !mac ||
    !aleatorio ||
    aBase64Url(mac) !== macTexto ||
    aBase64Url(aleatorio) !== nonce ||
    !(await crypto.subtle.verify('HMAC', await hmac(firma), mac, mensaje(caduca, nonce)))
  ) {
    return null;
  }
  return { huella: await huellaDeNonce(nonce) };
}
async function leerFormulario(peticion: Request): Promise<{ usuario: string; clave: string } | null> {
  if (
    !peticion.body ||
    peticion.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/x-www-form-urlencoded'
  ) {
    return null;
  }
  const bytes = await leerCuerpo(peticion.body);
  if (!bytes) {
    return null;
  }
  let texto: string;
  try {
    texto = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  const datos = new URLSearchParams(texto);
  const usuario = datos.getAll('usuario');
  const clave = datos.getAll('clave');
  if (
    usuario.length !== 1 ||
    clave.length !== 1 ||
    [...datos.keys()].length !== 2 ||
    !usuario[0] ||
    clave[0] === undefined ||
    clave[0].length > MAX_CLAVE
  ) {
    return null;
  }
  return { usuario: usuario[0], clave: clave[0] };
}
async function leerCuerpo(cuerpo: ReadableStream<Uint8Array>): Promise<Uint8Array | null> {
  const lector = cuerpo.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const parte = await lector.read();
      if (parte.done) {
        break;
      }
      total += parte.value.byteLength;
      if (total > MAX_CUERPO) {
        return null;
      }
      partes.push(parte.value);
    }
  } finally {
    try {
      await lector.cancel();
    } finally {
      lector.releaseLock();
    }
  }
  const bytes = new Uint8Array(total);
  let posicion = 0;
  for (const parte of partes) {
    bytes.set(parte, posicion);
    posicion += parte.byteLength;
  }
  return bytes;
}
async function credencialesCorrectas(usuario: string, clave: string, esperada: string): Promise<boolean> {
  const entradas = [usuario, 'Faro', clave, esperada].map((valor) =>
    crypto.subtle.digest('SHA-256', encoder.encode(valor)),
  );
  const [u, eu, p, ep] = await Promise.all(entradas);
  if (!u || !eu || !p || !ep) {
    return false;
  }
  const pares = [
    [new Uint8Array(u), new Uint8Array(eu)],
    [new Uint8Array(p), new Uint8Array(ep)],
  ] as const;
  let diferencia = 0;
  for (const [a, b] of pares) {
    for (const [i, byte] of a.entries()) {
      const otro = b[i];
      if (otro === undefined) {
        return false;
      }
      diferencia |= byte ^ otro;
    }
  }
  return diferencia === 0;
}
function origenSeguro(peticion: Request): boolean {
  const url = new URL(peticion.url);
  const sitio = peticion.headers.get('sec-fetch-site');
  return peticion.headers.get('origin') === url.origin && (sitio === null || sitio === 'same-origin');
}
async function autenticar(
  peticion: Request,
  opciones: OpcionesAccesoPortal & { clave: string; firma: string; claveLimite: string },
  ahora: number,
): Promise<Response> {
  if (!origenSeguro(peticion)) {
    return sinAcceso(ESTADO_HTTP.prohibido);
  }
  let permitido: DecisionDelLimite;
  try {
    permitido = await opciones.consumirIntento(
      await identificadoresLimitePortal(peticion, opciones.claveLimite, ahora),
    );
  } catch {
    return noDisponible();
  }
  if (permitido !== true) {
    const limitada = sinAcceso(ESTADO_HTTP.demasiadasPeticiones);
    limitada.headers.set('retry-after', ESPERA_TRAS_LIMITE_S);
    if (permitido === 'saturado') {
      limitada.headers.set(CABECERA_LIMITE, LIMITE_SATURADO);
    }
    return limitada;
  }
  // Antes de mirar las credenciales: si no se puede guardar la sesión, la respuesta es 503 sea cual sea la contraseña.
  // Si solo fallara al guardar, una caída parcial respondería 503 a la correcta y 403 a las demás, y diría cuál es.
  // Cuesta una ida y vuelta más al objeto durable, de solo lectura, por cada intento que el limitador admite: como mucho
  // MAX_INTENTOS (10) por IP en cada ventana de 15 minutos, y nunca por encima del limitador, que va antes.
  if (!(await sesionesDisponibles(opciones))) {
    return noDisponible();
  }
  const datos = await leerFormulario(peticion);
  // Sin desafío HTTP para un formulario no cabe un 401; el guion de la pantalla trata cualquier rechazo como error.
  if (!datos || !(await credencialesCorrectas(datos.usuario, datos.clave, opciones.clave))) {
    return sinAcceso(ESTADO_HTTP.prohibido);
  }
  const sesion = await cookieNueva(opciones.firma, ahora);
  // Queda una ventana inevitable: que el almacén caiga o se llene entre la comprobación de arriba y este registro, en
  // la misma petición. Cerrarla exigiría comprobar las credenciales dentro del almacén, que no conoce la clave. Dura lo
  // que tarda una petición y nadie de fuera puede provocarla a voluntad.
  try {
    await opciones.registrarSesion(sesion.huella, sesion.caduca);
  } catch {
    return noDisponible();
  }
  return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store', 'set-cookie': sesion.cookie } });
}
/** Si el almacén de sesiones responde y le cabe una más; un fallo cuenta como no disponible. */
async function sesionesDisponibles(opciones: OpcionesAccesoPortal): Promise<boolean> {
  try {
    return await opciones.sesionesDisponibles();
  } catch {
    return false;
  }
}
function sinCookiePortal(peticion: Request): Request {
  const headers = new Headers(peticion.headers);
  const cookies = (headers.get('cookie') ?? '')
    .split(';')
    .map((c) => c.trim())
    .filter((c) => c && !c.startsWith(`${COOKIE}=`));
  if (cookies.length) {
    headers.set('cookie', cookies.join('; '));
  } else {
    headers.delete('cookie');
  }
  return new Request(peticion, { headers });
}
async function salir(
  peticion: Request,
  opciones: OpcionesAccesoPortal & { firma: string },
  ahora: number,
): Promise<Response> {
  if (peticion.method !== 'POST') {
    return sinAcceso(ESTADO_HTTP.metodoNoAdmitido);
  }
  if (!origenSeguro(peticion)) {
    return sinAcceso(ESTADO_HTTP.prohibido);
  }
  const sesion = await sesionValida(peticion, opciones.firma, ahora);
  if (sesion) {
    try {
      await opciones.revocarSesion(sesion.huella);
    } catch {
      return noDisponible();
    }
  }
  return Response.json(
    { ok: true },
    {
      headers: {
        'cache-control': 'no-store',
        'set-cookie': `${COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict`,
      },
    },
  );
}
export async function responderAccesoPortal(peticion: Request, opciones: OpcionesAccesoPortal): Promise<Response> {
  const url = new URL(peticion.url);
  if (url.protocol !== 'https:') {
    return sinAcceso(ESTADO_HTTP.prohibido);
  }
  if (!clavesValidas(opciones)) {
    return noDisponible();
  }
  const ahora = opciones.ahora?.() ?? Date.now();
  if (!Number.isSafeInteger(ahora) || ahora < 0) {
    return noDisponible();
  }
  // Los avisos del navegador no llevan sesión (canales-portal.ts): pasan sin mirar la cookie ni consultar las sesiones,
  // y la cookie no llega a la aplicación.
  if (esEnvioDeAvisos(peticion)) {
    return opciones.delegar(sinCookiePortal(peticion));
  }
  if (url.pathname === '/acceso-web/entrar') {
    return peticion.method === 'POST' ? autenticar(peticion, opciones, ahora) : sinAcceso(ESTADO_HTTP.metodoNoAdmitido);
  }
  if (url.pathname === '/acceso-web/salir') {
    return salir(peticion, opciones, ahora);
  }
  return responderPeticionPortal(peticion, opciones, ahora);
}
async function responderPeticionPortal(
  peticion: Request,
  opciones: OpcionesAccesoPortal & { firma: string },
  ahora: number,
): Promise<Response> {
  const url = new URL(peticion.url);
  const sesion = url.pathname !== PANTALLA_ACCESO ? await sesionValida(peticion, opciones.firma, ahora) : null;
  let activa = false;
  if (sesion) {
    try {
      activa = await opciones.sesionActiva(sesion.huella);
    } catch {
      return noDisponible();
    }
  }
  if (activa && url.pathname === RUTA_ESTADO_DEL_PORTAL) {
    return estadoConPortal(peticion.method);
  }
  if (activa) {
    const respuesta = await opciones.delegar(sinCookiePortal(peticion));
    const salida = new Response(respuesta.body, respuesta);
    salida.headers.set('cache-control', 'no-store');
    salida.headers.set('x-faro-portal', 'privado');
    return salida;
  }
  if (url.pathname === PANTALLA_ACCESO && (peticion.method === 'GET' || peticion.method === 'HEAD')) {
    return pantallaDeAcceso(peticion, opciones);
  }
  return respuestaSinSesion(peticion);
}
/** El estado a una sesión activa: GET y HEAD (sin cuerpo) como en una instalación sin portal; 405 a lo demás. */
function estadoConPortal(metodo: string): Response {
  if (metodo !== 'GET' && metodo !== 'HEAD') {
    const rechazo = sinAcceso(ESTADO_HTTP.metodoNoAdmitido);
    rechazo.headers.set('allow', 'GET, HEAD');
    return rechazo;
  }
  const estado = Response.json({ portal: true }, { headers: { 'cache-control': 'no-store' } });
  return metodo === 'HEAD' ? new Response(null, estado) : estado;
}
/** La pantalla conserva el estado que decida su página y nunca se guarda. */
async function pantallaDeAcceso(peticion: Request, opciones: OpcionesAccesoPortal): Promise<Response> {
  const pantalla = await opciones.paginaAcceso(peticion);
  const headers = new Headers(pantalla.headers);
  headers.set('cache-control', 'no-store');
  return new Response(peticion.method === 'HEAD' ? null : pantalla.body, { status: pantalla.status, headers });
}
