// Ensayo sin navegador del cotejo del Worker oficial del presupuesto (presupuesto-servidor.mjs y
// presupuesto-ejecucion.mjs): la portada y el acceso solo los sirve el worker/worker.mjs del artefacto oficial medido.
// (a) El del artefacto medido pasa, y lo que recibe el navegador se coteja con la huella de su respuesta.
// (b) El de la fuente del arnés (worker-oficial.ts) falla, también si se hace pasar por la ruta del artefacto.
// (c) El de la otra construcción falla, también con la ruta del medido; un worker.mjs cambiado tras su artefacto.json,
//     y una respuesta servida que no es la del Worker comprobado, también.
// Sin construcción oficial, el escenario consta «fallo del arnés» con el motivo. Lo mismo para el Worker privado: con
// varias construcciones cada --worker-privado lleva su nombre, servible() solo acepta el de la misma revisión y la
// misma VERSION que la construcción oficial, y lo que sirve un escenario privado consta comprobado; si el escenario
// falla antes de comprobarlo, consta como no comprobado. Construcciones sintéticas en una carpeta temporal: un
// artefacto.json con la huella de su worker/worker.mjs y un Worker mínimo que dice cuál es.
//
//   node --test pruebas/navegadores/presupuesto-worker-oficial.test.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { request as pedirHttp } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import * as workerDeLasFuentes from '../../src/plataforma/cloudflare/worker-oficial.ts';
import { servible, workerPrivadoDe } from './paquete-comun.mjs';
import { comprobarMedida, escenarioMedido } from './presupuesto-ejecucion.mjs';
import { ESCENARIOS } from './presupuesto-medida.mjs';
import { ESTADO } from './presupuesto-plazo.mjs';
import { comprobarWorkerOficial, servidorOficialDe } from './presupuesto-servidor.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const RAIZ = mkdtempSync(join(realpathSync(tmpdir()), 'faro-worker-oficial-'));
after(() => rmSync(RAIZ, { recursive: true, force: true }));
const PORTADA = ESCENARIOS.find((e) => e.nombre === 'portada');
const ACCESO = ESCENARIOS.find((e) => e.nombre === 'acceso');
const INICIO = ESCENARIOS.find((e) => !e.oficial);

/** Un Worker oficial mínimo que responde la portada y el acceso con su `marca`, y 404 en lo demás. */
const fuenteDelWorker = (marca) => `export default {
  async fetch(peticion) {
    const ruta = new URL(peticion.url).pathname;
    if (ruta === '/' || ruta === '/acceso-web') {
      return new Response('<!doctype html><title>${marca} ' + ruta + '</title>', { headers: { 'content-type': 'text/html' } });
    }
    return new Response(null, { status: 404 });
  },
};
`;

/** Una construcción oficial sintética, con la forma de servible(): su Worker oficial cargado y su web. */
async function construccion(nombre) {
  const carpeta = join(RAIZ, nombre);
  mkdirSync(join(carpeta, 'worker'), { recursive: true });
  const worker = Buffer.from(fuenteDelWorker(nombre));
  const ruta = join(carpeta, 'worker/worker.mjs');
  writeFileSync(ruta, worker);
  const archivos = [{ ruta: 'worker/worker.mjs', bytes: worker.length, sha256: sha256(worker) }];
  const descriptor = Buffer.from(JSON.stringify({ version: 1, destino: 'oficial', archivos }));
  writeFileSync(join(carpeta, 'artefacto.json'), descriptor);
  const fichas = new Map(archivos.map((a) => [a.ruta, a]));
  return {
    artefacto: { directorio: carpeta },
    oficial: {
      destino: 'oficial',
      carpeta,
      ruta,
      sha256: sha256(worker),
      sha256Artefacto: sha256(descriptor),
      worker: await import(pathToFileURL(ruta).href),
      fichas,
      leer: (r) => readFileSync(join(carpeta, r)),
    },
  };
}

const MEDIDA = await construccion('medida');
const OTRA = await construccion('otra');
const FUENTE = {
  worker: workerDeLasFuentes,
  ruta: fileURLToPath(new URL('../../src/plataforma/cloudflare/worker-oficial.ts', import.meta.url)),
};

