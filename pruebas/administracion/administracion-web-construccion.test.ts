// La pantalla privada se comprueba en la construcción sin incorporarse al catálogo ni a la copia pública.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { sinComentariosJs } from '../../herramientas/web/comentarios-js.ts';
import { artefactosComunes } from '../../herramientas/web/comunes.ts';
import { comprobarCspHtml, comprobarCspScript, scriptsRevisados } from '../../herramientas/web/csp.ts';
import { huellaSri, mapaEsperado, textoDelMapa } from '../../herramientas/web/integridad.ts';
import { comprobarPagina } from '../../herramientas/web/paginas.ts';
import { referenciasJs } from '../../herramientas/web/referencias.ts';
import { RUTAS } from '../../src/plataforma/node/rutas.ts';
import { rutaFueraDeLaCopia } from '../../src/plataforma/politica-cache-web.ts';
import { conGrafoDeFuentes } from '../ayudas/grafo-de-fuentes.ts';
import { webConstruida } from '../ayudas/web-construida.ts';

const CARPETA = new URL('../../web/administracion/', import.meta.url);
// El contrato de secciones conserva su publicación canónica; la interfaz comparte idioma, tema y validadores públicos.
const CONTRATO_PUBLICO = '../scripts/secciones-contrato.js';
const PUBLICOS = [
  '../scripts/conectividad/invitacion.js',
  '../scripts/contacto-publico.js',
  '../scripts/contacto.js',
  '../scripts/dom.js',
  '../scripts/cifras.js',
  '../scripts/etapas.js',
  '../scripts/fechas.js',
  '../scripts/idioma.js',
  '../scripts/secciones-contrato.js',
  '../scripts/selector-idioma.js',
  '../scripts/tema.js',
  '../scripts/textos.js',
  '../scripts/variantes-disponibles.js',
];
const MODULOS = [
  'panel.js',
  'apartado-encuesta.js',
  'cliente-administradores.js',
  'secciones-del-panel.js',
  'vista-administradores.js',
  'vista-encuesta-resultados.js',
  'vista-encuesta-rondas.js',
  'vista-encuesta-visibilidad.js',
  'clasificacion-catalogo.js',
  'vista-clasificacion.js',
  'presentacion-accesos.js',
  'tarjetas-instituciones.js',
  'textos-accesos-humanos.js',
  'cliente.js',
  'contratos.js',
  'contrato-comun.js',
  'accesos-contrato.js',
  'avisos-panel.js',
  'cliente-cierre.js',
  'cliente-vigilante.js',
  'capacidades.js',
  'limites-respuesta.js',
  'vigilante-panel.js',
  'vista-vigilante.js',
  'catalogo-privado.js',
  'ocultas-contrato.js',
  'instituciones-contrato.js',
  'sitio.js',
  'vista-accesos.js',
  'vista-instituciones.js',
  'vista-ocultas.js',
  'estado-datos.js',
  'lectura-administradores.js',
  'lectura-estricta.js',
  'edicion-nueva-datos.js',
  'salud-datos.js',
  'estado-trabajos.js',
  'estado-visible-panel.js',
  'seguimiento-panel.js',
  'estado-activacion.js',
  'vista-datos.js',
  'retenidos-datos.js',
  'retirada-datos.js',
  'vista-retenidos.js',
  'vista-fuentes.js',
  'avisos-datos.js',
  'vista-trabajos.js',
  'vista-activacion.js',
  'vista-cierre.js',
  'servicio-panel.js',
  'revisiones-panel.js',
  'fechas-panel.js',
  'confirmacion-cambios.js',
  'cliente-encuesta.js',
  'cliente-avisos.js',
  'vista-avisos.js',
  'archivos-piloto.js',
  'vista-encuesta.js',
  'retraduccion-panel.js',
  'gestos-panel.js',
  'deshacer-cambio.js',
  'actividad-panel.js',
  'vista-sesion-unica.js',
  'estados-http-panel.js',
  'cliente-sesion-unica.js',
  'contrato-sesion-unica.js',
  'sesion-panel.js',
  'armazon-panel.js',
  'inicio-datos.js',
  'vista-inicio.js',
  'estado-visual.js',
  'iconos-panel.js',
  'navegacion-panel.js',
  'buscador-panel.js',
];
const leer = (nombre: string) => readFileSync(new URL(nombre, CARPETA), 'utf8');

