import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { TEXTOS_RECORRIDO as CA } from '../../web/idiomas/ca/recorrido.js';
import { TEXTOS_RECORRIDO as ES } from '../../web/idiomas/es/recorrido.js';

const html = readFileSync(new URL('../../web/recorrido.html', import.meta.url), 'utf8');
const avisos = [...html.matchAll(/<p\b[^>]*data-texto="(recorrido\.privacidad\.[\w-]+)"[^>]*>([\s\S]*?)<\/p\s*>/gu)];
const textoPlano = (texto: string) =>
  texto
    .replace(/<[^>]*>/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
const modeloRetirado = /\bIA\s+(?:ON|OFF)\b|proveedor|proveïdor/iu;

test('el aviso inicial de privacidad describe el sistema de IA sin un proveedor externo', () => {
  assert.ok(avisos.length >= 2, 'el HTML inicial conserva el aviso y su explicación');
  for (const aviso of avisos) {
    assert.doesNotMatch(textoPlano(aviso[2] ?? ''), modeloRetirado);
    assert.doesNotMatch(aviso[2] ?? '', /data-proveedor-ia/u);
  }
});

for (const [idioma, diccionario] of [
  ['es', ES],
  ['ca', CA],
] as const) {
  test(`el idioma ${idioma} no repone el aviso de un proveedor retirado`, () => {
    for (const aviso of avisos) {
      const clave = aviso[1] ?? '';
      const texto = diccionario[clave];
      assert.ok(texto, clave);
      assert.doesNotMatch(texto, modeloRetirado, clave);
      if (idioma === 'es') {
        assert.equal(textoPlano(aviso[2] ?? ''), textoPlano(texto), clave);
      }
    }
  });
}
