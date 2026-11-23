// Los resultados de una ronda en el apartado «Encuesta»: la tabla de sus lotes y, con la ronda cerrada, los recuentos de
// cada tipo con sus indicadores. Solo construye la interfaz a partir de los resultados ya leídos.
import { crear } from '../scripts/dom.js';
import { texto } from '../scripts/textos.js';
import { lineaDeValor, lineasDeIndicadores, textoPregunta } from './archivos-piloto.js';
import { PREGUNTAS_ENCUESTA, TIPOS_ENCUESTA } from './cliente-encuesta.js';

/** @typedef {import('./cliente-encuesta.js').ResultadosEncuesta} ResultadosEncuesta */
/** @typedef {import('./cliente-encuesta.js').TipoEncuesta} TipoEncuesta */

// Por debajo de este número de respuestas de un tipo, quien sepa quién respondió podría deducir respuestas concretas.
const GRUPO_PEQUENO = 10;
const t = (/** @type {string} */ clave, /** @type {Record<string,string|number>} */ valores = {}) =>
  texto(`panel.piloto.${clave}`, valores);

/** @param {ResultadosEncuesta} resultados */
export function tablaDeLotes(resultados) {
  if (!resultados.lotes.length) {
    return crear('p', { textContent: t('sin-lotes') });
  }
  const cabecera = crear(
    'tr',
    {},
    ...['lote', 'entidad', 'tipo', 'emitidas', 'usadas', 'quedan'].map((c) =>
      crear('th', { scope: 'col', textContent: t(`columna.${c}`) }),
    ),
  );
  const filas = resultados.lotes.map((lote) =>
    crear(
      'tr',
      {},
      crear('th', { scope: 'row', textContent: String(lote.numero) }),
      crear('td', { textContent: lote.nombre ?? t('sin-nombre') }),
      crear('td', { textContent: t(`tipo.${lote.tipo}`) }),
      crear('td', { textContent: String(lote.emitidos) }),
      crear('td', { textContent: String(lote.consumidos) }),
      crear('td', { textContent: String(lote.sinUsar) }),
    ),
  );
  return crear(
    'table',
    {},
    crear('caption', { textContent: t('lotes') }),
    crear('thead', {}, cabecera),
    crear('tbody', {}, ...filas),
  );
}
/** Un tipo de encuesta: respuestas, aviso de grupo pequeño y, por pregunta, «valor: n de N (x %)» y sus indicadores.
 * @param {TipoEncuesta} tipo @param {import('./cliente-encuesta.js').RecuentoTipo} recuento */
function apartadoDeTipo(tipo, recuento) {
  const apartado = crear('section', {}, crear('h3', { textContent: t(`resultados.${tipo}`) }));
  apartado.append(crear('p', { textContent: t('respuestas', { n: recuento.respuestas }) }));
  if (recuento.respuestas > 0 && recuento.respuestas < GRUPO_PEQUENO) {
    apartado.append(
      crear('p', {
        className: 'aviso',
        textContent: t(recuento.respuestas === 1 ? 'grupo-pequeno-uno' : 'grupo-pequeno', { n: recuento.respuestas }),
      }),
    );
  }
  for (const [pregunta, valores] of Object.entries(PREGUNTAS_ENCUESTA[tipo])) {
    const dato = recuento.preguntas[pregunta];
    if (!dato) {
      continue;
    }
    const lista = crear(
      'ul',
      {},
      ...valores.map((valor) => crear('li', { textContent: lineaDeValor(pregunta, valor, dato) })),
    );
    const indicadores = lineasDeIndicadores(tipo, dato).map((linea) => crear('p', { textContent: linea }));
    apartado.append(crear('h4', { textContent: textoPregunta(pregunta) }), lista, ...indicadores);
  }
  return apartado;
}
/** Con la encuesta abierta no hay recuentos: se explica por qué. @param {ResultadosEncuesta} resultados */
export function bloqueDeResultados(resultados) {
  const recuentos = resultados.recuentos;
  if (resultados.abierta || !recuentos) {
    return [crear('p', { textContent: t('abierta') })];
  }
  return [
    crear('p', { textContent: t('cerrada') }),
    crear('p', { textContent: t('cuestionario', { id: resultados.cuestionario }) }),
    crear('p', { textContent: t('metas-referencia') }),
    ...TIPOS_ENCUESTA.map((tipo) => apartadoDeTipo(tipo, recuentos[tipo])),
  ];
}
