// Cómo se mueve y se usa el globo: arrastrar gira, pulsar elige, las flechas y + y − mueven el globo con el foco en él,
// los mandos hacen lo mismo sin teclado ni arrastre (WCAG 2.5.7), y su centro vuelve al país elegido; Escape en la
// ficha devuelve el foco. Aquí solo se traducen los eventos en acciones; qué hace cada una lo decide globo.js. Nada
// sigue moviéndose al soltar: sin inercia, y ningún giro se anima, así que no hay movimiento que reducir.

import { acercar, arrastrar, girar, PASO_DE_GIRO_GRADOS } from './esfera.js';

/** Lo que se puede mover el puntero sin que deje de ser una pulsación, en píxeles de CSS. */
const UMBRAL_DE_ARRASTRE_PX = 4;
/** Las teclas que mueven el globo cuando tiene el foco, con su acción. */
const TECLAS = Object.freeze({
  ArrowLeft: 'izquierda',
  ArrowRight: 'derecha',
  ArrowUp: 'arriba',
  ArrowDown: 'abajo',
  '+': 'acercar',
  '=': 'acercar',
  '-': 'alejar',
});
/** Cada giro de los mandos, en pasos de longitud y de latitud: a la izquierda se ve lo que queda al oeste. */
const GIROS = Object.freeze(
  /** @type {const} */ ({ izquierda: [-1, 0], derecha: [1, 0], arriba: [0, 1], abajo: [0, -1] }),
);

/**
 * Un punto del puntero en la ventana.
 * @typedef {{ clientX: number, clientY: number }} Puntero
 */
/**
 * Lo que la interacción pide al globo.
 * @typedef {Object} Controles
 * @property {() => import('./esfera.js').Vista} vista la de ahora
 * @property {(ancho: number, alto: number, zoom: number) => number} radio píxeles por radián de lo que se ve (el radio
 *   del globo o el del mapa plano), para que la superficie siga al puntero al arrastrar
 * @property {(vista: import('./esfera.js').Vista) => void} mover pone otra y pide pintarla
 * @property {(puntero: Puntero) => void} pulsar una pulsación sin arrastre
 * @property {(puntero: Puntero) => boolean} sobreDatos si bajo el puntero hay un territorio con datos
 * @property {() => boolean} volver Escape en la ficha: devuelve el foco a lo que eligió el país y dice si lo ha hecho
 * @property {() => void} centrar «Volver a mi país»: pone el territorio elegido en el centro, con el mismo acercamiento
 */
/**
 * Un arrastre en curso: el puntero, dónde estaba en el último movimiento, dónde empezó y si ya gira el globo.
 * @typedef {Object} Arrastre
 * @property {number} id
 * @property {number} ultimoX
 * @property {number} ultimoY
 * @property {number} desdeX
 * @property {number} desdeY
 * @property {boolean} girando
 */

/**
 * Si un evento de teclado es una de las teclas del globo.
 * @param {string} tecla @returns {tecla is keyof typeof TECLAS}
 */
function esTeclaDelGlobo(tecla) {
  return Object.hasOwn(TECLAS, tecla);
}

/**
 * Un movimiento del puntero: sin arrastre, el cursor de mano sale solo sobre los territorios con datos; con él, a
 * partir del umbral, la superficie sigue al puntero.
 * @param {HTMLCanvasElement} lienzo @param {Controles} controles @param {Arrastre | null} arrastre
 * @param {PointerEvent} evento
 */
function alMover(lienzo, controles, arrastre, evento) {
  if (!arrastre || arrastre.id !== evento.pointerId) {
    lienzo.classList.toggle('globo-lienzo--con-datos', controles.sobreDatos(evento));
    return;
  }
  const recorrido = Math.hypot(evento.clientX - arrastre.desdeX, evento.clientY - arrastre.desdeY);
  arrastre.girando ||= recorrido > UMBRAL_DE_ARRASTRE_PX;
  if (!arrastre.girando) {
    return;
  }
  const caja = lienzo.getBoundingClientRect();
  const vista = controles.vista();
  const radio = controles.radio(caja.width, caja.height, vista.zoom);
  controles.mover(arrastrar(vista, evento.clientX - arrastre.ultimoX, evento.clientY - arrastre.ultimoY, radio));
  arrastre.ultimoX = evento.clientX;
  arrastre.ultimoY = evento.clientY;
}

