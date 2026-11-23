/**
 * Canal de avisos por correo con el enlace `send_email` de los Workers de Cloudflare. El destino es el que guarda la
 * autoridad y solo se usa si quien lo recibe lo ha confirmado. La dirección no sale de aquí: ni en el resultado, ni en
 * un error, ni en un registro; solo va dentro del mensaje.
 *
 * `send` admite un objeto plano (`{ to, from, subject, text }`) y devuelve `{ messageId }`; no hace falta nada de
 * `cloudflare:email` ni componer el mensaje a mano. Un rechazo es un `Error` con una propiedad `code` de texto: se
 * traduce a un motivo cerrado y el mensaje del error, que puede llevar la dirección, no se copia nunca.
 */
import { dentroDelPlazo } from '../api/plazo.ts';
import type { VariablesDelEntorno } from '../comun/entorno.ts';
import type { CuerpoAvisoVigilante } from './aviso-vigilante.ts';
import type { DestinoAvisos } from './avisos-destino.ts';
import { type MotivoFalloAviso, PLAZO_AVISO_MS } from './envio-aviso.ts';
import { motivoDeLaCausa } from './fallo-programado.ts';
import {
  CabeceraNoAdmitida,
  direccionParaCabecera,
  type MensajeCorreo,
  mensajeParaElEnlace,
  type TextoAviso,
  textoDelAviso,
} from './mensaje-aviso-correo.ts';

export interface EnlaceCorreo {
  send(mensaje: MensajeCorreo): Promise<unknown>;
}
/**
 * El enlace `send_email` del entorno (`AVISOS_CORREO`) como enlace del canal: un objeto con `send`. Cualquier otra
 * cosa es que el enlace no está configurado. No depende de Cloudflare: lo usan el Worker al montar el canal y el objeto
 * durable al decir en qué estado está.
 */
export function enlaceCorreoDelEntorno(enlace: unknown): EnlaceCorreo | undefined {
  const valido =
    typeof enlace === 'object' && enlace !== null && typeof (enlace as { send?: unknown }).send === 'function';
  return valido ? (enlace as EnlaceCorreo) : undefined;
}
export interface CanalCorreo {
  readonly enlace: EnlaceCorreo;
  readonly remitente: string;
}
/** Por qué el canal no ha intentado nada. No es un fallo del envío: no queda como intento en el registro. */
export type MotivoCorreoNoEnviado = 'sin-destino' | 'destino-sin-verificar' | 'destino-no-admitido';
/**
 * Por qué el enlace no ha aceptado el mensaje, agrupado por lo que tiene que hacer quien lo lee: configurar el
 * remitente o la cuenta, verificar el destinatario, esperar al límite, revisar el buzón de destino o volver a probar.
 */
export type MotivoFalloCorreo =
  | 'remitente-no-configurado'
  | 'destinatario-no-permitido'
  | 'limite-alcanzado'
  | 'rechazo-del-destino'
  | 'error-temporal'
  | 'plazo-agotado'
  | 'envio-rechazado';
export type ResultadoEnvioCorreo =
  | Readonly<{ resultado: 'enviado' }>
  | Readonly<{ resultado: 'fallido'; motivo: MotivoFalloCorreo }>
  | Readonly<{ resultado: 'no-enviado'; motivo: MotivoCorreoNoEnviado }>;
export type EstadoCanalCorreo = 'no-configurado' | 'configurado' | 'remitente-no-admitido';

/** Los códigos conocidos del enlace; cualquier otro, o un error sin código, es `envio-rechazado`. */
const CODIGOS_DEL_ENLACE: ReadonlyMap<string, MotivoFalloCorreo> = new Map([
  ['E_SENDER_NOT_VERIFIED', 'remitente-no-configurado'],
  ['E_SENDER_DOMAIN_NOT_AVAILABLE', 'remitente-no-configurado'],
  ['E_SENDER_DOMAIN_NOT_CONFIGURED', 'remitente-no-configurado'],
  ['E_EMAIL_SENDING_NOT_READY', 'remitente-no-configurado'],
  ['E_ACCOUNT_SUSPENDED', 'remitente-no-configurado'],
  ['E_RECIPIENT_NOT_ALLOWED', 'destinatario-no-permitido'],
  ['E_RECIPIENT_PLAN_RESTRICTED', 'destinatario-no-permitido'],
  ['E_RECIPIENT_SUPPRESSED', 'destinatario-no-permitido'],
  ['E_RATE_LIMIT_EXCEEDED', 'limite-alcanzado'],
  ['E_DAILY_LIMIT_EXCEEDED', 'limite-alcanzado'],
  ['E_DELIVERY_FAILED', 'rechazo-del-destino'],
  ['E_INTERNAL_SERVER_ERROR', 'error-temporal'],
]);

