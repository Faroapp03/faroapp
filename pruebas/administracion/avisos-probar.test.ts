/**
 * La ruta `avisos/probar`, montada como en el Worker sobre el objeto durable con SQLite local y un enlace de correo
 * falso que captura el mensaje: ningún correo sale. Cubre el envío de prueba, su límite, la sesión, el canal ausente
 * y la guardia de que la dirección solo va dentro del mensaje.
 */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { prepararAvisoVigilante } from '../../src/administracion/aviso-vigilante.ts';
import type { CanalCorreo } from '../../src/administracion/envio-aviso-correo.ts';
import type { MensajeCorreo } from '../../src/administracion/mensaje-aviso-correo.ts';
import { conPruebaDeCorreo, ESPERA_ENTRE_PRUEBAS_MS } from '../../src/administracion/prueba-aviso-correo.ts';
import type { AccesoSesionPanel } from '../../src/administracion/sesion.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { esObjeto } from '../../src/comun/json.ts';
import { AlmacenAvisosDestinoDurable } from '../../src/plataforma/acceso-publico/avisos-destino-cliente-durable.ts';
import { RUTAS_AVISOS_DURABLE } from '../../src/plataforma/acceso-publico/avisos-destino-durable.ts';
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

function peticion(ruta: string, token: string, cuerpo: unknown = {}): Request {
  return new Request(`${ORIGEN}/administracion/api/${ruta}`, {
    method: 'POST',
    body: JSON.stringify(cuerpo),
    headers: {
      origin: ORIGEN,
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
      'x-faro-panel': '1',
      'x-faro-sesion': token,
      'cf-access-jwt-assertion': 'prueba',
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
/** El montaje del Worker con el destino de los avisos y su prueba por un enlace de correo falso. */
async function montaje(t: TestContext, canal: CanalCorreo | undefined, ahora: () => number) {
  const variables = { FARO_VIGILANTE: JSON.stringify({ ...CONFIG_VIGILANTE, activadoEn: Date.now() - SEGUNDO_MS }) };
  const durable = objetoDurable(t, variables);
  const almacen = new AlmacenVigilanteDurable(durable.espacio);
  const avisos = new AlmacenAvisosDestinoDurable(durable.espacio);
  const conPrueba = conPruebaDeCorreo(avisos, { canal, panel: `${ORIGEN}/administracion/`, ahora });
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
    avisos: conPrueba,
    inicial: POLITICA,
  });
  await almacen.prepararTrabajos();
  await almacen.prepararActivacion();
  return { ...durable, almacen, avisos, panel };
}
async function abrir(panel: AdministracionMontada): Promise<string> {
  const respuesta = await panel.responder(peticion('sesion/abrir', ''));
  assert.equal(respuesta.status, ESTADO_HTTP.correcto);
  const cuerpo: unknown = await respuesta.json();
  assert.ok(esObjeto(cuerpo) && typeof cuerpo.token === 'string');
  return cuerpo.token;
}
async function json(respuesta: Response): Promise<Record<string, unknown>> {
  const cuerpo: unknown = await respuesta.json();
  assert.ok(esObjeto(cuerpo));
  return cuerpo;
}
/** El enlace falso: guarda cada mensaje; `antes` corre al recibirlo y puede lanzar como lo haría Email Routing. */
function enlaceFalso(antes: (mensaje: MensajeCorreo) => Promise<void> = async () => undefined) {
  const enviados: MensajeCorreo[] = [];
  const canal: CanalCorreo = {
    remitente: 'avisos@panel.example',
    enlace: {
      send: async (mensaje) => {
        await antes(mensaje);
        enviados.push(mensaje);
        return { messageId: 'falso' };
      },
    },
  };
  return { canal, enviados };
}

test('probar: sin destino no sale nada; con la dirección guardada sale una prueba y la siguiente espera', async (t) => {
  let ahora = Date.now();
  const { canal, enviados } = enlaceFalso();
  const m = await montaje(t, canal, () => ahora);
  const token = await abrir(m.panel);
  const sinDestino = await json(await m.panel.responder(peticion('avisos/probar', token)));
  assert.deepEqual(sinDestino.prueba, { resultado: 'no-enviado', motivo: 'sin-destino' });
  await m.panel.responder(peticion('avisos/cambiar', token, { revisionEsperada: 0, correo: CORREO }));
  const respuestas: string[] = [];
  const primera = await m.panel.responder(peticion('avisos/probar', token));
  assert.equal(primera.status, ESTADO_HTTP.correcto);
  const texto = await primera.text();
  respuestas.push(texto);
  assert.deepEqual(JSON.parse(texto).prueba, { resultado: 'enviado' });
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0]?.to, CORREO);
  const limitada = await m.panel.responder(peticion('avisos/probar', token));
  const textoLimitada = await limitada.text();
  respuestas.push(textoLimitada);
  assert.deepEqual(JSON.parse(textoLimitada).prueba, { resultado: 'no-enviado', motivo: 'limite-de-pruebas' });
  ahora += ESPERA_ENTRE_PRUEBAS_MS;
  respuestas.push(await (await m.panel.responder(peticion('avisos/probar', token))).text());
  assert.equal(enviados.length, 2);
  // Guardia: ninguna respuesta de la prueba ni del enlace privado (salvo las lecturas del destino) lleva la dirección.
  const lecturas = new Set<string>([RUTAS_AVISOS_DURABLE.leer, RUTAS_AVISOS_DURABLE.destino]);
  const privadas = m.respuestas.filter((r) => !lecturas.has(r.ruta));
  assert.ok(m.respuestas.some((r) => lecturas.has(r.ruta) && r.texto.includes(CORREO)));
  for (const salida of [...respuestas, ...privadas.map((r) => r.texto)]) {
    assert.ok(!salida.includes('@example.org'), salida.slice(0, MUESTRA));
  }
  assert.ok(enviados.every((e) => e.to === CORREO));
});

