// Prepara los recursos del globo de «Datos globales» (web/recursos/globo/) desde sus originales públicos, comprobados
// por su huella SHA-256 antes de usarlos:
// - tierra.jpg: la imagen de satélite de la Tierra de la NASA (Blue Marble: Next Generation, julio, con relieve y fondo
//   marino; 5400 × 2700), reducida a 2048 × 1024 con ffmpeg (Lanczos) y guardada en JPEG sin metadatos. 2048 × 1024 es
//   una potencia de dos, la que WebGL 1 necesita para sus mipmaps, y cabe en la textura máxima de cualquier móvil.
// - fronteras.json: los países de Natural Earth 1:110 millones y el contorno de Cataluña (la unión de sus cuatro
//   provincias de la capa de regiones 1:10 millones, simplificada), con el formato de herramientas/web/geometria-del-globo.ts.
// - procedencia.json: de dónde sale cada original (dirección, página, fecha de consulta, licencia y huella) y la huella
//   de cada resultado. La comprueba pruebas/web-globo/globo-recursos.test.js.
// Los bytes de fronteras.json y de procedencia.json salen del formateador del repositorio: Biome, con la versión exacta
// de package.json (devDependencies) y la configuración de biome.json. Cambiar cualquiera de las dos puede cambiar la
// huella de fronteras.json, igual que otra versión de ffmpeg cambia la de tierra.jpg (esa sí queda anotada, porque no
// la fija el repositorio).
// No descarga nada: los originales se bajan a mano con curl desde la dirección de ORIGINALES (la red solo con el agente
// el perfil genérico central) a una carpeta propia, que se pasa con --originales.
// Uso: node herramientas/web/traer-globo.ts --originales <carpeta>

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compararPorCodigo } from '../../src/comun/orden.js';
import { leerFronteras } from '../../web/scripts/globo/fronteras.js';
import { formatearTextoConBiome } from '../comun/archivos.ts';
import { ejecutar, orden } from '../comun/opciones.ts';
import {
  type Anillo,
  anillosDeGeometria,
  centroDeLaCaja,
  codificar,
  contornoDeLaUnion,
  ESCALA,
  GeometriaInvalida,
  type Punto,
  redondearAEscala,
  simplificar,
} from './geometria-del-globo.ts';

/** La carpeta de los recursos del globo. */
const CARPETA = fileURLToPath(new URL('../../web/recursos/globo/', import.meta.url));
/** Lo que se puede apartar el contorno simplificado de Cataluña de su original 1:10 m, en grados (unos 1,1 km). */
const TOLERANCIA_CATALUNA_GRADOS = 0.01;
/** La textura: ancho y alto en píxeles y calidad del JPEG en la escala de ffmpeg (2, la mejor; 31, la peor). */
const TEXTURA = { ancho: 2048, alto: 1024, calidad: 4 } as const;
/** Las provincias de Cataluña en ISO 3166-2, el código con que las marca la capa de regiones de Natural Earth. */
const PROVINCIAS_DE_CATALUNA = new Set(['ES-B', 'ES-GI', 'ES-L', 'ES-T']);
/** Un código ISO 3166-1 alfa-3. */
const ISO3 = /^[A-Z]{3}$/;
/** Tope de cada llamada a ffmpeg, en milisegundos: reducir la textura tarda unos segundos; un ffmpeg colgado no cuelga. */
const PLAZO_DE_FFMPEG_MS = 120_000;
/** El día en que se consultaron y descargaron los originales. */
const CONSULTA = '2026-10-11';
/** Lo que dice de su uso cada fuente, con sus palabras. */
const LICENCIAS = {
  nasa: 'NASA Images and Media Usage Guidelines: «NASA content – images, audio, video, and media files used in the rendition of 3-dimensional models, such as texture maps and polygon data in any format – generally are not subject to copyright in the United States.» Se reconoce a la NASA como fuente, sin sugerir su respaldo.',
  naturalEarth:
    'Natural Earth, Terms of Use: «All versions of Natural Earth raster + vector map data found on this website are in the public domain.» Fronteras de facto; el mapa no toma posición sobre las fronteras en disputa.',
} as const;
/** Cada original: su archivo en --originales, de dónde se bajó, la página que lo describe, su licencia y su huella. */
const ORIGINALES = {
  textura: {
    archivo: 'world.topo.bathy.200407.3x5400x2700.jpg',
    url: 'https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73751/world.topo.bathy.200407.3x5400x2700.jpg',
    pagina: 'https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-topography-bathymetry/',
    autoria: 'NASA Earth Observatory, Blue Marble: Next Generation (julio de 2004, con relieve y fondo marino)',
    licencia: LICENCIAS.nasa,
    sha256: '4f4240673a3a1b173d61b92ca4b07bac5fd17059ea5f725ba6da5a9c5386b7ba',
  },
  paises: {
    archivo: 'ne_110m_admin_0_countries.geojson',
    url: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_110m_admin_0_countries.geojson',
    pagina: 'https://www.naturalearthdata.com/downloads/110m-cultural-vectors/110m-admin-0-countries/',
    autoria: 'Natural Earth 5.1.2, Admin 0 – Countries, 1:110 m',
    licencia: LICENCIAS.naturalEarth,
    sha256: '6866c877d39cba9c357620878839b336d569f8c662d3cfab4cb1dbe2d39c977f',
  },
  regiones: {
    archivo: 'ne_10m_admin_1_states_provinces.geojson',
    url: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_1_states_provinces.geojson',
    pagina: 'https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-1-states-provinces/',
    autoria: 'Natural Earth 5.1.2, Admin 1 – States, Provinces, 1:10 m (solo las cuatro provincias de Cataluña)',
    licencia: LICENCIAS.naturalEarth,
    sha256: '22d0e3ad85eb3e27f17cabf8ba2d50e554fbc27a87796ff891d958185da62fb5',
  },
} as const;

