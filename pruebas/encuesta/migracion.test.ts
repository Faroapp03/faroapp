/**
 * Pasar una encuesta guardada al esquema y al cuestionario vigentes (esquema-sqlite.ts). Sin estrenar (ningún código
 * consumido y todos los recuentos a cero), rehace las celdas y conserva lotes y códigos. Con una sola respuesta, se
 * niega con CuestionarioConRespuestas y la base queda exactamente como estaba. Un esquema que no tiene las columnas
 * esperadas no se da por bueno.
 */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { codigoNuevo, huellaDelCodigo } from '../../src/encuesta/codigos.ts';
import { CUESTIONARIO, PREGUNTAS } from '../../src/encuesta/cuestionario.ts';
import {
  CuestionarioConRespuestas,
  prepararEncuestaSqlite,
  RegistroEncuestaNoValido,
} from '../../src/encuesta/esquema-sqlite.ts';
import { crearPuntoDeEncuesta } from '../../src/encuesta/punto-publico.ts';
import type { SqlAccesoPublico, ValorSql } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { envio, montarEncuesta, PARTICIPANTE_COMPLETO } from './montaje.ts';

const ESQUEMA_VIGENTE = 4;
const ESCALA = ['1', '2', '3', '4', '5'];
/** Las celdas del cuestionario anterior, que los esquemas 1 y 2 guardaban sin identificarlo. */
const CELDAS_ANTERIORES: Record<string, Record<string, readonly string[]>> = {
  participante: {
    recorrido: ['completado', 'no_pude_completarlo'],
    ocupacion: ['si', 'en_parte', 'no'],
    comprension: ESCALA,
    utilidad: ESCALA,
  },
  profesional: {
    claridad: ESCALA,
    utilidadSesion: ESCALA,
    confianzaDatos: ESCALA,
    adecuacionFormacion: ESCALA,
    valoracionGlobal: ESCALA,
  },
};
/** Una respuesta del cuestionario anterior, como celdas «pregunta=valor». */
const RESPUESTA_ANTERIOR = ['recorrido=completado', 'ocupacion=si', 'comprension=4', 'utilidad=5'];

