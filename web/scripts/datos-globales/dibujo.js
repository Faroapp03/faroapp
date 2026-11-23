// Los gráficos de «Datos globales» (datos-globales.html y datos-globales-ue.html), en SVG propio y sin librerías:
// barras de mayor a menor con la media de la UE como raya discontinua de referencia; líneas de evolución con el eje
// de años proporcional; pesas (un círculo y un cuadrado por territorio: mujeres y hombres, trabajo manual y no manual)
// con su diferencia; la comparación mínima de «Lo esencial»; la barra hacia una meta con su escala real, y la tabla
// gráfica año a año. Cada gráfico se dibuja a su ancho real y se vuelve a dibujar, sin animación, cuando cambia ese
// ancho o el idioma: así el texto mide siempre 12 o 13 px y se lee en un móvil. El color sale de las clases (c-cat,
// c-ue, c-esp, c-resto), que la hoja pinta con los tokens --dato-*; nada depende solo del color: Cataluña va además
// en negrita, la UE discontinua y rotulada, y mujeres y hombres se distinguen por la forma. Los dibujos son adorno
// para los lectores de pantalla (aria-hidden): cada figura lleva su alternativa en texto (seccion.js).

import { crear } from '../dom.js';
import { alCambiarIdioma } from '../idioma.js';
import { resolver } from '../textos.js';
import { numeroEscrito } from './cifras.js';
import { conTexto } from './ficha.js';
import { DECIMAS_DE_PORCENTAJE, ladoDeLasCifras, ORDEN_DE_DIBUJO, seUnen } from './graficos.js';

/**
 * @import { Parte } from '../textos.js'
 * @typedef {'cat' | 'ue' | 'esp' | 'resto'} Papel el papel de un territorio o grupo en un gráfico: su color y su peso
 * @typedef {{ maximo: number, paso: number }} Escala de 0 a `maximo`, con una marca rotulada cada `paso`
 * @typedef {{ papel: Papel, nombre: Parte, detalle: Parte | null, valor: number }} FilaDeBarra `detalle`, una segunda
 *   línea del nombre, más tenue («(con Cataluña)»)
 * @typedef {{ filas: FilaDeBarra[], escala: Escala, referencia: { valor: number, rotulo: Parte } | null,
 *   opinion: boolean, decimales: number }} Barras `referencia`, la media de la UE como raya discontinua; `opinion`,
 *   las barras tenues de las encuestas de opinión
 * @typedef {{ anio: number, valor: number }} Punto
 * @typedef {{ papel: Papel, nombre: Parte, puntos: Punto[], ocultos: number[], protagonista: boolean }} Serie
 *   `ocultos`, los años con un dato no comparable, que no se dibujan ni se unen por encima; `protagonista`, la serie
 *   de la UE en su página (línea continua y cifra en cada año)
 * @typedef {{ series: Serie[], desde: number, hasta: number, escala: Escala }} Lineas
 * @typedef {{ papel: Papel, nombre: Parte, detalle: Parte | null, a: number, b: number,
 *   diferencia: { larga: Parte, corta: string } }} FilaDePesas `a`, el círculo; `b`, el cuadrado
 * @typedef {{ filas: FilaDePesas[], nombres: [Parte, Parte], cabecera: [Parte, Parte], escala: Escala }} Pesas
 *   `nombres`, los del círculo y el cuadrado; `cabecera`, la de la columna de la diferencia, larga y corta
 * @typedef {{ papel: Papel | 'meta', nombre: Parte, valor: number, texto: string }} FilaMinima
 * @typedef {{ valor: number, meta: number, escala: Escala, anteriores: number[], rotuloValor: Parte,
 *   rotuloMeta: Parte, eje: (marca: number) => string }} HaciaMeta
 * @typedef {{ papel: Papel, nombre: Parte, valores: ReadonlyMap<number, number> }} FilaAnual
 */

const SVG = 'http://www.w3.org/2000/svg';
/** El ancho con que se dibuja un gráfico que todavía no está en la página (o en un DOM sin disposición). */
export const ANCHO_SIN_MEDIDA = 640;
/** Lo que mide, de media, un carácter de Space Grotesk respecto de su cuerpo: para no pisar rótulos sin medirlos. */
const ANCHO_DE_LETRA = 0.56;
/** Los cuerpos de letra de los gráficos, en px: el del texto y el de los ejes y las notas (el mínimo de Faro). */
const LETRA = Object.freeze({ texto: 13, eje: 12 });
/** La distancia mínima, en px, entre dos marcas rotuladas de un eje horizontal. */
const MARCAS_JUNTAS = 40;
/** Desde la línea de base de un texto hasta su centro visual, en px. */
const MEDIA_LETRA = 4.5;

/**
 * Las medidas de cada gráfico, en px. Los nombres de las barras ocupan como mucho la fracción `nombres` del ancho y se
 * parten en dos líneas si hace falta; debajo de `estrecho` px, el gráfico pasa a sus medidas de móvil.
 * En `ejes`, las comunes: `debajo`, desde el final de la rejilla (o de la marca de un año) hasta la línea de base de
 * sus números; `marcasSinSaltar`, cuántas marcas se rotulan todas en un gráfico estrecho (con más, una de cada dos).
 */
