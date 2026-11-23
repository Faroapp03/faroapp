// Invitación pública: secreto solo en RAM, consumo explícito y sin repetición automática.
import { aBase64Url, deBase64Url } from '../base64url.js';
import { esObjeto } from '../json.js';
import { CABECERA_CONTRATO, CONTRATO_API } from '../protocolo-web.js';
import { CuerpoDeConectividadInvalido, leerCuerpoDeConectividad } from './cuerpo.js';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const ID = new RegExp(`^inst-${UUID}$`);
const INVITACION = new RegExp(`^(${UUID})\\.([A-Za-z0-9_-]{43})$`);
const SECRETO_BYTES = 32;
const MAX_NOMBRE = 120;
const PLAZO_MS = 10_000;
const BASE = new URL('../../api/socios/v1/invitacion/', import.meta.url);
/** @typedef {import('../../../src/administracion/instituciones.ts').InvitacionLeida} InvitacionLeida */
/** @typedef {{version:1,client_id:string,client_secret:string,token_endpoint:'/api/socios/v1/token',token_type:'Bearer'}} Clave */
/** @typedef {'invitacion-no-disponible'|'servicio-no-disponible'|'sin-conexion'|'respuesta-invalida'|'resultado-desconocido'} Motivo */
/** @typedef {{estado:'consultando'}|{estado:'preparada',lectura:InvitacionLeida}|{estado:'generando'}|{estado:'clave',clave:Clave}|{estado:'error',motivo:Motivo,reintentar:boolean}|{estado:'retirada'}} EstadoActivacion */

export class ActivacionNoDisponible extends Error {
  /** @param {Motivo} motivo */
  constructor(motivo) {
    super('No se ha podido completar la activación');
    this.motivo = motivo;
  }
}
/** @param {unknown} dato */
function secretoCanonico(dato) {
  if (typeof dato !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(dato)) {
    return false;
  }
  const bytes = deBase64Url(dato);
  return bytes !== null && bytes.byteLength === SECRETO_BYTES && aBase64Url(bytes) === dato;
}
/** El formato coincide con el lector del servidor, sin aceptar credenciales de familias retiradas.
 * @param {unknown} dato @returns {dato is string} */
export function esInvitacion(dato) {
  if (typeof dato !== 'string') {
    return false;
  }
  const partes = INVITACION.exec(dato);
  return partes !== null && secretoCanonico(partes[2]);
}
/** Quita fragmento y query antes de devolver un secreto; ni un query ni un fragmento alternativo son invitaciones.
 * @param {{hash:string,search:string,pathname:string}} ubicacion
 * @param {{replaceState:(dato:unknown,titulo:string,url:string)=>void}} historial
 * @returns {string|null} */
