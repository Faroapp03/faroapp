// Los capítulos de «Datos globales · Cataluña y países» (datos-globales.html): 01 · Empresas, 02 · Personas,
// 05 · Formación y 07 · Dentro de las empresas aquí; 03 y 04 (las pesas), en parejas.js; 06 · Opinión, en opinion.js;
// y 08 · el cuadro, en cuadro.js. Cada capítulo es una pregunta sencilla y su titular la responde con las cifras del
// archivo (capitulos.js, variantesDelTitular); debajo, la entradilla, las figuras (dibujo.js), la lectura de tres frases
// y la ficha técnica, que es solo el método. Ninguna cifra va sin su frase: «24 de cada 100 empresas…». Las series
// muestran solo las cifras comparables y lo que se queda fuera se dice en una nota.

import { traducible } from '../textos.js';
import {
  CODIGO_DE_ESPANA,
  CODIGO_DE_LA_UE,
  CODIGO_PROPIO,
  comparar,
  ESCALAS,
  empresasMasDelDoble,
  escalaPara,
  INDICADORES as ID,
  numeroDelCapitulo,
  posicionDeCataluna,
  serieComparable,
  variantesDelTitular,
} from './capitulos.js';
import { numeroEscrito, veces } from './cifras.js';
import {
  alternativaDeLineas,
  anioDeLaComparacion,
  apartadosDeMetodo,
  cifraDelAnio,
  entero,
  filasAnuales,
  juntas,
  listaDeNombres,
  noComparables,
  nombreLargo,
  notaDeNoComparables,
  notaSinCifra,
  panelDeBarras,
  seriesDeLineas,
  tituloFrenteA,
} from './comparacion.js';
import { valorDe } from './datos.js';
import { barras, grafico, lineas, tablaAnual } from './dibujo.js';
import { fichaTecnica } from './ficha.js';
import { capituloOpinion } from './opinion.js';
import { capituloGenero, capituloOcupacion } from './parejas.js';
import { capitulo, figura, figuraDeTabla, marcaDeIndicador } from './seccion.js';

/**
 * @import { DatosGlobales } from './datos.js'
 * @import { Apartado } from './ficha.js'
 * @import { Parte, Valores } from '../textos.js'
 * @import { Frase } from './seccion.js'
 * @typedef {{ primera: { anio: number, valor: number }, ultima: { anio: number, valor: number } }} Extremos la primera
 *   y la última cifra comparables de Cataluña
 */

/**
 * La frase del puesto de Cataluña entre los cinco territorios: quién la supera en un punto o más, si ella supera a
 * todos o si no hay un primer puesto claro. @param {DatosGlobales} datos @param {string} id @returns {Frase[]}
 */
function fraseDelPuesto(datos, id) {
  const posicion = posicionDeCataluna(datos, id);
  if (!posicion) {
    return [];
  }
  const { propia, delante, primera, segundo } = posicion;
  const [unico] = delante;
  if (delante.length === 1 && unico) {
    return [
      [
        traducible('datos-globales.ranking.delante.titulo', { territorios: listaDeNombres(datos, [unico.codigo]) }),
        traducible('datos-globales.ranking.delante.uno', { cifra: entero(unico.cifra), propia: entero(propia) }),
      ],
    ];
  }
  if (delante.length > 1) {
    const codigos = delante.map(({ codigo }) => codigo);
    return [
      [
        traducible('datos-globales.ranking.delante.titulo', { territorios: listaDeNombres(datos, codigos) }),
        traducible('datos-globales.ranking.delante.varios', { propia: entero(propia) }),
      ],
    ];
  }
  return primera
    ? [
        [
          traducible('datos-globales.ranking.primera.titulo'),
          traducible('datos-globales.ranking.primera', {
            segundo: nombreLargo(datos, segundo.codigo),
            cifra: entero(segundo.cifra),
          }),
        ],
      ]
    : [[traducible('datos-globales.ranking.empate.titulo'), traducible('datos-globales.ranking.empate')]];
}

/**
 * La línea de evolución y la tabla año a año de un indicador, con su escala y lo que no se muestra.
 * @param {DatosGlobales} datos
 * @param {{ id: string, capitulo: string, escala: { maximo: number, paso: number } }} serie
 * @returns {{ figuras: HTMLElement[], anios: number[], fuera: Parte[], todo: Parte[] } | null}
 */