const MEDIDAS = Object.freeze({
  ejes: Object.freeze({ debajo: 16, marcasSinSaltar: 6 }),
  barras: Object.freeze({
    estrecho: 460,
    nombresMinimo: 84,
    nombres: 0.42,
    hueco: 12,
    cifra: 58,
    fila: 36,
    filaDoble: 48,
    barra: 18,
    arriba: 8,
    arribaConReferencia: 30,
    abajo: 26,
    rejillaSobre: 4,
    cifraAparte: 6,
    holgura: 3,
    rayaSobre: 8,
    rotuloSobre: 13,
    rotuloAparte: 4,
  }),
  lineas: Object.freeze({
    estrecho: 520,
    izquierda: 34,
    derecha: 134,
    derechaEstrecho: 106,
    arriba: 34,
    abajo: 30,
    alto: 360,
    altoEstrecho: 300,
    separacion: 16,
    radio: 4.5,
    radioOtro: 3.5,
    sobre: 10,
    bajo: 18,
    lado: 8,
    marca: 5,
    aniosSinSaltar: 4,
    margenDelEje: 16,
    numerosDelEje: 8,
    unidadSobre: 6,
    rejillaDespues: 8,
  }),
  pesas: Object.freeze({
    estrecho: 520,
    nombres: 112,
    nombresEstrecho: 88,
    diferencia: 104,
    diferenciaEstrecho: 56,
    arriba: 40,
    fila: 44,
    separador: 14,
    abajo: 26,
    radio: 6,
    cuadrado: 11,
    rotulo: 10,
    leyenda: 16,
    rejillaSobre: 6,
    holgura: 8,
  }),
  mini: Object.freeze({ fila: 30, texto: 13, barra: 6, cifra: 18 }),
  meta: Object.freeze({
    alto: 100,
    barra: 30,
    grueso: 16,
    sobre: 8,
    bajo: 22,
    raya: 7,
    estrecho: 520,
    holgura: 8,
    marcaSobresale: 4,
    ejeSobreElBorde: 4,
    anteriorDentro: 3,
  }),
});
/**
 * Un elemento SVG con sus atributos y, si se da, su texto.
 * @param {string} etiqueta @param {Record<string, string | number>} atributos @param {string} [texto]
 * @returns {SVGElement}
 */
function s(etiqueta, atributos, texto) {
  const elemento = /** @type {SVGElement} */ (document.createElementNS(SVG, etiqueta));
  for (const [nombre, valor] of Object.entries(atributos)) {
    elemento.setAttribute(nombre, String(valor));
  }
  if (texto !== undefined) {
    elemento.textContent = texto;
  }
  return elemento;
}

/** Una coordenada redondeada a la décima. @param {number} valor @returns {number} */
function d(valor) {
  return Math.round(valor * 10) / 10;
}

/**
 * El lienzo de un gráfico, a su tamaño real y de adorno para los lectores de pantalla.
 * @param {number} ancho @param {number} alto @param {string} clase @returns {SVGElement}
 */
function lienzo(ancho, alto, clase) {
  return s('svg', {
    class: `dg-svg ${clase}`,
    width: ancho,
    height: d(alto),
    viewBox: `0 0 ${ancho} ${d(alto)}`,
    'aria-hidden': 'true',
    focusable: 'false',
  });
}

/** Lo que mide un texto, más o menos, sin medirlo. @param {string} texto @param {number} [cuerpo] */
export function anchoDe(texto, cuerpo = LETRA.texto) {
  return texto.length * cuerpo * ANCHO_DE_LETRA;
}

/**
 * Un nombre en una línea o, si no cabe en `maximo` px, en dos, partido por el espacio más cercano a la mitad.
 * @param {string} texto @param {number} maximo @returns {string[]}
 */
export function partir(texto, maximo) {
  if (anchoDe(texto) <= maximo || !texto.includes(' ')) {
    return [texto];
  }
  const mitad = texto.length / 2;
  const espacios = [...texto.matchAll(/ /g)].map(({ index }) => index);
  const corte = espacios.reduce((mejor, i) => (Math.abs(i - mitad) < Math.abs(mejor - mitad) ? i : mejor));
  return [texto.slice(0, corte), texto.slice(corte + 1)];
}

/** La clase de texto de un papel: Cataluña y la UE, en su color y en negrita. @param {Papel | 'meta'} papel */
function claseDeTexto(papel) {
  if (papel === 'cat') {
    return 't-cat';
  }
  return papel === 'ue' ? 't-ue' : 't-dato';
}

/**
 * Un gráfico que se dibuja a su ancho real. Se vuelve a dibujar, sin animación, cuando cambia ese ancho (los avisos
 * del ResizeObserver se agrupan en un solo cuadro) o el idioma (sus rótulos son texto del SVG). Sin medida (todavía
 * fuera de la página, o en un DOM sin disposición), se dibuja a ANCHO_SIN_MEDIDA.
 * Con `signal`, deja de redibujarse (de ancho y de idioma) cuando se aborta: lo usa quien sustituye sus gráficos (la
 * ficha de «El mundo», al elegir otro país).
 * @param {(ancho: number) => SVGElement} dibujar @param {{ signal?: AbortSignal }} [opciones]
 * @returns {{ nodo: HTMLElement, redibujar: () => void }}
 */
export function grafico(dibujar, { signal } = {}) {
  const nodo = crear('div', { className: 'dg-g' });
  let ultimo = 0;
  let pendiente = false;
  const pintar = (/** @type {boolean} */ siempre) => {
    const medido = Math.floor(nodo.clientWidth || 0);
    const ancho = medido > 0 ? medido : ANCHO_SIN_MEDIDA;
    if (siempre || ancho !== ultimo) {
      ultimo = ancho;
      nodo.replaceChildren(dibujar(ancho));
    }
  };
  pintar(true);
  if (typeof ResizeObserver === 'function') {
    const observador = new ResizeObserver(() => {
      if (!pendiente) {
        pendiente = true;
        requestAnimationFrame(() => {
          pendiente = false;
          pintar(false);
        });
      }
    });
    observador.observe(nodo);
    signal?.addEventListener('abort', () => observador.disconnect(), { once: true });
  }
  alCambiarIdioma(() => pintar(true), signal ? { signal } : {});
  return { nodo, redibujar: () => pintar(true) };
}

