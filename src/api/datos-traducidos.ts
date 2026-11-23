// Las traducciones de Faro que acompañan a los datos oficiales en las respuestas de la API. Un dato
// oficial no cambia de significado con el idioma: sigue en su campo, en castellano, que es su idioma. Con
// `idioma: 'ca'` lleva al lado su traducción de Faro, hecha con IA, en un campo con el sufijo `_ca` (`titulo_ca`,
// `corto_ca`…), o null si todavía no la tiene: entonces se muestra el castellano, marcado como tal. El de un grupo
// ISCO-08 no es una traducción: es su nombre oficial de la CIUO-2008 (ca), del Idescat. En castellano, estas
// proyecciones dejan los campos `_ca` en null; las rutas conservan la ficha original sin añadirlos.

import type { Candidata } from '../../motores/ocupaciones/src/index.ts';
import { IDIOMA_POR_DEFECTO, type Idioma } from '../comun/idioma.ts';
import {
  type CampoDeTarea,
  type DatoEnIdioma,
  textoDeTareaEn,
  tituloEscoEn,
  tituloIscoEn,
} from '../dominio/datos-en-idioma.ts';
import type { OcupacionDelGrupo } from '../dominio/grupos.ts';
import type { Datos } from '../dominio/tipos-paquete.ts';
import type { FichaGrupo, FichaOcupacion, TareaFicha } from './fichas.ts';

/** Lo que cada traducción añade al lado de su dato: el texto en catalán, o null si aún no lo tiene. */
type Traduccion = string | null;

/** Una ocupación ESCO con su título traducido al lado. */
export type OcupacionTraducida<Ocupacion> = Ocupacion & { titulo_ca: Traduccion };

/** Una tarea oficial de una ficha con su título corto y su texto traducidos al lado. */
type TareaTraducida = TareaFicha & { corto_ca: Traduccion; texto_ca: Traduccion };

/** La ficha de un grupo con las traducciones de su título, sus tareas y sus ocupaciones ESCO. */
export type FichaGrupoTraducida = Omit<FichaGrupo, 'tareas' | 'ocupaciones'> & {
  titulo_ca: Traduccion;
  tareas: TareaTraducida[];
  ocupaciones: OcupacionTraducida<OcupacionDelGrupo>[];
};

/** La ficha de una ocupación ESCO con las traducciones de su título, el de su grupo y sus tareas. */
export type FichaOcupacionTraducida = Omit<FichaOcupacion, 'tareas'> & {
  titulo_ca: Traduccion;
  tituloIsco_ca: Traduccion;
  tareas: TareaTraducida[];
};

/** Una candidata del buscador con su título y el de su grupo traducidos al lado. */
export type CandidataTraducida<Ocupacion> = Ocupacion & { titulo_ca: Traduccion; tituloIsco_ca: Traduccion };

/** La traducción de Faro de un dato, o null si no la hay (o si se pide el castellano, el idioma de los datos). */
function traduccion(dato: DatoEnIdioma | null, idioma: Idioma): Traduccion {
  return idioma !== IDIOMA_POR_DEFECTO && dato?.idioma === idioma ? dato.texto : null;
}

/** El título de una ocupación ESCO traducido por Faro, o null. */
function tituloEscoTraducido(datos: Datos, esco: string, idioma: Idioma): Traduccion {
  return traduccion(tituloEscoEn(datos, esco, idioma), idioma);
}

/** El título corto o el texto de una tarea oficial traducido por Faro, o null. */
function textoDeTareaTraducido(datos: Datos, id: string, campo: CampoDeTarea, idioma: Idioma): Traduccion {
  return traduccion(textoDeTareaEn(datos, id, campo, idioma), idioma);
}

/** Una tarea oficial de una ficha, con su título corto y su texto traducidos. */
function tareaTraducida(datos: Datos, tarea: TareaFicha, idioma: Idioma): TareaTraducida {
  return {
    ...tarea,
    corto_ca: textoDeTareaTraducido(datos, tarea.id, 'corto', idioma),
    texto_ca: textoDeTareaTraducido(datos, tarea.id, 'texto', idioma),
  };
}

/**
 * El nombre catalán oficial de un grupo ISCO-08 (CIUO-2008 (ca), del Idescat), o null.
 *
 * @param datos - El paquete de datos.
 * @param codigo - El código del grupo ISCO-08.
 * @param idioma - El idioma pedido.
 * @returns El nombre traducido, o null si no hay traducción.
 */
export function tituloIscoTraducido(datos: Datos, codigo: string, idioma: Idioma): Traduccion {
  return traduccion(tituloIscoEn(datos, codigo, idioma), idioma);
}

/**
 * Una ocupación ESCO de un grupo, con su título traducido.
 *
 * @param datos - El paquete de datos.
 * @param ocupacion - La ocupación ESCO del grupo.
 * @param idioma - El idioma pedido.
 * @returns La ocupación con su título traducido.
 */
export function ocupacionTraducida<Ocupacion extends OcupacionDelGrupo>(
  datos: Datos,
  ocupacion: Ocupacion,
  idioma: Idioma,
): OcupacionTraducida<Ocupacion> {
  return { ...ocupacion, titulo_ca: tituloEscoTraducido(datos, ocupacion.esco, idioma) };
}

/**
 * La ficha de un grupo con las traducciones de su título, sus tareas y sus ocupaciones ESCO.
 *
 * @param datos - El paquete de datos.
 * @param ficha - La ficha del grupo, en el idioma de los datos.
 * @param idioma - El idioma pedido.
 * @returns La ficha con sus traducciones.
 */
export function fichaGrupoTraducida(datos: Datos, ficha: FichaGrupo, idioma: Idioma): FichaGrupoTraducida {
  return {
    ...ficha,
    titulo_ca: tituloIscoTraducido(datos, ficha.isco08, idioma),
    tareas: ficha.tareas.map((tarea) => tareaTraducida(datos, tarea, idioma)),
    ocupaciones: ficha.ocupaciones.map((ocupacion) => ocupacionTraducida(datos, ocupacion, idioma)),
  };
}

/**
 * La ficha de una ocupación ESCO con las traducciones de su título, el de su grupo y sus tareas.
 *
 * @param datos - El paquete de datos.
 * @param ficha - La ficha de la ocupación ESCO.
 * @param idioma - El idioma pedido.
 * @returns La ficha con sus traducciones.
 */
export function fichaOcupacionTraducida(datos: Datos, ficha: FichaOcupacion, idioma: Idioma): FichaOcupacionTraducida {
  return {
    ...ficha,
    titulo_ca: tituloEscoTraducido(datos, ficha.esco, idioma),
    tituloIsco_ca: tituloIscoTraducido(datos, ficha.isco08, idioma),
    tareas: ficha.tareas.map((tarea) => tareaTraducida(datos, tarea, idioma)),
  };
}

/**
 * Una candidata del buscador por palabras, con su título y el de su grupo traducidos.
 *
 * @param datos - El paquete de datos.
 * @param candidata - La candidata del buscador.
 * @param idioma - El idioma pedido.
 * @returns La candidata con sus traducciones.
 */
export function candidataTraducida<Ocupacion extends Candidata>(
  datos: Datos,
  candidata: Ocupacion,
  idioma: Idioma,
): CandidataTraducida<Ocupacion> {
  return {
    ...candidata,
    titulo_ca: tituloEscoTraducido(datos, candidata.esco, idioma),
    tituloIsco_ca: tituloIscoTraducido(datos, candidata.isco08, idioma),
  };
}
