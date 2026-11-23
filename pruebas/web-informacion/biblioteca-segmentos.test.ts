// La Biblioteca por segmentos: tres pestañas por tipo (Guías, Informes y Notas), cada lectura en la de su tipo, en su
// orden y en una ficha con los datos de un vistazo (la ficha muestra el icono y el nombre del tipo,
// la fuente, el título enlazado al original, el resumen, «Por qué te puede interesar» y la franja Nivel · Lectura
// · Idioma · Se abre), las guías en preparación, y la variante «segmentos» del componente de etapas (scripts/etapas.js): sin
// controles al pie, sin pasos vistos, el apartado actual con aria-current="true" y cada fragmento en su segmento.
// También la barra de filtros (un solo desplegable, el nivel), la hoja plana y, con scripts/etapas.js y
// scripts/lecturas.js sobre la misma página, que el filtro y las páginas siguen al segmento que se ve sin romper las
// pestañas (el uso del desplegable y de las páginas está en pruebas/web-lecturas/filtros.test.js).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { after, type TestContext, test } from 'node:test';
import { leerRegistro } from '../../herramientas/web/lecturas/registro.ts';
import { generar } from '../../herramientas/web/lecturas.ts';
import ca from '../../web/idiomas/ca.js';
import es from '../../web/idiomas/es.js';
import { registrarDiccionario } from '../../web/scripts/textos.js';
import { entradaConSri } from '../ayudas/web-construida.ts';
import { navegador } from '../web-controles/ayudas.js';
import { abrirEtapas, Pieza, VISTA } from './etapas-doble.ts';

const hooks = registerHooks({
  load(url, contexto, siguiente) {
    if (url === new URL('../../web/scripts/sitio.js', import.meta.url).href) {
      return { format: 'module', source: '', shortCircuit: true };
    }
    return siguiente(url, contexto);
  },
});
after(() => hooks.deregister());

const PAGINA = readFileSync(new URL('../../web/biblioteca.html', import.meta.url), 'utf8');
const HOJA = readFileSync(new URL('../../web/estilos/etapas.css', import.meta.url), 'utf8');
const HOJA_LECTURAS = readFileSync(new URL('../../web/estilos/lecturas.css', import.meta.url), 'utf8');
const ETAPAS = new URL('../../web/scripts/etapas.js', import.meta.url);
const LECTURAS = new URL('../../web/scripts/lecturas.js', import.meta.url);
interface LecturaDelRegistro {
  id: string;
  nivel: string;
  tipo: string;
  fuente: string;
  idiomas: string[];
  minutos: number;
  enlace: string | null;
  enlace_ca?: string;
  formato?: { es: string };
  fecha: { iso: string | null; es: string };
  es: { titulo: string };
}
const REGISTRO: { lecturas: LecturaDelRegistro[] } = JSON.parse(
  readFileSync(new URL('../../datos/lecturas.json', import.meta.url), 'utf8'),
);

/** Los tres segmentos, en el orden de las pestañas: id, tipo y nombre en castellano y en catalán. */
const SEGMENTOS = [
  ['guias', 'guia', 'Guías', 'Guies'],
  ['informes', 'informe', 'Informes', 'Informes'],
  ['notas', 'nota', 'Notas', 'Notes'],
] as const;
/** Las lecturas propias en preparación (sin enlace) del registro: conservan su estado y su aspecto. */
const PENDIENTES = REGISTRO.lecturas.filter((lectura) => lectura.enlace === null).map(({ id }) => id);
/** Lecturas retiradas de la Biblioteca: no vuelven a ninguna etapa ni conservan textos en el diccionario. */
const RETIRADAS = ['como-leer-tu-informe-de', 'cursos-gratuitos-para-empezar'];
const NIVELES = ['empezar', 'profundizar', 'investigacion'];
/** Las etiquetas de los niveles, en castellano y en catalán. */
const ETIQUETAS = {
  empezar: ['Inicial', 'Inicial'],
  profundizar: ['Intermedio', 'Intermedi'],
  investigacion: ['Avanzado', 'Avançat'],
} as const;
const TIPOS = { guia: 'Guía', nota: 'Nota', informe: 'Informe' } as const;
/** Las posiciones de los segmentos, por su id. */
const POSICION = Object.fromEntries(SEGMENTOS.map(([id], posicion) => [id, posicion])) as Record<
  (typeof SEGMENTOS)[number][0],
  number
>;
const DATOS = new Map(REGISTRO.lecturas.map((lectura) => [lectura.id, lectura]));

registrarDiccionario('es', es);
registrarDiccionario('ca', ca);
let instancia = 0;
const cargar = () => import(`${ETAPAS.href}?biblioteca=${++instancia}`);
type Pagina = ReturnType<typeof abrirEtapas>;

/** El id de la lectura de una ficha (data-lectura). */
function idDe(entrada: Pieza): string {
  const id = entrada.dataset.lectura;
  assert.ok(id && DATOS.has(id), 'cada ficha lleva el id de su lectura');
  return id;
}
/** Lo que dice la casilla «Idioma» según los idiomas de la lectura. */
const IDIOMAS: Record<string, string> = {
  es: 'Castellano',
  ca: 'Catalán',
  'es-ca': 'Castellano y catalán',
  'es-ca-en': 'Castellano, catalán e inglés',
};
/** Las entradas de un segmento, en su orden. */
const entradasDe = (segmento: Pieza) => segmento.querySelectorAll('[data-filtrable]') as Pieza[];
/** El texto de un elemento, sin los espacios que sobran. */
const limpio = (pieza: { textContent: string }) => pieza.textContent.replace(/\s+/g, ' ').trim();
/** La posición de la etapa visible, comprobando que hay una sola y que su enlace es el único actual, con «true». */
function actual({ etapas, enlaces }: Pagina): number {
  const visibles = etapas.flatMap((etapa, posicion) => (etapa.classList.contains('etapa--actual') ? [posicion] : []));
  assert.equal(visibles.length, 1);
  const [posicion = -1] = visibles;
  assert.deepEqual(
    enlaces.map((enlace) => enlace.getAttribute('aria-current')),
    enlaces.map((_, otra) => (otra === posicion ? 'true' : null)),
  );
  return posicion;
}

