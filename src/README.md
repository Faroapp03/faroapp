# Código de la aplicación

El dominio compone información a partir del paquete admitido; los adaptadores conectan esas funciones con el
navegador, Node y Cloudflare. La adquisición y actualización de fuentes pertenece a
[plataforma_datos](../plataforma_datos/README.md), fuera del recorrido de la persona.

| Capa | Responsabilidad |
| --- | --- |
| [dominio](dominio/README.md) | Tipos, reglas de interpretación y composición del informe. |
| [presentacion](presentacion/README.md) | Textos, HTML y documentos del informe. |
| [api](api/README.md) | Contratos, validación y operaciones de consulta. |
| [plataforma](plataforma/README.md) | Carga de datos, ejecución y adaptación a cada entorno. |
| [seguridad](seguridad/README.md) | Validación de acceso, límites y protección de entradas. |
| [administracion](administracion/) | Sesiones, políticas y operaciones del panel; [contrato del vigilante](administracion/vigilante.md). |
| [catalogo-cursos](catalogo-cursos/README.md) | Lectura del contrato público de ofertas acreditadas. |
| [seleccion-formacion](seleccion-formacion/README.md) | Caminos de aprendizaje con oferta vigente, requisitos y cobertura acreditada. |
| [biblioteca](biblioteca/), [datos-globales](datos-globales/) | Proyección de información y sus comprobaciones. |
| [comun](comun/README.md) | Utilidades de la aplicación, con contratos compartidos dentro de esta capa. |
| [ia](ia/README.md) | Reglas lingüísticas de las tareas que usa el motor local de ocupaciones, en castellano y catalán. |
| [service-worker](service-worker/) | Fuentes del service worker: copia de la web sin conexión, paquete de datos del dispositivo y reglas de servicio; la [construcción de la web](../docs/construccion-web.md) lo empaqueta. |

Los motores independientes están en [motores](../motores/README.md). Los tipos que cruzan esa frontera se
sitúan en [compartido](../compartido/README.md); no se duplican en cada motor. Las carpetas de utilidades de
otras capas tienen un ámbito distinto y no deben importar adaptadores de plataforma por comodidad.

Una forma TypeScript no valida un dato recibido en ejecución. Cada frontera comprueba estructura, límites,
procedencia y alcance antes de utilizarlo. Los estados desconocidos se conservan como tales.
