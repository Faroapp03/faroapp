// Los capítulos 06 a 09 de «Datos globales · Unión Europea» (datos-globales-ue.html): capacidades digitales, metas
// para 2030, especialistas en TIC y formación. Las metas, con el valor del bloque `metas` (Decisión (UE) 2022/2481,
// art. 4) y el último dato de su indicador o recuento, cada una en una barra con su escala real (0–100 % o 0–25
// millones) y la meta como raya vertical; nunca se dibuja una proyección. Un capítulo sin cifras no se pinta.

import { crear } from '../dom.js';
import { traducible } from '../textos.js';
import { ESCALAS, escalaPara } from './capitulos.js';
import { numeroEscrito, resta } from './cifras.js';
import { conPuntoYComa } from './comparacion.js';
import { cifraDelBloque, MILES_DE_PERSONAS, serieDe, valorDe } from './datos.js';
import { grafico, haciaMeta } from './dibujo.js';
import { conTexto } from './ficha.js';
import { figura, marcaDeIndicador } from './seccion.js';
import { figuraDeBarras, figuraDeLinea } from './union-europea-capitulos.js';
import {
  apartadoNoComparables,
  CODIGO_DE_LA_UE,
  capituloUe,
  comparar,
  entero,
  entre,
  fichaUe,
  MITAD_PCT,
  millones,
  noComparablesUe,
  pct,
  ue,
} from './union-europea-piezas.js';

/**
 * @import { DatosGlobales, Meta } from './datos.js'
 * @import { Parte, Valores } from '../textos.js'
 * @import { Frase } from './seccion.js'
 * @import { Fila } from './union-europea-piezas.js'
 */

/** «Seis de cada diez» (57,5 a 62,5) sostiene el titular de 06. */
const SEIS_DE_CADA_DIEZ = Object.freeze({ desde: 57.5, hasta: 62.5 });
/** Las cinco áreas de competencia digital (`capacidades-digitales-area-<área>`). */
const AREAS = Object.freeze(['comunicacion', 'informacion', 'resolucion-problemas', 'seguridad', 'contenidos']);
/** Los niveles de capacidades digitales (`capacidades-digitales-<nivel>`). */
const NIVELES = Object.freeze([
  'avanzadas',
  'solo-basicas',
  'bajas',
  'reducidas',
  'limitadas',
  'ninguna',
  'sin-evaluar',
]);
/** Una meta que pide «más del» valor (las pymes, art. 4.1.3.b): lo dice su texto literal. */
const MAS_DE = /\bmás del\b/;
/** Las escalas reales de las metas: de 0 a 100 % y, en especialistas, de 0 a 25 millones. */
const ESCALA_PORCENTAJE = Object.freeze({ maximo: 100, paso: 20 });
const ESCALA_MILLONES = Object.freeze({ maximo: 25, paso: 5 });
/** Los números que se escriben en letra en los titulares («a cinco años», «sus cuatro metas»). */
const EN_LETRA = 10;
/** Los recuentos en miles de personas se dibujan en millones. */
const MILES_POR_MILLON = 1000;

/** Una frase de la lectura si están sus cifras. @param {boolean} hay @param {() => Frase} frase @returns {Frase[]} */
function si(hay, frase) {
  return hay ? [frase()] : [];
}

/** Un número de 0 a 10 en letra, o en cifra si es mayor. @param {number} numero @returns {Parte} */
function enLetra(numero) {
  return numero >= 0 && numero <= EN_LETRA ? traducible(`datos-globales.numero.${numero}`) : String(numero);
}

/** La figura de 06: los niveles y las cinco áreas de competencia digital. @param {DatosGlobales} datos */
function figuraDeCapacidades(datos) {
  return figuraDeBarras(datos, {
    titulo: 'datos-globales.ue.capacidades.figura',
    sub: 'datos-globales.ue.capacidades.figura.sub',
    paneles: [
      {
        titulo: 'datos-globales.ue.capacidades.panel.niveles',
        ordenar: false,
        filas: [
          ['capacidades-digitales-basicas', 'datos-globales.ue.capacidades.al-menos', true],
          ...NIVELES.map(
            (n) => /** @type {Fila} */ ([`capacidades-digitales-${n}`, `datos-globales.ue.capacidades.${n}`]),
          ),
        ],
      },
      {
        titulo: 'datos-globales.ue.capacidades.panel.areas',
        ordenar: true,
        filas: [
          ['capacidades-digitales-basicas', 'datos-globales.ue.capacidades.las-cinco', true],
          ...AREAS.map(
            (a) => /** @type {Fila} */ ([`capacidades-digitales-area-${a}`, `datos-globales.ue.capacidades.area.${a}`]),
          ),
        ],
      },
    ],
    escala: ESCALA_PORCENTAJE,
    fuente: 'datos-globales.ue.capacidades.fuente',
    notas: [traducible('datos-globales.ue.capacidades.nota')],
  });
}

