/** Límites distintos en puertas independientes: liberar el lector conserva el error de cancelación. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { responderAccesoPortal } from '../../src/plataforma/cloudflare/acceso-portal.ts';
import { responderAccesoRecorrido } from '../../src/plataforma/cloudflare/acceso-recorrido.ts';
import { EXTENSIONES } from '../../src/plataforma/extensiones.ts';
import type { VarianteRecorrido } from '../../src/plataforma/variantes-recorrido.ts';

/** La primera extensión del registro hace de variante inactiva; sin extensiones no hay otra variante que proteger. */
const [EXTENSION] = EXTENSIONES;
const SIN_EXTENSIONES = EXTENSION === undefined && 'Sin extensiones instaladas no hay otra variante que proteger.';
const VARIANTE: VarianteRecorrido = EXTENSION?.id ?? 'real';
const ENTRADA = `/${EXTENSION?.entrada ?? 'recorrido.html'}`;

const ORIGEN = 'https://ejemplo.invalid';
const FIRMA = 'firma-sintetica-independiente-de-32-caracteres';
const CLAVE = 'clave-sintetica-de-acceso';
const FIN_FRAGMENTO = 3;
const BYTE_INVALIDO = 0xff;
const REDIRECCION = 303;
const MAX_PORTAL = 2048;
const MAX_RECORRIDO = 1024;
function request(ruta: string, cuerpo: ReadableStream<Uint8Array>): Request {
  return new Request(`${ORIGEN}${ruta}`, {
    method: 'POST',
    body: cuerpo,
    duplex: 'half',
    headers: {
      origin: ORIGEN,
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/x-www-form-urlencoded',
      'cf-connecting-ip': '192.0.2.1',
    },
  } as RequestInit & { duplex: 'half' });
}
function exceso(maximo: number) {
  let canceladas = 0;
  const flujo = new ReadableStream<Uint8Array>({
    start(control) {
      control.enqueue(new Uint8Array(maximo + 1));
    },
    cancel() {
      canceladas++;
      return Promise.reject(new Error('cancelación sintética'));
    },
  });
  return { flujo, canceladas: () => canceladas };
}

test('portal conserva el error y libera el lector si falla cancelar', async () => {
  const entrada = exceso(MAX_PORTAL);
  const peticion = request('/acceso-web/entrar', entrada.flujo);
  await assert.rejects(
    responderAccesoPortal(peticion, {
      clave: CLAVE,
      firma: FIRMA,
      claveLimite: 'limite-sintetico-independiente-de-32-caracteres',
      registrarSesion: async () => {},
      sesionActiva: async () => false,
      revocarSesion: async () => {},
      sesionesDisponibles: async () => true,
      consumirIntento: async () => true,
      paginaAcceso: () => new Response(''),
      delegar: async () => new Response(''),
    }),
    /cancelación sintética/,
  );
  assert.equal(entrada.canceladas(), 1);
  assert.equal(peticion.body?.locked, false);
});

test('recorrido conserva el error y libera el lector si falla cancelar', { skip: SIN_EXTENSIONES }, async () => {
  const entrada = exceso(MAX_RECORRIDO);
  const peticion = request(ENTRADA, entrada.flujo);
  await assert.rejects(
    responderAccesoRecorrido(peticion, {
      variante: VARIANTE,
      clave: CLAVE,
      firma: FIRMA,
      leerModo: async () => ({ version: 1, revision: 0, modo: 'real' }),
      consumirIntento: async () => true,
      delegar: async () => new Response(''),
    }),
    /cancelación sintética/,
  );
  assert.equal(entrada.canceladas(), 1);
  assert.equal(peticion.body?.locked, false);
});

