// Las fronteras del globo (recursos/globo/fronteras.json, que escribe herramientas/web/traer-globo.ts desde Natural
// Earth): su lectura comprobada y lo que se calcula con ellas. Lógica pura, sin DOM ni WebGL:
// - qué territorio hay en unas coordenadas (la pulsación en el globo), por la regla par-impar sobre todos sus anillos;
// - el mapa de territorios: una imagen del tamaño que pide quien lo llama (MAPA de globo.js), en la proyección de la
//   textura, con el número de cada territorio en cada píxel, que el dibujo usa para teñir el elegido sin triangular
//   ningún polígono;
// - las líneas de las fronteras sobre la esfera, partidas en tramos de un grado como mucho para que sigan la curva.
// Un territorio puede estar dentro de otro (Cataluña, dentro de España): se busca antes que su país y, en el mapa, solo
// ocupa píxeles de su país, para que su costa no se salga de la del país.

import { esListaDe, esNumero, esObjeto, esOpcional, esTexto } from '../json.js';
import { GRADOS, puntoDeLaEsfera } from './esfera.js';

/** La versión del formato que se lee. */
const VERSION = '1';
/** Un código de territorio: ISO 3166-1 alfa-3 o NUTS 2 (ES51). */
const CODIGO = /^[A-Z0-9]{3,4}$/;
/** El mapa de territorios: un byte por píxel, así que caben 255 territorios (el 0 es «ninguno»). */
const MAXIMO_DE_TERRITORIOS = 255;
/**
 * Lo más largo que puede ser un tramo de frontera dibujado, en grados: más largo, la cuerda se hundiría en la esfera.
 */
export const TRAMO_MAXIMO_GRADOS = 1;
/** Las fronteras se dibujan un poco por encima de la superficie (radio 1), para que la esfera no las tape. */
export const ALTURA_DE_LAS_FRONTERAS = 1.0015;
/** Lo que se suma a un índice de píxel para llegar a su centro. */
const CENTRO_DEL_PIXEL = 0.5;
/** Los números de un punto de un anillo: x e y. */
const NUMEROS_POR_PUNTO = 2;
/** Los puntos mínimos de un anillo cerrado: un triángulo. */
const PUNTOS_MINIMOS_DEL_ANILLO = 3;
/**
 * Una longitud o latitud en el borde del mapa: los cortes que Natural Earth hace en el antimeridiano y en el polo sur.
 */
const BORDE_DEL_MAPA = Object.freeze({ longitud: 179.99, latitud: -89.99 });

/**
 * Un territorio del mapa: su código, su centro, el código del territorio que lo contiene (o null), sus anillos (cada
 * uno, longitud y latitud alternas, en grados) y la caja que los encierra.
 * @typedef {Object} TerritorioDelMapa
 * @property {string} codigo
 * @property {import('./esfera.js').Coordenadas} centro
 * @property {string | null} dentroDe
 * @property {Float64Array[]} anillos
 * @property {{ oeste: number, este: number, sur: number, norte: number }} caja
 */
/**
 * Las fronteras leídas: los territorios, primero los que están dentro de otro.
 * @typedef {{ territorios: TerritorioDelMapa[] }} Fronteras
 */

/** Las fronteras no tienen la forma de fronteras.json: otro archivo, otra versión o un archivo cortado. */
export class FronterasInvalidas extends Error {
  /** @override */
  name = 'FronterasInvalidas';
}

/** Un número entero. @param {unknown} valor @returns {valor is number} */
function esEntero(valor) {
  return Number.isInteger(valor);
}

/** La guarda de una lista de enteros, construida una vez. */
const ES_LISTA_DE_ENTEROS = esListaDe(esEntero);

/**
 * Un anillo de fronteras.json: enteros alternos (x, y), el primer punto entero y los demás como diferencias.
 * @param {unknown} valor @returns {valor is number[]}
 */
function esAnilloCodificado(valor) {
  return (
    ES_LISTA_DE_ENTEROS(valor) &&
    valor.length >= PUNTOS_MINIMOS_DEL_ANILLO * NUMEROS_POR_PUNTO &&
    valor.length % NUMEROS_POR_PUNTO === 0
  );
}

/** La guarda de una lista de anillos codificados, construida una vez. */
const ES_LISTA_DE_ANILLOS = esListaDe(esAnilloCodificado);

/**
 * Un territorio de fronteras.json, sin descodificar todavía.
 * @param {unknown} valor
 * @returns {valor is { codigo: string, centro: number[], dentro_de?: string, anillos: number[][] }}
 */
function esTerritorioCodificado(valor) {
  return (
    esObjeto(valor) &&
    esTexto(valor.codigo) &&
    CODIGO.test(valor.codigo) &&
    esListaDe(esNumero)(valor.centro) &&
    valor.centro.length === 2 &&
    esOpcional(esTexto)(valor.dentro_de) &&
    ES_LISTA_DE_ANILLOS(valor.anillos) &&
    valor.anillos.length > 0
  );
}

