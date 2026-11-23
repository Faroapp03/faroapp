/** Datos de una oferta en frases legibles para la elección y para la hoja. Solo cuenta lo que el catálogo conoce:
 * un hecho sin valor se dice «no consta» y un límite publicado nunca se presenta como fecha de matrícula. */

import { describirIdiomas, idiomaSegunLaNorma, origenBreve } from '../../catalogo-cursos/descripcion-idioma.js';
import { diaDeCursoEnFrase, fechaDeCursoEnFrase } from '../../catalogo-cursos/fechas-de-curso.js';
import { cifraHasta, importe as importeEscrito } from '../../cifras.js';
import { crear } from '../../dom.js';
import { nombreDelIdioma } from '../../fechas.js';
import { textoDocumento } from './textos-documento.js';

/** Hasta tres decimales, los mismos que escribía Intl por omisión para los importes y las horas publicados. */
const DECIMALES_DE_INTL = 3;
/** @import { OpcionPlan, IdiomaPlan } from './contrato.js' */
/** @import { HechoCatalogo } from '../../../../src/catalogo-cursos/contrato.ts' */
const ROTULOS = {
  es: {
    imparte: 'Lo imparte',
    modalidad: 'Modalidad',
    ritmo: 'Ritmo',
    idioma: 'Idioma',
    duracion: 'Duración',
    certificado: 'Certificado',
    noConsta: 'No consta',
    porConfirmar: 'por confirmar',
    registroPorConfirmar:
      'No consta si este curso pide registrarse. Lo verás en su ficha oficial antes de inscribirte.',
    idiomaPorConfirmar:
      'No consta en qué idioma se imparte este curso. Confírmalo en su ficha oficial antes de inscribirte.',
    modalidadPorConfirmar:
      'No consta si este curso es en línea o presencial. Confírmalo en su ficha oficial antes de inscribirte.',
    horas: 'h publicadas',
    minutos: 'min publicados',
    cursoEn: 'Curso en',
    y: 'y',
    modalidades: { 'en-linea': 'En línea', presencial: 'Presencial', mixta: 'Mixta' },
    ritmos: { asincrona: 'A tu ritmo', sincrona: 'Con sesiones a horas fijas', mixta: 'Mixto' },
    limite: 'El proveedor indica que la oferta está publicada {fecha}.',
    comprobada: 'Faro comprobó la oferta {fecha}.',
  },
  ca: {
    imparte: 'L’imparteix',
    modalidad: 'Modalitat',
    ritmo: 'Ritme',
    idioma: 'Idioma',
    duracion: 'Durada',
    certificado: 'Certificat',
    noConsta: 'No consta',
    porConfirmar: 'per confirmar',
    registroPorConfirmar:
      'No consta si aquest curs demana registrar-se. Ho veuràs a la seva fitxa oficial abans d’inscriure’t.',
    idiomaPorConfirmar:
      'No consta en quin idioma s’imparteix aquest curs. Confirma-ho a la seva fitxa oficial abans d’inscriure’t.',
    modalidadPorConfirmar:
      'No consta si aquest curs és en línia o presencial. Confirma-ho a la seva fitxa oficial abans d’inscriure’t.',
    horas: 'h publicades',
    minutos: 'min publicats',
    cursoEn: 'Curs en',
    y: 'i',
    modalidades: { 'en-linea': 'En línia', presencial: 'Presencial', mixta: 'Mixta' },
    ritmos: { asincrona: 'Al teu ritme', sincrona: 'Amb sessions a hores fixes', mixta: 'Mixt' },
    limite: 'El proveïdor indica que l’oferta està publicada {fecha}.',
    comprobada: 'Faro va comprovar l’oferta {fecha}.',
  },
};
/** @param {HechoCatalogo} hecho */
function conocido(hecho) {
  return hecho.motivo === 'conocido' ? hecho.valor : null;
}
// Los proveedores declaran el idioma con un código o con su nombre; solo estos se reconocen como idioma.
const NOMBRES_DE_IDIOMA = {
  espanol: 'es',
  castellano: 'es',
  castella: 'es',
  spanish: 'es',
  catala: 'ca',
  catalan: 'ca',
  ingles: 'en',
  angles: 'en',
  english: 'en',
};
/** El código BCP 47 de una declaración, o null si no es un idioma reconocible (se muestra tal cual).
 * @param {string} declarado @returns {string|null} */
function codigoDeIdioma(declarado) {
  const nombre = declarado.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  if (Object.hasOwn(NOMBRES_DE_IDIOMA, nombre)) {
    return NOMBRES_DE_IDIOMA[/** @type {keyof typeof NOMBRES_DE_IDIOMA} */ (nombre)];
  }
  return /^([a-z]{2,3})(?:[-_][a-z0-9]{2,8})*$/u.exec(nombre)?.[1] ?? null;
}
/** Los idiomas que el motor decidió para la oferta, los mismos que enseña Cursos; null si no constan.
 * @param {OpcionPlan} opcion @returns {string[]|null} */
