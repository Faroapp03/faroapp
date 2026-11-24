// HTTP real y SQLite aislado; el despacho remoto se sustituye, sin red ni credenciales reales.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { setImmediate as turno } from 'node:timers/promises';
import {
  crearSolicitadorActualizacion,
  leerResultadoSolicitudActualizacion,
} from '../../src/administracion/actualizacion.ts';
import type { ResultadoConsultaEjecucion } from '../../src/administracion/consulta-ejecucion-github.ts';
import type { PoliticaControles } from '../../src/administracion/controles.ts';
import type { ResultadoDespacho } from '../../src/administracion/ejecutor-github.ts';
import {
  type CapacidadActualizacionPanel,
  crearRouterAdministrativo,
  MAX_CUERPO_PANEL_BYTES,
  PLAZO_PANEL_MS,
} from '../../src/administracion/http.ts';
import {
  crearReconciliadorActualizacion,
  leerResultadoReconciliacion,
} from '../../src/administracion/reconciliacion.ts';
import { INACTIVIDAD_SESION_PANEL_MS } from '../../src/administracion/sesion.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { AlmacenSesionPanelSqlite } from '../../src/plataforma/acceso-publico/sesion-sqlite.ts';
import { AlmacenPublicoSqlite } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { motorPanel } from '../ayudas/persistencia-panel.ts';
import { principalDePrueba } from '../ayudas/principal-panel.ts';

/** GitHub no responde a la consulta del trabajo que ocupa: la reserva decide como si no se hubiera consultado. */
const GITHUB_SIN_RESPUESTA = async () => 'indeterminada' as const;

const TAM_SHA = 40;
const TAM_HUELLA_RECIBO = 64;
const ENVIOS_DOS = 2;
const ORIGEN = 'https://panel.example';
const INICIO = Date.parse('2026-10-16T12:00:00Z');
const SOLICITUD = {
  solicitudId: 'a3904d28-7ff8-41cc-b7d8-1ced941cf011',
  accion: 'actualizar-datos',
  revisionEsperada: 0,
} as const;
const SEGUNDA_ID = 'a3904d28-7ff8-41cc-b7d8-1ced941cf022';
const CONFIANZA = {
  audiencia: 'https://mantenimiento.example/resultado',
  repositorioId: '101',
  propietarioId: '102',
  ref: 'refs/heads/main',
  workflowRef: 'entidad/herramienta/.github/workflows/actualizar.yml@refs/heads/main',
  sha: 'c'.repeat(TAM_SHA),
  workflowSha: 'd'.repeat(TAM_SHA),
};
const POLITICA: PoliticaControles = {
  version: 2,
  api: 'deshabilitada',
  mcp: false,
  a2a: false,
};
async function fixture(
  t: TestContext,
  despachar: (senal: AbortSignal) => Promise<ResultadoDespacho> = async () => ({ estado: 'despachada', runId: '123' }),
  consultar: () => Promise<ResultadoConsultaEjecucion> = async () => ({ estado: 'en-curso' }),
) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  let ahora = INICIO;
  let envios = 0;
  const sql = motorPanel(db);
  const publico = new AlmacenPublicoSqlite(sql, { maxClientes: 1 });
  await publico.activarControles(POLITICA);
  const almacen = new AlmacenSesionPanelSqlite(sql, { ahora: () => ahora });
  await almacen.activarSesionPanel();
  await almacen.prepararTrabajos();
  const capacidad: CapacidadActualizacionPanel = {
    leer: (acceso) => almacen.leerTrabajoDeSesion(acceso),
    solicitar: crearSolicitadorActualizacion({
      almacen,
      reconciliar: GITHUB_SIN_RESPUESTA,
      confianza: CONFIANZA,
      despachar: async (_solicitud, senal) => {
        envios++;
        return despachar(senal);
      },
    }),
    recuperacion: {
      retirar: (acceso, retirada) => almacen.retirarTrabajoDeSesion(acceso, retirada),
      reconciliar: crearReconciliadorActualizacion({ almacen, consultar }),
    },
  };

  return {
    db,
    almacen,
    publico,
    capacidad,
    ...clienteHttp(almacen, capacidad),
    envios: () => envios,
    avanzar: (ms: number) => {
      ahora += ms;
    },
  };
}

