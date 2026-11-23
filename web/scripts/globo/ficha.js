// La ficha del país elegido en «El mundo»: su nombre con la bandera, «La IA en {país}» con una tarjeta por cada dato
// oficial de la IA (datos.js, `bloquesDeIa`: las medidas y, al final, la exposición calculada) y, después, «Cómo se
// reparte el empleo», a la vista. Cada tarjeta dice su cifra en una frase llana («De cada 100…») y la dibuja con el
// mismo sistema que «Cataluña» y «Unión Europea» (datos-globales/dibujo.js): figura con título, año, gráfico, alternativa
// en texto y fuente con su tabla; el color, el de siempre (Cataluña en azul, la UE en naranja, un país en gris). Los
// enlaces a las publicaciones y sus licencias están en la página de créditos. La ficha se pinta en dos sitios (panel.js):
// el arranque (cabecera y primera tarjeta) junto al globo y el resto debajo, en una rejilla de tarjetas. Nada se
// estima. Una región (Cataluña) lleva solo las cifras medidas con la misma definición que las de los países y una
// tarjeta «Sin dato para…» con lo que falta: nunca la cifra de su país en su lugar. Todo se crea con `crear` y se escribe con `escribir`; los textos cambian con el idioma.

import { CODIGO_DE_LA_UE, CODIGO_PROPIO, ESCALAS, esComparable, escalaPara } from '../datos-globales/capitulos.js';
import { distanciaEscrita, numeroEscrito } from '../datos-globales/cifras.js';
import { barras, grafico, lineas, pesas } from '../datos-globales/dibujo.js';
import { conTexto } from '../datos-globales/ficha.js';
import { bandera } from '../datos-globales/graficos.js';
import { figura } from '../datos-globales/seccion.js';
import { crear } from '../dom.js';
import { escribir } from '../idioma.js';
import { conVersiones, traducible } from '../textos.js';
import { bloquesDeIa } from './datos.js';
import { contenidoDeLaExposicion } from './exposicion.js';

/**
 * @import { DatosGlobales, Indicador, Territorio, Valor } from '../datos-globales/datos.js'
 * @import { Bloque } from './datos.js'
 * @import { Parte } from '../textos.js'
 */

/** Las etiquetas de título, por nivel: la ficha usa tres seguidos (país, apartado y bloque). */
const TITULOS = Object.freeze(['h2', 'h3', 'h4', 'h5', 'h6']);
/** El id del título de la ficha, al que va el foco cuando se elige un país en el globo. */
const ID_DEL_TITULO = 'globo-ficha-titulo';
/** Los grandes grupos de la CIUO-08 que se dibujan: del 1 al 9. */
const NUMERO_DE_GRUPOS = 9;
/** Los grandes grupos de la CIUO-08 que se dibujan: el 0 (ocupaciones militares) no, como dice la nota. */
const GRUPOS = Object.freeze(Array.from({ length: NUMERO_DE_GRUPOS }, (_, indice) => indice + 1));
/** Los bloques que un país puede tener y una región sin ellos dice que le faltan, en el orden de la ficha. */
const BLOQUES_QUE_PUEDEN_FALTAR = Object.freeze(/** @type {const} */ (['personas', 'genero', 'trabajo', 'exposicion']));
/** Lo que se lee de un nombre de indicador del empleo: lo que sigue a «gran grupo N:». */
const NOMBRE_DEL_GRUPO = /:\s*(.+)$/u;

/** «De cada 100», sin decimales. @param {number} valor */
function deCada100(valor) {
  return numeroEscrito(valor, 0);
}

/** La señal de la ficha que se está pintando: sus gráficos dejan de redibujarse cuando se elige otro país. */
let senal = /** @type {AbortSignal | undefined} */ (undefined);

/** Un gráfico de la ficha, ligado a su señal. @param {(ancho: number) => SVGElement} dibujar */
function dibujo(dibujar) {
  return grafico(dibujar, senal ? { signal: senal } : {});
}

/** La escala del reparto del empleo por grandes grupos: de 0 a 30 de cada 100, y más si una edición lo pide. */
const ESCALA_DEL_EMPLEO = Object.freeze({ maximo: 30, paso: 10 });

