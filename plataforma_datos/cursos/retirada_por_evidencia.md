# Retirada por evidencia

La regla `retirada-por-evidencia` (versión 1) decide si un curso deja de publicarse. Está en
`retirada_por_evidencia.py` y sus decisiones se registran con `decisiones_retirada.py`. Cada ciclo la aplica a las
lecturas nuevas de cada fuente (`orquestacion/sombra_del_ciclo.py`). Empieza en sombra en todas las fuentes: decide y
registra, pero no cambia lo que se publica. Cada fuente pasa a decidir de verdad por su cuenta cuando la realidad le da
la razón (apartado «De la sombra a decidir de verdad»).

## El principio

Un curso deja de publicarse cuando lo afirma la propia fuente, o cuando hay al menos dos evidencias independientes de
su baja. Mientras solo haya una, el curso sigue visible. Nada se decide por el paso de los días ni por la hora del
sistema: la única hora que cuenta es la de cada observación.

Las evidencias se cuentan por grupo de origen, porque dos señales que salen del mismo listado fallan a la vez:

| Grupo | Qué lo prueba | Canales |
|---|---|---|
| `fuente` | La fuente lo afirma en su última lectura sana con el curso | `fin_publicado` (alcanzado a la hora de la última lectura sana), `baja_declarada`, `estado_cerrado`, `inscripcion_cerrada`, `sin_plazas`; también la salida de una lectura sana que la propia lectura explica por su fin o por una baja |
| `censo` | El curso falta en una lectura sana | `ausencia`, una por lectura sana |
| `pagina` | El último veredicto de su página | `cerrado`, `no_existe` |

## La tabla de decisión

| Evidencias desde la última vez que una lectura listó el curso | Decisión |
|---|---|
| Ninguna lectura sana en la cadena | `mantener` |
| Ninguna evidencia | `mantener` |
| `fuente`, con lo que sea | `retirar` |
| `censo` y `pagina` | `retirar` |
| `censo` en dos lecturas sanas, en una fuente sin canal de página | `retirar` |
| `censo` en dos o más lecturas sanas, en una fuente con canal de página | `pendiente` |
| `censo` en una sola lectura sana | `pendiente` |
| Solo `pagina` | `pendiente` |

Qué fuentes tienen canal de página se declara en un solo sitio, `PARAMETROS.fuentes_con_pagina`: Barcelona Activa
(Cibernàrium), Cibervoluntarios, FUNDAE y HP LIFE, que ya piden la ficha de cada curso. Cambiar los parámetros cambia
la huella de la regla.

## Lo que anula una evidencia

- Que una lectura posterior vuelva a listar el curso, sea cual sea su estado, anula las ausencias, los veredictos de
  página y las declaraciones anteriores. Así una lectura que no es sana puede impedir una retirada, nunca provocarla.
- Una ausencia en una lectura `anomala`, `incompleta` o `reconstruida` no es una observación.
- Lo que la fuente declaró en una lectura anterior a la última que lista el curso queda superado por lo que dijo
  después; lo declarado en una lectura que no es sana no cuenta.
- En la página, `sin_respuesta` no es una observación y cuenta el último veredicto. Si a la misma hora hay veredictos
  distintos, solo cuenta como baja si todos lo son.

## Lo que recibe

- El curso: su identificador en el censo, su fuente, su ámbito y sus declaraciones. Cada declaración cita la lectura en
  la que la fuente lo dijo (`lectura_id`), su canal, la huella del dato literal y, si es el fin, `cierra_el` en UTC.
- Todas las lecturas del ámbito (contrato `lectura-fuente`). Se ordenan por su encadenamiento, así que el orden en que
  llegan no importa; una cadena rota, con ramas o con lecturas de otro ámbito es un error.
- Las comprobaciones de página, con su forma mínima: `veredicto`, `pedido_utc` y `sha256`.

## El registro

Un archivo inmutable por lectura: `var/actualizacion/validados/<fuente>/decisiones/<lectura_id>.json`, en JSON
canónico. Lleva las decisiones que no son `mantener` y el recuento de las que sí. Guardar lo mismo dos veces no cambia
nada; otro registro para la misma lectura es un error. Ejemplo (con huellas de prueba, recortadas):

