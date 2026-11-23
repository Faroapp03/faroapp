import assert from 'node:assert/strict';
import test from 'node:test';

class ElementoSVG {
  etiqueta: string;
  atributos: Record<string, string> = {};
  hijos: ElementoSVG[] = [];
  textContent = '';

  constructor(etiqueta: string) {
    this.etiqueta = etiqueta;
  }

  setAttribute(nombre: string, valor: string) {
    this.atributos[nombre] = valor;
  }

  append(...hijos: ElementoSVG[]) {
    this.hijos.push(...hijos);
  }
}

// El dibujo solo necesita crear elementos SVG; el idioma consulta la raíz al cargar el módulo.
Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: { documentElement: {}, createElementNS: (_espacio: string, etiqueta: string) => new ElementoSVG(etiqueta) },
});
const { lineas } = await import('../../web/scripts/datos-globales/dibujo.js');
const { seUnen } = await import('../../web/scripts/datos-globales/graficos.js');

const series = [
  {
    papel: 'cat' as const,
    nombre: 'Cataluña',
    puntos: [
      { anio: 2023, valor: 8 },
      { anio: 2025, valor: 20 },
    ],
    ocultos: [],
    protagonista: false,
  },
  {
    papel: 'ue' as const,
    nombre: 'UE',
    puntos: [
      { anio: 2023, valor: 7 },
      { anio: 2025, valor: 20 },
    ],
    ocultos: [],
    protagonista: false,
  },
  {
    papel: 'esp' as const,
    nombre: 'España',
    puntos: [
      { anio: 2023, valor: 9 },
      { anio: 2025, valor: 20 },
    ],
    ocultos: [],
    protagonista: false,
  },
];

test('las etiquetas finales separadas conservan una guía hacia su punto y sus cifras', () => {
  const antes = structuredClone(series);
  const ancho = 640;
  const separacion = 16;
  const svg = lineas({ series, desde: 2023, hasta: 2025, escala: { maximo: 30, paso: 10 } })(
    ancho,
  ) as unknown as ElementoSVG;
  const textos = svg.hijos.filter((hijo) => hijo.etiqueta === 'text');
  const etiquetas = textos.filter((hijo) => ['Cataluña 20,0', 'UE 20,0', 'España 20,0'].includes(hijo.textContent));
  assert.equal(etiquetas.length, series.length);
  const posiciones = etiquetas.map((etiqueta) => Number(etiqueta.atributos.y)).sort((a, b) => a - b);
  const [primera, segunda, tercera] = posiciones;
  assert.ok(primera !== undefined && segunda !== undefined && tercera !== undefined);
  assert.ok(segunda - primera >= separacion && tercera - segunda >= separacion);
  const conectores = svg.hijos.filter((hijo) => hijo.atributos.class?.startsWith('conector '));
  assert.ok(conectores.length >= 2);
  for (const conector of conectores) {
    const { y1, y2, class: clase } = conector.atributos;
    assert.ok(typeof y1 === 'string' && typeof y2 === 'string' && typeof clase === 'string');
    assert.notEqual(y1, y2);
    assert.ok(['conector c-cat', 'conector c-ue', 'conector c-esp'].includes(clase));
  }
  assert.deepEqual(series, antes);
});

test('un año no comparable entre dos datos mantiene la interrupción de la línea', () => {
  const primero = { anio: 2023, valor: 8 };
  const ultimo = { anio: 2025, valor: 20 };
  const anioNoComparable = 2024;
  assert.equal(seUnen(primero, ultimo, [anioNoComparable]), false);
  assert.equal(seUnen(primero, ultimo, []), true);
});
