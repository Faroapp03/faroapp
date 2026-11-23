# Registro de vigencia por edición

`registro_vigencia.py` añade evaluaciones y cambios de decisión a **la misma SQLite del catálogo**. Su única autoridad de cálculo es `vigencia.evaluar_vigencia(oferta, observaciones, politica, *, ahora)`. No descarga, activa fuentes, programa reintentos, modifica ediciones ni publica ofertas. El esquema [registro_vigencia.json](esquemas/registro_vigencia.json) documenta el contenido persistido y reutiliza los contratos de entradas/resultado de vigencia; las reglas se ejecutan en Python, no mediante un segundo intérprete de disponibilidad.

La [guía de operaciones manuales](../../docs/operacion-manual-datos.md#consultar-vigencia-e-historia) recoge las consultas de inspección y sus pruebas.

## API

El registro vive en el catálogo V10 (`crear_catalogo`, o al cargar el primer lote). No se migra ni se fabrica historia.

- `SolicitudEvaluacion(edicion_id=..., oferta=..., observaciones=..., politica=..., ahora=...)`: entradas explícitas, corte UTC con zona y precisión máxima de microsegundos.
- `registrar_evaluacion(base, solicitud)`: calcula con el evaluador cargado, valida continuidad y admite en una transacción. Devuelve `evaluacion_id`, `repetida`, `actual` (mayor corte del registro, no vigencia a la hora de consulta).
- `consultar_edicion(base, edicion_id)`: último corte, `evaluacion_id`, `huella_registro`, entradas, resultado íntegro, huellas y fecha real de registro; no calcula otra decisión.
- `listar_ediciones(base, *, limite=50, despues_de=None, revision_esperada=None)`: página por ID exacto de edición, con cobertura del catálogo completo en la misma instantánea. Incluye ediciones no evaluadas. `siguiente` es el último ID entregado si queda otra página; límite 1–100. La respuesta añade `revision`: continuar con cursor exige enviarla como `revision_esperada`. Si cambiaron edición, último corte o evaluador, se rechaza y hay que reiniciar, sin mezclar revisiones.
- `historial_decisiones(base, edicion_id, *, limite=50, antes_de=None)`: diario descendente por ID de cambio; `siguiente` sirve como `antes_de`. Cada cambio enlaza evaluación anterior y nueva; límite 1–100.
- `firma_evaluador()`: firma de artefactos de una revisión congelada que se guarda con cada evaluación. No se requiere que el panel la calcule ni que invoque el evaluador.

Todas las rutas de SQLite son explícitas. La oferta debe usar **exactamente** `ediciones.id` en `oferta.id`; se exige que esa edición exista. `fuente_id` sigue siendo la fuente del contrato de vigencia, no se deduce del proveedor. El llamador debe aportar esa relación real; no se retiran espacios de nombres ni se adivina por títulos. La huella de la edición se toma del estado SQLite protegido por la transacción. Los lectores concurrentes ven el estado anterior o el confirmado, nunca las nuevas observaciones sin su evaluación y diario.

## Continuidad, identidad y cronología

Cada solicitud aporta un conjunto **acumulado explícito** de observaciones de esa edición. No hay sustitución silenciosa ni unión automática: un ID de observación ya admitido conserva exactamente su contenido. Al registrar un corte se exige incluir todas las observaciones admitidas cuya fecha máxima de intento, fin y capturas no supera ese corte, incluso si llegaron en otra evaluación. Omitir un cierre posterior y presentar solo una captura antigua en un corte nuevo se rechaza sin escribir nada. La política y la oferta aportadas se guardan íntegramente y validadas; cambiarlas requiere otro corte, no altera los registros anteriores. Los cambios de fuente o URL que impidan validar el conjunto acumulado exigen resolver expresamente la identidad/continuidad antes de admitir; no hay escape de borrado de historia.

Un corte repetido exige el mismo registro completo, incluidas entradas, política, edición y evaluador. Si difiere, se rechaza y se conserva la historia. Una evaluación antigua llegada tarde puede conservarse como cálculo histórico con sus capturas originales, pero no sustituye el mayor corte ni añade una transición aplicada al diario. Una captura posterior al corte no se admite. Se usa tiempo UTC entero en microsegundos para ordenar, sin comparación lexicográfica ni reloj de ingestión. La fecha `registrado_utc` es independiente del corte y de las capturas; se conserva al repetir.

No hay tabla de decisión «actual». Se deriva por mayor corte admitido de cada edición. `cambios_decision_vigencia` solo registra el primer cálculo aplicado o cambios de `estado`, `motivos` o `alcance`; una nueva comprobación con la misma decisión queda en el histórico de evaluaciones sin duplicar el diario. Los registros anteriores no se reescriben para reconstruir a posteriori un pasado que no se publicó.

## Integridad, evidencia y lecturas

El registro conserva una sola vez el JSON íntegro de cada observación por **edición+ID**, con sus URL, fechas, SHA y localizadores originales. La política, oferta, resultado y firma permanecen en la evaluación. Dos adquisiciones distintas que compartan SHA de cuerpo no se funden: sus IDs y todos los metadatos de recepción son parte de la identidad y del sello. Las huellas de entradas y resultado son SHA256 del JSON canónico UTF-8 (`sort_keys=True`, sin espacios ni NaN); la fila incluye además huella de la edición, evaluador y contenido completo. Se comprueban al leer/reutilizar. Esto detecta incoherencias de almacenamiento, no sustituye la verificación de los cuerpos de captura por el productor ni constituye una firma criptográfica de un tercero. El registro no inventa archivos de evidencia ni acredita que se descargaron de nuevo.

La firma del evaluador incluye la versión del contrato y SHA256 de los artefactos **vigencia**, **contrato_fichas** (calendarios), **normalizar_destinatarios** con la huella JSON que usa, `comun/huella_json.py` (dependencia propia real de validación), y los métodos de disponibilidad (`oferta_continua` y, de Cibernàrium, `matricula_actual` y `cabeceras_actuales`). Se exige ejecutar una revisión congelada: si los archivos cambian entre antes y después del cálculo se rechaza la escritura. No se inspecciona bytecode ni se afirma detectar un runtime alterado en caliente, ni se atribuye un commit no comprobado. Las claves son módulos portables, sin rutas del equipo. Un cambio de archivo exige otra evaluación aunque diera el mismo resultado; la fecha de ejecución nunca se usa como consulta remota.

Las lecturas usan una instantánea SQLite coherente, verifican el contenido devuelto y nunca llaman `evaluar_vigencia`. Devuelven:

- `no_disponible`: catálogo ausente o edición desconocida. La colección devuelve `cobertura: null` y `ediciones: null`; el diario `cambios: null`, sin fabricar «0 ocultas».
- `no_evaluado`: edición sin evaluación, o último cálculo histórico cuya huella de edición/evaluador ya no corresponde. El cálculo previo sigue consultable, con motivo explícito de revaluación.
- `evaluado`: cálculo íntegro de ese corte con la misma edición y contrato de artefactos congelado. **No afirma disponibilidad a la hora de lectura**: conserva `evaluado_el`, `cierra_el`, `revisar_el`, resultado y soportes. Si hace falta otro corte, debe registrarlo el productor llamando al evaluador.

La cobertura se calcula desde columnas y huellas de los últimos cortes, sin cargar todas las observaciones ni ejecutar N consultas por edición. Solo se comprueba el contenido íntegro de las filas devueltas; los recuentos no son una auditoría íntegra de todos los cuerpos de la base. La revisión de colección vincula esos metadatos y la firma del evaluador entre páginas. La cobertura solo cuenta `total_ediciones`, `evaluadas_mismo_contrato`, `sin_evaluacion` e `historicas_requieren_evaluacion`. No son contadores de ofertas públicas, retiradas u ocultaciones. Los motivos y soportes están dentro de cada evaluación, no se reemplazan por un semáforo.

## Decisión y publicación

Una ficha identificada con `comprobado_el` no acredita matrícula abierta. Una decisión `disponible-publicamente` tampoco acredita admisión o publicación de una entrega. Cada lectura deja `visibilidad_publica: "sin_confirmacion"`, `publicacion_confirmada: null` y `proximo_reintento: null`. El diario usa `alcance: "decision_no_publicacion"`: ni cierre ni vuelta a disponible se llaman ocultación pública o reaparición. No se reutiliza `historial_pertenencia`, que corresponde a programas y censos de proveedor, ni se inventa planificación individual por edición.

Las actualizaciones de las fuentes guardan sus observaciones y evaluaciones en el registro. Cuando cambia la firma del evaluador, la composición intenta reproducir las decisiones anteriores con las capturas archivadas. Comprueba el negocio, la versión de la política y el resultado en su corte original. Después evalúa la historia completa con la firma y el corte nuevos. El campo `comprobado_el` sigue indicando cuándo se observó la ficha. Para ofrecer de nuevo una unidad de Barcelona Activa, Cibervoluntarios o Academy, su último recibo de actualización también debe respaldar la observación utilizada. En Cibernàrium se releen el estado y el horario de la edición concreta desde la ficha oficial y se coteja su identidad con las cabeceras históricas de la API. Un fallo transitorio verificable permite conservar la comprobación previa hasta el mismo límite. Si la ficha identifica el curso y solo muestra otras ediciones, la matrícula queda por confirmar.

La entrega pública selecciona las unidades a partir de la evaluación vigente en el corte. El panel privado muestra los motivos de revisión, las referencias y el último intento fallido. La evaluación de vigencia deja `publicacionConfirmada` en `null`.

## Almacenamiento físico 2 y coste

`observaciones_vigencia` almacena cuerpos inmutables, su hash completo, la fecha máxima propia usada para continuidad y la primera admisión local, con sello físico. `revisiones_observaciones_vigencia` guarda listas **ordenadas** mediante base+delta cuando hay un prefijo exacto. Lista idéntica reutiliza la revisión; no copia ni siquiera todos sus IDs en cada evaluación. La evaluación guarda una referencia y un cuerpo compacto con `formato_registro:2`. Su `huella_fisica` protege contenido, referencia y metadatos SQL. `huella_registro` sigue siendo el sello lógico 1 original, calculado sobre las entradas completas reconstruidas. El esquema JSON distingue ambas formas.

La reconstrucción recorre las revisiones iterativamente con comprobación de referencias, ciclos, edición y hashes, sin profundidad recursiva diaria. Solo incluye los IDs exactos de esa revisión: una adquisición posterior, aunque tenga una fecha remota antigua, no entra a escondidas en otro corte. Una permutación o selección histórica que no sea prefijo conserva el orden explícito mediante IDs, sin duplicar cuerpos. Esos cambios arbitrarios de orden pueden requerir O(n) IDs por revisión; no se promete crecimiento lineal universal para permutaciones distintas de tamaño creciente.

La continuidad examina una vez los cuerpos únicos conocidos y sus fechas, junto con los sellos físicos compactos de todas las evaluaciones y revisiones de la edición. Se conserva así el rechazo de una alteración en un resultado antiguo no actual, sin volver a expandir las listas de todas las evaluaciones anteriores. Para la secuencia diaria por prefijos, cuerpos y referencias crecen linealmente; trabajo por registro sigue siendo lineal en las entradas/historia verificadas y el evaluador recibe el conjunto completo explícito. No se afirma coste constante ni un SLA.

## Historial y registros técnicos

Evaluaciones, observaciones y diario de decisiones son historia de negocio reproducible. No son logs técnicos de procesos ni acreditan que se hizo una nueva consulta remota. Repetir entradas/corte idénticos no duplica evidencia ni decisiones. Una consulta realmente nueva es otro intento del productor: debe conservar su identidad y fechas reales en sus observaciones o en el registro remoto que le corresponda (por ejemplo `plataforma_datos/orquestacion/comprobaciones_remotas.py` para comprobaciones por fuente). No se inventan intentos individuales a partir de reevaluaciones ni se eliminan por compartir SHA de contenido. Este módulo no sustituye ese registro de intentos, no crea otro sistema de logging y no introduce política de borrado o retención destructiva.


## Unidades tipadas

La tabla `unidades_vigencia` tiene clave JSON canónica `[tipo,id]`, con tipo cerrado `edicion` o `recurso`, ID nativo intacto y una única FK a `ediciones` o `programas`. Un recurso de autoformación no recibe una edición ficticia, convocatoria o calendario. La huella de contenido pertenece a la evaluación y se coteja con la entidad real bajo la misma transacción. No forma parte de la identidad estable.

Las cuatro tablas compartidas de observaciones, revisiones, evaluaciones y cambios usan esa clave. Sus columnas anteriores `edicion_id` y `huella_edicion` conservan exclusivamente la proyección de edición: son nulas para recurso. CHECK, FK y el validador operativo exigen la correspondencia exacta. Dos unidades de tipos distintos pueden tener el mismo ID y observaciones con el mismo ID sin mezclarse. No hay segundo registro, algoritmo o política de disponibilidad.

El [contrato de unidades](esquemas/registro_unidades_vigencia.json) es una unión, no una versión global del contenido: **schema 1 sigue identificando una edición**, también en las evaluaciones nuevas de edición; **schema 2 identifica un recurso** mediante `unidad: {tipo: "recurso", id, huella}`. La API tipada incluye siempre el tipo de unidad. Un recurso no se admite como schema 1. Las APIs existentes `consultar_edicion`, `listar_ediciones` e `historial_decisiones` conservan forma, historia y cursores, y no cuentan recursos en su cobertura.

- `UnidadEvaluable(tipo=..., id=..., huella=...)` y `SolicitudEvaluacionUnidad(unidad=..., oferta=..., observaciones=..., politica=..., ahora=...)` declaran la entidad exacta y contenido esperado.
- `registrar_unidad(base, solicitud)` admite la evaluación. Exige entidad existente, huella actual y `oferta.id` exacto; para recurso contrasta además la URL registrada. Reutiliza el evaluador, continuidad, deduplicación y diario del registro anterior.
- `consultar_unidad(base, *, tipo, id)` devuelve la identidad tipada y su último corte. No reevalúa ni afirma vigencia a la hora de consulta.
- `listar_unidades(base, *, tipo, limite=50, despues_de=None, revision_esperada=None)` pagina un dominio por ID nativo, con revisión que incluye el tipo. Cobertura `total_unidades`, `evaluadas_mismo_contrato`, `sin_evaluacion`, `historicas_requieren_evaluacion`; no cuenta ofertas publicadas. Un cursor de otro dominio o revisión se rechaza.
- `historial_unidad(base, *, tipo, id, limite=50, antes_de=None)` devuelve únicamente transiciones de esa identidad tipada. El diario sigue siendo decisión, no publicación.

Este componente **no añade políticas, puentes remotos, permisos ni oferta pública** para HP LIFE, Cibervoluntarios o Academy. Los productores deben aportar identidad y disponibilidad con su soporte propio; la cadencia de una fuente no se convierte en TTL. La evidencia y la licencia de la entrega pública se comprueban en la [entrega común del catálogo](entrega_catalogo.md), no aquí: la admisión verifica las evidencias indexadas, cada referencia pública lleva la URL, la fecha y el SHA de su soporte, y la entrega exige los derechos de `contrato_entrega_catalogo.DERECHOS` (`licencia_contenidos: null` y `redistribuye_contenidos: false`). Faro no declara ninguna licencia de los contenidos de esas fuentes, que sus `fuente.json` dan por desconocida.


La frontera de lectura comprueba el DDL conocido y validación de la unidad y los registros devueltos. No ejecuta una auditoría global de FK/cuerpos por cada consulta. `auditar_unidades_vigencia(base)` es la validación exhaustiva explícita para admitir un catálogo: recorre todas las relaciones, observaciones, revisiones, evaluaciones y diario sin migrar o evaluar. No confundir una página leída con la auditoría de todo el catálogo.


Detalle y páginas cotejan el cuerpo nativo con su huella, no solo las columnas del último cálculo. Una página comprueba únicamente sus IDs seleccionados, mediante consulta acotada por clave primaria; una fila fuera de esa página no dispara un barrido. La auditoría exhaustiva contrasta todos los programas y ediciones del catálogo, incluidos los que aún no tienen evaluación o vínculo en `unidades_vigencia`. Los tokens del DDL conservan literales, identificadores y límites de palabra: solo se ignora el espacio entre tokens, nunca el espacio dentro de un literal.


### Recurso sin edición y cambios de dominio

La vía `recurso` representa un programa nativo sin ninguna edición registrada. No permite confirmar un programa padre para eludir una convocatoria cerrada: `registrar_unidad` lo rechaza bajo la transacción si tiene ediciones. La colección y cobertura de recursos incluyen exclusivamente los programas sin edición; las ediciones conservan su dominio propio.

Si aparece una edición después de evaluar el recurso, consultar ese ID conserva intacta la evaluación histórica, con `estado_registro: no_evaluado` y motivo `programa_con_ediciones_requiere_evaluacion_por_edicion`. El diario sigue legible; ni la lectura ni el cambio de dominio fabrican otro corte, migran o borran evidencia. Tener una edición no prueba cierre del curso general ni acceso independiente: esta última relación no está representada por este contrato y requiere prueba explícita antes de ampliarlo.

Una ficha sin `datos_edicion` normalizados queda `sin-confirmar`, aunque un llamador declare `acceso_abierto=True`. Es distinto de una autoformación sin fechas fijas pero con contenido e identidad comprobados. Las alteraciones de contenido nativo se diagnostican con tipo e ID de fila, manteniendo el rechazo íntegro de la página o admisión.

## Oferta publicada continua

La regla opcional y versionada oferta-publicada-continua-1 permite evaluar una
oferta publicada sin inventar fechas de matrícula ni afirmar acceso sin registro.
Las demás políticas conservan su comportamiento anterior.

El adaptador acredita por separado curso completo, gratuidad declarada de la
formación, identidad de ficha/CTA/destino, destinatarios y requisitos. Cada
criterio positivo debe apuntar a evidencia localizada de disponibilidad. Una
muestra gratuita, un precio contrario, un CTA ajeno o una condición desconocida
no cumplen la regla. Registro, prácticas y certificado no se dan por gratuitos
ni accesibles por esa declaración general.

Las capturas de cada canal conservan sus fechas reales dentro de la comprobación
compuesta. La fecha de comprobación y la próxima revisión interna parten del apoyo
pertinente más antiguo; una nueva portada o un nuevo intento fallido no rejuvenece
una ficha anterior. Los cierres y límites publicados siguen teniendo precedencia.
El TTL es técnico: solo fija la próxima revisión interna (`revisar_el`), avisa en
el panel, no retira la oferta y no se publica como plazo comercial.

El módulo de la regla forma parte de la firma del evaluador y de la admisión.
Cambiarlo exige una revisión explícita de las mismas entradas: no autoriza
reescribir fechas remotas, borrar informes anteriores o llamar comprobación a
una lectura del registro.


## Formato físico compartido V10

El catálogo V10 comparte el contenido estable de las unidades tipadas entre registros, con el mismo contrato lógico.
Las referencias inmutables verifican SHA y aciclicidad; una referencia ausente o alterada impide leer o admitir. No se
compactan páginas ni se borran registros antiguos.

## Evaluador y contrato de vigencia 2

Desde `evaluador.version` 2 y `version_contrato_vigencia` 2 el resultado
(`schema_version` 2) sustituye `vence_el` por `cierra_el` (mínimo de los límites
publicados con evidencia, o `null`) y añade `revisar_el`,
`ultimo_intento_fallido_el` e `incidencia_enlace`, que solo avisan en el panel.
Una respuesta de ficha 404/410, una redirección sin identidad o una ficha de otro
curso es una incidencia del enlace, no del curso: no participa en el estado, no
retira, no cambia hechos ni fechas y no se confirma por repetir. `incidencia_enlace`
(`{el, origen, tipo, codigo_http}` o `null`) describe la más reciente posterior a la última
respuesta de este curso; si nunca la hubo, la unidad sigue desconocida. Con
`requiere_catalogo`, un 404/410, una redirección sin identidad o una página que no
es el catálogo también son incidencias del enlace (`origen: catalogo`): conservan
la última presencia válida y no retiran. Una lectura completa e identificada del
catálogo en la que la oferta ya no aparece es otro hecho observado (la fuente dejó
de listarla): deja la oferta `sin-confirmar` con
`ausente_o_no_identificada_en_catalogo_completo`, nunca como cierre. Los fallos de
transporte siguen en `ultimo_intento_fallido_el`. La validación de URL pública y el
rechazo de destinos privados no cambian. El tiempo cambia la
oferta únicamente al alcanzar `cierra_el` (`limite_publicado_alcanzado`); nunca por
el TTL, y no existe `comprobacion-caducada`. Las políticas nuevas declaran
`plazo_tecnico: revision_interna` y el evaluador rechaza las que no lo declaran.
Las evaluaciones anteriores conservan su contrato 1 y sus políticas citadas por
huella: el registro las acredita sin reevaluarlas.
