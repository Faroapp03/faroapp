// La página «Instalar Faro» (instalar.html y scripts/instalar.js) sobre el HTML real en el doble de etapas: sus dos
// pestañas (scripts/etapas.js, variante «segmentos»), la pestaña inicial según lo que sabe hacer el navegador y no
// según su nombre, el fragmento de la dirección que manda sobre ella, el botón que abre la ventana de instalación del
// navegador (prompt() de beforeinstallprompt) o, si no la ofrece (Brave), los pasos de ese navegador, «Faro ya está
// instalado» como aplicación y la confirmación tras appinstalled. Cada prueba carga una instalacion.js y una
// etapas.js propias: las
// dos guardan estado y oyentes desde que se cargan. Estilos y la ventana real del navegador, en las capturas.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { after, type TestContext, test } from 'node:test';
import es from '../../web/idiomas/es.js';
import { registrarDiccionario } from '../../web/scripts/textos.js';
import { navegador } from '../web-controles/ayudas.js';
import { abrirEtapas, Pieza } from './etapas-doble.ts';

const SITIO = new URL('../../web/scripts/sitio.js', import.meta.url).href;
const INSTALAR = new URL('../../web/scripts/instalar.js', import.meta.url);
const ETAPAS = new URL('../../web/scripts/etapas.js', import.meta.url);
const PAGINA = readFileSync(new URL('../../web/instalar.html', import.meta.url), 'utf8');
/** Los módulos con estado propio que cada carga de instalar.js recibe nuevos, con su misma marca. */
const CON_ESTADO = new Set(['./instalacion.js', './etapas.js']);
/** Las pestañas, en su orden: id y nombre en castellano. */
const PESTANAS = [
  ['chromium', 'Brave, Chrome y Edge'],
  ['safari-firefox', 'Safari y Firefox'],
] as const;
const CHROMIUM = 0;
const SAFARI_FIREFOX = 1;
/** Vueltas para que terminen la ventana simulada del navegador y sus avisos. */
const VUELTAS = 4;

const hooks = registerHooks({
  resolve(especificador, contexto, siguiente) {
    const padre = contexto.parentURL ?? '';
    if (padre.startsWith(`${INSTALAR.href}?`) && CON_ESTADO.has(especificador)) {
      return { url: `${new URL(especificador, padre).href}${new URL(padre).search}`, shortCircuit: true };
    }
    return siguiente(especificador, contexto);
  },
  load(url, contexto, siguiente) {
    // El idioma, el menú y lo demás común los inicia sitio.js, que aquí no hace falta: el diccionario lo registra la
    // prueba.
    if (url === SITIO) {
      return { format: 'module', source: '', shortCircuit: true };
    }
    return siguiente(url, contexto);
  },
});
after(() => hooks.deregister());
registrarDiccionario('es', es);

let instancia = 0;

/** Las piezas de instalar.html que se ven u ocultan según el navegador y el estado. */
const PIEZAS = ['instalar-accion', 'instalar-nota', 'instalar-abierta', 'instalar-instalada', 'instalar-pasos'];

interface Navegador {
  /** Si conoce beforeinstallprompt ('onbeforeinstallprompt' in window), como Chrome y Edge. */
  conEvento?: boolean;
  /** Las marcas de navigator.userAgentData (solo Chromium, también Brave); sin ellas, no lo tiene. */
  marcas?: string[];
  /** Si expone navigator.brave, la interfaz propia de Brave. */
  brave?: boolean;
  fragmento?: string;
  /** Faro abierto como aplicación instalada (display-mode: standalone). */
  comoAplicacion?: boolean;
}

/** Brave en el ordenador: userAgentData y navigator.brave, sin beforeinstallprompt. */
const BRAVE: Navegador = { marcas: ['Brave', 'Chromium', 'Not=A?Brand'], brave: true };
/** Chrome: userAgentData con su marca y beforeinstallprompt. */
const CHROME: Navegador = { marcas: ['Google Chrome', 'Chromium', 'Not=A?Brand'], conEvento: true };