/**
 * Un anillo descodificado a grados: longitud y latitud alternas; el primer punto es absoluto y los demás, diferencias.
 * Los `?? 0` de esta lógica solo satisfacen la lectura estricta de índices (`noUncheckedIndexedAccess`): los índices
 * están dentro del anillo.
 * @param {number[]} codificado
 * @param {number} escala Las unidades enteras por grado.
 * @returns {Float64Array}
 */
function descodificar(codificado, escala) {
  const anillo = new Float64Array(codificado.length);
  let [longitud, latitud] = [0, 0];
  for (let i = 0; i < codificado.length; i += NUMEROS_POR_PUNTO) {
    longitud += codificado[i] ?? 0;
    latitud += codificado[i + 1] ?? 0;
    anillo[i] = longitud / escala;
    anillo[i + 1] = latitud / escala;
  }
  return anillo;
}

/**
 * La caja que encierra unos anillos descodificados.
 * @param {readonly Float64Array[]} anillos
 * @returns {TerritorioDelMapa['caja']}
 */
function cajaDe(anillos) {
  const { mediaVuelta, polo } = GRADOS;
  /** @type {TerritorioDelMapa['caja']} */
  const caja = { oeste: mediaVuelta, este: -mediaVuelta, sur: polo, norte: -polo };
  for (const anillo of anillos) {
    for (let i = 0; i < anillo.length; i += NUMEROS_POR_PUNTO) {
      const longitud = anillo[i] ?? 0;
      const latitud = anillo[i + 1] ?? 0;
      caja.oeste = Math.min(caja.oeste, longitud);
      caja.este = Math.max(caja.este, longitud);
      caja.sur = Math.min(caja.sur, latitud);
      caja.norte = Math.max(caja.norte, latitud);
    }
  }
  return caja;
}

/**
 * Un territorio de fronteras.json listo para usar. Recibe uno ya comprobado (esTerritorioCodificado).
 * @param {{ codigo: string, centro: number[], dentro_de?: string, anillos: number[][] }} territorio
 * @param {number} escala @returns {TerritorioDelMapa}
 */
function territorioDelMapa({ codigo, centro, dentro_de: dentroDe, anillos }, escala) {
  const descodificados = anillos.map((anillo) => descodificar(anillo, escala));
  const [longitud = 0, latitud = 0] = centro;
  return {
    codigo,
    centro: { longitud, latitud },
    dentroDe: dentroDe ?? null,
    anillos: descodificados,
    caja: cajaDe(descodificados),
  };
}

/**
 * Si un punto está dentro de un anillo, por la regla par-impar: cuenta los lados que cruza una semirrecta hacia el
 * este.
 * @param {Float64Array} anillo
 * @param {number} longitud
 * @param {number} latitud
 * @returns {boolean}
 */
function dentroDelAnillo(anillo, longitud, latitud) {
  let dentro = false;
  for (let i = 0, j = anillo.length - NUMEROS_POR_PUNTO; i < anillo.length; j = i, i += NUMEROS_POR_PUNTO) {
    const xi = anillo[i] ?? 0;
    const yi = anillo[i + 1] ?? 0;
    const xj = anillo[j] ?? 0;
    const yj = anillo[j + 1] ?? 0;
    if (yi > latitud !== yj > latitud && longitud < ((xj - xi) * (latitud - yi)) / (yj - yi) + xi) {
      dentro = !dentro;
    }
  }
  return dentro;
}

/**
 * Las longitudes en que una latitud cruza los anillos de un territorio, ordenadas: entre cada par está dentro.
 * @param {TerritorioDelMapa} territorio @param {number} latitud @returns {number[]}
 */
function crucesEn(territorio, latitud) {
  const cruces = [];
  for (const anillo of territorio.anillos) {
    for (let i = 0, j = anillo.length - NUMEROS_POR_PUNTO; i < anillo.length; j = i, i += NUMEROS_POR_PUNTO) {
      const xi = anillo[i] ?? 0;
      const yi = anillo[i + 1] ?? 0;
      const xj = anillo[j] ?? 0;
      const yj = anillo[j + 1] ?? 0;
      if (yi > latitud !== yj > latitud) {
        cruces.push(((xj - xi) * (latitud - yi)) / (yj - yi) + xi);
      }
    }
  }
  return cruces.sort((a, b) => a - b);
}

/**
 * Pinta en una fila del mapa el tramo entre dos longitudes: los píxeles cuyo centro cae dentro.
 * @param {{ pixeles: Uint8Array, ancho: number }} mapa
 * @param {number} fila
 * @param {{ oeste: number, este: number }} tramo Las longitudes de entrada y de salida, en grados.
 * @param {{ indice: number, soloSobre: number }} pintura
 */
