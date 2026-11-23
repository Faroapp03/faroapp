// El mapa plano de reserva, para el navegador que no ofrece WebGL (un Safari sin aceleración, un móvil antiguo, un
// ordenador de empresa cerrado): la misma Tierra en proyección equirectangular, dibujada en un lienzo 2D, con la
// imagen de satélite (recursos/globo/tierra.jpg), el territorio elegido teñido de amarillo con el mismo mapa de
// territorios que el globo, las fronteras finas y las mismas chinchetas con bandera (luces.js). Hace lo mismo que el
// pintor del globo (pintor.js), con la misma vista: las flechas y el arrastre lo desplazan, + y − acercan y alejan, y
// solo se dibuja cuando un gesto lo pide, sin animación. Sin la imagen, el mar y la tierra van lisos; sin una
// bandera, su chincheta lleva la luz. Nítido en pantallas de doble densidad: dibuja en píxeles del dispositivo.

import { GRADOS } from './esfera.js';
import { ALTO_PX, AUMENTO_DEL_ELEGIDO, BANDERA, enOrdenDeDibujo, FORMA_DE_LA_MARCA, MARCA } from './luces.js';
import { SinWebgl } from './webgl.js';

/** Cuánto se tiñe de amarillo el territorio elegido y la opacidad de las fronteras: los mismos que en el globo. */
const TINTE_DEL_ELEGIDO = 0.5;
const OPACIDAD_DE_LAS_FRONTERAS = 0.55;
/** El grosor de las fronteras, en píxeles de CSS. */
const GROSOR_DE_LAS_FRONTERAS = 0.75;
/** Los bytes de un píxel RGBA y el máximo de un canal. */
const BYTES_DE_UN_PIXEL = 4;
const MAXIMO_DEL_CANAL = 255;
/** Las copias del mundo a cada lado, para que el mapa dé la vuelta sin cortes. */
const COPIAS = [-1, 0, 1];

/**
 * Píxeles de CSS por radián del mapa plano: con el acercamiento mínimo, el mundo llena el alto o el ancho del lienzo
 * (lo que dé más), sin franjas vacías arriba y abajo. Es el «radio» con que el globo pasa de píxeles a grados al
 * arrastrar, así que el mapa sigue al dedo. Lógica pura.
 * @param {number} ancho @param {number} alto @param {number} zoom @returns {number}
 */
export function radioPlano(ancho, alto, zoom) {
  return zoom * Math.max(ancho / (2 * Math.PI), alto / Math.PI);
}

/**
 * La vista del mapa plano con su latitud acotada para que el mapa cubra el alto del lienzo. Lógica pura.
 * @param {import('./esfera.js').Vista} vista @param {number} ancho @param {number} alto
 * @returns {import('./esfera.js').Vista}
 */
export function vistaPlana(vista, ancho, alto) {
  const mitad = (alto / 2 / radioPlano(ancho, alto, vista.zoom)) * (GRADOS.mediaVuelta / Math.PI);
  const limite = Math.max(0, GRADOS.polo - mitad);
  const latitud = Math.min(limite, Math.max(-limite, vista.centro.latitud));
  return { centro: { longitud: vista.centro.longitud, latitud }, zoom: vista.zoom };
}

/** Una diferencia de longitudes llevada a (−180, 180]. @param {number} grados */
function diferenciaDeLongitud(grados) {
  return grados - Math.ceil((grados - GRADOS.mediaVuelta) / GRADOS.vuelta) * GRADOS.vuelta;
}

/**
 * La proyección del mapa plano de un lienzo de `ancho` × `alto` píxeles de CSS, con la forma de la del globo
 * (esfera.js): un punto, en radios desde el centro (a la derecha y hacia arriba), y el punto bajo unas medidas. Lógica
 * pura.
 * @param {number} ancho @param {number} alto
 */
