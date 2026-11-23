/** El cliente de los avisos con el cliente real del panel y un servidor falso: rutas, cuerpos y lectores cerrados. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { crearClientePanel } from '../../web/administracion/cliente.js';

const LONGITUD_TOKEN = 43;
const CORREO = 'persona@example.org';
const INCORRECTO = 400;
const CONFLICTO = 409;
const NO_DISPONIBLE = 503;
const sesion = {
  estado: 'activa',
  iniciadaEn: 1000000,
  ultimaActividadEn: 1000000,
  caducaPorInactividadEn: 1900000,
  caducaAbsolutaEn: 29800000,
};
const controles = { version: 2, revision: 1, api: 'deshabilitada', mcp: false, a2a: false };
const resumen = { version: 1, revision: 2, cambiadoEn: 1000, verificacion: 'pendiente' };
/** El estado de los canales que acompaña la lectura: el correo con un intento fallido y las comprobaciones apagadas. */
const ESTADO_AVISOS = {
  comprobaciones: 'desactivadas',
  canales: [
    {
      canal: 'correo',
      estado: 'pendiente',
      ultimoIntento: { en: 1000, resultado: 'fallido', motivo: 'limite-alcanzado' },
    },
    { canal: 'url', estado: 'no-configurados', ultimoIntento: null },
  ],
};

function preparar(responder: (ruta: string, cuerpo: unknown) => Response) {
  const pedidos: { ruta: string; cuerpo: unknown }[] = [];
  const estados: unknown[] = [];
  const pedir: typeof fetch = async (url, opciones) => {
    const ruta = String(url);
    if (ruta.endsWith('sesion/abrir')) {
      return Response.json({ token: 'A'.repeat(LONGITUD_TOKEN), sesion });
    }
    if (ruta.endsWith('controles/leer')) {
      return Response.json({ estado: 'activa', sesion, controles });
    }
    const cuerpo = JSON.parse(String(opciones?.body));
    pedidos.push({ ruta, cuerpo });
    return responder(ruta, cuerpo);
  };
  const panel = crearClientePanel({ pedir, alCambiar: (estado) => estados.push(estado) });
  return { panel, pedidos, estados };
}

test('leer, guardar, quitar y probar van a sus rutas con la revisión y devuelven el resultado leído', async () => {
  const f = preparar((ruta) => {
    if (ruta.endsWith('avisos/leer')) {
      return Response.json({
        estado: 'activa',
        sesion,
        destino: { ...resumen, correo: CORREO },
        avisos: ESTADO_AVISOS,
      });
    }
    if (ruta.endsWith('avisos/probar')) {
      const prueba = { resultado: 'fallido', motivo: 'destinatario-no-permitido' };
      return Response.json({ estado: 'activa', sesion, prueba, destino: resumen });
    }
    return Response.json({ estado: 'cambiado', sesion, destino: resumen });
  });
  await f.panel.abrir();
  assert.deepEqual(await f.panel.leerAvisos(), {
    tipo: 'leido',
    destino: { revision: 2, cambiadoEn: 1000, verificacion: 'pendiente', correo: CORREO },
    avisos: ESTADO_AVISOS,
  });
  assert.equal((await f.panel.cambiarAvisos(2, CORREO))?.tipo, 'cambiado');
  assert.equal((await f.panel.quitarAvisos(2))?.tipo, 'cambiado');
  assert.deepEqual(await f.panel.probarAvisos(), {
    tipo: 'prueba',
    prueba: { resultado: 'fallido', motivo: 'destinatario-no-permitido' },
    destino: { revision: 2, cambiadoEn: 1000, verificacion: 'pendiente' },
  });
  assert.deepEqual(
    f.pedidos.map(({ ruta, cuerpo }) => [new URL(ruta, 'https://faro.example.org').pathname, cuerpo]),
    [
      ['/administracion/api/avisos/leer', {}],
      ['/administracion/api/avisos/cambiar', { revisionEsperada: 2, correo: CORREO }],
      ['/administracion/api/avisos/quitar', { revisionEsperada: 2 }],
      ['/administracion/api/avisos/probar', {}],
    ],
  );
  // La dirección solo viaja en el cuerpo y en la lectura: ni en la ruta ni en el estado del panel.
  assert.ok(f.pedidos.every(({ ruta }) => !ruta.includes('@')));
  assert.equal(JSON.stringify(f.estados).includes(CORREO), false);
  f.panel.destruir();
});

test('el conflicto, la dirección no válida y la instalación sin avisos se distinguen; lo demás se rechaza', async () => {
  const respuestas = [
    Response.json({ estado: 'conflicto', sesion, destino: resumen }, { status: CONFLICTO }),
    Response.json({ error: 'correo_invalido' }, { status: INCORRECTO }),
    Response.json({ error: 'no_disponible' }, { status: NO_DISPONIBLE }),
    Response.json({ estado: 'cambiado', sesion, destino: resumen }, { status: CONFLICTO }),
    Response.json({ estado: 'activa', sesion, destino: { ...resumen, correo: CORREO, otro: 1 } }),
  ];
  const f = preparar(() => respuestas.shift() ?? Response.json({}));
  await f.panel.abrir();
  assert.equal((await f.panel.cambiarAvisos(1, CORREO))?.tipo, 'conflicto');
  assert.equal((await f.panel.cambiarAvisos(1, 'no es una dirección'))?.tipo, 'correo-invalido');
  assert.equal((await f.panel.leerAvisos())?.tipo, 'no-disponible');
  assert.equal(await f.panel.quitarAvisos(1), null);
  assert.equal(await f.panel.leerAvisos(), null);
  f.panel.destruir();
});

test('la lectura pedida mientras termina otra operación espera a que acabe y llega al servidor', async () => {
  const rutas: string[] = [];
  const pedir: typeof fetch = async (url) => {
    const ruta = String(url).split('/api/')[1] ?? '';
    rutas.push(ruta);
    if (ruta === 'sesion/abrir') {
      return Response.json({ token: 'A'.repeat(LONGITUD_TOKEN), sesion });
    }
    if (ruta === 'controles/leer') {
      return Response.json({ estado: 'activa', sesion, controles });
    }
    return Response.json({ estado: 'activa', sesion, destino: { ...resumen, correo: CORREO }, avisos: ESTADO_AVISOS });
  };
  let lectura: Promise<unknown> | null = null;
  // Como la tarjeta real: pide leer en el aviso de cambio que publica la apertura, con la operación aún en curso.
  const panel: ReturnType<typeof crearClientePanel> = crearClientePanel({
    pedir,
    alCambiar: (estado) => {
      if (estado.estado === 'activa' && !estado.ocupado && lectura === null) {
        lectura = panel.leerAvisos();
      }
    },
  });
  await panel.abrir();
  assert.equal(((await lectura) as { tipo: string } | null)?.tipo, 'leido');
  assert.deepEqual(rutas, ['sesion/abrir', 'controles/leer', 'avisos/leer']);
});
