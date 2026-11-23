/** Alcance causal: leer la instalación no acredita actividad de mantenimiento. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  comprobarVigilanteConLecturaLocalSqlite,
  comprobarVigilanteSqlite,
  leerHistorialVigilanteSqlite,
  prepararVigilanteSqlite,
} from '../../src/plataforma/acceso-publico/vigilante-sqlite.ts';
import { instantaneaSalud } from '../ayudas/salud-datos.ts';
import {
  baseVigilante,
  CONFIG_VIGILANTE,
  CORTE_VIGILANTE,
  DIA_VIGILANTE,
  reciboSinPendientesVigilante,
} from '../ayudas/vigilante.ts';

const ALTERNANCIAS = 4;
const DIAS_PARA_RECIBO_ANTIGUO = 3;

function fresca(ahora: number) {
  return instantaneaSalud({ observadoEn: new Date(ahora).toISOString().replace(/(\.\d{3})Z$/u, '$1000Z') });
}
test('lectura local no resuelve ausencia de recibo y alternar no duplica su aviso', async (t) => {
  const f = await baseVigilante(t);
  prepararVigilanteSqlite(f.sql, CONFIG_VIGILANTE, CORTE_VIGILANTE);
  comprobarVigilanteSqlite(f.sql, CONFIG_VIGILANTE, undefined, CORTE_VIGILANTE);
  for (let i = 1; i <= ALTERNANCIAS; i++) {
    const ahora = CORTE_VIGILANTE + i;
    const r =
      i % 2
        ? comprobarVigilanteConLecturaLocalSqlite(
            f.sql,
            { configuracion: CONFIG_VIGILANTE, datos: fresca(ahora) },
            ahora,
          )
        : comprobarVigilanteSqlite(f.sql, CONFIG_VIGILANTE, undefined, ahora);
    assert.ok(r.incidencias.some((d) => d.clave === 'lectura-datos' && d.motivo === 'sin_observacion_correlacionada'));
    if (i % 2) {
      assert.equal(
        r.evaluacion.decisiones.some((d) => d.clave === 'lectura-datos'),
        false,
      );
    }
  }
  const historia = leerHistorialVigilanteSqlite(f.sql, CORTE_VIGILANTE + ALTERNANCIAS).decisiones;
  const avisos = historia.filter((d) => d.clave === 'lectura-datos' && d.requiereAviso);
  assert.equal(avisos.length, 1);
});

test('lectura recién completada conserva incidencia por recibo antiguo', async (t) => {
  const f = await baseVigilante(t);
  await reciboSinPendientesVigilante(
    f.almacen,
    CORTE_VIGILANTE,
    instantaneaSalud(),
    '00000000-0000-4000-8000-000000000012',
  );
  prepararVigilanteSqlite(f.sql, CONFIG_VIGILANTE, CORTE_VIGILANTE);
  const ahora = CORTE_VIGILANTE + DIAS_PARA_RECIBO_ANTIGUO * DIA_VIGILANTE;
  f.reloj.ahora = ahora;
  comprobarVigilanteSqlite(f.sql, CONFIG_VIGILANTE, undefined, ahora);
  const local = comprobarVigilanteConLecturaLocalSqlite(
    f.sql,
    { configuracion: CONFIG_VIGILANTE, datos: fresca(ahora + 1) },
    ahora + 1,
  );
  assert.ok(
    local.incidencias.some((d) => d.clave === 'lectura-datos' && d.motivo === 'observacion_de_mantenimiento_antigua'),
  );
  assert.equal(
    local.evaluacion.decisiones.some((d) => d.clave === 'lectura-datos'),
    false,
  );
});

test('cada transición conserva su origen en el mismo historial sin duplicar avisos', async (t) => {
  const f = await baseVigilante(t);
  prepararVigilanteSqlite(f.sql, CONFIG_VIGILANTE, CORTE_VIGILANTE);
  comprobarVigilanteSqlite(f.sql, CONFIG_VIGILANTE, undefined, CORTE_VIGILANTE);
  comprobarVigilanteConLecturaLocalSqlite(
    f.sql,
    { configuracion: CONFIG_VIGILANTE, datos: instantaneaSalud() },
    CORTE_VIGILANTE + 1,
  );
  const historia = leerHistorialVigilanteSqlite(f.sql, CORTE_VIGILANTE + 1);
  assert.equal(historia.decisiones.find((d) => d.clave === 'lectura-datos')?.origen, 'recibo');
  assert.equal(historia.decisiones.find((d) => d.clave === 'lectura-local')?.origen, 'lectura-local');
  const aviso = historia.decisiones.filter((d) => d.clave === 'lectura-datos' && d.requiereAviso);
  assert.equal(aviso.length, 1);
});

function quitarOrigen(f: Awaited<ReturnType<typeof baseVigilante>>) {
  const columnas = f.db.prepare('PRAGMA table_info(administracion_vigilante_decisiones)').all();
  if (columnas.some((c) => c.name === 'origen')) {
    for (const fila of f.db.prepare('SELECT * FROM administracion_vigilante_decisiones').all()) {
      const valores = [
        'clave',
        'estado',
        'motivo',
        'observado_en',
        'evaluado_en',
        'referencia',
        'configuracion_sha',
        'avisar',
      ].map((k) => fila[k]);
      assert.ok(typeof fila.id === 'number');
      f.db
        .prepare('UPDATE administracion_vigilante_decisiones SET sha=? WHERE id=?')
        .run(createHash('sha256').update(JSON.stringify(valores)).digest('hex'), fila.id);
    }
    f.db.exec('ALTER TABLE administracion_vigilante_decisiones DROP COLUMN origen');
    f.db.exec('ALTER TABLE administracion_vigilante DROP COLUMN formato_decisiones');
  }
}

test('preparación migra origen explícitamente sin inventarlo ni cambiar fechas o sellos legados', async (t) => {
  const f = await baseVigilante(t);
  prepararVigilanteSqlite(f.sql, CONFIG_VIGILANTE, CORTE_VIGILANTE);
  comprobarVigilanteSqlite(f.sql, CONFIG_VIGILANTE, undefined, CORTE_VIGILANTE);
  quitarOrigen(f);
  const antes = f.db.prepare('SELECT * FROM administracion_vigilante_decisiones').all();
  assert.throws(() => comprobarVigilanteSqlite(f.sql, CONFIG_VIGILANTE, undefined, CORTE_VIGILANTE + 1));
  prepararVigilanteSqlite(f.sql, CONFIG_VIGILANTE, CORTE_VIGILANTE + 1);
  const despues = f.db.prepare('SELECT * FROM administracion_vigilante_decisiones').all();
  assert.deepEqual(
    despues.map(({ origen, ...fila }) => {
      assert.equal(origen, null);
      return fila;
    }),
    antes.map((fila) => ({ ...fila })),
  );
  assert.ok(
    leerHistorialVigilanteSqlite(f.sql, CORTE_VIGILANTE + 1).decisiones.every((d) => d.origen === 'no-registrado'),
  );
  const serializado = JSON.stringify(despues);
  prepararVigilanteSqlite(f.sql, CONFIG_VIGILANTE, CORTE_VIGILANTE + 2);
  assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM administracion_vigilante_decisiones').all()), serializado);
});

test('fallo al migrar origen revierte columnas, metadata y decisiones', async (t) => {
  const f = await baseVigilante(t);
  prepararVigilanteSqlite(f.sql, CONFIG_VIGILANTE, CORTE_VIGILANTE);
  comprobarVigilanteSqlite(f.sql, CONFIG_VIGILANTE, undefined, CORTE_VIGILANTE);
  quitarOrigen(f);
  const estado = () =>
    JSON.stringify([
      f.db.prepare('SELECT sql FROM sqlite_master WHERE name LIKE ? ORDER BY name').all('administracion_vigilante%'),
      f.db.prepare('SELECT * FROM administracion_vigilante').all(),
      f.db.prepare('SELECT * FROM administracion_vigilante_decisiones').all(),
    ]);
  const antes = estado();
  const cortada = {
    ...f.sql,
    ejecutar: (s: string, ...v: (string | number | null)[]) => {
      f.sql.ejecutar(s, ...v);
      if (s.includes('ADD COLUMN formato_decisiones')) {
        throw new Error('corte-migracion-origen');
      }
    },
  };
  assert.throws(
    () => prepararVigilanteSqlite(cortada, CONFIG_VIGILANTE, CORTE_VIGILANTE + 1),
    /corte-migracion-origen/,
  );
  assert.equal(estado(), antes);
  prepararVigilanteSqlite(f.sql, CONFIG_VIGILANTE, CORTE_VIGILANTE + 1);
});

test('migración de origen rechaza historia alterada sin completar su esquema', async (t) => {
  const f = await baseVigilante(t);
  prepararVigilanteSqlite(f.sql, CONFIG_VIGILANTE, CORTE_VIGILANTE);
  comprobarVigilanteSqlite(f.sql, CONFIG_VIGILANTE, undefined, CORTE_VIGILANTE);
  quitarOrigen(f);
  f.db.exec("UPDATE administracion_vigilante_decisiones SET motivo='alterado'");
  const antes = f.db.prepare('SELECT * FROM administracion_vigilante_decisiones').all();
  assert.throws(() => prepararVigilanteSqlite(f.sql, CONFIG_VIGILANTE, CORTE_VIGILANTE + 1));
  assert.deepEqual(f.db.prepare('SELECT * FROM administracion_vigilante_decisiones').all(), antes);
  assert.equal(
    f.db
      .prepare('PRAGMA table_info(administracion_vigilante_decisiones)')
      .all()
      .some((c) => c.name === 'origen'),
    false,
  );
});
