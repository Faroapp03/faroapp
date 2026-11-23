/** Presentación compartida de los idiomas acreditados y su procedencia. */
/** @import { OrigenIdiomaFicha } from '../../recursos/catalogo-cursos/lector.js' */
/** @typedef {'es'|'ca'} IdiomaInterfaz */
import { nombreDelIdioma } from '../fechas.js';

const TEXTOS = {
  es: {
    edicion: 'Idioma publicado para este curso.',
    programa: 'Es el idioma del programa. El de esta edición está por confirmar.',
    programaBreve: 'programa · edición por confirmar',
    orientacion: 'Idioma orientativo · Faro. Confianza baja; confírmalo en la ficha.',
    breve: 'orientación Faro; confirma el idioma',
    video: 'Vídeo en catalán; subtítulos en castellano',
    norma: 'Según la norma general del proveedor; materiales de esta actividad sin comprobar.',
    normaBreve: 'norma general del proveedor',
    historial:
      'Idioma probable según ediciones anteriores de la misma modalidad. Confirma el de esta sesión en la ficha.',
    historialBreve: 'estimación según ediciones anteriores',
  },
  ca: {
    edicion: 'Idioma publicat per a aquest curs.',
    programa: 'És l’idioma del programa. El d’aquesta edició està per confirmar.',
    programaBreve: 'programa · edició per confirmar',
    orientacion: 'Idioma orientatiu · Faro. Confiança baixa; confirma’l a la fitxa.',
    breve: 'orientació Faro; confirma l’idioma',
    video: 'Vídeo en català; subtítols en castellà',
    norma: 'Segons la norma general del proveïdor; materials d’aquesta activitat sense comprovar.',
    normaBreve: 'norma general del proveïdor',
    historial:
      'Idioma probable segons edicions anteriors de la mateixa modalitat. Confirma el d’aquesta sessió a la fitxa.',
    historialBreve: 'estimació segons edicions anteriors',
  },
};

/** @param {string} codigo @param {IdiomaInterfaz} idioma */
export function nombreIdioma(codigo, idioma) {
  const nombre = nombreDelIdioma(codigo, idioma);
  // En el catálogo, el idioma va como rótulo, con mayúscula inicial («Castellano»).
  return nombre.charAt(0).toLocaleUpperCase(idioma) + nombre.slice(1);
}

/** El origen en pocas palabras, el que acompaña al idioma en la lista; null si lo publica el propio curso.
 * @param {OrigenIdiomaFicha} origen @param {IdiomaInterfaz} idioma @returns {string|null} */
export function origenBreve(origen, idioma) {
  const t = TEXTOS[idioma];
  const breves = {
    'historial-cibernarium': t.historialBreve,
    faro: t.breve,
    programa: t.programaBreve,
    'norma-general': t.normaBreve,
  };
  return origen !== null && Object.hasOwn(breves, origen) ? breves[/** @type {keyof typeof breves} */ (origen)] : null;
}

/** La norma general no dice un idioma, sino el de la voz y el de los subtítulos.
 * @param {IdiomaInterfaz} idioma */
export function idiomaSegunLaNorma(idioma) {
  return TEXTOS[idioma].video;
}

/** La norma distingue voz y subtítulos; una estimación siempre lleva su origen visible.
 * @param {readonly string[]} idiomas @param {OrigenIdiomaFicha} origen @param {IdiomaInterfaz} idioma
 */
export function describirIdiomas(idiomas, origen, idioma) {
  const valores = idiomas.filter((codigo) => codigo !== 'no-indicado');
  const valor = valores.length ? valores.map((codigo) => nombreIdioma(codigo, idioma)).join(', ') : null;
  const t = TEXTOS[idioma];
  const breve = origenBreve(origen, idioma);
  if (origen === 'historial-cibernarium') {
    return { valor, nota: t.historial, compacto: `${valor} · ${breve}` };
  }
  if (origen === 'faro') {
    return { valor, nota: t.orientacion, compacto: `${valor} · ${breve}` };
  }
  if (origen === 'programa') {
    return { valor, nota: t.programa, compacto: `${valor} · ${breve}` };
  }
  if (origen === 'norma-general') {
    const segunLaNorma = idiomaSegunLaNorma(idioma);
    return { valor: segunLaNorma, nota: t.norma, compacto: `${segunLaNorma} · ${breve}` };
  }
  return { valor, nota: origen ? t.edicion : '', compacto: valor };
}
