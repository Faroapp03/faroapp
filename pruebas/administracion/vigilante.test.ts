/** Plazos, incertidumbre y recuperación local, sin un temporizador ni actualizador en marcha. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { claveInstanteVigilante, evaluarVigilante } from '../../src/administracion/vigilante.ts';
import { CONSULTA_SALUD, instantaneaSalud, operacionSalud } from '../ayudas/salud-datos.ts';
import {
  CONFIANZA_VIGILANTE,
  CONFIG_VIGILANTE,
  CORTE_VIGILANTE,
  DIA_VIGILANTE,
  entradasVigilante,
  HORA_VIGILANTE,
  PROGRAMADA_VIGILANTE,
} from '../ayudas/vigilante.ts';

test('ausencia de evento esperado avisa sin afirmar muerte del ejecutor; recuperación requiere evento real', () => {
  const entradas = entradasVigilante();
  entradas.programacion = { ...entradas.programacion, ultimoEventoEn: null };
  const detenida = evaluarVigilante(CONFIG_VIGILANTE, PROGRAMADA_VIGILANTE, entradas, CORTE_VIGILANTE);
  assert.equal(detenida.decisiones.find((d) => d.clave === 'programador')?.estado, 'incidencia');
  assert.equal(detenida.pulsoContinuo, 'no-instrumentado');
  assert.equal(detenida.entregaActiva, 'sin-observacion-actual');
  assert.equal(
    evaluarVigilante(CONFIG_VIGILANTE, PROGRAMADA_VIGILANTE, entradasVigilante(), CORTE_VIGILANTE).decisiones.find(
      (d) => d.clave === 'programador',
    )?.estado,
    'conforme',
  );
});
test('evento consumido no confirma inicio; inicio sin cierre vence sin inferir cancelación', () => {
  const entradas = entradasVigilante();
  const trabajo = {
    solicitudId: '11111111-1111-4111-8111-111111111111',
    revisionReserva: 1,
    revisionBase: 0,
    accion: 'comprobar-programada',
    creadoEn: CORTE_VIGILANTE - HORA_VIGILANTE,
    actualizadoEn: CORTE_VIGILANTE - HORA_VIGILANTE,
    estado: 'despacho-incierto',
    runId: null,
    runAttempt: '1',
    resultado: null,
    confianza: CONFIANZA_VIGILANTE,
    huellaRecibo: null,
    protocoloInicio: 'obligatorio',
    inicioConfirmado: false,
  } as const;
  const pendiente = { ...entradas, trabajo: { version: 2, revision: 1, ultimoTrabajo: trabajo } as const };
  assert.equal(
    evaluarVigilante(CONFIG_VIGILANTE, PROGRAMADA_VIGILANTE, pendiente, CORTE_VIGILANTE).decisiones.find(
      (d) => d.clave === 'ejecutor',
    )?.motivo,
    'inicio_no_confirmado',
  );
  const iniciada = {
    ...pendiente,
    trabajo: {
      ...pendiente.trabajo,
      ultimoTrabajo: { ...trabajo, estado: 'despachado', runId: '123', inicioConfirmado: true },
    } as const,
  };
  const salida = evaluarVigilante(
    CONFIG_VIGILANTE,
    PROGRAMADA_VIGILANTE,
    iniciada,
    CORTE_VIGILANTE + CONFIG_VIGILANTE.plazoCierreMs,
  );
  assert.equal(salida.decisiones.find((d) => d.clave === 'ejecutor')?.estado, 'incidencia');
  assert.equal(salida.decisiones.find((d) => d.clave === 'ejecutor')?.motivo, 'inicio_confirmado_sin_cierre');
});
test('dato histórico no vence a diario: comprobación conserva su intervaloUTC y no cambia fechas', () => {
  const entradas = entradasVigilante();
  const bytes = JSON.stringify(entradas);
  const hoy = evaluarVigilante(CONFIG_VIGILANTE, undefined, entradas, CORTE_VIGILANTE);
  assert.equal(hoy.decisiones.find((d) => d.clave === 'conjunto:empresas')?.estado, 'conforme');
  assert.equal(hoy.fechaDatos[0]?.fecha, '2026-01-01');
  const vencida = evaluarVigilante(CONFIG_VIGILANTE, undefined, entradas, Date.parse('2026-11-21T00:00:00Z'));
  assert.equal(vencida.decisiones.find((d) => d.clave === 'conjunto:empresas')?.motivo, 'comprobacion_vencida');
  assert.equal(JSON.stringify(entradas), bytes);
});
test('opt-in y relojes defectuosos no ejecutan ni fabrican una observación', () => {
  assert.equal(
    evaluarVigilante({ ...CONFIG_VIGILANTE, habilitado: false }, undefined, null, CORTE_VIGILANTE).estado,
    'deshabilitado',
  );
  assert.throws(() => evaluarVigilante({ ...CONFIG_VIGILANTE, version: 2 }, undefined, null, CORTE_VIGILANTE));
  assert.throws(() =>
    evaluarVigilante(CONFIG_VIGILANTE, undefined, entradasVigilante(), CORTE_VIGILANTE - DIA_VIGILANTE),
  );
  assert.throws(() =>
    evaluarVigilante({ ...CONFIG_VIGILANTE, plazoCierreMs: 0 }, undefined, entradasVigilante(), CORTE_VIGILANTE),
  );
});

test('fallo remoto conserva última comprobación y reconstrucción local no lo borra', () => {
  const entradas = entradasVigilante();
  const base = instantaneaSalud();
  const fallo = operacionSalud({
    ciclo: '00000000-0000-4000-8000-000000000002',
    inicioEn: '2026-10-23T10:00:00Z',
    finEn: '2026-10-23T10:01:00Z',
    ultimoIntentoRemotoEn: '2026-10-23T10:00:00Z',
    resultado: 'fallo',
    huellaEvidencia: null,
  });
  const local = operacionSalud({
    ...fallo,
    inicioEn: '2026-10-23T11:00:00Z',
    finEn: '2026-10-23T11:01:00Z',
    resultado: 'local',
    remoto: false,
  });
  entradas.datos = instantaneaSalud({
    fuentes: base.fuentes.map((f) => ({ ...f, ultimaOperacion: local })),
    comprobaciones: { ...base.comprobaciones, registradoEn: local.finEn },
    seguimientoRemoto: [
      { fuente: 'empresas', ultimoIntento: fallo, incidenciasPendientes: [{ conjunto: 'empresas', operacion: fallo }] },
    ],
  });
  const salida = evaluarVigilante(CONFIG_VIGILANTE, undefined, entradas, CORTE_VIGILANTE);
  assert.equal(salida.decisiones.find((d) => d.clave === 'fuente:empresas')?.estado, 'incidencia');
  assert.equal(salida.mantenimiento?.operativas[0]?.comprobaciones[0]?.fecha, CONSULTA_SALUD);
  assert.equal(
    evaluarVigilante(CONFIG_VIGILANTE, undefined, entradasVigilante(), CORTE_VIGILANTE).decisiones.find(
      (d) => d.clave === 'fuente:empresas',
    )?.estado,
    'conforme',
  );
});
test('revisiones manuales y externas no reciben una obligación remota inventada', () => {
  const entradas = entradasVigilante();
  const base = instantaneaSalud();
  const conjunto = base.comprobaciones.conjuntos[0];
  assert.ok(conjunto);
  entradas.datos = instantaneaSalud({
    fuentes: base.fuentes.map((f) => ({ ...f, ultimaOperacion: null })),
    seguimientoRemoto: [{ fuente: 'empresas', ultimoIntento: null, incidenciasPendientes: [] }],
    comprobaciones: {
      ...base.comprobaciones,
      conjuntos: [
        {
          ...conjunto,
          operacion: 'revision',
          alcance: 'copia-local',
          intervaloDias: null,
          revisionNecesaria: true,
          ultimaComprobacion: null,
        },
        {
          id: 'externo',
          fuente: null,
          operacion: 'revision',
          alcance: 'productor-externo',
          intervaloDias: null,
          revisionNecesaria: true,
          ultimaComprobacion: null,
        },
      ],
    },
  });
  const salida = evaluarVigilante(CONFIG_VIGILANTE, undefined, entradas, CORTE_VIGILANTE + DIA_VIGILANTE);
  assert.equal(
    salida.decisiones.some((d) => d.clave === 'conjunto:externo'),
    false,
  );
});

test('el margen del evento de hoy no resuelve un evento ausente de ayer', () => {
  const entradas = entradasVigilante();
  entradas.programacion = { ...entradas.programacion, ultimoEventoEn: null };
  const mitadHora = HORA_VIGILANTE / 2;
  const corte = Date.parse('2026-10-24T03:00:00Z') + mitadHora;
  const salida = evaluarVigilante(CONFIG_VIGILANTE, PROGRAMADA_VIGILANTE, entradas, corte);
  assert.equal(salida.decisiones.find((d) => d.clave === 'programador')?.estado, 'incidencia');
});

test('orden UTC preciso conserva representaciones permitidas y rechaza otras sin normalizarlas', () => {
  assert.equal(claveInstanteVigilante('2026-10-23T10:00:00Z'), claveInstanteVigilante('2026-10-23T10:00:00.000000Z'));
  assert.ok(
    claveInstanteVigilante('2026-10-23T10:00:00.000002Z') > claveInstanteVigilante('2026-10-23T10:00:00.000001Z'),
  );
  assert.ok(claveInstanteVigilante('9999-12-31T23:59:59.999999Z') > claveInstanteVigilante('0001-01-01T00:00:00Z'));
  for (const instante of ['2026-10-23T10:00:00.001Z', '2026-10-23T12:00:00+02:00', '2026-02-30T00:00:00Z']) {
    assert.throws(() => claveInstanteVigilante(instante));
  }
});
