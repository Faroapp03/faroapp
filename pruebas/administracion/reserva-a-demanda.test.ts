/**
 * La ruta por la que un run lanzado a mano pide su reserva a demanda, de punta a punta por el Worker montado como en
 * producción y con la autoridad durable real. Cada negativa tiene su control positivo, y ninguna identidad defectuosa
 * llega a la autoridad: el doble del enlace durable cuenta cada llamada.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { ACCIONES_DEMANDA } from '../../src/administracion/configuracion-demanda.ts';
import type { ConfianzaOidcGitHub } from '../../src/administracion/oidc-github.ts';
import { crearReceptorReservaADemanda } from '../../src/administracion/reserva-a-demanda.ts';
import type { VariablesDelEntorno } from '../../src/comun/entorno.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { MS_POR_SEGUNDO } from '../../src/comun/tiempo.ts';
import { AccesoPublicoDurable, type EstadoAccesoPublicoDurable } from '../../src/plataforma/acceso-publico/durable.ts';
import { MOTIVOS_SOLICITUD } from '../../src/plataforma/acceso-publico/solicitudes-sqlite.ts';
import type { ValorSql } from '../../src/plataforma/acceso-publico/sqlite.ts';
import type { PeticionDemanda, ResultadoDemanda } from '../../src/plataforma/acceso-publico/trabajos-durable.ts';
import { esCanalDeMaquina } from '../../src/plataforma/cloudflare/canales-portal.ts';
import worker from '../../src/plataforma/cloudflare/worker.ts';
import { variablesDelServicio } from '../../src/plataforma/variables-del-servicio.ts';
import { alarmaDurableDePrueba } from '../ayudas/alarma-durable.ts';
import { objeto } from '../ayudas/objeto-json.ts';

const ORIGEN = 'https://panel.example';
const RUTA = '/mantenimiento/reserva';
const RUTA_DEMANDA_DURABLE = '/trabajos/demanda';
const TAM_SHA = 40;
const RSA_BITS = 2048;
const VIDA_TOKEN_S = 300;
const MAX_CUERPO = 1024;
const PLAZO_RECEPTOR_MS = 5000;
const ALGORITMO = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
/** Identificador y nombre de un actor sintético; nunca de una cuenta real. */
const ACTOR_ID = '1001';
const ACTOR = 'persona-sintetica';
const RUN = '789';
const CONFIANZA: ConfianzaOidcGitHub = {
  audiencia: `${ORIGEN}/mantenimiento/resultado`,
  repositorioId: '123',
  propietarioId: '456',
  ref: 'refs/heads/main',
  workflowRef: 'equipo/fuente/.github/workflows/actualizar.yml@refs/heads/main',
  sha: 'c'.repeat(TAM_SHA),
  workflowSha: 'd'.repeat(TAM_SHA),
};
const ACTUALIZACION = JSON.stringify({
  version: 1,
  confianza: CONFIANZA,
  destino: { propietario: 'equipo', repositorio: 'fuente', workflow: 'actualizar.yml', ref: 'main' },
});
const DEMANDA = {
  version: 1,
  habilitada: true,
  actores: [ACTOR_ID],
  separacionMin: 30,
  maxDia: 2,
  maxMes: { 'actualizar-datos': 2, 'comprobar-vencidas': 6, 'actualizar-cursos': 0 },
  presupuestoMinMes: 50_000,
  reservaProgramadaMin: 45,
};
const RESERVAR = { operacion: 'reservar', accion: 'actualizar-datos' };
const CONSULTAR = { operacion: 'consultar', accion: 'actualizar-datos' };

