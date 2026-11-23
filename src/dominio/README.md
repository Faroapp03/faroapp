# Dominio

Los módulos `tipos-*.ts` declaran las formas de entrada, del paquete de datos y de las vistas del informe, con sus versiones. La selección y la validación viven en sus consumidores.

La selección de formación vive en el [motor de Cursos](../../motores/cursos/README.md): especialidades, convocatorias, Consorci, Citilab, formación abierta y transversal, vigencia, enlaces comprobados y orden. Los contratos de formación, Citilab y formación abierta están en [compartido/contratos](../../compartido/contratos/README.md); la oferta del despliegue también pertenece allí. La app importa el motor por su entrada pública `motores/cursos/src/index.ts`, nunca por un módulo interno.

`informe.ts` recibe la formación ya calculada, sin cargar ese motor. La API la obtiene por su puerta; las pruebas que necesitan composición síncrona usan `pruebas/ayudas/informe-con-formacion.ts`. La ficha ocupacional de Barcelona Activa se comparte mediante [compartido/utilidades](../../compartido/utilidades/README.md), y puede acompañar al informe aunque el motor de Cursos no esté.

| Archivo | Responsabilidad |
|---|---|
| `tipos-paquete.ts` | Contrato en memoria del paquete por fuente; mantiene los tipos de sus relaciones y datos opcionales. |
| `tipos-entrada.ts` | Ocupación y tareas confirmadas, con referencias y estimaciones; admite usos internos más amplios que la API. |
| `tipos-acreditacion.ts` | Certificados, unidades, fuentes y presentación de la acreditación. |
| `tipos-contexto.ts` | Censos, uso declarado de IA y salarios de grupos de ocupaciones. |
| `tipos-frente-al-conjunto.ts` | Comparación con Cataluña, indicadores del Observatori e información adicional. |
| `tipos-necesidades.ts` | Competencias publicadas por el SEPE y fichas de la ocupación. |
| `tipos-provincias.ts` | Vista del paquete del Observatori y contratos por provincia. |
| `nombres-legibles.ts` | Nombres del SEPE con siglas y marcas conservadas, sin cambiar datos del catálogo. |
| `errores.ts` | Clases de errores de entrada y de invariantes; los adaptadores deciden cómo responder. |
| `consulta-de-vectores.ts` | Consultas por nombre y media de tareas; solo combina vectores del mismo espacio. |
| `tipos-informe.ts` | Contrato del informe y catálogo de aprendizaje, con versiones independientes de la API REST. |
| `marca-ia.ts` | Metadatos de autoría y procedencia de campos, sin incluir sus valores. |
| `esquema-entrada.ts` | Guarda de la entrada interna; la API añade sus restricciones públicas. |
| `esquemas-paquete.ts` | Formas serializadas por fuente, traducciones y vectores; sus consumidores comprueban coherencia y rangos. |
| `datos-en-idioma.ts` | Selección de textos y títulos con su idioma y procedencia. |
| `lengua.ts` | Idioma del informe y registro de traducciones y textos originales. |
| `textos-informe.ts`, `textos-informe-ca.ts` | Vocabulario y composición de frases en castellano y catalán. |
| `referencias.ts` | Política y selección de referencias OIT para estimar tareas. |
| `grupos.ts` | Jerarquía ISCO, ocupaciones de cada grupo y disponibilidad de referencias. |
| `ocupacion-confirmada.ts` | Coherencia entre ocupación ESCO y grupos confirmados. |
| `fecha-de-los-datos.ts` | Día de la copia más reciente de los cursos del paquete: el suelo con el que se comprueba la fecha del dispositivo en el informe. |
| `franjas.ts` | Umbrales de exposición y reparto del tiempo por mayores restos. |
| `grupos-del-censo.ts` | Grupos publicados sin duplicar personas al combinar niveles. |
| `camino-a-mano.ts` | Valor predeterminado y descripción del recorrido sin IA. |
| `tareas.ts` | Notas, competencias y procedencia por tarea; validación estricta y preparación de estimaciones para la web. |
| `personas-ocupadas.ts` | Personas ocupadas por grupo, año comparable y comarca, conservando la fuente de cada medida. |
| `perfil-del-grupo.ts` | Estudios, situación profesional y comparación salarial agregada, sin inferir datos personales. |
| `provincias.ts` | Contratos por provincia y reparto entero de cada cien, con desempates explícitos. |
| `hallazgos.ts`, `caminos.ts` | Conclusiones y caminos basados en tareas con nota y competencias; las ausencias no equivalen a cero. |
| `uso-declarado-de-la-ia.ts` | Uso declarado en la encuesta, con su muestra, intervalo y alcance de grupo. |
| `marca-del-informe.ts` | Procedencia de los campos del informe. |
| `fuentes-y-avisos.ts` | Citas, avisos de licencia y límites de los datos utilizados, en el idioma del informe. |
| `contexto.ts` | Correspondencias CNO y contexto de Cataluña por grupo, con periodos y fuentes explícitos. |
| `frente-al-conjunto.ts` | Comparaciones entre un grupo y el conjunto, conservando la ausencia de datos y los ceros. |
| `informacion-adicional.ts` | Indicadores complementarios y su antigüedad, sin sumar poblaciones distintas. |
| `necesidades-formativas.ts` | Fichas SEPE de necesidades por grupo, con sus cifras y textos originales. |
| `acreditacion.ts` | Certificados relacionados, requisitos según vigencia y apartados diferenciados por fuente. |
| `textos-acreditacion.ts`, `textos-acreditacion-ca.ts` | Textos ES/CA de acreditación y límites de su interpretación. |
| `aprendizaje.ts` | Objetivos por tarea, identidad semántica y opciones de formación por ámbito. |
| `opciones-otra-formacion.ts` | Adaptación de fichas externas al catálogo sin inferir costes o modalidades desconocidos. |
| `informe.ts` | Composición determinista de secciones, tiempos, idiomas, fuentes y procedencia; recibe la formación ya calculada. |
| `informe-breve.ts`, `tipos-informe-breve.ts` | Proyección laboral de dos hojas, sin solicitar formación: cifras, tareas y contexto con sus ausencias. |
| `hechos-del-informe-breve.ts` | Hechos de referencia que consume el informe breve, separados de los datos de la persona. |
| `direcciones.ts` | Hacia dónde ha ido un recuento (contratación, censo): sube o baja desde un 1 % de variación anual, criterio de redacción; las encuestas por muestreo, como la EPA, no llevan dirección. |

