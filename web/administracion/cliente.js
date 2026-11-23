import { leerPoliticaSecciones } from '../scripts/secciones-contrato.js';
import { leerLecturaAccesos, leerNumeroPagina } from './accesos-contrato.js';
import { limiteRespuesta } from './limites-respuesta.js';

export { MAX_RESPUESTA_PANEL_BYTES } from './limites-respuesta.js';

import { crearOperacionesAdministradores } from './cliente-administradores.js';
import { ACEPTADA, crearOperacionCierre } from './cliente-cierre.js';
import { crearOperacionesEncuesta } from './cliente-encuesta.js';
import { crearLecturasSesionUnica } from './cliente-sesion-unica.js';
import { crearOperacionesVigilante } from './cliente-vigilante.js';
import { objetoAdministrativo, RespuestaAdministrativaInvalida } from './contrato-comun.js';
import { esPanelOcupado } from './contrato-sesion-unica.js';
import {
  leerActividad,
  leerActualizacion,
  leerApertura,
  leerCambio,
  leerCambioSecciones,
  leerCierre,
  leerError,
  leerLectura,
  leerLecturaActivacion,
  leerLecturaDatos,
  leerLecturaSecciones,
  leerLecturaTrabajo,
  leerPoliticaControles,
  leerReconciliacion,
  leerRetirada,
} from './contratos.js';
import { AGOTADO, AVISOS_DE_RECHAZO, CONFLICTO, EXITO, NO_DISPONIBLE, PROHIBIDO } from './estados-http-panel.js';
import {
  leerDatosInvitacion,
  leerIdClave,
  leerIdInstitucion,
  leerLecturaInstituciones,
} from './instituciones-contrato.js';
import { leerLecturaOcultas } from './ocultas-contrato.js';

/** @typedef {import('../../src/administracion/controles.ts').PoliticaControles} PoliticaControles */
/** @typedef {import('../../src/administracion/controles.ts').DocumentoControles} DocumentoControles */
/** @typedef {import('../../src/administracion/sesion.ts').SesionPanelActiva} SesionPanelActiva */
/** @typedef {import('./estado-datos.js').EstadoDatosPanel} EstadoDatosPanel */
/** @typedef {import('./estado-trabajos.js').EstadoTrabajos} EstadoTrabajos */
/** @typedef {import('./estado-activacion.js').EstadoActivacion} EstadoActivacion */
/** @typedef {import('../scripts/secciones-contrato.js').DocumentoSecciones} DocumentoSecciones */
/** @typedef {import('../scripts/secciones-contrato.js').PoliticaSecciones} PoliticaSecciones */
/** @typedef {import('../../src/administracion/instituciones.ts').RegistroInstituciones} RegistroInstituciones */
/** @typedef {import('../../src/administracion/instituciones.ts').EnlaceInvitacion} EnlaceInvitacion */
/** @typedef {import('../../src/administracion/accesos.ts').PaginaAccesos} PaginaAccesos */
/** @typedef {import('./ocultas-contrato.js').LecturaOcultas} LecturaOcultas */
/** @typedef {'actualizar-datos'|'reintentar-pendientes'} AccionActualizacion */
/** @typedef {'ocultas_no_disponibles'|'accesos_no_disponibles'|'instituciones_no_disponibles'|'instituciones_inciertas'|'revision_instituciones_conflictiva'|'limite_instituciones'|'dos_claves_activas'|'institucion_no_encontrada'|'instituciones_confirmadas'|'secciones_no_disponibles'|'secciones_inciertas'|'revision_secciones_conflictiva'|'secciones_guardadas'|'activacion_no_disponible'|'recuperacion_incierta'|'trabajo_retirado'|'trabajo_en_curso'|'trabajo_sin_ejecucion'|'trabajo_terminado'|'trabajos_no_disponibles'|'actualizacion_incierta'|'trabajo_ocupado'|'revision_trabajos_conflictiva'|'sin_conexion'|'tiempo_agotado'|'respuesta_invalida'|'resultado_desconocido'|'acceso_denegado'|'no_disponible'|'solicitud_rechazada'|'revision_conflictiva'|'sesion_sustituida'|'sesion_inactiva'|'panel_ocupado'|'correo_no_verificado'|'no_es_administrador'|'segundo_factor_requerido'|'datos_no_disponibles'|'vigilante_configuracion_invalida'|'vigilante_no_disponible'|'vigilante_conflicto'} AvisoPanel */
/** @typedef {'inicial'|'cargando'|'desconectada'|'sustituida'|'caducada'|'cerrada'|'error'} EstadoInactivo */
/** @typedef {Readonly<{estado:EstadoInactivo, aviso:AvisoPanel|null}> |
 * Readonly<{estado:'activa', ocupado:boolean, controles:DocumentoControles, sesion:SesionPanelActiva,
 * conflicto:boolean, aviso:AvisoPanel|null, datos:EstadoDatosPanel|null, datosDeLaActualizacionAnterior?:boolean, trabajos:EstadoTrabajos|null, activacion:EstadoActivacion|null,
 * ocultas?:LecturaOcultas|null,avisoOcultas?:AvisoPanel|null,accesos?:PaginaAccesos|null,avisoAccesos?:AvisoPanel|null,
 * registroInstituciones?:RegistroInstituciones|null,invitacion?:EnlaceInvitacion|null,institucionesPendientes?:boolean,avisoInstituciones?:AvisoPanel|null,
 * secciones?:DocumentoSecciones|null, seccionesPendientes?:boolean, controlesPendientes?:boolean, avisoSecciones?:AvisoPanel|null}>} EstadoClientePanel */
/** @typedef {'ocultas'|'accesos'|'instituciones'|'invitar'|'renovar'|'retirar-institucion'|'retirar-clave'|'secciones'|'cambiar-secciones'|'leer-controles'|'abrir'|'comprobar'|'mantener'|'cambiar'|'cerrar'|'datos'|'trabajos'|'actualizar'|'retirar'|'reconciliar'|'activacion'|'cerrar-publicacion'|'vigilante'|'avisos'|'encuesta'|'administradores'} Operacion */
/** @typedef {{control:AbortController, generacion:number, anterior:EstadoClientePanel, operacion:Operacion,
 * mutacion:boolean, promesa:Promise<EstadoClientePanel>}} Trabajo */
/** @typedef {{ocultas:LecturaOcultas|null,avisoOcultas:AvisoPanel|null,accesos:PaginaAccesos|null,avisoAccesos:AvisoPanel|null,registroInstituciones:RegistroInstituciones|null,invitacion:EnlaceInvitacion|null,revisionInstituciones:number|null,institucionesPendientes:boolean,avisoInstituciones:AvisoPanel|null,token:string, sesion:SesionPanelActiva|null, revision:number|null, activacion:EstadoActivacion|null, ultimaActivacion:EstadoActivacion|null, avisoActivacion:AvisoPanel|null, datos:EstadoDatosPanel|null, datosDeLaActualizacionAnterior:boolean, trabajos:EstadoTrabajos|null, ultimoEstadoTrabajos:EstadoTrabajos|null, avisoTrabajos:AvisoPanel|null, requiereLecturaTrabajo:boolean, estado:EstadoClientePanel,
 * secciones:DocumentoSecciones|null, ultimasSecciones:DocumentoSecciones|null, requiereLecturaSecciones:boolean, controlesPendientes:boolean, avisoSecciones:AvisoPanel|null,
 * trabajo:Trabajo|null, generacion:number, destruido:boolean, pedir:typeof fetch,
 * alCambiar:(estado:EstadoClientePanel)=>void}} Privado */
/** @typedef {{pedir?:typeof fetch, alCambiar:(estado:EstadoClientePanel)=>void}} OpcionesClientePanel */

