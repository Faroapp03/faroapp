# Plataforma de datos

Código que prepara, comprueba y mantiene los datos de Faro. La plataforma entrega
hechos y sus condiciones de uso; los motores consumen esa entrega mediante sus
contratos y conservan sus propios modelos.

## Mapa de la instalación

| Ubicación | Contenido |
| --- | --- |
| `plataforma_datos/` | Código, contratos, pruebas y documentación por tema. |
| [`plataforma_datos/orquestacion/`](orquestacion/README.md) | Ejecución común, planificación, admisión, recuperación y seguimiento. |
| `var/actualizacion/` | Originales, preparados, validaciones y registros operativos de las fuentes; fuera de Git y de la web. |
| `var/actualizacion/validados/catalogo-cursos/` | Única SQLite admitida del catálogo, sus evidencias y controles. Se promueve junto a su entrega pública. |
| [`datos/`](../datos/README.md) | Entrega que lee la aplicación. |

Las rutas del almacén se proporcionan explícitamente a las herramientas. Cambiar
el nombre de una carpeta no activa un catálogo, una consulta periódica ni una
actualización de la web. El almacén necesita sus entradas y respaldos para poder
reconstruirse; clonar el código no copia esas entradas.

## Temas y responsabilidades

La clasificación atiende a lo que mide o describe la fuente. Una fuente tiene
un único productor; otros temas leen sus resultados mediante contratos.

| Tema | Carpeta | Qué contiene | Quién lo usa |
| --- | --- | --- | --- |
| Cursos | [`cursos/`](cursos/README.md) | Programas, ediciones, acceso, aprendizaje previsto, evidencias y vigencia. | Catálogo y motor de formación. |
| Ocupaciones | [`ocupaciones/`](ocupaciones/README.md) | Ocupaciones, tareas y correspondencias oficiales. | Motor de ocupaciones e informes. |
| IA y trabajo | [`ia_y_trabajo/`](ia_y_trabajo/README.md) | Uso, exposición y estudios con población, método y periodo. | Informes y datos globales. |
| Mercado | [`mercado/`](mercado/README.md) | Empleo, contratación y salarios con sus ámbitos. | Informes y datos globales. |
| Derechos | [`derechos/`](derechos/README.md) | Normas y sus versiones, fechas y referencias. | Informes y Biblioteca. |
| Biblioteca | [`biblioteca/`](biblioteca/README.md) | Lecturas, recursos y comprobación de sus enlaces. | Biblioteca y formación. |
| Común | [`comun/`](comun/README.md) | Territorios, idiomas y otros catálogos compartidos. | Temas y consumidores que los necesitan. |
| Contratos | `contratos/` | Formato y significado de las entregas compartidas. | Productores, validadores y consumidores. |
| Derivados | [`derivados/`](derivados/README.md) | Cálculos globales, entradas y comprobaciones. | Datos globales e informes. |
| Orquestación | [`orquestacion/`](orquestacion/README.md) | Dependencias, turnos, ejecución, admisión y seguimiento. | Mantenimiento. |

El [inventario de datos](../docs/catalogo-de-datos.md) relaciona las fuentes con
sus productores y consumidores. Cada `fuente.json` declara los canales y operaciones
admitidos. Un lector candidato no se activa por el mero hecho de existir; requiere
su conexión a la adquisición, validación, registro y publicación comunes.

Los vectores y clasificadores pertenecen a sus motores. El inventario declara
sus entradas y huellas para identificar qué actualización requiere comprobarlos;
no los reentrena ni sustituye al actualizar una fuente.

## Contrato de un componente

Cada componente incluye README, ficha de entradas y salidas, contratos y pruebas.
`ficha.json` es una convención documental del proyecto, no una declaración de
conformidad con un estándar externo. Los contratos de cada fuente deben mantener
población, denominador, clasificación, territorio, periodo, método y licencia
cuando correspondan. Un formato válido no demuestra comparabilidad estadística.

Cada fuente es una unidad de actualización idempotente: repetir las mismas entradas
no duplica registros ni rejuvenece fechas. Un fallo de adquisición o validación se
registra para esa fuente y conserva su última versión admitida, si sigue siendo
utilizable; no detiene fuentes independientes. Los derivados solo avanzan con
entradas compatibles. Las comprobaciones de integración cubren el aislamiento al componer la
entrega: los fallos locales no deben bloquear entregas independientes, y nunca se
mezclan revisiones incompatibles. Un fallo de recuperación del almacén compartido
es distinto: exige detener la promoción hasta recuperar su integridad.

Una observación nueva conserva su fecha de captura separada de la fecha publicada.
La ausencia en una lectura parcial no equivale a retirada. Una actualización
incompatible no sustituye silenciosamente datos admitidos. Las propuestas de
clasificación automática se distinguen de hechos y decisiones revisadas.

## Hechos, comprobaciones e incertidumbre

