// Las llamadas del recorrido a la API de Faro. Cada ruta tiene aquí su función, con su cuerpo, lo que devuelve y sus
// errores propios escritos al lado, y ningún otro módulo pide nada a la API: el contrato de la web con el motor se lee
// en este archivo, y los nombres de los campos, en traduccion-api.js.
//
//   informeEnHtml(entrada, idioma)  POST /api/informe?formato=breve&reloj=dispositivo  el informe breve (motor)
//   fichaDeGrupo(isco08)            GET /api/grupos/:isco            la ficha de un grupo de 4 cifras
//   gruposHijos(padre)              GET /api/grupos?padre=…          un nivel de la clasificación oficial
//
// Cómo viaja cada petición (credencial, transporte de su modo, plazo y cancelación) está en api/transporte.js; qué
// significa cada fallo, en api/errores.js. Las lecturas de la clasificación oficial (grupos) se piden una sola vez por
// página y por idioma (memoria-llamadas.js) y su respuesta pasa por traduccion-api.js. Las traducciones de Faro de los
// datos oficiales que traen se apuntan en datos-traducidos.js; `completarTraducciones` pide, en el idioma de la página,
// las lecturas de los datos que aún no la tienen.
// GET /api/salud no es una llamada del recorrido: la leen los clientes de diagnóstico y
// scripts/acceso.js (si la sesión de Cloudflare Access sigue abierta), cada uno con la petición que necesita.

import { textoDe } from '../json.js';
import { pedir } from './api/transporte.js';
import { apuntarTraducciones, origenesSinTraduccion } from './datos-traducidos.js';
import { unaVez } from './memoria-llamadas.js';
import {
  cuerpoDelInforme,
  IDIOMA_DEL_MOTOR,
  idiomaDeLasRespuestas,
  leerAvisos,
  leerFichaDeGrupo,
  leerGruposHijos,
  leerOrigen,
  rutaEnIdioma,
  traduccionesDeFicha,
  traduccionesDeHijos,
} from './traduccion-api.js';

/** @import { Idioma } from '../textos.js' */
/**
 * @import {
 *   Aviso,
 *   EntradaDelInforme,
 *   FichaDeGrupo,
 *   GrupoHijo,
 *   JsonDeLaApi,
 *   ParDeTraduccion,
 * } from './traduccion-api.js'
 */

/**
 * Las rutas de la API que pide el recorrido (de /grupos, que lleva parámetros, se encargan fichaDeGrupo y gruposHijos).
 * El informe se pide con su HTML breve de dos hojas (src/presentacion/informe-breve.ts); `reloj=dispositivo` dice que
 * su fecha es la del reloj del dispositivo, y el motor la contrasta con sus datos (api/rutas/informe.ts). Todas llevan
 * cuerpo, y cada una tiene que estar en la lista del filtro de datos personales (minimizar.js): una prueba las recorre.
 */
export const RUTAS = Object.freeze({
  informe: '/informe?formato=breve&reloj=dispositivo',
});

/**
 * Cómo se lee una ruta de /api/grupos: lo que usa el recorrido y las traducciones que trae.
 * @template Lectura
 * @typedef {Object} LecturaDeGrupos
 * @property {(datos: JsonDeLaApi) => Lectura} leer
 * @property {(datos: JsonDeLaApi, idioma: Idioma) => ParDeTraduccion[]} traducciones
 */

// ---------- Las rutas ----------
// Cada una, además de los errores comunes (api/errores.js), dice los suyos: los que mira quien la llama.

/**
 * POST /api/informe?formato=breve: el informe de lo que ha confirmado la persona, en HTML para pintarlo en la página.
 * `entrada` es { ocupacion, fecha, tareas }, con cada tarea ya como la recibe la API (paso-informe.js); el cuerpo lleva
 * además `idioma`, en el que lo escribe el motor (traduccion-api.js, cuerpoDelInforme). Las reglas del informe no
 * gastan IA; con el pase, el motor modera lo que cita de la persona, y en catalán traduce lo que la IA escribió en
 * castellano. Devuelve el HTML y los avisos de lo que se ha hecho con lo escrito (datos personales quitados, la
 * palabra de la persona que la moderación ha dejado fuera), escritos en `idioma`.
 * Errores propios: 400 con `tareasConFirmaNoValida` si alguna estimación ya no lleva una firma válida (paso-informe.js
 * las vuelve a estimar), o sin ese campo si la entrada no es válida; 422 con `avisos` y `tareasNoAdmitidas` si la
 * moderación no admite alguna tarea, que el informe no puede citar.
 * @param {EntradaDelInforme} entrada @param {Idioma} idioma
 * @returns {Promise<{ html: string, avisos: Aviso[], informe?: unknown }>}
 */
