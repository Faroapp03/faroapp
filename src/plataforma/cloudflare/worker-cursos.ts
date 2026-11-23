// El Worker privado de Cursos atiende las consultas factuales por el enlace de servicio (binding) CURSOS. Cada
// petición contiene todos sus argumentos y usa el paquete de esta instancia aislada; no depende de memoria de peticiones
// anteriores. El principal aplica su plazo de espera y conserva el recorrido cuando Cursos no está disponible.
// Solo atiende al principal que espera su mismo paquete: con otro, responde sin calcular, y el principal da la formación
// por no disponible en lugar de mezclar datos de dos versiones (protocolo-cursos.ts).

import { ESTADO_HTTP } from '../../comun/estados-http.ts';
import { motorDeCursos, type ResultadoDelMotor } from '../motor-de-cursos.ts';
import { PAQUETE } from './paquete.ts';
import {
  HUELLA_DEL_PAQUETE,
  leerPeticionACursos,
  type PeticionACursos,
  type RespuestaDeCursos,
} from './protocolo-cursos.ts';

/** Cada forma de una respuesta, antes de añadirle la huella del paquete de este Worker. */
type SinHuella<R> = R extends unknown ? Omit<R, 'huellaPaquete'> : never;

/** La respuesta JSON al Worker principal, siempre con la huella del paquete de este Worker. */
function responder(respuesta: SinHuella<RespuestaDeCursos>, estado: number = ESTADO_HTTP.correcto): Response {
  return new Response(JSON.stringify({ ...respuesta, huellaPaquete: HUELLA_DEL_PAQUETE }), {
    status: estado,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** Una consulta factual de este paquete, sin referencias de memoria de otra instancia aislada. */
async function atender(peticion: PeticionACursos): Promise<ResultadoDelMotor<unknown>> {
  return motorDeCursos.operar(peticion.nombre, peticion.argumentos as never, { datos: PAQUETE });
}

export default {
  async fetch(solicitud: Request): Promise<Response> {
    if (solicitud.method !== 'POST' || new URL(solicitud.url).pathname !== '/operar') {
      return new Response('No encontrado', { status: ESTADO_HTTP.noEncontrado });
    }
    let cuerpo: unknown;
    try {
      cuerpo = await solicitud.json();
    } catch {
      cuerpo = null;
    }
    const peticion = leerPeticionACursos(cuerpo);
    if (peticion === null) {
      return responder(
        { ok: false, motivo: 'averiado', detalle: 'petición al Worker de Cursos sin la forma esperada' },
        ESTADO_HTTP.solicitudIncorrecta,
      );
    }
    if (peticion.huellaPaquete !== HUELLA_DEL_PAQUETE) {
      return responder(
        {
          ok: false,
          motivo: 'averiado',
          detalle: `el Worker principal espera el paquete ${peticion.huellaPaquete} y el de Cursos lleva el ${HUELLA_DEL_PAQUETE}`,
        },
        ESTADO_HTTP.conflicto,
      );
    }
    const resultado = await atender(peticion);
    return responder(
      resultado.disponible
        ? { ok: true, valor: resultado.valor === undefined ? null : resultado.valor }
        : { ok: false, motivo: resultado.motivo, detalle: resultado.detalle },
    );
  },
};
