// Pantalla «Encuesta»: rondas, lotes de invitaciones por entidad colaboradora, cierre de cada ronda y sus resultados. Los
// enlaces recién creados viven solo en esta vista: no se guardan en el dispositivo y se olvidan al salir del apartado.
import { crear, porId } from '../scripts/dom.js';
import { texto } from '../scripts/textos.js';
import { csvDeResultados, descargar, enlacesCompletos, nombreDeArchivo, textoDelCorreo } from './archivos-piloto.js';
import { textoAviso } from './avisos-panel.js';
import { MAXIMO_LOTE, MINIMO_LOTE, nombreDeEntidadValido } from './cliente-encuesta.js';
import { bloqueDeResultados, tablaDeLotes } from './vista-encuesta-resultados.js';
import { bloqueDeRondas, conLoteNuevo } from './vista-encuesta-rondas.js';

/** @typedef {import('./cliente.js').EstadoClientePanel} EstadoClientePanel */
/** @typedef {import('./cliente-encuesta.js').ResultadosEncuesta} ResultadosEncuesta */
/** @typedef {import('./cliente-encuesta.js').TipoEncuesta} TipoEncuesta */
/** @typedef {{nombre:string,tipo:TipoEncuesta,cantidad:number,codigos:readonly import('./cliente-encuesta.js').CodigoEncuesta[]}} EnlacesCreados */
/** @typedef {{error:import('./cliente-encuesta.js').ErrorEncuesta}} ErrorEncuesta */
/** abrirRonda la pasa el panel junto a las demás (la entrega del lote lo describe); sin ella no se ofrece abrir rondas.
 * alLeer avisa de cada resultado que se muestra, para que el estado de la ronda (vista-encuesta-visibilidad.js) lo siga.
 * @typedef {{alLeer?:(resultados:ResultadosEncuesta|null)=>void, consultar:(ronda?:number|null)=>Promise<{encuesta:ResultadosEncuesta}|ErrorEncuesta|null>, abrirRonda?:(nombre:string)=>Promise<{encuesta:ResultadosEncuesta}|ErrorEncuesta|null>, cerrar:()=>Promise<{encuesta:ResultadosEncuesta}|ErrorEncuesta|null>, crearLote:(p:{tipo:TipoEncuesta,cantidad:number,nombre:string})=>Promise<{lote:import('./cliente-encuesta.js').LoteEncuesta,codigos:readonly import('./cliente-encuesta.js').CodigoEncuesta[]}|ErrorEncuesta|null>}} OperacionesEncuesta */

const APARTADO = '#panel-piloto';
const t = (/** @type {string} */ clave, /** @type {Record<string,string|number>} */ valores = {}) =>
  texto(`panel.piloto.${clave}`, valores);

function elementos() {
  return {
    raiz: porId('encuesta', HTMLElement),
    consultar: porId('consultar-encuesta', HTMLButtonElement),
    estado: porId('encuesta-estado', HTMLElement),
    formulario: porId('encuesta-formulario', HTMLFormElement),
    campos: porId('encuesta-campos', HTMLFieldSetElement),
    nombre: porId('encuesta-nombre', HTMLInputElement),
    participante: porId('encuesta-tipo-participante', HTMLInputElement),
    cantidad: porId('encuesta-cantidad', HTMLInputElement),
    enlaces: porId('encuesta-enlaces', HTMLElement),
    enlacesTitulo: porId('encuesta-enlaces-titulo', HTMLElement),
    enlacesPara: porId('encuesta-enlaces-para', HTMLElement),
    lista: porId('encuesta-lista', HTMLTextAreaElement),
    copiar: porId('encuesta-copiar', HTMLButtonElement),
    descargarEnlaces: porId('encuesta-descargar', HTMLButtonElement),
    olvidar: porId('encuesta-olvidar', HTMLButtonElement),
    correo: porId('encuesta-correo', HTMLTextAreaElement),
    copiarCorreo: porId('encuesta-copiar-correo', HTMLButtonElement),
    lotes: porId('encuesta-lotes', HTMLElement),
    resultados: porId('encuesta-resultados', HTMLElement),
    cerrar: porId('encuesta-cerrar', HTMLButtonElement),
    csv: porId('encuesta-csv', HTMLButtonElement),
  };
}

