# Preparación de HP LIFE

`lector.py` conserva la lectura pura. `actualizacion.py` prepara explícitamente una copia de una instantánea V10
admitida, añade las observaciones al registro único y obtiene su admisión común. No descarga, migra, publica ni
crea ediciones: la consulta diaria la hace el ciclo común de actualización, según `fuente.json`, y la composición
del catálogo de ese ciclo (`componer_catalogo.py`) le entrega lo recibido. Este componente no es un segundo catálogo
ni una regla alternativa de disponibilidad.

La API recibe `SolicitudHpLife`: admisión de entrada con su SHA, tupla de `RecepcionEnDisco`, raíz explícita de
las evidencias históricas, área nueva y corte UTC. Cada recepción identifica el recurso nativo o declara
`id=None` para la FAQ general. Cuerpo y recibo son `ReferenciaArchivo` con SHA esperado. No se elige la última
carpeta por fecha ni se consulta HOME. Las rutas se calculan desde el paquete o se reciben explícitamente.

`preparar` verifica las entradas, trabaja en un directorio temporal propio y promueve su directorio solo tras
terminar el registro y la admisión. Un fallo no modifica la instantánea de entrada ni deja la preparación parcial
como resultado. No se promete una transacción de sistema de archivos ante una muerte abrupta. Repetir las
mismas entradas y corte en el mismo destino comprueba la admisión y conserva bytes y mtime. Otro corte o
entradas requieren otro destino; el resultado anterior nunca se sobrescribe silenciosamente.

La salida contiene `catalogo.sqlite3`, `validacion.json`, `control-hp-life.json`, `lotes-hp-life.json`, la admisión
anterior y las evidencias utilizadas. `solicitud_admision(area)` entrega al proyector común las referencias a
estos artefactos, política, contrato, código efectivo y cada archivo físico conservado. El control enumera
las rutas y los SHA esperados desde las pruebas del cargador y las recepciones, incluidos los pendientes;
no recalcula sus huellas para admitir alteraciones. La admisión común comprueba los bytes de cada referencia
también al repetir, reanudar y proyectar. Un archivo ausente, alterado o enlazado impide continuar.

Cada ciclo hereda el inventario íntegro de la
entrada HP admitida, exige sus mismas referencias físicas y copia sus bytes con el SHA esperado antes de
añadir evidencias nuevas. Así, una recepción anterior sigue conservada aunque deje de ser el último soporte
de su canal. Esta conservación incluye los pendientes; no equivale a nuevas consultas ni renueva fechas.
La historia acumulada consume el presupuesto común de archivos/bytes: si se excede, la preparación falla
explícitamente sin promover ni omitir pruebas. La entrega válida anterior se conserva y el error expresa
capacidad local, no indisponibilidad del proveedor. No se promete capacidad infinita.

El control actúa como índice sellado de activación expresa de la admisión común: una referencia lógica identifica el
inventario y la misma guarda verifica cada archivo físico. El informe de admisión utiliza versión 2; no se
añade otro diario o manifiesto diario. Se conservan las cotas de bytes y los límites documentados de índices. `validar(area)` comprueba esa única admisión. La API
`entrega_catalogo.SolicitudEntrega` puede preparar, validar y exportar el DTO público desde ella: el productor
HP no exporta HTML, diagnósticos privados o rutas al público y no sirve puntos de acceso.

## Altas y bajas por el índice público

Antes de las fichas, la consulta recorre `https://www.life-global.org/es/allcourses?page=N` en serie (`descubrimiento.recorrer`)
hasta que las páginas suman el `totalCourses` que declaran. Cada página se conserva con su cuerpo, recibo e intento como
una ficha y queda en los `auxiliares` de la procedencia (`indice-N`). El censo (`censo_indice.calcular`, reproducible desde
los bytes conservados) es completo solo si las páginas son consecutivas desde la primera, declaran el mismo total, no
repiten ningún curso, suman ese total y listan al menos uno; una respuesta de otra dirección que la pedida no vale. Una
página caída, con 5xx, incompleta o mal formada queda sin noticia y el censo parcial: el conjunto lo declara en `indice`
(`completo: false` y su `motivo`), el panel lo recibe como `indice-de-hp-life-sin-completar` y la consulta de fichas sigue.

**Altas.** Un curso del índice que el catálogo no conoce y cuyo idioma la fuente admite (`indice.IDIOMAS_ALTA`) se consulta
por `https://www.life-global.org/<idioma>/course/<id>`. Los de otro idioma quedan en `indice.otros_idiomas` sin alta. La
composición pasa las páginas del índice a `SolicitudHpLife.indice`; `altas.planificar_alta` crea el programa solo con una
ficha 200 íntegra, con la misma identidad y URL, y la página del índice que lo lista. Sus evidencias, de las dos, forman el
canal `hp-life-alta-por-indice`. Una ficha ilegible, caída o sin página que la acredite no crea nada. Las altas se descubren
también con un censo parcial, porque lo visto en una página es evidencia directa de que el curso existe; un censo parcial
nunca da bajas.

