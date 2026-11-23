// El clasificador de fragmentos del recorrido en el dispositivo: de lo que escribe la persona a la
// probabilidad de cada grupo CIUO-08, sin red. Es un modelo lineal (regresión logística) sobre fragmentos de letras de
// cada palabra (2 a 5) y sobre palabras sueltas y en parejas, entrenado con frases escritas como habla la gente y con
// los nombres de ESCO. Reproduce exactamente el preprocesado de scikit-learn
// (TfidfVectorizer: minúsculas, tildes fuera, char_wb, tf sublineal, idf suave, norma L2 por bloque); los pesos llegan
// podados al 3 % y cuantizados a int8 por clase. La paridad con el modelo original se comprueba con frases de control.

/** El contenedor del paquete (clasificador-movil.json): binarios en base64. */
interface ContenedorDelClasificador {
  readonly formato: number;
  readonly fuente: string;
  readonly clases: readonly string[];
  readonly intercepto_b64: string;
  readonly char: { readonly vocabulario: readonly string[]; readonly idf_b64: string };
  readonly palabras: { readonly vocabulario: readonly string[]; readonly idf_b64: string };
  readonly pesos: {
    readonly rasgos: number;
    readonly inicio_b64: string;
    readonly clase_b64: string;
    readonly valor_b64: string;
    readonly escala_b64: string;
  };
}

/** Un grupo CIUO-08 con su probabilidad. */
export interface GrupoProbable {
  readonly grupo: string;
  readonly p: number;
}

export interface ClasificadorMovil {
  readonly clases: readonly string[];
  /** Los `cuantos` grupos más probables para el texto, de más a menos. */
  readonly predecir: (texto: string, cuantos?: number) => GrupoProbable[];
}

class ClasificadorInvalido extends Error {
  override name = 'ClasificadorInvalido';
}

const FORMATO = 1;
/** Fragmentos de letras por palabra: de 2 a 5 (char_wb de scikit-learn). */
const MIN_FRAGMENTO = 2;
const MAX_FRAGMENTO = 5;
/** Grupos que se devuelven si no se pide otra cosa. */
const GRUPOS_POR_DEFECTO = 5;

function bytesDe(base64: string): Uint8Array {
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) {
    bytes[i] = binario.charCodeAt(i);
  }
  return bytes;
}

