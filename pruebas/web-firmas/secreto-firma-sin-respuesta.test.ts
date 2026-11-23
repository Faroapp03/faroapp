// La clave de firma del dispositivo (web/scripts/motor-local/secreto-firma.js) cuando el almacenamiento contesta, se
// niega, no contesta o no deja abrir la base, con temporizadores falsos (la apertura, con una clave ya guardada, en
// secreto-firma-apertura.test.ts). Cada Worker nuevo carga su propia copia del módulo: así se prueba que
// lo firmado antes de reiniciar el Worker se sigue verificando después con la clave guardada, y que ninguna espera sin
// respuesta pasa a firmar con una clave temporal.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crearFirmador } from '../../src/seguridad/firma.ts';
import { AlmacenDePrueba, usarAlmacen } from './almacen-de-prueba.ts';

type ModuloDelSecreto = typeof import('../../web/scripts/motor-local/secreto-firma.js');

/** Lo que espera secreto-firma.js a que el almacenamiento conteste (ESPERA_DEL_ALMACEN_MS). */
const ESPERA_DEL_ALMACEN_MS = 15_000;
const CASI = 1;
const DATOS = { grupo: '5131', estimacion: 0.42 };
/** Los bytes del secreto antiguo, guardado como 64 cifras hexadecimales. */
const BYTES_DEL_SECRETO_ANTIGUO = 32;
/** Un valor guardado que no es una clave ni un secreto en texto. */
const VALOR_DESCONOCIDO = 42;
const SECRETO = new URL('../../web/scripts/motor-local/secreto-firma.js', import.meta.url).href;

let workers = 0;
/** El módulo tal como lo carga un Worker nuevo: una instancia propia, sin nada en memoria del anterior. */
async function moduloDeUnWorkerNuevo(): Promise<ModuloDelSecreto> {
  workers += 1;
  return (await import(`${SECRETO}?worker=${workers}`)) as ModuloDelSecreto;
}

/** Cómo ha acabado una promesa, sin esperarla. */
function seguir<T>(promesa: Promise<T>) {
  const estado: { como: 'pendiente' | 'cumplida' | 'rechazada'; valor?: T; motivo?: unknown } = { como: 'pendiente' };
  promesa.then(
    (valor) => Object.assign(estado, { como: 'cumplida', valor }),
    (motivo: unknown) => Object.assign(estado, { como: 'rechazada', motivo }),
  );
  return estado;
}

/** Deja correr lo pendiente que no depende de los temporizadores. */
const vuelta = () => new Promise((listo) => setImmediate(listo));

test('éxito: la clave guardada no se extrae y verifica tras reiniciar el Worker lo firmado antes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const almacen = new AlmacenDePrueba();
  usarAlmacen(t, almacen);
  const antes = await (await moduloDeUnWorkerNuevo()).secretoDeFirma();
  assert.ok(antes instanceof CryptoKey);
  assert.equal(antes.extractable, false);
  const firma = await (await crearFirmador(antes)).firmar(DATOS);
  const despues = await (await moduloDeUnWorkerNuevo()).secretoDeFirma();
  assert.ok(despues instanceof CryptoKey);
  assert.equal(await (await crearFirmador(despues)).comprobar(DATOS, firma), true);
  assert.equal(almacen.escrituras, 1, 'el segundo Worker lee la clave; no crea otra');
  assert.equal(almacen.abiertas, 0, 'cada lectura cierra su conexión');
});

test('base que no se abre: no se sabe qué hay guardado, así que AlmacenConFallo en el acto, sin clave temporal', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const almacen = new AlmacenDePrueba();
  almacen.modo = 'no-abre';
  usarAlmacen(t, almacen);
  const modulo = await moduloDeUnWorkerNuevo();
  await assert.rejects(modulo.secretoDeFirma(), modulo.AlmacenConFallo);
  assert.equal(almacen.escrituras, 0);
  assert.equal(almacen.abiertas, 0);
});

test('rechazo con la base vacía: si no deja guardar la primera clave, undefined, porque no hay ninguna guardada', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const almacen = new AlmacenDePrueba();
  almacen.modo = 'se-niega';
  usarAlmacen(t, almacen);
  assert.equal(await (await moduloDeUnWorkerNuevo()).secretoDeFirma(), undefined);
  assert.equal(almacen.abiertas, 0);
});

