// Los desplegables nativos (<details>) de la web: abrirlos cuando un enlace o un fragmento de la dirección señala algo de
// su interior, y abrirlos todos al imprimir. Sin JavaScript, el <details> se abre igual con el ratón o el teclado. Sin
// animación, sin red ni almacenamiento. Lo usan Datos globales (scripts/datos-globales/paginacion.js) y las referencias
// de las guías (scripts/desplegables-de-pagina.js).

/** Un fragmento que se puede buscar con un selector de identificador. */
const FRAGMENTO_VALIDO = /^[\w-]+$/;

/** El fragmento de la dirección actual, sin la almohadilla; vacío si no es un identificador simple. @returns {string} */
function fragmentoActual() {
  const fragmento = (globalThis.location?.hash ?? '').replace(/^#/, '');
  return FRAGMENTO_VALIDO.test(fragmento) ? fragmento : '';
}

/**
 * Abre los desplegables que son el destino del fragmento o lo contienen.
 * @param {readonly HTMLElement[]} desplegables los `<details>` de la página @param {string} fragmento sin almohadilla
 * @returns {HTMLElement[]} los que estaban cerrados y se han abierto
 */
export function abrirLosQueContienen(desplegables, fragmento) {
  if (!FRAGMENTO_VALIDO.test(fragmento)) {
    return [];
  }
  const abiertos = [];
  for (const desplegable of desplegables) {
    const seccion = desplegable.closest('section');
    const contiene =
      desplegable.id === fragmento || seccion?.id === fragmento || desplegable.querySelector(`#${fragmento}`);
    if (contiene && !desplegable.hasAttribute('open')) {
      desplegable.setAttribute('open', '');
      abiertos.push(desplegable);
    }
  }
  return abiertos;
}

/**
 * Abre el desplegable (Método, Fuentes) que contiene lo que señala el fragmento de la dirección, al cargar y cada vez
 * que cambia: un enlace a «#datos-globales-metodo» o a algo de dentro lo deja a la vista. Sin JavaScript, el
 * `<details>` nativo se abre igual con el ratón o el teclado.
 * @param {HTMLElement[]} desplegables los `<details>` de la página @returns {void}
 */
export function abrirDesplegablesDelFragmento(desplegables) {
  const abrir = () => {
    abrirLosQueContienen(desplegables, fragmentoActual());
  };
  abrir();
  globalThis.addEventListener?.('hashchange', abrir);
}

/**
 * Lleva la vista y el foco a lo que señala el fragmento, una vez abierto su desplegable: un salto de una sola vez, sin
 * desplazamiento suave. El destino recibe el foco sin mover la vista otra vez.
 * @param {string} fragmento sin almohadilla @returns {void}
 */
function llevarAlDestino(fragmento) {
  const destino = document.getElementById(fragmento);
  if (!destino) {
    return;
  }
  destino.scrollIntoView({ block: 'start', behavior: 'instant' });
  if (!destino.hasAttribute('tabindex') && destino.tabIndex < 0) {
    destino.setAttribute('tabindex', '-1');
  }
  destino.focus({ preventScroll: true });
}

/**
 * Las referencias de las guías: al cargar con `#ref-N`, al cambiar el fragmento y al pulsar una cita (`a[href^="#ref-"]`),
 * abre el desplegable que contiene el destino y, si estaba cerrado, lleva la vista y el foco al destino. En Chrome el
 * navegador ya lo hace; en Safari y Firefox, no.
 * @param {readonly HTMLElement[]} desplegables los `<details>` de la página @returns {void}
 */
export function abrirDesplegablesAlSeguirEnlaces(desplegables) {
  const seguir = () => {
    const fragmento = fragmentoActual();
    if (abrirLosQueContienen(desplegables, fragmento).length > 0) {
      llevarAlDestino(fragmento);
    }
  };
  seguir();
  globalThis.addEventListener?.('hashchange', seguir);
  document.addEventListener('click', (evento) => {
    const cita = evento.target instanceof Element ? evento.target.closest('a[href^="#ref-"]') : null;
    if (cita) {
      // Abierto aquí, el desplegable ya es visible cuando el navegador salta al destino.
      abrirLosQueContienen(desplegables, (cita.getAttribute('href') ?? '').slice(1));
    }
  });
}

/**
 * Al imprimir, abre todos los desplegables y, al terminar, deja cada uno como estaba: lo que la persona había abierto
 * sigue abierto. No depende de `::details-content`, que no está en todos los navegadores.
 * @param {readonly HTMLElement[]} desplegables los `<details>` de la página @returns {void}
 */
export function abrirDesplegablesAlImprimir(desplegables) {
  /** @type {HTMLElement[]} */
  let abiertosPorLaImpresion = [];
  globalThis.addEventListener?.('beforeprint', () => {
    abiertosPorLaImpresion = desplegables.filter((desplegable) => !desplegable.hasAttribute('open'));
    for (const desplegable of abiertosPorLaImpresion) {
      desplegable.setAttribute('open', '');
    }
  });
  globalThis.addEventListener?.('afterprint', () => {
    for (const desplegable of abiertosPorLaImpresion) {
      desplegable.removeAttribute('open');
    }
    abiertosPorLaImpresion = [];
  });
}
