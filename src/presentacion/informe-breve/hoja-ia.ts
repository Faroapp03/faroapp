// Hoja 1 del informe breve, «Tu trabajo y la IA»: cabecera, «En pocas palabras», tres conclusiones con su procedencia
// y su confianza, las tareas de la persona una a una y lo que sigue siendo suyo. Todo sale de las cifras del dominio
// (dominio/informe-breve.ts) con las reglas de textos.ts: ninguna frase está escrita para una ocupación.

import { fechaConBarras } from '../../comun/formato.ts';
import type { Idioma } from '../../comun/idioma.ts';
import { FUENTES_GENERALES } from '../../dominio/hechos-del-informe-breve.ts';
import type {
  CapacidadBreve,
  ExposicionBreve,
  InformeBreve,
  TareaBreve,
  UsoBreve,
} from '../../dominio/tipos-informe-breve.ts';
import { escapar } from '../html.ts';
import type { LenguaHtml } from '../lengua-html.ts';
import type { TareaConsultable } from './consulta-tareas.ts';
import { cuadricula, medidor, semicirculo } from './graficos.ts';
import { type ClaveBreve, texto } from './idioma.ts';
import { banda, cierre, confianza, MARCA, sello } from './piezas.ts';
import { type RepartoEnPapel, repartoEnPapel, type TextosDeLaHoja } from './tareas-en-papel.ts';
import { contextoIaConGraficos, exposicionEnTresTarjetas, fuenteBreve } from './tarjetas-contexto.ts';
import {
  FRASE_DE_ATRIBUCION,
  FRASE_DE_LAS_MENOS_EXPUESTAS,
  fraseDeLaExposicion,
  fraseDeLosMetodos,
  fraseDelMercado,
  fraseDelUso,
  GRANDES_GRUPOS,
  LO_QUE_NO_HACE,
  motivoDeLaExposicion,
  motivoDelUso,
  personasDelUso,
  procedenciaDeLasNotas,
  TITULO_EXPOSICION,
  tituloDelUso,
} from './textos.ts';

/** Cómo se dice el tiempo que la persona dedica a cada tarea. */
const TIEMPO = { mucho: 'Mucho', algo: 'Algo', poco: 'Poco' } as const satisfies Record<string, ClaveBreve>;
/** La fuente de la OIT, en los sellos. */
const OIT = 'OIT, 2025';
/** El número de cada conclusión. */
const CONCLUSION = Object.freeze({ exposicion: 1, uso: 2, capacidad: 3 });

/** Lo que necesita cada hoja: el informe breve, el título de la ocupación como se ve y la lengua del informe. */
export interface AmbitoDeLaHoja {
  breve: InformeBreve;
  ejemplo?: boolean;
  tareas: readonly TareaConsultable[];
  /** El título de la ocupación, ya escapado, con su forma breve si es segura y sus dos formas para los lectores. */
  titulo: string;
  /** El mismo título tal como se ve, ya escapado; puede llevar su marca de idioma (para el pie y los rótulos). */
  tituloVisto: string;
  /** El título tal como se ve, escapado y en texto plano, sin etiquetas: el único que puede ir dentro de un atributo. */
  tituloTexto: string;
  lengua: LenguaHtml;
  hojas: number;
}

/** El código de la ocupación que acompaña a su título: el ESCO o, si no lo hay, el grupo. */
function codigoDeLaOcupacion(breve: InformeBreve, idioma: Idioma): string {
  return breve.ocupacion.esco ? `ESCO ${breve.ocupacion.esco}` : texto(idioma, 'Grupo {0}', breve.ocupacion.isco08);
}

/** La cabecera de la hoja 1: título, ocupación, ámbito y fecha. */
export function fichaDeLaOcupacion({ breve, titulo, lengua }: AmbitoDeLaHoja): string {
  const idioma = lengua.idioma;
  const codigo = breve.ocupacion.esco
    ? `<div><dt>ESCO</dt><dd>${escapar(breve.ocupacion.esco)}</dd></div>`
    : `<div><dt>${idioma === 'ca' ? 'Grup' : 'Grupo'}</dt><dd>${escapar(breve.ocupacion.isco08)}</dd></div>`;
  return `<dl class="ib-meta ib-ficha">
    <div><dt>${texto(idioma, 'Ocupación')}</dt><dd>${titulo}</dd></div>
    ${codigo}
    <div><dt>${texto(idioma, 'Ámbito')}</dt><dd>${texto(idioma, 'Cataluña')}</dd></div>
    <div><dt>${texto(idioma, 'Fecha')}</dt><dd>${escapar(fechaConBarras(breve.fecha))}</dd></div>
  </dl>`;
}