La plataforma intenta resolver las dudas con las consultas, contrastes y reintentos
permitidos por cada fuente. Registra lo observado, su alcance y lo que no pudo
comprobar. Si la evidencia no permite decidir, el resultado es desconocido con su
motivo; una inferencia no ocupa el lugar de un hecho publicado.

Cada productor y consumidor distingue tres dimensiones:

| Dimensión | Qué expresa | Qué no demuestra por sí sola |
| --- | --- | --- |
| Consulta | Intento, respuesta, fallo y recursos realmente comprobados. | Un fallo no acredita cierre, retirada ni falsedad del dato. |
| Evidencia | Identidad, alcance, fecha de observación y plazo de validez. | Un plazo vencido caduca la comprobación, no el curso ni la publicación. |
| Hecho de la fuente | Requisitos, fechas, disponibilidad, valores o cambios publicados y vinculados al elemento concreto. | Una página genérica o una respuesta legible no confirma la identidad del elemento. |

La política de cada conjunto define qué comprobación permite cada decisión. Un
HTTP 404 describe la respuesta de una URL; no prueba que su publicación, curso o
norma hayan dejado de existir. La ausencia en una lectura parcial no permite una
baja. Una ausencia en un censo completo acreditado puede retirar la pertenencia a
ese catálogo, conservando ese alcance y el historial; no demuestra el cierre del
curso en otros catálogos. El número de intentos fallidos determina reintentos y
avisos, nunca inventa el motivo de una retirada.

El último intento y la última comprobación válida conservan fechas y resultados
separados. Un fallo reciente no rejuvenece la comprobación anterior ni desaparece
porque todavía exista una versión utilizable. Las cifras conservan además su
periodo de referencia: la fecha de descarga no es la fecha de los valores. Las
normas y clasificaciones requieren su versión y ámbito efectivos.

Los consumidores mantienen la incertidumbre y sus dependencias. No convierten un
acceso desconocido en admisión, una evidencia vencida en cierre ni la falta de una
cifra en cero. La política de presentación puede dejar de ofrecer una acción sin
borrar el hecho histórico y debe expresar su motivo. El panel informa de las comprobaciones
de fuentes y de las incidencias del mantenimiento; la entrega activa requiere un
cotejo específico con la revisión que sirve la aplicación.

La conservación y la publicación tienen políticas distintas según el contenido:

- Cursos: una oferta sin comprobación vigente y suficiente queda oculta en el
  catálogo público y las recomendaciones. La ficha, la evidencia y el motivo
  permanecen en el almacén y el panel. Ocultarla preventivamente no declara cierre
  ni baja; se puede volver a ofrecer tras una comprobación suficiente. El catálogo
  expresa requisitos publicados; la compatibilidad con una persona se decide
  aparte, sin prometer una plaza individual. Un intento fallido no anula una
  comprobación anterior todavía vigente ni amplía su plazo. Una evidencia nueva
  de cierre, sustitución o contradicción sí se evalúa antes de seguir ofreciendo
  el curso; el plazo nunca prevalece sobre un hecho contrario comprobado.
- Datos globales: una cifra histórica válida se conserva con su periodo y
  condiciones de uso aunque falle su actualización. Una edición más reciente no
  demuestra que la anterior sea incorrecta. Si consta publicada, se puede indicar
  «hay datos más recientes en preparación», conservando la evidencia de ese aviso,
  registrando el intento fallido y reintentando según la fuente. Sin constancia de
  una edición nueva, se declara solo que no se ha podido comprobar la actualización.
  Una corrección de la fuente, un error demostrado o una incompatibilidad impiden
  el uso afectado; perder comparabilidad no invalida por sí solo la cifra para su
  propio periodo. El historial conserva también las correcciones y su alcance.
- Administración: muestra diagnósticos, última comprobación válida, incidencias e
  intentos de recuperación. Ocultar contenido público no elimina sus avisos.

El panel incluye «Ofertas retenidas del catálogo» por edición o recurso, con el
motivo conservado, las referencias con SHA y fecha, la última comprobación válida
y el último intento. Lee una proyección privada versionada de la misma instantánea
admitida al cerrar mantenimiento; Node y Worker conservan esa proyección en la
única observación del recibo. No recalcula disponibilidad ni publica SQLite. La
lista aplica la regla común de retención en un corte de proyección explícito del
recibo, incluida la caducidad, sin volver a evaluar disponibilidad. Conserva
aparte el corte de las evaluaciones nativas y no confirma publicación efectiva
ni estado a la hora presente. El historial completo permanece en el registro
nativo; no se repite en cada recibo ni se presenta aquí como historial de despliegues.

