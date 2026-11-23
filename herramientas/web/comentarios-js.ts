// El código de un script sin sus comentarios, para contar lo que hace y no lo que explica. «/*» o «//» dentro de una
// cadena, de una plantilla o de una expresión regular no empiezan un comentario, y esos textos se conservan tal cual
// (de ellos salen, por ejemplo, las rutas de los import). Es un lector léxico sin dependencias, porque las
// comprobaciones de la web se ejecutan también fuera del repositorio, sin node_modules (pruebas/web-publicacion/referencias.test.ts).
//
// Límite conocido: decidir si una «/» abre una expresión regular o divide exige la gramática entera; aquí se decide
// por lo que la precede (empiezaExpresion), como la heurística clásica de los minificadores. Se equivoca en código
// válido como `i++ / 2` (tras «+» la toma por expresión regular) o `if (x) /re/.test(s)` (tras «)» la toma por
// división). Las pruebas de lectores documentan estos límites; este lector no sustituye al analizador completo.

/** Palabras tras las que «/» empieza una expresión regular y no es una división. */
const PALABRAS_ANTES_DE_EXPRESION = new Set([
  'await',
  'case',
  'delete',
  'do',
  'else',
  'in',
  'new',
  'of',
  'return',
  'throw',
  'typeof',
  'void',
  'yield',
]);
/** Signos tras los que «/» empieza una expresión regular y no es una división. */
const SIGNOS_ANTES_DE_EXPRESION = new Set([...'(,=:[!&|?{};+-*%~^<>']);
/** Cuánto cambia una llave el número de llaves abiertas. */
const LLAVES: Readonly<Record<string, number>> = { '{': 1, '}': -1 };
/**
 * Lo que no necesita mirarse carácter a carácter: todo hasta la siguiente barra, comilla, tilde invertida o llave. Lleva la
 * marca `y`, así que su `lastIndex` es estado del módulo: solo lo toca trozoEn, que lo fija antes de cada uso y lo
 * lee justo después, sin cederle el control a nadie entre medias (el análisis es síncrono).
 */
