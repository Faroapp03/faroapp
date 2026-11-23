// Textos y archivos del piloto que se generan en el navegador: nada se guarda ni se envía desde el panel.
import { texto } from '../scripts/textos.js';
import { PREGUNTAS_ENCUESTA, TIPOS_ENCUESTA } from './cliente-encuesta.js';
import { fechaAbsoluta } from './fechas-panel.js';

/** @typedef {import('./cliente-encuesta.js').ResultadosEncuesta} ResultadosEncuesta */
/** @typedef {import('./cliente-encuesta.js').CodigoEncuesta} CodigoEncuesta */
/** @typedef {import('./cliente-encuesta.js').TipoEncuesta} TipoEncuesta */

/** Clave del texto de cada pregunta: el mismo que lee la persona en la encuesta. */
export const CLAVE_PREGUNTA = Object.freeze({
  informe: 'encuesta.participante.informe',
  ocupacion: 'encuesta.participante.ocupacion',
  comprension: 'encuesta.participante.comprension',
  formacion: 'encuesta.participante.formacion',
  dificultad: 'encuesta.participante.dificultad',
  ayudaOrientacion: 'encuesta.profesional.ayuda-orientacion',
  explicarCambio: 'encuesta.profesional.explicar-cambio',
  encajeFormacion: 'encuesta.profesional.encaje-formacion',
  fiabilidad: 'encuesta.profesional.fiabilidad',
  mejora: 'encuesta.profesional.mejora',
});

/** @param {string} pregunta */
export function textoPregunta(pregunta) {
  const clave = /** @type {Record<string,string>} */ (CLAVE_PREGUNTA)[pregunta];
  return clave ? texto(clave) : pregunta;
}
/**
 * La opción tal como la lee la persona en la encuesta: un punto de la escala con su número y su nombre («4, Bastante»);
 * cualquier otra, con la frase de su pregunta, porque un mismo valor («sin_ver», «nada») se dice distinto en cada una.
 * @param {string} pregunta @param {string} valor
 */
export function textoValor(pregunta, valor) {
  if (/^[1-5]$/u.test(valor)) {
    return `${valor}, ${texto(`encuesta.escala.${valor}`)}`;
  }
  return texto(`${textoDeClave(pregunta)}.${valor.replaceAll('_', '-')}`);
}
/** @param {string} pregunta */
function textoDeClave(pregunta) {
  return /** @type {Record<string,string>} */ (CLAVE_PREGUNTA)[pregunta] ?? pregunta;
}

// Los porcentajes y las medias se redondean a un decimal y se escriben con coma, como en castellano y en catalán.
const DECIMAS = 10;
const POR_CIEN = 100;
/** El porcentaje de n sobre total, redondeado a un decimal; null sin base. @param {number} n @param {number} total */
export function porcentaje(n, total) {
  return total > 0 ? Math.round((n * POR_CIEN * DECIMAS) / total) / DECIMAS : null;
}
/** La media de una escala, redondeada a un decimal; null sin respuestas.
 * @param {import('./cliente-encuesta.js').EscalaPregunta} escala */
export function media(escala) {
  return escala.respuestas > 0 ? Math.round((escala.suma * DECIMAS) / escala.respuestas) / DECIMAS : null;
}
/** @param {number} cifra */
export function conUnDecimal(cifra) {
  return cifra.toFixed(1).replace('.', ',');
}
/** «valor: n de N (x %)» de una opción; sin base, sin porcentaje.
 * @param {string} pregunta @param {string} valor @param {import('./cliente-encuesta.js').RecuentoPregunta} dato */
export function lineaDeValor(pregunta, valor, dato) {
  const n = dato.valores[valor] ?? 0;
  const parte = porcentaje(n, dato.denominador);
  const datos = { valor: textoValor(pregunta, valor), n, total: dato.denominador };
  return parte === null
    ? texto('panel.piloto.recuento-sin-base', datos)
    : texto('panel.piloto.recuento', { ...datos, porcentaje: conUnDecimal(parte) });
}
/**
 * Las frases de los indicadores de una pregunta: la media de las escalas de las profesionales y la meta del piloto,
 * siempre con su numerador y su denominador. Las cifras salen tal cual del servidor.
 * @param {TipoEncuesta} tipo @param {import('./cliente-encuesta.js').RecuentoPregunta} dato @returns {string[]}
 */
