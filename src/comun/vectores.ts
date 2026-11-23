// Vectores precalculados: cuantización a int8 con una escala por vector, carga y búsqueda por producto escalar.
// El índice conserva los int8 y descomprime cada componente al usarla. Los redondeos a Float32 y el orden de las
// operaciones forman parte del cálculo: no se agrupan ni se sustituyen por operaciones aproximadamente equivalentes.
// Las entradas numéricas deben ser densas y finitas; los índices y sus arrays compartidos no deben modificarse tras
// cargarlos. cargarIndice valida la coherencia estructural, no la norma ni la finitud de las entradas.

import { compararPorCodigo } from './orden.js';

/** Límite simétrico elegido para cuantizar a int8: la escala de cada vector lleva su componente más grande a ±127. */
const MAXIMO_INT8 = 127;
/** Menor número normal de doble precisión IEEE-754; por debajo los cuadrados pierden precisión relativa. */
const EXPONENTE_MINIMO_NORMAL_FLOAT64 = -1022;
const MINIMO_NORMAL_FLOAT64 = 2 ** EXPONENTE_MINIMO_NORMAL_FLOAT64;
/**
 * Bytes que se pasan de una vez a String.fromCharCode al escribir el base64: repartirlos todos como argumentos a la vez
 * pasaría del máximo de argumentos de una llamada en los índices grandes.
 */
const BYTES_POR_TROZO = 0x8000;

/** Vectores tal como se guardan en el paquete de datos: int8 en base64, con un factor de escala por vector. */
export interface VectoresGuardados {
  modelo: string;
  dimensiones: number;
  ids: string[];
  escalas: number[];
  datos: string;
}

/**
 * Vectores listos para buscar: los int8 del paquete, uno detrás de otro (el de `ids[i]` empieza en `i * dimensiones`),
 * con la escala y la longitud de cada uno, que normalizan aproximadamente los vectores no nulos al descomprimirlos; los
 * nulos quedan en cero.
 */
export interface IndiceVectores {
  modelo: string;
  ids: string[];
  dimensiones: number;
  componentes: Int8Array;
  escalas: readonly number[];
  /** Longitud euclídea calculada en doble precisión, o 1 para poder dividir cuando es cero. */
  longitudes: Float64Array;
}

/**
 * El índice de cada paquete de vectores, preparado una sola vez para cada identidad de objeto guardado. Su dueño es
 * este archivo (cargarIndice y sinTextoEnBase64) y vive lo que vive el objeto de vectores que es su clave: el
 * WeakMap lo suelta con él.
 */
const indicesCargados = new WeakMap<VectoresGuardados, IndiceVectores>();

/** Suma de cuadrados en el mismo orden que el camino ordinario de normalización. */
function sumaCuadradosDe(vector: ArrayLike<number>): number {
  let sumaCuadrados = 0;
  for (let i = 0; i < vector.length; i++) {
    // i está dentro de la longitud; el contrato exige una componente numérica en cada posición.
    sumaCuadrados += (vector[i] as number) * (vector[i] as number);
  }
  return sumaCuadrados;
}

/**
 * Conserva el cálculo ordinario. Solo rescata vectores finitos no nulos cuyos cuadrados desbordan o subdesbordan:
 * divide primero por su máxima magnitud, con lo que la norma reescalada es representable. No altera los nulos ni
 * da un significado nuevo a NaN/Infinity, que siguen fuera del contrato.
 */
function normalizacionDe<Vector extends ArrayLike<number>>(
  vector: Vector,
): { vector: Vector | Float64Array; longitud: number } {
  const cuadrados = sumaCuadradosDe(vector);
  const longitud = Math.sqrt(cuadrados) || 1;
  if (Number.isNaN(cuadrados) || (Number.isFinite(cuadrados) && cuadrados >= MINIMO_NORMAL_FLOAT64)) {
    return { vector, longitud };
  }
  let maximo = 0;
  for (let i = 0; i < vector.length; i++) {
    // El contrato exige una componente numérica en cada posición.
    const valor = vector[i] as number;
    if (!Number.isFinite(valor)) {
      return { vector, longitud };
    }
    maximo = Math.max(maximo, Math.abs(valor));
  }
  if (maximo === 0) {
    return { vector, longitud };
  }
  const escalado = Float64Array.from(vector, (valor) => valor / maximo);
  return { vector: escalado, longitud: Math.sqrt(sumaCuadradosDe(escalado)) || 1 };
}

