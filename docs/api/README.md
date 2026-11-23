# Contrato de la API de Faro

[OpenAPI 3.1](../../web/openapi.json) describe las rutas REST, sus entradas, las respuestas y la API para socios. Se genera desde los metadatos de `src/api/` y las constantes de `src/comun/protocolo-web.ts`.

```sh
npm run api:generar
npm run api:comprobar
```

La primera orden genera el contrato único `web/openapi.json` y `web/scripts/protocolo-web.js`. La segunda comprueba su contenido sin escribir. Ambas resuelven las rutas desde el producto. Las pruebas propias comprueban también que las publicaciones coincidan con las fuentes; los archivos generados no se editan a mano.

## Lo que atiende el servidor

La API del servidor publica solo consultas factuales de lectura. La clasificación de lo que cuenta la persona (`POST /api/clasificar`) y su informe (`POST /api/informe`) los atiende el motor del dispositivo, en el navegador, con el mismo contrato. El servidor responde a esas dos rutas como a cualquier ruta inexistente y no recibe el relato. OpenAPI no las describe; las secciones sobre el informe que siguen describen la respuesta de ese motor.

## Versión y compatibilidad

El contrato REST vigente es **8**. Las peticiones a las rutas de la web declaran `x-faro-contrato: 8`; una versión distinta responde 409. Una cabecera ausente sigue interpretándose como versión 1, por lo que también resulta incompatible. La respuesta declara la versión del servidor y el cliente web solicita recargar cuando no coincide.

El aviso de clasificación usa `tipo: "busqueda-por-palabras"`. La selección desactivada responde con el problema
`seleccion_no_disponible`; no se aceptan nombres de versiones anteriores del contrato.

Esta versión es independiente de la versión del producto, del formato persistido del informe, de la versión de las rutas de socios y de las versiones de los protocolos MCP y A2A. Las consultas de socios y de agentes tienen su propio transporte; no se negocian mediante `x-faro-contrato`.

El informe serializado tiene **versión 2**. Una tarea cuya estimación interna se descarta por ser inválida conserva su identidad, texto y tiempo, con `valor: null` y `motivoSinNota: "estimacion-no-disponible"`. La presentación dice «Estimación no disponible» o «Estimació no disponible», según su idioma. Las demás tareas sin nota omiten ese motivo. La ausencia de nota no equivale a cero y su tiempo cuenta como `sinDatos`.

El motor del dispositivo aplica ese descarte después de validar la forma, comprobar las firmas y moderar los textos, y antes de traducir las frases de IA. Conserva los rechazos de entrada, firma y moderación. El generador local mantiene el error ante una estimación inválida. La web recibe HTML; los informes guardados de versión 1 conservan su presentación al no llevar el nuevo campo. Las seis consultas ocupacionales mantienen sus salidas y versiones.

## Fecha del informe

`fecha` (AAAA-MM-DD) la pone el dispositivo con su reloj, y con ella el informe decide qué cursos han terminado. Hoy el informe se calcula solo en el dispositivo, así que no hay otra hora con la que contrastarla. Lo único que se puede acreditar con los datos es que una fecha es anterior a la de la copia más reciente de los cursos del paquete (SOC, Consorci, FUNDAE y Citilab): ningún dato existía antes de su día de copia, y un reloj atrasado daría por abiertos cursos ya cerrados. Una fecha anterior, con el margen que sigue, se rechaza con `400` y el problema `reloj_atrasado`; la web dice entonces que corrija la fecha y la hora del dispositivo. Si la copia de una fuente del paquete no es un día real, el informe responde un fallo interno (`error_interno`) en vez de dejar de comprobar.

La fecha de los datos es un día de calendario en España, y el día civil de cualquier lugar del mundo puede ir, como mucho, un día por detrás del de España en ese mismo instante. Por eso `reloj_atrasado` solo se responde cuando la fecha es anterior al día previo al de los datos: dos o más días por detrás es imposible con el reloj bien puesto; uno solo es posible (por ejemplo, en `America/Los_Angeles` en las primeras horas tras la copia) y se acepta, y los cursos se juzgan con esa fecha. No es un umbral: es el desfase máximo entre zonas horarias.

La comprobación se hace donde la fecha es la del reloj del dispositivo o decide qué cursos han terminado: en `formato=html` y en el JSON completo (que llevan la formación) y en `formato=breve` con `reloj=dispositivo`, que es como lo pide el recorrido para un informe nuevo, también para el que se rehace solo con las fuentes oficiales. El breve sin `reloj=dispositivo` no lleva formación y no la comprueba: así se abre un resultado pasado desde otro dispositivo, cuya fecha es la del día en que se hizo y puede ser anterior a los datos con el reloj bien puesto. `reloj` solo admite el valor `dispositivo`; con otro, `400`.

