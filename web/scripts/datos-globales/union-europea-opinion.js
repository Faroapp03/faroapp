// El capítulo 10 · Opinión de «Datos globales · Unión Europea» (datos-globales-ue.html): las preguntas del
// Eurobarómetro especial 554 que trae el archivo con cifra de la UE-27, en barras tenues (es opinión, no una medida),
// en enteros y de 0 a 100. Una pregunta que no está no se pinta; una nueva sale sola, con el nombre que le da el archivo.

import { conVersiones, traducible } from '../textos.js';
import { ESCALAS } from './capitulos.js';
import { cifraDelBloque } from './datos.js';
import { fichaTecnica, marcaDeOpinion } from './ficha.js';
import { ENCUESTAS, MAYORIA } from './opinion.js';
import { figura } from './seccion.js';
import { CODIGO_DE_LA_UE, capituloUe, entero, panelUe } from './union-europea-piezas.js';

/**
 * @import { DatosGlobales, Encuesta } from './datos.js'
 * @import { Parte } from '../textos.js'
 * @import { Frase } from './seccion.js'
 * @typedef {{ numero: string, encuesta: Encuesta, cifra: number, anio: number }} Pregunta
 */

/** El número de una pregunta al principio de su texto literal («QB6.1. …»): el número entero y su batería. */
const NUMERO_DE_PREGUNTA = /^((QB\d+)(?:\.\d+)*)\.?\s/;
/** El orden del cuestionario entre números de pregunta («QB5» antes que «QB10»). */
const ORDEN_DE_PREGUNTAS = new Intl.Collator('en', { numeric: true });
/** Las baterías: las frases (QB5 y QB6), las reglas (QB11) y lo que dicen quienes trabajan para un jefe (QB3). */
const BATERIAS = Object.freeze({
  frases: Object.freeze(['QB5', 'QB6']),
  reglas: Object.freeze(['QB11']),
  trabajo: Object.freeze(['QB3']),
});
/** El nombre corto de cada pregunta en su gráfico, por su id; una que no está aquí sale con el del archivo. */
const NOMBRES_CORTOS = new Map([
  ['opinion-ia-gestionar-con-cuidado', 'datos-globales.ue.opinion.cuidado'],
  ['opinion-ia-destruira-mas-empleo', 'datos-globales.ue.opinion.destruira'],
  ['opinion-ia-buena-para-la-sociedad', 'datos-globales.ue.opinion.sociedad'],
  ['opinion-ia-en-el-trabajo-positiva', 'datos-globales.ue.opinion.positiva'],
  ['opinion-regla-ia-proteger-intimidad', 'datos-globales.ue.opinion.regla.intimidad'],
  ['opinion-regla-ia-implicar-trabajadores', 'datos-globales.ue.opinion.regla.trabajadores'],
  ['opinion-regla-ia-transparencia-personal', 'datos-globales.ue.opinion.regla.transparencia'],
  ['opinion-regla-ia-prohibir-decisiones-automaticas', 'datos-globales.ue.opinion.regla.decisiones'],
  ['opinion-regla-ia-limitar-vigilancia', 'datos-globales.ue.opinion.regla.vigilancia'],
]);

/** El nombre de una pregunta: el corto o el del archivo. @param {Encuesta} encuesta @returns {Parte} */
function nombreDePregunta({ id, nombre }) {
  const clave = NOMBRES_CORTOS.get(id);
  return clave === undefined ? conVersiones(nombre) : traducible(clave);
}

/**
 * Las preguntas de unas baterías con cifra de la UE, de mayor a menor cifra; a igual cifra, por su número.
 * @param {DatosGlobales} datos @param {readonly string[]} baterias @returns {Pregunta[]}
 */
function preguntasDeLaUe(datos, baterias) {
  return datos.encuestas
    .flatMap((encuesta) => {
      const [, numero = '', bateria = ''] = NUMERO_DE_PREGUNTA.exec(encuesta.pregunta) ?? [];
      const cifra = baterias.includes(bateria) ? cifraDelBloque(datos, encuesta, CODIGO_DE_LA_UE) : null;
      return cifra ? [{ numero, encuesta, cifra: cifra.valor, anio: cifra.anio }] : [];
    })
    .sort((a, b) => b.cifra - a.cifra || ORDEN_DE_PREGUNTAS.compare(a.numero, b.numero));
}

/** Los números de unas preguntas, en el orden del cuestionario: «QB5, QB6.1». @param {Pregunta[]} preguntas */
function numerosDe(preguntas) {
  return preguntas
    .map(({ numero }) => numero)
    .sort(ORDEN_DE_PREGUNTAS.compare)
    .join(', ');
}

/** Un panel de opinión: barras tenues, una por pregunta. @param {Pregunta[]} preguntas */
function panelDe(preguntas) {
  const filas = preguntas.map(({ encuesta, cifra }) => ({
    papel: /** @type {const} */ ('ue'),
    nombre: nombreDePregunta(encuesta),
    detalle: null,
    valor: cifra,
  }));
  return panelUe(filas, ESCALAS.opinion, { opinion: true, decimales: 0 });
}

/**
 * Las frases de la lectura: las dos preguntas principales y la de quienes trabajan para un jefe (o las reglas).
 * @param {Pregunta[]} frases @param {Pregunta[]} reglas @param {Pregunta[]} trabajo @returns {Frase[]}
 */
