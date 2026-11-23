import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { archivosPublicados, leer, WEB } from '../../herramientas/web/publicados.ts';
import {
  CARPETAS_DEL_REAL_CON_PAGINAS,
  comprobarRegistroDeExtensiones,
} from '../../herramientas/web/registro-de-extensiones.ts';
import { PROYECTOS_TYPESCRIPT } from '../../scripts/proyectos-typescript.ts';
import { exclusionesDeArchivos } from '../../src/comun/exclusiones-de-archivos.ts';
import { EXTENSIONES } from '../../src/plataforma/extensiones.ts';
import { VARIANTES_RECORRIDO } from '../../src/plataforma/variantes-recorrido.ts';

const SOLO_DEL_REPOSITORIO = /(?:^|\/)(?:servidor|pruebas)\/|(?:^|\/)tsconfig\.json$/;
const carpetaDe = (entrada: string) => entrada.slice(0, entrada.indexOf('/'));
const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const REGISTRO = 'src/plataforma/extensiones-instaladas.ts';
/** Una línea del registro que instala una extensión: la que se borra al retirarla. */
const LINEA_DE_EXTENSION = /^export \{ \w+ \} from '[^']+';$/u;
const CONSUMIDOR =
  "import * as instaladas from './extensiones-instaladas.ts';\n\n" +
  'export const cuantas: number = Object.keys(instaladas).length;\n';

/** Compila con las opciones de un proyecto de TypeScript del repositorio un consumidor del registro de `carpeta`. */
function compilarConElProyecto(carpeta: string, proyecto: string) {
  const configuracion = join(carpeta, 'tsconfig.json');
  writeFileSync(
    configuracion,
    JSON.stringify({
      extends: join(RAIZ, proyecto),
      compilerOptions: { rootDir: '.', types: [], skipLibCheck: true },
      files: ['consumidor.ts'],
      include: [],
    }),
  );
  return spawnSync(
    process.execPath,
    [join(RAIZ, 'node_modules/typescript/bin/tsc'), '--project', configuracion, '--noEmit'],
    { encoding: 'utf8' },
  );
}

test('cada extensión instalada aporta su variante, su página de entrada y sus rutas protegidas', () => {
  for (const extension of EXTENSIONES) {
    const variante = VARIANTES_RECORRIDO.find(({ id }) => id === extension.id);
    assert.equal(variante?.rutaPublica, extension.entrada, extension.id);
    assert.ok(existsSync(join(WEB, extension.entrada)), extension.entrada);
    assert.ok(extension.rutasProtegidas.includes(`/${extension.entrada}`), extension.id);
    assert.ok(carpetaDe(extension.entrada), extension.entrada);
    for (const pagina of extension.paginasConVersion) {
      assert.ok(existsSync(join(WEB, pagina)), pagina);
    }
  }
});

test('el registro y las carpetas de web/ con servidor/extension.ts coinciden en los dos sentidos', () => {
  assert.deepEqual(comprobarRegistroDeExtensiones(WEB, EXTENSIONES), []);
});

test('el registro sin ninguna línea de extensión sigue siendo un módulo para cada proyecto de TypeScript', () => {
  const vacio = readFileSync(join(RAIZ, REGISTRO), 'utf8')
    .split('\n')
    .filter((linea) => !LINEA_DE_EXTENSION.test(linea))
    .join('\n');
  const temporal = mkdtempSync(join(realpathSync(tmpdir()), 'registro-vacio-'));
  try {
    writeFileSync(join(temporal, 'package.json'), '{ "type": "module" }\n');
    writeFileSync(join(temporal, 'extensiones-instaladas.ts'), vacio);
    writeFileSync(join(temporal, 'consumidor.ts'), CONSUMIDOR);
    for (const { nombre, proyecto } of PROYECTOS_TYPESCRIPT) {
      const resultado = compilarConElProyecto(temporal, proyecto);
      assert.equal(resultado.status, 0, `${nombre}: ${resultado.stdout}${resultado.stderr}`);
    }
  } finally {
    rmSync(temporal, { recursive: true, force: true });
  }
});

test('una carpeta con servidor/extension.ts sin registro, o un registro sin carpeta, detienen la comprobación', () => {
  const temporal = mkdtempSync(join(realpathSync(tmpdir()), 'registro-de-extensiones-'));
  try {
    const web = join(temporal, 'web');
    mkdirSync(join(web, 'ext', 'servidor'), { recursive: true });
    writeFileSync(join(web, 'ext', 'servidor', 'extension.ts'), 'export {};\n');
    mkdirSync(join(web, 'sin-servidor'));
    const sinRegistro = comprobarRegistroDeExtensiones(web, []);
    assert.equal(sinRegistro.length, 1, sinRegistro.join('\n'));
    assert.match(sinRegistro[0] ?? '', /web\/ext\/[\s\S]*extensiones-instaladas\.ts/);
    const sinCarpeta = comprobarRegistroDeExtensiones(web, [
      { id: 'demo', entrada: 'ext/recorrido.html' },
      { id: 'demo', entrada: 'ausente/recorrido.html' },
    ]);
    assert.equal(sinCarpeta.length, 1, sinCarpeta.join('\n'));
    assert.match(sinCarpeta[0] ?? '', /«demo»[\s\S]*web\/ausente\//);
  } finally {
    rmSync(temporal, { recursive: true, force: true });
  }
});

test('la lista cerrada de carpetas del real con páginas es exactamente la del árbol real', () => {
  const extensiones = new Set(EXTENSIONES.map(({ entrada }) => carpetaDe(entrada)));
  const conPaginas = readdirSync(WEB, { withFileTypes: true })
    .filter((entrada) => entrada.isDirectory() && !extensiones.has(entrada.name))
    .map(({ name }) => name)
    .filter((carpeta) => readdirSync(join(WEB, carpeta), { recursive: true }).some((r) => String(r).endsWith('.html')))
    .sort();
  assert.deepEqual(conPaginas, [...CARPETAS_DEL_REAL_CON_PAGINAS].sort());
});

test('.assetsignore deja en el repositorio el servidor, las pruebas y los tipos de cualquier carpeta', () => {
  const patrones = exclusionesDeArchivos(leer('.assetsignore'));
  const excluido = (ruta: string) => patrones.some((patron) => patron.test(ruta));
  for (const ruta of [
    'ext/servidor/extension.ts',
    'ext/servidor/a/b.ts',
    'ext/pruebas/a.test.ts',
    'ext/tsconfig.json',
  ]) {
    assert.ok(excluido(ruta), ruta);
  }
  for (const ruta of ['ext/recorrido.html', 'ext/scripts/servidor.js', 'scripts/pruebas.js', 'ext/tsconfig.json.js']) {
    assert.ok(!excluido(ruta), ruta);
  }
});

test('la web publicada no lleva el servidor, las pruebas ni los tipos de las extensiones instaladas', () => {
  const publicados = archivosPublicados();
  assert.deepEqual(
    publicados.filter((ruta) => SOLO_DEL_REPOSITORIO.test(ruta)),
    [],
  );
  for (const extension of EXTENSIONES) {
    const servidor = `${carpetaDe(extension.entrada)}/servidor/extension.ts`;
    assert.ok(existsSync(join(WEB, servidor)), servidor);
    assert.ok(!publicados.includes(servidor), servidor);
  }
});