async function firmante() {
  const par = await crypto.subtle.generateKey(
    { ...ALGORITMO, modulusLength: RSA_BITS, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ['sign', 'verify'],
  );
  const jwk = { ...(await crypto.subtle.exportKey('jwk', par.publicKey)), kid: 'sintetica' };
  return {
    jwk,
    firmar: async (cambios: Record<string, unknown> = {}) => {
      const ahora = Math.floor(Date.now() / MS_POR_SEGUNDO);
      const afirmaciones = {
        iss: 'https://token.actions.githubusercontent.com',
        aud: CONFIANZA.audiencia,
        repository_id: CONFIANZA.repositorioId,
        repository_owner_id: CONFIANZA.propietarioId,
        ref: CONFIANZA.ref,
        workflow_ref: CONFIANZA.workflowRef,
        workflow_sha: CONFIANZA.workflowSha,
        sha: CONFIANZA.sha,
        run_id: RUN,
        run_attempt: '1',
        jti: 'jti-demanda-sintetico',
        event_name: 'workflow_dispatch',
        runner_environment: 'github-hosted',
        actor_id: ACTOR_ID,
        actor: ACTOR,
        iat: ahora,
        nbf: ahora,
        exp: ahora + VIDA_TOKEN_S,
        ...cambios,
      };
      const cabecera = Buffer.from(JSON.stringify({ alg: 'RS256', kid: jwk.kid })).toString('base64url');
      const texto = `${cabecera}.${Buffer.from(JSON.stringify(afirmaciones)).toString('base64url')}`;
      const firma = await crypto.subtle.sign(ALGORITMO, par.privateKey, new TextEncoder().encode(texto));
      return `${texto}.${Buffer.from(firma).toString('base64url')}`;
    },
  };
}
const GITHUB = firmante();
const AJENAS = firmante();

function estadoSqlite(db: DatabaseSync): EstadoAccesoPublicoDurable {
  return {
    storage: {
      ...alarmaDurableDePrueba(),
      sql: { exec: (sql: string, ...valores: ValorSql[]) => ({ toArray: () => db.prepare(sql).all(...valores) }) },
      transactionSync: <T>(accion: () => T): T => {
        db.exec('BEGIN IMMEDIATE');
        try {
          const valor = accion();
          db.exec('COMMIT');
          return valor;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      },
    },
  };
}
/** El Worker con su autoridad durable real sobre SQLite; `rutas` cuenta cada llamada al enlace durable. */
async function montaje(t: TestContext, cambios: Record<string, string | undefined> = {}) {
  const { jwk } = await GITHUB;
  t.mock.method(globalThis, 'fetch', async (entrada: string | URL | Request) => {
    assert.equal(new Request(entrada).url, 'https://token.actions.githubusercontent.com/.well-known/jwks');
    return Response.json({ keys: [jwk] });
  });
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const rutas: string[] = [];
  const disponibilidad = { caido: false };
  const variables: Record<string, string> = Object.fromEntries(
    Object.entries({
      FARO_ADMINISTRACION: 'si',
      FARO_ADMIN_ORIGEN: ORIGEN,
      FARO_ADMIN_ACCESS_EQUIPO: 'equipo-prueba',
      FARO_ADMIN_ACCESS_AUD: 'panel',
      FARO_ACCESS_AUD: 'publica',
      FARO_SECRETO_FIRMA: 'firma y credencial sintetica de mas de treinta y dos caracteres',
      FARO_ACTUALIZACION_GITHUB: ACTUALIZACION,
      FARO_ACTUALIZACION_GITHUB_TOKEN: 'token-sintetico-privado',
      FARO_ACTUALIZACION_DEMANDA: JSON.stringify(DEMANDA),
      ...cambios,
    }).flatMap(([nombre, valor]) => (valor === undefined ? [] : [[nombre, valor]])),
  );
  let durable: AccesoPublicoDurable | undefined;
  const espacio = {
    idFromName: (nombre: string) => nombre,
    get: () => ({
      fetch: async (peticion: Request) => {
        rutas.push(new URL(peticion.url).pathname);
        if (disponibilidad.caido) {
          throw new Error('fallo sintético del enlace durable');
        }
        durable ??= new AccesoPublicoDurable(estadoSqlite(db), variables as VariablesDelEntorno);
        return durable.fetch(peticion);
      },
    }),
  };
  const env = {
    ...variables,
    ASSETS: { fetch: async () => new Response('estático', { status: ESTADO_HTTP.noEncontrado }) },
    REGISTRO_SOCIOS: espacio,
  };
  const enviar = (peticion: Request) => worker.fetch(peticion, env);
  return { env, rutas, disponibilidad, enviar, llamadasDemanda: () => rutas.filter((r) => r === RUTA_DEMANDA_DURABLE) };
}
function peticion(token: string | null, cuerpo: unknown = RESERVAR, cambios: RequestInit = {}, ruta = RUTA) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== null) {
    headers.authorization = `Bearer ${token}`;
  }
  return new Request(`${ORIGEN}${ruta}`, {
    method: 'POST',
    headers,
    body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
    ...cambios,
  });
}
/** Estado, cuerpo exacto y todas las cabeceras: dos respuestas iguales aquí son iguales byte a byte. */
async function huella(respuesta: Response) {
  return {
    estado: respuesta.status,
    cuerpo: await respuesta.text(),
    cabeceras: [...respuesta.headers.entries()].sort(([a], [b]) => a.localeCompare(b)),
  };
}
async function json(respuesta: Response) {
  return { estado: respuesta.status, cuerpo: objeto(await respuesta.json()) };
}

