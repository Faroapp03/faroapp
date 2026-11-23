// La conversación con Faro: una sola superficie, sin burbujas. Cada turno ocupa todo el ancho y empieza con su autor
// («Faro», con el monograma de Faro, o «Tú»). También el mensaje de espera mientras responde la API y
// las respuestas rápidas que Faro ofrece debajo de su último mensaje.
//
// Lectores de pantalla: #conversacion es un role="log" con aria-live="polite", así que solo se anuncia cada mensaje
// nuevo, una vez, y nunca el historial entero. La línea de autor visible no se lee (aria-hidden): cada mensaje lleva
// su nombre corto para los lectores («Faro: », «Tú: »), y el anuncio no repite «Sistema de IA» en cada turno. Las
// tarjetas de cada paso y las respuestas rápidas van fuera del log, justo debajo: son controles, no mensajes, y
// anunciarlas enteras cada vez que cambian sería ruido.
//
// Movimiento: solo de una vez. La espera es «escribiendo…»: tres puntos quietos, que no laten, y el
// texto de lo que está haciendo Faro de verdad («Estoy pensando en lo que me dices…»); dura lo que tarda la respuesta.
// El pensamiento empieza con el trabajo que cuenta (empezarAPensar); cuando llega la respuesta, presenta sus pasos
// uno a uno y se recoge antes de dejarla ver (crearPensamientoEnCurso). El desplazamiento
// para enseñar el último mensaje es instantáneo.
//
// Idioma: los mensajes del diccionario y los datos versionados se reescriben al cambiar el idioma de la página.
// Los textos literales de la persona y del motor conservan sus palabras y el idioma con que se recibieron.
//
// Avisos de la API: Faro los dice como notas. El motor los escribe en castellano en las rutas que no reciben idioma,
// así que los que tienen un texto fijo se dicen con el del diccionario, en el idioma de la página: el del teléfono 024
// (con los teléfonos como enlaces, y es el que no puede quedarse en otra lengua), el de los datos personales quitados
// y el de un texto que no habla de un trabajo. Los demás, con las palabras del motor y marcados con su idioma.

import { crear, porId } from '../dom.js';
import { escribir } from '../idioma.js';
import { inicioDelTramo, MEDIDAS, medirTramo } from '../marcas-de-tiempo.js';
import { traducible } from '../textos.js';
import { textoDelMotor } from './traduccion-api.js';

/** @import { Parte, Traducible } from '../textos.js' */
/** @import { Aviso } from './traduccion-api.js' */
/** @import { Idioma } from '../textos.js' */

/**
 * Lo que dice un mensaje: una parte (un párrafo) o una lista de partes y nodos.
 * @typedef {Parte | Node | (Parte | Node)[]} Partes
 */
/**
 * Una respuesta rápida: su rótulo, lo que hace (`accion`) o el paso al que vuelve (`volver`) y, si cambia su aspecto,
 * una clase más (`clase`). Con `conservar`, pulsarla no retira las demás: abre otra forma de responder (escribir) sin
 * quitar las que ya había. Si el rótulo acorta lo que nombra (la forma breve de un título de ocupación), `nombre` es su
 * nombre accesible, que empieza por lo que se ve, y `titulo`, el nombre entero que se ve al pasar por encima.
 * @typedef {{ texto: Parte, accion?: () => void, volver?: number, clase?: string, conservar?: boolean,
 *   nombre?: string, titulo?: string }} Sugerencia
 */

/**
 * La línea de autor que se ve sobre cada turno. La persona es «Tú»: Faro nunca pide su nombre. Faro firma siempre como
 * «Sistema de IA» (Ley de IA, art. 50): también en el dispositivo responde con su propia IA (ocupacion-local.js).
 * @param {'faro' | 'persona'} autor @returns {Traducible}
 */
