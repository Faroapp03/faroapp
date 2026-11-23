/**
 * El almacén de la encuesta en el SQLite de un objeto durable de verdad: Miniflare arranca workerd en este equipo, sin
 * red, con el código real de src/encuesta/almacen-sqlite.ts empaquetado. Acredita que workerd admite lo que usa la
 * encuesta: crear sus tablas, leer sus columnas (pragma_table_info), migrar del esquema 1 al vigente con el cuestionario
 * vigente (DROP y RENAME de encuesta_estado, ADD COLUMN y celdas rehechas), negarse a migrar una encuesta con
 * respuestas sin dejar nada a medias, y crear y consultar un lote.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const requerir = createRequire(import.meta.url);
const HTTP_CORRECTO = 200;

/** El objeto durable de ensayo: prepara la encuesta con el código real y responde lo que queda en su base. */
const ENTRADA = `
import { cerrarEncuestaSqlite, crearLoteSqlite, leerResultadosSqlite } from ${JSON.stringify(
  fileURLToPath(new URL('../../src/encuesta/almacen-sqlite.ts', import.meta.url)),
)};
import { prepararEncuestaSqlite } from ${JSON.stringify(
  fileURLToPath(new URL('../../src/encuesta/esquema-sqlite.ts', import.meta.url)),
)};
import { sqlDelObjetoDurable } from ${JSON.stringify(
  fileURLToPath(new URL('../../src/plataforma/acceso-publico/durable.ts', import.meta.url)),
)};
const VERSION_1 = [
  'CREATE TABLE publico_estado (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL)',
  'INSERT INTO publico_estado VALUES(1,1)',
  'ALTER TABLE publico_estado ADD COLUMN encuesta_version INTEGER NOT NULL DEFAULT 0 CHECK(encuesta_version IN (0,1))',
  'CREATE TABLE encuesta_estado (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL CHECK(version=1), abierta INTEGER NOT NULL CHECK(abierta IN (0,1))) STRICT',
  "CREATE TABLE encuesta_lotes (id TEXT PRIMARY KEY, numero INTEGER NOT NULL UNIQUE CHECK(numero>=1), tipo TEXT NOT NULL CHECK(tipo IN ('participante','profesional')), emitidos INTEGER NOT NULL CHECK(emitidos>=1), consumidos INTEGER NOT NULL CHECK(consumidos>=0 AND consumidos<=emitidos)) STRICT",
  "CREATE TABLE encuesta_codigos (huella TEXT PRIMARY KEY CHECK(length(huella)=64), lote TEXT NOT NULL, tipo TEXT NOT NULL CHECK(tipo IN ('participante','profesional'))) STRICT, WITHOUT ROWID",
  'CREATE TABLE encuesta_recuentos (tipo TEXT NOT NULL, pregunta TEXT NOT NULL, valor TEXT NOT NULL, recuento INTEGER NOT NULL CHECK(recuento>=0), PRIMARY KEY(tipo,pregunta,valor)) STRICT, WITHOUT ROWID',
  'INSERT INTO encuesta_estado VALUES(1,1,1)',
  // Un lote de tres repartido y sin estrenar.
  "INSERT INTO encuesta_lotes VALUES('11111111-1111-4111-8111-111111111111',1,'participante',3,0)",
  "INSERT INTO encuesta_codigos VALUES('" + 'd'.repeat(64) + "','11111111-1111-4111-8111-111111111111','participante')",
  "INSERT INTO encuesta_codigos VALUES('" + 'e'.repeat(64) + "','11111111-1111-4111-8111-111111111111','participante')",
  "INSERT INTO encuesta_codigos VALUES('" + 'f'.repeat(64) + "','11111111-1111-4111-8111-111111111111','participante')",
  'UPDATE publico_estado SET encuesta_version=1 WHERE id=1',
];
/** Las celdas del cuestionario anterior, que el esquema 1 guardaba sin identificarlo. */
const ESCALA = ['1', '2', '3', '4', '5'];
const CELDAS_ANTERIORES = {
  participante: { recorrido: ['completado', 'no_pude_completarlo'], ocupacion: ['si', 'en_parte', 'no'], comprension: ESCALA, utilidad: ESCALA },
  profesional: { claridad: ESCALA, utilidadSesion: ESCALA, confianzaDatos: ESCALA, adecuacionFormacion: ESCALA, valoracionGlobal: ESCALA },
};
/** Una respuesta del cuestionario anterior: completó el recorrido, «sí», comprensión 4 y utilidad 5. */
const SUMADAS = ['recorrido=completado', 'ocupacion=si', 'comprension=4', 'utilidad=5'];
function sembrarRecuentos(sql, conRespuesta) {
  for (const [tipo, preguntas] of Object.entries(CELDAS_ANTERIORES)) {
    for (const [pregunta, valores] of Object.entries(preguntas)) {
      for (const valor of valores) {
        const sumada = conRespuesta && tipo === 'participante' && SUMADAS.includes(pregunta + '=' + valor);
        sql.ejecutar('INSERT INTO encuesta_recuentos VALUES(?,?,?,?)', tipo, pregunta, valor, sumada ? 1 : 0);
      }
    }
  }
}
function sembrarVersion1(sql, conRespuesta) {
  sql.transaccion(() => {
    for (const sentencia of VERSION_1) {
      sql.ejecutar(sentencia);
    }
    sembrarRecuentos(sql, conRespuesta);
    if (conRespuesta) {
      sql.ejecutar("UPDATE encuesta_lotes SET consumidos=1");
      sql.ejecutar("DELETE FROM encuesta_codigos WHERE huella='" + 'f'.repeat(64) + "'");
    }
  });
}
/** Lo que queda de una encuesta del esquema 1 con una respuesta después de intentar prepararla. */
function rechazoDeLaVersion1(sql) {
  sembrarVersion1(sql, true);
  let rechazo = null;
  try {
    sql.transaccion(() => prepararEncuestaSqlite(sql));
  } catch (error) {
    rechazo = error.name;
  }
  return Response.json({
    rechazo,
    version: sql.filas('SELECT version FROM encuesta_estado')[0].version,
    columnas: sql.filas("SELECT name FROM pragma_table_info('encuesta_estado')").map((fila) => fila.name),
    consumidos: sql.filas('SELECT consumidos FROM encuesta_lotes')[0].consumidos,
    celdas: sql.filas('SELECT count(*) AS n FROM encuesta_recuentos')[0].n,
    sumadas: sql.filas('SELECT count(*) AS n FROM encuesta_recuentos WHERE recuento=1')[0].n,
  });
}
export class Encuesta {
  constructor(estado) {
    this.estado = estado;
  }
  async fetch(peticion) {
    // El mismo adaptador que usa el objeto durable del producto sobre su almacenamiento.
    const sql = sqlDelObjetoDurable(this.estado.storage);
    const desde = new URL(peticion.url).pathname;
    try {
      if (desde === '/version-1-con-respuestas') {
        return rechazoDeLaVersion1(sql);
      }
      if (desde === '/version-1') {
        sembrarVersion1(sql, false);
      } else {
        sql.ejecutar('CREATE TABLE publico_estado (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL)');
        sql.ejecutar('INSERT INTO publico_estado VALUES(1,1)');
      }
      // Dos preparaciones: la primera crea o migra, la segunda comprueba las columnas de una encuesta ya preparada.
      sql.transaccion(() => prepararEncuestaSqlite(sql));
      sql.transaccion(() => prepararEncuestaSqlite(sql));
      const huellas = ['a', 'b', 'c'].map((letra) => letra.repeat(64));
      const lote = { id: '22222222-2222-4222-8222-222222222222', tipo: 'profesional', nombre: 'Entidad \\u{1D504}', huellas };
      const creado = sql.transaccion(() => crearLoteSqlite(sql, lote));
      const resultados = sql.transaccion(() => leerResultadosSqlite(sql));
      const { version, cuestionario } = sql.filas('SELECT version,cuestionario FROM encuesta_estado')[0];
      const columnas = sql.filas("SELECT name FROM pragma_table_info('encuesta_lotes')").map((fila) => fila.name);
      const sinUsar = sql.filas('SELECT count(*) AS n FROM encuesta_codigos')[0].n;
      const cerrada = sql.transaccion(() => cerrarEncuestaSqlite(sql, '2026-11-23'));
      return Response.json({
        creado: creado.estado,
        ronda: [resultados.ronda.nombre, cerrada.ronda.abierta, cerrada.ronda.cierre],
        lotes: resultados.lotes,
        version,
        cuestionario,
        columnas,
        sinUsar,
        recuentos: cerrada.recuentos.participante,
      });
    } catch (error) {
      return Response.json({ error: String(error && error.message) }, { status: 500 });
    }
  }
}
export default {
  async fetch(peticion, entorno) {
    const objeto = entorno.ENCUESTA.get(entorno.ENCUESTA.idFromName(new URL(peticion.url).pathname));
    return objeto.fetch(peticion);
  },
};
`;

