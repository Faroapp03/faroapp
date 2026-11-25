// Las rutas que citan las guías de entrada existen en el árbol. Una guía que nombra un archivo movido o retirado
// engaña a quien la sigue, así que cada ruta entre comillas invertidas y cada enlace relativo de README.md, docs/*.md
// y el README.md de cada carpeta de primer nivel tiene que apuntar a algo que exista. Las carpetas que crea la
// instalación (var/, dist/…) no están en Git y no se comprueban, ni los archivos privados que solo tiene una instalación
// autorizada; las rutas citadas a propósito como inexistentes van en una lista cerrada con su motivo.

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));

/** Carpetas que crean la instalación o la construcción: no están en el árbol de Git. */
const CREADAS_POR_LA_INSTALACION = ['var/', 'dist/', '.venv/', '.web-local/', 'node_modules/'];

/**
 * Archivos privados fuera de Git: los tiene una instalación autorizada y no los tienen el ciclo ni una copia pública.
 * La tabla completa del estudio de la Cambra: el ciclo operativo retira su nombre del paquete (exportar_paquete).
 */
const PRIVADOS_FUERA_DE_GIT = ['datos/cambra.json'];

/** Lo que convierte un texto entre comillas invertidas en un patrón o una orden, no en una ruta concreta. */
const SIGNOS_DE_PATRON = /[<>*${}|…]/u;
const ESQUEMA_DE_URL = /^[a-z][a-z0-9+.-]*:/iu;
const SUFIJO_DE_LINEA = /:\d+(?:-\d+)?$/u;
const CODIGO_EN_LINEA = /`([^`\s]+)`/gu;
const ENLACE = /\]\(([^)\s]+)\)/gu;
const VALLA = /^\s*(?:```|~~~)/u;
/** Una ruta absoluta del sistema o de la carpeta personal, o una ruta de URL: no es del árbol. */
const ABSOLUTA = /^[/~]/u;
const BARRA_FINAL = /\/$/u;

/** Rutas citadas a propósito como algo que no existe, con el motivo que da la propia guía. */
const CITADAS_SIN_EXISTIR: readonly { archivo: string; ruta: string; motivo: string }[] = [
  { archivo: 'docs/catalogo-de-datos.md', ruta: 'datos/eaes.json', motivo: 'EAES alimenta Mercado sin archivo propio' },
  ...['web/motor/', 'web/paquete/', 'web/firmas/manifiesto.json', 'web/service-worker.js'].map((ruta) => ({
    archivo: 'docs/construccion-web.md',
    ruta,
    motivo: 'solo existe en la web construida, no en las fuentes de web/',
  })),
  { archivo: 'docs/construccion-web.md', ruta: 'web/fichas/', motivo: 'el contrato la admite y el catálogo no la usa' },
  {
    archivo: 'docs/regla-de-la-acreditacion.md',
    ruta: 'datos/revisiones/acreditacion/',
    motivo: 'cita literal de la norma fijada, no una ruta de la instalación',
  },
];

/** Una ruta citada en una guía, con su línea. */
interface Cita {
  readonly archivo: string;
  readonly linea: number;
  readonly ruta: string;
}

/** Las guías de entrada: el README de la raíz, las de docs/ y el README de cada carpeta de primer nivel. */
function guias(raiz: string): string[] {
  const deDocs = readdirSync(join(raiz, 'docs'))
    .filter((nombre) => nombre.endsWith('.md'))
    .map((nombre) => `docs/${nombre}`);
  const deCarpetas = readdirSync(raiz, { withFileTypes: true })
    .filter((entrada) => entrada.isDirectory() && existsSync(join(raiz, entrada.name, 'README.md')))
    .map((entrada) => `${entrada.name}/README.md`)
    .filter((guia) => guia !== 'docs/README.md' && !guia.startsWith('node_modules/') && !guia.startsWith('.'));
  return ['README.md', ...deDocs, ...deCarpetas].sort();
}

/** Las líneas de un texto Markdown, con las de los bloques de código vaciadas para conservar la numeración. */
function lineasFueraDeBloques(texto: string): string[] {
  let dentro = false;
  return texto.split('\n').map((linea) => {
    if (VALLA.test(linea)) {
      dentro = !dentro;
      return '';
    }
    return dentro ? '' : linea;
  });
}

/** Si un texto entre comillas invertidas tiene forma de ruta del árbol, relativa a la raíz o a la carpeta de la guía. */
function pareceRuta(texto: string, raiz: string, carpeta: string): boolean {
  if (!texto.includes('/') || SIGNOS_DE_PATRON.test(texto) || ESQUEMA_DE_URL.test(texto) || ABSOLUTA.test(texto)) {
    return false;
  }
  if (texto.startsWith('./') || texto.startsWith('../')) {
    return true;
  }
  const ultimo = texto.replace(BARRA_FINAL, '').split('/').at(-1) ?? '';
  const esArchivoOCarpeta = texto.endsWith('/') || ultimo.includes('.');
  const primero = texto.split('/')[0] ?? '';
  return esArchivoOCarpeta && (existsSync(join(raiz, primero)) || existsSync(join(raiz, carpeta, primero)));
}

