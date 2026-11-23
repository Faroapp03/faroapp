// Los textos fijos del informe breve y las reglas con que se escriben sus frases, iguales para todas las ocupaciones.
// Cada cifra va con su frase («27 de cada 100…»). Sin consejos, sin predicciones sobre la persona y sin atribuir a la
// IA cambios que los datos no permiten atribuirle. Las frases reciben números ya decididos por el dominio
// (dominio/informe-breve.ts) y devuelven texto sin escapar: lo escapa quien lo pinta.

import { lista, porcentaje } from '../../comun/formato.ts';
import type { Idioma } from '../../comun/idioma.ts';
import type { Franja } from '../../dominio/tipos-informe.ts';
import type { Confianza, Direccion, ExposicionBreve, UsoBreve } from '../../dominio/tipos-informe-breve.ts';
import type { Tercio } from '../../dominio/tipos-metodos.ts';
import { type ClaveBreve, texto } from './idioma.ts';

/** Cómo se nombra un gran grupo de ocupaciones en las frases. */
export interface NombresDeGranGrupo {
  /** «personas en …» */
  en: ClaveBreve;
  /** «personas con …» / «personas en …», como suena mejor tras «de cada 100 personas». */
  con: ClaveBreve;
  /** El nombre corto del grupo, en minúsculas. */
  corto: ClaveBreve;
  /** «el empleo …» */
  empleo: ClaveBreve;
}

/** Los grandes grupos (1 cifra, iguales en la CNO-11 y la CIUO-08), como se nombran en las frases. */
export const GRANDES_GRUPOS: Readonly<Record<string, NombresDeGranGrupo>> = Object.freeze({
  '0': {
    en: 'en las fuerzas armadas',
    con: 'de las fuerzas armadas',
    corto: 'fuerzas armadas',
    empleo: 'el empleo en las fuerzas armadas',
  },
  '1': {
    en: 'en puestos de dirección y gerencia',
    con: 'en puestos de dirección y gerencia',
    corto: 'dirección y gerencia',
    empleo: 'el empleo en dirección y gerencia',
  },
  '2': {
    en: 'en profesiones científicas e intelectuales',
    con: 'en profesiones científicas e intelectuales',
    corto: 'profesiones científicas e intelectuales',
    empleo: 'el empleo en profesiones científicas e intelectuales',
  },
  '3': {
    en: 'en empleos técnicos y de apoyo',
    con: 'con empleos técnicos y de apoyo',
    corto: 'empleos técnicos y de apoyo',
    empleo: 'el empleo técnico y de apoyo',
  },
  '4': {
    en: 'en empleos administrativos',
    con: 'con empleos administrativos',
    corto: 'empleos administrativos',
    empleo: 'el empleo administrativo',
  },
  '5': {
    en: 'en empleos de servicios, cuidados, protección y comercio',
    con: 'en empleos de servicios, cuidados, protección y comercio',
    corto: 'servicios, cuidados, protección y comercio',
    empleo: 'el empleo en servicios y comercio',
  },
  '6': {
    en: 'en la agricultura, la ganadería, la silvicultura y la pesca',
    con: 'en la agricultura, la ganadería, la silvicultura y la pesca',
    corto: 'agricultura, ganadería y pesca',
    empleo: 'el empleo agrario y pesquero',
  },
  '7': {
    en: 'en oficios de la industria y la construcción',
    con: 'en oficios de la industria y la construcción',
    corto: 'oficios de la industria y la construcción',
    empleo: 'el empleo en oficios de la industria y la construcción',
  },
  '8': {
    en: 'en el manejo de instalaciones, máquinas y montaje',
    con: 'que manejan instalaciones y máquinas',
    corto: 'operación de instalaciones y máquinas',
    empleo: 'el empleo de quienes manejan instalaciones y máquinas',
  },
  '9': {
    en: 'en ocupaciones elementales',
    con: 'en ocupaciones elementales',
    corto: 'ocupaciones elementales',
    empleo: 'el empleo en ocupaciones elementales',
  },
});

