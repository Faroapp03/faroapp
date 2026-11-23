// Los capítulos de pesas de «Datos globales · Cataluña y países» (datos-globales.html): 03 · Mujeres y hombres (la
// diferencia en puntos, para cualquier uso o para el trabajo) y 04 · Tipo de trabajo (cuántas veces más en los trabajos
// no manuales). Cada fila es un territorio, con un círculo (mujeres; trabajo manual) y un cuadrado (hombres; trabajo
// no manual): el color dice el territorio y la forma, la serie. La media de la UE va abajo, tras una raya. Un
// territorio sin las dos cifras del año no se pone: lo dice una nota (Francia no publica el corte manual / no manual).

import { traducible } from '../textos.js';
import {
  CODIGO_DE_ESPANA,
  CODIGO_DE_FRANCIA,
  CODIGO_DE_LA_UE,
  CODIGO_PROPIO,
  comparar,
  DOBLE,
  ESCALAS,
  escalaPara,
  INDICADORES,
  numeroDelCapitulo,
  ORDEN_DE_LOS_TERRITORIOS,
} from './capitulos.js';
import { distanciaEscrita, numeroEscrito, resta, veces, vecesEscritas } from './cifras.js';
import {
  anioDeLaComparacion,
  apartadosDeMetodo,
  CON_LA_UE,
  cifraDelAnio,
  detalleDe,
  entero,
  juntas,
  nombreCorto,
  nombreLargo,
  notaSinCifra,
  papelDe,
} from './comparacion.js';
import { grafico, pesas } from './dibujo.js';
import { fichaTecnica } from './ficha.js';
import { capitulo, figura, interruptor, marcaDeIndicador } from './seccion.js';

/**
 * El último año en que Francia publicó el corte por ocupación manual y no manual de la encuesta: un hecho de la fuente,
 * no un año relativo al del gráfico.
 */
const ULTIMO_ANIO_DEL_CORTE_EN_FRANCIA = 2024;

/**
 * @import { DatosGlobales } from './datos.js'
 * @import { FilaDePesas } from './dibujo.js'
 * @import { Apartado } from './ficha.js'
 * @import { Parte } from '../textos.js'
 * @import { Frase } from './seccion.js'
 * @typedef {{ codigo: string, a: number, b: number }} Par
 */

/**
 * Las parejas de cifras de un año en los territorios que tienen las dos, de mayor a menor por `orden` (la cifra que
 * ordena), con la UE al final.
 * @param {DatosGlobales} datos @param {{ ids: readonly [string, string], anio: number, orden: (par: Par) => number }} parejas
 * @returns {{ pares: Par[], sinCifra: string[] }}
 */
function paresDelAnio(datos, { ids: [idA, idB], anio, orden }) {
  const pares = CON_LA_UE.flatMap((codigo) => {
    const a = cifraDelAnio(datos, codigo, idA, anio);
    const b = cifraDelAnio(datos, codigo, idB, anio);
    return a === null || b === null ? [] : [{ codigo, a, b }];
  });
  const paises = pares.filter(({ codigo }) => codigo !== CODIGO_DE_LA_UE).sort((x, y) => orden(y) - orden(x));
  return {
    pares: [...paises, ...pares.filter(({ codigo }) => codigo === CODIGO_DE_LA_UE)],
    sinCifra: ORDEN_DE_LOS_TERRITORIOS.filter((codigo) => !pares.some((par) => par.codigo === codigo)),
  };
}

/**
 * Las filas de unas pesas, con la diferencia escrita: en puntos («6,1 puntos») o en veces («×5,5»).
 * @param {DatosGlobales} datos @param {Par[]} pares @param {'puntos' | 'veces'} diferencia @returns {FilaDePesas[]}
 */
function filasDePesas(datos, pares, diferencia) {
  return pares.map(({ codigo, a, b }) => {
    const corta = diferencia === 'puntos' ? distanciaEscrita(b, a) : (vecesEscritas(b, a) ?? '—');
    return {
      papel: papelDe(codigo),
      nombre: nombreCorto(datos, codigo),
      detalle: detalleDe(codigo),
      a,
      b,
      diferencia: {
        larga: diferencia === 'puntos' ? traducible('datos-globales.puntos', { puntos: corta }) : corta,
        corta,
      },
    };
  });
}

