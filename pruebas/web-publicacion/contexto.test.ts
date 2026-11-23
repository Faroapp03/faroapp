// Dos candidatas comparten proceso y rutas relativas, pero no bytes ni estado del constructor.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import type { ContextoWeb } from '../../herramientas/web/contexto.ts';
import { comprobarCspScripts } from '../../herramientas/web/csp.ts';
import {
  comprobarIntegridad,
  corregirIntegridad,
  huellaSri,
  MOTOR_EN_LAS_PAGINAS,
  mapaEsperado,
  textoDelMapa,
} from '../../herramientas/web/integridad.ts';
import { archivosPublicados, leer, listar } from '../../herramientas/web/publicados.ts';
import { comprobarReferencias, comprobarUso } from '../../herramientas/web/referencias.ts';
import { conGrafoDeFuentes } from '../ayudas/grafo-de-fuentes.ts';

const MAPA_FUENTE = new URL('../../src/plataforma/mapa-de-modulos.ts', import.meta.url);
const PAGINA_FUENTE = new URL('../../web/inicio.html', import.meta.url);

const MOTOR = JSON.stringify(MOTOR_EN_LAS_PAGINAS);

function candidata(raiz: string, nombre: string): ContextoWeb {
  const web = join(raiz, nombre);
  const motor = new Map(
    ['privacidad', 'avisos', 'limites'].map((modulo) => [
      `motor/src/seguridad/${modulo}.js`,
      new TextEncoder().encode(
        `${modulo === 'privacidad' ? "import '../comun/dependencia.js';\n" : ''}export const dato = '${nombre}';\n`,
      ),
    ]),
  );
  motor.set('motor/src/comun/dependencia.js', new TextEncoder().encode(`export const dato = '${nombre}';\n`));
  for (const ruta of [
    'motor/src/catalogo-cursos/calendarios.js',
    'motor/src/catalogo-cursos/forma.js',
    'motor/src/seleccion-formacion/carga.js',
  ]) {
    motor.set(ruta, new TextEncoder().encode(`export const dato = '${nombre}';\n`));
  }
  const archivos = {
    '.assetsignore': '*.md\n',
    'index.html':
      '<!doctype html><html><head><script type="module" src="scripts/candidata.js"></script></head>' +
      '<body><a href="otra.html#destino">Otro</a><link rel="stylesheet" href="estilos/candidata.css" /></body></html>',
    'otra.html': '<!doctype html><html><head></head><body><p id="destino">Destino</p></body></html>',
    // Importa por su dirección fija los módulos del motor que cargan las páginas: entran en el mapa de esta página.
    'scripts/candidata.js': `export const dato = '${nombre}';\nexport const MOTOR = ${MOTOR};\n`,
    'estilos/candidata.css': 'p { color: inherit; }\n',
    'administracion/index.html':
      '<!doctype html><html><head><script type="module" src="/administracion/panel.js"></script></head>' +
      '<body>Panel</body></html>',
    'administracion/panel.js': `export const privado = '${nombre}';\n`,
    'terceros/LICENSE': 'Aviso legal conservado.\n',
    'README.md': 'Documentación excluida.\n',
  };
  for (const [archivo, contenido] of Object.entries(archivos)) {
    const destino = join(web, archivo);
    mkdirSync(dirname(destino), { recursive: true });
    writeFileSync(destino, contenido);
  }
  return conGrafoDeFuentes({ web, paquete: join(raiz, 'paquete'), motor });
}

