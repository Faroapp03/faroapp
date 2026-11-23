import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseDocument } from 'yaml';

const ARCHIVO = new URL('../../.github/workflows/actualizar.yml', import.meta.url);
const PLAZO_MS = 10_000;
const PERMISOS_EJECUTABLE = 0o755;

function objeto(entrada: unknown): Record<string, unknown> {
  assert.ok(entrada !== null && typeof entrada === 'object' && !Array.isArray(entrada));
  return entrada as Record<string, unknown>;
}
function texto(entrada: unknown): string {
  assert.equal(typeof entrada, 'string');
  return entrada as string;
}
function candidatoDelWorkflow(): Record<string, unknown> {
  const documento = parseDocument(readFileSync(ARCHIVO, 'utf8'), { uniqueKeys: true });
  assert.deepEqual(documento.errors, []);
  return objeto(objeto(objeto(documento.toJS()).jobs).candidato);
}

const CICLO = 'Construir y conservar el candidato';
function ejecutarCiclo(t: { after: (f: () => void) => void }, salida: string, codigo = 0) {
  const raiz = mkdtempSync(join(realpathSync(tmpdir()), 'resultado del ciclo '));
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  const trabajo = join(raiz, 'trabajo');
  mkdirSync(join(trabajo, '.venv', 'bin'), { recursive: true });
  const python = join(trabajo, '.venv', 'bin', 'python');
  writeFileSync(python, `#!/bin/bash\nprintf '%s\\n' "$FALSO_SALIDA"\nexit ${codigo}\n`);
  chmodSync(python, PERMISOS_EJECUTABLE);
  const temporal = join(raiz, 'temporal');
  mkdirSync(temporal);
  const salidas = join(raiz, 'salidas');
  writeFileSync(salidas, '');
  const r = spawnSync(
    '/bin/bash',
    ['--noprofile', '--norc', '-euo', 'pipefail', '-c', texto(candidatoPaso(CICLO).run)],
    {
      cwd: trabajo,
      env: {
        PATH: '/usr/bin:/bin',
        GITHUB_WORKSPACE: trabajo,
        RUNNER_TEMP: temporal,
        GITHUB_OUTPUT: salidas,
        FALSO_SALIDA: salida,
      },
      encoding: 'utf8',
      timeout: PLAZO_MS,
    },
  );
  return { estado: r.status, stdout: r.stdout, escrito: readFileSync(salidas, 'utf8') };
}
function candidatoPaso(nombre: string): Record<string, unknown> {
  const candidato = candidatoDelWorkflow();
  assert.ok(Array.isArray(candidato.steps));
  const encontrado = candidato.steps.map(objeto).find((p) => p.name === nombre);
  assert.ok(encontrado, nombre);
  return encontrado;
}

test('el candidato expone el resultado del ciclo como salida del trabajo, sin permisos nuevos', () => {
  const candidato = candidatoDelWorkflow();
  assert.deepEqual(objeto(candidato.outputs).resultado_ciclo, `\${{ steps.ciclo.outputs.resultado_ciclo }}`);
  assert.equal(candidatoPaso(CICLO).id, 'ciclo');
  assert.deepEqual(candidato.permissions, { contents: 'read', 'id-token': 'write' });
  assert.doesNotMatch(texto(candidatoPaso(CICLO).run), /\$\{\{/);
});

test('la salida del candidato solo admite la lista cerrada de resultados y el resumen se sigue imprimiendo', (t) => {
  for (const resultado of ['validado', 'sin-pendientes', 'rechazado']) {
    const linea = `{"version":1,"estado":"aplicado","revisionReserva":10,"resultado":"${resultado}"}`;
    const r = ejecutarCiclo(t, linea);
    assert.equal(r.estado, 0);
    assert.equal(r.escrito, `resultado_ciclo=${resultado}\n`);
    assert.equal(r.stdout, `${linea}\n`);
  }
  for (const linea of [
    '{"resultado":"otro"}',
    '{"resultado":"Rechazado"}',
    '{"resultado":3}',
    '{"resultado":null}',
    '{"version":1}',
    'no es JSON',
    '',
  ]) {
    const r = ejecutarCiclo(t, linea);
    assert.equal(r.escrito, '', linea);
  }
});

test('si el supervisor falla, el paso falla y no escribe ningún resultado', (t) => {
  const r = ejecutarCiclo(t, '{"resultado":"rechazado"}', 1);
  assert.equal(r.estado, 1);
  assert.equal(r.escrito, '');
});