/** Un original de ORIGINALES. */
type Original = (typeof ORIGINALES)[keyof typeof ORIGINALES];
/** Un elemento de una colección GeoJSON: sus propiedades y su geometría, sin comprobar todavía. */
interface Elemento {
  propiedades: Record<string, unknown>;
  geometria: unknown;
}
/**
 * Un territorio de fronteras.json. El contrato del archivo lo fija su lector, web/scripts/globo/fronteras.js
 * (leerFronteras), y prepararFronteras lo pasa por él antes de escribir: este tipo solo describe lo que se construye.
 * `dentro_de` es el nombre del miembro en el JSON (el territorio que lo contiene), no un identificador del código.
 */
interface Territorio {
  codigo: string;
  centro: Punto;
  dentro_de?: string;
  anillos: number[][];
}

/** SHA-256 de los bytes del original o resultado local. */
function sha256(contenido: Buffer): string {
  return createHash('sha256').update(contenido).digest('hex');
}

/** Un original cuya huella no es la fijada: otro archivo, otra versión o una descarga cortada. */
class HuellaDistinta extends Error {
  override name = 'HuellaDistinta';
}

/** Un registro (objeto que no es lista). */
function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

/** El contenido de un original, si su huella es la fijada; si no, HuellaDistinta. */
function leerOriginal(carpeta: string, { archivo, sha256: esperada }: Original): Buffer {
  const contenido = readFileSync(join(carpeta, archivo));
  const huella = sha256(contenido);
  if (huella !== esperada) {
    throw new HuellaDistinta(`${archivo}: su SHA-256 es ${huella} y se esperaba ${esperada}`);
  }
  return contenido;
}

/** Los elementos de una colección GeoJSON (RFC 7946, 3.3). */
function elementosDe(contenido: Buffer, archivo: string): Elemento[] {
  const coleccion: unknown = JSON.parse(contenido.toString('utf8'));
  if (!esRegistro(coleccion) || !Array.isArray(coleccion.features)) {
    throw new GeometriaInvalida(`${archivo}: no es una FeatureCollection`);
  }
  return coleccion.features.map((elemento: unknown) => {
    if (!esRegistro(elemento) || !esRegistro(elemento.properties)) {
      throw new GeometriaInvalida(`${archivo}: un elemento sin propiedades`);
    }
    return { propiedades: elemento.properties, geometria: elemento.geometry };
  });
}

