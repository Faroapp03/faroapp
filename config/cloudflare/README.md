# Cloudflare Workers

Faro se publica en dos Workers: el principal, que sirve la web, la API y el panel, y el de Cursos, que solo
atiende al principal por el binding `CURSOS`. Hay dos entornos con Workers y almacenes propios: producción, en el
dominio de la entidad, y ensayo, en workers.dev. Toda publicación pasa por la orden de [Desplegar](#desplegar).
Wrangler está fijado en las dependencias de desarrollo y en el archivo de bloqueo del producto.

## Papel de cada configuración

| Archivo | Papel | Lo usa |
| --- | --- | --- |
| `config/cloudflare/instalaciones/wrangler.produccion.jsonc` | Worker principal de producción: `faro-pruebas`, dominio `faroapp.org`, almacén `REGISTRO_SOCIOS` y migración `faro-pruebas-inicial-v1` | `desplegar.ts --entorno produccion` |
| `config/cloudflare/instalaciones/wrangler.produccion-cursos.jsonc` | Worker de Cursos de producción: `faro-pruebas-cursos`, sin dirección pública | ídem |
| `config/cloudflare/instalaciones/wrangler.ensayo.jsonc` | Worker principal de ensayo: `faro-ensayo`, en workers.dev, con almacén y migración propios (`faro-ensayo-inicial-v1`) | `desplegar.ts --entorno ensayo` |
| `config/cloudflare/instalaciones/wrangler.ensayo-cursos.jsonc` | Worker de Cursos de ensayo: `faro-ensayo-cursos` | ídem |
| `config/cloudflare/wrangler.example.jsonc` | Plantilla de una instalación nueva compilada desde las fuentes, con la entrada privada `worker-privado.ts` | `npm run cloudflare:comprobar` |
| `config/cloudflare/wrangler.unificado.example.jsonc` | La misma plantilla con la entrada oficial `worker-oficial.ts` | `npm run cloudflare:comprobar` |
| `config/cloudflare/wrangler.cursos.example.jsonc` | Plantilla del Worker de Cursos desde las fuentes (`worker-cursos.ts`) | `npm run cloudflare:comprobar` |
| `config/cloudflare/programacion.example.jsonc` | Fragmento de ejemplo del horario diario y de la variable que lo habilita, para añadir a la configuración completa de la entidad | Prueba de la programación |
| `config/cloudflare/instalacion.example.json` | Plantilla del registro de instalación: estado remoto ya verificado de un entorno | `desplegar.ts --instalacion` |

Las entradas de Worker de `src/plataforma/cloudflare/` se encadenan así:

| Entrada | Qué añade | Entrega |
| --- | --- | --- |
| `worker-oficial.ts` | Portada pública y portal con contraseña general; después, la aplicación común | Oficial (`--destino-cloudflare oficial`) |
| `worker-privado.ts` | Puerta privada con `FARO_PRUEBAS_CLAVE` por HTTP Basic, con cuota de intentos fallidos por IP en `REGISTRO_SOCIOS`, guardada como HMAC con `FARO_PRUEBAS_LIMITE`; después, la aplicación común | Privada (la de `npm run construir` por defecto); solo en ensayo |
| `worker-unificado.ts` | Variante de recorrido con su contraseña, su firma y su límite | Las dos |
| `worker.ts` | Adaptador base: web, datos, API, MCP, A2A, panel y tarea programada | Las dos |
| `worker-cursos.ts` | Motor de cursos; solo atiende `POST /operar` desde el principal | Las dos, en `worker-cursos/` |

Las variables que lee cada entrada y sus secretos están en la [configuración](../../docs/configuracion.md#secretos-y-firmas).

Los cuatro archivos de `config/cloudflare/instalaciones/` son el perfil de esta instalación. Los campos del producto (entrada,
compatibilidad, módulos `Data`, recursos, bindings) son fijos. La entidad elige los nombres de los Workers, las
migraciones y el dominio. `herramientas/cloudflare/preparar-despliegue.ts` lo comprueba: producción y ensayo usan
cuatro Workers distintos y migraciones separadas. Esta comprobación local no verifica el estado de los almacenes
remotos. El ensayo no tiene rutas. Producción y los dos Workers
de Cursos no usan workers.dev ni previews, y producción declara un solo dominio propio. En la raíz no hay
`wrangler.json`, `wrangler.jsonc` ni `wrangler.toml`: Wrangler los descubriría solo, y un `wrangler deploy` sin
estas comprobaciones volvería a empaquetar el código y enviaría las rutas.

Preparar primero los recursos siguiendo la [guía de construcción](../../docs/construccion-web.md)
y comprobar la instalación desde la raíz del producto:

```sh
npm run verificar
npm run cloudflare:comprobar
```

La segunda orden comprueba la configuración, compila el Worker, coteja los módulos de datos
y mide los recursos seleccionados por `.assetsignore`. No despliega, no utiliza credenciales
y no sustituye una prueba en el entorno de ejecución de Workers.

## Construcción conservada

`npm run construir` prepara la salida limpia en `dist/`, reutiliza este exportador y comprueba sus recursos finales.
Es la entrada para una nueva entrega. Conserva las fuentes, calcula la CSP del Worker desde la web construida y
no utiliza credenciales. Véanse las condiciones de sustitución y revisión en la
[guía de construcción](../../docs/construccion-web.md#salida-para-publicar).

La orden `cloudflare:artefacto exportar` utiliza el mismo constructor para preparar una carpeta independiente
nueva. La carpeta se indica como argumento posicional y `--destino privado|oficial` selecciona la variante;
en `construir`, `--destino` indica la carpeta y `--destino-cloudflare` selecciona la variante. Requiere además la huella del paquete esperado; la contrasta antes de preparar la salida y de nuevo antes
de exportarla. No copia la web fuente directamente, no actualiza datos ni repara las fuentes. Ejecutarla en una
candidata privada y estable, fuera de la instalación que sirve tráfico.

El ejecutor proporciona la revisión de código autorizada (SHA de Git, 40 caracteres) y la huella
del paquete admitido (16 caracteres). La herramienta coteja la huella con los archivos; registra
la revisión declarada, pero no demuestra por sí sola que la carpeta provenga de ese commit.

```sh
npm run cloudflare:artefacto -- exportar "../Salida Faro" \
  --revision-codigo "$REVISION_CODIGO" --huella-paquete "$HUELLA_PAQUETE"
```

El destino debe ser nuevo, fuera del producto y con un directorio padre privado existente.
Contiene `worker/worker.mjs`, sus módulos `worker/datos/`, el Worker de Cursos (`worker-cursos/worker.mjs` y
`worker-cursos/datos/`), los recursos `web/` y `artefacto.json` con sus tamaños y huellas. No incluye el almacén administrativo, perfiles, claves, capturas de fuentes
ni dependencias de desarrollo. El límite de la copia es 1 GiB, además de los límites del Worker
y de cada recurso; excederlo detiene la exportación.

La salida devuelve `sha256Artefacto`. Conservar ese valor por una vía confiable junto al recibo
del trabajo. Después de trasladar la carpeta, comprobarla contra ese mismo valor:

```sh
npm run cloudflare:artefacto -- comprobar "../Salida Faro" --sha256 "$SHA256_ARTEFACTO"
```

Esta comprobación no necesita la candidata original ni recompilar el motor. Rechaza archivos
ausentes, sobrantes, enlaces, cambios de bytes y discrepancias entre los datos del Worker y
los del navegador. Una huella detecta cambios respecto de la referencia conservada; no es una firma digital.

El [almacén privado](../../docs/almacenamiento-datos.md#construcciones-de-cloudflare) puede conservar
y recuperar esa misma construcción por contenido. Para comprobar solo el descriptor antes de
recuperar sus archivos, el ejecutor utiliza:

```sh
npm run cloudflare:artefacto -- descriptor "../artefacto.json" --sha256 "$SHA256_ARTEFACTO"
```

La salida contiene el descriptor validado. No acredita la existencia ni la integridad del contenido;
la comprobación completa anterior sigue siendo necesaria después de recuperarlo.

La carpeta exportada es una entrada para el adaptador de despliegue de Cloudflare, no un servidor
Node ni una sustitución de la entrega completa del producto. No incluye configuración de cuenta,
no publica y no acredita una versión activa. La configuración del alojamiento, las firmas y la
comprobación de lo realmente servido siguen siendo pasos independientes. Conservar los nombres
y bindings de los almacenes existentes al cambiar la versión; una reversión de código no revierte
sus datos administrativos.

Al consumir la construcción con Wrangler, el directorio base de los módulos es `worker/` (y
`worker-cursos/` para el Worker de Cursos) y el de los recursos estáticos es `web/`. Mantenerlos separados evita que el descubrimiento de
módulos incluya páginas HTML u otros recursos web en el Worker. Usar el código ya compilado
sin volver a empaquetarlo; conservar la regla de módulos `Data` para `datos/*.json`.

El control local limita el Worker y sus módulos a 64 MiB sin comprimir. Es la magnitud que
Cloudflare cuenta en sus [límites de Workers](https://developers.cloudflare.com/workers/platform/limits/#worker-size);
la cifra `gzip` de Wrangler es informativa. El ensayo local no acredita el tiempo de arranque
ni la aceptación de la instalación por el alojamiento.

## Desplegar

`herramientas/cloudflare/desplegar.ts` es la única orden de publicación; su opción `--ayuda` muestra el uso:

```sh
node herramientas/cloudflare/desplegar.ts comprobar --entorno ensayo --servicio principal --sha256 "$SHA256_ARTEFACTO"
node herramientas/cloudflare/desplegar.ts ensayar --entorno ensayo --servicio cursos --sha256 "$SHA256_ARTEFACTO"
node herramientas/cloudflare/desplegar.ts publicar --entorno ensayo --servicio cursos --sha256 "$SHA256_ARTEFACTO" --instalacion "$REGISTRO_ENSAYO"
```

- `comprobar` es local: no contacta con Cloudflare. `ensayar` ejecuta `wrangler deploy --dry-run`. `publicar` cambia
  el Worker indicado y exige `--instalacion`.
- `--sha256` es la huella de `artefacto.json` que devolvió la construcción. `--artefacto` indica otra carpeta de
  entrega comprobada (por defecto, `dist/`). Producción solo admite una entrega oficial; el ensayo admite también la
  privada.
- Antes de Wrangler se comprueban los dos entornos, todos los bytes de la entrega, su destino, que contenga el Worker
  del servicio, el registro de la instalación y la migración. Si algo no cuadra, Wrangler no se ejecuta.
- Wrangler recibe una sola orden: una copia temporal de la configuración, sin rutas y con rutas absolutas a la
  entrega, junto con `--no-bundle`, `--keep-vars`, un `.env` vacío y la [identidad de red](../../herramientas/red/identidad-wrangler.cjs)
  del producto. No hereda del proceso cuentas, destinos ni opciones de carga. Al terminar, la orden vuelve a
  comprobar la entrega y escribe un recibo JSON.
- El principal sale siempre con `FARO_MCP`, `FARO_A2A` y `FARO_API_SOCIOS` en `no`. Son semillas: el panel conserva su
  política. Producción conserva sus variables de administración. En ensayo la administración queda en `no`, salvo que
  `--acceso` aporte un JSON público con exactamente `equipo`, `audiencia` y `origen`. El equipo y la audiencia se
  validan como en el Worker. `--acceso` exige `--instalacion`, y el origen debe ser exactamente el `origen` de ese
  registro: el workers.dev del Worker de ensayo en el subdominio de la cuenta. Otro Worker u otra cuenta se rechazan.
  Access se configura y prueba aparte; ese archivo no lleva contraseñas ni tokens.
- `--privadas <archivo>` pone variables y secretos nuevos en el Worker principal de producción. Solo se admite con
  `--entorno produccion`, `--servicio principal` y la acción `ensayar` o `publicar`; sin esta opción, la orden se
  comporta igual. El archivo es privado de quien opera y nunca se versiona: debe ser suyo, con permisos `0600`, sin
  enlaces simbólicos (tampoco en las carpetas del camino) ni enlaces duros, y de 16 KiB como mucho. Su forma es exacta,
  `{"version":1,"variables":{…},"secretos":{…}}`, y solo admite esta lista cerrada:
  - variables no secretas, que van a Wrangler con `--var`: `FARO_ADMIN_ACCESS_CUENTA`, `FARO_ADMIN_ACCESS_GRUPO`,
    `FARO_ADMINISTRADORES_INICIALES`, `FARO_ADMIN_EXIGIR_MFA` y `FARO_ACTUALIZACION_DEMANDA` (un JSON en texto, con la
    forma de [la configuración](../../docs/configuracion.md));
  - el secreto `FARO_ADMIN_ACCESS_TOKEN`, que viaja con `--secrets-file` en un archivo temporal propio, con permisos
    `0600` en una carpeta `0700` fuera del producto y de la entrega, que se borra al terminar, también si Wrangler
    falla. Wrangler lo añade a los secretos que ya hay y no borra los demás.

  Cada valor se valida con el mismo lector que usa el Worker antes de llamar a Wrangler; un nombre fuera de la lista o
  un valor que el Worker rechazaría detiene la orden sin contactar con Cloudflare, y el mensaje nombra la variable sin
  repetir su valor. El secreto nunca aparece en los argumentos, el entorno, los registros ni el recibo; el recibo
  añade `privadas` solo con los nombres puestos, por ejemplo
  `"privadas":{"variables":["FARO_ADMIN_EXIGIR_MFA"],"secretos":["FARO_ADMIN_ACCESS_TOKEN"]}`. Ejemplo sin valores
  reales (los identificadores son ceros y el token es un texto para sustituir):

  <!-- privadas.example -->
  ```json
  {
    "version": 1,
    "variables": {
      "FARO_ADMIN_ACCESS_CUENTA": "00000000000000000000000000000000",
      "FARO_ADMIN_ACCESS_GRUPO": "00000000-0000-0000-0000-000000000000",
      "FARO_ADMINISTRADORES_INICIALES": "persona@entidad.example",
      "FARO_ADMIN_EXIGIR_MFA": "no",
      "FARO_ACTUALIZACION_DEMANDA": "{\"version\":1,\"habilitada\":false,\"actores\":[],\"separacionMin\":60,\"maxDia\":4,\"maxMes\":{\"actualizar-datos\":30,\"comprobar-vencidas\":30,\"actualizar-cursos\":30},\"presupuestoMinMes\":2000,\"reservaProgramadaMin\":30}"
    },
    "secretos": {
      "FARO_ADMIN_ACCESS_TOKEN": "SUSTITUIR-POR-EL-TOKEN-DE-LA-API-DE-CLOUDFLARE"
    }
  }
  ```

  ```sh
  node herramientas/cloudflare/desplegar.ts ensayar --entorno produccion --servicio principal --sha256 "$SHA256_ARTEFACTO" --privadas "$PRIVADAS_PRODUCCION"
  node herramientas/cloudflare/desplegar.ts publicar --entorno produccion --servicio principal --sha256 "$SHA256_ARTEFACTO" --instalacion "$REGISTRO_PRODUCCION" --privadas "$PRIVADAS_PRODUCCION"
  ```
- El dominio de producción no lo cambia esta orden. Se asocia con la operación de dominio de la entidad y se
  comprueba antes y después.

## Instalación nueva y actualización

El registro de instalación es un archivo privado de la entidad: declara el estado remoto ya verificado de un entorno.
No contiene credenciales y la orden no consulta la cuenta para crearlo. La plantilla
[`instalacion.example.json`](instalacion.example.json) describe el primer ensayo. Además de los Workers, declara:

- `origen`: la dirección pública exacta, sin ruta ni barra final. En producción, `https://` y el dominio de `routes`;
  en ensayo, `https://<Worker de ensayo>.<subdominio de la cuenta>.workers.dev`. La plantilla deja el subdominio por
  completar y no se admite hasta declararlo. Los parámetros de Access del ensayo y las pruebas remotas del portal solo
  se dirigen a ese origen. Lo declara quien opera: la orden comprueba su coherencia con la configuración y con Access,
  no la identidad remota de la cuenta.
- `tipo: "nueva"`, sin migraciones aplicadas: la primera publicación del principal crea su almacén con la migración
  inicial. La orden se detiene hasta que se nombra con `--aplicar-migracion <etiqueta>`.
- `tipo: "existente"`, con las migraciones ya aplicadas, completas y en orden: etiqueta y operación, tal como figuran
  en `migrations`. La configuración debe empezar exactamente por ese historial; una etiqueta igual con otra operación
  se rechaza. Una migración nueva solo se aplica nombrándola, y como mucho una por publicación. Después de aplicarla,
  la entidad añade esa migración a su registro.

Los Workers del registro deben ser los configurados. Cambiar `name` en la configuración no es cosmético: crea otro
Worker y otro almacén vacío. Para producción, el registro privado de esta instalación es `existente`, con `faro-pruebas`,
`faro-pruebas-cursos`, el origen `https://faroapp.org` y la migración
`{"tag":"faro-pruebas-inicial-v1","new_sqlite_classes":["AccesoPublicoDurable"]}`, una vez confirmado ese historial en
la cuenta. El registro es una declaración verificada por quien opera, no una prueba remota. Los Workers se renombran
en el sitio según el [renombrado de Workers](../../docs/migracion-workers.md), que exige comprobar antes en el ensayo
que se conservan los datos y los recursos. El historial admite varias
migraciones: crear clases SQLite, renombrarlas o transferirlas desde otro Worker, una operación por etiqueta. Nunca
admite borrar una clase, crear clases sin SQLite ni crear la clase antes de transferirla. Las órdenes de esta entrega
no borran Workers, almacenes, bindings ni secretos.

## Worker de Cursos

El motor de cursos va en un segundo Worker, con su entrada `src/plataforma/cloudflare/worker-cursos.ts`. En esta
instalación es `faro-pruebas-cursos` en producción y `faro-ensayo-cursos` en ensayo; la plantilla
`wrangler.cursos.example.jsonc` lo llama `faro-cursos`. El principal lo llama por el service binding `CURSOS`
(`"services": [{ "binding": "CURSOS", "service": "faro-cursos" }]`) y no lleva el motor. Cada Worker corre en su
isolate con su propio tope de CPU: un bucle del motor de cursos no detiene al motor de ocupaciones, y el informe sale
con su aviso ([motores/cursos/README.md](../../motores/cursos/README.md)). El Worker de Cursos no tiene URLs públicas,
rutas, recursos ni almacenes; usa la misma fecha y las mismas banderas de compatibilidad que el principal.

La compilación genera los dos: el principal en la raíz y el de Cursos en `cursos/` (`cursos/worker.mjs` y sus
módulos `cursos/datos/`). La entrega los guarda en `worker/` y `worker-cursos/`. `npm run cloudflare:comprobar` da las cifras de ambos. Publicar los dos y crear el binding
necesitan la cuenta de la entidad: el de Cursos se sube antes que el principal, para que el binding encuentre su
servicio (con la orden de [Desplegar](#desplegar), primero `--servicio cursos` y después `principal`). Sin el binding, si el de Cursos
no está o si lleva otro paquete que el principal, el principal sigue sirviendo todo menos la formación: cada Worker
lleva la huella de su paquete y no se combinan datos de dos versiones. En el plan gratuito el tope de CPU por invocación es
corto. Con un plan de pago, `limits.cpu_ms` fijaría el del Worker de Cursos sin cambiar el del principal, pero el
perfil de despliegue no admite hoy `limits`: hay que ampliarlo en una revisión antes de usarlo.

La activación automática publica también este Worker, antes que el principal
([actualización remota](../../docs/actualizacion-remota.md#activar-el-candidato-validado)). Lee su configuración del
secreto del repositorio `FARO_CLOUDFLARE_CURSOS_CONFIGURACION_JSON`, en JSON estricto: la configuración real del
Worker de Cursos de la instalación, que parte de `wrangler.cursos.example.jsonc` con su `account_id`. El adaptador
de versiones (`herramientas/cloudflare/perfil-versiones.ts`) le aplica un perfil cerrado: solo admite `$schema`,
`name`, `account_id`, `main`, `base_dir`, `compatibility_date`, `compatibility_flags` con
`global_fetch_strictly_public`, `workers_dev: false`, `preview_urls: false`, las reglas Data del producto,
`placement` y `observability`. Una configuración con recursos, almacenes, variables, rutas, horarios, enlaces del
principal o `limits` (que el perfil de despliegue tampoco admite) se rechaza antes de cualquier efecto. El binding
`CURSOS` de la configuración del principal tiene que apuntar a su `name`, distinto del principal: es la misma regla
de la publicación a mano. El adaptador solo cambia `main` y `base_dir` para apuntar a `worker-cursos/` del artefacto
verificado.

## Enrutamiento y datos

`run_worker_first: true` hace que las solicitudes pasen por Faro antes de servir archivos.
Es necesario para proteger el panel y sus recursos. `html_handling: none` y
`not_found_handling: none` conservan las rutas exactas: no se redirigen páginas ni se devuelve
una página pública como alternativa a una ruta privada inexistente.
Una dirección que no existe la contesta el propio Worker: la carga de una página recibe un 404 con
`web/no-existe.html` y lo demás, el 404 sin cuerpo (`src/plataforma/cloudflare/pagina-no-existe.ts`).

Los JSON oficiales se incorporan como módulos `Data`, separados del código. El lector del
paquete comprueba y consume sus bytes. No cambiar esta regla por una inclusión del JSON como
texto de JavaScript sin revisar el lector y medir el arranque y la memoria.

## Estado persistente y configuración de la entidad

La plantilla incluye `version_metadata` con el binding `CF_VERSION_METADATA`. Cloudflare proporciona
en él el identificador de la versión que ejecuta cada petición. No se introduce un identificador
manual en el código ni se deduce de la versión `1.0.0` de Faro. La
[lectura privada de mantenimiento](../../docs/actualizacion-remota.md#observar-la-construcción-servida)
permite consultarlo con la identidad autorizada del workflow; no concede permiso de despliegue.
Una instalación existente debe conservar este binding además de su configuración propia.

La plantilla nueva declara `REGISTRO_SOCIOS`, con la clase `AccesoPublicoDurable` y su migración
inicial SQLite. Este almacén conserva socios, cuotas, revocaciones, controles y la autoridad administrativa.
La plantilla no es una migración de instalaciones anteriores ni acredita su compatibilidad. Para actualizar
una instalación existente se revisan por separado su historial, clases y bindings
([instalación nueva y actualización](#instalación-nueva-y-actualización)); esta entrega no incluye
órdenes para borrar namespaces o registros. El adaptador de versiones rechaza bindings que no corresponden
a las clases de esta entrega y no transforma la configuración de la entidad.

La entidad configura su cuenta, dominio, variables y secretos mediante el alojamiento.
La plantilla no incluye esos valores ni publica direcciones de prueba. Las credenciales y
claves de firma permanecen fuera de `web/`, del repositorio y de la configuración pública.
El panel requiere además [Cloudflare Access y su autorización en Faro](../../docs/administracion.md).

Antes de habilitar una instalación se comprueban sus bindings, las reglas de Access,
las cabeceras, las firmas y el comportamiento real del Worker. Una compilación correcta
por sí sola no acredita esos controles del alojamiento.

## Programación de actualizaciones

Las plantillas que se compilan no instalan un horario, porque no admiten variables de la entidad.
`programacion.example.jsonc` trae el ejemplo que hay que añadir a la configuración completa de la entidad:

```json
{
  "triggers": { "crons": ["15 4 * * *"] },
  "vars": {
    "FARO_ACTUALIZACION_PROGRAMADA": "{\"version\":1,\"habilitada\":true,\"cron\":\"15 4 * * *\"}"
  }
}
```

El horario está en UTC y debe coincidir en ambos lugares: un único minuto y una hora concretos, sin listas,
rangos ni ceros iniciales. La variable puede declararse también como variable del alojamiento con el mismo texto.

Aprovisionar el trigger mediante el alojamiento o `wrangler triggers deploy` con esa configuración completa.
`versions upload` y `versions deploy` no instalan el horario. El adaptador de versiones conserva y valida
el campo `triggers`; no aplica ese cambio de infraestructura durante cada actualización de datos.
Una variable ausente o deshabilitada impide reservar trabajos aunque siga llegando el evento del alojamiento.

Comprobar la [configuración y el circuito remoto](../../docs/actualizacion-remota.md#programación-diaria)
en la cuenta de la entidad antes de declararlo operativo. El cron solo inicia la comprobación: el permiso
de ejecución, la admisión de datos y la confirmación de la versión servida siguen siendo independientes.
