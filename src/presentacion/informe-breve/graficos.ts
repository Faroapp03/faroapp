// Los gráficos del informe breve, en SVG plano (sin sombras ni animaciones): el semicírculo de la exposición, la
// cuadrícula de 100, la barra única, las columnas de contratos por año y los iconos de las tarjetas. Los colores son los
// azules de Faro (estilos/informe-breve.css usa los mismos). Todo texto pasa por escapar().

import { numero } from '../../comun/formato.ts';
import { escapar } from '../html.ts';

/** Azules de Faro y tintas del informe breve. */
const COLOR = Object.freeze({
  azulProfundo: '#184f95',
  azul: '#2f74c8',
  azulSuave: '#86b6ef',
  azulClaro: '#e3edf7',
  laton: '#9a7a43',
  tinta: '#17212a',
  tenue: '#4f5b66',
  papel: '#fdfcf8',
});

/** Medidas del semicírculo de la exposición (viewBox 200 × 112). */
const SEMICIRCULO = Object.freeze({
  centro: 100,
  radio: 80,
  grosor: 24,
  marcaDentro: 58,
  marcaFuera: 102,
  grosorMarca: 4,
  yCifra: 92,
  yEscala: 108,
  tamanoCifra: 34,
  tamanoEscala: 11,
  ancho: 200,
  alto: 112,
  mediaVuelta: 180,
});
/** Medidas de la cuadrícula de 100 cuadrados (25 columnas × 4 filas). */
const CUADRICULA = Object.freeze({ columnas: 25, filas: 4, celda: 10, hueco: 2.4, esquina: 1.2 });
/** Medidas de las columnas de contratos por año. */
const COLUMNAS = Object.freeze({
  ancho: 50,
  hueco: 20,
  x0: 4,
  esquina: 3,
  base: 168,
  alto: 112,
  holgura: 1.06,
  separacionCifra: 6,
  yEtiqueta: 18,
  tamanoFuerte: 14,
  tamanoNormal: 12,
  tamanoEtiqueta: 12.5,
  pesoFuerte: 700,
  pesoNormal: 400,
  sobreElMaximo: 26,
  patillaCorchete: 7,
  bajoElCorchete: 22,
  sobreLaLinea: 4,
  tamanoRotulo: 13,
  margenDerecho: 4,
  pie: 26,
  trazoDiscontinuo: 1.2,
  sangria: 0.6,
});
/**
 * El rótulo de la caída al imprimir: su letra en papel (informe-breve.css, `.ib-columnas-v2 text`, en unidades del
 * SVG) y una cota por arriba del ancho medio de sus caracteres en negrita de Space Grotesk, en em. Con eso, medido en
 * el más largo de sus idiomas, el rótulo se centra sobre el corchete sin salir del gráfico, y el gráfico es igual en
 * todos los idiomas.
 */
export const ROTULO_IMPRESO = Object.freeze({ tamano: 14.5, anchoPorLetra: 0.62 });
const POR_CIEN = 100;

/** Las coordenadas de un punto del semicírculo, a `angulo` grados y `radio` del centro. */
function punto(angulo: number, radio: number): [number, number] {
  const radianes = (angulo * Math.PI) / SEMICIRCULO.mediaVuelta;
  return [SEMICIRCULO.centro + radio * Math.cos(radianes), SEMICIRCULO.centro - radio * Math.sin(radianes)];
}

/** Dos decimales para las coordenadas. */
const coordenada = (valor: number): string => valor.toFixed(2);

/** El ángulo de un valor de 0 a 100 en el semicírculo: 0 a la izquierda, 100 a la derecha. */
const anguloDe = (valor: number): number => SEMICIRCULO.mediaVuelta * (1 - valor / POR_CIEN);

/** Un arco del semicírculo entre dos valores de 0 a 100. */
function arco(desde: number, hasta: number, color: string): string {
  const [x0, y0] = punto(anguloDe(desde), SEMICIRCULO.radio);
  const [x1, y1] = punto(anguloDe(hasta), SEMICIRCULO.radio);
  const { radio, grosor } = SEMICIRCULO;
  return `<path d="M${coordenada(x0)} ${coordenada(y0)} A${radio} ${radio} 0 0 1 ${coordenada(x1)} ${coordenada(y1)}" fill="none" stroke="${color}" stroke-width="${grosor}"/>`;
}

