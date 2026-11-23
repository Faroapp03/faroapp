// Las páginas de «Datos globales» con el DOM de prueba, en castellano y en catalán: lo que pintan la de los países
// (scripts/datos-globales.js) y la de la Unión Europea (scripts/datos-globales-ue.js) con sus piezas y muestras fijas;
// también comprueba el archivo publicado y que, si los datos no llegan, no se enseña ninguna cifra. La lectura
// del archivo se prueba en pruebas/conectividad/datos-globales-lector.test.ts, y las cifras y los titulares, en
// pruebas/web-datos-globales-comunes/cifras.test.ts y pruebas/web-datos-globales-comunes/comparabilidad.test.ts.
// Se ejecutan con node --test pruebas/web-datos-globales-capitulos/*.test.js.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { after, test } from 'node:test';
import es from '../../web/idiomas/es.js';
import { CAPITULOS, INDICADORES, numeroDelCapitulo } from '../../web/scripts/datos-globales/capitulos.js';
import { leerDatosGlobales } from '../../web/scripts/datos-globales/datos.js';
import {
  almacenEnMemoria,
  CLASES_DE_NODO,
  definido,
  ElementoDePrueba,
  esperar,
  navegadorDePrueba,
  elemento as nodoDelDom,
  paginaDePrueba,
  sinRedDeVerdad,
} from './dom.ts';

sinRedDeVerdad();

const WEB = new URL('../../web/', import.meta.url);
const TEXTO_DE_LA_MUESTRA = readFileSync(new URL('../fixtures/datos-globales-muestra.json', import.meta.url), 'utf8');
/** Datos fijos del dossier: recorte de web/datos/datos-globales.json con los seis territorios del cuadro. */
const DOSSIER = readFileSync(new URL('../fixtures/datos-globales-dossier.json', import.meta.url), 'utf8');
/** Los datos publicados (web/datos/datos-globales.json): las cifras reales que enseña la página. */
const PUBLICADOS = readFileSync(new URL('../../web/datos/datos-globales.json', import.meta.url), 'utf8');
/**
 * Lo que pintan las páginas con los datos del dossier fijo: los capítulos, los titulares que se comprueban, las cifras
 * clave, las lecturas como mínimo, las barras y marcas de cada gráfico, las filas del cuadro y las metas.
 */
const CON_EL_DOSSIER = Object.freeze({
  capitulos: 8,
  titularesComprobados: 3,
  claves: 4,
  lecturasMinimas: 15,
  barrasDeLosPaises: 5,
  territoriosConLaUe: 6,
  territoriosSinFrancia: 5,
  barrasDeOpinionPositiva: 4,
  filasDelCuadro: 7,
  clavesDeLaUe: 4,
  metas: 4,
});
/** Una meta de capacidades digitales por debajo de la cifra de la UE: ya alcanzada. */
const META_ALCANZADA = 40;
/** La muestra como llega del JSON, para cambiarle un campo en cada prueba. @returns {import('./fixture-tipos.js').Crudos} */
function muestra() {
  return JSON.parse(TEXTO_DE_LA_MUESTRA);
}

// ---------- La página ----------

/** scripts/datos-globales.js, que se ejecuta tal cual salvo sitio.js: el idioma lo inicia la prueba. */
const PAGINA = new URL('../../web/scripts/datos-globales.js', import.meta.url);
/** scripts/datos-globales-ue.js, la página «Unión Europea», igual. */
const PAGINA_UE = new URL('../../web/scripts/datos-globales-ue.js', import.meta.url);
const hook = registerHooks({
  resolve(especificador, contexto, siguiente) {
    const desdeLaPagina = [PAGINA, PAGINA_UE].some((pagina) => contexto.parentURL?.startsWith(`${pagina.href}?`));
    if (!desdeLaPagina || especificador !== './sitio.js') {
      return siguiente(especificador, contexto);
    }
    return { url: 'data:text/javascript,', shortCircuit: true };
  },
});
after(() => hook.deregister());
const IDS = [
  'estado',
  'muestra',
  'preguntas',
  'indice',
  'resumen',
  'claves',
  'capitulos',
  'metodo',
  'todas-medidas',
  'fuentes',
  'consultadas',
  'paginas',
  'paginas-lista',
  'pagina-estado',
  'metodo-desplegable',
  'fuentes-desplegable',
].map((id) => `datos-globales-${id}`);
/** Lo que se espera a que la página pinte, y cada cuánto se mira. */
const ESPERA_DE_LA_PAGINA_MS = 5_000;
const PAUSA_MS = 5;

/**
 * El DOM de prueba de las páginas, con lo que pintan y el DOM de prueba no trae: estilos en línea (las barras ponen su
 * ancho con style.setProperty), elementos SVG (la línea de evolución) y la consulta de lo que se traduce.
 * @returns {ReturnType<typeof paginaDePrueba>}
 */
function domDeLasPaginas() {
  return paginaDePrueba({ ids: IDS });
}

/**
 * Espera a que la página deje de decir que carga, como mucho ESPERA_DE_LA_PAGINA_MS.
 * @param {ElementoDePrueba | undefined} estado el elemento de estado de la página
 */
async function esperarAQuePinte(estado) {
  for (let esperado = 0; esperado < ESPERA_DE_LA_PAGINA_MS; esperado += PAUSA_MS) {
    if (estado?.textContent !== 'Cargando los datos…') {
      return;
    }
    await esperar(PAUSA_MS);
  }
}

