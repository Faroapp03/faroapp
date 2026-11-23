// Solo la ausencia (ENOENT) cuenta como «no existe» al mirar la carpeta de una extensión o una carpeta generada.
// Cualquier otro error del sistema de archivos se propaga con su causa: un permiso denegado no se lee como ausencia.
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { archivosPropios, CarpetaNoPropia } from '../../herramientas/web/comprobar-artefactos.ts';
import { comprobarRegistroDeExtensiones } from '../../herramientas/web/registro-de-extensiones.ts';

const SIN_PERMISOS = 0o000;
const PERMISOS_DEL_DUENO = 0o700;
const SIN_PERMISOS_QUE_NEGAR =
  process.getuid?.() === 0 && 'Con permisos de administrador no se puede negar el acceso a una carpeta.';

/** Una carpeta temporal con `bloqueada/` sin permisos; se los devuelve antes de borrarla. */
function conCarpetaBloqueada(probar: (raiz: string) => void): void {
  const raiz = mkdtempSync(join(realpathSync(tmpdir()), 'faro-stat-'));
  const bloqueada = join(raiz, 'bloqueada');
  mkdirSync(join(bloqueada, 'servidor'), { recursive: true });
  chmodSync(bloqueada, SIN_PERMISOS);
  try {
    probar(raiz);
  } finally {
    chmodSync(bloqueada, PERMISOS_DEL_DUENO);
    rmSync(raiz, { recursive: true, force: true });
  }
}

function conCausa(codigo: string) {
  return (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(!(error instanceof CarpetaNoPropia), 'un permiso denegado no es una carpeta ausente');
    assert.equal((error.cause as { code?: unknown } | undefined)?.code, codigo);
    return true;
  };
}

test('el registro de extensiones no toma un permiso denegado por una carpeta sin servidor', {
  skip: SIN_PERMISOS_QUE_NEGAR,
}, () => {
  conCarpetaBloqueada((web) => {
    assert.throws(
      () => comprobarRegistroDeExtensiones(web, [{ id: 'demo', entrada: 'bloqueada/recorrido.html' }]),
      conCausa('EACCES'),
    );
  });
});

test('el inventario de una carpeta generada no toma un permiso denegado por una carpeta que falta', {
  skip: SIN_PERMISOS_QUE_NEGAR,
}, () => {
  conCarpetaBloqueada((raiz) => {
    assert.throws(() => archivosPropios(join(raiz, 'bloqueada', 'motor')), conCausa('EACCES'));
  });
});

test('la ausencia sigue siendo ausencia: registro sin carpeta y carpeta que falta', () => {
  const raiz = mkdtempSync(join(realpathSync(tmpdir()), 'faro-stat-'));
  try {
    assert.deepEqual(
      comprobarRegistroDeExtensiones(raiz, [{ id: 'demo', entrada: 'ausente/recorrido.html' }]).length,
      1,
    );
    assert.throws(
      () => archivosPropios(join(raiz, 'motor')),
      (error: unknown) => error instanceof CarpetaNoPropia && error.falta,
    );
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});
