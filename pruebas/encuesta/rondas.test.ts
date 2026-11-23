/**
 * Las rondas de la encuesta: la encuesta del esquema 3 pasa entera a la ronda «Piloto Citilab», con sus códigos y sus
 * respuestas; solo una ronda está abierta a la vez; cerrar una congela sus resultados y se puede abrir otra después; y
 * los resultados de cada ronda se leen siempre, por el panel real y el objeto durable real.
 */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { codigoNuevo, huellaDelCodigo } from '../../src/encuesta/codigos.ts';
import { MAX_NOMBRE_LOTE } from '../../src/encuesta/contrato.ts';
import { CUESTIONARIO, PREGUNTAS } from '../../src/encuesta/cuestionario.ts';
import { crearPuntoDeEncuesta } from '../../src/encuesta/punto-publico.ts';
import { envio, montarEncuesta, PARTICIPANTE_COMPLETO } from './montaje.ts';

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const EMITIDOS = 4;
const PRIMERA = 1;
const SEGUNDA = 2;
interface Ronda {
  numero: number;
  nombre: string;
  inicio: string | null;
  cierre: string | null;
  abierta: boolean;
  invitaciones: number;
  respuestas: number;
}
interface Encuesta {
  ronda: Ronda;
  rondas: Ronda[];
  abierta: boolean;
  lotes: { numero: number }[];
  recuentos: { participante: { respuestas: number; preguntas: Record<string, { valores: Record<string, number> }> } };
}
type Montaje = Awaited<ReturnType<typeof montarEncuesta>>;

async function encuestaDe(respuesta: Response): Promise<Encuesta> {
  assert.equal(respuesta.status, ESTADO_HTTP.correcto, await respuesta.clone().text());
  return ((await respuesta.json()) as { encuesta: Encuesta }).encuesta;
}
async function loteDeParticipantes(montaje: Montaje, cantidad = EMITIDOS): Promise<string[]> {
  const creado = await montaje.panel('encuesta/crear-lote', montaje.token, { tipo: 'participante', cantidad });
  assert.equal(creado.status, ESTADO_HTTP.correcto);
  return ((await creado.json()) as { codigos: { codigo: string }[] }).codigos.map((c) => c.codigo);
}
async function responder(montaje: Montaje, codigo: string): Promise<number> {
  const punto = crearPuntoDeEncuesta();
  return (await punto(envio({ codigo, respuestas: PARTICIPANTE_COMPLETO }), montaje.encuesta)).status;
}

/** El esquema 3 tal como lo creaba la encuesta publicada, con un lote, sus códigos y sus recuentos. */
function sembrarEsquema3(db: DatabaseSync, abierta: 0 | 1, sinUsar: readonly string[], consumidos: number): void {
  db.exec(`ALTER TABLE publico_estado ADD COLUMN encuesta_version INTEGER NOT NULL DEFAULT 0
    CHECK(encuesta_version IN (0,1))`);
  db.exec(`CREATE TABLE encuesta_estado (
    id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL CHECK(version=3),
    abierta INTEGER NOT NULL CHECK(abierta IN (0,1)),
    cuestionario TEXT NOT NULL CHECK(length(cuestionario) BETWEEN 1 AND 40)) STRICT`);
  db.exec(`CREATE TABLE encuesta_lotes (
    id TEXT PRIMARY KEY, numero INTEGER NOT NULL UNIQUE CHECK(numero>=1),
    tipo TEXT NOT NULL CHECK(tipo IN ('participante','profesional')), emitidos INTEGER NOT NULL CHECK(emitidos>=1),
    consumidos INTEGER NOT NULL CHECK(consumidos>=0 AND consumidos<=emitidos),
    nombre TEXT CHECK(nombre IS NULL OR length(nombre) BETWEEN 1 AND 60)) STRICT`);
  db.exec(`CREATE TABLE encuesta_codigos (
    huella TEXT PRIMARY KEY CHECK(length(huella)=64), lote TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK(tipo IN ('participante','profesional'))) STRICT, WITHOUT ROWID`);
  db.exec(`CREATE TABLE encuesta_recuentos (
    tipo TEXT NOT NULL, pregunta TEXT NOT NULL, valor TEXT NOT NULL, recuento INTEGER NOT NULL CHECK(recuento>=0),
    PRIMARY KEY(tipo,pregunta,valor)) STRICT, WITHOUT ROWID`);
  db.prepare('INSERT INTO encuesta_estado VALUES(1,3,?,?)').run(abierta, CUESTIONARIO);
  const celda = db.prepare('INSERT INTO encuesta_recuentos VALUES(?,?,?,?)');
  for (const [tipo, preguntas] of Object.entries(PREGUNTAS)) {
    for (const [pregunta, valores] of Object.entries(preguntas)) {
      for (const valor of valores) {
        const elegido = tipo === 'participante' && String(Reflect.get(PARTICIPANTE_COMPLETO, pregunta)) === valor;
        celda.run(tipo, pregunta, valor, elegido ? consumidos : 0);
      }
    }
  }
  const lote = '33333333-3333-4333-8333-333333333333';
  db.prepare('INSERT INTO encuesta_lotes VALUES(?,1,?,?,?,?)').run(
    lote,
    'participante',
    sinUsar.length + consumidos,
    consumidos,
    'Citilab',
  );
  for (const codigo of sinUsar) {
    db.prepare('INSERT INTO encuesta_codigos VALUES(?,?,?)').run(huellaDelCodigo(codigo), lote, 'participante');
  }
  db.exec('UPDATE publico_estado SET encuesta_version=1 WHERE id=1');
}
/** Los recuentos guardados de una ronda, como «tipo.pregunta=valor:recuento», ordenados. */
function recuentos(db: DatabaseSync, condicion = '1'): string[] {
  const filas = db.prepare(`SELECT tipo,pregunta,valor,recuento FROM encuesta_recuentos WHERE ${condicion}`).all() as {
    tipo: string;
    pregunta: string;
    valor: string;
    recuento: number;
  }[];
  return filas.map((f) => `${f.tipo}.${f.pregunta}=${f.valor}:${f.recuento}`).sort();
}

