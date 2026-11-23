// La VERSION del service worker publicado se lee en el navegador con una sola expresión (web/scripts/version-del-servicio.js):
// la usan el doctor y los ensayos de navegador, y la barrera de versión, que es un guion clásico, lleva una copia
// idéntica. Se prueba contra el web/service-worker.js real y contra el que escribe la construcción, no contra textos
// escritos a mano, y se ata a lineaDelValor para que la escritura y la lectura no puedan separarse.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  lineaDelValor,
  servicioConValores,
  type ValoresDelServicio,
  valoresDelServicio,
} from '../../herramientas/web/servicio/servicio-publicado.ts';
import { comprobarTodo } from '../../web/scripts/doctor/comprobaciones.js';
import { LINEA_DE_LA_VERSION, versionDelServicio } from '../../web/scripts/version-del-servicio.js';
import { servicioPublicado, webConstruida } from '../ayudas/web-construida.ts';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const FUENTE_DE_LA_BARRERA = join(RAIZ, 'web/scripts/barrera-version.js');
const CONSTRUIDOS = join(webConstruida(), 'scripts');
const PUBLICADO = servicioPublicado();
const VALORES = valoresDelServicio(PUBLICADO);
const OTRA = '0123456789abcdef';
const BASE = 'https://faroapp.org/';
/** La expresión que lee la VERSION dentro de la barrera: el literal que recibe `texto.matchAll(…)`. */
const EN_LA_BARRERA = /texto\.matchAll\((\/.+\/[a-z]*)\)\]/u;

/** La fuente de la barrera y su copia con la huella en el nombre en la web construida, la que cargan las páginas. */
function barreras(): string[] {
  const generadas = readdirSync(CONSTRUIDOS).filter((nombre) => /^barrera-[a-f0-9]{64}\.js$/u.test(nombre));
  assert.equal(generadas.length, 1, 'una sola barrera con huella');
  return [FUENTE_DE_LA_BARRERA, ...generadas.map((nombre) => join(CONSTRUIDOS, nombre))];
}

/** La expresión que usa una barrera, tal como está escrita y ya construida. */
function expresionDeLaBarrera(nombre: string): { literal: string; expresion: RegExp } {
  const literal = EN_LA_BARRERA.exec(readFileSync(nombre, 'utf8'))?.[1];
  assert.ok(literal, `${nombre} lee la VERSION con matchAll`);
  const partes = /^\/(.+)\/([a-z]*)$/u.exec(literal);
  assert.ok(partes?.[1] !== undefined && partes[2] !== undefined);
  return { literal, expresion: new RegExp(partes[1], partes[2]) };
}

/** La versión que da la barrera: la misma condición que versionEnRed (una sola línea y su valor). */
function versionDeLaBarrera(expresion: RegExp, texto: string): string | undefined {
  const versiones = [...texto.matchAll(expresion)];
  const version = versiones[0]?.[1] ?? versiones[0]?.[2];
  return versiones.length === 1 ? version : undefined;
}

/** El navegador de mentira del doctor: sirve el service worker dado y tiene instalada la copia de `instalada`. */
function entorno(servicio: string, instalada: string) {
  return {
    fetch: async (direccion: string) =>
      direccion === '/api/salud'
        ? new Response(JSON.stringify({ estado: 'ok', version: '1.0.0', interruptores: {} }), { status: 200 })
        : new Response(servicio, { status: 200 }),
    caches: { keys: async () => [`faro:${BASE}:${instalada}`] },
    location: { href: `${BASE}doctor.html` },
    enLinea: true,
    idiomaNavegador: 'es-ES',
    controlada: true,
    estimarEspacio: async () => null,
    funciones: Object.fromEntries(
      ['fetch', 'AbortController', 'TextEncoder', 'URL', 'Intl', 'serviceWorker', 'caches', 'localStorage'].map(
        (nombre) => [nombre, true],
      ),
    ),
  };
}

/** La copia según el doctor, con el service worker publicado dado. */
async function copiaSegunElDoctor(servicio: string, instalada: string) {
  const hecho = await comprobarTodo(entorno(servicio, instalada) as never, 'es');
  const copia = hecho.resultados.find(({ id }: { id: string }) => id === 'copia');
  assert.ok(copia);
  return [copia.semaforo, copia.caso, copia.valores];
}

