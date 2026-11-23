// Proponer y confirmar antes de afirmar (el patrón de Akinator): «¿Tu ocupación es X?» con «Sí, es esta», «Se parece,
// pero no», «No» y dos alternativas. Lo que el recorrido da por bueno lo confirma la persona. Un «No» baja la propuesta
// (× factorRechazo), sin descartarla: la persona pudo equivocarse al leer.

import { tituloEnGenero } from './ocupaciones.ts';
import { BUSCAR_YO, PROPUESTA } from './textos.ts';
import type { Atributos, Hipotesis, Idioma, Opcion, Paso, Respuesta } from './tipos.ts';

export const PREFIJO_PROPUESTA = 'propuesta:';
const PREFIJO_ALTERNATIVA = 'alt:';
const SEPARADOR = ':';

export interface Decision {
  readonly grupo: string;
  readonly esco?: string;
  readonly motivo: 'confirmada' | 'confirmada_grupo';
}

export interface LecturaDePropuestas {
  /** Grupos de las propuestas rechazadas con «No», en orden. */
  readonly rechazadas: readonly string[];
  readonly decision: Decision | null;
  /** La última respuesta fue un «No» a una propuesta (la siguiente pregunta debe contrastar). */
  readonly ultimaFueRechazo: boolean;
  /**
   * La alternativa elegida en la última propuesta, que aún hay que confirmar con «Sí / No»: pulsar una
   * alternativa por error acababa el recorrido en la ocupación equivocada. Si es un grupo ya rechazado, decide sin más.
   */
  readonly alternativaPorConfirmar: { readonly grupo: string; readonly esco?: string } | null;
}

function idDePropuesta(h: Hipotesis): string {
  return `${PREFIJO_PROPUESTA}${h.grupo}${SEPARADOR}${h.ocupacion?.esco ?? ''}`;
}

function partes(id: string, prefijo: string): { grupo: string; esco?: string } {
  const [grupo = '', esco = ''] = id.slice(prefijo.length).split(SEPARADOR);
  return esco ? { grupo, esco } : { grupo };
}

function decisionDe(r: Respuesta): Decision | null {
  const propuesta = partes(r.pregunta, PREFIJO_PROPUESTA);
  if (r.opcion === 'si') {
    return { ...propuesta, motivo: 'confirmada' };
  }
  if (r.opcion === 'parecida') {
    return { grupo: propuesta.grupo, motivo: 'confirmada_grupo' };
  }
  if (r.opcion.startsWith(PREFIJO_ALTERNATIVA)) {
    return { ...partes(r.opcion, PREFIJO_ALTERNATIVA), motivo: 'confirmada' };
  }
  return null;
}

interface LecturaEnCurso {
  rechazadas: string[];
  decision: Decision | null;
  alternativaPorConfirmar: { grupo: string; esco?: string } | null;
  /** El grupo propuesto que quedó rechazado solo porque se eligió una alternativa, y esa alternativa. */
  porAlternativa: { grupo: string; alternativa: string } | null;
}

/** Lee una respuesta a una propuesta sobre lo leído hasta ahora. */
function leerUna(r: Respuesta, e: LecturaEnCurso): void {
  e.alternativaPorConfirmar = null;
  if (r.opcion.startsWith(PREFIJO_ALTERNATIVA)) {
    if (e.decision) {
      return;
    }
    const elegida = partes(r.opcion, PREFIJO_ALTERNATIVA);
    if (e.rechazadas.includes(elegida.grupo)) {
      // Elegir como alternativa un grupo antes rechazado ya corrige aquel «No».
      e.decision = { ...elegida, motivo: 'confirmada' };
    } else {
      // «No es esta, es otra»: la propuesta queda rechazada y la alternativa, por confirmar.
      const propuesto = partes(r.pregunta, PREFIJO_PROPUESTA).grupo;
      e.rechazadas.push(propuesto);
      e.alternativaPorConfirmar = elegida;
      e.porAlternativa = { grupo: propuesto, alternativa: elegida.grupo };
    }
    return;
  }
  e.decision = e.decision ?? decisionDe(r);
  if (r.opcion === 'no') {
    const rechazado = partes(r.pregunta, PREFIJO_PROPUESTA).grupo;
    e.rechazadas.push(rechazado);
    deshacerRechazoPorAlternativa(e, rechazado);
  }
  e.porAlternativa = null;
}

