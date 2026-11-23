import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import {
  crearSolicitadorActualizacion,
  leerResultadoSolicitudActualizacion,
} from '../../src/administracion/actualizacion.ts';
import type { PoliticaControles } from '../../src/administracion/controles.ts';
import type { ResultadoDespacho, SolicitudActualizacion } from '../../src/administracion/ejecutor-github.ts';
import { crearAlmacenPublicoNode } from '../../src/plataforma/acceso-publico/node.ts';
import { abrirSesionDePrueba } from '../ayudas/sesion-de-prueba.ts';

const TAM_HUELLA = 64;
const TAM_SHA = 40;
const INICIO = Date.parse('2026-10-16T12:00:00Z');
const ACCESO = { huellaSesion: 'a'.repeat(TAM_HUELLA), huellaPrincipal: 'b'.repeat(TAM_HUELLA) };
const CONFIANZA = {
  audiencia: 'https://mantenimiento.example/resultado',
  repositorioId: '101',
  propietarioId: '102',
  ref: 'refs/heads/main',
  workflowRef: 'entidad/herramienta/.github/workflows/actualizar.yml@refs/heads/main',
  sha: 'c'.repeat(TAM_SHA),
  workflowSha: 'd'.repeat(TAM_SHA),
};
const POLITICA: PoliticaControles = {
  version: 2,
  api: 'deshabilitada',
  mcp: false,
  a2a: false,
};
const SOLICITUD = {
  solicitudId: 'a3904d28-7ff8-41cc-b7d8-1ced941cf011',
  accion: 'actualizar-datos',
  revisionEsperada: 0,
} as const;
const senal = () => new AbortController().signal;
async function fixture(t: TestContext) {
  const temporal = mkdtempSync(join(realpathSync(tmpdir()), 'solicitar-datos-'));
  const opciones = {
    archivo: join(temporal, 'registro.sqlite'),
    maxClientes: 1,

    ahora: () => INICIO,
  };
  let base = crearAlmacenPublicoNode(opciones);
  t.after(() => {
    base.close();
    rmSync(temporal, { recursive: true });
  });
  await base.sesion.prepararPanel(POLITICA);
  await base.trabajos.prepararTrabajos();
  await abrirSesionDePrueba(base.sesion, ACCESO);
  return {
    get base() {
      return base;
    },
    reabrir() {
      base.close();
      base = crearAlmacenPublicoNode(opciones);
      return base;
    },
  };
}

test('solicitudes simultáneas idénticas provocan un único despacho después de reservar', async (t) => {
  const f = await fixture(t);
  let llamadas = 0;
  const solicitar = crearSolicitadorActualizacion({
    almacen: f.base.trabajos,
    confianza: CONFIANZA,
    despachar: async () => {
      llamadas++;
      const estado = await f.base.trabajos.leerTrabajoPrivado();
      assert.equal(estado.ultimoTrabajo?.estado, 'despacho-incierto');
      return { estado: 'despachada', runId: '123' };
    },
  });
  const resultados = await Promise.all([solicitar(ACCESO, SOLICITUD, senal()), solicitar(ACCESO, SOLICITUD, senal())]);
  assert.equal(llamadas, 1);
  assert.deepEqual(resultados.map((r) => ('decision' in r ? r.decision : r.estado)).sort(), ['nueva', 'repetida']);
  assert.equal(JSON.stringify(resultados).includes('workflowRef'), false);
});

test('una respuesta perdida no recupera el permiso de envío ni después de reiniciar', async (t) => {
  const f = await fixture(t);
  let llamadas = 0;
  const despachar = async (): Promise<ResultadoDespacho> => {
    llamadas++;
    throw new Error('transporte sintético interrumpido');
  };
  const inicial = crearSolicitadorActualizacion({ almacen: f.base.trabajos, confianza: CONFIANZA, despachar });
  await assert.rejects(inicial(ACCESO, SOLICITUD, senal()), /transporte sintético/);
  const base = f.reabrir();
  const repetir = crearSolicitadorActualizacion({ almacen: base.trabajos, confianza: CONFIANZA, despachar });
  const resultado = await repetir(ACCESO, SOLICITUD, senal());
  assert.equal(llamadas, 1);
  assert.equal(resultado.estado, 'activa');
  if (resultado.estado === 'activa') {
    assert.equal(resultado.decision, 'repetida');
    assert.equal(resultado.trabajos.ultimoTrabajo?.estado, 'despacho-incierto');
  }
});

