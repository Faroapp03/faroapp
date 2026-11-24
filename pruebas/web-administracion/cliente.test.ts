import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { setImmediate as turno } from 'node:timers/promises';
import { crearSolicitadorActualizacion } from '../../src/administracion/actualizacion.ts';
import type { PoliticaControles } from '../../src/administracion/controles.ts';
import { type CapacidadActualizacionPanel, crearRouterAdministrativo } from '../../src/administracion/http.ts';
import { AlmacenSesionPanelSqlite } from '../../src/plataforma/acceso-publico/sesion-sqlite.ts';
import { AlmacenPublicoSqlite } from '../../src/plataforma/acceso-publico/sqlite.ts';
import {
  crearClientePanel,
  type EstadoClientePanel,
  PLAZO_PANEL_CLIENTE_MS,
} from '../../web/administracion/cliente.js';
import { leerDocumentoControles, leerPoliticaControles } from '../../web/administracion/contratos.js';
import { motorPanel } from '../ayudas/persistencia-panel.ts';
import { principalDePrueba } from '../ayudas/principal-panel.ts';

const ORIGEN = 'https://panel.prueba';
const INICIO = 1_000_000;
const SEGUNDO = 1000;
const INDISPONIBLE = 503;
const AGOTADO = 504;
const FRACCION_INVALIDA = 0.5;
const politica = (): PoliticaControles => ({
  version: 2,
  api: 'deshabilitada',
  mcp: false,
  a2a: false,
});
async function preparar(
  t: test.TestContext,
  capacidad?: (almacen: AlmacenSesionPanelSqlite) => CapacidadActualizacionPanel,
) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const sql = motorPanel(db);
  const controles = new AlmacenPublicoSqlite(sql, { maxClientes: 2 });
  const almacen = new AlmacenSesionPanelSqlite(sql, { ahora: () => ahora });
  let ahora = INICIO;
  await almacen.prepararPanel(politica());
  await almacen.prepararTrabajos();
  const router = crearRouterAdministrativo({
    origen: ORIGEN,
    almacen,
    ...(capacidad ? { actualizacion: capacidad(almacen) } : {}),
    guardiaAdministrativa: async () => principalDePrueba('https://access.prueba', 'persona'),
  });
  const pedidos: { ruta: string; opciones: RequestInit | undefined }[] = [];
  const pedir: typeof fetch = async (ruta, opciones) => {
    assert.equal(typeof ruta, 'string');
    const texto = String(ruta);
    pedidos.push({ ruta: texto, opciones });
    const headers = new Headers(opciones?.headers);
    headers.set('origin', ORIGEN);
    headers.set('sec-fetch-site', 'same-origin');
    return router(new Request(new URL(texto, ORIGEN), { ...opciones, headers }));
  };
  return {
    pedir,
    pedidos,
    controles,
    datosPublicos: () =>
      sql
        .filas("SELECT name, sql FROM sqlite_master WHERE type='table' AND name LIKE 'publico_%' ORDER BY name")
        .map((tabla) => [tabla.name, sql.filas(`SELECT * FROM ${String(tabla.name)}`)]),
    avanzar: () => {
      ahora += SEGUNDO;
    },
  };
}
function cliente(pedir: typeof fetch) {
  const estados: EstadoClientePanel[] = [];
  const panel = crearClientePanel({ pedir, alCambiar: (estado) => estados.push(estado) });
  return { panel, estados, ultimo: () => estados.at(-1) as EstadoClientePanel };
}
function activa(estado: EstadoClientePanel) {
  assert.equal(estado.estado, 'activa');
  assert(estado.estado === 'activa');
  return estado;
}
function diferido<T>() {
  let resolver!: (valor: T) => void;
  const promesa = new Promise<T>((aceptar) => {
    resolver = aceptar;
  });
  return { promesa, resolver };
}

