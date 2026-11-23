/**
 * El mensaje de un aviso del vigilante en la forma que admite `send` del enlace `send_email`: un objeto plano con
 * `to`, `from`, `subject` y `text`, sin cabeceras propias ni HTML. El enlace compone las cabeceras, pero cada campo que
 * acaba en una se valida aquí antes: ningún dato puede abrir una línea nueva y añadir cabeceras o destinatarios.
 */
import { TEXTOS_VIGILANTE } from '../../web/idiomas/es/panel-vigilante.js';
import { fechaLargaConHora, partesEnZona } from '../comun/fechas.js';
import type { CuerpoAvisoVigilante } from './aviso-vigilante.ts';
import { leerDestinoCorreo } from './destino-correo.ts';

export const ASUNTO_ATENCION = 'Faro: la actualización necesita atención';
export const ASUNTO_RESUELTO = 'Faro: la actualización vuelve a estar bien';
export const ASUNTO_PRUEBA = 'Faro: aviso de prueba';
/** Texto de un motivo que el panel no traduce: se dice que hay algo que revisar sin enseñar la clave interna. */
const INCIDENCIA_SIN_TEXTO = 'Hay una incidencia que requiere revisión.';
/** Caracteres visibles de ASCII: lo único que admite una dirección dentro de una cabecera sin extensiones. */
const ASCII_VISIBLE = /^[\x21-\x7e]+$/;
/** Un asunto es una sola línea: sin saltos ni otros caracteres de control. */
const CONTROL = /\p{Cc}/u;
/** RFC 5322, 2.1.1: una línea de cabecera no pasa de 998 caracteres; el asunto queda muy por debajo. */
const MAX_ASUNTO = 200;

/** Una dirección o un valor que no puede ir en una cabecera. El mensaje no repite el valor. */
export class CabeceraNoAdmitida extends Error {
  override readonly name = 'CabeceraNoAdmitida';
  constructor() {
    super('Un valor del aviso no se puede poner en una cabecera del mensaje');
  }
}
/** La dirección pasa por la validación del destino y, además, tiene que ser ASCII para ir en la cabecera tal cual. */
export function direccionParaCabecera(valor: string): string {
  let direccion: string;
  try {
    direccion = leerDestinoCorreo(valor);
  } catch {
    throw new CabeceraNoAdmitida();
  }
  if (direccion !== valor || !ASCII_VISIBLE.test(direccion)) {
    throw new CabeceraNoAdmitida();
  }
  return direccion;
}
function asuntoParaCabecera(valor: string): string {
  if (valor.length === 0 || valor.length > MAX_ASUNTO || CONTROL.test(valor)) {
    throw new CabeceraNoAdmitida();
  }
  return valor;
}
function fechaLegible(iso: string): string {
  return `${fechaLargaConHora(partesEnZona(iso), 'es')} (hora de Madrid)`;
}
function fraseDeMotivo(motivo: string): string {
  const textos: Readonly<Record<string, string>> = TEXTOS_VIGILANTE;
  return textos[`panel.vigilante.motivo.${motivo}`] ?? INCIDENCIA_SIN_TEXTO;
}
/** Una frase por incidencia; dos incidencias con el mismo texto se dicen una vez. */
function frasesDeIncidencias(cuerpo: CuerpoAvisoVigilante): string[] {
  return [...new Set(cuerpo.decisiones.map((d) => fraseDeMotivo(d.motivo)))].map((frase) => `- ${frase}`);
}
function lineasDelAviso(cuerpo: CuerpoAvisoVigilante): string[] {
  const fecha = fechaLegible(cuerpo.evaluadoEn);
  if (cuerpo.tipo === 'resuelto') {
    return [`La actualización de Faro vuelve a estar bien: la comprobación del ${fecha} no ha encontrado incidencias.`];
  }
  const entrada =
    cuerpo.tipo === 'recordatorio'
      ? `La actualización de Faro sigue necesitando atención desde el ${fechaLegible(cuerpo.desde)}. Esto es lo que ha encontrado la comprobación del ${fecha}:`
      : `La actualización de Faro necesita atención. Esto es lo que ha encontrado la comprobación del ${fecha}:`;
  return [entrada, '', ...frasesDeIncidencias(cuerpo)];
}
export interface TextoAviso {
  readonly asunto: string;
  readonly lineas: readonly string[];
}
/** Asunto fijo según el caso y el cuerpo en frases completas, con el enlace al panel y nada más. */
export function textoDelAviso(cuerpo: CuerpoAvisoVigilante): TextoAviso {
  return {
    asunto: cuerpo.tipo === 'resuelto' ? ASUNTO_RESUELTO : ASUNTO_ATENCION,
    lineas: [
      'Hola:',
      '',
      ...lineasDelAviso(cuerpo),
      '',
      `Puedes ver el detalle en el panel de administración: ${cuerpo.panel}`,
      '',
      'Este mensaje lo envía Faro de forma automática.',
    ],
  };
}
export function textoDePrueba(panel: string): TextoAviso {
  return {
    asunto: ASUNTO_PRUEBA,
    lineas: [
      'Hola:',
      '',
      'Este es un aviso de prueba de Faro. Si lo recibes, los avisos de la actualización llegarán a esta dirección.',
      '',
      `Puedes ver el estado en el panel de administración: ${panel}`,
      '',
      'Este mensaje lo envía Faro de forma automática.',
    ],
  };
}
/** Lo que recibe `send`: los cuatro campos, ya validados los que acaban en una cabecera. */
export interface MensajeCorreo {
  readonly to: string;
  readonly from: string;
  readonly subject: string;
  readonly text: string;
}
/** Lanza `CabeceraNoAdmitida` si el remitente, el destino o el asunto no caben en su cabecera. */
export function mensajeParaElEnlace(
  texto: TextoAviso,
  sobre: Readonly<{ remitente: string; destino: string }>,
): MensajeCorreo {
  return {
    to: direccionParaCabecera(sobre.destino),
    from: direccionParaCabecera(sobre.remitente),
    subject: asuntoParaCabecera(texto.asunto),
    text: texto.lineas.join('\n'),
  };
}
