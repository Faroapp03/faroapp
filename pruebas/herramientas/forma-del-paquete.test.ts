// La forma del paquete del navegador: las páginas que cargan los mismos módulos comparten una sola entrada, sin trozos
// vacíos, y las guardias del grafo emitido detienen los archivos vacíos, los duplicados, las páginas que cargan más
// trozos al abrirse que el techo medido y una carpeta js/ con más archivos que la medida.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { transformSync } from 'esbuild';
import { CARPETA_DEL_MOTOR } from '../../herramientas/web/carpeta-del-motor.ts';
import {
  empaquetarZona,
  entradaDeLaPagina,
  entradasDeLasPaginas,
} from '../../herramientas/web/empaquetado/construccion.ts';
import {
  cierre,
  comprobarGrafoEmitido,
  type GrafoDePagina,
  type PaqueteNavegador,
  PRESUPUESTOS,
  sinMinificar,
  techosDeLasExtensiones,
  techosPorCarpeta,
} from '../../herramientas/web/empaquetado/grafo.ts';
import { carpetaDelPaqueteDe, TROZOS_DEL_MOTOR, type Zona, zonaDe } from '../../herramientas/web/empaquetado/zonas.ts';
import { CARPETAS_PUBLICAS_CON_HUELLA, cabecerasParaRuta } from '../../src/plataforma/cabeceras-web.ts';
import { EXTENSIONES } from '../../src/plataforma/extensiones.ts';
import { CACHE_DEL_PAQUETE } from '../../src/plataforma/paquete-publicado.ts';

const MINIFICADO = transformSync('export const a = 1;', { minify: true, format: 'esm', loader: 'js' }).code;
const OTRO = transformSync('export const b = 2;', { minify: true, format: 'esm', loader: 'js' }).code;
const bytes = (texto: string) => new TextEncoder().encode(texto);
/** Lo que pesa, holgado, la función del lector que usa el recorrido; y lo mínimo de la tabla de clasificación. */
const UNA_FUNCION = 20_000;
const LA_CLASIFICACION = 1_000_000;
const PAGINA = '<html><script type="module" src="js/a.js"></script></html>';

/** Una raíz temporal con estos archivos escritos. */
function raizCon(archivos: Record<string, string>): string {
  const raiz = realpathSync(mkdtempSync(join(tmpdir(), 'forma-del-paquete-')));
  writeFileSync(join(raiz, '.assetsignore'), '');
  for (const [ruta, contenido] of Object.entries(archivos)) {
    mkdirSync(dirname(join(raiz, ruta)), { recursive: true });
    writeFileSync(join(raiz, ruta), contenido);
  }
  return raiz;
}

function grafo(estaticos: number): GrafoDePagina {
  const lista = Array.from({ length: estaticos }, (_, n) => `js/chunk-${n}.js`);
  return { entrada: 'js/a.js', estaticos: lista, dinamicos: [], bytesEstaticos: 0, bytesTotales: 0 };
}

