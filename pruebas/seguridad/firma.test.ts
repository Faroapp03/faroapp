import assert from 'node:assert/strict';
import { createHmac, hkdfSync } from 'node:crypto';
import { test } from 'node:test';
import { TextoJcsInvalido } from '../../src/comun/jcs.ts';
import { crearFirmador, subclaveDe, type UsoDeFirma } from '../../src/seguridad/firma.ts';

const BYTES_SECRETO = 32;
const BYTES_KID = 6;
const BYTES_POR_TILDE = 2;
const AHORA = 1_800_000_000_000;
const VIGENCIA = 1000;
const SECRETO = 'x'.repeat(BYTES_SECRETO);
const SAL = 'faro/firma/v1';
const INFO_KID = `${SAL}/kid`;
const USOS: readonly UsoDeFirma[] = ['estimaciones', 'tokens-de-socios'];
const DATOS = { z: [null, '😀', true], a: { tarea: 'Archivar', nota: 1 } };
const CANONICO = '{"a":{"nota":1,"tarea":"Archivar"},"z":[null,"😀",true]}';

/** Referencia independiente de Web Crypto: HKDF y HMAC nativos de Node, sobre bytes canónicos conocidos. */
function firmaDelTexto(secreto: string, uso: UsoDeFirma): string {
  const clave = hkdfSync('sha256', secreto, SAL, `${SAL}/${uso}`, BYTES_SECRETO);
  const kid = Buffer.from(hkdfSync('sha256', secreto, SAL, INFO_KID, BYTES_KID)).toString('base64url');
  const caduca = AHORA + VIGENCIA;
  const mac = createHmac('sha256', Buffer.from(clave)).update(`${caduca}.${CANONICO}`).digest('base64url');
  return `${kid}.${caduca}.${mac}`;
}

test('HKDF y firma de cada uso coinciden byte a byte con node:crypto', async () => {
  for (const uso of USOS) {
    const firmador = await crearFirmador(SECRETO, VIGENCIA, () => AHORA, { uso });
    const firma = await firmador.firmar(DATOS);
    assert.equal(firma, firmaDelTexto(SECRETO, uso));
    assert.match(firma, /^[A-Za-z0-9_-]{8}\.\d{13}\.[A-Za-z0-9_-]{43}$/);
    assert.equal(await firmador.comprobar(DATOS, firma), true);
    const subclave = await subclaveDe(SECRETO, uso);
    assert.equal(subclave.clave.extractable, false);
    await assert.rejects(crypto.subtle.exportKey('raw', subclave.clave));
  }
});

test('HKDF-Expand de clave no extraíble coincide con HMAC nativo para todos los usos', async () => {
  const bytes = new TextEncoder().encode(SECRETO);
  const prk = await crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  for (const uso of USOS) {
    const clave = createHmac('sha256', bytes).update(`${SAL}/${uso}\u0001`).digest();
    const kid = createHmac('sha256', bytes).update(`${INFO_KID}\u0001`).digest().subarray(0, BYTES_KID);
    const caduca = AHORA + VIGENCIA;
    const mac = createHmac('sha256', clave).update(`${caduca}.${CANONICO}`).digest('base64url');
    const firmador = await crearFirmador(prk, VIGENCIA, () => AHORA, { uso });
    assert.equal(await firmador.firmar(DATOS), `${kid.toString('base64url')}.${caduca}.${mac}`);
    assert.equal((await subclaveDe(prk, uso)).clave.extractable, false);
  }
  await assert.rejects(crypto.subtle.exportKey('raw', prk));
});

test('el orden de construcción es irrelevante y otros datos o usos invalidan la firma', async () => {
  const firmador = await crearFirmador(SECRETO, VIGENCIA, () => AHORA);
  const firma = await firmador.firmar(DATOS);
  assert.equal(await firmador.comprobar({ a: { nota: 1, tarea: 'Archivar' }, z: [null, '😀', true] }, firma), true);
  assert.equal(await firmador.comprobar({ ...DATOS, a: { nota: 2, tarea: 'Archivar' } }, firma), false);
  const socios = await crearFirmador(SECRETO, VIGENCIA, () => AHORA, { uso: 'tokens-de-socios' });
  assert.equal(await socios.comprobar(DATOS, firma), false);
});

test('la rotación acepta la anterior y emite solo con la actual; retirarla invalida lo viejo', async () => {
  const actual = 'y'.repeat(BYTES_SECRETO);
  const viejo = await crearFirmador(SECRETO, VIGENCIA, () => AHORA);
  const firmaVieja = await viejo.firmar(DATOS);
  const rotado = await crearFirmador(actual, VIGENCIA, () => AHORA, { anterior: SECRETO });
  assert.equal(await rotado.comprobar(DATOS, firmaVieja), true);
  assert.equal(await rotado.firmar(DATOS), firmaDelTexto(actual, 'estimaciones'));
  const sinAnterior = await crearFirmador(actual, VIGENCIA, () => AHORA, { anterior: undefined });
  assert.equal(await sinAnterior.comprobar(DATOS, firmaVieja), false);
});

