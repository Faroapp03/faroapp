/** Un permiso de inicio negado a otra revisión deja su hecho y el vigilante lo dice; sin identidad válida, nada. */
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { destinoAvisoDelEntorno } from '../../src/administracion/envio-aviso.ts';
import { MARGEN_RELOJ_GITHUB_MS } from '../../src/administracion/estado-trabajos.js';
import {
  estadoPublicoTrabajos,
  leerEstadoTrabajos,
  leerEstadoTrabajosPrivado,
} from '../../src/administracion/trabajos.ts';
import { evaluarVigilante } from '../../src/administracion/vigilante.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { MS_POR_SEGUNDO } from '../../src/comun/tiempo.ts';
import { crearAvisoProgramado } from '../../src/plataforma/aviso-programado.ts';
import {
  ACCESO_RESERVA,
  afirmaciones,
  CLAVES_AJENAS,
  CLAVES_GITHUB,
  ID_RESERVA,
  OTRA_REVISION,
  otraRevision,
  reservaQueEsperaInicio,
} from '../ayudas/inicio-rechazado.ts';
import {
  CONFIANZA_VIGILANTE,
  CONFIG_VIGILANTE,
  CORTE_VIGILANTE,
  entradasVigilante,
  HORA_VIGILANTE,
  PROGRAMADA_VIGILANTE,
} from '../ayudas/vigilante.ts';

const ID = ID_RESERVA;
const PANEL = 'https://panel.example/administracion/';
const DESTINO = 'https://avisos.example/faro';
const OTRO_WORKFLOW = 'equipo/fuente/.github/workflows/otro.yml@refs/heads/main';
/** Más que la vida del token (300 s) y menos que la antigüedad máxima admitida (600 s): solo falla la caducidad. */
const CADUCADO_S = 400;
const CADUCADO_MS = CADUCADO_S * MS_POR_SEGUNDO;
const fixture = (t: TestContext) => reservaQueEsperaInicio(t);
type Reserva = Awaited<ReturnType<typeof fixture>>;

/** La respuesta de un permiso negado a un token que ni siquiera se puede leer: la de referencia para todo rechazo. */
async function respuestaNegada(t: TestContext) {
  const f = await fixture(t);
  return f.pedirInicio('a.b.c');
}

test('otra revisión del código o del workflow recibe el mismo 401 y deja un solo hecho en la reserva', async (t) => {
  const negada = await respuestaNegada(t);
  assert.equal(negada.estado, ESTADO_HTTP.noAutenticado);
  for (const cambio of [{ sha: OTRA_REVISION }, { workflow_sha: OTRA_REVISION }]) {
    await t.test(Object.keys(cambio)[0] ?? '', async (st) => {
      const f = await fixture(st);
      const { firmar } = await CLAVES_GITHUB;
      const token = await firmar(afirmaciones(CONFIANZA_VIGILANTE, cambio));
      assert.deepEqual(await f.pedirInicio(token), negada);
      const privado = await f.almacen.leerTrabajoPrivado();
      assert.deepEqual(privado.ultimoTrabajo?.inicioRechazado, {
        en: CORTE_VIGILANTE,
        motivo: 'revision_no_autorizada',
      });
      assert.equal(privado.ultimoTrabajo?.inicioConfirmado, false);
      assert.equal(privado.ultimoTrabajo?.runId, null);
      f.reloj.ahora += MS_POR_SEGUNDO;
      assert.deepEqual(await f.pedirInicio(token), negada);
      assert.deepEqual(await f.almacen.leerTrabajoPrivado(), privado);
    });
  }
});

/**
 * Cada caso cambia una sola cosa de un token que, sin ese cambio, sí dejaría el hecho: el control lo demuestra en la
 * misma reserva y con el mismo reloj, así que el rechazo se debe exactamente al motivo que nombra el caso.
 */
