import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import ca from '../../web/idiomas/ca.js';
import es from '../../web/idiomas/es.js';
import { conVersiones, enIdioma, idiomaActual, registrarDiccionario, traducible } from '../../web/scripts/textos.js';

// Doble limitado al contrato DOM que usa idioma.js; ningún HTML se analiza.
class Elemento {
  dataset: Record<string, string> = {};
  atributos = new Map<string, string>();
  children: Elemento[] = [];
  parentElement = null;
  lang = '';
  textContent = '';
  getAttribute(nombre: string) {
    return this.atributos.get(nombre) ?? null;
  }
  hasAttribute(nombre: string) {
    return this.atributos.has(nombre);
  }
  setAttribute(nombre: string, valor: string) {
    this.atributos.set(nombre, valor);
  }
  removeAttribute(nombre: string) {
    this.atributos.delete(nombre);
    if (nombre === 'data-texto') {
      delete this.dataset.texto;
    }
    if (nombre === 'data-dato') {
      delete this.dataset.dato;
    }
  }
  replaceChildren(...nodos: { textContent: string }[]) {
    this.children = nodos.filter((nodo): nodo is Elemento => nodo instanceof Elemento);
    this.textContent = nodos.map((nodo) => nodo.textContent).join('');
  }
}
const raiz = new Elemento();
raiz.dataset.idioma = 'ca';
raiz.dataset.traduciendo = '';
const elementos: Elemento[] = [];
const manifiesto = new Elemento();
manifiesto.setAttribute('href', '../manifest.webmanifest');
const versionAlAbrir = {};
const serviceWorker = { controller: versionAlAbrir };
const guardado = new Map<string, string>();
Object.defineProperties(globalThis, {
  HTMLElement: { configurable: true, value: Elemento },
  navigator: { configurable: true, value: { serviceWorker } },
  localStorage: {
    configurable: true,
    value: { setItem: (clave: string, valor: string) => guardado.set(clave, valor) },
  },
  document: {
    configurable: true,
    value: {
      documentElement: raiz,
      baseURI: 'https://faro.invalid/subcarpeta/demo/recorrido.html',
      querySelectorAll: () => elementos,
      querySelector: () => manifiesto,
      createTextNode: (textContent: string) => ({ textContent }),
    },
  },
});
function elemento() {
  const nuevo = new Elemento();
  elementos.push(nuevo);
  // El doble anterior implementa los miembros utilizados; el borde simulado se convierte una sola vez.
  return nuevo as unknown as HTMLElement;
}
let cortarCatalan = true;
let cortarCastellano = true;
const fallidas = new Set<string>();
const pedidas: string[] = [];
registerHooks({
  resolve(especificador, contexto, siguiente) {
    const resuelto = siguiente(especificador, contexto);
    if (resuelto.url.includes('/idiomas/es.js')) {
      if (cortarCastellano) {
        fallidas.add(resuelto.url);
      }
      if (fallidas.has(resuelto.url)) {
        throw new TypeError('Diccionario sin conexión');
      }
    }
    if (resuelto.url.includes('/idiomas/ca.js')) {
      pedidas.push(resuelto.url);
      if (cortarCatalan) {
        fallidas.add(resuelto.url);
      }
      if (fallidas.has(resuelto.url)) {
        throw new TypeError('Diccionario sin conexión');
      }
    }
    return resuelto;
  },
});
const {
  alCambiarIdioma,
  cambiarIdioma,
  DiccionarioNoCargado,
  escribir,
  escribirAtributo,
  iniciarIdioma,
  reescribirTextos,
  VersionNueva,
} = await import('../../web/scripts/idioma.js');
const CLAVE = 'recorrido.saludo.hola';

test('sin ningún diccionario conserva el HTML castellano y deja ver la página', async (contexto) => {
  contexto.mock.method(console, 'warn', () => {});
  const saludo = elemento();
  saludo.textContent = 'Contenido HTML';
  escribir(saludo, traducible(CLAVE));
  assert.equal(await iniciarIdioma(), false);
  assert.equal(saludo.textContent, 'Contenido HTML');
  assert.equal(idiomaActual(), 'es');
  assert.equal(raiz.dataset.traduciendo, undefined);
  cortarCastellano = false;
  raiz.dataset.idioma = 'ca';
});

