// «Revisiones que tocan»: las revisiones manuales que la observación de datos ya trae calculadas. Es un aviso para la
// entidad; no cambia ninguna fuente ni lo que ven las personas.
import { texto } from '../scripts/textos.js';
import { diaPanel, fechaPanel } from './fechas-panel.js';
import { resumirSaludDatos } from './salud-datos.js';

/** @typedef {import('./estado-datos.js').EstadoDatosPanel} EstadoDatosPanel */
/** @typedef {Readonly<{fuente:string,estado:'vencida'|'prevista'|'manual',texto:string}>} RevisionQueToca */

const t = (/** @type {string} */ clave, /** @type {Record<string,string|number>} */ valores = {}) =>
  texto(`panel.revisiones.${clave}`, valores);

/** Plazo de las fichas que el servidor publica (por ahora, solo Formación abierta).
 * @param {readonly import('./salud-datos.js').SaludFuente[]} fuentes @param {number} ahora @returns {RevisionQueToca[]} */
function revisionesConPlazo(fuentes, ahora) {
  return fuentes.flatMap((fuente) => {
    if (!fuente.revisionPendiente) {
      return [];
    }
    const { fecha, vencida } = fuente.revisionPendiente;
    const clave = vencida ? 'fichas-vencida' : 'fichas-prevista';
    return [
      {
        fuente: fuente.nombre,
        estado: vencida ? 'vencida' : 'prevista',
        texto: t(clave, { dia: diaPanel(fecha, ahora) }),
      },
    ];
  });
}
/** Partes de una fuente que el servidor marca como de revisión manual, con su última comprobación registrada.
 * @param {EstadoDatosPanel} datos @param {readonly import('./salud-datos.js').SaludFuente[]} fuentes @param {number} ahora
 * @returns {RevisionQueToca[]} */
function revisionesManuales(datos, fuentes, ahora) {
  if (datos.version === 1) {
    return [];
  }
  return datos.comprobaciones.conjuntos
    .filter((c) => c.revisionNecesaria)
    .map((conjunto) => {
      const ultima = conjunto.ultimaComprobacion?.fecha ?? null;
      return {
        fuente: fuentes.find((f) => f.id === conjunto.fuente)?.nombre ?? t('fuente-sin-nombre'),
        estado: 'manual',
        texto: ultima === null ? t('manual-sin-registro') : t('manual', { fecha: fechaPanel(ultima, ahora) }),
      };
    });
}
/** Las vencidas primero, después las previstas y por último las que no tienen plazo publicado.
 * @param {EstadoDatosPanel} datos @param {number} [ahora] @returns {readonly RevisionQueToca[]} */
export function resumirRevisiones(datos, ahora = Date.now()) {
  const salud = resumirSaludDatos(datos);
  const fuentes = [...salud.operativas, ...salud.otras];
  const orden = { vencida: 0, prevista: 1, manual: 2 };
  return [...revisionesConPlazo(fuentes, ahora), ...revisionesManuales(datos, fuentes, ahora)].sort(
    (a, b) => orden[a.estado] - orden[b.estado],
  );
}
/** @param {RevisionQueToca} revision */
function crearRevision(revision) {
  const elemento = document.createElement('li');
  elemento.className = `panel-revision panel-revision--${revision.estado}`;
  const nombre = document.createElement('strong');
  nombre.textContent = revision.fuente;
  const estado = document.createElement('span');
  estado.className = 'panel-revision-estado';
  estado.textContent = t(`estado.${revision.estado}`);
  const detalle = document.createElement('span');
  detalle.textContent = revision.texto;
  elemento.append(nombre, ' · ', estado, '. ', detalle);
  return elemento;
}
/** Sin lectura de datos no se afirma que no haya revisiones: se dice que está sin comprobar.
 * @param {import('./cliente.js').EstadoClientePanel} estado @param {boolean} sinConexion */
export function mostrarRevisiones(estado, sinConexion) {
  const destino = document.getElementById('revisiones-panel');
  if (!destino) {
    return;
  }
  const datos = estado.estado === 'activa' && !sinConexion ? estado.datos : null;
  /** @type {Node[]} */
  let contenido;
  if (!datos) {
    contenido = [parrafo(t('sin-comprobar'))];
  } else {
    const revisiones = resumirRevisiones(datos);
    if (revisiones.length) {
      const lista = document.createElement('ul');
      lista.append(...revisiones.map(crearRevision));
      contenido = [lista];
    } else {
      contenido = [parrafo(t('ninguna'))];
    }
  }
  const firma = contenido.map((n) => n.textContent).join('\n');
  if (destino.dataset.revisiones === firma) {
    return;
  }
  destino.dataset.revisiones = firma;
  destino.replaceChildren(...contenido);
}
/** @param {string} valor */
function parrafo(valor) {
  const nodo = document.createElement('p');
  nodo.textContent = valor;
  return nodo;
}
