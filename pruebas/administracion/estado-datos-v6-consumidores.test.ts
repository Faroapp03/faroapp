/** Quien lee el estado (salud, vigilante, tamaño guardado) trata una v6 como su v5 equivalente, más los retenidos. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_DATOS_TRABAJO_BYTES } from '../../src/administracion/datos-trabajo.ts';
import type { EstadoDatosPanelV5 } from '../../src/administracion/estado-datos.js';
import { leerEstadoDatosPanel } from '../../src/administracion/estado-datos.js';
import type { CambioRetenidoDatos } from '../../src/administracion/retenidos-datos.js';
import { resumirSaludDatos } from '../../src/administracion/salud-datos.js';
import { evaluarVigilante } from '../../src/administracion/vigilante.ts';
import { instantaneaSalud, operacionSalud, v4ConFormacionAbierta } from '../ayudas/salud-datos.ts';
import { CONFIG_VIGILANTE, CORTE_VIGILANTE, entradasVigilante } from '../ayudas/vigilante.ts';

const VERSION_RETENIDOS = 6;
const CIFRAS_SHA = 64;
const MAX_CAMBIOS = 64;
const LARGO_NOMBRE = 95;
const INSTANTE = '2026-11-22T04:15:00.123456Z';
const NADA = { cuarentena: { lectura: 'leida', cambios: [] }, censoSoc: { lectura: 'leida', pendiente: null } };

function comoV6(v5: EstadoDatosPanelV5, retenidos: unknown = NADA) {
  return leerEstadoDatosPanel({ ...v5, version: VERSION_RETENIDOS, retenidos });
}
/** La v5 con Formación abierta y su revisión pendiente: la que nombra fuentes, seguimiento y revisión. */
function v5ConFormacionAbierta(): EstadoDatosPanelV5 {
  const { version: _v, formacionAbiertaCaduca: _c, ...comun } = v4ConFormacionAbierta('2026-10-01');
  return { ...comun, version: 5, formacionAbiertaRevisionPendiente: '2026-10-01' };
}
/** Un fallo remoto pendiente en el seguimiento: el vigilante lo da como incidencia solo si lee el seguimiento. */
function v5ConFalloRemoto(): EstadoDatosPanelV5 {
  const base = instantaneaSalud();
  const fallo = operacionSalud({
    ciclo: '00000000-0000-4000-8000-000000000002',
    inicioEn: '2026-10-23T10:00:00Z',
    finEn: '2026-10-23T10:01:00Z',
    ultimoIntentoRemotoEn: '2026-10-23T10:00:00Z',
    resultado: 'fallo',
    huellaEvidencia: null,
  });
  const local = operacionSalud({ ...fallo, inicioEn: '2026-10-23T11:00:00Z', finEn: '2026-10-23T11:01:00Z' });
  const localNoRemota = { ...local, resultado: 'local' as const, remoto: false };
  return instantaneaSalud({
    fuentes: base.fuentes.map((f) => ({ ...f, ultimaOperacion: localNoRemota })),
    comprobaciones: { ...base.comprobaciones, registradoEn: localNoRemota.finEn },
    seguimientoRemoto: [
      { fuente: 'empresas', ultimoIntento: fallo, incidenciasPendientes: [{ conjunto: 'empresas', operacion: fallo }] },
    ],
  });
}

test('la salud de un estado 6 es la de su estado 5: nombres de las fuentes, seguimiento y revisión pendiente', () => {
  for (const v5 of [v5ConFormacionAbierta(), v5ConFalloRemoto(), instantaneaSalud()]) {
    const esperada = resumirSaludDatos(leerEstadoDatosPanel(v5));
    assert.deepEqual(resumirSaludDatos(comoV6(v5)), esperada);
  }
  const salud = resumirSaludDatos(comoV6(v5ConFormacionAbierta()));
  assert.ok(salud.operativas.some((f) => f.nombre === 'Empresas y uso de IA'));
});

test('el vigilante evalúa un estado 6 como su estado 5 y no pierde el fallo remoto del seguimiento', () => {
  const v5 = v5ConFalloRemoto();
  const conV5 = { ...entradasVigilante(), datos: leerEstadoDatosPanel(v5) };
  const conV6 = { ...entradasVigilante(), datos: comoV6(v5) };
  const esperada = evaluarVigilante(CONFIG_VIGILANTE, undefined, conV5, CORTE_VIGILANTE);
  const evaluada = evaluarVigilante(CONFIG_VIGILANTE, undefined, conV6, CORTE_VIGILANTE);
  assert.equal(evaluada.decisiones.find((d) => d.clave === 'fuente:empresas')?.estado, 'incidencia');
  // La única diferencia es la versión observada, que la decisión de cobertura nombra como referencia.
  const conVersionObservada = esperada.decisiones.map((d) =>
    d.clave === 'cobertura-datos' ? { ...d, referencia: `version:${VERSION_RETENIDOS}` } : d,
  );
  assert.deepEqual(evaluada.decisiones, conVersionObservada);
  assert.deepEqual(evaluada.mantenimiento, esperada.mantenimiento);
});

/** Un archivo con el nombre más largo que admite el contrato, distinto para cada índice. */
function nombre(i: number) {
  return `${String(i).padStart(2, '0')}${'x'.repeat(LARGO_NOMBRE)}`.slice(0, LARGO_NOMBRE).concat('.json');
}
function cambioMaximo(archivo: string, grupo: string[]): CambioRetenidoDatos {
  const cifra = Number.MAX_SAFE_INTEGER;
  return {
    archivo,
    grupo,
    perdidas: [
      { medida: 'entradas', antes: cifra, despues: cifra },
      { medida: 'cursos-soc', antes: cifra, despues: cifra },
    ],
    desdeUtc: INSTANTE,
    ultimaUtc: INSTANTE,
    vigenteSha256: 'a'.repeat(CIFRAS_SHA),
    exportadoSha256: 'b'.repeat(CIFRAS_SHA),
    aceptadaUtc: INSTANTE,
  };
}
const bytes = (valor: unknown) => new TextEncoder().encode(JSON.stringify(valor)).byteLength;

test('un estado 6 con los 64 cambios retenidos que admite el contrato cabe en el tope de los datos de un trabajo', () => {
  const nombres = Array.from({ length: MAX_CAMBIOS }, (_, i) => nombre(i));
  const pendiente = {
    cursosOferta: 1,
    cursosCopia: Number.MAX_SAFE_INTEGER,
    huella: 'c'.repeat(CIFRAS_SHA),
    consultadoEn: INSTANTE,
  };
  const estado = comoV6(instantaneaSalud(), {
    cuarentena: { lectura: 'leida', cambios: nombres.map((n) => cambioMaximo(n, [n])) },
    censoSoc: { lectura: 'leida', pendiente },
  });
  assert.ok(bytes(estado) <= MAX_DATOS_TRABAJO_BYTES, `${bytes(estado)} bytes`);
});
