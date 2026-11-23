// Ensayo remoto manualmente coordinado. El objeto de entrada llega por stdin, nunca por argumentos ni archivos.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, firefox, webkit } from 'playwright-core';
import { entornoParaLanzar } from '../../scripts/entorno-firefox.ts';
import { lanzarConPlazo } from './recursos-del-caso.mjs';
import { errorSinSecretos } from './remoto-ayudas.mjs';
import { probarFormacionUnificada } from './remoto-formacion.mjs';
import { comprobarAutoridadReal, comprobarSitioUnificado } from './remoto-unificado.mjs';

const RUTAS_PANEL = 3;
const HTTP_REDIRECCION = 302;
const HTTP_PROHIBIDO = 403;
const HTTP_NO_ENCONTRADO = 404;
const { values } = parseArgs({ options: { salida: { type: 'string' }, local: { type: 'boolean', default: false } } });
const salida = values.salida ? resolve(values.salida) : await mkdtemp(join(tmpdir(), 'faro-real-privada-remoto-'));
if (values.salida) {
  await mkdir(salida);
}
if (process.stdin.isTTY) {
  throw new Error('Se necesita un conducto privado de entrada.');
}
let entrada = '';
for await (const trozo of process.stdin) {
  entrada += trozo;
}
const datos = JSON.parse(entrada);
entrada = '';
const origen = new URL(datos.origen);
if (values.local) {
  assert.equal(origen.protocol, 'http:');
  assert.equal(origen.hostname, '127.0.0.1');
} else {
  assert.equal(origen.protocol, 'https:');
  assert.ok(origen.hostname.endsWith('.workers.dev'));
}
assert.equal(origen.pathname, '/');
assert.ok(typeof datos.usuario === 'string' && typeof datos.clave === 'string');
const ESTADOS_PANEL = new Set([HTTP_REDIRECCION, HTTP_PROHIBIDO, HTTP_NO_ENCONTRADO]);
assert.ok(Array.isArray(datos.estadosPanel) && datos.estadosPanel.length === RUTAS_PANEL);
assert.ok(
  datos.estadosPanel.every((estado) => ESTADOS_PANEL.has(estado)),
  'Indica el estado exacto esperado de cada ruta del panel',
);
const estadosPanel = datos.estadosPanel;
const credenciales = { username: datos.usuario, password: datos.clave, origin: origen.origin };
const secretos = [datos.usuario, datos.clave, Buffer.from(`${datos.usuario}:${datos.clave}`).toString('base64')];
delete datos.usuario;
delete datos.clave;
const identidad = JSON.parse(await readFile(new URL('../../config/identidad-web.json', import.meta.url))).identidad;
const HTTP_OK = 200;
const HTTP_ERROR = 400;
const rapido = '#sugerencias:not([hidden]) .rc-sugerencia:not([disabled]):visible';
const seleccion = `.rc-eleccion-acciones > button.rc-boton-principal:not([disabled]):visible, .rc-acciones > button.rc-boton-principal[type="submit"]:not([disabled]):visible, ${rapido}`;
const perfiles = [
  { es: 'Soy conductor de autobús urbano', ca: 'Sóc conductor d’autobús urbà', grupo: '8331' },
  { es: 'Soy cocinero de restaurante', ca: 'Sóc cuiner de restaurant', grupo: '5120' },
];
const resultados = [];
for (const [nombre, tipo] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await lanzarConPlazo(tipo, { headless: true, env: entornoParaLanzar() }, 'real-privada-remoto.mjs');
  try {
    const previo = await browser.newContext({
      httpCredentials: credenciales,
      userAgent: identidad['User-Agent'],
      extraHTTPHeaders: {
        'sec-ch-ua': identidad['sec-ch-ua'],
        'sec-ch-ua-mobile': identidad['sec-ch-ua-mobile'],
        'sec-ch-ua-platform': identidad['sec-ch-ua-platform'],
      },
    });
    try {
      await previo.route('**/*', (ruta) =>
        new URL(ruta.request().url()).origin === origen.origin ? ruta.continue() : ruta.abort(),
      );
      const unificado = await comprobarSitioUnificado(previo, origen);
      const autorizado = await comprobarAutoridadReal(previo, origen, estadosPanel);
      resultados.push({
        motor: nombre,
        caso: 'autoridad-y-panel-real',
        correcto: true,
        ...unificado,
        revision: autorizado.revision,
      });
    } catch (error) {
      resultados.push({
        motor: nombre,
        caso: 'autoridad-y-panel-real',
        correcto: false,
        diagnostico: errorSinSecretos(error, secretos),
      });
      continue;
    } finally {
      await previo.close();
    }
    for (const idioma of ['es', 'ca']) {
      for (const perfil of perfiles) {
        const observacion = { errores: 0, terceros: 0, httpErrores: 0, solicitudesMotor: 0 };
        const contexto = await browser.newContext({
          httpCredentials: credenciales,
          userAgent: identidad['User-Agent'],
          extraHTTPHeaders: {
            'sec-ch-ua': identidad['sec-ch-ua'],
            'sec-ch-ua-mobile': identidad['sec-ch-ua-mobile'],
            'sec-ch-ua-platform': identidad['sec-ch-ua-platform'],
          },
          locale: idioma,
          viewport: { width: 390, height: 844 },
        });
        let etapa = 'preparación';
        try {
          await contexto.route('**/*', (ruta) =>
            new URL(ruta.request().url()).origin === origen.origin ? ruta.continue() : ruta.abort(),
          );
          contexto.on('request', (r) => {
            const u = new URL(r.url());
            if (u.origin !== origen.origin) {
              observacion.terceros++;
            }
            if (u.pathname.includes('/motor/')) {
              observacion.solicitudesMotor++;
            }
          });
          contexto.on('response', (r) => {
            if (r.status() >= HTTP_ERROR) {
              observacion.httpErrores++;
            }
          });
          const pagina = await contexto.newPage();
          pagina.on('pageerror', () => observacion.errores++);
          pagina.on('console', (m) => {
            if (m.type() === 'error') {
              observacion.errores++;
            }
          });
          await pagina.addInitScript((idiomaElegido) => {
            localStorage.setItem('faro-idioma', idiomaElegido);
            localStorage.setItem('faro-modo-elegido', 'ia-off');
          }, idioma);
          etapa = 'abrir recorrido';
          const respuesta = await pagina.goto(new URL('/recorrido.html', origen).href);
          assert.equal(respuesta?.status(), HTTP_OK);
          await pagina.waitForFunction((i) => document.documentElement.lang === i, idioma);
          await pagina.locator('#conversacion .rc-mensaje').first().waitFor();
          await pagina.locator('#mensaje').fill(perfil[idioma]);
          await pagina.locator('#mensaje').press('Enter');
          etapa = 'elegir ocupación';
          let eleccion = '';
          for (let vuelta = 0; vuelta < 10; vuelta++) {
            if ((await pagina.locator('.rc-cuerpo').getAttribute('data-paso')) === '3') {
              break;
            }
            const boton = pagina.locator(seleccion).first();
            await pagina
              .locator(`${seleccion}, .rc-cuerpo[data-paso="3"]`)
              .first()
              .waitFor({ state: 'visible', timeout: 120000 });
            if ((await pagina.locator('.rc-cuerpo').getAttribute('data-paso')) === '3') {
              break;
            }
            const escogida = await boton.evaluate(
              (b) =>
                b
                  .closest('.rc-eleccion-bloque')
                  ?.querySelector('.rc-eleccion-casilla:checked')
                  ?.closest('.rc-eleccion-opcion')?.textContent || '',
            );
            if (escogida) {
              eleccion = escogida;
            }
            await boton.click();
          }
          assert.ok(eleccion.includes(perfil.grupo), 'Debe elegir el grupo solicitado');
          assert.match(eleccion, new RegExp(`ESCO ${perfil.grupo}\\.\\d+`), 'Debe elegir una ocupación ESCO');
          await pagina.waitForFunction(() => document.querySelector('.rc-cuerpo')?.getAttribute('data-paso') === '3');
          etapa = 'tareas';
          const tareas = pagina.locator('#bloques-oficiales input[type=checkbox]');
          await tareas.first().waitFor();
          await tareas.nth(0).check();
          await tareas.nth(1).check();
          for (const fila of await pagina.locator('[data-tarea]:visible').all()) {
            await fila.locator('input[type=radio][value="mucho"]').check();
          }
          await pagina.locator('#form-tareas [type=submit]').click();
          etapa = 'informe';
          await pagina
            .locator(rapido)
            .filter({ hasText: idioma === 'es' ? 'Ahora no, solo el informe' : 'Ara no, només l’informe' })
            .click();
          const leer = pagina.locator('#conversacion .rc-documento a.rc-boton-principal');
          await leer.waitFor({ timeout: 120000 });
          await leer.click();
          await pagina.locator('#informe [data-titulo-pdf]').waitFor();
          etapa = 'captura e impresión';
          const nombreCaso = `${nombre}-${idioma}-${perfiles.indexOf(perfil) + 1}`;
          await pagina.evaluate(() => document.fonts.ready);
          await pagina.screenshot({ path: join(salida, `${nombreCaso}.png`), fullPage: true });
          if (nombre === 'chromium') {
            await pagina.evaluate(() => {
              window.__faroImpresiones = 0;
              window.print = () => {
                window.__faroImpresiones += 1;
              };
            });
            await pagina.locator('#informe #imprimir').click();
            assert.equal(await pagina.evaluate(() => window.__faroImpresiones), 1);
            await pagina.emulateMedia({ media: 'print' });
            await pagina.pdf({ path: join(salida, `${nombreCaso}.pdf`), format: 'A4', printBackground: true });
            await pagina.emulateMedia({ media: null });
          }
          etapa = 'reflujo y guardias';
          const reflujo = await pagina.evaluate(() => ({
            ancho: document.documentElement.clientWidth,
            contenido: document.documentElement.scrollWidth,
          }));
          assert.ok(reflujo.contenido <= reflujo.ancho + 1);
          assert.ok(observacion.solicitudesMotor > 0);
          assert.deepEqual([observacion.errores, observacion.terceros, observacion.httpErrores], [0, 0, 0]);
          resultados.push({
            motor: nombre,
            idioma,
            perfil: perfiles.indexOf(perfil) + 1,
            correcto: true,
            observacion,
            reflujo,
            eleccionSha256: createHash('sha256').update(eleccion).digest('hex'),
          });
        } catch (error) {
          resultados.push({
            motor: nombre,
            idioma,
            perfil: perfiles.indexOf(perfil) + 1,
            correcto: false,
            etapa,
            diagnostico: errorSinSecretos(error, secretos),
            observacion,
          });
        } finally {
          await contexto.close();
        }
      }
    }
    for (const idioma of ['es', 'ca']) {
      const contexto = await browser.newContext({
        httpCredentials: credenciales,
        userAgent: identidad['User-Agent'],
        extraHTTPHeaders: {
          'sec-ch-ua': identidad['sec-ch-ua'],
          'sec-ch-ua-mobile': identidad['sec-ch-ua-mobile'],
          'sec-ch-ua-platform': identidad['sec-ch-ua-platform'],
        },
        locale: idioma,
        viewport: { width: 1280, height: 900 },
      });
      try {
        await contexto.route('**/*', (ruta) =>
          new URL(ruta.request().url()).origin === origen.origin ? ruta.continue() : ruta.abort(),
        );
        const formacion = await probarFormacionUnificada({
          contexto,
          origen,
          idioma,
          salida,
          nombre: `${nombre}-${idioma}-formacion`,
        });
        resultados.push({ motor: nombre, idioma, caso: 'formacion', correcto: true, formacion });
      } catch (error) {
        resultados.push({
          motor: nombre,
          idioma,
          caso: 'formacion',
          correcto: false,
          diagnostico: errorSinSecretos(error, secretos),
        });
      } finally {
        await contexto.close();
      }
    }
  } finally {
    await browser.close();
  }
}
for (const nombre of ['chromium', 'firefox', 'webkit']) {
  for (const idioma of ['es', 'ca']) {
    const pareja = resultados.filter((r) => r.motor === nombre && r.idioma === idioma && typeof r.perfil === 'number');
    if (
      pareja.length === 2 &&
      pareja.every((r) => r.correcto) &&
      pareja[0].eleccionSha256 === pareja[1].eleccionSha256
    ) {
      pareja[1].correcto = false;
      pareja[1].etapa = 'ocupaciones indistinguibles';
    }
  }
}
await writeFile(
  join(salida, 'resultado.json'),
  JSON.stringify(
    {
      transporte: values.local ? 'Miniflare con proxy HTTP loopback; Worker recibe HTTPS simulado' : 'HTTPS remoto',
      estadosPanel,
      resultados,
    },
    null,
    2,
  ),
  { flag: 'wx' },
);
if (resultados.some((r) => !r.correcto)) {
  process.exitCode = 1;
}
