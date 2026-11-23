// Ejemplo de «predecir la palabra siguiente» en Qué es la IA, con probabilidades reales: las calculó Salamandra 2B, el
// modelo base y abierto del Barcelona Supercomputing Center (BSC-LT/salamandra-2b, Apache-2.0), el 19/10/2026, sumando
// todas las formas de escribir cada palabra. Para cada principio de frase se ven sus 5 palabras más probables y, con el
// desplegable, hasta 20, siempre de mayor a menor; debajo, una frase dice cuánto suman y cuánto queda para el resto de
// palabras. Las frases están en los diccionarios (entender-ia.ejemplo.<ejemplo>.frase); las palabras y sus porcentajes,
// aquí, porque son de cada idioma: al cambiar de idioma se vuelve a pintar el ejemplo elegido con los suyos. Empieza
// importando sitio.js: no pinta nada hasta que el diccionario está cargado.

import './sitio.js';
import { crear, PaginaIncompleta } from './dom.js';
import { alCambiarIdioma, escribir } from './idioma.js';
import { idiomaActual, traducible } from './textos.js';

/**
 * Un ejemplo: sus 20 palabras más probables, cada una con su porcentaje, de mayor a menor, y el porcentaje de la que
 * viene después de la vigésima (el tope de las que no se muestran). Solo palabras y números, como salieron del modelo;
 * las siglas, en mayúsculas.
 * @typedef {{ palabra: string, porcentaje: number }} Palabra
 * @typedef {{ palabras: readonly Readonly<Palabra>[], siguiente: number }} Ejemplo
 */

/**
 * Los datos medidos de cada idioma, en el orden de los botones: muchas opciones repartidas, una clara y varias
 * posibles, y el modelo casi seguro. No son parámetros: salen de palabra-siguiente.json (Kaggle, 19/10/2026).
 * @type {Readonly<Record<'es' | 'ca', readonly Ejemplo[]>>}
 */
