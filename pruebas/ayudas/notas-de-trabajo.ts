/**
 * Busca notas de trabajo en el producto. Las notas de trabajo y las tareas abiertas viven en Desarrollo; el producto
 * solo explica cómo está organizado y cómo funciona. En el código se leen los comentarios y los docstrings, y en JS y
 * TS también las cadenas y plantillas fuera de las pruebas (sus cadenas son entradas sintéticas); los documentos y la
 * configuración se leen enteros. Las fechas con hora de trabajo solo cuentan en comentarios y docstrings: en datos y
 * documentos de procedencia son fechas de consulta. El lector de JS y TS distingue comentarios, cadenas, plantillas y
 * expresiones regulares.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';

/**
 * Marcadores de nota, como palabra entera y en mayúsculas, con la forma de una nota: al principio de la línea del
 * comentario o seguidos de dos puntos o de un paréntesis. Una mención dentro de una frase, como el nombre de una
 * constante o de un estado del ejecutor de pruebas, no es una nota. Se escriben partidos para que este archivo no se
 * señale a sí mismo.
 */
const NOMBRES = ['TO' + 'DO', 'FIX' + 'ME', 'X' + 'XX', 'HA' + 'CK'].join('|');
const MARCADORES = new RegExp(`^(?:\\s|/|\\*|#|<!--|-)*(?:${NOMBRES})\\b|\\b(?:${NOMBRES})\\s*[:(]`, 'u');
const PENDIENTE = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${'Pendiente'}|${'PENDIENTE'}):`, 'u');
/**
 * Notas de revisión escritas en prosa, también dentro de cadenas de JSON (los marcadores, en REVISION): un pendiente
 * con mayúscula seguido de «de», una revisión, verificación o cotejo pendientes, una verificación por hacer, una cita
 * hecha de memoria y una revisión humana sin hacer. No se busca «memoria» suelta, que en el código es vocabulario
 * técnico («almacenes en memoria»), ni el estado de confirmación de la interfaz, que no es una nota. Partidos como los
 * demás, para que este archivo no se señale a sí mismo.
 */
const REVISION = new RegExp(
  [
    `(?<![\\p{L}])${'Pendiente'} de \\p{L}`,
    `${'pendiente'} de (?:revisi[oó]n|revisar|verificar|verificaci[oó]n|cotejar|cotejo)`,
    `[Pp]or ${'verificar'}`,
    `\\(de ${'memoria'}\\b`,
    `citas? de ${'memoria'}`,
    `revisión humana ${'pendiente'}`,
  ].join('|'),
  'u',
);

/**
 * La hora en que alguien trabajó, escrita en un comentario: «hasta las HH:MM del DD/MM», «DD/MM hacia las HH:MM» o
 * «el DD/MM/AAAA a las HH:MM». Una fecha de captura o de vigencia sin año («capturadas el DD/MM a las HH:MM») describe
 * los datos de una prueba y no cuenta.
 */
const HORA = String.raw`\d{1,2}[:.]\d{2}`;
const DIA = String.raw`(?<![\d/])\d{1,2}/\d{1,2}`;
const FECHA_DE_TRABAJO = new RegExp(
  [
    `\\b(?:hasta|hacia) las ${HORA} del ${DIA}`,
    `${DIA}(?:/\\d{2,4})? (?:hacia|hasta) las ${HORA}`,
    `\\bel ${DIA}/\\d{4} a las ${HORA}`,
  ].join('|'),
  'u',
);

/**
 * Textos de interfaz que nombran un estado y no son notas: una confirmación o una activación por hacer de quien usa el
 * panel. Se quitan de la línea antes de buscar notas en las cadenas.
 */
const TEXTOS_DE_INTERFAZ = new RegExp(`[Pp]${'endiente'} de (?:confirmaci[oó]n|confirmar|activaci[oó]n|activar)`, 'gu');

const REGLAS_DE_TEXTO = [MARCADORES, PENDIENTE, REVISION] as const;
const REGLAS_DE_COMENTARIO = [...REGLAS_DE_TEXTO, FECHA_DE_TRABAJO] as const;

const CODIGO_JS = new Set(['.ts', '.js', '.mjs', '.cjs']);
const LEIBLES = new Set([...CODIGO_JS, '.py', '.md', '.txt', '.html', '.json', '.yml', '.yaml', '.toml']);

/** Carpetas que se saltan donde aparezcan: dependencias, cachés e historial, nunca texto del equipo. */
export const CARPETAS_AJENAS: Readonly<Record<string, string>> = Object.freeze({
  '.git': 'historial local',
  '.venv': 'dependencias de Python',
  node_modules: 'dependencias de Node',
  '.ruff_cache': 'caché de Ruff',
  __pycache__: 'caché de Python',
});

/** Rutas desde la raíz, con «/», que no son producto propio o no son texto del equipo, con su motivo. */
export const RUTAS_AJENAS: Readonly<Record<string, string>> = Object.freeze({
  var: 'estado local de la instalación',
  dist: 'construcción',
  datos: 'datos publicados, con textos de las fuentes',
  'web/datos': 'datos publicados, con textos de las fuentes',
  'web/terceros': 'código de terceros',
  'web/motor': 'copia generada de los motores',
  'web/paquete': 'paquete de datos generado',
  'web/firmas': 'manifiesto de huellas generado',
  'pruebas/fixtures': 'instantáneas y muestras con textos ajenos',
  'pruebas/testigos': 'instantáneas públicas con textos ajenos',
  'pruebas/datos': 'bancos de evaluación con textos ajenos',
  'package-lock.json': 'árbol de dependencias generado',
});

export interface NotaDeTrabajo {
  readonly archivo: string;
  readonly linea: number;
  readonly texto: string;
}

interface Tramo {
  readonly inicio: number;
  readonly fin: number;
}

/** Lo que contiene un tramo decide qué reglas se le aplican. */
type ClaseDeTramo = 'comentario' | 'cadena' | 'texto';

interface TramoLeido extends Tramo {
  readonly clase: ClaseDeTramo;
}

/** Estado del lector de JS y TS: posición, comentarios hallados y llaves abiertas en cada interpolación de plantilla. */
interface LecturaJs {
  readonly texto: string;
  i: number;
  enPlantilla: boolean;
  readonly plantillas: number[];
  readonly tramos: Tramo[];
  readonly cadenas: Tramo[];
  /** Dónde empieza el trozo de texto de la plantilla en curso. */
  inicioPlantilla: number;
}

/** Lo que salta una barra invertida: ella y el carácter que escapa. */
const ESCAPE = 2;
const LARGO_DE_TRIPLE = 3;

/** Palabras tras las que una barra abre una expresión regular y no una división. */
const ANTES_DE_REGEX = new Set([
  'return',
  'typeof',
  'case',
  'do',
  'else',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
]);
const SIGNOS_ANTES_DE_REGEX = new Set([...'(,=:[!&|?{};+-*%<>~^']);

/** Si una barra en la posición dada abre una expresión regular, según lo que la precede. */
function abreRegex(texto: string, posicion: number): boolean {
  const antes = texto.slice(0, posicion).trimEnd();
  if (!antes) {
    return true;
  }
  if (SIGNOS_ANTES_DE_REGEX.has(antes.at(-1) as string)) {
    return true;
  }
  const palabra = /[\p{L}\p{N}_$]+$/u.exec(antes)?.[0];
  return palabra !== undefined && ANTES_DE_REGEX.has(palabra);
}

/** La posición siguiente al cierre de una cadena simple o doble que empieza en `i`. */
function finDeCadena(texto: string, i: number): number {
  const comilla = texto[i];
  let j = i + 1;
  while (j < texto.length && texto[j] !== comilla && texto[j] !== '\n') {
    j += texto[j] === '\\' ? ESCAPE : 1;
  }
  return j + 1;
}

/** La posición siguiente al cierre de una expresión regular que empieza en `i`, con sus clases entre corchetes. */
function finDeRegex(texto: string, i: number): number {
  let j = i + 1;
  let enClase = false;
  while (j < texto.length && texto[j] !== '\n') {
    const c = texto[j];
    if (c === '\\') {
      j += ESCAPE;
      continue;
    }
    if (c === '/' && !enClase) {
      return j + 1;
    }
    enClase = c === '[' || (enClase && c !== ']');
    j++;
  }
  return j;
}

/** Anota el comentario que empieza en `l.i` y avanza hasta su final. */
function leerComentario(l: LecturaJs, deLinea: boolean): void {
  const cierre = deLinea ? '\n' : '*/';
  const posicion = l.texto.indexOf(cierre, l.i + ESCAPE);
  const fin = posicion === -1 ? l.texto.length : posicion + (deLinea ? 0 : cierre.length);
  l.tramos.push({ inicio: l.i, fin });
  l.i = fin;
}

function leerBarra(l: LecturaJs): void {
  const siguiente = l.texto[l.i + 1];
  if (siguiente === '/' || siguiente === '*') {
    leerComentario(l, siguiente === '/');
  } else {
    l.i = abreRegex(l.texto, l.i) ? finDeRegex(l.texto, l.i) : l.i + 1;
  }
}

function leerLlave(l: LecturaJs, abre: boolean): void {
  l.i++;
  l.inicioPlantilla = l.i;
  const ultima = l.plantillas.length - 1;
  if (ultima < 0) {
    return;
  }
  if (abre) {
    l.plantillas[ultima] = (l.plantillas[ultima] as number) + 1;
  } else if (l.plantillas[ultima] === 0) {
    l.plantillas.pop();
    l.enPlantilla = true;
  } else {
    l.plantillas[ultima] = (l.plantillas[ultima] as number) - 1;
  }
}

/** Un paso dentro del texto de una plantilla: escape, cierre o inicio de interpolación. */
function pasoEnPlantilla(l: LecturaJs): void {
  const c = l.texto[l.i];
  if (c === '\\') {
    l.i += ESCAPE;
  } else if (c === '`') {
    l.cadenas.push({ inicio: l.inicioPlantilla, fin: l.i });
    l.enPlantilla = false;
    l.i++;
  } else if (c === '$' && l.texto[l.i + 1] === '{') {
    l.cadenas.push({ inicio: l.inicioPlantilla, fin: l.i });
    l.plantillas.push(0);
    l.enPlantilla = false;
    l.i += ESCAPE;
  } else {
    l.i++;
  }
}