function autorDe(autor) {
  return traducible(autor === 'persona' ? 'recorrido.autor.persona' : 'recorrido.autor.faro');
}
/** El nombre que oyen los lectores de pantalla al principio de cada mensaje. */
const NOMBRE_DE = Object.freeze({
  faro: traducible('recorrido.lector.faro'),
  persona: traducible('recorrido.lector.persona'),
});
/** La inicial del monograma de Faro; la raya de luz sobre ella la dibuja estilos/recorrido/conversacion.css. */
const INICIAL_DE_FARO = 'F';
/** El tipo del aviso con que la moderación ofrece el teléfono 024 (src/seguridad/avisos.ts). */
export const AVISO_DE_AYUDA = 'ayuda';
/** El aviso del 024, el mismo que el del motor (pruebas/web-recorrido-interfaz/interfaz.test.ts). */
const TEXTO_DE_AYUDA = traducible('recorrido.ayuda.024');
/**
 * Los otros avisos del motor con un texto fijo, por su tipo: se dicen con el del diccionario, en el idioma de la
 * página, en lugar del texto que trae el motor.
 * @type {Readonly<Record<string, Traducible>>}
 */
const AVISOS_DEL_DICCIONARIO = Object.freeze({
  'datos-personales': traducible('recorrido.aviso-del-motor.datos-personales'),
  'fuera-de-tema': traducible('recorrido.aviso-del-motor.fuera-de-tema'),
});
/** Los teléfonos del aviso del 024, en el orden de sus marcas {0} y {1} en el diccionario. */
const TELEFONOS_DE_AYUDA = Object.freeze(['024', '112']);

/**
 * El mensaje de espera en curso, si lo hay: se sustituye por la respuesta en cuanto llega.
 * @type {HTMLElement | null}
 */
let espera = null;

/** El log de la conversación y la fila de respuestas rápidas, que recorrido.html tiene siempre. */
function elLog() {
  return porId('conversacion');
}
function laFilaDeSugerencias() {
  return porId('sugerencias');
}

/**
 * Cada parte es un párrafo: un traducible, un literal con su idioma o un texto. Un nodo (un enlace, por ejemplo) se
 * añade tal cual. Nunca se interpreta HTML.
 * @param {Partes} partes @returns {Node[]}
 */
function parrafos(partes) {
  return [partes].flat().map((parte) => (parte instanceof Node ? parte : escribir(crear('p'), parte)));
}

/**
 * Un elemento que se ve pero no se lee: la información ya la da el texto para lectores de pantalla.
 * @template {keyof HTMLElementTagNameMap} Etiqueta
 * @param {Etiqueta} etiqueta @param {Partial<HTMLElementTagNameMap[Etiqueta]>} propiedades
 */
function soloVisible(etiqueta, propiedades) {
  const elemento = crear(etiqueta, propiedades);
  elemento.setAttribute('aria-hidden', 'true');
  return elemento;
}

/**
 * Un turno de la conversación: su autor, visible y para lectores, y sus párrafos. El log solo tiene hijos de estos.
 * @param {'faro' | 'persona'} autor @param {Partes} partes @param {string} [tipo]
 */
function crearMensaje(autor, partes, tipo) {
  const texto = crear(
    'div',
    { className: 'rc-texto' },
    escribir(crear('span', { className: 'solo-lectores' }), NOMBRE_DE[autor]),
    ...parrafos(partes),
  );
  const turno = crear(
    'div',
    { className: 'rc-turno' },
    escribir(soloVisible('p', { className: 'rc-autor' }), autorDe(autor)),
    texto,
  );
  const mensaje = crear('div', { className: 'rc-mensaje' }, turno);
  mensaje.dataset.autor = autor;
  if (tipo) {
    mensaje.dataset.tipo = tipo;
  }
  if (autor === 'faro') {
    mensaje.prepend(soloVisible('span', { className: 'rc-avatar rc-monograma', textContent: INICIAL_DE_FARO }));
  }
  return mensaje;
}

/**
 * Enseña `elemento` sin animación. Con `bloque = 'start'` lo deja arriba (Faro presenta una tarjeta larga y se lee
 * desde su mensaje); con 'nearest', lo justo para que se vea encima de la barra de escritura.
 * @param {Element | null | undefined} elemento @param {ScrollLogicalPosition} [bloque]
 */
