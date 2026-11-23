/** Avisos del vigilante: cuándo se envían, qué llevan, qué destinos se admiten y qué queda si el envío falla. */
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { prepararAvisoVigilante, retirarIncidenciasCerradas } from '../../src/administracion/aviso-vigilante.ts';
import {
  DestinoAvisoInvalido,
  destinoAvisoDelEntorno,
  enviarAviso,
  PLAZO_AVISO_MS,
} from '../../src/administracion/envio-aviso.ts';
import { leerVigilantePanel } from '../../src/administracion/vigilante-panel.js';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import { prepararVigilanteSqlite } from '../../src/plataforma/acceso-publico/vigilante-sqlite.ts';
import { crearAvisoProgramado } from '../../src/plataforma/aviso-programado.ts';
import {
  baseVigilante,
  CONFIG_VIGILANTE,
  CORTE_VIGILANTE,
  DIA_VIGILANTE,
  HORA_VIGILANTE,
  PROGRAMADA_VIGILANTE,
} from '../ayudas/vigilante.ts';

const PANEL = 'https://panel.example/administracion/';
const MS_POR_SEGUNDO = 1000;
/** Fuera del margen de una hora del recordatorio: dos horas antes de que se cumpla el día. */
const ANTES_DEL_RECORDATORIO = DIA_VIGILANTE - 2 * HORA_VIGILANTE;
/** El cron diario puede llegar unos segundos antes que el día anterior: el recordatorio sale igual. */
const CRON_ADELANTADO = DIA_VIGILANTE - 2 * MS_POR_SEGUNDO;
const DESTINO = 'https://avisos.example/faro';
const programador = { clave: 'programador', motivo: 'evento_esperado_sin_registro' };
const fuente = { clave: 'fuente:ocupados', motivo: 'mantenimiento_incidencia' };

test('una incidencia nueva abre el aviso con el cuerpo exacto; la misma no se repite hasta el día siguiente', () => {
  const ahora = CORTE_VIGILANTE;
  const primero = prepararAvisoVigilante(null, [programador], { ahora, panel: PANEL });
  assert.deepEqual(primero?.cuerpo, {
    version: 1,
    origen: 'faro-vigilante',
    tipo: 'nuevo',
    evaluadoEn: '2026-10-23T12:00:00.000Z',
    desde: '2026-10-23T12:00:00.000Z',
    panel: PANEL,
    decisiones: [{ clave: 'programador', motivo: 'evento_esperado_sin_registro', desde: '2026-10-23T12:00:00.000Z' }],
  });
  const avisado = primero?.siguiente ?? null;
  assert.equal(
    prepararAvisoVigilante(avisado, [programador], {
      ahora: ahora + ANTES_DEL_RECORDATORIO,
      panel: PANEL,
    }),
    null,
  );
  const adelantado = prepararAvisoVigilante(avisado, [programador], { ahora: ahora + CRON_ADELANTADO, panel: PANEL });
  assert.equal(adelantado?.cuerpo.tipo, 'recordatorio');
  const otroDia = prepararAvisoVigilante(avisado, [programador], { ahora: ahora + DIA_VIGILANTE, panel: PANEL });
  assert.equal(otroDia?.cuerpo.tipo, 'recordatorio');
  assert.equal(otroDia?.cuerpo.desde, '2026-10-23T12:00:00.000Z');
  assert.equal(otroDia?.cuerpo.decisiones[0]?.desde, '2026-10-23T12:00:00.000Z');
});