export function proyeccionPlana(ancho, alto) {
  const enRadianes = Math.PI / GRADOS.mediaVuelta;
  return {
    /** @param {import('./esfera.js').Vista} vista @param {number} longitud @param {number} latitud */
    proyectar(vista, longitud, latitud) {
      const { centro } = vistaPlana(vista, ancho, alto);
      const horizontal = diferenciaDeLongitud(longitud - centro.longitud) * enRadianes;
      return { horizontal, vertical: (latitud - centro.latitud) * enRadianes, visible: true };
    },
    /** @param {import('./esfera.js').Vista} vista @param {number} horizontal @param {number} vertical
     * @returns {import('./esfera.js').Coordenadas | null} */
    coordenadasEn(vista, horizontal, vertical) {
      const { centro } = vistaPlana(vista, ancho, alto);
      const latitud = centro.latitud + vertical / enRadianes;
      if (Math.abs(latitud) > GRADOS.polo) {
        return null;
      }
      return { longitud: diferenciaDeLongitud(centro.longitud + horizontal / enRadianes), latitud };
    },
  };
}

/**
 * El tinte del territorio elegido sobre el mapa de territorios, del tamaño de la imagen de la Tierra: amarillo a medias
 * donde están sus píxeles, transparente en el resto.
 * @param {{ mapa: Uint8Array, ancho: number, alto: number }} geometria @param {number[]} elegidos
 * @param {number[]} color de 0 a 1
 */
function tinteDe({ mapa, ancho, alto }, elegidos, color) {
  const lienzo = document.createElement('canvas');
  [lienzo.width, lienzo.height] = [ancho, alto];
  const dibujo = lienzo.getContext('2d');
  if (!dibujo || elegidos.length === 0) {
    return null;
  }
  const imagen = dibujo.createImageData(ancho, alto);
  const [rojo = 1, verde = 1, azul = 0] = color.map((canal) => Math.round(canal * MAXIMO_DEL_CANAL));
  const buscados = new Set(elegidos);
  for (let i = 0; i < mapa.length; i += 1) {
    if (buscados.has(mapa[i] ?? 0)) {
      imagen.data.set([rojo, verde, azul, Math.round(TINTE_DEL_ELEGIDO * MAXIMO_DEL_CANAL)], i * BYTES_DE_UN_PIXEL);
    }
  }
  dibujo.putImageData(imagen, 0, 0);
  return lienzo;
}

/** Un color de 0 a 1 como color de CSS. @param {number[]} color @param {number} [alfa] */
function css([rojo = 0, verde = 0, azul = 0], alfa = 1) {
  const canal = (/** @type {number} */ valor) => Math.round(valor * MAXIMO_DEL_CANAL);
  return `rgb(${canal(rojo)} ${canal(verde)} ${canal(azul)} / ${alfa})`;
}

/**
 * La Tierra: el mar, la imagen de satélite (si ha llegado) y el tinte del elegido, en sus tres copias.
 * @param {CanvasRenderingContext2D} dibujo @param {Plano} plano @param {Marco} marco
 */
function pintarTierra(dibujo, plano, { x, y, radio }) {
  const [anchoDelMundo, altoDelMundo] = [2 * Math.PI * radio, Math.PI * radio];
  dibujo.fillStyle = css(plano.colores.mar);
  for (const copia of COPIAS) {
    const izquierda = x + copia * anchoDelMundo;
    dibujo.fillRect(izquierda, y, anchoDelMundo, altoDelMundo);
    if (plano.tierra) {
      dibujo.drawImage(plano.tierra, izquierda, y, anchoDelMundo, altoDelMundo);
    }
    if (plano.tinte?.lienzo) {
      dibujo.drawImage(plano.tinte.lienzo, izquierda, y, anchoDelMundo, altoDelMundo);
    }
  }
}

/**
 * Las fronteras, en líneas finas, en sus tres copias; un tramo que cruza el antimeridiano no se dibuja.
 * @param {CanvasRenderingContext2D} dibujo @param {Plano} plano @param {Marco} marco
 */
