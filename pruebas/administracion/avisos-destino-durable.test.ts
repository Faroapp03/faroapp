/** El destino de los avisos por el enlace privado real contra SQLite local; no acredita un despliegue en Cloudflare. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { DESTINO_INICIAL } from '../../src/administracion/avisos-destino.ts';
import { DURACION_MAXIMA_SESION_PANEL_MS, INACTIVIDAD_SESION_PANEL_MS } from '../../src/administracion/sesion.ts';
import { AlmacenAvisosDestinoDurable } from '../../src/plataforma/acceso-publico/avisos-destino-cliente-durable.ts';
import {
  AccesoPublicoDurable,
  AlmacenPublicoNoDisponible,
  type EstadoAccesoPublicoDurable,
} from '../../src/plataforma/acceso-publico/durable.ts';
import { SesionUnicaDurable } from '../../src/plataforma/acceso-publico/sesion-unica-cliente-durable.ts';
import type { ValorSql } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { alarmaDurableDePrueba } from '../ayudas/alarma-durable.ts';
import { abrirSesionDePrueba } from '../ayudas/sesion-de-prueba.ts';

const TAM_HUELLA = 64;
const HTTP_INVALIDO = 400;
const CORREO = 'persona@example.org';
/** La revisión que confirma el objeto durable simulado en la prueba del cliente. */
const REVISION_REMOTA = 5;
const POLITICA = { version: 2, api: 'deshabilitada', mcp: false, a2a: false } as const;
const acceso = (letra = 'a') => ({ huellaSesion: letra.repeat(TAM_HUELLA), huellaPrincipal: 'f'.repeat(TAM_HUELLA) });

function montaje(t: TestContext) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
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
  let servidor = new AccesoPublicoDurable(estado, {});
  const espacio = {
    idFromName: () => 'registro-publico-v1',
    get: () => ({ fetch: (r: Request) => servidor.fetch(r) }),
  };
  return {
    db,
    panel: new SesionUnicaDurable(espacio),
    avisos: new AlmacenAvisosDestinoDurable(espacio),
    reiniciar: () => {
      servidor = new AccesoPublicoDurable(estado, {});
    },
    enviar: (ruta: string, cuerpo: unknown) =>
      servidor.fetch(
        new Request(`https://registro-socios.invalid${ruta}`, { method: 'POST', body: JSON.stringify(cuerpo) }),
      ),
  };
}

test('durable: leer vacío, cambiar, conflicto de revisión y quitar persisten entre reinicios', async (t) => {
  const m = montaje(t);
  await m.panel.prepararPanel(POLITICA);
  await abrirSesionDePrueba(m.panel, acceso());
  assert.deepEqual(await m.avisos.leerDestinoParaAvisar(), DESTINO_INICIAL);
  const vacio = await m.avisos.leerDestinoAvisosDeSesion(acceso());
  assert.ok(vacio.estado === 'activa');
  assert.deepEqual(vacio.destino, DESTINO_INICIAL);
  const cambio = await m.avisos.cambiarDestinoAvisosDeSesion(acceso(), 0, 'persona@EXAMPLE.org');
  assert.ok(cambio.estado === 'cambiado');
  assert.equal(cambio.destino.revision, 1);
  assert.equal(cambio.destino.verificacion, 'pendiente');
  assert.equal('correo' in cambio.destino, false);
  m.reiniciar();
  const leido = await m.avisos.leerDestinoAvisosDeSesion(acceso());
  assert.ok(leido.estado === 'activa');
  assert.equal(leido.destino.correo, CORREO);
  assert.equal((await m.avisos.leerDestinoParaAvisar()).correo, CORREO);
  const conflicto = await m.avisos.cambiarDestinoAvisosDeSesion(acceso(), 0, 'otra@example.org');
  assert.ok(conflicto.estado === 'conflicto');
  assert.equal(conflicto.destino.revision, 1);
  const quitado = await m.avisos.quitarDestinoAvisosDeSesion(acceso(), 1);
  assert.ok(quitado.estado === 'cambiado');
  assert.equal(quitado.destino.verificacion, 'sin_destino');
  assert.equal((await m.avisos.leerDestinoParaAvisar()).correo, null);
});

test('durable: una sesión sustituida ni lee ni cambia el destino', async (t) => {
  const m = montaje(t);
  await m.panel.prepararPanel(POLITICA);
  await abrirSesionDePrueba(m.panel, acceso());
  await m.avisos.cambiarDestinoAvisosDeSesion(acceso(), 0, CORREO);
  await abrirSesionDePrueba(m.panel, acceso('b'));
  assert.deepEqual(await m.avisos.leerDestinoAvisosDeSesion(acceso()), { estado: 'sustituida' });
  assert.deepEqual(await m.avisos.cambiarDestinoAvisosDeSesion(acceso(), 1, 'otra@example.org'), {
    estado: 'sustituida',
  });
  assert.deepEqual(await m.avisos.quitarDestinoAvisosDeSesion(acceso(), 1), { estado: 'sustituida' });
  assert.equal((await m.avisos.leerDestinoParaAvisar()).correo, CORREO);
});

test('durable: el protocolo rechaza mensajes fuera de contrato sin llegar al almacén', async (t) => {
  const m = montaje(t);
  await m.panel.prepararPanel(POLITICA);
  await abrirSesionDePrueba(m.panel, acceso());
  for (const [ruta, cuerpo] of [
    ['/avisos/destino', { extra: true }],
    ['/avisos/leer-sesion', {}],
    ['/avisos/cambiar-sesion', { acceso: acceso(), revisionEsperada: 0, correo: `${CORREO}\nBcc: otra@example.org` }],
    ['/avisos/cambiar-sesion', { acceso: acceso(), revisionEsperada: -1, correo: CORREO }],
    ['/avisos/quitar-sesion', { acceso: acceso(), revisionEsperada: '0' }],
  ] as const) {
    assert.equal((await m.enviar(ruta, cuerpo)).status, HTTP_INVALIDO, ruta);
  }
  assert.equal(
    m.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='administracion_avisos_destino'").get()?.n,
    0,
  );
});

test('durable: el cliente no adopta una respuesta que no es la del cambio pedido', async () => {
  const sesion = {
    estado: 'activa',
    iniciadaEn: 1,
    ultimaActividadEn: 1,
    caducaPorInactividadEn: 1 + INACTIVIDAD_SESION_PANEL_MS,
    caducaAbsolutaEn: 1 + DURACION_MAXIMA_SESION_PANEL_MS,
  };
  const resumen = { version: 1, revision: REVISION_REMOTA, cambiadoEn: 1, verificacion: 'pendiente' };
  const cliente = new AlmacenAvisosDestinoDurable({
    idFromName: () => 'registro-publico-v1',
    get: () => ({ fetch: async () => Response.json({ estado: 'cambiado', sesion, destino: resumen }) }),
  });
  assert.equal((await cliente.cambiarDestinoAvisosDeSesion(acceso(), REVISION_REMOTA - 1, CORREO)).estado, 'cambiado');
  await assert.rejects(cliente.cambiarDestinoAvisosDeSesion(acceso(), 0, CORREO), AlmacenPublicoNoDisponible);
  await assert.rejects(cliente.quitarDestinoAvisosDeSesion(acceso(), REVISION_REMOTA - 1), AlmacenPublicoNoDisponible);
  await assert.rejects(cliente.leerDestinoParaAvisar(), AlmacenPublicoNoDisponible);
  await assert.rejects(cliente.cambiarDestinoAvisosDeSesion(acceso(), 0, 'Persona <persona@example.org>'));
});