/** instalar.html en el doble, con un navegador de esas capacidades, y su módulo ya en marcha. */
async function abrir(t: TestContext, opciones: Navegador = {}) {
  const { conEvento = false, marcas, brave = false, fragmento = '', comoAplicacion = false } = opciones;
  const pagina = abrirEtapas(t, PAGINA, fragmento);
  if (conEvento) {
    Object.assign(pagina.ventana, { onbeforeinstallprompt: null });
  }
  const modo = Object.assign(new EventTarget(), { matches: comoAplicacion });
  Object.defineProperty(globalThis.document, 'activeElement', {
    configurable: true,
    get: () => Pieza.enfocado?.pieza ?? null,
  });
  const datos = marcas ? { userAgentData: { brands: marcas.map((brand) => ({ brand, version: '1' })) } } : {};
  navegador(t, {
    matchMedia: () => modo,
    HTMLButtonElement: Pieza,
    navigator: { ...datos, ...(brave ? { brave: { isBrave: async () => true } } : {}) },
  });
  await import(`${INSTALAR.href}?prueba=${++instancia}`);
  const visibles = () => PIEZAS.filter((id) => !pagina.porId(id).hidden);
  /** Los navegadores cuyos pasos se ven. */
  const pasosVisibles = () =>
    (pagina.porId('instalar-pasos').querySelectorAll('[data-navegador]') as Pieza[])
      .filter((paso) => !paso.hidden)
      .map((paso) => paso.dataset.navegador);
  return { ...pagina, modo, visibles, pasosVisibles, boton: pagina.porId('instalar-boton') };
}

type Pagina = Awaited<ReturnType<typeof abrir>>;

/** La pestaña que se ve, comprobando que es una sola y que su enlace es el único actual («true», segmentos). */
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

/** Deja terminar las promesas de la ventana simulada y de sus avisos. */
async function asentar() {
  for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
    await new Promise((listo) => setImmediate(listo));
  }
}

/** El navegador ofrece su ventana: un beforeinstallprompt con prompt() y la respuesta de la persona. */
function ofrecerVentana(t: TestContext, { ventana }: Pagina, respuesta = 'accepted') {
  const prompt = t.mock.fn(async () => {});
  const peticion = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt,
    userChoice: Promise.resolve({ outcome: respuesta }),
  });
  ventana.dispatchEvent(peticion);
  return { prompt, peticion };
}

test('el HTML tiene dos pestañas de segmentos, sin controles al pie, y sin JavaScript se ven los pasos', (t) => {
  const { contenedor, etapas, enlaces, porId } = abrirEtapas(t, PAGINA);
  assert.equal(contenedor.dataset.etapas, 'segmentos');
  assert.equal(contenedor.querySelector('[data-etapas-controles]'), null);
  assert.deepEqual(
    etapas.map((etapa) => etapa.id),
    PESTANAS.map(([id]) => id),
  );
  assert.deepEqual(
    enlaces.map((enlace) => [enlace.getAttribute('href'), enlace.textContent]),
    PESTANAS.map(([id, nombre]) => [`#${id}`, nombre]),
  );
  assert.deepEqual(
    PIEZAS.filter((id) => !porId(id).hidden),
    ['instalar-pasos'],
  );
  assert.ok(porId('instalar-boton').closest('#instalar-accion'));
  assert.ok(porId('contenido').hasAttribute('data-instalar'), 'la marca que deja el menú sin su enlace');
});

test('Brave (userAgentData, sin beforeinstallprompt): su pestaña y el botón, sin tocar la dirección', async (t) => {
  const pagina = await abrir(t, BRAVE);
  assert.equal(pagina.contenedor.dataset.etapasInicial, 'chromium');
  assert.equal(actual(pagina), CHROMIUM);
  assert.deepEqual(pagina.visibles(), ['instalar-accion']);
  assert.equal(pagina.boton.textContent, es['instalar.boton']);
  assert.deepEqual(pagina.apuntadas, []);
  assert.deepEqual(Pieza.desplazadas, [], 'abrir sin fragmento no mueve la vista');
});

test('Brave sin ventana del navegador: el botón despliega sus pasos, con el foco en ellos y anunciados', async (t) => {
  const pagina = await abrir(t, BRAVE);
  pagina.boton.focus();
  pagina.boton.dispatchEvent(new Event('click'));
  await asentar();
  assert.deepEqual(pagina.visibles(), ['instalar-accion', 'instalar-pasos']);
  assert.deepEqual(pagina.pasosVisibles(), ['brave']);
  assert.equal(Pieza.enfocado?.pieza, pagina.porId('instalar-pasos'));
  assert.equal(pagina.porId('instalar-estado').getAttribute('aria-live'), 'polite');
  const pasos = pagina.porId('instalar-pasos').textContent;
  assert.ok(pasos.includes('«Instalar Faro…»'));
  assert.ok(pasos.includes(es['instalar.ya-instalada'] ?? '-'));
});

test('Chrome con userAgentData pero sin beforeinstallprompt (ya instalado): botón y, al pulsar, sus pasos', async (t) => {
  const pagina = await abrir(t, { marcas: ['Google Chrome', 'Chromium'] });
  assert.equal(actual(pagina), CHROMIUM);
  pagina.boton.dispatchEvent(new Event('click'));
  await asentar();
  assert.deepEqual(pagina.pasosVisibles(), ['chrome']);
});

