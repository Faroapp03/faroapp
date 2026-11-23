// Humo de datos en un solo motor (Chromium): con el paquete de la web local construida, el catálogo de Cursos pinta
// sus tarjetas con el número de cursos vigentes que dice el catálogo, la búsqueda filtra y el informe de ejemplo se
// abre, todo sin errores de consola ni excepciones. Lo ejecuta el ciclo diario (scripts/verificar-datos.ts) para que un
// dato que cumple su contrato pero rompe la pantalla no se publique; la batería de navegador completa, en tres
// motores, sigue siendo la de publicar. Sirve la web el servidor local del producto, con sus rutas, sus cabeceras y
// su CSP: una página a la que le falta lo que responde el servidor se queda oculta, y eso no sería una prueba.

import { strict as assert } from 'node:assert';
import { type ChildProcess, spawn } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { type BrowserContext, chromium, type Page } from 'playwright-core';
import type { EntregaCatalogo } from '../../src/catalogo-cursos/contrato.ts';
import { webConstruida } from '../ayudas/web-construida.ts';
import { cerrarSinSustituir, lanzarConPlazo, recursosDelCaso } from '../navegadores/recursos-del-caso.mjs';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const SERVIDOR = 'herramientas/servidor/servidor-local.ts';
const ANFITRION = '127.0.0.1';
/** Un puerto alto propio de este proceso, para que dos ejecuciones a la vez no choquen. */
const PUERTO_BASE = 41_000;
const PUERTOS = 1000;
const PUERTO = PUERTO_BASE + (process.pid % PUERTOS);
const ORIGEN = `http://${ANFITRION}:${PUERTO}`;
/** La línea con la que el servidor dice que ya escucha. */
const LISTO = `Faro en ${ORIGEN}`;
const PLAZO_ARRANQUE_MS = 60_000;
const PLAZO_PINTADO_MS = 30_000;
const POR_PAGINA = 20;
/** Una palabra de al menos cinco letras del primer título: lo bastante concreta para filtrar. */
const LETRAS_DE_LA_BUSQUEDA = 5;

/** El catálogo publicado en la web construida: el único archivo de datos/catalogo-cursos/. */
function catalogoPublicado(): EntregaCatalogo {
  const carpeta = join(webConstruida(), 'datos/catalogo-cursos');
  const [archivo, ...otros] = readdirSync(carpeta).filter((nombre) => nombre.endsWith('.json'));
  assert.ok(archivo && otros.length === 0, 'La web construida publica un único catálogo de Cursos');
  return JSON.parse(readFileSync(join(carpeta, archivo), 'utf8')) as EntregaCatalogo;
}

/** Las ofertas vigentes en un instante: sin límite o con el límite aún por llegar, como cuenta la página. */
function vigentes(catalogo: EntregaCatalogo, ahora: number): number {
  return catalogo.ofertas.filter((o) => o.cierra_el === null || ahora < Date.parse(o.cierra_el)).length;
}

