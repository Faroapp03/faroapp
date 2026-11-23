# Fotografías de la web

Todas las fotografías proceden de Unsplash, de las páginas enlazadas, donde figuran como gratuitas bajo la
[licencia de Unsplash](https://unsplash.com/license). La licencia permite usarlas y modificarlas, también con fines
comerciales; el crédito es voluntario y Faro lo incluye en «Créditos» (`creditos.html#t-imagenes`). No se usa ninguna
imagen de Unsplash+.

| Archivo | Autoría y fuente | Uso |
|---|---|---|
| `imagenes/fotografias/faro-penmon.webp` | [Neil Thomas](https://unsplash.com/photos/lighthouse-on-shallow-water-DS7joWZ-F_Y). Faro de Trwyn Du, Penmon (Gales). | Portada de inicio y del informe. |
| `imagenes/fotografias/faro-portland.webp` | [Mitch Mckee](https://unsplash.com/photos/lighthouse-beside-body-of-water-under-blue-sky-sGnWRF9cJZE). Portland Head Light, Cape Elizabeth (Estados Unidos). | Acceso y cabecera de «Qué es Faro». |
| `imagenes/fotografias/trabajo.webp` | [Vitaly Gariev](https://unsplash.com/photos/hands-typing-on-a-laptop-keyboard-at-a-desk-lMScFOdgRNg). | Acceso y cabecera de «Qué es la IA». |
| `imagenes/fotografias/aprendizaje.webp` | [Ryunosuke Kikuno](https://unsplash.com/photos/a-pen-sitting-on-top-of-a-notebook-on-a-desk-viEzuL1ouDs). | Acceso a «Cómo funciona». |

Cada imagen tiene una versión de 800 px (`-800.webp`) y otra de mayor resolución; el navegador elige con `srcset`.
La fotografía de Penmon se ha retocado para retirar la inscripción pintada sobre la franja clara del faro,
reconstruyendo el color, la textura y la iluminación de la pared. La edición aprobada de 1536 × 1024 px se ha
remuestreado a 1800 × 1200 px y 800 × 533 px y convertido a WebP; el remuestreo no añade detalle original.
Las otras fotografías solo se han redimensionado y convertido a WebP. Los encuadres y las capas de contraste
se aplican con CSS.

El favicon y los iconos de la aplicación (`imagenes/identidad/`) son la marca de Faro: una F con un trazo horizontal
encima, como un haz de luz, sin brillos ni degradados.

La portada pública y su formulario de acceso incorporan una copia autocontenida de la fotografía de Penmon
retocada indicada arriba. El encuadre se adapta con CSS.