/**
 * El papel de un territorio en los gráficos, con el mismo color que en «Cataluña» y «Unión Europea»: Cataluña en azul,
 * la UE en naranja y cualquier otro país en gris. @param {Territorio} territorio @returns {import('../datos-globales/dibujo.js').Papel}
 */
function papelDe({ codigo }) {
  if (codigo === CODIGO_PROPIO) {
    return 'cat';
  }
  return codigo === CODIGO_DE_LA_UE ? 'ue' : 'resto';
}

/** La fuente de un indicador, con su tabla: «Eurostat (isoc_eb_ai)». @param {{ fuente: string, tabla: string | null }} indicador */
function fuenteDe({ fuente, tabla }) {
  return tabla ? `${fuente} (${tabla})` : fuente;
}

/**
 * Una figura de la ficha con el mismo sistema que las otras dos páginas (dibujo.js): título, año, el gráfico, su
 * alternativa en texto y la fuente con su tabla.
 * @param {{ titulo: Parte, anio: Parte, nodo: HTMLElement, alternativa: Parte[], fuente: string, notas?: Parte[] }} partes
 */
function figuraDeLaFicha({ titulo, anio, nodo, alternativa, fuente, notas = [] }) {
  return figura({
    titulo,
    sub: [anio],
    control: null,
    marca: null,
    paneles: [{ titulo: null, nodo }],
    alternativa,
    fuente,
    notas,
  });
}

/**
 * Unas barras de la ficha: cada fila, del propio territorio y en su color, con su cifra en una frase para los lectores
 * de pantalla. @param {{ filas: { nombre: Parte, valor: number }[], papel: import('../datos-globales/dibujo.js').Papel,
 *   base: { maximo: number, paso: number } }} opciones
 */
function barrasDeLaFicha({ filas, papel, base }) {
  const escala = escalaPara(
    base,
    filas.map(({ valor }) => valor),
  );
  const conPapel = filas.map(({ nombre, valor }) => ({ papel, nombre, detalle: null, valor }));
  return {
    nodo: dibujo(barras({ filas: conPapel, escala, referencia: null, opinion: false, decimales: 1 })).nodo,
    alternativa: filas.map(({ nombre, valor }) =>
      traducible('datos-globales.alternativa.cifra', { territorio: nombre, cifra: numeroEscrito(valor) }),
    ),
  };
}

/**
 * Un bloque: su título, la cifra grande con su frase (como las tarjetas de «Lo esencial») y los gráficos, cada uno con
 * su fuente.
 * @param {{ etiqueta: string, titulo: Parte, cifra: number, frase: Parte, graficos: HTMLElement[] }} bloque
 */
function dato({ etiqueta, titulo, cifra, frase, graficos }) {
  return tarjeta(etiqueta, titulo, [clave(cifra, frase), ...graficos]);
}

/** La cifra grande junto a su frase, como las tarjetas de «Lo esencial». @param {number} cifra @param {Parte} frase */
function clave(cifra, frase) {
  // La cifra grande es adorno: la frase ya la dice.
  const grande = crear('p', { className: 'dg-clave-cifra', textContent: deCada100(cifra) });
  grande.setAttribute('aria-hidden', 'true');
  return crear(
    'div',
    { className: 'dg-clave dg-clave--propia' },
    grande,
    conTexto('p', { className: 'dg-clave-texto' }, frase),
  );
}

/**
 * Una tarjeta de la ficha: su título y lo que lleva dentro.
 * @param {string} etiqueta @param {Parte} titulo @param {HTMLElement[]} contenido
 */
function tarjeta(etiqueta, titulo, contenido) {
  return crear(
    'div',
    { className: 'globo-dato' },
    conTexto(/** @type {'h4'} */ (etiqueta), { className: 'globo-dato-titulo' }, titulo),
    ...contenido,
  );
}

/** Un texto de un bloque, con el nombre del bloque y la clave tras «globo.ficha.». @param {Bloque} bloque @param {string} clave
 * @param {import('../textos.js').Valores} [valores] */