export function llevarALaVista(elemento, bloque = 'nearest') {
  // Sin «behavior»: salta al instante (ninguna hoja pide desplazamiento suave).
  elemento?.scrollIntoView({ block: bloque });
}

/**
 * Añade un mensaje de Faro y lo enseña. `partes` es una parte (un traducible, un literal con su idioma o un texto), o
 * una lista de partes (un párrafo cada una) y nodos.
 * `tipo` cambia su aspecto: 'saludo' (el primero de la conversación), 'error' (algo ha fallado), 'nota' (un aviso)
 * o 'espera'. Con `desplazar: false` no se lleva a la vista: el saludo ya lo está al abrir la página, y desplazarse
 * movería el punto de partida del teclado, que tiene que ser el principio de la página (el enlace «Saltar al
 * contenido»). Devuelve el mensaje.
 * @param {Partes} partes @param {{ tipo?: 'saludo' | 'error' | 'nota' | 'espera', desplazar?: boolean }} [opciones]
 * @returns {HTMLElement} el mensaje
 */
export function decirFaro(partes, { tipo, desplazar = true } = {}) {
  const pensando = espera?.querySelector('.rc-pensamiento');
  if (pensando) {
    retirados.add(/** @type {HTMLElement} */ (pensando));
  }
  quitarEspera();
  const mensaje = crearMensaje('faro', partes, tipo);
  elLog().append(mensaje);
  if (desplazar) {
    llevarALaVista(mensaje);
  }
  return mensaje;
}

/**
 * Añade lo que ha dicho la persona y marca la conversación como empezada (<body data-conversacion>). `dicho` es lo que
 * ha escrito o, si ha pulsado un botón, el traducible de su rótulo. Las respuestas rápidas anteriores ya no valen: se
 * retiran.
 * @param {Parte} dicho
 * @returns {HTMLElement} el mensaje
 */
export function decirPersona(dicho) {
  quitarSugerencias();
  // La bienvenida da paso a la conversación: estilos/recorrido/bienvenida.css deja de pintar el saludo como título.
  document.body.dataset.conversacion = 'empezada';
  const mensaje = crearMensaje('persona', dicho);
  elLog().append(mensaje);
  llevarALaVista(mensaje);
  return mensaje;
}

/**
 * Mensaje fijo de Faro mientras espera a la API («Faro está leyendo lo que me cuentas…»).
 * @param {Parte} aviso
 */
export function mostrarEspera(aviso) {
  if (espera) {
    actualizarEspera(aviso);
    return;
  }
  // Los tres puntos son solo visuales: el texto ya dice que Faro está en ello.
  const puntos = soloVisible('span', { className: 'rc-escribiendo' });
  puntos.append(crear('i'), crear('i'), crear('i'));
  espera = decirFaro([puntos, aviso], { tipo: 'espera' });
}

/**
 * Cambia el texto de la espera en curso.
 * @param {Parte} aviso
 */
export function actualizarEspera(aviso) {
  // El primer párrafo del texto de la espera, que crea crearMensaje: es siempre un <p>.
  /** @type {HTMLParagraphElement | null | undefined} */
  const parrafo = espera?.querySelector('.rc-texto p');
  if (parrafo) {
    escribir(parrafo, aviso);
  }
}

/**
 * Retira el mensaje de espera, si lo hay.
 *
 */
export function quitarEspera() {
  espera?.remove();
  espera = null;
}

/**
 * Respuestas rápidas bajo el último mensaje de Faro: cada una es { texto, accion } o { texto, volver } (el paso al
 * que vuelve), con `texto` traducible. Se retiran en cuanto la persona dice algo, y una lista vacía las quita.
 * @param {Sugerencia[]} opciones
 * @returns {HTMLButtonElement | undefined} la primera, para llevarle el foco
 */
