// IndexedDB en memoria para la clave de firma del motor (web/scripts/motor-local/secreto-firma.js), que puede contestar,
// negarse a guardar, abortar al confirmar o quedarse sin contestar. Modela las transacciones de un único almacén como
// IndexedDB:
// - una transacción de solo lectura empieza cuando han terminado las de lectura y escritura creadas antes; una de
//   lectura y escritura, cuando han terminado todas las creadas antes, de cualquier clase. Así, dos pestañas a la vez
//   acaban con la misma clave;
// - sus peticiones contestan de una en una y en orden, también las retenidas, que esperan su turno además de que la
//   prueba las suelte;
// - termina cuando ya no tiene peticiones, aunque no haya tenido ninguna, y nunca antes de empezar;
// - lo escrito solo queda guardado cuando se confirma (`oncomplete`);
// - si una petición falla, aborta: las peticiones que le quedaban fallan con AbortError y después llega `onabort`, sin
//   guardar nada. También aborta si la confirmación no cabe en la cuota.
// Una conexión recibe `onversionchange` cuando otra pestaña borra la base (borrarDesdeOtraPestana); cerrada, no deja crear
// transacciones (InvalidStateError). No modela `preventDefault` en los errores, el cierre de una transacción que espera
// a otra cosa, `onupgradeneeded` ni `onblocked`, ni que el borrado espere a que terminen las transacciones de las
// conexiones cerradas: secreto-firma.js no usa lo primero, prepara la clave antes de abrir la transacción, no depende
// del esquema más que para crear su almacén y cierra la conexión en cuanto recibe el aviso. La comparten las pruebas del
// secreto y del Worker del motor.
import type { TestContext } from 'node:test';

export type Modo =
  | 'contesta'
  | 'se-niega'
  | 'no-contesta'
  | 'nada-contesta'
  | 'no-abre'
  | 'lectura-falla'
  | 'confirmacion-falla';
type Peticion = { result?: unknown; error?: unknown; onsuccess?: () => void; onerror?: () => void };
/** Qué es cada petición: abrir la base, leer o escribir. */
type Clase = 'abrir' | 'leer' | 'escribir';
/** Una conexión con la base, como la que da `open`. */
type Conexion = {
  onversionchange: (() => void) | null;
  close: () => void;
  transaction: (almacen: string, modo?: string) => TransaccionDePrueba;
};
/** Una petición que espera contestar: retenida hasta que la prueba la suelta, o no. */
type EnCola = { peticion: Peticion; contestar: () => void; retenida: boolean; soltada: boolean };

/** Una transacción: sus peticiones en cola, lo que escribe (hasta confirmarse) y cómo termina. */
class TransaccionDePrueba {
  oncomplete: (() => void) | null = null;
  onabort: (() => void) | null = null;
  error: unknown = null;
  /** Si ya puede contestar: han terminado las transacciones a las que espera. */
  empezada = false;
  terminada = false;
  readonly cambios = new Map<string, unknown>();
  /** Se cumple cuando la transacción termina, confirmada o abortada. */
  readonly fin: Promise<void>;
  private readonly cola: EnCola[] = [];
  /** Si la primera de la cola ya va a contestar. */
  private contestando = false;
  private terminar: () => void = () => {};
  private readonly almacen: AlmacenDePrueba;
  constructor(almacen: AlmacenDePrueba, espera: Promise<unknown>) {
    this.almacen = almacen;
    this.fin = new Promise((listo) => {
      this.terminar = listo;
    });
    espera.then(() => {
      this.empezada = true;
      this.avanzar();
      this.revisar();
    });
  }

  objectStore() {
    const leer = (clave: string) =>
      this.cambios.has(clave) ? this.cambios.get(clave) : this.almacen.valores.get(clave);
    return {
      get: (clave: string) => this.almacen.pedir('leer', () => leer(clave), this),
      put: (valor: unknown, clave: string) => {
        this.almacen.escrituras += 1;
        return this.almacen.pedir('escribir', () => this.cambios.set(clave, valor), this);
      },
    };
  }

  encolar(enCola: EnCola) {
    this.cola.push(enCola);
    this.avanzar();
  }

