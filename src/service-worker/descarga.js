// ---------- Descargas con plazo ----------
// Lo común a las descargas del paquete (paquete.js) y a las de la copia de la web, al instalar y al reparar (copia.js):
// el plazo sin recibir datos, el vigilante que corta la descarga parada y la lectura del cuerpo trozo a trozo.

/**
 * Una descarga que pasa este tiempo sin recibir ningún byte se da por parada y se corta (sinPararse): las del paquete
 * (que se repiten una vez, conUnaRepeticion) y las de la copia de la web, al instalar y al reparar (copia.js,
 * respuestaComprobada). El plazo mira la falta de datos y no la duración: el archivo más grande (vectores-movil.json,
 * unos 15 MB) tarda minutos en una red lenta, pero sigue recibiendo trozos cada poco.
 */
const DESCARGA_PARADA_MS = 20_000;

/**
 * Hace la descarga `descargar` con un vigilante: si pasa DESCARGA_PARADA_MS sin recibir nada (ni la respuesta ni un
 * trozo de su cuerpo), la corta con su señal, y la descarga falla con un TimeoutError. `descargar` recibe la señal, que
 * pasa a fetch, y el aviso de que han llegado bytes, que reinicia el plazo y llama a `alRecibir`.
 *
 * @template T
 * @param {string} archivo - Lo que se baja, para el motivo del corte.
 * @param {(senal: AbortSignal, recibido: () => void) => Promise<T>} descargar - La descarga.
 * @param {() => void} [alRecibir] - Se llama cada vez que llegan bytes.
 * @returns {Promise<T>}
 */
async function sinPararse(archivo, descargar, alRecibir) {
  const corte = new AbortController();
  const cortar = () => corte.abort(new DOMException(`${archivo}: sin recibir datos`, 'TimeoutError'));
  let vigilancia = setTimeout(cortar, DESCARGA_PARADA_MS);
  const recibido = () => {
    clearTimeout(vigilancia);
    vigilancia = setTimeout(cortar, DESCARGA_PARADA_MS);
    alRecibir?.();
  };
  try {
    return await descargar(corte.signal, recibido);
  } finally {
    clearTimeout(vigilancia);
  }
}

/**
 * Los bytes de una respuesta, leídos trozo a trozo: con cada trozo se llama a `alRecibir`.
 *
 * @param {Response} respuesta - La respuesta de la descarga.
 * @param {() => void} [alRecibir] - Se llama cada vez que llegan bytes.
 * @returns {Promise<ArrayBuffer>}
 */
async function bytesDe(respuesta, alRecibir) {
  if (!respuesta.body) {
    return respuesta.arrayBuffer();
  }
  const lector = respuesta.body.getReader();
  /** @type {Uint8Array[]} */
  const trozos = [];
  let largo = 0;
  for (let leido = await lector.read(); !leido.done; leido = await lector.read()) {
    trozos.push(leido.value);
    largo += leido.value.byteLength;
    alRecibir?.();
  }
  const bytes = new Uint8Array(largo);
  let desde = 0;
  for (const trozo of trozos) {
    bytes.set(trozo, desde);
    desde += trozo.byteLength;
  }
  return bytes.buffer;
}

export { bytesDe, DESCARGA_PARADA_MS, sinPararse };