// ---------- Ejes ----------

/** Las marcas de una escala, de 0 al máximo. @param {Escala} escala @returns {number[]} */
export function marcasDe({ maximo, paso }) {
  return Array.from({ length: Math.round(maximo / paso) + 1 }, (_, i) => i * paso);
}

/**
 * La rejilla vertical y el eje de abajo de un gráfico horizontal: cada marca con su número.
 * @param {SVGElement} svg
 * @param {{ x: (valor: number) => number, escala: Escala, arriba: number, abajo: number, unidad: string,
 *   saltar: boolean }} eje `abajo`, donde acaba la rejilla; los números van debajo; `saltar`, rotular una de cada dos
 */
function rejillaVertical(svg, { x, escala, arriba, abajo, unidad, saltar }) {
  const marcas = marcasDe(escala);
  // Con las marcas muy juntas (un gráfico estrecho), se rotula una de cada dos: los números no se pisan.
  const juntas = x(escala.paso) - x(0) < MARCAS_JUNTAS;
  marcas.forEach((marca, i) => {
    svg.append(
      s('line', { x1: d(x(marca)), x2: d(x(marca)), y1: arriba, y2: abajo, class: i ? 'rejilla' : 'eje-cero' }),
    );
    const ultima = marcas.length - 1;
    // Se rotulan las pares y la última; si la última es impar, la anterior a ella no, para que no se peguen.
    const sinRotulo = i < ultima && (i % 2 === 1 || (i === ultima - 1 && ultima % 2 === 1));
    if ((saltar || juntas) && sinRotulo) {
      return;
    }
    const rotulo = i === marcas.length - 1 && unidad ? `${numeroEscrito(marca, 0)}${unidad}` : numeroEscrito(marca, 0);
    svg.append(
      s('text', { x: d(x(marca)), y: abajo + MEDIDAS.ejes.debajo, 'text-anchor': 'middle', class: 'eje' }, rotulo),
    );
  });
}

// ---------- 1. Barras de comparación ----------

/**
 * La columna de los nombres: lo que ocupa el más largo (partido en dos líneas si no cabe, y con su detalle, a la letra
 * de los ejes), entre su mínimo y su fracción del ancho.
 * @param {string[][]} lineas @param {string[]} detalles @param {number} ancho @returns {number}
 */
function columnaDeNombres(lineas, detalles, ancho) {
  const m = MEDIDAS.barras;
  const mayor = Math.max(
    0,
    ...lineas.flat().map((linea) => anchoDe(linea)),
    ...detalles.map((detalle) => anchoDe(detalle, LETRA.eje)),
  );
  return Math.min(ancho * m.nombres, Math.max(m.nombresMinimo, mayor + m.hueco));
}

/**
 * El nombre de una fila: su texto en una o dos líneas y, si lo tiene, su detalle debajo, más tenue.
 * @param {SVGElement} svg @param {{ lineas: string[], detalle: string, papel: Papel | 'meta', y: number }} nombre
 *   `y`, el centro de la fila
 */
function nombreDeFila(svg, { lineas, detalle, papel, y }) {
  const todas = [...lineas, ...(detalle ? [detalle] : [])];
  const salto = LETRA.texto + 2;
  const primera = y + MEDIA_LETRA - ((todas.length - 1) * salto) / 2;
  lineas.forEach((linea, i) => {
    svg.append(s('text', { x: 0, y: d(primera + i * salto), class: claseDeTexto(papel) }, linea));
  });
  if (detalle) {
    svg.append(s('text', { x: 0, y: d(primera + lineas.length * salto), class: 'eje' }, detalle));
  }
}

/**
 * La raya discontinua de la media de la UE, de arriba abajo, con su rótulo encima.
 * @param {SVGElement} svg @param {{ x: number, arriba: number, abajo: number, rotulo: string, ancho: number }} raya
 */
function rayaDeReferencia(svg, { x, arriba, abajo, rotulo, ancho }) {
  const m = MEDIDAS.barras;
  svg.append(s('line', { x1: d(x), x2: d(x), y1: arriba - m.rayaSobre, y2: abajo, class: 'raya-ue' }));
  const cabe = x + anchoDe(rotulo) + m.hueco <= ancho;
  svg.append(
    s(
      'text',
      {
        x: d(cabe ? x + m.rotuloAparte : x - m.rotuloAparte),
        y: arriba - m.rotuloSobre,
        'text-anchor': cabe ? 'start' : 'end',
        class: 't-ue',
      },
      rotulo,
    ),
  );
}

/**
 * La disposición de unas barras a un ancho: los nombres partidos en una o dos líneas, sus detalles, lo que ocupa la
 * columna de los nombres y el alto de cada fila.
 * @param {FilaDeBarra[]} filas @param {number} ancho
 * @returns {{ lineas: string[][], detalles: string[], izquierda: number, fila: number }}
 */
