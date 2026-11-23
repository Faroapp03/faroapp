import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as turno } from 'node:timers/promises';
import type { EstadoActivacionPrivado } from '../../src/administracion/activacion.ts';
import type { AlmacenAdministradores } from '../../src/administracion/administradores.ts';
import { crearRouterAdministrativo } from '../../src/administracion/http.ts';
import {
  type AlmacenSesionPanel,
  DURACION_MAXIMA_SESION_PANEL_MS,
  INACTIVIDAD_SESION_PANEL_MS,
  type SesionPanelActiva,
} from '../../src/administracion/sesion.ts';
import type { AlmacenSesionUnica } from '../../src/administracion/sesion-unica.ts';
import { crearClientePanel, type EstadoClientePanel } from '../../web/administracion/cliente.js';
import { leerLecturaActivacion } from '../../web/administracion/contratos.js';
import { principalDePrueba } from '../ayudas/principal-panel.ts';
import { activa } from './estado-panel.ts';

const ORIGEN = 'https://panel.example';
const TAM_SHA = 40;
const TAM_HUELLA = 64;
const EXITO = 200;
const ACEPTADA = 202;
const INICIO = 1_000_000;
const SESION: SesionPanelActiva = {
  estado: 'activa',
  iniciadaEn: INICIO,
  ultimaActividadEn: INICIO,
  caducaPorInactividadEn: INICIO + INACTIVIDAD_SESION_PANEL_MS,
  caducaAbsolutaEn: INICIO + DURACION_MAXIMA_SESION_PANEL_MS,
};
const CONTROLES = {
  version: 2,
  revision: 17,
  api: 'deshabilitada',
  mcp: false,
  a2a: false,
} as const;
function privada(): EstadoActivacionPrivado {
  return {
    version: 1,
    revision: 1,
    ultimaActivacion: {
      revisionBase: 0,
      fase: 'reservada',
      creadoEn: INICIO,
      actualizadoEn: INICIO,
      evidencia: null,
      versionId: null,
      deploymentId: null,
      error: null,
      trabajo: {
        solicitudId: '11111111-1111-4111-8111-111111111111',
        revisionBase: 0,
        revisionReserva: 1,
        accion: 'actualizar-datos',
        creadoEn: INICIO,
        actualizadoEn: INICIO,
        estado: 'terminado',
        runId: '123',
        runAttempt: '1',
        protocoloInicio: 'obligatorio',
        inicioConfirmado: true,
        huellaRecibo: 'e'.repeat(TAM_HUELLA),
        confianza: {
          audiencia: 'https://resultado.example',
          repositorioId: '101',
          propietarioId: '102',
          ref: 'refs/heads/main',
          workflowRef: 'entidad/app/.github/workflows/actualizar.yml@refs/heads/main',
          sha: 'c'.repeat(TAM_SHA),
          workflowSha: 'd'.repeat(TAM_SHA),
        },
        resultado: {
          resultado: 'validado',
          veredicto: 'verde',
          terminadoEn: '1970-01-01T00:16:40Z',
          huellaPaquete: '0123456789abcdef',
          error: null,
        },
      },
    },
  };
}
function sesionDe() {
  let vigente = true;
  let actividad = 0;
  const almacen: AlmacenSesionPanel & AlmacenSesionUnica & AlmacenAdministradores = {
    activarSesionPanel: async () => {},
    recibirEnPanel: async () => {
      throw new Error('Fuera del escenario');
    },
    abrirSesionUnica: async () => ({
      estado: 'abierta',
      idSesion: 'S-00000001',
      idEntrada: 'E-00000001',
      sesion: SESION,
    }),
    leerRegistroPanel: async () => [],
    // Lista vacía: el panel se comporta como si solo existiera Access.
    autorizarAdministrador: async () => 'sin-lista',
    leerAdministradores: async () => [],
    cambiarAdministradores: async () => {
      throw new Error('Fuera del escenario');
    },
    comprobarSesion: async () => (vigente ? SESION : { estado: 'sustituida' }),
    mantenerSesion: async () => {
      actividad++;
      return SESION;
    },
    cerrarSesion: async () => ({ estado: 'cerrada' }),
    leerControlesDeSesion: async () => ({ estado: 'activa', sesion: SESION, controles: CONTROLES }),
    cambiarControlesDeSesion: async () => {
      throw new Error('Fuera del escenario');
    },
  };
  return {
    almacen,
    sustituir: () => {
      vigente = false;
    },
    actividad: () => actividad,
  };
}
function clienteDe(router: (peticion: Request) => Promise<Response>) {
  const estados: EstadoClientePanel[] = [];
  const pedidos: { ruta: string; cuerpo: unknown }[] = [];
  const ganchos: { despues?: (ruta: string, respuesta: Response) => Promise<Response> } = {};
  const pedir: typeof fetch = async (url, opciones) => {
    const ruta = String(url);
    pedidos.push({ ruta, cuerpo: JSON.parse(String(opciones?.body)) });
    const headers = new Headers(opciones?.headers);
    headers.set('origin', ORIGEN);
    headers.set('sec-fetch-site', 'same-origin');
    const salida = await router(new Request(`${ORIGEN}${ruta}`, { ...opciones, headers }));
    return ganchos.despues ? ganchos.despues(ruta, salida) : salida;
  };
  const panel = crearClientePanel({ pedir, alCambiar: (estado) => estados.push(estado) });
  return { panel, estados, pedidos, ganchos, ultimo: () => estados.at(-1) as EstadoClientePanel };
}
function fixture(disponible = true) {
  const sesion = sesionDe();
  let lecturas = 0;
  let registro = privada();
  const router = crearRouterAdministrativo({
    almacen: sesion.almacen,
    origen: ORIGEN,
    guardiaAdministrativa: async () => principalDePrueba('https://access.example', 'sintetico'),
    ...(disponible
      ? {
          leerActivacion: async () => {
            lecturas++;
            return registro;
          },
        }
      : {}),
  });
  return {
    ...sesion,
    ...clienteDe(router),
    lecturas: () => lecturas,
    vaciar: () => {
      registro = { version: 1, revision: 0, ultimaActivacion: null };
    },
  };
}