/** Anota la cadena simple o doble que empieza en `l.i`, sin sus comillas, y avanza hasta su cierre. */
function leerCadena(l: LecturaJs): void {
  const fin = finDeCadena(l.texto, l.i);
  l.cadenas.push({ inicio: l.i + 1, fin: fin - 1 });
  l.i = fin;
}

const PASOS_JS: Readonly<Record<string, (l: LecturaJs) => void>> = {
  '/': leerBarra,
  '"': leerCadena,
  "'": leerCadena,
  '`': (l) => {
    l.enPlantilla = true;
    l.i++;
    l.inicioPlantilla = l.i;
  },
  '{': (l) => leerLlave(l, true),
  '}': (l) => leerLlave(l, false),
};

/** Los comentarios y las cadenas (con el texto de las plantillas) de un módulo JS o TS; las regex no cuentan. */
function leerJs(texto: string): LecturaJs {
  const l: LecturaJs = { texto, i: 0, enPlantilla: false, plantillas: [], tramos: [], cadenas: [], inicioPlantilla: 0 };
  while (l.i < texto.length) {
    if (l.enPlantilla) {
      pasoEnPlantilla(l);
      continue;
    }
    const paso = PASOS_JS[texto[l.i] as string];
    if (paso) {
      paso(l);
    } else {
      l.i++;
    }
  }
  return l;
}