function pintarFronteras(dibujo, plano, { x, y, radio, densidad }) {
  const enPixeles = (radio * Math.PI) / GRADOS.mediaVuelta;
  dibujo.beginPath();
  for (const copia of COPIAS) {
    const origen = x + copia * 2 * Math.PI * radio + GRADOS.mediaVuelta * enPixeles;
    for (const anillo of plano.anillos) {
      for (let i = 0; i < anillo.length; i += 2) {
        const [longitud = 0, latitud = 0] = [anillo[i], anillo[i + 1]];
        const salta = i === 0 || Math.abs(longitud - (anillo[i - 2] ?? 0)) > GRADOS.mediaVuelta;
        const [px, py] = [origen + longitud * enPixeles, y + (GRADOS.polo - latitud) * enPixeles];
        salta ? dibujo.moveTo(px, py) : dibujo.lineTo(px, py);
      }
    }
  }
  Object.assign(dibujo, {
    strokeStyle: css(plano.colores.frontera, OPACIDAD_DE_LAS_FRONTERAS),
    lineWidth: GROSOR_DE_LAS_FRONTERAS * densidad,
    lineJoin: 'round',
  });
  dibujo.stroke();
}

/**
 * Una chincheta con la punta en (`px`, `py`): el cuerpo y su filete y, en la cabeza, la bandera con su aro o, sin ella,
 * la luz. La del elegido es amarilla y más grande.
 * @param {CanvasRenderingContext2D} dibujo @param {Plano} plano
 * @param {{ codigo: string, px: number, py: number, elegida: boolean, densidad: number }} marca
 */
function pintarChincheta(dibujo, plano, { codigo, px, py, elegida, densidad }) {
  const forma = FORMA_DE_LA_MARCA;
  const lado = ALTO_PX * densidad * (elegida ? 1 + AUMENTO_DEL_ELEGIDO : 1);
  const [relleno, filete] = elegida
    ? [plano.colores.resalte, plano.colores.resalteFilete]
    : [plano.colores.marca, plano.colores.marcaFilete];
  dibujo.save();
  dibujo.translate(px - lado / 2, py - (forma.punta / forma.lado) * lado);
  dibujo.scale(lado / forma.lado, lado / forma.lado);
  const chincheta = new Path2D(MARCA);
  Object.assign(dibujo, {
    fillStyle: css(relleno),
    strokeStyle: css(filete),
    lineWidth: forma.filete,
    lineJoin: 'round',
  });
  dibujo.fill(chincheta);
  dibujo.stroke(chincheta);
  const bandera = plano.banderas.get(codigo);
  const circulo = new Path2D();
  circulo.arc(BANDERA.horizontal, BANDERA.vertical, bandera ? BANDERA.radio : forma.radioDeLaLuz, 0, 2 * Math.PI);
  if (bandera) {
    pintarBandera(dibujo, bandera, circulo);
    dibujo.lineWidth = Math.max(forma.aro, forma.lado / lado);
    dibujo.stroke(circulo);
  } else {
    dibujo.fillStyle = css(filete);
    dibujo.fill(circulo);
  }
  dibujo.restore();
}

/**
 * La bandera recortada en el círculo de la cabeza, de alto entero y centrada, como en el globo.
 * @param {CanvasRenderingContext2D} dibujo @param {HTMLImageElement} bandera @param {Path2D} circulo
 */
function pintarBandera(dibujo, bandera, circulo) {
  const alto = (2 * BANDERA.radio) / FORMA_DE_LA_MARCA.ajuste;
  const proporcion =
    bandera.naturalWidth > 0 && bandera.naturalHeight > 0 ? bandera.naturalWidth / bandera.naturalHeight : 1;
  const ancho = alto * Math.max(1, proporcion);
  dibujo.save();
  dibujo.clip(circulo);
  try {
    dibujo.drawImage(bandera, BANDERA.horizontal - ancho / 2, BANDERA.vertical - alto / 2, ancho, alto);
  } catch {
    // Una bandera que no se deja dibujar deja el círculo del color del cuerpo.
  } finally {
    dibujo.restore();
  }
}

/**
 * Lo que el mapa plano guarda entre fotogramas.
 * @typedef {Object} Plano
 * @property {HTMLCanvasElement} lienzo
 * @property {CanvasRenderingContext2D} dibujo
 * @property {import('./pintor.js').Colores} colores
 * @property {import('./pintor.js').Geometria} geometria
 * @property {Float64Array[]} anillos
 * @property {CanvasImageSource | null} tierra
 * @property {{ clave: string, lienzo: HTMLCanvasElement | null } | null} tinte
 * @property {import('./luces.js').Luz[]} luces
 * @property {string | null} elegido
 * @property {ReadonlyMap<string, HTMLImageElement>} banderas
 */
