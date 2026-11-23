import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const LONGITUD_REVISION = 40;
const LONGITUD_PAQUETE = 16;
const construir = fileURLToPath(new URL('../../herramientas/web/construir.ts', import.meta.url));
const artefacto = fileURLToPath(new URL('../../herramientas/cloudflare/artefacto.ts', import.meta.url));
const cli = (programa: string, ...args: string[]) =>
  spawnSync(process.execPath, [programa, ...args], { encoding: 'utf8' });

test('las ayudas distinguen carpeta de variante y rechazan variantes inválidas antes de construir', () => {
  const ayudaConstruir = cli(construir, '--ayuda');
  assert.equal(ayudaConstruir.status, 0);
  assert.match(ayudaConstruir.stdout, /--destino indica la carpeta; --destino-cloudflare/u);
  const ayudaArtefacto = cli(artefacto, '--ayuda');
  assert.equal(ayudaArtefacto.status, 0);
  assert.match(ayudaArtefacto.stdout, /posicional; --destino indica la variante/u);
  const invalido = cli(construir, '--destino-cloudflare', 'ajeno');
  assert.notEqual(invalido.status, 0);
  assert.match(invalido.stderr, /Destino Cloudflare inválido/u);
  const invalidoArtefacto = cli(
    artefacto,
    'exportar',
    'salida',
    '--revision-codigo',
    'a'.repeat(LONGITUD_REVISION),
    '--huella-paquete',
    'b'.repeat(LONGITUD_PAQUETE),
    '--destino',
    'ajeno',
  );
  assert.notEqual(invalidoArtefacto.status, 0);
  assert.match(invalidoArtefacto.stderr, /argumentos/iu);
});

test('la exportación de un artefacto nuevo exige declarar la variante antes de construir', () => {
  const sinVariante = cli(construir, '--solo-nuevo', '--revision-codigo', 'a'.repeat(LONGITUD_REVISION));
  assert.notEqual(sinVariante.status, 0);
  assert.match(sinVariante.stderr, /--solo-nuevo necesita --destino-cloudflare/u);
});
