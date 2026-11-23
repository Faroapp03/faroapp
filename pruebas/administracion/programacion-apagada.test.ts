/**
 * La programación apagada como incidencia propia: sin pausa declarada o con la pausa vencida, el programador da
 * `programacion_apagada`; con una pausa vigente, `programacion_en_pausa` y el panel recibe hasta cuándo.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { configuracionProgramadaDelEntorno } from '../../src/administracion/configuracion-programada.ts';
import { evaluarVigilante } from '../../src/administracion/vigilante.ts';
import { leerVigilantePanel } from '../../src/administracion/vigilante-panel.js';
import { proyectarComprobacion } from '../../src/administracion/vigilante-proyeccion.ts';
import { CONFIG_VIGILANTE, CORTE_VIGILANTE, entradasVigilante } from '../ayudas/vigilante.ts';

const CRON = '0 3 * * *';
/** CORTE_VIGILANTE es el 2026-10-23 a las 12:00 UTC. */
const HOY = '2026-10-23';
const AYER = '2026-10-22';
const FECHA_SIN_GUIONES = 20_261_231;
const programada = (cambios: object = {}) =>
  configuracionProgramadaDelEntorno({
    FARO_ACTUALIZACION_PROGRAMADA: JSON.stringify({ version: 1, habilitada: false, cron: CRON, ...cambios }),
  });

test('«pausaHasta» admite solo una fecha real AAAA-MM-DD; cualquier otra es una configuración no válida', () => {
  assert.equal(programada({ pausaHasta: '2026-12-31' })?.pausaHasta, '2026-12-31');
  assert.equal(programada()?.pausaHasta, undefined);
  assert.throws(() => programada({ habilitada: true, pausaHasta: '2026-12-31' }), /no válida/u);
  for (const pausaHasta of [
    '2026-02-30',
    '2026-2-3',
    '31/12/2026',
    '2026-12-31T00:00:00Z',
    FECHA_SIN_GUIONES,
    null,
    '',
  ]) {
    assert.throws(() => programada({ pausaHasta }), /no válida/u, String(pausaHasta));
  }
});

function programador(pausaHasta?: string) {
  const configuracion = programada(pausaHasta === undefined ? {} : { pausaHasta });
  const evaluacion = evaluarVigilante(CONFIG_VIGILANTE, configuracion, entradasVigilante(), CORTE_VIGILANTE);
  return { evaluacion, decision: evaluacion.decisiones.find((d) => d.clave === 'programador') };
}

test('apagada sin pausa, con la pausa vencida o con la pausa vigente', () => {
  for (const [pausa, estado, motivo] of [
    [undefined, 'incidencia', 'programacion_apagada'],
    [AYER, 'incidencia', 'programacion_apagada'],
    [HOY, 'conforme', 'programacion_en_pausa'],
  ] as const) {
    const { decision } = programador(pausa);
    assert.deepEqual([decision?.estado, decision?.motivo], [estado, motivo], String(pausa));
  }
});

test('el panel recibe hasta cuándo dura una pausa vigente, y nada si no la hay', () => {
  const comprobacion = (pausa?: string) => {
    const { evaluacion } = programador(pausa);
    const incidencias = evaluacion.decisiones
      .filter((d) => d.estado === 'incidencia')
      .map((d, i) => ({ ...d, id: i + 1, evaluadoEn: CORTE_VIGILANTE, origen: 'recibo' as const }));
    const sesion = { estado: 'activa', expiraEn: CORTE_VIGILANTE } as never;
    const vigilante = { evaluacion, incidencias, origenDatos: 'recibo' as const, revision: 1 };
    return proyectarComprobacion({ estado: 'activa', sesion, vigilante } as never) as { vigilante?: object };
  };
  const vigente = comprobacion(HOY).vigilante as { pausaProgramadaHasta?: string };
  assert.equal(vigente.pausaProgramadaHasta, HOY);
  assert.ok(!('pausaProgramadaHasta' in (comprobacion(AYER).vigilante ?? {})));
  assert.ok(!('pausaProgramadaHasta' in (comprobacion().vigilante ?? {})));
  // El validador rechaza una pausa ya vencida o mal escrita.
  for (const pausaProgramadaHasta of [AYER, '2026-1-1']) {
    assert.throws(() => leerVigilantePanel({ ...vigente, pausaProgramadaHasta }));
  }
});