function clienteHttp(almacen: AlmacenSesionPanelSqlite, capacidad: CapacidadActualizacionPanel) {
  const routerCon = (actualizacion?: CapacidadActualizacionPanel) =>
    crearRouterAdministrativo({
      almacen,
      origen: ORIGEN,
      guardiaAdministrativa: async (peticion) => {
        const identidad = peticion.headers.get('cf-access-jwt-assertion');
        return identidad === 'uno' || identidad === 'dos'
          ? principalDePrueba('https://access.example', identidad)
          : null;
      },
      ...(actualizacion ? { actualizacion } : {}),
    });
  const router = routerCon(capacidad);
  const peticion = (ruta: string, cuerpo: unknown = {}, token?: string) =>
    new Request(`${ORIGEN}/administracion/api/${ruta}`, {
      method: 'POST',
      body: JSON.stringify(cuerpo),
      headers: {
        origin: ORIGEN,
        'sec-fetch-site': 'same-origin',
        'x-faro-panel': '1',
        'content-type': 'application/json',
        'cf-access-jwt-assertion': 'uno',
        ...(token ? { 'x-faro-sesion': token } : {}),
      },
    });
  const abrir = async () => {
    const salida = await router(peticion('sesion/abrir', { retomar: true }));
    assert.equal(salida.status, ESTADO_HTTP.correcto);
    const resultado = (await salida.json()) as { token: string };
    assert.equal(typeof resultado.token, 'string');
    return resultado.token;
  };
  return { router, routerCon, peticion, abrir };
}
async function solicitudActiva(salida: Response) {
  const resultado = leerResultadoSolicitudActualizacion(await salida.json());
  assert.ok(resultado.estado === 'activa');
  return resultado;
}

test('solicitar reserva una sola vez; sondear y repetir devuelven DTO público sin afirmar activación', async (t) => {
  const p = await fixture(t);
  const token = await p.abrir();
  const nueva = await p.router(p.peticion('datos/actualizar', SOLICITUD, token));
  assert.equal(nueva.status, ESTADO_HTTP.aceptada);
  const creada = await solicitudActiva(nueva);
  assert.ok(creada.trabajos.ultimoTrabajo);
  assert.equal(creada.decision, 'nueva');
  assert.equal(creada.trabajos.ultimoTrabajo.estado, 'despachado');
  assert.equal(creada.trabajos.ultimoTrabajo.resultado, null);
  const repetida = await p.router(p.peticion('datos/actualizar', SOLICITUD, token));
  assert.equal(repetida.status, ESTADO_HTTP.correcto);
  assert.equal((await solicitudActiva(repetida)).decision, 'repetida');
  const lectura = await p.router(p.peticion('datos/trabajo', {}, token));
  assert.equal(lectura.status, ESTADO_HTTP.correcto);
  assert.equal(lectura.headers.get('cache-control'), 'no-store');
  assert.equal(lectura.headers.get('set-cookie'), null);
  const texto = await lectura.text();
  for (const secreto of ['confianza', 'workflowRef', 'workflowSha', 'huellaRecibo', 'activada', token]) {
    assert.equal(texto.includes(secreto), false);
  }
  assert.equal(p.envios(), 1);
});

test('CAS y ocupado son 409 sin otro despacho, incluso con id repetido que cambia acción', async (t) => {
  const p = await fixture(t);
  const token = await p.abrir();
  await p.router(p.peticion('datos/actualizar', SOLICITUD, token));
  for (const cuerpo of [
    { ...SOLICITUD, solicitudId: SEGUNDA_ID },
    { ...SOLICITUD, solicitudId: SEGUNDA_ID, revisionEsperada: 2 },
    { ...SOLICITUD, accion: 'reintentar-pendientes' },
  ]) {
    const salida = await p.router(p.peticion('datos/actualizar', cuerpo, token));
    assert.equal(salida.status, ESTADO_HTTP.conflicto);
    assert.ok(['conflicto', 'ocupado'].includes((await solicitudActiva(salida)).decision));
  }
  assert.equal(p.envios(), 1);
});