/** Lo que devuelve el objeto durable de ensayo. */
interface Resultado {
  error?: string;
  creado: string;
  ronda: [string, boolean, string | null];
  version: number;
  cuestionario: string;
  columnas: string[];
  lotes: { nombre: string | null; emitidos: number; consumidos: number }[];
  sinUsar: number;
  recuentos: { respuestas: number; preguntas: Record<string, { denominador: number }> };
}
const ESQUEMA_VIGENTE = 4;
const CUESTIONARIO = 'faro-piloto-2';
const NOMBRE = 'Entidad \u{1D504}';
/** Cada lote de la prueba emite tres códigos; el del esquema 1 está repartido y sin estrenar. */
const EMITIDOS = 3;
/** Por ruta: un almacén nuevo, y uno sembrado en el esquema 1 con un lote y sus códigos. */
const ESPERADO = {
  '/nueva': { lotes: [[NOMBRE, EMITIDOS, 0]], sinUsar: EMITIDOS, respuestas: 0, formacion: 0 },
  '/version-1': {
    lotes: [
      [null, EMITIDOS, 0],
      [NOMBRE, EMITIDOS, 0],
    ],
    sinUsar: EMITIDOS + EMITIDOS,
    respuestas: 0,
    formacion: 0,
  },
};
/** Las celdas del cuestionario anterior en el esquema 1: 2 + 3 + 5 + 5 de las personas y 5 × 5 de las profesionales. */
const CELDAS_ANTERIORES = 40;
/** Las celdas que suma la respuesta sembrada: recorrido, ocupación, comprensión y utilidad. */
const SUMADAS = 4;

