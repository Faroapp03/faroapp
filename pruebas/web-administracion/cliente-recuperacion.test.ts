// Cliente → router → SQLite reales, sin conexiones ni credenciales externas.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { setImmediate as turno } from 'node:timers/promises';
import { crearSolicitadorActualizacion } from '../../src/administracion/actualizacion.ts';
import type { ResultadoConsultaEjecucion } from '../../src/administracion/consulta-ejecucion-github.ts';
import type { ResultadoDespacho } from '../../src/administracion/ejecutor-github.ts';
import { crearRouterAdministrativo } from '../../src/administracion/http.ts';
import { crearReconciliadorActualizacion } from '../../src/administracion/reconciliacion.ts';
import { AlmacenSesionPanelSqlite } from '../../src/plataforma/acceso-publico/sesion-sqlite.ts';
import { AlmacenPublicoSqlite, type SqlAccesoPublico } from '../../src/plataforma/acceso-publico/sqlite.ts';
import {
  crearClientePanel,
  type EstadoClientePanel,
  PLAZO_PANEL_CLIENTE_MS,
} from '../../web/administracion/cliente.js';
import { leerReconciliacion, leerRetirada } from '../../web/administracion/contratos.js';
import { principalDePrueba } from '../ayudas/principal-panel.ts';

const ORIGEN = 'https://panel.example';
const TAM_SHA = 40;
const MS_SEGUNDO = 1000;
const VIGENCIA_TOKEN_S = 300;
const EXITO = 200;
const CONFLICTO = 409;
const INICIO = Date.parse('2026-10-16T12:00:00Z');
const CONFIANZA = {
  audiencia: 'https://mantenimiento.example/resultado',
  repositorioId: '101',
  propietarioId: '102',
  ref: 'refs/heads/main',
  workflowRef: 'entidad/herramienta/.github/workflows/actualizar.yml@refs/heads/main',
  sha: 'c'.repeat(TAM_SHA),
  workflowSha: 'd'.repeat(TAM_SHA),
};
const COMPLETADA: ResultadoConsultaEjecucion = {
  estado: 'completada',
  evidencia: {
    estado: 'completed',
    evento: 'workflow_dispatch',
    runId: '123',
    runAttempt: '1',
    repositorioId: '101',
    propietarioId: '102',
    sha: CONFIANZA.sha,
    workflowPath: '.github/workflows/actualizar.yml',
    conclusion: 'success',
  },
};
function activa(estado: EstadoClientePanel) {
  assert.equal(estado.estado, 'activa');
  assert(estado.estado === 'activa');
  return estado;
}
interface Ganchos {
  antes?: (ruta: string) => Promise<void>;
  despues?: (ruta: string, salida: Response) => Promise<Response>;
  consulta: ResultadoConsultaEjecucion;
}
async function almacenDe(t: TestContext) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const sql: SqlAccesoPublico = {
    filas: (consulta, ...valores) => db.prepare(consulta).all(...valores),
    ejecutar: (consulta, ...valores) => {
      db.prepare(consulta).run(...valores);
    },
    transaccion: <T>(accion: () => T): T => {
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
  };
  const publico = new AlmacenPublicoSqlite(sql, { maxClientes: 1 });
  await publico.activarControles({
    version: 2,
    api: 'deshabilitada',
    mcp: false,
    a2a: false,
  });
  const almacen = new AlmacenSesionPanelSqlite(sql, { ahora: () => INICIO });
  await almacen.activarSesionPanel();
  await almacen.prepararTrabajos();
  return almacen;
}
function routerDe(almacen: AlmacenSesionPanelSqlite, despacho: ResultadoDespacho, ganchos: Ganchos) {
  let envios = 0;
  let consultas = 0;
  const router = crearRouterAdministrativo({
    almacen,
    origen: ORIGEN,
    guardiaAdministrativa: async () => principalDePrueba('https://access.example', 'sintetico'),
    actualizacion: {
      leer: (acceso) => almacen.leerTrabajoDeSesion(acceso),
      solicitar: crearSolicitadorActualizacion({
        almacen,
        // GitHub no responde a la consulta del trabajo que ocupa: la reserva decide como si no se hubiera consultado.
        reconciliar: async () => 'indeterminada',
        confianza: CONFIANZA,
        despachar: async () => {
          envios++;
          return despacho;
        },
      }),
      recuperacion: {
        retirar: (acceso, retirada) => almacen.retirarTrabajoDeSesion(acceso, retirada),
        reconciliar: crearReconciliadorActualizacion({
          almacen,
          consultar: async () => {
            consultas++;
            return ganchos.consulta;
          },
        }),
      },
    },
  });
  return { router, envios: () => envios, consultas: () => consultas };
}
function clienteDe(router: (peticion: Request) => Promise<Response>, ganchos: Ganchos) {
  let token = '';
  const pedidos: { ruta: string; cuerpo: unknown }[] = [];
  const directo = (ruta: string, cuerpo: unknown = {}, credencial = token) =>
    router(
      new Request(`${ORIGEN}/administracion/api/${ruta}`, {
        method: 'POST',
        body: JSON.stringify(cuerpo),
        headers: {
          origin: ORIGEN,
          'sec-fetch-site': 'same-origin',
          'x-faro-panel': '1',
          'content-type': 'application/json',
          'x-faro-sesion': credencial,
        },
      }),
    );
  const estados: EstadoClientePanel[] = [];
  const pedir: typeof fetch = async (url, opciones) => {
    const ruta = String(url).replace('/administracion/api/', '');
    pedidos.push({ ruta, cuerpo: JSON.parse(String(opciones?.body)) });
    await ganchos.antes?.(ruta);
    const salida = await directo(
      ruta,
      JSON.parse(String(opciones?.body)),
      new Headers(opciones?.headers).get('x-faro-sesion') ?? '',
    );
    if (ruta === 'sesion/abrir') {
      token = ((await salida.clone().json()) as { token: string }).token;
    }
    return ganchos.despues ? ganchos.despues(ruta, salida) : salida;
  };
  const panel = crearClientePanel({ pedir, alCambiar: (estado) => estados.push(estado) });
  return {
    panel,
    pedidos,
    estados,
    directo,
    ultimo: () => estados.at(-1) as EstadoClientePanel,
    efectos: () => pedidos.filter((p) => ['datos/retirar', 'datos/reconciliar'].includes(p.ruta)),
  };
}
async function fixture(t: TestContext, despacho: ResultadoDespacho = { estado: 'despachada', runId: '123' }) {
  const almacen = await almacenDe(t);
  const ganchos: Ganchos = { consulta: { estado: 'en-curso' } };
  const servidor = routerDe(almacen, despacho, ganchos);
  const cliente = clienteDe(servidor.router, ganchos);
  t.after(() => cliente.panel.destruir());
  await cliente.panel.abrir();
  await cliente.panel.actualizarDatos();
  return { almacen, ganchos, ...servidor, ...cliente };
}

