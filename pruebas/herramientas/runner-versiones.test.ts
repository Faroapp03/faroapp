import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const raiz = fileURLToPath(new URL('../../', import.meta.url));
const runner = join(raiz, 'herramientas/mantenimiento/preparar-runner.sh');

test('las versiones exactas del runner están dentro del contrato de la instalación', () => {
  const guion = readFileSync(runner, 'utf8');
  const node = guion.match(/^node_version=(\d+\.\d+\.\d+)$/m)?.[1];
  const rango = (JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8')) as { engines: { node: string } }).engines
    .node;
  const limites = /^>=(\d+)\.(\d+)\.(\d+) <(\d+)$/.exec(rango);
  assert.equal(node, '24.22.3');
  assert.ok(limites);
  const partes = node.split('.').map(Number);
  const FIN_VERSION_MINIMA = 4;
  const inferior = limites.slice(1, FIN_VERSION_MINIMA).map(Number);
  const comparacion = partes.findIndex((valor, i) => valor !== inferior[i]);
  assert.ok(comparacion === -1 || (partes[comparacion] as number) > (inferior[comparacion] as number));
  assert.ok((partes[0] as number) < Number(limites[4]));
  const python = readFileSync(join(raiz, '.python-version'), 'utf8').trim();
  assert.ok(guion.includes(`python_version=${python}\n`));
  assert.ok(guion.includes(`python_publicacion=${python}-36805895057\n`));
  assert.ok(guion.includes('python_bytes=95218570\n'));
  assert.ok(guion.includes('python_sha256=fcb672b0437c2d8df5565b7cc250b2b0d7455e2b8d6a4a107cfa6f2efe4f7ed8\n'));
  assert.ok(guion.includes('== "$python_version" ]]'));
});

test('el runner aloja Python y SQLite en el prefijo temporal del job y prueba el intérprete del venv', () => {
  const guion = readFileSync(runner, 'utf8');
  assert.match(guion, /python_prefijo="\$privado\/python"/u);
  assert.match(guion, /python_lib="\$python_prefijo\/lib"/u);
  assert.match(guion, /fuente-sqlite\.py/u);
  assert.match(guion, /limpio node .*comprobar-sqlite-node\.mjs.*sqlite3\.h/u);
  assert.match(guion, /comprobar_motor "\$PWD\/\.venv"/u);
  assert.doesNotMatch(guion, /\/bin\/bash \.\/setup\.sh/u);
});

test('en otra arquitectura el runner se detiene antes de descargar', () => {
  const carpeta = mkdtempSync(join(tmpdir(), 'runner-sin-python-'));
  try {
    writeFileSync(join(carpeta, 'uname'), '#!/bin/sh\ncase "$1" in -s) echo Linux;; -m) echo aarch64;; esac\n', {
      mode: 0o700,
    });
    writeFileSync(join(carpeta, 'curl'), '#!/bin/sh\necho descarga-indebida >&2; exit 99\n', { mode: 0o700 });
    const resultado = spawnSync('bash', [runner], {
      cwd: raiz,
      encoding: 'utf8',
      env: {
        PATH: `${carpeta}:/usr/bin:/bin`,
        RUNNER_TOOL_CACHE: join(carpeta, 'cache'),
        RUNNER_TEMP: carpeta,
        GITHUB_PATH: join(carpeta, 'path'),
        GITHUB_ENV: join(carpeta, 'env'),
      },
    });
    assert.notEqual(resultado.status, 0);
    assert.match(resultado.stderr, /ubuntu-24\.04 para Linux x86_64/u);
    assert.doesNotMatch(resultado.stderr, /descarga-indebida/u);
    assert.equal(resultado.stdout, '');
  } finally {
    rmSync(carpeta, { recursive: true, force: true });
  }
});