function textoDe(bloque, clave, valores = {}) {
  return traducible(`globo.ficha.${bloque.clave}.${clave}`, valores);
}

/**
 * La línea de evolución de un territorio, protagonista (con su cifra en cada año), en su figura.
 * @param {{ titulo: Parte, papel: import('../datos-globales/dibujo.js').Papel, nombre: Parte,
 *   puntos: { anio: number, valor: number }[], ocultos: number[], base: { maximo: number, paso: number }, fuente: string,
 *   notas: Parte[] }} linea
 */
function figuraDeLinea({ titulo, papel, nombre, puntos, ocultos, base, fuente, notas }) {
  const primero = /** @type {{ anio: number }} */ (puntos[0]);
  const ultimo = /** @type {{ anio: number }} */ (puntos.at(-1));
  const escala = escalaPara(
    base,
    puntos.map(({ valor }) => valor),
  );
  const series = [{ papel, nombre, puntos, ocultos, protagonista: true }];
  return figuraDeLaFicha({
    titulo,
    anio: traducible('globo.ficha.anios-grafico', { desde: String(primero.anio), hasta: String(ultimo.anio) }),
    nodo: dibujo(lineas({ series, desde: primero.anio, hasta: ultimo.anio, escala })).nodo,
    alternativa: [
      traducible('datos-globales.alternativa.cifra', {
        territorio: nombre,
        cifra: puntos.map(({ anio, valor }) => `${anio}, ${numeroEscrito(valor)}`).join('; '),
      }),
    ],
    fuente,
    notas,
  });
}

/**
 * Empresas (Eurostat) o la medida nacional: la evolución, con el eje de años proporcional, si hay dos años comparables
 * o más; si no, la única cifra en una barra. Un año que la fuente marca como no comparable (la lista más corta de
 * tecnologías de 2021) no se dibuja ni se une, y una nota lo dice.
 * @param {import('./datos.js').BloqueDeSerie} bloque @param {Territorio} territorio @param {string} etiqueta
 */
function deSerie(bloque, territorio, etiqueta) {
  const { serie, indicador } = bloque;
  const ultima = /** @type {Valor} */ (serie.at(-1));
  // La medida nacional de las personas dice qué mide con el nombre de su indicador: cada encuesta pregunta otra cosa.
  const titulo = bloque.clave === 'nacional-personas' ? conVersiones(indicador.nombre) : textoDe(bloque, 'grafico');
  const puntos = serie.filter(esComparable).map(({ anio, valor }) => ({ anio, valor }));
  const ocultos = serie.filter((valor) => !esComparable(valor)).map(({ anio }) => anio);
  const [primero] = puntos;
  const papel = papelDe(territorio);
  const base = bloque.clave === 'empresas' ? ESCALAS.empresas : ESCALAS.personas;
  const notas = ocultos.length ? [traducible('globo.ficha.no-comparable', { anios: ocultos.join(', ') })] : [];
  const fuente = fuenteDe(indicador);
  const nombre = conVersiones(territorio.nombre);
  const enLinea = primero && puntos.length > 1;
  const figuraDeLaSerie = enLinea
    ? figuraDeLinea({ titulo, papel, nombre, puntos, ocultos, base, fuente, notas })
    : figuraDeLaFicha({
        titulo,
        anio: traducible('globo.ficha.anio-grafico', { anio: String(ultima.anio) }),
        ...barrasDeLaFicha({ filas: [{ nombre, valor: ultima.valor }], papel, base }),
        fuente,
        notas,
      });
  const frase = textoDe(bloque, 'frase', { n: deCada100(ultima.valor), anio: String(ultima.anio) });
  return dato({ etiqueta, titulo: textoDe(bloque, 'titulo'), cifra: ultima.valor, frase, graficos: [figuraDeLaSerie] });
}

/** Personas que usan IA generativa: para cualquier uso y, si está, para trabajar, a la misma escala.
 * @param {import('./datos.js').BloquePersonas} bloque @param {Territorio} territorio @param {string} etiqueta */