function formularioBytes(maximo: number, portal: boolean, exceso = 0): ReadableStream<Uint8Array> {
  const texto = new URLSearchParams(portal ? { usuario: 'Faro', clave: CLAVE } : { clave: CLAVE }).toString();
  const bytes = new TextEncoder().encode(texto + '&'.repeat(maximo + exceso - texto.length));
  return new ReadableStream({
    start(control) {
      control.enqueue(bytes.subarray(0, FIN_FRAGMENTO));
      control.enqueue(bytes.subarray(FIN_FRAGMENTO));
      control.close();
    },
  });
}
const PORTAL = {
  clave: CLAVE,
  firma: FIRMA,
  claveLimite: 'limite-sintetico-independiente-de-32-caracteres',
  registrarSesion: async () => {},
  sesionActiva: async () => false,
  revocarSesion: async () => {},
  sesionesDisponibles: async () => true,
  consumirIntento: async () => true,
  paginaAcceso: () => new Response(''),
  delegar: async () => new Response(''),
};
const RECORRIDO = {
  variante: VARIANTE,
  clave: CLAVE,
  firma: FIRMA,
  leerModo: async () => ({ version: 1 as const, revision: 0, modo: 'real' as const }),
  consumirIntento: async () => true,
  delegar: async () => new Response(''),
};

test('portal admite su frontera de 2048 bytes y rechaza el byte siguiente', async () => {
  assert.equal(
    (await responderAccesoPortal(request('/acceso-web/entrar', formularioBytes(MAX_PORTAL, true)), PORTAL)).status,
    ESTADO_HTTP.correcto,
  );
  assert.equal(
    (await responderAccesoPortal(request('/acceso-web/entrar', formularioBytes(MAX_PORTAL, true, 1)), PORTAL)).status,
    ESTADO_HTTP.prohibido,
  );
});

test('recorrido admite su frontera de 1024 bytes y rechaza el byte siguiente', { skip: SIN_EXTENSIONES }, async () => {
  assert.equal(
    (await responderAccesoRecorrido(request(ENTRADA, formularioBytes(MAX_RECORRIDO, false)), RECORRIDO)).status,
    REDIRECCION,
  );
  assert.equal(
    (await responderAccesoRecorrido(request(ENTRADA, formularioBytes(MAX_RECORRIDO, false, 1)), RECORRIDO)).status,
    ESTADO_HTTP.prohibido,
  );
});

test('ambas puertas rechazan UTF-8 inválido sin emitir sesión', async () => {
  const invalido = () =>
    new ReadableStream<Uint8Array>({
      start(control) {
        control.enqueue(new Uint8Array([BYTE_INVALIDO]));
        control.close();
      },
    });
  const portal = await responderAccesoPortal(request('/acceso-web/entrar', invalido()), PORTAL);
  assert.equal(portal.status, ESTADO_HTTP.prohibido);
  assert.equal(portal.headers.has('set-cookie'), false);
  // La puerta del recorrido solo existe para la variante de una extensión instalada.
  if (EXTENSION) {
    const recorrido = await responderAccesoRecorrido(request(ENTRADA, invalido()), RECORRIDO);
    assert.equal(recorrido.status, ESTADO_HTTP.prohibido);
    assert.equal(recorrido.headers.has('set-cookie'), false);
  }
});

test('error de lectura de un flujo real conserva la causa y no invoca cancelación del origen', async () => {
  const puertas: [string, (peticion: Request) => Promise<Response>][] = [
    ['/acceso-web/entrar', (peticion) => responderAccesoPortal(peticion, PORTAL)],
  ];
  if (EXTENSION) {
    puertas.push([ENTRADA, (peticion) => responderAccesoRecorrido(peticion, RECORRIDO)]);
  }
  for (const [ruta, responder] of puertas) {
    const lectura = new Error('lectura sintética');
    let cancelaciones = 0;
    const flujo = new ReadableStream<Uint8Array>({
      pull() {
        throw lectura;
      },
      cancel() {
        cancelaciones++;
        throw new Error('cancelación diferente');
      },
    });
    const peticion = request(ruta, flujo);
    await assert.rejects(responder(peticion), (error) => error === lectura);
    assert.equal(cancelaciones, 0);
    assert.equal(peticion.body?.locked, false);
  }
});
