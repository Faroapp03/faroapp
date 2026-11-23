// IndexedDB en memoria para persistencia, conversión del secreto antiguo y cierre de conexiones.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AlmacenConFallo, borrarSecretoDeFirma, secretoDeFirma } from '../../web/scripts/motor-local/secreto-firma.js';

const BYTES_DEL_SECRETO_ANTIGUO = 32;

class Solicitud {
  /** @type {unknown} */ result;
  error = null;
  onsuccess = () => {};
  onerror = () => {};
  onblocked = () => {};
  onupgradeneeded = () => {};
  /** @param {() => void} resolver */
  constructor(resolver) {
    setTimeout(resolver, 0);
  }
}
class IndexedDbDePrueba {
  /** @type {Map<string, unknown>} */ valores = new Map();
  /** @type {Set<{ onversionchange: (() => void) | null, close: () => void }>} */ abiertas = new Set();
  creada = false;
  open() {
    const peticion = new Solicitud(() => {
      const conexion = this.conexion();
      this.abiertas.add(conexion);
      peticion.result = conexion;
      if (!this.creada) {
        peticion.onupgradeneeded();
        this.creada = true;
      }
      peticion.onsuccess();
    });
    return peticion;
  }
  conexion() {
    const conexion = {
      /** @type {(() => void) | null} */ onversionchange: null,
      createObjectStore: () => {},
      close: () => {
        this.abiertas.delete(conexion);
      },
      // La transacción se confirma (oncomplete) en cuanto ha contestado su escritura.
      transaction: () => {
        const transaccion = {
          /** @type {(() => void) | null} */ oncomplete: null,
          /** @type {(() => void) | null} */ onabort: null,
          objectStore: () => ({
            /** @param {string} clave */
            get: (clave) => this.pedir(() => this.valores.get(clave)),
            /** @param {unknown} valor @param {string} clave */
            put: (valor, clave) =>
              this.pedir(() => {
                this.valores.set(clave, valor);
                setTimeout(() => transaccion.oncomplete?.(), 0);
              }),
          }),
        };
        return transaccion;
      },
    };
    return conexion;
  }
  /** @param {() => unknown} operacion */
  pedir(operacion) {
    const peticion = new Solicitud(() => {
      peticion.result = operacion();
      peticion.onsuccess();
    });
    return peticion;
  }
  deleteDatabase() {
    const peticion = new Solicitud(() => {
      for (const conexion of this.abiertas) {
        conexion.onversionchange?.();
      }
      if (this.abiertas.size) {
        peticion.onblocked();
        return;
      }
      this.valores.clear();
      this.creada = false;
      peticion.onsuccess();
    });
    return peticion;
  }
}

/** @param {CryptoKey} clave */
async function firmaCon(clave) {
  return Buffer.from(await crypto.subtle.sign('HMAC', clave, new TextEncoder().encode('prueba'))).toString('hex');
}

test('la clave persiste sin extraerse, el secreto de texto se convierte y borrar cierra sus conexiones', async () => {
  const anterior = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  const base = new IndexedDbDePrueba();
  Reflect.set(globalThis, 'indexedDB', base);
  try {
    const una = await secretoDeFirma();
    const otra = await secretoDeFirma();
    assert.ok(una instanceof CryptoKey && otra instanceof CryptoKey);
    assert.equal(una.extractable, false);
    assert.equal(await firmaCon(una), await firmaCon(otra));
    await assert.rejects(crypto.subtle.exportKey('raw', una), DOMException);
    assert.equal(base.abiertas.size, 0);
    const textoAntiguo = 'ab'.repeat(BYTES_DEL_SECRETO_ANTIGUO);
    base.valores.set('secreto-firma', textoAntiguo);
    const convertida = await secretoDeFirma();
    assert.ok(convertida instanceof CryptoKey);
    assert.equal(convertida.extractable, false);
    assert.equal(base.valores.get('secreto-firma'), convertida);
    await borrarSecretoDeFirma();
    const nueva = await secretoDeFirma();
    assert.ok(nueva instanceof CryptoKey);
    assert.notEqual(await firmaCon(nueva), await firmaCon(convertida));
    Reflect.set(globalThis, 'indexedDB', {
      open: () => {
        throw new DOMException('denegado', 'SecurityError');
      },
    });
    // No poder abrir la base no dice qué hay guardado: no se firma con una clave temporal.
    await assert.rejects(secretoDeFirma(), AlmacenConFallo);
  } finally {
    if (anterior) {
      Object.defineProperty(globalThis, 'indexedDB', anterior);
    } else {
      Reflect.deleteProperty(globalThis, 'indexedDB');
    }
  }
});

test('el borrado comunica un error de IndexedDB', async () => {
  const anterior = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Reflect.set(globalThis, 'indexedDB', {
    deleteDatabase() {
      const peticion = new Solicitud(() => peticion.onerror());
      return peticion;
    },
  });
  try {
    await assert.rejects(borrarSecretoDeFirma());
  } finally {
    if (anterior) {
      Object.defineProperty(globalThis, 'indexedDB', anterior);
    } else {
      Reflect.deleteProperty(globalThis, 'indexedDB');
    }
  }
});

test('el borrado bloqueado no se confirma al agotarse la espera', async (contexto) => {
  contexto.mock.timers.enable({ apis: ['setTimeout'] });
  const anterior = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Reflect.set(globalThis, 'indexedDB', {
    deleteDatabase() {
      const peticion = { onblocked: () => {} };
      queueMicrotask(() => peticion.onblocked());
      return peticion;
    },
  });
  try {
    const resultado = borrarSecretoDeFirma();
    const rechazado = assert.rejects(resultado);
    await Promise.resolve();
    contexto.mock.timers.runAll();
    await rechazado;
  } finally {
    if (anterior) {
      Object.defineProperty(globalThis, 'indexedDB', anterior);
    } else {
      Reflect.deleteProperty(globalThis, 'indexedDB');
    }
  }
});