export function ofrecerSugerencias(opciones) {
  const botones = opciones.map(({ texto, accion, volver, clase, conservar = false, nombre, titulo }) => {
    const className = clase ? `rc-sugerencia ${clase}` : 'rc-sugerencia';
    const boton = escribir(crear('button', { type: 'button', className }), texto);
    if (nombre) {
      boton.setAttribute('aria-label', nombre);
    }
    if (titulo) {
      boton.title = titulo;
    }
    // «Volver» lo resuelve recorrido.js con data-volver, como el resto de botones que vuelven atrás.
    if (volver) {
      boton.dataset.volver = String(volver);
    }
    // Usada una, las demás ya no tienen sentido: se retiran todas antes de hacer lo que pide (salvo si la sugerencia
    // las conserva).
    if (accion) {
      boton.addEventListener('click', () => {
        if (!conservar) {
          quitarSugerencias();
        }
        accion();
      });
    }
    return boton;
  });
  laFilaDeSugerencias().replaceChildren(...botones);
  laFilaDeSugerencias().hidden = !botones.length;
  return botones[0];
}

/**
 * Retira las respuestas rápidas.
 *
 */
export function quitarSugerencias() {
  ofrecerSugerencias([]);
}

/**
 * Si entre los avisos de una respuesta de la API está el del 024.
 * @param {Aviso[]} avisos @returns {boolean}
 */
export function hayAvisoDeAyuda(avisos) {
  return avisos.some((aviso) => aviso.tipo === AVISO_DE_AYUDA);
}

/** El aviso del 024, con cada teléfono como un enlace que llama: en un móvil basta con tocarlo. */
function parrafoDeAyuda() {
  const enlaces = TELEFONOS_DE_AYUDA.map((numero) => crear('a', { href: `tel:${numero}`, textContent: numero }));
  return escribir(crear('p', {}, ...enlaces), TEXTO_DE_AYUDA);
}

/**
 * Lo que dice Faro de un aviso: el del 024 y los de texto fijo, con el texto del diccionario (la cabecera lo explica);
 * los demás, con el del motor, marcado con `idioma`, el idioma en que lo escribió.
 * @param {Aviso} aviso @param {Idioma} idioma @returns {Parte | Node}
 */
function parteDelAviso(aviso, idioma) {
  if (aviso.tipo === AVISO_DE_AYUDA) {
    return parrafoDeAyuda();
  }
  const fijo = Object.hasOwn(AVISOS_DEL_DICCIONARIO, aviso.tipo) ? AVISOS_DEL_DICCIONARIO[aviso.tipo] : undefined;
  return fijo ?? textoDelMotor(aviso.texto, idioma);
}

/**
 * Faro dice, cada uno en su nota, los avisos que acompañan a una respuesta de la API ({ tipo, texto }). `idioma` es el
 * idioma en que los escribió el motor. Cada nota lleva el tipo de su aviso (data-aviso), para saber si ya se ha dicho.
 * @param {Aviso[]} avisos @param {Idioma} idioma
 */
export function decirAvisos(avisos, idioma) {
  for (const aviso of avisos) {
    const nota = decirFaro(parteDelAviso(aviso, idioma), { tipo: 'nota' });
    nota.dataset.aviso = aviso.tipo;
  }
}

/**
 * Si Faro ya ha dicho en esta conversación un aviso de este tipo.
 * @param {string} tipo @returns {boolean}
 */
export function avisoYaDicho(tipo) {
  // Los hijos del log son los turnos que crea crearMensaje, todos <div>; se consulta el aviso de cada turno.
  return [...elLog().children].some((mensaje) => /** @type {HTMLElement} */ (mensaje).dataset.aviso === tipo);
}

/**
 * Lo que tarda en llenarse, una sola vez, la línea del paso en curso mientras se espera al motor: unos 4 s. Si el
 * motor tarda más, la línea se queda llena y quieta, con el paso en curso y «Pensando…», hasta que responde.
 */