/** @param {unknown} resultado @returns {resultado is {error:string}} */
function esError(resultado) {
  return !!resultado && typeof resultado === 'object' && 'error' in resultado;
}

class VistaEncuesta {
  #v = elementos();
  #operaciones;
  /** @type {ResultadosEncuesta|null} */
  #resultados = null;
  /** @type {EnlacesCreados|null} */
  #creados = null;
  /** @type {import('./cliente.js').AvisoPanel|null} */
  #ultimoAviso = null;
  #activa = false;
  /** @type {Set<()=>void>} */
  #descargasDeEnlaces = new Set();
  #ocupado = false;

  /** @param {OperacionesEncuesta} operaciones */
  constructor(operaciones) {
    this.#operaciones = operaciones;
    this.#escuchar();
    this.#escucharArchivos();
    this.#olvidarAlSalir();
  }
  /** @param {string} mensaje */
  #decir(mensaje) {
    this.#v.estado.textContent = mensaje;
  }
  /** Un fallo dice qué ha pasado y qué hacer; un error propio de la encuesta trae su frase. @param {unknown} resultado */
  #fallo(resultado) {
    if (esError(resultado)) {
      this.#decir(t(`error.${resultado.error}`));
      return;
    }
    const aviso = this.#ultimoAviso;
    if (aviso === 'resultado_desconocido') {
      this.#decir(t('error.incierta'));
    } else if (aviso === 'sin_conexion' || !navigator.onLine) {
      this.#decir(t('error.sin-conexion'));
    } else {
      this.#decir(textoAviso(aviso ?? 'respuesta_invalida') || textoAviso('respuesta_invalida'));
    }
  }
  #olvidarEnlaces() {
    // La copia en memoria del archivo de enlaces no sobrevive a los enlaces en pantalla.
    for (const retirar of this.#descargasDeEnlaces) {
      retirar();
    }
    this.#descargasDeEnlaces.clear();
    this.#creados = null;
    this.#v.lista.value = '';
    this.#v.correo.value = '';
    this.#v.enlaces.hidden = true;
  }
  #pintarEnlaces() {
    const creados = this.#creados;
    if (!creados) {
      this.#olvidarEnlaces();
      return;
    }
    this.#v.enlaces.hidden = false;
    this.#v.enlacesPara.textContent = t('enlaces.titulo', { nombre: creados.nombre, cantidad: creados.cantidad });
    this.#v.lista.value = enlacesCompletos(creados.codigos, location.origin);
    this.#v.correo.value = textoDelCorreo(creados);
  }
  #pintar() {
    const v = this.#v;
    const resultados = this.#resultados;
    const libre = this.#activa && !this.#ocupado;
    const abrir = this.#operaciones.abrirRonda ? (/** @type {string} */ nombre) => void this.#abrirRonda(nombre) : null;
    const acciones = {
      libre,
      ver: (/** @type {number} */ n) => void this.#consultar(n),
      abrir,
      avisar: (/** @type {string} */ m) => this.#decir(m),
    };
    v.lotes.replaceChildren(
      ...(resultados
        ? [bloqueDeRondas(resultados, acciones), tablaDeLotes(resultados)]
        : [crear('p', { textContent: t('consulta-inicial') })]),
    );
    v.resultados.replaceChildren(...(resultados ? bloqueDeResultados(resultados) : []));
    const cerrada = resultados?.abierta === false;
    v.campos.disabled = !libre || !resultados || cerrada;
    v.consultar.disabled = !libre;
    v.cerrar.disabled = !libre || !resultados || cerrada;
    v.csv.hidden = !cerrada;
    v.csv.disabled = !libre;
    for (const boton of [v.copiar, v.descargarEnlaces, v.olvidar, v.copiarCorreo]) {
      boton.disabled = !this.#creados;
    }
    this.#pintarEnlaces();
    this.#operaciones.alLeer?.(resultados);
  }
  /** Los resultados de la ronda con ese número, o los de la última. @param {number|null} [ronda] */
  async #consultar(ronda = null) {
    if (this.#v.consultar.disabled) {
      return;
    }
    this.#decir(t('consultando'));
    const leido = await this.#operaciones.consultar(ronda);
    if (!leido || esError(leido)) {
      this.#fallo(leido);
      return;
    }
    this.#resultados = leido.encuesta;
    const nombre = leido.encuesta.ronda.nombre;
    this.#decir(t(leido.encuesta.abierta ? 'consultada-abierta' : 'consultada-cerrada', { nombre }));
    this.#pintar();
  }
  /** Abre la ronda siguiente; sus enlaces y resultados empiezan vacíos. @param {string} nombre */
  async #abrirRonda(nombre) {
    const abrir = this.#operaciones.abrirRonda;
    if (!abrir || !this.#activa || this.#ocupado) {
      return;
    }
    if (!navigator.onLine) {
      this.#decir(t('error.sin-conexion'));
      return;
    }
    this.#decir(t('ronda.abriendo'));
    const abierta = await abrir(nombre);
    if (!abierta || esError(abierta)) {
      this.#fallo(abierta);
      return;
    }
    this.#resultados = abierta.encuesta;
    this.#olvidarEnlaces();
    this.#decir(t('ronda.abierta-ahora', { nombre }));
    this.#pintar();
  }
  /** El campo con error lleva `aria-invalid` mientras dura el error; el otro, no. @param {HTMLInputElement|null} campo */
  #marcarError(campo) {
    for (const otro of [this.#v.nombre, this.#v.cantidad]) {
      if (otro === campo) {
        otro.setAttribute('aria-invalid', 'true');
      } else {
        otro.removeAttribute('aria-invalid');
      }
    }
  }
  /** @returns {{tipo:TipoEncuesta,cantidad:number,nombre:string}|null} */
  #pedidoValido() {
    const nombre = this.#v.nombre.value.trim();
    if (!nombreDeEntidadValido(nombre)) {
      this.#decir(t('error.nombre'));
      this.#marcarError(this.#v.nombre);
      this.#v.nombre.focus();
      return null;
    }
    const cantidad = Number(this.#v.cantidad.value);
    if (!Number.isInteger(cantidad) || cantidad < MINIMO_LOTE || cantidad > MAXIMO_LOTE) {
      this.#decir(t('error.cantidad', { minimo: MINIMO_LOTE, maximo: MAXIMO_LOTE }));
      this.#marcarError(this.#v.cantidad);
      this.#v.cantidad.focus();
      return null;
    }
    this.#marcarError(null);
    return { nombre, cantidad, tipo: this.#v.participante.checked ? 'participante' : 'profesional' };
  }
  async #crearLote() {
    const pedido = this.#v.campos.disabled ? null : this.#pedidoValido();
    if (!pedido) {
      return;
    }
    if (!navigator.onLine) {
      this.#decir(t('error.sin-conexion'));
      return;
    }
    this.#decir(t('creando'));
    const creado = await this.#operaciones.crearLote(pedido);
    if (esError(creado) && creado.error === 'encuesta_cerrada') {
      // Otra sesión la ha cerrado: se vuelve a leer para mostrarla cerrada, sin formulario ni «Cerrar» activos.
      await this.#consultar();
      this.#fallo(creado);
      return;
    }
    if (esError(creado) && creado.error === 'lote_demasiado_pequeno') {
      this.#marcarError(this.#v.cantidad);
    }
    if (!creado || esError(creado)) {
      this.#fallo(creado);
      return;
    }
    this.#creados = { ...pedido, codigos: creado.codigos };
    const anteriores = this.#resultados;
    if (anteriores) {
      this.#resultados = conLoteNuevo(anteriores, creado.lote);
    }
    this.#v.formulario.reset();
    this.#decir(t('creado', { cantidad: pedido.cantidad, nombre: pedido.nombre }));
    this.#pintar();
    this.#v.enlacesTitulo.focus();
  }
  async #cerrar() {
    const ronda = this.#resultados?.ronda;
    if (this.#v.cerrar.disabled || !ronda || !window.confirm(t('confirmar-cierre', { nombre: ronda.nombre }))) {
      return;
    }
    this.#decir(t('cerrando'));
    const leido = await this.#operaciones.cerrar();
    if (!leido || esError(leido)) {
      this.#fallo(leido);
      return;
    }
    this.#resultados = leido.encuesta;
    // Con la encuesta cerrada, los enlaces sin usar ya no sirven: no se dejan a la vista.
    this.#olvidarEnlaces();
    this.#decir(t('cerrada-ahora'));
    this.#pintar();
  }
  /** @param {HTMLTextAreaElement} campo @param {string} hecho */
  async #copiar(campo, hecho) {
    if (!this.#creados) {
      return;
    }
    try {
      if (!navigator.clipboard?.writeText) {
        throw new DOMException('Portapapeles no disponible');
      }
      await navigator.clipboard.writeText(campo.value);
      this.#decir(hecho);
    } catch (error) {
      campo.focus();
      campo.select();
      this.#decir(t('copia-manual'));
      if (!(error instanceof DOMException)) {
        throw error;
      }
    }
  }
  #escuchar() {
    const v = this.#v;
    v.consultar.addEventListener('click', () => void this.#consultar());
    v.formulario.addEventListener('submit', (evento) => {
      evento.preventDefault();
      void this.#crearLote();
    });
    v.cerrar.addEventListener('click', () => void this.#cerrar());
    v.copiar.addEventListener('click', () => void this.#copiar(v.lista, t('copiados')));
    v.copiarCorreo.addEventListener('click', () => void this.#copiar(v.correo, t('correo-copiado')));
    v.olvidar.addEventListener('click', () => {
      this.#olvidarEnlaces();
      this.#decir(t('olvidados'));
      this.#pintar();
    });
  }
  #escucharArchivos() {
    this.#v.descargarEnlaces.addEventListener('click', () => {
      const creados = this.#creados;
      if (creados) {
        const nombre = nombreDeArchivo(creados.nombre, t('archivo.enlaces'));
        this.#descargasDeEnlaces.add(descargar(`${this.#v.lista.value}\n`, nombre, 'text/plain;charset=utf-8'));
      }
    });
    this.#v.csv.addEventListener('click', () => {
      const resultados = this.#resultados;
      if (resultados && !resultados.abierta) {
        const archivo = nombreDeArchivo(resultados.ronda.nombre, t('archivo.resultados'), 'csv');
        descargar(csvDeResultados(resultados, Date.now()), archivo, 'text/csv;charset=utf-8');
      }
    });
  }
  /** Salir del apartado (por su barra, sus controles o la historia) o de la página olvida los enlaces mostrados. */
  #olvidarAlSalir() {
    const olvidar = () => {
      if (this.#creados) {
        this.#olvidarEnlaces();
        this.#pintar();
      }
    };
    document.addEventListener('click', (evento) => {
      const enlace = evento.target instanceof HTMLElement ? evento.target.closest('a[href^="#panel-"]') : null;
      if (enlace && enlace.getAttribute('href') !== APARTADO) {
        olvidar();
      }
    });
    const alCambiarDeApartado = () => {
      if (location.hash !== APARTADO) {
        olvidar();
      }
    };
    window.addEventListener('popstate', alCambiarDeApartado);
    window.addEventListener('hashchange', alCambiarDeApartado);
    window.addEventListener('pagehide', () => this.#olvidarEnlaces());
  }
  /** @param {EstadoClientePanel} estado @param {boolean} sinConexion */
  mostrar(estado, sinConexion) {
    if (estado.estado !== 'activa') {
      this.retirar();
      return;
    }
    this.#activa = !sinConexion;
    this.#ocupado = estado.ocupado;
    this.#ultimoAviso = estado.aviso;
    this.#v.raiz.hidden = false;
    this.#pintar();
  }
  retirar() {
    this.#activa = false;
    this.#resultados = null;
    this.#olvidarEnlaces();
    this.#v.estado.textContent = '';
    this.#v.raiz.hidden = true;
    this.#pintar();
  }
  traducir() {
    this.#pintar();
  }
}

/** @param {OperacionesEncuesta} operaciones */
export function crearVistaEncuesta(operaciones) {
  return new VistaEncuesta(operaciones);
}
