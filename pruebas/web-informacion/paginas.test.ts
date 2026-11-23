import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { aperturas, etiquetasDe, sinComentariosHtml } from '../../herramientas/web/etiquetas.ts';
import { comprobarPagina } from '../../herramientas/web/paginas.ts';
import { referenciasCss, rutasDeSrcset } from '../../herramientas/web/referencias.ts';
import ca from '../../web/idiomas/ca.js';
import es from '../../web/idiomas/es.js';

const WEB = new URL('../../web/', import.meta.url);
const PAGINAS = ['entender-ia.html', 'que-es-faro.html', 'accesibilidad.html', 'biblioteca.html', 'instalar.html'];

function etiquetas(pagina: string) {
  return aperturas(etiquetasDe(sinComentariosHtml(readFileSync(new URL(pagina, WEB), 'utf8'))));
}

function recurso(ruta: string, base: URL, consumidor: string) {
  const destino = new URL(ruta, base);
  assert.ok(destino.href.startsWith(WEB.href), `${consumidor}: ${ruta}`);
  assert.ok(existsSync(destino), `${consumidor}: ${ruta}`);
  return destino;
}

function recursosDePagina(pagina: string, hojas: Set<string>) {
  for (const { nombre, atributos } of etiquetas(pagina)) {
    const rutas = [atributos.get('src'), ...rutasDeSrcset(atributos.get('srcset') ?? '')];
    if (nombre === 'link') {
      rutas.push(atributos.get('href'));
      if (atributos.get('rel') === 'stylesheet') {
        hojas.add(atributos.get('href') ?? '');
      }
    }
    for (const ruta of rutas.filter((ruta): ruta is string => Boolean(ruta))) {
      recurso(ruta, WEB, pagina);
    }
  }
}

function comprobarClave(clave: string, pagina: string) {
  assert.ok(Object.hasOwn(es, clave), `${pagina}: ES ${clave}`);
  assert.ok(Object.hasOwn(ca, clave), `${pagina}: CA ${clave}`);
  assert.ok(es[clave]?.trim() && ca[clave]?.trim(), clave);
  const marcas = (texto: string) => [...texto.matchAll(/\{\w+\}/g)].map(([marca]) => marca).sort();
  assert.deepEqual(marcas(es[clave] ?? ''), marcas(ca[clave] ?? ''), clave);
}

test('las páginas tienen estructura básica e identificadores accesibles coherentes', () => {
  for (const pagina of PAGINAS) {
    const html = sinComentariosHtml(readFileSync(new URL(pagina, WEB), 'utf8'));
    assert.deepEqual(comprobarPagina(pagina, html), []);
  }
});

test('cada recurso cargado por las páginas y sus hojas existe bajo la entrega', () => {
  const hojas = new Set<string>();
  for (const pagina of PAGINAS) {
    recursosDePagina(pagina, hojas);
  }
  for (const hoja of hojas) {
    const url = new URL(hoja, WEB);
    for (const ruta of referenciasCss(readFileSync(url, 'utf8'))) {
      const destino = recurso(ruta, url, hoja);
      if (destino.pathname.endsWith('.css')) {
        hojas.add(destino.href.slice(WEB.href.length));
      }
    }
  }
});

test('cada texto y atributo traducible tiene clave ES/CA y sus marcadores coinciden', () => {
  for (const pagina of PAGINAS) {
    for (const { atributos } of etiquetas(pagina)) {
      for (const [atributo, clave] of atributos) {
        if ((atributo === 'data-texto' || atributo.startsWith('data-texto-')) && clave) {
          comprobarClave(clave, pagina);
        }
      }
    }
  }
});
