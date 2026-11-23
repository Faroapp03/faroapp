// El arranque de los navegadores de las pruebas (lanzarConPlazo, recursos-del-caso.mjs), con motores dobles, sin
// navegador: Playwright recibe el plazo común y, si vence, su error (con su registro de fases) es la causa del fallo; un
// arranque colgado falla en su plazo más el margen de respaldo diciendo qué motor y en qué prueba, termina el proceso
// que dejó y no deja temporizadores; uno que llega tarde se cierra; un fallo del arranque se conserva como causa; con
// los recursos del caso, el navegador se cierra en el after, se cierra también si no se pueden ver sus procesos, y un
// caso que vence mientras arranca dice en qué paso estaba; desde un finally, el cierre de un recurso del caso se espera
// con su plazo y su forzado. En un proceso aparte con dos casos, cuando el primero vence: su arranque colgado y su
// navegador que llega tarde terminan su proceso y no el del caso siguiente, también por `arrancar` (paquete-comun.mjs)
// y por el perfil de WebKit de `contextoConCache` (cache-fiel.mjs); y su cuerpo, que sigue tras el after, ya no puede
// abrir otro navegador. `arrancar` (paquete-comun.mjs), con y sin los recursos del caso, da el fallo de Playwright como
// causa; colgado, falla solo al pasar el plazo más el margen de respaldo y cierra el navegador que llega tarde. Tras la
// limpieza del caso, ni `conSusProcesos` ni `arrancarConPlazo` con sus recursos toman por suyos los procesos que aparecen.

import assert from 'node:assert/strict';
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mock, type TestContext, test } from 'node:test';
import { listarConPs } from '../../scripts/detener-arbol.ts';
import {
  abrirNavegador,
  arrancarConPlazo,
  cerrarSinSustituir,
  conSusProcesos,
  lanzarConPlazo,
  MARGEN_DE_RESPALDO_MS,
  PLAZO_DE_ARRANQUE_MS,
  recursosDelCaso,
} from '../navegadores/recursos-del-caso.mjs';

/** El plazo de arranque de los dobles: corto, para que la prueba no espere. */
const PLAZO_DEL_DOBLE_MS = 50;
/** El margen de respaldo de los dobles colgados: corto, por la misma razón. */
const MARGEN_DEL_DOBLE_MS = 20;
/** Lo que tarda en llegar el navegador doble tardío: después de su plazo y de su margen. */
const LLEGADA_TARDIA_MS = 150;
/** Lo más que puede tardar cada caso; un arranque sin plazo lo agotaría. */
const PLAZO_DEL_CASO_MS = 5000;
/** Lo que puede tardar el fallo de un arranque colgado más allá de su plazo. */
const MARGEN_MS = 1000;
/** El plazo de la verificación para un caso, que el de arranque no alcanza. */
const PLAZO_DE_UN_CASO_DE_LA_VERIFICACION_MS = 120_000;
/** El caso que vence a mitad de un arranque, en un proceso aparte: su plazo y el del arranque, mayor. */
const PLAZO_DEL_CASO_QUE_VENCE_MS = 300;
const PLAZO_DEL_ARRANQUE_QUE_NO_ACABA_MS = 1000;
/** El caso siguiente del proceso aparte: si falla, vence y su after termina sus `sleep` en vez de dejarlos 5 min. */
const PLAZO_DEL_CASO_SIGUIENTE_MS = 2000;
/** El cierre lento del caso que vence: dura más que el caso, así que su after lo espera hasta este plazo. */
const PLAZO_DEL_CIERRE_LENTO_MS = 400;
const MODULO_RECURSOS = new URL('../navegadores/recursos-del-caso.mjs', import.meta.url).href;
const MODULO_PAQUETE = new URL('../navegadores/paquete-comun.mjs', import.meta.url).href;
const MODULO_CACHE = new URL('../navegadores/cache-fiel.mjs', import.meta.url).href;

type Opciones = Record<string, unknown>;

interface Doble {
  name(): string;
  launch(opciones: Opciones): Promise<{ close: () => Promise<void> }>;
  recibidas: Opciones[];
  cierres: number;
}

/** Un motor doble cuyo `launch` hace lo que diga `arrancar` y anota sus opciones y los cierres del navegador. */
function motorDoble(
  arrancar: (navegador: { close: () => Promise<void> }, opciones: Opciones) => Promise<unknown>,
): Doble {
  const doble: Doble = {
    name: () => 'chromium',
    async launch(opciones) {
      doble.recibidas.push(opciones);
      const navegador = {
        close: async () => {
          doble.cierres++;
        },
      };
      await arrancar(navegador, opciones);
      return navegador;
    },
    recibidas: [],
    cierres: 0,
  };
  return doble;
}

/** Los temporizadores vivos de este proceso. */
const temporizadores = () => process.getActiveResourcesInfo().filter((recurso) => recurso === 'Timeout').length;

