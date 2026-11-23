/** Con datos opacos sintéticos: el acceso vigente abre la base sin migrar ni destruir las tablas que no le pertenecen. */
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { AccesoPublicoDurable, type EstadoAccesoPublicoDurable } from '../../src/plataforma/acceso-publico/durable.ts';
import { crearAlmacenPublicoNode } from '../../src/plataforma/acceso-publico/node.ts';
import { SesionUnicaDurable } from '../../src/plataforma/acceso-publico/sesion-unica-cliente-durable.ts';
import type { SqlAccesoPublico, ValorSql } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { accesoPanel, motorPanel, OPCIONES_PANEL, POLITICA_PANEL } from '../ayudas/persistencia-panel.ts';
import {
  sembrarSocioEnArchivo,
  sembrarSocioPersistido,
  socioEnArchivo,
  socioPersistido,
} from '../ayudas/registro-persistido-anterior.ts';
import { abrirSesionDePrueba } from '../ayudas/sesion-de-prueba.ts';

const TABLAS = [
  'administracion_conexiones_ia',
  'administracion_secretos_ia_estado',
  'administracion_secretos_ia',
  'administracion_recibos_ia',
];
const METODOS = [
  'prepararConexionesIa',
  'leerConexionesIaPrivadas',
  'leerConexionesIaDeSesion',
  'seleccionarConexionIaDeSesion',
  'confirmarRegistroConexionIaDeSesion',
  'leerReciboRegistroConexionIaDeSesion',
  'leerSecretoIaPrivado',
];
const CARACTERES_HUELLA = 64;
const CARACTERES_JTI = 22;
const CADUCIDAD_REVOCACION_S = 200;
const SOCIO = { id: 'pub-sintetico', huellas: ['a'.repeat(CARACTERES_HUELLA)], consultasPorHora: 3 };
const CUENTAS = [{ clave: 'consultas:global', limite: 1, ventanaMs: 86_400_000 }];
const ENTORNO = {};

function conservarDatosOpacos(db: DatabaseSync) {
  db.exec(`ALTER TABLE publico_estado ADD COLUMN conexiones_ia_version INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE publico_estado ADD COLUMN secretos_ia_version INTEGER NOT NULL DEFAULT 1;
    CREATE TABLE administracion_conexiones_ia (id INTEGER PRIMARY KEY, documento TEXT NOT NULL) STRICT;
    CREATE TABLE administracion_secretos_ia_estado (id INTEGER PRIMARY KEY, version INTEGER NOT NULL, instalacion_id TEXT NOT NULL, secretos INTEGER NOT NULL, recibos INTEGER NOT NULL, ultima_revision INTEGER NOT NULL) STRICT;
    CREATE TABLE administracion_secretos_ia (referencia TEXT PRIMARY KEY, conexion_id TEXT NOT NULL UNIQUE, documento TEXT NOT NULL) STRICT;
    CREATE TABLE administracion_recibos_ia (operacion_id TEXT PRIMARY KEY, revision INTEGER NOT NULL UNIQUE, documento TEXT NOT NULL) STRICT;
    INSERT INTO administracion_conexiones_ia VALUES (1,'documento-opaco-sintetico');
    INSERT INTO administracion_secretos_ia_estado VALUES (1,1,'instalacion-sintetica',1,1,1);
    INSERT INTO administracion_secretos_ia VALUES ('referencia-sintetica','conexion-sintetica','sobre-opaco-sintetico');
    INSERT INTO administracion_recibos_ia VALUES ('operacion-sintetica',1,'recibo-opaco-sintetico');`);
}
function captura(db: DatabaseSync) {
  return JSON.stringify({
    esquema: db.prepare("SELECT name,sql FROM sqlite_master WHERE name LIKE 'administracion_%ia%' ORDER BY name").all(),
    filas: TABLAS.map((tabla) => db.prepare(`SELECT * FROM ${tabla}`).all()),
    metadatos: db.prepare('SELECT conexiones_ia_version,secretos_ia_version FROM publico_estado WHERE id=1').get(),
  });
}
function sinCapacidad(almacen: object) {
  for (const nombre of METODOS) {
    assert.equal(nombre in almacen, false, nombre);
  }
}