/**
 * La alternativa en texto de unas pesas: cada territorio con sus dos cifras y su diferencia.
 * @param {DatosGlobales} datos @param {Par[]} pares @param {string} clave la de la frase de cada fila @returns {Parte[]}
 */
function alternativaDePesas(datos, pares, clave) {
  return pares.map(({ codigo, a, b }) =>
    traducible(clave, {
      territorio: nombreLargo(datos, codigo),
      a: numeroEscrito(a),
      b: numeroEscrito(b),
      puntos: distanciaEscrita(b, a),
      veces: vecesEscritas(b, a) ?? '—',
    }),
  );
}

/**
 * El gráfico de 03, con su interruptor: para cualquier uso o para su trabajo, con la misma escala y el mismo orden.
 * @param {DatosGlobales} datos @param {{ todo: Par[], trabajo: Par[] }} usos
 */
function pesasDeGenero(datos, { todo, trabajo }) {
  const escala = escalaPara(
    ESCALAS.personas,
    [...todo, ...trabajo].flatMap(({ a, b }) => [a, b]),
  );
  /** @type {Record<string, FilaDePesas[]>} */
  const filas = { todo: filasDePesas(datos, todo, 'puntos'), trabajo: filasDePesas(datos, trabajo, 'puntos') };
  let elegido = 'todo';
  const dibujo = grafico((ancho) =>
    pesas({
      filas: filas[elegido] ?? [],
      nombres: [traducible('datos-globales.genero.mujeres'), traducible('datos-globales.genero.hombres')],
      cabecera: [traducible('datos-globales.genero.cabecera'), traducible('datos-globales.cabecera.corta')],
      escala,
    })(ancho),
  );
  const control = trabajo.length
    ? interruptor({
        nombre: traducible('datos-globales.genero.interruptor'),
        opciones: [
          { clave: 'todo', texto: traducible('datos-globales.personas.panel.cualquier') },
          { clave: 'trabajo', texto: traducible('datos-globales.personas.panel.trabajo') },
        ],
        elegida: elegido,
        alElegir: (clave) => {
          elegido = clave;
          dibujo.redibujar();
        },
      })
    : null;
  return { nodo: dibujo.nodo, control };
}

/**
 * Las frases de 03: la diferencia en Cataluña, para el trabajo y en la media de la UE.
 * @param {{ todo: Par[], trabajo: Par[] }} usos @returns {Frase[]}
 */
function lecturaDeGenero({ todo, trabajo }) {
  const de = (/** @type {Par[]} */ pares, /** @type {string} */ codigo) => pares.find((par) => par.codigo === codigo);
  const propio = de(todo, CODIGO_PROPIO);
  const propioTrabajo = de(trabajo, CODIGO_PROPIO);
  const ue = de(todo, CODIGO_DE_LA_UE);
  const cifras = (/** @type {Par} */ { a, b }) => ({
    mujeres: entero(a),
    hombres: entero(b),
    puntos: distanciaEscrita(b, a),
  });
  const brecha = (/** @type {Par} */ { a, b }) => Math.abs(resta(b, a));
  /** @type {Frase[]} */
  const frases = [];
  if (propio) {
    const otros = todo.filter(({ codigo }) => codigo !== CODIGO_PROPIO && codigo !== CODIGO_DE_LA_UE);
    const mayor = otros.length > 0 && otros.every((otro) => comparar(brecha(propio), brecha(otro)) === 'mas');
    const texto = traducible('datos-globales.genero.lectura.cataluna', cifras(propio));
    frases.push([
      traducible('datos-globales.genero.lectura.cataluna.titulo', cifras(propio)),
      mayor ? juntas(texto, traducible('datos-globales.genero.lectura.mayor')) : texto,
    ]);
  }
  if (propio && propioTrabajo) {
    const menor = brecha(propioTrabajo) < brecha(propio);
    frases.push([
      traducible(
        menor ? 'datos-globales.genero.lectura.trabajo.menor' : 'datos-globales.genero.lectura.trabajo.titulo',
      ),
      traducible('datos-globales.genero.lectura.trabajo', cifras(propioTrabajo)),
    ]);
  }
  if (ue) {
    frases.push([
      traducible('datos-globales.genero.lectura.ue.titulo', cifras(ue)),
      traducible('datos-globales.genero.lectura.ue', cifras(ue)),
    ]);
  }
  return frases;
}

