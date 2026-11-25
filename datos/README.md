# Datos oficiales de Faro

El paquete ocupacional de esta carpeta contiene archivos JSON UTF-8 inventariados en `manifiesto.json`.
Los nombres forman parte del contrato de lectura y publicación. El manifiesto permite comprobar sus huellas
SHA-256. Node las comprueba al leer, recibe la carpeta como argumento y conserva los datos sin compactarlos.

`globales/datos-globales.json` es la captura canónica de estadísticas territoriales, independiente del paquete
ocupacional y de su manifiesto. Su [lector compartido](../src/datos-globales/datos.ts) valida el contrato para la
web y los servicios. `npm run globales:generar` prepara los lectores JavaScript y copia ese JSON byte a byte a
`web/datos/datos-globales.json`; `npm run globales:comprobar` comprueba esas publicaciones locales sin escribir.

El manifiesto identifica cada archivo por su nombre, su `sha256` y las huellas de sus `origenes` cuando están
registrados. Esas referencias de procedencia no son rutas que los lectores deban abrir. Los índices de vectores
y las comprobaciones de enlaces registran su huella final sin una relación de originales en el manifiesto.

Para actualizar, preparar y validar las fuentes de cada archivo, generar los datos y el manifiesto conjuntamente
y comprobar sus huellas antes de admitir el paquete. No editar cifras ni huellas a mano. Una fecha de captura o
consulta no implica que una oferta, enlace o norma siga vigente: cada consumidor utiliza las fechas y límites
del archivo. La [cadena de datos](../plataforma_datos/orquestacion/README.md) documenta las entradas operativas
y las órdenes de preparación y validación disponibles.

Los derechos de terceros se conservan. La [licencia del producto](../LICENSE) no sustituye las condiciones de
INE, OIT, Unión Europea, Generalitat ni de los demás titulares. Las citas, avisos y fechas incluidos en los JSON
deben acompañar su reutilización.

## esco.json

**Fuente y versión:** ESCO, Comisión Europea v1.2.1

**Esquema y procedencia:** Selección de campos e índices locales a partir de la biblioteca ESCO; competencias
como tuplas y ocupaciones con relaciones [índice, esencial/opcional].

**Función:** Búsqueda, competencias y referencias de ocupación.

**Condiciones:** UE: Decisión 2011/833/UE; citar ESCO e indicar la selección y las modificaciones. Para
reconstruir la biblioteca se necesitan `biblioteca-api.zip` y su `procedencia.json`, conservados juntos en
el área operativa de la cadena. Estos originales no forman parte del paquete público del navegador.

## oit.json

**Fuente y versión:** OIT/NASK, Working Paper 140 (mayo de 2025), CIUO-08 y material complementario

**Esquema y procedencia:** Fuente y aviso literal de adaptación; registros de ocupaciones y tareas, notas,
márgenes y nulos.

**Función:** Referencias y notas de exposición de las tareas.

**Condiciones:** WP140: CC BY 4.0 con cita y avisos de adaptación/traducción. Clasificación y notas por tarea:
política de acceso abierto de la OIT, citando la OIT; sin presentar el uso como aval de la OIT.

## clasificaciones.json

**Fuente y versión:** INE CNO-11 y correspondencia con CIUO-08; OIT CIUO-08 en español

**Esquema y procedencia:** Registros cno11, isco08_es y correspondencias isco08_a_cno11, con tipo de enlace.

**Función:** Jerarquía de grupos y correspondencias entre clasificaciones.

**Condiciones:** Aviso legal del INE: citar la fuente y no desnaturalizar la información. La CIUO-08 anterior a
2023 se utiliza como clasificación de referencia citando a la OIT.

## exposicion-cambra.json

**Fuente y versión:** ODEE / Cambra de Comerç de Barcelona, estudio de mayo de 2026

**Esquema y procedencia:** Solo la parte pública del estudio, con un contrato cerrado: la cita (`fuente`), los cortes
de la escala (`escala.cortes`), el nivel de exposición agregado de cada grupo CNO-11 de 3 cifras
(`ocupaciones_cno3.<código>.nivel`) y el reparto por sexo que el estudio publica en su página 14
(`genero.mujeres_exposicion_media_o_alta`, `genero.hombres_exposicion_media_o_alta` y `genero.pagina_impresa`). La
cadena de datos lo deriva al exportar del conjunto validado completo
([exportacion.py](../plataforma_datos/ia_y_trabajo/fuentes/cambra/exportacion.py)), sin cambiar ningún valor, y el
manifiesto registra ese conjunto como su origen. No lleva puntuaciones, personas ocupadas ni desgloses.

