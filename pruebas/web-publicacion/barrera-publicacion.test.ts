import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { BARRERA } from '../../herramientas/web/barrera-publicacion.ts';
import { comprobarCspHtml } from '../../herramientas/web/csp.ts';
import { comprobarGuion, nombrePublicado, prepararGuion } from '../../herramientas/web/guiones-con-huella.ts';
import { modulosDeLaWeb } from '../../herramientas/web/integridad.ts';

const DIGITOS_SHA256 = 64;

test('la barrera queda fuera del mapa de módulos: la carga su propia etiqueta con integridad', () => {
  const generada = `scripts/barrera-${'b'.repeat(DIGITOS_SHA256)}.js`;
  assert.deepEqual(modulosDeLaWeb(['scripts/barrera-version.js', generada, 'scripts/sitio.js']), ['scripts/sitio.js']);
});

test('en el paquete publicado, sin la fuente, la barrera se acredita por la huella de su nombre', () => {
  const web = mkdtempSync(join(tmpdir(), 'faro-barrera-paquete-'));
  try {
    mkdirSync(join(web, 'scripts'));
    const bytes = 'console.log("barrera");';
    const nombre = `barrera-${createHash('sha256').update(bytes).digest('hex')}.js`;
    writeFileSync(join(web, 'scripts', nombre), bytes);
    const html = `<script src="scripts/${nombre}"></script>`;
    writeFileSync(join(web, 'recorrido.html'), html);
    prepararGuion(web, BARRERA);
    assert.equal(readFileSync(join(web, 'recorrido.html'), 'utf8'), html);
    assert.deepEqual(comprobarGuion(web, BARRERA), []);
    assert.deepEqual(comprobarCspHtml('recorrido.html', html, web), []);
    writeFileSync(join(web, 'scripts', nombre), 'alterado');
    assert.ok(comprobarGuion(web, BARRERA).length > 0);
    assert.ok(comprobarCspHtml('recorrido.html', html, web).length > 0);
  } finally {
    rmSync(web, { recursive: true, force: true });
  }
});

test('en el paquete, si la publicación cambió sus bytes, la barrera se renombra por su huella final', () => {
  const web = mkdtempSync(join(tmpdir(), 'faro-barrera-publicada-'));
  try {
    mkdirSync(join(web, 'scripts'));
    const antiguo = `barrera-${'d'.repeat(DIGITOS_SHA256)}.js`;
    const publicados = 'console.log("barrera sin comentarios");';
    writeFileSync(join(web, 'scripts', antiguo), publicados);
    writeFileSync(join(web, 'recorrido.html'), `<script src="scripts/${antiguo}"></script>`);
    prepararGuion(web, BARRERA);
    const nombre = `barrera-${createHash('sha256').update(publicados).digest('hex')}.js`;
    assert.equal(readFileSync(join(web, 'scripts', nombre), 'utf8'), publicados);
    assert.ok(readFileSync(join(web, 'recorrido.html'), 'utf8').includes(`src="scripts/${nombre}"`));
    assert.deepEqual(comprobarGuion(web, BARRERA), []);
  } finally {
    rmSync(web, { recursive: true, force: true });
  }
});

test('solo cuenta la etiqueta que carga la barrera: un mapa generado antes no bloquea la regeneración', () => {
  const web = mkdtempSync(join(tmpdir(), 'faro-barrera-mapa-'));
  try {
    mkdirSync(join(web, 'scripts'));
    writeFileSync(join(web, 'scripts/barrera-version.js'), 'console.log("barrera");');
    const antigua = `barrera-${'c'.repeat(DIGITOS_SHA256)}.js`;
    const mapa = `<script type="importmap">{"integrity":{"./scripts/${antigua}":"sha384-x","./scripts/barrera-version.js":"sha384-x"}}</script>`;
    writeFileSync(join(web, 'recorrido.html'), `${mapa}<script src="scripts/${antigua}"></script>`);
    prepararGuion(web, BARRERA);
    assert.deepEqual(comprobarGuion(web, BARRERA), []);
    assert.ok(
      readFileSync(join(web, 'recorrido.html'), 'utf8').includes(`src="scripts/${nombrePublicado(web, BARRERA)}"`),
    );
  } finally {
    rmSync(web, { recursive: true, force: true });
  }
});

test('genera nombre por bytes y solo admite el clásico exacto en entradas de recorrido', () => {
  const web = mkdtempSync(join(tmpdir(), 'faro-barrera-test-'));
  try {
    mkdirSync(join(web, 'scripts'));
    mkdirSync(join(web, 'demo'));
    writeFileSync(join(web, 'scripts/barrera-version.js'), 'console.log("barrera");');
    writeFileSync(join(web, 'recorrido.html'), '<script src="scripts/barrera-version.js"></script>');
    writeFileSync(join(web, 'demo/recorrido.html'), '<script src="../scripts/barrera-version.js"></script>');
    prepararGuion(web, BARRERA);
    const nombre = nombrePublicado(web, BARRERA);
    assert.deepEqual(comprobarGuion(web, BARRERA), []);
    const sobrante = join(web, 'scripts', `barrera-${'a'.repeat(DIGITOS_SHA256)}.js`);
    writeFileSync(sobrante, 'antiguo');
    assert.deepEqual(comprobarGuion(web, BARRERA), [
      'scripts/barrera-version.js: falta su copia con huella o hay más de una',
    ]);
    rmSync(sobrante);
    const html = readFileSync(join(web, 'recorrido.html'), 'utf8');
    assert.ok(html.includes(nombre));
    assert.deepEqual(comprobarCspHtml('recorrido.html', html, web), []);
    assert.ok(comprobarCspHtml('inicio.html', html, web).length > 0);
    writeFileSync(join(web, 'scripts', nombre), 'alterado');
    assert.ok(comprobarGuion(web, BARRERA).length > 0);
    assert.ok(comprobarCspHtml('recorrido.html', html, web).length > 0);
  } finally {
    rmSync(web, { recursive: true, force: true });
  }
});
