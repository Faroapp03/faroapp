// La comprobación registra decisiones: una respuesta perdida nunca se vuelve a enviar automáticamente.
import { crearOperacionesAvisos } from './cliente-avisos.js';
import { objetoAdministrativo, respuestaAdministrativaInvalida } from './contrato-comun.js';
import { leerSesionActiva } from './contratos.js';
import { EXITO } from './estados-http-panel.js';
import { LIMITE_PAGINA_VIGILANTE, leerHistorialVigilantePanel, leerVigilantePanel } from './vigilante-panel.js';

/** @typedef {import('./cliente.js').Privado} Privado */
/** @typedef {import('./cliente.js').Trabajo} Trabajo */
/** @typedef {{ejecutar:(p:Privado,o:'vigilante'|'avisos',f:(t:Trabajo)=>Promise<void>)=>Promise<import('./cliente.js').EstadoClientePanel>, enviar:(p:Privado,t:Trabajo,pedido:{ruta:string,cuerpo:object,token:string})=>Promise<{estado:number,cuerpo:unknown}>, vigente:(p:Privado,t:Trabajo)=>boolean, rechazar:(r:{estado:number,cuerpo:unknown})=>never, activar:(p:Privado,d:{controles:import('./cliente.js').DocumentoControles,sesion:import('./cliente.js').SesionPanelActiva},c:boolean)=>void}} Ayudas */
/** @param {Privado} privado @param {Ayudas} ayudas */
export function crearOperacionesVigilante(privado, ayudas) {
  /** @param {'comprobar'|'historial'} operacion @param {{despuesDe:number,revisionEsperada:number}|null} pagina */
  async function solicitar(operacion, pagina) {
    const anterior = privado.estado;
    if (anterior.estado !== 'activa' || !privado.token || privado.trabajo) {
      return null;
    }
    /** @type {import('./vigilante-panel.js').VigilantePanel|import('./vigilante-panel.js').HistorialVigilantePanel|null} */
    let resultado = null;
    await ayudas.ejecutar(privado, 'vigilante', async (trabajo) => {
      trabajo.mutacion = operacion === 'comprobar';
      const respuesta = await ayudas.enviar(privado, trabajo, {
        ruta: operacion === 'comprobar' ? 'datos/comprobar-estado' : 'datos/vigilante/historial',
        cuerpo: pagina ? { ...pagina, limite: LIMITE_PAGINA_VIGILANTE } : {},
        token: privado.token,
      });
      if (!ayudas.vigente(privado, trabajo)) {
        return;
      }
      if (respuesta.estado !== EXITO) {
        ayudas.rechazar(respuesta);
      }
      const { sesion, leido } = validar(respuesta.cuerpo, operacion, pagina);
      ayudas.activar(privado, { controles: anterior.controles, sesion }, anterior.conflicto);
      resultado = leido;
    });
    return resultado;
  }
  return {
    // La dirección de los avisos es del vigilante: sus operaciones viajan con las suyas.
    ...crearOperacionesAvisos(privado, ayudas),
    comprobarVigilante: () => solicitar('comprobar', null),
    historialVigilante: (/** @type {{despuesDe:number,revisionEsperada:number}|null} */ pagina = null) =>
      solicitar('historial', pagina),
  };
}

/** @param {unknown} cuerpo @param {'comprobar'|'historial'} operacion @param {{despuesDe:number,revisionEsperada:number}|null} pagina */
function validar(cuerpo, operacion, pagina) {
  const campo = operacion === 'comprobar' ? 'vigilante' : 'historial';
  const datos = objetoAdministrativo(cuerpo, ['estado', 'sesion', campo]);
  if (datos.estado !== 'activa') {
    respuestaAdministrativaInvalida();
  }
  const sesion = leerSesionActiva(datos.sesion);
  const leido =
    operacion === 'comprobar' ? leerVigilantePanel(datos[campo]) : leerHistorialVigilantePanel(datos[campo]);
  if (pagina && 'decisiones' in leido && leido.revision !== pagina.revisionEsperada) {
    respuestaAdministrativaInvalida();
  }
  return { sesion, leido };
}
