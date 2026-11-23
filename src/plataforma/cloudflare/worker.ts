// Entrada de Cloudflare Workers: sirve ASSETS, datos, catálogo, MCP/A2A y la API de socios con sus cabeceras.
// FARO_ADMINISTRACION=si monta el panel autenticado y la política durable antes de los archivos estáticos.
// Las instancias conservan firmas y cuentas; cada petición administrada consulta la autoridad compartida.
// El recorrido usa los motores locales del dispositivo.
// El buscador y el índice vectorial común se preparan al montar la API; el resto del paquete se lee al usarlo.

import { descripcionDeLaOferta } from '../../../compartido/contratos/oferta-de-formacion.ts';
import { enlaceCorreoDelEntorno } from '../../administracion/envio-aviso-correo.ts';
import type { EnSegundoPlano } from '../../administracion/inicio-actualizacion.ts';
import { RUTA_A2A, RUTA_TARJETA } from '../../api/a2a/tarjeta.ts';
import { crearApi, type ResponderApi } from '../../api/api.ts';
import {
  capturarControles,
  type DisponibilidadConectividad,
  problemaDeControles,
} from '../../api/controles-administrativos.ts';
import { registrarErrorOperativo, respuestaDeError } from '../../api/errores.ts';
import { RUTA_ESTADO_CONECTIVIDAD, responderEstadoConectividad } from '../../api/estado-conectividad.ts';
import { problema, respuestaConProblema, respuestaDeProblema } from '../../api/http.ts';
import { RUTA_MCP } from '../../api/mcp/servidor-mcp.ts';
import { plazoDelEntorno } from '../../api/plazo.ts';
import { esDescubrimientoOAuth } from '../../api/socios/descubrimiento-oauth.ts';
import { ESTADO_HTTP } from '../../comun/estados-http.ts';
import { listaDeComas } from '../../comun/texto.ts';
import { descripcionDelCaminoAMano } from '../../dominio/camino-a-mano.ts';
import { crearLimitadores } from '../../seguridad/limitador.ts';
import type { EspacioAccesoPublicoDurable } from '../acceso-publico/durable.ts';
import { esRutaAdministrativa, esRutaApiAdministrada, esRutaMantenimiento } from '../administracion.ts';
import {
  conCabecerasWeb,
  POLITICA_DE_LA_API,
  PORTADA,
  RUTA_CATALOGO_DE_APIS,
  RUTA_DE_AVISOS,
  tipoPropioDe,
  VALOR_HSTS,
} from '../cabeceras-web.ts';
import { respuestaDelCatalogo } from '../catalogo-de-apis.ts';
import { mismasVariables, type OpcionesDelEntorno, opcionesDelEntorno } from '../configuracion.ts';
import { cargarDatosGlobales } from '../datos-globales.ts';
import { esDescripcionDeConectividad, respuestaDeDescripcion } from '../descripcion-conectividad.ts';
import { respuestaSinPortalEn } from '../estado-del-portal.ts';
import { archivoDelPaquetePublicado, CACHE_DEL_PAQUETE } from '../paquete-publicado.ts';
import { crearPuntoDeAvisos } from '../punto-de-avisos.ts';
import { comprobarSeccionWeb, RUTA_SECCIONES, respuestaDeSecciones } from '../secciones-web.ts';
import { datosDeSeguridad, RUTA_SECURITY_TXT, respuestaDeSecurityTxt } from '../seguridad-txt.ts';
import { variablesDelServicio } from '../variables-del-servicio.ts';
import { type AdministracionCloudflare, prepararAdministracionCloudflare } from './administracion.ts';
import { prepararBuscadorDeLaApi } from './buscador-api.ts';
import { type Cerrojo, cerrojoDelEntorno } from './cerrojo-access.ts';
import { respuestaDeRutaCanonica } from './dominio-canonico.ts';
import { responderMantenimiento } from './mantenimiento-worker.ts';
import { esDireccionInexistente, respuestaNoExiste } from './pagina-no-existe.ts';
import { PAQUETE as datos } from './paquete.ts';
import { atenderEventoProgramado, type EventoProgramadoWorker } from './programada-worker.ts';
import { crearPuertaDeCursosCloudflare, type EnlaceDeCursos } from './puerta-cursos.ts';
import { lectorSeccionesDelEntorno, respuestaSeccionesV3 } from './secciones-v3.ts';

