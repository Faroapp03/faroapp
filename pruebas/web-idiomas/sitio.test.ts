import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

const SITIO = new URL('../../web/scripts/sitio.js', import.meta.url);
const CATALAN = new URL('../../web/idiomas/ca.js', import.meta.url);
const ACCIONES: Record<string, readonly string[]> = {
  './acceso.js': ['comprobarAcceso'],
  './contacto.js': ['prepararContacto'],
  './instalacion.js': ['iniciarInstalacion'],
  './menu.js': ['iniciarMenu'],
  './selector-idioma.js': ['avisarDeIdiomaNoCargado', 'iniciarSelectorIdioma'],
  './secciones.js': ['iniciarSecciones'],
  './tema.js': ['iniciarTema'],
};
const raiz = { dataset: { idioma: 'ca' }, lang: 'es' };
Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: {
    documentElement: raiz,
    getElementById: () => null,
    querySelectorAll: () => [],
    querySelector: () => null,
  },
});
let estado = { acciones: [] as string[], barrera: Promise.resolve(), fallar: false, empezar: () => {} };
Object.defineProperty(globalThis, '__pruebaSitio', { configurable: true, get: () => estado });
registerHooks({
  resolve(especificador, contexto, siguiente) {
    const nombres = Object.hasOwn(ACCIONES, especificador) ? ACCIONES[especificador] : undefined;
    if (contexto.parentURL?.startsWith(SITIO.href) && nombres) {
      const fuente = nombres
        .map((nombre) => `export const ${nombre} = () => globalThis.__pruebaSitio.acciones.push('${nombre}');`)
        .join('\n');
      return { url: `data:text/javascript,${encodeURIComponent(fuente)}`, shortCircuit: true };
    }
    const alCatalan = especificador.startsWith('./ca.js') || especificador.startsWith(CATALAN.href);
    if (contexto.parentURL?.endsWith('/idiomas/cargar.js') && alCatalan) {
      // El diccionario es el real. Solo se demora o falla su entrada para observar el await del sitio. El primer
      // intento lo pide por su ruta literal y el reintento, por su dirección completa con la marca.
      const fuente = `globalThis.__pruebaSitio.empezar();
      await globalThis.__pruebaSitio.barrera;
      if (globalThis.__pruebaSitio.fallar) { throw new TypeError('Sin diccionario'); }
      export { default } from '${CATALAN.href}';
// ${especificador}`;
      return { url: `data:text/javascript,${encodeURIComponent(fuente)}`, shortCircuit: true };
    }
    return siguiente(especificador, contexto);
  },
});

async function abrir(fallar: boolean) {
  let liberar = () => {};
  const barrera = new Promise<void>((resolver) => {
    liberar = resolver;
  });
  let empezar = () => {};
  const esperando = new Promise<void>((resolver) => {
    empezar = resolver;
  });
  estado = { acciones: [], barrera, fallar, empezar };
  raiz.dataset.idioma = 'ca';
  const abierta = import(`${SITIO.href}?fallar=${fallar}`);
  try {
    await esperando;
    assert.deepEqual(estado.acciones, [], 'los controles esperan al idioma');
  } finally {
    liberar();
  }
  await abierta;
  return estado.acciones;
}

test('sitio real espera al idioma real y arranca sus controles tanto en fallback como en CA', async (contexto) => {
  contexto.mock.method(console, 'warn', () => {});
  const acciones = [
    'iniciarSecciones',
    'iniciarSelectorIdioma',
    'iniciarMenu',
    'iniciarTema',
    'iniciarInstalacion',
    'prepararContacto',
    'comprobarAcceso',
  ];
  assert.deepEqual(await abrir(true), [...acciones, 'avisarDeIdiomaNoCargado']);
  assert.equal(raiz.lang, 'es');
  assert.deepEqual(await abrir(false), acciones);
  assert.equal(raiz.lang, 'ca');
});
