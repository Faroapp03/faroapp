// Lecturas de la sesión única que no necesitan la sesión del panel: la bienvenida y el registro. Van sin token, no
// pasan por la cola de operaciones y no cambian el estado del cliente; solo Access decide quién puede hacerlas.
import { EXITO } from './estados-http-panel.js';

/** @typedef {import('./cliente.js').Privado} Privado */
/** @typedef {import('./cliente.js').Trabajo} Trabajo */
/** @typedef {{enviar:(p:Privado,t:Trabajo,pedido:{ruta:string,cuerpo:object,token:string})=>Promise<{estado:number,cuerpo:unknown}>, rechazar:(r:{estado:number,cuerpo:unknown})=>never}} Ayudas */

/** @param {Privado} privado @param {Ayudas} ayudas */
export function crearLecturasSesionUnica(privado, ayudas) {
  return {
    /** @param {'sesion/bienvenida'|'sesion/registro'} ruta @returns {Promise<unknown>} */
    leerSesionUnica: async (ruta) => {
      // Solo se usa su señal de cancelación, con el mismo plazo que cualquier petición del panel.
      const trabajo = /** @type {Trabajo} */ ({ control: new AbortController() });
      const respuesta = await ayudas.enviar(privado, trabajo, { ruta, cuerpo: {}, token: '' });
      if (respuesta.estado !== EXITO) {
        ayudas.rechazar(respuesta);
      }
      return respuesta.cuerpo;
    },
  };
}