**Función:** El nivel de exposición del grupo en el informe breve, la perspectiva de género del contexto y la cita.

**Condiciones:** Sin licencia abierta. Autorización escrita del ODEE para Faro: mostrar en la herramienta el nivel
de exposición agregado, citar ODEE y Cambra e informar de cada publicación de la herramienta/proyecto con su enlace.
Este archivo es justo lo que la herramienta enseña a cualquiera que la use, así que puede estar en el repositorio;
su contenido no se reutiliza fuera de Faro.

**Guardia:** `pruebas/paquetes/exposicion-cambra.test.ts` y
`plataforma_datos/ia_y_trabajo/pruebas/test_exposicion_cambra.py` fallan si el archivo trae un campo fuera de su
lista cerrada, si el manifiesto, el Worker o el service worker vuelven a nombrar la tabla, o si, con la tabla
completa a mano, alguna ocupación cambia de nivel o de cita.

### La tabla completa (`cambra.json`, privada)

La tabla completa del estudio (puntuaciones, nivel y personas ocupadas por sexo de las 163 ocupaciones) no forma
parte del paquete: no está en el manifiesto, no se publica y no está en Git (`.gitignore`). Solo la leen las pruebas
que comprueban los cálculos del estudio (`test_cambra.py`) y la igualdad de la parte pública. Se fija con la huella
que el manifiesto guarda como origen de `exposicion-cambra.json`.

**Cómo se obtiene:** una instalación autorizada pide la copia a Equipo Faro y la deja en `datos/cambra.json`, o la
recupera del almacén privado, donde cada generación guarda sus archivos por contenido. La segunda orden necesita los
tres secretos del [almacén](../docs/almacenamiento-datos.md) en el entorno (`FARO_ALMACEN_S3`,
`FARO_ALMACEN_ACCESS_KEY_ID` y `FARO_ALMACEN_SECRET_ACCESS_KEY`); la integración continua la ejecuta en su paso de
calidad. Sin ella, el motor, los tipos y la web funcionan igual. Las dos órdenes cotejan la huella y nunca muestran el
contenido:

```sh
.venv/bin/python -m plataforma_datos.ia_y_trabajo.fuentes.cambra.tabla_privada comprobar
.venv/bin/python -m plataforma_datos.ia_y_trabajo.fuentes.cambra.tabla_privada recuperar
```

**Dónde la buscan las pruebas:** en `datos/cambra.json` y, si no está o no tiene la huella, en su conjunto validado
(`var/actualizacion/validados/cambra/cambra.json`): es lo que tiene el ciclo de actualización, que ya no publica la tabla
en el paquete. La regla es una sola, la de `tabla_privada`: las pruebas Python la leen con él y las de Node le piden la
ruta con la orden `ruta`. Si no está en ninguno de los dos sitios, las pruebas que la necesitan fallan con el motivo; no
se omiten.

## textos.json

**Fuente y versión:** Equipo Faro, textos castellanos sobre tareas oficiales de la OIT

**Esquema y procedencia:** Textos manuales, redactados o traducidos con IA; tareas y competencias por ocupación,
con aviso de traducción.

**Función:** Presentación castellana de tareas y separación de procedencia editorial.

**Condiciones:** Textos propios sujetos a la licencia del proyecto; las fuentes OIT conservan sus citas,
condiciones y avisos. No son una traducción oficial de la OIT.

## formacion.json

**Fuente y versión:** SEPE, SOC y EURES; copia de cursos y especialidades del 27/09/2026

**Esquema y procedencia:** Correspondencias ESCO–CO-SISPE, especialidades y cursos, cobertura y fuentes.

**Función:** Selección de formación relacionada con cada ocupación.

