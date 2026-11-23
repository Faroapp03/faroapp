/** Una revocación llena no pierde las anteriores y conserva su causa operativa a través del servicio. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { RevocacionesLlenas } from '../../src/api/socios/revocaciones.ts';
import { crearServidorDeSocios } from '../../src/api/socios/servidor-socios.ts';
import { AlmacenPublicoSqlite } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { motorPanel } from '../ayudas/persistencia-panel.ts';
import { SociosDePrueba } from '../ayudas/socios-api.ts';

const TAM_JTI = 22,
  AHORA = 10_000,
  CADUCA = 100;
test('servicio institucional conserva RevocacionesLlenas de SQLite sin sustituirla por fallo genérico ni descartar tokens', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const almacen = new AlmacenPublicoSqlite(motorPanel(db), {
      maxClientes: 1,
      maxRevocaciones: 1,
      ahora: () => AHORA,
    });
    const servidor = await crearServidorDeSocios(
      { ...new SociosDePrueba().opciones(), almacen },
      { secreto: 'firma-sintetica-para-el-ensayo-de-capacidad-de-revocacion', anterior: undefined },
    );
    await servidor.revocaciones.revocar('a'.repeat(TAM_JTI), CADUCA);
    await assert.rejects(servidor.revocaciones.revocar('b'.repeat(TAM_JTI), CADUCA), RevocacionesLlenas);
    assert.equal(await servidor.revocaciones.revocado('a'.repeat(TAM_JTI)), true);
    assert.equal(await servidor.revocaciones.revocado('b'.repeat(TAM_JTI)), false);
  } finally {
    db.close();
  }
});
