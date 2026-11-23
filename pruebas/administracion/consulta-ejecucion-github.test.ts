import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as turno } from 'node:timers/promises';
import {
  crearConsultorEjecucionGitHub,
  crearConsultorIntentoActivacionGitHub,
} from '../../src/administracion/consulta-ejecucion-github.ts';
import type { TrabajoPrivado } from '../../src/administracion/trabajos.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';

const TAM_SHA = 40;
const MAX_RESPUESTA = 131_072;
const BYTE_INVALIDO = 255;
const MAX_TOKEN = 4096;
const PLAZO_MS = 3000;
const trabajo: TrabajoPrivado = {
  solicitudId: 'a3904d28-7ff8-41cc-b7d8-1ced941cf011',
  revisionReserva: 1,
  revisionBase: 0,
  accion: 'actualizar-datos',
  creadoEn: 1_000,
  actualizadoEn: 2_000,
  estado: 'despachado',
  runId: '123',
  runAttempt: '1',
  resultado: null,
  huellaRecibo: null,
  protocoloInicio: 'obligatorio',
  inicioConfirmado: true,
  confianza: {
    audiencia: 'https://panel.example/mantenimiento/resultado',
    repositorioId: '101',
    propietarioId: '102',
    ref: 'refs/heads/main',
    workflowRef: 'entidad/herramienta/.github/workflows/actualizar.yml@refs/heads/main',
    sha: 'c'.repeat(TAM_SHA),
    workflowSha: 'd'.repeat(TAM_SHA),
  },
};
const run = {
  id: 123,
  run_attempt: 1,
  event: 'workflow_dispatch',
  head_sha: trabajo.confianza.sha,
  path: '.github/workflows/actualizar.yml',
  status: 'completed',
  conclusion: 'success',
  repository: { id: 101, owner: { id: 102 } },
};
const senal = () => new AbortController().signal;
function lector(entrada: unknown) {
  return crearConsultorEjecucionGitHub({
    obtenerToken: async () => 'secreto-sintetico',
    pedir: async () => Response.json(entrada),
  });
}

test('GET fijo identifica run, repositorio, propietario, código y workflow antes de confirmar su fin', async () => {
  const pedidos: Request[] = [];
  const consultar = crearConsultorEjecucionGitHub({
    obtenerToken: async () => 'secreto-sintetico',
    pedir: async (entrada) => {
      assert.ok(entrada instanceof Request);
      pedidos.push(entrada);
      return Response.json({ ...run, html_url: 'https://ajeno.example/no-se-sigue', display_title: 'no es autoridad' });
    },
  });
  const resultado = await consultar(trabajo, senal());
  assert.equal(resultado.estado, 'completada');
  assert.equal(pedidos.length, 1);
  const peticion = pedidos[0];
  assert.ok(peticion);
  assert.equal(peticion.url, 'https://api.github.com/repos/entidad/herramienta/actions/runs/123/attempts/1');
  assert.equal(peticion.method, 'GET');
  assert.equal(peticion.redirect, 'manual');
  assert.equal(peticion.headers.get('user-agent'), IDENTIDAD_WEB['User-Agent']);
  assert.equal(peticion.headers.get('authorization'), 'Bearer secreto-sintetico');
  assert.equal(JSON.stringify(resultado).includes('secreto-sintetico'), false);
  for (const path of [run.path, `${run.path}@main`, `${run.path}@refs/heads/main`]) {
    assert.equal((await lector({ ...run, path })(trabajo, senal())).estado, 'completada');
  }
});

test('una repetición del workflow conserva el fin comprobable del primer intento sin recibo', async () => {
  const consultar = crearConsultorEjecucionGitHub({
    obtenerToken: async () => 'sintetico',
    pedir: async (entrada) => {
      assert.ok(entrada instanceof Request);
      return Response.json(
        entrada.url.endsWith('/attempts/1')
          ? { ...run, conclusion: 'timed_out' }
          : { ...run, run_attempt: 2, status: 'in_progress', conclusion: null },
      );
    },
  });
  const resultado = await consultar(trabajo, senal());
  assert.equal(resultado.estado, 'completada');
  if (resultado.estado === 'completada') {
    assert.deepEqual([resultado.evidencia.runAttempt, resultado.evidencia.conclusion], ['1', 'timed_out']);
  }
});

test('un run activo o esperando cancelación permanece activo; errores y ausencias no liberan la reserva', async () => {
  for (const status of ['queued', 'in_progress', 'requested', 'waiting', 'pending']) {
    assert.deepEqual(await lector({ ...run, status, conclusion: null })(trabajo, senal()), { estado: 'en-curso' });
  }
  for (const conclusion of [
    'success',
    'failure',
    'neutral',
    'cancelled',
    'skipped',
    'timed_out',
    'action_required',
    'stale',
  ]) {
    assert.equal((await lector({ ...run, conclusion })(trabajo, senal())).estado, 'completada');
  }
  for (const status of [
    ESTADO_HTTP.aceptada,
    ESTADO_HTTP.sinContenido,
    ESTADO_HTTP.encontradoEnOtraDireccion,
    ESTADO_HTTP.noAutenticado,
    ESTADO_HTTP.prohibido,
    ESTADO_HTTP.noEncontrado,
    ESTADO_HTTP.demasiadasPeticiones,
    ESTADO_HTTP.errorInterno,
  ]) {
    const consultar = crearConsultorEjecucionGitHub({
      obtenerToken: async () => 'token',
      pedir: async () => new Response(null, { status }),
    });
    assert.deepEqual(await consultar(trabajo, senal()), { estado: 'no-disponible' });
  }
});

