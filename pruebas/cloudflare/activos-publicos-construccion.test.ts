import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { comprobarActivosPublicos } from '../../herramientas/cloudflare/comprobar-construccion.ts';
import { ACTIVOS_PUBLICOS, FOTOGRAFIA_PORTADA } from '../../src/plataforma/cloudflare/activos-publicos.ts';

const WEB = fileURLToPath(new URL('../../web/', import.meta.url));
const RUTAS = ACTIVOS_PUBLICOS.map((activo) => activo.archivo);

function conWeb(preparar: (web: string) => void, comprobar: (web: string) => void): void {
  const web = mkdtempSync(join(tmpdir(), 'activos-publicos-'));
  try {
    preparar(web);
    comprobar(web);
  } finally {
    rmSync(web, { recursive: true });
  }
}

function copiarActivos(web: string): void {
  for (const ruta of RUTAS) {
    mkdirSync(dirname(join(web, ruta)), { recursive: true });
    copyFileSync(join(WEB, ruta), join(web, ruta));
  }
}

test('la web del repositorio lleva cada activo público con los bytes de su huella', () => {
  assert.doesNotThrow(() => comprobarActivosPublicos(WEB, RUTAS));
});

test('la construcción se rechaza si falta un activo público en la web publicada', () => {
  conWeb(
    () => undefined,
    (web) => assert.throws(() => comprobarActivosPublicos(web, []), /Falta en la web publicada el activo público/),
  );
});

test('la construcción se rechaza si un activo público tiene otros bytes que su huella', () => {
  conWeb(
    (web) => {
      copiarActivos(web);
      writeFileSync(join(web, FOTOGRAFIA_PORTADA.archivo), 'otros bytes');
    },
    (web) => assert.throws(() => comprobarActivosPublicos(web, RUTAS), /no coincide con su huella/),
  );
});

test('la construcción acepta una web con los activos públicos copiados sin cambios', () => {
  conWeb(copiarActivos, (web) => assert.doesNotThrow(() => comprobarActivosPublicos(web, RUTAS)));
});
