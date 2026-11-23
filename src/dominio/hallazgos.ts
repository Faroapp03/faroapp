// Hallazgos del informe: lo que más puede cambiar, lo que más depende de la persona y dónde está su ocupación en el
// índice de la OIT. Hablan solo de las tareas con datos y lo dicen cuando falta alguna. Los textos, en el idioma del
// informe, están en textos-informe.ts.

import { lista } from '../comun/formato.ts';
import type { Idioma } from '../comun/idioma.ts';
import type { TextosInforme } from './textos-informe.ts';
import type { Evidencia, Franja, Hallazgo, Informe, TareaInforme } from './tipos-informe.ts';

/** Las franjas de menor a mayor cambio, el orden en que se nombran las posibles. */
const ORDEN_DE_MENOR_A_MAYOR: readonly Franja[] = Object.freeze(['baja', 'media', 'alta']);

// Posición en el índice de la OIT, según la parte de las ocupaciones que tienen una nota media más alta: hasta el 15 %,
// entre las más expuestas; desde el 60 %, entre las menos expuestas; en medio, zona intermedia.
/** Hasta esta parte de las ocupaciones con nota más alta, la ocupación está entre las más expuestas. */
const PARTE_ENTRE_LAS_MAS_EXPUESTAS = 0.15;
/** Desde esta parte de las ocupaciones con nota más alta, la ocupación está entre las menos expuestas. */
const PARTE_ENTRE_LAS_MENOS_EXPUESTAS = 0.6;

type Posicion = Informe['ocupacion']['posicion'];
type TextosHallazgos = TextosInforme['hallazgos'];

/**
 * Con qué se escriben los hallazgos: sus textos, el idioma de las listas y si a Faro le faltan referencias para
 * estimar las tareas del grupo (sin ningún dato, el hallazgo lo da como motivo).
 */
interface EscrituraHallazgos {
  textos: TextosHallazgos;
  idioma: Idioma;
  sinReferencias: boolean;
}

/** Si todas las tareas tienen la nota de la OIT (ninguna es una estimación de Faro). */
function todasDeLaOit(tareas: readonly TareaInforme[]): boolean {
  return tareas.every((tarea) => tarea.evidencia === 'estimacion-oit');
}

/** Evidencia de un hallazgo: la de la OIT solo si todas sus tareas la tienen. */
function evidenciaDe(tareas: readonly TareaInforme[]): Evidencia {
  return todasDeLaOit(tareas) ? 'estimacion-oit' : 'estimacion-faro';
}

/** De quién son las notas de unas tareas con datos: todas de la OIT, de las dos fuentes o todas de Faro. */
function procedenciaDe(tareas: readonly TareaInforme[]): 'oit' | 'mixta' | 'faro' {
  if (todasDeLaOit(tareas)) {
    return 'oit';
  }
  return tareas.some((tarea) => tarea.evidencia === 'estimacion-oit') ? 'mixta' : 'faro';
}

/** La nota al pie del hallazgo según el origen de las notas de sus tareas. */
function detalleDe(tareas: readonly TareaInforme[], textos: TextosHallazgos): string {
  return { oit: textos.detalleOit, mixta: textos.detalleOitYFaro, faro: textos.detalleFaro }[procedenciaDe(tareas)];
}

// «Según la OIT» solo si todas las notas son de la OIT; si alguna es de Faro, se dice, y si lo son todas, solo Faro.
function segunQuien(tareas: readonly TareaInforme[], textos: TextosHallazgos): string {
  return { oit: textos.segunOit, mixta: textos.segunOitYFaro, faro: textos.segunFaro }[procedenciaDe(tareas)];
}

/** Los nombres de las tareas en minúsculas, unidos con la lista del idioma. */
function nombresEnMinusculas(tareas: readonly TareaInforme[], idioma: Idioma): string {
  return lista(
    tareas.map((tarea) => tarea.nombre.toLowerCase()),
    idioma,
  );
}

/** Las franjas que abarcan los márgenes y las notas de unas tareas, de menor a mayor cambio. */
function franjasPosiblesDe(tareas: readonly TareaInforme[]): Franja[] {
  const abarcadas = new Set(
    tareas.flatMap((tarea) => [...(tarea.franjasPosibles ?? []), ...(tarea.franja ? [tarea.franja] : [])]),
  );
  return ORDEN_DE_MENOR_A_MAYOR.filter((franja) => abarcadas.has(franja));
}

/**
 * Lo que más puede cambiar; si ninguna tarea está en la franja alta, se dice. `deLas` acota a las que tienen datos. Si
 * el margen de alguna cruza de franja, el título nombra las franjas posibles en vez de dar la alta por hecha.
 */
