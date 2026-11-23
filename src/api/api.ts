// API de Faro con la forma de un Worker de Cloudflare: una función (Request) => Response.
// Sin registros de contenido. El servidor solo atiende consultas factuales: la clasificación y el informe, que
// reciben lo que la persona escribe, los atiende el motor del dispositivo (plataforma/navegador/api-local.ts), así que
// el relato no sale de él. Cada petición tiene su plazo (api/plazo.ts), comprueba la versión del contrato con la web y
// aplica los límites de lectura. Un error interno deja
// rastro técnico sin copiar el contenido ni la ruta de la petición (registrarErrorInterno, en errores.ts).

import { OFERTA_POR_DEFECTO, type OfertaDeFormacion } from '../../compartido/contratos/oferta-de-formacion.ts';
import { prepararBuscador } from '../../motores/ocupaciones/src/index.ts';
import { ESTADO_HTTP } from '../comun/estados-http.ts';
import type { DatosGlobales } from '../datos-globales/datos.ts';
import { CAMINO_A_MANO_POR_DEFECTO } from '../dominio/camino-a-mano.ts';
import type { Datos, PoliticaReferencias } from '../dominio/tipos-paquete.ts';
import { motorDeCursos, type PuertaDelMotor, puertaConSusDatos } from '../plataforma/motor-de-cursos.ts';
import { crearFirmador, type SecretoDeFirma } from '../seguridad/firma.ts';
import { crearLimitadores, type Limitadores } from '../seguridad/limitador.ts';
import { atenderA2a, responderTarjeta } from './a2a/servidor-a2a.ts';
import { RUTA_A2A, RUTA_TARJETA } from './a2a/tarjeta.ts';
import { type ContextoApi, exigirLecturaDeLaRed, type ManejadorRuta, responderProblema } from './contexto-api.ts';
import {
  type AdministracionApi,
  type CapacidadesAdministradas,
  capturarDisponibilidad,
  problemaDeControles,
  proyectarControles,
} from './controles-administrativos.ts';
import { clonarPeticionConSenal } from './cuerpo-local.ts';
import { RUTA_ESTADO_CONECTIVIDAD, responderEstadoConectividad } from './estado-conectividad.ts';
import {
  CABECERA_CONTRATO,
  CABECERA_PETICION,
  comprobarContrato,
  problema,
  type RespuestaDeError,
  registrarErrorInterno,
  respuestaDeError,
  respuestaDeProblema,
  respuestaPreflight,
} from './http.ts';
import { type ClaveDeFirma, crearFirmadorMcp } from './mcp/firma-de-respuesta.ts';
import { atenderMcp, crearServidorDeAgentes, RUTA_MCP, type ServidorDeAgentes } from './mcp/servidor-mcp.ts';
import { exigirOpcionesApi } from './opciones-api.ts';
import { dentroDelPlazo, PLAZO_PETICION_MS } from './plazo.ts';
import { registradorAdministrado } from './registro-operativo.ts';
import { cursos, cursosCon } from './rutas/cursos.ts';
import { grupo, hijos } from './rutas/grupos.ts';
import { buscar, ficha } from './rutas/ocupaciones.ts';
import { salud } from './rutas/salud.ts';
import { atenderApiDeSocios, esDeLaApiDeSocios } from './socios/api-de-socios.ts';
import { responderDescubrimientoOAuth } from './socios/descubrimiento-oauth.ts';
import { crearServidorDeSocios, type OpcionesDeSocios } from './socios/servidor-socios.ts';

/** Lo que admite la comprobación previa de CORS de las rutas /api/*: sus métodos y las cabeceras de la web. */
const ADMITIDOS_EN_LA_API = {
  metodos: 'GET',
  cabeceras: `content-type, ${CABECERA_CONTRATO}`,
};

/** Firma, rotación de claves y límites de lectura del despliegue. */
interface OpcionesDeSeguridad {
  limitadores?: Partial<Limitadores>;
  secretoFirma?: SecretoDeFirma;
  secretoFirmaAnterior?: SecretoDeFirma;
  ipDeCloudflare?: boolean;
}

