# Espacio de trabajo e identidad

Las piezas comunes de esta carpeta leen originales, preparan archivos y comprueban su integridad.
Utilizan Python 3.12 o posterior y su biblioteca estándar.

Los productores trasladados viven en los temas de [`plataforma_datos/`](../../README.md).
Esta carpeta conserva la orquestación, sus registros y la composición del paquete. Los lectores y
sus auxiliares viven en sus temas; las piezas compartidas, en `plataforma_datos/comun/`. El registro
estático selecciona cada productor; las fichas `fuente.json` aportan sus políticas y dependencias,
sin crear una segunda cadena de ejecución. Las rutas de código con prefijo `plataforma_datos/`
se expresan desde la raíz del repositorio; los comandos también se ejecutan desde esa raíz.

| Pieza | Responsabilidad |
| --- | --- |
| `plataforma_datos/comun/nucleo.py` | Rutas, tipos, errores y controles de validación; lectura con límite de tamaño. |
| `plataforma_datos/comun/entrada_salida.py` | JSON, huellas SHA-256, procedencia y escritura de archivos completos. |
| `plataforma_datos/comun/red.py` | Descargas HTTP(S) con límites de tamaño y tiempo; conservación del original conocido. |
| `plataforma_datos/orquestacion/ordenes.py` | Interpretación de órdenes y errores de las etapas de una fuente. |
| `plataforma_datos/comun/textos_y_cifras.py` | Conversión y normalización de los campos de las fuentes. |


## Datos publicados y espacio de trabajo

`datos/`, en la raíz del producto, contiene el paquete oficial utilizado por Faro.
La preparación usa `var/actualizacion/`, separada de ese paquete y excluida de Git:

- `originales/`: entradas con su procedencia y huellas.
- `preparados/`: resultados de la transformación de esas entradas.
- `validados/`: resultados y controles de validación.
- `revisiones/`: decisiones de revisión necesarias para preparar y admitir los datos.

Son etapas operativas, no tres copias del paquete publicado. Importar estos módulos no crea carpetas,
no descarga ni sustituye datos oficiales. Las rutas se resuelven desde el código, por lo que no dependen
del directorio desde el que se ejecuten ni de carpetas externas al producto.

Las descargas usan una identidad genérica de navegador, sin datos de la instalación; véase
[Identidad y turnos de consulta](#identidad-y-turnos-de-consulta). Los originales diferentes requieren
aceptación explícita o una equivalencia comprobada por la fuente. Cada escritura sustituye un archivo completo;
esa garantía individual no equivale a una transacción de varios archivos. No ejecutar dos escrituras
simultáneas sobre el mismo destino.

### Entradas de una instalación transferible

La entrega operativa conserva una generación coherente de `var/actualizacion/`, con las capturas y
procedencias necesarias, las entradas revisadas y los resultados admitidos. Esta carpeta no se sirve
desde la web. Clonar el repositorio no la traslada: el código y los datos públicos permiten usar Faro,
pero reconstruir o actualizar sus fuentes requiere también esas entradas operativas.

Al recrear los resultados, conservar las fichas de formación abierta, los textos propios y sus
traducciones, los lotes de catalán con su procedencia, las revisiones de acreditación y la tabla
`preparados/observatori/comarca-provincia.json`. Los agregados admitidos de `ia-nacional` y
`encuestas-isco4` son entradas externas al registro de actualización; sus microdatos no forman parte
de la entrega. Las capturas fijas o manuales no se sustituyen por una descarga de otra edición.

`validados/consorci/versiones-de-jdcj-za6r.json` es estado funcional: permite contrastar conjuntos
publicados en fechas distintas. Se conserva al trasladar una instalación y puede actualizarse tras
admitir una nueva versión. No reemplazarlo por una lista vacía ni por el historial de otra instalación.
Los demás resultados derivados se reconstruyen con `npm run datos:reconstruir -- --sin-paquete`,
en una copia aislada con las entradas presentes. Esa orden no descarga originales ni sustituye
el paquete público; después se exporta y se construyen los recursos web.

Mantener una sola generación operativa vigente. Los respaldos pendientes de una recuperación no se
consideran temporales prescindibles. Las fechas de las fuentes y las revisiones conservan su significado;
reconstruir datos no convierte una captura antigua en una consulta reciente.

## Identidad y turnos de consulta

`plataforma_datos/comun/red.py` usa el perfil central de
[`plataforma_datos/comun/perfil_web.py`](../../comun/perfil_web.py).
La versión y las cuatro cabeceras se leen de `config/identidad-web.json`, compartido
con TypeScript, Worker y los instaladores. Se contrastan con el generador canónico;
un archivo ausente, ilegible, ambiguo o contradictorio impide la consulta. Nunca
se leen configuraciones personales ni se deducen versión, idioma o plataforma del
equipo. La actualización del perfil es explícita y mantiene agente y pistas juntos;
la consulta no busca versiones de navegador en la red.

Se anuncia `Accept-Encoding: gzip, deflate`. El lector comprueba el tamaño en el
cable, la longitud declarada, la integridad del flujo y el límite del contenido
expandido. Los validadores y las huellas reciben los bytes descomprimidos. Una
codificación desconocida, un flujo truncado o un exceso se rechazan antes de
registrar una observación. La compresión no cambia los bytes del original admitido.

Por defecto, `descargar_url` usa el perfil `datos`: no añade idioma ni cabeceras
HTML a API, archivos o fuentes cuyo idioma importa. `perfil="idioma-original"`
conserva la negociación explícita del lector, por ejemplo `Accept-Language: ca`.
Solo `perfil="pagina"`, elegido para una página HTML sin dependencia de idioma,
añade las cabeceras HTML del módulo común (Accept HTML, es-ES y Sec-Fetch), sin
consultar archivos personales. Esta opción rechaza POST, Accept de API y
fuentes que ya declaran su idioma. No se decide el perfil por una extensión de URL.
Los clientes privados de mantenimiento, almacenamiento firmado y aprovisionamiento
mantienen sus contratos propios de transferencia; no usan el perfil de página.

`turno_por_dominio(url)` abarca envío, lectura y cierre o error. Serializa las consultas dentro del
proceso y exige dos segundos desde el cierre anterior para el mismo hostname normalizado, aunque cambien
el esquema o el puerto. Las redirecciones y reintentos instrumentados usan `registrar_redireccion`
tras terminar la respuesta anterior y antes de emitir la siguiente. No se permiten descargas anidadas.

`descargar_url` ya utiliza ese turno. Los clientes con transporte propio deben instrumentar cada envío,
o desactivar los reintentos y redirecciones internos: envolver una llamada externa no controla los
saltos ocultos de una biblioteca. El controlador no coordina procesos o equipos diferentes ni agrupa
subdominios distintos. La coordinación de ejecuciones corresponde al cerrojo del actualizador.

La pausa y la identidad no acreditan vigencia ni admisión de un dato. Se conservan los controles de
respuesta, tamaño, procedencia y validación de cada fuente. Las pruebas de transporte utilizan relojes
y respuestas simuladas, incluidos errores, cierres y redirecciones.

## Inventario de metadatos

`npm run datos:catalogo` muestra las fuentes y conjuntos declarados, las procedencias del paquete,
los consumidores identificados, los modelos y la Biblioteca. Conserva clases, dominios y huecos;
no descarga ni sustituye datos. [Alcance, campos y uso](../../../docs/catalogo-de-datos.md).