test('antes del diccionario conserva HTML y al fallar CA arranca en ES', async (contexto) => {
  contexto.mock.method(console, 'warn', () => {});
  const saludo = elemento();
  saludo.textContent = 'Contenido HTML';
  escribir(saludo, traducible(CLAVE));
  assert.equal(saludo.textContent, 'Contenido HTML');
  assert.equal(await iniciarIdioma(), false);
  assert.equal(saludo.textContent, es[CLAVE]);
  assert.equal(idiomaActual(), 'es');
  assert.equal(raiz.lang, 'es');
  assert.equal(manifiesto.getAttribute('href'), 'https://faro.invalid/subcarpeta/manifest.webmanifest');
  assert.equal(raiz.dataset.traduciendo, undefined);
});

test('una versión nueva bloquea el diccionario aún no cargado', async () => {
  serviceWorker.controller = {};
  const antes = pedidas.length;
  await assert.rejects(cambiarIdioma('ca'), VersionNueva);
  assert.equal(pedidas.length, antes);
  assert.equal(idiomaActual(), 'es');
  serviceWorker.controller = versionAlAbrir;
});

test('si falla la carga conserva idioma y permite reintentar con otra URL', async () => {
  await assert.rejects(
    cambiarIdioma('ca'),
    (error: unknown) => error instanceof DiccionarioNoCargado && error.cause instanceof TypeError,
  );
  cortarCatalan = false;
  await cambiarIdioma('ca');
  assert.equal(idiomaActual(), 'ca');
  assert.ok(pedidas.at(-1)?.includes('#reintento-'));
  assert.equal(manifiesto.getAttribute('href'), 'https://faro.invalid/subcarpeta/manifest-ca.webmanifest');
});

test('manda el último idioma pedido y los ya cargados no se piden otra vez', async () => {
  const antes = pedidas.length;
  await Promise.all([cambiarIdioma('es'), cambiarIdioma('ca'), cambiarIdioma('es')]);
  assert.equal(idiomaActual(), 'es');
  assert.equal(pedidas.length, antes);
  await cambiarIdioma('fr');
  assert.equal(idiomaActual(), 'es');
});

test('reescribe contenido, atributos y datos con versiones usando solo nodos de texto', async () => {
  const ataque = '<img src=x onerror=alert(1)>';
  registrarDiccionario('es', { ...es, prueba: 'Inicio {0} {valor}' });
  registrarDiccionario('ca', { ...ca, prueba: 'Inici {0} {valor}' });
  const enlace = new Elemento();
  enlace.textContent = 'Enlace';
  const padre = elemento();
  Object.assign(padre, { children: [enlace] });
  escribir(padre, traducible('prueba', { valor: ataque }));
  assert.equal(padre.textContent, `Inicio Enlace ${ataque}`);
  assert.equal(padre.children[0], enlace);
  const dato = elemento();
  const versiones = { es: 'Dato', ca: null as string | null };
  escribir(dato, conVersiones(versiones));
  const campo = elemento();
  escribirAtributo(campo, 'title', traducible(CLAVE));
  await cambiarIdioma('ca');
  assert.equal(padre.textContent, `Inici Enlace ${ataque}`);
  assert.equal(campo.getAttribute('title'), ca[CLAVE]);
  assert.equal(dato.textContent, 'Dato');
  assert.equal(dato.lang, 'es');
  versiones.ca = 'Dada';
  reescribirTextos();
  assert.equal(dato.textContent, 'Dada');
  assert.equal(dato.lang, 'ca');
  escribir(dato, enIdioma(ataque, 'en'));
  assert.equal(dato.textContent, ataque);
  assert.equal(dato.lang, 'en');
});

test('consumidores aislados, duplicados y dados de baja no interrumpen el cambio', async (contexto) => {
  const errores = contexto.mock.method(console, 'error', () => {});
  const baja = new AbortController();
  const avisados: string[] = [];
  const anotar = (idioma: string) => {
    avisados.push(idioma);
  };
  const falla = () => {
    throw new Error('Consumidor roto');
  };
  const rechaza = async () => {
    throw new Error('Consumidor asíncrono roto');
  };
  for (const funcion of [anotar, anotar, falla, rechaza]) {
    alCambiarIdioma(funcion, { signal: baja.signal });
  }
  await cambiarIdioma('es');
  await new Promise<void>((listo) => setImmediate(listo));
  assert.deepEqual(avisados, ['es']);
  assert.equal(guardado.get('faro-idioma'), 'es');
  assert.equal(errores.mock.callCount(), 2);
  baja.abort();
  await cambiarIdioma('ca');
  assert.deepEqual(avisados, ['es']);
});