/** Los procesos hijos de este proceso, según `ps`. */
const hijos = () => [...listarConPs().values()].filter((proceso) => proceso.ppid === process.pid && !proceso.terminado);

test('el plazo común de arranque, con su margen de respaldo, es menor que el de un caso de la verificación', () => {
  assert.ok(PLAZO_DE_ARRANQUE_MS < PLAZO_DE_UN_CASO_DE_LA_VERIFICACION_MS);
  assert.ok(PLAZO_DE_ARRANQUE_MS + MARGEN_DE_RESPALDO_MS < PLAZO_DE_UN_CASO_DE_LA_VERIFICACION_MS);
});

test('un arranque colgado falla en su plazo con el motor y la prueba, termina su proceso y no deja temporizadores', {
  timeout: PLAZO_DEL_CASO_MS,
}, async (t) => {
  // Como un navegador de Playwright a medio arrancar: un proceso hijo en su propio grupo, y el arranque no vuelve.
  let navegador: ChildProcess | undefined;
  t.after(() => navegador?.kill('SIGKILL'));
  const colgado = motorDoble(async () => {
    navegador = spawn('sleep', ['300'], { detached: true, stdio: 'ignore' });
    await once(navegador, 'spawn');
    await new Promise(() => undefined);
  });
  const antes = temporizadores();
  const hijosAntes = hijos().length;
  await t.test('el caso que arranca', async (caso) => {
    const inicio = Date.now();
    await assert.rejects(
      lanzarConPlazo(colgado, { headless: true }, caso.name, {
        recursos: recursosDelCaso(caso),
        plazoMs: PLAZO_DEL_DOBLE_MS,
        margenMs: MARGEN_DEL_DOBLE_MS,
      }),
      {
        message:
          `el navegador chromium no llegó a arrancar en «el caso que arranca» (plazo de ${PLAZO_DEL_DOBLE_MS} ms; ` +
          `Playwright no respondió en ${MARGEN_DEL_DOBLE_MS} ms más)`,
      },
    );
    assert.ok(Date.now() - inicio < PLAZO_DEL_DOBLE_MS + MARGEN_DEL_DOBLE_MS + MARGEN_MS, 'falla en su plazo');
  });
  assert.deepEqual(colgado.recibidas, [{ headless: true, timeout: PLAZO_DEL_DOBLE_MS }], 'Playwright recibe el plazo');
  assert.ok(navegador);
  if (navegador.exitCode === null && navegador.signalCode === null) {
    await once(navegador, 'exit');
  }
  assert.equal(navegador.signalCode, 'SIGTERM', 'el proceso del arranque colgado se ha terminado');
  assert.equal(temporizadores(), antes, 'no queda ningún temporizador del plazo');
  assert.equal(hijos().length, hijosAntes, 'no queda ningún proceso');
});

test('si vence el plazo de Playwright, su error, con el registro de fases, es la causa del fallo', {
  timeout: PLAZO_DEL_CASO_MS,
}, async () => {
  let dePlaywright: Error | undefined;
  // Como Playwright: rechaza a los `timeout` ms que recibe, con el registro de llamadas en el mensaje.
  const lento = motorDoble(
    (_navegador, { timeout }) =>
      new Promise((_resolver, rechazar) => {
        setTimeout(() => {
          dePlaywright = Object.assign(
            new Error(`browserType.launch: Timeout ${timeout}ms exceeded.\nCall log:\n  - <launching> doble`),
            { name: 'TimeoutError' },
          );
          rechazar(dePlaywright);
        }, Number(timeout));
      }),
  );
  await assert.rejects(lanzarConPlazo(lento, {}, 'un ensayo', { plazoMs: PLAZO_DEL_DOBLE_MS }), (error: Error) => {
    assert.ok(dePlaywright);
    assert.equal(error.cause, dePlaywright);
    assert.equal(
      error.message,
      `el navegador chromium no llegó a arrancar en «un ensayo»: browserType.launch: Timeout ${PLAZO_DEL_DOBLE_MS}ms ` +
        'exceeded.\nCall log:\n  - <launching> doble',
    );
    return true;
  });
});

test('sin plazo propio, se usa el común, se conservan las demás opciones y no queda ningún temporizador', async () => {
  const listo = motorDoble(async () => undefined);
  const entorno = { HOME: '/hogar' };
  const antes = temporizadores();
  await lanzarConPlazo(listo, { headless: true, env: entorno }, 'un ensayo');
  assert.deepEqual(listo.recibidas, [{ headless: true, env: entorno, timeout: PLAZO_DE_ARRANQUE_MS }]);
  assert.equal(temporizadores(), antes, 'el plazo del respaldo se ha retirado');
});