Una fecha posterior no se rechaza. Los datos no pueden acreditar que sea errónea: no tienen constancia de ningún instante posterior a su copia, y fijar un margen («a más de N días») sería un umbral sin evidencia. Las dos fechas se comparan como días, sin zona horaria.

Lo que no se puede detectar: un reloj atrasado pero posterior a la fecha de los datos (por ejemplo, el 01/11 con datos del 21/10, siendo hoy el 15/11) pasa la comprobación, y los cursos cerrados entre esas dos fechas se juzgan con la fecha del dispositivo.

En el catálogo de cursos la comparación es distinta: el reloj y el corte de la entrega son instantes UTC, no días, y no dependen de la zona de la persona. Ahí la comparación es exacta, sin margen: un reloj anterior al corte lanza `RelojAtrasado`.

## HTML laboral y JSON completo

`POST /api/informe?formato=html` conserva el objeto `informe` completo, su formación y sus marcas de indisponibilidad. Su campo `html` presenta el informe laboral de dos hojas, con la misma procedencia de máquina del objeto, y usa impresión nativa. La formación imprimible es un documento separado.

`formato=breve` mantiene sus campos `informe`, `breve` y `html`, y sigue sin solicitar formación al motor. Esta unificación de presentación no cambia el contrato REST 8 ni la versión 2 del informe serializado. Los HTML ya conservados no se reescriben.

El HTML es un fragmento para incrustar: la página receptora carga `estilos/tipografias.css` y `estilos/informe-breve.css`, y llama a `prepararInforme` de `scripts/informe.js`. Ese comportamiento aplica las medidas; al imprimir, el informe sale completo, con sus dos hojas en las páginas A4 que necesite (`web/scripts/pdf/README.md`). El JSON completo permanece disponible para consumidores de datos; no representa un tercer informe imprimible.

## Migración del objeto breve

`POST /api/informe?formato=breve` devuelve `breve.version: 2` y su `html`, con dos hojas: la IA y el mercado laboral. Esta versión propia del breve ya existía como campo `version`; su cambio no modifica el contrato REST 8 ni la versión 2 del informe completo.

La versión 1 llamaba `mercado.encuentranContrato` al cociente entre personas contratadas y demandantes no ocupadas. Sus campos `deCada10` y `anteriorDeCada10` sugerían una tasa de colocación que las fuentes no acreditan: no son la misma cohorte. Se sustituyen por `mercado.comparacionContratacionDemanda`, con estos campos:

| Campo | Significado |
|---|---|
| `gruposCno` | Grupos CNO-11 de cuatro cifras cuyos recuentos se suman. |
| `personasContratadas`, `personasDemandantes` | Sumas de los recuentos publicados para esos grupos, sin garantía de personas únicas entre grupos. |
| `contratadasPorDemandante` | Cociente sin redondear entre esas sumas; puede superar uno y no es una probabilidad individual. |
| `anteriorContratadasPorDemandante` | Cociente anterior reconstruido con variaciones comparables, o `null`. |
| `variacion`, `direccion` | Variación anual del cociente y su dirección; sin comparación, `null` y `sin-dato`. |
| `periodo` | Periodo común de ambos recuentos. Si falta o no coincide, el objeto entero es `null`. |

`mercado.contratacion` conserva sus cifras e incorpora también `gruposCno`. Las tarjetas de Contratación y Búsqueda señalan expresamente la suma de recuentos cuando interviene más de un grupo. No se truncan los cocientes para aparentar una proporción.

Los consumidores del JSON breve deben comprobar su versión, leer la nueva clave y tratar sus valores como comparación de recuentos. No deben convertirlos en porcentajes de personas colocadas ni reconstruir el significado de la clave retirada. El recorrido web consume el HTML de la misma respuesta y no lee esos campos del mercado. Los informes HTML ya guardados conservan sus bytes; esta corrección no los reescribe. Esta sección describe esos campos, sus nulos y su procedencia; del resto del breve solo se describen los campos citados aquí.

## Correspondencias y sugerencias de formación

Cada `EspecialidadRelacionada` incluye `relacion` y `correspondencia`:

| Relación | Correspondencia |
|---|---|
| `ocupacion`, `incluye`, `grupo`, `variante` | `exacta`, `cercana`, `amplia` o `estrecha`, según el enlace oficial EURES |
| `sugerencia` | `null`: la propone Faro sin correspondencia oficial |

