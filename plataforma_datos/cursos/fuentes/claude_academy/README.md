# Claude Academy: actualización y oferta publicada continua

Generado de `fuente.json`; editar el descriptor y regenerar.

Productor del catálogo Cursos: recepción pública y control propios, conservación de hechos y preparación de la única SQLite compartida; la entrega final usa admisión, proyección y publicación comunes.

ID: `claude_academy` · tema: `cursos` · institución: Anthropic / Claude Academy.
Lector estático: `plataforma_datos.cursos.fuentes.claude_academy.lector`. Casa de datos: `claude_academy`.

## Alcance

- Contrasta identidad de curso, URL exacta, canonical, título, h1 y slug cuando corresponde; exige HTTP 200 declarado, captura completa, bytes y SHA coincidentes, UTC y cierre documental.
- Conserva secuencia íntegra del main, bloques, enlaces y declaraciones explícitas de requisitos/destinatarios; ausencia de coincidencia queda desconocida, no significa ausencia de requisito.
- La lectura de una ficha pública no acredita contenido íntegro de lecciones protegidas, idioma completo del curso, licencia, acceso personal, disponibilidad ni una conexión remota configurada.
- El módulo registrado conserva índice, declaración y primera lección por separado; descubrimiento no implica admisión, matrícula ni publicación.
- La composición común aplica altas y cambios a la instantánea nativa y evalúa la regla versionada de oferta continua; ningún booleano de investigación se convierte por sí solo en oferta.
- Contrasta condiciones comerciales específicas de ficha: precio/inscripción, contexto de complementos, compra y metadatos Course/Offer identificados; una contradicción o condición pertinente no resuelta no se tapa con la declaración general gratuita. Los ámbitos HTML con una identidad explícita ajena se conservan como originales, pero sus precios y cierres no deciden la disponibilidad de esta ficha.
- La inscripción, el progreso y las acreditaciones se contrastan con FAQ y enlace de login propio; no se afirma que una cuenta sea necesaria para leer todo el material. La modalidad procede del CourseInstance de la identidad exacta. El fallo auxiliar no impide renovar fichas: conserva la última FAQ válida con su fecha y caducidad propias; una FAQ cambiada o vencida deja inscripción desconocida. La vigencia de inscripción es independiente de la disponibilidad del curso.

## Recursos y condiciones de uso

- `fichas` (familia): Familia de fichas HTML cuya identidad valida el lector; la plantilla es una familia, no una URL consultada por este componente.
  Ubicación: https://academy.claude.com/courses/{slug}. Licencia: desconocida; no acreditada por este descriptor.
- `captura` (familia): Bytes HTML y metadatos suministrados por el llamador; no se versionan páginas completas. Los fragmentos mínimos de contrato de las pruebas se identifican y no se presentan como nuevas consultas.
  Ubicación: desconocida. Licencia: desconocida; no acreditada por este descriptor.
- `indice-publico` (url): Descubrimiento de URLs nativas; ausencia del índice no acredita retirada.
  Ubicación: https://academy.claude.com/courses. Licencia: desconocida; no acreditada por este descriptor.
- `declaracion-publica` (url): Declaración completa del proveedor sobre gratuidad de formación, distinta de prácticas o productos.
  Ubicación: https://academy.claude.com/. Licencia: desconocida; no acreditada por este descriptor.
- `primera-leccion` (familia): Destino Start course del mismo curso; solo su texto didáctico se contrasta sin cuenta. No garantiza acceso al resto, vídeo, quiz o badge.
  Ubicación: desconocida. Licencia: desconocida; no acreditada por este descriptor.
- `faq-inscripcion` (url): Declaración general de cuenta para inscripción, progreso y completion badges; no equivale a muro de lectura ni a cuenta o plan de prácticas.
  Ubicación: https://academy.claude.com/help/faq. Licencia: desconocida; no acreditada por este descriptor.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `entrada-local` (local): Parser puro de capturas históricas; el canal remoto usa la operación común declarada y conserva su propia recepción.
  Recursos: fichas, captura. Autenticación: La lectura de capturas locales no usa credenciales ni acredita una consulta nueva.
  - No adquiere capturas ni registra una fuente automática.
  - Verifica integridad de los bytes y declaraciones recibidas, no su autenticidad remota ni exhaustividad del curso.
  - Mapeo textual acotado; no clasifica nivel, producto, elegibilidad, precio o licencia.
- `consulta-publica` (remoto): Operación declarada en el ciclo común, con salud y recibo por fuente; la extracción conserva campos y desconocidos propios.
  Recursos: fichas, indice-publico, declaracion-publica, primera-leccion, faq-inscripcion. Autenticación: Ninguna. Sin cuentas, cookies, claves, login, CAPTCHA o bypass.
  - Transporte común, identidad genérica, sin cookies ni cuenta; serie y al menos dos segundos por dominio.
  - Unión de identidades conocidas y enlaces nativos del índice; no retirar por ausencia del índice.
  - URL, canonical, título y artículo didáctico propios; HTTP200 genérico no acredita acceso.
  - La declaración general de formación gratuita y el texto de primera lección son pruebas distintas; no garantizan curso completo, vídeo, prácticas, productos, quiz o badge.

## Operación actual

Política: `diaria`. Consulta red: sí.
Frecuencia declarada: Consulta diaria del índice, declaración pública, FAQ, fichas conocidas y altas enlazadas; copiar no renueva pruebas históricas. Aviso de renovación: 1 días.
Originales: `claude_academy`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| claude_academy | cambiante | contenido-actual-acotado | descargar | 1 |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: ninguna declarada.
Contratos y controles: lector.py:extraer_ficha, lector.py:FichaAcademy, contrato-lectura.md, plataforma_datos/cursos/pruebas/test_lectura_claude_academy.py, plataforma_datos/cursos/operacion_fuente.py, plataforma_datos/cursos/componer_catalogo.py, observaciones_vigencia.py:construir, actualizacion.py:aplicar, politica_vigencia_v2.json, plataforma_datos/cursos/oferta_continua.py, plataforma_datos/cursos/pruebas/test_academy_actualizacion.py, condiciones_publicadas.py:examinar, condiciones_formacion.py:declaracion_inscripcion, condiciones_formacion.py:enlace_inscripcion, condiciones_formacion.py:modalidad, control_actual.py:validar, plataforma_datos/cursos/contenido_academy.py, plataforma_datos/cursos/pruebas/test_condiciones_formacion_academy.py.

Retirada: Un error de transporte no da de baja ni renueva la última comprobación. Solo una respuesta identificada contraria participa como hecho nuevo; una ausencia sin censo acreditado no borra entidades ni historia.

Conservación: Cuerpos deduplicados por SHA y recibos inmutables por consulta. Fechas de recepción, revisión e ingestión separadas. La composición final conserva la instantánea de una fuente fallida y promueve conjuntamente SQLite, recurso y referencia; sin limpieza automática.

## Reproducción

```sh
python -m plataforma_datos.cursos.fuentes.claude_academy.lector preparar
python -m plataforma_datos.cursos.fuentes.claude_academy.lector validar
python -m plataforma_datos.contratos.fuentes --fuente claude_academy --tema cursos --comprobar
```
