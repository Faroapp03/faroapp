import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import {
  leerPaginaAccesosRecibida,
  leerUsoConectividad,
  SolicitudAccesoInvalida,
  sanearClienteDeclarado,
  type UsoConectividad,
} from '../../src/administracion/accesos.ts';
import { DIA_CONECTIVIDAD_MS, LIMITES_CONECTIVIDAD } from '../../src/administracion/instituciones.ts';
import { huellaDelSecreto, secretoNuevo } from '../../src/api/socios/registro.ts';
import {
  depurarAccesosSqlite,
  leerAccesosSqlite,
  prepararAccesosSqlite,
  RegistroAccesosNoValido,
  registrarAccesoSqlite,
  siguienteVencimientoAccesosSqlite,
} from '../../src/plataforma/acceso-publico/accesos-sqlite.ts';
import { activarControlesSqlite } from '../../src/plataforma/acceso-publico/controles-sqlite.ts';
import {
  activarInvitacionSqlite,
  invitarInstitucionSqlite,
  prepararInstitucionesSqlite,
} from '../../src/plataforma/acceso-publico/instituciones-sqlite.ts';
import { AlmacenPublicoSqlite, type SqlAccesoPublico } from '../../src/plataforma/acceso-publico/sqlite.ts';

const AHORA = Date.parse('2026-10-23T12:00:00Z'),
  HTTP_OK = 200,
  HTTP_ERROR = 400;