function dePersonas(bloque, territorio, etiqueta) {
  const { total, trabajo } = bloque;
  const valores = { n: deCada100(total.valor), anio: String(total.anio) };
  const frase = trabajo
    ? textoDe(bloque, 'frase-trabajo', { ...valores, trabajo: deCada100(trabajo.valor) })
    : textoDe(bloque, 'frase', valores);
  const filas = [
    { nombre: traducible('globo.ficha.cualquier-uso'), valor: total.valor },
    ...(trabajo ? [{ nombre: traducible('globo.ficha.para-trabajar'), valor: trabajo.valor }] : []),
  ];
  const graficos = [
    figuraDeLaFicha({
      titulo: textoDe(bloque, 'grafico'),
      anio: traducible('globo.ficha.anio-grafico', { anio: String(total.anio) }),
      ...barrasDeLaFicha({ filas, papel: papelDe(territorio), base: ESCALAS.personas }),
      fuente: fuenteDe(bloque.indicador),
    }),
  ];
  return dato({ etiqueta, titulo: textoDe(bloque, 'titulo'), cifra: total.valor, frase, graficos });
}

/**
 * Las pesas de mujeres y hombres de un territorio, en su figura: un círculo y un cuadrado por uso, a la escala de las
 * personas, con la diferencia en puntos. @param {import('./datos.js').BloqueGenero} bloque
 * @param {import('../datos-globales/dibujo.js').Papel} papel
 */
function figuraDeGenero(bloque, papel) {
  const filas = bloque.pares.map((par) => {
    const corta = distanciaEscrita(par.hombres.valor, par.mujeres.valor);
    return {
      papel,
      nombre: traducible(`globo.ficha.${par.uso}`),
      detalle: null,
      a: par.mujeres.valor,
      b: par.hombres.valor,
      diferencia: { larga: traducible('datos-globales.puntos', { puntos: corta }), corta },
    };
  });
  const escala = escalaPara(
    ESCALAS.personas,
    filas.flatMap(({ a, b }) => [a, b]),
  );
  const nombres = /** @type {[Parte, Parte]} */ ([
    traducible('datos-globales.genero.mujeres'),
    traducible('datos-globales.genero.hombres'),
  ]);
  const cabecera = /** @type {[Parte, Parte]} */ ([
    traducible('datos-globales.genero.cabecera'),
    traducible('datos-globales.cabecera.corta'),
  ]);
  return figuraDeLaFicha({
    titulo: textoDe(bloque, 'grafico'),
    anio: traducible('globo.ficha.anio-grafico', { anio: String(bloque.pares[0]?.mujeres.anio ?? '') }),
    nodo: dibujo(pesas({ filas, nombres, cabecera, escala })).nodo,
    alternativa: filas.map(({ nombre, a, b, diferencia }) =>
      traducible('datos-globales.genero.alternativa', {
        territorio: nombre,
        a: numeroEscrito(a),
        b: numeroEscrito(b),
        puntos: diferencia.corta,
      }),
    ),
    fuente: fuenteDe(bloque.indicador),
    notas: [traducible('globo.ficha.genero.nota')],
  });
}

/** Mujeres y hombres: pesas (círculo, mujeres; cuadrado, hombres) con la diferencia en puntos, como en «Cataluña».
 * @param {import('./datos.js').BloqueGenero} bloque @param {Territorio} territorio @param {string} etiqueta */
function deGenero(bloque, territorio, etiqueta) {
  const { pares } = bloque;
  const [primero] = /** @type {[import('./datos.js').Par]} */ (pares);
  const { mujeres, hombres } = primero;
  const frase = textoDe(bloque, 'frase', {
    a: deCada100(mujeres.valor),
    b: deCada100(hombres.valor),
    anio: String(mujeres.anio),
  });
  const grafica = figuraDeGenero(bloque, papelDe(territorio));
  return dato({ etiqueta, titulo: textoDe(bloque, 'titulo'), cifra: mujeres.valor, frase, graficos: [grafica] });
}

/** Según el tipo de trabajo: no manual, manual y, si está, profesionales de las TIC, a la escala de las personas.
 * @param {import('./datos.js').BloqueTrabajo} bloque @param {Territorio} territorio @param {string} etiqueta */