test('un navegador que llega después del plazo se cierra en cuanto llega', { timeout: PLAZO_DEL_CASO_MS }, async () => {
  let llegado: () => void = () => undefined;
  const llegada = new Promise<void>((resolver) => {
    llegado = resolver;
  });
  const tardio = motorDoble(async () => {
    await new Promise((resolver) => setTimeout(resolver, LLEGADA_TARDIA_MS));
    llegado();
  });
  await assert.rejects(
    lanzarConPlazo(tardio, {}, 'un ensayo', { plazoMs: PLAZO_DEL_DOBLE_MS, margenMs: MARGEN_DEL_DOBLE_MS }),
    {
      message:
        `el navegador chromium no llegó a arrancar en «un ensayo» (plazo de ${PLAZO_DEL_DOBLE_MS} ms; ` +
        `Playwright no respondió en ${MARGEN_DEL_DOBLE_MS} ms más)`,
    },
  );
  assert.equal(tardio.cierres, 0);
  await llegada;
  await new Promise((resolver) => setImmediate(resolver));
  assert.equal(tardio.cierres, 1, 'el navegador tardío se ha cerrado');
});

test('si el arranque falla, se dice el motor y la prueba y se conserva el fallo original', async () => {
  const original = new Error('browserType.launch: Executable does not exist');
  const roto = motorDoble(() => Promise.reject(original));
  await assert.rejects(lanzarConPlazo(roto, {}, 'un ensayo', { plazoMs: PLAZO_DEL_DOBLE_MS }), (error: Error) => {
    assert.equal(
      error.message,
      'el navegador chromium no llegó a arrancar en «un ensayo»: browserType.launch: Executable does not exist',
    );
    assert.equal(error.cause, original);
    return true;
  });
});

test('con los recursos del caso, el navegador que arranca se cierra en el after del caso', {
  timeout: PLAZO_DEL_CASO_MS,
}, async (t) => {
  const listo = motorDoble(async () => undefined);
  await t.test('el caso que arranca', async (caso) => {
    const navegador = await lanzarConPlazo(listo, { headless: true }, caso.name, { recursos: recursosDelCaso(caso) });
    assert.ok(navegador);
    assert.equal(listo.cierres, 0, 'mientras dura el caso, sigue abierto');
  });
  assert.equal(listo.cierres, 1, 'el after del caso lo ha cerrado');
});

test('si después de arrancar no se pueden ver sus procesos, el navegador se cierra antes de fallar', {
  timeout: PLAZO_DEL_CASO_MS,
}, async (t) => {
  const listo = motorDoble(async () => undefined);
  const ruta = process.env.PATH;
  t.after(() => {
    process.env.PATH = ruta;
  });
  await t.test('el caso que arranca', async (caso) => {
    await assert.rejects(
      abrirNavegador(recursosDelCaso(caso), 'el navegador doble', async () => {
        const navegador = await listo.launch({});
        // Sin `ps` en el PATH, la segunda consulta de procesos falla.
        process.env.PATH = '/no-existe';
        return navegador;
      }),
      { message: /^no se pudieron ver los procesos de lo creado, así que se ha cerrado: ps no se puede ejecutar/u },
    );
    process.env.PATH = ruta;
  });
  assert.equal(listo.cierres, 1, 'el navegador se ha cerrado');
});

test('un caso que vence mientras un navegador arranca dice en qué paso estaba', { timeout: PLAZO_DEL_CASO_MS }, () => {
  const codigo = [
    "import { test } from 'node:test';",
    `import { lanzarConPlazo, recursosDelCaso } from ${JSON.stringify(MODULO_RECURSOS)};`,
    "const colgado = { name: () => 'chromium', launch: () => new Promise(() => undefined) };",
    `test('el caso que vence', { timeout: ${PLAZO_DEL_CASO_QUE_VENCE_MS} }, async (t) => {`,
    '  await lanzarConPlazo(colgado, {}, t.name, {',
    `    recursos: recursosDelCaso(t), plazoMs: ${PLAZO_DEL_ARRANQUE_QUE_NO_ACABA_MS}, margenMs: ${MARGEN_DEL_DOBLE_MS},`,
    '  });',
    '});',
  ].join('\n');
  const ejecucion = spawnSync(process.execPath, ['--input-type=module', '--eval', codigo], {
    encoding: 'utf8',
    timeout: PLAZO_DEL_CASO_MS - MARGEN_MS,
  });
  assert.equal(ejecucion.error, undefined);
  assert.match(ejecucion.stdout, /test timed out after 300ms/u, 'el caso vence');
  assert.match(
    ejecucion.stderr,
    /el caso «el caso que vence» venció o se canceló durante: arrancando el navegador chromium en «el caso que vence»/u,
    ejecucion.stderr,
  );
});