/**
 * Abre la página con el DOM de prueba y una red que sirve `respuesta` en datos/datos-globales.json. Cada apertura
 * importa la página otra vez (con su propia consulta en la dirección); `pagina` es la de los países o la de la UE, y
 * `hash`, el fragmento de la dirección.
 * @param {import('node:test').TestContext} contexto @param {() => Response} respuesta @param {string} vez
 * @param {{ pagina?: URL, hash?: string }} [opciones]
 * @returns {Promise<(id: string) => ElementoDePrueba>} el elemento de la página con el id `datos-globales-<id>`
 */
async function abrirLaPagina(contexto, respuesta, vez, { pagina = PAGINA, hash = '' } = {}) {
  const { documento, porId } = domDeLasPaginas();
  navegadorDePrueba(contexto, {
    ...CLASES_DE_NODO,
    document: documento,
    localStorage: almacenEnMemoria(),
    location: { href: `https://faroapp.org/datos-globales.html${hash}`, hash },
    fetch: async (/** @type {URL} */ direccion) =>
      direccion.pathname === '/datos/datos-globales.json' ? respuesta() : new Response('', { status: 404 }),
  });
  const { iniciarIdioma } = await import('../../web/scripts/idioma.js');
  await iniciarIdioma();
  await import(`${pagina.href}?${vez}`);
  await esperarAQuePinte(porId.get('datos-globales-estado'));
  return (id) => nodoDelDom(porId.get(`datos-globales-${id}`));
}

/** Los capítulos que ha pintado la página. @param {(id: string) => ElementoDePrueba} elemento */
function capitulosDe(elemento) {
  return elemento('capitulos').querySelectorAll('section.dg-capitulo');
}

/** El texto de cada elemento que cumple `selector` dentro de `raiz`. @param {ElementoDePrueba | undefined} raiz @param {string} selector */
function textos(raiz, selector) {
  return nodoDelDom(raiz)
    .querySelectorAll(selector)
    .map((nodo) => nodo.textContent);
}

/** Un capítulo por su id («empresas» → section#dg-empresas). @param {(id: string) => ElementoDePrueba} elemento @param {string} id */
function capituloDe(elemento, id) {
  return nodoDelDom(capitulosDe(elemento).find((capitulo) => capitulo.id === `dg-${id}`));
}

/** El texto de un capítulo sin su ficha técnica (el método puede nombrar lo que no se muestra). @param {ElementoDePrueba} capitulo */
function sinFicha(capitulo) {
  return capitulo.children
    .flatMap((hijo) => hijo.children)
    .filter((hijo) => !hijo.classList.contains('dg-ficha'))
    .map((hijo) => hijo.textContent)
    .join(' ');
}

/** El dossier fijo con un cambio. @param {(datos: import('./fixture-tipos.js').Crudos) => void} cambiar */
function dossierCon(cambiar) {
  /** @type {import('./fixture-tipos.js').Crudos} */
  const datos = JSON.parse(DOSSIER);
  cambiar(datos);
  return JSON.stringify(datos);
}

/**
 * El titular de cada capítulo recibe el foco y el capítulo acaba con «Volver a las preguntas».
 * @param {ReturnType<typeof capitulosDe>} capitulos
 */
function comprobarFocoYVuelta(capitulos) {
  for (const capitulo of capitulos) {
    const titulo = nodoDelDom(capitulo.querySelector('h2'));
    assert.equal(titulo.getAttribute('tabindex'), '-1', `${capitulo.id}: el titular recibe el foco`);
    const volver = nodoDelDom(capitulo.querySelector('p.dg-volver a'));
    assert.equal(volver.getAttribute('href'), '#dg-indice-titulo');
    assert.equal(volver.textContent, 'Volver a las preguntas');
  }
}

/** Método, Fuentes y la página de la UE no son capítulos: ni número propio ni sitio en el índice. */
function comprobarQueNoSonCapitulos() {
  assert.throws(() => numeroDelCapitulo('metodo'), RangeError);
  assert.throws(() => numeroDelCapitulo('fuentes'), RangeError);
  assert.doesNotMatch(
    readFileSync(new URL('datos-globales.html', WEB), 'utf8'),
    /dg-desplegable-numero|dg-capitulo-numero">(09|10)</u,
  );
  assert.throws(() => numeroDelCapitulo('ue'), RangeError);
}

test('el dossier: ocho capítulos numerados, cada uno con su pregunta, su titular-respuesta y «Volver a las preguntas»', async (contexto) => {
  const elemento = await abrirLaPagina(contexto, () => new Response(DOSSIER), 'dossier');
  assert.equal(elemento('estado').textContent, '');
  const capitulos = capitulosDe(elemento);
  assert.deepEqual(
    capitulos.map((capitulo) => capitulo.id),
    CAPITULOS.map((id) => `dg-${id}`),
  );
  assert.deepEqual(
    capitulos.map((capitulo) => capitulo.querySelector('p.dg-capitulo-numero')?.textContent),
    ['01', '02', '03', '04', '05', '06', '07', '08'],
  );
  assert.deepEqual(textos(elemento('capitulos'), 'p.dg-pregunta'), [
    '¿Cuántas empresas usan IA?',
    '¿Cuánta gente usa la IA generativa?',
    '¿Hay diferencias entre mujeres y hombres?',
    '¿Cambia según el tipo de trabajo?',
    '¿Cuánta gente adulta se está formando?',
    '¿Qué opina la gente de la IA en el trabajo?',
    '¿En qué puestos se usa la IA dentro de las empresas catalanas?',
    'Todas las cifras en una tabla',
  ]);
  assert.deepEqual(textos(elemento('capitulos'), 'h2').slice(0, CON_EL_DOSSIER.titularesComprobados), [
    'Casi 1 de cada 4 empresas catalanas ya usan IA: más del doble que en 2023',
    'Casi la mitad de quienes usan internet en Cataluña ya usa IA generativa',
    'Sí: en Cataluña la usan 49 de cada 100 hombres y 43 de cada 100 mujeres',
  ]);
  comprobarFocoYVuelta(capitulos);
  const [anio, mes, dia] = JSON.parse(DOSSIER).generado.split('-');
  assert.equal(elemento('consultadas').textContent, `Fecha de consulta: ${dia}/${mes}/${anio}.`);
  assert.equal(elemento('preguntas').hidden, false);
  comprobarQueNoSonCapitulos();
});

