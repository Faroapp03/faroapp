/** El cierre sin recibo: el servidor guarda por qué no terminó un trabajo, lo enseña al panel y lo olvida al siguiente. */
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { esCierreSinRecibo, leerCierreSinRecibo } from '../../src/administracion/cierre-sin-recibo.ts';
import type { PoliticaControles } from '../../src/administracion/controles.ts';
import { leerResultado } from '../../src/administracion/estado-trabajos.js';
import type { IdentidadEjecucionGitHub } from '../../src/administracion/oidc-github.ts';
import type { EvidenciaEjecucionCompletada, ReciboTrabajo } from '../../src/administracion/trabajos.ts';
import { crearAlmacenPublicoNode } from '../../src/plataforma/acceso-publico/node.ts';
import { abrirSesionDePrueba } from '../ayudas/sesion-de-prueba.ts';

const AHORA = Date.parse('2026-10-16T12:00:00Z');
const TAM_HUELLA = 64;
const TAM_SHA = 40;
const TAM_VERSION = 16;
/** Uno más que el nombre más largo del diario. */
const PASO_DEMASIADO_LARGO = 65;
const SEGUNDO = 1000;
const VALIDEZ_S = 60;
const ACCESO = { huellaSesion: 'a'.repeat(TAM_HUELLA), huellaPrincipal: 'b'.repeat(TAM_HUELLA) };
const ID = '11111111-1111-4111-8111-111111111111';
const OTRO_ID = '22222222-2222-4222-8222-222222222222';
const CONFIANZA = {
  audiencia: 'https://recibos.prueba',
  repositorioId: '123',
  propietarioId: '456',
  ref: 'refs/heads/main',
  workflowRef: 'equipo/fuente/.github/workflows/actualizar.yml@refs/heads/main',
  sha: 'a'.repeat(TAM_SHA),
  workflowSha: 'b'.repeat(TAM_SHA),
};
const POLITICA: PoliticaControles = { version: 2, api: 'deshabilitada', mcp: false, a2a: false };
const INICIO = { solicitudId: ID, accion: 'actualizar-datos', revisionReserva: 1 } as const;
const REFERENCIA = { solicitudId: ID, revisionReserva: 1 } as const;
const PLAZO = { causa: 'plazo-agotado', paso: 'comprobar-datos' } as const;
const CIERRE = { ...INICIO, ultimoFallo: PLAZO };
const RECHAZADO: ReciboTrabajo = {
  ...INICIO,
  resultado: 'rechazado',
  veredicto: 'rojo',
  terminadoEn: '2026-10-16T12:00:00Z',
  huellaPaquete: null,
  error: 'actualizacion_no_completada',
};
const EVIDENCIA: EvidenciaEjecucionCompletada = {
  estado: 'completed',
  evento: 'workflow_dispatch',
  runId: '789',
  runAttempt: '1',
  repositorioId: '123',
  propietarioId: '456',
  sha: CONFIANZA.sha,
  workflowPath: '.github/workflows/actualizar.yml',
  conclusion: 'failure',
};
function identidad(runId = '789'): IdentidadEjecucionGitHub {
  const { audiencia: _audiencia, ...pins } = CONFIANZA;
  return {
    ...pins,
    runId,
    runAttempt: '1',
    jti: 'jti-sintetico',
    emitidoEn: AHORA / SEGUNDO,
    caducaEn: AHORA / SEGUNDO + VALIDEZ_S,
  };
}
async function fixture(t: test.TestContext) {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'faro-cierre-'));
  const almacen = crearAlmacenPublicoNode({ archivo: join(dir, 'panel.sqlite'), maxClientes: 2, ahora: () => AHORA });
  t.after(() => {
    almacen.close();
    rmSync(dir, { recursive: true });
  });
  await almacen.sesion.prepararPanel(POLITICA);
  await abrirSesionDePrueba(almacen.sesion, ACCESO);
  await almacen.trabajos.prepararTrabajos();
  await almacen.trabajos.reservarTrabajoDeSesion(
    ACCESO,
    { solicitudId: ID, accion: 'actualizar-datos', revisionEsperada: 0 },
    CONFIANZA,
  );
  return almacen.trabajos;
}
async function ultimoDelPanel(trabajos: Awaited<ReturnType<typeof fixture>>) {
  const lectura = await trabajos.leerTrabajoDeSesion(ACCESO);
  assert.equal(lectura.estado, 'activa');
  return lectura.estado === 'activa' ? lectura.trabajos.ultimoTrabajo : null;
}

test('forma cerrada: solo causa y paso de sus listas, y nada más viaja', () => {
  assert.deepEqual(leerCierreSinRecibo(CIERRE), CIERRE);
  assert.equal(esCierreSinRecibo(CIERRE), true);
  assert.equal(esCierreSinRecibo({ ...RECHAZADO, version: 1 }), false);
  for (const fallo of [
    { causa: 'sin-resultado', paso: 'motor' },
    { causa: 'se-rompio', paso: 'motor' },
    { causa: 'plazo-agotado', paso: 'var/actualizacion/informe.json' },
    { causa: 'plazo-agotado', paso: 'Paquete' },
    { causa: 'plazo-agotado', paso: 'x'.repeat(PASO_DEMASIADO_LARGO) },
    { causa: 'plazo-agotado', paso: 'motor', mensaje: 'Timeout en /home/runner' },
    { causa: 'plazo-agotado' },
  ]) {
    assert.throws(() => leerCierreSinRecibo({ ...CIERRE, ultimoFallo: fallo }), JSON.stringify(fallo));
  }
  assert.throws(() => leerCierreSinRecibo({ ...CIERRE, runId: '789' }));
  const sinRecibo = {
    resultado: 'ejecucion-sin-recibo',
    veredicto: null,
    terminadoEn: '2026-10-16T12:00:00Z',
    huellaPaquete: null,
    error: null,
  };
  assert.deepEqual(leerResultado({ ...sinRecibo, ultimoFallo: { causa: 'sin-resultado', paso: null } }).ultimoFallo, {
    causa: 'sin-resultado',
    paso: null,
  });
  const validado = { ...sinRecibo, resultado: 'validado', veredicto: 'verde', huellaPaquete: 'a'.repeat(TAM_VERSION) };
  assert.throws(() => leerResultado({ ...validado, ultimoFallo: PLAZO }));
  const { solicitudId: _s, revisionReserva: _r, accion: _a, ...rechazado } = RECHAZADO;
  assert.throws(() => leerResultado({ ...rechazado, ultimoFallo: { causa: 'sin-resultado', paso: null } }));
});

