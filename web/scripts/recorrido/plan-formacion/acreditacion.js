// La persona elige, o deja para otro momento, un certificado relacionado que constaba en su informe.
import { crear } from '../../dom.js';
import { escribir, escribirAtributo } from '../../idioma.js';
import { conVersiones } from '../../textos.js';

/** @import { AcreditacionPlan, IdiomaPlan } from './contrato.js' */
const TEXTOS = {
  titulo: { es: '¿Quieres incluir una acreditación relacionada?', ca: 'Vols incloure una acreditació relacionada?' },
  ayuda: {
    es: 'Consulta los requisitos y solicita orientación. La agencia evalúa las competencias.',
    ca: 'Consulta els requisits i demana orientació. L’agència avalua les competències.',
  },
  ocupacion: { es: 'Relacionada con tu ocupación', ca: 'Relacionada amb la teva ocupació' },
  grupo: { es: 'Relacionada con tu grupo', ca: 'Relacionada amb el teu grup' },
  codigo: { es: 'Código', ca: 'Codi' },
  omitir: { es: 'Ahora no', ca: 'Ara no' },
  tramite: { es: 'Consultar el trámite oficial', ca: 'Consultar el tràmit oficial' },
};
/** @param {keyof typeof TEXTOS} clave */
const t = (clave) => conVersiones(TEXTOS[clave]);
/** @param {string} direccion */
function tramiteOficial(direccion) {
  try {
    const url = new URL(direccion);
    return (
      url.protocol === 'https:' &&
      url.hostname === 'tramits.gencat.cat' &&
      !url.username &&
      !url.password &&
      url.pathname.endsWith('/21900_Acreditat')
    );
  } catch {
    return false;
  }
}
/** @param {AcreditacionPlan} opcion @param {(valor:AcreditacionPlan|null)=>void} terminar */
function tarjeta(opcion, terminar) {
  const codigo = escribir(
    crear('span', { className: 'rc-acreditacion-codigo' }),
    conVersiones({ es: `${TEXTOS.codigo.es}: ${opcion.codigo}`, ca: `${TEXTOS.codigo.ca}: ${opcion.codigo}` }),
  );
  const contenido = crear(
    'span',
    { className: 'rc-acreditacion-contenido' },
    crear('span', { className: 'rc-acreditacion-nombre', textContent: opcion.nombre }),
    codigo,
    escribir(crear('span', { className: 'rc-acreditacion-relacion' }), t(opcion.relacion)),
  );
  const boton = crear(
    'button',
    { type: 'button', className: 'rc-acreditacion-opcion' },
    contenido,
    crear('span', { className: 'rc-acreditacion-flecha', ariaHidden: 'true', textContent: '→' }),
  );
  boton.addEventListener('click', () => terminar(opcion));
  return boton;
}
/** @param {AcreditacionPlan[]} opciones @param {IdiomaPlan} _idioma @param {AbortSignal} signal */
export function crearEleccionAcreditacion(opciones, _idioma, signal) {
  const nodo = crear('section', { className: 'rc-acreditaciones' });
  escribirAtributo(nodo, 'aria-label', t('titulo'));
  const titulo = escribir(crear('h3', { tabIndex: -1 }), t('titulo'));
  nodo.append(titulo, escribir(crear('p'), t('ayuda')));
  /** @type {(valor:AcreditacionPlan|null)=>void} */ let resolver = () => {};
  /** @type {Promise<AcreditacionPlan|null>} */
  const respuesta = new Promise((resolve) => {
    resolver = resolve;
  });
  let terminada = false;
  /** @param {AcreditacionPlan|null} valor */
  const terminar = (valor) => {
    if (terminada) {
      return;
    }
    terminada = true;
    signal.removeEventListener('abort', cancelar);
    nodo.remove();
    resolver(valor);
  };
  const cancelar = () => terminar(null);
  for (const opcion of opciones) {
    nodo.append(tarjeta(opcion, terminar));
  }
  const acciones = crear('div', { className: 'rc-acreditacion-acciones' });
  const omitir = escribir(crear('button', { type: 'button', className: 'rc-boton-secundario' }), t('omitir'));
  omitir.addEventListener('click', () => terminar(null));
  acciones.append(omitir);
  const tramite = opciones[0]?.tramite;
  if (tramite && tramiteOficial(tramite)) {
    acciones.append(
      escribir(crear('a', { href: tramite, target: '_blank', rel: 'noopener noreferrer' }), t('tramite')),
    );
  }
  nodo.append(acciones);
  if (signal.aborted) {
    cancelar();
  } else {
    signal.addEventListener('abort', cancelar, { once: true });
  }
  return { nodo, titulo, respuesta };
}
