import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { EstadoClientePanel } from '../../web/administracion/cliente.js';
import { mostrarEstadoDatos } from '../../web/administracion/vista-datos.js';
import ca from '../../web/idiomas/ca.js';
import es from '../../web/idiomas/es.js';
import { CONSULTA_SALUD, CORTE_SALUD, instantaneaSalud } from '../ayudas/salud-datos.ts';
import { html, instalar, nodo } from '../web-informe-lectura/dom-doble.ts';
import { activarIdiomaPanel } from './idiomas.ts';
import { prepararPanel } from './panel-dom.ts';

const INICIO = 1_000_000,
  INACTIVIDAD = 900_000,
  ABSOLUTA = 28_800_000;
function estado(): EstadoClientePanel {
  return {
    estado: 'activa',
    ocupado: false,
    conflicto: false,
    aviso: null,
    datos: null,
    trabajos: null,
    activacion: null,
    controles: { version: 2, revision: 0, api: 'deshabilitada', mcp: false, a2a: false },
    sesion: {
      estado: 'activa',
      iniciadaEn: INICIO,
      ultimaActividadEn: INICIO,
      caducaPorInactividadEn: INICIO + INACTIVIDAD,
      caducaAbsolutaEn: INICIO + ABSOLUTA,
    },
  };
}

test('el panel cambia los rótulos y la expulsión ES/CA sin enviar operaciones ni perder el borrador', async (t) => {
  const p = await prepararPanel(t);
  t.after(() => activarIdiomaPanel());
  p.publicar(estado());
  p.campo('mcp').checked = true;
  p.campo('mcp').dispatchEvent(new Event('change'));
  p.cambiarIdioma('ca');
  assert.equal(p.campo('revision').textContent, 'Configuració confirmada pel servidor.');
  assert.equal(p.campo('mcp').checked, true);
  assert.deepEqual(p.llamadas, []);
  p.publicar({ estado: 'sustituida', aviso: 'sesion_sustituida' });
  assert.equal(p.campo('estado').textContent, ca['panel.aviso.sesion_sustituida']);
  p.cambiarIdioma('es');
  assert.equal(p.campo('estado').textContent, es['panel.aviso.sesion_sustituida']);
  assert.equal(p.campo('controles').hidden, true);
  assert.deepEqual(p.llamadas, []);
});

test('la vista de salud CA conserva los datos y las fechas, y los presenta sin confundir consulta con entrega', (t) => {
  instalar(t);
  t.after(() => activarIdiomaPanel());
  activarIdiomaPanel('ca');
  const entrada = instantaneaSalud();
  const antes = JSON.stringify(entrada);
  const destino = nodo('div');
  mostrarEstadoDatos(html(destino), entrada);
  assert.match(destino.textContent, /Comprovació de les fonts/);
  assert.match(destino.textContent, /● Comprovada/);
  assert.match(destino.textContent, /la versió publicada es comproven a part/);
  // El detalle técnico conserva cada registro tal como llega, en UTC.
  assert.ok(destino.textContent.includes(CONSULTA_SALUD));
  assert.ok(destino.textContent.includes(CORTE_SALUD));
  assert.ok(
    destino.textContent.includes('Empresas y uso de IA'),
    'el nombre procedente del catálogo no se inventa ni traduce por coincidencia',
  );
  assert.equal(JSON.stringify(entrada), antes);
});

test('los rótulos HTML del panel tienen ambas lenguas y no queda una paleta independiente', () => {
  const fuente = readFileSync(new URL('../../web/administracion/index.html', import.meta.url), 'utf8');
  for (const [, clave = ''] of fuente.matchAll(/data-texto(?:-[a-z-]+)?="([^"]+)"/gu)) {
    assert.ok(es[clave] && ca[clave], clave);
  }
  assert.match(fuente, /estilos\/tokens\.css/u);
  assert.match(fuente, /data-selector-idioma/u);
  assert.match(fuente, /class="pie"/u);
  const estilos = readFileSync(new URL('../../web/administracion/panel.css', import.meta.url), 'utf8');
  assert.doesNotMatch(estilos, /#[0-9a-f]{3,8}\b/iu);
});

test('las secciones del panel nombran las páginas vigentes en ES/CA, sin anunciar los reenvíos retirados', () => {
  assert.equal(es['panel.seccion.faro'], 'Qué es Faro');
  assert.equal(ca['panel.seccion.faro'], 'Què és Faro');
  assert.equal(es['panel.seccion.biblioteca'], 'Biblioteca');
  assert.equal(ca['panel.seccion.biblioteca'], 'Biblioteca');
  const fuente = readFileSync(new URL('../../web/administracion/index.html', import.meta.url), 'utf8');
  assert.match(fuente, /<span data-texto="panel.seccion.faro">Qué es Faro<\/span>/u);
  assert.match(fuente, /<span data-texto="panel.seccion.biblioteca">Biblioteca<\/span>/u);
});

test('ningún texto del panel nombra variables técnicas del servicio ni claves internas', () => {
  const tecnico = /FARO_[A-Z_]+|pausaHasta/u;
  for (const [idioma, textos] of [
    ['es', es],
    ['ca', ca],
  ] as const) {
    for (const [clave, texto] of Object.entries(textos)) {
      if (clave.startsWith('panel.')) {
        assert.doesNotMatch(texto, tecnico, `${idioma} · ${clave}`);
      }
    }
  }
});
