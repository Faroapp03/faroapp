/** Migración explícita y avisos en SQLite sintética, sin copiar instantáneas ni ejecutar la cadena. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  comprobarVigilanteSqlite,
  leerHistorialVigilanteSqlite,
  prepararVigilanteSqlite,
} from '../../src/plataforma/acceso-publico/vigilante-sqlite.ts';
import { CONSULTA_SALUD, instantaneaSalud, operacionSalud } from '../ayudas/salud-datos.ts';
import { abrirSesionDePrueba } from '../ayudas/sesion-de-prueba.ts';
import {
  baseVigilante,
  CONFIANZA_VIGILANTE,
  CONFIG_VIGILANTE,
  CORTE_VIGILANTE,
  HORA_VIGILANTE,
  PROGRAMADA_VIGILANTE,
  reciboSinPendientesVigilante,
} from '../ayudas/vigilante.ts';

/** Una consulta nueva requiere soporte remoto y de conjunto nuevos, no una fecha de reconstrucción. */
function consultaNueva(fecha: string, observadoEn: string, ciclo = '00000000-0000-4000-8000-000000000001') {
  const base = instantaneaSalud();
  const operacion = operacionSalud({ ciclo, inicioEn: fecha, finEn: fecha, ultimoIntentoRemotoEn: fecha });
  return instantaneaSalud({
    observadoEn,
    fuentes: base.fuentes.map((fuente) => ({ ...fuente, ultimaOperacion: operacion })),
    comprobaciones: {
      ...base.comprobaciones,
      registradoEn: fecha,
      conjuntos: base.comprobaciones.conjuntos.map((c) => ({
        ...c,
        ultimaComprobacion: c.ultimaComprobacion && { ...c.ultimaComprobacion, fecha, ciclo },
      })),
    },
    seguimientoRemoto: [{ fuente: 'empresas', ultimoIntento: operacion, incidenciasPendientes: [] }],
  });
}

function consultaFallida(fecha = '2026-10-23T10:00:00Z') {
  const base = instantaneaSalud();
  const fallo = operacionSalud({
    ciclo: '00000000-0000-4000-8000-000000000002',
    inicioEn: fecha,
    finEn: fecha,
    ultimoIntentoRemotoEn: fecha,
    resultado: 'fallo',
    huellaEvidencia: null,
  });
  return instantaneaSalud({
    fuentes: base.fuentes.map((fuente) => ({ ...fuente, ultimaOperacion: fallo })),
    comprobaciones: { ...base.comprobaciones, registradoEn: fallo.finEn },
    seguimientoRemoto: [
      { fuente: 'empresas', ultimoIntento: fallo, incidenciasPendientes: [{ conjunto: 'empresas', operacion: fallo }] },
    ],
  });
}
function consultaSoloOtroConjunto() {
  const base = instantaneaSalud();
  const conjunto = base.comprobaciones.conjuntos[0];
  assert.ok(conjunto);
  const nueva = consultaNueva('2026-10-24T10:00:00Z', '2026-10-24T12:00:00Z', '00000000-0000-4000-8000-000000000003');
  const comprobado = nueva.comprobaciones.conjuntos[0];
  assert.ok(comprobado);
  return {
    ...nueva,
    comprobaciones: {
      ...nueva.comprobaciones,
      conjuntos: [conjunto, { ...comprobado, id: 'otro-conjunto' }],
    },
  };
}

function conOperacionLocal(datos: ReturnType<typeof instantaneaSalud>) {
  return {
    ...datos,
    modulos: datos.modulos.map((m) => ({ ...m, ultimoIntento: '2026-10-24T11:00:00Z', veredicto: 'verde' as const })),
  };
}

/** Solo reproduce el esquema del prototipo sobre la SQLite sintética de esta prueba. */
function fixtureSinPrecision(f: Awaited<ReturnType<typeof baseVigilante>>) {
  for (const fila of f.db.prepare('SELECT clave,observado_en FROM administracion_vigilante_marcas').all()) {
    assert.ok(typeof fila.clave === 'string');
    const sha = createHash('sha256')
      .update(JSON.stringify([fila.clave, fila.observado_en]))
      .digest('hex');
    f.db.prepare('UPDATE administracion_vigilante_marcas SET sha=? WHERE clave=?').run(sha, fila.clave);
  }
  f.db.exec('ALTER TABLE administracion_vigilante_marcas DROP COLUMN soporte');
  f.db.exec('ALTER TABLE administracion_vigilante DROP COLUMN formato_marcas');
}

