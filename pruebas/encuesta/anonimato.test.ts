/**
 * Demostración automática de la garantía de anonimato de la encuesta (docs/encuesta.md): el esquema no tiene
 * hora, código ni orden; la huella se borra al usarse; un código no sirve dos veces; el punto público no lee la IP ni
 * cabeceras que identifiquen y no escribe en la consola; y todos los rechazos de un código son idénticos.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { codigoNuevo, huellaDelCodigo } from '../../src/encuesta/codigos.ts';
import { crearPuntoDeEncuesta } from '../../src/encuesta/punto-publico.ts';
import { envio, montarEncuesta, PARTICIPANTE_COMPLETO } from './montaje.ts';

const CODIGOS_DEL_LOTE = 4;

async function loteDePrueba(db: DatabaseSync) {
  const montaje = await montarEncuesta(db);
  const creado = await montaje.panel('encuesta/crear-lote', montaje.token, {
    tipo: 'participante',
    cantidad: CODIGOS_DEL_LOTE,
  });
  assert.equal(creado.status, ESTADO_HTTP.correcto);
  const { codigos } = (await creado.json()) as { codigos: { codigo: string }[] };
  return { ...montaje, codigos: codigos.map((c) => c.codigo) };
}
/** Todo lo que guarda la base, como texto, para buscar en ella cualquier rastro de un código o de su huella. */
function volcado(db: DatabaseSync): string {
  const tablas = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
  return tablas.map(({ name }) => JSON.stringify(db.prepare(`SELECT * FROM "${name}"`).all())).join('\n');
}
async function exacta(respuesta: Response) {
  return {
    estado: respuesta.status,
    cabeceras: [...respuesta.headers.entries()].sort(),
    cuerpo: await respuesta.text(),
  };
}

test('el esquema no tiene columnas de hora, de código ni de orden, y las huellas no tienen número de fila', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    await loteDePrueba(db);
    const columnas = (tabla: string) =>
      (db.prepare(`PRAGMA table_info("${tabla}")`).all() as { name: string }[]).map((c) => c.name);
    assert.deepEqual(columnas('encuesta_codigos'), ['huella', 'lote', 'tipo']);
    assert.deepEqual(columnas('encuesta_recuentos'), ['ronda', 'tipo', 'pregunta', 'valor', 'recuento']);
    assert.deepEqual(columnas('encuesta_lotes'), ['id', 'numero', 'ronda', 'tipo', 'emitidos', 'consumidos', 'nombre']);
    assert.deepEqual(columnas('encuesta_estado'), ['id', 'version', 'cuestionario']);
    // Las rondas guardan el día en que se abren y se cierran, que decide quien administra: ninguna hora de respuesta.
    assert.deepEqual(columnas('encuesta_rondas'), ['numero', 'nombre', 'inicio', 'cierre', 'abierta']);
    assert.throws(() => db.exec("UPDATE encuesta_rondas SET inicio='2026-11-23T10:00' WHERE numero=1"), /CHECK/);
    const tablas = ['encuesta_codigos', 'encuesta_recuentos', 'encuesta_lotes', 'encuesta_estado', 'encuesta_rondas'];
    const todas = tablas.flatMap(columnas);
    for (const nombre of todas) {
      assert.doesNotMatch(
        nombre,
        /hora|fecha|instante|cread|reloj|codigo|orden|secuencia|^ip$|direccion|agente|origen/i,
      );
    }
    // Sin rowid no hay un número que crezca con cada inserción: el orden de creación de los códigos no existe.
    assert.throws(() => db.prepare('SELECT rowid FROM encuesta_codigos').all(), /no such column/);
    assert.throws(() => db.prepare('SELECT rowid FROM encuesta_recuentos').all(), /no such column/);
  } finally {
    db.close();
  }
});

