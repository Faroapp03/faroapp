// La configuración solo se acepta por stdin; no devuelve ni imprime el JSON recibido en errores.
const MIN_CLAVE_RECORRIDO = 12;
const MAX_CREDENCIAL = 256;
export function validarCredenciales(valor) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    throw new Error('La entrada no es un objeto de credenciales');
  }
  const { usuario, clave, claveRecorrido } = valor;
  if (
    typeof usuario !== 'string' ||
    !usuario ||
    typeof clave !== 'string' ||
    !clave ||
    typeof claveRecorrido !== 'string' ||
    claveRecorrido.length < MIN_CLAVE_RECORRIDO ||
    usuario.length > MAX_CREDENCIAL ||
    clave.length > MAX_CREDENCIAL ||
    claveRecorrido.length > MAX_CREDENCIAL
  ) {
    throw new Error('Faltan credenciales válidas');
  }
  return { usuario, clave, claveRecorrido };
}