test('tres segmentos por tipo, Guías · Informes · Notas, en una barra de pestañas sin controles al pie', (t) => {
  const { contenedor, etapas, enlaces, raiz } = abrirEtapas(t, PAGINA);
  assert.equal(contenedor.getAttribute('data-etapas'), 'segmentos');
  assert.deepEqual(
    etapas.map((etapa) => [etapa.id, limpio(etapa.querySelector('h2') as Pieza)]),
    SEGMENTOS.map(([id, , nombre]) => [id, nombre]),
  );
  assert.deepEqual(
    enlaces.map((enlace) => [enlace.getAttribute('href'), limpio(enlace)]),
    SEGMENTOS.map(([id, , nombre]) => [`#${id}`, nombre]),
  );
  for (const [, tipo, castellano, catalan] of SEGMENTOS) {
    assert.equal(es[`biblioteca.tipos.${tipo}`] ?? castellano, castellano);
    assert.equal(ca[`biblioteca.tipos.${tipo}`] ?? catalan, catalan);
  }
  assert.equal(ca['biblioteca.tipos.guia'], 'Guies');
  assert.equal(ca['biblioteca.tipos.nota'], 'Notes');
  for (const antiguo of ['primeros-pasos', 'ia-y-trabajo', 'derechos-y-ley', 'formacion', 'cataluna']) {
    assert.doesNotMatch(
      PAGINA,
      new RegExp(`id="${antiguo}"|#${antiguo}"`),
      `${antiguo}: los segmentos temáticos salen`,
    );
    assert.equal(es[`biblioteca.segmento.${antiguo}`], undefined);
  }
  assert.equal(contenedor.querySelectorAll('[data-etapas-controles]').length, 0, 'no es un recorrido');
  assert.equal(contenedor.querySelectorAll('.etapas-numero').length, 0);
  assert.equal(contenedor.querySelector('[data-etapas-barra]')?.hidden, true);
  const formulario = contenedor.querySelector('form') as Pieza;
  assert.equal(formulario.getAttribute('data-filtros'), 'biblioteca');
  assert.ok(formulario.hidden);
  assert.ok(!contenedor.contains(raiz.querySelector('h1') as Pieza));
  assert.deepEqual(
    raiz
      .querySelectorAll('p')
      .filter((p) => p.classList.contains('lecturas-aviso'))
      .map((p) => p.dataset.texto),
    ['biblioteca.aviso', 'guias.aviso'],
  );
  assert.match(PAGINA, /<link rel="stylesheet" href="estilos\/etapas\.css" \/>/);
  assert.match(PAGINA, /<script\s+type="module"\s+src="scripts\/etapas\.js"\s*><\/script>/);
  assert.ok(entradaConSri('biblioteca.html'));
});

/** Las pendientes, y solo ellas, dicen «En preparación» y no enlazan. */
function comprobarPendientes(entradas: Pieza[]): void {
  for (const entrada of entradas) {
    const pendiente = entrada.classList.contains('lecturas-ficha--pendiente');
    const estado = entrada.querySelectorAll('span').some((span) => span.dataset.texto === 'guias.preparacion');
    assert.equal(estado, pendiente, `${idDe(entrada)}: «En preparación» solo en las pendientes`);
    assert.equal(entrada.querySelector('a') === null, pendiente, `${idDe(entrada)}: las pendientes no enlazan`);
  }
}

/** La Biblioteca con la parte generada desde otro registro: un registro de prueba. */
function paginaCon(registro: Parameters<typeof generar>[0]): string {
  const parte = generar(registro).paginas['biblioteca.html'];
  const inicio = '<!-- Parte generada por node herramientas/web/lecturas.ts';
  const fin = '<!-- Fin de la parte generada. -->';
  const [desde, hasta] = [PAGINA.indexOf(inicio), PAGINA.indexOf(fin)];
  assert.ok(parte && desde > 0 && hasta > desde, 'la página tiene su parte generada');
  return `${PAGINA.slice(0, desde)}${inicio} -->\n${parte}\n${PAGINA.slice(hasta)}`;
}

test('cada lectura va en el segmento de su tipo, sin repetirse: todas las del registro, con las que están en preparación', (t) => {
  const { etapas } = abrirEtapas(t, PAGINA);
  const vistos = etapas.map((etapa) => entradasDe(etapa).map(idDe));
  assert.deepEqual(
    vistos.map((ids) => [...ids].sort()),
    SEGMENTOS.map(([, tipo]) =>
      REGISTRO.lecturas
        .filter((lectura) => lectura.tipo === tipo)
        .map(({ id }) => id)
        .sort(),
    ),
  );
  const todos = vistos.flat();
  assert.equal(new Set(todos).size, todos.length, 'ninguna lectura en dos segmentos');
  assert.equal(todos.length, REGISTRO.lecturas.length, 'todas las del registro');
  for (const [posicion, [, tipo]] of SEGMENTOS.entries()) {
    assert.ok(entradasDe(etapas[posicion] as Pieza).every((entrada) => entrada.dataset.tipo === tipo));
  }
  for (const retirada of RETIRADAS) {
    assert.ok(!todos.includes(retirada), `${retirada} sale de la Biblioteca`);
    assert.ok(!Object.keys(es).some((clave) => clave.startsWith(`lecturas.${retirada}.`)));
  }
  const pendientes = etapas.flatMap((etapa) =>
    entradasDe(etapa)
      .filter((entrada) => entrada.classList.contains('lecturas-ficha--pendiente'))
      .map(idDe),
  );
  assert.deepEqual(pendientes.sort(), [...PENDIENTES].sort());
  comprobarPendientes(etapas.flatMap(entradasDe));
});

