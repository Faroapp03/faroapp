import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import {
  apuntarTraducciones,
  datoEn,
  datoOficial,
  hayTraduccionEn,
  olvidarTraducciones,
  origenesSinTraduccion,
} from '../../web/scripts/recorrido/datos-traducidos.js';
import { fijarIdioma, idiomaDeLaVersion, resolver } from '../../web/scripts/textos.js';

beforeEach(() => {
  olvidarTraducciones();
  fijarIdioma('es');
});

const grupo = { castellano: 'Conductores', traduccion: 'Conductors', origen: 'grupo:8331' };

test('los elementos ya creados reciben la traducción al llegar y siguen conservando original e idioma', () => {
  const visto = datoOficial(grupo.castellano);
  fijarIdioma('ca');
  assert.equal(resolver(visto), grupo.castellano);
  assert.equal(idiomaDeLaVersion(visto), 'es');
  apuntarTraducciones([grupo], 'ca');
  assert.equal(resolver(visto), grupo.traduccion);
  assert.equal(idiomaDeLaVersion(visto), 'ca');
  fijarIdioma('es');
  assert.equal(resolver(visto), grupo.castellano);
  assert.equal(datoEn(grupo.castellano, 'ca'), grupo.traduccion);
});

test('null o blancos posteriores no borran una traducción; null intentado no repite la lectura', () => {
  apuntarTraducciones([grupo], 'ca');
  apuntarTraducciones(
    [
      { ...grupo, traduccion: null },
      { ...grupo, traduccion: ' ' },
    ],
    'ca',
  );
  assert.equal(datoEn(grupo.castellano, 'ca'), grupo.traduccion);
  apuntarTraducciones([{ castellano: 'Sin traducir', traduccion: null, origen: 'grupo:7512' }], 'ca');
  assert.deepEqual(origenesSinTraduccion('ca'), []);
  assert.equal(datoEn('Sin traducir', 'ca'), 'Sin traducir');
});

test('las lecturas pendientes se deduplican y conservan orden; castellano no finge traducciones en catalán', () => {
  apuntarTraducciones(
    [grupo, { ...grupo, origen: 'hijos:83' }, { castellano: 'Otro', traduccion: undefined, origen: 'grupo:8331' }],
    'es',
  );
  assert.deepEqual(origenesSinTraduccion('ca'), ['grupo:8331', 'hijos:83']);
  assert.equal(hayTraduccionEn('ca'), false);
  apuntarTraducciones([grupo], 'ca');
  assert.equal(hayTraduccionEn('ca'), true);
  assert.equal(hayTraduccionEn('es'), false);
  assert.deepEqual(origenesSinTraduccion('ca'), ['grupo:8331']);
});

test('vaciar retira memoria y orígenes; entradas sin original o sin traducción útil no crean texto traducido', () => {
  apuntarTraducciones([grupo], 'ca');
  olvidarTraducciones();
  apuntarTraducciones(
    [
      { ...grupo, castellano: '' },
      { ...grupo, traduccion: ' ' },
    ],
    'ca',
  );
  assert.equal(hayTraduccionEn('ca'), false);
  assert.equal(datoEn(grupo.castellano, 'ca'), grupo.castellano);
  assert.deepEqual(origenesSinTraduccion('ca'), []);
});