function disposicionDeBarras(filas, ancho) {
  const m = MEDIDAS.barras;
  const nombres = filas.map(({ nombre }) => resolver(nombre));
  const maximoDelNombre = ancho * m.nombres - m.hueco;
  const lineas = nombres.map((nombre) => partir(nombre, maximoDelNombre));
  const detalles = filas.map(({ detalle }) => (detalle ? resolver(detalle) : ''));
  const izquierda = columnaDeNombres(lineas, detalles, ancho);
  const doble = lineas.some((linea, i) => linea.length + (detalles[i] ? 1 : 0) > 1);
  return { lineas, detalles, izquierda, fila: doble ? m.filaDoble : m.fila };
}

/**
 * Una fila de las barras: su nombre, la barra desde 0 y la cifra al final; si la cifra caería sobre la raya de la UE,
 * va justo después de ella.
 * @param {SVGElement} svg
 * @param {{ papel: Papel, valor: number, y: number, x: (valor: number) => number, xReferencia: number,
 *   lineas: string[], detalle: string, decimales: number, opinion: boolean }} fila `y`, el borde de arriba de la barra
 */
function filaDeBarra(svg, { papel, valor, y, x, xReferencia, lineas, detalle, decimales, opinion }) {
  const m = MEDIDAS.barras;
  const texto = numeroEscrito(valor, decimales);
  const xTexto = x(valor) + m.cifraAparte;
  const pisa = xTexto - m.holgura <= xReferencia && xReferencia <= xTexto + anchoDe(texto) + 2;
  nombreDeFila(svg, { lineas, detalle, papel, y: y + m.barra / 2 });
  const clase = opinion ? `barra c-${papel} b-opinion` : `barra c-${papel}`;
  svg.append(s('rect', { x: d(x(0)), y: d(y), width: d(Math.max(1, x(valor) - x(0))), height: m.barra, class: clase }));
  svg.append(
    s(
      'text',
      {
        x: d(pisa ? xReferencia + m.cifraAparte : xTexto),
        y: d(y + m.barra / 2 + MEDIA_LETRA),
        class: claseDeTexto(papel),
      },
      texto,
    ),
  );
}

/**
 * Barras horizontales de mayor a menor (el orden lo da quien llama), desde 0, con la cifra al final de cada barra y, si
 * se da, la media de la UE como raya discontinua de referencia, nunca como una barra más.
 * @param {Barras} barras @returns {(ancho: number) => SVGElement}
 */
export function barras({ filas, escala, referencia, opinion, decimales }) {
  return (ancho) => {
    const m = MEDIDAS.barras;
    const { lineas, detalles, izquierda, fila } = disposicionDeBarras(filas, ancho);
    const arriba = referencia ? m.arribaConReferencia : m.arriba;
    const abajo = arriba + filas.length * fila;
    const alto = abajo + m.abajo;
    const x = (/** @type {number} */ valor) =>
      izquierda + (Math.min(valor, escala.maximo) / escala.maximo) * (ancho - izquierda - m.cifra);
    const svg = lienzo(ancho, alto, opinion ? 'dg-barras-svg dg-opinion-svg' : 'dg-barras-svg');
    rejillaVertical(svg, {
      x,
      escala,
      arriba: arriba - m.rejillaSobre,
      abajo,
      unidad: ' %',
      saltar: ancho < m.estrecho && marcasDe(escala).length > MEDIDAS.ejes.marcasSinSaltar,
    });
    const xReferencia = referencia ? x(referencia.valor) : Number.NaN;
    filas.forEach(({ papel, valor }, i) => {
      const y = arriba + i * fila + (fila - m.barra) / 2;
      const [lineasDeFila, detalle] = [lineas[i] ?? [], detalles[i] ?? ''];
      filaDeBarra(svg, { papel, valor, y, x, xReferencia, lineas: lineasDeFila, detalle, decimales, opinion });
    });
    if (referencia) {
      rayaDeReferencia(svg, { x: x(referencia.valor), arriba, abajo, rotulo: resolver(referencia.rotulo), ancho });
    }
    return svg;
  };
}

// ---------- 2. Líneas de evolución ----------

/**
 * La rejilla horizontal, el eje de porcentajes a la izquierda y los años abajo, en su sitio proporcional.
 * @param {SVGElement} svg
 * @param {{ x: (anio: number) => number, y: (valor: number) => number, desde: number, hasta: number, escala: Escala,
 *   fin: number, estrecho: boolean }} ejes
 */
function ejesDeLaEvolucion(svg, { x, y, desde, hasta, escala, fin, estrecho }) {
  const m = MEDIDAS.lineas;
  for (const [i, marca] of marcasDe(escala).entries()) {
    svg.append(
      s('line', { x1: m.izquierda, x2: d(fin), y1: d(y(marca)), y2: d(y(marca)), class: i ? 'rejilla' : 'eje-cero' }),
    );
    svg.append(
      s(
        'text',
        { x: m.izquierda - m.numerosDelEje, y: d(y(marca) + MEDIA_LETRA), 'text-anchor': 'end', class: 'eje' },
        numeroEscrito(marca, 0),
      ),
    );
  }
  svg.append(
    s(
      'text',
      {
        x: m.izquierda - m.numerosDelEje,
        y: d(y(escala.maximo) - m.sobre - m.unidadSobre),
        'text-anchor': 'end',
        class: 'eje',
      },
      '%',
    ),
  );
  const saltar = estrecho && hasta - desde > m.aniosSinSaltar;
  for (let anio = desde; anio <= hasta; anio++) {
    svg.append(s('line', { x1: d(x(anio)), x2: d(x(anio)), y1: d(y(0)), y2: d(y(0) + m.marca), class: 'eje-cero' }));
    if (!saltar || (anio - desde) % 2 === 0 || anio === hasta) {
      svg.append(
        s(
          'text',
          { x: d(x(anio)), y: d(y(0) + m.marca + MEDIDAS.ejes.debajo), 'text-anchor': 'middle', class: 'eje' },
          String(anio),
        ),
      );
    }
  }
}

