/**
 * El panel de administración real sobre el servidor Node (montarAdministracion + crearServidor) y la web construida
 * que se publica (.web-local/web, de npm run web:preparar, con su SRI y sus mapas), con identidad Access y SQLite
 * sintéticos. No usa el Worker de ninguna construcción ni depende de su destino.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PoliticaControles } from '../../src/administracion/controles.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import { montarAdministracion } from '../../src/plataforma/administracion.ts';
import { crearServidor } from '../../src/plataforma/node/servidor.ts';
import { huellaDeLaWebConstruida, webConstruida } from '../ayudas/web-construida.ts';
import { crearAlmacen } from './almacen.ts';
import { crearIdentidad } from './identidad.ts';

const POLITICA: PoliticaControles = { version: 2, api: 'deshabilitada', mcp: false, a2a: false };
export const RUTA_SONDEO_CONTROLES = '/administracion/api/controles/leer';

async function detener(servidor: Server): Promise<void> {
  if (servidor.listening) {
    servidor.closeAllConnections();
    await new Promise<void>((ok, fallo) => servidor.close((error) => (error ? fallo(error) : ok())));
  }
}

/** El servidor Node con el panel montado sobre la autoridad sintética, para el origen en que escucha. */
async function servidorNode(
  origen: string,
  almacen: ReturnType<typeof crearAlmacen>,
  guardiaAdministrativa: Awaited<ReturnType<typeof crearIdentidad>>['guardia'],
  carpetaAutoridad: string,
): Promise<{ servidor: Server; conflictosDelSondeo: string[] }> {
  const administracion = await montarAdministracion({
    configuracion: { origen, permitirHttpLocal: true },
    guardiaAdministrativa,
    almacen: almacen.publico,
    sesion: almacen.sesion,
    secciones: almacen.sesion,
    instituciones: almacen.sesion,
    accesos: almacen.sesion,
    inicial: POLITICA,
  });
  const conflictosDelSondeo: string[] = [];
  const servidor = crearServidor({
    // La web construida desde estas fuentes; si falta o es de otras, webConstruida pide npm run web:preparar.
    web: webConstruida(),
    // La CSP admite los mapas de la web que se sirve.
    huellaMapaModulos: huellaDeLaWebConstruida(),
    archivoAutoridadSecciones: join(carpetaAutoridad, 'autoridad-secciones.sqlite'),
    puerto: 0,
    anfitrion: '127.0.0.1',
    administracion: {
      ...administracion,
      responder: async (peticion) => {
        const respuesta = await administracion.responder(peticion);
        if (new URL(peticion.url).pathname === RUTA_SONDEO_CONTROLES && respuesta.status === ESTADO_HTTP.conflicto) {
          // La primera pestaña puede perder el cuerpo en su depurador al cambiar de documento.
          conflictosDelSondeo.push(await respuesta.clone().text());
        }
        return respuesta;
      },
    },
    api: async () => new Response(null, { status: ESTADO_HTTP.noEncontrado }),
  });
  return { servidor, conflictosDelSondeo };
}

/** El servidor del panel en 127.0.0.1, con el JWT sintético que admite su guardia de Access. */
export async function crearFixtureDelPanel() {
  const almacen = crearAlmacen();
  const identidad = await crearIdentidad();
  const carpetaAutoridad = mkdtempSync(join(tmpdir(), 'faro-autoridad-panel-'));
  const errores: string[] = [];
  let atender: Server | null = null;
  const servidor = createServer((req, res) => {
    try {
      assert(atender, 'Servidor del panel no preparado');
      assert.equal(req.headers['user-agent'], IDENTIDAD_WEB['User-Agent']);
      atender.emit('request', req, res);
    } catch (error) {
      errores.push(String(error));
      res.writeHead(ESTADO_HTTP.errorInterno).end();
    }
  });
  const cerrar = async () => {
    try {
      await detener(servidor);
    } finally {
      almacen.cerrar();
      rmSync(carpetaAutoridad, { recursive: true, force: true });
    }
  };
  try {
    await new Promise<void>((ok, fallo) => {
      servidor.once('error', fallo);
      servidor.listen(0, '127.0.0.1', ok);
    });
    const direccion = servidor.address();
    assert(direccion && typeof direccion !== 'string');
    const origen = `http://127.0.0.1:${direccion.port}`;
    const panel = await servidorNode(origen, almacen, identidad.guardia, carpetaAutoridad);
    atender = panel.servidor;
    return { origen, jwt: identidad.jwt, errores, conflictosDelSondeo: panel.conflictosDelSondeo, cerrar };
  } catch (error) {
    await cerrar();
    throw error;
  }
}

export type FixtureDelPanel = Awaited<ReturnType<typeof crearFixtureDelPanel>>;