/**
 * El semicírculo de la exposición, en el tono neutro azul: lleno hasta el mínimo, la banda del margen entre modelos en
 * azul suave y la marca de la cifra en latón.
 *
 * @param valor - La exposición, de 0 a 100.
 * @param margen - El mínimo y el máximo de los modelos, de 0 a 100.
 * @param rotulo - El nombre accesible («62 de 100, con un margen de 60 a 65»).
 * @param escala - Lo que va bajo la cifra («de 100»).
 * @returns El SVG.
 */
export function semicirculo(
  valor: number,
  [minimo, maximo]: readonly [number, number],
  rotulo: string,
  escala: string,
): string {
  const [x1, y1] = punto(anguloDe(valor), SEMICIRCULO.marcaDentro);
  const [x2, y2] = punto(anguloDe(valor), SEMICIRCULO.marcaFuera);
  const { ancho, alto, yCifra, yEscala, tamanoCifra, tamanoEscala, centro } = SEMICIRCULO;
  return `<svg class="ib-indicador" viewBox="0 0 ${ancho} ${alto}" role="img" aria-label="${escapar(rotulo)}" font-family="Sora, sans-serif">${arco(0, POR_CIEN, COLOR.azulClaro)}${arco(0, minimo, COLOR.azulProfundo)}${arco(minimo, maximo, COLOR.azulSuave)}<line x1="${coordenada(x1)}" y1="${coordenada(y1)}" x2="${coordenada(x2)}" y2="${coordenada(y2)}" stroke="${COLOR.laton}" stroke-width="${SEMICIRCULO.grosorMarca}"/><text x="${centro}" y="${yCifra}" text-anchor="middle" font-size="${tamanoCifra}" fill="${COLOR.tinta}">${valor}</text><text x="${centro}" y="${yEscala}" text-anchor="middle" font-size="${tamanoEscala}" fill="${COLOR.tenue}" font-family="Space Grotesk, sans-serif">${escapar(escala)}</text></svg>`;
}

/**
 * 100 cuadrados que se llenan columna a columna, de izquierda a derecha: se lee como una barra hecha de unidades.
 *
 * @param llenas - Cuántos de 100 van llenos.
 * @param rotulo - El nombre accesible.
 * @returns El SVG.
 */
export function cuadricula(llenas: number, rotulo: string): string {
  const { columnas, filas, celda, hueco, esquina } = CUADRICULA;
  const cuadros = Array.from({ length: columnas * filas }, (_, i) => {
    const columna = Math.floor(i / filas);
    const fila = i % filas;
    const color = i < llenas ? COLOR.azulProfundo : COLOR.azulClaro;
    return `<rect x="${(columna * (celda + hueco)).toFixed(1)}" y="${(fila * (celda + hueco)).toFixed(1)}" width="${celda}" height="${celda}" rx="${esquina}" fill="${color}"/>`;
  });
  const ancho = columnas * celda + (columnas - 1) * hueco;
  const alto = filas * celda + (filas - 1) * hueco;
  return `<svg class="ib-reticula" viewBox="0 0 ${ancho.toFixed(1)} ${alto.toFixed(1)}" role="img" aria-label="${escapar(rotulo)}">${cuadros.join('')}</svg>`;
}

/**
 * Una barra única de 0 a 100 en el tono neutro. El ancho llega como data-ancho (sin estilos en línea).
 *
 * @param valor - De 0 a 100.
 * @param rotulo - El nombre accesible.
 * @returns El HTML.
 */
export function medidor(valor: number, rotulo: string): string {
  return `<div class="ib-medidor" role="img" aria-label="${escapar(rotulo)}"><span class="ib-medidor-pista"><span class="ib-medidor-relleno" data-ancho="${valor}"></span></span><span class="ib-medidor-escala"><span>0</span><span>100</span></span></div>`;
}