**Condiciones:** SEPE: Ley 37/2007 y RD 1495/2011, citar origen y fecha, sin aval. EURES: © UE, Decisión
2011/833/UE. Especialidades SOC: ODC-BY 1.0; cursos SOC: Llicència oberta d’ús d’informació – Catalunya.

## consorci.json

**Fuente y versión:** Generalitat, Consorci per a la Formació Contínua de Catalunya; actualizado el 11/10/2026

**Esquema y procedencia:** Ediciones, acciones previstas, entidades y acciones sin fecha, con buscador y fechas.

**Función:** Oferta de formación para personas que trabajan.

**Condiciones:** Llicència oberta d’ús d’informació – Catalunya: citar Consorci, departamento y Generalitat,
indicar actualización, no desnaturalizar; sin sublicencia ni uso de logotipos.

## acreditacion.json

**Fuente y versión:** BOE, INE, SOC y Agència FP.CAT; comprobado el 06/10/2026; oferta del 12/09/2025

**Esquema y procedencia:** Certificados, relaciones de ocupaciones, requisitos, enlaces y memoria del servicio
FPCAT 2025.

**Función:** Orientación de acreditación de competencias y certificados profesionales.

**Condiciones:** BOE: citar «Basado en datos de la Agencia Estatal Boletín Oficial del Estado» y enlazar boe.es;
textos consolidados informativos, con fecha. Normas: art. 13 TRLPI. INE: citar sin desnaturalizar. SOC: ODC-BY
1.0. Memoria FP.CAT: Llicència oberta Catalunya, citar agencia y actualización.

## citilab.json

**Fuente y versión:** Citilab, copia del 06/10/2026

**Esquema y procedencia:** Listado y fichas de cursos: hechos de la oferta y enlaces.

**Función:** Opciones de formación de Citilab.

**Condiciones:** Condiciones de citilab.eu del 23/09/2026: uso informativo y de servicio citando Citilab. Solo
hechos y enlace, sin descripciones, imágenes ni logotipos.

## derechos.json

**Fuente y versión:** BOE; consultas del 06/10/2026

**Esquema y procedencia:** Citas de los artículos 23 y 64 ET, artículo 29 RD 694/2017 y artículos 87–90 LOPDGDD,
con texto, fecha y enlace.

**Función:** Citas de derechos de formación e información y derechos digitales en el informe.

**Condiciones:** Normas excluidas de propiedad intelectual por art. 13 TRLPI. Reutilización BOE citando fuente y
enlace; conservar fecha y carácter informativo de la consolidación.

## formacion-abierta.json

**Fuente y versión:** Equipo Faro, criterio Formación abierta v1.1; revisión del 06/10/2026

**Esquema y procedencia:** Fichas propias con título, criterios, fecha y enlace al curso.

**Función:** Opciones de formación abierta.

**Condiciones:** Fichas propias sujetas a la licencia del proyecto; los cursos conservan las condiciones de sus
titulares. Se copia solo el título y se enlaza la página pública sin seguimiento ni afiliación.

## cataluna.json

**Fuente y versión:** INE, Censo 2021; Observatori, contratación hasta junio de 2026, actualización 22/07/2026

**Esquema y procedencia:** Personas ocupadas por CNO y contratación; variaciones, mínimos y fuentes.

**Función:** Contexto de ocupación y contratación en Cataluña.

**Condiciones:** INE: CC BY 4.0. Observatori: aviso legal del visor y régimen Llicència oberta Catalunya; citar
fuente y actualización sin desnaturalizar. No consta una licencia específica en los ficheros del visor.

## nombres.json

**Fuente y versión:** INE, Censo anual a 01/01/2025; publicado el 23/04/2026

**Esquema y procedencia:** Cinco listas de nombres, apellidos, coincidencias con oficios, oficios y palabras
corrientes; frecuencia mínima 20.

**Función:** Detección de nombres para privacidad y distinción frente a vocabulario profesional.

**Condiciones:** CC BY 4.0 según aviso legal del INE; citar elaboración propia con datos del INE y
actualización, sin sugerir respaldo. Son listas agregadas, no registros individuales.

## ocupados.json

**Fuente y versión:** Idescat a partir de censos INE 2021–2023; actualizado el 13/05/2026

**Esquema y procedencia:** Series por CNO, sexo y territorios, años comparables y mínimos.

**Función:** Número y evolución de personas ocupadas.

