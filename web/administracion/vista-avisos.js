// Tarjeta «Avisos»: a dónde llegan los avisos y en qué estado está la dirección, con guardar, probar y quitar. Al abrir
// la sesión solo lee (no escribe ninguna decisión). La dirección completa solo vive en el campo mientras la tarjeta
// está abierta; el resumen la enseña oculta en parte y nada la guarda en el navegador, la URL ni la consola.
import { texto } from '../scripts/textos.js';
import { confirmarCambio } from './confirmacion-cambios.js';
import { fechaPanel } from './fechas-panel.js';

/** @typedef {import('./cliente-avisos.js').ResultadoAvisos} ResultadoAvisos */
/** @typedef {import('./cliente-avisos.js').DestinoAvisosPanel} DestinoAvisosPanel */
/** @typedef {'leer'|'cambiar'|'quitar'|'probar'} AccionAvisos */
/** @typedef {{leerAvisos:()=>Promise<ResultadoAvisos|null>,cambiarAvisos:(revision:number,correo:string)=>Promise<ResultadoAvisos|null>,quitarAvisos:(revision:number)=>Promise<ResultadoAvisos|null>,probarAvisos:()=>Promise<ResultadoAvisos|null>}} ClienteAvisos */
/** @typedef {Readonly<{clave:string,valores?:Record<string,string>}>} FraseAvisos */

/** La primera letra y el dominio bastan para reconocer la dirección sin enseñarla entera. @param {string} correo */
export function correoOculto(correo) {
  const arroba = correo.lastIndexOf('@');
  return `${correo.slice(0, 1)}•••${correo.slice(arroba)}`;
}
/** @param {string} id */
const elemento = (id) => /** @type {HTMLElement & {disabled:boolean,value:string}} */ (document.getElementById(id));

/** Lo que dice la tarjeta tras cada respuesta, a partir de la lista cerrada de resultados y motivos. */
/** @param {AccionAvisos} accion @param {ResultadoAvisos} resultado @returns {FraseAvisos|null} */
function fraseDelResultado(accion, resultado) {
  if (resultado.tipo === 'prueba') {
    const { prueba } = resultado;
    if (prueba.resultado === 'enviado') {
      return { clave: 'panel.avisos.resultado.prueba-enviada' };
    }
    const clave = prueba.resultado === 'fallido' ? 'prueba-fallida' : 'prueba-no-enviada';
    return {
      clave: `panel.avisos.resultado.${clave}`,
      valores: { motivo: texto(`panel.avisos.motivo.${prueba.motivo}`) },
    };
  }
  if (resultado.tipo === 'cambiado') {
    return { clave: accion === 'quitar' ? 'panel.avisos.resultado.quitado' : 'panel.avisos.resultado.guardado' };
  }
  if (resultado.tipo === 'conflicto' || resultado.tipo === 'correo-invalido') {
    return { clave: `panel.avisos.resultado.${resultado.tipo}` };
  }
  return null;
}

/**
 * Lo que la lectura dice además de la dirección: si el correo no puede salir, cómo fue el último aviso por correo y si
 * las comprobaciones automáticas están desactivadas (entonces no saldrá ningún aviso, aunque la dirección se guarde).
 * @param {import('./cliente-avisos.js').EstadoAvisosPanel|null} avisos @returns {FraseAvisos[]}
 */
function frasesDeLosCanales(avisos) {
  /** @type {FraseAvisos[]} */
  const frases = [];
  const correo = avisos?.canales.find((canal) => canal.canal === 'correo');
  if (correo?.estado === 'no-configurado' || correo?.estado === 'remitente-no-admitido') {
    frases.push({ clave: `panel.avisos.canal.${correo.estado}` });
  }
  const intento = correo?.ultimoIntento;
  if (intento) {
    const fecha = fechaPanel(intento.en);
    frases.push(
      intento.resultado === 'enviado'
        ? { clave: 'panel.avisos.ultimo.enviado', valores: { fecha } }
        : {
            clave: 'panel.avisos.ultimo.fallido',
            valores: { fecha, motivo: texto(`panel.avisos.motivo.${intento.motivo}`) },
          },
    );
  }
  if (avisos?.comprobaciones === 'desactivadas') {
    frases.push({ clave: 'panel.avisos.comprobaciones-desactivadas' });
  }
  return frases;
}

