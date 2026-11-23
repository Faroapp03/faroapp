// La clave de firma del dispositivo (web/scripts/motor-local/secreto-firma.js) cuando no se puede abrir su base, con el
// firmador real (src/seguridad/firma.ts) y el almacén doble. No poder abrir la base no demuestra que esté vacía: con una
// clave ya guardada, firmar con otra rompería lo firmado antes y lo firmado durante el fallo. Así que el fallo de
// apertura, asíncrono o síncrono, y la falta de IndexedDB son un estado desconocido: AlmacenConFallo, sin clave temporal;
// y al volver el acceso se lee la misma clave, que verifica lo firmado antes. Cada Worker nuevo carga su propia copia
// del módulo.
import assert from 'node:assert/strict';
import { type TestContext, test } from 'node:test';
import { crearFirmador } from '../../src/seguridad/firma.ts';
import { AlmacenDePrueba, usarAlmacen } from './almacen-de-prueba.ts';

type ModuloDelSecreto = typeof import('../../web/scripts/motor-local/secreto-firma.js');

const DATOS = { grupo: '5131', estimacion: 0.42 };
const SECRETO = new URL('../../web/scripts/motor-local/secreto-firma.js', import.meta.url).href;
/** Los intentos seguidos del mismo Worker con la base sin abrirse. */
const INTENTOS_FALLIDOS = 2;

let workers = 0;
/** El módulo tal como lo carga un Worker nuevo: una instancia propia, sin nada en memoria del anterior. */
async function moduloDeUnWorkerNuevo(): Promise<ModuloDelSecreto> {
  workers += 1;
  return (await import(`${SECRETO}?apertura=${workers}`)) as ModuloDelSecreto;
}

/** Lo que rechaza `promesa`; falla la prueba si se cumple. */
async function rechazoDe(promesa: Promise<unknown>): Promise<unknown> {
  try {
    const valor = await promesa;
    assert.fail(`se esperaba un rechazo y ha devuelto ${String(valor)}`);
  } catch (error) {
    return error;
  }
}

/** Un almacén con una clave ya guardada y una firma hecha con ella. */
async function conUnaClaveGuardada(t: TestContext) {
  const almacen = new AlmacenDePrueba();
  usarAlmacen(t, almacen);
  const clave = await (await moduloDeUnWorkerNuevo()).secretoDeFirma();
  assert.ok(clave instanceof CryptoKey);
  const firma = await (await crearFirmador(clave)).firmar(DATOS);
  return { almacen, clave, firma };
}

/** Comprueba que el fallo de apertura es AlmacenConFallo, con su causa, y que no deja nada a medias. */
function esFalloDeApertura(error: unknown, modulo: ModuloDelSecreto, almacen: AlmacenDePrueba, clave: CryptoKey) {
  assert.ok(error instanceof modulo.AlmacenConFallo, 'AlmacenConFallo, no una clave temporal');
  assert.equal(error.name, 'AlmacenConFallo');
  assert.ok(error.cause !== undefined, 'con la causa del fallo');
  assert.equal(almacen.valores.get('secreto-firma'), clave, 'la clave guardada sigue intacta');
  assert.equal(almacen.escrituras, 1, 'no se ha intentado guardar otra');
  assert.equal(almacen.abiertas, 0);
}

/** Al volver el acceso, un Worker nuevo lee la misma clave, que verifica lo firmado antes; sin escribir otra. */
async function seRecuperaLaMisma(almacen: AlmacenDePrueba, clave: CryptoKey, firma: string) {
  const recuperada = await (await moduloDeUnWorkerNuevo()).secretoDeFirma();
  assert.equal(recuperada, clave, 'la misma clave guardada');
  assert.ok(recuperada instanceof CryptoKey);
  assert.equal(await (await crearFirmador(recuperada)).comprobar(DATOS, firma), true, 'la firma anterior verifica');
  assert.equal(almacen.escrituras, 1, 'una sola escritura en todo el recorrido');
  assert.equal(almacen.abiertas, 0);
}

test('contraprueba: con una clave guardada, si la base no se abre (rechazo asíncrono), AlmacenConFallo y al volver la misma clave', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { almacen, clave, firma } = await conUnaClaveGuardada(t);
  almacen.modo = 'no-abre';
  const modulo = await moduloDeUnWorkerNuevo();
  esFalloDeApertura(await rechazoDe(modulo.secretoDeFirma()), modulo, almacen, clave);
  almacen.modo = 'contesta';
  await seRecuperaLaMisma(almacen, clave, firma);
});

test('con una clave guardada, si abrir la base lanza una excepción en el acto, AlmacenConFallo y al volver la misma clave', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { almacen, clave, firma } = await conUnaClaveGuardada(t);
  const abrir = almacen.open;
  almacen.open = () => {
    throw new DOMException('versión inferior a la guardada', 'VersionError');
  };
  const modulo = await moduloDeUnWorkerNuevo();
  const error = await rechazoDe(modulo.secretoDeFirma());
  esFalloDeApertura(error, modulo, almacen, clave);
  assert.ok(error instanceof Error && error.cause instanceof DOMException && error.cause.name === 'VersionError');
  almacen.open = abrir;
  await seRecuperaLaMisma(almacen, clave, firma);
});

test('con una clave guardada, si el Worker no tiene IndexedDB, AlmacenConFallo y al volver la misma clave', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { almacen, clave, firma } = await conUnaClaveGuardada(t);
  Reflect.deleteProperty(globalThis, 'indexedDB');
  const modulo = await moduloDeUnWorkerNuevo();
  esFalloDeApertura(await rechazoDe(modulo.secretoDeFirma()), modulo, almacen, clave);
  usarAlmacen(t, almacen);
  await seRecuperaLaMisma(almacen, clave, firma);
});

test('tras un fallo de apertura, el mismo Worker vuelve a abrir la base en el intento siguiente', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { almacen, clave, firma } = await conUnaClaveGuardada(t);
  almacen.modo = 'no-abre';
  const modulo = await moduloDeUnWorkerNuevo();
  const aperturas = almacen.aperturas;
  for (let intento = 0; intento < INTENTOS_FALLIDOS; intento += 1) {
    await assert.rejects(modulo.secretoDeFirma(), modulo.AlmacenConFallo);
  }
  assert.equal(almacen.aperturas - aperturas, INTENTOS_FALLIDOS, 'cada intento abre de nuevo: no queda retenido');
  almacen.modo = 'contesta';
  assert.equal(await modulo.secretoDeFirma(), clave, 'el mismo Worker recupera la clave guardada');
  assert.equal(almacen.aperturas - aperturas, INTENTOS_FALLIDOS + 1);
  await seRecuperaLaMisma(almacen, clave, firma);
});