export const PLAZO_PANEL_CLIENTE_MS = 6000;
const OPERACIONES_INSTITUCION = new Set([
  'instituciones',
  'invitar',
  'renovar',
  'retirar-institucion',
  'retirar-clave',
]);
const AVISO_PROPIO = new Set(['vigilante', 'avisos', 'encuesta', 'administradores']); // Su vista explica el fallo; no retira los demás controles.
const ABRIBLES = new Set(['inicial', 'cerrada', 'sustituida', 'caducada', 'error']);

export class FalloPanel extends Error {
  /** @param {AvisoPanel} aviso @param {boolean} [confirmado] */
  constructor(aviso, confirmado = false) {
    super('Operación administrativa no confirmada');
    this.aviso = aviso;
    this.confirmado = confirmado;
  }
}
/** @param {Privado} privado @param {Trabajo} trabajo */
function vigente(privado, trabajo) {
  return !privado.destruido && privado.trabajo === trabajo && privado.generacion === trabajo.generacion;
}
/** @param {Privado} privado @param {EstadoClientePanel} estado */
function publicar(privado, estado) {
  const actualizado =
    estado.estado === 'activa'
      ? {
          ...estado,
          ocultas: privado.ocultas,
          avisoOcultas: privado.avisoOcultas,
          accesos: privado.accesos,
          avisoAccesos: privado.avisoAccesos,
          registroInstituciones: privado.registroInstituciones,
          invitacion: privado.invitacion,
          institucionesPendientes: privado.institucionesPendientes,
          avisoInstituciones: privado.avisoInstituciones,
          secciones: privado.secciones,
          seccionesPendientes: privado.requiereLecturaSecciones,
          controlesPendientes: privado.controlesPendientes,
          avisoSecciones: privado.avisoSecciones,
        }
      : estado;
  privado.estado = Object.freeze(actualizado);
  privado.alCambiar(privado.estado);
}
/** @param {Privado} privado @param {EstadoInactivo} estado @param {AvisoPanel|null} [aviso] */
function retirar(privado, estado, aviso = null) {
  publicar(privado, { estado, aviso });
}
/** @param {Privado} privado */
function olvidar(privado) {
  privado.ocultas = null;
  privado.avisoOcultas = null;
  privado.accesos = null;
  privado.avisoAccesos = null;
  privado.registroInstituciones = null;
  privado.invitacion = null;
  privado.revisionInstituciones = null;
  privado.institucionesPendientes = false;
  privado.avisoInstituciones = null;
  privado.secciones = null;
  privado.ultimasSecciones = null;
  privado.requiereLecturaSecciones = false;
  privado.controlesPendientes = false;
  privado.avisoSecciones = null;
  privado.token = '';
  privado.sesion = null;
  privado.revision = null;
  privado.datos = null;
  privado.datosDeLaActualizacionAnterior = false;
  privado.activacion = null;
  privado.ultimaActivacion = null;
  privado.avisoActivacion = null;
  privado.trabajos = null;
  privado.ultimoEstadoTrabajos = null;
  privado.avisoTrabajos = null;
  privado.requiereLecturaTrabajo = false;
}
/** @param {Privado} privado @param {SesionPanelActiva} sesion */
function comprobarContinuidad(privado, sesion) {
  const anterior = privado.sesion;
  if (
    anterior &&
    (sesion.iniciadaEn !== anterior.iniciadaEn || sesion.ultimaActividadEn < anterior.ultimaActividadEn)
  ) {
    throw new FalloPanel('respuesta_invalida');
  }
}
/** @param {Privado} privado @param {{controles:DocumentoControles,sesion:SesionPanelActiva}} datos @param {boolean} [conflicto] */
function activar(privado, datos, conflicto = false) {
  comprobarContinuidad(privado, datos.sesion);
  if (privado.revision !== null && datos.controles.revision < privado.revision) {
    throw new FalloPanel('respuesta_invalida');
  }
  privado.sesion = Object.freeze(datos.sesion);
  privado.revision = datos.controles.revision;
  if (privado.secciones && privado.secciones.revision < datos.controles.revision) {
    privado.secciones = null;
    privado.requiereLecturaSecciones = true;
    privado.avisoSecciones = null;
  }
  publicar(privado, {
    estado: 'activa',
    ocupado: false,
    controles: Object.freeze(datos.controles),
    sesion: privado.sesion,
    conflicto,
    aviso: conflicto ? 'revision_conflictiva' : (privado.avisoTrabajos ?? privado.avisoActivacion),
    datos: privado.datos,
    datosDeLaActualizacionAnterior: privado.datosDeLaActualizacionAnterior,
    activacion: privado.activacion,
    trabajos: privado.trabajos,
  });
}
/** @template T @param {Promise<T>} promesa @param {AbortSignal} senal @returns {Promise<T>} */
async function cancelable(promesa, senal) {
  /** @type {(razon?:unknown)=>void} */
  let fallar = () => {};
  /** @type {Promise<never>} */
  const cancelada = new Promise((_, rechazar) => {
    fallar = rechazar;
  });
  const cancelar = () => fallar(senal.reason);
  senal.addEventListener('abort', cancelar, { once: true });
  try {
    senal.throwIfAborted();
    return await Promise.race([promesa, cancelada]);
  } finally {
    senal.removeEventListener('abort', cancelar);
  }
}
/** @param {Response} respuesta @param {AbortSignal} senal @param {number} maximo @returns {Promise<unknown>} */
async function jsonAcotado(respuesta, senal, maximo) {
  const tipo = respuesta.headers.get('content-type') ?? '';
  const declarado = respuesta.headers.get('content-length');
  if (
    respuesta.redirected ||
    !/^application\/json(?:;\s*charset=utf-8)?$/i.test(tipo) ||
    (declarado !== null && (!/^(0|[1-9]\d*)$/.test(declarado) || Number(declarado) > maximo)) ||
    !respuesta.body
  ) {
    await respuesta.body?.cancel().catch(() => {});
    throw new FalloPanel('respuesta_invalida');
  }
  const lector = respuesta.body.getReader();
  const cancelar = () => {
    void lector.cancel().catch(() => {});
  };
  senal.addEventListener('abort', cancelar, { once: true });
  let total = 0;
  let texto = '';
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    for (;;) {
      senal.throwIfAborted();
      const { done, value } = await lector.read();
      senal.throwIfAborted();
      if (done) {
        return JSON.parse(texto + decoder.decode());
      }
      total += value.byteLength;
      if (total > maximo) {
        cancelar();
        throw new FalloPanel('respuesta_invalida');
      }
      texto += decoder.decode(value, { stream: true });
    }
  } catch (error) {
    cancelar();
    throw error;
  } finally {
    senal.removeEventListener('abort', cancelar);
    lector.releaseLock();
  }
}
/** @param {Privado} privado @param {Trabajo} trabajo @param {{ruta:string,cuerpo:object,token:string}} pedido */
async function enviar(privado, trabajo, pedido) {
  const reloj = setTimeout(() => trabajo.control.abort(new FalloPanel('tiempo_agotado')), PLAZO_PANEL_CLIENTE_MS);
  try {
    const llamada = Promise.resolve().then(async () => {
      trabajo.control.signal.throwIfAborted();
      const pedir = privado.pedir;
      const respuesta = await pedir(`/administracion/api/${pedido.ruta}`, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        mode: 'same-origin',
        referrerPolicy: 'same-origin',
        redirect: 'error',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-faro-panel': '1',
          ...(pedido.token ? { 'x-faro-sesion': pedido.token } : {}),
        },
        body: JSON.stringify(pedido.cuerpo),
        signal: trabajo.control.signal,
      });
      const maximo = limiteRespuesta(pedido.ruta);
      return { estado: respuesta.status, cuerpo: await jsonAcotado(respuesta, trabajo.control.signal, maximo) };
    });
    return await cancelable(llamada, trabajo.control.signal);
  } finally {
    clearTimeout(reloj);
  }
}
/** @param {{estado:number,cuerpo:unknown}} respuesta @returns {never} */
function rechazar(respuesta) {
  if (respuesta.estado === CONFLICTO && esPanelOcupado(respuesta.cuerpo)) {
    throw new FalloPanel('panel_ocupado', true);
  }
  const error = leerError(respuesta.cuerpo);
  if (
    (respuesta.estado === NO_DISPONIBLE &&
      ['vigilante_configuracion_invalida', 'vigilante_no_disponible'].includes(error)) ||
    (respuesta.estado === CONFLICTO && error === 'vigilante_conflicto')
  ) {
    throw new FalloPanel(/** @type {AvisoPanel} */ (error), true);
  }
  if (respuesta.estado === CONFLICTO && error === 'sesion_sustituida') {
    throw new FalloPanel('sesion_sustituida', true);
  }
  // La sesión del panel no tiene esquema HTTP: el servidor la da por inactiva con un 403 y este cuerpo.
  if (respuesta.estado === PROHIBIDO && error === 'sesion_inactiva') {
    throw new FalloPanel('sesion_inactiva', true);
  }
  const aviso = AVISOS_DE_RECHAZO.get(`${respuesta.estado}:${error}`);
  if (!aviso) {
    throw new FalloPanel('respuesta_invalida');
  }
  throw new FalloPanel(
    /** @type {AvisoPanel} */ (aviso),
    respuesta.estado !== NO_DISPONIBLE && respuesta.estado !== AGOTADO,
  );
}
/** @param {Privado} privado @param {Trabajo} trabajo @param {boolean} [explicita] */
async function leer(privado, trabajo, explicita = false) {
  const respuesta = await enviar(privado, trabajo, { ruta: 'controles/leer', cuerpo: {}, token: privado.token });
  if (!vigente(privado, trabajo)) {
    return;
  }
  if (respuesta.estado !== EXITO) {
    rechazar(respuesta);
  }
  const lectura = leerLectura(respuesta.cuerpo);
  if (explicita) {
    privado.controlesPendientes = false;
  } else if (privado.revision !== null && lectura.controles.revision !== privado.revision) {
    privado.controlesPendientes = true;
  }
  activar(privado, lectura);
}
/** @param {Privado} privado @param {Trabajo} trabajo @param {unknown} error */
function fallo(privado, trabajo, error) {
  if (!vigente(privado, trabajo)) {
    return;
  }
  const conocido = error instanceof FalloPanel ? error : null;
  let aviso = conocido?.aviso ?? (error instanceof TypeError ? 'sin_conexion' : 'respuesta_invalida');
  if (aviso === 'sesion_sustituida' || aviso === 'sesion_inactiva') {
    olvidar(privado);
    retirar(privado, aviso === 'sesion_sustituida' ? 'sustituida' : 'caducada', aviso);
    return;
  }
  if (trabajo.mutacion && !conocido?.confirmado) {
    aviso = 'resultado_desconocido';
  }
  if (trabajo.operacion === 'cerrar') {
    retirar(privado, 'cerrada', aviso);
    return;
  }
  if (!presentarFalloCapacidad(privado, trabajo, aviso)) {
    presentarFallo(privado, trabajo, aviso);
  }
}
/** @param {Privado} privado @param {Trabajo} trabajo @param {AvisoPanel} aviso */
function presentarFalloCapacidad(privado, trabajo, aviso) {
  return (
    presentarFalloOcultas(privado, trabajo, aviso) ||
    presentarFalloAccesos(privado, trabajo, aviso) ||
    presentarFalloInstituciones(privado, trabajo, aviso) ||
    presentarFalloSecciones(privado, trabajo, aviso)
  );
}
/** Un fallo de lectura no se presenta como una página vacía ni retira otros controles del panel.
 * @param {Privado} privado @param {Trabajo} trabajo @param {AvisoPanel} aviso */
