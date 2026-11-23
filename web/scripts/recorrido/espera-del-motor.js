// La espera del motor del dispositivo mientras se prepara la primera vez: los reintentos de una petición y sus límites.
// La primera visita descarga los datos del motor (unos 25 MiB) antes del primer análisis, y su duración depende de la
// red: si el service worker deja de avisar 30 s, la espera acaba (paquete-sin-conexion.js, PaqueteSinRespuesta). Cada
// respuesta del Worker tiene 120 s (motor-local/cliente.js), y la clave de firma, 15 s (motor-local/secreto-firma.js).
// Y cada petición tiene dos límites, que los reintentos no reinician (solo una petición nueva, «Volver a intentarlo»,
// que decide la persona), contados por separado con los avisos de la copia (cliente.js, AvisosDeLaCopia):
// - LIMITE_DE_LA_COPIA_MS, la suma de las esperas de la copia: la primera descarga y las que la reparan tras un fallo,
//   también si llegan bytes muy despacio o un archivo vuelve a fallar su huella en cada intento;
// - LIMITE_TOTAL_MS, la suma del resto: el arranque del motor, sus respuestas y las pausas entre intentos.
// Así la espera de una petición no pasa de LIMITE_DE_LA_COPIA_MS + LIMITE_TOTAL_MS (45 minutos), con cualquier red.
// Son cotas para cuando algo falla o la red es muy lenta, no lo que se espera de ordinario.
// Al pasar uno, la espera en curso se cancela, también la pausa entre intentos, y la petición falla con SIN_DATOS. Si
// el Worker no contesta a esa petición cancelada, cliente.js lo termina igual a sus 120 s. La señal de la conversación
// (`senal`) la cancela igual, sin decir nada, cuando la persona sale del paso.

import { PaqueteSinRespuesta } from '../paquete-sin-conexion.js';
import { traducible } from '../textos.js';
import { ERROR_SIN_DATOS, ErrorFaro, errorDeCancelacion } from './api/errores.js';
import { MotorNoListo, pedir } from './motor.js';

/** @import { Operacion } from './motor.js' */

/** Los reintentos mientras el motor del dispositivo se prepara la primera vez: 60, uno cada 3 segundos. */
const MAX_INTENTOS = 60;
const MS_ENTRE_INTENTOS = 3000;
/**
 * Lo que pueden durar todos los intentos, en milisegundos, sin contar las esperas de la copia: 15 minutos. Lo que se
 * limita es el arranque del motor y sus reintentos, que sumaban hasta 123 minutos con un Worker bloqueado.
 */
const LIMITE_TOTAL_MS = 900_000;
/**
 * Lo que pueden durar, sumadas, las esperas de la copia de una petición, en milisegundos: 30 minutos. Es una cota ante
 * fallos o redes muy lentas, no la duración esperada: unas 3,2 veces la copia completa medida en 3G (unos 570 s), y
 * basta para copiar los 25 MiB de la primera visita con una red de unos 117 kbps o más.
 */
const LIMITE_DE_LA_COPIA_MS = 1_800_000;
/**
 * Lo que dice Faro si los datos del motor no se han terminado de preparar: con «Volver a intentarlo»
 * (paso-ocupacion.js). No atribuye el fallo a la conexión: puede venir de ella, del almacenamiento o del dispositivo.
 */
const SIN_DATOS = traducible(ERROR_SIN_DATOS);

/**
 * Una pausa de `ms` que acaba antes si se cancela `senal`, y entonces retira su temporizador.
 * @param {number} ms @param {AbortSignal} senal @returns {Promise<void>}
 */
function esperarMs(ms, senal) {
  return new Promise((listo) => {
    const alCancelar = () => {
      clearTimeout(plazo);
      listo();
    };
    const plazo = setTimeout(() => {
      senal.removeEventListener('abort', alCancelar);
      listo();
    }, ms);
    senal.addEventListener('abort', alCancelar, { once: true });
  });
}