test('la caducidad es inclusiva y se rechaza al siguiente milisegundo', async () => {
  let reloj = AHORA;
  const firmador = await crearFirmador(SECRETO, VIGENCIA, () => reloj);
  const firma = await firmador.firmar(DATOS);
  reloj += VIGENCIA;
  assert.equal(await firmador.comprobar(DATOS, firma), true);
  reloj++;
  assert.equal(await firmador.comprobar(DATOS, firma), false);
});

test('formas inválidas se rechazan antes de Web Crypto, incluida una cadena extensa', async (prueba) => {
  const firmador = await crearFirmador(SECRETO, VIGENCIA, () => AHORA);
  const firma = await firmador.firmar(DATOS);
  const [kid = '', caducidad = '', hmac = ''] = firma.split('.');
  const verificar = prueba.mock.method(crypto.subtle, 'verify');
  const longitudExcesiva = 10_000;
  const invalidas: unknown[] = [null, {}, 1, `${firma}.x`, '.'.repeat(longitudExcesiva), `${firma}😀`, ''];
  for (const otra of [`0${caducidad}`, `+${caducidad}`, ` ${caducidad}`, `${caducidad}e0`]) {
    invalidas.push(`${kid}.${otra}.${hmac}`);
  }
  for (const otro of ['', hmac.slice(0, -1), `${hmac}A`, `${hmac}=`, `${hmac.slice(0, -1)}+`]) {
    invalidas.push(`${kid}.${caducidad}.${otro}`);
  }
  for (const invalida of invalidas) {
    assert.equal(await firmador.comprobar(DATOS, invalida), false);
  }
  assert.equal(verificar.mock.callCount(), 0);
  assert.equal(await firmador.comprobar(DATOS, firma), true);
  assert.equal(verificar.mock.callCount(), 1);
});

test('el secreto se mide en bytes UTF8 y una clave de otro algoritmo se rechaza', async () => {
  await assert.rejects(crearFirmador('á'.repeat(BYTES_SECRETO / BYTES_POR_TILDE - 1)), {
    message: 'El secreto de firma debe tener al menos 32 bytes UTF-8',
  });
  const utf8 = 'á'.repeat(BYTES_SECRETO / BYTES_POR_TILDE);
  const firmador = await crearFirmador(utf8, VIGENCIA, () => AHORA);
  assert.equal(await firmador.firmar(DATOS), firmaDelTexto(utf8, 'estimaciones'));
  const longitudAes = 256;
  const otra = await crypto.subtle.generateKey({ name: 'AES-GCM', length: longitudAes }, false, ['encrypt', 'decrypt']);
  await assert.rejects(crearFirmador(otra), {
    message: 'La clave de firma tiene que ser HMAC-SHA-256 y poder firmar y comprobar',
  });
});

test('los datos no JSON rechazan en ambas operaciones sin esconder sus errores', async () => {
  const firmador = await crearFirmador(SECRETO, VIGENCIA, () => AHORA);
  const firma = await firmador.firmar(DATOS);
  await assert.rejects(firmador.firmar({ nota: Number.NaN }), TypeError);
  await assert.rejects(firmador.comprobar({ nota: Number.NaN }, firma), TypeError);
  const error = new Error('getter de prueba');
  const conGetter = {
    get nota() {
      throw error;
    },
  };
  await assert.rejects(firmador.comprobar(conGetter, firma), (recibido) => recibido === error);
});

test('no firma Unicode inválido y rechaza con false firmas antiguas de esos datos', async () => {
  const datos = { texto: 'a\ud800b' };
  const canonicoAntiguo = '{"texto":"a\\ud800b"}';
  const clave = hkdfSync('sha256', SECRETO, SAL, `${SAL}/estimaciones`, BYTES_SECRETO);
  const kid = Buffer.from(hkdfSync('sha256', SECRETO, SAL, INFO_KID, BYTES_KID)).toString('base64url');
  const caduca = AHORA + VIGENCIA;
  const mac = createHmac('sha256', Buffer.from(clave)).update(`${caduca}.${canonicoAntiguo}`).digest('base64url');
  const firmador = await crearFirmador(SECRETO, VIGENCIA, () => AHORA);
  await assert.rejects(firmador.firmar(datos), TextoJcsInvalido);
  assert.equal(await firmador.comprobar(datos, `${kid}.${caduca}.${mac}`), false);
});

test('comprobar propaga TypeError de getters y errores de Web Crypto', async (prueba) => {
  const firmador = await crearFirmador(SECRETO, VIGENCIA, () => AHORA);
  const firma = await firmador.firmar(DATOS);
  const error = new TypeError('getter de prueba');
  const conGetter = {
    get nota() {
      throw error;
    },
  };
  await assert.rejects(firmador.comprobar(conGetter, firma), (recibido) => recibido === error);
  const falloCrypto = new Error('verify de prueba');
  prueba.mock.method(crypto.subtle, 'verify', () => Promise.reject(falloCrypto));
  await assert.rejects(firmador.comprobar(DATOS, firma), (recibido) => recibido === falloCrypto);
});
