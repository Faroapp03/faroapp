/** Binding privado sobre SQLite real. No acredita despliegue o evicción real en Cloudflare. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import type { PoliticaControles } from '../../src/administracion/controles.ts';
import type { ConfianzaOidcGitHub, IdentidadEjecucionGitHub } from '../../src/administracion/oidc-github.ts';
import {
  type EvidenciaEjecucionCompletada,
  leerEstadoTrabajos,
  leerResultadoLecturaTrabajo,
  type ReciboTrabajo,
  type ResultadoReservaTrabajo,
} from '../../src/administracion/trabajos.ts';
import {
  AccesoPublicoDurable,
  AlmacenPublicoNoDisponible,
  type EspacioAccesoPublicoDurable,
  type EstadoAccesoPublicoDurable,
} from '../../src/plataforma/acceso-publico/durable.ts';
import { SesionUnicaDurable } from '../../src/plataforma/acceso-publico/sesion-unica-cliente-durable.ts';
import type { ValorSql } from '../../src/plataforma/acceso-publico/sqlite.ts';
import {
  MAX_MENSAJE_TRABAJO_DURABLE,
  MAX_RESPUESTA_TRABAJO_DURABLE,
} from '../../src/plataforma/acceso-publico/trabajos-durable.ts';
import { sembrarSocioPersistido } from '../ayudas/registro-persistido-anterior.ts';
import { abrirSesionDePrueba } from '../ayudas/sesion-de-prueba.ts';

const TAM_HUELLA = 64;
const TAM_SHA = 40;
const TAM_VERSION = 16;
const TAM_JTI_API = 22;
const SEGUNDO = 1000;
const VALIDEZ_S = 60;
const HTTP_INVALIDO = 400;
const HTTP_CORRECTO = 200;
const LIMITE_ANTERIOR_RESPUESTA = 2048;
const PLAZO_PRUEBA_MS = 20;
const ID = '11111111-1111-4111-8111-111111111111';
const OTRO_ID = '22222222-2222-4222-8222-222222222222';
const ACCESO = { huellaSesion: 'a'.repeat(TAM_HUELLA), huellaPrincipal: 'b'.repeat(TAM_HUELLA) };
/** La misma persona en otro dispositivo: con la sesión única es la única que puede sustituir una sesión viva. */
const OTRO_ACCESO = { huellaSesion: 'c'.repeat(TAM_HUELLA), huellaPrincipal: 'b'.repeat(TAM_HUELLA) };
const CONFIANZA: ConfianzaOidcGitHub = {
  audiencia: 'https://recibos.prueba',
  repositorioId: '123',
  propietarioId: '456',
  ref: 'refs/heads/main',
  workflowRef: 'equipo/fuente/.github/workflows/actualizar.yml@refs/heads/main',
  sha: 'a'.repeat(TAM_SHA),
  workflowSha: 'b'.repeat(TAM_SHA),
};
const SOLICITUD = { solicitudId: ID, accion: 'actualizar-datos', revisionEsperada: 0 } as const;
const POLITICA: PoliticaControles = {
  version: 2,
  api: 'habilitada',
  mcp: false,
  a2a: false,
};
const ENTORNO = {};
function identidad(): IdentidadEjecucionGitHub {
  const { audiencia: _audiencia, ...pins } = CONFIANZA;
  const ahora = Math.floor(Date.now() / SEGUNDO);
  return {
    ...pins,
    runId: '789',
    runAttempt: '1',
    jti: 'jti-sintetico',
    emitidoEn: ahora,
    caducaEn: ahora + VALIDEZ_S,
  };
}
function evidencia(): EvidenciaEjecucionCompletada {
  return {
    estado: 'completed',
    evento: 'workflow_dispatch',
    runId: '789',
    runAttempt: '1',
    repositorioId: CONFIANZA.repositorioId,
    propietarioId: CONFIANZA.propietarioId,
    sha: CONFIANZA.sha,
    workflowPath: '.github/workflows/actualizar.yml',
    conclusion: 'cancelled',
  };
}
const REFERENCIA = { solicitudId: ID, revisionReserva: 1 };
const INICIO = { ...REFERENCIA, accion: 'actualizar-datos' } as const;
function recibo(): ReciboTrabajo {
  return {
    solicitudId: ID,
    revisionReserva: 1,
    accion: 'actualizar-datos',
    resultado: 'validado',
    veredicto: 'verde',
    terminadoEn: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    huellaPaquete: 'f'.repeat(TAM_VERSION),
    error: null,
  };
}
function trabajo(resultado: ResultadoReservaTrabajo) {
  assert.ok('trabajos' in resultado && resultado.trabajos.ultimoTrabajo);
  return resultado.trabajos.ultimoTrabajo;
}
function transaccion<T>(db: DatabaseSync, accion: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const resultado = accion();
    db.exec('COMMIT');
    return resultado;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
function montaje(t: test.TestContext) {
  const db = new DatabaseSync(':memory:');
  let consultas = 0;
  const estado: EstadoAccesoPublicoDurable = {
    storage: {
      sql: {
        exec: (sql: string, ...valores: ValorSql[]) => ({
          toArray: () => {
            consultas++;
            return db.prepare(sql).all(...valores);
          },
        }),
      },
      transactionSync: <T>(accion: () => T): T => transaccion(db, accion),
    },
  };
  let servidor = new AccesoPublicoDurable(estado, ENTORNO);
  const nombres: string[] = [];
  const espacio: EspacioAccesoPublicoDurable = {
    idFromName: (nombre) => {
      nombres.push(nombre);
      return nombre;
    },
    get: (id) => {
      assert.equal(id, 'registro-publico-v1');
      return { fetch: (p) => servidor.fetch(p) };
    },
  };
  t.after(() => db.close());
  return {
    db,
    espacio,
    nombres,
    uno: new SesionUnicaDurable(espacio),
    dos: new SesionUnicaDurable(espacio),
    reiniciar: () => {
      servidor = new AccesoPublicoDurable(estado, ENTORNO);
    },
    consultas: () => consultas,
    fetch: (p: Request) => servidor.fetch(p),
    enviar: (ruta: string, cuerpo: unknown) =>
      servidor.fetch(
        new Request(`https://registro-socios.invalid${ruta}`, { method: 'POST', body: JSON.stringify(cuerpo) }),
      ),
  };
}
async function preparar(m: ReturnType<typeof montaje>) {
  await m.uno.prepararPanel(POLITICA);
  await abrirSesionDePrueba(m.uno, ACCESO);
  await m.uno.prepararTrabajos();
}
function ajenos(db: DatabaseSync) {
  return ['publico_socios', 'publico_contadores', 'publico_revocados', 'administracion_controles'].map((tabla) =>
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(tabla)
      ? db.prepare(`SELECT * FROM ${tabla} ORDER BY 1`).all()
      : null,
  );
}

test('binding comparte singleton y preparación explícita; reserva única, sustitución y reinicio conservan trabajo', async (t) => {
  const m = montaje(t);
  await assert.rejects(m.uno.prepararTrabajos(), AlmacenPublicoNoDisponible);
  await preparar(m);
  const resultados = await Promise.all([
    m.uno.reservarTrabajoDeSesion(ACCESO, SOLICITUD, CONFIANZA),
    m.dos.reservarTrabajoDeSesion(ACCESO, SOLICITUD, CONFIANZA),
  ]);
  assert.deepEqual(resultados.map((r) => r.estado).sort(), ['nueva', 'repetida']);
  const privado = await m.uno.leerTrabajoPrivado();
  assert.deepEqual(privado.ultimoTrabajo?.confianza, CONFIANZA);
  assert.ok(!JSON.stringify(await m.uno.leerTrabajoDeSesion(ACCESO)).includes('confianza'));
  await abrirSesionDePrueba(m.dos, OTRO_ACCESO);
  assert.deepEqual(await m.uno.reservarTrabajoDeSesion(ACCESO, SOLICITUD, CONFIANZA), { estado: 'sustituida' });
  m.reiniciar();
  await m.dos.prepararTrabajos();
  assert.deepEqual(await m.dos.leerTrabajoPrivado(), privado);
  assert.equal((await m.dos.reservarTrabajoDeSesion(OTRO_ACCESO, SOLICITUD, CONFIANZA)).estado, 'repetida');
  assert.ok(m.nombres.every((n) => n === 'registro-publico-v1'));
});

test('recibo terminal correlacionado atraviesa binding; duplicados y eventos tardíos no alteran siguiente trabajo', async (t) => {
  const m = montaje(t);
  await preparar(m);
  const primero = trabajo(await m.uno.reservarTrabajoDeSesion(ACCESO, SOLICITUD, CONFIANZA));
  const referencia = { solicitudId: primero.solicitudId, revisionReserva: primero.revisionReserva };
  assert.equal((await m.uno.anotarDespacho(referencia, { estado: 'incierta' })).estado, 'repetido');
  assert.equal((await m.uno.confirmarInicio(INICIO, identidad())).estado, 'aplicado');
  const r = recibo();
  assert.equal((await m.dos.registrarRecibo(r, 'e'.repeat(TAM_HUELLA), identidad())).estado, 'aplicado');
  assert.equal((await m.dos.registrarRecibo(r, 'e'.repeat(TAM_HUELLA), identidad())).estado, 'repetido');
  const revisionEsperada = (await m.uno.leerTrabajoPrivado()).revision;
  await m.uno.reservarTrabajoDeSesion(ACCESO, { ...SOLICITUD, solicitudId: OTRO_ID, revisionEsperada }, CONFIANZA);
  const antes = await m.uno.leerTrabajoPrivado();
  assert.equal((await m.dos.registrarRecibo(r, 'e'.repeat(TAM_HUELLA), identidad())).estado, 'conflicto');
  assert.equal((await m.dos.anotarDespacho(referencia, { estado: 'despachada', runId: '789' })).estado, 'conflicto');
  assert.deepEqual(await m.uno.leerTrabajoPrivado(), antes);
});

test('contratos internos inválidos se rechazan antes de ejecutar SQL, incluidos claims libres', async (t) => {
  const m = montaje(t);
  await preparar(m);
  const entradas = [
    ['/trabajos/preparar', { extra: true }],
    ['/trabajos/inicio', { inicio: { ...INICIO, accion: 'orden-libre' }, identidad: identidad() }],
    ['/trabajos/inicio', { inicio: INICIO, identidad: { iss: 'github', sub: 'libre' } }],
    ['/trabajos/retirar', { acceso: ACCESO, retirada: { ...REFERENCIA, revisionEsperada: -1 } }],
    ['/trabajos/retirar', { acceso: ACCESO, retirada: { ...REFERENCIA, revisionEsperada: 1 }, token: 'libre' }],
    ['/trabajos/sin-recibo', { referencia: REFERENCIA, evidencia: { ...evidencia(), estado: 'in_progress' } }],
    ['/trabajos/sin-recibo', { referencia: REFERENCIA, evidencia: { ...evidencia(), url: 'https://ajena.invalid' } }],
    ['/trabajos/privado', { acceso: ACCESO }],
    ['/trabajos/leer', { acceso: { ...ACCESO, huellaSesion: 'token' } }],
    ['/trabajos/reservar', { acceso: ACCESO, solicitud: { ...SOLICITUD, revisionEsperada: -1 }, confianza: CONFIANZA }],
    ['/trabajos/reservar', { acceso: ACCESO, solicitud: SOLICITUD, confianza: { ...CONFIANZA, clave: 'no-reflejar' } }],
    [
      '/trabajos/despacho',
      { referencia: { solicitudId: ID, revisionReserva: 1 }, resultado: { estado: 'despachada', runId: 789 } },
    ],
    ['/trabajos/recibo', { recibo: recibo(), huellaRecibo: 'token', identidad: identidad() }],
    [
      '/trabajos/recibo',
      { recibo: recibo(), huellaRecibo: 'a'.repeat(TAM_HUELLA), identidad: { iss: 'github', sub: 'libre' } },
    ],
    [
      '/trabajos/recibo',
      { recibo: { ...recibo(), revisionReserva: 0 }, huellaRecibo: 'a'.repeat(TAM_HUELLA), identidad: identidad() },
    ],
  ] as const;
  for (const [ruta, cuerpo] of entradas) {
    const antes = m.consultas();
    const respuesta = await m.enviar(ruta, cuerpo);
    assert.equal(respuesta.status, HTTP_INVALIDO);
    assert.equal(m.consultas(), antes);
    assert.deepEqual(await respuesta.json(), { error: 'solicitud_invalida' });
  }
});

test('rutas exactas y límite 8 KiB solo trabajos; rutas anteriores conservan su entrada 16 KiB', async (t) => {
  const m = montaje(t);
  await preparar(m);
  for (const ruta of [
    '/trabajos/privado/',
    '/TRABAJOS/privado',
    '/trabajos/%70rivado',
    '/trabajos/privado?x=1',
    '/trabajos/privado#x',
    '/trabajos/inicio/',
    '/trabajos/%72etirar',
    '/trabajos/sin-recibo?x=1',
  ]) {
    const antes = m.consultas();
    assert.equal((await m.enviar(ruta, {})).status, HTTP_INVALIDO);
    assert.equal(m.consultas(), antes);
  }
  const texto = `${' '.repeat(MAX_MENSAJE_TRABAJO_DURABLE)}{}`;
  assert.equal(
    (await m.fetch(new Request('https://registro-socios.invalid/trabajos/preparar', { method: 'POST', body: texto })))
      .status,
    HTTP_INVALIDO,
  );
  assert.equal(
    (await m.fetch(new Request('https://registro-socios.invalid/controles/leer', { method: 'POST', body: texto })))
      .status,
    HTTP_CORRECTO,
  );
});

test('pins máximos que exceden 2 KiB vuelven completos por lectura privada; público sigue mínimo', async (t) => {
  const m = montaje(t);
  await preparar(m);
  const prefijo = 'equipo/fuente/.github/workflows/actualizar.yml@refs/heads/';
  const maxAud = 256;
  const maxWorkflow = 512;
  const maxRef = 256;
  const grande = {
    ...CONFIANZA,
    audiencia: '"'.repeat(maxAud),
    ref: `refs/heads/${'"'.repeat(maxRef - 'refs/heads/'.length)}`,
    workflowRef: `${prefijo}${'"'.repeat(maxWorkflow - prefijo.length)}`,
  };
  await m.uno.reservarTrabajoDeSesion(ACCESO, SOLICITUD, grande);
  const privado = await m.uno.leerTrabajoPrivado();
  assert.ok(JSON.stringify(privado).length > LIMITE_ANTERIOR_RESPUESTA);
  assert.deepEqual(privado.ultimoTrabajo?.confianza, grande);
  const publico = await m.uno.leerTrabajoDeSesion(ACCESO);
  assert.ok(JSON.stringify(publico).length < LIMITE_ANTERIOR_RESPUESTA);
  assert.throws(() => leerEstadoTrabajos(privado));
});

test('pérdida de respuesta tras commit conserva reserva; reintento devuelve repetida sin crear otra', async (t) => {
  const m = montaje(t);
  await preparar(m);
  let perder = true;
  const cliente = new SesionUnicaDurable({
    idFromName: (n) => n,
    get: () => ({
      fetch: async (p) => {
        const respuesta = await m.fetch(p);
        if (perder) {
          perder = false;
          throw new Error('no-reflejar');
        }
        return respuesta;
      },
    }),
  });
  await assert.rejects(cliente.reservarTrabajoDeSesion(ACCESO, SOLICITUD, CONFIANZA), AlmacenPublicoNoDisponible);
  assert.equal((await cliente.reservarTrabajoDeSesion(ACCESO, SOLICITUD, CONFIANZA)).estado, 'repetida');
  assert.equal((await cliente.leerTrabajoPrivado()).revision, 1);
});

test('datos públicos y controles se conservan y backend roto jamás cambia a memoria', async (t) => {
  const m = montaje(t);
  await preparar(m);
  sembrarSocioPersistido(m.db, { id: 'pub-uno', huellas: ['e'.repeat(TAM_HUELLA)], consultasPorHora: 3 });
  await m.uno.consumir([{ clave: 'consultas:global', limite: 3, ventanaMs: 60_000 }]);
  await m.uno.revocar('a'.repeat(TAM_JTI_API), Math.floor(Date.now() / SEGUNDO) + VALIDEZ_S);
  const antes = ajenos(m.db);
  const reservado = trabajo(await m.uno.reservarTrabajoDeSesion(ACCESO, SOLICITUD, CONFIANZA));
  await m.uno.anotarDespacho({ solicitudId: ID, revisionReserva: reservado.revisionReserva }, { estado: 'rechazada' });
  assert.deepEqual(ajenos(m.db), antes);
  m.db.exec('DELETE FROM administracion_trabajo');
  await assert.rejects(m.uno.leerTrabajoPrivado(), AlmacenPublicoNoDisponible);
  await assert.rejects(m.uno.prepararTrabajos(), AlmacenPublicoNoDisponible);
  assert.deepEqual(m.db.prepare('SELECT * FROM administracion_trabajo').all(), []);
});

test('lector público rechaza extras privados, estados incoherentes y respuestas RPC de otra reserva', async (t) => {
  const m = montaje(t);
  await preparar(m);
  const respuesta = await m.uno.reservarTrabajoDeSesion(ACCESO, SOLICITUD, CONFIANZA);
  assert.ok('trabajos' in respuesta);
  assert.throws(() =>
    leerResultadoLecturaTrabajo({
      estado: 'activa',
      sesion: respuesta.sesion,
      trabajos: { ...respuesta.trabajos, extra: true },
    }),
  );
  const ajena = {
    ...respuesta,
    trabajos: { ...respuesta.trabajos, ultimoTrabajo: { ...respuesta.trabajos.ultimoTrabajo, solicitudId: OTRO_ID } },
  };
  const cliente = new SesionUnicaDurable({
    idFromName: (n) => n,
    get: () => ({ fetch: async () => Response.json(ajena) }),
  });
  await assert.rejects(cliente.reservarTrabajoDeSesion(ACCESO, SOLICITUD, CONFIANZA), AlmacenPublicoNoDisponible);
});

test('límites de salida y plazo cancelan cuerpo bloqueado sin relajar rutas existentes', async () => {
  const clienteDe = (fetch: (p: Request) => Promise<Response>) =>
    new SesionUnicaDurable({ idFromName: (n) => n, get: () => ({ fetch }) }, { tiempoLimiteMs: PLAZO_PRUEBA_MS });
  const demasiado = clienteDe(async () => new Response(' '.repeat(MAX_RESPUESTA_TRABAJO_DURABLE + 1)));
  await assert.rejects(demasiado.leerTrabajoPrivado(), AlmacenPublicoNoDisponible);
  const anterior = clienteDe(async () => new Response(`${' '.repeat(LIMITE_ANTERIOR_RESPUESTA)}{"abierto":true}`));
  await assert.rejects(
    anterior.consumir([{ clave: 'consultas:global', limite: 1, ventanaMs: 1000 }]),
    AlmacenPublicoNoDisponible,
  );
  let cancelado = false;
  const bloqueado = clienteDe(
    async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelado = true;
          },
        }),
      ),
  );
  await assert.rejects(bloqueado.leerTrabajoPrivado(), AlmacenPublicoNoDisponible);
  assert.equal(cancelado, true);
});