test('despacho incierto es 202 y rechazo confirmado es 200 con resultado explícito', async (t) => {
  for (const estado of ['incierta', 'rechazada'] as const) {
    const p = await fixture(t, async () => ({ estado }));
    const token = await p.abrir();
    const salida = await p.router(p.peticion('datos/actualizar', SOLICITUD, token));
    assert.equal(salida.status, estado === 'incierta' ? ESTADO_HTTP.aceptada : ESTADO_HTTP.correcto);
    const resultado = await solicitudActiva(salida);
    assert.ok(resultado.trabajos.ultimoTrabajo);
    assert.equal(resultado.trabajos.ultimoTrabajo.estado, estado === 'incierta' ? 'despacho-incierto' : 'terminado');
    assert.equal(
      resultado.trabajos.ultimoTrabajo.resultado?.resultado ?? null,
      estado === 'rechazada' ? 'despacho-rechazado' : null,
    );
  }
});

test('capacidad ausente solo responde 503 después de Access y sesión vigentes', async (t) => {
  const p = await fixture(t);
  const router = p.routerCon();
  const primera = await p.abrir();
  const segunda = await p.abrir();
  for (const ruta of ['datos/trabajo', 'datos/actualizar']) {
    const cuerpo = ruta.endsWith('actualizar') ? SOLICITUD : {};
    assert.equal((await router(p.peticion(ruta, cuerpo))).status, ESTADO_HTTP.prohibido);
    assert.equal((await router(p.peticion(ruta, cuerpo, primera))).status, ESTADO_HTTP.conflicto);
    assert.equal((await router(p.peticion(ruta, cuerpo, segunda))).status, ESTADO_HTTP.noDisponible);
    const sinAccess = p.peticion(ruta, cuerpo, segunda);
    sinAccess.headers.delete('cf-access-jwt-assertion');
    assert.equal((await router(sinAccess)).status, ESTADO_HTTP.prohibido);
  }
  assert.equal(p.envios(), 0);
});

test('entradas cerradas, origen y límite 4 KiB rechazan sin reservar ni aceptar órdenes del cliente', async (t) => {
  const p = await fixture(t);
  const token = await p.abrir();
  for (const cuerpo of [
    {},
    { ...SOLICITUD, token },
    { ...SOLICITUD, ref: 'main' },
    { ...SOLICITUD, comando: 'orden' },
    { ...SOLICITUD, accion: 'fuente-id' },
    { ...SOLICITUD, accion: 'comprobar-programada' },
    { ...SOLICITUD, revisionEsperada: -1 },
    { ...SOLICITUD, solicitudId: '../ruta' },
  ]) {
    assert.equal(
      (await p.router(p.peticion('datos/actualizar', cuerpo, token))).status,
      ESTADO_HTTP.solicitudIncorrecta,
    );
  }
  assert.equal((await p.router(p.peticion('datos/trabajo', SOLICITUD, token))).status, ESTADO_HTTP.solicitudIncorrecta);
  const ajena = p.peticion('datos/actualizar', SOLICITUD, token);
  ajena.headers.set('origin', 'https://ajeno.example');
  assert.equal((await p.router(ajena)).status, ESTADO_HTTP.prohibido);
  const grande = new Request(p.peticion('datos/actualizar', SOLICITUD, token), {
    body: ' '.repeat(MAX_CUERPO_PANEL_BYTES + 1),
  });
  assert.equal((await p.router(grande)).status, ESTADO_HTTP.solicitudIncorrecta);
  assert.equal(p.envios(), 0);
  assert.equal((await p.almacen.leerTrabajoPrivado()).revision, 0);
});

test('sondear no renueva; sesión sustituida o identidad ajena no reserva y controles corruptos fallan cerrado', async (t) => {
  const p = await fixture(t);
  const token = await p.abrir();
  p.avanzar(INACTIVIDAD_SESION_PANEL_MS - 1);
  assert.equal((await p.router(p.peticion('datos/trabajo', {}, token))).status, ESTADO_HTTP.correcto);
  p.avanzar(1);
  assert.equal((await p.router(p.peticion('datos/trabajo', {}, token))).status, ESTADO_HTTP.prohibido);
  const nuevo = await p.abrir();
  assert.equal((await p.router(p.peticion('datos/actualizar', SOLICITUD, token))).status, ESTADO_HTTP.conflicto);
  const ajena = p.peticion('datos/actualizar', SOLICITUD, nuevo);
  ajena.headers.set('cf-access-jwt-assertion', 'dos');
  assert.equal((await p.router(ajena)).status, ESTADO_HTTP.conflicto);
  p.db.exec('DELETE FROM administracion_controles');
  assert.equal((await p.router(p.peticion('datos/actualizar', SOLICITUD, nuevo))).status, ESTADO_HTTP.noDisponible);
  assert.equal(p.envios(), 0);
});

