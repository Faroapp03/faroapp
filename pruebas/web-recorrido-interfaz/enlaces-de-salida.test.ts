// La cabecera del recorrido es la del resto del sitio (menú, marca en el centro, sin «FARO APP») y sus enlaces de
// salida no pierden la conversación: con algo que perder se abren en otra pestaña, con su aviso, y sin nada que perder
// en la misma. «Algo que perder» es la misma respuesta que da el aviso al cerrar o recargar (avisarAlSalir).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { type TestContext, test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { EXTENSIONES } from '../../src/plataforma/extensiones.ts';
import { estado, hayAlgoQuePerder, nuevaTarea, reiniciarEstado } from '../../web/scripts/recorrido/estado.js';
import { navegador } from '../web-controles/ayudas.js';
import { documento, entorno, evento, Nodo } from './dom.ts';

const WEB = new URL('../../web/', import.meta.url);
const leer = (archivo: string) => readFileSync(new URL(archivo, WEB), 'utf8');
const sinComentarios = (texto: string, apertura: string, cierre: string) =>
  texto.replace(new RegExp(`${apertura}[\\s\\S]*?${cierre}`, 'g'), '');
const ORIGEN = 'https://faro.prueba';
const PAGINA = `${ORIGEN}/recorrido.html`;
const AVISO = 'rc-abre-en-otra-pestana';

/** Un enlace con las partes de su dirección resueltas sobre la página, como las da el navegador. */
class Enlace extends Nodo {
  constructor(href: string) {
    super('a');
    this.setAttribute('href', href);
  }
  private get destino() {
    return new URL(this.getAttribute('href') ?? '', PAGINA);
  }
  get origin() {
    return this.destino.protocol.startsWith('http') ? this.destino.origin : 'null';
  }
  get pathname() {
    return this.destino.pathname;
  }
  get search() {
    return this.destino.search;
  }
  get hash() {
    return this.destino.hash;
  }
}

/** El observador de cambios del DOM: la prueba lo dispara a mano. */
let alMutar: () => void = () => assert.fail('sin observador');
class Observador {
  constructor(llamada: () => void) {
    alMutar = llamada;
  }
  observe() {}
}

/** Lo que responde «algo que perder» en cada momento; el módulo se conecta una sola vez por proceso. */
let algoQuePerder = () => false;
let conectado = false;

async function preparar(t: TestContext) {
  entorno(t);
  navegador(t, {
    HTMLAnchorElement: Enlace,
    MutationObserver: Observador,
    location: { href: PAGINA, origin: ORIGEN, pathname: '/recorrido.html', search: '' },
  });
  const enlace = (href: string, padre = documento.body) => {
    const nuevo = new Enlace(href);
    padre.append(nuevo);
    return nuevo;
  };
  const enlaces = {
    salto: enlace('#contenido'),
    marca: enlace('inicio.html'),
    menu: enlace('entender-ia.html'),
    empezar: enlace('recorrido.html'),
    resultados: enlace('que-es-faro.html#resultados'),
    descrito: enlace('creditos.html'),
    externo: enlace('https://www.ilo.org/'),
    telefono: enlace('tel:024'),
  };
  enlaces.descrito.setAttribute('aria-describedby', 'otra-nota');
  enlaces.externo.setAttribute('target', '_blank');
  enlaces.externo.setAttribute('rel', 'noopener noreferrer');
  if (!conectado) {
    const { abrirFueraSinPerderLaConversacion } = await import('../../web/scripts/recorrido/enlaces-de-salida.js');
    abrirFueraSinPerderLaConversacion(() => algoQuePerder());
    conectado = true;
  } else {
    alMutar();
  }
  return { enlace, enlaces };
}

const destino = (a: Nodo) => ({
  target: a.getAttribute('target'),
  rel: a.getAttribute('rel'),
  describedby: a.getAttribute('aria-describedby'),
});
const MISMA_PESTANA = { target: null, rel: null, describedby: null };
const OTRA_PESTANA = { target: '_blank', rel: 'noopener', describedby: AVISO };

