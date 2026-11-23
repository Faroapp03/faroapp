# Lectura candidata de Claude Academy

`plataforma_datos.cursos.fuentes.claude_academy.lector.extraer_ficha(cuerpo, metadatos, url_esperada=...)`
es una función pura. Recibe bytes HTML y los metadatos de su captura; no abre
archivos, consulta red ni activa productores o descubrimiento de cursos.

Exige HTTP 200, captura declarada completa, tamaño y SHA256 coincidentes, URL
solicitada/final exactas e instante UTC. Contrasta canonical, título HTML, h1,
slug y las identidades og:url/prerender cuando están publicadas. Un documento sin
cierres main/body/html se rechaza. Esto verifica la captura local y sus declaraciones;
no certifica autenticidad remota ni demuestra que el servidor publicó todo lo esperado.

La salida `FichaAcademy` conserva texto ordenado del main, bloques, enlaces con su
href original y evidencias separadas de requisitos y destinatarios. Se mantienen
párrafos sucesivos, anidados a/strong/em/code y paneles HTML de acordeón cerrados.
Los encabezados delimitan secciones; summary/details y aria-controls relacionan
preguntas y respuestas. El contenido sin título también permanece en `contenido`.
Solo se excluyen script/style/template y contenido fuera del main. Se normalizan
espacios y saltos, sin limitar el texto a la primera línea. Los bloques pueden
solaparse por anidación; `contenido` conserva una sola secuencia documental.

Cada evidencia tiene localizador y huella de su texto; la ficha conserva archivo,
fecha, bytes y huella de captura. El mapeo usa marcadores textuales explícitos y
no sustituye la revisión de significado. Un mapeo ausente es `None`: no significa
«sin requisitos». No clasifica nivel, dependencia de marca, licencia, disponibilidad
ni acceso individual; esas decisiones no se deducen de la ausencia de un dato.

No se copian capturas reales ni textos completos licenciados a las pruebas del
repositorio. Las pruebas son sintéticas; los contrastes reales se guardan fuera
como evidencia local. El descriptor `fuente.json` registra este lector candidato; no activa adquisición ni publicación.

## Fallo de una ficha

Cada ficha es una consulta propia. Si no responde, o responde con un fallo de consulta (3xx, 5xx, 401/403/407/408/429 o incompleta), su unidad registra una observación de fallo con el intervalo real y el recibo como diagnóstico: conserva su última confirmación y su selección de contenido, y las demás fichas se evalúan con sus respuestas válidas. El conjunto lleva `consulta_parcial` y la fuente no consta comprobada entera. Un fallo del índice o de la portada sigue anulando la consulta completa.

## Ciclos no instalados

Si un ciclo se admite pero su catálogo no llega a instalarse, al admitir el siguiente se aparta el conjunto anterior en `validados/<fuente>/pendientes/` (archivo nombrado por su SHA). La composición lo aplica antes del conjunto actual, con sus propios auxiliares y con su corte (fin de su última captura), así que no se rejuvenece ni se mezcla con la consulta de hoy. El registro no duplica observaciones del mismo id. Se retira en cuanto el catálogo instalado conserva alguno de sus recibos. Un ciclo cuya admisión falló nunca se aparta.

```sh
python -m unittest plataforma_datos.cursos.pruebas.test_lectura_claude_academy
```
