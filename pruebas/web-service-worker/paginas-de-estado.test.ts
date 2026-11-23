// Las páginas de estado que el service worker sirve por sí mismo (H2): una por estado, en castellano y en catalán, con
// los textos de los diccionarios y el estilo mínimo en línea, sin recursos externos.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { textoPoliticaCache } from '../../herramientas/web/politica-cache.ts';
import {
  CLAVES_COMUNES_DEL_SERVICIO,
  CSP_DE_LAS_PAGINAS,
  ESTADOS_DEL_SERVICIO,
  type EstadoDelServicio,
  paginasDelServicio,
} from '../../herramientas/web/servicio/politica-del-servicio.ts';
import { politicaSeccionesInicial, VERSION_SECCIONES_PUBLICAS } from '../../src/administracion/secciones-web.js';
import { TEXTOS_INSTALACION as INSTALACION_CA } from '../../web/idiomas/ca/instalacion.js';
import { TEXTOS_SECCIONES as SECCIONES_CA } from '../../web/idiomas/ca/secciones.js';
import { TEXTOS_INSTALACION as INSTALACION_ES } from '../../web/idiomas/es/instalacion.js';
import { TEXTOS_SECCIONES as SECCIONES_ES } from '../../web/idiomas/es/secciones.js';
import { BASES, servicio } from './ayudas.ts';

const DICCIONARIOS: Record<'es' | 'ca', Record<string, string>> = {
  es: { ...INSTALACION_ES, ...SECCIONES_ES },
  ca: { ...INSTALACION_CA, ...SECCIONES_CA },
};
const NO_DISPONIBLE = 503;
const RETIRADA = 404;
const sinEntidades = (texto = '') => texto.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

/** La respuesta entera del service worker a una navegación, con sus cabeceras. */
async function navegar(sw: ReturnType<typeof servicio>, ruta: string) {
  let respuesta: Promise<Response> | undefined;
  const trabajos: Promise<unknown>[] = [];
  sw.oyentes.get('fetch')?.({
    request: { url: sw.urlDe(ruta), method: 'GET', mode: 'navigate' },
    respondWith: (valor: Promise<Response> | Response) => {
      respuesta = Promise.resolve(valor);
    },
    waitUntil: (valor: Promise<unknown>) => trabajos.push(valor),
  });
  const recibida = await respuesta;
  await Promise.all(trabajos);
  assert.ok(recibida, `el service worker responde a ${ruta}`);
  return { estado: recibida.status, cabeceras: recibida.headers, html: await recibida.text() };
}

/**
 * La clave del texto de cada estado, fijada aquí y no tomada del mapa: un intercambio en ESTADOS_DEL_SERVICIO la pone
 * en rojo. Cada página lleva el título, el texto de su estado y el enlace al inicio.
 */
const CLAVES_ESPERADAS: Record<EstadoDelServicio, string> = {
  'sin-conexion': 'sin-conexion.descripcion',
  'no-comprobada': 'servicio.no-comprobada',
  retirada: 'servicio.retirada',
  'otra-version': 'servicio.otra-version',
  'acceso-sin-conexion': 'servicio.acceso-sin-conexion',
};

/** El texto aprobado de cada estado, byte a byte, en los dos idiomas: un cambio en los diccionarios lo pone en rojo. */
const TEXTOS_APROBADOS: Record<EstadoDelServicio, Record<'es' | 'ca', string>> = {
  'sin-conexion': {
    es: 'Faro sin conexión: esta página no está disponible ahora. Vuelve a intentarlo cuando tengas conexión.',
    ca: 'Faro sense connexió: aquesta pàgina no està disponible ara. Torna-ho a provar quan tinguis connexió.',
  },
  'no-comprobada': {
    es: 'No se ha podido comprobar si esta sección está disponible. Vuelve a intentarlo dentro de un rato.',
    ca: 'No s’ha pogut comprovar si aquesta secció està disponible. Torna-ho a provar d’aquí a una estona.',
  },
  retirada: {
    es: 'Esta sección está desactivada. Puedes volver al inicio para seguir usando Faro.',
    ca: 'Aquesta secció està desactivada. Pots tornar a l’inici per continuar fent servir Faro.',
  },
  'otra-version': {
    es: 'Esta página es de otra versión de Faro. Vuelve al inicio para cargar la versión actual.',
    ca: 'Aquesta pàgina és d’una altra versió de Faro. Torna a l’inici per carregar la versió actual.',
  },
  'acceso-sin-conexion': {
    es: 'Para comprobar tu acceso hace falta conexión. Vuelve a intentarlo cuando tengas conexión.',
    ca: 'Per comprovar el teu accés cal connexió. Torna-ho a provar quan tinguis connexió.',
  },
};