/**
 * La entradilla de 03: si los hombres la usan más en todos los territorios y en la UE, y si para trabajar la diferencia
 * de Cataluña es menor. @param {{ todo: Par[], trabajo: Par[] }} usos @returns {Parte[]}
 */
function entradillaDeGenero({ todo, trabajo }) {
  const brecha = (/** @type {Par | undefined} */ par) => (par ? Math.abs(resta(par.b, par.a)) : 0);
  const todos = todo.length > 1 && todo.every(({ a, b }) => comparar(b, a) === 'mas');
  const propio = todo.find(({ codigo }) => codigo === CODIGO_PROPIO);
  const propioTrabajo = trabajo.find(({ codigo }) => codigo === CODIGO_PROPIO);
  return [
    traducible(todos ? 'datos-globales.genero.entradilla.todos' : 'datos-globales.genero.entradilla'),
    ...(propio && propioTrabajo && brecha(propioTrabajo) < brecha(propio)
      ? [traducible('datos-globales.genero.entradilla.trabajo')]
      : []),
  ];
}

/**
 * Las parejas de 03 en un año: para cualquier uso (de mayor a menor por la media de las dos cifras) y para el trabajo,
 * en el mismo orden. @param {DatosGlobales} datos @param {number} anio
 */
function paresDeGenero(datos, anio) {
  const media = (/** @type {Par} */ { a, b }) => (a + b) / 2;
  const { pares: todo, sinCifra } = paresDelAnio(datos, {
    ids: [INDICADORES.mujeres, INDICADORES.hombres],
    anio,
    orden: media,
  });
  const orden = todo.map(({ codigo }) => codigo);
  const trabajo = paresDelAnio(datos, {
    ids: [INDICADORES.mujeresTrabajo, INDICADORES.hombresTrabajo],
    anio,
    orden: media,
  }).pares.sort((x, y) => orden.indexOf(x.codigo) - orden.indexOf(y.codigo));
  return { todo, trabajo, sinCifra };
}

/**
 * La figura de 03: las pesas con su interruptor, la alternativa en texto de los dos usos y las notas.
 * @param {DatosGlobales} datos
 * @param {{ todo: Par[], trabajo: Par[], sinCifra: string[], anio: number }} pares
 * @param {ReturnType<typeof pesasDeGenero>} dibujo
 * @returns {HTMLElement}
 */
function figuraDeGenero(datos, { todo, trabajo, sinCifra, anio }, { nodo, control }) {
  const clave = 'datos-globales.genero.alternativa';
  return figura({
    titulo: traducible('datos-globales.genero.figura'),
    sub: [traducible('datos-globales.genero.figura.sub', { anio })],
    control,
    marca: null,
    paneles: [{ titulo: null, nodo }],
    alternativa: [
      traducible('datos-globales.personas.panel.cualquier'),
      ...alternativaDePesas(datos, todo, clave),
      ...(trabajo.length
        ? [traducible('datos-globales.personas.panel.trabajo'), ...alternativaDePesas(datos, trabajo, clave)]
        : []),
    ],
    fuente: traducible('datos-globales.personas.fuente'),
    notas: [traducible('datos-globales.genero.nota'), ...notaSinCifra(datos, sinCifra, anio)],
  });
}

/**
 * 03 · Mujeres y hombres.
 * @param {DatosGlobales} datos @param {string} variante La del titular (variantesDelTitular).
 * @returns {HTMLElement[]} La sección del capítulo, o ninguna sin cifras.
 */
