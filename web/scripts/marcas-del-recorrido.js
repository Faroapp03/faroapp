// La marca de una conversación iniciada por la persona, compartida por el recorrido y la instalación.
// Un saludo de Faro no cuenta como conversación que se perdería al salir o actualizar. El nombre está en plural porque
// aquí van las marcas del recorrido que comparten varios módulos; hoy es una sola.

const MENSAJE_DE_LA_PERSONA = '#conversacion .rc-mensaje[data-autor="persona"]';

/** Si la persona ya ha enviado un mensaje en esta página. @returns {boolean} */
export function hayMensajeDeLaPersona() {
  return Boolean(document.querySelector(MENSAJE_DE_LA_PERSONA));
}
