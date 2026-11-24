// Cliente web real, router portable y SQLite aislado; sin sockets ni servicios externos.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { crearSolicitadorActualizacion } from '../../src/administracion/actualizacion.ts';
import type { ResultadoConsultaEjecucion } from '../../src/administracion/consulta-ejecucion-github.ts';
import type { PoliticaControles } from '../../src/administracion/controles.ts';
import { crearRouterAdministrativo } from '../../src/administracion/http.ts';
import { crearReconciliadorActualizacion } from '../../src/administracion/reconciliacion.ts';
import type { ReciboTrabajo } from '../../src/administracion/trabajos.ts';
import { AlmacenSesionPanelSqlite } from '../../src/plataforma/acceso-publico/sesion-sqlite.ts';
import { AlmacenPublicoSqlite } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { crearClientePanel, type EstadoClientePanel } from '../../web/administracion/cliente.js';
import { motorPanel } from '../ayudas/persistencia-panel.ts';
import { principalDePrueba } from '../ayudas/principal-panel.ts';
import { sembrarSocioPersistido } from '../ayudas/registro-persistido-anterior.ts';

/** GitHub no responde a la consulta del trabajo que ocupa: la reserva decide como si no se hubiera consultado. */
const GITHUB_SIN_RESPUESTA = async () => 'indeterminada' as const;