/** Una petición GET al servidor oficial; devuelve el estado y la huella del cuerpo. */
function pedir(origen, ruta) {
  return new Promise((ok, fallo) => {
    const salida = pedirHttp(`${origen}${ruta}`, { headers: { 'sec-fetch-dest': 'document' } }, (respuesta) => {
      const partes = [];
      respuesta.on('data', (parte) => partes.push(parte));
      respuesta.once('end', () => ok({ estado: respuesta.statusCode, huella: sha256(Buffer.concat(partes)) }));
    });
    salida.once('error', fallo);
    salida.end();
  });
}

/** Una medida válida de la portada o el acceso con lo que llegó al navegador (`huella`) y su procedencia. */
const medidaCon = (procedencia, ruta, huella) => ({
  errores: [],
  servidor: { sinIdentidadEsperada: 0 },
  estadoNavegacion: ESTADO_HTTP.correcto,
  hitos: { interfaz: { alcanzado: true, ms: 100 }, analisis: null },
  servidoPor: procedencia,
  peticiones: [{ ruta, metodo: 'GET', estado: ESTADO_HTTP.correcto, huella }],
});

test('(a) el Worker del artefacto medido sirve la portada y el acceso, y su registro dice cuál es', async () => {
  const servidor = await servidorOficialDe(MEDIDA);
  try {
    const { procedencia } = servidor;
    assert.deepEqual(procedencia.worker, { ruta: MEDIDA.oficial.ruta, sha256: MEDIDA.oficial.sha256 });
    assert.deepEqual(procedencia.artefacto, {
      carpeta: MEDIDA.oficial.carpeta,
      sha256: MEDIDA.oficial.sha256Artefacto,
    });
    assert.equal(procedencia.destino, 'oficial');
    for (const [escenario, ruta] of [
      [PORTADA, '/'],
      [ACCESO, '/acceso-web'],
    ]) {
      const { estado, huella } = await pedir(servidor.origen, ruta);
      assert.equal(estado, ESTADO_HTTP.correcto);
      assert.equal(huella, procedencia.respuestas[ruta].sha256, `${ruta}: lo servido es lo del Worker comprobado`);
      comprobarMedida(medidaCon(procedencia, ruta, huella), 'escritorio', escenario);
    }
    assert.equal((await pedir(servidor.origen, '/otra.js')).estado, ESTADO_HTTP.noEncontrado, 'Lo demás, su Worker');
    assert.deepEqual(servidor.errores, []);
  } finally {
    await servidor.cerrar();
  }
});

test('(b) el Worker de la fuente del arnés no sirve: ni con su ruta ni haciéndose pasar por la del artefacto', async () => {
  await assert.rejects(comprobarWorkerOficial(FUENTE, MEDIDA.oficial), /no es el del artefacto medido/u);
  await assert.rejects(servidorOficialDe(MEDIDA, FUENTE), /no es el del artefacto medido/u);
  await assert.rejects(
    comprobarWorkerOficial({ ...FUENTE, ruta: MEDIDA.oficial.ruta }, MEDIDA.oficial),
    /no es el cargado desde el artefacto medido/u,
  );
});

test('(c) el Worker de la otra construcción no sirve, ni uno cambiado tras su artefacto.json', async () => {
  await assert.rejects(comprobarWorkerOficial(OTRA.oficial, MEDIDA.oficial), /no es el del artefacto medido/u);
  await assert.rejects(
    comprobarWorkerOficial({ ...OTRA.oficial, ruta: MEDIDA.oficial.ruta }, MEDIDA.oficial),
    /no es el cargado desde el artefacto medido/u,
  );
  const cambiada = await construccion('cambiada');
  writeFileSync(cambiada.oficial.ruta, fuenteDelWorker('otra cosa'));
  await assert.rejects(
    comprobarWorkerOficial(cambiada.oficial, cambiada.oficial),
    /no coincide con el de su artefacto/u,
  );
});

test('(c) lo que llegó al navegador de la otra construcción hace fallar la medida', async () => {
  const deLaMedida = await comprobarWorkerOficial(MEDIDA.oficial, MEDIDA.oficial);
  const deLaOtra = await comprobarWorkerOficial(OTRA.oficial, OTRA.oficial);
  assert.notEqual(deLaOtra.respuestas['/'].sha256, deLaMedida.respuestas['/'].sha256);
  assert.throws(
    () => comprobarMedida(medidaCon(deLaMedida, '/', deLaOtra.respuestas['/'].sha256), 'escritorio', PORTADA),
    /lo servido es del Worker oficial/u,
  );
  assert.throws(
    () => comprobarMedida({ ...medidaCon(null, '/', 'x'), servidoPor: null }, 'escritorio', PORTADA),
    /Worker oficial comprobado/u,
  );
});

