# Consultas para agentes

MCP y A2A exponen las consultas públicas de Faro mediante sus propios protocolos. Sus versiones de transporte son independientes del contrato REST de la web. Los interruptores independientes del panel protegido determinan si `/mcp` y `/a2a` están habilitados. Una lectura fallida de su autoridad devuelve indisponibilidad; no se presenta como un servicio apagado.

Las ocho consultas deterministas no requieren credenciales ni alta de clientes. `FARO_MCP` y `FARO_A2A`
fijan la semilla inicial, apagada por defecto; no sustituyen una política ya guardada. Activarlos requiere la administración y el registro operativo preparados. Deshabilitar A2A retira también su tarjeta. Se mantienen la validación de
peticiones, los límites de uso y el filtro de texto.

Las definiciones de herramientas se mantienen en `src/api/mcp/definiciones.ts`. La consulta `formacion_oficial` publica su esquema de salida: cuando hay formación, las especialidades aparecen en `especialidades.mostradas`; cuando no hay, `formacion` vale `null` y se incluye un aviso. La procedencia acompaña el resultado.

Una sugerencia de Faro lleva `relacion: "sugerencia"` y `correspondencia: null`. Las otras relaciones declaran su correspondencia oficial EURES. La medida opcional `parecido` puede ser negativa y no es una probabilidad. Los agentes deben conservar esta distinción al explicar los resultados.

MCP entrega los datos estructurados y su representación JSON de texto. A2A y la API para socios reutilizan la misma consulta. El esquema compartido vive en `src/api/esquemas-formacion.ts`; los consumidores deben validar sus alternativas con JSON Schema 2020-12, no con el validador parcial de entradas.

La generación de OpenAPI y la compatibilidad REST se explican en [el contrato de la API](api/README.md). Las rutas REST de socios se describen en [su documentación](api/socios.md).

## Datos globales

Las ocho consultas de lectura incluyen `catalogo_datos_globales` y `consultar_datos_globales`, compartidas por MCP, A2A y socios. Consultan el mismo paquete de Cataluña, la UE y países, sin llamadas a modelos durante la consulta. No agregan países para inventar una cifra mundial ni traducen los textos publicados, que conservan castellano y catalán. Si el paquete global no está disponible, estas dos consultas devuelven un error; las otras seis lecturas conservan su funcionamiento.

`catalogo_datos_globales` recibe `seccion`: `territorios`, `indicadores`, `recuentos`, `metas`, `encuestas` o `calculados`. Devuelve fichas completas sin sus listas de cifras, en el orden del paquete. `desplazamiento` empieza en cero y `maximo` vale cinco por defecto, con tope de cinco. `total` describe la sección completa y `siguiente` es el siguiente desplazamiento o `null`.

`consultar_datos_globales` recibe una familia y su `id` exacto. Las estadísticas requieren `territorio` y admiten `anio`, `desplazamiento` y `maximo` (veinte por defecto y como máximo). Devuelven `ficha` con metadatos íntegros, el descriptor `territorio` y `valores` paginados. Una combinación válida sin cifra devuelve lista vacía y total cero, sin sustituir la ausencia por un valor numérico. Las metas reciben **solo** `seccion: "metas"` e `id`: la norma completa está en `ficha`; `territorio` es `null` y `valores` está vacío. Su valor y año son objetivos normativos, no cifras observadas.

Ambas respuestas conservan `version` y `generado` del paquete y su `procedencia`: las fuentes originales con su licencia y la elaboración o distribución de Faro. Las cifras mantienen unidades, naturaleza (medida, estimada, opinión o calculada), notas y años. Los cálculos de Faro conservan intervalos, cotas y licencias individuales; no se atribuyen como publicaciones oficiales del organismo. El contenido estructurado de cada consulta está limitado a 32.000 bytes; el envoltorio del transporte puede ocupar más. Los esquemas públicos están en `src/api/esquemas-datos-globales.ts`.

## Límites

El producto no incluye una orden para generar las claves de `FARO_FIRMA_MCP_CLAVES`, con las que el servidor MCP firma
cada respuesta. La variable es una lista JSON de `{ algoritmo, publica, privada }` en base64, una clave Ed25519 y una
ML-DSA-65 (`clavesDeFirmaDe`, en `src/api/mcp/firma-de-respuesta.ts`); sin ella, las respuestas no se firman.

## Registro operativo y cliente declarado

El panel muestra recuentos diarios por herramienta MCP y por habilidad A2A, con retención de 30 días y un máximo conjunto de 10.000 filas. No se guardan argumentos, contenido de las consultas, cabeceras, tokens ni direcciones IP. Las consultas siguen siendo deterministas y de solo lectura. Si el registro operativo obligatorio falla, la consulta no se entrega como correcta; el panel conserva la posibilidad de apagar los canales.

En MCP 2026-07-28 el nombre se toma exclusivamente de `params._meta['io.modelcontextprotocol/clientInfo'].name` de esa petición, según [la definición normativa de metadata](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#meta). Es un nombre declarado, no una identidad comprobada ni una autorización. Su versión y otros campos no se almacenan. El nombre pasa por el filtro compartido de datos personales y límites de longitud/formato; los no admisibles figuran como omitidos. Solo se conservan 64 nombres distintos al día: los siguientes se agrupan como «Otros».

Las peticiones son independientes. Un `initialize` anterior no atribuye sus datos a posteriores `tools/call`; sin el metadato en la consulta se registra «No declarado», también con las revisiones anteriores del protocolo. No se crean sesiones, cookies ni asociaciones por IP para reconstruir ese dato. Cambiar el nombre no cambia permisos ni resultados.