const ORIGEN = 'https://panel.example';
const INICIO = Date.parse('2026-10-16T12:00:00Z');
const SEGUNDO = 1000;
const MINUTO = 60_000;
const VIGENCIA = 300;
const TAM_SHA = 40;
const TAM_HUELLA = 64;
const TAM_JTI = 22;
const REVISION_DESPACHADA = 2;
const CONFIANZA = {
  audiencia: 'https://mantenimiento.example/resultado',
  repositorioId: '101',
  propietarioId: '102',
  ref: 'refs/heads/main',
  workflowRef: 'entidad/herramienta/.github/workflows/actualizar.yml@refs/heads/main',
  sha: 'c'.repeat(TAM_SHA),
  workflowSha: 'd'.repeat(TAM_SHA),
};
const EVIDENCIA_REMOTA = {
  estado: 'completed',
  runId: '123',
  runAttempt: '1',
  repositorioId: CONFIANZA.repositorioId,
  propietarioId: CONFIANZA.propietarioId,
  sha: CONFIANZA.sha,
  workflowPath: '.github/workflows/actualizar.yml',
  evento: 'workflow_dispatch',
  conclusion: 'failure',
} as const;
const POLITICA: PoliticaControles = {
  version: 2,
  api: 'habilitada',
  mcp: false,
  a2a: false,
};
const TABLAS_PUBLICAS = [
  'publico_estado',
  'publico_socios',
  'publico_contadores',
  'publico_revocados',
  'administracion_controles',
];
function instantanea(db: DatabaseSync, tablas = TABLAS_PUBLICAS) {
  return tablas.map((tabla) => ({ tabla, filas: db.prepare(`SELECT * FROM ${tabla} ORDER BY 1`).all() }));
}
function activa(estado: EstadoClientePanel) {
  assert.equal(estado.estado, 'activa');
  assert.ok(estado.estado === 'activa');
  return estado;
}
async function prepararAlmacen(t: TestContext) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const sql = motorPanel(db);
  const reloj = { ahora: INICIO };
  const publico = new AlmacenPublicoSqlite(sql, { maxClientes: 2, ahora: () => reloj.ahora });
  await publico.activarControles(POLITICA);
  sembrarSocioPersistido(db, {
    id: 'pub-integracion',
    huellas: ['a'.repeat(TAM_HUELLA)],
    consultasPorHora: 2,
  });
  await publico.consumir([{ clave: 'consultas:global', limite: 2, ventanaMs: MINUTO }]);
  await publico.revocar('x'.repeat(TAM_JTI), INICIO / SEGUNDO + VIGENCIA);
  const almacen = new AlmacenSesionPanelSqlite(sql, { ahora: () => reloj.ahora });
  await almacen.activarSesionPanel();
  await almacen.prepararTrabajos();
  return { db, almacen, reloj };
}
function routerDe(
  almacen: AlmacenSesionPanelSqlite,
  alDespachar: () => void,
  consultar: () => Promise<ResultadoConsultaEjecucion>,
) {
  return crearRouterAdministrativo({
    almacen,
    origen: ORIGEN,
    guardiaAdministrativa: async (peticion) =>
      peticion.headers.get('cf-access-jwt-assertion') === 'administrador-sintetico'
        ? principalDePrueba('https://access.example', 'administrador-sintetico')
        : null,
    actualizacion: {
      leer: (acceso) => almacen.leerTrabajoDeSesion(acceso),
      recuperacion: {
        retirar: (acceso, retirada) => almacen.retirarTrabajoDeSesion(acceso, retirada),
        reconciliar: crearReconciliadorActualizacion({ almacen, consultar }),
      },
      solicitar: crearSolicitadorActualizacion({
        almacen,
        reconciliar: GITHUB_SIN_RESPUESTA,
        confianza: CONFIANZA,
        despachar: async (_solicitud, senal) => {
          senal.throwIfAborted();
          alDespachar();
          return { estado: 'despachada', runId: '123' };
        },
      }),
    },
  });
}
function puenteDe(router: ReturnType<typeof crearRouterAdministrativo>) {
  let perderRuta: string | null = null;
  const pedidos: { ruta: string; cuerpo: unknown; token: string | null }[] = [];
  const respuestas: { ruta: string; texto: string }[] = [];
  const pedir: typeof fetch = async (entrada, opciones) => {
    assert.ok(typeof entrada === 'string');
    assert.equal(opciones?.credentials, 'same-origin');
    assert.equal(opciones?.mode, 'same-origin');
    assert.equal(opciones?.redirect, 'error');
    const headers = new Headers(opciones?.headers);
    // El puente representa únicamente las cabeceras que aportan el navegador y Access.
    headers.set('origin', ORIGEN);
    headers.set('sec-fetch-site', 'same-origin');
    headers.set('cf-access-jwt-assertion', 'administrador-sintetico');
    const peticion = new Request(new URL(entrada, ORIGEN), { ...opciones, headers });
    const ruta = new URL(peticion.url).pathname;
    pedidos.push({ ruta, cuerpo: JSON.parse(await peticion.clone().text()), token: headers.get('x-faro-sesion') });
    const respuesta = await router(peticion);
    respuestas.push({ ruta, texto: await respuesta.clone().text() });
    if (perderRuta !== null && ruta.endsWith(perderRuta)) {
      perderRuta = null;
      await respuesta.body?.cancel();
      throw new TypeError('Respuesta perdida después de confirmar la reserva');
    }
    return respuesta;
  };
  return {
    pedir,
    pedidos,
    respuestas,
    perderSiguienteActualizacion: () => {
      perderRuta = '/datos/actualizar';
    },
    perderSiguienteRecuperacion: (operacion: 'retirar' | 'reconciliar') => {
      perderRuta = `/datos/${operacion}`;
    },
  };
}
async function fixture(t: TestContext) {
  const { db, almacen, reloj } = await prepararAlmacen(t);
  let despachos = 0;
  let consultasRemotas = 0;
  let remotoTerminado = false;
  const puente = puenteDe(
    routerDe(
      almacen,
      () => {
        despachos++;
      },
      async () => {
        consultasRemotas++;
        return remotoTerminado
          ? {
              estado: 'completada',
              evidencia: EVIDENCIA_REMOTA,
            }
          : { estado: 'en-curso' };
      },
    ),
  );
  const estados: EstadoClientePanel[] = [];
  const crearCliente = () => {
    const panel = crearClientePanel({ pedir: puente.pedir, alCambiar: (estado) => estados.push(estado) });
    t.after(() => panel.destruir());
    return panel;
  };
  return {
    db,
    almacen,
    reloj,
    ...puente,
    panel: crearCliente(),
    crearCliente,
    estados,
    antes: instantanea(db),
    despachos: () => despachos,
    consultasRemotas: () => consultasRemotas,
    terminarRemoto: () => {
      remotoTerminado = true;
    },
  };
}
async function terminarValidado(almacen: AlmacenSesionPanelSqlite) {
  const trabajo = (await almacen.leerTrabajoPrivado()).ultimoTrabajo;
  assert.ok(trabajo);
  const { audiencia: _audiencia, ...pins } = CONFIANZA;
  const identidad = {
    ...pins,
    runId: '123',
    runAttempt: '1',
    jti: 'inicio-sintetico',
    emitidoEn: INICIO / SEGUNDO,
    caducaEn: INICIO / SEGUNDO + VIGENCIA,
  };
  const referencia = { solicitudId: trabajo.solicitudId, revisionReserva: trabajo.revisionReserva };
  assert.equal(
    (await almacen.confirmarInicio({ ...referencia, accion: trabajo.accion }, identidad)).estado,
    'aplicado',
  );
  const recibo: ReciboTrabajo = {
    ...referencia,
    accion: trabajo.accion,
    resultado: 'validado',
    veredicto: 'verde',
    terminadoEn: '2026-10-16T12:00:00Z',
    huellaPaquete: '0123456789abcdef',
    error: null,
  };
  assert.equal((await almacen.registrarRecibo(recibo, 'b'.repeat(TAM_HUELLA), identidad)).estado, 'aplicado');
  const { solicitudId: _id, revisionReserva: _revision, accion: _accion, ...resultado } = recibo;
  return resultado;
}
function sinCredencialesPublicadas(f: Awaited<ReturnType<typeof fixture>>) {
  const texto = JSON.stringify(f.estados);
  const respuestas = f.respuestas
    .filter((r) => !r.ruta.endsWith('/sesion/abrir'))
    .map((r) => r.texto)
    .join('');
  for (const palabra of [
    'confianza',
    'workflowRef',
    'workflowSha',
    'huellaRecibo',
    'protocoloInicio',
    'inicioConfirmado',
  ]) {
    assert.equal(texto.includes(palabra), false);
    assert.equal(respuestas.includes(palabra), false);
  }
  for (const token of new Set(f.pedidos.map((p) => p.token).filter((valor) => valor !== null))) {
    assert.equal(texto.includes(token), false);
    assert.equal(respuestas.includes(token), false);
  }
}

