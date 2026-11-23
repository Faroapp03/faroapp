// Lo que dice Faro al presentar cada fase de la ocupación, según cómo se ha llegado a ella (el motivo que deja la
// máquina de flujo-ocupacion.js). Lógica pura, sin DOM: devuelve los párrafos del mensaje, cada uno un traducible
// (textos.js, claves recorrido.ocupacion.* y recorrido.explorar.*), un dato oficial (en el idioma de la página si
// tiene su traducción) o un texto del motor con el idioma en que llegó.

import { esTraducible, traducible } from '../textos.js';
import { datoOficial } from './datos-traducidos.js';
import { FASES, MOTIVOS_DE_FASE } from './flujo-ocupacion.js';
import { textoDelMotor } from './traduccion-api.js';

/** @import { Parte } from '../textos.js' */
/** @import { EstadoOcupacion, Fase, Grupo, Motivo } from './flujo-ocupacion.js' */

/**
 * Lo que dice Faro al explorar, según el motivo por el que se ha llegado; sin motivo propio, el inicio (alExplorar).
 * @type {Readonly<Partial<Record<Motivo, (flujo: EstadoOcupacion) => Parte[]>>>}
 */
const AL_EXPLORAR = Object.freeze({
  [MOTIVOS_DE_FASE.LIMITE]: () => [traducible('recorrido.explorar.limite')],
  [MOTIVOS_DE_FASE.SIN_GRUPO]: () => [traducible('recorrido.explorar.sin-grupo')],
  [MOTIVOS_DE_FASE.JERARQUIA]: ({ tituloPadre }) => [
    traducible('recorrido.explorar.dentro-de', { titulo: datoOficial(tituloPadre) }),
  ],
  [MOTIVOS_DE_FASE.VOLVER]: ({ padre, tituloPadre }) => [
    padre
      ? traducible('recorrido.explorar.volvemos-a', { titulo: datoOficial(tituloPadre) })
      : traducible('recorrido.explorar.volvemos-al-principio'),
  ],
});

/** El título como frase, con su punto. @param {string} titulo */
function conPunto(titulo) {
  return `${titulo}.`;
}

/**
 * Al confirmar un grupo, según cómo se ha llegado a él. Sin grupo que confirmar no hay nada que decir. Puede traer
 * `null` en lugar de la invitación a elegir de la lista (mensajeDeFase lo filtra).
 * @param {EstadoOcupacion} estado Su `motivo`. @param {Grupo} [grupo] @returns {Array<Parte | null>}
 */
function alConfirmar({ motivo }, grupo) {
  if (!grupo) {
    return [];
  }
  const conLista = Boolean(grupo.ocupaciones?.length);
  const titulo = { titulo: datoOficial(grupo.titulo) };
  const eligeEnLaLista = conLista ? traducible('recorrido.ocupacion.elige-en-lista') : null;
  if (motivo === MOTIVOS_DE_FASE.VOLVER) {
    return [traducible('recorrido.ocupacion.volvemos-a-grupo', titulo), eligeEnLaLista];
  }
  if (motivo === MOTIVOS_DE_FASE.JERARQUIA) {
    return [traducible('recorrido.ocupacion.grupo-te-dedicas', titulo), eligeEnLaLista];
  }
  const porLoQueDices = grupo.cita
    ? traducible('recorrido.ocupacion.por-lo-que-dices', { cita: grupo.cita })
    : traducible('recorrido.ocupacion.creo-que');
  return [
    porLoQueDices,
    datoOficial(grupo.titulo, conPunto),
    traducible(conLista ? 'recorrido.ocupacion.te-dedicas-elige' : 'recorrido.ocupacion.te-dedicas'),
  ];
}

/**
 * La pregunta del motor se queda en el idioma en que llegó, aunque la página cambie: no se vuelve a pedir a la IA. La
 * de la propia pantalla (la aclaración de ocupacion-local.js) es un traducible y sigue el idioma de la página.
 * @param {EstadoOcupacion} estado El `motivo` y la `clasificacion` de la fase. @returns {Parte[]}
 */
function alPreguntar({ motivo, clasificacion }) {
  const deLaIa = clasificacion?.pregunta;
  if (!deLaIa) {
    return [];
  }
  const pregunta = esTraducible(deLaIa.texto) ? deLaIa.texto : textoDelMotor(deLaIa.texto, deLaIa.idioma);
  if (motivo === MOTIVOS_DE_FASE.VOLVER) {
    return [traducible('recorrido.ocupacion.volvemos-a-pregunta'), pregunta];
  }
  return [pregunta];
}

/** Al volver a preguntar a qué se dedica. @param {EstadoOcupacion} estado Su `motivo`. @returns {Parte[]} */
function alEsperar({ motivo }) {
  return [
    traducible(
      motivo === MOTIVOS_DE_FASE.OTRA_COSA ? 'recorrido.ocupacion.otras-palabras' : 'recorrido.ocupacion.otra-vez',
    ),
  ];
}

/** Al explorar la clasificación oficial. @param {EstadoOcupacion} flujo @returns {Parte[]} */
function alExplorar(flujo) {
  const porMotivo = AL_EXPLORAR[flujo.motivo];
  return porMotivo ? porMotivo(flujo) : [traducible('recorrido.explorar.inicio')];
}

/**
 * El mensaje de cada fase que tiene uno (mensajeDeFase).
 * @type {Readonly<Partial<Record<Fase, (flujo: EstadoOcupacion, grupo?: Grupo) => Parte[]>>>}
 */
const POR_FASE = Object.freeze({
  [FASES.CONFIRMANDO]: alConfirmar,
  [FASES.RESPONDIENDO]: alPreguntar,
  [FASES.ESPERANDO]: alEsperar,
  [FASES.EXPLORANDO]: alExplorar,
});

/**
 * Los párrafos con los que Faro presenta la fase de `flujo`. `grupo` es el grupo que se confirma, ya con su título y
 * sus ocupaciones. Las fases sin mensaje propio (relatando, elegida) devuelven una lista vacía.
 * @param {EstadoOcupacion} flujo @param {Grupo} [grupo] @returns {Parte[]}
 */
export function mensajeDeFase(flujo, grupo = flujo.grupo ?? undefined) {
  const mensaje = POR_FASE[flujo.fase];
  return mensaje ? mensaje(flujo, grupo).filter(Boolean) : [];
}
