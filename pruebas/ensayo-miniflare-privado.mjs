/** Ensayo explícito de la construcción final: solo workerd local y credenciales sintéticas. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { comprobarArtefactoCloudflare } from '../herramientas/cloudflare/artefacto.ts';
import { CABECERA_CONTRATO, CONTRATO_API } from '../src/comun/protocolo-web.ts';
import { abrirWorkerConstruido } from './navegadores/worker-miniflare.ts';

/** El nodo, este guion y la huella; la carpeta de la construcción es opcional. */
const ARGUMENTOS_MINIMOS = 3;
const BYTES_FIRMA = 48;
const NO_AUTENTICADO = 401;
const NO_DISPONIBLE = 503;
const REDIRECCION = 302;
const CORRECTO = 200;
const NO_ENCONTRADO = 404;
const raiz = dirname(dirname(fileURLToPath(import.meta.url)));
const [huella, carpeta] = process.argv.slice(2);
assert.ok(
  huella && /^[a-f0-9]{64}$/.test(huella) && [ARGUMENTOS_MINIMOS, ARGUMENTOS_MINIMOS + 1].includes(process.argv.length),
  'Indica SHA-256 del artefacto y, si no es dist/, la carpeta de la construcción',
);
const dist = carpeta === undefined ? join(raiz, 'dist') : resolve(carpeta);
comprobarArtefactoCloudflare(dist, huella);
const descriptor = JSON.parse(readFileSync(join(dist, 'artefacto.json'), 'utf8'));
const recursos = descriptor.archivos.filter((archivo) => archivo.ruta.startsWith('web/'));
assert.ok(recursos.length > 0, 'El inventario web está vacío');
const clave = 'clave-sintetica-exclusiva-ensayo-local';
const autorizacion = `Basic ${Buffer.from(`Faro:${clave}`).toString('base64')}`;
const url = (ruta) => `https://ensayo.invalid/${ruta.split('/').map(encodeURIComponent).join('/')}`;
const abrir = (secreto) =>
  abrirWorkerConstruido(dist, {
    bindings: {
      ...(secreto
        ? { FARO_PRUEBAS_CLAVE: clave, FARO_PRUEBAS_LIMITE: 'limite-privado-sintetico-distinto-de-32-bytes' }
        : {}),
      FARO_SECRETO_FIRMA: 's'.repeat(BYTES_FIRMA),
      FARO_ADMINISTRACION: 'si',
      FARO_MCP: 'si',
      FARO_A2A: 'si',
      FARO_API_SOCIOS: 'si',
    },
  });

const sinClave = abrir(false);
try {
  const respuesta = await sinClave.dispatchFetch(url(''), { headers: { authorization: autorizacion } });
  assert.equal(respuesta.status, NO_DISPONIBLE, 'sin secreto debe cerrar');
  assert.equal(respuesta.headers.get('cache-control'), 'no-store');
} finally {
  await sinClave.dispose();
}

const miniflare = abrir(true);
try {
  for (const archivo of recursos) {
    const respuesta = await miniflare.dispatchFetch(url(archivo.ruta.slice('web/'.length)));
    assert.equal(respuesta.status, NO_AUTENTICADO, `Recurso accesible sin credenciales: ${archivo.ruta}`);
    assert.equal(respuesta.headers.get('cache-control'), 'no-store');
    await respuesta.arrayBuffer();
  }
  for (const ruta of ['', 'inicio.html', 'api/salud', 'mcp', 'a2a', 'administracion/', '.well-known/security.txt']) {
    const sinAcceso = await miniflare.dispatchFetch(url(ruta), {
      headers: { authorization: 'Basic incorrecto', 'cf-connecting-ip': '127.0.0.1' },
    });
    assert.equal(sinAcceso.status, NO_AUTENTICADO, `Acceso erróneo: ${ruta}`);
    assert.doesNotMatch(await sinAcceso.text(), /clave-sintetica-exclusiva/);
  }
  const conClave = (ruta) =>
    miniflare.dispatchFetch(url(ruta), {
      // Como la web: la API rechaza con 409 las peticiones sin la versión vigente del contrato.
      headers: {
        authorization: autorizacion,
        'cf-connecting-ip': '127.0.0.1',
        [CABECERA_CONTRATO]: String(CONTRATO_API),
      },
      redirect: 'manual',
    });
  const portada = await conClave('');
  assert.equal(portada.status, REDIRECCION);
  assert.equal(portada.headers.get('cache-control'), 'no-store');
  const inicio = await conClave('inicio.html');
  assert.equal(inicio.status, CORRECTO);
  assert.equal(inicio.headers.get('cache-control'), 'no-store');
  const salud = await conClave('api/salud');
  assert.equal(salud.status, CORRECTO);
  for (const ruta of ['mcp', 'a2a', '.well-known/agent-card.json', 'api/socios/v1/token', 'administracion/']) {
    const respuesta = await conClave(ruta);
    assert.equal(respuesta.status, NO_ENCONTRADO, `Servicio no cerrado: ${ruta}`);
  }
  comprobarArtefactoCloudflare(dist, huella);
  console.log(
    JSON.stringify({
      recursosSinCredenciales: recursos.length,
      sinSecreto: 'cerrado',
      servicios: 'apagados',
      sha256Artefacto: huella,
    }),
  );
} finally {
  await miniflare.dispose();
}
