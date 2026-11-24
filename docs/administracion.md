# Administración del servicio

## Alcance y criterios de presentación

El panel reúne la operación de la plataforma de datos y de sus consumidores web/PWA.
Este apartado fija criterios de presentación; las operaciones descritas después
identifican las capacidades disponibles en el código. Su configuración y comprobación
en el alojamiento receptor son necesarias antes de utilizarlas allí.

| Bloque | Responsabilidad |
| --- | --- |
| Salud de la base | Salud global, por tema y por fuente; vigencia de la entrega servida, última comprobación, incidencias, derivados afectados y diagnóstico comprensible. |
| Actualizaciones | Calendario según cada fuente, ejecución manual mediante la misma cadena, progreso, resultados, reintentos y registro. |
| Página web | Disponibilidad independiente de cada sección del menú. Inicio permanece disponible; cada sección desactivada retira sus enlaces y su acceso directo. |
| Acceso y seguridad | Sesión administrativa, acceso por código de un solo uso para identidades autorizadas y controles separados de API, MCP y A2A. |

Las IA propias del recorrido se ejecutan en el dispositivo y no dependen de una
conexión a un modelo de lenguaje. El panel no ofrece interruptores de inferencia ni
un selector de modelos externos. No se ofrece una sección independiente de chatbot;
el recorrido web y los canales de integración de datos se conservan.

Los cambios de conectividad conservan sesión, revisión, permisos de acceso y estados persistidos.
No abren permisos por omisión ni descartan claves guardadas para simplificar un formulario.
Los documentos conservados no habilitan capacidades por sí solos; los cambios de conectividad
no modifican los motores locales.

La salud de la entrega y el resultado del último intento se muestran por separado.
Cada luz procede de reglas comprobadas y del registro: verde para datos utilizables
dentro de su plazo, ámbar para una incidencia con servicio conservado o revisión
vencida, rojo para una condición que exige intervención. Sin evidencia se indica
«sin comprobar», nunca verde. Una fuente con oferta retirada conserva su diagnóstico;
ocultar una sección no oculta fallos ni detiene sus actualizaciones. Las fuentes
candidatas todavía no activadas se distinguen de las que alimentan la entrega.

Los indicadores son estáticos, con texto y forma además de color. Cada magnitud
muestra qué mide y su unidad; no se inventa un porcentaje de salud. La fecha pública
corresponde a la entrega activa y su vigencia, no a la apertura del panel ni a la
última compilación. El [vigilante](../src/administracion/vigilante.md) permite una comprobación explícita desde
la CLI de mantenimiento y desde el panel, si está configurado y preparado. Node usa la lectura local; Cloudflare
usa el último recibo admitido. No instala una tarea automática ni envía avisos.

La actualización manual y la programada comparten validación, idempotencia, exclusión
de ejecuciones incompatibles y recuperación. Pulsar repetidamente no duplica trabajos
ni evita requisitos. El mantenimiento opera fuera del móvil; la web/PWA consume una
entrega validada. La configuración y prueba del alojamiento remoto se cierran durante
el despliegue, sin presentar el ensayo local como activación remota.

### Lectura y uso sin conocimientos técnicos

El diseño final presenta primero un resumen comprensible y después tarjetas por tema
y fuente. Cada tarjeta responde qué ocurre, si afecta a lo que muestra Faro y cuál
es la siguiente acción. El lenguaje es cercano y preciso: «Al día», «No se pudo
comprobar» o «Necesita atención», siempre con texto junto al indicador estático.
«Reintentando» solo aparece mientras exista una ejecución confirmada; una fecha
prevista se expresa como «Próxima comprobación», sin fingir actividad.

El detalle separa el último intento de la última comprobación válida y muestra sus
fechas. Una incidencia puede explicar «La última consulta falló; conservamos los
datos comprobados el…» cuando ambos hechos estén acreditados. La pantalla no exige
leer JSON, rutas, huellas ni trazas para comprender la situación. Las evidencias y
el diagnóstico técnico quedan en un nivel secundario, con los límites de acceso
administrativo existentes; no se exponen secretos ni mensajes remotos sin filtrar.

La actividad global permite abrir el detalle de una fuente y seguir sus intentos
y decisiones por los identificadores comunes. Acciones como «Buscar actualizaciones»
y «Ver qué ocurrió» explican su efecto y muestran el resultado confirmado. El diseño
se comprobará en móvil, con teclado y sin depender del color. Este apartado fija
criterios de aceptación; todavía no acredita la pantalla final instalada.

El backend administrativo permite cambiar la disponibilidad de REST, MCP y A2A.
Está separado de las credenciales de consulta. No permite ejecutar órdenes, editar código ni modificar datos oficiales.
La pantalla de `/administracion` permite abrir una sesión, consultar estos controles, guardar cambios, solicitar y seguir
un trabajo de actualización, retirar o reconciliar su solicitud, consultar el registro de activación,
gestionar secciones públicas, invitar instituciones, revisar sus accesos y cerrar el panel.
Este documento describe esas operaciones y su montaje en el servidor.

## Uso del panel

Después de identificarse, el panel recibe al usuario con una bienvenida: su correo, su entrada (`E-…`), cómo se ha
verificado y si el panel está libre. «Abrir sesión única» toma la sesión administrativa, que es única: si la tiene
abierta otro usuario, la apertura se rechaza (`409 panel_ocupado`) y la bienvenida dice solo «El Panel de Control está
abierto por {correo} desde las {hora}.»; el intento queda en el registro. Si es el mismo usuario en otro dispositivo,
la bienvenida lo dice y ofrece «Cerrar aquella y abrirla aquí»: es lo único que envía `{retomar: true}`; abrir sin más
envía `{retomar: false}` y nunca desplaza una sesión. Sin un correo verificado por Access no se abre nunca
(`403 correo_no_verificado`) y la bienvenida dice qué ha pasado y qué hacer. Abrir solo la página no desplaza a nadie.
Al abrirse, un anillo que se completa y una marca que se dibuja, una sola vez y en menos de un segundo y medio, dan
paso al panel; con movimiento reducido se entra directamente. La apertura lee los controles y las secciones y, después,
los datos, el trabajo y la publicación que resume el Inicio. Mientras se desconoce la disponibilidad no muestra
interruptores como si estuvieran apagados. Una lectura automática no sustituye un borrador de secciones existente.

El panel tiene una barra superior fija (FARO · Panel de Control, la sesión única con su identificador `S-…` y desde
qué hora, «Cerrar sesión», idioma y tema) y una navegación lateral plegable por grupos, con una sola selección:
Inicio; Datos (Fuentes, Actualizaciones, Publicaciones, Revisión editorial); Web (Secciones, Conectividad); Accesos
(Administradores, Instituciones, Claves de acceso); Avisos; Encuesta; y Registro del panel. Cada apartado tiene migas,
título, una frase, una barra de órdenes y una rejilla de 12 columnas con paneles iguales. El apartado se elige con el
fragmento de la dirección (`#fuentes`), así que los enlaces, atrás y adelante funcionan; en pantallas estrechas la
lateral es un menú que se cierra al elegir o con Escape. El Inicio reúne cuatro indicadores, la tabla «Estado del
servicio» (una fila por área, con estado en icono y palabra, detalle, hora de comprobación y enlace a su apartado),
«Requiere atención» (lo grave primero) y «Actividad reciente» del registro. Solo usa lo que el cliente ya ha leído: lo
que no ha llegado dice «Sin dato» y, mientras falte algún dato, el estado general no dice «Todo bien».
Seleccionar interruptores prepara un cambio; «Guardar cambios» lo envía al servidor con la revisión que se ha leído.
La pantalla muestra los valores confirmados. Si otra operación ha cambiado la revisión, presenta los valores actuales
para revisarlos y no sobrescribe el cambio.