test('fallo tras abrir la base: con una clave guardada que no se puede leer, AlmacenConFallo y no una clave temporal', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const almacen = new AlmacenDePrueba();
  usarAlmacen(t, almacen);
  const guardada = await (await moduloDeUnWorkerNuevo()).secretoDeFirma();
  assert.ok(guardada instanceof CryptoKey);
  almacen.modo = 'lectura-falla';
  const modulo = await moduloDeUnWorkerNuevo();
  await assert.rejects(modulo.secretoDeFirma(), modulo.AlmacenConFallo);
  assert.equal(almacen.abiertas, 0, 'la conexión se cierra también al fallar');
  // Cuando la lectura vuelve a funcionar, la clave es la misma.
  almacen.modo = 'contesta';
  const releida = await (await moduloDeUnWorkerNuevo()).secretoDeFirma();
  assert.ok(releida instanceof CryptoKey);
  const firma = await (await crearFirmador(guardada)).firmar(DATOS);
  assert.equal(await (await crearFirmador(releida)).comprobar(DATOS, firma), true);
});

test('secreto antiguo en texto que no se puede convertir: vale la clave de ese texto, que sigue guardado', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const texto = 'ab'.repeat(BYTES_DEL_SECRETO_ANTIGUO);
  for (const modo of ['se-niega', 'confirmacion-falla'] as const) {
    const almacen = new AlmacenDePrueba();
    almacen.valores.set('secreto-firma', texto);
    almacen.modo = modo;
    usarAlmacen(t, almacen);
    const clave = await (await moduloDeUnWorkerNuevo()).secretoDeFirma();
    assert.ok(clave instanceof CryptoKey, `${modo}: la clave del mismo texto, no un fallo ni una temporal`);
    assert.equal(clave.extractable, false);
    await vuelta();
    assert.equal(almacen.valores.get('secreto-firma'), texto, `${modo}: el secreto antiguo sigue guardado`);
    assert.equal(almacen.abortadas, 1, `${modo}: la transacción de escritura ha abortado`);
    // La clave sale del mismo texto en cada arranque: lo firmado con ella se comprueba tras reiniciar el Worker.
    const firma = await (await crearFirmador(clave)).firmar(DATOS);
    const otra = await (await moduloDeUnWorkerNuevo()).secretoDeFirma();
    assert.ok(otra instanceof CryptoKey);
    assert.equal(await (await crearFirmador(otra)).comprobar(DATOS, firma), true, `${modo}: continuidad entre Workers`);
  }
});

test('la clave nueva solo vale con su transacción confirmada; si aborta al confirmar con la base vacía, undefined', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const almacen = new AlmacenDePrueba();
  almacen.modo = 'confirmacion-falla';
  usarAlmacen(t, almacen);
  assert.equal(await (await moduloDeUnWorkerNuevo()).secretoDeFirma(), undefined, 'no se usa una clave no guardada');
  assert.equal(almacen.valores.has('secreto-firma'), false);
  assert.equal(almacen.abortadas, 1);
  almacen.modo = 'contesta';
  const clave = await (await moduloDeUnWorkerNuevo()).secretoDeFirma();
  assert.ok(clave instanceof CryptoKey);
  assert.equal(almacen.valores.get('secreto-firma'), clave, 'confirmada, queda guardada');
});

test('un valor guardado que no es una clave ni un texto, con una confirmación que fallaría: AlmacenConFallo sin escribir', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const almacen = new AlmacenDePrueba();
  almacen.valores.set('secreto-firma', VALOR_DESCONOCIDO);
  almacen.modo = 'confirmacion-falla';
  usarAlmacen(t, almacen);
  const modulo = await moduloDeUnWorkerNuevo();
  await assert.rejects(modulo.secretoDeFirma(), modulo.AlmacenConFallo);
  assert.equal(almacen.valores.get('secreto-firma'), VALOR_DESCONOCIDO, 'no se ha sustituido nada');
  assert.equal(almacen.escrituras, 0, 'no se llega a escribir ni a confirmar');
});

test('otro texto guardado entre la lectura y la escritura, distinto del leído: AlmacenConFallo, sin sustituirlo', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const almacen = new AlmacenDePrueba();
  const leido = 'ab'.repeat(BYTES_DEL_SECRETO_ANTIGUO);
  const otro = 'cd'.repeat(BYTES_DEL_SECRETO_ANTIGUO);
  almacen.valores.set('secreto-firma', leido);
  almacen.modo = 'se-niega';
  almacen.trasLaPrimeraLectura = () => almacen.valores.set('secreto-firma', otro);
  usarAlmacen(t, almacen);
  const modulo = await moduloDeUnWorkerNuevo();
  await assert.rejects(modulo.secretoDeFirma(), modulo.AlmacenConFallo);
  assert.equal(almacen.valores.get('secreto-firma'), otro, 'lo guardado por la otra pestaña sigue');
});

