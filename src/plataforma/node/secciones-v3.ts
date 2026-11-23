/** Proyección pública de la autoridad local, persistida en el mismo almacén que el panel. */
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { LIMITES_CONECTIVIDAD } from '../../administracion/instituciones.ts';
import { seccionDeLaRuta } from '../../administracion/secciones-web.js';
import { dentroDelPlazo } from '../../api/plazo.ts';
import { ESTADO_HTTP } from '../../comun/estados-http.ts';
import { abrirSqlAdministrativoNode } from '../acceso-publico/node.ts';
import { leerSeccionesConAutoridad } from '../acceso-publico/secciones-autoridad-sqlite.ts';
import { AlmacenPublicoSqlite } from '../acceso-publico/sqlite.ts';
import type { AdministracionMontada } from '../administracion.ts';
import { comprobarSeccionWeb, PLAZO_SECCIONES_MS, RUTA_SECCIONES, respuestaDeSecciones } from '../secciones-web.ts';
import { RUTAS } from './rutas.ts';

export const RUTA_SECCIONES_V3 = '/secciones-v3.json';
interface OpcionesSecciones {
  readonly web: string;
  readonly administracion?: AdministracionMontada;
  readonly archivoAutoridadSecciones?: string;
}

export function esRutaDeSecciones(ruta: string): boolean {
  return ruta === RUTA_SECCIONES || ruta === RUTA_SECCIONES_V3 || seccionDeLaRuta(ruta) !== undefined;
}

export function respuestaWebSegunSecciones(
  ruta: string,
  peticion: Pick<Request, 'method' | 'signal'>,
  opciones: OpcionesSecciones,
): Promise<Response | undefined> {
  if (ruta === RUTA_SECCIONES_V3) {
    return respuestaSeccionesNodeV3(peticion, opciones);
  }
  const administracion = opciones.administracion;
  const lector = async (senal: AbortSignal) => {
    senal.throwIfAborted();
    if (administracion) {
      return administracion.leerSecciones(senal);
    }
    const documento = leerEstadoLocal(opciones);
    return { version: 3 as const, revision: documento.revision, secciones: documento.secciones };
  };
  return ruta === RUTA_SECCIONES
    ? respuestaDeSecciones(peticion, lector)
    : comprobarSeccionWeb(ruta, peticion.signal, lector);
}

function leerEstadoLocal(opciones: OpcionesSecciones) {
  return leerSinPanel(
    opciones.archivoAutoridadSecciones ?? join(RUTAS.registro, 'acceso-publico', 'clientes.sqlite'),
    opciones.web,
  );
}

function leerSinPanel(archivo: string, web: string) {
  const desdeWeb = relative(resolve(web), resolve(archivo));
  if (desdeWeb === '' || (desdeWeb !== '..' && !desdeWeb.startsWith(`..${sep}`) && !isAbsolute(desdeWeb))) {
    throw new Error('La autoridad debe persistirse fuera de la web');
  }
  const almacen = abrirSqlAdministrativoNode(archivo);
  try {
    if (!almacen.sql.filas("SELECT name FROM sqlite_master WHERE type='table' AND name='publico_estado'").length) {
      new AlmacenPublicoSqlite(almacen.sql, { maxClientes: LIMITES_CONECTIVIDAD.instituciones });
    }
    return leerSeccionesConAutoridad(almacen.sql, true);
  } finally {
    almacen.close();
  }
}

export async function respuestaSeccionesNodeV3(
  peticion: Pick<Request, 'method' | 'signal'>,
  opciones: OpcionesSecciones,
): Promise<Response> {
  if (peticion.method !== 'GET' && peticion.method !== 'HEAD') {
    return new Response(null, {
      status: ESTADO_HTTP.metodoNoAdmitido,
      headers: { allow: 'GET, HEAD', 'cache-control': 'no-store' },
    });
  }
  try {
    const documento = await dentroDelPlazo(
      async (senal) => {
        senal.throwIfAborted();
        const lector = opciones.administracion?.leerSeccionesConAutoridad;
        if (opciones.administracion && !lector) {
          throw new Error('La administración no expone su autoridad de secciones');
        }
        const leido = lector ? await lector(senal) : leerEstadoLocal(opciones);
        senal.throwIfAborted();
        return leido;
      },
      PLAZO_SECCIONES_MS,
      peticion.signal,
    );
    return new Response(peticion.method === 'HEAD' ? null : JSON.stringify(documento), {
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  } catch {
    return new Response(null, { status: ESTADO_HTTP.noDisponible, headers: { 'cache-control': 'no-store' } });
  }
}