test('probar: sin sesión no se envía y sin canal de correo la prueba lo dice', async (t) => {
  const { canal, enviados } = enlaceFalso();
  const m = await montaje(t, canal, Date.now);
  const token = await abrir(m.panel);
  await m.panel.responder(peticion('avisos/cambiar', token, { revisionEsperada: 0, correo: CORREO }));
  const sinToken = await m.panel.responder(peticion('avisos/probar', ''));
  assert.equal(sinToken.status, ESTADO_HTTP.prohibido);
  const conCuerpo = await m.panel.responder(peticion('avisos/probar', token, { correo: CORREO }));
  assert.equal(conCuerpo.status, ESTADO_HTTP.solicitudIncorrecta);
  assert.equal(enviados.length, 0);
  const sinCanal = await montaje(t, undefined, Date.now);
  const otro = await abrir(sinCanal.panel);
  const respuesta = await json(await sinCanal.panel.responder(peticion('avisos/probar', otro)));
  assert.deepEqual(respuesta.prueba, { resultado: 'no-enviado', motivo: 'canal-no-configurado' });
});

test('verificar: una prueba aceptada deja la dirección verificada y solo entonces sale el aviso diario', async (t) => {
  const { canal, enviados } = enlaceFalso();
  const m = await montaje(t, canal, Date.now);
  const token = await abrir(m.panel);
  await m.panel.responder(peticion('avisos/cambiar', token, { revisionEsperada: 0, correo: CORREO }));
  const aviso = crearAvisoProgramado({
    autoridad: {
      prepararAvisoVigilante: async (panel) =>
        prepararAvisoVigilante(null, [{ clave: 'programador', motivo: 'evento_esperado_sin_registro' }], {
          ahora: Date.now(),
          panel,
        }),
      registrarEnvioAviso: async () => ({}),
    },
    destino: () => undefined,
    panel: `${ORIGEN}/administracion/`,
    correo: { canal, destino: () => m.avisos.leerDestinoParaAvisar() },
  });
  assert.equal(await aviso(), 'no-configurados');
  assert.equal(enviados.length, 0);
  const prueba = await json(await m.panel.responder(peticion('avisos/probar', token)));
  assert.deepEqual(prueba.prueba, { resultado: 'enviado' });
  assert.ok(esObjeto(prueba.destino) && prueba.destino.verificacion === 'verificado' && prueba.destino.revision === 1);
  assert.equal((await m.avisos.leerDestinoParaAvisar()).verificacion, 'verificado');
  assert.equal(await aviso(), 'enviado');
  assert.equal(enviados.length, 2);
  // Guardar otra dirección la devuelve a pendiente y el aviso diario deja de salir.
  await m.panel.responder(peticion('avisos/cambiar', token, { revisionEsperada: 1, correo: 'otra@example.org' }));
  assert.equal((await m.avisos.leerDestinoParaAvisar()).verificacion, 'pendiente');
  assert.equal(await aviso(), 'no-configurados');
});

