# Seguridad

Faro trata relatos de trabajo que pueden contener datos personales. Los fallos de seguridad incluyen la lectura
o conservación indebida de esos textos, la manipulación del informe y el acceso no autorizado a datos o funciones administrativas.

## Comunicar una vulnerabilidad

Utiliza el canal que indique la entidad responsable de la instalación en `/.well-known/security.txt` o en su
política de seguridad. Incluye cómo reproducir el problema y qué impacto tiene, con ejemplos ficticios y sin
adjuntar claves ni datos personales de otras personas. No publiques los detalles antes de coordinar su divulgación.

La entidad responsable establece el contacto, los plazos de respuesta y su política de corrección. La distribución
se entrega sin un contacto preasignado; quien la publique debe configurar un canal atendido para recibir avisos.

## Alcance

- API del motor, MCP, A2A, acceso para socios, configuración pública y recursos del navegador.
- Filtrado de datos personales, procesamiento local y validación de las entradas de los motores.
- Firmas, sesiones, credenciales, permisos por canal, cuotas y registros técnicos.
- Instalación, actualización y funcionamiento sin conexión del producto.

## Protección de los datos

El motor no persiste conversaciones ni incluye el contenido de las peticiones en sus errores internos.
El filtro compartido retira los identificadores que reconoce antes del procesamiento; no garantiza anonimato universal.
El recorrido utiliza los motores locales del dispositivo. Las consultas de datos y los servicios administrativos
tienen controles de acceso y plazos de conservación propios, que deben comprobarse al configurar la instalación.

Una credencial de consulta no permite modificar datos ni administrar el servicio. Las claves se guardan fuera del
repositorio, según la [configuración](docs/configuracion.md). La documentación de
[los motores locales](docs/motores-locales.md) explica su relación con los servicios de datos.

El archivo `/.well-known/security.txt` identifica al responsable de seguridad del despliegue.
La entidad puede establecer su contacto, política y caducidad mediante las variables descritas en
[la operación local](docs/operacion-local.md). Sin un contacto válido, `security.txt` responde 404 y no publica
un contacto ficticio. El responsable y el correo de las páginas públicas se configuran según
[el contacto de publicación](docs/contacto-publicacion.md).