const EJEMPLOS = congelar({
  es: [
    {
      palabras: [
        { palabra: 'centro', porcentaje: 6.9656 },
        { palabra: 'mercado', porcentaje: 5.9394 },
        { palabra: 'supermercado', porcentaje: 5.7476 },
        { palabra: 'gimnasio', porcentaje: 3.3447 },
        { palabra: 'banco', porcentaje: 3.2034 },
        { palabra: 'parque', porcentaje: 2.7719 },
        { palabra: 'colegio', porcentaje: 2.5021 },
        { palabra: 'hospital', porcentaje: 2.0315 },
        { palabra: 'cine', porcentaje: 1.9978 },
        { palabra: 'médico', porcentaje: 1.4991 },
        { palabra: 'instituto', porcentaje: 1.466 },
        { palabra: 'cementerio', porcentaje: 1.3842 },
        { palabra: 'cole', porcentaje: 1.2302 },
        { palabra: 'museo', porcentaje: 1.153 },
        { palabra: 'mercadillo', porcentaje: 1.1293 },
        { palabra: 'campo', porcentaje: 1.0909 },
        { palabra: 'corte', porcentaje: 0.996 },
        { palabra: 'baño', porcentaje: 0.9612 },
        { palabra: 'taller', porcentaje: 0.9447 },
        { palabra: 'ayuntamiento', porcentaje: 0.9207 },
      ],
      siguiente: 0.8822,
    },
    {
      palabras: [
        { palabra: 'cliente', porcentaje: 29.271 },
        { palabra: 'proveedor', porcentaje: 9.1132 },
        { palabra: 'comprador', porcentaje: 2.8391 },
        { palabra: 'IVA', porcentaje: 2.585 },
        { palabra: 'pedido', porcentaje: 2.2341 },
        { palabra: 'destinatario', porcentaje: 2.1836 },
        { palabra: 'vendedor', porcentaje: 1.8536 },
        { palabra: 'producto', porcentaje: 1.4168 },
        { palabra: 'trabajador', porcentaje: 1.0305 },
        { palabra: 'banco', porcentaje: 1.0061 },
        { palabra: 'titular', porcentaje: 0.7277 },
        { palabra: 'empleado', porcentaje: 0.7003 },
        { palabra: 'contrato', porcentaje: 0.6858 },
        { palabra: 'siguiente', porcentaje: 0.6129 },
        { palabra: 'almacén', porcentaje: 0.5686 },
        { palabra: 'artículo', porcentaje: 0.5033 },
        { palabra: 'personal', porcentaje: 0.5001 },
        { palabra: 'transportista', porcentaje: 0.4892 },
        { palabra: 'libro', porcentaje: 0.4651 },
        { palabra: 'pago', porcentaje: 0.4487 },
      ],
      siguiente: 0.439,
    },
    {
      palabras: [
        { palabra: 'meses', porcentaje: 77.6121 },
        { palabra: 'años', porcentaje: 19.6235 },
        { palabra: 'días', porcentaje: 0.8494 },
        { palabra: 'semanas', porcentaje: 0.4104 },
        { palabra: 'a', porcentaje: 0.1141 },
        { palabra: 'mes', porcentaje: 0.0539 },
        { palabra: 'o', porcentaje: 0.0344 },
        { palabra: 'año', porcentaje: 0.0168 },
        { palabra: 'de', porcentaje: 0.0134 },
        { palabra: 'horas', porcentaje: 0.0076 },
        { palabra: '2', porcentaje: 0.0057 },
        { palabra: 'y', porcentaje: 0.0052 },
        { palabra: 'hábiles', porcentaje: 0.0038 },
        { palabra: 'en', porcentaje: 0.0035 },
        { palabra: 'minutos', porcentaje: 0.0034 },
        { palabra: 'décadas', porcentaje: 0.0033 },
        { palabra: 'millones', porcentaje: 0.0032 },
        { palabra: 'plazos', porcentaje: 0.0031 },
        { palabra: 'hasta', porcentaje: 0.0022 },
        { palabra: 'veces', porcentaje: 0.0021 },
      ],
      siguiente: 0.0021,
    },
  ],
  ca: [
    {
      palabras: [
        { palabra: 'mercat', porcentaje: 9.2923 },
        { palabra: 'supermercat', porcentaje: 4.9674 },
        { palabra: 'banc', porcentaje: 4.926 },
        { palabra: 'centre', porcentaje: 4.704 },
        { palabra: 'parc', porcentaje: 4.325 },
        { palabra: 'meu', porcentaje: 2.3976 },
        { palabra: 'metge', porcentaje: 1.9108 },
        { palabra: 'camp', porcentaje: 1.804 },
        { palabra: 'cementiri', porcentaje: 1.4721 },
        { palabra: 'carrer', porcentaje: 1.2807 },
        { palabra: 'museu', porcentaje: 1.0926 },
        { palabra: 'poble', porcentaje: 1.0788 },
        { palabra: 'taller', porcentaje: 1.0427 },
        { palabra: 'CAP', porcentaje: 0.9427 },
        { palabra: 'gimnàs', porcentaje: 0.777 },
        { palabra: 'bosc', porcentaje: 0.7559 },
        { palabra: 'barri', porcentaje: 0.7373 },
        { palabra: 'bar', porcentaje: 0.6947 },
        { palabra: 'súper', porcentaje: 0.6881 },
        { palabra: 'cinema', porcentaje: 0.6518 },
      ],
      siguiente: 0.6011,
    },
    {
      palabras: [
        { palabra: 'client', porcentaje: 42.8915 },
        { palabra: 'meu', porcentaje: 5.9949 },
        { palabra: 'proveïdor', porcentaje: 4.8292 },
        { palabra: 'compte', porcentaje: 4.1812 },
        { palabra: 'venedor', porcentaje: 4.008 },
        { palabra: 'comprador', porcentaje: 3.7133 },
        { palabra: 'nom', porcentaje: 0.9856 },
        { palabra: 'teu', porcentaje: 0.9164 },
        { palabra: 'banc', porcentaje: 0.8768 },
        { palabra: 'seu', porcentaje: 0.8215 },
        { palabra: 'destinatari', porcentaje: 0.7073 },
        { palabra: 'nostre', porcentaje: 0.6898 },
        { palabra: 'titular', porcentaje: 0.6449 },
        { palabra: 'que', porcentaje: 0.5988 },
        { palabra: 'treballador', porcentaje: 0.5113 },
        { palabra: 'número', porcentaje: 0.4839 },
        { palabra: 'vostre', porcentaje: 0.4725 },
        { palabra: 'producte', porcentaje: 0.4397 },
        { palabra: 'tipus', porcentaje: 0.4221 },
        { palabra: 'rebut', porcentaje: 0.4182 },
      ],
      siguiente: 0.4001,
    },
    {
      palabras: [
        { palabra: 'mesos', porcentaje: 66.0016 },
        { palabra: 'anys', porcentaje: 30.2233 },
        { palabra: 'dies', porcentaje: 1.4722 },
        { palabra: 'o', porcentaje: 0.0686 },
        { palabra: 'a', porcentaje: 0.044 },
        { palabra: 'meses', porcentaje: 0.0359 },
        { palabra: 'dissabtes', porcentaje: 0.0344 },
        { palabra: 'setmanes', porcentaje: 0.0253 },
        { palabra: 'any', porcentaje: 0.0215 },
        { palabra: 'mes', porcentaje: 0.0145 },
        { palabra: 'i', porcentaje: 0.0134 },
        { palabra: 'màxims', porcentaje: 0.0128 },
        { palabra: 'minuts', porcentaje: 0.0089 },
        { palabra: 'milions', porcentaje: 0.0075 },
        { palabra: 'més', porcentaje: 0.0074 },
        { palabra: 'còmputs', porcentaje: 0.0054 },
        { palabra: '2', porcentaje: 0.0052 },
        { palabra: 'exercicis', porcentaje: 0.005 },
        { palabra: 'de', porcentaje: 0.0047 },
        { palabra: 'sis', porcentaje: 0.0035 },
      ],
      siguiente: 0.0034,
    },
  ],
});
/** Las palabras que se ven siempre; el desplegable muestra las demás de EJEMPLOS, hasta la vigésima. */
const VISIBLES = 5;
/** Entre todas las palabras (y signos) que conoce el modelo, la probabilidad suma el 100 %. */
const TOTAL = 100;
/** Por debajo de esta décima, un porcentaje se escribe «< 0,1 %» en vez de «0,0 %», que parecería imposible. */
const DECIMA = 0.1;