/**
 * Los agentes con consultas deterministas (FARO_MCP y FARO_A2A): MCP en
 * POST /mcp y A2A, con su tarjeta en /.well-known/agent-card.json y su enlace JSON-RPC en POST /a2a.
 * true enciende cada uno con su límite por red y la fecha del día; las pruebas pueden darle los suyos.
 * Por defecto, apagados: esas rutas no existen.
 */
interface OpcionesDeLosAgentes {
  mcp?: boolean | Partial<ServidorDeAgentes>;
  a2a?: boolean | Partial<ServidorDeAgentes>;
  /** Las claves con que MCP firma sus resultados (FARO_FIRMA_MCP_CLAVES); sin ellas, no firma. */
  clavesFirmaMcp?: ClaveDeFirma[] | null;
  /**
   * La API para socios (FARO_API_SOCIOS, docs/api/socios.md): con su registro, las mismas consultas en
   * /api/socios/v1/*, con un token OAuth 2.0 firmado con la subclave del secreto de firma. Por defecto, apagada: esas
   * rutas no existen.
   */
  socios?: OpcionesDeSocios | null;
}

/**
 * Con qué se crea la API: los datos, quién puede leerla, la política de referencias y la oferta de
 * formación; y, agrupado por responsabilidad, la seguridad y los agentes. Lo que sale del entorno lo traduce
 * plataforma/configuracion.ts, igual para el Worker y el servidor local.
 */
export interface OpcionesApi {
  datos: Datos;
  /** Instantánea global validada, independiente del paquete y de la IA; ausencia, indisponible. */
  datosGlobales?: DatosGlobales | null;
  /** Orígenes web de otros sitios a los que se permite leer las respuestas. */
  origenesPermitidos: readonly string[];
  /**
   * Con qué tareas oficiales se calibran las estimaciones (dominio/referencias.ts). Por defecto, las de la
   * ocupación.
   */
  politicaReferencias?: PoliticaReferencias;
  /**
   * La formación de fuera del catálogo oficial que enseña /api/cursos (compartido/contratos/oferta-de-formacion.ts).
   * Por defecto, OFERTA_POR_DEFECTO.
   */
  oferta?: OfertaDeFormacion;
  /**
   * Plazo de cada petición, en milisegundos. Por defecto, PLAZO_PETICION_MS (api/plazo.ts); el Worker y el servidor
   * local pasan el del perfil (plazoDelEntorno) y las pruebas lo acortan.
   */
  plazoMs?: number;
  seguridad?: OpcionesDeSeguridad;
  caminoAMano?: boolean;
  agentes?: OpcionesDeLosAgentes;
  /** Si existe, la política durable es obligatoria en cada petición; un fallo no recupera la política inicial. */
  administracion?: AdministracionApi;
  /**
   * La puerta del motor de cursos (plataforma/motor-de-cursos.ts) que usan /api/cursos, MCP, A2A y la API para
   * socios. Por defecto, la de la app; las pruebas dan la suya para simular un motor ausente, averiado o bloqueado.
   */
  motorDeCursos?: PuertaDelMotor;
}

/** Una ruta de la API: los grupos del patrón llegan al manejador como parámetros. Todas son lecturas. */
export interface Ruta {
  metodo: 'GET';
  patron: RegExp;
  manejar: ManejadorRuta;
}

/** Las rutas de la API, en el orden en que se prueban. */
export const RUTAS_API: readonly Ruta[] = [
  { metodo: 'GET', patron: /^\/api\/salud$/, manejar: salud },
  { metodo: 'GET', patron: /^\/api\/ocupaciones$/, manejar: buscar },
  { metodo: 'GET', patron: /^\/api\/ocupaciones\/([\d.]+)$/, manejar: ficha },
  { metodo: 'GET', patron: /^\/api\/grupos$/, manejar: hijos },
  { metodo: 'GET', patron: /^\/api\/grupos\/(\d+)$/, manejar: grupo },
  { metodo: 'GET', patron: /^\/api\/cursos$/, manejar: cursos },
];

