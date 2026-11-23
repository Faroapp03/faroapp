import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { ArchivoDelPaqueteYaLeido, leerArchivoDelPaquete } from '../../src/comun/archivo-del-paquete.ts';
import type { ArchivoDelPaquete } from '../../src/plataforma/archivos-del-paquete.ts';
import { datosQueSeLeenAlUsarlos } from '../../src/plataforma/cloudflare/paquete.ts';

// Cloudflare corta un aislado por memoria o por tiempo sin una excepción que el código pueda capturar. Aquí se
// reproduce igual: un plazo de vm termina la ejecución dentro de una etapa de la lectura, ningún catch llega a correr
// y la lectura siguiente, en el mismo proceso, tiene que dar la parte completa y no dejar ningún texto sin soltar.

const PLAZO_MS = 200;

function bytesDelArchivo(archivo = 'oit.json'): ArrayBuffer {
  const leidos = readFileSync(new URL(`../../datos/${archivo}`, import.meta.url));
  return leidos.buffer.slice(leidos.byteOffset, leidos.byteOffset + leidos.byteLength) as ArrayBuffer;
}

function paqueteConBytes(bytes: ArrayBuffer, otros: Record<string, ArrayBuffer> = {}) {
  return datosQueSeLeenAlUsarlos({ 'oit.json': bytes, ...otros } as unknown as Record<ArchivoDelPaquete, unknown>);
}

/** El texto de un archivo cuyos bytes ya se soltaron está soltado si leerlo otra vez es un error. */
function assertTextoSoltado(bytes: ArrayBuffer): void {
  assert.throws(() => leerArchivoDelPaquete(bytes), ArchivoDelPaqueteYaLeido, 'no queda ningún texto sin soltar');
}

/** Sustituye un método para que su primera llamada que cumpla `cuando` no termine nunca; la vuelve a dejar como era. */
function bloquear<Objeto extends object>(
  objeto: Objeto,
  metodo: keyof Objeto,
  cuando: (...argumentos: unknown[]) => boolean = () => true,
): () => void {
  const original = objeto[metodo] as (...argumentos: unknown[]) => unknown;
  let bloqueado = false;
  Object.defineProperty(objeto, metodo, {
    configurable: true,
    writable: true,
    value(this: unknown, ...argumentos: unknown[]) {
      if (!bloqueado && cuando(...argumentos)) {
        bloqueado = true;
        for (;;) {
          // La espera que corta el plazo, como el límite del aislado.
        }
      }
      return original.apply(this, argumentos);
    },
  });
  return () => Object.defineProperty(objeto, metodo, { configurable: true, writable: true, value: original });
}

function cortarLectura(leer: () => unknown, restaurar: () => void): void {
  try {
    assert.throws(() => vm.runInNewContext('leer()', { leer }, { timeout: PLAZO_MS }), /timed out/);
  } finally {
    restaurar();
  }
}

const referencia = paqueteConBytes(bytesDelArchivo()).oit;

const ETAPAS: Array<[string, () => () => void]> = [
  ['al analizar el JSON', () => bloquear(JSON, 'parse')],
  ['al preparar la parte', () => bloquear(Map.prototype, 'set')],
  ['entre guardarla y soltar su texto', () => bloquear(WeakMap.prototype, 'delete')],
  [
    'al fijar la parte, con su texto ya soltado',
    () =>
      bloquear(
        Object,
        'defineProperty',
        (_objeto, clave, descriptor) => clave === 'oit' && 'value' in Object(descriptor),
      ),
  ],
];

for (const [etapa, preparar] of ETAPAS) {
  test(`una lectura del paquete cortada ${etapa} se repite y da la parte completa`, () => {
    const bytes = bytesDelArchivo();
    const paquete = paqueteConBytes(bytes);
    cortarLectura(() => paquete.oit, preparar());
    assert.equal(bytes.detached, true, 'el corte llegó después de soltar los bytes');
    assert.deepEqual(paquete.oit, referencia);
    assert.equal(paquete.oit, paquete.oit);
    assertTextoSoltado(bytes);
    assert.equal('value' in Object(Object.getOwnPropertyDescriptor(paquete, 'oit')), true, 'la parte queda fijada');
  });
}

test('una parte cortada entre guardarla y soltar su texto se cierra al leer otra parte', () => {
  const bytes = bytesDelArchivo();
  const otros = bytesDelArchivo('clasificaciones.json');
  const paquete = paqueteConBytes(bytes, { 'clasificaciones.json': otros });
  cortarLectura(() => paquete.oit, bloquear(WeakMap.prototype, 'delete'));
  assert.ok(paquete.clasificaciones);
  assertTextoSoltado(bytes);
  assertTextoSoltado(otros);
  assert.equal(
    'value' in Object(Object.getOwnPropertyDescriptor(paquete, 'oit')),
    true,
    'la parte cortada queda fijada',
  );
  assert.deepEqual(paquete.oit, referencia);
});