function evolucionYTabla(datos, { id, capitulo: nombre, escala: base }) {
  const { series, anios } = seriesDeLineas(datos, id);
  const desde = anios[0];
  const hasta = anios.at(-1);
  if (desde === undefined || hasta === undefined) {
    return null;
  }
  const escala = escalaPara(
    base,
    series.flatMap(({ puntos }) => puntos.map(({ valor }) => valor)),
  );
  const fuera = noComparables(datos, id, desde);
  const linea = grafico(lineas({ series, desde, hasta, escala }));
  const tabla = tablaAnual({
    id: `dg-${nombre}-anual`,
    leyenda: traducible(`datos-globales.${nombre}.anual.leyenda`),
    territorio: traducible('datos-globales.anual.territorio'),
    filas: filasAnuales(datos, series),
    anios,
    maximo: escala.maximo,
    sinDato: traducible('datos-globales.anual.sin-dato'),
  });
  const huecos = series.some(({ puntos }) => puntos.length < anios.length);
  const figuras = [
    figura({
      titulo: traducible(`datos-globales.${nombre}.figura`),
      sub: [traducible(`datos-globales.${nombre}.figura.sub`, { desde, hasta })],
      control: null,
      marca: null,
      paneles: [{ titulo: null, nodo: linea.nodo }],
      alternativa: [traducible(`datos-globales.${nombre}.figura`), ...alternativaDeLineas(datos, series)],
      fuente: traducible(`datos-globales.${nombre}.fuente`),
      notas: notaDeNoComparables(fuera),
    }),
    figuraDeTabla({
      titulo: traducible('datos-globales.anual.titulo'),
      sub: traducible(`datos-globales.${nombre}.anual.sub`, { maximo: escala.maximo }),
      tabla,
      notas: huecos ? [traducible('datos-globales.anual.nota')] : [],
    }),
  ];
  return { figuras, anios, fuera, todo: noComparables(datos, id) };
}

/** La primera y la última cifra comparables de Cataluña en un indicador. @param {DatosGlobales} datos @param {string} id */
function extremosDeCataluna(datos, id) {
  const serie = serieComparable(datos, CODIGO_PROPIO, id);
  const primera = serie[0];
  const ultima = serie.at(-1);
  return primera && ultima ? { primera, ultima } : null;
}

/**
 * Las frases de 01 · Empresas: cómo ha crecido en Cataluña, frente a España y la UE, y su puesto entre los cinco.
 * @param {DatosGlobales} datos @param {{ primera: { anio: number, valor: number }, ultima: { anio: number, valor: number } }} extremos
 * @returns {Frase[]}
 */
function lecturaDeEmpresas(datos, { primera, ultima }) {
  const id = ID.empresas;
  const valores = { desde: primera.anio, hasta: ultima.anio, inicio: entero(primera.valor), fin: entero(ultima.valor) };
  const dobleEnDos =
    ultima.anio - primera.anio === 2
      ? 'datos-globales.empresas.lectura.doble-dos'
      : 'datos-globales.empresas.lectura.doble';
  /** @type {Frase[]} */
  const crecimiento =
    primera === ultima
      ? []
      : [
          [
            traducible(
              empresasMasDelDoble(datos)
                ? dobleEnDos
                : `datos-globales.lectura.desde.${comparar(ultima.valor, primera.valor)}`,
              valores,
            ),
            traducible('datos-globales.empresas.lectura.evolucion', valores),
          ],
        ];
  const espana = cifraDelAnio(datos, CODIGO_DE_ESPANA, id, ultima.anio);
  const ue = cifraDelAnio(datos, CODIGO_DE_LA_UE, id, ultima.anio);
  /** @type {Frase[]} */
  const frente =
    espana === null || ue === null
      ? []
      : [
          [
            tituloFrenteA('espana', ultima.valor, espana),
            traducible('datos-globales.empresas.lectura.territorios', {
              anio: ultima.anio,
              cataluna: entero(ultima.valor),
              espana: entero(espana),
              ue: entero(ue),
            }),
          ],
        ];
  return [...crecimiento, ...frente, ...fraseDelPuesto(datos, id)];
}