  /**
   * Hace contestar a la primera petición de la cola, si la transacción ha empezado y esa petición no está retenida. La
   * que acaba de soltarse contesta en el acto, como en `soltar`; las demás, en una microtarea.
   */
  avanzar() {
    const primera = this.cola[0];
    if (!this.empezada || this.terminada || this.contestando || !primera || (primera.retenida && !primera.soltada)) {
      return;
    }
    this.contestando = true;
    const contestar = () => {
      this.contestando = false;
      if (this.terminada) {
        return;
      }
      this.cola.shift();
      primera.contestar();
      this.avanzar();
      this.revisar();
    };
    if (primera.retenida) {
      contestar();
    } else {
      queueMicrotask(contestar);
    }
  }

  /**
   * Sin peticiones en cola, la transacción termina después de que corra lo que esperaba su última respuesta (como en
   * un navegador, que la confirma cuando ya no se le pide nada más): se confirma o, si la cuota no deja confirmar lo
   * escrito, aborta.
   */
  revisar() {
    if (!this.empezada || this.terminada || this.cola.length > 0) {
      return;
    }
    setImmediate(() => {
      if (this.terminada || this.cola.length > 0) {
        return;
      }
      if (this.almacen.modo === 'confirmacion-falla' && this.cambios.size > 0) {
        this.abortar(new DOMException('cuota de prueba al confirmar', 'QuotaExceededError'));
        return;
      }
      this.terminada = true;
      this.terminar();
      for (const [clave, valor] of this.cambios) {
        this.almacen.valores.set(clave, valor);
      }
      this.almacen.confirmadas += 1;
      this.oncomplete?.();
    });
  }

  /**
   * Aborta por `error`, sin guardar nada: las peticiones que quedaban en la cola fallan con AbortError, y después llega
   * `onabort`, como en un navegador.
   */
  abortar(error: unknown) {
    if (this.terminada) {
      return;
    }
    this.terminada = true;
    const restantes = this.cola.splice(0);
    setImmediate(() => {
      for (const { peticion } of restantes) {
        peticion.error = new DOMException('transacción abortada', 'AbortError');
        peticion.onerror?.();
      }
      this.error = error;
      this.almacen.abortadas += 1;
      this.terminar();
      this.onabort?.();
    });
  }
}

/**
 * IndexedDB en memoria, según `modo`: todo contesta; las escrituras fallan (`se-niega`); las escrituras se quedan sin
 * contestar (`no-contesta`); no contesta nada, ni abrir la base (`nada-contesta`); la base no se abre, sin cambiar lo
 * guardado (`no-abre`); se abre y las lecturas fallan (`lectura-falla`); o las escrituras
 * contestan bien pero su transacción aborta al confirmar, por la cuota (`confirmacion-falla`). Si una petición se
 * retiene se decide al crearla; lo retenido contesta cuando la prueba lo suelta (soltar) y le llega el turno, como una
 * operación que el navegador termina tarde. `trasLaPrimeraLectura`, si se da, se ejecuta una vez tras la primera
 * lectura que contesta (otra pestaña que cambia lo guardado entre la lectura y la escritura). Cuenta aperturas,
 * escrituras, transacciones de lectura y escritura, y transacciones confirmadas y abortadas, de las dos clases.
 */
export class AlmacenDePrueba {
  valores = new Map<string, unknown>();
  modo: Modo = 'contesta';
  escrituras = 0;
  private readonly avisoDeEscritura = Promise.withResolvers<void>();
  readonly primeraEscritura = this.avisoDeEscritura.promise;
  aperturas = 0;
  abiertas = 0;
  /** Las transacciones de lectura y escritura creadas. */
  transaccionesDeEscritura = 0;
  confirmadas = 0;
  abortadas = 0;
  trasLaPrimeraLectura: (() => void) | null = null;
  private retenidas: { enCola: EnCola; transaccion: TransaccionDePrueba | undefined }[] = [];
  /** El fin de las transacciones que no han terminado: las de lectura y escritura, y todas. */
  private readonly finDeLasEscrituras: Promise<void>[] = [];
  private readonly finDeTodas: Promise<void>[] = [];
  /** Las conexiones abiertas y sin cerrar. */
  private readonly conexiones = new Set<Conexion>();

