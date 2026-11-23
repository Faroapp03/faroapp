// Mantiene un diagnóstico utilizable sin conservar claves, URLs, cabeceras ni el texto de los resultados.
const MAX_DIAGNOSTICO = 300;

export function errorSinSecretos(error, secretos) {
  const nombre = error instanceof Error && /^[A-Za-z]+Error$/.test(error.name) ? error.name : 'Error';
  let mensaje = error instanceof Error ? error.message.split('\n')[0] : 'Fallo no identificado';
  for (const secreto of secretos.filter(Boolean)) {
    mensaje = mensaje.replaceAll(secreto, '[oculto]');
    mensaje = mensaje.replaceAll(encodeURIComponent(secreto), '[oculto]');
  }
  mensaje = mensaje.replace(/https?:\/\/\S+/gi, '[direccion]').replace(/Basic\s+\S+/gi, 'Basic [oculto]');
  return { nombre, mensaje: mensaje.slice(0, MAX_DIAGNOSTICO) };
}
