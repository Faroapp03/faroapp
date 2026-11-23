# Cursos

Código y contratos de formación: los lectores de cada fuente (`fuentes/<id>/lector.py`) y el catálogo SQLite V10,
con su admisión, su composición en la actualización (`componer_catalogo.py`) y su entrega a la aplicación
(`entrega_catalogo.py`). El catálogo separa proveedor, programa, edición, variante de modalidad, centro y anuncio.
Conserva evidencias, observaciones y versiones sin decidir utilidad para una persona, selección, elegibilidad ni
inscripción.

El código requiere Python 3.12 y SQLite con JSON1 y FTS5. No contiene SQLite, capturas externas ni datos personales.
La cadena de actualización trabaja con el catálogo admitido de la instalación, en
`var/actualizacion/validados/catalogo-cursos/` (`almacen_catalogo.RUTA`). Las herramientas manuales reciben sus bases
y capturas como argumentos; están en [operaciones manuales de datos](../../docs/operacion-manual-datos.md).

## Estructura

- `catalogo.py`: validación, transacciones, procedencia e historia SQLite V10.
- `contrato_fichas.py`: hechos publicados, periodos, modalidad y costes separados.
- `contrato_aprendizaje.py`: aprendizaje previsto y referencias, sin equivalencias implícitas.
- `vigencia.py`: evaluación pura con observaciones y política explícitas; no consulta reloj, red ni SQLite.
- `fuentes/<id>/`: una casa por fuente, con su lector y auxiliares. FUNDAE y
  Barcelona Activa alojan también sus adaptadores candidatos en su propia casa.
- `fuentes/hp_life/lector.py` y `fuentes/claude_academy/lector.py`: lectores puros
  candidatos; `fuente.json` y README generado describen su lectura sin habilitar actualización ni publicación.
- `herramientas/normalizar_investigacion.py`: conversión explícita de investigación
  contrastada; no es otra fuente ni un productor registrado.
