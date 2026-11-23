// Compatibilidad local con Request.body ausente, sin navegador, red ni cuerpos de proveedor.
import assert from 'node:assert/strict';
import { type TestContext, test } from 'node:test';
import { leerTextoLimitado } from '../../src/api/cuerpo.ts';
import { clonarPeticionConSenal, crearPeticionLocal } from '../../src/api/cuerpo-local.ts';
import { PeticionCancelada, PlazoAgotado, SolicitudInvalida } from '../../src/api/errores.ts';
import { MAX_CUERPO_BYTES } from '../../src/seguridad/limites.ts';

const URL_LOCAL = 'https://local.invalid/api/clasificar';
const JSON_REAL = '{"texto":"Soy conductor de autobús urbano","idioma":"es"}';

function local(body: string | null, headers: [string, string][] = []): Request {
  return crearPeticionLocal({ url: URL_LOCAL, method: 'POST', headers, body });
}

/** Solo oculta el getter; el constructor, el cuerpo, text(), bodyUsed y el clone siguen siendo nativos. */
function sinBody(t: TestContext): void {
  const descriptor = Object.getOwnPropertyDescriptor(Request.prototype, 'body');
  assert.ok(descriptor);
  Object.defineProperty(Request.prototype, 'body', { ...descriptor, get: () => undefined });
  t.after(() => Object.defineProperty(Request.prototype, 'body', descriptor));
}

test('el cuerpo local sin body sobrevive a la clonación y conserva JSON, bodyUsed y consumo único', async (t) => {
  sinBody(t);
  const original = local(JSON_REAL);
  const copia = clonarPeticionConSenal(original, new AbortController().signal);
  assert.equal(typeof copia.body, 'undefined');
  assert.equal(await leerTextoLimitado(copia), JSON_REAL);
  assert.equal(copia.bodyUsed, true);
  await assert.rejects(leerTextoLimitado(copia), TypeError);
  await assert.rejects(copia.text(), TypeError);
  assert.throws(() => clonarPeticionConSenal(copia, new AbortController().signal), TypeError);
  await assert.rejects(leerTextoLimitado(original), TypeError);
});

test('no habilita text() para una petición arbitraria sin registro', async (t) => {
  sinBody(t);
  const request = new Request(URL_LOCAL, { method: 'POST', body: JSON_REAL });
  t.mock.method(request, 'text', () => {
    throw new Error('no se debe leer sin cota');
  });
  assert.equal(await leerTextoLimitado(request), '');
  assert.equal(request.bodyUsed, false);
});

test('con body disponible mantiene el lector de flujo y no llama a text()', async (t) => {
  const request = local(JSON_REAL);
  t.mock.method(request, 'text', () => {
    throw new Error('el flujo nativo está disponible');
  });
  assert.equal(await leerTextoLimitado(request), JSON_REAL);
  assert.equal(request.bodyUsed, true);
});

test('conserva exactamente la decodificación nativa de vacío, Unicode, BOM y sustitutos aislados', async (t) => {
  sinBody(t);
  for (const texto of ['', JSON_REAL, 'ñ🚌 català', '\ufefftexto', '\ud800solo\udfff']) {
    const nativa = new Request(URL_LOCAL, { method: 'POST', body: texto });
    assert.equal(await leerTextoLimitado(local(texto)), await nativa.text());
  }
  const vacia = crearPeticionLocal({ url: URL_LOCAL, method: 'GET', headers: [], body: null });
  assert.equal(await leerTextoLimitado(vacia), '');
  assert.equal(vacia.bodyUsed, false);
});