test('la cabecera del recorrido es la común: menú con su botón, marca y sin «FARO APP»', () => {
  const recorrido = sinComentarios(leer('recorrido.html'), '<!--', '-->');
  const inicio = sinComentarios(leer('inicio.html'), '<!--', '-->');
  assert.match(recorrido, /<button\s+class="menu-boton"[^>]*aria-controls="menu"/);
  assert.match(recorrido, /<nav id="menu" class="menu" hidden/);
  const destinosDelMenu = (html: string) =>
    [...(/<nav id="menu"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '').matchAll(/href="([^"]+)"/g)].map(([, href]) => href);
  assert.deepEqual(destinosDelMenu(recorrido), destinosDelMenu(inicio));
  assert.ok(destinosDelMenu(recorrido).length > 0);
  assert.doesNotMatch(recorrido, /FARO APP<|aviso-prototipo/);
  assert.match(recorrido, new RegExp(`<p id="${AVISO}" hidden inert data-texto="recorrido\\.abre-en-otra-pestana"`));
  assert.match(recorrido, /href="que-es-faro\.html#resultados" data-texto="que-es-faro\.enlace\.informe"/);
  for (const idioma of ['es', 'ca']) {
    const textos = leer(`idiomas/${idioma}/recorrido.js`);
    assert.doesNotMatch(textos, /'recorrido\.aviso\.(?:texto|titulo)'/, idioma);
    assert.match(textos, /'recorrido\.abre-en-otra-pestana': /, idioma);
  }
});