test('cliente rechaza entradas antes RPC y resultados con run o resumen ajenos a la transición pedida', async (t) => {
  const m = montaje(t);
  await preparar(m);
  const reservado = trabajo(await m.uno.reservarTrabajoDeSesion(ACCESO, SOLICITUD, CONFIANZA));
  const referencia = { solicitudId: ID, revisionReserva: reservado.revisionReserva };
  await m.uno.confirmarInicio(INICIO, identidad());
  const terminal = await m.uno.registrarRecibo(recibo(), 'e'.repeat(TAM_HUELLA), identidad());
  let llamadas = 0;
  const clienteDe = (valor: unknown) =>
    new SesionUnicaDurable({
      idFromName: (n) => n,
      get: () => ({
        fetch: async () => {
          llamadas++;
          return Response.json(valor);
        },
      }),
    });
  const cliente = clienteDe(terminal);
  await assert.rejects(cliente.reservarTrabajoDeSesion(ACCESO, { ...SOLICITUD, revisionEsperada: -1 }, CONFIANZA));
  assert.equal(llamadas, 0);
  const runAjeno = {
    ...terminal,
    trabajos: { ...terminal.trabajos, ultimoTrabajo: { ...terminal.trabajos.ultimoTrabajo, runId: '790' } },
  };
  await assert.rejects(
    clienteDe(runAjeno).anotarDespacho(referencia, { estado: 'despachada', runId: '789' }),
    AlmacenPublicoNoDisponible,
  );
  const resumenAjeno = {
    ...terminal,
    trabajos: {
      ...terminal.trabajos,
      ultimoTrabajo: {
        ...terminal.trabajos.ultimoTrabajo,
        resultado: { ...terminal.trabajos.ultimoTrabajo?.resultado, huellaPaquete: 'a'.repeat(TAM_VERSION) },
      },
    },
  };
  await assert.rejects(
    clienteDe(resumenAjeno).registrarRecibo(recibo(), 'e'.repeat(TAM_HUELLA), identidad()),
    AlmacenPublicoNoDisponible,
  );
});