El token de sesión solo se conserva en la memoria de esa página: no se copia a otras pestañas, cookies ni almacenamiento del navegador.
Una recarga vuelve a la bienvenida, que muestra la sesión propia abierta y ofrece retomarla de forma explícita. La
pantalla visible comprueba periódicamente su vigencia y al recuperar el foco. Durante un trabajo alterna esa lectura
con su seguimiento; ambas comprueban la sesión en el servidor. El sondeo no prolonga la sesión; la actividad real del
usuario con la página visible (pulsar, escribir o desplazarse con la rueda o con el dedo) sí puede renovarla, como
mucho una vez por minuto. El evento `scroll` no cuenta: también lo provocan los repintados y el anclaje del navegador.
Dos minutos antes del cierre por inactividad la barra avisa una vez, sin cuenta atrás, y ofrece «Seguir con la sesión».
Cuando el mismo usuario la retoma en otra página, aquí se retiran los controles y la bienvenida dice que se ha cerrado
por eso. El servidor rechaza las acciones de la sesión anterior desde la sustitución, aunque la pestaña esté suspendida
y todavía no haya recibido el aviso.

Ante un fallo de red se bloquea la edición. La reconexión consulta el estado sin recuperar por la fuerza una sesión
sustituida ni repetir cambios pendientes de confirmación. «Cerrar sesión» elimina el token de esta página y vuelve a la
bienvenida con lo que ha pasado; si la conexión falla, el cierre remoto no queda confirmado y la sesión del servidor
conserva su caducidad.

La página y sus recursos requieren Access antes de leer archivos, llevan `no-store` y quedan fuera de la caché PWA.
No cargan recursos externos ni usan scripts en línea. La construcción comprueba todos sus módulos y genera SRI para
el módulo de entrada; no utiliza el mapa de módulos público. Servir el HTML no necesita abrir el almacén de controles.

## Secciones públicas

La apertura consulta las secciones y «Consultar secciones» permite volver a leerlas. El panel muestra siete grupos: Qué es IA, Faro (con «Cómo funciona»), Empezar e informe de ejemplo,
Biblioteca (con «Guías»), Cursos, Datos globales y Comprobar. «Guardar secciones» aplica los interruptores mediante la sesión
y la revisión compartidas con los controles de conectividad. Cada operación conserva los campos de la otra;
no borra credenciales, cuotas, revocaciones ni datos. Cuando cambia la revisión se exige consultar explícitamente
el formulario afectado antes de volver a guardar. Consultar puede sustituir un borrador, previa confirmación.
Una respuesta perdida no provoca un reenvío automático.

La disponibilidad se aplica en el servidor a las páginas de cada grupo y, en el navegador, a sus enlaces y a
la copia sin conexión. Una sección desactivada devuelve `404`; una autoridad ilegible, `503`. Inicio, información
y créditos, accesibilidad, verificación y la página sin conexión permanecen disponibles. Los recursos compartidos,
el paquete de datos y los servicios REST/MCP/A2A conservan sus controles independientes: esto no es un mecanismo
para convertir datos ya publicados en privados.

«Cómo funciona» está dentro de `que-es-faro.html` y las guías dentro de `biblioteca.html`.
Los interruptores de Faro y Biblioteca gobiernan esas páginas completas. El permiso de Empezar abarca todos los
recorridos instalados y el informe de ejemplo.

La instalación ofrece el recorrido Original, el único que existe; el panel no tiene selector de recorrido y su
apertura se controla con el permiso de Empezar en Web → Secciones.

El modo guardado es `real` o `demo`. `GET /modo-recorrido.json` y `HEAD /modo-recorrido.json` lo devuelven con `no-store` si está instalado. Si queda guardado un modo retirado, responden `503` hasta que una persona administradora lo cambie explícitamente a real. No se borran los estados conservados.

`GET /secciones.json` y `HEAD /secciones.json` ofrecen una proyección pública `{version: 2, revision, secciones}`
sin credenciales, con `no-store`. Las instalaciones nuevas tienen las secciones activas, incluida Cursos, que
solo muestra la oferta admitida y vigente. Una instalación administrada conserva la política en su autoridad
SQLite, incluido cualquier apagado de Cursos; reiniciar no restablece los interruptores. Los campos de compatibilidad de la política almacenada no
se exponen como interruptores y se conservan al guardar.

La copia desconectada utiliza la última política válida recibida; no puede conocer una retirada posterior hasta
reconectarse. Si nunca recibió una política válida, las páginas opcionales quedan indisponibles. Una pestaña abierta
revisa al volver a estar visible o recuperar conexión: oculta el contenido de una sección retirada sin borrar
el relato en memoria. «Borrar todo» conserva la política pública de la entidad, que no contiene datos de la persona.

La instalación omite el HTML de los grupos apagados. Al reabrir un grupo, solo incorpora páginas cuyas huellas
correspondan a la versión instalada; si ya existe otra edición, se debe actualizar Faro desde el inicio.
Una política parcial, contradictoria o un error HTTP no se convierten en permiso para abrir secciones.

## Consulta del estado de los datos

La lectura del estado de los datos muestra una observación fechada de la instalación de mantenimiento: política de cada
fuente, fecha de referencia, reconstrucción local y evidencia de consulta oficial por conjunto. No descarga fuentes, no inicia una actualización
ni acredita qué generación está sirviendo la web. La ausencia de intentos se muestra como tal; un registro defectuoso
no se presenta como una comprobación correcta.

La vista muestra primero el estado global de las comprobaciones y el resumen por temas, con la misma prioridad
de incidencias y sin contar candidatas. No es un indicador de salud del producto ni alimenta el indicador público.
Las tarjetas de fuente conservan nombre, estado y última comprobación de cada conjunto. El diagnóstico, qué hacer
y las demás fechas quedan en un desplegable accesible. Los filtros de fuente y estado solo cambian la presentación.
El detalle técnico permanece disponible en un apartado desplegable independiente.
Una incidencia no queda oculta por una reconstrucción local correcta ni por otras fuentes comprobadas del tema.

La instantánea `version: 4` añade identidad, nombre, tema y modalidad leídos de las fichas operativas validadas.
Las candidatas, los lectores preparados y los productores externos se presentan aparte, sin incluirlos en el agregado
operativo ni concederles permiso de ejecución. Una revisión manual no se presenta como fallo de descarga ni como
revisión ya completada. El próximo intervalo se calcula con las reglas por día UTC del planificador; no es un TTL,
una promesa de ejecución instalada ni una afirmación de que el dato anterior haya dejado de ser válido.

La instantánea `version: 6` añade el bloque `retenidos` con los cambios que una actualización dejó a la espera de una
persona por perder más del 20 % de un conjunto (`plataforma_datos/orquestacion/cuarentena_panel.py`). Lo publicado se
conserva mientras tanto. El bloque tiene dos partes cerradas, y cada una dice si se pudo leer: `lectura` vale `leida` o
`ilegible`. Un archivo roto, de otra versión o con otra forma se informa como `ilegible`, nunca como «no hay nada
retenido».

