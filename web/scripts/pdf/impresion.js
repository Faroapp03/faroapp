// La impresión conserva su vía nativa y restaura el estado temporal incluso al sustituir o borrar el informe.

/**
 * Presta el título y el idioma del informe solo mientras se prepara la impresión. Los apartados de consulta, los únicos
 * desplegables del informe, no se imprimen (informe-breve.css): se quedan como estén.
 * Los eventos no indican si se guardó un PDF, se imprimió o se canceló el diálogo.
 * @param {HTMLElement} raiz
 * @param {AbortSignal} signal Vida del informe que contiene estas escuchas.
 */
export function prepararImpresion(raiz, signal) {
  if (signal.aborted) {
    return;
  }
  /** @type {{titulo: string, idioma: string} | null} */
  let anterior = null;
  const abrir = () => {
    // La hoja de ruta de formación se imprime por separado: no prestarle los metadatos del informe laboral.
    if (anterior !== null || document.documentElement.classList.contains('imprimir-hoja')) {
      return;
    }
    anterior = { titulo: document.title, idioma: document.documentElement.lang };
    const informe = raiz.matches('[data-titulo-pdf]') ? raiz : raiz.querySelector('[data-titulo-pdf]');
    document.title = informe?.getAttribute('data-titulo-pdf') || anterior.titulo;
    document.documentElement.lang = informe?.getAttribute('lang') || anterior.idioma;
  };
  const restaurar = () => {
    if (anterior === null) {
      return;
    }
    document.title = anterior.titulo;
    document.documentElement.lang = anterior.idioma;
    anterior = null;
  };
  window.addEventListener('beforeprint', abrir, { signal });
  window.addEventListener('afterprint', restaurar, { signal });
  signal.addEventListener('abort', restaurar, { once: true });
}