test('una decisión nueva o un cambio de motivo avisan enseguida; al quedar todo bien se avisa «resuelto» una vez', () => {
  const ahora = CORTE_VIGILANTE;
  const avisado = prepararAvisoVigilante(null, [programador], { ahora, panel: PANEL })?.siguiente ?? null;
  const despues = { ahora: ahora + HORA_VIGILANTE, panel: PANEL };
  const nueva = prepararAvisoVigilante(avisado, [programador, fuente], despues);
  assert.equal(nueva?.cuerpo.tipo, 'nuevo');
  assert.deepEqual(
    nueva?.cuerpo.decisiones.map((d) => [d.clave, d.desde]),
    [
      ['fuente:ocupados', '2026-10-23T13:00:00.000Z'],
      ['programador', '2026-10-23T12:00:00.000Z'],
    ],
  );
  const cambio = prepararAvisoVigilante(avisado, [{ clave: 'programador', motivo: 'otro_motivo' }], despues);
  assert.equal(cambio?.cuerpo.tipo, 'nuevo');
  const resuelto = prepararAvisoVigilante(nueva?.siguiente ?? null, [], despues);
  assert.deepEqual(resuelto?.cuerpo, {
    version: 1,
    origen: 'faro-vigilante',
    tipo: 'resuelto',
    evaluadoEn: '2026-10-23T13:00:00.000Z',
    desde: '2026-10-23T12:00:00.000Z',
    panel: PANEL,
    decisiones: [],
  });
  assert.equal(prepararAvisoVigilante(resuelto?.siguiente ?? null, [], despues), null);
  assert.equal(prepararAvisoVigilante(null, [], despues), null);
});

test('el destino solo admite https sin credenciales; sin configurar no hay destino', () => {
  assert.equal(destinoAvisoDelEntorno({}), undefined);
  assert.equal(destinoAvisoDelEntorno({ FARO_AVISO_URL: DESTINO })?.href, DESTINO);
  for (const FARO_AVISO_URL of [
    'http://avisos.example/faro',
    'https://usuario:clave@avisos.example/faro',
    'https://usuario@avisos.example/faro',
    'ftp://avisos.example/faro',
    'no es una dirección',
  ]) {
    assert.throws(() => destinoAvisoDelEntorno({ FARO_AVISO_URL }), DestinoAvisoInvalido);
  }
});

test('el envío es un POST JSON con la identidad web genérica, sin seguir redirecciones; una redirección no se admite', async () => {
  const cuerpo = prepararAvisoVigilante(null, [programador], { ahora: CORTE_VIGILANTE, panel: PANEL })?.cuerpo;
  assert.ok(cuerpo);
  const peticiones: Request[] = [];
  const pedir = async (entrada: Parameters<typeof fetch>[0]) => {
    assert.ok(entrada instanceof Request);
    peticiones.push(entrada);
    return new Response(null, { status: 204 });
  };
  assert.deepEqual(await enviarAviso(new URL(DESTINO), cuerpo, pedir), { resultado: 'enviado' });
  const [peticion] = peticiones;
  assert.equal(peticion?.method, 'POST');
  assert.equal(peticion?.redirect, 'manual');
  assert.equal(peticion?.headers.get('user-agent'), IDENTIDAD_WEB['User-Agent']);
  assert.equal(peticion?.headers.get('content-type'), 'application/json');
  assert.deepEqual(await peticion?.json(), cuerpo);
  const redirige = async () => new Response(null, { status: 302, headers: { location: 'https://otro.example/' } });
  assert.deepEqual(await enviarAviso(new URL(DESTINO), cuerpo, redirige), {
    resultado: 'fallido',
    motivo: 'respuesta-no-admitida',
  });
  const caido = async () => Promise.reject(new TypeError('sin conexión'));
  assert.deepEqual(await enviarAviso(new URL(DESTINO), cuerpo, caido), {
    resultado: 'fallido',
    motivo: 'sin-respuesta',
  });
});

test('un envío que no responde dentro de su plazo queda como «plazo-agotado»', async (t) => {
  const cuerpo = prepararAvisoVigilante(null, [programador], { ahora: CORTE_VIGILANTE, panel: PANEL })?.cuerpo;
  assert.ok(cuerpo);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pendiente = enviarAviso(new URL(DESTINO), cuerpo, () => new Promise<never>(() => {}));
  await new Promise<void>((resolver) => setImmediate(resolver));
  t.mock.timers.tick(PLAZO_AVISO_MS + 1);
  assert.deepEqual(await pendiente, { resultado: 'fallido', motivo: 'plazo-agotado' });
});

async function autoridad(t: TestContext) {
  const base = await baseVigilante(t);
  prepararVigilanteSqlite(base.sql, CONFIG_VIGILANTE, base.reloj.ahora);
  const entrada = { configuracion: CONFIG_VIGILANTE, programada: PROGRAMADA_VIGILANTE };
  return {
    ...base,
    autoridad: {
      prepararAvisoVigilante: (panel: string) => base.almacen.prepararAvisoVigilante(entrada, panel),
      registrarEnvioAviso: (e: Parameters<typeof base.almacen.registrarEnvioAviso>[0]) =>
        base.almacen.registrarEnvioAviso(e),
    },
  };
}

