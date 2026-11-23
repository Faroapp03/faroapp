// Política de moderación, pensada para no rechazar trabajos legítimos:
// - La violencia a secas no bloquea: aparece en chapistas («arreglo golpes»), carniceros, bomberos o policías.
// - «self-harm» a secas no bloquea: una enfermera de psiquiatría describe intentos de suicidio. Solo la intención
//   o las instrucciones de autolesión detienen el proceso y muestran el 024.
// - Odio, amenazas y violencia ilícita bloquean solo con puntuación alta; el contenido sexual con menores, siempre.
// La política común recibe categorías del moderador local del recorrido y decide el aviso en cada idioma.
// El consumidor prepara el texto y aporta el moderador; este módulo no abre conexiones de red.

import { BLOQUEAN_SI_ALTA, BLOQUEAN_SIEMPRE, PIDEN_AYUDA } from '../comun/categorias-moderacion.ts';
import type { Idioma } from '../comun/idioma.ts';
import { AVISO_AYUDA, AVISO_AYUDA_CA, AVISO_FUERA_DE_TEMA, AVISO_FUERA_DE_TEMA_CA, type Aviso } from './avisos.ts';

/** Qué se hace con un texto: seguir, parar y ofrecer ayuda (024) o parar con el aviso de fuera de tema. */
export type DecisionModeracion = 'seguir' | 'ayuda' | 'bloquear';

/** Código compartido para expresar que la moderación ha detenido el procesamiento. */
export const CONTENIDO_NO_ADMITIDO = 'contenido no admitido';

/**
 * Umbral de la política para las categorías de BLOQUEAN_SI_ALTA. Permite procesar relatos legítimos sobre
 * conflictos en seguridad, sanidad y otros oficios. Sus bordes y falsos rechazos se comprueban en
 * pruebas/seguridad/seguridad-moderacion.test.ts; no representa una medición de exposición laboral a la IA.
 */
const PUNTUACION_ALTA = 0.8;

/** El aviso con que se para cada decisión que no es seguir, en cada idioma. */
const AVISOS_DE_PARADA: Record<Idioma, Record<Exclude<DecisionModeracion, 'seguir'>, Aviso>> = {
  es: { ayuda: { tipo: 'ayuda', texto: AVISO_AYUDA }, bloquear: { tipo: 'fuera-de-tema', texto: AVISO_FUERA_DE_TEMA } },
  ca: {
    ayuda: { tipo: 'ayuda', texto: AVISO_AYUDA_CA },
    bloquear: { tipo: 'fuera-de-tema', texto: AVISO_FUERA_DE_TEMA_CA },
  },
};

/** Resultado del moderador: las categorías que marca y, si las da, sus puntuaciones. */
interface ResultadoModeracion {
  categorias: string[];
  puntuaciones?: Record<string, number>;
}

/** Contrato del moderador aportado por el consumidor; la política no depende de su implementación. */
export interface Moderador {
  moderar?(texto: string): Promise<ResultadoModeracion>;
}

/** Lo que sale de moderar un texto: las categorías que marcó el moderador y el aviso con que se para, si se para. */
export interface Moderado {
  /** Solo los nombres de las categorías, para medir; sin moderación configurada, ninguna. */
  categorias: string[];
  /** El aviso con que se para, en el idioma pedido, o null si se sigue. */
  aviso: Aviso | null;
}

/** Si `categoria` es una de `lista` (las listas de comun/categorias-moderacion.ts). */
function esDe(lista: readonly string[], categoria: string): boolean {
  return lista.includes(categoria);
}

/**
 * Aplica la política de la cabecera a las categorías que marcó la moderación y a sus puntuaciones.
 *
 * @param categorias - Las categorías marcadas por el moderador.
 * @param puntuaciones - Las puntuaciones de cada categoría.
 * @returns La decisión: dejar pasar, bloquear o pedir ayuda.
 */
export function decidirModeracion(
  categorias: readonly string[],
  puntuaciones: Record<string, number> = {},
): DecisionModeracion {
  if (categorias.some((categoria) => esDe(PIDEN_AYUDA, categoria))) {
    return 'ayuda';
  }
  if (categorias.some((categoria) => esDe(BLOQUEAN_SIEMPRE, categoria))) {
    return 'bloquear';
  }
  // Una categoría marcada sin puntuación cuenta como alta, según la política común.
  const alta = (categoria: string): boolean => (puntuaciones[categoria] ?? 1) >= PUNTUACION_ALTA;
  if (categorias.some((categoria) => esDe(BLOQUEAN_SI_ALTA, categoria) && alta(categoria))) {
    return 'bloquear';
  }
  return 'seguir';
}

/**
 * Aplica el moderador al texto recibido y devuelve sus categorías y el aviso de la política en `idioma`.
 * Si no se aporta una función de moderación, devuelve un resultado sin categorías ni aviso.
 * Los errores del moderador se propagan para que el consumidor no los confunda con una comprobación válida.
 *
 * @param moderador - El moderador que se consulta.
 * @param texto - El texto de la persona.
 * @param idioma - El idioma del aviso, por defecto el castellano.
 * @returns La decisión y, si no deja pasar, el aviso para la persona.
 */
export async function moderarAntesDelModelo(
  moderador: Moderador,
  texto: string,
  idioma: Idioma = 'es',
): Promise<Moderado> {
  if (!moderador.moderar) {
    return { categorias: [], aviso: null };
  }
  const { categorias, puntuaciones } = await moderador.moderar(texto);
  const decision = decidirModeracion(categorias, puntuaciones);
  return { categorias, aviso: decision === 'seguir' ? null : { ...AVISOS_DE_PARADA[idioma][decision] } };
}
