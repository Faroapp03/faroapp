// Repositorios sintéticos: la guarda revisa el resultado real de git show --cc, sin tocar ramas del producto.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { cambiosPropiosDeJunta, comprobarJuntas } from '../../herramientas/git/comprobar-juntas.ts';
import { pasosDeCodigo } from '../../scripts/verificar.ts';

/** Git aislado de la identidad y los hooks del desarrollador. */
function git(raiz: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
    cwd: raiz,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Equipo Faro',
      GIT_AUTHOR_EMAIL: 'equipo@example.test',
      GIT_COMMITTER_NAME: 'Equipo Faro',
      GIT_COMMITTER_EMAIL: 'equipo@example.test',
    },
  }).trim();
}

function guardar(raiz: string, archivo: string, contenido: string): void {
  writeFileSync(join(raiz, archivo), contenido);
  git(raiz, 'add', '--', archivo);
  git(raiz, 'commit', '-m', 'Cambio sintético');
}

const LONGITUD_OID_SHA1 = 40;
const LONGITUD_OID_SHA256 = 64;

function repositorio(t: TestContext, formato: 'sha1' | 'sha256' = 'sha1'): { raiz: string; corte: string } {
  const raiz = mkdtempSync(join(tmpdir(), 'faro-juntas-'));
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  git(raiz, 'init', '-b', 'principal', `--object-format=${formato}`);
  guardar(raiz, 'base.txt', 'base\n');
  const corte = git(raiz, 'rev-parse', 'HEAD');
  git(raiz, 'checkout', '-b', 'rama');
  guardar(raiz, 'rama.txt', 'rama\n');
  git(raiz, 'checkout', 'principal');
  guardar(raiz, 'principal.txt', 'principal\n');
  return { raiz, corte };
}

test('las cabeceras +++ no son código, pero una línea añadida que empieza por + sí lo es', () => {
  const diferencia = 'diff --cc web/a.html\n+++ b/web/a.html\n@@@ -1,1 -1,1 +1,2 @@@\n  contexto\n+++nuevo\n';
  assert.deepEqual(cambiosPropiosDeJunta(diferencia), [{ archivo: 'web/a.html', linea: 2 }]);
});

test('se comprueban también juntas de tres padres y cambios binarios', () => {
  assert.deepEqual(cambiosPropiosDeJunta('diff --combined a.ts\n@@@@ -1 -1 -1 +7 @@@@\n+++nuevo\n'), [
    { archivo: 'a.ts', linea: 7 },
  ]);
  assert.deepEqual(cambiosPropiosDeJunta('diff --cc modelo.bin\nBinary files differ\n'), [
    { archivo: 'modelo.bin', linea: 0 },
  ]);
});

test('una junta automática conserva ambos trabajos sin introducir código nuevo', (t) => {
  const { raiz, corte } = repositorio(t);
  git(raiz, 'merge', '--no-ff', 'rama', '-m', 'Junta sintética');
  assert.equal(comprobarJuntas(raiz, corte), 1);
});

test('un arreglo dentro de la junta se rechaza, también en un archivo nuevo', (t) => {
  const { raiz, corte } = repositorio(t);
  git(raiz, 'merge', '--no-ff', '--no-commit', 'rama');
  writeFileSync(join(raiz, 'oculto.ts'), 'export const nuevo = true;\n');
  git(raiz, 'add', 'oculto.ts');
  git(raiz, 'commit', '-m', 'Junta con código nuevo');
  assert.throws(() => comprobarJuntas(raiz, corte), /contiene cambios propios: oculto.ts:1/);
});

test('un archivo que contiene huellas no permite ocultar cambios de lógica', (t) => {
  const { raiz, corte } = repositorio(t);
  git(raiz, 'merge', '--no-ff', '--no-commit', 'rama');
  mkdirSync(join(raiz, 'web'));
  writeFileSync(join(raiz, 'web/service-worker.js'), "const VERSION = 'nueva';\nignorarSeguridad();\n");
  git(raiz, 'add', 'web/service-worker.js');
  git(raiz, 'commit', '-m', 'Junta con lógica escondida');
  assert.throws(() => comprobarJuntas(raiz, corte), /web\/service-worker.js:2/);
});