/**
 * La componente `j` del vector `posicion`, descomprimida y con el vector en norma 1, como float32: la componente por su
 * escala, redondeada a float32, entre la longitud del vector, redondeada otra vez. Equivale a guardar el vector
 * descomprimido en un Float32Array y dividirlo después por su longitud; cambiar ese orden puede
 * cambiar los últimos decimales de las similitudes y, con ellos, las referencias de las estimaciones.
 */
function componente(indice: IndiceVectores, posicion: number, j: number): number {
  // cargarIndice comprueba los tamaños. Los llamadores garantizan posición y j dentro de sus límites y no mutan
  // el índice: las tres lecturas tienen un número. Las aserciones conservan los dos redondeos y su orden.
  return Math.fround(
    Math.fround(
      (indice.componentes[posicion * indice.dimensiones + j] as number) * (indice.escalas[posicion] as number),
    ) / (indice.longitudes[posicion] as number),
  );
}

/**
 * La longitud de cada vector descomprimido. Se calcula con las componentes en doble precisión, antes de redondearlas a
 * float32: calcularla después puede cambiar los últimos decimales de las similitudes.
 */
function longitudes(componentes: Int8Array, escalas: readonly number[], dimensiones: number): Float64Array {
  const resultado = new Float64Array(escalas.length);
  for (let i = 0; i < escalas.length; i++) {
    let sumaCuadrados = 0;
    for (let j = 0; j < dimensiones; j++) {
      // comprobarCoherencia garantiza componentes.length === escalas.length * dimensiones.
      const valor = (componentes[i * dimensiones + j] as number) * (escalas[i] as number);
      sumaCuadrados += valor * valor;
    }
    resultado[i] = Math.sqrt(sumaCuadrados) || 1;
  }
  return resultado;
}

/** Los int8 en base64, como los guarda el paquete: el texto de `VectoresGuardados.datos`. */
function enBase64(componentes: Int8Array): string {
  const bytes = new Uint8Array(componentes.buffer, componentes.byteOffset, componentes.byteLength);
  let binario = '';
  for (let inicio = 0; inicio < bytes.length; inicio += BYTES_POR_TROZO) {
    binario += String.fromCharCode(...bytes.subarray(inicio, inicio + BYTES_POR_TROZO));
  }
  return btoa(binario);
}

/**
 * Normaliza cada vector y lo pasa a int8 con su factor de escala.
 *
 * @param vectores - Vectores de números finitos, al menos uno y todos con las mismas dimensiones.
 * @returns La escala de cada vector y sus int8, uno detrás de otro, en el orden recibido.
 * @throws {Error} Si no hay vectores o si alguno no tiene las dimensiones del primero.
 */
export function cuantizar(vectores: readonly (readonly number[])[]): { escalas: number[]; bytes: Int8Array } {
  if (vectores.length === 0) {
    throw new Error('No hay vectores que cuantizar');
  }
  // La lista no está vacía y su contrato exige un vector en cada posición.
  const dimensiones = (vectores[0] as readonly number[]).length;
  for (const [i, vector] of vectores.entries()) {
    if (vector.length !== dimensiones) {
      throw new Error(`El vector ${i} tiene ${vector.length} dimensiones y el primero ${dimensiones}`);
    }
  }
  const bytes = new Int8Array(vectores.length * dimensiones);
  const escalas: number[] = [];
  for (const [i, vector] of vectores.entries()) {
    const { vector: base, longitud } = normalizacionDe(vector);
    // Acumular el mismo máximo evita el límite de argumentos de Math.max en vectores de muchas dimensiones.
    let maximo = -Infinity;
    for (const valor of base) {
      maximo = Math.max(maximo, Math.abs(valor / longitud));
    }
    maximo = maximo || 1;
    escalas.push(maximo / MAXIMO_INT8);
    for (const [j, valor] of base.entries()) {
      bytes[i * dimensiones + j] = Math.round((valor / longitud / maximo) * MAXIMO_INT8);
    }
  }
  return { escalas, bytes };
}