function pintarTramo({ pixeles, ancho }, fila, { oeste, este }, { indice, soloSobre }) {
  const desde = Math.max(0, Math.ceil(((oeste + GRADOS.mediaVuelta) / GRADOS.vuelta) * ancho - CENTRO_DEL_PIXEL));
  const hasta = Math.min(
    ancho - 1,
    Math.floor(((este + GRADOS.mediaVuelta) / GRADOS.vuelta) * ancho - CENTRO_DEL_PIXEL),
  );
  for (let columna = desde; columna <= hasta; columna += 1) {
    const pixel = fila * ancho + columna;
    if (!soloSobre || pixeles[pixel] === soloSobre) {
      pixeles[pixel] = indice;
    }
  }
}

/**
 * Pinta un territorio en el mapa, fila a fila: cada par de cruces es un tramo de dentro. Si está dentro de otro, solo
 * ocupa los píxeles que ya son de ese otro (`soloSobre`).
 * @param {{ pixeles: Uint8Array, ancho: number, alto: number }} mapa @param {TerritorioDelMapa} territorio
 * @param {{ indice: number, soloSobre: number }} pintura su índice y el del territorio que lo contiene, o 0
 */
function pintarTerritorio(mapa, territorio, pintura) {
  const { polo, mediaVuelta } = GRADOS;
  const filaNorte = Math.max(0, Math.floor(((polo - territorio.caja.norte) / mediaVuelta) * mapa.alto));
  const filaSur = Math.min(mapa.alto - 1, Math.ceil(((polo - territorio.caja.sur) / mediaVuelta) * mapa.alto));
  for (let fila = filaNorte; fila <= filaSur; fila += 1) {
    const cruces = crucesEn(territorio, polo - ((fila + CENTRO_DEL_PIXEL) / mapa.alto) * mediaVuelta);
    // Cada par de cruces, entrada y salida, es un tramo de dentro.
    for (let par = 0; par + 1 < cruces.length; par += NUMEROS_POR_PUNTO) {
      pintarTramo(mapa, fila, { oeste: cruces[par] ?? 0, este: cruces[par + 1] ?? 0 }, pintura);
    }
  }
}

/**
 * Si un tramo es un corte del mapa y no una frontera: los dos extremos en el antimeridiano o en el polo sur.
 * @param {number[]} tramo [longitud, latitud, longitud, latitud]
 */
function esCorteDelMapa([x1 = 0, y1 = 0, x2 = 0, y2 = 0]) {
  return (
    (Math.abs(x1) >= BORDE_DEL_MAPA.longitud && Math.abs(x2) >= BORDE_DEL_MAPA.longitud && x1 === x2) ||
    (y1 <= BORDE_DEL_MAPA.latitud && y2 <= BORDE_DEL_MAPA.latitud)
  );
}

/**
 * Los extremos 3D de los tramos de un lado, cada uno de un grado como mucho, a la altura de las fronteras.
 * @param {number[]} lado [longitud, latitud, longitud, latitud] @param {number[]} salida donde se añaden
 */
function anadirTramos([x1 = 0, y1 = 0, x2 = 0, y2 = 0], salida) {
  const partes = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / TRAMO_MAXIMO_GRADOS));
  for (let parte = 0; parte < partes; parte += 1) {
    for (const fraccion of [parte / partes, (parte + 1) / partes]) {
      const punto = puntoDeLaEsfera(x1 + (x2 - x1) * fraccion, y1 + (y2 - y1) * fraccion);
      salida.push(...punto.map((coordenada) => coordenada * ALTURA_DE_LAS_FRONTERAS));
    }
  }
}

// ---------- Lo público ----------

/**
 * Si unas coordenadas están en la Tierra: longitud en [−180, 180] y latitud en [−90, 90], ambas finitas.
 * @param {number} longitud @param {number} latitud @returns {boolean}
 */
function enLaTierra(longitud, latitud) {
  return Math.abs(longitud) <= GRADOS.mediaVuelta && Math.abs(latitud) <= GRADOS.polo;
}

/**
 * Las fronteras de fronteras.json, comprobadas y descodificadas. Un territorio solo puede estar dentro de otro que no
 * esté dentro de ninguno (un nivel), porque el mapa pinta el de dentro sobre los píxeles de su padre; la escala es un
 * número finito positivo y cada centro y cada punto descodificado, coordenadas de la Tierra.
 * @param {unknown} valor @returns {Fronteras}
 * @throws {FronterasInvalidas} Si no tienen su forma, con lo que falla.
 */
