/**
 * Sin el segundo factor que la instalación exige, la página del panel responde 403 con una página que dice qué ha
 * pasado y qué hacer, con las mismas frases que el panel; nunca un 503 de «no disponible».
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SegundoFactorRequerido } from '../../src/plataforma/acceso-administrativo.ts';
import {
  crearServidorWebAdministrativo,
  POLITICA_WEB_ADMINISTRATIVA,
} from '../../src/plataforma/administracion-web.ts';
import { TEXTOS_ADMINISTRADORES as CA } from '../../web/idiomas/ca/panel-administradores.js';
import { TEXTOS_ADMINISTRADORES as ES } from '../../web/idiomas/es/panel-administradores.js';

const ORIGEN = 'https://panel.example';
const PROHIBIDO = 403;
const responder = crearServidorWebAdministrativo({
  configuracion: { origen: ORIGEN, permitirHttpLocal: false },
  guardiaAdministrativa: async () => {
    throw new SegundoFactorRequerido();
  },
});
const leer = async () => {
  throw new Error('Sin el segundo factor no se lee ningún archivo del panel');
};

test('la página del panel sin segundo factor es un 403 que lo explica en las dos lenguas', async () => {
  const respuesta = await responder(new Request(`${ORIGEN}/administracion/`), leer);
  assert.equal(respuesta.status, PROHIBIDO);
  assert.equal(respuesta.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(respuesta.headers.get('content-security-policy'), POLITICA_WEB_ADMINISTRATIVA);
  assert.equal(respuesta.headers.get('cache-control'), 'no-store');
  const pagina = await respuesta.text();
  for (const textos of [ES, CA]) {
    assert.ok(pagina.includes(textos['panel.administradores.sin-permiso.titulo']));
    assert.ok(pagina.includes(textos['panel.administradores.error.segundo_factor_requerido']));
  }
  assert.doesNotMatch(pagina, /<script|<style|style=/u, 'nada en línea que la CSP rechace');
});

test('una hoja o un módulo del panel sin segundo factor es un 403 sin cuerpo', async () => {
  for (const ruta of ['/administracion/panel.css', '/administracion/panel-estructura.css']) {
    const respuesta = await responder(new Request(`${ORIGEN}${ruta}`), leer);
    assert.equal(respuesta.status, PROHIBIDO, ruta);
    assert.equal(await respuesta.text(), '');
  }
});