interface Siembra {
  /** La versión del esquema guardado: 1 (sin el nombre del lote) o 2. */
  readonly version: 1 | 2;
  /** Los códigos sin usar del lote. */
  readonly codigos: readonly string[];
  /** Códigos ya consumidos en el lote. */
  readonly consumidos?: number;
  /** Si las celdas de RESPUESTA_ANTERIOR llevan ya una respuesta sumada. */
  readonly conRecuentos?: boolean;
  /** Un almacén de ensayo de la versión 1 que ya tenía la columna del nombre. */
  readonly conNombre?: boolean;
}
function sembrarCeldasAnteriores(db: DatabaseSync, conRecuentos: boolean) {
  const celda = db.prepare('INSERT INTO encuesta_recuentos VALUES(?,?,?,?)');
  for (const [tipo, preguntas] of Object.entries(CELDAS_ANTERIORES)) {
    for (const [pregunta, valores] of Object.entries(preguntas)) {
      for (const valor of valores) {
        const sumada = conRecuentos && tipo === 'participante' && RESPUESTA_ANTERIOR.includes(`${pregunta}=${valor}`);
        celda.run(tipo, pregunta, valor, sumada ? 1 : 0);
      }
    }
  }
}
/** El esquema 1 o 2 tal como lo creaba la encuesta publicada, con un lote de participantes. */
function sembrarAnterior(db: DatabaseSync, siembra: Siembra): string {
  const { version, codigos, consumidos = 0, conRecuentos = false } = siembra;
  const conNombre = siembra.conNombre ?? version === 2;
  db.exec(`ALTER TABLE publico_estado ADD COLUMN encuesta_version INTEGER NOT NULL DEFAULT 0
    CHECK(encuesta_version IN (0,1))`);
  db.exec(`CREATE TABLE encuesta_estado (
    id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL CHECK(version=${version}),
    abierta INTEGER NOT NULL CHECK(abierta IN (0,1))) STRICT`);
  db.exec(`CREATE TABLE encuesta_lotes (
    id TEXT PRIMARY KEY, numero INTEGER NOT NULL UNIQUE CHECK(numero>=1),
    tipo TEXT NOT NULL CHECK(tipo IN ('participante','profesional')), emitidos INTEGER NOT NULL CHECK(emitidos>=1),
    consumidos INTEGER NOT NULL CHECK(consumidos>=0 AND consumidos<=emitidos)${conNombre ? ', nombre TEXT' : ''}) STRICT`);
  db.exec(`CREATE TABLE encuesta_codigos (
    huella TEXT PRIMARY KEY CHECK(length(huella)=64), lote TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK(tipo IN ('participante','profesional'))) STRICT, WITHOUT ROWID`);
  db.exec(`CREATE TABLE encuesta_recuentos (
    tipo TEXT NOT NULL, pregunta TEXT NOT NULL, valor TEXT NOT NULL, recuento INTEGER NOT NULL CHECK(recuento>=0),
    PRIMARY KEY(tipo,pregunta,valor)) STRICT, WITHOUT ROWID`);
  db.exec(`INSERT INTO encuesta_estado VALUES(1,${version},1)`);
  sembrarCeldasAnteriores(db, conRecuentos);
  const lote = crypto.randomUUID();
  db.prepare('INSERT INTO encuesta_lotes (id,numero,tipo,emitidos,consumidos) VALUES(?,1,?,?,?)').run(
    lote,
    'participante',
    codigos.length + consumidos,
    consumidos,
  );
  for (const codigo of codigos) {
    db.prepare('INSERT INTO encuesta_codigos VALUES(?,?,?)').run(huellaDelCodigo(codigo), lote, 'participante');
  }
  db.exec('UPDATE publico_estado SET encuesta_version=1 WHERE id=1');
  return lote;
}
/** El SQLite de la prueba con la forma del almacén, para preparar la encuesta directamente. */
function sqlDe(db: DatabaseSync): SqlAccesoPublico {
  return {
    filas: (sentencia: string, ...valores: ValorSql[]) => db.prepare(sentencia).all(...valores) as never,
    ejecutar: (sentencia: string, ...valores: ValorSql[]) => {
      db.prepare(sentencia).run(...valores);
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
const preparar = (db: DatabaseSync) => sqlDe(db).transaccion(() => prepararEncuestaSqlite(sqlDe(db)));
const columnas = (db: DatabaseSync, tabla: string) =>
  (db.prepare(`SELECT name FROM pragma_table_info('${tabla}')`).all() as { name: string }[]).map((c) => c.name);
/** El esquema y el contenido de todas las tablas de la encuesta, con sus índices, para comprobar que nada ha cambiado. */
function volcadoDeLaEncuesta(db: DatabaseSync): string {
  const objetos = db
    .prepare(
      "SELECT type, name, sql FROM sqlite_master WHERE name LIKE 'encuesta%' OR name='publico_estado' ORDER BY name",
    )
    .all() as { type: string; name: string; sql: string }[];
  return JSON.stringify(
    objetos.map(({ type, name, sql }) => ({
      sql,
      filas: type === 'table' ? db.prepare(`SELECT * FROM "${name}" ORDER BY 1,2`).all() : [],
    })),
  );
}
/** Las celdas guardadas, como «tipo.pregunta=valor», ordenadas. */
function celdasGuardadas(db: DatabaseSync): string[] {
  const filas = db.prepare('SELECT tipo,pregunta,valor,recuento FROM encuesta_recuentos').all() as {
    tipo: string;
    pregunta: string;
    valor: string;
    recuento: number;
  }[];
  assert.ok(filas.every((f) => f.recuento === 0));
  return filas.map((f) => `${f.tipo}.${f.pregunta}=${f.valor}`).sort();
}
const CELDAS_VIGENTES = Object.entries(PREGUNTAS)
  .flatMap(([tipo, preguntas]) =>
    Object.entries(preguntas).flatMap(([pregunta, valores]) => valores.map((v) => `${tipo}.${pregunta}=${v}`)),
  )
  .sort();

for (const version of [1, 2] as const) {
  test(`una encuesta del esquema ${version} sin estrenar pasa al cuestionario vigente sin perder lotes ni códigos`, async () => {
    const db = new DatabaseSync(':memory:');
    try {
      const montaje = await montarEncuesta(db);
      const codigos = [codigoNuevo('participante'), codigoNuevo('participante'), codigoNuevo('participante')];
      const lote = sembrarAnterior(db, { version, codigos });
      const leidos = await montaje.panel('encuesta/resultados', montaje.token);
      assert.equal(leidos.status, ESTADO_HTTP.correcto);
      const { encuesta } = (await leidos.json()) as { encuesta: Record<string, unknown> };
      assert.equal(encuesta.cuestionario, CUESTIONARIO);
      assert.deepEqual(encuesta.lotes, [
        { id: lote, numero: 1, tipo: 'participante', nombre: null, emitidos: 3, consumidos: 0, sinUsar: 3 },
      ]);
      assert.deepEqual(
        { ...db.prepare('SELECT version,cuestionario FROM encuesta_estado').get() },
        {
          version: ESQUEMA_VIGENTE,
          cuestionario: CUESTIONARIO,
        },
      );
      assert.deepEqual(columnas(db, 'encuesta_lotes'), [
        'id',
        'numero',
        'ronda',
        'tipo',
        'emitidos',
        'consumidos',
        'nombre',
      ]);
      // Lo que había es la primera ronda, abierta como estaba la encuesta y sin fechas, que esos esquemas no guardaban.
      assert.deepEqual(
        db
          .prepare('SELECT numero,nombre,inicio,cierre,abierta FROM encuesta_rondas')
          .all()
          .map((fila) => ({ ...fila })),
        [{ numero: 1, nombre: 'Piloto Citilab', inicio: null, cierre: null, abierta: 1 }],
      );
      // Las celdas son las del cuestionario vigente, todas a cero; las anteriores ya no existen.
      assert.deepEqual(celdasGuardadas(db), CELDAS_VIGENTES);
      // Los códigos repartidos siguen sirviendo y responden el cuestionario vigente.
      const punto = crearPuntoDeEncuesta();
      const respuesta = await punto(envio({ codigo: codigos[0], respuestas: PARTICIPANTE_COMPLETO }), montaje.encuesta);
      assert.equal(respuesta.status, ESTADO_HTTP.correcto);
    } finally {
      db.close();
    }
  });
}

/** Encuestas anteriores con alguna huella de respuesta: un código consumido, una celda sumada o las dos cosas. */
const CON_RESPUESTAS = [
  { caso: 'un código consumido y su respuesta sumada', version: 1, consumidos: 1, conRecuentos: true },
  { caso: 'un código consumido y su respuesta sumada', version: 2, consumidos: 1, conRecuentos: true },
  { caso: 'un código consumido sin recuentos', version: 2, consumidos: 1, conRecuentos: false },
  { caso: 'una celda sumada sin códigos consumidos', version: 2, consumidos: 0, conRecuentos: true },
] as const;
for (const { caso, version, consumidos, conRecuentos } of CON_RESPUESTAS) {
  test(`una encuesta del esquema ${version} con ${caso} se niega a cambiar de cuestionario y no toca nada`, async () => {
    const db = new DatabaseSync(':memory:');
    try {
      const montaje = await montarEncuesta(db);
      const codigos = [codigoNuevo('participante'), codigoNuevo('participante')];
      sembrarAnterior(db, { version, codigos, consumidos, conRecuentos });
      const antes = volcadoDeLaEncuesta(db);
      assert.throws(() => preparar(db), CuestionarioConRespuestas);
      assert.equal(volcadoDeLaEncuesta(db), antes);
      // Ni el panel ni el punto público la usan: el panel recibe solo el motivo, con su código cerrado, y en ninguna
      // operación salen resultados ni se crean lotes; el código no se consume.
      for (const [ruta, cuerpo] of [
        ['encuesta/resultados', {}],
        ['encuesta/cerrar', {}],
        ['encuesta/crear-lote', { tipo: 'participante', cantidad: 3, nombre: 'Entidad' }],
      ] as const) {
        const rechazo = await montaje.panel(ruta, montaje.token, cuerpo);
        assert.equal(rechazo.status, ESTADO_HTTP.conflicto, ruta);
        assert.deepEqual(await rechazo.json(), { error: 'cuestionario_anterior' }, ruta);
      }
      const punto = crearPuntoDeEncuesta();
      const respuesta = await punto(envio({ codigo: codigos[0], respuestas: PARTICIPANTE_COMPLETO }), montaje.encuesta);
      assert.equal(respuesta.status, ESTADO_HTTP.noDisponible);
      assert.equal(volcadoDeLaEncuesta(db), antes);
    } finally {
      db.close();
    }
  });
}

test('una encuesta del esquema vigente con otro cuestionario rehace sus celdas solo si no tiene respuestas', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const montaje = await montarEncuesta(db);
    assert.equal((await montaje.panel('encuesta/resultados', montaje.token)).status, ESTADO_HTTP.correcto);
    db.exec("UPDATE encuesta_estado SET cuestionario='faro-piloto-otro'");
    db.exec("INSERT INTO encuesta_recuentos VALUES(1,'participante','sobrante','x',0)");
    preparar(db);
    assert.equal(db.prepare('SELECT cuestionario FROM encuesta_estado').get()?.cuestionario, CUESTIONARIO);
    assert.deepEqual(celdasGuardadas(db), CELDAS_VIGENTES);
    // Con una respuesta sumada, el cambio de cuestionario se niega.
    db.exec("UPDATE encuesta_estado SET cuestionario='faro-piloto-otro'");
    db.exec("UPDATE encuesta_recuentos SET recuento=1 WHERE pregunta='informe' AND valor='sin_ver'");
    const antes = volcadoDeLaEncuesta(db);
    assert.throws(() => preparar(db), CuestionarioConRespuestas);
    assert.equal(volcadoDeLaEncuesta(db), antes);
  } finally {
    db.close();
  }
});

test('una encuesta cuyas tablas no tienen las columnas de su versión no se da por buena', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const montaje = await montarEncuesta(db);
    assert.equal((await montaje.panel('encuesta/resultados', montaje.token)).status, ESTADO_HTTP.correcto);
    db.exec('ALTER TABLE encuesta_lotes DROP COLUMN nombre');
    const leidos = await montaje.panel('encuesta/resultados', montaje.token);
    assert.notEqual(leidos.status, ESTADO_HTTP.correcto);
  } finally {
    db.close();
  }
});

