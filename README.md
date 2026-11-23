# Faro

## Qué es Faro

Faro es una aplicación web de orientación laboral. Una persona describe con sus palabras a qué se dedica; Faro
identifica su ocupación en la clasificación europea ESCO y le muestra sus tareas para que elija las que hace. Para
cada tarea estima, con las referencias publicadas por la Organización Internacional del Trabajo, cuánto puede
cambiarla la inteligencia artificial, y le propone formación gratuita y vigente con la que prepararse. Todo el cálculo
se hace en su propio dispositivo, con una copia comprobada de los datos: no hace falta cuenta y lo que la persona
escribe no se envía a ningún servidor. Faro también funciona sin conexión una vez guardada esa copia.

Faro no predice si alguien perderá su empleo ni evalúa a las personas: describe cómo puede cambiar el trabajo y qué
formación ayuda a prepararse.

## Cómo está construido, en una imagen

```text
  Dispositivo de la persona                         Alojamiento (Cloudflare)
 ┌──────────────────────────────────────┐          ┌──────────────────────────────────┐
 │ Páginas web (web/)                   │  pide    │ Worker principal                 │
 │   └─ recorrido: conversación y pasos │  web y   │   web, paquete de datos, API,    │
 │ Service worker (src/service-worker/) │  datos   │   MCP/A2A, panel y tarea diaria  │
 │   └─ copia sin conexión con huellas  │ ───────► │   (src/plataforma/cloudflare/)   │
 │ Worker dedicado (motor-local/)       │          │ Worker de Cursos (binding CURSOS)│
 │   └─ motor en el dispositivo:        │          └────────────────┬─────────────────┘
 │      ocupaciones, informe, formación │                           │ datos publicados
 └──────────────────────────────────────┘          ┌────────────────┴─────────────────┐
                                                   │ Plataforma de datos (Python)     │
                                                   │   fuentes oficiales → validación │
                                                   │   → paquete con huellas (datos/) │
                                                   └──────────────────────────────────┘
```

El navegador descarga la web y el paquete de datos, y el service worker los guarda con su huella. El recorrido
pregunta a un Worker dedicado que ejecuta en el dispositivo el mismo motor que el servidor: búsqueda de la ocupación,
informe y plan de formación. El alojamiento sirve archivos y ofrece servicios aparte (API para entidades, MCP, A2A y
panel de administración), que no intervienen en el recorrido de la persona. La plataforma de datos lee las fuentes
oficiales, las valida y produce el paquete que consumen los motores. La [arquitectura](docs/arquitectura.md) explica
cada pieza y el recorrido completo de una consulta.

## Mapa de carpetas

| Carpeta | Qué contiene | Lenguaje |
| --- | --- | --- |
| [`web/`](web/README.md) | Páginas, estilos, textos en castellano y catalán, y módulos de la interfaz. | HTML, CSS, JavaScript con JSDoc |
| [`src/`](src/README.md) | Dominio del informe, presentación, API, service worker y adaptadores a navegador, Node y Cloudflare. | TypeScript |
| [`motores/`](motores/README.md) | Motores independientes de ocupaciones (sellado) y de cursos, con sus pruebas. | TypeScript |
| [`compartido/`](compartido/README.md) | Contratos y utilidades que comparten los motores y la aplicación. | TypeScript |
| [`plataforma_datos/`](plataforma_datos/README.md) | Lectores de cada fuente, contratos, vigencia y orquestación de la actualización. | Python |
| [`datos/`](datos/README.md) | Paquete de datos generado y comprobado que leen los motores. No se edita a mano. | JSON |
| [`herramientas/`](herramientas/README.md) | Órdenes de construcción, generación, despliegue y mantenimiento. | TypeScript, Python |
| [`scripts/`](scripts/README.md) | Arnés de verificación: etapas, plazos y resumen de pruebas. | TypeScript |
| [`pruebas/`](pruebas/README.md) | Pruebas de la aplicación, la web, los servicios y su integración. | TypeScript, JavaScript |
| [`config/`](config/README.md) | Configuración declarativa y plantillas sin secretos, también las de Cloudflare. | JSON, JSONC |
| [`docs/`](docs/README.md) | Guías de arquitectura, instalación, operación, datos y contratos. | Markdown |

La instalación crea además carpetas que no están en Git: `.venv/` (entorno de Python), `node_modules/`,
`var/` (almacén privado de la actualización de datos), `.web-local/` (web construida para el servidor local) y
`dist/` (construcción para desplegar).

## Empezar

### Requisitos

- Node `>=24.22.3 <25` (`package.json`, campo `engines`; lo exige también `scripts/verificar.ts`).
- Python 3.12.15 (`.python-version`), con SQLite 3.54.1 o posterior y FTS5.
- macOS ARM64 o Linux x86_64 para el mantenimiento de los datos.

