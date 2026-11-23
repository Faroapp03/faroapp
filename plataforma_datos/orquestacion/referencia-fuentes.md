# Referencia de las fuentes

Lectores, entradas, órdenes y contratos de cada fuente de la [cadena de datos](README.md). Las rutas de código
con prefijo `plataforma_datos/` se expresan desde la raíz del repositorio; los comandos también se ejecutan desde
esa raíz.

## Biblioteca ESCO

`plataforma_datos/ocupaciones/fuentes/esco/lector.py` captura, prepara y valida ocupaciones y competencias de ESCO v1.2.1 en castellano.
La captura incluye las respuestas originales y su procedencia; la preparación genera tres archivos JSONL
y una biblioteca SQLite con búsqueda FTS5. Python debe disponer de SQLite con FTS5; las pruebas crean
una base mínima con ese mismo esquema para comprobarlo.

| Pieza | Responsabilidad |
| --- | --- |
| `plataforma_datos/ocupaciones/fuentes/esco/piezas/constantes_esco.py` | Versión, rutas, esquema SQLite, procedencia y límites de captura. |
| `plataforma_datos/ocupaciones/fuentes/esco/piezas/registros_esco.py` | Lectura de fichas y relaciones; cobertura y coherencia entre ambos sentidos. |
| `plataforma_datos/ocupaciones/fuentes/esco/piezas/base_esco.py` | Construcción e integridad de la biblioteca SQLite. |
| `plataforma_datos/ocupaciones/fuentes/esco/piezas/consultas.py` | Consultas locales de solo lectura; comprobación de huellas para los consumidores de datos validados. |

Desde la raíz del producto, con `biblioteca-api.zip` y `procedencia.json` en
`var/actualizacion/originales/esco/`:

```sh
.venv/bin/python -m plataforma_datos.ocupaciones.fuentes.esco.lector preparar
.venv/bin/python -m plataforma_datos.ocupaciones.fuentes.esco.lector validar
.venv/bin/python -m plataforma_datos.ocupaciones.fuentes.esco.piezas.consultas buscar recepcionista
```

Los preparados se guardan en `var/actualizacion/preparados/esco/`; la biblioteca y su informe de validación,
en `var/actualizacion/validados/esco/`. Estas órdenes no sustituyen el paquete publicado en `datos/`.
Ejecutar preparación y validación sin lectores simultáneos de esa biblioteca: la comprobación de huella
presupone que otro proceso no sustituye el archivo mientras se lee.

La acción `descargar` realiza peticiones a la API oficial; `todo` encadena descarga, preparación y validación.
Una captura existente se conserva. Si falta únicamente el ZIP o su procedencia, se requiere restaurar la
pareja registrada: volver a consultar la misma versión de la API no garantiza las mismas respuestas.
La captura y su procedencia forman parte de las entradas necesarias para reconstruir la biblioteca;
el ZIP no es un recurso público del navegador. Conservar juntos ambos archivos y sus condiciones de reutilización.

## OIT y clasificaciones

Las fuentes de OIT y clasificaciones preparan los datos de exposición ocupacional y las correspondencias
entre ISCO-08 y CNO-11. No utilizan modelos de IA durante la actualización. Los lectores de `plataforma_datos/comun/hojas.py`
cubren los valores XLSX y XLS/BIFF8 utilizados por esas fuentes; no ejecutan macros ni calculan fórmulas.
`plataforma_datos/comun/estadisticas.py` reúne lectores de tablas estadísticas y las condiciones de reutilización compartidas.

| Fuente | Entradas en `var/actualizacion/originales/<fuente>/`, además de `procedencia.json` |
| --- | --- |
| `oit` | `wp140-documento.html`, `isco08-estructura-definiciones.xlsx`, `notas-tareas-isco08-autor.xlsx`, `politica-derechos-oit.html` |
| `clasificaciones` | `cno11-estructura.xls`, `correspondencia-cno11-ciuo08.xls`, `ciuo08-estructura-es.xls` |

Desde la raíz del producto, preparar y validar OIT antes de clasificaciones, que contrasta sus grupos
ISCO-08 con la OIT validada:

```sh
.venv/bin/python -m plataforma_datos.ocupaciones.fuentes.oit.lector preparar
.venv/bin/python -m plataforma_datos.ocupaciones.fuentes.oit.lector validar
.venv/bin/python -m plataforma_datos.ocupaciones.fuentes.clasificaciones.lector preparar
.venv/bin/python -m plataforma_datos.ocupaciones.fuentes.clasificaciones.lector validar
```

Los originales se comprueban contra las huellas de su procedencia. Los preparados quedan bajo
`var/actualizacion/preparados/<fuente>/` y los conjuntos e informes, bajo
`var/actualizacion/validados/<fuente>/`. Estas órdenes no sustituyen el paquete público en `datos/`.

OIT conserva la prioridad de la tabla A1 oficial por ocupación y distingue las notas complementarias por
tarea, con sus intervalos y avisos de reutilización. Clasificaciones conserva las correspondencias
múltiples completas; no selecciona un código por defecto. Una validación fallida impide admitir el
conjunto nuevo. Sus pruebas habituales son autónomas; el contraste con los originales requiere las entradas
operativas de la tabla anterior.

## Cambra y datos de Cataluña

`plataforma_datos/ia_y_trabajo/fuentes/cambra/lector.py` prepara la tabla del ODEE/Cambra y contrasta sus cifras con el estudio publicado.
Conserva la escala propia del estudio y el reparto colectivo por sexo; no utiliza ese reparto para ajustar
la nota de una persona. `plataforma_datos/mercado/fuentes/cataluna/lector.py` prepara el Censo 2021 del INE y los indicadores de contratación
del Observatori del Treball, con sus periodos y fuentes diferenciados. Personas contratadas y contratos
son medidas distintas.

Ambas fuentes requieren clasificaciones validadas. Cataluña utiliza además Cambra como contraste.
Cada carpeta de originales necesita su `procedencia.json` y los archivos que este registra:

| Fuente | Entradas en `var/actualizacion/originales/<fuente>/` |
| --- | --- |
| `cambra` | PDF del estudio y tabla XLS recibida del ODEE/Cambra. |
| `cataluna` | Cuatro respuestas del Censo 2021, por sexo y edad a dos y tres cifras; tres archivos del Observatori, identificados por su periodo. |

Desde la raíz del producto:

```sh
.venv/bin/python -m plataforma_datos.ia_y_trabajo.fuentes.cambra.lector preparar
.venv/bin/python -m plataforma_datos.ia_y_trabajo.fuentes.cambra.lector validar
.venv/bin/python -m plataforma_datos.mercado.fuentes.cataluna.lector preparar
.venv/bin/python -m plataforma_datos.mercado.fuentes.cataluna.lector validar
```

Estas órdenes reconstruyen preparados y validados en `var/actualizacion/`; no sustituyen `datos/`.
La acción `descargar` de Cambra indica cómo incorporar una nueva entrega manual. La de Cataluña captura
las tres tablas vigentes del Observatori, exige un único periodo sin retroceder respecto al admitido y
registra sus cuerpos y procedencia. El coordinador permite las revisiones mediante `--aceptar-cambio`
y consulta también los desgloses de Observatori. Ambos pasan preparación, validación y exportación;
una descarga no sustituye por sí sola las cifras publicadas. Sin fecha editorial comprobable, la cita
identifica el periodo y la vigencia no inventa la fecha de publicación. El contraste de contratación con
la Taula 13 de Cambra solo se aplica dentro de su intervalo comparable; fuera se declara no aplicable.
Para reproducir el Censo se conservan las respuestas registradas: su ajuste estadístico de confidencialidad
puede cambiar las cifras de una consulta nueva.

La tabla de Cambra tiene una autorización de uso con condiciones propias; no es un conjunto con licencia
abierta. Conservar su procedencia, citar al ODEE y a la Cambra e informarles de las publicaciones que la utilicen,
según la autorización registrada. Los originales operativos no forman parte de los recursos públicos del navegador.

## Ocupación anual y Censo 2021

`plataforma_datos/mercado/fuentes/ocupados/lector.py` contrasta las tablas del Idescat con el INE, Cambra y Cataluña. El año 2021 se
utiliza para contraste; el paquete publica los años disponibles del censo anual desde 2022, con un mínimo de 100
personas. `plataforma_datos/mercado/fuentes/censo/lector.py` prepara los municipios de residencia y trabajo del entorno de Cornellà
y los perfiles ocupacionales de Cataluña: estudios, situación profesional y nacionalidad. Los perfiles
requieren al menos 1.000 personas; las cifras municipales, 100. Son datos de grupos, no atributos
inferidos de quien utiliza Faro.

