// Las importaciones que reconoce importacionesJs (comentarios-js.ts), que usa la comprobación de referencias de la
// construcción sobre todo el JavaScript publicado: los casos límite de su léxico y un plazo para módulos del tamaño
// del motor empaquetado, que es donde una búsqueda sobre todo el código anterior se vuelve cuadrática.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { finQueDecide, importacionesJs, terminaEnImportacion } from '../../herramientas/web/comentarios-js.ts';

/** Lo que la lectura del final del código acumula antes de recortarlo (COLA, en comentarios-js.ts). */
const FINAL_MIRADO = 256;
/** Más espacios entre la palabra y la cadena que ese final. */
const ANCHO_DE_LA_RACHA = 600;
const ESPACIOS = ' '.repeat(ANCHO_DE_LA_RACHA);
/** Cadenas del módulo sintético: unos 2 MB, más que el mayor archivo del motor empaquetado (2,38 MB tiene motor.js). */
const CADENAS = 55_000;
/**
 * Plazo del módulo sintético. Medido sobre la construcción publicable de esta versión con 1,5 MB (al cambiar, se mide
 * de nuevo y se anota aquí): 20-30 ms con la lectura del final del código y 8.849 ms con la expresión sobre todo el
 * código anterior, que crece con el cuadrado del tamaño.
 */
const PLAZO_MS = 1000;
/** La expresión que decidía antes, sobre todo el código anterior: es el oráculo de la lectura del final. */
const ORACULO = /\b(?:import\s*\(?|from)\s*$/;
/** Trozos con que se generan finales de código al azar: palabras, sus vecinas, signos y rachas de espacios. */
const PIEZAS = [
  'import',
  'from',
  'ximport',
  'fromx',
  '$from',
  '_import',
  'é',
  '(',
  '((',
  ' ',
  '\n',
  '\t',
  ';',
  '.',
  'a',
];
/** Rachas de espacios alrededor del final que se mira de una vez: es donde un recorte fijo partía la palabra. */
const RACHAS = ['import(', 'import', 'rom', '(', '', ' '].map((antes) => ' '.repeat(FINAL_MIRADO - antes.length));
/** Casos generados por semilla fija: cada final y cada final seguido de otro. */
const GENERADOS = 4000;
const SEMILLA = 48_271;
const PIEZAS_POR_CASO = 12;

/** Código delante del caso para que el final del código ya se haya recortado alguna vez. */
const PREAMBULO = 'x = 1;'.repeat(ANCHO_DE_LA_RACHA);
/** Espacios tras «from» que dejan solo «rom» dentro de ese final: un recorte fijo cortaría la palabra. */
const AL_BORDE = ' '.repeat(FINAL_MIRADO - 'rom'.length);

const CASOS: readonly (readonly [string, string, readonly string[]])[] = [
  [
    'import y from',
    "import a from './a.js'; import './b.js'; export { c } from \"./c.js\";",
    ['./a.js', './b.js', './c.js'],
  ],
  [
    'import() con y sin espacios',
    "import('./d.js'); import ( './e.js' ); import\n(\n'./f.js')",
    ['./d.js', './e.js', './f.js'],
  ],
  ['comentarios con from e import', "// from './no.js'\n/* import('./no2.js') */ const x = 1;", []],
  ['from y import dentro de cadenas', "const t = \"from './no.js'\"; const u = 'import(\\'./no2.js\\')';", []],
  // «\u0024» es «$»: la plantilla del caso tiene una sustitución con una importación dentro.
  ['plantillas', "const p = `\u0024{await import('./g.js')} from './no.js'`; import(`./h.js`);", ['./g.js']],
  [
    '$ y palabras que contienen from o import',
    "$from './i.js'; xfrom './no.js'; reimport('./no2.js'); a.from('./no3.js')",
    ['./i.js'],
  ],
  ['expresiones regulares', "const r = /from '.\\/no.js'/; import('./k.js');", ['./k.js']],
  [
    'muchos espacios antes de la cadena',
    `import a from${ESPACIOS}'./l.js'; import(${ESPACIOS}'./m.js'); from${ESPACIOS}x'./no.js'`,
    ['./l.js', './m.js'],
  ],
  [
    'palabra en el borde de lo que se mira',
    `${PREAMBULO}; from${AL_BORDE}'./o.js'; de from${AL_BORDE}x'./no.js'`,
    ['./o.js'],
  ],
  [
    'muchos espacios antes de import(',
    `import${ESPACIOS}(${ESPACIOS}'./n.js'); salto${ESPACIOS}('./no.js')`,
    ['./n.js'],
  ],
];

for (const [nombre, codigo, esperadas] of CASOS) {
  test(`importacionesJs: ${nombre}`, () => {
    assert.deepEqual(importacionesJs(codigo), esperadas);
  });
}

test('importacionesJs lee un módulo del tamaño del motor dentro de su plazo', () => {
  const lineas = Array.from({ length: CADENAS }, (_, n) => `const v${n} = f('t${n}', "d${n}");`);
  const codigo = `${lineas.join('\n')}\nimport('./z.js');\n`;
  const inicio = performance.now();
  const importadas = importacionesJs(codigo);
  const ms = Math.round(performance.now() - inicio);
  assert.deepEqual(importadas, ['./z.js']);
  assert.ok(ms < PLAZO_MS, `${ms} ms con ${CADENAS} cadenas; el plazo es ${PLAZO_MS} ms`);
});

/** El generador congruencial mínimo de Park y Miller: multiplicador y módulo. */
const MULTIPLICADOR = 16_807;
const MODULO = 2_147_483_647;

/** Un generador pseudoaleatorio con semilla: los mismos casos en cada ejecución. */
function generador(semilla: number): () => number {
  let estado = semilla % MODULO;
  return () => {
    estado = (estado * MULTIPLICADOR) % MODULO;
    return estado / MODULO;
  };
}

function finAlAzar(azar: () => number): string {
  const todas = [...PIEZAS, ...RACHAS];
  return Array.from(
    { length: Math.floor(azar() * PIEZAS_POR_CASO) },
    () => todas[Math.floor(azar() * todas.length)],
  ).join('');
}

test('la lectura del final decide como la expresión sobre todo el código, también tras recortarlo', () => {
  const azar = generador(SEMILLA);
  const limites = [
    `x;import${' '.repeat(FINAL_MIRADO - 'import'.length)}`,
    `ximport${' '.repeat(FINAL_MIRADO - 'import'.length)}`,
    `;import(${' '.repeat(FINAL_MIRADO - 1)}`,
    `from${'\n'.repeat(FINAL_MIRADO)}`,
    `${'a'.repeat(ANCHO_DE_LA_RACHA)}from `,
  ];
  const casos = [...limites, ...Array.from({ length: GENERADOS }, () => finAlAzar(azar))];
  for (const codigo of casos) {
    assert.equal(terminaEnImportacion(codigo), ORACULO.test(codigo), JSON.stringify(codigo));
    const siguiente = finAlAzar(azar);
    assert.equal(
      terminaEnImportacion(finQueDecide(codigo) + siguiente),
      ORACULO.test(codigo + siguiente),
      JSON.stringify([codigo, siguiente]),
    );
  }
});
