/**
 * Las llamadas de máquina del mantenimiento en el Worker, separadas de Access humano y de las credenciales de lectura
 * pública. Cada ruta tiene su receptor; una ruta sin receptor montado responde lo mismo que una que no existe.
 */
import { RUTA_ACTIVACION } from '../../administracion/activacion-http.ts';
import { type EnSegundoPlano, RUTA_INICIO_ACTUALIZACION } from '../../administracion/inicio-actualizacion.ts';
import { RUTA_RESERVA_A_DEMANDA } from '../../administracion/reserva-a-demanda.ts';
import { RUTA_RESULTADO_ACTUALIZACION } from '../../administracion/resultado-actualizacion.ts';
import { ESTADO_HTTP } from '../../comun/estados-http.ts';
import type { AdministracionMontada } from '../administracion.ts';
import type { AlmacenDeArchivos } from './activos-publicos.ts';
import { crearLectorConstruccionServida, RUTA_CONSTRUCCION_SERVIDA } from './construccion-servida.ts';

type Receptor = (peticion: Request) => Promise<Response>;
/** Lo que el Worker sabe de su entorno: si administra, cómo obtener el panel y dónde dejar un fallo del montaje. */
export interface EntornoMantenimiento {
  readonly administrado: boolean;
  readonly variables: Record<string, string>;
  readonly metadatosVersion: unknown;
  readonly assets: AlmacenDeArchivos;
  readonly obtenerPanel: () => Promise<AdministracionMontada>;
  readonly registrarNoDisponible: (error: unknown) => void;
}

const leerConstruccionServida = crearLectorConstruccionServida();
/** Las rutas que pasan a un receptor del panel; cualquier otra bajo /mantenimiento/ no existe. */
const RECEPTORES: ReadonlyMap<
  string,
  (panel: AdministracionMontada, segundo?: EnSegundoPlano) => Receptor | undefined
> = new Map([
  [RUTA_RESULTADO_ACTUALIZACION, (panel) => panel.recibirResultado],
  [
    RUTA_INICIO_ACTUALIZACION,
    (panel, segundo) => {
      const { recibirInicio } = panel;
      return recibirInicio && ((p: Request) => recibirInicio(p, segundo));
    },
  ],
  [RUTA_ACTIVACION, (panel) => panel.recibirActivacion],
  [RUTA_RESERVA_A_DEMANDA, (panel) => panel.recibirReserva],
]);

function noEncontrada(): Response {
  return new Response(null, { status: ESTADO_HTTP.noEncontrado, headers: { 'cache-control': 'no-store' } });
}
export async function responderMantenimiento(
  peticion: Request,
  entorno: EntornoMantenimiento,
  url: URL,
  segundo?: EnSegundoPlano,
): Promise<Response> {
  if (url.pathname === RUTA_CONSTRUCCION_SERVIDA) {
    return leerConstruccionServida(peticion, entorno.variables, entorno.metadatosVersion, entorno.assets);
  }
  const elegir = RECEPTORES.get(url.pathname);
  if (!entorno.administrado || !elegir) {
    return noEncontrada();
  }
  try {
    const recibir = elegir(await entorno.obtenerPanel(), segundo);
    return recibir ? await recibir(peticion) : noEncontrada();
  } catch (error) {
    entorno.registrarNoDisponible(error);
    return Response.json(
      { error: 'no_disponible' },
      { status: ESTADO_HTTP.noDisponible, headers: { 'cache-control': 'no-store' } },
    );
  }
}