```json
{"ambito":"cibernarium:edicion","decisiones":[{"curso":"cibernarium:edicion:40112","decision":"retirar","evidencias":[{"canal":"ausencia","grupo":"censo","observado_utc":"2026-11-15T05:00:00Z","ref_sha256":"9c1e…"},{"canal":"no_existe","grupo":"pagina","observado_utc":"2026-11-15T09:00:00Z","ref_sha256":"5b7d…"}]}],"fuente":"barcelonactiva","lectura_id":"9c1e…","mantenidas":2,"regla":{"id":"retirada-por-evidencia","sha256":"…","version":1},"version":1}
```

## De la sombra a decidir de verdad

Cada ciclo comprueba una muestra pequeña de los cursos que la regla retiraría en cada fuente: en su página pública
(`comprobacion_pagina/consulta_de_retirados.py`) o, en las fuentes cuya página no decide (FUNDAE, Cibervoluntarios,
SOC, Consorci, Citilab), en la API que ya lee su descarga (`comprobacion_api/consulta_por_api.py`): 4 por fuente y
ciclo, un minuto para todo el ciclo, con la pausa por dominio y la identidad genérica del producto. La comprobación
confirma la retirada (cerrado o no existe), la contradice (sigue abierto) o no permite saberlo; la regla de cada
comprobación dice si sale de la página o de la API. En esas cinco fuentes la API es la misma de la que sale el censo:
confirma que el curso sigue ausente o cerrado en el momento de la consulta, y la red de seguridad es la vuelta a
sombra en cuanto el curso reaparece. Citilab bloqueado por su barrera antibots queda sin saber y no se rodea. Tampoco
empieza una petición si la hora límite del motor está a menos de ese minuto con su
margen (`sombra_del_ciclo.fin_de_la_consulta`): lo que no cabe queda sin comprobar con el motivo «sin-tiempo».

El modo de cada fuente se guarda en `var/actualizacion/validados/<fuente>/retirada/<número>.json`, un registro
inmutable por ciclo (`estado_de_la_retirada.py`), y lo decide `activacion_de_la_retirada.py`:

- **Pasa a activa sola** con al menos 30 decisiones de retirar comprobadas y ninguna contradicha desde el último
  error, en al menos 7 ciclos con alguna confirmación, y con la salud de sus lecturas ya calibrada con su historia (el
  límite no es el suelo). El porqué de las dos cifras está junto a ellas, en `CRITERIO`.
- **Vuelve a sombra sola** en cuanto una retirada aplicada se contradice: su página o su API lo sigue ofertando, o el curso reaparece
  en una lectura sana posterior (lo mide `error_de_retirada.py`). La cuenta vuelve a empezar.
- **En sombra**, una retirada que la página o la API contradice también deja la cuenta a cero.

Lo que la regla activa de una fuente retira en su último ciclo (`aplicacion_de_la_retirada.py`) deja de publicarse sin
más pasos: la entrega del catálogo de cursos lo retiene con el motivo `retirada_por_evidencia` antes de mirar su
vigencia (`retirada_en_el_catalogo.py`), y la exportación del paquete lo quita del archivo del SOC, del Consorci o de
Citilab (`retirada_en_el_paquete.py`). En sombra no se retira nada y lo publicado no cambia ni un byte. Cada fuente se
resuelve con su propio estado y solo retira unidades propias; el estado viaja en el linaje de la entrega y entre los
orígenes del manifiesto del paquete, para que lo publicado se pueda reproducir. El panel avisa del cambio de modo durante una semana, en «Requiere atención», y el diario del ciclo lo
registra. Si el último ciclo de una fuente activa retira más del 20 % de los cursos que leyó, el panel lo avisa con su
cifra mientras dure ese ciclo; se retira igual, porque cada retirada tiene su evidencia, y la cuarentena del paquete
no cuenta esas retiradas como una pérdida sin explicar (`orquestacion/retiradas_explicadas.py`).

