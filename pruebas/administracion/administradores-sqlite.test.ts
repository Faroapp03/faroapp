/** Lista de administradores sobre SQLite: migración, autorización, siembra, altas, retiradas y registro. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import type { CambioAdministradores } from '../../src/administracion/administradores.ts';
import type { PoliticaControles } from '../../src/administracion/controles.ts';
import type { AccesoSesionPanel } from '../../src/administracion/sesion.ts';
import type { IdentidadPanel } from '../../src/administracion/sesion-unica.ts';
import { AlmacenSesionPanelSqlite } from '../../src/plataforma/acceso-publico/sesion-sqlite.ts';
import { AlmacenPublicoSqlite, type SqlAccesoPublico } from '../../src/plataforma/acceso-publico/sqlite.ts';

const INICIO = 10_000;
const MINUTO = 60_000;
const politica: PoliticaControles = { version: 2, api: 'deshabilitada', mcp: false, a2a: false };

function huella(...partes: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(partes)).digest('hex');
}
function persona(nombre: string): IdentidadPanel {
  return {
    huellaPrincipal: huella('principal', nombre),
    correo: `${nombre}@faro.invalid`,
    huellaEntrada: huella('entrada', nombre),
  };
}
function token(quien: IdentidadPanel, dispositivo: string): AccesoSesionPanel {
  return { huellaSesion: huella('token', dispositivo), huellaPrincipal: quien.huellaPrincipal };
}
function motor(db: DatabaseSync): SqlAccesoPublico {
  return {
    filas: (sql, ...valores) => db.prepare(sql).all(...valores),
    ejecutar: (sql, ...valores) => {
      db.prepare(sql).run(...valores);
    },
    transaccion: <T>(accion: () => T): T => {
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
  };
}
interface Contexto {
  readonly db: DatabaseSync;
  readonly s: AlmacenSesionPanelSqlite;
  readonly reloj: { ahora: number };
}
function conPanel(accion: (contexto: Contexto) => Promise<void>) {
  return async () => {
    const db = new DatabaseSync(':memory:');
    const sql = motor(db);
    const reloj = { ahora: INICIO };
    const publico = new AlmacenPublicoSqlite(sql, { maxClientes: 1, ahora: () => reloj.ahora });
    const s = new AlmacenSesionPanelSqlite(sql, { ahora: () => reloj.ahora });
    try {
      await publico.activarControles(politica);
      await s.activarSesionPanel();
      await accion({ db, s, reloj });
    } finally {
      db.close();
    }
  };
}
const ana = persona('ana');
const berta = persona('berta');
const ANA = 'ana@faro.invalid';
const BERTA = 'berta@faro.invalid';
const CARLA = 'carla@faro.invalid';

/** Ana abre la sesión única desde su portátil: es lo que exige cualquier cambio de la lista. */
async function anaConSesion(s: AlmacenSesionPanelSqlite): Promise<AccesoSesionPanel> {
  const acceso = token(ana, 'portatil');
  const abierta = await s.abrirSesionUnica(acceso, ana, false);
  assert.equal(abierta.estado, 'abierta');
  return acceso;
}
function anadir(autor: string, correo: string): CambioAdministradores {
  return { operacion: 'anadir', autor, correo, access: 'sin-configurar' };
}
async function correos(s: AlmacenSesionPanelSqlite) {
  return (await s.leerAdministradores()).map((fila) => [fila.correo, fila.estado]);
}

test(
  'lista vacía: basta Access, también sin correo; sin cambios en la lista',
  conPanel(async ({ s }) => {
    assert.equal(await s.autorizarAdministrador({ correo: ANA, segundoFactor: false }, []), 'sin-lista');
    assert.equal(await s.autorizarAdministrador({ correo: null, segundoFactor: false }, []), 'sin-lista');
    assert.deepEqual(await s.leerAdministradores(), []);
  }),
);