const CODIGO_SIN_MARCAS = /[^/'"`{}]*/y;

/** Un trozo del script: dónde termina y si es un comentario. */
interface Trozo {
  fin: number;
  comentario: boolean;
}

/** Dónde termina la cadena que abre la comilla de `inicio` (una cadena sin cerrar acaba con su línea). */
function finDeCadena(js: string, inicio: number): number {
  const comilla = js[inicio];
  let posicion = inicio + 1;
  while (posicion < js.length && js[posicion] !== comilla && js[posicion] !== '\n') {
    posicion += js[posicion] === '\\' ? 2 : 1;
  }
  return js[posicion] === comilla ? posicion + 1 : posicion;
}

/**
 * Dónde termina la sustitución `${…}` de una plantilla que empieza en `inicio`, justo después de «${». Con
 * finDePlantilla forma una recursión indirecta (una plantilla dentro de una sustitución dentro de una plantilla…): cada
 * nivel empieza más adelante en el script, así que la profundidad no pasa del número de plantillas anidadas que tiene
 * escrito, acotado por su longitud. Con miles de niveles anidados (ningún script publicado se acerca) agotaría la pila
 * con un RangeError, que es un fallo ruidoso y no una lectura equivocada.
 */
function finDeSustitucion(js: string, inicio: number): number {
  let abiertas = 1;
  let posicion = inicio;
  let codigo = '';
  while (posicion < js.length) {
    abiertas += LLAVES[js[posicion] ?? ''] ?? 0;
    if (abiertas === 0) {
      return posicion + 1;
    }
    const { fin, comentario } = trozoEn(js, posicion, codigo);
    codigo += comentario ? ' ' : js.slice(posicion, fin);
    posicion = Math.max(fin, posicion + 1);
  }
  return posicion;
}

/** Dónde termina la plantilla que abre la tilde invertida de `inicio`, con sus sustituciones (ver finDeSustitucion). */
function finDePlantilla(js: string, inicio: number, alSustituir?: (inicio: number, fin: number) => void): number {
  let posicion = inicio + 1;
  while (posicion < js.length && js[posicion] !== '`') {
    if (js[posicion] === '\\') {
      posicion += 2;
    } else if (js.startsWith('${', posicion)) {
      const inicioSustitucion = posicion + 2;
      posicion = finDeSustitucion(js, inicioSustitucion);
      alSustituir?.(inicioSustitucion, posicion);
    } else {
      posicion += 1;
    }
  }
  return posicion + 1;
}

/** Dónde termina la expresión regular que empieza en `inicio` (en una clase, «[…]», la barra no la cierra). */
function finDeExpresion(js: string, inicio: number): number {
  let enClase = false;
  let posicion = inicio + 1;
  while (posicion < js.length && js[posicion] !== '\n') {
    const caracter = js[posicion];
    if (caracter === '/' && !enClase) {
      return posicion + 1;
    }
    if (caracter === '[') {
      enClase = true;
    }
    if (caracter === ']') {
      enClase = false;
    }
    posicion += caracter === '\\' ? 2 : 1;
  }
  return posicion;
}

/** Si una «/» empieza una expresión regular, decidido por lo que la precede (ver el límite de la cabecera). */
function empiezaExpresion(codigoPrevio: string): boolean {
  // Se recorre hacia atrás solo lo que hace falta (los espacios finales y la última palabra), no todo el código previo.
  let fin = codigoPrevio.length;
  while (fin > 0 && /\s/.test(codigoPrevio[fin - 1] ?? '')) {
    fin -= 1;
  }
  if (fin === 0 || SIGNOS_ANTES_DE_EXPRESION.has(codigoPrevio[fin - 1] ?? '')) {
    return true;
  }
  let inicio = fin;
  while (inicio > 0 && /[\w$]/.test(codigoPrevio[inicio - 1] ?? '')) {
    inicio -= 1;
  }
  return PALABRAS_ANTES_DE_EXPRESION.has(codigoPrevio.slice(inicio, fin));
}

/** Dónde termina el comentario que empieza en `posicion` (de línea o de bloque), o null si no empieza ninguno. */
function finDeComentario(js: string, posicion: number): number | null {
  const marca = js.slice(posicion, posicion + 2);
  if (marca !== '//' && marca !== '/*') {
    return null;
  }
  const cierre = marca === '//' ? '\n' : '*/';
  const donde = js.indexOf(cierre, posicion + 2);
  if (donde === -1) {
    return js.length;
  }
  return marca === '//' ? donde : donde + cierre.length;
}

/** El trozo que empieza en `posicion`: un comentario, una cadena, una plantilla, una expresión regular u otro. */
function trozoEn(js: string, posicion: number, codigoPrevio: string): Trozo {
  const finComentario = finDeComentario(js, posicion);
  if (finComentario !== null) {
    return { fin: finComentario, comentario: true };
  }
  const caracter = js[posicion];
  if (caracter === "'" || caracter === '"') {
    return { fin: finDeCadena(js, posicion), comentario: false };
  }
  if (caracter === '`') {
    return { fin: finDePlantilla(js, posicion), comentario: false };
  }
  if (caracter === '/' && empiezaExpresion(codigoPrevio)) {
    return { fin: finDeExpresion(js, posicion), comentario: false };
  }
  CODIGO_SIN_MARCAS.lastIndex = posicion + 1;
  CODIGO_SIN_MARCAS.test(js);
  return { fin: CODIGO_SIN_MARCAS.lastIndex, comentario: false };
}

/**
 * El código de un script sin sus comentarios. Cada comentario deja un espacio, para no juntar lo que separaba.
 *
 * @param js - El texto del script.
 * @returns El mismo texto con cada comentario cambiado por un espacio; el resto se conserva carácter a carácter.
 */
export function sinComentariosJs(js: string): string {
  let codigo = '';
  let posicion = 0;
  while (posicion < js.length) {
    const { fin, comentario } = trozoEn(js, posicion, codigo);
    codigo += comentario ? ' ' : js.slice(posicion, fin);
    posicion = Math.max(fin, posicion + 1);
  }
  return codigo;
}

/** Lo que se acumula del final del código antes de recortarlo a lo que decide (finQueDecide). */
const COLA = 256;

/** Dónde empiezan los espacios con que termina `codigo` antes de `fin`. */
function antesDeEspacios(codigo: string, fin: number): number {
  let inicio = fin;
  while (inicio > 0 && /\s/.test(codigo[inicio - 1] ?? '')) {
    inicio -= 1;
  }
  return inicio;
}

/** Dónde empieza la palabra (caracteres de \w, los que delimita \b) que termina en `fin`. */
function inicioDePalabra(codigo: string, fin: number): number {
  let inicio = fin;
  while (inicio > 0 && /\w/.test(codigo[inicio - 1] ?? '')) {
    inicio -= 1;
  }
  return inicio;
}

/**
 * Lo único del final del código que decide si la cadena siguiente es una importación: los espacios, un «(» opcional
 * con sus espacios, la última palabra y el carácter que la precede.
 */
export function finQueDecide(codigo: string): string {
  let fin = antesDeEspacios(codigo, codigo.length);
  if (codigo[fin - 1] === '(') {
    fin = antesDeEspacios(codigo, fin - 1);
  }
  return codigo.slice(Math.max(0, inicioDePalabra(codigo, fin) - 1));
}

/**
 * Si el código termina en «import», «import(» o «from», con espacios, como palabra completa: lo mismo que
 * /\b(?:import\s*\(?|from)\s*$/, pero mirando solo el final y no todo el código anterior.
 */
export function terminaEnImportacion(codigo: string): boolean {
  const fin = antesDeEspacios(codigo, codigo.length);
  if (codigo[fin - 1] === '(') {
    const antes = antesDeEspacios(codigo, fin - 1);
    return codigo.slice(inicioDePalabra(codigo, antes), antes) === 'import';
  }
  const palabra = codigo.slice(inicioDePalabra(codigo, fin), fin);
  return palabra === 'import' || palabra === 'from';
}

/** Las cadenas de import/from fuera de comentarios y literales; comparte los límites léxicos de sinComentariosJs. */
export function importacionesJs(js: string): string[] {
  const importadas: string[] = [];
  let codigo = '';
  // El final del código que basta para reconocer una importación: se recorta a lo que decide cuando crece, y el
  // límite se dobla con lo que queda para que una racha larga de espacios no vuelva a recorrerse en cada trozo.
  let cola = '';
  let limite = COLA;
  let posicion = 0;
  while (posicion < js.length) {
    const { fin, comentario } = trozoEn(js, posicion, codigo);
    const comilla = js[posicion];
    if ((comilla === "'" || comilla === '"') && terminaEnImportacion(cola)) {
      importadas.push(js.slice(posicion + 1, fin - 1));
    }
    if (comilla === '`') {
      finDePlantilla(js, posicion, (inicio, cierre) =>
        importadas.push(...importacionesJs(js.slice(inicio, cierre - 1))),
      );
    }
    const pieza = comentario ? ' ' : js.slice(posicion, fin);
    codigo += pieza;
    cola += pieza;
    if (cola.length > limite) {
      cola = finQueDecide(cola);
      limite = Math.max(COLA, 2 * cola.length);
    }
    posicion = Math.max(fin, posicion + 1);
  }
  return importadas;
}