test('un caso que vence con un arranque colgado termina su proceso, pero no el del caso siguiente del archivo', {
  timeout: PLAZO_DEL_CASO_MS,
}, () => {
  // node:test pasa al caso siguiente aunque el cuerpo del vencido siga vivo: su respaldo vence durante el siguiente.
  const codigo = [
    "import assert from 'node:assert/strict';",
    "import { spawn } from 'node:child_process';",
    "import { once } from 'node:events';",
    "import { test } from 'node:test';",
    `import { lanzarConPlazo, recursosDelCaso } from ${JSON.stringify(MODULO_RECURSOS)};`,
    'let delColgado;',
    'let arranqueColgado;',
    "const colgado = { name: () => 'chromium', launch: async () => {",
    "  delColgado = spawn('sleep', ['300'], { detached: true, stdio: 'ignore' });",
    "  await once(delColgado, 'spawn');",
    '  return new Promise(() => undefined);',
    '} };',
    `test('el caso que vence', { timeout: ${PLAZO_DEL_CASO_QUE_VENCE_MS} }, (t) => {`,
    '  arranqueColgado = lanzarConPlazo(colgado, {}, t.name, {',
    `    recursos: recursosDelCaso(t), plazoMs: ${PLAZO_DEL_ARRANQUE_QUE_NO_ACABA_MS}, margenMs: ${MARGEN_DEL_DOBLE_MS},`,
    '  });',
    '  return arranqueColgado;',
    '});',
    `test('el caso siguiente', { timeout: ${PLAZO_DEL_CASO_SIGUIENTE_MS} }, async (t) => {`,
    "  const suyo = spawn('sleep', ['300'], { detached: true, stdio: 'ignore' });",
    "  t.after(() => { suyo.kill('SIGKILL'); delColgado?.kill('SIGKILL'); });",
    "  await once(suyo, 'spawn');",
    '  await arranqueColgado.catch(() => undefined);',
    "  if (delColgado.exitCode === null && delColgado.signalCode === null) await once(delColgado, 'exit');",
    "  assert.equal(delColgado.signalCode, 'SIGTERM', 'el proceso del arranque colgado se ha terminado');",
    `  await Promise.race([once(suyo, 'exit'), new Promise((resolver) => setTimeout(resolver, ${LLEGADA_TARDIA_MS}))]);`,
    "  assert.deepEqual([suyo.exitCode, suyo.signalCode], [null, null], 'el proceso del caso siguiente sigue vivo');",
    '});',
  ].join('\n');
  // Sin el contexto del ejecutor de este archivo, el proceso informa en TAP en vez de pasarle sus eventos.
  const { NODE_TEST_CONTEXT: _contexto, ...entorno } = process.env;
  const ejecucion = spawnSync(process.execPath, ['--test-reporter=tap', '--input-type=module', '--eval', codigo], {
    encoding: 'utf8',
    env: entorno,
    timeout: PLAZO_DEL_CASO_MS - MARGEN_MS,
  });
  assert.equal(ejecucion.error, undefined);
  assert.match(ejecucion.stdout, /^not ok 1 - el caso que vence$/mu, 'el primer caso vence');
  assert.match(ejecucion.stdout, /^ok 2 - el caso siguiente$/mu, ejecucion.stdout);
});

test('un navegador que llega tras vencer su caso y no se cierra no termina los procesos del caso siguiente', {
  timeout: PLAZO_DEL_CASO_MS,
}, () => {
  const codigo = [
    "import assert from 'node:assert/strict';",
    "import { spawn } from 'node:child_process';",
    "import { once } from 'node:events';",
    "import { test } from 'node:test';",
    `import { abrirNavegador, recursosDelCaso } from ${JSON.stringify(MODULO_RECURSOS)};`,
    'let delTardio;',
    'let llegada;',
    'let apertura;',
    `test('el caso que vence', { timeout: ${PLAZO_DEL_CASO_QUE_VENCE_MS} }, (t) => {`,
    `  const recursos = recursosDelCaso(t, { plazoDeCierreMs: ${PLAZO_DEL_DOBLE_MS} });`,
    '  apertura = abrirNavegador(recursos, "el navegador doble", async () => {',
    "    delTardio = spawn('sleep', ['300'], { detached: true, stdio: 'ignore' });",
    "    await once(delTardio, 'spawn');",
    '    await new Promise((resolver) => { llegada = resolver; });',
    '    return { close: () => new Promise(() => undefined) };',
    '  });',
    '  return apertura;',
    '});',
    `test('el caso siguiente', { timeout: ${PLAZO_DEL_CASO_SIGUIENTE_MS} }, async (t) => {`,
    "  const suyo = spawn('sleep', ['300'], { detached: true, stdio: 'ignore' });",
    "  t.after(() => { suyo.kill('SIGKILL'); delTardio?.kill('SIGKILL'); });",
    "  await once(suyo, 'spawn');",
    '  llegada();',
    '  await assert.rejects(apertura, { message: /se ha forzado su cierre/u });',
    "  if (delTardio.exitCode === null && delTardio.signalCode === null) await once(delTardio, 'exit');",
    "  assert.equal(delTardio.signalCode, 'SIGTERM', 'el proceso del navegador tardío se ha terminado');",
    `  await Promise.race([once(suyo, 'exit'), new Promise((resolver) => setTimeout(resolver, ${LLEGADA_TARDIA_MS}))]);`,
    "  assert.deepEqual([suyo.exitCode, suyo.signalCode], [null, null], 'el proceso del caso siguiente sigue vivo');",
    '});',
  ].join('\n');
  const { NODE_TEST_CONTEXT: _contexto, ...entorno } = process.env;
  const ejecucion = spawnSync(process.execPath, ['--test-reporter=tap', '--input-type=module', '--eval', codigo], {
    encoding: 'utf8',
    env: entorno,
    timeout: PLAZO_DEL_CASO_MS - MARGEN_MS,
  });
  assert.equal(ejecucion.error, undefined);
  assert.match(ejecucion.stdout, /^not ok 1 - el caso que vence$/mu, 'el primer caso vence');
  assert.match(ejecucion.stdout, /^ok 2 - el caso siguiente$/mu, ejecucion.stdout);
});