test(
  'siembra: entra como pendiente, solo en una lista que nunca tuvo filas, y pasa a activo en su primera entrada',
  conPanel(async ({ s, reloj }) => {
    assert.equal(await s.autorizarAdministrador({ correo: BERTA, segundoFactor: false }, [ANA]), 'denegado');
    assert.deepEqual(await correos(s), [[ANA, 'pendiente']]);
    reloj.ahora += MINUTO;
    assert.equal(await s.autorizarAdministrador({ correo: ANA, segundoFactor: true }, [ANA]), 'autorizado');
    const [fila] = await s.leerAdministradores();
    assert.deepEqual(fila, {
      correo: ANA,
      estado: 'activo',
      anadidoPor: null,
      anadidoEn: INICIO,
      ultimaEntrada: INICIO + MINUTO,
      segundoFactor: true,
    });
    // Una siembra distinta en un arranque posterior no cambia una lista que ya existe.
    assert.equal(await s.autorizarAdministrador({ correo: BERTA, segundoFactor: false }, [BERTA]), 'denegado');
    assert.deepEqual(await correos(s), [[ANA, 'activo']]);
    // Sin correo verificado no hay a quién buscar en la lista.
    assert.equal(await s.autorizarAdministrador({ correo: null, segundoFactor: true }, [ANA]), 'denegado');
  }),
);

test(
  'añadir exige la sesión única de quien pide; la primera alta es la propia; rechaza duplicados',
  conPanel(async ({ s }) => {
    assert.deepEqual(await s.cambiarAdministradores(token(ana, 'sin-abrir'), anadir(ANA, ANA)), {
      estado: 'cerrada',
    });
    assert.deepEqual(await s.leerAdministradores(), []);
    const acceso = await anaConSesion(s);
    assert.deepEqual(await s.cambiarAdministradores(acceso, anadir(ANA, BERTA)), {
      estado: 'rechazado',
      motivo: 'alta_propia_primero',
    });
    const propia = await s.cambiarAdministradores(acceso, anadir(ANA, ANA));
    assert.equal(propia.estado, 'activa');
    assert.deepEqual(await correos(s), [[ANA, 'activo']]);
    await s.cambiarAdministradores(acceso, anadir(ANA, BERTA));
    assert.deepEqual(await s.cambiarAdministradores(acceso, anadir(ANA, BERTA)), {
      estado: 'rechazado',
      motivo: 'administrador_duplicado',
    });
    assert.deepEqual(await correos(s), [
      [ANA, 'activo'],
      [BERTA, 'pendiente'],
    ]);
    const [alta] = await s.leerRegistroPanel();
    assert.equal(alta?.tipo, 'administrador-anadido');
    assert.equal(alta?.correo, ANA);
    assert.equal(alta?.titular, BERTA);
  }),
);

test(
  'retirar: nunca el último activo, tampoco a uno mismo; un pendiente sí; queda anotado',
  conPanel(async ({ s }) => {
    const acceso = await anaConSesion(s);
    await s.cambiarAdministradores(acceso, anadir(ANA, ANA));
    await s.cambiarAdministradores(acceso, anadir(ANA, BERTA));
    const propia = { operacion: 'retirar', autor: ANA, correo: ANA, esperarAccess: false } as const;
    assert.deepEqual(await s.cambiarAdministradores(acceso, propia), { estado: 'rechazado', motivo: 'ultimo_activo' });
    const pendiente = { ...propia, correo: BERTA };
    assert.equal((await s.cambiarAdministradores(acceso, pendiente)).estado, 'activa');
    assert.deepEqual(await correos(s), [[ANA, 'activo']]);
    assert.deepEqual(await s.cambiarAdministradores(acceso, pendiente), {
      estado: 'rechazado',
      motivo: 'administrador_no_encontrado',
    });
    const [retirada] = await s.leerRegistroPanel();
    assert.deepEqual([retirada?.tipo, retirada?.correo, retirada?.titular], ['administrador-retirado', ANA, BERTA]);
  }),
);