test('retirada real captura reserva vista y CAS fresco, no cancela ni publica y solo admite un vuelo', async (t) => {
  const f = await fixture(t);
  const previo = activa(f.ultimo());
  const visto = previo.trabajos?.ultimoTrabajo;
  assert(visto);
  await Promise.all([f.panel.retirarTrabajo(), f.panel.reconciliarTrabajo(), f.panel.actualizarDatos()]);
  const estado = activa(f.ultimo());
  assert.equal(estado.aviso, 'trabajo_retirado');
  assert.equal(estado.trabajos?.ultimoTrabajo?.resultado?.resultado, 'retirado');
  assert.deepEqual(f.efectos(), [
    {
      ruta: 'datos/retirar',
      cuerpo: {
        solicitudId: visto.solicitudId,
        revisionReserva: visto.revisionReserva,
        revisionEsperada: previo.trabajos?.revision,
      },
    },
  ]);
  assert.equal(f.pedidos.at(-2)?.ruta, 'datos/trabajo');
  assert.deepEqual(estado.controles, previo.controles);
  assert.equal(estado.datos, previo.datos);
  assert.equal(estado.activacion, null);
  assert.equal(f.envios(), 1);
  assert.equal(f.consultas(), 0);
});

test('reconciliación auténtica en curso, sin ejecución y fin remoto no acreditan candidato', async (t) => {
  const f = await fixture(t);
  assert.equal(activa(await f.panel.reconciliarTrabajo()).aviso, 'trabajo_en_curso');
  f.ganchos.consulta = COMPLETADA;
  const final = activa(await f.panel.reconciliarTrabajo());
  assert.equal(final.aviso, 'trabajo_terminado');
  assert.equal(final.trabajos?.ultimoTrabajo?.resultado?.resultado, 'ejecucion-sin-recibo');
  assert.equal(final.trabajos?.ultimoTrabajo?.resultado?.huellaPaquete, null);
  assert.equal(final.activacion, null);
  assert.equal(f.envios(), 1);
  const incierto = await fixture(t, { estado: 'incierta' });
  assert.equal(activa(await incierto.panel.reconciliarTrabajo()).aviso, 'trabajo_sin_ejecucion');
  assert.equal(incierto.consultas(), 0);
});

