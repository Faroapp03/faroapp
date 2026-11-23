# Lector de la entrega pública de Cursos

Lee los contratos públicos 6 y 7 de `plataforma_datos/cursos/esquemas/entrega_catalogo.json`.
Las ediciones de formación subvencionada de FUNDAE identifican el centro, los destinatarios y el plazo de preinscripción.
El lector también admite las entregas anteriores con su formato original. La versión 5 incorporó la evidencia de materia.
No consulta fuentes, prepara catálogos, abre SQLite, clasifica personas, ejecuta
motores o publica ofertas. No contiene ni interpreta la lista privada de ocultas.
No tiene punto de acceso. La página `web/cursos.html` lo consume mediante un paquete construido;
la referencia pública permanece cerrada hasta admitir una entrega.

## Interfaz y autoridad

`leerCatalogo(bytes, referencia)` comprueba una sola vez tamaño, SHA256 externo,
revisión declarada y contrato cerrado, relaciones, orden y coherencia temporal.
La referencia `{sha256, bytes, revision}` debe proceder de la composición de una
entrega admitida, nunca del visitante ni del mismo archivo que pretende validar.
Se verifica el SHA de los bytes originales; la revisión lógica Python se compara
como identidad opaca. No se recalcula usando JSON.stringify o JCS: números y
Unicode no garantizan la misma serialización. UTF-8 inválido, truncamiento y
contrato ajeno producen `CatalogoNoValido`, nunca una lista vacía simulada.

El resultado es una instantánea congelada recursivamente, apta para reutilizarla
en caché. Su lectura no debe repetirse desde disco/red por cada consulta. El
consumidor web carga este recurso de forma diferida e independiente del
núcleo de Ocupaciones. La ausencia de este recurso estático no se convierte en una caída de
ese motor ni en una confirmación de que no existan cursos.

`ofertasVigentes(catalogo, ahoraMilisegundos)` recibe el reloj de la plataforma,
no un parámetro de la consulta pública. Devuelve una vista de las ofertas cuyo
límite publicado (`cierra_el`) no se ha alcanzado y no modifica el recurso estático, sus fechas
o su revisión. La antigüedad de `comprobado_el` no retira ofertas ni anula hechos:
la próxima revisión interna del productor solo avisa en su panel. Un reloj inválido genera `CatalogoNoValido`; uno anterior al corte de la entrega genera
`RelojAtrasado` (`comun/reloj-atrasado.ts`), para decirle a la persona que corrija la fecha de su
dispositivo. Un reloj posterior no se rechaza: los datos no pueden acreditar que sea erróneo. Un recurso estático válido vacío sí conserva sus
recuentos públicos cero: significa que esa entrega no contiene ofertas acreditadas,
no que los proveedores carezcan de cursos. Retirar una oferta de esta vista no
prueba cierre, retirada remota o pérdida de datos.

La única autoridad de decisiones sigue siendo el registro de vigencia. Este
lector no vuelve a interpretar calendarios o estados internos: recibe únicamente
ofertas suficientes en el corte que fijó el productor y retira solo las que
alcanzan su límite publicado (`cierra_el`); un `cierra_el` nulo no retira.
La URL es la específica de la oferta evaluada, sin sustitución por el programa.
La validación editorial, las políticas, el registro y los diagnósticos privados
siguen fuera de este recurso. No se infiere elegibilidad de una persona.

## Fechas, hechos y límites

`instanteCatalogo` conserva el dominio UTC y hasta seis decimales del evaluador
Python en bigint. No redondea microsegundos a milisegundos ni acepta zonas ajenas,
fechas imposibles o precisión mayor. `relojCatalogo` traduce el reloj suministrado
en milisegundos enteros, conservando su resolución declarada; no inventa una
captura o precisión física adicional. El intervalo conserva el extremo final
exclusivo. No hay desplazamiento de fechas ni plazo propio de caducidad.

Los hechos respetan vocabularios, cantidades, monedas, ámbitos y desconocidos
del productor. Idioma declarado y material observado son dimensiones distintas.
Null no implica gratis, acceso, español, compatibilidad o ausencia de requisitos.
La validación del orden del contrato sigue puntos Unicode, como Python. La vista
ordena títulos con el locale ES/CA, sin modificar el orden del recurso estático. Los límites de texto cuentan puntos Unicode completos. Los campos
sin proyección admitida conservan null y `sin_soporte_de_campo`.

## Clasificación que trae la entrega

