// Los capítulos 01 a 05 de «Datos globales · Unión Europea» (datos-globales-ue.html): empresas, tecnologías, personas,
// mujeres y hombres, y trabajo; los 06 a 09, en union-europea-metas.js, y el 10, en union-europea-opinion.js. Todo de
// la UE-27 en conjunto, nunca al lado de los países; las personas, sobre toda la población de 16 a 74 años (PC_IND).
// Un capítulo sin cifras no se pinta; una frase de la lectura sin sus cifras, tampoco.

import { traducible } from '../textos.js';
import { DOBLE, ESCALAS } from './capitulos.js';
import { distanciaEscrita, numeroEscrito, veces } from './cifras.js';
import { grafico, pesas } from './dibujo.js';
import { figura, marcaDeIndicador } from './seccion.js';
import { apartadosConCifras, INDICADORES_UE as I } from './union-europea-indicadores.js';
import { capacidades, especialistas, formacion, metas } from './union-europea-metas.js';
import { opinion } from './union-europea-opinion.js';
import {
  anioUe,
  apartadoNoComparables,
  capituloUe,
  comparar,
  dos,
  entero,
  entre,
  escalaComun,
  fichaUe,
  filasUe,
  lineaUe,
  noComparablesUe,
  panelUe,
  ue,
} from './union-europea-piezas.js';

/**
 * @import { Parte, Valores } from '../textos.js'
 * @import { DatosGlobales } from './datos.js'
 * @import { Frase } from './seccion.js'
 * @import { Fila } from './union-europea-piezas.js'
 */

/** «1 de cada 5» y «casi 1 de cada 3»: los tramos que sostienen cada titular. */
const UNA_DE_CADA_CINCO = Object.freeze({ desde: 17.5, hasta: 22.5 });
const CASI_UNA_DE_CADA_TRES = Object.freeze({ desde: 28, hasta: 33.3 });
/** Los tramos de edad, de menor a mayor: forman parte de los ids de los indicadores. */
const EDADES = Object.freeze(['16-24', '25-34', '35-44', '45-54', '55-64', '65-74']);
/** Las técnicas de IA de las empresas, como las nombran los ids (`empresas-ia-<técnica>`). */
const TECNICAS = Object.freeze([
  'texto',
  'imagen-video-sonido',
  'lenguaje',
  'voz',
  'automatizacion',
  'aprendizaje-automatico',
  'reconocimiento-imagenes',
  'robots',
]);
/** Los usos de la IA en la empresa (`empresas-ia-uso-<uso>`). */
const USOS = Object.freeze([
  'marketing-ventas',
  'administracion',
  'finanzas',
  'produccion',
  'seguridad-informatica',
  'id-innovacion',
  'logistica',
]);

/** Una frase de la lectura si están sus cifras. @param {boolean} hay @param {() => Frase} frase @returns {Frase[]} */
function si(hay, frase) {
  return hay ? [frase()] : [];
}

/**
 * Una figura de uno o dos paneles de barras de la UE, con la misma escala.
 * @param {DatosGlobales} datos
 * @param {{ titulo: string, sub: string, paneles: { titulo: string | null, filas: readonly Fila[], ordenar: boolean }[],
 *   escala: { maximo: number, paso: number }, fuente: string, notas: Parte[] }} opciones
 * @returns {{ figura: HTMLElement[], anio: number | null }}
 */