  soltar() {
    for (const { enCola, transaccion } of this.retenidas.splice(0)) {
      enCola.soltada = true;
      if (transaccion) {
        transaccion.avanzar();
      } else {
        enCola.contestar();
      }
    }
  }

  /** Si una petición de la `clase` falla en el modo actual. */
  private falla(clase: Clase) {
    return (
      (clase === 'escribir' && this.modo === 'se-niega') ||
      (clase === 'abrir' && this.modo === 'no-abre') ||
      (clase === 'leer' && this.modo === 'lectura-falla')
    );
  }

  pedir(clase: Clase, hacer: () => unknown, transaccion?: TransaccionDePrueba): Peticion {
    if (clase === 'escribir') {
      this.avisoDeEscritura.resolve();
    }
    const peticion: Peticion = {};
    const contestar = () => {
      if (this.falla(clase)) {
        peticion.error = new DOMException('denegado', 'QuotaExceededError');
        peticion.onerror?.();
        transaccion?.abortar(peticion.error);
        return;
      }
      peticion.result = hacer();
      peticion.onsuccess?.();
      if (clase === 'leer' && this.trasLaPrimeraLectura) {
        const cambiar = this.trasLaPrimeraLectura;
        this.trasLaPrimeraLectura = null;
        cambiar();
      }
    };
    const retenida = this.modo === 'nada-contesta' || (clase === 'escribir' && this.modo === 'no-contesta');
    const enCola: EnCola = { peticion, contestar, retenida, soltada: false };
    if (retenida) {
      this.retenidas.push({ enCola, transaccion });
    }
    if (transaccion) {
      transaccion.encolar(enCola);
    } else if (!retenida) {
      queueMicrotask(contestar);
    }
    return peticion;
  }

  /** Una transacción nueva, que espera a las que no han terminado según su `modo`, como en IndexedDB. */
  private nuevaTransaccion(modo: string) {
    const escribe = modo === 'readwrite';
    const espera = Promise.all(escribe ? this.finDeTodas : this.finDeLasEscrituras);
    const transaccion = new TransaccionDePrueba(this, espera);
    const quitar = (lista: Promise<void>[]) => lista.splice(lista.indexOf(transaccion.fin), 1);
    this.finDeTodas.push(transaccion.fin);
    if (escribe) {
      this.transaccionesDeEscritura += 1;
      this.finDeLasEscrituras.push(transaccion.fin);
    }
    transaccion.fin.then(() => {
      quitar(this.finDeTodas);
      if (escribe) {
        quitar(this.finDeLasEscrituras);
      }
    });
    return transaccion;
  }

  /**
   * Otra pestaña borra la base («Borrar todo»): avisa a las conexiones abiertas (`onversionchange`) y, después, borra lo
   * guardado.
   */
  borrarDesdeOtraPestana() {
    for (const conexion of [...this.conexiones]) {
      conexion.onversionchange?.();
    }
    this.valores.clear();
  }

  open() {
    this.aperturas += 1;
    const conexion: Conexion = {
      onversionchange: null,
      close: () => {
        if (this.conexiones.delete(conexion)) {
          this.abiertas -= 1;
        }
      },
      transaction: (_almacen: string, modo = 'readonly') => {
        if (!this.conexiones.has(conexion)) {
          throw new DOMException('la conexión está cerrada', 'InvalidStateError');
        }
        return this.nuevaTransaccion(modo);
      },
    };
    return this.pedir('abrir', () => {
      this.abiertas += 1;
      this.conexiones.add(conexion);
      return conexion;
    });
  }
}

/** Pone `almacen` como el indexedDB global mientras dura la prueba. */
export function usarAlmacen(t: TestContext, almacen: AlmacenDePrueba) {
  const anterior = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: almacen });
  t.after(() => {
    if (anterior) {
      Object.defineProperty(globalThis, 'indexedDB', anterior);
    } else {
      Reflect.deleteProperty(globalThis, 'indexedDB');
    }
  });
}
