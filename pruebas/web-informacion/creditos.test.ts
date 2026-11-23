// Página de créditos: estructura, orden por categoría y organismo, fragmentos enlazados desde el resto de la web y
// textos en castellano y catalán.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { type DefaultTreeAdapterTypes, parse } from 'parse5';
import { sinComentariosHtml } from '../../herramientas/web/etiquetas.ts';
import { comprobarPagina } from '../../herramientas/web/paginas.ts';
import ca from '../../web/idiomas/ca.js';
import es from '../../web/idiomas/es.js';

type Elemento = DefaultTreeAdapterTypes.Element;
type Nodo = DefaultTreeAdapterTypes.ChildNode | DefaultTreeAdapterTypes.Document;

const WEB = new URL('../../web/', import.meta.url);
const HTML = readFileSync(new URL('creditos.html', WEB), 'utf8');
const documento = parse(HTML);

function* recorrer(nodo: Nodo): Generator<Elemento> {
  if ('tagName' in nodo) {
    yield nodo;
  }
  for (const hijo of 'childNodes' in nodo ? nodo.childNodes : []) {
    yield* recorrer(hijo);
  }
}
const todos = (raiz: Nodo, prueba: (e: Elemento) => boolean) => [...recorrer(raiz)].filter(prueba);
const atributo = (e: Elemento, nombre: string) => e.attrs.find((a) => a.name === nombre)?.value;
const tieneClase = (e: Elemento, clase: string) => (atributo(e, 'class') ?? '').split(/\s+/).includes(clase);
const hijos = (e: Elemento) => e.childNodes.filter((n): n is Elemento => 'tagName' in n);

/** Texto de un elemento en un idioma: aplica data-texto y sus plantillas {0}, {1}… como scripts/idioma.js. */
function texto(nodo: DefaultTreeAdapterTypes.ChildNode, dic: Record<string, string>): string {
  if (nodo.nodeName === '#text') {
    return (nodo as DefaultTreeAdapterTypes.TextNode).value;
  }
  if (!('tagName' in nodo)) {
    return '';
  }
  const clave = atributo(nodo, 'data-texto');
  const valor = clave ? dic[clave] : undefined;
  if (valor !== undefined) {
    const propios = hijos(nodo);
    return propios.length ? valor.replace(/\{(\d+)\}/g, (_, i) => texto(propios[Number(i)] as Elemento, dic)) : valor;
  }
  return nodo.childNodes.map((h) => texto(h, dic)).join('');
}
const limpio = (e: Elemento, dic: Record<string, string> = es) => texto(e, dic).replace(/\s+/g, ' ').trim();

const categorias = todos(documento, (e) => e.tagName === 'section' && tieneClase(e, 'creditos-categoria'));
const fichas = (raiz: Elemento) => todos(raiz, (e) => e.tagName === 'li' && tieneClase(e, 'credito'));
/** Créditos de la página, incluida la atribución del modelo del que derivan los vectores. */
const TOTAL_DE_CREDITOS = 78;
/** Fragmentos de créditos que enlazan, como mínimo, el informe y las demás páginas. */
const MINIMO_DE_FRAGMENTOS_ENLAZADOS = 12;
/** Anclas públicas de fuentes citadas por la presentación anterior; sus enlaces conservan destino. */
const ANCLAS_DE_FUENTES = [
  'idescat-censo-anual',
  'ine-censo-2021',
  'ine-censo-2021-api',
  'ine-ees-2022',
  'ine-tich-2025',
  'observatori-treball',
  'cambra',
  'sepe-especialidades',
  'soc-cursos',
  'consorci-cursos',
];
/** Las tres últimas entradas del índice: Reutilizar, Textos de las licencias y Cómo citar Faro. */
const FINALES = ['#t-reutilizar', '#t-licencias', '#t-citar'];
const ids = new Set(todos(documento, (e) => Boolean(atributo(e, 'id'))).map((e) => atributo(e, 'id')));

test('créditos: estructura básica, un h1, ids únicos y referencias accesibles válidas', () => {
  assert.deepEqual(comprobarPagina('creditos.html', sinComentariosHtml(HTML)), []);
});

