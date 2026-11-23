// security.txt (RFC 9116) en /.well-known/security.txt: a quién escribe quien encuentra un fallo de seguridad en este
// despliegue de Faro, dónde está su política y hasta cuándo vale lo que dice. Lo fija la entidad que despliega Faro
// con tres variables (docs/operacion-local.md, «Contacto de seguridad»). Sin un contacto válido no se publica.
// La caducidad por defecto no se renueva automáticamente: vencida, el archivo deja de publicarse hasta renovarla.
//   FARO_SEGURIDAD_CONTACTO   mailto:<correo> o https://<página>; obligatorio para publicar el documento.
//   FARO_SEGURIDAD_POLITICA   https://<página> con la política de divulgación; vacía, el campo no sale.
//   FARO_SEGURIDAD_CADUCA     fecha (AAAA-MM-DD o ISO 8601) hasta la que vale el archivo; por defecto,
//                             CADUCA_POR_DEFECTO.

import type { VariablesDelEntorno } from '../comun/entorno.ts';
import { ESTADO_HTTP } from '../comun/estados-http.ts';
import { diaUtc } from '../comun/tiempo.ts';

/** Dónde lo buscan los navegadores y quienes investigan fallos. */
export const RUTA_SECURITY_TXT = '/.well-known/security.txt';
/** La caducidad por defecto, fijada para esta entrega; requiere revisión al preparar otra publicación. */
export const CADUCA_POR_DEFECTO = '2027-10-01T00:00:00.000Z';
/** Los idiomas en que se atiende un aviso. */
const IDIOMAS = 'es, ca, en';

/** Lo que dice el archivo, ya validado. */
export interface DatosDeSeguridad {
  readonly contacto: string;
  readonly politica: string | null;
  readonly caduca: string;
}

/** Un contacto por correo que admite la norma: mailto: con una sola dirección, sin espacios. */
const CONTACTO_MAILTO = /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Cualquier espacio en blanco: una dirección https con espacios no vale. */
const ESPACIO = /\s/;

/** Una dirección que la norma admite: mailto: con un correo, o https:. Lo demás no vale. */
function direccionValida(valor: string | undefined, admiteCorreo: boolean): string | null {
  const texto = valor?.trim() ?? '';
  if (admiteCorreo && CONTACTO_MAILTO.test(texto)) {
    return texto;
  }
  try {
    return new URL(texto).protocol === 'https:' && !ESPACIO.test(texto) ? texto : null;
  } catch {
    // Una dirección inválida no se publica ni se sustituye por otra identidad.
    return null;
  }
}

/**
 * Una fecha que se lee igual en cualquier zona horaria y en cualquier motor: el día solo (AAAA-MM-DD, medianoche UTC)
 * o fecha y hora con su zona (RFC 3339: «Z» o «±HH:MM»). Sin zona, `new Date` la leería en la hora local del proceso.
 */
const FECHA_CON_ZONA = /^(\d{4}-\d{2}-\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/;

/**
 * Una fecha admitida por FECHA_CON_ZONA, con día real y convertible a UTC, o null.
 *
 * @param valor - FARO_SEGURIDAD_CADUCA, tal cual.
 * @returns La fecha en ISO 8601 UTC, o null si no se admite; el día sin hora se interpreta a medianoche UTC.
 */
function fechaValida(valor: string | undefined): string | null {
  const texto = valor?.trim() ?? '';
  const dia = FECHA_CON_ZONA.exec(texto)?.[1];
  if (!dia) {
    return null;
  }
  // Date normaliza días imposibles: comprobar el calendario antes de convertir la zona horaria.
  const calendario = new Date(`${dia}T00:00:00.000Z`);
  if (Number.isNaN(calendario.getTime()) || diaUtc(calendario.getTime()) !== dia) {
    return null;
  }
  const fecha = new Date(texto === dia ? `${dia}T00:00:00.000Z` : texto);
  return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString();
}

/**
 * Los datos del despliegue; sin contacto válido, o con la caducidad ya vencida (RFC 9116: el archivo dejaría de
 * valer), no existe documento de seguridad para publicar.
 *
 * @param variables - Las variables del despliegue.
 * @param ahora - El momento actual, en milisegundos de época.
 * @returns El contacto, la política y la caducidad, o null si falta un contacto válido o la caducidad ha vencido.
 */
export function datosDeSeguridad(variables: VariablesDelEntorno, ahora: number = Date.now()): DatosDeSeguridad | null {
  const contacto = direccionValida(variables.FARO_SEGURIDAD_CONTACTO, true);
  if (!contacto) {
    return null;
  }
  const politicaIndicada = variables.FARO_SEGURIDAD_POLITICA?.trim();
  const fechaIndicada = variables.FARO_SEGURIDAD_CADUCA?.trim();
  const politica = direccionValida(politicaIndicada, false);
  const caduca = fechaIndicada ? fechaValida(fechaIndicada) : CADUCA_POR_DEFECTO;
  if ((politicaIndicada && !politica) || !caduca || Date.parse(caduca) <= ahora) {
    return null;
  }
  return { contacto, politica, caduca };
}

/**
 * El texto del archivo para un origen (https://<dominio>): Contact, Expires, Policy, idiomas y su dirección canónica.
 *
 * @param datos - Lo que dice el archivo.
 * @param origen - El origen del despliegue.
 * @returns El texto, con un salto de línea final.
 */
export function textoDeSecurityTxt(datos: DatosDeSeguridad, origen: string): string {
  const lineas = [
    `Contact: ${datos.contacto}`,
    `Expires: ${datos.caduca}`,
    ...(datos.politica ? [`Policy: ${datos.politica}`] : []),
    `Preferred-Languages: ${IDIOMAS}`,
    `Canonical: ${origen}${RUTA_SECURITY_TXT}`,
  ];
  return `${lineas.join('\n')}\n`;
}

/**
 * La respuesta: texto plano en UTF-8, como pide la norma; se puede guardar un día.
 *
 * @param datos - Lo que dice el archivo.
 * @param origen - El origen del despliegue.
 * @returns La respuesta 200, o 404 sin caché si no hay contacto configurado.
 */
export function respuestaDeSecurityTxt(datos: DatosDeSeguridad | null, origen: string): Response {
  if (!datos) {
    return new Response(null, { status: ESTADO_HTTP.noEncontrado, headers: { 'cache-control': 'no-store' } });
  }
  return new Response(textoDeSecurityTxt(datos, origen), {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=86400' },
  });
}
