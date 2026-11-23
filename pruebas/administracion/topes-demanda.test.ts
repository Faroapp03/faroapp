/** Decisión de topes de los ciclos a demanda: tabla de casos con hora e historial dados, sin reloj ni red. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type AccionDemanda,
  type ConfiguracionDemanda,
  leerConfiguracionDemanda,
} from '../../src/administracion/configuracion-demanda.ts';
import {
  decidirTopes,
  MARGEN_MIN_POR_TRABAJO,
  type TrabajoDelHistorial,
} from '../../src/administracion/topes-demanda.ts';
import { MS_POR_MINUTO } from '../../src/comun/tiempo.ts';

const SEPARACION_MIN = 120;
const RESERVA_MIN = 45;
/** Lo que se reserva por ciclo programado: lo declarado más el margen de lo que no se mide. */
const CICLO_MIN = RESERVA_MIN + MARGEN_MIN_POR_TRABAJO;
const PRESUPUESTO_MIN = 2_115;
function configuracion(cambios: Record<string, unknown> = {}): ConfiguracionDemanda {
  const lectura = leerConfiguracionDemanda(
    JSON.stringify({
      version: 1,
      habilitada: true,
      actores: ['1001'],
      separacionMin: SEPARACION_MIN,
      maxDia: 2,
      maxMes: { 'actualizar-datos': 2, 'comprobar-vencidas': 6, 'actualizar-cursos': 10 },
      presupuestoMinMes: PRESUPUESTO_MIN,
      reservaProgramadaMin: RESERVA_MIN,
      ...cambios,
    }),
  );
  assert.equal(lectura.estado, 'abierta');
  return lectura.configuracion;
}
const C = configuracion();
/** 10 de noviembre (mes de 30 días): quedan 20 días después de hoy. */
const AHORA = Date.parse('2026-11-10T12:00:00Z');
const t = (iso: string, accion: AccionDemanda | null, minutos: number | null = 30): TrabajoDelHistorial => ({
  en: Date.parse(iso),
  accion,
  minutos,
});
const antes = (minutos: number, accion: AccionDemanda = 'actualizar-cursos') => ({
  en: AHORA - minutos * MS_POR_MINUTO,
  accion,
  minutos: 30,
});
const ADMITIDA = { decision: 'admitida' };
const rechazo = (motivo: string) => ({ decision: 'rechazada', motivo });

test('sin historial se admite cada acción de la lista cerrada; otra acción es un error', () => {
  for (const accion of ['actualizar-datos', 'comprobar-vencidas', 'actualizar-cursos'] as const) {
    assert.deepEqual(decidirTopes(C, accion, AHORA, []), ADMITIDA);
  }
  assert.throws(() => decidirTopes(C, 'comprobar-programada' as AccionDemanda, AHORA, []), /no válidos/);
});

test('separación: una solicitud de hace menos de la separación rechaza; justo la separación, admite', () => {
  assert.deepEqual(decidirTopes(C, 'actualizar-cursos', AHORA, [antes(SEPARACION_MIN - 1)]), rechazo('separacion'));
  assert.deepEqual(decidirTopes(C, 'actualizar-cursos', AHORA, [antes(SEPARACION_MIN)]), ADMITIDA);
  // Vale entre acciones distintas, y un ciclo programado reciente no la impone.
  assert.deepEqual(decidirTopes(C, 'actualizar-datos', AHORA, [antes(1, 'actualizar-cursos')]), rechazo('separacion'));
  assert.deepEqual(decidirTopes(C, 'actualizar-datos', AHORA, [{ ...antes(1), accion: null }]), ADMITIDA);
});

test('tope del día: cuenta las solicitudes del día UTC, no las de ayer ni los programados', () => {
  const dos = [t('2026-11-10T01:00:00Z', 'actualizar-cursos'), t('2026-11-10T04:00:00Z', 'comprobar-vencidas')];
  assert.deepEqual(decidirTopes(C, 'actualizar-datos', AHORA, dos), rechazo('tope_dia'));
  assert.deepEqual(decidirTopes(C, 'actualizar-datos', AHORA, dos.slice(1)), ADMITIDA);
  const ayer = [t('2026-11-09T22:00:00Z', 'actualizar-cursos'), t('2026-11-09T23:30:00Z', 'actualizar-cursos')];
  assert.deepEqual(decidirTopes(C, 'actualizar-datos', AHORA, ayer), ADMITIDA);
  const conProgramado = [...dos.slice(1), t('2026-11-10T04:15:00Z', null)];
  assert.deepEqual(decidirTopes(C, 'actualizar-datos', AHORA, conProgramado), ADMITIDA);
});

