// Enganche de la sesión única con el panel: bienvenida al entrar, apertura con su transición de una vez, la sesión en la
// barra superior con «Cerrar sesión», el aviso de cierre y la vuelta a la bienvenida diciendo qué ha pasado.
// Retomar la sesión propia de otro dispositivo solo sale del botón «Cerrar aquella y abrirla aquí»; al recargar esta
// misma pestaña, la sesión que se abrió en ella se retoma sin preguntar.
import { texto } from '../scripts/textos.js';
import { leerBienvenida, leerRegistro } from './contrato-sesion-unica.js';
import { pintarSinPermiso } from './vista-administradores.js';
import {
  AVISO_CIERRE_MS,
  anadirIdApertura,
  avisoDeFin,
  mostrarApertura,
  pintarBanda,
  pintarBienvenida,
  pintarRegistro,
} from './vista-sesion-unica.js';

/** @typedef {import('./cliente.js').EstadoClientePanel} EstadoClientePanel */
/** @typedef {import('./contrato-sesion-unica.js').BienvenidaPanel} BienvenidaPanel */
/** @typedef {import('./contrato-sesion-unica.js').FilaRegistroPanel} FilaRegistroPanel */
/**
 * @typedef {object} PiezasSesion
 * @property {() => Pick<ReturnType<typeof import('./cliente.js').crearClientePanel>, 'leerSesionUnica'|'mantener'|'cerrar'>} cliente
 * @property {(retomar: boolean) => void} abrir
 * @property {{ bienvenida: HTMLElement, barra: HTMLElement, armazon: HTMLElement, registro: HTMLElement }} destinos
 * @property {(filas: readonly FilaRegistroPanel[] | null) => void} alRegistro
 * @property {() => void} alEntrar
 */

/** La transición de apertura dura menos de un segundo y medio y ocurre una sola vez. */
const APERTURA_MS = 1400;
const INACTIVAS_CON_FIN = new Set(['cerrada', 'caducada', 'sustituida']);
/** Rechazos de la bienvenida que no se arreglan reintentando: en su lugar se explica por qué no se puede entrar. */
const SIN_PERMISO = new Set(['no_es_administrador', 'segundo_factor_requerido']);
/**
 * Marca de la sesión abierta en esta pestaña: su identificador visible (S-…), nunca el token. Va en el almacenamiento
 * de la pestaña porque la entrada de Access (idEntrada) la comparten todas las pestañas del mismo navegador: con ella
 * sola, abrir el panel en otra pestaña quitaría la sesión a la primera sin preguntar.
 */
const MARCA_PESTANA = 'faro-panel-sesion-de-esta-pestana';

/** @returns {Storage|null} El almacenamiento de la pestaña, o null si el navegador lo bloquea (entonces no hay marca). */
function almacenDePestana() {
  try {
    return window.sessionStorage ?? null;
  } catch {
    return null;
  }
}
/** @param {string|null} idSesion */
function anotarMarca(idSesion) {
  const almacen = almacenDePestana();
  if (idSesion === null) {
    almacen?.removeItem(MARCA_PESTANA);
  } else {
    almacen?.setItem(MARCA_PESTANA, idSesion);
  }
}
/** @param {unknown} error @returns {string|null} */
function avisoDe(error) {
  return error !== null && typeof error === 'object' && 'aviso' in error && typeof error.aviso === 'string'
    ? error.aviso
    : null;
}

/** Qué ha pasado al salir de una sesión abierta. @param {EstadoClientePanel} estado @param {number} limite @param {number} ahora */
function finDeSesion(estado, limite, ahora) {
  if (estado.estado === 'caducada') {
    return ahora >= limite ? 'duracion' : 'inactividad';
  }
  return estado.estado === 'sustituida' ? 'sustituida' : 'cerrada';
}
/** @param {unknown} error */
function textoDeFallo(error) {
  return texto(
    avisoDe(error) === 'correo_no_verificado' ? 'panel.sesion-unica.sin-correo' : 'panel.sesion-unica.sin-bienvenida',
  );
}