function presentarFalloAccesos(privado, trabajo, aviso) {
  if (trabajo.operacion !== 'accesos' || trabajo.anterior.estado !== 'activa' || aviso === 'acceso_denegado') {
    return false;
  }
  privado.accesos = null;
  privado.avisoAccesos = 'accesos_no_disponibles';
  publicar(privado, { ...trabajo.anterior, ocupado: false, aviso: privado.avisoAccesos });
  return true;
}
/** Una mutación incierta se resuelve leyendo; nunca se reenvía una invitación sin otra decisión explícita.
 * @param {Privado} privado @param {Trabajo} trabajo @param {AvisoPanel} aviso */
function presentarFalloInstituciones(privado, trabajo, aviso) {
  if (
    !OPERACIONES_INSTITUCION.has(trabajo.operacion) ||
    trabajo.anterior.estado !== 'activa' ||
    aviso === 'acceso_denegado'
  ) {
    return false;
  }
  privado.registroInstituciones = null;
  privado.invitacion = null;
  privado.institucionesPendientes = true;
  let mensaje = aviso;
  if (aviso === 'resultado_desconocido') {
    mensaje = 'instituciones_inciertas';
  } else if (
    ![
      'revision_instituciones_conflictiva',
      'limite_instituciones',
      'dos_claves_activas',
      'institucion_no_encontrada',
    ].includes(aviso)
  ) {
    mensaje = 'instituciones_no_disponibles';
  }
  privado.avisoInstituciones = mensaje;
  publicar(privado, { ...trabajo.anterior, ocupado: false, aviso: mensaje });
  return true;
}
/** @param {Privado} privado @param {Trabajo} trabajo @param {AvisoPanel} aviso */
function presentarFalloSecciones(privado, trabajo, aviso) {
  if (
    ['secciones', 'cambiar-secciones'].includes(trabajo.operacion) &&
    trabajo.anterior.estado === 'activa' &&
    aviso !== 'acceso_denegado'
  ) {
    privado.secciones = null;
    privado.requiereLecturaSecciones = true;
    const incierto = trabajo.mutacion && aviso === 'resultado_desconocido';
    privado.avisoSecciones = incierto ? 'secciones_inciertas' : 'secciones_no_disponibles';
    privado.controlesPendientes ||= incierto;
    publicar(privado, { ...trabajo.anterior, ocupado: false, aviso: privado.avisoSecciones });
    return true;
  }
  return false;
}
/** @param {Privado} privado @param {Trabajo} trabajo @param {AvisoPanel} aviso */
function presentarFallo(privado, trabajo, aviso) {
  if (AVISO_PROPIO.has(trabajo.operacion) && trabajo.anterior.estado === 'activa' && aviso !== 'acceso_denegado') {
    publicar(privado, { ...trabajo.anterior, ocupado: false, aviso });
    return;
  }
  if (
    ['trabajos', 'actualizar', 'retirar', 'reconciliar'].includes(trabajo.operacion) &&
    trabajo.anterior.estado === 'activa' &&
    aviso !== 'acceso_denegado'
  ) {
    presentarFalloTrabajo(privado, trabajo, trabajo.anterior, aviso);
    return;
  }
  if (trabajo.operacion === 'activacion' && trabajo.anterior.estado === 'activa' && aviso !== 'acceso_denegado') {
    privado.activacion = null;
    privado.avisoActivacion = 'activacion_no_disponible';
    publicar(privado, { ...trabajo.anterior, ocupado: false, activacion: null, aviso: privado.avisoActivacion });
    return;
  }
  if (trabajo.operacion === 'datos' && trabajo.anterior.estado === 'activa' && aviso !== 'acceso_denegado') {
    privado.datos = null;
    privado.datosDeLaActualizacionAnterior = false;
    publicar(privado, { ...trabajo.anterior, ocupado: false, datos: null, aviso: 'datos_no_disponibles' });
    return;
  }
  const rechazo = aviso === 'solicitud_rechazada';
  if (rechazo && trabajo.anterior.estado === 'activa') {
    publicar(privado, { ...trabajo.anterior, ocupado: false, aviso });
    return;
  }
  retirar(privado, privado.token ? 'desconectada' : 'error', aviso);
}
/** @param {Privado} privado @param {Trabajo} trabajo
 * @param {Extract<EstadoClientePanel,{estado:'activa'}>} anterior @param {AvisoPanel} aviso */
