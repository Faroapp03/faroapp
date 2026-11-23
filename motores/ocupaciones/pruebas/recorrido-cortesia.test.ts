// Saludos y cortesía en el recorrido (src/recorrido/pantalla/cortesia.ts): lo que es solo cortesía no se busca y la
// pantalla responde en la entrada; lo que mezcla cortesía y trabajo se busca sin la cortesía, y lo demás no cambia ni
// una letra. En castellano y en catalán, con reglas fijas.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { cargarDatos } from '../../../src/plataforma/node/datos.ts';
import { quitarCortesia } from '../src/recorrido/pantalla/cortesia.ts';
import { buscarAMano, pasoDePantalla } from '../src/recorrido/pantalla/servicio.ts';
import { comprobarAtributos } from '../src/recorrido/preguntas/atributos.ts';

const datos = cargarDatos(fileURLToPath(new URL('../../../datos/', import.meta.url)));
const A = comprobarAtributos(
  JSON.parse(readFileSync(new URL('../src/recorrido/preguntas/atributos.json', import.meta.url), 'utf8')),
);

describe('lo que es solo cortesía', () => {
  const CASOS: readonly (readonly [string, string])[] = [
    ['hola', 'saludo'],
    ['Buenas', 'saludo'],
    ['buenos días', 'saludo'],
    ['hello', 'saludo'],
    ['Hola Faro', 'saludo'],
    ['¿qué tal?', 'como_estas'],
    ['hola, como estas ?', 'como_estas'],
    ['¿Cómo estás?', 'como_estas'],
    ['muy bien, ¿y tú?', 'como_estas'],
    ['gracias', 'gracias'],
    ['¡Muchas gracias!', 'gracias'],
    ['adiós', 'despedida'],
    ['hasta luego', 'despedida'],
    ['¿quién eres?', 'sobre_faro'],
    ['¿Qué haces?', 'sobre_faro'],
    ['ayuda', 'sobre_faro'],
    ['bon dia', 'saludo'],
    ['Bona tarda!', 'saludo'],
    ['com estàs?', 'como_estas'],
    ['què tal', 'como_estas'],
    ['moltes gràcies', 'gracias'],
    ['adéu', 'despedida'],
    ['qui ets?', 'sobre_faro'],
    ["ajuda'm", 'sobre_faro'],
  ];
  for (const [texto, tipo] of CASOS) {
    it(`«${texto}» → ${tipo}`, () => {
      // Solo cortesía: se reconoce y no queda nada que leer.
      const { texto: resto, cortesia } = quitarCortesia(texto);
      assert.ok(cortesia.includes(tipo as never), `${texto}: ${cortesia}`);
      assert.equal(resto, '');
    });
  }
});

describe('cortesía y trabajo juntos: se quita la cortesía', () => {
  const CASOS: readonly (readonly [string, string])[] = [
    ['hola, soy camarera', 'soy camarera'],
    ['hola como estás? corto verdura', 'corto verdura'],
    ['hola, como estas ?. corto verdura', 'corto verdura'],
    ['Hola Faro, buenos días. Soy camarera en un bar, gracias', 'Soy camarera en un bar'],
    ['buenas tardes, trabajo de cajera. Adiós', 'trabajo de cajera.'],
    ['bon dia, sóc cambrera', 'sóc cambrera'],
    ['hola què tal, treballo en un forn', 'treballo en un forn'],
  ];
  for (const [texto, queda] of CASOS) {
    it(`«${texto}» → «${queda}»`, () => {
      assert.equal(quitarCortesia(texto).texto, queda);
    });
  }
});

describe('sin cortesía, el texto no cambia ni una letra', () => {
  const IGUALES = [
    'corto verdura',
    'soy camarera',
    'ayuda a domicilio',
    'Auxiliar de ayuda a domicilio, gracias a mi curso',
    'hi treballo de cambrer',
    'como estas cajas, las ordeno en el almacén',
    'trabajo en una tienda de buenos días',
    'Soy auxiliar administrativa en un ayuntamiento',
  ];
  for (const texto of IGUALES) {
    it(`«${texto}»`, () => {
      assert.deepEqual(quitarCortesia(texto), { texto, cortesia: [] });
    });
  }
  it('«faro» solo es un saludo cuando va solo o junto a otro', () => {
    assert.equal(quitarCortesia('trabajo en el faro del puerto').texto, 'trabajo en el faro del puerto');
  });
});

describe('el paso de la pantalla', () => {
  const paso = (texto: string, idioma: 'es' | 'ca' = 'es') =>
    pasoDePantalla(datos, A, { texto, idioma, respuestas: [] });

  it('solo cortesía: nada que buscar, la lectura lo dice y no se gasta en preguntas', () => {
    const { lectura, paso: p } = paso('hola, ¿cómo estás?');
    assert.deepEqual(lectura.cortesia, ['saludo', 'como_estas']);
    assert.equal(lectura.sinComprension, true);
    assert.equal(p.tipo, 'no_encontrada');
    assert.deepEqual(paso('qui ets?', 'ca').lectura.cortesia, ['sobre_faro']);
  });

  it('con trabajo: el mismo paso que sin la cortesía, y sin campo de cortesía', () => {
    for (const [con, sin] of [
      ['hola, como estas ?. corto verdura', 'corto verdura'],
      ['hola, soy camarera', 'soy camarera'],
      ['Buenos días, soy auxiliar administrativa en un ayuntamiento', 'soy auxiliar administrativa en un ayuntamiento'],
    ] as const) {
      const a = paso(con);
      assert.deepEqual(a, paso(sin), con);
      assert.equal(a.lectura.cortesia, undefined, con);
    }
  });

  it('un trabajo sin cortesía no lleva el campo', () => {
    assert.equal(paso('camarero').lectura.cortesia, undefined);
  });

  it('«Prefiero buscarla yo» también busca sin la cortesía', () => {
    assert.deepEqual(buscarAMano(datos, 'hola, camarero', 'es'), buscarAMano(datos, 'camarero', 'es'));
  });
});
