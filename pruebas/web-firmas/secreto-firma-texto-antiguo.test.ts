// El secreto antiguo guardado como texto (web/scripts/motor-local/secreto-firma.js, claveDelTexto), con el firmador real
// (src/seguridad/firma.ts): lo que este firmador firma con el texto se comprueba con la clave en que se convierte, con
// el mismo kid, tanto si se guarda la conversión como si el navegador no la deja guardar y el texto sigue guardado. Las
// firmas de un firmador anterior, con otro formato, no se prueban: no verifican con ninguna conversión. Un texto que no
// es un secreto válido (menos de 32 bytes UTF-8) no firmaba nada: cuenta como una base vacía.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crearFirmador, subclaveDe } from '../../src/seguridad/firma.ts';
import { AlmacenDePrueba, type Modo, usarAlmacen } from './almacen-de-prueba.ts';

type ModuloDelSecreto = typeof import('../../web/scripts/motor-local/secreto-firma.js');

const DATOS = { grupo: '5131', estimacion: 0.42 };
const SECRETO = new URL('../../web/scripts/motor-local/secreto-firma.js', import.meta.url).href;
/** Los bytes del secreto antiguo, guardado como 64 cifras hexadecimales. */
const BYTES_DEL_SECRETO_ANTIGUO = 32;
/** Secretos en texto ficticios: el de 64 cifras hexadecimales y otro con caracteres de más de un byte. */
const TEXTOS = ['ab'.repeat(BYTES_DEL_SECRETO_ANTIGUO), 'ñ'.repeat(BYTES_DEL_SECRETO_ANTIGUO / 2)];
/** Un texto de menos de 32 bytes UTF-8, con el que firma.ts no firmaba. */
const TEXTO_CORTO = 'ab'.repeat(BYTES_DEL_SECRETO_ANTIGUO / 2 - 1);
/** Los modos en que se convierte el texto: guardando la conversión, o sin poder guardarla al escribir o al confirmar. */
const MODOS: readonly Modo[] = ['contesta', 'se-niega', 'confirmacion-falla'];

let workers = 0;
/** El módulo tal como lo carga un Worker nuevo: una instancia propia, sin nada en memoria del anterior. */
async function moduloDeUnWorkerNuevo(): Promise<ModuloDelSecreto> {
  workers += 1;
  return (await import(`${SECRETO}?texto=${workers}`)) as ModuloDelSecreto;
}

/** El kid de una firma «kid.caducidad.hmac». */
const kidDe = (firma: string) => firma.split('.')[0];

test('lo que firma.ts firma con el secreto antiguo en texto se comprueba con la clave convertida, con el mismo kid', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const texto of TEXTOS) {
    for (const modo of MODOS) {
      const caso = `${modo}, ${texto.length} caracteres`;
      const almacen = new AlmacenDePrueba();
      almacen.valores.set('secreto-firma', texto);
      almacen.modo = modo;
      usarAlmacen(t, almacen);
      const firma = await (await crearFirmador(texto)).firmar(DATOS);
      const convertida = await (await moduloDeUnWorkerNuevo()).secretoDeFirma();
      assert.ok(convertida instanceof CryptoKey, `${caso}: una clave, no una temporal`);
      assert.equal(convertida.extractable, false, `${caso}: no se puede extraer`);
      const posterior = await crearFirmador(convertida);
      assert.equal(await posterior.comprobar(DATOS, firma), true, `${caso}: la firma con el texto verifica`);
      assert.equal(kidDe(await posterior.firmar(DATOS)), kidDe(firma), `${caso}: el mismo kid`);
      assert.equal((await subclaveDe(convertida, 'estimaciones')).kid, (await subclaveDe(texto, 'estimaciones')).kid);
      // Los tokens de socios también derivan la misma subclave: la conversión no depende del uso.
      const token = await (await crearFirmador(texto, undefined, undefined, { uso: 'tokens-de-socios' })).firmar(DATOS);
      const conLaClave = await crearFirmador(convertida, undefined, undefined, { uso: 'tokens-de-socios' });
      assert.equal(await conLaClave.comprobar(DATOS, token), true, `${caso}: también con otro uso`);
      // Un Worker nuevo vuelve a dar una clave que comprueba esa firma con el texto, guardada o convertida otra vez.
      almacen.modo = 'contesta';
      const otra = await (await moduloDeUnWorkerNuevo()).secretoDeFirma();
      assert.ok(otra instanceof CryptoKey);
      assert.equal(
        await (await crearFirmador(otra)).comprobar(DATOS, firma),
        true,
        `${caso}: tras reiniciar el Worker`,
      );
      assert.ok(almacen.valores.get('secreto-firma') instanceof CryptoKey, `${caso}: al final queda la clave guardada`);
    }
  }
});

test('un texto guardado de menos de 32 bytes no firmaba nada: se sustituye por una clave nueva, o undefined si no deja', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await assert.rejects(crearFirmador(TEXTO_CORTO), /al menos 32 bytes/, 'firma.ts no firma con él');
  const guardable = new AlmacenDePrueba();
  guardable.valores.set('secreto-firma', TEXTO_CORTO);
  usarAlmacen(t, guardable);
  const nueva = await (await moduloDeUnWorkerNuevo()).secretoDeFirma();
  assert.ok(nueva instanceof CryptoKey);
  assert.equal(guardable.valores.get('secreto-firma'), nueva, 'la clave nueva sustituye al texto');
  for (const modo of ['se-niega', 'confirmacion-falla'] as const) {
    const almacen = new AlmacenDePrueba();
    almacen.valores.set('secreto-firma', TEXTO_CORTO);
    almacen.modo = modo;
    usarAlmacen(t, almacen);
    assert.equal(await (await moduloDeUnWorkerNuevo()).secretoDeFirma(), undefined, `${modo}: como una base vacía`);
    assert.equal(almacen.valores.get('secreto-firma'), TEXTO_CORTO, `${modo}: no se ha sustituido nada`);
  }
});
