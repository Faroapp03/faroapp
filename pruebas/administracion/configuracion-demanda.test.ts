/** Lectura estricta de FARO_ACTUALIZACION_DEMANDA: techos del código y vía cerrada ante cualquier defecto. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  configuracionDemandaDelEntorno,
  leerConfiguracionDemanda,
  TECHOS_DEMANDA,
} from '../../src/administracion/configuracion-demanda.ts';

/** Valores prudentes de ejemplo; el actor es sintético. */
const VARIABLE_PRUDENTE = {
  version: 1,
  habilitada: true,
  actores: ['1001'],
  separacionMin: 120,
  maxDia: 2,
  maxMes: { 'actualizar-datos': 2, 'comprobar-vencidas': 6, 'actualizar-cursos': 10 },
  presupuestoMinMes: 1_800,
  reservaProgramadaMin: 45,
};
const texto = (cambios: Record<string, unknown> = {}) => JSON.stringify({ ...VARIABLE_PRUDENTE, ...cambios });
const maxMes = (cambios: Record<string, unknown>) => ({ maxMes: { ...VARIABLE_PRUDENTE.maxMes, ...cambios } });
const INVALIDA = { estado: 'cerrada', motivo: 'invalida' };
/**
 * Los techos que pidió Manu el 23/11/2026 para probar a demanda sin esperar al reloj: una solicitud en cuanto termina
 * la anterior y hasta una cada cuarto de hora. Lo prudente lo fija la variable de cada instalación.
 */
const SEPARACION_MINIMA_PEDIDA = 1;
const MAX_DIA_PEDIDO = 96;

test('una variable válida abre la vía con una configuración inmutable', () => {
  const lectura = leerConfiguracionDemanda(texto());
  const { habilitada: _habilitada, ...configuracion } = VARIABLE_PRUDENTE;
  assert.deepEqual(lectura, { estado: 'abierta', configuracion });
  assert.ok(lectura.estado === 'abierta');
  assert.ok(Object.isFrozen(lectura.configuracion));
  assert.ok(Object.isFrozen(lectura.configuracion.actores) && Object.isFrozen(lectura.configuracion.maxMes));
  assert.deepEqual(configuracionDemandaDelEntorno({ FARO_ACTUALIZACION_DEMANDA: texto() }), lectura);
});

test('ausente o deshabilitada, la vía queda cerrada; deshabilitada se valida igual', () => {
  assert.deepEqual(leerConfiguracionDemanda(undefined), { estado: 'cerrada', motivo: 'ausente' });
  assert.deepEqual(configuracionDemandaDelEntorno({}), { estado: 'cerrada', motivo: 'ausente' });
  assert.deepEqual(leerConfiguracionDemanda(texto({ habilitada: false })), {
    estado: 'cerrada',
    motivo: 'deshabilitada',
  });
  assert.deepEqual(leerConfiguracionDemanda(texto({ habilitada: false, maxDia: TECHOS_DEMANDA.maxDia + 1 })), INVALIDA);
});

test('techos del código: la variable puede ser más prudente, nunca más permisiva', () => {
  const casos: readonly (readonly [Record<string, unknown>, Record<string, unknown>])[] = [
    [{ separacionMin: TECHOS_DEMANDA.separacionMinimaMin }, { separacionMin: TECHOS_DEMANDA.separacionMinimaMin - 1 }],
    [{ separacionMin: TECHOS_DEMANDA.separacionMaximaMin }, { separacionMin: TECHOS_DEMANDA.separacionMaximaMin + 1 }],
    [{ maxDia: TECHOS_DEMANDA.maxDia }, { maxDia: TECHOS_DEMANDA.maxDia + 1 }],
    [{ maxDia: 1 }, { maxDia: 0 }],
    [
      maxMes({ 'actualizar-cursos': TECHOS_DEMANDA.maxMesPorAccion }),
      maxMes({ 'actualizar-cursos': TECHOS_DEMANDA.maxMesPorAccion + 1 }),
    ],
    [maxMes({ 'actualizar-datos': 0 }), maxMes({ 'actualizar-datos': -1 })],
    [
      { presupuestoMinMes: TECHOS_DEMANDA.presupuestoMinMes },
      { presupuestoMinMes: TECHOS_DEMANDA.presupuestoMinMes + 1 },
    ],
    [{ presupuestoMinMes: 1 }, { presupuestoMinMes: 0 }],
    [
      { reservaProgramadaMin: TECHOS_DEMANDA.reservaProgramadaMin },
      { reservaProgramadaMin: TECHOS_DEMANDA.reservaProgramadaMin + 1 },
    ],
    [{ reservaProgramadaMin: 1 }, { reservaProgramadaMin: 0 }],
  ];
  assert.equal(TECHOS_DEMANDA.separacionMinimaMin, SEPARACION_MINIMA_PEDIDA);
  assert.equal(TECHOS_DEMANDA.maxDia, MAX_DIA_PEDIDO);
  for (const [dentro, fuera] of casos) {
    assert.equal(leerConfiguracionDemanda(texto(dentro)).estado, 'abierta', JSON.stringify(dentro));
    assert.deepEqual(leerConfiguracionDemanda(texto(fuera)), INVALIDA, JSON.stringify(fuera));
  }
});

test('cualquier otro defecto deja la vía cerrada como inválida, sin corregir valores', () => {
  const { maxDia: _maxDia, ...sinMaxDia } = VARIABLE_PRUDENTE;
  const { 'actualizar-cursos': _cursos, ...sinCursos } = VARIABLE_PRUDENTE.maxMes;
  const defectuosas = [
    '',
    '{',
    'null',
    '[]',
    JSON.stringify(sinMaxDia),
    texto({ sobrante: true }),
    texto({ version: 2 }),
    texto({ habilitada: 'true' }),
    texto({ separacionMin: 120.5 }),
    texto({ separacionMin: '120' }),
    texto({ maxDia: null }),
    texto({ maxMes: sinCursos }),
    texto(maxMes({ 'comprobar-programada': 1 })),
    texto({ maxMes: Object.values(VARIABLE_PRUDENTE.maxMes) }),
    texto({ actores: ['agente-sintetico'] }),
    texto({ actores: ['1001', '1001'] }),
    texto({ actores: '1001' }),
  ];
  for (const variable of defectuosas) {
    assert.deepEqual(leerConfiguracionDemanda(variable), INVALIDA, variable);
  }
  assert.equal(leerConfiguracionDemanda(texto({ actores: [] })).estado, 'abierta');
  // Solo el tamaño: el mismo texto válido, con espacios que JSON admite, pasa de 1 KiB.
  const MAX_BYTES = 1_024;
  const valido = texto();
  assert.equal(leerConfiguracionDemanda(valido.padEnd(MAX_BYTES)).estado, 'abierta');
  assert.deepEqual(leerConfiguracionDemanda(valido.padEnd(MAX_BYTES + 1)), INVALIDA);
});