interface CasoSinRastro {
  readonly nombre: string;
  readonly negativo: () => Record<string, unknown>;
  readonly control?: () => Record<string, unknown>;
  readonly ajena?: boolean;
  readonly preparar?: (f: Reserva) => Promise<void> | void;
}
const job = (ref: string, sha: string) => ({ job_workflow_ref: ref, job_workflow_sha: sha });
const CASOS_SIN_RASTRO: readonly CasoSinRastro[] = [
  { nombre: 'firma', negativo: () => otraRevision(), ajena: true },
  { nombre: 'emisor', negativo: () => otraRevision({ iss: 'https://emisor.example' }) },
  { nombre: 'audiencia', negativo: () => otraRevision({ aud: 'https://mantenimiento.example/otra' }) },
  { nombre: 'repositorio', negativo: () => otraRevision({ repository_id: '999' }) },
  { nombre: 'propietario', negativo: () => otraRevision({ repository_owner_id: '9' }) },
  { nombre: 'ref', negativo: () => otraRevision({ ref: 'refs/heads/otra' }) },
  { nombre: 'workflow_ref', negativo: () => otraRevision({ workflow_ref: OTRO_WORKFLOW }) },
  {
    nombre: 'job_workflow_ref',
    negativo: () => otraRevision(job(OTRO_WORKFLOW, CONFIANZA_VIGILANTE.workflowSha)),
    control: () => otraRevision(job(CONFIANZA_VIGILANTE.workflowRef, CONFIANZA_VIGILANTE.workflowSha)),
  },
  {
    nombre: 'job_workflow_sha',
    negativo: () => otraRevision(job(CONFIANZA_VIGILANTE.workflowRef, OTRA_REVISION)),
    control: () => otraRevision(job(CONFIANZA_VIGILANTE.workflowRef, CONFIANZA_VIGILANTE.workflowSha)),
  },
  { nombre: 'segundo intento', negativo: () => otraRevision({ run_attempt: '2' }) },
  { nombre: 'sha mal formado', negativo: () => otraRevision({ sha: 'no-es-un-sha' }) },
  {
    nombre: 'otro run que el de la reserva',
    preparar: async (f) => {
      await f.almacen.anotarDespacho({ solicitudId: ID, revisionReserva: 1 }, { estado: 'despachada', runId: '111' });
    },
    negativo: () => otraRevision(),
    control: () => otraRevision({ run_id: '111' }),
  },
  {
    nombre: 'emitido antes de la reserva',
    negativo: () => otraRevision({}, CORTE_VIGILANTE - MARGEN_RELOJ_GITHUB_MS - MS_POR_SEGUNDO),
  },
  {
    nombre: 'caducado',
    preparar: (f) => {
      f.reloj.ahora = CORTE_VIGILANTE + CADUCADO_MS;
    },
    negativo: () => otraRevision(),
    control: () => otraRevision({}, CORTE_VIGILANTE + CADUCADO_MS),
  },
];
async function sinRastro(st: TestContext, caso: CasoSinRastro, negada: unknown) {
  const f = await fixture(st);
  await caso.preparar?.(f);
  const antes = await f.almacen.leerTrabajoPrivado();
  const firmante = await (caso.ajena ? CLAVES_AJENAS : CLAVES_GITHUB);
  assert.deepEqual(await f.pedirInicio(await firmante.firmar(caso.negativo())), negada);
  assert.deepEqual(await f.almacen.leerTrabajoPrivado(), antes);
  assert.equal(Object.hasOwn(antes.ultimoTrabajo ?? {}, 'inicioRechazado'), false);
  const control = await (await CLAVES_GITHUB).firmar((caso.control ?? (() => otraRevision()))());
  assert.deepEqual(await f.pedirInicio(control), negada);
  assert.equal((await f.almacen.leerTrabajoPrivado()).ultimoTrabajo?.inicioRechazado?.motivo, 'revision_no_autorizada');
}
test('sin identidad válida en todo lo demás no queda rastro, aunque la revisión sea otra', async (t) => {
  const negada = await respuestaNegada(t);
  for (const caso of CASOS_SIN_RASTRO) {
    await t.test(caso.nombre, (st) => sinRastro(st, caso, negada));
  }
});

test('tras un rechazo, una retirada con la revisión anterior da conflicto una vez y pasa al releer', async (t) => {
  const f = await fixture(t);
  await f.pedirInicio(await (await CLAVES_GITHUB).firmar(otraRevision()));
  const retirada = { solicitudId: ID, revisionReserva: 1 };
  const vieja = await f.almacen.retirarTrabajoDeSesion(ACCESO_RESERVA, { ...retirada, revisionEsperada: 1 });
  assert.equal(vieja.estado, 'conflicto');
  const leida = await f.almacen.leerTrabajoDeSesion(ACCESO_RESERVA);
  assert.ok(leida.estado === 'activa');
  assert.equal(leida.trabajos.revision, 2);
  const nueva = await f.almacen.retirarTrabajoDeSesion(ACCESO_RESERVA, {
    ...retirada,
    revisionEsperada: leida.trabajos.revision,
  });
  assert.equal(nueva.estado, 'retirado');
});

test('la revisión autorizada inicia como siempre y no anota ningún rechazo', async (t) => {
  const f = await fixture(t);
  const { firmar } = await CLAVES_GITHUB;
  const respuesta = await f.pedirInicio(await firmar(afirmaciones(CONFIANZA_VIGILANTE)));
  assert.equal(respuesta.estado, ESTADO_HTTP.correcto);
  assert.deepEqual(respuesta.cuerpo, { estado: 'aplicado' });
  const privado = await f.almacen.leerTrabajoPrivado();
  assert.equal(privado.ultimoTrabajo?.inicioConfirmado, true);
  assert.equal(Object.hasOwn(privado.ultimoTrabajo ?? {}, 'inicioRechazado'), false);
});

