/**
 * Variables y secretos privados que la orden de despliegue pone en el Worker principal de producción. El archivo es de
 * quien opera: se lee solo si es suyo, privado y único, y cada valor se valida con el mismo lector que usa el Worker
 * antes de llamar a Wrangler. Ningún mensaje de error repite un valor: solo nombra la variable.
 */
import assert from 'node:assert/strict';
import { chmodSync, closeSync, constants, fstatSync, openSync, readSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  administradoresInicialesDelEntorno,
  segundoFactorExigidoDelEntorno,
  sincronizacionDelEntorno,
} from '../../src/administracion/configuracion-administradores.ts';
import { leerConfiguracionDemanda } from '../../src/administracion/configuracion-demanda.ts';
import { comprobarVariablesDelServicio } from '../../src/plataforma/variables-del-servicio.ts';

/** Lista cerrada de variables no secretas: van a Wrangler con `--var`. */
export const VARIABLES_PRIVADAS = Object.freeze([
  'FARO_ADMIN_ACCESS_CUENTA',
  'FARO_ADMIN_ACCESS_GRUPO',
  'FARO_ADMINISTRADORES_INICIALES',
  'FARO_ADMIN_EXIGIR_MFA',
  'FARO_ACTUALIZACION_DEMANDA',
] as const);
/** Lista cerrada de secretos: van a Wrangler en un archivo de `--secrets-file`, nunca en la línea de órdenes. */
export const SECRETOS_PRIVADOS = Object.freeze(['FARO_ADMIN_ACCESS_TOKEN'] as const);

/** Como el instalador: el archivo cabe de sobra en 16 KiB, y un archivo mayor no es el que se espera. */
export const MAX_PRIVADAS_BYTES = 16_384;
const PERMISOS_PRIVADOS = 0o600;
const PERMISOS_CARPETA = 0o700;
const MASCARA_PERMISOS = 0o777;
const CLAVES = 'secretos,variables,version';

export interface Privadas {
  /** Pares `NOMBRE:valor` en el orden de la lista cerrada, listos para `--var`. */
  readonly variables: readonly string[];
  /** Solo existe en memoria hasta escribirse en el archivo temporal de `--secrets-file`. */
  readonly secretos: Readonly<Record<string, string>>;
  /** Lo único que dice el recibo: qué nombres se pusieron, nunca sus valores. */
  readonly nombres: { readonly variables: readonly string[]; readonly secretos: readonly string[] };
}

/**
 * Lee el archivo sin seguir enlaces y comprueba sobre el mismo descriptor que es un archivo normal, sin enlaces duros,
 * del usuario, con permisos 0600 y de tamaño acotado. La ruta resuelta debe coincidir con la real: ninguna carpeta del
 * camino puede ser un enlace simbólico.
 */
