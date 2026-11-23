// Lo que les falta a los navegadores más antiguos que admite Faro (Safari 16.4 a 17.3, en iPhone y en Mac):
// AbortSignal.any (Safari 17.4); AbortSignal.timeout llegó antes (Safari 16) y se
// completa igual si falta. Con ellos, el diagnóstico y el recorrido cortan una petición por tiempo o porque la
// persona vuelve atrás (scripts/recorrido/api.js). Sin ellos, enviar cualquier cosa daría «Algo ha fallado en Faro» sin llegar a pedir nada.
// Solo se definen si faltan, y se portan como la norma en lo que usa Faro: la señal se corta con el motivo de la
// primera que se corte. El polyfill solo añade métodos ausentes; nunca cambia lo que el navegador trae.

/**
 * Una señal que se corta sola, con un TimeoutError, pasados `milisegundos`. Solo se cubre el uso válido (un entero
 * no negativo); la norma lanza un TypeError con otros valores y este relleno no. El temporizador no se guarda: retiene
 * la señal hasta su plazo, que es corto.
 * @param {number} milisegundos El plazo, en milisegundos.
 * @returns {AbortSignal} La señal que se corta al cumplirse el plazo.
 */
function senalConTiempo(milisegundos) {
  const control = new AbortController();
  setTimeout(() => control.abort(new DOMException('La petición ha tardado demasiado.', 'TimeoutError')), milisegundos);
  return control.signal;
}

/**
 * Una señal que se corta en cuanto se corta cualquiera de `senales`, con su mismo motivo. Los oyentes de las señales
 * de origen se retiran cuando se corta la nueva: quien la usa para una sola petición le añade una señal propia que
 * corta al terminarla (recorrido/api/transporte.js), para no dejarlos colgados de una señal que dura más.
 * @param {AbortSignal[]} senales Las señales de origen.
 * @returns {AbortSignal} La señal que se corta con la primera que se corte.
 */
function senalDeCualquiera(senales) {
  const control = new AbortController();
  const cortada = senales.find((senal) => senal.aborted);
  if (cortada) {
    control.abort(cortada.reason);
    return control.signal;
  }
  for (const senal of senales) {
    senal.addEventListener('abort', () => control.abort(senal.reason), { once: true, signal: control.signal });
  }
  return control.signal;
}

/**
 * Pone lo que falte en `AbortSignal` (o en el que se le dé, para probarlo). Los métodos añadidos son propiedades
 * normales (enumerables), no las no enumerables que define la norma.
 * @param {typeof AbortSignal} [clase] La clase a completar.
 * @returns {void}
 */
export function completarAbortSignal(clase = globalThis.AbortSignal) {
  if (typeof clase.timeout !== 'function') {
    clase.timeout = senalConTiempo;
  }
  if (typeof clase.any !== 'function') {
    clase.any = senalDeCualquiera;
  }
}

if (globalThis.AbortSignal) {
  completarAbortSignal();
}