test('el panel conserva estructura accesible, CSP sin código en línea y SRI del punto de entrada', () => {
  const html = leer('index.html');
  assert.deepEqual(comprobarPagina('administracion/index.html', html), []);
  assert.deepEqual(comprobarCspHtml('administracion/index.html', html), []);
  assert.equal(textoDelMapa(html), null);
  assert.ok(!html.includes('integrity='), 'la fuente no lleva SRI: la construcción lo inyecta');
  assert.doesNotMatch(html, /\bon\w+=|\bstyle=|<script(?![^>]*\bsrc=)/);
  const web = webConstruida();
  const servida = readFileSync(join(web, 'administracion/index.html'), 'utf8');
  const entrada = /<script type="module" src="\/([^"]+)" integrity="([^"]+)"/.exec(servida);
  assert.ok(entrada?.[1] && entrada[2], 'el panel construido carga su entrada con SRI');
  assert.equal(entrada[2], huellaSri(readFileSync(join(web, entrada[1]))));
  assert.equal(textoDelMapa(servida), null);
});

test('el panel declara el icono público local sin crear otro recurso privado', () => {
  assert.match(
    leer('index.html'),
    /<link rel="icon" type="image\/svg\+xml" href="\/imagenes\/identidad\/faro-editorial-icon\.svg" \/>/,
  );
  assert.match(leer('../imagenes/identidad/faro-editorial-icon.svg'), /<svg\b/);
});

test('el grafo privado completo solo importa archivos bajo Access o piezas públicas comunes explícitas', () => {
  assert.deepEqual(
    [...MODULOS].sort(),
    readdirSync(CARPETA)
      .filter((nombre) => nombre.endsWith('.js'))
      .sort(),
  );
  for (const nombre of MODULOS) {
    const ruta = `administracion/${nombre}`;
    assert.deepEqual(scriptsRevisados([ruta]), [ruta]);
    assert.deepEqual(comprobarCspScript(ruta, leer(nombre)), []);
    const importaciones = referenciasJs(leer(nombre));
    if (['panel.js', 'cliente.js', 'contratos.js'].includes(nombre)) {
      assert.ok(importaciones.length > 0, `Se comprueba el grafo de ${nombre}`);
    }
    for (const dependencia of importaciones) {
      assert.ok(
        PUBLICOS.includes(dependencia) || MODULOS.some((permitida) => dependencia === `./${permitida}`),
        dependencia,
      );
    }
  }
});

test('las opciones públicas de variantes no importan el panel ni otras dependencias', () => {
  const publicado = leer('../scripts/variantes-disponibles.js');
  assert.deepEqual(referenciasJs(publicado), []);
  assert.doesNotMatch(sinComentariosJs(publicado), /\bimport\s*\(/);
  assert.deepEqual(comprobarCspScript('scripts/variantes-disponibles.js', publicado), []);
  assert.equal(rutaFueraDeLaCopia('scripts/variantes-disponibles.js'), false);
});

test('el contrato público de secciones conserva bytes canónicos y no importa otras dependencias', () => {
  const ruta = new URL(CONTRATO_PUBLICO, CARPETA);
  const esperado = [...artefactosComunes()].find(([archivo]) => archivo.href === ruta.href)?.[1];
  assert.ok(esperado, 'El contrato tiene una fuente única declarada en publicaciones comunes');
  const publicado = readFileSync(ruta, 'utf8');
  assert.equal(publicado, esperado);
  assert.deepEqual(referenciasJs(publicado), []);
  assert.doesNotMatch(sinComentariosJs(publicado), /\bimport\s*\(/, 'No admite tampoco imports dinámicos calculados');
  assert.deepEqual(comprobarCspScript('scripts/secciones-contrato.js', publicado), []);
  assert.equal(rutaFueraDeLaCopia('scripts/secciones-contrato.js'), false);
});

test('HTML, recursos y operaciones privados quedan fuera del mapa de módulos y de la caché PWA', () => {
  const rutas = [
    'administracion',
    'administracion/',
    'administracion/index.html',
    'administracion/api/sesion/abrir',
    'administracion/panel.css',
    'administracion/panel-estructura.css',
    ...MODULOS.map((nombre) => `administracion/${nombre}`),
  ];
  const contexto = conGrafoDeFuentes({ web: RUTAS.web, paquete: RUTAS.paquete, motor: new Map<string, Uint8Array>() });
  assert.deepEqual(mapaEsperado(rutas, {}, contexto), {});
  for (const ruta of rutas) {
    assert.equal(rutaFueraDeLaCopia(ruta), true, ruta);
  }
});