test('preparación explícita idempotente preserva autoridades previas; consultar no migra', async (t) => {
  const f = await baseVigilante(t);
  const anteriores = () =>
    ['administracion_trabajo', 'administracion_programacion', 'administracion_activacion', 'administracion_sesion'].map(
      (tabla) => f.db.prepare(`SELECT * FROM ${tabla}`).all(),
    );
  const antes = anteriores();
  assert.throws(() => comprobarVigilanteSqlite(f.sql, CONFIG_VIGILANTE, PROGRAMADA_VIGILANTE, CORTE_VIGILANTE));
  prepararVigilanteSqlite(f.sql, CONFIG_VIGILANTE, CORTE_VIGILANTE);
  const metadata = f.db.prepare('SELECT * FROM administracion_vigilante').all();
  prepararVigilanteSqlite(f.sql, CONFIG_VIGILANTE, CORTE_VIGILANTE + HORA_VIGILANTE);
  assert.deepEqual(f.db.prepare('SELECT * FROM administracion_vigilante').all(), metadata);
  assert.deepEqual(anteriores(), antes);
});
test('mismo aviso no se duplica; recuperación conserva incidente e historial; corte antiguo rechaza', async (t) => {
  const f = await baseVigilante(t);
  prepararVigilanteSqlite(f.sql, CONFIG_VIGILANTE, CORTE_VIGILANTE);
  const primero = comprobarVigilanteSqlite(f.sql, CONFIG_VIGILANTE, PROGRAMADA_VIGILANTE, CORTE_VIGILANTE);
  assert.ok(primero.incidencias.some((d) => d.clave === 'programador'));
  assert.equal(
    comprobarVigilanteSqlite(f.sql, CONFIG_VIGILANTE, PROGRAMADA_VIGILANTE, CORTE_VIGILANTE).nuevas.length,
    0,
  );
  assert.equal(
    comprobarVigilanteSqlite(f.sql, CONFIG_VIGILANTE, PROGRAMADA_VIGILANTE, CORTE_VIGILANTE + 1).nuevas.length,
    0,
  );
  const historial = leerHistorialVigilanteSqlite(f.sql, CORTE_VIGILANTE + 1);
  f.db
    .prepare('UPDATE administracion_programacion SET evento_en=?,reloj=?')
    .run(Date.parse('2026-10-23T03:00:00Z'), CORTE_VIGILANTE + 2);
  const recuperada = comprobarVigilanteSqlite(f.sql, CONFIG_VIGILANTE, PROGRAMADA_VIGILANTE, CORTE_VIGILANTE + 2);
  assert.equal(
    recuperada.incidencias.some((d) => d.clave === 'programador'),
    false,
  );
  assert.ok(leerHistorialVigilanteSqlite(f.sql, CORTE_VIGILANTE + 2).decisiones.length > historial.decisiones.length);
  assert.throws(() => comprobarVigilanteSqlite(f.sql, CONFIG_VIGILANTE, PROGRAMADA_VIGILANTE, CORTE_VIGILANTE));
  assert.throws(() =>
    leerHistorialVigilanteSqlite(f.sql, CORTE_VIGILANTE + 2, { revisionEsperada: historial.revision }),
  );
});
test('fallo de escritura revierte migración y decisiones; corrupción no se convierte en registro vacío', async (t) => {
  const f = await baseVigilante(t);
  const roto = {
    ...f.sql,
    ejecutar: (sentencia: string, ...valores: (string | number | null)[]) => {
      f.sql.ejecutar(sentencia, ...valores);
      if (sentencia.startsWith('INSERT INTO administracion_vigilante ')) {
        throw new Error('corte-sintetico');
      }
    },
  };
  assert.throws(() => prepararVigilanteSqlite(roto, CONFIG_VIGILANTE, CORTE_VIGILANTE), /corte-sintetico/);
  assert.equal(
    f.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='administracion_vigilante'").get()?.n,
    0,
  );
  prepararVigilanteSqlite(f.sql, CONFIG_VIGILANTE, CORTE_VIGILANTE);
  const fallaDecision = {
    ...f.sql,
    ejecutar: (sentencia: string, ...valores: (string | number | null)[]) => {
      f.sql.ejecutar(sentencia, ...valores);
      if (sentencia.startsWith('INSERT INTO administracion_vigilante_decisiones')) {
        throw new Error('corte-decision');
      }
    },
  };
  assert.throws(
    () => comprobarVigilanteSqlite(fallaDecision, CONFIG_VIGILANTE, PROGRAMADA_VIGILANTE, CORTE_VIGILANTE),
    /corte-decision/,
  );
  assert.equal(leerHistorialVigilanteSqlite(f.sql, CORTE_VIGILANTE).decisiones.length, 0);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM administracion_vigilante_marcas').get()?.n, 0);
  comprobarVigilanteSqlite(f.sql, CONFIG_VIGILANTE, PROGRAMADA_VIGILANTE, CORTE_VIGILANTE);
  f.db.prepare("UPDATE administracion_vigilante_decisiones SET motivo='alterado' WHERE id=1").run();
  assert.throws(() => leerHistorialVigilanteSqlite(f.sql, CORTE_VIGILANTE));
  f.db.exec('DROP TABLE administracion_vigilante_decisiones');
  assert.throws(() => prepararVigilanteSqlite(f.sql, CONFIG_VIGILANTE, CORTE_VIGILANTE));
});