test('desde un finally, el cierre de un recurso del caso se espera con su plazo y su forzado, sin otro encima', {
  timeout: PLAZO_DEL_CASO_MS,
}, async (t) => {
  const avisos: string[] = [];
  mock.method(console, 'error', (texto: string) => {
    avisos.push(texto);
  });
  const codigoPrevio = process.exitCode;
  t.after(() => {
    mock.restoreAll();
    process.exitCode = codigoPrevio;
  });
  // Un caso propio, para llamar a su after aquí: el after vuelve a dar el fallo del cierre forzado.
  const despues: (() => unknown)[] = [];
  const caso = {
    name: 'el caso que cierra',
    signal: new AbortController().signal,
    after: (f: () => unknown) => despues.push(f),
  };
  const recursos = recursosDelCaso(caso as unknown as TestContext, { plazoDeCierreMs: PLAZO_DEL_DOBLE_MS });
  let forzado = false;
  const atascado = await recursos.abrir(
    'el navegador doble',
    () => ({}),
    () => new Promise(() => undefined),
    {
      forzar: async () => {
        await new Promise((resolver) => setTimeout(resolver, PLAZO_DEL_DOBLE_MS));
        forzado = true;
      },
    },
  );
  const forzadoDicho = `el navegador doble no se cerró (plazo de ${PLAZO_DEL_DOBLE_MS} ms); se ha forzado su cierre`;
  await cerrarSinSustituir(() => recursos.cerrar(atascado), 'el navegador doble no se cerró', PLAZO_DEL_DOBLE_MS);
  assert.equal(forzado, true, 'el forzado termina antes de seguir');
  assert.deepEqual(avisos, [forzadoDicho]);
  assert.equal(despues.length, 1);
  await assert.rejects(Promise.resolve().then(despues[0]), {
    message: `La limpieza del caso no se completó: ${forzadoDicho}`,
  });
});

/**
 * Dos casos en un proceso aparte, con los motores dobles de `dobles` sobre `tardio`: un navegador que lanza un `sleep`
 * en su grupo, llega cuando se le deja y no se cierra nunca. El primer caso vence mientras `abrir` (con los recursos del
 * caso, de plazo de cierre corto) espera ese navegador; el segundo lanza su propio `sleep`, deja llegar el navegador y
 * comprueba que su cierre vencido termina el proceso del primero y no el suyo. Devuelve la ejecución, con su TAP.
 */
function dosCasosConUnNavegadorTardio(importaciones: readonly string[], dobles: readonly string[], abrir: string) {
  const codigo = [
    "import assert from 'node:assert/strict';",
    "import { spawn } from 'node:child_process';",
    "import { once } from 'node:events';",
    "import { test } from 'node:test';",
    `import { recursosDelCaso } from ${JSON.stringify(MODULO_RECURSOS)};`,
    ...importaciones,
    'let delTardio;',
    'let llegada;',
    'let apertura;',
    'const tardio = async () => {',
    "  delTardio = spawn('sleep', ['300'], { detached: true, stdio: 'ignore' });",
    "  await once(delTardio, 'spawn');",
    '  await new Promise((resolver) => { llegada = resolver; });',
    '  return { close: () => new Promise(() => undefined) };',
    '};',
    ...dobles,
    `test('el caso que vence', { timeout: ${PLAZO_DEL_CASO_QUE_VENCE_MS} }, (t) => {`,
    `  const recursos = recursosDelCaso(t, { plazoDeCierreMs: ${PLAZO_DEL_DOBLE_MS} });`,
    `  apertura = ${abrir};`,
    '  return apertura;',
    '});',
    `test('el caso siguiente', { timeout: ${PLAZO_DEL_CASO_SIGUIENTE_MS} }, async (t) => {`,
    "  const suyo = spawn('sleep', ['300'], { detached: true, stdio: 'ignore' });",
    "  t.after(() => { suyo.kill('SIGKILL'); delTardio?.kill('SIGKILL'); });",
    "  await once(suyo, 'spawn');",
    '  llegada();',
    '  await assert.rejects(apertura, { message: /se ha forzado su cierre/u });',
    "  if (delTardio.exitCode === null && delTardio.signalCode === null) await once(delTardio, 'exit');",
    "  assert.equal(delTardio.signalCode, 'SIGTERM', 'el proceso del navegador tardío se ha terminado');",
    `  await Promise.race([once(suyo, 'exit'), new Promise((resolver) => setTimeout(resolver, ${LLEGADA_TARDIA_MS}))]);`,
    "  assert.deepEqual([suyo.exitCode, suyo.signalCode], [null, null], 'el proceso del caso siguiente sigue vivo');",
    '});',
  ].join('\n');
  const { NODE_TEST_CONTEXT: _contexto, ...entorno } = process.env;
  return spawnSync(process.execPath, ['--test-reporter=tap', '--input-type=module', '--eval', codigo], {
    encoding: 'utf8',
    env: entorno,
    timeout: PLAZO_DEL_CASO_MS - MARGEN_MS,
  });
}