Desde la versión 7, cada oferta puede traer un bloque `clasificacion` con el idioma, el nivel y la materia que decide
el productor. El lector admite la 6, que no lo lleva, y la 7, en la que es opcional; una entrega 6 con el bloque se
rechaza. `forma-clasificacion.ts` exige las mismas reglas que el productor: cada dato trae su valor (o sus valores, en
idioma y materia) de un vocabulario cerrado, su `estado` (`fuente`, `orientacion-faro` o `por-confirmar`), el `alcance`
y la `certeza`, la `regla` de Faro cuando es una orientación, sus `evidencias` y, solo si está por confirmar, su
`motivo_por_confirmar` (`fuente_no_publica`, `conflicto_evidencias` o `sin_captura`). No hay valor sin evidencia ni
regla, un dato de la fuente lleva al menos una evidencia, un dato por confirmar no lleva valor y ninguna evidencia puede
ser posterior al corte. Los códigos y un ejemplo de cada estado están en la
[documentación de la entrega](../../plataforma_datos/cursos/entrega_catalogo.md#clasificación-de-cada-oferta-versión-7).

El bloque se valida al leer y la proyección del listado no lo usa: lo que ve la persona sale de los hechos y de las
tablas de esta carpeta. `guardas.ts` reúne las guardas básicas (texto, huella, fecha, URL, vocabulario y
forma cerrada) que comparten la forma de la oferta y la de su clasificación.

Máximos: 32 MiB, 100.000 ofertas/proveedores/referencias por colección, 2.048
puntos Unicode por texto y 50 idiomas por hecho. La lectura y congelación son
lineales en el contenido recibido, con memoria acotada por el límite de entrada;
la vista recorre las ofertas ya leídas. No se prometen costes constantes ni se
redistribuyen cuerpos, textos restringidos, rutas privadas o controles internos.
El alcance de derechos por campo corresponde a la documentación del productor.

## Pruebas y consulta de presentación

Las pruebas contrastan una fixture sintética emitida por el productor Python y
un recurso estático real vacío del contraste aislado. Los archivos `.utf8` conservan sus
bytes exactos, incluido `1e-07`, para comprobar SHA externo sin que el formateador
los reescriba. No contienen cuerpos ajenos ni datos personales. Las referencias
separadas fijan tamaño, huella y revisión. El JSON Schema se cruza además con las
listas de campos y vocabularios del lector.

La carga diferida comprueba una sola vez la referencia externa y reutiliza la
instantánea. La vista retira, también sin conexión, las ofertas que alcanzan su
límite publicado: programa la revisión en el `cierra_el` más próximo (ninguna si
no hay) y vuelve a consultar al recuperar visibilidad o volver a la página. Sin
JavaScript no muestra fichas: una página estática sin reloj no puede aplicar esos límites.
La referencia confiable y la admisión de la entrega siguen siendo requisitos de
la composición; no se activan desde esta vista.

`consultarCatalogo` devuelve ofertas gratuitas vigentes, su total y cuatro mapas
de recuentos cruzados. Cada mapa mantiene búsqueda y demás filtros y excluye solo
el propio. Mixta pertenece a En línea y Presencial; modalidad desconocida solo a
Todos. Un coste desconocido sin declaración de gratuidad no acredita formación
gratis. La búsqueda incluye el nombre y la clave propia de materia (IA). Usa
`sinAcentos` común, exige todas las palabras y compara
palabras de hasta dos letras completas. El resaltado devuelve posiciones del
texto original y se construye con nodos de texto, nunca con HTML ajeno.

La clasificación histórica de navegación se conserva en `clasificacion-revisada.json`,
con SHA del catálogo, firma de los hechos pertinentes y anclaje de evidencia propia.
Para Cibernàrium, `materias-revisadas.json` ancla la materia revisada a programa,
título, proveedor y huella de contenido; el DTO 5 aporta por edición el vínculo y la
evidencia de contenido y, cuando existe, del censo de IA. Una edición nueva puede
usar la revisión del programa si su vínculo está acreditado y el contenido coincide.
Un contenido distinto no hereda esa revisión; una URL distinta por sí sola no la invalida.
El censo completo acredita IA por actividad identificada, mientras que su ausencia
no demuestra otra materia. Un censo parcial conserva únicamente evidencia anterior
admitida de la misma actividad, programa y edición, con su fecha original.
`metadatosClasificados(oferta)` distingue materias propias de Faro, nivel
conservado de la fuente, orientación de Faro y dificultad por confirmar.
Los niveles de actividad, digitalización o programa conservan su literal, escala,
ámbito y evidencia; su agrupación para filtrar no equipara escalas oficiales.
Los seis niveles históricos de Academy identifican el extracto derivado del
22 de octubre y su limitación: no acreditan una declaración actual del proveedor.
La orientación de Faro incluye una razón ES/CA y no representa requisitos de
entrada ni dominio de la persona. Los casos ambiguos siguen en Todos y en
Por confirmar. Las materias pueden solaparse; no se asigna todo lo ajeno a IA
a competencias digitales. `temasDelCurso(titulo)` conserva compatibilidad para
consultas de presentación; la consulta de ofertas usa la identidad completa.

`idiomaConOrigen(oferta)` es la única decisión del idioma y de su origen (edición,
programa, norma general u orientación de Faro); la usan Cursos y el plan de formación.
`idiomasDelCurso(oferta)` devuelve sus idiomas: normaliza nombres y códigos ES/CA/EN, conserva otras
declaraciones y distingue ausencia de datos. La orientación por el historial de ediciones de Cibernàrium no caduca
con el paso del tiempo: vale mientras ninguna edición declarada la contradiga. Ni los niveles ni los idiomas
clasificados reescriben el DTO o sus huellas. Materia, nivel e idioma se evalúan
independientemente: una materia conocida no acredita nivel ni idioma. Un nivel por
confirmar no satisface un filtro de nivel; el plan puede presentar la oferta con aviso.
En la revisión histórica sin evidencia de materia separada, la falta del soporte
editorial de nivel impide aplicar también sus materias; el idioma conserva su propio anclaje.

Los hechos de nivel y marca del DTO permanecen sin proyección acreditada.
Los calendarios de matrícula, formación y acceso al aula son hechos independientes
por edición. Conservan fechas civiles, horas sin zona y zonas explícitas sin
convertirlas a la zona de la máquina. Cada hecho conocido conserva su fecha UTC
de comprobación y una referencia fechada. Esa fecha no caduca con el reloj: el
hecho conserva su valor hasta que una entrega nueva aporte otra evidencia. La vista
de Cursos muestra solo formación con gratuidad conocida: es un filtro de la vista,
no un cierre de la oferta.

«Disponibles antes» ordena por el día de formación o acceso al aula,
y por título en los empates o cuando se desconoce la fecha. La matrícula no se
usa como inicio de formación. Los instantes con zona explícita se ordenan por su día en Cataluña; las fechas civiles
y horas sin zona conservan su día publicado. Para intervalos ya comenzados y aún vigentes se usa
el día actual de Cataluña; las sesiones con final horario ya superado se omiten
de la ordenación. Este orden no decide disponibilidad ni admisión. Calendarios
contradictorios o completamente disjuntos con precisión comparable no permiten asignar una fecha de orden.
Las fichas distinguen formación, inscripción y acceso al aula; no convierten
un intervalo global en una lista de sesiones. Idioma declarado no garantiza el
idioma de todo el material y un certificado general conserva ese alcance.

La página no lee el catálogo privado de investigación ni ejecuta el motor de
Cursos. El tamaño real de la entrega pública compacta se medirá al admitirla;
las pruebas UI usan exclusivamente datos sintéticos declarados.

El hecho `requiere_registro_previo` se refiere a la inscripción en la formación. No afirma por sí solo que
los materiales públicos exijan iniciar sesión, ni sustituye los requisitos de cuenta o coste para practicar.
Una declaración general conserva ese alcance y su referencia; la ausencia de soporte sigue siendo desconocida.

## Renovación de la revisión editorial

La revisión histórica de materia/nivel se vincula a cada unidad concreta mediante una firma
JCS/SHA256 generada de la instantánea pública fijada del 25/10/2026. Incluye tipo e
identidad de unidad/programa, proveedor, título, tipo de programa, URL, modalidad,
sincronía, horas, requisitos y niveles de entrada/salida, conservando valor,
motivo, unidad, moneda y alcance. Excluye fechas de comprobación, calendarios,
costes y límites temporales: no acreditan un cambio de materia/dificultad.
La evidencia de nivel exige URL y SHA presentes en la oferta actual. Una unidad
nueva, otro contenido sustantivo o un anclaje ausente quedan sin esa revisión histórica.
Para la materia de Cibernàrium se aplica además el anclaje de contenido descrito arriba;
las guardas históricas no sustituyen una huella de contenido discordante.

Los complementos de idioma comparan el hecho semántico sin su fecha y exigen los
anclajes de evidencia que pertenecían a esa oferta en la revisión histórica.
`anclajesEnOferta` indexa su lista de evidencias existente: las muestras de otras
actividades de una orientación no se hacen pasar por evidencia propia.
Una captura nueva con los mismos cuerpos/hechos conserva la revisión y las
fechas históricas; una declaración nueva de idioma prevalece. El reloj solo
retira ofertas por su límite publicado y no regenera estas firmas.

Receta reproducible, sin red:
`node herramientas/catalogo-cursos/firmas-editoriales.ts --comprobar`.
Sin `--comprobar` escribe únicamente las guardas derivadas de la fixture fijada,
previa verificación de su SHA contra la revisión. No crea niveles, idiomas,
evidencias o decisiones, ni habilita firmar automáticamente una entrega nueva.
La revisión del contenido de otra entrega exige su propio trabajo editorial.
