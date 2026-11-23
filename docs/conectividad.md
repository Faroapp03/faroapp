# Encender la conectividad y dar acceso a una institución

API, MCP y A2A se entregan apagados. Se gestionan por separado desde **Panel → Conectividad**. El panel requiere autorización y sesión vigente; el servicio necesita un almacén persistente. El despliegue debe configurar `FARO_SECRETO_FIRMA` como secreto del servidor, fuera del código y de la web.

1. **Encender y comprobar.** Activa el servicio elegido. En **Qué es Faro → Conectividad → Comprueba la conectividad**, comprueba su estado: verde significa activo y gris, apagado. Un fallo de consulta o la falta de conexión se indican como imposibilidad de comprobar, sin deducir que esté apagado. **Volver a comprobar** hace una consulta nueva.
2. **Invitar.** En **Panel → Instituciones**, escribe el nombre de la institución o sistema y, si procede, su correo administrativo. **Invitar** crea un enlace de un solo uso válido durante siete días. Cópialo y entrégalo por un canal seguro; el botón de correo abre tu programa con el mensaje preparado. Faro no envía correos. El secreto está en el fragmento del enlace (`#…`) y solo se guarda su huella.
3. **Activar.** La institución abre el enlace y pulsa **Generar clave**. La clave aparece una sola vez: debe copiarla y guardarla exclusivamente en su servidor, nunca en una página pública o una aplicación de navegador. Con ella obtiene el token y consulta la API según el [contrato para instituciones](api/socios.md). Cada sistema tiene su propia identidad.
4. **Cambiar o retirar.** **Nueva invitación** permite generar una segunda clave sin cortar la anterior. Una vez configurada y comprobada la nueva, retira la anterior. **Retirar acceso** anula la institución y los tokens emitidos dejan de servir. Si se pierde la clave, se emite otra invitación; Faro no puede recuperar el secreto.
5. **Consultar accesos.** En **Panel → Accesos**, la API muestra fecha, institución, nombre de operación y resultado; MCP y A2A muestran recuentos diarios. El nombre del cliente MCP es declarado, no una identidad verificada. No se guardan IP, cabeceras ni argumentos o contenido de las consultas. El registro conserva hasta 10.000 filas durante 30 días, con páginas de 50; los [límites operativos](administracion.md#instituciones-y-accesos) están acotados y comprobados.

## Añadir Faro a un asistente

Con MCP activo y accesible por HTTPS, copia la dirección mostrada por Faro, terminada en `/mcp`. Esta conexión consulta datos públicos y no requiere clave.

- **ChatGPT:** abre Plugins, pulsa **+ → Add custom MCP server**, pega la dirección y elige **No authentication**. Crea e instala el conector; puedes invocarlo con `@`. El espacio de trabajo debe permitir conectores personalizados. [Instrucciones oficiales de OpenAI](https://developers.openai.com/api/docs/guides/custom-mcp-server).
- **Claude:** abre **Customize → Connectors → + Add → Add custom connector**, pega la dirección y utiliza la opción sin inicio de sesión. En organizaciones puede requerirse la intervención de su administrador. [Instrucciones oficiales de Claude](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

Los nombres de estos controles dependen del idioma y de la versión del asistente. La página de Faro solo muestra la dirección cuando ha comprobado que MCP está activo.

## Publicación en directorios

Añadir un conector propio no lo publica en un directorio. Para distribuirlo, prepara un punto de acceso HTTPS estable, documentación, contacto de publicación, política de privacidad y pruebas reales de cada herramienta. [Anthropic](https://claude.com/docs/connectors/building/submission) recibe conectores en su portal y los revisa. [OpenAI](https://developers.openai.com/plugins/deploy/submission) recibe un paquete de plugin con su conexión MCP, identidad verificada y materiales de prueba, y exige revisión antes de publicar. El [registro oficial MCP](https://modelcontextprotocol.io/registry/remote-servers) registra metadatos: para el servicio remoto se declara su URL en `remotes`, con el espacio de nombres del editor verificado. Ninguna de estas altas se realiza automáticamente al desplegar Faro.