test('consulta del cliente recoge el recibo validado de un trabajo real sin cambiar datos públicos ni controles', async (t) => {
  const f = await fixture(t);
  const abierta = activa(await f.panel.abrir());
  await f.panel.actualizarDatos();
  const resultado = await terminarValidado(f.almacen);
  f.reloj.ahora += SEGUNDO;
  const terminal = activa(await f.panel.consultarTrabajo());
  assert.equal(terminal.trabajos?.ultimoTrabajo?.estado, 'terminado');
  assert.deepEqual(terminal.trabajos?.ultimoTrabajo?.resultado, resultado);
  assert.equal(terminal.sesion.ultimaActividadEn, abierta.sesion.ultimaActividadEn);
  assert.deepEqual(terminal.controles, abierta.controles);
  assert.deepEqual(instantanea(f.db), f.antes);
  assert.equal(f.despachos(), 1);
  sinCredencialesPublicadas(f);
});

test('respuesta POST perdida después del commit queda incierta en cliente, no se reenvía y una consulta recupera el trabajo durable', async (t) => {
  const f = await fixture(t);
  await f.panel.abrir();
  f.perderSiguienteActualizacion();
  const incierta = activa(await f.panel.actualizarDatos());
  assert.equal(incierta.aviso, 'actualizacion_incierta');
  assert.equal(incierta.trabajos, null);
  const durable = await f.almacen.leerTrabajoPrivado();
  assert.equal(durable.revision, REVISION_DESPACHADA);
  assert.equal(durable.ultimoTrabajo?.estado, 'despachado');
  const pedidos = f.pedidos.length;
  await f.panel.actualizarDatos();
  await f.panel.actualizarDatos('reintentar-pendientes');
  assert.equal(f.pedidos.length, pedidos);
  const recuperada = activa(await f.panel.consultarTrabajo());
  assert.equal(recuperada.aviso, null);
  assert.equal(recuperada.trabajos?.ultimoTrabajo?.solicitudId, durable.ultimoTrabajo?.solicitudId);
  assert.equal(recuperada.trabajos?.ultimoTrabajo?.estado, 'despachado');
  assert.equal(activa(await f.panel.actualizarDatos()).aviso, 'trabajo_ocupado');
  assert.equal(f.pedidos.filter((p) => p.ruta.endsWith('/datos/actualizar')).length, 1);
  assert.equal(f.despachos(), 1);
  assert.deepEqual(await f.almacen.leerTrabajoPrivado(), durable);
  assert.deepEqual(instantanea(f.db), f.antes);
  sinCredencialesPublicadas(f);
});