test('tope del mes: por acción; un cero cierra esa acción y deja las demás', () => {
  const datos = [t('2026-11-02T10:00:00Z', 'actualizar-datos'), t('2026-11-05T10:00:00Z', 'actualizar-datos')];
  assert.deepEqual(decidirTopes(C, 'actualizar-datos', AHORA, datos), rechazo('tope_mes'));
  assert.deepEqual(decidirTopes(C, 'actualizar-datos', AHORA, datos.slice(1)), ADMITIDA);
  assert.deepEqual(decidirTopes(C, 'actualizar-cursos', AHORA, datos), ADMITIDA);
  const cerrada = configuracion({
    maxMes: { 'actualizar-datos': 0, 'comprobar-vencidas': 6, 'actualizar-cursos': 10 },
  });
  assert.deepEqual(decidirTopes(cerrada, 'actualizar-datos', AHORA, []), rechazo('tope_mes'));
  assert.deepEqual(decidirTopes(cerrada, 'actualizar-cursos', AHORA, []), ADMITIDA);
});

/** Noviembre hasta el día 10: nueve programados de 80 minutos, el de hoy de 40 y una solicitud de cursos. */
const DIAS_ANTERIORES = 9;
const PROGRAMADO_MIN = 80;
const PROGRAMADO_DE_HOY_MIN = 40;
const CURSOS_MIN = 95;
/** Días de noviembre que quedan después del 10, y días de diciembre. */
const DIAS_TRAS_HOY = 20;
const DIAS_DE_DICIEMBRE = 31;
const GASTADO = DIAS_ANTERIORES * PROGRAMADO_MIN + PROGRAMADO_DE_HOY_MIN + CURSOS_MIN;
function mesGastado(cursos = CURSOS_MIN, programadoDeHoy = true): TrabajoDelHistorial[] {
  const dias = Array.from({ length: DIAS_ANTERIORES }, (_, i) =>
    t(`2026-11-0${i + 1}T04:15:00Z`, null, PROGRAMADO_MIN),
  );
  return [
    ...dias,
    ...(programadoDeHoy ? [t('2026-11-10T04:15:00Z', null, PROGRAMADO_DE_HOY_MIN)] : []),
    t('2026-11-05T10:00:00Z', 'actualizar-cursos', cursos),
  ];
}
/** Con el presupuesto justo para `necesario` se admite; con un minuto menos, se rechaza por presupuesto. */
function limiteExacto(necesario: number, accion: AccionDemanda, ahora: number, historial: TrabajoDelHistorial[]) {
  assert.deepEqual(decidirTopes(configuracion({ presupuestoMinMes: necesario }), accion, ahora, historial), ADMITIDA);
  assert.deepEqual(
    decidirTopes(configuracion({ presupuestoMinMes: necesario - 1 }), accion, ahora, historial),
    rechazo('presupuesto'),
  );
}

test('presupuesto: reserva los ciclos programados que quedan; caber en lo que sobra hoy no basta', () => {
  // Lo gastado, la solicitud estimada en un ciclo programado y los 20 días que quedan suman justo el presupuesto.
  assert.equal(GASTADO + CICLO_MIN + DIAS_TRAS_HOY * CICLO_MIN, PRESUPUESTO_MIN);
  assert.deepEqual(decidirTopes(C, 'comprobar-vencidas', AHORA, mesGastado()), ADMITIDA);
  // Un minuto más cabría de sobra en lo que queda del presupuesto, pero dejaría sin minutos a los días que quedan.
  assert.ok(GASTADO + 1 + CICLO_MIN < PRESUPUESTO_MIN);
  assert.deepEqual(decidirTopes(C, 'comprobar-vencidas', AHORA, mesGastado(CURSOS_MIN + 1)), rechazo('presupuesto'));
});

test('presupuesto: si el programado de hoy no consta, también se reservan sus minutos', () => {
  const sinHoy = mesGastado(CURSOS_MIN, false);
  const necesario = GASTADO - PROGRAMADO_DE_HOY_MIN + CICLO_MIN + (DIAS_TRAS_HOY + 1) * CICLO_MIN;
  assert.ok(necesario > PRESUPUESTO_MIN, 'se ha gastado menos y aun así no cabe');
  assert.deepEqual(decidirTopes(C, 'comprobar-vencidas', AHORA, sinHoy), rechazo('presupuesto'));
  limiteExacto(necesario, 'comprobar-vencidas', AHORA, sinHoy);
});