function figuraDeBarras(datos, { titulo, sub, paneles, escala: base, fuente, notas }) {
  const filas = paneles.map((panel) => ({ ...panel, ...filasUe(datos, panel.filas, panel.ordenar) }));
  const conFilas = filas.filter((panel) => panel.filas.length);
  const anio = conFilas[0]?.anio ?? null;
  if (!conFilas.length) {
    return { figura: [], anio };
  }
  const escala = escalaComun(
    base,
    conFilas.map((panel) => panel.filas),
  );
  const dibujos = conFilas.map((panel) => ({ titulo: panel.titulo, ...panelUe(panel.filas, escala) }));
  return {
    anio,
    figura: [
      figura({
        titulo: traducible(titulo),
        sub: [
          traducible(sub, { anio: anio ?? '' }),
          ...(dibujos.length > 1 ? [traducible('datos-globales.paneles.misma-escala')] : []),
        ],
        control: null,
        marca: null,
        paneles: dibujos.map(({ titulo: t, nodo }) => ({ titulo: t === null ? null : traducible(t), nodo })),
        alternativa: dibujos.flatMap(({ titulo: t, alternativa }) => [
          ...(t === null ? [] : [traducible(t)]),
          ...alternativa,
        ]),
        fuente: traducible(fuente),
        notas,
      }),
    ],
  };
}

/**
 * La figura de una línea de evolución de la UE.
 * @param {DatosGlobales} datos @param {{ id: string, clave: string, escala: { maximo: number, paso: number } }} linea
 */
export function figuraDeLinea(datos, { id, clave, escala }) {
  const evolucion = lineaUe(datos, id, escala);
  if (!evolucion) {
    return null;
  }
  return {
    ...evolucion,
    figura: figura({
      titulo: traducible(`datos-globales.ue.${clave}.figura.evolucion`),
      sub: [
        traducible(`datos-globales.ue.${clave}.figura.evolucion.sub`, {
          desde: evolucion.desde,
          hasta: evolucion.hasta,
        }),
      ],
      control: null,
      marca: null,
      paneles: [{ titulo: null, nodo: evolucion.nodo }],
      alternativa: evolucion.alternativa,
      fuente: traducible(`datos-globales.ue.${clave}.fuente`),
      notas: [],
    }),
  };
}

/** La figura de 01 por tamaño de empresa, en su orden (de todas a las de 250 o más). @param {DatosGlobales} datos */
function figuraDeTamanos(datos) {
  return figuraDeBarras(datos, {
    titulo: 'datos-globales.ue.empresas.figura.tamano',
    sub: 'datos-globales.ue.empresas.figura.tamano.sub',
    paneles: [
      {
        titulo: null,
        ordenar: false,
        filas: [
          [I.empresasIa, 'datos-globales.ue.empresas.todas', true],
          [I.empresasIa10A49, 'datos-globales.ue.empresas.10-49'],
          [I.empresasIa50A249, 'datos-globales.ue.empresas.50-249'],
          [I.empresasIa250OMas, 'datos-globales.ue.empresas.250'],
        ],
      },
    ],
    escala: ESCALAS.empresas,
    fuente: 'datos-globales.ue.empresas.fuente',
    notas: [],
  });
}

/**
 * Las frases de 01: cómo ha crecido, las grandes frente a las pequeñas y las medianas.
 * @param {DatosGlobales} datos
 * @param {{ primera: { valor: number }, ultima: { valor: number }, doble: boolean, valores: Valores }} evolucion
 * @returns {Frase[]}
 */
function lecturaDeEmpresas(datos, { primera, ultima, doble, valores }) {
  const tamanos = dos(datos, I.empresasIa250OMas, I.empresasIa10A49);
  const medianas = ue(datos, I.empresasIa50A249);
  return [
    [
      traducible(
        doble
          ? 'datos-globales.empresas.lectura.doble'
          : `datos-globales.lectura.desde.${comparar(ultima.valor, primera.valor)}`,
        valores,
      ),
      traducible('datos-globales.ue.empresas.lectura.evolucion', valores),
    ],
    ...si(tamanos !== null, () => [
      traducible(
        (veces(tamanos?.a ?? 0, tamanos?.b ?? 1) ?? 0) >= DOBLE
          ? 'datos-globales.ue.empresas.lectura.tamano.mucho'
          : 'datos-globales.ue.empresas.lectura.tamano.mas',
      ),
      traducible('datos-globales.ue.empresas.lectura.tamano', {
        grandes: entero(tamanos?.a ?? 0),
        pequenas: entero(tamanos?.b ?? 0),
      }),
    ]),
    ...si(medianas !== null, () => [
      traducible('datos-globales.ue.empresas.lectura.medianas.titulo'),
      traducible('datos-globales.ue.empresas.lectura.medianas', { cifra: entero(medianas ?? 0) }),
    ]),
  ];
}