test('al responder se borra la huella, no queda el código y el mismo código no sirve dos veces', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const { encuesta, codigos } = await loteDePrueba(db);
    const [usado = '', otro = ''] = codigos;
    const huella = huellaDelCodigo(usado);
    assert.equal(db.prepare('SELECT count(*) AS n FROM encuesta_codigos WHERE huella=?').get(huella)?.n, 1);
    const celdas = () => db.prepare('SELECT count(*) AS n FROM encuesta_recuentos').get()?.n;
    const celdasAntes = celdas();
    const punto = crearPuntoDeEncuesta();
    const primera = await punto(envio({ codigo: usado, respuestas: PARTICIPANTE_COMPLETO }), encuesta);
    assert.equal(primera.status, ESTADO_HTTP.correcto);
    assert.equal(db.prepare('SELECT count(*) AS n FROM encuesta_codigos WHERE huella=?').get(huella)?.n, 0);
    const segunda = await punto(envio({ codigo: usado, respuestas: PARTICIPANTE_COMPLETO }), encuesta);
    assert.equal(segunda.status, ESTADO_HTTP.conflicto);
    // Responder no añade ninguna fila: solo suma en las celdas que ya existían.
    assert.equal(celdas(), celdasAntes);
    // Ni el código usado ni su huella quedan en ninguna tabla; los códigos en claro no han existido nunca en la base.
    const todo = volcado(db);
    assert.ok(!todo.includes(huella));
    for (const codigo of codigos) {
      assert.ok(!todo.includes(codigo));
    }
    assert.ok(todo.includes(huellaDelCodigo(otro)));
    assert.equal(db.prepare('SELECT consumidos FROM encuesta_lotes').get()?.consumidos, 1);
  } finally {
    db.close();
  }
});

test('el objeto durable solo recibe huellas ordenadas por su valor, nunca los códigos ni su orden de creación', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const { mensajes, codigos } = await loteDePrueba(db);
    const mensaje = mensajes.find((m) => m.ruta === '/encuesta/crear-lote');
    assert.ok(mensaje);
    for (const codigo of codigos) {
      assert.ok(!mensaje.cuerpo.includes(codigo));
    }
    const { lote } = JSON.parse(mensaje.cuerpo) as { lote: { huellas: string[] } };
    assert.deepEqual(lote.huellas, [...lote.huellas].sort());
    assert.deepEqual([...lote.huellas].sort(), codigos.map(huellaDelCodigo).sort());
  } finally {
    db.close();
  }
});

test('un código inexistente, uno usado y uno de una encuesta cerrada reciben la misma respuesta exacta', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const { encuesta, codigos, panel, token } = await loteDePrueba(db);
    const [usado = '', sinUsar = ''] = codigos;
    const punto = crearPuntoDeEncuesta();
    const responder = (codigo: string) => punto(envio({ codigo, respuestas: PARTICIPANTE_COMPLETO }), encuesta);
    await responder(usado);
    const inexistente = await exacta(await responder(codigoNuevo('participante')));
    const repetido = await exacta(await responder(usado));
    assert.equal((await panel('encuesta/cerrar', token)).status, ESTADO_HTTP.correcto);
    const cerrada = await exacta(await responder(sinUsar));
    assert.equal(inexistente.estado, ESTADO_HTTP.conflicto);
    assert.deepEqual(repetido, inexistente);
    assert.deepEqual(cerrada, inexistente);
    assert.equal(inexistente.cuerpo, '{"error":"codigo_no_valido"}');
  } finally {
    db.close();
  }
});

/** Una petición que anota cada propiedad que se lee de ella y cada cabecera que se consulta. */
function peticionVigilada(cuerpo: unknown) {
  const real = envio(cuerpo, {
    'cf-connecting-ip': '203.0.113.7',
    'x-forwarded-for': '203.0.113.7',
    'x-real-ip': '203.0.113.7',
    'true-client-ip': '203.0.113.7',
    'user-agent': 'Navegador de prueba',
    cookie: 'faro_portal=secreto',
    referer: 'https://faro.example/encuesta.html',
  });
  const propiedades = new Set<string>();
  const cabeceras = new Set<string>();
  const vigiladas = new Proxy(real.headers, {
    get(objetivo, nombre) {
      if (nombre === 'get' || nombre === 'has') {
        return (clave: string) => {
          cabeceras.add(clave.toLowerCase());
          return nombre === 'get' ? objetivo.get(clave) : objetivo.has(clave);
        };
      }
      cabeceras.add(`(${String(nombre)})`);
      return Reflect.get(objetivo, nombre, objetivo);
    },
  });
  const peticion = new Proxy(real, {
    get(objetivo, nombre) {
      propiedades.add(String(nombre));
      if (nombre === 'headers') {
        return vigiladas;
      }
      if (nombre === 'cf') {
        return { country: 'ES', city: 'Barcelona' };
      }
      const valor: unknown = Reflect.get(objetivo, nombre, objetivo);
      return typeof valor === 'function' ? valor.bind(objetivo) : valor;
    },
  });
  return { peticion, propiedades, cabeceras };
}
test('el punto público solo lee el método, dos cabeceras técnicas y el cuerpo: nunca la IP ni la URL', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const { encuesta, codigos } = await loteDePrueba(db);
    const punto = crearPuntoDeEncuesta();
    const casos = [
      { codigo: codigos[0], respuestas: PARTICIPANTE_COMPLETO },
      { codigo: codigos[0], respuestas: PARTICIPANTE_COMPLETO },
      { codigo: 'no-es-un-codigo', respuestas: {} },
      { codigo: codigos[1], respuestas: { informe: 'visto' } },
    ];
    for (const cuerpo of casos) {
      const { peticion, propiedades, cabeceras } = peticionVigilada(cuerpo);
      await punto(peticion, encuesta);
      assert.deepEqual([...propiedades].sort(), ['body', 'headers', 'method']);
      assert.deepEqual([...cabeceras].sort(), ['content-length', 'content-type']);
    }
  } finally {
    db.close();
  }
});