- `cuarentena`: `{lectura, cambios}`. `cambios` es `null` si es ilegible; si no, una lista (vacía si no hay nada
  retenido) en el orden de los archivos. Cada cambio lleva `archivo` (el nombre del archivo del paquete), `grupo` (los
  archivos que se conservan con él, ordenados), `perdidas` (`{medida, antes, despues}`, con `medida` `entradas` o
  `cursos-soc` y cifras enteras), `desdeUtc` y `ultimaUtc` (desde cuándo está retenido y la última vez que se observó),
  `vigenteSha256` (la huella de lo publicado), `exportadoSha256` (la del cambio retenido) y `aceptadaUtc` (cuándo lo
  aceptó una persona, o `null`). Sale de `var/actualizacion/ejecuciones/cuarentena.json`.
- `censoSoc`: `{lectura, pendiente}`. `pendiente` es `null` si no hay oferta pendiente o si es ilegible; si no,
  `{cursosOferta, cursosCopia, huella, consultadoEn}`: los cursos de la oferta descargada, los de la copia que sigue
  vigente, la huella de la oferta y cuándo se consultó. Sale de las cifras que deja `censo_soc.py` junto a los
  originales del SOC.

Los instantes van en UTC con `Z` y conservan su precisión. El bloque no lleva rutas, direcciones ni texto libre; un campo
de más en cualquier nivel se rechaza. Hoy la plataforma de datos sigue emitiendo la `version: 5`
(`VERSION_PANEL_EMITIDA` en `contrato_comprobaciones_panel.py`), porque el lector del servidor rechaza una versión que
no conoce y cualquier campo de más. La v6 se activa cambiando esa constante cuando ya esté publicado el servidor que la
lee, en el orden que indica el despliegue: primero el lector y después el productor.

Los contratos 1–3 continúan leyéndose sin añadirles metadatos o hechos retrospectivos. En ellos el tema no conservado
se declara desconocido. El seguimiento remoto desconocido también puede ser nulo en v4: no se inventa un resultado
a partir de la fecha del intento. El estado describe la comprobación de las fuentes, no la salud de una entrega activa.
El cotejo con la versión servida sigue pendiente de una observación específica.

La instantánea privada `version: 2` añade la última operación de cada fuente y el alcance, cadencia y revisión
necesaria de los conjuntos declarados. La última comprobación oficial conserva su fecha, ciclo y huella de evidencia;
una reconstrucción local o un fallo posterior no los renueva. El resultado de la última operación se muestra por
separado. Una operación registrada «en curso» no demuestra que el proceso siga activo, y una consulta prevista
no acredita una respuesta recibida. Los productores externos y los catálogos manuales también permanecen visibles.

Las instantáneas `version: 1` siguen siendo legibles sin transformarlos ni añadirles evidencia retrospectiva.
En ellos la pantalla indica que esa información no está disponible. Los nuevos instantes conservan microsegundos;
el cierre del recibo conserva su precisión de segundos y la relación entre ambos se comprueba a esa precisión.
No se modifican los bytes de los recibos conservados ni sus huellas. Este contrato administrativo no cambia
la versión de la API pública de consultas.

La cobertura describe los recursos comprobables y sus límites. Una edición conocida puede estar consultada y
seguir necesitando revisión de sucesoras. Ninguno de estos estados, por sí solo, significa «Todo actualizado»:
también hace falta completar la cobertura prevista y comprobar la versión que sirve la web.

La operación exige Access y la sesión administrativa antes de leer, y vuelve a comprobar la sesión antes de devolver
el resultado. No prolonga la sesión por sí misma. Solo se transmiten campos delimitados: no se envían rutas de disco,
mensajes internos ni registros de ejecución. El resultado permanece en la memoria de la página mientras la sesión esté activa.

En Node, la consulta utiliza el Python de `.venv` y las entradas operativas de `var/actualizacion` de esa instalación,
con plazo y tamaño limitados. No acepta órdenes, rutas ni parámetros de ejecución desde el navegador. La composición
portable permite aportar un lector de estado a otro alojamiento; sin ese lector la consulta indica que no está disponible.
El adaptador Worker no ejecuta Python ni deduce el estado de mantenimiento a partir del paquete público.
Lee la observación conservada con el recibo autenticado del último trabajo. El recibo y esa observación se guardan
en una misma transacción, ligados a la solicitud, la revisión de reserva y la huella del cuerpo recibido.
Se conserva la fecha original de observación: consultar o repetir el recibo no la renueva.
Si el último trabajo todavía no tiene una observación admitida, el panel recibe la última admitida con
`deLaActualizacionAnterior: true` y lo dice en «Fuentes»; nunca la presenta como del trabajo nuevo. Si ninguna
actualización ha dejado aún una observación, la consulta indica que no está disponible. Un recibo rechazado puede aportar el estado de los módulos fallidos,
sin convertirlo en un candidato válido. La lectura exige la misma sesión antes y después de consultar el almacén.

## Comprobación del vigilante

En Actualizaciones, «Comprobar estado» evalúa y registra decisiones en la autoridad administrativa; el historial
paginado muestra decisiones previas. La CLI local permite preparar, verificar y consultar historial según la guía del
vigilante. La preparación es explícita y no se realiza al consultar. «Comprobar estado» es distinto de «Actualizar datos»:
no consulta fuentes ni despacha trabajos. La evaluación indica su hora, origen, áreas evaluadas e incidencias
persistidas; las fechas de cada fuente y del último intento conservan su significado. `eventosProgramados` lista
los últimos eventos diarios, del más reciente al más antiguo, con su instante, resultado y motivo. La ausencia de una incidencia
no certifica el producto completo, el pulso continuo no está instrumentado y no se observa la entrega servida.

Node lee la instalación local fuera de la transacción y vuelve a comprobar la sesión al guardar. Cloudflare solo
utiliza el último recibo admitido; sin recibo informa la ausencia de observación. Las decisiones y el historial no
se crean ni migran al consultar. Si falta política habilitada o preparación, la capacidad no está disponible. Una política inválida devuelve un aviso específico y no interrumpe el resto de la administración. Un
corte incompatible o una revisión de historial distinta se comunica como conflicto. Si se pierde la respuesta a una
comprobación, su resultado puede ser incierto y no se repite automáticamente.

## Trabajo de actualización

«Consultar o seguir trabajo» obtiene el último estado confirmado y habilita las solicitudes cuando no hay un trabajo
pendiente. «Buscar actualizaciones» solicita una ejecución; «Reintentar módulos pendientes» solicita el reintento de los
módulos que lo necesiten, que puede terminar sin pendientes. Cada solicitud vuelve a leer la revisión del trabajo antes
de enviarse, utiliza un identificador nuevo y bloquea envíos simultáneos desde la página. Esa revisión es independiente
de la de los controles de conectividad.

Una solicitud con respuesta perdida queda sin confirmar: la página exige consultar el estado antes de permitir otra.
No reenvía automáticamente. La consulta puede recuperar el trabajo que el servidor ya reservó. Si esta capacidad no está
configurada o falla, las solicitudes quedan bloqueadas; los controles de conectividad confirmados siguen disponibles.

