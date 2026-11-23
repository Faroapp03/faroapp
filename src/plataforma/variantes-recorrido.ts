/**
 * Las variantes del recorrido: su tipo y su registro cerrado, con el recorrido real y la variante que aporta cada
 * extensión instalada. No depende de ninguna plataforma: lo leen igual el adaptador de Cloudflare, el servidor Node,
 * la administración y las herramientas de la web.
 */
import type { Extension } from './extension.ts';
import { EXTENSIONES } from './extensiones.ts';

/**
 * Tipo cerrado de la variante: el del modo guardado y el de la restricción de la base, que solo admite estos dos
 * valores. Es estado persistido heredado; la guardia del real sin extensiones lo admite por nombre (CONTRATO_HEREDADO).
 */
export type VarianteRecorrido = 'real' | 'demo';

export interface EntradaRecorrido {
  readonly id: VarianteRecorrido;
  readonly rutaPublica: string;
  coincide(ruta: string): boolean;
}
const ENTRADA_REAL: EntradaRecorrido = {
  id: 'real',
  rutaPublica: 'recorrido.html',
  coincide: (ruta) => ruta === '/recorrido' || ruta === '/recorrido.html',
};
/** Una ruta protegida terminada en «/» cubre su carpeta, con o sin la barra final, y todo lo que contiene. */
function entradaDeExtension({ id, entrada, rutasProtegidas }: Extension): EntradaRecorrido {
  return {
    id,
    rutaPublica: entrada,
    coincide: (ruta) =>
      rutasProtegidas.some((protegida) =>
        protegida.endsWith('/') ? ruta === protegida.slice(0, -1) || ruta.startsWith(protegida) : ruta === protegida,
      ),
  };
}
/** Las variantes que no aporta ninguna extensión instalada no existen: sus rutas son recursos corrientes. */
export const VARIANTES_RECORRIDO: readonly EntradaRecorrido[] = Object.freeze([
  ENTRADA_REAL,
  ...EXTENSIONES.map(entradaDeExtension),
]);
/** La ruta de URL de la página de entrada de una variante instalada. */
export function rutaDeVariante(variante: VarianteRecorrido): string {
  const entrada = VARIANTES_RECORRIDO.find(({ id }) => id === variante);
  if (!entrada) {
    throw new Error('Variante no instalada');
  }
  return `/${entrada.rutaPublica}`;
}
/** Si una variante, también la leída de un estado persistido, está instalada en esta construcción. */
export function varianteInstalada(variante: VarianteRecorrido): boolean {
  return VARIANTES_RECORRIDO.some(({ id }) => id === variante);
}
