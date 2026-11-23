// Consulta administrativa real: SQLite, router y cliente; sin proveedor, red ni criptografía repetida.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { type LectorEstadoDatosPanel, leerEstadoDatosPanel } from '../../src/administracion/estado-datos.js';
import { crearRouterAdministrativo } from '../../src/administracion/http.ts';
import type { LectorDatosPanel } from '../../src/administracion/lectura-datos-panel.ts';
import { INACTIVIDAD_SESION_PANEL_MS } from '../../src/administracion/sesion.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { AlmacenSesionPanelSqlite } from '../../src/plataforma/acceso-publico/sesion-sqlite.ts';
import { AlmacenPublicoSqlite } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { crearClientePanel, type EstadoClientePanel } from '../../web/administracion/cliente.js';
import { motorPanel } from '../ayudas/persistencia-panel.ts';
import { principalDePrueba } from '../ayudas/principal-panel.ts';
import { instantaneaSaludV4 } from '../ayudas/salud-datos.ts';

const ORIGEN = 'https://panel.prueba';
const INICIO = Date.parse('2026-10-16T12:00:00Z');
const SEGUNDO = 1000;
const LIMITE_CONTROLES = 8192;
const LIMITE_DATOS = 131_072;
const NUM_FUENTES_GRANDES = 63;
const politica = {
  version: 2,
  api: 'deshabilitada',
  mcp: false,
  a2a: false,
} as const;

function instantanea(cantidad = 1) {
  const fuentes = Array.from({ length: cantidad }, (_, i) => ({
    id: `fuente_${i}`,
    politica: 'fija',
    fecha: null,
    plazoDias: null,
  }));
  return leerEstadoDatosPanel({
    version: 1,
    observadoEn: new Date(INICIO).toISOString().replace('.000Z', 'Z'),
    fuentes,
    modulos: [...fuentes.map((f) => f.id), 'paquete'].map((id) => ({
      id,
      ultimoIntento: null,
      veredicto: null,
      ultimaVersionBuena: null,
      fallos: 0,
      proximoReintento: null,
    })),
    formacionAbiertaCaduca: null,
  });
}
function diferido<T>() {
  let resolver!: (valor: T) => void;
  const promesa = new Promise<T>((resolve) => {
    resolver = resolve;
  });
  return { promesa, resolver };
}
const solicitud = (
  ruta: string,
  token = '',
  cuerpo: object = {},
  opciones: { identidad?: boolean; signal?: AbortSignal } = {},
) =>
  new Request(`${ORIGEN}/administracion/api/${ruta}`, {
    method: 'POST',
    body: JSON.stringify(cuerpo),
    ...(opciones.signal ? { signal: opciones.signal } : {}),
    headers: {
      origin: ORIGEN,
      'sec-fetch-site': 'same-origin',
      'x-faro-panel': '1',
      'content-type': 'application/json',
      ...(opciones.identidad === false ? {} : { 'x-identidad-prueba': 'si' }),
      ...(token ? { 'x-faro-sesion': token } : {}),
    },
  });

/** `procedencia`: la lectura del almacén de trabajos, que sabe si los datos son de la actualización anterior. */
async function preparar(
  t: test.TestContext,
  leer: LectorEstadoDatosPanel = async () => instantanea(),
  procedencia?: LectorDatosPanel,
) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const sql = motorPanel(db);
  new AlmacenPublicoSqlite(sql, { maxClientes: 2 });
  let ahora = INICIO;
  const almacen = new AlmacenSesionPanelSqlite(sql, { ahora: () => ahora });
  await almacen.prepararPanel(politica);
  const router = crearRouterAdministrativo({
    origen: ORIGEN,
    almacen,
    ...(procedencia ? { leerDatosConProcedencia: procedencia } : { leerEstadoDatos: leer }),
    guardiaAdministrativa: async (peticion) =>
      peticion.headers.get('x-identidad-prueba') === 'si'
        ? principalDePrueba('https://access.prueba', 'persona')
        : null,
  });
  const pedir: typeof fetch = (ruta, opciones) => {
    const headers = new Headers(opciones?.headers);
    headers.set('origin', ORIGEN);
    headers.set('sec-fetch-site', 'same-origin');
    headers.set('x-identidad-prueba', 'si');
    return router(new Request(new URL(String(ruta), ORIGEN), { ...opciones, headers }));
  };
  const abrir = async () => {
    const respuesta = await router(solicitud('sesion/abrir', '', { retomar: true }));
    assert.equal(respuesta.status, ESTADO_HTTP.correcto);
    const cuerpo = (await respuesta.json()) as { token: string };
    return cuerpo.token;
  };
  return {
    router,
    solicitud,
    pedir,
    abrir,
    avanzar: (ms: number) => {
      ahora += ms;
    },
  };
}
function cliente(pedir: typeof fetch) {
  const estados: EstadoClientePanel[] = [];
  const panel = crearClientePanel({ pedir, alCambiar: (estado) => estados.push(estado) });
  const ultimo = () => {
    const estado = estados.at(-1);
    assert.ok(estado);
    return estado;
  };
  return { panel, estados, ultimo };
}
function activa(estado: EstadoClientePanel) {
  assert.equal(estado.estado, 'activa');
  assert.ok(estado.estado === 'activa');
  return estado;
}

