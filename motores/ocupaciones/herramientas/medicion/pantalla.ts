// Lo que ve la persona en un paso: los grupos que se le enseñan y el texto de la pantalla, y la clase de la primera
// pantalla para la frase y para cada persona.

import type { Caso } from './bancos.ts';
import { grupoDe } from './bancos.ts';
import type { DatosDelPaquete, Hipotesis, Paso, PasoPregunta, PasoPropuesta, Pregunta } from './tipos.ts';
import { esDecidido, esPregunta, esPropuesta } from './tipos.ts';

/** Lo que se ve de un paso. */
export interface Vista {
  readonly tipo: string;
  readonly local?: boolean | undefined;
  readonly pregunta?: string;
  readonly grupos: readonly string[];
  readonly texto: string;
}

const NO_SON_GRUPOS = new Set(['otra', 'ninguna', 'no_lo_se']);
/** Preguntas que no enseñan ocupaciones: aclaran (tareas, niveles de la clasificación, trato, estudios…). */
export const ACLARACIONES = new Set([
  'tarea',
  'nivel1',
  'nivel2',
  'nivel3',
  'trato',
  'campo',
  'precision',
  'universidad',
  'cuenta_propia',
]);
const CODIGO_DE_GRUPO = /^\d{4}/;

const titulo = (h: Hipotesis, idioma: string): string =>
  h.ocupacion?.titulo?.[idioma] ?? h.tituloGrupo?.[idioma] ?? h.grupo;

/** «Título» [grupo] de una hipótesis, como se escribe en el texto de la pantalla. */
const conGrupo = (h: Hipotesis, idioma: string): string => `«${titulo(h, idioma)}» [${h.grupo}]`;

/** Los grupos que la persona puede elegir en una pregunta (los de «¿Cuál de estos…?» o los de sus ocupaciones). */
function gruposVisibles(datos: DatosDelPaquete, pregunta: Pregunta): string[] {
  const ids = pregunta.opciones.map((o) => String(o.id)).filter((id) => !NO_SON_GRUPOS.has(id));
  if (pregunta.tipo === 'grupo' || pregunta.tipo === 'area') {
    return ids.flatMap((id) => id.split('+'));
  }
  if (pregunta.tipo === 'ocupacion') {
    return [...new Set(ids.map((id) => grupoDe(datos, id)).filter((g): g is string => Boolean(g)))];
  }
  return [];
}

function vistaDePropuesta(paso: PasoPropuesta, idioma: string): Vista {
  const tambien = paso.alternativas.length
    ? ` · también: ${paso.alternativas.map((a) => conGrupo(a.hipotesis, idioma)).join(' | ')}`
    : '';
  return {
    tipo: 'propuesta',
    local: paso.local,
    grupos: [paso.mejor.grupo, ...paso.alternativas.map((a) => a.hipotesis.grupo)],
    texto: `¿Es esta? «${titulo(paso.mejor, idioma)}» [${paso.mejor.grupo}]${tambien}`,
  };
}

function vistaDePregunta(datos: DatosDelPaquete, paso: PasoPregunta): Vista {
  const p = paso.pregunta;
  const opcion = (o: { id: string | number; texto: string }): string =>
    `${o.texto}${CODIGO_DE_GRUPO.test(String(o.id)) ? ` [${o.id}]` : ''}`;
  return {
    tipo: 'pregunta',
    pregunta: p.tipo,
    grupos: gruposVisibles(datos, p),
    texto: `${p.texto} → ${p.opciones.map(opcion).join(' | ')}`,
  };
}

/**
 * Lo que se ve de un paso.
 *
 * @param datos - Los datos del paquete.
 * @param paso - El paso de la pantalla.
 * @param idioma - El idioma de la frase.
 * @returns Los grupos a la vista y el texto.
 */
export function describir(datos: DatosDelPaquete, paso: Paso, idioma: string): Vista {
  if (esPropuesta(paso)) {
    return vistaDePropuesta(paso, idioma);
  }
  if (esPregunta(paso)) {
    return vistaDePregunta(datos, paso);
  }
  if (esDecidido(paso)) {
    return { tipo: 'decidida', grupos: [paso.grupo], texto: `Decidida: ${paso.grupo}` };
  }
  return { tipo: paso.tipo, grupos: [], texto: paso.tipo };
}

const esPantallaDePropuesta = (vista: Vista): boolean => vista.tipo === 'propuesta' || vista.tipo === 'decidida';

/** La clase de una pregunta que no enseña lo buscado: aclaración, no entiende u otras opciones. */
function claseSinLoBuscado(vista: Vista, sinComprension: boolean | undefined, otras: string): string {
  if (ACLARACIONES.has(vista.pregunta ?? '')) {
    return 'aclaracion';
  }
  return sinComprension ? 'no_entiende' : otras;
}

/** Clase de la primera pantalla para la FRASE: algún grupo válido a la vista. */
export function claseDeLaFrase(vista: Vista, caso: Caso, sinComprension: boolean | undefined): string {
  const valido = (g: string | undefined): boolean => g !== undefined && caso.validas.grupos.includes(g);
  if (esPantallaDePropuesta(vista)) {
    if (valido(vista.grupos[0])) {
      return 'propuesta_ok';
    }
    return vista.grupos.slice(1).some(valido) ? 'alternativa_ok' : 'propuesta_mal';
  }
  if (vista.tipo === 'pregunta') {
    return vista.grupos.some(valido) ? 'pregunta_ok' : claseSinLoBuscado(vista, sinComprension, 'pregunta');
  }
  return 'no_entiende';
}

/** Clase de la primera pantalla para UNA PERSONA: su grupo a la vista o no, y qué se le enseña. */
export function claseDeLaPersona(vista: Vista, grupo: string, sinComprension: boolean | undefined): string {
  if (esPantallaDePropuesta(vista)) {
    if (vista.grupos[0] === grupo) {
      return 'propuesta_suya';
    }
    return vista.grupos.slice(1).includes(grupo) ? 'alternativa_suya' : 'propuesta_otra';
  }
  if (vista.tipo === 'pregunta') {
    return vista.grupos.includes(grupo)
      ? 'opciones_con_la_suya'
      : claseSinLoBuscado(vista, sinComprension, 'opciones_sin_la_suya');
  }
  return 'no_entiende';
}
