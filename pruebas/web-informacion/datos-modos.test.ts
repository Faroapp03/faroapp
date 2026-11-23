import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { TEXTOS_PAGINAS as ca } from '../../web/idiomas/ca/paginas.js';
import { TEXTOS_PAGINAS as es } from '../../web/idiomas/es/paginas.js';

const html = readFileSync(new URL('../../web/informacion-y-creditos.html', import.meta.url), 'utf8');

test('la privacidad inicial es visible sin JavaScript y no ofrece un proveedor ni elección de modo', () => {
  assert.doesNotMatch(html, /data-modos=|data-proveedor-ia|data-interruptor-modo|src="scripts\/datos-segun-modo\.js"/);
  const parrafo = html.match(/<li\b[^>]*data-texto="informacion-y-creditos\.datos\.local"[^>]*>([\s\S]*?)<\/li\s*>/);
  assert.ok(parrafo);
  assert.doesNotMatch(parrafo[0], /\bhidden\b/);
  assert.equal(parrafo[1]?.replace(/\s+/g, ' ').trim(), es['informacion-y-creditos.datos.local']);
});

test('ambos idiomas distinguen filtro reconocido de garantía absoluta y no anuncian un modo externo', () => {
  for (const diccionario of [es, ca]) {
    const local = diccionario['informacion-y-creditos.datos.local'];
    assert.ok(local);
    assert.doesNotMatch(local, /IA ON|IA OFF|proveedor|proveïdor/);
    assert.match(local, /reconoce|reconeix/);
    assert.equal(diccionario['comun.modo.on'], undefined);
    assert.equal(diccionario['informacion-y-creditos.datos.3'], undefined);
    assert.equal(diccionario['informacion-y-creditos.datos.4'], undefined);
  }
});

test('la explicación de almacenamiento no presenta preferencias de modo como configuración', () => {
  for (const diccionario of [es, ca]) {
    const texto = diccionario['informacion-y-creditos.datos.2'];
    assert.ok(texto);
    assert.doesNotMatch(texto, /IA ON|IA OFF|los modos|els modes|cuatro cosas|quatre coses/);
  }
});