test('sin recibo: el cierre termina el trabajo con su porqué, el panel lo lee y el siguiente correcto lo borra', async (t) => {
  const trabajos = await fixture(t);
  assert.equal((await trabajos.cerrarSinRecibo(CIERRE, identidad())).estado, 'conflicto', 'sin permiso de inicio');
  await trabajos.confirmarInicio(INICIO, identidad());
  assert.equal((await trabajos.cerrarSinRecibo(CIERRE, identidad('790'))).estado, 'conflicto', 'otra ejecución');
  const cierre = await trabajos.cerrarSinRecibo(CIERRE, identidad());
  assert.equal(cierre.estado, 'aplicado');
  const ultimo = await ultimoDelPanel(trabajos);
  assert.equal(ultimo?.resultado?.resultado, 'ejecucion-sin-recibo');
  assert.deepEqual(ultimo?.resultado?.ultimoFallo, PLAZO);
  assert.equal((await trabajos.cerrarSinRecibo(CIERRE, identidad())).estado, 'repetido');
  const otro = { ...CIERRE, ultimoFallo: { causa: 'motor-sin-recibo', paso: 'motor' } } as const;
  assert.equal((await trabajos.cerrarSinRecibo(otro, identidad())).estado, 'conflicto');
  // La evidencia de GitHub llega después: el trabajo ya está cerrado y conserva su porqué.
  assert.equal((await trabajos.finalizarEjecucionSinRecibo(REFERENCIA, EVIDENCIA)).estado, 'repetido');

  const revision = (await trabajos.leerTrabajoPrivado()).revision;
  const siguiente = { solicitudId: OTRO_ID, accion: 'actualizar-datos', revisionReserva: revision + 1 } as const;
  await trabajos.reservarTrabajoDeSesion(
    ACCESO,
    { solicitudId: OTRO_ID, accion: 'actualizar-datos', revisionEsperada: revision },
    CONFIANZA,
  );
  await trabajos.confirmarInicio(siguiente, identidad('791'));
  const validado: ReciboTrabajo = {
    ...siguiente,
    resultado: 'validado',
    veredicto: 'verde',
    terminadoEn: '2026-10-16T12:00:00Z',
    huellaPaquete: 'a'.repeat(TAM_VERSION),
    error: null,
  };
  assert.equal((await trabajos.registrarRecibo(validado, 'e'.repeat(TAM_HUELLA), identidad('791'))).estado, 'aplicado');
  const correcto = await ultimoDelPanel(trabajos);
  assert.equal(correcto?.resultado?.resultado, 'validado');
  assert.equal(correcto?.resultado && Object.hasOwn(correcto.resultado, 'ultimoFallo'), false);
});

test('recibo rechazado por falta de tiempo: el cierre que llega después le añade su porqué una sola vez', async (t) => {
  const trabajos = await fixture(t);
  await trabajos.confirmarInicio(INICIO, identidad());
  assert.equal((await trabajos.registrarRecibo(RECHAZADO, 'e'.repeat(TAM_HUELLA), identidad())).estado, 'aplicado');
  const sinTiempo = { ...CIERRE, ultimoFallo: { causa: 'plazo-insuficiente', paso: 'paquete' } } as const;
  assert.equal((await trabajos.cerrarSinRecibo(sinTiempo, identidad())).estado, 'aplicado');
  const ultimo = await ultimoDelPanel(trabajos);
  assert.equal(ultimo?.resultado?.resultado, 'rechazado');
  assert.equal(ultimo?.resultado?.error, 'actualizacion_no_completada');
  assert.deepEqual(ultimo?.resultado?.ultimoFallo, sinTiempo.ultimoFallo);
  assert.equal((await trabajos.cerrarSinRecibo(sinTiempo, identidad())).estado, 'repetido');
  assert.equal((await trabajos.cerrarSinRecibo(CIERRE, identidad())).estado, 'conflicto');
});

test('runner muerto: sin cierre ni recibo, la evidencia de GitHub deja «sin-resultado» sin paso', async (t) => {
  const trabajos = await fixture(t);
  await trabajos.confirmarInicio(INICIO, identidad());
  assert.equal((await trabajos.finalizarEjecucionSinRecibo(REFERENCIA, EVIDENCIA)).estado, 'aplicado');
  const ultimo = await ultimoDelPanel(trabajos);
  assert.equal(ultimo?.resultado?.resultado, 'ejecucion-sin-recibo');
  assert.deepEqual(ultimo?.resultado?.ultimoFallo, { causa: 'sin-resultado', paso: null });
  // Un cierre que llega tarde no sustituye lo que ya se registró.
  assert.equal((await trabajos.cerrarSinRecibo(CIERRE, identidad())).estado, 'conflicto');
});