test('ningún camino del punto ni del almacén escribe en la consola, tampoco ante un fallo', async (t) => {
  const db = new DatabaseSync(':memory:');
  const llamadas: string[] = [];
  for (const metodo of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) {
    t.mock.method(console, metodo, () => {
      llamadas.push(metodo);
    });
  }
  try {
    const { encuesta, codigos } = await loteDePrueba(db);
    const punto = crearPuntoDeEncuesta();
    await punto(envio({ codigo: codigos[0], respuestas: PARTICIPANTE_COMPLETO }), encuesta);
    await punto(envio({ codigo: codigos[0], respuestas: PARTICIPANTE_COMPLETO }), encuesta);
    await punto(envio('{"codigo":'), encuesta);
    await punto(envio({ codigo: codigos[1], respuestas: { informe: 'visto', ocupacion: 'quizá' } }), encuesta);
    await punto(new Request('https://faro.example/encuesta/responder'), encuesta);
    await punto(envio({ codigo: codigos[1], respuestas: PARTICIPANTE_COMPLETO }), undefined);
    const averiado = {
      responder: async () => {
        throw new Error(`fallo con ${codigos[1]}`);
      },
    };
    const fallo = await punto(envio({ codigo: codigos[1], respuestas: PARTICIPANTE_COMPLETO }), averiado);
    assert.equal(fallo.status, ESTADO_HTTP.noDisponible);
    assert.ok(!(await fallo.text()).includes(codigos[1] ?? '-'));
    assert.deepEqual(llamadas, []);
  } finally {
    db.close();
  }
});

test('el código de la encuesta no contiene lecturas de IP, de cabeceras identificativas ni escrituras en consola', () => {
  for (const archivo of [
    'punto-publico.ts',
    'entrada-cloudflare.ts',
    'entrada-node.ts',
    'almacen-sqlite.ts',
    'esquema-sqlite.ts',
    'rondas-sqlite.ts',
    'protocolo-durable.ts',
    'cliente-durable.ts',
    'contrato.ts',
    'contrato-sesion.ts',
    'cuestionario.ts',
    'codigos.ts',
  ]) {
    const fuente = readFileSync(new URL(`../../src/encuesta/${archivo}`, import.meta.url), 'utf8');
    const codigo = fuente.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.doesNotMatch(codigo, /console\./, archivo);
    assert.doesNotMatch(codigo, /connecting-ip|forwarded|x-real-ip|true-client-ip|user-agent|cookie|referer/i, archivo);
    assert.doesNotMatch(codigo, /\.cf\b/, archivo);
    // En Node, la dirección de red solo está en el socket de la petición, que no llega a la encuesta.
    assert.doesNotMatch(codigo, /remoteAddress|socket|IncomingMessage/, archivo);
    // El reloj solo lo usa la ventana de envíos del punto, en memoria; el almacén y su protocolo no conocen la hora.
    if (archivo !== 'punto-publico.ts') {
      assert.doesNotMatch(codigo, /Date\.now|new Date|ahora/, archivo);
    }
  }
});
