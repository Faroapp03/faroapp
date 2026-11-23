// Arranque local de la API y los recursos web: escucha solo en 127.0.0.1.
// Carga el paquete oficial desde datos/ y valida la configuración de servicio y seguridad.
// El recorrido utiliza los motores locales del dispositivo.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { descripcionDeLaOferta } from '../../compartido/contratos/oferta-de-formacion.ts';
import { configuracionAdministrativaDelEntorno } from '../../src/administracion/configuracion.ts';
import { crearApi } from '../../src/api/api.ts';
import { PlazoInvalido } from '../../src/api/plazo.ts';
import { descripcionDelCaminoAMano } from '../../src/dominio/camino-a-mano.ts';
import type { Datos } from '../../src/dominio/tipos-paquete.ts';
import type { AdministracionMontada } from '../../src/plataforma/administracion.ts';
import { ErrorDeConfiguracion, opcionesDelEntorno } from '../../src/plataforma/configuracion.ts';
import { montarAdministracionNode, type PerfilAdministradoNode } from '../../src/plataforma/node/administracion.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import { cargarDatosGlobalesDeLaWeb } from '../../src/plataforma/node/datos-globales.ts';
import { leerEntornoDelServidor } from '../../src/plataforma/node/entorno.ts';
import { crearPuertaDeCursosNode } from '../../src/plataforma/node/puerta-de-cursos.ts';
import { RUTAS } from '../../src/plataforma/node/rutas.ts';
import { crearServidor } from '../../src/plataforma/node/servidor.ts';
import { datosDeSeguridad } from '../../src/plataforma/seguridad-txt.ts';
import { variablesDelServicio } from '../../src/plataforma/variables-del-servicio.ts';
import { ejecutar, orden } from '../comun/opciones.ts';
import type { WebLocal } from '../web/construir.ts';
import { HUELLA_MAPA } from '../web/huellas-de-los-mapas.ts';

const USO = 'node herramientas/servidor/servidor-local.ts';
/** El puerto si FARO_PUERTO no dice otro (por ejemplo, porque otro programa ya usa el 8787). */
const PUERTO_POR_DEFECTO = 8787;
const PUERTO_MAXIMO = 65_535;
const ANFITRION = '127.0.0.1';
// El módulo de entrada del motor del dispositivo dentro de web/, el que carga web/scripts/motor-local/worker.js.
const MOTOR_DEL_DISPOSITIVO = 'motor/src/plataforma/navegador/motor.js';
/** Las variables que también se pueden dar al lanzar la orden (FARO_MCP=si npm run servir); el perfil manda. */
const DEL_PROCESO = [
  'FARO_MCP',
  'FARO_A2A',
  'FARO_ADMINISTRACION',
  'FARO_ADMIN_ORIGEN',
  'FARO_ADMIN_ACCESS_EQUIPO',
  'FARO_ADMIN_ACCESS_AUD',
] as const;
/** Lo que dicen las variables de los servicios (plataforma/configuracion.ts). */
type DelEntorno = ReturnType<typeof opcionesDelEntorno>;
/** Lo que decide el arranque y comparten la API y el servidor. */
interface Arranque {
  puerto: number;
  web: string;
  /** Las huellas CSP de los mapas de la web servida: de construccion.json o, con FARO_WEB_DE_PRUEBA, de sus páginas. */
  huellaMapaModulos?: string | undefined;
  variables: Record<string, string>;
  delEntorno: DelEntorno;
}

/** Lo que impide arrancar (un perfil a medias, el puerto ocupado), en una línea y sin la pila. */
function noArranca(motivo: string): never {
  console.error(`Faro no arranca: ${motivo}`);
  process.exit(1);
}

/** El puerto de FARO_PUERTO, si es un puerto válido; sin ella, el 8787. */
function puertoDelProceso(): number {
  const pedido = process.env.FARO_PUERTO;
  if (pedido === undefined) {
    return PUERTO_POR_DEFECTO;
  }
  const puerto = Number(pedido);
  if (Number.isInteger(puerto) && puerto > 0 && puerto <= PUERTO_MAXIMO) {
    return puerto;
  }
  return noArranca(`FARO_PUERTO tiene que ser un puerto entre 1 y ${PUERTO_MAXIMO}, y es «${pedido}»`);
}

/** Configuración de servicio: perfil local y variables explícitas del proceso. */
function variablesDelPerfil(): ReturnType<typeof leerEntornoDelServidor> {
  const leido = leerEntornoDelServidor();
  const delProceso = Object.fromEntries(
    DEL_PROCESO.flatMap((nombre) => (process.env[nombre] === undefined ? [] : [[nombre, process.env[nombre]]])),
  );
  const variables = { ...delProceso, ...leido.variables };
  return { variables };
}