El seguimiento visible alterna con la comprobación de sesión y se limita a doce consultas automáticas por trabajo o
gesto explícito de seguimiento. Después se puede continuar mediante «Consultar o seguir trabajo». No renueva la sesión
ni sigue consultando en una pestaña oculta. La pantalla distingue solicitud incierta, trabajo en curso y resultado final.
«Candidato validado» no acredita activación; «sin pendientes» tampoco acredita que todas las fuentes estén al día.

«Retirar solicitud» pide retirar la reserva mostrada; el servidor solo lo admite si todavía no tiene inicio confirmado.
No cancela una ejecución de GitHub. «Reconciliar estado consultado» consulta la ejecución conocida y registra su fin
si corresponde; no valida un candidato ni publica una versión. Ambas acciones requieren confirmación explícita y una
lectura fresca del mismo trabajo. Si entretanto aparece otra reserva, la acción se detiene para revisarla.
Ante una respuesta perdida se exige consultar el estado: no se repite automáticamente la operación.

El núcleo de mantenimiento dispone de un trabajo global durable, separado de los controles de
conectividad. Su adopción es explícita mediante `prepararTrabajos`; utiliza el mismo almacén
SQLite de la sesión sin reiniciar credenciales, cuotas o revocaciones. Reservar exige una sesión
vigente y la revisión leída. La reserva se confirma antes de enviar la petición al ejecutor GitHub;
solo una reserva nueva permite el envío. Repetir una petición no vuelve a ejecutar el trabajo.

La correlación utiliza el identificador de solicitud y la revisión de reserva asignada por el
servidor. El ejecutor recibe ambos y debe devolverlos sin cambiarlos. Una respuesta de una reserva
anterior se rechaza aunque reutilice el mismo identificador. Los pins OIDC se conservan con la
reserva. El receptor verifica la identidad firmada y el cuerpo completo antes de registrar un
recibo. Su autorización es independiente del acceso humano al panel y de las claves de consulta.