La proyección admite hasta 4 MiB, 10.000 unidades y 10.000 referencias compartidas;
el panel pagina 50 unidades y exige la misma revisión entre páginas. Las URLs de
presentación omiten parámetros y fragmentos; el SHA identifica la captura original.
Un fallo conserva la última observación conocida con su fecha y un aviso mientras
la sesión siga autorizada. Un recibo anterior, ausente o ilegible nunca acredita
cero ocultas: se muestra «Sin registro disponible» o la incidencia de lectura.
La pérdida de autorización retira inmediatamente la información privada.
El archivo privado conserva cada recibo por su SHA original. Cuando su
reconstrucción reproduce exactamente los bytes autenticados, comparte una pieza
de catálogo por contenido entre trabajos con unidades, referencias y retenciones
idénticas; el sobre conserva el corte y la revisión originales. El índice de
archivo v3 recupera pieza y sobre antes de autorizar reenvío o avanzar la CAS.
Los recibos con formato no reconstruible se conservan literales, sin normalizar
espacios, escapes, fechas ni orden de claves. No se elimina ningún recibo anterior.
Una comprobación suficiente puede resolver una causa tras validar y publicar;
un cambio de texto o la fecha de ingestión por sí solos no acreditan recuperación.

Esta regla es un criterio de cierre transversal. Su cumplimiento se verifica con
casos de error de red, respuesta genérica, lectura parcial, evidencia vencida,
contradicción explícita y recuperación; documentar la regla no acredita que todos
los consumidores estén ya adaptados.

## Comprobar una actualización

`npm run verificar` incluye tipos, estilo y pruebas de la cadena y de esta
plataforma. Las pruebas no necesitan consultar fuentes remotas. Los ensayos con
capturas reales se ejecutan aparte, sobre un almacén candidato explícito.

Las comprobaciones comparan entrada y salida, verifican los contratos y la
conservación de evidencias, y reproducen fallos de lectura, escritura, interrupción
y recuperación. Una actualización compatible puede admitirse automáticamente;
un cambio de significado necesita una adaptación demostrable. La confianza de
un modelo no sustituye esa evidencia. Las comprobaciones automáticas y la revisión
del Equipo Faro se registran por separado.

El registro de aprendizaje conserva las identidades y escalas publicadas por DigComp.
La fuente de [Formación](cursos/fuentes/formacion/README.md) contrasta el marco original,
su preparado y la revisión admitida del registro. Sus 21 competencias no asignan
niveles a los cursos: cada afirmación de aprendizaje conserva su objetivo o módulo,
procedencia, marco y versión, método de extracción o inferencia y estado de revisión.

## Conexiones con las instituciones

La primera opción de adquisición es la API oficial del conjunto, cuando exista y
permita obtener los datos necesarios. Cada fuente debe declarar canal, identidad,
autenticación requerida, límites de consulta, cadencia, licencia y alcance; una
conexión pendiente no se presenta como instalada. Si no hay API adecuada, el lector
alternativo mantiene la misma procedencia y comprobaciones.

Las credenciales se configuran fuera del repositorio y de la entrega pública. La
cadena consulta, valida y prepara una versión antes de activarla; la web y los
motores consumen esa entrega, sin depender de llamadas en directo a terceros.
Una API que responde no acredita inscripción abierta ni vigencia semántica. Un
fallo de consulta no se convierte en una retirada; una baja confirmada retira la
oferta conservando su historial.

El [enfoque del panel](../docs/administracion.md#alcance-y-criterios-de-presentación) separa
salud, actualizaciones, secciones públicas y acceso. El mantenimiento no depende de
que una sección sea visible; los motores locales no necesitan un modelo de lenguaje
externo. Los requisitos de acceso y las operaciones disponibles se documentan en
la guía de administración de la instalación.

## Consultas para otras plataformas

La [definición de acceso por API, MCP y A2A](../docs/api/README.md#límites-de-las-consultas)
se apoya en una sola capa de consultas sobre la entrega admitida. Las ocho lecturas
publicadas comparten esa capa y sus límites; disponer de un recurso interno no lo
convierte en una operación pública. El catálogo de cursos ampliado tiene su propio
[contrato de entrega](cursos/entrega_catalogo.md). No se expone SQLite, capturas,
registros privados ni operaciones de mantenimiento. Cada contenido declara su
alcance de redistribución; los contratos conservan revisión, procedencia y límites
de uso.

## Conservación y transferencia

El almacén conserva los hechos históricos y las evidencias que justifican las
decisiones actuales. Una respuesta vacía o un fallo registrado no se elimina por
antigüedad. Los artefactos públicos reproducibles se identifican por generación;
una generación anterior no se mezcla con la entrega activa.

La [regla de acreditación](../docs/regla-de-la-acreditacion.md) documenta la norma
aplicable a las listas revisadas y las rutas operativas. Las firmas de revisión
no se sustituyen al reorganizar documentación o código.

La [guía de portabilidad](../docs/portabilidad.md) explica qué entradas, originales,
procedencias y registros necesita una instalación receptora. La entrega pública
no incluye SQLite privado, capturas de mantenimiento, credenciales ni sesiones.
La [construcción web](../docs/construccion-web.md) identifica y comprueba el artefacto
que consume la aplicación. La promoción debe conservar su revisión, manifiesto y
huellas; publicar un artefacto y comprobar una fuente son operaciones distintas.