test('sin-pendientes conserva fechas; reserva nueva sin instantánea no borra una incidencia previa', async (t) => {
  const f = await baseVigilante(t);
  const datos = instantaneaSalud();
  await reciboSinPendientesVigilante(f.almacen, CORTE_VIGILANTE, datos, '11111111-1111-4111-8111-111111111111');
  prepararVigilanteSqlite(f.sql, CONFIG_VIGILANTE, CORTE_VIGILANTE);
  const primero = comprobarVigilanteSqlite(f.sql, CONFIG_VIGILANTE, undefined, CORTE_VIGILANTE);
  assert.equal(primero.evaluacion.mantenimiento?.operativas[0]?.comprobaciones[0]?.fecha, CONSULTA_SALUD);
  assert.equal(primero.evaluacion.fechaDatos[0]?.fecha, '2026-01-01');
  f.reloj.ahora = Date.parse('2026-11-21T00:00:00Z');
  const vencida = comprobarVigilanteSqlite(f.sql, CONFIG_VIGILANTE, undefined, f.reloj.ahora);
  assert.ok(vencida.incidencias.some((d) => d.clave === 'conjunto:empresas'));
  const HASH = 64;
  await abrirSesionDePrueba(f.almacen, { huellaSesion: 'd'.repeat(HASH), huellaPrincipal: 'b'.repeat(HASH) });
  const nuevaReserva = await f.almacen.reservarTrabajoDeSesion(
    { huellaSesion: 'd'.repeat(HASH), huellaPrincipal: 'b'.repeat(HASH) },
    {
      solicitudId: '22222222-2222-4222-8222-222222222222',
      accion: 'actualizar-datos',
      revisionEsperada: (await f.almacen.leerTrabajoPrivado()).revision,
    },
    CONFIANZA_VIGILANTE,
  );
  assert.equal(nuevaReserva.estado, 'nueva');
  const sinLectura = comprobarVigilanteSqlite(f.sql, CONFIG_VIGILANTE, undefined, f.reloj.ahora + 1);
  assert.equal(sinLectura.evaluacion.mantenimiento, null);
  assert.ok(sinLectura.incidencias.some((d) => d.clave === 'conjunto:empresas'));
});

test('otra entrada en mismo corte se rechaza sin escribir; páginas exigen revisión coherente', async (t) => {
  const f = await baseVigilante(t);
  prepararVigilanteSqlite(f.sql, CONFIG_VIGILANTE, CORTE_VIGILANTE);
  comprobarVigilanteSqlite(f.sql, CONFIG_VIGILANTE, PROGRAMADA_VIGILANTE, CORTE_VIGILANTE);
  const antes = leerHistorialVigilanteSqlite(f.sql, CORTE_VIGILANTE);
  assert.throws(() => comprobarVigilanteSqlite(f.sql, CONFIG_VIGILANTE, undefined, CORTE_VIGILANTE));
  assert.deepEqual(leerHistorialVigilanteSqlite(f.sql, CORTE_VIGILANTE), antes);
  const pagina = leerHistorialVigilanteSqlite(f.sql, CORTE_VIGILANTE, { limite: 1 });
  assert.ok(pagina.siguiente);
  assert.throws(() =>
    leerHistorialVigilanteSqlite(f.sql, CORTE_VIGILANTE, { despuesDe: pagina.siguiente ?? 0, limite: 1 }),
  );
  assert.equal(
    leerHistorialVigilanteSqlite(f.sql, CORTE_VIGILANTE, {
      despuesDe: pagina.siguiente,
      limite: 1,
      revisionEsperada: pagina.revision,
    }).decisiones.length,
    1,
  );
});

