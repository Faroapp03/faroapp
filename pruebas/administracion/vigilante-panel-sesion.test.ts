import assert from 'node:assert/strict';
import test from 'node:test';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { prepararVigilanteSqlite } from '../../src/plataforma/acceso-publico/vigilante-sqlite.ts';
import { principalDePrueba } from '../ayudas/principal-panel.ts';
import { abrirSesionDePrueba } from '../ayudas/sesion-de-prueba.ts';
import { baseVigilante, CONFIG_VIGILANTE, CORTE_VIGILANTE, PROGRAMADA_VIGILANTE } from '../ayudas/vigilante.ts';

const LONGITUD_HUELLA = 64;
const REVISION_AJENA = 999;
const LIMITE_FUERA_DE_COTA = 51;
const acceso = { huellaSesion: 'a'.repeat(LONGITUD_HUELLA), huellaPrincipal: 'b'.repeat(LONGITUD_HUELLA) };
const otro = { huellaSesion: 'c'.repeat(LONGITUD_HUELLA), huellaPrincipal: 'b'.repeat(LONGITUD_HUELLA) };

test('sesión y evaluación comparten transacción y sesión sustituida no modifica el historial', async (t) => {
  const f = await baseVigilante(t);
  prepararVigilanteSqlite(f.sql, CONFIG_VIGILANTE, CORTE_VIGILANTE);
  await abrirSesionDePrueba(f.almacen, acceso);
  const resultado = await f.almacen.comprobarVigilanteDeSesion(acceso, CONFIG_VIGILANTE, PROGRAMADA_VIGILANTE, {
    origen: 'recibo',
  });
  assert.equal(resultado.estado, 'activa');
  assert.equal(resultado.vigilante?.evaluacion.evaluadoEn, CORTE_VIGILANTE);
  const antes = f.db.prepare('SELECT * FROM administracion_vigilante').all();
  await abrirSesionDePrueba(f.almacen, otro);
  const sustituida = await f.almacen.comprobarVigilanteDeSesion(acceso, CONFIG_VIGILANTE, PROGRAMADA_VIGILANTE, {
    origen: 'recibo',
  });
  assert.equal(sustituida.estado, 'sustituida');
  assert.deepEqual(f.db.prepare('SELECT * FROM administracion_vigilante').all(), antes);
});

function peticionPanel(origen: string, ruta: string, cuerpo: object, token: string): Request {
  return new Request(`${origen}/administracion/api/${ruta}`, {
    method: 'POST',
    body: JSON.stringify(cuerpo),
    headers: {
      origin: origen,
      'sec-fetch-site': 'same-origin',
      'x-faro-panel': '1',
      'content-type': 'application/json',
      ...(token ? { 'x-faro-sesion': token } : {}),
    },
  });
}