/**
 * La entradilla de 06: la cifra de hoy y, si el archivo la trae, su meta.
 * @param {DatosGlobales} datos @param {Valores} valores @returns {Parte[]}
 */
function entradillaDeCapacidades(datos, valores) {
  const meta = datos.metas.find(({ indicador }) => indicador === 'capacidades-digitales-basicas');
  return [
    traducible('datos-globales.ue.capacidades.entradilla', valores),
    ...(meta
      ? [traducible('datos-globales.ue.capacidades.entradilla.meta', { anio: meta.anio, meta: entero(meta.valor) })]
      : []),
  ];
}

/**
 * Las frases de 06: cómo ha cambiado, las capacidades avanzadas y el área más difícil frente a la más fácil.
 * @param {DatosGlobales} datos
 * @param {{ primera: { valor: number }, ultima: { valor: number }, valores: Valores }} evolucion
 * @returns {Frase[]}
 */
function lecturaDeCapacidades(datos, { primera, ultima, valores }) {
  const avanzadas = serieDe(datos, CODIGO_DE_LA_UE, 'capacidades-digitales-avanzadas');
  const areas = AREAS.flatMap((area) => {
    const valor = ue(datos, `capacidades-digitales-area-${area}`);
    return valor === null ? [] : [{ area, valor }];
  }).sort((a, b) => a.valor - b.valor);
  const [menor] = areas;
  const mayor = areas.at(-1);
  return [
    [
      traducible(`datos-globales.lectura.desde.${comparar(ultima.valor, primera.valor)}`, valores),
      traducible('datos-globales.ue.capacidades.lectura.evolucion', valores),
    ],
    ...si(avanzadas.length > 1, () => [
      traducible('datos-globales.ue.capacidades.avanzadas.titulo'),
      traducible('datos-globales.ue.capacidades.lectura.avanzadas', {
        cifra: entero(avanzadas.at(-1)?.valor ?? 0),
        desde: avanzadas[0]?.anio ?? '',
        inicio: entero(avanzadas[0]?.valor ?? 0),
      }),
    ]),
    ...si(!!menor && !!mayor && menor !== mayor, () => [
      traducible('datos-globales.ue.capacidades.dificil'),
      traducible('datos-globales.ue.capacidades.lectura.dificil', {
        area: traducible(`datos-globales.ue.capacidades.area.${menor?.area}.frase`),
        cifra: entero(menor?.valor ?? 0),
        otra: traducible(`datos-globales.ue.capacidades.area.${mayor?.area}.frase`),
        otraCifra: entero(mayor?.valor ?? 0),
      }),
    ]),
  ];
}

/** 06 · Capacidades digitales. @param {DatosGlobales} datos @returns {HTMLElement[]} */
export function capacidades(datos) {
  const linea = figuraDeLinea(datos, {
    id: 'capacidades-digitales-basicas',
    clave: 'capacidades',
    escala: ESCALA_PORCENTAJE,
  });
  const { figura: barras, anio } = figuraDeCapacidades(datos);
  const cifra = ue(datos, 'capacidades-digitales-basicas');
  if (!linea || cifra === null) {
    return [];
  }
  const { primera, ultima } = linea;
  const valores = {
    desde: primera.anio,
    hasta: ultima.anio,
    inicio: entero(primera.valor),
    fin: entero(ultima.valor),
    cifra: entero(cifra),
    puntos: numeroEscrito(resta(ultima.valor, primera.valor)),
  };
  return capituloUe({
    id: 'capacidades',
    orden: 6,
    titular: traducible(
      `datos-globales.ue.capacidades.titular.${entre(cifra, SEIS_DE_CADA_DIEZ) ? 'seis' : 'cifra'}`,
      valores,
    ),
    entradilla: entradillaDeCapacidades(datos, valores),
    figuras: [linea.figura, ...barras],
    lectura: lecturaDeCapacidades(datos, { primera, ultima, valores }),
    ficha: fichaUe('capacidades', ['que-mide', 'niveles', 'base', 'anios', 'fuente', 'formacion'], {
      valores: { anio: anio ?? '' },
      tipo: marcaDeIndicador(datos, 'capacidades-digitales-basicas'),
    }),
  });
}