test('sin construcción oficial, la portada consta «fallo del arnés» con el motivo y su procedencia', async () => {
  const anotadas = [];
  const privada = { artefacto: { directorio: '/privada' }, oficial: null, privado: null };
  await assert.rejects(
    escenarioMedido(
      { sesion: null, motor: 'simulado', servible: privada, nombreCondicion: 'escritorio' },
      PORTADA,
      (m) => anotadas.push(m),
      { medirCon: ({ arriba }) => arriba(), plazoTotal: { detener: () => undefined } },
    ),
    /destino oficial/u,
  );
  const ultima = anotadas.at(-1);
  assert.equal(ultima.estado, ESTADO.fallo);
  assert.match(ultima.fallo, /Worker oficial del artefacto medido/u);
  assert.deepEqual(ultima.servidoPor, { destino: 'oficial', worker: null, artefacto: null, comprobado: false });
});

test('cada construcción lleva su Worker privado: por nombre o, si es la única, uno sin nombre', () => {
  const valores = ['referencia=/a/privado', 'mejora=/b/privado'];
  const nombres = ['referencia', 'mejora'];
  assert.equal(workerPrivadoDe(valores, 'referencia', nombres), '/a/privado');
  assert.equal(workerPrivadoDe(valores, 'mejora', nombres), '/b/privado');
  assert.equal(workerPrivadoDe(['/c/privado'], 'mejora', ['mejora']), '/c/privado');
  assert.equal(workerPrivadoDe(undefined, 'mejora', nombres), undefined);
  assert.throws(() => workerPrivadoDe(['/a', '/b'], 'mejora', ['mejora']), /nombre=<dist>/u);
});

test('con varias construcciones, cada --worker-privado lleva el nombre de la suya', () => {
  const nombres = ['referencia', 'mejora'];
  assert.equal(workerPrivadoDe(['referencia=/a/privado', 'mejora=/b/privado'], 'mejora', nombres), '/b/privado');
  assert.throws(() => workerPrivadoDe(['/c/privado'], 'mejora', nombres), /nombre=<dist>/u);
  assert.throws(() => workerPrivadoDe(['otra=/c/privado'], 'mejora', nombres), /ninguna construcción se llama otra/u);
  assert.equal(workerPrivadoDe(['/c/privado'], 'mejora', ['mejora']), '/c/privado', 'Con una sola, vale sin nombre');
});

test('no se mezclan valores con nombre y sin nombre: ninguno se descarta en silencio', () => {
  const mezcla = /no se mezclan valores con nombre y sin nombre/u;
  assert.throws(() => workerPrivadoDe(['mejora=/a/privado', '/b/privado'], 'mejora', ['mejora']), mezcla);
  assert.throws(() => workerPrivadoDe(['/b/privado', 'mejora=/a/privado'], 'mejora', ['mejora']), mezcla);
});

/** Una revisión del código: 40 cifras hexadecimales. */
const CIFRAS_DE_LA_REVISION = 40;
const REVISION = 'a'.repeat(CIFRAS_DE_LA_REVISION);
const VERSION = '0123456789abcdef';
/** Lo que daría cargarArtefacto() de una construcción sintética, con su revisión y la VERSION de su service worker. */
const cargada = ({ oficial }, destino, { revision = REVISION, version = VERSION } = {}) => ({
  directorio: oficial.carpeta,
  destino,
  worker: oficial.worker,
  fichas: oficial.fichas,
  resumen: { revisionCodigo: revision },
  leer: (ruta) =>
    ruta === 'web/service-worker.js' ? Buffer.from(`var VERSION = "${version}";\n`) : oficial.leer(ruta),
});