test('lector nunca se ejecuta antes de identidad, token, sesión y cuerpo válidos', async (t) => {
  let lecturas = 0;
  const f = await preparar(t, async () => {
    lecturas++;
    return instantanea();
  });
  assert.equal(
    (await f.router(f.solicitud('datos/estado', '', {}, { identidad: false }))).status,
    ESTADO_HTTP.prohibido,
  );
  assert.equal((await f.router(f.solicitud('datos/estado'))).status, ESTADO_HTTP.prohibido);
  const token = await f.abrir();
  assert.equal(
    (await f.router(f.solicitud('datos/estado', token, { extra: true }))).status,
    ESTADO_HTTP.solicitudIncorrecta,
  );
  await f.abrir();
  assert.equal((await f.router(f.solicitud('datos/estado', token))).status, ESTADO_HTTP.conflicto);
  assert.equal(lecturas, 0);
});

test('sustituir o caducar sesión durante lector descarta la instantánea al comprobar después', async (t) => {
  for (const sustituir of [true, false]) {
    const empezado = diferido<void>(),
      salida = diferido<ReturnType<typeof instantanea>>();
    const f = await preparar(t, async () => {
      empezado.resolver();
      return salida.promesa;
    });
    const token = await f.abrir();
    const lectura = f.router(f.solicitud('datos/estado', token));
    await empezado.promesa;
    if (sustituir) {
      await f.abrir();
    } else {
      f.avanzar(INACTIVIDAD_SESION_PANEL_MS);
    }
    salida.resolver(instantanea());
    const respuesta = await lectura;
    assert.equal(respuesta.status, sustituir ? ESTADO_HTTP.conflicto : ESTADO_HTTP.prohibido);
    assert.equal(respuesta.headers.get('cache-control'), 'no-store');
    const cuerpo = (await respuesta.json()) as object;
    assert.equal(Object.hasOwn(cuerpo, 'datos'), false);
  }
});

test('cancelación llega al lector y ninguna instantánea tardía se entrega', async (t) => {
  const empezado = diferido<void>(),
    salida = diferido<ReturnType<typeof instantanea>>();
  let senal: AbortSignal | undefined;
  const f = await preparar(t, async (recibida) => {
    senal = recibida;
    empezado.resolver();
    return salida.promesa;
  });
  const token = await f.abrir(),
    retirada = new AbortController();
  const lectura = f.router(f.solicitud('datos/estado', token, {}, { signal: retirada.signal }));
  await empezado.promesa;
  retirada.abort();
  const respuesta = await lectura;
  assert.equal(respuesta.status, ESTADO_HTTP.solicitudIncorrecta);
  assert.equal(senal?.aborted, true);
  const cuerpo: unknown = await respuesta.json();
  assert.ok(cuerpo !== null && typeof cuerpo === 'object');
  assert.equal(Object.hasOwn(cuerpo, 'datos'), false);
  salida.resolver(instantanea());
});

test('consulta correcta lee una instantánea fechada sin renovar actividad ni cambiar política', async (t) => {
  const f = await preparar(t);
  const c = cliente(f.pedir);
  const antes = activa(await c.panel.abrir());
  f.avanzar(SEGUNDO);
  const despues = activa(await c.panel.consultarDatos());
  assert.deepEqual(despues.datos, instantanea());
  assert.equal(despues.sesion.ultimaActividadEn, antes.sesion.ultimaActividadEn);
  assert.deepEqual(despues.controles, antes.controles);
  await c.panel.cerrar();
});

test('con una actualización reservada, la respuesta y el cliente llevan la marca de los datos anteriores', async (t) => {
  const f = await preparar(t, undefined, async () => ({ datos: instantanea(), deLaActualizacionAnterior: true }));
  const c = cliente(f.pedir);
  activa(await c.panel.abrir());
  const estado = activa(await c.panel.consultarDatos());
  assert.deepEqual(estado.datos, instantanea());
  assert.equal(estado.datosDeLaActualizacionAnterior, true);
  await c.panel.cerrar();
  const token = await f.abrir();
  const cuerpo = (await (await f.router(f.solicitud('datos/estado', token))).json()) as Record<string, unknown>;
  assert.deepEqual(Object.keys(cuerpo).sort(), ['datos', 'deLaActualizacionAnterior', 'estado', 'sesion']);
  assert.equal(cuerpo.deLaActualizacionAnterior, true);
});

test('la instalación local lee su archivo: la marca va siempre en falso', async (t) => {
  const f = await preparar(t);
  const c = cliente(f.pedir);
  activa(await c.panel.abrir());
  assert.equal(activa(await c.panel.consultarDatos()).datosDeLaActualizacionAnterior, false);
  await c.panel.cerrar();
});

