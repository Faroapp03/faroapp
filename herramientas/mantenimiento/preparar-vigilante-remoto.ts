/** Operación humana deliberada: la cookie Access entra por stdin y nunca se escribe en argumentos o registros. */
import { execFile } from 'node:child_process';
import { validarOrigenAdministrativo } from '../../src/administracion/configuracion.ts';
import { leerEstadoSesionPanel } from '../../src/administracion/sesion.ts';

const MAX_RESPUESTA = 8192;
const MAX_COOKIE = 4096;
const PLAZO_SEGUNDOS = '5';
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const COOKIE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
type Ruta = 'sesion/abrir' | 'datos/vigilante/preparar' | 'sesion/cerrar';
type Pedir = (ruta: Ruta, token: string | undefined) => Promise<unknown>;

async function abrirSesion(pedir: Pedir): Promise<string> {
  const abierto = await pedir('sesion/abrir', undefined);
  if (
    !abierto ||
    typeof abierto !== 'object' ||
    !('token' in abierto) ||
    !('sesion' in abierto) ||
    typeof abierto.token !== 'string' ||
    !TOKEN.test(abierto.token) ||
    leerEstadoSesionPanel(abierto.sesion).estado !== 'activa'
  ) {
    throw new Error('No se pudo abrir una sesión administrativa');
  }
  return abierto.token;
}
/** Sin reintentos: después de un fallo de respuesta la preparación puede haber ocurrido. */
export async function prepararVigilanteRemoto(pedir: Pedir): Promise<void> {
  const token = await abrirSesion(pedir);
  let errorOperacion: unknown;
  let falloOperacion = false;
  try {
    const salida = await pedir('datos/vigilante/preparar', token);
    if (
      !salida ||
      typeof salida !== 'object' ||
      !('preparado' in salida) ||
      salida.preparado !== true ||
      !('sesion' in salida) ||
      leerEstadoSesionPanel(salida.sesion).estado !== 'activa'
    ) {
      throw new Error('No se confirmó la preparación');
    }
  } catch (error) {
    falloOperacion = true;
    errorOperacion = error;
  }
  try {
    const cierre = await pedir('sesion/cerrar', token);
    if (!cierre || typeof cierre !== 'object' || !('estado' in cierre) || cierre.estado !== 'cerrada') {
      throw new Error('Cierre no confirmado');
    }
  } catch (error) {
    throw new Error(
      !falloOperacion
        ? 'Preparación confirmada; cierre de sesión no confirmado'
        : 'Resultado y cierre de sesión no confirmados',
      { cause: !falloOperacion ? error : new AggregateError([errorOperacion, error]) },
    );
  }
  if (falloOperacion) {
    throw new Error('No se confirmó la preparación', { cause: errorOperacion });
  }
}
function interpretarRespuesta(error: Error | null, salida: string): unknown {
  if (error) {
    throw new Error('Petición administrativa no confirmada');
  }
  const separador = salida.lastIndexOf('\n');
  if (separador < 0 || salida.slice(separador + 1) !== '200') {
    throw new Error('Petición administrativa rechazada');
  }
  try {
    return JSON.parse(salida.slice(0, separador));
  } catch {
    throw new Error('Respuesta administrativa no válida');
  }
}
function cabeceras(origen: string, cookie: string, token: string | undefined): string {
  const lineas = [
    `Origin: ${origen}`,
    'Sec-Fetch-Site: same-origin',
    'X-Faro-Panel: 1',
    'Content-Type: application/json',
    `Cookie: CF_Authorization=${cookie}`,
    ...(token ? [`X-Faro-Sesion: ${token}`] : []),
  ];
  return `${lineas.map((h) => `header = "${h}"`).join('\n')}\n`;
}
function pedirConCurl(origen: string, ruta: Ruta, config: string): Promise<unknown> {
  const argumentos = [
    '--silent',
    '--show-error',
    '--no-location',
    '--no-insecure',
    '--max-time',
    PLAZO_SEGUNDOS,
    '--max-filesize',
    String(MAX_RESPUESTA),
    '--proto',
    '=https',
    '--config',
    '-',
    '--request',
    'POST',
    '--data-binary',
    '{}',
    '--write-out',
    '\n%{http_code}',
    '--url',
    `${origen}/administracion/api/${ruta}`,
  ];
  return new Promise((resolve, reject) => {
    const hijo = execFile(
      'curl',
      argumentos,
      {
        maxBuffer: MAX_RESPUESTA,
        encoding: 'utf8',
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin', ...(process.env.HOME ? { HOME: process.env.HOME } : {}) },
      },
      (error, salida) => {
        try {
          resolve(interpretarRespuesta(error, salida));
        } catch (fallo) {
          reject(fallo);
        }
      },
    );
    hijo.stdin?.once('error', () => reject(new Error('Petición administrativa no confirmada')));
    hijo.stdin?.end(config);
  });
}
/** curl usa su identidad genérica configurada; las cabeceras sensibles viajan solo por stdin del proceso. */
export function transporteRemoto(origenEntrada: string, cookie: string): Pedir {
  const origen = validarOrigenAdministrativo(origenEntrada);
  if (cookie.length > MAX_COOKIE || !COOKIE.test(cookie)) {
    throw new Error('Cookie Access no válida');
  }
  return (ruta, token) => pedirConCurl(origen, ruta, cabeceras(origen, cookie, token));
}
async function leerCookie(): Promise<string> {
  const partes: Buffer[] = [];
  let bytes = 0;
  for await (const parte of process.stdin) {
    const bloque = Buffer.from(parte);
    bytes += bloque.length;
    if (bytes > MAX_COOKIE + 1) {
      throw new Error('Cookie Access no válida');
    }
    partes.push(bloque);
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(partes)).replace(/\r?\n$/, '');
}
if (import.meta.main) {
  try {
    const [origen, ...resto] = process.argv.slice(2);
    if (!origen || resto.length) {
      throw new Error('Indica únicamente el origen administrativo HTTPS');
    }
    const cookie = await leerCookie();
    await prepararVigilanteRemoto(transporteRemoto(origen, cookie));
    console.log('Preparación confirmada y sesión cerrada.');
  } catch (error) {
    console.error(
      error instanceof Error && error.message.startsWith('Preparación confirmada;')
        ? error.message
        : 'No se confirmó la preparación o el cierre; comprobar el estado antes de repetir.',
    );
    process.exitCode = 1;
  }
}
