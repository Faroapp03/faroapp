/** API factual y MCP para el dispositivo; los canales de servidor no se montan aquí. */
import { OFERTA_POR_DEFECTO } from '../../../compartido/contratos/oferta-de-formacion.ts';
import { prepararBuscador } from '../../../motores/ocupaciones/src/index.ts';
import { type ContextoApi, type ManejadorRuta, responderProblema } from '../../api/contexto-api.ts';
import { clonarPeticionConSenal } from '../../api/cuerpo-local.ts';
import { RUTA_ESTADO_CONECTIVIDAD, responderEstadoConectividad } from '../../api/estado-conectividad.ts';
import {
  CABECERA_CONTRATO,
  CABECERA_PETICION,
  comprobarContrato,
  comprobarPeticionPost,
  problema,
  registrarErrorInterno,
  respuestaDeError,
  respuestaDeProblema,
  respuestaPreflight,
} from '../../api/http.ts';
import { atenderMcp, crearServidorDeAgentes, RUTA_MCP } from '../../api/mcp/servidor-mcp.ts';
import { dentroDelPlazo, PLAZO_PETICION_MS } from '../../api/plazo.ts';
import { clasificar } from '../../api/rutas/clasificar.ts';
import { cursosCon } from '../../api/rutas/cursos.ts';
import { grupo, hijos } from '../../api/rutas/grupos.ts';
import { informe } from '../../api/rutas/informe.ts';
import { buscar, ficha } from '../../api/rutas/ocupaciones.ts';
import { salud } from '../../api/rutas/salud.ts';
import { ESTADO_HTTP } from '../../comun/estados-http.ts';
import type { DatosGlobales } from '../../datos-globales/datos.ts';
import { CAMINO_A_MANO_POR_DEFECTO } from '../../dominio/camino-a-mano.ts';
import type { Datos } from '../../dominio/tipos-paquete.ts';
import { crearFirmador, type SecretoDeFirma } from '../../seguridad/firma.ts';
import { crearLimitadores } from '../../seguridad/limitador.ts';
import { type PuertaDelMotor, puertaConSusDatos } from '../motor-de-cursos.ts';

export interface OpcionesApiLocal {
  datos: Datos;
  datosGlobales?: DatosGlobales | null;
  secretoFirma?: SecretoDeFirma;
  motorDeCursos: PuertaDelMotor;
}
interface Ruta {
  metodo: 'GET' | 'POST';
  patron: RegExp;
  manejar: ManejadorRuta;
}

/** Conserva MCP local: WebMCP lo usa desde el mismo dispositivo. */
export async function crearApiLocal(opciones: OpcionesApiLocal) {
  prepararBuscador(opciones.datos);
  const contexto: ContextoApi = {
    datos: opciones.datos,
    datosGlobales: opciones.datosGlobales ?? null,
    registrarAcceso: async () => {},
    firmador: await crearFirmador(opciones.secretoFirma, undefined, undefined, { uso: 'estimaciones' }),
    politica: 'ocupacion',
    oferta: OFERTA_POR_DEFECTO,
    motorDeCursos: puertaConSusDatos(opciones.motorDeCursos, opciones.datos),
    caminoAMano: CAMINO_A_MANO_POR_DEFECTO,
    origenesPermitidos: [],
    limitadores: crearLimitadores(),
    ipDeCloudflare: false,
    mcp: crearServidorDeAgentes({}),
    a2a: null,
    socios: null,
  };
  const rutas = rutasLocales(contexto);
  return (peticion: Request) => responderLocal(contexto, rutas, peticion);
}
function rutasLocales(contexto: ContextoApi): readonly Ruta[] {
  return [
    { metodo: 'GET', patron: /^\/api\/salud$/, manejar: salud },
    { metodo: 'GET', patron: /^\/api\/ocupaciones$/, manejar: buscar },
    { metodo: 'GET', patron: /^\/api\/ocupaciones\/([\d.]+)$/, manejar: ficha },
    { metodo: 'GET', patron: /^\/api\/grupos$/, manejar: hijos },
    { metodo: 'GET', patron: /^\/api\/grupos\/(\d+)$/, manejar: grupo },
    { metodo: 'GET', patron: /^\/api\/cursos$/, manejar: cursosCon(contexto.motorDeCursos) },
    { metodo: 'POST', patron: /^\/api\/informe$/, manejar: informe },
    { metodo: 'POST', patron: /^\/api\/clasificar$/, manejar: clasificar },
  ];
}
function rutaNormalizada(url: URL): string {
  let fin = url.pathname.length;
  while (fin > 0 && url.pathname[fin - 1] === '/') {
    fin -= 1;
  }
  return url.pathname.slice(0, fin);
}
function sinRuta(contexto: ContextoApi, solicitud: Request, rutas: readonly Ruta[], camino: string): Response {
  const metodos = rutas.filter((ruta) => ruta.patron.test(camino)).map((ruta) => ruta.metodo);
  if (metodos.length) {
    const lista = [...new Set(metodos), 'OPTIONS'].join(', ');
    const respuesta = respuestaDeProblema(
      problema(ESTADO_HTTP.metodoNoAdmitido, 'metodo_no_admitido', `Esta ruta admite ${lista}.`),
    );
    return responderProblema(contexto, solicitud, { ...respuesta, cabeceras: { allow: lista } });
  }
  const respuesta = respuestaDeProblema(
    problema(ESTADO_HTTP.noEncontrado, 'ruta_desconocida', 'La API de Faro no tiene esta ruta.', {
      error: 'ruta desconocida',
    }),
  );
  return responderProblema(contexto, solicitud, respuesta);
}
async function encaminarLocal(contexto: ContextoApi, rutas: readonly Ruta[], solicitud: Request): Promise<Response> {
  const url = new URL(solicitud.url);
  const camino = rutaNormalizada(url);
  if (camino === RUTA_ESTADO_CONECTIVIDAD) {
    return responderEstadoConectividad([], solicitud, null);
  }
  if (camino === RUTA_MCP && contexto.mcp) {
    return atenderMcp(contexto, contexto.mcp, solicitud);
  }
  if (solicitud.method === 'OPTIONS') {
    return respuestaPreflight(solicitud, [], { metodos: 'GET, POST', cabeceras: `content-type, ${CABECERA_CONTRATO}` });
  }
  comprobarContrato(solicitud);
  for (const ruta of rutas) {
    const coincidencia = solicitud.method === ruta.metodo ? ruta.patron.exec(camino) : null;
    if (coincidencia) {
      if (ruta.metodo === 'POST') {
        comprobarPeticionPost(solicitud, []);
      }
      return ruta.manejar(contexto, solicitud, url, coincidencia.slice(1));
    }
  }
  return sinRuta(contexto, solicitud, rutas, camino);
}
async function responderLocal(contexto: ContextoApi, rutas: readonly Ruta[], peticion: Request): Promise<Response> {
  try {
    return await dentroDelPlazo(
      (senal) => encaminarLocal(contexto, rutas, clonarPeticionConSenal(peticion, senal)),
      PLAZO_PETICION_MS,
      peticion.signal,
    );
  } catch (error) {
    const respuesta = responderProblema(contexto, peticion, respuestaDeError(error));
    if (respuesta.status === ESTADO_HTTP.errorInterno) {
      respuesta.headers.set(CABECERA_PETICION, registrarErrorInterno(peticion, error));
    }
    return respuesta;
  }
}