const MS_DEL_RELLENO = 4350;
/** Duración de la secuencia de pasos, incluido el pliegue. */
const BASE_DEL_PENSAMIENTO = 1200;
const MS_POR_PASO = 800;
const TOPE_DEL_PENSAMIENTO = 5000;
const MS_DEL_PLIEGUE = 650;
/** Los pasos que se dicen, como mucho. */
const MAX_PASOS = 5;
/** Para dar a cada pensamiento su propio id (aria-controls). */
let pensamientos = 0;
/** Los pensamientos que aún no han dejado ver su respuesta. */
let enCurso = 0;
/** Los pasos y pliegues pendientes: se cancelan al borrar el recorrido. @type {Set<ReturnType<typeof setTimeout>>} */
const relojesDelPensamiento = new Set();
/** @param {() => void} accion @param {number} ms */
function despuesDelPensamiento(accion, ms) {
  const reloj = setTimeout(() => {
    relojesDelPensamiento.delete(reloj);
    accion();
  }, ms);
  relojesDelPensamiento.add(reloj);
}
/** El evento con que la página se entera de que Faro empieza o deja de pensar (faroEstaPensando). */
export const EVENTO_PENSANDO = 'faro-pensando';
/**
 * Lo que hace quien pide el pensamiento cuando aparece su respuesta (llevar el foco a la tarjeta, por ejemplo).
 * @type {WeakMap<HTMLElement, () => void>}
 */
const alResponder = new WeakMap();
/** Cuándo empezó cada pensamiento en la línea temporal (MEDIDAS.pensamiento). @type {WeakMap<HTMLElement, number>} */
const inicioDelPensamiento = new WeakMap();
/**
 * Los pensamientos empezados que salieron de la vista a mitad de su espera, porque Faro dijo otro mensaje (decirFaro).
 * @type {WeakSet<HTMLElement>}
 */
const retirados = new WeakSet();
/** Los pensamientos ya encargados de presentar una respuesta. @type {WeakSet<HTMLElement>} */
const enPresentacion = new WeakSet();

/** Si la persona ha pedido menos movimiento: los pasos llegan igual, pero sin efectos. */
function sinMovimiento() {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? true;
}

/**
 * Pliega o despliega el pensamiento. Plegado, su cuerpo queda fuera de la vista y de los lectores (visibility, en el
 * CSS, al acabar el pliegue).
 * @param {HTMLElement} bloque @param {boolean} plegado
 */
function plegarPensamiento(bloque, plegado) {
  bloque.toggleAttribute('data-plegado', plegado);
  bloque.querySelector('.rc-pensamiento-cabeza')?.setAttribute('aria-expanded', String(!plegado));
}

/**
 * Cuando el pensamiento ha terminado y se ha recogido, aparece la respuesta de Faro (el CSS la tenía escondida):
 * se lleva a la vista lo último que ha dicho y, si no cabe, el principio de la respuesta.
 * @param {HTMLElement} bloque
 */
function mostrarLaRespuesta(bloque) {
  bloque.dataset.estado = 'hecho';
  const inicio = inicioDelPensamiento.get(bloque);
  if (inicio !== undefined) {
    medirTramo(MEDIDAS.pensamiento, inicio, { pasos: pasosDe(bloque).children.length });
  }
  cambiarPensando(-1);
  const mensaje = bloque.closest('.rc-mensaje');
  if (!mensaje?.isConnected) {
    return;
  }
  llevarALaVista(elLog().lastElementChild);
  if (mensaje.getBoundingClientRect().top < 0) {
    llevarALaVista(mensaje, 'start');
  }
  alResponder.get(bloque)?.();
}

/**
 * Lleva la cuenta de los pensamientos en curso y avisa a la página (EVENTO_PENSANDO): la barra de escritura no envía
 * mientras Faro piensa (compositor.js).
 * @param {number} cambio
 */
function cambiarPensando(cambio) {
  enCurso = Math.max(0, enCurso + cambio);
  if (typeof Event === 'function') {
    globalThis.document?.dispatchEvent?.(new Event(EVENTO_PENSANDO));
  }
}