function presentarFalloTrabajo(privado, trabajo, anterior, aviso) {
  privado.trabajos = null;
  privado.avisoTrabajos = 'trabajos_no_disponibles';
  if (trabajo.mutacion) {
    privado.avisoTrabajos = aviso;
    if (aviso === 'resultado_desconocido') {
      privado.avisoTrabajos = trabajo.operacion === 'actualizar' ? 'actualizacion_incierta' : 'recuperacion_incierta';
      privado.requiereLecturaTrabajo = true;
    }
  }
  publicar(privado, { ...anterior, ocupado: false, trabajos: null, aviso: privado.avisoTrabajos });
}
/** @param {Privado} privado @param {Operacion} operacion @param {(trabajo:Trabajo)=>Promise<void>} accion */
function ejecutar(privado, operacion, accion) {
  if (privado.destruido || privado.trabajo) {
    return Promise.resolve(privado.estado);
  }
  /** @type {Trabajo} */
  const trabajo = {
    control: new AbortController(),
    generacion: ++privado.generacion,
    anterior: privado.estado,
    operacion,
    mutacion: operacion === 'abrir' || operacion === 'cambiar' || operacion === 'cerrar',
    promesa: Promise.resolve(privado.estado),
  };
  privado.trabajo = trabajo;
  publicar(
    privado,
    privado.estado.estado === 'activa' ? { ...privado.estado, ocupado: true } : { estado: 'cargando', aviso: null },
  );
  trabajo.promesa = Promise.resolve()
    .then(() => accion(trabajo))
    .catch((error) => fallo(privado, trabajo, error))
    .then(() => {
      if (privado.trabajo === trabajo) {
        privado.trabajo = null;
      }
      return privado.estado;
    });
  return trabajo.promesa;
}
/** Retomar solo sale de una decisión explícita; otra identidad siempre bloquea. @param {Privado} privado @param {boolean} retomar */
function abrir(privado, retomar) {
  if (privado.token || !ABRIBLES.has(privado.estado.estado)) {
    return Promise.resolve(privado.estado);
  }
  return ejecutar(privado, 'abrir', async (trabajo) => {
    const respuesta = await enviar(privado, trabajo, { ruta: 'sesion/abrir', cuerpo: { retomar }, token: '' });
    if (!vigente(privado, trabajo)) {
      return;
    }
    if (respuesta.estado !== EXITO) {
      rechazar(respuesta);
    }
    const apertura = leerApertura(respuesta.cuerpo);
    privado.token = apertura.token;
    privado.sesion = apertura.sesion;
    trabajo.mutacion = false;
    await leer(privado, trabajo, true);
  });
}
/** @param {Privado} privado */
function mantener(privado) {
  const anterior = privado.estado;
  if (anterior.estado !== 'activa' || !privado.token) {
    return Promise.resolve(anterior);
  }
  return ejecutar(privado, 'mantener', async (trabajo) => {
    const respuesta = await enviar(privado, trabajo, { ruta: 'sesion/actividad', cuerpo: {}, token: privado.token });
    if (!vigente(privado, trabajo)) {
      return;
    }
    if (respuesta.estado !== EXITO) {
      rechazar(respuesta);
    }
    activar(privado, { controles: anterior.controles, sesion: leerActividad(respuesta.cuerpo) }, anterior.conflicto);
  });
}
/** Una lectura explícita: no descarga fuentes, no renueva actividad y no reclama la sesión. @param {Privado} privado */
function consultarDatos(privado) {
  const anterior = privado.estado;
  if (anterior.estado !== 'activa' || !privado.token) {
    return Promise.resolve(anterior);
  }
  return ejecutar(privado, 'datos', async (trabajo) => {
    const respuesta = await enviar(privado, trabajo, { ruta: 'datos/estado', cuerpo: {}, token: privado.token });
    if (!vigente(privado, trabajo)) {
      return;
    }
    if (respuesta.estado !== EXITO) {
      rechazar(respuesta);
    }
    const lectura = leerLecturaDatos(respuesta.cuerpo);
    comprobarContinuidad(privado, lectura.sesion);
    privado.datos = lectura.datos;
    // La marca viene del servidor, que sabe si después se ha reservado otra actualización; aquí no se deduce.
    privado.datosDeLaActualizacionAnterior = lectura.deLaActualizacionAnterior;
    activar(privado, { controles: anterior.controles, sesion: lectura.sesion }, anterior.conflicto);
  });
}
/** Observa el registro durable; esta lectura no activa ni publica una generación. @param {Privado} privado */
function consultarActivacion(privado) {
  const anterior = privado.estado;
  if (anterior.estado !== 'activa' || !privado.token) {
    return Promise.resolve(anterior);
  }
  return ejecutar(privado, 'activacion', async (trabajo) => {
    const respuesta = await enviar(privado, trabajo, { ruta: 'datos/activacion', cuerpo: {}, token: privado.token });
    if (!vigente(privado, trabajo)) {
      return;
    }
    if (respuesta.estado !== EXITO) {
      rechazar(respuesta);
    }
    const lectura = leerLecturaActivacion(respuesta.cuerpo);
    comprobarContinuidad(privado, lectura.sesion);
    const previa = privado.ultimaActivacion;
    if (
      previa &&
      (lectura.activacion.revision < previa.revision ||
        (lectura.activacion.revision === previa.revision &&
          JSON.stringify(lectura.activacion) !== JSON.stringify(previa)))
    ) {
      throw new FalloPanel('respuesta_invalida');
    }
    privado.activacion = lectura.activacion;
    privado.ultimaActivacion = lectura.activacion;
    privado.avisoActivacion = null;
    activar(privado, { controles: anterior.controles, sesion: lectura.sesion }, anterior.conflicto);
  });
}
/** Rechaza retrocesos incluso si una consulta anterior dejó de ser visible por un fallo de red.
 * @param {Privado} privado @param {EstadoTrabajos} trabajos */
function comprobarTrabajos(privado, trabajos) {
  const anterior = privado.ultimoEstadoTrabajos;
  if (!anterior) {
    return;
  }
  if (
    trabajos.revision < anterior.revision ||
    (trabajos.revision === anterior.revision && JSON.stringify(trabajos) !== JSON.stringify(anterior))
  ) {
    throw new FalloPanel('respuesta_invalida');
  }
  const previo = anterior.ultimoTrabajo;
  const actual = trabajos.ultimoTrabajo;
  if (!previo || !actual) {
    return;
  }
  if (previo.solicitudId !== actual.solicitudId) {
    if (actual.revisionBase < anterior.revision) {
      throw new FalloPanel('respuesta_invalida');
    }
    return;
  }
  comprobarTrabajoAnterior(previo, actual);
}
/** @param {NonNullable<EstadoTrabajos['ultimoTrabajo']>} previo
 * @param {NonNullable<EstadoTrabajos['ultimoTrabajo']>} actual */
function comprobarTrabajoAnterior(previo, actual) {
  const orden = { 'despacho-incierto': 0, despachado: 1, terminado: 2 };
  if (
    actual.accion !== previo.accion ||
    actual.revisionBase !== previo.revisionBase ||
    actual.revisionReserva !== previo.revisionReserva ||
    actual.creadoEn !== previo.creadoEn ||
    actual.actualizadoEn < previo.actualizadoEn ||
    orden[actual.estado] < orden[previo.estado] ||
    (previo.runId !== null && actual.runId !== previo.runId) ||
    (previo.resultado !== null && JSON.stringify(previo.resultado) !== JSON.stringify(actual.resultado))
  ) {
    throw new FalloPanel('respuesta_invalida');
  }
}
/** @param {Privado} privado @param {SesionPanelActiva} sesion @param {EstadoTrabajos} trabajos
 * @param {AvisoPanel|null} [aviso] */