/** 01 · Empresas. @param {DatosGlobales} datos @returns {HTMLElement[]} */
function empresas(datos) {
  const linea = figuraDeLinea(datos, { id: I.empresasIa, clave: 'empresas', escala: ESCALAS.empresas });
  const tamano = figuraDeTamanos(datos);
  const cifra = ue(datos, I.empresasIa);
  if (!linea || cifra === null) {
    return [];
  }
  const { primera, ultima } = linea;
  const doble = (veces(ultima.valor, primera.valor) ?? 0) > DOBLE;
  const base = entre(cifra, UNA_DE_CADA_CINCO) ? 'quinto' : 'cifra';
  const valores = {
    cifra: entero(cifra),
    desde: primera.anio,
    hasta: ultima.anio,
    inicio: entero(primera.valor),
    fin: entero(ultima.valor),
  };
  return capituloUe({
    id: 'empresas',
    orden: 1,
    titular: traducible(`datos-globales.ue.empresas.titular.${base}${doble ? '-doble' : ''}`, valores),
    entradilla: [traducible('datos-globales.ue.empresas.entradilla', valores)],
    figuras: [linea.figura, ...tamano.figura],
    lectura: lecturaDeEmpresas(datos, { primera, ultima, doble, valores }),
    ficha: fichaUe(
      'empresas',
      ['que-mide', 'ambito', 'anios', ...apartadoNoComparables(noComparablesUe(datos, I.empresasIa)), 'fuente'],
      { valores: { desde: primera.anio, hasta: ultima.anio }, tipo: marcaDeIndicador(datos, I.empresasIa) },
    ),
  });
}

/** La figura de 02: las técnicas y los usos de la IA en la empresa, de mayor a menor. @param {DatosGlobales} datos */
function figuraDeTecnologias(datos) {
  return figuraDeBarras(datos, {
    titulo: 'datos-globales.ue.tecnologias.figura',
    sub: 'datos-globales.ue.tecnologias.figura.sub',
    paneles: [
      {
        titulo: 'datos-globales.ue.tecnologias.panel.tipos',
        ordenar: true,
        filas: [
          [I.empresasIa, 'datos-globales.ue.tecnologias.alguna', true],
          ...TECNICAS.map((t) => /** @type {Fila} */ ([`empresas-ia-${t}`, `datos-globales.ue.tecnologias.${t}`])),
        ],
      },
      {
        titulo: 'datos-globales.ue.tecnologias.panel.usos',
        ordenar: true,
        filas: USOS.map(
          (u) => /** @type {Fila} */ ([`empresas-ia-uso-${u}`, `datos-globales.ue.tecnologias.uso.${u}`]),
        ),
      },
    ],
    escala: ESCALAS.empresas,
    fuente: 'datos-globales.ue.empresas.fuente',
    notas: [traducible('datos-globales.ue.tecnologias.nota')],
  });
}

/**
 * Las frases de 02: la técnica más usada (si lo es con claridad), los sectores y lo que frena a las empresas.
 * @param {DatosGlobales} datos
 * @param {{ clara: boolean, primera: { t: string, cifra: number | null } | undefined }} tecnica
 * @returns {Frase[]}
 */