/**
 * La entradilla de 01 · Empresas: cómo ha crecido en Cataluña y, si hay cifras, frente a España y la UE.
 * @param {DatosGlobales} datos @param {Extremos} extremos @param {Valores} valores @returns {Parte[]}
 */
function entradillaDeEmpresas(datos, { primera, ultima }, valores) {
  const espana = cifraDelAnio(datos, CODIGO_DE_ESPANA, ID.empresas, ultima.anio);
  const ue = cifraDelAnio(datos, CODIGO_DE_LA_UE, ID.empresas, ultima.anio);
  return [
    traducible(
      primera === ultima ? 'datos-globales.empresas.entradilla.un-anio' : 'datos-globales.empresas.entradilla',
      valores,
    ),
    ...(espana === null || ue === null
      ? []
      : [traducible('datos-globales.empresas.entradilla.comparacion', { espana: entero(espana), ue: entero(ue) })]),
  ];
}

/**
 * La ficha técnica de 01 · Empresas: el método y, con más de un año, cuántas veces ha crecido.
 * @param {DatosGlobales} datos @param {{ anios: number[], todo: Parte[] }} evolucion @param {Extremos} extremos
 * @param {Valores} valores @returns {HTMLDetailsElement}
 */
function fichaDeEmpresas(datos, evolucion, { primera, ultima }, valores) {
  const cociente = veces(ultima.valor, primera.valor);
  return fichaTecnica([
    [
      'que-mide',
      juntas(
        traducible('datos-globales.empresas.ficha.que-mide'),
        traducible('datos-globales.empresas.ficha.desde', { desde: evolucion.anios[0] ?? '' }),
      ),
    ],
    ['unidad', traducible('datos-globales.empresas.ficha.unidad')],
    ['base', traducible('datos-globales.empresas.ficha.base')],
    ...apartadosDeMetodo(evolucion.todo),
    [
      'calculos',
      cociente === null || primera === ultima
        ? traducible('datos-globales.ficha.calculos.texto')
        : juntas(
            traducible('datos-globales.ficha.calculos.texto'),
            traducible('datos-globales.empresas.ficha.veces', {
              ...valores,
              inicio: numeroEscrito(primera.valor),
              fin: numeroEscrito(ultima.valor),
              veces: numeroEscrito(cociente),
            }),
          ),
    ],
    ['fuente', traducible('datos-globales.empresas.ficha.fuente')],
    ['tipo', marcaDeIndicador(datos, ID.empresas)],
  ]);
}

/**
 * 01 · Empresas: la evolución en líneas y año a año, desde el primer año comparable.
 * @param {DatosGlobales} datos @param {string} variante @returns {HTMLElement[]}
 */
function capituloEmpresas(datos, variante) {
  const id = ID.empresas;
  const evolucion = evolucionYTabla(datos, { id, capitulo: 'empresas', escala: ESCALAS.empresas });
  const extremos = extremosDeCataluna(datos, id);
  if (!evolucion || !extremos) {
    return [];
  }
  const { primera, ultima } = extremos;
  const valores = {
    desde: primera.anio,
    hasta: ultima.anio,
    inicio: entero(primera.valor),
    fin: entero(ultima.valor),
    cifra: entero(ultima.valor),
  };
  return [
    capitulo({
      id: 'empresas',
      numero: numeroDelCapitulo('empresas'),
      tema: traducible('datos-globales.empresas.tema'),
      pregunta: traducible('datos-globales.empresas.pregunta'),
      titular: traducible(`datos-globales.empresas.titular.${variante}`, valores),
      entradilla: entradillaDeEmpresas(datos, extremos, valores),
      figuras: evolucion.figuras,
      lectura: lecturaDeEmpresas(datos, extremos),
      ficha: fichaDeEmpresas(datos, evolucion, extremos, valores),
    }),
  ];
}

/**
 * Las frases de 02 · Personas: frente a España, frente a la UE (también para el trabajo) y por qué no la usan.
 * @param {DatosGlobales} datos @param {number} anio @returns {Frase[]}
 */
