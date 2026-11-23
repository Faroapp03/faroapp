import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { type TestContext, test } from 'node:test';
import ca from '../../web/idiomas/ca.js';
import es from '../../web/idiomas/es.js';
import { fijarIdioma, registrarDiccionario } from '../../web/scripts/textos.js';
import { abrirEtapas, Pieza, VISTA } from './etapas-doble.ts';

const PAGINA = readFileSync(new URL('../../web/entender-ia.html', import.meta.url), 'utf8');
/** La página «Qué es la IA» en el doble, con el fragmento de partida; el módulo aún sin cargar. */
const abrir = (t: TestContext, fragmento = '', html = PAGINA) => abrirEtapas(t, html, fragmento);
/** La hoja de las etapas, sin sus comentarios. */
const HOJA = readFileSync(new URL('../../web/estilos/etapas.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);
const ETAPAS = new URL('../../web/scripts/etapas.js', import.meta.url);
/** Las secciones de cada parte aprobada de la guía, por su encabezado. */
const GRUPOS = [
  ['ia-que-es'],
  ['ia-aprende'],
  ['ia-generativa'],
  ['ia-bien-mal'],
  ['ia-trabajo'],
  ['ia-glosario'],
  ['ia-desafio'],
];
/** Los id de las partes: las cinco de siempre (#paso-1 a #paso-5) y las dos nuevas, el glosario y el desafío. */
const IDS = ['paso-1', 'paso-2', 'paso-3', 'paso-4', 'paso-5', 'glosario', 'desafio'];
/** El total de partes, como lo escribe la barra. */
const TOTAL = IDS.length;
/** La posición de la última parte: el desafío. */
const ULTIMA = TOTAL - 1;
/** La posición del glosario. */
const GLOSARIO = 5;
/** La posición de la cuarta parte, «Precauciones». */
const CUARTA = 3;
/** La posición de la quinta parte, «La IA en tu trabajo». */
const QUINTA = 4;
/** La línea de estado de la guía, con su clave propia: «2 de 7 · Cómo aprende». */
const lineaDe = (diccionario: Record<string, string>, numero: number) =>
  `${numero} de ${TOTAL} · ${diccionario[`entender-ia.etapa.${numero}`]}`;
/** Lo más que dura una transición de la hoja, en segundos. */
const MAXIMO_DE_TRANSICION = 0.25;

/** El primer grupo de una regla buscada en la hoja; falla la prueba si la regla no está. */
function cuerpoDe(regla: RegExpMatchArray | null): string {
  const cuerpo = regla?.[1];
  assert.ok(cuerpo !== undefined, 'No se encontró la regla en la hoja de etapas');
  return cuerpo;
}
registrarDiccionario('es', es);
registrarDiccionario('ca', ca);

let instancia = 0;
const cargar = () => import(`${ETAPAS.href}?etapas=${++instancia}`);

type Pagina = ReturnType<typeof abrir>;
/** La línea «Paso N de 5 · nombre» de la barra. */
const estado = ({ contenedor }: Pagina) => contenedor.querySelector('[data-etapas-estado]')?.textContent;
/** Los enlaces del pie de una etapa: «Siguiente» y, desde la segunda, «Anterior». */
const controles = ({ etapas }: Pagina, posicion: number) =>
  etapas[posicion]?.querySelector('[data-etapas-controles]')?.querySelectorAll('a') as Pieza[];
/** La región aria-live de la barra con el paso anunciado. */
const anuncio = ({ contenedor }: Pagina) => contenedor.querySelector('[aria-live]');
/** Pulsa un enlace como una persona: un clic cancelable. Devuelve false si el módulo cancela el salto del enlace. */
const pulsarEnlace = (enlace: Pieza | undefined) => enlace?.dispatchEvent(new Event('click', { cancelable: true }));
/** El rótulo «Recorrido · Paso N de 5» de la barra. */
const rotulo = ({ contenedor }: Pagina) => contenedor.querySelector('[data-etapas-rotulo]')?.textContent;
/** La posición de la etapa visible, comprobando que hay una sola y que su paso es el único actual. */
function actual({ etapas, enlaces }: Pagina): number {
  const visibles = etapas.flatMap((etapa, posicion) => (etapa.classList.contains('etapa--actual') ? [posicion] : []));
  assert.equal(visibles.length, 1);
  const [posicion = -1] = visibles;
  assert.deepEqual(
    enlaces.map((enlace) => enlace.getAttribute('aria-current')),
    enlaces.map((_, otra) => (otra === posicion ? 'step' : null)),
  );
  return posicion;
}

test('el HTML agrupa la guía en siete partes con barra y controles ocultos de partida', (t) => {
  const pagina = abrir(t);
  assert.deepEqual(
    pagina.etapas.map((etapa) =>
      etapa.children
        .filter((hijo) => hijo.tagName === 'SECTION')
        .map((seccion) => seccion.getAttribute('aria-labelledby') ?? seccion.className.replace('bloque ', '')),
    ),
    GRUPOS,
  );
  assert.deepEqual(
    pagina.etapas.map((etapa) => etapa.id),
    IDS,
  );
  assert.ok(pagina.porId('paso-3').contains(pagina.porId('ejemplo')));
  // Las referencias y la sección siguiente quedan fuera de las partes: se ven debajo de cualquiera.
  for (const fuera of [pagina.raiz.querySelector('.referencias'), pagina.raiz.querySelector('.seccion-siguiente')]) {
    assert.ok(fuera && !pagina.contenedor.contains(fuera as Pieza));
  }
  assert.ok(!pagina.contenedor.contains(pagina.raiz.querySelector('h1') as Pieza));
  const ocultos = pagina.contenedor
    .querySelectorAll('*')
    .filter((pieza) => pieza.hidden && Object.keys(pieza.dataset).some((clave) => clave.startsWith('etapas')));
  assert.deepEqual(
    ocultos.map((pieza) => Object.keys(pieza.dataset).find((clave) => clave.startsWith('etapas'))),
    ['etapasBarra', ...IDS.map(() => 'etapasControles')],
  );
  assert.equal(pagina.contenedor.dataset.etapasClavePaso, 'entender-ia.etapas.paso');
  assert.equal(pagina.contenedor.dataset.etapasClaveRotulo, 'entender-ia.etapas.rotulo');
});

/** La clave del nombre en la tarjeta «Siguiente»: la que lleva al desafío lo nombra entero. */
const claveDelSiguiente = (posicion: number) =>
  posicion + 2 === TOTAL ? 'entender-ia.etapa.7.largo' : `entender-ia.etapa.${posicion + 2}`;

test('cada parte tiene su tarjeta «Siguiente» y el enlace «Anterior» con su nombre; la última lleva a «Empezar tu recorrido»', (t) => {
  const { etapas, raiz } = abrir(t);
  assert.equal(raiz.querySelector('.navegacion'), null, 'esta página no lleva la franja de secciones');
  for (const [posicion, etapa] of etapas.entries()) {
    const controles = etapa.querySelector('[data-etapas-controles]');
    const enlaces = controles?.querySelectorAll('a') ?? [];
    const esUltima = posicion === etapas.length - 1;
    const siguiente = enlaces.find((enlace) => enlace.classList.contains('etapas-siguiente'));
    const anterior = enlaces.find((enlace) => enlace.classList.contains('etapas-anterior'));
    assert.equal(enlaces.length, posicion > 0 ? 2 : 1, `etapa ${posicion + 1}`);
    assert.equal(enlaces[0], siguiente, 'la tarjeta va primero: es la acción principal');
    assert.equal(siguiente?.getAttribute('href'), esUltima ? 'recorrido.html' : `#${IDS[posicion + 1]}`);
    const nombre = siguiente?.querySelector('.etapas-siguiente-nombre');
    const rotulo = siguiente?.querySelector('.etapas-siguiente-rotulo');
    if (esUltima) {
      assert.equal(nombre?.dataset.texto, 'entender-ia.etapas.empezar');
      assert.equal(rotulo?.dataset.texto, 'entender-ia.etapas.final');
    } else {
      assert.equal(nombre?.dataset.texto, claveDelSiguiente(posicion));
      assert.equal(rotulo?.dataset.texto, 'comun.etapas.siguiente');
      assert.deepEqual(
        rotulo?.children.map((cifra) => cifra.textContent),
        [String(posicion + 2), String(etapas.length)],
      );
    }
    assert.ok(siguiente?.querySelector('svg'), 'la flecha');
    if (posicion > 0) {
      assert.equal(anterior?.getAttribute('href'), `#${IDS[posicion - 1]}`);
      assert.deepEqual(
        anterior?.querySelectorAll('[data-texto]').map((pieza) => pieza.dataset.texto),
        ['comun.etapas.anterior', `entender-ia.etapa.${posicion}`],
      );
    }
  }
});

test('sin iniciar no se oculta nada y la hoja solo oculta en pantalla con la clase del módulo', (t) => {
  const pagina = abrir(t, '#paso-3');
  assert.ok(pagina.etapas.every((etapa) => !etapa.classList.contains('etapa--actual')));
  assert.ok(!pagina.contenedor.classList.contains('etapas--activas'));
  const ocultaciones = [...HOJA.matchAll(/([^{}]+)\{[^{}]*display:\s*none/g)].map(([, selector]) => selector?.trim());
  assert.deepEqual(ocultaciones, [
    '.etapas--activas > .etapa:not(.etapa--actual)',
    '.etapas-estado',
    '.etapas-rotulo',
    '.etapas-barra,\n  .etapas-controles',
  ]);
  assert.match(HOJA, /@media screen \{\s*\.etapas--activas > \.etapa:not\(\.etapa--actual\)/);
  assert.match(HOJA, /@media print \{\s*\.etapas-barra,\s*\.etapas-controles \{\s*display: none;/);
});

test('un marcado que no cumple el contrato falla sin tocar la página', async (t) => {
  const roto = PAGINA.replace('<a href="#paso-4"', '<a href="#paso-9"');
  const pagina = abrir(t, '#paso-2', roto);
  const { PaginaIncompleta } = await import('../../web/scripts/dom.js');
  await assert.rejects(cargar(), PaginaIncompleta);
  assert.ok(pagina.contenedor.querySelector('[data-etapas-barra]')?.hidden);
  assert.ok(!pagina.contenedor.classList.contains('etapas--activas'));
  assert.ok(pagina.enlaces.every((enlace) => enlace.children.length === 2 && !enlace.hasAttribute('aria-current')));
  assert.ok(pagina.raiz.querySelectorAll('h2').every((titulo) => !titulo.hasAttribute('tabindex')));
});

test('el fragmento de una etapa la abre al cargar y lleva la vista al recorrido sin mover el foco', async (t) => {
  const pagina = abrir(t, '#paso-3');
  await cargar();
  assert.equal(actual(pagina), 2);
  assert.ok(pagina.contenedor.classList.contains('etapas--activas'));
  assert.equal(pagina.contenedor.querySelector('[data-etapas-barra]')?.hidden, false);
  assert.ok(pagina.contenedor.querySelectorAll('[data-etapas-controles]').every((controles) => !controles.hidden));
  assert.deepEqual(Pieza.desplazadas, [pagina.contenedor]);
  assert.equal(Pieza.enfocado, null);
});

test('un fragmento vacío, desconocido o mal formado abre la primera etapa sin error ni desplazamiento', async (t) => {
  for (const fragmento of ['', '#', '#nada', '#%E0%A4%A']) {
    const pagina = abrir(t, fragmento);
    await cargar();
    assert.equal(actual(pagina), 0, fragmento);
    assert.deepEqual(Pieza.desplazadas, [], fragmento);
  }
});

test('un ancla dentro de una parte oculta la abre y lleva la vista hasta ella: un término del glosario, el ejemplo', async (t) => {
  const pagina = abrir(t, '#termino-sesgo');
  await cargar();
  assert.equal(actual(pagina), GLOSARIO);
  assert.deepEqual(Pieza.desplazadas, [pagina.porId('termino-sesgo')]);
  pagina.navegar('#ejemplo');
  assert.equal(actual(pagina), 2);
  assert.equal(Pieza.desplazadas.at(-1), pagina.porId('ejemplo'));
  // Un término resaltado en el texto lleva a su entrada del glosario, sin mover el foco.
  pagina.navegar('#termino-instruccion');
  assert.equal(actual(pagina), GLOSARIO);
  assert.equal(Pieza.desplazadas.at(-1), pagina.porId('termino-instruccion'));
  assert.equal(Pieza.enfocado, null);
});

test('las citas llevan a las referencias, que están fuera de las partes: no cambian de parte ni desplazan', async (t) => {
  const pagina = abrir(t, '#paso-3');
  await cargar();
  const cita = pagina.etapas[2]?.querySelectorAll('sup a').map((enlace) => enlace.getAttribute('href'));
  assert.deepEqual(cita, ['#ref-7', '#ref-2']);
  const antes = Pieza.desplazadas.length;
  pagina.navegar('#ref-2');
  assert.equal(actual(pagina), 2);
  assert.equal(Pieza.desplazadas.length, antes, 'el navegador salta solo a la referencia, que está a la vista');
});

test('un ancla en la parte visible o fuera de las partes no cambia de parte ni desplaza', async (t) => {
  const pagina = abrir(t, '#glosario');
  await cargar();
  const antes = Pieza.desplazadas.length;
  pagina.navegar('#termino-sesgo');
  pagina.navegar('#ref-3');
  pagina.navegar('#contenido');
  assert.equal(actual(pagina), GLOSARIO);
  assert.equal(Pieza.desplazadas.length, antes);
});

test('un fragmento escrito a mano o un enlace cambia de etapa, lleva la vista al recorrido y el foco al título', async (t) => {
  const pagina = abrir(t);
  await cargar();
  pagina.navegar('#paso-2');
  assert.equal(actual(pagina), 1);
  assert.deepEqual(Pieza.desplazadas, [pagina.contenedor]);
  assert.equal(Pieza.enfocado?.pieza, pagina.porId('ia-aprende'));
  assert.deepEqual(Pieza.enfocado?.opciones, { preventScroll: true });
  assert.equal(pagina.porId('ia-aprende').getAttribute('tabindex'), '-1');
  pagina.navegar('#paso-1');
  assert.equal(actual(pagina), 0);
  assert.equal(Pieza.enfocado?.pieza, pagina.porId('ia-que-es'));
  // Hasta una entrada sin fragmento: la primera etapa, desde su principio.
  pagina.navegar('#paso-4');
  pagina.navegar('');
  assert.equal(actual(pagina), 0);
  const { contenedor } = pagina;
  assert.deepEqual(Pieza.desplazadas, [contenedor, contenedor, contenedor, contenedor]);
});

test('pulsar un paso de la barra cambia solo el contenido: cancela el salto, apunta la historia y deja la vista y el foco', async (t) => {
  const pagina = abrir(t);
  await cargar();
  assert.equal(pulsarEnlace(pagina.enlaces[1]), false, 'el salto nativo al ancla se cancela');
  assert.deepEqual(pagina.apuntadas, ['#paso-2']);
  assert.equal(actual(pagina), 1);
  assert.deepEqual(Pieza.desplazadas, [], 'sin scrollIntoView');
  assert.equal(Pieza.enfocado?.pieza, pagina.enlaces[1], 'el foco se queda en la pestaña');
  assert.equal(estado(pagina), lineaDe(es, 2));
  assert.equal(anuncio(pagina)?.getAttribute('aria-live'), 'polite');
  assert.equal(anuncio(pagina)?.textContent, lineaDe(es, 2));
  // pushState no avisa con hashchange: la etapa no se mueve ni se repite nada por ello.
  assert.equal(pulsarEnlace(pagina.enlaces[3]), false);
  assert.deepEqual(pagina.apuntadas, ['#paso-2', '#paso-4']);
  assert.equal(actual(pagina), CUARTA);
  assert.deepEqual(Pieza.desplazadas, []);
});

test('pulsar el paso que ya se ve no hace nada: ni historia, ni vista, ni foco, ni anuncio', async (t) => {
  const pagina = abrir(t, '#paso-2');
  await cargar();
  const desplazadas = Pieza.desplazadas.length;
  assert.equal(pulsarEnlace(pagina.enlaces[1]), false, 'se cancela el salto: no hay nada que mover');
  assert.deepEqual(pagina.apuntadas, []);
  assert.equal(Pieza.desplazadas.length, desplazadas);
  assert.equal(Pieza.enfocado, null);
  assert.equal(anuncio(pagina)?.textContent, '');
  assert.equal(actual(pagina), 1);
});

test('un clic con tecla modificadora o con otro botón se deja al navegador', async (t) => {
  const pagina = abrir(t);
  await cargar();
  for (const opciones of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
    const evento = Object.assign(new Event('click', { cancelable: true }), opciones);
    assert.equal(pagina.enlaces[1]?.dispatchEvent(evento), true, JSON.stringify(opciones));
  }
  assert.deepEqual(pagina.apuntadas, []);
  assert.equal(actual(pagina), 0);
});

test('atrás y adelante muestran la etapa del fragmento sin mover la vista ni el foco, aunque llegue hashchange', async (t) => {
  const pagina = abrir(t);
  await cargar();
  pulsarEnlace(pagina.enlaces[1]);
  pulsarEnlace(pagina.enlaces[2]);
  Pieza.enfocado = null;
  pagina.volver('#paso-2', false);
  assert.equal(actual(pagina), 1);
  assert.equal(anuncio(pagina)?.textContent, lineaDe(es, 2));
  pagina.volver('');
  assert.equal(actual(pagina), 0);
  pagina.volver('#paso-3');
  assert.equal(actual(pagina), 2);
  assert.deepEqual(Pieza.desplazadas, [], 'ni el hashchange que sigue a popstate desplaza');
  assert.equal(pagina.ventana.scrollY, VISTA, 'el salto nativo al fragmento se deshace: la vista no se mueve');
  assert.equal(Pieza.enfocado, null);
  assert.deepEqual(pagina.apuntadas, ['#paso-2', '#paso-3'], 'volver no añade entradas');
});

test('atrás hasta un ancla de otra parte la abre y lleva hasta ella', async (t) => {
  const pagina = abrir(t, '#paso-3');
  await cargar();
  Pieza.desplazadas = [];
  pagina.volver('#termino-alucinacion');
  assert.equal(actual(pagina), GLOSARIO);
  assert.deepEqual(Pieza.desplazadas, [pagina.porId('termino-alucinacion')]);
});

test('«Siguiente» y «Anterior» del pie llevan la vista al recorrido y el foco al título, tras apuntar la historia', async (t) => {
  const pagina = abrir(t, '#paso-2');
  await cargar();
  Pieza.desplazadas = [];
  assert.equal(pulsarEnlace(controles(pagina, 1)[0]), false);
  assert.deepEqual(pagina.apuntadas, ['#paso-3']);
  assert.equal(actual(pagina), 2);
  assert.deepEqual(Pieza.desplazadas, [pagina.contenedor]);
  assert.equal(Pieza.enfocado?.pieza, pagina.porId('ia-generativa'));
  assert.deepEqual(Pieza.enfocado?.opciones, { preventScroll: true });
  assert.equal(pulsarEnlace(controles(pagina, 2)[1]), false);
  assert.deepEqual(pagina.apuntadas, ['#paso-3', '#paso-2']);
  assert.equal(actual(pagina), 1);
  assert.equal(Pieza.enfocado?.pieza, pagina.porId('ia-aprende'));
  assert.deepEqual(Pieza.desplazadas, [pagina.contenedor, pagina.contenedor]);
});

test('la tarjeta final lleva a otra página: el módulo no la toca', async (t) => {
  const pagina = abrir(t, '#desafio');
  await cargar();
  assert.equal(pulsarEnlace(controles(pagina, ULTIMA)[0]), true);
  assert.deepEqual(pagina.apuntadas, []);
});

test('la barra marca el paso actual y los ya vistos, también para lectores, en ES y en CA', async (t) => {
  fijarIdioma('es');
  const pagina = abrir(t);
  await cargar();
  pagina.navegar('#paso-3');
  pagina.navegar('#paso-2');
  assert.equal(actual(pagina), 1);
  const vistos = () => pagina.enlaces.map((enlace) => enlace.hasAttribute('data-vista'));
  const avisos = () => pagina.enlaces.map((enlace) => enlace.children.at(-1));
  assert.deepEqual(vistos(), [true, false, true, false, false, false, false]);
  assert.equal(estado(pagina), lineaDe(es, 2));
  assert.equal(rotulo(pagina), 'Guía de Faro · 2 de 7');
  assert.deepEqual(
    avisos().map((aviso) => (aviso?.hidden ? null : aviso?.textContent)),
    [es['comun.etapas.vista'], null, es['comun.etapas.vista'], null, null, null, null],
  );
  const { reescribirTextos } = await import('../../web/scripts/idioma.js');
  fijarIdioma('ca');
  reescribirTextos();
  assert.equal(actual(pagina), 1);
  assert.equal(avisos()[0]?.textContent, ca['comun.etapas.vista']);
  assert.equal(pagina.enlaces[1]?.querySelector('.etapas-nombre')?.textContent, ca['entender-ia.etapa.2']);
  assert.equal(estado(pagina), lineaDe(ca, 2));
  assert.equal(rotulo(pagina), 'Guia de Faro · 2 de 7');
  fijarIdioma('es');
});

test('un paso visto no lleva marca visual: conserva su número en el documento y el aviso para lectores', async (t) => {
  const pagina = abrir(t);
  await cargar();
  pagina.navegar('#paso-2');
  pagina.navegar('#paso-3');
  const vistos = pagina.enlaces.map((enlace) => enlace.hasAttribute('data-vista'));
  assert.deepEqual(vistos, [true, true, false, false, false, false, false]);
  assert.deepEqual(
    pagina.enlaces.map((enlace) => enlace.querySelector('.etapas-numero')?.textContent),
    ['1', '2', '3', '4', '5', '6', '7'],
  );
  assert.deepEqual(
    pagina.enlaces.map((enlace) => !enlace.children.at(-1)?.hidden),
    vistos,
  );
  assert.doesNotMatch(HOJA, /data-vista/);
  assert.doesNotMatch(HOJA + PAGINA, /✓|✔|\\2713|\\2714/);
});

test('el título que el guion enfoca al cambiar de etapa no lleva contorno; el foco de teclado de enlaces y pestañas sí', () => {
  const [, selector = '', reglas = ''] = HOJA.match(/([^{}]*\[tabindex="-1"\][^{}]*)\{([^}]*)\}/) ?? [];
  assert.match(selector, /^\s*\.etapa :is\(h2, h3, h4, h5, h6\)\[tabindex="-1"\]:focus\s*$/);
  assert.match(reglas, /^\s*outline: none;\s*$/);
  assert.equal(HOJA.match(/outline:\s*none/g)?.length, 1, 'solo ese título pierde el contorno');
  assert.doesNotMatch(selector, /focus-visible|\ba\b|button/);
});

test('la hoja no mueve nada: sin animaciones, con transiciones únicas de 250 ms como mucho', () => {
  assert.doesNotMatch(HOJA, /@keyframes|animation|scroll-behavior/);
  const duraciones = [...HOJA.matchAll(/transition:([^;]*);/g)].flatMap(([, valor]) =>
    [...(valor ?? '').matchAll(/(\d*\.?\d+)s\b/g)].map(([, segundos]) => Number(segundos)),
  );
  assert.ok(duraciones.length > 0);
  assert.ok(
    duraciones.every((segundos) => segundos <= MAXIMO_DE_TRANSICION),
    duraciones.join(' '),
  );
  const alPasar = [...HOJA.matchAll(/([^{}]*:hover[^{}]*)\{([^}]*)\}/g)].map(([, , reglas]) => reglas ?? '');
  assert.ok(alPasar.length > 0);
  for (const reglas of alPasar) {
    assert.doesNotMatch(reglas, /transform|margin|padding|top:|left:|translate/);
  }
});

test('pestañas de texto: sin círculos, sin línea entre pasos y con el paso actual relleno de tinta', () => {
  assert.doesNotMatch(HOJA, /border-radius:\s*50%|border-radius:\s*999px|--radio-pildora|--etapas-circulo/);
  const barra = cuerpoDe(HOJA.match(/\.etapas-barra ol \{([^}]*)\}/));
  assert.match(barra, /border-radius: 10px;/);
  assert.doesNotMatch(HOJA, /\.etapas-barra[^{]*::(?:before|after)|\.etapas-numero[^{]*::(?:before|after)/);
  assert.doesNotMatch(HOJA, /box-shadow|text-shadow|backdrop-filter|(?<![-\w])filter:|(?<![-\w])transform:/);
  // Un solo selector para el paso de un recorrido (aria-current="step") y el apartado de unos segmentos ("true").
  const actual = cuerpoDe(HOJA.match(/\.etapas \.etapas-barra a\[aria-current\] \{([^}]*)\}/));
  assert.match(actual, /color: var\(--color-panel\);/);
  assert.match(actual, /background: var\(--color-tinta\);/);
  const enlace = cuerpoDe(HOJA.match(/\.etapas \.etapas-barra a \{([^}]*)\}/));
  assert.match(enlace, /color: var\(--color-tenue\);/);
  assert.match(enlace, /min-height: 44px;/);
  assert.match(HOJA, /a:hover,\s*\.etapas \.etapas-barra a:focus-visible \{\s*color: var\(--color-tinta\);/);
});

test('el número solo se ve en el móvil, en un segmento de esquinas redondeadas y no en un círculo', () => {
  const movil = cuerpoDe(HOJA.match(/@media \(width <= 600px\) \{([\s\S]*?)\n\}\n/));
  assert.match(movil, /\.etapas-nombre \{[^}]*clip-path: inset\(50%\)/);
  assert.match(movil, /\.etapas-barra \.etapas-numero \{[^}]*position: static;/);
  assert.match(movil, /\.etapas \.etapas-barra a \{[^}]*padding: 8px 4px;/);
  assert.doesNotMatch(movil, /border-radius:\s*50%/);
  assert.match(HOJA, /\.etapas-numero \{[^}]*clip-path: inset\(50%\)/);
});

test('con colores forzados el paso actual usa los colores de selección del sistema', () => {
  assert.match(
    HOJA,
    /@media \(forced-colors: active\) \{\s*\.etapas \.etapas-barra a\[aria-current\] \{[^}]*forced-color-adjust: none;[^}]*HighlightText;[^}]*Highlight;/,
  );
});

test('prefers-reduced-motion anula las transiciones de la hoja en toda la página', () => {
  const base = readFileSync(new URL('../../web/estilos/base-adaptaciones.css', import.meta.url), 'utf8');
  assert.match(base, /@media \(prefers-reduced-motion: reduce\) \{[^@]*transition: none !important;/);
});

/** Las direcciones antiguas de la página y la parte que abren hoy (su posición). */
const ANTIGUAS: [string, number][] = [
  ['#paso-1', 0],
  ['#paso-2', 1],
  ['#paso-3', 2],
  ['#paso-4', CUARTA],
  ['#paso-5', QUINTA],
  ['#ia-que-es', 0],
  ['#ia-aprende', 1],
  ['#ia-tipos', 0],
  ['#ia-generativa', 2],
  ['#ejemplo', 2],
  ['#ia-bien-mal', CUARTA],
  ['#ia-errores', CUARTA],
  ['#ia-trabajo', QUINTA],
  ['#ia-criterio', CUARTA],
  ['#ia-glosario', GLOSARIO],
];

test('las direcciones antiguas siguen abriendo su parte: #paso-1 a #paso-5 y los fragmentos internos', async (t) => {
  for (const [fragmento, posicion] of ANTIGUAS) {
    const pagina = abrir(t, fragmento);
    await cargar();
    assert.equal(actual(pagina), posicion, fragmento);
    assert.equal(Pieza.enfocado, null, `${fragmento}: abrir no mueve el foco`);
  }
  // Las referencias 1 a 4 conservan su número y su id.
  const pagina = abrir(t);
  for (const id of ['ref-1', 'ref-2', 'ref-3', 'ref-4']) {
    assert.ok(pagina.porId(id), id);
  }
});

test('el enlace «glosario» de la entradilla abre su pestaña desde su principio, con el foco en su título', async (t) => {
  const pagina = abrir(t);
  await cargar();
  const enlace = pagina.raiz.querySelector('.entradilla a');
  assert.equal(enlace?.getAttribute('href'), '#glosario');
  pagina.navegar('#glosario');
  assert.equal(actual(pagina), GLOSARIO);
  assert.deepEqual(Pieza.desplazadas, [pagina.contenedor]);
  assert.equal(Pieza.enfocado?.pieza, pagina.porId('ia-glosario'));
});

test('las siete pestañas, con sus nombres en ES y en CA; el glosario y el desafío se nombran también en el móvil', async (t) => {
  fijarIdioma('es');
  const pagina = abrir(t);
  await cargar();
  const nombres = () => pagina.enlaces.map((enlace) => enlace.querySelector('.etapas-nombre')?.textContent);
  assert.deepEqual(
    nombres(),
    IDS.map((_, posicion) => es[`entender-ia.etapa.${posicion + 1}`]),
  );
  assert.deepEqual(nombres().slice(CUARTA), ['Precauciones', 'La IA en tu trabajo', 'Glosario', 'Desafío']);
  assert.deepEqual(
    pagina.enlaces.map((enlace) => enlace.parentElement?.hasAttribute('data-etapas-con-nombre')),
    [false, false, false, false, false, true, true],
  );
  assert.ok(pagina.contenedor.querySelector('[data-etapas-barra]')?.classList.contains('etapas-barra--ancha'));
  const { reescribirTextos } = await import('../../web/scripts/idioma.js');
  fijarIdioma('ca');
  reescribirTextos();
  assert.deepEqual(nombres().slice(CUARTA), ['Precaucions', 'La IA en la teva feina', 'Glossari', 'Desafiament']);
  fijarIdioma('es');
  reescribirTextos();
});

test('en el móvil, la hoja enseña el nombre y no el número de los pasos con data-etapas-con-nombre', () => {
  const bloques = [...HOJA.matchAll(/@media \(width <= 600px\) \{([\s\S]*?)\n\}\n/g)].map(([, cuerpo]) => cuerpo ?? '');
  const movil = bloques.find((cuerpo) => cuerpo.includes('data-etapas-con-nombre')) ?? '';
  assert.match(movil, /\[data-etapas-con-nombre\] \.etapas-nombre \{[^}]*position: static;[^}]*clip-path: none;/);
  assert.match(movil, /\[data-etapas-con-nombre\] \.etapas-numero \{[^}]*clip-path: inset\(50%\);/);
  assert.match(movil, /li\[data-etapas-con-nombre\] \{\s*flex: 0 0 auto;/, 'su pestaña toma el ancho del nombre');
  // En pantallas anchas, la barra larga ocupa la página y cada nombre cabe en una línea.
  assert.match(HOJA, /@media \(width >= 900px\) \{[^@]*\.etapas-barra--ancha a \{[^}]*white-space: nowrap;/);
});