function lecturaDeTecnologias(datos, { clara, primera }) {
  const sectores = dos(datos, I.empresasIaSeccionJ, I.empresasIaSeccionF);
  const conocimientos = ue(datos, I.empresasIaMotivoConocimientos);
  return [
    ...si(clara, () => [
      traducible('datos-globales.ue.tecnologias.lectura.primera.titulo', {
        tecnologia: traducible(`datos-globales.ue.tecnologias.${primera?.t}`),
      }),
      traducible('datos-globales.ue.tecnologias.lectura.primera', { cifra: entero(primera?.cifra ?? 0) }),
    ]),
    ...si(sectores !== null, () => [
      traducible('datos-globales.ue.tecnologias.sectores'),
      traducible('datos-globales.ue.tecnologias.lectura.sectores', {
        j: entero(sectores?.a ?? 0),
        f: entero(sectores?.b ?? 0),
      }),
    ]),
    ...si(conocimientos !== null, () => [
      traducible('datos-globales.ue.tecnologias.frena'),
      traducible('datos-globales.ue.tecnologias.lectura.frena', { cifra: entero(conocimientos ?? 0) }),
    ]),
  ];
}

/** 02 · Tecnologías. @param {DatosGlobales} datos @returns {HTMLElement[]} */
function tecnologias(datos) {
  const { figura: figuras } = figuraDeTecnologias(datos);
  const cifras = TECNICAS.map((t) => ({ t, cifra: ue(datos, `empresas-ia-${t}`) }));
  const completas = cifras.every(({ cifra }) => cifra !== null);
  const [primera, segunda] = [...cifras].sort((a, b) => (b.cifra ?? 0) - (a.cifra ?? 0));
  const clara = completas && primera && segunda && comparar(primera.cifra ?? 0, segunda.cifra ?? 0) === 'mas';
  return capituloUe({
    id: 'tecnologias',
    orden: 2,
    titular:
      clara && primera
        ? traducible('datos-globales.ue.tecnologias.titular.primera', {
            tecnologia: traducible(`datos-globales.ue.tecnologias.${primera.t}.frase`),
            cifra: entero(primera.cifra ?? 0),
          })
        : traducible('datos-globales.ue.tecnologias.titular.neutro'),
    entradilla: [traducible('datos-globales.ue.tecnologias.entradilla')],
    figuras,
    lectura: lecturaDeTecnologias(datos, { clara: !!(clara && primera), primera }),
    ficha: fichaDeTecnologias(datos),
  });
}

/** La ficha de 02: los apartados de sectores y de motivos, solo con todas sus cifras. @param {DatosGlobales} datos */
function fichaDeTecnologias(datos) {
  const { conCifras, valores } = apartadosConCifras(
    datos,
    {
      sectores: Object.fromEntries([
        ['j', I.empresasIaSeccionJ],
        ['f', I.empresasIaSeccionF],
      ]),
      motivos: {
        penso: I.empresasIaMotivoLaPenso,
        conocimientos: I.empresasIaMotivoConocimientos,
        legales: I.empresasIaMotivoDudasLegales,
        datos: I.empresasIaMotivoProteccionDatos,
      },
    },
    (cifra) => numeroEscrito(cifra),
  );
  const apartados = /** @type {const} */ (['que-mide', 'tecnologias', 'usos', 'sectores', 'motivos', 'fuente']);
  return fichaUe(
    'tecnologias',
    apartados.filter((apartado) => !['sectores', 'motivos'].includes(apartado) || conCifras.has(apartado)),
    { valores, tipo: marcaDeIndicador(datos, I.empresasIa) },
  );
}

/** Las escalas de personas de la página: la misma en todos sus gráficos de personas. @param {DatosGlobales} datos */
function escalaDePersonas(datos) {
  const ids = [I.personasIaGenerativa, ...EDADES.map((edad) => `ia-generativa-${edad}`), I.iaGenerativaTrabajoTic];
  return escalaComun(ESCALAS.personas, [
    ids.flatMap((id) => {
      const valor = ue(datos, id);
      return valor === null ? [] : [{ papel: 'ue', nombre: '', detalle: null, valor }];
    }),
  ]);
}