/** Umbrales del título de la conclusión 02 (de cada 100 personas que usan la IA). */
const USO_EXTENDIDO = 20;
const USO_EN_ALGUNOS = 10;
/** Por debajo de esta variación (en %, en valor absoluto) se escriben dos decimales; si es menor que el mínimo, «lo mismo». */
const VARIACION_CON_DOS_DECIMALES = 0.1;
const VARIACION_MINIMA = 0.005;
/** Diferencias del perfil (puntos) que se dicen «muchas más», «más» o «algo más» que la media. */
const DIFERENCIA_MUCHA = 15;
const DIFERENCIA_CLARA = 5;
const DIFERENCIA_ALGUNA = 1;
/** Porcentaje de mujeres desde el que el grupo es «con mayoría de mujeres» (y su simétrico para los hombres). */
const MAYORIA = 60;
const MINORIA = 40;
/** Puntos de diferencia con la media para decir «más» o «menos» jóvenes o estudios. */
const MARGEN_PERFIL = 2;
/** Años que tarda el INE en publicar la EAES de un año: la de 2024 salió en 2026 y la de 2025 sale en 2027. */
const ANIOS_HASTA_LA_SIGUIENTE_EAES = 3;

/** El nivel de exposición en palabras. */
const NIVEL: Readonly<Record<Franja, ClaveBreve>> = Object.freeze({
  alta: 'alta',
  media: 'media',
  baja: 'baja',
});

/** El título de la conclusión 01 según el nivel de exposición. */
export const TITULO_EXPOSICION: Readonly<Record<Franja, ClaveBreve>> = Object.freeze({
  alta: 'Tus tareas están muy expuestas',
  media: 'Tus tareas están expuestas en parte',
  baja: 'Tus tareas están poco expuestas',
});

/** El título de la conclusión 02 según cuántas personas de su grupo usan la IA. */
export function tituloDelUso(deCada100: number, idioma: Idioma = 'es'): string {
  if (deCada100 >= USO_EXTENDIDO) {
    return texto(idioma, 'Ya se usa en empleos como el tuyo');
  }
  return deCada100 >= USO_EN_ALGUNOS
    ? texto(idioma, 'Se usa en algunos empleos como el tuyo')
    : texto(idioma, 'Aún se usa poco en empleos como el tuyo');
}

/** Las personas de las que habla una cifra de uso: su gran grupo o su grupo de la encuesta. */
export function personasDelUso(uso: UsoBreve, idioma: Idioma = 'es'): string {
  const gran = uso.granGrupo === null ? undefined : GRANDES_GRUPOS[uso.granGrupo];
  if (gran) {
    return texto(idioma, 'personas {0}', texto(idioma, gran.con));
  }
  return uso.grupo ? texto(idioma, 'personas del grupo «{0}»', uso.grupo) : texto(idioma, 'personas ocupadas');
}

/** De quién son unas notas: todas de la OIT, de la OIT y de Faro, o todas estimaciones de Faro. */
export type ProcedenciaDeLasNotas = 'oit' | 'mixta' | 'faro';

/**
 * De quién son las notas de un conjunto de tareas con nota, por cuántas son estimaciones de Faro. Sin ninguna nota de
 * Faro (también sin notas) son de la OIT: así se escribía siempre.
 */
export function procedenciaDeLasNotas(deFaro: number, conNota: number): ProcedenciaDeLasNotas {
  if (deFaro === 0) {
    return 'oit';
  }
  return deFaro === conNota ? 'faro' : 'mixta';
}

/** Por qué el margen da confianza baja, según de quién son las notas: los modelos de la OIT o las estimaciones. */
const MARGEN_ANCHO: Readonly<Record<ProcedenciaDeLasNotas, ClaveBreve>> = Object.freeze({
  oit: 'los dos modelos de la OIT se separan mucho.',
  mixta: 'el margen de las estimaciones de la OIT y de Faro es muy ancho.',
  faro: 'el margen de las estimaciones de Faro es muy ancho.',
});

/** De quién es la estimación cuando la confianza sale de su margen, y entre qué valores va. */
const ESTIMACION_Y_MARGEN: Readonly<Record<ProcedenciaDeLasNotas, ClaveBreve>> = Object.freeze({
  oit: 'estimación de la OIT; sus dos modelos dan entre {0} y {1}.',
  mixta: 'estimación de la OIT y de Faro; su margen va de {0} a {1}.',
  faro: 'estimación de Faro; su margen va de {0} a {1}.',
});