test('apertura explícita, contrato HTTP, estado inmutable y sondeo sin actividad', async (t) => {
  const f = await preparar(t);
  const c = cliente(f.pedir);
  assert.equal(c.ultimo().estado, 'inicial');
  assert.equal(f.pedidos.length, 0);
  const abierta = activa(await c.panel.abrir());
  assert.equal(f.pedidos.length, 2);
  assert(Object.isFrozen(abierta) && Object.isFrozen(abierta.controles));
  const token = new Headers(f.pedidos.at(-1)?.opciones?.headers).get('x-faro-sesion');
  assert(token && !JSON.stringify(c.estados).includes(token));
  for (const pedido of f.pedidos) {
    assert.equal(pedido.opciones?.credentials, 'same-origin');
    assert.equal(pedido.opciones?.cache, 'no-store');
    assert.equal(pedido.opciones?.redirect, 'error');
    assert.equal(pedido.opciones?.mode, 'same-origin');
    assert.equal(pedido.opciones?.referrerPolicy, 'same-origin');
  }
  f.avanzar();
  assert.equal(activa(await c.panel.comprobar()).sesion.ultimaActividadEn, INICIO);
  assert.equal(activa(await c.panel.mantener()).sesion.ultimaActividadEn, INICIO + SEGUNDO);
  const total = f.pedidos.length;
  await c.panel.abrir();
  assert.equal(f.pedidos.length, total);
  await c.panel.cerrar();
});

test('dos páginas de la misma persona: la segunda solo sustituye al decidir retomar, sin tocar la nueva', async (t) => {
  const f = await preparar(t);
  const uno = cliente(f.pedir);
  const dos = cliente(f.pedir);
  await uno.panel.abrir();
  // Abrir sin decidirlo no retoma: el 409 dice que el panel está ocupado y la primera sigue abierta.
  const rechazo = await dos.panel.abrir();
  assert.equal(rechazo.estado, 'error');
  assert.equal(rechazo.aviso, 'panel_ocupado');
  activa(await uno.panel.comprobar());
  await dos.panel.abrir(true);
  assert.equal((await uno.panel.comprobar()).estado, 'sustituida');
  assert(!Object.hasOwn(uno.ultimo(), 'controles'));
  const total = f.pedidos.length;
  await uno.panel.mantener();
  await uno.panel.cambiar(politica());
  await uno.panel.comprobar();
  assert.equal(f.pedidos.length, total);
  activa(await dos.panel.comprobar());
  await dos.panel.cerrar();
});

test('CAS en router real conserva sesión y refresca revisión ante conflicto', async (t) => {
  const f = await preparar(t);
  const c = cliente(f.pedir);
  await c.panel.abrir();
  await f.controles.cambiarControles(0, { ...politica(), mcp: true });
  const conflicto = activa(await c.panel.cambiar(politica()));
  assert.equal(conflicto.controles.revision, 1);
  assert.equal(conflicto.controles.mcp, true);
  assert.equal(conflicto.aviso, 'revision_conflictiva');
  assert.equal(activa(await c.panel.cambiar(politica())).controles.revision, 2);
  assert.equal(f.pedidos.filter((p) => p.ruta.endsWith('/cambiar')).length, 2);
});

test('mutación perdida no se repite y comprobar recupera el resultado confirmado', async (t) => {
  const f = await preparar(t);
  const pedir: typeof fetch = async (ruta, opciones) => {
    const respuesta = await f.pedir(ruta, opciones);
    if (String(ruta).endsWith('/cambiar')) {
      throw new TypeError('fuera de línea');
    }
    return respuesta;
  };
  const c = cliente(pedir);
  await c.panel.abrir();
  assert.deepEqual(await c.panel.cambiar({ ...politica(), mcp: true }), {
    estado: 'desconectada',
    aviso: 'resultado_desconocido',
  });
  assert.equal(activa(await c.panel.comprobar()).controles.revision, 1);
  assert.equal(f.pedidos.filter((p) => p.ruta.endsWith('/cambiar')).length, 1);
});

test('fallo de lectura tras abrir retiene RAM y solo comprobar puede reconectar', async (t) => {
  const f = await preparar(t);
  let fallar = true;
  const c = cliente(async (ruta, opciones) => {
    if (String(ruta).endsWith('/leer') && fallar) {
      fallar = false;
      throw new TypeError('sin red');
    }
    return f.pedir(ruta, opciones);
  });
  assert.equal((await c.panel.abrir()).estado, 'desconectada');
  await c.panel.abrir();
  activa(await c.panel.comprobar());
  assert.equal(f.pedidos.filter((p) => p.ruta.endsWith('/abrir')).length, 1);
});

test('cierre retira controles inmediatamente e ignora lectura tardía', async (t) => {
  const f = await preparar(t);
  const pendiente = diferido<Response>();
  let retrasar = false;
  const c = cliente((ruta, opciones) =>
    retrasar && String(ruta).endsWith('/leer') ? pendiente.promesa : f.pedir(ruta, opciones),
  );
  await c.panel.abrir();
  retrasar = true;
  const lectura = c.panel.comprobar();
  await turno();
  const cierre = c.panel.cerrar();
  assert(!Object.hasOwn(c.ultimo(), 'controles'));
  pendiente.resolver(Response.json({ secreto: 'tardío' }));
  await Promise.all([lectura, cierre]);
  assert.equal(c.ultimo().estado, 'cerrada');
  assert.equal(f.pedidos.filter((p) => p.ruta.endsWith('/cerrar')).length, 1);
});

