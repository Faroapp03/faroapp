import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import {
  comprobarServicio,
  construirServicio,
  declaracionesDeNivelSuperior,
  type Generado,
  NOMBRES_DEL_AMBITO_GLOBAL,
  ServicioNoConstruible,
} from '../../herramientas/web/servicio/construir-servicio.ts';
import { servicioConValores } from '../../herramientas/web/servicio/servicio-publicado.ts';
import { servicioPublicado } from '../ayudas/web-construida.ts';

const FIXTURE = fileURLToPath(new URL('./fixture/', import.meta.url));
const LIMPIO = `${FIXTURE}limpio/`;
const CHOQUE = `${FIXTURE}choque/`;

const VALORES = {
  VERSION: 'bbb1b6f6ed1bb7ca',
  PAQUETE: 'b1a5ce9ca7a9077c',
  TAMANOS_DEL_PAQUETE: '{"esco.json":5652419}',
  FIRMAS: [['datos/a.json', 'e18bcb42b86ffc36']],
  ARCHIVOS: ['index.html', 'estilos/base.css'],
};
const GENERADO: Generado = { plantilla: `${LIMPIO}generado.js`, valores: VALORES };

const sha256 = (texto: string) => createHash('sha256').update(texto).digest('hex');
const construirLimpio = () => construirServicio(`${LIMPIO}servicio.js`, GENERADO);

