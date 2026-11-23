/** Protocolo privado sobre SQLite real; no sustituye una prueba del alojamiento Cloudflare. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import type { PoliticaControles } from '../../src/administracion/controles.ts';
import type { AccesoSesionPanel } from '../../src/administracion/sesion.ts';
import {
  AccesoPublicoDurable,
  AlmacenPublicoNoDisponible,
  type EstadoAccesoPublicoDurable,
} from '../../src/plataforma/acceso-publico/durable.ts';
import { SesionUnicaDurable } from '../../src/plataforma/acceso-publico/sesion-unica-cliente-durable.ts';
import type { ValorSql } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { sembrarSocioPersistido, socioPersistido } from '../ayudas/registro-persistido-anterior.ts';
import { abrirSesionDePrueba, identidadDePrueba } from '../ayudas/sesion-de-prueba.ts';

const LONGITUD_HUELLA = 64;
const HTTP_INVALIDO = 400;
const HTTP_NO_DISPONIBLE = 503;
const PLAZO_PRUEBA_MS = 20;
const politica = (): PoliticaControles => ({
  version: 2,
  api: 'habilitada',
  mcp: false,
  a2a: false,
});
const entorno = {};
function acceso(letra: string, persona = 'f'): AccesoSesionPanel {
  return { huellaSesion: letra.repeat(LONGITUD_HUELLA), huellaPrincipal: persona.repeat(LONGITUD_HUELLA) };
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
  let servidor = new AccesoPublicoDurable(estado, entorno);
  const espacio = { idFromName: () => 'registro-publico-v1', get: () => servidor };
  return {
    db,
    uno: new SesionUnicaDurable(espacio),
    dos: new SesionUnicaDurable(espacio),
    reiniciar: () => {
      servidor = new AccesoPublicoDurable(estado, entorno);
    },
    enviar: (ruta: string, cuerpo: unknown) =>
      servidor.fetch(
        new Request(`https://registro-socios.invalid${ruta}`, {
          method: 'POST',
          body: JSON.stringify(cuerpo),
        }),
      ),
  };
}

test('sesión durable sustituye entre pestañas y, tras el cierre, entre personas; acciones antiguas no alteran la nueva', async () => {
  const { db, uno, dos, reiniciar } = montaje();
  try {
    await uno.activarControles(politica());
    await uno.activarSesionPanel();
    const socio = { id: 'pub-uno', huellas: ['e'.repeat(LONGITUD_HUELLA)], consultasPorHora: 3 };
    sembrarSocioPersistido(db, socio);
    assert.equal((await abrirSesionDePrueba(uno, acceso('a'))).estado, 'activa');
    const nueva = await abrirSesionDePrueba(dos, acceso('b'));
    for (const operacion of ['comprobarSesion', 'mantenerSesion', 'cerrarSesion', 'leerControlesDeSesion'] as const) {
      assert.deepEqual(await uno[operacion](acceso('a')), { estado: 'sustituida' });
    }
    assert.deepEqual(await uno.cambiarControlesDeSesion(acceso('a'), 0, politica()), { estado: 'sustituida' });
    assert.deepEqual(await dos.comprobarSesion(acceso('b')), nueva);
    // Con la sesión viva otra persona queda bloqueada: solo puede abrir cuando su titular la cierra.
    await dos.cerrarSesion(acceso('b'));
    assert.equal((await abrirSesionDePrueba(dos, acceso('c', 'd'))).estado, 'activa');
    assert.deepEqual(await uno.comprobarSesion(acceso('b')), { estado: 'sustituida' });
    const cambio = await dos.cambiarControlesDeSesion(acceso('c', 'd'), 0, { ...politica(), api: 'deshabilitada' });
    assert.equal(cambio.estado, 'cambiado');
    assert.equal((await dos.cambiarControlesDeSesion(acceso('c', 'd'), 0, politica())).estado, 'conflicto');
    reiniciar();
    assert.equal((await dos.comprobarSesion(acceso('c', 'd'))).estado, 'activa');
    assert.equal(db.prepare('SELECT abierto FROM publico_estado').get()?.abierto, 0);
    assert.deepEqual(socioPersistido(db, socio.id), socio);
    assert.deepEqual(await dos.cerrarSesion(acceso('c', 'd')), { estado: 'cerrada' });
    assert.deepEqual(await dos.leerControlesDeSesion(acceso('c', 'd')), { estado: 'cerrada' });
  } finally {
    db.close();
  }
});

test('sesión durable exige adopción explícita y rechaza mensajes privados ajenos al contrato', async () => {
  const { db, uno, enviar } = montaje();
  try {
    await assert.rejects(abrirSesionDePrueba(uno, acceso('a')), AlmacenPublicoNoDisponible);
    await uno.activarControles(politica());
    await uno.activarSesionPanel();
    const actual = await abrirSesionDePrueba(uno, acceso('a'));
    for (const [ruta, cuerpo] of [
      // La única apertura es la de la sesión única: no hay otra vía que sustituya la sesión sin bloqueo ni registro.
      ['/panel/abrir', { acceso: acceso('b') }],
      [
        '/panel/abrir-unica',
        { acceso: { ...acceso('b'), extra: true }, identidad: identidadDePrueba(acceso('b')), retomar: true },
      ],
      ['/panel/estado', { acceso: { ...acceso('a'), huellaSesion: 'x' } }],
      ['/panel/cerrar', { acceso: acceso('a'), extra: true }],
      ['/panel/cambiar', { acceso: acceso('a'), revisionEsperada: -1, politica: politica() }],
      ['/panel/cambiar', { acceso: acceso('a'), revisionEsperada: 0, politica: { ...politica(), mcp: 'si' } }],
    ] as const) {
      assert.equal((await enviar(ruta, cuerpo)).status, HTTP_INVALIDO);
      assert.deepEqual(await uno.comprobarSesion(acceso('a')), actual);
    }
    await assert.rejects(uno.activarSesionPanel(), AlmacenPublicoNoDisponible);
  } finally {
    db.close();
  }
});

test('cliente de sesión durable valida entradas y respuestas; no sustituye fallos por sesión en memoria', async () => {
  let llamadas = 0;
  const respuestas = [
    () => new Response('{'),
    () => new Response(JSON.stringify({ estado: 'activa' })),
    () => new Response(JSON.stringify({ estado: 'cerrada', token: 'no-admitido' })),
    () => new Response('{}', { status: HTTP_NO_DISPONIBLE }),
    () => Promise.reject(new Error('fallo sintético')),
    () => new Promise<Response>(() => undefined),
  ];
  for (const responder of respuestas) {
    const almacen = new SesionUnicaDurable(
      {
        idFromName: () => 'registro-publico-v1',
        get: () => ({
          fetch: async () => {
            llamadas++;
            return responder();
          },
        }),
      },
      { tiempoLimiteMs: PLAZO_PRUEBA_MS },
    );
    const previas = llamadas;
    await assert.rejects(abrirSesionDePrueba(almacen, { ...acceso('a'), huellaSesion: 'invalida' }));
    assert.equal(llamadas, previas);
    await assert.rejects(almacen.comprobarSesion(acceso('a')), AlmacenPublicoNoDisponible);
  }
});

test('preparación durable es idempotente entre clientes y reinicios; conserva sesión y revisión', async () => {
  const { db, uno, dos, reiniciar, enviar } = montaje();
  try {
    const inicial = { ...politica(), revision: 0 };
    assert.deepEqual(await uno.prepararPanel(politica()), inicial);
    await abrirSesionDePrueba(uno, acceso('a'));
    await uno.cambiarControlesDeSesion(acceso('a'), 0, { ...politica(), mcp: true });
    const fila = db.prepare('SELECT * FROM administracion_sesion').all();
    const actual = { ...inicial, mcp: true, revision: 1 };
    const preparar = () => dos.prepararPanel({ ...politica(), api: 'deshabilitada' });
    assert.deepEqual(await preparar(), actual);
    reiniciar();
    assert.deepEqual(await preparar(), actual);
    assert.deepEqual(db.prepare('SELECT * FROM administracion_sesion').all(), fila);
    for (const cuerpo of [{}, { politica: politica(), extra: true }, { politica: { ...politica(), mcp: 'si' } }]) {
      assert.equal((await enviar('/panel/preparar', cuerpo)).status, HTTP_INVALIDO);
    }
    assert.deepEqual(db.prepare('SELECT * FROM administracion_sesion').all(), fila);
    db.exec('DELETE FROM administracion_sesion');
    await assert.rejects(preparar(), AlmacenPublicoNoDisponible);
    assert.deepEqual(db.prepare('SELECT * FROM administracion_sesion').all(), []);
  } finally {
    db.close();
  }
});

test('preparación durable adopta controles anteriores sin sustituirlos ni reabrir altas', async () => {
  const { db, uno, dos } = montaje();
  try {
    await uno.activarControles({ ...politica(), api: 'habilitada' });
    const esperado = { ...politica(), api: 'deshabilitada', revision: 1 };
    await uno.cambiarControles(0, { ...politica(), api: 'deshabilitada' });
    assert.deepEqual(await dos.prepararPanel(politica()), esperado);
    assert.equal(db.prepare('SELECT abierto FROM publico_estado').get()?.abierto, 0);
    assert.equal((await abrirSesionDePrueba(dos, acceso('a'))).estado, 'activa');
  } finally {
    db.close();
  }
});
