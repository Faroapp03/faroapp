import './dom.ts';
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { limpiarEntregaFinal, prepararEntregaFinal } from '../../web/scripts/recorrido/entrega-final.js';
import { Nodo, pagina, prepararDom } from './dom.ts';

// La espera del pensamiento escucha en el documento; aquí no hay ningún pensamiento en curso.
Object.assign(pagina, { addEventListener: () => {}, removeEventListener: () => {} });

function escena() {
  const paso = new Nodo('div');
  paso.id = 'paso-4';
  const mensaje = new Nodo('div');
  // El DOM doble no calcula si un nodo está en la página; este mensaje lo está.
  Object.defineProperty(mensaje, 'isConnected', { value: true });
  const carpeta = new Nodo('div');
  mensaje.append(carpeta);
  paso.append(mensaje);
  const conversacion = new Nodo('div');
  conversacion.id = 'rc-conversacion';
  pagina.body.append(conversacion, paso);
  pagina.body.dataset.paso = '4';
  return { mensaje, carpeta };
}
const abrir = (cursos: number | null, hojaLista = true) => {
  const { mensaje, carpeta } = escena();
  prepararEntregaFinal({
    mensaje: mensaje as unknown as HTMLElement,
    carpeta: carpeta as unknown as HTMLElement,
    signal: new AbortController().signal,
    cursos,
    hojaLista,
    sinEstimar: [],
  });
  return carpeta;
};

beforeEach(() => {
  prepararDom();
  limpiarEntregaFinal();
});

for (const cursos of [0, 1, 2]) {
  test(`con la hoja guardada con ${cursos} cursos se abre «Tus documentos»`, () => {
    const carpeta = abrir(cursos);
    assert.equal(pagina.body.dataset.entrega, 'final');
    assert.match(carpeta.querySelector('.rc-entrega-titulo')?.textContent ?? '', /Tus documentos/u);
  });
}

test('sin hoja confirmada, o con su documento sin preparar, la vista final no se abre', () => {
  abrir(null);
  assert.equal(pagina.body.dataset.entrega, undefined);
  prepararDom();
  abrir(1, false);
  assert.equal(pagina.body.dataset.entrega, undefined);
});