export { AccesoPublicoDurable } from '../acceso-publico/durable.ts';

/**
 * Cloudflare entrega los recursos estáticos, el almacén operativo, los servicios y las variables configuradas.
 */
interface Entorno extends Record<string, unknown> {
  ASSETS: { fetch(peticion: Request): Promise<Response> };
  REGISTRO_SOCIOS?: EspacioAccesoPublicoDurable;
  CF_VERSION_METADATA?: unknown;
  /** El Worker de Cursos (worker-cursos.ts), por su enlace de servicio: el motor de cursos no corre en este Worker. */
  CURSOS?: EnlaceDeCursos;
}

/** La API creada con las variables del entorno y, con la declaración de pruebas, el cerrojo de Access que la guarda. */
interface ApiDelEntorno {
  responder: ResponderApi;
  cerrojo: Cerrojo | null;
}

// La API se crea con la primera petición a /api/ (hasta entonces no se conocen las variables) y se reutiliza.
interface InstanciaApi {
  assets: Entorno['ASSETS'];
  variables: Record<string, string>;
  registroSocios: EspacioAccesoPublicoDurable | undefined;
  cursos: EnlaceDeCursos | undefined;
  api: Promise<ApiDelEntorno>;
}
let apiActiva: InstanciaApi | null = null;
let apiEnCreacion: InstanciaApi | null = null;
interface InstanciaPanel {
  readonly variables: Record<string, string>;
  readonly registro: EspacioAccesoPublicoDurable | undefined;
  readonly montaje: Promise<AdministracionCloudflare>;
}
let panelActivo: InstanciaPanel | null = null;
/** El punto de avisos técnicos del navegador de esta instancia, con su tope de envíos por minuto. */
const recibirAvisos = crearPuntoDeAvisos();

/**
 * Un archivo de la web (web/), con las cabeceras de seguridad. El paquete de datos publicado
 * (herramientas/publicar-paquete.ts) va además inmutable: su ruta lleva la huella de su versión, así que el navegador y
 * Cloudflare lo guardan sin volver a preguntar. Un archivo cuyo tipo no dice su extensión (las reglas de preprocesado)
 * lleva el suyo.
 */
async function recursoPublico(env: Entorno, peticion: Request, url: URL): Promise<Response> {
  const lector = lectorSeccionesDelEntorno(modoAdministrado(env), env.REGISTRO_SOCIOS, async () =>
    (await panelDelEntorno(env)).obtenerPanel(),
  );
  if (url.pathname === '/secciones-v3.json') {
    const preparar = async () => (modoAdministrado(env) ? (await panelDelEntorno(env)).obtenerPanel() : undefined);
    return conCabecerasWeb(await respuestaSeccionesV3(peticion, env.REGISTRO_SOCIOS, preparar, !modoAdministrado(env)));
  }
  if (url.pathname === RUTA_SECCIONES) {
    return conCabecerasWeb(await respuestaDeSecciones(peticion, lector));
  }
  const cierre = await comprobarSeccionWeb(url.pathname, peticion.signal, lector);
  if (cierre) {
    return conCabecerasWeb(cierre);
  }
  const archivo = await env.ASSETS.fetch(peticion);
  if (esDireccionInexistente(peticion, url.pathname, archivo)) {
    return respuestaNoExiste(peticion, env.ASSETS);
  }
  const respuesta = conCabecerasWeb(archivo, url.pathname);
  if (respuesta.ok && url.pathname === '/inicio.html') {
    respuesta.headers.set('x-faro-portal', 'publico');
  }
  if (respuesta.ok && archivoDelPaquetePublicado(url.pathname)) {
    respuesta.headers.set('cache-control', CACHE_DEL_PAQUETE);
  }
  const tipo = tipoPropioDe(url.pathname);
  if (respuesta.ok && tipo) {
    respuesta.headers.set('content-type', tipo);
  }
  return respuesta;
}

