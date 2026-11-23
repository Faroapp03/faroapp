// Proyección de instituciones sin huellas. El enlace solo aparece en la respuesta de invitar o renovar.
import { esInvitacion } from '../scripts/conectividad/invitacion.js';
import { leerContactoPublico } from '../scripts/contacto-publico.js';
import { respuestaAdministrativaInvalida as invalido, objetoAdministrativo as objeto } from './contrato-comun.js';
import { leerSesionActiva } from './contratos.js';

/** @typedef {import('../../src/administracion/instituciones.ts').RegistroInstituciones} RegistroInstituciones */
/** @typedef {import('../../src/administracion/instituciones.ts').Institucion} Institucion */
/** @typedef {import('../../src/administracion/instituciones.ts').ClaveInstitucion} ClaveInstitucion */
/** @typedef {import('../../src/administracion/instituciones.ts').EnlaceInvitacion} EnlaceInvitacion */
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const ID = new RegExp(`^inst-${UUID}$`);
const CLAVE_ID = new RegExp(`^${UUID}$`);
const MAX_INSTITUCIONES = 100;
const MAX_CLAVES = 2;
const MAX_NOMBRE = 120;
const RUTA_INVITACION = '/activar-acceso.html#invitacion=';
/** @param {unknown} dato @returns {dato is number} */
function contador(dato) {
  return typeof dato === 'number' && Number.isSafeInteger(dato) && dato >= 0 && dato < Number.MAX_SAFE_INTEGER;
}
/** @param {unknown} dato @returns {string} */
function fecha(dato) {
  if (typeof dato !== 'string' || !Number.isFinite(Date.parse(dato)) || new Date(dato).toISOString() !== dato) {
    return invalido();
  }
  return dato;
}
/** @param {unknown} dato @returns {string|null} */
function fechaOpcional(dato) {
  return dato === null ? null : fecha(dato);
}
/** @param {unknown} dato @returns {ClaveInstitucion} */
function leerClave(dato) {
  const o = objeto(dato, ['id', 'creadaEn', 'ultimaConexion']);
  if (typeof o.id !== 'string' || !CLAVE_ID.test(o.id)) {
    return invalido();
  }
  return { id: o.id, creadaEn: fecha(o.creadaEn), ultimaConexion: fechaOpcional(o.ultimaConexion) };
}
/** @param {unknown} dato @returns {string} */
function nombreInstitucion(dato) {
  if (typeof dato !== 'string' || !dato || dato.length > MAX_NOMBRE || dato.trim() !== dato || /[\p{C}]/u.test(dato)) {
    return invalido();
  }
  return dato;
}
/** El correo es una ficha administrativa opcional, no acredita identidad ni recibe envíos del servidor.
 * @param {unknown} dato @returns {string|null} */
function correoInstitucion(dato) {
  if (dato === null) {
    return null;
  }
  if (typeof dato !== 'string' || dato === '') {
    return invalido();
  }
  try {
    return leerContactoPublico({ responsable: '', correo: dato }).correo;
  } catch (error) {
    if (error instanceof TypeError) {
      return invalido();
    }
    throw error;
  }
}
/** @param {unknown} dato @returns {{nombre:string,correo:string|null}} */
export function leerDatosInvitacion(dato) {
  const o = objeto(dato, ['nombre', 'correo']);
  return { nombre: nombreInstitucion(o.nombre), correo: correoInstitucion(o.correo) };
}
/** @param {unknown} dato @returns {string} */
export function leerIdInstitucion(dato) {
  if (typeof dato !== 'string' || !ID.test(dato)) {
    return invalido();
  }
  return dato;
}
/** @param {unknown} dato @returns {string} */
export function leerIdClave(dato) {
  if (typeof dato !== 'string' || !CLAVE_ID.test(dato)) {
    return invalido();
  }
  return dato;
}
/** @param {unknown} dato @returns {Institucion} */
function leerInstitucion(dato) {
  const o = objeto(dato, ['id', 'nombre', 'correo', 'estado', 'ultimaConexion', 'consultas', 'invitacion', 'claves']);
  if (typeof o.id !== 'string' || !ID.test(o.id) || !contador(o.consultas)) {
    return invalido();
  }
  const nombre = nombreInstitucion(o.nombre);
  const correo = correoInstitucion(o.correo);
  if (
    (o.estado !== 'invitada' && o.estado !== 'activa' && o.estado !== 'retirada') ||
    !Array.isArray(o.claves) ||
    o.claves.length > MAX_CLAVES
  ) {
    return invalido();
  }
  const claves = o.claves.map(leerClave);
  if (new Set(claves.map((c) => c.id)).size !== claves.length || (o.estado === 'activa') !== claves.length > 0) {
    return invalido();
  }
  const invitacion = o.invitacion === null ? null : { caducaEn: fecha(objeto(o.invitacion, ['caducaEn']).caducaEn) };
  if (o.estado === 'retirada' && invitacion !== null) {
    return invalido();
  }
  return {
    id: o.id,
    nombre,
    correo,
    estado: o.estado,
    ultimaConexion: fechaOpcional(o.ultimaConexion),
    consultas: o.consultas,
    invitacion,
    claves,
  };
}
/** @param {unknown} dato @returns {RegistroInstituciones} */
export function leerRegistroInstituciones(dato) {
  const o = objeto(dato, ['version', 'revision', 'instituciones']);
  if (
    o.version !== 1 ||
    !contador(o.revision) ||
    !Array.isArray(o.instituciones) ||
    o.instituciones.length > MAX_INSTITUCIONES
  ) {
    return invalido();
  }
  const instituciones = o.instituciones.map(leerInstitucion);
  if (new Set(instituciones.map((i) => i.id)).size !== instituciones.length) {
    return invalido();
  }
  return { version: 1, revision: o.revision, instituciones };
}
/** @param {unknown} dato @returns {EnlaceInvitacion} */
export function leerEnlaceInvitacion(dato) {
  const o = objeto(dato, ['enlaceRelativo', 'caducaEn']);
  if (
    typeof o.enlaceRelativo !== 'string' ||
    !o.enlaceRelativo.startsWith(RUTA_INVITACION) ||
    !esInvitacion(o.enlaceRelativo.slice(RUTA_INVITACION.length))
  ) {
    return invalido();
  }
  return { enlaceRelativo: o.enlaceRelativo, caducaEn: fecha(o.caducaEn) };
}
/** @param {unknown} dato @param {boolean} [conInvitacion] */
export function leerLecturaInstituciones(dato, conInvitacion = false) {
  const o = objeto(
    dato,
    conInvitacion ? ['estado', 'sesion', 'registro', 'invitacion'] : ['estado', 'sesion', 'registro'],
  );
  if (o.estado !== 'activa') {
    return invalido();
  }
  return {
    sesion: leerSesionActiva(o.sesion),
    registro: leerRegistroInstituciones(o.registro),
    invitacion: conInvitacion ? leerEnlaceInvitacion(o.invitacion) : null,
  };
}
/** El enlace raíz se resuelve en el origen actual; nunca acepta un destino externo ni una query con el secreto.
 * @param {EnlaceInvitacion} invitacion @param {string} origen */
export function direccionDeInvitacion(invitacion, origen) {
  const leida = leerEnlaceInvitacion(invitacion);
  const direccion = new URL(leida.enlaceRelativo, origen);
  if (
    direccion.origin !== new URL(origen).origin ||
    direccion.pathname !== '/activar-acceso.html' ||
    direccion.search !== ''
  ) {
    return invalido();
  }
  return direccion.href;
}
