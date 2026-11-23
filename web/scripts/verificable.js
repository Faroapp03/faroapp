// La página «Faro verificable» (verificable.html): al abrirla comprueba que lo que el dispositivo descarga para usar
// Faro sin IA es lo que nombra el manifiesto de esta versión, y su firma si la web lleva la raíz
// (verificable/comprobacion.js), y lo enseña: el veredicto, la firma, la versión del paquete, cuántos archivos
// coinciden y cada archivo con su resultado, los que no coinciden primero. Las filas son las de «Comprobar Faro»
// (estilos/doctor.css): una marca de color y siempre su palabra. El veredicto se anuncia (role="status") y, si la
// persona pide repetir, el foco va al resultado; al abrir la página no se mueve. Al cambiar de idioma se reescribe sin
// volver a comprobar. Empieza importando sitio.js: no escribe ningún texto antes de que su diccionario esté listo.

import './sitio.js';
import { crear, porId } from './dom.js';
import { alCambiarIdioma } from './idioma.js';
import { texto } from './textos.js';
import { comprobarLoServido, entornoDelNavegador } from './verificable/comprobacion.js';

/** @import { ArchivoComprobado, EstadoDelArchivo, Resultado } from './verificable/comprobacion.js' */

/** La clase de la fila de «Comprobar Faro» que da su color a cada resultado de un archivo. */
const SEMAFORO = Object.freeze({
  coincide: 'doctor-bien',
  'no-coincide': 'doctor-fallo',
  'no-disponible': 'doctor-atencion',
});

const estado = porId('verificable-estado');
const resultadoSeccion = porId('verificable-resultado');
const nodoFirma = porId('verificable-firma');
const nodoPaquete = porId('verificable-paquete');
const cuantos = porId('verificable-cuantos');
const significado = porId('verificable-significado');
const lista = porId('verificable-lista', HTMLUListElement);
const repetir = porId('verificable-repetir', HTMLButtonElement);

/**
 * La última comprobación: lo que se reescribe al cambiar de idioma. La sustituye `comprobar()`.
 * @type {Resultado | null}
 */
let ultima = null;

/**
 * Una fila de la lista: la marca de color (solo adorno), su palabra y la ruta del archivo.
 * @param {ArchivoComprobado} archivo El archivo comprobado.
 * @returns {HTMLLIElement} La fila.
 */
function fila(archivo) {
  return crear(
    'li',
    { className: `doctor-fila ${SEMAFORO[archivo.estado]}` },
    crear('span', { className: 'doctor-marca' }),
    crear('p', { className: 'doctor-semaforo', textContent: texto(`verificable.archivo.${archivo.estado}`) }),
    crear('p', {}, crear('code', { textContent: archivo.ruta })),
  );
}

/**
 * Escribe la última comprobación en el idioma en curso.
 * @returns {void}
 */
function pintar() {
  if (!ultima) {
    return;
  }
  const { veredicto, motivo, paquete, firma, archivos } = ultima;
  const contar = (/** @type {EstadoDelArchivo} */ buscado) =>
    archivos.filter((archivo) => archivo.estado === buscado).length;
  const valores = {
    total: archivos.length,
    coinciden: contar('coincide'),
    fallan: contar('no-coincide'),
    faltan: contar('no-disponible'),
  };
  estado.textContent = texto(`verificable.veredicto.${veredicto}`, valores);
  nodoFirma.textContent = texto(`verificable.firma.${firma}`, { motivo: motivo ?? '' });
  nodoPaquete.textContent = paquete ?? texto('verificable.paquete.desconocido');
  cuantos.textContent = texto('verificable.cuantos.valor', valores);
  significado.textContent = texto(`verificable.significado.${veredicto}`);
  lista.replaceChildren(...archivos.map(fila));
  resultadoSeccion.hidden = false;
}

/**
 * Comprueba y lo enseña; mientras, el botón espera y el estado lo dice. Si algo falla por el camino, el fallo llega a
 * la consola y «Volver a comprobar» vuelve a estar disponible: nunca se queda deshabilitado.
 * @param {{ enfocar: boolean }} opciones `enfocar`, si la persona lo ha pedido: entonces el foco va al resultado
 * @returns {Promise<void>}
 */
async function comprobar({ enfocar }) {
  repetir.disabled = true;
  estado.textContent = texto('verificable.estado.comprobando');
  try {
    ultima = await comprobarLoServido(entornoDelNavegador());
    pintar();
    if (enfocar) {
      resultadoSeccion.focus();
    }
  } finally {
    repetir.disabled = false;
  }
}

repetir.addEventListener('click', () => {
  // Sin await: un fallo sale en la consola como promesa rechazada y «Volver a comprobar» queda disponible (finally).
  void comprobar({ enfocar: true });
});
alCambiarIdioma(pintar);
// Sin await: la página ya está entera y la comprobación escribe su resultado al terminar; un fallo sale en la consola
// como promesa rechazada y deja «Volver a comprobar» disponible (finally de comprobar).
void comprobar({ enfocar: false });
