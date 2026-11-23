# Herramientas de operación

Estas órdenes preparan y comprueban el producto. Las entradas documentadas en `package.json` son la interfaz
habitual; cada herramienta valida sus argumentos y resuelve rutas desde la instalación.

| Grupo | Función |
| --- | --- |
| [web](web/) | Preparar recursos, integridad, motor del dispositivo y construcción. |
| [comun](comun/) | Análisis de opciones y utilidades internas compartidas. |
| [catalogo-cursos](catalogo-cursos/) | Mantenimiento de guardas editoriales del catálogo a partir de la instantánea histórica fijada en `pruebas/fixtures/catalogo-clasificacion-20261025.utf8`; `firmas-editoriales.ts --comprobar` compara sin escribir; [huella, tamaño y revisión fijados](../pruebas/ayudas/catalogo-clasificacion.ts). [Foto de la clasificación](#foto-de-la-clasificación-de-cursos) que ve la persona y su comparador. |
| [git](git/) | Comprobaciones locales de integración. |
| [publicar-paquete.ts](publicar-paquete.ts) | Copia de los datos publicados en la web construida. |
| [servidor](servidor/README.md) | Servidor local y configuración del arranque. |
| [cloudflare](cloudflare/) | Composición y comprobación del artefacto del alojamiento; [huellas CSP](#huellas-csp-de-las-páginas-del-alojamiento) de sus páginas. Las comprobaciones locales de una entrega oficial que solo usan las pruebas son ayudas de `pruebas/ayudas/` ([entrega oficial](../pruebas/ayudas/comprobar-oficial.ts) y [ensayo de producción](../pruebas/ayudas/comprobar-ensayo-produccion.ts)). |
| [api](api/) | Generación y comprobación de OpenAPI. |
| [red](red/README.md) | Identidad HTTP y preparación segura de dependencias. |
| [mantenimiento](mantenimiento/) | Operaciones delimitadas de mantenimiento. |
| [clasificador-movil](clasificador-movil/), [vectores-movil](vectores-movil/) | Construcción y comprobación de recursos derivados con procedencia. |

La [guía de construcción](../docs/construccion-web.md) identifica los archivos generados: se modifica su
origen y se ejecuta el generador correspondiente. Preparar un artefacto no lo publica. Las actualizaciones
de fuentes las coordina [la plataforma de datos](../plataforma_datos/orquestacion/README.md).

Cada grupo lleva el nombre del ámbito sobre el que actúa, según la [convención de nombres](../docs/README.md#convención-de-nombres).
Algunos tienen un solo archivo y se mantienen así porque su nombre dice sobre qué actúa la orden:

- `clasificador-movil/` y `vectores-movil/` tienen cada una un `empaquetar.ts` para el recurso del mismo nombre del
  paquete de datos (`datos/clasificador-movil.json` y `datos/vectores-movil.json`); la carpeta distingue las dos órdenes,
  que `npm run verificar` ejecuta con `--comprobar`.
- `git/` y `servidor/` tienen una orden y su README: `npm run juntas:comprobar` y `npm run servir`.

La prueba focal `npm run probar:cursos` ejecuta las pruebas del motor de cursos con la guardia sin red;
no sustituye a la batería completa `npm run verificar`. Los grupos comunes son utilidades internas;
las órdenes de `package.json` son los puntos de entrada documentados.

## Foto de la clasificación de cursos

`catalogo-cursos/foto-clasificacion.ts` solo lee. Con el catálogo publicado (`web/datos/catalogo-cursos/<sha>.json`)
y el código vigente, anota para cada unidad del listado de Cursos, identificada por su tipo y su identificador, lo que
ve la persona: el idioma, el nivel y la materia, cada uno con su origen y su estado (`fuente`, `orientacion-faro` o
`por-confirmar`). Anota también con qué idiomas la admitiría el plan de formación y con qué motivo la descarta. Para
la oferta del SOC (`datos/formacion.json`) anota el idioma y el nivel con que la presenta el motor de cursos. Usa las
mismas funciones que la web (`proyectarListado` y `seleccionarFormacion`) y la bolsa del motor de cursos, sin
reproducir sus reglas. El resultado es JSON con las claves y las unidades ordenadas, sin fechas de ejecución, y
empieza con un resumen por fuente y dato.

```sh
npm run cursos:foto                # escribe la foto de hoy en pruebas/fixtures/foto-clasificacion-20261118.utf8
npm run cursos:foto-comprobar      # falla si la foto calculada no coincide byte a byte con la fixture
node herramientas/catalogo-cursos/foto-clasificacion.ts --comparar <foto anterior>
```

`--comparar` imprime tres listas: pérdidas (un dato que se veía clasificado y pasa a por confirmar), cambios de valor
u origen y ganancias. Termina con 1 si hay alguna pérdida. Un cambio de clasificación se da por bueno comparando con
la fixture y revisando cada cambio de la lista; la fixture solo se regenera después.

## Huellas CSP de las páginas del alojamiento

La pantalla de acceso (`src/plataforma/cloudflare/acceso-web-pagina.ts`) y la portada pública
(`src/plataforma/cloudflare/portada-publica.ts`) llevan su estilo y su guion dentro del HTML. El navegador solo los
aplica si su huella SHA-256 figura en la política de seguridad que envía el Worker, y esa huella está escrita en el
mismo módulo (`CSP_ESTILO_ACCESO_WEB`, `CSP_GUION_ACCESO_WEB`, `CSP_SCRIPT_CABECERA` y `CSP_PORTADA`). Después de
cambiar el HTML, el estilo, el guion o los textos de una de esas páginas, se recalculan sus huellas a partir del HTML
final y se sustituyen en el módulo:

```sh
npm run cloudflare:actualizar-acceso-web
npm run cloudflare:actualizar-portada
```

Las dos páginas comparten la fotografía de fondo, que no va dentro del HTML: el Worker oficial la sirve antes de la
sesión con la huella de su contenido en el nombre y en caché inmutable. La lista de esos activos públicos y sus
huellas está en `src/plataforma/cloudflare/activos-publicos.ts`; `cloudflare:actualizar-portada` recalcula también
`HUELLA_FOTOGRAFIA_PORTADA` desde su archivo de `web/` y la comprobación falla si no coincide.

Las dos órdenes solo reescriben sus módulos, y solo si alguna huella ha cambiado; no construyen ni publican. Fallan
sin escribir si falta la etiqueta o la constante. Tras ejecutarlas hay que construir de nuevo el artefacto.
Importar sus módulos no escribe nada: el cálculo está en funciones exportadas sin efectos (`huellasDePortada`,
`huellasDeActivos` y `huellasDeAccesoWeb`).

El modo de comprobación calcula las huellas desde el HTML final y las compara con las escritas, sin modificar nada:

```sh
npm run cloudflare:comprobar-acceso-web
npm run cloudflare:comprobar-portada
```

Cada orden termina con 0 si todas las huellas coinciden con su HTML y con 1 si alguna no coincide, e indica qué
constantes hay que recalcular. `npm run verificar` ejecuta las dos comprobaciones.

## Proyectos de TypeScript

Los cinco `tsconfig*.json` permanecen en la raíz: sus `extends` y rutas parten de ese directorio y son la
entrada convencional de las herramientas. `scripts/proyectos-typescript.ts` reúne las comprobaciones.

| Configuración | Alcance |
| --- | --- |
| `tsconfig.json` | Código de Node, motores, herramientas y pruebas generales. |
| `tsconfig.web.json` | Scripts de la web y del panel con tipos del navegador. |
| `proyectoTypeScript` de cada extensión | Scripts de la extensión, en su carpeta; su carpeta de pruebas lleva otro `tsconfig.json`. |
| `tsconfig.pruebas-web.json` | Pruebas web y de navegadores. |
| `tsconfig.navegador.json` | Motor que corre en el dispositivo; la comprobación usa `--noEmit`. |
| `tsconfig.service-worker.json` | Service worker y sus auxiliares. |