function lecturaDePersonas(datos, anio) {
  const cifra = (/** @type {string} */ codigo, /** @type {string} */ id) => cifraDelAnio(datos, codigo, id, anio);
  const [propia, espana, ue] = [CODIGO_PROPIO, CODIGO_DE_ESPANA, CODIGO_DE_LA_UE].map((codigo) =>
    cifra(codigo, ID.personas),
  );
  const [propiaTrabajo, ueTrabajo] = [CODIGO_PROPIO, CODIGO_DE_LA_UE].map((codigo) =>
    cifra(codigo, ID.personasTrabajo),
  );
  const noSabe = valorDe(datos, CODIGO_PROPIO, ID.noSabe);
  /** @type {Frase[]} */
  const frases = [];
  if (propia != null && espana != null) {
    frases.push([
      tituloFrenteA('espana', propia, espana),
      traducible('datos-globales.personas.lectura.espana', { cataluna: entero(propia), espana: entero(espana) }),
    ]);
  }
  if (propia != null && ue != null && propiaTrabajo != null && ueTrabajo != null) {
    frases.push([
      tituloFrenteA('ue', propia, ue),
      traducible('datos-globales.personas.lectura.ue', {
        ue: entero(ue),
        cataluna: entero(propiaTrabajo),
        ueTrabajo: entero(ueTrabajo),
      }),
    ]);
  }
  if (noSabe) {
    frases.push([
      traducible('datos-globales.personas.lectura.no-sabe.titulo'),
      traducible('datos-globales.personas.lectura.no-sabe', { cifra: entero(noSabe.valor) }),
    ]);
  }
  return frases;
}

/**
 * Los dos paneles de 02 · Personas, con la misma escala y el mismo orden: para cualquier uso y para su trabajo.
 * @param {DatosGlobales} datos @param {number} anio
 */
function panelesDePersonas(datos, anio) {
  const todas = [ID.personas, ID.personasTrabajo].flatMap((id) =>
    [CODIGO_PROPIO, CODIGO_DE_ESPANA, 'DEU', 'FRA', 'ITA', CODIGO_DE_LA_UE].flatMap(
      (codigo) => cifraDelAnio(datos, codigo, id, anio) ?? [],
    ),
  );
  const escala = escalaPara(ESCALAS.personas, todas);
  const cualquier = panelDeBarras(datos, { id: ID.personas, anio, escala });
  const paraTrabajar = panelDeBarras(datos, {
    id: ID.personasTrabajo,
    anio,
    escala,
    orden: cualquier.filas.map(({ codigo }) => codigo),
  });
  return { cualquier, paraTrabajar };
}

/**
 * La entradilla de 02 · Personas: cuántas la usan y para su trabajo y, si lo es en los dos, que Cataluña va primera.
 * @param {DatosGlobales} datos @param {{ anio: number, propia: number, trabajo: number | null }} cifras
 * @returns {Parte[]}
 */
function entradillaDePersonas(datos, { anio, propia, trabajo }) {
  const primeraEnLosDos = [ID.personas, ID.personasTrabajo].every((id) => posicionDeCataluna(datos, id)?.primera);
  return [
    ...(trabajo === null
      ? []
      : [
          traducible('datos-globales.personas.entradilla', {
            anio,
            cifra: entero(propia),
            trabajo: entero(trabajo),
          }),
        ]),
    ...(primeraEnLosDos ? [traducible('datos-globales.personas.entradilla.primera')] : []),
  ];
}

/**
 * La figura de 02 · Personas: los dos paneles, su alternativa en texto y sus notas.
 * @param {DatosGlobales} datos @param {ReturnType<typeof panelesDePersonas>} paneles @param {number} anio
 * @returns {HTMLElement}
 */
function figuraDePersonas(datos, { cualquier, paraTrabajar }, anio) {
  return figura({
    titulo: traducible('datos-globales.personas.figura'),
    sub: [
      traducible('datos-globales.personas.figura.sub', { anio }),
      traducible('datos-globales.paneles.misma-escala'),
    ],
    control: null,
    marca: null,
    paneles: [
      { titulo: traducible('datos-globales.personas.panel.cualquier'), nodo: cualquier.nodo },
      { titulo: traducible('datos-globales.personas.panel.trabajo'), nodo: paraTrabajar.nodo },
    ],
    alternativa: [
      traducible('datos-globales.personas.panel.cualquier'),
      ...cualquier.alternativa,
      traducible('datos-globales.personas.panel.trabajo'),
      ...paraTrabajar.alternativa,
    ],
    fuente: traducible('datos-globales.personas.fuente'),
    notas: [traducible('datos-globales.personas.nota'), ...notaSinCifra(datos, cualquier.sinCifra, anio)],
  });
}

