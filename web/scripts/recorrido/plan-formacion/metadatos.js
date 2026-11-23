// Lo que el plan de formación dice de cada opción: sus objetivos observados y su nivel, con su procedencia. Los
// requisitos llegan ya revisados por el motor (src/seleccion-formacion/requisitos.ts).
import { metadatosClasificados } from '../../../recursos/catalogo-cursos/lector.js';

/** @import { AfirmacionAprendizaje } from '../../../../src/seleccion-formacion/aprendizaje.ts' */
/** @import { OpcionPlan, IdiomaPlan } from './contrato.js' */
/** @param {OpcionPlan} opcion @returns {AfirmacionAprendizaje[]} */
function objetivosUtilizables(opcion) {
  return (
    opcion.aprendizaje?.aprendizaje.afirmaciones.filter(
      (a) =>
        a.dimension === 'resultado_previsto' &&
        a.origen === 'extraccion_oficial' &&
        a.descripcion &&
        a.evidencias.length > 0 &&
        ['extraida', 'revisada'].includes(a.estado) &&
        !a.revision_requerida &&
        a.discrepancias.length === 0,
    ) ?? []
  );
}
/** @param {OpcionPlan} opcion @returns {string[]} */
export function objetivosDeOpcion(opcion) {
  return objetivosUtilizables(opcion).map((a) => a.descripcion ?? '');
}
/** @param {OpcionPlan} opcion @param {IdiomaPlan} idioma */
export function nivelDeOpcion(opcion, idioma) {
  const nivel = metadatosClasificados(opcion.oferta).nivel;
  const valores = {
    es: { inicial: 'Inicial', intermedio: 'Intermedio', avanzado: 'Avanzado' },
    ca: { inicial: 'Inicial', intermedio: 'Intermedi', avanzado: 'Avançat' },
  };
  if (nivel.valor === null) {
    return idioma === 'es'
      ? 'El nivel está por confirmar. Consulta los requisitos antes de elegir este curso.'
      : 'El nivell està per confirmar. Consulta els requisits abans de triar aquest curs.';
  }
  const origenes = {
    es: { fuente: 'publicado por la fuente', faro: 'orientación de Faro', 'por-confirmar': 'por confirmar' },
    ca: { fuente: 'publicat per la font', faro: 'orientació de Faro', 'por-confirmar': 'per confirmar' },
  };
  let origen = origenes[idioma][nivel.origen];
  if (nivel.evidencia?.naturaleza === 'extracto_derivado_historico') {
    origen = idioma === 'es' ? 'extracto conservado' : 'extracte conservat';
  } else if (nivel.origen === 'fuente' && nivel.alcance === 'actividad') {
    origen = idioma === 'es' ? 'publicado para la actividad' : 'publicat per a l’activitat';
  }
  return `${valores[idioma][nivel.valor]} · ${origen}`;
}
