/**
 * Estado de los avisos por canal, de punta a punta en el objeto durable: el correo según el enlace, el remitente y la
 * dirección guardada; la URL según `FARO_AVISO_URL`; y el último intento de cada uno, sin la dirección en ningún sitio.
 */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import {
  leerEnviosPorCanal,
  type MotivoFalloCanalCorreo,
  resultadoDeLosCanales,
} from '../../src/administracion/envio-por-canal.ts';
import { MOTIVOS_FALLO_CORREO_PANEL } from '../../src/administracion/vigilante-panel.js';
import { AlmacenAvisosDestinoDurable } from '../../src/plataforma/acceso-publico/avisos-destino-cliente-durable.ts';
import { AccesoPublicoDurable, type EstadoAccesoPublicoDurable } from '../../src/plataforma/acceso-publico/durable.ts';
import {
  estadoAvisosDeLaLectura,
  estadoCanalCorreo,
} from '../../src/plataforma/acceso-publico/estado-canales-aviso.ts';
import type { ValorSql } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { AlmacenVigilanteDurable } from '../../src/plataforma/acceso-publico/vigilante-cliente-durable.ts';
import { crearAvisoProgramado } from '../../src/plataforma/aviso-programado.ts';
import { crearAvisoInicioRechazado } from '../../src/plataforma/cloudflare/aviso-inicio-rechazado.ts';
import { abrirSesionDePrueba } from '../ayudas/sesion-de-prueba.ts';
import { CONFIG_VIGILANTE } from '../ayudas/vigilante.ts';

const CORREO = 'persona@example.org';
const LONGITUD_HUELLA = 64;
const SEGUNDO_MS = 1000;
const acceso = { huellaSesion: 'a'.repeat(LONGITUD_HUELLA), huellaPrincipal: 'b'.repeat(LONGITUD_HUELLA) };
const ENLACE = { send: async () => ({ messageId: 'falso' }) };
const CORREO_LISTO = {
  AVISOS_CORREO: ENLACE,
  FARO_ADMIN_ORIGEN: 'https://faro.example.org',
  FARO_AVISO_REMITENTE: 'avisos@faro.example.org',
};
const SIGUIENTE = { estado: 'resuelto', desde: 1, enviadoEn: 1, incidencias: [] } as const;

function estadoEnMemoria(t: TestContext, db = new DatabaseSync(':memory:')): EstadoAccesoPublicoDurable {
  t.after(() => db.close());
  return {
    storage: {
      sql: { exec: (sql: string, ...valores: ValorSql[]) => ({ toArray: () => db.prepare(sql).all(...valores) }) },
      transactionSync: <T>(accion: () => T): T => {
        db.exec('BEGIN IMMEDIATE');
        try {
          const r = accion();
          db.exec('COMMIT');
          return r;
        } catch (e) {
          db.exec('ROLLBACK');
          throw e;
        }
      },
    },
  };
}
/** El objeto durable con el entorno del Worker: las variables y, si se da, el enlace de correo. */
async function montar(t: TestContext, entorno: Readonly<Record<string, unknown>>, db = new DatabaseSync(':memory:')) {
  const variables = {
    FARO_VIGILANTE: JSON.stringify({ ...CONFIG_VIGILANTE, activadoEn: Date.now() - SEGUNDO_MS }),
    ...entorno,
  };
  const servidor = new AccesoPublicoDurable(estadoEnMemoria(t, db), variables as Record<string, string>);
  const espacio = { idFromName: () => 'registro-publico-v1', get: () => servidor };
  const vigilante = new AlmacenVigilanteDurable(espacio);
  const destino = new AlmacenAvisosDestinoDurable(espacio);
  await vigilante.prepararPanel({ version: 2, api: 'deshabilitada', mcp: false, a2a: false });
  await vigilante.prepararTrabajos();
  await vigilante.prepararActivacion();
  await abrirSesionDePrueba(vigilante, acceso);
  await vigilante.prepararVigilanteDeSesion(acceso);
  const avisos = async () => {
    const r = await vigilante.comprobarVigilanteDeSesion(acceso);
    assert.equal(r.estado, 'activa');
    assert.ok(!JSON.stringify(r).includes(CORREO), 'La dirección no sale en el estado del vigilante');
    return r.estado === 'activa' ? r.vigilante.avisos : undefined;
  };
  return { vigilante, destino, avisos };
}

test('el correo dice si falta el enlace o el remitente, antes de mirar la dirección', () => {
  assert.equal(estadoCanalCorreo({ ...CORREO_LISTO, AVISOS_CORREO: undefined }, 'verificado'), 'no-configurado');
  assert.equal(estadoCanalCorreo({ ...CORREO_LISTO, AVISOS_CORREO: 'texto' } as never, 'verificado'), 'no-configurado');
  assert.equal(
    estadoCanalCorreo({ ...CORREO_LISTO, FARO_AVISO_REMITENTE: '' } as never, 'verificado'),
    'no-configurado',
  );
  assert.equal(
    estadoCanalCorreo({ ...CORREO_LISTO, FARO_ADMIN_ORIGEN: undefined } as never, 'pendiente'),
    'no-configurado',
  );
  const ajeno = { ...CORREO_LISTO, FARO_AVISO_REMITENTE: 'avisos@otro.example.org' };
  assert.equal(estadoCanalCorreo(ajeno as never, 'verificado'), 'remitente-no-admitido');
  assert.equal(estadoCanalCorreo(CORREO_LISTO as never, 'sin_destino'), 'sin-destino');
  assert.equal(estadoCanalCorreo(CORREO_LISTO as never, 'pendiente'), 'pendiente');
  assert.equal(estadoCanalCorreo(CORREO_LISTO as never, 'verificado'), 'verificado');
});