/** La figura de 03: para qué la usan y por edad, con la escala de personas. @param {DatosGlobales} datos */
function figuraDePersonas(datos) {
  return figuraDeBarras(datos, {
    titulo: 'datos-globales.ue.personas.figura',
    sub: 'datos-globales.ue.personas.figura.sub',
    paneles: [
      {
        titulo: 'datos-globales.ue.personas.panel.para-que',
        ordenar: true,
        filas: [
          [I.personasIaGenerativa, 'datos-globales.ue.personas.cualquier', true],
          [I.iaGenerativaUsoPrivado, 'datos-globales.ue.personas.privada'],
          [I.personasIaGenerativaTrabajo, 'datos-globales.ue.personas.trabajo'],
          [I.iaGenerativaEducacionFormal, 'datos-globales.ue.personas.estudios'],
        ],
      },
      {
        titulo: 'datos-globales.ue.personas.panel.edad',
        ordenar: false,
        filas: EDADES.map((edad) => /** @type {Fila} */ ([`ia-generativa-${edad}`, `datos-globales.ue.edad.${edad}`])),
      },
    ],
    escala: escalaDePersonas(datos),
    fuente: 'datos-globales.ue.personas.fuente',
    notas: [traducible('datos-globales.personas.nota')],
  });
}

/** Las frases de 03: jóvenes frente a mayores, por qué no la usan y sobre quién se cuenta. @param {DatosGlobales} datos @returns {Frase[]} */
function lecturaDePersonas(datos) {
  const extremos = dos(datos, I.iaGenerativa16A24, I.iaGenerativa65A74);
  const motivos = dos(datos, I.iaGenerativaNoLaUsaNoLaNecesita, I.iaGenerativaNoLaUsaNoSabeUsarla);
  const internet = ue(datos, I.personasIaGenerativaUsuariosInternet);
  return [
    ...si(extremos !== null, () => [
      traducible(
        (veces(extremos?.a ?? 0, extremos?.b ?? 1) ?? 0) >= DOBLE
          ? 'datos-globales.ue.personas.lectura.edades.mucho'
          : 'datos-globales.ue.personas.lectura.edades.titulo',
      ),
      traducible('datos-globales.ue.personas.lectura.edades', {
        jovenes: entero(extremos?.a ?? 0),
        mayores: entero(extremos?.b ?? 0),
      }),
    ]),
    ...si(motivos !== null, () => [
      traducible('datos-globales.ue.personas.por-que'),
      traducible('datos-globales.ue.personas.lectura.por-que', {
        necesita: entero(motivos?.a ?? 0),
        sabe: entero(motivos?.b ?? 0),
      }),
    ]),
    ...si(internet !== null, () => [
      traducible('datos-globales.ue.personas.lectura.base.titulo'),
      traducible('datos-globales.ue.personas.lectura.base', { internet: entero(internet ?? 0) }),
    ]),
  ];
}

/** 03 · Personas. @param {DatosGlobales} datos @returns {HTMLElement[]} */
function personas(datos) {
  const { figura: figuras, anio } = figuraDePersonas(datos);
  const cifra = ue(datos, I.personasIaGenerativa);
  return capituloUe({
    id: 'personas',
    orden: 3,
    titular: traducible(
      `datos-globales.ue.personas.titular.${entre(cifra, CASI_UNA_DE_CADA_TRES) ? 'tercio' : 'cifra'}`,
      { cifra: entero(cifra ?? 0) },
    ),
    entradilla: [traducible('datos-globales.ue.personas.entradilla', { anio: anio ?? '', cifra: entero(cifra ?? 0) })],
    figuras,
    lectura: lecturaDePersonas(datos),
    ficha: fichaDePersonas(datos),
  });
}