function guardarTrabajos(privado, sesion, trabajos, aviso = null) {
  comprobarContinuidad(privado, sesion);
  comprobarTrabajos(privado, trabajos);
  privado.sesion = Object.freeze(sesion);
  privado.trabajos = trabajos;
  privado.ultimoEstadoTrabajos = trabajos;
  privado.avisoTrabajos = aviso;
}
/** @param {Privado} privado @param {Trabajo} trabajo */
async function leerTrabajo(privado, trabajo) {
  const respuesta = await enviar(privado, trabajo, { ruta: 'datos/trabajo', cuerpo: {}, token: privado.token });
  if (!vigente(privado, trabajo)) {
    return null;
  }
  if (respuesta.estado !== EXITO) {
    rechazar(respuesta);
  }
  const lectura = leerLecturaTrabajo(respuesta.cuerpo);
  guardarTrabajos(privado, lectura.sesion, lectura.trabajos);
  return lectura;
}
/** Consulta explícita sin actividad ni recuperación automática de ejecuciones. @param {Privado} privado */
function consultarTrabajo(privado) {
  const anterior = privado.estado;
  if (anterior.estado !== 'activa' || !privado.token) {
    return Promise.resolve(anterior);
  }
  return ejecutar(privado, 'trabajos', async (trabajo) => {
    const lectura = await leerTrabajo(privado, trabajo);
    if (lectura) {
      privado.requiereLecturaTrabajo = false;
      activar(privado, { controles: anterior.controles, sesion: lectura.sesion }, anterior.conflicto);
    }
  });
}
/** @param {{estado:number,cuerpo:unknown}} respuesta
 * @param {{solicitudId:string,accion:AccionActualizacion,revisionEsperada:number}} solicitud */
function validarActualizacion(respuesta, solicitud) {
  if (![EXITO, ACEPTADA, CONFLICTO].includes(respuesta.estado) || leerErrorSiExiste(respuesta.cuerpo)) {
    rechazar(respuesta);
  }
  const datos = leerActualizacion(respuesta.cuerpo);
  validarSolicitudActualizacion(datos, solicitud);
  let estadoEsperado = CONFLICTO;
  if (datos.decision === 'repetida') {
    estadoEsperado = EXITO;
  } else if (datos.decision === 'nueva') {
    estadoEsperado = datos.trabajos.ultimoTrabajo?.estado === 'terminado' ? EXITO : ACEPTADA;
  }
  if (respuesta.estado !== estadoEsperado) {
    throw new FalloPanel('respuesta_invalida');
  }
  return datos;
}
/** @param {ReturnType<typeof leerActualizacion>} datos
 * @param {{solicitudId:string,accion:AccionActualizacion,revisionEsperada:number}} solicitud */
function validarSolicitudActualizacion(datos, solicitud) {
  const ultimo = datos.trabajos.ultimoTrabajo;
  const aceptada = datos.decision === 'nueva' || datos.decision === 'repetida';
  if (
    datos.trabajos.revision < solicitud.revisionEsperada ||
    (aceptada &&
      (!ultimo ||
        ultimo.solicitudId !== solicitud.solicitudId ||
        ultimo.accion !== solicitud.accion ||
        ultimo.revisionBase !== solicitud.revisionEsperada ||
        ultimo.revisionReserva !== solicitud.revisionEsperada + 1)) ||
    (datos.decision === 'ocupado' && (!ultimo || ultimo.solicitudId === solicitud.solicitudId)) ||
    (datos.decision === 'conflicto' && datos.trabajos.revision === solicitud.revisionEsperada)
  ) {
    throw new FalloPanel('respuesta_invalida');
  }
}
/** @param {ReturnType<typeof leerActualizacion>['decision']} decision @returns {AvisoPanel|null} */
function avisoActualizacion(decision) {
  if (decision === 'conflicto') {
    return 'revision_trabajos_conflictiva';
  }
  return decision === 'ocupado' ? 'trabajo_ocupado' : null;
}
/** Cada gesto obtiene su propia lectura y UUID; ningún resultado incierto se reenvía.
 * @param {Privado} privado @param {AccionActualizacion} accion */
function actualizarDatos(privado, accion) {
  const anterior = privado.estado;
  if (anterior.estado !== 'activa' || !privado.token || privado.trabajo || privado.requiereLecturaTrabajo) {
    return Promise.resolve(anterior);
  }
  if (accion !== 'actualizar-datos' && accion !== 'reintentar-pendientes') {
    publicar(privado, { ...anterior, aviso: 'solicitud_rechazada' });
    return Promise.resolve(privado.estado);
  }
  return ejecutar(privado, 'actualizar', async (trabajo) => {
    const lectura = await leerTrabajo(privado, trabajo);
    if (!lectura) {
      return;
    }
    const actual = lectura.trabajos.ultimoTrabajo;
    if (actual && actual.estado !== 'terminado') {
      privado.avisoTrabajos = 'trabajo_ocupado';
      activar(privado, { controles: anterior.controles, sesion: lectura.sesion }, anterior.conflicto);
      return;
    }
    const solicitud = { solicitudId: crypto.randomUUID(), accion, revisionEsperada: lectura.trabajos.revision };
    trabajo.mutacion = true;
    const respuesta = await enviar(privado, trabajo, {
      ruta: 'datos/actualizar',
      cuerpo: solicitud,
      token: privado.token,
    });
    if (!vigente(privado, trabajo)) {
      return;
    }
    const datos = validarActualizacion(respuesta, solicitud);
    guardarTrabajos(privado, datos.sesion, datos.trabajos, avisoActualizacion(datos.decision));
    activar(privado, { controles: anterior.controles, sesion: datos.sesion }, anterior.conflicto);
  });
}
/** @param {EstadoTrabajos['ultimoTrabajo']} actual
 * @param {NonNullable<EstadoTrabajos['ultimoTrabajo']>} visto */
function mismaReserva(actual, visto) {
  return actual?.solicitudId === visto.solicitudId && actual.revisionReserva === visto.revisionReserva;
}
/** La recuperación solo opera sobre la reserva presentada antes del gesto. Una lectura interna
 * nunca levanta el bloqueo que exige consultar explícitamente tras un resultado incierto.
 * @param {Privado} privado @param {'retirar'|'reconciliar'} operacion */
function recuperarTrabajo(privado, operacion) {
  const anterior = privado.estado;
  if (anterior.estado !== 'activa' || !privado.token || privado.trabajo || privado.requiereLecturaTrabajo) {
    return Promise.resolve(anterior);
  }
  const visto = anterior.trabajos?.ultimoTrabajo;
  if (!visto || visto.estado === 'terminado') {
    return Promise.resolve(anterior);
  }
  return ejecutar(privado, operacion, async (trabajo) => {
    const lectura = await leerTrabajo(privado, trabajo);
    if (!lectura) {
      return;
    }
    const actual = lectura.trabajos.ultimoTrabajo;
    if (!mismaReserva(actual, visto) || actual?.estado === 'terminado') {
      privado.avisoTrabajos = mismaReserva(actual, visto) ? 'trabajo_terminado' : 'revision_trabajos_conflictiva';
      activar(privado, { controles: anterior.controles, sesion: lectura.sesion }, anterior.conflicto);
      return;
    }
    const referencia = { solicitudId: visto.solicitudId, revisionReserva: visto.revisionReserva };
    trabajo.mutacion = true;
    const respuesta = await enviar(privado, trabajo, {
      ruta: `datos/${operacion}`,
      cuerpo: operacion === 'retirar' ? { ...referencia, revisionEsperada: lectura.trabajos.revision } : referencia,
      token: privado.token,
    });
    if (!vigente(privado, trabajo)) {
      return;
    }
    const datos = validarRecuperacion(respuesta, operacion, visto, lectura.trabajos.revision);
    guardarTrabajos(privado, datos.sesion, datos.trabajos, avisoRecuperacion(datos.decision));
    activar(privado, { controles: anterior.controles, sesion: datos.sesion }, anterior.conflicto);
  });
}
/** @param {{estado:number,cuerpo:unknown}} respuesta @param {'retirar'|'reconciliar'} operacion
 * @param {NonNullable<EstadoTrabajos['ultimoTrabajo']>} visto @param {number} revision */
