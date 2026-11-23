import { crear } from '../../dom.js';
import { fechaCompleta, mesYAnio, partesUtc } from '../../fechas.js';
import { escribir, escribirAtributo } from '../../idioma.js';
import { conVersiones } from '../../textos.js';
import { diasDelMes, fechaConTecla, fechaUTC, moverMes } from './fechas-selector.js';

const rótulos = {
  es: {
    inicio: 'Calendario',
    mesAnterior: 'Mes anterior',
    mesSiguiente: 'Mes siguiente',
    fechaElegida: 'Fecha elegida',
    sinFecha: 'Sin fecha elegida',
  },
  ca: {
    inicio: 'Calendari',
    mesAnterior: 'Mes anterior',
    mesSiguiente: 'Mes següent',
    fechaElegida: 'Data escollida',
    sinFecha: 'Sense data escollida',
  },
};
const t = (/** @type {keyof typeof rótulos.es} */ clave) =>
  conVersiones({ es: rótulos.es[clave], ca: rótulos.ca[clave] });

/** Calendario en la propia conversación: sin ventanas nativas ni superposiciones.
 * @param {HTMLInputElement} campo @param {{signal:AbortSignal,vigente:()=>boolean}} vida */
export function crearCalendario(campo, vida) {
  return new Calendario(campo, vida);
}
class Calendario {
  campo;
  elemento = crear('section', { className: 'rc-calendario' });
  mes = crear('h3', { className: 'rc-calendario-mes', ariaLive: 'polite' });
  rejilla = crear('div', { className: 'rc-calendario-dias', role: 'group' });
  seleccion = crear('p', { className: 'rc-calendario-seleccion', ariaLive: 'polite' });
  /** @param {HTMLInputElement} campo @param {{signal:AbortSignal,vigente:()=>boolean}} vida */
  constructor(campo, vida) {
    this.vida = vida;
    this.foco = campo.value || new Date().toISOString().slice(0, 10);
    this.campo = campo;
    escribirAtributo(this.elemento, 'aria-label', t('inicio'));
    this.elemento.append(
      crear('div', { className: 'rc-calendario-cabecera' }, this.navegar(-1), this.mes, this.navegar(1)),
      this.semana(),
      this.rejilla,
      this.seleccion,
    );
    this.rejilla.addEventListener('click', (evento) => this.elegir(evento), { signal: vida.signal });
    this.rejilla.addEventListener('keydown', (evento) => this.teclado(evento), { signal: vida.signal });
    campo.addEventListener(
      'change',
      () => {
        if (campo.value) {
          this.foco = campo.value;
        }
        this.pintar(false);
      },
      { signal: vida.signal },
    );
    this.pintar(false);
  }
  /** @param {number} salto */
  navegar(salto) {
    const boton = crear('button', {
      type: 'button',
      className: 'rc-calendario-nav',
      textContent: salto < 0 ? '‹' : '›',
    });
    escribirAtributo(boton, 'aria-label', t(salto < 0 ? 'mesAnterior' : 'mesSiguiente'));
    boton.addEventListener(
      'click',
      () => {
        if (this.activa()) {
          this.foco = moverMes(this.foco, salto);
          this.pintar(false);
        }
      },
      { signal: this.vida.signal },
    );
    return boton;
  }
  semana() {
    const es = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
    const ca = ['Dl', 'Dt', 'Dc', 'Dj', 'Dv', 'Ds', 'Dg'];
    return crear(
      'div',
      { className: 'rc-calendario-semana', ariaHidden: 'true' },
      ...es.map((dia, i) => escribir(crear('span'), conVersiones({ es: dia, ca: ca[i] ?? dia }))),
    );
  }
  activa() {
    return !this.campo.disabled && !this.vida.signal.aborted && this.vida.vigente();
  }
  /** @param {string} valor */
  dia(valor) {
    const boton = crear('button', {
      type: 'button',
      className: 'rc-calendario-dia',
      textContent: String(fechaUTC(valor).getUTCDate()),
      ariaPressed: String(valor === this.campo.value),
      tabIndex: valor === this.foco ? 0 : -1,
    });
    escribirAtributo(boton, 'aria-label', this.literal(valor));
    boton.dataset.fecha = valor;
    return boton;
  }
  /** @param {string} valor */
  literal(valor) {
    const partes = partesUtc(fechaUTC(valor));
    return conVersiones({ es: fechaCompleta(partes, 'es'), ca: fechaCompleta(partes, 'ca') });
  }
  /** @param {boolean} enfocar */
  pintar(enfocar) {
    const { huecos, dias } = diasDelMes(this.foco);
    const partes = partesUtc(fechaUTC(this.foco));
    const nombre = conVersiones({ es: mesYAnio(partes, 'es'), ca: mesYAnio(partes, 'ca') });
    escribir(this.mes, nombre);
    escribirAtributo(this.rejilla, 'aria-label', nombre);
    this.rejilla.replaceChildren(
      ...Array.from({ length: huecos }, () => crear('span', { ariaHidden: 'true' })),
      ...dias.map((valor) => this.dia(valor)),
    );
    const fecha = this.campo.value ? this.literal(this.campo.value) : null;
    escribir(
      this.seleccion,
      fecha
        ? conVersiones({
            es: `${rótulos.es.fechaElegida}: ${fecha.versiones.es}`,
            ca: `${rótulos.ca.fechaElegida}: ${fecha.versiones.ca}`,
          })
        : t('sinFecha'),
    );
    if (enfocar) {
      this.enfocar();
    }
  }
  enfocar() {
    const boton = this.rejilla.querySelector('button[tabindex="0"]');
    if (boton instanceof HTMLElement) {
      boton.focus({ preventScroll: true });
    }
  }
  /** @param {MouseEvent} evento */
  elegir({ target }) {
    if (this.activa() && target instanceof HTMLButtonElement && target.dataset.fecha) {
      this.foco = target.dataset.fecha;
      this.campo.value = this.foco;
      this.campo.dispatchEvent(new Event('change', { bubbles: true }));
      this.pintar(true);
    }
  }
  /** @param {KeyboardEvent} evento */
  teclado(evento) {
    const boton = evento.target;
    if (!this.activa() || !(boton instanceof HTMLButtonElement) || !boton.dataset.fecha) {
      return;
    }
    const siguiente = fechaConTecla(boton.dataset.fecha, evento.key);
    if (siguiente) {
      evento.preventDefault();
      this.foco = siguiente;
      this.pintar(true);
    }
  }
}
