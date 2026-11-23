// GET /api/ocupaciones?q=… y GET /api/ocupaciones/:esco. Sin IA; en el Worker cuentan en el límite de lecturas por red
// (exigirLecturaDeLaRed, api/contexto-api.ts). La ficha admite `?idioma=ca`: sus títulos y tareas
// llevan al lado su traducción de Faro.

import { buscarOcupaciones, type Candidata } from '../../../motores/ocupaciones/src/index.ts';
import { ESTADO_HTTP } from '../../comun/estados-http.ts';
import { IDIOMA_POR_DEFECTO } from '../../comun/idioma.ts';
import type { Datos } from '../../dominio/tipos-paquete.ts';
import { MAX_BUSQUEDA, MAX_RELATO } from '../../seguridad/limites.ts';
import { textoParaBuscar } from '../../seguridad/texto-para-buscar.ts';
import { type ContextoApi, responder, responderUnProblema } from '../contexto-api.ts';
import { fichaOcupacionTraducida } from '../datos-traducidos.ts';
import { conTareasTipicas, fichaOcupacion } from '../fichas.ts';
import { idiomaDeLaConsulta, problema, SolicitudInvalida } from '../http.ts';

/**
 * Coincidencias que se devuelven como mucho con `todas=1`. Cubre la búsqueda más amplia medida («técnico», 480): así
 * la web puede ofrecer todas las ocupaciones que coinciden, agrupadas por la clasificación oficial, sin elegir por
 * nadie.
 */
const MAX_COINCIDENCIAS = 600;

/** Título oficial de cada grupo ISCO-08 (de 1 a 4 cifras) al que pertenece alguna de las candidatas. */
function gruposDe(datos: Datos, candidatas: readonly Candidata[]): Record<string, string> {
  const grupos: Record<string, string> = {};
  for (const { isco08 } of candidatas) {
    for (let cifras = 1; cifras <= isco08.length; cifras += 1) {
      const codigo = isco08.slice(0, cifras);
      const titulo = datos.clasificaciones.isco08_es[codigo];
      if (titulo) {
        grupos[codigo] = titulo;
      }
    }
  }
  return grupos;
}

/**
 * GET /api/ocupaciones?q=…: ocupaciones candidatas para lo que escribe la persona, las más parecidas primero. Con
 * `todas=1` devuelve hasta MAX_COINCIDENCIAS candidatas, el tamaño de ese lote y sus grupos ISCO-08, para que la
 * persona afine por área. No devuelve el total anterior al recorte. El orden depende del parecido con lo escrito.
 * Minimiza la consulta antes de buscar y aplica MAX_BUSQUEDA al texto limpio. Rechaza consultas mayores que
 * MAX_RELATO antes de filtrarlas para acotar el trabajo. La URL original ya ha llegado al servidor y su infraestructura.
 * Otro valor de `todas` es una petición mal hecha (400), como un idioma que Faro no tiene: no una búsqueda normal en
 * silencio.
 *
 * @param contexto - El contexto de la API.
 * @param peticion - La petición.
 * @param url - La dirección de la consulta.
 * @returns Las candidatas, sus tareas típicas y sus grupos.
 * @throws {Error} SolicitudInvalida si la consulta excede MAX_RELATO, `todas` no es 1 o el idioma no existe.
 */
export async function buscar(contexto: ContextoApi, peticion: Request, url: URL): Promise<Response> {
  const texto = url.searchParams.get('q') ?? '';
  if (texto.length > MAX_RELATO) {
    throw new SolicitudInvalida('la consulta es demasiado larga');
  }
  const consulta = textoParaBuscar(texto).slice(0, MAX_BUSQUEDA);
  const todas = url.searchParams.get('todas');
  if (todas !== null && todas !== '1') {
    throw new SolicitudInvalida('todas solo admite el valor 1');
  }
  if (todas === null) {
    return responder(contexto, peticion, ESTADO_HTTP.correcto, {
      candidatas: conTareasTipicas(contexto.datos, buscarOcupaciones(contexto.datos, consulta)),
    });
  }
  const candidatas = buscarOcupaciones(contexto.datos, consulta, MAX_COINCIDENCIAS);
  return responder(contexto, peticion, ESTADO_HTTP.correcto, {
    total: candidatas.length,
    candidatas: conTareasTipicas(contexto.datos, candidatas),
    grupos: gruposDe(contexto.datos, candidatas),
  });
}

/**
 * GET /api/ocupaciones/:esco: la ficha de una ocupación, o 404 si no existe.
 *
 * @param contexto - El contexto de la API.
 * @param peticion - La petición.
 * @param url - La dirección de la consulta.
 * @param parametros - Los segmentos de la ruta: el código ESCO de la ocupación.
 * @returns La ficha de la ocupación, o un 404 si no existe.
 */
export async function ficha(contexto: ContextoApi, peticion: Request, url: URL, [esco]: string[]): Promise<Response> {
  const idioma = idiomaDeLaConsulta(url);
  const encontrada = fichaOcupacion(contexto.datos, esco ?? '');
  if (!encontrada) {
    const detalle = 'No hay ninguna ocupación de ESCO con ese código.';
    const desconocida = problema(ESTADO_HTTP.noEncontrado, 'ocupacion_desconocida', detalle, {
      error: 'ocupación desconocida',
    });
    return responderUnProblema(contexto, peticion, desconocida);
  }
  const enIdioma =
    idioma === IDIOMA_POR_DEFECTO ? encontrada : fichaOcupacionTraducida(contexto.datos, encontrada, idioma);
  return responder(contexto, peticion, ESTADO_HTTP.correcto, enIdioma);
}