/** El motivo de la confianza de la exposición; los márgenes se atribuyen a quien dio las notas. */
export function motivoDeLaExposicion(exposicion: ExposicionBreve, idioma: Idioma = 'es'): string {
  const procedencia = procedenciaDeLasNotas(exposicion.estimadasPorFaro, exposicion.conNota);
  if (exposicion.motivo === 'tareas-sin-nota') {
    return texto(idioma, 'parte de tu tiempo va a tareas sin nota.');
  }
  if (exposicion.motivo === 'margen-ancho') {
    return texto(idioma, MARGEN_ANCHO[procedencia]);
  }
  if (exposicion.motivo === 'metodos' && exposicion.metodos) {
    return texto(idioma, '{0} de {1} métodos coinciden.', exposicion.metodos.coinciden, exposicion.metodos.total);
  }
  return texto(idioma, ESTIMACION_Y_MARGEN[procedencia], exposicion.minimo, exposicion.maximo);
}

/** Dónde sitúan la ocupación los métodos, según su tercio de exposición. */
const ZONA: Readonly<Record<Tercio, ClaveBreve>> = Object.freeze({
  alto: 'entre las más expuestas',
  medio: 'en la zona media',
  bajo: 'entre las menos expuestas',
});

/**
 * La frase de los métodos publicados en la conclusión 01: «Los 5 métodos de medida que Faro ha comprobado sitúan tu
 * ocupación entre las más expuestas.» o «3 de los 5 … la sitúan en la zona media, como la OIT.»; vacía sin métodos.
 */
export function fraseDeLosMetodos(exposicion: ExposicionBreve, idioma: Idioma = 'es'): string {
  const metodos = exposicion.metodos;
  if (!metodos) {
    return '';
  }
  const zona = texto(idioma, ZONA[metodos.tercio]);
  if (metodos.coinciden === metodos.total) {
    // Con todas las notas de Faro, la OIT solo aparece como uno de estos métodos: la frase lo dice.
    const soloFaro = procedenciaDeLasNotas(exposicion.estimadasPorFaro, exposicion.conNota) === 'faro';
    return texto(
      idioma,
      soloFaro
        ? 'Los {0} métodos de medida que Faro ha comprobado, entre ellos el índice de la OIT, sitúan tu ocupación {1}.'
        : 'Los {0} métodos de medida que Faro ha comprobado sitúan tu ocupación {1}.',
      metodos.total,
      zona,
    );
  }
  return texto(
    idioma,
    '{0} de los {1} métodos de medida que Faro ha comprobado sitúan tu ocupación {2}, como la OIT.',
    metodos.coinciden,
    metodos.total,
    zona,
  );
}

/** El motivo de la confianza de la cifra de uso. */
export function motivoDelUso(uso: UsoBreve, idioma: Idioma = 'es'): string {
  const alcance =
    uso.granGrupo === null
      ? texto(idioma, 'es un grupo amplio')
      : texto(idioma, 'es todo el grupo de {0}', texto(idioma, GRANDES_GRUPOS[uso.granGrupo]?.corto ?? 'tu ocupación'));
  const muestra = uso.confianza === 'alta' ? '' : texto(idioma, 'muestra pequeña; ');
  const donde = uso.ambito === 'espana' ? texto(idioma, 'datos de España; ') : '';
  return `${donde}${muestra}${alcance}.`;
}

/** «Confianza alta», «media» o «baja». */
export const CONFIANZA: Readonly<Record<Confianza, ClaveBreve>> = Object.freeze({
  alta: 'alta',
  media: 'media',
  baja: 'baja',
});

/** Cómo se dice una dirección en la etiqueta de una tarjeta. */
export const ESTADO: Readonly<Record<Direccion, { flecha: string; palabra: ClaveBreve; tono: string }>> = Object.freeze(
  {
    baja: { flecha: '▼', palabra: 'Baja', tono: 'alerta' },
    sube: { flecha: '▲', palabra: 'Sube', tono: 'favorable' },
    estable: { flecha: '●', palabra: 'Estable', tono: 'favorable' },
    'sin-dato': { flecha: '■', palabra: 'Sin comparación', tono: 'estable' },
  },
);