/** Las variables de texto del entorno (configuración y secretos), sin los enlaces de Cloudflare como ASSETS. */
function variablesDeTexto(env: Entorno): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).flatMap(([nombre, valor]) => (typeof valor === 'string' ? [[nombre, valor]] : [])),
  );
}

/** Un valor inválido también reserva rutas: fallará configurando, sin caer a archivos estáticos. */
function modoAdministrado(env: Entorno): boolean {
  return env.FARO_ADMINISTRACION !== undefined && env.FARO_ADMINISTRACION !== 'no';
}
function panelDelEntorno(env: Entorno): Promise<AdministracionCloudflare> {
  const variables = variablesDeTexto(env);
  if (
    panelActivo &&
    panelActivo.registro === env.REGISTRO_SOCIOS &&
    mismasVariables(panelActivo.variables, variables)
  ) {
    return panelActivo.montaje;
  }
  const montaje = prepararAdministracionCloudflare(
    variables,
    env.REGISTRO_SOCIOS,
    enlaceCorreoDelEntorno(env.AVISOS_CORREO),
  );
  const candidato = { variables, registro: env.REGISTRO_SOCIOS, montaje };
  panelActivo = candidato;
  void montaje.catch(() => {
    if (panelActivo === candidato) {
      panelActivo = null;
    }
  });
  return montaje;
}
/**
 * Deja en el registro de Cloudflare por qué la administración no ha podido atender una petición (su montaje o su
 * autoridad durable han fallado), como respuestaNoConfigurado: la persona solo recibe el 503.
 */