function cabecera(ambito: AmbitoDeLaHoja): string {
  return `<header class="ib-cabecera ib-cabecera-retrato">
  <div class="ib-titular"><h1 id="titulo">${texto(ambito.lengua.idioma, 'Tu trabajo y la IA')}</h1></div>${MARCA}
  </header>${fichaDeLaOcupacion(ambito)}`;
}

/** El empleo del que habla la frase del mercado: el de su gran grupo (EPA) o el de su grupo del censo. */
function nombreDelEmpleo(breve: InformeBreve, idioma: Idioma): string {
  const empleo = breve.mercado.empleo;
  const gran = empleo?.fuente === 'epa' ? GRANDES_GRUPOS[empleo.codigo] : undefined;
  return texto(idioma, gran ? gran.empleo : 'el empleo de tu grupo');
}

/** «En pocas palabras»: exposición, uso, mercado y atribución, con reglas fijas. */
function enPocasPalabras(breve: InformeBreve, lengua: LenguaHtml): string {
  const idioma = lengua.idioma;
  const { mercado } = breve;
  const movimientos = [
    ...(mercado.empleo ? [{ nombre: nombreDelEmpleo(breve, idioma), direccion: mercado.empleo.direccion }] : []),
    ...(mercado.contratacion
      ? [{ nombre: texto(idioma, 'la contratación'), direccion: mercado.contratacion.direccion }]
      : []),
  ];
  const frases = [
    fraseDeLaExposicion(breve.exposicion, idioma),
    ...(breve.uso ? [fraseDelUso(breve.uso, idioma)] : []),
    fraseDelMercado(movimientos, idioma),
    texto(idioma, FRASE_DE_ATRIBUCION),
  ].filter((frase): frase is string => frase !== null);
  const titulo = idioma === 'ca' ? 'Què indiquen les dades' : 'Qué indican los datos';
  return `<section class="ib-bluf" aria-label="${titulo}">
  <span class="ib-etiqueta">${titulo}</span>
  <p>${lengua.texto(frases.join(' '))}</p>
</section>`;
}

/** Una conclusión numerada: título, figura, texto, procedencia y confianza. */
function conclusion(
  numero: number,
  partes: { titulo: string; texto: string; sellos: string; conf: string; figura: string },
): string {
  return `<li class="ib-juicio"><div class="ib-juicio-cabeza"><span class="ib-num">${String(numero).padStart(2, '0')}</span><h2 class="ib-juicio-titulo">${escapar(partes.titulo)}</h2></div><figure class="ib-figura">${partes.figura}</figure><p>${partes.texto}</p><div class="ib-origen">${partes.sellos}</div>${partes.conf}</li>`;
}

/**
 * Conclusión 01: la exposición de sus tareas. Si todas las notas son estimaciones de Faro, la escala se presenta como
 * de Faro con los criterios de la OIT, y el sello de la OIT solo queda si la OIT es uno de los métodos que se citan.
 */
