// Dobles de recorrido/conversacion.js y recorrido/pagina.js para recorrido/reparar.js: anotan lo que Faro diría en la
// conversación (el estado de la espera y las sugerencias), sin DOM.
/** Lo que se ha dicho, en orden: la espera que se muestra, cambia o se retira, el fallo y las sugerencias. */
export const dicho: string[] = [];
const clave = (parte: unknown) => (parte as { clave?: string } | undefined)?.clave ?? String(parte);
export function mostrarEspera(aviso: unknown): void {
  dicho.push(`espera ${clave(aviso)}`);
}
export function actualizarEspera(aviso: unknown): void {
  dicho.push(`espera ${clave(aviso)}`);
}
export function quitarEspera(): void {
  dicho.push('sin espera');
}
export function ofrecerSugerencias(opciones: { texto: unknown }[]): undefined {
  dicho.push(`sugerencias ${opciones.map(({ texto }) => clave(texto)).join(', ')}`);
  return undefined;
}
export function avisarDelFallo(error: { explicacion?: unknown }): void {
  dicho.push(`fallo ${clave(error.explicacion)}`);
}
export function enfocar(): void {}
