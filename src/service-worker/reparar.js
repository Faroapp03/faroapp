import './no-coincide.js';
import { COPIA, HUELLAS_DE_LA_COPIA, urlDe } from './catalogo.js';
import { NO_COINCIDEN } from './comprobado.js';
import {
  anotarEscrituraEnLaCopia,
  enTandas,
  escriturasEnLaCopia,
  HuellaQueNoCoincide,
  imprescindiblesDeEstaVersion,
  PETICIONES_A_LA_VEZ,
  reponerLaEntradaDelRecorrido,
  respuestaParaLaCopia,
} from './copia.js';
import { COPIA_DEL_ESTADO, dejarConstancia } from './no-coincide.js';
import { cuadraLaEntradaGuardada, LATIDO_MS } from './paquete.js';

// ---------- Reparar la copia ----------
// «Reparar Faro» (scripts/recorrido/reparar.js): la página pide a la versión activa que vuelva a bajar su copia, porque
// algo guardado en ella falta o ya no cuadra con su huella (noEsDeEstaVersion). Se vuelve a bajar lo imprescindible
// (imprescindiblesDeEstaVersion) que no esté ya en una copia provisional, con las exigencias de la instalación
// (respuestaParaLaCopia: cada archivo, solo si cuadra con su huella de esta versión), y solo si llega todo se copia
// sobre lo guardado; después, la página del recorrido, si falta (reponerLaEntradaDelRecorrido). Si falla la descarga,
// la copia de esta versión no cambia; si falla al copiar (sin cuota, por ejemplo), cada entrada copiada es de esta
// versión y está entera: lo comprobado que siga estropeado se vuelve a detectar al servirlo (desdeLoComprobado) y la
// sonda lo cuenta; lo demás se sirve como esté hasta la próxima reparación o la próxima versión. Ni la copia del
// paquete de datos ni nada de la persona se tocan, y este service worker no se da de baja: WebKit vacía todas las
// copias de la web al quitar su último registro, también la del paquete. Si lo que llega no es de esta versión (el
// servidor sigue entregando otra cosa), se deja constancia y se dice (`no-coincide`); si falla por otra cosa, como la
// red, también (`sin-completar`); en los dos casos la página lo cuenta sin recargar y la reparación se puede volver a
// pedir. Con éxito (`ok`), la página recarga.
// - Mientras repara, avisa a la página (PROGRESO_DE_LA_REPARACION, sin cifras: la página solo dice que se está
//   reparando) al empezar, con cada archivo guardado y, como mucho cada LATIDO_MS, mientras llegan bytes. La página le
//   repite su petición con el mismo `id` (scripts/paquete-sin-conexion.js, seguirAlServiceWorker): cada mensaje es un evento que alarga la vida de este
//   service worker, y la petición repetida se une a la reparación en curso de esa página, sin otra respuesta; si llega
//   después de terminar, recibe otra vez la respuesta de esa petición, sin repetir nada.
// - Reanudación por archivos: la provisional se conserva si la descarga no termina (la red se corta, o el navegador
//   detiene este service worker), también al volver a ponerse en marcha, y la siguiente reparación de esta versión no
//   vuelve a bajar lo que ya tiene. Cada entrada se comprobó contra su huella al entrar; un archivo a medias no llegó a
//   guardarse. Se borra al terminar la descarga, salga bien o no la copia; la de otra versión, con su copia
//   (borrarCopiasViejas); y la que dejó una reparación sin terminar, cuando la sonda ve la copia entera y de esta
//   versión (borrarLaProvisionalSinUso).
// - Una reparación con otro `id` (otra pestaña o «Volver a intentarlo») espera a la que esté en curso: las dos usan la
//   misma copia provisional. Mientras espera recibe un aviso al llegar y con cada aviso de la que está en curso, y su
//   página sigue diciendo que se está reparando; si la que estaba en curso sale bien, recibe la misma respuesta sin
//   volver a reparar, y si no, la suya sigue con lo ya bajado. Cada respuesta lleva el `id` de su petición, para que
//   la página no tome la de un intento anterior por la suya.

/** Mensaje con que la página pide la reparación, y respuesta con cómo ha ido. */
const REPARAR_COPIA = 'REPARAR_COPIA';
const COPIA_REPARADA = 'COPIA_REPARADA';
/** Mensaje con que se cuenta a la página que la reparación de su petición sigue, o que espera a otra que sigue. */
const PROGRESO_DE_LA_REPARACION = 'PROGRESO_DE_LA_REPARACION';
/** Lo que distingue la copia provisional de una reparación de la de una instalación. */
const SUFIJO_DE_LA_REPARACION = ':reparacion';
/** La copia provisional de una reparación de esta versión; su nombre es también el de su cerrojo. */
const PROVISIONAL_DE_LA_REPARACION = `${COPIA}${SUFIJO_DE_LA_REPARACION}`;