for (const abierta of [1, 0] as const) {
  test(`la encuesta ${abierta ? 'abierta' : 'cerrada'} del esquema 3 pasa a «Piloto Citilab» sin perder códigos ni respuestas`, async () => {
    const db = new DatabaseSync(':memory:');
    try {
      const montaje = await montarEncuesta(db);
      const sinUsar = abierta ? [codigoNuevo('participante'), codigoNuevo('participante')] : [];
      const consumidos = 3;
      sembrarEsquema3(db, abierta, sinUsar, consumidos);
      const recuentosAntes = recuentos(db);
      const huellasAntes = db.prepare('SELECT huella FROM encuesta_codigos ORDER BY huella').all();
      const encuesta = await encuestaDe(await montaje.panel('encuesta/resultados', montaje.token));
      assert.deepEqual(encuesta.rondas, [
        {
          numero: PRIMERA,
          nombre: 'Piloto Citilab',
          inicio: null,
          cierre: null,
          abierta: abierta === 1,
          invitaciones: sinUsar.length + consumidos,
          respuestas: consumidos,
        },
      ]);
      // Las mismas cifras y las mismas huellas, ahora en la ronda 1.
      assert.deepEqual(recuentos(db, `ronda=${PRIMERA}`), recuentosAntes);
      assert.deepEqual(db.prepare('SELECT huella FROM encuesta_codigos ORDER BY huella').all(), huellasAntes);
      if (abierta) {
        // Los códigos repartidos siguen sirviendo y su respuesta se suma a la misma ronda.
        assert.equal(await responder(montaje, sinUsar[0] ?? ''), ESTADO_HTTP.correcto);
        const despues = await encuestaDe(await montaje.panel('encuesta/resultados', montaje.token));
        assert.equal(despues.ronda.respuestas, consumidos + 1);
      } else {
        assert.equal(encuesta.recuentos.participante.respuestas, consumidos);
        assert.equal(encuesta.recuentos.participante.preguntas.comprension?.valores['4'], consumidos);
      }
    } finally {
      db.close();
    }
  });
}

/** El piloto con una respuesta, cerrado, y la segunda ronda abierta: el punto de partida de las dos pruebas siguientes. */
async function pilotoCerradoYSegundaAbierta(db: DatabaseSync) {
  const montaje = await montarEncuesta(db);
  const primeros = await loteDeParticipantes(montaje);
  assert.equal(await responder(montaje, primeros[0] ?? ''), ESTADO_HTTP.correcto);
  // Con la ronda del piloto abierta no se abre otra: las respuestas de un grupo no se reparten entre dos rondas.
  const otra = await montaje.panel('encuesta/abrir-ronda', montaje.token, { nombre: 'Segundo grupo' });
  assert.equal(otra.status, ESTADO_HTTP.conflicto);
  assert.deepEqual(await otra.json(), { error: 'ronda_abierta' });
  const cerrada = await encuestaDe(await montaje.panel('encuesta/cerrar', montaje.token));
  assert.equal(cerrada.ronda.abierta, false);
  assert.match(cerrada.ronda.cierre ?? '', DIA);
  assert.equal(cerrada.recuentos.participante.respuestas, 1);
  const congelados = recuentos(db, `ronda=${PRIMERA}`);
  const nueva = await encuestaDe(
    await montaje.panel('encuesta/abrir-ronda', montaje.token, { nombre: 'Segundo grupo' }),
  );
  return { montaje, primeros, congelados, nueva };
}

