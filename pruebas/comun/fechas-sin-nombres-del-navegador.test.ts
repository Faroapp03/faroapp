// Guardia: fuera del módulo de fechas (src/comun/fechas.js y su copia en la web), el código del producto no pide al
// navegador nombres de meses o de días, patrones ni estilos de fecha, porque cada motor trae los suyos y escribiría la
// misma fecha de otra forma; tampoco tiene tablas propias de meses o de días, para que la web y el informe escriban
// igual. Las excepciones son nominales y dicen por qué no escriben nombres.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const CARPETAS = ['web/scripts', 'web/administracion', 'src', 'motores/cursos/src'];
const EXTENSIONES = /\.(?:js|mjs|ts)$/u;
/** El módulo y su copia publicada en la web (npm run comunes:generar). */
const MODULO_DE_FECHAS = ['src/comun/fechas.js', 'web/scripts/fechas.js'];

/** Lo que se cita de cada hallazgo. */
const LETRAS_DE_LA_MUESTRA = 80;
/** Los patrones se buscan en el código entero, sin sus comentarios: una clave y su valor pueden ir en líneas distintas. */
const PROHIBIDOS: readonly (readonly [string, RegExp])[] = [
  // Cualquier valor de «month» que no sea numérico: un nombre, una variable que podría serlo o la forma abreviada.
  ['un mes con nombre', /[{,]\s*month\s*(?::(?!\s*['"`](?:numeric|2-digit)['"`])|[,}])/u],
  ['el día de la semana', /[{,]\s*weekday\s*:/u],
  ['la era', /[{,]\s*era\s*:/u],
  ['un estilo de fecha', /\bdateStyle\b/u],
  ['un estilo de hora', /\btimeStyle\b/u],
  ['toLocaleDateString', /\.toLocaleDateString\s*\(/u],
  ['toLocaleTimeString', /\.toLocaleTimeString\s*\(/u],
  ['toLocaleString', /\.toLocaleString\s*\(/u],
  ['toDateString, toTimeString o toUTCString', /\.to(?:Date|Time|UTC|GMT)String\s*\(/u],
  ['una fecha convertida en texto', /\bnew\s+Date\s*\([^)]*\)\s*\.toString\s*\(|\bString\s*\(\s*new\s+Date\b/u],
  // Por su nombre, también con Intl['DateTimeFormat'], desestructurado o con las opciones esparcidas con «...».
  ['un formateador de fechas propio', /\bDateTimeFormat\b/u],
  ['un formateador de tiempo relativo o de duraciones', /\b(?:RelativeTimeFormat|DurationFormat)\b/u],
  ['un formateador de listas', /\bListFormat\b/u],
  ['nombres de idiomas del navegador', /\bDisplayNames\b/u],
  ['un formateador de números propio', /\bNumberFormat\b/u],
  ['Intl con corchetes', /\bIntl\s*\[/u],
  [
    'una tabla propia de meses o de días',
    /['"`](?:enero|febrero|marzo|mayo|junio|julio|agosto|septiembre|noviembre|diciembre|gener|febrer|març|maig|juny|juliol|agost|setembre|novembre|desembre|ene\.|sept?\.|dic\.|gen\.|febr\.|des\.|lunes|martes|miércoles|jueves|viernes|sábado|domingo|dilluns|dimarts|dimecres|dijous|divendres|dissabte|diumenge)['"`]/iu,
  ],
];

/** Lo que se permite fuera del módulo, por archivo y por motivo. */
const EXCEPCIONES: Readonly<Record<string, Readonly<{ usos: readonly string[]; motivo: string }>>> = {
  'web/scripts/datos-globales/comparacion.js': {
    usos: ['un formateador de listas'],
    motivo:
      'une nombres de territorios; la prueba de navegador (fechas.test.mjs, LISTAS) fija el mismo texto en los tres',
  },
};

/** @returns los archivos de código de una carpeta, con ruta relativa a la raíz. */
function archivos(carpeta: string): string[] {
  return readdirSync(join(RAIZ, carpeta), { recursive: true, withFileTypes: true })
    .filter((entrada) => entrada.isFile() && EXTENSIONES.test(entrada.name))
    .map((entrada) => relative(RAIZ, join(entrada.parentPath, entrada.name)).split('\\').join('/'));
}

/** Dónde termina la cadena que empieza en `inicio`; las de comillas simples o dobles no pasan de su línea. */
function finDeCadena(texto: string, inicio: number): number {
  const comilla = texto[inicio];
  for (let i = inicio + 1; i < texto.length; i++) {
    if (texto[i] === '\\') {
      i++;
    } else if (texto[i] === comilla || (comilla !== '`' && texto[i] === '\n')) {
      return i + 1;
    }
  }
  return texto.length;
}

/**
 * El código sin sus comentarios (la documentación puede nombrar lo que el código no usa). Recorre el texto: un «//» o un
 * «/*» dentro de una cadena («'/**'», «'/tareas/*​/texto'») es texto, no el principio de un comentario.
 */
function codigoSinComentarios(texto: string): string {
  let codigo = '';
  for (let i = 0; i < texto.length; ) {
    const [pieza, fin] = siguientePieza(texto, i, abreExpresionRegular(codigo));
    codigo += pieza;
    i = fin;
  }
  return codigo;
}

/**
 * Lo que puede ir justo antes de una expresión regular literal; tras un nombre, una cifra o un cierre, «/» divide.
 * Basta para que un «/[/*]/» o una comilla invertida dentro de una expresión regular no abran un comentario o una
 * cadena falsos.
 */
const ANTES_DE_EXPRESION_REGULAR = new Set([
  '',
  '(',
  ',',
  '=',
  ':',
  '[',
  '!',
  '&',
  '|',
  '?',
  '{',
  '}',
  ';',
  '+',
  '-',
  '*',
  '%',
  '<',
  '>',
  '~',
  '^',
]);

/** Lo que se mira del código ya recorrido para saber qué precede a una barra. */
const COLA_QUE_SE_MIRA = 64;
/** Las palabras clave tras las que una barra abre una expresión regular: `return /[/*]/u` no es una división. */
const PALABRAS_ANTES_DE_EXPRESION_REGULAR = new Set([
  'return',
  'typeof',
  'case',
  'throw',
  'void',
  'in',
  'of',
  'delete',
  'new',
  'else',
  'do',
]);

/** Si una barra que siguiera a `codigo` abriría una expresión regular: por el último signo o la última palabra. */
function abreExpresionRegular(codigo: string): boolean {
  // Basta con el final: mirar el código entero a cada paso haría la guardia cuadrática.
  const previo = codigo.slice(-COLA_QUE_SE_MIRA).trimEnd();
  const palabra = /[A-Za-z_$][\w$]*$/u.exec(previo)?.[0];
  if (palabra) {
    return PALABRAS_ANTES_DE_EXPRESION_REGULAR.has(palabra);
  }
  return ANTES_DE_EXPRESION_REGULAR.has(previo.at(-1) ?? '');
}

/** Dónde termina la expresión regular literal que empieza en `inicio`, con su clase de caracteres y sus escapes. */
function finDeExpresionRegular(texto: string, inicio: number): number {
  let enClase = false;
  for (let i = inicio + 1; i < texto.length && texto[i] !== '\n'; i++) {
    const letra = texto[i];
    if (letra === '\\') {
      i++;
    } else if (letra === '[' || letra === ']') {
      enClase = letra === '[';
    } else if (letra === '/' && !enClase) {
      return i + 1;
    }
  }
  return inicio + 1;
}

/**
 * La pieza que empieza en `i` y dónde acaba: un comentario se cambia por nada (o un espacio); una cadena y una
 * expresión regular literal se copian enteras. `abreExpresion` dice si una barra en `i` abriría una.
 */
function siguientePieza(texto: string, i: number, abreExpresion: boolean): [string, number] {
  const par = texto.slice(i, i + 2);
  if (par === '//') {
    const fin = texto.indexOf('\n', i);
    return ['', fin < 0 ? texto.length : fin];
  }
  if (par === '/*') {
    const fin = texto.indexOf('*/', i + 2);
    return [' ', fin < 0 ? texto.length : fin + 2];
  }
  if (['"', "'", '`'].includes(texto[i] ?? '')) {
    const fin = finDeCadena(texto, i);
    return [texto.slice(i, fin), fin];
  }
  if (texto[i] === '/' && abreExpresion) {
    const fin = finDeExpresionRegular(texto, i);
    return [texto.slice(i, fin), fin];
  }
  return [texto[i] ?? '', i + 1];
}

/** Los usos prohibidos de cada archivo, sin las excepciones. */
function usosProhibidos(): string[] {
  const hallados: string[] = [];
  for (const archivo of CARPETAS.flatMap(archivos)) {
    if (MODULO_DE_FECHAS.includes(archivo)) {
      continue;
    }
    const permitidos = EXCEPCIONES[archivo]?.usos ?? [];
    const codigo = codigoSinComentarios(readFileSync(join(RAIZ, archivo), 'utf8'));
    for (const [uso, patron] of PROHIBIDOS) {
      const hallado = patron.exec(codigo);
      if (hallado && !permitidos.includes(uso)) {
        hallados.push(
          `${archivo}: ${uso} («${codigo.slice(hallado.index, hallado.index + LETRAS_DE_LA_MUESTRA).replace(/\s+/gu, ' ')}»)`,
        );
      }
    }
  }
  return hallados;
}

test('fuera del módulo de fechas, nadie pide al navegador nombres, patrones ni estilos de fecha', () => {
  assert.deepEqual(usosProhibidos(), []);
});

test('cada excepción sigue haciendo falta: si su uso desaparece, se retira de la lista', () => {
  for (const [archivo, { usos }] of Object.entries(EXCEPCIONES)) {
    const codigo = codigoSinComentarios(readFileSync(join(RAIZ, archivo), 'utf8'));
    for (const uso of usos) {
      const patron = PROHIBIDOS.find(([nombre]) => nombre === uso)?.[1];
      assert.ok(patron?.test(codigo), `${archivo} ya no usa ${uso}`);
    }
  }
});

test('un «/*» o un «//» dentro de una cadena no esconde el código que lo sigue', () => {
  const codigo = codigoSinComentarios(
    "const patron = '/**';\nconst ruta = '/tareas/*/texto';\nconst opciones = { month: 'short' }; // fin\n/* nota */ x();",
  );
  assert.match(codigo, /\{ month: 'short' \}/u);
  assert.doesNotMatch(codigo, /fin|nota/u);
  assert.match(codigo, /'\/\*\*'/u);
  const prohibido = PROHIBIDOS.find(([uso]) => uso === 'un mes con nombre')?.[1];
  assert.ok(prohibido?.test(codigo));
  assert.ok(prohibido?.test('const o = { month };'));
  assert.ok(prohibido?.test('const o = { year: 1, month,\n day: 2 };'));
  assert.ok(!prohibido?.test("const o = { month: '2-digit' };"));
});

/** Los diccionarios de la web y del informe, y las páginas de la web con su copia escrita en el HTML. */
const PLANTILLAS = ['web/idiomas', 'herramientas/web/lecturas.ts', 'src/presentacion/informe-breve/idioma.ts'];
const PAGINAS = /^[^/]+\.html$/u;
/**
 * Un artículo o una preposición con artículo («el», «al», «del», «l’», «a l’», «de l’»), con mayúscula o sin ella,
 * justo delante de una fecha: del hueco `{fecha}` de una plantilla o de una fecha en cifras D/M/AAAA, con o sin cero
 * delante, sola o dentro de un `<time>`, con cualquier espacio o salto de línea entre medias. No mira los huecos
 * numerados (`{0}`): también llevan años, teléfonos o cifras, que sí van con artículo («el 2024», «truca al {0}»).
 */
const ARTICULO_ANTE_FECHA =
  /(?:\b(?:el|al|del)\s+|(?:\b(?:a|de)\s+)?l’\s*)(?:\{fecha\}|(?:<time[^>]*>\s*)?\d{1,2}\/\d{1,2}\/\d{4})/giu;
function calendarioDeEmpresas(): string {
  const empresas = JSON.parse(readFileSync(join(RAIZ, 'datos/empresas.json'), 'utf8'));
  const fragmento = empresas.vigencia.calendario.match(/consultado el \d{1,2}\/\d{1,2}\/\d{4}/u)?.[0];
  assert.ok(fragmento);
  return fragmento;
}

function consultaDelCenso(): string {
  const sectores = JSON.parse(readFileSync(join(RAIZ, 'datos/sectores.json'), 'utf8'));
  const fragmento = sectores.fuente.match(/Consulta del \d{1,2}\/\d{1,2}\/\d{4}/u)?.[0];
  assert.ok(fragmento);
  return fragmento;
}

/**
 * Fechas con artículo que no escribe esta parte de Faro, admitidas por su fragmento hasta que cambie su origen:
 * - dos notas del paquete de datos que el informe de ejemplo copia tal cual (datos/empresas.json y el censo), de
 *   plataforma_datos/mercado (empresas/piezas/cifras_empresas.py y censo/lector.py);
 * - textos de Biblioteca que vienen de su catálogo (plataforma_datos/biblioteca/fuentes/lecturas/catalogo.json, por
 *   datos/lecturas.json): «revisada el 7/10/2026» y «desde el 2/8/2026»;
 * - la cita literal de la licencia de acceso abierto de la OIT en Créditos («desde el 3/5/2023»), igual que en
 *   plataforma_datos/derivados/fuentes/datos_globales/piezas/constantes_datos_globales.py.
 */
const FECHAS_AJENAS: readonly (readonly [string, string])[] = [
  ['web/informe-ejemplo.html', calendarioDeEmpresas()],
  ['web/informe-ejemplo.html', consultaDelCenso()],
  ['web/idiomas/es/lecturas.js', 'revisada el 7/10/2026'],
  ['web/idiomas/es/lecturas.js', 'desde el 2/8/2026'],
  ['web/idiomas/ca/lecturas.js', 'revisada el 7/10/2026'],
  ['web/idiomas/ca/lecturas.js', 'des del 2/8/2026'],
  ['web/biblioteca.html', 'revisada el 7/10/2026'],
  ['web/biblioteca.html', 'desde el 2/8/2026'],
  ['web/creditos.html', 'desde el 3/5/2023'],
  ['web/idiomas/es/creditos-datos-globales.js', 'desde el 3/5/2023'],
  ['web/idiomas/ca/creditos-datos-globales.js', 'des del 3/5/2023'],
];

/** Cada artículo ante una fecha de `ruta`, con lo que lo rodea. */
function articulosAnteFecha(ruta: string): string[] {
  const texto = readFileSync(join(RAIZ, ruta), 'utf8');
  return [...texto.matchAll(ARTICULO_ANTE_FECHA)]
    .map(({ index }) =>
      texto.slice(Math.max(0, index - LETRAS_DE_CONTEXTO), index + LETRAS_DE_LA_MUESTRA).replace(/\s+/gu, ' '),
    )
    .filter((muestra) => !FECHAS_AJENAS.some(([archivo, fragmento]) => archivo === ruta && muestra.includes(fragmento)))
    .map((muestra) => `${ruta}: ${muestra}`);
}
const LETRAS_DE_CONTEXTO = 30;

test('ninguna plantilla ni página pone artículo delante de una fecha: en cifras va tras dos puntos', () => {
  const diccionarios = PLANTILLAS.flatMap((ruta) => (EXTENSIONES.test(ruta) ? [ruta] : archivos(ruta)));
  const paginas = readdirSync(join(RAIZ, 'web'))
    .filter((nombre) => PAGINAS.test(nombre))
    .map((nombre) => `web/${nombre}`);
  assert.deepEqual([...diccionarios, ...paginas].flatMap(articulosAnteFecha), []);
});

test('cada fecha ajena sigue en el producto: la que desaparece se retira de la lista', () => {
  for (const [ruta, fragmento] of FECHAS_AJENAS) {
    const texto = readFileSync(join(RAIZ, ruta), 'utf8').replace(/\s+/gu, ' ');
    assert.ok(texto.includes(fragmento), `${ruta} ya no tiene «${fragmento}»`);
  }
});

test('la guardia de plantillas ve el artículo ante una fecha en cifras aunque haya un <time> y un salto de línea', () => {
  const casos = [
    'Actualizada el\n  <time datetime="2026-06-15">15/06/2026</time>',
    'Comprovat l’01/10/2026',
    'del {fecha}',
    'El 05/06/2026',
    'Del 01/10/2026',
    'fins al 1/10/2026',
    'De l’1/1/2027',
  ];
  for (const caso of casos) {
    assert.ok(caso.match(ARTICULO_ANTE_FECHA), caso);
  }
  assert.equal('Actualización: <time>15/06/2026</time> · el 2024 · truca al {0}'.match(ARTICULO_ANTE_FECHA), null);
});

test('una expresión regular literal no abre un comentario ni una cadena falsos', () => {
  const codigo = codigoSinComentarios(
    "const barra = /[/*]/u;\nconst tilde = /`/u;\nconst opciones = { month: 'long' };\nconst mitad = total / 2; // nota */\nfunction f() {\n  return /[/*]/u;\n}\nconst otra = { weekday: 'short' }; // */",
  );
  assert.match(codigo, /\{ month: 'long' \}/u);
  assert.match(codigo, /\{ weekday: 'short' \}/u);
  assert.match(codigo, /return \/\[\/\*\]\/u;/u);
  assert.match(codigo, /total \/ 2;/u);
  assert.doesNotMatch(codigo, /nota/u);
});
