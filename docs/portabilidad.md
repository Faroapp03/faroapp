# Portabilidad y transferencia de la instalación

El producto contiene sus fuentes, datos oficiales, configuración de ejemplo, herramientas de mantenimiento y
pruebas. Puede situarse en una carpeta distinta: las rutas internas se resuelven desde los módulos de la
instalación, incluidas carpetas con espacios y caracteres Unicode. No necesita otra copia del proyecto.

## Contenido y configuración

- `src/`: dominio, API y adaptadores de plataforma.
- `datos/`: datos canónicos, manifiestos y documentación de las fuentes.
- `web/`: recursos públicos y publicaciones para el navegador.
- `herramientas/`, `scripts/` y `pruebas/`: construcción, mantenimiento y comprobaciones propias.
- `plataforma_datos/orquestacion/`: preparación, validación y consultas de las fuentes incorporadas, con sus pruebas Python.
- `var/actualizacion/`: entradas y resultados operativos de la cadena, separados del paquete canónico y de Git.
- `config/` y los archivos de ejemplo: parámetros para que la entidad configure su instalación.
- `registro/`: estado operativo local; queda fuera del código versionado y de los recursos públicos.

Instalar las dependencias mediante el lockfile y las instrucciones del [README](../README.md). Los entornos
`node_modules/` y `.venv/` se preparan en la instalación receptora. No transferirlos como sustituto de ese proceso.
Los datos mantienen sus condiciones de reutilización y las bibliotecas sus licencias; conservar esos documentos
y el archivo `LICENSE` junto al código.

Las cuentas de alojamiento, el dominio, los orígenes permitidos y los permisos pertenecen a
la configuración de cada despliegue. Usar las plantillas y el [índice de configuración](configuracion.md).
Los motores locales no requieren una cuenta ni una clave de proveedor externo de inferencia.
Los secretos se proporcionan por separado y no forman parte del repositorio ni de `web/`.
La transferencia de una instalación activa debe tratar también su estado operativo y sus copias consistentes;
copiar solo el código no traslada credenciales emitidas, revocaciones ni consumos acumulados.
Para reconstruir datos, trasladar también las entradas y procedencias exigidas por la
[cadena de datos](../plataforma_datos/orquestacion/README.md); las capturas de una versión no siempre se pueden recuperar
consultando otra vez al proveedor. Los temporales y los resultados reproducibles no sustituyen esas entradas.
Una entrega de carpeta puede incluir esa generación operativa; un clon de Git necesita recibirla por separado,
porque `var/actualizacion/` no está versionada. Conservar también el historial funcional de Consorci y las
entradas revisadas indicadas en la cadena. Las capturas operativas se mantienen fuera de los recursos web públicos.

## Trasladar las entradas de actualización

La herramienta `plataforma_datos.orquestacion.generacion_operativa` reúne los datos canónicos, las entradas y el estado
necesarios para continuar la actualización: los originales de todas las fuentes del registro (entre ellas EPA, EAES
y ofertas) y las entradas fijadas de Métodos y Notas CNO-11, que consumen reconstructores entregados sin una consulta
periódica registrada (tabla `ORIGINALES_DE_RECONSTRUCCION`). Cada original que el manifiesto del paquete cita debe
viajar, estar presente y coincidir con el SHA-256 de su procedencia: no basta con trasladar las salidas ya calculadas
ni con conservar el índice solo.
Esta conservación no renueva sus fechas ni añade consultas automáticas.
Los originales grandes conservados por trozos viajan con su descriptor y todos los trozos que necesita. Los trozos
compartidos se incluyen una sola vez. La generación verifica tanto los archivos físicos como la huella y el tamaño
del contenido reconstruido; conserva la procedencia original y no expande los cuerpos en disco para trasladarlos.
También viajan la pareja JSON/Markdown de la última ejecución y, si es distinta, la pareja que referencia el estado:
permiten consultar el último resultado tras el traslado. Una pareja incompleta o una referencia ajena a los informes
fechados de `ejecuciones/` detiene la exportación; no se incorpora por ello toda la historia de ejecuciones.

Con el mantenimiento detenido y sin otros escritores, ejecutar
desde la raíz de la instalación de origen:

```sh
.venv/bin/python -m plataforma_datos.orquestacion.generacion_operativa exportar . \
  --destino "/ruta/privada/generacion" \
  --revision-codigo "<SHA-completo-del-codigo>"
```

Conservar el resumen JSON: identifica la revisión, la huella del manifiesto y el número de archivos y bytes.
Entregar esa referencia por un canal de confianza junto a la generación. Para restaurarla, usar una copia del
código con sus dependencias instaladas y elegir una **carpeta de destino nueva**:

```sh
.venv/bin/python -m plataforma_datos.orquestacion.generacion_operativa restaurar \
  "/ruta/privada/generacion" --destino "/ruta/privada/instalacion-nueva" \
  --revision-codigo "<SHA-completo-del-codigo>" \
  --sha256-manifiesto "<SHA256-esperado-del-manifiesto>"
```