/** La entradilla aprobada de sin-conexion.html, en los dos idiomas. */
const ENTRADILLA_APROBADA: Record<'es' | 'ca', string> = {
  es: 'Puedes leer las secciones guardadas o volver a intentarlo con conexión. Para hacer el recorrido, su descarga para uso sin conexión debe haber terminado.',
  ca: 'Pots llegir les seccions desades o tornar-ho a provar amb connexió. Per fer el recorregut, la descàrrega per fer-lo servir sense connexió ha d’haver acabat.',
};

const ESTADOS = Object.keys(CLAVES_ESPERADAS) as EstadoDelServicio[];
const IDIOMAS = ['es', 'ca'] as const;
const escaparComoLaPagina = (texto: string) => texto.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** La parte de la página en `idioma` y sus textos visibles, sin entidades. */
function parteDe(html: string, idioma: 'es' | 'ca') {
  const parte = html.match(new RegExp(`<section lang="${idioma}">(.*?)</section>`))?.[1];
  assert.ok(parte, `la página lleva su parte en ${idioma}`);
  return { parte, textos: [...parte.matchAll(/>([^<]+)</g)].map(([, texto]) => sinEntidades(texto)) };
}

test('cada estado del service worker lleva la clave de texto que le corresponde', () => {
  assert.deepEqual({ ...ESTADOS_DEL_SERVICIO }, CLAVES_ESPERADAS);
});

test('el texto de cada estado es el aprobado, en castellano y en catalán, y ninguno se repite', () => {
  for (const estado of ESTADOS) {
    for (const idioma of IDIOMAS) {
      assert.equal(DICCIONARIOS[idioma][CLAVES_ESPERADAS[estado]], TEXTOS_APROBADOS[estado][idioma], estado);
    }
  }
  const todos = ESTADOS.flatMap((estado) => IDIOMAS.map((idioma) => TEXTOS_APROBADOS[estado][idioma]));
  assert.equal(new Set(todos).size, todos.length, 'cada estado tiene su propio texto en cada idioma');
});

test('la página de cada estado muestra su texto en la sección de su idioma y ningún texto de otro estado', () => {
  const paginas = paginasDelServicio();
  for (const estado of ESTADOS) {
    const html = paginas[estado];
    assert.ok(html, `hay página para ${estado}`);
    for (const idioma of IDIOMAS) {
      const { parte, textos } = parteDe(html, idioma);
      const propio = TEXTOS_APROBADOS[estado][idioma];
      const otroIdioma = idioma === 'es' ? 'ca' : 'es';
      assert.ok(parte.includes(`<p>${escaparComoLaPagina(propio)}</p>`), `${estado}: su texto en ${idioma}`);
      assert.ok(
        !textos.includes(TEXTOS_APROBADOS[estado][otroIdioma]),
        `${estado}: en ${idioma}, nada del otro idioma`,
      );
    }
    const visibles = IDIOMAS.flatMap((idioma) => parteDe(html, idioma).textos);
    for (const otro of ESTADOS.filter((nombre) => nombre !== estado)) {
      for (const idioma of IDIOMAS) {
        assert.ok(!visibles.includes(TEXTOS_APROBADOS[otro][idioma]), `${estado} no muestra el texto de ${otro}`);
      }
    }
  }
});

test('sin-conexion.html lleva su entradilla aprobada, con su clave, entre el título y el enlace', () => {
  const html = readFileSync(new URL('../../web/sin-conexion.html', import.meta.url), 'utf8');
  const principal = html.match(/<main id="contenido" class="pagina"([\s\S]*?)<\/main/)?.[1];
  assert.ok(principal, 'la página lleva su contenido principal');
  const entradillas = [...principal.matchAll(/<p class="entradilla" data-texto="sin-conexion\.texto"\s*>([^<]*)<\/p/g)];
  assert.equal(entradillas.length, 1, 'una sola entradilla, con la clave sin-conexion.texto');
  const enLinea = (entradillas[0]?.[1] ?? '').replace(/\s+/g, ' ').trim();
  assert.equal(enLinea, ENTRADILLA_APROBADA.es, 'el texto en línea es el aprobado en castellano');
  for (const idioma of IDIOMAS) {
    assert.equal(DICCIONARIOS[idioma]['sin-conexion.texto'], ENTRADILLA_APROBADA[idioma], `entradilla en ${idioma}`);
  }
  const posiciones = ['sin-conexion.titulo-principal', 'sin-conexion.texto', 'sin-conexion.volver'].map((clave) =>
    principal.indexOf(`data-texto="${clave}"`),
  );
  assert.ok(
    posiciones.every((posicion) => posicion >= 0),
    'el título, la entradilla y el enlace están',
  );
  assert.deepEqual(
    posiciones,
    [...posiciones].sort((a, b) => a - b),
    'primero el título, después la entradilla y al final el enlace',
  );
});