| Fuente | Entradas en `var/actualizacion/originales/<fuente>/`, además de `procedencia.json` |
| --- | --- |
| `ocupados` | Cuatro metadatos JSON-stat del Idescat y las partes anuales de datos que requieren, su nomenclátor municipal y dos tablas de control del INE. También admite la reconstrucción local de capturas completas de siete archivos. |
| `censo` | Diez respuestas registradas de la API del Censo 2021: cuatro consultas municipales y seis de perfiles. |

La descarga de ocupados obtiene los años de los metadatos oficiales y divide las peticiones según el límite
de 20.000 celdas del Idescat. Conserva cada respuesta original con su URL y huella en `procedencia.json`.
La preparación recorre las partes declaradas y exige su cobertura completa; no reúne archivos por su fecha
ni incorpora copias que hayan quedado fuera de esa procedencia. La generación operativa transfiere únicamente
los originales registrados. Los filtros de cada parte no amplían los territorios del producto.

Preparar y validar estas fuentes después de clasificaciones, Cambra y Cataluña:

```sh
.venv/bin/python -m plataforma_datos.mercado.fuentes.ocupados.lector preparar
.venv/bin/python -m plataforma_datos.mercado.fuentes.ocupados.lector validar
.venv/bin/python -m plataforma_datos.mercado.fuentes.censo.lector preparar
.venv/bin/python -m plataforma_datos.mercado.fuentes.censo.lector validar
```

Censo necesita también el contexto preparado de Cataluña y las filas territoriales preparadas de
ocupados para comprobar sus resultados. Los conjuntos validados, por sí solos, no sustituyen esas
entradas de la actualización. Las órdenes anteriores solo escriben en `var/actualizacion/`.

El Censo aplica una perturbación estadística de confidencialidad: consultar otra vez puede dar cifras
distintas. Por eso `censo descargar` comprueba las copias existentes sin consultar la API; una captura
nueva exige `--aceptar-cambio`. El módulo común `plataforma_datos/mercado/fuentes/censo/piezas/consultas_del_censo.py` conserva las copias anteriores
si alguna petición falla antes de completar las respuestas. No garantiza una transacción de todos los
archivos ante un fallo de escritura. La validación de huellas impide admitir copias inconsistentes.

Los años, fuentes, límites y criterios de publicación acompañan a los conjuntos. Las pruebas habituales
comprueban la lógica con entradas pequeñas y temporales; reconstruir los datos reales requiere los
originales registrados y las dependencias indicadas.

## Uso de IA y salarios por ocupación

`plataforma_datos/ia_y_trabajo/fuentes/tich/lector.py` calcula el uso declarado de IA generativa por motivos de trabajo con los microdatos
públicos de la TIC-H 2025 del INE. Conserva los pesos de la encuesta, los intervalos de Korn–Graubard
y la regla de presentación del NCHS. Contrasta los resultados con tablas publicadas del INE y con
la distribución ocupacional de la EPA difundida por Eurostat. Son estimaciones de grupos de personas;
no miden la adopción de IA en las empresas ni sus efectos sobre el empleo.

`plataforma_datos/mercado/fuentes/salarios/lector.py` prepara la EES 2022 del INE: medias por gran grupo de ocupación en Cataluña y
media y percentiles por subgrupo en España. Conserva el ámbito, año y medida de cada bloque. Las cifras
ausentes o marcadas por el INE por alta variabilidad no pasan al conjunto. No estima el salario de una
persona ni el efecto de cambiar de estudios.

Ambas fuentes necesitan clasificaciones validadas y los siguientes originales con su `procedencia.json`:

| Fuente | Entradas en `var/actualizacion/originales/<fuente>/` |
| --- | --- |
| `tich` | `tich-2025-microdatos.zip`, `ine-76444.csv`, `ine-76849.csv`, `eurostat-lfsa_egai2d-ES-2025.json` |
| `salarios` | `ine-36862-cataluna.json`, `ine-36865-cataluna.json`, `ine-36866-cataluna.json`, `ine-36830-espana.json` |

Desde la raíz del producto:

```sh
.venv/bin/python -m plataforma_datos.ia_y_trabajo.fuentes.tich.lector preparar
.venv/bin/python -m plataforma_datos.ia_y_trabajo.fuentes.tich.lector validar
.venv/bin/python -m plataforma_datos.mercado.fuentes.salarios.lector preparar
.venv/bin/python -m plataforma_datos.mercado.fuentes.salarios.lector validar
```

La preparación y la validación escriben solo en `var/actualizacion/`. No sustituyen el paquete público.
La acción `descargar` consulta primero el catálogo oficial. TIC-H distingue el año de resultados del
último ZIP de microdatos; salarios lee exclusivamente la encuesta cuatrienal, sin confundirla con la anual.
Si aparece otra edición o un catálogo ambiguo, se detiene antes de sustituir originales, también con
`--aceptar-cambio`. La revisión debe abarcar cuestionario, diseño, correspondencias, citas y consumidores.
Los catálogos `ine-tich-resultados.html` e `ine-ees-resultados.html` se registran en `descubrimiento`,
separados de las entradas de datos. La reconstrucción histórica sin red no los necesita; una nueva
comprobación remota exige el catálogo y los cuatro originales vinculados a la misma consulta.
Las condiciones de reutilización y los límites estadísticos se conservan en la procedencia y la validación.
Los microdatos son entradas de la actualización, no recursos que se envíen al navegador.

## Formación: EURES, SEPE y SOC

`plataforma_datos/cursos/fuentes/formacion/lector.py` relaciona ocupaciones ESCO con códigos CO-SISPE mediante la correspondencia
EURES, especialidades del SEPE y cursos del SOC. Conserva el tipo de correspondencia: una relación
estrecha no se amplía a todo el grupo ocupacional. Los controles Python y el motor TypeScript comparten
un banco de casos para comprobar esa regla.

La preparación necesita la biblioteca ESCO validada y estas entradas, junto con sus procedencias:

| Carpeta en `var/actualizacion/originales/` | Entradas registradas |
| --- | --- |
| `formacion/` | Correspondencia EURES en CSV, especialidades del SOC en JSON, copia fechada de cursos del SOC, suplemento DigComp 3.0 en JSON-LD y XLSX, y su aviso de derechos. |
| `sepe/` | Exportación XLSX del catálogo de especialidades. |

La acción `descargar` comprueba primero las huellas de las entradas conservadas y consulta la oferta
oficial del SOC. Admite solo una respuesta JSON completa, con campos y cursos válidos; no descarga
ni sustituye los catálogos manuales. Un contenido distinto requiere `--aceptar-cambio`, que el
coordinador aplica a la oferta. Desde la raíz del producto:

```sh
.venv/bin/python -m plataforma_datos.cursos.fuentes.formacion.lector descargar --aceptar-cambio
.venv/bin/python -m plataforma_datos.cursos.fuentes.formacion.lector preparar
.venv/bin/python -m plataforma_datos.cursos.fuentes.formacion.lector validar
```

La procedencia de la copia SOC registra `comprobado_remoto_utc` con la hora real de esa consulta,
incluso si el contenido no cambia. Preparar o validar una copia guardada no renueva esa fecha.
Esta evidencia corresponde a la oferta consultada; no certifica la vigencia de los catálogos,
la disponibilidad de plazas ni la activación del paquete en la web. La ejecución periódica debe
configurarse en el planificador de mantenimiento.

Se generan cinco preparados en `var/actualizacion/preparados/formacion/` y un informe en
`var/actualizacion/validados/formacion/validacion.json`. DigComp se prepara y valida, pero no se incluye
en el paquete público de formación. Los cursos omiten los datos de contacto del original. Sus fechas,
duración, identificadores y cobertura se comprueban; una copia antigua produce un aviso y no acredita
que siga habiendo plazas disponibles.

`plataforma_datos/cursos/fuentes/formacion/exportacion.py` compone el paquete a partir de la validación admitida y de tres preparados:
correspondencias EURES, especialidades del SEPE y cursos del SOC. Conserva las citas y la fecha de la
copia. `exportacion/comun.py` escribe un paquete en el formato indicado y devuelve sus huellas; no
actualiza el manifiesto ni publica por sí solo. La preparación y la validación tampoco sustituyen `datos/`.
Las entradas y los preparados deben permanecer estables durante validación y exportación; no ejecutar
escrituras simultáneas sobre ellos.

## Formación del Consorci

`plataforma_datos/cursos/fuentes/consorci/lector.py` prepara y contrasta cuatro conjuntos de Dades Obertes de Catalunya:
ediciones con fecha, cursos programados, oferta FPCAT del Consorci y acciones previstas.
Necesita el catálogo SEPE preparado y la validación admitida de formación; no vuelve a construir ESCO.

