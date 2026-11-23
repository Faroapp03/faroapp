// Dirección de los avisos en el panel: leer, guardar, quitar y probar, con lectores cerrados. La dirección solo viaja
// en el cuerpo de la petición y en la respuesta de `leer`; se devuelve a quien la pidió y no se guarda en el estado
// del cliente, para que ninguna otra vista ni copia la vea.

import { objetoAdministrativo, respuestaAdministrativaInvalida } from './contrato-comun.js';
import { leerError, leerSesionActiva } from './contratos.js';
import { EXITO } from './estados-http-panel.js';
import { leerEstadoAvisosPanel } from './vigilante-panel.js';

/** @typedef {import('./cliente.js').Privado} Privado */
/** @typedef {'sin_destino'|'pendiente'|'verificado'} VerificacionAvisos */
/** @typedef {Readonly<{revision:number,cambiadoEn:number|null,verificacion:VerificacionAvisos}>} ResumenAvisos */
/** @typedef {Readonly<{revision:number,cambiadoEn:number|null,verificacion:VerificacionAvisos,correo:string|null}>} DestinoAvisosPanel */
/** @typedef {Readonly<{resultado:'enviado'}>|Readonly<{resultado:'fallido'|'no-enviado',motivo:string}>} PruebaAvisos */
/** @typedef {import('./vigilante-panel.js').EstadoAvisosPanel} EstadoAvisosPanel */
/** @typedef {Readonly<{tipo:'leido',destino:DestinoAvisosPanel,avisos:EstadoAvisosPanel|null}>|Readonly<{tipo:'cambiado'|'conflicto',destino:ResumenAvisos}>|Readonly<{tipo:'prueba',prueba:PruebaAvisos,destino:ResumenAvisos}>|Readonly<{tipo:'correo-invalido'|'no-disponible'}>} ResultadoAvisos */
/** @typedef {Parameters<typeof import('./cliente-vigilante.js').crearOperacionesVigilante>[1]} Ayudas */

const INCORRECTO = 400;
const CONFLICTO = 409;
const NO_DISPONIBLE = 503;
const VERIFICACIONES = new Set(['sin_destino', 'pendiente', 'verificado']);
/** Los motivos de una prueba que no salió: los del enlace de correo y los de una prueba que no se intentó. */
const MOTIVOS_PRUEBA = new Map([
  [
    'fallido',
    new Set([
      'remitente-no-configurado',
      'destinatario-no-permitido',
      'limite-alcanzado',
      'rechazo-del-destino',
      'error-temporal',
      'plazo-agotado',
      'envio-rechazado',
    ]),
  ],
  [
    'no-enviado',
    new Set([
      'sin-destino',
      'destino-sin-verificar',
      'destino-no-admitido',
      'canal-no-configurado',
      'limite-de-pruebas',
    ]),
  ],
]);

/** @param {unknown} entrada @param {boolean} conCorreo @returns {any} */
function leerDestino(entrada, conCorreo) {
  const campos = ['version', 'revision', 'cambiadoEn', 'verificacion', ...(conCorreo ? ['correo'] : [])];
  const d = objetoAdministrativo(entrada, campos);
  const fecha = d.cambiadoEn === null || Number.isSafeInteger(d.cambiadoEn);
  if (d.version !== 1 || !Number.isSafeInteger(d.revision) || !fecha || !VERIFICACIONES.has(String(d.verificacion))) {
    respuestaAdministrativaInvalida();
  }
  const correo = conCorreo ? d.correo : undefined;
  if (conCorreo && !(correo === null ? d.verificacion === 'sin_destino' : typeof correo === 'string')) {
    respuestaAdministrativaInvalida();
  }
  const resumen = { revision: d.revision, cambiadoEn: d.cambiadoEn, verificacion: d.verificacion };
  return Object.freeze(conCorreo ? { ...resumen, correo } : resumen);
}
/** @param {unknown} entrada @returns {PruebaAvisos} */
function leerPrueba(entrada) {
  const conMotivo = entrada !== null && typeof entrada === 'object' && 'motivo' in entrada;
  const p = objetoAdministrativo(entrada, conMotivo ? ['resultado', 'motivo'] : ['resultado']);
  if (!conMotivo && p.resultado === 'enviado') {
    return Object.freeze({ resultado: 'enviado' });
  }
  if (!MOTIVOS_PRUEBA.get(String(p.resultado))?.has(String(p.motivo))) {
    respuestaAdministrativaInvalida();
  }
  return /** @type {PruebaAvisos} */ (Object.freeze({ resultado: p.resultado, motivo: p.motivo }));
}
/** @param {'leer'|'cambiar'|'quitar'|'probar'} operacion @param {unknown} cuerpo */
function leerRespuesta(operacion, cuerpo) {
  // La lectura trae además el estado de cada canal; se decide por su presencia, como en el servidor.
  const conAvisos = operacion === 'leer' && cuerpo !== null && typeof cuerpo === 'object' && 'avisos' in cuerpo;
  const extra = { leer: conAvisos ? ['avisos'] : [], probar: ['prueba'], cambiar: [], quitar: [] }[operacion];
  const campos = ['estado', 'sesion', 'destino', ...extra];
  const datos = objetoAdministrativo(cuerpo, campos);
  const esperado = operacion === 'leer' || operacion === 'probar' ? ['activa'] : ['cambiado', 'conflicto'];
  if (!esperado.includes(String(datos.estado))) {
    respuestaAdministrativaInvalida();
  }
  const sesion = leerSesionActiva(datos.sesion);
  const destino = leerDestino(datos.destino, operacion === 'leer');
  /** @type {ResultadoAvisos} */
  let resultado = { tipo: /** @type {'cambiado'|'conflicto'} */ (datos.estado), destino };
  if (operacion === 'leer') {
    resultado = { tipo: 'leido', destino, avisos: conAvisos ? leerEstadoAvisosPanel(datos.avisos) : null };
  } else if (operacion === 'probar') {
    resultado = { tipo: 'prueba', prueba: leerPrueba(datos.prueba), destino };
  }
  return { sesion, resultado: Object.freeze(resultado) };
}
/** El servidor rechaza sin cambiar nada: una dirección no válida o una instalación sin avisos por correo.
 * @param {{estado:number,cuerpo:unknown}} respuesta @returns {ResultadoAvisos|null} */
