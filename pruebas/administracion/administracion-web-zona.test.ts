/**
 * El servidor web del panel sirve lo que la construcción emite para el panel: su página, su hoja de estilo y cada
 * módulo de su zona (administracion/js/), y nada que la construcción no haya producido. Sobre la web construida de
 * estas fuentes (.web-local/, npm run web:preparar).
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ZONA_DEL_PANEL } from '../../herramientas/web/empaquetado/zonas.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { crearServidorWebAdministrativo } from '../../src/plataforma/administracion-web.ts';
import { principalDePrueba } from '../ayudas/principal-panel.ts';
import { webConstruida } from '../ayudas/web-construida.ts';

const ORIGEN = 'https://panel.faro.test';
const responder = crearServidorWebAdministrativo({
  configuracion: { origen: ORIGEN, permitirHttpLocal: false },
  guardiaAdministrativa: async () => principalDePrueba('https://equipo.cloudflareaccess.com', 'persona-sintetica'),
});
const TIPOS: Readonly<Record<string, string>> = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' };

/** El lector del Worker y de Node: los bytes de la web construida, con su tipo, o 404 si no existen. */
async function leer(ruta: string): Promise<Response> {
  try {
    const bytes = readFileSync(join(webConstruida(), ruta));
    const tipo = TIPOS[ruta.slice(ruta.lastIndexOf('.'))] ?? 'application/octet-stream';
    return new Response(bytes, { headers: { 'content-type': tipo } });
  } catch {
    return new Response(null, { status: ESTADO_HTTP.noEncontrado });
  }
}

const pedir = (ruta: string) => responder(new Request(`${ORIGEN}${ruta}`), leer);

test('cada módulo que la construcción emite en la zona del panel se sirve con sus bytes', async () => {
  const zona = join(webConstruida(), ZONA_DEL_PANEL.carpeta);
  const modulos = readdirSync(zona).filter((nombre) => nombre.endsWith('.js'));
  assert.ok(modulos.length > 0, 'La construcción emite módulos del panel');
  const html = readFileSync(join(webConstruida(), 'administracion/index.html'), 'utf8');
  for (const nombre of modulos) {
    const respuesta = await pedir(`/${ZONA_DEL_PANEL.carpeta}/${nombre}`);
    assert.equal(respuesta.status, ESTADO_HTTP.correcto, nombre);
    assert.deepEqual(new Uint8Array(await respuesta.arrayBuffer()), new Uint8Array(readFileSync(join(zona, nombre))));
  }
  for (const [, ruta] of html.matchAll(/(?:src|href)="(\/administracion\/[^"]+)"/g)) {
    assert.equal((await pedir(String(ruta))).status, ESTADO_HTTP.correcto, `index.html carga ${ruta}`);
  }
});

test('lo que la construcción no produjo para el panel no se sirve', async () => {
  for (const ruta of [
    '/administracion/panel.js',
    '/administracion/js/panel.js',
    '/administracion/js/pagina-administracion-index-0000000000000000.js',
    '/administracion/js/../index.html',
    // %2e%2e es «..» para URL: lleva fuera de la zona del panel, a una ruta que no es suya.
    '/administracion/js/%2e%2e/%2e%2e/scripts/confianza.js',
    '/administracion/js/sub/chunk-AAAAAAAA.js',
  ]) {
    const respuesta = await pedir(ruta);
    assert.equal(respuesta.status, ESTADO_HTTP.noEncontrado, ruta);
    await respuesta.body?.cancel();
  }
});