test('reserva, la repite sin crear otra y la consulta desde un segundo intento del mismo run', async (t) => {
  const f = await montaje(t);
  const { firmar } = await GITHUB;
  const token = await firmar();
  const reservada = await json(await f.enviar(peticion(token)));
  assert.equal(reservada.estado, ESTADO_HTTP.correcto);
  assert.deepEqual(Object.keys(reservada.cuerpo).sort(), ['estado', 'revisionReserva', 'solicitudId']);
  assert.equal(reservada.cuerpo.estado, 'reservada');
  const repetida = await json(await f.enviar(peticion(token)));
  assert.deepEqual(repetida, { estado: ESTADO_HTTP.correcto, cuerpo: { ...reservada.cuerpo, estado: 'repetida' } });
  const segundoIntento = await firmar({ run_attempt: '2' });
  const consulta = await json(await f.enviar(peticion(segundoIntento, CONSULTAR)));
  assert.deepEqual(consulta, reservada);
  const otroRun = await firmar({ run_id: '790' });
  assert.deepEqual(await json(await f.enviar(peticion(otroRun, CONSULTAR))), {
    estado: ESTADO_HTTP.noEncontrado,
    cuerpo: { error: 'sin_reserva' },
  });
  assert.deepEqual(await json(await f.enviar(peticion(otroRun))), {
    estado: ESTADO_HTTP.conflicto,
    cuerpo: { error: 'ocupado' },
  });
  for (const texto of [JSON.stringify(reservada), JSON.stringify(consulta)]) {
    assert.ok(!texto.includes(ACTOR_ID) && !texto.includes(ACTOR) && !texto.includes(token));
  }
});

test('consultar en un segundo intento exige el mismo actor y el mismo evento que reservar', async (t) => {
  const f = await montaje(t);
  const { firmar } = await GITHUB;
  const ilegible = await huella(await f.enviar(peticion('a.b.c', CONSULTAR)));
  const reservada = await json(await f.enviar(peticion(await firmar())));
  assert.equal(reservada.estado, ESTADO_HTTP.correcto);
  const antes = f.rutas.length;
  for (const cambio of [{ actor_id: '2002' }, { event_name: 'push' }, { runner_environment: 'self-hosted' }]) {
    const token = await firmar({ ...cambio, run_attempt: '2' });
    assert.deepEqual(await huella(await f.enviar(peticion(token, CONSULTAR))), ilegible, JSON.stringify(cambio));
  }
  assert.equal(f.rutas.length, antes, 'ninguna consulta defectuosa llama al enlace durable');
  const consulta = await json(await f.enviar(peticion(await firmar({ run_attempt: '2' }), CONSULTAR)));
  assert.deepEqual(consulta, reservada);
});