/** Las rutas que una línea cita como código en línea, sin el número de línea que a veces las acompaña. */
function rutasEnCodigo(linea: string, raiz: string, carpeta: string): string[] {
  return [...linea.matchAll(CODIGO_EN_LINEA)]
    .map(([, crudo = '']) => crudo.replace(SUFIJO_DE_LINEA, ''))
    .filter((ruta) => pareceRuta(ruta, raiz, carpeta));
}

/** Los destinos de los enlaces relativos de una línea, resueltos desde la carpeta de la guía y sin su ancla. */
function rutasEnEnlaces(linea: string, carpeta: string): string[] {
  return [...linea.matchAll(ENLACE)]
    .map(([, destino = '']) => decodeURIComponent(destino.split('#')[0] ?? ''))
    .filter((ruta) => ruta !== '' && !ESQUEMA_DE_URL.test(ruta))
    .map((ruta) => posix.join(carpeta, ruta));
}

/** Las rutas citadas en una guía: código en línea con forma de ruta y enlaces relativos. */
function citasDe(archivo: string, texto: string, raiz: string): Cita[] {
  const carpeta = dirname(archivo);
  return lineasFueraDeBloques(texto).flatMap((contenido, indice) =>
    [...rutasEnCodigo(contenido, raiz, carpeta), ...rutasEnEnlaces(contenido, carpeta)].map((ruta) => ({
      archivo,
      linea: indice + 1,
      ruta,
    })),
  );
}

/** Si una cita apunta a algo del árbol, a una carpeta de la instalación o a una cita admitida sin existir. */
function existe(cita: Cita, raiz: string): boolean {
  if (CREADAS_POR_LA_INSTALACION.some((prefijo) => cita.ruta.startsWith(prefijo))) {
    return true;
  }
  if (PRIVADOS_FUERA_DE_GIT.includes(cita.ruta)) {
    return true;
  }
  if (CITADAS_SIN_EXISTIR.some(({ archivo, ruta }) => archivo === cita.archivo && ruta === cita.ruta)) {
    return true;
  }
  return existsSync(join(raiz, cita.ruta)) || existsSync(join(raiz, dirname(cita.archivo), cita.ruta));
}

/** Todas las citas de las guías de una raíz. */
function citasDeLasGuias(raiz: string): Cita[] {
  return guias(raiz).flatMap((guia) => citasDe(guia, readFileSync(join(raiz, guia), 'utf8'), raiz));
}

test('toda ruta citada en las guías de entrada existe en el árbol', () => {
  const rotas = citasDeLasGuias(RAIZ).filter((cita) => !existe(cita, RAIZ));
  const informe = rotas.map(({ archivo, linea, ruta }) => `  ${archivo}:${linea}: ${ruta}`).join('\n');
  assert.deepEqual(rotas, [], `Estas guías citan rutas que no existen; corrige la ruta o la frase:\n${informe}`);
});

test('cada ruta admitida sin existir sigue citada en su guía y sigue sin existir', () => {
  const citas = citasDeLasGuias(RAIZ);
  for (const { archivo, ruta, motivo } of CITADAS_SIN_EXISTIR) {
    assert.ok(
      citas.some((cita) => cita.archivo === archivo && cita.ruta === ruta),
      `${archivo} ya no cita ${ruta}: retírala de la lista (${motivo})`,
    );
    assert.ok(!existsSync(join(RAIZ, ruta)), `${ruta} ya existe: retírala de la lista (${motivo})`);
  }
});

test('la guardia reconoce rutas, enlaces y patrones, y deja fuera los bloques de código', () => {
  const texto = [
    'Lee `pruebas/ayudas/no-existe.py:12` y `docs/README.md`.',
    'Patrones como `motores/<motor>/pruebas/`, órdenes como `npm run verificar` y `datos/estado` no son rutas.',
    'Ver [la guía](../docs/arquitectura.md#glosario) y [la web](https://faroapp.org/).',
    '```sh',
    'cat `pruebas/dentro-de-un-bloque.ts`',
    '```',
  ].join('\n');
  const citas = citasDe('scripts/README.md', texto, RAIZ).map(({ linea, ruta }) => `${linea}:${ruta}`);
  assert.deepEqual(citas, ['1:pruebas/ayudas/no-existe.py', '1:docs/README.md', '3:docs/arquitectura.md']);
  const rotas = citasDe('scripts/README.md', texto, RAIZ).filter((cita) => !existe(cita, RAIZ));
  assert.deepEqual(
    rotas.map(({ ruta }) => ruta),
    ['pruebas/ayudas/no-existe.py'],
  );
});

test('un archivo privado fuera de Git puede faltar, como en el ciclo operativo; otro del paquete, no', () => {
  const sinPrivados = mkdtempSync(join(tmpdir(), 'rutas-citadas-'));
  try {
    const cita = (ruta: string): Cita => ({ archivo: 'README.md', linea: 1, ruta });
    assert.equal(existe(cita('datos/cambra.json'), sinPrivados), true);
    assert.equal(existe(cita('datos/exposicion-cambra.json'), sinPrivados), false);
  } finally {
    rmSync(sinPrivados, { recursive: true, force: true });
  }
});
