// Los cambios retenidos de la última observación, solo para leer: qué se retuvo, cuánto se perdería y desde cuándo.
// El bloque aparece solo si hay algo retenido o si no se pudo saber; ningún texto se interpreta como HTML.
import { cifra } from '../scripts/cifras.js';
import { texto as textoPanel } from '../scripts/textos.js';
import { fechaPanel } from './fechas-panel.js';

/** @typedef {import('./estado-datos.js').EstadoDatosPanel} EstadoDatosPanel */
/** @typedef {import('./retenidos-datos.js').RetenidosDatos} RetenidosDatos */
/** @typedef {import('./retenidos-datos.js').CambioRetenidoDatos} CambioRetenidoDatos */
/** @typedef {import('./retenidos-datos.js').CensoSocPendienteDatos} CensoSocPendienteDatos */

const VERSION_RETENIDOS = 6;
const PERDIDAS = {
  entradas: 'panel.retenidos.perdida.entradas',
  'cursos-soc': 'panel.retenidos.perdida.cursos-soc',
};

/** @param {HTMLElement} destino @param {string} contenido */
function parrafo(destino, contenido) {
  const linea = document.createElement('p');
  linea.textContent = contenido;
  destino.append(linea);
}
/** Cada cambio es un elemento de la lista con su propio encabezado, bajo el del bloque. @param {string} titulo */
function elemento(titulo) {
  const fila = document.createElement('li');
  const encabezado = document.createElement('h4');
  encabezado.textContent = titulo;
  fila.append(encabezado);
  return fila;
}
/** @param {CambioRetenidoDatos} cambio */
function filaDeCambio(cambio) {
  const fila = elemento(textoPanel('panel.retenidos.archivo', { archivo: cambio.archivo }));
  for (const { medida, antes, despues } of cambio.perdidas) {
    parrafo(fila, textoPanel(PERDIDAS[medida], { antes: cifra(antes), despues: cifra(despues) }));
  }
  parrafo(fila, textoPanel('panel.retenidos.desde', { fecha: fechaPanel(cambio.desdeUtc) }));
  parrafo(fila, textoPanel('panel.retenidos.ultima', { fecha: fechaPanel(cambio.ultimaUtc) }));
  const acompanantes = cambio.grupo.filter((archivo) => archivo !== cambio.archivo);
  if (acompanantes.length > 0) {
    parrafo(fila, textoPanel('panel.retenidos.grupo', { archivos: acompanantes.join(', ') }));
  }
  parrafo(
    fila,
    cambio.aceptadaUtc === null
      ? textoPanel('panel.retenidos.conserva')
      : textoPanel('panel.retenidos.aceptado', { fecha: fechaPanel(cambio.aceptadaUtc) }),
  );
  return fila;
}
/** @param {CensoSocPendienteDatos} censo */
function filaDelCensoSoc(censo) {
  const fila = elemento(textoPanel('panel.retenidos.soc.titulo'));
  parrafo(
    fila,
    textoPanel('panel.retenidos.soc.cifras', { oferta: cifra(censo.cursosOferta), copia: cifra(censo.cursosCopia) }),
  );
  parrafo(fila, textoPanel('panel.retenidos.soc.consultado', { fecha: fechaPanel(censo.consultadoEn) }));
  parrafo(fila, textoPanel('panel.retenidos.soc.conserva'));
  return fila;
}
/** Una parte que no se pudo leer se dice así: no saberlo no es lo mismo que no tener nada retenido.
 * @param {string} titulo @param {string} aviso */
function filaIlegible(titulo, aviso) {
  const fila = elemento(textoPanel(titulo));
  parrafo(fila, textoPanel(aviso));
  return fila;
}
/** @param {RetenidosDatos} retenidos @returns {HTMLLIElement[]} */
function filas({ cuarentena, censoSoc }) {
  const lista =
    cuarentena.cambios === null
      ? [filaIlegible('panel.retenidos.paquete.titulo', 'panel.retenidos.paquete.ilegible')]
      : cuarentena.cambios.map(filaDeCambio);
  if (censoSoc.lectura === 'ilegible') {
    lista.push(filaIlegible('panel.retenidos.soc.titulo', 'panel.retenidos.soc.ilegible'));
  } else if (censoSoc.pendiente !== null) {
    lista.push(filaDelCensoSoc(censoSoc.pendiente));
  }
  return lista;
}

/** Pinta los cambios retenidos de un estado v6; con otra versión, o sin nada retenido, el bloque queda oculto.
 * @param {{bloque:HTMLElement,lista:HTMLElement}} destino @param {EstadoDatosPanel|null} datos */
export function mostrarRetenidos({ bloque, lista }, datos) {
  const contenido = datos?.version === VERSION_RETENIDOS ? filas(datos.retenidos) : [];
  if (contenido.length === 0) {
    lista.replaceChildren();
    bloque.hidden = true;
    return;
  }
  const elementos = document.createElement('ul');
  elementos.className = 'retenidos-lista';
  elementos.append(...contenido);
  lista.replaceChildren(elementos);
  bloque.hidden = false;
}