test('el navegador de arrancar (paquete-comun.mjs) que llega tras vencer su caso no termina los procesos del siguiente', {
  timeout: PLAZO_DEL_CASO_MS,
}, () => {
  const ejecucion = dosCasosConUnNavegadorTardio(
    [`import { arrancar, MOTORES } from ${JSON.stringify(MODULO_PAQUETE)};`],
    ['MOTORES.chromium = { launch: tardio };'],
    "arrancar('chromium', { recursos })",
  );
  assert.equal(ejecucion.error, undefined);
  assert.match(ejecucion.stdout, /^not ok 1 - el caso que vence$/mu, 'el primer caso vence');
  assert.match(ejecucion.stdout, /^ok 2 - el caso siguiente$/mu, ejecucion.stdout);
  assert.match(
    ejecucion.stderr,
    /el navegador chromium llegó cuando el caso ya había terminado: .*se ha forzado su cierre/u,
  );
});

test('el WebKit de contextoConCache (cache-fiel.mjs) que llega tras vencer su caso no termina los procesos del siguiente', {
  timeout: PLAZO_DEL_CASO_MS,
}, () => {
  const ejecucion = dosCasosConUnNavegadorTardio(
    [
      `import { arrancar, MOTORES } from ${JSON.stringify(MODULO_PAQUETE)};`,
      `import { contextoConCache } from ${JSON.stringify(MODULO_CACHE)};`,
    ],
    ['MOTORES.webkit = { launch: async () => ({ close: async () => undefined }), launchPersistentContext: tardio };'],
    "arrancar('webkit', { recursos }).then((sesion) => contextoConCache(sesion, 'webkit', {}))",
  );
  assert.equal(ejecucion.error, undefined);
  assert.match(ejecucion.stdout, /^not ok 1 - el caso que vence$/mu, 'el primer caso vence');
  assert.match(ejecucion.stdout, /^ok 2 - el caso siguiente$/mu, ejecucion.stdout);
  assert.match(ejecucion.stderr, /el navegador webkit con un perfil nuevo llegó cuando el caso ya había terminado/u);
});

/**
 * El proceso aparte de la prueba siguiente: el primer caso vence esperando un cierre lento; su after lo espera y limpia,
 * y el cuerpo, que sigue durante el caso siguiente, intenta abrir otro navegador que lanzaría un `sleep`.
 */
function codigoDelCuerpoQueSigue() {
  return [
    "import assert from 'node:assert/strict';",
    "import { spawn } from 'node:child_process';",
    "import { once } from 'node:events';",
    "import { test } from 'node:test';",
    `import { abrirNavegador, recursosDelCaso } from ${JSON.stringify(MODULO_RECURSOS)};`,
    'let delOtro;',
    'let empezar;',
    'const empezado = new Promise((resolver) => { empezar = resolver; });',
    'let darApertura;',
    'const apertura = new Promise((resolver) => { darApertura = resolver; });',
    `test('el caso que vence', { timeout: ${PLAZO_DEL_CASO_QUE_VENCE_MS} }, async (t) => {`,
    `  const recursos = recursosDelCaso(t, { plazoDeCierreMs: ${PLAZO_DEL_CIERRE_LENTO_MS} });`,
    "  const lento = await recursos.abrir('el recurso lento', () => ({}), () => new Promise(() => undefined));",
    '  await recursos.cerrar(lento).catch(() => undefined);',
    '  await empezado;',
    "  const otro = abrirNavegador(recursos, 'el otro navegador', async () => {",
    "    delOtro = spawn('sleep', ['300'], { detached: true, stdio: 'ignore' });",
    "    await once(delOtro, 'spawn');",
    '    return { close: () => new Promise(() => undefined) };',
    '  });',
    '  darApertura(otro.then(() => undefined, (error) => error));',
    '  await otro.catch(() => undefined);',
    '});',
    `test('el caso siguiente', { timeout: ${PLAZO_DEL_CASO_SIGUIENTE_MS} }, async (t) => {`,
    "  const suyo = spawn('sleep', ['300'], { detached: true, stdio: 'ignore' });",
    "  t.after(() => { suyo.kill('SIGKILL'); delOtro?.kill('SIGKILL'); });",
    "  await once(suyo, 'spawn');",
    '  empezar();',
    '  const error = await apertura;',
    `  await Promise.race([once(suyo, 'exit'), new Promise((resolver) => setTimeout(resolver, ${LLEGADA_TARDIA_MS}))]);`,
    "  assert.deepEqual([suyo.exitCode, suyo.signalCode], [null, null], 'el proceso del caso siguiente sigue vivo');",
    "  assert.equal(delOtro, undefined, 'el otro navegador no se ha arrancado');",
    "  assert.equal(error?.message, 'el otro navegador no se abrió: el caso ya había terminado');",
    '});',
  ].join('\n');
}