test('verificar: si la dirección cambia mientras sale la prueba, la nueva sigue pendiente', async (t) => {
  let cambiar: () => Promise<unknown> = async () => undefined;
  const { canal } = enlaceFalso(async () => {
    await cambiar();
  });
  const m = await montaje(t, canal, Date.now);
  const token = await abrir(m.panel);
  await m.panel.responder(peticion('avisos/cambiar', token, { revisionEsperada: 0, correo: CORREO }));
  cambiar = () =>
    m.panel.responder(peticion('avisos/cambiar', token, { revisionEsperada: 1, correo: 'otra@example.org' }));
  const prueba = await json(await m.panel.responder(peticion('avisos/probar', token)));
  assert.deepEqual(prueba.prueba, { resultado: 'enviado' });
  assert.ok(esObjeto(prueba.destino) && prueba.destino.verificacion === 'pendiente' && prueba.destino.revision === 2);
  const destino = await m.avisos.leerDestinoParaAvisar();
  assert.equal(destino.verificacion, 'pendiente');
  assert.equal(destino.correo, 'otra@example.org');
});

test('verificar: un rechazo del enlace da su motivo cerrado, sin la dirección, y no cambia el estado', async (t) => {
  let ahora = Date.now();
  let error: Error = new Error('');
  const { canal, enviados } = enlaceFalso(async () => {
    throw error;
  });
  const m = await montaje(t, canal, () => ahora);
  const token = await abrir(m.panel);
  await m.panel.responder(peticion('avisos/cambiar', token, { revisionEsperada: 0, correo: CORREO }));
  const conCodigo = (code: string) => Object.assign(new Error(`rechazado para ${CORREO}`), { code });
  for (const [causa, motivo] of [
    [conCodigo('E_SENDER_NOT_VERIFIED'), 'remitente-no-configurado'],
    [conCodigo('E_RECIPIENT_PLAN_RESTRICTED'), 'destinatario-no-permitido'],
    [conCodigo('E_DAILY_LIMIT_EXCEEDED'), 'limite-alcanzado'],
    [new TypeError(`to: ${CORREO}`), 'envio-rechazado'],
  ] as const) {
    error = causa;
    ahora += ESPERA_ENTRE_PRUEBAS_MS;
    const texto = await (await m.panel.responder(peticion('avisos/probar', token))).text();
    assert.ok(!texto.includes('@example.org'), texto.slice(0, MUESTRA));
    const respuesta = JSON.parse(texto);
    assert.deepEqual(respuesta.prueba, { resultado: 'fallido', motivo });
    assert.equal(respuesta.destino.verificacion, 'pendiente');
  }
  assert.equal(enviados.length, 0);
  assert.equal((await m.avisos.leerDestinoParaAvisar()).verificacion, 'pendiente');
});