**Condiciones:** Idescat: citar elaboración propia, fecha y enlace idescat.cat; no modificar al presentar ni
sugerir aval. INE: CC BY 4.0 y cita de origen.

## censo.json

**Fuente y versión:** INE, Censo de Población y Viviendas 2021; referencia 01/01/2021; consulta 05/10/2026

**Esquema y procedencia:** Perfiles por CNO y Cataluña, municipios, ocupados y umbrales mínimos.

**Función:** Perfil del grupo profesional y distribución territorial.

**Condiciones:** INE: CC BY 4.0; citar elaboración propia con datos de www.ine.es y actualización, sin respaldo
implícito.

## tich.json

**Fuente y versión:** INE TIC-H 2025 (microdatos 10/06/2026, tabla publicada 20/11/2025) e Idescat TIC a las
llars 2025

**Esquema y procedencia:** Estimaciones por grupo ISCO, agregaciones y método; muestra mínima y motivos de no
uso.

**Función:** Uso de IA generativa y motivos de no uso, con sus límites de muestra.

**Condiciones:** INE: CC BY 4.0 y cita de origen. Idescat: citar elaboración propia, fecha y enlace, conservar
cifras y no sugerir aval.

## salarios.json

**Fuente y versión:** INE, Encuesta de Estructura Salarial 2022; definitivos del 23/09/2024

**Esquema y procedencia:** Medias de Cataluña por gran grupo y medias/percentiles de España por subgrupo, medida
y territorio.

**Función:** Contexto salarial con ámbito y año explícitos.

**Condiciones:** INE: CC BY 4.0; citar elaboración propia, www.ine.es y actualización sin sugerir respaldo.

## observatori.json

**Fuente y versión:** Generalitat, Observatori del Treball; junio de 2026, actualización 22/07/2026

**Esquema y procedencia:** Contratación de Cataluña, comarcas y provincias, series y datos mensuales; vigencia y
mínimos.

**Función:** Demanda, contratación y contexto territorial.

**Condiciones:** Aviso legal del visor Treball per ocupacions y régimen Llicència oberta Catalunya: citar fuente
y fecha, sin desnaturalizar. Los ficheros no declaran licencia específica.

## sepe-necesidades.json

**Fuente y versión:** SEPE, fichas de necesidades formativas por ocupación; consulta 06/10/2026

**Esquema y procedencia:** Necesidades por CNO, porcentajes, limitaciones y señal de datos todo a cero.

**Función:** Necesidades formativas del grupo profesional.

**Condiciones:** Aviso legal SEPE, Ley 37/2007 y RD 1495/2011: citar «Origen de los datos: SEPE» y fecha; no
desvirtuar ni sugerir respaldo.

## perfiles-sepe.json

**Fuente y versión:** SEPE, perfiles de oferta de empleo 2016–2025; consultas 06–07/10/2026

**Esquema y procedencia:** Índice de perfiles y certificados citados por ocupación, con límites.

**Función:** Referencias a certificados desde perfiles de ofertas de empleo.

**Condiciones:** Aviso legal SEPE, Ley 37/2007 y RD 1495/2011: citar origen y fecha, conservar sentido y no
sugerir respaldo.

## certificados-sepe-2016.json

**Fuente y versión:** SEPE, Informe de prospección y necesidades formativas 2016, anexos III y IV; consulta
06–07/10/2026

**Esquema y procedencia:** Certificados y unidades de competencia por ocupación, con límites y cita.

**Función:** Referencias históricas de certificados, diferenciadas de la oferta vigente.

**Condiciones:** Aviso legal SEPE, Ley 37/2007 y RD 1495/2011: citar origen y consulta, sin desvirtuar ni
sugerir respaldo.

## actic.json

**Fuente y versión:** Generalitat, órdenes EMT/47/2026, EMT/48/2026 y EMT/136/2026 y portal ACTIC; modelo
vigente desde 15/09/2026

**Esquema y procedencia:** Niveles, áreas, requisitos, prueba, exenciones, disposiciones y vigencia.

**Función:** Orientación de acreditación digital ACTIC.

**Condiciones:** DOGC: normas excluidas de propiedad intelectual por art. 13 TRLPI. Portal: Llicència oberta
Catalunya, citar Generalitat y conservar sentido.