La carpeta `var/actualizacion/originales/consorci/` conserva los datos y metadatos de cada conjunto,
con su fecha y `procedencia.json`. La preparación comprueba sus huellas. La validación requiere también
`var/actualizacion/validados/consorci/versiones-de-jdcj-za6r.json`: el historial de versiones admitidas
permite contrastar conjuntos que se actualizan en momentos distintos. Conservarlo al transferir una
instalación; un historial vacío no sustituye el contraste de las versiones anteriores.

```sh
.venv/bin/python -m plataforma_datos.cursos.fuentes.consorci.lector preparar
.venv/bin/python -m plataforma_datos.cursos.fuentes.consorci.lector validar
```

La acción `descargar` consulta la API oficial con pausas y registra la copia del día. Una descarga distinta
requiere aceptación explícita, salvo equivalencia comprobada de sus metadatos: mismo instante de
actualización y recuentos. Guardar una respuesta original no significa que sus datos hayan sido admitidos;
una estructura inválida se rechaza al leerla. La validación no publica un conjunto con controles fallidos.

Los contactos se reducen mediante reglas conservadoras: buzones de entidad, teléfonos admitidos y enlace
oficial cuando corresponde. Estas reglas no constituyen una garantía de anonimización. Las acciones previstas
no acreditan fechas ni plazas disponibles; el contraste FPCAT distingue oferta idéntica, distinta y no comparable.

`exportacion/validados.py` lee el conjunto admitido sin transformarlo. La escritura compacta conserva sus
datos y declara su origen para el manifiesto. Preparar, validar y componer ese archivo no sustituyen por sí
solos el paquete público de `datos/`.

## Oferta de acreditación de la Agència FP.CAT

`plataforma_datos/cursos/fuentes/agencia/lector.py` prepara la oferta del servicio de acreditación y las cualificaciones no disponibles.
Utiliza tres originales manuales en `var/actualizacion/originales/agencia/`, registrados en `procedencia.json`:

- `agencia-oferta-ecp-2025-09-12.pdf`: agrupaciones ofrecidas, nombre y nivel.
- `agencia-ecp-no-disponibles-2025-02.pdf`: cualificaciones que el servicio no ofrece.
- `agencia-guia-persona-usuaria-2024-08.pdf`: requisitos de experiencia y formación, con pasajes y páginas citados.

La orden `descargar` informa de la obtención manual; no intenta eludir las restricciones de lectura automática.
Una edición nueva requiere revisar la lectura, las fechas y los controles de cobertura antes de admitirla.
Los originales necesarios y su procedencia deben acompañar el traspaso de la actualización.

```sh
.venv/bin/python -m plataforma_datos.cursos.fuentes.agencia.lector preparar
.venv/bin/python -m plataforma_datos.cursos.fuentes.agencia.lector validar
```

La preparación verifica las huellas y lee las dos listas; conserva la guía como evidencia de los pasajes
transcritos. La validación contrasta cobertura y coherencia antes de guardar el conjunto. El emparejamiento
exige un único nombre coincidente y el mismo nivel; una ausencia de coincidencia queda sin comprobar,
no se interpreta como falta de oferta.

`plataforma_datos/comun/objetos_pdf.py` lee objetos, referencias y flujos; `plataforma_datos/comun/pdf.py` extrae sus renglones de texto.
Estos lectores cubren los formatos de las fuentes incorporadas, con límites de anidamiento y descompresión.
Su función es extraer datos de las fuentes, separada de la generación del informe descargable. Los documentos
cifrados y las tablas de referencias en flujos se rechazan con su motivo. Leer un PDF no ejecuta su contenido.

## Acreditación y escala del servicio FPCAT

`plataforma_datos/cursos/fuentes/acreditacion/lector.py` relaciona ocupaciones y certificados a partir de los anexos del BOE, los códigos
del SOC, las correspondencias del INE y las relaciones revisadas. La propuesta automática y la admisión
son pasos distintos: solo se publican relaciones admitidas, con la procedencia de su revisión. La actualización
no llama a modelos de IA ni vuelve a emitir los juicios de esa revisión.

Las responsabilidades se distribuyen en `plataforma_datos/cursos/fuentes/acreditacion/piezas/`: descarga, preparación,
relación con ocupaciones, revisión, validación y composición del conjunto. `plataforma_datos/comun/boe.py` interpreta los textos
oficiales y `plataforma_datos/comun/robots.py` comprueba las condiciones de lectura antes de las descargas, con pausas entre peticiones.

Entradas necesarias, además de los originales y sus procedencias:

- ESCO: ocupaciones preparadas y su validación con huella.
- Formación: correspondencia EURES preparada, validación y original de especialidades del SOC.
- Clasificaciones, Cataluña y Agència FP.CAT: conjuntos admitidos y sus validaciones.
- `var/actualizacion/revisiones/acreditacion/admitidas.tsv` y `descartadas.tsv`: listas revisadas.

La regla de esas listas está en `docs/regla-de-la-acreditacion.md`. Sus bytes identifican la decisión
mediante SHA-256 y se conservan íntegros; las rutas `datos/revisiones/` citadas en esa regla corresponden
al registro original. La ubicación operativa es ahora `var/actualizacion/revisiones/`. No cambiar la regla
ni regenerar juicios para hacer coincidir una huella. La procedencia del conjunto declara la ruta operativa
relativa al producto, para poder trasladarlo.

`plataforma_datos/cursos/fuentes/memoria/lector.py` aporta tres recuentos de la página 9 de la Memòria del Sistema FPCAT 2025,
periodo 2022–2025. El PDF `memoria-sistema-fpcat-2025.pdf` y su `procedencia.json` se incorporan manualmente
en `var/actualizacion/originales/memoria-fpcat/`. La lectura exige las cifras junto a sus rótulos y periodo;
una edición distinta requiere revisión. Esos recuentos describen la escala del servicio, no el plazo ni
el resultado de una solicitud individual.

Con las dependencias admitidas y los originales registrados:

```sh
.venv/bin/python -m plataforma_datos.cursos.fuentes.acreditacion.lector preparar
.venv/bin/python -m plataforma_datos.cursos.fuentes.acreditacion.lector validar
.venv/bin/python -m plataforma_datos.cursos.fuentes.memoria.lector preparar
.venv/bin/python -m plataforma_datos.cursos.fuentes.memoria.lector validar
```

`plataforma_datos/cursos/fuentes/acreditacion/exportacion.py` exige ambas fuentes admitidas, comprueba la procedencia de las relaciones
y añade la memoria conservando los dos archivos de origen. Las etapas anteriores solo escriben en
`var/actualizacion/`; componer el paquete no actualiza por sí solo `datos/` ni su manifiesto. Las pruebas
habituales usan ejemplos autónomos; la reconstrucción completa necesita las entradas operativas descritas.

## Relaciones del SEPE con certificados

`plataforma_datos/mercado/fuentes/perfiles/lector.py` prepara las menciones explícitas de certificados en los perfiles de la oferta de empleo
del SEPE. `plataforma_datos/cursos/fuentes/certificados2016/lector.py` prepara las tablas de los anexos III y IV del informe de necesidades
formativas de 2016. Ambas conservan su fecha y sus límites: relacionar una ocupación con formación no acredita
que una persona tenga esas competencias.

Las fuentes necesitan la acreditación admitida, sus dependencias y la lista de relaciones descartadas.
La precedencia es acreditación revisada, perfiles y, finalmente, tabla de 2016. Solo se añaden certificados
vigentes a ocupaciones ESCO con un único grupo CNO-11; no se duplican relaciones de una fuente anterior.

| Fuente | Entradas en `var/actualizacion/originales/<fuente>/`, junto con `procedencia.json` |
| --- | --- |
| `perfiles` | `apartados-de-certificados.tsv`: perfil, año, grupo, código y cita literal con página. |
| `certificados2016` | `informe-necesidades-formativas-2016.pdf`, `celdas-espana.jsonl` y `celdas-cataluna.jsonl`. |

El TSV de perfiles es una entrada manual registrada; conservar su trazabilidad a los PDF del SEPE, con
URL, fecha de captura, página y huella. Los rangos de códigos no se utilizan como relaciones individuales.
La tabla de 2016 se reconstruye desde las celdas registradas y se verifica también la huella del PDF;
estas órdenes no extraen de nuevo las celdas ni actualizan silenciosamente un informe histórico.

```sh
.venv/bin/python -m plataforma_datos.mercado.fuentes.perfiles.lector preparar
.venv/bin/python -m plataforma_datos.mercado.fuentes.perfiles.lector validar
.venv/bin/python -m plataforma_datos.cursos.fuentes.certificados2016.lector preparar
.venv/bin/python -m plataforma_datos.cursos.fuentes.certificados2016.lector validar
```

