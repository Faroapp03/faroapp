import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CLAVES_DIARIAS_RETIRADAS, CLAVES_RAIZ } from '../../web/scripts/firmas/claves-raiz.js';
import {
  COMBINACIONES,
  clavesPublicas,
  comprobarSobre,
  FirmaRechazada,
  TIPOS,
} from '../../web/scripts/firmas/firmas.js';
import { cuadraConElManifiesto, leerManifiesto } from '../../web/scripts/firmas/manifiesto-firmado.js';
import { comprobarManifiestoNativo, comprobarSobreNativo, verificadorNativo } from '../../web/scripts/firmas/nativa.js';
import { bytesDeBase64, mensajeAFirmar } from '../../web/scripts/firmas/sobre-dsse.js';
import { cadenaDePrueba, clavesDePrueba, comprobarManifiesto, enBytes, firmar } from './ayudas.js';

const CIFRAS_DE_SHA256 = 64;
/** @param {string} motivo */
const rechazada = (motivo) => /** @param {unknown} error */ (error) =>
  error instanceof FirmaRechazada && error.motivo === motivo;

test('PAE cuenta bytes UTF-8 y el base64 conserva el contrato compartido', () => {
  assert.equal(new TextDecoder().decode(mensajeAFirmar('á', enBytes('🧭'))), 'DSSEv1 2 á 6 "🧭"');
  for (const texto of [null, 1, 'QQ', 'QQ=', 'Q Q=', 'QQ-_', 'QQ===']) {
    assert.equal(bytesDeBase64(texto), null);
  }
  assert.deepEqual(bytesDeBase64('QUI='), new TextEncoder().encode('AB'));
  assert.ok(Object.isFrozen(CLAVES_RAIZ));
  assert.ok(Object.isFrozen(CLAVES_DIARIAS_RETIRADAS));
});

test('las dos firmas híbridas de OpenSSL valen con noble y Web Crypto; quitar una no rebaja la combinación', async () => {
  const claves = clavesDePrueba(COMBINACIONES.diaria);
  const bytes = enBytes({ prueba: 'España 🧭' });
  const sobre = firmar(TIPOS.manifiesto, bytes, claves);
  const esperado = {
    tipo: TIPOS.manifiesto,
    combinacion: COMBINACIONES.diaria,
    claves: clavesPublicas(claves, COMBINACIONES.diaria),
  };
  assert.deepEqual(comprobarSobre(sobre, esperado), bytes);
  assert.deepEqual(await comprobarSobreNativo(sobre, esperado), bytes);
  const fallback = verificadorNativo(null);
  assert.deepEqual(await comprobarSobreNativo(sobre, esperado, fallback), bytes);
  assert.deepEqual([...fallback.implementaciones.values()], ['noble', 'noble']);
  const incompleta = { ...sobre, firmas: sobre.firmas.slice(0, 1) };
  assert.throws(() => comprobarSobre(incompleta, esperado), rechazada('combinacion'));
  await assert.rejects(comprobarSobreNativo(incompleta, esperado), rechazada('combinacion'));
  const alterada = { ...sobre, contenido: Buffer.from('otro').toString('base64') };
  assert.throws(() => comprobarSobre(alterada, esperado), rechazada('firma-no-valida'));
  await assert.rejects(comprobarSobreNativo(alterada, esperado), rechazada('firma-no-valida'));
});

test('la cadena completa valida raíz, paquete, vigencia y cada recurso antes de usarlos', async () => {
  const { bytes, recurso, firma, opciones } = cadenaDePrueba();
  const archivos = comprobarManifiesto(bytes, firma, opciones);
  assert.deepEqual(await comprobarManifiestoNativo(bytes, firma, opciones), archivos);
  assert.deepEqual(await comprobarManifiestoNativo(bytes, firma, opciones, verificadorNativo(null)), archivos);
  assert.deepEqual(leerManifiesto(bytes, 'p1').archivos, archivos);
  cuadraConElManifiesto(archivos, 'motor/entrada.js', recurso);
  assert.throws(() => cuadraConElManifiesto(archivos, 'motor/entrada.js', enBytes('otro')), rechazada('alterado'));
  assert.throws(() => comprobarManifiesto(bytes, firma, { ...opciones, paquete: 'p2' }), rechazada('otra-version'));
  assert.throws(
    () => comprobarManifiesto(bytes, firma, { ...opciones, ahora: new Date('2026-11-01T00:00:00Z') }),
    rechazada('caducada'),
  );
  assert.throws(() => comprobarManifiesto(bytes, firma, { ...opciones, raices: [] }), rechazada('sin-raiz'));
  for (const ruta of ['.', '..', 'motor/..', '../fuera.js', '/absoluta', 'motor/entrada.js?x']) {
    assert.throws(
      () => leerManifiesto(enBytes({ formato: 1, paquete: 'p1', archivos: { [ruta]: 'a'.repeat(CIFRAS_DE_SHA256) } })),
      rechazada('formato'),
    );
  }
});