test('el router revalida después del callback y retira resultados si otra pestaña sustituye o caduca', async (t) => {
  for (const sustituir of [true, false]) {
    const p = await fixture(t);
    const token = await p.abrir();
    const router = p.routerCon({
      ...p.capacidad,
      leer: async (acceso) => {
        const resultado = await p.almacen.leerTrabajoDeSesion(acceso);
        if (sustituir) {
          await p.abrir();
        } else {
          p.avanzar(INACTIVIDAD_SESION_PANEL_MS);
        }
        return resultado;
      },
    });
    const salida = await router(p.peticion('datos/trabajo', {}, token));
    assert.equal(salida.status, sustituir ? ESTADO_HTTP.conflicto : ESTADO_HTTP.prohibido);
    assert.deepEqual(await salida.json(), { error: sustituir ? 'sesion_sustituida' : 'sesion_inactiva' });
  }
});

test('sustituir durante despacho conserva trabajo durable y deniega respuesta anterior', async (t) => {
  let reemplazar = async () => {};
  const p = await fixture(t, async () => {
    await reemplazar();
    return { estado: 'despachada', runId: '123' };
  });
  const token = await p.abrir();
  reemplazar = async () => {
    await p.abrir();
  };
  const salida = await p.router(p.peticion('datos/actualizar', SOLICITUD, token));
  assert.equal(salida.status, ESTADO_HTTP.conflicto);
  assert.deepEqual(await salida.json(), { error: 'sesion_sustituida' });
  assert.equal((await p.almacen.leerTrabajoPrivado()).ultimoTrabajo?.runId, '123');
  assert.equal(p.envios(), 1);
});

test('respuestas corruptas o con pins privados dan 503 sin reflejar campos libres', async (t) => {
  const p = await fixture(t);
  const token = await p.abrir();
  for (const solicitar of [false, true]) {
    const corrupta = async () => ({ estado: 'activa', confianza: CONFIANZA, token }) as never;
    const router = p.routerCon({ leer: corrupta, solicitar: corrupta });
    const salida = await router(
      p.peticion(solicitar ? 'datos/actualizar' : 'datos/trabajo', solicitar ? SOLICITUD : {}, token),
    );
    assert.equal(salida.status, ESTADO_HTTP.noDisponible);
    assert.deepEqual(await salida.json(), { error: 'no_disponible' });
  }
});

test('plazo aborta despacho sin reintento; reserva incierta se consulta y repetición no despacha', async (t) => {
  const remoto = Promise.withResolvers<ResultadoDespacho>();
  let senalRemota: AbortSignal | undefined;
  const p = await fixture(t, (senal) => {
    senalRemota = senal;
    return remoto.promise;
  });
  const token = await p.abrir();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pendiente = p.router(p.peticion('datos/actualizar', SOLICITUD, token));
  await turno();
  assert.equal(p.envios(), 1);
  t.mock.timers.tick(PLAZO_PANEL_MS);
  assert.equal((await pendiente).status, ESTADO_HTTP.tiempoAgotado);
  assert.equal(senalRemota?.aborted, true);
  assert.equal((await p.almacen.leerTrabajoPrivado()).ultimoTrabajo?.estado, 'despacho-incierto');
  const repetida = await p.router(p.peticion('datos/actualizar', SOLICITUD, token));
  assert.equal(repetida.status, ESTADO_HTTP.correcto);
  assert.equal((await solicitudActiva(repetida)).decision, 'repetida');
  remoto.resolve({ estado: 'incierta' });
  await turno();
  assert.equal(p.envios(), 1);
});

const MS_SEGUNDO = 1000;
const VIGENCIA_TOKEN_S = 300;
const CONSULTAS_ESPERADAS = 3;
const REFERENCIA = { solicitudId: SOLICITUD.solicitudId, revisionReserva: 1 };
function identidadDeInicio() {
  const { audiencia: _audiencia, ...identidad } = CONFIANZA;
  return {
    ...identidad,
    runId: '123',
    runAttempt: '1',
    jti: 'inicio-sintetico',
    emitidoEn: INICIO / MS_SEGUNDO,
    caducaEn: INICIO / MS_SEGUNDO + VIGENCIA_TOKEN_S,
  };
}
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