Los resultados quedan en `var/actualizacion/`. `exportacion/validados.py` exige la admisión de cada fuente
y conserva su conjunto y origen al componer `perfiles-sepe.json` y `certificados-sepe-2016.json`.
Componer esos archivos no sustituye el paquete público ni su manifiesto.

## Citilab, formación abierta y derechos

Estas tres fuentes se preparan de forma independiente, sin reconstruir ESCO ni otros catálogos.
Citilab extrae hechos de las fichas oficiales y conserva su enlace. Una modalidad o un horario que
no se puedan interpretar quedan sin dato; no se deducen como presenciales ni se inventan horas.

| Fuente | Entrada operativa, junto con su `procedencia.json` |
| --- | --- |
| `citilab` | En `var/actualizacion/originales/citilab/`: copia fechada de `formacio`, `public` y `tipus-formacio` de la API oficial. |
| `abierta` | En `var/actualizacion/preparados/abierta/`: `fichas.json`, redactado y revisado manualmente según [el criterio de formación abierta](../../docs/criterio-formacion-abierta.md). |
| `derechos` | En `var/actualizacion/originales/derechos/`: artículos XML y textos consolidados/convenios HTML del BOE, PDF del CRL y extracción de sus páginas vinculada a la huella del PDF. |

```sh
.venv/bin/python -m plataforma_datos.cursos.fuentes.citilab.lector preparar
.venv/bin/python -m plataforma_datos.cursos.fuentes.citilab.lector validar
.venv/bin/python -m plataforma_datos.cursos.fuentes.abierta.lector preparar
.venv/bin/python -m plataforma_datos.cursos.fuentes.abierta.lector validar
.venv/bin/python -m plataforma_datos.derechos.fuentes.derechos.lector preparar
.venv/bin/python -m plataforma_datos.derechos.fuentes.derechos.lector validar
```

Citilab y derechos ofrecen `descargar`, con pausas entre peticiones y comprobación de cambios.
Abierta no descarga cursos: su actualización necesita revisión humana de las fichas y sus evidencias.
A los 90 días sin revisar, el productor solo avisa de que la revisión está pendiente; una ficha deja de
admitirse al llegar su fin publicado, no por el tiempo transcurrido. Para reproducir una versión histórica se puede ejecutar
`FARO_HOY=2026-10-06 .venv/bin/python -m plataforma_datos.cursos.fuentes.abierta.lector validar`; esa fecha no
acredita una revisión actual de los cursos.

Derechos comprueba las citas contra los originales registrados y su fecha. Si cambia el PDF del CRL,
debe obtenerse y registrarse también su extracción; reutilizar una extracción de otro PDF se rechaza.
La captura se recibe y comprueba antes de sustituir archivos, pero la publicación final no es una
transacción de directorio: un fallo de disco puede requerir restaurar la copia registrada.

`exportacion/validados.py` compone Citilab y abierta; `plataforma_datos/derechos/fuentes/derechos/exportacion.py` selecciona las citas
de formación y tecnología utilizadas por el informe. Sus archivos se escriben con formato `sangrado`.
Las recomendaciones de apoyo y cláusulas sectoriales permanecen en el validado operativo.
Preparar, validar o componer no sustituye por sí solo los datos públicos ni su manifiesto.

## Textos, nombres oficiales en catalán y nombres de persona

Estas fuentes reconstruyen los textos y las listas utilizadas por el motor. No llaman a modelos de IA.
La redacción y traducción son entradas de autoría registradas; comprobar su formato y su procedencia
no acredita por sí solo la fidelidad lingüística de cada frase.

| Fuente | Entradas operativas, además de su procedencia |
| --- | --- |
| `textos` | En `var/actualizacion/preparados/textos/`: `tareas-piloto.json`, `tareas-generadas.jsonl` y `tareas-traducidas.jsonl`. |
| `idescat` | En `var/actualizacion/originales/idescat/`: rúbricas CIUO-2008 y CCO-2011 en SSV, y correspondencia CCO-2011/CNO-2011. |
| `catalan` | En `var/actualizacion/preparados/catalan/`: archivos emparejados de `origen/` y `traducciones/`, por tipo y parte. |
| `nombres` | En `var/actualizacion/originales/nombres/`: libros INE de nombres y apellidos generales y por nacionalidad, y sus dos notas PDF. |

Preparar y validar textos después de OIT, e Idescat después de clasificaciones. Catalán necesita ambos,
las clasificaciones y la biblioteca ESCO admitida. Nombres necesita además las ocupaciones ESCO preparadas,
la contratación preparada de Cataluña y las especialidades preparadas del SOC y SEPE, con sus validaciones.

```sh
.venv/bin/python -m plataforma_datos.ocupaciones.fuentes.textos.lector preparar
.venv/bin/python -m plataforma_datos.ocupaciones.fuentes.textos.lector validar
.venv/bin/python -m plataforma_datos.comun.fuentes.idescat.lector preparar
.venv/bin/python -m plataforma_datos.comun.fuentes.idescat.lector validar
.venv/bin/python -m plataforma_datos.comun.fuentes.catalan.lector preparar
.venv/bin/python -m plataforma_datos.comun.fuentes.catalan.lector validar
.venv/bin/python -m plataforma_datos.comun.fuentes.nombres.lector preparar
.venv/bin/python -m plataforma_datos.comun.fuentes.nombres.lector validar
```

En textos, la redacción manual tiene prioridad sobre la generada, y esta sobre la traducida. Se conserva
el estado de autoría de cada tarea y el aviso de traducción de la OIT. Los identificadores de herramientas
que contiene la procedencia describen cómo se produjeron las capturas registradas; no son órdenes de actualización.

Catalán publica los nombres oficiales de grupos del Idescat y distingue las traducciones propias de tareas
y ocupaciones. Una traducción ausente o cuyo castellano haya cambiado deja disponible el castellano.
Las particiones CNO sin un único nombre catalán se conservan como tales. `catalan descargar` prepara nuevos
orígenes para traducir; no traduce ni consulta una IA. Las traducciones nuevas requieren autoría y revisión.

`plataforma_datos/ocupaciones/fuentes/textos/exportacion.py` y `plataforma_datos/comun/fuentes/catalan/exportacion.py` componen los mismos bytes que se han comprobado,
y conservan los orígenes para el manifiesto. Nombres se compone con `exportacion/validados.py`.
Textos y catalán se escriben con formato `sangrado`; nombres, `compacto`. Estas operaciones no sustituyen
por sí solas el paquete público de `datos/`.

La lista del INE contiene nombres y apellidos con al menos 20 personas en España. No identifica a quien
escribe: ayuda al filtro de datos personales y al buscador, que tienen en cuenta el contexto. Los nombres
menos frecuentes pueden faltar y algunas palabras son también oficios o vocabulario común. Cambiar las
listas exige comprobar conjuntamente la normalización Python/TypeScript y sus consumidores de privacidad.

## Sectores, uso de IA en empresas y Observatori

`plataforma_datos/mercado/fuentes/sectores/lector.py` reconstruye el reparto de ocupaciones por actividad económica del establecimiento,
según el Censo 2021 del INE. Sus preparados sirven para contrastar las divisiones CNAE utilizadas por
`plataforma_datos/mercado/fuentes/empresas/lector.py`. Esta segunda fuente combina la ETICCE del INE con Eurostat y aporta la serie
catalana de empresas que utilizan IA. La encuesta describe empresas de diez o más personas, no la
empresa concreta de quien hace el recorrido ni la exposición de sus trabajadores.

`plataforma_datos/mercado/fuentes/observatori/lector.py` prepara indicadores de contratación y demanda de empleo, series mensuales y
recuentos por provincia. Comparte el periodo y capturas con la fuente de Cataluña. Las comarcas que
abarcan dos provincias se asignan según la regla documentada de la tabla territorial; el paquete conserva
esa limitación y no presenta la agregación como una clasificación municipal exacta.

| Fuente | Entradas operativas, además de `procedencia.json` |
| --- | --- |
| `sectores` | Dos respuestas del Censo 2021 por provincia del lugar de trabajo, ocupación a dos y tres cifras y actividad a dos cifras. |
| `empresas` | Índice y cuatro capítulos del INE para descubrir la edición; cuatro tablas ETICCE, las respuestas Eurostat de España y Cataluña y el calendario de publicaciones del INE (`ine-calendario.ics`), del que salen la fecha de la edición y, si ya la trae, la de la siguiente. |
| `observatori` | Cinco tablas de indicadores/series y los textos metodológicos del visor, junto con las capturas compartidas de Cataluña. |

Los originales se guardan en `var/actualizacion/originales/<fuente>/`. Observatori requiere además
`var/actualizacion/preparados/observatori/comarca-provincia.json`: es una tabla de entrada registrada,
no un archivo que la preparación reconstruya. Debe acompañar la instalación con su procedencia del Idescat.
Al cambiar las divisiones territoriales, hay que revisar esa tabla y la coherencia de las sumas.

