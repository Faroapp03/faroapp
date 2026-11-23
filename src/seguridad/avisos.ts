// Textos que la persona ve cuando Faro protege sus datos, se sale del tema, ofrece ayuda (024), presenta una búsqueda por palabras o
// recorta lo que ha escrito. Las versiones en catalán llevan el sufijo _CA; la del 024 usa las palabras de Canal
// Salut.

import { MAX_RELATO, MAX_TAREAS } from './limites.ts';

/** Un aviso para la persona: su tipo (para mostrarlo con su estilo) y el texto. */
export interface Aviso {
  tipo: 'datos-personales' | 'fuera-de-tema' | 'ayuda' | 'recorte' | 'busqueda-por-palabras';
  texto: string;
}

/**
 * Un entero con punto de miles, como se escribe en los avisos: «4.000». Es la misma forma que `cifra` (comun/cifras.js),
 * pero propia: el motor del dispositivo empaqueta este archivo y otra dependencia común le añadiría un trozo, más allá
 * de su techo de archivos. Solo admite enteros; una prueba la ata a `cifra`.
 */
export function conPuntosDeMiles(entero: number): string {
  if (!Number.isSafeInteger(entero)) {
    throw new RangeError('El aviso solo escribe enteros');
  }
  return String(entero).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Se han quitado del texto procesado los datos personales que reconoce el filtro. */
export const AVISO_DATOS =
  'Faro ha quitado del texto procesado los datos personales que ha reconocido. Evita incluir datos personales.';
/** El texto no describe un trabajo o intenta dar órdenes a Faro. */
export const AVISO_FUERA_DE_TEMA = 'Solo puedo ayudarte con la descripción de tu trabajo. Cuéntame qué tareas haces.';
/**
 * El aviso de datos personales en catalán, para cuando /api/clasificar o /api/informe se piden en ese idioma.
 */
export const AVISO_DATOS_CA =
  'Faro ha tret del text processat les dades personals que ha reconegut. Evita incloure dades personals.';
/** El aviso de fuera de tema en catalán. */
export const AVISO_FUERA_DE_TEMA_CA =
  'Només et puc ajudar amb la descripció de la teva feina. Explica’m quines tasques fas.';
/**
 * La moderación detecta intención o instrucciones de autolesión: se ofrece el 024 en lugar de seguir. Con las palabras
 * del Ministerio de Sanidad (sanidad.gob.es/linea024, consultado el 03/10/2026): «servicio gratuito, confidencial y
 * disponible las 24 horas del día, los 365 días del año» y «en caso de emergencia vital inminente puede llamar
 * directamente al teléfono de emergencias 112». El aviso del recorrido (clave recorrido.ayuda.024)
 * debe conservar el mismo texto en el idioma de la página.
 */
export const AVISO_AYUDA =
  'Si estás pasando por un momento difícil, llama al 024, la línea de atención a la conducta suicida: es gratuita, confidencial y está disponible las 24 horas del día, los 365 días del año. En caso de emergencia vital inminente, llama al 112.';
/**
 * El mismo aviso en catalán, con las palabras de Canal Salut (canalsalut.gencat.cat, «Suïcidi i conducta suïcida»,
 * consultado el 03/10/2026): «gratuït, confidencial i disponible les 24 hores del dia, els 365 dies de l'any».
 */
export const AVISO_AYUDA_CA =
  "Si estàs passant per un moment difícil, truca al 024, el telèfon d'atenció a la conducta suïcida: és gratuït, confidencial i està disponible les 24 hores del dia, els 365 dies de l'any. En cas d'emergència vital imminent, truca al 112.";
/** La búsqueda por palabras presenta candidatas para que la persona elija. */
export const AVISO_BUSQUEDA_POR_PALABRAS =
  'Faro busca por palabras las ocupaciones que encajan con lo que cuentas, y tú eliges la tuya.';
/** El aviso de búsqueda por palabras en catalán. */
export const AVISO_BUSQUEDA_POR_PALABRAS_CA =
  'Faro cerca per paraules les ocupacions que encaixen amb el que expliques, i tu tries la teva.';
/** La pregunta que se hace cuando el relato no basta y el modelo no propone una válida. */
export const PREGUNTA_ESTANDAR = '¿Qué tareas haces normalmente en tu trabajo?';

/** El relato supera MAX_RELATO caracteres y solo se ha leído el principio. */
export const AVISO_RELATO_LARGO =
  `Tu relato es muy largo: Faro ha leído los primeros ${conPuntosDeMiles(MAX_RELATO)} caracteres. ` +
  'Si falta alguna tarea, podrás añadirla en el siguiente paso.';
/** El modelo ha devuelto el máximo de tareas: puede que falte alguna. */
export const AVISO_MAX_TAREAS =
  `Faro recoge como máximo ${MAX_TAREAS} tareas de cada relato. ` +
  'Si falta alguna, podrás añadirla en el siguiente paso.';
