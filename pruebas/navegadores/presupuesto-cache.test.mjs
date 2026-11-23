// Ensayo de la condición «segunda visita» del presupuesto de rendimiento: en los tres motores, la recarga sale de la
// caché HTTP del navegador como contra el dominio real (cache-fiel.mjs; en WebKit, con un perfil persistente nuevo,
// porque el contexto efímero que le da Playwright no tiene caché HTTP, solo la de memoria de la página). Recorre
// medir() de presupuesto-medida.mjs (arranque, contexto, Basic y servidor del ensayo con HTTPS y HTTP/2) con un
// servidor de arriba propio que, como la construcción privada,
// exige Basic, y sirve una página sin caché, tres recursos inmutables y uno que se revalida con su ETag. En la recarga,
// los inmutables no llegan al servidor y el revalidable llega una vez como petición condicional, que responde 304. Uno
// de los inmutables lo pide `fetch()`: Chromium no lo entrega desde la caché de memoria de la página, solo desde su
// caché HTTP, así que distingue las dos (con un error de certificado la de memoria sigue sirviendo el guion y la imagen
// en una recarga, pero la caché HTTP no guarda nada; en el contexto efímero de WebKit vuelve al servidor). La primera
// visita es la de un perfil limpio: cada recurso llega una vez al servidor de arriba.
//
//   node --test pruebas/navegadores/presupuesto-cache.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { arrancarCon, CONDICIONES } from './presupuesto-condiciones.mjs';
import { medir } from './presupuesto-medida.mjs';
import { CREDENCIALES_SINTETICAS } from './privado.ts';
import { recursosDelCaso } from './recursos-del-caso.mjs';

const NOMBRE_DE_LA_CONDICION = 'segunda-visita';
const CONDICION = { ...CONDICIONES[NOMBRE_DE_LA_CONDICION], nombre: NOMBRE_DE_LA_CONDICION, bytesPorSegundo: null };
const BASIC = `Basic ${Buffer.from(`${CREDENCIALES_SINTETICAS.username}:${CREDENCIALES_SINTETICAS.password}`).toString('base64')}`;
const INMUTABLE = 'public, max-age=31536000, immutable';
const ETIQUETA = '"revalidable-1"';
/** La respuesta a una petición condicional cuyo recurso no ha cambiado (RFC 9110, 15.4.5). */
const NO_MODIFICADO = 304;
const GUION = '/guion-5f0c1a2b.js';
const DATOS = '/datos-3b8e04d7.json';
const IMAGEN = '/imagen-9d3e7a41.webp';
/** Una imagen válida (WebKit no conserva la que no puede decodificar): la fotografía de la portada. */
const FOTOGRAFIA = readFileSync(new URL('../../web/imagenes/fotografias/faro-penmon.webp', import.meta.url));
const REVALIDABLE = '/revalidable.css';
const INMUTABLES = [GUION, IMAGEN, DATOS];
const RECURSOS = {
  '/pagina.html': {
    tipo: 'text/html; charset=utf-8',
    cache: 'no-store',
    cuerpo: `<!doctype html><html lang="es"><title>caché</title><link rel="stylesheet" href="${REVALIDABLE}">
<img alt="" src="${IMAGEN}"><script src="${GUION}"></script>
<script>fetch('${DATOS}').then((r) => r.json()).then((d) => { window.datosCargados = d.ok; });</script>`,
  },
  [GUION]: { tipo: 'text/javascript', cache: INMUTABLE, cuerpo: 'window.guionCargado = true;' },
  [DATOS]: { tipo: 'application/json', cache: INMUTABLE, cuerpo: '{"ok":true}' },
  [IMAGEN]: { tipo: 'image/webp', cache: INMUTABLE, cuerpo: FOTOGRAFIA },
  [REVALIDABLE]: { tipo: 'text/css', cache: 'no-cache', etiqueta: ETIQUETA, cuerpo: 'body { margin: 0; }' },
};

