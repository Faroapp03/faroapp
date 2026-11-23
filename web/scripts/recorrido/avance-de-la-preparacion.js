// La cuenta del porcentaje con que el chat enseña cómo se prepara Faro la primera vez (preparacion.js), aparte para
// poder probarla sin navegador. Junta dos avances reales, nunca uno inventado ni uno que pase con el tiempo:
// - La copia del paquete para usar sin conexión, que hace el service worker: cuenta los bytes guardados frente a los
//   totales, con el tamaño de cada archivo que escribe npm run web:preparar (src/service-worker/generado.js,
//   TAMANOS_DEL_PAQUETE, y paquete.js, PROGRESO_DEL_PAQUETE). Un service worker que solo cuenta archivos se cuenta por archivos.
// - La carga del motor del dispositivo, por las fases que cuenta su Worker (motor-local/worker.js, FaseDeLaCarga) y,
//   al final, la primera respuesta del motor, que es cuando el recorrido sigue solo.
// Las partes tienen pesos fijos relativos; no predicen el tiempo restante de un dispositivo concreto.
// Si una fase no se cuenta, su parte no suma, y el 100 % solo llega con la primera respuesta. Donde la copia sin
// conexión se sigue (la conversación, conLaCopia), el 100 % llega además solo con la copia completa y verificada: con
// la primera respuesta y la copia a medias, la barra se queda en el 99 % y dice que ya se puede empezar
// (estadoDeLaCopia). Si un intento falla y el
// recorrido lo repite, se dice («reintentando…»): la barra no se queda parada sin explicación.

/** La parte del porcentaje que es la copia del paquete; el resto es la carga del motor. */
const PARTE_DE_LA_COPIA = 0.85;
/**
 * Pesos relativos de las fases del motor dentro de su parte del progreso; suman uno.
 * Solo avanza cuando se notifica una fase real, no por el tiempo transcurrido.
 * @type {Readonly<Record<string, number>>}
 */
const PESO_DE_CADA_FASE = Object.freeze({
  comprobado: 0.05,
  motor: 0.15,
  datos: 0.4,
  clasificador: 0.1,
  vectores: 0.05,
  listo: 0.25,
});
/** El porcentaje entero. */
export const CIEN = 100;
/** Los porcentajes que se anuncian al lector de pantalla, cada cuarto (25, 50, 75 y 100); los de en medio, no. */
const CUARTOS = 4;
const UMBRALES_ANUNCIADOS = Object.freeze(
  Array.from({ length: CUARTOS }, (_, cuarto) => ((cuarto + 1) * CIEN) / CUARTOS),
);

/**
 * Lo que se sabe de la preparación: cómo va la copia (null si el service worker no ha contado nada), las fases de la
 * carga que ha contado el Worker, si el último intento ha fallado y se está repitiendo, y si el motor ya ha respondido.
 * @typedef {{ archivos: number | null, guardados: number | null, bytes?: number | null,
 *   bytesTotales?: number | null, exacto?: boolean, completo: boolean,
 *   primerAnalisis?: { archivos: number, guardados: number, bytes: number | null, bytesTotales: number | null } | null }}
 *   CopiaContada
 * @typedef {{ copia: CopiaContada | null, fases: ReadonlySet<string>, reintentando?: boolean, listo: boolean,
 *   copiaDetenida?: boolean }} Preparacion
 */
/** Bytes por megabyte, como los cuenta la barra (MB decimales). */
const BYTES_POR_MB = 1_000_000;

/**
 * Lo que la barra cuenta de la copia: lo que necesita el primer análisis, si el service worker lo cuenta aparte, porque
 * es lo que espera la conversación; si no, la copia entera. La copia completa es otro estado (`completo`) y la barra no
 * lo da a entender.
 * @param {CopiaContada} copia
 * @returns {{ archivos: number | null, guardados: number | null, bytes?: number | null, bytesTotales?: number | null }}
 */
function loQueSeEspera(copia) {
  return copia.primerAnalisis ?? copia;
}

/**
 * La parte de la copia que está hecha, de 0 a 1, o null si no se sabe. La carga del motor solo empieza con lo que
 * necesita el primer análisis guardado (motor-local/cliente.js), así que una fase contada da la copia por hecha para
 * esta espera, aunque el resto se siga guardando.
 * @param {Preparacion} preparacion @returns {number | null}
 */
function copiaHecha({ copia, fases, listo }) {
  if (listo || fases.size > 0 || copia?.completo) {
    return 1;
  }
  const esperada = copia ? loQueSeEspera(copia) : null;
  if (esperada?.bytesTotales && typeof esperada.bytes === 'number') {
    return Math.min(esperada.bytes / esperada.bytesTotales, 1);
  }
  if (esperada?.archivos && esperada.guardados !== null) {
    return Math.min(esperada.guardados / esperada.archivos, 1);
  }
  return null;
}

/**
 * El porcentaje entero de la preparación, de 0 a 100, o null si ninguna de las dos partes ha contado nada: entonces el
 * chat se queda con el texto, sin barra. Se redondea hacia abajo y no llega a 100 hasta que el motor responde; con
 * `conLaCopia`, tampoco hasta que la copia sin conexión está completa y verificada (copia.completo, que el service
 * worker solo da con cada archivo comprobado contra su huella y el manifiesto guardado el último).
 * @param {Preparacion} preparacion @param {{ conLaCopia?: boolean }} [opciones] @returns {number | null}
 */
