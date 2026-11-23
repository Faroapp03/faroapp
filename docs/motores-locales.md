# Motores locales y servicios de datos

El recorrido de Faro utiliza sus motores locales en el dispositivo. Los vectores y las reglas del paquete
permiten buscar ocupaciones, preparar tareas y construir el informe. La minimización de datos personales
se aplica antes del procesamiento local y mantiene el aviso de privacidad del recorrido.

La [operación local](operacion-local.md) explica el arranque. La plantilla [.dev.vars.example](../.dev.vars.example)
contiene las opciones de servicio y seguridad. Las consultas factuales de la API, MCP y A2A tienen sus propios
controles de acceso, cuotas y procedencia. La API para aplicaciones utiliza credenciales [OAuth](api/socios.md).

El [panel administrativo](administracion.md) gestiona los servicios de consulta, las secciones públicas y la
actualización de datos. Sus sesiones exclusivas, controles de origen, identidad y revisiones son obligatorios.
Las claves y los secretos de acceso se configuran en el servidor según la documentación de cada servicio.