test('una ronda abierta a la vez; cerrarla congela sus resultados y la siguiente empieza de cero', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const { montaje, primeros, nueva } = await pilotoCerradoYSegundaAbierta(db);
    assert.deepEqual(
      { ...nueva.ronda, inicio: DIA.test(nueva.ronda.inicio ?? '') },
      {
        numero: SEGUNDA,
        nombre: 'Segundo grupo',
        inicio: true,
        cierre: null,
        abierta: true,
        invitaciones: 0,
        respuestas: 0,
      },
    );
    assert.deepEqual(
      nueva.rondas.map((r) => [r.numero, r.abierta]),
      [
        [PRIMERA, false],
        [SEGUNDA, true],
      ],
    );
    // Un código de la ronda cerrada ya no sirve, ni siquiera con otra ronda abierta.
    assert.equal(await responder(montaje, primeros[1] ?? ''), ESTADO_HTTP.conflicto);
  } finally {
    db.close();
  }
});

test('los resultados de cada ronda se leen siempre y los de la cerrada no cambian', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const { montaje, congelados } = await pilotoCerradoYSegundaAbierta(db);
    const segundos = await loteDeParticipantes(montaje);
    assert.equal(await responder(montaje, segundos[0] ?? ''), ESTADO_HTTP.correcto);
    assert.equal(await responder(montaje, segundos[1] ?? ''), ESTADO_HTTP.correcto);
    // La ronda cerrada no cambia y sus resultados se siguen leyendo; los de la abierta no se ven hasta cerrarla.
    assert.deepEqual(recuentos(db, `ronda=${PRIMERA}`), congelados);
    const piloto = await encuestaDe(await montaje.panel('encuesta/resultados', montaje.token, { ronda: PRIMERA }));
    assert.equal(piloto.recuentos.participante.respuestas, 1);
    assert.deepEqual(
      piloto.lotes.map((l) => l.numero),
      [1],
    );
    const enCurso = await encuestaDe(await montaje.panel('encuesta/resultados', montaje.token));
    assert.equal(enCurso.ronda.numero, SEGUNDA);
    assert.equal(enCurso.recuentos, null);
    // Los números de lote siguen de una ronda a otra.
    assert.deepEqual(
      enCurso.lotes.map((l) => l.numero),
      [SEGUNDA],
    );
    const segunda = await encuestaDe(await montaje.panel('encuesta/cerrar', montaje.token));
    assert.equal(segunda.recuentos.participante.respuestas, SEGUNDA);
    assert.deepEqual(recuentos(db, `ronda=${PRIMERA}`), congelados);
  } finally {
    db.close();
  }
});

test('el panel rechaza una ronda sin nombre, un nombre que no es texto llano y una ronda que no se puede pedir', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const montaje = await montarEncuesta(db);
    await montaje.panel('encuesta/cerrar', montaje.token);
    for (const cuerpo of [
      {},
      { nombre: '' },
      { nombre: 'Uno\nDos' },
      { nombre: 'x'.repeat(MAX_NOMBRE_LOTE + 1) },
      { nombre: 'A', otro: 1 },
    ]) {
      const rechazo = await montaje.panel('encuesta/abrir-ronda', montaje.token, cuerpo);
      assert.equal(rechazo.status, ESTADO_HTTP.solicitudIncorrecta, JSON.stringify(cuerpo));
    }
    for (const cuerpo of [{ ronda: 0 }, { ronda: '1' }, { ronda: null }, { ronda: 1, otra: 2 }]) {
      const rechazo = await montaje.panel('encuesta/resultados', montaje.token, cuerpo);
      assert.equal(rechazo.status, ESTADO_HTTP.solicitudIncorrecta, JSON.stringify(cuerpo));
    }
    // El día lo pone el servidor: el panel no puede fecharla.
    const fechada = await montaje.panel('encuesta/cerrar', montaje.token, { dia: '2020-01-01' });
    assert.equal(fechada.status, ESTADO_HTTP.solicitudIncorrecta);
  } finally {
    db.close();
  }
});
