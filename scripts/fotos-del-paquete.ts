// Las fotos del paquete: pruebas que fijan cifras o contenidos del paquete de una fecha para detectar que un cambio de
// código altera el resultado sin querer. Solo valen contra ese mismo paquete, así que la comprobación del ciclo, que
// cada día recibe uno nuevo, no las ejecuta; la batería completa sí. Una prueba de Node es una foto si registra sus
// casos con fotoDelPaquete (pruebas/ayudas/foto-del-paquete.ts), y un módulo de Python si decora una clase de casos con
// @foto_del_paquete (plataforma_datos/comun/pruebas/foto_del_paquete.py): esa llamada declara el paquete y es la marca
// que lee el código.

import { readFileSync } from 'node:fs';

/** La marca de una foto: la llamada que declara el paquete al que está fijada, en Node o como decorador de Python. */
const MARCA_DE_FOTO = /\bfotoDelPaquete\(|^[ \t]*@foto_del_paquete\(/m;

/**
 * Un fixture fechado (`…-AAAAMMDD.ext`): la copia de lo que dijo un paquete un día concreto. Una prueba del ciclo que lo
 * lee está comparando el paquete nuevo con el de aquel día.
 */
export const FIXTURE_FECHADO = /fixtures\/[^'"`\s]*-20\d{6}\.\w+/;

/**
 * Indica si un archivo de pruebas, de Node o de Python, es una foto del paquete.
 *
 * @param archivo - La prueba, con su ruta absoluta.
 * @returns Si registra sus casos con fotoDelPaquete o decora una clase de casos con @foto_del_paquete.
 */
export function esFotoDelPaquete(archivo: string): boolean {
  return MARCA_DE_FOTO.test(readFileSync(archivo, 'utf8'));
}
