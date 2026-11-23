# Admisión cotidiana del catálogo

`admision_catalogo.py` admite una instantánea SQLite **V10 cerrada** con independencia
de que proceda de investigación V2, de un productor posterior o de ambos. No
repite la importación inicial, descarga, evalúa vigencia ni activa entregas, y nunca
migra: una base de otra versión se rechaza.

## Interfaz

- `ReferenciaArchivo(ruta=Path(...), sha256=...)` identifica bytes esperados.
- `SolicitudAdmision(snapshot=..., procedencia={id_logico: referencia, ...},
  validacion_destino=Path(...))` selecciona entradas y un destino explícito.
- `admitir_snapshot(solicitud)` ejecuta auditoría y devuelve/escribe el informe.
- `exigir_snapshot_admitido(solicitud, sha256_validacion=...)` reutiliza la
  admisión común y comprueba los vínculos sin repetir la auditoría histórica.

La procedencia referencia los recibos, lotes o informes **ya existentes** del
productor/importación. Los IDs lógicos son privados y portables; el informe no
incluye rutas. Las huellas vinculan esos artefactos declarados con los bytes de la
instantánea admitida; no prueban por sí mismas que un texto sea oficial, que una
captura haya ocurrido o que un derecho de redistribución exista. Su semántica y
admisión pertenecen al productor y a los contratos respectivos. No se crea un
segundo registro de eventos ni otra cadena de manifiestos. Los intentos técnicos
siguen perteneciendo al registro común de la orquestación cuando se conecte el
productor; este componente no inventa consultas o intentos remotos.

## Controles y conservación

El único informe es el `validacion.json` estándar de admisión, con contrato
cerrado en `esquemas/admision_catalogo.json`. Sus controles no pueden estar vacíos.
Vincula SHA256 y tamaño del SQLite y de cada referencia, código efectivo,
contratos, versión SQLite y recuentos descriptivos. La auditoría comprueba
integridad SQLite, relaciones e historia mediante `auditar_unidades_vigencia`,
contenidos nativos/versiones/referencias y concordancia del índice FTS. No llama
al evaluador para recalcular resultados. Una unidad sin evaluación sigue sin
evaluación; `publicacion_confirmada` siempre es null.

Cada cambio de código, contrato, entrada o SQLite obliga a admitir de nuevo,
aunque no corresponda una consulta por cadencia. La comprobación de código se
basa en archivos de una revisión congelada, no pretende detectar funciones
sustituidas en memoria. Se contrastan las entradas antes y después del cálculo.
La lectura de una admisión es una operación de preparación/exportación, no una
operación que deba repetirse por petición web. La futura entrega pública debe
seguir separando hechos, estado en su corte, desconocidos y publicación.

Se requiere un área exclusiva sin otros escritores durante el cálculo. Los
archivos y padres enlazados simbólicamente, alias duros que sobrescriban entradas,
WAL y laterales SQLite se rechazan. El productor debe cerrar/checkpointar su
copia y dejarla en modo de diario normal antes de congelarla; la admisión no
recupera ni limpia archivos ajenos. Se protegen los archivos declarados, sus
laterales y el código/contratos efectivos; la carpeta que los contiene no se
convierte implícitamente en una entrada exclusiva completa. Las comprobaciones
no son un aislamiento del sistema operativo frente a escritores hostiles.

Límites: SQLite 512 MiB, 256 referencias, cada referencia 128 MiB, total 256 MiB,
informe 1 MiB, un millón de filas por colección contabilizada, 16 MiB por celda
de entidades/versiones. La auditoría de la historia de vigencia conserva sus propias guardas;
no se promete coste lineal para cualquier historial arbitrario. No hay lectura
remota ni dependencia nueva.

El reemplazo del informe es atómico mediante temporal propio en el mismo
directorio. Si el contenido es idéntico, no se reescribe ni cambia mtime. Un
fallo previo al reemplazo conserva el informe anterior; no se anuncia durabilidad
ante pérdida de alimentación (no hay fsync del archivo y del directorio). Las
fechas de recepción, captura, evaluación e ingestión permanecen en el SQLite y
los artefactos originales; ejecutar esta admisión no las rejuvenece.

## Uso en la composición y la entrega

Este componente no registra ni publica por sí solo una fuente. Lo invoca la
composición común del catálogo dentro del ciclo de actualización
(`componer_catalogo.py`): cada fuente prepara una copia y la admite
(`admitir_snapshot`), y `almacen_catalogo.conservar` exige la admisión anterior
con la huella de su informe antes de admitir la nueva. La entrega pública
(`entrega_catalogo.py`) parte de esa admisión con `exigir_snapshot_admitido` y
su huella, sin repetir la investigación V2, y no publica el linaje privado
(`linaje-privado.json`).


