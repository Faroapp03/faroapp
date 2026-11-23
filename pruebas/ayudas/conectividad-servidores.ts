/** Entradas productivas Node y Worker, con claves Access sintéticas y almacenamiento privado temporal. Sin red externa. */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { documentoOpenApi } from '../../herramientas/api/openapi.ts';
import { crearApi } from '../../src/api/api.ts';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import { AccesoPublicoDurable, type EstadoAccesoPublicoDurable } from '../../src/plataforma/acceso-publico/durable.ts';
import type { FilaSql, ValorSql } from '../../src/plataforma/acceso-publico/sqlite.ts';
import worker from '../../src/plataforma/cloudflare/worker.ts';
import { montarAdministracionNode } from '../../src/plataforma/node/administracion.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import { crearServidor } from '../../src/plataforma/node/servidor.ts';
import { alarmaDurableDePrueba } from './alarma-durable.ts';
import { identidadAccessConectividad, ORIGEN_CONECTIVIDAD } from './conectividad.ts';

const DESCRIPCIONES = {
  '/openapi.json': JSON.stringify(documentoOpenApi()),
  '/llms.txt': readFileSync(new URL('../../web/llms.txt', import.meta.url), 'utf8'),
};
const DATOS = cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url)));
const FIRMA_SINTETICA = 'firma-sintetica-estable-para-conectividad-institucional';
type Tabla =
  | 'instituciones'
  | 'instituciones_invitaciones'
  | 'instituciones_claves'
  | 'administracion_sesion'
  | 'conectividad_uso';