/**
 * Lee el texto base64 de unos vectores guardados.
 *
 * @param guardados - Vectores tal como vienen del paquete.
 * @returns Los bytes del texto, en binario (un carácter por byte).
 * @throws {Error} Si el texto no es base64, con el modelo de los vectores.
 */
function binarioDe(guardados: VectoresGuardados): string {
  try {
    return atob(guardados.datos);
  } catch {
    throw new Error(`Vectores de ${guardados.modelo}: los datos no son base64`);
  }
}

/**
 * Comprueba que los vectores guardados son coherentes: dimensiones enteras positivas, una escala por identificador y
 * exactamente `ids.length × dimensiones` bytes. Sin esto, una lectura fuera de los int8 daría similitudes NaN en silencio.
 *
 * @param guardados - Vectores tal como vienen del paquete.
 * @param bytes - Bytes que trae su texto base64.
 * @throws {Error} Si falla alguna de las tres condiciones, con las cifras que no cuadran.
 */
function comprobarCoherencia(guardados: VectoresGuardados, bytes: number): void {
  const { modelo, ids, dimensiones, escalas } = guardados;
  if (!Number.isInteger(dimensiones) || dimensiones <= 0) {
    throw new Error(`Vectores de ${modelo}: ${dimensiones} no es un número de dimensiones`);
  }
  if (escalas.length !== ids.length) {
    throw new Error(`Vectores de ${modelo}: ${escalas.length} escalas para ${ids.length} identificadores`);
  }
  if (bytes !== ids.length * dimensiones) {
    throw new Error(`Vectores de ${modelo}: ${bytes} bytes para ${ids.length} × ${dimensiones}`);
  }
}

/**
 * Prepara los vectores guardados para buscar (una vez por identidad del objeto guardado): sus int8, escalas y
 * longitudes.
 *
 * @param guardados - Vectores tal como vienen del paquete.
 * @returns El índice, el mismo objeto en cada llamada con los mismos guardados.
 * @throws {Error} Si los datos no son base64 o los vectores no son coherentes (comprobarCoherencia).
 */
export function cargarIndice(guardados: VectoresGuardados): IndiceVectores {
  const cargado = indicesCargados.get(guardados);
  if (cargado) {
    return cargado;
  }
  const binario = binarioDe(guardados);
  comprobarCoherencia(guardados, binario.length);
  // Asignar un byte de 0 a 255 a un Int8Array lo lee con signo, de −128 a 127.
  const componentes = new Int8Array(binario.length);
  for (let i = 0; i < binario.length; i++) {
    componentes[i] = binario.charCodeAt(i);
  }
  const { modelo, ids, dimensiones, escalas } = guardados;
  const indice = {
    modelo,
    ids,
    dimensiones,
    componentes,
    escalas,
    longitudes: longitudes(componentes, escalas, dimensiones),
  };
  indicesCargados.set(guardados, indice);
  return indice;
}

/**
 * Pone en `vectores` el texto base64 como propiedad calculada: `datos` se vuelve a escribir desde los int8 del índice
 * cada vez que se pide, como texto base64 canónico de los mismos bytes (idéntico al original si este ya era canónico).
 * Es enumerable y configurable, como una propiedad leída de JSON, así que JSON.stringify y la huella lo ven igual.
 */
function textoDesdeElIndice(vectores: object, indice: IndiceVectores): void {
  Object.defineProperty(vectores, 'datos', {
    enumerable: true,
    configurable: true,
    get: (): string => enBase64(indice.componentes),
  });
}

/**
 * Los mismos vectores guardados, con su índice ya preparado y sin conservar su texto en base64: `datos` lo reconstruye
 * al leerlo (textoDesdeElIndice). La copia comparte los arrays y el índice; no deben modificarse tras la carga.
 *
 * @param guardados - Vectores tal como vienen del paquete.
 * @returns Una copia con el mismo índice y `datos` calculado desde los int8.
 * @throws {Error} Como cargarIndice.
 */
export function sinTextoEnBase64(guardados: VectoresGuardados): VectoresGuardados {
  const indice = cargarIndice(guardados);
  const { datos: _texto, ...resto } = guardados;
  const compactos: VectoresGuardados = { ...resto, datos: '' };
  textoDesdeElIndice(compactos, indice);
  indicesCargados.set(compactos, indice);
  return compactos;
}

