// Configuración pública de quien publica esta copia. No contiene credenciales.
// Completar estos dos campos antes de publicar y regenerar las utilidades web comunes.

const MAX_NOMBRE = 160;
const MAX_CORREO = 254;
const CORREO = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/u;

/** @param {unknown} valor @returns {Readonly<{responsable:string,correo:string}>} */
export function leerContactoPublico(valor) {
  if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) {
    throw new TypeError('Contacto público no válido');
  }
  const { responsable, correo } = /** @type {{responsable:unknown,correo:unknown}} */ (valor);
  if (
    Object.keys(valor).sort().join(',') !== 'correo,responsable' ||
    typeof responsable !== 'string' ||
    responsable.length > MAX_NOMBRE ||
    responsable !== responsable.trim() ||
    /[\p{Cc}\p{Cf}]/u.test(responsable) ||
    typeof correo !== 'string' ||
    correo.length > MAX_CORREO ||
    (correo !== '' && !CORREO.test(correo))
  ) {
    throw new TypeError('Contacto público no válido');
  }
  return Object.freeze({ responsable, correo });
}

export const CONTACTO_PUBLICO = leerContactoPublico({ responsable: '', correo: '' });