## Evidencias indexadas, opción explícita

`SolicitudAdmision.indices_evidencias` es un mapa opcional de ID lógico a
`IndiceEvidencias(archivo=ReferenciaArchivo(...), raiz=Path(...))`. El archivo debe ser un control JSON
sellado de versión 1 con `archivos_conservados`: lista de objetos que contienen exactamente `archivo`
(ruta relativa canónica) y `sha256` esperado. Los otros metadatos del control no autorizan referencias.
No hay selector JSON arbitrario, importación de código o descubrimiento de archivos presentes.

Sin índices, el informe conserva exactamente la forma de `schema_version: 1`. Con índices utiliza
`schema_version: 2` e incluye `indices_evidencias`: SHA/bytes de cada índice, número de archivos y sus bytes.
No contiene rutas privadas. Ambas formas se comprueban contra sus entradas efectivas y las mismas guardas;
las firmas de código/contrato actualizadas obligan a una revalidación explícita, sin migrar ni evaluar al leer.

El lector común verifica los SHA esperados contra CADA archivo al admitir y exigir la admisión; el proyector
consume esa misma guarda. No recalcula SHA esperados para aceptar modificaciones. Se rechazan claves JSON,
rutas o referencias físicas duplicadas, rutas no canónicas/absolutas/que escapen, enlaces simbólicos y
archivos indexados con enlaces duros. El destino no puede sustituir ninguna evidencia indexada.

Límites: 256 referencias lógicas contando índices; cada índice como máximo 16 MiB; como máximo 100.000
archivos indexados en toda la solicitud; 128 MiB por archivo; 256 MiB acumulados COMPARTIDOS entre referencias,
índices y cuerpos/recibos; informe de admisión 1 MiB y SQLite 512 MiB. No se reinicia el presupuesto por índice.
Una referencia repetida entre los metadatos planos y el índice consume ambos espacios declarados; no se
fusionan identidades de consultas por compartir bytes. Los cuerpos pueden reutilizar una única ruta por SHA.

Conservación por trozos (`trozos_catalogo.py`): un cuerpo de 4 MiB o más se guarda en su ruta de siempre como
manifiesto (huella y tamaño del cuerpo original y lista ordenada de trozos) y sus trozos, de 8 a 128 KiB con
cortes definidos por el contenido, se guardan una sola vez por su huella en `evidencias/trozos/`. La ruta y el
SHA del inventario, y todo lo que los cita, siguen siendo los del cuerpo original; cada consulta conserva su
recibo y su fecha. Toda lectura reconstruye el cuerpo y verifica SHA y tamaño antes de devolverlo. La admisión
cuenta en el presupuesto de 256 MiB los bytes almacenados (cada manifiesto y cada trozo una sola vez), comprueba
cada trozo por su huella y aplica los 128 MiB por archivo al cuerpo reconstruido; un manifiesto declara como
mucho 16.385 trozos, ocupa como mucho 2 MiB, es JSON canónico sin claves repetidas y no puede nombrar rutas: los
trozos se localizan solo por huella. `migrar_trozos_catalogo.py --almacen <ruta>` convierte un almacén existente
con reemplazo atómico por cuerpo, solo tras verificar su reconstrucción, y es repetible tras una interrupción.
Los originales de las fuentes de cursos usan el mismo formato: `conservar_bytes` guarda cada `.body` grande como
manifiesto en `<fuente>/cuerpos/` con sus trozos en `cuerpos/trozos/`, el recibo lo cita por la huella del cuerpo
original y `--originales-de <raíz>` los migra comprobando que la validación y el recálculo de cada fuente no cambian.

Al componer cada candidata, las páginas y los cuerpos web de su archivo de evidencias de entre 32 KiB y 4 MiB
usan trozos de hasta 32 KiB. Varias fichas o ediciones pueden compartir su plantilla HTML. Cada edición conserva
su recibo y su SHA-256 sobre el cuerpo entero. Los controles JSON conservan su representación original.

La historia no se borra para cumplir una cota. Al alcanzar capacidad se rechaza la nueva preparación sin
promoverla ni reemplazar la última admisión válida. El error identifica una cota local, no un fallo o cierre
de la fuente. No se promete conservación ilimitada: cualquier ampliación futura de almacenamiento exige
su propia decisión y comprobación; este contrato no inventa una política de retirada o archivado.
