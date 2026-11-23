// Sobres de prueba firmados por OpenSSL, independiente del verificador noble del navegador.
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  ALGORITMOS,
  aBase64,
  COMBINACIONES,
  comprobarSobre,
  huella,
  idDeLaClave,
  mensajeAFirmar,
  TIPOS,
} from '../../web/scripts/firmas/firmas.js';

import { cadenaDelManifiesto, OPCIONES_DEL_MANIFIESTO } from '../../web/scripts/firmas/manifiesto-firmado.js';

/** @typedef {{ algoritmo: string, id: string, publica: string, privada: import('node:crypto').KeyObject }} Clave */
/** @param {string} algoritmo */
function parDeClaves(algoritmo) {
  if (algoritmo === 'ed25519') {
    return generateKeyPairSync('ed25519');
  }
  if (algoritmo === 'ml-dsa-65') {
    return generateKeyPairSync('ml-dsa-65');
  }
  if (algoritmo === 'slh-dsa-shake-192s') {
    return generateKeyPairSync('slh-dsa-shake-192s');
  }
  throw new Error(`Algoritmo no previsto en la prueba: ${algoritmo}`);
}
/** @param {readonly string[]} combinacion @returns {Clave[]} */
export function clavesDePrueba(combinacion) {
  return combinacion.map((algoritmo) => {
    const proveedor = ALGORITMOS[algoritmo];
    assert.ok(proveedor);
    const { publicKey, privateKey } = parDeClaves(algoritmo);
    const publica = new Uint8Array(
      publicKey.export({ format: 'der', type: 'spki' }).subarray(-proveedor.bytesDeLaClave),
    );
    return { algoritmo, id: idDeLaClave(publica), publica: aBase64(publica), privada: privateKey };
  });
}
/** @param {string} tipo @param {Uint8Array} bytes @param {Clave[]} claves */
export function firmar(tipo, bytes, claves) {
  const mensaje = mensajeAFirmar(tipo, bytes);
  return {
    tipo,
    contenido: aBase64(bytes),
    firmas: claves.map(({ algoritmo, id, privada }) => ({
      algoritmo,
      clave: id,
      firma: aBase64(new Uint8Array(sign(null, mensaje, privada))),
    })),
  };
}
/** @param {unknown} dato */
export function enBytes(dato) {
  return new TextEncoder().encode(JSON.stringify(dato));
}
/** @param {Clave[]} claves */
function publicas(claves) {
  return claves.map(({ algoritmo, id, publica }) => ({ algoritmo, id, publica }));
}

/** Una cadena completa con fechas fijas; solo genera claves efímeras de prueba en memoria. */
export function cadenaDePrueba() {
  const raiz = clavesDePrueba(COMBINACIONES.raiz);
  const diaria = clavesDePrueba(COMBINACIONES.diaria);
  const recurso = enBytes({ ejemplo: 'España · 🧭' });
  const bytes = enBytes({
    formato: 1,
    paquete: 'p1',
    archivos: { 'motor/entrada.js': huella(recurso), 'paquete/p1/datos.json': huella(recurso) },
  });
  const certificado = firmar(
    TIPOS.certificado,
    enBytes({
      formato: 1,
      claves: publicas(diaria),
      valida_desde: '2026-10-01T00:00:00Z',
      caduca: '2026-12-01T00:00:00Z',
    }),
    raiz,
  );
  const declaracion = firmar(
    TIPOS.manifiesto,
    enBytes({
      formato: 1,
      paquete: 'p1',
      manifiesto: { bytes: bytes.length, sha256: huella(bytes) },
      firmada: '2026-10-01T00:00:00Z',
      caduca: '2026-11-01T00:00:00Z',
    }),
    diaria,
  );
  return {
    bytes,
    recurso,
    firma: { formato: 1, certificado, declaracion },
    opciones: { paquete: 'p1', raices: publicas(raiz), retiradas: [], ahora: new Date('2026-10-14T00:00:00Z') },
  };
}

/** Oráculo síncrono para contrastar la cadena asíncrona de producción.
 * @param {Uint8Array} bytes @param {unknown} firma @param {import('../../web/scripts/firmas/manifiesto-firmado.js').OpcionesDelManifiesto} esperado */
export function comprobarManifiesto(bytes, firma, esperado) {
  const pasos = cadenaDelManifiesto(bytes, firma, { ...OPCIONES_DEL_MANIFIESTO(), ...esperado });
  let paso = pasos.next();
  while (paso.done !== true) {
    paso = pasos.next(comprobarSobre(paso.value.sobre, paso.value.esperado));
  }
  return paso.value;
}