test('lector no disponible y DTO inválido retiran solo la instantánea, conservando controles de conectividad', async (t) => {
  for (const invalido of [false, true]) {
    let fallar = false;
    const f = await preparar(t, async () => {
      if (!fallar) {
        return instantanea();
      }
      if (invalido) {
        return {} as ReturnType<typeof instantanea>;
      }
      throw new Error('diagnóstico-privado-no-reflejar');
    });
    const c = cliente(f.pedir);
    await c.panel.abrir();
    assert.ok(activa(await c.panel.consultarDatos()).datos);
    fallar = true;
    const estado = activa(await c.panel.consultarDatos());
    assert.equal(estado.datos, null);
    assert.equal(estado.aviso, 'datos_no_disponibles');
    assert.equal(estado.ocupado, false);
    assert.equal(estado.controles.revision, 0);
    assert.equal(JSON.stringify(c.estados).includes('diagnóstico-privado'), false);
    assert.equal(activa(await c.panel.cambiar({ ...politica, mcp: true })).controles.mcp, true);
    await c.panel.cerrar();
  }
});

test('cerrar o destruir durante consulta invalida respuesta y no restaura la instantánea', async (t) => {
  for (const destruir of [false, true]) {
    const empezado = diferido<void>(),
      salida = diferido<ReturnType<typeof instantanea>>();
    const f = await preparar(t, async () => {
      empezado.resolver();
      return salida.promesa;
    });
    const c = cliente(f.pedir);
    await c.panel.abrir();
    const lectura = c.panel.consultarDatos();
    await empezado.promesa;
    let cierre: Promise<unknown>;
    if (destruir) {
      c.panel.destruir();
      cierre = Promise.resolve();
    } else {
      cierre = c.panel.cerrar();
    }
    const publicaciones = c.estados.length;
    salida.resolver(instantanea());
    await Promise.all([lectura, cierre]);
    if (destruir) {
      assert.equal(c.estados.length, publicaciones);
    } else {
      assert.equal(c.ultimo().estado, 'cerrada');
    }
    assert.equal(
      c.estados.slice(publicaciones).some((e) => e.estado === 'activa' && e.datos !== null),
      false,
    );
  }
});

test('respuesta de datos puede superar 8 KiB; controles conservan 8 KiB y datos rechazan 128 KiB', async (t) => {
  const grande = instantanea(NUM_FUENTES_GRANDES);
  assert.ok(JSON.stringify(grande).length > LIMITE_CONTROLES);
  const f = await preparar(t, async () => grande);
  const c = cliente(f.pedir);
  await c.panel.abrir();
  assert.equal(activa(await c.panel.consultarDatos()).datos?.fuentes.length, NUM_FUENTES_GRANDES);
  await c.panel.cerrar();
  const aumentar =
    (rutaFinal: string, espacios: number): typeof fetch =>
    async (ruta, opciones) => {
      const respuesta = await f.pedir(ruta, opciones);
      return String(ruta).endsWith(rutaFinal)
        ? new Response((await respuesta.text()) + ' '.repeat(espacios), {
            status: respuesta.status,
            headers: respuesta.headers,
          })
        : respuesta;
    };
  const controles = cliente(aumentar('/controles/leer', LIMITE_CONTROLES));
  assert.equal((await controles.panel.abrir()).estado, 'desconectada');
  await controles.panel.cerrar();
  const datos = cliente(aumentar('/datos/estado', LIMITE_DATOS));
  await datos.panel.abrir();
  const rechazado = activa(await datos.panel.consultarDatos());
  assert.equal(rechazado.datos, null);
  assert.equal(rechazado.aviso, 'datos_no_disponibles');
  await datos.panel.cerrar();
});

test('v4 llega por API privada al cliente exacto y mantiene sesión y caché restringidas', async (t) => {
  const datos = leerEstadoDatosPanel(instantaneaSaludV4());
  const f = await preparar(t, async () => datos);
  const token = await f.abrir();
  const respuesta = await f.router(f.solicitud('datos/estado', token));
  assert.equal(respuesta.status, ESTADO_HTTP.correcto);
  assert.equal(respuesta.headers.get('cache-control'), 'no-store');
  const cuerpo: unknown = await respuesta.json();
  assert.ok(cuerpo !== null && typeof cuerpo === 'object' && 'datos' in cuerpo);
  assert.deepEqual(leerEstadoDatosPanel(cuerpo.datos), datos);
  const c = cliente(f.pedir);
  // La sesión abierta arriba es de la misma persona: el cliente la toma solo al decidir retomarla.
  const antes = activa(await c.panel.abrir(true));
  const despues = activa(await c.panel.consultarDatos());
  assert.deepEqual(despues.datos, datos);
  assert.equal(despues.sesion.ultimaActividadEn, antes.sesion.ultimaActividadEn);
  assert.deepEqual(despues.controles, antes.controles);
  await c.panel.cerrar();
});