export function lineasDeIndicadores(tipo, dato) {
  const t = (/** @type {string} */ clave, /** @type {Record<string,string|number>} */ valores) =>
    texto(`panel.piloto.${clave}`, valores);
  const lineas = [];
  const promedio = dato.escala ? media(dato.escala) : null;
  if (tipo === 'profesional' && dato.escala) {
    lineas.push(
      promedio === null
        ? t('media-sin-respuestas', {})
        : t('media', { media: conUnDecimal(promedio), n: dato.escala.respuestas }),
    );
  }
  const meta = dato.meta;
  if (meta?.criterio === 'media') {
    lineas.push(t('meta.media', { objetivo: meta.objetivo }));
  }
  if (meta?.criterio === 'proporcion') {
    const parte = porcentaje(meta.favorables, meta.base);
    const valores = { objetivo: meta.objetivo, favorables: meta.favorables, base: meta.base };
    lineas.push(
      parte === null
        ? t('meta.proporcion-sin-base', valores)
        : t('meta.proporcion', { ...valores, porcentaje: conUnDecimal(parte) }),
    );
    if (meta.fueraDeLaBase > 0) {
      lineas.push(t('meta.fuera', { n: meta.fueraDeLaBase, total: dato.denominador }));
    }
  }
  return lineas;
}
/** Direcciones completas, una por línea, con el origen del sitio delante.
 * @param {readonly CodigoEncuesta[]} codigos @param {string} origen */
export function enlacesCompletos(codigos, origen) {
  return codigos.map((c) => `${origen}${c.enlaceRelativo}`).join('\n');
}
/** Nombre de archivo a partir del nombre de la entidad o de la ronda, sin acentos ni signos que un sistema de archivos
 * rechace. @param {string} nombre @param {string} prefijo @param {'txt'|'csv'} [extension] */
export function nombreDeArchivo(nombre, prefijo, extension = 'txt') {
  const limpio = nombre
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return `${prefijo}-${limpio || 'entidad'}.${extension}`;
}
/** Texto listo para pegar en el correo a la entidad colaboradora.
 * @param {{nombre:string,tipo:TipoEncuesta,cantidad:number}} lote */
export function textoDelCorreo(lote) {
  return [
    texto('panel.piloto.correo.saludo', { nombre: lote.nombre }),
    texto(`panel.piloto.correo.${lote.tipo}`, { cantidad: lote.cantidad }),
    texto('panel.piloto.correo.anonimo'),
    texto('panel.piloto.correo.contrasena'),
    texto('panel.piloto.correo.enlaces'),
    texto('panel.piloto.correo.despedida'),
  ].join('\n\n');
}

// Punto y coma: el separador con el que una hoja de cálculo en español abre el archivo en columnas.
const SEPARADOR = ';';
// Plazo de respaldo de cinco minutos para retirar la dirección temporal de una descarga.
export const PLAZO_DESCARGA_MS = 300_000;
/** Un campo de CSV: entre comillas si lleva separador, comillas o saltos, y sin que una hoja de cálculo lo tome por
 * una fórmula. @param {string|number} valor */