export function leerFronteras(valor) {
  if (
    !esObjeto(valor) ||
    valor.version !== VERSION ||
    !esNumero(valor.escala) ||
    !Number.isFinite(valor.escala) ||
    valor.escala <= 0
  ) {
    throw new FronterasInvalidas(`se esperaba la versión ${VERSION} de fronteras.json con su escala`);
  }
  const { escala, territorios } = valor;
  if (!esListaDe(esTerritorioCodificado)(territorios) || territorios.length > MAXIMO_DE_TERRITORIOS) {
    throw new FronterasInvalidas(`fronteras.json: hasta ${MAXIMO_DE_TERRITORIOS} territorios con su forma`);
  }
  const leidos = territorios.map((territorio) => territorioDelMapa(territorio, escala));
  const codigos = new Set(leidos.map(({ codigo }) => codigo));
  if (codigos.size !== leidos.length) {
    throw new FronterasInvalidas('fronteras.json repite un código');
  }
  const perdido = leidos.find(({ dentroDe }) => dentroDe !== null && !codigos.has(dentroDe));
  if (perdido) {
    throw new FronterasInvalidas(`${perdido.codigo} está dentro de ${perdido.dentroDe}, que no existe`);
  }
  const padres = new Map(leidos.map(({ codigo, dentroDe }) => [codigo, dentroDe]));
  const anidado = leidos.find(({ dentroDe }) => dentroDe !== null && padres.get(dentroDe) !== null);
  if (anidado) {
    throw new FronterasInvalidas(`${anidado.codigo} está dentro de ${anidado.dentroDe}, que ya está dentro de otro`);
  }
  const fuera = leidos.find(
    ({ centro, caja }) =>
      !enLaTierra(centro.longitud, centro.latitud) ||
      !enLaTierra(caja.oeste, caja.sur) ||
      !enLaTierra(caja.este, caja.norte),
  );
  if (fuera) {
    throw new FronterasInvalidas(`${fuera.codigo} tiene coordenadas fuera de la Tierra`);
  }
  return { territorios: [...leidos.filter(({ dentroDe }) => dentroDe), ...leidos.filter(({ dentroDe }) => !dentroDe)] };
}

/**
 * El territorio en unas coordenadas, o null en el mar; uno que está dentro de otro gana a su país.
 * @param {Fronteras} fronteras @param {import('./esfera.js').Coordenadas} coordenadas
 * @returns {TerritorioDelMapa | null}
 */
export function territorioEn({ territorios }, { longitud, latitud }) {
  for (const territorio of territorios) {
    const { oeste, este, sur, norte } = territorio.caja;
    if (longitud < oeste || longitud > este || latitud < sur || latitud > norte) {
      continue;
    }
    const cruzados = territorio.anillos.filter((anillo) => dentroDelAnillo(anillo, longitud, latitud)).length;
    if (cruzados % 2 === 1) {
      return territorio;
    }
  }
  return null;
}

/**
 * El mapa de territorios en la proyección de la textura (longitud −180 a 180 de izquierda a derecha, latitud 90 a −90
 * de arriba abajo): el índice de cada territorio en cada píxel (1, 2…; 0, ninguno) y el índice de cada código.
 * @param {Fronteras} fronteras @param {number} ancho @param {number} alto
 * @returns {{ pixeles: Uint8Array<ArrayBuffer>, indices: Map<string, number> }}
 */
export function mapaDeTerritorios({ territorios }, ancho, alto) {
  const mapa = { pixeles: new Uint8Array(ancho * alto), ancho, alto };
  const indices = new Map(territorios.map(({ codigo }, i) => [codigo, i + 1]));
  const ordenados = [
    ...territorios.filter(({ dentroDe }) => !dentroDe),
    ...territorios.filter(({ dentroDe }) => dentroDe),
  ];
  for (const territorio of ordenados) {
    const soloSobre = territorio.dentroDe ? (indices.get(territorio.dentroDe) ?? 0) : 0;
    pintarTerritorio(mapa, territorio, { indice: indices.get(territorio.codigo) ?? 0, soloSobre });
  }
  return { pixeles: mapa.pixeles, indices };
}

/**
 * Los extremos 3D de todos los tramos de frontera, de tres en tres coordenadas y de dos en dos puntos (para dibujarlos
 * como líneas sueltas), sin los cortes del mapa.
 * @param {Fronteras} fronteras @returns {Float32Array<ArrayBuffer>}
 */
export function lineasDeFronteras({ territorios }) {
  /** @type {number[]} */
  const salida = [];
  for (const anillo of territorios.flatMap(({ anillos }) => anillos)) {
    for (let i = 0, j = anillo.length - 2; i < anillo.length; j = i, i += 2) {
      const lado = [anillo[j] ?? 0, anillo[j + 1] ?? 0, anillo[i] ?? 0, anillo[i + 1] ?? 0];
      if (!esCorteDelMapa(lado)) {
        anadirTramos(lado, salida);
      }
    }
  }
  return Float32Array.from(salida);
}