/** Las rutas de una API con su puerta del motor de cursos: las de RUTAS_API, con /api/cursos atendida por esa puerta. */
function rutasConElMotor(puerta: PuertaDelMotor | undefined): readonly Ruta[] {
  if (!puerta) {
    return RUTAS_API;
  }
  const propias = new Map<ManejadorRuta, ManejadorRuta>([[cursos, cursosCon(puerta)]]);
  return RUTAS_API.map((ruta) => ({ ...ruta, manejar: propias.get(ruta.manejar) ?? ruta.manejar }));
}

/** La API: recibe una petición y siempre la responde, también cuando algo falla. */
export type ResponderApi = (peticion: Request) => Promise<Response>;

/**
 * Los protocolos para agentes de IA y la API para socios, si están encendidos: el servidor MCP, el agente A2A (su
 * enlace y su tarjeta) y la API para socios (OAuth 2.0). Hablan su propio protocolo, con sus versiones y sus errores, y
 * no llevan el contrato con la web. null si no es uno.
 */
function rutaDeAgentes(contexto: ContextoApi, camino: string, peticion: Request): Promise<Response> | null {
  if (contexto.socios && esDeLaApiDeSocios(camino)) {
    return atenderApiDeSocios(contexto, contexto.socios, peticion, camino);
  }
  if (contexto.mcp && camino === RUTA_MCP) {
    return atenderMcp(contexto, contexto.mcp, peticion);
  }
  if (contexto.a2a && camino === RUTA_A2A) {
    return atenderA2a(contexto, contexto.a2a, peticion);
  }
  if (contexto.a2a && camino === RUTA_TARJETA) {
    return responderTarjeta(contexto, peticion);
  }
  return null;
}

/**
 * Los métodos que admite el camino (el Allow de un 405, RFC 9110, 15.5.6), con OPTIONS, la comprobación previa de
 * CORS; ninguno si no es de la API.
 */
function metodosDelCamino(camino: string): string[] {
  const metodos = RUTAS_API.filter(({ patron }) => patron.test(camino)).map(({ metodo }) => metodo);
  return metodos.length === 0 ? [] : [...new Set(metodos), 'OPTIONS'];
}

/**
 * El camino de una ruta de la API sin barras finales: «/api/salud/» es «/api/salud». Recorre el camino una vez desde
 * el final: `replace(/\/+$/, '')` reintenta desde cada barra y es cuadrático con muchas barras seguidas de otro
 * carácter, antes de que ningún limitador cuente la petición.
 *
 * @param ruta - El camino de la URL.
 * @returns El camino sin barras finales.
 */
export function caminoDeLaRuta(ruta: string): string {
  let fin = ruta.length;
  while (fin > 0 && ruta[fin - 1] === '/') {
    fin -= 1;
  }
  return ruta.slice(0, fin);
}

/**
 * El problema de una petición que ninguna ruta atiende: 405 con Allow si el camino existe con otro método (RFC 9110,
 * 15.5.6), o 404. Lo responde la API y también el servidor local de Node a los métodos que Fetch no deja crear
 * (plataforma/node/servidor.ts), así que los dos dicen lo mismo.
 *
 * @param camino - El camino, ya sin barras finales.
 * @returns El 405 o el 404.
 */
export function problemaSinRuta(camino: string): RespuestaDeError {
  const admitidos = metodosDelCamino(camino);
  if (admitidos.length > 0) {
    const lista = admitidos.join(', ');
    const detalle = `Esta ruta admite ${lista}.`;
    const respuesta = respuestaDeProblema(problema(ESTADO_HTTP.metodoNoAdmitido, 'metodo_no_admitido', detalle));
    return { ...respuesta, cabeceras: { allow: lista } };
  }
  const desconocida = problema(ESTADO_HTTP.noEncontrado, 'ruta_desconocida', 'La API de Faro no tiene esta ruta.', {
    error: 'ruta desconocida',
  });
  return respuestaDeProblema(desconocida);
}

