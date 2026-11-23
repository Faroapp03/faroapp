// La lista cerrada de importaciones con dirección calculada. Las del real están aquí; las de cada extensión, en su
// registro (src/plataforma/extension.ts). Una importación calculada que no figura en la lista, o una de la lista que
// ya no aparece en su archivo, detiene la construcción: es el contrato del grafo emitido.

import { parse } from 'acorn';
import type { ImportacionCalculada } from '../../../src/plataforma/extension.ts';
import { EXTENSIONES } from '../../../src/plataforma/extensiones.ts';
import { CARPETA_DEL_MOTOR } from '../carpeta-del-motor.ts';

/** Una importación calculada vista en una fuente: el módulo, desde web/, y el argumento de import(). */
export interface Observada {
  readonly archivo: string;
  readonly argumento: string;
}

const REINTENTO =
  'Tras un fallo, el navegador recuerda la dirección exacta y no la vuelve a pedir: el nuevo intento añade una ' +
  'marca (#reintento-N). El módulo es una entrada con dirección estable del paquete, la misma que usa la ' +
  'importación literal.';
const MOTOR_POR_DIRECCION =
  'Módulo del motor empaquetado en su dirección fija; solo lo sirve el service worker desde lo comprobado, así que ' +
  'no puede formar parte del paquete de la página.';

/** Las importaciones calculadas del real. */
const DEL_REAL: readonly ImportacionCalculada[] = [
  ...(['es', 'ca'] as const).map((idioma) => ({
    archivo: 'idiomas/cargar.js',
    argumento: `new URL(\`./${idioma}.js\${marca}\`, import.meta.url).href`,
    tratamiento: 'reintento' as const,
    objetivo: `idiomas/${idioma}.js`,
    motivo: REINTENTO,
  })),
  {
    archivo: 'scripts/recorrido.js',
    argumento: `\`./recorrido/paso-informe.js#reintento-\${fallosDelPaso4}\``,
    tratamiento: 'reintento',
    objetivo: 'scripts/recorrido/paso-informe.js',
    motivo: REINTENTO,
  },
  ...(
    [
      ['scripts/recorrido/minimizar.js', 'PRIVACIDAD', 'seguridad/privacidad'],
      ['scripts/recorrido/minimizar.js', 'AVISOS', 'seguridad/avisos'],
      ['scripts/recorrido/minimizar.js', 'LIMITES', 'seguridad/limites'],
      ['scripts/recorrido/formacion/cliente.js', 'CALENDARIOS', 'catalogo-cursos/calendarios'],
      ['scripts/recorrido/formacion/cliente.js', 'FORMA', 'catalogo-cursos/forma'],
      ['scripts/motor-local/worker.js', 'MOTOR', 'plataforma/navegador/motor'],
    ] as const
  ).map(([archivo, argumento, modulo]) => ({
    archivo,
    argumento,
    tratamiento: 'motor' as const,
    objetivo: `${CARPETA_DEL_MOTOR}/src/${modulo}.js`,
    motivo: MOTOR_POR_DIRECCION,
  })),
];

/** Las importaciones calculadas admitidas: las del real y las que declara cada extensión instalada. */
export const IMPORTACIONES_CALCULADAS: readonly ImportacionCalculada[] = Object.freeze([
  ...DEL_REAL,
  ...EXTENSIONES.flatMap(({ importacionesCalculadas }) => importacionesCalculadas),
]);

function iguales(una: Observada, otra: Observada): boolean {
  return una.archivo === otra.archivo && una.argumento === otra.argumento;
}

/** La declaración de una importación calculada vista, si la lista la admite. */
export function declarada(
  observada: Observada,
  lista: readonly ImportacionCalculada[] = IMPORTACIONES_CALCULADAS,
): ImportacionCalculada | undefined {
  return lista.find((entrada) => iguales(entrada, observada));
}

/** El argumento de un nodo import() cuya dirección no es una cadena literal. */
function argumentoCalculado(nodo: Record<string, unknown>, codigo: string): string | undefined {
  if (nodo.type !== 'ImportExpression') {
    return undefined;
  }
  const fuente = nodo.source as { type: string; value?: unknown; start: number; end: number };
  return fuente.type === 'Literal' && typeof fuente.value === 'string'
    ? undefined
    : codigo.slice(fuente.start, fuente.end);
}

/** Los hijos de un nodo del árbol sintáctico, en el orden de sus propiedades; sin sus posiciones. */
function hijos(nodo: unknown): readonly unknown[] {
  if (nodo === null || typeof nodo !== 'object') {
    return [];
  }
  if (Array.isArray(nodo)) {
    return nodo;
  }
  return Object.entries(nodo).flatMap(([clave, valor]) =>
    clave !== 'loc' && typeof valor === 'object' ? [valor] : [],
  );
}

/** Los argumentos de import() que no son una cadena literal, en el orden en que aparecen en el código. */
export function argumentosCalculados(codigo: string): string[] {
  const argumentos: string[] = [];
  const recorrer = (nodo: unknown): void => {
    if (nodo !== null && typeof nodo === 'object' && !Array.isArray(nodo)) {
      const argumento = argumentoCalculado(nodo as Record<string, unknown>, codigo);
      if (argumento !== undefined) {
        argumentos.push(argumento);
      }
    }
    for (const hijo of hijos(nodo)) {
      recorrer(hijo);
    }
  };
  recorrer(parse(codigo, { ecmaVersion: 'latest', sourceType: 'module' }));
  return argumentos;
}

/**
 * Las importaciones calculadas que incumplen la lista cerrada: las vistas que no están declaradas, las declaradas de un
 * archivo presente que ya no aparecen y las declaradas de un archivo que ya no forma parte de la construcción.
 *
 * @param observadas - Las importaciones calculadas que se han visto al empaquetar.
 * @param existe - Si un archivo de la web forma parte de la construcción.
 * @param lista - La lista cerrada; por omisión, la del real y las extensiones instaladas.
 * @returns Un problema por incumplimiento; vacío si la lista cuadra.
 */
export function problemasDeCalculadas(
  observadas: readonly Observada[],
  existe: (archivo: string) => boolean,
  lista: readonly ImportacionCalculada[] = IMPORTACIONES_CALCULADAS,
): string[] {
  const noDeclaradas = observadas.filter((observada) => declarada(observada, lista) === undefined);
  const sinArchivo = lista.filter((entrada) => !existe(entrada.archivo));
  const sinUso = lista.filter(
    (entrada) => existe(entrada.archivo) && !observadas.some((observada) => iguales(observada, entrada)),
  );
  return [
    ...noDeclaradas.map(
      ({ archivo, argumento }) => `${archivo}: importación calculada no declarada: import(${argumento})`,
    ),
    ...sinArchivo.map(
      ({ archivo, argumento }) => `${archivo}: declara import(${argumento}), pero el archivo ya no existe`,
    ),
    ...sinUso.map(({ archivo, argumento }) => `${archivo}: la importación calculada import(${argumento}) ya no existe`),
  ];
}

/** Las importaciones calculadas vistas, por archivo y sin repetir, para el resumen del grafo. */
export function resumenDeCalculadas(observadas: readonly Observada[]): Observada[] {
  return [...new Set(observadas.map(({ archivo }) => archivo))]
    .sort()
    .flatMap((archivo) =>
      [...new Set(observadas.filter((i) => i.archivo === archivo).map(({ argumento }) => argumento))].map(
        (argumento) => ({ archivo, argumento }),
      ),
    );
}