export function capituloGenero(datos, variante) {
  const anio = anioDeLaComparacion(datos, INDICADORES.mujeres);
  if (anio === null) {
    return [];
  }
  const { todo, trabajo, sinCifra } = paresDeGenero(datos, anio);
  const propio = todo.find(({ codigo }) => codigo === CODIGO_PROPIO);
  if (!todo.length) {
    return [];
  }
  const dibujo = pesasDeGenero(datos, { todo, trabajo });
  return [
    capitulo({
      id: 'genero',
      numero: numeroDelCapitulo('genero'),
      tema: traducible('datos-globales.genero.tema'),
      pregunta: traducible('datos-globales.genero.pregunta'),
      titular: traducible(
        `datos-globales.genero.titular.${variante}`,
        propio ? { mujeres: entero(propio.a), hombres: entero(propio.b) } : {},
      ),
      entradilla: entradillaDeGenero({ todo, trabajo }),
      figuras: [figuraDeGenero(datos, { todo, trabajo, sinCifra, anio }, dibujo)],
      lectura: lecturaDeGenero({ todo, trabajo }),
      ficha: fichaTecnica([
        ['que-mide', traducible('datos-globales.genero.ficha.que-mide')],
        ['diferencia', traducible('datos-globales.genero.ficha.diferencia')],
        ['base', traducible('datos-globales.genero.ficha.base')],
        ...apartadosDeMetodo(null),
        ['fuente', traducible('datos-globales.genero.ficha.fuente')],
        ['tipo', marcaDeIndicador(datos, INDICADORES.mujeres)],
      ]),
    }),
  ];
}

/**
 * Las frases de 04: Cataluña, los profesionales de la informática en España y la media de la UE.
 * @param {DatosGlobales} datos @param {Par[]} pares @param {number} anio @returns {Frase[]}
 */
function lecturaDeOcupacion(datos, pares, anio) {
  const cifras = (/** @type {Par} */ { a, b }) => ({
    manual: entero(a),
    noManual: entero(b),
    veces: numeroEscrito(veces(b, a) ?? 0),
  });
  const propio = pares.find(({ codigo }) => codigo === CODIGO_PROPIO);
  const ue = pares.find(({ codigo }) => codigo === CODIGO_DE_LA_UE);
  const tic = cifraDelAnio(datos, CODIGO_DE_ESPANA, INDICADORES.tic, anio);
  /** @type {Frase[]} */
  const frases = [];
  if (propio) {
    const grado = (veces(propio.b, propio.a) ?? 0) >= DOBLE ? 'mucho-mas' : comparar(propio.b, propio.a);
    frases.push([
      traducible(`datos-globales.ocupacion.lectura.cataluna.${grado}`),
      traducible('datos-globales.ocupacion.lectura.cataluna', cifras(propio)),
    ]);
  }
  if (tic !== null) {
    frases.push([
      traducible('datos-globales.ocupacion.tic'),
      traducible('datos-globales.ocupacion.lectura.tic', { cifra: entero(tic) }),
    ]);
  }
  if (ue) {
    frases.push([
      traducible('datos-globales.lectura.ue.titulo'),
      traducible('datos-globales.ocupacion.lectura.ue', cifras(ue)),
    ]);
  }
  return frases;
}

/**
 * Las notas de 04: qué es cada forma y quién no tiene el dato (Francia, con el último año que lo publicó).
 * @param {DatosGlobales} datos @param {string[]} sinCifra @param {number} anio @returns {Parte[]}
 */
function notasDeOcupacion(datos, sinCifra, anio) {
  const francia = sinCifra.includes(CODIGO_DE_FRANCIA);
  return [
    traducible('datos-globales.ocupacion.nota'),
    traducible('datos-globales.ocupacion.grupos.breve'),
    ...(francia
      ? [traducible('datos-globales.ocupacion.francia', { anio, anterior: ULTIMO_ANIO_DEL_CORTE_EN_FRANCIA })]
      : []),
    ...notaSinCifra(
      datos,
      sinCifra.filter((codigo) => codigo !== CODIGO_DE_FRANCIA),
      anio,
    ),
  ];
}

/**
 * Las pesas de 04, con la escala de sus cifras: el círculo, el trabajo manual; el cuadrado, el no manual.
 * @param {DatosGlobales} datos @param {Par[]} pares
 */
function dibujoDeOcupacion(datos, pares) {
  const escala = escalaPara(
    ESCALAS.personas,
    pares.flatMap(({ a, b }) => [a, b]),
  );
  return grafico(
    pesas({
      filas: filasDePesas(datos, pares, 'veces'),
      nombres: [traducible('datos-globales.ocupacion.manual'), traducible('datos-globales.ocupacion.no-manual')],
      cabecera: [traducible('datos-globales.ocupacion.cabecera'), traducible('datos-globales.ocupacion.cabecera')],
      escala,
    }),
  );
}