test('consulta real de activación envía solo {}, publica DTO mínimo y no renueva ni acredita servido', async () => {
  const f = fixture();
  await f.panel.abrir();
  assert.equal(activa(f.ultimo()).activacion, null);
  const anterior = activa(f.ultimo());
  const estado = activa(await f.panel.consultarActivacion());
  assert.equal(estado.activacion?.ultimaActivacion?.fase, 'reservada');
  assert.equal(estado.activacion?.revision, 1);
  assert.deepEqual(f.pedidos.at(-1), { ruta: '/administracion/api/datos/activacion', cuerpo: {} });
  assert.deepEqual(estado.controles, anterior.controles);
  assert.equal(estado.datos, null);
  assert.equal(estado.trabajos, null);
  assert.equal(f.actividad(), 0);
  assert.equal(f.lecturas(), 1);
  for (const privado of ['confianza', 'huellaRecibo', 'workflowRef', 'sha256', 'huellaPaquete']) {
    assert(!JSON.stringify(f.estados).includes(privado));
  }
  f.panel.destruir();
  const vacio = fixture();
  vacio.vaciar();
  await vacio.panel.abrir();
  assert.equal(activa(await vacio.panel.consultarActivacion()).activacion?.ultimaActivacion, null);
  vacio.panel.destruir();
});

test('503, red y respuesta malformada retiran observación y conservan controles', async () => {
  const ausente = fixture(false);
  await ausente.panel.abrir();
  const estado = activa(await ausente.panel.consultarActivacion());
  assert.equal(estado.activacion, null);
  assert.equal(estado.aviso, 'activacion_no_disponible');
  assert.equal(activa(await ausente.panel.comprobar()).aviso, 'activacion_no_disponible');
  ausente.panel.destruir();
  for (const defecto of ['red', 'extra', 'sesion', 'fase', 'http']) {
    const f = fixture();
    await f.panel.abrir();
    await f.panel.consultarActivacion();
    f.ganchos.despues = async (ruta, salida) => {
      if (!ruta.endsWith('activacion')) {
        return salida;
      }
      if (defecto === 'red') {
        throw new TypeError('sin conexión');
      }
      return corromperActivacion(salida, defecto);
    };
    const actual = activa(await f.panel.consultarActivacion());
    assert.equal(actual.activacion, null);
    assert.equal(actual.controles.revision, CONTROLES.revision);
    assert.equal(actual.aviso, 'activacion_no_disponible');
    assert(!JSON.stringify(f.estados).includes('nunca'));
    f.panel.destruir();
  }
});

