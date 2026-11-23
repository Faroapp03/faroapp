/** La encuesta de punta a punta: lotes, respuestas, cierre, resultados exactos, validación estricta y topes. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { MS_POR_MINUTO, MS_POR_SEGUNDO } from '../../src/comun/tiempo.ts';
import { BITS_DE_ALEATORIEDAD, barajar, codigoNuevo, leerCodigo } from '../../src/encuesta/codigos.ts';
import {
  leerRespuestas,
  leerResultadosEncuesta,
  MAX_CODIGOS_POR_LOTE,
  MAX_LOTES,
  MAX_NOMBRE_LOTE,
  MIN_CODIGOS_POR_LOTE,
} from '../../src/encuesta/contrato.ts';
import { operarEncuestaDurable } from '../../src/encuesta/protocolo-durable.ts';
import {
  crearPuntoDeEncuesta,
  MAX_CUERPO_ENCUESTA_BYTES,
  MAX_ENVIOS_POR_MINUTO,
} from '../../src/encuesta/punto-publico.ts';
import { accesoPanel } from '../ayudas/persistencia-panel.ts';
import { envio, montarEncuesta, PARTICIPANTE_COMPLETO, PROFESIONAL_COMPLETO } from './montaje.ts';

const MIN_BITS = 128;
const PARTICIPANTES = 6;
const PROFESIONALES = 3;
const VERSION_RESULTADOS = 3;
const LARGO_DEL_TOKEN = 43;
const LARGO_DE_HUELLA = 64;
/** El mínimo de códigos por lote que fijó la coordinación (docs/encuesta.md). */
const MINIMO_DECIDIDO = 3;

interface LoteCreado {
  lote: { id: string; numero: number; tipo: string; emitidos: number; consumidos: number; sinUsar: number };
  codigos: { codigo: string; enlaceRelativo: string }[];
}
async function crear(montaje: Awaited<ReturnType<typeof montarEncuesta>>, tipo: string, cantidad: number) {
  const respuesta = await montaje.panel('encuesta/crear-lote', montaje.token, { tipo, cantidad });
  assert.equal(respuesta.status, ESTADO_HTTP.correcto);
  return (await respuesta.json()) as LoteCreado;
}

test('los códigos tienen al menos 128 bits al azar, su tipo delante y un formato que se valida sin copiarlo', () => {
  assert.ok(BITS_DE_ALEATORIEDAD >= MIN_BITS);
  const codigo = codigoNuevo('participante');
  assert.match(codigo, /^PART(-[0-9A-HJKMNP-TV-Z]{4}){7}$/);
  assert.deepEqual(leerCodigo(codigo), { codigo, tipo: 'participante' });
  assert.equal(leerCodigo(codigoNuevo('profesional')).tipo, 'profesional');
  for (const malo of [
    codigo.toLowerCase(),
    `${codigo}-`,
    codigo.replace('PART', 'PROX'),
    codigo.replace(/-/g, ''),
    {},
  ]) {
    assert.throws(() => leerCodigo(malo));
  }
  const muestra = Array.from({ length: 1000 }, () => codigoNuevo('profesional'));
  assert.equal(new Set(muestra).size, muestra.length);
  const lista = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(barajar(lista).sort(), lista);
});

