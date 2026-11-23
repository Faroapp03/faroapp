// La geometría del globo de «Datos globales»: de las capas de Natural Earth (GeoJSON, RFC 7946) a los anillos compactos
// que lee la web (web/recursos/globo/fronteras.json). Lógica pura, sin archivos: la usa herramientas/web/traer-globo.ts
// y la prueban pruebas/herramientas-web/geometria-del-globo.test.ts.
// - Cada territorio es una lista de anillos (los exteriores y los huecos de todos sus polígonos): la web los rellena
//   por la regla par-impar, así que no necesita saber cuál es cuál.
// - Cataluña no está en la capa de países: es la unión de sus cuatro provincias de la capa de regiones. Natural Earth
//   construye esa capa con bordes compartidos idénticos, así que la unión se obtiene sin cálculo de polígonos: se
//   anulan los segmentos que salen dos veces (los bordes entre provincias) y se encadenan los que quedan.
// - Las coordenadas se redondean a centésimas de grado (unos 1,1 km, por debajo del detalle de la escala 1:110
//   millones) y se guardan como diferencias con el punto anterior, que es lo que comprime bien.

/** Un punto [longitud, latitud], en grados. */
export type Punto = readonly [number, number];
/** Un anillo cerrado, sin repetir al final el primer punto. */
export type Anillo = readonly Punto[];

/** Un GeoJSON que no tiene la forma que espera la herramienta. */
export class GeometriaInvalida extends Error {
  override name = 'GeometriaInvalida';
}

/** El mayor valor absoluto de una longitud, en grados (RFC 7946, 4: WGS 84). */
const LONGITUD_MAXIMA_GRADOS = 180;
/** El mayor valor absoluto de una latitud, en grados. */
const LATITUD_MAXIMA_GRADOS = 90;
/** Posiciones mínimas de un anillo de GeoJSON: tres puntos distintos y el primero repetido (RFC 7946, 3.1.6). */
const POSICIONES_MINIMAS_DEL_ANILLO = 4;
/** Puntos mínimos de un anillo sin la repetición final: con menos no encierra superficie. */
const PUNTOS_MINIMOS = 3;

/** Enteros por grado de las coordenadas de fronteras.json: centésimas de grado, unos 1,1 km en el ecuador. */
export const ESCALA = 100;

/**
 * Un valor en grados redondeado a `1 / ESCALA` grados: el redondeo de los centros de fronteras.json, el mismo que el de
 * sus coordenadas.
 *
 * @param grados - El valor, en grados.
 * @returns El valor redondeado, en grados.
 */
export function redondearAEscala(grados: number): number {
  return Math.round(grados * ESCALA) / ESCALA;
}

/** Un número finito en un rango, o GeometriaInvalida. */
function coordenada(valor: unknown, limite: number): number {
  if (typeof valor !== 'number' || !Number.isFinite(valor) || Math.abs(valor) > limite) {
    throw new GeometriaInvalida(`coordenada fuera de rango: ${String(valor)}`);
  }
  return valor;
}

/** Un anillo de GeoJSON (lista de posiciones que repite el primer punto al final) sin esa repetición. */
function anilloDeGeojson(valor: unknown): Anillo {
  if (!Array.isArray(valor) || valor.length < POSICIONES_MINIMAS_DEL_ANILLO) {
    throw new GeometriaInvalida(`un anillo necesita ${POSICIONES_MINIMAS_DEL_ANILLO} posiciones o más`);
  }
  const puntos = valor.map((posicion: unknown): Punto => {
    if (!Array.isArray(posicion)) {
      throw new GeometriaInvalida('una posición no es una lista');
    }
    return [coordenada(posicion[0], LONGITUD_MAXIMA_GRADOS), coordenada(posicion[1], LATITUD_MAXIMA_GRADOS)];
  });
  const [primero, ultimo] = [puntos[0], puntos.at(-1)];
  if (!primero || !ultimo || primero[0] !== ultimo[0] || primero[1] !== ultimo[1]) {
    throw new GeometriaInvalida('un anillo de GeoJSON termina en su primer punto (RFC 7946, 3.1.6)');
  }
  return puntos.slice(0, -1);
}

/** Los anillos de un polígono de GeoJSON: el exterior y sus huecos. */
function anillosDePoligono(valor: unknown): Anillo[] {
  if (!Array.isArray(valor)) {
    throw new GeometriaInvalida('un polígono no es una lista de anillos');
  }
  return valor.map(anilloDeGeojson);
}

/** La clave de un punto para encontrar el segmento que empieza en él: sus coordenadas tal cual. */
function clave([longitud, latitud]: Punto): string {
  return `${longitud},${latitud}`;
}

/** La clave de un segmento sin dirección: la misma para A→B y para B→A. */
function claveDeSegmento(origen: Punto, destino: Punto): string {
  const [a, b] = [clave(origen), clave(destino)];
  return a < b ? `${a};${b}` : `${b};${a}`;
}