test('una confirmación igual más reciente impide que un fallo antiguo tardío gane después', async (t) => {
  const f = await baseVigilante(t);
  prepararVigilanteSqlite(f.sql, CONFIG_VIGILANTE, CORTE_VIGILANTE);
  await reciboSinPendientesVigilante(
    f.almacen,
    CORTE_VIGILANTE,
    instantaneaSalud(),
    '11111111-1111-4111-8111-111111111111',
  );
  comprobarVigilanteSqlite(f.sql, CONFIG_VIGILANTE, undefined, CORTE_VIGILANTE);
  f.reloj.ahora = Date.parse('2026-10-24T12:00:00Z');
  await reciboSinPendientesVigilante(
    f.almacen,
    f.reloj.ahora,
    consultaNueva('2026-10-24T10:00:00Z', '2026-10-24T12:00:00Z'),
    '22222222-2222-4222-8222-222222222222',
  );
  comprobarVigilanteSqlite(f.sql, CONFIG_VIGILANTE, undefined, f.reloj.ahora);
  f.reloj.ahora = Date.parse('2026-10-25T12:00:00Z');
  const base = instantaneaSalud();
  const fallo = operacionSalud({
    ciclo: '00000000-0000-4000-8000-000000000002',
    inicioEn: '2026-10-23T10:00:00Z',
    finEn: '2026-10-23T10:01:00Z',
    ultimoIntentoRemotoEn: '2026-10-23T10:00:00Z',
    resultado: 'fallo',
    huellaEvidencia: null,
  });
  const antigua = instantaneaSalud({
    fuentes: base.fuentes.map((fuente) => ({ ...fuente, ultimaOperacion: fallo })),
    comprobaciones: { ...base.comprobaciones, registradoEn: fallo.finEn },
    seguimientoRemoto: [
      { fuente: 'empresas', ultimoIntento: fallo, incidenciasPendientes: [{ conjunto: 'empresas', operacion: fallo }] },
    ],
  });
  await reciboSinPendientesVigilante(f.almacen, f.reloj.ahora, antigua, '33333333-3333-4333-8333-333333333333');
  const tardia = comprobarVigilanteSqlite(f.sql, CONFIG_VIGILANTE, undefined, f.reloj.ahora);
  assert.equal(
    tardia.incidencias.some((d) => d.clave === 'fuente:empresas'),
    false,
  );
});

test('reconstruir con consulta antigua no resuelve un fallo remoto posterior', async (t) => {
  const f = await baseVigilante(t);
  const datos = consultaFallida();
  await reciboSinPendientesVigilante(f.almacen, f.reloj.ahora, datos, '11111111-1111-4111-8111-111111111111');
  prepararVigilanteSqlite(f.sql, CONFIG_VIGILANTE, f.reloj.ahora);
  comprobarVigilanteSqlite(f.sql, CONFIG_VIGILANTE, undefined, f.reloj.ahora);
  f.reloj.ahora = Date.parse('2026-10-24T12:00:00Z');
  await reciboSinPendientesVigilante(
    f.almacen,
    f.reloj.ahora,
    conOperacionLocal(instantaneaSalud({ observadoEn: '2026-10-24T12:00:00Z' })),
    '22222222-2222-4222-8222-222222222222',
  );
  const antigua = comprobarVigilanteSqlite(f.sql, CONFIG_VIGILANTE, undefined, f.reloj.ahora);
  assert.ok(antigua.incidencias.some((d) => d.clave === 'fuente:empresas'));
  assert.ok(antigua.omitidasPorAntiguedad.some((clave) => clave === 'fuente:empresas'));
  f.reloj.ahora = Date.parse('2026-10-25T12:00:00Z');
  await reciboSinPendientesVigilante(
    f.almacen,
    f.reloj.ahora,
    consultaNueva('2026-10-25T10:00:00Z', '2026-10-25T12:00:00Z'),
    '33333333-3333-4333-8333-333333333333',
  );
  // Conserva también el canal local nuevo ya observado; no lo sustituye por ausencia.
  const sinCanalLocal = comprobarVigilanteSqlite(f.sql, CONFIG_VIGILANTE, undefined, f.reloj.ahora);
  assert.ok(sinCanalLocal.incidencias.some((d) => d.clave === 'fuente:empresas'));
  f.reloj.ahora = Date.parse('2026-10-25T12:00:01Z');
  const completa = consultaNueva('2026-10-25T10:00:00Z', '2026-10-25T12:00:00Z');
  await reciboSinPendientesVigilante(
    f.almacen,
    f.reloj.ahora,
    conOperacionLocal(completa),
    '44444444-4444-4444-8444-444444444444',
  );
  const recuperada = comprobarVigilanteSqlite(f.sql, CONFIG_VIGILANTE, undefined, f.reloj.ahora);
  assert.equal(
    recuperada.incidencias.find((d) => d.clave === 'fuente:empresas'),
    undefined,
  );
  assert.equal(comprobarVigilanteSqlite(f.sql, CONFIG_VIGILANTE, undefined, f.reloj.ahora).nuevas.length, 0);
});