test('las respuestas se validan contra las preguntas de su tipo, sin campos de más ni valores fuera de escala', () => {
  assert.deepEqual(leerRespuestas('participante', { informe: 'sin_ver' }), [{ pregunta: 'informe', valor: 'sin_ver' }]);
  assert.equal(leerRespuestas('participante', PARTICIPANTE_COMPLETO).length, Object.keys(PARTICIPANTE_COMPLETO).length);
  assert.equal(leerRespuestas('profesional', PROFESIONAL_COMPLETO).length, Object.keys(PROFESIONAL_COMPLETO).length);
  // La pregunta de formación admite un punto de la escala, como número, o la opción aparte, como texto.
  const sinVerLaFormacion = leerRespuestas('participante', { ...PARTICIPANTE_COMPLETO, formacion: 'sin_ver' });
  assert.deepEqual(
    sinVerLaFormacion.find((c) => c.pregunta === 'formacion'),
    { pregunta: 'formacion', valor: 'sin_ver' },
  );
  const malas: [string, unknown][] = [
    ['participante', { informe: 'sin_ver', ocupacion: 'si' }],
    ['participante', { ...PARTICIPANTE_COMPLETO, comprension: 6 }],
    ['participante', { ...PARTICIPANTE_COMPLETO, comprension: '4' }],
    ['participante', { ...PARTICIPANTE_COMPLETO, comprension: 'sin_ver' }],
    ['participante', { ...PARTICIPANTE_COMPLETO, formacion: 4.5 }],
    ['participante', { ...PARTICIPANTE_COMPLETO, formacion: '5' }],
    ['participante', { ...PARTICIPANTE_COMPLETO, ocupacion: 3 }],
    ['participante', { ...PARTICIPANTE_COMPLETO, dificultad: 'otra' }],
    ['participante', { ...PARTICIPANTE_COMPLETO, comentario: 'texto libre' }],
    ['participante', { informe: 'visto', ocupacion: 'si', comprension: 4 }],
    ['participante', PROFESIONAL_COMPLETO],
    ['profesional', PARTICIPANTE_COMPLETO],
    ['profesional', { ...PROFESIONAL_COMPLETO, ayudaOrientacion: 0 }],
    ['profesional', { ...PROFESIONAL_COMPLETO, mejora: 3 }],
    ['profesional', { informe: 'sin_ver' }],
    ['profesional', null],
    ['profesional', Object.values(PROFESIONAL_COMPLETO)],
  ];
  for (const [tipo, respuestas] of malas) {
    assert.throws(() => leerRespuestas(tipo as 'participante', respuestas), JSON.stringify(respuestas));
  }
});

/** Cada valor de una escala de 1 a 5 a cero, salvo el elegido, a uno: los recuentos de una sola respuesta. */
function escalaConUna(elegido: number) {
  return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, [elegido]: 1 };
}
/** Una pregunta de escala de una sola respuesta profesional: su recuento, su escala y su meta. */
function profesionalConUna(elegido: number, meta: unknown = null) {
  return { denominador: 1, valores: escalaConUna(elegido), escala: { respuestas: 1, suma: elegido }, meta };
}
/** La meta de proporción de las personas: el 90 % de favorables sobre su base. */
function proporcion(favorables: number, base: number, fueraDeLaBase = 0) {
  return { criterio: 'proporcion', favorables, base, fueraDeLaBase, objetivo: 90 };
}
/**
 * Los recuentos que dejan las respuestas de responderUnaDeCada, exactos y con sus denominadores. La base de las metas
 * son las dos personas que vieron su informe; en formación, una no llegó a ver la propuesta y sale de la base.
 */