test('créditos: cada clave de la página tiene texto en castellano y en catalán, con los mismos marcadores', () => {
  const claves = new Set([...HTML.matchAll(/data-texto(?:-[a-z-]+)?="([^"]+)"/g)].map(([, clave]) => clave as string));
  const marcas = (t: string) => [...t.matchAll(/\{\w+\}/g)].map(([m]) => m).sort();
  for (const clave of claves) {
    assert.ok(es[clave]?.trim(), `ES ${clave}`);
    assert.ok(ca[clave]?.trim(), `CA ${clave}`);
    assert.deepEqual(marcas(es[clave] ?? ''), marcas(ca[clave] ?? ''), clave);
  }
  // Ninguna clave de créditos queda en los diccionarios sin usarse en la página.
  const sobrantes = Object.keys(es).filter((k) => k.startsWith('creditos.') && !claves.has(k));
  assert.deepEqual(sobrantes, []);
});

test('créditos: categorías en su orden y el índice cuenta las fichas de cada una', () => {
  assert.deepEqual(
    categorias.map((c) => atributo(c, 'aria-labelledby')),
    [
      't-colaboradores',
      't-estadisticas',
      't-otros-paises',
      't-clasificaciones',
      't-normativa',
      't-formacion',
      't-mapas',
      't-imagenes',
      't-tipografias',
      't-software',
    ],
  );
  const indice = todos(documento, (e) => e.tagName === 'nav' && tieneClase(e, 'creditos-indice'))[0] as Elemento;
  const enlaces = todos(indice, (e) => e.tagName === 'a');
  for (const categoria of categorias) {
    const ancla = `#${atributo(categoria, 'aria-labelledby')}`;
    const enlace = enlaces.find((a) => atributo(a, 'href') === ancla);
    assert.ok(enlace, ancla);
    const cuenta = todos(enlace, (e) => tieneClase(e, 'creditos-indice-cuenta'))[0] as Elemento;
    assert.equal(Number.parseInt(limpio(cuenta), 10), fichas(categoria).length, ancla);
  }
  assert.deepEqual(
    enlaces.slice(-FINALES.length).map((a) => atributo(a, 'href')),
    FINALES,
  );
});

test('créditos: dentro de cada categoría, cada organismo es un solo grupo y van en orden alfabético', () => {
  for (const categoria of categorias.slice(1)) {
    const grupos = hijos(categoria).filter((e) => tieneClase(e, 'credito-grupo'));
    const nombres = grupos.map((g) => limpio(hijos(g).find((e) => e.tagName === 'h3') as Elemento));
    assert.equal(
      new Set(nombres).size,
      nombres.length,
      `${atributo(categoria, 'aria-labelledby')}: ${nombres.join(', ')}`,
    );
    const ordenados = [...nombres].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
    assert.deepEqual(nombres, ordenados, atributo(categoria, 'aria-labelledby') ?? '');
    // Las fichas de cada organismo, también en orden alfabético por obra.
    for (const lista of todos(categoria, (e) => e.tagName === 'ul' && tieneClase(e, 'credito-lista'))) {
      const obras = hijos(lista).map((li) => limpio(todos(li, (e) => tieneClase(e, 'credito-titulo'))[0] as Elemento));
      assert.deepEqual(
        obras,
        [...obras].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' })),
        obras.join(' | '),
      );
    }
  }
});

test('créditos: las colaboraciones van dentro del grupo de su organismo principal', () => {
  const subgrupos = todos(documento, (e) => e.tagName === 'h4' && tieneClase(e, 'credito-subgrupo'));
  assert.deepEqual(
    subgrupos.map((h4) => limpio(h4)),
    ['OIT en colaboración con NASK', 'INE en colaboración con la OIT'],
  );
  for (const h4 of subgrupos) {
    const grupo = h4.parentNode as Elemento;
    const principal = limpio(hijos(grupo).find((e) => e.tagName === 'h3') as Elemento);
    assert.ok(limpio(h4).startsWith(`${principal} `), limpio(h4));
  }
});

test('créditos: cada ficha tiene la misma forma y sus enlaces externos avisan de la pestaña nueva', () => {
  const todas = fichas(documento as unknown as Elemento);
  assert.equal(todas.length, TOTAL_DE_CREDITOS);
  for (const li of todas) {
    const id = atributo(li, 'id') ?? '';
    assert.match(id, /^f-[a-z0-9-]+$/);
    const titulo = todos(li, (e) => tieneClase(e, 'credito-titulo'))[0];
    assert.ok(titulo && atributo(titulo, 'id') === `o-${id}`, id);
    const etiquetas = todos(li, (e) => e.tagName === 'dt').map((dt) => atributo(dt, 'data-texto'));
    assert.ok(etiquetas.includes('creditos.campo.uso') || etiquetas.includes('creditos.campo.papel'), id);
    if (!etiquetas.includes('creditos.campo.papel')) {
      assert.ok(etiquetas.includes('creditos.campo.licencia') || etiquetas.includes('creditos.campo.autoria'), id);
    }
  }
  for (const a of todos(documento, (e) => e.tagName === 'a' && /^https?:/.test(atributo(e, 'href') ?? ''))) {
    const href = atributo(a, 'href') ?? '';
    assert.equal(atributo(a, 'target'), '_blank', href);
    assert.equal(atributo(a, 'rel'), 'noopener noreferrer', href);
    assert.ok((atributo(a, 'aria-describedby') ?? '').split(' ').includes('abre-en-otra-pestana'), href);
  }
});

test('créditos: existen todos los fragmentos a los que enlaza la web, también los antiguos', () => {
  const enlazados = new Set(ANCLAS_DE_FUENTES.map((ficha) => `f-${ficha}`));
  for (const archivo of readdirSync(WEB, { recursive: true, encoding: 'utf8' })) {
    if (!/\.(html|js|md)$/.test(archivo) || archivo.startsWith('terceros') || archivo === 'creditos.html') {
      continue;
    }
    const contenido = readFileSync(new URL(archivo, WEB), 'utf8');
    for (const [, fragmento] of contenido.matchAll(/(?<![-\w])creditos\.html#([\w-]+)/g)) {
      enlazados.add(fragmento as string);
    }
  }
  // También se comprueban los enlaces escritos por los presentadores actuales.
  const presentacion = new URL('../../src/presentacion/', import.meta.url);
  for (const archivo of readdirSync(presentacion, { recursive: true, encoding: 'utf8' })) {
    if (!archivo.endsWith('.ts')) {
      continue;
    }
    const fuente = readFileSync(new URL(archivo, presentacion), 'utf8');
    for (const [, fragmento] of fuente.matchAll(/(?<![-\w])creditos\.html#([\w-]+)/g)) {
      enlazados.add(fragmento as string);
    }
  }
  assert.ok(enlazados.size >= MINIMO_DE_FRAGMENTOS_ENLAZADOS, [...enlazados].join(' '));
  for (const fragmento of [
    ...enlazados,
    't-fuentes',
    't-guia',
    't-datos-globales',
    't-colaboradores',
    't-formacion',
    't-imagenes',
    't-software',
    't-reutilizar',
  ]) {
    assert.ok(ids.has(fragmento), fragmento);
  }
});

test('créditos: colaboradores y marco del proyecto, sin fórmulas de patrocinio ni de premio', () => {
  const colaboradores = categorias[0] as Elemento;
  assert.deepEqual(
    fichas(colaboradores).map((li) => atributo(li, 'id')),
    ['f-odee', 'f-sintech-lab', 'f-i2tic-ia-lab'],
  );
  for (const dic of [es, ca]) {
    const pagina = limpio(documento.childNodes.find((n) => 'tagName' in n) as Elemento, dic);
    assert.doesNotMatch(pagina, /patrocin|ganador|guanyador|premiad/i);
    assert.match(pagina, /Equip[o]? Faro/);
    assert.match(limpio(colaboradores, dic), /Compra Pública Innovadora 2026/);
  }
  assert.match(limpio(colaboradores, es), /Fuente de los datos: ODEE y Cambra de Comerç de Barcelona\./);
  assert.match(limpio(colaboradores, ca), /Font de les dades: ODEE i Cambra de Comerç de Barcelona\./);
  // La tabla del ODEE también los cita a los dos en la categoría de datos.
  const cambra = todos(documento, (e) => atributo(e, 'id') === 'f-cambra')[0] as Elemento;
  assert.match(limpio(cambra), /Fuente de los datos: ODEE y Cambra de Comerç de Barcelona\./);
});