**Bajas.** La ficha de HP LIFE no distingue un curso que ya no existe de un fallo del servidor: ambos responden 500, con
la página de error de la aplicación (`/_error`, `statusCode` 500, sin ficha) cuando el curso no existe. La evidencia que
afirma la baja es el censo completo; la ficha lo corrobora o lo contradice (`bajas.decidir`):

1. Curso conocido que el censo completo no lista, con su ficha en 404, 410 o 500 con esa página de error, y en la misma
   consulta más de la mitad de las fichas de los cursos que el índice lista respondiendo bien (así se da por sano al
   servidor, porque una caída parcial de la aplicación daría esa misma página de error a cursos que existen): retirado
   por el proveedor. La condición no limita cuántos se retiran, solo cuándo se fía Faro del servidor.
2. Con la ficha íntegra del curso: contradicción. Sigue vigente y la discrepancia llega al panel como
   `ficha-integra-fuera-del-listado`.
3. Con cualquier otra respuesta (corte, 502, 503, 504, otro cuerpo, 500 sin esa forma, ninguna ficha buena en la consulta):
   sin cambio y el panel recibe `ausente-del-listado-sin-confirmar`; la consulta siguiente vuelve a mirarlo.
4. Un curso que el censo completo lista y cuya ficha falla: sin cambio.

No hay tope de proporción: si el proveedor quita cincuenta cursos, se retiran los cincuenta. Si ninguna ficha responde
bien, la consulta no se admite y no se toca nada de la fuente, como con 37 respuestas 5xx; lo mismo ocurre si todas las
fichas 200 son ilegibles.

La retirada es la observación de ausencia del catálogo (`observaciones_vigencia.construir_observacion_retirada`), con
cada página del listado como evidencia (huella, hora y número de página), junto a la observación de la propia ficha. La
política de vigencia `3` (la `1` y la `2` no cambian) fija su regla (`retirada_proveedor`): la última lectura completa
del listado sin el curso lo deja `no-disponible-publicamente` con el motivo `retirado_por_el_proveedor`, salvo que una
ficha íntegra posterior lo contradiga. Un curso retirado conserva su programa y su historial en el catálogo. Si vuelve a
estar en un censo completo con su ficha íntegra, esa ficha es más reciente que la ausencia y vuelve a ofrecerse sola; la
retirada queda en su historial como una observación más.

## Fallos por unidad y recepciones pendientes

Cada recurso conocido se consulta por separado. Una respuesta que es fallo de consulta (3xx, 5xx, 401/403/407/408/429 o incompleta) entra tal cual y el evaluador común la trata como fallo o incidencia del enlace, sin anular a las demás unidades. Si una URL no responde, su intento (`IntentoFallidoEnDisco`)
llega al registro como observación de fallo de esa unidad: conserva el intervalo real, usa el propio intento
como evidencia de diagnóstico y no aporta cuerpo ni contenido. El evaluador común lo muestra como
`ultimo_intento_fallido_el`; la unidad conserva su última confirmación y no se retira. Las demás unidades se
evalúan con sus respuestas válidas. La cobertura exige una observación por unidad esperada, válida o de fallo.
El conjunto admitido señala la consulta parcial (`consulta_parcial`, con las unidades fallidas) y la fuente no
consta como comprobada entera. Si ninguna URL responde, el intento queda en la procedencia y no se admite
nada nuevo: la instalación sigue igual.

Solo una ficha 200 completa describe el contenido actual. Mientras una unidad no trae ninguna en el corte, el control mantiene en `entradas.recepciones` su última recepción
válida del control admitido anterior, marcada como `heredada`, para que su contenido no desaparezca.

Si un ciclo admite la fuente pero su catálogo no llega a instalarse, sus recepciones no entran en el registro.
El ciclo siguiente las recupera de la procedencia admitida como `pendientes` mientras sus recibos o intentos no
sostengan ya una observación registrada, y las evalúa con su fecha de captura. Una misma recepción no se
registra dos veces y solo la recepción más reciente de cada unidad proyecta sus datos; las anteriores quedan en
`entradas.anteriores` y aportan únicamente su observación.

## Qué acredita una recepción

El formato completo conserva `captura`, `inicio_utc`, `content_type` y `representacion_hash`. `captura` contiene
los campos exactos de `CapturaHpLife`, incluyendo completitud explícita, URL solicitada/final, HTTP, SHA,
tamaño y fecha real de recepción. Cuerpo y respuesta conservada se cotejan; el SHA es del cuerpo HTTP
**descomprimido**, no de los bytes del cable. Un recibo plano histórico sin completitud explícita se conserva
íntegro en `pendientes/`; no se completa por deducción desde HTTP200 u `original_conservado`. Cada curso
tiene un único pendiente (`pendientes/<curso>.body`, `.json` y `.estado.json`), que la consulta siguiente sustituye y cuyo
estado guarda la fecha de la primera y de la última vez que se vio así (comparadas como instantes). El nombre del archivo
es distinto para cada identificador: cada byte que no es una letra minúscula o un dígito se escribe `_` y su valor en
hexadecimal. Cuando el curso deja de estar pendiente, su estado se retira de la preparación; los cuerpos, recibos e
intentos de cada consulta siguen entre los originales de la fuente.