const RECUENTOS_ESPERADOS = {
  participante: {
    respuestas: 3,
    preguntas: {
      informe: { denominador: 3, valores: { visto: 2, sin_ver: 1 }, escala: null, meta: null },
      ocupacion: { denominador: 2, valores: { si: 1, en_parte: 1, no: 0 }, escala: null, meta: proporcion(1, 2) },
      comprension: {
        denominador: 2,
        valores: { 1: 0, 2: 0, 3: 1, 4: 1, 5: 0 },
        escala: { respuestas: 2, suma: 7 },
        meta: proporcion(1, 2),
      },
      formacion: {
        denominador: 2,
        valores: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 1, sin_ver: 1 },
        escala: { respuestas: 1, suma: 5 },
        meta: proporcion(1, 1, 1),
      },
      dificultad: {
        denominador: 2,
        valores: { describir_trabajo: 0, elegir_tareas: 0, entender_informe: 1, encontrar_formacion: 0, nada: 1 },
        escala: null,
        meta: null,
      },
    },
  },
  profesional: {
    respuestas: 1,
    preguntas: {
      // La meta de los servicios de orientación es la media de esta pregunta, al menos 4 sobre 5.
      ayudaOrientacion: profesionalConUna(PROFESIONAL_COMPLETO.ayudaOrientacion, { criterio: 'media', objetivo: 4 }),
      explicarCambio: profesionalConUna(PROFESIONAL_COMPLETO.explicarCambio),
      encajeFormacion: profesionalConUna(PROFESIONAL_COMPLETO.encajeFormacion),
      fiabilidad: profesionalConUna(PROFESIONAL_COMPLETO.fiabilidad),
      mejora: {
        denominador: 1,
        valores: {
          explicacion_informe: 0,
          ocupacion: 0,
          datos_fuentes: 0,
          formacion: 0,
          uso_sesion: 0,
          accesibilidad: 1,
          nada: 0,
        },
        escala: null,
        meta: null,
      },
    },
  },
};
type Montaje = Awaited<ReturnType<typeof montarEncuesta>>;
/** Tres participantes (una no vio su informe), un código usado con el formulario ajeno y una profesional. */
async function responderUnaDeCada(montaje: Montaje, participantes: LoteCreado, profesionales: LoteCreado) {
  const punto = crearPuntoDeEncuesta();
  const responder = async (codigo: string, respuestas: unknown) =>
    (await punto(envio({ codigo, respuestas }), montaje.encuesta)).status;
  const [a = '', b = '', c = '', d = ''] = participantes.codigos.map((x) => x.codigo);
  assert.equal(await responder(a, PARTICIPANTE_COMPLETO), ESTADO_HTTP.correcto);
  const enParte = {
    ...PARTICIPANTE_COMPLETO,
    ocupacion: 'en_parte',
    comprension: 3,
    formacion: 'sin_ver',
    dificultad: 'entender_informe',
  };
  assert.equal(await responder(b, enParte), ESTADO_HTTP.correcto);
  assert.equal(await responder(c, { informe: 'sin_ver' }), ESTADO_HTTP.correcto);
  // Un código de participante no vale para el formulario profesional: no se consume.
  assert.equal(await responder(d, PROFESIONAL_COMPLETO), ESTADO_HTTP.solicitudIncorrecta);
  const [p = ''] = profesionales.codigos.map((x) => x.codigo);
  assert.equal(await responder(p, PROFESIONAL_COMPLETO), ESTADO_HTTP.correcto);
  return { responder, sinUsar: d };
}

test('un lote devuelve sus códigos una vez, con su enlace, y numerado en orden de lotes', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const montaje = await montarEncuesta(db);
    const participantes = await crear(montaje, 'participante', PARTICIPANTES);
    const profesionales = await crear(montaje, 'profesional', PROFESIONALES);
    assert.equal(participantes.codigos.length, PARTICIPANTES);
    assert.deepEqual(participantes.lote, {
      id: participantes.lote.id,
      numero: 1,
      tipo: 'participante',
      nombre: null,
      emitidos: PARTICIPANTES,
      consumidos: 0,
      sinUsar: PARTICIPANTES,
    });
    assert.equal(profesionales.lote.numero, 2);
    // Quien participa entra por el inicio con su invitación; las profesionales van directas a la encuesta.
    for (const { codigo, enlaceRelativo } of participantes.codigos) {
      assert.equal(enlaceRelativo, `/inicio.html#invitacion=${codigo}`);
    }
    for (const { codigo, enlaceRelativo } of profesionales.codigos) {
      assert.equal(enlaceRelativo, `/encuesta.html#codigo=${codigo}`);
    }
  } finally {
    db.close();
  }
});