test('cada identidad defectuosa recibe el 401 de un token ilegible y no llega a la autoridad', async (t) => {
  const f = await montaje(t);
  const { firmar } = await GITHUB;
  const ilegible = await huella(await f.enviar(peticion('a.b.c')));
  assert.equal(ilegible.estado, ESTADO_HTTP.noAutenticado);
  assert.deepEqual(objeto(JSON.parse(ilegible.cuerpo)), { error: 'no_autorizado' });
  assert.ok(ilegible.cabeceras.some(([nombre, valor]) => nombre === 'www-authenticate' && valor === 'Bearer'));
  const casos: readonly [string, () => Promise<Request>][] = [
    ['otra revisión', async () => peticion(await firmar({ sha: 'e'.repeat(TAM_SHA) }))],
    ['actor fuera de la lista', async () => peticion(await firmar({ actor_id: '2002' }))],
    ['otro evento', async () => peticion(await firmar({ event_name: 'push' }))],
    ['runner propio', async () => peticion(await firmar({ runner_environment: 'self-hosted' }))],
    ['firma inválida', async () => peticion(await (await AJENAS).firmar())],
    ['segundo intento al reservar', async () => peticion(await firmar({ run_attempt: '2' }))],
    ['token ausente', async () => peticion(null)],
    ['cuerpo mal formado sin identidad', async () => peticion('a.b.c', '{')],
  ];
  const antes = f.rutas.length;
  for (const [nombre, crear] of casos) {
    assert.deepEqual(await huella(await f.enviar(await crear())), ilegible, nombre);
  }
  assert.equal(f.rutas.length, antes, 'ninguna identidad defectuosa llama al enlace durable');
  // Control positivo: el mismo montaje, con el token sin el cambio, sí reserva.
  const reserva = await json(await f.enviar(peticion(await firmar())));
  assert.equal(reserva.estado, ESTADO_HTTP.correcto);
  assert.deepEqual(f.llamadasDemanda(), [RUTA_DEMANDA_DURABLE]);
  // Y es el mismo 401 que da hoy el permiso de inicio negado a esa reserva.
  const { solicitudId, revisionReserva } = reserva.cuerpo;
  const inicio = { solicitudId, revisionReserva, accion: 'actualizar-datos' };
  assert.deepEqual(await huella(await f.enviar(peticion('a.b.c', inicio, {}, '/mantenimiento/inicio'))), ilegible);
});

test('con la vía cerrada la ruta no existe, también con un token válido', async (t) => {
  const { firmar } = await GITHUB;
  const cerrada = { ...DEMANDA, habilitada: false };
  for (const [nombre, valor] of [
    ['ausente', undefined],
    ['deshabilitada', JSON.stringify(cerrada)],
    ['inválida', JSON.stringify({ ...DEMANDA, maxDia: 99 })],
    ['ilegible', '{'],
  ] as const) {
    await t.test(nombre, async (st) => {
      const f = await montaje(st, { FARO_ACTUALIZACION_DEMANDA: valor });
      const inexistente = await huella(await f.enviar(peticion(await firmar(), RESERVAR, {}, '/mantenimiento/otra')));
      assert.equal(inexistente.estado, ESTADO_HTTP.noEncontrado);
      assert.deepEqual(await huella(await f.enviar(peticion(await firmar()))), inexistente);
      assert.deepEqual(await huella(await f.enviar(peticion('a.b.c'))), inexistente);
      assert.deepEqual(f.llamadasDemanda(), []);
    });
  }
  const f = await montaje(t);
  assert.equal((await f.enviar(peticion(await firmar()))).status, ESTADO_HTTP.correcto);
});

test('el cuerpo se lee estrictamente y solo después de una identidad válida', async (t) => {
  const f = await montaje(t);
  const { firmar } = await GITHUB;
  const token = await firmar();
  const invalidos: readonly unknown[] = [
    '{',
    '[]',
    'null',
    { ...RESERVAR, extra: 1 },
    { operacion: 'reservar' },
    { operacion: 'borrar', accion: 'actualizar-datos' },
    { operacion: 'reservar', accion: 'reintentar-pendientes' },
    { operacion: 'reservar', accion: 'comprobar-programada' },
  ];
  for (const cuerpo of invalidos) {
    assert.equal((await f.enviar(peticion('a.b.c', cuerpo))).status, ESTADO_HTTP.noAutenticado);
    assert.deepEqual(await json(await f.enviar(peticion(token, cuerpo))), {
      estado: ESTADO_HTTP.solicitudIncorrecta,
      cuerpo: { error: 'solicitud_invalida' },
    });
  }
  assert.deepEqual(f.llamadasDemanda(), []);
  assert.equal((await f.enviar(peticion(token))).status, ESTADO_HTTP.correcto);
});