/**
 * Un límite de `ms` que solo se gasta mientras cuenta (contar, hasta parar) y que, gastado, cancela `limite` con
 * SIN_DATOS como motivo. `parar` retira su temporizador.
 * @param {number} ms @param {AbortController} limite @returns {{ contar: () => void, parar: () => void }}
 */
function presupuesto(ms, limite) {
  let restante = ms;
  /** Desde cuándo se está gastando (Date.now), o null si no cuenta. @type {number | null} */
  let desde = null;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let plazo;
  return {
    contar() {
      if (desde === null) {
        desde = Date.now();
        plazo = setTimeout(() => limite.abort(new ErrorFaro(SIN_DATOS, 0, {})), restante);
      }
    },
    parar() {
      if (desde !== null) {
        clearTimeout(plazo);
        restante -= Date.now() - desde;
        desde = null;
      }
    },
  };
}

/**
 * Pide `operacion` al motor del dispositivo. Mientras se prepara (MotorNoListo), reintenta cada 3 s, 60 veces como
 * mucho y dentro de sus dos límites (LIMITE_DE_LA_COPIA_MS y LIMITE_TOTAL_MS); `alReintentar` se llama antes de cada
 * pausa. Si el service worker deja de avisar (PaqueteSinRespuesta), se acaban los intentos o pasa un límite, falla con
 * SIN_DATOS. Un fallo que no es MotorNoListo (el motor no arranca con la copia lista, o no es el de esta versión:
 * motor.js) no se reintenta. Si se cancela `senal`, falla en el acto como una cancelación (esCancelacion).
 * @param {Operacion} operacion @param {Record<string, unknown>} cuerpo
 * @param {{ alReintentar?: () => void, esperar?: (ms: number, senal: AbortSignal) => Promise<unknown>,
 *   senal?: AbortSignal }} [opciones]
 * @returns {Promise<{ respuesta: Record<string, unknown>, intentos: number }>}
 * @throws {ErrorFaro} SIN_DATOS, si los datos del motor no se han podido preparar; la cancelación, si se cancela.
 */
export async function pedirMientrasSePrepara(
  operacion,
  cuerpo,
  { alReintentar = () => {}, esperar = esperarMs, senal } = {},
) {
  const limite = new AbortController();
  const delMotor = presupuesto(LIMITE_TOTAL_MS, limite);
  const deLaCopia = presupuesto(LIMITE_DE_LA_COPIA_MS, limite);
  const avisos = {
    alEsperarLaCopia: () => {
      delMotor.parar();
      deLaCopia.contar();
    },
    alTenerLaCopia: () => {
      deLaCopia.parar();
      delMotor.contar();
    },
  };
  const alCancelar = () => limite.abort(errorDeCancelacion());
  if (senal?.aborted) {
    alCancelar();
  }
  senal?.addEventListener('abort', alCancelar, { once: true });
  try {
    for (let intento = 1; ; intento += 1) {
      try {
        return { respuesta: await pedir(operacion, cuerpo, limite.signal, avisos), intentos: intento };
      } catch (error) {
        // Cancelada por un límite o por la conversación, la petición falla con su motivo: no es MotorNoListo.
        if (!(error instanceof MotorNoListo)) {
          throw error;
        }
        if (error.cause instanceof PaqueteSinRespuesta || intento >= MAX_INTENTOS) {
          throw new ErrorFaro(SIN_DATOS, 0, {});
        }
        // La pausa entre intentos cuenta en el límite del motor, también tras una espera de la copia que ha fallado.
        avisos.alTenerLaCopia();
        alReintentar();
        await esperar(MS_ENTRE_INTENTOS, limite.signal);
        limite.signal.throwIfAborted();
      }
    }
  } finally {
    delMotor.parar();
    deLaCopia.parar();
    senal?.removeEventListener('abort', alCancelar);
  }
}
