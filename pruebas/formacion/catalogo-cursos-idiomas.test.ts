import assert from 'node:assert/strict';
import test from 'node:test';
import { consultarCatalogo, idiomasDelCurso } from '../../src/catalogo-cursos/consulta.ts';
import type { HechoCatalogo, OfertaCatalogo } from '../../src/catalogo-cursos/contrato.ts';
import { CATALOGO_CLASIFICACION as catalogo } from '../ayudas/catalogo-clasificacion.ts';

const ahora = Date.parse('2026-10-25T20:30:00Z');
const filtros = { texto: '', idioma: '', modalidad: '', nivel: '', tema: '', orden: 'nombre' };
const TOTAL = 709;
const ANTES: Readonly<Record<string, number>> = { es: 37, ca: 0, en: 6, 'no-indicado': 313 };
const DESPUES = { es: 302, ca: 429, en: 6, 'no-indicado': 0 };
const declaracionContaminada = "Català Data: Dimecres 4 de novembre, 10:00h - 13:00h Inscriure'm";

function ofertaConIdiomas(valor: HechoCatalogo['valor'], motivo: HechoCatalogo['motivo'] = 'conocido'): OfertaCatalogo {
  const oferta = catalogo.ofertas[0];
  assert.ok(oferta);
  return {
    ...oferta,
    hechos: { ...oferta.hechos, idiomas_declarados: { ...oferta.hechos.idiomas_declarados, valor, motivo } },
  };
}

test('los nombres ES/CA/EN y códigos regionales coinciden con los valores de los filtros UI', () => {
  const variantes = {
    es: ['es', 'ES', 'es-ES', 'es_419', 'Español', 'CASTELLANO', 'Castellà', 'Spanish'],
    ca: ['ca', 'CA', 'ca-ES', 'ca_AD', 'Català', 'Catalán', 'Catalan'],
    en: ['en', 'EN', 'en-GB', 'en_Latn_US', 'Inglés', 'Anglès', 'English'],
  };
  for (const [codigo, valores] of Object.entries(variantes)) {
    assert.deepEqual(idiomasDelCurso(ofertaConIdiomas(valores)), [codigo]);
  }
  assert.deepEqual(idiomasDelCurso(ofertaConIdiomas(['Català', 'ca-ES', 'ES', 'Español'])), ['ca', 'es']);
});

test('los idiomas distintos, frases contaminadas y desconocidos no se reinterpretan ni se pierden', () => {
  assert.deepEqual(idiomasDelCurso(ofertaConIdiomas(['fr', 'Deutsch', declaracionContaminada])), [
    'fr',
    'Deutsch',
    declaracionContaminada,
  ]);
  assert.deepEqual(idiomasDelCurso(ofertaConIdiomas(['constructor', 'toString'])), ['constructor', 'toString']);
  for (const valor of [null, [], ['  ']]) {
    assert.deepEqual(idiomasDelCurso(ofertaConIdiomas(valor)), ['no-indicado']);
  }
  assert.deepEqual(idiomasDelCurso(ofertaConIdiomas(null, 'no_interpretable')), ['no-indicado']);
  assert.deepEqual(idiomasDelCurso(ofertaConIdiomas(['ca'], 'no_consta_en_evidencia')), ['no-indicado']);
});

test('las 709 ofertas reales conservan datos y recuperan los recuentos publicados en los filtros UI', () => {
  const original = JSON.stringify(catalogo);
  const consulta = consultarCatalogo(catalogo, filtros, ahora);
  assert.equal(consulta.total, TOTAL);
  assert.equal(consulta.ofertas.length, TOTAL);
  for (const [idioma, esperado] of Object.entries(DESPUES)) {
    const anteriores = catalogo.ofertas.filter((oferta) => {
      const hecho = oferta.hechos.idiomas_declarados;
      const valores = hecho.motivo === 'conocido' && Array.isArray(hecho.valor) ? hecho.valor : ['no-indicado'];
      return valores.includes(idioma);
    });
    assert.equal(anteriores.length, ANTES[idioma]);
    assert.equal(consulta.cuentas.get('idioma')?.get(idioma) ?? 0, esperado);
    const filtradas = consultarCatalogo(catalogo, { ...filtros, idioma }, ahora);
    assert.equal(filtradas.ofertas.length, esperado);
    assert.equal(filtradas.total, TOTAL);
  }
  const arrastran = catalogo.ofertas.flatMap((oferta) => {
    const valor = oferta.hechos.idiomas_declarados.valor;
    return Array.isArray(valor)
      ? valor.filter((v) => typeof v === 'string' && /:|Inscriure|Veure més|Ubicació/u.test(v))
      : [];
  });
  assert.deepEqual(arrastran, [], 'Ningún idioma publicado arrastra otro campo de la ficha');
  assert.equal(JSON.stringify(catalogo), original, 'La normalización no reescribe los hechos publicados');
});

test('los recuentos cruzados respetan modalidad y no cuentan dos veces un mismo idioma normalizado', () => {
  const oferta = ofertaConIdiomas(['Català', 'ca', 'ca-ES', 'Español']);
  const sintetico = { ...catalogo, ofertas: [oferta] };
  const consulta = consultarCatalogo(sintetico, { ...filtros, idioma: 'ca' }, ahora);
  assert.equal(consulta.ofertas.length, 1);
  assert.equal(consulta.cuentas.get('idioma')?.get('ca'), 1);
  assert.equal(consulta.cuentas.get('idioma')?.get('es'), 1);
  const linea = consultarCatalogo(catalogo, { ...filtros, modalidad: 'en-linea' }, ahora);
  const catalan = consultarCatalogo(catalogo, { ...filtros, modalidad: 'en-linea', idioma: 'ca' }, ahora);
  assert.equal(linea.cuentas.get('idioma')?.get('ca'), catalan.ofertas.length);
  assert.ok(catalan.ofertas.length > 0);
});
