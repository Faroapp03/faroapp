/**
 * El enlace de correo saliente de la plantilla del Worker principal.
 *
 * Es opcional: sin él, el producto funciona igual y el canal de avisos por correo se declara no configurado. Cuando
 * está, solo lleva su nombre. La dirección de destino la guarda el panel y nunca se escribe en la configuración.
 */
const NOMBRE_DEL_ENLACE = 'AVISOS_CORREO';

function soloElNombre(valor: unknown): boolean {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) {
    return false;
  }
  const entradas = Object.entries(valor);
  return entradas.length === 1 && entradas[0]?.[0] === 'name' && entradas[0]?.[1] === NOMBRE_DEL_ENLACE;
}

/** Indica si el enlace de correo de una plantilla falta o es el único admitido, sin ninguna dirección. */
export function enlaceDeCorreoAdmitido(enlaces: unknown): boolean {
  return enlaces === undefined || (Array.isArray(enlaces) && enlaces.length === 1 && soloElNombre(enlaces[0]));
}
