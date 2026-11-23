/** Solo suple la ausencia de sincronía individual; los datos específicos prevalecen.
 * @param {import('./contrato.js').OpcionPlan} opcion */
export function ritmoGeneralHpLife(opcion) {
  const { oferta } = opcion;
  const hecho = oferta.hechos.sincronia;
  const calendario = oferta.hechos.calendario_formacion;
  const sesiones =
    calendario.motivo === 'conocido' &&
    calendario.valor &&
    typeof calendario.valor === 'object' &&
    'tipo' in calendario.valor &&
    calendario.valor.tipo === 'sesiones';
  return (
    oferta.proveedor_id === 'hp-life' &&
    oferta.unidad.tipo === 'recurso' &&
    /^https:\/\/(?:www\.)?life-global\.org\//.test(oferta.url) &&
    ['no_consta_en_evidencia', 'sin_soporte_de_campo'].includes(hecho.motivo) &&
    !sesiones
  );
}

/** @param {import('./contrato.js').OpcionPlan} opcion */
export function esAsincronaEnPlan(opcion) {
  const hecho = opcion.oferta.hechos.sincronia;
  return (hecho.motivo === 'conocido' && hecho.valor === 'asincrona') || ritmoGeneralHpLife(opcion);
}
