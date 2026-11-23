// La portada y el acceso abren en catalán. La aplicación respeta la elección guardada y el idioma del navegador.
// En las tres páginas, un enlace de idioma explícito se aplica y se limpia conservando el resto de la dirección.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { PAGINA_ACCESO_WEB } from '../../src/plataforma/cloudflare/acceso-web-pagina.ts';
import { PORTADA_PUBLICA, TEXTOS_PORTADA } from '../../src/plataforma/cloudflare/portada-publica.ts';

const INICIAL = readFileSync(new URL('../../web/scripts/idioma-inicial.js', import.meta.url), 'utf8');
const guionDe = (html: string) => {
  const guiones = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(([, guion]) => guion ?? '');
  assert.equal(guiones.length, 1);
  return guiones[0] ?? '';
};

/** Lo que encuentra el guion al abrirse la página. */
interface Situacion {
  direccion: string;
  guardado?: string | null;
  bloqueado?: boolean;
  idiomas?: string[];
}
/** Lo que deja: el idioma de la página, la dirección de la barra y lo guardado. */
interface Resultado {
  idioma: string;
  direccion: string;
  guardado: string | null;
}

/** Un elemento cualquiera de las dos páginas: el guion solo escribe textos y atributos, y escucha clics. */
class Elemento {
  dataset: Record<string, string> = { es: 'bandera-es', ca: 'bandera-ca' };
  textContent = '';
  children: Elemento[] = [];
  className = '';
  readonly clases = new Set<string>();
  readonly classList = {
    add: (nombre: string) => this.clases.add(nombre),
    remove: (nombre: string) => this.clases.delete(nombre),
  };
  hidden = false;
  disabled = false;
  required = false;
  type = '';
  value = '';
  href = '';
  src = '';
  alt = '';
  lang = '';
  readonly atributos = new Map<string, string>();
  readonly escuchas = new Map<string, (evento: unknown) => unknown>();
  #imagen: Elemento | undefined;
  replaceChildren(...hijos: Elemento[]) {
    this.children = hijos;
    this.textContent = hijos.map((hijo) => hijo.textContent).join('');
  }
  setAttribute(nombre: string, valor: string) {
    this.atributos.set(nombre, valor);
    if (nombre === 'href') {
      this.href = new URL(valor, this.href).href;
    }
  }
  hasAttribute(nombre: string) {
    return this.atributos.has(nombre);
  }
  removeAttribute(nombre: string) {
    this.atributos.delete(nombre);
  }
  addEventListener(tipo: string, escucha: (evento: unknown) => unknown) {
    this.escuchas.set(tipo, escucha);
  }
  focus() {}
  querySelector() {
    this.#imagen ??= new Elemento();
    return this.#imagen;
  }
}

/** El entorno común: dirección, historial, almacenamiento y navegador. */
function entorno({ direccion, guardado = null, bloqueado = false, idiomas = [] }: Situacion) {
  const estado = { direccion, guardado };
  const operacionesDeTema: string[] = [];
  const contexto = {
    URL,
    URLSearchParams,
    location: { href: direccion, search: new URL(direccion).search },
    history: {
      state: null,
      replaceState: (_estado: unknown, _titulo: string, nueva: string) => {
        estado.direccion = nueva;
      },
    },
    localStorage: {
      getItem: (clave: string) => {
        if (clave === 'faro-tema') {
          operacionesDeTema.push('leer');
        }
        if (bloqueado) {
          throw new Error('Bloqueado');
        }
        return clave === 'faro-idioma' ? estado.guardado : null;
      },
      setItem: (clave: string, valor: string) => {
        if (clave === 'faro-tema') {
          operacionesDeTema.push('escribir');
        }
        if (bloqueado) {
          throw new Error('Bloqueado');
        }
        if (clave === 'faro-idioma') {
          estado.guardado = valor;
        }
      },
    },
    navigator: { languages: idiomas },
    setTimeout: () => 0,
    clearTimeout: () => {},
  };
  return { contexto, estado, operacionesDeTema };
}