function deLaExposicion(exposicion: ExposicionBreve, idioma: Idioma): string {
  const soloFaro = procedenciaDeLasNotas(exposicion.estimadasPorFaro, exposicion.conNota) === 'faro';
  const sinNota = exposicion.sinNota
    ? ` ${exposicion.sinNota === 1 ? texto(idioma, 'Una de tus tareas no tiene nota y no cuenta') : texto(idioma, '{0} de tus tareas no tienen nota y no cuentan', exposicion.sinNota)}${texto(idioma, ' en la media.')}`
    : '';
  const rotulo = texto(
    idioma,
    '{0} de 100, con un margen de {1} a {2}',
    exposicion.valor,
    exposicion.minimo,
    exposicion.maximo,
  );
  return conclusion(CONCLUSION.exposicion, {
    titulo: texto(idioma, TITULO_EXPOSICION[exposicion.nivel]),
    texto: `${texto(idioma, soloFaro ? 'Faro estima cada tarea con los criterios de puntuación de la OIT, de 0 (la IA no puede hacerla) a 100 (podría hacerla entera). La media de tus tareas, según el tiempo que dedicas a cada una, es <b>{0}</b>.' : 'La OIT puntúa cada tarea de 0 (la IA no puede hacerla) a 100 (podría hacerla entera). La media de tus tareas, según el tiempo que dedicas a cada una, es <b>{0}</b>.', exposicion.valor)}${escapar(sinNota)} ${escapar(fraseDeLosMetodos(exposicion, idioma))}`,
    sellos:
      (soloFaro && !exposicion.metodos ? '' : sello('estudio', OIT, idioma)) +
      sello('tu', texto(idioma, 'tus tiempos'), idioma) +
      sello('faro', '', idioma),
    conf: confianza(exposicion.confianza, motivoDeLaExposicion(exposicion, idioma), false, idioma),
    figura: `${semicirculo(exposicion.valor, [exposicion.minimo, exposicion.maximo], rotulo, 'de 100')}<figcaption>${texto(idioma, 'Las estimaciones van de {0} a {1}', exposicion.minimo, exposicion.maximo)}</figcaption>`,
  });
}

/** Conclusión 02: cuántas personas de su grupo usan la IA para trabajar. */
function delUso(uso: UsoBreve, lengua: LenguaHtml): string {
  const idioma = lengua.idioma;
  const donde = texto(idioma, uso.ambito === 'cataluna' ? 'En Cataluña' : 'En España');
  const aviso =
    uso.ambito === 'espana' ? texto(idioma, ' No hay respuestas suficientes de Cataluña para este grupo.') : '';
  const personas = lengua.texto(personasDelUso(uso, idioma));
  const rotulo = `${uso.deCada100} de cada 100 ${personasDelUso(uso, idioma)}`;
  return conclusion(CONCLUSION.uso, {
    titulo: tituloDelUso(uso.deCada100, idioma),
    texto: texto(
      idioma,
      '{0}, <b>{1} de cada 100</b> {2} usaron IA generativa para trabajar en {3}.{4}',
      donde,
      uso.deCada100,
      personas,
      escapar(uso.anio),
      aviso,
    ),
    sellos: sello('oficial', `INE, ${uso.anio}`, idioma),
    conf: confianza(uso.confianza, motivoDelUso(uso, idioma), false, idioma),
    figura: `<div class="ib-cifra-figura">${uso.deCada100}<small>de cada 100</small></div>${cuadricula(uso.deCada100, rotulo)}<figcaption>${texto(idioma, 'Margen de la encuesta: de {0} a {1}', uso.intervalo[0], uso.intervalo[1])}</figcaption>`,
  });
}

/** Conclusión 03: lo que completa hoy la IA en trabajos largos (dato general). */
function deLaCapacidad(capacidad: CapacidadBreve, idioma: Idioma): string {
  return conclusion(CONCLUSION.capacidad, {
    titulo: texto(idioma, 'Aún completa pocos trabajos largos'),
    texto: texto(
      idioma,
      'La mejor IA resolvió el <b>{0} %</b> de las tareas largas de ordenador. Solo contaba el resultado final.',
      capacidad.deCada100,
    ),
    sellos: sello('estudio', `${FUENTES_GENERALES.osworld}, ${capacidad.anio}`, idioma),
    conf: confianza(
      capacidad.confianza,
      texto(idioma, 'pruebas de laboratorio, no tu puesto de trabajo.'),
      false,
      idioma,
    ),
    figura: `<div class="ib-cifra-figura">${capacidad.deCada100}<small>de 100</small></div>${medidor(capacidad.deCada100, texto(idioma, '{0} de cada 100 trabajos completados', capacidad.deCada100))}<figcaption>${texto(idioma, 'Trabajos largos completados')}</figcaption>`,
  });
}

