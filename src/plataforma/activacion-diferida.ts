/** La activación se monta con la primera petición; un fallo de su montaje no impide consultar datos ni administrar. */
import { crearReceptorActivacion } from '../administracion/activacion-http.ts';
import {
  crearConsultorFinEjecucionGitHub,
  crearConsultorIntentoActivacionGitHub,
} from '../administracion/consulta-ejecucion-github.ts';
import { PLAZO_PANEL_MS } from '../administracion/http.ts';
import { dentroDelPlazo } from '../api/plazo.ts';
import type { OpcionesMontajeAdministrativo } from './administracion.ts';

/** El relevo pregunta por un intento exacto; el cierre pedido, por el fin de toda la ejecución. */
function consultoresDeActivacion(consulta: Parameters<typeof crearConsultorFinEjecucionGitHub>[0]) {
  return {
    consultarIntento: crearConsultorIntentoActivacionGitHub(consulta),
    consultarFin: crearConsultorFinEjecucionGitHub(consulta),
  };
}
/** Un fallo de activación no impide consultar datos, administrar ni preparar un candidato. */
export function activacionDiferida(opciones: OpcionesMontajeAdministrativo) {
  if (!opciones.activacionHabilitada) {
    return undefined;
  }
  let actual: Promise<(peticion: Request) => Promise<Response>> | undefined;
  const montar = async () => {
    if (
      !opciones.activacionHabilitada?.() ||
      !opciones.actualizacion ||
      !opciones.trabajos ||
      !opciones.almacenActivacion
    ) {
      throw new Error('La activación requiere configuración y autoridad durables');
    }
    const ejecutor = opciones.actualizacion.configuracion();
    const { pedir } = opciones.actualizacion;
    const consulta = { obtenerToken: ejecutor.obtenerToken, ...(pedir ? { pedir } : {}) };
    const recibir = crearReceptorActivacion({
      ...opciones.configuracion,
      confianza: ejecutor.confianza,
      ...consultoresDeActivacion(consulta),
      almacen: opciones.almacenActivacion,
      ...(pedir ? { pedir } : {}),
    });
    await opciones.trabajos.prepararTrabajos();
    await opciones.almacenActivacion.prepararActivacion();
    return recibir;
  };
  const obtener = () => {
    if (!actual) {
      const candidata = montar();
      actual = candidata;
      void candidata.catch(() => {
        if (actual === candidata) {
          actual = undefined;
        }
      });
    }
    return actual;
  };
  return (peticion: Request): Promise<Response> =>
    dentroDelPlazo(
      async (senal) => {
        const recibir = await obtener();
        senal.throwIfAborted();
        return recibir(new Request(peticion, { signal: senal }));
      },
      PLAZO_PANEL_MS,
      peticion.signal,
    );
}
