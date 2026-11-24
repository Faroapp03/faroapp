# Ejecutor de actualización

La actualización remota utiliza un workflow fijo de GitHub y el almacén administrativo existente.
Su configuración es privada del servidor. No se envían desde el navegador rutas, órdenes,
destinos, secretos ni identidades de confianza. La capacidad está apagada si no se define
`FARO_ACTUALIZACION_GITHUB`.

## Configuración de la entidad

`FARO_ACTUALIZACION_GITHUB` contiene un objeto JSON con esta estructura; sustituir los marcadores
por los datos del repositorio y de la revisión autorizada:

```json
{
  "version": 1,
  "destino": {
    "propietario": "entidad",
    "repositorio": "herramienta",
    "workflow": "actualizar.yml",
    "ref": "main"
  },
  "confianza": {
    "audiencia": "https://dominio-de-la-entidad/mantenimiento/resultado",
    "repositorioId": "<identificador numérico del repositorio>",
    "propietarioId": "<identificador numérico del propietario>",
    "ref": "refs/heads/main",
    "workflowRef": "entidad/herramienta/.github/workflows/actualizar.yml@refs/heads/main",
    "workflowSha": "<SHA completo del workflow autorizado>",
    "sha": "<SHA completo del código autorizado>"
  }
}
```

La audiencia debe coincidir con `FARO_ADMIN_ORIGEN` seguido de `/mantenimiento/resultado`.
Repositorio, workflow y referencia de despacho deben corresponder a la identidad fijada.
Las referencias admitidas son ramas y etiquetas. Cambiar la revisión autorizada exige actualizar
sus valores de confianza; no se deducen del recibo ni de un token recibido.

`FARO_ACTUALIZACION_GITHUB_TOKEN` es un secreto independiente, limitado al repositorio y a Actions:
necesita despachar y consultar ejecuciones. Se configura en el alojamiento, nunca en ese JSON, en Git ni en la web.
La composición conserva una copia de la configuración: cambiarla requiere recomponer el servicio.
Un error de esta capacidad deja indisponible la actualización, conservando los controles y las
consultas cuya configuración es válida. No se reemplaza un trabajo corrupto por otro vacío.

## Solicitud y resultado

