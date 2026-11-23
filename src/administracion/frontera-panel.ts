/**
 * La frontera de las rutas del panel que atiende un enrutador propio, con las mismas comprobaciones y en el mismo
 * orden que el enrutador general (http.ts): origen exacto y POST, cabeceras del panel, identidad de Access, token de
 * la sesión y cuerpo JSON limitado. Las respuestas no llevan mensajes, pilas, identidad ni nada del cuerpo recibido.
 */
import { leerTextoLimitado } from '../api/cuerpo.ts';
import { PeticionCancelada, PlazoAgotado, SolicitudInvalida } from '../api/errores.ts';
import { aBase64Url, deBase64Url } from '../comun/base64url.js';
import { ESTADO_HTTP } from '../comun/estados-http.ts';
import { sha256Hex } from '../comun/huella.ts';
import { esObjeto } from '../comun/json.ts';
import type { GuardiaAdministrativa } from '../plataforma/acceso-administrativo.ts';
import { MAX_CUERPO_PANEL_BYTES } from './http.ts';
import type { AccesoSesionPanel, EstadoSesionPanel } from './sesion.ts';
import { huellaDePrincipal } from './sesion-unica-http.ts';

const BYTES_TOKEN_PANEL = 32;
const TOKEN_PANEL = /^[A-Za-z0-9_-]{43}$/;

export class RechazoPanel extends Error {
  readonly estado: number;
  readonly codigo: string;
  constructor(estado: number, codigo: string) {
    super(codigo);
    this.estado = estado;
    this.codigo = codigo;
  }
}
export function rechazar(estado: number, codigo: string): never {
  throw new RechazoPanel(estado, codigo);
}
export function respuestaPanel(datos: object, estado: number = ESTADO_HTTP.correcto): Response {
  return Response.json(datos, {
    status: estado,
    headers: {
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
  });
}
/** La sesión inactiva es un 403 sin desafío y la sustituida un 409: el panel las reconoce por su cuerpo. */
export function respuestaSesionPanel(sesion: EstadoSesionPanel): Response {
  if (sesion.estado === 'activa') {
    return respuestaPanel({ sesion });
  }
  if (sesion.estado === 'sustituida') {
    return respuestaPanel({ error: 'sesion_sustituida' }, ESTADO_HTTP.conflicto);
  }
  return respuestaPanel({ error: 'sesion_inactiva' }, ESTADO_HTTP.prohibido);
}

/** Dirección exacta en el origen canónico, solo POST y las cabeceras que solo envía el propio panel. */
export function comprobarPeticionPanel(peticion: Request, origen: string): void {
  const url = new URL(peticion.url);
  if (url.origin !== origen || url.href !== `${origen}${url.pathname}`) {
    rechazar(ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida');
  }
  if (peticion.method !== 'POST') {
    rechazar(ESTADO_HTTP.metodoNoAdmitido, 'metodo_no_admitido');
  }
  if (
    peticion.headers.get('origin') !== origen ||
    peticion.headers.get('x-faro-panel') !== '1' ||
    peticion.headers.get('sec-fetch-site') !== 'same-origin'
  ) {
    rechazar(ESTADO_HTTP.prohibido, 'origen_no_permitido');
  }
  if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(peticion.headers.get('content-type') ?? '')) {
    rechazar(ESTADO_HTTP.tipoNoAdmitido, 'tipo_no_admitido');
  }
}

/** Las huellas que guarda la sesión: las mismas que calcula el enrutador general para el mismo token y la misma identidad. */
export async function accesoDelPanel(peticion: Request, guardia: GuardiaAdministrativa): Promise<AccesoSesionPanel> {
  const principal = await guardia(peticion);
  if (!principal) {
    rechazar(ESTADO_HTTP.prohibido, 'acceso_denegado');
  }
  const token = peticion.headers.get('x-faro-sesion') ?? '';
  const bytes = TOKEN_PANEL.test(token) ? deBase64Url(token) : null;
  if (!bytes || bytes.byteLength !== BYTES_TOKEN_PANEL || aBase64Url(bytes) !== token) {
    rechazar(ESTADO_HTTP.prohibido, 'sesion_inactiva');
  }
  return { huellaSesion: sha256Hex(token), huellaPrincipal: huellaDePrincipal(principal) };
}

/** El tope se aplica al tamaño declarado y también al flujo, que puede llegar sin content-length. */
function conCuerpoLimitado(peticion: Request): Request {
  if (!peticion.body) {
    return peticion;
  }
  let leidos = 0;
  const limite = new TransformStream<Uint8Array, Uint8Array>({
    transform(trozo, controlador) {
      leidos += trozo.byteLength;
      if (leidos > MAX_CUERPO_PANEL_BYTES) {
        throw new SolicitudInvalida('Cuerpo administrativo demasiado grande');
      }
      controlador.enqueue(trozo);
    },
  });
  const inicio: RequestInit & { duplex: 'half' } = { body: peticion.body.pipeThrough(limite), duplex: 'half' };
  return new Request(peticion, inicio);
}
export async function cuerpoDelPanel(peticion: Request): Promise<Record<string, unknown>> {
  const declarado = peticion.headers.get('content-length');
  if (declarado !== null && (!/^(0|[1-9]\d*)$/.test(declarado) || Number(declarado) > MAX_CUERPO_PANEL_BYTES)) {
    rechazar(ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida');
  }
  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(await leerTextoLimitado(conCuerpoLimitado(peticion)));
  } catch (error) {
    if (error instanceof SyntaxError) {
      rechazar(ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida');
    }
    throw error;
  }
  if (!esObjeto(cuerpo)) {
    rechazar(ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida');
  }
  return cuerpo;
}

export function respuestaDeErrorPanel(error: unknown): Response {
  if (error instanceof RechazoPanel) {
    return respuestaPanel({ error: error.codigo }, error.estado);
  }
  if (error instanceof PlazoAgotado) {
    return respuestaPanel({ error: 'tiempo_agotado' }, ESTADO_HTTP.tiempoAgotado);
  }
  if (error instanceof PeticionCancelada || error instanceof SolicitudInvalida) {
    return respuestaPanel({ error: 'solicitud_invalida' }, ESTADO_HTTP.solicitudIncorrecta);
  }
  return respuestaPanel({ error: 'no_disponible' }, ESTADO_HTTP.noDisponible);
}
