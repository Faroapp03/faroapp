// Relaciones de recursos de las dos páginas admitidas; no exige que las páginas enlazadas ya estén incorporadas.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { aperturas, etiquetasDe, sinComentariosHtml } from '../../herramientas/web/etiquetas.ts';
import { referenciasCss, rutasDeSrcset } from '../../herramientas/web/referencias.ts';
import { esObjeto } from '../../src/comun/json.ts';

const WEB = new URL('../../web/', import.meta.url);
const PAGINAS = ['inicio.html', 'sin-conexion.html'];
function leer(ruta: string): string {
  return readFileSync(new URL(ruta, WEB), 'utf8');
}
function jsonDe(ruta: string): Record<string, unknown> {
  const valor: unknown = JSON.parse(leer(ruta));
  assert.ok(esObjeto(valor), ruta);
  return valor;
}
function listaDe(registro: Record<string, unknown>, campo: string): unknown[] {
  const valor = registro[campo];
  assert.ok(Array.isArray(valor), campo);
  return valor;
}
function etiquetas(pagina: string) {
  return aperturas(etiquetasDe(sinComentariosHtml(leer(pagina))));
}
function hojasDe(pagina: string): Set<string> {
  const pendientes = etiquetas(pagina)
    .filter(({ nombre, atributos }) => nombre === 'link' && atributos.get('rel') === 'stylesheet')
    .map(({ atributos }) => atributos.get('href') ?? '');
  const hojas = new Set<string>();
  for (let hoja = pendientes.pop(); hoja; hoja = pendientes.pop()) {
    if (hojas.has(hoja)) {
      continue;
    }
    hojas.add(hoja);
    const base = new URL(hoja, WEB);
    for (const referencia of referenciasCss(leer(hoja))) {
      const destino = new URL(referencia, base);
      assert.equal(destino.protocol, 'file:', referencia);
      assert.ok(existsSync(destino), destino.href);
      if (destino.pathname.endsWith('.css')) {
        pendientes.push(destino.href.slice(WEB.href.length));
      }
    }
  }
  return hojas;
}

test('imágenes, guiones y enlaces de recurso de ambas páginas existen en la entrega', () => {
  for (const pagina of PAGINAS) {
    for (const { nombre, atributos } of etiquetas(pagina)) {
      const referencias = [atributos.get('src'), ...rutasDeSrcset(atributos.get('srcset') ?? '')];
      if (nombre === 'link') {
        referencias.push(atributos.get('href'));
      }
      for (const referencia of referencias.filter((ruta) => ruta)) {
        assert.ok(referencia);
        assert.ok(existsSync(new URL(referencia, WEB)), `${pagina}: ${referencia}`);
      }
    }
  }
});

test('el cierre de hojas conserva base común, contenidos y componentes de portada', () => {
  const portada = hojasDe('inicio.html');
  const sinConexion = hojasDe('sin-conexion.html');
  assert.ok(portada.has('estilos/portada-apertura.css'));
  assert.ok(portada.has('estilos/portada-adaptaciones.css'));
  assert.ok(sinConexion.has('estilos/contenidos.css'));
  assert.ok(!sinConexion.has('estilos/portada.css'));
  for (const hoja of [
    'tipografias',
    'tokens',
    'base-documento',
    'base-cabecera',
    'base-menu-e-instalacion',
    'base-navegacion-y-pie',
    'base-adaptaciones',
  ]) {
    assert.ok(portada.has(`estilos/${hoja}.css`), hoja);
    assert.ok(sinConexion.has(`estilos/${hoja}.css`), hoja);
  }
});

test('las fuentes servidas son WOFF2 completos y se distribuyen con su licencia OFL', () => {
  const OFFSET_LONGITUD_WOFF2 = 8;
  const LONGITUD_FIRMA = 4;
  const licencias = ['LICENSE-jetbrainsmono.txt', 'LICENSE-sora.txt', 'LICENSE-spacegrotesk.txt'];
  const fuentes = referenciasCss(leer('estilos/tipografias.css'));
  assert.equal(fuentes.length, licencias.length);
  for (const ruta of fuentes) {
    const bytes = readFileSync(new URL(ruta, new URL('estilos/tipografias.css', WEB)));
    assert.equal(bytes.toString('ascii', 0, LONGITUD_FIRMA), 'wOF2');
    assert.equal(bytes.readUInt32BE(OFFSET_LONGITUD_WOFF2), bytes.length);
  }
  for (const licencia of licencias) {
    assert.ok(leer(`tipografias/${licencia}`).includes('SIL OPEN FONT LICENSE Version 1.1'));
  }
});

test('los manifiestos ES/CA identifican la misma aplicación, inicio y ámbito', () => {
  const es = jsonDe('manifest.webmanifest');
  const ca = jsonDe('manifest-ca.webmanifest');
  assert.equal(es.lang, 'es');
  assert.equal(ca.lang, 'ca');
  for (const campo of ['id', 'scope', 'start_url', 'display', 'background_color', 'theme_color']) {
    assert.equal(es[campo], ca[campo], campo);
  }
  // La aplicación instalada arranca en el fondo del modo día de tokens.css, el tema con el que abre Faro.
  const fondoDeDia = /--color-fondo: light-dark\((#[0-9a-f]+), #[0-9a-f]+\);/u.exec(leer('estilos/tokens.css'))?.[1];
  assert.ok(fondoDeDia);
  assert.equal(es.background_color, fondoDeDia);
  assert.equal(es.theme_color, fondoDeDia);
  assert.equal(es.id, './');
  assert.equal(es.scope, './');
  assert.equal(es.start_url, './inicio.html');
  assert.ok(typeof es.start_url === 'string');
  assert.ok(existsSync(new URL(es.start_url, WEB)));
  assert.deepEqual(Object.keys(es).sort(), Object.keys(ca).sort());
  assert.deepEqual(es.icons, ca.icons);
  assert.notEqual(es.name, ca.name);
  assert.notEqual(es.description, ca.description);
  const [atajoEs] = listaDe(es, 'shortcuts');
  const [atajoCa] = listaDe(ca, 'shortcuts');
  assert.ok(esObjeto(atajoEs) && esObjeto(atajoCa));
  assert.equal(atajoEs.url, './recorrido.html');
  assert.equal(atajoCa.url, atajoEs.url);
});

test('los iconos de instalación tienen el tamaño PNG que anuncian los manifiestos', () => {
  const OFFSET_ANCHURA_PNG = 16;
  const OFFSET_ALTURA_PNG = 20;
  const manifiesto = jsonDe('manifest.webmanifest');
  for (const icono of listaDe(manifiesto, 'icons')) {
    assert.ok(esObjeto(icono) && typeof icono.src === 'string');
    const bytes = readFileSync(new URL(icono.src, WEB));
    const ancho = bytes.readUInt32BE(OFFSET_ANCHURA_PNG);
    const alto = bytes.readUInt32BE(OFFSET_ALTURA_PNG);
    assert.equal(`${ancho}x${alto}`, icono.sizes);
    assert.equal(icono.type, 'image/png');
  }
});