/**
 * Los tramos de una serie: los que tocan un año no comparable no se dibujan.
 * @param {SVGElement} svg @param {{ puntos: Punto[], ocultos: number[], clase: string }} serie
 * @param {{ x: (anio: number) => number, y: (valor: number) => number }} ejes
 */
function tramosDeSerie(svg, { puntos, ocultos, clase }, { x, y }) {
  puntos.slice(1).forEach((punto, i) => {
    const anterior = /** @type {Punto} */ (puntos[i]);
    if (seUnen(anterior, punto, ocultos)) {
      svg.append(
        s('line', {
          x1: d(x(anterior.anio)),
          y1: d(y(anterior.valor)),
          x2: d(x(punto.anio)),
          y2: d(y(punto.valor)),
          class: clase,
        }),
      );
    }
  });
}

/**
 * La cifra de un año de una serie rotulada. Encima, a la izquierda del punto (la línea suele subir hacia la derecha);
 * debajo, a su derecha. La del primer año va siempre a la derecha, para no pisar el eje.
 * @param {SVGElement} svg @param {{ papel: Papel, anio: number, valor: number, primero: boolean }} cifra
 * @param {{ x: (anio: number) => number, y: (valor: number) => number,
 *   lado: (papel: Papel, anio: number, valor: number) => 'encima' | 'debajo' }} ejes
 */
function cifraDeUnAnio(svg, { papel, anio, valor, primero }, { x, y, lado }) {
  const m = MEDIDAS.lineas;
  const encima = lado(papel, anio, valor) === 'encima';
  const aLaIzquierda = encima && !primero;
  svg.append(
    s(
      'text',
      {
        x: d(x(anio) + (aLaIzquierda ? -m.lado : m.lado)),
        y: d(y(valor) + (encima ? -m.sobre : m.bajo)),
        'text-anchor': aLaIzquierda ? 'end' : 'start',
        class: claseDeTexto(papel),
      },
      numeroEscrito(valor),
    ),
  );
}

/**
 * Una serie: sus tramos (los que tocan un año no comparable no se dibujan), sus puntos y, en Cataluña y la UE, la
 * cifra de cada año menos el último, que va en la etiqueta del final.
 * @param {SVGElement} svg @param {Serie} serie
 * @param {{ x: (anio: number) => number, y: (valor: number) => number,
 *   lado: (papel: Papel, anio: number, valor: number) => 'encima' | 'debajo' }} ejes
 */
function dibujarSerie(svg, { papel, puntos, ocultos, protagonista }, ejes) {
  const { x, y } = ejes;
  const m = MEDIDAS.lineas;
  const clase = protagonista ? `linea c-${papel} l-protagonista` : `linea c-${papel}`;
  tramosDeSerie(svg, { puntos, ocultos, clase }, ejes);
  // Cataluña y la UE llevan su cifra en cada año; una serie protagonista (la de un país en «El mundo»), también.
  const rotulada = papel === 'cat' || papel === 'ue' || protagonista;
  for (const [i, { anio, valor }] of puntos.entries()) {
    svg.append(
      s('circle', { cx: d(x(anio)), cy: d(y(valor)), r: rotulada ? m.radio : m.radioOtro, class: `punto c-${papel}` }),
    );
    if (rotulada && i < puntos.length - 1) {
      cifraDeUnAnio(svg, { papel, anio, valor, primero: i === 0 }, ejes);
    }
  }
}

/**
 * Las etiquetas del final de cada línea (nombre y última cifra), separadas al menos MEDIDAS.lineas.separacion px y
 * dentro del dibujo. @param {SVGElement} svg @param {{ papel: Papel, y: number, x: number, texto: string }[]} finales
 * @param {{ arriba: number, abajo: number }} limites
 */
function etiquetasFinales(svg, finales, { arriba, abajo }) {
  const m = MEDIDAS.lineas;
  const orden = finales.map((final) => ({ ...final, yDelPunto: final.y })).sort((a, b) => a.y - b.y);
  orden.forEach((final, i) => {
    const anterior = orden[i - 1];
    final.y = Math.max(final.y, anterior ? anterior.y + m.separacion : arriba);
  });
  const exceso = (orden.at(-1)?.y ?? 0) - abajo;
  for (const final of orden) {
    final.y -= Math.max(0, exceso);
    // Al apartar un rótulo de su punto, una guía conserva la relación con la línea incluso si otras se cruzan.
    if (Math.abs(final.y - final.yDelPunto) > 2) {
      svg.append(
        s('line', {
          x1: d(final.x + m.radioOtro),
          y1: d(final.yDelPunto),
          x2: d(final.x + m.lado),
          y2: d(final.y),
          class: `conector c-${final.papel}`,
        }),
      );
    }
    svg.append(
      s(
        'text',
        { x: d(final.x + m.lado + 2), y: d(final.y + MEDIA_LETRA), class: claseDeTexto(final.papel) },
        final.texto,
      ),
    );
  }
}

/**
 * Líneas de evolución con el eje de años proporcional (un año sin encuesta deja su hueco). Cataluña, gruesa y con su
 * cifra en cada año; la UE, discontinua y con la suya; España, gris medio; el resto, gris fino. Cada línea lleva al
 * final su nombre y su última cifra, sin leyenda.
 * @param {Lineas} lineas @returns {(ancho: number) => SVGElement}
 */