export async function informeEnHtml(entrada, idioma) {
  const datos = await pedir(RUTAS.informe, cuerpoDelInforme(entrada, { idioma }));
  // Un informe sin HTML no llega aquí: api/transporte.js (RESPUESTAS_VALIDAS) lo rechaza como respuesta no válida.
  return {
    html: textoDe(datos.html),
    avisos: leerAvisos(datos.avisos),
    ...('informe' in datos ? { informe: datos.informe } : {}),
  };
}

/**
 * Una lectura de /api/grupos en el idioma de la página, una sola vez por ruta: apunta las traducciones que trae
 * (`traducciones(datos, idioma)`) y devuelve lo que usa el recorrido (`leer(datos)`).
 * @template Lectura
 * @param {string} ruta @param {LecturaDeGrupos<Lectura>} lectura @returns {Promise<Lectura>}
 */
function leerEnIdioma(ruta, { leer, traducciones }) {
  const idioma = idiomaDeLasRespuestas();
  const enIdioma = rutaEnIdioma(ruta, idioma);
  return unaVez(enIdioma, async () => {
    const datos = await pedir(enIdioma);
    apuntarTraducciones(traducciones(datos, idioma), idioma);
    return leer(datos);
  });
}

/**
 * GET /api/grupos/:isco: la ficha del grupo, con sus tareas oficiales y sus ocupaciones ESCO, leída por
 * traduccion-api.js (leerFichaDeGrupo). Errores propios: 404 si el grupo no existe.
 * @param {string} isco08 @returns {Promise<FichaDeGrupo>}
 */
export function fichaDeGrupo(isco08) {
  return leerEnIdioma(`/grupos/${encodeURIComponent(isco08)}`, {
    leer: leerFichaDeGrupo,
    traducciones: traduccionesDeFicha,
  });
}

/**
 * GET /api/grupos?padre=…: los grupos hijos de `padre` en la clasificación oficial (la raíz es ''), leídos por
 * traduccion-api.js (leerGruposHijos). Errores propios: 404 si `padre` no es un nivel de la clasificación.
 * @param {string} padre @returns {Promise<GrupoHijo[]>}
 */
export function gruposHijos(padre) {
  return leerEnIdioma(`/grupos?padre=${encodeURIComponent(padre)}`, {
    leer: leerGruposHijos,
    traducciones: (datos, idioma) => traduccionesDeHijos(datos, padre, idioma),
  });
}

/**
 * Cómo se vuelve a pedir cada origen de un dato (traduccion-api.js, leerOrigen).
 * @type {Record<string, (codigo: string) => Promise<unknown>>}
 */
const LECTURA_DE_ORIGEN = { grupo: fichaDeGrupo, hijos: gruposHijos };

/**
 * Pide en el idioma de la página las lecturas de /api/grupos de los datos ya apuntados que aún no se han pedido en él
 * (por ejemplo, porque la página cambió de idioma). Sin IA y sin repetir: cada
 * lectura se pide una vez por idioma. Un fallo no se cuenta: el dato sigue en castellano, marcado. Devuelve si ha
 * pedido alguna.
 * @returns {Promise<boolean>}
 */
export async function completarTraducciones() {
  const idioma = idiomaDeLasRespuestas();
  if (idioma === IDIOMA_DEL_MOTOR) {
    return false;
  }
  const lecturas = origenesSinTraduccion(idioma)
    .map((origen) => leerOrigen(origen))
    .flatMap(({ tipo, codigo }) => {
      const leer = LECTURA_DE_ORIGEN[tipo];
      return leer ? [{ leer, codigo }] : [];
    });
  await Promise.allSettled(lecturas.map(({ leer, codigo }) => leer(codigo)));
  return lecturas.length > 0;
}