/** Si Faro está pensando ahora: entonces la barra de escritura no envía, y lo escrito se queda. @returns {boolean} */
export function faroEstaPensando() {
  return enCurso > 0;
}

/**
 * Un paso del pensamiento: su marca (en curso o ✓), su texto y una línea fina que se llena una sola vez mientras dura.
 * @param {Parte} texto @returns {HTMLLIElement}
 */
function pasoDelPensamiento(texto) {
  const paso = crear(
    'li',
    {},
    soloVisible('span', { className: 'rc-pensamiento-marca' }),
    crear(
      'div',
      { className: 'rc-pensamiento-linea-del-paso' },
      escribir(crear('span', { className: 'rc-pensamiento-texto' }), texto),
      soloVisible('span', { className: 'rc-pensamiento-progreso' }),
    ),
  );
  paso.dataset.estado = 'en-curso';
  return paso;
}

/** Da por hecho el paso en curso, si lo hay: ✓ y menos contraste. @param {HTMLElement} lista */
function terminarElPaso(lista) {
  // Los pasos son los <li> que crea pasoDelPensamiento.
  const paso = /** @type {HTMLElement | null} */ (lista.lastElementChild);
  if (!paso) {
    return;
  }
  paso.dataset.estado = 'hecho';
  const marca = paso.querySelector('.rc-pensamiento-marca');
  if (marca) {
    marca.textContent = '✓';
  }
}

/** Empieza un paso: entra en la lista y su línea se llena una sola vez en `ms`. @param {HTMLElement} lista */
function empezarElPaso(lista, /** @type {Parte} */ texto, /** @type {number} */ ms) {
  const paso = pasoDelPensamiento(texto);
  lista.append(paso);
  // Si el paso nuevo queda debajo de lo que se ve, se enseña (al instante y solo lo justo).
  if (paso.isConnected) {
    llevarALaVista(paso);
  }
  const progreso = paso.querySelector('.rc-pensamiento-progreso');
  if (!sinMovimiento() && typeof progreso?.animate === 'function') {
    progreso.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], {
      duration: ms,
      easing: 'linear',
      fill: 'forwards',
    });
  }
}

/**
 * Recoge el pensamiento con su pliegue, una sola vez. Antes se toma cómo se ve desplegado: el bloque acaba de entrar en
 * su mensaje y, sin eso, el navegador no tendría desde dónde animar el pliegue. Con prefers-reduced-motion, sin efecto.
 * @param {HTMLElement} bloque
 */
function recogerElPensamiento(bloque) {
  if (!sinMovimiento()) {
    bloque.getBoundingClientRect();
  }
  plegarPensamiento(bloque, true);
}

/** El bloque del pensamiento, desplegado y con «Pensando…», sin pasos todavía. @returns {HTMLElement} */
function bloqueDelPensamiento() {
  pensamientos += 1;
  const id = `rc-pensamiento-${pensamientos}`;
  const cabeza = crear(
    'button',
    { type: 'button', className: 'rc-pensamiento-cabeza' },
    escribir(crear('span', { className: 'rc-pensamiento-titulo' }), traducible('recorrido.pensamiento.pensando')),
    soloVisible('span', { className: 'rc-pensamiento-flecha' }),
  );
  cabeza.setAttribute('aria-expanded', 'true');
  cabeza.setAttribute('aria-controls', id);
  const lista = crear('ol', { className: 'rc-pensamiento-pasos' });
  const cuerpo = crear('div', { className: 'rc-pensamiento-cuerpo', id }, crear('div', {}, lista));
  const bloque = crear('div', { className: 'rc-pensamiento' }, cabeza, cuerpo);
  bloque.dataset.estado = 'pensando';
  cabeza.addEventListener('click', () => plegarPensamiento(bloque, !bloque.hasAttribute('data-plegado')));
  return bloque;
}

/** La lista de pasos de un pensamiento. @param {HTMLElement} bloque @returns {HTMLElement} */
function pasosDe(bloque) {
  return /** @type {HTMLElement} */ (bloque.querySelector('.rc-pensamiento-pasos'));
}