function enLaAplicacion(situacion: Situacion): Resultado {
  const { contexto, estado } = entorno(situacion);
  const dataset: Record<string, string> = {};
  const document = {
    documentElement: { dataset },
    baseURI: situacion.direccion,
    currentScript: { getAttribute: () => 'scripts/idioma-inicial.js' },
    createElement: () => ({}),
    head: { append: () => {} },
    querySelector: (selector: string) => (selector === 'link[rel=manifest]' ? { setAttribute: () => {} } : null),
  };
  runInNewContext(INICIAL, { ...contexto, document });
  return { idioma: dataset.idioma ?? '', ...estado };
}

const ESTRENO = Date.parse('2026-11-30T23:00:00Z');
const ANTES_DEL_ESTRENO = Date.parse('2026-11-30T22:59:59Z');

function enLaPagina(html: string, situacion: Situacion, instante = ANTES_DEL_ESTRENO): Resultado {
  const { contexto, estado, operacionesDeTema } = entorno(situacion);
  const raiz = new Elemento();
  const enlace = new Elemento();
  const destino = html === PORTADA_PUBLICA ? '/acceso-web' : '/';
  enlace.href = new URL(destino, situacion.direccion).href;
  const elementos = new Map([['volver-portada', enlace]]);
  const document = {
    documentElement: raiz,
    createElement: () => new Elemento(),
    title: '',
    getElementById: (id: string) => {
      const elemento = elementos.get(id) ?? new Elemento();
      elementos.set(id, elemento);
      return elemento;
    },
    querySelector: (selector: string) => (selector === '.acceso a' ? enlace : new Elemento()),
  };
  runInNewContext(guionDe(html), { ...contexto, document, Date: { parse: Date.parse, now: () => instante } });
  assert.deepEqual(operacionesDeTema, [], 'las pantallas públicas no consultan ni cambian el tema del interior');
  const pedido = new URL(situacion.direccion).searchParams.get('idioma');
  const enlaceEsperado = new URL(destino, situacion.direccion);
  if (pedido === 'ca' || pedido === 'es') {
    enlaceEsperado.searchParams.set('idioma', pedido);
  }
  assert.equal(enlace.href, enlaceEsperado.href);
  if (html === PORTADA_PUBLICA) {
    assert.ok(raiz.lang === 'ca' || raiz.lang === 'es');
    const t = TEXTOS_PORTADA[raiz.lang];
    const abierta = instante >= ESTRENO;
    assert.equal(elementos.get('cuenta-estado')?.textContent, abierta ? t.iniciada : t.cuenta);
    assert.equal(elementos.get('cuenta-estado')?.clases.has('abierta'), abierta);
    assert.equal(elementos.get('cuenta')?.hidden, abierta);
    assert.equal(elementos.get('cuenta-fecha')?.hidden, abierta);
  }
  return { idioma: raiz.lang, ...estado };
}