/** Las marcas de una tarea junto a su nombre: el sello de Faro si la nota es suya y «Incierta» si lo es. */
function marcasDeLaTarea(tarea: TareaBreve, idioma: Idioma): string {
  const marcas = [
    ...(tarea.origen === 'faro' ? [sello('faro', '', idioma)] : []),
    ...(tarea.incierta ? [escapar(texto(idioma, 'Incierta'))] : []),
  ];
  return marcas.join(' · ');
}

/**
 * La celda del nombre de una tarea. Con marcas, el nombre y sus marcas van en dos piezas hermanas de la misma celda,
 * para que el nombre sea solo el texto de la tarea; sin marcas, la celda es el propio nombre.
 */
function celdaDelNombre(tarea: TareaBreve, lengua: LenguaHtml): string {
  const nombre = `<span class="ib-tarea-nombre">${lengua.dato(tarea.nombre)}</span>`;
  const marcas = marcasDeLaTarea(tarea, lengua.idioma);
  return marcas
    ? `<span class="ib-tarea-celda">${nombre} <span class="ib-tarea-marcas">${marcas}</span></span>`
    : nombre;
}

/**
 * Los sellos de la leyenda de las tareas: el de la OIT si alguna nota es suya (o no hay ninguna de Faro) y el de Faro
 * si alguna nota es una estimación de Faro.
 */
function sellosDeLasNotas(tareas: readonly TareaConsultable[], idioma: Idioma): string {
  const deFaro = tareas.some(({ tarea }) => tarea.origen === 'faro');
  const deOit = tareas.some(({ tarea }) => tarea.origen === 'oit');
  return [
    ...(deOit || !deFaro ? [sello('estudio', OIT, idioma)] : []),
    ...(deFaro ? [sello('faro', '', idioma)] : []),
  ].join(' ');
}

/**
 * Una tarea con su tiempo y su barra de 0 a 100 (más oscura, más expuesta); sin nota, lo dice. Si no cabe en la hoja
 * impresa, la fila lleva data-solo-pantalla: se ve en pantalla y no se imprime (informe-breve.css).
 */
function filaDeTarea({ tarea }: TareaConsultable, lengua: LenguaHtml, enPapel: boolean): string {
  const idioma = lengua.idioma;
  const franjas =
    idioma === 'ca'
      ? { baja: 'Baixa', media: 'Mitjana', alta: 'Alta' }
      : { baja: 'Baja', media: 'Media', alta: 'Alta' };
  const nivel = tarea.franja ? `<span class="ib-tarea-nivel">${franjas[tarea.franja]}</span>` : '';
  const barra =
    tarea.valor === null
      ? `<span class="ib-tarea-pista" data-sin-nota><span class="ib-sin-nota">${texto(idioma, 'Sin nota')}</span></span><span class="ib-tarea-valor"><span class="ib-guion">—</span></span>`
      : `<span class="ib-tarea-pista" role="img" aria-label="${tarea.valor} de 100"><span class="ib-tarea-relleno" data-franja="${tarea.franja}" data-ancho="${tarea.valor}"></span></span><span class="ib-tarea-valor">${tarea.valor}</span>`;
  return `<li class="ib-tarea" data-tiempo="${tarea.tiempo}"${enPapel ? '' : ' data-solo-pantalla'}>${celdaDelNombre(tarea, lengua)}<span class="ib-tarea-tiempo">${texto(idioma, TIEMPO[tarea.tiempo])}</span>${barra}${nivel}</li>`;
}

/**
 * La línea de papel que dice cuántas tareas caben en la hoja impresa y dónde están las demás; vacía si caben todas.
 * Solo se imprime (informe-breve.css).
 */
function tareasFueraDelPapel(caben: number, total: number, idioma: Idioma): string {
  if (caben >= total) {
    return '';
  }
  const apartado = texto(idioma, 'Detalle de todas las tareas');
  if (caben === 0) {
    const linea =
      total === 1
        ? texto(idioma, 'Tu tarea está en el informe en pantalla, en «{0}».', apartado)
        : texto(idioma, 'Tus {0} tareas están en el informe en pantalla, en «{1}».', total, apartado);
    return `<p class="ib-tareas-fuera">${escapar(linea)}</p>`;
  }
  const cuantas =
    caben === 1
      ? texto(idioma, 'En esta hoja cabe 1 de tus {0} tareas.', total)
      : texto(idioma, 'En esta hoja caben {0} de tus {1} tareas.', caben, total);
  const donde = texto(
    idioma,
    total - caben === 1
      ? 'La que falta está en el informe en pantalla, en «{0}».'
      : 'Las demás están en el informe en pantalla, en «{0}».',
    apartado,
  );
  return `<p class="ib-tareas-fuera">${escapar(`${cuantas} ${donde}`)}</p>`;
}