test('el corte excluye solo su pasado y no oculta una junta nueva en una rama secundaria', (t) => {
  const { raiz, corte } = repositorio(t);
  git(raiz, 'checkout', '-b', 'secundaria');
  git(raiz, 'merge', '--no-ff', '--no-commit', 'rama');
  writeFileSync(join(raiz, 'oculto.ts'), 'nuevo();\n');
  git(raiz, 'add', 'oculto.ts');
  git(raiz, 'commit', '-m', 'Junta secundaria con código');
  git(raiz, 'checkout', 'principal');
  guardar(raiz, 'despues.txt', 'otro cambio\n');
  git(raiz, 'merge', '--no-ff', 'secundaria', '-m', 'Integración limpia');
  assert.throws(() => comprobarJuntas(raiz, corte), /oculto.ts:1/);
  assert.equal(comprobarJuntas(raiz, git(raiz, 'rev-parse', 'HEAD')), 0);
});

test('una adaptación posterior se admite y un corte inexistente falla', (t) => {
  const { raiz, corte } = repositorio(t);
  git(raiz, 'merge', '--no-ff', 'rama', '-m', 'Junta sintética');
  guardar(raiz, 'base.txt', 'adaptación en commit propio\n');
  assert.equal(comprobarJuntas(raiz, corte), 1);
  assert.throws(() => comprobarJuntas(raiz, '0000000000000000000000000000000000000000'));
});

test('un historial superficial se rechaza en vez de dar una garantía incompleta', (t) => {
  const { raiz, corte } = repositorio(t);
  writeFileSync(join(raiz, '.git/shallow'), `${git(raiz, 'rev-parse', 'HEAD')}\n`);
  assert.throws(() => comprobarJuntas(raiz, corte), /historial completo/);
});

test('la guarda se exige en CI y no impide verificar una candidata portable sin Git', () => {
  const pasos = pasosDeCodigo('/candidata-sin-git');
  assert(pasos.length > 0);
  assert(pasos.every((paso) => !paso.argumentos.includes('herramientas/git/comprobar-juntas.ts')));
  const ci = readFileSync(new URL('../../.github/workflows/calidad.yml', import.meta.url), 'utf8');
  assert(ci.indexOf('npm run juntas:comprobar') >= 0);
  assert(ci.indexOf('npm run juntas:comprobar') < ci.indexOf('npm run verificar'));
  assert.doesNotMatch(ci, /fetch --depth=/);
});

test('borrar código presente en ambos padres también es una adaptación prohibida en la junta', (t) => {
  const { raiz, corte } = repositorio(t);
  git(raiz, 'merge', '--no-ff', '--no-commit', 'rama');
  writeFileSync(join(raiz, 'base.txt'), '');
  git(raiz, 'add', 'base.txt');
  git(raiz, 'commit', '-m', 'Junta que borra una comprobación');
  assert.throws(() => comprobarJuntas(raiz, corte), /contiene cambios propios: base.txt:/);
});

/** Ejecuta la CLI copiada al repositorio nuevo, sin depender de la historia del producto. */
function cli(raiz: string, args: readonly string[] = [], entorno: NodeJS.ProcessEnv = process.env) {
  const carpeta = join(raiz, 'herramientas/git');
  mkdirSync(carpeta, { recursive: true });
  const script = join(carpeta, 'comprobar-juntas.ts');
  writeFileSync(script, readFileSync(new URL('../../herramientas/git/comprobar-juntas.ts', import.meta.url)));
  return spawnSync(process.execPath, [script, ...args], {
    cwd: raiz,
    encoding: 'utf8',
    env: entorno,
    timeout: 10_000,
    maxBuffer: 65_536,
  });
}

test('un repositorio nuevo sin juntas se comprueba desde sus raíces por defecto', (t) => {
  const { raiz } = repositorio(t);
  assert.equal(comprobarJuntas(raiz), 0);
});

