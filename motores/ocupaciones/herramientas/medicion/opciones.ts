// Las opciones de la línea de órdenes del medidor. Se leen como «--nombre valor», y una opción sin valor
// detrás vale true (por eso los tipos admiten boolean).

import { join } from 'node:path';

/** Pasos como mucho de un recorrido simulado si no se da --max-pasos. */
const MAX_PASOS_POR_OMISION = 20;

export interface Opciones {
  readonly args: readonly string[];
  readonly producto: string;
  readonly porOmision: string;
  readonly bancos: string;
  readonly salida: string | boolean | null;
  readonly conVectores: boolean;
  readonly etiqueta: string | boolean;
  readonly limite: number;
  readonly clasificador: string | boolean | null;
  readonly sinClasificador: boolean;
  /** --ruido personas o --ruido persistente; null, sin ruido. */
  readonly ruido: string | boolean | null;
  /** --semilla N: otra tirada independiente del ruido. */
  readonly semilla: string | boolean | null;
  readonly respuestaEstable: boolean;
  readonly sensibilidadAlternativas: boolean;
  /** --banco nombre=archivo: un solo banco (entrada de regresión, origen «derivado»). */
  readonly banco: string | boolean | null;
  /** --casos archivo.json: solo esos casos («banco/id»), para cribar. */
  readonly casos: string | boolean | null;
  readonly traza: boolean;
  readonly maxPasos: number;
}

function leer(args: readonly string[], nombre: string, porOmision: string | null): string | boolean | null {
  const i = args.indexOf(nombre);
  return i >= 0 ? (args[i + 1] ?? true) : porOmision;
}

/**
 * Las opciones de la medición.
 *
 * @param args - Los argumentos de la línea de órdenes.
 * @param herramientas - La carpeta de este medidor (motores/ocupaciones/herramientas).
 * @returns Las opciones, con sus valores por omisión.
 */
export function leerOpciones(args: readonly string[], herramientas: string): Opciones {
  const porOmision = join(herramientas, '../../..');
  return {
    args,
    producto: String(leer(args, '--producto', porOmision)),
    porOmision,
    bancos: String(leer(args, '--bancos', join(herramientas, '../banco'))),
    salida: leer(args, '--salida', null),
    conVectores: !args.includes('--sin-vectores'),
    etiqueta: leer(args, '--etiqueta', 'actual') ?? 'actual',
    limite: Number(leer(args, '--limite', '0')),
    clasificador: leer(args, '--clasificador', null),
    sinClasificador: args.includes('--sin-clasificador'),
    ruido: leer(args, '--ruido', null),
    semilla: leer(args, '--semilla', null),
    respuestaEstable: args.includes('--respuesta-estable'),
    sensibilidadAlternativas: args.includes('--sensibilidad-alternativas'),
    banco: leer(args, '--banco', null),
    casos: leer(args, '--casos', null),
    traza: args.includes('--traza'),
    maxPasos: Number(leer(args, '--max-pasos', String(MAX_PASOS_POR_OMISION))),
  };
}