function registrarAdministracionNoDisponible(error: unknown): void {
  registrarErrorOperativo('montaje-conectividad', error);
}
async function responderPanel(peticion: Request, env: Entorno): Promise<Response> {
  if (!modoAdministrado(env)) {
    return new Response(null, { status: ESTADO_HTTP.noEncontrado, headers: { 'cache-control': 'no-store' } });
  }
  try {
    const montaje = await panelDelEntorno(env);
    return await (await montaje.obtenerPanel()).responder(peticion);
  } catch (error) {
    registrarAdministracionNoDisponible(error);
    return problemaNoConfigurado(peticion);
  }
}
async function responderWebPanel(peticion: Request, env: Entorno): Promise<Response> {
  if (!modoAdministrado(env)) {
    return new Response(null, { status: ESTADO_HTTP.noEncontrado, headers: { 'cache-control': 'no-store' } });
  }
  try {
    const montaje = await panelDelEntorno(env);
    return await montaje.responderRecurso(peticion, (_ruta, recurso) => env.ASSETS.fetch(recurso));
  } catch (error) {
    registrarAdministracionNoDisponible(error);
    return new Response(null, { status: ESTADO_HTTP.noDisponible, headers: { 'cache-control': 'no-store' } });
  }
}
async function responderNamespaceAdministrativo(peticion: Request, env: Entorno, url: URL): Promise<Response> {
  if (url.pathname.startsWith('/administracion/api/')) {
    return conCabecerasDeLaApi(await responderPanel(peticion, env));
  }
  const respuesta = await responderWebPanel(peticion, env);
  respuesta.headers.set('strict-transport-security', VALOR_HSTS);
  return respuesta;
}
/** Lo que las llamadas de máquina del mantenimiento necesitan saber de este entorno. */
function mantenimientoDelEntorno(env: Entorno) {
  return {
    administrado: modoAdministrado(env),
    variables: variablesDeTexto(env),
    metadatosVersion: env.CF_VERSION_METADATA,
    obtenerPanel: async () => (await panelDelEntorno(env)).obtenerPanel(),
    registrarNoDisponible: registrarAdministracionNoDisponible,
  };
}
async function catalogoAdministrado(peticion: Request, env: Entorno): Promise<Response> {
  try {
    const montaje = await panelDelEntorno(env);
    return await (await montaje.obtenerPanel()).catalogo(peticion);
  } catch (error) {
    registrarAdministracionNoDisponible(error);
    return new Response(peticion.method === 'HEAD' ? null : JSON.stringify({ error: 'no_disponible' }), {
      status: ESTADO_HTTP.noDisponible,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }
}

/**
 * La API exige firma y, cuando corresponde a la declaración de pruebas, el cerrojo de Access.
 */
interface LoExigido {
  cerrojo: Cerrojo | null;
}

/** Firma y Access protegen el acceso a los datos. */
function loExigido(variables: Record<string, string>): LoExigido {
  if (!variables.FARO_SECRETO_FIRMA) {
    throw new Error('Falta el secreto FARO_SECRETO_FIRMA: configúralo con `wrangler secret put`');
  }
  return { cerrojo: cerrojoDelEntorno(variables) };
}

/**
 * Las opciones de la API que salen de las variables (plataforma/configuracion.ts), dichas en el registro con el modo de
 * la web. La oferta del informe procede de la configuración del despliegue.
 */
function opcionesDichasEnElRegistro(variables: Record<string, string>): OpcionesDelEntorno {
  const opciones = opcionesDelEntorno(variables);
  console.log(`Oferta del informe: ${descripcionDeLaOferta(opciones.oferta)}`);
  console.log(`Camino a mano: ${descripcionDelCaminoAMano(opciones.caminoAMano)}`);
  if (opciones.agentes.mcp) {
    console.log(`MCP: respuestas ${opciones.agentes.clavesFirmaMcp ? 'firmadas' : 'sin firmar'}`);
  }
  return opciones;
}

/** La API con las variables del entorno, en el orden del servidor local. */
async function crearApiDelEntorno(env: Entorno, originales: Record<string, string>, raiz: URL): Promise<ApiDelEntorno> {
  prepararBuscadorDeLaApi();
  const { cerrojo } = loExigido(originales);
  const variables = variablesDelServicio(originales);
  const { seguridad, ...delEntorno } = opcionesDichasEnElRegistro(variables);
  const limitadores = crearLimitadores();
  const responder = await crearApi({
    ...delEntorno,
    datos,
    motorDeCursos: crearPuertaDeCursosCloudflare(env.CURSOS),
    datosGlobales: await cargarDatosGlobales((peticion) => env.ASSETS.fetch(peticion), raiz),
    origenesPermitidos: listaDeComas(variables.FARO_ORIGENES),
    politicaReferencias: 'ampliada',
    seguridad: {
      ...seguridad,
      limitadores,
      // Aquí sí: Cloudflare pone cf-connecting-ip y sustituye la que envíe el cliente.
      ipDeCloudflare: true,
    },
  });
  return { responder, cerrojo };
}

/** Montaje del panel cuando se habilita, con su autoridad durable y sus datos. */
async function crearApiAdministrada(
  env: Entorno,
  originales: Record<string, string>,
  raiz: URL,
): Promise<ApiDelEntorno> {
  prepararBuscadorDeLaApi();
  const { cerrojo } = loExigido(originales);
  const montaje = await panelDelEntorno(env);
  const variables = variablesDelServicio(originales);
  const { seguridad, ...delEntorno } = opcionesDichasEnElRegistro(variables);
  const limitadores = crearLimitadores();
  const responder = await crearApi({
    ...delEntorno,
    agentes: { ...delEntorno.agentes, socios: montaje.socios },
    administracion: {
      leerControles: async (senal) => (await montaje.obtenerPanel()).leerControles(senal),
      registrarAcceso: async (uso) => (await montaje.obtenerPanel()).registrarAcceso(uso),
      socios: montaje.socios,
    },
    datos,
    motorDeCursos: crearPuertaDeCursosCloudflare(env.CURSOS),
    datosGlobales: await cargarDatosGlobales((peticion) => env.ASSETS.fetch(peticion), raiz),
    politicaReferencias: 'ampliada',
    origenesPermitidos: listaDeComas(variables.FARO_ORIGENES),
    seguridad: {
      ...seguridad,
      ipDeCloudflare: true,
      limitadores,
    },
  });
  return { responder, cerrojo };
}

/**
 * Respuesta cuando la API no se ha podido crear: el motivo va al registro de Cloudflare, nunca a la persona. Lleva las
 * cabeceras de toda respuesta de la API; sin la API no se conocen los orígenes de la lista, así que a ninguno se le
 * deja leerla desde otro sitio.
 */
function respuestaNoConfigurado(peticion: Request, error: unknown): Response {
  registrarErrorOperativo('montaje-conectividad', error);
  return problemaNoConfigurado(peticion);
}

/** El 503 de la API sin configurar, sin registrar nada: quien lo usa ya ha dejado el motivo en el registro. */
function problemaNoConfigurado(peticion: Request): Response {
  const detalle = 'La API de Faro no está disponible en este servidor.';
  return respuestaConProblema(
    peticion,
    [],
    respuestaDeProblema(problema(ESTADO_HTTP.noDisponible, 'no_configurado', detalle)),
  );
}

/**
 * Respuesta a una petición sin un JWT válido de Access cuando la API solo puede atender detrás de Access. Deja una
 * línea en el registro con el identificador técnico de Cloudflare: no copia ruta, consulta, cuerpo ni JWT.
 */
function respuestaSinAcceso(peticion: Request): Response {
  const rastro = peticion.headers.get('cf-ray');
  console.warn(JSON.stringify({ suceso: 'acceso denegado', ...(rastro ? { peticion: rastro } : {}) }));
  const sinAcceso = problema(
    ESTADO_HTTP.prohibido,
    'acceso',
    'Esta API solo atiende a quien entra por el acceso protegido.',
  );
  return respuestaConProblema(peticion, [], respuestaDeProblema(sinAcceso));
}

/**
 * La envoltura final de toda salida de la API, también de las que no llegan a ella (503 sin configurar, 403 de
 * Access): HSTS, como la web; una CSP que no deja hacer nada a un JSON que se abra en el navegador, y que el navegador
 * no adivine otro tipo de contenido. Solo en el Worker: en local, por http, el navegador ignoraría HSTS.
 */
function conCabecerasDeLaApi(respuesta: Response): Response {
  respuesta.headers.set('strict-transport-security', VALOR_HSTS);
  respuesta.headers.set('content-security-policy', POLITICA_DE_LA_API);
  respuesta.headers.set('x-content-type-options', 'nosniff');
  return respuesta;
}

/** Si la instancia activa sale del mismo entorno, con sus enlaces compartidos; no se registra ni persiste. */
function mismaInstancia(instancia: InstanciaApi | null, variables: Record<string, string>, env: Entorno): boolean {
  return (
    instancia !== null &&
    instancia.assets === env.ASSETS &&
    instancia.registroSocios === env.REGISTRO_SOCIOS &&
    instancia.cursos === env.CURSOS &&
    mismasVariables(instancia.variables, variables)
  );
}

/** Un candidato fallido no sustituye la instancia activa. El cambio solo vive en la memoria de este Worker. */
function apiDelEntorno(env: Entorno, raiz: URL): Promise<ApiDelEntorno> {
  // La caché compara las variables tal como llegan, sin resolverlas: servir datos nunca exige resolver un secreto.
  const variables = variablesDeTexto(env);
  if (mismaInstancia(apiActiva, variables, env) && apiActiva) {
    return apiActiva.api;
  }
  if (mismaInstancia(apiEnCreacion, variables, env) && apiEnCreacion) {
    return apiEnCreacion.api;
  }
  const candidata: InstanciaApi = {
    assets: env.ASSETS,
    variables,
    registroSocios: env.REGISTRO_SOCIOS,
    cursos: env.CURSOS,
    api: modoAdministrado(env) ? crearApiAdministrada(env, variables, raiz) : crearApiDelEntorno(env, variables, raiz),
  };
  apiEnCreacion = candidata;
  candidata.api = candidata.api.then(
    (api) => {
      if (apiEnCreacion === candidata) {
        apiActiva = candidata;
        apiEnCreacion = null;
      }
      return api;
    },
    (error: unknown) => {
      if (apiEnCreacion === candidata) {
        apiEnCreacion = null;
      }
      throw error;
    },
  );
  return candidata.api;
}

/** Si la ruta es del agente A2A: su enlace JSON-RPC o su tarjeta. */
function esRutaA2a(url: URL): boolean {
  return url.pathname === RUTA_A2A || url.pathname === RUTA_TARJETA;
}

/**
 * Lo que atiende la API: /api/*; con FARO_MCP=si, el servidor MCP en /mcp, y con FARO_A2A=si, el agente A2A (/a2a y
 * su tarjeta). Apagados, son archivos de la web que no existen. Con un valor mal escrito, va a la API, que no arranca
 * y lo dice en el registro (503).
 */
function aLaApi(url: URL, env: Entorno): boolean {
  return (
    (modoAdministrado(env) && esRutaApiAdministrada(url.pathname)) ||
    url.pathname.startsWith('/api/') ||
    esDescubrimientoOAuth(url.pathname) ||
    url.pathname === RUTA_MCP ||
    esRutaA2a(url)
  );
}

/** La política confirmada del mismo montaje: ninguna avería se convierte en semillas apagadas. */
async function disponibilidadDelEntorno(env: Entorno, senal: AbortSignal): Promise<DisponibilidadConectividad> {
  if (modoAdministrado(env)) {
    return capturarControles(
      { leerControles: async (lectura) => (await (await panelDelEntorno(env)).obtenerPanel()).leerControles(lectura) },
      senal,
    );
  }
  try {
    // Este lector rechaza semillas ON sin administración y toda configuración inválida.
    opcionesDelEntorno(variablesDelServicio(variablesDeTexto(env)));
    return 'apagado-sin-administracion';
  } catch (error) {
    registrarErrorOperativo('montaje-conectividad', error);
    return null;
  }
}
async function responderDescripcion(peticion: Request, env: Entorno): Promise<Response> {
  const controles = await disponibilidadDelEntorno(env, peticion.signal);
  return respuestaDeDescripcion(
    peticion,
    controles,
    (ruta, signal) => env.ASSETS.fetch(new Request(new URL(ruta, peticion.url), { method: 'GET', signal })),
    {
      diagnosticar: (error) => registrarErrorOperativo('descripcion-conectividad', error),
      plazoMs: plazoDelEntorno(variablesDeTexto(env)),
    },
  );
}

/** Lo que responde la API o, si no ha podido crearse (503) o Access no deja pasar (403), lo que la sustituye. */
async function responderLaApi(peticion: Request, env: Entorno, url: URL): Promise<Response> {
  let api: ApiDelEntorno;
  try {
    if (url.pathname === RUTA_ESTADO_CONECTIVIDAD) {
      return responderEstadoConectividad([], peticion, await disponibilidadDelEntorno(env, peticion.signal));
    }
    if (!modoAdministrado(env)) {
      const disponibilidad = await disponibilidadDelEntorno(env, peticion.signal);
      const denegacion = problemaDeControles(disponibilidad, url.pathname);
      if (denegacion) {
        return respuestaConProblema(peticion, [], denegacion);
      }
    }
    api = await apiDelEntorno(env, new URL('/', url));
  } catch (error) {
    if (url.pathname === RUTA_ESTADO_CONECTIVIDAD) {
      return respuestaConProblema(peticion, [], respuestaDeError(error));
    }
    return respuestaNoConfigurado(peticion, error);
  }
  if (api.cerrojo && !(await api.cerrojo(peticion))) {
    return respuestaSinAcceso(peticion);
  }
  return api.responder(peticion);
}

/** Atiende una petición del Worker con las cabeceras de seguridad de cada ruta. */
async function responderPeticion(peticion: Request, env: Entorno, segundo?: EnSegundoPlano): Promise<Response> {
  const url = new URL(peticion.url);
  if (esRutaMantenimiento(url.pathname)) {
    return conCabecerasDeLaApi(await responderMantenimiento(peticion, mantenimientoDelEntorno(env), url, segundo));
  }
  const canonica = respuestaDeRutaCanonica(url);
  if (canonica) {
    return conCabecerasWeb(canonica);
  }
  if (esRutaAdministrativa(url.pathname)) {
    return responderNamespaceAdministrativo(peticion, env, url);
  }
  if (url.pathname === '/') {
    return conCabecerasWeb(Response.redirect(new URL(PORTADA, url), ESTADO_HTTP.encontradoEnOtraDireccion));
  }
  // security.txt (RFC 9116) con el contacto, la política y la caducidad que fija la entidad (seguridad-txt.ts).
  if (url.pathname === RUTA_SECURITY_TXT) {
    return conCabecerasWeb(respuestaDeSecurityTxt(datosDeSeguridad(variablesDeTexto(env)), url.origin));
  }
  // El catálogo de las API (RFC 9727) y el punto de avisos no dependen de la API: responden aunque no arranque.
  if (url.pathname === RUTA_CATALOGO_DE_APIS) {
    if (modoAdministrado(env)) {
      return conCabecerasWeb(await catalogoAdministrado(peticion, env));
    }
    return conCabecerasWeb(respuestaDelCatalogo(peticion.method, url.origin));
  }
  if (url.pathname === RUTA_DE_AVISOS) {
    return conCabecerasDeLaApi(await recibirAvisos(peticion));
  }
  if (esDescripcionDeConectividad(url.pathname)) {
    return conCabecerasWeb(await responderDescripcion(peticion, env), url.pathname);
  }
  if (!aLaApi(url, env)) {
    return recursoPublico(env, peticion, url);
  }
  const respuesta = await responderLaApi(peticion, env, url);
  // La tarjeta del agente y su enlace se publican para otros agentes: con las cabeceras de seguridad de la web.
  if (esRutaA2a(url)) {
    return conCabecerasWeb(respuesta);
  }
  return conCabecerasDeLaApi(respuesta);
}

/**
 * El Worker: www.<dominio> redirige a <dominio>, la portada a inicio.html,
 * /.well-known/security.txt, a quién avisar de un fallo de seguridad, /.well-known/api-catalog, las API que ofrece,
 * /avisos-del-navegador recibe los avisos técnicos del navegador, /api/* (y /mcp y A2A, si están encendidos) va a la
 * API y el resto son archivos estáticos. Las redirecciones, los archivos, el catálogo y las respuestas de A2A llevan
 * las cabeceras de seguridad de la web; la API y el punto de avisos, las de la API.
 */
export default {
  /** Entrada exclusiva del runtime; no existe ruta HTTP ni sesión humana equivalente. */
  async scheduled(evento: EventoProgramadoWorker, env: Entorno): Promise<void> {
    await atenderEventoProgramado(evento, variablesDeTexto(env), {
      obtenerPanel: async () => (await panelDelEntorno(env)).obtenerPanel(),
      prepararAviso: async () => {
        const montaje = await panelDelEntorno(env);
        await montaje.obtenerPanel();
        return montaje.avisarVigilante;
      },
    });
  },
  /** El contexto mantiene vivo, tras responder, el aviso de un inicio rechazado (`waitUntil`). */
  async fetch(peticion: Request, env: Entorno, contexto?: { waitUntil: EnSegundoPlano }): Promise<Response> {
    const sinPortal = respuestaSinPortalEn(new URL(peticion.url), peticion.method);
    const segundo = contexto && ((tarea: Promise<unknown>) => contexto.waitUntil(tarea));
    return sinPortal ? conCabecerasWeb(sinPortal) : responderPeticion(peticion, env, segundo);
  },
};
