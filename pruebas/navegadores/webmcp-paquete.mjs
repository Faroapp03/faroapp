// Ensayo: WebMCP con el paquete. En la página del recorrido servida desde la construcción (fixture.ts), con un contexto
// de modelo sintético en `document.modelContext`, se registran las mismas herramientas que define el servidor MCP de
// las fuentes (src/api/mcp/herramientas.ts), con sus títulos, descripciones, esquemas y anotaciones, y una consulta
// devuelve el mismo texto que el servidor de las fuentes con los mismos datos. Sin contexto de modelo, la página no
// registra nada y no da errores. Cada respuesta 404 se anota por su dirección y solo se admiten las declaradas.
//
//   node pruebas/navegadores/webmcp-paquete.mjs --artefacto <dist> [--motor chromium …] [--salida <carpeta>]
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { definiciones, llamarHerramienta } from '../../src/api/mcp/herramientas.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import { crearFixture } from './fixture.ts';
import {
  argumentos,
  arrancar,
  construccionEnsayada,
  contextoDelRecorrido,
  esperarServiceWorkerActivado,
  PLAZO_MS,
  primerMensaje,
  recortar,
  servible,
} from './paquete-comun.mjs';

const DATOS = cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url)));
const LLAMADA = { name: 'ficha_grupo', arguments: { isco: '7512' } };
const NOMBRE_WEBMCP = /^[A-Za-z0-9_.-]{1,128}$/u;
/**
 * Las direcciones que la página pide y que una instalación privada contesta con 404 por diseño. El estado del portal
 * de acceso (web/scripts/salir-portal.js) solo lo responde la puerta del portal (src/plataforma/cloudflare/
 * acceso-portal.ts) con una sesión del portal; sin portal, el 404 indica que no hay salida que ofrecer.
 */
const SIN_RESPUESTA_EN_PRIVADO = new Set(['/acceso-web/estado']);

/** Lo que tiene que ofrecer la página: las herramientas de solo lectura de las fuentes, como las traduce WebMCP. */
function esperadas() {
  return definiciones()
    .filter((d) => d.annotations?.readOnlyHint === true && NOMBRE_WEBMCP.test(d.name))
    .map((d) => ({
      name: d.name,
      title: d.title,
      description: d.description,
      inputSchema: d.inputSchema,
      annotations: { readOnlyHint: true, untrustedContentHint: d.annotations?.openWorldHint === true },
    }));
}

async function abrir({ navegador, fixture, conModelo }) {
  const contexto = await contextoDelRecorrido(navegador, fixture.origen);
  await contexto.addInitScript((simulado) => {
    if (simulado) {
      const registradas = new Map();
      globalThis.__herramientas = registradas;
      Object.defineProperty(document, 'modelContext', {
        value: {
          registerTool(herramienta, { signal } = {}) {
            registradas.set(herramienta.name, herramienta);
            signal?.addEventListener('abort', () => registradas.delete(herramienta.name), { once: true });
            return Promise.resolve();
          },
        },
      });
    }
  }, conModelo);
  const pagina = await contexto.newPage();
  const errores = [];
  const noEncontradas = [];
  pagina.on('response', (respuesta) => {
    if (respuesta.status() === ESTADO_HTTP.noEncontrado) {
      noEncontradas.push(new URL(respuesta.url()).pathname);
    }
  });
  pagina.on('pageerror', (e) => errores.push(recortar(`pageerror: ${String(e)}`)));
  pagina.on('console', (m) => {
    if (m.type() === 'error' || /herramientas/u.test(m.text())) {
      errores.push(recortar(`${m.type()}: ${m.text()}`));
    }
  });
  return { contexto, pagina, errores, noEncontradas };
}

/** Primera visita: el service worker se activa y el motor responde una vez; WebMCP se ofrece al volver a abrir. */
async function prepararMotor(pagina, origen) {
  assert.equal((await pagina.goto(`${origen}/recorrido.html`))?.status(), ESTADO_HTTP.correcto);
  await pagina.locator('#conversacion .rc-mensaje').first().waitFor({ timeout: PLAZO_MS });
  await esperarServiceWorkerActivado(pagina);
  await primerMensaje(pagina);
  await pagina.reload();
  await pagina.locator('#conversacion .rc-mensaje').first().waitFor({ timeout: PLAZO_MS });
}