/** La posición siguiente al cierre de una cadena Python que empieza en `i`, y si era triple. */
function finDeCadenaPython(texto: string, i: number): { fin: number; triple: boolean } {
  const comilla = texto[i] as string;
  const triple = texto.startsWith(comilla.repeat(LARGO_DE_TRIPLE), i);
  const cierre = triple ? comilla.repeat(LARGO_DE_TRIPLE) : comilla;
  let j = i + cierre.length;
  while (j < texto.length && !texto.startsWith(cierre, j) && (triple || texto[j] !== '\n')) {
    j += texto[j] === '\\' ? ESCAPE : 1;
  }
  return { fin: Math.min(j + cierre.length, texto.length), triple };
}

/** El comentario `#` que empieza en `i`, hasta el final de la línea. */
function comentarioPython(texto: string, i: number): Tramo {
  const salto = texto.indexOf('\n', i);
  return { inicio: i, fin: salto === -1 ? texto.length : salto };
}

/** Los comentarios `#` y las cadenas triples (docstrings) de un módulo Python, sin confundir lo que va entre comillas. */
function comentariosPython(texto: string): Tramo[] {
  const tramos: Tramo[] = [];
  let i = 0;
  while (i < texto.length) {
    const c = texto[i];
    if (c === '#') {
      const tramo = comentarioPython(texto, i);
      tramos.push(tramo);
      i = tramo.fin;
    } else if (c === '"' || c === "'") {
      const { fin, triple } = finDeCadenaPython(texto, i);
      if (triple) {
        tramos.push({ inicio: i, fin });
      }
      i = fin;
    } else {
      i++;
    }
  }
  return tramos;
}

