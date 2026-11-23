# Operación local

El servidor Node compone la API y sirve la web local construida en `.web-local/`, no las fuentes de `web/`,
escuchando exclusivamente en `127.0.0.1`. Si esa web falta o sus fuentes han cambiado, la construye antes de escuchar,
igual que `npm run web:preparar`; solo lo comprueba al arrancar, así que tras editar las fuentes hay que volver a
lanzarlo. Requiere la versión de Node indicada en el [README](../README.md). El recorrido utiliza los motores
locales;
las consultas de datos y los informes no requieren un proveedor externo de inferencia.

```sh
npm run servir
```

El puerto predeterminado es 8787. Para cambiarlo en macOS o Linux:

```sh
FARO_PUERTO=8790 npm run servir
```

Para ejecutarlo desde otra carpeta, usar la ruta del programa entre comillas:

```sh
node "/ruta con espacios/faro/herramientas/servidor/servidor-local.ts"
```

Las rutas del paquete canónico y de los recursos web se calculan desde los módulos de la instalación.
No necesitan un enlace hacia otra copia del proyecto. El perfil privado del servicio se selecciona como
se describe en «Configuración».
El paquete canónico está en `datos/`; la captura web de datos globales se genera con `npm run globales:generar`.

## Configuración

Si se necesita un perfil local, copiar [.dev.vars.example](../.dev.vars.example) como `.dev.vars` en la raíz.
`FARO_PERFIL=local` selecciona `.dev.vars.local` en esa misma raíz. Los perfiles privados quedan fuera de Git.
El servidor admite solo su lista explícita de opciones del proceso; el perfil prevalece para una opción presente
en ambas vías. Los ajustes disponibles y sus lectores están en el [índice de configuración](configuracion.md).

MCP, A2A y la API institucional se entregan apagados. Habilitar un canal requiere preparar la
[administración](administracion.md), su identidad y su almacén persistente. Los valores `FARO_MCP`, `FARO_A2A`
y `FARO_API_SOCIOS` solo inicializan una instalación nueva; después se usan los interruptores del panel.
Las [invitaciones institucionales](conectividad.md) entregan las credenciales de la API. MCP y A2A sirven
consultas públicas sin clave. Habilitar un servicio no lo despliega ni acredita su acceso desde otro equipo.

Con [administración habilitada](administracion.md), la política durable controla la conectividad y las secciones.
Los valores iniciales del entorno no sobrescriben los cambios adoptados en el almacén al reiniciar.
El panel no selecciona modelos ni registra o rota claves de proveedores de inferencia. Los documentos durables,
sus revisiones, credenciales y recibos se conservan: dejar de ofrecer una capacidad no autoriza borrarlos.

La configuración básica de acceso para socios se valida antes de arrancar: un error no se sustituye por acceso
abierto. Access, las sesiones administrativas y los límites del servicio conservan sus comprobaciones independientes.
La configuración local no instala ni acredita las protecciones del alojamiento remoto.

## Contacto de seguridad

- `FARO_SEGURIDAD_CONTACTO`: dirección `mailto:` o página HTTPS del responsable.
- `FARO_SEGURIDAD_POLITICA`: página HTTPS de la política; si falta, el campo se omite.
- `FARO_SEGURIDAD_CADUCA`: fecha de caducidad del archivo `security.txt`, con zona horaria si incluye hora.

No hay contacto preasignado. Sin `FARO_SEGURIDAD_CONTACTO`, o si no contiene una dirección admitida,
`/.well-known/security.txt` responde 404 sin caché. Al configurar un contacto válido, publica ese contacto y
la caducidad indicada; si falta una caducidad válida, utiliza la fecha fija documentada en el
[generador](../src/plataforma/seguridad-txt.ts), que debe revisarse al publicar. La
[política de seguridad](../SECURITY.md) describe la responsabilidad de la entidad que despliega la aplicación.

## Disponibilidad de la web

El servidor ofrece la API local y la web/PWA construida en `.web-local/web`, con el motor del navegador, su manifiesto
y la copia sin conexión, según la [guía de construcción](construccion-web.md). Si falta o sus fuentes han cambiado,
`npm run servir` la construye antes de escuchar (`npm run web:preparar` lo hace sin arrancar el servidor); no
despliega el Worker. Es una preparación local a partir del código y los datos incluidos.
Si la web servida no lleva el motor del navegador, el arranque lo advierte. La disponibilidad de la API de datos se
comprueba
independientemente de ese recurso.

## Recorrido local

El recorrido usa los motores locales; no hay una opción para activar inferencia externa ni es necesario configurar
un proveedor para utilizarlo. El servidor prepara la configuración pública correspondiente sin incluir secretos.
El funcionamiento sin conexión requiere los artefactos del motor y una copia local completa y comprobada,
según la [guía de construcción](construccion-web.md). Arrancar el servidor no acredita esa instalación sin conexión.

## Preparar la instalación en detalle

