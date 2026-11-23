# Configuración de la instalación

Este índice reúne los puntos de configuración existentes. La entidad aporta sus cuentas, dominio,
servicios, límites y secretos; los esquemas, valores admitidos y procedimientos permanecen en las
guías enlazadas. Una plantilla no acredita una instalación operativa ni una comprobación del alojamiento.

## Dónde se configura

| Vía | Uso y fuente |
| --- | --- |
| Node local | [`.dev.vars.example`](../.dev.vars.example) es la plantilla opcional de `.dev.vars`; `FARO_PERFIL` selecciona `.dev.vars.<nombre>` desde la raíz del producto. [Operación local](operacion-local.md). |
| Worker | La entidad mantiene cuenta, dominio, variables y secretos en el alojamiento. Los nombres de los Workers, migraciones y dominio están en los archivos de `config/cloudflare/instalaciones/` y se publican con la [orden de despliegue](../config/cloudflare/README.md#desplegar). En el Worker principal de producción, esa orden pone además, con `--privadas <archivo>`, una lista cerrada: las variables `FARO_ADMIN_ACCESS_CUENTA`, `FARO_ADMIN_ACCESS_GRUPO`, `FARO_ADMINISTRADORES_INICIALES`, `FARO_ADMIN_EXIGIR_MFA` y `FARO_ACTUALIZACION_DEMANDA`, y el secreto `FARO_ADMIN_ACCESS_TOKEN`. El archivo es privado (`0600`, del usuario, sin enlaces), con la forma `{"version":1,"variables":{…},"secretos":{…}}`; cada valor se valida como en el Worker antes de llamar a Wrangler, y el secreto viaja solo en un archivo temporal de `--secrets-file`. Hay un ejemplo sin valores reales en [Desplegar](../config/cloudflare/README.md#desplegar). |
| Mantenimiento remoto | Servidor y repositorio de GitHub tienen configuraciones distintas; el workflow aporta además la identidad de cada intento. [Actualización y recuperación](actualizacion-remota.md). |

En Node, `FARO_PERFIL` selecciona el perfil privado del servicio. El servidor admite solo su lista
explícita de opciones del proceso, y el perfil prevalece cuando contiene la misma opción. No asumir
que exportar cualquier variable sobrescribe el perfil. Los lectores son
[`servidor-local.ts`](../herramientas/servidor/servidor-local.ts) y
[`entorno.ts`](../src/plataforma/node/entorno.ts).

Los perfiles privados, las claves y las configuraciones de cuenta quedan fuera de Git y de `web/`.
Los secretos de la instalación se entregan por su mecanismo privado; no se copian a las plantillas
ni a una página pública. Los motores locales no necesitan claves de proveedores de inferencia.

## Servicio, web y acceso

| Grupo | Variables | Dónde configurar | Lector y guía |
| --- | --- | --- | --- |
| Arranque local | `FARO_PUERTO`, `FARO_PERFIL` | Proceso Node; perfil privado seleccionado para las opciones del servicio | [Servidor local](../herramientas/servidor/servidor-local.ts), [lector de perfiles](../src/plataforma/node/entorno.ts); [operación local](operacion-local.md). |
| Servicios | `FARO_MCP`, `FARO_A2A`, `FARO_API_SOCIOS` | Semillas de una instalación nueva; apagadas por defecto | [Configuración común](../src/plataforma/configuracion.ts); [conectividad](conectividad.md). Activar un canal exige administración y almacén persistente. La política del panel es la autoridad. |
| Plazo de petición | `FARO_PLAZO_PETICION_S` | Proceso Node, perfil privado o variables del Worker; segundos enteros de 1 o más, con 50 segundos por defecto si falta o está vacía | [Lector del plazo](../src/api/plazo.ts). Por ejemplo, `60` fija un minuto. El valor debe poder convertirse a milisegundos como entero seguro; una configuración no válida se rechaza. |
| Cuotas de conectividad | `LIMITES_CONECTIVIDAD` | Política acotada del producto, no una variable del despliegue | [Contrato de instituciones](../src/administracion/instituciones.ts); [cuotas y conservación](administracion.md#instituciones-y-accesos). |
| Administración | `FARO_ADMINISTRACION`, `FARO_ADMIN_ORIGEN`, `FARO_ADMIN_ACCESS_EQUIPO`, `FARO_ADMIN_ACCESS_AUD`, `FARO_ADMINISTRADORES_INICIALES`, `FARO_ADMIN_EXIGIR_MFA`, `FARO_ADMIN_ACCESS_CUENTA`, `FARO_ADMIN_ACCESS_GRUPO` y el secreto `FARO_ADMIN_ACCESS_TOKEN` (lista de administradores, segundo factor y sincronización con el grupo de Access: [administradores](administracion.md#administradores-del-panel-de-control)) | Servidor y aplicación administrativa de Cloudflare Access, con administradores autorizados | [Configuración administrativa](../src/administracion/configuracion.ts), [Access administrativo](../src/plataforma/acceso-administrativo.ts); [administración](administracion.md). Necesita además firma estable, cuotas y almacenamiento. |
| Access del servicio | `FARO_ACCESS_DECLARACION`, `FARO_ACCESS_EQUIPO`, `FARO_ACCESS_AUD` | Aplicación de Access del servicio; audiencia distinta de la administrativa | [Cerrojo del servicio](../src/plataforma/cloudflare/cerrojo-access.ts). Solo con `FARO_ACCESS_DECLARACION=pruebas-con-relatos-ficticios` la API exige Access y lee equipo y audiencia; ausente o `si`, no hay cerrojo. Otro valor deja la API en 503. No sustituye Access administrativo ni activa inferencia. |
| Orígenes admitidos | `FARO_ORIGENES` | Orígenes web autorizados por el servicio | [Worker](../src/plataforma/cloudflare/worker.ts); [controles de seguridad](../src/seguridad/README.md). CORS no sustituye la autenticación. |
| Información del servicio | `FARO_FORMACION_ABIERTA`, `FARO_CITILAB_PAGO`, `FARO_CAMINO_A_MANO` | Configuración del despliegue | [Configuración común](../src/plataforma/configuracion.ts); [criterio de formación abierta](criterio-formacion-abierta.md). Modifican opciones o información servida; no son credenciales. |
| Contacto de seguridad | `FARO_SEGURIDAD_CONTACTO`, `FARO_SEGURIDAD_POLITICA`, `FARO_SEGURIDAD_CADUCA` | Configuración de la entidad | [Lector de security.txt](../src/plataforma/seguridad-txt.ts); [operación local](operacion-local.md#contacto-de-seguridad), [SECURITY.md](../SECURITY.md). |

Con administración habilitada, reiniciar o editar los interruptores iniciales no sobrescribe la
política ni las secciones ya adoptadas en el almacén. Los cambios de esos
controles se realizan mediante las operaciones autenticadas del [panel](administracion.md).
Access de administradores, credenciales OAuth de consulta y autorización OIDC del workflow son
identidades distintas.

## Motores locales y límites del servicio

El recorrido utiliza los motores locales. No se configuran proveedores externos de inferencia ni
permisos para habilitarlos. Las consultas factuales conservan sus cuotas, firmas y controles de acceso.
Los [plazos de petición](../src/api/plazo.ts) y los [límites de lectura por red](../src/seguridad/limitador.ts)
protegen el servicio. Las [instituciones](administracion.md#instituciones-y-accesos) tienen cuotas de consultas y credenciales; las invitaciones no conceden acceso administrativo.

## Secretos y firmas

Rotar un secreto de firma afecta a los tokens que lo utilizan y requiere una rotación planificada.
No restablecer credenciales, cuotas, revocaciones ni otros registros durables para adoptar una plantilla.
Producción y ensayo tienen valores independientes: no se copian de un Worker a otro ni se leen del alojamiento para
preparar otro entorno. Los valores no van en argumentos, archivos de configuración, salidas de órdenes ni el
repositorio.

| Grupo | Nombres | Dónde configurar | Lector y guía |
| --- | --- | --- | --- |
| Firma del servicio | `FARO_SECRETO_FIRMA`, `FARO_SECRETO_FIRMA_ANTERIOR` | Mecanismo privado de secretos del servidor; la anterior se conserva durante una rotación planificada | [Configuración](../src/plataforma/configuracion.ts), [firma](../src/seguridad/firma.ts); [administración](administracion.md), [seguridad](../src/seguridad/README.md). Al menos 32 bytes UTF-8 (32 caracteres con administración); sin ella, la API responde 503. No reutilizar como maestra de cifrado. |
| Portal de la entrega oficial | `FARO_CLAVE_GENERAL`, `FARO_SESION_PORTAL`, `FARO_LIMITE_PORTAL` | Worker principal de una entrega oficial; se exigen los tres juntos | [Acceso al portal](../src/plataforma/cloudflare/acceso-portal.ts). Contraseña general de 1 a 256 caracteres. Firma de la cookie y clave del límite de intentos de al menos 32 bytes UTF-8. Los tres son distintos entre sí. Sin ellos no se abre el portal (503); la portada, `robots.txt` y los canales de máquina no los usan. `POST /avisos-del-navegador` se admite sin sesión, pero sigue respondiendo 503 sin ellos. |
| Variante de recorrido | `FARO_RECORRIDO_CLAVE`, `FARO_RECORRIDO_FIRMA`, `FARO_RECORRIDO_LIMITE` | Worker principal, en las entregas oficial y privada | [Acceso al recorrido](../src/plataforma/cloudflare/acceso-recorrido.ts), [límite](../src/plataforma/cloudflare/limite-recorrido.ts). Contraseña de 12 a 256 caracteres para la variante que no está activa. Firma y clave de límite de al menos 32 bytes UTF-8, distintas entre sí y de la contraseña. Solo se piden al abrir esa variante. |
| Entrega privada de ensayo | `FARO_PRUEBAS_CLAVE` y `FARO_PRUEBAS_LIMITE` (secretos), `FARO_PRUEBAS_ADMINISTRACION` (variable) | Solo el Worker principal de una entrega privada | [Acceso privado](../src/plataforma/cloudflare/acceso-privado.ts), [límite de intentos](../src/plataforma/acceso-publico/limite-continuo-sqlite.ts). La contraseña compartida y la clave del límite, de al menos 32 bytes UTF-8 cada una y distintas entre sí; si falta alguna, es más corta o coinciden, todo responde 503. La clave del límite no se entrega a los probadores. Se entra por HTTP Basic con el usuario `Faro`. Sin credencial responde 401 sin gastar intentos; solo `POST /avisos-del-navegador` se admite sin ella, sin gastar intentos ni montar la administración. Cada credencial errónea gasta un intento de su IP (en IPv6, de su red /64): con 10 en 15 minutos, la IP queda bloqueada con 429, también para la clave correcta, hasta que caducan. La clave correcta no gasta intentos ni escribe nada: solo se comprueba que su IP no esté bloqueada. La IP no se guarda, solo un HMAC con la clave del límite (ver [intentos y sesiones](#intentos-y-sesiones-guardados)). La validación de credenciales requiere `REGISTRO_SOCIOS` y la cabecera `cf-connecting-ip` que fija Cloudflare; sin ellos, 503. Con `FARO_PRUEBAS_ADMINISTRACION=si`, el panel exige la misma configuración administrativa. Esta entrada fija MCP, A2A y API institucional en `no`. |
| Firma de respuestas MCP | `FARO_FIRMA_MCP_CLAVES` | Secreto que contiene también claves privadas | [Lector de claves](../src/api/mcp/firma-de-respuesta.ts); [firmas MCP](mcp.md#límites). No es un manifiesto de huellas ni una clave OAuth. |

### Intentos y sesiones guardados

`REGISTRO_SOCIOS` guarda solo lo necesario para limitar los intentos de entrada y reconocer una sesión del portal. La
alarma del objeto durable retira cada fila a su hora o, si esa retirada falla, en su reintento, aunque no llegue
ninguna petición más.

| Tabla | Qué guarda | Cuándo se retira |
| --- | --- | --- |
| `portal_limite_continuo` | Por cada IP (en IPv6, por su red /64), un HMAC y los instantes de sus intentos de los últimos 15 minutos. Gastan intento cada envío de contraseña del portal y del recorrido y cada credencial errónea de la entrega privada | 15 minutos después del último intento que guarda. El HMAC incluye un periodo de 15 minutos: cada periodo escribe en una fila nueva y el límite suma también las de los periodos vecinos (anterior, siguiente y el de antes del anterior), para que un desfase entre relojes no deje intentos fuera; una misma fila no dura más de 30 minutos desde el inicio de su periodo |
| `administracion_recorrido_intentos` | Contadores de la primera versión del límite, por HMAC de IP y ventana. Cada intento del portal y del recorrido se anota también aquí, en espejo, y `portal_limite_espejos` relaciona las dos anotaciones para que el intento cuente una sola vez | 15 minutos después de su creación |
| `portal_limite_prefijos` | Solo con una tabla del límite llena (`portal_limite_continuo` o, en el camino con espejo, `administracion_recorrido_intentos`): por cada prefijo (/48 en IPv6, /24 en IPv4) de las redes que aún no tienen fila propia, un HMAC del prefijo y los instantes de sus intentos de los últimos 15 minutos. No guarda la IP ni la red de cada intento | 15 minutos después del último intento que guarda |
| `portal_sesiones` | La huella de cada sesión del portal, sin la cookie | Al caducar la sesión, como mucho 1 hora después de la entrada, o al salir |

Las filas del límite con la huella estable de la versión anterior, sin periodo, se siguen leyendo para que sus intentos
cuenten; ya no se escriben y desaparecen 15 minutos después de su último intento. El HMAC impide leer la IP en la
tabla, pero quien tenga la clave del límite puede recalcularlo para una dirección y un periodo concretos.

Cada tabla del límite admite hasta 10.000 claves nuevas a la vez. Con la tabla llena, las IP (en IPv6, las redes /64)
que ya tienen fila, también de un periodo vecino, se siguen contando en ella, así que la tabla puede superar ese tope
en unas pocas filas por clave conocida. Una IP sin fila cuenta en `portal_limite_prefijos`, en la fila de su prefijo
(/48 en IPv6, /24 en IPv4), con 30 intentos por cuarto de hora para todo el prefijo y hasta 1.000 prefijos nuevos a la
vez, con el mismo margen para los conocidos. Agotado el cupo de su prefijo, o sin sitio para uno nuevo, recibe 429
marcado como saturación: el portal y el recorrido dicen entonces que llegan demasiadas peticiones a la vez, no que esa
red haya hecho demasiados intentos. Un Worker que no envía las huellas del prefijo, como los de la versión 12g, rechaza
así toda IP sin fila mientras la tabla está llena. Las filas de los prefijos caducan como las demás.

La API solo admite su lista cerrada de variables ([`variables-del-servicio.ts`](../src/plataforma/variables-del-servicio.ts)).
Cada entrada retira antes las suyas: la oficial, las del portal; la privada, las `FARO_PRUEBAS_*`; las dos, las del
recorrido. Una variable que no corresponde a la entrada, como las del portal en una entrega privada, deja la API en 503.

Los tokens de GitHub, las claves S3 y el token Cloudflare también son secretos;
sus ubicaciones se indican en las tablas correspondientes. Los manifiestos y SHA-256 de construcción
son evidencias generadas, no sustituyen las firmas ni se modifican para aceptar un contenido distinto.

## Códigos de estado del acceso

Una respuesta 401 obliga a indicar con `WWW-Authenticate` cómo identificarse (RFC 9110, 15.5.2). Faro solo la usa
donde ese esquema existe y el servidor lo acepta: `Bearer` en la API de socios y en las llamadas de mantenimiento,
`Basic` en la entrega privada de ensayo y en la emisión de tokens. El portal, la contraseña del recorrido y la sesión
del panel se identifican con un formulario, una cookie o una cabecera propia, que no tienen esquema HTTP, y por eso no
responden 401.

| Situación | Respuesta |
| --- | --- |
| Carga de una página sin sesión del portal (GET o HEAD) | 303 a `/acceso-web?volver=<ruta>`, con la página pedida para volver a ella al entrar |
| Pantalla de acceso `/acceso-web` | 200 con el formulario |
| Módulo, dato o API sin sesión del portal, o cualquier otro método | 403 sin cuerpo |
| Usuario o contraseña incorrectos en el portal o en el recorrido | 403 |
| Página del recorrido inactivo sin su contraseña | 200 con el formulario de la contraseña, en la misma dirección |
| Envío del formulario del recorrido con demasiados intentos | 429 con una página propia que lo explica en el idioma de la persona y `Retry-After` de la ventana del limitador |
| Envío del formulario del recorrido con el servicio no disponible | 503 con una página propia que lo explica en el idioma de la persona |
| Carga de una página del recorrido con el servicio no disponible | 503 con la misma página propia |
| Módulo, dato o API del recorrido, o cualquier otro método, con el servicio no disponible | 503 sin cuerpo |
| Sesión del panel ausente, cerrada o caducada | 403 con `{"error":"sesion_inactiva"}` |
| Carga de una página (GET) con sesión en una dirección que no existe, también `/no-existe.html` por su nombre | 404 sin caché con la página de Faro que lo explica y lleva a Inicio (`web/no-existe.html`), con las cabeceras de toda página |
| Módulo, dato, API o `HEAD` con sesión en una dirección que no existe | 404 sin cuerpo |
| `POST /avisos-del-navegador`, con o sin sesión o credencial, en las entregas oficial y privada | La respuesta del punto de avisos: 204, o 400, 415 o 429 si el envío no se admite y 500 ante un fallo interno; 503 si la entrega no está configurada y 403 por HTTP, como en las demás filas; cualquier otro método en esa ruta, la protección de las demás rutas |

Una carga de página se reconoce por `Sec-Fetch-Mode: navigate` o `Sec-Fetch-Dest: document`; si faltan, o si la
reenvía el service worker, por aceptar `text/html`. El retorno solo admite una ruta del propio sitio y se juzga ya
analizada, porque el análisis resuelve `.` y `..` y `/.//otro` quedaría en `//otro`, que el navegador lee como otro
origen. El valor recibido empieza por una barra, sin barra invertida ni caracteres de control y con 512 caracteres como
mucho. Analizado, conserva el origen propio, y su ruta, tal cual y con las secuencias `%XX` descodificadas, empieza por
una sola barra, sin barra invertida ni caracteres de control; tampoco puede ser la pantalla `/acceso-web`. Se vuelve a
la ruta con su consulta, nunca al fragmento, y si algo no se cumple, a `/inicio.html`. Ninguna de estas respuestas se
guarda (`Cache-Control: no-store`) y el service worker no conserva lo que no sea un 200 de esta versión.

## Actualización y almacén privado

| Grupo | Nombres | Dónde configurar | Lector y guía |
| --- | --- | --- | --- |
| Ejecutor autorizado | `FARO_ACTUALIZACION_GITHUB` | Configuración privada del servidor: destino fijo y pins OIDC | [Configuración del actualizador](../src/administracion/configuracion-actualizacion.ts); [ejecutor remoto](actualizacion-remota.md#configuración-de-la-entidad). |
| Credencial de Actions | `FARO_ACTUALIZACION_GITHUB_TOKEN` | Secreto del servidor para despachar y consultar; no se entrega al candidato | [Configuración del actualizador](../src/administracion/configuracion-actualizacion.ts); [ejecutor remoto](actualizacion-remota.md). |
| Actualización a demanda | `FARO_ACTUALIZACION_DEMANDA` | Variable no secreta del Worker principal, de 1 KiB como mucho; el Worker la pasa tal cual a la autoridad, que la vuelve a leer: `{"version":1,"habilitada":…,"actores":[…],"separacionMin":…,"maxDia":…,"maxMes":{"actualizar-datos":…,"comprobar-vencidas":…,"actualizar-cursos":…},"presupuestoMinMes":…,"reservaProgramadaMin":…}`, con esas claves exactas. `actores` lleva de 0 a 8 identificadores numéricos de cuenta de GitHub, sin repetir. Techos que fija el código, amplios para probar a demanda sin esperar al reloj: `separacionMin` de 1 a 10.080 minutos; `maxDia` de 1 a 96 (una cada cuarto de hora); cada `maxMes` de 0 (cierra esa acción) a 2.976; `presupuestoMinMes` de 1 a 50.000; `reservaProgramadaMin` de 1 a 1.440. Ausente, deshabilitada o fuera de esos techos, la vía queda cerrada y `POST /mantenimiento/reserva` responde `404`; nunca se corrige un valor. Exige `FARO_ACTUALIZACION_GITHUB` | [Configuración de la demanda](../src/administracion/configuracion-demanda.ts), [receptor](../src/administracion/reserva-a-demanda.ts); [reserva a demanda](actualizacion-remota.md#la-reserva-a-demanda-en-el-servidor). |
| Periodicidad y activación | `FARO_ACTUALIZACION_PROGRAMADA`, `FARO_ACTIVACION_AUTOMATICA` | Servidor/Worker; activación también en las variables del repositorio. Una publicación detenida se cierra desde el panel, sin variables. El Cron Trigger se aprovisiona aparte. `FARO_ACTUALIZACION_PROGRAMADA` es `{"version":1,"habilitada":…,"cron":"…"}` y admite `"pausaHasta":"AAAA-MM-DD"` (una fecha real; si no lo es, la configuración no es válida): solo se admite con `habilitada: false`. Con la programación apagada, sin pausa o con la pausa vencida, el vigilante da la incidencia `programacion_apagada`: el panel la muestra por la configuración y el aviso lo envía el evento diario, así que solo llega mientras el Cron Trigger siga configurado; con una pausa vigente (hasta ese día UTC, incluido), queda conforme y el panel dice su último día | [Programación](../src/administracion/configuracion-programada.ts), [capacidad de activación](../src/administracion/configuracion-activacion.ts); [programación diaria](actualizacion-remota.md#programación-diaria), [activación](actualizacion-remota.md#activar-el-candidato-validado). |
| Vigilante y avisos | `FARO_VIGILANTE` (variable), `FARO_AVISO_URL` (secreto) | Worker principal y entorno de su Durable Object. La dirección de avisos es `https:` y sin credenciales; sin ella no se envían avisos | [Configuración del vigilante](../src/administracion/configuracion-vigilante.ts), [canal de avisos](../src/administracion/envio-aviso.ts); [vigilante](../src/administracion/vigilante.md#avisos-desde-el-evento-programado), [despliegue](despliegue.md#avisos-del-vigilante). No confundir con `FARO_AVISO`, el ejecutable de avisos de la herramienta local. |
| Avisos por correo | `AVISOS_CORREO` (enlace `send_email`), `FARO_AVISO_REMITENTE` (variable) | Worker principal. El enlace va sin `destination_address`: el destino es la dirección que guarda el panel, tiene que estar dada de alta como verificada en la cuenta de Cloudflare y solo recibe avisos cuando el panel la tiene como `verificado` (tras un aviso de prueba aceptado). Enviar a direcciones verificadas en la cuenta no requiere plan de pago. `FARO_AVISO_REMITENTE` es una sola dirección ASCII del dominio del servicio o de un subdominio (por ejemplo `avisos@` seguido del dominio de `FARO_ADMIN_ORIGEN`), nunca una dirección personal. Sin el enlace o sin un remitente admitido no hay canal de correo y el resto funciona igual. Si también hay `FARO_AVISO_URL`, los dos canales comparten el registro de lo avisado: el correo va primero y basta con que uno entregue el aviso | [Canal de correo](../src/administracion/envio-aviso-correo.ts), [mensaje](../src/administracion/mensaje-aviso-correo.ts), [aviso de prueba](../src/administracion/prueba-aviso-correo.ts); [destino de los avisos](administracion.md). |
| Orígenes del runner | `FARO_ACTUALIZACION_ORIGEN`, `FARO_ORIGEN_PUBLICO` | Variables del repositorio de GitHub; origen administrativo y web pública respectivamente | [Supervisor](../plataforma_datos/orquestacion/ejecutar_mantenimiento.py), [activación](../plataforma_datos/orquestacion/activacion.py); [workflow](actualizacion-remota.md#workflow-de-github). |
| S3 compatible | `FARO_ALMACEN_S3` | Entorno privado de herramientas de transferencia; secreto del repositorio para los workflows, porque su punto de acceso lleva la cuenta | [Lector S3 explícito](../plataforma_datos/orquestacion/transferir_generacion.py); [almacén de datos](almacenamiento-datos.md). El JSON no contiene credenciales. |
| Claves del almacén | `FARO_ALMACEN_ACCESS_KEY_ID`, `FARO_ALMACEN_SECRET_ACCESS_KEY` | Secretos de la herramienta o del repositorio, con permisos acotados al almacén | [Lector S3](../plataforma_datos/orquestacion/transferir_generacion.py); [almacenamiento](almacenamiento-datos.md). No se adoptan perfiles AWS ambientales como alternativa. |
| Despliegue de versiones | `FARO_CLOUDFLARE_CONFIGURACION_JSON`, `FARO_CLOUDFLARE_CURSOS_CONFIGURACION_JSON`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Los cuatro son secretos del repositorio: la configuración del Worker principal, la del Worker de Cursos, el token con permiso sobre los dos y la cuenta, que así no aparece en el registro de Actions. Solo los recibe la fase de activación/recuperación | [Workflow](../.github/workflows/actualizar.yml), [adaptador](../herramientas/cloudflare/versiones.ts); [activación y recuperación](actualizacion-remota.md#activar-el-candidato-validado). |

El servidor comprueba identidad y revisión en cada operación. Un candidato validado no demuestra
versión activa. La [recuperación de un run terminado](actualizacion-remota.md#recuperar-la-activación-cuando-el-run-ya-terminó)
usa el mismo run y código, con intento posterior y activación existente; no reejecuta el motor ni
admite un resultado nuevo. El [procedimiento completo](actualizacion-remota.md) conserva sus límites
ante evidencia ausente, efectos inciertos y escritores externos.

## Enlaces del entorno del Worker

Son recursos del alojamiento, no cadenas que se sustituyan por una variable de entorno.
Mantener sus nombres, datos e historial de migraciones al actualizar la instalación.

| Enlace (binding) | Configuración y función | Lector y guía |
| --- | --- | --- |
| `ASSETS` | Recursos estáticos de la construcción, con enrutamiento previo por el Worker | [Worker](../src/plataforma/cloudflare/worker.ts); [configuración Cloudflare](../config/cloudflare/README.md#enrutamiento-y-datos). |
| `REGISTRO_SOCIOS` | Autoridad durable de credenciales, cuotas, administración, trabajos y activación | [Administración Cloudflare](../src/plataforma/cloudflare/administracion.ts); [administración](administracion.md), [instituciones](administracion.md#instituciones-y-accesos). |
| `CF_VERSION_METADATA` | Metadatos oficiales de la versión ejecutada, mediante `version_metadata` | [Construcción servida](../src/plataforma/cloudflare/construccion-servida.ts); [lectura privada](actualizacion-remota.md#observar-la-construcción-servida). No escribir un UUID manual. |
| `CURSOS` | Servicio del Worker de Cursos de su mismo entorno | [Puerta de Cursos](../src/plataforma/cloudflare/puerta-cursos.ts); [Worker de Cursos](../config/cloudflare/README.md#worker-de-cursos). Sin él, o si lleva otro paquete que el principal, la formación figura como no disponible y el resto se sirve. El Worker de Cursos no lee variables, secretos ni enlaces del entorno. |

La [guía Cloudflare](../config/cloudflare/README.md) y su plantilla conservan además los campos de
cuenta, rutas, compatibilidad, módulos de datos, migraciones y estáticos. El cron no se instala
por subir una versión. La comprobación local de construcción no acredita Access, cron ni límites
reales del alojamiento.

## Identidad inyectada, campos generados y herramientas

| Familia | Procedencia y tratamiento | Lector o guía |
| --- | --- | --- |
| `GITHUB_ACTIONS`, `GITHUB_EVENT_NAME`, `GITHUB_WORKSPACE`, `GITHUB_SHA`, `GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT`, `RUNNER_TEMP`, `RUNNER_TOOL_CACHE`, `GITHUB_SERVER_URL`, `GITHUB_REPOSITORY`, `GITHUB_PATH`, `GITHUB_ENV` | GitHub/runner. No elegir identificadores ni fingir un intento `1`. El preparador controla su entorno temporal y sus rutas | [Workflow](../.github/workflows/actualizar.yml), [preparador](../herramientas/mantenimiento/preparar-runner.sh); [contrato del runner](actualizacion-remota.md#ejecutar-y-conservar-el-trabajo). |
| `ACTIONS_ID_TOKEN_REQUEST_URL`, `ACTIONS_ID_TOKEN_REQUEST_TOKEN` | Capacidad OIDC efímera proporcionada por GitHub al supervisor, no secretos permanentes de la entidad | [Cliente privado](../plataforma_datos/orquestacion/cliente_mantenimiento.py); [inicio y recibo](actualizacion-remota.md#permiso-de-inicio-y-recibo). |
| `FARO_SOLICITUD_ID`, `FARO_REVISION_RESERVA`, `FARO_ACCION` | Derivadas de los tres inputs del despacho reservado por el servidor. No son ajustes persistentes ni órdenes libres | [Supervisor](../plataforma_datos/orquestacion/ejecutar_mantenimiento.py); [workflow](actualizacion-remota.md#workflow-de-github). |
| Documentos, revisiones, recibos, índices y huellas administrativos | Autoridad durable del servicio; no editar estos registros a mano ni borrar documentos conservados porque ya no habiliten una capacidad | [Autoridades administrativas](conexiones-administradas.md), [almacenamiento](almacenamiento-datos.md). |
| `FARO_WEB_DE_PRUEBA` | Carpeta web del ensayo local; no es una opción del perfil de publicación | [Servidor local](../herramientas/servidor/servidor-local.ts). |
| `FARO_HOY` | Fecha explícita para reproducir validaciones de fuentes; no acredita una consulta oficial realizada ese día | [Fuente abierta](../plataforma_datos/cursos/fuentes/abierta/lector.py); [cadena de datos](../plataforma_datos/orquestacion/README.md). |
| `FARO_AVISO` | Ejecutable confiable del administrador para avisos de la herramienta local; no es una orden recibida por HTTP y no se hereda al candidato | [Estado de actualización](../plataforma_datos/orquestacion/estado_de_la_actualizacion.py); [cadena de datos](../plataforma_datos/orquestacion/README.md). |

El servicio conserva configuración y estado durable con funciones distintas. Cambiar dominio, cuenta
o claves exige seguir la guía correspondiente y comprobar la instalación receptora; no se
restablecen almacenes ni controles para hacer coincidir una plantilla.