test('el vigilante da «inicio_rechazado» en cuanto consta, antes del plazo de inicio, y el aviso sale una vez', async (t) => {
  const f = await fixture(t);
  type Enviado = { tipo: string; decisiones: { clave: string; motivo: string }[] };
  const enviados: Enviado[] = [];
  const avisar = crearAvisoProgramado({
    autoridad: {
      prepararAvisoVigilante: (panel: string) =>
        f.almacen.prepararAvisoVigilante({ configuracion: CONFIG_VIGILANTE, programada: PROGRAMADA_VIGILANTE }, panel),
      registrarEnvioAviso: (e: Parameters<typeof f.almacen.registrarEnvioAviso>[0]) => f.almacen.registrarEnvioAviso(e),
    },
    destino: () => destinoAvisoDelEntorno({ FARO_AVISO_URL: DESTINO }),
    panel: PANEL,
    pedir: async (entrada) => {
      assert.ok(entrada instanceof Request);
      enviados.push((await entrada.json()) as Enviado);
      return new Response(null, { status: 202 });
    },
  });
  await avisar();
  const rechazos = () =>
    enviados.filter((e) => e.decisiones.some((d) => d.clave === 'ejecutor' && d.motivo === 'inicio_rechazado'));
  assert.equal(rechazos().length, 0);
  const { firmar } = await CLAVES_GITHUB;
  const otraRevision = () => firmar(afirmaciones(CONFIANZA_VIGILANTE, { sha: OTRA_REVISION }, f.reloj.ahora));
  f.reloj.ahora += MS_POR_SEGUNDO;
  assert.equal((await f.pedirInicio(await otraRevision())).estado, ESTADO_HTTP.noAutenticado);
  assert.ok(f.reloj.ahora < CORTE_VIGILANTE + CONFIG_VIGILANTE.plazoInicioMs);
  assert.equal(await avisar(), 'enviado');
  assert.deepEqual(
    rechazos().map((e) => e.tipo),
    ['nuevo'],
  );
  f.reloj.ahora += HORA_VIGILANTE / 2;
  assert.equal((await f.pedirInicio(await otraRevision())).estado, ESTADO_HTTP.noAutenticado);
  assert.equal(await avisar(), 'sin-aviso');
  assert.equal(rechazos().length, 1);
});

const TRABAJO = {
  solicitudId: ID,
  accion: 'actualizar-datos',
  revisionBase: 0,
  revisionReserva: 1,
  creadoEn: CORTE_VIGILANTE,
  actualizadoEn: CORTE_VIGILANTE,
  estado: 'despacho-incierto',
  runId: null,
  runAttempt: '1',
  resultado: null,
  confianza: CONFIANZA_VIGILANTE,
  huellaRecibo: null,
  protocoloInicio: 'obligatorio',
  inicioConfirmado: false,
} as const;
const RECHAZADO = { ...TRABAJO, inicioRechazado: { en: CORTE_VIGILANTE, motivo: 'revision_no_autorizada' } } as const;
const privado = (ultimoTrabajo: unknown) => leerEstadoTrabajosPrivado({ version: 2, revision: 1, ultimoTrabajo });
function ejecutor(ultimoTrabajo: unknown) {
  const entradas = { ...entradasVigilante(), trabajo: privado(ultimoTrabajo) };
  const evaluacion = evaluarVigilante(CONFIG_VIGILANTE, PROGRAMADA_VIGILANTE, entradas, CORTE_VIGILANTE);
  const decision = evaluacion.decisiones.find((d) => d.clave === 'ejecutor');
  return [decision?.motivo, decision?.estado];
}

test('la evaluación pura distingue el rechazo, sin esperar al plazo, del inicio aún sin confirmar', () => {
  assert.deepEqual(ejecutor(TRABAJO), ['inicio_no_confirmado', 'conforme']);
  assert.deepEqual(ejecutor(RECHAZADO), ['inicio_rechazado', 'incidencia']);
  const confirmado = { ...RECHAZADO, estado: 'despachado', runId: '7', inicioConfirmado: true };
  assert.deepEqual(ejecutor(confirmado), ['inicio_confirmado_sin_cierre', 'conforme']);
  assert.throws(() =>
    ejecutor({ ...RECHAZADO, inicioRechazado: { ...RECHAZADO.inicioRechazado, en: CORTE_VIGILANTE + 1 } }),
  );
});

test('el hecho guardado es cerrado: solo su instante, no anterior a la reserva, y su motivo', () => {
  for (const inicioRechazado of [
    { en: CORTE_VIGILANTE, motivo: 'otro' },
    { en: CORTE_VIGILANTE - 1, motivo: 'revision_no_autorizada' },
    { en: CORTE_VIGILANTE, motivo: 'revision_no_autorizada', sha: OTRA_REVISION },
    null,
  ]) {
    assert.throws(() => privado({ ...RECHAZADO, inicioRechazado }));
  }
  assert.throws(() => privado({ ...RECHAZADO, protocoloInicio: 'legado' }));
});

test('el estado de trabajos que lee el panel sigue cerrado y no lleva el hecho', () => {
  const publico = estadoPublicoTrabajos(privado(RECHAZADO));
  assert.equal(Object.hasOwn(publico.ultimoTrabajo ?? {}, 'inicioRechazado'), false);
  assert.deepEqual(publico, estadoPublicoTrabajos(privado(TRABAJO)));
  assert.throws(() =>
    leerEstadoTrabajos({
      ...publico,
      ultimoTrabajo: { ...publico.ultimoTrabajo, inicioRechazado: RECHAZADO.inicioRechazado },
    }),
  );
});