test('inicio OIDC atraviesa binding, persiste al reiniciar y exige handshake antes de admitir recibo', async (t) => {
  const m = montaje(t);
  await preparar(m);
  await m.uno.reservarTrabajoDeSesion(ACCESO, SOLICITUD, CONFIANZA);
  assert.equal((await m.uno.registrarRecibo(recibo(), 'e'.repeat(TAM_HUELLA), identidad())).estado, 'conflicto');
  assert.equal((await m.uno.confirmarInicio(INICIO, { ...identidad(), runAttempt: '2' })).estado, 'conflicto');
  assert.equal((await m.uno.confirmarInicio(INICIO, identidad())).estado, 'aplicado');
  const privado = await m.uno.leerTrabajoPrivado();
  assert.equal(privado.version, 2);
  assert.equal(privado.ultimoTrabajo?.protocoloInicio, 'obligatorio');
  assert.equal(privado.ultimoTrabajo?.inicioConfirmado, true);
  m.reiniciar();
  assert.deepEqual(await m.dos.leerTrabajoPrivado(), privado);
  assert.equal((await m.dos.confirmarInicio(INICIO, identidad())).estado, 'repetido');
  assert.equal((await m.dos.registrarRecibo(recibo(), 'e'.repeat(TAM_HUELLA), identidad())).estado, 'aplicado');
  const publico = await m.uno.leerTrabajoDeSesion(ACCESO);
  for (const campo of ['inicioConfirmado', 'protocoloInicio', 'confianza', 'huellaRecibo']) {
    assert.equal(JSON.stringify(publico).includes(campo), false);
  }
});