export function recogerInvitacion(ubicacion, historial) {
  const fragmento = ubicacion.hash;
  const sinQuery = ubicacion.search === '';
  try {
    historial.replaceState(null, '', ubicacion.pathname);
  } catch (error) {
    if (!(error instanceof DOMException)) {
      throw error;
    }
    return null;
  }
  const dato = fragmento.startsWith('#invitacion=') ? fragmento.slice('#invitacion='.length) : null;
  return sinQuery && esInvitacion(dato) ? dato : null;
}
/** @param {unknown} dato @param {readonly string[]} claves */
function forma(dato, claves) {
  if (!esObjeto(dato) || Object.keys(dato).length !== claves.length || !claves.every((c) => Object.hasOwn(dato, c))) {
    throw new ActivacionNoDisponible('respuesta-invalida');
  }
  return dato;
}
/** @param {unknown} dato @returns {dato is string} */
function fecha(dato) {
  return typeof dato === 'string' && Number.isFinite(Date.parse(dato)) && new Date(dato).toISOString() === dato;
}
/** @param {unknown} dato @returns {InvitacionLeida} */
export function leerVistaInvitacion(dato) {
  const o = forma(dato, ['version', 'institucion', 'caducaEn']);
  const institucion = forma(o.institucion, ['id', 'nombre']);
  if (
    o.version !== 1 ||
    typeof institucion.id !== 'string' ||
    !ID.test(institucion.id) ||
    typeof institucion.nombre !== 'string' ||
    !institucion.nombre ||
    institucion.nombre.length > MAX_NOMBRE ||
    institucion.nombre.trim() !== institucion.nombre ||
    /[\p{C}]/u.test(institucion.nombre) ||
    !fecha(o.caducaEn)
  ) {
    throw new ActivacionNoDisponible('respuesta-invalida');
  }
  return { version: 1, institucion: { id: institucion.id, nombre: institucion.nombre }, caducaEn: o.caducaEn };
}
/** @param {unknown} dato @param {string} institucionId @returns {Clave} */
export function leerClaveActivada(dato, institucionId) {
  const o = forma(dato, ['version', 'client_id', 'client_secret', 'token_endpoint', 'token_type']);
  if (
    o.version !== 1 ||
    typeof o.client_id !== 'string' ||
    !ID.test(o.client_id) ||
    o.client_id !== institucionId ||
    typeof o.client_secret !== 'string' ||
    !secretoCanonico(o.client_secret) ||
    o.token_endpoint !== '/api/socios/v1/token' ||
    o.token_type !== 'Bearer'
  ) {
    throw new ActivacionNoDisponible('respuesta-invalida');
  }
  return {
    version: 1,
    client_id: o.client_id,
    client_secret: o.client_secret,
    token_endpoint: o.token_endpoint,
    token_type: o.token_type,
  };
}
const HTTP_SOLICITUD_INVALIDA = 400;
const HTTP_INVITACION_NO_DISPONIBLE = 410;
const INVITACION_INVALIDA_HTTP = new Set([HTTP_SOLICITUD_INVALIDA, HTTP_INVITACION_NO_DISPONIBLE]);
/** @param {Response} respuesta */
async function leerRespuesta(respuesta) {
  if (!respuesta.ok) {
    throw new ActivacionNoDisponible(
      INVITACION_INVALIDA_HTTP.has(respuesta.status) ? 'invitacion-no-disponible' : 'servicio-no-disponible',
    );
  }
  if (
    !respuesta.headers
      .get('cache-control')
      ?.split(',')
      .some((c) => c.trim().toLowerCase() === 'no-store')
  ) {
    throw new ActivacionNoDisponible('respuesta-invalida');
  }
  const cuerpo = await leerCuerpoDeConectividad(respuesta);
  try {
    return JSON.parse(cuerpo);
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
    throw new ActivacionNoDisponible('respuesta-invalida');
  }
}
/** @param {unknown} error @returns {boolean} */
function falloDeTransporte(error) {
  return (
    error instanceof TypeError || (error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name))
  );
}
/** @param {'consultar'|'activar'} operacion @param {string} invitacion
 * @param {{pedir:typeof fetch,signal:AbortSignal,enLinea:()=>boolean}} opciones */