/** Las guardias del grafo emitido sobre un paquete sintético: sus archivos, publicados en js/, y el grafo de inicio. */
function guardias(paquete: Record<string, string>, estaticos = 0): string[] {
  const raiz = raizCon({ 'inicio.html': PAGINA, ...paquete });
  try {
    const mapa = new Map(Object.entries(paquete).map(([ruta, texto]) => [ruta, bytes(texto)]));
    const resumen = { paginas: { 'inicio.html': grafo(estaticos) }, privados: [], servidorPorRuta: [] };
    return comprobarGrafoEmitido(raiz, {
      archivos: mapa,
      motor: new Map([['motor/m.js', bytes(MINIFICADO)]]),
      resumen: resumen as unknown as PaqueteNavegador['resumen'],
    });
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
}

test('las páginas con los mismos módulos comparten una entrada y no dejan trozos vacíos', async () => {
  const web = raizCon({
    'scripts/sitio.js': 'export const sitio = () => document.title;\nsitio();\n',
    'scripts/propio.js': "import { sitio } from './sitio.js';\nconsole.log(sitio());\n",
  });
  try {
    const zona: Zona = {
      id: 'publica',
      carpeta: 'js',
      paginas: [
        { ruta: 'creditos.html', modulos: ['scripts/sitio.js'] },
        { ruta: 'sin-conexion.html', modulos: ['scripts/sitio.js'] },
        { ruta: 'inicio.html', modulos: ['scripts/propio.js'] },
      ],
    };
    assert.deepEqual([...entradasDeLasPaginas(zona).keys()], ['js/paginas-scripts-sitio', 'js/pagina-inicio']);
    const { archivos, salidaDePagina } = await empaquetarZona(web, zona, 'compartida', { calculadas: [] });
    assert.equal(salidaDePagina.get('creditos.html'), salidaDePagina.get('sin-conexion.html'));
    assert.deepEqual(
      [...archivos].filter(([, contenido]) => contenido.byteLength === 0).map(([ruta]) => ruta),
      [],
      'ningún trozo vacío',
    );
    assert.equal([...archivos.keys()].filter((ruta) => /\/paginas?-/.test(ruta)).length, 2);
  } finally {
    rmSync(web, { recursive: true, force: true });
  }
});

test('el paquete con un archivo vacío sale en rojo', () => {
  assert.deepEqual(guardias({ 'js/a.js': MINIFICADO }), []);
  assert.deepEqual(guardias({ 'js/a.js': MINIFICADO, 'js/chunk-0.js': '' }), ['js/chunk-0.js: JavaScript vacío']);
});

test('dos archivos con los mismos bytes en la misma carpeta salen en rojo', () => {
  assert.deepEqual(guardias({ 'js/a.js': MINIFICADO, 'js/b.js': OTRO }), []);
  assert.deepEqual(guardias({ 'js/a.js': MINIFICADO, 'js/b.js': MINIFICADO }), [
    'js/b.js: los mismos bytes que js/a.js',
  ]);
});

test('una página que carga más módulos al abrirse que el techo medido sale en rojo', () => {
  const techo = PRESUPUESTOS.modulosAlAbrir;
  assert.deepEqual(guardias({ 'js/a.js': MINIFICADO }, techo - 1), []);
  assert.deepEqual(guardias({ 'js/a.js': MINIFICADO }, techo), [
    `inicio.html: carga ${techo + 1} módulos al abrirse; el máximo es ${techo}`,
  ]);
});

test('una carpeta con más archivos que su techo medido sale en rojo: la pública, motor/ y la de cada extensión', () => {
  const archivos = (carpeta: string, n: number) =>
    Object.fromEntries(Array.from({ length: n }, (_, i) => [`${carpeta}t${i}.js`, `export const t${i}=${i};`]));
  for (const [carpeta, techo] of Object.entries(techosPorCarpeta())) {
    const otros = carpeta === 'js/' ? {} : { 'js/a.js': MINIFICADO };
    assert.deepEqual(guardias({ ...otros, ...archivos(carpeta, techo) }), [], carpeta);
    assert.deepEqual(guardias({ ...otros, ...archivos(carpeta, techo + 1) }), [
      `${carpeta}: ${techo + 1} archivos; el máximo es ${techo}`,
    ]);
  }
});

test('cada extensión instalada declara el techo de su carpeta del paquete; sin extensiones, ninguno', () => {
  assert.deepEqual(techosDeLasExtensiones([]), {}, 'sin extensiones no se exige nada de ninguna carpeta suya');
  const deLasExtensiones = techosDeLasExtensiones();
  assert.deepEqual(
    Object.keys(deLasExtensiones).sort(),
    EXTENSIONES.map((extension) => `${carpetaDelPaqueteDe(extension)}/`).sort(),
  );
  assert.deepEqual(techosPorCarpeta(), { ...PRESUPUESTOS.archivosPorCarpeta, ...deLasExtensiones });
  for (const techo of Object.values(deLasExtensiones)) {
    assert.ok(Number.isInteger(techo) && techo > 0);
  }
});

test('dos listas de módulos con el mismo nombre plano y una página sin entrada detienen el paquete', () => {
  const zona: Zona = {
    id: 'publica',
    carpeta: 'js',
    paginas: [
      { ruta: 'a.html', modulos: ['scripts/a/b.js'] },
      { ruta: 'b.html', modulos: ['scripts/a/b.js'] },
      { ruta: 'c.html', modulos: ['scripts/a-b.js'] },
      { ruta: 'd.html', modulos: ['scripts/a-b.js'] },
    ],
  };
  assert.throws(
    () => entradasDeLasPaginas(zona),
    /js\/paginas-scripts-a-b: el mismo nombre para a.html, b.html y c.html, d.html/,
  );
  assert.equal(entradaDeLaPagina(new Map([['a.html', 'js/pagina-a.js']]), 'a.html'), 'js/pagina-a.js');
  assert.throws(() => entradaDeLaPagina(new Map(), 'a.html'), /a.html: el paquete de su zona no tiene su entrada/);
});

test('el lector va en el paquete y cada página se lleva solo lo que usa de él', async () => {
  const lector = "from '../recursos/catalogo-cursos/lector.js';";
  const web = raizCon({
    'scripts/plazo.js': `import { antesDelLimitePublicado } ${lector}\nconsole.log(antesDelLimitePublicado);\n`,
    'scripts/cursos.js': `import { metadatosClasificados as m } ${lector}\nconsole.log(m);\n`,
  });
  try {
    const zona: Zona = {
      id: 'publica',
      carpeta: 'js',
      paginas: [
        { ruta: 'recorrido.html', modulos: ['scripts/plazo.js'] },
        { ruta: 'cursos.html', modulos: ['scripts/cursos.js'] },
      ],
    };
    const { archivos, metafile, salidaDePagina } = await empaquetarZona(web, zona, 'compartida', { calculadas: [] });
    assert.ok(![...archivos.keys()].some((ruta) => ruta.includes('catalogo-cursos')), 'el lector no se publica aparte');
    const pesoAlAbrir = (pagina: string) =>
      cierre(metafile, salidaDePagina.get(pagina) ?? '', true).reduce(
        (suma, salida) => suma + (metafile.outputs[salida]?.bytes ?? 0),
        0,
      );
    assert.ok(
      pesoAlAbrir('recorrido.html') < UNA_FUNCION,
      `${pesoAlAbrir('recorrido.html')} bytes por una sola función`,
    );
    assert.ok(pesoAlAbrir('cursos.html') > LA_CLASIFICACION, 'la clasificación va con quien la usa');
    assert.ok([...archivos].every(([, bytes]) => !sinMinificar(bytes)));
  } finally {
    rmSync(web, { recursive: true, force: true });
  }
});

test('el paquete deja lo que lleva huella en las carpetas públicas con huella del servidor', async () => {
  assert.deepEqual(
    [...CARPETAS_PUBLICAS_CON_HUELLA].sort(),
    [`${zonaDe('inicio.html').carpeta}/`, `${CARPETA_DEL_MOTOR}/${TROZOS_DEL_MOTOR}/`].sort(),
  );
  const web = raizCon({
    'scripts/sitio.js': 'export const sitio = () => document.title;\nsitio();\n',
    'scripts/propio.js': "import { sitio } from './sitio.js';\nconsole.log(sitio());\n",
  });
  try {
    const zona: Zona = {
      id: 'publica',
      carpeta: zonaDe('inicio.html').carpeta,
      paginas: [
        { ruta: 'creditos.html', modulos: ['scripts/sitio.js'] },
        { ruta: 'sin-conexion.html', modulos: ['scripts/sitio.js'] },
        { ruta: 'inicio.html', modulos: ['scripts/propio.js', 'scripts/sitio.js'] },
      ],
    };
    const { archivos } = await empaquetarZona(web, zona, 'compartida', { calculadas: [] });
    for (const ruta of archivos.keys()) {
      assert.equal(cabecerasParaRuta(`/${ruta}`)['cache-control'], CACHE_DEL_PAQUETE, `${ruta} lleva su huella`);
    }
  } finally {
    rmSync(web, { recursive: true, force: true });
  }
});