La restauración comprueba el manifiesto, cada archivo y la admisión del conjunto. No mezcla generaciones ni
reemplaza una instalación existente. Incorporar después los archivos de código de esa revisión, conservando
los datos restaurados; si el código incluye `datos/`, comprobar que coincide exactamente antes de combinarlo.
Preparar las dependencias en el destino y aplicar la comprobación de entrega descrita más abajo.

Los tres originales cartográficos de `var/actualizacion/originales/globo/` se trasladan además por separado:
no pertenecen a la cadena periódica. Sus nombres, procedencia y SHA-256 están fijados en
`herramientas/web/traer-globo.ts`; la [construcción del globo](construccion-web.md) los verifica al utilizarlos.
Los cerrojos temporales no se transfieren. Esta generación tampoco incluye las credenciales ni las sesiones
de una instalación activa; sus copias consistentes requieren el procedimiento de su almacén.

Para conservar o recuperar generaciones mediante un bucket privado, consultar el
[almacén de datos](almacenamiento-datos.md).

### Generación exportada con otra revisión del código

Una generación queda ligada a la revisión del código que la exportó: es la que indica `revisionCodigo` en el recibo de
la exportación y en el `manifiesto.json` de la generación. Conviene conservar el código de esa revisión junto a la
generación, porque la restauración lo necesita. La admisión del catálogo de cursos
(`var/actualizacion/validados/catalogo-cursos/validacion.json`) registra en `codigo_sha256` las huellas de los archivos
de código que hicieron su auditoría, y la verificación de la generación las compara con las del código que la lee
(contrato y orden en la tabla de formatos de la [operación manual de datos](operacion-manual-datos.md)). Con otra
revisión del código, `verificar` y `restaurar` rechazan la generación con el mensaje genérico «Generación operativa no
verificable.», antes de copiar nada. La admisión no se relaja para aceptarla; el camino es este:

1. Restaurar la generación con el código de la revisión que indica su `revisionCodigo`, como se describe en esta
   sección.
2. Sustituir en esa instalación el código por el de la revisión nueva. Los archivos de `datos/` pasan a ser los del
   código nuevo; los que no fija `datos/manifiesto.json`, como `datos/vectores-movil/LICENCIA.md`, pueden diferir de
   los restaurados.
3. Ejecutar `.venv/bin/python -m plataforma_datos.cursos.revalidar_catalogo` en esa instalación. Repite la auditoría
   completa del catálogo con el código nuevo y solo reescribe
   `var/actualizacion/validados/catalogo-cursos/validacion.json`. Si la auditoría no pasa, no cambia ningún archivo,
   el catálogo sigue sin admitir y la orden termina con código 1 y una línea «Error: …» que explica el motivo. Si otro
   proceso cambia el código o la instantánea mientras se revalida, el fallo llega con `validacion.json` ya reescrito:
   la línea «Error: …» lo dice, y la orden se repite sin otros procesos que escriban.
4. Exportar una generación nueva con la revisión nueva, conservar su recibo y restaurarla como se describe en esta
   sección.

## Adaptadores y requisitos

El dominio comparte contratos con los adaptadores de Node, navegador y Cloudflare. El arranque
[Node local](operacion-local.md) escucha en el propio equipo; no equivale a un servidor público configurado.
El adaptador Cloudflare utiliza Workers, recursos estáticos y los servicios de almacenamiento y control que
requiera cada función. La [administración](administracion.md#instituciones-y-accesos) detalla los almacenes
SQLite de instituciones, sesiones y accesos para Node y Cloudflare. La identidad administrativa requiere Access;
una clave de consulta nunca sustituye esa identidad.

Otro alojamiento necesita un adaptador compatible o la adaptación correspondiente, además de HTTPS,
almacenamiento persistente y controles de acceso. No basta con copiar la configuración de Cloudflare a otra
plataforma. Las operaciones de dominio y los datos no deben modificarse para cambiar las cuentas de despliegue.

## Comprobación de la entrega

Desde una copia independiente, instalar las dependencias y preparar las publicaciones de la
[construcción web](construccion-web.md). La verificación necesita además la base ESCO local, preparada desde la
captura recibida con la entrega y comprobada con sus huellas, como indica la
[base ESCO para la verificación](../README.md#base-esco-para-la-verificación). Ejecutar después `npm run verificar`,
que comprueba esas publicaciones sin repararlas, y comprobar las funciones habilitadas con la configuración receptora.
Revisar también dominio, autenticación, almacenamiento y registros de infraestructura antes de publicar.

El mantenimiento tiene como plataformas objetivo macOS y Linux. Las comprobaciones actuales se han ejecutado
en macOS; Linux y el despliegue receptor requieren sus ensayos. El [panel administrativo](administracion.md)
incluye conectividad factual, secciones y actualización de datos; su acceso real y la configuración final del alojamiento
se preparan para cada instalación. Ninguna prueba local acredita por sí sola compatibilidad con todos los alojamientos.