test('soporte antiguo no adelanta vencimiento ni impide vencer el último soporte admitido', async (t) => {
  const f = await baseVigilante(t);
  f.reloj.ahora = Date.parse('2026-10-24T12:00:00Z');
  const nueva = consultaNueva('2026-10-24T10:00:00Z', '2026-10-24T12:00:00Z');
  await reciboSinPendientesVigilante(f.almacen, f.reloj.ahora, nueva, '11111111-1111-4111-8111-111111111111');
  prepararVigilanteSqlite(f.sql, CONFIG_VIGILANTE, f.reloj.ahora);
  comprobarVigilanteSqlite(f.sql, CONFIG_VIGILANTE, undefined, f.reloj.ahora);
  f.reloj.ahora = Date.parse('2026-10-25T12:00:00Z');
  await reciboSinPendientesVigilante(
    f.almacen,
    f.reloj.ahora,
    instantaneaSalud({ observadoEn: new Date(f.reloj.ahora).toISOString().replace('.000Z', 'Z') }),
    '22222222-2222-4222-8222-222222222222',
  );
  const regresiva = comprobarVigilanteSqlite(f.sql, CONFIG_VIGILANTE, undefined, f.reloj.ahora);
  assert.ok(regresiva.omitidasPorAntiguedad.some((clave) => clave === 'conjunto:empresas'));
  f.reloj.ahora = Date.parse('2026-11-21T00:00:00Z');
  const antes = comprobarVigilanteSqlite(f.sql, CONFIG_VIGILANTE, undefined, f.reloj.ahora);
  assert.equal(
    antes.incidencias.some((d) => d.clave === 'conjunto:empresas'),
    false,
  );
  f.reloj.ahora = Date.parse('2026-11-23T00:00:00Z');
  const vence = comprobarVigilanteSqlite(f.sql, CONFIG_VIGILANTE, undefined, f.reloj.ahora);
  assert.ok(vence.incidencias.some((d) => d.clave === 'conjunto:empresas' && d.motivo === 'comprobacion_vencida'));
});

test('consultar otro conjunto de la fuente no resuelve la incidencia del conjunto antiguo', async (t) => {
  const f = await baseVigilante(t);
  await reciboSinPendientesVigilante(
    f.almacen,
    f.reloj.ahora,
    consultaFallida(),
    '11111111-1111-4111-8111-111111111111',
  );
  prepararVigilanteSqlite(f.sql, CONFIG_VIGILANTE, f.reloj.ahora);
  comprobarVigilanteSqlite(f.sql, CONFIG_VIGILANTE, undefined, f.reloj.ahora);
  f.reloj.ahora = Date.parse('2026-10-24T12:00:00Z');
  await reciboSinPendientesVigilante(
    f.almacen,
    f.reloj.ahora,
    consultaSoloOtroConjunto(),
    '22222222-2222-4222-8222-222222222222',
  );
  const resultado = comprobarVigilanteSqlite(f.sql, CONFIG_VIGILANTE, undefined, f.reloj.ahora);
  assert.ok(resultado.omitidasPorAntiguedad.some((clave) => clave === 'fuente:empresas'));
  assert.ok(resultado.incidencias.some((d) => d.clave === 'fuente:empresas'));
});