test('con un registro de prueba, una guía propia en preparación: borde discontinuo, «En preparación», sin enlace y al final de su nivel', (t) => {
  const PROPIA = 'que-es-la-ia-generativa';
  const real = leerRegistro();
  const registro = {
    ...real,
    lecturas: real.lecturas.map((lectura) => (lectura.id === PROPIA ? { ...lectura, enlace: null } : lectura)),
  };
  const { etapas } = abrirEtapas(t, paginaCon(registro));
  const entradas = etapas.flatMap(entradasDe);
  assert.equal(entradas.length, REGISTRO.lecturas.length);
  assert.deepEqual(
    entradas
      .filter((entrada) => entrada.classList.contains('lecturas-ficha--pendiente'))
      .map(idDe)
      .sort(),
    [...PENDIENTES, PROPIA].sort(),
  );
  comprobarPendientes(entradas);
  const guiasIniciales = entradasDe(etapas[POSICION.guias] as Pieza).filter(
    (entrada) => entrada.dataset.nivel === 'empezar',
  );
  const entrada = guiasIniciales.at(-1) as Pieza;
  assert.equal(idDe(entrada), PROPIA, 'cierra su nivel');
  const lectura = { ...(DATOS.get(PROPIA) as LecturaDelRegistro), enlace: null };
  const { cuerpo, datos } = piezasDeLaFicha(entrada);
  comprobarEnlace(entrada, comprobarTextos(cuerpo, lectura), comprobarFranja(datos, lectura), lectura);
});

test('dentro de cada segmento, de Inicial a Avanzado; en cada nivel, lo propio de Faro, por fecha y lo que no tiene, al final', (t) => {
  const { etapas } = abrirEtapas(t, PAGINA);
  const propia = (lectura: LecturaDelRegistro) => lectura.enlace === null || !lectura.enlace.startsWith('https://');
  for (const etapa of etapas) {
    const ids = entradasDe(etapa).map(idDe);
    const esperado = [...ids].sort((a, b) => {
      const [x, y] = [DATOS.get(a), DATOS.get(b)];
      assert.ok(x && y);
      return (
        NIVELES.indexOf(x.nivel) - NIVELES.indexOf(y.nivel) ||
        Number(x.enlace === null) - Number(y.enlace === null) ||
        Number(propia(y)) - Number(propia(x)) ||
        Number(x.fecha.iso === null) - Number(y.fecha.iso === null) ||
        (y.fecha.iso ?? '').localeCompare(x.fecha.iso ?? '') ||
        x.es.titulo.localeCompare(y.es.titulo, 'es')
      );
    });
    assert.deepEqual(ids, esperado, etapa.id);
  }
  // Las guías: abre la de Faro, que es propia y está escrita.
  assert.equal(idDe(entradasDe(etapas[0] as Pieza)[0] as Pieza), 'que-es-la-ia-generativa');
});

/** Las piezas de una ficha, ya localizadas. */
function piezasDeLaFicha(entrada: Pieza) {
  const [columna, cuerpo] = entrada.children as Pieza[];
  assert.ok(columna && cuerpo);
  const franja = cuerpo.querySelector('dl') as Pieza;
  const datos = (franja.children as Pieza[]).map((fila) => [
    limpio(fila.querySelector('dt') as Pieza),
    fila.querySelector('dd') as Pieza,
  ]) as [string, Pieza][];
  return { columna, cuerpo, franja, datos };
}

/** A la izquierda de la ficha, el icono (decorativo) y el tipo escrito. */
function comprobarColumna(columna: Pieza, lectura: LecturaDelRegistro): void {
  assert.ok(columna.classList.contains('lecturas-ficha-tipo'));
  const icono = columna.querySelector('svg') as Pieza;
  assert.equal(icono.getAttribute('aria-hidden'), 'true', `${lectura.id}: el icono es decorativo`);
  assert.equal(icono.getAttribute('focusable'), 'false');
  assert.equal(icono.getAttribute('style'), null, 'sin estilos en línea (CSP)');
  assert.equal(limpio(columna), TIPOS[lectura.tipo as keyof typeof TIPOS], lectura.id);
}

/** La tarjeta muestra primero la fuente sin fecha; después, título, resumen e interés. */
function comprobarTextos(cuerpo: Pieza, lectura: LecturaDelRegistro): Pieza {
  const [fuente, comprobacion, titulo, resumen, interes] = cuerpo.children as Pieza[];
  assert.ok(fuente);
  assert.ok(fuente.classList.contains('lecturas-ficha-fuente'));
  assert.equal(limpio(fuente), lectura.fuente, lectura.id);
  assert.ok(comprobacion);
  assert.ok(comprobacion.hasAttribute('data-comprobacion-enlace'));
  assert.equal(comprobacion.hidden, true, 'la fecha se muestra solo al acreditar vigencia');
  assert.equal(limpio(comprobacion), '', 'el HTML no atribuye una comprobación sin evaluar');
  assert.equal(titulo?.tagName, 'H3');
  assert.ok(limpio(titulo as Pieza).includes(lectura.es.titulo));
  assert.ok(resumen?.classList.contains('lecturas-ficha-resumen'));
  assert.match(limpio(interes as Pieza), /^Por qué te puede interesar\. /);
  return titulo as Pieza;
}

