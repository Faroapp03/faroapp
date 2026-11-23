/**
 * Las rutas del panel para el destino de los avisos, montadas como en el Worker sobre el objeto durable con SQLite
 * local, y la guardia de que la dirección no sale por ningún otro sitio. No acredita un despliegue en Cloudflare.
 */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { MAX_CUERPO_PANEL_BYTES } from '../../src/administracion/http.ts';
import type { AccesoSesionPanel } from '../../src/administracion/sesion.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { esObjeto } from '../../src/comun/json.ts';
import { AlmacenAvisosDestinoDurable } from '../../src/plataforma/acceso-publico/avisos-destino-cliente-durable.ts';
import { AccesoPublicoDurable, type EstadoAccesoPublicoDurable } from '../../src/plataforma/acceso-publico/durable.ts';
import type { ValorSql } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { AlmacenVigilanteDurable } from '../../src/plataforma/acceso-publico/vigilante-cliente-durable.ts';
import { type AdministracionMontada, montarAdministracion } from '../../src/plataforma/administracion.ts';
import { crearAvisoProgramado } from '../../src/plataforma/aviso-programado.ts';
import { alarmaDurableDePrueba } from '../ayudas/alarma-durable.ts';
import { principalDePrueba } from '../ayudas/principal-panel.ts';
import { CONFIG_VIGILANTE } from '../ayudas/vigilante.ts';

const ORIGEN = 'https://panel.example';
const CORREO = 'persona@example.org';
const POLITICA = { version: 2, api: 'deshabilitada', mcp: false, a2a: false } as const;
const SEGUNDO_MS = 1000;
/** Lo que se enseña de una salida si la guardia falla: basta para saber cuál es. */
const MUESTRA = 200;

function peticion(
  ruta: string,
  token: string,
  cuerpo: unknown = {},
  cambios: Readonly<Record<string, string>> = {},
): Request {
  return new Request(`${ORIGEN}/administracion/api/${ruta}`, {
    method: 'POST',
    body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
    headers: {
      origin: ORIGEN,
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
      'x-faro-panel': '1',
      'x-faro-sesion': token,
      'cf-access-jwt-assertion': 'prueba',
      ...cambios,
    },
  });
}
function objetoDurable(t: TestContext, variables: Record<string, string>) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const estado: EstadoAccesoPublicoDurable = {
    storage: {
      ...alarmaDurableDePrueba(),
      sql: { exec: (sql: string, ...valores: ValorSql[]) => ({ toArray: () => db.prepare(sql).all(...valores) }) },
      transactionSync: <T>(accion: () => T): T => {
        db.exec('BEGIN IMMEDIATE');
        try {
          const r = accion();
          db.exec('COMMIT');
          return r;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      },
    },
  };
  const servidor = new AccesoPublicoDurable(estado, variables);
  /** Cada respuesta del enlace privado, con su ruta, para buscar en ellas la dirección. */
  const respuestas: { ruta: string; texto: string }[] = [];
  const espacio = {
    idFromName: () => 'registro-publico-v1',
    get: () => ({
      fetch: async (r: Request) => {
        const respuesta = await servidor.fetch(r);
        respuestas.push({ ruta: new URL(r.url).pathname, texto: await respuesta.clone().text() });
        return respuesta;
      },
    }),
  };
  return { db, espacio, respuestas };
}
/** El montaje del Worker: el vigilante habilitado, la misma autoridad para todo y el destino de los avisos. */
async function montaje(t: TestContext, { conAvisos = true } = {}) {
  const variables = { FARO_VIGILANTE: JSON.stringify({ ...CONFIG_VIGILANTE, activadoEn: Date.now() - SEGUNDO_MS }) };
  const durable = objetoDurable(t, variables);
  const almacen = new AlmacenVigilanteDurable(durable.espacio);
  const avisos = new AlmacenAvisosDestinoDurable(durable.espacio);
  const panel = await montarAdministracion({
    configuracion: { origen: ORIGEN, permitirHttpLocal: false },
    guardiaAdministrativa: async (r: Request) =>
      r.headers.get('cf-access-jwt-assertion') === 'prueba'
        ? principalDePrueba('https://fixture.cloudflareaccess.com', 'administrador')
        : null,
    vigilante: {
      preparar: (acceso: AccesoSesionPanel) => almacen.prepararVigilanteDeSesion(acceso),
      comprobar: (acceso: AccesoSesionPanel) => almacen.comprobarVigilanteDeSesion(acceso),
      historial: (acceso, pagina) => almacen.historialVigilanteDeSesion(acceso, pagina),
    },
    almacen,
    sesion: almacen,
    secciones: almacen,
    recorrido: almacen,
    instituciones: almacen,
    accesos: almacen,
    trabajos: almacen,
    almacenActivacion: almacen,
    ...(conAvisos ? { avisos } : {}),
    inicial: POLITICA,
  });
  await almacen.prepararTrabajos();
  await almacen.prepararActivacion();
  return { ...durable, almacen, avisos, panel };
}
async function abrir(panel: AdministracionMontada): Promise<string> {
  const respuesta = await panel.responder(peticion('sesion/abrir', '', { retomar: true }));
  assert.equal(respuesta.status, ESTADO_HTTP.correcto);
  const cuerpo: unknown = await respuesta.json();
  assert.ok(esObjeto(cuerpo) && typeof cuerpo.token === 'string');
  return cuerpo.token;
}
async function cuerpoDe(respuesta: Response): Promise<Record<string, unknown>> {
  const cuerpo: unknown = await respuesta.json();
  assert.ok(esObjeto(cuerpo));
  return cuerpo;
}