`POST /administracion/api/datos/actualizar` exige Access, origen, sesión administrativa y revisión
vigentes. La acción es `actualizar-datos` o `reintentar-pendientes`. Un trabajo nuevo en curso devuelve
`202`; un conflicto de revisión o trabajo ocupado, `409`. Antes de responder «ocupado», el servidor comprueba en
GitHub si el trabajo que ocupa ya terminó ([sin esperar al botón](#sin-esperar-al-botón)). Repetir la misma intención consulta su
resultado sin volver a despachar. `POST /administracion/api/datos/trabajo`, con cuerpo `{}`, permite
consultar el estado. Ninguna de estas respuestas confirma una versión activa.

`actualizar-datos` ejecuta la [búsqueda de actualizaciones](comprobaciones-periodicas.md) a demanda:
consulta las fuentes automáticas del plan sin esperar a que venza su intervalo y vuelve a preparar
y validar todos los módulos, también los de entradas locales. Así se aplican los preparadores del
código autorizado aunque sus originales no hayan cambiado. Una reconstrucción local no se registra
como una consulta oficial reciente. Los originales manuales e históricos se conservan.
`reintentar-pendientes` mantiene la selección y las esperas de los módulos fallidos, y añade las fuentes
cuyo último intento remoto falló o se cortó y cuyo reintento escalonado ha llegado. Estas dos acciones
comparten el mismo coordinador, sus controles de admisión y su cerrojo.

### Qué hace cada acción en el motor

El motor admite una lista cerrada de cinco acciones, la misma que el servidor (`ACCIONES` en
`plataforma_datos/orquestacion/almacen_trabajos.py` y `ACCIONES_TRABAJO` en `src/administracion/estado-trabajos.js`;
una prueba falla si dejan de coincidir). Un trabajo con cualquier otra acción se rechaza antes de ejecutar nada.

| Acción | Qué lee | Cómo anota el ciclo |
|---|---|---|
| `actualizar-datos` | Todas las fuentes automáticas, sin esperar su cadencia, y vuelve a preparar todos los módulos. | `manual` |
| `reintentar-pendientes` | Los módulos fallidos cuyo reintento ha llegado. | `manual` |
| `comprobar-programada` | Las fuentes cuya cadencia ha vencido. Es la tarea diaria y su recuperación. | `programada` |
| `comprobar-vencidas` | Lo mismo que `comprobar-programada`, pedido a demanda. | `vencidas` |
| `actualizar-cursos` | Las fuentes de cursos que se leen a diario, sin esperar su cadencia. | `manual` |

`comprobar-vencidas` hace la misma selección que la tarea programada, pero el trabajo lleva su propio nombre y el
registro de comprobaciones anota el ciclo como `vencidas`. Así no se confunde con la tarea programada ni con su
recuperación, que solo atiende a `comprobar-programada`. Como la programada, termina en `sin-pendientes` si no ha
vencido nada.

`actualizar-cursos` lee las fuentes de cursos con un conjunto de cadencia diaria en su `fuente.json`: formacion,
consorci, citilab, barcelonactiva, fundae, hp_life, cibervoluntarios, claude_academy y enlaces. La lista sale de las
fichas (`plataforma_datos/orquestacion/seleccion_por_tema.py`), así que una fuente de cursos diaria nueva entra sola.
Las demás fuentes no se descargan ni se ejecutan y conservan su versión publicada. Si un módulo elegido publica una
versión nueva, los que leen de él se vuelven a preparar sin descargar nada: acreditacion, nombres, perfiles y
certificados2016. Si un ciclo anterior terminó sin preparar su paquete y el registro pide recomponerlo todo, se
recomponen todos los módulos, aunque solo se descargan los cursos. Después, como en cualquier ciclo, se exporta el paquete con lo publicado de todos los módulos, se
compone el catálogo y se pasan el cotejo y las comprobaciones de datos. El recibo pasa la misma admisión que el de un
ciclo completo: el paquete tiene que estar en verde y ningún módulo puede quedar en rojo. La tarea programada ya
publica así cada día, con una parte del registro.

## Programación diaria

El adaptador Cloudflare ofrece una entrada interna `scheduled`. Utiliza el mismo almacén durable,
workflow, permiso de inicio y motor que la solicitud a demanda, con la acción `comprobar-programada`.
Esta acción selecciona las fuentes cuya cadencia por fechas UTC ha vencido y los consumidores que necesitan reconstrucción;
no se admite como acción enviada desde el panel ni se expone mediante otra ruta HTTP.

La instalación debe configurar un único Cron Trigger diario en UTC y la variable privada
`FARO_ACTUALIZACION_PROGRAMADA`. `config/cloudflare/programacion.example.jsonc` trae ambos de ejemplo.
Por ejemplo, para comprobar cada día a las 04:15 UTC:

```json
{"version":1,"habilitada":true,"cron":"15 4 * * *"}
```

El horario debe coincidir exactamente con `triggers.crons` de la configuración de Cloudflare.
Se admite un minuto y una hora concretos, sin listas, rangos ni ceros iniciales. La ausencia de la variable
o `habilitada:false` no reserva trabajos. Una configuración inválida hace fallar la ejecución programada;
no impide servir la web ni habilita una configuración alternativa. Node no instala un temporizador.

Cada fallo del manejador queda en el historial de eventos con su fase y su motivo, sin mover la marca del último
evento, y el vigilante se evalúa después en el mismo evento (ver [vigilante](../src/administracion/vigilante.md)).
La lectura de la configuración y la validación del evento, el montaje del panel y la ejecución tienen cada uno su
plazo de cinco segundos.

El horario se aprovisiona expresamente en Cloudflare: subir o activar una versión no instala los Cron
Triggers. El adaptador conserva ese campo de la configuración, pero no ejecuta `triggers deploy`.
Antes de habilitar la periodicidad deben estar comprobados el workflow, su confianza, el almacén privado
y la activación descrita más abajo. Mantener la activación deshabilitada conserva los candidatos para revisión;
no actualiza la web automáticamente.

La reserva consume el instante lógico del evento en la misma transacción que el trabajo. Una marca
monotónica impide repetirlo después de un reinicio, de otro trabajo o de una respuesta perdida. Los eventos
de más de seis horas se omiten; no se ejecuta una cola de días atrasados. Solo una reserva nueva autoriza un despacho.

Cada evento comprueba antes de omitirse si el último trabajo ha dejado de estar en plazo. La reserva dura 376
minutos desde su creación. Los tres jobs (construcción, activación y aviso) pueden sumar hasta 363 minutos de
ejecución y quedan 13 minutos de margen para las colas de GitHub y el desfase de relojes.

- Una reserva vencida sin permiso de inicio, como la de un despacho incierto por un 5xx o un tiempo agotado,
  se retira en la misma transacción que reserva el trabajo nuevo. El motor solo arranca con un permiso de inicio
  autenticado con la identidad fijada; la retirada deniega además cualquier permiso tardío para esa reserva.
- Para un trabajo sin cerrar cuyo identificador de ejecución se conoce, esté o no en plazo, el reloj consulta en
  GitHub el intento 1 con la reconciliación del panel. GitHub conserva ese intento por separado cuando se vuelve a
  ejecutar el workflow. Solo `completed` con la misma ejecución, repositorio, propietario, código y workflow la cierra
  como `ejecucion-sin-recibo`. Si sigue en curso, no responde o no puede comprobarse, el trabajo no se libera.
- Lo que no puede liberarse así queda ocupado: con el motivo `requiere-atencion` si su reserva ha vencido y con
  `trabajo-en-plazo` si no.

Ningún caso reenvía el despacho anterior: la reserva nueva lleva su propio identificador.

Las salidas del Worker (el despacho a GitHub, la consulta de la ejecución, las claves OIDC y el aviso del vigilante)
no siguen redirecciones. workerd no admite el modo `error` de `redirect`, así que todas piden con
`pedirSinRedirecciones` (`src/comun/salida-sin-redirecciones.ts`): modo `manual` y rechazo de cualquier respuesta
3xx u `opaqueredirect`. Una redirección del despacho, con la petición ya enviada, lo deja incierto; en la consulta, la
ejecución queda sin comprobar; en las claves OIDC, el recibo no se acepta. Lo comprueban en workerd
`pruebas/cloudflare/salidas-workerd.test.ts` y, para que nadie vuelva a usar el modo `error` en código del Worker,
`pruebas/cloudflare/salidas-sin-redirect-error.test.ts`.

Una activación en curso conserva el trabajo que va a publicar. Después de aceptar un recibo validado, SQLite guarda
en la misma transacción su solicitud, revisión, ejecución, huella de recibo, revisión de código y fecha. Durante el
plazo de la ejecución, el evento registra `candidato-en-plazo` para darle tiempo a reservar la activación.

Si la ejecución se corta antes de reservarla, el siguiente evento con activación automática habilitada encarga a un
trabajo nuevo revalidar el paquete. Con fuentes vencidas se ejecuta el plan ordinario. Con todas al día se reconstruye
el paquete con las evidencias guardadas y se comprueba su integridad. El permiso de inicio, el recibo y la activación
siguen vinculados a la identidad OIDC de la nueva ejecución. El vigilante muestra el pendiente tras vencer el plazo,
incluso si la siguiente construcción falla. Un recibo validado posterior reemplaza al anterior y conserva la fecha
del primer paquete pendiente hasta concluir su activación. El vigilante mantiene el aviso durante una promoción
incompleta. La confirmación consume únicamente la marca de su propio trabajo. Si la activación demuestra que el
artefacto falla la comprobación de integridad, registra el rechazo. Una intención existente sigue su cauce habitual
de confirmación, recuperación o rechazo.

El almacén guarda de cada evento consumido su instante, la hora de registro, el resultado y el motivo, en la
misma transacción que la marca. Los resultados son `nueva` (se reservó y despachó un trabajo; lleva el motivo
`ejecucion-cerrada-sin-recibo` si la ejecución anterior se cerró con GitHub sin recibo), `omitida-ocupado` (otro
trabajo sigue abierto), `omitida-candidato` (hay una activación sin resolver o un candidato validado de una
ejecución todavía en plazo) y `omitida-tardia` (el evento llegó fuera de la ventana de seis horas).
Conserva los 60 más recientes y no contiene personas, identificadores de GitHub ni credenciales.
La comprobación del vigilante del panel los entrega en `eventosProgramados`. Un fallo anterior a la reserva no
consume el evento: el vigilante lo señala como evento esperado sin registro.

Los recibos nuevos usan la versión 2. `sin-pendientes` significa que no había módulos fallidos para reintentar
o selección automática para la acción programada. No construye ni activa otro artefacto, no renueva las fechas
de consulta y no afirma «Todo actualizado». Los lectores conservan la versión 1 con sus acciones originales;
un reenvío mantiene sus bytes exactos. Un intento ejecutado conserva su diario y generación operativa también
si resulta rechazado, siempre que esa generación pueda comprobarse íntegramente.

Una solicitud manual posterior también puede sustituir el último trabajo terminado; una activación ya reservada
conserva su propia copia del trabajo.

## Permiso de inicio y recibo

El workflow recibe `solicitud_id`, `revision_reserva` y `accion`. Antes de construir o actualizar la copia,
solicita permiso a `POST /mantenimiento/inicio`, con JSON `{solicitudId, revisionReserva, accion}` y
`Authorization: Bearer <OIDC>`. Usa la misma audiencia configurada para el servicio de resultados.
El receptor devuelve `200` y estado `aplicado` o `repetido`; una respuesta incierta no autoriza
a ejecutar. Para comenzar el motor desde cero, el ejecutor exige `aplicado`. Un `repetido` sin recibo
ya conservado se detiene: podría corresponder a otra invocación que comenzó el motor. Repetir ese
inicio con la misma ejecución es idempotente en el servidor. El servidor asocia la reserva
al identificador de ejecución, exige el intento `1` y rechaza reservas retiradas o terminadas.
El cuerpo se limita a 4 KiB y el plazo a cinco segundos.

Cuando GitHub ejecuta una revisión que el servidor todavía no tiene autorizada, el permiso se niega con el mismo
`401 no_autorizado` que cualquier otro rechazo, pero queda constancia. Para ello el token tiene que ser válido en todo
lo demás: firma, emisor, audiencia, repositorio, propietario, rama, workflow, ejecución, intento `1` y plazos, y la
reserva de la petición tiene que ser la que espera inicio. Solo difieren `workflow_sha` o `sha`. En ese caso el
servidor guarda en la reserva `inicioRechazado: {en, motivo: 'revision_no_autorizada'}`, una sola vez: los intentos
siguientes de esa reserva no escriben nada. No guarda la revisión recibida ni nada más del token. La revisión de un run
ya consta en GitHub, y la autorizada, en la confianza de la reserva. Una petición sin identidad válida no deja rastro:
no llega a escribir, y su respuesta es idéntica. El hecho no sale en el estado de trabajos que lee el panel. El
vigilante lo da como `ejecutor · inicio_rechazado` sin esperar al plazo de inicio, y en Cloudflare el mismo
registro dispara la evaluación y el aviso en segundo plano (`waitUntil`), sin retrasar ni cambiar el 401 (ver
`src/administracion/vigilante.md`). Guardar el hecho avanza la revisión del documento de trabajos: una retirada desde
el panel preparada antes con la revisión anterior recibe `conflicto` una vez, y pasa al releer el estado. Si la autoridad no responde al guardar el hecho, el receptor contesta como a
cualquier fallo de la autoridad (`503` o `504`), igual que si fallara la lectura de la reserva.

Su último paso de construcción
envía el recibo del candidato, añadiendo `solicitudId` y `revisionReserva` sin modificarlos, a
`POST /mantenimiento/resultado`, con `Content-Type: application/json` y `Authorization: Bearer <OIDC>`.
Este punto utiliza la identidad OIDC de GitHub, no una sesión humana de Access ni una clave de la API.
La política del alojamiento debe permitir que llegue a ese receptor autenticado sin exigirle el
código por correo del panel; no se debe abrir el acceso anónimo a `/administracion`.

Los receptores comprueban firma, audiencia, repositorio, workflow, revisión de código, ejecución e
intento. El de resultado también valida el recibo y el estado de datos. Guarda de forma atómica el resumen,
la huella del cuerpo completo y la observación por fuente cuando el recibo la aporta, sin conservar el JWT ni
publicar rutas o registros internos. La observación mantiene su fecha y queda ligada a esa reserva y ese recibo;
no se presenta como estado de un trabajo posterior ni como prueba de activación. Una repetición debe conservar
los mismos bytes. Los recibos de otra reserva se rechazan incluso si reutilizan el identificador.
Un trabajo nuevo no admite un resultado válido o sin pendientes sin permiso de inicio confirmado.
Un rechazo de construcción puede cerrar el trabajo sin ese permiso, pero nunca acredita un candidato.

### El cierre sin recibo

Cuando el motor no deja un recibo válido (se agota su plazo, lo interrumpe una señal o termina sin recibo), o lo deja
rechazado porque no le quedaba tiempo, el supervisor envía a la misma ruta, con la misma identidad OIDC, un cierre sin
recibo. Su forma es cerrada y no lleva versión, que es lo que lo distingue de un recibo:

```json
{"solicitudId": "…", "revisionReserva": 7, "accion": "comprobar-programada",
 "ultimoFallo": {"causa": "plazo-insuficiente", "paso": "paquete"}}
```

`causa` es una de `plazo-agotado`, `plazo-insuficiente`, `motor-terminado-por-senal` y `motor-sin-recibo`; `paso` es
un nombre del diario del supervisor (`[a-z0-9][a-z0-9_-]{0,63}`): el paso que no empezó por la hora límite, el último
que quedó sin terminar o `motor` si el ciclo no dejó registro. No viaja nada más: ni mensajes, ni rutas, ni
identificadores del ciclo. El receptor solo lo admite de la ejecución que obtuvo el permiso de inicio de esa reserva.
Si el trabajo seguía abierto, lo termina como `ejecucion-sin-recibo`; si ya tenía un recibo rechazado sin explicar,
le añade el porqué. Repetir el mismo cierre devuelve `repetido`; uno distinto, `conflicto`. Si el envío falla, el
diario lo anota como `cierre-sin-recibo` `no-confirmado` y el supervisor termina con el fallo del motor, como sin él.

El resultado del trabajo lleva entonces `ultimoFallo: {causa, paso}`. Cuando GitHub da por completada una ejecución
que no envió ni recibo ni cierre, el servidor lo cierra con `ultimoFallo: {"causa": "sin-resultado", "paso": null}`.
El campo solo acompaña a un resultado `rechazado` o `ejecucion-sin-recibo`, y el trabajo siguiente lo sustituye: uno
correcto ya no lo lleva.

El receptor admite como máximo 132 KiB y tiene un plazo de cinco segundos. El espacio de rutas
`/mantenimiento` no sirve archivos estáticos, incluso con la capacidad deshabilitada. El enlace del entorno
de almacenamiento usa rutas internas que no se exponen en la API pública.

## La reserva a demanda en el servidor

Un run lanzado a mano pide su reserva a `POST /mantenimiento/reserva`, antes de pedir el permiso de inicio. La
frontera es la del permiso de inicio: `POST`, `Authorization: Bearer <OIDC>` con la misma audiencia,
`Content-Type: application/json`, un cuerpo de 1 KiB como mucho y un plazo de cinco segundos. La ruta es un canal de
máquina: no pasa por Access ni por la sesión del panel.

La vía solo existe si `FARO_ACTUALIZACION_DEMANDA` es válida y está habilitada, y si `FARO_ACTUALIZACION_GITHUB` está
configurada (de ella sale la confianza que se fija en la reserva). Si falta, está deshabilitada o no es válida, la ruta
responde `404` sin cuerpo, igual que cualquier ruta inexistente de `/mantenimiento`, también con un token válido.

Primero se verifica la identidad y después todo lo demás. El token tiene que ser de la revisión y el workflow
autorizados, de un lanzamiento manual (`workflow_dispatch`), de un runner alojado por GitHub, que el token tiene que declarar, y
de un actor de la lista (`actor_id`). Para reservar, además, del intento `1`. Cualquier fallo de identidad responde el
mismo `401 no_autorizado`, con `WWW-Authenticate: Bearer`, que el permiso de inicio negado. No dice el motivo, no lee
el cuerpo y no llega a la autoridad.

Con una identidad válida se lee el cuerpo, que tiene que ser exactamente `{operacion, accion}`: `operacion` es
`reservar` o `consultar`, y `accion` es `actualizar-datos`, `comprobar-vencidas` o `actualizar-cursos`. Cualquier
otro cuerpo responde `400 solicitud_invalida`.

| Operación | Respuesta |
|---|---|
| `reservar`, admitida | `200 {estado: 'reservada' \| 'repetida', solicitudId, revisionReserva}`. Una sola reserva por run: repetir la petición devuelve `repetida` y la misma reserva |
| `reservar`, no admitida | `409 {error}` con el motivo exacto: `ocupado`, `activacion_pendiente`, `candidato_en_plazo`, `separacion`, `tope_dia`, `tope_mes` o `presupuesto`. Antes de pedir la reserva, el receptor comprueba en GitHub si el trabajo abierto de otro run ya terminó ([sin esperar al botón](#sin-esperar-al-botón)) |
| `consultar` | Desde cualquier intento del mismo run: `200 {estado: 'reservada', solicitudId, revisionReserva}`, o `404 {error: 'sin_reserva'}` si ese run no tiene reserva. Nunca crea una |
| La autoridad no responde | `503 no_disponible` o `504 plazo_agotado`, como en el permiso de inicio |

Un reintento del run puede consultar, pero no reservar: su petición de reserva recibe el mismo `401`. Para la
consulta basta con que el token sea de la revisión y el workflow autorizados, porque la reserva que devuelve la obtuvo
el primer intento de ese mismo run con la verificación completa. La autoridad vuelve a comprobar la identidad, las
guardias y los topes dentro de su transacción. Si para ella la vía está cerrada, la ruta responde el mismo `404` de
una ruta inexistente. Ni el token ni el actor salen en la respuesta ni en el registro.

El ciclo diario tiene prioridad sobre una petición a demanda que aún no ha empezado. Si llega la tarea programada
y el trabajo abierto es una reserva a demanda sin permiso de inicio, la autoridad la libera, la anota con su motivo y
reserva el ciclo del día en la misma transacción. El run a demanda que pida después su permiso de inicio lo ve
rechazado y su consulta responde que ya no hay reserva; la petición sigue contando en los topes de quien la hizo. Una
actualización a demanda que ya empezó sigue ocupando, y la tarea programada se omite como con cualquier trabajo en
curso.

El gasto de cada trabajo se cuenta con un margen fijo de minutos sobre lo medido entre el permiso de inicio y el
recibo, porque esa medida no incluye la preparación ni la activación. El mismo margen se suma a cada ciclo
programado que queda en el mes al calcular la reserva que las peticiones a demanda no pueden consumir.

El servidor local de Node no tiene la autoridad de la reserva a demanda: allí `POST /mantenimiento/reserva` responde
siempre `404`.

## Recuperación de una ejecución interrumpida

Estas operaciones requieren la misma identidad, origen y sesión administrativa que el resto del panel:

- `POST /administracion/api/datos/retirar`, con `{solicitudId, revisionReserva, revisionEsperada}`:
  retira una reserva nueva que aún no tiene inicio confirmado. La revisión y la sesión se comprueban
  en la transacción. El permiso de inicio tardío queda denegado; no se cancela una ejecución ya iniciada.
- `POST /administracion/api/datos/reconciliar`, con `{solicitudId, revisionReserva}`: consulta el
  identificador de ejecución almacenado mediante un GET autenticado a GitHub. Coteja repositorio,
  propietario, código, workflow, evento e intento. Solo `completed` con una conclusión reconocida
  permite registrar `ejecucion-sin-recibo`, sin huella de candidato ni veredicto de validación.

Si GitHub sigue ejecutando, no responde o no permite comprobar esos datos, el trabajo no se libera.
Un `404`, una petición de cancelación o un timeout no demuestran terminación. Un recibo admitido
durante la consulta no se sobrescribe. Las respuestas al navegador contienen solo el estado público.
No se renueva la sesión por sondear ni se reenvía el despacho automáticamente.

### Sin esperar al botón

Un trabajo que terminó en GitHub sin dejar recibo (se agotó el plazo del motor, o falló al preparar el entorno antes
de que el supervisor pudiera cerrarlo) seguiría ocupando hasta que alguien pulsara «Comprobar cómo terminó». Para que
no dependa de eso, cada petición de reserva que encuentra el último trabajo abierto con su ejecución conocida hace
ella misma esa consulta, con la misma pieza, la misma identidad y la misma lista cerrada de resultados:

- **Botón de actualizar.** Si la autoridad responde «ocupado», el servidor consulta el run. Si GitHub lo da por
  completado, registra `ejecucion-sin-recibo` (con `ultimoFallo` `sin-resultado`) y vuelve a pedir la reserva una
  sola vez, con la revisión siguiente: si entre medias cambió algo más que ese cierre, la respuesta es un conflicto y
  la persona vuelve a ver el estado antes de decidir. Repetir después la petición original responde `repetida` con
  la misma reserva, sin despachar otra vez.
- **Reserva a demanda.** El receptor consulta antes de pedir la reserva, para que la autoridad decida con el fin ya
  registrado y no anote un rechazo que no lo es. No consulta el run que pide, que sigue en curso mientras pregunta.
- **Evento diario.** La autoridad pide la consulta antes de consumir el evento, como explica la
  [programación diaria](#programación-diaria).

Es un solo GET por petición, sin reintentos, y gasta como mucho 1,5 segundos del plazo de la petición; el resto queda
para reservar y despachar. Si el run sigue en curso, GitHub no responde, tarda más o la identidad no coincide, la
petición recibe «ocupado» como siempre y nada cambia. El trabajo se consulta siempre en el repositorio y con la
identidad fijados en su propia reserva, también si la configuración ha migrado a otro repositorio después.

El documento privado de trabajos pasa a versión 2. La preparación migra los documentos válidos de
versión 1 conservando su revisión, trabajo y reloj. Esos trabajos se identifican como anteriores al
protocolo: no se les atribuye un permiso de inicio ni se permite retirarlos suponiendo que no empezaron.
Sus recibos mantienen las comprobaciones originales; si se conoce el identificador remoto, pueden
reconciliarse. La migración no reinicia sesiones, credenciales, controles ni cuotas.

## Preparar la copia candidata

El aprovisionamiento local combina una revisión autorizada del código con una generación operativa verificada.
Requiere Git y Python de la instalación de mantenimiento. Las revisiones completas y la huella
esperada proceden de la configuración privada del ejecutor; no se toman del contenido recibido.
La revisión del código nuevo puede ser distinta de la que produjo los datos anteriores.

Desde una instalación con sus dependencias de Python preparadas:

```sh
.venv/bin/python -m plataforma_datos.orquestacion.aprovisionar_candidato \
  /ruta/al/checkout /ruta/privada/candidato-nuevo \
  --revision-codigo "<SHA-de-la-revision-autorizada>" \
  --generacion /ruta/privada/generacion-base \
  --revision-generacion "<SHA-que-produjo-la-generacion>" \
  --sha256-generacion "<SHA256-esperado-del-manifiesto>"
```

Las rutas son ejemplos; sustituirlas por las del ejecutor y entrecomillarlas cuando contengan espacios.
El destino debe ser nuevo, fuera del checkout y de la generación, bajo una carpeta privada del job.
Ningún otro escritor debe modificar esas entradas ni la carpeta de destino durante la operación.
El checkout debe ser la raíz de su repositorio de trabajo y contener ya los objetos necesarios:
no se descargan objetos ausentes. La extracción del código admite hasta 20.000 archivos en el árbol,
64 MiB por archivo incorporado y 512 MiB en conjunto, con un plazo de 60 segundos. Estos límites
son distintos de los de la generación de datos, que se verifica por separado.
El código se extrae de los objetos de esa revisión: no se incorporan cambios del directorio de trabajo,
archivos sin seguimiento, `.git`, dependencias instaladas, perfiles privados, credenciales o sesiones.
Los recursos estáticos versionados se conservan. Los árboles `datos/` y `var/actualizacion/` se
obtienen juntos de la generación, después de comprobar sus huellas, inventario y admisión.
Los originales cartográficos, que no forman parte de la actualización periódica, se conservan
separadamente para reconstruir el globo conforme a la [guía de construcción](construccion-web.md).

La copia se prepara en un temporal propio y solo se publica en su destino cuando está completa.
Un destino existente se rechaza. Una interrupción puede dejar un temporal propio; no autoriza
a utilizarlo. El resumen JSON identifica ambas revisiones y la generación, sin rutas internas.
Preparar esta copia no instala dependencias, descarga fuentes, firma ni activa una versión.
Las dependencias fijadas se preparan previamente en el mismo checkout; el ejecutor las enlaza a
la copia privada y no utiliza dependencias de otra revisión. Ejecuta `plataforma_datos.orquestacion.candidato` en un proceso separado
y conserva su recibo fuera de la copia. Los artefactos web deben reconstruirse y verificarse antes de servirla.

## Ejecutar y conservar el trabajo

`plataforma_datos.orquestacion.ejecutar_mantenimiento` compone el aprovisionamiento, el candidato, el almacén privado
y los receptores autenticados. Requiere un checkout privado e intacto de la revisión del evento, Node
admitido por `package.json`, sus dependencias fijadas y `.venv` con `requirements-dev.txt`. El proceso
de preparación debe terminar antes de proporcionar las credenciales del almacén. No ejecutar código
de pull requests ni admitir órdenes, referencias de Git o destinos como entradas libres del despacho.

### Qué comprueba el ciclo

El ciclo ejecuta una revisión que ya pasó la batería completa (`npm run verificar`: tipos, estilo, controles, pruebas
de unidad, de navegador y de Python) para poder publicarse; esa batería no se repite en cada ciclo, porque el código no
cambia. Lo nuevo son los datos, y el ciclo comprueba todo lo que los lee. Cada módulo valida lo que descarga y prepara.
Después, el paquete nuevo se compara con el vigente y pasa por la cuarentena. La web local se construye con él y se
cotejan sus artefactos (`npm run web:preparar`). Por último, `npm run verificar:datos` (scripts/verificar-datos.ts)
ejecuta la comprobación de la base ESCO, los controles que leen `datos/` o `web/datos/` y las pruebas de Node y de
Python que abren el paquete real, el almacén validado o la web construida con él. No abre navegadores y tiene el plazo
de 45 minutos de cada orden. Un dato corrompido detiene el ciclo igual que detendría la batería completa:
`pruebas/herramientas/verificar-datos.test.ts` lo comprueba con un archivo alterado. Las pruebas de navegador y las
de código siguen en `npm run verificar`, que es lo que exige publicar una revisión.

Con `FARO_HUMO_CHROMIUM` distinto de `0` (por omisión), la orden abre además el humo de datos en Chromium
(`pruebas/web-publicacion/humo-de-datos.test.ts`): Cursos pinta los cursos vigentes del catálogo, la búsqueda filtra y
el informe de ejemplo se abre, sin errores de consola. En el ciclo el humo es obligatorio: si Chromium no queda
listo, el job para antes del supervisor, no publica y la ejecución anota la causa en sus avisos y en su resumen.

| Lo que ejecuta `npm run verificar` | En cada ciclo | Al publicar | Por qué es seguro |
| --- | --- | --- | --- |
| Versión de Node y base ESCO | sí | sí | La huella de la base la fija el manifiesto del paquete. |
| Tipos, Biome, Ruff y formato | no | sí | Solo leen código, que es el de la revisión ya publicada. |
| Vectores y clasificador del móvil, informe de ejemplo, datos globales, Biblioteca, construcción Cloudflare | sí | sí | Leen `datos/` o `web/datos/`. |
| Utilidades compartidas, OpenAPI, fuentes de la web, huellas CSP de portada y acceso | no | sí | Leen `src/` y fuentes de `web/` que el ciclo no cambia; la CSP de cada página construida la coteja `web:preparar`. |
| Web local: construcción, integridad y copia sin conexión | sí (`web:preparar`) | sí | Es el cotejo de artefactos del ciclo. |
| Python y SQLite con FTS5 | sí (preparación del runner) | sí | Depende del runner, no del código: el preparador lo comprueba en cada ejecución. |
| Pruebas de unidad de Node | las que leen el paquete | todas | Las demás no abren el paquete; la medición (`--medir`) lo comprueba. |
| Pruebas de navegador, en tres motores | humo en Chromium | todas | El humo abre con el paquete nuevo lo que pinta datos; el resto prueba código. |
| Pruebas de Python | las que abren el paquete | todas | Las demás trabajan con copias temporales; la medición lo comprueba. |

El contexto del job proporciona los argumentos del despacho mediante variables de entorno.

| Variable | Procedencia |
| --- | --- |
| `GITHUB_ACTIONS`, `GITHUB_EVENT_NAME`, `GITHUB_WORKSPACE`, `GITHUB_SHA` | Runner de GitHub; evento `workflow_dispatch` |
| `GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT` | Runner; intento `1` para construcción, resultado y activación inicial; intentos posteriores solo para recuperar una activación existente |
| `ACTIONS_ID_TOKEN_REQUEST_URL`, `ACTIONS_ID_TOKEN_REQUEST_TOKEN` | Runner con permiso `id-token: write`; no son secretos permanentes de Faro |
| `FARO_SOLICITUD_ID`, `FARO_REVISION_RESERVA`, `FARO_ACCION` | Los inputs `solicitud_id`, `revision_reserva` y `accion` del despacho |
| `FARO_REVISAR_PAQUETE_PENDIENTE` | El despacho diario puede pedir la revalidación del paquete. El workflow la habilita únicamente con activación automática y el supervisor exige una acción programada. |
| `FARO_ACTUALIZACION_ORIGEN` | Origen HTTPS administrativo autorizado, sin ruta ni barra final |
| `FARO_CLOUDFLARE_VARIANTE` | Variable del repositorio: variante de Cloudflare de la instalación, `oficial` o `privado`; producción usa `oficial` |
| `FARO_ALMACEN_S3` y sus dos credenciales | Tres secretos del repositorio: [configuración privada del almacén](almacenamiento-datos.md) |

Con `checkout` y `trabajos` sustituidos por directorios privados del runner:

```sh
.venv/bin/python -m plataforma_datos.orquestacion.ejecutar_mantenimiento ejecutar \
  "/ruta/checkout" "/ruta/privada/trabajos"
```

La herramienta comprueba la identidad, la revisión y el árbol versionado antes de abrir conexiones.
Un directorio exclusivo por ejecución y el permiso del servidor impiden repetir el motor. El candidato
recibe un entorno limitado, con HOME y temporales propios; no hereda las claves S3, OIDC, proveedores
de IA ni la configuración administrativa. El recibo pasa por el mismo lector de contrato que utiliza
el servidor. Si el candidato es válido, el ejecutor conserva primero su generación operativa y
exporta la construcción completa de Cloudflare desde ese mismo candidato, con la variante declarada
en `FARO_CLOUDFLARE_VARIANTE` (`--destino-cloudflare`). La variante no tiene valor por omisión: sin ella,
o con otro valor, la orden se detiene antes de abrir conexiones y dice qué variable falta. Cada variante lleva su propio Worker
principal y solo la oficial atiende el disparador horario. La exportación tiene un
plazo de cinco minutos y recibe el mismo entorno filtrado. Se comprueba y conserva el artefacto
antes de escribir el recibo, el índice del intento y la referencia operativa. Un rechazo o una
ejecución sin pendientes no construyen un artefacto. Las operaciones de almacenamiento se
comprueban mediante lectura posterior.

El índice privado vincula la construcción, el código autorizado y el paquete del recibo. También
coteja el SHA-256 completo del manifiesto del paquete con el de la generación operativa; la huella
corta no sustituye esa comparación. Si falla la construcción, su conservación o el cotejo, no se
escribe el índice ni se confirma el resultado al servidor. Los archivos locales solo están disponibles
mientras exista el directorio privado del job; un runner efímero no garantiza conservarlos después.
No se convierte ese fallo en un candidato admitido ni se repite el motor.

Si solo quedó pendiente confirmar el resultado, dentro del **mismo job e intento autorizado**, se puede
invocar `reanudar` con los mismos argumentos. Recupera el recibo privado y completa su confirmación
sin ejecutar el motor ni reconstruir el artefacto. Para los índices privados de versión 2 vuelve a
comprobar los marcadores y sus vínculos; no descarga todo el contenido ni acredita una activación.
Los índices de versión 1 se reenvían conservando su formato y recibo originales, sin atribuirles una
construcción que no registraron. Si ya existe un trabajo posterior, se rechaza el reenvío; el recibo antiguo
permanece disponible para auditoría. `reanudar` sigue limitado al intento `1`: no recupera resultados desde
un reintento de GitHub. «Re-run jobs» solo permite la recuperación de una activación existente descrita más abajo.
No se debe automatizar la repetición de `ejecutar` tras cualquier error. Sin índice durable no se
puede reanudar un motor cuya ejecución es incierta; corresponde comprobar la terminación remota
y conciliar el trabajo mediante el protocolo anterior.

Cada fase obtiene un JWT nuevo para la audiencia fijada. Las peticiones usan TLS, el perfil genérico central (UA y tres pistas),
cuerpos acotados y no siguen redirecciones ni reintentos automáticos. El cliente aplica un presupuesto
de 15 segundos por fase, con conexión y lectura de socket limitadas a cinco segundos; una operación
ya iniciada de DNS o del sistema puede añadir margen. El job debe imponer también un plazo global.
Un error no imprime cuerpos, rutas privadas ni credenciales, ni se interpreta como permiso o éxito.

## Workflow de GitHub

El producto incluye `.github/workflows/actualizar.yml`. Se ejecuta solo por `workflow_dispatch`,
con los tres argumentos obligatorios y el indicador opcional de revalidación de paquete.
El intento original construye el candidato; los posteriores solo recuperan una activación existente
y requieren que siga habilitada esa capacidad. El servidor debe reservar el trabajo antes del despacho.
Una ejecución manual sin una reserva autorizada no obtiene permiso para iniciar el motor, salvo que se lance
a demanda: entonces el propio run pide su reserva (ver [Lanzar una actualización a demanda](#lanzar-una-actualización-a-demanda)).

El runner `ubuntu-24.04` (x64) utiliza Node **24.22.3** y Python **3.12.15**, ambos con SQLite **3.54.1**.
Cuando falta Node descarga la distribución Linux x64 y su `SHASUMS256.txt` de nodejs.org y comprueba la suma.
El preparador copia Python a un directorio privado del trabajo. Si falta en la caché, usa el archivo de
95.218.570 bytes de la publicación `3.12.15-36805895057` de `actions/python-versions` tras comprobar su SHA-256
`fcb672b0437c2d8df5565b7cc250b2b0d7455e2b8d6a4a107cfa6f2efe4f7ed8` antes de extraerlo.
Las descargas usan HTTPS y las cuatro cabeceras del perfil genérico. El compilador usa la amalgamación oficial
de SQLite después de cotejar su tamaño y SHA3-256. La biblioteca se instala en el Python privado.
Antes de usar el almacenamiento, el trabajo comprueba la versión y una búsqueda FTS5 en Node, en el intérprete
de Python y en su entorno virtual. El control de Python también prueba un proceso hijo con el entorno que usa el supervisor.

La secuencia es:

1. Recuperar con Git el SHA del evento, sin hooks, submódulos, redirecciones ni credenciales persistidas.
   La credencial temporal tiene solo permiso de lectura del contenido; no se incluye en la URL ni en argumentos.
2. Preparar dependencias sin credenciales de almacenamiento y con OIDC vacío. npm usa el lockfile,
   conserva los paquetes opcionales de plataforma y no ejecuta scripts de instalación. Una transformación
   mínima de esbuild confirma que su binario está disponible. Python descarga únicamente las ruedas del lock,
   coteja tamaño y SHA-256 e instala con pip sin índices, resolución ni red; después ejecuta `pip check`.
3. En el intento `1`, instalar las bibliotecas de Linux y las versiones de Chromium, Firefox y WebKit fijadas por
   `playwright-core`. El preparador arranca y cierra cada motor antes de registrar `PLAYWRIGHT_BROWSERS_PATH`.
   El candidato no abre navegadores: sus comprobaciones son las de los datos (ver «Qué comprueba el ciclo»). El
   workflow de calidad comparte este preparador y sus pruebas de navegador usan esa caché.
4. Solo en el intento `1`, invocar el supervisor con los inputs como variables de entorno,
   la identidad OIDC del job y los secretos S3. El candidato y sus órdenes reciben un entorno filtrado.
   En Linux, la biblioteca de Python se deriva de la instalación del intérprete, sin heredar rutas
   de bibliotecas arbitrarias.
5. Si la entidad habilita la activación y la construcción termina con éxito, un segundo job del mismo workflow
   repite el checkout del SHA y la preparación de dependencias en un runner nuevo. Recupera el índice, el recibo
   y el artefacto del almacén privado y verifica sus huellas antes de activar la versión. Los dos jobs comparten
   identidad de ejecución y cada uno obtiene sus propios tokens OIDC. Las credenciales de despliegue solo se
   entregan al paso de publicación. En los intentos posteriores se ejecuta `recuperar` sobre la activación
   original. Si el primer intento se interrumpió antes de reservarla, el siguiente evento programado puede
   encargar la revalidación del paquete por el procedimiento descrito arriba.

Configurar en el repositorio la variable `FARO_ACTUALIZACION_ORIGEN` y los secretos `FARO_ALMACEN_S3`,
`FARO_ALMACEN_ACCESS_KEY_ID` y `FARO_ALMACEN_SECRET_ACCESS_KEY`. `FARO_ALMACEN_S3` es un secreto porque su punto
de acceso lleva el identificador de la cuenta, y el registro de Actions muestra en claro las variables. No introducir en el
repositorio la credencial de despacho del servidor ni claves de IA. La referencia operativa del bucket
debe haberse inicializado conforme a la [guía del almacén](almacenamiento-datos.md).
Los valores de confianza del servidor deben coincidir con el repositorio, el workflow y la revisión autorizados.
Restringir quién puede modificar esa rama, el workflow y sus secretos: el código autorizado del job
forma parte de la confianza del ejecutor.

Los jobs de construcción y de activación conceden `contents: read` e `id-token: write`; el de aviso, descrito
[abajo](#aviso-cuando-la-actualización-falla-o-termina-sin-publicar), solo `issues: write`. La reserva y el permiso de inicio del servidor
controlan la exclusión entre trabajos. Los runs a demanda y los ensayos comparten además el grupo de concurrencia
`faro-actualizar-manual`, que impide que se solapen entre sí; los runs que despacha el servidor van cada uno en su
propio grupo y nunca esperan ni se cancelan por él. El repositorio es privado y cada job descuenta sus minutos de la cuota
gratuita mensual de GitHub, así que cada uno tiene un tope acorde con ese presupuesto. El job del candidato
dispone de hasta 323 minutos, fijados en la variable `FARO_TOPE_CANDIDATO_MINUTOS` del workflow. El checkout
admite dos minutos, las dependencias veinte y Chromium trece; Chromium solo se instala si la variable
`FARO_NAVEGADORES_EN_EL_CICLO` del workflow vale `si`. El ciclo instala solo Chromium, el único motor que abre (en el
humo de datos); calidad instala los tres. Los trece minutos son la preparación con éxito más lenta medida (643
segundos de 39, con mediana de 66) con el margen del 20 %, y `pruebas/herramientas/preparar-navegadores-medidas.test.ts`
los deriva de esa medida. APT corta en 4 segundos una conexión que deja de enviar datos y reintenta cada paquete
hasta seis veces: en el ciclo del 24/11/2026, que agotó el paso con un espejo lento, cada conexión atascada esperaba 30
segundos y la siguiente descarga empezaba en 2,6 como mucho, y 14 de 65 descargas fallaron. El preparador comprueba
con `apt-config` que APT usa esos valores antes de instalar nada. El supervisor dispone de 280 a 295 minutos según el
tiempo consumido al preparar las dependencias, y de 293 a 308 sin navegadores. Ese plazo incluye la descarga y la
restauración de la generación base (hasta 10 minutos), el motor (hasta 250 minutos), la lectura de la generación, la
exportación del artefacto y su conservación (hasta cinco minutos cada una) y el recibo (hasta cinco). Los plazos
salen de medidas, en `plataforma_datos/orquestacion/medidas_del_ciclo.py`, con un margen del 20 %. La base y las
fuentes del motor, del último ciclo real completo (8,0 y 115,0 minutos el 22/11/2026); las fuentes esperan sobre todo
a la red y se cuentan tal cual. El paquete es cálculo: se midió en un Mac con el código vigente (42,9 minutos) y se
lleva al runner de GitHub más lento medido con el factor de cada tipo de trabajo, medido con la misma batería en las
dos máquinas: 2,03 para Python (componer el catálogo y sus pruebas) y 3,44 para Node. En ese runner son 91,4 minutos.
El motor tiene así (115,0 + 91,4) × 1,2 minutos, redondeados hacia arriba a cinco: 250. Antes de cada módulo y antes
del paquete, el motor comprueba que le queden al menos 91,4 × 1,2 = 110 minutos hasta su hora límite; si no le
quedan, no empieza el paquete y para en orden con la causa `plazo-insuficiente`. Dos pruebas de
contrato derivan de ahí el tope del workflow, el límite del servidor y la reserva, y
exigen que ningún job pase de las seis horas que GitHub concede a un ejecutor alojado. El job de activación dispone de otros 45 minutos, incluidos su checkout, sus dependencias y
hasta veinte minutos para recuperar y publicar el artefacto. El job de aviso dispone de otros 2 minutos. Al terminar, incluso tras un fallo, los jobs de construcción y de activación dejan
en el resumen de la ejecución un aviso con los minutos que ha durado, redondeados hacia arriba, que es como
GitHub los descuenta. Ante una interrupción, la conciliación comprueba qué terminó.
No hay reintentos automáticos del workflow. Sin habilitar la activación no se publica. Los datos y las construcciones se conservan
en el almacén privado configurado; no se adjuntan como artefactos descargables de GitHub Actions.

Las solicitudes realizadas por Git, npm y el descargador de ruedas usan la UA y las tres pistas del perfil genérico central. La preparación y
las órdenes del motor deshabilitan el aviso de nuevas versiones de npm para evitar su consulta automática.
El workflow no utiliza acciones de checkout o instalación que sustituyan esa cabecera. Las comunicaciones internas
entre el runner y GitHub pertenecen a la infraestructura de GitHub y no se configuran desde el producto.
La fase optativa de activación utiliza el CLI oficial Wrangler mediante un adaptador exclusivo de su proceso:
comprueba su versión y las huellas del lanzador y del paquete construido antes de cargarlo, y aplica las cuatro
cabeceras a ambos despachadores conservando el agente original. Un cambio de transporte detiene el lanzamiento hasta
revisar esa compatibilidad; no hay una excepción para APIs autenticadas. No modifica tokens, destinos, TLS
ni archivos de `node_modules`. Esto no acredita un despliegue real.

`config/identidad-web.json` es la copia pública del generador Python, sin HOME ni opciones privadas.
Para comprobar el perfil vigente sin modificarlo, ejecutar
`python -m plataforma_datos.comun.exportar_identidad_web --comprobar`. Para contrastarlo con una versión
concreta, añadir `--version VERSION`; para actualizarlo de forma explícita, ejecutar
`python -m plataforma_datos.comun.exportar_identidad_web --version VERSION`. Comprobar también los valores
públicos de bootstrap de Git/curl y sus pruebas. La fuente mensual de versiones
no activa automáticamente sus propuestas. Las APIs no reciben negociación HTML ni de idioma.
APT es aprovisionamiento separado: solo se configura su UA genérica, sin atribuirle las tres pistas.


El lock Python fija también las huellas de `requirements.txt` y `requirements-dev.txt`. Al cambiar una
dependencia, actualizar conjuntamente versiones, ruedas de las plataformas admitidas, tamaños y SHA-256
obtenidos de PyPI, y verificar una instalación nueva. El preparador no resuelve ni regenera ese lock
durante un trabajo. Las pruebas locales del workflow no acreditan su ejecución real en Linux o GitHub.

## Aviso cuando la actualización falla o termina sin publicar

Cuando un ciclo falla o termina sin publicar datos nuevos, el responsable se entera por el correo de su cuenta de
GitHub, sin mirar nada. Un tercer job de `actualizar.yml`, `aviso`, corre siempre al final (`if: always()`) y gestiona
una incidencia del repositorio con la etiqueta `actualizacion-fallida`. Decide con el resultado de los dos jobs y con
el **resultado del ciclo**: el job del candidato lo expone como salida `resultado_ciclo`, tomado del resumen que
imprime el supervisor, y solo escribe uno de los valores cerrados `validado`, `sin-pendientes` o `rechazado`; si el
resumen no trae uno de ellos, la salida queda vacía.

- **Un trabajo falló o se canceló** (el de construcción, `candidato`, o el de activación, `activacion`): si no hay una
  incidencia abierta con esa etiqueta, abre una con el título «La actualización de datos ha fallado» y la fecha;
  si ya hay una, añade un comentario. El texto lleva solo la fecha y la hora en UTC, el nombre del trabajo que falló
  y el enlace a la ejecución. El repositorio es público: no incluye salidas de pasos, datos del run ni nombres de personas.
- **Todos terminaron bien pero el resultado es `rechazado`**: el workflow termina en verde, pero no se ha publicado
  ningún dato nuevo. Abre (o comenta en la abierta) una incidencia con el título «La actualización de datos terminó sin
  publicar datos nuevos» y la fecha. El texto dice solo eso, la fecha y la hora en UTC y el enlace a la ejecución, en cuyo
  diario consta el motivo.
- **Todos terminaron bien y el resultado es `validado` o `sin-pendientes`** y hay una incidencia abierta con esa
  etiqueta: la comenta («El ciclo del `<fecha>` terminó bien.») y la cierra.
- **Todos terminaron bien pero el resultado no consta** (vacío o fuera de la lista, o no se ejecutó el candidato): no
  abre ni cierra nada, y el resumen de la ejecución dice «No consta cómo terminó el ciclo».
- **No avisa** en los ensayos (`ensayo` distinto de `ninguno`) ni cuando un run a demanda termina en el paso de la
  reserva porque el servidor no la concedió con un motivo conocido (código 3 del cliente de reserva, con el aviso
  `rechazada motivo=…`). Para distinguirlo, el job lee de la API de GitHub el aviso de ese paso; si no puede leerlo,
  lo trata como un fallo y avisa, porque un aviso de más es mejor que uno que falte.

El job no recibe secretos, identidad OIDC ni variables del producto, no recupera el código y su único permiso es
`issues: write`, con un tope de 2 minutos. Usa la orden `gh` del runner con el `GITHUB_TOKEN` del propio job, y toda
entrada llega por variables de entorno. Si el aviso falla (sin permiso, API caída), el resultado de la actualización
no cambia y el resumen de la ejecución lo dice.

Para recibirlo, en el correo de la cuenta de GitHub que lo recibirá:

1. Abrir el repositorio, pulsar **Watch** y elegir **Custom**, marcar **Issues** y guardar (o elegir **All activity**).
   GitHub avisa de las incidencias nuevas, de sus comentarios y de su cierre a quien sigue el repositorio.
2. En **Settings → Notifications** de la cuenta, dejar activadas las notificaciones por correo y comprobar que el
   correo de notificaciones es el que se lee a diario.
3. Para ver cómo llega, abrir una incidencia de prueba con la etiqueta `actualizacion-fallida` y cerrarla.

GitHub no avisa a quien provoca una actividad por esa misma actividad; por eso la incidencia la abre el workflow con
su propio token, y no la cuenta del responsable.

## Lanzar una actualización a demanda

Quien tiene permiso de escritura en el repositorio puede lanzar el ciclo sin pasar por el panel. El run se lanza con
la entrada `a_demanda` en `true`, el ensayo `ninguno`, sin `solicitud_id` ni `revision_reserva`, y con una de las tres
acciones que se pueden pedir así: `actualizar-datos` (el ciclo completo), `actualizar-cursos` (solo los cursos) o
`comprobar-vencidas` (solo lo que ya toca comprobar). Si el lanzamiento trae una reserva del servidor o un ensayo,
el primer paso de cada job lo detiene con el aviso `Faro · entradas`.

Justo después del checkout, y antes de preparar las herramientas, el paso «Pedir la reserva a demanda» ejecuta
`plataforma_datos/orquestacion/reserva_a_demanda.py` con `/usr/bin/python3 -I`. El guion solo usa la biblioteca
estándar, la lista de autoridades TLS de `plataforma_datos/comun/confianza_tls/cacert.pem` y la identidad de
`config/identidad-web.json`. Pide al runner un token OIDC con la misma audiencia que el permiso de inicio y envía
`POST /mantenimiento/reserva` con `{"operacion":"reservar","accion":…}`. El token no se imprime ni se guarda, y
ningún otro paso lo recibe. El paso termina de una de estas formas:

| Respuesta del servidor | Qué hace el paso | Aviso en el resumen |
|---|---|---|
| 200 con `estado` `reservada` o `repetida`, `solicitudId` y `revisionReserva` | Deja `solicitud_id` y `revision_reserva` como salidas del paso y del job, y el run sigue como si la reserva la hubiera creado el servidor | `::notice title=Faro · reserva::aceptada estado=…` |
| 409 con `error` igual a un motivo conocido (`ocupado`, `activacion_pendiente`, `candidato_en_plazo`, `separacion`, `tope_dia`, `tope_mes` o `presupuesto`) | Termina el run en ese paso, con código 3, sin gastar más minutos | `::notice title=Faro · reserva::rechazada motivo=…` |
| 401, 404, otro estado o una respuesta mal formada | Termina con código 1 y no detalla el motivo | `::error title=Faro · reserva::El servidor no ha concedido la reserva.` |
| Sin respuesta en 12 segundos o un corte de red | Lo intenta una vez más con un token nuevo; si vuelve a fallar, termina con código 1 | `::error title=Faro · reserva::El servidor no ha respondido a tiempo; …` |

Repetir la petición es seguro: el servidor ata la reserva al run y la segunda petición recibe `repetida`. La
activación toma la reserva de las salidas del job del candidato. En un intento posterior, cuando esas salidas pueden
faltar, el paso de activación la consulta con `{"operacion":"consultar","accion":…}`, con la acción del run, que devuelve la reserva anotada para ese
run y nunca crea una.

Las órdenes, con `gh` autenticado y `<propietario>/<repositorio>` en lugar del repositorio privado:

1. Lanzar el run:
   `gh workflow run actualizar.yml --repo <propietario>/<repositorio> --ref main -f ensayo=ninguno -f a_demanda=true -f accion=actualizar-cursos`
2. Obtener su identificador:
   `gh run list --repo <propietario>/<repositorio> --workflow actualizar.yml --event workflow_dispatch --limit 1 --json databaseId,createdAt,status`
3. Saber si el servidor lo aceptó, uno o dos minutos después. `success` significa que tiene reserva; `failure`, que
   no la tiene:
   `gh run view <id> --repo <propietario>/<repositorio> --json jobs --jq '.jobs[] | select(.name == "candidato") | .steps[] | select(.name == "Pedir la reserva a demanda") | .conclusion'`
4. Leer el motivo. Primero el identificador del job y después sus avisos:
   `gh run view <id> --repo <propietario>/<repositorio> --json jobs --jq '.jobs[] | select(.name == "candidato") | .databaseId'`
   `gh api repos/<propietario>/<repositorio>/check-runs/<job>/annotations --jq '.[] | select(.title == "Faro · reserva") | .message'`
5. Vigilarlo con consultas sueltas y espaciadas, no con una espera continua:
   `gh run view <id> --repo <propietario>/<repositorio> --json status,conclusion,jobs --jq '{status, conclusion, jobs: [.jobs[] | {name, status, conclusion}]}'`
   El ciclo ha terminado cuando `status` es `completed`. Los avisos «Minutos del job» dicen cuánto ha durado cada job.

## Observar la construcción servida

En Cloudflare, `GET /mantenimiento/construccion` devuelve `{version: 1, versionId: "<UUID>"}`
tomando el identificador del enlace oficial `CF_VERSION_METADATA`. La ruta requiere la administración
y la configuración de actualización habilitadas, un token OIDC de GitHub válido para la misma audiencia
configurada. Admite el intento `1` y los posteriores válidamente firmados; comprueba la confianza
fijada de repositorio, workflow y revisión. Esa lectura no concede permiso de recuperación.
Una sesión humana de Access o una clave pública de consulta no sustituyen esa identidad.

La lectura exige el origen y la ruta exactos, sin consulta ni cuerpo, y responde con `no-store`.
No utiliza IA, SQL ni recursos estáticos; tampoco reserva trabajos, modifica estado o autoriza
una activación. Un enlace ausente o inválido no se sustituye por una etiqueta del despliegue,
por el último trabajo ni por el número de versión de `/api/salud`.

`ClienteMantenimientoGitHub.observar_construccion()` obtiene un JWT nuevo para esa lectura y
valida la respuesta cerrada de hasta 1 KiB. Conserva TLS, el perfil genérico central (UA y tres pistas), ausencia de redirecciones y
reintentos, y el plazo de fase de 15 segundos. No guarda ni imprime el JWT. El adaptador Node no
declara una identidad de Cloudflare y no ofrece esta ruta.

El identificador observado acredita qué versión atendió esa petición. Para confirmar una activación
también hacen falta la asociación privada entre artefacto conservado y versión subida, el estado del
despliegue del proveedor y el cotejo de los manifiestos web. La lectura por sí sola no demuestra
propagación global ni que un navegador haya abandonado su copia anterior.

## Límites de la integración

La construcción no firma ni activa datos por sí sola. La activación optativa se describe a continuación;
un recibo válido no sustituye comprobar la generación que sirve la web. El ejecutor operativo debe recuperar
la generación privada, construir el candidato, conservar su estado coherente y terminar antes de
enviar el recibo final. La CLI publica su recibo completo de forma atómica, sin sobrescribir un archivo
existente; un corte puede dejar un temporal, pero no un recibo final parcialmente escrito.
La [transferencia de generaciones](almacenamiento-datos.md) permite conservar y recuperar sus archivos
en un almacén privado S3 compatible, con configuración y credenciales propias del ejecutor.
El workflow incluido no sustituye configurar y ensayar el entorno de la entidad, comprobar su
bucket ni verificar la activación. Esos pasos deben completarse antes de ofrecer la actualización
desde la pantalla. Las comprobaciones locales no acreditan una ejecución en GitHub ni un despliegue activo.

## Activar el candidato validado

La activación automática requiere `FARO_ACTIVACION_AUTOMATICA=si` tanto en el servidor como en las
variables del repositorio. Ausente o `no`, queda deshabilitada; una configuración inválida no bloquea
la web, las consultas ni la construcción. Configurar además:

| Nombre | Ubicación y función |
| --- | --- |
| `FARO_ORIGEN_PUBLICO` | Variable del repositorio: origen HTTPS de la web, sin ruta ni barra final |
| `FARO_CLOUDFLARE_VARIANTE` | La misma variable de la construcción, `oficial` en producción: la activación rechaza un artefacto de otra variante |
| `FARO_CLOUDFLARE_CONFIGURACION_JSON` | Secreto del repositorio: configuración completa del Worker principal de la instalación en JSON estricto |
| `FARO_CLOUDFLARE_CURSOS_CONFIGURACION_JSON` | Secreto del repositorio: configuración completa del Worker de Cursos de la instalación en JSON estricto |
| `CLOUDFLARE_API_TOKEN` | Secreto del repositorio con los permisos necesarios para versiones y despliegue de los dos Workers y sus recursos |
| `CLOUDFLARE_ACCOUNT_ID` | Secreto del repositorio: cuenta de la entidad, coherente con `account_id` de los dos JSON; es secreto para que el registro de Actions no la muestre |

Cada JSON debe describir su Worker real: nombre, cuenta, compatibilidad, enlaces del entorno, migraciones,
variables y ajustes existentes. No usar una plantilla incompleta para actualizar una instalación.
El adaptador conserva esos campos y cambia solo las rutas que apuntan al artefacto verificado:
`main`, `base_dir` y `assets.directory` en el principal (carpetas `worker/` y `web/`), y `main` y `base_dir`
en el de Cursos (carpeta `worker-cursos/`). Cada Worker tiene un perfil cerrado:

- El principal exige los enlaces `REGISTRO_SOCIOS`, `ASSETS` y `CF_VERSION_METADATA`, las reglas Data del
  producto y recursos servidos primero por el Worker.
- El de Cursos solo admite `$schema`, `name`, `account_id`, `main`, `base_dir`, `compatibility_date`,
  `compatibility_flags` (con `global_fetch_strictly_public`), `workers_dev: false`, `preview_urls: false`,
  las mismas reglas Data, `placement` y `observability`. La web, los almacenes, las variables, las rutas, los
  horarios y `limits` no caben en él. Parte de `config/cloudflare/wrangler.cursos.example.jsonc` con la cuenta
  de la entidad.
- Las dos forman la pareja de la instalación: el principal tiene un único binding `CURSOS`, que apunta al `name` de
  la configuración de Cursos, y los dos nombres son distintos. Es la misma regla que la publicación a mano. El
  adaptador lee y comprueba las dos configuraciones en cada operación, también en la primera lectura.

Una configuración que no cumple el perfil de su Worker se rechaza en la primera lectura, antes de cualquier
efecto. No admite configuración heredada, TOML/JSONC, `env`, compilaciones adicionales ni rutas auxiliares.
Un campo no admitido se rechaza; nunca se descarta silenciosamente. Wrangler conserva las variables
remotas al subir. Los horarios requieren su aprovisionamiento separado mediante `triggers deploy`;
activar una versión no los instala. Las migraciones pendientes requieren
aprovisionamiento previo; `versions upload` no las realiza. La configuración inicial de la entidad
es independiente de este circuito de actualización.

`POST /mantenimiento/activacion` acepta exclusivamente `leer`, `reservar` y `paso` para el intento `1`,
y `leer-recuperacion`, `recuperar` y `paso-recuperacion` para intentos posteriores. Las lecturas solo
llevan `operacion`; las demás operaciones añaden su `solicitud`. Usa OIDC, audiencia y pins del
actualizador, cuerpo/respuesta limitados a 16 KiB y plazo de cinco segundos. Una credencial de consulta
o una sesión de Access no concede este permiso. La lectura autenticada permite conocer la revisión
actual; cada escritura comprueba de nuevo en SQL la reserva, identidad, ejecución y revisión esperada.

Una activación publica los dos Workers del artefacto en una sola intención, primero el de Cursos, que lleva
dentro el paquete de la formación, y después el principal. La secuencia durable es:

`reservada → preparada → subiendo-cursos → cursos-subida → promoviendo-cursos → cursos-confirmado →
subiendo → subida → promoviendo → confirmada`

| Fase | Qué significa | Qué sirve la web |
| --- | --- | --- |
| `reservada`, `preparada` | Candidato fijado y evidencia registrada, sin ningún efecto en Cloudflare | Los dos Workers anteriores, coherentes |
| `subiendo-cursos` | Permiso para subir la versión de Cursos; si falta el acuse, la subida es incierta | Igual que antes |
| `cursos-subida` | Versión de Cursos subida e identificada, sin desplegar | Igual que antes |
| `promoviendo-cursos` | Permiso para desplegar Cursos al 100 %; si falta el acuse, el despliegue es incierto | La formación puede figurar como no disponible |
| `cursos-confirmado` | Cursos sirve la versión nueva; el principal sigue con la anterior | La formación figura como no disponible |
| `subiendo`, `subida`, `promoviendo` | Las mismas fases para el principal | La formación figura como no disponible hasta confirmar |
| `confirmada` | Los dos Workers sirven las versiones de la intención, construidas con el mismo paquete | Todo, con los datos nuevos |
| `rechazada` | Cerrada antes de cualquier efecto | Los dos Workers anteriores |
| `abandonada` | Cerrada sin publicar, con cada Worker sirviendo otra vez su versión anterior; guarda el motivo y lo observado | Los dos Workers anteriores |

«El mismo paquete» se comprueba por el identificador de versión de cada Worker: las dos versiones de la intención
salen del mismo artefacto. Cloudflare dice qué versión sirve cada Worker; la activación no consulta la formación
servida. Mientras los dos Workers llevan paquetes distintos, el principal no usa las respuestas de Cursos: la
formación figura como no disponible y el resto se sirve, sin combinar datos de dos versiones. Ninguna fase
intermedia se presenta como publicación terminada.

Los pasos son:

1. Fijar una copia del trabajo terminado y validado, con inicio confirmado, tupla del intento y huella
   del recibo. Un trabajo nuevo no puede cambiar esa selección durante la activación.
2. Recuperar el índice privado versión 2 y el artefacto de esa tupla. Cotejar sus bytes, código,
   paquete, generación y manifiesto web, sin reconstruir ni mover la referencia operativa. La variante
   que registra el descriptor del artefacto debe ser la declarada en `FARO_CLOUDFLARE_VARIANTE`. Un
   artefacto de otra variante, o que no registra la suya, se rechaza al leer el descriptor, antes de
   descargar el artefacto y de cualquier lectura u operación en Cloudflare: no se sube nada. Si la
   activación está en `reservada` o `preparada`, se cierra como `rechazada` con `despliegue_no_admitido`,
   tanto al activar como al recuperar (la recuperación registra antes el relevo de su intento). En
   cualquier otra fase, la reconciliación y la recuperación se detienen con ese error y la activación de
   una fase en curso se detiene sin efectos; la fase no cambia.
3. Registrar la evidencia con el despliegue anterior de cada Worker (`anterior.principal` y
   `anterior.cursos`). Solo una transición `aplicado` a `subiendo-cursos` permite
   `wrangler versions upload --no-bundle --keep-vars` del Worker de Cursos. La etiqueta es la intención UUID y
   el mensaje, la huella completa del artefacto; no contienen datos personales ni secretos.
4. Asociar la versión devuelta (`cursos-subida`). Solo `aplicado` a `promoviendo-cursos` permite desplegarla
   al 100 %; el adaptador vuelve a comprobar antes el despliegue anterior de Cursos. `cursos-confirmado`
   solo se registra cuando Cursos sirve esa versión, sola y al 100 %, y anota su despliegue.
5. Repetir los pasos 3 y 4 con el principal desde `cursos-confirmado`: `subiendo`, `subida` y `promoviendo`. En
   `cursos-subida` o `subida`, si el Worker ya sirve esa versión, sola y al 100 % (porque se publicó a mano), pasa a
   la fase de despliegue sin desplegar y confirma por lo observado.
6. Confirmar únicamente cuando Cursos siga sirviendo la versión de la intención, sola y al 100 % (el despliegue
   puede ser otro que el anotado si se ha vuelto a desplegar a mano esa misma versión), y coincidan el despliegue
   oficial del principal de una sola versión, la identidad servida por `/mantenimiento/construccion` y los
   bytes de `/firmas/manifiesto.json` de la web. La consulta pública del manifiesto no recibe el JWT privado.

Una activación guardada con la forma de un servicio, sin los campos `versionIdCursos` y `deploymentIdCursos`,
se sigue leyendo y se termina o se recupera por su camino de siempre (`preparada → subiendo → … →
confirmada`), sin pasar por Cursos. Toda reserva nueva es de dos servicios.

`FARO_ACTIVACION_AUTOMATICA` puede ponerse en `si`, en el servidor y en el repositorio, cuando:

- el servidor publicado y el código del workflow son los de esta forma de dos servicios, y esta versión se ha
  publicado sin ninguna activación en curso: la última activación estaba en `confirmada` o `rechazada`. Si había una
  en curso, se termina o se recupera antes de publicar;
- están configurados los dos secretos de configuración y la variante, con el token de los dos Workers;
- el Worker de Cursos de la instalación ya está desplegado, con una sola versión al 100 %, y el binding `CURSOS`
  del principal apunta a él;
- se ha ensayado una activación completa en el alojamiento de la entidad;
- se ha comprobado una vez, en la instalación de ensayo, que la versión creada con
  `node herramientas/cloudflare/desplegar.ts publicar … --intencion <solicitudId>` (que pasa `--tag` y `--message` a
  `wrangler deploy`) aparece con esa etiqueta y esa huella en `wrangler versions list --json`. Todo el cierre hacia
  delante de una intención detenida depende de eso, y la ayuda de Wrangler no basta para darlo por hecho;
- se ha ensayado una vez el reintento de una abandonada por `rechazo-previo`: con la intención cerrada así, la
  ejecución siguiente sin pendientes la vuelve a intentar con su propia reserva y el panel deja de decir que hay datos
  sin publicar en cuanto se confirma ([reintento de una intención abandonada](#reintento-de-una-intención-abandonada));
- se ha ensayado una vez, en ese mismo repositorio, el cierre desde el panel de una publicación detenida: el panel
  dice que el cierre está en curso, el servidor despacha la ejecución, su paso de activación cierra la intención y el
  panel la muestra cerrada ([cerrar una publicación desde el panel](#cerrar-una-publicación-desde-el-panel)).

Con la activación encendida, esto es lo que hay para cada intención que no termina:

- Se abandona sola cuando el adaptador demuestra que la subida o el despliegue en curso no se hizo y cada Worker
  sirve todavía lo anterior ([abandonar una intención](#abandonar-una-intención)).
- Una fase incierta, o un rechazo con Cursos ya publicado, queda en su fase y no se puede reservar otra
  actualización hasta cerrarla. Si el adaptador demostró que el paso no se hizo, el panel lo dice como publicación
  detenida, con su motivo. Se cierra hacia delante (reconciliar o recuperar) o, tras volver atrás a mano, desde el
  panel con «Cerrar esta publicación».
- Cerrarla desde el panel no necesita el artefacto ni el trabajo conservados ni ningún plazo de GitHub: la cumple
  una ejecución nueva, que lee lo que sirve cada Worker con sus dos configuraciones (con la pareja comprobada).
- Un paquete abandonado por `rechazo-previo` se vuelve a intentar una sola vez, en la ejecución siguiente del
  mantenimiento ([reintento de una intención abandonada](#reintento-de-una-intención-abandonada)). Uno abandonado
  a mano o por `rechazo-proveedor`, o un reintento que vuelve a abandonarse, no se reintenta solo: sus datos se
  publican con el siguiente cambio de las fuentes o a mano desde el artefacto conservado.
- Mientras unos datos validados no estén publicados (tras un abandono, tras un rechazo que no pone en duda el propio
  paquete, y durante su reintento), el estado de la activación lo dice con `datosSinPublicarDesde`, el panel lo
  cuenta con esa fecha y el vigilante emite el aviso `datos_validados_sin_publicar`. Es solo un aviso: no cambia lo
  que ve la persona. Un rechazo por `candidato_no_verificable` no cuenta: ese paquete no se pudo comprobar. Si esos
  datos se publican a mano, el servidor no lo anota en la activación y no puede ver qué paquete sirve la web: el aviso
  sigue abierto hasta la siguiente publicación confirmada, y su texto lo dice.

Con la activación deshabilitada, el artefacto validado queda conservado en el almacén privado y se publica a
mano, primero Cursos y después el principal.

### Publicar a mano un artefacto conservado

El índice privado del trabajo (`trabajos/<solicitudId>/<revisionReserva>/<runId>.json`) identifica su
artefacto. Desde una instalación de mantenimiento con `.venv`, con `FARO_ALMACEN_S3` y sus dos secretos en el
entorno, recuperarlo en una carpeta nueva cuyo directorio padre ya exista; la orden imprime su
`sha256Artefacto`. Se lanza desde la raíz del repositorio, para que Python encuentre `plataforma_datos`, y
necesita `node` en el `PATH`, porque comprueba el artefacto con `herramientas/cloudflare/artefacto.ts`:

```sh
.venv/bin/python - "<solicitudId>" "<revisionReserva>" "<runId>" "/ruta/privada/artefacto" <<'PY'
import json
import os
import sys
from pathlib import Path

from plataforma_datos.orquestacion.almacen_artefactos import recuperar_artefacto
from plataforma_datos.orquestacion.almacen_s3 import AlmacenS3
from plataforma_datos.orquestacion.almacen_trabajos import MAX_CONTROL_BYTES
from plataforma_datos.orquestacion.transferir_generacion import configuracion_privada

solicitud, reserva, run, destino = sys.argv[1:]
with AlmacenS3(configuracion_privada(os.environ)) as almacen:
    lectura = almacen.leer_control(f"trabajos/{solicitud}/{reserva}/{run}.json", MAX_CONTROL_BYTES)
    artefacto = json.loads(lectura[0])["artefacto"]
    recuperar_artefacto(
        Path(destino),
        artefacto["revisionCodigo"],
        artefacto["huellaPaquete"],
        artefacto["sha256Artefacto"],
        almacen,
    )
print(artefacto["sha256Artefacto"])
PY
```

La recuperación comprueba cada archivo contra su huella antes de dejar la carpeta en su destino. Después se
publica con la [orden de despliegue](despliegue.md#publicar-la-construcción-admitida), indicando esa carpeta
con `--artefacto`: primero `comprobar` y `publicar` con `--servicio cursos` y después `publicar` con
`--servicio principal`. Producción solo admite un artefacto de la variante `oficial`.

La reserva se guarda en la misma autoridad durable del panel. No se restauran sesiones, credenciales,
cuotas ni controles desde el candidato. Un fallo de red o una respuesta perdida no libera una fase
incierta ni autoriza repetir el efecto. `repetido` nunca equivale a permiso de subir o desplegar.
Una evidencia local demostrablemente incompatible puede cerrar `reservada` o `preparada` como
`rechazada`; un fallo temporal de recuperación conserva el estado para investigarlo.

Para inspeccionar una operación incierta se puede usar `reconciliar` en el mismo job e intento:

```sh
.venv/bin/python -m plataforma_datos.orquestacion.ejecutar_mantenimiento reconciliar \
  "/ruta/checkout" "/ruta/privada/trabajos" \
  --configuracion-cloudflare "/ruta/privada/cloudflare.json" \
  --configuracion-cloudflare-cursos "/ruta/privada/cloudflare-cursos.json" \
  --origen-publico "https://web-de-la-entidad"
```

Los dos archivos de configuración deben ser distintos, tener permisos `0600` y estar fuera del checkout. El
workflow los crea en una carpeta privada y los retira al terminar. Reconciliar solo actúa en las cuatro fases
inciertas y solo observa el Worker de esa fase:

| Fase incierta | Cómo se cierra | Si no se puede cerrar |
| --- | --- | --- |
| `subiendo-cursos` | Una única versión de Cursos con la etiqueta y la huella de la intención → `cursos-subida` | Ninguna o varias: no se repite la subida |
| `promoviendo-cursos` | Cursos sirve esa versión, sola y al 100 % → `cursos-confirmado` | Se queda en la fase; no se repite el despliegue |
| `subiendo` | Una única versión del principal con la etiqueta y la huella → `subida` | Ninguna o varias: no se repite la subida |
| `promoviendo` | Cursos sirve la versión de la intención, sola y al 100 %, y el principal, la construcción servida y el manifiesto coinciden → `confirmada` | Se queda en la fase; no se repite el despliegue |

La lista oficial muestra las últimas diez versiones: no encontrar una coincidencia no demuestra que la subida
no ocurrió. Después de cerrar `cursos-subida`, `cursos-confirmado` o `subida`, una invocación explícita de
`activar` continúa desde ahí. Una fase incierta que no se puede cerrar se resuelve a mano, según sea de subida o
de despliegue:

- **`subiendo-cursos` o `subiendo`:** la versión de la intención, si existe, está subida y sin desplegar, así que
  `deployments status` siempre muestra la anterior. Se busca en
  `npx wrangler versions list --name <Worker> --json`, con la etiqueta `workers/tag` igual al `solicitudId` y el
  mensaje igual a la huella del artefacto (`sha256Artefacto`), y se vuelve a reconciliar. Si no está y se quiere
  seguir hacia delante, se sube a mano desde el artefacto conservado
  ([publicar a mano](#publicar-a-mano-un-artefacto-conservado)), con una configuración cuyo `main` y `base_dir`
  apunten a `worker-cursos/` (Cursos) o a `worker/` y `assets.directory` a `web/` (principal):
  `npx wrangler versions upload --no-bundle --keep-vars --tag <solicitudId> --message <sha256Artefacto> --config <configuración>`.
  Después se reconcilia: la etiqueta y la huella identifican esa versión como la de la intención.
- **`promoviendo-cursos` o `promoviendo`:** se comprueba qué sirve el Worker con
  `npx wrangler deployments status --name <Worker> --json`. Si es la versión de la intención, sola y al 100 %, se
  reconcilia. Si no, se despliega a mano con `npx wrangler versions deploy <versión>@100% --name <Worker> --yes` y se
  reconcilia.

Si se prefiere servir lo anterior, se sigue [volver atrás a mano](#volver-atrás-a-mano) y después se abandona.

Si Cursos ha quedado en una versión nueva y el principal en la anterior, la formación figura como no disponible
hasta terminar. La
recuperación automática va siempre hacia delante; la vuelta atrás es solo manual
([volver atrás a mano](#volver-atrás-a-mano)).
No se repite automáticamente un efecto ni se activa una versión anterior por haber fallado la nueva.
La entidad debe mantener un único escritor de despliegues mientras opera este circuito. La comprobación
del despliegue anterior detecta cambios ya visibles, pero no constituye un cerrojo de Cloudflare frente
a un cambio simultáneo desde su Dashboard u otro CLI. No realizar esos cambios en paralelo.

### Volver atrás a mano

Sirve para volver a servir la formación anterior cuando la activación se ha quedado con Cursos publicado y el
principal sin publicar (`cursos-confirmado`, `subiendo`, `subida` o `promoviendo` sin cambio en el principal):

1. Identificar la versión anterior de Cursos. Es `anterior.cursos.versionId`, guardada en la evidencia de la
   activación (`ultimaActivacion.evidencia.anterior.cursos`) en la autoridad privada del panel. En Cloudflare es la
   misma versión: en `npx wrangler deployments list --name <Worker de Cursos> --json`, la versión única al 100 % del
   despliegue anterior a aquel en el que aparece la versión de la intención. La versión de la intención es la que
   `npx wrangler versions list --name <Worker de Cursos> --json` muestra con la etiqueta `workers/tag` igual al
   `solicitudId` y el mensaje igual a la huella del artefacto.
2. Comprobar que el principal sigue en `anterior.principal.versionId`, con
   `npx wrangler deployments status --name <Worker principal> --json`. Si no, la vuelta atrás exige desplegar también
   esa versión del principal, después de la de Cursos.
3. Desplegar la versión anterior de Cursos al 100 %:
   `npx wrangler versions deploy <anterior.cursos.versionId>@100% --name <Worker de Cursos> --yes`.
4. Comprobar con `npx wrangler deployments status --name <Worker de Cursos> --json` que esa versión es la única y
   está al 100 %, y en la web que la formación vuelve a responder en un informe.

No devolver el principal a una versión que solo conoce la forma de un servicio: ese servidor no sabe leer la
activación guardada de dos servicios, que quedaría ilegible para él (el panel no podría mostrarla ni el orquestador
recuperarla) hasta volver a publicar una versión que la conozca.

Después de volver atrás, la intención se cierra desde el panel con [«Cerrar esta publicación»](#cerrar-una-publicación-desde-el-panel). Si en lugar
de eso se quiere terminar hacia delante, se vuelve a desplegar a mano la versión de Cursos de la intención
(`versionIdCursos`), se comprueba que es la única al 100 % y se lanza la recuperación, que publica el principal y
confirma: la confirmación exige esa versión de Cursos, no el despliegue anotado, así que el redespliegue a mano
vale. No lanzar la recuperación con Cursos en la versión anterior: publicaría el principal y no podría confirmar.

### Abandonar una intención

`abandonar` cierra una intención no terminal en la fase `abandonada` y libera la reserva para la actualización
siguiente. Solo se admite con lo observado en ese momento: cada Worker de la intención (los dos en la forma de dos
servicios, el principal en la de uno) sirve una única versión al 100 % y es la de `anterior`, aunque con otro
despliegue si se volvió atrás a mano. Una versión subida y nunca desplegada no lo impide. Si algún Worker sirve otra
cosa, el paso se rechaza y la intención no cambia. El servidor guarda con la fase el motivo y lo observado, con la
misma comprobación de revisión que los demás pasos; repetir el paso tras un acuse perdido no cambia nada.

**Sola, sin intervención,** solo cuando el adaptador demuestra que la subida o el despliegue en curso no se hizo:

| Clase | Cuándo | Motivo |
| --- | --- | --- |
| Rechazo previo | El adaptador rechaza antes de lanzar `versions upload` o `versions deploy`: configuración o pareja no admitidas, artefacto que no cuadra, solicitud inválida, o un despliegue actual distinto del anterior anotado | `rechazo-previo` |
| Rechazo del proveedor | Cloudflare rechaza la orden de forma explícita y completa: hoy, la migración de Durable Objects pendiente que `versions upload` no puede aplicar | `rechazo-proveedor` |
| Incierto | Corte, tiempo agotado, salida ilegible, respuesta a medias, cualquier otro código de Wrangler distinto de cero, o un fallo de lectura antes de la orden | Nunca se abandona sola: se reconcilia |

Antes de abandonar se observa lo que sirve cada Worker. Si no es lo anterior (por ejemplo, con Cursos ya
publicado en `cursos-confirmado`), no se abandona: la intención queda en su fase con el motivo anotado en el servidor
(paso `anotar-rechazo` con lo observado, que no cambia de fase y se borra con el paso siguiente). El panel la
presenta como detenida y elige el texto por lo observado: con Cursos nuevo y el principal anterior, que la formación
figura como no disponible; con cualquier otra combinación, que lo servido ha cambiado fuera de esta publicación y
hay que comprobarlo antes de seguir.

**Migración pendiente tras `cursos-confirmado`.** Es el caso más probable de rechazo del proveedor: solo el principal
tiene objetos durables, y su subida llega cuando Cursos ya es el nuevo. No se abandona sola. El panel dice que la
publicación se ha detenido porque el alojamiento rechazó ese paso, que la formación nueva figura como no disponible y
que se siga esta guía. Se resuelve de una de estas dos formas:

1. **Hacia delante.** Publicar a mano el principal de la misma entrega con su migración y con la identidad de la
   intención, para que la activación reconozca esa versión como suya:
   `node herramientas/cloudflare/desplegar.ts publicar --entorno produccion --servicio principal --sha256 <sha256Artefacto> --artefacto <carpeta> --instalacion <registro.json> --aplicar-migracion <etiqueta> --intencion <solicitudId>`.
   `--intencion` da a la versión la etiqueta `<solicitudId>` y el mensaje `<sha256Artefacto>`, como las que sube la
   activación (`wrangler deploy` admite `--tag` y `--message`). Después, lanzar la recuperación («Re-run jobs»):
   reconcilia `subiendo` por esa etiqueta y esa huella (pasa a `subida`) y, como el principal ya sirve esa versión,
   sola y al 100 %, pasa a `promoviendo` sin volver a desplegar y confirma con las tres comprobaciones de siempre.
   Una publicación a mano sin `--intencion` no lleva la etiqueta, y la reconciliación no la reconoce. Tiene salida:
   volver a publicar con `--intencion` crea una versión etiquetada, desplegada sola al 100 %, que la reconciliación sí
   reconoce como de la intención.
2. **Atrás.** [Volver atrás a mano](#volver-atrás-a-mano) Cursos a `anterior.cursos.versionId`, sin tocar el principal,
   y cerrarla desde el panel. Los datos se publican después a mano o con el siguiente cambio de las fuentes, una vez
   resuelta la migración.

La anotación de detenida sigue visible en el panel hasta el paso siguiente de la intención: tras una subida o un
despliegue a mano, el panel la mantiene hasta que la reconciliación o la recuperación avanza la fase. Si al
detenerse no se puede comprobar lo servido (un despliegue repartido entre dos versiones, o la pareja de
configuraciones rota), la intención se anota igualmente como detenida, con su motivo y sin observación
(`"observado": null`). El panel dice entonces que no se ha podido comprobar qué sirve la web y que hay que
comprobarlo con esta guía antes de terminarla o cerrarla. También se anota así si Wrangler no llega a Cloudflare
durante esa lectura. Solo no se anota nada si falla la llamada al servidor del panel o el proceso hijo: la orden
termina con el error en su registro y la intención sigue en su fase.

**A mano,** después de una vuelta atrás o para cerrar una fase incierta que no se va a terminar: desde el panel,
con [«Cerrar esta publicación»](#cerrar-una-publicación-desde-el-panel).

**Lo que ve el panel:** la fase «La publicación se ha cerrado sin terminar y se sigue sirviendo la versión anterior
de la web» y su motivo (cerrada a mano; cerrada sola porque algo cambió en el alojamiento antes de publicar; o
cerrada sola porque el alojamiento la rechazó), con lo que pasa con los datos nuevos y qué hacer. No muestra la
versión subida, que nunca se sirvió.

**El paquete no se vuelve a intentar en bucle.** Al conservar el trabajo validado, la referencia operativa pasa a
su generación (`almacen_trabajos.py`, `_nueva_referencia`). El ciclo siguiente sin cambios en las fuentes termina
`sin-pendientes`; repetir la activación del mismo trabajo encuentra la intención `abandonada` y no hace nada. Una
abandonada por `rechazo-previo` se reintenta una sola vez, como se explica a continuación; cualquier otra se publica
con el siguiente cambio de las fuentes, en un paquete nuevo, o a mano desde el artefacto conservado. Una abandonada
ya no detiene la comprobación diaria: está resuelta, y la ejecución siguiente es la que puede reintentarla.

### Reintento de una intención abandonada

Un `rechazo-previo` demuestra que no se hizo nada y que algo ajeno al paquete lo impidió (por ejemplo, un despliegue
actual distinto del anotado). Por eso la ejecución siguiente del mantenimiento, cuando termina `sin-pendientes`, lee
la activación y, si la última es una abandonada por `rechazo-previo`, la vuelve a intentar con una intención nueva:
su propia reserva y su propia revisión, sobre el mismo trabajo y el mismo artefacto conservado. Después sigue el
camino de siempre desde `reservada`: `preparar` vuelve a observar lo que sirve cada Worker como `anterior`.

La intención nueva guarda lo que servía cada Worker al abandonar. `preparar` exige que la web siga sirviendo
exactamente eso (la misma versión en cada Worker); si alguien publicó otra cosa entre el abandono y el reintento,
la intención se cierra como `rechazada` con el error `servido_distinto` antes de cualquier efecto. Así el reintento
nunca deshace lo que se haya publicado entre medias, y el panel lo dice.

El servidor solo lo admite si se cumple todo esto, dentro de la misma transacción que los trabajos:

- la última activación es `abandonada` con motivo `rechazo-previo` y no es ya un reintento: hay un solo reintento por
  trabajo abandonado, y un reintento que vuelve a abandonarse no se reintenta;
- la ejecución nombra el trabajo abandonado exacto (tupla y huella del recibo) y el servidor lo copia tal cual,
  validado y con su inicio confirmado;
- el trabajo de la ejecución que reintenta es el último, terminado `sin-pendientes`, con su inicio confirmado, del
  mismo repositorio, workflow y rama, y reservado justo después del abandonado, sin ningún otro trabajo en medio
  (lo prueba la revisión de trabajos que la activación guarda al reservar). Un trabajo validado más reciente gana
  siempre: tiene su propia activación;
- la identidad OIDC es la de esa ejecución, en su primer intento o en uno posterior de la misma ejecución.

Ninguna escritura del almacén de trabajos sube su revisión sin un trabajo nuevo: con el último trabajo terminado,
los despachos y recibos repetidos no escriben, y retirar o liberar solo afecta a una reserva sin terminar. Por eso
basta comparar la revisión. Una reserva siguiente que se retire o se libere cuenta como un trabajo en medio.

**Si falla la lectura de la activación.** Con la activación encendida, una ejecución sin pendientes lee la
activación por la red. Si esa lectura falla, el paso de activación termina en rojo; el recibo sin pendientes ya está
registrado, así que los datos no cambian y el vigilante no lo cuenta como un fallo del ejecutor. El reintento no se
pierde: «Re-run jobs» sobre esa ejecución lo pide desde el intento nuevo, con el relevo de siempre. Si en su lugar
llega otro trabajo, la oportunidad pasa y el panel deja de prometerla.

La ejecución que reintenta es la única autoridad sobre la intención nueva: sus pasos, su relevo con «Re-run jobs»
y su reconciliación van con su propia identidad. Si se interrumpe, se recupera como cualquier otra.

**No se reintenta, y se dice:** si el trabajo abandonado o su artefacto ya no se conservan completos, la orden
lo anota en la abandonada (`reintentoDescartado: "sin-artefacto"`) y termina con `"fase": "omitida"` y
`"reintento": "sin-artefacto"` en su resumen, sin reservar nada. Tampoco se
reintenta una abandonada guardada antes de que la activación anotara la revisión de trabajos, ni una con otro motivo.

**Lo que ve el panel:** con `rechazo-previo`, que Faro lo volverá a intentar solo en la próxima actualización, pero
solo mientras la oportunidad siga abierta (no hay otro trabajo, o el siguiente sigue en curso o terminó sin
pendientes). Si ya pasó, que no se reintenta solo; si el paquete ya no se conserva, que no se pudo volver a intentar
por eso. Durante el reintento, que es el segundo intento y que Faro está volviendo a intentar publicar los datos. Si
el reintento también se cierra, o con `a-mano` y `rechazo-proveedor`, que no se reintenta solo y que para publicar
esos datos hay que hacerlo a mano. Con la intención terminada, desde cuándo hay datos validados sin publicar.

### Cerrar una publicación desde el panel

Quien administra puede cerrar sin publicar una publicación detenida o incierta con el botón «Cerrar esta
publicación» de la tarjeta de la activación, que pide confirmación. No hace falta entrar en GitHub. Esto es lo que
pasa:

1. El servidor pregunta él mismo a GitHub si la ejecución que manda en la activación (la original o, en un
   reintento, la que reintenta) ha terminado, en su último intento: un «Re-run jobs» en marcha cuenta como en curso.
   No se fía de lo que traiga el navegador. Si sigue en marcha, no se pide nada y el panel dice que hay que esperar;
   si GitHub no responde, dice que se vuelva a intentar.
2. Anota la solicitud en la activación, con la misma comprobación de revisión que los demás pasos. Es de un solo
   uso, solo concede cerrar sin publicar y está ligada a la revisión exacta de la activación (si la activación
   avanza, deja de valer) y al trabajo que se despacha a continuación.
3. Reserva y despacha ese trabajo con el mismo despacho que el botón de actualizar (`reintentar-pendientes`). Es la
   vía con menos piezas: no hay que esperar a la comprobación diaria ni abrirle una excepción. Si el despacho falla,
   la solicitud caduca sin usarse, el panel lo dice y se puede volver a pedir.
4. La ejecución despachada, antes de cualquier otra cosa de su paso de activación, observa lo que sirve cada Worker
   y lo manda al servidor (operación `cerrar-solicitado`). El servidor vuelve a preguntar a GitHub, comprueba que la
   solicitud sigue vigente y que la pide esa misma ejecución (mismo repositorio, workflow y rama, con su OIDC), y
   cierra la intención como `abandonada` (motivo `a-mano`) solo si cada Worker sirve otra vez lo anterior. Si no, la
   intención sigue en su fase, la solicitud queda usada con lo observado y el panel lo dice.

La solicitud de cierre caduca 363 minutos después de anotarse. Solo puede cumplirla la ejecución a la que
se concedió. El panel dice que el cierre está en curso solo mientras su
ejecución puede cumplirlo: la activación sigue en la revisión en que se anotó y el último trabajo es el despachado, sin
terminar. Cuando esa ejecución ha registrado su recibo y terminado, su paso de activación pudo cumplirlo justo
después: el panel dice que el cierre todavía no consta y que, si sigue igual en unos minutos, se vuelva a pedir. Si
el despacho falla, si llega otro trabajo o si un «Re-run jobs» de la ejecución original hace su relevo y avanza la
activación, dice que el cierre no se ha llegado a hacer. En los dos casos vuelve a mostrar el botón. También
dice si la web había cambiado o si la publicación quedó cerrada. La confirmación avisa de que, para cerrar, Faro pone
en marcha una actualización que, si encuentra datos nuevos, los publica después.

Requiere `FARO_ACTIVACION_AUTOMATICA=si` en el servidor y en el repositorio: el paso de activación de la ejecución
despachada es el que cumple la solicitud.

### Recuperar la activación cuando el run ya terminó

«Re-run jobs» de GitHub permite recuperar la activación del **mismo run**, con un intento nuevo real
(`2`, `3`, etc.). Conserva las entradas del despacho,
el identificador del run, el código y el workflow originales. El run original debe haber utilizado
ya el workflow con esta vía de recuperación; cambiar los archivos actuales del repositorio no la
incorpora a una ejecución antigua.

1. Comprobar que existe una activación de ese trabajo validado y que se conservan su índice privado
   versión 2, recibo y artefacto exactos. Esta vía no crea una activación ausente ni convierte
   un recibo pendiente de admisión en candidato autorizado.
2. Mantener el código, workflow y pins de confianza originales. La configuración vigente del servidor
   debe admitirlos y `FARO_ACTIVACION_AUTOMATICA=si` debe seguir habilitada tanto allí como en el
   repositorio. No cambiar esos valores para hacer pasar otra identidad ni lanzar un workflow nuevo
   con los mismos inputs como sustituto del run original.
3. En GitHub Actions, abrir la ejecución original ya terminada y utilizar «Re-run jobs». El nuevo
   intento recupera el mismo SHA y prepara las dependencias, pero omite la construcción, el motor
   y el aviso de resultado. El paso optativo invoca el comando privado `recuperar`, con los mismos
   argumentos de activación y la identidad OIDC real del intento actual; no se añaden inputs ni
   controles al panel.
4. El consumidor coteja la activación, el índice, los bytes del recibo y el artefacto conservado antes
   de pedir el relevo. El servidor consulta el intento anterior exacto (`N-1`) en GitHub y exige que
   esté `completed`, con la misma ejecución y confianza. El relevo aplica CAS sobre la revisión de
   activación y conserva su instantánea, evidencias y huellas originales. Desde ese momento solo el
   intento vigente puede avanzar; quedan cercados el intento `1` y los supervisores anteriores.
   Repetir el relevo usa la revisión base de su concesión y no concede un efecto nuevo.
5. Revisar la fase confirmada y los registros del nuevo intento. En `reservada` puede preparar la
   evidencia. En `preparada`, antes del relevo y de subir, exige que el despliegue y la versión única
   al 100 % de cada Worker sigan siendo los anteriores registrados. En las cuatro fases inciertas solo
   observa, igual que reconciliar. Desde `cursos-subida`, `cursos-confirmado` y `subida` continúa con el
   efecto siguiente, cada uno con su transición CAS aplicada. Una activación terminal permanece sin
   efectos nuevos. Un rechazo demostrado antes de cualquier efecto (candidato no verificable, variante o
   configuración no admitidas) cierra la activación como `rechazada`, igual que al activar, registrando
   antes el relevo de este intento.

Si falta el índice, el recibo, la activación o el artefacto, si su retención ha vencido o sus bytes
no concuerdan, la recuperación se detiene. No reconstruye el candidato ni vuelve a ejecutar el motor,
ni reenvía un recibo ni sustituye la selección por otro trabajo. Un resultado sin admitir sigue sujeto
al protocolo de trabajo y a `reanudar` dentro del intento `1`; esta recuperación no lo amplía.

Cero coincidencias de una subida incierta no prueban ausencia de efecto; varias coincidencias tampoco
identifican una versión segura. Ninguno de esos casos permite repetir la subida. Una promoción incierta
solo se confirma si coinciden el proveedor, la construcción servida y el manifiesto; no se repite el despliegue.
Los errores de transporte conservan la incertidumbre para investigarla, sin reiniciar fases ni liberar
el trabajo por silencio.

Un cambio externo visible en el despliegue o la versión anterior detiene la recuperación antes de la
subida desde `preparada`; el adaptador conserva además su cotejo previo a desplegar. Estas observaciones
no constituyen CAS remoto ni excluyen un cambio posterior desde Dashboard u otro CLI. Mantener un único
escritor y no intentar resolver el conflicto repitiendo efectos o cambiando las huellas esperadas.

La confirmación acredita las observaciones realizadas, no la propagación mundial ni la caché de cada
dispositivo. Las pruebas locales usan proveedor y transporte simulados: la configuración real, Access,
bucket, workflow y activación deben ensayarse en el alojamiento de la entidad antes de declarar el
circuito operativo. Esta vía no promete recuperación desatendida de cualquier interrupción.