/** La franja de datos, con sus cuatro casillas; devuelve la de «Se abre». */
function comprobarFranja(datos: [string, Pieza][], lectura: LecturaDelRegistro): Pieza {
  assert.deepEqual(
    datos.map(([rotulo]) => rotulo),
    ['Nivel', 'Lectura', 'Idioma', 'Se abre'],
  );
  const [nivel, minutos, idioma, abre] = datos.map(([, dd]) => dd) as [Pieza, Pieza, Pieza, Pieza];
  assert.ok(limpio(nivel).endsWith(ETIQUETAS[lectura.nivel as keyof typeof ETIQUETAS][0]), lectura.id);
  const barras = nivel.querySelectorAll('span').filter((span) => span.classList.contains('lecturas-barra'));
  assert.equal(barras.length, NIVELES.length);
  assert.equal(
    barras.filter((barra) => barra.classList.contains('lecturas-barra--llena')).length,
    NIVELES.indexOf(lectura.nivel) + 1,
  );
  assert.equal(nivel.querySelector('.lecturas-barras')?.getAttribute('aria-hidden'), 'true');
  assert.equal(limpio(minutos), `unos ${lectura.minutos} minutos`);
  assert.equal(limpio(idioma), IDIOMAS[lectura.idiomas.join('-')] ?? '?', lectura.id);
  return abre;
}

/** Un solo enlace, claro, al original, descrito por lo que abre. */
function comprobarEnlace(entrada: Pieza, titulo: Pieza, abre: Pieza, lectura: LecturaDelRegistro): void {
  const { id } = lectura;
  const enlaces = entrada.querySelectorAll('a') as Pieza[];
  if (lectura.enlace === null) {
    assert.equal(limpio(abre), 'En preparación');
    assert.equal(enlaces.length, 0);
    return;
  }
  assert.equal(enlaces.length, 1, `${id}: una ficha, un enlace (sin «versión en catalán» aparte)`);
  const [principal] = enlaces as [Pieza];
  assert.equal(principal.getAttribute('href'), lectura.enlace);
  assert.equal(principal.dataset.enlaceCa, lectura.enlace_ca, `${id}: la versión en catalán, para la web en catalán`);
  assert.equal(principal.parentElement, titulo);
  assert.equal(principal.getAttribute('aria-describedby'), `abre-${id}`);
  assert.equal(abre.id, `abre-${id}`);
  // Una página de Faro (un enlace interno, como «entender-ia.html») se abre en la misma pestaña; lo de fuera (https://,
  // aunque acabe en .html) y las fichas PDF, en otra.
  if (!lectura.enlace.startsWith('https://') && !lectura.enlace.startsWith('fichas/')) {
    assert.equal(principal.getAttribute('target'), null, id);
    assert.equal(principal.getAttribute('rel'), null, id);
    assert.equal(limpio(abre), 'Página de Faro en esta pestaña');
  } else {
    assert.equal(principal.getAttribute('target'), '_blank', id);
    assert.equal(principal.getAttribute('rel'), 'noopener noreferrer', id);
    const formato = /\bPDF\b/.test(lectura.formato?.es ?? '') ? 'PDF' : 'Página web';
    assert.equal(limpio(abre), `${formato} ↗ en otra pestaña`, id);
  }
}

test('la ficha C: icono y nombre del tipo, fuente, título, resumen, interés y la franja Nivel · Lectura · Idioma · Se abre', (t) => {
  const { etapas } = abrirEtapas(t, PAGINA);
  const enlaces = REGISTRO.lecturas.flatMap(({ enlace }) => (enlace === null ? [] : [enlace]));
  assert.ok(enlaces.includes('entender-ia.html'), 'una página de Faro, en la misma pestaña');
  assert.ok(
    enlaces.some((enlace) => enlace.startsWith('https://') && enlace.endsWith('.html')),
    'una página de fuera acabada en .html, en otra',
  );
  for (const entrada of etapas.flatMap(entradasDe)) {
    const lectura = DATOS.get(idDe(entrada));
    assert.ok(lectura);
    assert.equal(entrada.tagName, 'LI');
    assert.ok(entrada.classList.contains('lecturas-ficha'), lectura.id);
    const { columna, cuerpo, datos } = piezasDeLaFicha(entrada);
    comprobarColumna(columna, lectura);
    const titulo = comprobarTextos(cuerpo, lectura);
    const abre = comprobarFranja(datos, lectura);
    comprobarEnlace(entrada, titulo, abre, lectura);
  }
});

test('las fichas no enseñan fecha; los idiomas, en castellano y en catalán; ninguna lectura solo en inglés', () => {
  // Sin fecha a la vista: ni textos de fecha ni «Sin fecha».
  for (const diccionario of [es, ca]) {
    assert.deepEqual(
      Object.keys(diccionario).filter((clave) => /^lecturas\..+\.fecha$/.test(clave) || clave === 'lecturas.sin-fecha'),
      [],
    );
  }
  assert.doesNotMatch(PAGINA, /Sin fecha|Sense data|lecturas-sep/);
  // La Biblioteca solo publica lo que se lee en castellano o en catalán: ni lecturas solo en inglés ni su aviso.
  for (const lectura of REGISTRO.lecturas) {
    assert.ok(
      lectura.idiomas.some((codigo) => codigo === 'es' || codigo === 'ca'),
      lectura.id,
    );
  }
  assert.equal(es['lecturas.solo-en-ingles'], undefined);
  assert.equal(ca['lecturas.solo-en-ingles'], undefined);
  assert.equal(es['lecturas.idiomas.es-ca'], 'Castellano y catalán');
  assert.equal(ca['lecturas.idiomas.es-ca'], 'Castellà i català');
  // Cada combinación de la selección tiene su frase en el diccionario (con el inglés de más: pruebas/web-lecturas/generacion.test.ts).
  const orden = (codigo: string) => ['es', 'ca', 'en'].indexOf(codigo);
  const combinaciones = REGISTRO.lecturas.map(({ idiomas }) =>
    [...idiomas].sort((a, b) => orden(a) - orden(b)).join('-'),
  );
  for (const combinacion of new Set(combinaciones)) {
    assert.equal(es[`lecturas.idiomas.${combinacion}`], IDIOMAS[combinacion], combinacion);
    assert.ok(ca[`lecturas.idiomas.${combinacion}`], combinacion);
  }
  assert.equal(ca['lecturas.vistazo.abre'], 'S’obre');
  assert.equal(es['lecturas.formato.web'], 'Página web');
  assert.equal(ca['lecturas.formato.web'], 'Pàgina web');
  assert.ok(es['lecturas.version-ca'] === undefined, 'sin el enlace aparte «Versión en catalán»');
});

