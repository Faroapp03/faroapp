/** Acceso temporal al recorrido inactivo; la autoridad de modo y de intentos es externa y durable. */
import { aBase64Url, deBase64Url } from '../../comun/base64url.js';
import { ESTADO_HTTP } from '../../comun/estados-http.ts';
import { type DecisionDelLimite, VENTANA_MS } from '../acceso-publico/limite-continuo-sqlite.ts';
import { esNavegacion } from '../navegacion.ts';
import { rutaDeVariante, type VarianteRecorrido, varianteInstalada } from '../variantes-recorrido.ts';
import { CABECERA_LIMITE, LIMITE_SATURADO, TEXTOS_ACCESO } from './textos-acceso.ts';

export interface ModoRecorrido {
  readonly version: 1;
  readonly revision: number;
  readonly modo: VarianteRecorrido;
}
export interface OpcionesAccesoRecorrido {
  readonly variante: VarianteRecorrido;
  readonly clave: unknown;
  readonly firma: unknown;
  readonly leerModo: () => Promise<ModoRecorrido>;
  /** Registra atómicamente el intento en la autoridad compartida; false significa cuota agotada. */
  readonly consumirIntento: (peticion: Request) => Promise<DecisionDelLimite>;
  readonly delegar: (peticion: Request) => Promise<Response>;
  readonly ahora?: () => number;
}
const COOKIE = '__Host-faro-recorrido';
const VIDA_SEGUNDOS = 900;
const BYTES_NONCE = 16;
const PARTES_COOKIE = 3;
const REDIRECCION = 303;
const MS_POR_SEGUNDO = 1000;
const MAX_CUERPO = 1024;
const MAX_CLAVE = 256;
const MIN_CLAVE = 12;
const MIN_FIRMA = 32;
const HMAC = { name: 'HMAC', hash: 'SHA-256' } as const;
const encoder = new TextEncoder();
/**
 * Espera que anuncia el 429: la ventana del limitador del recorrido (limite-recorrido.ts), cota superior de lo que tarda
 * en dejar de contar el intento más antiguo. Es la misma espera que dice el aviso de demasiados intentos.
 */
const ESPERA_TRAS_LIMITE_S = String(VENTANA_MS / MS_POR_SEGUNDO);
/**
 * La marca de lo que entrega este acceso: «acceso» en todo lo que contesta por sí mismo (respuesta: el formulario con
 * cualquier estado, la redirección tras entrar, el 403 vacío a lo que no es una navegación sin sesión, sus demás 403,
 * el 405 y el 503) y «temporal» en la página delegada con la sesión temporal (conSesionTemporal). Solo la variante del
 * modo activo, delegada sin sesión, no la lleva. El service worker no guarda nada marcado en la copia sin conexión
 * (src/service-worker/copia.js, noSirveComoCopia) y, si la entrada del recorrido real llega marcada, la saca de la copia
 * (siEstaProtegido): sin red no se amplía lo protegido.
 */
const MARCA_DEL_ACCESO = 'x-faro-recorrido';

function respuesta(estado: number, contenido: string | null = null, extra: Record<string, string> = {}): Response {
  return new Response(contenido, {
    status: estado,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      [MARCA_DEL_ACCESO]: 'acceso',
      ...extra,
    },
  });
}

/** La página delegada con la sesión temporal, con su marca (MARCA_DEL_ACCESO). */
function conSesionTemporal(delegada: Response): Response {
  const marcada = new Response(delegada.body, delegada);
  marcada.headers.set(MARCA_DEL_ACCESO, 'temporal');
  return marcada;
}
/** Lo que dice la página tras un intento que no entra: la contraseña no vale, demasiados intentos o servicio caído. */
type Aviso = 'rechazo' | 'intentos' | 'saturacion' | 'servicio';

