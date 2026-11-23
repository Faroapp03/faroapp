// La lista nunca contiene secretos. Solo invitar/renovar permite entregar un enlace efímero.
import { enlaceDeCorreo } from '../scripts/contacto.js';
import { crear, porId } from '../scripts/dom.js';
import { texto } from '../scripts/textos.js';
import { fechaPanel } from './fechas-panel.js';
import { direccionDeInvitacion } from './instituciones-contrato.js';
import { tarjetaInstitucion } from './tarjetas-instituciones.js';

/** @typedef {import('./cliente.js').EstadoClientePanel} EstadoClientePanel */
/** @typedef {Extract<EstadoClientePanel,{estado:'activa'}>} EstadoActivo */
/** @typedef {import('../../src/administracion/instituciones.ts').Institucion} Institucion */
/** @typedef {import('../../src/administracion/instituciones.ts').RegistroInstituciones} RegistroInstituciones */
/** @typedef {import('../../src/administracion/instituciones.ts').EnlaceInvitacion} EnlaceInvitacion */
/** @typedef {Pick<ReturnType<typeof import('./cliente.js').crearClientePanel>,'consultarInstituciones'|'invitarInstitucion'|'renovarInvitacion'|'retirarInstitucion'|'retirarClaveInstitucion'|'descartarInvitacion'>} Acciones */
const MAX_CLAVES = 2;
/** Correo manual: solo se construye tras el gesto de entregar; nunca queda como href del documento.
 * @param {EnlaceInvitacion} invitacion @param {string} origen @param {string|null} correo */