test('sin destino configurado el vigilante se evalúa, no se envía nada y el estado lo dice', async (t) => {
  const f = await autoridad(t);
  const avisar = crearAvisoProgramado({
    autoridad: f.autoridad,
    destino: () => destinoAvisoDelEntorno({}),
    panel: PANEL,
    pedir: async () => assert.fail('No enviar sin destino'),
  });
  assert.equal(await avisar(), 'no-configurados');
  assert.ok(Number(f.db.prepare('SELECT count(*) AS n FROM administracion_vigilante_decisiones').get()?.n) > 0);
  assert.deepEqual(await f.almacen.leerAvisoVigilante(), { avisado: null, ultimoIntento: null });
});

test('un envío fallido queda registrado con su motivo y se reintenta en el evento siguiente; el confirmado no se repite', async (t) => {
  const f = await autoridad(t);
  const respuestas = [new Response(null, { status: 500 }), new Response(null, { status: 202 })];
  const enviados: unknown[] = [];
  const avisar = crearAvisoProgramado({
    autoridad: f.autoridad,
    destino: () => destinoAvisoDelEntorno({ FARO_AVISO_URL: DESTINO }),
    panel: PANEL,
    pedir: async (entrada) => {
      assert.ok(entrada instanceof Request);
      enviados.push(await entrada.json());
      return respuestas.shift() ?? assert.fail('Aviso repetido');
    },
  });
  assert.equal(await avisar(), 'fallido');
  assert.deepEqual(await f.almacen.leerAvisoVigilante(), {
    avisado: null,
    ultimoIntento: { en: CORTE_VIGILANTE, resultado: 'fallido', motivo: 'respuesta-no-admitida' },
  });
  f.reloj.ahora += HORA_VIGILANTE;
  assert.equal(await avisar(), 'enviado');
  const registro = await f.almacen.leerAvisoVigilante();
  assert.equal(registro.avisado?.estado, 'abierto');
  assert.deepEqual(registro.ultimoIntento, { en: f.reloj.ahora, resultado: 'enviado', motivo: null });
  f.reloj.ahora += HORA_VIGILANTE;
  assert.equal(await avisar(), 'sin-aviso');
  assert.equal(enviados.length, 2);
  // El reintento vuelve a ser un aviso nuevo: el fallido no cuenta como avisado.
  assert.deepEqual(
    enviados.map((e) => (e as { tipo: string }).tipo),
    ['nuevo', 'nuevo'],
  );
});

test('un destino que no es https queda como envío fallido «destino-no-admitido», sin petición', async (t) => {
  const f = await autoridad(t);
  const avisar = crearAvisoProgramado({
    autoridad: f.autoridad,
    destino: () => destinoAvisoDelEntorno({ FARO_AVISO_URL: 'http://avisos.example/faro' }),
    panel: PANEL,
    pedir: async () => assert.fail('No enviar a un destino no admitido'),
  });
  assert.equal(await avisar(), 'fallido');
  assert.equal((await f.almacen.leerAvisoVigilante()).ultimoIntento?.motivo, 'destino-no-admitido');
});