Con clasificaciones y Cataluña admitidas, y el contexto preparado de Cataluña disponible:

```sh
.venv/bin/python -m plataforma_datos.mercado.fuentes.sectores.lector preparar
.venv/bin/python -m plataforma_datos.mercado.fuentes.sectores.lector validar
.venv/bin/python -m plataforma_datos.mercado.fuentes.empresas.lector preparar
.venv/bin/python -m plataforma_datos.mercado.fuentes.empresas.lector validar
.venv/bin/python -m plataforma_datos.mercado.fuentes.observatori.lector preparar
.venv/bin/python -m plataforma_datos.mercado.fuentes.observatori.lector validar
```

Las capturas del Censo conservan la perturbación estadística de su consulta; volver a descargar no
asegura repetir las cifras. Sectores exige aceptación explícita para una captura nueva. Empresas descubre
la edición y admite su actualización solo con definiciones compatibles y ambas partes Eurostat del mismo
año; un retraso regional o un cambio de metodología requiere revisión. Observatori utiliza el periodo
capturado por Cataluña, con meses consecutivos y claves únicas. Sus manifiestos conservan solo las capturas
activas; no borran originales antiguos. Una descarga no equivale a admisión: los controles de coherencia
y cobertura deben aprobarse antes de utilizar el conjunto. Véase el alcance de las
[comprobaciones periódicas](../../docs/comprobaciones-periodicas.md).

Estas etapas escriben en `var/actualizacion/`. `exportacion/validados.py` compone `observatori.json`
en formato compacto a partir de su conjunto admitido. Sectores y empresas son conjuntos operativos:
no se añaden archivos públicos independientes por el hecho de reconstruirlos. La composición del paquete
y de los datos globales son pasos posteriores, con sus propias comprobaciones; estas órdenes no publican.

## Necesidades formativas, ACTIC y Barcelona Activa

`plataforma_datos/mercado/fuentes/necesidades/lector.py` interpreta las fichas del SEPE por ocupación CNO-11. Conserva los porcentajes
publicados y sus ausencias: no son porcentajes de empresas o personas, ni una evaluación individual.
Necesita clasificaciones admitidas. `plataforma_datos/cursos/fuentes/actic/lector.py` contrasta la tabla del modelo de acreditación
digital con pasajes de sus disposiciones y páginas oficiales; distingue los pasajes comprobados de
los datos transcritos manualmente. No acredita las competencias de quien utiliza Faro.

`plataforma_datos/cursos/fuentes/barcelonactiva/lector.py` prepara enlaces por código ESCO exacto y actividades del Cibernàrium.
La aplicación selecciona las actividades próximas y las que siguen en curso en línea, según la fecha
del informe. La validación compara también nombres catalanes con las capturas ya admitidas de
`var/actualizacion/preparados/catalan/origen/` y `traducciones/`; no consulta una IA. Ese contraste
se guarda en `var/actualizacion/revisiones/barcelonactiva/`, separado del paquete público.

`plataforma_datos/cursos/fuentes/fundae/lector.py` lee las ediciones en teleformación de la oferta estatal de FUNDAE para personas
trabajadoras: una por especialidad, las 24 comprobadas a mano el 21/10/2026. FUNDAE no publica licencia de
reutilización de su API, así que no se descarga con código y la actualización está apagada; el conjunto guarda
solo hechos (especialidad, nombre, horas, entidad formadora, plazo de preinscripción, colectivos y sector) y el
enlace oficial, y su validación se para si aparece un correo o un teléfono.

| Carpeta en `var/actualizacion/originales/` | Entradas, además de `procedencia.json` |
| --- | --- |
| `sepe-necesidades/` | Fichas HTML por código CNO-11, registradas con su URL, consulta y huella. |
| `actic/` | Tres disposiciones DOGC en PDF y dos páginas del portal oficial. |
| `fundae/` | Por edición, tres respuestas JSON de su API pública (difusiones, entidad y colectivos), del 21/10/2026. |
| `barcelonactiva/` | Catálogo de ocupaciones en HTML; censo diario del ámbito de IA del Cibernàrium en `cibernarium-ia/` y canal operativo en `cibernarium/`. |

```sh
.venv/bin/python -m plataforma_datos.mercado.fuentes.necesidades.lector preparar
.venv/bin/python -m plataforma_datos.mercado.fuentes.necesidades.lector validar
.venv/bin/python -m plataforma_datos.cursos.fuentes.actic.lector preparar
.venv/bin/python -m plataforma_datos.cursos.fuentes.actic.lector validar
.venv/bin/python -m plataforma_datos.cursos.fuentes.barcelonactiva.lector preparar
.venv/bin/python -m plataforma_datos.cursos.fuentes.barcelonactiva.lector validar
```

Necesidades conserva capturas manuales con su procedencia. Barcelona Activa mantiene las
fichas ocupacionales conservadas y descarga su censo de cursos en el canal `cibernarium/`,
con el [contrato por edición](../cursos/fuentes/barcelonactiva/contrato-cibernarium.md).
ACTIC descarga las disposiciones; sus cambios requieren revisar la tabla declarada y sus pasajes. Conservar originales y condiciones de reutilización junto con la
instalación de mantenimiento. Las comprobaciones de integridad no sustituyen esa revisión de contenido.

Las etapas escriben únicamente en `var/actualizacion/`. `exportacion/validados.py` compone los tres
paquetes admitidos; `sepe-necesidades.json` se escribe en formato compacto y los otros dos, sangrado.
Estas órdenes no sustituyen por sí solas los datos publicados.

## Territorios, Eurostat e ILOSTAT

`plataforma_datos/comun/fuentes/territorios/lector.py` prepara los nombres en castellano y catalán y la correspondencia de códigos
ISO alfa-2/alfa-3 de Unicode CLDR. La versión está fijada en el módulo; una versión nueva requiere
revisión explícita. `plataforma_datos/ia_y_trabajo/fuentes/mundo_eurostat/lector.py` prepara series de uso de IA, formación y empleo.
`plataforma_datos/mercado/fuentes/ilostat/lector.py` selecciona las encuestas de fuerza de trabajo y calcula el peso de los grandes
grupos ocupacionales y la parte de mujeres. Cada país conserva el año de su encuesta; no se mezclan
con estimaciones modeladas ni se presenta el conjunto como una única observación del mismo año.

| Carpeta en `var/actualizacion/originales/` | Entradas, además de `procedencia.json` |
| --- | --- |
| `territorios/` | Nombres CLDR ES/CA, correspondencias de códigos y aviso de licencia Unicode de la versión fijada. |
| `mundo-eurostat/` | Cuatro tablas JSON-stat: `isoc_eb_ai`, `isoc_ai_iaiu`, `trng_lfse_04` y `lfsa_egai2d`. |
| `ilostat/` | `ilostat-EMP_TEMP_SEX_OCU_NB_A.csv`, con cifras y marcas de observación. |

Eurostat requiere los conjuntos admitidos de `tich` y `empresas` para contrastar sus cifras.
ILOSTAT requiere los de `territorios` y `mundo-eurostat`. Con esas dependencias disponibles:

```sh
.venv/bin/python -m plataforma_datos.comun.fuentes.territorios.lector preparar
.venv/bin/python -m plataforma_datos.comun.fuentes.territorios.lector validar
.venv/bin/python -m plataforma_datos.ia_y_trabajo.fuentes.mundo_eurostat.lector preparar
.venv/bin/python -m plataforma_datos.ia_y_trabajo.fuentes.mundo_eurostat.lector validar
.venv/bin/python -m plataforma_datos.mercado.fuentes.ilostat.lector preparar
.venv/bin/python -m plataforma_datos.mercado.fuentes.ilostat.lector validar
```

Las tres fuentes disponen de `descargar`; una captura diferente exige aceptación y posterior validación.
Conservar las procedencias y licencias junto a sus originales. Los controles contrastan definiciones,
marcas estadísticas, coberturas, sumas y porcentajes; no convierten una ausencia en cero ni eliminan
una nota de fiabilidad. El informe de validación identifica los países excluidos por descuadre.

Los resultados quedan en `var/actualizacion/`. Alimentan la composición de
`datos/globales/datos-globales.json`; no se publican tres paquetes independientes ni estas órdenes
sustituyen el archivo global. `plataforma_datos/derivados/fuentes/datos_globales/piezas/constantes_datos_globales.py` reúne su catálogo y las reglas compartidas
de notas, con las fuentes y condiciones de reutilización de cada indicador.

## EPA, EAES y ofertas de empleo