// El fragmento nunca sale del navegador: solo se vuelve a leer al recargar tras confirmar la cookie. El aviso de cada
// rechazo lo decide su estado HTTP (y, en un 429, la cabecera de saturación), lo mismo que, sin JavaScript, elige la
// página que llega con el envío nativo.
function guionAcceso(avisos: Readonly<Record<Aviso, string>>): string {
  return `
const formulario = document.getElementById('acceso-recorrido');
const aviso = document.getElementById('acceso-error');
const avisos = ${JSON.stringify(avisos).replaceAll('<', '\\u003c')};
formulario.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const boton = formulario.querySelector('button');
  boton.disabled = true;
  aviso.hidden = true;
  let causa = 'rechazo';
  try {
    const respuesta = await fetch(formulario.action, {
      method: 'POST', mode: 'cors', credentials: 'same-origin', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(new FormData(formulario)),
    });
    if (respuesta.type === 'opaqueredirect') {
      const destino = new URL(formulario.action);
      if (destino.pathname === location.pathname) location.reload();
      else location.replace(destino.href + location.hash);
      return;
    }
    const saturado = respuesta.headers.get('${CABECERA_LIMITE}') === '${LIMITE_SATURADO}';
    causa = respuesta.status === 429 ? (saturado ? 'saturacion' : 'intentos') : respuesta.status === 503 ? 'servicio' : 'rechazo';
  } catch {}
  aviso.textContent = avisos[causa];
  aviso.hidden = false;
  boton.disabled = false;
});`;
}

/**
 * Los textos de la página en el idioma preferido del navegador; los avisos de intentos, saturación y servicio, los
 * del acceso.
 */
function textosDe(peticion: Request) {
  const idioma = /^ca(?:-|$)/i.test(
    (peticion.headers.get('accept-language') ?? '').split(',')[0]?.split(';')[0]?.trim() ?? '',
  )
    ? 'ca'
    : 'es';
  const propios =
    idioma === 'ca'
      ? {
          titulo: 'Accés al recorregut',
          clave: 'Contrasenya',
          entrar: 'Entrar',
          rechazo: 'No s’ha pogut accedir. Torna-ho a provar.',
        }
      : {
          titulo: 'Acceso al recorrido',
          clave: 'Contraseña',
          entrar: 'Entrar',
          rechazo: 'No se ha podido acceder. Vuelve a intentarlo.',
        };
  const avisos: Readonly<Record<Aviso, string>> = {
    rechazo: propios.rechazo,
    intentos: TEXTOS_ACCESO[idioma]['error-intentos'],
    saturacion: TEXTOS_ACCESO[idioma]['error-saturacion'],
    servicio: TEXTOS_ACCESO[idioma]['error-servicio'],
  };
  return { idioma, ...propios, avisos };
}

/**
 * La página del acceso, en la misma dirección que protege: con 200 si se pide la página; tras un intento que no entra,
 * con su estado (403, 429 o 503) y su aviso a la vista, para que el envío nativo no deje una página en blanco. Lleva el
 * formulario si la variante está instalada. Sin esquema HTTP para este formulario no cabe un 401, que exige un desafío
 * (RFC 9110, 15.5.2).
 */
