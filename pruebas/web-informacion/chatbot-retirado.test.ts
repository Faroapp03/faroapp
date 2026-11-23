/** La sección de consultas retirada no forma parte de la entrega; el recorrido y los canales de datos permanecen. */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { listaDelServicio } from '../../herramientas/web/copia-sin-conexion.ts';
import { SECCIONES_WEB } from '../../src/administracion/secciones-web.js';
import { EXTENSIONES } from '../../src/plataforma/extensiones.ts';
import { rutaFueraDeLaCopia } from '../../src/plataforma/politica-cache-web.ts';
import ca from '../../web/idiomas/ca.js';
import es from '../../web/idiomas/es.js';
import { webConstruida } from '../ayudas/web-construida.ts';

const WEB = new URL('../../web/', import.meta.url);
const leer = (ruta: string) => readFileSync(new URL(ruta, WEB), 'utf8');

test('la sección independiente no se publica ni se enlaza desde ninguna página', () => {
  assert.equal(existsSync(new URL('chatbot.html', WEB)), false);
  for (const pagina of readdirSync(WEB).filter((nombre) => nombre.endsWith('.html'))) {
    assert.doesNotMatch(leer(pagina), /href\s*=\s*["'][^"']*\bchatbot\.html(?:[?#][^"']*)?["']/i, pagina);
  }
  assert.ok(existsSync(new URL('recorrido.html', WEB)));
  assert.match(leer('inicio.html'), /href="recorrido\.html"/);
});

test('los idiomas retiran exclusivamente las claves de la sección independiente', () => {
  for (const diccionario of [es, ca]) {
    assert.equal(Object.hasOwn(diccionario, 'comun.seccion.chatbot'), false);
    assert.deepEqual(
      Object.keys(diccionario).filter((clave) => clave.startsWith('chatbot.')),
      [],
    );
    assert.ok(diccionario['comun.seccion.empezar']);
  }
});

test('la PWA guarda el recorrido real y exige conexión para autorizar cada variante', () => {
  const archivos = listaDelServicio('ARCHIVOS', webConstruida());
  assert.equal(archivos.includes('chatbot.html'), false);
  assert.ok(archivos.includes('inicio.html'), 'La portada común permanece disponible en la copia');
  assert.ok(
    archivos.includes('recorrido.html'),
    'El recorrido real se guarda para abrirlo sin red en una instalación pública',
  );
  for (const ruta of [...EXTENSIONES.map(({ entrada }) => entrada), 'modo-recorrido.json']) {
    assert.equal(archivos.includes(ruta), false, `${ruta} no se precarga`);
    assert.equal(rutaFueraDeLaCopia(ruta), true, `${ruta} requiere consultar al servidor`);
  }
  for (const nombre of ['manifest.webmanifest', 'manifest-ca.webmanifest']) {
    const manifiesto = JSON.parse(leer(nombre)) as { shortcuts: { url: string }[] };
    assert.deepEqual(
      manifiesto.shortcuts.map(({ url }) => url),
      ['./recorrido.html'],
    );
  }
});

test('el panel conserva recorrido y conectividad sin una sección independiente de chatbot', () => {
  assert.equal(
    SECCIONES_WEB.some(({ rutas }) => rutas.includes('/chatbot.html')),
    false,
  );
  assert.ok(SECCIONES_WEB.some(({ id, rutas }) => id === 'recorrido' && rutas.includes('/recorrido.html')));
  const panel = leer('administracion/index.html');
  assert.doesNotMatch(panel, /chatbot|xatbot/i);
  for (const id of ['api', 'mcp', 'a2a', 'seccion-recorrido']) {
    assert.match(panel, new RegExp(`id="${id}"`));
  }
});