/** Una página de la construcción privada: sin el Basic sintético, 401 con su desafío; con él, el recurso. */
function responder(req, res) {
  const recurso = RECURSOS[new URL(req.url, 'http://127.0.0.1').pathname];
  if (req.headers.authorization !== BASIC) {
    res.writeHead(ESTADO_HTTP.noAutenticado, {
      'www-authenticate': 'Basic realm="Acceso privado"',
      'cache-control': 'no-store',
    });
    res.end();
  } else if (!recurso) {
    res.writeHead(ESTADO_HTTP.noEncontrado);
    res.end();
  } else if (recurso.etiqueta && req.headers['if-none-match'] === recurso.etiqueta) {
    res.writeHead(NO_MODIFICADO, { etag: recurso.etiqueta, 'cache-control': recurso.cache });
    res.end();
  } else {
    const etiqueta = recurso.etiqueta ? { etag: recurso.etiqueta } : {};
    res.writeHead(ESTADO_HTTP.correcto, { 'content-type': recurso.tipo, 'cache-control': recurso.cache, ...etiqueta });
    res.end(recurso.cuerpo);
  }
}

/** El servidor de arriba de medir(): su origen, lo que le llega (ruta, método, destino) y su cierre. */
async function servidorDeArriba() {
  const peticiones = [];
  const servidor = createServer((req, res) => {
    peticiones.push({
      ruta: new URL(req.url, 'http://127.0.0.1').pathname,
      metodo: req.method ?? 'GET',
      destino: req.headers['sec-fetch-dest'] ?? null,
    });
    responder(req, res);
  });
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  return {
    origen: `http://127.0.0.1:${servidor.address().port}`,
    peticiones,
    errores: [],
    cerrar: () => {
      servidor.closeAllConnections();
      return new Promise((ok) => servidor.close(() => ok()));
    },
  };
}

const ESCENARIO = {
  nombre: 'caché',
  ruta: '/pagina.html',
  serviceWorker: false,
  interfaz: (pagina, plazo) =>
    pagina.waitForFunction(
      () => window.guionCargado === true && window.datosCargados === true && document.querySelector('img')?.complete,
      undefined,
      { timeout: plazo },
    ),
};

/** Lo que llega al servidor en la recarga medida y, en las dos visitas, al servidor de arriba. */
function comprobarRecarga(medida, arriba) {
  assert.deepEqual(medida.errores, [], 'Ni el servidor del ensayo ni el de arriba fallan');
  assert.equal(medida.servidor.sinIdentidadEsperada, 0, 'El navegador llega siempre con la identidad del ensayo');
  assert.ok(medida.hitos.interfaz.alcanzado, `La página carga en la recarga: ${medida.hitos.interfaz.error ?? ''}`);
  const recarga = medida.peticiones.map(({ ruta, estado, protocolo }) => ({ ruta, estado, protocolo }));
  const vista = JSON.stringify(recarga);
  const de = (ruta) => recarga.filter((p) => p.ruta === ruta);
  assert.ok(
    recarga.every((p) => p.protocolo === '2.0'),
    `La recarga va por HTTP/2 con TLS: ${vista}`,
  );
  assert.deepEqual(de(DATOS), [], `Lo inmutable pedido por fetch() no vuelve al servidor: ${vista}`);
  assert.deepEqual(de(GUION), [], `El guion inmutable no vuelve al servidor: ${vista}`);
  assert.deepEqual(de(IMAGEN), [], `La imagen inmutable no vuelve al servidor: ${vista}`);
  assert.deepEqual(
    de(REVALIDABLE).map((p) => p.estado),
    [NO_MODIFICADO],
    `El recurso revalidable vuelve una vez y se revalida con su ETag: ${vista}`,
  );
  assert.deepEqual(
    de('/pagina.html').map((p) => p.estado),
    [ESTADO_HTTP.correcto],
    'La página sin caché se pide una vez, ya con el Basic',
  );
  const inmutablesArriba = arriba.peticiones.filter((p) => INMUTABLES.includes(p.ruta)).length;
  assert.equal(inmutablesArriba, INMUTABLES.length, 'Cada inmutable llega al servidor una sola vez en las dos visitas');
}

for (const motor of ['chromium', 'firefox', 'webkit']) {
  test(`${motor}: en la segunda visita la recarga sale de la caché HTTP del navegador`, async (t) => {
    const sesion = await arrancarCon(motor, CONDICION, recursosDelCaso(t));
    let arriba;
    try {
      const medida = await medir({
        sesion,
        motor,
        escenario: ESCENARIO,
        condicion: CONDICION,
        arriba: async () => {
          arriba = await servidorDeArriba();
          return arriba;
        },
      });
      comprobarRecarga(medida, arriba);
    } finally {
      await sesion.cerrar();
    }
  });
}