test('las etiquetas de nivel son Inicial · Intermedio · Avanzado (Inicial · Intermedi · Avançat), con los mismos ids', () => {
  for (const [nivel, [castellano, catalan]] of Object.entries(ETIQUETAS)) {
    assert.equal(es[`lecturas.niveles.${nivel}`] ?? castellano, castellano, nivel);
    assert.equal(ca[`lecturas.niveles.${nivel}`] ?? catalan, catalan, nivel);
  }
  assert.equal(es['lecturas.niveles.profundizar'], 'Intermedio');
  assert.equal(ca['lecturas.niveles.investigacion'], 'Avançat');
  assert.doesNotMatch(PAGINA, /Para empezar|Para profundizar|>Investigación</);
  for (const diccionario of [es, ca]) {
    assert.ok(
      !Object.values(diccionario).some((texto) =>
        /^(Para empezar|Para profundizar|Per començar|Per aprofundir|Recerca)$/.test(texto),
      ),
    );
  }
});

test('sin ids repetidos y con el aviso de qué abre cada ficha enlazada, el destino de las guías de la dirección antigua', (t) => {
  const { raiz, etapas, porId } = abrirEtapas(t, PAGINA);
  const ids = (raiz.querySelectorAll('[id]') as Pieza[]).map((pieza) => pieza.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const etapa of etapas) {
    for (const entrada of entradasDe(etapa).filter((otra) => otra.querySelector('a'))) {
      assert.ok(etapa.contains(porId(`abre-${idDe(entrada)}`)), idDe(entrada));
    }
  }
});

test('al abrir, el primer segmento, con aria-current="true" y sin pasos vistos ni avisos de lectores', async (t) => {
  const pagina = abrirEtapas(t, PAGINA);
  await cargar();
  assert.equal(actual(pagina), 0);
  assert.ok(pagina.contenedor.classList.contains('etapas--activas'));
  assert.equal(pagina.contenedor.querySelector('[data-etapas-barra]')?.hidden, false);
  assert.deepEqual(Pieza.desplazadas, []);
  for (const destino of ['#informes', '#notas', '#informes']) {
    pagina.navegar(destino);
  }
  assert.equal(actual(pagina), 1);
  assert.ok(pagina.enlaces.every((enlace) => !enlace.hasAttribute('data-vista')));
  assert.ok(
    pagina.enlaces.every((enlace) => enlace.children.length === 1),
    'sin el aviso «ya vista»',
  );
});

test('una pestaña cambia de segmento sin mover la vista y anuncia «Apartado N de 3», en ES y en CA', async (t) => {
  const pagina = abrirEtapas(t, PAGINA);
  await cargar();
  const notas = POSICION.notas;
  const pulsada = pagina.enlaces[notas]?.dispatchEvent(new Event('click', { cancelable: true }));
  assert.equal(pulsada, false, 'se cancela el salto al ancla');
  assert.deepEqual(pagina.apuntadas, ['#notas']);
  assert.equal(actual(pagina), notas);
  assert.deepEqual(Pieza.desplazadas, []);
  assert.equal(Pieza.enfocado?.pieza, pagina.enlaces[notas]);
  const anuncio = pagina.contenedor.querySelector('[aria-live]');
  assert.equal(anuncio?.textContent, 'Apartado 3 de 3 · Notas');
  const { fijarIdioma } = await import('../../web/scripts/textos.js');
  const { reescribirTextos } = await import('../../web/scripts/idioma.js');
  fijarIdioma('ca');
  reescribirTextos();
  assert.equal(anuncio?.textContent, 'Apartat 3 de 3 · Notes');
  fijarIdioma('es');
  reescribirTextos();
});

/** El id de «Se abre» de la última ficha enlazada de un tipo, según el registro. */
function abreDe(tipo: string): string {
  const lectura = REGISTRO.lecturas.findLast((otra) => otra.tipo === tipo && otra.enlace !== null);
  assert.ok(lectura, tipo);
  return `abre-${lectura.id}`;
}

test('cada fragmento abre su segmento: el del segmento, el de una ficha y los de fuera de los segmentos', async (t) => {
  // Un fragmento anterior conserva navegación válida aunque la lectura no forme parte de la selección actual.
  const RETIRADA = 'abre-formate-en-ia-en-un';
  assert.ok(!DATOS.has(RETIRADA.slice('abre-'.length)));
  for (const [fragmento, posicion, destino] of [
    ['', POSICION.guias, null],
    ['#notas', POSICION.notas, 'contenedor'],
    ...SEGMENTOS.map(([id, tipo]) => [`#${abreDe(tipo)}`, POSICION[id], abreDe(tipo)] as const),
    [`#${RETIRADA}`, POSICION.guias, null],
    ['#contenido', POSICION.guias, null],
    ['#g-derechos', POSICION.guias, null],
    ['#primeros-pasos', POSICION.guias, null],
  ] as const) {
    const pagina = abrirEtapas(t, PAGINA, fragmento);
    await cargar();
    assert.equal(actual(pagina), posicion, fragmento);
    const esperado = destino === null ? [] : [destino === 'contenedor' ? pagina.contenedor : pagina.porId(destino)];
    assert.deepEqual(Pieza.desplazadas, esperado, fragmento);
  }
});