test('el rechazo de otra revisión atraviesa binding una sola vez, persiste y no impide iniciar la autorizada', async (t) => {
  const m = montaje(t);
  await preparar(m);
  await m.uno.reservarTrabajoDeSesion(ACCESO, SOLICITUD, CONFIANZA);
  const otraRevision = { ...identidad(), sha: 'c'.repeat(TAM_SHA) };
  assert.equal((await m.uno.anotarInicioRechazado(INICIO, identidad())).estado, 'conflicto');
  assert.equal(
    (await m.uno.anotarInicioRechazado(INICIO, { ...otraRevision, repositorioId: '9' })).estado,
    'conflicto',
  );
  assert.equal((await m.uno.anotarInicioRechazado(INICIO, otraRevision)).estado, 'aplicado');
  const privado = await m.uno.leerTrabajoPrivado();
  assert.equal(privado.ultimoTrabajo?.inicioRechazado?.motivo, 'revision_no_autorizada');
  m.reiniciar();
  assert.deepEqual(await m.dos.leerTrabajoPrivado(), privado);
  assert.equal((await m.dos.anotarInicioRechazado(INICIO, otraRevision)).estado, 'repetido');
  assert.deepEqual(await m.dos.leerTrabajoPrivado(), privado);
  assert.equal(JSON.stringify(await m.uno.leerTrabajoDeSesion(ACCESO)).includes('inicioRechazado'), false);
  assert.equal((await m.uno.confirmarInicio(INICIO, identidad())).estado, 'aplicado');
  assert.equal((await m.uno.anotarInicioRechazado(INICIO, otraRevision)).estado, 'conflicto');
});