/**
 * El último dato de una meta (de su indicador o de su recuento), con su año, o null.
 * @param {DatosGlobales} datos @param {Meta} meta @returns {{ valor: number, anio: number, anteriores: { anio: number, valor: number }[] } | null}
 */
function datoDeLaMeta(datos, meta) {
  const recuento = datos.recuentos.find(({ id }) => id === meta.indicador);
  if (recuento) {
    const cifra = cifraDelBloque(datos, recuento, CODIGO_DE_LA_UE);
    return cifra ? { valor: cifra.valor, anio: cifra.anio, anteriores: [] } : null;
  }
  const ultimo = valorDe(datos, CODIGO_DE_LA_UE, meta.indicador);
  if (!ultimo) {
    return null;
  }
  const anteriores = serieDe(datos, CODIGO_DE_LA_UE, meta.indicador).filter(
    ({ anio, nota }) => anio < ultimo.anio && nota === null,
  );
  return { valor: ultimo.valor, anio: ultimo.anio, anteriores: anteriores.map(({ anio, valor }) => ({ anio, valor })) };
}

/**
 * Una meta lista para dibujar: en porcentaje o, si es un recuento, en millones.
 * @param {DatosGlobales} datos @param {Meta} meta
 */
function filaDeMeta(datos, meta) {
  const dato = datoDeLaMeta(datos, meta);
  if (!dato) {
    return null;
  }
  const enMillones = meta.unidad === MILES_DE_PERSONAS;
  const escalar = (/** @type {number} */ cifra) => (enMillones ? cifra / MILES_POR_MILLON : cifra);
  const escribir = (/** @type {number} */ cifra, decimales = 1) =>
    enMillones
      ? traducible('datos-globales.ue.metas.millones', { cifra: numeroEscrito(cifra, decimales) })
      : `${numeroEscrito(cifra, decimales)} %`;
  const valor = escalar(dato.valor);
  const objetivo = escalar(meta.valor);
  return {
    meta,
    dato,
    enMillones,
    valor,
    objetivo,
    faltan: resta(objetivo, valor),
    escribir,
    escala: enMillones ? ESCALA_MILLONES : ESCALA_PORCENTAJE,
  };
}

/**
 * Lo que falta para una meta, en puntos o en millones, o que ya se ha alcanzado.
 * @param {NonNullable<ReturnType<typeof filaDeMeta>>} fila @returns {Parte}
 */
function faltaDeMeta({ enMillones, objetivo, faltan, escribir }) {
  return faltan > 0
    ? traducible(enMillones ? 'datos-globales.ue.metas.faltan.millones' : 'datos-globales.ue.metas.faltan.puntos', {
        faltan: numeroEscrito(faltan),
        meta: enMillones ? numeroEscrito(objetivo, 0) : escribir(objetivo, 0),
      })
    : traducible('datos-globales.ue.metas.alcanzada');
}

/**
 * La nota de las mediciones anteriores de una meta, si las hay.
 * @param {NonNullable<ReturnType<typeof filaDeMeta>>} fila @returns {HTMLElement[]}
 */
function notaDeAnteriores({ dato, escribir }) {
  return dato.anteriores.length
    ? [
        conTexto(
          'p',
          { className: 'dg-meta-nota' },
          traducible('datos-globales.ue.metas.anteriores', {
            lista: conPuntoYComa(
              dato.anteriores.map(({ anio, valor: v }) =>
                traducible('datos-globales.ue.metas.anterior', { anio, valor: escribir(v) }),
              ),
            ),
          }),
        ),
      ]
    : [];
}

