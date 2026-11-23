/** El aviso de un inicio rechazado sale en segundo plano en cuanto se registra, una vez, y nunca toca la respuesta. */
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { destinoAvisoDelEntorno } from '../../src/administracion/envio-aviso.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { MS_POR_SEGUNDO } from '../../src/comun/tiempo.ts';
import { crearAvisoProgramado } from '../../src/plataforma/aviso-programado.ts';
import { crearAvisoInicioRechazado } from '../../src/plataforma/cloudflare/aviso-inicio-rechazado.ts';
import { CLAVES_GITHUB, otraRevision, reservaQueEsperaInicio } from '../ayudas/inicio-rechazado.ts';
import { CONFIG_VIGILANTE, PROGRAMADA_VIGILANTE } from '../ayudas/vigilante.ts';

const PANEL = 'https://panel.example/administracion/';
const DESTINO = 'https://avisos.example/faro';
const ACEPTADO = 202;
type Enviado = { tipo: string; decisiones: { clave: string; motivo: string }[] };
type Reserva = Awaited<ReturnType<typeof reservaQueEsperaInicio>>;

interface Canal {
  readonly destino?: string;
  readonly responder?: () => Promise<Response>;
  readonly prepararFalla?: boolean;
}
/** El mismo aviso que monta Cloudflare, sobre la autoridad SQLite de la prueba y un destino sintético. */
function avisoDeLaPrueba(reserva: () => Reserva, canal: Canal = {}) {
  const cuenta = { preparados: 0, enviados: [] as Enviado[] };
  const destino = () => destinoAvisoDelEntorno(canal.destino === undefined ? {} : { FARO_AVISO_URL: canal.destino });
  const avisar = crearAvisoProgramado({
    autoridad: {
      prepararAvisoVigilante: (panel: string) => {
        cuenta.preparados++;
        if (canal.prepararFalla) {
          return Promise.reject(new Error('autoridad sintética caída'));
        }
        const entrada = { configuracion: CONFIG_VIGILANTE, programada: PROGRAMADA_VIGILANTE };
        return reserva().almacen.prepararAvisoVigilante(entrada, panel);
      },
      registrarEnvioAviso: (e) => reserva().almacen.registrarEnvioAviso(e),
    },
    destino,
    panel: PANEL,
    pedir: async (entrada) => {
      assert.ok(entrada instanceof Request);
      cuenta.enviados.push((await entrada.json()) as Enviado);
      return canal.responder ? canal.responder() : new Response(null, { status: ACEPTADO });
    },
  });
  return { cuenta, avisarRechazo: crearAvisoInicioRechazado(avisar, destino) };
}
/** Reserva con el aviso conectado y un `waitUntil` que guarda las tareas en segundo plano. */
async function montaje(t: TestContext, canal?: Canal) {
  let reserva: Reserva | undefined;
  const aviso = avisoDeLaPrueba(() => reserva ?? assert.fail('Reserva sin montar'), canal);
  reserva = await reservaQueEsperaInicio(t, aviso.avisarRechazo);
  const tareas: Promise<unknown>[] = [];
  const enSegundoPlano = (tarea: Promise<unknown>) => {
    tareas.push(tarea);
  };
  const { firmar } = await CLAVES_GITHUB;
  const rechazar = async () => reserva.pedirInicio(await firmar(otraRevision({}, reserva.reloj.ahora)), enSegundoPlano);
  return { reserva, cuenta: aviso.cuenta, tareas, rechazar };
}
const conRechazo = (e: Enviado) => e.decisiones.some((d) => d.clave === 'ejecutor' && d.motivo === 'inicio_rechazado');

test('un rechazo registrado envía un solo aviso en segundo plano; uno repetido, ninguno', async (t) => {
  const m = await montaje(t, { destino: DESTINO });
  assert.equal((await m.rechazar()).estado, ESTADO_HTTP.noAutenticado);
  assert.equal(m.tareas.length, 1);
  await Promise.all(m.tareas);
  assert.deepEqual(
    m.cuenta.enviados.map((e) => [e.tipo, conRechazo(e)]),
    [['nuevo', true]],
  );
  m.reserva.reloj.ahora += MS_POR_SEGUNDO;
  assert.equal((await m.rechazar()).estado, ESTADO_HTTP.noAutenticado);
  assert.equal(m.tareas.length, 1);
  assert.equal(m.cuenta.enviados.length, 1);
});

test('la respuesta no espera al aviso: sale igual aunque el aviso no termine nunca', async (t) => {
  const tareas: Promise<unknown>[] = [];
  const reserva = await reservaQueEsperaInicio(t, () => new Promise<void>(() => {}));
  const { firmar } = await CLAVES_GITHUB;
  const respuesta = await reserva.pedirInicio(await firmar(otraRevision()), (tarea) => tareas.push(tarea));
  assert.equal(respuesta.estado, ESTADO_HTTP.noAutenticado);
  assert.equal(tareas.length, 1);
  assert.equal(
    (await reserva.almacen.leerTrabajoPrivado()).ultimoTrabajo?.inicioRechazado?.motivo,
    'revision_no_autorizada',
  );
});

test('un envío fallido o una autoridad caída no cambian la respuesta ni dejan el hecho sin guardar', async (t) => {
  const canales: [string, Canal][] = [
    ['destino que responde 500', { destino: DESTINO, responder: async () => new Response(null, { status: 500 }) }],
    ['destino sin respuesta', { destino: DESTINO, responder: () => Promise.reject(new TypeError('sin conexión')) }],
    ['autoridad del aviso caída', { destino: DESTINO, prepararFalla: true }],
  ];
  for (const [nombre, canal] of canales) {
    await t.test(nombre, async (st) => {
      const registro = st.mock.method(console, 'error', () => undefined);
      const m = await montaje(st, canal);
      const respuesta = await m.rechazar();
      assert.equal(respuesta.estado, ESTADO_HTTP.noAutenticado);
      assert.deepEqual(respuesta.cuerpo, { error: 'no_autorizado' });
      await Promise.all(m.tareas);
      const privado = await m.reserva.almacen.leerTrabajoPrivado();
      assert.equal(privado.ultimoTrabajo?.inicioRechazado?.motivo, 'revision_no_autorizada');
      assert.equal(registro.mock.callCount(), canal.prepararFalla ? 1 : 0);
    });
  }
});

test('sin destino configurado no se evalúa ni se envía nada', async (t) => {
  const m = await montaje(t);
  assert.equal((await m.rechazar()).estado, ESTADO_HTTP.noAutenticado);
  await Promise.all(m.tareas);
  assert.deepEqual([m.cuenta.preparados, m.cuenta.enviados.length], [0, 0]);
});

test('sin segundo plano (el servidor Node, que no envía avisos) el rechazo se guarda y no se intenta el aviso', async (t) => {
  let llamadas = 0;
  const reserva = await reservaQueEsperaInicio(t, async () => {
    llamadas++;
  });
  const { firmar } = await CLAVES_GITHUB;
  assert.equal((await reserva.pedirInicio(await firmar(otraRevision()))).estado, ESTADO_HTTP.noAutenticado);
  assert.equal(llamadas, 0);
  assert.equal(
    (await reserva.almacen.leerTrabajoPrivado()).ultimoTrabajo?.inicioRechazado?.motivo,
    'revision_no_autorizada',
  );
});
