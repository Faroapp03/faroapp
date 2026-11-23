import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import { test } from 'node:test';
import { listaDelServicio, listasDeLaCopia } from '../../herramientas/web/copia-sin-conexion.ts';
import { archivosPublicados, leer } from '../../herramientas/web/publicados.ts';
import { dependenciasEjecutablesJs, referenciasJs, resolver } from '../../herramientas/web/referencias.ts';
import { analizarEjecutablesDelModulo } from '../../herramientas/web/referencias-js-recursos.ts';
import { EXTENSIONES } from '../../src/plataforma/extensiones.ts';
import { rutaFueraDeLaCopia } from '../../src/plataforma/politica-cache-web.ts';
import { webConstruida } from '../ayudas/web-construida.ts';

const PUBLICOS = [
  'inicio.html',
  'sin-conexion.html',
  'scripts/json.js',
  '.well-known/security.txt',
  'conectividad.html',
  'scripts/conectividad.js',
  'scripts/conectividad-etapa.js',
  'scripts/conectividad/estado.js',
  'scripts/conectividad/cuerpo.js',
  'estilos/conectividad.css',
];
const OPERATIVOS = [
  'openapi.json',
  'llms.txt',
  'activar-acceso.html',
  'scripts/activar-acceso.js',
  'scripts/activar-acceso/cliente.js',
  'estilos/activar-acceso.css',
  'scripts/conectividad/invitacion.js',
  'scripts/conectividad/fragmento.js',
  'api/conectividad/estado',
  'scripts/activar-acceso.js',
  'estilos/activar-acceso.css',
  'api',
  'api/salud',
  'administracion.html',
  'administracion/panel.html',
  'scripts/administracion/cliente.js',
  'estilos/administracion.css',
  'mcp',
  'a2a',
  'oauth/token',
  'configuracion.json',
  '.well-known/api-catalog',
  'avisos-del-navegador',
  '%61pi/salud',
];

test('los recursos operativos publicados se sirven pero no entran en ningún catálogo de caché', () => {
  const listas = listasDeLaCopia([...PUBLICOS, ...OPERATIVOS]);
  const todos = [...listas.archivos, ...listas.bajoDemanda, ...listas.comprobados];
  assert.deepEqual(
    todos.filter((archivo) => OPERATIVOS.includes(archivo)),
    [],
  );
  assert.deepEqual([...todos].sort(), [...PUBLICOS].sort());
});

test('la página de una dirección que no existe se publica pero no entra en ninguna lista de la copia', () => {
  const listas = listasDeLaCopia(['inicio.html', 'no-existe.html', 'sin-conexion.html']);
  assert.deepEqual(listas, { archivos: ['inicio.html', 'sin-conexion.html'], bajoDemanda: [], comprobados: [] });
  const publicados = archivosPublicados();
  assert.ok(publicados.includes('no-existe.html'));
  const deVerdad = listasDeLaCopia(publicados);
  assert.ok(![...deVerdad.archivos, ...deVerdad.bajoDemanda, ...deVerdad.comprobados].includes('no-existe.html'));
});

test('conserva familias públicas, fotos bajo demanda y publicaciones compartidas protegidas', () => {
  const entrada = [
    'inicio.html',
    'imagenes/fotografias/casa.webp',
    'imagenes/fotografias/casa-800.webp',
    'scripts/tiempo.js',
    'scripts/json.js',
    'scripts/firmas/firmas.js',
    'openapi.json',
    'service-worker.js',
  ];
  assert.deepEqual(listasDeLaCopia(entrada), {
    archivos: ['imagenes/fotografias/casa-800.webp', 'inicio.html'],
    bajoDemanda: ['imagenes/fotografias/casa.webp'],
    comprobados: ['scripts/firmas/firmas.js', 'scripts/json.js', 'scripts/tiempo.js'],
  });
});

