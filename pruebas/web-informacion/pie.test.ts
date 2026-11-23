// El pie de todas las páginas: los enlaces de información y ayuda (con Comprobar Faro e Instalar Faro junto a Créditos) y,
// debajo, el aviso de autoría «© 2026 Equipo Faro» en ES y «© 2026 Equip Faro» en CA. Sin el lema ni
// la frase «¿Algo no funciona?»; «Instalar Faro» llegó al pie cuando salió de la
// portada.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import ca from '../../web/idiomas/ca.js';
import es from '../../web/idiomas/es.js';
import { conRutasRelativas } from '../ayudas/paginas-con-rutas-absolutas.ts';

const WEB = new URL('../../web/', import.meta.url);
const leer = (archivo: string) => conRutasRelativas(archivo, readFileSync(new URL(archivo, WEB), 'utf8'));
/** acceso-api.html tiene su propio pie, sin la navegación del sitio. */
const PAGINAS = readdirSync(WEB).filter((archivo) => archivo.endsWith('.html') && archivo !== 'acceso-api.html');
/** Páginas que deben conservar el pie del sitio. */
const PAGINAS_CON_PIE = 18;
const ENLACES = [
  'creditos.html',
  'informacion-y-creditos.html#t-datos',
  'accesibilidad.html',
  'verificable.html',
  'doctor.html',
  'instalar.html',
];

test('cada página lleva el mismo pie: los seis enlaces en orden y el aviso de derechos debajo', () => {
  assert.ok(PAGINAS.length >= PAGINAS_CON_PIE, `${PAGINAS.length} páginas`);
  for (const pagina of PAGINAS) {
    const apertura = pagina === 'recorrido.html' ? /<footer class="pie" inert>/ : /<footer class="pie">/;
    const pie = new RegExp(`${apertura.source}[\\s\\S]*?<\\/footer>`).exec(leer(pagina))?.[0] ?? '';
    assert.ok(pie, `${pagina}: sin pie`);
    const nav = /<nav [^>]*data-texto-aria-label="comun\.pie\.nombre"[^>]*>([\s\S]*?)<\/nav/.exec(pie)?.[1] ?? '';
    const destinos = [...nav.matchAll(/<a [^>]*href="([^"]+)"/g)].map(([, href]) => href);
    assert.deepEqual(destinos, ENLACES, pagina);
    assert.match(
      nav,
      /<a class="pie-doctor" href="doctor\.html"/,
      `${pagina}: Comprobar Faro va entre los enlaces del pie`,
    );
    assert.match(nav, /<a class="pie-instalar" href="instalar\.html"/, `${pagina}: Instalar Faro va en el pie`);
    assert.match(
      pie,
      /<\/nav\s*><p class="pie-derechos" data-texto="comun\.pie\.derechos">© 2026 Equipo Faro<\/p>/,
      pagina,
    );
    assert.doesNotMatch(pie, /comun\.pie\.lema|¿Algo no funciona\?/, pagina);
    const actuales = [...pie.matchAll(/href="([^"]+)" aria-current="page"/g)].map(([, href]) => href);
    const esperado = ['doctor.html', 'instalar.html'].includes(pagina) ? [pagina] : [];
    assert.deepEqual(actuales, esperado, `${pagina}: aria-current solo en su propio enlace`);
  }
});

test('los textos del pie existen en los dos idiomas y no hay clave de lema', () => {
  for (const diccionario of [es, ca]) {
    assert.equal(diccionario['comun.pie.derechos'], diccionario === es ? '© 2026 Equipo Faro' : '© 2026 Equip Faro');
    assert.equal(diccionario['comun.pie.doctor'], diccionario === es ? 'Comprobar Faro' : 'Comprovar Faro');
    assert.ok(diccionario['comun.pie.instalar']);
    assert.ok(diccionario['comun.pie.nombre']);
    assert.ok(!Object.hasOwn(diccionario, 'comun.pie.lema'));
  }
});