El [README](../README.md#empezar) resume los pasos. Este apartado explica cada requisito.

### Intérpretes y SQLite

Se requiere Node de la rama 24 desde 24.22.3 y Python de la rama 3.12 desde 3.12.15 en versión final.
El catálogo y las búsquedas de ocupaciones usan el SQLite de Python. El almacén administrativo local usa el
SQLite de Node. Ambos requieren SQLite 3.54.1 o posterior con FTS5. El mantenimiento usa
macOS ARM64 o Linux x86_64; otras plataformas requieren comprobación propia. Las dependencias pertenecen a esta
instalación y no deben enlazarse a entornos de otro proyecto.

En macOS ARM64 se puede preparar un intérprete privado si el Python de la instalación incluye un SQLite anterior.
El preparador parte de CPython 3.12.15 de `python-build-standalone` y utiliza las herramientas de compilación de
Apple. Descarga las [fuentes de Python 3.12.15](https://www.python.org/downloads/release/python-31215/) y la
amalgamación desde la dirección que imprime la primera orden. El preparador verifica ambos archivos. El último
argumento es el directorio permanente donde los entornos de Faro encontrarán su biblioteca.

```sh
python3.12 -I herramientas/mantenimiento/fuente-sqlite.py
python3.12 -I herramientas/mantenimiento/preparar-python-macos.py \
  "$HOME/Downloads/Python-3.12.15.tar.xz" "$HOME/Downloads/sqlite-amalgamation-3540100.zip" \
  "$HOME/.local/share/faro/python/3.12.15-sqlite-3.54.1"
```

La distribución oficial de Node 24.22.3 incorpora SQLite 3.54.1. Si se instala de forma privada en
`~/.local/share/faro/node/v24.22.3`, para usar ambos intérpretes en la terminal del proyecto se ejecuta
`export PATH="$HOME/.local/share/faro/node/v24.22.3/bin:$HOME/.local/share/faro/python/3.12.15-sqlite-3.54.1/bin:$PATH"`.
El actualizador de GitHub prepara sus propios intérpretes en cada ejecución. [Distribuciones oficiales de Node](https://nodejs.org/dist/v24.22.3/)

### Dependencias

`export npm_config_update_notifier=false` evita que npm consulte su registro para anunciar versiones nuevas, una
consulta de red que ni la instalación ni la verificación necesitan. Vale, en bash y en zsh, para las órdenes que se
escriban después en esa misma terminal; en una terminal nueva hay que repetirla.

El preparador Python (`plataforma_datos.orquestacion.preparar_dependencias`) crea una `.venv` nueva; no sustituye una
existente. Comprueba las ruedas y sus huellas fijadas en `config/dependencias-python.lock.json` antes de instalarlas
sin red mediante pip. La [confianza TLS](confianza-tls.md) utiliza certificados explícitos y una semilla oficial
comprobada. `requirements.txt` fija las dependencias de mantenimiento y `requirements-dev.txt` añade las de
verificación.

La instalación de los navegadores de Playwright empieza con `env -i`, que deja fuera el resto del entorno, salvo
`PLAYWRIGHT_BROWSERS_PATH` si está definida: esa variable indica dónde se instalan los navegadores, y la verificación
y los ensayos la transmiten al buscarlos, así que la instalación tiene que usar la misma carpeta. Es la misma orden
que la [comprobación en navegadores](../pruebas/navegadores/README.md).

### Base ESCO en la integración continua y en la verificación

El workflow de calidad obtiene la base preparada desde la release privada `datos-verificacion` del repositorio.
El activo `esco-<sha256-de-la-base>.zip` contiene `biblioteca-esco.sqlite` y su `validacion.json`. El job
usa su permiso temporal de lectura del repositorio. Antes de instalar ambos archivos comprueba la integridad
del ZIP, la huella de la base declarada en `datos/manifiesto.json` y la de la captura fijada en `captura.sha256`.

La etapa «Base ESCO local», la primera de `npm run verificar` y de `npm test`, comprueba el resultado: la base
tiene que ser un archivo propio de esta instalación, no un enlace simbólico ni duro, y su huella tiene que coincidir
con la que fija `datos/manifiesto.json`. Un enlace duro no es una base propia: comparte el mismo archivo con otra
instalación. Una copia sí lo es, también un clon de APFS (`cp -c`), que se modifica con independencia del original.
Además, el informe `var/actualizacion/validados/esco/validacion.json` que escribe `lector validar` tiene que ser
también un archivo propio y registrar esa misma base y la captura que fija `captura.sha256`. Si falta algo o alguna
huella no coincide, la verificación falla y explica qué hacer; nunca omite la comprobación.

La orden `.venv/bin/python -m plataforma_datos.ocupaciones.fuentes.esco.lector descargar` obtiene una captura nueva
de la API: es una actualización de datos, no reproduce necesariamente la huella fijada y no sirve para comprobar
esta entrega. La [fuente ESCO](../plataforma_datos/ocupaciones/fuentes/esco/README.md) describe su alcance y su
licencia.