/** Los segmentos dirigidos de unos anillos que no comparte ningún otro (los que forman el contorno de la unión). */
function segmentosDelBorde(anillos: readonly Anillo[]): [Punto, Punto][] {
  const veces = new Map<string, number>();
  const segmentos: [Punto, Punto][] = anillos.flatMap((anillo) =>
    anillo.map((punto, i): [Punto, Punto] => [punto, anillo[(i + 1) % anillo.length] ?? punto]),
  );
  for (const [origen, destino] of segmentos) {
    const llave = claveDeSegmento(origen, destino);
    veces.set(llave, (veces.get(llave) ?? 0) + 1);
  }
  return segmentos.filter(([origen, destino]) => veces.get(claveDeSegmento(origen, destino)) === 1);
}

/**
 * Sigue los segmentos desde `inicio` hasta volver a él, gastando cada uno. Cada vuelta gasta un segmento, así que lo
 * acota su número; un segmento sin continuación, o un recorrido que gasta todos los que había sin volver a `inicio`
 * (A→B, B→C, C→B), es un contorno abierto, que no sale de anillos bien formados.
 *
 * @throws {GeometriaInvalida} Si el contorno no vuelve a su inicio.
 */
function seguirAnillo(desde: Map<string, Punto>, inicio: Punto): Anillo {
  const anillo: Punto[] = [];
  const limite = desde.size;
  const claveDelInicio = clave(inicio);
  let punto: Punto | undefined = inicio;
  for (let paso = 0; punto && paso < limite; paso += 1) {
    const clavePunto = clave(punto);
    const siguiente = desde.get(clavePunto);
    if (!siguiente) {
      throw new GeometriaInvalida(`el contorno queda abierto en ${clavePunto}`);
    }
    desde.delete(clavePunto);
    anillo.push(punto);
    punto = clave(siguiente) === claveDelInicio ? undefined : siguiente;
  }
  if (punto) {
    throw new GeometriaInvalida(`el contorno no vuelve a su inicio, ${claveDelInicio}`);
  }
  return anillo;
}

/** Encadena segmentos dirigidos en anillos cerrados. */
function encadenar(segmentos: readonly [Punto, Punto][]): Anillo[] {
  const desde = new Map(segmentos.map(([origen, destino]) => [clave(origen), destino]));
  if (desde.size !== segmentos.length) {
    throw new GeometriaInvalida('dos segmentos del contorno salen del mismo punto');
  }
  const anillos: Anillo[] = [];
  for (const [inicio] of segmentos) {
    if (desde.has(clave(inicio))) {
      anillos.push(seguirAnillo(desde, inicio));
    }
  }
  return anillos;
}

/** La distancia de `punto` a la recta que pasa por `origen` y `destino`, en grados del plano longitud-latitud. */
function distanciaALaRecta(punto: Punto, origen: Punto, destino: Punto): number {
  const [dx, dy] = [destino[0] - origen[0], destino[1] - origen[1]];
  const largo = Math.hypot(dx, dy);
  if (largo === 0) {
    return Math.hypot(punto[0] - origen[0], punto[1] - origen[1]);
  }
  return Math.abs(dy * (punto[0] - origen[0]) - dx * (punto[1] - origen[1])) / largo;
}

/** El índice del punto más alejado de la cuerda entre `desde` y `hasta` (exclusivos) y su distancia. */
function masAlejado(anillo: Anillo, desde: number, hasta: number): { indice: number; distancia: number } {
  let mejor = { indice: -1, distancia: 0 };
  const [origen, destino] = [anillo[desde], anillo[hasta % anillo.length]];
  if (!origen || !destino) {
    return mejor;
  }
  for (let i = desde + 1; i < hasta; i += 1) {
    const distancia = distanciaALaRecta(anillo[i] ?? origen, origen, destino);
    if (distancia > mejor.distancia) {
      mejor = { indice: i, distancia };
    }
  }
  return mejor;
}

// ---------- Lo público ----------

/**
 * Los anillos de una geometría GeoJSON Polygon o MultiPolygon.
 *
 * @param geometria - El miembro `geometry` de un elemento de GeoJSON, sin comprobar.
 * @returns Los anillos de todos sus polígonos (exteriores y huecos), sin repetir el primer punto al final.
 * @throws {GeometriaInvalida} Si no es un Polygon o un MultiPolygon bien formado con coordenadas en rango.
 */
export function anillosDeGeometria(geometria: unknown): Anillo[] {
  if (typeof geometria !== 'object' || geometria === null) {
    throw new GeometriaInvalida('la geometría no es un objeto');
  }
  // Ya se sabe que es un objeto; sus dos miembros se leen como desconocidos y se comprueban abajo.
  const { type: tipo, coordinates: coordenadas } = geometria as { type?: unknown; coordinates?: unknown };
  if (tipo === 'Polygon') {
    return anillosDePoligono(coordenadas);
  }
  if (tipo === 'MultiPolygon') {
    if (!Array.isArray(coordenadas)) {
      throw new GeometriaInvalida('un MultiPolygon necesita una lista de polígonos');
    }
    return coordenadas.flatMap(anillosDePoligono);
  }
  throw new GeometriaInvalida(`geometría «${String(tipo)}»: se esperaba Polygon o MultiPolygon`);
}