La observación distingue el intervalo de consulta, su recepción real y el corte de evaluación local.
Cuerpos iguales se deduplican por SHA; cada recibo íntegro conserva su identidad. Otra consulta real con el
mismo cuerpo conserva su fecha nueva y no sustituye la anterior. La repetición exacta no fabrica consulta.
Los errores técnicos/parciales conservan la comprobación previa durante su plazo según el evaluador común;
no prueban cierre ni renuevan esa comprobación. Un estado contrario identificado, como `Archived` de ese
curso, sí participa como hecho nuevo. Un dato ilegible o incompleto no permite actualizar su negocio.

## Interpretación de inscripción y plazo

El método `hp-life:inscripcion-publica-inferida-js:1` interpreta el código público oficial identificado por URL
y SHA en `observaciones_vigencia.py`. La captura debe enlazar esos dos recursos revisados. En la forma
acotada `SelfPaced/Public/Published`, grupo y licencia explícitamente falsos, sin producto o localizaciones
externas ni fechas fijas que requieran otro contraste, el código ofrece al visitante la ruta de inscripción
que lleva al login conservando el curso. Esto es **inferencia versionada del código**, no un botón observado
ya renderizado, una inscripción realizada o acceso personal acreditado. Un paquete construido distinto o una condición
no soportada deja el acceso sin confirmar. La ausencia de `productId` tiene la semántica JavaScript revisada;
no demuestra gratuidad universal, precio del certificado ni de herramientas externas.

La política de 24 horas es una decisión operativa interna de Faro, versionada y con SHA comprobado. No es
un plazo que HP publique, no se deduce de una cadencia y no cambia la edad de las capturas. FAQ, gratuidad
formativa general y otras declaraciones conservan su URL y fecha propias. No se injertan en la observación
de otro curso, ni prueban plaza o elegibilidad individual.

## Continuidad de los hechos

`contrato_actualizacion_v1.json` fija los punteros de los campos de ficha. El primer anclaje exige que la
proyección comprobada y todo el negocio existente sean idénticos. Los canales históricos se conservan con
sus pruebas y fechas, sin inventar qué campos produjeron. Después, `cargar_lotes` admite cambios compatibles
solo con captura estrictamente nueva del canal; los campos ajenos y auxiliares repetidos se conservan exactos.
La guarda y la transacción siguen siendo las del cargador común. Cambiar mapa o versión exige una transición
explícita que este componente no ejecuta.

Un cambio de título o cuerpo continúa por ese camino. `contenido_huella` activa la revisión existente de
etiquetas/aprendizaje. Investigación, `soporte_acceso` y otros hechos históricos ajenos al mapa no se
sobrescriben ni se presentan como cotejados por la observación reciente de acceso. El control conserva el
método y los soportes efectivos; la decisión de oferta no certifica todas las dimensiones pedagógicas o de coste.

Se refrescan las identidades conocidas y las altas que el índice público acredita; las bajas solo salen de un
censo completo corroborado por la ficha. No hay retirada física ni retirada total de catálogo derivada del número
de capturas. La preparación y el DTO privado
conservan los casos pendientes; la proyección pública común selecciona solo confirmaciones suficientes y aún
vigentes al corte. Una exportación local no confirma publicación ni activación en una instalación.

## Declaración de gratuidad

HP LIFE declara la gratuidad de sus cursos en su ayuda en español (`https://www.life-global.org/es/help`, JSON
`staticHelpTopics`): el encabezado literal «Los cursos de HP LIFE son gratuitos» y un párrafo que la dirige a todas las
personas. Cada consulta pide esa página (una petición más al día, al mismo dominio y con su pausa) y la conserva como
auxiliar `ayuda` de la procedencia. `gratuidad.estado` la lee con `lector.extraer_condiciones_generales`; el conjunto
declara `gratuidad.intacta`.

Si la página no responde, no se puede leer, no trae el encabezado o su párrafo ya no dice eso, la declaración está sin
comprobar. Es un fallo de método, nunca un hecho de la oferta: Faro no afirma que los cursos sean de pago ni gratuitos.
La composición deja las comprobaciones de los cursos de esa consulta como fallos (`declaracion_de_gratuidad_no_comprobada`,
con identidad propia y las mismas evidencias): la oferta conserva lo último comprobado y no se renueva. La fuente no
queda acreditada entera (`cobertura_catalogo` exige también las páginas del índice y la ayuda, y la ayuda solo cuenta como recibida si su declaración está intacta) y el panel recibe
`gratuidad-de-hp-life-sin-comprobar`. Un curso nuevo del índice que no entra por esa causa queda pendiente con el motivo
`declaracion_de_gratuidad_no_comprobada`, no con el de falta de ficha o de índice. Una consulta posterior con la
declaración intacta renueva las comprobaciones.