La [preparación en detalle](docs/operacion-local.md#preparar-la-instalación-en-detalle) explica cada requisito y cómo
preparar en macOS un Python con el SQLite necesario.

### Instalar

Desde la carpeta del producto, en este orden:

```sh
export npm_config_update_notifier=false
NODE_OPTIONS="--require=./herramientas/red/identidad-http.cjs" npm ci --ignore-scripts --no-audit --no-fund --update-notifier=false
python3.12 -m plataforma_datos.orquestacion.preparar_dependencias "$PWD"
env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" LANG=C.UTF-8 \
  ${PLAYWRIGHT_BROWSERS_PATH+"PLAYWRIGHT_BROWSERS_PATH=$PLAYWRIGHT_BROWSERS_PATH"} \
  node --require "$PWD/herramientas/red/identidad-http.cjs" \
  "$PWD/node_modules/playwright-core/cli.js" install chromium firefox webkit
```

La primera línea evita una consulta de red de npm que no hace falta. La segunda instala las dependencias de Node
fijadas en `package-lock.json`. La tercera crea `.venv/` con las dependencias de Python comprobadas por huella. La
última instala los navegadores que usan las pruebas de navegador.

### Base ESCO para la verificación

La verificación comprueba el motor de ocupaciones con la biblioteca ESCO local,
`var/actualizacion/validados/esco/biblioteca-esco.sqlite`. Esa base no está en Git: se prepara en cada instalación
desde la captura de la versión 1.2.1 de ESCO obtenida de la API oficial de la Comisión Europea. La captura consta de
dos archivos que se reciben con la entrega: `biblioteca-api.zip` (83.090.283 bytes), con las páginas de la API, y
`procedencia.json` (146.203 bytes), con su origen, su licencia y su cita. `CAPTURA_ESCO` es la carpeta donde se han
recibido:

```sh
mkdir -p var/actualizacion/originales/esco
cp -p "${CAPTURA_ESCO:?indica la carpeta de la captura recibida}/biblioteca-api.zip" \
  "$CAPTURA_ESCO/procedencia.json" var/actualizacion/originales/esco/
shasum -a 256 -c plataforma_datos/ocupaciones/fuentes/esco/captura.sha256 &&
  .venv/bin/python -m plataforma_datos.ocupaciones.fuentes.esco.lector preparar &&
  .venv/bin/python -m plataforma_datos.ocupaciones.fuentes.esco.lector validar
```

`shasum` compara la captura con las huellas de
[`captura.sha256`](plataforma_datos/ocupaciones/fuentes/esco/captura.sha256); en Linux sin `shasum`, la primera
orden encadenada es `sha256sum -c plataforma_datos/ocupaciones/fuentes/esco/captura.sha256`. Si no indica `OK` para
los dos archivos, la captura no es la de la entrega y el lector no la prepara. Preparar y validar no usan la red y
tardan unos segundos. La [preparación en detalle](docs/operacion-local.md#base-esco-en-la-integración-continua-y-en-la-verificación)
cuenta cómo la obtiene la integración continua y qué comprueba la verificación.

### Tabla del ODEE y la Cambra

El paquete solo lleva la parte pública del estudio del ODEE y la Cambra de Comerç de Barcelona
(`datos/exposicion-cambra.json`): el nivel de exposición agregado de cada ocupación, que es lo que cubre su permiso, y
con eso arrancan el motor, los tipos y la web. La tabla completa (`datos/cambra.json`) no está en Git: solo la
necesitan las pruebas de los cálculos del estudio. Una instalación autorizada la pide a Equipo Faro o la recupera del
almacén privado, y la comprueba con la huella que fija `datos/manifiesto.json`:

```sh
.venv/bin/python -m plataforma_datos.ia_y_trabajo.fuentes.cambra.tabla_privada recuperar
```

La orden necesita los tres secretos del [almacén](docs/almacenamiento-datos.md) en el entorno. El
[paquete de datos](datos/README.md#exposicion-cambrajson) explica qué contiene y en qué condiciones se usa.

### Servir en local

| Orden | Qué hace |
| --- | --- |
| `npm run servir` | Construye la web local en `.web-local/` si falta o sus fuentes han cambiado, y la sirve con la API en `http://127.0.0.1:8787`. |
| `npm run web:preparar` | Construye la web local sin arrancar el servidor. |

El servidor solo comprueba las fuentes al arrancar: tras editar, hay que pararlo y lanzarlo de nuevo. La
[operación local](docs/operacion-local.md) explica el puerto, los perfiles y la configuración.

### Probar

| Orden | Qué hace |
| --- | --- |
| `node --import=./pruebas/ayudas/sin-red.ts --test <archivo de prueba>` | Ejecuta una prueba suelta sin acceso a la red. |
| `npm run probar:ocupaciones`, `npm run probar:cursos` | Ejecutan las pruebas de un motor. |
| `npm run tipos`, `npm run estilo` | Comprueban los tipos (TypeScript y JSDoc) y el estilo (Biome). |
| `npm test` | Ejecuta la base ESCO y las baterías de pruebas de Node, navegador y Python, sin los controles de código. |
| `npm run verificar` | La verificación completa: base ESCO, controles de código y generados, construcción local y todas las pruebas. |
| `npm run probar:navegadores` | Recorre la web construida en Chromium, Firefox y WebKit; va aparte de la verificación. |

La verificación completa tarda unos veinte minutos en un Mac reciente y cerca de una hora en la integración continua.
Sus plazos máximos son 18 min para la batería de unidad de Node y 12 min para la de navegador, medidos en la integración
continua con un margen del 20 % (`scripts/plazos-de-las-suites.ts`), y 75 min para la de Python (`scripts/verificar.ts`); la integración continua (`.github/workflows/calidad.yml`) le da un tope de 192 minutos.
La integración continua se ejecuta con cada empuje y cancela la ejecución anterior de la misma rama; comprueba
tipos, estilo y juntas antes de preparar los navegadores, para que un fallo rápido se vea en pocos minutos.
Las omisiones admitidas, archivo por archivo, están en el [arnés de verificación](scripts/README.md).

### Construir y desplegar

| Orden | Qué hace |
| --- | --- |
| `npm run construir` | Genera `dist/` con la web, los Workers y el inventario comprobado; no despliega. |
| `npm run cloudflare:comprobar` | Comprueba la construcción y su aislamiento para Cloudflare. |
| `npm run probar:motor-empaquetado -- "$PWD/dist"` | Compara el motor empaquetado con el de las fuentes sobre esa construcción. |
| `npm run cloudflare:artefacto` | Exporta o comprueba el artefacto de una construcción. |
| `npm run cloudflare:desplegar` | Publica una construcción admitida en un entorno de Cloudflare. |

Sin `--destino-cloudflare`, `npm run construir` produce la variante privada de ensayo. La
[guía de despliegue](docs/despliegue.md) describe la variante oficial, la publicación y la activación del
mantenimiento; la [guía de construcción](docs/construccion-web.md), qué contiene la web construida.

### Actualizar los datos

| Orden | Qué hace |
| --- | --- |
| `npm run datos:estado` | Muestra el estado de los datos de mantenimiento. |
| `npm run datos:catalogo` | Muestra el inventario de los conjuntos de datos. |
| `npm run datos:actualizar` | Lee las fuentes, valida y prepara una actualización del paquete. |
| `npm run datos:exportar` | Exporta el paquete de `datos/` con su manifiesto de huellas. |

En producción, la actualización se programa cada día desde el Worker principal y la ejecuta un workflow de GitHub
([actualización remota](docs/actualizacion-remota.md)). Las órdenes de cada etapa y sus entradas están en la
[cadena de datos](plataforma_datos/orquestacion/README.md).

## Por dónde seguir leyendo

1. [Arquitectura](docs/arquitectura.md): principios, piezas, recorrido de una consulta y de un dato, y glosario.
2. [Índice de la documentación](docs/README.md): las guías agrupadas por tema, con su orden de lectura.
3. [Motores](motores/README.md) y [código de la aplicación](src/README.md): por dónde empezar a leer el código.
4. [Plataforma de datos](plataforma_datos/README.md) y [paquete de datos](datos/README.md): de dónde sale cada cifra.

## Licencia y créditos

El código y su documentación son de Equipo Faro, con todos los derechos reservados; las condiciones están en
[LICENSE](LICENSE). Puedes leer el código en este repositorio, pero no copiarlo, modificarlo ni redistribuirlo, en
todo o en parte, sin permiso escrito de Equipo Faro.

Los datos y materiales de terceros conservan sus propias licencias, citas y atribuciones, reunidas en los
[avisos de terceros](AVISOS-DE-TERCEROS.md); esta licencia no las cambia. La tabla completa del ODEE y la Cambra de
Comerç de Barcelona no se incluye en el repositorio; del estudio solo está el nivel de exposición agregado que muestra
Faro, y no se autoriza su reutilización: su permiso cubre solo mostrar ese nivel en Faro.

Cómo comunicar una vulnerabilidad se explica en
[SECURITY.md](SECURITY.md), y la versión y sus cambios, en el [registro de cambios](CHANGELOG.md).