/** La ficha de 03: la base, los motivos y el año, cada apartado solo con todas sus cifras. @param {DatosGlobales} datos */
function fichaDePersonas(datos) {
  const { conCifras, valores } = apartadosConCifras(
    datos,
    {
      base: { internet: I.personasIaGenerativaUsuariosInternet },
      motivos: {
        necesita: I.iaGenerativaNoLaUsaNoLaNecesita,
        sabe: I.iaGenerativaNoLaUsaNoSabeUsarla,
        existia: I.iaGenerativaNoLaUsaNoSabiaQueExistia,
        privacidad: I.iaGenerativaNoLaUsaPrivacidadSeguridad,
      },
    },
    (cifra) => `${numeroEscrito(cifra)} %`,
  );
  const anio = anioUe(datos, I.personasIaGenerativa);
  const apartados = /** @type {const} */ (['que-mide', 'base', 'motivos', 'anio', 'fuente']);
  return fichaUe(
    'personas',
    apartados.filter((apartado) =>
      apartado === 'anio' ? anio !== null : !['base', 'motivos'].includes(apartado) || conCifras.has(apartado),
    ),
    { valores: { ...valores, anio: anio ?? '' }, tipo: marcaDeIndicador(datos, I.personasIaGenerativa) },
  );
}

/** Los usos de 04: [mujeres, hombres, nombre]. */
const USOS_POR_SEXO = Object.freeze(
  /** @type {const} */ ([
    [I.mujeresIaGenerativa, I.hombresIaGenerativa, 'datos-globales.ue.personas.cualquier'],
    [I.iaGenerativaUsoPrivadoMujeres, I.iaGenerativaUsoPrivadoHombres, 'datos-globales.ue.personas.privada'],
    [I.mujeresIaGenerativaTrabajo, I.hombresIaGenerativaTrabajo, 'datos-globales.ue.personas.trabajo'],
    [I.iaGenerativaEducacionFormalMujeres, I.iaGenerativaEducacionFormalHombres, 'datos-globales.ue.personas.estudios'],
  ]),
);

/** Las cifras de un par de mujeres y hombres para las frases. @param {{ a: number, b: number }} par */
function cifrasPorSexo({ a, b }) {
  return { mujeres: entero(a), hombres: entero(b), puntos: distanciaEscrita(b, a) };
}

/**
 * Las pesas de 04: una fila por uso, con la escala de personas.
 * @param {DatosGlobales} datos @param {{ a: number, b: number, clave: string }[]} pares
 */
function pesasDeGenero(datos, pares) {
  const filas = pares.map(({ a, b, clave }) => ({
    papel: /** @type {const} */ ('ue'),
    nombre: traducible(clave),
    detalle: null,
    a,
    b,
    diferencia: {
      larga: traducible('datos-globales.puntos', { puntos: distanciaEscrita(b, a) }),
      corta: distanciaEscrita(b, a),
    },
  }));
  const escala = escalaDePersonas(datos);
  return grafico(
    pesas({
      filas,
      nombres: [traducible('datos-globales.genero.mujeres'), traducible('datos-globales.genero.hombres')],
      cabecera: [traducible('datos-globales.genero.cabecera'), traducible('datos-globales.cabecera.corta')],
      escala,
    }),
  );
}

/**
 * La figura de 04: las pesas con su alternativa en texto.
 * @param {{ a: number, b: number, clave: string }[]} pares @param {HTMLElement} nodo @param {number | null} anio
 * @returns {HTMLElement}
 */
function figuraDeGenero(pares, nodo, anio) {
  return figura({
    titulo: traducible('datos-globales.ue.genero.figura'),
    sub: [traducible('datos-globales.ue.genero.figura.sub', { anio: anio ?? '' })],
    control: null,
    marca: null,
    paneles: [{ titulo: null, nodo }],
    alternativa: pares.map(({ a, b, clave }) =>
      traducible('datos-globales.genero.alternativa', {
        territorio: traducible(clave),
        a: numeroEscrito(a),
        b: numeroEscrito(b),
        puntos: distanciaEscrita(b, a),
      }),
    ),
    fuente: traducible('datos-globales.ue.personas.fuente'),
    notas: [traducible('datos-globales.ue.genero.nota')],
  });
}

