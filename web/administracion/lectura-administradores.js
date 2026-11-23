// Cuándo se lee la lista de administradores: en cuanto el panel queda libre tras abrir la sesión, al entrar en su
// apartado si aún no se ha leído o falló, y cuando se pide («Actualizar» del Inicio, cambio de idioma). Una lectura
// pedida con el panel ocupado espera a que termine la operación en curso: el cliente avisa de cada cambio de estado y
// ese aviso la lanza, sin sondeo. Una lectura fallida no se repite sola.

/** @typedef {'sin-leer'|'leyendo'|'leida'|'fallida'} SituacionLectura */

/** @param {() => Promise<boolean>} leer Lee y pinta la lista; dice si ha llegado. @param {() => boolean} libre */
export function crearLecturaAdministradores(leer, libre) {
  /** @type {SituacionLectura} */
  let situacion = 'sin-leer';
  let esperando = false;
  async function leerAhora() {
    esperando = false;
    situacion = 'leyendo';
    let leida = false;
    try {
      leida = await leer();
    } finally {
      situacion = leida ? 'leida' : 'fallida';
    }
  }
  /** Lee ya si el panel está libre; si no, en cuanto lo esté. */
  function pedir() {
    if (situacion === 'leyendo') {
      return Promise.resolve();
    }
    if (libre()) {
      return leerAhora();
    }
    esperando = true;
    return Promise.resolve();
  }
  return {
    pedir,
    /** Cada cambio de estado del cliente: si había una lectura esperando y el panel ya está libre, se hace ahora. */
    alCambiarEstado() {
      if (esperando && situacion !== 'leyendo' && libre()) {
        void leerAhora();
      }
    },
    /** Al entrar en el apartado se lee si todavía no hay lista o la última lectura falló. */
    alEntrarEnApartado() {
      if (situacion === 'sin-leer' || situacion === 'fallida') {
        void pedir();
      }
    },
  };
}