test('la frontera: cuerpo de más de 1 KiB, método y tipo incorrectos', async (t) => {
  const f = await montaje(t);
  const { firmar } = await GITHUB;
  const token = await firmar();
  const grande = JSON.stringify({ ...RESERVAR, relleno: 'x'.repeat(MAX_CUERPO) });
  assert.equal((await f.enviar(peticion('a.b.c', grande))).status, ESTADO_HTTP.noAutenticado);
  assert.equal((await f.enviar(peticion(token, grande))).status, ESTADO_HTTP.demasiadoGrande);
  const declarado = peticion(token, RESERVAR, { headers: {} });
  const conLongitud = new Request(declarado, {
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'content-length': '2048' },
  });
  assert.equal((await f.enviar(conLongitud)).status, ESTADO_HTTP.demasiadoGrande);
  const metodo = await f.enviar(new Request(`${ORIGEN}${RUTA}`, { headers: { authorization: `Bearer ${token}` } }));
  assert.equal(metodo.status, ESTADO_HTTP.metodoNoAdmitido);
  assert.equal(metodo.headers.get('allow'), 'POST');
  const tipo = new Request(`${ORIGEN}${RUTA}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'text/plain' },
    body: JSON.stringify(RESERVAR),
  });
  assert.equal((await f.enviar(tipo)).status, ESTADO_HTTP.tipoNoAdmitido);
  assert.deepEqual(f.llamadasDemanda(), []);
  assert.equal((await f.enviar(peticion(token))).status, ESTADO_HTTP.correcto);
});

test('los topes de la autoridad llegan como 409 con su motivo exacto', async (t) => {
  const { firmar } = await GITHUB;
  const cursos = { operacion: 'reservar', accion: 'actualizar-cursos' };
  const f = await montaje(t);
  assert.deepEqual(await json(await f.enviar(peticion(await firmar(), cursos))), {
    estado: ESTADO_HTTP.conflicto,
    cuerpo: { error: 'tope_mes' },
  });
  const sinMinutos = await montaje(t, {
    FARO_ACTUALIZACION_DEMANDA: JSON.stringify({ ...DEMANDA, presupuestoMinMes: 1 }),
  });
  assert.deepEqual(await json(await sinMinutos.enviar(peticion(await firmar()))), {
    estado: ESTADO_HTTP.conflicto,
    cuerpo: { error: 'presupuesto' },
  });
  assert.equal((await f.enviar(peticion(await firmar()))).status, ESTADO_HTTP.correcto);
});

test('con la autoridad caída responde 503, sin nada del token', async (t) => {
  const f = await montaje(t);
  const { firmar } = await GITHUB;
  const token = await firmar();
  assert.equal((await f.enviar(peticion('a.b.c'))).status, ESTADO_HTTP.noAutenticado);
  f.disponibilidad.caido = true;
  const caida = await json(await f.enviar(peticion(token)));
  assert.deepEqual(caida, { estado: ESTADO_HTTP.noDisponible, cuerpo: { error: 'no_disponible' } });
  f.disponibilidad.caido = false;
  assert.equal((await f.enviar(peticion(token))).status, ESTADO_HTTP.correcto);
});

/**
 * El receptor con una autoridad doble: cada motivo de la lista cerrada y el plazo agotado. `descargas` cuenta las
 * veces que se pide el juego de claves de GitHub.
 */
async function receptorConDoble(
  t: TestContext,
  operar: (p: PeticionDemanda) => Promise<ResultadoDemanda>,
  descargas = { n: 0 },
) {
  const { jwk } = await GITHUB;
  const pedir: typeof fetch = async () => {
    descargas.n += 1;
    return Response.json({ keys: [jwk] });
  };
  t.mock.method(globalThis, 'fetch', pedir);
  return crearReceptorReservaADemanda({
    origen: ORIGEN,
    confianza: CONFIANZA,
    configuracionDemanda: JSON.stringify(DEMANDA),
    almacen: { operarDemanda: operar },
    pedir,
  });
}
test('cada motivo de rechazo de la autoridad sale tal cual en el 409', async (t) => {
  const motivos = [
    'ocupado',
    'activacion_pendiente',
    'candidato_en_plazo',
    'separacion',
    'tope_dia',
    'tope_mes',
    'presupuesto',
  ] as const;
  const token = await (await GITHUB).firmar();
  for (const motivo of motivos) {
    const recibir = await receptorConDoble(t, async () => ({ estado: 'rechazada', motivo }));
    assert.deepEqual(await json(await recibir(peticion(token))), {
      estado: ESTADO_HTTP.conflicto,
      cuerpo: { error: motivo },
    });
  }
});
test('un token se verifica una sola vez, con un solo juego de claves, sea cual sea su intento', async (t) => {
  const { firmar } = await GITHUB;
  const descargas = { n: 0 };
  const operar = async (): Promise<ResultadoDemanda> => ({ estado: 'sin_reserva' });
  const recibir = await receptorConDoble(t, operar, descargas);
  const rechazado = await huella(await recibir(peticion(await firmar({ actor_id: '2002', run_attempt: '2' }))));
  assert.equal(rechazado.estado, ESTADO_HTTP.noAutenticado);
  assert.equal(descargas.n, 1, 'un token rechazado se lee una vez');
  const consulta = await recibir(peticion(await firmar({ run_attempt: '2' }), CONSULTAR));
  assert.equal(consulta.status, ESTADO_HTTP.noEncontrado);
  const reintento = await huella(await recibir(peticion(await firmar({ run_attempt: '2' }))));
  assert.deepEqual(reintento, rechazado, 'un reintento que reserva recibe el mismo 401');
  assert.equal(descargas.n, 1, 'las claves se guardan en un solo sitio');
});

interface CasoDelContrato {
  readonly nombre: string;
  readonly peticion: { readonly operacion: 'reservar' | 'consultar'; readonly accion: string };
  readonly autoridad: ResultadoDemanda;
  readonly respuesta: { readonly estado: number; readonly cuerpo: Record<string, unknown> };
}
const CONTRATO = objeto(
  JSON.parse(readFileSync(new URL('../fixtures/contrato-reserva-a-demanda.json', import.meta.url), 'utf8')),
) as { acciones: string[]; motivosDeRechazo: string[]; casos: CasoDelContrato[] };
test('el contrato común con el paso del workflow: cada caso, del cuerpo a la respuesta', async (t) => {
  const SOLO_PROGRAMADA: readonly string[] = ['requiere_atencion', 'fuera_de_ventana'];
  assert.deepEqual([...ACCIONES_DEMANDA].sort(), [...CONTRATO.acciones].sort());
  const motivos = MOTIVOS_SOLICITUD.filter((m) => !SOLO_PROGRAMADA.includes(m));
  assert.deepEqual([...motivos].sort(), [...CONTRATO.motivosDeRechazo].sort());
  const { firmar } = await GITHUB;
  for (const caso of CONTRATO.casos) {
    const recibidas: PeticionDemanda[] = [];
    const recibir = await receptorConDoble(t, async (p) => {
      recibidas.push(p);
      return caso.autoridad;
    });
    // La consulta la hace la activación en un intento posterior; la reserva, el primero.
    const intento = caso.peticion.operacion === 'consultar' ? '2' : '1';
    const respuesta = await json(await recibir(peticion(await firmar({ run_attempt: intento }), caso.peticion)));
    assert.deepEqual(respuesta, caso.respuesta, caso.nombre);
    assert.equal(recibidas.length, 1, caso.nombre);
    const recibida = recibidas[0];
    assert.equal(recibida?.operacion, caso.peticion.operacion, caso.nombre);
    if (recibida?.operacion === 'reservar') {
      assert.equal(recibida.accion, caso.peticion.accion, caso.nombre);
    }
  }
});

test('si la autoridad no responde a tiempo, 504', async (t) => {
  const token = await (await GITHUB).firmar();
  let llamada: () => void = () => undefined;
  const llamado = new Promise<void>((resolver) => {
    llamada = resolver;
  });
  const recibir = await receptorConDoble(t, () => {
    llamada();
    return new Promise<ResultadoDemanda>(() => undefined);
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const respuesta = recibir(peticion(token));
  await llamado;
  t.mock.timers.tick(PLAZO_RECEPTOR_MS);
  assert.deepEqual(await json(await respuesta), {
    estado: ESTADO_HTTP.tiempoAgotado,
    cuerpo: { error: 'plazo_agotado' },
  });
});

test('la ruta es un canal de máquina solo por POST, y la variable es del servicio', () => {
  const canal = (method: string) => esCanalDeMaquina(new Request(`${ORIGEN}${RUTA}`, { method }));
  assert.equal(canal('POST'), true);
  assert.equal(canal('GET'), false);
  assert.deepEqual(variablesDelServicio({ FARO_ACTUALIZACION_DEMANDA: JSON.stringify(DEMANDA) }), {
    FARO_ACTUALIZACION_DEMANDA: JSON.stringify(DEMANDA),
  });
});