test('Node reabre datos opacos sin modificarlos y mantiene sesión, controles, cuotas y revocaciones', async () => {
  const carpeta = mkdtempSync(join(realpathSync(tmpdir()), 'persistencia-panel-'));
  const archivo = join(carpeta, 'estado.sqlite');
  try {
    const inicial = crearAlmacenPublicoNode({ archivo, ...OPCIONES_PANEL });
    await inicial.sesion.prepararPanel(POLITICA_PANEL);
    sembrarSocioEnArchivo(archivo, SOCIO);
    await abrirSesionDePrueba(inicial.sesion, accesoPanel('a'));
    await inicial.revocar('a'.repeat(CARACTERES_JTI), CADUCIDAD_REVOCACION_S);
    inicial.close();
    const db = new DatabaseSync(archivo);
    conservarDatosOpacos(db);
    const antes = captura(db);
    db.close();
    const almacen = crearAlmacenPublicoNode({ archivo, ...OPCIONES_PANEL });
    try {
      assert.equal('conexionesIa' in almacen, false);
      assert.equal('gestionConexionesIa' in almacen, false);
      sinCapacidad(almacen.sesion);
      assert.deepEqual(socioEnArchivo(archivo, SOCIO.id), SOCIO);
      assert.equal(await almacen.revocado('a'.repeat(CARACTERES_JTI)), true);
      assert.equal(await almacen.consumir(CUENTAS), true);
      assert.equal(await almacen.consumir(CUENTAS), false);
      assert.equal((await almacen.sesion.comprobarSesion(accesoPanel('a'))).estado, 'activa');
      assert.equal(
        (await almacen.sesion.cambiarControlesDeSesion(accesoPanel('a'), 0, { ...POLITICA_PANEL, mcp: true })).estado,
        'cambiado',
      );
      assert.equal((await almacen.leerControles())?.mcp, true);
    } finally {
      almacen.close();
    }
    const posterior = new DatabaseSync(archivo);
    try {
      assert.equal(captura(posterior), antes);
    } finally {
      posterior.close();
    }
  } finally {
    rmSync(carpeta, { recursive: true, force: true });
  }
});

test('DO rechaza las siete rutas de proveedor sin leer ni modificar tablas opacas y conserva operaciones vigentes', async () => {
  const db = new DatabaseSync(':memory:');
  const sql: SqlAccesoPublico = motorPanel(db);
  const estado: EstadoAccesoPublicoDurable = {
    storage: {
      sql: {
        exec: (sentencia: string, ...valores: ValorSql[]) => ({ toArray: () => db.prepare(sentencia).all(...valores) }),
      },
      transactionSync: (accion) => sql.transaccion(accion),
    },
  };
  let servidor = new AccesoPublicoDurable(estado, ENTORNO);
  const almacen = new SesionUnicaDurable({ idFromName: () => 'registro-publico-v1', get: () => servidor });
  try {
    await almacen.prepararPanel(POLITICA_PANEL);
    sembrarSocioPersistido(db, SOCIO);
    await abrirSesionDePrueba(almacen, accesoPanel('a'));
    conservarDatosOpacos(db);
    const antes = captura(db);
    servidor = new AccesoPublicoDurable(estado, ENTORNO);
    sinCapacidad(almacen);
    for (const ruta of ['preparar', 'privadas', 'leer', 'seleccionar', 'confirmar-registro', 'recibo', 'secreto']) {
      const respuesta = await servidor.fetch(
        new Request(`https://registro-socios.invalid/conexiones-ia/${ruta}`, { method: 'POST', body: '{}' }),
      );
      assert.equal(respuesta.status, ESTADO_HTTP.solicitudIncorrecta, ruta);
      assert.doesNotMatch(await respuesta.text(), /opaco|sintetico|documento|sobre|recibo/);
    }
    assert.deepEqual(socioPersistido(db, SOCIO.id), SOCIO);
    assert.equal((await almacen.comprobarSesion(accesoPanel('a'))).estado, 'activa');
    assert.equal(
      (await almacen.cambiarControlesDeSesion(accesoPanel('a'), 0, { ...POLITICA_PANEL, mcp: true })).estado,
      'cambiado',
    );
    assert.equal(await almacen.consumir(CUENTAS), true);
    assert.equal(await almacen.consumir(CUENTAS), false);
    assert.equal(captura(db), antes);
  } finally {
    db.close();
  }
});
