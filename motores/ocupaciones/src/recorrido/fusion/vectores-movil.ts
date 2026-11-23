// Los vectores del recorrido en el dispositivo: la tabla estática palabra → vector de 256 dimensiones en
// int8, destilada de Faro IA Vectores 1. Da, para lo que escribe la persona, las 50 ocupaciones ESCO y los 50 grupos
// CIUO-08 más parecidos, que la fusión calibrada (faro-fusion.ts) junta con el léxico.
//
// La fusión consume similitudes de ocupaciones y grupos; no se cargan ni calculan similitudes por tareas o
// títulos de grupo.
// JavaScript puro, sin WASM, eval ni red: los bytes llegan con `leer` y se comprueban contra su huella SHA-256 antes
// de usarlos (cargarVectores).
//
// Licencia de los datos: tabla derivada de EmbeddingGemma 2 (Google DeepMind, Apache-2.0; uso sujeto a la Gemma
// Prohibited Use Policy), ajustada y destilada por Faro con textos de ESCO (© Unión Europea, CC BY 4.0) y de la OIT.
// Ver datos/vectores-movil/LICENCIA.md.

import type { SimilitudesDeConsulta } from './faro-fusion.ts';

/** Ocupaciones y grupos que se devuelven (el contrato pide 50). */
const TOP = 50;
/** Prefijos con que se busca una palabra que no está en el vocabulario: de 5 a 10 letras. */
const PREFIJO_MINIMO = 5;
const PREFIJO_MAXIMO = 10;
/** Similitudes redondeadas a 5 decimales, como el original. */
const REDONDEO = 1e5;
const PALABRA = /[a-záéíóúàèòïüñç·'’]+/gi;
/** Las matrices de documentos con que se puntúa cada ocupación: su título es, su título ca y sus alternativos es. */
const MATRICES = ['ocup_es', 'ocup_ca', 'alt_es'] as const;
type Matriz = (typeof MATRICES)[number];

/** Los archivos de la tabla que se cargan, en `datos/vectores-movil/`. */
export const ARCHIVOS_DE_VECTORES = [
  'vocabulario.json',
  'indices.json',
  'palabras.i8',
  'palabras.escala.f32',
  'palabras.peso.f32',
  ...MATRICES.flatMap((m) => [`${m}.i8`, `${m}.escala.f32`]),
] as const;
type ArchivoDeVectores = (typeof ARCHIVOS_DE_VECTORES)[number];

/** El índice: dimensión, códigos de ocupaciones y grupos y a qué ocupación va cada fila de cada matriz. */
interface Indices {
  readonly dim: number;
  readonly ocupaciones: readonly string[];
  readonly grupos: readonly string[];
  readonly grupo_de_ocupacion: readonly number[];
  readonly destino: Readonly<Record<Matriz, readonly number[]>>;
}

interface Documentos {
  readonly m: Int8Array;
  readonly e: Float32Array;
  readonly destino: Int32Array;
}

export interface VectoresMovil {
  /** Las 50 ocupaciones y los 50 grupos más parecidos; listas vacías si no se reconoce ninguna palabra. */
  similitudes(texto: string, idioma?: 'es' | 'ca'): SimilitudesDeConsulta;
  readonly dimension: number;
  readonly palabras: number;
}

class VectoresInvalidos extends Error {
  override name = 'VectoresInvalidos';
}

function clave(p: string): string {
  return p
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .replaceAll('·', '');
}

/** La palabra o, si no está, la del vocabulario con el prefijo común más largo (de 10 a 5 letras). */
function indiceDePalabra(k: string, pos: ReadonlyMap<string, number>, prefijos: ReadonlyMap<string, number>) {
  const exacta = pos.get(k);
  if (exacta !== undefined) {
    return exacta;
  }
  for (let n = Math.min(k.length, PREFIJO_MAXIMO); n >= PREFIJO_MINIMO; n--) {
    const i = prefijos.get(k.slice(0, n));
    if (i !== undefined) {
      return i;
    }
  }
  return undefined;
}

function indicesDeLaConsulta(texto: string, pos: ReadonlyMap<string, number>, prefijos: ReadonlyMap<string, number>) {
  const idx: number[] = [];
  for (const p of texto.toLowerCase().replaceAll('’', "'").match(PALABRA) ?? []) {
    for (const q of p.split("'").filter(Boolean)) {
      const i = indiceDePalabra(clave(q), pos, prefijos);
      if (i !== undefined) {
        idx.push(i);
      }
    }
  }
  return idx;
}

function prefijosDe(vocab: readonly string[]): Map<string, number> {
  const prefijos = new Map<string, number>();
  vocab.forEach((k, i) => {
    for (let n = PREFIJO_MINIMO; n <= Math.min(k.length, PREFIJO_MAXIMO); n++) {
      if (!prefijos.has(k.slice(0, n))) {
        prefijos.set(k.slice(0, n), i);
      }
    }
  });
  return prefijos;
}

/** La tabla en memoria, lista para consultar. */
interface Tabla {
  readonly vocab: readonly string[];
  readonly indices: Indices;
  readonly w: Int8Array;
  readonly escala: Float32Array;
  readonly peso: Float32Array;
  readonly docs: Readonly<Record<Matriz, Documentos>>;
}

/** Media ponderada (peso SIF) de los vectores int8 de las palabras, normalizada; null si no hay ninguna. */
function vectorDeLaConsulta(idx: readonly number[], t: Tabla): Float32Array | null {
  const dim = t.indices.dim;
  if (!idx.length) {
    return null;
  }
  const v = new Float32Array(dim);
  const total = idx.reduce((s, i) => s + (t.peso[i] ?? 0), 0);
  for (const i of idx) {
    const f = ((t.peso[i] ?? 0) / total) * (t.escala[i] ?? 0);
    const base = i * dim;
    for (let j = 0; j < dim; j++) {
      v[j] = (v[j] ?? 0) + f * (t.w[base + j] ?? 0);
    }
  }
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  if (!n) {
    return null;
  }
  return v.map((x) => x / n);
}

function parecidos(v: Float32Array, d: Documentos, dim: number): Float32Array {
  const s = new Float32Array(d.e.length);
  for (let r = 0; r < d.e.length; r++) {
    let acc = 0;
    const base = r * dim;
    for (let j = 0; j < dim; j++) {
      acc += (v[j] ?? 0) * (d.m[base + j] ?? 0);
    }
    s[r] = acc * (d.e[r] ?? 0);
  }
  return s;
}

function mejores(valores: Float32Array, nombres: readonly string[]): [string, number][] {
  return Array.from(valores.keys())
    .sort((a, b) => (valores[b] ?? 0) - (valores[a] ?? 0))
    .slice(0, TOP)
    .map((i) => [nombres[i] ?? '', Math.round((valores[i] ?? 0) * REDONDEO) / REDONDEO]);
}

function crear(t: Tabla): VectoresMovil {
  const pos = new Map(t.vocab.map((k, i) => [k, i]));
  const prefijos = prefijosDe(t.vocab);
  const { dim, ocupaciones, grupos } = t.indices;
  const grupoDe = Int32Array.from(t.indices.grupo_de_ocupacion);
  return {
    dimension: dim,
    palabras: t.vocab.length,
    similitudes(texto) {
      const v = vectorDeLaConsulta(indicesDeLaConsulta(String(texto), pos, prefijos), t);
      if (!v) {
        return { ocupaciones: [], grupos: [] };
      }
      // Ocupación: coseno máximo con su título es, su título ca y sus alternativos. Grupo: máximo de sus ocupaciones.
      const so = new Float32Array(ocupaciones.length).fill(-1);
      for (const m of MATRICES) {
        const d = t.docs[m];
        parecidos(v, d, dim).forEach((s, r) => {
          const o = d.destino[r] ?? 0;
          so[o] = Math.max(so[o] ?? -1, s);
        });
      }
      const sg = new Float32Array(grupos.length).fill(-1);
      so.forEach((s, o) => {
        const g = grupoDe[o] ?? 0;
        sg[g] = Math.max(sg[g] ?? -1, s);
      });
      return { ocupaciones: mejores(so, ocupaciones), grupos: mejores(sg, grupos) };
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Carga comprobada

/** Las huellas SHA-256 (hexadecimal) de cada archivo de la tabla: `datos/vectores-movil/huellas.json`. */
type HuellasDeVectores = Readonly<Record<ArchivoDeVectores, string>>;

const BASE_HEXADECIMAL = 16;
const CIFRAS_POR_BYTE = 2;

async function sha256(bytes: Uint8Array): Promise<string> {
  const copia = new Uint8Array(bytes);
  const resumen = new Uint8Array(await crypto.subtle.digest('SHA-256', copia));
  return Array.from(resumen, (b) => b.toString(BASE_HEXADECIMAL).padStart(CIFRAS_POR_BYTE, '0')).join('');
}

function alineado(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function comprobarIndices(x: unknown): Indices {
  const i = x as Partial<Indices> | null;
  const destinos = MATRICES.every((m) => Array.isArray(i?.destino?.[m]));
  if (!(i && typeof i.dim === 'number' && Array.isArray(i.ocupaciones) && Array.isArray(i.grupos) && destinos)) {
    throw new VectoresInvalidos('vectores del móvil: indices.json no tiene la forma esperada');
  }
  return i as Indices;
}

/**
 * Carga la tabla con `leer` (los bytes de cada archivo de ARCHIVOS_DE_VECTORES) y comprueba cada archivo contra su
 * huella antes de usarlo: un archivo a medio bajar, cambiado o de otra versión no llega a la fusión.
 */
export async function cargarVectores(
  leer: (archivo: ArchivoDeVectores) => Promise<Uint8Array>,
  huellas: HuellasDeVectores,
): Promise<VectoresMovil> {
  const bytes = new Map<ArchivoDeVectores, Uint8Array>();
  await Promise.all(
    ARCHIVOS_DE_VECTORES.map(async (archivo) => {
      const b = await leer(archivo);
      if ((await sha256(b)) !== huellas[archivo]) {
        throw new VectoresInvalidos(`vectores del móvil: ${archivo} no coincide con su huella`);
      }
      bytes.set(archivo, b);
    }),
  );
  const de = (archivo: ArchivoDeVectores) => bytes.get(archivo) ?? new Uint8Array();
  const json = (archivo: ArchivoDeVectores): unknown => JSON.parse(new TextDecoder().decode(de(archivo)));
  const indices = comprobarIndices(json('indices.json'));
  const docs = Object.fromEntries(
    MATRICES.map((m) => [
      m,
      {
        m: new Int8Array(alineado(de(`${m}.i8`))),
        e: new Float32Array(alineado(de(`${m}.escala.f32`))),
        destino: Int32Array.from(indices.destino[m]),
      },
    ]),
  ) as Record<Matriz, Documentos>;
  return crear({
    vocab: json('vocabulario.json') as string[],
    indices,
    w: new Int8Array(alineado(de('palabras.i8'))),
    escala: new Float32Array(alineado(de('palabras.escala.f32'))),
    peso: new Float32Array(alineado(de('palabras.peso.f32'))),
    docs,
  });
}

/** El contenido de vectores-movil.json (herramientas/vectores-movil/empaquetar.ts): cada archivo en base64. */
interface ContenedorDeVectores {
  readonly formato: number;
  readonly huellas: HuellasDeVectores;
  readonly archivos: Readonly<Record<string, string>>;
}

/** Los bytes de un texto en base64, con atob, que tienen el navegador, el Worker y Node. */
function desdeBase64(texto: string): Uint8Array {
  const binario = atob(texto);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) {
    bytes[i] = binario.charCodeAt(i);
  }
  return bytes;
}

/**
 * Carga la tabla desde vectores-movil.json, ya comprobado contra su huella del manifiesto del paquete: cada archivo
 * sale de su base64 y vuelve a comprobarse contra la suya (cargarVectores).
 *
 * @param contenedor - El JSON de vectores-movil.json.
 * @returns La tabla lista para dar similitudes.
 * @throws VectoresInvalidos si no tiene la forma esperada o un archivo no coincide con su huella.
 */
export function cargarDesdeContenedor(contenedor: unknown): Promise<VectoresMovil> {
  const c = contenedor as Partial<ContenedorDeVectores> | null;
  if (!(c && c.formato === 1 && c.huellas && c.archivos)) {
    throw new VectoresInvalidos('vectores del móvil: vectores-movil.json no tiene la forma esperada');
  }
  const { archivos, huellas } = c;
  return cargarVectores(async (archivo) => desdeBase64(archivos[archivo] ?? ''), huellas);
}