test('el cuerpo de un caso vencido que sigue tras su after no abre otro navegador ni termina los procesos del siguiente', {
  timeout: PLAZO_DEL_CASO_MS,
}, () => {
  const codigo = codigoDelCuerpoQueSigue();
  const { NODE_TEST_CONTEXT: _contexto, ...entorno } = process.env;
  const ejecucion = spawnSync(process.execPath, ['--test-reporter=tap', '--input-type=module', '--eval', codigo], {
    encoding: 'utf8',
    env: entorno,
    timeout: PLAZO_DEL_CASO_MS - MARGEN_MS,
  });
  assert.equal(ejecucion.error, undefined);
  assert.match(ejecucion.stdout, /^not ok 1 - el caso que vence$/mu, 'el primer caso vence');
  assert.match(ejecucion.stdout, /^ok 2 - el caso siguiente$/mu, ejecucion.stdout);
  assert.match(ejecucion.stderr, /el otro navegador no se abrió: el caso ya había terminado/u, 'el fallo se anota');
});

test('un cierre vencido sin procesos vistos no se da por forzado', { timeout: PLAZO_DEL_CASO_MS }, async () => {
  const despues: (() => unknown)[] = [];
  const caso = { name: 'el caso', signal: new AbortController().signal, after: (f: () => unknown) => despues.push(f) };
  const recursos = recursosDelCaso(caso as unknown as TestContext, { plazoDeCierreMs: PLAZO_DEL_DOBLE_MS });
  const navegador = await abrirNavegador(recursos, 'el navegador doble', async () => ({
    close: () => new Promise<void>(() => undefined),
  }));
  await assert.rejects(recursos.cerrar(navegador), {
    message: `el navegador doble no se cerró (plazo de ${PLAZO_DEL_DOBLE_MS} ms); tampoco se pudo forzar: no se vieron procesos que forzar`,
  });
  await assert.rejects(Promise.resolve().then(despues[0]), /no se vieron procesos que forzar/u);
});

/**
 * Ejecuta `casos` (código de node:test) en un proceso aparte que importa `arrancar` y `MOTORES` de paquete-comun.mjs,
 * para sustituir en él el motor por un doble. Devuelve la ejecución, con su TAP.
 */
function conArrancarEnUnProcesoAparte(casos: readonly string[]) {
  const codigo = [
    "import assert from 'node:assert/strict';",
    "import { mock, test } from 'node:test';",
    `import { arrancar, MOTORES } from ${JSON.stringify(MODULO_PAQUETE)};`,
    `import { recursosDelCaso } from ${JSON.stringify(MODULO_RECURSOS)};`,
    ...casos,
  ].join('\n');
  const { NODE_TEST_CONTEXT: _contexto, ...entorno } = process.env;
  return spawnSync(process.execPath, ['--test-reporter=tap', '--input-type=module', '--eval', codigo], {
    encoding: 'utf8',
    env: entorno,
    timeout: PLAZO_DEL_CASO_MS - MARGEN_MS,
  });
}

