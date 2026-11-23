// HTML de prueba en memoria: no representa páginas admitidas ni una web completa. Las comprobaciones de páginas con
// mapa son las de la salida de la construcción (comprobarSalida); las fuentes no llevan huellas (problemasDeLaFuente).
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import type { ContextoWeb } from '../../herramientas/web/contexto.ts';
import { empaquetarMotor } from '../../herramientas/web/empaquetado/construccion.ts';
import { FORMA_DEL_PAQUETE } from '../../herramientas/web/empaquetado.ts';
import {
  comprobarIntegridad,
  comprobarSalida,
  huellaCsp,
  huellaSri,
  huellasDelMotorEnLasPaginas,
  MOTOR_EN_LAS_PAGINAS,
  mapaEsperado,
  paginaConHuellas,
  paginaConstruida,
  problemasDeLaFuente,
  textoDelMapa,
} from '../../herramientas/web/integridad.ts';
import { leer } from '../../herramientas/web/publicados.ts';
import { RUTAS } from '../../src/plataforma/node/rutas.ts';
import { conGrafoDeFuentes } from '../ayudas/grafo-de-fuentes.ts';

const PUBLICADOS = ['scripts/json.js'];
const temporal = mkdtempSync(join(tmpdir(), 'integridad-motor-'));
const WEB_DE_PRUEBA = join(temporal, 'candidata');
mkdirSync(join(WEB_DE_PRUEBA, 'scripts'), { recursive: true });
copyFileSync(join(RUTAS.web, 'scripts/json.js'), join(WEB_DE_PRUEBA, 'scripts/json.js'));
after(() => rmSync(temporal, { recursive: true, force: true }));
const CONTEXTO: ContextoWeb = conGrafoDeFuentes({
  web: WEB_DE_PRUEBA,
  paquete: RUTAS.paquete,
  motor: await empaquetarMotor(join(temporal, 'web'), FORMA_DEL_PAQUETE)
    .then(({ archivos }) => archivos)
    .finally(() => rmSync(join(temporal, 'web'), { recursive: true, force: true })),
});
function mapa(extra: Record<string, unknown> = {}): string {
  const integrity = mapaEsperado(PUBLICADOS, undefined, CONTEXTO);
  return `<script type="importmap">${JSON.stringify({ integrity, ...extra })}</script>`;
}
function comprobar(html: string): string[] {
  return comprobarSalida(PUBLICADOS, new Map([['fixture.html', html]]), huellaCsp(textoDelMapa(html) ?? ''), CONTEXTO);
}

test('SRI SHA384 exacta y motor publicado con rutas src, sin raíz duplicada', () => {
  assert.equal(huellaSri('alert(1)'), 'sha384-HT2E9NfWiuQ/w1PRai+hTyqW16NIoCGA/m8VQDUopfAtcz6YQjtsMmQd5uRbVDpW');
  assert.deepEqual(MOTOR_EN_LAS_PAGINAS, [
    ...['privacidad.js', 'avisos.js', 'limites.js'].map((m) => `motor/src/seguridad/${m}`),
    'motor/src/catalogo-cursos/calendarios.js',
    'motor/src/catalogo-cursos/forma.js',
    'motor/src/seleccion-formacion/carga.js',
  ]);
  const huellas = huellasDelMotorEnLasPaginas(CONTEXTO);
  assert.ok(MOTOR_EN_LAS_PAGINAS.every((entrada) => Object.keys(huellas).includes(entrada)));
  assert.ok(Object.keys(huellas).every((ruta) => !ruta.includes('motor/motor/')));
});

test('el HTML generado pasa y recalcular SRI no cambia el contenido de las etiquetas', () => {
  const html = '<script type="module" src="scripts/json.js"></script>';
  const corregida = paginaConHuellas(html, PUBLICADOS, CONTEXTO);
  assert.deepEqual(comprobar(corregida), []);
  assert.ok(corregida.includes(`integrity="${huellaSri(leer('scripts/json.js'))}"`));
  assert.equal(paginaConHuellas(corregida, PUBLICADOS, CONTEXTO), corregida);
});

test('mapa duplicado y mapa comentado no acreditan el único mapa ejecutado', () => {
  const valido = mapa();
  assert.ok(comprobar(`${valido}${valido}`).length > 0);
  assert.ok(comprobar(`<!-- ${valido} -->`).length > 0);
});

test('imports/scopes vacíos se admiten sin depender del orden de propiedades externas', () => {
  for (const extra of [{ imports: {} }, { scopes: {} }, { imports: {}, scopes: {} }]) {
    assert.deepEqual(comprobar(mapa(extra)), []);
    const json = JSON.stringify({ ...extra, integrity: mapaEsperado(PUBLICADOS, undefined, CONTEXTO) });
    assert.deepEqual(comprobar(`<script type="importmap">${json}</script>`), []);
  }
});

test('una redirección imports o scopes se rechaza con diagnóstico específico de aliases', () => {
  const casos = [
    { imports: { './scripts/json.js': './otro.js' } },
    { scopes: { './scripts/': { './scripts/json.js': './otro.js' } } },
  ];
  for (const extra of casos) {
    const problemas = comprobar(mapa(extra));
    assert.equal(problemas.length, 1);
    assert.match(problemas[0] ?? '', /aliases de (?:imports|scopes) no admitidos/);
  }
});

test('SRI cambiada, ausente, CSP distinta y JSON defectuoso fallan', () => {
  const valido = mapa();
  assert.ok(comprobar(`${valido}<script type="module" src="scripts/json.js"></script>`).length > 0);
  assert.ok(comprobar(`${valido}<script type="module" src="scripts/json.js" integrity="otra"></script>`).length > 0);
  assert.ok(comprobarSalida(PUBLICADOS, new Map([['f.html', valido]]), huellaCsp('otro'), CONTEXTO).length > 0);
  assert.ok(comprobar('<script type="importmap">null</script>').length > 0);
});

test('la fuente no lleva mapa, integrity ni crossorigin; se comprueba la página que da la construcción', () => {
  const limpia = '<html><head><script type="module" src="scripts/json.js"></script></head></html>';
  const construida = paginaConstruida('f.html', limpia, PUBLICADOS, CONTEXTO);
  const huella = huellaCsp(textoDelMapa(construida) ?? '');
  assert.deepEqual(problemasDeLaFuente('f.html', limpia), []);
  assert.deepEqual(comprobarSalida(PUBLICADOS, new Map([['f.html', construida]]), huella, CONTEXTO), []);
  assert.deepEqual(comprobarIntegridad(PUBLICADOS, new Map([['f.html', construida]]), huella, CONTEXTO), []);
  assert.ok(comprobarIntegridad(PUBLICADOS, new Map([['f.html', construida]]), huellaCsp('otro'), CONTEXTO).length > 0);
  assert.ok(comprobarIntegridad(PUBLICADOS, new Map([['f.html', limpia]]), huella, CONTEXTO).length > 0);
  assert.deepEqual(problemasDeLaFuente('f.html', construida), [
    'f.html: la fuente no lleva mapa de módulos',
    'f.html: scripts/json.js no lleva integrity ni crossorigin en la fuente',
  ]);
  const conCors = '<script src="scripts/json.js" crossorigin="anonymous"></script>';
  assert.equal(problemasDeLaFuente('f.html', conCors).length, 1);
  assert.deepEqual(problemasDeLaFuente('f.html', `<!-- ${construida} -->`), []);
});