describe('conducta de esbuild al construir el service worker', () => {
  it('esbuild pasa const, let y class de nivel superior a var y conserva function y los nombres únicos', async () => {
    const texto = await construirLimpio();
    assert.deepEqual(
      declaracionesDeNivelSuperior(texto, 'script').map(({ forma, nombre }) => `${forma} ${nombre}`),
      [
        'var VERSION',
        'var PAQUETE',
        'var TAMANOS_DEL_PAQUETE',
        'var FIRMAS',
        'var ARCHIVOS',
        'var PREFIJO',
        'var contador',
        'var HuellaQueNoCoincide',
        'function sumar',
        'var SIN_USO',
        'var COPIA',
        'var ultimaFirma',
        'var Copia',
        'function tamanos',
      ],
    );
    assert.match(texto, /^var HuellaQueNoCoincide = class extends Error \{/m);
    assert.match(texto, /^var Copia = class \{/m);
  });

  it('esbuild renombra un nombre repetido entre módulos y la construcción lo rechaza', async () => {
    const directo = await build({
      bundle: true,
      format: 'esm',
      target: 'esnext',
      write: false,
      logLevel: 'silent',
      entryPoints: [`${CHOQUE}servicio.js`],
      outfile: 'service-worker.js',
    });
    assert.match(directo.outputFiles[0]?.text ?? '', /^var cifra2 = 2;$/m);
    await assert.rejects(
      construirServicio(`${CHOQUE}servicio.js`, { plantilla: `${CHOQUE}generado.js`, valores: { VERSION: 'x' } }),
      (error: Error) =>
        error instanceof ServicioNoConstruible &&
        error.message.includes('repetidas entre módulos [var cifra]') &&
        error.message.includes('nuevas [var cifra2]'),
    );
  });
});

describe('salida del service worker construido', () => {
  it('sin poda: una exportación que nadie importa llega a la salida', async () => {
    assert.match(await construirLimpio(), /^var SIN_USO = "llega aunque nadie lo importe";$/m);
  });

  it('da un guion clásico sin comentarios, que se ejecuta y registra sus oyentes', async () => {
    const texto = await construirLimpio();
    assert.doesNotMatch(texto, /\/\/|\/\*/);
    const oyentes: string[] = [];
    const contexto = { self: { addEventListener: (tipo: string) => oyentes.push(tipo) }, Error, JSON };
    runInNewContext(texto, contexto);
    assert.deepEqual(oyentes, ['install']);
    assert.equal((contexto as unknown as Record<string, unknown>).COPIA, 'faro:bbb1b6f6ed1bb7ca:b1a5ce9ca7a9077c');
  });

  it('es determinista: dos construcciones seguidas dan la misma sha256', async () => {
    assert.equal(sha256(await construirLimpio()), sha256(await construirLimpio()));
  });
});

describe('plantilla de lo generado', () => {
  it('sustituye la plantilla de lo generado por los valores reales sin tocarla en el disco', async () => {
    const antes = sha256(readFileSync(GENERADO.plantilla, 'utf8'));
    const texto = await construirLimpio();
    assert.equal(sha256(readFileSync(GENERADO.plantilla, 'utf8')), antes);
    assert.match(texto, /^var VERSION = "bbb1b6f6ed1bb7ca";$/m);
    assert.match(texto, /^var PAQUETE = "b1a5ce9ca7a9077c";$/m);
    assert.match(texto, /^var TAMANOS_DEL_PAQUETE = '\{"esco\.json":5652419\}';$/m);
    assert.match(texto, /^var FIRMAS = \[\["datos\/a\.json", "e18bcb42b86ffc36"\]\];$/m);
    assert.match(texto, /^var ARCHIVOS = \["index\.html", "estilos\/base\.css"\];$/m);
  });

  it('rechaza valores que no coinciden con la plantilla', async () => {
    const { ARCHIVOS: _, ...sinArchivos } = VALORES;
    await assert.rejects(
      construirServicio(`${LIMPIO}servicio.js`, {
        plantilla: GENERADO.plantilla,
        valores: { ...sinArchivos, OTRO: 1 },
      }),
      /faltan \[ARCHIVOS\], sobran \[OTRO\]/,
    );
  });
});

describe('guardias del service worker construido', () => {
  it('en verde con un service worker limpio', async () => {
    assert.doesNotThrow(() => comprobarServicio('const COPIA = 1;\nself.addEventListener("fetch", () => COPIA);\n'));
    comprobarServicio(await construirLimpio());
  });

  const PROHIBIDOS: readonly (readonly [string, string, RegExp])[] = [
    ['importScripts', 'importScripts("archivos.js");', /carga guiones con importScripts/],
    ['self.importScripts', 'self.importScripts("archivos.js");', /carga guiones con importScripts/],
    ['eval', 'eval("1");', /evalúa texto con eval/],
    ['eval indirecto', 'globalThis["eval"]("1");', /evalúa texto con eval/],
    ['new Function', 'new Function("return 1");', /construye código con Function/],
    ['Function', 'Function("return 1")();', /construye código con Function/],
    ['createPolicy', 'trustedTypes.createPolicy("faro", {});', /crea una política de Trusted Types/],
    ['import', 'import { a } from "./a.js";\na;', /importa un módulo/],
    ['import dinámico', 'import("./a.js");', /importa un módulo/],
    ['import.meta', 'const a = import.meta.url;', /importa un módulo/],
    ['export', 'export const a = 1;', /exporta un nombre/],
    ['const global', 'const caches = 1;', /declara «caches», que ya es del ámbito global del Worker/],
    ['var global', 'var location = 1;', /declara «location», que ya es del ámbito global del Worker/],
    ['function global', 'function fetch() {}', /declara «fetch», que ya es del ámbito global del Worker/],
    ['class global', 'class Response {}', /declara «Response», que ya es del ámbito global del Worker/],
    ['desestructuración', 'const { self: a, clients } = {};', /declara «clients»/],
  ];
  for (const [caso, texto, mensaje] of PROHIBIDOS) {
    it(`en rojo con ${caso}`, () => {
      assert.throws(
        () => comprobarServicio(texto),
        (error: Error) => error instanceof ServicioNoConstruible && mensaje.test(error.message),
      );
    });
  }
});

describe('líneas con solo espacios', () => {
  const SOLO_ESPACIOS = /^[ \t]+$/mu;

  it('ni el web/service-worker.js publicado ni el construido tienen líneas con solo espacios', async () => {
    const publicado = servicioPublicado();
    for (const texto of [publicado, await servicioConValores()]) {
      assert.doesNotMatch(texto, SOLO_ESPACIOS);
    }
  });

  it('quitarlas es determinista y no cambia el código: misma salida que con el fixture construido dos veces', async () => {
    const [una, otra] = await Promise.all([construirLimpio(), construirLimpio()]);
    assert.equal(una, otra);
    assert.doesNotMatch(una, SOLO_ESPACIOS);
  });

  it('rechaza quitarlas si están dentro de una cadena de plantilla', async () => {
    const carpeta = mkdtempSync(join(tmpdir(), 'faro-solo-espacios-'));
    const entrada = join(carpeta, 'servicio.js');
    writeFileSync(
      entrada,
      `import { VERSION } from ${JSON.stringify(`${LIMPIO}generado.js`)};\n` +
        "self.addEventListener('install', () => [VERSION, `a\n  \nb`]);\n",
    );
    await assert.rejects(
      construirServicio(entrada, GENERADO),
      (error: Error) => error instanceof ServicioNoConstruible && /líneas con solo espacios/u.test(error.message),
    );
  });
});

describe('atributos de evento del ámbito del service worker', () => {
  const ATRIBUTOS = [
    'onmessageerror',
    'onperiodicsync',
    'onsync',
    'onpush',
    'onpushsubscriptionchange',
    'onnotificationclick',
    'onnotificationclose',
    'oncookiechange',
    'onbackgroundfetchclick',
    'oncontentdelete',
    'onlanguagechange',
    'onrejectionhandled',
  ];
  for (const nombre of ATRIBUTOS) {
    it(`en rojo con var ${nombre}`, () => {
      assert.ok(NOMBRES_DEL_AMBITO_GLOBAL.has(nombre));
      assert.throws(
        () => comprobarServicio(`var ${nombre} = null;`),
        (error: Error) => error instanceof ServicioNoConstruible && error.message.includes(`«${nombre}»`),
      );
    });
  }
});