test('sesión sustituida y cerrar durante consulta borran observación e ignoran respuesta tardía', async () => {
  const f = fixture();
  await f.panel.abrir();
  await f.panel.consultarActivacion();
  f.sustituir();
  assert.equal((await f.panel.consultarActivacion()).estado, 'sustituida');
  assert(!Object.hasOwn(f.ultimo(), 'activacion'));
  const total = f.pedidos.length;
  await f.panel.consultarActivacion();
  assert.equal(f.pedidos.length, total);
  f.panel.destruir();
  const cierre = fixture();
  await cierre.panel.abrir();
  const diferida = Promise.withResolvers<Response>();
  cierre.ganchos.despues = async (ruta, salida) => (ruta.endsWith('activacion') ? diferida.promise : salida);
  const leyendo = cierre.panel.consultarActivacion();
  await turno();
  const cerrando = cierre.panel.cerrar();
  diferida.resolve(Response.json({ secreto: 'nunca' }));
  await Promise.all([leyendo, cerrando]);
  assert.equal(cierre.ultimo().estado, 'cerrada');
  assert(!Object.hasOwn(cierre.ultimo(), 'activacion'));
  cierre.panel.destruir();
});

test('envoltorio de activación es cerrado y rechaza accesores sin ejecutarlos', () => {
  let ejecutado = false;
  assert.throws(() =>
    leerLecturaActivacion({
      get estado() {
        ejecutado = true;
        return 'activa';
      },
    }),
  );
  assert.equal(ejecutado, false);
  assert.throws(() => leerLecturaActivacion({ estado: 'activa', sesion: SESION, activacion: null }));
});

test('la revisión observada no retrocede tras fallo y no cambia contenido sin nueva revisión', async () => {
  for (const defecto of ['vieja', 'misma']) {
    const f = fixture();
    await f.panel.abrir();
    await f.panel.consultarActivacion();
    f.ganchos.despues = async (ruta, salida) => {
      if (ruta.endsWith('activacion')) {
        throw new TypeError('lectura perdida');
      }
      return salida;
    };
    await f.panel.consultarActivacion();
    assert.equal(activa(f.ultimo()).activacion, null);
    f.ganchos.despues = async (ruta, salida) => {
      if (!ruta.endsWith('activacion') || defecto === 'vieja') {
        return salida;
      }
      const cuerpo = (await salida.json()) as { activacion: { ultimaActivacion: { actualizadoEn: number } } };
      cuerpo.activacion.ultimaActivacion.actualizadoEn++;
      return Response.json(cuerpo);
    };
    if (defecto === 'vieja') {
      f.vaciar();
    }
    const estado = activa(await f.panel.consultarActivacion());
    assert.equal(estado.activacion, null);
    assert.equal(estado.aviso, 'activacion_no_disponible');
    f.panel.destruir();
  }
});

async function corromperActivacion(salida: Response, defecto: string) {
  const cuerpo = (await salida.json()) as {
    sesion: { iniciadaEn: number };
    activacion: { ultimaActivacion: { fase: string } };
  };
  if (defecto === 'sesion') {
    cuerpo.sesion.iniciadaEn = 1;
  }
  if (defecto === 'fase') {
    cuerpo.activacion.ultimaActivacion.fase = 'confirmada';
  }
  return Response.json(defecto === 'extra' ? { ...cuerpo, secreto: 'nunca' } : cuerpo, {
    status: defecto === 'http' ? ACEPTADA : EXITO,
  });
}
