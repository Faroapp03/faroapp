/** Las variantes se deciden por una ruta cerrada; alias y codificaciones no crean caminos alternativos. */

import { VARIANTES_RECORRIDO, type VarianteRecorrido } from '../variantes-recorrido.ts';
export type VarianteEntrada = VarianteRecorrido;
export function varianteDeRuta(
  pathname: string,
  disponibles: readonly VarianteEntrada[] = VARIANTES_RECORRIDO.map(({ id }) => id),
): VarianteEntrada | null {
  let ruta: string;
  try {
    ruta = decodeURIComponent(pathname).replaceAll('\\', '/').toLowerCase();
  } catch {
    throw new Error('Ruta inválida');
  }
  if (ruta.includes('%')) {
    throw new Error('Ruta codificada de forma ambigua');
  }
  const partes: string[] = [];
  for (const parte of ruta.split('/')) {
    if (parte === '..') {
      partes.pop();
    } else if (parte && parte !== '.') {
      partes.push(parte);
    }
  }
  ruta = `/${partes.join('/')}`;
  const coincidencias = VARIANTES_RECORRIDO.filter((entrada) => entrada.coincide(ruta));
  if (coincidencias.length > 1) {
    throw new Error('Ruta de recorrido ambigua');
  }
  const entrada = coincidencias[0];
  if (!entrada) {
    return null;
  }
  if (!disponibles.includes(entrada.id)) {
    throw new Error('Variante no disponible');
  }
  return entrada.id;
}
