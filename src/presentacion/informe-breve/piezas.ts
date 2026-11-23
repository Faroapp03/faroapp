// Piezas comunes del informe breve: los sellos de procedencia, la confianza en tres puntos, el estado de una tarjeta,
// la banda superior y el cierre de cada hoja (su último bloque y el pie), el desplegable de los apartados de consulta y
// la marca de Faro. Todo texto variable pasa por escapar().

import type { Idioma } from '../../comun/idioma.ts';
import type { Confianza, Direccion } from '../../dominio/tipos-informe-breve.ts';
import { escapar } from '../html.ts';
import { type ClaveBreve, texto as traducir } from './idioma.ts';
import { CONFIANZA, ESTADO } from './textos.ts';

/** De dónde sale un dato: la persona, un organismo oficial, un estudio, una norma, un cálculo de Faro o la IA. */
export type TipoDeSello = 'tu' | 'oficial' | 'estudio' | 'norma' | 'faro' | 'ia';

/** El nombre de cada sello. */
const NOMBRE_DEL_SELLO: Readonly<Record<TipoDeSello, ClaveBreve>> = Object.freeze({
  tu: 'Tú',
  oficial: 'Dato oficial',
  estudio: 'Estudio',
  norma: 'Norma',
  faro: 'Cálculo de Faro',
  ia: 'IA',
});

/** Puntos llenos de cada nivel de confianza. */
const PUNTOS: Readonly<Record<Confianza, number>> = Object.freeze({ alta: 3, media: 2, baja: 1 });
const TOTAL_DE_PUNTOS = 3;

/**
 * El sello de procedencia de un dato: su tipo en negrita y, si lo hay, de quién es.
 *
 * @param tipo - El tipo de sello.
 * @param texto - De quién es el dato («INE, 2025»), sin escapar.
 * @returns El HTML.
 */
export function sello(tipo: TipoDeSello, texto = '', idioma: Idioma = 'es'): string {
  const resto = texto ? ` ${escapar(texto)}` : '';
  return `<span class="sello" data-tipo="${tipo}"><b>${traducir(idioma, NOMBRE_DEL_SELLO[tipo])}</b>${resto}</span>`;
}

/**
 * La confianza de una conclusión: tres puntos, los llenos según el nivel, y su motivo.
 *
 * @param nivel - El nivel de confianza.
 * @param motivo - Por qué, sin escapar; vacío en la leyenda.
 * @param corta - Solo el nivel, sin «Confianza» delante (leyenda).
 * @returns El HTML.
 */
export function confianza(nivel: Confianza, motivo: string, corta = false, idioma: Idioma = 'es'): string {
  const puntos = Array.from(
    { length: TOTAL_DE_PUNTOS },
    (_, i) => `<i${i < PUNTOS[nivel] ? ' data-lleno' : ''}></i>`,
  ).join('');
  const nivelTraducido = traducir(idioma, CONFIANZA[nivel]);
  const rotulo = corta ? nivelTraducido : traducir(idioma, 'Confianza {0}', nivelTraducido);
  return `<span class="ib-conf" data-nivel="${nivel}"><span class="ib-puntos" aria-hidden="true">${puntos}</span><b>${rotulo}</b> <span>${escapar(motivo)}</span></span>`;
}

/**
 * El estado de una tarjeta del mercado: flecha y palabra («▼ Baja»), con su tono. `neutro`: un dato cuya subida o
 * bajada no es buena ni mala de por sí (las personas que buscan un empleo), en gris.
 *
 * @param direccion - Hacia dónde ha ido el dato.
 * @param neutro - Si va en gris, sin verde ni naranja.
 * @returns El HTML.
 */
export function estado(direccion: Direccion, neutro = false, idioma: Idioma = 'es', etiqueta?: string): string {
  const { flecha, palabra } = ESTADO[direccion];
  return `<span class="ib-estado" data-tono="${tonoDe(direccion, neutro)}"><span aria-hidden="true">${flecha}</span> ${etiqueta ?? traducir(idioma, palabra)}</span>`;
}

/**
 * El tono del borde de una tarjeta según su dirección: naranja si baja; verde si sube o se mantiene; gris sin dato o
 * si el dato es neutro.
 */
export function tonoDe(direccion: Direccion, neutro = false): string {
  return neutro ? 'neutro' : ESTADO[direccion].tono;
}

/**
 * La banda de arriba de cada hoja: uso personal y orientativo, y qué hoja es.
 *
 * @param hoja - El número de la hoja.
 * @param total - Cuántas hojas tiene el informe.
 * @returns El HTML.
 */
export function banda(hoja: number, total: number, idioma: Idioma = 'es', ejemplo = false): string {
  return `<div class="ib-banda"><span><b>${traducir(idioma, ejemplo ? 'Ejemplo ficticio' : 'Uso personal')}</b> · ${traducir(idioma, 'Orientativo')}</span><span>${traducir(idioma, 'Informe Faro')}<span class="ib-folio-hoja"> · ${traducir(idioma, 'Hoja {0} de {1}', hoja, total)}</span></span></div>`;
}

/**
 * El cierre de cada hoja: su último bloque, en un cuerpo propio, y el pie. En papel van juntos y no se parten
 * (informe-breve.css): si la hoja no cabe en su página, el último bloque pasa con el pie y ninguna página se queda con
 * el pie solo. En pantalla se ve como si el bloque siguiera en el cuerpo de la hoja.
 *
 * @param ultimo - El HTML del último bloque del cuerpo.
 * @param hoja - El número de la hoja.
 * @param total - Cuántas hojas tiene el informe.
 * @param texto - El texto del pie, ya escapado.
 * @returns El HTML.
 */
export function cierre(ultimo: string, hoja: number, total: number, texto: string): string {
  return `<div class="ib-final"><div class="ib-cuerpo">${ultimo}</div><footer class="hoja-pie"><span>${texto}</span><span class="hoja-pie-folio">${hoja} / ${total}</span></footer></div>`;
}

/**
 * El título y el contenido de un apartado de consulta, para dentro de su `<details>`. Los apartados de consulta son
 * solo de pantalla: en papel no salen (informe-breve.css).
 *
 * @param titulo - El título, ya escapado.
 * @param contenido - El HTML del contenido.
 * @returns El HTML.
 */
export function desplegableDeConsulta(titulo: string, contenido: string): string {
  return `<summary>${titulo}</summary><div class="contenido">${contenido}</div>`;
}

/** La marca de Faro: «FARO», con la luz del faro sobre la F. */
export const MARCA =
  '<span class="ib-marca"><span class="solo-lectores">FARO</span><span aria-hidden="true"><span class="ib-marca-f"><svg class="ib-marca-luz" viewBox="0 0 18 8" aria-hidden="true" focusable="false"><path d="M1 4h16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="square"/></svg>F</span>ARO</span></span>';