const ICONO_VACIO = '<link rel="icon" href="data:,">';

/** Comprueba una página de estado: los dos idiomas con el texto de su estado, el enlace al inicio y nada externo. */
function comprobarPagina(html: string, csp: string | null, estado: EstadoDelServicio, inicio: string) {
  assert.match(html, /^<!doctype html><html lang="es">/);
  for (const idioma of IDIOMAS) {
    const { parte, textos } = parteDe(html, idioma);
    const esperados = [
      DICCIONARIOS[idioma]['sin-conexion.titulo-principal'],
      TEXTOS_APROBADOS[estado][idioma],
      DICCIONARIOS[idioma]['sin-conexion.volver'],
    ];
    assert.deepEqual(textos, esperados, `los textos en ${idioma} son los de su estado`);
    assert.ok(parte.includes(`href="${inicio}"`), 'el enlace lleva al inicio de este ámbito');
  }
  // El único enlace admitido es el icono vacío en línea, que evita que el navegador pida /favicon.ico.
  assert.equal(html.match(/<link/gi)?.length, 1, 'un solo <link>: el icono vacío');
  assert.ok(html.includes(ICONO_VACIO), 'el icono vacío en línea');
  const sinIcono = html.replace(ICONO_VACIO, '');
  assert.doesNotMatch(sinIcono, /<link|<script|<img|<iframe|\ssrc=|@import|url\(/i, 'sin recursos externos');
  const estilo = html.match(/<style>(.*?)<\/style>/)?.[1];
  assert.ok(estilo, 'el estilo mínimo va en línea');
  // Abren en claro como el resto del sitio, sea cual sea el tema del dispositivo.
  assert.match(estilo, /^:root\{color-scheme:light;background:#f4f3f0;/, 'la página de estado abre en modo día');
  assert.doesNotMatch(estilo, /prefers-color-scheme/, 'no sigue al tema del sistema');
  assert.equal(csp, CSP_DE_LAS_PAGINAS);
  assert.ok(
    csp.includes(`'sha256-${createHash('sha256').update(estilo).digest('base64')}'`),
    'la CSP admite solo ese estilo',
  );
  assert.ok(csp.startsWith("default-src 'none';"), 'la CSP no admite nada más');
  assert.deepEqual(
    csp.split('; ').filter((directiva) => directiva.startsWith('img-src')),
    ['img-src data:'],
    'imágenes: solo el icono vacío en línea',
  );
}

for (const base of BASES) {
  test(`sin red ni página de sin conexión que cuadre, la navegación recibe la página bilingüe: ${base}`, async () => {
    const sw = servicio(base, { cuerpoDe: (ruta) => ruta });
    sw.guardadas.set(
      sw.nombreCopia,
      new Map([
        [sw.urlDe('inicio.html'), new Response('INICIO', { headers: { 'x-faro-portal': 'publico' } })],
        [sw.urlDe('sin-conexion.html'), new Response('alterada')],
      ]),
    );
    const { estado, cabeceras, html } = await navegar(sw, 'no-existe.html');
    assert.equal(estado, NO_DISPONIBLE);
    assert.equal(cabeceras.get('content-type'), 'text/html; charset=utf-8');
    comprobarPagina(html, cabeceras.get('content-security-policy'), 'sin-conexion', sw.urlDe('inicio.html'));
  });

  const documento = (revision: number, biblioteca: boolean) =>
    Response.json({
      version: VERSION_SECCIONES_PUBLICAS,
      autoridad: '11111111-1111-4111-8111-111111111111',
      revision,
      secciones: { ...politicaSeccionesInicial(), biblioteca },
    });
  for (const [caso, antes, despues, cuerpo, estadoEsperado, clave] of [
    [
      'sin poder comprobar la política',
      true,
      () => new Response('fallo', { status: 500 }),
      'B',
      NO_DISPONIBLE,
      'no-comprobada',
    ],
    ['con la sección retirada', true, () => documento(1, false), 'B', RETIRADA, 'retirada'],
    // Con red: la página que llega es de otra publicación. No es «sin conexión».
    ['con su página de otra publicación', false, () => documento(1, true), 'OTRA', NO_DISPONIBLE, 'otra-version'],
  ] as const) {
    test(`una sección ${caso} recibe la página bilingüe de su estado: ${base}`, async () => {
      const sw = servicio(base, {
        politica: textoPoliticaCache(),
        archivos: ['inicio.html', 'sin-conexion.html', 'biblioteca.html'],
        paginasSecciones: [['biblioteca.html', createHash('sha256').update('B').digest('hex')]],
        cuerpoDe: () => 'B',
      });
      let politica: () => Response = () => documento(0, antes);
      let pagina = 'B';
      sw.conectar();
      sw.red.respuesta = (url) => {
        if (url === sw.urlDe('secciones-v3.json')) {
          return politica();
        }
        const portal = url === sw.urlDe('inicio.html') ? { 'x-faro-portal': 'publico' } : {};
        const bytes = url === sw.urlDe('biblioteca.html') ? pagina : 'B';
        return new Response(bytes, { headers: { 'content-type': 'text/html', ...portal } });
      };
      await sw.instalar();
      politica = despues;
      pagina = cuerpo;
      const { estado, cabeceras, html } = await navegar(sw, 'biblioteca.html');
      assert.equal(estado, estadoEsperado);
      comprobarPagina(html, cabeceras.get('content-security-policy'), clave, sw.urlDe('inicio.html'));
    });
  }
}

test('cada texto visible de las páginas de estado está en los dos diccionarios', () => {
  for (const clave of [...Object.values(ESTADOS_DEL_SERVICIO), ...CLAVES_COMUNES_DEL_SERVICIO]) {
    for (const idioma of ['es', 'ca'] as const) {
      assert.equal(typeof DICCIONARIOS[idioma][clave], 'string', `${clave} en ${idioma}`);
    }
  }
  for (const [clave, html] of Object.entries(paginasDelServicio())) {
    const titulo = sinEntidades(html.match(/<title>(.*?)<\/title>/)?.[1] ?? '');
    assert.equal(titulo, `${DICCIONARIOS.es['sin-conexion.titulo-principal']} · Faro`, `título de ${clave}`);
    const visibles = [...html.replace(/<(title|style)>.*?<\/\1>/g, '').matchAll(/>([^<]+)</g)].map(([, t]) =>
      sinEntidades(t),
    );
    const conocidos = new Set([...Object.values(DICCIONARIOS.es), ...Object.values(DICCIONARIOS.ca)]);
    assert.ok(visibles.length > 0 && visibles.every((t) => conocidos.has(t)), `textos de ${clave}: ${visibles}`);
  }
});

test('el service worker publicado lleva las páginas de estado de los diccionarios actuales', () => {
  const [base] = BASES;
  assert.ok(base);
  const sw = servicio(base);
  assert.deepEqual(JSON.parse(sw.evaluar('JSON.stringify(PAGINAS_DEL_SERVICIO)')), paginasDelServicio());
  assert.equal(sw.evaluar('CSP_DE_LAS_PAGINAS'), CSP_DE_LAS_PAGINAS);
});

test('las fuentes del service worker no escriben textos visibles: los toman de las páginas de estado', () => {
  const carpeta = new URL('../../src/service-worker/', import.meta.url);
  for (const archivo of readdirSync(carpeta).filter((nombre) => nombre.endsWith('.js'))) {
    const fuente = readFileSync(new URL(archivo, carpeta), 'utf8');
    assert.doesNotMatch(fuente, /<html|<h1|<main|text\/html[^']*'[^\n]*\n[^\n]*(Sección|conexión)/, archivo);
    for (const viejo of [
      'Sección no disponible',
      'Esta sección está desactivada.',
      'comprobar el acceso',
      "'No se puede comprobar la disponibilidad.",
      'actualiza Faro desde el inicio',
    ]) {
      assert.ok(!fuente.includes(viejo), `${archivo} no lleva «${viejo}»`);
    }
  }
});
