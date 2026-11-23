import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EXTENSIONES } from '../../src/plataforma/extensiones.ts';
import { navegador } from '../web-controles/ayudas.js';

/** La copia de la impresión que publica cada extensión del registro. */
const COPIAS = EXTENSIONES.flatMap(({ publicacionesComunes }) => {
  const copia = publicacionesComunes['web/scripts/recorrido/impresion.js'];
  return copia ? [`../../${copia}`] : [];
});

test('el real y cada extensión imprimen el informe y retiran sus clases al terminar', async (t) => {
  const clases = new Set<string>();
  const raiz = {
    classList: {
      add: (valor: string) => clases.add(valor),
      remove: (...valores: string[]) =>
        valores.forEach((valor) => {
          clases.delete(valor);
        }),
      contains: (valor: string) => clases.has(valor),
    },
  };
  const ventana = Object.assign(new EventTarget(), { print: () => assert.ok(clases.has('imprimir-informe')) });
  navegador(t, { document: { documentElement: raiz, querySelector: () => null }, window: ventana });
  for (const ruta of ['../../web/scripts/recorrido/impresion.js', ...COPIAS]) {
    const modulo = await import(ruta);
    modulo.imprimir('informe');
    assert.equal(clases.has('imprimir-informe'), true);
    ventana.dispatchEvent(new Event('afterprint'));
    assert.equal(clases.size, 0);
  }
});

// El informe que pinta el motor, dentro de #informe (paso-informe.js).
const INFORME_PINTADO = '#informe .informe-breve';
type EstadoDelPaso4 = { existe: boolean; hidden: boolean; vista: string | undefined; pintado: Set<string> };

/** Un documento con el paso 4 oculto o a la vista, con la vista del informe (sin data-vista) o la de la hoja, y lo
 * que tiene pintado; y las clases de <html>. */
function documentoDelPaso4(estado: EstadoDelPaso4, clases: Set<string>) {
  const raiz = {
    classList: {
      add: (valor: string) => clases.add(valor),
      remove: (...valores: string[]) =>
        valores.forEach((valor) => {
          clases.delete(valor);
        }),
      contains: (valor: string) => clases.has(valor),
    },
  };
  const paso = {
    get hidden() {
      return estado.hidden;
    },
    get dataset() {
      return estado.vista ? { vista: estado.vista } : {};
    },
    querySelector: (selector: string) => (estado.pintado.has(selector) ? {} : null),
  };
  return {
    documentElement: raiz,
    getElementById: (id: string) => (id === 'paso-4' && estado.existe ? paso : null),
    querySelector: (selector: string) =>
      selector === '#paso-4[data-vista="hoja"] .hd' && estado.vista === 'hoja' && estado.pintado.has('.hd') ? {} : null,
  };
}

test('el menú del navegador imprime la vista abierta del paso 4: el informe pintado o la hoja de ruta', async (t) => {
  const clases = new Set<string>();
  const estado: EstadoDelPaso4 = { existe: true, hidden: false, vista: undefined, pintado: new Set() };
  const documento = documentoDelPaso4(estado, clases);
  /** Lo que queda en <html> durante la impresión nativa, y que afterprint lo retira. */
  const alImprimir = (ventana: EventTarget) => {
    ventana.dispatchEvent(new Event('beforeprint'));
    const durante = [...clases].sort();
    ventana.dispatchEvent(new Event('afterprint'));
    assert.equal(clases.size, 0);
    return durante;
  };
  for (const ruta of ['../../web/scripts/recorrido/impresion.js', ...COPIAS]) {
    const ventana = Object.assign(new EventTarget(), { print: () => undefined });
    navegador(t, { document: documento, window: ventana });
    // Una instancia propia del módulo, con sus escuchas en esta ventana.
    await import(`${ruta}?menu-del-navegador`);
    Object.assign(estado, { existe: true, hidden: false, vista: undefined, pintado: new Set([INFORME_PINTADO]) });
    assert.deepEqual(alImprimir(ventana), ['imprimir-informe'], `${ruta}: vista del informe con informe pintado`);
    estado.pintado = new Set();
    assert.deepEqual(alImprimir(ventana), [], `${ruta}: vista del informe sin informe`);
    Object.assign(estado, { hidden: true, pintado: new Set([INFORME_PINTADO]) });
    assert.deepEqual(alImprimir(ventana), [], `${ruta}: informe pintado con el paso 4 oculto`);
    estado.existe = false;
    assert.deepEqual(alImprimir(ventana), [], `${ruta}: sin paso 4`);
    Object.assign(estado, { existe: true, hidden: false, vista: 'hoja', pintado: new Set(['.hd', INFORME_PINTADO]) });
    assert.deepEqual(alImprimir(ventana), ['imprimir-hoja'], `${ruta}: vista de la hoja`);
    // Con el botón ya se eligió qué imprimir: el menú no lo cambia.
    Object.assign(estado, { vista: undefined, pintado: new Set([INFORME_PINTADO]) });
    clases.add('imprimir-los-dos');
    assert.deepEqual(alImprimir(ventana), ['imprimir-los-dos'], `${ruta}: clase explícita`);
  }
});
