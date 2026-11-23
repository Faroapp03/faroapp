import assert from 'node:assert/strict';
import { type TestContext, test } from 'node:test';
import type { DiagnosticoClasificacion } from '../../herramientas/web/diagnostico-clasificacion.ts';
import { crearVistaClasificacion } from '../../web/administracion/vista-clasificacion.js';
import { navegador } from '../web-controles/ayudas.js';
import { Elemento } from '../web-informe-lectura/dom-doble.ts';
import { activarIdiomaPanel } from './idiomas.ts';
import { Campo } from './panel-dom-comun.ts';

const IDS = [
  'consultar-clasificacion',
  'clasificacion-estado',
  'clasificacion-resumen',
  'clasificacion-lista',
  'clasificacion-anterior',
  'clasificacion-siguiente',
];
const CIFRAS_SHA = 64;
const DOS_PAGINAS = 21;
function vista(t: TestContext, diagnostico: DiagnosticoClasificacion | null) {
  const campos = new Map(IDS.map((id) => [id, Object.assign(new Campo('div'), { id })]));
  const campo = (id: string) => {
    const valor = campos.get(id);
    assert.ok(valor);
    return valor;
  };
  navegador(t, {
    document: { getElementById: campo, createElement: (tag: string) => new Elemento(tag) },
    HTMLElement: Campo,
    HTMLButtonElement: Campo,
    fetch: () => {
      throw new Error('La vista no consulta la red');
    },
  });
  activarIdiomaPanel();
  t.after(() => activarIdiomaPanel());
  return { campo, control: crearVistaClasificacion(diagnostico) };
}
function dato(total: number): DiagnosticoClasificacion {
  return {
    catalogoSha256: 'a'.repeat(CIFRAS_SHA),
    revision: 'b'.repeat(CIFRAS_SHA),
    revisionEditorialSha256: 'c'.repeat(CIFRAS_SHA),
    revisionMateriasSha256: 'd'.repeat(CIFRAS_SHA),
    total,
    aplicadas: 0,
    unidades: Array.from({ length: total }, (_, i) => ({
      id: `unidad-${i}`,
      tipo: 'edicion',
      proveedor: 'fuente',
      titulo: `Curso <${i}>`,
      revision: { estado: 'no-aplicada', motivo: 'firma-distinta' },
      revisionNivel: { estado: 'no-aplicada', motivo: 'evidencia-nivel-ausente' },
      revisionContenido: null,
    })),
  };
}

test('la instantánea se consulta explícitamente, pagina y cambia de idioma sin red', (t) => {
  const p = vista(t, dato(DOS_PAGINAS));
  p.control.mostrar(1);
  assert.equal(p.campo('clasificacion-resumen').textContent, '');
  p.campo('consultar-clasificacion').dispatchEvent(new Event('click'));
  assert.match(p.campo('clasificacion-resumen').textContent, /Ofertas en la publicación: 21/u);
  assert.match(p.campo('clasificacion-resumen').textContent, /Firma editorial distinta: 21/u);
  assert.match(p.campo('clasificacion-resumen').textContent, /a{64}/u);
  assert.match(p.campo('clasificacion-lista').textContent, /Curso <0>/u);
  assert.match(p.campo('clasificacion-lista').textContent, /Falta la evidencia de nivel/u);
  assert.match(p.campo('clasificacion-resumen').textContent, /Ofertas con nivel pendiente: 21/u);
  assert.equal(p.campo('clasificacion-lista').querySelector('0'), null);
  assert.equal(p.campo('clasificacion-siguiente').disabled, false);
  p.campo('clasificacion-siguiente').dispatchEvent(new Event('click'));
  assert.match(p.campo('clasificacion-lista').textContent, /Curso <20>/u);
  activarIdiomaPanel('ca');
  p.control.traducir();
  assert.match(p.campo('clasificacion-resumen').textContent, /Pàgina 2 de 2/u);
  assert.match(p.campo('clasificacion-lista').textContent, /Signatura editorial diferent/u);
  p.control.retirar();
  assert.equal(p.campo('clasificacion-lista').textContent, '');
  p.control.mostrar(2);
  assert.equal(p.campo('clasificacion-resumen').textContent, '');
});

test('la falta de instantánea es distinta de cero ofertas acreditadas', (t) => {
  const p = vista(t, null);
  p.control.mostrar(1);
  p.campo('consultar-clasificacion').dispatchEvent(new Event('click'));
  assert.match(p.campo('clasificacion-estado').textContent, /no está disponible/u);
  assert.equal(p.campo('clasificacion-resumen').textContent, '');
  const q = vista(t, dato(0));
  q.control.mostrar(1);
  q.campo('consultar-clasificacion').dispatchEvent(new Event('click'));
  assert.match(q.campo('clasificacion-resumen').textContent, /Ofertas en la publicación: 0/u);
});

test('una materia acreditada mantiene visible el nivel pendiente y el contenido cambiado', (t) => {
  const anterior = dato(1);
  const unidad = anterior.unidades[0];
  assert.ok(unidad);
  const p = vista(t, {
    ...anterior,
    aplicadas: 1,
    unidades: [
      {
        ...unidad,
        revision: { estado: 'aplicada' },
        revisionNivel: { estado: 'no-aplicada', motivo: 'nivel-por-confirmar' },
        revisionContenido: { estado: 'no-aplicada', motivo: 'contenido-distinto' },
      },
    ],
  });
  p.control.mostrar(1);
  p.campo('consultar-clasificacion').dispatchEvent(new Event('click'));
  assert.match(p.campo('clasificacion-resumen').textContent, /Materia acreditada: 1/u);
  assert.match(p.campo('clasificacion-lista').textContent, /Nivel por confirmar/u);
  assert.match(p.campo('clasificacion-lista').textContent, /contenido revisado ha cambiado/u);
});
