# Renombrar los Workers de producción a `faro` y `faro-cursos`

Esta guía describe el procedimiento para renombrar los Workers de producción que declara la configuración
(`faro-pruebas` y `faro-pruebas-cursos`, con la migración `faro-pruebas-inicial-v1` y el dominio `faroapp.org`) a
`faro` y `faro-cursos` sin perder su almacén. El renombrado se hace con la entrega ya publicada, tras un ensayo previo
y con la autorización expresa de la entidad para cada paso remoto. El nombre interno de un Worker no lo ve quien usa
Faro: no hace falta renombrar para que la instalación se presente como oficial.

## Renombrar no es cambiar `name`

Cambiar `name` en `config/cloudflare/instalaciones/wrangler.produccion.jsonc` no renombra el Worker: crea otro, con un almacén Durable Object vacío.
Socios, cuotas, sesiones, revocaciones, controles y la autoridad administrativa de `REGISTRO_SOCIOS` se quedarían en
`faro-pruebas`. La orden de despliegue lo impide: publicar exige el registro de la instalación (`--instalacion`), y
una configuración con otros nombres que los del registro se rechaza («corresponde a otros Workers»). Véase la
[configuración de Cloudflare](../config/cloudflare/README.md#instalación-nueva-y-actualización).

El renombrado se hace en el sitio, con la API de Workers. Cada Worker tiene un identificador inmutable y un nombre
que se puede cambiar sin recrearlo
([novedades de la API de Workers](https://developers.cloudflare.com/changelog/2025-09-03-new-workers-api)). La
operación es [«Edit Worker»](https://developers.cloudflare.com/api/resources/workers/subresources/beta/subresources/workers/methods/edit/):
un `PATCH` parcial que cambia solo los campos enviados. No se usa «Update Worker» (`PUT`), que restablece los campos
omitidos. La API está en beta: antes de operar se comprueba la referencia vigente.

La documentación oficial trata el renombrado como una acción sobre el mismo Worker: los roles Editor y Admin pueden
renombrar Workers existentes ([permisos de Workers](https://developers.cloudflare.com/workers/authorization/workers/)).
No dice qué ocurre con el almacén Durable Object, el dominio propio, las rutas, los enlaces de servicio (bindings) entre
Workers, los secretos ni los horarios. Esos puntos no están acreditados. El enlace `REGISTRO_SOCIOS` no lleva
`script_name`, así que apunta a la clase del propio Worker ([Durable Objects y
entornos](https://developers.cloudflare.com/durable-objects/reference/environments/)). Que tras el renombrado siga
llegando a los mismos objetos es lo primero que se comprueba en el ensayo. Si algún punto no se conserva en el ensayo,
producción no se renombra.

## Qué cambia y qué se conserva

Cambian de nombre:

- `config/cloudflare/instalaciones/wrangler.produccion.jsonc`: `name` pasa a `faro` y el servicio `CURSOS` a `faro-cursos`;
- `config/cloudflare/instalaciones/wrangler.produccion-cursos.jsonc`: `name` pasa a `faro-cursos`;
- el registro privado de producción: `worker` y `cursos`;
- si la activación automática está configurada, los secretos del repositorio `FARO_CLOUDFLARE_CONFIGURACION_JSON`, con
  el mismo `name` y el mismo servicio que `config/cloudflare/instalaciones/wrangler.produccion.jsonc`, y
  `FARO_CLOUDFLARE_CURSOS_CONFIGURACION_JSON`, con el mismo `name` que
  `config/cloudflare/instalaciones/wrangler.produccion-cursos.jsonc`
  ([actualización remota](actualizacion-remota.md#activar-el-candidato-validado)).

Configuración de destino de `config/cloudflare/instalaciones/wrangler.produccion.jsonc`; los demás campos no cambian:

```json
{
  "name": "faro",
  "services": [{ "binding": "CURSOS", "service": "faro-cursos" }]
}
```

Registro privado de producción después del renombrado. Solo cambian los Workers:
`{"version":1,"entorno":"produccion","tipo":"existente","worker":"faro","cursos":"faro-cursos","origen":"https://faroapp.org","migraciones_aplicadas":[{"tag":"faro-pruebas-inicial-v1","new_sqlite_classes":["AccesoPublicoDurable"]}]}`.

No cambia la migración `faro-pruebas-inicial-v1`, ni en `migrations` ni en el registro: es historial aplicado y no se
reescribe.

Deben conservarse, y se comprueban en el ensayo y después en producción, porque la documentación oficial no lo
garantiza:

- los objetos del almacén `REGISTRO_SOCIOS`;
- el dominio `faroapp.org`, su certificado y la aplicación de Access del panel;
- los secretos, el enlace de servicio `CURSOS` y el horario programado.

Producción no usa workers.dev. En el ensayo, la dirección workers.dev lleva el nombre del Worker y cambia con él.

## Condiciones previas

1. **Entrega publicada y comprobada** con los nombres actuales.
2. **Ensayo del renombrado** en `faro-ensayo` y `faro-ensayo-cursos`, con datos sintéticos. Renombrarlos con la misma
   secuencia y comprobar en la dirección nueva: los mismos objetos del almacén (una sesión y un control creados antes),
   los secretos, el enlace de servicio `CURSOS`, el identificador sin cambios y la reversión al nombre anterior.
3. **Token de la entidad** con permiso de edición de Workers, desde su custodia privada. Antes de leerlo se ejecuta
   `unset TOKEN`: si la variable ya existiera exportada, `read` conservaría ese atributo y curl la heredaría. Después se
   lee con `read -rs` en una variable de la shell que no se exporta: no se muestra ni queda en el historial, y ningún
   proceso hijo la hereda. curl lo recibe en su configuración por la entrada estándar (`--config -`), escrita por
   `printf`, que es una orden interna de bash y zsh. Así no aparece en los argumentos de ningún proceso ni en su
   entorno. La shell no debe tener activadas las trazas (`set -x`), que mostrarían la cabecera con el token. Al
   terminar, `unset TOKEN`. El identificador de la cuenta (`CLOUDFLARE_ACCOUNT_ID`) no da acceso por sí solo, pero no
   se publica: en GitHub es un secreto. Estas órdenes no protegen frente a quien controle ya la sesión o el equipo de
   quien opera.
4. **Ventana de mantenimiento anunciada**, sin publicaciones con la configuración anterior. No se promete continuidad
   del servicio durante la ventana (ver el paso 2 de la secuencia).
5. **Actualización automática detenida y sin trabajos pendientes**, si está configurada. `FARO_ACTIVACION_AUTOMATICA`
   existe en dos ubicaciones, la variable del Worker principal y la variable del repositorio de GitHub
   ([activar el candidato validado](actualizacion-remota.md#activar-el-candidato-validado)), y las dos se ponen en `no`.
   Apagar una sola no detiene un trabajo ya iniciado. Antes de renombrar se comprueba que no queda nada en marcha:
   - en el panel, «Consultar o seguir trabajo» no muestra una solicitud incierta ni un trabajo en curso
     ([trabajo de actualización](administracion.md#trabajo-de-actualización));
   - «Consultar activación registrada» no muestra una activación en reserva, preparación, subida ni promoción
     ([registro de activación](administracion.md#registro-de-activación));
   - en GitHub Actions, el workflow `actualizar.yml` no tiene ejecuciones en cola ni en curso.

   Si queda algo en marcha, se espera a su resultado final o se resuelve con las acciones del panel; no se renombra
   con un trabajo o una activación pendientes.

## Secuencia

Renombrado, configuración y registro van en la misma ventana. Entre el renombrado y el cambio de configuración, una
publicación con la configuración anterior crearía otro `faro-pruebas` vacío.

1. Anotar el identificador y el nombre de cada Worker:

   ```sh
   set +x
   unset TOKEN
   read -rs TOKEN
   cf() { printf 'header = "Authorization: Bearer %s"\n' "$TOKEN" | curl --config - --fail --silent --show-error "$@"; }
   API="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/workers"
   cf "$API/faro-pruebas-cursos"
   cf "$API/faro-pruebas"
   ```

2. Renombrar primero Cursos y después el principal, cada uno por su identificador:

   ```sh
   cf --request PATCH --header "Content-Type: application/json" --data '{"name":"faro-cursos"}' "$API/$ID_CURSOS"
   cf --request PATCH --header "Content-Type: application/json" --data '{"name":"faro"}' "$API/$ID_PRINCIPAL"
   ```

   La versión desplegada del principal declara el servicio `CURSOS` con el nombre anterior. Desde que se renombra Cursos
   hasta que se vuelve a publicar el principal (paso 6), la búsqueda de cursos puede dejar de responder. Por eso todo
   va dentro de la ventana de mantenimiento, con la reversión ensayada a mano. El ensayo dice si esa interrupción
   ocurre, y su duración se reduce publicando sin pausa entre los pasos 2 y 6.

3. Comprobar con `cf` que los identificadores no han cambiado y que `faroapp.org` responde: portada, recorrido, una
   sesión anterior válida y el panel con Access. Después, `unset TOKEN`.
4. Aplicar en una revisión la configuración de destino, el nuevo `config/cloudflare/instalaciones/wrangler.produccion-cursos.jsonc` y el registro
   privado. Si existen, actualizar también `FARO_CLOUDFLARE_CONFIGURACION_JSON` y
   `FARO_CLOUDFLARE_CURSOS_CONFIGURACION_JSON`.
5. Comprobar sin publicar:
   `node herramientas/cloudflare/desplegar.ts comprobar --entorno produccion --servicio principal --sha256 "$SHA256_ARTEFACTO" --instalacion "$REGISTRO"`.
   El recibo debe indicar `worker: "faro"` y `migracionPendiente: null`.
6. Volver a publicar la misma entrega con los nombres nuevos, Cursos antes que el principal:
   `node herramientas/cloudflare/desplegar.ts publicar --entorno produccion --servicio cursos --sha256 "$SHA256_ARTEFACTO" --instalacion "$REGISTRO"`
   y
   `node herramientas/cloudflare/desplegar.ts publicar --entorno produccion --servicio principal --sha256 "$SHA256_ARTEFACTO" --instalacion "$REGISTRO"`.
   La publicación se dirige al Worker renombrado por su nombre nuevo. El ensayo comprueba que no se crea otro Worker
   ni se aplica ninguna migración: mismo identificador y `migracionPendiente: null`.
7. Verificar en el dominio: certificado, cabeceras, Access del panel, una sesión anterior válida, una cookie revocada
   rechazada, cuota agotada (429), recorrido ES/CA, informes, el horario programado y la versión servida frente al
   recibo. Después, si estaba configurada, se restaura `FARO_ACTIVACION_AUTOMATICA=si` en sus dos ubicaciones, con
   `FARO_CLOUDFLARE_CONFIGURACION_JSON` y `FARO_CLOUDFLARE_CURSOS_CONFIGURACION_JSON` ya actualizados.

## Reversión

La reversión prevista es renombrar de nuevo a `faro-pruebas` y `faro-pruebas-cursos`, volver a la revisión anterior de
la configuración, del registro y, si existen, de `FARO_CLOUDFLARE_CONFIGURACION_JSON` y
`FARO_CLOUDFLARE_CURSOS_CONFIGURACION_JSON`, y volver a publicar la misma
entrega. Devolver el nombre no acredita por sí solo que el almacén, el dominio, los enlaces, los secretos y los
horarios vuelvan a su estado. La reversión completa solo se da por válida si el ensayo la comprueba con las mismas
verificaciones que el renombrado.

Una reversión de código es otra cosa: no restaura datos SQLite, secretos, rutas ni políticas de Access. Una versión
con sesiones revocables solo se revierte a otra que consulte la misma autoridad de revocación: una versión que solo
valida la firma puede volver a aceptar cookies revocadas. La recuperación conserva el modo, la revisión, la cuota (429) y el rechazo de una cookie revocada con los
[códigos de estado del acceso](configuracion.md#códigos-de-estado-del-acceso): 303 a la pantalla de acceso al cargar
una página y 403 en lo demás. Comprobarlo en workerd local no acredita un espacio de nombres (namespace) real de
Durable Objects en Cloudflare.

## Transferencia de clase, solo si el renombrado no está disponible

Si la cuenta no admitiera el renombrado en el sitio, la alternativa es otro Worker que reciba el almacén con una
migración `transferred_classes` desde `faro-pruebas`
([migraciones de clases](https://developers.cloudflare.com/durable-objects/reference/durable-object-class-migrations-legacy/)).
Mueve los datos, no admite volver atrás con una reversión
([reversiones y enlaces](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/#bindings)),
exige aprovisionar los secretos en el Worker nuevo e invalidar las sesiones si cambia `FARO_SECRETO_FIRMA`, y su propio
ensayo. Los validadores admiten esa forma (una transferencia desde otro Worker que termina en `AccesoPublicoDurable`)
y rechazan crear la clase antes de transferirla, transferir desde el propio Worker o desde el ensayo, y borrar clases.

Configuración de destino de esa alternativa en `config/cloudflare/instalaciones/wrangler.produccion.jsonc`; los demás campos no cambian:

```json
{
  "name": "faro",
  "migrations": [
    {
      "tag": "faro-transferencia-v1",
      "transferred_classes": [{ "from": "AccesoPublicoDurable", "from_script": "faro-pruebas", "to": "AccesoPublicoDurable" }]
    }
  ],
  "services": [{ "binding": "CURSOS", "service": "faro-cursos" }]
}
```

Su registro privado describe un Worker nuevo, sin migraciones aplicadas:
`{"version":1,"entorno":"produccion","tipo":"nueva","worker":"faro","cursos":"faro-cursos","origen":"https://faroapp.org","migraciones_aplicadas":[]}`.
La comprobación previa debe indicar `migracionPendiente: "faro-transferencia-v1"`, y publicar el principal exige
nombrarla con `--aplicar-migracion faro-transferencia-v1`.

## Lo que no se hace

- No se borra ningún Worker, clase, espacio de nombres, enlace ni secreto.
- No se cambia `name` en la configuración sin haber renombrado antes el Worker.
- No se usa `PUT` para renombrar.
- No se copian valores de secretos ni se muestran en órdenes, archivos o registros.
