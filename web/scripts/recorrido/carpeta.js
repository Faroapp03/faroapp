// Vista del chat mientras se prepara el informe en segundo plano y cuando se entrega: el pensamiento de Faro (sus
// pasos, con su ✓), la tarjeta del agente («La IA y tu trabajo», «Agente trabajando · calcula y cruza los datos»,
// y al terminar «✓ Terminado · N hojas», con N contado del HTML del informe) y «Tu carpeta», con los documentos como
// tarjetas. La tarjeta del agente está quieta mientras trabaja; al terminar, su estado cambia con un fundido corto.
// El informe nunca se pinta en el chat: «Leer» lo abre en su vista (#paso-4, documento-informe.js). La hoja de ruta
// tampoco: su documento se pinta escondido en #paso-4 (documento-hoja.js) y «Leer» lo abre en la misma vista. Cada
// documento se guarda en PDF por separado, y «Guardar los dos» los imprime seguidos (impresion.js).

import { crear } from '../dom.js';
import { escribir } from '../idioma.js';
import { traducible } from '../textos.js';
import { crearPensamientoEnCurso } from './conversacion.js';
import { irALaHoja } from './documento-hoja.js';
import { crearDocumentoDelInforme } from './documento-informe.js';
import { presentarDocumento } from './entrega-documentos.js';
import { formatearNumero } from './formato.js';
import { imprimir } from './impresion.js';

/** @import { Parte } from '../textos.js' */

/** Las tarjetas del agente que hay en el chat: todas cambian a la vez. @type {Set<HTMLElement>} */
const agentes = new Set();
/**
 * Las frases que acompañan a la tarjeta del agente: cambian a la vez que ella, para que el texto nunca la contradiga.
 * @type {Set<HTMLElement>}
 */
const frases = new Set();
/** En qué está el informe ahora: la tarjeta y la frase que se creen después ya nacen con este estado. */
let estadoDelAgente = /** @type {'trabajando' | 'hecho' | 'fallo'} */ ('trabajando');
/** Las hojas del informe terminado. */
let hojasDelAgente = 0;

/** Un elemento que se ve pero no se lee. @param {HTMLElement} elemento */
function soloVisible(elemento) {
  elemento.setAttribute('aria-hidden', 'true');
  return elemento;
}

/**
 * El pensamiento de Faro en el paso 4: sus pasos, cortos y con su ✓, plegado en cuanto está puesto
 * (crearPensamientoEnCurso, conversacion.js). Lo que viene detrás aparece cuando termina. Los detalles largos no se
 * dicen: el pensamiento enseña solo lo que hace Faro, en pocas palabras. Si empezó con el trabajo (`empezado`, de
 * empezarAPensar), se termina ese mismo.
 * @param {{ texto: Parte, detalle?: Parte }[]} pasos @param {{ empezado?: HTMLElement | null }} [opciones]
 * @returns {HTMLElement}
 */
export function crearPensamiento(pasos, opciones = {}) {
  return crearPensamientoEnCurso(
    pasos.map(({ texto }) => texto),
    opciones,
  );
}

/** El icono de documento de la tarjeta del agente: un dibujo, sin texto. */
function iconoDeDocumento() {
  return soloVisible(crear('span', { className: 'rc-agente-icono', textContent: 'A4' }));
}

/**
 * La tarjeta del agente que prepara el informe, en su estado actual. `role="status"`: el cambio a «Terminado» se
 * anuncia una vez, sin mover el foco.
 * @returns {HTMLElement}
 */
export function crearTarjetaDelAgente() {
  const estado = escribir(crear('small', { className: 'rc-agente-estado' }), traducible('recorrido.agente.trabajando'));
  estado.setAttribute('role', 'status');
  const tarjeta = crear(
    'div',
    { className: 'rc-agente' },
    iconoDeDocumento(),
    crear(
      'span',
      { className: 'rc-agente-datos' },
      escribir(crear('strong'), traducible('recorrido.agente.titulo')),
      estado,
    ),
  );
  agentes.add(tarjeta);
  pintarTarjeta(tarjeta);
  return tarjeta;
}

/**
 * La frase de Faro sobre el informe, encima de su tarjeta: mientras se prepara, que lo prepara un agente de IA de
 * Faro; terminado, que ya está listo; con un fallo, que no se ha podido terminar.
 * @returns {HTMLElement}
 */
export function crearFraseDelAgente() {
  const frase = crear('p');
  frases.add(frase);
  pintarFrase(frase);
  return frase;
}

/** El texto de la tarjeta en el estado actual. @returns {Parte} */
function textoDeLaTarjeta() {
  if (estadoDelAgente === 'hecho') {
    return hojasDelAgente === 1
      ? traducible('recorrido.agente.terminado-una')
      : traducible('recorrido.agente.terminado', { numero: formatearNumero(hojasDelAgente) });
  }
  return traducible(estadoDelAgente === 'fallo' ? 'recorrido.agente.fallo' : 'recorrido.agente.trabajando');
}

/** Pinta una tarjeta del agente con el estado actual. @param {HTMLElement} tarjeta */
function pintarTarjeta(tarjeta) {
  tarjeta.dataset.estado = estadoDelAgente;
  const linea = tarjeta.querySelector('.rc-agente-estado');
  if (linea) {
    escribir(/** @type {HTMLElement} */ (linea), textoDeLaTarjeta());
  }
}

/** Pinta una frase del agente con el estado actual. @param {HTMLElement} frase */
function pintarFrase(frase) {
  /** @type {Record<typeof estadoDelAgente, string>} */
  const claves = {
    trabajando: 'recorrido.agente.preparando',
    hecho: 'recorrido.agente.listo',
    fallo: 'recorrido.agente.sin-terminar',
  };
  escribir(frase, traducible(claves[estadoDelAgente]));
}