`parecido`, cuando existe, es una medida semántica, puede ser negativa y no representa un porcentaje ni una probabilidad. La ausencia de medida no equivale a cero.

El mismo esquema de formación aparece en el informe del motor del dispositivo, en la consulta `formacion_oficial` de [socios](socios.md) y en su definición [MCP](../mcp.md). A2A entrega los datos de la misma consulta. Los consumidores deben admitir `null` y no atribuir carácter oficial a una sugerencia.

Los esquemas de salida usan JSON Schema 2020-12, incluidas alternativas `oneOf`. El validador de entradas de `src/comun/esquema.ts` solo implementa un subconjunto: no sirve para validar estas alternativas. OpenAPI describe los campos principales de las demás salidas; no afirma una descripción exhaustiva de todos los objetos anidados.


## Datos globales

Las consultas `catalogo_datos_globales` y `consultar_datos_globales` comparten definiciones y esquemas de salida con MCP y A2A; se ofrecen por socios con el ámbito existente `faro.lectura`. La paginación, los filtros, la procedencia y la distinción entre metas normativas, estadísticas, opiniones y cálculos se describen en [datos globales](../mcp.md#datos-globales). El contenido estructurado de cada consulta está limitado a 32.000 bytes; el envoltorio del transporte puede ocupar más.

## Errores y acceso

La API REST describe los errores mediante Problem Details: `type`, `title`, `status` y `detail`. La extensión `error` se conserva por compatibilidad. Los fallos internos se identifican con `x-faro-peticion`; el detalle no debe contener trazas internas ni información personal.

Los esquemas y los mecanismos de acceso de cada ruta están en OpenAPI. Las rutas de socios emplean credenciales y tokens propios; MCP y A2A se describen por separado. La API institucional requiere una clave obtenida mediante invitación; MCP y A2A son abiertos cuando están activos.

## Estado del servicio

`GET /api/salud` devuelve el estado, la versión y los interruptores de oferta.
No realiza consultas a modelos ni expone variables, rutas o secretos.

Las ocho consultas de datos utilizan el paquete publicado, con sus textos y vectores precalculados y su procedencia.
MCP y A2A ofrecen esas consultas cuando su canal está habilitado; la API para socios requiere token.
Cada canal conserva su autorización. El recorrido utiliza la IA local del dispositivo.

## Límites de las consultas

Las ocho consultas publicadas comparten una capa de negocio para REST, MCP y A2A. Los transportes adaptan
la entrada y el acceso; no mantienen bases distintas ni alteran la vigencia de los datos. El contrato
generado enumera las operaciones disponibles; disponer de un recurso interno no lo convierte en una ruta pública.

Las respuestas conservan procedencia, periodo, población, unidad, comparabilidad y valores desconocidos.
La fecha de construcción no sustituye la fecha de comprobación. Una estadística histórica conserva su periodo
si falla la actualización; un campo ausente nunca se interpreta como cero. La consulta no lanza descargas,
modifica datos ni permite leer SQL, capturas privadas, rutas internas o credenciales.

La redistribución se limita a los campos admitidos por cada fuente. Una página accesible no concede por sí misma
permiso para reproducir su texto completo. El cliente debe respetar la licencia, atribución y límites incluidos
en la respuesta. Los tamaños y filtros están acotados por los esquemas comunes.

Al apagar un canal, su ruta y descubrimiento responden 404. Los documentos públicos de servicios se calculan
con los mismos controles vigentes y no se almacenan en la copia sin conexión. La página de estado distingue
un canal apagado de la imposibilidad de comprobarlo.

## Procedencia de autoría generativa

`marcaIa` describe qué campos proceden de contenido generado y el origen de los demás; no mide el uso de IA local para buscar, clasificar o calcular. Su valor `modo: "sin-ia"` significa que el servicio no redacta ni genera contenido con un modelo al atender esa respuesta. No afirma ausencia total de IA. `modelo: null` evita atribuir esa respuesta a un modelo generador que no consta.

`conIa` conserva los campos generados al preparar el paquete (`modo: "paquete"`) y los de estimaciones o traducciones aportadas cuyo autor no consta (`modo: null`). Puede ser no vacío aunque el modo de la respuesta sea `"sin-ia"`. Las rutas, acciones y fuentes digitales describen esa procedencia declarada; la marca no inspecciona ni certifica el contenido, ni sustituye los controles de privacidad y firmas.