## barcelonactiva.json

**Fuente y versión:** Barcelona Activa, catálogo de ocupaciones y Cibernàrium; consulta 07/10/2026

**Esquema y procedencia:** Códigos e identificadores de fichas y actividades, con direcciones de enlace.

**Función:** Enlaces a ocupaciones y formación de Barcelona Activa.

**Condiciones:** Aviso legal restrictivo de Barcelona Activa: no hay licencia abierta de reproducción. Este
archivo guarda solo identificadores y enlaces, sin textos ni imágenes.

## mercado.json

**Fuente y versión:** INE, EPA (tabla 65314, trimestre 2/2026) y EAES (tabla 28186, definitivos 2024);
Generalitat, Observatori del Treball, junio de 2026, actualización 22/07/2026

**Esquema y procedencia:** Ocupados de Cataluña por gran grupo (medias de cuatro trimestres), salario medio de
España por grupo A–Q con sus subgrupos CNO-11 según la jerarquía del INE, variación de personas contratadas,
contratos por año de julio a junio reconstruidos con la variación de junio, contratos por comarca, variación de los
demandantes de empleo (C_P5_EVOL_3) y puestos ofertados por el SOC y Feina Activa (Excel mensual del Observatori:
las 50 ocupaciones más ofertadas, todos los subgrupos y los grandes grupos).

**Función:** Cifras de mercado del informe breve de cualquier ocupación.

**Condiciones:** INE: CC BY 4.0; citar elaboración propia, www.ine.es y actualización sin sugerir respaldo.
Observatori: aviso legal del visor y régimen Llicència oberta Catalunya: citar fuente y fecha, sin desnaturalizar.

## metodos.json

**Fuente y versión:** Cálculo de Faro del 21/10/2026 con OIT/NASK (2025), Felten, Raj y Seamans (2023), Eloundou et
al. (2024), Microsoft (2025) y Anthropic Economic Index (2026); correspondencias de IBS (2018) y O*NET

**Esquema y procedencia:** Para cada ocupación ISCO-08 con nota de la OIT, su tercio según la OIT y cuántos métodos,
con dato, la sitúan en el mismo tercio; los métodos con su cita y licencia. Sale de `originales/metodos/`, calculado
previamente; el generador del consenso no forma parte de esta entrega. ODEE/Cambra no cuenta: se calcula con
las notas de la OIT.

**Función:** Confianza de la exposición en el informe breve.

**Condiciones:** Cada método conserva su licencia: OIT CC BY 4.0, Eloundou MIT, Microsoft CC BY 4.0, Anthropic CC-BY (versión no especificada en su declaración de datos);
Felten e IBS sin licencia declarada, con cita.

## catalan.json

**Fuente y versión:** Equipo Faro y clasificaciones del Idescat; consulta de clasificaciones 06/10/2026

**Esquema y procedencia:** Traducciones parciales de tareas, ocupaciones y grupos, marca y avisos; fuente
separada de títulos del Idescat.

**Función:** Presentación en catalán y procedencia de cada traducción.

**Condiciones:** Textos propios sujetos a la licencia del proyecto y a condiciones de fuentes ESCO/OIT. Títulos
Idescat: citar fuente, fecha y enlace sin modificar ni sugerir aval. No constituye una traducción oficial de
ESCO/OIT.

## vectores-formacion.json

**Fuente y versión:** Equipo Faro a partir de especialidades y títulos oficiales ESCO; generado el 27/09/2026

**Esquema y procedencia:** Dos índices: especialidades y ocupaciones; modelo text-embedding-3-small, 512
dimensiones, IDs, escalas y datos int8 en base64.

**Función:** Búsqueda por significado de formación y ocupaciones.

**Condiciones:** Índices derivados: conservar las condiciones y atribuciones de los textos de origen. El archivo
no declara una licencia independiente; el nombre del modelo no otorga una licencia sobre las fuentes.

## vectores-oit.json

**Fuente y versión:** Equipo Faro a partir de tareas oficiales de la OIT en inglés; generado el 27/09/2026

**Esquema y procedencia:** Modelo text-embedding-3-small, 512 dimensiones, huella de textos, IDs, escalas y
datos int8 en base64.