/**
 * Cambia todas las tarjetas del agente y sus frases: trabajando, terminado (con sus hojas) o con un fallo.
 * @param {'trabajando' | 'hecho' | 'fallo'} estado @param {number} [hojas] @returns {void}
 */
export function marcarAgente(estado, hojas = 0) {
  estadoDelAgente = estado;
  hojasDelAgente = hojas;
  for (const tarjeta of agentes) {
    pintarTarjeta(tarjeta);
  }
  for (const frase of frases) {
    pintarFrase(frase);
  }
}

/** Olvida las tarjetas del agente: se usa al encargar otro informe o al borrar la conversación. */
export function olvidarAgentes() {
  agentes.clear();
  frases.clear();
  estadoDelAgente = 'trabajando';
  hojasDelAgente = 0;
}

/**
 * «Leer la hoja de ruta», que abre su documento en la vista del paso 4, y «Guardar en PDF o imprimir», que imprime
 * solo la hoja.
 */
function accionesDeLaHoja() {
  const leer = escribir(
    crear('a', { className: 'rc-boton-principal', href: '#paso-4' }),
    traducible('recorrido.carpeta.hoja-leer'),
  );
  leer.addEventListener('click', (evento) => {
    evento.preventDefault();
    irALaHoja();
  });
  const guardar = escribir(
    crear('button', { type: 'button', className: 'rc-boton-secundario' }),
    traducible('recorrido.documento.imprimir'),
  );
  guardar.addEventListener('click', () => imprimir('hoja'));
  return crear('div', { className: 'rc-doc-acciones' }, leer, guardar);
}

/**
 * La tarjeta de la hoja de ruta: su lugar, el plan y sus cursos y, con su documento pintado (`lista`), «Leer» y
 * «Guardar en PDF o imprimir». Sin documento, dice que no se ha podido preparar (Faro lo cuenta en el chat).
 * @param {number} cursos de 0 a 2 @param {boolean} lista @returns {HTMLElement}
 */
export function crearTarjetaDeLaHoja(cursos, lista) {
  const icono = soloVisible(crear('span', { className: 'rc-doc-icono', textContent: 'A4' }));
  // Sin cursos la hoja es una sola página con recursos para seguir aprendiendo; con uno o dos, son dos páginas.
  const hojas =
    cursos === 0
      ? traducible('recorrido.documento.hoja')
      : traducible('recorrido.documento.hojas', { numero: formatearNumero(2) });
  const contenido = ['formacion.carpeta.sin-cursos', 'recorrido.carpeta.hoja-un-curso'][cursos];
  const detalle = crear(
    'span',
    {},
    escribir(crear('span'), hojas),
    document.createTextNode(' · '),
    escribir(crear('span'), traducible(contenido ?? 'recorrido.carpeta.hoja-dos-cursos')),
  );
  const cabeza = crear(
    'div',
    { className: 'rc-doc-cabeza' },
    icono,
    crear('div', {}, escribir(crear('strong'), traducible('recorrido.carpeta.hoja-titulo')), detalle),
  );
  const tarjeta = crear('div', { className: 'rc-documento rc-documento-hoja' }, cabeza);
  if (lista) {
    tarjeta.append(accionesDeLaHoja());
  } else {
    tarjeta.append(
      escribir(crear('p', { className: 'rc-carpeta-pendiente' }), traducible('recorrido.carpeta.hoja-sin-documento')),
    );
  }
  return presentarDocumento(tarjeta, 'plan');
}

/** «Guardar los dos»: el informe y la hoja de ruta, seguidos, cada uno desde una página nueva. */
function guardarLosDos() {
  const boton = escribir(
    crear('button', { type: 'button', className: 'rc-boton-secundario rc-carpeta-los-dos' }),
    traducible('recorrido.carpeta.guardar-los-dos'),
  );
  boton.addEventListener('click', () => imprimir('los-dos'));
  return boton;
}

/**
 * «Tu carpeta»: el informe (con «Leer» y «Guardar en PDF») y, si la persona ha confirmado su hoja de ruta, la tarjeta
 * de la hoja con sus cursos y, si su documento está pintado (`hojaLista`), «Leer», «Guardar en PDF» y «Guardar los
 * dos». Si no la ha hecho, «Preparar mi hoja de ruta» para más tarde.
 * @param {{ ocupacion: Parte | null, cursos: number | null, hojaLista?: boolean, alPrepararHoja: () => void }}
 * contenido
 * @returns {HTMLElement}
 */
export function crearCarpeta({ ocupacion, cursos, hojaLista = false, alPrepararHoja }) {
  const informe = crearDocumentoDelInforme(ocupacion);
  const carpeta = crear(
    'div',
    { className: 'rc-carpeta' },
    escribir(crear('h3', { className: 'rc-carpeta-titulo' }), traducible('recorrido.carpeta.titulo')),
  );
  if (informe) {
    carpeta.append(presentarDocumento(informe, 'informe'));
  }
  if (cursos !== null) {
    carpeta.append(crearTarjetaDeLaHoja(cursos, hojaLista));
    if (informe && hojaLista) {
      carpeta.append(guardarLosDos());
    }
  } else {
    const preparar = escribir(
      crear('button', { type: 'button', className: 'rc-boton-secundario rc-carpeta-preparar' }),
      traducible('recorrido.hoja.preparar'),
    );
    preparar.addEventListener('click', alPrepararHoja);
    carpeta.append(preparar);
  }
  return carpeta;
}
