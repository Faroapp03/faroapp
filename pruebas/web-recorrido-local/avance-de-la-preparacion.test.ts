import assert from 'node:assert/strict';
import { test } from 'node:test';
import { leerAvanceDeLaCopia } from '../../web/scripts/paquete-sin-conexion.js';
import {
  porcentajeDeLaPreparacion,
  queSeEstaHaciendo,
  umbralPasado,
} from '../../web/scripts/recorrido/avance-de-la-preparacion.js';

const CIEN = 100;
const ARCHIVOS = 33;
const MITAD = 16;
const PORCENTAJE_MITAD = 41;
const PORCENTAJE_COPIA_COMPLETA = 85;
const PORCENTAJE_BYTES = 39;

type Copia = {
  archivos: number | null;
  guardados: number | null;
  bytes?: number | null;
  bytesTotales?: number | null;
  exacto?: boolean;
  completo: boolean;
} | null;
const estado = (copia: Copia, fases: string[] = [], listo = false, reintentando = false) => ({
  copia,
  fases: new Set(fases),
  listo,
  reintentando,
});
const MB = 1_000_000;
const TOTAL = 63_794_603;
const HECHOS = 29_400_000;

test('sin avance contado no hay porcentaje: el aviso se queda con su texto', () => {
  assert.equal(porcentajeDeLaPreparacion(estado(null)), null);
  assert.equal(porcentajeDeLaPreparacion(estado({ archivos: null, guardados: null, completo: false })), null);
});

test('la copia cuenta en proporción a sus archivos guardados, dentro de su parte', () => {
  assert.equal(porcentajeDeLaPreparacion(estado({ archivos: ARCHIVOS, guardados: 0, completo: false })), 0);
  const mitad = porcentajeDeLaPreparacion(estado({ archivos: ARCHIVOS, guardados: MITAD, completo: false }));
  assert.equal(mitad, PORCENTAJE_MITAD);
  const copiada = porcentajeDeLaPreparacion(estado({ archivos: ARCHIVOS, guardados: ARCHIVOS, completo: false }));
  assert.equal(copiada, PORCENTAJE_COPIA_COMPLETA);
  assert.equal(porcentajeDeLaPreparacion(estado({ archivos: null, guardados: null, completo: true })), copiada);
});

test('cada fase del motor suma su peso sin retroceder, sin pasar de 99 hasta la primera respuesta', () => {
  const copia = { archivos: ARCHIVOS, guardados: ARCHIVOS, completo: true };
  const inicial = porcentajeDeLaPreparacion(estado(copia)) ?? -1;
  let anterior = inicial;
  const fases: string[] = [];
  for (const fase of ['comprobado', 'motor', 'datos', 'vectores', 'clasificador']) {
    fases.push(fase);
    const ahora = porcentajeDeLaPreparacion(estado(copia, fases)) ?? -1;
    assert.ok(ahora >= anterior, `la fase ${fase} no hace retroceder el porcentaje`);
    assert.ok(ahora < CIEN);
    anterior = ahora;
  }
  assert.ok(anterior > inicial, 'las fases hacen avanzar el porcentaje');
  assert.equal(porcentajeDeLaPreparacion(estado(copia, fases, true)), CIEN);
});

test('una fase desconocida no suma y una fase contada da la copia por hecha', () => {
  const copia = { archivos: ARCHIVOS, guardados: MITAD, completo: false };
  assert.equal(
    porcentajeDeLaPreparacion(estado(copia, ['inventada'])),
    porcentajeDeLaPreparacion(estado({ archivos: null, guardados: null, completo: true })),
  );
});

test('lo que se está haciendo: archivos mientras se copia y después la fase que falta', () => {
  assert.deepEqual(queSeEstaHaciendo(estado({ archivos: ARCHIVOS, guardados: MITAD, completo: false })), {
    tipo: 'archivos',
    guardados: MITAD,
    archivos: ARCHIVOS,
  });
  assert.deepEqual(queSeEstaHaciendo(estado({ archivos: ARCHIVOS, guardados: ARCHIVOS, completo: true })), {
    tipo: 'motor',
  });
  assert.deepEqual(queSeEstaHaciendo(estado(null, ['comprobado', 'motor'])), { tipo: 'datos' });
  assert.deepEqual(queSeEstaHaciendo(estado(null, ['motor', 'datos'])), { tipo: 'ia' });
  assert.deepEqual(queSeEstaHaciendo(estado(null, [], true)), { tipo: 'listo' });
});

test('el lector de pantalla solo oye el 25, el 50, el 75 y el 100 %', () => {
  const CUARTO = 25;
  const MEDIO = 50;
  const TRES_CUARTOS = 75;
  assert.equal(umbralPasado(0, CUARTO - 1), null);
  assert.equal(umbralPasado(0, CUARTO), CUARTO);
  assert.equal(umbralPasado(CUARTO, MEDIO - 1), null);
  assert.equal(umbralPasado(CUARTO, TRES_CUARTOS + 1), TRES_CUARTOS);
  assert.equal(umbralPasado(TRES_CUARTOS, CIEN), CIEN);
  assert.equal(umbralPasado(CIEN, CIEN), null);
});