/**
 * La barra de una meta, con su cabecera (nombre y lo que falta) y la nota de las mediciones anteriores.
 * @param {NonNullable<ReturnType<typeof filaDeMeta>>} fila
 */
function barraDeMeta(fila) {
  const { meta, dato, enMillones, valor, objetivo, escribir, escala } = fila;
  const masDe = MAS_DE.test(meta.texto);
  const dibujo = grafico(
    haciaMeta({
      valor,
      meta: objetivo,
      escala: escalaPara(escala, [valor, objetivo]),
      anteriores: dato.anteriores.map(({ valor: anterior }) => anterior),
      rotuloValor: traducible('datos-globales.ue.metas.rotulo.valor', { anio: dato.anio, valor: escribir(valor) }),
      rotuloMeta: traducible(
        masDe ? 'datos-globales.ue.metas.rotulo.meta.mas' : 'datos-globales.ue.metas.rotulo.meta',
        { anio: meta.anio, meta: escribir(objetivo, 0) },
      ),
      eje: (marca) => (enMillones ? `${numeroEscrito(marca, 0)} M` : `${numeroEscrito(marca, 0)} %`),
    }),
  );
  const falta = faltaDeMeta(fila);
  const anteriores = notaDeAnteriores(fila);
  return crear(
    'div',
    { className: 'dg-meta-fila' },
    crear(
      'div',
      { className: 'dg-meta-cabeza' },
      conTexto('p', { className: 'dg-meta-nombre' }, traducible(`datos-globales.ue.metas.${meta.id}`)),
      conTexto('p', { className: 'dg-meta-falta' }, falta),
    ),
    dibujo.nodo,
    ...anteriores,
  );
}

/** Las frases de 07: lo que falta en capacidades, especialistas y empresas. @param {NonNullable<ReturnType<typeof filaDeMeta>>[]} filas @param {DatosGlobales} datos @returns {Frase[]} */
function lecturaDeMetas(filas, datos) {
  const de = (/** @type {string} */ id) => filas.find(({ meta }) => meta.id === id);
  const mujeres = ue(datos, 'especialistas-tic-mujeres');
  return ['meta-capacidades-digitales', 'meta-especialistas-tic', 'meta-empresas-nube-datos-ia'].flatMap((id) => {
    const fila = de(id);
    if (!fila) {
      return [];
    }
    const corto = id.replace('meta-', '');
    const valores = {
      faltan: numeroEscrito(fila.faltan),
      cifra: fila.enMillones ? numeroEscrito(fila.valor) : entero(fila.valor),
      meta: fila.enMillones ? numeroEscrito(fila.objetivo, 0) : entero(fila.objetivo),
      mujeres: mujeres === null ? '' : numeroEscrito(mujeres),
    };
    return [
      [
        traducible(
          fila.faltan > 0 ? `datos-globales.ue.metas.lectura.${corto}.titulo` : 'datos-globales.ue.metas.alcanzada',
          valores,
        ),
        traducible(`datos-globales.ue.metas.lectura.${corto}`, valores),
      ],
    ];
  });
}

/**
 * La entradilla de 07: la meta más lejana y la más cercana, si son distintas.
 * @param {NonNullable<ReturnType<typeof filaDeMeta>>[]} filas @returns {Parte[]}
 */
function entradillaDeMetas(filas) {
  const porAvance = [...filas].sort((a, b) => a.valor / a.objetivo - b.valor / b.objetivo);
  const lejana = porAvance[0];
  const cercana = porAvance.at(-1);
  const resumen = (/** @type {(typeof filas)[number] | undefined} */ fila) =>
    fila
      ? {
          nombre: traducible(`datos-globales.ue.metas.corto.${fila.meta.id}`),
          valor: fila.escribir(fila.valor),
          meta: fila.escribir(fila.objetivo, 0),
        }
      : {};
  return lejana && cercana && lejana !== cercana
    ? [
        traducible('datos-globales.ue.metas.entradilla', {
          lejana: resumen(lejana).nombre ?? '',
          valorLejana: resumen(lejana).valor ?? '',
          metaLejana: resumen(lejana).meta ?? '',
          cercana: resumen(cercana).nombre ?? '',
          valorCercana: resumen(cercana).valor ?? '',
          metaCercana: resumen(cercana).meta ?? '',
        }),
      ]
    : [];
}

