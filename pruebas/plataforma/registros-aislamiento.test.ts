/** Reinicios y tablas sintéticas: el fallo institucional/operativo no expulsa al operador de sus controles. */

import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import type { AlmacenAccesos } from '../../src/administracion/accesos.ts';
import type { AlmacenAdministradores } from '../../src/administracion/administradores.ts';
import type { AlmacenControles } from '../../src/administracion/controles.ts';
import type { AlmacenInstituciones } from '../../src/administracion/instituciones.ts';
import type { AlmacenPreparacionPanel } from '../../src/administracion/sesion.ts';
import type { AlmacenSesionUnica } from '../../src/administracion/sesion-unica.ts';
import { esObjeto } from '../../src/comun/json.ts';
import { AccesoPublicoDurable, type EstadoAccesoPublicoDurable } from '../../src/plataforma/acceso-publico/durable.ts';
import { abrirSqlAdministrativoNode, crearAlmacenPublicoNode } from '../../src/plataforma/acceso-publico/node.ts';
import { SesionUnicaDurable } from '../../src/plataforma/acceso-publico/sesion-unica-cliente-durable.ts';
import type { FilaSql, ValorSql } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { montarAdministracion } from '../../src/plataforma/administracion.ts';
import { alarmaDurableDePrueba } from '../ayudas/alarma-durable.ts';
import { principalDePrueba } from '../ayudas/principal-panel.ts';

const AHORA = Date.now(),
  ORIGEN = 'https://panel.invalid';
const POLITICA = { version: 2, api: 'habilitada', mcp: false, a2a: false } as const;
const HTTP_OK = 200,
  HTTP_NO_DISPONIBLE = 503;
interface Backend {
  readonly controles: AlmacenControles;
  readonly sesion: AlmacenPreparacionPanel & AlmacenSesionUnica & AlmacenAdministradores;
  readonly instituciones: AlmacenInstituciones;
  readonly accesos: AlmacenAccesos;
  filas(sql: string): FilaSql[];
  ejecutar(sql: string): void;
  reiniciar(): void;
  cerrar(): void;
}
function node(): Backend {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'aislamiento-registros-')),
    archivo = join(dir, 'registro.sqlite');
  const abrir = () => crearAlmacenPublicoNode({ archivo, maxClientes: 100, ahora: () => AHORA });
  let almacen = abrir();
  return {
    get controles() {
      return almacen;
    },
    get sesion() {
      return almacen.sesion;
    },
    get instituciones() {
      return almacen.instituciones;
    },
    get accesos() {
      return almacen.accesos;
    },
    filas: (sql) => {
      const base = abrirSqlAdministrativoNode(archivo);
      try {
        return base.sql.filas(sql);
      } finally {
        base.close();
      }
    },
    ejecutar: (sql) => {
      const base = abrirSqlAdministrativoNode(archivo);
      try {
        base.sql.ejecutar(sql);
      } finally {
        base.close();
      }
    },
    reiniciar: () => {
      almacen.close();
      almacen = abrir();
    },
    cerrar: () => {
      almacen.close();
      rmSync(dir, { recursive: true });
    },
  };
}
function durable(): Backend {
  const db = new DatabaseSync(':memory:');
  const estado: EstadoAccesoPublicoDurable = {
    storage: {
      ...alarmaDurableDePrueba(),
      sql: { exec: (sql: string, ...valores: ValorSql[]) => ({ toArray: () => db.prepare(sql).all(...valores) }) },
      transactionSync: <T>(accion: () => T): T => {
        db.exec('BEGIN IMMEDIATE');
        try {
          const resultado = accion();
          db.exec('COMMIT');
          return resultado;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      },
    },
  };
  const entorno = {};
  let servidor = new AccesoPublicoDurable(estado, entorno);
  const almacen = new SesionUnicaDurable({ idFromName: (n) => n, get: () => servidor });
  return {
    controles: almacen,
    sesion: almacen,
    instituciones: almacen,
    accesos: almacen,
    filas: (sql) => db.prepare(sql).all(),
    ejecutar: (sql) => db.exec(sql),
    reiniciar: () => {
      servidor = new AccesoPublicoDurable(estado, entorno);
    },
    cerrar: () => db.close(),
  };
}
async function montar(backend: Backend) {
  const panel = await montarAdministracion({
    configuracion: { origen: ORIGEN, permitirHttpLocal: false },
    // Aquí se prueba el aislamiento del almacenamiento; las firmas Access se contrastan en instituciones-http.test.ts.
    guardiaAdministrativa: async () => principalDePrueba('https://emisor.invalid', 'principal-sintetico'),
    almacen: backend.controles,
    sesion: backend.sesion,
    instituciones: backend.instituciones,
    accesos: backend.accesos,
    inicial: POLITICA,
  });
  return (ruta: string, cuerpo: unknown = {}, token?: string) =>
    panel.responder(
      new Request(`${ORIGEN}/administracion/api/${ruta}`, {
        method: 'POST',
        headers: {
          origin: ORIGEN,
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
          'x-faro-panel': '1',
          ...(token ? { 'x-faro-sesion': token } : {}),
        },
        body: JSON.stringify(cuerpo),
      }),
    );
}
for (const modo of ['Node', 'binding'] as const) {
  for (const tabla of ['instituciones_claves', 'conectividad_uso'] as const) {
    test(`${modo}: reiniciar con ${tabla} perdida conserva sesión y permite apagar; la capacidad dañada da 503`, async () => {
      const backend = modo === 'Node' ? node() : durable();
      try {
        const inicial = await montar(backend),
          abierta = await inicial('sesion/abrir');
        const cuerpo: unknown = await abierta.json();
        assert(esObjeto(cuerpo) && typeof cuerpo.token === 'string');
        const token = cuerpo.token;
        await backend.instituciones.prepararInstituciones();
        await backend.accesos.prepararAccesos();
        backend.ejecutar(`DROP TABLE ${tabla}`);
        backend.reiniciar();
        const reiniciado = await montar(backend);
        const cambio = await reiniciado(
          'controles/cambiar',
          { revisionEsperada: 0, politica: { ...POLITICA, api: 'deshabilitada' } },
          token,
        );
        assert.equal(cambio.status, HTTP_OK);
        const rota = await reiniciado(
          tabla === 'instituciones_claves' ? 'instituciones/leer' : 'accesos/leer',
          tabla === 'instituciones_claves' ? {} : { pagina: 1 },
          token,
        );
        assert.equal(rota.status, HTTP_NO_DISPONIBLE);
        assert.deepEqual(await rota.json(), { error: 'no_disponible' });
        assert.equal((await reiniciado('controles/leer', {}, token)).status, HTTP_OK);
        assert.equal((await reiniciado('sesion/estado', {}, token)).status, HTTP_OK);
        assert.deepEqual(backend.filas(`SELECT name FROM sqlite_master WHERE name='${tabla}'`), []);
      } finally {
        backend.cerrar();
      }
    });
  }
}