test('retirada por sesión vigente usa CAS y bloquea inicios tardíos sin alterar datos públicos', async (t) => {
  const m = montaje(t);
  await preparar(m);
  await m.uno.reservarTrabajoDeSesion(ACCESO, SOLICITUD, CONFIANZA);
  const antes = ajenos(m.db);
  const retirada = { ...REFERENCIA, revisionEsperada: 1 };
  assert.equal((await m.uno.retirarTrabajoDeSesion(ACCESO, { ...retirada, revisionEsperada: 0 })).estado, 'conflicto');
  await abrirSesionDePrueba(m.dos, OTRO_ACCESO);
  assert.deepEqual(await m.uno.retirarTrabajoDeSesion(ACCESO, retirada), { estado: 'sustituida' });
  const resultado = await m.dos.retirarTrabajoDeSesion(OTRO_ACCESO, retirada);
  assert.equal(resultado.estado, 'retirado');
  if (resultado.estado === 'retirado') {
    assert.equal(resultado.trabajos.ultimoTrabajo?.resultado?.resultado, 'retirado');
  }
  m.reiniciar();
  assert.equal((await m.uno.confirmarInicio(INICIO, identidad())).estado, 'conflicto');
  assert.deepEqual(ajenos(m.db), antes);
});

test('ejecución remota completada sin recibo termina correlacionada y persiste sin afirmar candidato validado', async (t) => {
  const m = montaje(t);
  await preparar(m);
  await m.uno.reservarTrabajoDeSesion(ACCESO, SOLICITUD, CONFIANZA);
  await m.uno.anotarDespacho(REFERENCIA, { estado: 'despachada', runId: '789' });
  assert.equal(
    (await m.uno.finalizarEjecucionSinRecibo(REFERENCIA, { ...evidencia(), runId: '790' })).estado,
    'conflicto',
  );
  const resultado = await m.dos.finalizarEjecucionSinRecibo(REFERENCIA, evidencia());
  assert.equal(resultado.estado, 'aplicado');
  assert.equal(resultado.trabajos.ultimoTrabajo?.resultado?.resultado, 'ejecucion-sin-recibo');
  assert.equal(resultado.trabajos.ultimoTrabajo?.resultado?.huellaPaquete, null);
  m.reiniciar();
  assert.equal((await m.uno.finalizarEjecucionSinRecibo(REFERENCIA, evidencia())).estado, 'repetido');
  assert.equal((await m.uno.registrarRecibo(recibo(), 'e'.repeat(TAM_HUELLA), identidad())).estado, 'conflicto');
});

