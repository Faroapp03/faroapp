import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Datos } from '../../src/dominio/tipos-paquete.ts';
import { informeAdmitido } from '../../web/scripts/confianza/informe.js';
import { caso, DATOS } from '../ayudas/informe-contexto.ts';

const CATALUNA_2026 = 40.49;
const CIFRAS_SHA256 = 64;

test('la señal sale de la tabla D.1 admitida, con base Internet y periodo propio; no de la constante Eurostat', () => {
  const { breve, html } = caso();
  assert.equal(breve.empresas?.cataluna.total, CATALUNA_2026);
  assert.equal(breve.empresas?.vigencia.periodo, '2026-T1');
  assert.equal(breve.empresas?.encuesta.denominador, 'empresas con conexión a Internet');
  assert.match(html, /40,49/);
  assert.match(html, /1T 2026/);
  assert.match(html, /empresas catalanas con Internet/u);
  assert.match(html, /10 o más personas/u);
  assert.match(html, /Ruptura de serie; sin comparación/u);
  assert.doesNotMatch(html, /24 de cada 100 \(2025\)|Sube \(11 en 2023/);
  assert.equal(breve.senales.find((s) => s.clave === 'empresas')?.proxima, null);
  assert.doesNotThrow(() => informeAdmitido(html));
});

test('otra edición admitida cambia cifra, periodo y fuente sin actualizar presentación ni otras cifras', () => {
  assert.ok(DATOS.empresas);
  const datos: Datos = {
    ...DATOS,
    empresas: {
      ...DATOS.empresas,
      fuente: 'INE, edición sintética 2027',
      vigencia: { ...DATOS.empresas.vigencia, periodo: '2027-T1', siguiente_prevista: '2028-10-20' },
      encuesta: { ...DATOS.empresas.encuesta, edicion: '2026–1T2027', ruptura: null },
      cataluna: { total: 51.25 },
    },
  };
  const antes = caso();
  const despues = caso(datos);
  assert.match(despues.html, /51,25/);
  assert.match(despues.html, /1T 2027/);
  assert.equal(despues.breve.empresas?.fuente, 'INE, edición sintética 2027');
  assert.deepEqual(despues.breve.capacidad, antes.breve.capacidad);
  assert.deepEqual(despues.breve.mercado, antes.breve.mercado);
  assert.deepEqual(despues.breve.uso, antes.breve.uso);
});

test('sin paquete empresarial no inventa cifra ni previsión; cero publicado sí es dato', () => {
  const sin: Datos = { ...DATOS };
  delete sin.empresas;
  const a = caso(sin);
  assert.equal(a.breve.empresas, null);
  assert.ok(!a.breve.senales.some((s) => s.clave === 'empresas'));
  assert.ok(DATOS.empresas);
  const cero = caso({ ...DATOS, empresas: { ...DATOS.empresas, cataluna: { total: 0 } } });
  assert.equal(cero.breve.empresas?.cataluna.total, 0);
  assert.ok(cero.breve.senales.some((s) => s.clave === 'empresas'));
});

test('los datos empresariales no cambian por elegir ocupación ni ponderan sus porcentajes con el censo', () => {
  const oficina = caso();
  const conduccion = caso(DATOS, 'es', '8331');
  assert.deepEqual(oficina.breve.empresas, conduccion.breve.empresas);
});

test('CA traduce los textos propios, conserva denominaciones oficiales ES marcadas y pasa la guarda HTML', () => {
  const { html } = caso(DATOS, 'ca');
  assert.match(html, /empreses catalanes amb Internet/u);
  assert.match(html, /lang="es"/u);
  assert.doesNotThrow(() => informeAdmitido(html));
});

test('las capturas se enlazan con rótulos públicos, sin nombres de archivo ni huellas en la pantalla', () => {
  const { html } = caso();
  assert.match(html, /Tabla oficial/u);
  assert.match(html, /Notas metodológicas/u);
  assert.doesNotMatch(html, /SHA-256|ine-eticce-2026-comunidades/u);
  assert.ok(DATOS.empresas?.capturas.every((c) => c.sha256.length === CIFRAS_SHA256));
});

test('una base o clasificación no declaradas no se presentan como el total con Internet admitido', () => {
  assert.ok(DATOS.empresas);
  for (const cambio of [{ denominador: null }, { denominador: 'PC_ENT' }, { clasificacion: null }]) {
    const datos: Datos = {
      ...DATOS,
      empresas: { ...DATOS.empresas, encuesta: { ...DATOS.empresas.encuesta, ...cambio } },
    };
    const { breve } = caso(datos);
    assert.equal(breve.empresas, null);
    assert.ok(!breve.senales.some((s) => s.clave === 'empresas'));
  }
});
