// Los datos oficiales en el idioma pedido: el nombre oficial o la traducción de Faro si existe y, si
// no, el texto en su idioma original, dicho. Nunca un hueco. Los títulos de la CIUO-08, la CNO-11 y ESCO y los textos
// de las tareas están en castellano en el paquete; en catalán, `datos.catalan` (opcional) lleva los nombres oficiales
// de los grupos (Idescat) y las traducciones de Faro de las ocupaciones ESCO y de las tareas.

import { IDIOMA_DE_LOS_DATOS, type Idioma, type IdiomaDeDato } from '../comun/idioma.ts';
import type { Datos } from './tipos-paquete.ts';

/** Un texto de los datos y el idioma en que está. `oficial`: en ese idioma es un texto oficial, no una traducción. */
export interface DatoEnIdioma {
  texto: string;
  idioma: IdiomaDeDato;
  oficial?: true;
}

/** Los textos de una tarea oficial que se pueden traducir, con los nombres de la traducción al catalán. */
export type CampoDeTarea = 'corto' | 'texto' | 'ia_podria' | 'lo_tuyo';

/** Dónde está cada campo en los textos en castellano del paquete (`datos.textos.tareas`). */
const CAMPO_EN_CASTELLANO = { corto: 'corto', texto: 'texto_es', ia_podria: 'ia_podria', lo_tuyo: 'lo_tuyo' } as const;

/** La traducción de Faro de un texto, si se pide un idioma que no es el de los datos y la hay; si no, el original. */
function traduccionOOriginal(traduccion: string | undefined, original: string, idioma: Idioma): DatoEnIdioma {
  if (idioma !== IDIOMA_DE_LOS_DATOS && traduccion) {
    return { texto: traduccion, idioma };
  }
  return { texto: original, idioma: IDIOMA_DE_LOS_DATOS };
}

/** El nombre oficial de un grupo en `idioma`, si se pide un idioma que no es el de los datos y lo hay; si no, null. */
function oficialEn(oficial: string | undefined, idioma: Idioma): DatoEnIdioma | null {
  return idioma !== IDIOMA_DE_LOS_DATOS && oficial ? { texto: oficial, idioma, oficial: true } : null;
}

/**
 * El título de un grupo ISCO-08 (de 1 a 4 cifras) en `idioma`, o null si el código no existe. En catalán, el nombre
 * oficial de la CIUO-2008 (ca) del Idescat, no una traducción.
 *
 * @param datos - El paquete de datos.
 * @param codigo - El código ISCO-08.
 * @param idioma - El idioma pedido.
 * @returns El título y su idioma, o null.
 */
export function tituloIscoEn(datos: Datos, codigo: string, idioma: Idioma): DatoEnIdioma | null {
  const original = datos.clasificaciones.isco08_es[codigo];
  if (original === undefined) {
    return null;
  }
  return oficialEn(datos.catalan?.grupos[codigo], idioma) ?? { texto: original, idioma: IDIOMA_DE_LOS_DATOS };
}

/**
 * El título de un grupo CNO-11 en `idioma`, o null si el código no existe. En catalán, el nombre oficial de la
 * CCO-2011 (ca) si le corresponde uno solo; si no, el castellano.
 *
 * @param datos - El paquete de datos.
 * @param codigo - El código CNO-11.
 * @param idioma - El idioma pedido.
 * @returns El título y su idioma, o null.
 */
export function tituloCnoEn(datos: Datos, codigo: string, idioma: Idioma): DatoEnIdioma | null {
  const original = datos.clasificaciones.cno11[codigo]?.titulo;
  if (original === undefined) {
    return null;
  }
  return oficialEn(datos.catalan?.grupos_cno11?.[codigo], idioma) ?? { texto: original, idioma: IDIOMA_DE_LOS_DATOS };
}

/**
 * El título de una ocupación ESCO que existe, en `idioma`.
 *
 * @param datos - El paquete de datos.
 * @param esco - El código ESCO, que existe.
 * @param idioma - El idioma pedido.
 * @returns El título y su idioma.
 */
export function tituloEscoEn(datos: Datos, esco: string, idioma: Idioma): DatoEnIdioma {
  // El contrato exige un ESCO existente: el informe lo valida con resolverOcupacion y la API lo toma del catálogo.
  // La aserción conserva la precondición y el error de acceso si se incumple, sin añadir una respuesta alternativa.
  return traduccionOOriginal(
    datos.catalan?.ocupaciones[esco],
    (datos.esco.ocupaciones[esco] as Datos['esco']['ocupaciones'][string]).titulo,
    idioma,
  );
}

/**
 * Un texto de una tarea oficial en `idioma`, o null si la tarea no lo tiene ni en castellano.
 *
 * @param datos - El paquete de datos.
 * @param id - El identificador de la tarea.
 * @param campo - El campo del texto.
 * @param idioma - El idioma pedido.
 * @returns El texto y su idioma, o null.
 */
export function textoDeTareaEn(datos: Datos, id: string, campo: CampoDeTarea, idioma: Idioma): DatoEnIdioma | null {
  const original = datos.textos.tareas[id]?.[CAMPO_EN_CASTELLANO[campo]];
  if (original === undefined) {
    return null;
  }
  return traduccionOOriginal(datos.catalan?.tareas[id]?.[campo], original, idioma);
}