/** Una columna con la punta redondeada; las reconstruidas, en azul claro con borde discontinuo. */
function columna(x: number, altura: number, publicada: boolean): string {
  const { base, ancho, esquina, sangria, trazoDiscontinuo } = COLUMNAS;
  const izquierda = publicada ? x : x + sangria;
  const alto = publicada ? altura : altura - sangria;
  const y = base - alto;
  const d = `M${izquierda},${base} L${izquierda},${(y + esquina).toFixed(1)} Q${izquierda},${y.toFixed(1)} ${izquierda + esquina},${y.toFixed(1)} L${izquierda + ancho - esquina},${y.toFixed(1)} Q${izquierda + ancho},${y.toFixed(1)} ${izquierda + ancho},${(y + esquina).toFixed(1)} L${izquierda + ancho},${base} Z`;
  const trazo = publicada
    ? ''
    : ` stroke="${COLOR.azulProfundo}" stroke-width="${trazoDiscontinuo}" stroke-dasharray="3.5 2.5"`;
  return `<path d="${d}" fill="${publicada ? COLOR.azulProfundo : COLOR.azulClaro}"${trazo}/>`;
}

/** La cifra sobre una columna y su etiqueta debajo; la del máximo y la del último año, en negrita. */
function rotulosDeColumna(
  x: number,
  altura: number,
  { valor, etiqueta, fuerte }: { valor: number; etiqueta: string; fuerte: boolean },
): string {
  const { base, ancho, separacionCifra, yEtiqueta } = COLUMNAS;
  const tamano = fuerte ? COLUMNAS.tamanoFuerte : COLUMNAS.tamanoNormal;
  const peso = fuerte ? COLUMNAS.pesoFuerte : COLUMNAS.pesoNormal;
  const color = fuerte ? COLOR.tinta : COLOR.tenue;
  const centro = x + ancho / 2;
  return `<text x="${centro}" y="${(base - altura - separacionCifra).toFixed(1)}" text-anchor="middle" font-size="${tamano}" font-weight="${peso}" fill="${color}">${numero(valor)}</text><text x="${centro}" y="${base + yEtiqueta}" text-anchor="middle" font-size="${COLUMNAS.tamanoEtiqueta}" fill="${COLOR.tenue}">${escapar(etiqueta)}</text>`;
}

/** El ancho del rótulo de la caída al imprimir, por arriba (ROTULO_IMPRESO). */
function anchoDelRotulo(letras: number): number {
  return Math.ceil(letras * ROTULO_IMPRESO.anchoPorLetra * ROTULO_IMPRESO.tamano);
}

/**
 * El corchete del máximo al último año, por encima de todas las cifras, con la caída escrita encima de su línea: no
 * tapa la línea ni sus patillas, que dicen qué años compara. El rótulo se centra sobre el corchete y, si no cabe, se
 * desplaza lo justo para no salir del gráfico (de 0 a `total`).
 */
function corchete(
  desde: number,
  hasta: number,
  alturas: { maximo: number; ultimo: number },
  rotulo: { texto: string; letras: number; total: number },
): string {
  const { base, sobreElMaximo, patillaCorchete, bajoElCorchete, sobreLaLinea } = COLUMNAS;
  const y = base - alturas.maximo - sobreElMaximo;
  const mitad = anchoDelRotulo(rotulo.letras) / 2;
  const centro = Math.min(Math.max((desde + hasta) / 2, mitad), rotulo.total - mitad);
  return `<path d="M${desde},${(y + patillaCorchete).toFixed(1)} L${desde},${y.toFixed(1)} L${hasta},${y.toFixed(1)} L${hasta},${(base - alturas.ultimo - bajoElCorchete).toFixed(1)}" fill="none" stroke="${COLOR.tinta}" stroke-width="1.1"/><text x="${centro}" y="${(y - sobreLaLinea).toFixed(1)}" text-anchor="middle" font-size="${COLUMNAS.tamanoRotulo}" font-weight="${COLUMNAS.pesoFuerte}" fill="${COLOR.tinta}">${escapar(rotulo.texto)}</text>`;
}