test('unos segmentos con controles al pie, o una variante desconocida, no cumplen el contrato y no tocan la página', async (t) => {
  const { PaginaIncompleta } = await import('../../web/scripts/dom.js');
  const conControles = PAGINA.replace(
    '<p class="lecturas-cuenta" role="status" data-cuenta></p',
    '<nav data-etapas-controles hidden><a href="#informes">Siguiente</a></nav><p class="lecturas-cuenta" role="status" data-cuenta></p',
  );
  const desconocida = PAGINA.replace('data-etapas="segmentos"', 'data-etapas="otra"');
  for (const html of [conControles, desconocida]) {
    assert.notEqual(html, PAGINA);
    const pagina = abrirEtapas(t, html);
    await assert.rejects(cargar(), PaginaIncompleta);
    assert.ok(pagina.contenedor.querySelector('[data-etapas-barra]')?.hidden);
    assert.ok(!pagina.contenedor.classList.contains('etapas--activas'));
  }
});

test('en el móvil, los segmentos enseñan sus nombres; un recorrido sigue con sus números', () => {
  const bloques = [...HOJA.matchAll(/@media \(width <= 600px\) \{([\s\S]*?)\n\}\n/g)].map(([, cuerpo]) => cuerpo ?? '');
  const segmentos = bloques.find((cuerpo) => cuerpo.includes('[data-etapas="segmentos"]'));
  assert.ok(segmentos, 'la hoja tiene su bloque para los segmentos en el móvil');
  assert.match(
    segmentos,
    /\.etapas\[data-etapas="segmentos"\] \.etapas-nombre \{[^}]*position: static;[^}]*clip-path: none;/,
  );
  assert.match(bloques[0] ?? '', /\.etapas-nombre \{[^}]*clip-path: inset\(50%\)/, 'el recorrido no cambia');
  assert.doesNotMatch(segmentos, /display:\s*none/);
});

/** Cuántas lecturas de un segmento encajan con el nivel; «todo» no excluye nada. */
const contar = (segmento: (typeof SEGMENTOS)[number][0], nivel = 'todo') => {
  const tipo = SEGMENTOS[POSICION[segmento]]?.[1];
  return REGISTRO.lecturas.filter((lectura) => lectura.tipo === tipo && (nivel === 'todo' || lectura.nivel === nivel))
    .length;
};

test('la barra de filtros: rótulo, un solo desplegable (el nivel) con su botón y su panel, y todo oculto hasta que el script lo enseña', (t) => {
  const { contenedor } = abrirEtapas(t, PAGINA);
  const formulario = contenedor.querySelector('form') as Pieza;
  assert.ok(formulario.hidden, 'sin script, la barra no se ve y la página se lee entera');
  assert.equal(formulario.getAttribute('aria-label'), 'Filtrar la biblioteca');
  const rotulo = formulario.querySelector('.lecturas-filtros-rotulo') as Pieza;
  assert.equal(rotulo.textContent, 'Filtrar por');
  const desplegables = formulario.querySelectorAll('[data-desplegable]') as Pieza[];
  assert.equal(desplegables.length, 1);
  const [desplegable] = desplegables as [Pieza];
  const boton = desplegable.querySelector('button') as Pieza;
  const panel = desplegable.querySelector('[data-desplegable-panel]') as Pieza;
  assert.equal(boton.id, 'filtro-nivel-boton');
  assert.equal(boton.getAttribute('aria-expanded'), 'false');
  assert.equal(boton.getAttribute('aria-controls'), panel.id);
  assert.equal(boton.getAttribute('aria-haspopup'), null, 'es una divulgación, no un menú');
  assert.equal(limpio(boton.querySelector('.lecturas-desplegable-nombre') as Pieza), 'Nivel');
  assert.ok(panel.hidden, 'el panel parte cerrado');
  assert.deepEqual((panel.querySelectorAll('[data-opcion]') as Pieza[]).map(limpio), [
    'Todos',
    'Inicial',
    'Intermedio',
    'Avanzado',
  ]);
  assert.equal(boton.querySelector('svg')?.getAttribute('aria-hidden'), 'true', 'el chevron es decorativo');
  const quitar = formulario.querySelector('[data-quitar]') as Pieza;
  assert.ok(quitar.hidden, '«Quitar filtros» solo aparece con algún filtro');
  assert.equal(quitar.textContent, 'Quitar filtros');
  assert.equal(formulario.querySelector('[data-recuento]')?.getAttribute('aria-hidden'), 'true');
  const regiones = contenedor.querySelectorAll('[data-cuenta]');
  assert.equal(regiones.length, SEGMENTOS.length);
  assert.ok(regiones.every((region) => region.getAttribute('role') === 'status'));
  // Cada segmento lleva al pie su navegación de páginas, oculta y vacía sin script.
  for (const segmento of contenedor.querySelectorAll('section') as Pieza[]) {
    const nav = segmento.querySelector('[data-paginas]') as Pieza;
    assert.equal(nav.tagName, 'NAV');
    assert.equal(nav.getAttribute('aria-label'), 'Páginas');
    assert.equal(nav.dataset.textoAriaLabel, 'biblioteca.paginas');
    assert.ok(nav.hidden);
    assert.equal(nav.querySelectorAll('li').length, 0);
  }
});