export function lineas({ series, desde, hasta, escala }) {
  return (ancho) => {
    const m = MEDIDAS.lineas;
    const estrecho = ancho < m.estrecho;
    const derecha = estrecho ? m.derechaEstrecho : m.derecha;
    const alto = estrecho ? m.altoEstrecho : m.alto;
    const tramo = Math.max(1, hasta - desde);
    const x = (/** @type {number} */ anio) =>
      m.izquierda + m.margenDelEje + ((anio - desde) / tramo) * (ancho - m.izquierda - m.margenDelEje - derecha);
    const y = (/** @type {number} */ valor) =>
      m.arriba + (1 - Math.min(valor, escala.maximo) / escala.maximo) * (alto - m.arriba - m.abajo);
    const svg = lienzo(ancho, alto, 'dg-lineas-svg');
    ejesDeLaEvolucion(svg, { x, y, desde, hasta, escala, fin: ancho - derecha + m.rejillaDespues, estrecho });
    const lado = ladoDeLasCifras(series);
    const ordenadas = [...series].sort((a, b) => ORDEN_DE_DIBUJO[a.papel] - ORDEN_DE_DIBUJO[b.papel]);
    /** @type {{ papel: Papel, y: number, x: number, texto: string }[]} */
    const finales = [];
    for (const serie of ordenadas) {
      dibujarSerie(svg, serie, { x, y, lado });
      const ultimo = serie.puntos.at(-1);
      if (ultimo) {
        finales.push({
          papel: serie.papel,
          y: y(ultimo.valor),
          x: x(ultimo.anio),
          texto: `${resolver(serie.nombre)} ${numeroEscrito(ultimo.valor)}`,
        });
      }
    }
    etiquetasFinales(svg, finales, { arriba: m.arriba - 10, abajo: alto - m.abajo });
    return svg;
  };
}

// ---------- 3. Pesas ----------

/**
 * Las dos cifras de una fila de pesas, fuera de las marcas: la menor a la izquierda y la mayor a la derecha. Si la menor
 * no cabe entre los nombres y su marca, va encima de la marca.
 * @param {SVGElement} svg @param {{ xa: number, xb: number, a: number, b: number, yc: number, izquierda: number }} fila
 */
function cifrasDePesas(svg, { xa, xb, a, b, yc, izquierda }) {
  const m = MEDIDAS.pesas;
  const [xMenor, menor, xMayor, mayor] = a <= b ? [xa, a, xb, b] : [xb, b, xa, a];
  const textoMenor = numeroEscrito(menor);
  if (xMenor - m.rotulo - anchoDe(textoMenor, LETRA.eje) < izquierda) {
    svg.append(s('text', { x: d(xMenor), y: d(yc - m.rotulo - 2), 'text-anchor': 'middle', class: 'eje' }, textoMenor));
  } else {
    svg.append(
      s('text', { x: d(xMenor - m.rotulo), y: d(yc + MEDIA_LETRA), 'text-anchor': 'end', class: 'eje' }, textoMenor),
    );
  }
  svg.append(s('text', { x: d(xMayor + m.rotulo), y: d(yc + MEDIA_LETRA), class: 'eje' }, numeroEscrito(mayor)));
}

/**
 * Una fila de pesas: el nombre, la unión, el círculo, el cuadrado, las dos cifras y la diferencia a la derecha.
 * @param {SVGElement} svg @param {FilaDePesas} fila
 * @param {{ x: (valor: number) => number, yc: number, izquierda: number, ancho: number, estrecho: boolean }} sitio
 */
function filaDePesas(svg, { papel, nombre, detalle, a, b, diferencia }, { x, yc, izquierda, ancho, estrecho }) {
  const m = MEDIDAS.pesas;
  const lineas = partir(resolver(nombre), izquierda - MEDIDAS.barras.hueco);
  nombreDeFila(svg, { lineas, detalle: detalle ? resolver(detalle) : '', papel, y: yc });
  const [xa, xb] = [x(a), x(b)];
  svg.append(s('line', { x1: d(xa), x2: d(xb), y1: yc, y2: yc, class: 'union' }));
  svg.append(s('circle', { cx: d(xa), cy: yc, r: m.radio, class: `punto c-${papel}` }));
  svg.append(
    s('rect', {
      x: d(xb - m.cuadrado / 2),
      y: d(yc - m.cuadrado / 2),
      width: m.cuadrado,
      height: m.cuadrado,
      class: `punto c-${papel}`,
    }),
  );
  cifrasDePesas(svg, { xa, xb, a, b, yc, izquierda });
  const texto = estrecho ? diferencia.corta : resolver(diferencia.larga);
  svg.append(s('text', { x: ancho, y: d(yc + MEDIA_LETRA), 'text-anchor': 'end', class: claseDeTexto(papel) }, texto));
}

/**
 * La leyenda de las pesas, una sola vez, encima de la primera fila y al principio del eje: «● Mujeres  ■ Hombres»; y la
 * cabecera de la columna de la diferencia, a la derecha.
 * @param {SVGElement} svg @param {{ x: number, nombres: [string, string], cabecera: string, ancho: number, y: number }}
 *   leyenda
 */
function leyendaDePesas(svg, { x, nombres, cabecera, ancho, y }) {
  const circulo = `● ${nombres[0]}`;
  svg.append(s('text', { x: d(x), y, class: 'leyenda' }, circulo));
  svg.append(
    s(
      'text',
      { x: d(x + anchoDe(circulo, LETRA.eje) + MEDIDAS.pesas.leyenda), y, class: 'leyenda' },
      `■ ${nombres[1]}`,
    ),
  );
  svg.append(s('text', { x: ancho, y, 'text-anchor': 'end', class: 'eje' }, cabecera));
}