function deTrabajo(bloque, territorio, etiqueta) {
  const { noManual, manual, tic } = bloque;
  const frase = textoDe(bloque, 'frase', {
    a: deCada100(noManual.valor),
    b: deCada100(manual.valor),
    anio: String(noManual.anio),
  });
  const filas = [
    { nombre: textoDe(bloque, 'no-manual'), valor: noManual.valor },
    { nombre: textoDe(bloque, 'manual'), valor: manual.valor },
    ...(tic ? [{ nombre: textoDe(bloque, 'tic'), valor: tic.valor }] : []),
  ];
  const graficos = [
    figuraDeLaFicha({
      titulo: textoDe(bloque, 'grafico'),
      anio: traducible('globo.ficha.anio-grafico', { anio: String(noManual.anio) }),
      ...barrasDeLaFicha({ filas, papel: papelDe(territorio), base: ESCALAS.personas }),
      fuente: fuenteDe(bloque.indicador),
    }),
  ];
  return dato({ etiqueta, titulo: textoDe(bloque, 'titulo'), cifra: noManual.valor, frase, graficos });
}

/** Un bloque de «La IA en {país}», ya pintado. @param {Bloque} bloque @param {Territorio} territorio @param {string} etiqueta */
function pintarBloque(bloque, territorio, etiqueta) {
  if (bloque.clave === 'personas') {
    return dePersonas(bloque, territorio, etiqueta);
  }
  if (bloque.clave === 'genero') {
    return deGenero(bloque, territorio, etiqueta);
  }
  if (bloque.clave === 'trabajo') {
    return deTrabajo(bloque, territorio, etiqueta);
  }
  if (bloque.clave === 'exposicion') {
    return tarjeta(etiqueta, textoDe(bloque, 'titulo'), contenidoDeLaExposicion(bloque));
  }
  return deSerie(bloque, territorio, etiqueta);
}

/** El año de la cifra más reciente de un bloque. @param {Bloque} bloque */
function anioDe(bloque) {
  if (bloque.clave === 'personas') {
    return bloque.total.anio;
  }
  if (bloque.clave === 'genero') {
    return bloque.pares[0]?.mujeres.anio ?? 0;
  }
  if (bloque.clave === 'trabajo') {
    return bloque.noManual.anio;
  }
  if (bloque.clave === 'exposicion') {
    return bloque.alta.cifra.anio;
  }
  return bloque.serie.at(-1)?.anio ?? 0;
}

/** El nombre oficial de un gran grupo: lo que sigue a «gran grupo N:» en el nombre de su indicador. @param {Indicador} i */
function nombreDelGrupo({ nombre }) {
  return conVersiones({
    es: NOMBRE_DEL_GRUPO.exec(nombre.es)?.[1] ?? nombre.es,
    ca: NOMBRE_DEL_GRUPO.exec(nombre.ca)?.[1] ?? nombre.ca,
  });
}

/**
 * Los grandes grupos con cifra de empleo en un país, de mayor a menor, con su porcentaje de mujeres si lo hay: cada
 * uno con su nombre oficial y su nombre corto de los gráficos (en los diccionarios, `globo.ficha.empleo.grupo.N`).
 * @param {DatosGlobales} datos @param {Territorio} territorio
 */
function gruposDelEmpleo(datos, territorio) {
  const ultimo = (/** @type {string} */ id) => territorio.valores.find((uno) => uno.indicador === id) ?? null;
  return GRUPOS.flatMap((grupo) => {
    const deEmpleo = datos.indicadores.find((uno) => uno.id === `empleo-isco-${grupo}`);
    const [empleo, mujeres] = [ultimo(`empleo-isco-${grupo}`), ultimo(`mujeres-isco-${grupo}`)];
    const corto = traducible(`globo.ficha.empleo.grupo.${grupo}`);
    return empleo && deEmpleo ? [{ nombre: nombreDelGrupo(deEmpleo), corto, empleo, mujeres, deEmpleo }] : [];
  }).sort((a, b) => b.empleo.valor - a.empleo.valor);
}

