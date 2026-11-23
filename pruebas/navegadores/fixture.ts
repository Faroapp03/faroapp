/**
 * HTTP real sobre dist con el Worker privado de la construcción, su clave de pruebas y un SQLite sintético. Emula
 * bindings, no Cloudflare ni TLS.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname } from 'node:path';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import { crearAlmacen } from './almacen.ts';
import type { Artefacto } from './artefacto.ts';
import { CLAVE_SINTETICA } from './privado.ts';

const TIPOS: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
};
export interface PeticionObservada {
  ruta: string;
  metodo: string;
  ua: string | undefined;
  /** El destino que declara el navegador (`sec-fetch-dest`: script, worker, serviceworker…), si lo declara. */
  destino?: string | undefined;
  /** El estado HTTP con que se ha respondido, anotado al terminar la respuesta; sin él, no terminó o se abortó. */
  estado?: number;
}

async function recurso(artefacto: Artefacto, peticion: Request): Promise<Response> {
  if (!['GET', 'HEAD'].includes(peticion.method)) {
    return new Response(null, { status: ESTADO_HTTP.metodoNoAdmitido });
  }
  const ruta = `web${decodeURIComponent(new URL(peticion.url).pathname)}`;
  if (!artefacto.fichas.has(ruta) || !ruta.startsWith('web/')) {
    return new Response(null, { status: ESTADO_HTTP.noEncontrado });
  }
  const bytes = artefacto.leer(ruta);
  return new Response(peticion.method === 'HEAD' ? null : bytes, {
    headers: { 'content-type': TIPOS[extname(ruta)] ?? 'application/octet-stream', 'cache-control': 'no-cache' },
  });
}

async function detener(servidor: Server): Promise<void> {
  if (servidor.listening) {
    servidor.closeAllConnections();
    await new Promise<void>((ok, fallo) => servidor.close((error) => (error ? fallo(error) : ok())));
  }
}

function variables(origen: string) {
  return {
    FARO_ADMINISTRACION: 'si',
    FARO_ADMIN_ORIGEN: origen.replace('http:', 'https:'),
    FARO_ADMIN_ACCESS_EQUIPO: 'navegadores-sintetico',
    FARO_ADMIN_ACCESS_AUD: 'panel',
    FARO_SECRETO_FIRMA: 'firma exclusivamente sintetica sin servicio ni secretos reales',
  };
}

export function adaptarSolicitud(req: IncomingMessage, origen: string): Request {
  const url = new URL(`${origen}${req.url}`);
  url.protocol = 'https:'; // El binding exige HTTPS; solo el transporte de este ensayo es HTTP en loopback.
  const headers = new Headers();
  for (const [nombre, valor] of Object.entries(req.headers)) {
    if (valor !== undefined) {
      headers.set(nombre, Array.isArray(valor) ? valor.join(', ') : valor);
    }
  }
  headers.set('cf-connecting-ip', '127.0.0.1'); // Simula el dato aportado por Cloudflare en este fixture local.
  return new Request(url, { method: req.method ?? 'GET', headers });
}

async function responderWorker(opciones: {
  req: IncomingMessage;
  res: ServerResponse;
  origen: string;
  artefacto: Artefacto;
  entorno: Parameters<Artefacto['worker']['default']['fetch']>[1];
}): Promise<void> {
  const { req, res, origen, artefacto, entorno } = opciones;
  const respuesta = await artefacto.worker.default.fetch(adaptarSolicitud(req, origen), entorno);
  res.writeHead(respuesta.status, Object.fromEntries(respuesta.headers));
  res.end(req.method === 'HEAD' ? undefined : Buffer.from(await respuesta.arrayBuffer()));
}

/**
 * El enlace ASSETS del Worker oficial de las fuentes sobre la web del repositorio: lo usa descargas-js.mjs con una
 * construcción privada, que no lleva Worker oficial. El presupuesto nunca: sirve la portada y el acceso con el Worker
 * oficial del artefacto medido y su web (assetsDelArtefacto de presupuesto-servidor.mjs).
 */
export const ASSETS_DE_LA_WEB = {
  fetch: async (peticion: Request): Promise<Response> => {
    try {
      return new Response(readFileSync(new URL(`../../web${new URL(peticion.url).pathname}`, import.meta.url)));
    } catch {
      return new Response(null, { status: ESTADO_HTTP.noEncontrado });
    }
  },
};