/**
 * El código de un país: ISO 3166-1 alfa-3 de facto (ISO_A3_EH), el que usan los datos; si Natural Earth no tiene
 * ninguno (Kosovo, Somalilandia, el norte de Chipre), su código propio (ADM0_A3), que no casará con ningún dato.
 */
function codigoDePais(propiedades: Record<string, unknown>): string {
  const { ISO_A3_EH: iso, ADM0_A3: propio } = propiedades;
  if (typeof iso === 'string' && ISO3.test(iso)) {
    return iso;
  }
  if (typeof propio === 'string' && ISO3.test(propio)) {
    return propio;
  }
  throw new GeometriaInvalida(`un país sin código: ${String(propiedades.NAME)}`);
}

/** Un territorio con sus anillos codificados; los que el redondeo deja sin superficie se quitan. */
function territorio(codigo: string, centro: Punto, anillos: readonly Anillo[], dentroDe?: string): Territorio {
  const codificados = anillos.map((anillo) => codificar(anillo, ESCALA)).filter((anillo) => anillo !== null);
  if (!codificados.length) {
    throw new GeometriaInvalida(`${codigo}: ningún anillo sobrevive al redondeo`);
  }
  return { codigo, centro, ...(dentroDe ? { dentro_de: dentroDe } : {}), anillos: codificados };
}

/** Los países de la capa 1:110 m, centrados en el punto donde Natural Earth pone su nombre (LABEL_X, LABEL_Y). */
function paises(elementos: readonly Elemento[]): Territorio[] {
  return elementos.map(({ propiedades, geometria }) => {
    const codigo = codigoDePais(propiedades);
    const { LABEL_X: longitud, LABEL_Y: latitud } = propiedades;
    if (typeof longitud !== 'number' || typeof latitud !== 'number') {
      throw new GeometriaInvalida(`${codigo}: sin punto para el nombre`);
    }
    const centro: Punto = [redondearAEscala(longitud), redondearAEscala(latitud)];
    return territorio(codigo, centro, anillosDeGeometria(geometria));
  });
}

/** Cataluña (ES51, su código NUTS 2): la unión de sus cuatro provincias, simplificada, dentro de España. */
function cataluna(elementos: readonly Elemento[]): Territorio {
  const provincias = elementos.filter(({ propiedades }) => PROVINCIAS_DE_CATALUNA.has(String(propiedades.iso_3166_2)));
  if (provincias.length !== PROVINCIAS_DE_CATALUNA.size) {
    throw new GeometriaInvalida(`se esperaban ${PROVINCIAS_DE_CATALUNA.size} provincias y hay ${provincias.length}`);
  }
  const contorno = contornoDeLaUnion(provincias.flatMap(({ geometria }) => anillosDeGeometria(geometria)));
  const simplificado = contorno.map((anillo) => simplificar(anillo, TOLERANCIA_CATALUNA_GRADOS));
  return territorio('ES51', centroDeLaCaja(simplificado), simplificado, 'ESP');
}

/** Todos los territorios, por su código y sin repetir ninguno. */
function territorios(carpeta: string): Territorio[] {
  const todos = [
    ...paises(elementosDe(leerOriginal(carpeta, ORIGINALES.paises), ORIGINALES.paises.archivo)),
    cataluna(elementosDe(leerOriginal(carpeta, ORIGINALES.regiones), ORIGINALES.regiones.archivo)),
  ].sort((a, b) => compararPorCodigo(a.codigo, b.codigo));
  const repetidos = todos.filter((uno, i) => todos[i - 1]?.codigo === uno.codigo).map(({ codigo }) => codigo);
  if (repetidos.length) {
    throw new GeometriaInvalida(`códigos repetidos: ${repetidos.join(', ')}`);
  }
  return todos;
}

/**
 * Prepara fronteras.json con el formato del repositorio (Biome agrupa las listas de números en líneas de 120), después
 * de comprobar que la web lo lee: leerFronteras lanza FronterasInvalidas si no tiene la forma de su contrato.
 */
function prepararFronteras(carpeta: string): string {
  const ruta = join(CARPETA, 'fronteras.json');
  const fronteras = { version: '1', escala: ESCALA, territorios: territorios(carpeta) };
  leerFronteras(fronteras);
  return formatearTextoConBiome(`${JSON.stringify(fronteras)}\n`, ruta);
}