test('un valor guardado que no es una clave ni un texto: AlmacenConFallo en cada intento, hasta «Borrar todo»', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const almacen = new AlmacenDePrueba();
  almacen.valores.set('secreto-firma', VALOR_DESCONOCIDO);
  usarAlmacen(t, almacen);
  const modulo = await moduloDeUnWorkerNuevo();
  await assert.rejects(modulo.secretoDeFirma(), modulo.AlmacenConFallo);
  assert.equal(almacen.valores.get('secreto-firma'), VALOR_DESCONOCIDO, 'no se ha sustituido nada');
  assert.equal(almacen.escrituras, 0);
  assert.equal(almacen.abiertas, 0);
  await assert.rejects(modulo.secretoDeFirma(), modulo.AlmacenConFallo, 'el intento siguiente vuelve a fallar');
  assert.equal(almacen.valores.get('secreto-firma'), VALOR_DESCONOCIDO, 'y lo guardado sigue');
  almacen.borrarDesdeOtraPestana();
  const nueva = await modulo.secretoDeFirma();
  assert.ok(nueva instanceof CryptoKey, 'tras «Borrar todo», una clave nueva');
  assert.equal(almacen.valores.get('secreto-firma'), nueva);
});

test('base vacía al leer y un texto guardado antes de escribir: AlmacenConFallo, y después su clave', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const almacen = new AlmacenDePrueba();
  const texto = 'cd'.repeat(BYTES_DEL_SECRETO_ANTIGUO);
  almacen.trasLaPrimeraLectura = () => almacen.valores.set('secreto-firma', texto);
  usarAlmacen(t, almacen);
  const modulo = await moduloDeUnWorkerNuevo();
  await assert.rejects(modulo.secretoDeFirma(), modulo.AlmacenConFallo);
  assert.equal(almacen.valores.get('secreto-firma'), texto, 'lo guardado por la otra pestaña sigue');
  assert.equal(almacen.escrituras, 0);
  // El intento siguiente lee el texto y lo convierte en su clave, equivalente al texto para el firmador actual.
  const firma = await (await crearFirmador(texto)).firmar(DATOS);
  const clave = await modulo.secretoDeFirma();
  assert.ok(clave instanceof CryptoKey);
  assert.equal(await (await crearFirmador(clave)).comprobar(DATOS, firma), true);
});

test('texto leído, pero la base vacía al escribir: AlmacenConFallo sin guardar nada, y después una clave nueva', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const modo of ['contesta', 'se-niega'] as const) {
    const almacen = new AlmacenDePrueba();
    const texto = 'ab'.repeat(BYTES_DEL_SECRETO_ANTIGUO);
    almacen.valores.set('secreto-firma', texto);
    almacen.modo = modo;
    almacen.trasLaPrimeraLectura = () => almacen.valores.delete('secreto-firma');
    usarAlmacen(t, almacen);
    const modulo = await moduloDeUnWorkerNuevo();
    await assert.rejects(
      modulo.secretoDeFirma(),
      modulo.AlmacenConFallo,
      `${modo}: no se usa la clave del texto borrado`,
    );
    assert.equal(almacen.valores.has('secreto-firma'), false, `${modo}: no se guarda la clave del texto borrado`);
    almacen.modo = 'contesta';
    const nueva = await modulo.secretoDeFirma();
    assert.ok(nueva instanceof CryptoKey);
    assert.equal(almacen.valores.get('secreto-firma'), nueva, `${modo}: el intento siguiente guarda una clave nueva`);
    const firmaDelTexto = await (await crearFirmador(texto)).firmar(DATOS);
    assert.equal(
      await (await crearFirmador(nueva)).comprobar(DATOS, firmaDelTexto),
      false,
      `${modo}: no es la del texto`,
    );
  }
});

test('«Borrar todo» en otra pestaña entre la lectura y la escritura: AlmacenConFallo, y después una clave nueva', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const almacen = new AlmacenDePrueba();
  const texto = 'ab'.repeat(BYTES_DEL_SECRETO_ANTIGUO);
  almacen.valores.set('secreto-firma', texto);
  almacen.trasLaPrimeraLectura = () => almacen.borrarDesdeOtraPestana();
  usarAlmacen(t, almacen);
  const modulo = await moduloDeUnWorkerNuevo();
  const error = await modulo.secretoDeFirma().catch((rechazo: unknown) => rechazo);
  assert.ok(error instanceof modulo.AlmacenConFallo);
  assert.ok(
    error.cause instanceof DOMException && error.cause.name === 'InvalidStateError',
    'la conexión se ha soltado',
  );
  assert.equal(almacen.transaccionesDeEscritura, 0);
  assert.equal(almacen.escrituras, 0);
  assert.equal(almacen.abiertas, 0);
  const nueva = await modulo.secretoDeFirma();
  assert.ok(nueva instanceof CryptoKey);
  assert.equal(almacen.valores.get('secreto-firma'), nueva);
});