/**
 * «Tus tareas, una a una». En pantalla, todas; en papel, las que caben enteras en la hoja 1 (tareas-en-papel.ts) y,
 * si falta alguna, la línea que lo dice. Si no cabe ninguna, en papel tampoco van la cabecera de sus columnas ni su
 * leyenda, que hablan de las filas.
 */
function tareasUnaAUna(tareas: readonly TareaConsultable[], enPapel: readonly boolean[], lengua: LenguaHtml): string {
  const idioma = lengua.idioma;
  const caben = enPapel.filter(Boolean).length;
  return `<section class="ib-bloque-tareas" aria-label="${texto(idioma, 'Tus tareas, una a una')}">
  <h2 class="ib-seccion"><span>${texto(idioma, 'Tus tareas, una a una')}</span></h2>
  <p class="ib-subtitulo-tareas">${idioma === 'ca' ? 'Cada barra mostra l’exposició tècnica d’una tasca a la IA generativa, de 0 a 100.' : 'Cada barra muestra la exposición técnica de una tarea a la IA generativa, de 0 a 100.'}</p>
  <div class="ib-tareas-cabeza"${caben ? '' : ' data-solo-pantalla'}><span>${texto(idioma, 'Tarea')}</span><span>${texto(idioma, 'Tiempo')}</span><span class="ib-escala"><span>0</span><span>50</span><span>100</span></span><span></span></div>
  <ol class="ib-tareas">${tareas.map((tarea, i) => filaDeTarea(tarea, lengua, enPapel[i] === true)).join('')}</ol>${tareasFueraDelPapel(caben, tareas.length, idioma)}
  <p class="ib-leyenda-tareas"${caben ? '' : ' data-solo-pantalla'}><i class="ib-l-rampa"></i>${texto(idioma, 'Más oscuro, más expuesta')} ${sellosDeLasNotas(tareas, idioma)} ${sello('tu', texto(idioma, 'el tiempo de cada tarea'), idioma)}</p>
  ${fuenteBreve('Faro', idioma)}
</section>`;
}

/** La línea de papel cuando no cabe ninguna de las `total` tareas menos expuestas: en singular si es una sola. */
function textoDeLasQueNoCaben(idioma: Idioma, total: number, apartado: string): string {
  return total === 1
    ? texto(idioma, 'Tu tarea menos expuesta está en el informe en pantalla, en «{0}».', apartado)
    : texto(idioma, 'Tus {0} tareas menos expuestas están en el informe en pantalla, en «{1}».', total, apartado);
}

/**
 * La línea de papel que dice cuántas de las tareas menos expuestas caben en la hoja impresa; vacía si caben todas.
 * Solo se imprime (informe-breve.css).
 */
function menosFueraDelPapel(caben: number, total: number, idioma: Idioma): string {
  if (caben >= total) {
    return '';
  }
  const apartado = texto(idioma, 'Tus tareas menos expuestas');
  const linea =
    caben === 0
      ? textoDeLasQueNoCaben(idioma, total, apartado)
      : texto(
          idioma,
          'En esta hoja cabe 1 de tus {0} tareas menos expuestas. La otra está en el informe en pantalla, en «{1}».',
          total,
          apartado,
        );
  return `<p class="ib-tareas-fuera">${escapar(linea)}</p>`;
}

/**
 * Lo que sigue siendo tuyo: las tareas menos expuestas y lo que la IA no hace por ti. En papel, las menos expuestas
 * que caben enteras (tareas-en-papel.ts) y, si falta alguna, la línea que lo dice; en pantalla, todas.
 */