/**
 * El pensamiento de Faro empieza a la vez que el trabajo que cuenta (la petición al motor, en ocupacion-local.js):
 * «Pensando…» y su primer paso, con la línea que se llena una sola vez en MS_DEL_RELLENO. Si el trabajo tarda más, se
 * queda así, quieto, sin volver a empezar: «Pensando…», el paso en curso y su línea llena. Va dentro del mensaje de
 * espera, si lo hay, que entonces solo enseña el pensamiento (el CSS esconde lo que no es el pensamiento). Cuando llega
 * la respuesta, crearPensamientoEnCurso lo recibe en `empezado` y lo termina.
 * @param {Parte} primerPaso @returns {HTMLElement}
 */
export function empezarAPensar(primerPaso) {
  const bloque = bloqueDelPensamiento();
  inicioDelPensamiento.set(bloque, inicioDelTramo());
  espera?.querySelector('.rc-texto')?.append(bloque);
  empezarElPaso(pasosDe(bloque), primerPaso, MS_DEL_RELLENO);
  return bloque;
}

/**
 * Presenta los pasos de la respuesta uno a uno, pliega el pensamiento y después deja ver la respuesta.
 * Si ya empezó durante la petición, reutiliza el primer paso y conserva su medida; al borrar se cancelan sus relojes.
 * @param {Parte[]} textos @param {{ alAparecer?: () => void, empezado?: HTMLElement | null }} [opciones]
 * @returns {HTMLElement}
 */
export function crearPensamientoEnCurso(textos, { alAparecer, empezado = null } = {}) {
  const sigue = empezado?.dataset.estado === 'pensando' && !enPresentacion.has(empezado) ? empezado : null;
  const bloque = sigue ?? bloqueDelPensamiento();
  enPresentacion.add(bloque);
  if (!sigue || retirados.has(sigue)) {
    inicioDelPensamiento.set(bloque, inicioDelTramo());
  }
  if (alAparecer) {
    alResponder.set(bloque, alAparecer);
  }
  cambiarPensando(1);
  const lista = pasosDe(bloque);
  const pasos = textos.slice(0, MAX_PASOS);
  const total = Math.min(TOPE_DEL_PENSAMIENTO, BASE_DEL_PENSAMIENTO + MS_POR_PASO * pasos.length);
  const porPaso = (total - MS_DEL_PLIEGUE) / Math.max(1, pasos.length);
  const siguiente = (/** @type {number} */ indice) => {
    if (indice > 0) {
      terminarElPaso(lista);
    }
    if (indice >= pasos.length) {
      if (indice === 0) {
        terminarElPaso(lista);
      }
      escribir(
        /** @type {HTMLElement} */ (bloque.querySelector('.rc-pensamiento-titulo')),
        traducible('recorrido.pensamiento.resumen'),
      );
      bloque.dataset.estado = 'recogiendo';
      recogerElPensamiento(bloque);
      despuesDelPensamiento(() => mostrarLaRespuesta(bloque), sinMovimiento() ? 0 : MS_DEL_PLIEGUE);
      return;
    }
    if (indice >= lista.children.length) {
      empezarElPaso(lista, pasos[indice], porPaso);
    }
    despuesDelPensamiento(() => siguiente(indice + 1), porPaso);
  };
  siguiente(0);
  return bloque;
}

/**
 * Olvida la conversación entera: se usa al borrar el recorrido.
 *
 */
export function vaciarConversacion() {
  for (const reloj of relojesDelPensamiento) {
    clearTimeout(reloj);
  }
  relojesDelPensamiento.clear();
  if (enCurso > 0) {
    cambiarPensando(-enCurso);
  }
  quitarEspera();
  quitarSugerencias();
  elLog().replaceChildren();
  delete document.body.dataset.conversacion;
  delete document.body.dataset.entrega;
  document.getElementById('volver-documentos')?.remove();
}
