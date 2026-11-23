import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as turno } from 'node:timers/promises';
import type { EstadoTrabajos, SolicitudTrabajo } from '../../src/administracion/trabajos.ts';
import {
  crearClientePanel,
  type EstadoClientePanel,
  PLAZO_PANEL_CLIENTE_MS,
} from '../../web/administracion/cliente.js';
import { leerActualizacion, leerLecturaTrabajo } from '../../web/administracion/contratos.js';
import { activa } from './estado-panel.ts';

const INICIO = 1_000_000;
const INACTIVIDAD = 900_000;
const ABSOLUTA = 28_800_000;
const REVISION_CONTROLES = 17;
const REVISION_TERMINADA = 3;
const LONGITUD_TOKEN = 43;
const EXITO = 200;
const ACEPTADA = 202;
const sesion = {
  estado: 'activa',
  iniciadaEn: INICIO,
  ultimaActividadEn: INICIO,
  caducaPorInactividadEn: INICIO + INACTIVIDAD,
  caducaAbsolutaEn: INICIO + ABSOLUTA,
};
const controles = {
  version: 2,
  revision: REVISION_CONTROLES,
  api: 'deshabilitada',
  mcp: false,
  a2a: false,
};
const vacio = (): EstadoTrabajos => ({ version: 1, revision: 0, ultimoTrabajo: null });
function reservado(solicitud: SolicitudTrabajo, terminado = false): EstadoTrabajos {
  return {
    version: 1,
    revision: terminado ? REVISION_TERMINADA : 2,
    ultimoTrabajo: {
      solicitudId: solicitud.solicitudId,
      accion: solicitud.accion,
      revisionBase: 0,
      revisionReserva: 1,
      creadoEn: INICIO,
      actualizadoEn: INICIO,
      estado: terminado ? 'terminado' : 'despachado',
      runId: '123',
      runAttempt: '1',
      resultado: terminado
        ? {
            resultado: 'validado',
            veredicto: 'verde',
            terminadoEn: new Date(INICIO).toISOString().replace('.000Z', 'Z'),
            huellaPaquete: '0123456789abcdef',
            error: null,
          }
        : null,
    },
  };
}
function preparar(responder: (ruta: string, cuerpo: unknown) => Promise<Response> | Response) {
  const pedidos: { ruta: string; cuerpo: unknown; opciones: RequestInit | undefined }[] = [];
  const estados: EstadoClientePanel[] = [];
  const pedir: typeof fetch = async (entrada, opciones) => {
    const ruta = String(entrada).split('/').at(-1) ?? '';
    const cuerpo: unknown = JSON.parse(String(opciones?.body));
    pedidos.push({ ruta, cuerpo, opciones });
    if (ruta === 'abrir') {
      return Response.json({ token: 'A'.repeat(LONGITUD_TOKEN), sesion });
    }
    if (ruta === 'leer') {
      return Response.json({ estado: 'activa', sesion, controles });
    }
    if (ruta === 'actividad') {
      return Response.json({ sesion });
    }
    if (ruta === 'cerrar') {
      return Response.json({ estado: 'cerrada' });
    }
    return responder(ruta, cuerpo);
  };
  const panel = crearClientePanel({ pedir, alCambiar: (estado) => estados.push(estado) });
  return { panel, pedidos, estados, ultimo: () => estados.at(-1) as EstadoClientePanel };
}
const lectura = (trabajos: EstadoTrabajos) => ({ estado: 'activa', sesion, trabajos });