test('un Chromium sin marca conocida enseña los pasos de los tres', async (t) => {
  const pagina = await abrir(t, { conEvento: true });
  assert.equal(actual(pagina), CHROMIUM);
  pagina.boton.dispatchEvent(new Event('click'));
  await asentar();
  assert.deepEqual(pagina.pasosVisibles(), ['brave', 'chrome', 'edge']);
});

test('Safari y Firefox (sin userAgentData ni beforeinstallprompt): su pestaña; la otra, con los pasos y sin botón', async (t) => {
  const pagina = await abrir(t);
  assert.equal(pagina.contenedor.dataset.etapasInicial, 'safari-firefox');
  assert.equal(actual(pagina), SAFARI_FIREFOX);
  assert.deepEqual(pagina.visibles(), ['instalar-pasos']);
  assert.deepEqual(pagina.pasosVisibles(), ['brave', 'chrome', 'edge']);
});

test('un fragmento explícito manda sobre la pestaña del navegador, en los dos sentidos', async (t) => {
  assert.equal(actual(await abrir(t, { fragmento: '#chromium' })), CHROMIUM);
  assert.equal(actual(await abrir(t, { ...BRAVE, fragmento: '#safari-firefox' })), SAFARI_FIREFOX);
});

test('volver a la dirección sin fragmento devuelve la pestaña del navegador, no la primera', async (t) => {
  const pagina = await abrir(t);
  pagina.enlaces[CHROMIUM]?.dispatchEvent(new Event('click', { cancelable: true }));
  assert.equal(actual(pagina), CHROMIUM);
  pagina.volver('');
  assert.equal(actual(pagina), SAFARI_FIREFOX);
});

test('con la ventana del navegador, el botón la abre (prompt) y, si se acepta, confirma la instalación', async (t) => {
  const pagina = await abrir(t, CHROME);
  const { prompt, peticion } = ofrecerVentana(t, pagina);
  assert.equal(peticion.defaultPrevented, true);
  assert.deepEqual(pagina.visibles(), ['instalar-accion', 'instalar-nota']);
  assert.equal(prompt.mock.callCount(), 0, 'la ventana solo se abre con el gesto');
  pagina.boton.focus();
  pagina.boton.dispatchEvent(new Event('click'));
  await asentar();
  assert.equal(prompt.mock.callCount(), 1);
  assert.deepEqual(pagina.visibles(), ['instalar-instalada']);
  assert.equal(pagina.porId('instalar-instalada').textContent, es['instalar.instalada']);
  assert.equal(Pieza.enfocado?.pieza, pagina.porId('instalar-instalada'), 'el foco no se pierde con el botón');
});

test('si la persona no acepta, el botón sigue y, al pulsarlo de nuevo, enseña los pasos', async (t) => {
  const pagina = await abrir(t, CHROME);
  const { prompt } = ofrecerVentana(t, pagina, 'dismissed');
  pagina.boton.dispatchEvent(new Event('click'));
  await asentar();
  assert.equal(prompt.mock.callCount(), 1);
  assert.deepEqual(pagina.visibles(), ['instalar-accion']);
  pagina.boton.dispatchEvent(new Event('click'));
  await asentar();
  assert.equal(prompt.mock.callCount(), 1);
  assert.deepEqual(pagina.visibles(), ['instalar-accion', 'instalar-pasos']);
});

test('appinstalled (instalado desde la barra de direcciones): «Faro está instalado», sin botón', async (t) => {
  const pagina = await abrir(t, CHROME);
  ofrecerVentana(t, pagina);
  pagina.ventana.dispatchEvent(new Event('appinstalled'));
  assert.deepEqual(pagina.visibles(), ['instalar-instalada']);
});

test('abierto como aplicación (display-mode: standalone): «Faro ya está instalado», sin botón', async (t) => {
  const pagina = await abrir(t, { ...BRAVE, comoAplicacion: true });
  assert.deepEqual(pagina.visibles(), ['instalar-abierta']);
  assert.equal(pagina.porId('instalar-abierta').textContent, es['instalar.abierta']);
});

test('etapas.js: un data-etapas-inicial que no es de ninguna etapa no cumple el contrato y deja la página entera', async (t) => {
  const { contenedor } = abrirEtapas(t, PAGINA);
  contenedor.dataset.etapasInicial = 'ninguna';
  await assert.rejects(import(`${ETAPAS.href}?inicial=${++instancia}`), { name: 'PaginaIncompleta' });
  assert.equal(contenedor.classList.contains('etapas--activas'), false);
});
