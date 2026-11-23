# Comprobación de la página de un curso

La regla de retirada necesita, para dar de baja un curso que la fuente no retira, una segunda evidencia que no salga
del listado: lo que dice la página pública del propio curso. Este paquete decide ese veredicto. No pide nada a la red:
recibe lo que se observó y devuelve la comprobación.

## Qué entra y qué sale

`comprobar_pagina(curso, respuesta, sonda, pedido_utc=...)` recibe el curso (identificador, fuente y título publicado),
la respuesta de su página, la respuesta de la **sonda** del mismo dominio y la hora en que se pidió. Devuelve una
`Comprobacion` del contrato `comprobacion-pagina` versión 1 (`contrato.py`, descrito también en
`comprobacion_pagina.json`): estado HTTP, dirección final, saltos, longitud del texto, huella del cuerpo, si aparece el
título, las señales literales que sostienen el veredicto, la huella de la sonda, el veredicto, su motivo y la regla.

## La sonda

Algunos sitios responden 200 y una página corriente a cualquier dirección. `sonda.py` construye la dirección de una
ficha inexistente con la misma forma que la de un curso real (la semilla es un dato, así que es reproducible) y decide
si una página responde igual que ella. Una ficha igual a la sonda y sin el título es `no_existe`.

## Veredictos

- `disponible`: la ficha propia lo dice (el título y la señal de apertura de su fuente, o los datos publicados que trae).
- `cerrado`: señal literal de cierre y ninguna de apertura.
- `no_existe`: 404 o 410, o una respuesta igual a la de lo inexistente.
- `dudoso`: todo lo que no se reconoce. Nunca se da `disponible` ni `cerrado` por descarte.
- `sin_respuesta`: error de red, 5xx o límite de peticiones. No es evidencia de nada.

Cada veredicto tiene sus motivos, una lista cerrada (`contrato.MOTIVOS`).

## Lo que declara cada fuente

`reconocedores.py` es el único sitio donde se declara cómo se lee la página de cada fuente: idiomas, frases de menú o de
pie que se descartan, señal propia de una ficha abierta, si la página basta para decidir y si trae el curso incrustado.
`vocabulario.py` guarda las frases de cierre y de apertura por idioma. Una fuente que no está declarada queda `dudosa`.

## Con la regla de retirada

`comprobacion_para_la_regla` (`para_la_regla.py`) da la `ComprobacionPagina` que espera `retirada_por_evidencia`.

## Paridad con el censo de verdad

`pruebas/test_paridad_con_el_censo.py` recalcula el veredicto de las páginas reales del censo y exige el mismo
resultado. Los cuerpos son de terceros y no están en el repositorio: se leen de la carpeta que indica la variable
`FARO_CENSO_DE_VERDAD` y, si no está, la prueba se omite diciéndolo.