`plataforma_datos/mercado/fuentes/epa/lector.py` toma de la tabla 65314 del INE (últimos 17 trimestres) las series de
Cataluña, ambos sexos, por gran grupo de la CNO-11. `plataforma_datos/mercado/fuentes/eaes/lector.py` toma de la tabla
28186 la ganancia media anual por grupo A a Q y sexo, con los subgrupos de dos cifras de cada grupo según la jerarquía
de la variable 456. `plataforma_datos/mercado/fuentes/ofertas/lector.py` descubre el libro mensual vigente del
Observatori del Treball consultando la dirección de cada mes, del en curso al último conocido incluido (así ve también
una revisión de ese libro), y lo compara con el del mismo mes del año anterior, elegido por su fecha. Las tres descargas pasan por `plataforma_datos/comun/descarga_acotada.py`:
identidad genérica, pausa por dominio, plazo, tope de bytes, tipo de contenido declarado y mismo origen tras una
redirección; una respuesta que no cumple su contrato no sustituye el original.

| Carpeta en `var/actualizacion/originales/` | Entradas, además de `procedencia.json` |
| --- | --- |
| `epa/` | `ine-epa-65314.json` y `ine-epa-65314-ocupaciones.json` (API Tempus del INE). |
| `eaes/` | `ine-eaes-28186.json`, `ine-eaes-28186-grupos.json` e `ine-eaes-cno11-<letra>.json` por grupo. |
| `ofertas/` | `Ofertes_AAAAMM.xlsx`: los libros registrados; se leen el vigente y el del mismo mes del año anterior. |

El último periodo se lee de los datos: el trimestre de la EPA, el año de la EAES y el mes de las ofertas. La
validación lo admite si la serie está completa y no retrocede respecto al conjunto validado; si no, se conserva lo
validado. La cita de cada conjunto se genera con ese periodo. Si no se encuentra el libro de ofertas del año anterior, la
descarga se detiene con su motivo, retira el libro nuevo de `originales/` y la procedencia queda como estaba.

```sh
.venv/bin/python -m plataforma_datos.mercado.fuentes.epa.lector todo --aceptar-cambio
.venv/bin/python -m plataforma_datos.mercado.fuentes.eaes.lector todo --aceptar-cambio
.venv/bin/python -m plataforma_datos.mercado.fuentes.ofertas.lector todo --aceptar-cambio
```

`--aceptar-cambio` admite una versión nueva de un original, como hace la política mensual en el ciclo. Los conjuntos
quedan en `var/actualizacion/validados/{epa,eaes,ofertas}/` y alimentan `datos/mercado.json`.

## Comprobación de enlaces de la formación

`plataforma_datos/cursos/fuentes/enlaces/lector.py` comprueba en cada ciclo los enlaces que Faro enseña en la formación: las
webs de las ediciones y las entidades del Consorci, la ficha del SOC de cada curso y el PDF del programa de cada
especialidad del SEPE. Guarda por enlace el código HTTP, la fecha, el destino final (con aviso si es otro origen) y, en un
programa, la huella del PDF. Cada ciclo consulta una porción declarada en `porcion_diaria.json` (`porcion.py`): como
mucho 600 enlaces en 10 minutos y, el domingo, una pasada larga de como mucho 1.200 enlaces en 40 minutos. El día sale
de la fecha del ciclo, no del reloj, y solo cambia cuánto trabajo se hace, no qué se oculta ni qué se enseña. La pausa
de 2 s por dominio de la descarga común fija el ritmo. La porción va ordenada por lo que ve la persona:

1. lo expuesto nunca consultado y lo que el paquete anterior daba por oculto sin consulta propia;
2. lo que falló por primera vez en su última consulta (un enlace que vuelve a fallar espera su turno);
3. lo expuesto que lleva más de 2 días sin comprobarse: el programa de cada especialidad que cita un curso publicado
   del SOC o una edición del Consorci, la web de cada edición y la de cada entidad que imparte alguna (`expuestos` en
   `candidatos.py`);
4. los programas que se enlazan sin un curso al lado (en las especialidades de una ocupación) y llevan más de 14 días
   sin comprobarse;
5. el resto, del más antiguo al más reciente: primero lo nunca consultado, que no se enseña hasta que responda.

Con el paquete del 22/11 hay 160 enlaces expuestos con curso (111 programas y 49 webs), 1.840 programas enseñados sin
curso, 493 fichas y 5.683 enlaces en el resto (5.423 programas nunca consultados). A unos 2,2 s por consulta al SEPE y
3,5 s por web, renovar lo expuesto cada 2 días cuesta unos 3,5 minutos al día, lo enseñado cada 14 días unos 4,8 y la
muestra de fichas medio minuto: un día normal deja 1,2 minutos (unas 34 consultas) para el resto y el domingo, unos 31
(unas 850). Así el resto avanza unas 1.050 consultas por semana: una vuelta de unos 38 días, y todo lo nunca consultado
recibe su primera consulta en unos 36 días, después de la primera semana, que pone al día lo expuesto y lo enseñado
vencidos. Si un nivel con plazo no cabe entero, la cobertura de la validación lo cuenta en `expuestos_vencidos` o
`ensenados_vencidos` y se reparte por antigüedad.

Las fichas de los cursos del SOC se piden en una muestra rotatoria de 10 por ciclo: la página de
serveiocupacio.gencat.cat responde 200 con la misma página para cualquier código (se pinta en el navegador), así que su
código solo dice si el sitio sigue en pie o ha cambiado de dirección. Si un curso sigue en la oferta lo decide el censo
del SOC. Si en una porción se consultan al menos 20 enlaces que se enseñaban de un mismo dominio y el 50 % o más dan 404
o 410, es una señal del dominio y no de los enlaces: esos 404 se anotan sin concluir (`anomalia-de-dominio`), no cambian
lo que se enseña y el ciclo anota el dominio en `dominios_con_anomalia`.

Los candidatos salen de dos sitios: las webs, del conjunto validado del Consorci (`validados/consorci/consorci.json`, con
su validación admitida), y las fichas y los programas, de la composición del paquete de formación
(`paquete_formacion()` de `plataforma_datos/cursos/fuentes/formacion/exportacion.py`), que exige la validación admitida de
`formacion` y lee sus preparados (`soc-cursos.jsonl`, `sepe-especialidades.jsonl` y `esco-cosispe.jsonl`). Si falta una
validación o un preparado, la descarga falla y dice qué falta. Por eso el módulo declara `consorci` y `formacion` como
entradas: se recompone cuando cambia cualquiera de los dos.

Una web o un curso se oculta solo con un 404 o un 410 observados (la regla de `plataforma_datos/cursos/vigencia.py`) y
vuelve con una observación posterior que responda; el PDF de un programa se enlaza mientras su última observación
concluyente sea un PDF que responde. Un corte de red, un plazo o un 5xx se anotan y no cambian nada, y un 404 o un 410
que llega tras una redirección a otro origen tampoco oculta. Un dominio que responde tres veces seguidas 403 o 429 se salta
el resto del ciclo (`dominio-con-limite` en el panel). Es un módulo de apoyo: si falla, el estado lo marca en rojo, pero el
paquete se publica con el conjunto admitido más reciente de `enlaces` si lo hay y, solo si no, con el
`enlaces-comprobados.json` ya publicado. Las observaciones
quedan en `var/actualizacion/originales/enlaces/observaciones.json` y el conjunto validado, en
`var/actualizacion/validados/enlaces/`, alimenta `datos/enlaces-comprobados.json`.

Un ciclo acredita su turno, no todos los enlaces (`plataforma_datos/cursos/fuentes/enlaces/cobertura.py`). Queda
comprobado, y el panel lo da por sano, si su conjunto se validó en ese mismo ciclo (la validación lleva la huella de
las observaciones), si consultó los enlaces que le tocaban (todos, o hasta el tope, el plazo o el freno de un dominio),
si cada consulta dejó una observación fechada en el ciclo y si alguna fue concluyente (un 404, un 410 o una página que
responde). Que queden enlaces para otro ciclo es el diseño y no lo impide. Sin conjunto validado de ese ciclo, con
observaciones que no son del ciclo o con todo cortes de red, errores 5xx o dominios que piden que se les deje en paz, no
se acredita: el resultado queda en `parcial` y el panel lo marca como incidencia.

```sh
.venv/bin/python -m plataforma_datos.cursos.fuentes.enlaces.lector todo
```

## TIC a les llars, indicadores de la UE y Década Digital