test('los datos publicados pintan los capítulos y la fecha de consulta en las dos páginas', async (contexto) => {
  const aviso = contexto.mock.method(console, 'warn', () => {});
  const [anio, mes, dia] = JSON.parse(PUBLICADOS).generado.split('-');
  for (const { pagina, vez, prefijo, numero } of [
    { pagina: PAGINA, vez: 'publicados-paises', prefijo: 'dg-', numero: 8 },
    { pagina: PAGINA_UE, vez: 'publicados-ue', prefijo: 'dg-ue-', numero: 10 },
  ]) {
    const elemento = await abrirLaPagina(contexto, () => new Response(PUBLICADOS), vez, { pagina });
    assert.equal(elemento('estado').textContent, '');
    const capitulos = capitulosDe(elemento);
    assert.equal(capitulos.length, numero);
    assert.ok(capitulos.every((capitulo) => capitulo.id.startsWith(prefijo) && capitulo.querySelector('h2')));
    assert.equal(elemento('consultadas').textContent, `Fecha de consulta: ${dia}/${mes}/${anio}.`);
  }
  assert.equal(aviso.mock.calls.length, 0);
});

test('el índice: una pregunta sencilla por capítulo, sin cifras, que enlaza con su titular', async (contexto) => {
  const elemento = await abrirLaPagina(contexto, () => new Response(DOSSIER), 'indice');
  const entradas = elemento('indice').querySelectorAll('li a');
  assert.equal(entradas.length, CON_EL_DOSSIER.capitulos);
  for (const [i, entrada] of entradas.entries()) {
    const capitulo = nodoDelDom(capitulosDe(elemento)[i]);
    assert.equal(entrada.getAttribute('href'), `#${capitulo.querySelector('h2')?.id}`);
    assert.equal(entrada.getAttribute('data-dg-salto'), '');
    assert.equal(
      entrada.querySelector('span.dg-indice-pregunta')?.textContent,
      capitulo.querySelector('p.dg-pregunta')?.textContent,
    );
    assert.doesNotMatch(entrada.querySelector('span.dg-indice-pregunta')?.textContent ?? '', /\d/u, 'sin cifras');
  }
});

test('la portada es mínima: título, entradilla, prudencia y clave de colores; sin «Edición» ni «Cómo leer las cifras»', () => {
  for (const archivo of ['datos-globales.html', 'datos-globales-ue.html']) {
    const html = readFileSync(new URL(archivo, WEB), 'utf8');
    assert.doesNotMatch(html, /dg-portada-datos|datos-globales-edicion|dg-leer|datos-globales-leer/, archivo);
    assert.match(html, /<header class="dg-portada dg-portada--sola">/, archivo);
    assert.match(html, /class="dg-prudencia"/, archivo);
    assert.match(html, /class="dg-clave-colores"/, archivo);
    assert.match(html, /id="dg-indice-titulo" tabindex="-1"/, archivo);
  }
  const paises = readFileSync(new URL('datos-globales.html', WEB), 'utf8');
  assert.match(paises, /data-texto="datos-globales\.clave-colores\.nota"/);
  assert.match(paises, /<p data-texto="datos-globales\.margen"/, 'el margen de error, en la cabecera de «Lo esencial»');
});

test('ninguna cifra sin su frase: «Lo esencial» y las lecturas dicen «de cada 100», y los puntos se explican', async (contexto) => {
  const elemento = await abrirLaPagina(contexto, () => new Response(DOSSIER), 'frases');
  const tarjetas = elemento('claves').querySelectorAll('li');
  assert.equal(tarjetas.length, CON_EL_DOSSIER.claves, 'cuatro cifras clave, ni una más');
  assert.deepEqual(textos(elemento('claves'), 'p.dg-esencial-tema'), [
    'Empresas · 2025',
    'Personas · 2025',
    'Para trabajar · 2025',
    'Mujeres y hombres · 2025',
  ]);
  assert.equal(
    textos(elemento('claves'), 'p.dg-esencial-significado')[0],
    'Es decir, 24 de cada 100 empresas catalanas con 10 o más personas usan alguna tecnología de IA.',
  );
  for (const significado of textos(elemento('claves'), 'p.dg-esencial-significado')) {
    assert.match(significado, /de cada 100/u);
  }
  assert.equal(textos(elemento('claves'), 'p.dg-esencial-cifra')[3], '6,1puntos');
  assert.match(
    textos(elemento('claves'), 'p.dg-esencial-pie')[3] ?? '',
    /^Puntos: la resta entre las dos cifras de cada 100 \(49 − 43 ≈ 6\)\.$/u,
  );
  const lecturas = elemento('capitulos').querySelectorAll('ul.dg-lectura li span');
  assert.ok(lecturas.length >= CON_EL_DOSSIER.lecturasMinimas);
  for (const lectura of lecturas) {
    if (/\d/u.test(lectura.textContent.replace(/\b(19|20)\d\d\b/gu, ''))) {
      assert.match(lectura.textContent, /de cada 100|puntos|veces/iu, lectura.textContent);
    }
  }
  assert.equal(elemento('capitulos').querySelectorAll('div.dg-diferencia').length, 0, 'sin tarjetas laterales');
});