test('el panel evalúa con sesión y rechaza entradas externas', async (t) => {
  const { crearRouterAdministrativo } = await import('../../src/administracion/http.ts');
  const { proyectarComprobacion, proyectarHistorial } = await import(
    '../../src/administracion/vigilante-proyeccion.ts'
  );
  const f = await baseVigilante(t);
  prepararVigilanteSqlite(f.sql, CONFIG_VIGILANTE, CORTE_VIGILANTE);
  const origen = 'https://panel.prueba';
  const router = crearRouterAdministrativo({
    origen,
    almacen: f.almacen,
    guardiaAdministrativa: async () => principalDePrueba(origen, 'prueba'),
    vigilante: {
      comprobar: async (a) =>
        proyectarComprobacion(
          await f.almacen.comprobarVigilanteDeSesion(a, CONFIG_VIGILANTE, PROGRAMADA_VIGILANTE, { origen: 'recibo' }),
        ),
      historial: async (a, o) => proyectarHistorial(await f.almacen.historialVigilanteDeSesion(a, CONFIG_VIGILANTE, o)),
    },
  });
  const pedir = (ruta: string, cuerpo: object, token = '') => router(peticionPanel(origen, ruta, cuerpo, token));
  const apertura = await pedir('sesion/abrir', {});
  const { token } = (await apertura.json()) as { token: string };
  assert.equal(
    (await pedir('datos/comprobar-estado', { ruta: '/tmp' }, token)).status,
    ESTADO_HTTP.solicitudIncorrecta,
  );
  const respuesta = await pedir('datos/comprobar-estado', {}, token);
  assert.equal(respuesta.status, ESTADO_HTTP.correcto);
  assert.equal(respuesta.headers.get('cache-control'), 'no-store');
  const datos = (await respuesta.json()) as { vigilante: { origenDatos: string; evaluadoEn: number } };
  assert.equal(datos.vigilante.origenDatos, 'recibo');
  assert.equal(datos.vigilante.evaluadoEn, CORTE_VIGILANTE);
  assert.equal(
    (await pedir('datos/vigilante/historial', { limite: LIMITE_FUERA_DE_COTA }, token)).status,
    ESTADO_HTTP.solicitudIncorrecta,
  );
  const conflicto = await pedir('datos/vigilante/historial', { revisionEsperada: REVISION_AJENA }, token);
  assert.equal(conflicto.status, ESTADO_HTTP.conflicto);
  assert.deepEqual(await conflicto.json(), { error: 'vigilante_conflicto' });
});

test('la lectura local exige preparación y no persiste si la sesión cambia mientras espera', async (t) => {
  const { crearVigilantePanelNode } = await import('../../src/plataforma/node/vigilante-panel.ts');
  const { instantaneaSalud } = await import('../ayudas/salud-datos.ts');
  const f = await baseVigilante(t);
  await abrirSesionDePrueba(f.almacen, acceso);
  let llamadas = 0;
  let avisar!: () => void;
  const iniciada = new Promise<void>((r) => {
    avisar = r;
  });
  let resolver!: (valor: ReturnType<typeof instantaneaSalud>) => void;
  const lectura = new Promise<ReturnType<typeof instantaneaSalud>>((r) => {
    resolver = r;
  });
  const capacidad = crearVigilantePanelNode(f.almacen, CONFIG_VIGILANTE, PROGRAMADA_VIGILANTE, async () => {
    llamadas++;
    avisar();
    return lectura;
  });
  const senal = new AbortController().signal;
  await assert.rejects(capacidad.comprobar(acceso, senal));
  assert.equal(llamadas, 0);
  prepararVigilanteSqlite(f.sql, CONFIG_VIGILANTE, CORTE_VIGILANTE);
  const antes = f.db.prepare('SELECT * FROM administracion_vigilante').all();
  const pendiente = capacidad.comprobar(acceso, senal);
  await iniciada;
  await abrirSesionDePrueba(f.almacen, otro);
  resolver(instantaneaSalud());
  const resultado = await pendiente;
  assert.equal(resultado.estado, 'sustituida');
  assert.deepEqual(f.db.prepare('SELECT * FROM administracion_vigilante').all(), antes);
});

test('proyección con mantenimiento real conserva áreas y fechas sin soportes privados', async (t) => {
  const { proyectarComprobacion } = await import('../../src/administracion/vigilante-proyeccion.ts');
  const { instantaneaSalud } = await import('../ayudas/salud-datos.ts');
  const f = await baseVigilante(t);
  prepararVigilanteSqlite(f.sql, CONFIG_VIGILANTE, CORTE_VIGILANTE);
  await abrirSesionDePrueba(f.almacen, acceso);
  const bruto = await f.almacen.comprobarVigilanteDeSesion(acceso, CONFIG_VIGILANTE, PROGRAMADA_VIGILANTE, {
    origen: 'lectura-local',
    datos: instantaneaSalud(),
  });
  const proyectado = proyectarComprobacion(bruto);
  assert.equal(proyectado.estado, 'activa');
  if (proyectado.estado !== 'activa') {
    throw new Error('sesión inesperada');
  }
  assert.ok(proyectado.vigilante.areas.length > 0);
  assert.ok(proyectado.vigilante.fechaDatos.length > 0);
  const texto = JSON.stringify(proyectado.vigilante);
  assert.equal(texto.includes('referencia'), false);
  assert.equal(texto.includes('configuracionSha'), false);
});