/**
 * Una variación anual en palabras: «un 5,6 % menos», «un 0,04 % más», «lo mismo». Con menos de una décima, dos
 * decimales, para que no parezca cero lo que no lo es.
 *
 * @param variacion - La variación en %.
 * @returns La variación en palabras.
 */
export function variacionEnPalabras(variacion: number, idioma: Idioma = 'es'): string {
  const absoluta = Math.abs(variacion);
  if (absoluta < VARIACION_MINIMA) {
    return texto(idioma, 'lo mismo');
  }
  const decimales = absoluta < VARIACION_CON_DOS_DECIMALES ? 2 : 1;
  return texto(idioma, 'un {0} {1}', porcentaje(absoluta, decimales), texto(idioma, variacion > 0 ? 'más' : 'menos'));
}

/** La comparación de un dato del perfil con la media de Cataluña, en palabras. */
export function fraseDeLaMedia(grupo: number, conjunto: number, idioma: Idioma = 'es'): string {
  const diferencia = Math.round(grupo) - Math.round(conjunto);
  const absoluta = Math.abs(diferencia);
  const sentido = diferencia > 0 ? 'más' : 'menos';
  if (absoluta >= DIFERENCIA_MUCHA) {
    return texto(idioma, 'Muchas {0} que la media', texto(idioma, sentido));
  }
  if (absoluta >= DIFERENCIA_CLARA) {
    return texto(idioma, sentido === 'más' ? 'Más que la media' : 'Menos que la media');
  }
  return absoluta >= DIFERENCIA_ALGUNA
    ? texto(idioma, 'Algo {0} que la media', texto(idioma, sentido))
    : texto(idioma, 'Igual que la media');
}

/** «más», «menos» o «tantos» según un dato del grupo frente a la media, con un margen. */
function comparado(grupo: number, conjunto: number, palabras: [mas: string, menos: string, igual: string]): string {
  if (grupo > conjunto + MARGEN_PERFIL) {
    return palabras[0];
  }
  return grupo < conjunto - MARGEN_PERFIL ? palabras[1] : palabras[2];
}

/** La frase de cabecera del perfil, con reglas fijas a partir de las cifras. */
export function titularDelPerfil(
  datos: {
    mujeres?: number;
    jovenes?: [number, number];
    universitarios?: [number, number];
  },
  idioma: Idioma = 'es',
): string {
  const partes: string[] = [];
  if (datos.mujeres !== undefined) {
    let genero: ClaveBreve = 'Mujeres y hombres a partes parecidas';
    if (datos.mujeres >= MAYORIA) {
      genero = 'Con mayoría de mujeres';
    } else if (datos.mujeres <= MINORIA) {
      genero = 'Con mayoría de hombres';
    }
    partes.push(texto(idioma, genero));
  }
  if (datos.jovenes) {
    partes.push(
      comparado(...datos.jovenes, [
        texto(idioma, 'más jóvenes'),
        texto(idioma, 'menos jóvenes'),
        texto(idioma, 'tantos jóvenes'),
      ]),
    );
  }
  if (datos.universitarios) {
    partes.push(
      comparado(...datos.universitarios, [
        texto(idioma, 'más estudios universitarios'),
        texto(idioma, 'menos estudios universitarios'),
        texto(idioma, 'tantos estudios universitarios'),
      ]),
    );
  }
  const frase = lista(partes, idioma);
  return `${frase.charAt(0).toUpperCase()}${frase.slice(1)}${partes.length > 1 ? texto(idioma, ' que la media de Cataluña') : ''}.`;
}

/** El año en que el INE publicará la EAES siguiente a la del año dado. */
export const proximaEaes = (anio: number): number => anio + ANIOS_HASTA_LA_SIGUIENTE_EAES;

/** El verbo de un movimiento del mercado, en singular o plural. */
const VERBOS: Readonly<Record<'baja' | 'sube' | 'estable', [singular: ClaveBreve, plural: ClaveBreve]>> = Object.freeze(
  {
    baja: ['ha bajado', 'han bajado'],
    sube: ['ha subido', 'han subido'],
    estable: ['se ha mantenido', 'se han mantenido'],
  },
);

/**
 * «En el último año, las ofertas y el empleo administrativo han bajado y la contratación se ha mantenido.»
 *
 * @param movimientos - Cada dato con su dirección; los que no tienen comparación no se nombran.
 * @returns La frase, o null si no hay ningún movimiento que contar.
 */