const VACIOS = new Set(['area', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const inerte = (apertura: string) => /\sinert(?=[\s/>=])/.test(apertura);

function cuerpoEHijos(html: string) {
  const limpio = sinComentarios(html, '<!--', '-->');
  const cuerpo = /<body\b[^>]*>/.exec(limpio);
  assert.ok(cuerpo, 'sin <body>');
  const interior = limpio.slice(cuerpo.index + cuerpo[0].length, limpio.lastIndexOf('</body>'));
  const hijos: string[] = [];
  let profundidad = 0;
  for (const [etiqueta, cierre = '', nombre = ''] of interior.matchAll(/<(\/?)([a-z][a-z0-9-]*)\b[^>]*>/g)) {
    if (cierre) {
      profundidad -= 1;
      assert.ok(profundidad >= 0, etiqueta);
      continue;
    }
    if (profundidad === 0) {
      hijos.push(etiqueta);
    }
    if (!VACIOS.has(nombre) && !etiqueta.endsWith('/>')) {
      profundidad += 1;
    }
  }
  assert.equal(profundidad, 0, 'etiquetas sin cerrar en <body>');
  return { cuerpo: cuerpo[0], hijos };
}

const INERTES =
  'el Original y cada extensión dejan inertes los hijos de <body>, no el cuerpo, ' +
  'y avisan tras el salto si falta la barrera';

test(INERTES, () => {
  for (const archivo of ['recorrido.html', ...EXTENSIONES.map(({ entrada }) => entrada)]) {
    const { cuerpo, hijos } = cuerpoEHijos(leer(archivo));
    assert.match(cuerpo, /^<body class="rc-cuerpo"/, archivo);
    assert.equal(inerte(cuerpo), false, `${archivo}: <body> no es inerte`);
    assert.ok(hijos.length > 10, `${archivo}: ${hijos.length} hijos`);
    assert.match(hijos[0] ?? '', /^<a class="salto" href="#contenido"[^>]*\sinert>$/, archivo);
    assert.equal(hijos[1], '<div id="faro-aviso-descarga" role="alert">', archivo);
    for (const id of ['faro-aviso-descarga', 'faro-version-aviso', AVISO, 'contenido']) {
      assert.equal(hijos.filter((apertura) => apertura.includes(` id="${id}"`)).length, 1, `${archivo}: #${id}`);
    }
    for (const apertura of hijos) {
      const libre = / id="faro-(?:aviso-descarga|version-aviso)"/.test(apertura);
      assert.equal(inerte(apertura), !libre, `${archivo}: ${apertura}`);
    }
  }
});

/** Las reglas de un @media que ocultan la cabecera común del recorrido: su condición y su selector. */
function reglasQueOcultanLaCabecera(hoja: string): [condicion: string, selector: string][] {
  const ocultan: [condicion: string, selector: string][] = [];
  for (const [, condicion = '', reglas = ''] of hoja.matchAll(/@media ([^{]+)\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)) {
    for (const [, selectores = '', declaraciones = ''] of reglas.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selectoresQueOcultan = selectores
        .split(',')
        .map((selector) => selector.trim())
        .filter(
          (selector) => /^\.rc-cuerpo\S*\s*>\s*\.cabecera$/.test(selector) && /display:\s*none/.test(declaraciones),
        );
      ocultan.push(...selectoresQueOcultan.map((selector): [string, string] => [condicion.trim(), selector]));
    }
  }
  return ocultan;
}

test('ninguna hoja del recorrido esconde el menú, y en el móvil vertical la cabecera común sigue a la vista', () => {
  const hojas = ['pagina.css', 'pantallas.css'].map((hoja) =>
    sinComentarios(leer(`estilos/recorrido/${hoja}`), '/\\*', '\\*/'),
  );
  for (const hoja of hojas) {
    assert.doesNotMatch(hoja, /\.menu-boton|aviso-prototipo/);
  }
  // Las reglas que ocultan la cabecera común solo valen con poco alto o mientras se escribe con el teclado en pantalla.
  const ocultan = reglasQueOcultanLaCabecera(hojas[1] ?? '');
  assert.deepEqual(ocultan, [
    ['(max-width: 1024px) and (max-height: 500px)', '.rc-cuerpo > .cabecera'],
    ['(max-width: 760px) and (pointer: coarse)', '.rc-cuerpo:has(#mensaje:focus) > .cabecera'],
  ]);
});

/** Las declaraciones de la primera regla de nivel superior con ese selector exacto. */
function declaracionesDe(hoja: string, selector: string): string {
  const reglas = [...hoja.matchAll(/(?:^|\})\s*([^{}@]+?)\s*\{([^{}]*)\}/g)];
  return reglas.find(([, selectores]) => selectores?.trim() === selector)?.[2] ?? assert.fail(`sin regla ${selector}`);
}

test('la cabecera del recorrido ocupa toda la fila con sus propias columnas, como en el resto del sitio', () => {
  const pagina = sinComentarios(leer('estilos/recorrido/pagina.css'), '/\\*', '\\*/');
  // Una sola columna del ancho de la ventana: nada de la página la ensancha ni reparte la cabecera en celdas.
  assert.match(declaracionesDe(pagina, '.rc-cuerpo'), /grid-template-columns: minmax\(0, 1fr\);/);
  const cabecera = declaracionesDe(pagina, '.rc-cuerpo > .cabecera');
  assert.match(cabecera, /grid-column: 1 \/ -1;/);
  assert.match(cabecera, /grid-row: 1;/);
  // Sin columnas propias del recorrido: las de .cabecera (base-cabecera.css), las mismas que en inicio.html.
  assert.doesNotMatch(cabecera, /grid-template-columns|padding|width|justify/);
  assert.doesNotMatch(pagina, /subgrid/);
});

test('la guía no lleva bloque de pie, y el diálogo «1 / 4» ofrece cada uno de sus destinos', () => {
  const recorrido = sinComentarios(leer('recorrido.html'), '<!--', '-->');
  const guia = /<aside class="rc-guia"[\s\S]*?<\/aside>/.exec(recorrido)?.[0] ?? assert.fail('sin guía');
  assert.doesNotMatch(guia, /<a\b|rc-guia-pie|rc-guia-nota|OIT/);
  const dialogo =
    /<nav class="rc-dialogo-enlaces"[\s\S]*?<\/nav\s*>/.exec(recorrido)?.[0] ?? assert.fail('sin diálogo');
  for (const destino of [
    'que-es-faro.html#como-funciona',
    'que-es-faro.html#resultados',
    'doctor.html',
    'creditos.html',
    'informacion-y-creditos.html#t-datos',
    'accesibilidad.html',
  ]) {
    assert.ok(dialogo.includes(`href="${destino}"`), destino);
  }
});

test('sin nada que perder los enlaces se siguen en la misma pestaña; con algo, los de salida se abren en otra', async (t) => {
  algoQuePerder = () => false;
  const { enlace, enlaces } = await preparar(t);
  for (const a of Object.values(enlaces).filter((a) => a !== enlaces.externo && a !== enlaces.descrito)) {
    assert.deepEqual(destino(a), MISMA_PESTANA, a.getAttribute('href') ?? '');
  }

  // Lo escrito en la barra no cambia el DOM: basta el evento input.
  algoQuePerder = () => true;
  documento.dispatchEvent(evento('input'));
  for (const a of [enlaces.marca, enlaces.menu, enlaces.empezar, enlaces.resultados]) {
    assert.deepEqual(destino(a), OTRA_PESTANA, a.getAttribute('href') ?? '');
  }
  assert.deepEqual(destino(enlaces.descrito), { ...OTRA_PESTANA, describedby: `otra-nota ${AVISO}` });
  assert.deepEqual(destino(enlaces.salto), MISMA_PESTANA, 'un fragmento de la misma página no sale de ella');
  assert.deepEqual(destino(enlaces.telefono), MISMA_PESTANA);
  assert.deepEqual(destino(enlaces.externo), { target: '_blank', rel: 'noopener noreferrer', describedby: null });

  // Lo que entra después (el informe, un mensaje) se pone al día con el observador.
  const tardio = enlace('accesibilidad.html');
  alMutar();
  assert.deepEqual(destino(tardio), OTRA_PESTANA);

  // Al volver a no tener nada que perder (otra pestaña lo borró todo), justo antes del clic vuelven a la misma pestaña,
  // con lo suyo intacto; el enlace externo conserva su propio destino.
  algoQuePerder = () => false;
  documento.dispatchEvent(evento('click'));
  for (const a of [enlaces.marca, enlaces.menu, enlaces.empezar, enlaces.resultados, tardio]) {
    assert.deepEqual(destino(a), MISMA_PESTANA, a.getAttribute('href') ?? '');
  }
  assert.deepEqual(destino(enlaces.descrito), { ...MISMA_PESTANA, describedby: 'otra-nota' });
  assert.deepEqual(destino(enlaces.externo), { target: '_blank', rel: 'noopener noreferrer', describedby: null });

  // Al enfocar un enlace, antes de que el lector de pantalla lo anuncie.
  algoQuePerder = () => true;
  documento.dispatchEvent(evento('focusin'));
  assert.deepEqual(destino(enlaces.menu), OTRA_PESTANA);
});

const fuente = readFileSync(new URL('scripts/recorrido.js', WEB), 'utf8');
/** Ejecuta los bytes de una función privada de recorrido.js, como borrado-integrado.test.ts. */
function funcion(nombre: string): string {
  const inicio = fuente.search(new RegExp(`function ${nombre}\\(`));
  assert.ok(inicio >= 0, nombre);
  return fuente.slice(inicio, fuente.indexOf('\n}', inicio) + '\n}'.length);
}

test('los enlaces y el aviso al salir dan la misma respuesta en cada caso; beforeunload sigue igual', async (t) => {
  const iniciar = funcion('iniciarRecorrido');
  assert.match(iniciar, /window\.addEventListener\('beforeunload', avisarAlSalir\);/);
  assert.match(iniciar, /abrirFueraSinPerderLaConversacion\(hayAlgoQueSePerderia\);/);

  reiniciarEstado();
  const pagina = { body: { dataset: {} as Record<string, string> }, documentElement: { dataset: {} } };
  const barra = { escrito: '', haHablado: false };
  const ramas = runInNewContext(
    `${funcion('hayAlgoQueSePerderia')}\n${funcion('avisarAlSalir')}\n({ hayAlgoQueSePerderia, avisarAlSalir })`,
    {
      document: pagina,
      hayAlgoQuePerder,
      hayMensajeDeLaPersona: () => barra.haHablado,
      textoEnLaBarra: () => barra.escrito,
    },
  ) as { hayAlgoQueSePerderia(): boolean; avisarAlSalir(e: { preventDefault(): void; returnValue?: string }): void };
  algoQuePerder = ramas.hayAlgoQueSePerderia;
  const { enlaces } = await preparar(t);

  const casos: [string, () => void][] = [
    ['página vacía', () => {}],
    ['algo escrito sin enviar', () => Object.assign(barra, { escrito: 'Atiendo a clientes' })],
    ['solo espacios', () => Object.assign(barra, { escrito: '   ' })],
    ['un mensaje de la persona', () => Object.assign(barra, { haHablado: true })],
    ['una tarea elegida', () => estado.tareas.push(nuevaTarea('Tarea sintética'))],
    ['un informe recibido', () => Object.assign(pagina.body.dataset, { conversacion: 'empezada' })],
  ];
  for (const [caso, poner] of casos) {
    Object.assign(barra, { escrito: '', haHablado: false });
    pagina.body.dataset = {};
    reiniciarEstado();
    poner();
    let pregunta = false;
    const salida = { preventDefault: () => (pregunta = true), returnValue: 'anterior' };
    ramas.avisarAlSalir(salida);
    documento.dispatchEvent(evento('input'));
    assert.deepEqual(destino(enlaces.menu), pregunta ? OTRA_PESTANA : MISMA_PESTANA, caso);
    assert.equal(salida.returnValue, pregunta ? '' : 'anterior', caso);
  }
  reiniciarEstado();
});