test('el estado del panel dice si los avisos están configurados y el último intento, sin la dirección', () => {
  const base = {
    version: 1,
    origenDatos: 'recibo',
    evaluadoEn: CORTE_VIGILANTE,
    pulsoContinuo: 'no-instrumentado',
    entregaActiva: 'sin-observacion-actual',
    revision: 0,
    incidencias: [],
    areas: [],
    fechaDatos: [],
    ultimoTrabajo: null,
    eventosProgramados: [],
  };
  // Sin canal ni intentos, `avisos` no viaja: la respuesta conserva la forma que ya leía un panel anterior.
  assert.ok(!('avisos' in leerVigilantePanel(base)));
  for (const avisos of [
    { estado: 'no-configurados', ultimoIntento: { en: CORTE_VIGILANTE, resultado: 'enviado', motivo: null } },
    { estado: 'configurados', ultimoIntento: { en: CORTE_VIGILANTE, resultado: 'enviado', motivo: null } },
    { estado: 'configurados', ultimoIntento: { en: CORTE_VIGILANTE, resultado: 'fallido', motivo: 'sin-respuesta' } },
    { estado: 'destino-no-admitido', ultimoIntento: null },
  ]) {
    // La forma de un solo canal solo la emitía la URL: se lee como el canal `url`.
    assert.deepEqual(leerVigilantePanel({ ...base, avisos }).avisos, { canales: [{ canal: 'url', ...avisos }] });
  }
  for (const avisos of [
    undefined,
    { estado: 'no-configurados', ultimoIntento: null },
    { estado: 'configurados', destino: DESTINO, ultimoIntento: null },
    { estado: 'configurados', ultimoIntento: { en: CORTE_VIGILANTE, resultado: 'fallido', motivo: 'HTTP 500 cuerpo' } },
    { estado: 'configurados', ultimoIntento: { en: CORTE_VIGILANTE + 1, resultado: 'enviado', motivo: null } },
  ]) {
    assert.throws(() => leerVigilantePanel({ ...base, avisos }));
  }
});

test('una incidencia que se cierra sale de lo avisado: si vuelve, se avisa como nueva', () => {
  const ahora = CORTE_VIGILANTE;
  const ambas = prepararAvisoVigilante(null, [programador, fuente], { ahora, panel: PANEL })?.siguiente ?? null;
  assert.equal(prepararAvisoVigilante(ambas, [programador], { ahora: ahora + HORA_VIGILANTE, panel: PANEL }), null);
  const depurado = retirarIncidenciasCerradas(ambas, [programador]);
  assert.deepEqual(
    depurado?.incidencias.map((i) => i.clave),
    ['programador'],
  );
  assert.equal(depurado?.enviadoEn, ahora);
  const vuelve = prepararAvisoVigilante(depurado, [programador, fuente], {
    ahora: ahora + 2 * HORA_VIGILANTE,
    panel: PANEL,
  });
  assert.equal(vuelve?.cuerpo.tipo, 'nuevo');
  assert.equal(retirarIncidenciasCerradas(ambas, [programador, fuente]), null);
  assert.equal(retirarIncidenciasCerradas(ambas, []), null);
});

test('una configuración del vigilante no válida se avisa una vez, con su recordatorio, y deja de avisarse al corregirla', async (t) => {
  const f = await autoridad(t);
  const enviados: { tipo: string; decisiones: { clave: string; motivo: string }[] }[] = [];
  const avisar = (entrada: Parameters<typeof f.almacen.prepararAvisoVigilante>[0]) =>
    crearAvisoProgramado({
      autoridad: {
        ...f.autoridad,
        prepararAvisoVigilante: (panel) => f.almacen.prepararAvisoVigilante(entrada, panel),
      },
      destino: () => new URL(DESTINO),
      panel: PANEL,
      pedir: async (peticion) => {
        enviados.push((await (peticion as Request).json()) as (typeof enviados)[number]);
        return new Response(null, { status: 204 });
      },
    })();
  const noValida = { configuracionNoValida: true } as const;
  assert.equal(await avisar(noValida), 'enviado');
  assert.deepEqual(
    enviados.map((e) => [e.tipo, e.decisiones.map((d) => `${d.clave} · ${d.motivo}`)]),
    [['nuevo', ['vigilante · configuracion_no_valida']]],
  );
  // La misma incidencia no se repite el mismo día; al día siguiente sale su recordatorio.
  f.reloj.ahora += HORA_VIGILANTE;
  assert.equal(await avisar(noValida), 'sin-aviso');
  f.reloj.ahora += DIA_VIGILANTE;
  assert.equal(await avisar(noValida), 'enviado');
  assert.equal(enviados.at(-1)?.tipo, 'recordatorio');
  // Corregida, la incidencia sale de lo avisado: el vigilante vuelve a evaluarse con normalidad.
  f.reloj.ahora += HORA_VIGILANTE;
  await avisar({ configuracion: CONFIG_VIGILANTE, programada: PROGRAMADA_VIGILANTE });
  const ultimo = enviados.at(-1);
  assert.ok(ultimo && !ultimo.decisiones.some((d) => d.clave === 'vigilante'));
  assert.equal(ultimo.tipo, ultimo.decisiones.length === 0 ? 'resuelto' : 'nuevo');
});