test('microsegundos y empates contradictorios no convierten soporte anterior en recuperación', async (t) => {
  for (const [fallo, positiva] of [
    ['2026-10-23T10:00:00.000002Z', '2026-10-23T10:00:00.000001Z'],
    ['2026-10-23T10:00:00.000002Z', '2026-10-23T10:00:00.000002Z'],
    ['2026-10-23T10:00:00Z', '2026-10-23T10:00:00.000000Z'],
  ]) {
    assert.ok(fallo && positiva);
    const f = await baseVigilante(t);
    await reciboSinPendientesVigilante(
      f.almacen,
      f.reloj.ahora,
      consultaFallida(fallo),
      '11111111-1111-4111-8111-111111111111',
    );
    prepararVigilanteSqlite(f.sql, CONFIG_VIGILANTE, f.reloj.ahora);
    comprobarVigilanteSqlite(f.sql, CONFIG_VIGILANTE, undefined, f.reloj.ahora);
    f.reloj.ahora = Date.parse('2026-10-24T12:00:00Z');
    await reciboSinPendientesVigilante(
      f.almacen,
      f.reloj.ahora,
      consultaNueva(positiva, '2026-10-24T12:00:00Z', '00000000-0000-4000-8000-000000000003'),
      '22222222-2222-4222-8222-222222222222',
    );
    const resultado = comprobarVigilanteSqlite(f.sql, CONFIG_VIGILANTE, undefined, f.reloj.ahora);
    assert.ok(
      resultado.incidencias.some((d) => d.clave === 'fuente:empresas'),
      `${fallo} frente a ${positiva}`,
    );
    f.reloj.ahora = Date.parse('2026-10-25T12:00:00Z');
    await reciboSinPendientesVigilante(
      f.almacen,
      f.reloj.ahora,
      consultaNueva('2026-10-23T10:00:00.000003Z', '2026-10-25T12:00:00Z', '00000000-0000-4000-8000-000000000004'),
      '33333333-3333-4333-8333-333333333333',
    );
    const recuperada = comprobarVigilanteSqlite(f.sql, CONFIG_VIGILANTE, undefined, f.reloj.ahora);
    assert.equal(
      recuperada.incidencias.some((d) => d.clave === 'fuente:empresas'),
      false,
    );
  }
});

test('migración explícita de marcas conserva historia y no fabrica precisión del legado', async (t) => {
  const f = await baseVigilante(t);
  prepararVigilanteSqlite(f.sql, CONFIG_VIGILANTE, CORTE_VIGILANTE);
  comprobarVigilanteSqlite(f.sql, CONFIG_VIGILANTE, undefined, CORTE_VIGILANTE);
  const antes = leerHistorialVigilanteSqlite(f.sql, CORTE_VIGILANTE);
  const marcas = f.db.prepare('SELECT clave,observado_en FROM administracion_vigilante_marcas').all();
  fixtureSinPrecision(f);
  assert.throws(() => leerHistorialVigilanteSqlite(f.sql, CORTE_VIGILANTE));
  const fallida = {
    ...f.sql,
    ejecutar: (sentencia: string, ...valores: (string | number | null)[]) => {
      f.sql.ejecutar(sentencia, ...valores);
      if (sentencia.includes('ADD COLUMN soporte')) {
        throw new Error('migracion-interrumpida');
      }
    },
  };
  assert.throws(() => prepararVigilanteSqlite(fallida, CONFIG_VIGILANTE, CORTE_VIGILANTE), /migracion-interrumpida/);
  assert.equal(
    f.db
      .prepare('PRAGMA table_info(administracion_vigilante_marcas)')
      .all()
      .some((c) => c.name === 'soporte'),
    false,
  );
  prepararVigilanteSqlite(f.sql, CONFIG_VIGILANTE, CORTE_VIGILANTE);
  assert.deepEqual(leerHistorialVigilanteSqlite(f.sql, CORTE_VIGILANTE), antes);
  assert.deepEqual(f.db.prepare('SELECT clave,observado_en FROM administracion_vigilante_marcas').all(), marcas);
  assert.ok(
    f.db
      .prepare('SELECT soporte FROM administracion_vigilante_marcas')
      .all()
      .every((fila) => fila.soporte === null),
  );
  const estado = f.db.prepare('SELECT * FROM administracion_vigilante').get();
  prepararVigilanteSqlite(f.sql, CONFIG_VIGILANTE, CORTE_VIGILANTE + HORA_VIGILANTE);
  assert.deepEqual(f.db.prepare('SELECT * FROM administracion_vigilante').get(), estado);
});