test('La VERSION del service worker publicado se lee con la definición única del navegador', () => {
  assert.match(VALORES.VERSION, /^[a-f0-9]{16}$/u);
  assert.equal(versionDelServicio(PUBLICADO), VALORES.VERSION);
});

test('La barrera y su copia con huella leen la VERSION con la misma expresión que la definición única', () => {
  for (const nombre of barreras()) {
    const { literal, expresion } = expresionDeLaBarrera(nombre);
    assert.equal(literal, String(LINEA_DE_LA_VERSION), `${nombre} lleva la expresión de version-del-servicio.js`);
    assert.equal(versionDeLaBarrera(expresion, PUBLICADO), VALORES.VERSION, `${nombre} lee el service worker real`);
  }
});

test('El doctor compara la copia instalada con la VERSION del service worker real', async () => {
  assert.deepEqual(await copiaSegunElDoctor(PUBLICADO, VALORES.VERSION), [
    'bien',
    'al-dia',
    { instalada: VALORES.VERSION },
  ]);
  const [semaforo, caso] = await copiaSegunElDoctor(PUBLICADO, OTRA);
  assert.deepEqual([semaforo, caso], ['atencion', 'anterior']);
});

test('Lo que escribe la construcción (lineaDelValor) y lo que lee el navegador son la misma línea', async () => {
  const valores: ValoresDelServicio = { ...VALORES, VERSION: OTRA };
  const construido = await servicioConValores(valores);
  for (const texto of [PUBLICADO, construido]) {
    const escritas = [...texto.matchAll(lineaDelValor('VERSION'))];
    const leidas = [...texto.matchAll(LINEA_DE_LA_VERSION)];
    assert.equal(escritas.length, 1);
    assert.equal(leidas.length, 1);
    assert.equal(leidas[0]?.index, escritas[0]?.index);
    assert.equal(leidas[0]?.[0], escritas[0]?.[0]);
    assert.equal(versionDelServicio(texto), JSON.parse(escritas[0]?.[1] ?? 'null'));
  }
  assert.equal(versionDelServicio(construido), OTRA);
  const { expresion } = expresionDeLaBarrera(FUENTE_DE_LA_BARRERA);
  assert.equal(versionDeLaBarrera(expresion, construido), OTRA);
});

test('La lectura admite var, let y const con las dos comillas, y solo una VERSION hexadecimal en su línea', () => {
  for (const linea of [`var VERSION = "${OTRA}";`, `let VERSION = '${OTRA}';`, `const VERSION = '${OTRA}';`]) {
    assert.equal(versionDelServicio(`// …\n${linea}\nself;\n`), OTRA, linea);
  }
  for (const texto of [
    `var VERSION = "${OTRA.toUpperCase()}";`,
    `var VERSION = "${OTRA.slice(1)}";`,
    `var VERSION = "${OTRA}'; `,
    `  var VERSION = "${OTRA}";`,
    `var VERSION = "${OTRA}"; // otra`,
    `x = 1; var VERSION = "${OTRA}";`,
    `var VERSION = \`${OTRA}\`;`,
    `var VERSION = "${OTRA}";\nvar VERSION = "${OTRA}";`,
    '',
  ]) {
    assert.equal(versionDelServicio(texto), null, texto);
  }
});

test('Ningún lector del service worker publicado vuelve a la expresión antigua de su VERSION', () => {
  const antigua = ["const VERSION = '([", "const VERSION = \\'(["];
  const carpetas = ['web/scripts', 'pruebas/navegadores', 'herramientas'];
  const archivos = carpetas.flatMap((carpeta) =>
    readdirSync(join(RAIZ, carpeta), { recursive: true, encoding: 'utf8' })
      .filter((nombre) => /\.(?:js|mjs|ts)$/u.test(nombre))
      .map((nombre) => join(carpeta, nombre)),
  );
  assert.ok(archivos.length > 10);
  for (const archivo of archivos) {
    const texto = readFileSync(join(RAIZ, archivo), 'utf8');
    for (const forma of antigua) {
      assert.equal(texto.includes(forma), false, `${archivo} lee la VERSION con la expresión antigua`);
    }
  }
});
