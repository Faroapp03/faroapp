import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

const menu = new URL('../../web/scripts/menu-recorrido.js', import.meta.url);
test('un DTO demo no crea entrada cuando la variante no está incluida', async () => {
  const hooks = registerHooks({
    resolve(spec, contexto, siguiente) {
      if (contexto.parentURL?.startsWith(menu.href) && ['./dom.js', './idioma.js', './textos.js'].includes(spec)) {
        const fuentes: Record<string, string> = {
          './dom.js': 'export const crear = () => {};',
          './idioma.js': 'export const escribir = () => {};',
          './textos.js': 'export const traducible = () => {}; export const conVersiones = () => {};',
        };
        return { url: `data:text/javascript,${encodeURIComponent(fuentes[spec] ?? '')}`, shortCircuit: true };
      }
      if (contexto.parentURL?.startsWith(menu.href) && spec === './variantes-disponibles.js') {
        return {
          url: 'data:text/javascript,export const VARIANTES_INSTALADAS = Object.freeze({})',
          shortCircuit: true,
        };
      }
      return siguiente(spec, contexto);
    },
  });
  try {
    const modulo = await import(`${menu.href}?solo-real`);
    assert.equal(modulo.esEstadoDelRecorrido({ version: 1, revision: 4, modo: 'real' }), true);
    assert.equal(modulo.esEstadoDelRecorrido({ version: 1, revision: 4, modo: 'demo' }), false);
    assert.match(modulo.direccionDelRecorrido('real'), /\/recorrido\.html$/u);
    assert.throws(() => modulo.direccionDelRecorrido('demo'), /no disponible/u);
  } finally {
    hooks.deregister();
  }
});