function idiomasDeclarados(opcion) {
  const declarados = opcion.idioma.idiomas.filter((idioma) => idioma !== 'no-indicado' && idioma.trim().length > 0);
  return declarados.length ? declarados : null;
}
/** El idioma del título solo se marca cuando el curso declara uno; con varios no se puede saber cuál es.
 * @param {OpcionPlan} opcion @returns {string|null} */
export function idiomaDelTitulo(opcion) {
  const idiomas = idiomasDeclarados(opcion);
  return idiomas?.length === 1 ? codigoDeIdioma(idiomas[0] ?? '') : null;
}
/** El título oficial no se traduce: si el curso declara un solo idioma, se marca para que se lea en esa lengua.
 * @param {OpcionPlan} opcion @returns {HTMLSpanElement} */
export function tituloDelCurso(opcion) {
  const titulo = crear('span', { textContent: opcion.oferta.titulo_programa });
  const idioma = idiomaDelTitulo(opcion);
  if (idioma) {
    titulo.lang = idioma;
  }
  return titulo;
}
/** El nombre de un idioma (código BCP 47) en la lengua de la hoja, en minúscula como en una frase.
 * @param {string} codigo @param {IdiomaPlan} idioma */
export function nombreDeIdioma(codigo, idioma) {
  return nombreDelIdioma(codigo, idioma);
}
/** El nombre como rótulo, con mayúscula inicial («Castellano»).
 * @param {string} codigo @param {IdiomaPlan} idioma */
export function rotuloDeIdioma(codigo, idioma) {
  const nombre = nombreDeIdioma(codigo, idioma);
  return `${nombre.charAt(0).toLocaleUpperCase(idioma)}${nombre.slice(1)}`;
}
/** @param {readonly string[]} declarados @param {IdiomaPlan} idioma */
function nombresDeIdiomas(declarados, idioma) {
  const lista = declarados.map((declarado) => {
    const codigo = codigoDeIdioma(declarado);
    return codigo ? nombreDeIdioma(codigo, idioma) : declarado;
  });
  const ultimo = lista.pop();
  return lista.length ? `${lista.join(', ')} ${ROTULOS[idioma].y} ${ultimo}` : (ultimo ?? '');
}
/** «Curso en catalán» cuando el curso no se ofrece en la lengua de la hoja; null si coincide o no consta.
 * @param {OpcionPlan} opcion @param {IdiomaPlan} idioma @returns {string|null} */
export function etiquetaDeIdioma(opcion, idioma) {
  const idiomas = idiomasDeclarados(opcion);
  if (!idiomas || idiomas.some((declarado) => codigoDeIdioma(declarado) === idioma)) {
    return null;
  }
  return `${ROTULOS[idioma].cursoEn} ${nombresDeIdiomas(idiomas, idioma)}`;
}
/** @param {HechoCatalogo} hecho @param {IdiomaPlan} idioma */
function importe(hecho, idioma) {
  const valor = conocido(hecho);
  if (typeof valor !== 'number') {
    return textoDocumento(idioma, 'noConsta');
  }
  return importeEscrito(valor, hecho.moneda ?? null);
}
/** La cifra específica prevalece; una condición general no se transforma en un precio individual de cero.
 * @param {OpcionPlan} opcion @param {IdiomaPlan} idioma */
function costeCertificado(opcion, idioma) {
  const { coste_certificado: coste, certificado_gratuito: gratuito } = opcion.oferta.hechos;
  if (typeof conocido(coste) === 'number') {
    const cifra = importe(coste, idioma);
    if (coste.alcance === 'declaracion_general') {
      return `${cifra} (${textoDocumento(idioma, 'condicionesGenerales')})`;
    }
    if (coste.alcance === 'material_observado') {
      return `${cifra} (${textoDocumento(idioma, 'materialObservado')})`;
    }
    return cifra;
  }
  if (conocido(gratuito) !== true) {
    return textoDocumento(idioma, 'noConsta');
  }
  if (gratuito.alcance === 'declaracion_general') {
    return textoDocumento(idioma, 'certificadoGeneral');
  }
  return textoDocumento(idioma, gratuito.alcance === 'material_observado' ? 'certificadoMaterial' : 'certificadoFicha');
}
/** @param {OpcionPlan} opcion @param {IdiomaPlan} idioma */
function modalidad(opcion, idioma) {
  const r = ROTULOS[idioma];
  const valor = conocido(opcion.oferta.hechos.modalidad);
  if (typeof valor === 'string' && Object.hasOwn(r.modalidades, valor)) {
    return r.modalidades[/** @type {keyof typeof r.modalidades} */ (valor)];
  }
  return opcion.porConfirmar.includes('modalidad') ? r.porConfirmar : r.noConsta;
}
/** @param {OpcionPlan} opcion @param {IdiomaPlan} idioma */
function ritmo(opcion, idioma) {
  const r = ROTULOS[idioma];
  const valor = conocido(opcion.oferta.hechos.sincronia);
  return typeof valor === 'string' && Object.hasOwn(r.ritmos, valor)
    ? r.ritmos[/** @type {keyof typeof r.ritmos} */ (valor)]
    : r.noConsta;
}
/** @param {OpcionPlan} opcion @param {IdiomaPlan} idioma */
function duracion(opcion, idioma) {
  const valor = conocido(opcion.oferta.hechos.horas_publicadas);
  return duracionPublicada(typeof valor === 'number' ? valor : null, idioma) ?? ROTULOS[idioma].noConsta;
}
/** La duración publicada en horas, o en minutos si no llega a una hora; null si no consta o no llega a un minuto,
 * porque «0 h» o «0 min» darían a entender que el curso no dura nada.
 * @param {number|null} horas @param {IdiomaPlan} idioma @returns {string|null} */