test('servible() solo acepta el Worker privado de la misma revisión y la misma VERSION que la construcción oficial', async () => {
  const privada = await construccion('privada-servible');
  const servir = (privadaCargada, mismaRevision = true) => {
    const cargadas = new Map([
      [MEDIDA.oficial.carpeta, cargada(MEDIDA, 'oficial')],
      [privada.oficial.carpeta, privadaCargada],
    ]);
    return servible(MEDIDA.oficial.carpeta, privada.oficial.carpeta, {
      mismaRevision,
      cargar: async (c) => cargadas.get(c),
    });
  };
  await assert.rejects(
    servir(cargada(privada, 'privado', { revision: 'b'.repeat(CIFRAS_DE_LA_REVISION) })),
    /otra revisión/u,
  );
  await assert.rejects(servir(cargada(privada, 'privado', { version: 'fedcba9876543210' })), /otra VERSION/u);
  const deOtraVersion = await servir(cargada(privada, 'privado', { version: 'fedcba9876543210' }), false);
  assert.equal(deOtraVersion.privado.version, 'fedcba9876543210', 'Sin mismaRevision no se exige, pero consta');
  const servida = await servir(cargada(privada, 'privado'));
  assert.equal(servida.privado.carpeta, privada.oficial.carpeta);
  assert.equal(servida.privado.revisionCodigo, REVISION);
  assert.equal(servida.privado.version, VERSION);
  assert.equal(servida.artefacto.worker, privada.oficial.worker, 'La web oficial se sirve con ese Worker privado');
});

/** Una construcción privada sintética con la forma de servible(): su web servida con `servido` y su Worker privado. */
const construccionPrivada = (privada, servido = privada.oficial.worker) => ({
  artefacto: { directorio: privada.oficial.carpeta, worker: servido },
  privado: { ...privada.oficial, destino: 'privado' },
  oficial: null,
});
/** Una medida válida de un escenario, sin lo que la sirvió (medir() simulada no sirve nada). */
const MEDIDA_VALIDA = {
  errores: [],
  servidor: { sinIdentidadEsperada: 0 },
  estadoNavegacion: ESTADO_HTTP.correcto,
  hitos: { interfaz: { alcanzado: true, ms: 100 }, analisis: null },
};
const medirEscenario = (construida, escenario, anotar, medirCon = async () => MEDIDA_VALIDA) =>
  escenarioMedido(
    { sesion: null, motor: 'simulado', servible: construida, nombreCondicion: 'escritorio' },
    escenario,
    anotar,
    {
      medirCon,
      plazoTotal: { detener: () => undefined },
    },
  );

test('lo que sirve un escenario privado consta comprobado: el Worker privado de su construcción', async () => {
  const privada = await construccion('privada-escenario');
  const anotadas = [];
  await medirEscenario(construccionPrivada(privada), INICIO, (m) => anotadas.push(m));
  const { servidoPor } = anotadas.at(-1);
  assert.equal(servidoPor.comprobado, true, 'Lo servido consta comprobado, no solo declarado');
  assert.deepEqual(servidoPor.worker, { ruta: privada.oficial.ruta, sha256: privada.oficial.sha256 });
  assert.deepEqual(servidoPor.artefacto, { carpeta: privada.oficial.carpeta, sha256: privada.oficial.sha256Artefacto });
  await assert.rejects(
    medirEscenario(construccionPrivada(privada, OTRA.oficial.worker), INICIO, () => undefined),
    /Worker privado servido no es el cargado desde su construcción/u,
  );
});

test('un escenario que falla antes de comprobar lo que lo sirve lo deja como no comprobado', async () => {
  const privada = await construccion('privada-temprana');
  const fallarYa = async () => {
    throw new Error('El navegador se cerró');
  };
  for (const [construida, escenario, motivo] of [
    [construccionPrivada(privada, OTRA.oficial.worker), INICIO, /Worker privado/u],
    [MEDIDA, PORTADA, /se cerró/u],
  ]) {
    const anotadas = [];
    await assert.rejects(
      medirEscenario(construida, escenario, (m) => anotadas.push(m), fallarYa),
      motivo,
    );
    const ultima = anotadas.at(-1);
    assert.equal(ultima.estado, ESTADO.fallo);
    assert.equal(ultima.servidoPor.comprobado, false, `${escenario.nombre}: lo declarado no consta como comprobado`);
    assert.equal(ultima.servidoPor.destino, escenario.oficial ? 'oficial' : 'privado');
  }
});
