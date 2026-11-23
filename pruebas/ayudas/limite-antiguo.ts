/**
 * Fabricantes de las filas y huellas de la versión 1 del límite de intentos, que el producto ya no escribe pero sigue
 * leyendo durante la migración: las pruebas los usan para dejar el estado que dejó una instalación anterior.
 */
import { MAX_INTENTOS, VENTANA_MS } from '../../src/plataforma/acceso-publico/limite-continuo-sqlite.ts';
import type { SqlAccesoPublico } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { huellaLimiteRecorrido } from '../../src/plataforma/cloudflare/limite-recorrido.ts';

const MAX_FILAS = 10_000;
const HEXADECIMAL = 16;

/** Gasta un intento como la versión 1 en `administracion_recorrido_intentos`: un contador por huella con su caducidad. */
export function consumirIntentoAntiguo(sql: SqlAccesoPublico, clave: string, ahora: number): boolean {
  if (!/^[0-9a-f]{64}$/.test(clave) || !Number.isSafeInteger(ahora) || ahora < 0) {
    throw new Error('Límite no válido');
  }
  sql.ejecutar('DELETE FROM administracion_recorrido_intentos WHERE caduca <= ?', ahora);
  const fila = sql.filas('SELECT usados FROM administracion_recorrido_intentos WHERE clave=?', clave)[0];
  if (fila) {
    if (typeof fila.usados !== 'number' || !Number.isSafeInteger(fila.usados) || fila.usados < 0) {
      throw new Error('Límite no disponible');
    }
    if (fila.usados >= MAX_INTENTOS) {
      return false;
    }
    sql.ejecutar('UPDATE administracion_recorrido_intentos SET usados=usados+1 WHERE clave=?', clave);
    return true;
  }
  const cuenta = sql.filas('SELECT count(*) AS total FROM administracion_recorrido_intentos')[0];
  if (!cuenta || typeof cuenta.total !== 'number' || cuenta.total >= MAX_FILAS) {
    throw new Error('Límite lleno');
  }
  sql.ejecutar('INSERT INTO administracion_recorrido_intentos VALUES (?,?,1)', clave, ahora + VENTANA_MS);
  return true;
}

/** Huella de la versión 1 del portal: la del recorrido recubierta con el propósito del portal. */
export async function huellaLimitePortalV1(peticion: Request, secreto: string, ahora: number): Promise<string> {
  const base = await huellaLimiteRecorrido(peticion, secreto, ahora);
  const encoder = new TextEncoder();
  const clave = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secreto),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const resultado = await crypto.subtle.sign('HMAC', clave, encoder.encode(`faro/acceso-portal/v1:${base}`));
  return Array.from(new Uint8Array(resultado), (byte) => byte.toString(HEXADECIMAL).padStart(2, '0')).join('');
}