export function correoDeInvitacion(invitacion, origen, correo) {
  const direccion = direccionDeInvitacion(invitacion, origen);
  const asunto = texto('panel.instituciones.correo-asunto');
  const cuerpo = texto('panel.instituciones.correo-cuerpo', { direccion });
  if (correo !== null) {
    return enlaceDeCorreo(correo, { asunto, cuerpo });
  }
  return `mailto:?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;
}
function elementos() {
  return {
    raiz: porId('instituciones'),
    estado: porId('instituciones-estado'),
    lista: porId('instituciones-lista'),
    consultar: porId('consultar-instituciones', HTMLButtonElement),
    formulario: porId('instituciones-formulario', HTMLFormElement),
    campos: porId('instituciones-campos', HTMLFieldSetElement),
    nombre: porId('institucion-nombre', HTMLInputElement),
    correo: porId('institucion-correo', HTMLInputElement),
    enlace: porId('institucion-enlace', HTMLInputElement),
    entrega: porId('institucion-entrega'),
    caduca: porId('institucion-caduca'),
    copiar: porId('institucion-copiar', HTMLButtonElement),
    enviar: porId('institucion-enviar', HTMLButtonElement),
    descartar: porId('institucion-descartar', HTMLButtonElement),
  };
}
/** @param {string|null} valor */
function fecha(valor) {
  if (valor === null) {
    return texto('panel.instituciones.sin-conexion');
  }
  return fechaPanel(valor);
}
/** @param {string} clave @param {string} valor */
function dato(clave, valor) {
  return crear('p', {}, crear('strong', { textContent: `${texto(clave)}: ` }), valor);
}
class VistaInstituciones {
  #vista = elementos();
  /** @type {Acciones} */ #acciones;
  /** @type {EstadoActivo|null} */ #estado = null;
  /** @type {RegistroInstituciones|null} */ #listado = null;
  /** @type {string|null} */ #correoEntrega = null;
  #solicitudNueva = false;
  #ultimoEnlace = '';
  /** @param {Acciones} acciones */
  constructor(acciones) {
    this.#acciones = acciones;
    this.#vista.consultar.addEventListener('click', () => {
      if (!this.#vista.consultar.disabled) {
        void acciones.consultarInstituciones();
      }
    });
    this.#vista.formulario.addEventListener('submit', (e) => {
      e.preventDefault();
      this.#invitar();
    });
    this.#vista.copiar.addEventListener('click', () => {
      void this.#copiar();
    });
    this.#vista.enviar.addEventListener('click', () => this.#correo());
    this.#vista.descartar.addEventListener('click', () => {
      if (!this.#vista.descartar.disabled) {
        acciones.descartarInvitacion();
      }
    });
  }
  /** @param {EstadoClientePanel} estado @param {boolean} sinConexion */
  mostrar(estado, sinConexion = false) {
    if (estado.estado !== 'activa' || sinConexion) {
      this.retirar();
      return;
    }
    this.#estado = estado;
    this.#vista.raiz.hidden = false;
    this.#vista.consultar.disabled = estado.ocupado;
    const bloqueado = estado.ocupado || !!estado.institucionesPendientes || !estado.registroInstituciones;
    this.#vista.campos.disabled = bloqueado;
    this.#vista.estado.textContent = texto(
      estado.avisoInstituciones ? `panel.aviso.${estado.avisoInstituciones}` : 'panel.instituciones.consultar-primero',
    );
    if (this.#listado !== estado.registroInstituciones) {
      this.#listado = estado.registroInstituciones ?? null;
      this.#pintarLista();
    }
    for (const boton of this.#vista.lista.querySelectorAll('button')) {
      boton.disabled = bloqueado || boton.dataset.bloqueado === 'true';
    }
    this.#mostrarEnlace(estado);
  }
  retirar() {
    this.#estado = null;
    this.#listado = null;
    this.#correoEntrega = null;
    this.#solicitudNueva = false;
    this.#ultimoEnlace = '';
    this.#vista.raiz.hidden = true;
    this.#vista.campos.disabled = true;
    this.#vista.consultar.disabled = true;
    this.#vista.lista.replaceChildren();
    this.#vista.estado.textContent = '';
    this.#vista.nombre.value = '';
    this.#vista.correo.value = '';
    this.#vista.enlace.value = '';
    this.#vista.entrega.hidden = true;
    this.#vista.caduca.textContent = '';
  }
  traducir() {
    this.#listado = null;
    if (this.#estado) {
      this.mostrar(this.#estado);
    }
  }
  #invitar() {
    if (this.#vista.campos.disabled || !this.#vista.formulario.reportValidity()) {
      return;
    }
    const correo = this.#vista.correo.value === '' ? null : this.#vista.correo.value;
    this.#correoEntrega = correo;
    this.#solicitudNueva = true;
    void this.#acciones.invitarInstitucion({ nombre: this.#vista.nombre.value, correo });
  }
  #pintarLista() {
    this.#vista.lista.replaceChildren();
    if (!this.#listado) {
      return;
    }
    if (!this.#listado.instituciones.length) {
      this.#vista.lista.append(crear('p', { textContent: texto('panel.instituciones.sin-registros') }));
      return;
    }
    for (const institucion of this.#listado.instituciones) {
      this.#vista.lista.append(this.#tarjeta(institucion));
    }
  }
  /** @param {Institucion} i */
  #tarjeta(i) {
    return tarjetaInstitucion(i, {
      claves: i.claves.map((clave) => this.#clave(i, clave)),
      acciones: i.estado === 'retirada' ? null : this.#botones(i),
      fecha,
    });
  }
  /** @param {Institucion} i @param {Institucion['claves'][number]} clave */
  #clave(i, clave) {
    const bloque = crear('div', { className: 'institucion-clave' });
    bloque.append(
      dato('panel.instituciones.clave-id', clave.id),
      dato('panel.instituciones.clave-creada', fecha(clave.creadaEn)),
      dato('panel.instituciones.ultima-conexion', fecha(clave.ultimaConexion)),
    );
    const retirar = crear('button', {
      type: 'button',
      className: 'secundario',
      textContent: texto('panel.instituciones.retirar-clave'),
    });
    retirar.addEventListener('click', () => {
      if (this.#confirmar('panel.instituciones.confirmar-clave', { nombre: i.nombre, id: clave.id })) {
        void this.#acciones.retirarClaveInstitucion(i.id, clave.id);
      }
    });
    bloque.append(retirar);
    return bloque;
  }
  #puedeActuar() {
    return (
      this.#estado !== null &&
      !!this.#estado.registroInstituciones &&
      !this.#estado.ocupado &&
      !this.#estado.institucionesPendientes
    );
  }
  /** La confirmación no autoriza una revisión que cambie mientras se muestra el diálogo.
   * @param {string} clave @param {import('../scripts/textos.js').Valores} valores */
  #confirmar(clave, valores) {
    const revision = this.#estado?.registroInstituciones?.revision;
    if (!this.#puedeActuar() || !window.confirm(texto(clave, valores))) {
      return false;
    }
    return this.#puedeActuar() && this.#estado?.registroInstituciones?.revision === revision;
  }
  /** @param {Institucion} i */
  #botones(i) {
    const bloque = crear('div', { className: 'acciones' });
    const renovar = crear('button', {
      type: 'button',
      className: 'secundario',
      textContent: texto('panel.instituciones.renovar'),
    });
    renovar.dataset.bloqueado = String(i.claves.length >= MAX_CLAVES);
    renovar.addEventListener('click', () => {
      if (renovar.disabled || !this.#confirmar('panel.instituciones.confirmar-renovar', { nombre: i.nombre })) {
        return;
      }
      this.#correoEntrega = i.correo;
      void this.#acciones.renovarInvitacion(i.id);
    });
    const retirar = crear('button', {
      type: 'button',
      className: 'secundario',
      textContent: texto('panel.instituciones.retirar'),
    });
    retirar.addEventListener('click', () => {
      if (this.#confirmar('panel.instituciones.confirmar-retirar', { nombre: i.nombre })) {
        void this.#acciones.retirarInstitucion(i.id);
      }
    });
    bloque.append(renovar, retirar);
    if (i.claves.length >= MAX_CLAVES) {
      bloque.append(crear('p', { className: 'ayuda', textContent: texto('panel.instituciones.dos-claves') }));
    }
    return bloque;
  }
  /** @param {EstadoActivo} estado */
  #mostrarEnlace(estado) {
    const invitacion = estado.invitacion;
    this.#vista.entrega.hidden = !invitacion;
    for (const boton of [this.#vista.copiar, this.#vista.enviar, this.#vista.descartar]) {
      boton.disabled = estado.ocupado || !invitacion;
    }
    this.#vista.enlace.value = invitacion ? direccionDeInvitacion(invitacion, location.origin) : '';
    this.#vista.caduca.textContent = invitacion
      ? texto('panel.instituciones.enlace-caduca', { fecha: fecha(invitacion.caducaEn) })
      : '';
    if (invitacion && invitacion.enlaceRelativo !== this.#ultimoEnlace && this.#solicitudNueva) {
      this.#vista.nombre.value = '';
      this.#vista.correo.value = '';
    }
    this.#ultimoEnlace = invitacion?.enlaceRelativo ?? '';
    if (!estado.ocupado) {
      this.#solicitudNueva = false;
      if (!invitacion) {
        this.#correoEntrega = null;
      }
    }
  }
  async #copiar() {
    const enlace = this.#vista.enlace.value;
    if (!this.#puedeActuar() || !this.#estado?.invitacion || !enlace) {
      return;
    }
    if (!navigator.clipboard?.writeText) {
      this.#copiaManual();
      return;
    }
    try {
      await navigator.clipboard.writeText(enlace);
      if (this.#vista.enlace.value === enlace) {
        this.#vista.caduca.textContent = texto('panel.instituciones.copiado');
      }
    } catch (error) {
      if (this.#vista.enlace.value === enlace) {
        this.#copiaManual();
      }
      if (!(error instanceof DOMException)) {
        throw error;
      }
    }
  }
  #copiaManual() {
    this.#vista.enlace.focus();
    this.#vista.enlace.select();
    this.#vista.caduca.textContent = texto('panel.instituciones.copia-manual');
  }
  #correo() {
    if (!this.#puedeActuar() || !this.#estado?.invitacion) {
      return;
    }
    const enlace = correoDeInvitacion(this.#estado.invitacion, location.origin, this.#correoEntrega);
    if (enlace) {
      window.open(enlace, '_self');
      this.#vista.caduca.textContent = texto('panel.instituciones.correo-manual');
    }
  }
}
/** @param {Acciones} acciones */
export function crearVistaInstituciones(acciones) {
  return new VistaInstituciones(acciones);
}