/** La ficha técnica de 02 · Personas. @param {DatosGlobales} datos @returns {HTMLDetailsElement} */
function fichaDePersonas(datos) {
  const indicador = datos.indicadores.find(({ id }) => id === ID.noSabe);
  return fichaTecnica([
    ['que-mide', traducible('datos-globales.personas.ficha.que-mide')],
    ['unidad', traducible('datos-globales.personas.ficha.unidad')],
    ['base', traducible('datos-globales.personas.ficha.base')],
    ...(indicador
      ? /** @type {[Apartado, Parte][]} */ ([['no-sabe', traducible('datos-globales.personas.ficha.no-sabe')]])
      : []),
    ...apartadosDeMetodo(null),
    ['fuente', traducible('datos-globales.personas.ficha.fuente')],
    ['tipo', marcaDeIndicador(datos, ID.personas)],
  ]);
}

/**
 * 02 · Personas: para cualquier uso y para su trabajo, en dos paneles con la misma escala y el mismo orden.
 * @param {DatosGlobales} datos @param {string} variante @returns {HTMLElement[]}
 */
function capituloPersonas(datos, variante) {
  const anio = anioDeLaComparacion(datos, ID.personas);
  const propia = anio === null ? null : cifraDelAnio(datos, CODIGO_PROPIO, ID.personas, anio);
  const trabajo = anio === null ? null : cifraDelAnio(datos, CODIGO_PROPIO, ID.personasTrabajo, anio);
  if (anio === null || propia === null) {
    return [];
  }
  const paneles = panelesDePersonas(datos, anio);
  return [
    capitulo({
      id: 'personas',
      numero: numeroDelCapitulo('personas'),
      tema: traducible('datos-globales.personas.tema'),
      pregunta: traducible('datos-globales.personas.pregunta'),
      titular: traducible(`datos-globales.personas.titular.${variante}`, { cifra: entero(propia) }),
      entradilla: entradillaDePersonas(datos, { anio, propia, trabajo }),
      figuras: [figuraDePersonas(datos, paneles, anio)],
      lectura: lecturaDePersonas(datos, anio),
      ficha: fichaDePersonas(datos),
    }),
  ];
}

/**
 * Las frases de 05 · Formación: frente a España, frente a la UE y, con más de un año, cómo ha cambiado.
 * @param {DatosGlobales} datos @param {Extremos} extremos @returns {Frase[]}
 */
function lecturaDeFormacion(datos, { primera, ultima }) {
  const anio = ultima.anio;
  const espana = cifraDelAnio(datos, CODIGO_DE_ESPANA, ID.formacion, anio);
  const ue = cifraDelAnio(datos, CODIGO_DE_LA_UE, ID.formacion, anio);
  return [
    ...(espana === null
      ? []
      : /** @type {Frase[]} */ ([
          [
            tituloFrenteA('espana', ultima.valor, espana),
            traducible('datos-globales.formacion.lectura.espana', {
              cataluna: entero(ultima.valor),
              espana: entero(espana),
            }),
          ],
        ])),
    ...(ue === null
      ? []
      : /** @type {Frase[]} */ ([
          [
            tituloFrenteA('ue', ultima.valor, ue),
            traducible('datos-globales.formacion.lectura.ue', { ue: entero(ue) }),
          ],
        ])),
    ...(primera === ultima
      ? []
      : /** @type {Frase[]} */ ([
          [
            traducible(`datos-globales.lectura.desde.${comparar(ultima.valor, primera.valor)}`, {
              desde: primera.anio,
            }),
            traducible('datos-globales.formacion.lectura.evolucion', {
              desde: primera.anio,
              hasta: anio,
              inicio: entero(primera.valor),
              fin: entero(ultima.valor),
            }),
          ],
        ])),
  ];
}

