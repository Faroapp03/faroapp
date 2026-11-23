// Administradores en el panel: las cuatro operaciones de la lista, con el token de la sesión única. La vista
// (vista-administradores.js) recibe cada respuesta tal como llega y explica sus errores con su propia frase; aquí solo
// se decide qué le pasa a la sesión: un error propio de la lista la deja igual y cualquier otro rechazo la trata como
// el resto del panel (sesión inactiva o sustituida, sin permiso, sin segundo factor).
import { CONFLICTO, EXITO, INCORRECTO } from './estados-http-panel.js';

/** @typedef {import('./cliente.js').Privado} Privado */
/** @typedef {import('./cliente.js').Trabajo} Trabajo */
/** @typedef {{estado:number, cuerpo:unknown}} RespuestaAdministradores */
/** @typedef {import('./cliente-encuesta.js').Ayudas} AyudasEncuesta */
/** @typedef {Omit<AyudasEncuesta,'ejecutar'> & {ejecutar:(p:Privado,o:'administradores',f:(t:Trabajo)=>Promise<void>)=>Promise<unknown>}} Ayudas */

const RUTAS = Object.freeze([
  'administradores/leer',
  'administradores/anadir',
  'administradores/retirar',
  'administradores/reintentar',
]);
/** Los rechazos de la lista (src/administracion/administradores-http.ts): el servidor no ha cambiado nada ni la sesión. */
const ERRORES_DE_LA_LISTA = new Set([
  `${INCORRECTO}:correo_no_valido`,
  '404:administrador_no_encontrado',
  `${CONFLICTO}:administrador_duplicado`,
  `${CONFLICTO}:lista_llena`,
  `${CONFLICTO}:alta_propia_primero`,
  `${CONFLICTO}:ultimo_activo`,
  `${CONFLICTO}:cloudflare_sin_configurar`,
  '502:cloudflare_no_disponible',
]);
/** Lo que recibe la vista cuando la petición no ha salido: la explica como «no disponible ahora». */
const NO_ENVIADA = Object.freeze({ estado: 0, cuerpo: null });

/** @param {RespuestaAdministradores} respuesta */
function esErrorDeLaLista({ estado, cuerpo }) {
  const error =
    cuerpo !== null && typeof cuerpo === 'object' && 'error' in cuerpo && typeof cuerpo.error === 'string'
      ? cuerpo.error
      : '';
  return ERRORES_DE_LA_LISTA.has(`${estado}:${error}`);
}

/** Leer la lista no cambia nada; añadir, retirar y reintentar son mutaciones, y una respuesta perdida no se reenvía.
 * @param {Privado} privado @param {Ayudas} ayudas */
export function crearOperacionesAdministradores(privado, ayudas) {
  return {
    /** @param {string} ruta @param {object} cuerpo @returns {Promise<RespuestaAdministradores>} */
    async pedirAdministradores(ruta, cuerpo) {
      const anterior = privado.estado;
      if (!RUTAS.includes(ruta) || anterior.estado !== 'activa' || !privado.token || privado.trabajo) {
        return NO_ENVIADA;
      }
      /** @type {RespuestaAdministradores} */
      let resultado = NO_ENVIADA;
      await ayudas.ejecutar(privado, 'administradores', async (trabajo) => {
        trabajo.mutacion = ruta !== 'administradores/leer';
        const respuesta = await ayudas.enviar(privado, trabajo, { ruta, cuerpo, token: privado.token });
        if (!ayudas.vigente(privado, trabajo)) {
          return;
        }
        resultado = respuesta;
        if (respuesta.estado !== EXITO && !esErrorDeLaLista(respuesta)) {
          ayudas.rechazar(respuesta);
        }
        if (privado.sesion) {
          ayudas.activar(privado, { controles: anterior.controles, sesion: privado.sesion }, anterior.conflicto);
        }
      });
      return resultado;
    },
  };
}
