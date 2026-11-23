// La carpeta de dos documentos es la última pantalla, cuando el pensamiento de entrega ha terminado.
import { crear, porId } from '../dom.js';
import { escribir, escribirAtributo } from '../idioma.js';
import { enlaceDeLaEncuesta, invitacionGuardada } from '../invitacion.js';
import { seccionDisponible } from '../secciones.js';
import { conVersiones } from '../textos.js';
import { EVENTO_PENSANDO, faroEstaPensando } from './conversacion.js';

const TITULO = conVersiones({ es: 'Tus documentos', ca: 'Els teus documents' });
const VOLVER = conVersiones({ es: 'Volver a mis documentos', ca: 'Tornar als meus documents' });
const TAREAS = conVersiones({ es: 'Volver a las tareas', ca: 'Tornar a les tasques' });
const REPETIR = conVersiones({ es: 'Volver a realizar el recorrido', ca: 'Tornar a fer el recorregut' });
const ENCUESTA_TITULO = conVersiones({ es: 'Tu opinión sobre Faro', ca: 'La teva opinió sobre Faro' });
const ENCUESTA_TEXTO = conVersiones({
  es: 'Has llegado con una invitación del piloto. Si quieres, cuéntanos qué te ha parecido Faro: son unas pocas preguntas cerradas, se responden en un minuto y la encuesta es anónima.',
  ca: 'Has arribat amb una invitació de la prova pilot. Si vols, explica’ns què t’ha semblat Faro: són unes poques preguntes tancades, es responen en un minut i l’enquesta és anònima.',
});
const ENCUESTA_BOTON = conVersiones({ es: 'Responder la encuesta', ca: 'Respondre l’enquesta' });
/** El nombre del botón para los lectores de pantalla, que avisa de que la encuesta se abre en otra pestaña. */
const ENCUESTA_NOMBRE = conVersiones({
  es: 'Responder la encuesta (se abre en otra pestaña)',
  ca: 'Respondre l’enquesta (s’obre en una altra pestanya)',
});

/** Restablece el recorrido al volver a editar o al comenzar de nuevo. */
export function limpiarEntregaFinal() {
  delete document.body.dataset.entrega;
  document.querySelector('.rc-entrega-final')?.classList.remove('rc-entrega-final');
  document.querySelector('.rc-entrega-titulo')?.remove();
  document.querySelector('.rc-entrega-acciones')?.remove();
  document.querySelector('.rc-entrega-encuesta')?.remove();
  document.getElementById('volver-documentos')?.remove();
}

/**
 * La invitación a la encuesta, solo si la persona llegó con una invitación que sigue guardada en la pestaña y la
 * encuesta está visible en la web. Oculta, el código sigue guardado y nada la ofrece: al volver a mostrarla, el mismo
 * enlace vale. La encuesta se abre en otra pestaña con el código en el fragmento, para no perder estos documentos.
 * @returns {HTMLElement | null}
 */
function bloqueDeLaEncuesta() {
  const codigo = invitacionGuardada();
  if (codigo === null || !seccionDisponible('encuesta')) {
    return null;
  }
  const boton = escribir(
    crear('a', {
      className: 'rc-boton-principal',
      href: enlaceDeLaEncuesta(codigo),
      target: '_blank',
      rel: 'noopener',
    }),
    ENCUESTA_BOTON,
  );
  escribirAtributo(boton, 'aria-label', ENCUESTA_NOMBRE);
  return crear(
    'section',
    { className: 'rc-entrega-encuesta' },
    escribir(crear('h3', {}), ENCUESTA_TITULO),
    escribir(crear('p', { className: 'rc-entrega-encuesta-texto' }), ENCUESTA_TEXTO),
    boton,
  );
}

/** @param {HTMLElement} mensaje @param {HTMLElement} carpeta */
function mostrar(mensaje, carpeta) {
  limpiarEntregaFinal();
  mensaje.classList.add('rc-entrega-final');
  const titulo = escribir(crear('h2', { className: 'rc-entrega-titulo', tabIndex: -1 }), TITULO);
  carpeta.prepend(titulo);
  const tareas = escribir(crear('button', { type: 'button', className: 'rc-boton-secundario' }), TAREAS);
  tareas.dataset.volver = '3';
  const repetir = escribir(crear('button', { type: 'button', className: 'rc-boton-secundario' }), REPETIR);
  repetir.setAttribute('data-nueva-conversacion', '');
  carpeta.append(crear('div', { className: 'rc-entrega-acciones' }, tareas, repetir));
  const encuesta = bloqueDeLaEncuesta();
  if (encuesta) {
    carpeta.append(encuesta);
  }
  const volver = escribir(
    crear('button', { type: 'button', id: 'volver-documentos', className: 'rc-boton-secundario' }),
    VOLVER,
  );
  volver.addEventListener('click', () => {
    document.body.dataset.informe = 'oculto';
    porId('paso-4').hidden = true;
    titulo.focus({ preventScroll: true });
  });
  porId('paso-4').prepend(volver);
  document.body.dataset.entrega = 'final';
  porId('rc-conversacion').scrollTo(0, 0);
  titulo.focus({ preventScroll: true });
}

/** Espera el final de todos los pensamientos y cancela la entrega si la persona abandona el recorrido. Se abre con
 * cualquier hoja guardada (con dos cursos, con uno o sin ninguno); sin hoja, la carpeta se queda en el chat.
 * @param {{ mensaje: HTMLElement, carpeta: HTMLElement, signal: AbortSignal, cursos: number | null, hojaLista: boolean, sinEstimar: unknown[] }} opciones */
export function prepararEntregaFinal({ mensaje, carpeta, signal, cursos, hojaLista, sinEstimar }) {
  if (cursos === null || !hojaLista || sinEstimar.length !== 0) {
    return;
  }
  const quitar = () => {
    document.removeEventListener(EVENTO_PENSANDO, comprobar);
    signal.removeEventListener('abort', quitar);
  };
  const comprobar = () => {
    if (signal.aborted) {
      quitar();
    } else if (!faroEstaPensando()) {
      quitar();
      if (mensaje.isConnected && document.body.dataset.paso === '4') {
        mostrar(mensaje, carpeta);
      }
    }
  };
  document.addEventListener(EVENTO_PENSANDO, comprobar);
  signal.addEventListener('abort', quitar, { once: true });
  comprobar();
}
