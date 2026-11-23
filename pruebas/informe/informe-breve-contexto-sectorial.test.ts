import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Datos } from '../../src/dominio/tipos-paquete.ts';
import { informeAdmitido } from '../../web/scripts/confianza/informe.js';
import { caso, DATOS } from '../ayudas/informe-contexto.ts';

test('el contexto censal conserva grupo, clasificación, sectores y otros publicados, fuera de las dos hojas', () => {
  const { breve, html } = caso();
  assert.ok(breve.sectores);
  assert.equal(breve.sectores.grupoSolicitado, '430');
  assert.equal(breve.sectores.grupoMostrado, '430');
  assert.match(html, /Contexto censal del grupo \(2021\)/u);
  assert.match(html, /CNAE-2009/);
  assert.match(html, /CNO-11/);
  assert.match(html, /no identifica el sector de tu empresa/u);
  const inicioAnexos = html.indexOf('class="ib-contexto');
  assert.ok(inicioAnexos > html.lastIndexOf('<section class="hoja '));
  assert.ok(html.indexOf('class="ib-contexto ib-contexto-censal') >= inicioAnexos);
  assert.equal(html.split('<section class="hoja ').length - 1, 2);
  const publicado = DATOS.sectores?.cataluna.cno3['430'];
  assert.ok(publicado);
  assert.equal(breve.sectores.otros, publicado.otros_pct);
  assert.deepEqual(
    breve.sectores.sectores.map((s) => [s.codigo, s.porcentaje, s.personas]),
    publicado.sectores,
  );
});

test('la remisión CNO2 se conserva como remisión de la fuente, sin inferir su motivo ni el sector individual', () => {
  assert.ok(DATOS.sectores);
  const sectores = {
    ...DATOS.sectores,
    cataluna: {
      ...DATOS.sectores.cataluna,
      cno3: { ...DATOS.sectores.cataluna.cno3, '430': { personas: 400, ver_cno2: '43' } },
    },
  };
  const a = caso({ ...DATOS, sectores });
  assert.ok(a.breve.sectores);
  assert.equal(a.breve.sectores.grupoMostrado, '43');
  assert.equal(a.breve.sectores.remision, true);
  assert.match(a.html, /La fuente remite del grupo 430 al grupo 43/u);
  assert.doesNotMatch(a.html, /porque.*1[.\s]?000/u);
});

test('correspondencia ambigua, remisión sin reparto o paquete ausente mantienen contexto desconocido', () => {
  assert.equal(caso(DATOS, 'es', '5411').breve.sectores, null);
  const sin: Datos = { ...DATOS };
  delete sin.sectores;
  assert.equal(caso(sin).breve.sectores, null);
  assert.ok(DATOS.sectores);
  const sectores = {
    ...DATOS.sectores,
    cataluna: {
      ...DATOS.sectores.cataluna,
      cno3: { ...DATOS.sectores.cataluna.cno3, '430': { personas: 400, ver_cno2: '43' } },
      cno2: { ...DATOS.sectores.cataluna.cno2, '43': { personas: 800, sin_reparto: true } },
    },
  };
  assert.equal(caso({ ...DATOS, sectores }).breve.sectores, null);
});

test('otros solo se muestra si lo publica la fuente y nunca se fabrica el número de sus personas', () => {
  assert.ok(DATOS.sectores);
  const sectores = structuredClone(DATOS.sectores);
  const grupo = sectores.cataluna.cno3['430'];
  assert.ok(grupo);
  delete grupo.otros_pct;
  const a = caso({ ...DATOS, sectores });
  assert.ok(a.breve.sectores);
  assert.equal(a.breve.sectores.otros, null);
  assert.doesNotMatch(a.html, /Otros sectores \(resto de la fuente\)/u);
});

test('una clasificación ajena o la ausencia de remisión explícita no selecciona por parecido', () => {
  assert.ok(DATOS.sectores);
  const sectores = structuredClone(DATOS.sectores);
  Reflect.set(sectores, 'clasificacion_actividad', 'CNAE-2025');
  assert.equal(caso({ ...DATOS, sectores }).breve.sectores, null);
  sectores.clasificacion_actividad = 'CNAE-2009';
  delete sectores.cataluna.cno3['430'];
  assert.equal(caso({ ...DATOS, sectores }).breve.sectores, null);
});

test('el porcentaje empresarial no altera el reparto censal; las denominaciones CA conservan el original marcado', () => {
  assert.ok(DATOS.empresas);
  const original = caso();
  const a = caso({ ...DATOS, empresas: { ...DATOS.empresas, cataluna: { total: 0 } } });
  assert.deepEqual(a.breve.sectores, original.breve.sectores);
  const ca = caso(DATOS, 'ca');
  assert.match(ca.html, /Context censal del grup \(2021\)/u);
  assert.match(ca.html, /no identifica el sector de la teva empresa/u);
  assert.match(ca.html, /lang="es"/u);
  assert.doesNotThrow(() => informeAdmitido(ca.html));
});