async function solicitar(operacion, invitacion, { pedir, signal, enLinea }) {
  const corte = new AbortController();
  const cancelar = () => corte.abort();
  signal.addEventListener('abort', cancelar, { once: true });
  if (signal.aborted) {
    cancelar();
  }
  const plazo = setTimeout(cancelar, PLAZO_MS);
  try {
    const respuesta = await pedir(new URL(operacion, BASE).href, {
      method: 'POST',
      credentials: 'same-origin',
      mode: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal: corte.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        [CABECERA_CONTRATO]: String(CONTRATO_API),
      },
      body: JSON.stringify({ invitacion }),
    });
    return await leerRespuesta(respuesta);
  } catch (error) {
    if (error instanceof CuerpoDeConectividadInvalido) {
      throw new ActivacionNoDisponible('respuesta-invalida');
    }
    if (falloDeTransporte(error)) {
      throw new ActivacionNoDisponible(enLinea() ? 'servicio-no-disponible' : 'sin-conexion');
    }
    throw error;
  } finally {
    clearTimeout(plazo);
    signal.removeEventListener('abort', cancelar);
  }
}
/** @typedef {{invitacion:string|null,alCambiar:(estado:EstadoActivacion)=>void,pedir?:typeof fetch,enLinea?:()=>boolean}} OpcionesActivacion */
class Activacion {
  /** @type {string|null} */ #invitacion;
  /** @type {(estado:EstadoActivacion)=>void} */ #alCambiar;
  /** @type {typeof fetch} */ #pedir;
  /** @type {()=>boolean} */ #enLinea;
  /** @type {EstadoActivacion} */ #estado = { estado: 'consultando' };
  #retirada = false;
  #generacion = 0;
  #consumida = false;
  /** @type {AbortController|null} */ #corte = null;
  /** @param {OpcionesActivacion} opciones */
  constructor({
    invitacion,
    alCambiar,
    pedir = fetch,
    enLinea = () => 'onLine' in navigator && navigator.onLine === true,
  }) {
    this.#invitacion = invitacion;
    this.#alCambiar = alCambiar;
    this.#pedir = pedir;
    this.#enLinea = enLinea;
  }
  /** @param {EstadoActivacion} siguiente */
  #publicar(siguiente) {
    this.#estado = siguiente;
    this.#alCambiar(siguiente);
  }
  #empezar() {
    this.#generacion++;
    this.#corte?.abort();
    this.#corte = new AbortController();
    return {
      propia: this.#generacion,
      opciones: { pedir: this.#pedir, signal: this.#corte.signal, enLinea: this.#enLinea },
    };
  }
  /** @param {number} propia @param {EstadoActivacion} estado */
  #publicarVigente(propia, estado) {
    if (!this.#retirada && propia === this.#generacion) {
      this.#publicar(estado);
    }
  }
  /** @param {unknown} error @param {number} propia @param {boolean} activando */
  #fallo(error, propia, activando) {
    /** @type {Motivo} */
    let motivo = error instanceof ActivacionNoDisponible ? error.motivo : 'servicio-no-disponible';
    if (activando) {
      motivo = 'resultado-desconocido';
    }
    this.#publicarVigente(propia, {
      estado: 'error',
      motivo,
      reintentar: !activando && ['sin-conexion', 'servicio-no-disponible'].includes(motivo),
    });
    if (!(error instanceof ActivacionNoDisponible)) {
      throw error;
    }
  }
  async consultar() {
    if (this.#retirada || this.#consumida) {
      return;
    }
    if (!esInvitacion(this.#invitacion)) {
      this.#publicar({ estado: 'error', motivo: 'invitacion-no-disponible', reintentar: false });
      return;
    }
    const { propia, opciones } = this.#empezar();
    this.#publicar({ estado: 'consultando' });
    try {
      const dato = await solicitar('consultar', this.#invitacion, opciones);
      this.#publicarVigente(propia, { estado: 'preparada', lectura: leerVistaInvitacion(dato) });
    } catch (error) {
      this.#fallo(error, propia, false);
    }
  }
  async activar() {
    if (this.#retirada || this.#consumida || this.#estado.estado !== 'preparada' || !esInvitacion(this.#invitacion)) {
      return;
    }
    this.#consumida = true;
    const secreto = this.#invitacion;
    this.#invitacion = null;
    const institucionId = this.#estado.lectura.institucion.id;
    const { propia, opciones } = this.#empezar();
    this.#publicar({ estado: 'generando' });
    try {
      const dato = await solicitar('activar', secreto, opciones);
      this.#publicarVigente(propia, { estado: 'clave', clave: leerClaveActivada(dato, institucionId) });
    } catch (error) {
      this.#fallo(error, propia, true);
    }
  }
  retirar() {
    this.#retirada = true;
    this.#generacion++;
    this.#invitacion = null;
    this.#corte?.abort();
    this.#corte = null;
    this.#publicar({ estado: 'retirada' });
  }
}
/** La activación se inicia a lo sumo una vez. Una respuesta perdida exige otra invitación; no recupera secretos.
 * @param {OpcionesActivacion} opciones */
export function crearActivacion(opciones) {
  return new Activacion(opciones);
}