export function fraseDelMercado(
  movimientos: readonly { nombre: string; direccion: Direccion }[],
  idioma: Idioma = 'es',
): string | null {
  const partes = (['baja', 'sube', 'estable'] as const).flatMap((direccion) => {
    const nombres = movimientos.filter((m) => m.direccion === direccion).map((m) => m.nombre);
    if (!nombres.length) {
      return [];
    }
    return [`${lista(nombres, idioma)} ${texto(idioma, VERBOS[direccion][nombres.length > 1 ? 1 : 0])}`];
  });
  return partes.length ? texto(idioma, 'En el último año, {0}.', lista(partes, idioma)) : null;
}

/** La frase de la exposición media, según de quién son las notas. */
const FRASE_DE_LA_EXPOSICION: Readonly<Record<ProcedenciaDeLasNotas, ClaveBreve>> = Object.freeze({
  oit: 'Las tareas de tu ocupación tienen una exposición {0} a la IA generativa: {1} sobre 100 según el índice de la OIT, ponderado por el tiempo que dedicas a cada una.',
  mixta:
    'Las tareas de tu ocupación tienen una exposición {0} a la IA generativa: {1} sobre 100 según la OIT y la estimación de Faro, ponderado por el tiempo que dedicas a cada una.',
  faro: 'Las tareas de tu ocupación tienen una exposición {0} a la IA generativa: {1} sobre 100 según la estimación de Faro, ponderado por el tiempo que dedicas a cada una.',
});

/**
 * La frase de «En pocas palabras» sobre la exposición. La media se atribuye a la OIT solo si todas sus notas son de la
 * OIT, y a la OIT y a Faro si hay de las dos; si todas son estimaciones de Faro, no se nombra a la OIT.
 */
export function fraseDeLaExposicion(exposicion: ExposicionBreve | null, idioma: Idioma = 'es'): string {
  if (!exposicion) {
    return texto(
      idioma,
      'Tus tareas no tienen nota en el índice de la OIT, así que este informe no puede decir cuánto podría hacer la IA en ellas.',
    );
  }
  return texto(
    idioma,
    FRASE_DE_LA_EXPOSICION[procedenciaDeLasNotas(exposicion.estimadasPorFaro, exposicion.conNota)],
    texto(idioma, NIVEL[exposicion.nivel]),
    exposicion.valor,
  );
}

/** La frase de «Tus tareas menos expuestas», según de quién son sus notas. */
export const FRASE_DE_LAS_MENOS_EXPUESTAS: Readonly<Record<ProcedenciaDeLasNotas, ClaveBreve>> = Object.freeze({
  oit: 'Según la OIT, son las que la IA podría hacer en menor parte.',
  mixta: 'Según la OIT y la estimación de Faro, son las que la IA podría hacer en menor parte.',
  faro: 'Según la estimación de Faro, son las que la IA podría hacer en menor parte.',
});

/** La frase de «En pocas palabras» sobre el uso. */
export function fraseDelUso(uso: UsoBreve, idioma: Idioma = 'es'): string {
  const donde = texto(idioma, uso.ambito === 'cataluna' ? 'En Cataluña' : 'En España');
  return texto(
    idioma,
    '{0}, {1} de cada 100 {2} la usaron para trabajar en {3}.',
    donde,
    uso.deCada100,
    personasDelUso(uso, idioma),
    uso.anio,
  );
}

/** La frase fija sobre lo que no permiten decir los datos. */
export const FRASE_DE_ATRIBUCION =
  'Los estudios publicados hasta 2026 no encuentran una pérdida general de empleo causada por la IA, y estos datos no permiten atribuirle esos cambios.';

/** Lo que la IA no hace por ti: acciones, iguales para todas las ocupaciones (redactado con IA y revisado). */
export const LO_QUE_NO_HACE: readonly (readonly [titulo: ClaveBreve, texto: ClaveBreve])[] = Object.freeze([
  ['Revisar:', 'la IA puede equivocarse o inventar datos; comprobarlos sigue siendo trabajo de una persona.'],
  ['Atender a las personas', 'cuando el caso no es el habitual.'],
  ['Decidir', 'qué se hace, con qué prioridad y quién responde.'],
]);