Una pérdida de respuesta deja el despacho incierto: no se reenvía. Una reserva nueva sin permiso de inicio
puede retirarse con sesión y revisión vigentes. Una ejecución conocida se reconcilia consultando su terminación
remota; ese cierre sin recibo nunca acredita un candidato. Cuando una actualización no termina, el Inicio dice por
qué en «Requiere atención», con la causa y el paso en palabras y el aviso de que la web sigue con los datos
publicados; un paso que el panel no sabe nombrar no se muestra. La causa llega en `ultimoFallo`, de una lista
cerrada ([el cierre sin recibo](actualizacion-remota.md#el-cierre-sin-recibo)). La misma consulta la hace el
servidor sin que nadie la pida cuando una petición de reserva (el botón de actualizar, la reserva a demanda o el evento
diario) encuentra abierto el último trabajo con su ejecución conocida: si GitHub la da por completada, la cierra igual
y después decide; si sigue en curso o no responde, la petición recibe «ocupado» y nada cambia
([sin esperar al botón](actualizacion-remota.md#sin-esperar-al-botón)). El evento diario, además, retira la reserva
vencida que nunca obtuvo permiso de inicio, como explica la
[programación diaria](actualizacion-remota.md#programación-diaria); lo vencido que no puede cerrarse queda pendiente
de una persona y su evento se registra con el motivo `requiere-atencion`.
El resultado del candidato tampoco acredita qué versión está activa. Las operaciones HTTP están montadas en
Node y Workers. Su [configuración privada](actualizacion-remota.md) permanece deshabilitada por
defecto. El aprovisionamiento local prepara una copia independiente de código y datos verificados.
El [workflow y la activación](actualizacion-remota.md) requieren configurar y comprobar el despliegue receptor.
El seguimiento y el desglose por fuente no sustituyen el cotejo de la versión servida. Un resultado correcto de
reconstrucción tampoco demuestra que se haya consultado una edición nueva de la fuente oficial.

### Origen del trabajo y registro de solicitudes

Cada trabajo reservado guarda su `origen`: `programada` (la tarea diaria), `panel` (una persona con sesión) o
`demanda` (un lanzamiento a demanda desde GitHub). Un trabajo reservado antes de existir este campo se sigue leyendo
sin él. La lista cerrada de acciones admite `actualizar-datos`, `reintentar-pendientes`, `comprobar-programada`,
`comprobar-vencidas` y `actualizar-cursos`; el panel solo puede pedir las dos primeras y la programada, la tercera.
El estado que recibe el panel añade `origen` y `iniciado`, que indica si el permiso de inicio se concedió; nunca
lleva quién lanzó un trabajo a demanda.

La autoridad conserva además un registro privado de solicitudes, en la misma transacción que el trabajo. Cada fila
guarda cuándo llegó la solicitud, su origen, la acción, la decisión (`admitida` o `rechazada`) con su motivo cerrado,
el run cuando se conoce y, al terminar, los minutos. El identificador y el nombre del actor solo se guardan cuando el
origen es `demanda`. La programada y el panel dejan su fila al reservar; una programada omitida la deja rechazada con
el motivo de la omisión (`ocupado`, `requiere_atencion`, `activacion_pendiente`, `candidato_en_plazo` o
`fuera_de_ventana`). Una reserva a demanda solo se crea si su fila admitida, con el actor, ya consta.

Los minutos miden desde el permiso de inicio hasta la llegada del recibo, redondeados hacia arriba al minuto. No
incluyen la cola ni la preparación del runner anteriores al permiso de inicio, ni el job de activación, así que son
una cota inferior de lo que factura GitHub. Un despacho rechazado por GitHub no creó ningún run y cuenta cero; un
trabajo sin inicio confirmado o sin recibo queda sin medida. El registro conserva todo el mes en curso, la última
solicitud admitida del mes anterior que no sea de la programada y, del resto, las 200 filas más recientes. El
historial del mes se lee en la forma que esperan los topes de la vía a demanda: la programada cuenta con acción
nula y reintentar lo pendiente cuenta como una actualización completa.

## Registro de activación

«Consultar activación registrada» muestra la última activación conservada por el servidor y la fecha de su último
cambio. Distingue reserva, preparación, subida, promoción, confirmación y rechazo. Una confirmación registrada
no acredita qué versión se sirve actualmente ni que todas las fuentes estén al día.

La lectura exige Access y sesión vigente antes y después de acceder al almacén; no renueva la sesión ni habilita
la activación. No prepara un almacén nuevo, solicita despliegues ni consulta servicios externos. Si la capacidad o
el registro no están disponibles, la pantalla lo indica. Un registro existente sin activaciones se distingue de una
lectura fallida. Las revisiones anteriores o contradictorias no sustituyen una observación más reciente.

Solo se devuelve la referencia de solicitud, fase, fechas, identificadores de versión/despliegue y un código de error
delimitado. El trabajo privado, sus identidades y la evidencia interna no se transmiten al navegador. Al cerrar o
sustituir la sesión se retira esta información de la página, sin guardarla en almacenamiento del navegador.

## Configuración de acceso

La administración está apagada por defecto. La entidad configura una aplicación de Cloudflare Access exclusiva para
`/administracion` y sus subrutas, con acceso por código de un solo uso al correo de las personas administradoras
permitidas. Esa audiencia debe ser distinta de la usada para proteger el recorrido público. No habilitar acceso anónimo
ni reutilizar credenciales de máquinas como identidad administrativa. Faro verifica el JWT firmado en cada operación,
además de la protección del alojamiento.

```dotenv
FARO_ADMINISTRACION=si
FARO_ADMIN_ORIGEN=https://faro.example.org
FARO_ADMIN_ACCESS_EQUIPO=equipo-de-la-entidad
FARO_ADMIN_ACCESS_AUD=<audiencia de la aplicación administrativa>
```

`FARO_ADMIN_ORIGEN` es el origen completo, sin barra final ni ruta. Nunca se obtiene de cabeceras reenviadas por el
cliente. El servidor local admite explícitamente HTTP en bucle local, por ejemplo `http://127.0.0.1:8787`; sigue
exigiendo un JWT administrativo válido. No incorpora un acceso de pruebas que eluda la identidad.

Es obligatorio `FARO_SECRETO_FIRMA`, secreto estable de al menos 32 caracteres generado aleatoriamente. Los secretos se proporcionan al servidor, nunca al navegador, a Git ni a un chat. Un cambio de secreto no
es un interruptor de disponibilidad: afecta a los tokens firmados y requiere una rotación planificada.

En Cloudflare se necesita el enlace privado del entorno (binding) `REGISTRO_SOCIOS`, de clase `AccesoPublicoDurable`, y
su migración SQLite. La [plantilla de Cloudflare](../config/cloudflare/README.md) describe su declaración y
enrutamiento. El Worker debe atender `/administracion` y todas sus subrutas antes que los recursos estáticos. El enlace
`ASSETS` debe entregar los archivos exactos de `web/administracion`, sin redirecciones de HTML ni sustituciones por una
portada genérica. Una publicación estática que eluda el Worker no es un despliegue administrativo válido. La
comprobación del despliegue receptor debe confirmar esta protección, el acceso a los recursos y el rechazo de peticiones
anónimas. En Node se utiliza `registro/acceso-publico/clientes.sqlite`, calculado desde la instalación. Se conservan en
el mismo almacén las instituciones invitadas, sus claves, cuotas y revocaciones, los accesos, la política administrativa
y la sesión activa. No se sustituye un almacén dañado por otro vacío ni por una copia en memoria.

## Administradores del Panel de Control

Cloudflare Access autentica a la persona y Faro decide si puede usar el panel. Faro guarda la lista de administradores
en el mismo almacén que la sesión única ([dominio](../src/administracion/administradores.ts),
[almacén](../src/plataforma/acceso-publico/administradores-sqlite.ts)). Cada petición del panel, después de verificar el
JWT de Access, comprueba que el correo verificado figura en la lista; si no figura, responde `403` con
`no_es_administrador` y el panel dice: «Tu correo no figura como administrador de este Panel de Control. Pide a un
administrador que te añada.». Si la lista no se puede leer, la petición se deniega.

Cada administrador está en uno de tres estados. «Pendiente» es quien se ha añadido y todavía no ha entrado; pasa a
«Activo» en su primera entrada verificada. «Retirada pendiente en Cloudflare» es quien Faro ya no deja entrar pero
Cloudflare Access todavía no ha confirmado que lo ha quitado. La lista guarda también quién añadió a cada persona y
cuándo, su última entrada y si esa entrada llegó con segundo factor.

Mientras la lista está vacía, basta con Access, como en una instalación nueva, y el apartado «Administradores» avisa de
que hay que añadirlos. La primera alta tiene que ser la de quien la hace, para que no se quede fuera en su siguiente
paso. Desde que la lista tiene una fila, no vuelve a quedar vacía: nunca se retira al último administrador activo,
tampoco a uno mismo si es el último. Añadir y retirar exigen además tener abierta la [sesión única](#sesión-única-y-operaciones);
leer la lista no. Cada alta y cada retirada quedan en el registro del panel con quién la hizo y a quién se refiere.

La instalación puede sembrar la lista con `FARO_ADMINISTRADORES_INICIALES`, una variable no secreta con hasta diez
correos distintos separados por comas. Los correos sembrados entran como «Pendiente» y solo se aplican a una lista que
nunca ha tenido filas; después, la lista se gobierna desde el panel. Un valor ilegible, con repetidos o con más de diez
correos detiene el panel al arrancar en vez de corregirse.

### Sincronización con Cloudflare Access

Con la sincronización configurada, añadir un correo en el panel lo añade al grupo de Access de los administradores y
retirarlo lo quita y cierra sus sesiones de Access ([cliente](../src/administracion/grupo-access.ts)). Faro solo toca ese
grupo: lo lee, sustituye sus reglas de correo por la lista completa de Faro y conserva su nombre y cualquier regla que no
sea de correo (`PUT /accounts/{cuenta}/access/groups/{grupo}`). Al retirar, además, pide
`POST /accounts/{cuenta}/access/organizations/revoke_user` con el correo.

Añadir va primero a Cloudflare: solo si Cloudflare confirma, el correo entra en la lista de Faro. Si Cloudflare no
responde, no se añade, se anota en el registro y el panel dice que se puede volver a intentar. Retirar va primero a Faro,
que deja de autorizar al momento, y después a Cloudflare. Si Cloudflare falla, la persona queda como «Retirada pendiente
en Cloudflare», el apartado lo marca como «Requiere atención» y su fila ofrece «Reintentar». Cada llamada tiene un plazo
propio de 1,5 segundos y no se repite sola.

| Variable | Tipo | Valor |
| --- | --- | --- |
| `FARO_ADMIN_ACCESS_CUENTA` | Variable | Identificador de la cuenta de Cloudflare (32 cifras hexadecimales), el mismo que `CLOUDFLARE_ACCOUNT_ID`. |
| `FARO_ADMIN_ACCESS_GRUPO` | Variable | Identificador (UUID) del grupo de Access «Faro · Administradores». |
| `FARO_ADMIN_ACCESS_TOKEN` | Secreto del Worker | Token de la API con un único permiso: «Access: Organizations, Identity Providers, and Groups Write». |

Sin alguna de las tres, el apartado funciona como lista de Faro y dice qué variable falta: las altas y retiradas no
llegan a Cloudflare. Una variable presente pero mal escrita detiene el panel al arrancar.

### Segundo factor

Cloudflare Access ofrece «MFA independiente»: apps de autenticación con códigos (TOTP), llaves de seguridad y
biometría. Se activa en la organización y se exige por aplicación o por política; quien entra por primera vez registra su
autenticador. Faro lo comprueba también cuando `FARO_ADMIN_EXIGIR_MFA=si`: la guardia exige que el JWT verificado declare
en `amr` un método de segundo factor (`mfa`, `otp`, `hwk`, `swk`, `fpt`, `face` o `iris`) y, si no, responde `403` con
`segundo_factor_requerido` y el panel explica que hay que registrar el segundo factor. El valor por defecto es `no`, para
no dejar fuera a nadie antes de activar el MFA en Cloudflare.

### Pasos en Cloudflare al instalar

1. En Zero Trust, Access, grupos, crea el grupo «Faro · Administradores» con una regla de correo para quien instala.
2. En la aplicación administrativa de `/administracion`, deja una política «Allow» que incluya ese grupo. Si las
   instituciones deben entrar además solo desde sus dominios, añade a la política la condición de dominio de correo
   correspondiente; Faro conserva esas reglas.
3. Crea un token de la API de la cuenta con el permiso «Access: Organizations, Identity Providers, and Groups Write» y
   nada más. Guárdalo como secreto del Worker `FARO_ADMIN_ACCESS_TOKEN`.
4. Pon en las variables del Worker `FARO_ADMIN_ACCESS_CUENTA`, `FARO_ADMIN_ACCESS_GRUPO` y, si se quiere sembrar,
   `FARO_ADMINISTRADORES_INICIALES`.
5. Activa el MFA independiente en la organización y exígelo en la aplicación administrativa. Cuando todos los
   administradores lo hayan registrado, pon `FARO_ADMIN_EXIGIR_MFA=si`.

### Rutas

Todas son `POST` bajo `/administracion/api/administradores/`, con las mismas comprobaciones de origen y tipo que el
resto del panel. `leer` solo exige estar autorizado; `anadir`, `retirar` y `reintentar` reciben `{ "correo": "…" }` y
exigen el token de la sesión única de quien pide. La lectura y cada cambio correcto devuelven
`{ administradores, maximo, sincronizacion }`, y la retirada y el reintento con Access añaden `cloudflare` (`correcta`
o `fallida`).

| Error | Estado | Cuándo |
| --- | --- | --- |
| `no_es_administrador` | 403 | El correo verificado no figura en una lista que ya tiene filas. |
| `segundo_factor_requerido` | 403 | Se exige segundo factor y el JWT no lo declara. |
| `sesion_inactiva` | 403 | Un cambio sin la sesión única abierta por quien pide. |
| `correo_no_verificado` | 403 | Access no ha entregado un correo verificado. |
| `correo_no_valido` | 400 | El correo no tiene una forma válida. |
| `administrador_duplicado`, `lista_llena`, `alta_propia_primero`, `ultimo_activo` | 409 | La regla de la lista no lo permite. |
| `administrador_no_encontrado` | 404 | El correo no está en la lista, o no espera a Cloudflare al reintentar. |
| `cloudflare_no_disponible` | 502 | Cloudflare no ha confirmado un alta; no se ha añadido. |
| `cloudflare_sin_configurar` | 409 | Reintentar sin la sincronización configurada. |

## Autoridad de los controles

Al preparar una instalación nueva se adopta la configuración inicial de servicios y permisos. Si ya hay una política
válida, reiniciar conserva su revisión, sus valores y la sesión activa. Después, los cambios se realizan mediante la
operación administrativa autenticada; editar los interruptores iniciales del entorno no sobrescribe esa política.
Cada petición consulta una captura de la política vigente sin reconstruir el servicio ni reiniciar sus contadores.

| Control | Efecto |
| --- | --- |
| API deshabilitada | Cierra las consultas REST para aplicaciones; conserva sus credenciales. |
| API habilitada | Atiende claves institucionales vigentes y permite activar invitaciones válidas. |
| MCP / A2A | Habilita o deshabilita cada protocolo y su descubrimiento. |

Apagar la API institucional retira sus rutas OAuth, consultas y activación pública sin borrar instituciones,
claves ni revocaciones. MCP y A2A son independientes y no requieren esas claves. Crear o retirar invitaciones
exige siempre la sesión del panel; una clave de lectura no autoriza administrar Faro.

La conectividad factual no habilita inferencia externa. Un requisito de Access configurado
para el despliegue conserva su protección general y no sustituye la identidad administrativa.

Si no se puede leer el estado administrativo, los canales controlados quedan indisponibles; las consultas
deterministas del recorrido conservan su funcionamiento. Una configuración básica de acceso inválida se rechaza,
sin convertirla en acceso abierto. El catálogo de servicios utiliza `no-store` y refleja la política vigente.

## Sesión única y operaciones

Todos los puntos de acceso bajo `/administracion/api/` usan POST y JSON. Exigen un origen idéntico al configurado,
`X-Faro-Panel: 1` y la identidad administrativa. Excepto la bienvenida, la apertura y el registro, requieren además
`X-Faro-Sesion`.
Las lecturas de cuerpo tienen un plazo de cinco segundos y un máximo de 4 KiB.
Los límites de la API pública no cambian.

| Ruta relativa | Cuerpo | Operación |
| --- | --- | --- |
| `sesion/bienvenida` | `{}` | Anota la entrada (una por sesión de Access) y dice si el panel está libre, abierto por otra persona o por ti; en ese caso, con los identificadores de tu sesión y de tu entrada. |
| `sesion/abrir` | `{}` o `{retomar}` | Crea un token aleatorio si nadie más tiene la sesión única; con `retomar: true`, la misma persona sustituye la suya de otro dispositivo. Ocupada: `409 panel_ocupado`. |
| `sesion/registro` | `{}` | Devuelve las 100 filas más recientes del registro de accesos (90 días, como mucho 2.000 filas). |
| `sesion/estado` | `{}` | Comprueba la sesión sin prolongar su actividad. |
| `sesion/actividad` | `{}` | Renueva la actividad de una sesión vigente. |
| `sesion/cerrar` | `{}` | Cierra la sesión presentada. |
| `controles/leer` | `{}` | Devuelve controles y revisión. |
| `controles/cambiar` | `{revisionEsperada, politica}` | Cambia la política si coinciden sesión y revisión. |
| `secciones/leer` | `{}` | Consulta las nueve claves de disponibilidad v2 y su revisión compartida; dos son legadas y no tienen interruptor propio. |
| `secciones/cambiar` | `{revisionEsperada, secciones}` | Cambia solo las secciones con sesión y revisión vigentes. |
| `datos/estado` | `{}` | Consulta el estado de la instalación de mantenimiento, si tiene lector. |
| `datos/comprobar-estado` | `{}` | Evalúa y registra un corte del vigilante sin actualizar ni publicar. |
| `datos/vigilante/historial` | `{}` o `{limite, despuesDe, revisionEsperada}` | Lee una página con revisión; máximo 50 filas. |
| `datos/vigilante/preparar` | `{}` | Preparación operativa explícita en Cloudflare, con política del servidor y sesión vigente. |
| `datos/trabajo` | `{}` | Consulta el último trabajo y su revisión, sin renovar actividad. |
| `datos/activacion` | `{}` | Lee el registro de activación existente; no coteja la versión servida ni activa efectos. |
| `datos/actualizar` | `{solicitudId, accion, revisionEsperada}` | Reserva y solicita una ejecución; no confirma que esté activa. |
| `datos/retirar` | `{solicitudId, revisionReserva, revisionEsperada}` | Retira con CAS una reserva sin inicio confirmado; no cancela trabajos iniciados. |
| `datos/reconciliar` | `{solicitudId, revisionReserva}` | Comprueba la ejecución remota conocida; no activa ni valida datos por su estado en GitHub. |
| `avisos/leer` | `{}` | Devuelve el destino de los avisos con la dirección completa (es la única respuesta que la lleva) y, en `avisos`, el estado de cada canal y de las comprobaciones automáticas, sin la dirección. Solo lee. |
| `avisos/cambiar` | `{revisionEsperada, correo}` | Guarda una dirección nueva, pendiente de confirmar, si coinciden sesión y revisión. |
| `avisos/quitar` | `{revisionEsperada}` | Deja los avisos sin dirección si coinciden sesión y revisión. |
| `avisos/probar` | `{}` | Envía un aviso de prueba por correo a la dirección guardada, como mucho uno cada diez minutos; si el enlace lo acepta, la deja `verificado`. Responde si ha salido, sin la dirección. |

La proyección de controles tiene `version: 2`, `api`, `mcp`, `a2a` y `revision`. Los valores de `api` son
`deshabilitada` y `habilitada`; los otros dos controles son booleanos. El cambio se confirma en una transacción:
una revisión antigua devuelve conflicto y no sobrescribe otro cambio.

El documento privado conserva también las secciones y tiene versión 4. Leer un formato conservado no escribe
ni rejuvenece su registro. La siguiente operación válida conserva las secciones y adopta el formato actual.
Los contratos de controles, secciones y almacenamiento tienen versiones independientes. Un documento
incompleto o corrupto se rechaza; nunca se sustituye por valores que abran servicios.

Una nueva apertura invalida inmediatamente los permisos de la sesión anterior, incluso para la misma identidad en
otra pestaña. El servidor responde `409` con `sesion_sustituida`; el cliente debe retirar sus controles y mostrar
«Tu sesión se ha cerrado porque el panel se ha abierto en otro lugar». No debe reabrir automáticamente la sesión.
La sesión caduca tras 15 minutos sin actividad o, como máximo, ocho horas desde su apertura. El token se conserva
solo en la memoria de la página y el servidor guarda su huella, no el valor original. Las respuestas son `no-store`.

Las pruebas del producto verifican los adaptadores con HTTP, SQLite y JWT firmados de prueba. No sustituyen la
comprobación de las cuentas, la política real de Access, los enlaces del entorno y el dominio del despliegue receptor.


## Destino de los avisos

Los avisos de mantenimiento se envían a una sola dirección de correo, que se guarda en la autoridad administrativa y
se cambia desde el panel; así, la entidad que se haga cargo del servicio puede poner la suya sin tocar el código ni el
entorno. La dirección es un dato personal: no figura en el código, la configuración, las capacidades del panel, los
recibos, los diarios, el estado del vigilante, el cuerpo de los avisos ni los registros de la consola. Solo la
devuelve `avisos/leer`, dentro de la sesión administrativa, y la lectura interna del envío.

Se admite una dirección de 254 caracteres como máximo, con una sola arroba, parte local y dominio no vacíos y un
dominio con al menos un punto y sin etiquetas vacías. No se admiten espacios, saltos de línea ni otros caracteres de
control, comas, punto y coma ni los signos `<` y `>`: nadie puede añadir cabeceras ni más destinatarios. El dominio
se guarda en minúsculas y la parte local tal como se escribe. Una dirección rechazada responde `400` con
`correo_invalido` y no cambia nada.

| Campo | Significado |
| --- | --- |
| `version` | Versión del documento: `1`. |
| `correo` | La dirección, o `null` si no hay ninguna. Solo aparece en `avisos/leer`. |
| `revision` | Sube con cada cambio; `0` mientras nadie lo ha cambiado. |
| `cambiadoEn` | Milisegundos desde 1970 del último cambio, o `null` con la revisión `0`. |
| `verificacion` | `sin_destino`, `pendiente` (la persona que la recibe aún no la ha confirmado) o `verificado`. |

`avisos/cambiar` y `avisos/quitar` responden con `estado` (`cambiado` o `conflicto`, este con `409`), la sesión y
el mismo documento sin `correo`. Toda dirección guardada queda `pendiente`, también si repite la anterior. Una
revisión antigua no sobrescribe el cambio de otra pestaña. Sin el almacén de avisos montado, las rutas responden
`503` con `no_disponible` a una sesión activa.

En Cloudflare, el destino vive en la tabla `administracion_avisos_destino` del Durable Object con SQLite: una sola
fila (`id = 1`) con `version`, `correo`, `revision`, `cambiado_en` y `verificacion`, y restricciones que impiden una
fila incoherente, por ejemplo una dirección con el estado `sin_destino`. La tabla no existe hasta el primer cambio,
que la crea en su misma transacción; mientras tanto, la lectura es el destino inicial sin dirección. La sesión y la
revisión se comprueban en la transacción de cada lectura o cambio. Las rutas tienen su propio enrutador
(`src/administracion/avisos-http.ts`), con la misma frontera que las demás. El servidor Node local no las ofrece: su
vigilante nunca envía avisos, y responden `503`.

### Envío por correo

El evento diario envía el aviso por el enlace `send_email` (`AVISOS_CORREO`) a esta dirección, solo si está
`verificado`; sin dirección o pendiente de confirmar, el correo no se intenta y no deja ningún intento en el registro.
`send` recibe un objeto plano con cuatro campos y nada más: `to` (la dirección), `from` (`FARO_AVISO_REMITENTE`, del
dominio del servicio), `subject` y `text`. Lo prepara `src/administracion/mensaje-aviso-correo.ts`: asunto fijo («Faro:
la actualización necesita atención» o «Faro: la actualización vuelve a estar bien»), y en el texto la fecha de la
comprobación, una frase por incidencia con los mismos textos del panel y el enlace al panel. Aunque las cabeceras las
compone el enlace, los campos que acaban en una se validan antes: `to` y `from` con la validación de arriba y, además,
en ASCII; `subject`, sin saltos de línea ni otros caracteres de control. Un fallo del enlace no detiene el evento:
queda como último intento del canal de correo, con su motivo cerrado y sin la dirección, y se reintenta en el
siguiente. Con `FARO_AVISO_URL` también configurada, los dos canales comparten el registro de lo avisado: el correo va
primero, cada canal guarda su propio intento y basta con que uno lo entregue para no repetirlo.

Una dirección pasa a `verificado` por evidencia, nunca por declaración: cuando el enlace acepta un aviso de prueba
enviado a esa dirección con esa revisión. Cloudflare solo entrega a destinos verificados en la cuenta, así que la
aceptación lo demuestra. La autoridad lo anota en la ruta privada `/avisos/verificar-sesion`, con la sesión, la
revisión vista y la dirección: si cualquiera de las dos ha cambiado mientras salía la prueba, responde conflicto y
nada cambia. La verificación no sube la revisión. Guardar cualquier dirección la devuelve a `pendiente`.

`avisos/probar` envía un mensaje de prueba por el mismo canal, también a una dirección pendiente, porque es lo que la
confirma. Responde `{estado:'activa', sesion, prueba, destino}`: `destino` es el resumen tras la prueba, sin la
dirección, y `prueba.resultado` es `enviado`, `fallido` o `no-enviado`. Los motivos de `fallido` son cerrados y salen
de la propiedad `code` del error del enlace; el texto del error no se copia nunca, porque puede llevar la dirección:

| Motivo | Códigos del enlace | Qué hacer |
| --- | --- | --- |
| `remitente-no-configurado` | `E_SENDER_NOT_VERIFIED`, `E_SENDER_DOMAIN_NOT_AVAILABLE`, `E_SENDER_DOMAIN_NOT_CONFIGURED`, `E_EMAIL_SENDING_NOT_READY`, `E_ACCOUNT_SUSPENDED` | Revisar el dominio remitente y la cuenta de Cloudflare. |
| `destinatario-no-permitido` | `E_RECIPIENT_NOT_ALLOWED`, `E_RECIPIENT_PLAN_RESTRICTED`, `E_RECIPIENT_SUPPRESSED` | Dar de alta y verificar la dirección en la cuenta. |
| `limite-alcanzado` | `E_RATE_LIMIT_EXCEEDED`, `E_DAILY_LIMIT_EXCEEDED` | Esperar y volver a probar. |
| `rechazo-del-destino` | `E_DELIVERY_FAILED` | Revisar el buzón de destino. |
| `error-temporal` | `E_INTERNAL_SERVER_ERROR` | Volver a probar más tarde. |
| `plazo-agotado` | (el enlace no responde a tiempo) | Volver a probar más tarde. |
| `envio-rechazado` | cualquier otro código, también `E_VALIDATION_ERROR`, o un error sin código | Revisar la configuración. |

Los de `no-enviado` son `sin-destino`, `destino-no-admitido`, `canal-no-configurado` y `limite-de-pruebas`. Una prueba
que no sale deja el destino como estaba. El límite es de una prueba cada diez minutos por instancia del Worker. En el
Worker sin enlace o sin remitente, la prueba responde `no-enviado` con `canal-no-configurado`; donde las rutas no
tienen prueba montada (el servidor Node), `503` con `no_disponible`.

`AVISOS_CORREO` se lee con `enlaceCorreoDelEntorno` (`src/administracion/envio-aviso-correo.ts`), que solo comprueba
que es un enlace con `send` y no depende de Cloudflare: lo usan el Worker al montar el canal y el objeto durable al
decir en qué estado está. Sin enlace no hay canal de correo.

### Estado de cada canal

El estado de los avisos dice, por canal, `{canal, estado, ultimoIntento}`, con el correo antes que la URL. Ningún
campo lleva la dirección. Lo calcula el objeto durable, que comparte el entorno del Worker y lee la verificación en su
propia autoridad.

| Canal | Estados | Motivos de un intento fallido |
| --- | --- | --- |
| `correo` | `no-configurado` (sin enlace o sin remitente), `remitente-no-admitido` (el remitente no es del dominio del servicio), `sin-destino`, `pendiente`, `verificado` | los de la tabla de arriba y `destino-no-admitido` (la dirección guardada no cabe en el mensaje) |
| `url` | `no-configurados`, `configurados`, `destino-no-admitido` | `respuesta-no-admitida`, `sin-respuesta`, `plazo-agotado`, `destino-no-admitido` |

`ultimoIntento` es `{en, resultado, motivo}` (`enviado` con `motivo: null`, o `fallido` con su motivo) o `null`. Cada
canal guarda su intento en `administracion_vigilante_aviso_canal`, una fila por canal; lo ya avisado sigue en una sola
fila compartida. Se ve en dos sitios:

- En la comprobación del vigilante, `avisos` es `{canales}` y solo trae los canales que dicen algo (configurados o con
  algún intento). Si ninguno lo hace, no viaja. Un estado con la forma anterior, `{estado, ultimoIntento}`, se lee
  como el canal `url`, que era el único; se decide por la presencia de `canales`, sin número de versión.
- En `avisos/leer`, `avisos` es `{comprobaciones, canales}` y trae siempre los dos canales. `comprobaciones` es
  `desactivadas` si el vigilante no está habilitado, porque entonces el evento diario no evalúa ni avisa; con su
  configuración no válida cuenta como `activas`, porque avisa de eso mismo. Esta lectura no evalúa el vigilante ni
  anota ninguna decisión.

Con el correo como único canal, un inicio de actualización rechazado también se avisa en el momento, con la misma
memoria de lo ya avisado que el evento diario.

### La tarjeta «Avisos»

En el apartado Avisos, el usuario ve la tarjeta «Avisos» nada más abrir la sesión, sin pulsar nada: su lectura espera
a que terminen las lecturas de la apertura en lugar de darse por fallida. La tarjeta solo lee:

- Dice a dónde llegan los avisos, con la dirección oculta en parte (por ejemplo, `p•••@example.org`), o que todavía no
  hay ninguna, o que está pendiente de confirmar.
- Si el último aviso por correo no se pudo entregar, dice cuándo y, en una frase, qué ha pasado y qué hacer.
- Avisa si el correo no puede salir en esta instalación o si las comprobaciones automáticas están desactivadas (en ese
  caso no saldrá ningún aviso, aunque la dirección se pueda guardar igualmente).

Puede hacer tres cosas:

- **Guardar** una dirección nueva. Antes, el panel le pide que confirme la dirección completa. La dirección queda
  pendiente de confirmar.
- **Enviar un aviso de prueba.** Si llega, la dirección queda confirmada y desde ese momento salen los avisos. Si no,
  la tarjeta dice por qué en una frase, sin códigos.
- **Quitar** la dirección, también con confirmación.

Si otra persona ha cambiado la dirección mientras tanto, la tarjeta lo dice y enseña la nueva. Mientras una petición
está en curso, los botones se desactivan para no enviarla dos veces. La dirección completa solo está en el campo
mientras la sesión sigue abierta: no se guarda en el navegador, ni en la dirección de la página, ni en la consola.

## Instituciones y accesos

**Instituciones** presenta nombre, correo administrativo opcional, estado, última conexión y consultas.
El [procedimiento de invitación](conectividad.md) explica entrega, activación y relevo. La institución o cada
sistema tiene identidad propia. Un enlace vence a los siete días y solo puede consumirse una vez. Faro conserva
huellas de los secretos; no permite recuperarlos. Durante el relevo pueden coexistir dos claves; retirarlas
revoca también el uso de los tokens que dependían de ellas.

Las operaciones del panel comparten su protección de identidad, origen, sesión y revisión. Una respuesta
perdida no causa reintento automático de una mutación. Una nueva consulta confirma el estado antes de continuar.
Ni el correo opcional ni las claves se incorporan al paquete público.

**Accesos** muestra fecha y hora, institución, consulta y resultado de la API, con paginación de 50 filas.
MCP y A2A ofrecen recuentos diarios por herramienta o habilidad. El nombre de cliente MCP se presenta como
declarado; no acredita la identidad del asistente. Un fallo del registro no se presenta como «sin accesos».

La política única está en [`LIMITES_CONECTIVIDAD`](../src/administracion/instituciones.ts): 100 instituciones,
dos claves activas por institución, 1.000 consultas por institución y hora, 10.000 consultas globales por hora,
20 tokens por institución y hora y 1.000 peticiones globales de credenciales por hora, que solo gastan las credenciales
o invitaciones vigentes. Se conservan como máximo
10.000 filas operativas durante 30 días; MCP admite 64 nombres declarados distintos al día y agrupa los demás.
No se guardan IP, cabeceras, argumentos, contenido de las consultas ni secretos en ese registro.

Node usa SQLite transaccional; Cloudflare usa un Durable Object con SQLite. Ambos montajes comparten los contratos
y las reglas de retención. El almacén dañado falla de forma explícita: no se sustituye por memoria ni por otro vacío.
Para trasladar o respaldar una instalación se necesita una imagen SQLite consistente y privada, nunca una copia
parcial durante una escritura. La construcción local comprueba los adaptadores; el alojamiento receptor requiere
comprobar Access, enlaces del entorno, secretos y funcionamiento antes de activarlos.

El selector protegido de modo de recorrido pertenece al Worker unificado principal: el panel lo ofrece solo cuando
`/capacidades-panel.json` declara `recorrido: true`. El Worker privado de ensayo y el servidor Node local declaran
`recorrido: false`; en ellos no se consulta ni se cambia ese selector desde el panel. La ausencia del campo se interpreta
como capacidad no disponible. Esta declaración identifica la función montada, no garantiza que su autoridad esté
operativa. El servidor Node local usa HTTP y no reproduce la puerta HTTPS de la variante inactiva del Worker.
