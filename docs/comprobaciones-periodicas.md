# Comprobaciones periódicas de las fuentes

La consulta a una fuente oficial, la validación de sus datos y la activación de una versión son pasos distintos.
El registro de comprobaciones no utiliza la fecha de reconstrucción para afirmar que se consultó una fuente.

## Ejecutar el mismo motor por cadencia o a demanda

Desde una instalación operativa que no sirva tráfico, con sus dependencias y entradas disponibles:

```sh
npm run datos:actualizar -- --programada
npm run datos:actualizar -- --buscar-actualizaciones
```

La primera orden selecciona las consultas vencidas. La segunda consulta ahora las fuentes automáticas,
sin esperar al vencimiento. Ambas utilizan el coordinador, su cerrojo, sus controles y su recuperación.
No instalan tareas en el sistema ni activan versiones en Internet. La acción remota `actualizar-datos`
utiliza la misma búsqueda a demanda: consulta las fuentes automáticas aunque su intervalo no haya vencido.
`reintentar-pendientes` conserva su selección de módulos fallidos. La
[programación remota](actualizacion-remota.md#programación-diaria) conecta la acción `comprobar-programada`
al mismo selector. Requiere configurar el horario del alojamiento y habilitar el circuito de activación;
la opción local `--programada` no los instala por sí sola.

`plataforma_datos/orquestacion/planificacion_de_comprobaciones.py` reúne los conjuntos operativos declarados
en las fichas `fuente.json`, con formación separada en oferta SOC y catálogos y los productores de agregados
globales. Cada conjunto declara su intervalo de consulta en `intervalo_dias`; el planificador usa ese valor.
La cadencia de consulta no es la frecuencia editorial de la institución. Una ficha registrada por sí sola
no instala una tarea ni habilita una descarga: debe estar incorporada al circuito operativo.

La espera cuenta días de calendario UTC desde el último intento remoto de cada fuente. Tras un intento
completo, aunque su cobertura sea parcial, la fuente espera su cadencia: una diaria vuelve a ser consultable
en la siguiente fecha UTC; una semanal, siete fechas después. Tras un intento fallido o interrumpido, el
reintento llega a 1, 2, 4 y 8 fechas según los fallos seguidos de esa fuente, y nunca más tarde que su
cadencia: una fuente semanal que falla se vuelve a consultar al día siguiente, no a la semana. El registro
cuenta los fallos seguidos por fuente (`fallos_seguidos`); el fallo de una fuente no adelanta ni retrasa
otra. Así una espera variable del ejecutor no hace saltar un día por faltar unos minutos para completar
24 horas. Dentro de la misma fecha no se repite automáticamente. El fallo permanece registrado y no
significa «actualizado». Buscar a demanda permite repetirlo antes. La regla solo decide cuándo consultar:
no cambia datos ni lo que se muestra.
Las pausas y el reintento corto de descarga del motor siguen vigentes. `--pendientes` reintenta los
módulos fallidos de `estado.json` y, además, las fuentes cuyo último intento remoto falló o se cortó y
cuyo reintento escalonado ha llegado: un corte no llega a escribir `estado.json`, pero sí queda en este
registro. Solo este registro concede una descarga con red: un módulo vencido únicamente en `estado.json`
falló en local (una orden no admitida, una recomposición) y se reintenta sin descargar sus fuentes con
red, que vuelven con su cadencia. No es el planificador de consultas oficiales.

Antes de ejecutar la primera etapa de un módulo, la actualización comprueba todas sus órdenes contra el
intérprete real del lector, sin ejecutar nada (`--comprobar-orden`). Los parámetros de cada etapa salen de
una sola regla (`parametros_de_etapa`): la descarga de las políticas renovables lleva `--aceptar-cambio`.
Cada orden debe ser exactamente la de su etapa: una que el lector admita con otros parámetros tampoco se
ejecuta, porque el registro de comprobaciones no anotaría su intento. Una orden que el lector no admite es
un error interno de la orquestación, no una consulta: no abre intento remoto, no suma fallos seguidos de la
fuente en este registro ni adelanta su consulta, no repite la descarga y el módulo queda en rojo, con el
motivo en `estado.json`, en `avisos.log` y en el informe. `estado.json` cuenta ese fallo del módulo y
`--pendientes` lo reintenta sin descargar; la fuente se vuelve a consultar con su cadencia.

Cada fuente solo descarga si el plan la selecciona. En una ejecución programada, sus consumidores se
reconstruyen localmente cuando cambian las entradas admitidas. La búsqueda a demanda prepara y valida
todos los módulos, incluidos los de entradas locales, para aplicar también cambios en sus preparadores.
Tras un ciclo interrumpido o un paquete pendiente se reconstruyen igualmente todos los módulos;
las fuentes no vencidas no se descargan por ese motivo.
Una reconstrucción local conserva la fecha del último intento remoto y sus fallos seguidos. En
`estado.json`, un módulo que esperaba un reintento conserva su registro (intento, fallos y reintento) si
la recomposición no publica nada nuevo ni queda en rojo. Sin trabajo automático pendiente,
la orden termina sin construir otro paquete ni renovar fechas; las revisiones pendientes siguen indicadas.

## Evidencia y alcance

`plataforma_datos/comun/observacion_remota.py` observa las lecturas HTTP completas durante la etapa de
descarga. `plataforma_datos/orquestacion/ejecucion_observada.py` reserva una recepción privada distinta por proceso e
intento. La recepción contiene identidades y huellas SHA-256, tamaños e instantes UTC reales; no guarda
direcciones, cabeceras, credenciales ni cuerpos de respuesta. Una variable ambiental del operador no
permite aportar una recepción ajena. Cero peticiones, salida de texto o código de salida cero no bastan
para acreditar una consulta completa.

La recepción privada v2 distingue los bytes recibidos de los que conserva la política de originales.
El vínculo se registra después de conservar el archivo, verificando la identidad de esa misma respuesta.
Esto permite comprobar metadatos de Socrata cuyos contadores de visitas cambian, aunque sus recuentos
y fechas de datos sean equivalentes a la copia conservada. Las recepciones v1 siguen siendo legibles;
no se les atribuye ese vínculo. La comprobación posterior de cobertura no autoriza por sí sola cambios.

`plataforma_datos/orquestacion/seguimiento_de_comprobaciones.py` espera a que el módulo termine su preparación,
validación y admisión antes de registrar conjuntos comprobados. El contrato de oferta SOC exige el recurso
oficial exacto, su destino final, el cuerpo recibido y su coincidencia con el original admitido en ese intento.
Solo renueva la oferta; los catálogos manuales de formación siguen separados.

Consorci exige los cuatro conjuntos y sus cuatro metadatos, sus originales vinculados y los recuentos
completos; para FPCAT contrasta únicamente el subconjunto oficial del Consorci. Citilab exige las tres
colecciones: fichas, públicos y temas. Antes de conservar cada respuesta, contrasta su longitud con
`X-WP-Total` y `X-WP-TotalPages`. La ausencia de estos encabezados, una página incompleta o el límite
de la consulta impiden admitir esa descarga. Una respuesta recibida íntegramente puede seguir siendo
un catálogo incompleto: ambas comprobaciones son necesarias.

Las series abiertas `mundo_eurostat`, `ue_eurostat`, `ilostat` y `ocupados` se consultan cada 30 días. El motor admite
su captura nueva en el candidato aislado para prepararla y validarla: un año nuevo o una revisión de cifras
no requiere cambiar el código. La política `mensual` concede esa admisión; la cadencia de 30 días se define
por separado en el planificador. Las definiciones, unidades, bases, rangos, marcas estadísticas, cobertura
y contrastes siguen siendo obligatorios. Las cifras de la primera captura son referencias de las pruebas,
no una condición que impida actualizar una serie oficial.

El descubrimiento no fija un año final. La cobertura exige todas las consultas de datos previstas y la igualdad
de cada cuerpo HTTP con el original admitido, su tamaño y su huella. Una recepción incompleta o una validación
fallida no renueva la comprobación. La actualización reconstruye los consumidores pertinentes; no basta descargar.
ILOSTAT conserva el último año de cada país y contrasta Alemania, España, Francia e Italia con Eurostat
en el último año común disponible. Sin un periodo común con cobertura suficiente, la validación pide revisión;
no compara años distintos ni interpreta ausencias como cero.

Ocupados consulta los metadatos abiertos de cuatro tablas del Idescat, sus datos, el nomenclátor municipal y
dos tablas del INE. Los metadatos determinan los años disponibles y cuántos caben en cada petición de datos
sin superar las 20.000 celdas permitidas por el Idescat. Cada respuesta se conserva íntegra como original;
las partes deben cubrir exactamente los periodos y categorías previstos, sin omisiones ni duplicados.
La cobertura remota comprueba primero los metadatos y después todas las partes que éstos exigen. Descubre los
años en las respuestas y conserva 2021 para contrastar el censo decenal; el paquete solo incluye los años
comparables del censo anual desde 2022. Los contrastes independientes con Cambra y el Censo 2021 se conservan.
La cobertura se refiere a las tablas y territorios declarados: no amplía automáticamente los municipios ni
descubre una eventual sustitución de esas tablas. Una estructura incompatible o un periodo incompleto
requiere revisión; no se marca como actualizado por haber recibido una respuesta HTTP correcta.
Si un solo año supera el límite de celdas, la estructura cambia o una parte no llega completa, la descarga
requiere revisión. Las capturas monolíticas existentes siguen sirviendo para reconstruir localmente los datos;
no acreditan una nueva comprobación remota del circuito por partes.

`cataluna` y `observatori` se consultan juntas cuando vence cualquiera de ellas. La primera captura las
tres tablas vigentes de contratación y conserva cuatro originales fijos del Censo 2021. La segunda
captura cinco tablas y los textos del visor para el mismo corte. Se exigen meses reales y consecutivos,
claves únicas, cobertura y coherencia de las cifras; tampoco se exporta un paquete con periodos distintos.
Los textos que definen la metodología deben conservar su subárbol registrado; un cambio requiere revisión
aunque permanezcan frases conocidas. Los textos de interfaz ajenos a ese subárbol no bloquean la actualización.
Sus manifiestos seleccionan solo los originales activos: el cambio de periodo no borra archivos antiguos,
pero éstos no se trasladan a la siguiente generación operativa. Si la fuente no aporta fecha editorial,
se cita el periodo y `vigencia.publicado` queda a `null`; la consulta HTTP no inventa una fecha de publicación.
El contraste de contratación con la Taula 13 de Cambra solo se aplica cuando septiembre de 2025 cae entre
los finales de los dos años comparados. Fuera de ese intervalo se declara no aplicable, conservando los
controles de códigos, cobertura, totales, porcentajes y bases. El Censo mantiene sus contrastes históricos.

`empresas` descubre la edición ETICCE en el índice del INE y sus cuatro capítulos, y consulta cuatro
tablas INE y dos conjuntos Eurostat. La comprobación vincula esos once cuerpos con los originales
admitidos y recalcula la edición desde los HTML recibidos. Requiere metadatos y definiciones compatibles,
ambas partes Eurostat de esa edición y su ventana regional de tres años. Si Eurostat aún no publica
esa edición, requiere revisión y conserva la fuente anterior; no mezcla años para completar el conjunto.
Las marcas estadísticas, cifras ausentes y cifras poco fiables conservan su significado. El permiso de
sustituir bytes no autoriza un cambio de metodología ni prescinde de estos controles.

`tich`, `tic_llars` y `salarios` consultan primero sus catálogos oficiales. La sonda de TIC-H distingue
resultados y microdatos; la de salarios separa la encuesta cuatrienal de la anual. TIC a les llars y
salarios detienen una edición distinta de la admitida antes de sustituir originales, incluso con
`--aceptar-cambio`: descubrir un año nuevo no acredita que su cuestionario, diseño o consumidores sean
compatibles. TIC-H no se detiene ante una edición posterior: la registra como observación con la fecha y
la huella del catálogo (`edicion_nueva`: «publicada-sin-microdatos» o «pendiente-de-incorporar»), sigue
consultando y publicando la edición admitida, y la consulta cuenta como buena, sin reintentos. Sí detiene
un catálogo incoherente (un año anterior al admitido, o microdatos de un año sin sus resultados). Los
contratos actuales son TIC-H e Idescat 2025 y EES 2022. Cada encuesta declara su año: con la TIC-H de un año y las
tablas del Idescat del anterior (que las publica después), la validación y la exportación siguen, el contraste con el
cálculo de Faro espera a la misma edición y unos motivos de no uso posteriores al uso detienen la exportación. TIC a les
llars no se valida con cifras copiadas a mano: comprueba la coherencia de sus tablas capturadas (el total entre mujeres
y hombres, y el uso para trabajar no mayor que el total) y, con la misma edición, el contraste con la TIC-H: el uso
para trabajar y «no sabía cómo» de cada clase, dentro del intervalo del cálculo de Faro con los microdatos.

Su cobertura exige el catálogo y todos los recursos de datos vinculados al intento: cinco respuestas
para TIC-H, tres para TIC a les llars y cinco para salarios. Se vuelve a extraer la edición del HTML
observado, sin confiar únicamente en la procedencia. La política de aceptación de ediciones se conserva;
la sonda no convierte cifras de referencia en validadores de otra edición. Las capturas antiguas siguen
reconstruyéndose sin red, pero sin catálogo observado no reciben una comprobación remota nueva.

`nombres` comprueba por separado las pestañas de nombres y apellidos de residentes del INE, sin
confundirlas con la de recién nacidos. Ambas deben anunciar el mismo corte y publicación, y enlazar
las cuatro hojas y las dos notas metodológicas utilizadas. El contrato actual es 1 de enero de 2025,
publicado el 23 de abril de 2026. Una edición diferente se detiene antes de descargar las listas,
también con `--aceptar-cambio`: incorporar otros nombres requiere revisar las listas, sus consumidores
y las mediciones de privacidad. Las cabeceras de las hojas identifican el censo anual y los umbrales
usados; la nota de apellidos conserva referencias antiguas al padrón y al calendario de mayo. Esa
nota no sustituye las fechas del catálogo ni autoriza cambios de umbral. La cobertura exige siete
respuestas vinculadas: catálogo y seis originales. Las listas y el filtro siguen siendo los admitidos.

`ia_nacional_gbr` y `ia_nacional_bra` consultan los índices oficiales de ONS y Cetic.br antes de sus
tablas. En Reino Unido se identifica la edición por URL y fecha de publicación; en Brasil se contrasta
el título vigente con el selector de años y el enlace a la tabla H9. Sus contratos admitidos son el
artículo ONS «2023 to 2026», publicado el 20 de julio de 2026, y TIC Empresas 2025. Cada comprobación
requiere dos respuestas vinculadas: catálogo y datos. Una sucesora detiene la descarga antes de
sustituir originales; no se cambian automáticamente la pregunta, la población, la figura ni las notas
estadísticas. Estas sondas, como las anteriores, se consultan cada 30 días y no adelantan la admisión
de una nueva metodología.

Las medidas nacionales de Islandia, Suiza, Israel y Corea conservan revisión explícita. La tabla
islandesa puede publicar otros años, pero su contrato describe el estudio de 2025; los otros tres
lectores utilizan recursos de ediciones fijadas y no incorporan un detector de sucesoras. En Israel
el XLSX no repite el año: la validación exige además la procedencia del comunicado 216/2025, incluida
su URL final. Una tabla con las mismas columnas y otra procedencia no hereda ese año. Descargar estos
recursos no acredita por sí solo que sean las publicaciones más recientes ni que sus medidas puedan
compararse entre países.

`acreditacion`, `derechos` y `actic` comprueban un corpus declarado de recursos oficiales. Su alcance
sigue siendo `contenido-actual-acotado`: registrar una consulta completa no retira su revisión pendiente
ni demuestra que no existan disposiciones sucesoras. Acreditación deriva los documentos necesarios del
índice del BOE y de la copia SOC conservada; esa consulta no actualiza el catálogo manual del SOC ni las
relaciones revisadas. Derechos conserva la selección de artículos y recomendaciones, con la extracción
local ligada al PDF del CRL. ACTIC consulta sus tres disposiciones y dos páginas del portal; no transcribe
automáticamente una norma nueva. Estos límites permanecen aunque los recursos respondan correctamente.

El contrato vincula cada recurso esperado con su respuesta y el original admitido. Para los HTML que
ya tienen una comparación explícita de contenido se permite conservar el original cuando solo cambia
la plantilla: el transporte registra el vínculo después de aplicar esa comparación. Esta excepción
no se extiende a PDF, XML u otros recursos ni permite omitir peticiones. Preparación, validación y
admisión del módulo siguen siendo necesarias; una copia local no recibe fecha de consulta nueva.

`oit`, `clasificaciones`, `idescat`, `territorios` y `decada_digital` acreditan la consulta íntegra de sus
referencias identificadas, conservando el alcance `edicion-conocida` y la revisión de su edición. Exigen,
respectivamente, 4, 3, 3, 4 y 1 recursos vinculados al intento. La estructura CLDR
debe coincidir también con la versión declarada. Consultar la revisión fijada de CLDR, una clasificación
o el texto original de una decisión no acredita que sean la última edición ni que no existan modificaciones.

En OIT, la equivalencia del WP140 contrasta la tabla A1 y el contenido documental del estudio, sus avisos,
notas, enlaces y referencias a figuras; no consulta los archivos de imágenes enlazados. Una tabla intacta
no permite ignorar una revisión metodológica del texto. Los cambios de
plantilla o de la clave de ofuscación de un mismo correo no modifican ese contenido. La captura histórica
de la página de condiciones de reutilización se conserva como evidencia de esa edición. Si la respuesta
actual de esa página difiere, no se acredita consulta completa mediante la captura antigua: la comprobación
queda parcial y necesita revisión. Las hojas de datos también requieren coincidencia exacta. Ninguna de
estas comprobaciones incorpora automáticamente otro estudio de exposición o un nuevo método de estimación.

Las demás consultas quedan registradas como parciales mientras no tengan un contrato de cobertura
completa de sus recursos. Consultas completas tampoco acreditan por sí solas activación en la web.

Consultar una URL de una edición conocida no descubre una edición nueva. Las referencias sin sonda,
las entradas manuales y los productores externos conservan su necesidad de revisión. Los conjuntos
históricos y el contenido derivado tienen controles locales; no se presentan como nuevas publicaciones.
Las políticas de aceptación del motor siguen aplicándose: esta planificación no acepta una edición
incompatible ni elimina sus alarmas o la necesidad de revisar sus correspondencias.

## Registro privado y recuperación

Desde la versión 2 del inventario, cada copia incluye los originales que acreditan las ediciones de FUNDAE y el índice que permite reutilizar sus consultas. Al restaurar una generación anterior, el supervisor busca cada original ausente por su SHA-256 en el inventario completo. Si también falta allí, consulta el archivo privado asociado al informe admitido. Verifica cada cuerpo y recibo antes de aceptar el candidato. El diario indica cuántos archivos recuperó. Las siguientes generaciones transportan esos archivos en su propio inventario. Para reproducir una base histórica desde una copia local que carezca del archivo, se puede pasar `--apoyo-fundae /ruta/privada/al/archivo.zip` al ensayo.

La versión 3 incluye las páginas, fichas y recibos que acreditan cada censo de materia de Cibernàrium. Al preparar una copia antigua, el supervisor repone cada original ausente a partir de los mismos bytes en otra ruta del sello. El diario registra la cantidad recuperada. Una ficha histórica solo acredita que se consultó la actividad. La pertenencia al ámbito de IA requiere que la actividad figure también en los censos admitidos del ciclo.

Las entradas `etapa-fuente` del diario identifican fuente, etapa, intento, inicio, fin, código de salida y causa reconocida. Cada alta, retirada y cambio de un filtro tiene su propia entrada. Si una ficha del SOC trae una fecha de fin anterior a la de inicio, el diario identifica el curso y ambas fechas quedan por confirmar. El motor conserva el curso y comprueba el resto de la oferta. La siguiente copia con fechas coherentes restablece el calendario. El resultado de activación figura en el diario de la operación `activar`.


### Ejecutar un ciclo a demanda

En el panel privado, **Administración → Actualizaciones → Actualizar datos** solicita una actualización
real a la misma autoridad que atiende el cron. El operador puede consultar el estado de su reserva en ese panel.
Para ensayar desde GitHub Actions, abre **Actualizar datos → Run workflow** en la rama principal, selecciona
`ensayo=simular` y `accion=comprobar-programada`. El runner comprueba su identidad contra el servicio,
descarga la generación vigente y ejecuta el motor en un almacén aislado. El modo `preparar` comprueba
solo la restauración. Los cambios reales de las fuentes pueden variar entre dos consultas en vivo.

Con una copia de la generación y su sello se pueden lanzar las mismas operaciones desde terminal o cron.
Usa el entorno del proyecto y un directorio de ensayos privado fuera del repositorio.

```sh
npm run mantenimiento:ensayar -- preparar --sello "$SELLO" --area "$ENSAYOS"
npm run mantenimiento:ensayar -- simular --sello "$SELLO" --area "$ENSAYOS" --intencion "$INTENCION"
npm run mantenimiento:diagnosticar -- "$ENSAYOS/$INTENCION/diario.jsonl"
```

`INTENCION` es un UUID v4. Repetirlo con los mismos parámetros recupera el resultado confirmado.
Cada intención nueva permite ensayar otra vez desde la misma base. La preparación usa las capturas
selladas y se puede ejecutar desconectada. La simulación usa el planificador y consulta los proveedores
que correspondan a la acción elegida. Para reproducir altas, cierres y una interrupción con respuestas
fijas, la prueba de integración es ejecutable por separado.

```sh
.venv/bin/python -m unittest plataforma_datos.orquestacion.pruebas.test_ensayo_circuito.EnsayoCircuitoCompleto.test_circuito_en_ciclos_con_parcial_cierre_y_corte
```

Cada ejecución de producción registra la fase, la revisión, la reserva y el resultado. El diario incluye
el estado de los módulos y los cambios de la proyección de cursos por identidad y campo. La activación
de los servicios tiene su propio diario. El operador con acceso al almacén puede leerlos por número de
ejecución de Actions, intento y operación. El mismo JSONL está en el log privado del job cuando el almacén falla.

```sh
npm run --silent mantenimiento:registro -- "$RUN" --intento 1 --operacion ejecutar > candidato.jsonl
npm run --silent mantenimiento:diagnosticar -- candidato.jsonl
```

Junto a cada diario se archiva un resumen pequeño para leerlo sin descargar el diario completo, que puede ocupar
hasta 8 MiB. Lo compone `plataforma_datos/orquestacion/resumen_diario.py` y se guarda en
`diarios-resumen/<ejecución con 16 cifras>/<intento>/<operación>.json`: las cifras de relleno hacen que el orden de
las claves sea el de las ejecuciones. Ocupa como mucho 64 KiB (con todas las fuentes de cursos ocupa una pequeña parte) y es un JSON de versión 2 con estos apartados. La versión 2 solo añade `salud` a la 1: los demás apartados conservan su nombre y su forma, de modo que quien lee el resumen debe decidir por la presencia del campo (`salud`), no por el número de versión:

| Apartado | Contenido |
|---|---|
| `identidad` | `operacion`, `run`, `intento`, `revisionCodigo` y `reserva` de la ejecución. |
| `periodo` | Instante del primer y del último hecho del diario (`desde`, `hasta`). |
| `resultado` | `estado` (`terminado`, `fallido` o `sin-cierre`), el resultado de la operación, su fase final y el resultado del candidato. |
| `fases` | Cada fase con su `estado`, su `causa` (de la lista cerrada del diario; por ejemplo `almacen-no-disponible`, que se reintenta, u `objeto-ausente`, un objeto que el almacén dice que no existe y que no se reintenta), `inicio`, `fin` y el número de hechos que reúne. |
| `fuentes` | Cada etapa de cada fuente: `fuente`, `etapa`, `intentoFuente`, `estado`, `inicio`, `fin`, `codigo` y `causa`. |
| `modulos` | `id`, `veredicto`, `ultimoIntento` y `proximoReintento` de cada módulo del recibo. |
| `cursos` | Si hubo comparación, el tamaño antes y después, las altas, retiradas y modificaciones, y una muestra de como mucho 50 cursos con su identidad del diario y los campos cambiados. |
| `respuestasRechazadas` | `servicio` (`oidc` o `autoridad`) y código HTTP de cada respuesta que el servidor no confirmó, por ejemplo `autoridad`, 401. |
| `identidadOidc` | Lo que el runner observó en su último token: `audienciaEsperada` (sí o no) y si `referenciaDeJob` y `revisionDeJob` coinciden con las del workflow (`coincide`, `distinto` o `ausente`). Es `null` si la ejecución no llegó a pedir el token. Una revisión `distinto` explica un 401 de la autoridad. |
| `salud` | El parte de salud de la base de datos de ese día (siguiente apartado). |
| `retenciones` | Por qué no se admitió o no se conservó lo del ciclo, con palabras de listas cerradas: `paquete` (el paso en rojo, su código, las alarmas y, si el paso dejó su línea de fallo, `tramo`, `clase`, `errno` y `motivoAlmacen`; `null` los que no), `generacion` (la `clase` del error, la `comprobacion` que la rechazó y su `causa`) y `candidato` (el `error` del recibo de un candidato rechazado y, si lo detuvo una excepción, su `clase` y la `funcion` del motor donde saltó). Cada uno es `null` si no pasó. |
| `recorte` | `aplicado` y, por lista, cuántas entradas se omitieron. |

Cada campo se copia solo si tiene la forma que espera el contrato; el resumen no lleva direcciones, rutas,
credenciales, cuerpos de respuesta ni texto libre. Si no cabe en 64 KiB, se quitan entradas desde el principio de
la muestra de cursos, de las fuentes, de las fases, de los módulos y de las respuestas, en ese orden, hasta que
cabe: el mismo diario da siempre el mismo resumen y `recorte` dice cuánto se omitió. El resumen se guarda también
cuando el ciclo falla o la autoridad rechaza el inicio. Se escribe antes que el diario completo y por separado: si
no se puede guardar, el diario completo se archiva igual con el hecho `archivo-resumen · pendiente` y su causa, y
un fallo del diario completo no borra el resumen ya guardado. El diagnóstico lo informa con `resumenNoArchivado` y
su causa, sin cambiar el estado ni la acción del ciclo. Las causas cerradas, la forma del identificador de curso y
la clave del resumen están en `plataforma_datos/orquestacion/formas_del_diario.py`.

#### Parte de salud del resumen

El apartado `salud` dice, con lo observado en ese ciclo y nada más, cómo está la base de datos ese día. Lo compone
`plataforma_datos/orquestacion/salud_del_resumen.py` con las lecturas que cada fuente guardó en el candidato del job
(`run-<ejecución>-1/candidato`), las decisiones de retirada y la medida del error de retirada. «Este ciclo» son las
lecturas cuya hora de observación cae entre el primer y el último hecho del diario: no se mira el reloj ni cuántos
días lleva una fuente fallando. Solo lleva identificadores y recuentos, nunca títulos de cursos. Su forma cerrada está
en `formas_del_diario.py` (`es_salud_valida`).

Contiene el `veredicto` del día, un `motivo` (solo si no se pudo calcular), una `cuenta` por situación y una fila por
fuente de cursos. Qué significa cada veredicto:

| Veredicto | Significa |
|---|---|
| `sana` | Todas las fuentes de cursos dejaron una lectura sana en este ciclo. |
| `sana-parcial` | Las fuentes que dejaron lectura están sanas, pero otras aún no registran lecturas o este ciclo no se leyeron: no se da el día por sano. |
| `anomala` | Alguna lectura no es sana: es anómala (algo no cuadra: la forma, el total declarado, un valor desconocido o salidas sin explicar), incompleta (el censo no llegó entero) o reconstruida. El estado de cada fuente dice cuál. |
| `sin-lectura` | Alguna fuente se leyó, su adquisición ya registra lecturas y no dejó ninguna. Es lo primero que se mira: pesa más que una lectura anómala. |
| `sin-observaciones` | Ninguna fuente dejó lectura que valorar (por ejemplo, una orden que no lee fuentes). Ni sano ni enfermo: no hubo nada que observar. |
| `no-calculado` | El parte no se pudo calcular; `motivo` dice por qué: `sin-almacen` (no se indicó dónde mirar) o `almacen-ilegible` (una lectura o un registro guardados no cumplen su contrato o no se pudieron leer). El resumen se archiva igual y el diario lo anota con el hecho `parte-de-salud · no-calculado`. |

Cada fila de `fuentes` lleva:

- `registro`, la situación de la fuente: `lee` (dejó lectura en este ciclo), `sin-lectura` (se leyó y no dejó
  lectura), `no-registra-todavia` (se leyó, pero su adquisición aún no emite lecturas) o `no-leida` (este ciclo no se
  descargó). Ninguna de las dos últimas se da por sana.
- `descarga`: cómo terminó su etapa de descarga según el diario (estado y causa), que explica por qué falta una lectura.
- `estado`, el peor de sus ámbitos: `sana` (completa y sin nada extraño), `anomala` (completa, con al menos un motivo:
  `forma_cambiada`, `total_declarado_distinto`, `valor_desconocido` o `salidas_no_explicadas_en_bloque`), `incompleta`
  (el censo no llegó entero: `sin_censo`, `consulta_fallida` o `limite_alcanzado`) o `reconstruida`.
- `lecturas`, una por ámbito: estado y motivos, recuento bruto (lo que trajo la captura), vigente y declarado por la
  fuente, cursos que entraron, salidas explicadas (`fin_publicado` o `fuente_declara_baja`) y sin explicar, valores nuevos
  y si cambió la forma.
- `decisiones`: cuántos registros de decisiones de retirada hay en el ciclo, las retiradas por grupo que las sostuvo
  (`fuente`, `censo_y_pagina`, `censo_repetido`), los pendientes y los cursos que se mantienen. Sin registros, todo a cero
  con `registros: 0`: hoy nada del ciclo guarda aún decisiones.
- `error`, el error de retirada observado en todo el historial: `medido` (con su `cota95`, y la `tasa` solo si algún
  curso retirado reapareció), `sin-retiradas-comprobables` (ninguna retirada tiene aún una lectura sana posterior: no hay
  tasa ni cota) o `sin-medida`. Siempre es un límite inferior (`naturaleza`): un curso retirado por error que la fuente
  nunca vuelve a listar no se ve.

El diario se archiva con la instalación del candidato (`ejecutar_mantenimiento.raiz_del_ciclo`). Una orden que no lee
fuentes (activar, reconciliar, recuperar o reanudar un recibo ya conservado) no crea ese candidato y su parte sale
`sin-observaciones`.

Una lectura temporalmente interrumpida se reintenta hasta dos veces. Si se pierde el acuse de un recibo
ya conservado, el supervisor recupera y verifica sus bytes antes de reenviarlo. Una discrepancia de
integridad queda registrada y conserva la última publicación confirmada.

El cron extraordinario de recuperación puede sustituir una ejecución del mismo día si GitHub confirma
su cierre y la base acredita que nunca concedió permiso para arrancar el motor. La reserva de sustitución
y los identificadores de ambas solicitudes se guardan juntos en `administracion_recuperaciones_sin_inicio`.
El día admite un solo relevo. Las entregas duplicadas del cron diario conservan la reserva original.

`plataforma_datos/orquestacion/comprobaciones_remotas.py` conserva el último ciclo, el intento de cada fuente y la
última comprobación admitida de cada conjunto en `var/actualizacion/ejecuciones/comprobaciones.json`.
El archivo tiene un contrato cerrado, tamaño limitado y escrituras atómicas bajo el cerrojo del motor.
No acumula un historial ilimitado. Un ciclo nuevo identifica los intentos interrumpidos; no inventa su éxito.
Antes de abrirlo, el planificador ya trata como interrumpido el intento que un corte dejó «en-curso».
Los registros escritos antes de existir `fallos_seguidos` siguen siendo legibles: sin la cuenta, un
último intento fallido o interrumpido vale por un fallo, y la siguiente escritura añade el campo.

Si Biblioteca (`enlaces_lecturas`) o acreditación fallan después de descargar, sus originales vuelven a
lo publicado y nada inválido se publica. Antes, los archivos nuevos o cambiados de ese ciclo se guardan
en `var/actualizacion/ejecuciones/capturas-no-admitidas/<fuente>/`: cada archivo una sola vez por su
huella (`objetos/`) y un manifiesto por intento (`intentos/`) con su ruta original, el motivo y
`"admitido": false`. Sirven para auditar el intento; no cuentan como confirmación ni se publican, y
ningún proceso las vuelve a leer: incorporar algo de ellas exige revisarlas y hacerlo a mano. El
motivo del módulo en `estado.json` cita el manifiesto. La descarga de acreditación sigue siendo un único
lote: sus páginas dependen unas de otras (índice, textos consolidados y los PDF que estos exigen) y su
procedencia describe el lote completo, así que una URL fallida detiene la descarga y lo ya recibido
queda retenido con este mecanismo.
Un ensayo no renueva este registro productivo. Un registro existente defectuoso se rechaza.

La consulta admitida se conserva si después falla el paquete, junto con la necesidad de reconstruirlo.
Preparar un paquete no acredita que esté activo: hace falta verificar la versión servida por separado.
Por tanto, ni un código de salida cero ni este registro justifican por sí solos «Todo actualizado».

La generación operativa traslada el registro cuando existe, validado y cubierto por su inventario y sus
huellas. Las instalaciones sin registro conservan esa ausencia. El archivo nunca se sirve como dato público
ni se mezcla con las credenciales administrativas o de las integraciones.

## Límites

Las páginas de `PAGINAS_REGISTRADAS`, en
`plataforma_datos/cursos/fuentes/acreditacion/piezas/constantes.py`, se revisan manualmente cada mes.
Esa cadencia es distinta del aviso técnico: `avisos_de_paginas` avisa, sin bloquear la validación,
cuando han pasado **más de 60 días** (`MAX_DIAS_REGISTRO`) o falta la huella. Una fecha ilegible o
futura sí se rechaza. No hay que esperar al aviso para hacer la revisión mensual.

La revisión comprende todas las direcciones e idiomas de cada entrada:

| Entrada | Páginas oficiales | Contenido que se contrasta con `dice` y con el bloque publicado |
| --- | --- | --- |
| `tramite` | Trámite 21900, [catalán](https://tramits.gencat.cat/ca/tramits/tramits-temes/21900_Acreditat) y [castellano](https://tramits.gencat.cat/es/tramits/tramits-temes/21900_Acreditat) | Fecha editorial, requisitos y opciones de inscripción, convenios y presentación de documentos. |
| `expedicion` | [Solicitud de certificados y acreditaciones parciales](https://tramits.gencat.cat/ca/tramits/tramits-temes/Sollicitud-de-certificats-professionals-i-acreditacions-parcials-acumulables) | Fecha editorial, condiciones de expedición y ausencia o presencia de tasas. |
| `agencia` | [Em vull acreditar](https://fp.gencat.cat/ca/acreditacio/em-vull-acreditar/) | Información vigente de acreditación y destino de los enlaces. |
| `orientacion` | [Buscador de puntos de información y orientación](https://fp.gencat.cat/ca/detalls/article/Cercador-de-Punts-dInformacio-i-Orientacio-professionals) | Vigencia del buscador y sus instrucciones de orientación. |
| `cornella` | [Acreditación de competencias en Cornellà](https://www.cornella.cat/ca/treballar-a-cornella/busco-feina/acreditacio-de-competencies-professionals) | Condición de punto de información, atención en Can Mercader con cita y teléfono; `telefono` debe figurar literalmente en `dice`. |
| `sindicatura` | [Índice de informes de la Sindicatura](https://www.sindicatura.cat/informes) y el informe 15/2026 enlazado | Identidad y edición del informe, cifras de plazo medio y páginas 45–47 citadas; comprobar también si hay una publicación posterior que cambie su alcance. |

1. Comparar la entrada vigente de `PAGINAS_REGISTRADAS` con su copia en
   `var/actualizacion/preparados/acreditacion/paginas-registradas.json`: URL por idioma, fecha
   `comprobado`, huellas `sha256`, cita `dice` y, en Cornellà, `telefono`. Abrir manualmente las páginas
   oficiales, respetando sus restricciones de acceso; esta revisión no habilita descargas automáticas
   de los sitios excluidos. Comprobar el contenido citado, la fecha editorial visible y los avisos de
   sustitución o modificación. `comprobado` identifica el día real de revisión, no la fecha editorial
   de la página ni la de reconstrucción del paquete.
2. Conservar la copia de página o documento que se haya podido guardar y registrar, junto a la
   evidencia de revisión, su nombre y ruta, URL solicitada y final, idioma, fecha de consulta, fecha
   editorial y pasajes comprobados. Calcular SHA-256 sobre los bytes de ese fichero, por cada idioma;
   cotejar con la huella registrada y, cuando esté disponible, con la copia anterior. Los nombres de
   estas copias manuales no están fijados en `PAGINAS_REGISTRADAS` ni se descargan en la etapa
   automática. Si falta la copia anterior, declarar ese límite en vez de afirmar igualdad de bytes.
   Si no se puede leer la página, no renovar su fecha de comprobación. Si la revisión no tiene copia
   guardada, registrar `sha256` como `None` y explicar el alcance y la ausencia de copia en `dice`;
   el aviso seguirá visible. Cornellà exige además una huella registrada para admitir su teléfono.
   Confirmar un enlace desde otra página no equivale a revisar su destino.
3. Si la huella cambia, comparar el contenido antes de aceptar la nueva captura. Un cambio de
   requisitos, tasas, teléfono, plazos, norma o publicación exige revisar las afirmaciones y los
   consumidores afectados; no se registra como «sin cambios». Conservar la diferencia y su decisión
   antes de incorporar el contenido revisado. Actualizar `comprobado`, `sha256`, `dice` y los demás
   campos solo con lo realmente comprobado: nunca adelantar la fecha ni sustituir una huella para
   eliminar un aviso o conseguir una validación favorable. Después de incorporar una revisión,
   las etapas existentes `preparar` y `validar` de `plataforma_datos.cursos.fuentes.acreditacion.lector` regeneran
   la copia preparada y `var/actualizacion/validados/acreditacion/{validacion,acreditacion}.json`;
   no editar esos resultados derivados a mano.

El validador comprueba las fechas, la presencia de huella y la coincidencia del teléfono con la cita;
no abre estas páginas ni recalcula las huellas de sus copias manuales. El conjunto exporta la menor
fecha `comprobado` de las páginas y, por separado, la del punto de información. Una consulta automática
completa del corpus BOE/SOC tampoco sustituye esta revisión mensual ni renueva sus fechas.

- El programa que aplica la regla de `docs/acreditacion/norma-fijada.md` y escribe `admitidas.tsv` y `descartadas.tsv`
  no forma parte del producto: esas listas se conservan como entradas operativas (`plataforma_datos/orquestacion/README.md`) y no
  se pueden regenerar desde aquí. La regla no se edita: su huella SHA-256 está fijada en el código.