test('series de empresas desde 2023: sin 2021, Francia 2023 fuera y dicho, y los datos por año a la vista', async (contexto) => {
  const elemento = await abrirLaPagina(contexto, () => new Response(DOSSIER), 'series');
  const empresas = capituloDe(elemento, 'empresas');
  assert.doesNotMatch(sinFicha(empresas), /2021|×2,6/u, 'ni 2021 ni cálculos con 2021');
  const anual = nodoDelDom(empresas.querySelector('table.dg-tabla-anual'));
  assert.deepEqual(textos(anual, 'thead th'), ['Territorio', '2023', '2024', '2025']);
  const filas = anual.querySelectorAll('tbody tr').map((fila) => fila.children.map((celda) => celda.textContent));
  assert.deepEqual(
    filas.map(([nombre]) => nombre),
    ['Cataluña', 'España (con Cataluña)', 'Alemania', 'Francia', 'Italia', 'UE-27 (media)'],
  );
  assert.deepEqual(filas[0], ['Cataluña', '10,7', '14,0', '24,0']);
  assert.match(filas[3]?.[1] ?? '', /^—Sin dato comparable$/u, 'Francia 2023 no se muestra');
  assert.match(sinFicha(empresas), /Sin dato comparable: 2023, en Francia\. No se muestra\./u);
  const ficha = textos(empresas, 'dd').join(' ');
  assert.match(
    ficha,
    /2021, en todos los territorios con dato; 2023, en Francia/u,
    'el método dice lo que queda fuera',
  );
  assert.match(ficha, /diferencias de uno o dos puntos pueden no ser reales/u);
  const formacion = capituloDe(elemento, 'formacion');
  const anos = textos(nodoDelDom(formacion.querySelector('table.dg-tabla-anual')), 'thead th');
  assert.deepEqual(anos, ['Territorio', '2022', '2023', '2024', '2025'], 'formación sin la ruptura de 2021');
  assert.match(sinFicha(formacion), /2024, en Alemania y Francia/u);
});