test('la CLI sin parámetros admite la junta limpia de un Git nuevo', (t) => {
  const { raiz } = repositorio(t);
  git(raiz, 'merge', '--no-ff', 'rama', '-m', 'Junta sintética');
  const resultado = cli(raiz);
  assert.equal(resultado.error, undefined);
  assert.equal(resultado.status, 0, resultado.stderr);
  assert.match(resultado.stdout, /1 juntas comprobadas/);
});

test('por defecto no se excluye una adaptación anterior que un corte explícito admite', (t) => {
  const { raiz } = repositorio(t);
  git(raiz, 'merge', '--no-ff', '--no-commit', 'rama');
  guardar(raiz, 'oculto.ts', 'nuevo();\n');
  const corte = git(raiz, 'rev-parse', 'HEAD');
  assert.equal(comprobarJuntas(raiz, corte), 0);
  assert.throws(() => comprobarJuntas(raiz), /oculto.ts:1/);
});

test('la CLI admite un corte completo declarado expresamente', (t) => {
  const { raiz, corte } = repositorio(t);
  git(raiz, 'merge', '--no-ff', 'rama', '-m', 'Junta sintética');
  const resultado = cli(raiz, ['--corte', corte]);
  assert.equal(resultado.error, undefined);
  assert.equal(resultado.status, 0, resultado.stderr);
  assert.match(resultado.stdout, /1 juntas comprobadas/);
});

test('las opciones desconocidas, repetidas, vacías y referencias mutables se rechazan', (t) => {
  const { raiz, corte } = repositorio(t);
  for (const args of [
    ['--otro'],
    ['posicional'],
    ['--corte'],
    ['--corte', ''],
    ['--corte', 'HEAD'],
    ['--corte', '--all'],
    ['--corte', `${corte}x`],
    ['--corte', corte, '--corte', corte],
    ['--corte', '0'.repeat(LONGITUD_OID_SHA1)],
    ['--corte', '0'.repeat(LONGITUD_OID_SHA256)],
  ]) {
    const resultado = cli(raiz, args);
    assert.equal(resultado.error, undefined);
    assert.equal(resultado.status, 1, JSON.stringify(args));
    assert.doesNotMatch(resultado.stdout, /juntas comprobadas/);
  }
});

test('un corte debe ser un commit ancestro, no un blob ni una etiqueta anotada', (t) => {
  const { raiz } = repositorio(t);
  const blob = git(raiz, 'rev-parse', 'HEAD:base.txt');
  assert.throws(() => comprobarJuntas(raiz, blob));
  git(raiz, 'tag', '-a', 'etiqueta', '-m', 'Etiqueta sintética');
  assert.throws(() => comprobarJuntas(raiz, git(raiz, 'rev-parse', 'etiqueta')));
  git(raiz, 'checkout', '--orphan', 'ajena');
  guardar(raiz, 'ajena.txt', 'ajena\n');
  const ajeno = git(raiz, 'rev-parse', 'HEAD');
  git(raiz, 'checkout', 'principal');
  assert.throws(() => comprobarJuntas(raiz, ajeno));
});

test('la ausencia de repositorio o ejecutable Git no se presenta como éxito', (t) => {
  const raiz = mkdtempSync(join(tmpdir(), 'faro-sin-historia-'));
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  assert.throws(() => comprobarJuntas(raiz));
  const sinRepo = cli(raiz);
  assert.equal(sinRepo.status, 1);
  const sinGit = cli(raiz, [], { ...process.env, PATH: join(raiz, 'sin-ejecutables') });
  assert.equal(sinGit.error, undefined);
  assert.equal(sinGit.status, 1);
  assert.doesNotMatch(sinGit.stdout, /juntas comprobadas/);
});

test('la guarda y el corte explícito admiten repositorios nuevos con objetos SHA-256', (t) => {
  const { raiz, corte } = repositorio(t, 'sha256');
  git(raiz, 'merge', '--no-ff', 'rama', '-m', 'Junta sintética');
  assert.equal(corte.length, LONGITUD_OID_SHA256);
  assert.equal(comprobarJuntas(raiz), 1);
  assert.equal(comprobarJuntas(raiz, corte), 1);
  const resultado = cli(raiz, ['--corte', corte]);
  assert.equal(resultado.status, 0, resultado.stderr);
});