/** Arranca el servidor local del producto y espera a que diga que escucha; si no lo dice, falla con lo que escribió. */
async function arrancarServidor(): Promise<ChildProcess> {
  const servidor = spawn(process.execPath, [SERVIDOR], {
    cwd: RAIZ,
    env: { ...process.env, FARO_PUERTO: String(PUERTO) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let escrito = '';
  await new Promise<void>((listo, fallo) => {
    const plazo = setTimeout(
      () => fallo(new Error(`El servidor local no arrancó a tiempo: ${escrito}`)),
      PLAZO_ARRANQUE_MS,
    );
    const leer = (trozo: Buffer) => {
      escrito += trozo.toString('utf8');
      if (escrito.includes(LISTO)) {
        clearTimeout(plazo);
        listo();
      }
    };
    servidor.stdout?.on('data', leer);
    servidor.stderr?.on('data', leer);
    servidor.once('exit', (codigo) => {
      clearTimeout(plazo);
      fallo(new Error(`El servidor local terminó con código ${codigo}: ${escrito}`));
    });
  });
  return servidor;
}

/** Para el servidor y espera a que termine, para que la prueba no deje procesos. */
async function pararServidor(servidor: ChildProcess): Promise<void> {
  if (servidor.exitCode !== null) {
    return;
  }
  await new Promise<void>((terminado) => {
    servidor.once('exit', () => terminado());
    servidor.kill('SIGTERM');
  });
}

/** Lo que no es del servidor local se corta: el humo no sale a la red. */
async function soloElServidorLocal(contexto: BrowserContext): Promise<void> {
  await contexto.route('**/*', (ruta) =>
    new URL(ruta.request().url()).origin === ORIGEN ? ruta.continue() : ruta.abort('blockedbyclient'),
  );
}

/** Abre una página y devuelve los errores de consola y las excepciones que deje. */
async function abrir(contexto: BrowserContext, ruta: string): Promise<{ pagina: Page; errores: string[] }> {
  const pagina = await contexto.newPage();
  const errores: string[] = [];
  pagina.on('console', (mensaje) => {
    if (mensaje.type() === 'error') {
      errores.push(`${ruta}: ${mensaje.text()}`);
    }
  });
  pagina.on('pageerror', (error) => errores.push(`${ruta}: ${error.message}`));
  await pagina.goto(`${ORIGEN}${ruta}`, { waitUntil: 'load' });
  return { pagina, errores };
}

/** El número que encabeza un texto («789 cursos», «3 de 789 cursos»). */
function numeros(texto: string): number[] {
  return [...texto.replace(/[.\s](?=\d{3}\b)/gu, '').matchAll(/\d+/gu)].map(([n]) => Number(n));
}

async function conChromium(t: TestContext, uso: (contexto: BrowserContext) => Promise<void>): Promise<void> {
  const servidor = await arrancarServidor();
  try {
    const recursos = recursosDelCaso(t);
    const navegador = await lanzarConPlazo(chromium, { headless: true }, t.name, { recursos });
    try {
      const contexto = await navegador.newContext({
        serviceWorkers: 'block',
        locale: 'es-ES',
        reducedMotion: 'reduce',
      });
      await soloElServidorLocal(contexto);
      await uso(contexto);
    } finally {
      await cerrarSinSustituir(() => recursos.cerrar(navegador), 'el navegador no se cerró');
    }
  } finally {
    await pararServidor(servidor);
  }
}

test('Chromium: Cursos pinta los cursos vigentes del catálogo, la búsqueda filtra y no hay errores', async (t) => {
  const catalogo = catalogoPublicado();
  await conChromium(t, async (contexto) => {
    const antes = vigentes(catalogo, Date.now());
    const { pagina, errores } = await abrir(contexto, '/cursos.html');
    await pagina.waitForFunction(
      () => /\d/u.test(document.querySelector('[data-recuento]')?.textContent ?? ''),
      undefined,
      { timeout: PLAZO_PINTADO_MS },
    );
    const despues = vigentes(catalogo, Date.now());
    const [total] = numeros((await pagina.textContent('[data-recuento]')) ?? '');
    assert.ok(total === antes || total === despues, `Cursos dice ${total} y el catálogo tiene ${antes} vigentes`);
    assert.ok(antes > 0, 'El catálogo publicado tiene cursos vigentes');
    const tarjetas = pagina.locator('[data-lista] > li');
    assert.equal(await tarjetas.count(), Math.min(POR_PAGINA, antes), 'La primera página de tarjetas');
    // El texto tal como se ve, con sus separaciones: el del documento junta las etiquetas con el título.
    const primera = (await tarjetas.first().innerText()).trim();
    assert.ok(primera.length > 0, 'La primera tarjeta tiene texto');
    // Una búsqueda con una palabra del primer título deja al menos ese curso y dice cuántos de cuántos.
    const palabra = primera.split(/\s+/u).find((p) => p.length >= LETRAS_DE_LA_BUSQUEDA) ?? primera;
    await pagina.fill('#cursos-consulta', palabra);
    await pagina.waitForFunction(
      (n) => (document.querySelector('[data-recuento]')?.textContent?.match(/\d+/gu) ?? []).length === n,
      2,
      { timeout: PLAZO_PINTADO_MS },
    );
    const [vistas = 0, deTotal] = numeros((await pagina.textContent('[data-recuento]')) ?? '');
    assert.ok(
      vistas >= 1 && vistas <= antes && deTotal === total,
      `La búsqueda «${palabra}» da ${vistas} de ${deTotal}`,
    );
    assert.deepEqual(errores, [], 'Cursos sin errores de consola ni excepciones');
  });
});

test('Chromium: el informe de ejemplo se abre con sus datos y sin errores', async (t) => {
  await conChromium(t, async (contexto) => {
    const { pagina, errores } = await abrir(contexto, '/informe-ejemplo.html');
    await pagina.waitForLoadState('networkidle');
    const texto = ((await pagina.textContent('main')) ?? '').trim();
    assert.ok(texto.length > 0, 'El informe de ejemplo tiene contenido');
    assert.deepEqual(errores, [], 'El informe de ejemplo sin errores de consola ni excepciones');
  });
});