test('presupuesto: lo no medido y la solicitud cuentan, como poco, lo más largo medido de su acción', () => {
  // La solicitud de cursos se estima en lo medido para cursos, no en la reserva de un programado.
  limiteExacto(GASTADO + CURSOS_MIN + DIAS_TRAS_HOY * CICLO_MIN, 'actualizar-cursos', AHORA, mesGastado());
  // Un trabajo sin medir cuenta como un ciclo programado.
  const enCurso = [...mesGastado(), t('2026-11-08T10:00:00Z', 'comprobar-vencidas', null)];
  limiteExacto(GASTADO + 2 * CICLO_MIN + DIAS_TRAS_HOY * CICLO_MIN, 'comprobar-vencidas', AHORA, enCurso);
});

test('fin de mes: el último día, con su programado hecho, no queda nada que reservar', () => {
  const ultimo = Date.parse('2026-11-30T20:00:00Z');
  const hecho = (minutos: number) => [t('2026-11-30T04:15:00Z', null, minutos)];
  assert.deepEqual(decidirTopes(C, 'comprobar-vencidas', ultimo, hecho(PRESUPUESTO_MIN - CICLO_MIN)), ADMITIDA);
  assert.deepEqual(
    decidirTopes(C, 'comprobar-vencidas', ultimo, hecho(PRESUPUESTO_MIN - CICLO_MIN + 1)),
    rechazo('presupuesto'),
  );
  // Un mes de 31 días todavía reserva un ciclo el día 30.
  const octubre = Date.parse('2026-10-30T20:00:00Z');
  const hechoOctubre = (minutos: number) => [t('2026-10-30T04:15:00Z', null, minutos)];
  const gastadoOctubre = PRESUPUESTO_MIN - 2 * CICLO_MIN;
  assert.deepEqual(decidirTopes(C, 'comprobar-vencidas', octubre, hechoOctubre(gastadoOctubre)), ADMITIDA);
  assert.deepEqual(
    decidirTopes(C, 'comprobar-vencidas', octubre, hechoOctubre(gastadoOctubre + 1)),
    rechazo('presupuesto'),
  );
});

test('comienzo de mes: la separación cruza la medianoche; topes y minutos del mes anterior no cuentan', () => {
  const primero = Date.parse('2026-12-01T00:10:00Z');
  const tarde = t('2026-11-30T23:30:00Z', 'actualizar-datos');
  assert.deepEqual(decidirTopes(C, 'actualizar-cursos', primero, [tarde]), rechazo('separacion'));
  // Noviembre agotó las solicitudes de datos y todo el presupuesto; el 1 de diciembre se empieza de cero.
  const noviembre = [
    t('2026-11-29T10:00:00Z', 'actualizar-datos', PRESUPUESTO_MIN),
    t('2026-11-30T21:00:00Z', 'actualizar-datos', PRESUPUESTO_MIN),
  ];
  assert.deepEqual(decidirTopes(C, 'actualizar-datos', primero, noviembre), ADMITIDA);
  // El primer día aún no consta su programado: se reservan los 31 días de diciembre.
  limiteExacto(CICLO_MIN + DIAS_DE_DICIEMBRE * CICLO_MIN, 'actualizar-datos', primero, noviembre);
});

test('presupuesto: cada ciclo programado reservado y la solicitud sin medidas suman el margen por trabajo', () => {
  // El último día, sin su programado: la solicitud y el ciclo de hoy cuestan cada uno lo declarado más el margen.
  const ultimo = Date.parse('2026-11-30T20:00:00Z');
  limiteExacto(2 * (RESERVA_MIN + MARGEN_MIN_POR_TRABAJO), 'comprobar-vencidas', ultimo, []);
  assert.deepEqual(
    decidirTopes(configuracion({ presupuestoMinMes: 2 * RESERVA_MIN }), 'comprobar-vencidas', ultimo, []),
    rechazo('presupuesto'),
  );
});

test('un historial imposible es un error, no una decisión', () => {
  const lejos = AHORA - MS_POR_MINUTO * SEPARACION_MIN;
  const defectuosos: TrabajoDelHistorial[][] = [
    [{ en: AHORA + 1, accion: 'actualizar-cursos', minutos: 1 }],
    [{ en: -1, accion: 'actualizar-cursos', minutos: 1 }],
    [{ en: AHORA, accion: 'comprobar-programada' as AccionDemanda, minutos: 1 }],
    [{ en: lejos, accion: null, minutos: -RESERVA_MIN }],
    [{ en: lejos, accion: null, minutos: RESERVA_MIN / 2 }],
  ];
  for (const historial of defectuosos) {
    assert.throws(() => decidirTopes(C, 'actualizar-cursos', AHORA, historial), /no válidos/);
  }
  assert.throws(() => decidirTopes(C, 'actualizar-cursos', Number.NaN, []), /no válidos/);
});
