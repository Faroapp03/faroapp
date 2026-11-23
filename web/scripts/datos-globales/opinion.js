// El capítulo 06 · Opinión de «Datos globales · Cataluña y países» (datos-globales.html): qué opina la gente de los
// robots y la IA en el trabajo, con el Eurobarómetro especial 554 (preguntas QB5 y QB6.1) en España, Alemania, Francia e
// Italia, y la media de la UE como referencia. Es una encuesta de opinión: sus barras van tenues, con su marca
// («○ Encuesta de opinión»), en enteros, como las publica, y en un eje de 0 a 100. El Eurobarómetro no da cifra de
// Cataluña: si el archivo trae la del CEO (otra pregunta, otra escala), va en una nota bajo el gráfico, nunca en una
// fila. La UE tiene además su capítulo de opinión en su página (datos-globales-ue.html).

import { traducible } from '../textos.js';
import {
  CODIGO_DE_LA_UE,
  CODIGO_PROPIO,
  ESCALAS,
  escalaPara,
  numeroDelCapitulo,
  ORDEN_DE_LOS_TERRITORIOS,
} from './capitulos.js';
import { numeroEscrito } from './cifras.js';
import { alternativaDeBarras, apartadosDeMetodo, detalleDe, entero, nombreCorto, papelDe } from './comparacion.js';
import { cifraDelBloque } from './datos.js';
import { barras, grafico } from './dibujo.js';
import { fichaTecnica, marcaDeOpinion } from './ficha.js';
import { capitulo, figura } from './seccion.js';

/**
 * @import { DatosGlobales, Encuesta } from './datos.js'
 * @import { Parte } from '../textos.js'
 * @import { Frase } from './seccion.js'
 * @typedef {{ codigo: string, valor: number }} Respuesta
 */

/** Las dos preguntas del Eurobarómetro especial 554, por su id en el bloque `encuestas`. */
export const ENCUESTAS = Object.freeze({
  positiva: 'opinion-ia-en-el-trabajo-positiva',
  destruira: 'opinion-ia-destruira-mas-empleo',
});
/** Lo que es «la mayoría»: más de la mitad. */
export const MAYORIA = 50;

/** Una encuesta del archivo, por su id, o null. @param {DatosGlobales} datos @param {string} id */
function encuestaDe(datos, id) {
  return datos.encuestas.find((encuesta) => encuesta.id === id) ?? null;
}

/**
 * La pregunta del CEO para Cataluña, si el archivo la trae: la única encuesta con cifra de Cataluña.
 * @param {DatosGlobales} datos @returns {Encuesta | null}
 */
function encuestaDeCataluna(datos) {
  return (
    datos.encuestas.find((encuesta) => encuesta.valores.some(({ territorio }) => territorio === CODIGO_PROPIO)) ?? null
  );
}

/**
 * Las respuestas de una encuesta en los países del dossier (Cataluña no tiene) y la de la UE.
 * @param {DatosGlobales} datos @param {Encuesta} encuesta
 * @returns {{ paises: Respuesta[], ue: Respuesta | null, anio: number | null }}
 */
function respuestasDe(datos, encuesta) {
  const paises = ORDEN_DE_LOS_TERRITORIOS.filter((codigo) => codigo !== CODIGO_PROPIO).flatMap((codigo) => {
    const cifra = cifraDelBloque(datos, encuesta, codigo);
    return cifra ? [{ codigo, valor: cifra.valor, anio: cifra.anio }] : [];
  });
  const deLaUe = cifraDelBloque(datos, encuesta, CODIGO_DE_LA_UE);
  const anios = paises.map(({ anio }) => anio);
  return {
    paises: paises.map(({ codigo, valor }) => ({ codigo, valor })),
    ue: deLaUe ? { codigo: CODIGO_DE_LA_UE, valor: deLaUe.valor } : null,
    anio: anios.length ? Math.max(...anios) : null,
  };
}

/**
 * Un panel de opinión: barras tenues de mayor a menor (o en el orden dado) y la media de la UE como referencia.
 * @param {DatosGlobales} datos
 * @param {{ respuestas: Respuesta[], ue: Respuesta | null, escala: { maximo: number, paso: number }, orden: string[] }} panel
 */
function panelDeOpinion(datos, { respuestas, ue, escala, orden }) {
  const filas = [...respuestas]
    .sort((a, b) => orden.indexOf(a.codigo) - orden.indexOf(b.codigo))
    .map(({ codigo, valor }) => ({
      codigo,
      valor,
      papel: papelDe(codigo),
      nombre: nombreCorto(datos, codigo),
      detalle: detalleDe(codigo),
    }));
  const referencia = ue
    ? { valor: ue.valor, rotulo: traducible('datos-globales.media-ue', { cifra: numeroEscrito(ue.valor, 0) }) }
    : null;
  return {
    nodo: grafico(barras({ filas, escala, referencia, opinion: true, decimales: 0 })).nodo,
    alternativa: alternativaDeBarras(datos, filas, referencia, 0),
  };
}

/**
 * Una frase de la lectura de opinión: el título dice si es la mayoría en todos los países y el texto, entre cuánto y
 * cuánto está y cuánto en la UE. @param {{ paises: Respuesta[], ue: Respuesta | null }} respuestas @param {string} pregunta
 * @returns {Frase[]}
 */
