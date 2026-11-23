import assert from 'node:assert/strict';
import { test } from 'node:test';
import { almacen, navegador } from '../web-controles/ayudas.js';
import { barra, base, entorno, evento } from './dom.ts';

test('el compositor local admite mensajes sin conexión e ignora preferencias antiguas de IA', async (t) => {
  entorno(t);
  base();
  const { campo, form } = barra();
  navegador(t, {
    navigator: { platform: 'Linux', onLine: false },
    localStorage: almacen({ 'faro-modo-elegido': 'ia-on', 'faro-modos': '["ia-on"]' }),
    fetch: async () => assert.fail('El compositor no consulta configuración, proveedor ni salud'),
  });
  const compositor = await import('../../web/scripts/recorrido/compositor.js');
  const enviados: string[] = [];
  compositor.cambiarModo({ etiqueta: '', marcador: '', alEnviar: (texto) => enviados.push(texto) });
  compositor.iniciarCompositor();
  campo.value = 'Organizo pedidos';
  form.dispatchEvent(evento('submit'));
  assert.deepEqual(enviados, ['Organizo pedidos']);
  assert.equal(campo.value, '');
  assert.notEqual(form.dataset.sinConexion, 'true');
});