test('retirada HTTP exige sesión y CAS; impide inicio tardío y no despacha otra ejecución', async (t) => {
  const p = await fixture(t);
  const token = await p.abrir();
  await p.router(p.peticion('datos/actualizar', SOLICITUD, token));
  const privado = await p.almacen.leerTrabajoPrivado();
  const retirada = { ...REFERENCIA, revisionEsperada: privado.revision };
  assert.equal(
    (await p.router(p.peticion('datos/retirar', { ...retirada, revisionEsperada: 0 }, token))).status,
    ESTADO_HTTP.conflicto,
  );
  assert.equal((await p.router(p.peticion('datos/retirar', retirada))).status, ESTADO_HTTP.prohibido);
  const salida = await p.router(p.peticion('datos/retirar', retirada, token));
  assert.equal(salida.status, ESTADO_HTTP.correcto);
  assert.equal(((await salida.json()) as { estado: string }).estado, 'retirado');
  assert.equal(
    (await p.almacen.confirmarInicio({ ...REFERENCIA, accion: SOLICITUD.accion }, identidadDeInicio())).estado,
    'conflicto',
  );
  assert.equal((await p.almacen.leerTrabajoPrivado()).ultimoTrabajo?.resultado?.resultado, 'retirado');
  assert.equal(p.envios(), 1);
});

test('un trabajo iniciado no se retira y un GET activo o fallido no lo libera; completado nunca equivale a candidato', async (t) => {
  let resultado: ResultadoConsultaEjecucion = { estado: 'en-curso' };
  let consultas = 0;
  const p = await fixture(t, undefined, async () => {
    consultas++;
    return resultado;
  });
  const token = await p.abrir();
  await p.router(p.peticion('datos/actualizar', SOLICITUD, token));
  assert.equal(
    (await p.almacen.confirmarInicio({ ...REFERENCIA, accion: SOLICITUD.accion }, identidadDeInicio())).estado,
    'aplicado',
  );
  const previo = await p.almacen.leerTrabajoPrivado();
  assert.equal(
    (await p.router(p.peticion('datos/retirar', { ...REFERENCIA, revisionEsperada: previo.revision }, token))).status,
    ESTADO_HTTP.conflicto,
  );
  assert.equal((await p.router(p.peticion('datos/reconciliar', REFERENCIA, token))).status, ESTADO_HTTP.correcto);
  assert.deepEqual(await p.almacen.leerTrabajoPrivado(), previo);
  resultado = { estado: 'no-disponible' };
  assert.equal((await p.router(p.peticion('datos/reconciliar', REFERENCIA, token))).status, ESTADO_HTTP.noDisponible);
  assert.deepEqual(await p.almacen.leerTrabajoPrivado(), previo);
  resultado = COMPLETADA;
  const salida = await p.router(p.peticion('datos/reconciliar', REFERENCIA, token));
  assert.equal(salida.status, ESTADO_HTTP.correcto);
  const texto = await salida.text();
  assert.match(texto, /ejecucion-sin-recibo/);
  for (const secreto of ['workflowSha', 'workflowRef', 'huellaRecibo', 'protocoloInicio', 'inicioConfirmado']) {
    assert.equal(texto.includes(secreto), false);
  }
  const final = await p.almacen.leerTrabajoPrivado();
  assert.equal(final.ultimoTrabajo?.resultado?.huellaPaquete, null);
  assert.equal(final.ultimoTrabajo?.resultado?.veredicto, null);
  await p.router(p.peticion('datos/reconciliar', REFERENCIA, token));
  assert.deepEqual(await p.almacen.leerTrabajoPrivado(), final);
  assert.equal(consultas, CONSULTAS_ESPERADAS);
  assert.equal(p.envios(), 1);
});

