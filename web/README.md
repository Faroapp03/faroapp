# Interfaz web y PWA

Las páginas HTML, los estilos y los módulos de interfaz se mantienen aquí. Los textos traducibles viven en
`idiomas/`; el recorrido se comunica con el motor del dispositivo mediante su trabajador.

| Carpeta | Contenido |
| --- | --- |
| `scripts/`, `estilos/`, `idiomas/` | Interacción, presentación y textos de la interfaz. |
| `administracion/` | Interfaz del panel, servida únicamente con sus controles de acceso. |
| `datos/`, `recursos/` | Recursos públicos admitidos para las páginas. `recursos/catalogo-cursos/lector.js` se genera con `node herramientas/web/catalogo-cursos.ts` y no se edita. |
| `imagenes/`, `tipografias/`, `terceros/` | Material gráfico y bibliotecas con sus condiciones de uso. |

El motor empaquetado (`motor/`), el paquete de datos (`paquete/`), el manifiesto del dispositivo
(`firmas/manifiesto.json`) y el service worker publicado (`service-worker.js`) no están en esta carpeta: los escribe
la construcción en la web construida (`.web-local/web` o `dist/web`). Las fuentes del service worker están en
`src/service-worker/` y sus listas de archivos con huella las genera la construcción; no se corrigen huellas a mano.
La [guía de construcción](../docs/construccion-web.md) explica las fuentes,
los generadores, la política de caché y las comprobaciones.

`.assetsignore` delimita lo publicable y excluye esta documentación. La construcción produce `dist/` y
comprueba sus referencias antes de promoverlo. Los almacenes privados, registros de mantenimiento y secretos
no pertenecen a esta carpeta ni a la copia sin conexión.
