// GET /api/salud: disponibilidad, versión y configuración pública del servicio.
import { ESTADO_HTTP } from '../../comun/estados-http.ts';
import { VERSION_FARO } from '../../comun/version.ts';
import { type ContextoApi, responder } from '../contexto-api.ts';

export async function salud(contexto: ContextoApi, peticion: Request): Promise<Response> {
  const { oferta, caminoAMano } = contexto;
  return responder(contexto, peticion, ESTADO_HTTP.correcto, {
    estado: 'ok',
    version: VERSION_FARO,
    interruptores: {
      formacionAbierta: oferta.formacionAbierta,
      citilabPago: oferta.citilabDePago,
      sinConexion: caminoAMano,
    },
  });
}