test('la comparación: España (con Cataluña), la media de la UE como raya de referencia y los colores por su clase', async (contexto) => {
  const elemento = await abrirLaPagina(contexto, () => new Response(DOSSIER), 'comparacion');
  const personas = capituloDe(elemento, 'personas');
  const [cualquier, trabajo] = personas.querySelectorAll('div.dg-panel svg');
  assert.ok(cualquier && trabajo, 'dos paneles');
  const nombres = (/** @type {ElementoDePrueba} */ svg) =>
    svg
      .querySelectorAll('text')
      .filter((texto) => !texto.classList.contains('eje'))
      .map((texto) => texto.textContent);
  assert.deepEqual(
    nombres(cualquier).filter((n) => /^[A-ZÀ-Ú]/u.test(n)),
    ['Cataluña', 'Francia', 'España', 'Alemania', 'Italia', 'Media de la UE: 34,8'],
  );
  assert.ok(textos(cualquier, 'text.eje').includes('(con Cataluña)'));
  assert.equal(
    cualquier.querySelectorAll('rect.barra').length,
    CON_EL_DOSSIER.barrasDeLosPaises,
    'la UE no es una barra más',
  );
  assert.equal(cualquier.querySelectorAll('line.raya-ue').length, 1);
  assert.ok(cualquier.querySelector('rect.barra')?.classList.contains('c-cat'), 'Cataluña, la primera y en su color');
  assert.deepEqual(
    textos(cualquier, 'text.eje').filter((t) => /^\d/u.test(t)),
    textos(trabajo, 'text.eje').filter((t) => /^\d/u.test(t)),
    'misma escala en los dos paneles',
  );
  const tokens = readFileSync(new URL('estilos/tokens.css', WEB), 'utf8');
  for (const token of ['--dato-cataluna', '--dato-ue', '--dato-gris', '--dato-pista']) {
    assert.match(tokens, new RegExp(`${token}: light-dark\\(#[0-9a-f]{6}, #[0-9a-f]{6}\\);`), token);
  }
  const graficos = readFileSync(new URL('estilos/datos-globales-graficos.css', WEB), 'utf8');
  assert.match(
    graficos,
    /\.dg-svg \.raya-ue \{\n\s*stroke: var\(--dato-ue\);\n\s*stroke-width: 2;\n\s*stroke-dasharray/u,
  );
  for (const hoja of ['estilos/datos-globales.css', 'estilos/datos-globales-graficos.css']) {
    assert.doesNotMatch(
      readFileSync(new URL(hoja, WEB), 'utf8'),
      /#[0-9a-f]{3,6}\b/iu,
      `${hoja}: ningún color escrito`,
    );
  }
});

test('mujeres y hombres se distinguen por la forma: círculo y cuadrado, con la diferencia en puntos', async (contexto) => {
  const elemento = await abrirLaPagina(contexto, () => new Response(DOSSIER), 'pesas');
  const genero = capituloDe(elemento, 'genero');
  const svg = nodoDelDom(genero.querySelector('svg'));
  assert.equal(
    svg.querySelectorAll('circle.punto').length,
    CON_EL_DOSSIER.territoriosConLaUe,
    'cinco territorios y la UE',
  );
  assert.equal(svg.querySelectorAll('rect.punto').length, CON_EL_DOSSIER.territoriosConLaUe);
  assert.ok(textos(svg, 'text').includes('6,1 puntos'));
  assert.deepEqual(textos(genero, 'div.dg-interruptor button'), ['Para cualquier uso', 'Para su trabajo']);
  const ocupacion = capituloDe(elemento, 'ocupacion');
  assert.match(sinFicha(ocupacion), /Francia no publica este dato en 2025 \(sí hasta 2024\)\./u);
  assert.equal(
    nodoDelDom(ocupacion.querySelector('svg')).querySelectorAll('circle.punto').length,
    CON_EL_DOSSIER.territoriosSinFrancia,
    'Francia no sale como fila vacía',
  );
});

test('un primer puesto exige un punto de ventaja: la formación de Cataluña (16,2 frente a 15,8) no es «la más alta»', async (contexto) => {
  const elemento = await abrirLaPagina(contexto, () => new Response(DOSSIER), 'ranking');
  assert.equal(
    capituloDe(elemento, 'formacion').querySelector('h2')?.textContent,
    '16 de cada 100 adultos de Cataluña hicieron algún curso en el último mes',
  );
  const empresas = capituloDe(elemento, 'empresas');
  assert.match(sinFicha(empresas), /Alemania, por delante/u);
});

test('06 · Opinión: barras tenues en enteros, la UE como referencia y Cataluña en una nota, nunca en una fila', async (contexto) => {
  const elemento = await abrirLaPagina(contexto, () => new Response(DOSSIER), 'opinion');
  const opinion = capituloDe(elemento, 'opinion');
  const [positiva] = opinion.querySelectorAll('div.dg-panel svg');
  assert.ok(positiva);
  assert.equal(positiva.querySelectorAll('rect.b-opinion').length, CON_EL_DOSSIER.barrasDeOpinionPositiva);
  assert.ok(textos(positiva, 'text').includes('Media de la UE: 62'));
  assert.ok(['65', '61', '56', '53'].every((cifra) => textos(positiva, 'text').includes(cifra)));
  assert.equal(opinion.querySelector('span.dg-opinion')?.textContent, '○ Encuesta de opinión');
  assert.match(sinFicha(opinion), /Cataluña: otra encuesta \(la del CEO\) hace otra pregunta/u);
  assert.ok(!textos(positiva, 'text').includes('Cataluña'), 'Cataluña no sale como fila');
});

test('el cuadro: una fila por territorio, España (con Cataluña) y la media de la UE al final', async (contexto) => {
  const elemento = await abrirLaPagina(contexto, () => new Response(DOSSIER), 'cuadro');
  const cuadro = capituloDe(elemento, 'cuadro');
  const filas = cuadro.querySelectorAll('tr').map((fila) => fila.children.map((celda) => celda.textContent));
  assert.equal(filas.length, CON_EL_DOSSIER.filasDelCuadro);
  assert.deepEqual(filas[1], ['Cataluña', '24,0', '46,0', '24,3', '16,2']);
  assert.equal(filas[2]?.[0], 'España (con Cataluña)');
  assert.equal(filas[6]?.[0], 'UE-27 (media)');
  const [marco] = cuadro.querySelectorAll('div.dg-cuadro-marco');
  assert.deepEqual(
    ['tabindex', 'role', 'aria-labelledby'].map((a) => marco?.getAttribute(a)),
    ['0', 'region', 'dg-cuadro-leyenda'],
  );
});

test('sin un dato, el capítulo no deja huecos ni cifras inventadas', async (contexto) => {
  const texto = dossierCon((datos) => {
    const espana = definido(datos.territorios.find(({ codigo }) => codigo === 'ESP'));
    espana.valores = espana.valores.filter(({ indicador }) => indicador !== INDICADORES.personasTrabajo);
  });
  const elemento = await abrirLaPagina(contexto, () => new Response(texto), 'sin-trabajo');
  const personas = capituloDe(elemento, 'personas');
  assert.doesNotMatch(personas.textContent, /undefined|NaN|\{[a-z]+\}/u);
  assert.match(sinFicha(personas), /España: sin cifra publicada para 2025\.|Para su trabajo/u);
});

test('en catalán se reescriben las preguntas, los titulares, los nombres y los rótulos de los gráficos', async (contexto) => {
  const elemento = await abrirLaPagina(contexto, () => new Response(DOSSIER), 'catalan');
  const { cambiarIdioma } = await import('../../web/scripts/idioma.js');
  await cambiarIdioma('ca');
  try {
    const empresas = capituloDe(elemento, 'empresas');
    assert.equal(empresas.querySelector('p.dg-pregunta')?.textContent, 'Quantes empreses fan servir IA?');
    assert.equal(
      empresas.querySelector('h2')?.textContent,
      'Gairebé 1 de cada 4 empreses catalanes ja fan servir IA: més del doble que el 2023',
    );
    assert.ok(textos(empresas, 'tbody th').includes('Espanya (amb Catalunya)'));
    assert.equal(
      elemento('indice').querySelector('span.dg-indice-pregunta')?.textContent,
      'Quantes empreses fan servir IA?',
    );
    assert.match(
      textos(elemento('claves'), 'p.dg-esencial-significado')[0] ?? '',
      /^És a dir, 24 de cada 100 empreses catalanes/u,
    );
    const svg = nodoDelDom(capituloDe(elemento, 'personas').querySelector('svg'));
    assert.ok(textos(svg, 'text').includes('Mitjana de la UE: 34,8'), 'el SVG se redibuja en catalán');
  } finally {
    await cambiarIdioma('es');
  }
});

test('si los datos no llegan, lo dice el estado y no se enseña ninguna cifra', async (contexto) => {
  const aviso = contexto.mock.method(console, 'warn', () => {});
  const elemento = await abrirLaPagina(contexto, () => new Response('', { status: 404 }), 'sin-datos');
  assert.equal(aviso.mock.calls.length, 1, 'el fallo deja su aviso técnico');
  assert.match(elemento('estado').textContent, /^Los datos globales no están disponibles ahora/);
  assert.equal(elemento('capitulos').children.length, 0);
  assert.equal(elemento('indice').children.length, 0);
  assert.equal(elemento('consultadas').textContent, '', 'sin datos tampoco hay fecha de consulta');
});

// ---------- La página «Unión Europea» ----------

/** Abre la página de la UE. @param {import('node:test').TestContext} contexto @param {string} texto @param {string} vez */
function abrirLaUe(contexto, texto, vez) {
  return abrirLaPagina(contexto, () => new Response(texto), vez, { pagina: PAGINA_UE });
}

/** Un capítulo de la UE por su id. @param {(id: string) => ElementoDePrueba} elemento @param {string} id */
function capituloUeDe(elemento, id) {
  return capituloDe(elemento, `ue-${id}`);
}

test('la UE: diez capítulos con su pregunta, «Lo esencial» con cuatro cifras y la UE en su color', async (contexto) => {
  const elemento = await abrirLaUe(contexto, DOSSIER, 'ue');
  const capitulos = capitulosDe(elemento);
  assert.deepEqual(
    capitulos.map((capitulo) => capitulo.querySelector('p.dg-capitulo-numero')?.textContent),
    ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'],
  );
  assert.equal(elemento('indice').querySelectorAll('li a').length, 10);
  assert.equal(elemento('claves').querySelectorAll('li.dg-esencial-tarjeta--ue').length, CON_EL_DOSSIER.clavesDeLaUe);
  assert.equal(
    capituloUeDe(elemento, 'empresas').querySelector('h2')?.textContent,
    '1 de cada 5 empresas de la UE ya usan IA: más del doble que en 2023',
  );
  assert.equal(
    capituloUeDe(elemento, 'metas').querySelector('h2')?.textContent,
    'A cinco años de 2030, la UE no ha alcanzado ninguna de sus cuatro metas digitales',
  );
  const html = readFileSync(new URL('datos-globales-ue.html', WEB), 'utf8');
  assert.match(html, /<h1 data-texto="datos-globales\.ue\.titulo">La Unión Europea<\/h1>/);
  assert.match(html, /<p data-texto="datos-globales\.ue\.esencial\.nota"/);
  assert.doesNotMatch(readFileSync(new URL('datos-globales.html', WEB), 'utf8'), /id="datos-globales-ue"/);
});

test('la UE: la serie de empresas empieza en 2023, sin «×2,6» ni «En 2021 eran 8», y la ficha dice qué no se muestra', async (contexto) => {
  const elemento = await abrirLaUe(contexto, DOSSIER, 'ue-empresas');
  const empresas = capituloUeDe(elemento, 'empresas');
  assert.doesNotMatch(sinFicha(empresas), /2021|×2,6/u);
  assert.match(textos(empresas, 'dd').join(' '), /^.*2021\. La fuente marca esas cifras como no comparables/u);
  assert.doesNotMatch(nodoDelDom(elemento('claves').querySelectorAll('li')[0]).textContent, /2021|eran 8/u);
  assert.match(textos(elemento('claves'), 'p.dg-esencial-pie')[0] ?? '', /^Desde 2023:/u);
});

test('la UE · metas: cada barra con su escala real y lo que falta; una meta no es una previsión', async (contexto) => {
  const elemento = await abrirLaUe(contexto, DOSSIER, 'ue-metas');
  const metas = capituloUeDe(elemento, 'metas');
  assert.equal(metas.querySelectorAll('div.dg-meta-fila').length, CON_EL_DOSSIER.metas);
  assert.deepEqual(textos(metas, 'p.dg-meta-falta').slice(0, 2), [
    'Faltan 19,6 puntos para la meta del 80 %.',
    'Faltan 9,5 millones para la meta de 20 millones.',
  ]);
  const [capacidades] = metas.querySelectorAll('svg');
  assert.ok(textos(nodoDelDom(capacidades), 'text').includes('100 %'), 'escala de 0 a 100 %');
  assert.match(sinFicha(metas), /Una meta no es una previsión/u);
  const alcanzada = await abrirLaUe(
    contexto,
    dossierCon((datos) => {
      const meta = definido(datos.metas.find(({ id }) => id === 'meta-capacidades-digitales'));
      meta.valor = META_ALCANZADA;
    }),
    'ue-meta-alcanzada',
  );
  assert.equal(textos(capituloUeDe(alcanzada, 'metas'), 'p.dg-meta-falta')[0], 'Meta alcanzada');
});

test('la UE · opinión: cada pregunta con cifra, de mayor a menor; una nueva sale sola con el nombre del archivo', async (contexto) => {
  const datos = muestra();
  datos.encuestas.push({
    ...definido(datos.encuestas[0]),
    id: 'opinion-ue-regla-b',
    nombre: { es: 'Nombre de la regla B', ca: 'Nom de la regla B' },
    pregunta: 'QB11.9. Rule B',
    valores: [{ territorio: 'EU27_2020', valor: 72, anio: 2024, nota: null }],
  });
  const elemento = await abrirLaUe(contexto, JSON.stringify(datos), 'ue-opinion');
  const opinion = capituloUeDe(elemento, 'opinion');
  const paneles = opinion.querySelectorAll('div.dg-panel');
  assert.equal(paneles.length, 2, 'frases y reglas');
  assert.ok(textos(nodoDelDom(paneles[1]), 'text').includes('Nombre de la regla B'));
  assert.match(sinFicha(opinion), /\(QB5, QB6\.1, QB11\.9\)/u);
});

test('la UE: sin una cifra, el titular no afirma y la ficha quita su apartado; nunca escribe un 0', async (contexto) => {
  const quitadas = new Set([
    'empresas-ia-robots',
    'empresas-ia-motivo-dudas-legales',
    'ia-generativa-no-la-usa-privacidad-seguridad',
  ]);
  const texto = dossierCon((datos) => {
    const ue = definido(datos.territorios.find(({ codigo }) => codigo === 'EU27_2020'));
    ue.valores = ue.valores.filter(({ indicador }) => !quitadas.has(indicador));
  });
  const elemento = await abrirLaUe(contexto, texto, 'ue-sin');
  const tecnologias = capituloUeDe(elemento, 'tecnologias');
  assert.equal(tecnologias.querySelector('h2')?.textContent, es['datos-globales.ue.tecnologias.titular.neutro']);
  for (const capitulo of [tecnologias, capituloUeDe(elemento, 'personas')]) {
    const ficha = textos(capitulo, 'dd').join('\n');
    assert.doesNotMatch(ficha, /(?<![\d,])0(,0)?( %|\))/u, 'ninguna cifra inventada como 0');
    assert.doesNotMatch(ficha, /dudas sobre las consecuencias legales|preocupa la privacidad/u, 'sin su apartado');
  }
});