Las unidades, formatos de fecha y condiciones descritas son convenciones del dato: `number` y `string`
no comprueban rangos ni formatos. Las notas de tarea usan escala 0–1; los porcentajes usan escala 0–100;
las variaciones pueden ser negativas. Los salarios son euros brutos anuales y la duración de ACTIC son minutos.
Las horas de SEPE, SOC y Consorci conservan texto de la fuente; Citilab y acreditación usan números o `null`.

Un campo opcional puede faltar; un campo con `null` conserva una ausencia explícita. Las listas y objetos
mantienen su mutabilidad declarada. Las vistas parciales del paquete no eliminan campos en ejecución ni
constituyen una barrera de privacidad. Los consumidores deben validar entradas externas, aplicar las reglas
del dominio y seleccionar los campos que publican. TypeScript comprueba las declaraciones y sus dependencias.

Las reglas de selección por fechas del motor de Cursos describen la información de la copia; no comprueban plazas ni inscripción en la fuente.
El Cibernàrium excluye el día de fin de una actividad en línea iniciada; las convocatorias del SOC y del Consorci
se consideran terminadas después de ese día. Son reglas distintas de selección, descritas y probadas por módulo.
Una fecha de copia imposible o ajena a AAAA-MM-DD no acredita vigencia: el cálculo devuelve NaN y se activa el aviso
de antigüedad. El momento de una convocatoria compara fechas ya validadas y no sustituye su validación de entrada.

Las sugerencias de Faro no son correspondencias oficiales: llevan `correspondencia: null`. Las relaciones oficiales
conservan el valor EURES. El contrato público y sus consumidores se describen en [la API](../../docs/api/README.md).
Las cachés de enlaces se invalidan al cambiar la identidad de las listas: sus consumidores no deben mutarlas en sitio.

La revisión de una ficha abierta admite hasta 120 días, incluido el límite. Una fecha de comprobación o del
informe inválida impide acreditar su vigencia. Los inicios desconocidos de Citilab se ordenan detrás de los
conocidos dentro de la misma prioridad; coste y momento siguen decidiendo antes que la fecha.

Las consultas de vectores conservan el orden de acumulación y los redondeos Float32. El parecido se aplica
solo cuando hay consulta y vectores de especialidades compatibles; las prioridades oficiales se mantienen.
La marca de IA describe la autoría generativa y la procedencia declarada de campos; su modo no mide el uso de IA local para buscar, clasificar o calcular. No inspecciona ni anonimiza el cuerpo.

Una estimación requiere nota y extremos finitos entre 0 y 1, con la nota dentro del margen. El dominio
rechaza las que incumplen esa condición. La ruta web comprueba las firmas exigidas y después
`prepararEstimacionesParaInforme` retira solo la estimación numéricamente inválida: mantiene la tarea,
su texto y su tiempo.
Los identificadores devueltos permiten explicar la ausencia de nota sin confundirla con un valor cero.
La referencia oficial conserva prioridad. No se capturan ni silencian errores de otros contratos.

El catálogo mantiene el orden de tareas confirmado, independientemente del orden del informe. La huella de un
objetivo depende de su contenido original y del alcance de sus referencias, no de su traducción. Las opciones
ocupacionales incluyen hasta seis convocatorias por fuente; el bloque transversal conserva sus dos tramos.
La relación con una ocupación no demuestra que un curso permita alcanzar un objetivo.

La acreditación distingue certificados relacionados mediante su norma oficial de las relaciones publicadas por
el SEPE. Cada apartado conserva esa procedencia. Los requisitos se omiten cuando la comprobación tiene más
de 60 días; el bloque no determina si la persona reúne las condiciones para acreditarse.