test('destruir durante apertura invalida respuesta tardía y llamadas posteriores', async () => {
  const pendiente = diferido<Response>();
  let llamadas = 0;
  const c = cliente(async () => {
    llamadas++;
    return pendiente.promesa;
  });
  const apertura = c.panel.abrir();
  await turno();
  await c.panel.abrir();
  await c.panel.comprobar();
  assert.equal(llamadas, 1);
  c.panel.destruir();
  const publicaciones = c.estados.length;
  pendiente.resolver(Response.json({ secreto: 'tardío' }));
  await apertura;
  await c.panel.abrir();
  assert.equal(c.estados.length, publicaciones);
  assert.equal(llamadas, 1);
});

test('cerrar apertura pendiente no deja que su respuesta reactive la página', async () => {
  const pendiente = diferido<Response>();
  const c = cliente(async () => pendiente.promesa);
  const apertura = c.panel.abrir();
  await turno();
  const cierre = c.panel.cerrar();
  pendiente.resolver(Response.json({ secreto: 'tardío' }));
  await Promise.all([apertura, cierre]);
  assert.equal(c.ultimo().estado, 'cerrada');
});

test('503 y 504 tras enviar cambio son resultado desconocido, nunca reintento', async (t) => {
  for (const estado of [INDISPONIBLE, AGOTADO]) {
    const f = await preparar(t);
    let llamadas = 0;
    const c = cliente((ruta, opciones) => {
      if (String(ruta).endsWith('/cambiar')) {
        llamadas++;
        return Promise.resolve(
          Response.json({ error: estado === AGOTADO ? 'tiempo_agotado' : 'no_disponible' }, { status: estado }),
        );
      }
      return f.pedir(ruta, opciones);
    });
    await c.panel.abrir();
    assert.equal((await c.panel.cambiar(politica())).aviso, 'resultado_desconocido');
    assert.equal(llamadas, 1);
  }
});

test('400 de cambio conserva sesión y muestra rechazo explícito', async (t) => {
  const f = await preparar(t);
  const c = cliente((ruta, opciones) =>
    String(ruta).endsWith('/cambiar')
      ? Promise.resolve(Response.json({ error: 'solicitud_invalida' }, { status: 400 }))
      : f.pedir(ruta, opciones),
  );
  await c.panel.abrir();
  const estado = activa(await c.panel.cambiar({ ...politica(), api: 'habilitada' }));
  assert.equal(estado.aviso, 'solicitud_rechazada');
  assert.equal(estado.ocupado, false);
});

test('contrato cerrado copia y rechaza extras, accesores y revisiones inseguras', () => {
  const entrada = { ...politica() };
  const copia = leerPoliticaControles(entrada);
  entrada.mcp = true;
  assert.equal(copia.mcp, false);
  assert.throws(() => leerPoliticaControles({ ...politica(), permisosIa: {} }));
  assert.throws(() => leerPoliticaControles({ ...politica(), secreto: 'nunca' }));
  let ejecutado = false;
  const accesor = {
    ...politica(),
    get api() {
      ejecutado = true;
      return 'deshabilitada';
    },
  };
  assert.throws(() => leerPoliticaControles(accesor));
  assert.equal(ejecutado, false);
  for (const revision of [-1, Number.MAX_SAFE_INTEGER + 1, FRACCION_INVALIDA, '0']) {
    assert.throws(() => leerDocumentoControles({ ...politica(), revision }));
  }
});

test('cuerpo inválido cancela flujo sin reflejar datos y plazo cancela fetch ignorante', async (t) => {
  let cancelado = false;
  const cuerpo = new ReadableStream({
    cancel() {
      cancelado = true;
    },
  });
  const c = cliente(async () => new Response(cuerpo, { headers: { 'content-type': 'text/html' } }));
  assert.equal((await c.panel.abrir()).aviso, 'resultado_desconocido');
  assert.equal(cancelado, true);
  assert(!JSON.stringify(c.estados).includes('secreto'));
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const lenta = cliente(async () => new Promise<Response>(() => {}));
  const espera = lenta.panel.abrir();
  await turno();
  t.mock.timers.tick(PLAZO_PANEL_CLIENTE_MS);
  assert.equal((await espera).aviso, 'resultado_desconocido');
  t.mock.timers.reset();
});

