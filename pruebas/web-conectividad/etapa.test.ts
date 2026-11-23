import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

const VISTA = new URL('../../web/scripts/conectividad-etapa.js', import.meta.url);
class Elemento extends EventTarget {
  disabled = false;
  value = '';
  textContent = '';
  classList = { contains: () => true };
  focus() {}
  select() {}
}
const campos = new Map<string, Elemento>();
function campo(id: string) {
  if (!campos.has(id)) {
    campos.set(id, new Elemento());
  }
  return campos.get(id) as Elemento;
}
let cambiar: (estado: unknown) => void = () => {};
let copiado = '';
const ventana = new EventTarget();
for (const [clave, valor] of Object.entries({
  window: ventana,
  location: { href: 'https://ejemplo.invalid/que-es-faro.html#conectividad' },
  HTMLInputElement: Elemento,
  HTMLButtonElement: Elemento,
  navigator: {
    clipboard: {
      writeText: async (texto: string) => {
        copiado = texto;
      },
    },
  },
  MutationObserver: class {
    observe() {}
  },
  __campoConectividad: campo,
  __crearConsulta: ({ alCambiar }: { alCambiar: (estado: unknown) => void }) => {
    cambiar = alCambiar;
    return {
      retirar() {},
      async comprobar() {
        alCambiar({ estado: 'consultando' });
      },
    };
  },
})) {
  Object.defineProperty(globalThis, clave, { configurable: true, value: valor });
}
const hooks = registerHooks({
  resolve(especificador, contexto, siguiente) {
    if (contexto.parentURL?.startsWith(VISTA.href)) {
      const fuentes: Record<string, string> = {
        './sitio.js': '',
        './etapas.js': '',
        './conectividad/estado.js': 'export const crearConsultaConectividad = globalThis.__crearConsulta;',
        './dom.js': 'export const porId = globalThis.__campoConectividad;',
        './idioma.js': 'export const alCambiarIdioma = () => {};',
        './textos.js': 'export const texto = (clave) => clave;',
      };
      if (Object.hasOwn(fuentes, especificador)) {
        return { url: `data:text/javascript,${encodeURIComponent(fuentes[especificador] ?? '')}`, shortCircuit: true };
      }
    }
    return siguiente(especificador, contexto);
  },
});
test('la dirección y su copia permanecen disponibles con estado apagado o no comprobado', async () => {
  try {
    await import(VISTA.href);
    const direccion = campo('mcp-direccion');
    assert.equal(direccion.value, 'https://ejemplo.invalid/mcp');
    for (const [estado, esperado] of [
      [{ estado: 'confirmado', lectura: { servicios: { mcp: true } } }, 'conectividad.mcp.activo'],
      [{ estado: 'confirmado', lectura: { servicios: { mcp: false } } }, 'conectividad.mcp.inactivo'],
      [{ estado: 'no-disponible' }, 'conectividad.estado.no-disponible'],
    ] as const) {
      cambiar(estado);
      assert.equal(campo('mcp-estado').textContent, esperado);
      assert.equal(direccion.value, 'https://ejemplo.invalid/mcp');
      assert.equal(campo('mcp-copiar').disabled, false);
      const anterior = campo('mcp-estado').textContent;
      campo('mcp-copiar').dispatchEvent(new Event('click'));
      await Promise.resolve();
      assert.equal(copiado, direccion.value);
      assert.equal(campo('mcp-estado').textContent, anterior);
      assert.equal(campo('mcp-copia-estado').textContent, 'conectividad.copiado');
    }
  } finally {
    hooks.deregister();
  }
});