test('los textos de la barra, de la cuenta y de las páginas existen en castellano y en catalán; los del filtro de tipo, no', () => {
  const claves = [
    'biblioteca.filtrar-por',
    'biblioteca.todos',
    'biblioteca.recuento',
    'biblioteca.recuento-parcial',
    'biblioteca.quitar-filtros',
    'biblioteca.paginas',
    'biblioteca.pagina',
    'biblioteca.cuenta',
    'lecturas.nivel',
  ];
  for (const clave of claves) {
    assert.ok(es[clave] && ca[clave], clave);
  }
  assert.equal(es['biblioteca.recuento'], '{total} lecturas');
  assert.equal(ca['biblioteca.recuento-parcial'], '{vistas} de {total} lectures');
  assert.equal(es['biblioteca.cuenta'], 'Se muestran {vistas} de {total} lecturas.');
  assert.equal(es['biblioteca.paginas'], 'Páginas');
  assert.equal(ca['biblioteca.paginas'], 'Pàgines');
  assert.equal(es['biblioteca.pagina'], 'Página {numero} de {total}');
  assert.equal(ca['biblioteca.pagina'], 'Pàgina {numero} de {total}');
  assert.equal(es['biblioteca.tipo'], undefined, 'sin el rótulo «Tipo» del filtro que sale');
  assert.equal(
    es['biblioteca.entradilla'],
    'Lecturas cortas e informes sobre la IA y el trabajo, de fuentes oficiales y de investigación.',
  );
  assert.equal(
    ca['biblioteca.entradilla'],
    'Lectures breus i informes sobre la IA i la feina, de fonts oficials i de recerca.',
  );
});

test('la hoja de la Biblioteca es plana (sin sombras, halos ni animaciones), con los tokens del sitio y el foco a la vista', () => {
  assert.doesNotMatch(HOJA_LECTURAS, /box-shadow|text-shadow|drop-shadow|backdrop-filter|\bfilter:/);
  assert.doesNotMatch(HOJA_LECTURAS, /transition|animation|@keyframes|scroll-behavior: smooth/);
  assert.doesNotMatch(HOJA_LECTURAS, /#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i, 'ningún color propio: solo tokens');
  assert.match(
    HOJA_LECTURAS,
    /\.lecturas-desplegable-boton \{[^}]*var\(--color-panel\)[^}]*var\(--color-linea\)[^}]*border-radius: 10px/,
  );
  assert.match(
    HOJA_LECTURAS,
    /\.lecturas-ficha \{[^}]*grid-template-columns: 96px minmax\(0, 1fr\)[^}]*var\(--color-panel\)/,
  );
  assert.match(HOJA_LECTURAS, /\.lecturas-ficha-titulo a::after \{[^}]*position: absolute;[^}]*inset: 0/);
  assert.match(HOJA_LECTURAS, /\.lecturas-ficha-titulo a:focus-visible::after \{[^}]*outline: var\(--foco\)/);
  assert.match(HOJA_LECTURAS, /\.lecturas-vistazo \{[^}]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(HOJA_LECTURAS, /\.lecturas-pagina \{[^}]*min-width: 44px;[^}]*min-height: 44px/);
  assert.match(HOJA_LECTURAS, /\.lecturas-pagina\[aria-current="page"\] \{[^}]*background: var\(--color-tinta\)/);
  assert.match(HOJA_LECTURAS, /\.lecturas-paginas-lista \{[^}]*justify-content: center/, 'los números, centrados');
  assert.match(HOJA_LECTURAS, /\.lecturas-paginas \{[^}]*max-width: 900px/, 'con el ancho de la columna de fichas');
  assert.doesNotMatch(HOJA_LECTURAS, /\.lecturas-ingles/);
  assert.match(HOJA_LECTURAS, /@media screen \{\s*\.lecturas-ficha\[data-otra-pagina\] \{\s*display: none;/);
  assert.match(HOJA_LECTURAS, /@media \(forced-colors: active\)/);
  assert.match(HOJA_LECTURAS, /@media print \{[^@]*\.lecturas-filtros,\s*\.lecturas-paginas \{\s*display: none;/);
});

test('en el móvil, el desplegable a todo el ancho, la ficha en una columna y las zonas táctiles de 44 px', () => {
  const movil = HOJA_LECTURAS.match(/@media \(width <= 600px\) \{([\s\S]*?)\n\}\n/)?.[1] ?? '';
  assert.match(movil, /\.lecturas-filtros-grupos \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(movil, /\.lecturas-desplegable-panel \{[^}]*top: auto;[^}]*right: 0;[^}]*left: 0/);
  assert.match(movil, /\.lecturas-desplegable-boton \{[^}]*width: 100%;[^}]*min-height: 52px/);
  assert.match(movil, /\.lecturas-opcion \{[^}]*min-height: 44px/);
  const ficha = HOJA_LECTURAS.match(/@media \(width <= 640px\) \{([\s\S]*?)\n\}\n/)?.[1] ?? '';
  assert.match(ficha, /\.lecturas-ficha \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(ficha, /\.lecturas-vistazo \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/, '2 × 2');
  assert.match(ficha, /\.lecturas-vistazo > div:nth-child\(n \+ 3\) \{[^}]*border-top/);
  assert.match(HOJA_LECTURAS, /\.lecturas-filtros-quitar \{[^}]*min-height: var\(--alto-control\)/);
  assert.match(readFileSync(new URL('../../web/estilos/tokens.css', import.meta.url), 'utf8'), /--alto-control: 40px/);
});

/** El observador de prueba: avisa cuando cambia la clase de un nodo observado, como hace el navegador. */
class Observador {
  alCambiar: () => void;
  constructor(alCambiar: () => void) {
    this.alCambiar = alCambiar;
  }
  observe(nodo: Pieza) {
    const poner = nodo.setAttribute.bind(nodo);
    nodo.setAttribute = (nombre: string, valor: string) => {
      poner(nombre, valor);
      if (nombre === 'class') {
        this.alCambiar();
      }
    };
  }
}

/** Lo que lecturas.js pide al documento, más el observador; el doble no trae las propiedades de un <input>. */
function equiparFiltros(t: TestContext, raiz: Pieza) {
  const base = (globalThis as unknown as { document: Record<string, unknown> }).document;
  Object.defineProperty(Pieza.prototype, 'value', {
    configurable: true,
    get(this: Pieza) {
      return this.getAttribute('value') ?? '';
    },
  });
  Object.defineProperty(Pieza.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ top: 40 }),
  });
  t.after(() => {
    Reflect.deleteProperty(Pieza.prototype, 'value');
    Reflect.deleteProperty(Pieza.prototype, 'getBoundingClientRect');
  });
  navegador(t, {
    // Los pasos «Anterior» y «Siguiente» (pasos-de-pagina.js) llevan su chevron en SVG.
    document: {
      ...base,
      querySelector: (css: string) => raiz.querySelector(css),
      addEventListener: () => {},
      createElementNS: (_espacio: string, etiqueta: string) => new Pieza(etiqueta),
    },
    Node: Pieza,
    HTMLFormElement: Pieza,
    HTMLInputElement: { [Symbol.hasInstance]: (otro: unknown) => otro instanceof Pieza && otro.tagName === 'INPUT' },
    MutationObserver: Observador,
  });
}