function validarRecuperacion(respuesta, operacion, visto, revision) {
  if (![EXITO, CONFLICTO].includes(respuesta.estado) || leerErrorSiExiste(respuesta.cuerpo)) {
    rechazar(respuesta);
  }
  const datos = operacion === 'retirar' ? leerRetirada(respuesta.cuerpo) : leerReconciliacion(respuesta.cuerpo);
  const conflicto = datos.decision === 'conflicto';
  const actual = datos.trabajos.ultimoTrabajo;
  if (
    respuesta.estado !== (conflicto ? CONFLICTO : EXITO) ||
    datos.trabajos.revision < revision ||
    (!conflicto && !mismaReserva(actual, visto))
  ) {
    throw new FalloPanel('respuesta_invalida');
  }
  if (!conflicto) {
    validarDecisionRecuperacion(datos, revision);
  }
  return datos;
}
/** @param {ReturnType<typeof leerRetirada>|ReturnType<typeof leerReconciliacion>} datos @param {number} revision */
function validarDecisionRecuperacion(datos, revision) {
  const actual = datos.trabajos.ultimoTrabajo;
  const decision = datos.decision;
  if (
    !actual ||
    (decision === 'retirado' && datos.trabajos.revision !== revision + 1) ||
    (decision === 'completada' &&
      (actual.estado !== 'terminado' || actual.resultado?.resultado !== 'ejecucion-sin-recibo')) ||
    (decision === 'terminado' && actual.estado !== 'terminado') ||
    (decision === 'en-curso' && (actual.estado !== 'despachado' || actual.runId === null)) ||
    (decision === 'sin-ejecucion' && (actual.estado !== 'despacho-incierto' || actual.runId !== null))
  ) {
    throw new FalloPanel('respuesta_invalida');
  }
}
/** @param {ReturnType<typeof leerRetirada>['decision']|ReturnType<typeof leerReconciliacion>['decision']} decision
 * @returns {AvisoPanel} */
function avisoRecuperacion(decision) {
  if (decision === 'conflicto') {
    return 'revision_trabajos_conflictiva';
  }
  if (decision === 'retirado') {
    return 'trabajo_retirado';
  }
  if (decision === 'en-curso') {
    return 'trabajo_en_curso';
  }
  return decision === 'sin-ejecucion' ? 'trabajo_sin_ejecucion' : 'trabajo_terminado';
}
/** @param {Privado} privado @param {DocumentoSecciones} secciones */
function guardarSecciones(privado, secciones) {
  const anterior = privado.ultimasSecciones;
  if (
    (privado.revision !== null && secciones.revision < privado.revision) ||
    (anterior &&
      (secciones.revision < anterior.revision ||
        (secciones.revision === anterior.revision && JSON.stringify(secciones) !== JSON.stringify(anterior))))
  ) {
    throw new FalloPanel('respuesta_invalida');
  }
  privado.secciones = secciones;
  privado.ultimasSecciones = secciones;
  if (privado.revision !== null && secciones.revision > privado.revision) {
    privado.controlesPendientes = true;
  }
}
/** @param {Privado} privado @param {Trabajo} trabajo */
async function leerSecciones(privado, trabajo) {
  const respuesta = await enviar(privado, trabajo, { ruta: 'secciones/leer', cuerpo: {}, token: privado.token });
  if (!vigente(privado, trabajo)) {
    return null;
  }
  if (respuesta.estado !== EXITO) {
    rechazar(respuesta);
  }
  const lectura = leerLecturaSecciones(respuesta.cuerpo);
  comprobarContinuidad(privado, lectura.sesion);
  guardarSecciones(privado, lectura.secciones);
  privado.sesion = Object.freeze(lectura.sesion);
  return lectura;
}
/** La consulta explícita resuelve incertidumbre; nunca reenvía el cambio. @param {Privado} privado */
function consultarSecciones(privado) {
  const anterior = privado.estado;
  if (anterior.estado !== 'activa' || !privado.token) {
    return Promise.resolve(anterior);
  }
  return ejecutar(privado, 'secciones', async (trabajo) => {
    const lectura = await leerSecciones(privado, trabajo);
    if (lectura) {
      privado.requiereLecturaSecciones = false;
      privado.avisoSecciones = null;
      activar(privado, { controles: anterior.controles, sesion: lectura.sesion }, anterior.conflicto);
    }
  });
}
/** @param {Privado} privado @param {PoliticaSecciones} entrada */
function cambiarSecciones(privado, entrada) {
  const anterior = privado.estado;
  const vista = privado.secciones;
  if (anterior.estado !== 'activa' || !privado.token || privado.trabajo || !vista || privado.requiereLecturaSecciones) {
    return Promise.resolve(anterior);
  }
  let secciones;
  try {
    secciones = leerPoliticaSecciones(entrada);
  } catch {
    publicar(privado, { ...anterior, aviso: 'solicitud_rechazada' });
    return Promise.resolve(privado.estado);
  }
  return ejecutar(privado, 'cambiar-secciones', async (trabajo) => {
    const lectura = await leerSecciones(privado, trabajo);
    if (!lectura) {
      return;
    }
    if (lectura.secciones.revision !== vista.revision) {
      privado.requiereLecturaSecciones = true;
      privado.avisoSecciones = 'revision_secciones_conflictiva';
      activar(privado, { controles: anterior.controles, sesion: lectura.sesion }, anterior.conflicto);
      return;
    }
    await confirmarCambioSecciones(privado, trabajo, { anterior, revision: vista.revision, secciones });
  });
}
/** @param {{estado:number,cuerpo:unknown}} respuesta @param {number} revision @param {PoliticaSecciones} secciones */
function validarCambioSecciones(respuesta, revision, secciones) {
  if (![EXITO, CONFLICTO].includes(respuesta.estado) || leerErrorSiExiste(respuesta.cuerpo)) {
    rechazar(respuesta);
  }
  const datos = leerCambioSecciones(respuesta.cuerpo);
  const conflicto = respuesta.estado === CONFLICTO;
  const revisionValida = conflicto ? datos.secciones.revision > revision : datos.secciones.revision === revision + 1;
  if (
    datos.estado !== (conflicto ? 'conflicto' : 'cambiado') ||
    !revisionValida ||
    (!conflicto && JSON.stringify(datos.secciones.secciones) !== JSON.stringify(secciones))
  ) {
    throw new FalloPanel('respuesta_invalida');
  }
  return { datos, conflicto };
}
/** @param {Privado} privado @param {Trabajo} trabajo
 * @param {{anterior:Extract<EstadoClientePanel,{estado:'activa'}>,revision:number,secciones:PoliticaSecciones}} cambio */