/** Una vista tipada sobre una copia alineada de los bytes. */
function vista<T>(base64: string, Tipo: new (b: ArrayBuffer) => T): T {
  const bytes = bytesDe(base64);
  return new Tipo(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
}

/** Minúsculas y, si hay algo fuera de ASCII, sin marcas diacríticas (strip_accents_unicode de scikit-learn). */
function preparar(texto: string): string {
  const minusculas = texto.toLowerCase();
  // biome-ignore lint/suspicious/noControlCharactersInRegex: el rango ASCII completo es justo lo que se comprueba.
  return /^[\u0000-\u007f]*$/.test(minusculas) ? minusculas : minusculas.normalize('NFKD').replace(/\p{M}/gu, '');
}

/** Los fragmentos de letras de cada palabra, con un espacio a cada lado (_char_wb_ngrams de scikit-learn). */
function fragmentos(preparado: string): string[] {
  const salida: string[] = [];
  for (const palabra of preparado.split(/\s+/).filter(Boolean)) {
    const letras = Array.from(` ${palabra} `);
    for (let n = MIN_FRAGMENTO; n <= MAX_FRAGMENTO; n++) {
      let inicio = 0;
      salida.push(letras.slice(inicio, inicio + n).join(''));
      while (inicio + n < letras.length) {
        inicio++;
        salida.push(letras.slice(inicio, inicio + n).join(''));
      }
      // Una palabra más corta que el fragmento cuenta una sola vez.
      if (inicio === 0) {
        break;
      }
    }
  }
  return salida;
}

/** Las palabras (\w+ de Python) y las parejas de palabras seguidas. */
function palabrasYParejas(preparado: string): string[] {
  const palabras = preparado.match(/[\p{L}\p{N}_]+/gu) ?? [];
  return [...palabras, ...palabras.slice(1).map((p, i) => `${palabras[i]} ${p}`)];
}

/** tf sublineal (1 + ln tf) por idf, normalizado a longitud 1; los términos fuera del vocabulario no cuentan. */
function bloque(terminos: readonly string[], vocabulario: ReadonlyMap<string, number>, idf: Float32Array) {
  const cuenta = new Map<number, number>();
  for (const t of terminos) {
    const i = vocabulario.get(t);
    if (i !== undefined) {
      cuenta.set(i, (cuenta.get(i) ?? 0) + 1);
    }
  }
  const pesos = [...cuenta].map(([i, n]) => [i, (1 + Math.log(n)) * (idf[i] ?? 0)] as const);
  const norma = Math.sqrt(pesos.reduce((s, [, w]) => s + w * w, 0)) || 1;
  return pesos.map(([i, w]) => [i, w / norma] as const);
}

/** Las piezas binarias del contenedor, decodificadas y comprobadas: que sus tamaños encajan entre sí. */
function piezas(c: ContenedorDelClasificador) {
  if (c.formato !== FORMATO) {
    throw new ClasificadorInvalido(`clasificador del móvil: formato ${c.formato}, se esperaba ${FORMATO}`);
  }
  const clases = c.clases;
  const intercepto = vista(c.intercepto_b64, Float32Array);
  const escala = vista(c.pesos.escala_b64, Float32Array);
  const inicio = vista(c.pesos.inicio_b64, Uint32Array);
  const clase = vista(c.pesos.clase_b64, Uint16Array);
  const valor = new Int8Array(bytesDe(c.pesos.valor_b64).buffer);
  const idfChar = vista(c.char.idf_b64, Float32Array);
  const idfPalabras = vista(c.palabras.idf_b64, Float32Array);
  const nChar = c.char.vocabulario.length;
  const rasgos = nChar + c.palabras.vocabulario.length;
  if (
    intercepto.length !== clases.length ||
    escala.length !== clases.length ||
    inicio.length !== rasgos + 1 ||
    c.pesos.rasgos !== rasgos ||
    clase.length !== valor.length ||
    idfChar.length !== nChar ||
    idfPalabras.length !== c.palabras.vocabulario.length
  ) {
    throw new ClasificadorInvalido('clasificador del móvil: las piezas no encajan');
  }
  return { clases, intercepto, escala, inicio, clase, valor, idfChar, idfPalabras, nChar };
}

/**
 * Prepara el clasificador desde su contenedor, comprobando que las piezas encajan.
 *
 * @param c - El contenedor de clasificador-movil.json.
 * @returns El clasificador listo para predecir.
 */
export function cargarClasificador(c: ContenedorDelClasificador): ClasificadorMovil {
  const { clases, intercepto, escala, inicio, clase, valor, idfChar, idfPalabras, nChar } = piezas(c);
  const vocabularioChar = new Map(c.char.vocabulario.map((t, i) => [t, i]));
  const vocabularioPalabras = new Map(c.palabras.vocabulario.map((t, i) => [t, i]));

  const predecir = (texto: string, cuantos = GRUPOS_POR_DEFECTO): GrupoProbable[] => {
    const preparado = preparar(texto).replace(/\s\s+/g, ' ');
    const activos = [
      ...bloque(fragmentos(preparado), vocabularioChar, idfChar),
      ...bloque(palabrasYParejas(preparado), vocabularioPalabras, idfPalabras).map(([i, w]) => [nChar + i, w] as const),
    ];
    const z = Float64Array.from(intercepto);
    for (const [r, x] of activos) {
      for (let k = inicio[r] ?? 0; k < (inicio[r + 1] ?? 0); k++) {
        const cl = clase[k] ?? 0;
        z[cl] = (z[cl] ?? 0) + x * (valor[k] ?? 0) * (escala[cl] ?? 0);
      }
    }
    const maximo = Math.max(...z);
    const e = z.map((v) => Math.exp(v - maximo));
    const total = e.reduce((s, v) => s + v, 0);
    return Array.from(e, (v, i) => ({ grupo: clases[i] ?? '', p: v / total }))
      .sort((a, b) => b.p - a.p)
      .slice(0, cuantos);
  };
  return { clases, predecir };
}

/**
 * El clasificador desde lo leído del paquete (clasificador-movil.json), sin dar su forma por supuesta.
 *
 * @param contenedor - El JSON leído, sin validar.
 * @returns El clasificador listo para predecir.
 * @throws {ClasificadorInvalido} Si no tiene la forma de un contenedor del clasificador o sus piezas no encajan.
 */
export function clasificadorDesdeContenedor(contenedor: unknown): ClasificadorMovil {
  const c = contenedor as Partial<ContenedorDelClasificador> | null;
  if (
    !(
      c &&
      c.formato === FORMATO &&
      Array.isArray(c.clases) &&
      typeof c.intercepto_b64 === 'string' &&
      Array.isArray(c.char?.vocabulario) &&
      Array.isArray(c.palabras?.vocabulario) &&
      typeof c.pesos?.valor_b64 === 'string'
    )
  ) {
    throw new ClasificadorInvalido('clasificador del móvil: clasificador-movil.json no tiene la forma esperada');
  }
  return cargarClasificador(c as ContenedorDelClasificador);
}
