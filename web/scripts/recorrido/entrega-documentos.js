// Presentación de las tarjetas finales; las acciones conservan sus controles y comportamientos.
import { crear } from '../dom.js';
import { escribir } from '../idioma.js';
import { conVersiones } from '../textos.js';

const EDICION = {
  informe: conVersiones({ es: 'Trabajo e IA', ca: 'Feina i IA' }),
  plan: conVersiones({ es: 'Aprendizaje', ca: 'Aprenentatge' }),
};

/** Añade una portada decorativa a una tarjeta del documento real.
 * @param {HTMLElement} tarjeta @param {'informe'|'plan'} tipo */
export function presentarDocumento(tarjeta, tipo) {
  tarjeta.classList.add('rc-documento-entrega');
  tarjeta.querySelector('.rc-doc-vista')?.remove();
  tarjeta.querySelector('.rc-doc-icono')?.remove();
  tarjeta
    .querySelector('.rc-doc-cabeza')
    ?.prepend(
      crear('span', { className: 'rc-doc-numero', textContent: tipo === 'informe' ? '01' : '02', ariaHidden: 'true' }),
    );
  tarjeta.prepend(
    crear(
      'div',
      { className: `rc-doc-portada rc-doc-portada-${tipo}`, ariaHidden: 'true' },
      crear('span', { className: 'rc-doc-marca', textContent: 'FARO' }),
      crear('span', { className: 'rc-doc-signo', textContent: tipo === 'informe' ? 'IA' : '+' }),
      escribir(crear('span', { className: 'rc-doc-edicion' }), EDICION[tipo]),
    ),
  );
  return tarjeta;
}