function hallazgoLoQueMasCambia(
  conDatos: readonly TareaInforme[],
  deLas: string,
  { textos, idioma }: EscrituraHallazgos,
): Hallazgo {
  const altas = conDatos.filter((tarea) => tarea.franja === 'alta');
  if (!altas.length) {
    return {
      titulo: textos.ningunaAlta(deLas),
      texto: textos.ningunaAltaTexto,
      evidencia: evidenciaDe(conDatos),
      detalle: detalleDe(conDatos, textos),
    };
  }
  const [desde, ...resto] = franjasPosiblesDe(altas);
  const hasta = resto.at(-1);
  const nombres = nombresEnMinusculas(altas, idioma);
  return {
    titulo:
      desde && hasta
        ? textos.loQueMasCambiaEntreFranjas(nombres, textos.franjas[desde], textos.franjas[hasta], altas.length > 1)
        : textos.loQueMasCambia(nombres),
    texto: textos.loQueMasCambiaTexto(segunQuien(altas, textos)),
    evidencia: evidenciaDe(altas),
    detalle: detalleDe(altas, textos),
  };
}

/** Lo que más depende de la persona; si ninguna tarea está en la franja baja, se dice. */
function hallazgoLoQueDependeDeTi(
  conDatos: readonly TareaInforme[],
  deLas: string,
  { textos, idioma }: EscrituraHallazgos,
): Hallazgo {
  const bajas = conDatos.filter((tarea) => tarea.franja === 'baja');
  if (!bajas.length) {
    return {
      titulo: textos.todasCambian(deLas),
      texto: textos.todasCambianTexto,
      evidencia: evidenciaDe(conDatos),
      detalle: detalleDe(conDatos, textos),
    };
  }
  return {
    titulo: textos.loQueDependeDeTi(nombresEnMinusculas(bajas, idioma)),
    texto: textos.loQueDependeDeTiTexto,
    evidencia: evidenciaDe(bajas),
    detalle: detalleDe(bajas, textos),
  };
}

/** El título de la posición según la parte de las ocupaciones que tienen una nota media más alta. */
function tituloDePosicion(parteMasAltas: number, textos: TextosHallazgos): string {
  if (parteMasAltas <= PARTE_ENTRE_LAS_MAS_EXPUESTAS) {
    return textos.entreLasMasExpuestas;
  }
  if (parteMasAltas >= PARTE_ENTRE_LAS_MENOS_EXPUESTAS) {
    return textos.entreLasMenosExpuestas;
  }
  return textos.zonaIntermedia;
}

/**
 * Dónde está la ocupación en el índice de la OIT. informe.ts solo construye la posición si la ocupación tiene
 * media; el total incluye esa ocupación y es positivo. Es un dato del grupo, nunca una previsión sobre la persona.
 */
function hallazgoPosicion(posicion: NonNullable<Posicion>, textos: TextosHallazgos): Hallazgo {
  return {
    titulo: tituloDePosicion(posicion.masAltas / posicion.total, textos),
    texto: textos.posicion(posicion.masAltas, posicion.total),
    evidencia: 'dato-publicado',
    detalle: textos.detallePosicion,
  };
}

/**
 * Sin ninguna tarea con datos, un solo hallazgo que lo dice, y por qué si a Faro le faltan referencias para estimar,
 * con las claves en el mismo orden que los demás.
 */
function hallazgoSinDatos({ textos: { sinDatos }, sinReferencias }: EscrituraHallazgos): Hallazgo {
  return {
    titulo: sinDatos.titulo,
    texto: sinReferencias ? sinDatos.sinReferencias : sinDatos.texto,
    evidencia: 'insuficiente',
    detalle: sinDatos.detalle,
  };
}

/**
 * Hallazgos del informe, en orden: lo que más cambia, lo que más depende de ti y la posición de la ocupación. Se
 * escriben con los textos de `textos` y las listas en `idioma`.
 *
 * @param todas - Las tareas del informe, ya valoradas.
 * @param posicion - La posición de la ocupación entre las demás.
 * @param escritura - Los textos fijos y las listas en el idioma del informe.
 * @returns Los hallazgos, en el orden descrito.
 */
export function hallazgos(
  todas: readonly TareaInforme[],
  posicion: Posicion,
  escritura: EscrituraHallazgos,
): Hallazgo[] {
  const { textos } = escritura;
  const conDatos = todas.filter((tarea) => tarea.franja !== null);
  const deLas = conDatos.length < todas.length ? textos.deLasQueTienenDatos : '';
  const encontrados = conDatos.length
    ? [hallazgoLoQueMasCambia(conDatos, deLas, escritura), hallazgoLoQueDependeDeTi(conDatos, deLas, escritura)]
    : [hallazgoSinDatos(escritura)];
  if (posicion) {
    encontrados.push(hallazgoPosicion(posicion, textos));
  }
  return encontrados;
}