function rechazoSinCambios(respuesta) {
  if (respuesta.estado !== INCORRECTO && respuesta.estado !== NO_DISPONIBLE) {
    return null;
  }
  const error = leerError(respuesta.cuerpo);
  if (respuesta.estado === INCORRECTO && error === 'correo_invalido') {
    return Object.freeze({ tipo: 'correo-invalido' });
  }
  return respuesta.estado === NO_DISPONIBLE && error === 'no_disponible'
    ? Object.freeze({ tipo: 'no-disponible' })
    : null;
}
/** Un 409 con la dirección vigente es un conflicto de revisión; uno con `error` (la sesión sustituida) no lo es.
 * @param {unknown} cuerpo */
function esConflictoDeRevision(cuerpo) {
  return cuerpo !== null && typeof cuerpo === 'object' && 'estado' in cuerpo && cuerpo.estado === 'conflicto';
}
/**
 * Lo que dice cada respuesta: un rechazo sin cambios conserva la sesión confirmada; un 409 con la dirección vigente es
 * un conflicto; cualquier otro estado lo explica el panel con su aviso de siempre.
 * @param {'leer'|'cambiar'|'quitar'|'probar'} operacion @param {{estado:number,cuerpo:unknown}} respuesta
 * @param {import('./cliente.js').SesionPanelActiva|null} sesion @param {Ayudas['rechazar']} rechazar
 */
function atenderRespuesta(operacion, respuesta, sesion, rechazar) {
  const rechazo = rechazoSinCambios(respuesta);
  if (rechazo && sesion) {
    return { sesion, resultado: rechazo };
  }
  if (respuesta.estado !== EXITO && !(respuesta.estado === CONFLICTO && esConflictoDeRevision(respuesta.cuerpo))) {
    rechazar(respuesta);
  }
  const leido = leerRespuesta(operacion, respuesta.cuerpo);
  if ((respuesta.estado === CONFLICTO) !== (leido.resultado.tipo === 'conflicto')) {
    respuestaAdministrativaInvalida();
  }
  return leido;
}
/** @param {Privado} privado @param {Ayudas} ayudas */
export function crearOperacionesAvisos(privado, ayudas) {
  /** @param {'leer'|'cambiar'|'quitar'|'probar'} operacion @param {{estado:number,cuerpo:unknown}} respuesta
   * @param {import('./cliente.js').SesionPanelActiva|null} sesion */
  const atender = (operacion, respuesta, sesion) => atenderRespuesta(operacion, respuesta, sesion, ayudas.rechazar);
  /** @param {'leer'|'cambiar'|'quitar'|'probar'} operacion @param {object} cuerpo @returns {Promise<ResultadoAvisos|null>} */
  async function solicitar(operacion, cuerpo) {
    // La tarjeta pide su lectura al abrirse la sesión, mientras aún terminan las lecturas de la apertura: esperar a que
    // acaben no es un fallo. Cada operación termina por sí sola (respuesta o plazo agotado), así que la espera acaba.
    while (operacion === 'leer' && privado.trabajo && privado.estado.estado === 'activa') {
      await privado.trabajo.promesa;
    }
    const anterior = privado.estado;
    if (anterior.estado !== 'activa' || !privado.token || privado.trabajo) {
      return null;
    }
    /** @type {ResultadoAvisos|null} */
    let resultado = null;
    await ayudas.ejecutar(privado, 'avisos', async (trabajo) => {
      // Leer no cambia nada; guardar, quitar y probar sí: una respuesta perdida no se da por buena.
      trabajo.mutacion = operacion !== 'leer';
      const respuesta = await ayudas.enviar(privado, trabajo, {
        ruta: `avisos/${operacion}`,
        cuerpo,
        token: privado.token,
      });
      if (!ayudas.vigente(privado, trabajo)) {
        return;
      }
      const leido = atender(operacion, respuesta, privado.sesion);
      ayudas.activar(privado, { controles: anterior.controles, sesion: leido.sesion }, anterior.conflicto);
      resultado = leido.resultado;
    });
    return resultado;
  }
  return {
    leerAvisos: () => solicitar('leer', {}),
    cambiarAvisos: (/** @type {number} */ revisionEsperada, /** @type {string} */ correo) =>
      solicitar('cambiar', { revisionEsperada, correo }),
    quitarAvisos: (/** @type {number} */ revisionEsperada) => solicitar('quitar', { revisionEsperada }),
    probarAvisos: () => solicitar('probar', {}),
  };
}