/**
 * Pesas: dos cifras por fila, un círculo y un cuadrado unidos por una línea, y su diferencia a la derecha. El color dice
 * el territorio y la forma, la serie: el color no cambia nunca de significado. La UE va abajo, tras una raya.
 * @param {Pesas} pesas @returns {(ancho: number) => SVGElement}
 */
export function pesas({ filas, nombres, cabecera, escala }) {
  return (ancho) => {
    const m = MEDIDAS.pesas;
    const estrecho = ancho < m.estrecho;
    const izquierda = estrecho ? m.nombresEstrecho : m.nombres;
    const derecha = estrecho ? m.diferenciaEstrecho : m.diferencia;
    const primeraUe = filas.findIndex(({ papel }) => papel === 'ue');
    const separador = primeraUe > 0 ? m.separador : 0;
    const abajo = m.arriba + filas.length * m.fila + separador;
    const x = (/** @type {number} */ valor) =>
      izquierda + (Math.min(valor, escala.maximo) / escala.maximo) * (ancho - izquierda - derecha - m.holgura);
    const svg = lienzo(ancho, abajo + m.abajo, 'dg-pesas-svg');
    rejillaVertical(svg, {
      x,
      escala,
      arriba: m.arriba - m.rejillaSobre,
      abajo,
      unidad: ' %',
      saltar: estrecho && marcasDe(escala).length > MEDIDAS.ejes.marcasSinSaltar,
    });
    filas.forEach((fila, i) => {
      const desplazado = primeraUe > 0 && i >= primeraUe ? separador : 0;
      if (desplazado && i === primeraUe) {
        const ys = m.arriba + i * m.fila + separador / 2;
        svg.append(s('line', { x1: 0, x2: ancho, y1: ys, y2: ys, class: 'separador' }));
      }
      filaDePesas(svg, fila, { x, yc: m.arriba + i * m.fila + m.fila / 2 + desplazado, izquierda, ancho, estrecho });
    });
    const etiquetas = /** @type {[string, string]} */ (nombres.map((nombre) => resolver(nombre)));
    const titulo = resolver(cabecera[estrecho ? 1 : 0]);
    leyendaDePesas(svg, { x: x(0), nombres: etiquetas, cabecera: titulo, ancho, y: m.arriba - m.leyenda });
    return svg;
  };
}

// ---------- 4. La comparación mínima de «Lo esencial» ----------

/**
 * Tres o cuatro filas finas a la misma escala: el nombre a la izquierda, la cifra a la derecha y la barra debajo.
 * @param {{ filas: FilaMinima[], maximo: number }} mini @returns {(ancho: number) => SVGElement}
 */
export function mini({ filas, maximo }) {
  return (ancho) => {
    const m = MEDIDAS.mini;
    const svg = lienzo(ancho, filas.length * m.fila, 'dg-mini-svg');
    filas.forEach(({ papel, nombre, valor, texto }, i) => {
      const y = i * m.fila;
      const clase = papel === 'meta' ? 't-dato' : claseDeTexto(papel);
      svg.append(s('text', { x: 0, y: y + m.texto, class: clase }, resolver(nombre)));
      svg.append(s('text', { x: ancho, y: y + m.texto, 'text-anchor': 'end', class: clase }, texto));
      svg.append(s('rect', { x: 0, y: y + m.cifra, width: ancho, height: m.barra, class: 'pista' }));
      const largo = Math.max(1, (Math.min(valor, maximo) / maximo) * ancho);
      svg.append(s('rect', { x: 0, y: y + m.cifra, width: d(largo), height: m.barra, class: `barra c-${papel}` }));
    });
    return svg;
  };
}

// ---------- 5. Barra hacia una meta ----------

/**
 * El rótulo de la meta, debajo de su raya, sin salirse por los lados.
 * @param {SVGElement} svg @param {{ x: number, y: number, texto: string, ancho: number }} rotulo
 */
function rotuloDeMeta(svg, { x, y, texto, ancho }) {
  const mitad = anchoDe(texto) / 2;
  let ancla = 'middle';
  if (x + mitad > ancho) {
    ancla = 'end';
  } else if (x - mitad < 0) {
    ancla = 'start';
  }
  svg.append(s('text', { x: d(x), y, 'text-anchor': ancla, class: 't-dato' }, texto));
}

/**
 * El eje de la barra hacia una meta: una raya fina en cada marca y su número debajo (en un gráfico estrecho, una de
 * cada dos; la primera y la última, siempre).
 * @param {SVGElement} svg
 * @param {{ x: (cifra: number) => number, escala: Escala, ancho: number, eje: (marca: number) => string }} medidas
 */
function ejeDeMeta(svg, { x, escala, ancho, eje }) {
  const m = MEDIDAS.meta;
  const marcas = marcasDe(escala);
  for (const [i, marca] of marcas.entries()) {
    svg.append(
      s('line', {
        x1: d(x(marca)),
        x2: d(x(marca)),
        y1: m.barra - m.marcaSobresale,
        y2: m.barra + m.grueso + m.marcaSobresale,
        class: i ? 'rejilla' : 'eje-cero',
      }),
    );
    const saltar = ancho < m.estrecho && i % 2 === 1 && i < marcas.length - 1;
    if (!saltar) {
      const ancla = (i === 0 && 'start') || (i === marcas.length - 1 && 'end') || 'middle';
      svg.append(
        s('text', { x: d(x(marca)), y: m.alto - m.ejeSobreElBorde, 'text-anchor': ancla, class: 'eje' }, eje(marca)),
      );
    }
  }
}