/** Lo que dice el gráfico de columnas: sus valores y, si el último no es el máximo, la caída desde el máximo. */
export interface DatosDeColumnas {
  etiquetas: readonly string[];
  valores: readonly number[];
  publicado: readonly boolean[];
  /** El rótulo del corchete («−23 % desde el máximo»), o null si no se dibuja. */
  caida: string | null;
  /** Los caracteres de ese rótulo en el idioma en que es más largo: su ancho al imprimir (ROTULO_IMPRESO). */
  letrasDeLaCaida: number;
  rotulo: string;
}

/**
 * Contratos por año: una columna por año con su cifra encima; las reconstruidas por Faro, con borde discontinuo. Si
 * el máximo no es el último año, un corchete del máximo al último dice cuánto ha caído.
 *
 * @param datos - Los valores, las etiquetas, qué años están publicados y el rótulo del corchete.
 * @returns El SVG.
 */
export function columnasPorAnio(datos: DatosDeColumnas): string {
  const { ancho, hueco, x0, alto, holgura, base, margenDerecho, pie } = COLUMNAS;
  const maximo = Math.max(...datos.valores);
  const escala = maximo * holgura;
  const pico = datos.valores.indexOf(maximo);
  const ultimo = datos.valores.length - 1;
  const alturas = datos.valores.map((valor) => (alto * valor) / escala);
  const conCorchete = datos.caida !== null && pico !== ultimo;
  const letras = conCorchete ? Math.max(datos.letrasDeLaCaida, [...(datos.caida ?? '')].length) : 0;
  // Con pocos años, el gráfico se ensancha hasta el ancho del rótulo y las columnas quedan centradas: el rótulo cabe.
  const columnas = x0 + datos.valores.length * (ancho + hueco) - hueco + margenDerecho;
  const total = Math.max(columnas, anchoDelRotulo(letras));
  const sangria = (total - columnas) / 2;
  const xDe = (i: number): number => sangria + x0 + i * (ancho + hueco);
  const partes = datos.valores.map((valor, i) => {
    const altura = alturas[i] ?? 0;
    const fuerte = i === pico || i === ultimo;
    return `${columna(xDe(i), altura, datos.publicado[i] ?? false)}${rotulosDeColumna(xDe(i), altura, { valor, etiqueta: datos.etiquetas[i] ?? '', fuerte })}`;
  });
  if (conCorchete && datos.caida !== null) {
    const medida = { maximo: alturas[pico] ?? 0, ultimo: alturas[ultimo] ?? 0 };
    partes.push(
      corchete(xDe(pico) + ancho / 2, xDe(ultimo) + ancho / 2, medida, { texto: datos.caida, letras, total }),
    );
  }
  partes.push(`<line x1="0" y1="${base}" x2="${total}" y2="${base}" stroke="${COLOR.tinta}" stroke-width="1"/>`);
  return `<svg class="ib-columnas-v2" viewBox="0 0 ${total} ${base + pie}" role="img" aria-label="${escapar(datos.rotulo)}" font-family="Space Grotesk, sans-serif">${partes.join('')}</svg>`;
}

/** Los trazos de los iconos de las tarjetas del mercado. */
const ICONOS = Object.freeze({
  ofertas:
    '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M9 8V6.5A1.5 1.5 0 0 1 10.5 5h3A1.5 1.5 0 0 1 15 6.5V8"/><path d="M3 13h18"/>',
  empleo:
    '<circle cx="9" cy="8" r="3"/><path d="M3 19.5c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.3"/><path d="M15.6 13.4c2.9.4 5.4 2.7 5.4 6.1"/>',
  contratacion: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="M9 12h7M9 16h4"/>',
  salario:
    '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.6a4.6 4.6 0 1 0 0 6.8"/><path d="M7.2 10.9h6.3M7.2 13.3h6.3"/>',
});

/** El nombre de un icono de tarjeta. */
export type NombreDeIcono = keyof typeof ICONOS;

/**
 * El icono de una tarjeta del mercado, decorativo (la tarjeta ya tiene su título).
 *
 * @param nombre - El icono.
 * @returns El SVG.
 */
export function icono(nombre: NombreDeIcono): string {
  return `<svg class="ib-icono" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONOS[nombre]}</svg>`;
}