/** Lo que dicen las variables de los servicios, con la misma traducción y la misma regla que en el Worker. */
function configuracionDelPerfil(variables: Record<string, string>): {
  delEntorno: DelEntorno;
} {
  try {
    return { delEntorno: opcionesDelEntorno(variables) };
  } catch (error) {
    if (!(error instanceof ErrorDeConfiguracion || error instanceof PlazoInvalido)) {
      throw error;
    }
    return noArranca(`${error.message}. Revisa .dev.vars (plantilla: .dev.vars.example).`);
  }
}

/** La línea de arranque: dónde escucha Faro, su política de referencias, oferta y servicios. */
function lineaDeArranque(puerto: number, delEntorno: DelEntorno) {
  const { oferta, caminoAMano, agentes } = delEntorno;
  return (
    `Faro en http://${ANFITRION}:${puerto} · motor local · método «ampliada» · ` +
    `${descripcionDeLaOferta(oferta)} · ` +
    `${descripcionDelCaminoAMano(caminoAMano)}${agentes.mcp ? ' · MCP de solo lectura en /mcp' : ''}` +
    `${agentes.mcp && agentes.clavesFirmaMcp ? ', con las respuestas firmadas' : ''}` +
    `${agentes.a2a ? ' · agente A2A en /a2a' : ''}`
  );
}

/** La API montada como en el Worker, con el origen y los servicios locales. */
function crearApiLocal(arranque: Arranque, datos: Datos): ReturnType<typeof crearApi> {
  const { puerto, delEntorno } = arranque;
  // El motor de cursos, en su hilo (worker_threads): si una operación se queda en bucle, se termina y el recorrido
  // sigue respondiendo (plataforma/node/puerta-de-cursos.ts).
  const motorDeCursos = crearPuertaDeCursosNode();
  return crearApi({
    ...delEntorno,
    datos,
    datosGlobales: cargarDatosGlobalesDeLaWeb(arranque.web),
    motorDeCursos,
    // «localhost» es otro nombre del mismo equipo: la web funciona igual con él que con 127.0.0.1.
    origenesPermitidos: [`http://localhost:${puerto}`],
    politicaReferencias: 'ampliada',
    seguridad: delEntorno.seguridad,
  });
}

/** Sirve la web y la API en el puerto, y dice la línea de arranque cuando escucha. */
function escuchar(
  arranque: Arranque,
  api: Awaited<ReturnType<typeof crearApi>>,
  cerrar: () => void,
  administracion?: AdministracionMontada,
): void {
  const { puerto, web, variables, delEntorno, huellaMapaModulos } = arranque;
  const servidor = crearServidor({
    ...(huellaMapaModulos === undefined ? {} : { huellaMapaModulos }),
    api,
    plazoMs: delEntorno.plazoMs,
    ...(administracion ? { administracion } : {}),
    web,
    paquete: RUTAS.paquete,
    puerto,
    anfitrion: ANFITRION,
    // security.txt, como en el Worker: FARO_SEGURIDAD_* del perfil.
    seguridad: datosDeSeguridad(variables),
  });
  servidor.once('close', cerrar);
  servidor.on('error', (error: NodeJS.ErrnoException) => {
    cerrar();
    if (error.code !== 'EADDRINUSE') {
      throw error;
    }
    noArranca(
      `el puerto ${puerto} ya está en uso (¿otro Faro abierto?). Ciérralo o usa otro: FARO_PUERTO=8790 npm run servir`,
    );
  });
  servidor.listen(puerto, ANFITRION, () => console.log(lineaDeArranque(puerto, delEntorno)));
}

async function iniciarServidor(arranque: Arranque, datos: Datos): Promise<void> {
  escuchar(arranque, await crearApiLocal(arranque, datos), () => undefined);
}

function avisarMotorDelDispositivo(web: string): void {
  if (!existsSync(join(web, MOTOR_DEL_DISPOSITIVO))) {
    console.warn(
      `Aviso: falta el motor del dispositivo en ${web}, así que el recorrido no podrá responder. ` +
        'Construye la web con npm run web:preparar.',
    );
  }
}