async function empaquetar(): Promise<string> {
  const { build } = requerir('esbuild') as typeof import('esbuild');
  const salida = await build({
    stdin: { contents: ENTRADA, loader: 'js', resolveDir: fileURLToPath(new URL('../../', import.meta.url)) },
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2024',
    write: false,
    logLevel: 'silent',
  });
  return salida.outputFiles[0]?.text ?? '';
}

test('workerd admite el esquema de la encuesta: crea, comprueba columnas, migra o se niega y crea un lote', async () => {
  const { Miniflare, convertV4MiniflareOptions } = requerir('miniflare');
  const miniflare = new Miniflare(
    convertV4MiniflareOptions({
      name: 'encuesta',
      modules: true,
      compatibilityDate: '2026-10-01',
      script: await empaquetar(),
      durableObjects: { ENCUESTA: { className: 'Encuesta', useSQLite: true } },
    }),
  );
  try {
    for (const [ruta, esperado] of Object.entries(ESPERADO)) {
      const respuesta = await miniflare.dispatchFetch(`http://localhost${ruta}`);
      const cuerpo = (await respuesta.json()) as Resultado;
      assert.equal(respuesta.status, HTTP_CORRECTO, `${ruta}: ${cuerpo.error ?? ''}`);
      assert.equal(cuerpo.creado, 'creado', ruta);
      assert.equal(cuerpo.version, ESQUEMA_VIGENTE, ruta);
      assert.equal(cuerpo.cuestionario, CUESTIONARIO, ruta);
      assert.deepEqual(cuerpo.columnas, ['id', 'numero', 'ronda', 'tipo', 'emitidos', 'consumidos', 'nombre'], ruta);
      // Nueva o migrada, la encuesta empieza en la ronda del piloto, que se cierra el día dado.
      assert.deepEqual(cuerpo.ronda, ['Piloto Citilab', false, '2026-11-23'], ruta);
      // El esquema 1 sin estrenar conserva su lote y sus tres códigos, con las celdas del cuestionario vigente.
      assert.deepEqual(
        {
          lotes: cuerpo.lotes.map((lote) => [lote.nombre, lote.emitidos, lote.consumidos]),
          sinUsar: cuerpo.sinUsar,
          respuestas: cuerpo.recuentos.respuestas,
          formacion: cuerpo.recuentos.preguntas.formacion?.denominador,
        },
        esperado,
        ruta,
      );
    }
    // Con una respuesta, la preparación se niega y la transacción de workerd no deja nada a medias.
    const rechazo = await miniflare.dispatchFetch('http://localhost/version-1-con-respuestas');
    assert.equal(rechazo.status, HTTP_CORRECTO);
    assert.deepEqual(await rechazo.json(), {
      rechazo: 'CuestionarioConRespuestas',
      version: 1,
      columnas: ['id', 'version', 'abierta'],
      consumidos: 1,
      celdas: CELDAS_ANTERIORES,
      sumadas: SUMADAS,
    });
  } finally {
    await miniflare.dispose();
  }
});
