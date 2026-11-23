// GET /api/grupos?padre=… y GET /api/grupos/:isco: la jerarquía oficial ISCO-08 y la ficha de un grupo de 4 cifras,
// para explorar y confirmar la ocupación con sus datos oficiales. En el Worker cuentan en el límite de lecturas por
// red, como las demás consultas (exigirLecturaDeLaRed, api/contexto-api.ts).
// Con `?idioma=ca`, cada título y cada tarea llevan al lado su traducción de Faro (`titulo_ca`…).

import { ESTADO_HTTP } from '../../comun/estados-http.ts';
import { IDIOMA_POR_DEFECTO, type Idioma } from '../../comun/idioma.ts';
import { esGrupoValido, hijosParaExplorar, tituloIsco } from '../../dominio/grupos.ts';
import type { Datos } from '../../dominio/tipos-paquete.ts';
import { type ContextoApi, responder, responderUnProblema } from '../contexto-api.ts';
import { fichaGrupoTraducida, tituloIscoTraducido } from '../datos-traducidos.ts';
import { fichaGrupo } from '../fichas.ts';
import { idiomaDeLaConsulta, problema, SolicitudInvalida } from '../http.ts';

/** El padre admite de 0 a 3 cifras: vacío para los grandes grupos; con 4 ya es un grupo completo, sin hijos. */
const PADRE = /^\d{0,3}$/;
/** El 404 de un código que no es un grupo de la CIUO-08, igual para la lista y para la ficha. */
const GRUPO_DESCONOCIDO = problema(
  ESTADO_HTTP.noEncontrado,
  'grupo_desconocido',
  'No hay ningún grupo de la CIUO-08 con ese código.',
  {
    error: 'grupo desconocido',
  },
);

/** Un grupo con su código y su título y, en otro idioma, su traducción de Faro al lado. */
function grupoConTitulo<Grupo extends { isco08: string }>(datos: Datos, grupo: Grupo, idioma: Idioma) {
  if (idioma === IDIOMA_POR_DEFECTO) {
    return grupo;
  }
  return { ...grupo, titulo_ca: tituloIscoTraducido(datos, grupo.isco08, idioma) };
}

/**
 * GET /api/grupos?padre=…: los hijos del código en la jerarquía oficial, en orden alfabético, con su título y
 * cuántas ocupaciones ESCO caen dentro de cada uno. Sin `padre`, los 10 grandes grupos. Un hijo que solo repite su
 * nombre un nivel más abajo llega ya con el código de ese nivel (hijosParaExplorar), que también empieza por
 * `padre`.
 *
 * @param contexto - El contexto de la API.
 * @param peticion - La petición.
 * @param url - La dirección de la consulta.
 * @returns Los hijos del grupo con su título y su número de ocupaciones.
 * @throws {Error} SolicitudInvalida si `padre` no tiene de 0 a 3 cifras o el idioma no existe.
 */
export async function hijos(contexto: ContextoApi, peticion: Request, url: URL): Promise<Response> {
  const { datos } = contexto;
  const padre = url.searchParams.get('padre') ?? '';
  if (!PADRE.test(padre)) {
    throw new SolicitudInvalida('el grupo padre tiene de 0 a 3 cifras');
  }
  const idioma = idiomaDeLaConsulta(url);
  const encontrados = hijosParaExplorar(datos, padre);
  if (!encontrados) {
    return responderUnProblema(contexto, peticion, GRUPO_DESCONOCIDO);
  }
  const delPadre = padre ? grupoConTitulo(datos, { isco08: padre, titulo: tituloIsco(datos, padre) }, idioma) : null;
  const hijosDelPadre = encontrados.map((hijo) => grupoConTitulo(datos, hijo, idioma));
  return responder(contexto, peticion, ESTADO_HTTP.correcto, { padre: delPadre, hijos: hijosDelPadre });
}

/**
 * GET /api/grupos/:isco: la ficha de un grupo de 4 cifras (título, tareas oficiales con su texto en castellano y su
 * nota, ocupaciones ESCO y marcas con la política con que estima la API), o 404 si no existe.
 *
 * @param contexto - El contexto de la API.
 * @param peticion - La petición.
 * @param url - La dirección de la consulta.
 * @param parametros - Los segmentos de la ruta: el código ISCO-08 del grupo.
 * @returns La ficha del grupo, o un 404 si no existe.
 */
export async function grupo(contexto: ContextoApi, peticion: Request, url: URL, [isco]: string[]): Promise<Response> {
  const codigo = isco ?? '';
  const idioma = idiomaDeLaConsulta(url);
  if (!esGrupoValido(contexto.datos, codigo)) {
    return responderUnProblema(contexto, peticion, GRUPO_DESCONOCIDO);
  }
  const ficha = fichaGrupo(contexto.datos, codigo, contexto.politica);
  const enIdioma = idioma === IDIOMA_POR_DEFECTO ? ficha : fichaGrupoTraducida(contexto.datos, ficha, idioma);
  return responder(contexto, peticion, ESTADO_HTTP.correcto, enIdioma);
}