class SesionPanel {
  /** @param {PiezasSesion} piezas */
  constructor(piezas) {
    this.piezas = piezas;
    this.reducido = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    /** @type {BienvenidaPanel | null} */
    this.bienvenida = null;
    /** @type {string | null} */
    this.avisoBienvenida = null;
    /** @type {string | null} */
    this.idSesion = null;
    this.abierta = false;
    this.limite = 0;
    this.firmaBanda = '';
    /** @type {string | null} */
    this.falloBienvenida = null;
    /** @type {string | null} Por qué esta persona no puede usar el panel, si el servidor lo ha dicho. */
    this.sinPermiso = null;
    /** Retomar al recargar se decide una sola vez, con la primera bienvenida de la página. */
    this.recargaAtendida = false;
  }
  /** Lee quién ha entrado y si el panel está libre; un fallo se dice con qué hacer, sin botón que no sirva. */
  async consultarBienvenida() {
    try {
      this.bienvenida = leerBienvenida(await this.piezas.cliente().leerSesionUnica('sesion/bienvenida'));
      this.falloBienvenida = null;
      this.sinPermiso = null;
    } catch (error) {
      this.bienvenida = null;
      this.falloBienvenida = textoDeFallo(error);
      const aviso = avisoDe(error);
      this.sinPermiso = aviso !== null && SIN_PERMISO.has(aviso) ? aviso : null;
    }
    const propia = this.bienvenida?.ocupacion?.propia ? this.bienvenida.ocupacion.idSesion : null;
    if (this.abierta) {
      this.idSesion = propia ?? this.idSesion;
      anotarMarca(this.idSesion);
      this.firmaBanda = '';
      return;
    }
    this.alternar(false);
    this.pintarBienvenida();
    if (this.esRecargaDeEstaPestana()) {
      this.piezas.abrir(true);
    }
  }
  /**
   * La sesión abierta es la de esta pestaña si es propia, de la misma entrada de Access y lleva la marca que dejó al
   * abrirse aquí. Solo cuenta la primera bienvenida: si retomar falla, la decisión vuelve al botón.
   */
  esRecargaDeEstaPestana() {
    const primera = !this.recargaAtendida;
    this.recargaAtendida = true;
    const ocupacion = this.bienvenida?.ocupacion;
    return (
      primera &&
      ocupacion?.propia === true &&
      ocupacion.idEntrada === this.bienvenida?.idEntrada &&
      ocupacion.idSesion !== null &&
      ocupacion.idSesion === almacenDePestana()?.getItem(MARCA_PESTANA)
    );
  }
  pintarBienvenida() {
    const { bienvenida: destino } = this.piezas.destinos;
    if (this.sinPermiso !== null) {
      pintarSinPermiso(destino, { error: this.sinPermiso });
      return;
    }
    if (this.bienvenida === null) {
      const nota = document.createElement('p');
      nota.className = 'sesion-unica-aviso';
      nota.setAttribute('role', 'status');
      nota.textContent = this.falloBienvenida ?? texto('panel.sesion-unica.consultando');
      destino.replaceChildren(nota);
      return;
    }
    const { accion } = pintarBienvenida(destino, this.bienvenida, this.avisoBienvenida);
    accion?.addEventListener('click', () => {
      this.avisoBienvenida = null;
      this.piezas.abrir(accion.getAttribute('data-accion') === 'retomar');
    });
  }
  /** @param {boolean} enPanel */
  alternar(enPanel) {
    const { bienvenida, armazon, barra } = this.piezas.destinos;
    bienvenida.hidden = enPanel;
    armazon.hidden = !enPanel;
    if (!enPanel) {
      barra.replaceChildren();
      this.firmaBanda = '';
    }
  }
  /** @param {Extract<EstadoClientePanel,{estado:'activa'}>} estado */
  entrar(estado) {
    this.abierta = true;
    this.limite = estado.sesion.caducaAbsolutaEn;
    const confirmacion = this.reducido ? null : mostrarApertura(this.piezas.destinos.bienvenida, false);
    // El identificador de la sesión recién abierta llega con la bienvenida; se añade a la marca sin volver a dibujarla.
    void this.consultarBienvenida().then(() => {
      if (confirmacion !== null && this.idSesion !== null) {
        anadirIdApertura(confirmacion, this.idSesion);
      }
    });
    if (confirmacion === null) {
      this.mostrarPanel();
      return;
    }
    window.setTimeout(() => this.mostrarPanel(), APERTURA_MS);
  }
  mostrarPanel() {
    if (!this.abierta) {
      return;
    }
    this.alternar(true);
    this.piezas.alEntrar();
    void this.consultarRegistro();
  }
  /** @param {EstadoClientePanel} estado */
  salir(estado) {
    this.abierta = false;
    this.idSesion = null;
    anotarMarca(null);
    this.avisoBienvenida = INACTIVAS_CON_FIN.has(estado.estado)
      ? avisoDeFin(finDeSesion(estado, this.limite, Date.now()), Date.now())
      : null;
    this.alternar(false);
    void this.consultarBienvenida();
  }
  /** @param {Extract<EstadoClientePanel,{estado:'activa'}>} estado */
  pintarBanda(estado) {
    if (this.idSesion === null || this.bienvenida === null) {
      return;
    }
    const datos = { ...this.bienvenida, idSesion: this.idSesion, sesion: estado.sesion };
    const ahora = Date.now();
    const avisar = ahora >= estado.sesion.caducaPorInactividadEn - AVISO_CIERRE_MS;
    const firma = JSON.stringify([this.idSesion, estado.sesion, avisar]);
    if (firma === this.firmaBanda) {
      return;
    }
    this.firmaBanda = firma;
    const { cerrar, seguir } = pintarBanda(this.piezas.destinos.barra, datos, ahora);
    cerrar.addEventListener('click', () => void this.piezas.cliente().cerrar());
    seguir?.addEventListener('click', () => void this.piezas.cliente().mantener());
  }
  /** @param {EstadoClientePanel} estado */
  mostrar(estado) {
    if (estado.estado === 'activa') {
      if (!this.abierta) {
        this.entrar(estado);
      }
      this.limite = estado.sesion.caducaAbsolutaEn;
      this.pintarBanda(estado);
      return;
    }
    if (this.abierta && estado.estado !== 'desconectada' && estado.estado !== 'cargando') {
      this.salir(estado);
    } else if (!this.abierta && estado.estado === 'error' && estado.aviso === 'panel_ocupado') {
      // Otra persona la abrió mientras tanto: la bienvenida vuelve a leerse y dice quién la tiene.
      void this.consultarBienvenida();
    }
  }
  /** El registro se lee al entrar y al pedirlo; nunca se repite solo. */
  async consultarRegistro() {
    const { registro } = this.piezas.destinos;
    try {
      const filas = leerRegistro(await this.piezas.cliente().leerSesionUnica('sesion/registro'));
      pintarRegistro(registro, filas);
      this.piezas.alRegistro(filas);
    } catch {
      const nota = document.createElement('p');
      nota.className = 'sesion-unica-registro-vacio';
      nota.textContent = texto('panel.sesion-unica.registro.no-leido');
      registro.replaceChildren(nota);
      this.piezas.alRegistro(null);
    }
  }
  traducir() {
    this.firmaBanda = '';
    if (!this.abierta) {
      this.pintarBienvenida();
    }
  }
}

/** @param {PiezasSesion} piezas */
export function crearSesionPanel(piezas) {
  return new SesionPanel(piezas);
}