function campo(valor) {
  let celda = String(valor);
  if (typeof valor === 'string' && /^[=+\-@\t\r]/u.test(celda)) {
    celda = `'${celda}`;
  }
  return /[";\n\r]/u.test(celda) ? `"${celda.replaceAll('"', '""')}"` : celda;
}
/** Una línea de CSV del panel: cada campo protegido y separado por punto y coma. @param {readonly (string|number)[]} valores */
export function lineaCsv(valores) {
  return valores.map(campo).join(SEPARADOR);
}
/** Un porcentaje con un decimal y coma, o vacío sin base. @param {number} n @param {number} total */
function campoPorcentaje(n, total) {
  const parte = porcentaje(n, total);
  return parte === null ? '' : conUnDecimal(parte);
}
/** Las filas de los indicadores de una pregunta: su media y su meta, con numerador, denominador y porcentaje.
 * @param {TipoEncuesta} tipo @param {string} pregunta @param {import('./cliente-encuesta.js').RecuentoPregunta} dato */
function filasDeIndicadores(tipo, pregunta, dato) {
  const t = (/** @type {string} */ clave, /** @type {Record<string,string|number>} */ valores = {}) =>
    `${textoPregunta(pregunta)} · ${texto(`panel.piloto.csv.${clave}`, valores)}`;
  const inicio = ['indicador', tipo, '', '', pregunta];
  /** @type {(string|number)[][]} */
  const filas = [];
  const promedio = dato.escala ? media(dato.escala) : null;
  if (tipo === 'profesional' && dato.escala) {
    const cifra = promedio === null ? '' : conUnDecimal(promedio);
    filas.push([...inicio, 'media', t('media'), dato.escala.suma, dato.escala.respuestas, '', cifra]);
  }
  const meta = dato.meta;
  if (meta?.criterio === 'media') {
    filas.push([...inicio, 'meta_media', t('meta-media', { objetivo: meta.objetivo }), '', '', '', meta.objetivo]);
  }
  if (meta?.criterio === 'proporcion') {
    const porcentajeMeta = campoPorcentaje(meta.favorables, meta.base);
    const frase = t('meta-proporcion', { objetivo: meta.objetivo });
    filas.push([...inicio, 'meta_favorables', frase, meta.favorables, meta.base, porcentajeMeta, '']);
    filas.push([...inicio, 'fuera_de_la_base', t('fuera'), meta.fueraDeLaBase, dato.denominador, '', '']);
  }
  return filas;
}
/** Las filas de un tipo de respuestas: cada opción con su recuento, su denominador y su porcentaje, y sus indicadores.
 * @param {TipoEncuesta} tipo @param {import('./cliente-encuesta.js').RecuentoTipo} recuento */
function filasDeTipo(tipo, recuento) {
  /** @type {(string|number)[][]} */
  const filas = [
    [
      'respuestas',
      tipo,
      '',
      '',
      'respuestas',
      '',
      texto('panel.piloto.csv.respuestas'),
      recuento.respuestas,
      '',
      '',
      '',
    ],
  ];
  for (const [pregunta, valores] of Object.entries(PREGUNTAS_ENCUESTA[tipo])) {
    const dato = recuento.preguntas[pregunta];
    if (!dato) {
      continue;
    }
    for (const valor of valores) {
      const n = dato.valores[valor] ?? 0;
      const textoOpcion = `${textoPregunta(pregunta)} · ${textoValor(pregunta, valor)}`;
      filas.push([
        'respuestas',
        tipo,
        '',
        '',
        pregunta,
        valor,
        textoOpcion,
        n,
        dato.denominador,
        campoPorcentaje(n, dato.denominador),
        '',
      ]);
    }
    filas.push(...filasDeIndicadores(tipo, pregunta, dato));
  }
  return filas;
}
/** Resultados para la memoria del piloto: las mismas cifras que la pantalla, con el cuestionario, la fecha de la
 * descarga y las invitaciones de cada lote. Cada porcentaje va junto a su numerador y su denominador. El BOM inicial
 * permite abrir el archivo con acentos en una hoja de cálculo.
 * @param {ResultadosEncuesta} resultados @param {number} ahora */
export function csvDeResultados(resultados, ahora) {
  const t = (/** @type {string} */ clave) => texto(`panel.piloto.csv.${clave}`);
  /** @type {(string|number)[][]} */
  const filas = [
    [
      'apartado',
      'tipo',
      'lote',
      'entidad',
      'pregunta',
      'valor',
      'texto',
      'recuento',
      'denominador',
      'porcentaje',
      'media',
    ],
    ['cuestionario', '', '', '', '', resultados.cuestionario, t('cuestionario'), '', '', '', ''],
    // Cada archivo es de una sola ronda: lo dice su primera fila de datos y su nombre.
    ['ronda', '', '', '', '', resultados.ronda.numero, resultados.ronda.nombre, '', '', '', ''],
    [
      'descarga',
      '',
      '',
      '',
      '',
      new Date(ahora).toISOString(),
      texto('panel.piloto.csv.fecha', { fecha: fechaAbsoluta(ahora) }),
      '',
      '',
      '',
      '',
    ],
  ];
  for (const lote of resultados.lotes) {
    const base = ['lote', lote.tipo, lote.numero, lote.nombre ?? ''];
    filas.push([...base, 'invitaciones_emitidas', '', t('emitidas'), lote.emitidos, '', '', '']);
    filas.push([...base, 'invitaciones_usadas', '', t('usadas'), lote.consumidos, lote.emitidos, '', '']);
  }
  for (const tipo of TIPOS_ENCUESTA) {
    const recuento = resultados.recuentos?.[tipo];
    if (recuento) {
      filas.push(...filasDeTipo(tipo, recuento));
    }
  }
  return `﻿${filas.map(lineaCsv).join('\r\n')}\r\n`;
}
/** Descarga un texto como archivo generado en el navegador y devuelve cómo retirar antes su dirección temporal.
 * @param {string} contenido @param {string} nombre @param {string} tipo */
export function descargar(contenido, nombre, tipo) {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const enlace = document.createElement('a');
  enlace.setAttribute('href', url);
  enlace.setAttribute('download', nombre);
  enlace.hidden = true;
  document.body.append(enlace);
  enlace.click();
  enlace.remove();
  // La dirección se retira una sola vez, con lo primero que llegue: salir de la página, quien llamó (por ejemplo, al
  // olvidar los enlaces) o el plazo de respaldo. Ocultar la página no basta: en Safari de iPhone la descarga empieza
  // cuando la persona confirma en la hoja del sistema, y cambiar antes de aplicación no debe cortarla.
  let retirada = false;
  /** @type {number} */
  let plazo = 0;
  const retirar = () => {
    if (retirada) {
      return;
    }
    retirada = true;
    window.clearTimeout(plazo);
    window.removeEventListener('pagehide', retirar);
    URL.revokeObjectURL(url);
  };
  plazo = window.setTimeout(retirar, PLAZO_DESCARGA_MS);
  window.addEventListener('pagehide', retirar);
  return retirar;
}