function lecturaDeOpinion(frases, reglas, trabajo) {
  const cifra = (/** @type {string} */ id) => frases.find(({ encuesta }) => encuesta.id === id)?.cifra ?? null;
  const positiva = cifra(ENCUESTAS.positiva);
  const destruira = cifra(ENCUESTAS.destruira);
  /** @type {Frase[]} */
  const lectura = [];
  for (const [valor, clave] of /** @type {const} */ ([
    [positiva, 'positiva'],
    [destruira, 'destruira'],
  ])) {
    if (valor !== null) {
      lectura.push([
        traducible(`datos-globales.opinion.lectura.${clave}.${valor > MAYORIA ? 'mayoria' : 'dividida'}`),
        traducible(`datos-globales.ue.opinion.lectura.${clave}`, { cifra: entero(valor) }),
      ]);
    }
  }
  const [herramientas] = trabajo;
  if (herramientas) {
    const conocida = herramientas.encuesta.id === 'opinion-empleador-da-herramientas-ia';
    lectura.push([
      traducible(conocida ? 'datos-globales.ue.opinion.herramientas' : 'datos-globales.ue.opinion.trabajo'),
      conocida
        ? traducible('datos-globales.ue.opinion.lectura.herramientas', { cifra: entero(herramientas.cifra) })
        : traducible('datos-globales.ue.opinion.lectura.trabajo', {
            pregunta: conVersiones(herramientas.encuesta.nombre),
            cifra: entero(herramientas.cifra),
          }),
    ]);
  } else if (reglas.length) {
    const cifras = reglas.map(({ cifra: c }) => c);
    lectura.push([
      traducible('datos-globales.ue.opinion.lectura.reglas.titulo'),
      traducible('datos-globales.ue.opinion.lectura.reglas', {
        minimo: entero(Math.min(...cifras)),
        maximo: entero(Math.max(...cifras)),
      }),
    ]);
  }
  return lectura;
}

/**
 * La figura de 10: un panel por batería con la misma escala, de barras tenues.
 * @param {{ titulo: string, nodo: HTMLElement, alternativa: Parte[] }[]} paneles @param {Pregunta[]} preguntas las
 *   de los paneles, para la fuente @param {number} anio
 * @returns {HTMLElement}
 */
function figuraDeOpinion(paneles, preguntas, anio) {
  return figura({
    titulo: traducible('datos-globales.ue.opinion.figura'),
    sub: [
      traducible('datos-globales.ue.opinion.figura.sub', { anio }),
      ...(paneles.length > 1 ? [traducible('datos-globales.paneles.misma-escala')] : []),
    ],
    control: null,
    marca: marcaDeOpinion(),
    paneles: paneles.map(({ titulo, nodo }) => ({ titulo: traducible(titulo), nodo })),
    alternativa: paneles.flatMap(({ titulo, alternativa }) => [traducible(titulo), ...alternativa]),
    fuente: traducible('datos-globales.ue.opinion.fuente', { preguntas: numerosDe(preguntas) }),
    notas: [],
  });
}

/**
 * La ficha de 10: las preguntas, la base (si hay preguntas para quienes trabajan) y el método.
 * @param {Pregunta[]} todas @param {boolean} conTrabajo @returns {HTMLDetailsElement}
 */
function fichaDeOpinion(todas, conTrabajo) {
  return fichaTecnica([
    ['preguntas', traducible('datos-globales.ue.opinion.ficha.preguntas', { preguntas: numerosDe(todas) })],
    ...(conTrabajo
      ? /** @type {[string, Parte][]} */ ([['base', traducible('datos-globales.ue.opinion.ficha.base')]])
      : []),
    ['cifras', traducible('datos-globales.ue.opinion.ficha.cifras')],
    ['encuesta', traducible('datos-globales.ue.opinion.ficha.encuesta')],
    ['margen', traducible('datos-globales.ue.opinion.ficha.margen')],
    ['tipo', marcaDeOpinion()],
  ]);
}

/**
 * 10 · Opinión: las preguntas del Eurobarómetro que trae el archivo con cifra de la UE-27. El titular dice «la mayoría
 * ve bien» si más de la mitad ve bien la IA en el trabajo (QB5) y, si además más de la mitad ve importante cada regla
 * (QB11), «y pide reglas». @param {DatosGlobales} datos @returns {HTMLElement[]}
 */
export function opinion(datos) {
  const frases = preguntasDeLaUe(datos, BATERIAS.frases);
  const reglas = preguntasDeLaUe(datos, BATERIAS.reglas);
  const trabajo = preguntasDeLaUe(datos, BATERIAS.trabajo);
  const todas = [...frases, ...reglas, ...trabajo];
  const positiva = frases.find(({ encuesta }) => encuesta.id === ENCUESTAS.positiva)?.cifra ?? null;
  const veBien = positiva !== null && positiva > MAYORIA;
  const pideReglas = reglas.length > 0 && reglas.every(({ cifra }) => cifra > MAYORIA);
  const anio = Math.max(0, ...todas.map((pregunta) => pregunta.anio));
  const paneles = [
    ...(frases.length ? [{ titulo: 'datos-globales.ue.opinion.panel.frases', ...panelDe(frases) }] : []),
    ...(reglas.length ? [{ titulo: 'datos-globales.ue.opinion.panel.reglas', ...panelDe(reglas) }] : []),
  ];
  if (!paneles.length) {
    return [];
  }
  let titular = 'neutro';
  if (veBien) {
    titular = pideReglas ? 'reglas' : 'hallazgo';
  }
  return capituloUe({
    id: 'opinion',
    orden: 10,
    titular: traducible(`datos-globales.ue.opinion.titular.${titular}`),
    entradilla: [traducible('datos-globales.ue.opinion.entradilla', { anio })],
    figuras: [figuraDeOpinion(paneles, [...frases, ...reglas], anio)],
    lectura: lecturaDeOpinion(frases, reglas, trabajo),
    ficha: fichaDeOpinion(todas, trabajo.length > 0),
  });
}