/** Por página y número de petición, la reparación en curso o a la espera: la petición repetida se une a la suya. */
const reparacionesPedidas = /** @type {Map<string, Promise<void>>} */ (new Map());
/** Cómo avisar a cada petición que espera al cerrojo, por página y número: se le avisa con cada aviso de la en curso. */
const reparacionesQueEsperan = /** @type {Map<string, () => void>} */ (new Map());
/** Por página, la respuesta a su última petición terminada: el latido que llega tarde la recibe otra vez. */
const reparacionesTerminadas = /** @type {Map<string, { clave: string, respuesta: object }>} */ (new Map());
/** Si hay una reparación en curso, y cuántas han salido bien: la que esperaba a una que sale bien no repite nada. */
const reparaciones = { enCurso: false, buenas: 0 };

/**
 * Vuelve a hacer la copia de esta versión (ver arriba), con un aviso a la página (`avisar`) por cada archivo guardado
 * y, sin cifras, como mucho cada LATIDO_MS mientras llegan bytes. No falla.
 *
 * @param {unknown} id - Lo que identifica la petición en la página.
 * @param {() => void} avisar - Cuenta a la página, y a las que esperan, que sigue.
 * @returns {Promise<{ type: string, id: unknown, ok: boolean, motivo?: string }>} La respuesta para la página.
 */
async function repararCopia(id, avisar) {
  const provisional = PROVISIONAL_DE_LA_REPARACION;
  /** @type {{ type: string, id: unknown, ok: boolean, motivo?: string }} */
  let respuesta = { type: COPIA_REPARADA, id, ok: true };
  let descargada = false;
  try {
    const aReponer = await imprescindiblesDeEstaVersion();
    const enCurso = await caches.open(provisional);
    const yaEstan = await Promise.all(aReponer.map((archivo) => enCurso.match(urlDe(archivo))));
    let avisadoEn = 0;
    const contar = () => {
      avisadoEn = Date.now();
      avisar();
    };
    const sigue = () => Date.now() - avisadoEn >= LATIDO_MS && contar();
    contar();
    const faltan = aReponer.filter((_, indice) => !yaEstan[indice]);
    await enTandas(faltan, PETICIONES_A_LA_VEZ, async (archivo) => {
      await enCurso.put(urlDe(archivo), await respuestaParaLaCopia(archivo, sigue));
      contar();
    });
    descargada = true;
    const copia = await caches.open(COPIA);
    await enTandas(aReponer, PETICIONES_A_LA_VEZ, async (archivo) => {
      await copia.put(urlDe(archivo), /** @type {Response} */ (await enCurso.match(urlDe(archivo))));
    });
    await caches.delete(COPIA_DEL_ESTADO);
    NO_COINCIDEN.clear();
    // La página del recorrido, si falta, también; como al instalar, sin ella la reparación no falla, y la copia sigue
    // sin darse por completa (reponerLaEntradaDelRecorrido).
    await reponerLaEntradaDelRecorrido(sigue);
  } catch (error) {
    const noCoincide = error instanceof HuellaQueNoCoincide;
    respuesta = { type: COPIA_REPARADA, id, ok: false, motivo: noCoincide ? 'no-coincide' : 'sin-completar' };
    if (noCoincide) {
      await dejarConstancia(error.archivo);
    }
    console.warn(
      'Faro: no se ha podido reparar la copia sin conexión; lo que no se ha repuesto sigue como estaba.',
      error,
    );
  } finally {
    anotarEscrituraEnLaCopia();
    if (descargada) {
      await caches.delete(provisional);
    }
  }
  return respuesta;
}

/**
 * La reparación pedida por `cliente` con `id`, que le cuenta cómo ha ido (ver arriba): si ya está en curso o a la
 * espera, la misma; si ya ha terminado, su respuesta otra vez; si no, una nueva, después de la que esté en curso, que no
 * repite nada si esa sale bien.
 *
 * @param {ExtendableMessageEvent['source']} cliente - La página que lo ha pedido.
 * @param {unknown} id - Lo que identifica la petición en la página.
 * @returns {Promise<void>}
 */
