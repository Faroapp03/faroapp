// Los mandos del globo (scripts/globo/panel.js, interaccion.js, esfera.js y estilos/globo.css), sin navegador: el
// botón central «Volver a mi país» vuelve a centrar el territorio elegido con el mismo acercamiento y las flechas y el
// zoom siguen moviendo el globo; cada mando tiene su nombre en castellano y en catalán; el cristal de los mandos sale
// de sus tokens, con botones de 44 px y sin sombras ni animaciones. Se ejecutan con npm test.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { TEXTOS_PAGINAS as CATALAN } from '../../web/idiomas/ca/paginas.js';
import { TEXTOS_PAGINAS as CASTELLANO } from '../../web/idiomas/es/paginas.js';
import { acercar, centrarEn, girar, PASO_DE_GIRO_GRADOS } from '../../web/scripts/globo/esfera.js';
import { leerFronteras } from '../../web/scripts/globo/fronteras.js';
import { escuchar } from '../../web/scripts/globo/interaccion.js';

const WEB = new URL('../../web/', import.meta.url);
const FRONTERAS = leerFronteras(JSON.parse(readFileSync(new URL('recursos/globo/fronteras.json', WEB), 'utf8')));
/** Un giro que deja España lejos del centro, en grados. */
const GIRO_LEJOS = Object.freeze({ longitud: 90, latitud: -30 });
const ACCIONES = ['arriba', 'izquierda', 'centrar', 'derecha', 'abajo', 'acercar', 'alejar'];

/** Un elemento falso que guarda sus escuchas y las dispara con `lanzar`. */
function elementoFalso() {
  /** @type {Map<string, ((evento: unknown) => void)[]>} */
  const escuchas = new Map();
  return {
    /** @param {string} tipo @param {(evento: unknown) => void} escucha */
    addEventListener(tipo, escucha) {
      escuchas.set(tipo, [...(escuchas.get(tipo) ?? []), escucha]);
    },
    /** @param {string} tipo */
    lanzar(tipo) {
      for (const escucha of escuchas.get(tipo) ?? []) {
        escucha({});
      }
    },
  };
}

test('«Volver a mi país» pone el territorio elegido en el centro con el mismo acercamiento; sin contorno, no mueve', () => {
  const espana = FRONTERAS.territorios.find(({ codigo }) => codigo === 'ESP');
  assert.ok(espana);
  const lejos = acercar(girar({ centro: espana.centro, zoom: 1 }, GIRO_LEJOS.longitud, GIRO_LEJOS.latitud), 1);
  assert.notDeepEqual(lejos.centro, espana.centro);
  const vuelta = centrarEn(lejos, espana.centro);
  assert.deepEqual(vuelta, { centro: { ...espana.centro }, zoom: lejos.zoom });
  assert.equal(centrarEn(lejos, undefined), lejos, 'un territorio sin contorno no mueve el globo');
});

test('el botón central llama a «centrar» y no gira; las flechas y el zoom mueven la vista', () => {
  const mandos = new Map(ACCIONES.map((accion) => [accion, elementoFalso()]));
  let vista = { centro: { longitud: 0, latitud: 0 }, zoom: 1 };
  /** @type {string[]} */
  const llamadas = [];
  const controles = {
    vista: () => vista,
    radio: () => 1,
    mover: (/** @type {typeof vista} */ nueva) => {
      llamadas.push('mover');
      vista = nueva;
    },
    pulsar: () => undefined,
    sobreDatos: () => false,
    volver: () => false,
    centrar: () => llamadas.push('centrar'),
  };
  const partes = /** @type {import('../../web/scripts/globo/panel.js').Partes} */ (
    /** @type {unknown} */ ({ raiz: elementoFalso(), lienzo: elementoFalso(), mandos })
  );
  const controlador = new AbortController();
  escuchar(partes, controles, controlador.signal);
  mandos.get('centrar')?.lanzar('click');
  assert.deepEqual(llamadas, ['centrar']);
  mandos.get('derecha')?.lanzar('click');
  assert.deepEqual(vista.centro, { longitud: PASO_DE_GIRO_GRADOS, latitud: 0 });
  mandos.get('acercar')?.lanzar('click');
  assert.ok(vista.zoom > 1);
  assert.deepEqual(llamadas, ['centrar', 'mover', 'mover']);
  controlador.abort();
});

test('cada mando tiene su nombre en castellano y en catalán, y las instrucciones dicen que la elegida es amarilla', () => {
  /** @type {Record<string, string>} */
  const castellano = CASTELLANO;
  /** @type {Record<string, string>} */
  const catalan = CATALAN;
  for (const accion of ACCIONES) {
    const clave = `globo.mando.${accion}`;
    assert.ok(castellano[clave]?.trim(), `${clave} en castellano`);
    assert.ok(catalan[clave]?.trim(), `${clave} en catalán`);
  }
  assert.equal(castellano['globo.mando.centrar'], 'Volver a mi país');
  assert.equal(catalan['globo.mando.centrar'], 'Tornar al meu país');
  assert.match(castellano['globo.instrucciones'] ?? '', /La del país elegido es amarilla y más grande\./);
  assert.match(catalan['globo.instrucciones'] ?? '', /La del país triat és groga i més gran\./);
});

test('los mandos son de cristal oscuro por tokens, con botones de 44 px y sin sombras ni animaciones', () => {
  const tokens = readFileSync(new URL('estilos/tokens.css', WEB), 'utf8');
  assert.match(tokens, /--globo-mandos-fondo: rgb\(10 16 24 \/ 72%\);/);
  assert.match(tokens, /--globo-mandos-filete: rgb\(255 255 255 \/ 16%\);/);
  const css = readFileSync(new URL('estilos/globo.css', WEB), 'utf8');
  const reglas = [...css.matchAll(/([^{}]*\.globo-mando[^{}]*)\{([^}]*)\}/g)];
  assert.ok(reglas.length > 0);
  for (const [, selector, cuerpo = ''] of reglas) {
    assert.doesNotMatch(cuerpo, /box-shadow|transition|animation/, `${selector?.trim()}: sin sombras ni animaciones`);
  }
  const boton = reglas.find(([, selector]) => selector?.trim() === '.globo-mando')?.[2] ?? '';
  assert.match(boton, /width: 2\.75rem;/);
  assert.match(boton, /height: 2\.75rem;/);
  assert.match(css, /background: var\(--globo-mandos-fondo\);/);
  assert.match(css, /border: 1px solid var\(--globo-mandos-filete\);/);
  assert.match(css, /\.globo-mando:focus-visible \{\s*outline: 2px solid/);
});