**Función:** Comparación por significado con tareas de referencia.

**Condiciones:** Índice derivado: conservar condiciones y atribuciones OIT. No declara licencia independiente;
el modelo no altera la licencia de los textos de origen.

## enlaces-comprobados.json

**Fuente y versión:** Equipo Faro, comprobación de enlaces del 06/10/2026

**Esquema y procedencia:** Estado de programas, webs y cursos: candidatos, códigos, enlaces rotos/sin respuesta
y cursos fuera de oferta.

**Función:** Filtrar enlaces de formación conforme a su comprobación registrada.

**Condiciones:** Observaciones propias de enlaces; no contienen reproducciones de páginas ni conceden derechos
sobre sus contenidos. Las páginas enlazadas mantienen sus condiciones.

## comarcas.json

**Fuente y versión:** Idescat, «Codis territorials: municipis» (https://www.idescat.cat/codis/?id=50&n=9&f=ssv),
descargado el 21/10/2026; huella SHA-256 del original en su entrada del manifiesto.

**Esquema y procedencia:** las 43 comarcas por su código y los 947 municipios como [código de 6 cifras, nombre,
código de comarca]; las dos primeras cifras del código son la provincia. Lo escribe
`python3 -m plataforma_datos.cursos.fuentes.hoja_de_ruta.lector comarcas` desde las entradas fijadas de `datos/fuentes/hoja-de-ruta/`.

**Función:** saber si un curso presencial es de la comarca (o la provincia) de la persona en la hoja de ruta.

**Condiciones:** aviso legal del Idescat: citar la fuente con la fecha de la última actualización, enlazar con
idescat.cat, sin modificar los datos ni sugerir aval.

## temarios.json

**Fuente y versión:** fichas oficiales de cada especialidad (SEPE, Consorci per a la Formació Contínua de Catalunya
y FUNDAE), descargadas el 21/10/2026; extractos y procedencia en `datos/fuentes/hoja-de-ruta/`.

**Esquema y procedencia:** por código de especialidad, el objetivo general y los módulos literales, en su idioma
(`es` o `ca`), si la lista de módulos está completa, la fuente (organismo y enlace al PDF) y la fecha. Lo escribe
`python3 -m plataforma_datos.cursos.fuentes.hoja_de_ruta.lector temarios`; sin resumir, traducir ni inventar.

**Función:** «Qué aprenderás» en cada curso de la hoja de ruta personal.

**Condiciones:** SEPE: Ley 37/2007 y RD 1495/2011, citar origen y fecha. Consorci: Llicència oberta d'ús
d'informació – Catalunya. FUNDAE no publica licencia de reutilización: texto literal con cita y enlace.

## manifiesto.json

**Fuente y versión:** registro generado junto al paquete; la identidad exacta es su huella SHA-256.
**Esquema y procedencia:** objeto indexado por nombres de archivo. Cada entrada contiene `sha256`;
`origenes` registra las rutas de procedencia y sus huellas cuando están disponibles. Los índices históricos de vectores y las comprobaciones de enlaces se vinculan a la captura fijada
de `datos/fuentes/recursos-fijados/`; su README distingue reproducción exacta de regeneración desde las fuentes. Los nombres y el orden se conservan en la exportación.
**Función:** comprobar integridad de los archivos y determinar la versión pública del paquete.
**Condiciones:** el registro de integridad no concede licencias adicionales sobre los datos.

## globales/datos-globales.json

**Fuente y versión:** contrato 1, con fecha de generación en `generado`. Las fichas identifican sus fuentes
originales, entre ellas Eurostat, Idescat, INE, Comisión Europea, OIT y las encuestas nacionales de empleo.

**Esquema y función:** indicadores y territorios con observaciones por año; recuentos, metas normativas,
encuestas de opinión y cálculos de Faro en bloques distintos. La web y las consultas de MCP, A2A y la API de
socios usan la misma captura. Las consultas no llaman a modelos de IA ni recalculan las cifras.

**Interpretación:** conservar unidad, año, naturaleza, comparabilidad, notas e intervalos. `null` con cotas no
significa cero. La cobertura mundial describe los países disponibles; no declara un agregado mundial.
`generado` fecha la captura, no todas las observaciones. Una meta es un objetivo, no una cifra observada.

**Condiciones:** conservar las citas, licencias y avisos de cada ficha y de cada encuesta nacional. Faro es
distribuidor y autor de los cálculos identificados como tales; no sustituye a sus fuentes. Cuando una ficha
no declara licencia, la consulta lo indica y no le atribuye otra.

## lecturas.json

Catálogo editorial de la Biblioteca, que reúne las guías y las lecturas. Cada entrada identifica su fuente, enlace,
fecha, condiciones de uso, nivel de lectura, tipo, segmento y textos en castellano y catalán. Contiene las referencias
y descripciones utilizadas por la página; no reproduce los documentos externos enlazados. Toda lectura enlaza a su fuente original o a una página de Faro, y
se puede leer en castellano o en catalán.

`npm run lecturas:generar` valida el catálogo y genera la sección de la página y sus diccionarios.
`npm run lecturas:comprobar` detecta desajustes sin escribir. La autoría vive en
[`plataforma_datos/biblioteca/fuentes/lecturas/catalogo.json`](../plataforma_datos/biblioteca/fuentes/lecturas/catalogo.json);
su productor prepara, valida y exporta esta entrega. No se edita directamente.
El navegador recibe el HTML y los textos generados. No pertenece al manifiesto ocupacional ni se añade a su
paquete descargable. Las condiciones de cada referencia siguen siendo las de su titular.

## empresas.json

Señal general del uso de IA en empresas de Cataluña, del conjunto admitido de ETICCE (INE).
Conserva el periodo de referencia, la población, el denominador, la clasificación y la ruptura declarados por su
edición, además de las capturas detalladas con URL y SHA-256. D.1 de la edición 2025–1T2026 se refiere a empresas
con Internet de diez o más personas, en el ámbito CNAE-2025; no equivale al indicador PC_ENT de Eurostat ni a una
probabilidad de uso individual. No se calcula una variación anual con una base distinta.

El productor es `plataforma_datos/orquestacion/exportacion/contexto_empresarial.py`, integrado en
`python -m plataforma_datos.orquestacion.exportar_paquete`. Lo consumen la señal «Qué vigilar» del informe breve
y el desplegable de su base estadística, fuera de las hojas impresas. No incluye la plantilla TIC ni la tabla de
paso a sectores, que tienen otros denominadores. Los datos del INE conservan su cita y condiciones de reutilización;
la licencia del código no sustituye esos derechos.

## sectores.json

Reparto publicado del grupo de ocupación en Cataluña según el Censo de Población 2021 del INE, por lugar de trabajo
registrado del establecimiento: personas ocupadas de 16 o más años, referencia del 1 de enero de 2021. Conserva
CNO-11, actividades CNAE-2009, mínimos de difusión, sectores y resto calculados por la fuente, y las remisiones
explícitas a grupos de dos cifras. No se une con CNAE-2025 ni se ponderan con él porcentajes empresariales.

Lo produce `paquete_sectores` en `plataforma_datos/orquestacion/exportacion/contexto_empresarial.py`, desde el
conjunto admitido, y lo consume el desplegable «Contexto censal del grupo» del informe breve, fuera de las dos hojas
impresas. Una correspondencia ocupacional ambigua o un reparto ausente conservan el contexto desconocido.
El reparto no identifica el sector de una persona ni de su empresa. Conserva la cita y condiciones del INE.

## Condiciones de referencia

- [Unión Europea: aviso legal](https://commission.europa.eu/legal-notice_en).
- [INE: aviso legal](https://www.ine.es/dyngs/AYU/index.htm?cid=125).
- [OIT: Working Paper 140](https://doi.org/10.54394/HETP0387).
- [BOE: condiciones de reutilización](https://www.boe.es/informacion/aviso_legal/).
- [Generalitat: licencias de datos abiertos](https://web.gencat.cat/ca/generalitat/dades-indicadors/dades-obertes/llicencies).
- [Idescat: condiciones de uso de sus API](https://www.idescat.cat/dev/api/?lang=es).
- [Citilab: condiciones de uso](https://www.citilab.eu/condicions-dus/).
- [Barcelona Activa: aviso legal](https://www.barcelonactiva.cat/ca/avis-legal).