/**
 * El remitente sale de `FARO_AVISO_REMITENTE` y tiene que ser del dominio del servicio (o de un subdominio): Email
 * Routing solo envía desde el dominio donde está activado, y así nunca es una dirección personal.
 */
export function remitenteAvisoDelEntorno(
  variables: VariablesDelEntorno,
  origen: string,
): Readonly<{ estado: EstadoCanalCorreo; remitente?: string }> {
  const texto = variables.FARO_AVISO_REMITENTE;
  if (texto === undefined || texto === '') {
    return { estado: 'no-configurado' };
  }
  const servicio = new URL(origen).hostname;
  try {
    const remitente = direccionParaCabecera(texto);
    const dominio = remitente.slice(remitente.indexOf('@') + 1);
    return dominio === servicio || dominio.endsWith(`.${servicio}`)
      ? { estado: 'configurado', remitente }
      : { estado: 'remitente-no-admitido' };
  } catch (error) {
    if (error instanceof CabeceraNoAdmitida) {
      return { estado: 'remitente-no-admitido' };
    }
    throw error;
  }
}
/** El canal existe solo con el enlace en el entorno y un remitente admitido; sin ellos el producto sigue igual. */
export function canalCorreoDelEntorno(
  variables: VariablesDelEntorno,
  origen: string,
  enlace: EnlaceCorreo | undefined,
): CanalCorreo | undefined {
  const { remitente } = remitenteAvisoDelEntorno(variables, origen);
  return enlace && remitente ? { enlace, remitente } : undefined;
}
/** Solo se mira la propiedad `code`; el mensaje del error no se lee ni sale de aquí. */
export function motivoDelRechazo(causa: unknown): MotivoFalloCorreo {
  if (motivoDeLaCausa(causa) === 'plazo-agotado') {
    return 'plazo-agotado';
  }
  const codigo = causa instanceof Error ? (causa as Error & { code?: unknown }).code : undefined;
  return (typeof codigo === 'string' && CODIGOS_DEL_ENLACE.get(codigo)) || 'envio-rechazado';
}
/** El registro de intentos solo admite los motivos que el panel ya explica: el detalle del correo se agrupa en ellos. */
export function motivoParaElRegistro(motivo: MotivoFalloCorreo): MotivoFalloAviso {
  return motivo === 'plazo-agotado' ? 'plazo-agotado' : 'respuesta-no-admitida';
}
/**
 * Envía el texto a una dirección, sin mirar si está confirmada (eso lo decide quien llama). Un fallo no se lanza: se
 * devuelve con su motivo cerrado.
 */
export async function enviarTextoPorCorreo(
  canal: CanalCorreo,
  correo: string,
  texto: TextoAviso,
): Promise<ResultadoEnvioCorreo> {
  let mensaje: MensajeCorreo;
  try {
    mensaje = mensajeParaElEnlace(texto, { remitente: canal.remitente, destino: correo });
  } catch (error) {
    if (error instanceof CabeceraNoAdmitida) {
      return { resultado: 'no-enviado', motivo: 'destino-no-admitido' };
    }
    throw error;
  }
  try {
    await dentroDelPlazo(() => canal.enlace.send(mensaje), PLAZO_AVISO_MS);
    return { resultado: 'enviado' };
  } catch (causa) {
    return { resultado: 'fallido', motivo: motivoDelRechazo(causa) };
  }
}
/** Un aviso de verdad solo va a un destino confirmado; los demás casos tienen su propio motivo y no se intenta nada. */
export function enviarAvisoPorCorreo(
  canal: CanalCorreo,
  destino: DestinoAvisos,
  cuerpo: CuerpoAvisoVigilante,
): Promise<ResultadoEnvioCorreo> {
  if (destino.correo === null || destino.verificacion === 'sin_destino') {
    return Promise.resolve({ resultado: 'no-enviado', motivo: 'sin-destino' });
  }
  if (destino.verificacion !== 'verificado') {
    return Promise.resolve({ resultado: 'no-enviado', motivo: 'destino-sin-verificar' });
  }
  return enviarTextoPorCorreo(canal, destino.correo, textoDelAviso(cuerpo));
}
