/** Protocolo privado de la sesión única sobre SQLite real; no sustituye una prueba del alojamiento Cloudflare. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import type { AccesoSesionPanel } from '../../src/administracion/sesion.ts';
import { FILAS_LECTURA_REGISTRO_PANEL, type IdentidadPanel } from '../../src/administracion/sesion-unica.ts';
import { AccesoPublicoDurable, type EstadoAccesoPublicoDurable } from '../../src/plataforma/acceso-publico/durable.ts';
import { SesionUnicaDurable } from '../../src/plataforma/acceso-publico/sesion-unica-cliente-durable.ts';
import type { ValorSql } from '../../src/plataforma/acceso-publico/sqlite.ts';

const HTTP_INVALIDO = 400;
const CORREO_MAXIMO = 254;

function huella(...partes: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(partes)).digest('hex');
}
function persona(nombre: string, emitido = 1, correo = `${nombre}@faro.invalid`): IdentidadPanel {
  return { huellaPrincipal: huella('p', nombre), correo, huellaEntrada: huella('e', nombre, emitido) };
}
function token(quien: IdentidadPanel, dispositivo: string): AccesoSesionPanel {
  return { huellaSesion: huella('t', dispositivo), huellaPrincipal: quien.huellaPrincipal };
}
function montaje() {
  const db = new DatabaseSync(':memory:');
  const estado: EstadoAccesoPublicoDurable = {
    storage: {
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
  const servidor = new AccesoPublicoDurable(estado, {});
  const espacio = { idFromName: () => 'registro-publico-v1', get: () => servidor };
  return {
    db,
    uno: new SesionUnicaDurable(espacio),
    dos: new SesionUnicaDurable(espacio),
    enviar: (ruta: string, cuerpo: unknown) =>
      servidor.fetch(
        new Request(`https://registro-socios.invalid${ruta}`, { method: 'POST', body: JSON.stringify(cuerpo) }),
      ),
  };
}

test('a través del durable, otra persona queda bloqueada y la misma retoma; el registro cruza validado', async () => {
  const { db, uno, dos } = montaje();
  try {
    await uno.activarControles({ version: 2, api: 'habilitada', mcp: false, a2a: false });
    await uno.activarSesionPanel();
    const ana = persona('ana');
    const abierta = await uno.abrirSesionUnica(token(ana, 'portatil'), ana, false);
    assert.equal(abierta.estado, 'abierta');
    const berta = persona('berta');
    const ocupada = await dos.abrirSesionUnica(token(berta, 'oficina'), berta, true);
    assert.equal(ocupada.estado === 'ocupada' && ocupada.ocupacion.correo, 'ana@faro.invalid');
    const bienvenida = await dos.recibirEnPanel(berta);
    assert.equal(bienvenida.ocupacion?.propia, false);
    const anaMovil = persona('ana', 2);
    assert.equal((await dos.abrirSesionUnica(token(anaMovil, 'movil'), anaMovil, true)).estado, 'abierta');
    assert.deepEqual(await uno.comprobarSesion(token(ana, 'portatil')), { estado: 'sustituida' });
    const tipos = (await uno.leerRegistroPanel()).map((fila) => fila.tipo);
    assert.deepEqual(tipos, [
      'sesion-abierta',
      'sesion-retomada',
      'entrada',
      'apertura-rechazada',
      'entrada',
      'sesion-abierta',
      'entrada',
    ]);
    for (let n = 0; n < FILAS_LECTURA_REGISTRO_PANEL; n += 1) {
      const largo = `${'a'.repeat(CORREO_MAXIMO - '@faro.invalid'.length)}@faro.invalid`;
      await uno.recibirEnPanel(persona('larga', n + 10, largo));
    }
    assert.equal((await uno.leerRegistroPanel()).length, FILAS_LECTURA_REGISTRO_PANEL);
  } finally {
    db.close();
  }
});

test('el durable rechaza identidades incompletas, extras y retomas sin decidir', async () => {
  const { db, uno, enviar } = montaje();
  try {
    await uno.activarControles({ version: 2, api: 'habilitada', mcp: false, a2a: false });
    await uno.activarSesionPanel();
    const ana = persona('ana');
    const casos: [string, unknown][] = [
      ['/panel/bienvenida', { identidad: { ...ana, correo: 'sin arroba' } }],
      ['/panel/bienvenida', { identidad: ana, extra: true }],
      ['/panel/abrir-unica', { acceso: token(ana, 'x'), identidad: ana }],
      ['/panel/abrir-unica', { acceso: token(ana, 'x'), identidad: ana, retomar: 'si' }],
      ['/panel/registro', { pagina: 1 }],
    ];
    for (const [ruta, cuerpo] of casos) {
      assert.equal((await enviar(ruta, cuerpo)).status, HTTP_INVALIDO, ruta);
    }
    await assert.rejects(uno.abrirSesionUnica(token(persona('berta'), 'x'), ana, false));
    assert.equal(db.prepare('SELECT count(*) AS n FROM administracion_registro_panel').get()?.n, 0);
  } finally {
    db.close();
  }
});