/**
 * Busca la ruta que atiende la petición y la ejecuta; sin ninguna, responde 404, o 405 con Allow si el camino existe
 * con otro método. Antes de nada se comprueba que la web hable el mismo contrato (409 si no) y, antes de la ruta, el
 * límite de lecturas de su red.
 */
async function encaminar(contexto: ContextoApi, peticion: Request, rutas: readonly Ruta[]): Promise<Response> {
  const url = new URL(peticion.url);
  const camino = caminoDeLaRuta(url.pathname);
  const descubrimiento = responderDescubrimientoOAuth(contexto, peticion, camino);
  if (descubrimiento) {
    return descubrimiento;
  }
  const deAgentes = rutaDeAgentes(contexto, camino, peticion);
  if (deAgentes) {
    return deAgentes;
  }
  if (peticion.method === 'OPTIONS') {
    return respuestaPreflight(peticion, contexto.origenesPermitidos, ADMITIDOS_EN_LA_API);
  }
  comprobarContrato(peticion);
  for (const { metodo, patron, manejar } of rutas) {
    const coincidencia = peticion.method === metodo ? patron.exec(camino) : null;
    if (!coincidencia) {
      continue;
    }
    await exigirLecturaDeLaRed(contexto, peticion);
    return manejar(contexto, peticion, url, coincidencia.slice(1));
  }
  return responderProblema(contexto, peticion, problemaSinRuta(camino));
}

/** La respuesta a un error. Un error interno deja rastro, y su identificador viaja en la respuesta. */
function responderError(contexto: ContextoApi, peticion: Request, error: unknown): Response {
  const respuesta = responderProblema(contexto, peticion, respuestaDeError(error));
  if (respuesta.status === ESTADO_HTTP.errorInterno) {
    respuesta.headers.set(CABECERA_PETICION, registrarErrorInterno(peticion, error));
  }
  return respuesta;
}

/** Los límites de la API: los que se den y, para los que no, los de memoria con sus cifras. */
function limitadoresDe(dados: Partial<Limitadores> = {}): Limitadores {
  const porDefecto = crearLimitadores();
  return {
    lecturas: dados.lecturas ?? porDefecto.lecturas,
  };
}

/** El servidor MCP o el agente A2A de las opciones: apagado sin ellas o con false; con true, el de por defecto. */
function servidorDeAgentesDe(agente: OpcionesDeLosAgentes['mcp' | 'a2a']): ServidorDeAgentes | null {
  return agente ? crearServidorDeAgentes(agente === true ? {} : agente) : null;
}

/**
 * El servidor MCP de las opciones, con su firmador si hay claves. Las claves se importan y se comprueban al crear la
 * API: unas que la plataforma no admite impiden arrancar, en lugar de dejar las respuestas sin firma.
 */
async function servidorMcpDe({ mcp, clavesFirmaMcp }: OpcionesDeLosAgentes): Promise<ServidorDeAgentes | null> {
  if (!mcp || !clavesFirmaMcp) {
    return servidorDeAgentesDe(mcp);
  }
  const firmador = await crearFirmadorMcp(clavesFirmaMcp);
  return crearServidorDeAgentes({ ...(mcp === true ? {} : mcp), firmador });
}

/**
 * La puerta del motor de cursos: la que dan las opciones o, sin ella, la de la app; averiada si a los datos les falta
 * algún archivo de cursos (puertaConSusDatos).
 */
function puertaDe({ motorDeCursos: puerta, datos }: OpcionesApi): PuertaDelMotor {
  return puertaConSusDatos(puerta ?? motorDeCursos, datos);
}

