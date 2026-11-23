// El CLI real prepara sus tres recursos antes de publicarlos. La copia de prueba sustituye únicamente tres SHA
// fijadas por las de originales sintéticos pequeños; no se modifica ningún flujo ni se depende de insumos externos.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const RAIZ = new URL('../../', import.meta.url);
const NUMERO_DE_ORIGINALES = 3;
const PERMISOS_EJECUTABLE = 0o755;
const RECURSOS = ['fronteras.json', 'tierra.jpg', 'procedencia.json'] as const;
const ORIGINAL_POR_ARCHIVO = {
  'world.topo.bathy.200407.3x5400x2700.jpg': '4f4240673a3a1b173d61b92ca4b07bac5fd17059ea5f725ba6da5a9c5386b7ba',
  'ne_110m_admin_0_countries.geojson': '6866c877d39cba9c357620878839b336d569f8c662d3cfab4cb1dbe2d39c977f',
  'ne_10m_admin_1_states_provinces.geojson': '22d0e3ad85eb3e27f17cabf8ba2d50e554fbc27a87796ff891d958185da62fb5',
} as const;
const CLAUSURA = [
  'package.json',
  'biome.json',
  'herramientas/comun/archivos.ts',
  'herramientas/comun/opciones.ts',
  'herramientas/web/geometria-del-globo.ts',
  'src/comun/orden.js',
  'web/scripts/globo/fronteras.js',
  'web/scripts/globo/esfera.js',
  'web/scripts/json.js',
];

function poligono(x: number, y: number) {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [x, y],
        [x + 1, y],
        [x + 1, y + 1],
        [x, y + 1],
        [x, y],
      ],
    ],
  };
}

function originalesSinteticos() {
  return {
    'world.topo.bathy.200407.3x5400x2700.jpg': 'textura de prueba: no se decodifica porque ffmpeg falla',
    'ne_110m_admin_0_countries.geojson': JSON.stringify({
      type: 'FeatureCollection',
      features: [{ properties: { ISO_A3_EH: 'ESP', LABEL_X: 0, LABEL_Y: 0 }, geometry: poligono(0, 0) }],
    }),
    'ne_10m_admin_1_states_provinces.geojson': JSON.stringify({
      type: 'FeatureCollection',
      features: ['ES-B', 'ES-GI', 'ES-L', 'ES-T'].map((codigo, i) => ({
        properties: { iso_3166_2: codigo },
        geometry: poligono(i % 2, Math.floor(i / 2)),
      })),
    }),
  };
}

function constructorSintetico(originales: ReturnType<typeof originalesSinteticos>) {
  let fuente = readFileSync(new URL('herramientas/web/traer-globo.ts', RAIZ), 'utf8');
  let sustituciones = 0;
  for (const [archivo, original] of Object.entries(ORIGINAL_POR_ARCHIVO)) {
    assert.equal(fuente.split(original).length - 1, 1, `una única SHA original de ${archivo}`);
    const nueva = createHash('sha256')
      .update(originales[archivo as keyof typeof originales])
      .digest('hex');
    fuente = fuente.replace(original, nueva);
    sustituciones++;
  }
  assert.equal(sustituciones, NUMERO_DE_ORIGINALES, 'se sustituyen exactamente tres constantes SHA; ningún flujo');
  return fuente;
}

function preparar(t: TestContext) {
  const temporal = mkdtempSync(join(tmpdir(), 'globo-publicacion-'));
  t.after(() => rmSync(temporal, { recursive: true, force: true }));
  const copia = join(temporal, 'Mis documentos', 'Año 2026');
  for (const archivo of CLAUSURA) {
    const destino = join(copia, archivo);
    mkdirSync(dirname(destino), { recursive: true });
    copyFileSync(new URL(archivo, RAIZ), destino);
  }
  symlinkSync(fileURLToPath(new URL('node_modules', RAIZ)), join(copia, 'node_modules'), 'dir');
  const originales = join(temporal, 'originales');
  mkdirSync(originales);
  const contenido = originalesSinteticos();
  for (const [nombre, texto] of Object.entries(contenido)) {
    writeFileSync(join(originales, nombre), texto);
  }
  writeFileSync(join(copia, 'herramientas/web/traer-globo.ts'), constructorSintetico(contenido));
  const salida = join(copia, 'web/recursos/globo');
  mkdirSync(salida, { recursive: true });
  for (const nombre of RECURSOS) {
    writeFileSync(join(salida, nombre), `bytes anteriores de ${nombre}\n`);
  }
  return { temporal, copia, originales, salida };
}

function ejecutarEn(ensayo: ReturnType<typeof preparar>) {
  const bin = join(ensayo.temporal, 'bin');
  const staging = join(ensayo.temporal, 'staging');
  mkdirSync(bin);
  mkdirSync(staging);
  const ffmpeg = join(bin, 'ffmpeg');
  writeFileSync(
    ffmpeg,
    '#!/bin/sh\nfor destino do :; done\nprintf parcial > "$destino"\necho "ffmpeg rechazado en prueba" >&2\nexit 17\n',
  );
  chmodSync(ffmpeg, PERMISOS_EJECUTABLE);
  const resultado = spawnSync(
    process.execPath,
    [join(ensayo.copia, 'herramientas/web/traer-globo.ts'), '--originales', ensayo.originales],
    {
      cwd: ensayo.copia,
      encoding: 'utf8',
      timeout: 30_000,
      env: { PATH: `${bin}:${process.env.PATH ?? ''}`, TMPDIR: staging },
    },
  );
  assert.equal(resultado.error, undefined);
  assert.equal(resultado.status, 1);
  assert.deepEqual(readdirSync(staging), [], 'se elimina staging incluso si ffmpeg escribió parcialmente');
  return resultado;
}

function comprobarAnteriores(salida: string) {
  for (const nombre of RECURSOS) {
    assert.equal(readFileSync(join(salida, nombre), 'utf8'), `bytes anteriores de ${nombre}\n`, nombre);
  }
  assert.deepEqual(readdirSync(salida).sort(), [...RECURSOS].sort());
}

test('un original inválido conserva los tres recursos previos y no deja staging', (t) => {
  const ensayo = preparar(t);
  writeFileSync(join(ensayo.originales, 'world.topo.bathy.200407.3x5400x2700.jpg'), 'original incorrecto');
  const resultado = ejecutarEn(ensayo);
  assert.match(resultado.stderr, /su SHA-256 es .* y se esperaba/);
  comprobarAnteriores(ensayo.salida);
});

test('un fallo ffmpeg conserva los tres recursos previos y elimina su salida parcial de staging', (t) => {
  const ensayo = preparar(t);
  const resultado = ejecutarEn(ensayo);
  assert.match(resultado.stderr, /ffmpeg rechazado en prueba/);
  comprobarAnteriores(ensayo.salida);
});