/**
 * Arrastrar gira el globo y pulsar elige; el puntero se captura para que el arrastre siga aunque salga del lienzo.
 * @param {HTMLCanvasElement} lienzo @param {Controles} controles @param {AbortSignal} signal
 */
function escucharPuntero(lienzo, controles, signal) {
  /** @type {Arrastre | null} */
  let arrastre = null;
  const reiniciar = () => {
    arrastre = null;
  };
  const alPulsar = (/** @type {PointerEvent} */ evento) => {
    if (evento.button !== 0) {
      return;
    }
    const { pointerId: id, clientX: ultimoX, clientY: ultimoY } = evento;
    arrastre = { id, ultimoX, ultimoY, desdeX: ultimoX, desdeY: ultimoY, girando: false };
    lienzo.setPointerCapture(id);
  };
  const alSoltar = (/** @type {PointerEvent} */ evento) => {
    if (arrastre?.id === evento.pointerId && !arrastre.girando) {
      controles.pulsar(evento);
    }
    reiniciar();
  };
  lienzo.addEventListener('pointerdown', alPulsar, { signal });
  lienzo.addEventListener('pointermove', (evento) => alMover(lienzo, controles, arrastre, evento), { signal });
  lienzo.addEventListener('pointerup', alSoltar, { signal });
  lienzo.addEventListener('pointercancel', reiniciar, { signal });
}

/**
 * La vista tras una acción de giro o de acercamiento de los mandos o del teclado.
 * @param {import('./esfera.js').Vista} vista @param {Exclude<import('./panel.js').Accion, 'centrar'>} accion
 * @returns {import('./esfera.js').Vista}
 */
function vistaTras(vista, accion) {
  if (accion === 'acercar') {
    return acercar(vista, 1);
  }
  if (accion === 'alejar') {
    return acercar(vista, -1);
  }
  const [longitud, latitud] = GIROS[accion];
  return girar(vista, longitud * PASO_DE_GIRO_GRADOS, latitud * PASO_DE_GIRO_GRADOS);
}

// ---------- Lo público ----------

/**
 * Escucha el puntero y las teclas del lienzo, los mandos y Escape en todo el globo, hasta que `signal` se aborta.
 * @param {import('./panel.js').Partes} partes @param {Controles} controles @param {AbortSignal} signal
 */
export function escuchar({ raiz, lienzo, mandos }, controles, signal) {
  escucharPuntero(lienzo, controles, signal);
  const moverCon = (/** @type {Exclude<import('./panel.js').Accion, 'centrar'>} */ accion) =>
    controles.mover(vistaTras(controles.vista(), accion));
  lienzo.addEventListener(
    'keydown',
    (evento) => {
      // Con Ctrl, Cmd o Alt la tecla es del navegador (Ctrl/Cmd y + o − cambian el zoom de la página): no se toca.
      if (evento.ctrlKey || evento.metaKey || evento.altKey || !esTeclaDelGlobo(evento.key)) {
        return;
      }
      evento.preventDefault();
      moverCon(TECLAS[evento.key]);
    },
    { signal },
  );
  for (const [accion, boton] of mandos) {
    const alPulsar = accion === 'centrar' ? () => controles.centrar() : () => moverCon(accion);
    boton.addEventListener('click', alPulsar, { signal });
  }
  raiz.addEventListener(
    'keydown',
    (evento) => {
      if (evento.key === 'Escape' && controles.volver()) {
        evento.preventDefault();
      }
    },
    { signal },
  );
}