test('reemplazo concurrente antes de lectura nunca retira ni reconcilia la reserva nueva', async (t) => {
  for (const operacion of ['retirarTrabajo', 'reconciliarTrabajo'] as const) {
    const f = await fixture(t);
    const anterior = activa(f.ultimo()).trabajos;
    assert(anterior?.ultimoTrabajo);
    await f.directo('datos/retirar', {
      solicitudId: anterior.ultimoTrabajo.solicitudId,
      revisionReserva: anterior.ultimoTrabajo.revisionReserva,
      revisionEsperada: anterior.revision,
    });
    const revision = (await f.almacen.leerTrabajoPrivado()).revision;
    const nuevoId = '11111111-1111-4111-8111-111111111111';
    await f.directo('datos/actualizar', {
      solicitudId: nuevoId,
      accion: 'actualizar-datos',
      revisionEsperada: revision,
    });
    const salida = activa(await f.panel[operacion]());
    assert.equal(salida.aviso, 'revision_trabajos_conflictiva');
    assert.equal(salida.trabajos?.ultimoTrabajo?.solicitudId, nuevoId);
    assert.equal(f.efectos().length, 0);
  }
});

test('409 real tras carrera de retirada conserva controles sin reenviar', async (t) => {
  const f = await fixture(t);
  f.ganchos.antes = async (ruta) => {
    if (ruta !== 'datos/retirar') {
      return;
    }
    const t = activa(f.ultimo()).trabajos?.ultimoTrabajo;
    assert(t);
    const { audiencia: _audiencia, ...identidad } = CONFIANZA;
    await f.almacen.confirmarInicio(
      { solicitudId: t.solicitudId, revisionReserva: t.revisionReserva, accion: t.accion },
      {
        ...identidad,
        runId: '123',
        runAttempt: '1',
        jti: 'inicio-sintetico',
        emitidoEn: INICIO / MS_SEGUNDO,
        caducaEn: INICIO / MS_SEGUNDO + VIGENCIA_TOKEN_S,
      },
    );
  };
  const salida = activa(await f.panel.retirarTrabajo());
  assert.equal(salida.aviso, 'revision_trabajos_conflictiva');
  assert.equal(salida.trabajos?.ultimoTrabajo?.estado, 'despachado');
  assert.equal(f.efectos().length, 1);
});

test('respuesta perdida bloquea cualquier efecto hasta consulta explícita; controles no levantan bloqueo', async (t) => {
  for (const operacion of ['retirarTrabajo', 'reconciliarTrabajo'] as const) {
    const f = await fixture(t);
    f.ganchos.consulta = COMPLETADA;
    f.ganchos.despues = async (ruta, salida) => {
      if (ruta === `datos/${operacion === 'retirarTrabajo' ? 'retirar' : 'reconciliar'}`) {
        throw new TypeError('respuesta perdida');
      }
      return salida;
    };
    assert.equal(activa(await f.panel[operacion]()).aviso, 'recuperacion_incierta');
    assert.equal(activa(await f.panel.comprobar()).aviso, 'recuperacion_incierta');
    assert.equal(activa(await f.panel.mantener()).aviso, 'recuperacion_incierta');
    await f.panel.retirarTrabajo();
    await f.panel.reconciliarTrabajo();
    await f.panel.actualizarDatos();
    assert.equal(f.efectos().length, 1);
    delete f.ganchos.despues;
    await f.panel.consultarTrabajo();
    assert.equal(activa(f.ultimo()).trabajos?.ultimoTrabajo?.estado, 'terminado');
    await f.panel.actualizarDatos();
    assert.equal(f.envios(), 2);
  }
});

