# Comprobación por API de un curso retirado

La regla de retirada pasa sola de sombra a activa en una fuente cuando acumula retiradas comprobadas contra la
realidad. En FUNDAE, Cibervoluntarios, el SOC, el Consorci y Citilab la página del curso no decide: o se pinta con
JavaScript igual para cualquier curso, o el curso no tiene página propia. Su realidad está en la API que ya lee la
descarga de cada fuente, y este paquete la consulta con los clientes y lectores de esa descarga.

## Qué entra y qué sale

`comprobar_por_api` (`consulta_por_api.py`) recibe, como `comprobacion_pagina.consulta_de_retirados`, los cursos que
la regla retiraría, las fichas servidas, el transporte, el reloj y el final del tope compartido del ciclo, y devuelve la
misma `Consulta`: la misma muestra de 4 por fuente y ciclo, `sin-tiempo` para lo que no cabe, y comprobaciones con los
veredictos de la página (`disponible`, `cerrado`, `no_existe`, `dudoso`, `sin_respuesta`). Así
`orquestacion/activacion_en_el_ciclo.py` cuenta igual una confirmación de página y una de API.

Cada comprobación cumple el contrato `comprobacion-api` versión 1 (`contrato.py`): la dirección pedida, la hora, el
estado HTTP, el tipo y la huella del cuerpo, el dato literal de la fuente, el veredicto, su motivo y la regla. La regla
dice de dónde sale: el registro de la retirada (`estado_de_la_retirada.py`) valida cada comprobación con su contrato.

## Qué se pregunta a cada fuente

`consultores.py` es el único sitio donde se declara qué fuentes se comprueban por API. Cada consultor dice qué
dirección responde por un curso y cómo se lee la respuesta; su módulo explica cada veredicto.

| Fuente | Qué se pide | Confirma | Contradice | No se sabe |
|---|---|---|---|---|
| SOC (`soc.py`) | la oferta oficial entera, una vez por ciclo | fin pasado, o ausente de la oferta | en la oferta y sin terminar | estado nuevo, oferta con otra forma |
| FUNDAE (`fundae.py`) | la ficha de difusiones de la especialidad | plazo terminado, o la difusión ya no sale | dentro del plazo | plazo sin abrir, otra forma |
| Cibervoluntarios (`cibervoluntarios.py`) | el catálogo filtrado por el slug | borrado, descatalogado o sin el slug | «Disponible» | otro estado, otro identificador, filtro no aplicado |
| Consorci (`consorci.py`) | las filas de la acción en `qv5z-dgk3` | fin pasado, o la edición ya no sale | fin por llegar | fin ilegible, otra forma |
| Citilab (`citilab.py`) | la ficha por su número | fin pasado, o 404 | fin por llegar | página antirrobots, acceso rechazado, sin fin |

En todas, la falta de respuesta o un error del servidor es `sin_respuesta`, que no es evidencia de nada. La página de
comprobación antirrobots de Citilab nunca se rodea: la ficha queda `dudoso` con el motivo `pagina_de_comprobacion`.
Los recursos de Digitalízate (`fundae:1:…`) no tienen API por curso y no se preguntan. Cibernàrium no está: su página
decide, y su API es una búsqueda paginada sin consulta por edición.
