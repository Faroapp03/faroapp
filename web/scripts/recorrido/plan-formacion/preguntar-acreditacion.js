import { conVersiones, idiomaActual } from '../../textos.js';
import { decirFaro, decirPersona, llevarALaVista } from '../conversacion.js';
import { crearEleccionAcreditacion } from './acreditacion.js';
/** @import { AcreditacionPlan, IdiomaPlan } from './contrato.js' */
/** @param {AcreditacionPlan[]} opciones @param {IdiomaPlan} idioma @param {AbortSignal} signal @param {()=>boolean} vigente */
export async function preguntarAcreditacion(opciones, idioma, signal, vigente) {
  if (signal.aborted || !vigente()) {
    return null;
  }
  if (!opciones.length) {
    decirFaro(
      conVersiones({
        es: 'No he encontrado una acreditación comprobada para esta ocupación.',
        ca: 'No he trobat cap acreditació comprovada per a aquesta ocupació.',
      }),
    );
    return null;
  }
  const eleccion = crearEleccionAcreditacion(opciones, idioma, signal);
  const mensaje = decirFaro(eleccion.nodo);
  llevarALaVista(mensaje, 'start');
  eleccion.titulo.focus({ preventScroll: true });
  const elegida = await eleccion.respuesta;
  if (!signal.aborted && vigente() && idiomaActual() === idioma) {
    decirPersona(elegida ? `${elegida.nombre} (${elegida.codigo})` : conVersiones({ es: 'Ahora no', ca: 'Ara no' }));
  }
  return elegida;
}