function loTuyo(breve: InformeBreve, enPapel: readonly boolean[], lengua: LenguaHtml): string {
  const idioma = lengua.idioma;
  const menosEnPapel = enPapel.filter(Boolean).length;
  const total = breve.menosExpuestas.length;
  const menos = total
    ? `<section aria-label="${texto(idioma, 'Tus tareas menos expuestas')}">
    <h2 class="ib-seccion"><span>${texto(idioma, 'Tus tareas menos expuestas')}</span></h2>
    <ul class="ib-menos">${breve.menosExpuestas.map((tarea, i) => `<li${enPapel[i] ? '' : ' data-solo-pantalla'}><b class="ib-menos-nombre">${lengua.dato(tarea.nombre)}</b></li>`).join('')}</ul>${menosFueraDelPapel(menosEnPapel, total, idioma)}
    <p class="ib-texto">${texto(idioma, FRASE_DE_LAS_MENOS_EXPUESTAS[procedenciaDeLasNotas(breve.menosExpuestas.filter((tarea) => tarea.origen === 'faro').length, breve.menosExpuestas.length)])}</p>
  </section>`
    : '';
  const noHace = LO_QUE_NO_HACE.map(
    ([titulo, explicacion]) =>
      `<li><b>${escapar(texto(idioma, titulo))}</b> ${escapar(texto(idioma, explicacion))}</li>`,
  ).join('');
  return `<div class="ib-tuyo">
  ${menos}
  <section aria-label="${texto(idioma, 'Lo que la IA no hace por ti')}">
    <h2 class="ib-seccion"><span>${texto(idioma, 'Lo que la IA no hace por ti')}</span><small>${sello('ia', texto(idioma, 'redactado con IA'), idioma)}</small></h2>
    <ul class="ib-no-hace">${noHace}</ul>
  </section>
</div>`;
}

/**
 * Lo que la hoja 1 escribe con el título de la ocupación, para estimar el sitio que deja a las tareas en papel.
 *
 * @param breve - El informe breve.
 * @param tituloTexto - El título de la ocupación tal como se ve, escapado y en texto plano.
 * @param idioma - El idioma del informe.
 * @returns El título de la ocupación con su código, como lo lleva la cabecera, y el pie.
 */
export function textosDeLaHoja(breve: InformeBreve, tituloTexto: string, idioma: Idioma): TextosDeLaHoja {
  return {
    idioma,
    ocupacion: `${tituloTexto} ${codigoDeLaOcupacion(breve, idioma)}`,
    pie: texto(idioma, 'Faro · Informe de {0} · Las fuentes, en la hoja 2', tituloTexto),
  };
}

/**
 * La hoja 1 entera.
 *
 * @param ambito - El informe breve, el título de la ocupación y la lengua.
 * @returns El HTML de la hoja.
 */
export function detalleEstadisticoIa({ breve, lengua }: AmbitoDeLaHoja): string {
  const { idioma } = lengua;
  const conclusiones = [
    breve.exposicion ? deLaExposicion(breve.exposicion, idioma) : '',
    breve.uso ? delUso(breve.uso, lengua) : '',
    deLaCapacidad(breve.capacidad, idioma),
  ].join('');
  return `<details class="ib-contexto metodo"><summary>${idioma === 'ca' ? 'Com es van calcular les dades d’IA' : 'Cómo se calcularon los datos de IA'}</summary>
    <ol class="ib-juicios">${conclusiones}</ol></details>`;
}

export function hojaDeLaIa(ambito: AmbitoDeLaHoja): string {
  const { breve, lengua, tituloVisto, tituloTexto, hojas, tareas, ejemplo } = ambito;
  const idioma = lengua.idioma;
  const reparto: RepartoEnPapel = repartoEnPapel(breve, textosDeLaHoja(breve, tituloTexto, idioma));
  const cuerpo = `${cabecera(ambito)}${enPocasPalabras(breve, lengua)}${exposicionEnTresTarjetas(breve, lengua)}${tareasUnaAUna(tareas, reparto.tareas, lengua)}${contextoIaConGraficos(breve, lengua)}`;
  return `<section class="hoja ib" aria-label="${texto(idioma, 'Hoja 1, tu trabajo y la IA')}">${banda(1, hojas, idioma, ejemplo)}<div class="ib-cuerpo">${cuerpo}</div>${cierre(loTuyo(breve, reparto.menos, lengua), 1, hojas, `Faro · Informe de ${tituloVisto}`)}</section>`;
}