test('el cierre sin recibo atraviesa el binding con su porqué, persiste y rechaza causas del servidor', async (t) => {
  const m = montaje(t);
  await preparar(m);
  await m.uno.reservarTrabajoDeSesion(ACCESO, SOLICITUD, CONFIANZA);
  await m.uno.confirmarInicio(INICIO, identidad());
  const cierre = { ...INICIO, ultimoFallo: { causa: 'plazo-agotado', paso: 'exportar' } } as const;
  assert.equal((await m.uno.cerrarSinRecibo(cierre, { ...identidad(), runId: '790' })).estado, 'conflicto');
  const resultado = await m.dos.cerrarSinRecibo(cierre, identidad());
  assert.equal(resultado.estado, 'aplicado');
  assert.equal(resultado.trabajos.ultimoTrabajo?.resultado?.resultado, 'ejecucion-sin-recibo');
  assert.deepEqual(resultado.trabajos.ultimoTrabajo?.resultado?.ultimoFallo, cierre.ultimoFallo);
  m.reiniciar();
  assert.equal((await m.uno.cerrarSinRecibo(cierre, identidad())).estado, 'repetido');
  const delServidor = { ...cierre, ultimoFallo: { causa: 'sin-resultado', paso: null } };
  await assert.rejects(m.uno.cerrarSinRecibo(delServidor as never, identidad()));
  assert.equal((await m.uno.registrarRecibo(recibo(), 'e'.repeat(TAM_HUELLA), identidad())).estado, 'conflicto');
});

