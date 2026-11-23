/**
 * Guardia de dependencias del adaptador de Cloudflare: fuera de src/plataforma/cloudflare/ ningún módulo del producto
 * importa de esa carpeta. Se revisan src/, herramientas/, scripts/, compartido/ y la carpeta del servidor de cada
 * extensión instalada; cada importación relativa, estática, dinámica, de tipos o reexportada, se resuelve y no puede
 * caer dentro del adaptador. Quedan fuera las herramientas propias del adaptador (herramientas/cloudflare/), que
 * construyen el Worker y calculan sus huellas desde sus fuentes, y las pruebas, que lo ejercitan.
 *
 * Una excepción se admite por nombre, con su motivo, y falla en cuanto deja de aparecer.
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { importacionesJs } from '../../herramientas/web/comentarios-js.ts';
import { EXTENSIONES } from '../../src/plataforma/extensiones.ts';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const ADAPTADOR = 'src/plataforma/cloudflare/';
const HERRAMIENTAS_DEL_ADAPTADOR = 'herramientas/cloudflare/';
const CODIGO = /\.(?:[cm]?[jt]s)$/u;
const SIN_REVISAR = new Set(['node_modules', '.git']);

interface Excepcion {
  readonly archivo: string;
  readonly importa: string;
  readonly motivo: string;
}

const EXCEPCIONES: readonly Excepcion[] = [
  {
    archivo: 'src/plataforma/node/administracion.ts',
    importa: 'src/plataforma/cloudflare/cerrojo-access.ts',
    motivo:
      'El servidor Node protege la API con el mismo cerrojo de Cloudflare Access que el Worker; mientras ese ' +
      'cerrojo viva en el adaptador, esta es la única dependencia admitida.',
  },
];

function carpetasRevisadas(): string[] {
  const deExtensiones = EXTENSIONES.map(({ entrada }) => posix.join('web', posix.dirname(entrada), 'servidor'));
  return ['src', 'herramientas', 'scripts', 'compartido', ...deExtensiones];
}

function archivosDe(carpeta: string): string[] {
  const absoluta = join(RAIZ, carpeta);
  if (!existsSync(absoluta)) {
    return [];
  }
  return readdirSync(absoluta).flatMap((nombre) => {
    if (SIN_REVISAR.has(nombre)) {
      return [];
    }
    const ruta = join(absoluta, nombre);
    if (statSync(ruta).isDirectory()) {
      return archivosDe(relative(RAIZ, ruta));
    }
    return CODIGO.test(nombre) ? [relative(RAIZ, ruta).split(sep).join('/')] : [];
  });
}

/** Las importaciones de un archivo que caen dentro del adaptador, como rutas del repositorio. */
function haciaElAdaptador(archivo: string): string[] {
  return importacionesJs(readFileSync(join(RAIZ, archivo), 'utf8'))
    .filter((especificador) => especificador.startsWith('.'))
    .map((especificador) =>
      relative(RAIZ, resolve(dirname(join(RAIZ, archivo)), especificador))
        .split(sep)
        .join('/'),
    )
    .filter((destino) => destino.startsWith(ADAPTADOR));
}

test('fuera del adaptador de Cloudflare ningún módulo del producto importa de él', () => {
  const usadas = new Set<Excepcion>();
  const fuera: string[] = [];
  for (const archivo of carpetasRevisadas().flatMap(archivosDe)) {
    if (archivo.startsWith(ADAPTADOR) || archivo.startsWith(HERRAMIENTAS_DEL_ADAPTADOR)) {
      continue;
    }
    for (const destino of haciaElAdaptador(archivo)) {
      const admitida = EXCEPCIONES.find((excepcion) => excepcion.archivo === archivo && excepcion.importa === destino);
      if (admitida) {
        usadas.add(admitida);
      } else {
        fuera.push(`${archivo} → ${destino}`);
      }
    }
  }
  assert.deepEqual(
    fuera,
    [],
    'Estos módulos dependen del adaptador de Cloudflare: lleva lo que comparten a un módulo neutro de la plataforma.',
  );
  assert.deepEqual(
    EXCEPCIONES.filter((excepcion) => !usadas.has(excepcion)).map(({ archivo, importa }) => `${archivo} → ${importa}`),
    [],
    'Estas excepciones ya no aparecen: retíralas de la lista.',
  );
});

test('la guardia reconoce las importaciones de tipos, dinámicas y reexportadas', () => {
  const muestras = [
    "import type { A } from './cloudflare/a.ts';",
    "const b = await import('./cloudflare/b.ts');",
    "export { C } from './cloudflare/c.ts';",
    "import './cloudflare/d.ts';",
  ];
  assert.deepEqual(importacionesJs(muestras.join('\n')), [
    './cloudflare/a.ts',
    './cloudflare/b.ts',
    './cloudflare/c.ts',
    './cloudflare/d.ts',
  ]);
  assert.deepEqual(importacionesJs("// import { E } from './cloudflare/e.ts';\nconst f = 'from';"), []);
});
