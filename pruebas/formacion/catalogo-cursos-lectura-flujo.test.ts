import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { cargarCatalogo } from '../../src/catalogo-cursos/carga.ts';
import { CatalogoNoValido } from '../../src/catalogo-cursos/contrato.ts';

const bytes = readFileSync(new URL('../fixtures/catalogo-cursos-publico.utf8', import.meta.url));
const referencia = JSON.parse(
  readFileSync(new URL('../fixtures/catalogo-cursos-publico.referencia.json', import.meta.url), 'utf8'),
);
const publicacion = { ...referencia, ruta: `datos/catalogo-cursos/${referencia.sha256}.json` };
const base = new URL('https://ejemplo.invalid/');

function respuestaConLector(flujo: ReadableStream<Uint8Array>) {
  const respuesta = new Response(flujo, { headers: { 'content-type': 'application/json' } });
  const lector = flujo.getReader();
  let cancelaciones = 0;
  let liberaciones = 0;
  const cancelar = lector.cancel.bind(lector);
  const liberar = lector.releaseLock.bind(lector);
  lector.cancel = (...args) => {
    cancelaciones += 1;
    return cancelar(...args);
  };
  lector.releaseLock = () => {
    liberaciones += 1;
    liberar();
  };
  Object.defineProperty(flujo, 'getReader', { value: () => lector });
  return {
    respuesta,
    flujo,
    get cancelaciones() {
      return cancelaciones;
    },
    get liberaciones() {
      return liberaciones;
    },
  };
}

test('lectura completa valida bytes sin cancelar el lector y libera el bloqueo', async () => {
  const flujo = new ReadableStream<Uint8Array>({
    start(control) {
      control.enqueue(bytes);
      control.close();
    },
  });
  const control = respuestaConLector(flujo);
  const catalogo = await cargarCatalogo(publicacion, base, async () => control.respuesta);
  assert.ok(catalogo);
  assert.equal(control.cancelaciones, 0);
  assert.equal(control.liberaciones, 1);
  assert.equal(flujo.locked, false);
});

test('exceso cancela la lectura, libera el bloqueo y rechaza la publicación', async () => {
  const flujo = new ReadableStream<Uint8Array>({
    start(control) {
      control.enqueue(new Uint8Array(bytes.length + 1));
    },
  });
  const control = respuestaConLector(flujo);
  await assert.rejects(
    cargarCatalogo(publicacion, base, async () => control.respuesta),
    CatalogoNoValido,
  );
  assert.equal(control.cancelaciones, 1);
  assert.equal(control.liberaciones, 1);
  assert.equal(flujo.locked, false);
});

test('lectura interrumpida conserva el error y libera el bloqueo aunque cancelar rechace', async () => {
  const error = new Error('interrupción sintética');
  const flujo = new ReadableStream<Uint8Array>({
    start(control) {
      control.error(error);
    },
  });
  const control = respuestaConLector(flujo);
  await assert.rejects(
    cargarCatalogo(publicacion, base, async () => control.respuesta),
    (recibido: unknown) => recibido === error,
  );
  assert.equal(control.cancelaciones, 1);
  assert.equal(control.liberaciones, 1);
  assert.equal(flujo.locked, false);
});

test('bytes completos alterados conservan el rechazo por huella', async () => {
  const corruptos = Uint8Array.from(bytes);
  corruptos[0] = (corruptos[0] ?? 0) ^ 1;
  const flujo = new ReadableStream<Uint8Array>({
    start(control) {
      control.enqueue(corruptos);
      control.close();
    },
  });
  const control = respuestaConLector(flujo);
  await assert.rejects(
    cargarCatalogo(publicacion, base, async () => control.respuesta),
    CatalogoNoValido,
  );
  assert.equal(control.cancelaciones, 0);
  assert.equal(control.liberaciones, 1);
});