test('arrancar (paquete-comun.mjs), con y sin los recursos del caso, da el fallo de Playwright como causa', {
  timeout: PLAZO_DEL_CASO_MS,
}, () => {
  const dicho = 'el navegador chromium no llegó a arrancar: browserType.launch: Executable does not exist';
  const ejecucion = conArrancarEnUnProcesoAparte([
    "const original = new Error('browserType.launch: Executable does not exist');",
    'const plazos = [];',
    'MOTORES.chromium = { launch: async ({ timeout }) => { plazos.push(timeout); throw original; } };',
    'const comprobar = (error) => {',
    `  assert.equal(error.message, ${JSON.stringify(dicho)});`,
    '  assert.equal(error.cause, original);',
    '  return true;',
    '};',
    "test('sin los recursos del caso', async () => {",
    "  await assert.rejects(arrancar('chromium'), comprobar);",
    '});',
    "test('con los recursos del caso', async (t) => {",
    "  await assert.rejects(arrancar('chromium', { recursos: recursosDelCaso(t) }), comprobar);",
    `  assert.deepEqual(plazos, [${PLAZO_DE_ARRANQUE_MS}, ${PLAZO_DE_ARRANQUE_MS}], 'Playwright recibe el plazo común');`,
    '});',
  ]);
  assert.equal(ejecucion.error, undefined);
  assert.match(ejecucion.stdout, /^ok 1 - sin los recursos del caso$/mu, ejecucion.stdout);
  assert.match(ejecucion.stdout, /^ok 2 - con los recursos del caso$/mu, ejecucion.stdout);
});

test('arrancar (paquete-comun.mjs) colgado falla al pasar el plazo más el margen y cierra el navegador que llega tarde', {
  timeout: PLAZO_DEL_CASO_MS,
}, () => {
  // Con los temporizadores simulados del proceso aparte: el plazo común es de 90 s.
  const dicho =
    `el navegador chromium no llegó a arrancar (plazo de ${PLAZO_DE_ARRANQUE_MS} ms; ` +
    `Playwright no respondió en ${MARGEN_DE_RESPALDO_MS} ms más)`;
  const ejecucion = conArrancarEnUnProcesoAparte([
    'const vueltas = async () => { for (let i = 0; i < 3; i++) await new Promise((resolver) => setImmediate(resolver)); };',
    "test('el arranque colgado', async () => {",
    '  let llegar;',
    '  let cierres = 0;',
    '  MOTORES.chromium = { launch: () => new Promise((resolver) => { llegar = resolver; }) };',
    "  mock.timers.enable({ apis: ['setTimeout'] });",
    '  let resultado;',
    "  arrancar('chromium').then(() => { resultado = 'arrancó'; }, (error) => { resultado = error; });",
    '  await vueltas();',
    `  mock.timers.tick(${PLAZO_DE_ARRANQUE_MS});`,
    '  await vueltas();',
    "  assert.equal(resultado, undefined, 'en el plazo de Playwright no se da por colgado');",
    `  mock.timers.tick(${MARGEN_DE_RESPALDO_MS});`,
    '  await vueltas();',
    `  assert.equal(resultado?.message, ${JSON.stringify(dicho)});`,
    '  llegar({ close: async () => { cierres++; } });',
    '  await vueltas();',
    "  assert.equal(cierres, 1, 'el navegador que llega tarde se cierra');",
    '});',
  ]);
  assert.equal(ejecucion.error, undefined);
  assert.match(ejecucion.stdout, /^ok 1 - el arranque colgado$/mu, ejecucion.stdout);
});

test('tras la limpieza del caso, conSusProcesos y arrancarConPlazo no toman por suyos los procesos que aparecen', {
  timeout: PLAZO_DEL_CASO_MS,
}, async (t) => {
  const despues: (() => unknown)[] = [];
  const caso = { name: 'el caso', signal: new AbortController().signal, after: (f: () => unknown) => despues.push(f) };
  const recursos = recursosDelCaso(caso as unknown as TestContext);
  await despues[0]?.();
  const delSiguiente: ChildProcess[] = [];
  t.after(() => {
    for (const proceso of delSiguiente) {
      proceso.kill('SIGKILL');
    }
  });
  /** Lanza un `sleep` en su grupo, como el navegador del caso siguiente. */
  const lanzarSleep = async () => {
    const proceso = spawn('sleep', ['300'], { detached: true, stdio: 'ignore' });
    delSiguiente.push(proceso);
    await once(proceso, 'spawn');
    return proceso;
  };
  const { procesos } = await conSusProcesos(async () => {
    await lanzarSleep();
    return { close: async () => undefined };
  }, recursos);
  assert.deepEqual(procesos, [], 'conSusProcesos no le atribuye ningún proceso');
  let colgado: ChildProcess | undefined;
  await assert.rejects(
    arrancarConPlazo(
      async () => {
        colgado = await lanzarSleep();
        return new Promise<{ close: () => Promise<void> }>(() => undefined);
      },
      'el navegador doble no llegó a arrancar',
      PLAZO_DEL_DOBLE_MS,
      { margenMs: MARGEN_DEL_DOBLE_MS, recursos },
    ),
    /Playwright no respondió/u,
  );
  assert.ok(colgado);
  await Promise.race([once(colgado, 'exit'), new Promise((resolver) => setTimeout(resolver, LLEGADA_TARDIA_MS))]);
  assert.deepEqual([colgado.exitCode, colgado.signalCode], [null, null], 'el respaldo no termina ese proceso');
});