/**
 * La ficha técnica de 04: el método, cuántas veces más en Cataluña y, si falta, el último año de Francia.
 * @param {DatosGlobales} datos @param {{ propio: Par | undefined, franciaFalta: boolean, anio: number }} ficha
 * @returns {HTMLDetailsElement}
 */
function fichaDeOcupacion(datos, { propio, franciaFalta, anio }) {
  return fichaTecnica([
    ['que-mide', traducible('datos-globales.ocupacion.ficha.que-mide')],
    ['grupos', traducible('datos-globales.ocupacion.ficha.grupos')],
    ...(propio
      ? /** @type {[Apartado, Parte][]} */ ([
          [
            'veces',
            traducible('datos-globales.ocupacion.ficha.veces', {
              noManual: numeroEscrito(propio.b),
              manual: numeroEscrito(propio.a),
              veces: numeroEscrito(veces(propio.b, propio.a) ?? 0),
            }),
          ],
        ])
      : []),
    ['base', traducible('datos-globales.ocupacion.ficha.base')],
    ...apartadosDeMetodo(null),
    ...(franciaFalta
      ? /** @type {[Apartado, Parte][]} */ ([
          [
            'francia',
            traducible('datos-globales.ocupacion.ficha.francia', {
              anio,
              anterior: ULTIMO_ANIO_DEL_CORTE_EN_FRANCIA,
            }),
          ],
        ])
      : []),
    ['fuente', traducible('datos-globales.ocupacion.ficha.fuente')],
    ['tipo', marcaDeIndicador(datos, INDICADORES.noManual)],
  ]);
}

/**
 * 04 · Tipo de trabajo: ocupaciones manuales y no manuales.
 * @param {DatosGlobales} datos @param {string} variante La del titular (variantesDelTitular).
 * @returns {HTMLElement[]} La sección del capítulo, o ninguna sin cifras.
 */
export function capituloOcupacion(datos, variante) {
  const ids = /** @type {const} */ ([INDICADORES.manual, INDICADORES.noManual]);
  const anio = anioDeLaComparacion(datos, INDICADORES.noManual);
  const { pares, sinCifra } =
    anio === null ? { pares: [], sinCifra: [] } : paresDelAnio(datos, { ids, anio, orden: ({ b }) => b });
  if (anio === null || !pares.length) {
    return [];
  }
  const dibujo = dibujoDeOcupacion(datos, pares);
  const propio = pares.find(({ codigo }) => codigo === CODIGO_PROPIO);
  const todos = pares.every(({ a, b }) => (veces(b, a) ?? 0) >= DOBLE);
  const franciaFalta = sinCifra.includes(CODIGO_DE_FRANCIA);
  return [
    capitulo({
      id: 'ocupacion',
      numero: numeroDelCapitulo('ocupacion'),
      tema: traducible('datos-globales.ocupacion.tema'),
      pregunta: traducible('datos-globales.ocupacion.pregunta'),
      titular: traducible(
        `datos-globales.ocupacion.titular.${variante}`,
        propio ? { manual: entero(propio.a), noManual: entero(propio.b) } : {},
      ),
      entradilla: [
        traducible(todos ? 'datos-globales.ocupacion.entradilla.todos' : 'datos-globales.ocupacion.entradilla'),
      ],
      figuras: [
        figura({
          titulo: traducible('datos-globales.ocupacion.figura'),
          sub: [traducible('datos-globales.ocupacion.figura.sub', { anio })],
          control: null,
          marca: null,
          paneles: [{ titulo: null, nodo: dibujo.nodo }],
          alternativa: alternativaDePesas(datos, pares, 'datos-globales.ocupacion.alternativa'),
          fuente: traducible('datos-globales.personas.fuente'),
          notas: notasDeOcupacion(datos, sinCifra, anio),
        }),
      ],
      lectura: lecturaDeOcupacion(datos, pares, anio),
      ficha: fichaDeOcupacion(datos, { propio, franciaFalta, anio }),
    }),
  ];
}
