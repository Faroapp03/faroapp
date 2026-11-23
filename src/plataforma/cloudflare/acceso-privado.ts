import { configuracionAdministrativaDelEntorno } from '../../administracion/configuracion.ts';
import { guardiaAdministrativaDelEntorno } from '../acceso-administrativo.ts';
import { AlmacenPublicoDurable, type EspacioAccesoPublicoDurable } from '../acceso-publico/durable.ts';
import { AlmacenRecorridoDurable } from '../acceso-publico/recorrido-cliente-durable.ts';
import { esEnvioDeAvisos } from './canales-portal.ts';
import { identificadoresLimitePrivado } from './limite-privado.ts';
import { DEL_PORTAL_PRIVADO } from './sin-sesion.ts';

/**
 * Puerta de la instalación privada de ensayo. La clave nunca llega al Worker de la aplicación. Todo lo que contesta,
 * también sus rechazos, lleva x-faro-portal: privado (DEL_PORTAL_PRIVADO).
 */
export type EntornoPrivado = Record<string, unknown> & {
  ASSETS: { fetch(peticion: Request): Promise<Response> };
};

const MAX_AUTORIZACION = 1024;
const MIN_CLAVE_BYTES = 32;
const BLOQUE_BASE64 = 4;
const NO_AUTENTICADO = 401;
const PROHIBIDO = 403;

export async function accesoPermitido(peticion: Request, clave: unknown): Promise<boolean> {
  if (typeof clave !== 'string' || clave.length === 0) {
    return false;
  }
  const autorizacion = peticion.headers.get('authorization');
  if (!autorizacion || autorizacion.length > MAX_AUTORIZACION) {
    return false;
  }
  const partes = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(autorizacion);
  const base64 = partes?.[1];
  if (!base64 || base64.length % BLOQUE_BASE64 !== 0) {
    return false;
  }
  let datos: string;
  try {
    const binario = atob(base64);
    if (btoa(binario) !== base64) {
      return false;
    }
    datos = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binario, (c) => c.charCodeAt(0)));
  } catch {
    return false;
  }
  const separador = datos.indexOf(':');
  if (separador < 0 || datos.slice(0, separador) !== 'Faro') {
    return false;
  }
  const encoder = new TextEncoder();
  const [esperada, recibida] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(clave)),
    crypto.subtle.digest('SHA-256', encoder.encode(datos.slice(separador + 1))),
  ]);
  return huellasIguales(new Uint8Array(esperada), new Uint8Array(recibida));
}

function huellasIguales(a: Uint8Array, b: Uint8Array): boolean {
  let diferencia = 0;
  for (const [i, byte] of a.entries()) {
    const otro = b[i];
    if (otro === undefined) {
      return false;
    }
    diferencia |= byte ^ otro;
  }
  return diferencia === 0;
}

async function administracionPrivada(habilitar: unknown, resto: Record<string, unknown>): Promise<string> {
  if (habilitar === undefined || habilitar === 'no') {
    return 'no';
  }
  if (habilitar !== 'si') {
    throw new Error('habilitación inválida');
  }
  const texto: Record<string, string> = {};
  for (const nombre of [
    'FARO_ADMIN_ACCESS_EQUIPO',
    'FARO_ADMIN_ACCESS_AUD',
    'FARO_ACCESS_AUD',
    'FARO_ADMIN_ORIGEN',
    'FARO_SECRETO_FIRMA',
  ]) {
    const valor = resto[nombre];
    if (typeof valor === 'string') {
      texto[nombre] = valor;
    }
  }
  texto.FARO_ADMINISTRACION = 'si';
  configuracionAdministrativaDelEntorno(texto);
  guardiaAdministrativaDelEntorno(texto);
  const registro = resto.REGISTRO_SOCIOS as { idFromName?: unknown; get?: unknown } | undefined;
  if (typeof registro?.idFromName !== 'function' || typeof registro.get !== 'function') {
    throw new Error('sin durable');
  }
  const controles = await new AlmacenPublicoDurable(registro as EspacioAccesoPublicoDurable).leerControles();
  if (controles && (controles.api !== 'deshabilitada' || controles.mcp || controles.a2a)) {
    throw new Error('controles activos');
  }
  return 'si';
}