test('un fallo de lectura iniciado registra únicamente la incidencia local y nunca informa éxito', async (t) => {
  const { crearVigilantePanelNode } = await import('../../src/plataforma/node/vigilante-panel.ts');
  const { FalloLecturaVigilante } = await import('../../src/administracion/errores-vigilante.ts');
  const f = await baseVigilante(t);
  prepararVigilanteSqlite(f.sql, CONFIG_VIGILANTE, CORTE_VIGILANTE);
  await abrirSesionDePrueba(f.almacen, acceso);
  const capacidad = crearVigilantePanelNode(f.almacen, CONFIG_VIGILANTE, PROGRAMADA_VIGILANTE, async () => {
    throw new Error('fallo sintético privado');
  });
  await assert.rejects(capacidad.comprobar(acceso, new AbortController().signal), FalloLecturaVigilante);
  const historial = await capacidad.historial(acceso, { limite: 50 });
  assert.equal(historial.estado, 'activa');
  if (historial.estado !== 'activa') {
    throw new Error('sesión inesperada');
  }
  assert.deepEqual(
    historial.historial.decisiones.map((i) => i.clave),
    ['lectura-local'],
  );
  assert.equal(historial.historial.decisiones[0]?.motivo, 'lectura_local_no_disponible');
});

test('el resumen del último trabajo no expone identidad ni huella del paquete', async (t) => {
  const { proyectarComprobacion } = await import('../../src/administracion/vigilante-proyeccion.ts');
  const { reciboSinPendientesVigilante } = await import('../ayudas/vigilante.ts');
  const { instantaneaSalud } = await import('../ayudas/salud-datos.ts');
  const f = await baseVigilante(t);
  await reciboSinPendientesVigilante(
    f.almacen,
    CORTE_VIGILANTE,
    instantaneaSalud(),
    '00000000-0000-4000-8000-000000000001',
  );
  prepararVigilanteSqlite(f.sql, CONFIG_VIGILANTE, CORTE_VIGILANTE);
  await abrirSesionDePrueba(f.almacen, acceso);
  const bruto = await f.almacen.comprobarVigilanteDeSesion(acceso, CONFIG_VIGILANTE, PROGRAMADA_VIGILANTE, {
    origen: 'recibo',
  });
  const salida = proyectarComprobacion(bruto);
  assert.equal(salida.estado, 'activa');
  if (salida.estado !== 'activa') {
    throw new Error('sesión inesperada');
  }
  assert.equal(salida.vigilante.ultimoTrabajo?.resultado, 'sin-pendientes');
  assert.deepEqual(Object.keys(salida.vigilante.ultimoTrabajo ?? {}).sort(), [
    'accion',
    'actualizadoEn',
    'creadoEn',
    'estado',
    'resultado',
  ]);
});

test('la preparación remota es explícita, usa la sesión y rechaza política del navegador', async (t) => {
  const { crearRouterAdministrativo } = await import('../../src/administracion/http.ts');
  const f = await baseVigilante(t);
  const origen = 'https://panel.prueba';
  const router = crearRouterAdministrativo({
    origen,
    almacen: f.almacen,
    guardiaAdministrativa: async () => principalDePrueba(origen, 'prueba'),
    vigilante: {
      preparar: (a) => f.almacen.prepararVigilanteDeSesion(a, CONFIG_VIGILANTE),
      comprobar: async () => {
        throw new Error('no se usa');
      },
      historial: async () => {
        throw new Error('no se usa');
      },
    },
  });
  const abierta = await router(peticionPanel(origen, 'sesion/abrir', {}, ''));
  const { token } = (await abierta.json()) as { token: string };
  assert.equal(
    (await router(peticionPanel(origen, 'datos/vigilante/preparar', { config: CONFIG_VIGILANTE }, token))).status,
    ESTADO_HTTP.solicitudIncorrecta,
  );
  const respuesta = await router(peticionPanel(origen, 'datos/vigilante/preparar', {}, token));
  assert.equal(respuesta.status, ESTADO_HTTP.correcto);
  assert.equal(((await respuesta.json()) as { preparado: boolean }).preparado, true);
  assert.equal(
    f.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='administracion_vigilante'").get()?.n,
    1,
  );
});

