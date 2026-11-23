import assert from 'node:assert/strict';
import test from 'node:test';
import {
  comprobarLetraDelPdf,
  LETRA_DE_LECTORES_MAX_PT,
  LETRA_MINIMA_PT,
  letraPequenaDelPdf,
  type PaginaPdf,
} from './recorrido.ts';

// Lo medido en el PDF de Chromium antes de subir la escala del indicador al imprimir: «de 100» a 5,42 pt.
const DE_100_SIN_SUBIR_PT = 5.42;
// El texto para lectores de pantalla, impreso a propósito en 1 px (0,75 pt) y transparente.
const LECTORES_PT = 0.75;
const CUERPO_PT = 9;
const CENTESIMA = 0.01;
const CUERPO = 'Lo que hace una persona en este empleo cada semana';
// Los textos para lectores que se imprimen, como los recoge la batería de la página: sin espacios.
const LECTORES = ['Exposicióndeestaocupaciónalainteligenciaartificial', 'Contratosporaño'];

/** Una página con su texto por tamaño de letra efectivo. */
function pagina(...trozos: [number, string][]): PaginaPdf {
  const letra = new Map<number, number>();
  const textos = new Map<number, string>();
  for (const [puntos, texto] of trozos) {
    letra.set(puntos, (letra.get(puntos) ?? 0) + texto.replace(/\s+/gu, '').length);
    textos.set(puntos, [textos.get(puntos), texto].filter(Boolean).join(' '));
  }
  return { texto: trozos.map(([, texto]) => texto).join(' '), letra, textos };
}

test('la letra del PDF rechaza cualquier carácter visible por debajo de la mínima, aunque sean pocos', () => {
  const paginas = [pagina([CUERPO_PT, CUERPO], [DE_100_SIN_SUBIR_PT, 'de 100'])];
  assert.deepEqual(letraPequenaDelPdf(paginas, LECTORES), [
    `página 1: ${DE_100_SIN_SUBIR_PT} pt, 5 caracteres: «de 100»`,
  ]);
  assert.throws(() => comprobarLetraDelPdf(paginas, () => null, LECTORES), /baja de 6\.84 pt/u);
  // Justo por debajo de la mínima y justo por encima de la letra de lectores, aunque sea un texto para lectores.
  for (const puntos of [LETRA_MINIMA_PT - CENTESIMA, LETRA_DE_LECTORES_MAX_PT + CENTESIMA]) {
    assert.equal(
      letraPequenaDelPdf([pagina([CUERPO_PT, CUERPO], [puntos, 'Contratos por año'])], LECTORES).length,
      1,
      `${puntos} pt`,
    );
  }
});

test('hasta 1 pt la letra del PDF admite solo los textos para lectores de pantalla que se imprimen', () => {
  const conocidos = [
    pagina(
      [CUERPO_PT, CUERPO],
      [LECTORES_PT, 'Exposición de esta ocupación a la inteligencia artificial'],
      [LECTORES_PT, 'Contratos por año'],
      [LETRA_MINIMA_PT, 'de 100'],
      [DE_100_SIN_SUBIR_PT, ' '],
    ),
  ];
  assert.deepEqual(letraPequenaDelPdf(conocidos, LECTORES), []);
  comprobarLetraDelPdf(conocidos, () => null, LECTORES);
  // Un texto a 0,75 pt que no es de lectores falla con su texto, también junto a uno que sí lo es.
  const ajeno = [pagina([CUERPO_PT, CUERPO], [LECTORES_PT, 'Contratos por año'], [LECTORES_PT, 'de 100'])];
  assert.deepEqual(letraPequenaDelPdf(ajeno, LECTORES), [
    `página 1: ${LECTORES_PT} pt sin ser texto para lectores de pantalla: «de100»`,
  ]);
  assert.throws(() => comprobarLetraDelPdf(ajeno, () => null, LECTORES), /baja de 6\.84 pt/u);
  // Sin textos para lectores en la página, nada a 0,75 pt se admite.
  assert.equal(letraPequenaDelPdf(conocidos, []).length, 1);
});

test('hasta 1 pt admite el principio de un texto para lectores, recortado a su caja de 1 px, y nada más', () => {
  // Chromium pinta solo «Tu» del título de la página para lectores, «Tu recorrido con Faro».
  const titulo = 'TurecorridoconFaro';
  const recortado = [pagina([CUERPO_PT, CUERPO], [LECTORES_PT, 'Tu'], [LECTORES_PT, 'Contr'])];
  assert.deepEqual(letraPequenaDelPdf(recortado, [...LECTORES, titulo]), []);
  // Lo que no empieza como ningún texto para lectores no se admite, aunque vaya detrás de un principio que sí.
  const detras = [pagina([CUERPO_PT, CUERPO], [LECTORES_PT, 'Tu de 100'])];
  assert.deepEqual(letraPequenaDelPdf(detras, [...LECTORES, titulo]), [
    `página 1: ${LECTORES_PT} pt sin ser texto para lectores de pantalla: «de100»`,
  ]);
  // Ni el final de un texto para lectores: el navegador recorta por la derecha.
  assert.equal(letraPequenaDelPdf([pagina([CUERPO_PT, CUERPO], [LECTORES_PT, 'Faro'])], [titulo]).length, 1);
  const una = (texto: string) =>
    letraPequenaDelPdf([pagina([CUERPO_PT, CUERPO], [LECTORES_PT, texto])], [...LECTORES, titulo]);
  // Ni letras sueltas que empiezan textos para lectores distintos: un principio tiene al menos dos letras.
  assert.deepEqual(una('CET'), [`página 1: ${LECTORES_PT} pt sin ser texto para lectores de pantalla: «CET»`]);
  // Un texto para lectores de una sola letra se admite entero.
  assert.deepEqual(letraPequenaDelPdf([pagina([CUERPO_PT, CUERPO], [LECTORES_PT, '%'])], ['%']), []);
  // Cada texto para lectores explica una sola vez lo que se imprime.
  assert.deepEqual(una('Tu Tu'), [`página 1: ${LECTORES_PT} pt sin ser texto para lectores de pantalla: «Tu»`]);
  // Lo ajeno sale entero en el aviso, aunque empiece por una letra de un texto para lectores.
  assert.deepEqual(una('Tu Cuerpo'), [`página 1: ${LECTORES_PT} pt sin ser texto para lectores de pantalla: «Cuerpo»`]);
});

test('cada página lleva texto legible además de su folio, no solo texto para lectores', () => {
  const soloLectores = [pagina([CUERPO_PT, '1 / 2'], [LECTORES_PT, 'Contratos por año'])];
  assert.throws(() => comprobarLetraDelPdf(soloLectores, () => '1 / 2', LECTORES), /La página 1 lleva texto legible/u);
});