test('la UE · fichas: la cifra anterior con el año del archivo y, si falta, «sin dato», nunca un 0', async (contexto) => {
  const fichas = async (/** @type {string} */ texto, /** @type {string} */ vez) => {
    const elemento = await abrirLaUe(contexto, texto, vez);
    return ['metas', 'especialistas'].map((id) =>
      textos(capituloUeDe(elemento, id), 'dd').find((frase) => /versión 4|lo pregunta cada dos años/.test(frase ?? '')),
    );
  };
  const [pymes, vacantes] = await fichas(DOSSIER, 'ue-fichas');
  assert.match(pymes ?? '', /La versión 4 \(años pares\) dio el 72,9 % en 2024; las dos versiones/);
  assert.equal(vacantes, 'La encuesta lo pregunta cada dos años (2022: 62,9 % con vacantes difíciles).');
  const sinVersion4 = dossierCon((datos) => {
    const ue = definido(datos.territorios.find(({ codigo }) => codigo === 'EU27_2020'));
    ue.valores = ue.valores.filter(({ indicador }) => indicador !== 'pymes-intensidad-digital-basica-v4');
  });
  const [sinPymes] = await fichas(sinVersion4, 'ue-fichas-sin-dato');
  assert.match(sinPymes ?? '', /La versión 4 \(años pares\), sin dato; las dos versiones/);
});