test('el límite real admite MAX bytes y rechaza exceso ASCII/multibyte incluso con cabecera mentirosa', async (t) => {
  sinBody(t);
  assert.equal((await leerTextoLimitado(local('x'.repeat(MAX_CUERPO_BYTES)))).length, MAX_CUERPO_BYTES);
  assert.equal(await leerTextoLimitado(local('ñ'.repeat(MAX_CUERPO_BYTES / 2))), 'ñ'.repeat(MAX_CUERPO_BYTES / 2));
  for (const texto of ['x'.repeat(MAX_CUERPO_BYTES + 1), 'ñ'.repeat(MAX_CUERPO_BYTES / 2 + 1)]) {
    for (const headers of [[], [['content-length', '1']]] satisfies [string, string][][]) {
      const request = clonarPeticionConSenal(local(texto, headers), new AbortController().signal);
      t.mock.method(request, 'text', () => {
        throw new Error('un exceso nunca se lee completo');
      });
      await assert.rejects(
        leerTextoLimitado(request),
        (error: unknown) => error instanceof SolicitudInvalida && error.message === 'la petición es demasiado grande',
      );
      assert.equal(request.headers.get('content-length'), headers.length ? '1' : null);
      await assert.rejects(leerTextoLimitado(request), TypeError);
    }
  }
});

test('el marcador de exceso también rechaza con body disponible', async () => {
  await assert.rejects(leerTextoLimitado(local('x'.repeat(MAX_CUERPO_BYTES + 1))), SolicitudInvalida);
});

test('la guardia de memoria no codifica una cadena cuyo length ya excede el máximo', (t) => {
  t.mock.method(TextEncoder.prototype, 'encode', () => {
    throw new Error('no duplicar el cuerpo excesivo');
  });
  assert.ok(local('x'.repeat(MAX_CUERPO_BYTES + 1)));
});

test('la rama de exceso no admite GET/HEAD con cuerpo, métodos ni cabeceras inválidos', () => {
  for (const body of ['', 'x'.repeat(MAX_CUERPO_BYTES + 1)]) {
    for (const method of ['GET', 'HEAD', 'TRACE', 'bad method']) {
      assert.throws(() => crearPeticionLocal({ url: URL_LOCAL, method, headers: [], body }), TypeError);
    }
    assert.throws(
      () => crearPeticionLocal({ url: URL_LOCAL, method: 'POST', headers: [['bad\nname', 'x']], body }),
      TypeError,
    );
  }
});

test('la señal ya abortada conserva exactamente su motivo', async (t) => {
  sinBody(t);
  const retirada = new AbortController();
  const motivo = new PeticionCancelada();
  retirada.abort(motivo);
  const request = clonarPeticionConSenal(local(JSON_REAL), retirada.signal);
  await assert.rejects(leerTextoLimitado(request), (error: unknown) => error === motivo);
  assert.equal(request.bodyUsed, false);
});

for (const Motivo of [PeticionCancelada, PlazoAgotado]) {
  test(`retirada durante text() conserva ${Motivo.name}, consumo nativo y retira la escucha`, async (t) => {
    sinBody(t);
    const retirada = new AbortController();
    const request = clonarPeticionConSenal(local(JSON_REAL), retirada.signal);
    const nativo = request.text.bind(request);
    const leida = Promise.withResolvers<void>();
    const continuar = Promise.withResolvers<void>();
    t.mock.method(request, 'text', async () => {
      const texto = await nativo();
      leida.resolve();
      await continuar.promise;
      return texto;
    });
    const agregar = t.mock.method(request.signal, 'addEventListener');
    const quitar = t.mock.method(request.signal, 'removeEventListener');
    const pendiente = leerTextoLimitado(request);
    await leida.promise;
    const motivo = new Motivo();
    retirada.abort(motivo);
    await assert.rejects(pendiente, (error: unknown) => error === motivo);
    continuar.resolve();
    assert.equal(request.bodyUsed, true);
    assert.equal(agregar.mock.callCount(), 1);
    assert.equal(quitar.mock.callCount(), 1);
    assert.equal(agregar.mock.calls[0]?.arguments[1], quitar.mock.calls[0]?.arguments[1]);
  });
}