test('sin enlace ni URL no viaja nada; con enlace, el correo pasa por sin dirección, pendiente y verificada', async (t) => {
  const sinNada = await montar(t, {});
  assert.equal(await sinNada.avisos(), undefined);
  const f = await montar(t, CORREO_LISTO);
  const sinCanal = { canal: 'correo', ultimoIntento: null };
  assert.deepEqual(await f.avisos(), { canales: [{ ...sinCanal, estado: 'sin-destino' }] });
  const cambio = await f.destino.cambiarDestinoAvisosDeSesion(acceso, 0, CORREO);
  assert.equal(cambio.estado, 'cambiado');
  assert.deepEqual(await f.avisos(), { canales: [{ ...sinCanal, estado: 'pendiente' }] });
  await f.destino.verificarDestinoAvisosDeSesion(acceso, 1, CORREO);
  assert.deepEqual(await f.avisos(), { canales: [{ ...sinCanal, estado: 'verificado' }] });
});

test('cada canal guarda su propio intento: los dos canales, cada motivo del correo y lo avisado compartido', async (t) => {
  const f = await montar(t, { ...CORREO_LISTO, FARO_AVISO_URL: 'https://avisos.example/faro' });
  await f.destino.cambiarDestinoAvisosDeSesion(acceso, 0, CORREO);
  for (const motivo of MOTIVOS_FALLO_CORREO_PANEL) {
    const canales = [
      { canal: 'correo', envio: { resultado: 'fallido', motivo: motivo as MotivoFalloCanalCorreo } },
      { canal: 'url', envio: { resultado: 'enviado' } },
    ] as const;
    const envio = resultadoDeLosCanales(canales);
    assert.deepEqual(envio, { resultado: 'enviado' }, 'Basta con que un canal entregue');
    await f.vigilante.registrarEnvioAviso({ envio, siguiente: SIGUIENTE, canales });
    const avisos = await f.avisos();
    assert.equal(avisos?.canales.length, 2);
    const [correo, url] = avisos?.canales ?? [];
    assert.deepEqual([correo?.canal, correo?.estado, correo?.ultimoIntento?.motivo], ['correo', 'pendiente', motivo]);
    assert.deepEqual([url?.canal, url?.estado, url?.ultimoIntento?.resultado], ['url', 'configurados', 'enviado']);
  }
  // Un aviso que solo intenta la URL conserva el último intento del correo.
  const soloUrl = [{ canal: 'url', envio: { resultado: 'fallido', motivo: 'sin-respuesta' } }] as const;
  await f.vigilante.registrarEnvioAviso({
    envio: resultadoDeLosCanales(soloUrl),
    siguiente: SIGUIENTE,
    canales: soloUrl,
  });
  const [correo, url] = (await f.avisos())?.canales ?? [];
  assert.equal(correo?.ultimoIntento?.motivo, 'destino-no-admitido');
  assert.equal(url?.ultimoIntento?.motivo, 'sin-respuesta');
});

test('un registro sin canales, como el de antes de los intentos por canal, se lee como intento de la URL', async (t) => {
  const f = await montar(t, { FARO_AVISO_URL: 'https://avisos.example/faro' });
  await f.vigilante.registrarEnvioAviso({
    envio: { resultado: 'fallido', motivo: 'plazo-agotado' },
    siguiente: SIGUIENTE,
  });
  const avisos = await f.avisos();
  assert.equal(avisos?.canales.length, 1);
  assert.deepEqual(
    [avisos?.canales[0]?.canal, avisos?.canales[0]?.estado, avisos?.canales[0]?.ultimoIntento?.motivo],
    ['url', 'configurados', 'plazo-agotado'],
  );
});

test('los envíos por canal solo admiten los motivos de su canal y cada canal una vez', () => {
  const correo = { canal: 'correo', envio: { resultado: 'fallido', motivo: 'limite-alcanzado' } } as const;
  assert.equal(leerEnviosPorCanal([correo]).length, 1);
  for (const malo of [
    [],
    [{ canal: 'url', envio: { resultado: 'fallido', motivo: 'limite-alcanzado' } }],
    [{ canal: 'correo', envio: { resultado: 'fallido', motivo: `E_RATE ${CORREO}` } }],
    [correo, correo],
    [{ canal: 'sms', envio: { resultado: 'enviado' } }],
    [{ canal: 'correo', envio: { resultado: 'enviado', motivo: null } }],
  ]) {
    assert.throws(() => leerEnviosPorCanal(malo));
  }
  // Si ningún canal entrega, cuenta el primero, con el detalle del correo agrupado en los motivos de siempre.
  assert.deepEqual(resultadoDeLosCanales([correo]), { resultado: 'fallido', motivo: 'respuesta-no-admitida' });
});

