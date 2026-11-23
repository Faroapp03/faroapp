// El resultado de cada paso de la limpieza de datos personales: privacidad.ts los encadena (identificadores,
// direcciones, empresas y nombres de persona) y suma lo que quita cada uno, así que todos devuelven la misma forma.

/** Un texto tras un paso de la limpieza y cuántos datos personales ha quitado ese paso (un entero, 0 o más). */
export interface Limpieza {
  texto: string;
  eliminados: number;
}
