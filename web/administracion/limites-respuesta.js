// Límites de lectura para respuestas administrativas; se aplican también al cuerpo en flujo.
import { MAX_CATALOGO_PRIVADO_BYTES } from './catalogo-privado.js';
export const MAX_RESPUESTA_PANEL_BYTES = 8192;
const MAX_ACCESOS_BYTES = 65536;
const MAX_DATOS_BYTES = 131072;
// Encuesta, medido con el servidor: crear un lote de 200 ocupa 27.656 bytes, y leer o cerrar con 50 lotes de nombres
// de 60 caracteres de cuatro bytes, 19.921. El tope deja margen sobre ese peor caso sin aceptar respuestas desmedidas.
const MAX_ENCUESTA_BYTES = 65536;
// Registro de la sesión única: el servidor devuelve como mucho 100 filas de hasta 800 bytes cada una.
const MAX_REGISTRO_PANEL_BYTES = 81920;
// Administradores: el servidor admite 50 con dos correos de hasta 254 bytes por fila (src/administracion/administradores.ts).
const MAX_ADMINISTRADORES_BYTES = 98304;
/** @param {string} ruta */
export function limiteRespuesta(ruta) {
  if (ruta === 'datos/ofertas-ocultas') {
    return MAX_CATALOGO_PRIVADO_BYTES;
  }
  if (ruta.startsWith('encuesta/')) {
    return MAX_ENCUESTA_BYTES;
  }
  if (ruta === 'sesion/registro') {
    return MAX_REGISTRO_PANEL_BYTES;
  }
  if (ruta.startsWith('administradores/')) {
    return MAX_ADMINISTRADORES_BYTES;
  }
  if (ruta === 'accesos/leer') {
    return MAX_ACCESOS_BYTES;
  }
  if (
    ruta.startsWith('instituciones/') ||
    ruta === 'datos/estado' ||
    ruta.startsWith('datos/vigilante/') ||
    ruta === 'datos/comprobar-estado'
  ) {
    return MAX_DATOS_BYTES;
  }
  return MAX_RESPUESTA_PANEL_BYTES;
}
