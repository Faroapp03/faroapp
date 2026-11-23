import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';
import { publicarPaquete } from '../../herramientas/publicar-paquete.ts';
import {
  enBytes,
  FaltaLoQueDescarga,
  manifiestoConElPaqueteDeOrigen,
  manifiestoDelDispositivo,
} from '../../herramientas/web/manifiesto-del-dispositivo.ts';
import { leerManifiesto } from '../../web/scripts/firmas/manifiesto-firmado.js';

const temporales: string[] = [];
afterEach(() => {
  for (const carpeta of temporales.splice(0)) {
    rmSync(carpeta, { recursive: true, force: true });
  }
});

function carpeta(): string {
  const ruta = mkdtempSync(join(tmpdir(), 'manifiesto Año 2026 '));
  temporales.push(ruta);
  return ruta;
}

function escribir(base: string, archivo: string, texto: string): void {
  const ruta = join(base, archivo);
  mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, texto);
}

function huella(texto: string): string {
  return createHash('sha256').update(texto).digest('hex');
}

test('sin motor o paquete, incluso carpetas ausentes o vacías, conserva FaltaLoQueDescarga', () => {
  const web = carpeta();
  assert.throws(() => manifiestoDelDispositivo(web, 'abc'), FaltaLoQueDescarga);
  escribir(web, 'motor/src/a.js', 'a');
  assert.throws(() => manifiestoDelDispositivo(web, 'abc'), FaltaLoQueDescarga);
  mkdirSync(join(web, 'paquete/abc'), { recursive: true });
  assert.throws(() => manifiestoDelDispositivo(web, 'abc'), FaltaLoQueDescarga);
  rmSync(join(web, 'motor'), { recursive: true });
  escribir(web, 'paquete/abc/datos.json', '{}');
  assert.throws(() => manifiestoDelDispositivo(web, 'abc'), FaltaLoQueDescarga);
});

test('ordena rutas y conserva exactamente formato, UTF-8, SHA-256 y salto final', () => {
  const web = carpeta();
  escribir(web, 'motor/src/b.js', 'b');
  escribir(web, 'motor/src/a.js', 'Año 😀\n');
  escribir(web, 'paquete/abc/datos.json', '{}');
  const esperado = {
    formato: 1,
    paquete: 'abc',
    archivos: {
      'motor/src/a.js': huella('Año 😀\n'),
      'motor/src/b.js': huella('b'),
      'paquete/abc/datos.json': huella('{}'),
    },
  };
  const bytes = manifiestoDelDispositivo(web, 'abc');
  assert.deepEqual(bytes, new TextEncoder().encode(`${JSON.stringify(esperado, null, 2)}\n`));
  assert.deepEqual(bytes, enBytes(esperado));
  assert.deepEqual([...leerManifiesto(bytes, 'abc').archivos], Object.entries(esperado.archivos));
});

test('el origen datos/ y su publicación paquete/<versión>/ producen idéntico manifiesto', () => {
  const base = carpeta();
  const web = join(base, 'web');
  const datos = join(base, 'datos');
  const contenido = '{ "texto": "Año 2026 😀" }\n';
  escribir(datos, 'a.json', contenido);
  escribir(datos, 'manifiesto.json', `${JSON.stringify({ 'a.json': { sha256: huella(contenido) } })}\n`);
  escribir(datos, 'no-publicado.json', '{}');
  escribir(web, 'motor/src/a.js', 'export const a = 1;\n');
  const version = publicarPaquete(datos, web);
  const origen = manifiestoConElPaqueteDeOrigen(web, datos);
  const publicado = manifiestoDelDispositivo(web, version);
  assert.deepEqual(origen, publicado);
  assert.deepEqual(
    [...leerManifiesto(origen, version).archivos.keys()],
    ['motor/src/a.js', `paquete/${version}/a.json`, `paquete/${version}/manifiesto.json`],
  );
});

test('errores de manifiesto o lectura no se sustituyen por FaltaLoQueDescarga', () => {
  const base = carpeta();
  escribir(base, 'web/motor/src/a.js', 'a');
  escribir(base, 'datos/manifiesto.json', '{');
  assert.throws(() => manifiestoConElPaqueteDeOrigen(join(base, 'web'), join(base, 'datos')), SyntaxError);
  escribir(base, 'datos/manifiesto.json', JSON.stringify({ 'a.json': { sha256: huella('a') } }));
  assert.throws(
    () => manifiestoConElPaqueteDeOrigen(join(base, 'web'), join(base, 'datos')),
    (error: unknown) => error instanceof Error && error.message.includes('ENOENT'),
  );
});