test('rutas: cambiar, leer, revisión vieja y quitar dentro de la sesión', async (t) => {
  const m = await montaje(t);
  const token = await abrir(m.panel);
  const vacio = await m.panel.responder(peticion('avisos/leer', token));
  assert.equal(vacio.status, ESTADO_HTTP.correcto);
  assert.deepEqual((await cuerpoDe(vacio)).destino, {
    version: 1,
    correo: null,
    revision: 0,
    cambiadoEn: null,
    verificacion: 'sin_destino',
  });
  const cambio = await m.panel.responder(peticion('avisos/cambiar', token, { revisionEsperada: 0, correo: CORREO }));
  assert.equal(cambio.status, ESTADO_HTTP.correcto);
  assert.equal(cambio.headers.get('cache-control'), 'no-store');
  const cambiado = await cuerpoDe(cambio);
  assert.equal(cambiado.estado, 'cambiado');
  assert.ok(esObjeto(cambiado.destino) && cambiado.destino.revision === 1);
  assert.equal(cambiado.destino.verificacion, 'pendiente');
  assert.equal(JSON.stringify(cambiado).includes(CORREO), false);
  const leido = await cuerpoDe(await m.panel.responder(peticion('avisos/leer', token)));
  assert.ok(esObjeto(leido.destino) && leido.destino.correo === CORREO);
  const vieja = await m.panel.responder(peticion('avisos/cambiar', token, { revisionEsperada: 0, correo: CORREO }));
  assert.equal(vieja.status, ESTADO_HTTP.conflicto);
  const conflicto = await cuerpoDe(vieja);
  assert.equal(conflicto.estado, 'conflicto');
  assert.equal(JSON.stringify(conflicto).includes(CORREO), false);
  const quitar = await m.panel.responder(peticion('avisos/quitar', token, { revisionEsperada: 1 }));
  assert.equal(quitar.status, ESTADO_HTTP.correcto);
  assert.ok(esObjeto((await cuerpoDe(quitar)).destino));
  assert.equal((await m.avisos.leerDestinoParaAvisar()).correo, null);
});

test('rutas: sin Access, sin token o con la sesión sustituida no se lee ni se cambia', async (t) => {
  const m = await montaje(t);
  const token = await abrir(m.panel);
  await m.panel.responder(peticion('avisos/cambiar', token, { revisionEsperada: 0, correo: CORREO }));
  const sinAccess = await m.panel.responder(peticion('avisos/leer', token, {}, { 'cf-access-jwt-assertion': 'otra' }));
  assert.equal(sinAccess.status, ESTADO_HTTP.prohibido);
  assert.equal((await cuerpoDe(sinAccess)).error, 'acceso_denegado');
  const sinToken = await m.panel.responder(peticion('avisos/leer', ''));
  assert.equal(sinToken.status, ESTADO_HTTP.prohibido);
  assert.equal((await cuerpoDe(sinToken)).error, 'sesion_inactiva');
  await abrir(m.panel);
  for (const [ruta, cuerpo] of [
    ['avisos/leer', {}],
    ['avisos/cambiar', { revisionEsperada: 1, correo: 'otra@example.org' }],
    ['avisos/quitar', { revisionEsperada: 1 }],
  ] as const) {
    const respuesta = await m.panel.responder(peticion(ruta, token, cuerpo));
    assert.equal(respuesta.status, ESTADO_HTTP.conflicto, ruta);
    assert.deepEqual(await cuerpoDe(respuesta), { error: 'sesion_sustituida' });
  }
  assert.equal((await m.avisos.leerDestinoParaAvisar()).correo, CORREO);
});

