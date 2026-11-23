/** Estado compartible de la consulta; solo reconoce las elecciones de esta vista. */
import { TEMAS_CURSOS } from '../../recursos/catalogo-cursos/lector.js';
export const VALORES_FILTRO = {
  idioma: ['es', 'ca', 'en', 'no-indicado'],
  nivel: ['inicial', 'intermedio', 'avanzado', 'no-indicado'],
  modalidad: ['en-linea', 'presencial'],
  tema: TEMAS_CURSOS,
  orden: ['proximos', 'nombre'],
};
// «idioma» lo consume la cabecera para elegir la lengua de la interfaz. El idioma del curso tiene su propia clave.
const PARAMETRO_IDIOMA_CURSO = 'idioma-curso';
/** @import { FiltrosCatalogo } from '../../recursos/catalogo-cursos/lector.js' */
/** @param {URL} url @returns {FiltrosCatalogo} */
export function leerParametros(url) {
  const valores = Object.fromEntries(
    Object.entries(VALORES_FILTRO).map(([campo, opciones]) => {
      const valor =
        (campo === 'idioma' ? url.searchParams.get(PARAMETRO_IDIOMA_CURSO) : null) ?? url.searchParams.get(campo) ?? '';
      return [campo, opciones.some((opcion) => opcion === valor) ? valor : ''];
    }),
  );
  return {
    texto: url.searchParams.get('q') ?? '',
    idioma: valores.idioma ?? '',
    nivel: valores.nivel ?? '',
    modalidad: valores.modalidad ?? '',
    tema: valores.tema ?? '',
    orden: valores.orden || 'proximos',
  };
}
/** Conserva idioma de la página y parámetros ajenos; retira únicamente las claves de esta consulta.
 * @param {URL} url @param {FiltrosCatalogo} filtros @returns {URL} */
export function urlConFiltros(url, filtros) {
  const siguiente = new URL(url);
  siguiente.searchParams.delete('q');
  if (filtros.texto) {
    siguiente.searchParams.set('q', filtros.texto);
  }
  for (const campo of Object.keys(VALORES_FILTRO)) {
    const parametro = campo === 'idioma' ? PARAMETRO_IDIOMA_CURSO : campo;
    siguiente.searchParams.delete(parametro);
    const valor = filtros[/** @type {keyof typeof VALORES_FILTRO} */ (campo)];
    if (valor && !(campo === 'orden' && valor === 'proximos')) {
      siguiente.searchParams.set(parametro, valor);
    }
  }
  const anterior = siguiente.searchParams.get('idioma');
  if (anterior !== null && anterior !== 'ca' && anterior !== 'es') {
    siguiente.searchParams.delete('idioma');
  }
  return siguiente;
}