/** Con contexto de modelo: lo que registra la página y lo que responde una de sus herramientas. */
async function conContextoDeModelo(navegador, fixture) {
  const con = await abrir({ navegador, fixture, conModelo: true });
  try {
    await prepararMotor(con.pagina, fixture.origen);
    await con.pagina
      .waitForFunction(() => globalThis.__herramientas.size > 0, undefined, { timeout: PLAZO_MS })
      .catch((error) => {
        if (error?.name === 'TimeoutError') {
          assert.fail(`La página no registra ninguna herramienta WebMCP en el plazo (${PLAZO_MS} ms)`);
        }
        throw error;
      });
    const ofrecidas = await con.pagina.evaluate(() =>
      [...globalThis.__herramientas.values()].map(({ name, title, description, inputSchema, annotations }) => ({
        name,
        title,
        description,
        inputSchema,
        annotations,
      })),
    );
    const obtenido = await con.pagina.evaluate(
      async ({ name, arguments: entrada }) =>
        JSON.stringify(await globalThis.__herramientas.get(name).execute(entrada, {})),
      LLAMADA,
    );
    return { ofrecidas, obtenido, errores: con.errores, noEncontradas: con.noEncontradas };
  } finally {
    await con.contexto.close();
  }
}

/** Sin contexto de modelo: la página no ofrece nada y no da errores. */
async function sinContextoDeModelo(navegador, fixture) {
  const sin = await abrir({ navegador, fixture, conModelo: false });
  try {
    await prepararMotor(sin.pagina, fixture.origen);
    return {
      modelContext: await sin.pagina.evaluate(() => 'modelContext' in document),
      errores: sin.errores,
      noEncontradas: sin.noEncontradas,
    };
  } finally {
    await sin.contexto.close();
  }
}

async function probar(navegador, artefacto) {
  const fixture = await crearFixture(artefacto);
  try {
    const { ofrecidas, obtenido, errores, noEncontradas } = await conContextoDeModelo(navegador, fixture);
    const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
    const esperado = llamarHerramienta({ datos: DATOS, politica: 'ocupacion', hoy }, LLAMADA);
    const resultado = {
      conModelo: {
        herramientas: ofrecidas.map((h) => h.name),
        mismasHerramientas: JSON.stringify(ofrecidas) === JSON.stringify(esperadas()),
        mismaRespuesta: esperado.isError === false && obtenido === esperado.content[0]?.text,
        bytesRespuesta: obtenido.length,
        errores,
        noEncontradas,
      },
      sinModelo: await sinContextoDeModelo(navegador, fixture),
    };
    assert.deepEqual(ofrecidas, esperadas(), 'Las mismas herramientas que el servidor MCP de las fuentes');
    assert.equal(esperado.isError, false);
    assert.equal(obtenido, esperado.content[0]?.text, 'La misma respuesta que el servidor MCP de las fuentes');
    assert.deepEqual(
      resultado.sinModelo.errores.filter((e) => e.startsWith('pageerror') || /herramientas/u.test(e)),
      [],
      'Sin contexto de modelo, ningún error de la página ni de WebMCP',
    );
    for (const [caso, { noEncontradas: rutas }] of Object.entries(resultado)) {
      const sinDeclarar = rutas.filter((ruta) => !SIN_RESPUESTA_EN_PRIVADO.has(ruta));
      assert.deepEqual(sinDeclarar, [], `${caso}: respuestas 404 no declaradas`);
    }
    return resultado;
  } finally {
    await fixture.cerrar();
  }
}

const opciones = argumentos({ 'worker-privado': { type: 'string' } });
const registro = {};
after(() => {
  if (opciones.salida) {
    mkdirSync(opciones.salida, { recursive: true });
    writeFileSync(join(opciones.salida, 'webmcp.json'), `${JSON.stringify(registro, null, 1)}\n`);
  }
});

for (const { nombre, carpeta } of opciones.artefactos) {
  registro.construcciones = { ...registro.construcciones, [nombre]: construccionEnsayada(carpeta) };
  const { artefacto } = await servible(carpeta, opciones['worker-privado']);
  for (const motor of opciones.motores) {
    const titulo = `WebMCP con el paquete ${nombre} en ${motor}: mismas herramientas y misma respuesta que las fuentes`;
    test(titulo, async () => {
      const sesion = await arrancar(motor);
      try {
        registro[`${nombre} · ${motor}`] = await probar(sesion.navegador, artefacto);
      } catch (error) {
        registro[`${nombre} · ${motor}`] = { fallo: String(error).split('\n')[0] };
        throw error;
      } finally {
        await sesion.cerrar();
      }
    });
  }
}
