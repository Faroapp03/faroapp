// recorrido.js real, con un paso 4 cuya importación retiene la prueba: así se puede borrar justo mientras llega y
// comprobar que ninguna de sus dos entradas («Ver mi informe» y el resultado de otro dispositivo) sigue con lo anterior.
import './limites-del-paso/carga.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Nodo, navegador, pagina } from '../web-controles/ayudas.js';
import { fijarCodigo, prueba, reiniciar } from './limites-del-paso/dobles.ts';

test('borrar durante la importación del paso 4 no reutiliza ni el formulario ni el resultado recibido', async (t) => {
  reiniciar();
  fijarCodigo('resultado-sintetico-anterior');
  const iniciado = Promise.withResolvers<void>();
  const paso = Promise.withResolvers<void>();
  prueba.iniciarImportacion = () => iniciado.resolve();
  prueba.entradaLista = paso.promise;
  const dom = pagina(t);
  const formulario = new Nodo();
  const dialogo = new Nodo();
  dom.ids.set('form-tareas', formulario);
  dom.ids.set('dialogo-nueva', dialogo);
  Object.assign(dom.document, { readyState: 'loading' });
  const ventana = Object.assign(new EventTarget(), { scrollTo() {} });
  navegador(t, { window: ventana, HTMLDialogElement: Nodo });
  // Con la consulta, una instancia propia del módulo (arranca al importarse); su ruta se construye para importarla así.
  await import(new URL('../../web/scripts/recorrido.js?ensayo=inicio', import.meta.url).href);
  const envio = new Event('submit', { cancelable: true });
  formulario.dispatchEvent(envio);
  assert.equal(envio.defaultPrevented, true);
  await iniciado.promise;
  const borrar = prueba.borrado;
  assert.ok(borrar, 'recorrido.js escucha el borrado desde otra pestaña');
  borrar();
  assert.equal(prueba.controlador.signal.aborted, true);
  paso.resolve();
  await new Promise((resolver) => setImmediate(resolver));
  assert.deepEqual(prueba.paso4, []);
  assert.ok(!prueba.efectos.includes('error-inicio'));
  fijarCodigo(null);
});
