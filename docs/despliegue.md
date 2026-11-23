# Desplegar y mantener Faro en Cloudflare

La entrega separa tres componentes: código mantenible, artefacto público y generación operativa privada.
El inventario de cada uno identifica sus archivos y huellas. La [portabilidad](portabilidad.md) explica qué
entradas necesita el mantenimiento; publicar solo la web no instala la actualización automática.

## Preparar la instalación receptora

1. Instalar las versiones y dependencias fijadas en el [README](../README.md), desde una carpeta independiente.
   Preparar allí el paquete y los motores. No copiar `node_modules/`, `.venv/`, cachés ni enlaces a otra instalación.
2. Restaurar la generación operativa comprobada si se va a mantener la base. Conservar originales, licencias,
   periodos e historial de comprobaciones. Los perfiles privados, sesiones y credenciales de otra instalación
   no forman parte de una instalación nueva.
3. Completar la [configuración](configuracion.md) de la entidad: dominio, contacto público, responsable de
   privacidad y contacto de seguridad. La entrega no proporciona una identidad personal por defecto.
4. Configurar en el alojamiento los secretos y permisos de esa instalación, con los nombres de la
   [configuración](configuracion.md#secretos-y-firmas) y valores independientes en producción y ensayo. Las
   plantillas de [Cloudflare](../config/cloudflare/README.md) no contienen cuenta ni claves. El panel requiere Cloudflare
   Access, origen y audiencia administrativos, autorización en Faro y almacenamiento persistente.

## Requisitos en el alojamiento

Cada entorno tiene sus propios recursos. Ninguna orden local los crea ni los comprueba en la cuenta: la entidad los
verifica y lo declara en su registro de instalación.

| Recurso | Producción | Ensayo |
| --- | --- | --- |
| Workers | `faro-pruebas` y `faro-pruebas-cursos` | `faro-ensayo` y `faro-ensayo-cursos` |
| Almacén `REGISTRO_SOCIOS` | Clase `AccesoPublicoDurable` con la migración `faro-pruebas-inicial-v1` ya aplicada | Lo crea la primera publicación del principal, con `faro-ensayo-inicial-v1`; la entrada privada guarda en él su cuota de intentos |
| Dirección | Dominio propio `faroapp.org`, asociado al principal con su certificado; workers.dev y previews desactivados. En la zona, TLS mínimo 1.2 con TLS 1.3 activo, y `www.faroapp.org` con registro DNS a través de Cloudflare, certificado y redirección permanente al dominio principal que conserva la ruta y los parámetros. El Worker principal hace la misma redirección si una petición a `www` le llega sin pasar por esa regla, para que nunca se sirvan dos copias del sitio. En la zona no se activa ninguna función que reescriba o inyecte contenido en lo servido: ni las que tocan el HTML, el CSS o el JavaScript (Rocket Loader, ofuscación de correos, Web Analytics automático, Zaraz, detecciones JavaScript de bots) ni las que recomprimen imágenes (Polish, Mirage). La copia sin conexión comprueba cada archivo contra su huella: una reescritura impediría instalarla o dejaría fuera lo que no cuadre | `https://faro-ensayo.<subdominio de la cuenta>.workers.dev`, declarado en su registro; sin dominio. La entrada privada exige la cabecera `cf-connecting-ip` que fija Cloudflare: un proxy intermedio debe fijarla él, nunca reenviar la del cliente |
| Secretos | Los de la entrega oficial: firma del servicio, portal y, si se usa la otra variante, recorrido | Los de la entrega que se ensaye, con valores propios: la oficial pide los mismos nombres que producción; la privada, `FARO_PRUEBAS_CLAVE` y `FARO_PRUEBAS_LIMITE`, distintas y de al menos 32 bytes |
| Access | Aplicación del panel para el dominio; su equipo y su audiencia van en `FARO_ADMIN_*` | Una aplicación propia para el host workers.dev, solo si se habilita el panel de ensayo |
| Programación | Opcional: un Cron Trigger que coincida con `FARO_ACTUALIZACION_PROGRAMADA` | No se programa |
| Mantenimiento remoto | Repositorio de GitHub con el workflow, sus variables y secretos, y el almacén S3 privado | No |

Los nombres y requisitos de cada secreto están en la [configuración](configuracion.md#secretos-y-firmas). La orden de
despliegue no envía rutas ni horarios. Según la lectura del código de Wrangler 4.151.1, una configuración sin `triggers`
tampoco cambia los horarios existentes. Comprobar el dominio y el horario en la cuenta después de cada publicación.

## Construir y comprobar

Desde el código estable que se va a entregar, preparar los generados siguiendo la
[guía de construcción](construccion-web.md) y ejecutar:

```sh
npm run verificar
npm run construir -- --revision-codigo "$REVISION_CODIGO" --destino-cloudflare oficial
npm run cloudflare:comprobar
node pruebas/navegadores/portal-oficial-miniflare.mjs dist "$SHA256_ARTEFACTO" "/ruta/nueva"
```

La construcción oficial se ensaya en navegador con su portal de acceso (`portal-oficial-miniflare.mjs`):
`npm run probar:navegadores` toma el modo del destino de la construcción y solo ensaya la privada, la que se construye
sin `--destino-cloudflare` ([pruebas en navegador](../pruebas/navegadores/README.md)).

`REVISION_CODIGO` es la revisión de las fuentes (40 caracteres hexadecimales); la herramienta la registra, pero no
demuestra por sí sola que la carpeta provenga de ella. Sin `--destino-cloudflare oficial`, la construcción prepara
la entrada privada de ensayo, que producción no admite.

La construcción produce `dist/` y un resumen con `revisionCodigo`, `huellaPaquete` y `sha256Artefacto`.
Conservar ese resumen fuera del directorio construido. Comprobar una copia trasladada contra su huella:

```sh
npm run cloudflare:artefacto -- comprobar dist --sha256 "$SHA256_ARTEFACTO"
```

`SHA256_ARTEFACTO` es el valor del resumen comprobado, no una huella calculada de nuevo para aceptar la copia.
El artefacto incluye los Workers, sus módulos de datos y la web; no incluye el almacén privado de actualización,
cuentas, secretos o entornos de desarrollo. Las pruebas de navegador deben corresponder al mismo artefacto.

## Publicar la construcción admitida

La misma entrega oficial, con el mismo `sha256Artefacto`, pasa primero por el ensayo y después por producción. Cada
publicación usa una sola orden, `herramientas/cloudflare/desplegar.ts`. Antes de llamar a Wrangler comprueba la
configuración de los dos entornos, todos los bytes de la entrega, su destino y el registro de la instalación
(`--instalacion`). Wrangler recibe los módulos ya construidos, sin volver a empaquetarlos, sin rutas y con las
variables del alojamiento conservadas. El detalle está en la [configuración de Cloudflare](../config/cloudflare/README.md#desplegar).
El Worker de Cursos se publica antes que el principal:

```sh
node herramientas/cloudflare/desplegar.ts comprobar --entorno ensayo --servicio principal --sha256 "$SHA256_ARTEFACTO"
node herramientas/cloudflare/desplegar.ts publicar --entorno ensayo --servicio cursos --sha256 "$SHA256_ARTEFACTO" --instalacion "$REGISTRO_ENSAYO"
node herramientas/cloudflare/desplegar.ts publicar --entorno ensayo --servicio principal --sha256 "$SHA256_ARTEFACTO" --instalacion "$REGISTRO_ENSAYO"
node herramientas/cloudflare/desplegar.ts publicar --entorno produccion --servicio cursos --sha256 "$SHA256_ARTEFACTO" --instalacion "$REGISTRO_PRODUCCION"
node herramientas/cloudflare/desplegar.ts publicar --entorno produccion --servicio principal --sha256 "$SHA256_ARTEFACTO" --instalacion "$REGISTRO_PRODUCCION"
```

Cada Worker lleva la huella del paquete con el que se construyó. El principal la envía en cada consulta y el de Cursos
solo responde con datos si coincide con la suya; si no coincide, o si una respuesta no dice qué paquete lleva, la
formación figura como no disponible y el resto se sirve. Entre las dos publicaciones, o si falla la del principal, la
formación queda así hasta que los dos Workers lleven el mismo paquete: nunca se combinan datos de dos versiones.

Los dos registros son archivos privados de la entidad que declaran el estado ya verificado de cada entorno, incluido
su origen exacto. Una
instalación nueva aplica su migración inicial en la primera publicación del principal: la orden se detiene hasta que
se nombra con `--aplicar-migracion` ([instalación nueva y actualización](../config/cloudflare/README.md#instalación-nueva-y-actualización)).
Las credenciales de Cloudflare son las de la entidad; `comprobar` no contacta con el alojamiento. Conservar el recibo
de cada orden y el identificador de versión que devuelve el alojamiento.

Comprobar sobre el dominio servido HTTPS, cabeceras, páginas, recorrido ES/CA, informes, instalación PWA y
recuperación sin conexión. La copia sin conexión debe instalarse completa sin ningún aviso de que no coincide, y una
muestra de páginas, estilos, diccionarios, guiones e imágenes servidos, ya descomprimidos, debe cuadrar byte a byte con
su huella en el service worker publicado. Verificar que el panel y todos sus recursos exigen la identidad autorizada. Contrastar
la revisión y el paquete servidos con el recibo de la construcción. Un resultado local correcto no sustituye
estas comprobaciones del alojamiento.

Una versión con sesiones revocables solo debe revertirse a otra versión que consulte esa misma autoridad. Una
versión antigua que valida solo la firma puede volver a aceptar cookies revocadas si conserva la clave anterior.
No se deben restaurar esas versiones con la misma firma: mantener un artefacto de recuperación con revocación o
inutilizar todas las sesiones mediante una rotación autorizada y comprobada de la firma. Las cookies nuevas usan
un dominio de firma v2 que la versión anterior no acepta; las cookies v1 emitidas antes del cambio aún pueden
ser aceptadas por esa versión hasta caducar. La transición invalida las sesiones anteriores y exige volver a entrar.
En esta instalación, la entrega 12g valida solo la firma y no consulta la revocación: no sirve como recuperación
([reversión](migracion-workers.md#reversión)).

## Activar el mantenimiento

El [circuito remoto](actualizacion-remota.md) utiliza un workflow fijo, identidad OIDC comprobada y un almacén
privado. Configurar repositorio, revisión autorizada, permisos y almacén; trasladar la generación inicial con su
manifiesto. El almacén de actualización nunca se sirve como recurso público.

Primero lanzar una actualización manual desde el panel y comprobar el circuito completo: reserva, ejecución,
admisión, conservación, activación y lectura de la versión realmente servida. El ejecutor exporta la variante que
declara `FARO_CLOUDFLARE_VARIANTE` (`oficial` en producción) y la activación rechaza un artefacto de otra variante.
La activación publica los dos Workers del artefacto en una sola intención, primero Cursos y después el principal, y
solo se da por confirmada con los dos en el mismo paquete; entre una publicación y otra queda en una fase explícita
y la formación figura como no disponible
([fases y recuperación](actualizacion-remota.md#activar-el-candidato-validado)). Necesita, además de
`FARO_CLOUDFLARE_CONFIGURACION_JSON` para el principal, el secreto `FARO_CLOUDFLARE_CURSOS_CONFIGURACION_JSON` con la
configuración real del Worker de Cursos, y un `CLOUDFLARE_API_TOKEN` con permiso de versiones y despliegue sobre los
dos. `FARO_ACTIVACION_AUTOMATICA` se pone en `si`, en el servidor y en el repositorio, solo con el servidor y el
workflow de esta versión publicados, el Worker de Cursos ya desplegado con una sola versión al 100 %, los dos
secretos configurados y una activación completa ensayada. Mientras tanto queda ausente o en `no`, y el artefacto
validado se recupera del almacén privado y se publica a mano, primero Cursos y después el principal
([publicar a mano un artefacto conservado](actualizacion-remota.md#publicar-a-mano-un-artefacto-conservado)). Ensayar
repetición sin cambios,
fallo aislado de una fuente y recuperación. Conservar la última entrega válida cuando no se pueda admitir otra.

Una intención que no puede terminar se cierra como `abandonada` y libera la reserva
([abandonar una intención](actualizacion-remota.md#abandonar-una-intención)). Se cierra sola cuando el adaptador
demuestra que el efecto en curso no se hizo y los dos Workers sirven aún lo anterior; si no, queda detenida en su
fase con el motivo, y el panel lo dice. A mano, quien administra la cierra desde el panel con «Cerrar esta
publicación»: el servidor comprueba en GitHub que la ejecución terminó, despacha una ejecución nueva y esa ejecución
la cierra si la web sirve otra vez lo anterior
([cerrar una publicación desde el panel](actualizacion-remota.md#cerrar-una-publicación-desde-el-panel)). No hace
falta que el artefacto siga conservado. Ensayar este cierre una vez en la instalación de la entidad antes de encender
la activación automática. Un paquete abandonado por
`rechazo-previo` se reintenta una sola vez, en la ejecución siguiente del mantenimiento, si su trabajo y su artefacto
siguen conservados y no hubo otro trabajo en medio
([reintento de una intención abandonada](actualizacion-remota.md#reintento-de-una-intención-abandonada)); uno
abandonado a mano o por `rechazo-proveedor` no se reintenta solo. Mientras haya datos validados sin publicar, el
panel lo dice con su fecha y el vigilante emite el aviso `datos_validados_sin_publicar`. Antes de encender la
activación automática, comprobar también en la instalación de ensayo que una versión publicada con
`desplegar.ts publicar … --intencion <solicitudId>` aparece con esa etiqueta y esa huella en
`wrangler versions list --json`.

Después configurar el horario UTC y el Cron Trigger coincidentes según la guía remota. El trigger por sí solo
no instala el ejecutor ni habilita la activación. Antes de declarar operativa la actualización automática, ejecutar
también el [vigilante](../src/administracion/vigilante.md) y revisar sus incidencias. La comprobación no instala un
cron ni envía avisos. API, MCP y A2A se habilitan de forma independiente desde el panel.

## Preparar el vigilante en Cloudflare

Con el código y el enlace del entorno (binding) ya desplegados y los almacenes de trabajos, programación y activación
previamente preparados, la entidad define en el entorno del Worker principal `FARO_VIGILANTE`: JSON cerrado versión 1
con `habilitado`, `activadoEn`, `plazoEventoMs`, `plazoInicioMs`, `plazoCierreMs` y `plazoObservacionMs`. Elige los
cuatro plazos y el instante de activación; no hay valores por defecto. La preparación usa esa política del servidor,
no recibe configuración por HTTP. Los mismos valores deben llegar al entorno del Durable Object.

La operación requiere una identidad humana admitida por Access y un origen HTTPS administrativo. Abre una sesión
Faro nueva, que sustituye cualquier sesión del panel existente, prepara el vigilante en el Durable de esa instalación
y cierra la sesión. No consulta fuentes, despacha trabajos ni activa una entrega. La ruta de ensayo privado no
permite esta operación. Si faltan o están dañadas las autoridades previas, la preparación falla y no crea ni migra
esas autoridades. Repetir una preparación de la misma política conserva historia y fechas; cambiar la política
requiere otra preparación explícita.

Después de autenticarse en Access mediante el navegador, la persona autorizada obtiene el **valor** de su cookie
`CF_Authorization` de esa sesión y lo introduce sin eco cuando se le solicite:

```sh
python3 -c 'import getpass; print(getpass.getpass("Valor de CF_Authorization: "))' | node herramientas/mantenimiento/preparar-vigilante-remoto.ts https://origen-administrativo.example
```

No incluir la cookie en el comando, argumentos, variables, archivos ni registros. La utilidad no sigue redirecciones,
limita las respuestas y no reintenta. Si se pierde una respuesta, la preparación o el cierre pueden haber ocurrido:
comprobar la instalación y la sesión antes de decidir otra operación. La salida «Preparación confirmada; cierre de
sesión no confirmado» distingue ese caso del resultado incierto. Al terminar, comprobar desde el panel una evaluación
y su historial: la configuración anunciada no demuestra por sí sola que la autoridad esté preparada. La simulación
local no acredita Access, el enlace del entorno, el cron ni la configuración de una cuenta real.

### Avisos del vigilante

Con el vigilante preparado, el mismo evento programado del Worker lo evalúa después de la programación diaria, también
cuando la actualización ha fallado o la programación está apagada. Apagarla a propósito se declara con
`"pausaHasta": "AAAA-MM-DD"` en `FARO_ACTUALIZACION_PROGRAMADA` (solo con `habilitada: false`); sin pausa, o con la pausa vencida, el vigilante lo
avisa como incidencia. Si se quita el Cron Trigger no llega ningún evento: el vigilante no se evalúa solo y no avisa
de nada, ni siquiera de que la programación esté apagada. Para recibir avisos, la entidad guarda como secreto del Worker principal
`FARO_AVISO_URL`, una dirección `https://` sin usuario ni contraseña, y la conecta con el servicio que use (correo,
mensajería o registro de incidencias):

```sh
npx wrangler secret put FARO_AVISO_URL
```

Sin ese secreto no se envía nada y el panel lo indica como «los avisos no están configurados». Una dirección que no
es `https:` o que lleva credenciales no se usa: el intento queda como fallido con el motivo `destino-no-admitido`.
El servicio que recibe los avisos debe admitir repeticiones del mismo aviso.
Tras actualizar Faro, recarga el panel de administración si estaba abierto: uno anterior rechaza la respuesta del
vigilante en cuanto lleva el estado de los avisos, un fallo programado o una pausa.
Qué se envía, cuándo y qué ocurre si falla se describe en el [vigilante](../src/administracion/vigilante.md#avisos-desde-el-evento-programado).

## Actualizar una instalación activa

Construir la siguiente entrega en otra carpeta y comprobarla antes de cambiar la versión servida. Conservar
enlaces del entorno, almacenes, revocaciones, configuración e inventarios. Una reversión de código no revierte los datos
administrativos: cualquier migración debe ser compatible con la versión que se pretenda recuperar. Si cambia una ruta
interna del Durable Object, se publica primero la versión cuya autoridad atiende la ruta nueva y la antigua, y después
la que cambia el cliente, porque en un despliegue gradual conviven las dos.

Los recursos del panel se sirven con `cache-control: no-store`, así que cargar el panel trae siempre el JavaScript
publicado. Un panel que ya estaba abierto al publicar conserva el anterior: si la versión nueva amplía el estado de
la publicación de datos, al consultarla muestra «No se ha podido consultar la última publicación» hasta recargar la
página. Recargar el panel abierto después de cada publicación.

El estado de datos que lee el panel admite campos que solo viajan cuando tienen valor: `motivoAlmacen` en la fila del
paquete; en la fila de una fuente por ediciones, `edicionNueva` (la edición nueva observada, hoy de la TIC-H) o
`avisoEdicion`; y en la fila de seguimiento remoto de una fuente, `salidaParcial` (los motivos, de una lista cerrada, por
los que su última salida no lo recoge todo) y `enlaces` (los enlaces de los cursos comprobados, ocultos y sin comprobar).
Un validador anterior (el servidor sin actualizar, el JavaScript del panel en caché o el `_snapshot` del almacén de
trabajos) rechaza la instantánea entera en cuanto aparece uno de ellos o un motivo de esa lista que no conoce. Por eso el
orden es obligatorio:
primero la web y el servidor con el validador nuevo (`src/administracion/estado-datos.js` y
`edicion-nueva-datos.js`, publicados con `npm run comunes:generar`), y después la plataforma de datos que los produce
(`plataforma_datos/orquestacion/estado_panel.py` y `ediciones_observadas.py`).

El registro de la instalación declara los Workers y las migraciones ya aplicadas. La orden de despliegue rechaza
otro nombre de Worker o un historial reescrito y exige nombrar cualquier migración nueva. Cambiar `name` en la
configuración no renombra un Worker: crea otro, con otro almacén. El [renombrado de Workers](migracion-workers.md) se
hace en el sitio. Que conserve los datos y los recursos asociados solo se da por bueno si el ensayo lo comprueba.