test('abierta solo se ven los códigos; cerrada, los recuentos exactos y ningún código sirve', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const montaje = await montarEncuesta(db);
    const participantes = await crear(montaje, 'participante', PARTICIPANTES);
    const profesionales = await crear(montaje, 'profesional', PROFESIONALES);
    const { responder, sinUsar } = await responderUnaDeCada(montaje, participantes, profesionales);
    const abierta = (await (await montaje.panel('encuesta/resultados', montaje.token)).json()) as {
      encuesta: { abierta: boolean; recuentos: unknown; totales: Record<string, unknown> };
    };
    assert.equal(abierta.encuesta.abierta, true);
    assert.equal(abierta.encuesta.recuentos, null);
    assert.deepEqual(abierta.encuesta.totales.participante, { emitidos: 6, consumidos: 3, sinUsar: 3 });
    const cerrada = await montaje.panel('encuesta/cerrar', montaje.token);
    assert.equal(cerrada.status, ESTADO_HTTP.correcto);
    const { encuesta } = (await cerrada.json()) as { encuesta: Record<string, unknown> };
    // Los resultados dicen a qué cuestionario pertenecen.
    assert.equal(encuesta.version, VERSION_RESULTADOS);
    assert.equal(encuesta.cuestionario, 'faro-piloto-2');
    assert.deepEqual(encuesta.totales, {
      participante: { emitidos: 6, consumidos: 3, sinUsar: 3 },
      profesional: { emitidos: 3, consumidos: 1, sinUsar: 2 },
    });
    assert.deepEqual(encuesta.recuentos, RECUENTOS_ESPERADOS);
    // El lector del contrato solo admite estos resultados tal cual: otro cuestionario, o una meta o una escala que no
    // salgan de sus propias celdas, no pasan.
    assert.deepEqual(leerResultadosEncuesta(encuesta), encuesta);
    const copia = () => structuredClone(encuesta) as typeof encuesta & { recuentos: typeof RECUENTOS_ESPERADOS };
    const otroCuestionario = { ...copia(), cuestionario: 'faro-piloto-1' };
    const metaAlterada = copia();
    metaAlterada.recuentos.participante.preguntas.comprension.meta.favorables = 2;
    const escalaAlterada = copia();
    escalaAlterada.recuentos.participante.preguntas.formacion.escala.respuestas = 2;
    const sinMeta = copia();
    Reflect.deleteProperty(sinMeta.recuentos.profesional.preguntas.ayudaOrientacion, 'meta');
    for (const alterado of [otroCuestionario, metaAlterada, escalaAlterada, sinMeta]) {
      assert.throws(() => leerResultadosEncuesta(alterado));
    }
    assert.equal(db.prepare('SELECT count(*) AS n FROM encuesta_codigos').get()?.n, 0);
    assert.equal(await responder(sinUsar, PARTICIPANTE_COMPLETO), ESTADO_HTTP.conflicto);
    const otro = await montaje.panel('encuesta/crear-lote', montaje.token, {
      tipo: 'participante',
      cantidad: MIN_CODIGOS_POR_LOTE,
    });
    assert.equal(otro.status, ESTADO_HTTP.conflicto);
    assert.deepEqual(await otro.json(), { error: 'encuesta_cerrada' });
  } finally {
    db.close();
  }
});

test('el panel valida la petición de lote, exige sesión y tiene tope de lotes', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const montaje = await montarEncuesta(db);
    for (const cuerpo of [
      { tipo: 'participante', cantidad: -1 },
      { tipo: 'participante', cantidad: MAX_CODIGOS_POR_LOTE + 1 },
      { tipo: 'participante', cantidad: 3.5 },
      { tipo: 'otro', cantidad: MIN_CODIGOS_POR_LOTE },
      { tipo: 'otro', cantidad: 1 },
      { tipo: 'participante', cantidad: MIN_CODIGOS_POR_LOTE, entidad: 'Entidad' },
      { tipo: 'participante', cantidad: MIN_CODIGOS_POR_LOTE, nombre: '' },
    ]) {
      const r = await montaje.panel('encuesta/crear-lote', montaje.token, cuerpo);
      assert.equal(r.status, ESTADO_HTTP.solicitudIncorrecta, JSON.stringify(cuerpo));
      assert.deepEqual(await r.json(), { error: 'solicitud_invalida' }, JSON.stringify(cuerpo));
    }
    const conCuerpo = await montaje.panel('encuesta/resultados', montaje.token, { lote: 'x' });
    assert.equal(conCuerpo.status, ESTADO_HTTP.solicitudIncorrecta);
    // Otro token que el de la sesión abierta no lee nada: el panel lo trata como una sesión sustituida.
    const otraSesion = await montaje.panel('encuesta/resultados', 'A'.repeat(LARGO_DEL_TOKEN));
    assert.equal(otraSesion.status, ESTADO_HTTP.conflicto);
    assert.deepEqual(await otraSesion.json(), { error: 'sesion_sustituida' });
    const grande = await crear(montaje, 'profesional', MAX_CODIGOS_POR_LOTE);
    assert.equal(grande.codigos.length, MAX_CODIGOS_POR_LOTE);
    for (let i = 1; i < MAX_LOTES; i += 1) {
      await crear(montaje, 'participante', MIN_CODIGOS_POR_LOTE);
    }
    const lleno = await montaje.panel('encuesta/crear-lote', montaje.token, {
      tipo: 'participante',
      cantidad: MIN_CODIGOS_POR_LOTE,
    });
    assert.equal(lleno.status, ESTADO_HTTP.conflicto);
    assert.deepEqual(await lleno.json(), { error: 'limite_lotes' });
  } finally {
    db.close();
  }
});