test('con el correo como único canal, un inicio rechazado se avisa en el momento y una sola vez', async (t) => {
  const f = await montar(t, CORREO_LISTO);
  await f.destino.cambiarDestinoAvisosDeSesion(acceso, 0, CORREO);
  await f.destino.verificarDestinoAvisosDeSesion(acceso, 1, CORREO);
  const enviados: unknown[] = [];
  const canal = {
    remitente: CORREO_LISTO.FARO_AVISO_REMITENTE,
    enlace: { send: async (mensaje: unknown) => enviados.push(mensaje) },
  };
  const avisar = crearAvisoProgramado({
    autoridad: f.vigilante,
    destino: () => undefined,
    panel: 'https://faro.example.org/administracion/',
    correo: { canal, destino: () => f.destino.leerDestinoParaAvisar() },
  });
  // Sin el canal de correo declarado, sin URL no se avisa nada en el momento.
  await crearAvisoInicioRechazado(avisar, () => undefined)();
  assert.equal(enviados.length, 0);
  const avisarRechazo = crearAvisoInicioRechazado(avisar, () => undefined, true);
  await avisarRechazo();
  await avisarRechazo();
  assert.equal(enviados.length, 1, 'La misma incidencia no se repite: comparte la memoria de lo ya avisado');
  const [correo] = (await f.avisos())?.canales ?? [];
  assert.deepEqual([correo?.estado, correo?.ultimoIntento?.resultado], ['verificado', 'enviado']);
});

/** Todo lo que guardan el vigilante y los avisos, para comprobar que una lectura no cambia nada. */
function fotoDeLaAutoridad(db: DatabaseSync) {
  const tablas = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'administracion_vigilante%' OR name LIKE 'administracion_avisos%') ORDER BY name",
    )
    .all()
    .map((fila) => String(fila.name));
  return JSON.stringify(tablas.map((tabla) => [tabla, db.prepare(`SELECT * FROM ${tabla}`).all()]));
}

test('la lectura de la tarjeta trae el estado de cada canal y el último intento, sin la dirección y sin escribir nada', async (t) => {
  const db = new DatabaseSync(':memory:');
  const f = await montar(t, CORREO_LISTO, db);
  await f.destino.cambiarDestinoAvisosDeSesion(acceso, 0, CORREO);
  await f.destino.verificarDestinoAvisosDeSesion(acceso, 1, CORREO);
  const canales = [{ canal: 'correo', envio: { resultado: 'fallido', motivo: 'rechazo-del-destino' } }] as const;
  await f.vigilante.registrarEnvioAviso({ envio: resultadoDeLosCanales(canales), siguiente: SIGUIENTE, canales });
  const antes = fotoDeLaAutoridad(db);
  const lectura = await f.destino.leerDestinoAvisosDeSesion(acceso);
  assert.equal(fotoDeLaAutoridad(db), antes, 'Leer no anota decisiones ni toca el registro de avisos ni la dirección');
  assert.equal(lectura.estado, 'activa');
  if (lectura.estado !== 'activa') {
    return;
  }
  assert.equal(lectura.destino.correo, CORREO);
  assert.equal(lectura.avisos?.comprobaciones, 'activas');
  const [correo, url] = lectura.avisos?.canales ?? [];
  assert.deepEqual(
    [correo?.canal, correo?.estado, correo?.ultimoIntento?.motivo],
    ['correo', 'verificado', 'rechazo-del-destino'],
  );
  assert.deepEqual([url?.canal, url?.estado, url?.ultimoIntento], ['url', 'no-configurados', null]);
  assert.ok(!JSON.stringify(lectura.avisos).includes('@'), 'El bloque de los canales no lleva la dirección');
});

test('sin vigilante habilitado, la lectura dice que las comprobaciones automáticas están desactivadas', () => {
  const entrada = {
    verificacion: 'pendiente',
    registro: { avisado: null, ultimoIntento: null },
    porCanal: {},
  } as const;
  assert.equal(estadoAvisosDeLaLectura({ ...entrada, variables: {} }).comprobaciones, 'desactivadas');
  const apagado = { FARO_VIGILANTE: JSON.stringify({ ...CONFIG_VIGILANTE, habilitado: false }) };
  assert.equal(estadoAvisosDeLaLectura({ ...entrada, variables: apagado }).comprobaciones, 'desactivadas');
  const encendido = { FARO_VIGILANTE: JSON.stringify({ ...CONFIG_VIGILANTE, activadoEn: Date.now() - SEGUNDO_MS }) };
  assert.equal(estadoAvisosDeLaLectura({ ...entrada, variables: encendido }).comprobaciones, 'activas');
  assert.equal(estadoAvisosDeLaLectura({ ...entrada, variables: { FARO_VIGILANTE: '{' } }).comprobaciones, 'activas');
});