/**
 * La figura de 07: una barra por meta, con su alternativa en texto.
 * @param {NonNullable<ReturnType<typeof filaDeMeta>>[]} filas @param {number} anioDeLaMeta @returns {HTMLElement}
 */
function figuraDeMetas(filas, anioDeLaMeta) {
  const cuerpo = crear('div', { className: 'dg-metas' }, ...filas.map(barraDeMeta));
  return figura({
    titulo: traducible('datos-globales.ue.metas.figura', { anio: anioDeLaMeta }),
    sub: [traducible('datos-globales.ue.metas.figura.sub')],
    control: null,
    marca: null,
    paneles: [{ titulo: null, nodo: cuerpo }],
    alternativa: filas.map(({ meta, dato, valor, objetivo, escribir }) =>
      traducible('datos-globales.ue.metas.alternativa', {
        nombre: traducible(`datos-globales.ue.metas.${meta.id}`),
        valor: escribir(valor),
        anio: dato.anio,
        meta: escribir(objetivo, 0),
        anioMeta: meta.anio,
      }),
    ),
    fuente: traducible('datos-globales.ue.metas.fuente.figura'),
    notas: [traducible('datos-globales.ue.metas.nota')],
  });
}

/** La ficha de 07: las metas con su texto literal y la versión 4 del índice de las pymes. @param {DatosGlobales} datos */
function fichaDeMetas(datos) {
  const version4 = valorDe(datos, CODIGO_DE_LA_UE, 'pymes-intensidad-digital-basica-v4');
  return fichaUe('metas', ['metas', 'capacidades', 'especialistas', 'empresas', 'pymes'], {
    valores: {
      version4: version4
        ? traducible('datos-globales.ue.metas.ficha.pymes.version4', {
            cifra: pct(version4.valor),
            anio: version4.anio,
          })
        : traducible('datos-globales.ue.metas.ficha.pymes.version4.sin-dato'),
      textos: datos.metas.map(({ articulo, texto }) => `${articulo}: «${texto}»`).join('; '),
    },
    tipo: marcaDeIndicador(datos, 'capacidades-digitales-basicas'),
  });
}

/** 07 · Metas para 2030. @param {DatosGlobales} datos @returns {HTMLElement[]} */
export function metas(datos) {
  const filas = datos.metas.flatMap((meta) => filaDeMeta(datos, meta) ?? []);
  const [primera] = filas;
  if (!primera) {
    return [];
  }
  const anioDeLaMeta = primera.meta.anio;
  const ultimoAnio = Math.max(...filas.map(({ dato }) => dato.anio));
  const ninguna = filas.every(({ faltan }) => faltan > 0);
  const figuraDeLasMetas = figuraDeMetas(filas, anioDeLaMeta);
  return capituloUe({
    id: 'metas',
    orden: 7,
    titular: ninguna
      ? traducible('datos-globales.ue.metas.titular.ninguna', {
          faltan: enLetra(anioDeLaMeta - ultimoAnio),
          anio: anioDeLaMeta,
          numero: enLetra(filas.length),
        })
      : traducible('datos-globales.ue.metas.titular.neutro'),
    entradilla: entradillaDeMetas(filas),
    figuras: [figuraDeLasMetas],
    lectura: lecturaDeMetas(filas, datos),
    ficha: fichaDeMetas(datos),
  });
}

/** La figura de 08: las empresas que emplean y buscan especialistas y por qué les cuesta. @param {DatosGlobales} datos */
function figuraDeEspecialistas(datos) {
  return figuraDeBarras(datos, {
    titulo: 'datos-globales.ue.especialistas.figura',
    sub: 'datos-globales.ue.especialistas.figura.sub',
    paneles: [
      {
        titulo: 'datos-globales.ue.especialistas.panel.empresas',
        ordenar: false,
        filas: [
          ['empresas-especialistas-tic', 'datos-globales.ue.especialistas.emplean', true],
          ['empresas-buscan-especialistas-tic', 'datos-globales.ue.especialistas.buscan'],
          ['empresas-vacantes-tic-dificiles', 'datos-globales.ue.especialistas.vacantes'],
        ],
      },
      {
        titulo: 'datos-globales.ue.especialistas.panel.motivos',
        ordenar: true,
        filas: [
          ['vacantes-tic-dificiles-entre-las-que-buscaron', 'datos-globales.ue.especialistas.vacantes', true],
          ...['faltan-candidaturas', 'salarios', 'formacion', 'experiencia'].map(
            (m) => /** @type {Fila} */ ([`especialistas-tic-dificultad-${m}`, `datos-globales.ue.especialistas.${m}`]),
          ),
        ],
      },
    ],
    escala: ESCALAS.empresas,
    fuente: 'datos-globales.ue.especialistas.fuente',
    notas: [traducible('datos-globales.ue.especialistas.nota')],
  });
}