export function duracionPublicada(horas, idioma) {
  if (horas === null || !Number.isFinite(horas) || horas <= 0) {
    return null;
  }
  if (horas < 1) {
    const minutos = Math.round(horas * 60);
    return minutos > 0 ? `${minutos} ${ROTULOS[idioma].minutos}` : null;
  }
  return `${cifraHasta(horas, DECIMALES_DE_INTL)} ${ROTULOS[idioma].horas}`;
}
/** El idioma y, si no lo publica el propio curso, de dónde sale, con las mismas palabras que la lista de Cursos.
 * @param {OpcionPlan} opcion @param {IdiomaPlan} idioma */
function idiomaLegible(opcion, idioma) {
  if (opcion.idioma.origen === null) {
    return ROTULOS[idioma].porConfirmar;
  }
  const idiomas = idiomasDeclarados(opcion);
  if (!idiomas) {
    return ROTULOS[idioma].noConsta;
  }
  const { origen } = opcion.idioma;
  // En minúscula, como dentro de una frase: «Idioma: castellano», igual que en «Lo que nos dijiste».
  const valor = origen === 'norma-general' ? idiomaSegunLaNorma(idioma) : nombresDeIdiomas(idiomas, idioma);
  const procedencia = origenBreve(origen, idioma);
  return procedencia ? `${valor} (${procedencia})` : valor;
}
/** Resumen de una línea para la fila compacta de la elección: quién, cuánto, cómo y en qué idioma.
 * @param {OpcionPlan} opcion @param {IdiomaPlan} idioma */
export function resumenDeOferta(opcion, idioma) {
  const r = ROTULOS[idioma];
  return [
    opcion.proveedor,
    `${r.duracion}: ${duracion(opcion, idioma)}`,
    `${r.modalidad}: ${modalidad(opcion, idioma)}`,
    `${r.idioma}: ${idiomaLegible(opcion, idioma)}`,
  ].join(' · ');
}
/** Los datos de la ficha en líneas «rótulo: valor», agrupadas para que la ficha impresa no crezca.
 * @param {OpcionPlan} opcion @param {IdiomaPlan} idioma @returns {string[]} */
export function lineasDeLaFicha(opcion, idioma) {
  const r = ROTULOS[idioma];
  return [
    `${r.imparte}: ${opcion.proveedor}`,
    `${r.modalidad}: ${modalidad(opcion, idioma)} · ${r.ritmo}: ${ritmo(opcion, idioma)}`,
    `${r.idioma}: ${idiomaLegible(opcion, idioma)} · ${r.duracion}: ${duracion(opcion, idioma)}`,
    `${r.certificado}: ${costeCertificado(opcion, idioma)}`,
  ];
}
/** Lo que no consta de la oferta, en frases: el curso se propone igualmente y la persona lo confirma en su ficha.
 * Una orientación de Faro se explica con las mismas palabras que en Cursos.
 * @param {OpcionPlan} opcion @param {IdiomaPlan} idioma @returns {string[]} */
export function avisosPorConfirmar(opcion, idioma) {
  const r = ROTULOS[idioma];
  return opcion.porConfirmar.map((dato) => {
    if (dato === 'registro_previo') {
      return r.registroPorConfirmar;
    }
    if (dato === 'modalidad') {
      return r.modalidadPorConfirmar;
    }
    const { idiomas, origen } = opcion.idioma;
    return origen === null ? r.idiomaPorConfirmar : describirIdiomas(idiomas, origen, idioma).nota;
  });
}
/** El límite es la fecha hasta la que el proveedor publica la oferta, no un plazo de matrícula.
 * @param {OpcionPlan} opcion @param {IdiomaPlan} idioma @returns {string|null} */
export function textoDelLimite(opcion, idioma) {
  const limite = opcion.oferta.cierra_el;
  if (!limite) {
    return null;
  }
  return ROTULOS[idioma].limite.replace('{fecha}', fechaDeCursoEnFrase(limite, idioma, 'hasta'));
}
/** @param {OpcionPlan} opcion @param {IdiomaPlan} idioma */
export function textoDeComprobacion(opcion, idioma) {
  const comprobado = opcion.oferta.comprobado_el;
  return ROTULOS[idioma].comprobada.replace('{fecha}', diaDeCursoEnFrase(comprobado, idioma, 'el'));
}
