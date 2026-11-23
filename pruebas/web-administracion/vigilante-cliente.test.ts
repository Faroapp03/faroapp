import assert from 'node:assert/strict';
import test from 'node:test';
import { crearClientePanel } from '../../web/administracion/cliente.js';

const LONGITUD_TOKEN = 43;
const sesion = {
  estado: 'activa',
  iniciadaEn: 1000000,
  ultimaActividadEn: 1000000,
  caducaPorInactividadEn: 1900000,
  caducaAbsolutaEn: 29800000,
};
const controles = { version: 2, revision: 1, api: 'deshabilitada', mcp: false, a2a: false };
const vigilante = {
  areas: [],
  version: 1,
  origenDatos: 'recibo',
  evaluadoEn: 1000000,
  pulsoContinuo: 'no-instrumentado',
  entregaActiva: 'sin-observacion-actual',
  revision: 1,
  incidencias: [],
  fechaDatos: [],
  ultimoTrabajo: null,
  eventosProgramados: [],
};

test('comprobar una vez no actualiza datos y devuelve solo evidencia validada', async () => {
  const rutas: string[] = [];
  let terminar: (() => void) | undefined;
  const espera = new Promise<void>((resolver) => {
    terminar = resolver;
  });
  const pedir: typeof fetch = async (url) => {
    const ruta = String(url);
    rutas.push(ruta);
    if (ruta.endsWith('sesion/abrir')) {
      return Response.json({ token: 'A'.repeat(LONGITUD_TOKEN), sesion });
    }
    if (ruta.endsWith('controles/leer')) {
      return Response.json({ estado: 'activa', sesion, controles });
    }
    await espera;
    return Response.json({ estado: 'activa', sesion, vigilante });
  };
  const cliente = crearClientePanel({ pedir, alCambiar: () => {} });
  await cliente.abrir();
  const primera = cliente.comprobarVigilante();
  const segunda = cliente.comprobarVigilante();
  terminar?.();
  const [resultado, repetida] = await Promise.all([primera, segunda]);
  assert.deepEqual(resultado, vigilante);
  assert.equal(repetida, null);
  assert.equal(rutas.filter((ruta) => ruta.endsWith('datos/comprobar-estado')).length, 1);
  assert.equal(
    rutas.some((ruta) => ruta.endsWith('datos/actualizar')),
    false,
  );
  cliente.destruir();
});

function preparar(responder: (ruta: string, opciones?: RequestInit) => Promise<Response>) {
  const rutas: string[] = [];
  const pedir: typeof fetch = async (url, opciones) => {
    const ruta = String(url);
    rutas.push(ruta);
    if (ruta.endsWith('sesion/abrir')) {
      return Response.json({ token: 'A'.repeat(LONGITUD_TOKEN), sesion });
    }
    if (ruta.endsWith('controles/leer')) {
      return Response.json({ estado: 'activa', sesion, controles });
    }
    return responder(ruta, opciones);
  };
  let ultimo = '';
  const panel = crearClientePanel({
    pedir,
    alCambiar: (estado) => {
      ultimo = estado.estado;
    },
  });
  return { panel, rutas, estado: () => ultimo };
}

test('historial pagina con cursor y revisión, y rechaza respuestas incompatibles', async () => {
  const cuerpos: unknown[] = [];
  const fila = {
    id: 42,
    clave: 'fuente:uno',
    estado: 'incidencia',
    motivo: 'comprobacion_vencida',
    observadoEn: 1,
    evaluadoEn: 2,
    origen: 'recibo',
  };
  const f = preparar(async (_ruta, opciones) => {
    cuerpos.push(JSON.parse(String(opciones?.body)));
    return Response.json({
      estado: 'activa',
      sesion,
      historial: { version: 1, revision: 7, decisiones: [fila], siguiente: 42 },
    });
  });
  await f.panel.abrir();
  assert.deepEqual(await f.panel.historialVigilante(), { version: 1, revision: 7, decisiones: [fila], siguiente: 42 });
  assert.equal(await f.panel.historialVigilante({ despuesDe: 42, revisionEsperada: 8 }), null);
  assert.deepEqual(cuerpos, [{}, { despuesDe: 42, revisionEsperada: 8, limite: 50 }]);
  assert.equal(f.estado(), 'activa');
  f.panel.destruir();
});

test('respuesta perdida no reenvía, y una sesión sustituida retira la sesión', async () => {
  let llamada = 0;
  const f = preparar(async () => {
    llamada += 1;
    if (llamada === 1) {
      throw new TypeError('respuesta perdida');
    }
    return Response.json({ error: 'sesion_sustituida' }, { status: 409 });
  });
  await f.panel.abrir();
  assert.equal(await f.panel.comprobarVigilante(), null);
  assert.equal(llamada, 1);
  assert.equal(f.estado(), 'activa');
  assert.equal(await f.panel.historialVigilante(), null);
  assert.equal(f.estado(), 'sustituida');
  assert.equal(await f.panel.comprobarVigilante(), null);
  assert.equal(llamada, 2);
  f.panel.destruir();
});

test('respuesta de vigilante incompleta no se acepta como comprobación', async () => {
  const f = preparar(async () => Response.json({ estado: 'activa', sesion, vigilante: { ...vigilante, areas: null } }));
  await f.panel.abrir();
  assert.equal(await f.panel.comprobarVigilante(), null);
  assert.equal(f.estado(), 'activa');
  f.panel.destruir();
});

test('configuración inválida conserva el panel y comunica qué revisar sin divulgar datos', async () => {
  const avisos: (string | null)[] = [];
  const pedir: typeof fetch = async (url) => {
    const ruta = String(url);
    if (ruta.endsWith('sesion/abrir')) {
      return Response.json({ token: 'A'.repeat(LONGITUD_TOKEN), sesion });
    }
    if (ruta.endsWith('controles/leer')) {
      return Response.json({ estado: 'activa', sesion, controles });
    }
    return Response.json({ error: 'vigilante_configuracion_invalida' }, { status: 503 });
  };
  const panel = crearClientePanel({ pedir, alCambiar: (estado) => avisos.push(estado.aviso) });
  await panel.abrir();
  assert.equal(await panel.comprobarVigilante(), null);
  assert.equal(avisos.at(-1), 'vigilante_configuracion_invalida');
  panel.destruir();
});

test('indisponibilidad y conflicto del vigilante son rechazos confirmados sin reenvío', async () => {
  const NO_DISPONIBLE = 503;
  const CONFLICTO = 409;
  for (const [codigo, estadoHttp] of [
    ['vigilante_no_disponible', NO_DISPONIBLE],
    ['vigilante_conflicto', CONFLICTO],
  ] as const) {
    const avisos: (string | null)[] = [];
    let intentos = 0;
    const pedir: typeof fetch = async (url) => {
      const ruta = String(url);
      if (ruta.endsWith('sesion/abrir')) {
        return Response.json({ token: 'A'.repeat(LONGITUD_TOKEN), sesion });
      }
      if (ruta.endsWith('controles/leer')) {
        return Response.json({ estado: 'activa', sesion, controles });
      }
      intentos += 1;
      return Response.json({ error: codigo }, { status: estadoHttp });
    };
    const panel = crearClientePanel({ pedir, alCambiar: (estado) => avisos.push(estado.aviso) });
    await panel.abrir();
    assert.equal(await panel.comprobarVigilante(), null);
    assert.equal(avisos.at(-1), codigo);
    assert.equal(intentos, 1);
    panel.destruir();
  }
});