test('respuestas de éxito inválidas no revelan controles ni aceptan HTML o extras', async (t) => {
  const f = await preparar(t);
  const c = cliente(async (ruta, opciones) =>
    String(ruta).endsWith('/leer')
      ? Response.json({ estado: 'activa', secreto: 'nunca', controles: politica() })
      : f.pedir(ruta, opciones),
  );
  assert.deepEqual(await c.panel.abrir(), { estado: 'desconectada', aviso: 'respuesta_invalida' });
  assert(!JSON.stringify(c.estados).includes('nunca'));
});

test('403 sesion_inactiva retira controles y prohíbe sondeo y actividad hasta abrir explícito', async (t) => {
  const f = await preparar(t);
  let expirada = false;
  const c = cliente((ruta, opciones) =>
    expirada ? Promise.resolve(Response.json({ error: 'sesion_inactiva' }, { status: 403 })) : f.pedir(ruta, opciones),
  );
  await c.panel.abrir();
  expirada = true;
  assert.deepEqual(await c.panel.comprobar(), { estado: 'caducada', aviso: 'sesion_inactiva' });
  assert(!Object.hasOwn(c.ultimo(), 'controles'));
  const total = f.pedidos.length;
  await c.panel.comprobar();
  await c.panel.mantener();
  assert.equal(f.pedidos.length, total);
});

test('límites de bytes declarados y reales cancelan cuerpos antes de aceptar datos', async () => {
  const EXCESO = 8193;
  for (const declarado of [true, false]) {
    let cancelado = false;
    const flujo = new ReadableStream<Uint8Array>({
      start(control) {
        if (!declarado) {
          control.enqueue(new Uint8Array(EXCESO));
        }
      },
      cancel() {
        cancelado = true;
      },
    });
    const headers = new Headers({ 'content-type': 'application/json' });
    if (declarado) {
      headers.set('content-length', String(EXCESO));
    }
    const c = cliente(async () => new Response(flujo, { headers }));
    assert.equal((await c.panel.abrir()).aviso, 'resultado_desconocido');
    assert.equal(cancelado, true);
  }
});

test('fetch se invoca sin receptor privado como exige la API del navegador', async (t) => {
  const f = await preparar(t);
  const pedir: typeof fetch = function (this: unknown, ruta, opciones) {
    assert.equal(this, undefined);
    return f.pedir(ruta, opciones);
  };
  activa(await cliente(pedir).panel.abrir());
});

test('cliente y router reales reservan una vez sin alterar controles, cuotas ni credenciales públicas', async (t) => {
  const LONGITUD_SHA = 40;
  let envios = 0;
  const f = await preparar(t, (almacen) => ({
    leer: (acceso) => almacen.leerTrabajoDeSesion(acceso),
    solicitar: crearSolicitadorActualizacion({
      almacen,
      // GitHub no responde a la consulta del trabajo que ocupa: la reserva decide como si no se hubiera consultado.
      reconciliar: async () => 'indeterminada',
      confianza: {
        audiencia: 'https://mantenimiento.prueba/resultado',
        repositorioId: '101',
        propietarioId: '102',
        ref: 'refs/heads/main',
        workflowRef: 'entidad/herramienta/.github/workflows/actualizar.yml@refs/heads/main',
        sha: 'c'.repeat(LONGITUD_SHA),
        workflowSha: 'd'.repeat(LONGITUD_SHA),
      },
      despachar: async () => {
        envios++;
        return { estado: 'despachada', runId: '123' };
      },
    }),
  }));
  const antes = f.datosPublicos();
  const c = cliente(f.pedir);
  const abierta = activa(await c.panel.abrir());
  assert.equal(activa(await c.panel.consultarTrabajo()).trabajos?.revision, 0);
  const solicitada = activa(await c.panel.actualizarDatos('reintentar-pendientes'));
  assert.equal(solicitada.trabajos?.ultimoTrabajo?.estado, 'despachado');
  assert.equal(solicitada.trabajos?.ultimoTrabajo?.accion, 'reintentar-pendientes');
  assert.equal(solicitada.sesion.ultimaActividadEn, abierta.sesion.ultimaActividadEn);
  assert.deepEqual(solicitada.controles, abierta.controles);
  assert.equal(activa(await c.panel.consultarTrabajo()).trabajos?.revision, 2);
  await c.panel.actualizarDatos();
  assert.equal(envios, 1);
  assert.deepEqual(f.datosPublicos(), antes);
  await c.panel.cerrar();
});