export function porcentajeDeLaPreparacion(preparacion, { conLaCopia = false } = {}) {
  if (preparacion.listo) {
    return !conLaCopia || preparacion.copia?.completo === true ? CIEN : CIEN - 1;
  }
  const copia = copiaHecha(preparacion);
  if (copia === null) {
    return null;
  }
  const motor = [...preparacion.fases].reduce((suma, fase) => suma + (PESO_DE_CADA_FASE[fase] ?? 0), 0);
  const total = PARTE_DE_LA_COPIA * copia + (1 - PARTE_DE_LA_COPIA) * Math.min(motor, 1);
  return Math.min(Math.floor(total * CIEN + Number.EPSILON), CIEN - 1);
}

/**
 * Lo que se está haciendo, para decirlo junto al porcentaje: los megas de la copia mientras se copia (los archivos, si
 * no todos tienen su tamaño), después la fase de la carga que falta, y que se reintenta si el último intento ha
 * fallado.
 * @param {Preparacion} preparacion
 * @returns {{ tipo: 'megas', hechos: number, total: number } | { tipo: 'archivos', guardados: number, archivos:
 * number }
 *   | { tipo: 'motor' | 'datos' | 'ia' | 'reintento' | 'listo' }}
 */
export function queSeEstaHaciendo(preparacion) {
  const { copia, fases, listo } = preparacion;
  if (listo) {
    return { tipo: 'listo' };
  }
  if (preparacion.reintentando) {
    return { tipo: 'reintento' };
  }
  const copiando = (copiaHecha(preparacion) ?? 0) < 1;
  const esperada = copia ? loQueSeEspera(copia) : null;
  if (copiando && copia?.exacto && esperada?.bytesTotales && typeof esperada.bytes === 'number') {
    return {
      tipo: 'megas',
      hechos: Math.floor(esperada.bytes / BYTES_POR_MB),
      total: Math.round(esperada.bytesTotales / BYTES_POR_MB),
    };
  }
  if (copiando && esperada?.archivos && esperada.guardados !== null) {
    return { tipo: 'archivos', guardados: esperada.guardados, archivos: esperada.archivos };
  }
  if (!fases.has('motor')) {
    return { tipo: 'motor' };
  }
  return fases.has('datos') ? { tipo: 'ia' } : { tipo: 'datos' };
}

/**
 * En qué estado está la copia sin conexión una vez que el motor ha respondido: «empezar» si ya se puede analizar y la
 * copia aún se prepara, «lista» si está completa y verificada, con la página del recorrido (paquete-sin-conexion.js,
 * leerAvanceDeLaCopia), «detenida» si ha dejado de prepararse (se han agotado sus reintentos: reintentosDeLaCopia) y
 * null mientras el motor no ha respondido. Cada estado tiene su trato en la conversación (preparacion.js).
 * @param {Preparacion} preparacion @returns {'empezar' | 'lista' | 'detenida' | null}
 */
export function estadoDeLaCopia({ copia, listo, copiaDetenida = false }) {
  if (!listo) {
    return null;
  }
  if (copia?.completo === true) {
    return 'lista';
  }
  return copiaDetenida ? 'detenida' : 'empezar';
}

/**
 * Qué se hace cada vez que un intento de la copia acaba sin ella (ESTADO_DEL_PAQUETE con completo: false) con el motor
 * ya listo, según lo que se observa en ese momento:
 * - con red (`enLinea`), se vuelve a pedir al instante;
 * - sin red, se vuelve a pedir cuando vuelva (`alVolverLaRed`, el evento online).
 * Cada causa, una sola vez: como mucho, dos peticiones más. El service worker ya repite una vez cada archivo que falla y
 * sigue donde lo dejó, así que un fallo que vuelve con red no es pasajero (falta de espacio, una huella que no cuadra),
 * y pedirlo otra vez sin nada nuevo observado sería un bucle. Agotadas, la copia queda detenida.
 * @param {{ pedir: () => void, enLinea: () => boolean, alVolverLaRed: (pedir: () => void) => void }} entorno
 * @returns {() => 'al-instante' | 'al-volver-la-red' | 'detenida'} Lo que se ha hecho con este intento fallido.
 */
export function reintentosDeLaCopia({ pedir, enLinea, alVolverLaRed }) {
  /** @type {Set<string>} */
  const usadas = new Set();
  return () => {
    const causa = enLinea() ? 'al-instante' : 'al-volver-la-red';
    if (usadas.has(causa)) {
      return 'detenida';
    }
    usadas.add(causa);
    if (causa === 'al-instante') {
      pedir();
    } else {
      alVolverLaRed(pedir);
    }
    return causa;
  };
}

/**
 * El umbral más alto que se ha pasado al ir de `anterior` a `actual` (UMBRALES_ANUNCIADOS), o null si no se ha pasado
 * ninguno: solo entonces se avisa al lector de pantalla.
 * @param {number} anterior @param {number} actual @returns {number | null}
 */
export function umbralPasado(anterior, actual) {
  const pasados = UMBRALES_ANUNCIADOS.filter((umbral) => anterior < umbral && umbral <= actual);
  return pasados.at(-1) ?? null;
}
