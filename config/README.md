# Configuración

Los archivos de esta carpeta declaran políticas y parámetros de instalación. No contienen credenciales.
La autoridad y la precedencia de cada ajuste se describen en la [guía de configuración](../docs/configuracion.md).

- [Cloudflare](cloudflare/README.md): plantillas y requisitos del adaptador de alojamiento.
- `identidad-web.json`: perfil genérico común para la red del producto.
- `dependencias-python.lock.json`: versiones, artefactos y huellas admitidos para preparar Python.
- `formacion/aprendizaje-revisado.json`: fichas de aprendizaje revisadas del catálogo de cursos, con su registro de
  competencias. La publicación del catálogo (`plataforma_datos/cursos/publicar_catalogo.py`) genera desde ellas el
  catálogo de aprendizaje de `web/datos/catalogo-aprendizaje/`. Tiene su carpeta, como `cloudflare/`, porque es
  configuración de un ámbito, la formación, y no de toda la instalación.

Los lectores validan las configuraciones antes de aplicarlas. Los valores de ejemplo no habilitan servicios
ni acreditan que una instalación tenga Access, correo o programación remota operativos.
Los secretos pertenecen al entorno de despliegue; nunca se copian a `web/`, `datos/` ni al artefacto público.
