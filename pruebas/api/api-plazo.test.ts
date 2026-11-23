// Plazos y cancelación de trabajos locales.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PeticionCancelada, PlazoAgotado } from '../../src/api/errores.ts';
import { dentroDelPlazo, PLAZO_PETICION_MS, PlazoInvalido, plazoDelEntorno } from '../../src/api/plazo.ts';

const LIMITE = 1000;
const PLAZO_BREVE = 30;
const UN_MINUTO_MS = 60_000;

test('el servicio conserva 50 segundos y admite segundos enteros sin pérdida de precisión', () => {
  assert.equal(plazoDelEntorno({}), PLAZO_PETICION_MS);
  assert.equal(plazoDelEntorno({ FARO_PLAZO_PETICION_S: ' 60 ' }), UN_MINUTO_MS);
  assert.equal(plazoDelEntorno({ FARO_PLAZO_PETICION_S: '' }), PLAZO_PETICION_MS);
  for (const valor of ['0', '-1', '1.5', '1e2', '0x10', '9007199254740991']) {
    assert.throws(() => plazoDelEntorno({ FARO_PLAZO_PETICION_S: valor }), PlazoInvalido);
  }
});

test('el trabajo devuelve por identidad y al terminar aborta su señal; el fallo síncrono conserva identidad', async () => {
  const salida = { ok: true };
  let senal: AbortSignal | undefined;
  assert.equal(
    await dentroDelPlazo(async (s) => {
      senal = s;
      return salida;
    }, LIMITE),
    salida,
  );
  assert.equal(senal?.aborted, true);
  assert.ok(senal?.reason instanceof PeticionCancelada);
  const fallo = new Error('fallo ficticio');
  await assert.rejects(
    dentroDelPlazo(() => {
      throw fallo;
    }, LIMITE),
    (e: unknown) => e === fallo,
  );
});

test('la retirada previa no ejecuta trabajo y la retirada en curso lo aborta', async () => {
  const retirada = new AbortController();
  retirada.abort();
  let llamadas = 0;
  await assert.rejects(
    dentroDelPlazo(
      async () => {
        llamadas++;
      },
      LIMITE,
      retirada.signal,
    ),
    PeticionCancelada,
  );
  assert.equal(llamadas, 0);
  const activa = new AbortController();
  const iniciada = Promise.withResolvers<AbortSignal>();
  const pendiente = dentroDelPlazo(
    (s) => {
      iniciada.resolve(s);
      return new Promise<never>(() => {});
    },
    LIMITE,
    activa.signal,
  );
  const comprobacion = assert.rejects(pendiente, PeticionCancelada);
  const senal = await iniciada.promise;
  activa.abort();
  await comprobacion;
  assert.equal(senal.aborted, true);
});

test('vencer el reloj rechaza y aborta aunque el trabajo ignore la señal; su fallo tardío queda atendido', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const iniciada = Promise.withResolvers<AbortSignal>();
  const trabajo = Promise.withResolvers<never>();
  const pendiente = dentroDelPlazo((s) => {
    iniciada.resolve(s);
    return trabajo.promise;
  }, PLAZO_BREVE);
  const comprobacion = assert.rejects(pendiente, PlazoAgotado);
  const senal = await iniciada.promise;
  t.mock.timers.tick(PLAZO_BREVE);
  await comprobacion;
  assert.equal(senal.aborted, true);
  assert.ok(senal.reason instanceof PlazoAgotado);
  trabajo.reject(new Error('fallo tardío ficticio'));
  await Promise.resolve();
});