test('un lote de menos de tres códigos no se crea y quien opera recibe cuál es el mínimo', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const montaje = await montarEncuesta(db);
    assert.equal(MIN_CODIGOS_POR_LOTE, MINIMO_DECIDIDO);
    for (const cantidad of [0, 1, MIN_CODIGOS_POR_LOTE - 1]) {
      for (const tipo of ['participante', 'profesional']) {
        const r = await montaje.panel('encuesta/crear-lote', montaje.token, { tipo, cantidad });
        assert.equal(r.status, ESTADO_HTTP.solicitudIncorrecta, `${tipo} ${cantidad}`);
        assert.deepEqual(await r.json(), { error: 'lote_demasiado_pequeno', minimo: MIN_CODIGOS_POR_LOTE });
      }
    }
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='encuesta_lotes'").get(), undefined);
    const justo = await crear(montaje, 'participante', MIN_CODIGOS_POR_LOTE);
    assert.equal(justo.codigos.length, MIN_CODIGOS_POR_LOTE);
    assert.equal(db.prepare('SELECT count(*) AS n FROM encuesta_lotes').get()?.n, 1);
    // El enlace privado tampoco admite un lote menor, aunque no llegue por el panel.
    const huellas = ['a', 'b'].map((letra) => letra.repeat(LARGO_DE_HUELLA));
    const lote = { id: crypto.randomUUID(), tipo: 'participante', huellas };
    const llamadas: string[] = [];
    const almacen = { crearLoteDeSesion: async () => llamadas.push('crear') };
    const enviado = await operarEncuestaDurable(almacen as never, '/encuesta/crear-lote', {
      acceso: accesoPanel('a'),
      lote,
    });
    assert.equal(enviado, undefined);
    assert.deepEqual(llamadas, []);
  } finally {
    db.close();
  }
});

test('el protocolo privado rechaza huellas desordenadas, campos de más y accesos sin sesión', async () => {
  const llamadas: string[] = [];
  const almacen = {
    crearLoteDeSesion: async () => llamadas.push('crear'),
    cerrarEncuestaDeSesion: async () => llamadas.push('cerrar'),
    leerResultadosDeSesion: async () => llamadas.push('leer'),
    responder: async () => llamadas.push('responder') > 0,
  };
  const acceso = accesoPanel('a');
  // Tres huellas, el mínimo de un lote, pero desordenadas.
  const huellas = ['c', 'a', 'b'].map((letra) => letra.repeat(LARGO_DE_HUELLA));
  const id = crypto.randomUUID();
  assert.equal(
    await operarEncuestaDurable(almacen as never, '/encuesta/crear-lote', {
      acceso,
      lote: { id, tipo: 'participante', huellas },
    }),
    undefined,
  );
  assert.equal(await operarEncuestaDurable(almacen as never, '/encuesta/cerrar', { acceso, extra: 1 }), undefined);
  assert.equal(
    await operarEncuestaDurable(almacen as never, '/encuesta/responder', {
      respuesta: {
        huella: 'a'.repeat(LARGO_DE_HUELLA),
        tipo: 'participante',
        celdas: [{ pregunta: 'texto', valor: 'libre' }],
      },
    }),
    undefined,
  );
  for (const pregunta of ['__proto__', 'toString', 'constructor']) {
    const celdas = [{ pregunta, valor: 'si' }];
    const respuesta = { huella: 'a'.repeat(LARGO_DE_HUELLA), tipo: 'participante', celdas };
    assert.equal(await operarEncuestaDurable(almacen as never, '/encuesta/responder', { respuesta }), undefined);
  }
  assert.deepEqual(llamadas, []);
});

