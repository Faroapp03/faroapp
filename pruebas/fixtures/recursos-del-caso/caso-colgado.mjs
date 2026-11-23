// Un caso de node:test que se cuelga con recursos abiertos: un servidor HTTP con una conexión que nunca responde, un
// proceso `sleep` y una carpeta temporal. Los registra con recursosDelCaso y anota en FARO_REGISTRO dónde están.
// Lo lanza pruebas/herramientas/recursos-del-caso.test.ts como archivo aparte; no es una prueba de la suite.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import { escribirIdentidades } from '../../ayudas/procesos-de-prueba.ts';
import { cerrarServidor, recursosDelCaso } from '../../navegadores/recursos-del-caso.mjs';

const PLAZO_DEL_CASO_MS = 500;

test('un caso que se cuelga con sus recursos abiertos', { timeout: PLAZO_DEL_CASO_MS }, async (t) => {
  const recursos = recursosDelCaso(t);
  const carpeta = await recursos.abrir(
    'la carpeta del caso',
    () => mkdtempSync(join(process.env.FARO_BASE ?? '', 'caso-colgado-')),
    (ruta) => rmSync(ruta, { recursive: true, force: true }),
  );
  const servidor = await recursos.abrir(
    'el servidor del caso',
    async () => {
      const abierto = createServer(() => {
        // Nunca responde: la conexión queda abierta.
      });
      abierto.listen(0, '127.0.0.1');
      await once(abierto, 'listening');
      return abierto;
    },
    cerrarServidor,
  );
  const { port: puerto } = servidor.address();
  const cliente = connect(puerto, '127.0.0.1');
  await once(cliente, 'connect');
  cliente.write('GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n');
  const dormido = await recursos.abrir(
    'el proceso del caso',
    () => spawn('sleep', ['300'], { stdio: 'ignore' }),
    (proceso) => {
      proceso.kill('SIGKILL');
      return proceso.exitCode === null && proceso.signalCode === null ? once(proceso, 'exit') : undefined;
    },
  );
  // La identidad del proceso, mientras vive: la prueba solo lo señala si sigue siendo el mismo.
  escribirIdentidades(`${process.env.FARO_REGISTRO ?? ''}.procesos`, [dormido.pid]);
  writeFileSync(process.env.FARO_REGISTRO ?? '', JSON.stringify({ carpeta, puerto, pid: dormido.pid }));
  await new Promise(() => {
    // Colgado, como una espera sin plazo.
  });
});