function fraseDeOpinion({ paises, ue }, pregunta) {
  const cifras = paises.map(({ valor }) => valor);
  if (!cifras.length) {
    return [];
  }
  const mayoria = cifras.every((cifra) => cifra > MAYORIA) ? 'mayoria' : 'dividida';
  const valores = {
    minimo: entero(Math.min(...cifras)),
    maximo: entero(Math.max(...cifras)),
    ue: ue ? entero(ue.valor) : '',
  };
  return [
    [
      traducible(`datos-globales.opinion.lectura.${pregunta}.${mayoria}`),
      traducible(`datos-globales.opinion.lectura.${pregunta}${ue ? '' : '.sin-ue'}`, valores),
    ],
  ];
}

/**
 * Las notas del gráfico: Cataluña, con la pregunta del CEO si el archivo la trae o sin cifra si no.
 * @param {DatosGlobales} datos @returns {{ notas: Parte[], ficha: Parte | null }}
 */
function notasDeCataluna(datos) {
  const cataluna = encuestaDeCataluna(datos);
  const cifra = cataluna ? cifraDelBloque(datos, cataluna, CODIGO_PROPIO) : null;
  if (!cataluna || !cifra) {
    return { notas: [traducible('datos-globales.opinion.sin-pregunta')], ficha: null };
  }
  return {
    notas: [traducible('datos-globales.opinion.nota.ceo', { cifra: entero(cifra.valor) })],
    ficha: traducible('datos-globales.opinion.ficha.cataluna', {
      fuente: cataluna.fuente,
      cifra: `${numeroEscrito(cifra.valor)} %`,
    }),
  };
}

/**
 * La figura de 06: los dos paneles con la misma escala, su alternativa en texto y las notas.
 * @param {{ paneles: ReturnType<typeof panelDeOpinion>[], anio: number, notas: Parte[] }} partes
 * @returns {HTMLElement}
 */
function figuraDeOpinion({ paneles, anio, notas }) {
  const [panelPositiva, panelDestruira] = paneles;
  return figura({
    titulo: traducible('datos-globales.opinion.figura'),
    sub: [traducible('datos-globales.opinion.figura.sub', { anio }), traducible('datos-globales.paneles.misma-escala')],
    control: null,
    marca: marcaDeOpinion(),
    paneles: [
      {
        titulo: traducible('datos-globales.opinion.panel.positiva'),
        nodo: panelPositiva?.nodo ?? document.createElement('div'),
      },
      {
        titulo: traducible('datos-globales.opinion.panel.destruira'),
        nodo: panelDestruira?.nodo ?? document.createElement('div'),
      },
    ],
    alternativa: [
      traducible('datos-globales.opinion.panel.positiva'),
      ...(panelPositiva?.alternativa ?? []),
      traducible('datos-globales.opinion.panel.destruira'),
      ...(panelDestruira?.alternativa ?? []),
    ],
    fuente: traducible('datos-globales.opinion.fuente'),
    notas,
  });
}

/**
 * 06 · Opinión, o nada si el archivo no trae las dos preguntas.
 * @param {DatosGlobales} datos @returns {HTMLElement[]}
 */
export function capituloOpinion(datos) {
  const encuestas = [encuestaDe(datos, ENCUESTAS.positiva), encuestaDe(datos, ENCUESTAS.destruira)];
  const [positiva, destruira] = encuestas.map((encuesta) => (encuesta ? respuestasDe(datos, encuesta) : null));
  if (!positiva?.paises.length || !destruira?.paises.length) {
    return [];
  }
  const anio = Math.max(positiva.anio ?? 0, destruira.anio ?? 0);
  const escala = escalaPara(ESCALAS.opinion, []);
  const orden = [...positiva.paises].sort((a, b) => b.valor - a.valor).map(({ codigo }) => codigo);
  const paneles = [positiva, destruira].map(({ paises, ue }) =>
    panelDeOpinion(datos, { respuestas: paises, ue, escala, orden }),
  );
  const mayorias = [positiva, destruira].every(({ paises }) => paises.every(({ valor }) => valor > MAYORIA));
  const cataluna = notasDeCataluna(datos);
  return [
    capitulo({
      id: 'opinion',
      numero: numeroDelCapitulo('opinion'),
      tema: traducible('datos-globales.opinion.tema'),
      pregunta: traducible('datos-globales.opinion.pregunta'),
      titular: traducible(`datos-globales.opinion.titular.${mayorias ? 'hallazgo' : 'neutro'}`),
      entradilla: [traducible('datos-globales.opinion.entradilla', { anio })],
      figuras: [figuraDeOpinion({ paneles, anio, notas: cataluna.notas })],
      lectura: [...fraseDeOpinion(positiva, 'positiva'), ...fraseDeOpinion(destruira, 'destruira')],
      ficha: fichaTecnica([
        ['preguntas', traducible('datos-globales.opinion.ficha.preguntas')],
        ['encuesta', traducible('datos-globales.opinion.ficha.encuesta')],
        ['cifras', traducible('datos-globales.opinion.ficha.cifras')],
        ...(cataluna.ficha ? /** @type {[string, Parte][]} */ ([['cataluna', cataluna.ficha]]) : []),
        ...apartadosDeMetodo(null, 'datos-globales.opinion.ficha.margen'),
        ['tipo', marcaDeOpinion()],
      ]),
    }),
  ];
}
