// Casos de node:test que ejercitan los cierres de recursosDelCaso: un recurso que llega tarde, un cierre que vence y
// se fuerza, `cerrar` seguido del after, un cierre en curso cuando vence el caso y un «navegador» (un `sleep` hijo)
// cuyo cierre vence y se termina con su proceso. Anota cada cierre en FARO_REGISTRO.
// Lo lanza pruebas/herramientas/recursos-del-caso.test.ts como archivo aparte; no es una prueba de la suite.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { setTimeout as esperar } from 'node:timers/promises';
import { escribirIdentidades } from '../../ayudas/procesos-de-prueba.ts';
import { abrirNavegador, recursosDelCaso } from '../../navegadores/recursos-del-caso.mjs';

const PLAZO_DEL_CASO_MS = 300;
const LLEGA_TARDE_MS = 800;
const PLAZO_DE_CIERRE_MS = 200;
const CIERRE_LENTO_MS = 600;
const anotar = (caso, texto) => appendFileSync(process.env.FARO_REGISTRO ?? '', `${caso}: ${texto}\n`);

test('tarde: un recurso que llega tras la limpieza se cierra al llegar', { timeout: PLAZO_DEL_CASO_MS }, async (t) => {
  const recursos = recursosDelCaso(t);
  await recursos.abrir(
    'el recurso tardío',
    async () => {
      await esperar(LLEGA_TARDE_MS);
      return {};
    },
    () => anotar('tarde', 'cerrado'),
  );
});

test('vence: un cierre que vence se fuerza y la limpieza falla con todos los motivos', async (t) => {
  const recursos = recursosDelCaso(t, { plazoDeCierreMs: PLAZO_DE_CIERRE_MS });
  await recursos.abrir(
    'la carpeta',
    () => ({}),
    () => anotar('vence', 'carpeta retirada'),
  );
  await recursos.abrir(
    'el recurso atascado',
    () => ({}),
    () =>
      new Promise(() => {
        // Nunca termina de cerrarse.
      }),
    { forzar: () => anotar('vence', 'forzado') },
  );
});

test('una vez: cerrar y después el after no cierran dos veces', async (t) => {
  const recursos = recursosDelCaso(t);
  const recurso = await recursos.abrir(
    'el recurso',
    () => ({}),
    () => anotar('una vez', 'cerrado'),
  );
  await recursos.cerrar(recurso);
});

test('en curso: si el caso vence durante un cierre, el after lo espera antes de seguir', {
  timeout: PLAZO_DEL_CASO_MS,
}, async (t) => {
  const recursos = recursosDelCaso(t);
  await recursos.abrir(
    'la carpeta',
    () => ({}),
    () => anotar('en curso', 'carpeta retirada'),
  );
  const lento = await recursos.abrir(
    'el navegador lento',
    () => ({}),
    async () => {
      anotar('en curso', 'cierre empieza');
      await esperar(CIERRE_LENTO_MS);
      anotar('en curso', 'cierre termina');
    },
  );
  await recursos.cerrar(lento);
});

test('forzado: un navegador cuyo cierre vence se termina con sus procesos', async (t) => {
  const recursos = recursosDelCaso(t, { plazoDeCierreMs: PLAZO_DE_CIERRE_MS });
  const marca = `${process.env.FARO_REGISTRO ?? ''}.nieto`;
  await abrirNavegador(recursos, 'el navegador doble', async () => {
    // Como un navegador de Playwright: un hijo en su propio grupo (detached) con un nieto; y otro hijo sin grupo propio.
    const lider = spawn('/bin/sh', ['-c', 'sleep 300 & echo $! > "$1"; wait', 'sh', marca], {
      detached: true,
      stdio: 'ignore',
    });
    const suelto = spawn('sleep', ['300'], { stdio: 'ignore' });
    await Promise.all([once(lider, 'spawn'), once(suelto, 'spawn')]);
    while (!existsSync(marca) || !readFileSync(marca, 'utf8').trim()) {
      await esperar(10);
    }
    const pids = [lider.pid, Number(readFileSync(marca, 'utf8').trim()), suelto.pid];
    // Sus identidades, mientras viven: la prueba solo señala los que sigan siendo los mismos.
    escribirIdentidades(`${process.env.FARO_REGISTRO ?? ''}.forzado`, pids);
    anotar('forzado', `pids ${pids.join(' ')}`);
    return {
      close: () =>
        new Promise(() => {
          // Nunca termina de cerrarse.
        }),
    };
  });
});
