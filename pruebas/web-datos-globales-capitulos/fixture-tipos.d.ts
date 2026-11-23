import type { DatosGlobales } from '../../web/scripts/datos-globales/datos.js';

type Mutable<T> = { -readonly [K in keyof T]: T[K] extends object ? Mutable<T[K]> : T[K] };
/** JSON confiable de la fixture, mutable solo para construir entradas; siempre pasa después por leerDatosGlobales. */
export type Crudos = Mutable<DatosGlobales>;
export type ValorCrudo = Crudos['territorios'][number]['valores'][number];