test(
  'con Access: la retirada deja de autorizar al momento y espera a Cloudflare; el fallo se anota y se reintenta',
  conPanel(async ({ s }) => {
    const acceso = await anaConSesion(s);
    await s.cambiarAdministradores(acceso, anadir(ANA, ANA));
    await s.cambiarAdministradores(acceso, anadir(ANA, BERTA));
    assert.equal(await s.autorizarAdministrador({ correo: BERTA, segundoFactor: false }, []), 'autorizado');
    const retirar = { operacion: 'retirar', autor: ANA, correo: BERTA, esperarAccess: true } as const;
    await s.cambiarAdministradores(acceso, retirar);
    assert.equal(await s.autorizarAdministrador({ correo: BERTA, segundoFactor: false }, []), 'denegado');
    assert.deepEqual(await correos(s), [
      [ANA, 'activo'],
      [BERTA, 'retirada-pendiente'],
    ]);
    // Una retirada pendiente ya no cuenta: Ana sigue siendo la última activa.
    const propia = { ...retirar, correo: ANA };
    assert.deepEqual(await s.cambiarAdministradores(acceso, propia), { estado: 'rechazado', motivo: 'ultimo_activo' });
    const confirmar = { operacion: 'confirmar-retirada', autor: ANA, correo: BERTA } as const;
    await s.cambiarAdministradores(acceso, { ...confirmar, access: 'fallida' });
    assert.equal((await s.leerAdministradores()).length, 2);
    await s.cambiarAdministradores(acceso, { ...confirmar, access: 'correcta' });
    assert.deepEqual(await correos(s), [[ANA, 'activo']]);
    const tipos = (await s.leerRegistroPanel()).map((fila) => fila.tipo);
    const recientes = ['cloudflare-actualizado', 'cloudflare-fallido', 'administrador-retirado'];
    assert.deepEqual(tipos.slice(0, recientes.length), recientes);
  }),
);

test(
  'otra persona sin la sesión única no puede cambiar la lista, aunque sea administradora',
  conPanel(async ({ s }) => {
    const acceso = await anaConSesion(s);
    await s.cambiarAdministradores(acceso, anadir(ANA, ANA));
    await s.cambiarAdministradores(acceso, anadir(ANA, BERTA));
    const deBerta = await s.cambiarAdministradores(token(berta, 'oficina'), anadir(BERTA, CARLA));
    assert.notEqual(deBerta.estado, 'activa');
    assert.equal((await s.leerAdministradores()).length, 2);
  }),
);

test(
  'migración: una instalación con la sesión única y sin lista adopta la lista al preparar el panel, una sola vez',
  conPanel(async ({ s, db }) => {
    await s.recibirEnPanel(ana);
    db.exec('DROP TABLE administracion_administradores');
    db.exec('ALTER TABLE publico_estado DROP COLUMN administradores_version');
    // La instalación anterior se adopta al preparar el panel, antes de atender a nadie.
    await s.prepararPanel(politica);
    const tabla = db.prepare('SELECT sql FROM sqlite_master WHERE name=?');
    assert.match(String(tabla.get('administracion_registro_panel')?.sql), /'administrador-anadido'/);
    assert.equal(tabla.all('administracion_administradores').length, 1);
    const acceso = await anaConSesion(s);
    await s.cambiarAdministradores(acceso, anadir(ANA, ANA));
    const tipos = (await s.leerRegistroPanel()).map((fila) => fila.tipo);
    assert.deepEqual(tipos, ['administrador-anadido', 'sesion-abierta', 'entrada']);
    const version = db.prepare('SELECT administradores_version AS v FROM publico_estado WHERE id=1').get();
    assert.equal(version?.v, 1);
    // Una segunda preparación no repite la migración.
    await s.leerAdministradores();
    assert.equal((await s.leerRegistroPanel()).length, tipos.length);
  }),
);