/**
 * Las frases de 08: las vacantes difíciles de cubrir (frente a la medición anterior) y quién los emplea.
 * @param {DatosGlobales} datos
 * @param {{ ultima: { valor: number } | undefined, anterior: { anio: number, valor: number } | undefined,
 *   mitad: boolean }} vacantes
 * @returns {Frase[]}
 */
function lecturaDeEspecialistas(datos, { ultima, anterior, mitad }) {
  const emplean = ue(datos, 'empresas-especialistas-tic');
  return [
    ...si(!!ultima, () => [
      traducible(
        mitad ? 'datos-globales.ue.especialistas.mitad' : 'datos-globales.ue.especialistas.lectura.vacantes.titulo',
      ),
      anterior
        ? traducible('datos-globales.ue.especialistas.lectura.vacantes', {
            cifra: entero(ultima?.valor ?? 0),
            anio: anterior.anio,
            anterior: entero(anterior.valor),
          })
        : traducible('datos-globales.ue.especialistas.lectura.vacantes.sola', { cifra: entero(ultima?.valor ?? 0) }),
    ]),
    ...si(emplean !== null, () => [
      traducible('datos-globales.ue.especialistas.quien'),
      traducible('datos-globales.ue.especialistas.lectura.quien', { cifra: entero(emplean ?? 0) }),
    ]),
  ];
}

/**
 * La ficha de 08: los años y, si la hay, la medición anterior de las vacantes.
 * @param {DatosGlobales} datos @param {number | null} anio @param {{ anio: number, valor: number } | undefined} anterior
 */
function fichaDeEspecialistas(datos, anio, anterior) {
  return fichaUe('especialistas', ['que-mide', 'base', 'anios', 'fuente'], {
    valores: {
      anio: anio ?? '',
      anterior: anterior
        ? traducible('datos-globales.ue.especialistas.ficha.anios.anterior', {
            anio: anterior.anio,
            cifra: pct(anterior.valor),
          })
        : traducible('datos-globales.ue.especialistas.ficha.anios.sin-dato'),
    },
    tipo: marcaDeIndicador(datos, 'empresas-especialistas-tic'),
  });
}

/** 08 · Especialistas en TIC. @param {DatosGlobales} datos @returns {HTMLElement[]} */
export function especialistas(datos) {
  const { figura: figuras, anio } = figuraDeEspecialistas(datos);
  const recuento = datos.recuentos.find(({ id }) => id === 'especialistas-tic');
  const cuantos = recuento ? cifraDelBloque(datos, recuento, CODIGO_DE_LA_UE) : null;
  const serie = serieDe(datos, CODIGO_DE_LA_UE, 'vacantes-tic-dificiles-entre-las-que-buscaron');
  const ultima = serie.at(-1);
  const anterior = serie.at(-2);
  const empleo = ue(datos, 'especialistas-tic-empleo');
  const mujeres = ue(datos, 'especialistas-tic-mujeres');
  const mitad = !!ultima && ultima.valor > MITAD_PCT;
  return capituloUe({
    id: 'especialistas',
    orden: 8,
    titular: cuantos
      ? traducible(
          mitad
            ? 'datos-globales.ue.especialistas.titular.cifra-mitad'
            : 'datos-globales.ue.especialistas.titular.cifra',
          { cifra: millones(cuantos.valor) },
        )
      : traducible('datos-globales.ue.especialistas.titular.neutro'),
    entradilla:
      empleo === null || mujeres === null
        ? []
        : [
            traducible('datos-globales.ue.especialistas.entradilla', {
              empleo: numeroEscrito(empleo),
              mujeres: entero(mujeres),
            }),
          ],
    figuras,
    lectura: lecturaDeEspecialistas(datos, { ultima, anterior, mitad }),
    ficha: fichaDeEspecialistas(datos, anio, anterior),
  });
}