async function confirmarCambioSecciones(privado, trabajo, { anterior, revision, secciones }) {
  trabajo.mutacion = true;
  const respuesta = await enviar(privado, trabajo, {
    ruta: 'secciones/cambiar',
    token: privado.token,
    cuerpo: { revisionEsperada: revision, secciones },
  });
  if (!vigente(privado, trabajo)) {
    return;
  }
  const { datos, conflicto } = validarCambioSecciones(respuesta, revision, secciones);
  comprobarContinuidad(privado, datos.sesion);
  guardarSecciones(privado, datos.secciones);
  privado.requiereLecturaSecciones = conflicto;
  privado.avisoSecciones = conflicto ? 'revision_secciones_conflictiva' : 'secciones_guardadas';
  activar(privado, { controles: anterior.controles, sesion: datos.sesion }, anterior.conflicto);
}
/** @param {Privado} privado @param {ReturnType<typeof leerLecturaInstituciones>} lectura */
function guardarInstituciones(privado, lectura) {
  comprobarContinuidad(privado, lectura.sesion);
  if (privado.revisionInstituciones !== null && lectura.registro.revision < privado.revisionInstituciones) {
    throw new FalloPanel('respuesta_invalida');
  }
  privado.registroInstituciones = lectura.registro;
  privado.revisionInstituciones = lectura.registro.revision;
  privado.invitacion = lectura.invitacion;
  privado.institucionesPendientes = false;
  privado.avisoInstituciones = 'instituciones_confirmadas';
}
/** Consulta una única página global; no prolonga sesión ni carga el registro completo.
 * @param {Privado} privado @param {number} pagina */
function consultarAccesos(privado, pagina) {
  const anterior = privado.estado;
  if (anterior.estado !== 'activa' || !privado.token || privado.trabajo) {
    return Promise.resolve(anterior);
  }
  try {
    leerNumeroPagina(pagina);
  } catch (error) {
    if (!(error instanceof RespuestaAdministrativaInvalida)) {
      throw error;
    }
    publicar(privado, { ...anterior, aviso: 'solicitud_rechazada' });
    return Promise.resolve(privado.estado);
  }
  return ejecutar(privado, 'accesos', async (trabajo) => {
    const respuesta = await enviar(privado, trabajo, {
      ruta: 'accesos/leer',
      cuerpo: { pagina },
      token: privado.token,
    });
    if (!vigente(privado, trabajo)) {
      return;
    }
    if (respuesta.estado !== EXITO) {
      rechazar(respuesta);
    }
    const lectura = leerLecturaAccesos(respuesta.cuerpo);
    if (lectura.accesos.pagina !== pagina) {
      throw new FalloPanel('respuesta_invalida');
    }
    comprobarContinuidad(privado, lectura.sesion);
    privado.accesos = lectura.accesos;
    privado.avisoAccesos = null;
    activar(privado, { controles: anterior.controles, sesion: lectura.sesion }, anterior.conflicto);
  });
}
/** Lectura explícita, sin prolongar actividad ni recuperar enlaces. @param {Privado} privado */
function consultarInstituciones(privado) {
  const anterior = privado.estado;
  if (anterior.estado !== 'activa' || !privado.token || privado.trabajo) {
    return Promise.resolve(anterior);
  }
  privado.invitacion = null;
  return ejecutar(privado, 'instituciones', async (trabajo) => {
    const respuesta = await enviar(privado, trabajo, { ruta: 'instituciones/leer', cuerpo: {}, token: privado.token });
    if (!vigente(privado, trabajo)) {
      return;
    }
    if (respuesta.estado !== EXITO) {
      rechazar(respuesta);
    }
    const lectura = leerLecturaInstituciones(respuesta.cuerpo);
    guardarInstituciones(privado, lectura);
    activar(privado, { controles: anterior.controles, sesion: lectura.sesion }, anterior.conflicto);
  });
}
/** @typedef {'invitar'|'renovar'|'retirar-institucion'|'retirar-clave'} CambioInstitucion */
/** @param {CambioInstitucion} operacion @param {unknown} entrada @returns {Record<string,unknown>} */
function datosCambioInstitucion(operacion, entrada) {
  if (operacion === 'invitar') {
    return leerDatosInvitacion(entrada);
  }
  if (operacion === 'retirar-clave') {
    const o = objetoAdministrativo(entrada, ['id', 'claveId']);
    return { id: leerIdInstitucion(o.id), claveId: leerIdClave(o.claveId) };
  }
  return { id: leerIdInstitucion(entrada) };
}
/** @param {Privado} privado @param {CambioInstitucion} operacion @param {unknown} entrada */
function cambiarInstitucion(privado, operacion, entrada) {
  const anterior = privado.estado;
  const registro = privado.registroInstituciones;
  if (
    anterior.estado !== 'activa' ||
    !privado.token ||
    privado.trabajo ||
    !registro ||
    privado.institucionesPendientes
  ) {
    return Promise.resolve(anterior);
  }
  let datos;
  try {
    datos = datosCambioInstitucion(operacion, entrada);
  } catch (error) {
    if (!(error instanceof RespuestaAdministrativaInvalida)) {
      throw error;
    }
    publicar(privado, { ...anterior, aviso: 'solicitud_rechazada' });
    return Promise.resolve(privado.estado);
  }
  privado.invitacion = null;
  return ejecutar(privado, operacion, async (trabajo) => {
    trabajo.mutacion = true;
    const ruta = operacion === 'retirar-institucion' ? 'retirar' : operacion;
    const respuesta = await enviar(privado, trabajo, {
      ruta: `instituciones/${ruta}`,
      cuerpo: { ...datos, revisionEsperada: registro.revision },
      token: privado.token,
    });
    if (!vigente(privado, trabajo)) {
      return;
    }
    if (respuesta.estado !== EXITO) {
      rechazar(respuesta);
    }
    const lectura = leerLecturaInstituciones(respuesta.cuerpo, operacion === 'invitar' || operacion === 'renovar');
    if (lectura.registro.revision !== registro.revision + 1) {
      throw new FalloPanel('respuesta_invalida');
    }
    guardarInstituciones(privado, lectura);
    activar(privado, { controles: anterior.controles, sesion: lectura.sesion }, anterior.conflicto);
  });
}
/** @param {Privado} privado */
function descartarInvitacion(privado) {
  privado.invitacion = null;
  if (privado.estado.estado === 'activa') {
    publicar(privado, privado.estado);
  }
}
/** @param {Privado} privado @param {PoliticaControles} entrada */
function cambiar(privado, entrada) {
  const anterior = privado.estado;
  if (anterior.estado !== 'activa' || !privado.token || privado.trabajo || privado.controlesPendientes) {
    return Promise.resolve(anterior);
  }
  /** @type {PoliticaControles} */
  let politica;
  try {
    politica = leerPoliticaControles(entrada);
  } catch {
    publicar(privado, { ...anterior, aviso: 'solicitud_rechazada' });
    return Promise.resolve(privado.estado);
  }
  return ejecutar(privado, 'cambiar', async (trabajo) => {
    const respuesta = await enviar(privado, trabajo, {
      ruta: 'controles/cambiar',
      token: privado.token,
      cuerpo: { politica, revisionEsperada: anterior.controles.revision },
    });
    if (!vigente(privado, trabajo)) {
      return;
    }
    const { datos, conflicto } = validarCambio(respuesta, anterior.controles.revision);
    privado.secciones = null;
    privado.requiereLecturaSecciones = true;
    privado.avisoSecciones = null;
    activar(privado, datos, conflicto);
  });
}
/** @param {{estado:number,cuerpo:unknown}} respuesta @param {number} revision */
function validarCambio(respuesta, revision) {
  if (respuesta.estado !== EXITO && respuesta.estado !== CONFLICTO) {
    rechazar(respuesta);
  }
  if (respuesta.estado === CONFLICTO && leerErrorSiExiste(respuesta.cuerpo)) {
    rechazar(respuesta);
  }
  const datos = leerCambio(respuesta.cuerpo);
  const conflicto = respuesta.estado === CONFLICTO;
  const revisionValida = conflicto ? datos.controles.revision > revision : datos.controles.revision === revision + 1;
  if (datos.estado !== (conflicto ? 'conflicto' : 'cambiado') || !revisionValida) {
    throw new FalloPanel('respuesta_invalida');
  }
  return { datos, conflicto };
}
/** @param {unknown} cuerpo */
function leerErrorSiExiste(cuerpo) {
  return cuerpo !== null && typeof cuerpo === 'object' && Object.hasOwn(cuerpo, 'error');
}
/** Cerrar invalida de inmediato; si una apertura no llegó a revelar token no se puede confirmar su cierre remoto.
 * @param {Privado} privado */