/**
 * Prepara el índice de unos vectores guardados y suelta su texto en base64 en el mismo objeto, que conserva su
 * identidad y su índice: desde entonces `datos` se escribe desde los int8 al pedirlo (textoDesdeElIndice). Es para
 * quien ya ha leído el texto y necesita conservar el objeto con sus mismos bytes serializables.
 *
 * @param guardados - Vectores tal como vienen del paquete; se modifican en el sitio.
 * @throws {Error} Como cargarIndice.
 */
export function soltarTextoEnBase64(guardados: VectoresGuardados): void {
  textoDesdeElIndice(guardados, cargarIndice(guardados));
}

/**
 * Copia un vector en Float32, normalizado aproximadamente si no es nulo; el nulo queda en cero.
 *
 * @param vector - Componentes finitas.
 * @returns Un vector nuevo de la misma longitud.
 */
export function normalizarVector(vector: ArrayLike<number>): Float32Array {
  const { vector: base, longitud } = normalizacionDe(vector);
  return Float32Array.from(base, (valor) => valor / longitud);
}

/**
 * El vector de un identificador, descomprimido y normalizado aproximadamente si no es nulo; null si el índice no lo
 * tiene. Si un identificador aparece más de una vez, usa su primera posición.
 *
 * @param indice - Índice cargado con cargarIndice.
 * @param id - Identificador buscado.
 * @returns Un vector nuevo de `indice.dimensiones` componentes, o null.
 */
export function vectorDe(indice: IndiceVectores, id: string): Float32Array | null {
  const posicion = indice.ids.indexOf(id);
  if (posicion < 0) {
    return null;
  }
  return Float32Array.from({ length: indice.dimensiones }, (_elemento, j) => componente(indice, posicion, j));
}

/**
 * Producto escalar entre el vector que ocupa `posicion` en el índice y la consulta. Para vectores no nulos y una
 * consulta normalizada aproxima la similitud del coseno; el tipo de la consulta no comprueba su norma.
 *
 * @param indice - Índice cargado con cargarIndice.
 * @param posicion - Posición del vector en `indice.ids`, entre 0 y `ids.length − 1`.
 * @param consulta - Vector finito de `indice.dimensiones` componentes, normalizado. La longitud, norma y posición
 *   son precondiciones del llamador; aquí no se validan. masParecidas comprueba la longitud de su consulta.
 * @returns El producto escalar, entre −1 y 1 aproximadamente.
 */
export function similitudCon(indice: IndiceVectores, posicion: number, consulta: Float32Array): number {
  let similitud = 0;
  for (let j = 0; j < indice.dimensiones; j++) {
    // La consulta tiene las dimensiones del índice por contrato; j está dentro de ellas.
    similitud += componente(indice, posicion, j) * (consulta[j] as number);
  }
  return similitud;
}

/**
 * Las `cuantas` tareas oficiales más parecidas a la consulta, sin las que `descartar` excluya.
 *
 * @param indice - Índice cargado con cargarIndice.
 * @param consulta - Vector normalizado de `indice.dimensiones` componentes.
 * @param cuantas - Número máximo de resultados, entero no negativo; precondición del llamador.
 * @param descartar - Si un identificador se deja fuera; por defecto, ninguno.
 * @returns Hasta `cuantas` identificadores con su similitud, de más a menos y, a igual similitud, por identificador.
 * @throws {Error} Si la consulta no tiene las dimensiones del índice.
 */
export function masParecidas(
  indice: IndiceVectores,
  consulta: Float32Array,
  cuantas: number,
  descartar: (id: string) => boolean = () => false,
): { id: string; similitud: number }[] {
  if (consulta.length !== indice.dimensiones) {
    throw new Error(`El vector de consulta tiene ${consulta.length} dimensiones y el índice ${indice.dimensiones}`);
  }
  const puntuadas: { id: string; similitud: number }[] = [];
  for (const [posicion, id] of indice.ids.entries()) {
    if (!descartar(id)) {
      puntuadas.push({ id, similitud: similitudCon(indice, posicion, consulta) });
    }
  }
  // A igual similitud, por identificador: el resultado no depende del orden del paquete.
  return puntuadas.sort((a, b) => b.similitud - a.similitud || compararPorCodigo(a.id, b.id)).slice(0, cuantas);
}
