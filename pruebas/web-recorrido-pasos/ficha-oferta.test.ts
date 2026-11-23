import './dom.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { OpcionPlan } from '../../web/scripts/recorrido/plan-formacion/contrato.js';
import {
  duracionPublicada,
  etiquetaDeIdioma,
  lineasDeLaFicha,
  nombreDeIdioma,
  resumenDeOferta,
} from '../../web/scripts/recorrido/plan-formacion/ficha-oferta.js';
import { opcionSintetica } from './opcion-sintetica.ts';

const opcion = (conocidos: Parameters<typeof opcionSintetica>[2]) =>
  opcionSintetica('ia', 'a', conocidos) as unknown as OpcionPlan;

// Horas publicadas y lo que la ficha debe decir de ellas.
const CUATRO_HORAS = 4;
const HORA_Y_MEDIA = 1.5;
const MEDIA_HORA = 0.5;
const TRES_CUARTOS = 0.75;
const CUARTO_DE_HORA = 0.25;
const MENOS_DE_UN_MINUTO = 1e-7;
const DURACIONES: [number | null, 'es' | 'ca', string | null][] = [
  [CUATRO_HORAS, 'es', '4 h publicadas'],
  [HORA_Y_MEDIA, 'ca', '1,5 h publicades'],
  [MEDIA_HORA, 'es', '30 min publicados'],
  [TRES_CUARTOS, 'ca', '45 min publicats'],
  [0, 'es', null],
  [MENOS_DE_UN_MINUTO, 'es', null],
  [null, 'es', null],
];

test('la duración nunca dice «0 h»: menos de una hora va en minutos y sin dato o cero, «No consta»', () => {
  for (const [horas, idioma, esperado] of DURACIONES) {
    assert.equal(duracionPublicada(horas, idioma), esperado, `${horas} h`);
  }
  for (const horas of [0, MENOS_DE_UN_MINUTO]) {
    const lineas = lineasDeLaFicha(opcion({ horas_publicadas: horas }), 'es').join(' ');
    assert.match(lineas, /Duración: No consta/u);
    assert.doesNotMatch(lineas, /0 h|0 min/u);
  }
  assert.match(resumenDeOferta(opcion({ horas_publicadas: CUARTO_DE_HORA }), 'es'), /Duración: 15 min publicados/u);
});

test('Faro dice «castellano» y «castellà», nunca «español» ni «espanyol», con su tabla y sin Intl', () => {
  assert.equal(nombreDeIdioma('es', 'es'), 'castellano');
  assert.equal(nombreDeIdioma('es', 'ca'), 'castellà');
  assert.equal(nombreDeIdioma('ca', 'es'), 'catalán');
  assert.equal(nombreDeIdioma('ca', 'ca'), 'català');
  assert.equal(nombreDeIdioma('en', 'es'), 'inglés');
  assert.equal(nombreDeIdioma('en', 'ca'), 'anglès');
  assert.equal(nombreDeIdioma('fr', 'es'), 'francés');
  assert.equal(nombreDeIdioma('de', 'ca'), 'alemany');
  assert.equal(nombreDeIdioma('xx', 'es'), 'XX');
  assert.equal(nombreDeIdioma('Multilingüe', 'es'), 'Multilingüe');
  for (const declarado of ['Español', 'es', 'Castellà']) {
    const linea = lineasDeLaFicha(opcion({ idiomas_declarados: [declarado] }), 'es').join(' ');
    assert.match(linea, /Idioma: castellano/u, 'Dentro de una frase, el idioma va en minúscula');
    assert.doesNotMatch(linea, /[Ee]spañol/u);
    const enCatalan = lineasDeLaFicha(opcion({ idiomas_declarados: [declarado] }), 'ca').join(' ');
    assert.match(enCatalan, /Idioma: castellà/u);
    assert.doesNotMatch(enCatalan, /[Ee]spanyol/u);
  }
  assert.equal(etiquetaDeIdioma(opcion({ idiomas_declarados: ['Español'] }), 'ca'), 'Curs en castellà');
});
