/** Un mismo Durable sintético une sesión, panel, política pública y selector, sin despliegue ni red. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { crearRouterAdministrativo } from '../../src/administracion/http.ts';
import { politicaSeccionesInicial } from '../../src/administracion/secciones-web.js';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { AccesoPublicoDurable, type EstadoAccesoPublicoDurable } from '../../src/plataforma/acceso-publico/durable.ts';
import { AlmacenRecorridoDurable } from '../../src/plataforma/acceso-publico/recorrido-cliente-durable.ts';
import type { ValorSql } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { respuestaSeccionesV3 } from '../../src/plataforma/cloudflare/secciones-v3.ts';
import { comprobarSeccionWeb } from '../../src/plataforma/secciones-web.ts';
import { crearClientePanel, type EstadoClientePanel } from '../../web/administracion/cliente.js';
import { principalDePrueba } from '../ayudas/principal-panel.ts';

const ORIGEN = 'https://panel.prueba';
function estadoSqlite(db: DatabaseSync): EstadoAccesoPublicoDurable {
  return {
    storage: {
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
}
test('panel y web consultan la misma política, antes y después de cambiar', async (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const servidor = new AccesoPublicoDurable(estadoSqlite(db), {});
  const espacio = { idFromName: () => 'registro-publico-v1', get: () => servidor };
  const almacen = new AlmacenRecorridoDurable(espacio);
  await almacen.prepararPanel({ version: 2, api: 'deshabilitada', mcp: false, a2a: false });
  const router = crearRouterAdministrativo({
    origen: ORIGEN,
    almacen,
    secciones: almacen,
    recorrido: almacen,
    guardiaAdministrativa: async () => principalDePrueba(ORIGEN, 'administrador-sintetico'),
  });
  const pedir: typeof fetch = (ruta, opciones) => {
    const headers = new Headers(opciones?.headers);
    headers.set('origin', ORIGEN);
    headers.set('sec-fetch-site', 'same-origin');
    return router(new Request(new URL(String(ruta), ORIGEN), { ...opciones, headers }));
  };
  let ultima: EstadoClientePanel | undefined;
  const cliente = crearClientePanel({
    pedir,
    alCambiar: (estado) => {
      ultima = estado;
    },
  });
  await cliente.abrir();
  assert.equal(ultima?.estado, 'activa');
  await comprobarPolitica(cliente, espacio, almacen, () => ultima);
  cliente.destruir();
});

type Cliente = ReturnType<typeof crearClientePanel>;
type Espacio = { idFromName: () => string; get: () => AccesoPublicoDurable };

async function comprobarPolitica(
  cliente: Cliente,
  espacio: Espacio,
  almacen: AlmacenRecorridoDurable,
  estado: () => EstadoClientePanel | undefined,
) {
  await cliente.consultarSecciones();
  const leida = estado();
  assert.ok(leida && leida.estado === 'activa' && leida.secciones);
  assert.deepEqual(leida.secciones.secciones, politicaSeccionesInicial());
  const webAntes = await respuestaSeccionesV3(
    new Request(`${ORIGEN}/secciones-v3.json`),
    espacio,
    async () => {},
    false,
  );
  const documentoAntes = (await webAntes.json()) as {
    secciones: ReturnType<typeof politicaSeccionesInicial>;
    revision: number;
  };
  assert.deepEqual(documentoAntes.secciones, leida.secciones.secciones);
  const cambiada = { ...leida.secciones.secciones, biblioteca: false };
  await cliente.cambiarSecciones(cambiada);
  const webDespues = await respuestaSeccionesV3(
    new Request(`${ORIGEN}/secciones-v3.json`),
    espacio,
    async () => {},
    false,
  );
  const documentoDespues = (await webDespues.json()) as {
    secciones: ReturnType<typeof politicaSeccionesInicial>;
    revision: number;
  };
  assert.deepEqual(documentoDespues.secciones, cambiada);
  const confirmada = estado();
  assert.ok(confirmada && confirmada.estado === 'activa' && confirmada.secciones);
  assert.deepEqual(confirmada.secciones.secciones, documentoDespues.secciones);
  assert.equal(confirmada.secciones.revision, documentoDespues.revision);
  assert.equal(documentoDespues.revision, documentoAntes.revision + 1);
  await comprobarAcceso(almacen);
}

async function comprobarAcceso(almacen: AlmacenRecorridoDurable) {
  const lector = async () => {
    const doc = await almacen.leerSecciones();
    if (!doc) {
      throw new Error('sin política');
    }
    return doc;
  };
  assert.equal(
    (await comprobarSeccionWeb('/biblioteca.html', new AbortController().signal, lector))?.status,
    ESTADO_HTTP.noEncontrado,
  );
  assert.equal(await comprobarSeccionWeb('/recorrido.html', new AbortController().signal, lector), undefined);
}