function cerrar(privado) {
  if (privado.destruido) {
    return Promise.resolve(privado.estado);
  }
  const anterior = privado.trabajo;
  const token = privado.token;
  olvidar(privado);
  privado.generacion++;
  anterior?.control.abort();
  privado.trabajo = null;
  retirar(privado, 'cerrada');
  return ejecutar(privado, 'cerrar', async (trabajo) => {
    await anterior?.promesa;
    if (!vigente(privado, trabajo)) {
      return;
    }
    if (token) {
      const respuesta = await enviar(privado, trabajo, { ruta: 'sesion/cerrar', cuerpo: {}, token });
      if (!vigente(privado, trabajo)) {
        return;
      }
      if (respuesta.estado !== EXITO) {
        rechazar(respuesta);
      }
      leerCierre(respuesta.cuerpo);
    }
    retirar(privado, 'cerrada');
  });
}
/** Sin token no hay sesión que comprobar: se devuelve el estado tal como está. @param {Privado} privado */
function comprobar(privado) {
  return privado.token
    ? ejecutar(privado, 'comprobar', (trabajo) => leer(privado, trabajo))
    : Promise.resolve(privado.estado);
}
/** @param {Privado} privado */
function destruir(privado) {
  privado.destruido = true;
  privado.generacion++;
  privado.trabajo?.control.abort();
  privado.trabajo = null;
  olvidar(privado);
  privado.estado = Object.freeze({ estado: 'cerrada', aviso: null });
}
/** Token únicamente en esta clausura de RAM: nunca se publica, serializa ni persiste.
 * @param {OpcionesClientePanel} opciones */
export function crearClientePanel({ pedir = fetch, alCambiar }) {
  const privado = crearPrivado({ pedir, alCambiar });
  alCambiar(privado.estado);
  return Object.freeze({
    abrir: (retomar = false) => abrir(privado, retomar),
    ...crearLecturasSesionUnica(privado, { enviar, rechazar }),
    comprobar: () => comprobar(privado),
    mantener: () => mantener(privado),
    consultarControles: () =>
      privado.token && privado.estado.estado === 'activa'
        ? ejecutar(privado, 'leer-controles', (trabajo) => leer(privado, trabajo, true))
        : Promise.resolve(privado.estado),
    cerrarPublicacion: crearOperacionCierre(privado, { ejecutar, enviar, vigente, rechazar, activar }),
    ...crearOperacionesVigilante(privado, { ejecutar, enviar, vigente, rechazar, activar }),
    ...crearOperacionesEncuesta(privado, { ejecutar, enviar, vigente, rechazar, activar }),
    ...crearOperacionesAdministradores(privado, { ejecutar, enviar, vigente, rechazar, activar }),
    consultarSecciones: () => consultarSecciones(privado),
    cambiarSecciones: (/** @type {PoliticaSecciones} */ secciones) => cambiarSecciones(privado, secciones),
    consultarAccesos: (/** @type {number} */ pagina = 1) => consultarAccesos(privado, pagina),
    consultarInstituciones: () => consultarInstituciones(privado),
    invitarInstitucion: (/** @type {{nombre:string,correo:string|null}} */ entrada) =>
      cambiarInstitucion(privado, 'invitar', entrada),
    renovarInvitacion: (/** @type {string} */ id) => cambiarInstitucion(privado, 'renovar', id),
    retirarInstitucion: (/** @type {string} */ id) => cambiarInstitucion(privado, 'retirar-institucion', id),
    retirarClaveInstitucion: (/** @type {string} */ id, /** @type {string} */ claveId) =>
      cambiarInstitucion(privado, 'retirar-clave', { id, claveId }),
    descartarInvitacion: () => descartarInvitacion(privado),
    consultarOcultas: (/** @type {'todos'|'recurso'|'edicion'} */ tipo = 'todos', /** @type {number} */ pagina = 0) =>
      consultarOcultas(privado, tipo, pagina),
    consultarDatos: () => consultarDatos(privado),
    consultarTrabajo: () => consultarTrabajo(privado),
    retirarTrabajo: () => recuperarTrabajo(privado, 'retirar'),
    reconciliarTrabajo: () => recuperarTrabajo(privado, 'reconciliar'),
    consultarActivacion: () => consultarActivacion(privado),
    actualizarDatos: (/** @type {AccionActualizacion} */ accion = 'actualizar-datos') =>
      actualizarDatos(privado, accion),
    cambiar: (/** @type {PoliticaControles} */ politica) => cambiar(privado, politica),
    cerrar: () => cerrar(privado),
    destruir: () => destruir(privado),
  });
}

/** @param {{pedir:typeof fetch,alCambiar:(estado:EstadoClientePanel)=>void}} opciones @returns {Privado} */
function crearPrivado({ pedir, alCambiar }) {
  return {
    ocultas: null,
    avisoOcultas: null,
    accesos: null,
    avisoAccesos: null,
    registroInstituciones: null,
    invitacion: null,
    revisionInstituciones: null,
    institucionesPendientes: false,
    avisoInstituciones: null,
    secciones: null,
    ultimasSecciones: null,
    requiereLecturaSecciones: false,
    controlesPendientes: false,
    avisoSecciones: null,
    token: '',
    sesion: null,
    revision: null,
    activacion: null,
    ultimaActivacion: null,
    avisoActivacion: null,
    datos: null,
    datosDeLaActualizacionAnterior: false,
    trabajos: null,
    ultimoEstadoTrabajos: null,
    avisoTrabajos: null,
    requiereLecturaTrabajo: false,
    estado: Object.freeze({ estado: 'inicial', aviso: null }),
    trabajo: null,
    generacion: 0,
    destruido: false,
    pedir,
    alCambiar,
  };
}

/** Un error de transporte conserva la última página con advertencia; no concede autorización.
 * @param {Privado} privado @param {Trabajo} trabajo @param {AvisoPanel} aviso */
function presentarFalloOcultas(privado, trabajo, aviso) {
  if (trabajo.operacion !== 'ocultas' || trabajo.anterior.estado !== 'activa' || aviso === 'acceso_denegado') {
    return false;
  }
  privado.avisoOcultas = 'ocultas_no_disponibles';
  publicar(privado, { ...trabajo.anterior, ocupado: false, aviso: privado.avisoOcultas });
  return true;
}
/** @param {Privado} privado @param {'todos'|'recurso'|'edicion'} tipo @param {number} pagina */
function consultarOcultas(privado, tipo, pagina) {
  const anterior = privado.estado;
  if (anterior.estado !== 'activa' || !privado.token || privado.trabajo) {
    return Promise.resolve(anterior);
  }
  const revision = pagina === 0 ? null : (privado.ocultas?.ofertasOcultas.catalogo?.revision ?? null);
  return ejecutar(privado, 'ocultas', async (trabajo) => {
    const respuesta = await enviar(privado, trabajo, {
      ruta: 'datos/ofertas-ocultas',
      cuerpo: { tipo, pagina, revision },
      token: privado.token,
    });
    if (!vigente(privado, trabajo)) {
      return;
    }
    if (respuesta.estado !== EXITO) {
      rechazar(respuesta);
    }
    const lectura = leerLecturaOcultas(respuesta.cuerpo);
    const c = lectura.ofertasOcultas.catalogo;
    if (c !== null && (c.tipo !== tipo || c.pagina !== pagina || (revision !== null && c.revision !== revision))) {
      throw new FalloPanel('respuesta_invalida');
    }
    comprobarContinuidad(privado, lectura.sesion);
    privado.ocultas = lectura;
    privado.avisoOcultas = null;
    activar(privado, { controles: anterior.controles, sesion: lectura.sesion }, anterior.conflicto);
  });
}
