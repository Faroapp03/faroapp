import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import {
  CADUCIDAD_INVITACION_MS,
  leerSecretoInvitacion,
  leerSolicitudInvitar,
  SolicitudInstitucionInvalida,
} from '../../src/administracion/instituciones.ts';
import { huellaDelSecreto, secretoNuevo } from '../../src/api/socios/registro.ts';
import {
  activarControlesSqlite,
  cambiarControlesSqlite,
} from '../../src/plataforma/acceso-publico/controles-sqlite.ts';
import {
  activarInvitacionSqlite,
  buscarInstitucionAutorizadaSqlite,
  consultarInvitacionSqlite,
  invitarInstitucionSqlite,
  leerRegistroInstitucionesSqlite,
  prepararInstitucionesSqlite,
  RegistroInstitucionalNoValido,
  renovarInvitacionSqlite,
  retirarClaveInstitucionSqlite,
  retirarInstitucionSqlite,
} from '../../src/plataforma/acceso-publico/instituciones-sqlite.ts';
import { AlmacenPublicoSqlite, type SqlAccesoPublico } from '../../src/plataforma/acceso-publico/sqlite.ts';

const AHORA = Date.parse('2026-10-23T00:00:00Z');
const POLITICA = { version: 2, api: 'habilitada', mcp: false, a2a: false } as const;
function identidad() {
  const secreto = secretoNuevo();
  return { id: crypto.randomUUID(), huella: huellaDelSecreto(secreto), secreto };
}
function fixture() {
  const db = new DatabaseSync(':memory:');
  const sql: SqlAccesoPublico = {
    filas: (s, ...v) => db.prepare(s).all(...v),
    ejecutar: (s, ...v) => {
      db.prepare(s).run(...v);
    },
    transaccion: (accion) => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const valor = accion();
        db.exec('COMMIT');
        return valor;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
  new AlmacenPublicoSqlite(sql, { maxClientes: 100, ahora: () => AHORA });
  sql.transaccion(() => {
    activarControlesSqlite(sql, POLITICA);
    prepararInstitucionesSqlite(sql, AHORA);
  });
  const id = `inst-${crypto.randomUUID()}`,
    invitacion = identidad();
  const usar = <T>(accion: (s: SqlAccesoPublico) => T): T => sql.transaccion(() => accion(sql));
  const nueva = () =>
    usar((s) =>
      invitarInstitucionSqlite(
        s,
        { revisionEsperada: 0, nombre: 'Institución de ensayo', correo: null },
        { ...invitacion, institucionId: id },
        AHORA,
      ),
    );
  return { db, sql, usar, id, invitacion, nueva };
}
test('invitación sin consumo al consultar, consumo único al generar clave y solo huellas en almacenamiento', () => {
  const f = fixture();
  try {
    assert.equal(f.nueva().estado, 'cambiado');
    for (let i = 0; i < 2; i++) {
      const consultada = f.usar((s) => consultarInvitacionSqlite(s, f.invitacion, AHORA));
      assert(consultada !== null && consultada !== 'apagada');
      assert.equal(consultada.version, 1);
    }
    const clave = identidad();
    assert.equal(f.usar((s) => activarInvitacionSqlite(s, f.invitacion, clave, AHORA)).estado, 'activada');
    assert.equal(f.usar((s) => activarInvitacionSqlite(s, f.invitacion, identidad(), AHORA)).estado, 'no_disponible');
    assert.deepEqual(buscarInstitucionAutorizadaSqlite(f.sql, f.id)?.huellas, [clave.huella]);
    const guardado =
      JSON.stringify(f.sql.filas('SELECT * FROM instituciones_invitaciones')) +
      JSON.stringify(f.sql.filas('SELECT * FROM instituciones_claves'));
    assert(!guardado.includes(clave.secreto) && !guardado.includes(f.invitacion.secreto));
    const publico = JSON.stringify(f.usar((s) => leerRegistroInstitucionesSqlite(s, AHORA)));
    assert(!publico.includes(clave.huella) && !publico.includes(f.invitacion.huella));
  } finally {
    f.db.close();
  }
});
test('relevo: dos claves a la vez; retirar una conserva la nueva; retirar institución invalida todo', () => {
  const f = fixture();
  try {
    f.nueva();
    const primera = identidad(),
      siguiente = identidad(),
      segunda = identidad();
    f.usar((s) => activarInvitacionSqlite(s, f.invitacion, primera, AHORA));
    assert.equal(
      f.usar((s) => renovarInvitacionSqlite(s, { revisionEsperada: 2, id: f.id }, siguiente, AHORA)).estado,
      'cambiado',
    );
    f.usar((s) => activarInvitacionSqlite(s, siguiente, segunda, AHORA));
    assert.equal(buscarInstitucionAutorizadaSqlite(f.sql, f.id)?.huellas.length, 2);
    assert.equal(
      f.usar((s) => renovarInvitacionSqlite(s, { revisionEsperada: 4, id: f.id }, identidad(), AHORA)).estado,
      'dos_claves_activas',
    );
    f.usar((s) => retirarClaveInstitucionSqlite(s, { revisionEsperada: 4, id: f.id, claveId: primera.id }, AHORA));
    assert.deepEqual(buscarInstitucionAutorizadaSqlite(f.sql, f.id)?.huellas, [segunda.huella]);
    assert.equal(f.usar((s) => leerRegistroInstitucionesSqlite(s, AHORA)).instituciones[0]?.estado, 'activa');
    f.usar((s) => retirarInstitucionSqlite(s, { revisionEsperada: 5, id: f.id }, AHORA));
    assert.equal(buscarInstitucionAutorizadaSqlite(f.sql, f.id), null);
  } finally {
    f.db.close();
  }
});
test('caduca exactamente a siete días y el reloj no permite resucitar el enlace', () => {
  const f = fixture();
  try {
    f.nueva();
    assert.equal(
      f.usar((s) => activarInvitacionSqlite(s, f.invitacion, identidad(), AHORA + CADUCIDAD_INVITACION_MS)).estado,
      'no_disponible',
    );
    assert.throws(
      () => f.usar((s) => consultarInvitacionSqlite(s, f.invitacion, AHORA)),
      RegistroInstitucionalNoValido,
    );
  } finally {
    f.db.close();
  }
});
test('CAS rechaza repetir creación; apagado no consume; fallo al marcar consumo revierte también la clave', () => {
  const f = fixture();
  try {
    f.nueva();
    assert.equal(f.nueva().estado, 'conflicto');
    f.usar((s) => cambiarControlesSqlite(s, 0, { ...POLITICA, api: 'deshabilitada' }));
    assert.equal(f.usar((s) => activarInvitacionSqlite(s, f.invitacion, identidad(), AHORA)).estado, 'apagada');
    f.usar((s) => cambiarControlesSqlite(s, 1, POLITICA));
    f.db.exec(
      "CREATE TRIGGER fallo_consumo BEFORE UPDATE OF consumida ON instituciones_invitaciones BEGIN SELECT RAISE(ABORT, 'fallo sintético'); END",
    );
    assert.throws(
      () => f.usar((s) => activarInvitacionSqlite(s, f.invitacion, identidad(), AHORA)),
      /fallo sintético/u,
    );
    assert.equal(buscarInstitucionAutorizadaSqlite(f.sql, f.id), null);
    assert(f.usar((s) => consultarInvitacionSqlite(s, f.invitacion, AHORA)));
  } finally {
    f.db.close();
  }
});
test('contratos cerrados: no ejecutan getters ni aceptan secretos ambiguos, campos extra o correos con saltos', () => {
  const i = identidad();
  assert.deepEqual(leerSecretoInvitacion({ invitacion: `${i.id}.${i.secreto}` }), { id: i.id, secreto: i.secreto });
  for (const entrada of [
    { invitacion: `${i.id}.${i.secreto}.extra` },
    { invitacion: `${i.id}.${i.secreto}`, extra: true },
    {
      get invitacion() {
        throw new Error('No se ejecuta');
      },
    },
  ]) {
    assert.throws(() => leerSecretoInvitacion(entrada), SolicitudInstitucionInvalida);
  }
  assert.throws(
    () => leerSolicitudInvitar({ revisionEsperada: 0, nombre: 'Entidad', correo: 'a@b.es\n' }),
    SolicitudInstitucionInvalida,
  );
});

test('un registro parcial o corrupto es error técnico; no se completa ni se presenta como institución ausente', () => {
  const f = fixture();
  try {
    f.nueva();
    f.sql.ejecutar('UPDATE instituciones SET nombre=? WHERE id=?', 'Nombre\nno válido', f.id);
    assert.throws(() => f.usar((sql) => leerRegistroInstitucionesSqlite(sql, AHORA)), RegistroInstitucionalNoValido);
    f.db.exec('DROP TABLE instituciones_claves');
    assert.throws(() => f.usar((sql) => prepararInstitucionesSqlite(sql, AHORA)), RegistroInstitucionalNoValido);
    assert.deepEqual(f.sql.filas("SELECT name FROM sqlite_master WHERE name='instituciones_claves'"), []);
  } finally {
    f.db.close();
  }
});

test('última clave retirada exige nueva invitación; una de dos conserva activa; invitación pendiente conserva invitada', () => {
  const f = fixture();
  try {
    f.nueva();
    const primera = identidad(),
      pendiente = identidad();
    f.usar((s) => activarInvitacionSqlite(s, f.invitacion, primera, AHORA));
    f.usar((s) => retirarClaveInstitucionSqlite(s, { revisionEsperada: 2, id: f.id, claveId: primera.id }, AHORA));
    assert.equal(f.usar((s) => leerRegistroInstitucionesSqlite(s, AHORA)).instituciones[0]?.estado, 'retirada');
    assert.equal(buscarInstitucionAutorizadaSqlite(f.sql, f.id), null);
    f.usar((s) => renovarInvitacionSqlite(s, { revisionEsperada: 3, id: f.id }, pendiente, AHORA));
    assert.equal(f.usar((s) => leerRegistroInstitucionesSqlite(s, AHORA)).instituciones[0]?.estado, 'invitada');
    const segunda = identidad(),
      relevo = identidad();
    f.usar((s) => activarInvitacionSqlite(s, pendiente, segunda, AHORA));
    f.usar((s) => renovarInvitacionSqlite(s, { revisionEsperada: 5, id: f.id }, relevo, AHORA));
    f.usar((s) => retirarClaveInstitucionSqlite(s, { revisionEsperada: 6, id: f.id, claveId: segunda.id }, AHORA));
    assert.equal(f.usar((s) => leerRegistroInstitucionesSqlite(s, AHORA)).instituciones[0]?.estado, 'invitada');
    assert(f.usar((s) => consultarInvitacionSqlite(s, relevo, AHORA)));
  } finally {
    f.db.close();
  }
});

test('fechas persistidas fuera de Date fallan con error institucional técnico propio', () => {
  for (const sentencia of [
    'UPDATE instituciones_estado SET reloj=9000000000000000',
    'UPDATE instituciones SET ultima_conexion=9000000000000000',
    'UPDATE instituciones_invitaciones SET caduca=9000000000000000',
    'UPDATE instituciones_claves SET creada=9000000000000000',
    'UPDATE instituciones_claves SET ultima_conexion=9000000000000000',
  ]) {
    const f = fixture();
    try {
      f.nueva();
      f.usar((s) => activarInvitacionSqlite(s, f.invitacion, identidad(), AHORA));
      f.db.exec(sentencia);
      assert.throws(() => f.usar((s) => leerRegistroInstitucionesSqlite(s, AHORA)), RegistroInstitucionalNoValido);
    } finally {
      f.db.close();
    }
  }
});

test('correo administrativo rechaza etiquetas DNS vacías o mal formadas con el mismo contrato público', () => {
  for (const correo of ['a@a..b.test', 'a@-etiqueta.test', 'a@etiqueta-.test', 'a@b.test\n', '']) {
    assert.throws(
      () => leerSolicitudInvitar({ revisionEsperada: 0, nombre: 'Institución', correo }),
      SolicitudInstitucionInvalida,
    );
  }
  assert.equal(
    leerSolicitudInvitar({ revisionEsperada: 0, nombre: 'Institución', correo: 'equipo@entidad.test' }).correo,
    'equipo@entidad.test',
  );
  assert.equal(leerSolicitudInvitar({ revisionEsperada: 0, nombre: 'Institución', correo: null }).correo, null);
});
