// Un botón o interruptor pulsado: el sondeo del panel espera al final del gesto, sin anularlo ni encolar comprobaciones.
const CONTROLES_PULSABLES = 'button,input[type="checkbox"],input[type="radio"]';

/** El control de la pulsación, también desde un descendiente del botón o el texto de su etiqueta. @param {Event} evento */
function controlDePulsacion(evento) {
  if (!(evento.target instanceof HTMLElement)) {
    return null;
  }
  const campo = evento.target.closest(CONTROLES_PULSABLES) ?? evento.target.closest('label')?.control;
  return campo instanceof HTMLElement && campo.matches(CONTROLES_PULSABLES) ? campo : null;
}

/** Escucha los gestos de la página; solo empieza uno real cuando `puedeEmpezar()` lo permite.
 * @param {()=>boolean} puedeEmpezar */
export function vigilarGestos(puedeEmpezar) {
  /** @type {HTMLElement | null} */
  let pulsacion = null;
  const terminar = () => {
    pulsacion = null;
  };
  /** @param {Event} evento */
  const empezar = (evento) => {
    if (!evento.isTrusted || !puedeEmpezar()) {
      return;
    }
    const campo = controlDePulsacion(evento);
    if (campo && !campo.matches(':disabled')) {
      pulsacion = campo;
    }
  };
  /** Si se suelta fuera del control, no habrá una activación que esperar. @param {Event} evento */
  const soltarFuera = (evento) => {
    if (controlDePulsacion(evento) !== pulsacion) {
      terminar();
    }
  };
  /** Espacio activa al soltar; Enter suele hacerlo al pulsar. El clic nativo termina ambos gestos.
   * @param {KeyboardEvent} evento */
  const pulsarTecla = (evento) => {
    if (evento.key === ' ' || evento.key === 'Enter') {
      empezar(evento);
    } else {
      terminar();
    }
  };
  document.addEventListener('pointerdown', (evento) => evento.button === 0 && empezar(evento), true);
  document.addEventListener('keydown', pulsarTecla, true);
  document.addEventListener('pointerup', soltarFuera, true);
  document.addEventListener('keyup', soltarFuera, true);
  for (const nombre of ['click', 'pointercancel', 'dragstart']) {
    document.addEventListener(nombre, terminar, true);
  }
  document.addEventListener('focusout', (evento) => evento.target === pulsacion && terminar());
  window.addEventListener('blur', terminar);
  return { enCurso: () => pulsacion !== null, terminar };
}