- `esquemas/`: contratos JSON y registro de aprendizaje; son recursos del paquete.
- `clasificacion/`: contrato del idioma, el nivel y la materia que decide el productor para cada oferta, con sus
  tipos, sus reglas y la interfaz `clasificar(oferta, evidencias)` de cada fuente. Se describe con ejemplos en
  [Entrega del catálogo](entrega_catalogo.md#clasificación-de-cada-oferta-versión-7).
- `exigencias_entrega_catalogo.py`: el error y las exigencias de forma, texto y URL que comparten el contrato de la
  entrega y el de la clasificación.
- `lecturas/`: el registro de lo que trae cada lectura del censo de una fuente: su contrato, su almacén en
  `validados/<fuente>/lecturas/`, la regla de salud que la califica, las aceptaciones de una nueva referencia y la
  emisión común con la que cada fuente la guarda. Se describe en [Lecturas por fuente](lecturas/README.md).
- `retirada_por_evidencia.py`: la regla de retirada, que decide con evidencias si un curso deja de publicarse. Se
  explica en [Retirada por evidencia](retirada_por_evidencia.md).
- `decisiones_retirada.py`: el registro inmutable de lo que la regla decidió tras cada lectura de una fuente, en
  `validados/<fuente>/decisiones/`.
- `altas_en_sombra.py`, `decisiones_en_sombra.py`, `catalogo_servido.py` y `paquete_servido.py`: la regla en sombra.
  Qué ámbito de cada fuente se decide, la decisión de cada lectura comparada con lo publicado, y cómo se lee lo
  publicado: el catálogo de cursos servido y el paquete de datos.
- `error_de_retirada.py` y `lectura_error_de_retirada.py`: la medida del error de retirada, los cursos retirados que
  reaparecen en una lectura sana de su fuente; la primera es pura y la segunda lee el almacén sin escribir nada.
  `intervalo_de_jeffreys.py` y `tasa_de_poisson.py` son la estadística en que se apoyan la medida y la activación.
- `activacion_de_la_retirada.py`, `estado_de_la_retirada.py` y `aplicacion_de_la_retirada.py`: cuándo la regla de una
  fuente pasa de `sombra` a `activa` y cuándo vuelve, el registro de su estado en cada ciclo
  (`validados/<fuente>/retirada/`) y lo que retira según ese estado.
- `retirada_en_el_catalogo.py` y `retirada_en_el_paquete.py`: lo que la regla activa de una fuente quita de lo
  publicado. La entrega del catálogo retiene esos cursos con el motivo `retirada_por_evidencia` y la exportación del
  paquete los quita del archivo del SOC, del Consorci o de Citilab; en sombra, lo publicado no cambia ni un byte. El
  estado de la regla viaja en el linaje de la entrega y entre los orígenes del manifiesto del paquete.
- `comprobacion_pagina/`: la comprobación de la página pública de un curso, la segunda evidencia de baja que usa la
  regla. Se describe en [Comprobación de la página de un curso](comprobacion_pagina/README.md).
- `pruebas/`: datos sintéticos y pruebas sin red. Las capturas reales son entradas externas de ensayo.

## Destinatarios y procedencia

`normalizar_destinatarios.py` aplica el vocabulario versionado de `esquemas/` y
sus alias exactos. Conserva el texto publicado, las evidencias, los desconocidos
y la clasificación de origen; una recomendación de público no acredita un
requisito excluyente ni admisión personal. Los códigos propuestos siguen
identificados como propuestas.

La generación amplía `normalizar_datos_edicion` solo al proporcionar las dos
configuraciones explícitas. Sin ellas conserva su salida anterior. Las validaciones
`validar_datos_edicion` y `validar_lote_fichas` exigen ambas reglas si el resultado
recibido contiene `destinatario`, tanto en programas como en ediciones. La recepción
rechaza una traza ausente o modificada; conserva la ficha sin repararla. La validación
operativa exige tipos, versión y huellas de las reglas, y recalcula la procedencia;
el fragmento JSON Schema documenta la forma, sin requerir un evaluador adicional.

Repetir una normalización conserva el primer original. La clasificación
editorial de la investigación se conserva aparte cuando no acredita un hecho
publicado en la ficha actual.

## Entrada y salida

`esquemas/contrato.json` describe lotes 1, 2 y 3. Un lote tiene observación UTC,
fuente y colecciones de entidades con identidades estables. Los formatos 2 y 3
amplían oferta y aprendizaje respectivamente; no convierten variantes o anuncios
en ediciones confirmadas. Los otros esquemas documentan registro y vigencia.

El núcleo recibe un diccionario o JSON y una ruta de base explícita. Devuelve
recuentos e identificadores de ejecución. Guarda negocio, evidencias e historia;
una ausencia en una entrada parcial no borra entidades. La conciliación de una
fuente exige un censo completo acreditado. Publicación en catálogo no equivale a
matrícula abierta, plaza ni acceso personal.

La API de conciliación agrupa el censo en `InstantaneaCatalogo` y sus opciones de
verificación en `OpcionesCiclo`, ambos con argumentos nombrados. Las llamadas son
`conciliar_instantanea(base, instantanea)` e
`importar_y_conciliar(base, entrada, instantanea, opciones=opciones)`. Los objetos
no convierten valores ni sustituyen la validación del núcleo. Las firmas de
`cargar_lote` y `cargar_lotes` se conservan.

Las importaciones compuestas usan el conjunto completo de sus adaptadores:
`lotes` y `canales_temporales`, más controles e incidencias. No descartar canales
para importar solo sus lotes. Una captura real antigua, un solape conflictivo o
la omisión de un canal ya protegido deja la entrada pendiente y revierte toda la
operación. La misma captura con negocio idéntico se puede repetir. Los tiempos
y vínculos de canal se guardan fuera del negocio; no generan por sí solos una
versión de programa o edición.

Sin atribución comprobada campo a canal, un cambio compuesto con un canal
repetido queda pendiente aunque sea una actualización parcial legítima. Una
fuente auxiliar nueva no autoriza rejuvenecer otra antigua. El control de
llegada no certifica precisión de extracción, autenticidad remota ni ausencia
de una reversión editorial del servidor.

El sello de cada canal describe el estado realmente guardado, incluso cuando
aprendizaje conserva decisiones revisadas.

## Escritura del catálogo V10

SQLite V10 distingue la revisión local de datos de una nueva observación remota.
Una corrección con las mismas capturas conserva sus fechas y referencias; no
acredita vigencia nueva. Las escrituras comprueban la integridad y actualizan
entidades, historia y búsqueda en la misma transacción.

## Uso

La [guía de operaciones manuales](../../docs/operacion-manual-datos.md) reúne las órdenes, APIs y pruebas soportadas.

Desde la raíz del repositorio, las entradas son módulos convencionales:

```sh
python -m plataforma_datos.cursos.catalogo --help
python -m plataforma_datos.cursos.fuentes.fundae.digitalizate --help
python -m plataforma_datos.cursos.fuentes.barcelonactiva.robot_cibernarium --help
python -m plataforma_datos.cursos.herramientas.normalizar_investigacion --help
```

El núcleo admite un lote simple explícito:

```sh
python -m plataforma_datos.cursos.catalogo importar --base candidata.sqlite3 --entrada lote.json
python -m plataforma_datos.cursos.catalogo resumen --base candidata.sqlite3
```

Los adaptadores protegen sus importaciones compuestas mediante sus APIs:

```python
from plataforma_datos.cursos.fuentes.fundae.digitalizate import importar_captura

resultado = importar_captura(base_candidata, raiz_capturas)
```

Las rutas relativas de argumentos se resuelven respecto al cwd del llamador;
los recursos internos se resuelven desde el paquete. Para ejecutar desde otra
carpeta sin instalarlo, la raíz del repositorio debe estar en el `PYTHONPATH`
estándar de Python. Este paquete no modifica `sys.path` ni presume instalación
global.

## Conservación y comprobaciones

Los errores revierten entidades, pruebas, observaciones y conciliación en la
misma transacción. El detalle de un rechazo temporal se conserva junto a la
captura externa; no se crea una falsa ejecución admitida. Cibernàrium distingue
captura completa y publicación confirmada, y guarda el rechazo en su informe.

Las pruebas del paquete se ejecutan con:

```sh
python -m unittest discover -s plataforma_datos/cursos/pruebas -t .
```

La evaluación pura de vigencia recibe `ahora` y política explícitos; sus estados
no activan una oferta automáticamente. Los cuatro adaptadores conservan los
hechos y los desconocidos de sus fuentes. No se redistribuyen cuerpos externos
con este paquete; la licencia del repositorio no extiende permisos sobre datos,
textos o condiciones de terceros.

## Fuentes ocupacionales y catálogo de Cursos

`plataforma_datos.orquestacion.reconstruir.FUENTES_EN_ORDEN` conserva los productores
de los recursos ocupacionales en `datos/`. El catálogo SQLite y su recurso estático público
tienen la admisión y composición comunes descritas abajo; importar un candidato
no sustituye los recursos ocupacionales ni acredita la activación de una instalación.

| Fuente | Canal y alcance | Aplicación al catálogo compartido |
| --- | --- | --- |
| FUNDAE y Digitalízate | `adquisicion.py` consulta los índices públicos en `catalogos/`; `ediciones.py` consulta en `ediciones/` las fichas de las ediciones abiertas que descubre el índice de formación subvencionada, y el lector publica `fundae.json` desde ellas con su evidencia (`salida.py`: una ausencia o un fallo no dan de baja; un índice caído conserva la salida anterior). | `actualizacion.py` registra presencia por identidad. La pertenencia a un índice no acredita matrícula, gratuidad ni admisión personal. |
| Barcelona Activa | El lector conserva las fichas ocupacionales; publica las formaciones de IA desde el censo de su ámbito de IA (`censo_ia.py`, `cibernarium-ia/`) cruzado con el censo completo admitido de `cibernarium/`, y un censo parcial deja la salida anterior. | `actualizacion.py` atribuye campos API y registra observaciones por edición nativa, con controles de matrícula y calendario propios. |
| HP LIFE | Recepciones de fichas y declaraciones de formación. | `actualizacion.py` conserva recursos nativos y evalúa la oferta continua acreditada. |
| Cibervoluntarios | Censo, materiales y declaraciones públicas vinculadas a cada recurso. | `actualizacion.py` aplica hechos y vigencia; los alias de otro catálogo necesitan identidad demostrada. |
| Claude Academy | Índice oficial, FAQ, fichas conocidas y altas enlazadas. | `actualizacion.py` aplica hechos y vigencia, separando formación, certificado y práctica. |

La ubicación no activa una fuente. `fuente.json` declara su operación y sus
conjuntos; sus README se generan desde esa autoridad. Una fuente sin consultas
registradas comienza en SIN_INTENTO: importar, restaurar o mover archivos no
acredita una consulta. La instalación programa los módulos declarados; el catálogo
compartido requiere su inicialización y admisión explícitas.

Los canales recurrentes FUNDAE y Cibernàrium comparten la casa de sus lectores
ocupacionales, conservan sus salidas y solo aplican los campos bajo su contrato.
SOC, Consorci, Agència, acreditación, Citilab, formación abierta, certificados,
ACTIC y memoria FP.CAT mantienen sus propios contratos en `fuentes/<id>/`.

La sustitución del productor de una entrega requiere cambiar su registro y retirar
la ruta anterior en el mismo cambio, con sus consumidores y pruebas. El control
`comprobar_registro` rechaza dos productores para la misma casa de datos aunque
se registren con nombres distintos. El cierre debe conservar entradas, resultados
y contratos; una candidata más amplia no pasa a ser oferta disponible por el
hecho de tener más registros.

## Contratos y operaciones del catálogo candidato

Los documentos de cada componente conservan sus contratos y límites de conexión:

- [Atribución de campos a canales](atribucion_temporal.md): cambios parciales con capturas y responsabilidades explícitas.
- [Registro de vigencia](registro_vigencia.md): evaluaciones, unidades tipadas e historia sin reevaluación al leer.
- [Admisión cotidiana](admision_catalogo.md): auditoría de una instantánea cerrada y vínculo con las entradas.
- [Entrega del catálogo](entrega_catalogo.md): proyección pública y linaje privado de una instantánea admitida.
- [Conexión pública de Cursos](PUBLICACION.md): `publicar_catalogo.publicar`, que escribe el recurso estático público del
  catálogo y su referencia por SHA a partir de una entrega admitida.
- [Preparación de HP LIFE](fuentes/hp_life/ACTUALIZACION.md): `actualizacion.py` de HP LIFE, que añade sus
  recepciones a una copia de una instantánea V10 admitida y obtiene su admisión común.


## Primera creación V10

Una base nueva nace directamente en el formato V10:

```sh
python -m plataforma_datos.cursos.crear_catalogo --base candidata.sqlite3
```

La base nace vacía y no acreditada como oferta: conserva únicamente el esquema
V10 verificado. La importación, evaluación de evidencia, admisión y publicación
siguen siendo pasos explícitos. Repetir sobre una V10 íntegra solo la audita,
sin vaciar filas ni modificar bytes o fechas. Una base de otra versión se rechaza.

La creación prepara y audita una base privada antes de promoverla con exclusión.
Un corte no capturable puede conservar una carpeta .crear-catalogo-* junto al
destino, para revisión; no publica una base parcial ni impide crear de nuevo.
El enlace final y los directorios se sincronizan antes de retirar la candidata.
La repetición recupera solo un alias temporal propio del mismo inode y SHA,
bajo exclusión de creadores; cualquier hardlink ajeno mantiene el rechazo sin
retirar archivos. No se purgan automáticamente los demás intentos anteriores.

## Operación del catálogo compartido

La única SQLite operativa es `var/actualizacion/validados/catalogo-cursos/catalogo.sqlite3`.
El mismo directorio conserva su control de inventario, admisión y evidencias históricas.
La inicialización requiere una entrada explícitamente admitida y no comprueba fuentes ni renueva fechas.
Un cambio de los contratos de admisión exige revalidar esos mismos bytes antes de utilizarlos con la revisión nueva.

### Sembrar un almacén nuevo

Si no hay almacén que restaurar, se siembra uno nuevo desde la raíz de la instalación:

```sh
.venv/bin/python -m plataforma_datos.cursos.sembrar_almacen
```

La orden crea la SQLite V10 vacía (`crear_catalogo`), la admite con una única procedencia, el acta
`creacion-almacen` (versión y huella del esquema), y la conserva en su casa bajo el cerrojo común. No importa
ofertas ni listas escritas a mano. Si ya hay un almacén, termina con código 1 y no lo toca.

Después, el ciclo normal da de alta los cursos con su evidencia. Solo las fuentes con censo completo propio
(`operacion_fuente.CENSO_PROPIO`: Cibernàrium, Cibervoluntarios, Claude Academy y FUNDAE con el censo de
Digitalízate) admiten partir de cero identidades conocidas; la primera alta de cada una incorpora también su
proveedor. FUNDAE solo aplica tras una siembra un conjunto con altas de un censo completo calculado con las identidades
del almacén; los anteriores sin instalar se conservan sin aplicar y la composición lo dice en `fundae_sin_aplicar`. Un curso de
Digitalízate solo cuenta como presente por la ficha de un proveedor de la lista activa; se retira con un censo
completo que lo dé de baja o de otro tipo, o que no lo traiga (proveedor activo, dado de baja o que ya no existe)
cuando el buscador del catálogo 1 de ese día tampoco lo lista. HP LIFE solo vuelve a consultar cursos ya
admitidos: sobre un almacén sin identidades suyas su consulta falla (módulo en ámbar en el panel) y
`componer_catalogo` no aplica sus conjuntos validados ni pendientes anteriores
(`componer_catalogo.PROVEEDORES_SOBRE_CURSOS_ADMITIDOS`), que se conservan como evidencia. El resultado de la composición lo lista
en `sin_identidades`.

Lo que se publica tras una siembra es solo lo que esas cuatro fuentes acreditan, y crece ciclo a ciclo:

- Claude Academy y Cibervoluntarios dan de alta en el primer ciclo lo que su censo trae y acredita
  (Cibervoluntarios, solo con su método confirmado).
- Cibernàrium da de alta por su censo de la API; cada ciclo descarga como mucho `MAX_FICHAS_NUEVAS` (20) fichas
  HTML de actividades nuevas, que completan datos pero no condicionan el alta.
- HP LIFE, FUNDAE y los cursos de otros proveedores importados en lotes anteriores no vuelven: solo regresan
  restaurando el almacén conservado. Mientras ninguna fuente aporte cursos, el paso falla con `almacen-vacio` y
  sigue publicada la lista anterior; en cuanto una aporta alguno, se publica ese subconjunto.

Por eso sembrar es el último recurso: si existe una copia conservada del almacén, se restaura.

### Cuando el almacén no sirve

`componer_catalogo` no publica nada y termina con código 1 si el almacén no sirve. Su motivo empieza por un
código cerrado (`fallos_almacen.py`):

| Código | Cuándo |
| --- | --- |
| `almacen-ausente` | No hay almacén en la casa operativa. |
| `almacen-ilegible` | El directorio existe sin control, o el control, la admisión o la instantánea no se leen con integridad. |
| `almacen-vacio` | Tras aplicar las fuentes, la instantánea no tiene ningún curso; no se publica un catálogo vacío. |

El paso queda en rojo, el paquete en ámbar y la entrega vigente sigue publicada. La orquestación añade el código
al motivo del paquete, y `estado_panel` lo expone en la fila `paquete` como `motivoAlmacen` (un código de la
lista), sin texto libre ni rutas; sin ese fallo la fila conserva su forma anterior.

`almacen-ilegible` cubre lo que falla al abrir el almacén antes de aplicar las fuentes: un directorio sin control,
un control alterado, un archivo que no es SQLite, otro esquema o una instantánea cuya huella no coincide con la
admitida. Un fallo posterior, al aplicar una fuente o al proyectar la entrega, también deja el paso en rojo y no
publica, pero sin código de almacén: su motivo llega al informe.

`hp_life`, `cibervoluntarios`, `claude_academy`, `fundae` y `barcelonactiva`
son módulos independientes del ciclo común,
con originales, preparación, controles y salud por fuente. Consultan secuencialmente y sin cuentas.
Ciber reconsulta el censo y, con el censo completo, el destino registrado de cada material conocido que no trae (una
petición por material, sin seguir redirecciones); Academy une identidades conocidas y enlaces nativos del
índice oficial; HP LIFE une las suyas con su listado público (altas con ficha íntegra y página del listado, bajas
solo con el listado completo corroborado por la ficha). La ausencia en un índice parcial no acredita retirada.
HP LIFE consulta además su ayuda en español, donde declara que sus cursos son gratuitos: si esa declaración falta o cambia,
es un fallo de método (las comprobaciones de la consulta quedan como fallos, la oferta no se renueva, la fuente no se acredita y el panel lo avisa), y el
pendiente de un curso ilegible se sustituye en cada consulta en lugar de acumularse.
El productor HP aplica sus recepciones al registro nativo y evalúa la disponibilidad con las reglas existentes.
Ciber aplica sus recepciones mediante el contrato por recurso; su mera presencia en el censo
no concede ofertas públicas. Retira un material solo con el censo completo: porque lo declara borrado (`erased`) o con un estado distinto de «Disponible» (el motivo y el valor literal quedan en la evidencia), o
porque no lo trae y su destino responde 404 con la página de error de la plataforma de cursos; con un 303 al inicio de
sesión lo mantiene y avisa, con cualquier otra respuesta no cambia nada y avisa, y con un censo parcial no retira nada.
Un retirado que sigue ausente no se vuelve a consultar mientras el registro lo tenga retirado. Un estado que Faro no conoce (distinto de «Disponible», «Descatalogado» y «Pendiente») frena todas las bajas de ese día y el panel lo avisa. Un retirado que sigue ausente cuenta como resuelto, y cada destino pedido cuenta en la cobertura del día. Las consultas a destinos las acota el número de materiales conocidos. Si el material retirado vuelve a un censo completo disponible y sin borrar, se ofrece de nuevo. FUNDAE comprueba pertenencia al catálogo sin sustituir la prueba
directa de acceso. Cibernàrium conserva la identidad de cada edición, su calendario y matrícula;
una edición ausente del censo mantiene su historia y no se declara cerrada por ausencia.
Academy aplica las recepciones admitidas a la misma SQLite: altas sin edición inventada,
cambios limitados a título y contenido bajo contrato, anclaje previo sobre negocio idéntico
y evaluación de oferta publicada continua. Si el primer contenido ya cambió, solo admite
el cambio después de reproducir el contenido anterior desde la captura histórica vinculada.
Sin ancla acreditada conserva la entidad y registra un pendiente concreto, sin ofrecerla.

Tras los módulos, `python -m plataforma_datos.cursos.componer_catalogo` prepara en la candidata
la SQLite, el DTO público admitido y su referencia por SHA. La promoción del paquete común incluye
`datos/`, `web/` y la instantánea compartida en la misma transacción. Un error de otra fuente conserva
la última salida buena; el consumidor filtra el vencimiento con su propio reloj, sin consultar la base privada.
El exportador de generaciones existente conserva la instantánea cerrada y sus pruebas, y admite fuentes sin
versión buena cuyos originales todavía no existen. Ni copiar ni restaurar acredita una consulta remota.

El registro de competencias DigComp conocido no acredita niveles de entrada o salida de un curso.
Las propuestas y los campos desconocidos conservan su alcance; no se asignan niveles por el título.

El último conjunto bueno de cada fuente conserva `procedencia-admitida.json` con sus bytes y SHA exactos.
El índice plano de originales conserva todos los cuerpos, recibos e intentos; no se archiva una copia
acumulativa de ese índice por cada consulta. Una denegación conserva el intento nuevo y el índice admitido anterior.


El control de la instantánea declara `conservacion.version = 1` e identifica el único índice actual
regenerable, `indices/control-hp.json`, ligado a su procedencia y SHA exactos. El índice vigente
sigue siendo plano. Las entradas anteriores sin ese contrato se conservan completas como prefijo
histórico; no se reclasifica ni elimina ningún archivo existente al adoptar el contrato compacto.

Cada nueva admisión HP conserva un recibo inmutable por SHA con huellas de la instantánea de entrada/salida,
admisiones, código del productor y de admisión, corte explícito, recepciones del lote y referencias
a las evaluaciones realmente registradas en SQLite. El recibo no contiene el inventario acumulado
ni acredita una consulta remota nueva. El control actual se recompone sin añadir copias históricas
nuevas de índices regenerables; todos los cuerpos, recibos, intentos, admisiones y el prefijo histórico
siguen indexados y participan en la exportación y recuperación existentes.


La regla `oferta-publicada-continua-1` exige curso completo declarado gratuito,
identidad de ficha/CTA/destino, destinatarios y requisitos constatados con apoyos
localizados. Una muestra, un precio contrario, un CTA ajeno, un cierre o una
condición desconocida no acreditan la oferta. La política de fuente y su versión
deben estar registradas también al seleccionar la entrega. No exige que todo
curso sea sin cuenta; gratuidad de formación, registro, productos/prácticas y
certificado son dimensiones distintas. El primer texto didáctico observado
acredita ese destino, no que se hayan recorrido todas las lecciones ni ejecutado
vídeos, prácticas, quizzes o acreditaciones. No se crean fechas comerciales ni
se marca acceso sin registro. La próxima revisión interna (TTL técnico) parte
del apoyo pertinente más antiguo, solo avisa en el panel y no cambia al copiar,
admitir, componer o restaurar; no retira la oferta. `revisarEl` es la última
comprobación más `ttl_ficha_segundos` (o el plazo del catálogo, si llega antes), calculado
en `vigencia.py`. El aviso que prometen las políticas está en el panel:
`web/administracion/vista-ocultas.js` (`resumenPublicadas`) compara cada `revisarEl` de las
unidades publicadas con el reloj y muestra «revisión interna pendiente: N».

Cada política declara en `revision_equipo_faro.estado` la revisión editorial de su criterio.
`politicas_vigencia.leer_politica` la valida contra una lista cerrada (`ESTADOS_REVISION`) y
rechaza una política sin ella, con otro estado o con fecha de activación:

| Estado | Significado |
| --- | --- |
| `criterio-aprobado-sin-activacion` | El equipo aprobó el criterio. |
| `criterio-propuesto-sin-activacion` | El criterio está propuesto y pendiente de aprobación (FUNDAE). |

Ningún estado activa ni desactiva ofertas: lo publicado depende solo de estados observados con
evidencia, y los plazos de la política solo generan avisos en el panel.

Cada aplicación Academy conserva cuerpos y recibos únicos y un recibo compacto
inmutable con entrada/salida SQLite, conjunto, método, código, contrato, corte
y resultados por recurso. No contiene el índice ni el historial acumulados.
Las observaciones y sus revisiones se conservan en el registro V10 común. El
control plano y el recibo participan en la exportación/restauración existentes;
no hay otra base, publicador o programador para Academy. Los campos no
actualizados por el contrato conservan sus hechos y fechas anteriores; no
se asignan idiomas, niveles, competencias, elegibilidad o acceso por título.


Antes de activar la renovación de una fuente V2 se conservan también las
pruebas físicas de sus canales temporales históricos, con rutas y SHA exactos
y mediante un índice de entrada explícito. La admisión de integridad de SQLite
no descarga ni fabrica los archivos ausentes. Los extractos derivados conservan
su naturaleza y fecha anteriores; no se presentan como capturas nuevas. La
candidata operativa completa reúne esas pruebas dentro de la instantánea para poder
actualizar después de exportar y restaurar, sin depender de rutas del taller.


La revisión comercial Academy interpreta campos propios de precio/fee/tuition e
inscripción, controles de compra y metadatos Course/Offer ligados a la ficha.
Recorre texto visible y etiquetas, conservando el contexto de complementos. Una
condición propia de pago, inscripción cerrada o comercial no resuelta impide
acreditar la oferta aunque la portada diga que los cursos son gratuitos. Las
declaraciones contradictorias permanecen inciertas; un texto técnico o condicional
no se convierte en cierre comercial. Precios opcionales de prácticas, productos o
certificado permanecen separados del coste de formación. Los metadatos Free
identificados constituyen un apoyo, nunca una excepción para tapar otra condición
específica. El método versionado conserva el HTML y sus localizadores; no es un
intérprete universal de prosa ni realiza matrícula o compras.


## Contenido compartido y eventos en V10

La fábrica crea directamente la versión vigente V10, y la admisión exige V10: no migra ninguna entrada.

`contenidos_vigencia` comparte nodos inmutables de texto, soportes y estructura.
Cada observación/evaluación conserva sus parámetros de evento, IDs, fechas,
resultados, revisiones y huellas lógicas originales. Las referencias se verifican
por SHA y solo apuntan a nodos anteriores: no encadenan inventarios históricos.
La conversión completa y su versión se confirman en una única transacción SQLite.
Un corte revierte con el diario existente. No reevalúa, rejuvenece, elimina
consultas ni ejecuta VACUUM: las páginas libres físicas pueden seguir asignadas.

En las recepciones comunes Academy/Ciber, cada nueva consulta guarda un evento
fechado y una referencia a los metadatos estables únicos por SHA, además del
cuerpo único. El lector reconstruye el recibo original completo y comprueba su
SHA antes de interpretarlo. Un fallo conserva su causa y fechas. Los recibos
históricos íntegros siguen siendo pruebas inmutables; no se reescriben ni se
pierden sus referencias. Los metadatos de los informes y recibos futuros se
comparten igualmente dentro de la instantánea. Sus eventos conservan todos los
campos originales y permiten reconstruirlos exactamente con `leer_documento`.

Una consulta Academy cuyo cuerpo y negocio son idénticos no vuelve a insertar
atribuciones ni versiones nativas. Su observación de vigencia y recibos HTTP sí
se conservan. Repetir **la misma captura** no añade contenido, eventos ni archivos.
Una readmisión por un método distinto es una interpretación local trazable,
no otra consulta a la fuente. El crecimiento de los eventos y de los índices
actuales es lineal; no se promete tamaño constante de la historia conservada.