/** El desplegable del nivel: elegir una opción como lo hace el navegador, su botón y la cuenta de sus opciones. */
function nivelDe(formulario: Pieza) {
  const radios = formulario.querySelectorAll('input[name="nivel"]') as (Pieza & { checked?: boolean })[];
  const etiquetas = (formulario.querySelector('#filtro-nivel-panel') as Pieza).querySelectorAll('label');
  const elegir = (valor: string) => {
    for (const radio of radios) {
      radio.checked = radio.getAttribute('value') === valor;
    }
    formulario.dispatchEvent(new Event('change'));
  };
  return {
    elegir,
    boton: formulario.querySelector('#filtro-nivel-boton') as Pieza,
    opciones: () => etiquetas.map(limpio),
  };
}

/**
 * Las pestañas (etapas.js) y los filtros (lecturas.js) sobre la misma página real. El observador de prueba avisa cuando
 * etapas.js cambia la clase de un segmento, para que los filtros sigan al segmento que se ve.
 */
async function abrirConFiltros(t: TestContext) {
  const pagina = abrirEtapas(t, PAGINA);
  equiparFiltros(t, pagina.raiz);
  await cargar();
  await import(`${LECTURAS.href}?biblioteca=${++instancia}`);
  const formulario = pagina.raiz.querySelector('form[data-filtros]') as Pieza;
  const recuento = formulario.querySelector('[data-recuento]') as Pieza;
  const cuenta = (segmento: string) => (pagina.porId(segmento).querySelector('[data-cuenta]') as Pieza).textContent;
  const irA = (segmento: string) =>
    pagina.enlaces[POSICION[segmento as keyof typeof POSICION]]?.dispatchEvent(
      new Event('click', { cancelable: true }),
    );
  return { pagina, formulario, nivel: nivelDe(formulario), recuento, cuenta, irA };
}

test('el filtro sigue al segmento que se ve: el recuento y la cuenta de cada opción cambian al cambiar de pestaña', async (t) => {
  const { formulario, nivel, recuento, irA } = await abrirConFiltros(t);
  assert.equal(formulario.hidden, false, 'con script, la barra se enseña');
  assert.equal(limpio(recuento), `${contar('guias')} lecturas`);
  for (const [id] of SEGMENTOS) {
    irA(id);
    assert.equal(limpio(recuento), `${contar(id)} lecturas`, id);
    assert.deepEqual(nivel.opciones(), [
      `Todos (${contar(id)})`,
      `Inicial (${contar(id, 'empezar')})`,
      `Intermedio (${contar(id, 'profundizar')})`,
      `Avanzado (${contar(id, 'investigacion')})`,
    ]);
  }
});

test('la elección se conserva al cambiar de pestaña, con la cuenta de cada segmento y el botón rotulado', async (t) => {
  const { nivel, recuento, cuenta, irA } = await abrirConFiltros(t);
  nivel.elegir('profundizar');
  for (const [id] of SEGMENTOS) {
    irA(id);
    const [vistas, total] = [contar(id, 'profundizar'), contar(id)];
    assert.equal(limpio(recuento), vistas === total ? `${total} lecturas` : `${vistas} de ${total} lecturas`, id);
    assert.equal(cuenta(id), `Se muestran ${vistas} de ${total} lecturas.`);
    assert.equal(limpio(nivel.boton), 'Nivel · Intermedio');
    assert.equal(nivel.boton.hasAttribute('data-activo'), true);
  }
  nivel.elegir('todo');
  assert.equal(nivel.boton.hasAttribute('data-activo'), false);
  assert.equal(limpio(nivel.boton), 'Nivel · Todos');
});

test('pasar de página no toca la historia, la pestaña, el foco ni la vista; al volver a una pestaña, su página 1', async (t) => {
  const { pagina, irA } = await abrirConFiltros(t);
  const guias = pagina.porId('guias');
  const botones = () => guias.querySelector('[data-paginas]')?.querySelectorAll('button.lecturas-pagina') as Pieza[];
  assert.ok(botones().length > 1);
  Pieza.enfocado = null;
  botones()[1]?.dispatchEvent(new Event('click'));
  assert.deepEqual(pagina.apuntadas, [], 'sin pushState');
  assert.equal(actual(pagina), POSICION.guias);
  assert.equal(botones()[1]?.getAttribute('aria-current'), 'page');
  assert.equal(Pieza.enfocado, null, 'el foco no se mueve');
  assert.deepEqual(Pieza.desplazadas, [], 'ni la vista');
  assert.equal(pagina.ventana.scrollY, VISTA);
  irA('informes');
  irA('guias');
  assert.deepEqual(pagina.apuntadas, ['#informes', '#guias']);
  assert.equal(botones()[0]?.getAttribute('aria-current'), 'page');
});
