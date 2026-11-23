import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { comprobarPagina } from '../../herramientas/web/paginas.ts';
import ca from '../../web/idiomas/ca.js';
import es from '../../web/idiomas/es.js';

const SERVICIOS = 3;
const WEB = new URL('../../web/', import.meta.url);
const pagina = (nombre: string) => readFileSync(new URL(nombre, WEB), 'utf8');

test('estado público con estructura común, sin luces de apagado ni URL supuesta en el HTML', () => {
  const html = pagina('conectividad.html');
  assert.deepEqual(comprobarPagina('conectividad.html', html), []);
  assert.equal((html.match(/class="conectividad-luz" aria-hidden="true" hidden/gu) ?? []).length, SERVICIOS);
  assert.doesNotMatch(html, /class="[^"]*conectividad-(?:activa|inactiva)/u);
  assert.match(html, /que-es-faro\.html#conectividad/u);
  assert.match(html, /class="pie"/u);
  assert.match(html, /estilos\/tokens\.css/u);
});

test('solo la etapa enlaza al estado y permite ver la dirección con independencia del estado', () => {
  const html = pagina('que-es-faro.html');
  assert.match(html, /id="mcp-direccion-bloque"/u);
  assert.doesNotMatch(html, /id="mcp-direccion-bloque" hidden/u);
  const direccion = html.match(/<input\b[^>]*id="mcp-direccion"[^>]*>/u)?.[0];
  assert.ok(direccion);
  assert.doesNotMatch(direccion, /\bvalue=/u);
  for (const nombre of readdirSync(WEB).filter((n) => n.endsWith('.html') && n !== 'que-es-faro.html')) {
    const otro = pagina(nombre);
    assert.doesNotMatch(otro, /href="conectividad\.html"/u, nombre);
  }
});

test('los textos de la nueva página y etapa existen en ES/CA con los mismos marcadores', () => {
  for (const html of [pagina('conectividad.html'), pagina('que-es-faro.html'), pagina('activar-acceso.html')]) {
    for (const [, clave = ''] of html.matchAll(/data-texto(?:-[a-z-]+)?="([^"]+)"/gu)) {
      assert.ok(es[clave] && ca[clave], clave);
      const marcas = (texto: string) => texto.match(/\{\w+\}/gu)?.sort() ?? [];
      assert.deepEqual(marcas(es[clave] ?? ''), marcas(ca[clave] ?? ''), clave);
    }
  }
  assert.match(es['conectividad.privacidad'] ?? '', /No guarda el contenido ni los argumentos/u);
  assert.match(es['conectividad.privacidad'] ?? '', /recuento diario/u);
});

test('activación común sin secreto en HTML, formulario de altas ni enlaces externos', () => {
  const html = pagina('activar-acceso.html');
  assert.deepEqual(comprobarPagina('activar-acceso.html', html), []);
  assert.match(html, /<meta name="referrer" content="no-referrer"/u);
  assert.match(html, /scripts\/activar-acceso\.js/u);
  assert.match(html, /id="activacion-credenciales"[^>]*hidden/u);
  for (const id of ['activacion-cliente', 'activacion-secreto']) {
    const campo = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`, 'u'))?.[0];
    assert.ok(campo);
    assert.doesNotMatch(campo, /\bvalue=/u);
    assert.match(campo, /autocomplete="off"/u);
  }
  assert.doesNotMatch(html, /<form|turnstile|href="https?:/u);
  const guion = readFileSync(new URL('scripts/activar-acceso.js', WEB), 'utf8');
  assert.ok(guion.indexOf("from './conectividad/fragmento.js'") < guion.indexOf("import './sitio.js'"));
});