/** Los argumentos de ffmpeg que reducen la textura de `entrada` a `salida`. */
function argumentosDeLaTextura(entrada: string, salida: string): string[] {
  return [
    ...['-v', 'error', '-y', '-i', entrada],
    ...['-vf', `scale=${TEXTURA.ancho}:${TEXTURA.alto}:flags=lanczos`, '-q:v', String(TEXTURA.calidad)],
    ...['-map_metadata', '-1', '-fflags', '+bitexact', '-flags:v', '+bitexact', salida],
  ];
}

/**
 * Prepara tierra.jpg en la salida temporal desde el original, con ffmpeg. leerOriginal verifica su huella antes;
 * ffmpeg lee después el archivo por su ruta: sin metadatos y en modo exacto (bitexact), para que la misma versión de ffmpeg dé los mismos
 * bytes. Devuelve la versión de ffmpeg y la orden con rutas relativas, que quedan anotadas en la procedencia.
 */
function prepararTextura(carpeta: string, salida: string): [string, string] {
  leerOriginal(carpeta, ORIGINALES.textura);
  execFileSync('ffmpeg', argumentosDeLaTextura(join(carpeta, ORIGINALES.textura.archivo), salida), {
    stdio: 'pipe',
    timeout: PLAZO_DE_FFMPEG_MS,
  });
  const version =
    execFileSync('ffmpeg', ['-version'], { encoding: 'utf8', timeout: PLAZO_DE_FFMPEG_MS }).split('\n')[0] ?? '';
  const anotada = argumentosDeLaTextura(`<originales>/${ORIGINALES.textura.archivo}`, 'web/recursos/globo/tierra.jpg');
  return [version, `ffmpeg ${anotada.join(' ')}`];
}

/** La huella y el tamaño de los bytes preparados. */
function resultado(contenido: Buffer): { sha256: string; bytes: number } {
  return { sha256: sha256(contenido), bytes: contenido.length };
}

/** Prepara todos los bytes antes de publicar: un fallo de insumo, ffmpeg o formato no cambia resultados previos. */
function prepararRecursos(carpeta: string, temporal: string) {
  const fronteras = prepararFronteras(carpeta);
  const salida = join(temporal, 'tierra.jpg');
  const [ffmpeg, ordenDeLaTextura] = prepararTextura(carpeta, salida);
  const tierra = readFileSync(salida);
  const procedencia = {
    consulta: CONSULTA,
    originales: ORIGINALES,
    resultados: {
      'tierra.jpg': { ...resultado(tierra), de: ['textura'], como: ordenDeLaTextura, con: ffmpeg },
      'fronteras.json': {
        ...resultado(Buffer.from(fronteras)),
        de: ['paises', 'regiones'],
        como: 'node herramientas/web/traer-globo.ts --originales <originales>',
      },
    },
  };
  return {
    fronteras,
    tierra,
    procedencia: formatearTextoConBiome(`${JSON.stringify(procedencia, null, 2)}\n`, join(CARPETA, 'procedencia.json')),
  };
}

/** Publica solo después de preparar los tres resultados; no garantiza una transacción ante fallos de escritura. */
function principal(): void {
  const { values } = orden('node herramientas/web/traer-globo.ts --originales <carpeta>').leer({
    options: { originales: { type: 'string' } },
  });
  const carpeta = values.originales;
  if (!carpeta) {
    throw new Error('falta --originales <carpeta> con los originales descargados');
  }
  const temporal = mkdtempSync(join(tmpdir(), 'globo-recursos-'));
  try {
    const recursos = prepararRecursos(carpeta, temporal);
    writeFileSync(join(CARPETA, 'fronteras.json'), recursos.fronteras);
    writeFileSync(join(CARPETA, 'tierra.jpg'), recursos.tierra);
    writeFileSync(join(CARPETA, 'procedencia.json'), recursos.procedencia);
  } finally {
    rmSync(temporal, { recursive: true, force: true });
  }
  console.log(`Recursos del globo en ${CARPETA}`);
}

if (import.meta.main) {
  await ejecutar(principal);
}
