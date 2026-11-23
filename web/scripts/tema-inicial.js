// Pone el tema en <html> antes del primer pintado, para que la página no parpadee al cargar.
// Es uno de los dos scripts clásicos, junto con idioma-inicial.js: va en <head> sin defer, antes de los módulos.
// La elección guardada tiene prioridad. Sin elección, todas las páginas abren en modo día, para que el sitio se vea
// igual de una página a otra sea cual sea el tema del dispositivo. Las hojas del informe siguen siendo papel claro.
// El bloque evita que sus nombres queden en el ámbito global, que comparten todos los scripts clásicos.
{
  /** La misma clave, los mismos temas y los mismos colores de barra que tema.js: un script clásico no puede importar.
   * La prueba pruebas/web-controles/controles.test.js exige que las copias coincidan y que cada color de barra sea el
   * fondo de su tema en tokens.css. */
  const CLAVE_TEMA = 'faro-tema';
  const TEMAS = ['claro', 'oscuro'];
  const TEMA_PREDETERMINADO = 'claro';
  const COLORES_DE_LA_BARRA = { claro: '#f4f3f0', oscuro: '#111317' };

  /** @returns {keyof typeof COLORES_DE_LA_BARRA | null} El tema guardado, si es uno de TEMAS. */
  const temaElegido = () => {
    try {
      const guardado = localStorage.getItem(CLAVE_TEMA);
      return guardado !== null && TEMAS.includes(guardado)
        ? /** @type {keyof typeof COLORES_DE_LA_BARRA} */ (guardado)
        : null;
    } catch {
      // Con el almacenamiento bloqueado, se aplica el mismo tema que en una primera visita.
      return null;
    }
  };

  const tema = temaElegido() ?? TEMA_PREDETERMINADO;
  document.documentElement.dataset.tema = tema;
  // La barra del navegador toma el fondo del tema en uso. Cada página declara su theme-color antes de este guion.
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', COLORES_DE_LA_BARRA[tema]);
}