test('sustituir la sesión mientras responde GitHub retira el acceso pero conserva el trabajo', async (t) => {
  const f = await fixture(t);
  const solicitar = crearSolicitadorActualizacion({
    almacen: f.base.trabajos,
    confianza: CONFIANZA,
    despachar: async () => {
      await abrirSesionDePrueba(f.base.sesion, { ...ACCESO, huellaSesion: 'e'.repeat(TAM_HUELLA) });
      return { estado: 'despachada', runId: '123' };
    },
  });
  assert.deepEqual(await solicitar(ACCESO, SOLICITUD, senal()), { estado: 'sustituida' });
  assert.equal((await f.base.trabajos.leerTrabajoPrivado()).ultimoTrabajo?.runId, '123');
});

test('copias de entrada impiden cambiar identidad, acción o confianza durante una espera', async (t) => {
  const f = await fixture(t);
  const entrada = { ...SOLICITUD };
  const acceso = { ...ACCESO };
  const confianza = { ...CONFIANZA };
  const enviadas: SolicitudActualizacion[] = [];
  const solicitar = crearSolicitadorActualizacion({
    almacen: f.base.trabajos,
    confianza,
    despachar: async (s) => {
      enviadas.push(s);
      return { estado: 'despachada', runId: '123' };
    },
  });
  confianza.repositorioId = '999';
  const pendiente = solicitar(acceso, entrada, senal());
  Object.assign(entrada, { solicitudId: 'a3904d28-7ff8-41cc-b7d8-1ced941cf022', accion: 'reintentar-pendientes' });
  acceso.huellaSesion = 'f'.repeat(TAM_HUELLA);
  assert.equal((await pendiente).estado, 'activa');
  assert.deepEqual(enviadas, [{ solicitudId: SOLICITUD.solicitudId, accion: SOLICITUD.accion, revisionReserva: 1 }]);
  assert.equal((await f.base.trabajos.leerTrabajoPrivado()).ultimoTrabajo?.confianza.repositorioId, '101');
});

test('un rechazo confirmado permite otra intención; un ocupado no despacha', async (t) => {
  const f = await fixture(t);
  let llamadas = 0;
  const solicitar = crearSolicitadorActualizacion({
    almacen: f.base.trabajos,
    confianza: CONFIANZA,
    despachar: async () => (++llamadas === 1 ? { estado: 'rechazada' } : { estado: 'incierta' }),
  });
  const primera = await solicitar(ACCESO, SOLICITUD, senal());
  assert.ok(primera.estado === 'activa');
  const segunda = await solicitar(
    ACCESO,
    {
      ...SOLICITUD,
      solicitudId: 'a3904d28-7ff8-41cc-b7d8-1ced941cf022',
      revisionEsperada: primera.trabajos.revision,
    },
    senal(),
  );
  assert.ok(segunda.estado === 'activa');
  const tercera = await solicitar(
    ACCESO,
    {
      ...SOLICITUD,
      solicitudId: 'a3904d28-7ff8-41cc-b7d8-1ced941cf033',
      revisionEsperada: segunda.trabajos.revision,
    },
    senal(),
  );
  assert.equal(tercera.estado === 'activa' ? tercera.decision : tercera.estado, 'ocupado');
  assert.equal(llamadas, 2);
});

test('cancelación previa no reserva, y una sesión sustituida nunca puede despachar', async (t) => {
  const f = await fixture(t);
  let llamadas = 0;
  const solicitar = crearSolicitadorActualizacion({
    almacen: f.base.trabajos,
    confianza: CONFIANZA,
    despachar: async () => {
      llamadas++;
      return { estado: 'incierta' };
    },
  });
  const control = new AbortController();
  control.abort();
  await assert.rejects(solicitar(ACCESO, SOLICITUD, control.signal));
  assert.equal((await f.base.trabajos.leerTrabajoPrivado()).revision, 0);
  await abrirSesionDePrueba(f.base.sesion, { ...ACCESO, huellaSesion: 'e'.repeat(TAM_HUELLA) });
  assert.deepEqual(await solicitar(ACCESO, SOLICITUD, senal()), { estado: 'sustituida' });
  assert.equal(llamadas, 0);
});

test('el lector público de solicitud rechaza confianza privada, decisiones desconocidas y activos incompletos', async (t) => {
  const f = await fixture(t);
  const solicitar = crearSolicitadorActualizacion({
    almacen: f.base.trabajos,
    confianza: CONFIANZA,
    despachar: async () => ({ estado: 'incierta' }),
  });
  const resultado = await solicitar(ACCESO, SOLICITUD, senal());
  assert.deepEqual(leerResultadoSolicitudActualizacion(resultado), resultado);
  assert.deepEqual(leerResultadoSolicitudActualizacion({ estado: 'sustituida' }), { estado: 'sustituida' });
  for (const malo of [
    { ...resultado, confianza: CONFIANZA },
    { ...resultado, decision: 'publicado' },
    { estado: 'activa' },
    { estado: 'sustituida', decision: 'nueva' },
  ]) {
    assert.throws(() => leerResultadoSolicitudActualizacion(malo));
  }
});
