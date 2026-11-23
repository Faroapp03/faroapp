/** Protocolo privado de la lista de administradores a través del objeto durable, sobre SQLite real. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { MAX_ADMINISTRADORES, MAX_ADMINISTRADORES_INICIALES } from '../../src/administracion/administradores.ts';
import type { AccesoSesionPanel } from '../../src/administracion/sesion.ts';
import type { IdentidadPanel } from '../../src/administracion/sesion-unica.ts';
import { AccesoPublicoDurable, type EstadoAccesoPublicoDurable } from '../../src/plataforma/acceso-publico/durable.ts';
import { SesionUnicaDurable } from '../../src/plataforma/acceso-publico/sesion-unica-cliente-durable.ts';
import type { ValorSql } from '../../src/plataforma/acceso-publico/sqlite.ts';

const HTTP_INVALIDO = 400;
const CORREO_MAXIMO = 254;
const DOMINIO = '@faro.invalid';
/** Tres cifras distinguen cada correo de la lista llena. */
const CIFRAS = 3;

function huella(...partes: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(partes)).digest('hex');
}
/** El peor caso de tamaño: 254 unidades y cada una ocupa 3 bytes en UTF-8. */
function correoLargo(n: number): string {
  return `${String(n).padStart(CIFRAS, '0')}${'a'.repeat(CORREO_MAXIMO - CIFRAS - DOMINIO.length)}${DOMINIO}`;
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
    cliente: new SesionUnicaDurable(espacio),
    enviar: (ruta: string, cuerpo: unknown) =>
      servidor.fetch(
        new Request(`https://registro-socios.invalid${ruta}`, { method: 'POST', body: JSON.stringify(cuerpo) }),
      ),
  };
}

test('a través del durable, la lista llena de correos largos cruza entera y validada', async () => {
  const { db, cliente } = montaje();
  try {
    await cliente.activarControles({ version: 2, api: 'habilitada', mcp: false, a2a: false });
    await cliente.activarSesionPanel();
    const autor: IdentidadPanel = {
      huellaPrincipal: huella('p', 'autor'),
      correo: correoLargo(0),
      huellaEntrada: huella('e', 'autor'),
    };
    const acceso: AccesoSesionPanel = { huellaSesion: huella('t', 'autor'), huellaPrincipal: autor.huellaPrincipal };
    assert.equal((await cliente.abrirSesionUnica(acceso, autor, false)).estado, 'abierta');
    for (let n = 0; n < MAX_ADMINISTRADORES; n += 1) {
      const cambio = { operacion: 'anadir', autor: autor.correo, correo: correoLargo(n), access: 'correcta' } as const;
      assert.equal((await cliente.cambiarAdministradores(acceso, cambio)).estado, 'activa');
    }
    const lista = await cliente.leerAdministradores();
    assert.equal(lista.length, MAX_ADMINISTRADORES);
    assert.equal(lista.at(-1)?.correo, correoLargo(MAX_ADMINISTRADORES - 1));
    const llena = {
      operacion: 'anadir',
      autor: autor.correo,
      correo: 'otra@faro.invalid',
      access: 'correcta',
    } as const;
    assert.deepEqual(await cliente.cambiarAdministradores(acceso, llena), {
      estado: 'rechazado',
      motivo: 'lista_llena',
    });
    assert.equal(
      await cliente.autorizarAdministrador({ correo: correoLargo(1), segundoFactor: true }, []),
      'autorizado',
    );
    assert.equal(
      await cliente.autorizarAdministrador({ correo: 'otra@faro.invalid', segundoFactor: true }, []),
      'denegado',
    );
  } finally {
    db.close();
  }
});

test('el durable rechaza entradas incompletas, correos sin normalizar y siembras desmedidas', async () => {
  const { db, cliente, enviar } = montaje();
  try {
    await cliente.activarControles({ version: 2, api: 'habilitada', mcp: false, a2a: false });
    await cliente.activarSesionPanel();
    const acceso = { huellaSesion: huella('t', 'x'), huellaPrincipal: huella('p', 'x') };
    const siembra = Array.from({ length: MAX_ADMINISTRADORES_INICIALES + 1 }, (_, n) => `p${n}@faro.invalid`);
    const casos: [string, unknown][] = [
      ['/panel/administradores/autorizar', { entrada: { correo: 'ana@faro.invalid' }, siembra: [] }],
      [
        '/panel/administradores/autorizar',
        { entrada: { correo: 'Ana@faro.invalid', segundoFactor: false }, siembra: [] },
      ],
      ['/panel/administradores/autorizar', { entrada: { correo: null, segundoFactor: false }, siembra }],
      ['/panel/administradores/leer', { pagina: 1 }],
      [
        '/panel/administradores/cambiar',
        {
          acceso,
          cambio: { operacion: 'anadir', autor: 'ana@faro.invalid', correo: 'Berta@faro.invalid', access: 'correcta' },
        },
      ],
      [
        '/panel/administradores/cambiar',
        { acceso, cambio: { operacion: 'borrar-todo', autor: 'ana@faro.invalid', correo: 'a@b' } },
      ],
    ];
    for (const [ruta, cuerpo] of casos) {
      assert.equal((await enviar(ruta, cuerpo)).status, HTTP_INVALIDO, JSON.stringify(cuerpo));
    }
    assert.equal(db.prepare('SELECT count(*) AS n FROM administracion_administradores').get()?.n, 0);
  } finally {
    db.close();
  }
});