/**
 * La entradilla de 05 · Formación: frente a España y la UE, si hay cifras, y que cuenta cualquier formación.
 * @param {DatosGlobales} datos @param {{ anio: number, valor: number }} ultima @returns {Parte[]}
 */
function entradillaDeFormacion(datos, { anio, valor }) {
  const espana = cifraDelAnio(datos, CODIGO_DE_ESPANA, ID.formacion, anio);
  const ue = cifraDelAnio(datos, CODIGO_DE_LA_UE, ID.formacion, anio);
  return [
    ...(espana === null || ue === null
      ? []
      : [
          traducible('datos-globales.formacion.entradilla', {
            anio,
            cataluna: entero(valor),
            espana: entero(espana),
            ue: entero(ue),
          }),
        ]),
    traducible('datos-globales.formacion.cualquiera'),
  ];
}

/**
 * 05 · Formación: la evolución en líneas y año a año, sin las cifras que la fuente marca como ruptura de serie.
 * @param {DatosGlobales} datos @param {string} variante @returns {HTMLElement[]}
 */
function capituloFormacion(datos, variante) {
  const id = ID.formacion;
  const evolucion = evolucionYTabla(datos, { id, capitulo: 'formacion', escala: ESCALAS.formacion });
  const extremos = extremosDeCataluna(datos, id);
  if (!evolucion || !extremos) {
    return [];
  }
  const { ultima } = extremos;
  return [
    capitulo({
      id: 'formacion',
      numero: numeroDelCapitulo('formacion'),
      tema: traducible('datos-globales.formacion.tema'),
      pregunta: traducible('datos-globales.formacion.pregunta'),
      titular: traducible(`datos-globales.formacion.titular.${variante}`, { cifra: entero(ultima.valor) }),
      entradilla: entradillaDeFormacion(datos, ultima),
      figuras: evolucion.figuras,
      lectura: lecturaDeFormacion(datos, extremos),
      ficha: fichaTecnica([
        ['que-mide', traducible('datos-globales.formacion.ficha.que-mide')],
        ['unidad', traducible('datos-globales.formacion.ficha.unidad')],
        ['base', traducible('datos-globales.formacion.ficha.base')],
        ...apartadosDeMetodo(evolucion.todo),
        ['fuente', traducible('datos-globales.formacion.ficha.fuente')],
        ['tipo', marcaDeIndicador(datos, id)],
      ]),
    }),
  ];
}

/**
 * Las frases de 07: el personal cualificado frente al poco cualificado, la dirección y lo que piden al contratar.
 * @param {DatosGlobales} datos @param {{ cualificado: number | null, directivos: number | null, poco: number | null }} cifras
 * @returns {Frase[]}
 */
function lecturaDeDentro(datos, { cualificado, directivos, poco }) {
  const competencias = valorDe(datos, CODIGO_PROPIO, ID.competencias);
  /** @type {Frase[]} */
  const frases = [];
  if (cualificado !== null && poco !== null) {
    frases.push([
      traducible(`datos-globales.dentro.lectura.puestos.${comparar(cualificado, poco)}`),
      traducible('datos-globales.dentro.lectura.puestos', { cualificado: entero(cualificado), poco: entero(poco) }),
    ]);
  }
  if (directivos !== null) {
    frases.push([
      traducible('datos-globales.dentro.lectura.direccion.titulo'),
      traducible('datos-globales.dentro.lectura.direccion', { cifra: entero(directivos) }),
    ]);
  }
  if (competencias) {
    frases.push([
      traducible('datos-globales.dentro.contratar'),
      traducible('datos-globales.dentro.lectura.contratar', {
        cifra: entero(competencias.valor),
        anio: competencias.anio,
      }),
    ]);
  }
  return frases;
}

/**
 * Las barras de 07, de mayor a menor: una por grupo con cifra en el año dado.
 * @param {DatosGlobales} datos @param {number | null} anio
 */
function filasDeDentro(datos, anio) {
  const grupos = /** @type {const} */ ([
    [ID.cualificado, 'datos-globales.dentro.cualificado'],
    [ID.directivos, 'datos-globales.dentro.directivos'],
    [ID.pocoCualificado, 'datos-globales.dentro.poco-cualificado'],
  ]);
  return grupos
    .flatMap(([id, clave]) => {
      const valor = anio === null ? null : cifraDelAnio(datos, CODIGO_PROPIO, id, anio);
      return valor === null
        ? []
        : [{ papel: /** @type {const} */ ('cat'), nombre: traducible(clave), detalle: null, valor }];
    })
    .sort((a, b) => b.valor - a.valor);
}