/**
 * Las tarjetas de «Cómo se reparte el empleo»: de cada 100 personas que trabajan, cuántas en cada gran grupo (de mayor
 * a menor) y, en el mismo orden, cuántas mujeres hay en cada uno. Vacío si la OIT no publica ese reparto.
 * @param {DatosGlobales} datos @param {Territorio} territorio @param {string} etiqueta
 * @returns {HTMLElement[]}
 */
function tarjetasDelEmpleo(datos, territorio, etiqueta) {
  const filas = gruposDelEmpleo(datos, territorio);
  const [mayor] = filas;
  if (!mayor) {
    return [];
  }
  const anio = mayor.empleo.anio;
  const fuente = fuenteDe(mayor.deEmpleo);
  const resumen = traducible('globo.ficha.empleo.resumen', {
    grupo: mayor.nombre,
    n: deCada100(mayor.empleo.valor),
    anio: String(anio),
  });
  const papel = papelDe(territorio);
  const delAnio = traducible('globo.ficha.anio-grafico', { anio: String(anio) });
  const grupos = tarjeta(etiqueta, traducible('globo.ficha.empleo.grupos'), [
    clave(mayor.empleo.valor, resumen),
    figuraDeLaFicha({
      titulo: traducible('globo.ficha.empleo.grafico'),
      anio: delAnio,
      ...barrasDeLaFicha({
        filas: filas.map(({ corto, empleo }) => ({ nombre: corto, valor: empleo.valor })),
        papel,
        base: ESCALA_DEL_EMPLEO,
      }),
      fuente,
    }),
  ]);
  const conMujeres = filas.filter(({ mujeres }) => mujeres !== null);
  if (!conMujeres.length) {
    return [grupos];
  }
  const mujeres = tarjeta(etiqueta, traducible('globo.ficha.empleo.mujeres.titulo'), [
    figuraDeLaFicha({
      titulo: traducible('globo.ficha.empleo.mujeres'),
      anio: delAnio,
      ...barrasDeLaFicha({
        filas: conMujeres.map(({ corto, mujeres: valor }) => ({ nombre: corto, valor: valor?.valor ?? 0 })),
        papel,
        base: ESCALAS.opinion,
      }),
      fuente,
    }),
  ]);
  return [grupos, mujeres];
}

/** Los años y los organismos de las cifras de la ficha, para su cabecera. @param {Bloque[]} bloques @param {Territorio} territorio */
function resumenDeLaFicha(bloques, territorio) {
  const empleo = territorio.valores.filter(({ indicador }) => indicador.startsWith('empleo-isco-'));
  const anios = [...bloques.map(anioDe), ...empleo.slice(0, 1).map(({ anio }) => anio)].filter((anio) => anio > 0);
  const fuentes = [
    ...new Set([...bloques.map(({ indicador }) => indicador.fuente), ...(empleo.length ? ['OIT (ILOSTAT)'] : [])]),
  ];
  return { desde: Math.min(...anios), hasta: Math.max(...anios), fuentes: fuentes.join(', ') };
}

/**
 * La cabecera de la ficha: «Ficha del país», el nombre con la bandera y los años y organismos de sus cifras.
 * @param {Territorio} territorio @param {Bloque[]} bloques @param {string} etiqueta la del título
 */
function cabeceraDe(territorio, bloques, etiqueta) {
  const imagen = bandera(territorio.codigo, { delJuego: true });
  const titulo = crear(/** @type {'h2'} */ (etiqueta), {
    id: ID_DEL_TITULO,
    className: 'globo-ficha-titulo',
    tabIndex: -1,
  });
  titulo.append(...(imagen ? [imagen] : []), escribir(crear('span'), conVersiones(territorio.nombre)));
  const { desde, hasta, fuentes } = resumenDeLaFicha(bloques, territorio);
  const cabecera = crear(
    'header',
    { className: 'globo-ficha-cabecera' },
    conTexto(
      'p',
      { className: 'antetitulo' },
      traducible(territorio.tipo === 'region' ? 'globo.ficha.antetitulo-region' : 'globo.ficha.antetitulo'),
    ),
    titulo,
  );
  if (Number.isFinite(desde)) {
    const anios =
      desde === hasta ? String(desde) : traducible('globo.ficha.anios', { desde: String(desde), hasta: String(hasta) });
    cabecera.append(
      conTexto('p', { className: 'globo-ficha-datos' }, traducible('globo.ficha.datos', { anios, fuentes })),
    );
  }
  return { cabecera, titulo };
}