test('cada indicador que nombran los capítulos existe en los datos publicados: una errata no vacía un capítulo', async (contexto) => {
  const { documento } = paginaDePrueba();
  navegadorDePrueba(contexto, { document: documento });
  const { INDICADORES_UE } = await import('../../web/scripts/datos-globales/union-europea-indicadores.js');
  const publicados = leerDatosGlobales(JSON.parse(PUBLICADOS));
  const ids = new Set(publicados.indicadores.map(({ id }) => id));
  assert.deepEqual(
    [...Object.values(INDICADORES), ...Object.values(INDICADORES_UE)].filter((id) => !ids.has(id)),
    [],
  );
});

test('la ficha de un indicador que no está en los datos no lo marca «medido»: dice que no hay cifra', async (contexto) => {
  const { documento } = paginaDePrueba();
  navegadorDePrueba(contexto, { document: documento });
  const { marcaDeIndicador } = await import('../../web/scripts/datos-globales/seccion.js');
  const datos = leerDatosGlobales(muestra());
  assert.equal(marcaDeIndicador(datos, 'no-esta-en-los-datos').textContent, es['datos-globales.sin-cifra']);
  assert.notEqual(marcaDeIndicador(datos, INDICADORES.empresas).textContent, es['datos-globales.sin-cifra']);
});

test('paginación: un capítulo por página, con los números del índice, aria-current y el paso anunciado', async (contexto) => {
  const elemento = await abrirLaPagina(contexto, () => new Response(DOSSIER), 'paginas');
  const botones = elemento('paginas-lista').querySelectorAll('button.dg-pagina');
  assert.deepEqual(
    botones.map((boton) => boton.textContent),
    ['1', '2', '3', '4', '5', '6', '7', '8'],
  );
  assert.equal(elemento('paginas').hidden, false);
  assert.deepEqual(
    capitulosDe(elemento).map((capitulo) => capitulo.hidden),
    [false, true, true, true, true, true, true, true],
  );
  assert.equal(botones[0]?.getAttribute('aria-current'), 'page');
  assert.equal(botones[1]?.getAttribute('aria-label'), 'Página 2 de 8');
  botones[1]?.dispatchEvent(new Event('click'));
  assert.deepEqual(
    capitulosDe(elemento).map((capitulo) => capitulo.hidden),
    [true, false, true, true, true, true, true, true],
  );
  assert.equal(botones[1]?.getAttribute('aria-current'), 'page');
  assert.equal(botones[0]?.getAttribute('aria-current'), null);
  assert.equal(elemento('pagina-estado').textContent, 'Página 2 de 8');
  assert.equal(elemento('metodo').hidden, false, 'Método y Fuentes, siempre a la vista');
  const html = readFileSync(new URL('datos-globales.html', WEB), 'utf8');
  assert.ok(
    html.indexOf('id="datos-globales-paginas"') < html.indexOf('id="datos-globales-metodo"'),
    'la barra, antes del método',
  );
});

test('paginación: una dirección con fragmento abre la página de su capítulo', async (contexto) => {
  const elemento = await abrirLaPagina(contexto, () => new Response(DOSSIER), 'fragmento', {
    hash: '#dg-genero-titulo',
  });
  assert.deepEqual(
    capitulosDe(elemento).map((capitulo) => capitulo.hidden),
    [true, true, false, true, true, true, true, true],
  );
  assert.equal(elemento('paginas-lista').querySelectorAll('button.dg-pagina')[2]?.getAttribute('aria-current'), 'page');
});