/**
 * El contorno de la unión de unos anillos que comparten sus bordes punto por punto (las provincias de una misma capa
 * de Natural Earth): quedan los segmentos que no están en dos anillos, encadenados.
 *
 * @param anillos - Los anillos de los territorios que se unen.
 * @returns Los anillos del contorno.
 * @throws {GeometriaInvalida} Si el contorno queda abierto o dos de sus segmentos salen del mismo punto.
 */
export function contornoDeLaUnion(anillos: readonly Anillo[]): Anillo[] {
  return encadenar(segmentosDelBorde(anillos));
}

/**
 * El anillo simplificado con Douglas–Peucker: quita los puntos que se apartan menos de `tolerancia` grados de la cuerda
 * que los salta. Sin recursión: una pila de tramos pendientes. Termina porque cada tramo es estrictamente más corto que
 * el que lo generó, y cada punto conservado genera dos, así que con n puntos hay como mucho 2n − 1 tramos.
 *
 * @param anillo - El anillo, sin repetir el primer punto al final.
 * @param tolerancia - Lo que se puede apartar un punto quitado de su cuerda, en grados.
 * @returns El anillo con los puntos conservados, en su orden; el mismo anillo si tiene tres puntos o menos, o si
 *   simplificado le quedarían menos de tres.
 */
export function simplificar(anillo: Anillo, tolerancia: number): Anillo {
  if (anillo.length <= PUNTOS_MINIMOS) {
    return anillo;
  }
  const conservar = new Set([0]);
  const pendientes: [number, number][] = [[0, anillo.length]];
  for (let tramo = pendientes.pop(); tramo; tramo = pendientes.pop()) {
    const [desde, hasta] = tramo;
    const { indice, distancia } = masAlejado(anillo, desde, hasta);
    if (indice < 0 || distancia <= tolerancia) {
      continue;
    }
    conservar.add(indice);
    pendientes.push([desde, indice], [indice, hasta]);
  }
  const simplificado = anillo.filter((_, i) => conservar.has(i));
  return simplificado.length >= PUNTOS_MINIMOS ? simplificado : anillo;
}

/**
 * Un anillo en enteros de `1 / escala` grados, como diferencias con el punto anterior ([x0, y0, dx1, dy1, …]), sin los
 * puntos que el redondeo repite.
 *
 * @param anillo - El anillo, en grados.
 * @param escala - Enteros por grado.
 * @returns Las diferencias, o null si al redondear le quedan menos de tres puntos: ya no encierra nada.
 */
export function codificar(anillo: Anillo, escala: number): number[] | null {
  const enteros: [number, number][] = [];
  for (const [longitud, latitud] of anillo) {
    const punto: [number, number] = [Math.round(longitud * escala), Math.round(latitud * escala)];
    const anterior = enteros.at(-1);
    if (!anterior || anterior[0] !== punto[0] || anterior[1] !== punto[1]) {
      enteros.push(punto);
    }
  }
  const [primero, ultimo] = [enteros[0], enteros.at(-1)];
  if (primero && ultimo && enteros.length > 1 && primero[0] === ultimo[0] && primero[1] === ultimo[1]) {
    enteros.pop();
  }
  if (enteros.length < PUNTOS_MINIMOS) {
    return null;
  }
  return enteros.flatMap(([longitud, latitud], i) => {
    const [longitudAnterior, latitudAnterior] = enteros[i - 1] ?? [0, 0];
    return [longitud - longitudAnterior, latitud - latitudAnterior];
  });
}

/**
 * El centro de la caja que encierra unos anillos: donde se centra el globo.
 *
 * @param anillos - Los anillos, en grados.
 * @returns El centro [longitud, latitud], en grados redondeados a `1 / ESCALA` (redondearAEscala).
 */
export function centroDeLaCaja(anillos: readonly Anillo[]): Punto {
  const puntos = anillos.flat();
  const longitudes = puntos.map(([longitud]) => longitud);
  const latitudes = puntos.map(([, latitud]) => latitud);
  // Un recorrido y no Math.min(...valores): con cientos de miles de puntos el despliegue excede el tope de argumentos.
  const medio = (valores: readonly number[]) => {
    let menor = Number.POSITIVE_INFINITY;
    let mayor = Number.NEGATIVE_INFINITY;
    for (const valor of valores) {
      menor = Math.min(menor, valor);
      mayor = Math.max(mayor, valor);
    }
    return redondearAEscala((menor + mayor) / 2);
  };
  return [medio(longitudes), medio(latitudes)];
}
