// El motor recibe el relato y las respuestas exactas del estado local, también al reintentar.
/** @param {import('./flujo-local.js').Estado} local @param {import('../textos.js').Idioma} idioma */
export function cuerpoLocal(local, idioma) {
  return {
    texto: local.texto,
    idioma,
    respuestas: local.respuestas,
    ...(local.anadido ? { anadido: local.anadido } : {}),
  };
}
