// Fronteras y orden de las convocatorias, sin catálogos ni servicios externos.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type ClavesDeOrden,
  diasEntreFechas,
  esADistancia,
  esCopiaAntigua,
  MAX_DIAS_COPIA_CURSOS,
  momentoDelCurso,
  ordenDeConvocatorias,
} from '../src/vigencia-cursos.ts';

/** Día fijo con sus dos fronteras inmediatas, tomado de las pruebas de formación del origen. */
const HOY = '2026-10-10';
const AYER = '2026-10-09';
const MANANA = '2026-10-11';
/** Umbral observable que fijan las fronteras de esta prueba. */
const DIAS_LIMITE_ESPERADO = 30;

/** Claves mínimas de una convocatoria; el nombre no decide la fecha ni el momento. */
function convocatoria(momento: ClavesDeOrden['momento'], inicio: string | null, nombre: string): ClavesDeOrden {
  return { momento, inicio, nombre };
}

/** Nombres en el orden del comparador, sin mutar la lista recibida. */
function nombresOrdenados(cursos: readonly ClavesDeOrden[]): string[] {
  return [...cursos].sort(ordenDeConvocatorias).map(({ nombre }) => nombre);
}

test('el inicio es inclusivo y el fin excluye solo los días posteriores; el fin pasado tiene prioridad', () => {
  const casos: readonly [string | null, string | null, ReturnType<typeof momentoDelCurso>][] = [
    [MANANA, '2026-12-01', 'por-iniciar'],
    [MANANA, null, 'por-iniciar'],
    [HOY, '2026-12-01', 'iniciado'],
    [AYER, null, 'iniciado'],
    ['2026-09-01', HOY, 'iniciado'],
    ['2026-09-01', AYER, 'terminado'],
    [null, AYER, 'terminado'],
    [null, HOY, 'sin-fecha'],
    [null, MANANA, 'sin-fecha'],
    [null, null, 'sin-fecha'],
    [MANANA, AYER, 'terminado'],
  ];
  for (const [inicio, fin, esperado] of casos) {
    assert.equal(momentoDelCurso({ inicio, fin }, HOY), esperado, `del ${inicio} al ${fin}`);
  }
});

test('el momento conserva las fronteras de años y del día bisiesto', () => {
  assert.equal(momentoDelCurso({ inicio: '2024-02-29', fin: '2024-03-01' }, '2024-02-28'), 'por-iniciar');
  assert.equal(momentoDelCurso({ inicio: '2024-02-29', fin: '2024-03-01' }, '2024-02-29'), 'iniciado');
  assert.equal(momentoDelCurso({ inicio: '2024-02-29', fin: '2024-03-01' }, '2024-03-02'), 'terminado');
  assert.equal(momentoDelCurso({ inicio: '2027-01-01', fin: null }, '2026-12-31'), 'por-iniciar');
  assert.equal(momentoDelCurso({ inicio: '0000-01-01', fin: '9999-12-31' }, HOY), 'iniciado');
});

test('el orden prioriza momento e inicio antes que nombre y deja los inicios desconocidos al final del momento', () => {
  const cursos = [
    convocatoria('sin-fecha', null, 'A sin fecha'),
    convocatoria('iniciado', AYER, 'A iniciado'),
    convocatoria('por-iniciar', null, 'A inicio desconocido'),
    convocatoria('por-iniciar', '2026-11-01', 'A noviembre'),
    convocatoria('por-iniciar', MANANA, 'Z mañana'),
    convocatoria('iniciado', '2026-01-01', 'Z iniciado'),
  ];
  assert.deepEqual(nombresOrdenados(cursos), [
    'Z mañana',
    'A noviembre',
    'A inicio desconocido',
    'Z iniciado',
    'A iniciado',
    'A sin fecha',
  ]);
  assert.equal(cursos[0]?.nombre, 'A sin fecha', 'el comparador no muta las claves');
});

test('a igual momento e inicio, los nombres se ordenan en castellano y los empates conservan su entrada', () => {
  assert.deepEqual(
    nombresOrdenados(['O', 'Ñ', 'N', 'Z', 'Á'].map((nombre) => convocatoria('por-iniciar', MANANA, nombre))),
    ['Á', 'N', 'Ñ', 'O', 'Z'],
  );
  const claves = convocatoria('sin-fecha', null, 'Curso');
  assert.equal(ordenDeConvocatorias(claves, { ...claves }), 0);
  const empates = [
    { ...claves, id: 'segundo' },
    { ...claves, id: 'primero' },
  ];
  assert.deepEqual(
    empates.sort(ordenDeConvocatorias).map(({ id }) => id),
    ['segundo', 'primero'],
  );
});

