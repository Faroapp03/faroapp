/** Identidad Access y almacenes sintéticos para comprobar los adaptadores reales sin red ni cuentas remotas. */

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AlmacenAccesos } from '../../src/administracion/accesos.ts';
import type { AlmacenAdministradores } from '../../src/administracion/administradores.ts';
import type { AlmacenControles } from '../../src/administracion/controles.ts';
import type { AlmacenInstituciones } from '../../src/administracion/instituciones.ts';
import type { AlmacenSeccionesPanel } from '../../src/administracion/secciones-almacen.ts';
import type { AlmacenPreparacionPanel } from '../../src/administracion/sesion.ts';
import type { AlmacenSesionUnica } from '../../src/administracion/sesion-unica.ts';
import type { AlmacenTrabajosActualizacion } from '../../src/administracion/trabajos.ts';
import { guardiaAdministrativaDelEntorno } from '../../src/plataforma/acceso-administrativo.ts';
import { AccesoPublicoDurable, type EstadoAccesoPublicoDurable } from '../../src/plataforma/acceso-publico/durable.ts';
import { abrirSqlAdministrativoNode, crearAlmacenPublicoNode } from '../../src/plataforma/acceso-publico/node.ts';
import { SesionUnicaDurable } from '../../src/plataforma/acceso-publico/sesion-unica-cliente-durable.ts';
import type { FilaSql, ValorSql } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { montarAdministracion } from '../../src/plataforma/administracion.ts';
import { alarmaDurableDePrueba } from './alarma-durable.ts';

export const AHORA_CONECTIVIDAD = Date.now();
export const ORIGEN_CONECTIVIDAD = 'https://servicio.invalid';
const EMISOR = 'https://equipo-sintetico.cloudflareaccess.com';
const RSA_BITS = 2048,
  HORA_S = 3600,
  MS_SEGUNDO = 1000;
const ALGORITMO = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
const politica = { version: 2, api: 'habilitada', mcp: false, a2a: false } as const;
async function identidad() {
  const claves = await crypto.subtle.generateKey(
    { ...ALGORITMO, modulusLength: RSA_BITS, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ['sign', 'verify'],
  );
  const publica = await crypto.subtle.exportKey('jwk', claves.publicKey);
  const claims = {
    iss: EMISOR,
    aud: ['panel-pruebas'],
    type: 'app',
    sub: 'principal-sintetico',
    email: 'Principal-Sintetico@faro.invalid',
    iat: Math.floor(AHORA_CONECTIVIDAD / MS_SEGUNDO),
    exp: Math.floor(AHORA_CONECTIVIDAD / MS_SEGUNDO) + HORA_S,
  };
  const partes = `${Buffer.from('{"alg":"RS256","kid":"sintetica"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
  const firma = await crypto.subtle.sign(ALGORITMO, claves.privateKey, new TextEncoder().encode(partes));
  const jwt = `${partes}.${Buffer.from(firma).toString('base64url')}`;
  const pedir: typeof fetch = async (entrada) => {
    if (String(entrada) !== `${EMISOR}/cdn-cgi/access/certs`) {
      throw new Error('Destino de red ajeno al ensayo');
    }
    return Response.json({ keys: [{ ...publica, kid: 'sintetica' }] });
  };
  const guardia = guardiaAdministrativaDelEntorno(
    { FARO_ADMIN_ACCESS_EQUIPO: 'equipo-sintetico', FARO_ADMIN_ACCESS_AUD: 'panel-pruebas' },
    pedir,
    () => AHORA_CONECTIVIDAD,
  );
  return { jwt, guardia, pedir };
}
const access = identidad();
export function identidadAccessConectividad() {
  return access;
}
interface BackendInstituciones {
  readonly trabajos: AlmacenTrabajosActualizacion;
  readonly controles: AlmacenControles;
  readonly sesion: AlmacenPreparacionPanel & AlmacenSesionUnica & AlmacenAdministradores;
  readonly secciones: AlmacenSeccionesPanel;
  readonly instituciones: AlmacenInstituciones;
  readonly accesos: AlmacenAccesos;
  filas(sentencia: string, ...valores: ValorSql[]): FilaSql[];
  ejecutar(sentencia: string): void;
  cerrar(): void;
}
function node(): BackendInstituciones {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'conectividad-http-')),
    archivo = join(dir, 'registro.sqlite');
  const almacen = crearAlmacenPublicoNode({
    archivo,
    maxClientes: 100,

    ahora: () => AHORA_CONECTIVIDAD,
  });
  const observador = abrirSqlAdministrativoNode(archivo);
  return {
    controles: almacen,
    sesion: almacen.sesion,
    secciones: almacen.secciones,
    instituciones: almacen.instituciones,
    accesos: almacen.accesos,
    trabajos: almacen.trabajos,
    filas: observador.sql.filas,
    ejecutar: (s) => observador.sql.ejecutar(s),
    cerrar: () => {
      observador.close();
      almacen.close();
      rmSync(dir, { recursive: true });
    },
  };
}
function durable(): BackendInstituciones {
  const db = new DatabaseSync(':memory:');
  const estado: EstadoAccesoPublicoDurable = {
    storage: {
      ...alarmaDurableDePrueba(),
      sql: { exec: (s: string, ...v: ValorSql[]) => ({ toArray: () => db.prepare(s).all(...v) }) },
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
  const servidor = new AccesoPublicoDurable(estado, {});
  const almacen = new SesionUnicaDurable({ idFromName: (n) => n, get: () => servidor });
  return {
    controles: almacen,
    sesion: almacen,
    secciones: almacen,
    instituciones: almacen,
    accesos: almacen,
    trabajos: almacen,
    filas: (s, ...v) => db.prepare(s).all(...v),
    ejecutar: (s) => db.exec(s),
    cerrar: () => db.close(),
  };
}
export async function panelInstitucional(modo: 'Node' | 'binding') {
  const backend = modo === 'Node' ? node() : durable(),
    id = await access;
  try {
    const panel = await montarAdministracion({
      configuracion: { origen: ORIGEN_CONECTIVIDAD, permitirHttpLocal: false },
      guardiaAdministrativa: id.guardia,
      almacen: backend.controles,
      sesion: backend.sesion,
      secciones: backend.secciones,
      instituciones: backend.instituciones,
      accesos: backend.accesos,
      trabajos: backend.trabajos,
      inicial: politica,
    });
    const peticion = (operacion: string, cuerpo: unknown = {}, token?: string) =>
      new Request(`${ORIGEN_CONECTIVIDAD}/administracion/api/${operacion}`, {
        method: 'POST',
        headers: {
          origin: ORIGEN_CONECTIVIDAD,
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
          'x-faro-panel': '1',
          'cf-access-jwt-assertion': id.jwt,
          ...(token ? { 'x-faro-sesion': token } : {}),
        },
        body: JSON.stringify(cuerpo),
      });
    return { ...backend, panel, peticion };
  } catch (error) {
    backend.cerrar();
    throw error;
  }
}
