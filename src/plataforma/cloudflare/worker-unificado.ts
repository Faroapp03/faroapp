import { capturarConfiguracionVigilante } from '../../administracion/configuracion-vigilante.ts';
import { RUTA_DE_LA_ENCUESTA, responderEncuesta } from '../../encuesta/entrada-cloudflare.ts';
import type { EspacioAccesoPublicoDurable } from '../acceso-publico/durable.ts';
import { AlmacenRecorridoDurable } from '../acceso-publico/recorrido-cliente-durable.ts';
import type { CapacidadesPanel } from '../administracion.ts';
import type { EntornoPrivado } from './acceso-privado.ts';
import { accesoNoDisponible, responderAccesoRecorrido } from './acceso-recorrido.ts';
import { type VarianteEntrada, varianteDeRuta } from './entrada-recorrido.ts';
import { identificadoresLimiteRecorrido } from './limite-recorrido.ts';
import { RUTA_MODO_RECORRIDO, responderModoRecorrido } from './modo-publico.ts';
import { respuestaNoExiste } from './pagina-no-existe.ts';
// Import estático a propósito: el Worker del motor se evalúa al arrancar el aislado, no dentro de una petición. Con
// import() diferido, esbuild lo marca como iniciado antes de evaluarlo y un aislado cortado a mitad de esa evaluación
// respondería después sin él. La carga pesada (buscador y paquete) se hace al montar la API y se puede repetir.
import worker from './worker.ts';

export { AccesoPublicoDurable } from '../acceso-publico/durable.ts';

export async function responderUnificado(solicitud: Request, variables: EntornoPrivado): Promise<Response> {
  if (new URL(solicitud.url).pathname === '/capacidades-panel.json') {
    const estado = capturarConfiguracionVigilante({
      FARO_VIGILANTE: typeof variables.FARO_VIGILANTE === 'string' ? variables.FARO_VIGILANTE : undefined,
    });
    const vigilante = estado.invalida || estado.configuracion?.habilitado === true;
    return Response.json(
      {
        version: 1,
        ...({ controles: true, actualizacion: true, vigilante, recorrido: true } satisfies CapacidadesPanel),
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  }
  const {
    FARO_RECORRIDO_CLAVE: clave,
    FARO_RECORRIDO_FIRMA: firma,
    FARO_RECORRIDO_LIMITE: secretoLimite,
    ...entorno
  } = variables;
  const espacio = entorno.REGISTRO_SOCIOS as EspacioAccesoPublicoDurable | undefined;
  const pathname = new URL(solicitud.url).pathname;
  if (pathname === RUTA_MODO_RECORRIDO) {
    return responderModoRecorrido(solicitud, espacio);
  }
  if (pathname === RUTA_DE_LA_ENCUESTA) {
    return responderEncuesta(solicitud, espacio);
  }
  let variante: VarianteEntrada | null;
  try {
    variante = varianteDeRuta(pathname);
  } catch {
    return respuestaNoExiste(solicitud, entorno.ASSETS);
  }
  if (!variante) {
    return worker.fetch(solicitud, entorno);
  }
  if (!espacio) {
    return accesoNoDisponible(solicitud, variante);
  }
  const almacen = new AlmacenRecorridoDurable(espacio);
  return responderAccesoRecorrido(solicitud, {
    variante,
    clave,
    firma,
    leerModo: () => almacen.leerRecorrido(),
    consumirIntento: async (peticion) => {
      if (secretoLimite === clave || secretoLimite === firma) {
        throw new Error('Se requiere una clave de límite independiente');
      }
      return almacen.consumirIntentoRecorrido(await identificadoresLimiteRecorrido(peticion, secretoLimite));
    },
    delegar: (peticion) => worker.fetch(peticion, entorno),
  });
}
export default {
  fetch(peticion: Request, entorno: EntornoPrivado): Promise<Response> {
    return responderUnificado(peticion, entorno);
  },
};