/**
 * Si la persona eligió una alternativa y, al confirmarla, dice que no es esa, el grupo propuesto vuelve a estar en
 * juego
 *: nunca le dijo «No» a él; solo eligió otro que luego tampoco era. Con ruido, de los fallos que llegaban a
 * ver su grupo, 2 o 3 por tirada eran personas que pulsaban una alternativa por error cuando la propuesta era la suya.
 */
function deshacerRechazoPorAlternativa(e: LecturaEnCurso, rechazado: string): void {
  if (e.porAlternativa?.alternativa !== rechazado) {
    return;
  }
  const i = e.rechazadas.indexOf(e.porAlternativa.grupo);
  if (i >= 0) {
    e.rechazadas.splice(i, 1);
  }
}

export function leerPropuestas(respuestas: readonly Respuesta[]): LecturaDePropuestas {
  const e: LecturaEnCurso = { rechazadas: [], decision: null, alternativaPorConfirmar: null, porAlternativa: null };
  for (const r of respuestas.filter((x) => x.pregunta.startsWith(PREFIJO_PROPUESTA))) {
    leerUna(r, e);
  }
  const ultima = respuestas.at(-1);
  const deUnaPropuesta = ultima?.pregunta.startsWith(PREFIJO_PROPUESTA) ? ultima : undefined;
  return {
    rechazadas: e.rechazadas,
    decision: e.decision,
    ultimaFueRechazo: deUnaPropuesta?.opcion === 'no',
    alternativaPorConfirmar: deUnaPropuesta?.opcion.startsWith(PREFIJO_ALTERNATIVA) ? e.alternativaPorConfirmar : null,
  };
}

function titulo(a: Atributos, h: Hipotesis, d: DatosDePropuesta): { texto: string; esOcupacion: boolean } {
  const { idioma } = d;
  const o = h.ocupacion;
  const deOcupacion = idioma === 'ca' ? (o?.tituloCa ?? o?.titulo) : o?.titulo;
  if (deOcupacion) {
    return { texto: tituloEnGenero(deOcupacion, d.genero, idioma), esOcupacion: true };
  }
  return { texto: a.etiquetas4[h.grupo]?.[idioma] ?? h.grupo, esOcupacion: false };
}

interface DatosDePropuesta {
  readonly propuesta: Hipotesis;
  readonly alternativas: readonly Hipotesis[];
  readonly idioma: Idioma;
  readonly numero: number;
  readonly maximo: number;
  readonly preguntasHechas: number;
  /** Género con que se expresa la persona, para los títulos dobles («maestro/maestra»). */
  readonly genero?: 'f' | 'm' | undefined;
}

/** El paso «propuesta» listo para la interfaz. */
export function pasoDePropuesta(a: Atributos, d: DatosDePropuesta): Paso {
  const t = titulo(a, d.propuesta, d);
  const plantilla = t.esOcupacion ? PROPUESTA.ocupacion : PROPUESTA.grupo;
  const opciones: Opcion[] = [
    { id: 'si', texto: PROPUESTA.si[d.idioma] },
    ...(t.esOcupacion ? [{ id: 'parecida', texto: PROPUESTA.parecida[d.idioma] }] : []),
    { id: 'no', texto: PROPUESTA.no[d.idioma] },
  ];
  return {
    tipo: 'propuesta',
    id: idDePropuesta(d.propuesta),
    texto: plantilla[d.idioma].replace('{titulo}', t.texto),
    propuesta: d.propuesta,
    opciones,
    alternativas: d.alternativas.map((h) => ({
      id: `${PREFIJO_ALTERNATIVA}${h.grupo}${SEPARADOR}${h.ocupacion?.esco ?? ''}`,
      texto: titulo(a, h, d).texto,
      hipotesis: h,
    })),
    numero: d.numero,
    maximo: d.maximo,
    preguntasHechas: d.preguntasHechas,
    buscarYo: BUSCAR_YO[d.idioma],
  };
}
