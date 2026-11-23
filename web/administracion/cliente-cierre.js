/**
 * Cerrar una publicación desde el panel: pide al servidor que la cierre sin publicar, ligada a la revisión que se ve.
 * Usa el transporte de sesión del cliente y nunca reenvía una petición incierta.
 */
import { objetoAdministrativo, respuestaAdministrativaInvalida } from './contrato-comun.js';
import { leerSesionActiva } from './contratos.js';

export const ACEPTADA = 202;
const CONFLICTO = 409;
/** @typedef {import('./cliente.js').Privado} Privado */
/** @typedef {import('./cliente.js').Trabajo} Trabajo */
/** @typedef {'solicitado'|'ejecucion-en-curso'|'sin-confirmacion'|'conflicto'|'no-despachado'} ResultadoCierre */
const RESULTADOS = ['solicitado', 'ejecucion-en-curso', 'sin-confirmacion', 'conflicto', 'no-despachado'];
/** @param {unknown} entrada @returns {{cierre:ResultadoCierre,sesion:import('./cliente.js').SesionPanelActiva}} */
function leerResultado(entrada) {
  const dato = objetoAdministrativo(entrada, ['estado', 'sesion', 'cierre']);
  const cierre = objetoAdministrativo(
    dato.cierre,
    Object.hasOwn(/** @type {object} */ (dato.cierre), 'caducaEn') ? ['estado', 'caducaEn'] : ['estado'],
  );
  if (dato.estado !== 'activa' || !RESULTADOS.includes(String(cierre.estado))) {
    return respuestaAdministrativaInvalida();
  }
  return { cierre: /** @type {ResultadoCierre} */ (cierre.estado), sesion: leerSesionActiva(dato.sesion) };
}
/** @typedef {{ ejecutar:(p:Privado,o:'cerrar-publicacion',f:(t:Trabajo)=>Promise<void>)=>Promise<import('./cliente.js').EstadoClientePanel>,
 * enviar:(p:Privado,t:Trabajo,pedido:{ruta:string,cuerpo:object,token:string})=>Promise<{estado:number,cuerpo:unknown}>,
 * vigente:(p:Privado,t:Trabajo)=>boolean, rechazar:(r:{estado:number,cuerpo:unknown})=>never,
 * activar:(p:Privado,d:{controles:import('./cliente.js').DocumentoControles,sesion:import('./cliente.js').SesionPanelActiva},c:boolean)=>void }} Ayudas */
/** @param {Privado} privado @param {Ayudas} ayudas */
export function crearOperacionCierre(privado, ayudas) {
  /** @returns {Promise<ResultadoCierre|null>} */
  return async () => {
    const anterior = privado.estado;
    const vista = privado.activacion;
    if (anterior.estado !== 'activa' || !privado.token || privado.trabajo || !vista) {
      return null;
    }
    /** @type {ResultadoCierre|null} */
    let resultado = null;
    await ayudas.ejecutar(privado, 'cerrar-publicacion', async (trabajo) => {
      trabajo.mutacion = true;
      const respuesta = await ayudas.enviar(privado, trabajo, {
        ruta: 'datos/cerrar-publicacion',
        cuerpo: { revisionEsperada: vista.revision },
        token: privado.token,
      });
      if (!ayudas.vigente(privado, trabajo)) {
        return;
      }
      if (respuesta.estado !== ACEPTADA && respuesta.estado !== CONFLICTO) {
        ayudas.rechazar(respuesta);
      }
      const leido = leerResultado(respuesta.cuerpo);
      ayudas.activar(privado, { controles: anterior.controles, sesion: leido.sesion }, anterior.conflicto);
      resultado = leido.cierre;
    });
    return resultado;
  };
}
