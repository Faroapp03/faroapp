// El contenido firmado conserva ámbito, versión, campos visibles y normalización con firma real local.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ambitoDe, contenidoFirmado, type EstimacionEntrada } from '../../src/api/estimacion-firmada.ts';
import { crearFirmador } from '../../src/seguridad/firma.ts';
import { MAX_TAREA } from '../../src/seguridad/limites.ts';

const MARGEN_BAJO = 0.4;
const MARGEN_ALTO = 0.6;
const ESTIMACION: EstimacionEntrada = { valor: 0.5, margen: [MARGEN_BAJO, MARGEN_ALTO], origen: 'faro' };
const GRUPO = { ocupacionEsco: null, grupoIsco08: '4226' } as const;
const BYTES_SECRETO = 32;
const SECRETO_FICTICIO = 'x'.repeat(BYTES_SECRETO);
const AHORA = 1_800_000_000_000;
const VIGENCIA = 1000;

test('el ámbito distingue ocupación ESCO y grupo ISCO sin firmar ambos', () => {
  assert.deepEqual(ambitoDe({ esco: null, isco08: '4226' }), GRUPO);
  assert.deepEqual(ambitoDe({ esco: '4226.1.1', isco08: '4226' }), { ocupacionEsco: '4226.1.1', grupoIsco08: null });
});

test('la versión y los valores por defecto son exactos y los campos ajenos a la firma no se incorporan', () => {
  const firmado = contenidoFirmado(GRUPO, 'Dar citas', {
    ...ESTIMACION,
    firma: 'firma ficticia',
    competencias: ['ajena'],
  });
  assert.deepEqual(firmado, {
    v: 4,
    ...GRUPO,
    tarea: 'dar citas',
    valor: 0.5,
    margen: [MARGEN_BAJO, MARGEN_ALTO],
    origen: 'faro',
    referencias: 'ocupacion',
    incierta: false,
    referenciaCercana: null,
    iaPodria: null,
    loTuyo: null,
  });
  assert.equal(firmado.margen, ESTIMACION.margen);
});

test('todos los campos visibles y su política se cubren sin recortar ni redondear la estimación', () => {
  const completa: EstimacionEntrada = {
    ...ESTIMACION,
    referencias: 'oit',
    incierta: true,
    referenciaCercana: '4226-2',
    iaPodria: 'Preparar citas.',
    loTuyo: 'Tu criterio.',
    origen: 'faro-sin-validar',
  };
  const firmado = contenidoFirmado(GRUPO, 'Dar citas', completa);
  assert.deepEqual(firmado, {
    v: 4,
    ...GRUPO,
    tarea: 'dar citas',
    valor: completa.valor,
    margen: completa.margen,
    origen: completa.origen,
    referencias: 'oit',
    incierta: true,
    referenciaCercana: '4226-2',
    iaPodria: 'Preparar citas.',
    loTuyo: 'Tu criterio.',
  });
});

test('la tarea se recorta en UTF-16, limpia y normaliza conservando el contrato Unicode actual', () => {
  assert.equal(contenidoFirmado(GRUPO, '  DÁR citas!!!  ', ESTIMACION).tarea, 'dar citas');
  assert.ok(!contenidoFirmado(GRUPO, 'Enviar a prueba@example.com las citas.', ESTIMACION).tarea.includes('example'));
  assert.equal(
    contenidoFirmado(GRUPO, `Dar ${'c'.repeat(MAX_TAREA)}`, ESTIMACION).tarea,
    `dar ${'c'.repeat(MAX_TAREA - 'Dar '.length)}`,
  );
  assert.equal(contenidoFirmado(GRUPO, 'Archivar\ud800 facturas', ESTIMACION).tarea, 'archivar facturas');
});

test('la firma real acepta el mismo ámbito y tarea normalizada y rechaza cambios cubiertos o Unicode inválido', async () => {
  const firmador = await crearFirmador(SECRETO_FICTICIO, VIGENCIA, () => AHORA, { uso: 'estimaciones' });
  const firmado = contenidoFirmado(GRUPO, 'DAR citas!', ESTIMACION);
  const firma = await firmador.firmar(firmado);
  assert.equal(await firmador.comprobar(contenidoFirmado(GRUPO, 'dar citas', ESTIMACION), firma), true);
  for (const alterado of [
    { ...firmado, grupoIsco08: '9112' },
    { ...firmado, valor: 1 },
    { ...firmado, tarea: 'cobrar' },
    { ...firmado, iaPodria: 'Cobrar recibos.' },
  ]) {
    assert.equal(await firmador.comprobar(alterado, firma), false);
  }
  await assert.rejects(
    firmador.firmar(contenidoFirmado(GRUPO, 'Dar citas', { ...ESTIMACION, iaPodria: 'Clasificar\ud800 documentos.' })),
    TypeError,
  );
});
