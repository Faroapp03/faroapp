import assert from 'node:assert/strict';
import { test } from 'node:test';
import ca from '../../web/idiomas/ca.js';
import es from '../../web/idiomas/es.js';
import {
  conVersiones,
  enIdioma,
  fijarIdioma,
  hayDiccionario,
  idiomaActual,
  registrarDiccionario,
  resolver,
  texto,
  traducible,
} from '../../web/scripts/textos.js';

test('las claves heredadas no son diccionarios ni textos registrados', () => {
  registrarDiccionario('es', es);
  for (const clave of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
    assert.equal(hayDiccionario(clave), false);
    assert.equal(texto(clave), clave);
  }
});

test('ES y CA conservan claves, marcadores y valores no vacíos', () => {
  assert.deepEqual(Object.keys(es).sort(), Object.keys(ca).sort());
  const marcas = (valor: string) => [...valor.matchAll(/\{\w+\}/g)].map(([marca]) => marca).sort();
  for (const [clave, valor] of Object.entries(es)) {
    const traduccion = ca[clave];
    assert.equal(typeof traduccion, 'string', clave);
    assert.ok(valor.trim());
    assert.ok(traduccion?.trim());
    assert.deepEqual(marcas(valor), marcas(traduccion ?? ''), clave);
  }
});

// Claves cuyo castellano coincide con el de otra y cuyo catalán no puede coincidir, cada una con su motivo.
const CON_TRADUCCION_PROPIA = new Map([
  ['entender-ia.ejemplo.cifra.vocal', 'Ante una cifra que empieza por vocal, «el» se apostrofa: «l’».'],
]);

test('un mismo texto en castellano se dice de una sola manera en catalán en todo el sitio', () => {
  const traducciones = new Map<string, Map<string, string[]>>();
  for (const [clave, valor] of Object.entries(es)) {
    if (CON_TRADUCCION_PROPIA.has(clave)) {
      continue;
    }
    const variantes = traducciones.get(valor) ?? new Map<string, string[]>();
    const traduccion = ca[clave] ?? '';
    variantes.set(traduccion, [...(variantes.get(traduccion) ?? []), clave]);
    traducciones.set(valor, variantes);
  }
  const dichasDeVariasManeras = [...traducciones]
    .filter(([, variantes]) => variantes.size > 1)
    .map(([valor, variantes]) => ({ es: valor, ca: Object.fromEntries(variantes) }));
  assert.deepEqual(dichasDeVariasManeras, []);
  for (const [clave, motivo] of CON_TRADUCCION_PROPIA) {
    assert.ok(clave in es, `la excepción ${clave} sigue existiendo`);
    assert.ok(motivo.trim(), `la excepción ${clave} dice por qué`);
  }
});

test('resuelve marcadores anidados y versiones sin interpretar literales', () => {
  registrarDiccionario('es', { prueba: 'Resumen: {valor}', numero: '{n}', incompleta: 'Solo ES' });
  registrarDiccionario('ca', { prueba: 'Resum: {valor}', numero: '{n}' });
  fijarIdioma('ca');
  assert.equal(resolver(traducible('prueba', { valor: traducible('numero', { n: 3 }) })), 'Resum: 3');
  assert.equal(texto('incompleta'), 'Solo ES');
  assert.equal(resolver(enIdioma('<img onerror=alert(1)>', 'en')), '<img onerror=alert(1)>');
  assert.equal(resolver(conVersiones({ es: 'Dato', ca: null })), 'Dato');
  assert.equal(resolver(conVersiones({ es: 'Dato', ca: 'Dada' }, (valor, idioma) => `${idioma}:${valor}`)), 'ca:Dada');
  assert.equal(fijarIdioma('fr'), 'ca');
  assert.equal(idiomaActual(), 'ca');
  fijarIdioma('es');
});