test('paginación en la UE: diez páginas, una por pregunta', async (contexto) => {
  const elemento = await abrirLaPagina(contexto, () => new Response(DOSSIER), 'ue-paginas', { pagina: PAGINA_UE });
  assert.equal(elemento('paginas-lista').querySelectorAll('button.dg-pagina').length, 10);
  assert.equal(capitulosDe(elemento).filter((capitulo) => !capitulo.hidden).length, 1);
});

test('la pestaña de esta página se llama «Cataluña» (y «Catalunya»), en las tres páginas y en el mismo orden', () => {
  for (const archivo of ['datos-globales.html', 'datos-globales-ue.html', 'datos-globales-mundo.html']) {
    const html = readFileSync(new URL(archivo, WEB), 'utf8');
    assert.match(html, /data-texto="datos-globales\.pestanas\.paises"\s*>Cataluña<\/a/u, archivo);
    assert.doesNotMatch(html, /Cataluña y países/u, archivo);
  }
  assert.equal(es['datos-globales.pestanas.paises'], 'Cataluña');
});

test('paginación: «Anterior» y «Siguiente» con su nombre en castellano y catalán, desactivados en los extremos', async (contexto) => {
  const elemento = await abrirLaPagina(contexto, () => new Response(DOSSIER), 'pasos');
  const [anterior, siguiente] = elemento('paginas-lista').querySelectorAll('button.dg-paso');
  assert.ok(anterior && siguiente);
  assert.equal(anterior.getAttribute('aria-label'), 'Página anterior');
  assert.equal(anterior.hasAttribute('disabled'), true);
  siguiente.dispatchEvent(new Event('click'));
  assert.deepEqual(
    capitulosDe(elemento)
      .map((capitulo) => capitulo.hidden)
      .slice(0, 2),
    [true, false],
    'avanza',
  );
  assert.equal(elemento('pagina-estado').textContent, 'Página 2 de 8');
  assert.equal(anterior.hasAttribute('disabled'), false);
  anterior.dispatchEvent(new Event('click'));
  assert.equal(capitulosDe(elemento)[0]?.hidden, false, 'retrocede');
  for (const _ of capitulosDe(elemento)) {
    siguiente.dispatchEvent(new Event('click'));
  }
  assert.equal(siguiente.hasAttribute('disabled'), true, 'en la última, «Siguiente» desactivado');
  const { cambiarIdioma } = await import('../../web/scripts/idioma.js');
  await cambiarIdioma('ca');
  try {
    assert.deepEqual(
      [anterior, siguiente].map((paso) => paso.getAttribute('aria-label')),
      ['Pàgina anterior', 'Pàgina següent'],
    );
  } finally {
    await cambiarIdioma('es');
  }
});

/**
 * En el HTML de las dos páginas, los desplegables de Método y Fuentes van cerrados y sin número, y la de los países
 * los titula «Cómo comparamos» y «Fuentes».
 */
function comprobarDesplegablesEnElHtml() {
  for (const archivo of ['datos-globales.html', 'datos-globales-ue.html']) {
    const html = readFileSync(new URL(archivo, WEB), 'utf8');
    const desplegables = [...html.matchAll(/<details class="dg-desplegable"([^>]*)>/g)].map(
      ([, atributos]) => atributos ?? '',
    );
    assert.ok(desplegables.length >= 1, archivo);
    assert.ok(
      desplegables.every((atributos) => !/\bopen\b/.test(atributos)),
      `${archivo}: cerrados por defecto`,
    );
  }
  const paises = readFileSync(new URL('datos-globales.html', WEB), 'utf8');
  for (const archivo of ['datos-globales.html', 'datos-globales-ue.html']) {
    const resumenes = [
      ...readFileSync(new URL(archivo, WEB), 'utf8').matchAll(
        /<summary class="dg-desplegable-resumen"[\s\S]*?<\/summary/g,
      ),
    ].map(([resumen]) => resumen.replace(/<[^>]*>|\s+/g, ' ').trim());
    assert.ok(resumenes.length >= 1, archivo);
    for (const resumen of resumenes) {
      assert.doesNotMatch(resumen, /\d/u, `${archivo}: «${resumen}», sin número`);
    }
  }
  assert.match(
    paises,
    /<h2 id="t-dg-metodo"\s*><span data-texto="datos-globales\.metodo\.titulo">Cómo comparamos<\/span><\/h2/u,
  );
  assert.match(
    paises,
    /<h2 id="t-dg-fuentes"\s*><span data-texto="datos-globales\.fuentes\.titulo">Fuentes<\/span><\/h2/u,
  );
}

test('Método y Fuentes, desplegables cerrados, sin número y abajo del todo; el fragmento los abre', async (contexto) => {
  comprobarDesplegablesEnElHtml();
  const cerrada = await abrirLaPagina(contexto, () => new Response(DOSSIER), 'desplegables');
  assert.equal(cerrada('metodo-desplegable').hasAttribute('open'), false);
  const conFragmento = await abrirLaPagina(contexto, () => new Response(DOSSIER), 'desplegable-fragmento', {
    hash: '#datos-globales-metodo-desplegable',
  });
  assert.equal(conFragmento('metodo-desplegable').hasAttribute('open'), true, 'el fragmento abre su desplegable');
  assert.equal(conFragmento('fuentes-desplegable').hasAttribute('open'), false);
  // Abierto, el recuadro lateral de «Cómo comparamos» no puede pasar del ancho del dossier (se salía a 2000 px).
  const hoja = readFileSync(new URL('estilos/datos-globales.css', WEB), 'utf8');
  assert.match(
    hoja,
    /\.dg-desplegable-cuerpo\.dg-dos-columnas \{\n\s*grid-template-columns: minmax\(0, 1\.5fr\) minmax\(0, 1fr\);/u,
  );
  assert.match(hoja, /\.pagina\.dg-dossier--datos \{\n\s*max-width: 1296px;/u);
});