/**
 * Las rayas finas, dentro de la barra, de las mediciones anteriores.
 * @param {SVGElement} svg @param {number[]} anteriores @param {(cifra: number) => number} x
 */
function marcasAnteriores(svg, anteriores, x) {
  const m = MEDIDAS.meta;
  for (const anterior of anteriores) {
    svg.append(
      s('line', {
        x1: d(x(anterior)),
        x2: d(x(anterior)),
        y1: m.barra + m.anteriorDentro,
        y2: m.barra + m.grueso - m.anteriorDentro,
        class: 'marca-anterior',
      }),
    );
  }
}

/**
 * Una barra hacia una meta con su escala real (0–100 % o 0–25 millones): la cifra de hoy encima de la barra, rayas
 * finas dentro para las mediciones anteriores y la meta como una raya vertical rotulada debajo. Nunca se dibuja una
 * proyección. @param {HaciaMeta} meta @returns {(ancho: number) => SVGElement}
 */
export function haciaMeta({ valor, meta, escala, anteriores, rotuloValor, rotuloMeta, eje }) {
  return (ancho) => {
    const m = MEDIDAS.meta;
    const fin = ancho - m.holgura;
    const x = (/** @type {number} */ cifra) => (Math.min(cifra, escala.maximo) / escala.maximo) * fin;
    const svg = lienzo(ancho, m.alto, 'dg-meta-svg');
    ejeDeMeta(svg, { x, escala, ancho, eje });
    svg.append(s('rect', { x: 0, y: m.barra, width: d(x(escala.maximo)), height: m.grueso, class: 'pista' }));
    svg.append(s('rect', { x: 0, y: m.barra, width: d(Math.max(1, x(valor))), height: m.grueso, class: 'barra c-ue' }));
    marcasAnteriores(svg, anteriores, x);
    const xm = x(meta);
    svg.append(
      s('line', { x1: d(xm), x2: d(xm), y1: m.barra - m.raya, y2: m.barra + m.grueso + m.raya, class: 'raya-meta' }),
    );
    rotuloDeMeta(svg, { x: xm, y: m.barra + m.grueso + m.bajo, texto: resolver(rotuloMeta), ancho });
    const textoValor = resolver(rotuloValor);
    const cabeDelante = x(valor) - anchoDe(textoValor) >= 0;
    svg.append(
      s(
        'text',
        { x: d(x(valor)), y: m.barra - m.sobre, 'text-anchor': cabeDelante ? 'end' : 'start', class: 't-ue' },
        textoValor,
      ),
    );
    return svg;
  };
}

// ---------- 6. Tabla gráfica año a año ----------

/** La barra pequeña de una celda. @param {Papel} papel @param {number} valor @param {number} maximo */
function barraDeCelda(papel, valor, maximo) {
  const svg = s('svg', {
    class: 'dg-svg dg-ta-barra',
    width: '100%',
    height: 6,
    'aria-hidden': 'true',
    focusable: 'false',
  });
  const largo = `${Math.round((Math.min(valor, maximo) / maximo) * DECIMAS_DE_PORCENTAJE) / 10}%`;
  svg.append(
    s('rect', { width: '100%', height: 6, class: 'pista' }),
    s('rect', { width: largo, height: 6, class: `barra c-${papel}` }),
  );
  return svg;
}

/**
 * La tabla gráfica año a año: una fila por territorio y, en cada año, la cifra y una barra pequeña a la misma escala.
 * Un año sin dato comparable lleva «—», con su porqué para los lectores de pantalla.
 * El marco se desplaza a lo ancho si no cabe: se enfoca con el teclado y se anuncia con la leyenda (`id`).
 * @param {{ id: string, leyenda: Parte, territorio: Parte, filas: FilaAnual[], anios: number[], maximo: number,
 *   sinDato: Parte }} tabla
 * @returns {HTMLElement}
 */
export function tablaAnual({ id, leyenda, territorio, filas, anios, maximo, sinDato }) {
  const cabecera = crear(
    'tr',
    {},
    conTexto('th', { scope: 'col' }, territorio),
    ...anios.map((anio) => crear('th', { scope: 'col', textContent: String(anio) })),
  );
  const cuerpo = filas.map(({ papel, nombre, valores }) =>
    crear(
      'tr',
      { className: `dg-ta-${papel}` },
      conTexto('th', { scope: 'row' }, nombre),
      ...anios.map((anio) => {
        const valor = valores.get(anio);
        return valor === undefined
          ? crear(
              'td',
              {},
              crear('span', { className: 'dg-ta-sin', textContent: '—' }),
              conTexto('span', { className: 'solo-lectores' }, sinDato),
            )
          : crear(
              'td',
              {},
              crear('span', { className: 'dg-ta-valor', textContent: numeroEscrito(valor) }),
              barraDeCelda(papel, valor, maximo),
            );
      }),
    ),
  );
  const tabla = crear(
    'table',
    { className: 'dg-tabla dg-tabla-anual' },
    conTexto('caption', { id }, leyenda),
    crear('thead', {}, cabecera),
    crear('tbody', {}, ...cuerpo),
  );
  const marco = crear('div', { className: 'dg-tabla-marco' }, tabla);
  marco.setAttribute('tabindex', '0');
  marco.setAttribute('role', 'region');
  marco.setAttribute('aria-labelledby', id);
  return marco;
}