test('actualización real usa lectura fresca, UUID y CAS independiente, con un solo vuelo', async () => {
  let trabajos = vacio();
  const f = preparar((ruta, cuerpo) => {
    if (ruta === 'trabajo') {
      return Response.json(lectura(trabajos));
    }
    trabajos = reservado(cuerpo as SolicitudTrabajo);
    return Response.json({ ...lectura(trabajos), decision: 'nueva' }, { status: 202 });
  });
  await f.panel.abrir();
  assert.equal(activa(f.ultimo()).trabajos, null);
  const uno = f.panel.actualizarDatos();
  const dos = f.panel.actualizarDatos();
  await Promise.all([uno, dos]);
  assert.deepEqual(
    f.pedidos.map((p) => p.ruta),
    ['abrir', 'leer', 'trabajo', 'actualizar'],
  );
  const solicitud = f.pedidos.at(-1)?.cuerpo as SolicitudTrabajo;
  assert.match(solicitud.solicitudId, /^[0-9a-f-]{36}$/);
  assert.equal(solicitud.revisionEsperada, 0);
  assert.equal(solicitud.accion, 'actualizar-datos');
  assert.equal(activa(f.ultimo()).trabajos?.ultimoTrabajo?.estado, 'despachado');
  await f.panel.actualizarDatos();
  assert.equal(f.pedidos.filter((p) => p.ruta === 'actualizar').length, 1);
  assert.equal(activa(f.ultimo()).aviso, 'trabajo_ocupado');
});

test('capacidad no disponible conserva controles y consulta fallida impide el POST', async () => {
  const f = preparar(() => Response.json({ error: 'no_disponible' }, { status: 503 }));
  await f.panel.abrir();
  const estado = activa(await f.panel.actualizarDatos());
  assert.equal(estado.controles.revision, REVISION_CONTROLES);
  assert.equal(estado.aviso, 'trabajos_no_disponibles');
  assert.equal(estado.trabajos, null);
  assert.equal(f.pedidos.filter((p) => p.ruta === 'actualizar').length, 0);
});

test('resultado incierto exige lectura; comprobar y mantener no lo borran ni repiten POST', async () => {
  let trabajos = vacio();
  const f = preparar((ruta, cuerpo) => {
    if (ruta === 'trabajo') {
      return Response.json(lectura(trabajos));
    }
    trabajos = reservado(cuerpo as SolicitudTrabajo);
    throw new TypeError('sin conexión');
  });
  await f.panel.abrir();
  assert.equal(activa(await f.panel.actualizarDatos()).aviso, 'actualizacion_incierta');
  assert.equal(activa(await f.panel.comprobar()).aviso, 'actualizacion_incierta');
  assert.equal(activa(await f.panel.mantener()).aviso, 'actualizacion_incierta');
  const total = f.pedidos.length;
  await f.panel.actualizarDatos();
  assert.equal(f.pedidos.length, total);
  assert.equal(activa(await f.panel.consultarTrabajo()).trabajos?.revision, 2);
  assert.equal(f.pedidos.filter((p) => p.ruta === 'actualizar').length, 1);
});

test('200 terminado acepta candidato validado sin cambiar datos ni controles', async () => {
  const f = preparar((ruta, cuerpo) =>
    ruta === 'trabajo'
      ? Response.json(lectura(vacio()))
      : Response.json({ ...lectura(reservado(cuerpo as SolicitudTrabajo, true)), decision: 'nueva' }),
  );
  await f.panel.abrir();
  const estado = activa(await f.panel.actualizarDatos('reintentar-pendientes'));
  assert.equal(estado.trabajos?.ultimoTrabajo?.resultado?.resultado, 'validado');
  assert.equal(estado.datos, null);
  assert.equal(estado.controles.revision, REVISION_CONTROLES);
});

test('409 conflicto refresca trabajos y no reenvía la acción', async () => {
  const otra: SolicitudTrabajo = {
    solicitudId: '11111111-1111-4111-8111-111111111111',
    accion: 'actualizar-datos',
    revisionEsperada: 0,
  };
  const f = preparar((ruta) =>
    ruta === 'trabajo'
      ? Response.json(lectura(vacio()))
      : Response.json({ ...lectura(reservado(otra)), decision: 'conflicto' }, { status: 409 }),
  );
  await f.panel.abrir();
  assert.equal(activa(await f.panel.actualizarDatos()).aviso, 'revision_trabajos_conflictiva');
  assert.equal(f.pedidos.filter((p) => p.ruta === 'actualizar').length, 1);
});

