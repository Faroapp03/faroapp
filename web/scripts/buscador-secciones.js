// Buscador de secciones de la portada: filtra en la propia página. Sin IA, sin analítica y sin enviar consultas. Cada
// sección lleva palabras de búsqueda en castellano y en catalán (data-busqueda); el filtro consulta la misma lista con
// independencia del idioma de la página. Empieza importando sitio.js y espera su intento de cargar el diccionario antes
// de iniciar el buscador.

import './sitio.js';
import { porId, pulsaFuera } from './dom.js';
import { escribir } from './idioma.js';
import { accesoASeccionDisponible } from './secciones.js';
import { textoBuscable } from './texto-buscable.js';
import { traducible } from './textos.js';

/** Palabras que no ayudan a buscar, en castellano y en catalán (sin tildes, como quedan al normalizar). */
const PALABRAS_VACIAS = new Set([
  'que',
  'como',
  'con',
  'por',
  'para',
  'una',
  'uno',
  'del',
  'los',
  'las',
  'quiero',
  'necesito',
  'saber',
  'sobre',
  'puedo',
  'puede',
  'hay',
  'cual',
  'son',
  'mis',
  'com',
  'amb',
  'els',
  'vull',
  'necessito',
  'puc',
  'pot',
  'quin',
  'quina',
  'meus',
  'meves',
]);
/** Desde cuatro letras, un término también encuentra las palabras que empiezan por él («form» → «formacion»). */
const LETRAS_PARA_PREFIJO = 4;

/** Las palabras de un texto, normalizadas y separadas por todo lo que no es letra ni cifra. Se aplica igual a la
 * consulta y a las palabras de cada sección: «Índice» encuentra «indice» y «indice» encuentra «Índice».
 * @param {string} texto @returns {string[]}
 */
function palabrasDe(texto) {
  return textoBuscable(texto)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Palabras con significado de la consulta: sin letras sueltas ni palabras vacías.
 * @param {string} consulta @returns {string[]}
 */
function terminosDe(consulta) {
  return palabrasDe(consulta).filter((termino) => termino.length > 1 && !PALABRAS_VACIAS.has(termino));
}

/** @param {string} termino @param {string} palabra */
function encaja(termino, palabra) {
  return palabra === termino || (termino.length >= LETRAS_PARA_PREFIJO && palabra.startsWith(termino));
}

/** Una sección se muestra si algún término encaja con alguna de sus palabras; sin términos, se muestran todas.
 * @param {string[]} terminos @param {string[]} palabras
 */
function coincide(terminos, palabras) {
  return !terminos.length || terminos.some((termino) => palabras.some((palabra) => encaja(termino, palabra)));
}

/** Devuelve la función que muestra solo las secciones que encajan con lo escrito y anuncia cuántas hay.
 * @param {HTMLElement} dialogo @param {HTMLInputElement} campo @returns {() => void}
 */
function crearFiltro(dialogo, campo) {
  const vacio = dialogo.querySelector('.buscador-vacio');
  const estado = porId('buscador-estado');
  const secciones = [...dialogo.querySelectorAll('.buscador-resultados li')]
    .filter((item) => item instanceof HTMLElement)
    .map((item) => ({ item, palabras: palabrasDe(item.dataset.busqueda ?? '') }));
  return () => {
    const terminos = terminosDe(campo.value);
    let encontradas = 0;
    for (const { item, palabras } of secciones) {
      item.hidden = !accesoASeccionDisponible(item) || !coincide(terminos, palabras);
      if (!item.hidden) {
        encontradas += 1;
      }
    }
    if (vacio instanceof HTMLElement) {
      vacio.hidden = encontradas > 0;
    }
    // En castellano y en catalán solo el 1 es singular (CLDR «one»), así que no hace falta Intl.PluralRules.
    const clave = encontradas === 1 ? 'inicio.buscar.encontrada' : 'inicio.buscar.encontradas';
    escribir(estado, traducible(clave, { numero: encontradas }));
  };
}

/** Sin el diálogo, su botón o su campo, el botón del buscador sigue oculto. */
function iniciarBuscador() {
  const dialogo = document.getElementById('buscador');
  const abrir = document.querySelector('.buscador-boton');
  const campo = document.getElementById('buscador-consulta');
  if (!(dialogo instanceof HTMLDialogElement) || !(abrir instanceof HTMLButtonElement)) {
    return;
  }
  if (!(campo instanceof HTMLInputElement)) {
    return;
  }
  const filtrar = crearFiltro(dialogo, campo);

  abrir.hidden = false;
  abrir.addEventListener('click', () => {
    filtrar();
    dialogo.showModal();
    document.body.classList.add('buscador-abierto');
    campo.focus();
  });
  dialogo.querySelector('.buscador-cerrar')?.addEventListener('click', () => dialogo.close());
  dialogo.addEventListener('close', () => {
    document.body.classList.remove('buscador-abierto');
    abrir.focus();
  });
  dialogo.addEventListener('click', (evento) => {
    if (pulsaFuera(dialogo, evento)) {
      dialogo.close();
    }
  });
  campo.addEventListener('input', filtrar);
  document.addEventListener('faro-secciones', filtrar);
}

iniciarBuscador();