/**
 * La tarjeta «Sin dato para {región}»: lo que la ficha de un país enseña y la región no tiene con la misma definición
 * (o no tiene), por su título, y por qué no se pone la cifra de su país. Vacía si no es una región o no le falta nada.
 * @param {Territorio} territorio @param {Bloque[]} bloques @param {boolean} conEmpleo @param {string} etiqueta
 * @returns {HTMLElement[]}
 */
function sinDato(territorio, bloques, conEmpleo, etiqueta) {
  if (territorio.tipo !== 'region') {
    return [];
  }
  const tiene = new Set(bloques.map(({ clave }) => clave));
  const faltan = [
    ...BLOQUES_QUE_PUEDEN_FALTAR.filter((clave) => !tiene.has(clave)).map((clave) => `globo.ficha.${clave}.titulo`),
    ...(conEmpleo ? [] : ['globo.ficha.empleo.titulo']),
  ];
  if (!faltan.length) {
    return [];
  }
  const nombre = conVersiones(territorio.nombre);
  const lista = crear(
    'ul',
    { className: 'globo-sin-dato' },
    ...faltan.map((clave) => conTexto('li', {}, traducible(clave))),
  );
  const nota = conTexto('p', { className: 'globo-dato-nota' }, traducible('globo.ficha.sin-dato.nota'));
  return [tarjeta(etiqueta, traducible('globo.ficha.sin-dato.titulo', { territorio: nombre }), [lista, nota])];
}

// ---------- Lo público ----------

/**
 * Los dos sitios de la ficha en la página: el arranque, junto al globo, y el resto, en la rejilla de debajo.
 * @typedef {{ arranque: HTMLElement, resto: HTMLElement }} Sitios
 */

/**
 * Pinta la ficha del país elegido y devuelve su título (al que va el foco al elegir en el globo). El arranque lleva la
 * cabecera, «La IA en {país}» y la primera tarjeta; el resto, las demás y, después, «Cómo se reparte el empleo», a la
 * vista y con sus tarjetas en la misma rejilla. La señal opcional de sitios limita la vida de sus gráficos.
 * @param {Sitios & { signal?: AbortSignal }} sitios @param {DatosGlobales} datos @param {Territorio} territorio @param {2 | 3 | 4} nivel
 * @returns {HTMLElement}
 */
export function pintarFicha({ arranque, resto, signal }, datos, territorio, nivel) {
  senal = signal;
  const [deTitulo, deApartado, deBloque = 'h6'] = TITULOS.slice(nivel - 2, nivel + 1);
  const bloques = bloquesDeIa(datos, territorio);
  const { cabecera, titulo } = cabeceraDe(territorio, bloques, deTitulo ?? 'h2');
  const apartado = (/** @type {Parte} */ texto) =>
    conTexto(/** @type {'h3'} */ (deApartado), { className: 'globo-ficha-apartado' }, texto);
  const [primera, ...demas] = bloques.map((bloque) => pintarBloque(bloque, territorio, deBloque));
  const ia = apartado(traducible('globo.panel.ia', { territorio: conVersiones(territorio.nombre) }));
  arranque.replaceChildren(cabecera, ...(primera ? [ia, primera] : []));
  const empleo = tarjetasDelEmpleo(datos, territorio, deBloque);
  const delEmpleo = crear(
    'section',
    { className: 'globo-empleo' },
    apartado(traducible('globo.ficha.empleo.titulo')),
    crear('div', { className: 'globo-tarjetas' }, ...empleo),
  );
  const faltan = sinDato(territorio, bloques, empleo.length > 0, deBloque);
  resto.replaceChildren(...demas, ...faltan, ...(empleo.length ? [delEmpleo] : []));
  return titulo;
}
