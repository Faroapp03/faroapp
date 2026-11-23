# Almacén privado de datos y construcciones

Una generación conserva juntos los datos publicados, las entradas necesarias para actualizarlos
y su estado operativo. El adaptador S3 permite guardarla y recuperarla por contenido, en un bucket
privado de la entidad. Cloudflare R2 ofrece esa interfaz. El código utiliza el SDK oficial de AWS;
no depende de una cuenta, un dominio o una carpeta del desarrollador.

Este almacén pertenece al ejecutor de mantenimiento. No sirve el paquete público a los navegadores
ni conserva informes personales, credenciales de aplicaciones o sesiones administrativas.
Guardar una generación no la convierte en la versión activa.

## Preparación

Instalar las dependencias fijadas de `requirements.txt` en el entorno de Python de mantenimiento.
`requirements-dev.txt` las incluye también para ejecutar las comprobaciones. El SDK no se incorpora
al navegador ni al Worker.

Crear un bucket **privado**, sin acceso público, y credenciales limitadas a leer y escribir los objetos
necesarios de ese bucket. Estas operaciones no necesitan permiso de borrado. Comprobar en el
proveedor la política efectiva, el cifrado en reposo, las cuotas y los costes. El adaptador verifica TLS;
la privacidad del bucket y su conservación dependen también de la configuración del alojamiento.

Definir `FARO_ALMACEN_S3` en el entorno privado del ejecutor con este JSON, sustituyendo los ejemplos:

```json
{
  "version": 1,
  "endpoint": "https://almacen.de-la-entidad.example",
  "bucket": "datos-privados",
  "prefijo": "faro",
  "region": "auto"
}
```

