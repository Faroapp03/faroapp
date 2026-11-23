# Contratos y componentes de la API

Los esquemas y metadatos de esta carpeta describen las entradas y el contrato público.
[La documentación de la API](../../docs/api/README.md) explica las versiones y genera OpenAPI desde sus fuentes.
Los componentes siguientes separan el transporte HTTP de las reglas del dominio y de los motores locales.

`api.ts` compone una función `Request → Promise<Response>` mediante `crearApi`. Recibe el paquete ya cargado,
los orígenes permitidos y las opciones de seguridad. Sus rutas REST son consultas factuales de lectura. Los
manejadores viven en `rutas/`; `mcp/servidor-mcp.ts`, `a2a/servidor-a2a.ts` y `socios/api-de-socios.ts` adaptan los protocolos externos.
Esta composición no inicia un servidor ni depende de una ruta fija del equipo.

Las ocho consultas de MCP, A2A y socios usan datos y cálculos locales. OAuth emite `faro.lectura`;
la revocación y la introspección comprueban las firmas y la autoridad vigente de cada token.

`rutas/clasificar.ts` y `rutas/informe.ts` reciben lo que escribe la persona. Solo los monta el motor del dispositivo
(`../plataforma/navegador/api-local.ts`); la API del servidor no los expone y responde a esas rutas como a cualquier
ruta inexistente. `rutas/informe.ts` valida las tareas, comprueba sus firmas cuando hay estimaciones y construye el
informe con el dominio. Con `?formato=html` incluye [HTML laboral de dos hojas](../presentacion/README.md), manteniendo el JSON completo y su formación. Aplica la limpieza local del texto
y conserva las traducciones oficiales disponibles en el paquete.

`http.ts` reúne las comprobaciones de origen, tipo de contenido, versión e idioma, y construye las cabeceras de
las respuestas. El permiso CORS corresponde al origen configurado; no sustituye la autenticación de una operación.
`cuerpo.ts` limita los bytes mientras lee, atiende la cancelación y valida el JSON contra el esquema de entrada.
El límite se comprueba durante la lectura aunque la cabecera de tamaño falte o declare otra cantidad.
`cuerpo-local.ts` construye las peticiones del motor del dispositivo y comprueba el tamaño real del texto antes
de leerlo. Solo esas peticiones pueden usar `text()` cuando el navegador no ofrece un flujo del cuerpo;
la lectura de peticiones de red conserva su límite durante la recepción. El registro interno guarda tamaños
y estado de consumo, sin otra copia del texto, y conserva la cota al asociar la señal del plazo.

`errores.ts` traduce errores a Problem Details y añade las cabeceras de reintento previstas. Los fallos internos
y del procesamiento local usan mensajes públicos fijos. El registro del error interno conserva el método normalizado,
tipo e identificador técnico; no copia ruta, cuerpo, consulta, mensaje interno ni pila.

`plazo.ts` coordina el plazo de la petición y su señal de aborto. Las operaciones en curso y la lectura del cuerpo
atienden esa señal y conservan la distinción entre cancelación del cliente y agotamiento del plazo.

`estimacion-firmada.ts` define los campos vinculados a la firma: versión, ocupación o grupo, tarea normalizada y
estimación. [El firmador](../seguridad/README.md) protege su procedencia e integridad. Cambiar esos campos exige
revisar la versión del contenido firmado; no equivale a cambiar automáticamente la versión REST.

`fichas.ts` proyecta ocupaciones y tareas oficiales del paquete, con sus notas y ausencias. Su índice se conserva
por identidad del paquete, que debe permanecer inmutable tras cargarse. `datos-traducidos.ts` añade las traducciones
en campos separados: conserva el dato de origen y representa una traducción ausente con `null`.

Los componentes de `mcp/` consultan el mismo dominio y paquete oficial. `consultas.ts` minimiza el texto libre
antes de buscar mediante el filtro compartido de seguridad y construye resultados del catálogo;
`procedencia.ts` conserva las citas y distingue sus fuentes. `herramientas.ts` valida los argumentos y limita el
texto de salida en bytes UTF-8. El esquema valida la forma; la minimización retira los identificadores que reconoce.
Ninguno de esos controles garantiza reconocer cualquier dato personal. Los identificadores de correlación del
protocolo se devuelven al mismo cliente y no deben usarse para enviar contenido personal.
`protocolo.ts` lee los mensajes y distingue los errores de protocolo de los errores de una consulta.

`firma-de-respuesta.ts` vincula el contenido canónico de una respuesta a las claves configuradas. Reconstruir su
sobre permite verificarlo, pero no sustituye la comprobación criptográfica de las firmas. Un cambio de contenido,
tipo o combinación requiere revisar también sus lectores.

En `socios/`, `registro.ts` valida las identidades y huellas admitidas; `token-de-acceso.ts` emite y comprueba tokens
con un uso de clave propio, destino y caducidad. El consumidor debe comprobar además el ámbito, la credencial
vigente y la revocación. `revocaciones.ts` conserva cada identificador hasta su caducidad: repetirlo no ocupa otra
entrada ni acorta su retención. La implementación en memoria afecta solo a la instancia que la recibe; el alcance
operativo y la retirada de credenciales se explican en [la configuración de socios](../../docs/api/socios.md).
