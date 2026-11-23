/** Contrato privado de la instantánea: semántica del recibo y lectura cerrada sin ejecutar la entrada. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  leerDatosDeRecibo,
  leerObservacionDatosTrabajo,
  MAX_DATOS_TRABAJO_BYTES,
  MAX_OBSERVACION_DATOS_BYTES,
} from '../../src/administracion/datos-trabajo.ts';
import { type EstadoDatosPanel, leerEstadoDatosPanel } from '../../src/administracion/estado-datos.js';
import { leerResultado } from '../../src/administracion/resultado-actualizacion.ts';
import type { ReciboTrabajo } from '../../src/administracion/trabajos.ts';
import { catalogoPrivado } from '../ayudas/catalogo-privado.ts';

import { CORTE_SALUD, instantaneaSaludV4 } from '../ayudas/salud-datos.ts';

const VERSION_CATALOGO_PRIVADO = 3;
const TAM_HUELLA = 64;
const TAM_VERSION = 16;
const DATOS = leerEstadoDatosPanel({
  version: 1,
  observadoEn: '2026-10-16T12:00:00Z',
  fuentes: [
    { id: 'segunda', politica: 'edición', fecha: '2026-10-15', plazoDias: null },
    { id: 'primera', politica: 'manual', fecha: null, plazoDias: null },
  ],
  modulos: ['primera', 'paquete', 'segunda'].map((id) => ({
    id,
    ultimoIntento: '2026-10-16T11:59:59Z',
    veredicto: 'verde',
    ultimaVersionBuena: { fecha: '2026-10-15T10:00:00Z', huella: 'a'.repeat(TAM_HUELLA) },
    fallos: 0,
    proximoReintento: null,
  })),
  formacionAbiertaCaduca: '2026-11-01',
});
const RECIBO: ReciboTrabajo = {
  solicitudId: '11111111-1111-4111-8111-111111111111',
  revisionReserva: 1,
  accion: 'actualizar-datos',
  resultado: 'validado',
  veredicto: 'verde',
  terminadoEn: '2026-10-16T12:00:01Z',
  huellaPaquete: 'b'.repeat(TAM_VERSION),
  error: null,
};
const SIN_PENDIENTES: ReciboTrabajo = {
  ...RECIBO,
  accion: 'reintentar-pendientes',
  resultado: 'sin-pendientes',
  veredicto: null,
  huellaPaquete: null,
};
const RECHAZADO: ReciboTrabajo = {
  ...RECIBO,
  resultado: 'rechazado',
  veredicto: null,
  huellaPaquete: null,
  error: 'actualizacion_no_completada',
};
const NO_ADMITIDO: ReciboTrabajo = { ...RECHAZADO, veredicto: 'ámbar', error: 'actualizacion_no_admitida' };
const OBSERVACION = { version: 1, recibo: RECIBO, huellaRecibo: 'c'.repeat(TAM_HUELLA), datos: DATOS };
function resultado(recibo: ReciboTrabajo, estado: EstadoDatosPanel | null) {
  return { version: 2, ...recibo, estado };
}

test('observación conserva strings, valores y orden, con copias completas e inmutables', () => {
  const entrada = JSON.parse(JSON.stringify(OBSERVACION));
  const salida = leerObservacionDatosTrabajo(entrada);
  assert.deepEqual(salida, OBSERVACION);
  assert.notEqual(salida.recibo, entrada.recibo);
  assert.notEqual(salida.datos, entrada.datos);
  assert.notEqual(salida.datos.fuentes, entrada.datos.fuentes);
  assert.ok(Object.isFrozen(salida));
  assert.ok(Object.isFrozen(salida.recibo));
  assert.ok(Object.isFrozen(salida.datos.modulos));
  assert.ok(Object.isFrozen(salida.datos.modulos[0]?.ultimaVersionBuena));
  entrada.datos.fuentes.reverse();
  assert.deepEqual(salida.datos, DATOS);
});

test('lector común y receptor conservan las combinaciones de recibo y datos admitidas', () => {
  for (const [recibo, datos] of [
    [RECIBO, DATOS],
    [SIN_PENDIENTES, DATOS],
    [{ ...SIN_PENDIENTES, accion: 'comprobar-programada' }, DATOS],
    [RECHAZADO, null],
    [{ ...RECHAZADO, error: 'candidato_no_verificable' }, null],
    [NO_ADMITIDO, DATOS],
  ] as const) {
    assert.deepEqual(leerDatosDeRecibo(recibo, datos), datos);
    assert.deepEqual(leerResultado(resultado(recibo, datos)), { recibo, estado: datos });
    if (datos === null) {
      assert.throws(() => leerObservacionDatosTrabajo({ ...OBSERVACION, recibo, datos }));
    } else {
      assert.deepEqual(leerObservacionDatosTrabajo({ ...OBSERVACION, recibo, datos }).datos, datos);
    }
  }
});

test('lector común y receptor rechazan combinaciones incoherentes y observaciones futuras', () => {
  const paqueteRojo = leerEstadoDatosPanel({
    ...DATOS,
    modulos: DATOS.modulos.map((m) =>
      m.id === 'paquete' ? { ...m, veredicto: 'rojo', fallos: 1, proximoReintento: '2026-10-17T12:00:00Z' } : m,
    ),
  });
  for (const [recibo, datos] of [
    [RECIBO, null],
    [RECIBO, paqueteRojo],
    [RECIBO, { ...DATOS, observadoEn: '2026-10-16T12:00:02Z' }],
    [SIN_PENDIENTES, null],
    [{ ...SIN_PENDIENTES, accion: 'actualizar-datos' }, DATOS],
    [RECHAZADO, DATOS],
    [{ ...RECHAZADO, veredicto: 'rojo' }, null],
    [NO_ADMITIDO, null],
    [{ ...NO_ADMITIDO, veredicto: null }, DATOS],
  ] as const) {
    assert.throws(() => leerDatosDeRecibo(recibo, datos));
    assert.throws(() => leerResultado(resultado(recibo, datos)));
  }
  assert.throws(() => leerDatosDeRecibo(RECIBO, undefined));
});

test('lectores rechazan claves desconocidas, versiones, hashes, prototipos y accesores sin ejecutarlos', () => {
  let accesos = 0;
  const conAccesor = (entrada: object, clave: string) =>
    Object.defineProperty(Array.isArray(entrada) ? [...entrada] : { ...entrada }, clave, {
      enumerable: true,
      get() {
        accesos++;
        throw new Error('accesor ejecutado');
      },
    });
  for (const entrada of [
    null,
    { ...OBSERVACION, version: 2 },
    { ...OBSERVACION, extra: true },
    { ...OBSERVACION, huellaRecibo: 'C'.repeat(TAM_HUELLA) },
    { ...OBSERVACION, huellaRecibo: null },
    { ...OBSERVACION, [Symbol('privado')]: true },
    Object.assign(Object.create({ heredado: true }), OBSERVACION),
    conAccesor(OBSERVACION, 'datos'),
    { ...OBSERVACION, recibo: conAccesor(RECIBO, 'terminadoEn') },
    { ...OBSERVACION, datos: conAccesor(DATOS, 'fuentes') },
    { ...OBSERVACION, datos: { ...DATOS, toJSON: () => ({}) } },
    { ...OBSERVACION, datos: { ...DATOS, fuentes: conAccesor(DATOS.fuentes, '0') } },
  ]) {
    assert.throws(() => leerObservacionDatosTrabajo(entrada));
  }
  assert.throws(() => leerDatosDeRecibo(conAccesor(RECIBO, 'resultado') as ReciboTrabajo, DATOS));
  assert.equal(accesos, 0);
});

test('límites son bytes UTF8 y los lectores rechazan entradas y sobres desmedidos', () => {
  assert.ok(MAX_OBSERVACION_DATOS_BYTES > MAX_DATOS_TRABAJO_BYTES);
  const demasiadoGrande = { ...DATOS, observadoEn: 'é'.repeat(MAX_DATOS_TRABAJO_BYTES) };
  assert.ok(new TextEncoder().encode(JSON.stringify(demasiadoGrande)).byteLength > MAX_DATOS_TRABAJO_BYTES);
  assert.throws(() => leerDatosDeRecibo(RECIBO, demasiadoGrande));
  assert.throws(() => leerObservacionDatosTrabajo({ ...OBSERVACION, datos: demasiadoGrande }));
  assert.throws(() =>
    leerObservacionDatosTrabajo({ ...OBSERVACION, huellaRecibo: 'é'.repeat(MAX_OBSERVACION_DATOS_BYTES) }),
  );
});

test('la instantánea v2 conserva evidencia y microsegundos dentro del segundo de cierre, nunca del siguiente', () => {
  const entrada = JSON.parse(readFileSync(new URL('../fixtures/estado-datos-v2.json', import.meta.url), 'utf8'));
  const recibo = { ...RECIBO, terminadoEn: '2026-10-16T12:00:00Z' };
  const datos = leerEstadoDatosPanel(entrada);
  assert.deepEqual(leerDatosDeRecibo(recibo, datos), entrada);
  assert.deepEqual(leerResultado(resultado(recibo, datos)), { recibo, estado: entrada });
  assert.deepEqual(leerObservacionDatosTrabajo({ ...OBSERVACION, recibo, datos }).datos, entrada);
  assert.throws(() => leerDatosDeRecibo(recibo, { ...datos, observadoEn: '2026-10-16T12:00:01.000001Z' }));
});

test('v4 atraviesa resultado y recibo sin inventar evidencia ni renovar la observación', () => {
  const datos = leerEstadoDatosPanel(instantaneaSaludV4());
  const recibo = { ...SIN_PENDIENTES, terminadoEn: CORTE_SALUD };
  const observacion = { ...OBSERVACION, recibo, datos };
  assert.deepEqual(leerDatosDeRecibo(recibo, datos), datos);
  assert.deepEqual(leerResultado(resultado(recibo, datos)), { recibo, estado: datos });
  assert.deepEqual(leerObservacionDatosTrabajo(observacion), observacion);
  assert.ok(Object.isFrozen(leerObservacionDatosTrabajo(observacion).datos));
});

test('v3 exige campo privado explícito, fechas no futuras y mantiene v2 como ausencia', () => {
  const catalogo = catalogoPrivado();
  const nuevo = { ...resultado(RECIBO, DATOS), version: VERSION_CATALOGO_PRIVADO, catalogo };
  assert.deepEqual(leerResultado(nuevo).catalogo, catalogo);
  assert.equal(leerResultado(resultado(RECIBO, DATOS)).catalogo, undefined);
  assert.throws(() => leerResultado({ ...resultado(RECIBO, DATOS), version: VERSION_CATALOGO_PRIVADO }));
  assert.throws(() => leerResultado({ ...nuevo, catalogo: { ...catalogo, version: true } }));
  assert.throws(() => leerResultado({ ...nuevo, catalogo: { ...catalogo, corteRegistro: '2027-01-01T00:00:00Z' } }));
  assert.throws(() => leerResultado({ ...nuevo, catalogo: { ...catalogo, corteRegistro: '2026-02-31T00:00:00Z' } }));
  assert.throws(() => leerResultado({ ...resultado(RECHAZADO, null), version: VERSION_CATALOGO_PRIVADO, catalogo }));
});
