// Publicación en carpetas de prueba: valida antes de tocar destino y escribe la misma captura que comprobó.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { publicarPaquete } from '../../herramientas/publicar-paquete.ts';
import { CARPETA_DEL_PAQUETE } from '../../src/plataforma/paquete-publicado.ts';

const CIFRAS_DE_UNA_SHA256 = 64;
const DIGEST_ERRONEO = '0'.repeat(CIFRAS_DE_UNA_SHA256);
const DATOS_VIEJOS = '{"version":1}';
const DATOS_NUEVOS = '{"version":2}';

/** Cada prueba crea y retira solo su árbol, con nombres que no se interpretan como URL ni dependen del cwd. */
function conCarpetas(comprobar: (raiz: string) => void): void {
  const raiz = mkdtempSync(join(tmpdir(), 'Año 2026 # % publicar-'));
  try {
    comprobar(raiz);
  } finally {
    rmSync(raiz, { recursive: true });
  }
}

/** Paquete mínimo con una huella real; permite alterar el manifiesto en los casos de rechazo. */
function escribirPaquete(
  carpeta: string,
  datos: string,
  sha256 = createHash('sha256').update(datos).digest('hex'),
): void {
  mkdirSync(carpeta);
  writeFileSync(join(carpeta, 'datos.json'), datos);
  writeFileSync(join(carpeta, 'manifiesto.json'), JSON.stringify({ 'datos.json': { sha256 } }));
}

/** Estado exacto de todos los archivos publicados, incluido cualquier directorio parcial. */
function instantanea(carpeta: string): Record<string, string> {
  const contenido: Record<string, string> = {};
  for (const version of readdirSync(carpeta).sort()) {
    contenido[version] = 'directorio';
    for (const nombre of readdirSync(join(carpeta, version)).sort()) {
      contenido[`${version}/${nombre}`] = readFileSync(join(carpeta, version, nombre)).toString('base64');
    }
  }
  return contenido;
}

/** Publicación previa que cualquier fallo debe conservar íntegra. */
function conPublicado(comprobar: (raiz: string, web: string, previo: Record<string, string>) => void): void {
  conCarpetas((raiz) => {
    const bueno = join(raiz, 'bueno');
    const web = join(raiz, 'web de prueba');
    escribirPaquete(bueno, DATOS_VIEJOS);
    publicarPaquete(bueno, web);
    comprobar(raiz, web, instantanea(join(web, CARPETA_DEL_PAQUETE)));
  });
}

test('publica bytes exactos y retira la versión vieja al completar la nueva', () => {
  conPublicado((raiz, web) => {
    const nuevo = join(raiz, 'nuevo');
    escribirPaquete(nuevo, DATOS_NUEVOS);
    const version = publicarPaquete(nuevo, web);
    const publicado = join(web, CARPETA_DEL_PAQUETE);
    assert.deepEqual(readdirSync(publicado), [version]);
    assert.deepEqual(readdirSync(join(publicado, version)).sort(), ['datos.json', 'manifiesto.json']);
    for (const nombre of ['datos.json', 'manifiesto.json']) {
      assert.deepEqual(readFileSync(join(publicado, version, nombre)), readFileSync(join(nuevo, nombre)));
    }
  });
});

test('una huella que no es digest no toca la publicación anterior', () => {
  conPublicado((raiz, web, previo) => {
    const roto = join(raiz, 'roto');
    escribirPaquete(roto, DATOS_NUEVOS, 'huella-textual');
    assert.throws(() => publicarPaquete(roto, web), /no se puede publicar/);
    assert.deepEqual(instantanea(join(web, CARPETA_DEL_PAQUETE)), previo);
  });
});

test('una huella bien formada pero incorrecta falla antes de tocar destino', () => {
  conPublicado((raiz, web, previo) => {
    const roto = join(raiz, 'roto');
    escribirPaquete(roto, DATOS_NUEVOS, DIGEST_ERRONEO);
    assert.throws(() => publicarPaquete(roto, web), /datos\.json no coincide con su huella/);
    assert.deepEqual(instantanea(join(web, CARPETA_DEL_PAQUETE)), previo);
  });
});

test('un archivo ausente no deja una versión parcial ni borra la anterior', () => {
  conPublicado((raiz, web, previo) => {
    const roto = join(raiz, 'roto');
    escribirPaquete(roto, DATOS_NUEVOS);
    rmSync(join(roto, 'datos.json'));
    assert.throws(() => publicarPaquete(roto, web), { code: 'ENOENT' });
    assert.deepEqual(instantanea(join(web, CARPETA_DEL_PAQUETE)), previo);
  });
});

test('un fallo de integridad no crea siquiera la carpeta de publicación', () => {
  conCarpetas((raiz) => {
    const roto = join(raiz, 'roto');
    const web = join(raiz, 'web aún ausente');
    escribirPaquete(roto, DATOS_NUEVOS, DIGEST_ERRONEO);
    assert.throws(() => publicarPaquete(roto, web), /datos\.json no coincide con su huella/);
    assert.equal(existsSync(web), false);
  });
});

test('un archivo posterior inválido evita escribir los primeros archivos válidos', () => {
  conPublicado((raiz, web, previo) => {
    const roto = join(raiz, 'roto');
    escribirPaquete(roto, DATOS_NUEVOS);
    const manifiesto = JSON.parse(readFileSync(join(roto, 'manifiesto.json'), 'utf8')) as Record<
      string,
      { sha256: string }
    >;
    writeFileSync(join(roto, 'z-final.json'), '{}');
    manifiesto['z-final.json'] = { sha256: DIGEST_ERRONEO };
    writeFileSync(join(roto, 'manifiesto.json'), JSON.stringify(manifiesto));
    assert.throws(() => publicarPaquete(roto, web), /z-final\.json no coincide con su huella/);
    assert.deepEqual(instantanea(join(web, CARPETA_DEL_PAQUETE)), previo);
  });
});
