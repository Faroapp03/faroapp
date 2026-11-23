// La procedencia de una medición (el objeto `base` de la salida): qué medidor, con qué opciones, sobre qué versión del
// producto y con qué bancos. No lleva rutas: el producto medido se identifica por sus huellas.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Banco } from './bancos.ts';
import { BANCOS_DE_REFERENCIA } from './bancos.ts';
import type { Opciones } from './opciones.ts';
import { VERSION_DEL_RUIDO } from './ruido.ts';
import type { Motor } from './tipos.ts';

export const VERSION_DEL_SIMULADOR = 2;

/** Las opciones que dan las tres variantes de referencia: normal, --ruido personas y --sin-vectores. */
const OPCIONES_DE_LA_REFERENCIA = new Set([
  '--producto',
  '--bancos',
  '--salida',
  '--etiqueta',
  '--traza',
  '--sin-vectores',
  '--ruido',
]);
/** Las opciones cuyo valor es una ruta: en `base` se guardan como «(ruta)». */
const CON_RUTA = new Set(['--producto', '--bancos', '--salida', '--casos', '--clasificador', '--banco']);

const sha = (contenido: string | Buffer): string => createHash('sha256').update(contenido).digest('hex');
export const huellaArchivo = (archivo: string): string => sha(readFileSync(archivo));

function archivosDe(carpeta: string): string[] {
  return readdirSync(carpeta)
    .flatMap((nombre) => {
      const ruta = join(carpeta, nombre);
      return statSync(ruta).isDirectory() ? archivosDe(ruta) : [ruta];
    })
    .sort();
}

/** Huella de una carpeta: sus rutas relativas y la huella de cada archivo, en orden. */
export function huellaCarpeta(carpeta: string): string {
  return sha(
    archivosDe(carpeta)
      .map((f) => `${relative(carpeta, f)} ${huellaArchivo(f)}`)
      .join('\n'),
  );
}

const sinRutas = (lista: readonly string[]): string[] =>
  lista.map((x, i) => (i > 0 && CON_RUTA.has(lista[i - 1] ?? '') ? '(ruta)' : x));

/**
 * «original» solo con los tres bancos de referencia enteros (sin --banco, --casos ni --limite), en su orden, con sus
 * huellas, sus claves de ruido y sus nombres: el nombre va en cada resultado, así que con otro ya no son los de la
 * referencia.
 */
function origenDeLosBancos(opciones: Opciones, bancos: readonly Banco[]): string {
  const enteros = !opciones.banco && !opciones.casos && !opciones.limite;
  const deReferencia =
    bancos.length === BANCOS_DE_REFERENCIA.length &&
    bancos.every((b, i) => {
      const referencia = BANCOS_DE_REFERENCIA[i];
      return (
        huellaArchivo(b.archivo) === referencia?.sha256 &&
        b.claveDeRuido === referencia.claveDeRuido &&
        b.nombre === referencia.nombre
      );
    });
  return enteros && deReferencia ? 'original' : 'derivado';
}

/** Comparable con la referencia: bancos de referencia y solo las opciones de las tres variantes. */
function comparable(opciones: Opciones, origen: string): boolean {
  const soloDeLaReferencia = opciones.args
    .filter((a) => a.startsWith('--'))
    .every((a) => OPCIONES_DE_LA_REFERENCIA.has(a));
  // Exactamente una de las tres variantes (normal, --ruido personas o --sin-vectores; no ruido y sin vectores a la vez),
  // y con --traza, porque sin traza los resultados tienen otra forma.
  const conRuido = opciones.ruido === 'personas';
  const unaVariante = (opciones.ruido === null || conRuido) && !(conRuido && !opciones.conVectores);
  return origen === 'original' && soloDeLaReferencia && opciones.traza && unaVariante;
}

function huellasDelProducto(opciones: Opciones, bancos: readonly Banco[]): object {
  const p = opciones.producto;
  const motor = (ruta: string): string => huellaArchivo(join(p, 'motores/ocupaciones', ruta));
  return {
    codigo_src: huellaCarpeta(join(p, 'src')),
    // El motor medido, por su sello (motores/ocupaciones/sello.json).
    sello_motor: motor('sello.json'),
    atributos: motor('src/recorrido/preguntas/atributos.json'),
    modelo_lexico: motor('modelos/modelo-lexico.json'),
    modelo_estatico: motor('modelos/modelo-estatico.json'),
    vectores_movil: opciones.conVectores ? huellaArchivo(join(p, 'datos/vectores-movil.json')) : null,
    manifiesto_datos: huellaArchivo(join(p, 'datos/manifiesto.json')),
    bancos: Object.fromEntries(bancos.map((b) => [b.nombre, huellaArchivo(b.archivo)])),
  };
}

/**
 * El objeto `base` de la salida, con sus campos en un orden fijo, porque la salida se compara byte a byte.
 *
 * @param opciones - Las opciones de la medición.
 * @param motor - El motor medido.
 * @param bancos - Los bancos medidos.
 * @param medicion - Los segundos que tardó y la huella del medidor.
 * @returns La procedencia.
 */
export function procedencia(
  opciones: Opciones,
  motor: Motor,
  bancos: readonly Banco[],
  medicion: { segundos: number; medidor: string },
): object {
  const origen = origenDeLosBancos(opciones, bancos);
  return {
    etiqueta: opciones.etiqueta,
    simulador: VERSION_DEL_SIMULADOR,
    producto: opciones.producto === opciones.porOmision ? 'este' : 'otro (--producto)',
    medido: new Date().toISOString(),
    segundos: medicion.segundos,
    vectores: opciones.conVectores,
    traza: opciones.traza,
    clasificador: motor.huellaDelClasificador,
    ruido: opciones.ruido ?? null,
    semilla: opciones.semilla ?? null,
    ...(opciones.respuestaEstable ? { respuestaEstable: true } : {}),
    ...(opciones.sensibilidadAlternativas ? { sensibilidadAlternativas: true } : {}),
    medidor: { sha256: medicion.medidor, opciones: sinRutas(opciones.args), versionDelRuido: VERSION_DEL_RUIDO },
    origen_bancos: origen,
    comparable_con_la_referencia: comparable(opciones, origen),
    huellas: huellasDelProducto(opciones, bancos),
  };
}