test('un almacén de ensayo del esquema 1 con la columna del nombre ya puesta pasa sin un error crudo de SQLite', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const montaje = await montarEncuesta(db);
    const codigos = [codigoNuevo('participante'), codigoNuevo('participante'), codigoNuevo('participante')];
    sembrarAnterior(db, { version: 1, codigos, conNombre: true });
    preparar(db);
    assert.equal(db.prepare('SELECT version FROM encuesta_estado').get()?.version, ESQUEMA_VIGENTE);
    const punto = crearPuntoDeEncuesta();
    const respuesta = await punto(envio({ codigo: codigos[1], respuestas: PARTICIPANTE_COMPLETO }), montaje.encuesta);
    assert.equal(respuesta.status, ESTADO_HTTP.correcto);
  } finally {
    db.close();
  }
});

test('un resto de una migración a medias bloquea la encuesta sin un error crudo de SQLite', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const montaje = await montarEncuesta(db);
    sembrarAnterior(db, { version: 1, codigos: [codigoNuevo('participante'), codigoNuevo('participante')] });
    db.exec('CREATE TABLE encuesta_estado_nueva (id INTEGER)');
    // El error es el propio del almacén, no uno de SQLite; el punto público lo convierte en 503.
    assert.throws(() => preparar(db), RegistroEncuestaNoValido);
    const punto = crearPuntoDeEncuesta();
    const respuesta = await punto(
      envio({ codigo: codigoNuevo('participante'), respuestas: PARTICIPANTE_COMPLETO }),
      montaje.encuesta,
    );
    assert.equal(respuesta.status, ESTADO_HTTP.noDisponible);
    assert.equal(db.prepare('SELECT version FROM encuesta_estado').get()?.version, 1);
  } finally {
    db.close();
  }
});