test('el comparador es reflexivo, antisimétrico y transitivo en los tres momentos y ante ausencia de inicio', () => {
  const muestra = [
    convocatoria('por-iniciar', MANANA, 'A'),
    convocatoria('por-iniciar', MANANA, 'Ñ'),
    convocatoria('por-iniciar', null, 'Z'),
    convocatoria('por-iniciar', '9999-12-31', 'A'),
    convocatoria('iniciado', AYER, 'A'),
    convocatoria('iniciado', null, 'Ñ'),
    convocatoria('sin-fecha', null, 'Z'),
    convocatoria('sin-fecha', '9999-01-01', 'A'),
  ];
  for (const a of muestra) {
    assert.equal(ordenDeConvocatorias(a, a), 0);
    for (const b of muestra) {
      assert.equal(Math.sign(ordenDeConvocatorias(a, b)) + Math.sign(ordenDeConvocatorias(b, a)), 0);
      for (const c of muestra) {
        if (ordenDeConvocatorias(a, b) <= 0 && ordenDeConvocatorias(b, c) <= 0) {
          assert.ok(ordenDeConvocatorias(a, c) <= 0);
        }
      }
    }
  }
});

test('solo las dos modalidades exactas del Consorci son a distancia, incluidos acentos y caja', () => {
  for (const modalidad of ['Teleformació', 'Adaptada a Aula virtual']) {
    assert.equal(esADistancia(modalidad), true, modalidad);
  }
  for (const modalidad of [
    'Presencial',
    'Mixta',
    '',
    'Desconocida',
    'teleformació',
    'Teleformacion',
    'Teleformació ',
    ' Teleformació',
    'Adaptada a aula virtual',
    'Adaptada a Aula Virtual',
    'constructor',
  ]) {
    assert.equal(esADistancia(modalidad), false, modalidad);
  }
});

test('los días ISO se cuentan en UTC: mismo día, dirección, bisiestos, siglos y cambios de horario', () => {
  const casos: readonly [string, string, number][] = [
    [HOY, HOY, 0],
    [AYER, HOY, 1],
    [HOY, AYER, -1],
    ['2024-02-28', '2024-03-01', 2],
    ['2025-02-28', '2025-03-01', 1],
    ['1900-02-28', '1900-03-01', 1],
    ['2000-02-28', '2000-03-01', 2],
    ['2026-03-28', '2026-03-30', 2],
    ['2026-10-24', '2026-10-26', 2],
    ['2026-12-31', '2027-01-01', 1],
    ['0000-01-01', '0000-01-02', 1],
    ['9999-12-30', '9999-12-31', 1],
  ];
  for (const [desde, hasta, esperado] of casos) {
    assert.equal(diasEntreFechas(desde, hasta), esperado, `${desde} → ${hasta}`);
  }
});

test('la copia es antigua después de 30 días, nunca en el límite ni si su fecha es posterior a hoy', () => {
  assert.equal(MAX_DIAS_COPIA_CURSOS, DIAS_LIMITE_ESPERADO);
  const casos: readonly [string, string, boolean][] = [
    ['2026-09-12', '2026-10-12', false],
    ['2026-09-11', '2026-10-12', true],
    [HOY, HOY, false],
    [MANANA, HOY, false],
    ['2024-02-01', '2024-03-02', false],
    ['2024-02-01', '2024-03-03', true],
  ];
  for (const [copia, hoy, esperado] of casos) {
    assert.equal(esCopiaAntigua(copia, hoy), esperado, `${copia} → ${hoy}`);
  }
});

test('las fechas imposibles, ilegibles o ajenas a AAAA-MM-DD producen NaN y activan el aviso conservador', () => {
  for (const invalida of [
    '',
    'sin fecha',
    '2026-13-01',
    '2026-01-32',
    'NaN',
    '2026-02-30',
    '2026-02-31',
    '2025-02-29',
    '1900-02-29',
    '2026-2-1',
    '2026/02/01',
    '2026-02-01T00:00:00Z',
    '2026-02-01\n',
  ]) {
    assert.ok(Number.isNaN(diasEntreFechas(invalida, HOY)), invalida);
    assert.ok(Number.isNaN(diasEntreFechas(HOY, invalida)), invalida);
    assert.equal(esCopiaAntigua(invalida, HOY), true, invalida);
    assert.equal(esCopiaAntigua(HOY, invalida), true, invalida);
  }
});

test('en el contrato de orden, un inicio ausente va detrás de cualquier fecha hasta el año 9999', () => {
  // Caso del contrato público: los consumidores actuales derivan el momento de las fechas y no forman esta mezcla.
  for (const momento of ['por-iniciar', 'iniciado', 'sin-fecha'] as const) {
    const sinFecha = convocatoria(momento, null, 'A sin fecha');
    for (const inicio of ['0000-01-01', HOY, '9999-01-01', '9999-12-31']) {
      const conFecha = convocatoria(momento, inicio, 'Z con fecha');
      assert.ok(ordenDeConvocatorias(conFecha, sinFecha) < 0, inicio);
      assert.ok(ordenDeConvocatorias(sinFecha, conFecha) > 0, inicio);
    }
    assert.equal(ordenDeConvocatorias(sinFecha, { ...sinFecha }), 0);
    assert.ok(ordenDeConvocatorias(sinFecha, { ...sinFecha, nombre: 'Z sin fecha' }) < 0);
  }
});
