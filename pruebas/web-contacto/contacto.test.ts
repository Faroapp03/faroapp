import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CONTACTO_PUBLICO, leerContactoPublico } from '../../compartido/contacto-publico.js';
import { enlaceDeCorreo, prepararContacto } from '../../web/scripts/contacto.js';

const CONFIGURADO = { responsable: '<Entidad & pública>', correo: 'contacto@example.test' };
test('la entrega no inventa responsable ni correo y no acepta datos que alteren el enlace', () => {
  assert.deepEqual(CONTACTO_PUBLICO, { responsable: '', correo: '' });
  for (const correo of [
    ' a@example.test',
    'a@example.test\r\nBcc:x@example.test',
    'sin-correo',
    'a@example.test?body=x',
    'a@a..b.test',
    'a@-a.b.test',
    'a@a-.b.test',
  ]) {
    assert.throws(() => leerContactoPublico({ responsable: '', correo }), TypeError);
  }
  assert.throws(() => leerContactoPublico({ ...CONFIGURADO, secreto: 'no público' }), TypeError);
  assert.equal(enlaceDeCorreo(''), null);
});

test('el correo manual conserva destino y cuerpo como componentes, sin cabeceras inyectadas', () => {
  const direccion = enlaceDeCorreo(CONFIGURADO.correo, {
    asunto: 'Comprobación + ayuda',
    cuerpo: 'Texto\n&subject=otro',
  });
  assert.ok(direccion);
  assert.ok(direccion.includes('subject=Comprobaci%C3%B3n%20%2B%20ayuda'));
  assert.ok(!direccion.includes('+'), 'el enlace no serializa espacios como +');
  const url = new URL(direccion);
  assert.equal(decodeURIComponent(url.pathname), CONFIGURADO.correo);
  assert.equal(url.searchParams.get('subject'), 'Comprobación + ayuda');
  assert.equal(url.searchParams.get('body'), 'Texto\n&subject=otro');
  assert.equal([...url.searchParams].length, 2);
});

class Elemento {
  hidden = false;
  textContent = '';
  href = '';
  hijos: Elemento[] = [];
  atributos = new Map<string, string>();
  ownerDocument = { createElement: () => new Elemento() };
  getAttribute(clave: string) {
    return this.atributos.get(clave) ?? null;
  }
  replaceChildren() {
    this.hijos = [];
  }
  append(hijo: Elemento) {
    this.hijos.push(hijo);
  }
}

test('configurado muestra texto y enlace; vaciarlo retira enlaces y oculta identidad, sin almacén ni red', (t) => {
  const anterior = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement');
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: Elemento });
  t.after(() => {
    if (anterior) {
      Object.defineProperty(globalThis, 'HTMLElement', anterior);
    } else {
      Reflect.deleteProperty(globalThis, 'HTMLElement');
    }
  });
  const responsable = new Elemento();
  const correo = new Elemento();
  const contenedor = new Elemento();
  contenedor.atributos.set('data-contacto-solo', 'correo');
  const ausencia = new Elemento();
  const consultas = new Map([
    ['[data-contacto-responsable]', [responsable]],
    ['[data-contacto-correo]', [correo]],
    ['[data-contacto-solo]', [contenedor]],
    ['[data-contacto-sin-correo]', [ausencia]],
  ]);
  const raiz = { querySelectorAll: (selector: string) => consultas.get(selector) ?? [] } as unknown as ParentNode;
  prepararContacto(raiz, CONFIGURADO);
  assert.equal(responsable.textContent, CONFIGURADO.responsable);
  assert.equal(contenedor.hidden, false);
  assert.equal(ausencia.hidden, true);
  assert.equal(correo.hijos[0]?.textContent, CONFIGURADO.correo);
  assert.equal(correo.hijos[0]?.href, enlaceDeCorreo(CONFIGURADO.correo));
  prepararContacto(raiz, CONTACTO_PUBLICO);
  assert.equal(responsable.hidden, true);
  assert.equal(responsable.textContent, '');
  assert.equal(correo.hijos.length, 0);
  assert.equal(contenedor.hidden, true);
  assert.equal(ausencia.hidden, false);
});

test('los consumidores públicos usan marcadores comunes y no contienen el contacto anterior', () => {
  for (const pagina of ['accesibilidad.html', 'informacion-y-creditos.html', 'doctor.html']) {
    const html = readFileSync(new URL(`../../web/${pagina}`, import.meta.url), 'utf8');
    assert.doesNotMatch(html, /href="mailto:/u);
    assert.match(html, /data-contacto-correo/u);
  }
});