const FILAS_ESPERADAS_INICIALES = 4;
const LONGITUD_SECRETO = 43;
const RETENCION_MS = LIMITES_CONECTIVIDAD.retencionDias * DIA_CONECTIVIDAD_MS;
function fixture() {
  const db = new DatabaseSync(':memory:');
  const sql: SqlAccesoPublico = {
    filas: (s, ...v) => db.prepare(s).all(...v),
    ejecutar: (s, ...v) => {
      db.prepare(s).run(...v);
    },
    transaccion: <T>(accion: () => T): T => {
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
  };
  const usar = <T>(accion: (sql: SqlAccesoPublico) => T): T => sql.transaccion(() => accion(sql));
  new AlmacenPublicoSqlite(sql, { maxClientes: 100, ahora: () => AHORA });
  const id = `inst-${crypto.randomUUID()}`,
    secreto = secretoNuevo(),
    invitacion = { id: crypto.randomUUID(), huella: huellaDelSecreto(secretoNuevo()) },
    clave = { id: crypto.randomUUID(), huella: huellaDelSecreto(secreto) };
  usar((s) => {
    activarControlesSqlite(s, { version: 2, api: 'habilitada', mcp: true, a2a: true });
    prepararInstitucionesSqlite(s, AHORA);
    invitarInstitucionSqlite(
      s,
      { revisionEsperada: 0, nombre: 'Institución de ensayo', correo: 'administracion@example.invalid' },
      { ...invitacion, institucionId: id },
      AHORA,
    );
    activarInvitacionSqlite(s, invitacion, clave, AHORA);
    prepararAccesosSqlite(s, AHORA);
  });
  const api = (estadoHttp = HTTP_OK): UsoConectividad => ({
    canal: 'api',
    institucionId: id,
    credencial: clave.huella,
    consulta: 'ficha_grupo',
    estadoHttp,
  });
  const anotar = (entrada: UsoConectividad, ahora = AHORA) => usar((s) => registrarAccesoSqlite(s, entrada, ahora));
  const leer = (pagina = 1, ahora = AHORA) => usar((s) => leerAccesosSqlite(s, pagina, ahora));
  return { db, sql, usar, id, secreto, clave, api, anotar, leer };
}
test('guarda una fila por consulta institucional y agrega MCP/A2A por día sin contenido, correo, huella ni secreto', () => {
  const f = fixture();
  try {
    f.anotar(f.api());
    f.anotar(f.api(HTTP_ERROR));
    for (const canal of ['mcp', 'a2a'] as const) {
      for (let n = 0; n < 2; n++) {
        f.anotar(
          canal === 'mcp'
            ? { canal, consulta: 'ficha_grupo', ...sanearClienteDeclarado('cliente-sdk') }
            : { canal, habilidad: 'ficha_grupo' },
        );
      }
    }
    const p = f.leer();
    assert.equal(p.total, FILAS_ESPERADAS_INICIALES);
    assert.equal(p.api.length, 2);
    assert.deepEqual(
      p.api.map((r) => r.estadoHttp),
      [HTTP_ERROR, HTTP_OK],
    );
    assert.equal(p.mcp[0]?.consultas, 2);
    assert.equal(p.a2a[0]?.consultas, 2);
    assert.equal(p.mcp[0]?.categoriaCliente, 'declarado');
    assert.equal(f.sql.filas('SELECT consultas FROM instituciones WHERE id=?', f.id)[0]?.consultas, 2);
    assert.equal(
      f.sql.filas('SELECT ultima_conexion FROM instituciones_claves WHERE id=?', f.clave.id)[0]?.ultima_conexion,
      AHORA,
    );
    const guardado = JSON.stringify(f.sql.filas('SELECT * FROM conectividad_uso'));
    for (const dato of [
      f.secreto,
      f.clave.huella,
      'administracion@example.invalid',
      'arguments',
      'authorization',
      '192.0.2.1',
    ]) {
      assert(!guardado.includes(dato));
    }
  } finally {
    f.db.close();
  }
});
test('nombre MCP declarado: saneado PII y tokens, estados explícitos, límite diario de cardinalidad', () => {
  const f = fixture();
  try {
    const omitidos = [
      'persona@example.invalid',
      'Me llamo Laura',
      '612 345 678',
      'A'.repeat(LONGITUD_SECRETO),
      'cliente\nSDK',
    ];
    for (const nombre of omitidos) {
      const limpio = sanearClienteDeclarado(nombre);
      assert.equal(limpio.categoriaCliente, 'omitido');
      assert.equal(limpio.clienteDeclarado, null);
      f.anotar({ canal: 'mcp', consulta: 'ficha_grupo', ...limpio });
    }
    f.anotar({ canal: 'mcp', consulta: 'ficha_grupo', ...sanearClienteDeclarado(undefined) });
    for (let i = 0; i < LIMITES_CONECTIVIDAD.clientesDeclaradosPorDia + 2; i++) {
      f.anotar({ canal: 'mcp', consulta: 'ficha_grupo', ...sanearClienteDeclarado(`cliente-sdk-${i}`) });
    }
    const filas = f.sql.filas("SELECT * FROM conectividad_uso WHERE canal='mcp'");
    assert.equal(
      filas.filter((r) => r.categoria_cliente === 'declarado').length,
      LIMITES_CONECTIVIDAD.clientesDeclaradosPorDia,
    );
    assert.equal(filas.find((r) => r.categoria_cliente === 'otros')?.consultas, 2);
    assert.equal(filas.find((r) => r.categoria_cliente === 'omitido')?.consultas, omitidos.length);
    assert.equal(filas.find((r) => r.categoria_cliente === 'no_declarado')?.consultas, 1);
    assert(!JSON.stringify(filas).includes('persona@example.invalid'));
  } finally {
    f.db.close();
  }
});
test('10.000 filas entre los tres canales y paginación global de 50 sin duplicados ni sumas de llamadas como total', () => {
  const f = fixture();
  try {
    f.anotar({ canal: 'mcp', consulta: 'ficha_grupo', ...sanearClienteDeclarado(undefined) });
    for (let i = 0; i < LIMITES_CONECTIVIDAD.registrosOperativos; i++) {
      f.anotar(f.api(), AHORA + i);
    }
    const ahoraFinal = AHORA + LIMITES_CONECTIVIDAD.registrosOperativos - 1;
    const primera = f.leer(1, ahoraFinal),
      segunda = f.leer(2, ahoraFinal);
    assert.equal(primera.total, LIMITES_CONECTIVIDAD.registrosOperativos);
    assert.equal(primera.api.length + primera.mcp.length + primera.a2a.length, LIMITES_CONECTIVIDAD.porPagina);
    assert.equal(segunda.api.length, LIMITES_CONECTIVIDAD.porPagina);
    assert.equal(f.sql.filas("SELECT count(*) AS n FROM conectividad_uso WHERE canal='mcp'")[0]?.n, 0);
    const fechas = [...primera.api, ...segunda.api].map((r) => r.fecha);
    assert.equal(new Set(fechas).size, LIMITES_CONECTIVIDAD.porPagina * 2);
  } finally {
    f.db.close();
  }
});
test('retención exacta, preparación y limpieza repetibles; conserva controles e institución', () => {
  const f = fixture();
  try {
    f.anotar(f.api());
    const controles = f.sql.filas('SELECT * FROM administracion_controles'),
      instituciones = f.sql.filas('SELECT * FROM instituciones');
    assert.equal(
      f.usar((s) => siguienteVencimientoAccesosSqlite(s)),
      AHORA + RETENCION_MS,
    );
    assert.equal(f.leer(1, AHORA + RETENCION_MS - 1).total, 1);
    assert.equal(f.leer(1, AHORA + RETENCION_MS).total, 0);
    f.usar((s) => depurarAccesosSqlite(s, AHORA + RETENCION_MS));
    f.usar((s) => prepararAccesosSqlite(s, AHORA + RETENCION_MS));
    assert.equal(
      f.usar((s) => siguienteVencimientoAccesosSqlite(s)),
      null,
    );
    assert.deepEqual(f.sql.filas('SELECT * FROM administracion_controles'), controles);
    assert.deepEqual(f.sql.filas('SELECT * FROM instituciones'), instituciones);
    assert.throws(() => f.leer(1, AHORA), RegistroAccesosNoValido);
  } finally {
    f.db.close();
  }
});
test('entradas cerradas no aceptan parámetros, cabeceras, cliente sin sanear, canal o consulta libres', () => {
  const f = fixture();
  try {
    for (const entrada of [
      { ...f.api(), arguments: { texto: 'NO GUARDAR' } },
      { ...f.api(), consulta: 'ruta/NO-GUARDAR' },
      {
        canal: 'mcp',
        consulta: 'ficha_grupo',
        clienteDeclarado: 'persona@example.invalid',
        categoriaCliente: 'declarado',
      },
      { canal: 'a2a', habilidad: 'ficha_grupo', authorization: 'Bearer NO-GUARDAR' },
      { canal: 'libre', habilidad: 'ficha_grupo' },
    ]) {
      assert.throws(() => leerUsoConectividad(entrada), SolicitudAccesoInvalida);
    }
    assert.equal(f.leer().total, 0);
  } finally {
    f.db.close();
  }
});
test('pérdida de tablas y fechas dañadas son fallos técnicos; no se reparan ni se eliminan como vencidas', () => {
  for (const fecha of [-1, AHORA + 1, Number.MAX_SAFE_INTEGER]) {
    const f = fixture();
    try {
      f.anotar(f.api());
      f.sql.ejecutar('UPDATE conectividad_uso SET fecha=?', fecha);
      assert.throws(() => f.leer(), RegistroAccesosNoValido);
      assert.equal(f.sql.filas('SELECT count(*) AS n FROM conectividad_uso')[0]?.n, 1);
    } finally {
      f.db.close();
    }
  }
  const f = fixture();
  try {
    f.db.exec('DROP TABLE conectividad_uso; DROP TABLE conectividad_uso_estado');
    assert.throws(() => f.usar((s) => prepararAccesosSqlite(s, AHORA)), RegistroAccesosNoValido);
    assert.equal(f.sql.filas("SELECT name FROM sqlite_master WHERE name LIKE 'conectividad_uso%'").length, 0);
  } finally {
    f.db.close();
  }
});

test('el contrato remoto no convierte una página incompleta en ausencia ni admite columnas adicionales', () => {
  const f = fixture();
  try {
    f.anotar(f.api());
    const pagina = f.leer();
    assert.deepEqual(leerPaginaAccesosRecibida(pagina), pagina);
    const primera = pagina.api[0];
    assert(primera);
    for (const entrada of [
      { ...pagina, api: [] },
      { ...pagina, total: 0 },
      { ...pagina, api: [{ ...primera, parametros: 'NO GUARDAR' }] },
      { ...pagina, api: [{ ...primera, institucion: 'Nombre\nno válido' }] },
      { ...pagina, extra: true },
    ]) {
      assert.throws(() => leerPaginaAccesosRecibida(entrada));
    }
    assert.equal(leerPaginaAccesosRecibida(f.leer(2)).api.length, 0);
  } finally {
    f.db.close();
  }
});
