import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

const MODULO = new URL('../../web/scripts/salir-portal.js', import.meta.url);
const INTENTOS = 3;
class Elemento extends EventTarget {
  className = '';
  hidden = false;
  disabled = false;
  textContent = '';
  atributos = new Map<string, string>();
  setAttribute(nombre: string, valor: string) {
    this.atributos.set(nombre, valor);
  }
}
const elementos: Elemento[] = [];
const menu = {
  querySelector: (clase: string) => elementos.find((e) => `.${e.className.split(' ').at(-1)}` === clase) ?? null,
  append: (...partes: Elemento[]) => elementos.push(...partes),
};
let señal = 'ausente';
let salida = 'error';
let destino = '';
const peticiones: { ruta: string; opciones: RequestInit }[] = [];
Object.defineProperties(globalThis, {
  document: { configurable: true, value: { getElementById: () => menu } },
  location: {
    configurable: true,
    value: {
      origin: 'https://ejemplo.invalid',
      assign: (v: string) => {
        destino = v;
      },
    },
  },
  fetch: {
    configurable: true,
    value: async (url: string | URL, opciones: RequestInit) => {
      const ruta = new URL(url).pathname;
      peticiones.push({ ruta, opciones });
      if (ruta.endsWith('/estado')) {
        if (señal === 'invalida') {
          return Response.json({ portal: true, adicional: true });
        }
        if (señal === 'fallo') {
          throw new TypeError('Sin conexión');
        }
        return señal === 'activa' ? Response.json({ portal: true }) : new Response(null, { status: 404 });
      }
      if (salida === 'error') {
        return new Response(null, { status: 503 });
      }
      return Response.json({ ok: salida === 'correcta' });
    },
  },
});
const hooks = registerHooks({
  resolve(especificador, contexto, siguiente) {
    if (contexto.parentURL?.startsWith(MODULO.href)) {
      const fuentes: Record<string, string> = {
        './dom.js': 'export const crear = (_, p = {}) => Object.assign(globalThis.__elemento(), p);',
        './idioma.js': 'export const escribir = (e, s) => { e.textContent = s; return e; };',
        './textos.js': 'export const traducible = (clave) => clave;',
      };
      if (Object.hasOwn(fuentes, especificador)) {
        return { url: `data:text/javascript,${encodeURIComponent(fuentes[especificador] ?? '')}`, shortCircuit: true };
      }
    }
    return siguiente(especificador, contexto);
  },
});
Object.defineProperty(globalThis, '__elemento', { configurable: true, value: () => new Elemento() });
const vuelta = () => new Promise<void>((resolver) => setImmediate(resolver));

test('Salir solo aparece con portal confirmado; falla visible y solo navega tras confirmación', async () => {
  try {
    const modulo = await import(MODULO.href);
    await modulo.iniciarSalirPortal();
    assert.equal(elementos.length, 0);
    señal = 'invalida';
    await modulo.iniciarSalirPortal();
    señal = 'fallo';
    await modulo.iniciarSalirPortal();
    assert.equal(elementos.length, 0);
    señal = 'activa';
    await modulo.iniciarSalirPortal();
    await modulo.iniciarSalirPortal();
    assert.equal(elementos.length, 2);
    const boton = elementos[0];
    const aviso = elementos[1];
    assert.ok(boton && aviso);
    assert.equal(boton.textContent, 'comun.menu.salir');
    assert.equal(aviso.hidden, true);
    boton.dispatchEvent(new Event('click'));
    await vuelta();
    assert.equal(destino, '');
    assert.equal(aviso.hidden, false);
    assert.equal(aviso.textContent, 'comun.menu.salir-error');
    assert.equal(boton.disabled, false);
    salida = 'invalida';
    boton.dispatchEvent(new Event('click'));
    await vuelta();
    assert.equal(destino, '');
    salida = 'correcta';
    boton.dispatchEvent(new Event('click'));
    await vuelta();
    assert.equal(destino, 'https://ejemplo.invalid/');
    const post = peticiones.filter((p) => p.ruta.endsWith('/salir'));
    assert.equal(post.length, INTENTOS);
    for (const llamada of post) {
      assert.equal(llamada.opciones.method, 'POST');
      assert.equal(llamada.opciones.credentials, 'same-origin');
      assert.equal(llamada.opciones.body, undefined);
    }
  } finally {
    hooks.deregister();
  }
});
