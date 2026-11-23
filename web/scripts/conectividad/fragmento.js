// Primera dependencia de activar-acceso.js: retira la dirección antes de iniciar la página común o consultar.
import { recogerInvitacion } from './invitacion.js';

let invitacion = retirarFragmento();
/** Una navegación a otro enlace de esta misma página tampoco deja su secreto en la dirección. */
export function retirarFragmento() {
  return recogerInvitacion(location, history);
}
/** Entrega a un único consumidor; la copia del módulo se descarta. @returns {string|null} */
export function tomarInvitacion() {
  const valor = invitacion;
  invitacion = null;
  return valor;
}