function formulario(
  variante: VarianteRecorrido,
  peticion: Request,
  estado: number,
  { aviso = null, extra = {} }: { readonly aviso?: Aviso | null; readonly extra?: Record<string, string> } = {},
): Response {
  const textos = textosDe(peticion);
  const conFormulario = varianteInstalada(variante);
  const nonce = aBase64Url(crypto.getRandomValues(new Uint8Array(BYTES_NONCE)));
  const campos = conFormulario
    ? `<form id="acceso-recorrido" method="post" action="${rutaDeVariante(variante)}"><label>${textos.clave} <input name="clave" type="password" required autocomplete="current-password"></label><button type="submit">${textos.entrar}</button></form>`
    : '';
  const avisoVisible = `<p id="acceso-error" role="status"${aviso ? '' : ' hidden'}>${textos.avisos[aviso ?? 'rechazo']}</p>`;
  const guion = conFormulario ? `<script nonce="${nonce}">${guionAcceso(textos.avisos)}</script>` : '';
  const pagina = `<!doctype html><html lang="${textos.idioma}"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="icon" href="data:,"><title>${textos.titulo}</title><main><h1>${textos.titulo}</h1>${campos}${avisoVisible}</main>${guion}</html>`;
  // Con no-referrer, el envío nativo del formulario saldría con «Origin: null» (Fetch, serializar el origen de una
  // petición) y la comprobación de origen lo rechazaría; same-origin solo da el origen y la dirección al propio sitio.
  return respuesta(estado, peticion.method === 'HEAD' ? null : pagina, {
    'content-security-policy': `default-src 'none'; img-src data:; script-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
    'referrer-policy': 'same-origin',
    ...extra,
  });
}
/** 503 del acceso: a una navegación o al envío del formulario, la página con su aviso; a lo demás, sin cuerpo. */
export function accesoNoDisponible(peticion: Request, variante: VarianteRecorrido): Response {
  const lectura = peticion.method === 'GET' || peticion.method === 'HEAD';
  return peticion.method === 'POST' || (lectura && esNavegacion(peticion))
    ? formulario(variante, peticion, ESTADO_HTTP.noDisponible, { aviso: 'servicio' })
    : respuesta(ESTADO_HTTP.noDisponible);
}
function secretosValidos(clave: unknown, firma: unknown): clave is string {
  return (
    typeof clave === 'string' &&
    clave.length >= MIN_CLAVE &&
    clave.length <= MAX_CLAVE &&
    typeof firma === 'string' &&
    encoder.encode(firma).byteLength >= MIN_FIRMA &&
    firma !== clave
  );
}
async function claveHmac(secreto: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secreto), HMAC, false, ['sign', 'verify']);
}
function mensaje(variante: VarianteRecorrido, revision: number, caduca: number): Uint8Array<ArrayBuffer> {
  return encoder.encode(`faro/acceso-recorrido/v1.${variante}.${revision}.${caduca}`);
}
async function crearCookie(
  firma: string,
  variante: VarianteRecorrido,
  revision: number,
  ahora: number,
): Promise<string> {
  const caduca = Math.floor(ahora / MS_POR_SEGUNDO) + VIDA_SEGUNDOS;
  const mac = aBase64Url(
    new Uint8Array(await crypto.subtle.sign('HMAC', await claveHmac(firma), mensaje(variante, revision, caduca))),
  );
  return `${COOKIE}=${revision}.${caduca}.${mac}; Path=/; Max-Age=${VIDA_SEGUNDOS}; Secure; HttpOnly; SameSite=Strict`;
}
async function sesionValida(
  peticion: Request,
  firma: string,
  { variante, revision, ahora }: { variante: VarianteRecorrido; revision: number; ahora: number },
): Promise<boolean> {
  const valores = (peticion.headers.get('cookie') ?? '')
    .split(';')
    .map((valor) => valor.trim())
    .filter((valor) => valor.startsWith(`${COOKIE}=`));
  if (valores.length !== 1) {
    return false;
  }
  const partes = valores[0]?.slice(COOKIE.length + 1).split('.');
  if (
    partes?.length !== PARTES_COOKIE ||
    !/^\d+$/.test(partes[0] ?? '') ||
    !/^\d+$/.test(partes[1] ?? '') ||
    !/^[A-Za-z0-9_-]{43}$/.test(partes[2] ?? '')
  ) {
    return false;
  }
  const numeroRevision = Number(partes[0]);
  const caduca = Number(partes[1]);
  if (
    numeroRevision !== revision ||
    !Number.isSafeInteger(caduca) ||
    caduca <= Math.floor(ahora / MS_POR_SEGUNDO) ||
    caduca > Math.floor(ahora / MS_POR_SEGUNDO) + VIDA_SEGUNDOS
  ) {
    return false;
  }
  const mac = deBase64Url(partes[2] ?? '');
  return (
    !!mac &&
    aBase64Url(mac) === partes[2] &&
    crypto.subtle.verify('HMAC', await claveHmac(firma), mac, mensaje(variante, revision, caduca))
  );
}
async function leerClave(peticion: Request): Promise<string | null> {
  if (
    peticion.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/x-www-form-urlencoded' ||
    !peticion.body
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
  const formulario = new URLSearchParams(texto);
  const claves = formulario.getAll('clave');
  if (claves.length !== 1 || [...formulario.keys()].length !== 1 || (claves[0]?.length ?? 0) > MAX_CLAVE) {
    return null;
  }
  return claves[0] ?? null;
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

async function coinciden(a: string, b: string): Promise<boolean> {
  const [primero, segundo] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ]);
  const x = new Uint8Array(primero);
  const y = new Uint8Array(segundo);
  let diferencia = 0;
  for (const [i, byte] of x.entries()) {
    const otro = y[i];
    if (otro === undefined) {
      return false;
    }
    diferencia |= byte ^ otro;
  }
  return diferencia === 0;
}
async function modoValido(leer: () => Promise<ModoRecorrido>): Promise<ModoRecorrido | null> {
  try {
    const modo = await leer();
    return modo &&
      modo.version === 1 &&
      Number.isSafeInteger(modo.revision) &&
      modo.revision >= 0 &&
      (modo.modo === 'real' || modo.modo === 'demo')
      ? modo
      : null;
  } catch {
    return null;
  }
}
/** Un modo histórico sin variante instalada exige recuperación administrativa explícita. */
function modoDisponible(modo: ModoRecorrido, variante: VarianteRecorrido): boolean {
  return varianteInstalada(modo.modo) && varianteInstalada(variante);
}

export async function responderAccesoRecorrido(
  peticion: Request,
  opciones: OpcionesAccesoRecorrido,
): Promise<Response> {
  if (new URL(peticion.url).protocol !== 'https:') {
    return respuesta(ESTADO_HTTP.prohibido);
  }
  const modo = await modoValido(opciones.leerModo);
  if (!modo || !modoDisponible(modo, opciones.variante)) {
    return accesoNoDisponible(peticion, opciones.variante);
  }
  const lectura = peticion.method === 'GET' || peticion.method === 'HEAD';
  if (opciones.variante === modo.modo && lectura) {
    return opciones.delegar(peticion);
  }
  if (!secretosValidos(opciones.clave, opciones.firma) || typeof opciones.firma !== 'string') {
    return accesoNoDisponible(peticion, opciones.variante);
  }
  const ahora = opciones.ahora?.() ?? Date.now();
  if (lectura) {
    return responderLectura(peticion, { ...opciones, firma: opciones.firma }, modo.revision, ahora);
  }
  if (peticion.method !== 'POST' || opciones.variante === modo.modo) {
    return respuesta(ESTADO_HTTP.metodoNoAdmitido);
  }
  return procesarIntento(peticion, { ...opciones, clave: opciones.clave, firma: opciones.firma }, modo.revision, ahora);
}
async function responderLectura(
  peticion: Request,
  opciones: OpcionesAccesoRecorrido & { firma: string },
  revision: number,
  ahora: number,
): Promise<Response> {
  if (await sesionValida(peticion, opciones.firma, { variante: opciones.variante, revision, ahora })) {
    return conSesionTemporal(await opciones.delegar(peticion));
  }
  // A un módulo o un dato no se le entrega el formulario: se tomaría por ese archivo. El 403 vacío lleva la marca.
  return esNavegacion(peticion)
    ? formulario(opciones.variante, peticion, ESTADO_HTTP.correcto)
    : respuesta(ESTADO_HTTP.prohibido);
}
async function procesarIntento(
  peticion: Request,
  opciones: OpcionesAccesoRecorrido & { clave: string; firma: string },
  revision: number,
  ahora: number,
): Promise<Response> {
  const url = new URL(peticion.url);
  const sitio = peticion.headers.get('sec-fetch-site');
  if (
    url.protocol !== 'https:' ||
    peticion.headers.get('origin') !== url.origin ||
    (sitio !== null && sitio !== 'same-origin')
  ) {
    return respuesta(ESTADO_HTTP.prohibido);
  }
  let permitido: DecisionDelLimite;
  try {
    permitido = await opciones.consumirIntento(peticion);
  } catch {
    return formulario(opciones.variante, peticion, ESTADO_HTTP.noDisponible, { aviso: 'servicio' });
  }
  if (permitido === 'saturado') {
    return formulario(opciones.variante, peticion, ESTADO_HTTP.demasiadasPeticiones, {
      aviso: 'saturacion',
      extra: { 'retry-after': ESPERA_TRAS_LIMITE_S, [CABECERA_LIMITE]: LIMITE_SATURADO },
    });
  }
  if (!permitido) {
    return formulario(opciones.variante, peticion, ESTADO_HTTP.demasiadasPeticiones, {
      aviso: 'intentos',
      extra: { 'retry-after': ESPERA_TRAS_LIMITE_S },
    });
  }
  const recibida = await leerClave(peticion);
  if (recibida === null || !(await coinciden(opciones.clave, recibida))) {
    return formulario(opciones.variante, peticion, ESTADO_HTTP.prohibido, { aviso: 'rechazo' });
  }
  const cookie = await crearCookie(opciones.firma, opciones.variante, revision, ahora);
  return respuesta(REDIRECCION, null, { location: rutaDeVariante(opciones.variante), 'set-cookie': cookie });
}
