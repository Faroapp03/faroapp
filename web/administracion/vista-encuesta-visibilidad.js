// La Encuesta como función de la web: el interruptor «Visible en la web» y el estado de la ronda, arriba del apartado
// «Encuesta». El interruptor cambia la misma política de secciones que el apartado «Secciones», con su revisión y su
// confirmación: oculta, la página de la encuesta responde como cualquier sección cerrada, el recorrido no la ofrece y
// las invitaciones se conservan para cuando vuelva a mostrarse.
import { crear } from '../scripts/dom.js';
import { texto } from '../scripts/textos.js';
import { confirmarCambio, resumenCambioSecciones } from './confirmacion-cambios.js';

/** @typedef {import('./cliente.js').EstadoClientePanel} EstadoClientePanel */
/** @typedef {import('../scripts/secciones-contrato.js').PoliticaSecciones} PoliticaSecciones */
/** @typedef {import('./cliente-encuesta.js').ResultadosEncuesta} ResultadosEncuesta */
/** @typedef {{contenedor:HTMLElement, cambiarSecciones:(politica:PoliticaSecciones)=>unknown}} OpcionesVisibilidad */

const t = (/** @type {string} */ clave, /** @type {Record<string,string|number>} */ valores = {}) =>
  texto(`panel.encuesta.${clave}`, valores);

class VistaEncuestaVisibilidad {
  #contenedor;
  #cambiarSecciones;
  #campo = crear('input', { type: 'checkbox', id: 'encuesta-visible' });
  #estadoWeb = crear('p', { id: 'encuesta-visible-estado', className: 'estado' });
  #ronda = crear('dl', { className: 'encuesta-ronda-estado' });
  /** @type {PoliticaSecciones|null} */
  #confirmada = null;
  /** @type {ResultadosEncuesta|null} */
  #resultados = null;

  /** @param {OpcionesVisibilidad} opciones */
  constructor({ contenedor, cambiarSecciones }) {
    this.#contenedor = contenedor;
    this.#cambiarSecciones = cambiarSecciones;
    this.#campo.setAttribute('aria-describedby', 'encuesta-visible-ayuda encuesta-visible-estado');
    this.#campo.addEventListener('change', () => this.#cambiar());
    this.#montar();
  }
  #montar() {
    this.#contenedor.replaceChildren(
      crear('h3', { textContent: t('visibilidad.titulo') }),
      crear(
        'label',
        { className: 'interruptor', htmlFor: this.#campo.id },
        crear('span', { textContent: t('visibilidad.interruptor') }),
        this.#campo,
      ),
      crear('p', { id: 'encuesta-visible-ayuda', className: 'ayuda', textContent: t('visibilidad.ayuda') }),
      this.#estadoWeb,
      crear('h3', { textContent: t('ronda.titulo') }),
      this.#ronda,
    );
    this.#pintarWeb();
    this.#pintarRonda();
  }
  /** Lo que se ve es lo confirmado por el servidor: sin política leída, «Sin dato» y el interruptor quieto. */
  #pintarWeb() {
    const politica = this.#confirmada;
    this.#campo.checked = politica?.encuesta === true;
    this.#estadoWeb.textContent =
      politica === null
        ? t('visibilidad.sin-dato')
        : t(politica.encuesta ? 'visibilidad.visible' : 'visibilidad.oculta');
  }
  /** El nombre, el estado y las cifras de la ronda de los resultados consultados, o «Sin dato» antes de consultar. */
  #pintarRonda() {
    const ronda = this.#resultados?.ronda;
    const filas = [
      ['nombre', ronda ? ronda.nombre : null],
      ['estado', ronda ? t(ronda.abierta ? 'ronda.abierta' : 'ronda.cerrada') : null],
      ['invitaciones', ronda ? String(ronda.invitaciones) : null],
      ['respuestas', ronda ? String(ronda.respuestas) : null],
    ];
    this.#ronda.replaceChildren(
      ...filas.flatMap(([clave, valor]) => [
        crear('dt', { textContent: t(`ronda.${clave}`) }),
        crear('dd', { textContent: valor ?? t('ronda.sin-dato') }),
      ]),
    );
  }
  /** Pide el cambio solo si la persona confirma el resumen; si no, el interruptor vuelve a lo confirmado. */
  #cambiar() {
    const confirmada = this.#confirmada;
    if (!confirmada || this.#campo.disabled) {
      this.#pintarWeb();
      return;
    }
    const elegida = Object.freeze({ ...confirmada, encuesta: this.#campo.checked });
    if (!confirmarCambio(resumenCambioSecciones(confirmada, elegida))) {
      this.#pintarWeb();
      return;
    }
    this.#cambiarSecciones(elegida);
  }
  /** @param {EstadoClientePanel} estado @param {boolean} sinConexion */
  mostrar(estado, sinConexion) {
    const activa = estado.estado === 'activa';
    this.#contenedor.hidden = !activa;
    this.#confirmada = activa ? (estado.secciones?.secciones ?? null) : null;
    this.#campo.disabled =
      !activa || sinConexion || estado.ocupado || !this.#confirmada || !!estado.seccionesPendientes;
    this.#pintarWeb();
  }
  /** @param {ResultadosEncuesta|null} resultados */
  mostrarRonda(resultados) {
    this.#resultados = resultados;
    this.#pintarRonda();
  }
  traducir() {
    this.#montar();
  }
}

/** Monta la vista en su contenedor del apartado «Encuesta». @param {OpcionesVisibilidad} opciones */
export function crearVistaEncuestaVisibilidad(opciones) {
  return new VistaEncuestaVisibilidad(opciones);
}