test('nueva apertura sustituye al cliente anterior, retira sus controles y conserva trabajo y credenciales sin reabrirlo', async (t) => {
  const f = await fixture(t);
  await f.panel.abrir();
  await f.panel.actualizarDatos();
  const otro = f.crearCliente();
  // La nueva apertura es de la misma persona y sustituye solo porque decide retomar.
  await otro.abrir(true);
  const antes = instantanea(f.db, [...TABLAS_PUBLICAS, 'administracion_sesion', 'administracion_trabajo']);
  const sustituida = await f.panel.consultarTrabajo();
  assert.deepEqual(sustituida, { estado: 'sustituida', aviso: 'sesion_sustituida' });
  const pedidos = f.pedidos.length;
  await f.panel.actualizarDatos();
  await f.panel.comprobar();
  assert.equal(f.pedidos.length, pedidos);
  assert.deepEqual(instantanea(f.db, [...TABLAS_PUBLICAS, 'administracion_sesion', 'administracion_trabajo']), antes);
  const vigente = activa(await otro.consultarTrabajo());
  assert.equal(vigente.trabajos?.ultimoTrabajo?.estado, 'despachado');
  assert.deepEqual(vigente.controles, { ...POLITICA, revision: 0 });
  assert.deepEqual(instantanea(f.db), f.antes);
  assert.equal(f.despachos(), 1);
  sinCredencialesPublicadas(f);
});

test('retirada del cliente cierra solo la reserva sin inicio y conserva credenciales, cuotas y controles', async (t) => {
  const f = await fixture(t);
  const abierta = activa(await f.panel.abrir());
  await f.panel.actualizarDatos();
  await f.panel.consultarTrabajo();
  const retirada = activa(await f.panel.retirarTrabajo());
  assert.equal(retirada.trabajos?.ultimoTrabajo?.resultado?.resultado, 'retirado');
  assert.deepEqual(retirada.controles, abierta.controles);
  assert.equal(retirada.sesion.ultimaActividadEn, abierta.sesion.ultimaActividadEn);
  assert.equal(f.despachos(), 1);
  assert.equal(f.consultasRemotas(), 0);
  assert.deepEqual(instantanea(f.db), f.antes);
  sinCredencialesPublicadas(f);
});

for (const operacion of ['retirar', 'reconciliar'] as const) {
  test(`respuesta perdida al ${operacion} conserva el efecto durable sin repetirlo`, async (t) => {
    const f = await fixture(t);
    await f.panel.abrir();
    await f.panel.actualizarDatos();
    await f.panel.consultarTrabajo();
    f.terminarRemoto();
    f.perderSiguienteRecuperacion(operacion);
    const ejecutar = () => (operacion === 'retirar' ? f.panel.retirarTrabajo() : f.panel.reconciliarTrabajo());
    const incierta = activa(await ejecutar());
    assert.notEqual(incierta.aviso, null);
    const durable = await f.almacen.leerTrabajoPrivado();
    assert.equal(durable.ultimoTrabajo?.estado, 'terminado');
    const pedidos = f.pedidos.length;
    await ejecutar();
    await ejecutar();
    assert.equal(f.pedidos.length, pedidos);
    const consultada = activa(await f.panel.consultarTrabajo());
    assert.deepEqual(consultada.trabajos?.ultimoTrabajo?.resultado, durable.ultimoTrabajo?.resultado);
    assert.equal(f.pedidos.filter((p) => p.ruta.endsWith(`/datos/${operacion}`)).length, 1);
    assert.equal(f.despachos(), 1);
    assert.deepEqual(instantanea(f.db), f.antes);
    sinCredencialesPublicadas(f);
  });
}

test('reconciliación distingue ejecución en curso y terminada sin admitir un candidato ni volver a despachar', async (t) => {
  const f = await fixture(t);
  await f.panel.abrir();
  await f.panel.actualizarDatos();
  await f.panel.consultarTrabajo();
  const pendiente = activa(await f.panel.reconciliarTrabajo());
  assert.equal(pendiente.trabajos?.ultimoTrabajo?.estado, 'despachado');
  f.terminarRemoto();
  const terminada = activa(await f.panel.reconciliarTrabajo());
  assert.equal(terminada.trabajos?.ultimoTrabajo?.resultado?.resultado, 'ejecucion-sin-recibo');
  assert.equal(terminada.trabajos?.ultimoTrabajo?.resultado?.huellaPaquete, null);
  assert.equal(f.consultasRemotas(), 2);
  assert.equal(f.despachos(), 1);
  assert.deepEqual(instantanea(f.db), f.antes);
  sinCredencialesPublicadas(f);
});
