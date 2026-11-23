# Hojas del informe

El recorrido carga estas hojas con `media="print"`, para no bloquear el pintado, y
`web/scripts/recorrido/paso-informe.js` las activa a la vez al pedir el informe (las marca `data-hoja-informe`).
La presentación laboral vigente se genera en `src/presentacion/informe-breve.ts` y
`src/presentacion/informe-breve/`, con `web/estilos/informe-breve.css`. El ejemplo público (`web/informe-ejemplo.html`)
enlaza `como-lo-sabemos-y-cierre.css` y esa hoja, en el mismo orden, sin `media`: no carga `pantallas-e-impresion.css`
porque `informe-breve.css` ya oculta al imprimir todo lo que no es el informe en su página propia y conserva en papel los
colores del informe (`print-color-adjust: exact`), también donde solo se carga esa hoja.
Las clases y el orden de carga forman parte de la presentación y no se renombran sin revisar sus consumidores.

**El orden de las hojas es el de la cascada.** El recorrido las enlaza en el orden de esta lista, seguidas de
`web/estilos/informe-breve.css`, que gana a una regla igual de específica de estas hojas. Una hoja nueva se enlaza en
su sitio y entra en la copia sin conexión (`ARCHIVOS`, que `herramientas/web/copia-sin-conexion.ts` calcula desde lo
publicado en `web/`). El `service-worker.js` de la web construida no está en el repositorio: `npm run web:preparar` lo
genera desde `src/service-worker/` con esas listas y actualiza y comprueba sus huellas.

- `como-lo-sabemos-y-cierre.css`: Los desplegables del método del informe breve («Detalle de todas las tareas» y los
  contextos de los datos), con sus tablas y listas, y los botones del cierre: imprimir o guardar en PDF, borrar y
  empezar de nuevo.
- `pantallas-e-impresion.css`: Las tablas del método por debajo de 640 px y la impresión del navegador en A4: oculta la
  cabecera, el menú, el pie y los botones, y conserva en el PDF etiquetado lo que solo oyen los
  lectores de pantalla. El papel blanco y la tinta oscura de cualquier página impresa, sea cual sea el tema de la pantalla, los fija `base-adaptaciones.css`. El informe laboral se guarda en PDF mediante la misma impresión nativa: sus dos hojas y sus apartados de consulta, en las páginas A4 que necesite.