test('respuesta de otra solicitud, HTTP incoherente y claves extra no confirman mutación', async () => {
  for (const defecto of ['ajena', 'http', 'extra', 'sesion']) {
    const f = preparar((ruta, cuerpo) => {
      if (ruta === 'trabajo') {
        return Response.json(lectura(vacio()));
      }
      return respuestaDefectuosa(defecto, cuerpo as SolicitudTrabajo);
    });
    await f.panel.abrir();
    assert.equal(activa(await f.panel.actualizarDatos()).aviso, 'actualizacion_incierta');
    assert.equal(activa(f.ultimo()).trabajos, null);
    assert(!JSON.stringify(f.estados).includes('nunca'));
  }
});

function respuestaDefectuosa(defecto: string, solicitud: SolicitudTrabajo) {
  const trabajos = reservado({
    ...solicitud,
    solicitudId: defecto === 'ajena' ? '11111111-1111-4111-8111-111111111111' : solicitud.solicitudId,
  });
  return Response.json(
    {
      ...lectura(trabajos),
      decision: 'nueva',
      ...(defecto === 'extra' ? { secreto: 'nunca' } : {}),
      ...(defecto === 'sesion' ? { sesion: { ...sesion, iniciadaEn: 1 } } : {}),
    },
    { status: defecto === 'http' ? EXITO : ACEPTADA },
  );
}

test('sustitución retira RAM y cierre durante envío ignora respuesta tardía', async () => {
  const sustituido = preparar(() => Response.json({ error: 'sesion_sustituida' }, { status: 409 }));
  await sustituido.panel.abrir();
  assert.equal((await sustituido.panel.consultarTrabajo()).estado, 'sustituida');
  const total = sustituido.pedidos.length;
  await sustituido.panel.actualizarDatos();
  assert.equal(sustituido.pedidos.length, total);
  let resolver!: (r: Response) => void;
  const f = preparar((ruta) =>
    ruta === 'trabajo'
      ? Response.json(lectura(vacio()))
      : new Promise<Response>((r) => {
          resolver = r;
        }),
  );
  await f.panel.abrir();
  const actualizacion = f.panel.actualizarDatos();
  await turno();
  const cierre = f.panel.cerrar();
  assert(!Object.hasOwn(f.ultimo(), 'trabajos'));
  resolver(Response.json({ secreto: 'nunca' }));
  await Promise.all([actualizacion, cierre]);
  assert.equal(f.ultimo().estado, 'cerrada');
});

test('timeout de envío y fallo offline de lectura nunca repiten mutación', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = preparar((ruta) =>
    ruta === 'trabajo' ? Response.json(lectura(vacio())) : new Promise<Response>(() => {}),
  );
  await f.panel.abrir();
  const actualizacion = f.panel.actualizarDatos();
  await turno();
  t.mock.timers.tick(PLAZO_PANEL_CLIENTE_MS);
  assert.equal(activa(await actualizacion).aviso, 'actualizacion_incierta');
  assert.equal(f.pedidos.filter((p) => p.ruta === 'actualizar').length, 1);
  t.mock.timers.reset();
  const offline = preparar(() => {
    throw new TypeError('sin conexión');
  });
  await offline.panel.abrir();
  assert.equal(activa(await offline.panel.actualizarDatos()).aviso, 'trabajos_no_disponibles');
  assert.equal(offline.pedidos.filter((p) => p.ruta === 'actualizar').length, 0);
});

