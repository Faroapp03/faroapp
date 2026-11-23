import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HtmlNoAdmitido, htmlDeConfianza } from '../../web/scripts/confianza.js';

for (const valor of [undefined, null, false, 0, [], {}, new String('<p>texto</p>')]) {
  test(`HTML exige texto primitivo: ${Object.prototype.toString.call(valor)}`, () => {
    assert.throws(() => htmlDeConfianza(valor), HtmlNoAdmitido);
  });
}

test('no convierte objetos antes de rechazarlos, con y sin Trusted Types', async (contexto) => {
  let conversiones = 0;
  const objeto = {
    toString() {
      conversiones++;
      return '<img src="x" onerror="alert(1)">';
    },
  };
  assert.throws(() => htmlDeConfianza(objeto), HtmlNoAdmitido);
  let llamadas = 0;
  const anterior = Object.getOwnPropertyDescriptor(globalThis, 'trustedTypes');
  contexto.after(() => {
    if (anterior) {
      Object.defineProperty(globalThis, 'trustedTypes', anterior);
    } else {
      Reflect.deleteProperty(globalThis, 'trustedTypes');
    }
  });
  Object.defineProperty(globalThis, 'trustedTypes', {
    configurable: true,
    value: {
      /** @param {string} _nombre @param {Record<string, (texto: string) => string>} reglas */
      createPolicy(_nombre, reglas) {
        return {
          /** @param {unknown} valor */
          createHTML(valor) {
            llamadas++;
            return { html: reglas.createHTML?.(String(valor)) };
          },
          /** @param {unknown} valor */
          createScriptURL(valor) {
            return { url: reglas.createScriptURL?.(String(valor)) };
          },
        };
      },
    },
  });
  const direccion = new URL('../../web/scripts/confianza.js?trusted-types', import.meta.url);
  const conPolitica = /** @type {typeof import('../../web/scripts/confianza.js')} */ (await import(direccion.href));
  assert.throws(() => conPolitica.htmlDeConfianza(objeto), HtmlNoAdmitido);
  assert.equal(conversiones, 0);
  assert.equal(llamadas, 0);
  assert.deepEqual(conPolitica.htmlDeConfianza('<p>texto</p>'), { html: '<p>texto</p>' });
  assert.equal(llamadas, 1);
});
