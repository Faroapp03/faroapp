import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { pedir, prepararPaquete, servicio } from './ayudas.ts';

const CIFRAS_VERSION = 16;
const DESCARTES_DE_PROVISIONAL = 2;
/** Las peticiones a la vez de la copia (src/service-worker/copia.js, PETICIONES_A_LA_VEZ). */
const CONCURRENCIA_DEL_SW = 6;
const huella = (texto: string) => createHash('sha256').update(texto).digest('hex');

test('la copia provisional espera las descargas ya iniciadas tras el primer fallo', async () => {
  const archivos = Array.from({ length: CONCURRENCIA_DEL_SW + 1 }, (_, indice) => `pagina-${indice}.html`);
  const sw = servicio('https://ejemplo.invalid/', { archivos });
  sw.conectar();
  const pendiente = Promise.withResolvers<Response>();
  const primero = new Error('Primera descarga fallida');
  sw.red.respuesta = (url) => (url.endsWith('/pagina-0.html') ? Promise.reject(primero) : pendiente.promise);
  let terminada = false;
  let error: unknown;
  const tarea = sw
    .instalar()
    .catch((fallo: unknown) => {
      error = fallo;
    })
    .finally(() => {
      terminada = true;
    });
  try {
    await new Promise((resolver) => setImmediate(resolver));
    assert.equal(terminada, false);
    assert.equal(sw.peticiones.length, CONCURRENCIA_DEL_SW);
    assert.equal(
      sw.borradas.filter((nombre) => nombre.endsWith(':provisional')).length,
      1,
      'solo el descarte anterior, no el finally',
    );
  } finally {
    pendiente.resolve(new Response('SIN CONEXIÓN', { headers: { 'content-type': 'text/html' } }));
    await tarea;
  }
  assert.equal(error, primero);
  assert.equal(sw.peticiones.length, CONCURRENCIA_DEL_SW, 'el fallo no inicia el último archivo de la cola');
  assert.equal(sw.borradas.filter((nombre) => nombre.endsWith(':provisional')).length, DESCARTES_DE_PROVISIONAL);
});

for (const archivo of ['../../api', '../../api%2Fsalud', '../../activar-acceso.html']) {
  test(`un manifiesto defectuoso nunca pide rutas operativas: ${archivo}`, async () => {
    const datos = 'datos';
    const manifiesto = JSON.stringify({ [archivo]: { sha256: huella(datos) } });
    const version = huella(manifiesto).slice(0, CIFRAS_VERSION);
    const sw = servicio('https://ejemplo.invalid/', { paquete: version });
    sw.conectar();
    sw.red.respuesta = (url) => new Response(url.endsWith('/manifiesto.json') ? manifiesto : datos);
    await prepararPaquete(sw);
    assert.deepEqual(sw.peticiones, [sw.urlDe(`paquete/${version}/manifiesto.json`)]);
    assert.equal(sw.guardadas.get(`faro-paquete-${version}`)?.size, 0);
  });
}

test('paquete válido conserva bytes y manifiesto, sin otra descarga al repetir', async () => {
  const datos = '{"valor":"actual"}';
  const manifiesto = JSON.stringify({ 'datos.json': { sha256: huella(datos) } });
  const version = huella(manifiesto).slice(0, CIFRAS_VERSION);
  const sw = servicio('https://ejemplo.invalid/', { paquete: version });
  sw.conectar();
  sw.red.respuesta = (url) => new Response(url.endsWith('/manifiesto.json') ? manifiesto : datos);
  await prepararPaquete(sw);
  const antes = [...sw.peticiones];
  assert.equal((await pedir(sw, `paquete/${version}/datos.json`, { mode: 'cors', method: 'GET' })).cuerpo, datos);
  await prepararPaquete(sw);
  assert.deepEqual(sw.peticiones, antes);
  assert.equal(
    await sw.guardadas
      .get(`faro-paquete-${version}`)
      ?.get(sw.urlDe(`paquete/${version}/manifiesto.json`))
      ?.text(),
    manifiesto,
  );
});
