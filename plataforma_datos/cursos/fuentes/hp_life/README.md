# HP LIFE: actualización de negocio y condiciones generales

Generado de `fuente.json`; editar el descriptor y regenerar.

Productor del catálogo Cursos: recepción pública y control propios, conservación de hechos y preparación de la única SQLite compartida; la entrega final usa admisión, proyección y publicación comunes.

ID: `hp_life` · tema: `cursos` · institución: HP LIFE.
Lector estático: `plataforma_datos.cursos.fuentes.hp_life.lector`. Casa de datos: `hp_life`.

## Alcance

- Recorre el índice público (`/es/allcourses?page=N`) hasta cubrir el total que declara: un censo completo es el que suman sus páginas consecutivas sin repetir ningún curso; con cualquier otra forma el censo es parcial y no concluye nada sobre ausencias. Un curso del índice desconocido para el catálogo, de un idioma que la fuente admite (es), entra como alta con su ficha íntegra y la página del índice que lo lista; los demás idiomas quedan vistos en el censo, sin alta. Un curso conocido que el censo completo no lista se retira solo si su ficha lo corrobora (404, 410 o la página de error 500 de la aplicación) y más de la mitad de las fichas de los cursos del listado respondieron bien en la misma consulta (así se da por sano el servidor); con su ficha íntegra sigue vigente y la discrepancia llega al panel; cualquier otra respuesta no cambia nada y el panel recibe un aviso. Cada consulta pide también la ayuda en español (`/es/help`): si su declaración de gratuidad falta, no se puede leer o ha cambiado de texto, es un fallo de método (`gratuidad-de-hp-life-sin-comprobar`): las comprobaciones de los cursos de esa consulta quedan como fallos, la oferta conserva lo último comprobado y no se renueva, y no se afirma que los cursos sean de pago ni gratuitos. Un curso que no se puede leer deja un único pendiente, sustituido en cada consulta, con la fecha de la primera y de la última vez. Consulta secuencialmente las URLs de fichas conocidas y de altas y lee html_next, json_next y extractos históricos curso_observado. Las condiciones generales y los dos scripts de inscripción conservan sus pruebas y fechas independientes; no se rejuvenecen al consultar una ficha.
- Conserva identidad nativa, código, título, idioma declarado y body íntegro. Estado, privacidad, tipo, fechas, duración y requisitos se conservan sin inferir disponibilidad, horas, elegibilidad, producto o coste de práctica.
- Separa hash del cuerpo y de respuesta original; recibido_utc y fecha_declarada_utc no se sustituyen. HTTP desconocido solo se acepta en observados sin recepción atribuida ni original conservado.
- Las condiciones generales de FAQ no rellenan requisitos individuales o destinatarios específicos del curso. No explora lecciones protegidas ni acredita idioma íntegro del material por idioma de ficha.

## Recursos y condiciones de uso

- `fichas` (familia): Familia de URLs de curso para validar identidad nativa e idioma. Next es formato de captura observado, no una API oficial configurada.
  Ubicación: https://www.life-global.org/{idioma}/course/{id}-{slug}. Licencia: desconocida; no acreditada por este descriptor.
- `indice` (familia): Páginas del listado público de cursos: lista `initialCourses` y total `totalCourses` en los datos de la página. Acreditan que un curso existe; no acreditan su apertura ni su ausencia salvo con el censo completo.
  Ubicación: https://www.life-global.org/es/allcourses?page={n}. Licencia: desconocida; no acreditada por este descriptor.
- `faq` (url): Ayuda en español, consultada cada día: su encabezado «Los cursos de HP LIFE son gratuitos» y el párrafo que lo dirige a todas las personas son la declaración de gratuidad que se controla (`gratuidad.py`). También aporta declaraciones generales de registro, certificación y destinatario.
  Ubicación: https://www.life-global.org/es/help. Licencia: desconocida; no acreditada por este descriptor.
- `capturas` (familia): Cuerpo y CapturaHpLife explícitos, incluidos derivados históricos con su alcance original; sin lectura de rutas locales.
  Ubicación: desconocida. Licencia: desconocida; no acreditada por este descriptor.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `entrada-local` (local): Parser puro de capturas históricas; el canal remoto usa la operación común declarada y conserva su propia recepción.
  Recursos: fichas, faq, capturas. Autenticación: La lectura de capturas locales no usa credenciales ni acredita una consulta nueva.
  - Integridad del cuerpo suministrado no acredita exhaustividad del sitio o autenticidad del original remoto.
  - Una fecha histórica declarada no se convierte en recepción nueva ni en vigencia actual.
  - Campos opcionales ausentes quedan desconocidos; Published/Public/SelfPaced no se promueven a oferta disponible.
- `consulta-publica` (remoto): Operación declarada en el ciclo común, con salud y recibo por fuente; la extracción conserva campos y desconocidos propios.
  Recursos: fichas, indice, faq. Autenticación: Ninguna. Sin cuentas, cookies, claves, login, CAPTCHA o bypass.
  - Transporte e identidad comunes; serie y al menos dos segundos por dominio.
  - Identidades conocidas o acreditadas por el índice, sin convertir HTTP200 o mera presencia en acceso confirmado.

## Operación actual

Política: `diaria`. Consulta red: sí.
Frecuencia declarada: Consulta cada día el índice público de cursos, la página de ayuda con la declaración de gratuidad y las fichas de las identidades conocidas y de las altas que el índice acredita; no declara publicación mensual ni renueva pruebas históricas. Aviso de renovación: 1 días.
Originales: `hp_life`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| hp_life | cambiante | contenido-actual-acotado | descargar | 1 |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: ninguna declarada.
Contratos y controles: lector.py:CapturaHpLife, lector.py:extraer_ficha, lector.py:extraer_condiciones_generales, gratuidad.py, pendientes.py, contrato-lectura.md, plataforma_datos/cursos/pruebas/test_lectura_hp_life.py, plataforma_datos/cursos/operacion_fuente.py, plataforma_datos/cursos/componer_catalogo.py.

Retirada: Una página del índice caída o mal formada deja el censo parcial: no da bajas. Un curso se retira solo por el listado completo corroborado por su ficha. Un error de transporte no da de baja ni renueva la última comprobación. Solo una respuesta identificada contraria participa como hecho nuevo; una ausencia sin censo acreditado no borra entidades ni historia.

Conservación: Cuerpos deduplicados por SHA y recibos inmutables por consulta. Fechas de recepción, revisión e ingestión separadas. La composición final conserva la instantánea de una fuente fallida y promueve conjuntamente SQLite, recurso y referencia; sin limpieza automática.

## Reproducción

```sh
python -m plataforma_datos.cursos.fuentes.hp_life.lector preparar
python -m plataforma_datos.cursos.fuentes.hp_life.lector validar
python -m plataforma_datos.contratos.fuentes --fuente hp_life --tema cursos --comprobar
```