/**
 * Las frases de 04: para cualquier uso, en los estudios y en las capacidades digitales básicas.
 * @param {DatosGlobales} datos @param {{ a: number, b: number }} total @returns {Frase[]}
 */
function lecturaDeGenero(datos, total) {
  const estudios = dos(datos, I.iaGenerativaEducacionFormalMujeres, I.iaGenerativaEducacionFormalHombres);
  const capacidadesPorSexo = dos(datos, I.capacidadesDigitalesBasicasMujeres, I.capacidadesDigitalesBasicasHombres);
  return [
    [
      traducible('datos-globales.ue.genero.lectura.cualquier.titulo', cifrasPorSexo(total)),
      traducible('datos-globales.ue.genero.lectura.cualquier', cifrasPorSexo(total)),
    ],
    ...si(estudios !== null, () => [
      traducible(`datos-globales.ue.genero.lectura.estudios.${comparar(estudios?.b ?? 0, estudios?.a ?? 0)}`),
      traducible('datos-globales.ue.genero.lectura.estudios', cifrasPorSexo(estudios ?? { a: 0, b: 0 })),
    ]),
    ...si(capacidadesPorSexo !== null, () => [
      traducible('datos-globales.ue.genero.capacidades'),
      traducible('datos-globales.ue.genero.lectura.capacidades', cifrasPorSexo(capacidadesPorSexo ?? { a: 0, b: 0 })),
    ]),
  ];
}

/** 04 · Mujeres y hombres. @param {DatosGlobales} datos @returns {HTMLElement[]} */
function genero(datos) {
  const pares = USOS_POR_SEXO.flatMap(([m, h, clave]) => {
    const par = dos(datos, m, h);
    return par ? [{ ...par, clave }] : [];
  });
  const total = pares[0];
  if (!total) {
    return [];
  }
  const anio = anioUe(datos, I.mujeresIaGenerativa);
  const dibujo = pesasDeGenero(datos, pares);
  const comparacion = comparar(total.b, total.a);
  const todos = pares.every(({ a, b }) => comparar(b, a) === 'mas');
  return capituloUe({
    id: 'genero',
    orden: 4,
    titular: traducible(
      `datos-globales.ue.genero.titular.${{ mas: 'hombres', menos: 'mujeres', parecido: 'parecido' }[comparacion]}`,
      cifrasPorSexo(total),
    ),
    entradilla: [
      traducible(todos ? 'datos-globales.ue.genero.entradilla.todos' : 'datos-globales.ue.genero.entradilla.mixta'),
    ],
    figuras: [figuraDeGenero(pares, dibujo.nodo, anio)],
    lectura: lecturaDeGenero(datos, total),
    ficha: fichaUe('genero', ['que-mide', 'base', 'calculo', 'anio', 'fuente'], {
      valores: { anio: anio ?? '' },
      tipo: marcaDeIndicador(datos, I.mujeresIaGenerativa),
    }),
  });
}

/** La figura de 05: por ocupación y por nivel de estudios, con la escala de personas. @param {DatosGlobales} datos */
function figuraDeTrabajo(datos) {
  return figuraDeBarras(datos, {
    titulo: 'datos-globales.ue.trabajo.figura',
    sub: 'datos-globales.ue.trabajo.figura.sub',
    paneles: [
      {
        titulo: 'datos-globales.ue.trabajo.panel.ocupacion',
        ordenar: true,
        filas: [
          [I.iaGenerativaTrabajoOcupados, 'datos-globales.ue.trabajo.todas', true],
          [I.iaGenerativaTrabajoTic, 'datos-globales.ue.trabajo.tic'],
          [I.iaGenerativaTrabajoNoManual, 'datos-globales.ue.trabajo.no-manual'],
          [I.iaGenerativaTrabajoManual, 'datos-globales.ue.trabajo.manual'],
        ],
      },
      {
        titulo: 'datos-globales.ue.trabajo.panel.estudios',
        ordenar: false,
        filas: [
          [I.personasIaGenerativaTrabajo, 'datos-globales.ue.trabajo.todas', true],
          [I.iaGenerativaTrabajoEstudios5A8, 'datos-globales.ue.trabajo.superiores'],
          [I.iaGenerativaTrabajoEstudios3A4, 'datos-globales.ue.trabajo.medios'],
          [I.iaGenerativaTrabajoEstudios0A2, 'datos-globales.ue.trabajo.bajos'],
        ],
      },
    ],
    escala: escalaDePersonas(datos),
    fuente: 'datos-globales.ue.personas.fuente',
    notas: [traducible('datos-globales.ocupacion.grupos.breve')],
  });
}