function repararCopiaEnSuTurno(cliente, id) {
  const pagina = cliente && 'id' in cliente ? cliente.id : null;
  const clave = pagina === null ? null : JSON.stringify([pagina, id]);
  const pedida = clave && reparacionesPedidas.get(clave);
  if (pedida) {
    return pedida;
  }
  const terminada = pagina === null ? undefined : reparacionesTerminadas.get(pagina);
  if (terminada && terminada.clave === clave) {
    cliente?.postMessage(terminada.respuesta);
    return Promise.resolve();
  }
  const avisar = () => cliente?.postMessage({ type: PROGRESO_DE_LA_REPARACION, id });
  if (reparaciones.enCurso || reparacionesQueEsperan.size > 0) {
    avisar();
  }
  const buenasAlPedir = reparaciones.buenas;
  const avisarATodas = () => {
    for (const aviso of [avisar, ...reparacionesQueEsperan.values()]) {
      aviso();
    }
  };
  const turno = async () => {
    reparacionesQueEsperan.delete(String(clave));
    reparaciones.enCurso = true;
    try {
      const respuesta =
        reparaciones.buenas > buenasAlPedir
          ? { type: COPIA_REPARADA, id, ok: true }
          : await repararCopia(id, avisarATodas);
      reparaciones.buenas += respuesta.ok ? 1 : 0;
      if (pagina !== null && clave !== null) {
        reparacionesTerminadas.set(pagina, { clave, respuesta });
      }
      cliente?.postMessage(respuesta);
    } finally {
      reparaciones.enCurso = false;
    }
  };
  // Se apunta como en espera antes de pedir el cerrojo: así recibe los avisos de la que esté en curso desde el primero.
  if (clave) {
    reparacionesQueEsperan.set(clave, avisar);
  }
  const intento = navigator.locks.request(PROVISIONAL_DE_LA_REPARACION, turno);
  if (clave) {
    reparacionesPedidas.set(clave, intento);
    const olvidar = () => reparacionesPedidas.delete(clave);
    void intento.then(olvidar, olvidar);
  }
  return intento;
}

/**
 * El último «no» de copiaEnteraYDeEstaVersion, con lo que lo decide: el nombre de la copia (su VERSION y su firma), la
 * cuenta de escriturasEnLaCopia al empezar a leerla y lo imprescindible que se miró. Vale mientras las tres cosas sigan
 * igual; un «sí» no se guarda, porque con él se borra la provisional.
 */
const copiaQueNoEstaEntera = { clave: '' };

/**
 * Si la copia de esta versión tiene todo lo imprescindible y cada archivo cuadra con su huella. Con la copia
 * estropeada, la sonda no vuelve a calcular las huellas hasta que la copia cambie (copiaQueNoEstaEntera). No cuenta lo
 * que se escriba en ella desde fuera de este service worker: una página, o la instalación de otro con la misma VERSION
 * (cambia solo el paquete de datos), que completa esta misma COPIA (guardarCopia, copia.js). Entonces la provisional se
 * queda hasta la próxima escritura de este, la próxima reparación o el próximo arranque, o hasta que la versión nueva
 * se activa y borrarCopiasViejas la retira.
 */
async function copiaEnteraYDeEstaVersion() {
  const escrituras = escriturasEnLaCopia.cuenta;
  const imprescindibles = await imprescindiblesDeEstaVersion();
  const clave = JSON.stringify([COPIA, escrituras, imprescindibles]);
  if (copiaQueNoEstaEntera.clave === clave) {
    return false;
  }
  const copia = await caches.open(COPIA);
  for (const archivo of imprescindibles) {
    const guardada = await copia.match(urlDe(archivo));
    const huella = HUELLAS_DE_LA_COPIA.get(urlDe(archivo));
    if (!guardada || (huella && !(await cuadraLaEntradaGuardada(guardada, huella)))) {
      copiaQueNoEstaEntera.clave = clave;
      return false;
    }
  }
  return true;
}

/**
 * Borra la provisional que dejó una reparación sin terminar (`sin-completar`, `no-coincide`) cuando la sonda ve la copia
 * entera y de esta versión: ya no hay nada que reanudar. Solo con el cerrojo libre, para no tocar la de una reparación
 * en curso; si no se puede, se vuelve a mirar en la próxima sonda.
 */
async function borrarLaProvisionalSinUso() {
  try {
    await navigator.locks.request(PROVISIONAL_DE_LA_REPARACION, { ifAvailable: true }, async (cerrojo) => {
      if (cerrojo && (await caches.has(PROVISIONAL_DE_LA_REPARACION)) && (await copiaEnteraYDeEstaVersion())) {
        await caches.delete(PROVISIONAL_DE_LA_REPARACION);
      }
    });
  } catch {
    // Sin poder comprobar la copia, la provisional se queda: la próxima sonda lo vuelve a mirar.
  }
}

export { borrarLaProvisionalSinUso, REPARAR_COPIA, repararCopiaEnSuTurno };