class VistaAvisos {
  /** @param {ClienteAvisos} cliente @param {(pregunta:string)=>boolean} confirmar */
  constructor(cliente, confirmar) {
    this.cliente = cliente;
    this.confirmar = confirmar;
    this.raiz = elemento('avisos');
    this.resumen = elemento('avisos-resumen');
    this.estado = elemento('avisos-estado');
    this.campo = elemento('avisos-correo');
    this.botones = {
      guardar: elemento('avisos-guardar'),
      probar: elemento('avisos-probar'),
      quitar: elemento('avisos-quitar'),
      reintentar: elemento('avisos-reintentar'),
    };
    this.epoca = 0;
    this.activa = false;
    this.ocupadoPanel = false;
    /** @type {string|null} */ this.avisoPanel = null;
    /** @type {AccionAvisos|null} */ this.pidiendo = null;
    /** @type {DestinoAvisosPanel|null} */ this.destino = null;
    /** @type {import('./cliente-avisos.js').EstadoAvisosPanel|null} */ this.avisos = null;
    /** @type {'no-leido'|'no-disponible'|null} */ this.sinDestino = null;
    /** @type {FraseAvisos|null} */ this.frase = null;
    this.leido = false;
    this.botones.guardar.addEventListener('click', () => void this.guardar());
    this.botones.probar.addEventListener('click', () => void this.pedir('probar', () => this.cliente.probarAvisos()));
    this.botones.quitar.addEventListener('click', () => void this.quitar());
    this.botones.reintentar.addEventListener('click', () => void this.releer(null));
    this.campo.addEventListener('keydown', (evento) => {
      if (/** @type {KeyboardEvent} */ (evento).key === 'Enter') {
        evento.preventDefault();
        void this.guardar();
      }
    });
  }
  async guardar() {
    const correo = this.campo.value.trim();
    if (!this.destino) {
      return;
    }
    if (correo === '') {
      this.frase = { clave: 'panel.avisos.resultado.vacio' };
      this.pintar();
      return;
    }
    const pregunta = [
      texto('panel.confirmar.intro'),
      `• ${texto('panel.avisos.confirmar.guardar', { correo })}`,
      texto('panel.confirmar.pregunta'),
    ].join('\n');
    const revision = this.destino.revision;
    if (this.confirmar(pregunta)) {
      await this.pedir('cambiar', () => this.cliente.cambiarAvisos(revision, correo));
    }
  }
  async quitar() {
    const destino = this.destino;
    if (destino?.correo && this.confirmar(texto('panel.avisos.confirmar.quitar', { correo: destino.correo }))) {
      await this.pedir('quitar', () => this.cliente.quitarAvisos(destino.revision));
    }
  }
  /** Una acción cada vez y con la revisión de la última lectura; después se vuelve a leer la dirección vigente.
   * @param {AccionAvisos} accion @param {()=>Promise<ResultadoAvisos|null>} enviar */
  async pedir(accion, enviar) {
    if (this.pidiendo || this.ocupadoPanel) {
      return;
    }
    const actual = this.epoca;
    const foco = document.activeElement;
    this.pidiendo = accion;
    this.frase = null;
    this.pintar();
    const resultado = await enviar();
    if (actual !== this.epoca) {
      return;
    }
    this.pidiendo = null;
    if (!resultado) {
      this.frase = {
        clave: `panel.avisos.resultado.${this.avisoPanel === 'resultado_desconocido' ? 'desconocido' : 'fallo'}`,
      };
      this.pintar();
      return;
    }
    if (resultado.tipo === 'no-disponible') {
      this.sinDestino = 'no-disponible';
      this.pintar();
      return;
    }
    await this.releer(fraseDelResultado(accion, resultado), resultado.tipo !== 'correo-invalido');
    /** @type {{focus?:()=>void}|null} */ (foco)?.focus?.();
  }
  /** @param {FraseAvisos|null} frase @param {boolean} [leer] */
  async releer(frase, leer = true) {
    if (!leer) {
      this.frase = frase;
      this.pintar();
      return;
    }
    const actual = this.epoca;
    this.pidiendo = 'leer';
    this.pintar();
    const resultado = await this.cliente.leerAvisos();
    if (actual !== this.epoca) {
      return;
    }
    this.pidiendo = null;
    this.leido = true;
    this.recibirLectura(resultado);
    this.frase = frase;
    this.pintar();
  }
  /** @param {ResultadoAvisos|null} resultado */
  recibirLectura(resultado) {
    this.destino = resultado?.tipo === 'leido' ? resultado.destino : null;
    this.avisos = resultado?.tipo === 'leido' ? resultado.avisos : null;
    this.sinDestino = null;
    if (!this.destino) {
      this.sinDestino = resultado?.tipo === 'no-disponible' ? 'no-disponible' : 'no-leido';
    }
    this.campo.value = this.destino?.correo ?? '';
  }
  /** @returns {FraseAvisos} */
  fraseDelResumen() {
    if (!this.destino) {
      return { clave: `panel.avisos.resumen.${this.sinDestino ?? 'no-leido'}` };
    }
    const correo = this.destino.correo;
    return {
      clave: `panel.avisos.resumen.${this.destino.verificacion}`,
      valores: { correo: correo ? correoOculto(correo) : '' },
    };
  }
  pintar() {
    this.raiz.hidden = !this.activa;
    this.raiz.setAttribute('aria-busy', this.pidiendo ? 'true' : 'false');
    const parado = this.pidiendo !== null || this.ocupadoPanel || !this.destino;
    this.campo.disabled = parado;
    this.botones.guardar.disabled = parado;
    this.botones.probar.disabled = parado || !this.destino?.correo;
    this.botones.quitar.disabled = parado || !this.destino?.correo;
    this.botones.reintentar.hidden =
      this.sinDestino !== 'no-leido' && this.frase?.clave !== 'panel.avisos.resultado.desconocido';
    this.botones.reintentar.disabled = this.pidiendo !== null || this.ocupadoPanel;
    const resumen = this.pidiendo === 'leer' && !this.destino ? [] : [this.fraseDelResumen()];
    const frasesResumen = this.destino ? [...resumen, ...frasesDeLosCanales(this.avisos)] : resumen;
    this.resumen.textContent = frasesResumen.map((f) => texto(f.clave, f.valores)).join(' ');
    // La región de estado solo recibe la frase que cambia: qué se está haciendo o cómo ha terminado.
    const frase = this.pidiendo ? { clave: `panel.avisos.en-curso.${this.pidiendo}` } : this.frase;
    this.estado.textContent = frase ? texto(frase.clave, frase.valores) : '';
  }
  /** Al abrir la sesión, una sola lectura; un fallo deja «Volver a consultar» en lugar de repetirla sola.
   * @param {boolean} enCurso @param {string|null} aviso */
  mostrar(enCurso, aviso) {
    this.activa = true;
    this.ocupadoPanel = enCurso;
    this.avisoPanel = aviso;
    if (!this.leido && !enCurso && !this.pidiendo) {
      this.leido = true;
      void this.releer(null);
      return;
    }
    this.pintar();
  }
  retirar() {
    this.epoca += 1;
    this.activa = false;
    this.leido = false;
    this.pidiendo = null;
    this.destino = null;
    this.avisos = null;
    this.sinDestino = null;
    this.frase = null;
    this.campo.value = '';
    this.pintar();
  }
  traducir() {
    this.pintar();
  }
  /** Lo que la tarjeta ya sabe, para el resumen del Inicio; no lanza ninguna lectura.
   * @returns {import('./inicio-datos.js').SituacionAvisos} */
  situacion() {
    const correo = this.avisos?.canales.find((canal) => canal.canal === 'correo');
    return {
      sinLeer: this.destino === null && this.sinDestino !== 'no-disponible',
      disponible: this.sinDestino !== 'no-disponible',
      verificacion: this.destino?.verificacion ?? null,
      canalCorreo: correo?.estado ?? null,
    };
  }
}
/** @param {ClienteAvisos} cliente @param {(pregunta:string)=>boolean} [confirmar] */
export function crearVistaAvisos(cliente, confirmar = confirmarCambio) {
  return new VistaAvisos(cliente, confirmar);
}