/**
 * Dónde cae el mundo en el lienzo, en píxeles del dispositivo: su esquina de arriba a la izquierda (la de la copia del
 * centro), su radio y los píxeles del dispositivo por píxel de CSS.
 * @typedef {{ x: number, y: number, radio: number, densidad: number }} Marco
 */

/**
 * Un fotograma del mapa plano.
 * @param {Plano} plano @param {import('./esfera.js').Vista} vista @param {number[]} elegidos
 */
function pintarPlano(plano, vista, elegidos) {
  const { lienzo, dibujo, colores } = plano;
  const densidad = lienzo.width / Math.max(1, lienzo.clientWidth);
  const [anchoCss, altoCss] = [lienzo.width / densidad, lienzo.height / densidad];
  const { centro, zoom } = vistaPlana(vista, anchoCss, altoCss);
  const radio = radioPlano(anchoCss, altoCss, zoom) * densidad;
  const enPixeles = (radio * Math.PI) / GRADOS.mediaVuelta;
  const marco = {
    x: lienzo.width / 2 - (centro.longitud + GRADOS.mediaVuelta) * enPixeles,
    y: lienzo.height / 2 - (GRADOS.polo - centro.latitud) * enPixeles,
    radio,
    densidad,
  };
  const clave = elegidos.join(',');
  if (plano.tinte?.clave !== clave) {
    plano.tinte = { clave, lienzo: tinteDe(plano.geometria, elegidos, colores.resalte) };
  }
  dibujo.setTransform(1, 0, 0, 1, 0, 0);
  dibujo.fillStyle = css(colores.espacio);
  dibujo.fillRect(0, 0, lienzo.width, lienzo.height);
  pintarTierra(dibujo, plano, marco);
  pintarFronteras(dibujo, plano, marco);
  for (const luz of enOrdenDeDibujo(plano.luces, plano.elegido)) {
    const px = lienzo.width / 2 + diferenciaDeLongitud(luz.longitud - centro.longitud) * enPixeles;
    const py = lienzo.height / 2 - (luz.latitud - centro.latitud) * enPixeles;
    pintarChincheta(dibujo, plano, { codigo: luz.codigo, px, py, elegida: luz.codigo === plano.elegido, densidad });
  }
}

// ---------- Lo público ----------

/**
 * El pintor del mapa plano, con la forma del del globo (pintor.js). Si el navegador tampoco ofrece un lienzo 2D,
 * lanza SinWebgl y el globo dice que no se puede dibujar.
 * @param {HTMLCanvasElement} lienzo @param {import('./pintor.js').Geometria} geometria
 * @param {import('./pintor.js').Colores} colores @param {import('./fronteras.js').Fronteras} fronteras
 * @returns {import('./pintor.js').Pintor}
 * @throws {SinWebgl} Si el lienzo no da un dibujo 2D.
 */
export function crearPintorPlano(lienzo, geometria, colores, fronteras) {
  const dibujo = lienzo.getContext('2d', { alpha: false });
  if (!dibujo) {
    throw new SinWebgl('el navegador no ofrece un lienzo 2D');
  }
  /** @type {Plano} */
  const plano = {
    lienzo,
    dibujo,
    colores,
    geometria,
    anillos: fronteras.territorios.flatMap(({ anillos }) => anillos),
    tierra: null,
    tinte: null,
    luces: [],
    elegido: null,
    banderas: new Map(),
  };
  return {
    ponerTierra(imagen) {
      plano.tierra = /** @type {CanvasImageSource} */ (imagen);
    },
    ponerLuces(luces, elegido) {
      Object.assign(plano, { luces, elegido });
    },
    ponerBanderas(imagenes) {
      plano.banderas = /** @type {ReadonlyMap<string, HTMLImageElement>} */ (imagenes);
      return imagenes.size > 0;
    },
    pintar: (vista, elegidos) => pintarPlano(plano, vista, elegidos),
    liberar() {
      Object.assign(plano, { tierra: null, tinte: null, banderas: new Map() });
    },
  };
}