/** Si una ruta es de una prueba: sus cadenas son entradas sintéticas y no se leen, aunque sí sus comentarios. */
function esDePruebas(ruta: string): boolean {
  return ruta.split('/').includes('pruebas');
}

const conClase =
  (clase: ClaseDeTramo) =>
  (tramo: Tramo): TramoLeido => ({ ...tramo, clase });

function tramosDe(ruta: string, texto: string): TramoLeido[] {
  const extension = extname(ruta);
  if (CODIGO_JS.has(extension)) {
    const lectura = leerJs(texto);
    const cadenas = esDePruebas(ruta) ? [] : lectura.cadenas.map(conClase('cadena'));
    return [...lectura.tramos.map(conClase('comentario')), ...cadenas];
  }
  if (extension === '.py') {
    return comentariosPython(texto).map(conClase('comentario'));
  }
  return [{ inicio: 0, fin: texto.length, clase: 'texto' }];
}

/** Si una línea de un tramo es una nota de trabajo, con las reglas de su clase. */
function esNota(linea: string, clase: ClaseDeTramo): boolean {
  if (clase === 'comentario') {
    return REGLAS_DE_COMENTARIO.some((regla) => regla.test(linea));
  }
  const sinInterfaz = clase === 'cadena' ? linea.replace(TEXTOS_DE_INTERFAZ, '') : linea;
  return REGLAS_DE_TEXTO.some((regla) => regla.test(sinInterfaz));
}

/** La línea (desde 1) de una posición, con las posiciones de los saltos ya calculadas y ordenadas. */
function lineaDe(saltos: readonly number[], posicion: number): number {
  let bajo = 0;
  let alto = saltos.length;
  while (bajo < alto) {
    const medio = (bajo + alto) >>> 1;
    if ((saltos[medio] as number) < posicion) {
      bajo = medio + 1;
    } else {
      alto = medio;
    }
  }
  return bajo + 1;
}

/** Las notas de trabajo de un texto, con su línea (empieza en 1). */
export function notasDelTexto(archivo: string, texto: string): NotaDeTrabajo[] {
  const notas: NotaDeTrabajo[] = [];
  const saltos = [...texto.matchAll(/\n/gu)].map((salto) => salto.index);
  const tramos = tramosDe(archivo, texto).sort((a, b) => a.inicio - b.inicio);
  for (const { inicio, fin, clase } of tramos) {
    const lineaInicial = lineaDe(saltos, inicio);
    texto
      .slice(inicio, fin)
      .split('\n')
      .forEach((linea, desplazamiento) => {
        if (esNota(linea, clase)) {
          notas.push({ archivo, linea: lineaInicial + desplazamiento, texto: linea.trim() });
        }
      });
  }
  return notas;
}

function visitar(raiz: string, carpeta: string, archivos: string[]): void {
  for (const entrada of readdirSync(carpeta, { withFileTypes: true })) {
    const ruta = join(carpeta, entrada.name);
    const relativa = relative(raiz, ruta).split(sep).join('/');
    if (entrada.name in CARPETAS_AJENAS || relativa in RUTAS_AJENAS) {
      continue;
    }
    if (entrada.isDirectory()) {
      visitar(raiz, ruta, archivos);
    } else if (entrada.isFile() && LEIBLES.has(extname(entrada.name))) {
      archivos.push(relativa);
    }
  }
}

/** Los archivos del producto que la guardia lee, como rutas relativas con «/», ordenadas. */
export function archivosDelProducto(raiz: string): string[] {
  const archivos: string[] = [];
  visitar(raiz, raiz, archivos);
  return archivos.sort();
}

/** Todas las notas de trabajo del producto bajo `raiz`. */
export function notasDeTrabajo(raiz: string): NotaDeTrabajo[] {
  return archivosDelProducto(raiz).flatMap((archivo) =>
    notasDelTexto(archivo, readFileSync(join(raiz, archivo), 'utf8')),
  );
}