function clienteConRespuesta(valor: unknown) {
  return new SesionUnicaDurable({ idFromName: (n) => n, get: () => ({ fetch: async () => Response.json(valor) }) });
}
test('cliente valida nuevos DTO antes RPC y coteja referencia, acción, run y resultado de respuestas', async (t) => {
  const m = montaje(t);
  await preparar(m);
  await m.uno.reservarTrabajoDeSesion(ACCESO, SOLICITUD, CONFIANZA);
  const inicio = await m.uno.confirmarInicio(INICIO, identidad());
  const cambiarTrabajo = (cambios: object) => ({
    ...inicio,
    trabajos: { ...inicio.trabajos, ultimoTrabajo: { ...inicio.trabajos.ultimoTrabajo, ...cambios } },
  });
  for (const cambios of [{ runId: '790' }, { accion: 'reintentar-pendientes' }, { solicitudId: OTRO_ID }]) {
    await assert.rejects(
      clienteConRespuesta(cambiarTrabajo(cambios)).confirmarInicio(INICIO, identidad()),
      AlmacenPublicoNoDisponible,
    );
  }
  let llamadas = 0;
  const cliente = new SesionUnicaDurable({
    idFromName: (n) => n,
    get: () => ({
      fetch: async () => {
        llamadas++;
        return Response.json({});
      },
    }),
  });
  await assert.rejects(cliente.confirmarInicio({ ...INICIO, accion: 'otra' } as never, identidad()));
  await assert.rejects(cliente.retirarTrabajoDeSesion(ACCESO, { ...REFERENCIA, revisionEsperada: -1 }));
  await assert.rejects(cliente.finalizarEjecucionSinRecibo(REFERENCIA, { ...evidencia(), evento: 'push' } as never));
  assert.equal(llamadas, 0);
  const terminal = await m.uno.finalizarEjecucionSinRecibo(REFERENCIA, evidencia());
  const ajeno = {
    ...terminal,
    trabajos: { ...terminal.trabajos, ultimoTrabajo: { ...terminal.trabajos.ultimoTrabajo, runId: '790' } },
  };
  await assert.rejects(
    clienteConRespuesta(ajeno).finalizarEjecucionSinRecibo(REFERENCIA, evidencia()),
    AlmacenPublicoNoDisponible,
  );
});

