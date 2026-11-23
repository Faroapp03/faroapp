/** Binding privado completo con SQLite real; interceptores solo alteran el transporte de respuestas reales. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import type { PoliticaControles } from '../../src/administracion/controles.ts';
import { leerObservacionDatosTrabajo, MAX_OBSERVACION_DATOS_BYTES } from '../../src/administracion/datos-trabajo.ts';
import { type EstadoDatosPanel, leerEstadoDatosPanel } from '../../src/administracion/estado-datos.js';
import type { ConfianzaOidcGitHub, IdentidadEjecucionGitHub } from '../../src/administracion/oidc-github.ts';
import type { ReciboTrabajo } from '../../src/administracion/trabajos.ts';
import { MAX_RESPUESTA_DATOS_PANEL_DURABLE } from '../../src/plataforma/acceso-publico/datos-panel-durable.ts';
import {
  AccesoPublicoDurable,
  AlmacenPublicoNoDisponible,
  type EspacioAccesoPublicoDurable,
  type EstadoAccesoPublicoDurable,
} from '../../src/plataforma/acceso-publico/durable.ts';
import { SesionUnicaDurable } from '../../src/plataforma/acceso-publico/sesion-unica-cliente-durable.ts';
import type { ValorSql } from '../../src/plataforma/acceso-publico/sqlite.ts';
import {
  MAX_MENSAJE_RECIBO_DURABLE,
  MAX_MENSAJE_TRABAJO_DURABLE,
  MAX_RESPUESTA_TRABAJO_DURABLE,
} from '../../src/plataforma/acceso-publico/trabajos-durable.ts';
import { catalogoPrivado } from '../ayudas/catalogo-privado.ts';
import { objeto } from '../ayudas/objeto-json.ts';
import { abrirSesionDePrueba } from '../ayudas/sesion-de-prueba.ts';

const TAM_HUELLA = 64;
const TAM_SHA = 40;
const TAM_VERSION = 16;
const ULTIMO_BYTE_UTF8 = 0xc3;
const HUELLA = 'e'.repeat(TAM_HUELLA);
const ID = '11111111-1111-4111-8111-111111111111';
const SEGUNDO = 1000;
const VALIDEZ_S = 60;
const NUM_FUENTES = 60;
const PLAZO_MS = 20;
const HTTP_CORRECTO = 200;
const HTTP_INVALIDO = 400;
const ACCESO = { huellaSesion: 'a'.repeat(TAM_HUELLA), huellaPrincipal: 'b'.repeat(TAM_HUELLA) };
const SOLICITUD = { solicitudId: ID, accion: 'actualizar-datos', revisionEsperada: 0 } as const;
const INICIO = { solicitudId: ID, accion: 'actualizar-datos', revisionReserva: 1 } as const;
const CONFIANZA: ConfianzaOidcGitHub = {
  audiencia: 'https://recibos.prueba',
  repositorioId: '123',
  propietarioId: '456',
  ref: 'refs/heads/main',
  workflowRef: 'equipo/fuente/.github/workflows/actualizar.yml@refs/heads/main',
  sha: 'a'.repeat(TAM_SHA),
  workflowSha: 'b'.repeat(TAM_SHA),
};
const ENTORNO = {};
const POLITICA: PoliticaControles = {
  version: 2,
  api: 'habilitada',
  mcp: false,
  a2a: false,
};
function identidad(): IdentidadEjecucionGitHub {
  const { audiencia: _audiencia, ...pins } = CONFIANZA;
  const emitidoEn = Math.floor(Date.now() / SEGUNDO);
  return { ...pins, runId: '789', runAttempt: '1', jti: 'sintético', emitidoEn, caducaEn: emitidoEn + VALIDEZ_S };
}
function recibo(): ReciboTrabajo {
  return {
    ...INICIO,
    resultado: 'validado',
    veredicto: 'verde',
    error: null,
    huellaPaquete: 'f'.repeat(TAM_VERSION),
    terminadoEn: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
}
function datos(terminadoEn: string): EstadoDatosPanel {
  const ids = Array.from({ length: NUM_FUENTES }, (_, n) => `fuente_${n}`);
  return leerEstadoDatosPanel({
    version: 1,
    observadoEn: terminadoEn,
    formacionAbiertaCaduca: null,
    fuentes: ids.map((id) => ({ id, politica: 'edición', fecha: '2026-10-16', plazoDias: null })),
    modulos: [...ids, 'paquete'].map((id) => ({
      id,
      ultimoIntento: terminadoEn,
      veredicto: 'verde',
      ultimaVersionBuena: { fecha: terminadoEn, huella: HUELLA },
      fallos: 0,
      proximoReintento: null,
    })),
  });
}
function transaccion<T>(db: DatabaseSync, accion: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const resultado = accion();
    db.exec('COMMIT');
    return resultado;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
function montaje(t: test.TestContext) {
  const db = new DatabaseSync(':memory:');
  let consultas = 0;
  const estado: EstadoAccesoPublicoDurable = {
    storage: {
      sql: {
        exec: (sql: string, ...valores: ValorSql[]) => ({
          toArray: () => {
            consultas++;
            return db.prepare(sql).all(...valores);
          },
        }),
      },
      transactionSync: <T>(accion: () => T) => transaccion(db, accion),
    },
  };
  let servidor = new AccesoPublicoDurable(estado, ENTORNO);
  const fetch = (p: Request) => servidor.fetch(p);
  const espacio: EspacioAccesoPublicoDurable = { idFromName: (n) => n, get: () => ({ fetch }) };
  t.after(() => db.close());
  return {
    db,
    fetch,
    espacio,
    cliente: new SesionUnicaDurable(espacio),
    consultas: () => consultas,
    reiniciar: () => {
      servidor = new AccesoPublicoDurable(estado, ENTORNO);
    },
  };
}
async function preparar(m: ReturnType<typeof montaje>) {
  await m.cliente.prepararPanel(POLITICA);
  await abrirSesionDePrueba(m.cliente, ACCESO);
  await m.cliente.prepararTrabajos();
  assert.equal(await m.cliente.leerDatosDelUltimoTrabajo(), null);
  await m.cliente.reservarTrabajoDeSesion(ACCESO, SOLICITUD, CONFIANZA);
  await m.cliente.confirmarInicio(INICIO, identidad());
}
function clienteInterceptado(m: ReturnType<typeof montaje>, transformar: (r: Response) => Promise<Response>) {
  return new SesionUnicaDurable(
    {
      idFromName: (n) => n,
      get: () => ({
        fetch: async (p) => transformar(await m.fetch(p)),
      }),
    },
    { tiempoLimiteMs: PLAZO_MS },
  );
}
function peticion(ruta: string, texto: string) {
  return new Request(`https://registro-socios.invalid${ruta}`, { method: 'POST', body: texto });
}

test('una instantánea mayor que 8 KiB atraviesa recibo y lectura privada, persiste y desaparece ante siguiente reserva', async (t) => {
  const m = montaje(t);
  await preparar(m);
  const r = recibo();
  const estado = datos(r.terminadoEn);
  assert.ok(Buffer.byteLength(JSON.stringify(estado)) > MAX_MENSAJE_TRABAJO_DURABLE);
  assert.equal((await m.cliente.registrarRecibo(r, HUELLA, identidad(), estado)).estado, 'aplicado');
  const esperado = { version: 1, recibo: r, huellaRecibo: HUELLA, datos: estado };
  assert.deepEqual(await m.cliente.leerDatosDelUltimoTrabajo(), esperado);
  m.reiniciar();
  assert.deepEqual(await new SesionUnicaDurable(m.espacio).leerDatosDelUltimoTrabajo(), esperado);
  const revisionEsperada = (await m.cliente.leerTrabajoPrivado()).revision;
  await m.cliente.reservarTrabajoDeSesion(
    ACCESO,
    { ...SOLICITUD, solicitudId: '22222222-2222-4222-8222-222222222222', revisionEsperada },
    CONFIANZA,
  );
  assert.equal(await m.cliente.leerDatosDelUltimoTrabajo(), null);
});

test('el panel recibe por el objeto durable los datos anteriores, marcados, mientras corre la siguiente actualización', async (t) => {
  const m = montaje(t);
  await preparar(m);
  assert.equal(await m.cliente.leerDatosDelPanel(), null);
  const r = recibo();
  const estado = datos(r.terminadoEn);
  assert.ok(Buffer.byteLength(JSON.stringify(estado)) > MAX_RESPUESTA_TRABAJO_DURABLE);
  await m.cliente.registrarRecibo(r, HUELLA, identidad(), estado);
  const observacion = { version: 1, recibo: r, huellaRecibo: HUELLA, datos: estado };
  assert.deepEqual(await m.cliente.leerDatosDelPanel(), { observacion, deLaActualizacionAnterior: false });
  const revisionEsperada = (await m.cliente.leerTrabajoPrivado()).revision;
  await m.cliente.reservarTrabajoDeSesion(
    ACCESO,
    { ...SOLICITUD, solicitudId: '22222222-2222-4222-8222-222222222222', revisionEsperada },
    CONFIANZA,
  );
  assert.equal(await m.cliente.leerDatosDelUltimoTrabajo(), null);
  const anterior = { observacion, deLaActualizacionAnterior: true };
  assert.deepEqual(await m.cliente.leerDatosDelPanel(), anterior);
  m.reiniciar();
  assert.deepEqual(await new SesionUnicaDurable(m.espacio).leerDatosDelPanel(), anterior);
});

test('la respuesta del panel durable se lee cerrada: marca booleana y sin campos de más', async (t) => {
  const m = montaje(t);
  await preparar(m);
  const r = recibo();
  await m.cliente.registrarRecibo(r, HUELLA, identidad(), datos(r.terminadoEn));
  const alterar = (cambio: (o: Record<string, unknown>) => object) =>
    clienteInterceptado(m, async (respuesta) => Response.json(cambio(objeto(await respuesta.json()))));
  const marcaTexto = alterar((o) => ({ ...o, deLaActualizacionAnterior: 'no' }));
  await assert.rejects(marcaTexto.leerDatosDelPanel(), AlmacenPublicoNoDisponible);
  const sinMarca = alterar(({ deLaActualizacionAnterior: _marca, ...o }) => o);
  await assert.rejects(sinMarca.leerDatosDelPanel(), AlmacenPublicoNoDisponible);
  const conDeMas = alterar((o) => ({ ...o, motivo: 'reserva' }));
  await assert.rejects(conDeMas.leerDatosDelPanel(), AlmacenPublicoNoDisponible);
  const salidaGrande = clienteInterceptado(
    m,
    async (respuesta) => new Response(`${' '.repeat(MAX_RESPUESTA_DATOS_PANEL_DURABLE)}${await respuesta.text()}`),
  );
  await assert.rejects(salidaGrande.leerDatosDelPanel(), AlmacenPublicoNoDisponible);
  assert.equal((await m.cliente.leerDatosDelPanel())?.deLaActualizacionAnterior, false);
});

test('pérdida de respuesta tras commit permite reintento exacto sin sustituir datos', async (t) => {
  const m = montaje(t);
  await preparar(m);
  const r = recibo();
  const estado = datos(r.terminadoEn);
  const perder = clienteInterceptado(m, async () => {
    throw new Error('respuesta perdida');
  });
  await assert.rejects(perder.registrarRecibo(r, HUELLA, identidad(), estado), AlmacenPublicoNoDisponible);
  const antes = await m.cliente.leerDatosDelUltimoTrabajo();
  assert.equal((await m.cliente.registrarRecibo(r, HUELLA, identidad(), estado)).estado, 'repetido');
  assert.deepEqual(await m.cliente.leerDatosDelUltimoTrabajo(), antes);
  const distinto = leerEstadoDatosPanel({ ...estado, fuentes: estado.fuentes.map((f) => ({ ...f, fecha: null })) });
  assert.equal((await m.cliente.registrarRecibo(r, HUELLA, identidad(), distinto)).estado, 'conflicto');
  assert.deepEqual(await m.cliente.leerDatosDelUltimoTrabajo(), antes);
});

test('recibo antiguo sin estado sigue válido; null explícito exige rechazo admisible', async (t) => {
  const m = montaje(t);
  await preparar(m);
  const r = recibo();
  assert.equal((await m.cliente.registrarRecibo(r, HUELLA, identidad())).estado, 'aplicado');
  assert.equal(await m.cliente.leerDatosDelUltimoTrabajo(), null);
  const n = montaje(t);
  await preparar(n);
  const rechazado = {
    ...r,
    resultado: 'rechazado',
    veredicto: null,
    huellaPaquete: null,
    error: 'actualizacion_no_completada',
  } as const;
  assert.equal((await n.cliente.registrarRecibo(rechazado, HUELLA, identidad(), null)).estado, 'aplicado');
  assert.equal(await n.cliente.leerDatosDelUltimoTrabajo(), null);
});

test('contrato cerrado de datos e instantáneas inválidas se rechazan sin SQL ni transporte cliente', async (t) => {
  const m = montaje(t);
  await preparar(m);
  const r = recibo();
  const cuerpo = { recibo: r, huellaRecibo: HUELLA, identidad: identidad() };
  for (const [ruta, valor] of [
    ['/trabajos/datos', { acceso: ACCESO }],
    ['/trabajos/recibo', { ...cuerpo, estado: null }],
    ['/trabajos/recibo', { ...cuerpo, estado: datos(r.terminadoEn), extra: true }],
    ['/trabajos/recibo', { ...cuerpo, estado: { ...datos(r.terminadoEn), observadoEn: '2099-01-01T00:00:00Z' } }],
  ] as const) {
    const antes = m.consultas();
    assert.equal((await m.fetch(peticion(ruta, JSON.stringify(valor)))).status, HTTP_INVALIDO);
    assert.equal(m.consultas(), antes);
  }
  const antes = m.consultas();
  await assert.rejects(m.cliente.registrarRecibo(r, HUELLA, identidad(), null));
  assert.equal(m.consultas(), antes);
});

test('solo recibo admite entrada grande; límites usan bytes UTF8 y rechazan antes de SQL', async (t) => {
  const m = montaje(t);
  await preparar(m);
  const r = recibo();
  const texto = JSON.stringify({
    recibo: r,
    huellaRecibo: HUELLA,
    identidad: identidad(),
    estado: datos(r.terminadoEn),
  });
  const exacto = texto + ' '.repeat(MAX_MENSAJE_RECIBO_DURABLE - Buffer.byteLength(texto));
  assert.equal((await m.fetch(peticion('/trabajos/recibo', exacto))).status, HTTP_CORRECTO);
  const unicode = texto + ' '.repeat(MAX_MENSAJE_RECIBO_DURABLE - texto.length);
  assert.ok(unicode.length <= MAX_MENSAJE_RECIBO_DURABLE && Buffer.byteLength(unicode) > MAX_MENSAJE_RECIBO_DURABLE);
  const antes = m.consultas();
  assert.equal((await m.fetch(peticion('/trabajos/recibo', unicode))).status, HTTP_INVALIDO);
  for (const ruta of ['/trabajos/datos', '/trabajos/privado', '/trabajos/inicio']) {
    assert.equal((await m.fetch(peticion(ruta, `${' '.repeat(MAX_MENSAJE_TRABAJO_DURABLE)}{}`))).status, HTTP_INVALIDO);
  }
  assert.equal(m.consultas(), antes);
});

test('lectura valida envelope, truncamiento y UTF8; otras respuestas mantienen 8 KiB', async (t) => {
  const m = montaje(t);
  await preparar(m);
  const r = recibo();
  await m.cliente.registrarRecibo(r, HUELLA, identidad(), datos(r.terminadoEn));
  const antes = await m.cliente.leerDatosDelUltimoTrabajo();
  const corrupto = clienteInterceptado(m, async (respuesta) => {
    const o = leerObservacionDatosTrabajo(await respuesta.json());
    return Response.json({ ...o, huellaRecibo: 'corrupta' });
  });
  await assert.rejects(corrupto.leerDatosDelUltimoTrabajo(), AlmacenPublicoNoDisponible);
  const truncado = clienteInterceptado(m, async (respuesta) => new Response((await respuesta.text()).slice(0, -1)));
  await assert.rejects(truncado.leerDatosDelUltimoTrabajo(), AlmacenPublicoNoDisponible);
  const utf8Roto = clienteInterceptado(m, async () => new Response(new Uint8Array([ULTIMO_BYTE_UTF8])));
  await assert.rejects(utf8Roto.leerDatosDelUltimoTrabajo(), AlmacenPublicoNoDisponible);
  const salidaGrande = clienteInterceptado(
    m,
    async (respuesta) => new Response(`${' '.repeat(MAX_RESPUESTA_TRABAJO_DURABLE)}${await respuesta.text()}`),
  );
  await assert.rejects(salidaGrande.leerTrabajoPrivado(), AlmacenPublicoNoDisponible);
  assert.deepEqual(await m.cliente.leerDatosDelUltimoTrabajo(), antes);
});

test('límite mayor de datos cuenta bytes y plazo corta respuesta que nunca termina', async (t) => {
  const m = montaje(t);
  await preparar(m);
  const r = recibo();
  await m.cliente.registrarRecibo(r, HUELLA, identidad(), datos(r.terminadoEn));
  const exacto = clienteInterceptado(m, async (respuesta) => {
    const texto = await respuesta.text();
    return new Response(texto + ' '.repeat(MAX_OBSERVACION_DATOS_BYTES - Buffer.byteLength(texto)));
  });
  assert.deepEqual(await exacto.leerDatosDelUltimoTrabajo(), await m.cliente.leerDatosDelUltimoTrabajo());
  const excesivo = clienteInterceptado(m, async (respuesta) => {
    const texto = await respuesta.text();
    return new Response(texto + ' '.repeat(MAX_OBSERVACION_DATOS_BYTES - texto.length));
  });
  await assert.rejects(excesivo.leerDatosDelUltimoTrabajo(), AlmacenPublicoNoDisponible);
  let cancelado = false;
  const bloqueado = clienteInterceptado(
    m,
    async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelado = true;
          },
        }),
      ),
  );
  await assert.rejects(bloqueado.leerDatosDelUltimoTrabajo(), AlmacenPublicoNoDisponible);
  assert.equal(cancelado, true);
});

test('corrupción persistida no vuelve null ni oculta el defecto al reiniciar Durable', async (t) => {
  const m = montaje(t);
  await preparar(m);
  const r = recibo();
  await m.cliente.registrarRecibo(r, HUELLA, identidad(), datos(r.terminadoEn));
  const fila = m.db.prepare('SELECT documento,sha FROM administracion_datos_trabajo WHERE id=1').get();
  assert.ok(fila && typeof fila.documento === 'string' && typeof fila.sha === 'string');
  for (const [documento, sha] of [
    ['{', fila.sha],
    [fila.documento, 'c'.repeat(TAM_SHA)],
    [JSON.stringify({ ...JSON.parse(fila.documento), huellaRecibo: 'd'.repeat(TAM_HUELLA) }), fila.sha],
  ] as const) {
    m.db.prepare('UPDATE administracion_datos_trabajo SET documento=?,sha=? WHERE id=1').run(documento, sha);
    m.reiniciar();
    await assert.rejects(m.cliente.leerDatosDelUltimoTrabajo(), AlmacenPublicoNoDisponible);
  }
  m.db.prepare('UPDATE administracion_datos_trabajo SET documento=?,sha=? WHERE id=1').run(fila.documento, fila.sha);
  assert.deepEqual((await m.cliente.leerDatosDelUltimoTrabajo())?.datos, datos(r.terminadoEn));
});

test('UTF8 fragmentado dentro de carácter mantiene la instantánea íntegra', async (t) => {
  const m = montaje(t);
  await preparar(m);
  const r = recibo();
  await m.cliente.registrarRecibo(r, HUELLA, identidad(), datos(r.terminadoEn));
  const fragmentado = clienteInterceptado(m, async (respuesta) => {
    const bytes = new Uint8Array(await respuesta.arrayBuffer());
    const corte = bytes.indexOf(ULTIMO_BYTE_UTF8) + 1;
    assert.ok(corte > 0);
    return new Response(
      new ReadableStream({
        start(control) {
          control.enqueue(bytes.slice(0, corte));
          control.enqueue(bytes.slice(corte));
          control.close();
        },
      }),
    );
  });
  assert.deepEqual(await fragmentado.leerDatosDelUltimoTrabajo(), await m.cliente.leerDatosDelUltimoTrabajo());
});

test('evidencia v2 conserva su ciclo, huella y fecha tras reiniciar Durable y reenviar el recibo', async (t) => {
  const m = montaje(t);
  await preparar(m);
  const r = recibo();
  const estado = leerEstadoDatosPanel(
    JSON.parse(readFileSync(new URL('../fixtures/estado-datos-v2.json', import.meta.url), 'utf8')),
  );
  assert.equal((await m.cliente.registrarRecibo(r, HUELLA, identidad(), estado)).estado, 'aplicado');
  const antes = await m.cliente.leerDatosDelUltimoTrabajo();
  assert.deepEqual(antes?.datos, estado);
  m.reiniciar();
  assert.deepEqual(await m.cliente.leerDatosDelUltimoTrabajo(), antes);
  assert.equal((await m.cliente.registrarRecibo(r, HUELLA, identidad(), estado)).estado, 'repetido');
  assert.deepEqual(await m.cliente.leerDatosDelUltimoTrabajo(), antes);
});

test('v4 conserva catálogo y desconocidos al reiniciar Durable y repetir el recibo', async (t) => {
  const m = montaje(t);
  await preparar(m);
  const r = recibo();
  const base = datos(r.terminadoEn);
  const estado = leerEstadoDatosPanel({
    ...base,
    version: 4,
    fuentes: base.fuentes.map((f) => ({ ...f, ultimaOperacion: null })),
    comprobaciones: {
      registradoEn: null,
      reconstruccionPendiente: false,
      conjuntos: base.fuentes.map((f) => ({
        id: f.id,
        fuente: f.id,
        alcance: 'copia-local',
        operacion: 'integridad',
        intervaloDias: null,
        revisionNecesaria: false,
        ultimaComprobacion: null,
      })),
    },
    seguimientoRemoto: null,
    catalogoFuentes: base.fuentes.map((f) => ({ id: f.id, nombre: f.id, tema: 'comun', modalidad: 'operativa' })),
  });
  assert.equal((await m.cliente.registrarRecibo(r, HUELLA, identidad(), estado)).estado, 'aplicado');
  const antes = await m.cliente.leerDatosDelUltimoTrabajo();
  assert.deepEqual(antes?.datos, estado);
  m.reiniciar();
  assert.deepEqual(await m.cliente.leerDatosDelUltimoTrabajo(), antes);
  assert.equal((await m.cliente.registrarRecibo(r, HUELLA, identidad(), estado)).estado, 'repetido');
  assert.deepEqual(await m.cliente.leerDatosDelUltimoTrabajo(), antes);
});

test('catálogo privado v2 comparte transacción, replay exacto y única observación conservada', async (t) => {
  const m = montaje(t);
  await preparar(m);
  const r = recibo();
  const estado = datos(r.terminadoEn);
  const catalogo = catalogoPrivado();
  assert.equal((await m.cliente.registrarRecibo(r, HUELLA, identidad(), estado, catalogo)).estado, 'aplicado');
  const guardado = await m.cliente.leerDatosDelUltimoTrabajo();
  assert.equal(guardado?.version, 2);
  assert.deepEqual(guardado?.catalogo, catalogo);
  const antes = m.db.prepare('SELECT * FROM administracion_datos_trabajo').all();
  assert.equal(antes.length, 1);
  assert.equal((await m.cliente.registrarRecibo(r, HUELLA, identidad(), estado, catalogo)).estado, 'repetido');
  assert.deepEqual(m.db.prepare('SELECT * FROM administracion_datos_trabajo').all(), antes);
  const distinto = { ...catalogo, revision: '0'.repeat(TAM_HUELLA) };
  assert.equal((await m.cliente.registrarRecibo(r, HUELLA, identidad(), estado, distinto)).estado, 'conflicto');
  assert.deepEqual(m.db.prepare('SELECT * FROM administracion_datos_trabajo').all(), antes);
});