test('el punto rechaza otro método, otro tipo, cuerpos grandes y pasa del tope de envíos por minuto', async () => {
  let ahora = 0;
  const punto = crearPuntoDeEncuesta({ ahora: () => ahora });
  const almacen = { responder: async () => false };
  const get = await punto(new Request('https://faro.example/encuesta/responder'), almacen);
  assert.equal(get.status, ESTADO_HTTP.metodoNoAdmitido);
  assert.equal(get.headers.get('allow'), 'POST');
  const texto = await punto(envio('{}', { 'content-type': 'text/plain' }), almacen);
  assert.equal(texto.status, ESTADO_HTTP.tipoNoAdmitido);
  const relleno = 'x'.repeat(MAX_CUERPO_ENCUESTA_BYTES);
  const grande = await punto(envio({ codigo: relleno, respuestas: {} }), almacen);
  assert.equal(grande.status, ESTADO_HTTP.solicitudIncorrecta);
  const flujo = new ReadableStream({
    start(controlador) {
      controlador.enqueue(new TextEncoder().encode(`{"codigo":"${relleno}"`));
      controlador.close();
    },
  });
  const sinLongitud = new Request('https://faro.example/encuesta/responder', {
    method: 'POST',
    body: flujo,
    headers: { 'content-type': 'application/json' },
    duplex: 'half',
  } as RequestInit);
  assert.equal((await punto(sinLongitud, almacen)).status, ESTADO_HTTP.solicitudIncorrecta);
  // Los dos cuerpos grandes ya han contado en la ventana; el método y el tipo erróneos no llegan a ella.
  for (let i = 2; i < MAX_ENVIOS_POR_MINUTO; i += 1) {
    await punto(envio({ codigo: codigoNuevo('participante'), respuestas: PARTICIPANTE_COMPLETO }), almacen);
  }
  const tope = await punto(envio({ codigo: codigoNuevo('participante'), respuestas: PARTICIPANTE_COMPLETO }), almacen);
  assert.equal(tope.status, ESTADO_HTTP.demasiadasPeticiones);
  assert.equal(tope.headers.get('retry-after'), String(MS_POR_MINUTO / MS_POR_SEGUNDO));
  ahora += MS_POR_MINUTO;
  const despues = await punto(
    envio({ codigo: codigoNuevo('participante'), respuestas: PARTICIPANTE_COMPLETO }),
    almacen,
  );
  assert.equal(despues.status, ESTADO_HTTP.conflicto);
  const sinAlmacen = await punto(envio({ codigo: codigoNuevo('participante'), respuestas: {} }), undefined);
  assert.equal(sinAlmacen.status, ESTADO_HTTP.noDisponible);
});

test('el Worker unificado lleva la ruta de la encuesta a su punto, también sin almacén', async () => {
  const { responderUnificado } = await import('../../src/plataforma/cloudflare/worker-unificado.ts');
  const get = await responderUnificado(new Request('https://faro.example/encuesta/responder'), {} as never);
  assert.equal(get.status, ESTADO_HTTP.metodoNoAdmitido);
  assert.equal(get.headers.get('allow'), 'POST');
  const sinAlmacen = await responderUnificado(
    envio({ codigo: codigoNuevo('participante'), respuestas: PARTICIPANTE_COMPLETO }),
    {} as never,
  );
  assert.equal(sinAlmacen.status, ESTADO_HTTP.noDisponible);
  assert.equal(sinAlmacen.headers.get('referrer-policy'), 'no-referrer');
});

/** El estado que deja una respuesta en la base: huellas sin usar, consumo de los lotes y suma de todas las celdas. */
function rastroDeLaBase(db: DatabaseSync) {
  return {
    huellas: db.prepare('SELECT count(*) AS n FROM encuesta_codigos').get()?.n,
    consumidos: db.prepare('SELECT sum(consumidos) AS n FROM encuesta_lotes').get()?.n,
    recuentos: db.prepare('SELECT sum(recuento) AS n FROM encuesta_recuentos').get()?.n,
  };
}

