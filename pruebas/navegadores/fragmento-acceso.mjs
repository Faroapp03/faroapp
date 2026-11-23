/**
 * Ensayo común del fragmento QR tras la autoridad de recorrido, en los tres navegadores aislados y en los dos idiomas:
 * el fragmento sintético permanece en el navegador y no llega al servidor, ni en la dirección ni en las cabeceras ni en
 * el cuerpo. Cada escenario indica la variante que se pide, su ruta de entrada y el modo guardado: si coinciden, la
 * variante está activa y se sirve sin contraseña; si no, se pide la contraseña antes de mostrarla.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, firefox, webkit } from 'playwright-core';
import { entornoParaLanzar } from '../../scripts/entorno-firefox.ts';
import { responderAccesoRecorrido } from '../../src/plataforma/cloudflare/acceso-recorrido.ts';
import { cerrarServidor, cerrarSinSustituir, lanzarConPlazo, recursosDelCaso } from './recursos-del-caso.mjs';

const MARCADOR = 'MARCA_NO_PERSONAL';
const CLAVE = 'clave-sintetica-para-el-recorrido';
const FIRMA = 'firma-sintetica-independiente-de-32-caracteres';
const CORRECTO = 200;
/** La variante inactiva: la página con el formulario, el envío de la contraseña y la página final. */
const SOLICITUDES_CON_CONTRASENA = 3;
const NAVEGADORES = [chromium, firefox, webkit];
const IDIOMAS = ['es-ES', 'ca-ES'];

function certificados(carpeta) {
  const clave = join(carpeta, 'clave.pem');
  const certificado = join(carpeta, 'certificado.pem');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      clave,
      '-out',
      certificado,
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
    ],
    { stdio: 'ignore' },
  );
  return { key: readFileSync(clave), cert: readFileSync(certificado) };
}

function servidorDePrueba(carpeta, registro, { variante, modo }) {
  const servidor = createServer(certificados(carpeta), async (entrada, salida) => {
    registro.rutas.push(entrada.url ?? '');
    const pedazos = [];
    for await (const pedazo of entrada) {
      pedazos.push(pedazo);
    }
    const puerto = servidor.address().port;
    const cuerpo = Buffer.concat(pedazos);
    const cabeceras = Object.values(entrada.headers).flat().join(' ');
    registro.filtraciones.push(cabeceras.includes(MARCADOR) || cuerpo.includes(Buffer.from(MARCADOR)));
    const peticion = new Request(`https://127.0.0.1:${puerto}${entrada.url}`, {
      method: entrada.method,
      headers: entrada.headers,
      ...(cuerpo.length ? { body: cuerpo } : {}),
    });
    const respuesta = await responderAccesoRecorrido(peticion, {
      variante,
      clave: CLAVE,
      firma: FIRMA,
      leerModo: async () => ({ version: 1, revision: 1, modo }),
      consumirIntento: async () => true,
      delegar: async () =>
        new Response('<!doctype html><title>Recorrido</title><h1>Recorrido</h1>', {
          headers: { 'content-type': 'text/html' },
        }),
    });
    salida.writeHead(respuesta.status, Object.fromEntries(respuesta.headers));
    salida.end(Buffer.from(await respuesta.arrayBuffer()));
  });
  return servidor;
}

function sinFragmentoEnElServidor({ rutas, filtraciones }) {
  assert.ok(rutas.every((ruta) => !ruta.includes(MARCADOR) && !ruta.includes('#')));
  assert.ok(filtraciones.every((filtrada) => !filtrada));
}

async function pasarLaContrasena(pagina, registro, idioma) {
  if (idioma === 'ca-ES') {
    assert.match(await pagina.locator('label').innerText(), /Contrasenya/);
  }
  await pagina.locator('input[name="clave"]').fill('incorrecta');
  await pagina.locator('button[type="submit"]').click();
  await pagina.locator('#acceso-error').waitFor({ state: 'visible' });
  assert.ok(new URL(pagina.url()).hash === `#pasar=${MARCADOR}`);
  await pagina.locator('input[name="clave"]').fill(CLAVE);
  const [final] = await Promise.all([
    pagina.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }),
    pagina.locator('button[type="submit"]').click(),
  ]).catch((error) => {
    sinFragmentoEnElServidor(registro);
    throw error;
  });
  assert.equal(final?.status(), CORRECTO);
}

async function probarNavegacion(navegador, servidor, registro, { idioma, escenario }) {
  const contexto = await navegador.newContext({ ignoreHTTPSErrors: true, locale: idioma });
  try {
    const pagina = await contexto.newPage();
    const origen = `https://127.0.0.1:${servidor.address().port}`;
    const antes = registro.rutas.length;
    const inicial = await pagina.goto(`${origen}${escenario.ruta}#pasar=${MARCADOR}`);
    assert.equal(inicial?.status(), CORRECTO);
    sinFragmentoEnElServidor(registro);
    const activa = escenario.variante === escenario.modo;
    if (activa) {
      assert.equal(await pagina.locator('h1').innerText(), 'Recorrido', 'La variante activa se sirve sin contraseña');
    } else {
      await pasarLaContrasena(pagina, registro, idioma);
    }
    assert.ok(new URL(pagina.url()).hash === `#pasar=${MARCADOR}`, 'El fragmento no llegó a la página final');
    assert.ok(registro.rutas.length - antes >= (activa ? 1 : SOLICITUDES_CON_CONTRASENA));
    sinFragmentoEnElServidor(registro);
  } finally {
    await contexto.close();
  }
}

/**
 * Recorre cada escenario en los tres navegadores y en los dos idiomas, con un servidor propio por escenario. La
 * carpeta, cada servidor y cada navegador son recursos del caso `t` (recursos-del-caso.mjs): se cierran aunque venza.
 *
 * @param {readonly { variante: string; ruta: string; modo: string }[]} escenarios - Variante pedida, ruta de su
 *   entrada y modo guardado.
 * @param {import('node:test').TestContext} t - El caso que los recorre.
 */
export async function probarFragmentoEnNavegadores(escenarios, t) {
  assert.ok(escenarios.length > 0, 'Sin escenarios no se prueba nada');
  const recursos = recursosDelCaso(t);
  const carpeta = await recursos.abrir(
    'la carpeta de los certificados',
    () => mkdtempSync(join(tmpdir(), 'faro-qr-')),
    (ruta) => rmSync(ruta, { recursive: true, force: true }),
  );
  try {
    for (const escenario of escenarios) {
      const registro = { rutas: [], filtraciones: [] };
      const servidor = await recursos.abrir(
        `el servidor de ensayo (${escenario.modo})`,
        () => servidorDePrueba(carpeta, registro, escenario),
        cerrarServidor,
      );
      try {
        await new Promise((resolver) => servidor.listen(0, '127.0.0.1', resolver));
        for (const tipo of NAVEGADORES) {
          const navegador = await lanzarConPlazo(
            tipo,
            { headless: true, env: entornoParaLanzar() },
            `${t.name} (${escenario.modo})`,
            { recursos },
          );
          try {
            for (const idioma of IDIOMAS) {
              await probarNavegacion(navegador, servidor, registro, { idioma, escenario });
            }
          } finally {
            await cerrarSinSustituir(() => recursos.cerrar(navegador), `el navegador ${tipo.name()} no se cerró`);
          }
        }
      } finally {
        await cerrarSinSustituir(() => recursos.cerrar(servidor), 'el servidor de ensayo no se cerró');
      }
    }
  } finally {
    await cerrarSinSustituir(() => recursos.cerrar(carpeta), 'la carpeta de los certificados no se retiró');
  }
}