En R2, el punto de acceso S3 (`endpoint`) tiene la forma `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` y la región es
`auto`. En otro servicio compatible deben utilizarse sus valores y comprobarse sus garantías de
escritura condicional. El prefijo delimita el espacio de objetos de esta instalación.
La documentación de R2 describe la [configuración de boto3](https://developers.cloudflare.com/r2/examples/aws/boto3/)
y las [operaciones S3 compatibles](https://developers.cloudflare.com/r2/api/s3/api/).

Las claves van en secretos separados: `FARO_ALMACEN_ACCESS_KEY_ID` y
`FARO_ALMACEN_SECRET_ACCESS_KEY`. No se incluyen en el JSON, en Git, en el navegador ni en los
argumentos de la CLI. La herramienta no carga `.dev.vars`, perfiles AWS, credenciales de instancia
ni proxies ambientales. Un perfil incompleto o inválido no inicia transferencias.

## Guardar y recuperar

El ejecutor debe recibir por un canal privado autorizado la revisión completa y la huella del
manifiesto. No debe deducir su confianza de las etiquetas del mismo objeto que está descargando.
Desde la raíz de una instalación de mantenimiento:

```sh
.venv/bin/python -m plataforma_datos.orquestacion.transferir_generacion guardar \
  "/ruta/privada/generacion" \
  --revision-generacion "<SHA-del-codigo-que-produjo-la-generacion>" \
  --sha256-manifiesto "<SHA256-esperado-del-manifiesto>"

.venv/bin/python -m plataforma_datos.orquestacion.transferir_generacion recuperar \
  "/ruta/privada/generacion-nueva" \
  --revision-generacion "<SHA-del-codigo-que-produjo-la-generacion>" \
  --sha256-manifiesto "<SHA256-esperado-del-manifiesto>"
```

El destino de recuperación debe ser nuevo, bajo un directorio privado. Ningún otro escritor debe
modificar las entradas o ese directorio durante la operación. El resultado correcto es un resumen
JSON con versión, revisión, huella del manifiesto, número de archivos y bytes totales. Ante un error
se devuelve un código distinto de cero y no se confirma una generación utilizable.

## Integridad y conservación

- El manifiesto identifica cada archivo por su ruta, tamaño y SHA-256. Al recuperar, cada ruta recibe
  su propio archivo, incluso cuando comparte contenido con otra.
- Cada escritura usa `If-None-Match: *`: nunca reemplaza un objeto existente. El contenido guardado
  se vuelve a leer y se comprueban sus bytes y SHA-256; ni el ETag ni los metadatos sustituyen esa lectura.
- Además de los objetos por contenido, el almacén admite la referencia
  `referencias/mantenimiento.json`, los índices `trabajos/<solicitudId>/<revisionReserva>/<runId>.json`
  y las actas `desbloqueos/<solicitudId>/<revisionReserva>/<runId>.json`, además de la asociación de
  bloques descrita abajo. Índices, actas y asociaciones solo se crean
  con `If-None-Match: *`; únicamente la referencia se sustituye, con `If-Match` del ETag de su lectura.
- Solo después de confirmar todos los archivos se guarda
  `<prefijo>/generaciones/<sha256-del-manifiesto>.json`. Una interrupción puede dejar objetos completos
  sin referencia, pero no confirma una generación incompleta.
- La recuperación valida primero el manifiesto y sus rutas, después cada archivo y la admisión
  integral de los datos. Solo al terminar promueve el directorio nuevo; no mezcla archivos con una
  instalación existente.

El contrato admite hasta 100.000 archivos, 4 GiB por archivo, 16 GiB en total y un manifiesto de
8 MiB. No se comprimen los datos en otro contenedor ni se acepta un inventario distinto del definido
por la generación. Las conexiones y transferencias tienen límites y no siguen redirecciones hacia
otros destinos; los errores públicos no incluyen los diagnósticos privados del proveedor.
Cada objeto dispone de 300 segundos para preparar, firmar y enviar su escritura, y otros 300 para
su lectura de comprobación. La conexión se limita a cinco segundos y el socket a diez. El control
se comprueba entre operaciones; no interrumpe una escritura de socket ya iniciada ni sustituye
el plazo global que debe imponer el ejecutor al trabajo. No habilitar trazas de depuración del SDK
con credenciales reales, porque pueden registrar peticiones firmadas.

No hay borrado automático ni política de caducidad incorporada. Los objetos pueden pertenecer a
varias generaciones: no se deben borrar blobs por antigüedad sin comprobar todas sus referencias.
La entidad debe dimensionar el almacenamiento y definir su conservación; no se garantiza que
una oferta gratuita cubra cualquier volumen o frecuencia de actualización.

### Transferencia de archivos agrupados

S3 guarda cada contenido en un objeto individual cuando el inventario tiene menos de 256 SHA-256
distintos. A partir de 256, tanto generaciones como artefactos usan el formato `agrupaciones/v1`.
El cambio reduce las operaciones secuenciales del ciclo diario y conserva la separación temporal
entre peticiones. La revisión y la huella del manifiesto siguen llegando por el canal de confianza.

El formato v1 ordena los contenidos únicos por SHA-256 hexadecimal. Los de 32 MiB o más viajan por
separado con su propio SHA. Los pequeños se reúnen por el primer dígito de su SHA y, dentro de cada
grupo, se concatenan en ese orden. Se inicia otro bloque antes de superar 32 MiB. Cada bloque
viaja sin compresión por `blobs/<sha256-del-bloque>`, con escritura condicional y lectura íntegra
de comprobación. El almacenamiento temporal para agrupar o separar contiene un bloque cada vez.

El índice contiene, en orden, los 32 bytes de la huella de cada bloque pequeño. El ejecutor lo guarda
también por su SHA en `blobs/`. A continuación crea con `If-None-Match: *` uno de estos controles
y comprueba con un GET que sus bytes coinciden exactamente con los esperados.

- `agrupaciones/v1/generaciones/<sha256-del-manifiesto>.sha256`
- `agrupaciones/v1/artefactos/<sha256-del-descriptor>.sha256`

El cuerpo son 64 dígitos hexadecimales ASCII en minúsculas con la huella del índice. El marcador
original `generaciones/…json` o `artefactos/…json` se guarda en último lugar. Una interrupción se
puede repetir con los mismos datos. Una asociación existente con otro índice hace fallar la operación.
Al revisar la conservación del bucket deben contarse los controles, sus índices, los bloques y los
archivos individuales referenciados por las generaciones y los artefactos conservados.

La recuperación verifica el manifiesto y calcula localmente el número de bloques, el tamaño exacto del
índice y los límites de cada miembro. Solo escribe en rutas del manifiesto validado. Comprueba la huella
de cada bloque, los bytes y el SHA de cada archivo y la admisión final antes de promover la carpeta.
Una respuesta confirmada de control ausente permite leer un inventario antiguo por objetos individuales.
Un fallo de lectura, un índice inválido o un bloque ausente después de encontrar el control interrumpen
la recuperación. Los transportes anteriores que solo ofrecen GET/PUT por contenido mantienen su formato.

## Construcciones de Cloudflare

Una [construcción conservada](../config/cloudflare/README.md#construcción-conservada) incluye
el Worker, sus módulos de datos y los recursos web. Es distinta de la generación operativa,
que contiene también las entradas y el estado necesarios para actualizar las fuentes.

Las funciones `guardar_artefacto` y `recuperar_artefacto`, de
`plataforma_datos.orquestacion.almacen_artefactos`, utilizan el mismo transporte privado. El ejecutor proporciona
por separado la revisión de código, la huella del paquete y el SHA-256 del descriptor. El lector
TypeScript de la instalación de mantenimiento valida el mismo formato que se exportó; Python
no mantiene una segunda definición de sus rutas ni de sus manifiestos. Se requiere Node en el
PATH del ejecutor, con la versión admitida por el producto. La comprobación no recibe los
secretos del almacén, perfiles ni opciones de Node del entorno.

Antes del primer envío se comprueba el artefacto completo. Los archivos individuales, los bloques y
sus índices comparten `blobs/<sha256>` con el resto del almacén. Al confirmarlos se conserva
`artefactos/<sha256-del-descriptor>.json`. No se crea otro archivo comprimido ni se sustituyen
objetos existentes. Para recuperar, primero se valida el descriptor contra la referencia
esperada y después se crean sus rutas. El directorio nuevo solo se admite tras comprobar
todos los bytes y las relaciones entre los manifiestos, el motor y los datos.

El descriptor admite hasta 8 MiB; el contenido conserva las cotas de la exportación,
incluido el máximo total de 1 GiB. Cada comprobación local tiene un plazo de 30 segundos,
además de los límites de transferencia del transporte. El ejecutor debe imponer el plazo
global del trabajo. La carpeta de origen y el padre del destino deben ser privados y estables,
sin otros escritores durante la operación.

Estas funciones no modifican recibos, referencias operativas ni el tráfico servido. La huella
permite cotejar la construcción con una referencia de confianza; no acredita por sí sola
su revisión de Git ni una firma digital. Conservarla no equivale a desplegarla.

## Referencia operativa y recibos

La inicialización es una operación explícita de preparación del alojamiento. Desde una generación
local completa, con revisión y huella comprobadas por el administrador:

```sh
.venv/bin/python -m plataforma_datos.orquestacion.ejecutar_mantenimiento inicializar \
  "/ruta/privada/generacion" \
  --revision-generacion "<SHA-del-codigo-que-produjo-la-generacion>" \
  --sha256-manifiesto "<SHA256-esperado-del-manifiesto>"
```

Primero conserva y coteja la generación completa. Después crea `referencias/mantenimiento.json`
con `If-None-Match: *`. Una referencia existente distinta, ausente durante una ejecución o corrupta
no se reemplaza ni reinicializa automáticamente.

La referencia distingue `baseOperativa`, usada para el siguiente intento, de `ultimaValidada`,
la última generación cuyo candidato fue admitido. **Ninguna declara qué versión está activa en la web.**
Un intento rechazado puede conservar una generación operativa íntegra: incluye los módulos admitidos,
las versiones conservadas y el estado de sus reintentos. En ese caso solo avanza `baseOperativa`.
Copiar únicamente el estado sobre los datos anteriores sería incoherente y no está permitido.

El recibo exacto se guarda como un blob y después se crea un índice inmutable en
`trabajos/<solicitudId>/<revisionReserva>/<runId>.json`. El índice identifica la ejecución, su código,
las referencias de generación y la huella y tamaño del recibo. Los nuevos índices usan la versión 2:
un resultado `validado` exige además una referencia `artefacto` con `revisionCodigo`, `huellaPaquete`
y `sha256Artefacto`; para `rechazado` y `sin-pendientes` ese campo es `null`. Antes de escribir el índice
se comprueban el código, el paquete del recibo y la igualdad del SHA-256 completo del manifiesto del
paquete entre generación y construcción. Solo entonces se avanza la referencia
operativa mediante `If-Match` del ETag de su lectura. El ETag es un control de concurrencia, nunca una
huella de integridad. La revisión debe crecer; una ejecución antigua no puede retroceder la referencia.
Ante una respuesta perdida, solo una lectura exacta confirma que la escritura se completó.

El reenvío conserva el índice y los bytes exactos del recibo. En versión 2 se vuelven a comprobar
los marcadores de generación y construcción, sin reconstruir ni descargar todo el artefacto.
Los índices de versión 1 siguen siendo legibles y no se reescriben ni se completan con referencias
inventadas. Recuperar un marcador solo acredita sus metadatos: antes de utilizar la construcción
debe recuperarse y verificarse íntegramente mediante `recuperar_artefacto`.

Un día rechazado deja el sistema como estaba. Si la generación del intento se puede exportar entera, se
conserva y pasa a ser la `baseOperativa`; `ultimaValidada` no se mueve. Si no se puede exportar, se
guardan su recibo y su índice y la referencia conserva su `baseOperativa`, sin bloqueo. Es lo que pasa
cuando las fuentes publican originales nuevos y el paquete se queda en su versión anterior, que cita los
de antes. Esa base se recuperó y se verificó entera al empezar el ciclo, así que el ciclo siguiente
arranca solo desde ella y vuelve a intentarlo. El diario dice qué comprobación impidió conservar el
intento (véase [por qué se retuvo un ciclo](operacion-manual-datos.md#por-qué-se-retuvo-un-ciclo)).

`bloqueoOperativo` solo puede seguir activo en una referencia que lo traiga de antes. El ciclo que lo
encuentra hace él mismo lo que hace la orden
[`levantar_bloqueo`](operacion-manual-datos.md#levantar-el-bloqueo-operativo): recupera y verifica
entera la `baseOperativa`, deja el acta inmutable en `desbloqueos/`, apaga el bloqueo sin mover bases,
revisión ni trabajo, y sigue. Si la base no verifica o la referencia cambia durante la verificación, no
arranca el motor, no escribe nada y termina en fallo con la causa en el diario; entonces hace falta una
persona. Con el bloqueo activo se pueden reenviar los trabajos que ya tienen índice, también el que dejó
el bloqueo. Un candidato declarado válido cuya generación no logra conservarse
tampoco se confirma al servidor. Lo mismo sucede si falla la construcción, su conservación
o su correspondencia con la generación. El estado local permite el diagnóstico mientras exista el
directorio privado del job; no se garantiza su conservación al terminar un runner efímero.

La [actualización remota](actualizacion-remota.md) describe la ejecución y el reenvío de recibos.
Antes de activar ese flujo debe verificarse el bucket configurado de la entidad, incluidos permisos,
escritura condicional de creación y CAS, lectura y recuperación. Las pruebas locales del adaptador no
sustituyen ese ensayo. El workflow de ejecución y la activación completa siguen siendo pasos necesarios.
