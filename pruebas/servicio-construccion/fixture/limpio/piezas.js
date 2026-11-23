export const PREFIJO = 'faro:';
export let contador = 0;
export class HuellaQueNoCoincide extends Error {}
export function sumar() {
  contador += 1;
  return contador;
}
export const SIN_USO = 'llega aunque nadie lo importe';