function comprobarCandidata(contexto: ContextoWeb, publicados: string[], huella: string): void {
  const html = leer('index.html', contexto.web);
  const mapa = JSON.parse(textoDelMapa(html) ?? '').integrity;
  assert.equal(mapa['./scripts/candidata.js'], huellaSri(leer('scripts/candidata.js', contexto.web)));
  const dependencia = contexto.motor.get('motor/src/comun/dependencia.js');
  assert.ok(dependencia);
  assert.equal(mapa['./motor/src/comun/dependencia.js'], huellaSri(dependencia));
  assert.deepEqual(mapaEsperado(publicados, undefined, contexto), mapa);
  assert.equal(textoDelMapa(leer('administracion/index.html', contexto.web)), null);
  assert.ok(
    leer('administracion/index.html', contexto.web).includes(
      `integrity="${huellaSri(leer('administracion/panel.js', contexto.web))}"`,
    ),
  );
  assert.equal(
    Object.keys(mapa).some((ruta) => ruta.startsWith('./administracion/')),
    false,
  );
  assert.deepEqual(comprobarIntegridad(publicados, new Map([['index.html', html]]), huella, contexto), []);
  assert.equal(leer('terceros/LICENSE', contexto.web), 'Aviso legal conservado.\n');
}

test('dos contextos aíslan SRI, motor, lecturas y escritura sin modificar las fuentes', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'contextos-web-'));
  const mapaAntes = readFileSync(MAPA_FUENTE);
  const paginaAntes = readFileSync(PAGINA_FUENTE);
  try {
    const a = candidata(raiz, 'Año A');
    const b = candidata(raiz, 'Año B');
    const publicados = archivosPublicados(a.web);
    assert.deepEqual(archivosPublicados(b.web), publicados);
    assert.ok(listar('scripts', a.web).includes('scripts/candidata.js'));
    assert.ok(!publicados.includes('README.md'));
    assert.ok(publicados.includes('terceros/LICENSE'));
    const codigoA = leer('scripts/candidata.js', a.web);
    const codigoB = leer('scripts/candidata.js', b.web);
    assert.notEqual(codigoA, codigoB);

    const huellaA = corregirIntegridad(publicados, a);
    const htmlA = leer('index.html', a.web);
    const huellaB = corregirIntegridad(publicados, b);
    assert.notEqual(huellaA, huellaB);
    assert.equal(leer('index.html', a.web), htmlA);
    assert.equal(corregirIntegridad(publicados, a), huellaA);
    assert.equal(leer('index.html', a.web), htmlA);
    comprobarCandidata(a, publicados, huellaA);
    comprobarCandidata(b, publicados, huellaB);
    assert.deepEqual(readFileSync(MAPA_FUENTE), mapaAntes);
    assert.deepEqual(readFileSync(PAGINA_FUENTE), paginaAntes);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('la comprobación detecta alteraciones en la candidata sin leer las fuentes', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'alteracion-web-'));
  try {
    const contexto = candidata(raiz, 'A');
    const publicados = archivosPublicados(contexto.web);
    const huella = corregirIntegridad(publicados, contexto);
    const html = leer('index.html', contexto.web);
    const incompleto = { ...contexto, motor: new Map<string, Uint8Array>() };
    assert.throws(() => mapaEsperado(publicados, undefined, incompleto), /Falta el módulo del motor de referencia/);
    assert.deepEqual(comprobarCspScripts(publicados, contexto.web), []);
    assert.deepEqual(comprobarReferencias(publicados, contexto.web), []);
    assert.deepEqual(comprobarUso(publicados, contexto.web), []);
    writeFileSync(join(contexto.web, 'scripts/candidata.js'), 'eval("1");\n');
    const problemas = comprobarIntegridad(publicados, new Map([['index.html', html]]), huella, contexto);
    assert.ok(problemas.some((problema) => problema.includes('scripts/candidata.js sin su huella')));
    assert.ok(problemas.some((problema) => problema.includes('mapa de módulos no tiene las huellas de hoy')));
    assert.ok(comprobarCspScripts(publicados, contexto.web).some((problema) => problema.includes('evalúa código')));
    writeFileSync(join(contexto.web, 'otra.html'), '<p id="distinto">Destino cambiado</p>');
    assert.ok(comprobarReferencias(publicados, contexto.web).some((problema) => problema.includes('id que no existe')));
    writeFileSync(join(contexto.web, 'estilos/candidata.css'), '@import url("ausente.css");');
    assert.ok(comprobarReferencias(publicados, contexto.web).some((problema) => problema.includes('ausente.css')));
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

function motorCompacto(contexto: ContextoWeb): Map<string, Uint8Array> {
  const motor = new Map(contexto.motor);
  const fuentes = {
    'motor/src/seguridad/privacidad.js':
      'import{dato as dep}from"../comun/dependencia.js";import"../comun/solo.js";export{dep};' +
      'const texto="import \'../comun/falso.js\'";const plantilla=`export*from"../comun/falso.js"`;' +
      '/* import "../comun/falso.js"; */import("../comun/dinamica.js");',
    'motor/src/seguridad/avisos.js': 'export{dato}from"../comun/nombrada.js";',
    'motor/src/seguridad/limites.js': 'export*from"../comun/todas.js";',
    'motor/src/comun/solo.js': 'export const dato="solo";',
    'motor/src/comun/nombrada.js': 'export const dato="nombrada";',
    'motor/src/comun/todas.js': 'export const dato="todas";',
  };
  for (const [ruta, fuente] of Object.entries(fuentes)) {
    motor.set(ruta, new TextEncoder().encode(fuente));
  }
  return motor;
}

test('el grafo SRI sigue imports y reexports estáticos compactos sin confundir texto ni dinámicos', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'motor-compacto-web-'));
  try {
    const contexto = candidata(raiz, 'Compacta');
    const motor = motorCompacto(contexto);
    const mapa = mapaEsperado([], undefined, { ...contexto, motor });
    assert.deepEqual(Object.keys(mapa).sort(), [...motor.keys()].map((ruta) => `./${ruta}`).sort());
    for (const [ruta, bytes] of motor) {
      assert.equal(mapa[`./${ruta}`], huellaSri(bytes));
    }
    motor.delete('motor/src/comun/solo.js');
    assert.throws(() => mapaEsperado([], undefined, { ...contexto, motor }), /Falta el módulo del motor de referencia/);
    motor.set('motor/src/seguridad/limites.js', new TextEncoder().encode('export{'));
    assert.throws(() => mapaEsperado([], undefined, { ...contexto, motor }), SyntaxError);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('actualizar SRI candidato conserva espacios y saltos del contenido HTML público y administrativo', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'espacios-html-web-'));
  const cuerpo = '<body><p>Uno<span>dos</span>tres</p>\r\n  <pre> a  b\n c </pre>\n</body>';
  try {
    const contexto = candidata(raiz, 'Espacios');
    for (const pagina of ['index.html', 'administracion/index.html']) {
      const entrada = pagina.startsWith('administracion') ? '/administracion/panel.js' : 'scripts/candidata.js';
      const html = `<html><head><script type="module" src="${entrada}"></script></head>${cuerpo}</html>`;
      writeFileSync(join(contexto.web, pagina), html);
    }
    const publicados = archivosPublicados(contexto.web);
    const huella = corregirIntegridad(publicados, contexto);
    const paginas = new Map(
      ['index.html', 'administracion/index.html'].map((pagina) => {
        const html = leer(pagina, contexto.web);
        assert.ok(html.includes(cuerpo), pagina);
        return [pagina, html] as const;
      }),
    );
    assert.deepEqual(comprobarIntegridad(publicados, paginas, huella, contexto), []);
    assert.equal(corregirIntegridad(publicados, contexto), huella);
    for (const [pagina, html] of paginas) {
      assert.equal(leer(pagina, contexto.web), html);
    }
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('sin páginas no hay mapa que generar, y una página sin cabecera no recibe uno a medias', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'faro-sin-paginas-'));
  try {
    const contexto = candidata(raiz, 'web');
    assert.throws(() => corregirIntegridad([], contexto), /No hay páginas para generar el mapa de módulos/);
    writeFileSync(join(contexto.web, 'suelta.html'), '<p>Sin cabecera ni guiones</p>');
    const antes = readFileSync(join(contexto.web, 'suelta.html'));
    assert.throws(() => corregirIntegridad(['suelta.html'], contexto), /suelta\.html: no hay cabecera para el mapa/);
    assert.deepEqual(readFileSync(join(contexto.web, 'suelta.html')), antes);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});