test('fallo de lectura no envía efectos; HTTP incoherente, referencia ajena y campos privados no confirman', async (t) => {
  const offline = await fixture(t);
  offline.ganchos.antes = async () => {
    throw new TypeError('sin conexión');
  };
  assert.equal(activa(await offline.panel.retirarTrabajo()).aviso, 'trabajos_no_disponibles');
  assert.equal(offline.efectos().length, 0);
  for (const defecto of ['http', 'referencia', 'extra', 'decision', 'sesion']) {
    const f = await fixture(t);
    f.ganchos.despues = async (ruta, salida) => {
      if (ruta !== 'datos/reconciliar') {
        return salida;
      }
      return corromperReconciliacion(salida, defecto);
    };
    assert.equal(activa(await f.panel.reconciliarTrabajo()).aviso, 'recuperacion_incierta');
    assert(!JSON.stringify(f.estados).includes('no-reflejar'));
    await f.panel.reconciliarTrabajo();
    assert.equal(f.efectos().length, 1);
  }
});

test('timeout no reenvía y sustitución/cierre durante recuperación retiran estado y credenciales', async (t) => {
  const f = await fixture(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  f.ganchos.antes = async (ruta) => {
    if (ruta === 'datos/reconciliar') {
      await new Promise(() => {});
    }
  };
  const pendiente = f.panel.reconciliarTrabajo();
  await turno();
  t.mock.timers.tick(PLAZO_PANEL_CLIENTE_MS);
  assert.equal(activa(await pendiente).aviso, 'recuperacion_incierta');
  await f.panel.reconciliarTrabajo();
  assert.equal(f.efectos().length, 1);
  t.mock.timers.reset();
  const sustituida = await fixture(t);
  await sustituida.directo('sesion/abrir', { retomar: true });
  assert.equal((await sustituida.panel.retirarTrabajo()).estado, 'sustituida');
  const total = sustituida.pedidos.length;
  await sustituida.panel.reconciliarTrabajo();
  await sustituida.panel.consultarActivacion();
  assert.equal(sustituida.pedidos.length, total);
  assert(!Object.hasOwn(sustituida.ultimo(), 'controles'));
  const cierre = await fixture(t);
  const diferida = Promise.withResolvers<void>();
  cierre.ganchos.antes = async (ruta) => {
    if (ruta === 'datos/reconciliar') {
      await diferida.promise;
    }
  };
  const recuperando = cierre.panel.reconciliarTrabajo();
  await turno();
  const cerrando = cierre.panel.cerrar();
  diferida.resolve();
  await Promise.all([recuperando, cerrando]);
  assert.equal(cierre.ultimo().estado, 'cerrada');
  assert(!Object.hasOwn(cierre.ultimo(), 'trabajos'));
});

test('envoltorios de recuperación son cerrados y no ejecutan accesores', () => {
  for (const leer of [leerRetirada, leerReconciliacion]) {
    let ejecutado = false;
    assert.throws(() =>
      leer({
        get estado() {
          ejecutado = true;
          return 'activa';
        },
      }),
    );
    assert.equal(ejecutado, false);
    assert.throws(() => leer({ estado: 'activa', decision: 'publicada' }));
  }
});

async function corromperReconciliacion(salida: Response, defecto: string) {
  const cuerpo = (await salida.json()) as {
    trabajos: { ultimoTrabajo: { solicitudId: string } };
    decision: string;
    sesion: { iniciadaEn: number };
  };
  if (defecto === 'referencia') {
    cuerpo.trabajos.ultimoTrabajo.solicitudId = '11111111-1111-4111-8111-111111111111';
  }
  if (defecto === 'decision') {
    cuerpo.decision = 'completada';
  }
  if (defecto === 'sesion') {
    cuerpo.sesion.iniciadaEn = 1;
  }
  return Response.json(defecto === 'extra' ? { ...cuerpo, secreto: 'no-reflejar' } : cuerpo, {
    status: defecto === 'http' ? CONFLICTO : EXITO,
  });
}
