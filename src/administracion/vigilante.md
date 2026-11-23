# Vigilante de mantenimiento

El vigilante es una tarea distinta del actualizador. Lee la autoridad administrativa existente, evalúa plazos con un reloj explícito y conserva decisiones de aviso en ese mismo SQLite. No descarga fuentes, lanza trabajos, solicita credenciales, modifica la entrega ni instala un cron. Su salida no certifica disponibilidad de cursos ni salud de la versión servida.

La CLI `herramientas/mantenimiento/vigilante.ts` permite operar sobre una instalación Node. El panel también puede
solicitar una evaluación explícita: Node observa su lector local y Cloudflare usa el último recibo admitido. En
Cloudflare, además, el evento programado del Worker lo evalúa cada día y envía el aviso que toque por el canal que
configure la entidad (ver [Avisos desde el evento programado](#avisos-desde-el-evento-programado)); un inicio rechazado
con evidencia lo evalúa y avisa en el momento. La CLI y Node no
envían avisos. La operación de preparación remota se describe en la guía de despliegue y es distinta de comprobar o
actualizar los datos.

## Hechos separados

- `programacion.ultimoEventoEn` es el evento consumido por el programador, incluso si se omitió por un trabajo ocupado o una activación sin resolver. No demuestra que comenzara el ejecutor.
- `eventosProgramados` repite los últimos 60 eventos con su resultado y su motivo; `requiere-atencion` señala una reserva vencida que el programador no ha podido liberar.
- Un fallo del manejador programado queda en `eventosProgramados` con `fase` (`configuracion`, `validacion`, `preparacion`, `reconciliacion`, `reserva` o `despacho`) y `motivoFallo` (`error` o `plazo-agotado`), sin el texto del error. Antes de consumir el evento, la fila es `fallida` con motivo `evento-sin-consumir` y no mueve `ultimoEventoEn`: el programador sigue dando `evento_esperado_sin_registro` y una reserva posterior del mismo evento sustituye la fila. El fallo del despacho anota la reserva `nueva` que lo precedió. Si la autoridad no puede guardar el fallo, el registro de Cloudflare recibe `{ fase, registrado: false }`. También ocurre con un instante posterior al reloj de la autoridad, que no se guarda para no dejar una fila por delante de toda evaluación. El historial con `fase` y `motivo_fallo` es la versión 2 de `programacion_eventos_version`; una autoridad en la versión 1 se migra al prepararse, con `ALTER TABLE`, y conserva sus filas sin fase.
- `trabajoObservado` conserva la reserva, permiso de inicio y recibo existentes. Un plazo sin cierre significa que falta confirmar ese cierre; no acredita cancelación, terminación ni permiso para repetir efectos.
- `ejecutor · inicio_rechazado` es una incidencia con evidencia, no un umbral. Aparece cuando la reserva abierta y sin inicio confirmado guarda `inicioRechazado` (`revision_no_autorizada`). Ese hecho lo deja el receptor del permiso de inicio cuando GitHub ejecuta, con una identidad válida en todo lo demás, una revisión del workflow o del código que el servidor todavía no tiene autorizada (ver `docs/actualizacion-remota.md`). Es distinta de `inicio_no_confirmado`, que es la falta de inicio vencido el plazo `plazoInicioMs`. Se da en cuanto se registra, sin esperar a ese plazo: en Cloudflare, el primer registro del hecho evalúa el vigilante y envía el aviso en segundo plano (`waitUntil` de la petición), con el mismo canal y el mismo registro de lo avisado que el evento diario; sin `FARO_AVISO_URL` no evalúa ni intenta nada, y un fallo queda en el registro de Cloudflare con `{ fase: 'aviso', origen: 'inicio-rechazado' }` sin tocar la respuesta. Node no envía avisos: allí la incidencia aparece en «Comprobar estado». Su referencia es la de la reserva, así que el aviso sale como `nuevo` una sola vez por reserva; los permisos negados siguientes de la misma reserva no la cambian, y mientras siga abierta solo cabe el recordatorio diario de siempre. Un inicio confirmado después, o el cierre de la reserva, la sustituye por la decisión que corresponda. El panel dice qué ha pasado y qué hacer: publicar esa revisión o volver a ejecutar la autorizada.
- La decisión `activacion` es solo un aviso: `datos_validados_sin_publicar`, con la fecha de `datosSinPublicarDesde` como referencia, mientras unos datos validados sigan sin publicar (tras un abandono o un rechazo, y durante su reintento), y `sin_datos_validados_por_publicar` cuando la última activación no deja ninguno. No cambia lo que ve la persona.
- `pulsoContinuo: no-instrumentado` permanece explícito: el producto no registra un heartbeat periódico del proceso. El aviso se refiere a ausencia de actividad esperada o de confirmación dentro del plazo configurado.
- `mantenimiento` reutiliza `salud-datos.js`. Las comprobaciones pertenecen a cada conjunto, con su intervalo publicado por el descriptor de la fuente y conservado en la instantánea. El reloj de evaluación no sustituye `observadoEn`. Una consulta de otro conjunto no renueva esta comprobación; sin evidencia individual se declara sin observación. Revisión manual, candidatas y productores externos no reciben una descarga periódica inventada.
- `fechaDatos` conserva el periodo/fecha del dato. No interviene en el vencimiento de la consulta: un dato trimestral no debe ser diario.
- `activacionObservada` mantiene la fase y fecha registradas. `entregaActiva: sin-observacion-actual` no se deduce del último candidato ni de una activación pasada.

El plazo de observación controla la antigüedad de la instantánea administrativa, no la validez del contenido. Un ciclo `sin-pendientes` puede acreditar que el ejecutor respondió, sin renovar las fechas de las comprobaciones que contiene.

## Configuración y operación explícitas

La configuración es JSON cerrado, versión 1, suministrado en `FARO_VIGILANTE` para el panel. Incluye `habilitado`, `activadoEn` (milisegundos UTC de la activación decidida por el operador), `plazoEventoMs`, `plazoInicioMs`, `plazoCierreMs` y `plazoObservacionMs`. No hay valores implícitos ni un alta automática. Cada plazo positivo admite hasta 31 días como límite operativo de esta configuración; no es una cadencia o TTL de una fuente. El fichero no contiene datos personales, destinos de correo ni secretos.

El cron esperado procede exclusivamente de la configuración existente `FARO_ACTUALIZACION_PROGRAMADA`. Si no está habilitada, el vigilante no inventa un evento que deba recibirse: da `programador · programacion_apagada` (incidencia, solo aviso) o, con `pausaHasta` vigente (día UTC incluido), `programacion_en_pausa` (conforme), y el panel recibe `pausaProgramadaHasta`, que solo viaja con una pausa vigente. La decisión sale de la configuración y por eso el panel la muestra en cualquier comprobación; el aviso lo envía el evento diario, así que solo llega mientras el Cron Trigger siga configurado. `pausaHasta` solo se admite con la programación apagada. Sin `FARO_ACTUALIZACION_PROGRAMADA` no hay decisión del programador. Los intervalos de comprobación proceden de los contratos de las fuentes incluidos por Orquestación; no existe una segunda lista de cadencias en el vigilante.

Con Node de mantenimiento y rutas absolutas privadas, fuera de la web:

```sh
node herramientas/mantenimiento/vigilante.ts preparar /ruta/administracion.sqlite /ruta/vigilante.json
node herramientas/mantenimiento/vigilante.ts verificar /ruta/administracion.sqlite /ruta/vigilante.json
node herramientas/mantenimiento/vigilante.ts historial /ruta/administracion.sqlite /ruta/vigilante.json
```

La base debe existir y tener preparados trabajos, programación y activación. `verificar` e `historial` no migran. `preparar` añade explícitamente las tablas del vigilante sin crear ni alterar aquellas autoridades. Repetir la misma configuración no escribe ni renueva fechas. Reconfigurar mediante `preparar` conserva sus versiones y todo el historial; no resuelve incidentes por sí solo. La apertura reutiliza la seguridad de rutas, permisos y transacciones del almacén administrativo. El reloj se inyecta en `evaluarVigilante`, en las operaciones SQLite y en `ejecutarVigilanteLocal`; la CLI usa el reloj local real.

`verificar` y `verificar-local` devuelven código 1 si hay incidencias persistidas; un fallo propio de lectura/escritura termina con código 2 y no confirma recuperación. El estado deshabilitado se expresa como tal y no necesita abrir la base. Ninguno de estos códigos autoriza a ejecutar el actualizador ni a publicar.

## Observación de la instalación local

`verificar` conserva el modo predeterminado por recibo del último trabajo. Su salida declara
`origenDatos: recibo`; no adopta el resultado de una CLI Python ejecutada por otro camino.
Para vigilar explícitamente la misma instalación que consulta el panel Node:

```sh
node herramientas/mantenimiento/vigilante.ts verificar-local /ruta/administracion.sqlite /ruta/vigilante.json
```

La salida declara `origenDatos: lectura-local`. El comando reutiliza `crearLectorEstadoDatosNode`: ejecutable,
argumentos, entorno mínimo, plazo de tres segundos, cota de salida y validación del DTO son los del panel.
La raíz se calcula desde los módulos instalados, incluidas carpetas con espacios y Unicode; ni el JSON de
configuración ni el HTTP eligen una raíz, una orden o una instantánea. La base administrativa sigue siendo la misma
base privada ya preparada. No se crea un almacén adicional de instantáneas ni un segundo diario de intentos.

La consulta se completa antes de tomar el reloj de evaluación. `observadoEn` en una lectura local es la hora de
reconstrucción del DTO, no un pulso del mantenimiento: ese modo no evalúa ni resuelve la clave `lectura-datos` del
recibo. Conserva sus incidencias previas hasta que el propio recibo aporte evidencia causal. La clave independiente
`lectura-local` solo acredita que se pudo leer y validar la instalación. Las decisiones de fuentes y conjuntos
conservan sus fechas, ciclos y huellas: leer no acredita una nueva captura oficial. El fallo, la salida inválida,
el timeout o la cancelación después de iniciar la lectura registran solo una incidencia técnica `lectura-local`
en el mismo diario, si la autoridad y el reloj son verificables. No resuelven ninguna otra clave. Un preaborto
no registra un intento que no comenzó. La siguiente lectura local válida puede resolver esa incidencia técnica,
sin resolver por ello una incidencia del recibo o de una fuente. No se recurre
silenciosamente al recibo anterior cuando falla la lectura local. Deshabilitado no lanza el lector ni abre la base.

Ambos modos reutilizan el evaluador y la misma transacción del registro de decisiones. El origen distingue la
huella del corte local; cambiar de modo con el mismo corte e información distinta se rechaza. Las referencias
causales e incidencias conservan las reglas existentes: una reconstrucción local no resuelve un fallo remoto
posterior ni renueva una comprobación vencida. El historial conserva decisiones y referencias compactas, sin
copiar la instantánea local. El origen se conserva en cada transición del historial como `recibo` o `lectura-local`. No cambia las claves de
fuentes/conjuntos ni abre otro episodio de aviso al alternar modos. Las filas anteriores conservan origen
`no-registrado`: nunca se atribuye retrospectivamente una procedencia no demostrada.

Este modo no fabrica reserva, inicio, cierre, runId ni identidad OIDC. `trabajoObservado` y `activacionObservada`
siguen describiendo únicamente sus autoridades existentes. El resultado de una actualización local se observa
por sus registros de mantenimiento, no se convierte en un trabajo remoto autenticado ni activa una entrega.

Para ensayos controlados existe la función asíncrona `ejecutarVigilanteConLecturaLocal`, con lector, señal de
cancelación y reloj inyectables. La CLI utiliza el lector fijo y el reloj real. La función síncrona
`ejecutarVigilanteLocal` y la API SQLite por recibo conservan sus argumentos existentes; la API local explícita
`comprobarVigilanteConLecturaLocalSqlite` valida los datos antes de guardar decisiones. Ninguna de estas APIs
instala tareas ni descarga fuentes.

## Episodios, idempotencia e historia

Solo se añaden configuraciones, marcas causales por clave y canal y transiciones compactas: clave, decisión, motivo, fechas de observación/evaluación, referencia y huellas. No se copian instantáneas, capturas, recibos, sesiones o credenciales. El historial de consultas y trabajos sigue en sus productores; el vigilante no es un segundo registro de sus intentos.

La migración, la lectura de autoridades y las decisiones se ejecutan bajo transacción. Un corte revierte íntegramente. Repetir el mismo corte no duplica decisiones; una entrada distinta en ese mismo corte se rechaza. No se admiten cortes anteriores al reloj durable. Una marca causal conserva también las observaciones posteriores que confirman la misma decisión sin duplicar historia; un soporte antiguo no la sustituye y se devuelve en `omitidasPorAntiguedad`. Las fuentes conservan marcas separadas para operación local, intento remoto y cada conjunto. Para el conjunto se compara su comprobación con su propia incidencia pendiente, nunca con una consulta de otro conjunto. Una reconstrucción posterior no aumenta esos soportes. El avance válido de un canal se conserva bajo la misma transacción, pero no permite resolver una incidencia si otro canal retrocede o desaparece. La fecha agregada de una decisión de fuente no autoriza la admisión: se comprueba cada canal.

Las decisiones de conjunto conservan una referencia JSON versión 2 con la fecha de comprobación, el siguiente plazo admitido y la identidad de la evidencia. Si llega soporte antiguo, se devuelve en `omitidasPorAntiguedad` y se aplica la misma regla de día UTC de `salud-datos.js` al último plazo admitido. Así no vence antes por la captura antigua ni queda conforme indefinidamente cuando llega su plazo real. Una referencia anterior sin ese soporte versionado no se convierte en una comprobación inventada: la lectura necesaria para recalcular falla explícitamente. El formato de marcas 2 conserva el instante UTC completo (segundos o seis decimales, como exige el contrato) y una huella de identidad del soporte. No se convierten microsegundos absolutos a Number: los milisegundos siguen sirviendo para reloj/plazos y la proyección pública, pero no deciden el orden causal. Una fecha igual con distinto soporte no demuestra recuperación; se devuelve también en `omitidasPorAntiguedad` como soporte no demostrablemente posterior. La repetición exacta y el vencimiento por reloj del mismo soporte sí se admiten.

`preparar` migra explícitamente el formato de marcas 1 al 2 añadiendo soporte y discriminador de formato bajo la misma transacción. La consulta no migra. El legado conserva fechas, huellas originales y decisiones; el soporte preciso que no registraba queda desconocido (`null`), sin inventar fracciones ni identidad. Un empate con esa precisión desconocida no acredita recuperación. Repetir la preparación no rejuvenece ni reescribe el estado.

Las marcas no contienen decisiones, disponibilidad ni instantáneas. La ausencia de instantánea no resuelve las incidencias anteriores de sus fuentes. Se conserva una transición de recuperación cuando existe evidencia suficiente; no se borra el incidente.

`requiereAviso` identifica la apertura de un episodio; no afirma que se haya enviado un aviso. Otra evaluación del mismo episodio no genera una segunda apertura. El envío de avisos tiene su propio registro, descrito a continuación.

La lectura del historial es paginada y devuelve la revisión de la colección. Para continuar coherentemente, `leerHistorialVigilanteSqlite` exige la revisión esperada; un cambio obliga a reiniciar. La CLI muestra la primera página de hasta 200 decisiones. El panel usa páginas de hasta 50 y exige la misma revisión para continuar. Cada fila leída comprueba su huella. Un formato desconocido, tablas ausentes después de preparar o corrupción detectada fallan explícitamente, sin reconstruir un estado vacío.

No se purga historia ni se define retención destructiva. Repeticiones sin transición no aumentan la historia; los cambios reales de decisión o referencia añaden registros compactos. El ensayo local usa bases sintéticas y no acredita que el vigilante esté instalado en otro proceso, Cloudflare o un servicio del sistema.

## Migración del origen de decisiones

`preparar` añade explícitamente `formato_decisiones:2` y la columna nullable `origen` en el registro existente,
bajo su misma transacción. Las filas antiguas mantienen fechas, IDs, avisos y SHA originales; su origen queda
null en SQLite y `no-registrado` en la lectura. Las nuevas filas vinculan el origen a su sello. Verificar o leer
historial no migra: una base anterior necesita esa preparación explícita. Repetirla no renueva el reloj ni
reescribe decisiones. La omisión de una clave fuera del alcance de un modo conserva la decisión previa.

## Fallos propios y reloj

La autoridad debe existir, ser SQLite legible y estar disponible antes de lanzar el lector. No se crea una base
para registrar su propia ausencia. Base ausente, corrupta, bloqueada o sin preparación válida: error técnico
y ninguna recuperación confirmada. Si no se puede registrar un fallo de lectura, la excepción conserva tanto
la causa original como el error del registro; la CLI no fabrica un historial alternativo. Su diagnóstico
no muestra cuerpos, rutas privadas ni la causa sin filtrar.

El reloj se valida antes de abrir o consultar y de nuevo al terminar la lectura. Un reloj no entero, negativo,
fuera del rango civil o anterior a la activación se rechaza. No se incrementa artificialmente para resolver
conflictos; dos entradas distintas en el mismo corte siguen siendo incompatibles. Si el reloj deja de ser
válido tras una lectura, no se registra una fecha ficticia. La función asíncrona conserva `cause` y, cuando
se pudo registrar el fallo, lanza `ErrorLecturaLocalVigilante` con `codigo:2` y el resultado persistido.

Una lectura cuyo DTO es formalmente válido pero posterior al instante de evaluación también se registra como fallo local. Se usa el corte real ya medido y validado, sin adelantar el reloj. El rechazo de reloj o de la autoridad SQLite permanece separado: no se convierte en una observación de fuente ni confirma recuperación.

## Avisos desde el evento programado

En Cloudflare, el manejador `scheduled` del Worker atiende la programación diaria y después evalúa el vigilante con el
último recibo admitido, en la misma transacción que guarda sus decisiones. Lo hace también cuando la actualización ha
fallado y cuando la programación no está habilitada, porque apagarla por error también para la actualización; no lo
hace si el panel no se ha podido preparar. Requiere `FARO_VIGILANTE` habilitado y preparado.

El canal es una petición `POST` HTTPS a `FARO_AVISO_URL`, un secreto del Worker. La dirección se valida al leerla: solo
`https:` y sin usuario ni contraseña. La petición lleva la identidad web genérica, tiene un plazo de tres segundos, no
sigue redirecciones (`pedirSinRedirecciones`: una redirección cuenta como `respuesta-no-admitida`) y solo admite una
respuesta 2xx; no lee su cuerpo. Sin `FARO_AVISO_URL` no se envía nada; con una dirección no admitida, el estado es
`destino-no-admitido`.

En la respuesta del panel, `avisos` (estado del canal y último intento) solo viaja cuando dice algo más que «no
configurados y sin intentos», y en cada evento `fase` y `motivoFallo` solo viajan si falló. Así un panel abierto antes de
actualizar sigue leyendo la respuesta de una instalación sin avisos ni fallos; la ausencia de `avisos` equivale a no
configurados. El panel muestra cada fallo con su fase y su motivo, y el estado de los avisos con su último intento.

Cuerpo exacto, JSON:

```json
{
  "version": 1,
  "origen": "faro-vigilante",
  "tipo": "nuevo",
  "evaluadoEn": "2026-10-23T12:00:00.000Z",
  "desde": "2026-10-23T12:00:00.000Z",
  "panel": "https://origen-administrativo.example/administracion/",
  "decisiones": [
    { "clave": "programador", "motivo": "evento_esperado_sin_registro", "desde": "2026-10-23T12:00:00.000Z" }
  ]
}
```

`tipo` es `nuevo` cuando aparece una incidencia o cambia el motivo de una abierta; `recordatorio`, si las mismas siguen
abiertas un día después del último aviso enviado, con una hora de margen para que un evento diario que llega unos
segundos antes no lo retrase al día siguiente; `resuelto`, una sola vez, cuando ya no queda ninguna, con
`decisiones` vacío. `desde` es el inicio del episodio y cada decisión lleva desde cuándo está así. Las claves y los
motivos son los del vigilante: no hay datos de personas, rutas, recibos ni secretos.

Lo último avisado (episodio, incidencias con su fecha y hora de envío) se guarda en `administracion_vigilante_aviso`,
en el mismo objeto durable, y solo cambia cuando un envío se confirma. Un envío fallido no tumba el evento programado:
queda como último intento con su motivo (`respuesta-no-admitida`, `sin-respuesta`, `plazo-agotado` o
`destino-no-admitido`), el panel lo recibe en `avisos.ultimoIntento` y el evento siguiente vuelve a intentarlo.
Preparar el panel, preparar el aviso en la autoridad, enviarlo y registrar el envío tienen cada uno su plazo (cinco,
cinco, tres y tres segundos: unos 16 s como mucho), para que un envío aceptado quede registrado siempre que la
autoridad responda.

Con `FARO_VIGILANTE` no válida no hay evaluación, pero el evento deja en el registro de Cloudflare
`{ fase: 'aviso', motivo: 'configuracion-vigilante' }` y, si `FARO_AVISO_URL` es válida, envía un aviso `nuevo` con
`vigilante · configuracion_no_valida`, con la misma huella y el mismo recordatorio diario que las demás incidencias;
corregida la configuración, la incidencia sale de lo avisado (con `resuelto` si no queda ninguna). El panel la sigue
mostrando como no válida y dice qué corregir. Si no se puede evaluar el vigilante, el registro de
Cloudflare recibe `{ fase: 'aviso' }`; si lo que falla es el registro del envío, `{ fase: 'aviso', envio }` con el
resultado del envío. El servicio que recibe los avisos debe admitir repeticiones: dos entregas simultáneas del mismo
evento, o un envío aceptado cuyo registro falla, pueden hacer llegar el mismo aviso dos veces.