/**
 * La ficha técnica de 07: el método, los años de las dos preguntas y por qué no se compara con Europa.
 * @param {DatosGlobales} datos @param {number} anio @returns {HTMLDetailsElement}
 */
function fichaDeDentro(datos, anio) {
  return fichaTecnica([
    ['que-mide', traducible('datos-globales.dentro.ficha.que-mide')],
    ['unidad', traducible('datos-globales.dentro.ficha.unidad')],
    [
      'anio',
      traducible('datos-globales.dentro.ficha.anio', {
        anio,
        competencias: valorDe(datos, CODIGO_PROPIO, ID.competencias)?.anio ?? anio,
      }),
    ],
    ['comparacion', traducible('datos-globales.dentro.nota')],
    ['margen', traducible('datos-globales.margen.encuesta')],
    ['fuente', traducible('datos-globales.dentro.ficha.fuente')],
    ['tipo', marcaDeIndicador(datos, ID.cualificado)],
  ]);
}

/**
 * 07 · Dentro de las empresas catalanas: en cuántos establecimientos usa la IA cada grupo. Solo hay dato de Cataluña,
 * de otra encuesta: no se compara con Europa. @param {DatosGlobales} datos @param {string} variante @returns {HTMLElement[]}
 */
function capituloDentro(datos, variante) {
  const anio = valorDe(datos, CODIGO_PROPIO, ID.cualificado)?.anio ?? null;
  const filas = filasDeDentro(datos, anio);
  if (anio === null || !filas.length) {
    return [];
  }
  const cifra = (/** @type {string} */ id) => cifraDelAnio(datos, CODIGO_PROPIO, id, anio);
  const escala = escalaPara(
    ESCALAS.establecimientos,
    filas.map(({ valor }) => valor),
  );
  const dibujo = grafico(barras({ filas, escala, referencia: null, opinion: false, decimales: 1 }));
  return [
    capitulo({
      id: 'dentro',
      numero: numeroDelCapitulo('dentro'),
      tema: traducible('datos-globales.dentro.tema'),
      pregunta: traducible('datos-globales.dentro.pregunta'),
      titular: traducible(`datos-globales.dentro.titular.${variante}`, { cifra: entero(cifra(ID.cualificado) ?? 0) }),
      entradilla: [traducible('datos-globales.dentro.entradilla', { anio })],
      figuras: [
        figura({
          titulo: traducible('datos-globales.dentro.figura'),
          sub: [traducible('datos-globales.dentro.figura.sub', { anio })],
          control: null,
          marca: null,
          paneles: [{ titulo: null, nodo: dibujo.nodo }],
          alternativa: filas.map(({ nombre, valor }) =>
            traducible('datos-globales.alternativa.cifra', { territorio: nombre, cifra: numeroEscrito(valor) }),
          ),
          fuente: traducible('datos-globales.dentro.fuente'),
          notas: [],
        }),
      ],
      lectura: lecturaDeDentro(datos, {
        cualificado: cifra(ID.cualificado),
        directivos: cifra(ID.directivos),
        poco: cifra(ID.pocoCualificado),
      }),
      ficha: fichaDeDentro(datos, anio),
    }),
  ];
}

/**
 * Los capítulos 01 a 07, en su orden (06 · Opinión, solo si el archivo trae sus dos preguntas; uno sin cifras no se
 * pinta), con el titular que sostienen las cifras.
 * @param {DatosGlobales} datos @returns {HTMLElement[]}
 */
export function capitulosDelDossier(datos) {
  const variantes = variantesDelTitular(datos);
  return [
    ...capituloEmpresas(datos, variantes.empresas),
    ...capituloPersonas(datos, variantes.personas),
    ...capituloGenero(datos, variantes.genero),
    ...capituloOcupacion(datos, variantes.ocupacion),
    ...capituloFormacion(datos, variantes.formacion),
    ...capituloOpinion(datos),
    ...capituloDentro(datos, variantes.dentro),
  ];
}