/** Tablas de estado anteriores a las que les falta una columna o con un valor fuera de lo admitido. */
const ESTADOS_DEFECTUOSOS = [
  { caso: 'sin version', tabla: '(id INTEGER PRIMARY KEY, abierta INTEGER)', fila: '(1,1)' },
  { caso: 'sin abierta', tabla: '(id INTEGER PRIMARY KEY, version INTEGER)', fila: '(1,1)' },
  {
    caso: 'abierta fuera de lo admitido',
    tabla: '(id INTEGER PRIMARY KEY, version INTEGER, abierta INTEGER)',
    fila: '(1,1,7)',
  },
  {
    caso: 'con una versión que no existe',
    tabla: '(id INTEGER PRIMARY KEY, version INTEGER, abierta INTEGER)',
    fila: '(1,9,1)',
  },
];
for (const { caso, tabla, fila } of ESTADOS_DEFECTUOSOS) {
  test(`una tabla de estado ${caso} bloquea la encuesta con su error propio, no con uno de SQLite`, async () => {
    const db = new DatabaseSync(':memory:');
    try {
      await montarEncuesta(db);
      sembrarAnterior(db, { version: 1, codigos: [codigoNuevo('participante'), codigoNuevo('participante')] });
      db.exec('DROP TABLE encuesta_estado');
      db.exec(`CREATE TABLE encuesta_estado ${tabla}`);
      db.exec(`INSERT INTO encuesta_estado VALUES ${fila}`);
      assert.throws(() => preparar(db), RegistroEncuestaNoValido);
      // Nada a medias: la tabla de estado sigue como estaba.
      assert.equal(
        db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='encuesta_estado_nueva'").get()?.n,
        0,
      );
    } finally {
      db.close();
    }
  });
}