/** Lo que un ensayo puede fijar del servidor: el modo guardado del recorrido, como lo leería su autoridad durable. */
export interface OpcionesFixture {
  modoRecorrido?: 'real' | 'demo';
}

export async function crearFixture(artefacto: Artefacto, ajustes: OpcionesFixture = {}) {
  const almacen = crearAlmacen();
  const errores: string[] = [];
  const peticiones: PeticionObservada[] = [];
  let atender: (req: IncomingMessage, res: ServerResponse) => Promise<void> = async () => {
    throw Error('Fixture no preparado');
  };
  const servidor = createServer((req, res) => {
    void atender(req, res).catch((error: unknown) => {
      errores.push(String(error));
      if (!res.headersSent) {
        res.writeHead(ESTADO_HTTP.errorInterno);
      }
      res.end();
    });
  });
  try {
    await new Promise<void>((ok, fallo) => {
      servidor.once('error', fallo);
      servidor.listen(0, '127.0.0.1', ok);
    });
    const direccion = servidor.address();
    assert(direccion && typeof direccion !== 'string');
    const origen = `http://127.0.0.1:${direccion.port}`;
    atender = montarTransporte({ artefacto, almacen, origen, peticiones }, ajustes);
    return {
      origen,
      errores,
      peticiones,
      apagar: () => detener(servidor),
      async cerrar() {
        try {
          await detener(servidor);
        } finally {
          almacen.cerrar();
        }
      },
    };
  } catch (error) {
    await detener(servidor);
    almacen.cerrar();
    throw error;
  }
}

/** La autoridad durable del Worker; con `modoRecorrido`, la lectura del modo del recorrido devuelve el fijado. */
function registroSocios(durable: () => { fetch(r: Request): Promise<Response> }, ajustes: OpcionesFixture) {
  return {
    idFromName: (nombre: string) => nombre,
    get: () => ({
      fetch: (r: Request) =>
        ajustes.modoRecorrido && new URL(r.url).pathname === '/recorrido/leer'
          ? Promise.resolve(Response.json({ recorrido: { version: 1, revision: 1, modo: ajustes.modoRecorrido } }))
          : durable().fetch(r),
    }),
  };
}

/**
 * El objeto durable de la construcción que se sirve, siempre sobre el mismo almacén. Si la construcción cambia
 * (actualizacion-sw.mjs, conmutable), la instancia siguiente es de la clase nueva, como tras un despliegue real, que
 * reinicia el objeto con el código nuevo y conserva su almacenamiento.
 */
export function durableDeLaConstruccion<E, V, D>(clase: () => new (estado: E, entorno: V) => D, estado: E, entorno: V) {
  let vigente: { clase: unknown; durable: D } | undefined;
  return (): D => {
    const actual = clase();
    if (vigente?.clase !== actual) {
      vigente = { clase: actual, durable: new actual(estado, entorno) };
    }
    return vigente.durable;
  };
}

function montarTransporte(
  opciones: {
    artefacto: Artefacto;
    almacen: ReturnType<typeof crearAlmacen>;
    origen: string;
    peticiones: PeticionObservada[];
  },
  ajustes: OpcionesFixture,
) {
  const { artefacto, almacen, origen, peticiones } = opciones;
  const durable = durableDeLaConstruccion(
    () => artefacto.worker.AccesoPublicoDurable,
    almacen.estado,
    variables(origen),
  );
  const entorno = {
    ...variables(origen),
    FARO_PRUEBAS_CLAVE: CLAVE_SINTETICA,
    FARO_PRUEBAS_LIMITE: 'limite-privado-sintetico-distinto-de-32-bytes',
    REGISTRO_SOCIOS: registroSocios(durable, ajustes),
    ASSETS: { fetch: (r: Request) => recurso(artefacto, r) },
  };
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    assert.equal(req.headers.host, new URL(origen).host);
    assert.equal(req.headers['user-agent'], IDENTIDAD_WEB['User-Agent']);
    const ruta = new URL(`${origen}${req.url}`).pathname;
    const peticion: PeticionObservada = {
      ruta,
      metodo: req.method ?? 'GET',
      ua: req.headers['user-agent'],
      destino: req.headers['sec-fetch-dest'] as string | undefined,
    };
    peticiones.push(peticion);
    res.once('finish', () => {
      peticion.estado = res.statusCode;
    });
    await responderWorker({ req, res, origen, artefacto, entorno });
  };
}

export type Fixture = Awaited<ReturnType<typeof crearFixture>>;