`plataforma_datos/ia_y_trabajo/fuentes/tic_llars/lector.py` interpreta las tablas de uso de IA generativa del Idescat, incluidas las razones
para no utilizarla. Su contraste con TIC-H necesita el conjunto `tich` admitido: compara solo las clases
con cifras publicables e identifica las omitidas en el informe de validación. Si ninguna clase permite
el contraste, el control falla. No reconstruye ni sustituye intervalos excluidos por criterios estadísticos.
El contraste exige el mismo año en TIC-H y en las tablas del Idescat; con la TIC-H de un año posterior, la validación
sigue sin contraste y la exportación lleva cada cifra con su año (unos motivos posteriores al uso la detienen). En lugar
de cifras copiadas a mano, la validación comprueba la coherencia de las tablas capturadas.
La descarga consulta primero los años disponibles de la operación y conserva `idescat-ticll-catalogo.html`
en `descubrimiento`. Una edición distinta de la admitida requiere revisar su comparabilidad; no se mezclan
años ni se deduce la existencia de una edición por la fecha del calendario.

`plataforma_datos/ia_y_trabajo/fuentes/ue_eurostat/lector.py` prepara once tablas JSON-stat del agregado UE-27. `plataforma_datos/derivados/fuentes/datos_globales/piezas/catalogo_ue.py` define
indicadores, dimensiones, unidades y metas. Las marcas estadísticas acompañan a cada observación;
las cifras confidenciales o ausentes no se convierten en cero. Una etiqueta oficial cambiada o una
marca desconocida requiere revisión antes de admitir el conjunto.

`plataforma_datos/ia_y_trabajo/fuentes/decada_digital/lector.py` extrae las cuatro metas utilizadas del artículo 4 de la Decisión (UE)
2022/2481. Son objetivos para 2030, separados de las cifras observadas. Conserva su texto literal y
sus unidades; el objetivo de especialistas TIC se expresa en miles de personas.

| Carpeta en `var/actualizacion/originales/` | Entradas, además de `procedencia.json` |
| --- | --- |
| `tic-llars/` | `idescat-ticll25-3.4.1.html` e `idescat-ticll25-3.4.2.html`. |
| `ue-eurostat/` | Los once archivos `eurostat-<tabla>.json` declarados en `ue_eurostat.ARCHIVOS`. |
| `decada-digital/` | `decision-2022-2481-es.xhtml`, texto oficial en castellano. |

Con las entradas y dependencias disponibles:

```sh
.venv/bin/python -m plataforma_datos.ia_y_trabajo.fuentes.tic_llars.lector preparar
.venv/bin/python -m plataforma_datos.ia_y_trabajo.fuentes.tic_llars.lector validar
.venv/bin/python -m plataforma_datos.ia_y_trabajo.fuentes.ue_eurostat.lector preparar
.venv/bin/python -m plataforma_datos.ia_y_trabajo.fuentes.ue_eurostat.lector validar
.venv/bin/python -m plataforma_datos.ia_y_trabajo.fuentes.decada_digital.lector preparar
.venv/bin/python -m plataforma_datos.ia_y_trabajo.fuentes.decada_digital.lector validar
```

Las tres fuentes disponen de `descargar`; la aceptación de originales nuevos no sustituye su validación.
Los resultados operativos alimentan los datos globales. `plataforma_datos/ia_y_trabajo/fuentes/tich/exportacion.py` reúne TIC-H y los motivos
del Idescat en `tich.json`, con ambas procedencias y únicamente desde conjuntos admitidos. La escritura
del paquete utiliza el formato sangrado de `exportacion/comun.py`; estas etapas no sustituyen por sí
solas los archivos publicados.

## Opinión sobre tecnología y clima empresarial

`plataforma_datos/ia_y_trabajo/fuentes/eurobarometro/lector.py` prepara diez preguntas del Eurobarómetro especial 554, de 2024, para cinco
territorios. Conserva sus preguntas literales, universos y proporciones; la pregunta QB3 se refiere a
personas que trabajan para un empleador. `plataforma_datos/ia_y_trabajo/fuentes/ceo_panel/lector.py` prepara la pregunta 26 del Panel Ciutadà
del CEO, tercera oleada de 2025. Utiliza los pesos del cuestionario en línea: las omisiones entran en
la base del porcentaje y se excluyen de la media. Sus resultados son opiniones, no medidas de exposición
a la IA; la pregunta del CEO no permite una comparación territorial con el Eurobarómetro.

`plataforma_datos/ia_y_trabajo/fuentes/clima_empresarial/lector.py` prepara seis indicadores del Idescat sobre uso de IA y competencias.
Son porcentajes de establecimientos de Cataluña, con sus periodos de 2024 y 2025. Su universo difiere
del de las empresas de Eurostat y del de las encuestas a personas. Los temas pueden repetirse sin una
periodicidad fija: un trimestre nuevo con otra pregunta no sustituye estas mediciones.

| Carpeta en `var/actualizacion/originales/` | Entradas, además de `procedencia.json` |
| --- | --- |
| `eurobarometro/` | `SP554_Volume_A.xlsx`, volumen A con las preguntas y proporciones por territorio. |
| `ceo-panel/` | `REO1151_microdades_anonimitzades.csv`, CSV público anonimizado en Windows-1252. |
| `clima-empresarial/` | `idescat-clem-18149.ssv`, `idescat-clem-18162.ssv` e `idescat-clem-22205.ssv`. |

```sh
.venv/bin/python -m plataforma_datos.ia_y_trabajo.fuentes.eurobarometro.lector preparar
.venv/bin/python -m plataforma_datos.ia_y_trabajo.fuentes.eurobarometro.lector validar
.venv/bin/python -m plataforma_datos.ia_y_trabajo.fuentes.ceo_panel.lector preparar
.venv/bin/python -m plataforma_datos.ia_y_trabajo.fuentes.ceo_panel.lector validar
.venv/bin/python -m plataforma_datos.ia_y_trabajo.fuentes.clima_empresarial.lector preparar
.venv/bin/python -m plataforma_datos.ia_y_trabajo.fuentes.clima_empresarial.lector validar
```

Las tres fuentes admiten `descargar`. Una edición nueva requiere revisar sus definiciones y referencias;
volver a descargar no convierte un estudio cerrado en una encuesta del año actual. La validación comprueba
estructura, procedencia y cifras de referencia antes de admitir los conjuntos. Las once preguntas alimentan
el bloque `encuestas` de los datos globales y las seis cifras de clima, los indicadores de Cataluña.
Las etapas escriben en `var/actualizacion/`; no publican los microdatos ni reemplazan por sí solas el paquete.

## Medidas nacionales de uso de IA

`plataforma_datos/ia_y_trabajo/fuentes/ia_nacional/lector.py` prepara estadísticas de empresas de Australia, Canadá y Estados Unidos.
`plataforma_datos/ia_y_trabajo/fuentes/ia_nacional_isl/lector.py`, `plataforma_datos/ia_y_trabajo/fuentes/ia_nacional_gbr/lector.py`, `plataforma_datos/ia_y_trabajo/fuentes/ia_nacional_bra/lector.py`, `plataforma_datos/ia_y_trabajo/fuentes/ia_nacional_che/lector.py` e
`plataforma_datos/ia_y_trabajo/fuentes/ia_nacional_isr/lector.py` preparan las de Islandia, Reino Unido, Brasil, Suiza e Israel.
`plataforma_datos/ia_y_trabajo/fuentes/ia_nacional_kor/lector.py` prepara una estadística de personas de Corea del Sur.
Cada indicador conserva su pregunta, universo, periodo y licencia:
no son cifras comparables entre países ni con la encuesta europea. El auxiliar `plataforma_datos/ia_y_trabajo/comun/medida_nacional.py`
comparte la descarga con procedencia y los controles de admisión.

| Carpeta en `var/actualizacion/originales/` | Entrada, además de `procedencia.json` | Definición que se conserva |
| --- | --- | --- |
| `ia-nacional/` | `abs-bcsdc06-2024-25.xlsx` | Australia: empresas desde 0–4 personas; tecnologías utilizadas en el año terminado el 30 de junio de 2025. |
| `ia-nacional/` | `statcan-33101167-eng.zip` | Canadá: empresas y organizaciones de todas las industrias; uso para producir bienes o prestar servicios en los doce meses anteriores a la encuesta del segundo trimestre de 2026. |
| `ia-nacional/` | `census-btos-national.xlsx` | Estados Unidos: empresas con personas asalariadas; uso en alguna función del negocio en las dos semanas anteriores, último periodo publicado. Serie nueva desde noviembre de 2025, sin encadenar con la pregunta anterior. |
| `ia-nacional-isl/` | `hagstofa-sti03266.px` | Empresas desde una persona empleada; ponderación del total no publicada. |
| `ia-nacional-gbr/` | `ons-bics-ia-figura-1.csv` | Empresas de diez o más personas; último periodo BICS, encuesta voluntaria y estadística oficial en desarrollo. |
| `ia-nacional-bra/` | `cetic-tic-empresas-2025-h9.html` | Empresas de diez o más personas; mínimo publicado sobre el total, con respuesta de empresas que cuentan con personal o área de TI. |
| `ia-nacional-che/` | `bfs-ia-empresas-por-tamano.csv` | Empresas desde cinco personas; definición simplificada de IA, encuesta bienal y respuesta del 21,9 % en 2023. |
| `ia-nacional-isr/` | `cbs-31_25_216t2.xlsx` | Empresas con diez o más puestos asalariados de las ramas encuestadas; uso gratuito o de pago en los seis meses anteriores a junio de 2025. |
| `ia-nacional-kor/` | `msit-2025-encuesta-uso-internet.odt` | Personas desde tres años que han usado alguna vez IA generativa; el boletín no precisa si la base es la población encuestada o quienes usan internet. |