test('retirada RPC coteja revisión CAS y reserva incluso al repetir exactamente', async (t) => {
  const m = montaje(t);
  await preparar(m);
  await m.uno.reservarTrabajoDeSesion(ACCESO, SOLICITUD, CONFIANZA);
  const retirada = { ...REFERENCIA, revisionEsperada: 1 };
  const resultado = await m.uno.retirarTrabajoDeSesion(ACCESO, retirada);
  assert.equal(resultado.estado, 'retirado');
  assert.deepEqual(await m.dos.retirarTrabajoDeSesion(ACCESO, retirada), resultado);
  assert.ok('trabajos' in resultado);
  const ajena = {
    ...resultado,
    trabajos: { ...resultado.trabajos, ultimoTrabajo: { ...resultado.trabajos.ultimoTrabajo, solicitudId: OTRO_ID } },
  };
  await assert.rejects(clienteConRespuesta(ajena).retirarTrabajoDeSesion(ACCESO, retirada), AlmacenPublicoNoDisponible);
  const revisionAjena = {
    ...resultado,
    trabajos: { ...resultado.trabajos, revision: resultado.trabajos.revision + 1 },
  };
  await assert.rejects(
    clienteConRespuesta(revisionAjena).retirarTrabajoDeSesion(ACCESO, retirada),
    AlmacenPublicoNoDisponible,
  );
});

test('tres nuevas rutas mantienen límite 8 KiB sin tocar SQL al excederlo', async (t) => {
  const m = montaje(t);
  await preparar(m);
  const cuerpo = `${' '.repeat(MAX_MENSAJE_TRABAJO_DURABLE)}{}`;
  for (const ruta of ['/trabajos/inicio', '/trabajos/retirar', '/trabajos/sin-recibo']) {
    const antes = m.consultas();
    const salida = await m.fetch(
      new Request(`https://registro-socios.invalid${ruta}`, { method: 'POST', body: cuerpo }),
    );
    assert.equal(salida.status, HTTP_INVALIDO);
    assert.equal(m.consultas(), antes);
  }
});
