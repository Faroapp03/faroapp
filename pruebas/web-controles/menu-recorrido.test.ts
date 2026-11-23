import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { EXTENSIONES } from '../../src/plataforma/extensiones.ts';
import type { VarianteRecorrido } from '../../src/plataforma/variantes-recorrido.ts';
import { VARIANTES_INSTALADAS } from '../../web/scripts/variantes-disponibles.js';

const MODULO = new URL('../../web/scripts/menu-recorrido.js', import.meta.url);
class Elemento extends EventTarget {
  href = new URL('../../web/recorrido.html', import.meta.url).href;
  hidden = false;
  attrs = new Map<string, string>();
  textContent = '';
  setAttribute(k: string, v: string) {
    this.attrs.set(k, v);
  }
  removeAttribute(k: string) {
    this.attrs.delete(k);
    if (k === 'href') {
      this.href = '';
    }
  }
  append() {}
}
class Raton extends Event {
  button = 0;
  metaKey = false;
  ctrlKey = false;
  shiftKey = false;
  altKey = false;
}
const enlace = new Elemento();
const menu = new Elemento();
const estado = new Elemento();
const reintentar = new Elemento();
const ventana = new EventTarget();
const documento = Object.assign(new EventTarget(), {
  hidden: false,
  getElementById: () => menu,
  querySelectorAll: () => [enlace],
});
let modo: VarianteRecorrido | 'fallo' = 'real';
/** La primera extensión del registro hace de segundo modo; sin extensiones el menú solo conoce el real. */
const [EXTENSION] = EXTENSIONES;
let destino = '';
for (const [clave, valor] of Object.entries({
  document: documento,
  window: ventana,
  HTMLAnchorElement: Elemento,
  MouseEvent: Raton,
  location: {
    assign: (url: string) => {
      destino = url;
    },
  },
  fetch: async () =>
    modo === 'fallo' ? new Response(null, { status: 503 }) : Response.json({ version: 1, revision: 1, modo }),
  __crearMenu: (tipo: string) => (tipo === 'p' ? estado : reintentar),
})) {
  Object.defineProperty(globalThis, clave, { configurable: true, value: valor });
}
const hooks = registerHooks({
  resolve(especificador, contexto, siguiente) {
    if (contexto.parentURL?.startsWith(MODULO.href)) {
      const fuentes: Record<string, string> = {
        './dom.js': 'export const crear = globalThis.__crearMenu;',
        './idioma.js': 'export const escribir = (e, s) => { e.textContent = s; return e; };',
        './textos.js':
          'export const traducible = (clave) => clave; export const conVersiones = (versiones) => versiones.es;',
      };
      if (Object.hasOwn(fuentes, especificador)) {
        return { url: `data:text/javascript,${encodeURIComponent(fuentes[especificador] ?? '')}`, shortCircuit: true };
      }
    }
    return siguiente(especificador, contexto);
  },
});
const vuelta = () => new Promise<void>((resolver) => setImmediate(resolver));
test('el menú usa el modo confirmado, revalida el clic y falla cerrado ante 503', async () => {
  try {
    const modulo = await import(MODULO.href);
    assert.equal(modulo.esEstadoDelRecorrido({ version: 1, revision: 1, modo: 'real', extra: true }), false);
    modulo.iniciarModoRecorrido();
    await vuelta();
    assert.match(enlace.href, /\/recorrido\.html$/u);
    assert.equal(estado.textContent, 'comun.menu.recorrido.real');
    if (EXTENSION) {
      modo = EXTENSION.id;
      ventana.dispatchEvent(new Event('pageshow'));
      await vuelta();
      assert.ok(enlace.href.endsWith(`/${EXTENSION.entrada}`), enlace.href);
      assert.equal(estado.textContent, VARIANTES_INSTALADAS[EXTENSION.id]?.estado.es);
    }
    modo = 'fallo';
    ventana.dispatchEvent(new Event('online'));
    await vuelta();
    assert.equal(enlace.href, '');
    assert.equal(enlace.attrs.get('aria-disabled'), 'true');
    assert.equal(estado.textContent, 'comun.menu.recorrido.no-disponible');
    assert.equal(reintentar.hidden, false);
    modo = 'real';
    reintentar.dispatchEvent(new Event('click'));
    await vuelta();
    const final = EXTENSION ?? { id: 'real' as const, entrada: 'recorrido.html' };
    modo = final.id;
    enlace.dispatchEvent(new Raton('click', { cancelable: true }));
    await vuelta();
    assert.ok(destino.endsWith(`/${final.entrada}`), destino);
  } finally {
    hooks.deregister();
  }
});
