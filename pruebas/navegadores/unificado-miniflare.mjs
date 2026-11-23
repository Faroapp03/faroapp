// Candidata construida en workerd local: solo loopback, credenciales sintéticas y puente HTTP→HTTPS.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { comprobarArtefactoCloudflare } from '../../herramientas/cloudflare/artefacto.ts';
import { abrirWorkerConstruido } from './worker-miniflare.ts';

const CLAVE_BASIC = 'clave-sintetica-exclusiva-del-ensayo';
const CLAVE_RECORRIDO = 'clave-sintetica-del-recorrido-local';
const FIRMA = 'firma-sintetica-del-recorrido-local-para-pruebas';
const LIMITE = 'limite-sintetico-independiente-para-pruebas';
const NO_ENCONTRADO = 404;
const PROHIBIDO = 403;
const ERROR_INTERNO = 500;
const ARGUMENTOS_ESPERADOS = 3;
const raiz = fileURLToPath(new URL('../../', import.meta.url));
const dist = join(raiz, 'dist');
const huella = process.argv[2];
assert.ok(
  huella && /^[a-f0-9]{64}$/.test(huella) && process.argv.length === ARGUMENTOS_ESPERADOS,
  'Indica SHA-256 del artefacto',
);
comprobarArtefactoCloudflare(dist, huella);
const BINDINGS = {
  FARO_PRUEBAS_CLAVE: CLAVE_BASIC,
  FARO_PRUEBAS_LIMITE: 'limite-privado-sintetico-distinto-de-32-bytes',
  FARO_RECORRIDO_CLAVE: CLAVE_RECORRIDO,
  FARO_RECORRIDO_FIRMA: FIRMA,
  FARO_RECORRIDO_LIMITE: LIMITE,
  FARO_SECRETO_FIRMA: 'firma-sintetica-independiente-del-panel-local',
};
const mini = abrirWorkerConstruido(dist, { bindings: BINDINGS });
async function probarPanelProtegido() {
  const protegido = abrirWorkerConstruido(dist, {
    bindings: {
      ...BINDINGS,
      FARO_PRUEBAS_ADMINISTRACION: 'si',
      FARO_ADMIN_ORIGEN: 'https://ensayo.invalid',
      FARO_ADMIN_ACCESS_EQUIPO: 'navegadores-sintetico',
      FARO_ADMIN_ACCESS_AUD: 'panel',
    },
  });
  try {
    const authorization = `Basic ${Buffer.from(`Faro:${CLAVE_BASIC}`).toString('base64')}`;
    for (const ruta of ['/administracion', '/administracion/panel.js', '/administracion/api/controles/leer']) {
      const respuesta = await protegido.dispatchFetch(`https://ensayo.invalid${ruta}`, {
        headers: { authorization, 'cf-connecting-ip': '127.0.0.1' },
        redirect: 'manual',
      });
      assert.equal(respuesta.status, PROHIBIDO, `${ruta}: sin Access debe rechazar`);
    }
  } finally {
    await protegido.dispose();
  }
}
function cabecerasPuente(req, origen, destino) {
  const headers = new Headers();
  for (const [nombre, valor] of Object.entries(req.headers)) {
    if (valor !== undefined) {
      headers.set(nombre, Array.isArray(valor) ? valor.join(', ') : valor);
    }
  }
  if (headers.get('origin') === origen) {
    headers.set('origin', destino);
  }
  headers.set('cf-connecting-ip', '127.0.0.1');
  // dispatchFetch pasa por undici, que reescribe Sec-Fetch-Mode con el modo de su propia petición (cors);
  // Miniflare restituye al worker el valor del navegador si llega en MF-Sec-Fetch-Mode.
  const modo = req.headers['sec-fetch-mode'];
  if (typeof modo === 'string') {
    headers.set('mf-sec-fetch-mode', modo);
  } else {
    headers.delete('mf-sec-fetch-mode');
  }
  return headers;
}

let origen = '';
const servidor = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', origen);
    url.protocol = 'https:';
    const headers = cabecerasPuente(req, origen, url.origin);
    const partes = [];
    for await (const parte of req) {
      partes.push(parte);
    }
    const cuerpo = Buffer.concat(partes);
    const respuesta = await mini.dispatchFetch(url.href, {
      method: req.method,
      headers,
      ...(cuerpo.length ? { body: cuerpo } : {}),
      redirect: 'manual',
    });
    res.writeHead(respuesta.status, Object.fromEntries(respuesta.headers));
    res.end(Buffer.from(await respuesta.arrayBuffer()));
  })().catch(() => {
    res.writeHead(ERROR_INTERNO);
    res.end();
  });
});
try {
  await probarPanelProtegido();
  await new Promise((ok, fallo) => {
    servidor.once('error', fallo);
    servidor.listen(0, '127.0.0.1', ok);
  });
  const direccion = servidor.address();
  assert.ok(direccion && typeof direccion !== 'string');
  origen = `http://127.0.0.1:${direccion.port}`;
  const hijo = spawn(
    process.execPath,
    [fileURLToPath(new URL('./real-privada-remoto.mjs', import.meta.url)), '--local'],
    {
      stdio: ['pipe', 'inherit', 'inherit'],
    },
  );
  hijo.stdin.end(
    JSON.stringify({
      origen,
      usuario: 'Faro',
      clave: CLAVE_BASIC,
      estadosPanel: [NO_ENCONTRADO, NO_ENCONTRADO, NO_ENCONTRADO],
    }),
  );
  const salida = await new Promise((ok, fallo) => {
    hijo.once('error', fallo);
    hijo.once('exit', (codigo) => ok(codigo));
  });
  comprobarArtefactoCloudflare(dist, huella);
  assert.equal(salida, 0, 'El ensayo integrado local falló');
} finally {
  if (servidor.listening) {
    servidor.closeAllConnections();
    await new Promise((ok, fallo) => servidor.close((error) => (error ? fallo(error) : ok())));
  }
  await mini.dispose();
}