/** Resultado de la aplicación e idioma de las pantallas públicas. La dirección y la elección guardada son comunes. */
const CASOS: [string, Situacion, Resultado, 'ca' | 'es'][] = [
  [
    'primera visita con el navegador en inglés',
    { direccion: 'https://faro.invalid/', idiomas: ['en'] },
    { idioma: 'es', direccion: 'https://faro.invalid/', guardado: null },
    'ca',
  ],
  [
    'primera visita sin idiomas del navegador',
    { direccion: 'https://faro.invalid/' },
    { idioma: 'es', direccion: 'https://faro.invalid/', guardado: null },
    'ca',
  ],
  [
    'navegador en catalán',
    { direccion: 'https://faro.invalid/', idiomas: ['ca-ES', 'es'] },
    { idioma: 'ca', direccion: 'https://faro.invalid/', guardado: null },
    'ca',
  ],
  [
    'navegador en castellano aunque después admita el catalán',
    { direccion: 'https://faro.invalid/', idiomas: ['es-ES', 'ca'] },
    { idioma: 'es', direccion: 'https://faro.invalid/', guardado: null },
    'ca',
  ],
  [
    'la elección guardada manda sobre el navegador',
    { direccion: 'https://faro.invalid/', guardado: 'ca', idiomas: ['es'] },
    { idioma: 'ca', direccion: 'https://faro.invalid/', guardado: 'ca' },
    'ca',
  ],
  [
    'el castellano guardado solo rige en el interior',
    { direccion: 'https://faro.invalid/', guardado: 'es', idiomas: ['ca'] },
    { idioma: 'es', direccion: 'https://faro.invalid/', guardado: 'es' },
    'ca',
  ],
  [
    'una elección guardada que no es un idioma de Faro no cuenta',
    { direccion: 'https://faro.invalid/', guardado: 'fr', idiomas: ['ca'] },
    { idioma: 'ca', direccion: 'https://faro.invalid/', guardado: 'fr' },
    'ca',
  ],
  [
    '?idioma manda, se guarda y sale de la barra sin perder el resto de la dirección',
    { direccion: 'https://faro.invalid/inicio.html?volver=%2Fx&idioma=ca#arriba', guardado: 'es', idiomas: ['es'] },
    { idioma: 'ca', direccion: 'https://faro.invalid/inicio.html?volver=%2Fx#arriba', guardado: 'ca' },
    'ca',
  ],
  [
    'el castellano explícito manda también en la portada',
    { direccion: 'https://faro.invalid/?idioma=es&otro=1#pie', guardado: 'ca', idiomas: ['ca'] },
    { idioma: 'es', direccion: 'https://faro.invalid/?otro=1#pie', guardado: 'es' },
    'es',
  ],
  [
    'un ?idioma que no es de Faro no se toca',
    { direccion: 'https://faro.invalid/?idioma=fr', idiomas: ['ca'] },
    { idioma: 'ca', direccion: 'https://faro.invalid/?idioma=fr', guardado: null },
    'ca',
  ],
  [
    '?idioma sin almacenamiento vale para la página abierta',
    { direccion: 'https://faro.invalid/?idioma=ca', bloqueado: true, idiomas: ['es'] },
    { idioma: 'ca', direccion: 'https://faro.invalid/', guardado: null },
    'ca',
  ],
  [
    'sin almacenamiento se sigue al navegador',
    { direccion: 'https://faro.invalid/', bloqueado: true, idiomas: ['ca'] },
    { idioma: 'ca', direccion: 'https://faro.invalid/', guardado: null },
    'ca',
  ],
];

for (const [nombre, situacion, esperado, idiomaPublico] of CASOS) {
  test(`idioma inicial en la aplicación, la portada y el acceso: ${nombre}`, () => {
    const publico = { ...esperado, idioma: idiomaPublico };
    assert.deepEqual(enLaAplicacion(situacion), esperado, 'aplicación');
    assert.deepEqual(enLaPagina(PORTADA_PUBLICA, situacion), publico, 'portada con cuenta atrás');
    assert.deepEqual(enLaPagina(PORTADA_PUBLICA, situacion, ESTRENO), publico, 'portada tras el estreno');
    assert.deepEqual(enLaPagina(PAGINA_ACCESO_WEB, situacion), publico, 'acceso');
  });
}

test('al entrar en el acceso no se guarda un idioma que la persona no ha elegido', async () => {
  const direccion = 'https://faro.invalid/acceso-web';
  const { contexto, estado } = entorno({ direccion, idiomas: ['ca'] });
  const elementos = new Map<string, Elemento>();
  const destinos: string[] = [];
  const document = {
    documentElement: new Elemento(),
    title: '',
    getElementById: (id: string) => {
      const elemento = elementos.get(id) ?? new Elemento();
      elementos.set(id, elemento);
      return elemento;
    },
    querySelector: () => new Elemento(),
  };
  runInNewContext(guionDe(PAGINA_ACCESO_WEB), {
    ...contexto,
    document,
    location: { href: direccion, hash: '', assign: (destino: string) => destinos.push(destino) },
    fetch: async () => Response.json({ ok: true }),
    AbortController,
    URLSearchParams,
    FormData: class {
      *[Symbol.iterator]() {}
    },
  });
  const formulario = elementos.get('formulario-acceso');
  const enviar = formulario?.escuchas.get('submit');
  assert.ok(formulario && enviar);
  formulario.dataset.volver = '/inicio.html';
  // El primer envío pasa del usuario a la clave; el segundo entra.
  await enviar({ preventDefault: () => {} });
  await enviar({ preventDefault: () => {} });
  assert.deepEqual(destinos, ['/inicio.html']);
  assert.equal(estado.guardado, null);
});