test('dos envíos a la vez con el mismo código cuentan una sola vez', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const montaje = await montarEncuesta(db);
    const { codigos } = await crear(montaje, 'participante', MIN_CODIGOS_POR_LOTE);
    const codigo = codigos[0]?.codigo ?? '';
    const punto = crearPuntoDeEncuesta();
    const estados = await Promise.all(
      [1, 2].map(
        async () => (await punto(envio({ codigo, respuestas: PARTICIPANTE_COMPLETO }), montaje.encuesta)).status,
      ),
    );
    assert.deepEqual(estados.sort(), [ESTADO_HTTP.correcto, ESTADO_HTTP.conflicto]);
    const celdas = Object.keys(PARTICIPANTE_COMPLETO).length;
    assert.deepEqual(rastroDeLaBase(db), { huellas: MIN_CODIGOS_POR_LOTE - 1, consumidos: 1, recuentos: celdas });
  } finally {
    db.close();
  }
});

test('un fallo a mitad de la respuesta no deja nada a medias: ni código gastado sin contar ni contado sin gastar', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const montaje = await montarEncuesta(db);
    const { codigos } = await crear(montaje, 'participante', MIN_CODIGOS_POR_LOTE);
    const codigo = codigos[0]?.codigo ?? '';
    const antes = rastroDeLaBase(db);
    // El fallo llega después de borrar la huella y de contar el consumo del lote, al sumar la primera celda.
    db.exec(`CREATE TRIGGER fallo_a_mitad BEFORE UPDATE ON encuesta_recuentos
      BEGIN SELECT RAISE(ABORT, 'fallo a mitad'); END`);
    const punto = crearPuntoDeEncuesta();
    const fallida = await punto(envio({ codigo, respuestas: PARTICIPANTE_COMPLETO }), montaje.encuesta);
    assert.equal(fallida.status, ESTADO_HTTP.noDisponible);
    assert.deepEqual(rastroDeLaBase(db), antes);
    db.exec('DROP TRIGGER fallo_a_mitad');
    const repetida = await punto(envio({ codigo, respuestas: PARTICIPANTE_COMPLETO }), montaje.encuesta);
    assert.equal(repetida.status, ESTADO_HTTP.correcto);
    assert.equal(rastroDeLaBase(db).consumidos, 1);
  } finally {
    db.close();
  }
});

test('las operaciones del panel de la encuesta exigen el origen y la cabecera del panel, como las demás', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const montaje = await montarEncuesta(db);
    const cuerpos: Record<string, unknown> = {
      'encuesta/crear-lote': { tipo: 'participante', cantidad: MIN_CODIGOS_POR_LOTE },
      'encuesta/cerrar': {},
      'encuesta/resultados': {},
    };
    for (const [ruta, cuerpo] of Object.entries(cuerpos)) {
      for (const cambios of [
        { origin: null },
        { origin: 'https://otro.example' },
        { 'x-faro-panel': null },
        { 'sec-fetch-site': 'cross-site' },
      ]) {
        const r = await montaje.panel(ruta, montaje.token, cuerpo, cambios);
        assert.equal(r.status, ESTADO_HTTP.prohibido, `${ruta} ${JSON.stringify(cambios)}`);
        assert.deepEqual(await r.json(), { error: 'origen_no_permitido' });
      }
    }
    // Ninguna llegó al almacén: la encuesta ni siquiera se ha preparado.
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='encuesta_estado'").get(), undefined);
  } finally {
    db.close();
  }
});