```sh
.venv/bin/python -m plataforma_datos.ia_y_trabajo.fuentes.ia_nacional.lector preparar
.venv/bin/python -m plataforma_datos.ia_y_trabajo.fuentes.ia_nacional.lector validar
.venv/bin/python -m plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_isl.lector preparar
.venv/bin/python -m plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_isl.lector validar
.venv/bin/python -m plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_gbr.lector preparar
.venv/bin/python -m plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_gbr.lector validar
.venv/bin/python -m plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_bra.lector preparar
.venv/bin/python -m plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_bra.lector validar
.venv/bin/python -m plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_che.lector preparar
.venv/bin/python -m plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_che.lector validar
.venv/bin/python -m plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_isr.lector preparar
.venv/bin/python -m plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_isr.lector validar
.venv/bin/python -m plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_kor.lector preparar
.venv/bin/python -m plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_kor.lector validar
```

Cada fuente admite `descargar`; un original cambiado requiere aceptación y validación. Los lectores
rechazan celdas o metadatos ambiguos antes de admitir una cifra. Preparados e informes quedan en
`var/actualizacion/`; alimentan la composición de los datos globales y no sustituyen por sí solos el
paquete público. Las definiciones y las condiciones de reutilización acompañan a cada indicador.

## Composición de los datos globales

`plataforma_datos/derivados/fuentes/datos_globales/lector.py` compone el archivo que utilizan el panel de comparación y el globo.
Opera desde agregados admitidos: cada entrada necesita su conjunto
`var/actualizacion/validados/<fuente>/<fuente>.json` y su `validacion.json` en la misma carpeta,
con estado admitido y todos los controles correctos. Se necesitan las veinte entradas:

| Fuentes | Contenido utilizado |
| --- | --- |
| `mundo-eurostat`, `ue-eurostat` | Series europeas, indicadores de la UE-27 y recuentos. |
| `decada-digital` | Metas para 2030 y su referencia normativa. |
| `eurobarometro`, `ceo-panel` | Preguntas, universos y cifras de opinión. |
| `empresas`, `tic-llars`, `clima-empresarial` | Medidas de Cataluña, con sus bases y ámbitos propios. |
| `ilostat` | Empleo por grandes grupos ISCO-08 y parte de mujeres. |
| `ia-nacional`, `ia-nacional-isl`, `ia-nacional-gbr`, `ia-nacional-bra`, `ia-nacional-che`, `ia-nacional-isr`, `ia-nacional-kor` | Medidas nacionales, cada una con su definición y sin comparación entre países. |
| `encuestas-isco4` | Agregados de exposición calculada de Brasil, Chile, Colombia y Uruguay, con intervalos o cotas. |
| `territorios`, `clasificaciones`, `idescat` | Códigos y nombres de territorios y grandes grupos en castellano y catalán. |

El conjunto admitido de `encuestas-isco4` y su informe los genera el productor de encuestas descrito
más abajo. Su reconstrucción necesita las capturas oficiales y los conjuntos de OIT y clasificaciones.
Componer el archivo global utiliza los agregados ya admitidos; no vuelve a leer los microdatos.
`plataforma_datos/derivados/fuentes/datos_globales/piezas/catalogo_calculado.py` y `plataforma_datos/ia_y_trabajo/fuentes/encuestas_isco4/constantes.py` reúnen las definiciones y referencias de los
indicadores calculados; los contratos comunes comprueban su estructura, intervalos y cotas.
La exposición calculada describe tareas de ocupaciones, no uso de IA ni empleos sustituidos.

Desde la raíz del producto, con todas las entradas disponibles:

```sh
.venv/bin/python -m plataforma_datos.derivados.fuentes.datos_globales.lector descargar
.venv/bin/python -m plataforma_datos.derivados.fuentes.datos_globales.lector preparar
.venv/bin/python -m plataforma_datos.derivados.fuentes.datos_globales.lector validar
```

En este módulo, `descargar` solo comprueba la admisión de las entradas; no realiza peticiones de red.
`preparar` escribe `var/actualizacion/preparados/datos-globales/datos-globales.json`.
`validar` comprueba el contrato, la presencia de los territorios imprescindibles y la igualdad con la
composición de las entradas actuales. Si se admite, escribe el conjunto y `validacion.json` en
`var/actualizacion/validados/datos-globales/`.

La fecha `generado` es la consulta más reciente de las fuentes que se vuelven a consultar, no el día
de composición. Cada observación conserva su periodo y sus notas; metas, opiniones, medidas y cálculos
mantienen sus ámbitos y definiciones. Estas órdenes no sustituyen el archivo público.
`python -m plataforma_datos.orquestacion.publicar_globales` comprueba el conjunto admitido, su contrato y su igualdad
con la composición de los veinte agregados, y traslada sus mismos bytes a
`datos/globales/datos-globales.json`. La actualización mensual ejecuta ese paso en su candidato aislado,
antes de construir y comprobar los recursos web. No recompone los microdatos ni descarga originales.


## Exposición calculada desde encuestas de empleo

`plataforma_datos/ia_y_trabajo/fuentes/encuestas_isco4/lector.py` reconstruye los agregados de Brasil, Chile, Colombia y Uruguay que
consume el catálogo calculado. Se apoya en `plataforma_datos/ia_y_trabajo/fuentes/encuestas_isco4/diseno.py` para las estimaciones ponderadas,
`plataforma_datos/ia_y_trabajo/fuentes/encuestas_isco4/medidas_de_exposicion.py` para los gradientes de la OIT, `plataforma_datos/comun/stata.py` para la base de Chile y
`plataforma_datos/ia_y_trabajo/fuentes/encuestas_isco4/pnadc.py` para los pesos replicados de Brasil. Las citas y direcciones compartidas están
en `plataforma_datos/ia_y_trabajo/fuentes/encuestas_isco4/constantes.py`.

Las ediciones están fijadas: Casen 2022, GEIH 2024, ECH 2023 y PNAD Contínua del segundo trimestre
de 2026. Una edición nueva requiere comprobar su estructura, clasificación, población y total
publicado antes de admitirla; no se sustituye por la más reciente sin ese contraste.

Para reconstruir se necesitan:

- Los conjuntos admitidos de `oit` y `clasificaciones`, con sus informes de validación.
- Las 31 capturas declaradas por el productor y su `procedencia.json`, en
  `var/actualizacion/originales/encuestas-isco4/`. Incluyen los doce meses de cada encuesta anual,
  las estructuras de ocupaciones, el libro de códigos y el diccionario de posiciones.
- Para ECH, los archivos obtenidos por una persona que haya aceptado las condiciones del INE,
  con esa aceptación registrada en la procedencia. El programa no realiza esa aceptación ni
  descarga automáticamente sus doce archivos mensuales.

Los microdatos de DANE y ECH no se redistribuyen en el repositorio ni en el paquete público.
Sus condiciones de uso y las de las otras fuentes se conservan en la procedencia. Se publican
únicamente agregados; el servidor web no debe servir `var/actualizacion/`.

Con las entradas disponibles, desde la raíz del producto:

```sh
.venv/bin/python -m plataforma_datos.ia_y_trabajo.fuentes.encuestas_isco4.lector preparar
.venv/bin/python -m plataforma_datos.ia_y_trabajo.fuentes.encuestas_isco4.lector validar
```

`preparar` genera `var/actualizacion/preparados/encuestas-isco4/calculada.json`.
`validar` coteja las huellas, los totales publicados, los códigos de ocupación, la muestra y las
cifras con sus cotas e intervalos. Solo el conjunto admitido pasa a
`var/actualizacion/validados/encuestas-isco4/`, junto con su informe. La composición global se
realiza después, mediante las órdenes del apartado anterior.

`descargar` permite recuperar las demás capturas oficiales y conserva las entradas manuales de
ECH. Un cambio de huella exige la aceptación explícita prevista por la cadena. La descarga por sí
sola no admite datos ni modifica el paquete público.