/**
 * Congela los ejemplos de cada idioma, con sus listas de palabras.
 * @param {Record<'es' | 'ca', Ejemplo[]>} datos @returns {Readonly<Record<'es' | 'ca', readonly Ejemplo[]>>}
 */
function congelar(datos) {
  for (const ejemplos of Object.values(datos)) {
    for (const ejemplo of ejemplos) {
      for (const palabra of ejemplo.palabras) {
        Object.freeze(palabra);
      }
      Object.freeze(ejemplo.palabras);
      Object.freeze(ejemplo);
    }
    Object.freeze(ejemplos);
  }
  return Object.freeze(datos);
}

/**
 * Un porcentaje redondeado a una décima.
 * @param {number} porcentaje @returns {number}
 */
function redondear(porcentaje) {
  return Math.round(porcentaje * 10) / 10;
}

/**
 * Un porcentaje con un decimal y coma decimal, separado de su signo por un espacio que no se parte: «29,3 %».
 * @param {number} porcentaje @returns {string}
 */
function cifra(porcentaje) {
  return `${porcentaje.toFixed(1).replace('.', ',')} %`;
}

/**
 * Lo que se lee en la columna de la derecha: la cifra, o «< 0,1 %» si al redondear quedaría en cero.
 * @param {number} porcentaje @returns {string}
 */
function cifraDeFila(porcentaje) {
  return redondear(porcentaje) < DECIMA ? `< ${cifra(DECIMA)}` : cifra(porcentaje);
}

/**
 * Una cifra con su artículo («el 25,2 %»). En catalán, «l'» delante de las que se leen empezando por vocal (1 y 11:
 * «l'1,5 %», «l'11 %»); en castellano las dos claves dicen lo mismo.
 * @param {number} porcentaje @returns {import('./textos.js').Traducible}
 */
function conArticulo(porcentaje) {
  const escrita = cifra(porcentaje);
  const vocal = /^11?,/.test(escrita);
  return vocal
    ? traducible('entender-ia.ejemplo.cifra.vocal', { cifra: escrita })
    : traducible('entender-ia.ejemplo.cifra', { cifra: escrita });
}

/** El índice del HTML debe identificar un ejemplo, sin convertir vacíos ni notaciones alternativas en otro.
 * @param {HTMLButtonElement} boton @returns {number}
 */
function indiceDelBoton(boton) {
  const indice = Number(boton.dataset.indice);
  if (String(indice) !== boton.dataset.indice || !EJEMPLOS.es[indice]) {
    throw new PaginaIncompleta('El botón del ejemplo de IA tiene un data-indice inválido');
  }
  return indice;
}

/**
 * Una fila: la palabra, su barra y su porcentaje. La barra no se lee: la cifra ya lo dice.
 * @param {string} palabra Tal como la escribió el modelo.
 * @param {number} porcentaje Su probabilidad, en puntos porcentuales (0–100).
 * @param {number} mayor El porcentaje de la palabra más probable del ejemplo: su barra ocupa todo el ancho.
 * @param {boolean} oculta Si la fila queda plegada en el desplegable.
 * @returns {HTMLLIElement} El elemento de la lista.
 */