test('el punto solo convierte en respuesta los errores de contrato; el resto sale al 503 sin registro', () => {
  const fuente = readFileSync(new URL('../../src/encuesta/punto-publico.ts', import.meta.url), 'utf8');
  // Una sola captura general, la del 503 documentado; las demás comprueban EncuestaInvalida y dejan salir el resto.
  assert.equal(fuente.match(/catch \{/g)?.length, 1);
  const capturas = [...fuente.matchAll(/catch \(error\) \{\s*if \(error instanceof (\w+)\)[\s\S]*?throw error;/g)];
  assert.deepEqual(
    capturas.map(([, clase]) => clase),
    ['TypeError', 'SyntaxError', 'EncuestaInvalida', 'EncuestaInvalida', 'EncuestaInvalida'],
  );
});

/** Nombres de lote que no son texto llano de 1 a 60 caracteres sin espacios en los extremos. */
const NOMBRES_NO_VALIDOS: unknown[] = [
  '',
  ' Entidad',
  'Entidad ',
  'Entidad\nOtra',
  'Entidad\tOtra',
  'Enti\u200bdad',
  'Entidad\u2028',
  'x'.repeat(MAX_NOMBRE_LOTE + 1),
  MAX_NOMBRE_LOTE,
  ['Entidad'],
  // Sustitutos sueltos, uso privado y puntos sin asignar: el texto no es una cadena Unicode bien formada y visible.
  '\ud800',
  'Entidad\udc00',
  'Entidad\ue000',
  'Entidad\u0378',
  // Rellenos que se ven en blanco aunque sean letras o símbolos, y un nombre hecho solo de marcas combinantes.
  '\u3164',
  'Enti\u115fdad',
  'Entidad\uffa0',
  '\u2800\u2800',
  '\u0301\u0301',
];
test('un lote puede llevar el nombre de su entidad, en texto llano y de 1 a 60 caracteres', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const montaje = await montarEncuesta(db);
    const nombres = ['Associació Veïnal del Clot', 'Fundació Pas a Pas — Nou Barris', 'É'.repeat(MAX_NOMBRE_LOTE)];
    for (const nombre of nombres) {
      const r = await montaje.panel('encuesta/crear-lote', montaje.token, {
        tipo: 'participante',
        cantidad: 3,
        nombre,
      });
      assert.equal(r.status, ESTADO_HTTP.correcto, nombre);
      assert.equal(((await r.json()) as LoteCreado & { lote: { nombre: unknown } }).lote.nombre, nombre);
    }
    const sinNombre = await montaje.panel('encuesta/crear-lote', montaje.token, {
      tipo: 'profesional',
      cantidad: MIN_CODIGOS_POR_LOTE,
      nombre: null,
    });
    assert.equal(((await sinNombre.json()) as { lote: { nombre: unknown } }).lote.nombre, null);
    for (const nombre of NOMBRES_NO_VALIDOS) {
      const r = await montaje.panel('encuesta/crear-lote', montaje.token, {
        tipo: 'participante',
        cantidad: 3,
        nombre,
      });
      assert.equal(r.status, ESTADO_HTTP.solicitudIncorrecta, JSON.stringify(nombre));
      assert.deepEqual(await r.json(), { error: 'solicitud_invalida' });
    }
    // El nombre sale en los lotes de los resultados; los recuentos siguen siendo globales, nunca por lote.
    const { encuesta } = (await (await montaje.panel('encuesta/cerrar', montaje.token)).json()) as {
      encuesta: { lotes: { nombre: unknown }[]; recuentos: Record<string, Record<string, unknown>> };
    };
    assert.deepEqual(
      encuesta.lotes.map((lote) => lote.nombre),
      [...nombres, null],
    );
    assert.deepEqual(Object.keys(encuesta.recuentos), ['participante', 'profesional']);
    for (const tipo of Object.values(encuesta.recuentos)) {
      assert.deepEqual(Object.keys(tipo), ['respuestas', 'preguntas']);
    }
    assert.ok(!JSON.stringify(encuesta.recuentos).includes('Entidad'));
  } finally {
    db.close();
  }
});

test('un nombre que no es texto bien formado no llega a crear el lote, ni por el panel ni por el enlace privado', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const montaje = await montarEncuesta(db);
    const cuerpo = { tipo: 'participante', cantidad: MIN_CODIGOS_POR_LOTE, nombre: 'Entidad\ud800' };
    const r = await montaje.panel('encuesta/crear-lote', montaje.token, cuerpo);
    assert.equal(r.status, ESTADO_HTTP.solicitudIncorrecta);
    // Ningún mensaje de creación ha cruzado al objeto durable: nada que confirmar con un nombre distinto del pedido.
    assert.ok(!montaje.mensajes.some((m) => m.ruta === '/encuesta/crear-lote'));
    const llamadas: string[] = [];
    const almacen = { crearLoteDeSesion: async () => llamadas.push('crear') };
    const huellas = ['a', 'b', 'c'].map((letra) => letra.repeat(LARGO_DE_HUELLA));
    const lote = { id: crypto.randomUUID(), tipo: 'participante', nombre: '\udfff', huellas };
    const privado = await operarEncuestaDurable(almacen as never, '/encuesta/crear-lote', {
      acceso: accesoPanel('a'),
      lote,
    });
    assert.equal(privado, undefined);
    assert.deepEqual(llamadas, []);
  } finally {
    db.close();
  }
});