/** La figura de 09: las empresas que forman en TIC a su personal. @param {DatosGlobales} datos */
function figuraDeEmpresasQueForman(datos) {
  return figuraDeBarras(datos, {
    titulo: 'datos-globales.ue.formacion.figura',
    sub: 'datos-globales.ue.formacion.figura.sub',
    paneles: [
      {
        titulo: null,
        ordenar: true,
        filas: [
          ['empresas-formacion-tic', 'datos-globales.ue.formacion.su-personal', true],
          ['empresas-formacion-tic-resto-del-personal', 'datos-globales.ue.formacion.otro'],
          ['empresas-formacion-tic-especialistas', 'datos-globales.ue.formacion.especialistas'],
        ],
      },
    ],
    escala: ESCALAS.empresas,
    fuente: 'datos-globales.ue.formacion.fuente.empresas',
    notas: [],
  });
}

/**
 * Las frases de 09: cómo ha cambiado, mujeres y hombres y las empresas que forman a su personal.
 * @param {DatosGlobales} datos
 * @param {{ primera: { valor: number }, ultima: { valor: number }, valores: Valores, anio: number | null }} formacion
 * @returns {Frase[]}
 */
function lecturaDeFormacion(datos, { primera, ultima, valores, anio }) {
  const sexo = [ue(datos, 'formacion-adultos-mujeres'), ue(datos, 'formacion-adultos-hombres')];
  const conPersonal = ue(datos, 'empresas-formacion-tic');
  return [
    [
      traducible(`datos-globales.lectura.desde.${comparar(ultima.valor, primera.valor)}`, valores),
      traducible('datos-globales.ue.formacion.lectura.evolucion', valores),
    ],
    ...si(
      sexo.every((cifra) => cifra !== null),
      () => [
        traducible('datos-globales.ue.formacion.sexo'),
        traducible('datos-globales.ue.formacion.lectura.sexo', {
          mujeres: entero(sexo[0] ?? 0),
          hombres: entero(sexo[1] ?? 0),
        }),
      ],
    ),
    ...si(conPersonal !== null, () => [
      traducible('datos-globales.ue.formacion.lectura.empresas.titulo'),
      traducible('datos-globales.ue.formacion.lectura.empresas', {
        cifra: entero(conPersonal ?? 0),
        anio: anio ?? '',
      }),
    ]),
  ];
}

/** 09 · Formación. @param {DatosGlobales} datos @returns {HTMLElement[]} */
export function formacion(datos) {
  const linea = figuraDeLinea(datos, { id: 'formacion-adultos', clave: 'formacion', escala: ESCALAS.formacion });
  const { figura: empresas, anio } = figuraDeEmpresasQueForman(datos);
  if (!linea) {
    return [];
  }
  const { primera, ultima } = linea;
  const serie = serieDe(datos, CODIGO_DE_LA_UE, 'formacion-adultos').filter(({ nota }) => nota === null);
  const creciente =
    serie.length > 1 &&
    serie.every((punto, i) => i === 0 || punto.valor > (serie[i - 1]?.valor ?? Number.POSITIVE_INFINITY));
  const valores = {
    cifra: entero(ultima.valor),
    anio: ultima.anio,
    desde: primera.anio,
    hasta: ultima.anio,
    inicio: entero(primera.valor),
    fin: entero(ultima.valor),
  };
  return capituloUe({
    id: 'formacion',
    orden: 9,
    titular: traducible(
      creciente ? 'datos-globales.ue.formacion.titular.sube' : 'datos-globales.ue.formacion.titular.cifra',
      valores,
    ),
    entradilla: [traducible('datos-globales.ue.formacion.entradilla')],
    figuras: [linea.figura, ...empresas],
    lectura: lecturaDeFormacion(datos, { primera, ultima, valores, anio }),
    ficha: fichaUe(
      'formacion',
      ['que-mide', 'anios', ...apartadoNoComparables(noComparablesUe(datos, 'formacion-adultos')), 'fuente'],
      { valores: {}, tipo: marcaDeIndicador(datos, 'formacion-adultos') },
    ),
  });
}
