// «Deshacer» vuelve a guardar la configuración anterior con la revisión que dejó el propio cambio: el servidor no guarda
// nada nuevo y rechaza el envío si otra sesión ha cambiado algo. Secciones y controles comparten revisión, así que
// cualquier cambio posterior de uno de los dos retira la oferta de deshacer el otro.
import { texto } from '../scripts/textos.js';
import { confirmarCambio, resumenCambioControles, resumenCambioSecciones } from './confirmacion-cambios.js';

/** @typedef {import('./cliente.js').EstadoClientePanel} EstadoClientePanel */
/** @typedef {Extract<EstadoClientePanel,{estado:'activa'}>} EstadoActivo */
/** @typedef {'controles'|'secciones'} TipoCambio */
/** @typedef {{tipo:TipoCambio,anterior:Record<string,unknown>,enviado:Record<string,unknown>,base:number,tras:number|null}} Pendiente */

export const PLAZO_DESHACER_MS = 300_000;

/** @param {EstadoActivo} estado @param {TipoCambio} tipo */
function revisionDe(estado, tipo) {
  return tipo === 'controles' ? estado.controles.revision : (estado.secciones?.revision ?? null);
}
/** @param {EstadoActivo} estado @param {TipoCambio} tipo @returns {Record<string,unknown>|null} */
function documentoDe(estado, tipo) {
  if (tipo === 'controles') {
    return { ...estado.controles };
  }
  return estado.seccionesPendientes ? null : (estado.secciones?.secciones ?? null);
}
/** Un cambio de la otra pieza posterior al propio: su revisión compartida ya ha pasado de la que dejó el nuestro.
 * @param {EstadoActivo} estado @param {Pendiente} p */
function otroCambioPosterior(estado, p) {
  const otra = revisionDe(estado, p.tipo === 'controles' ? 'secciones' : 'controles');
  return p.tras !== null && otra !== null && otra > p.tras;
}

/** @param {Record<string,unknown>|null} documento @param {Record<string,unknown>} enviado */
function esLoEnviado(documento, enviado) {
  return !!documento && Object.entries(enviado).every(([clave, valor]) => documento[clave] === valor);
}

class Deshacer {
  /** @type {Pendiente|null} */
  #pendiente = null;
  /** @type {EstadoClientePanel|null} */
  #ultimo = null;
  #temporizador = 0;
  #boton;
  #aviso;
  #aplicar;

  /** @param {{boton:HTMLButtonElement,aviso:HTMLElement,aplicar:(tipo:TipoCambio,politica:Record<string,unknown>)=>void}} piezas */
  constructor({ boton, aviso, aplicar }) {
    this.#boton = boton;
    this.#aviso = aviso;
    this.#aplicar = aplicar;
    // Sin un cambio propio confirmado no hay nada que deshacer.
    boton.hidden = true;
    boton.addEventListener('click', () => this.#pulsar());
  }
  #retirar(mensaje = '') {
    this.#pendiente = null;
    window.clearTimeout(this.#temporizador);
    this.#boton.hidden = true;
    this.#aviso.textContent = mensaje;
  }
  /** Solo se deshace si lo que se ve es exactamente lo que dejó el propio cambio. */
  #pulsar() {
    const p = this.#pendiente;
    const estado = this.#ultimo;
    if (!p || p.tras === null || estado?.estado !== 'activa' || estado.ocupado) {
      return;
    }
    if (revisionDe(estado, p.tipo) !== p.tras || otroCambioPosterior(estado, p)) {
      this.#retirar(texto('panel.deshacer.cambiado'));
      return;
    }
    const resumen =
      p.tipo === 'controles'
        ? resumenCambioControles(estado, /** @type {never} */ (p.anterior))
        : resumenCambioSecciones(estado.secciones?.secciones ?? {}, /** @type {Record<string,boolean>} */ (p.anterior));
    if (resumen === null || !confirmarCambio(resumen)) {
      return;
    }
    this.#retirar();
    this.#aplicar(p.tipo, p.anterior);
  }
  /** Tras aceptar el resumen de un guardado: lo confirmado antes, lo enviado y la revisión de partida.
   * @param {TipoCambio} tipo @param {Record<string,unknown>} anterior @param {Record<string,unknown>} enviado
   * @param {EstadoActivo} estado */
  preparar(tipo, anterior, enviado, estado) {
    this.#retirar();
    const base = revisionDe(estado, tipo);
    if (base === null) {
      return;
    }
    this.#pendiente = { tipo, anterior: { ...anterior }, enviado: { ...enviado }, base, tras: null };
    // Un único plazo, sin sondeo: pasado, la oferta se retira.
    this.#temporizador = window.setTimeout(() => this.#retirar(), PLAZO_DESHACER_MS);
  }
  /** La primera lectura con otra revisión: si muestra lo enviado, esa revisión es la del propio cambio; si no, el
   * cambio es ajeno y la oferta se retira. @param {EstadoActivo} estado @param {Pendiente} p */
  #anotar(estado, p) {
    const revision = revisionDe(estado, p.tipo);
    if (estado.ocupado || revision === null || revision === p.base) {
      return;
    }
    // Un conflicto dice que la revisión vino de otra sesión: aunque coincida con lo enviado, no es el propio cambio.
    if (estado.conflicto || !esLoEnviado(documentoDe(estado, p.tipo), p.enviado)) {
      this.#retirar();
      return;
    }
    p.tras = revision;
    this.#boton.hidden = false;
    this.#boton.disabled = false;
  }
  /** Cada estado publicado: anota la revisión que dejó el propio cambio y retira la oferta si algo la invalida.
   * @param {EstadoClientePanel} estado */
  observar(estado) {
    this.#ultimo = estado;
    const p = this.#pendiente;
    if (!p) {
      return;
    }
    if (estado.estado !== 'activa') {
      this.#retirar();
    } else if (p.tras === null) {
      this.#anotar(estado, p);
    } else if (revisionDe(estado, p.tipo) !== p.tras || otroCambioPosterior(estado, p)) {
      this.#retirar(texto('panel.deshacer.cambiado'));
    } else {
      this.#boton.disabled = estado.ocupado;
    }
  }
}

/** @param {{boton:HTMLButtonElement,aviso:HTMLElement,aplicar:(tipo:TipoCambio,politica:Record<string,unknown>)=>void}} piezas */
export function crearDeshacer(piezas) {
  return new Deshacer(piezas);
}