export function leerArchivoPrivadas(ruta: string): string {
  const absoluta = resolve(ruta);
  assert.equal(realpathSync(absoluta), absoluta, 'El archivo de --privadas no puede estar tras un enlace simbólico');
  const descriptor = openSync(absoluta, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const estado = fstatSync(descriptor);
    assert.ok(estado.isFile() && estado.nlink === 1, 'El archivo de --privadas debe ser un archivo único, sin enlaces');
    assert.equal(estado.uid, process.getuid?.(), 'El archivo de --privadas debe ser del usuario que despliega');
    assert.equal(estado.mode & MASCARA_PERMISOS, PERMISOS_PRIVADOS, 'El archivo de --privadas exige permisos 0600');
    assert.ok(
      estado.size <= MAX_PRIVADAS_BYTES,
      `El archivo de --privadas no puede pasar de ${MAX_PRIVADAS_BYTES} bytes`,
    );
    return leerAcotado(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

/** Lee como mucho un byte más del techo: si el archivo crece mientras se lee, se detecta en vez de cortarlo. */
function leerAcotado(descriptor: number): string {
  const bytes = Buffer.alloc(MAX_PRIVADAS_BYTES + 1);
  let usados = 0;
  while (usados < bytes.length) {
    const leidos = readSync(descriptor, bytes, usados, bytes.length - usados, null);
    if (leidos === 0) {
      break;
    }
    usados += leidos;
  }
  assert.ok(usados <= MAX_PRIVADAS_BYTES, `El archivo de --privadas no puede pasar de ${MAX_PRIVADAS_BYTES} bytes`);
  return descodificar(bytes.subarray(0, usados));
}

/** El mensaje propio sustituye al del analizador, que citaría un trozo del archivo y podría mostrar el secreto. */
function descodificar(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('El archivo de --privadas no está en UTF-8');
  }
}
function analizar(texto: string): unknown {
  try {
    return JSON.parse(texto);
  } catch {
    throw new Error('El archivo de --privadas no es un JSON legible');
  }
}

function objeto(entrada: unknown, que: string): Record<string, unknown> {
  assert.ok(
    entrada !== null && typeof entrada === 'object' && !Array.isArray(entrada),
    `${que} del archivo de --privadas debe ser un objeto`,
  );
  return entrada as Record<string, unknown>;
}
/** Una clave mal puesta podría ser el propio secreto: solo se cita si tiene la forma de una variable de Faro. */
const NOMBRE_DE_FARO = /^FARO_[A-Z0-9_]{1,64}$/;
function citable(nombre: string): string {
  return NOMBRE_DE_FARO.test(nombre) ? nombre : 'un nombre que no es de Faro';
}
/** Solo nombres de la lista cerrada, cada uno con un texto no vacío. */
function valores(entrada: unknown, que: string, admitidos: readonly string[]): Record<string, string> {
  const o = objeto(entrada, que);
  for (const [nombre, valor] of Object.entries(o)) {
    assert.ok(admitidos.includes(nombre), `${que}: ${citable(nombre)} no está en la lista cerrada de --privadas`);
    assert.ok(typeof valor === 'string' && valor !== '', `${que}: ${nombre} debe ser un texto no vacío`);
  }
  return o as Record<string, string>;
}

/** Los lectores del Worker: un valor que el Worker rechazaría al arrancar detiene aquí la orden. */
function comprobarComoElWorker(todas: Readonly<Record<string, string>>): void {
  comprobarVariablesDelServicio(todas);
  administradoresInicialesDelEntorno(todas);
  segundoFactorExigidoDelEntorno(todas);
  sincronizacionDelEntorno(todas);
  const demanda = todas.FARO_ACTUALIZACION_DEMANDA;
  if (demanda !== undefined) {
    const lectura = leerConfiguracionDemanda(demanda);
    assert.ok(
      lectura.estado === 'abierta' || lectura.motivo !== 'invalida',
      'FARO_ACTUALIZACION_DEMANDA no tiene la forma que admite el Worker (docs/configuracion.md)',
    );
  }
}

/** `{"version":1,"variables":{…},"secretos":{…}}` con esas claves exactas y al menos un nombre que poner. */
export function leerPrivadas(texto: string): Privadas {
  const o = objeto(analizar(texto), 'La raíz');
  assert.equal(Object.keys(o).sort().join(','), CLAVES, 'El archivo de --privadas lleva version, variables y secretos');
  assert.equal(o.version, 1, 'El archivo de --privadas debe ser de la version 1');
  const variables = valores(o.variables, 'variables', VARIABLES_PRIVADAS);
  const secretos = valores(o.secretos, 'secretos', SECRETOS_PRIVADOS);
  comprobarComoElWorker({ ...variables, ...secretos });
  const nombresVariables = VARIABLES_PRIVADAS.filter((nombre) => Object.hasOwn(variables, nombre));
  const nombresSecretos = SECRETOS_PRIVADOS.filter((nombre) => Object.hasOwn(secretos, nombre));
  assert.ok(nombresVariables.length + nombresSecretos.length > 0, 'El archivo de --privadas no pone ningún nombre');
  return {
    variables: nombresVariables.map((nombre) => `${nombre}:${variables[nombre]}`),
    secretos: Object.freeze(Object.fromEntries(nombresSecretos.map((nombre) => [nombre, secretos[nombre] as string]))),
    nombres: { variables: nombresVariables, secretos: nombresSecretos },
  };
}

function dentro(arbol: string, ruta: string): boolean {
  const desde = relative(realpathSync(arbol), realpathSync(ruta));
  return desde === '' || (!isAbsolute(desde) && desde !== '..' && !desde.startsWith(`..${sep}`));
}
/**
 * Escribe los secretos para `--secrets-file` en un archivo propio 0600 dentro de la carpeta temporal de la orden,
 * que se cierra a 0700 y debe quedar fuera del producto y de la entrega. Quien llama borra la carpeta siempre.
 */
export function escribirSecretos(
  temporal: string,
  secretos: Readonly<Record<string, string>>,
  arboles: readonly string[],
): string {
  chmodSync(temporal, PERMISOS_CARPETA);
  for (const arbol of arboles) {
    assert.ok(!dentro(arbol, temporal), 'La carpeta temporal de los secretos debe quedar fuera del producto');
  }
  const archivo = join(temporal, 'secretos.json');
  writeFileSync(archivo, JSON.stringify(secretos), { flag: 'wx', mode: PERMISOS_PRIVADOS });
  return archivo;
}