async function crearContexto(opciones: OpcionesApi): Promise<ContextoApi> {
  const { seguridad = {}, agentes = {}, datosGlobales = null } = opciones;
  const socios = opciones.administracion ? opciones.administracion.socios : agentes.socios;
  return {
    datos: opciones.datos,
    registrarAcceso: registradorAdministrado(opciones.administracion),
    datosGlobales,
    firmador: await crearFirmador(seguridad.secretoFirma, undefined, undefined, {
      uso: 'estimaciones',
      anterior: seguridad.secretoFirmaAnterior,
    }),
    politica: opciones.politicaReferencias ?? 'ocupacion',
    oferta: opciones.oferta ?? OFERTA_POR_DEFECTO,
    motorDeCursos: puertaDe(opciones),
    caminoAMano: opciones.caminoAMano ?? CAMINO_A_MANO_POR_DEFECTO,
    origenesPermitidos: opciones.origenesPermitidos,
    limitadores: limitadoresDe(seguridad.limitadores),
    ipDeCloudflare: seguridad.ipDeCloudflare ?? false,
    mcp: await servidorMcpDe(agentes),
    a2a: servidorDeAgentesDe(agentes.a2a),
    socios: socios
      ? await crearServidorDeSocios(socios, {
          secreto: seguridad.secretoFirma,
          anterior: seguridad.secretoFirmaAnterior,
        })
      : null,
  };
}

/** Las capacidades se preparan una vez; habilitarlas no recrea emisor, credenciales ni cuentas. */
async function capacidadesAdministradas(
  contexto: ContextoApi,
  opciones: OpcionesApi,
): Promise<CapacidadesAdministradas> {
  if (!opciones.administracion) {
    return contexto;
  }
  const { seguridad = {}, agentes = {}, administracion } = opciones;
  return {
    mcp: contexto.mcp ?? (await servidorMcpDe({ ...agentes, mcp: true })),
    a2a: contexto.a2a ?? servidorDeAgentesDe(true),
    socios:
      contexto.socios ??
      (administracion.socios
        ? await crearServidorDeSocios(administracion.socios, {
            secreto: seguridad.secretoFirma,
            anterior: seguridad.secretoFirmaAnterior,
          })
        : null),
  };
}
/**
 * Crea la API: una función que recibe cada petición y la responde, como un Worker de Cloudflare.
 *
 * @param opciones - Los datos, los orígenes y la seguridad del despliegue.
 * @returns La función que atiende cada petición.
 */
export async function crearApi(opciones: OpcionesApi): Promise<ResponderApi> {
  exigirOpcionesApi(opciones);
  // El índice del buscador se prepara al crear la API (en un Worker, al arrancar), no en la primera petición.
  prepararBuscador(opciones.datos);
  const contexto = await crearContexto(opciones);
  const capacidades = await capacidadesAdministradas(contexto, opciones);
  const plazoMs = opciones.plazoMs ?? PLAZO_PETICION_MS;
  const rutas = rutasConElMotor(contexto.motorDeCursos);

  return async function manejar(peticion: Request): Promise<Response> {
    let respuesta: Response;
    // Las rutas reciben la señal del plazo también al leer el cuerpo.
    let enCurso = peticion;
    let contextoActual = contexto;
    try {
      respuesta = await dentroDelPlazo(
        async (senal) => {
          // El plazo alcanza también la lectura del cuerpo, antes de ejecutar la ruta.
          enCurso = clonarPeticionConSenal(peticion, senal);
          const camino = caminoDeLaRuta(new URL(enCurso.url).pathname);
          const controles = await capturarDisponibilidad(opciones.administracion, contexto, senal);
          if (camino === RUTA_ESTADO_CONECTIVIDAD) {
            return responderEstadoConectividad(contexto.origenesPermitidos, enCurso, controles);
          }
          if (opciones.administracion) {
            contextoActual = proyectarControles(contexto, controles, capacidades);
          }
          const denegacion = problemaDeControles(controles, camino);
          if (denegacion) {
            return responderProblema(contextoActual, enCurso, denegacion);
          }
          return encaminar(contextoActual, enCurso, rutas);
        },
        plazoMs,
        peticion.signal,
      );
    } catch (error) {
      respuesta = responderError(contexto, peticion, error);
    }
    if (opciones.administracion) {
      respuesta.headers.set('cache-control', 'no-store');
    }
    return respuesta;
  };
}
