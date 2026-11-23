# Consultas para socios

La API institucional expone las consultas públicas de Faro bajo `/api/socios/v1/consultas/<herramienta>`.
Su contrato figura en [OpenAPI](../../web/openapi.json), con la etiqueta `socios`. Se entrega apagada y se
habilita desde el panel. «Socios» identifica técnicamente los sistemas autorizados; cada uno recibe su clave
mediante una [invitación administrativa](../conectividad.md). El registro reside en el almacén operativo.

La página `/activar-acceso.html` solo genera una clave con una invitación válida, vigente y aún no consumida.
La clave se muestra una vez; Faro conserva su huella. La institución debe guardarla exclusivamente en su
servidor. Ese acceso permite consultar datos, nunca administrar Faro ni modificar los datos.

El acceso utiliza OAuth 2.0 con credenciales del cliente. `/api/socios/v1/token` recibe las credenciales mediante HTTP Basic y un formulario con `grant_type=client_credentials`. El ámbito de lectura es `faro.lectura`; el token Bearer dura 900 segundos. Los puntos `/revocar` e `/introspeccion` gestionan su revocación y consulta de vigencia. Las credenciales no forman parte del código ni de los datos publicados.

`formacion_oficial` devuelve las especialidades en `especialidades.mostradas`, con el total, cursos, Consorci y procedencia. Si no hay formación, devuelve `formacion: null` y un aviso. Una especialidad sugerida lleva `correspondencia: null`; las relaciones oficiales conservan su correspondencia EURES. El esquema compartido con MCP declara ambas situaciones.

Esta vía no usa la cabecera de contrato REST de la web. El cliente debe aceptar la ausencia de correspondencia oficial sin convertirla en una relación inventada. Las reglas comunes del formato están en [el contrato de la API](README.md).

## Autorización de consultas

La emisión utiliza `faro.lectura`. Un `resource` explícito debe ser la URL absoluta del mismo origen terminada en
`/api/socios/v1/consultas`; un recurso erróneo se rechaza. Las repeticiones del ámbito de lectura se aceptan.
Revocación e introspección comprueban la firma, la audiencia, la credencial vigente y la revocación del token.
La [administración del servicio](../administracion.md) controla la disponibilidad de REST, las invitaciones y la retirada de claves. La revocación institucional se aplica también a los tokens emitidos.

## Consultas globales con el mismo ámbito de lectura

`GET /api/socios/v1/consultas/catalogo_datos_globales?seccion=territorios&maximo=5` y `GET /api/socios/v1/consultas/consultar_datos_globales?seccion=indicadores&id=empresas-ia&territorio=ES51` usan el token existente con `faro.lectura`. No requieren permisos de IA ni un ámbito nuevo. Los parámetros, la paginación y las salidas coinciden con [las consultas globales MCP/A2A](../mcp.md#datos-globales). Para una meta, se omiten territorio, año y paginación: `?seccion=metas&id=meta-capacidades-digitales`. Deben conservarse las licencias y la distinción entre objetivos normativos, estadísticas, opiniones y cálculos de Faro.