/**
 * Lo que impide servir la web construida: las huellas de su construcción (construccion.json, las que recibe la CSP del
 * servidor) tienen que ser una lista de huellas sha256 y exactamente las de los mapas de sus páginas: con una de menos,
 * el navegador bloquearía ese mapa; con una de más, la CSP admitiría un guion que la web no lleva.
 *
 * @param deLasPaginas - Las huellas CSP de los mapas que llevan las páginas servidas.
 * @param delServidor - Las huellas que admite la CSP del servidor.
 */
export function problemaDeLaPolitica(deLasPaginas: readonly string[], delServidor: string): string | undefined {
  if (!HUELLA_MAPA.test(delServidor)) {
    return 'la huella de los mapas de .web-local/construccion.json no es una lista de huellas sha256';
  }
  const admitidas = new Set(delServidor.split(' '));
  const enLasPaginas = new Set(deLasPaginas);
  const iguales = admitidas.size === enLasPaginas.size && [...admitidas].every((huella) => enLasPaginas.has(huella));
  return iguales
    ? undefined
    : 'la política de contenidos del servidor local no admite exactamente los mapas de módulos de .web-local/';
}

/** Las huellas CSP de los mapas de módulos que llevan las páginas de una web. */
async function huellasDeLasPaginas(web: string): Promise<string[]> {
  const { huellasDeLosMapas } = await import('../web/huellas-de-los-mapas.ts');
  return huellasDeLosMapas(web);
}

/**
 * La web que se sirve: la carpeta que FARO_WEB_DE_PRUEBA indique en el entorno del proceso (no se toma del perfil), o la
 * web local construida en .web-local/, que se construye si falta o si sus fuentes han cambiado (huella de contenido).
 */
async function webQueSeSirve(): Promise<Pick<Arranque, 'web' | 'huellaMapaModulos'>> {
  const deLaPrueba = process.env.FARO_WEB_DE_PRUEBA;
  if (deLaPrueba) {
    avisarMotorDelDispositivo(deLaPrueba);
    return { web: deLaPrueba, huellaMapaModulos: (await huellasDeLasPaginas(deLaPrueba)).join(' ') };
  }
  // La construcción (esbuild y sus comprobaciones) solo se carga cuando se va a servir la web local.
  const { construirWebLocal, WEB_LOCAL, webLocalVigente } = await import('../web/construir.ts');
  // FARO_WEB_LOCAL_DE_PRUEBA (solo del entorno del proceso) cambia dónde vive la web local, para las pruebas.
  const destino = process.env.FARO_WEB_LOCAL_DE_PRUEBA || WEB_LOCAL;
  let local: WebLocal | undefined = webLocalVigente(destino);
  if (!local) {
    console.log('Construyendo la web local en .web-local/ (falta o sus fuentes han cambiado)…');
    local = await construirWebLocal(destino);
  }
  const problema = problemaDeLaPolitica(await huellasDeLasPaginas(local.web), local.huellaMapaModulos);
  return problema ? noArranca(problema) : { web: local.web, huellaMapaModulos: local.huellaMapaModulos };
}

/** La autoridad se prepara antes de abrir recursos; el cierre administrado sigue al del servidor HTTP. */
async function iniciarServidorAdministrado(perfil: PerfilAdministradoNode, puerto: number): Promise<void> {
  const variables = variablesDelServicio(perfil.variables);
  const { delEntorno } = configuracionDelPerfil(variables);
  const datos = cargarDatos(RUTAS.paquete);
  const servida = await webQueSeSirve();
  const arranque: Arranque = { puerto, ...servida, variables, delEntorno };
  const preparado = await montarAdministracionNode({
    perfil,
    datos,
    datosGlobales: cargarDatosGlobalesDeLaWeb(servida.web),
    origenesPermitidos: [`http://localhost:${puerto}`],
    permitirHttpLocal: true,
  });
  try {
    escuchar(arranque, preparado.api, preparado.cerrar, preparado.administracion);
  } catch (error) {
    preparado.cerrar();
    throw error;
  }
}

async function principal(): Promise<void> {
  orden(USO).leer({ options: {} });
  const puerto = puertoDelProceso();
  const perfil = variablesDelPerfil();
  if (configuracionAdministrativaDelEntorno(perfil.variables, { permitirHttpLocal: true })) {
    await iniciarServidorAdministrado(perfil, puerto);
    return;
  }
  const variables = variablesDelServicio(perfil.variables);
  const { delEntorno } = configuracionDelPerfil(variables);
  const datos = cargarDatos(RUTAS.paquete);
  const servida = await webQueSeSirve();
  const arranque: Arranque = { puerto, ...servida, variables, delEntorno };
  await iniciarServidor(arranque, datos);
}

if (import.meta.main) {
  await ejecutar(principal);
}