test('con lo publicado de verdad, BAJO_DEMANDA solo lleva fotografías grandes y ningún JavaScript', () => {
  const fotografiaGrande = /^imagenes\/fotografias\/.+(?<!-800)\.webp$/;
  const calculada = listasDeLaCopia(archivosPublicados()).bajoDemanda;
  const generada = listaDelServicio('BAJO_DEMANDA', webConstruida());
  assert.ok(calculada.length > 0);
  assert.deepEqual(generada, calculada, 'el catálogo generado es el que sale de lo publicado (npm run web:preparar)');
  for (const lista of [calculada, generada]) {
    assert.deepEqual(
      lista.filter((ruta) => ruta.endsWith('.js')),
      [],
    );
    assert.deepEqual(
      lista.filter((ruta) => !fotografiaGrande.test(ruta)),
      [],
    );
  }
});

test('los guiones de la copia pública no importan dependencias excluidas de ella', () => {
  const guiones = archivosPublicados().filter((ruta) => ruta.endsWith('.js') && !rutaFueraDeLaCopia(ruta));
  for (const guion of guiones) {
    for (const referencia of dependenciasEjecutablesJs(leer(guion))) {
      if (referencia.startsWith('.') || referencia.startsWith('/')) {
        const dependencia = resolver(guion, referencia);
        assert.equal(rutaFueraDeLaCopia(dependencia), false, `${guion} depende de ${dependencia}`);
      }
    }
  }
});

test('un enlace fuera de la copia no es una dependencia ejecutable, pero importar esa ruta sí lo es', () => {
  const destino = '../modo-recorrido.json';
  const enlace = `const panel = new URL('${destino}', import.meta.url); enlace.href = panel.href;`;
  assert.deepEqual(dependenciasEjecutablesJs(enlace), []);
  assert.ok(referenciasJs(enlace).includes(destino));
  for (const codigo of [
    `import '${destino}';`,
    `void import('${destino}');`,
    `new Worker(new URL('${destino}', import.meta.url));`,
  ]) {
    assert.ok(dependenciasEjecutablesJs(codigo).includes(destino));
    assert.equal(rutaFueraDeLaCopia(resolver('scripts/ejemplo.js', destino)), true);
  }
});

test('resuelve dependencias de ejecución declaradas en constantes sin incluir enlaces', () => {
  // Fuera de la copia: el modo del recorrido y cualquier archivo de la carpeta de una extensión instalada.
  const deExtensiones = EXTENSIONES.map(({ entrada }) => `../${dirname(entrada)}/scripts/oculto.js`);
  for (const destino of ['../modo-recorrido.json', ...deExtensiones]) {
    for (const codigo of [
      `const ruta = new URL('${destino}', import.meta.url).href; import(ruta);`,
      `const ruta = new URL('${destino}', import.meta.url); new Worker(urlDeGuion(ruta));`,
      `const ruta = '${destino}'; import(ruta);`,
      `const ruta = new URL('${destino}', import.meta.url); new Worker(ruta);`,
    ]) {
      assert.ok(dependenciasEjecutablesJs(codigo).includes(destino), codigo);
      assert.equal(rutaFueraDeLaCopia(resolver('scripts/ejemplo.js', destino)), true);
    }
    const enlace = `const ruta = new URL('${destino}', import.meta.url); enlace.href = ruta.href;`;
    assert.deepEqual(dependenciasEjecutablesJs(enlace), []);
    assert.ok(referenciasJs(enlace).includes(destino));
  }
  assert.equal(analizarEjecutablesDelModulo('import(rutaDesconocida)').sinResolver, 1);
  assert.equal(
    analizarEjecutablesDelModulo("const ruta = './seguro.js'; function cargar(ruta) { return import(ruta); }")
      .sinResolver,
    1,
  );
  assert.deepEqual(dependenciasEjecutablesJs('import(`./paso.js#reintento-' + '${' + 'intento}`)'), ['./paso.js']);
});

test('el cargador de idiomas conserva es y ca y solo usa marcas de reintento como fragmento', () => {
  const codigo = leer('idiomas/cargar.js');
  const analisis = analizarEjecutablesDelModulo(codigo);
  assert.ok(analisis.rutas.includes('./es.js'));
  assert.ok(analisis.rutas.includes('./ca.js'));
  assert.equal(analisis.sinResolver, 2);
  assert.match(codigo, /return intentos === undefined \? '' : `#reintento-\$\{intentos\}`;/);
  assert.match(codigo, /DICCIONARIOS\[idioma\]\(marcaDelIntento\(idioma\)\)/);
});