test('identidad ajena, segundo intento, datos incompletos y conclusiones desconocidas no acreditan terminación', async () => {
  for (const cambio of [
    { id: 124 },
    { id: '123' },
    { run_attempt: 2 },
    { event: 'push' },
    { head_sha: 'e'.repeat(TAM_SHA) },
    { repository: { id: 103, owner: { id: 102 } } },
    { repository: { id: 101, owner: { id: 103 } } },
    { repository: null },
    { path: '.github/workflows/otro.yml' },
    { path: `${run.path}@otra` },
    { status: 'completed', conclusion: null },
    { conclusion: 'nuevo-estado' },
    { status: 'in_progress', conclusion: 'cancelled' },
    { status: 'desconocido' },
  ]) {
    assert.deepEqual(await lector({ ...run, ...cambio })(trabajo, senal()), { estado: 'no-disponible' });
  }
});

test('cota de respuesta, tipo, JSON y UTF8 inválidos fallan cerrados sin seguir redirecciones', async () => {
  const respuestas = [
    () => new Response('x'.repeat(MAX_RESPUESTA + 1), { headers: { 'content-type': 'application/json' } }),
    () => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '131073' } }),
    () => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '-1' } }),
    () => new Response(JSON.stringify(run), { headers: { 'content-type': 'text/html' } }),
    () => new Response('{', { headers: { 'content-type': 'application/json' } }),
    () => new Response(new Uint8Array([BYTE_INVALIDO]), { headers: { 'content-type': 'application/json' } }),
  ];
  for (const respuesta of respuestas) {
    const consultar = crearConsultorEjecucionGitHub({
      obtenerToken: async () => 'token',
      pedir: async () => respuesta(),
    });
    assert.deepEqual(await consultar(trabajo, senal()), { estado: 'no-disponible' });
  }
});

test('sin run o token válido no hay petición; cancelación y plazo descartan respuestas tardías', async (t) => {
  let llamadas = 0;
  for (const token of ['', 'a\nb', ' '.repeat(MAX_TOKEN + 1)]) {
    const consultar = crearConsultorEjecucionGitHub({
      obtenerToken: async () => token,
      pedir: async () => {
        llamadas++;
        return Response.json(run);
      },
    });
    assert.equal((await consultar(trabajo, senal())).estado, 'no-disponible');
  }
  assert.equal(llamadas, 0);
  const consultar = crearConsultorEjecucionGitHub({
    obtenerToken: async () => 'token',
    pedir: async () => {
      llamadas++;
      return Response.json(run);
    },
  });
  assert.equal((await consultar({ ...trabajo, runId: null }, senal())).estado, 'no-disponible');
  const cancelada = new AbortController();
  cancelada.abort();
  assert.equal((await consultar(trabajo, cancelada.signal)).estado, 'no-disponible');
  assert.equal(llamadas, 0);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const remoto = Promise.withResolvers<Response>();
  let signal: AbortSignal | undefined;
  const lento = crearConsultorEjecucionGitHub({
    obtenerToken: async () => 'token',
    pedir: async (entrada) => {
      assert.ok(entrada instanceof Request);
      signal = entrada.signal;
      return remoto.promise;
    },
  });
  const pendiente = lento(trabajo, senal());
  await turno();
  t.mock.timers.tick(PLAZO_MS);
  assert.deepEqual(await pendiente, { estado: 'no-disponible' });
  assert.equal(signal?.aborted, true);
  remoto.resolve(Response.json(run));
  await turno();
});

test('recuperación consulta el intento anterior exacto y no confunde el re-run activo con la prueba de terminación', async () => {
  let respuesta: unknown = { ...run, run_attempt: 2 };
  const pedidos: string[] = [];
  const consultar = crearConsultorIntentoActivacionGitHub({
    obtenerToken: async () => 'sintetico',
    pedir: async (entrada) => {
      assert.ok(entrada instanceof Request);
      pedidos.push(entrada.url);
      assert.equal(entrada.headers.get('user-agent'), IDENTIDAD_WEB['User-Agent']);
      return Response.json(respuesta);
    },
  });
  const resultado = await consultar(trabajo, '2', senal());
  assert.equal(resultado.estado, 'completada');
  if (resultado.estado === 'completada') {
    assert.equal(resultado.evidencia.runAttempt, '2');
  }
  assert.deepEqual(pedidos, ['https://api.github.com/repos/entidad/herramienta/actions/runs/123/attempts/2']);
  for (const delta of [
    { run_attempt: 1 },
    { run_attempt: 3 },
    { run_attempt: '2' },
    { id: 124 },
    { head_sha: 'e'.repeat(TAM_SHA) },
    { event: 'push' },
    { path: '.github/workflows/otro.yml' },
    { repository: { id: 999, owner: { id: 102 } } },
  ]) {
    respuesta = { ...run, run_attempt: 2, ...delta };
    assert.equal((await consultar(trabajo, '2', senal())).estado, 'no-disponible');
  }
  respuesta = { ...run, run_attempt: 2, status: 'in_progress', conclusion: null };
  assert.equal((await consultar(trabajo, '2', senal())).estado, 'en-curso');
  const antes = pedidos.length;
  assert.equal((await consultar(trabajo, '02', senal())).estado, 'no-disponible');
  assert.equal(pedidos.length, antes);
});