test('sustitución de sesión durante GET y referencia ajena no cierran el trabajo', async (t) => {
  let sustituir = async () => {};
  let consultas = 0;
  const p = await fixture(t, undefined, async () => {
    consultas++;
    await sustituir();
    return COMPLETADA;
  });
  const token = await p.abrir();
  await p.router(p.peticion('datos/actualizar', SOLICITUD, token));
  const previo = await p.almacen.leerTrabajoPrivado();
  assert.equal(
    (await p.router(p.peticion('datos/reconciliar', { ...REFERENCIA, solicitudId: SEGUNDA_ID }, token))).status,
    ESTADO_HTTP.conflicto,
  );
  assert.equal(consultas, 0);
  sustituir = async () => {
    await p.abrir();
  };
  assert.equal((await p.router(p.peticion('datos/reconciliar', REFERENCIA, token))).status, ESTADO_HTTP.conflicto);
  assert.deepEqual(await p.almacen.leerTrabajoPrivado(), previo);
  assert.equal(consultas, 1);
});

test('recuperación rechaza instrucciones libres y solo ofrece capacidad después de autenticar', async (t) => {
  const p = await fixture(t);
  const token = await p.abrir();
  for (const ruta of ['datos/retirar', 'datos/reconciliar']) {
    const cuerpo = ruta.endsWith('retirar') ? { ...REFERENCIA, revisionEsperada: 0 } : REFERENCIA;
    assert.equal(
      (await p.router(p.peticion(ruta, { ...cuerpo, runId: 'ajeno' }, token))).status,
      ESTADO_HTTP.solicitudIncorrecta,
    );
    const ajena = p.peticion(ruta, cuerpo, token);
    ajena.headers.set('origin', 'https://ajeno.example');
    assert.equal((await p.router(ajena)).status, ESTADO_HTTP.prohibido);
    const sinCapacidad = p.routerCon({ leer: p.capacidad.leer, solicitar: p.capacidad.solicitar });
    assert.equal((await sinCapacidad(p.peticion(ruta, cuerpo, token))).status, ESTADO_HTTP.noDisponible);
  }
  assert.equal(p.envios(), 0);
});

const CASOS_CARRERA_GET = [
  {
    nombre: 'recibo terminal',
    nuevaReserva: false,
    status: ESTADO_HTTP.correcto,
    decision: 'terminado',
    id: SOLICITUD.solicitudId,
    estado: 'terminado',
    envios: 1,
  },
  {
    nombre: 'otra reserva',
    nuevaReserva: true,
    status: ESTADO_HTTP.conflicto,
    decision: 'conflicto',
    id: SEGUNDA_ID,
    estado: 'despachado',
    envios: ENVIOS_DOS,
  },
];

test('GET en-curso no contradice un recibo terminal ni se atribuye a una reserva nueva', async (t) => {
  for (const caso of CASOS_CARRERA_GET) {
    await t.test(caso.nombre, async (t) => {
      let alConsultar = async () => {};
      const p = await fixture(t, undefined, async () => {
        await alConsultar();
        return { estado: 'en-curso' };
      });
      const token = await p.abrir();
      await p.router(p.peticion('datos/actualizar', SOLICITUD, token));
      await p.almacen.confirmarInicio({ ...REFERENCIA, accion: SOLICITUD.accion }, identidadDeInicio());
      alConsultar = async () => {
        const recibido = await p.almacen.registrarRecibo(
          {
            ...REFERENCIA,
            accion: SOLICITUD.accion,
            resultado: 'rechazado',
            veredicto: null,
            terminadoEn: '2026-10-16T12:00:00Z',
            huellaPaquete: null,
            error: 'candidato_no_verificable',
          },
          'e'.repeat(TAM_HUELLA_RECIBO),
          identidadDeInicio(),
        );
        assert.equal(recibido.estado, 'aplicado');
        if (caso.nuevaReserva) {
          const revisionEsperada = (await p.almacen.leerTrabajoPrivado()).revision;
          await p.router(
            p.peticion('datos/actualizar', { ...SOLICITUD, solicitudId: SEGUNDA_ID, revisionEsperada }, token),
          );
        }
      };
      const salida = await p.router(p.peticion('datos/reconciliar', REFERENCIA, token));
      assert.equal(salida.status, caso.status);
      const respuesta = leerResultadoReconciliacion(await salida.json());
      assert.ok(respuesta.estado === 'activa');
      assert.equal(respuesta.decision, caso.decision);
      assert.equal(respuesta.trabajos.ultimoTrabajo?.solicitudId, caso.id);
      assert.equal(respuesta.trabajos.ultimoTrabajo?.estado, caso.estado);
      assert.equal(p.envios(), caso.envios);
    });
  }
});