async function verificarAcceso(peticion: Request, entorno: EntornoPrivado): Promise<Response | null> {
  const cabeceras = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...DEL_PORTAL_PRIVADO };
  const secreto = entorno.FARO_PRUEBAS_CLAVE;
  const secretoLimite = entorno.FARO_PRUEBAS_LIMITE;
  // El límite firma con una clave propia que no conocen los probadores; sin ella, o igual a la contraseña, no se abre.
  if (
    typeof secreto !== 'string' ||
    new TextEncoder().encode(secreto).length < MIN_CLAVE_BYTES ||
    typeof secretoLimite !== 'string' ||
    new TextEncoder().encode(secretoLimite).length < MIN_CLAVE_BYTES ||
    secretoLimite === secreto
  ) {
    return new Response(null, { status: 503, headers: cabeceras });
  }
  // Los avisos del navegador no llevan credencial (canales-portal.ts): no se piden ni gastan intentos.
  if (esEnvioDeAvisos(peticion)) {
    return null;
  }
  const desafio = () =>
    new Response(null, {
      status: NO_AUTENTICADO,
      headers: { ...cabeceras, 'www-authenticate': 'Basic realm="Acceso privado", charset="UTF-8"' },
    });
  if (!peticion.headers.has('authorization')) {
    return desafio();
  }
  const valido = await accesoPermitido(peticion, secreto);
  try {
    const espacio = entorno.REGISTRO_SOCIOS as EspacioAccesoPublicoDurable | undefined;
    if (!espacio || typeof espacio.idFromName !== 'function' || typeof espacio.get !== 'function') {
      throw new Error('sin autoridad');
    }
    const clave = await identificadoresLimitePrivado(peticion, secretoLimite, secreto);
    const permitido = await new AlmacenRecorridoDurable(espacio).decidirIntentoPrivado(clave, valido);
    if (!permitido) {
      return new Response(null, { status: 429, headers: cabeceras });
    }
  } catch {
    return new Response(null, { status: 503, headers: cabeceras });
  }
  return valido ? null : desafio();
}

/** No se conserva la credencial en las respuestas ni en las variables que procesa la aplicación. */
export async function responderAccesoPrivado(
  peticion: Request,
  entorno: EntornoPrivado,
  responder: (peticion: Request, entorno: EntornoPrivado) => Promise<Response>,
): Promise<Response> {
  const cabeceras = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...DEL_PORTAL_PRIVADO };
  if (new URL(peticion.url).protocol !== 'https:') {
    return new Response(null, { status: PROHIBIDO, headers: cabeceras });
  }
  const rechazo = await verificarAcceso(peticion, entorno);
  if (rechazo) {
    return rechazo;
  }
  const {
    FARO_PRUEBAS_CLAVE: _clave,
    FARO_PRUEBAS_LIMITE: _limite,
    FARO_PRUEBAS_ADMINISTRACION: habilitar,
    FARO_CLAVE_GENERAL: _clavePortal,
    FARO_SESION_PORTAL: _firmaPortal,
    FARO_LIMITE_PORTAL: _limitePortal,
    ...resto
  } = entorno;
  let administracion: string;
  try {
    // Una petición sin credencial nunca se atiende con la administración montada.
    administracion = esEnvioDeAvisos(peticion) ? 'no' : await administracionPrivada(habilitar, resto);
  } catch {
    return new Response(null, { status: 503, headers: cabeceras });
  }
  const variables = {
    ...resto,
    FARO_ADMINISTRACION: administracion,
    FARO_MCP: 'no',
    FARO_A2A: 'no',
    FARO_API_SOCIOS: 'no',
  };
  const cabecerasPeticion = new Headers(peticion.headers);
  cabecerasPeticion.delete('authorization');
  const respuesta = await responder(new Request(peticion, { headers: cabecerasPeticion }), variables);
  const salida = new Response(respuesta.body, respuesta);
  salida.headers.set('cache-control', 'no-store');
  salida.headers.set('x-faro-portal', 'privado');
  return salida;
}