/**
 * Las frases de 05: los trabajos no manuales frente a los manuales, los profesionales TIC y los estudios.
 * @param {DatosGlobales} datos @returns {Frase[]}
 */
function lecturaDeTrabajo(datos) {
  const ocupacion = dos(datos, I.iaGenerativaTrabajoNoManual, I.iaGenerativaTrabajoManual);
  const tic = ue(datos, I.iaGenerativaTrabajoTic);
  const estudios = dos(datos, I.iaGenerativaTrabajoEstudios5A8, I.iaGenerativaTrabajoEstudios0A2);
  const grado =
    ocupacion && (veces(ocupacion.a, ocupacion.b) ?? 0) >= DOBLE
      ? 'mucho-mas'
      : comparar(ocupacion?.a ?? 0, ocupacion?.b ?? 0);
  return [
    ...si(ocupacion !== null, () => [
      traducible(`datos-globales.ocupacion.lectura.cataluna.${grado}`),
      traducible('datos-globales.ue.trabajo.lectura.ocupacion', {
        noManual: entero(ocupacion?.a ?? 0),
        manual: entero(ocupacion?.b ?? 0),
      }),
    ]),
    ...si(tic !== null, () => [
      traducible('datos-globales.ue.trabajo.tic.titulo'),
      traducible('datos-globales.ue.trabajo.lectura.tic', { cifra: entero(tic ?? 0) }),
    ]),
    ...si(estudios !== null, () => [
      traducible('datos-globales.ue.trabajo.lectura.estudios.titulo'),
      traducible('datos-globales.ue.trabajo.lectura.estudios', {
        superiores: entero(estudios?.a ?? 0),
        bajos: entero(estudios?.b ?? 0),
      }),
    ]),
  ];
}

/** 05 · Trabajo. @param {DatosGlobales} datos @returns {HTMLElement[]} */
function trabajo(datos) {
  const { figura: figuras, anio } = figuraDeTrabajo(datos);
  const ocupados = ue(datos, I.iaGenerativaTrabajoOcupados);
  return capituloUe({
    id: 'trabajo',
    orden: 5,
    titular:
      ocupados === null
        ? traducible('datos-globales.ue.trabajo.titular.neutro')
        : traducible('datos-globales.ue.trabajo.titular.cifra', { cifra: entero(ocupados) }),
    entradilla: [traducible('datos-globales.ue.trabajo.entradilla', { anio: anio ?? '' })],
    figuras,
    lectura: lecturaDeTrabajo(datos),
    ficha: fichaUe('trabajo', ['que-mide', 'grupos', 'base', 'anio', 'fuente'], {
      valores: { anio: anio ?? '' },
      tipo: marcaDeIndicador(datos, I.iaGenerativaTrabajoOcupados),
    }),
  });
}

export { escalaDePersonas, figuraDeBarras };

/**
 * Los capítulos 01 a 10, en su orden; los que no tienen cifras, fuera.
 * @param {DatosGlobales} datos @returns {HTMLElement[]}
 */
export function capitulosDeLaUe(datos) {
  return [
    empresas,
    tecnologias,
    personas,
    genero,
    trabajo,
    capacidades,
    metas,
    especialistas,
    formacion,
    opinion,
  ].flatMap((capitulo) => capitulo(datos));
}