export interface ServidorConectividadPrueba {
  readonly origen: string;
  pedir(ruta: string, inicio?: RequestInit): Promise<Response>;
  panel(operacion: string, cuerpo?: object, token?: string): Promise<Response>;
  filas(tabla: Tabla): FilaSql[];
  perderControles(): void;
  perderRegistro(): void;
  cerrar(): Promise<void>;
}
function variables(encendida: boolean, administrada = true) {
  return {
    FARO_ADMINISTRACION: administrada ? 'si' : 'no',
    FARO_ADMIN_ORIGEN: ORIGEN_CONECTIVIDAD,
    FARO_ADMIN_ACCESS_EQUIPO: 'equipo-sintetico',
    FARO_ADMIN_ACCESS_AUD: 'panel-pruebas',
    FARO_SECRETO_FIRMA: FIRMA_SINTETICA,
    FARO_API_SOCIOS: encendida ? 'si' : 'no',
    FARO_MCP: 'no',
    FARO_A2A: 'no',
  };
}
function panelCon(pedir: ServidorConectividadPrueba['pedir'], jwt: string): ServidorConectividadPrueba['panel'] {
  return (operacion, cuerpo = {}, token = '') =>
    pedir(`/administracion/api/${operacion}`, {
      method: 'POST',
      headers: {
        origin: ORIGEN_CONECTIVIDAD,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
        'x-faro-panel': '1',
        'cf-access-jwt-assertion': jwt,
        ...(token ? { 'x-faro-sesion': token } : {}),
      },
      body: JSON.stringify(cuerpo),
    });
}
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: el montaje y su cierre comparten recursos del mismo servidor temporal.
async function node(encendida: boolean, administrada: boolean): Promise<ServidorConectividadPrueba> {
  const id = await identidadAccessConectividad();
  const carpeta = mkdtempSync(join(realpathSync(tmpdir()), 'conectividad-e2e-node-')),
    archivo = join(carpeta, 'registro.sqlite'),
    web = join(carpeta, 'web');
  mkdirSync(web);
  for (const [ruta, contenido] of Object.entries(DESCRIPCIONES)) {
    writeFileSync(join(web, ruta.slice(1)), contenido);
  }
  const montada = administrada
    ? await montarAdministracionNode({
        perfil: { variables: variables(encendida) },
        datos: DATOS,
        origenesPermitidos: [],
        archivo,
        pedir: id.pedir,
      })
    : {
        api: await crearApi({ datos: DATOS, origenesPermitidos: [], seguridad: { secretoFirma: FIRMA_SINTETICA } }),
        cerrar: () => undefined,
        administracion: undefined,
      };
  const servidor = crearServidor({
    web,
    archivoAutoridadSecciones: join(carpeta, 'autoridad-secciones.sqlite'),
    api: montada.api,
    ...(montada.administracion ? { administracion: montada.administracion } : {}),
    puerto: 0,
    anfitrion: '127.0.0.1',
  });
  servidor.once('close', montada.cerrar);
  await new Promise<void>((resolver, rechazar) => {
    servidor.once('error', rechazar);
    servidor.listen(0, '127.0.0.1', () => {
      servidor.off('error', rechazar);
      resolver();
    });
  });
  const origen = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  const pedir: ServidorConectividadPrueba['pedir'] = (ruta, inicio = {}) =>
    fetch(`${origen}${ruta}`, {
      ...inicio,
      redirect: 'error',
      headers: { 'user-agent': IDENTIDAD_WEB['User-Agent'], ...Object.fromEntries(new Headers(inicio.headers)) },
    });
  return {
    origen,
    pedir,
    panel: panelCon(pedir, id.jwt),
    filas: (tabla) => {
      const db = new DatabaseSync(archivo, { readOnly: true });
      try {
        return db.prepare(`SELECT * FROM ${tabla}`).all();
      } finally {
        db.close();
      }
    },
    perderRegistro: () => {
      const db = new DatabaseSync(archivo);
      try {
        db.exec('DELETE FROM conectividad_uso_estado');
      } finally {
        db.close();
      }
    },
    perderControles: () => {
      const db = new DatabaseSync(archivo);
      try {
        db.exec('DELETE FROM administracion_controles');
      } finally {
        db.close();
      }
    },
    cerrar: async () => {
      servidor.closeAllConnections();
      await new Promise<void>((resolver, rechazar) =>
        servidor.close((error) => (error ? rechazar(error) : resolver())),
      );
      rmSync(carpeta, { recursive: true });
    },
  };
}
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: el Worker y su Durable Object comparten una única SQLite temporal.
async function cloudflare(
  t: TestContext,
  encendida: boolean,
  administrada: boolean,
): Promise<ServidorConectividadPrueba> {
  const id = await identidadAccessConectividad();
  t.mock.method(globalThis, 'fetch', id.pedir);
  const db = new DatabaseSync(':memory:');
  const estado: EstadoAccesoPublicoDurable = {
    storage: {
      ...alarmaDurableDePrueba(),
      sql: { exec: (sql: string, ...valores: ValorSql[]) => ({ toArray: () => db.prepare(sql).all(...valores) }) },
      transactionSync: <T>(accion: () => T): T => {
        db.exec('BEGIN IMMEDIATE');
        try {
          const r = accion();
          db.exec('COMMIT');
          return r;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      },
    },
  };
  const entorno = variables(encendida, administrada);
  let durable: AccesoPublicoDurable | undefined;
  const env = {
    ...entorno,
    ASSETS: {
      fetch: async (peticion: Request) => {
        const ruta = new URL(peticion.url).pathname;
        if (ruta !== '/openapi.json' && ruta !== '/llms.txt') {
          return new Response(null, { status: 404 });
        }
        if (peticion.method !== 'GET' || [...peticion.headers].length !== 0 || new URL(peticion.url).search) {
          throw new TypeError('La lectura estática interna debe ser un GET limpio');
        }
        return new Response(DESCRIPCIONES[ruta], { headers: { etag: 'fixture', 'content-encoding': 'gzip' } });
      },
    },
    REGISTRO_SOCIOS: {
      idFromName: (nombre: string) => nombre,
      get: () => ({
        fetch: (peticion: Request) => {
          durable ??= new AccesoPublicoDurable(estado, entorno);
          return durable.fetch(peticion);
        },
      }),
    },
  };
  const pedir: ServidorConectividadPrueba['pedir'] = (ruta, inicio = {}) =>
    worker.fetch(
      new Request(`${ORIGEN_CONECTIVIDAD}${ruta}`, {
        ...inicio,
        headers: {
          'user-agent': IDENTIDAD_WEB['User-Agent'],
          'cf-connecting-ip': '192.0.2.10',
          ...Object.fromEntries(new Headers(inicio.headers)),
        },
      }),
      env,
    );
  return {
    origen: ORIGEN_CONECTIVIDAD,
    pedir,
    panel: panelCon(pedir, id.jwt),
    filas: (tabla) => db.prepare(`SELECT * FROM ${tabla}`).all(),
    perderControles: () => db.exec('DELETE FROM administracion_controles'),
    perderRegistro: () => db.exec('DELETE FROM conectividad_uso_estado'),
    cerrar: async () => {
      db.close();
    },
  };
}
export function servidorConectividadPrueba(
  t: TestContext,
  modo: 'Node' | 'Worker',
  encendida: boolean,
  administrada = true,
): Promise<ServidorConectividadPrueba> {
  return modo === 'Node' ? node(encendida, administrada) : cloudflare(t, encendida, administrada);
}
