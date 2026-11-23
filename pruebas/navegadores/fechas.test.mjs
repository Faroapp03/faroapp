/**
 * Las fechas y cifras de Faro en Chromium, Firefox y WebKit: el módulo de la web (web/scripts/fechas.js), el de
 * cifras (web/scripts/cifras.js), las cifras del recorrido y el documento del plan escriben en los tres el mismo texto,
 * escrito a mano en fechas-esperadas.ts. La página va en inglés, en árabe de Egipto y en tailandés con calendario budista, en la zona de Auckland, para que nada
 * dependa del idioma, de las cifras, del calendario ni de la hora del equipo.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { chromium, firefox, webkit } from 'playwright-core';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { ESPERADO, escribirCasos } from '../comun/fechas-esperadas.ts';
import { cerrarSinSustituir, conPlazo, lanzarConPlazo, recursosDelCaso } from './recursos-del-caso.mjs';

const WEB = new URL('../../web/', import.meta.url);
const MODULOS = [
  'scripts/fechas.js',
  'scripts/recorrido/formato.js',
  'scripts/recorrido/plan-formacion/textos-documento.js',
  'scripts/cifras.js',
];
const PLAZO_MS = 30_000;
/**
 * Los idiomas de la página: inglés; árabe de Egipto, con cifras arábigo-índicas por defecto; y tailandés con el
 * calendario budista, que cuenta los años desde el 543 a. C. Ninguno puede cambiar el texto de Faro.
 */
const IDIOMAS_DE_LA_PAGINA = ['en-US', 'ar-EG', 'th-TH-u-ca-buddhist'];
/** En Auckland, las 13:30 UTC del 25 de octubre ya son las 02:30 del 26 (horario de verano, +13). */
const HORA_DEL_DISPOSITIVO = { instante: '2026-10-25T13:30:00Z', dia: '2026-10-26', hora: '02:30' };

/** Solo sirve la página vacía y los tres módulos con sus dependencias de la web, en 127.0.0.1. */
function servir() {
  return new Promise((resolver) => {
    const servidor = createServer(async (peticion, respuesta) => {
      const ruta = new URL(peticion.url ?? '/', 'http://127.0.0.1').pathname.slice(1);
      if (ruta === '') {
        respuesta
          .writeHead(ESTADO_HTTP.correcto, { 'content-type': 'text/html; charset=utf-8' })
          .end('<!doctype html><title>Fechas</title>');
        return;
      }
      if (!ruta.startsWith('scripts/') || !ruta.endsWith('.js') || ruta.includes('..')) {
        respuesta.writeHead(ESTADO_HTTP.noEncontrado).end();
        return;
      }
      const cuerpo = await readFile(new URL(ruta, WEB));
      respuesta.writeHead(ESTADO_HTTP.correcto, { 'content-type': 'text/javascript; charset=utf-8' }).end(cuerpo);
    });
    servidor.listen(0, '127.0.0.1', () => resolver(servidor));
  });
}

/** El código que se ejecuta en la página: importa los módulos y escribe todos los casos. */
const EN_LA_PAGINA = `(async () => {
  const [fechas, formato, documento, cifras] = await Promise.all(${JSON.stringify(MODULOS.map((m) => `/${m}`))}.map((ruta) => import(ruta)));
  const local = fechas.partesLocales(${JSON.stringify(HORA_DEL_DISPOSITIVO.instante)});
  return {
    casos: (${escribirCasos.toString()})({ fechas, formato, documento, cifras }, ${JSON.stringify(ESPERADO)}),
    dispositivo: { dia: fechas.fechaIso(local), hora: fechas.horaEscrita(local) },
  };
})()`;

/** @type {import('node:http').Server | undefined} */
let servidor;
before(async () => {
  servidor = await servir();
});
after(() => new Promise((resolver) => (servidor ? servidor.close(() => resolver(undefined)) : resolver(undefined))));

for (const [nombre, motor] of [
  ['chromium', chromium],
  ['firefox', firefox],
  ['webkit', webkit],
]) {
  test(`${nombre}: las fechas y las cifras salen con el texto esperado, igual que en los otros navegadores`, async (t) => {
    const direccion = servidor?.address();
    assert.ok(direccion && typeof direccion === 'object', 'El servidor de la prueba está escuchando');
    const recursos = recursosDelCaso(t);
    const navegador = await lanzarConPlazo(motor, { headless: true }, t.name, { recursos });
    try {
      for (const locale of IDIOMAS_DE_LA_PAGINA) {
        const contexto = await navegador.newContext({ locale, timezoneId: 'Pacific/Auckland' });
        const pagina = await contexto.newPage();
        await conPlazo(pagina.goto(`http://127.0.0.1:${direccion.port}/`), PLAZO_MS, 'la página vacía no se abrió');
        const escrito = await conPlazo(pagina.evaluate(EN_LA_PAGINA), PLAZO_MS, 'la página no escribió los casos');
        assert.deepEqual(escrito.casos, ESPERADO, locale);
        assert.deepEqual(
          escrito.dispositivo,
          { dia: HORA_DEL_DISPOSITIVO.dia, hora: HORA_DEL_DISPOSITIVO.hora },
          locale,
        );
        await contexto.close();
      }
    } finally {
      await cerrarSinSustituir(() => recursos.cerrar(navegador), 'el navegador no se cerró');
    }
  });
}