test('dos pestañas a la vez, con la base vacía, acaban con la misma clave guardada una sola vez', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const almacen = new AlmacenDePrueba();
  usarAlmacen(t, almacen);
  const pestanas = [await moduloDeUnWorkerNuevo(), await moduloDeUnWorkerNuevo()];
  // Las dos piden la clave en el mismo instante: ninguna ha guardado todavía la suya.
  const [una, otra] = await Promise.all(pestanas.map((pestana) => pestana.secretoDeFirma()));
  assert.ok(una instanceof CryptoKey && otra instanceof CryptoKey);
  const firma = await (await crearFirmador(una)).firmar(DATOS);
  assert.equal(await (await crearFirmador(otra)).comprobar(DATOS, firma), true, 'la misma clave');
  assert.equal(almacen.valores.get('secreto-firma'), una);
  // Las dos han leído la base vacía y han llegado a su transacción de escritura: sin la cola, las dos escribirían.
  assert.equal(almacen.transaccionesDeEscritura, pestanas.length, 'las dos llegan a la transacción de escritura');
  assert.equal(almacen.escrituras, 1, 'la segunda ve la clave de la primera y no escribe');
  // Una lectura y una transacción de escritura por pestaña, todas confirmadas: la de la segunda, que solo lee, se
  // confirma en la vuelta siguiente a su respuesta.
  await vuelta();
  assert.equal(almacen.confirmadas, 2 * pestanas.length);
  assert.equal(almacen.abortadas, 0);
});

test('almacenamiento que no contesta: la espera acaba a los 15 s con AlmacenSinRespuesta, sin clave temporal', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const almacen = new AlmacenDePrueba();
  almacen.modo = 'no-contesta';
  usarAlmacen(t, almacen);
  const modulo = await moduloDeUnWorkerNuevo();
  const espera = seguir(modulo.secretoDeFirma());
  await almacen.primeraEscritura;
  t.mock.timers.tick(ESPERA_DEL_ALMACEN_MS - CASI);
  await vuelta();
  assert.equal(espera.como, 'pendiente');
  t.mock.timers.tick(CASI);
  await vuelta();
  assert.equal(espera.como, 'rechazada', 'la espera termina: el motor no se queda sin salida');
  assert.ok(espera.motivo instanceof modulo.AlmacenSinRespuesta);
  assert.equal(almacen.escrituras, 1);
});

test('cancelación y recuperación: la escritura pendiente se comparte y, al contestar, su clave es la que vale', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const almacen = new AlmacenDePrueba();
  almacen.modo = 'no-contesta';
  usarAlmacen(t, almacen);
  const modulo = await moduloDeUnWorkerNuevo();
  const primera = seguir(modulo.secretoDeFirma());
  await almacen.primeraEscritura;
  t.mock.timers.tick(ESPERA_DEL_ALMACEN_MS);
  await vuelta();
  assert.equal(primera.como, 'rechazada', 'la primera espera se da por cancelada al vencer su plazo');
  // El reintento del mismo Worker espera la misma escritura: no genera ni intenta guardar otra clave.
  const segunda = seguir(modulo.secretoDeFirma());
  await vuelta();
  assert.equal(almacen.escrituras, 1);
  assert.equal(almacen.abiertas, 1, 'la conexión sigue abierta mientras la escritura no termina');
  almacen.modo = 'contesta';
  almacen.soltar();
  await vuelta();
  assert.equal(segunda.como, 'cumplida');
  const clave = segunda.valor;
  assert.ok(clave instanceof CryptoKey);
  assert.equal(almacen.valores.get('secreto-firma'), clave, 'se usa la clave que ha quedado guardada');
  assert.equal(almacen.abiertas, 0, 'al terminar, la conexión se cierra');
  // Continuidad: lo firmado con ella se verifica con la clave que lee un Worker nuevo.
  const firma = await (await crearFirmador(clave)).firmar(DATOS);
  const releida = await (await moduloDeUnWorkerNuevo()).secretoDeFirma();
  assert.ok(releida instanceof CryptoKey);
  assert.equal(await (await crearFirmador(releida)).comprobar(DATOS, firma), true);
  assert.equal(almacen.escrituras, 1);
});