test('lecturas rechazan revisión anterior y cambio del mismo documento sin revisión nueva', async () => {
  const solicitud: SolicitudTrabajo = {
    solicitudId: '11111111-1111-4111-8111-111111111111',
    accion: 'actualizar-datos',
    revisionEsperada: 0,
  };
  let trabajos = reservado(solicitud);
  const f = preparar(() => Response.json(lectura(trabajos)));
  await f.panel.abrir();
  assert.equal(activa(await f.panel.consultarTrabajo()).trabajos?.revision, 2);
  trabajos = vacio();
  assert.equal(activa(await f.panel.consultarTrabajo()).aviso, 'trabajos_no_disponibles');
  trabajos = reservado(solicitud);
  assert.equal(activa(await f.panel.consultarTrabajo()).trabajos?.revision, 2);
  assert(trabajos.ultimoTrabajo);
  trabajos = { ...trabajos, ultimoTrabajo: { ...trabajos.ultimoTrabajo, runId: '124' } };
  assert.equal(activa(await f.panel.consultarTrabajo()).trabajos, null);
  trabajos = { ...trabajos, revision: REVISION_TERMINADA };
  assert.equal(activa(await f.panel.consultarTrabajo()).trabajos, null);
});

test('fallo de lectura posterior no borra obligación de consultar tras mutación incierta', async () => {
  let fallarLectura = false;
  const f = preparar((ruta) => {
    if (ruta === 'trabajo' && !fallarLectura) {
      return Response.json(lectura(vacio()));
    }
    throw new TypeError('sin conexión');
  });
  await f.panel.abrir();
  assert.equal(activa(await f.panel.actualizarDatos()).aviso, 'actualizacion_incierta');
  fallarLectura = true;
  assert.equal(activa(await f.panel.consultarTrabajo()).aviso, 'trabajos_no_disponibles');
  const total = f.pedidos.length;
  await f.panel.actualizarDatos();
  assert.equal(f.pedidos.length, total);
  fallarLectura = false;
  assert.equal(activa(await f.panel.consultarTrabajo()).trabajos?.revision, 0);
  await f.panel.actualizarDatos();
  assert.equal(f.pedidos.filter((p) => p.ruta === 'actualizar').length, 2);
});

test('rechazo HTTP confirmado conserva controles y no afirma resultado incierto', async () => {
  const f = preparar((ruta) =>
    ruta === 'trabajo'
      ? Response.json(lectura(vacio()))
      : Response.json({ error: 'solicitud_invalida' }, { status: 400 }),
  );
  await f.panel.abrir();
  const estado = activa(await f.panel.actualizarDatos());
  assert.equal(estado.controles.revision, REVISION_CONTROLES);
  assert.equal(estado.aviso, 'solicitud_rechazada');
  assert.equal(estado.trabajos, null);
});

test('envoltorios de trabajo son cerrados y no ejecutan accesores ni reflejan campos privados', () => {
  assert.equal(leerLecturaTrabajo(lectura(vacio())).trabajos.revision, 0);
  assert.throws(() => leerLecturaTrabajo({ ...lectura(vacio()), confianza: 'privada' }));
  assert.throws(() => leerActualizacion({ ...lectura(vacio()), decision: 'cualquiera' }));
  let ejecutado = false;
  const entrada = {
    ...lectura(vacio()),
    get decision() {
      ejecutado = true;
      return 'nueva';
    },
  };
  assert.throws(() => leerActualizacion(entrada));
  assert.equal(ejecutado, false);
});

test('la respuesta de mutación no puede retroceder la sesión observada en su consulta previa', async () => {
  const posterior = { ...sesion, ultimaActividadEn: INICIO + 1, caducaPorInactividadEn: INICIO + INACTIVIDAD + 1 };
  const f = preparar((ruta, cuerpo) =>
    ruta === 'trabajo'
      ? Response.json({ ...lectura(vacio()), sesion: posterior })
      : Response.json({ ...lectura(reservado(cuerpo as SolicitudTrabajo)), decision: 'nueva' }, { status: ACEPTADA }),
  );
  await f.panel.abrir();
  assert.equal(activa(await f.panel.actualizarDatos()).aviso, 'actualizacion_incierta');
});