test('la página solo entiende los avances bien formados del service worker', () => {
  const progreso = { type: 'PROGRESO_DEL_PAQUETE', version: 'v', archivos: ARCHIVOS, guardados: MITAD };
  assert.deepEqual(leerAvanceDeLaCopia(progreso), {
    archivos: ARCHIVOS,
    guardados: MITAD,
    bytes: null,
    bytesTotales: null,
    exacto: false,
    completo: false,
    primerAnalisis: null,
  });
  assert.deepEqual(leerAvanceDeLaCopia({ type: 'ESTADO_DEL_PAQUETE', version: 'v', completo: true }), {
    archivos: null,
    guardados: null,
    bytes: null,
    bytesTotales: null,
    exacto: false,
    completo: true,
    primerAnalisis: null,
  });
  for (const malo of [
    { ...progreso, guardados: ARCHIVOS + 1 },
    { ...progreso, archivos: 0, guardados: 0 },
    { ...progreso, guardados: -1 },
    { ...progreso, guardados: '3' },
    { type: 'ESTADO_DEL_PAQUETE', completo: true },
    { type: 'OTRO' },
    null,
    'PROGRESO_DEL_PAQUETE',
  ]) {
    assert.equal(leerAvanceDeLaCopia(malo), null, JSON.stringify(malo));
  }
});

test('con bytes, la copia cuenta megas y no archivos: un archivo grande pesa lo que pesa', () => {
  const copia = { archivos: ARCHIVOS, guardados: 1, bytes: HECHOS, bytesTotales: TOTAL, exacto: true, completo: false };
  assert.equal(porcentajeDeLaPreparacion(estado(copia)), PORCENTAJE_BYTES);
  assert.deepEqual(queSeEstaHaciendo(estado(copia)), {
    tipo: 'megas',
    hechos: Math.floor(HECHOS / MB),
    total: Math.round(TOTAL / MB),
  });
  const aproximada = { ...copia, exacto: false };
  assert.equal(queSeEstaHaciendo(estado(aproximada)).tipo, 'archivos', 'sin todos los tamaños no habla de megas');
  assert.equal(porcentajeDeLaPreparacion(estado(aproximada)), porcentajeDeLaPreparacion(estado(copia)));
});

test('si un intento falla, se dice que se reintenta hasta el siguiente avance', () => {
  const copia = { archivos: ARCHIVOS, guardados: ARCHIVOS, completo: true };
  assert.deepEqual(queSeEstaHaciendo(estado(copia, ['comprobado', 'motor'], false, true)), { tipo: 'reintento' });
  assert.deepEqual(queSeEstaHaciendo(estado(copia, ['comprobado', 'motor'])), { tipo: 'datos' });
  assert.deepEqual(queSeEstaHaciendo(estado(copia, [], true, true)), { tipo: 'listo' });
});

test('la página lee los bytes del progreso y desconfía de los imposibles', () => {
  const progreso = {
    type: 'PROGRESO_DEL_PAQUETE',
    version: 'v',
    archivos: ARCHIVOS,
    guardados: MITAD,
    bytes: HECHOS,
    bytesTotales: TOTAL,
    exacto: true,
  };
  assert.deepEqual(leerAvanceDeLaCopia(progreso), {
    archivos: ARCHIVOS,
    guardados: MITAD,
    bytes: HECHOS,
    bytesTotales: TOTAL,
    exacto: true,
    completo: false,
    primerAnalisis: null,
  });
  const imposible = leerAvanceDeLaCopia({ ...progreso, bytes: TOTAL + 1 });
  assert.equal(imposible?.bytes, null);
  assert.equal(imposible?.exacto, false);
});

test('la barra cuenta lo del primer análisis aparte de la copia completa, que sigue sin estarlo', () => {
  const progreso = {
    type: 'PROGRESO_DEL_PAQUETE',
    version: 'v',
    archivos: 38,
    guardados: 11,
    bytes: 31_000_000,
    bytesTotales: 49_600_000,
    exacto: true,
    primerAnalisis: { archivos: 10, guardados: 10, bytes: 31_000_000, bytesTotales: 31_000_000 },
  };
  const avance = leerAvanceDeLaCopia(progreso);
  assert.equal(avance?.completo, false, 'con el primer análisis guardado, la copia completa aún no lo está');
  assert.deepEqual(avance?.primerAnalisis, {
    archivos: 10,
    guardados: 10,
    bytes: 31_000_000,
    bytesTotales: 31_000_000,
  });
  const preparacion = { copia: avance, fases: new Set<string>(), listo: false };
  // La parte de la copia de la barra (PARTE_DE_LA_COPIA, el 85 %), entera con lo del primer análisis.
  const parteDeLaCopia = 85;
  assert.equal(porcentajeDeLaPreparacion(preparacion), parteDeLaCopia, 'la barra mide lo que espera la conversación');
  const mitad = leerAvanceDeLaCopia({
    ...progreso,
    primerAnalisis: { archivos: 10, guardados: 5, bytes: 15_500_000, bytesTotales: 31_000_000 },
  });
  assert.deepEqual(queSeEstaHaciendo({ copia: mitad, fases: new Set<string>(), listo: false }), {
    tipo: 'megas',
    hechos: 15,
    total: 31,
  });
  assert.equal(
    leerAvanceDeLaCopia({ ...progreso, primerAnalisis: { archivos: 2, guardados: 3 } })?.primerAnalisis,
    null,
  );
});