test('dos lecturas concurrentes idénticas se registran una sola vez', async (t) => {
  const { crearVigilantePanelNode } = await import('../../src/plataforma/node/vigilante-panel.ts');
  const { instantaneaSalud } = await import('../ayudas/salud-datos.ts');
  const f = await baseVigilante(t);
  prepararVigilanteSqlite(f.sql, CONFIG_VIGILANTE, CORTE_VIGILANTE);
  await abrirSesionDePrueba(f.almacen, acceso);
  let resolver!: (valor: ReturnType<typeof instantaneaSalud>) => void;
  const lectura = new Promise<ReturnType<typeof instantaneaSalud>>((r) => {
    resolver = r;
  });
  let llamadas = 0;
  let avisar!: () => void;
  const iniciadas = new Promise<void>((r) => {
    avisar = r;
  });
  const capacidad = crearVigilantePanelNode(f.almacen, CONFIG_VIGILANTE, PROGRAMADA_VIGILANTE, async () => {
    llamadas++;
    if (llamadas === 2) {
      avisar();
    }
    return lectura;
  });
  const senal = new AbortController().signal;
  const primero = capacidad.comprobar(acceso, senal);
  const segundo = capacidad.comprobar(acceso, senal);
  await iniciadas;
  assert.equal(llamadas, 2);
  resolver(instantaneaSalud());
  const [a, b] = await Promise.all([primero, segundo]);
  assert.equal(a.estado, 'activa');
  assert.deepEqual(a, b);
  const filas = f.db.prepare('SELECT clave FROM administracion_vigilante_decisiones').all();
  assert.equal(filas.length, new Set(filas.map((fila) => fila.clave)).size);
});

test('interrupción iniciada registra incidencia y reanudar con evidencia conserva la historia', async (t) => {
  const { crearVigilantePanelNode } = await import('../../src/plataforma/node/vigilante-panel.ts');
  const { instantaneaSalud } = await import('../ayudas/salud-datos.ts');
  const f = await baseVigilante(t);
  prepararVigilanteSqlite(f.sql, CONFIG_VIGILANTE, CORTE_VIGILANTE);
  await abrirSesionDePrueba(f.almacen, acceso);
  let resolver!: (valor: ReturnType<typeof instantaneaSalud>) => void;
  const lectura = new Promise<ReturnType<typeof instantaneaSalud>>((r) => {
    resolver = r;
  });
  let avisar!: () => void;
  const iniciada = new Promise<void>((r) => {
    avisar = r;
  });
  const capacidad = crearVigilantePanelNode(f.almacen, CONFIG_VIGILANTE, PROGRAMADA_VIGILANTE, async () => {
    avisar();
    return lectura;
  });
  const controlador = new AbortController();
  const pendiente = capacidad.comprobar(acceso, controlador.signal);
  await iniciada;
  controlador.abort();
  resolver(instantaneaSalud());
  await assert.rejects(pendiente);
  f.reloj.ahora++;
  const recuperado = await capacidad.comprobar(acceso, new AbortController().signal);
  assert.equal(recuperado.estado, 'activa');
  const filas = f.db
    .prepare("SELECT estado, motivo FROM administracion_vigilante_decisiones WHERE clave='lectura-local' ORDER BY id")
    .all();
  assert.deepEqual(
    filas.map((fila) => [fila.estado, fila.motivo]),
    [
      ['incidencia', 'lectura_local_no_disponible'],
      ['conforme', 'lectura_local_disponible'],
    ],
  );
});