function crearFila(palabra, porcentaje, mayor, oculta) {
  const barra = crear('i');
  // El ancho va por CSSOM, que la política de contenidos permite; un atributo style en línea no se aplicaría.
  barra.style.setProperty('--ancho', `${redondear((porcentaje / mayor) * TOTAL)}%`);
  const pista = crear('span', { className: 'barra' }, barra);
  pista.setAttribute('aria-hidden', 'true');
  return crear(
    'li',
    { hidden: oculta },
    crear('span', { className: 'palabra', textContent: palabra }),
    pista,
    crear('span', { className: 'porcentaje', textContent: cifraDeFila(porcentaje) }),
  );
}

/**
 * La frase de debajo de la lista: cuánto suman las palabras a la vista, cuánto queda para las demás y que ninguna de
 * las que no se ven pasa de la siguiente a la última mostrada (redondeada hacia arriba, para que siempre sea cierto).
 * @param {Ejemplo} ejemplo @param {number} vistas @returns {import('./textos.js').Traducible}
 */
function resumen(ejemplo, vistas) {
  const suma = redondear(ejemplo.palabras.slice(0, vistas).reduce((total, { porcentaje }) => total + porcentaje, 0));
  const siguiente = ejemplo.palabras[vistas]?.porcentaje ?? ejemplo.siguiente;
  return traducible('entender-ia.ejemplo.resumen', {
    numero: String(vistas),
    suma: conArticulo(suma),
    resto: conArticulo(redondear(TOTAL - suma)),
    tope: conArticulo(Math.ceil(siguiente * 10) / 10),
  });
}

/**
 * Enlaza cada botón con su ejemplo (data-indice, posición en EJEMPLOS) y pinta el primero: el pulsado queda con
 * aria-pressed="true", la frase hace de título y la lista se pinta con las palabras de la lengua de la página. El botón
 * del desplegable (aria-expanded) muestra u oculta de la 6.ª a la 20.ª y cambia la frase de debajo. Al cambiar de
 * idioma se vuelve a pintar el elegido, con el desplegable como estaba. Sin la sección del ejemplo, no hace nada.
 */
function iniciarEjemplo() {
  const lista = document.getElementById('ejemplo-lista');
  const frase = document.getElementById('ejemplo-frase');
  const mas = document.getElementById('ejemplo-mas');
  const debajo = document.getElementById('ejemplo-resumen');
  // Cada botón con su ejemplo, leído una sola vez de data-indice.
  const presentes = [...document.querySelectorAll('.ejemplo-opcion')].filter(
    (boton) => boton instanceof HTMLButtonElement,
  );
  if (!lista || !frase || !(mas instanceof HTMLButtonElement) || !debajo || !presentes.length) {
    return;
  }
  const botones = presentes.map((boton) => ({ boton, indice: indiceDelBoton(boton) }));
  let elegido = 0;
  let abierto = false;
  /** @param {number} indice */
  const mostrar = (indice) => {
    const ejemplo = (EJEMPLOS[idiomaActual()] ?? EJEMPLOS.es)[indice];
    if (!ejemplo) {
      throw new PaginaIncompleta('No existe el ejemplo de IA solicitado');
    }
    elegido = indice;
    escribir(frase, traducible(`entender-ia.ejemplo.${indice}.frase`));
    const mayor = ejemplo.palabras[0]?.porcentaje ?? TOTAL;
    lista.replaceChildren(
      ...ejemplo.palabras.map(({ palabra, porcentaje }, i) =>
        crearFila(palabra, porcentaje, mayor, !abierto && i >= VISIBLES),
      ),
    );
    mas.setAttribute('aria-expanded', String(abierto));
    escribir(mas, abierto ? traducible('entender-ia.ejemplo.menos') : traducible('entender-ia.ejemplo.mas'));
    escribir(debajo, resumen(ejemplo, abierto ? ejemplo.palabras.length : VISIBLES));
    for (const { boton, indice: delBoton } of botones) {
      boton.setAttribute('aria-pressed', String(delBoton === indice));
    }
  };
  for (const { boton, indice } of botones) {
    boton.addEventListener('click', () => mostrar(indice));
  }
  mas.addEventListener('click', () => {
    abierto = !abierto;
    mostrar(elegido);
  });
  alCambiarIdioma(() => mostrar(elegido));
  mostrar(0);
}

iniciarEjemplo();
