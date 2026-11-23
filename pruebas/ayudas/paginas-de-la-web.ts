/** Cuántas páginas tiene la carpeta web/ y cuáles son: la cuenta que comparan las pruebas de la web local. */
import { readdirSync } from 'node:fs';
import { EXTENSIONES } from '../../src/plataforma/extensiones.ts';

/**
 * Las páginas HTML que están directamente en la raíz de una carpeta web/.
 *
 * @param web - La carpeta web/ (la del repositorio o una copia construida).
 * @returns Los nombres de sus páginas.
 */
export function paginasDeLaRaiz(web: string | URL): string[] {
  return readdirSync(web, { encoding: 'utf8' }).filter((nombre) => nombre.endsWith('.html'));
}

/**
 * Cuántas páginas públicas tiene la carpeta web/: las de la raíz y las que trae en su carpeta cada extensión
 * instalada. El panel privado de administración no cuenta.
 *
 * @param web - La carpeta web/ del repositorio, con la barra final si es una URL.
 * @returns El número de páginas.
 */
export function cuantasPaginasPublicas(web: URL): number {
  const deLasExtensiones = EXTENSIONES.flatMap(({ entrada }) =>
    readdirSync(new URL(`${entrada.split('/')[0] ?? ''}/`, web), { recursive: true, encoding: 'utf8' }),
  ).filter((ruta) => ruta.endsWith('.html'));
  return paginasDeLaRaiz(web).length + deLasExtensiones.length;
}
