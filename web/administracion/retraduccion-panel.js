// Cambiar el idioma repinta una vista sin consultar ni cambiar datos: conserva sus filtros y sus desplegables abiertos.

/** @param {HTMLElement} destino @param {()=>void} pintar */
export function repintarConservando(destino, pintar) {
  const filtros = [...destino.querySelectorAll('select')].map((c) => c.value);
  const abiertos = [...destino.querySelectorAll('details')].map((c) => c.open);
  pintar();
  for (const [i, campo] of [...destino.querySelectorAll('select')].entries()) {
    campo.value = filtros[i] ?? '';
    campo.dispatchEvent(new Event('change'));
  }
  for (const [i, detalle] of [...destino.querySelectorAll('details')].entries()) {
    detalle.open = abiertos[i] ?? false;
  }
}