type CasoDeFrontera = [Request, number, string];
/** Las peticiones que no son del propio panel, con el estado y el código que debe responder cada una. */
function casosDeCabeceras(token: string): CasoDeFrontera[] {
  return [
    [
      peticion('avisos/leer', token, {}, { origin: 'https://otro.example' }),
      ESTADO_HTTP.prohibido,
      'origen_no_permitido',
    ],
    [
      peticion('avisos/leer', token, {}, { 'sec-fetch-site': 'cross-site' }),
      ESTADO_HTTP.prohibido,
      'origen_no_permitido',
    ],
    [peticion('avisos/leer', token, {}, { 'x-faro-panel': '0' }), ESTADO_HTTP.prohibido, 'origen_no_permitido'],
    [
      peticion('avisos/leer', token, {}, { 'content-type': 'text/plain' }),
      ESTADO_HTTP.tipoNoAdmitido,
      'tipo_no_admitido',
    ],
    [
      new Request(`${ORIGEN}/administracion/api/avisos/leer?x=1`, peticion('avisos/leer', token)),
      ESTADO_HTTP.solicitudIncorrecta,
      'solicitud_invalida',
    ],
    [
      new Request(`${ORIGEN}/administracion/api/avisos/leer`, {
        method: 'GET',
        headers: peticion('avisos/leer', token).headers,
      }),
      ESTADO_HTTP.metodoNoAdmitido,
      'metodo_no_admitido',
    ],
  ];
}
/** Los cuerpos fuera de contrato: demasiado grandes, ilegibles o con campos que no son los de la operación. */
function casosDeCuerpo(token: string): CasoDeFrontera[] {
  const demasiado = String(MAX_CUERPO_PANEL_BYTES + 1);
  return [
    [
      peticion('avisos/cambiar', token, {
        revisionEsperada: 0,
        correo: `${'p'.repeat(MAX_CUERPO_PANEL_BYTES)}@example.org`,
      }),
      ESTADO_HTTP.solicitudIncorrecta,
      'solicitud_invalida',
    ],
    [
      peticion('avisos/leer', token, {}, { 'content-length': demasiado }),
      ESTADO_HTTP.solicitudIncorrecta,
      'solicitud_invalida',
    ],
    [peticion('avisos/leer', token, '{'), ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida'],
    [peticion('avisos/leer', token, { extra: 1 }), ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida'],
    [peticion('avisos/quitar', token, { revisionEsperada: -1 }), ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida'],
  ];
}
test('rutas: origen ajeno, método, tipo y cuerpo grande se rechazan en la frontera', async (t) => {
  const m = await montaje(t);
  const token = await abrir(m.panel);
  for (const [entrada, estado, error] of [...casosDeCabeceras(token), ...casosDeCuerpo(token)]) {
    const respuesta = await m.panel.responder(entrada);
    assert.equal(respuesta.status, estado, `${entrada.method} ${entrada.url} ${error}`);
    assert.deepEqual(await cuerpoDe(respuesta), { error });
  }
  assert.equal(
    m.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='administracion_avisos_destino'").get()?.n,
    0,
  );
});

test('rutas: una dirección inválida o con cabeceras coladas responde con su motivo y no cambia nada', async (t) => {
  const m = await montaje(t);
  const token = await abrir(m.panel);
  for (const correo of [
    `${CORREO}\r\nBcc: otra@example.org`,
    `${CORREO},otra@example.org`,
    `Persona <${CORREO}>`,
    'persona@example',
    true,
  ]) {
    const respuesta = await m.panel.responder(peticion('avisos/cambiar', token, { revisionEsperada: 0, correo }));
    assert.equal(respuesta.status, ESTADO_HTTP.solicitudIncorrecta);
    assert.deepEqual(await cuerpoDe(respuesta), { error: 'correo_invalido' });
  }
  assert.equal((await m.avisos.leerDestinoParaAvisar()).revision, 0);
});

test('rutas: sin almacén de avisos responden 503 a una sesión activa y las demás rutas siguen igual', async (t) => {
  const m = await montaje(t, { conAvisos: false });
  const token = await abrir(m.panel);
  const sinAlmacen = await m.panel.responder(peticion('avisos/leer', token));
  assert.equal(sinAlmacen.status, ESTADO_HTTP.noDisponible);
  assert.deepEqual(await cuerpoDe(sinAlmacen), { error: 'no_disponible' });
  assert.equal((await m.panel.responder(peticion('avisos/leer', ''))).status, ESTADO_HTTP.prohibido);
  assert.equal((await m.panel.responder(peticion('controles/leer', token))).status, ESTADO_HTTP.correcto);
  assert.equal((await m.panel.responder(peticion('avisos/otra', token))).status, ESTADO_HTTP.noEncontrado);
});

/** Lo que escriben por consola el montaje, las rutas, el objeto durable y el aviso, para buscar en ello la dirección. */
function capturarConsola(t: TestContext): string[] {
  const escrito: string[] = [];
  for (const metodo of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) {
    t.mock.method(console, metodo, (...argumentos: unknown[]) => {
      escrito.push(argumentos.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : String(a))).join(' '));
    });
  }
  return escrito;
}
/** Todas las filas de la base menos la tabla del destino: recibos, diarios, vigilante, sesión, controles… */
function filasFueraDelDestino(db: DatabaseSync): string {
  const tablas = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name<>'administracion_avisos_destino'")
    .all()
    .map((fila) => String(fila.name));
  assert.ok(tablas.length > 0);
  return tablas.map((tabla) => JSON.stringify(db.prepare(`SELECT * FROM "${tabla}"`).all())).join('\n');
}
const LECTURAS_CON_CORREO = new Set(['/avisos/leer-sesion', '/avisos/destino']);
const RUTAS_DEL_PANEL: readonly (readonly [string, object])[] = [
  ['sesion/estado', {}],
  ['sesion/actividad', {}],
  ['controles/leer', {}],
  ['secciones/leer', {}],
  ['recorrido/leer', {}],
  ['instituciones/leer', {}],
  ['accesos/leer', {}],
  ['datos/estado', {}],
  ['datos/comprobar-estado', {}],
  ['datos/vigilante/historial', { limite: 50 }],
  ['datos/trabajo', {}],
  ['datos/activacion', {}],
  ['avisos/cambiar', { revisionEsperada: 0, correo: CORREO }],
  ['avisos/cambiar', { revisionEsperada: 1, correo: `${CORREO}\r\nBcc: ${CORREO}` }],
  ['avisos/quitar', { revisionEsperada: 0 }],
  ['avisos/otra', {}],
];

test('guardia: la dirección solo sale en «leer»; ni estados, ni vigilante, ni aviso, ni consola, ni otras tablas', async (t) => {
  const consola = capturarConsola(t);
  const m = await montaje(t);
  const token = await abrir(m.panel);
  assert.equal((await m.panel.responder(peticion('datos/vigilante/preparar', token))).status, ESTADO_HTTP.correcto);
  const cambio = await m.panel.responder(peticion('avisos/cambiar', token, { revisionEsperada: 0, correo: CORREO }));
  assert.equal(cambio.status, ESTADO_HTTP.correcto);
  const salidas: string[] = [await cambio.text(), JSON.stringify(m.panel.capacidadesPanel)];
  const estados = new Map<string, number>();
  for (const [ruta, cuerpo] of RUTAS_DEL_PANEL) {
    const respuesta = await m.panel.responder(peticion(ruta, token, cuerpo));
    estados.set(ruta, respuesta.status);
    salidas.push(`${ruta} ${respuesta.status} ${JSON.stringify([...respuesta.headers])} ${await respuesta.text()}`);
  }
  assert.equal(estados.get('datos/comprobar-estado'), ESTADO_HTTP.correcto);
  assert.equal(estados.get('datos/vigilante/historial'), ESTADO_HTTP.correcto);
  const avisos: string[] = [];
  const avisar = crearAvisoProgramado({
    autoridad: m.almacen,
    destino: () => new URL('https://avisos.example/faro'),
    panel: `${ORIGEN}/administracion/`,
    pedir: async (_url, init) => {
      avisos.push(String(init?.body));
      return new Response(null, { status: ESTADO_HTTP.sinContenido });
    },
  });
  assert.equal(await avisar(), 'enviado');
  assert.equal(avisos.length, 1);
  salidas.push(...avisos, filasFueraDelDestino(m.db), ...consola);
  const privadas = m.respuestas.filter((r) => !LECTURAS_CON_CORREO.has(r.ruta));
  assert.ok(privadas.length > RUTAS_DEL_PANEL.length);
  salidas.push(...privadas.map((r) => `${r.ruta} ${r.texto}`));
  for (const salida of salidas) {
    assert.equal(salida.includes(CORREO), false, salida.slice(0, MUESTRA));
  }
  // Control de la propia guardia: la lectura del panel sí la devuelve, y la captura la habría visto.
  const leer = await m.panel.responder(peticion('avisos/leer', token));
  assert.ok((await leer.text()).includes(CORREO));
  assert.ok(m.respuestas.some((r) => r.ruta === '/avisos/leer-sesion' && r.texto.includes(CORREO)));
});
