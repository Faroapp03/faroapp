// Textos de créditos, fuentes y ejemplo del informe en castellano. Se incorporan al diccionario de es.js.

/** Una licencia que comparten varias fuentes: la de los datos del INE. */
const LICENCIA_INE = 'CC BY 4.0, citando al INE';
/** Una licencia que comparten varias fuentes: la de los datos de la Unión Europea. */
const LICENCIA_UE = '© Unión Europea; reutilización citando la fuente';
/** Una licencia que comparten varias fuentes: la de los datos del Idescat. */
const LICENCIA_IDESCAT = 'Aviso legal del Idescat: citar la fuente y la fecha, sin modificar los datos';
/** Una licencia que comparten varias fuentes: la de los datos del SEPE ({0}, su cita). */
const LICENCIA_SEPE = 'Aviso legal del SEPE: «{0}» y la fecha';
/** Una licencia que comparten varias fuentes: la de los datos abiertos de la Generalitat. */
const LICENCIA_OBERTA_CATALUNYA = "Llicència oberta d'ús d'informació – Catalunya";

/**
 * Diccionario de solo lectura (clave -> texto) en castellano con los créditos, las fuentes y el ejemplo del informe.
 * @type {Readonly<Record<string, string>>}
 */
export const TEXTOS_CREDITOS = {
  'creditos.vectores.uso':
    'Vectores para relacionar textos, ocupaciones y cursos. Ajustados y destilados por Faro con datos de ESCO y de la OIT.',
  'creditos.vectores.avisos': 'Atribución y modificaciones de Faro',
  'creditos.vectores.condiciones': 'Política de usos prohibidos de Gemma',

  // ---------- Créditos (creditos.html) ----------
  'creditos.colaboradores.i2tic':
    'Colabora con Faro aportando su investigación sobre la inteligencia artificial y la transformación del empleo.',
  'creditos.colaboradores.i2tic.organismo': 'Grupo de investigación de la Universitat Oberta de Catalunya (UOC)',
  'creditos.colaboradores.sintech':
    'Colabora en el estudio de viabilidad y en el desarrollo de Faro con la perspectiva sindical y académica sobre la IA y el trabajo: ayuda a identificar posibles impactos, sesgos y aspectos de mejora.',
  'creditos.marco':
    'Faro se ha desarrollado en el marco de la Compra Pública Innovadora 2026 de {0} (Fundació pel Foment de la Societat del Coneixement), en respuesta al reto de diseñar una herramienta de IA que ayude a las personas trabajadoras a comprender el impacto de la IA en su ocupación y las competencias que necesitan. Faro y sus contenidos son responsabilidad exclusiva de su autor.',
  'creditos.categoria.colaboradores.marco': 'Marco del proyecto',
  'creditos.colaboradores.odee.cita': 'Fuente de los datos: ODEE y Cambra de Comerç de Barcelona.',
  'creditos.globo.natural-earth.licencia': 'Dominio público. {0}',
  'creditos.globo.natural-earth.uso':
    'Las fronteras del globo: países a escala 1:110 m; Cataluña, de sus provincias a 1:10 m. Son fronteras de facto: el mapa no toma posición sobre las fronteras en disputa.',
  'creditos.globo.nasa.licencia':
    'Según las condiciones de uso de la NASA, su contenido, por lo general, no está sujeto a derechos de autor en Estados Unidos; se reconoce a la NASA como fuente, sin sugerir su respaldo.',
  'creditos.globo.nasa.uso': 'La imagen de la Tierra del globo de «Datos globales».',
  'creditos.globo.nasa.obra': 'Blue Marble: Next Generation (julio de 2004)',
  'creditos.campo.version': 'Versión',
  'creditos.colaboracion.oit-nask': 'OIT en colaboración con NASK',
  'creditos.colaboracion.ine-oit': 'INE en colaboración con la OIT',
  'creditos.organismo.msit': 'MSIT y NIA (Corea del Sur)',
  'creditos.organismo.union-europea': 'Unión Europea',
  'creditos.organismo.comision-europea': 'Comisión Europea',
  'creditos.indice.unidad': 'créditos',
  'creditos.licencia.eurostat': 'Aviso de copyright de Eurostat (Decisión 2011/833/UE)',
  'creditos.grupo.condiciones': 'Condiciones comunes del grupo',
  'creditos.campo.codigo': 'Código:',
  'creditos.campo.autoria': 'Autoría',
  'creditos.campo.avisos': 'Avisos',
  'creditos.campo.fuente': 'Fuente',
  'creditos.campo.consulta': 'Fecha de consulta',
  'creditos.campo.cita': 'Cita',
  'creditos.campo.licencia': 'Licencia',
  'creditos.campo.uso': 'Uso en Faro',
  'creditos.campo.papel': 'Papel',
  'creditos.campo.organismo': 'Organismo',
  'creditos.categoria.tipografias.intro':
    'Las tres familias tipográficas de Faro. Se sirven desde la propia web, con la SIL Open Font License 1.1.',
  'creditos.categoria.tipografias': 'Tipografías',
  'creditos.categoria.imagenes.intro': 'Las fotografías de las portadas.',
  'creditos.categoria.mapas.intro': 'La imagen de la Tierra y las fronteras del globo de «Datos globales».',
  'creditos.categoria.mapas': 'Geografía y mapas',
  'creditos.categoria.normativa.intro':
    'Las leyes, las decisiones y las recomendaciones que Faro cita o resume, con el enlace al texto oficial.',
  'creditos.categoria.normativa': 'Normativa y documentos de referencia',
  'creditos.categoria.clasificaciones.intro':
    'Clasificaciones, marcos de referencia y vocabularios con que Faro ordena las ocupaciones y las competencias y reconoce nombres propios.',
  'creditos.categoria.clasificaciones': 'Clasificaciones y vocabularios',
  'creditos.categoria.otros-paises.intro':
    'Las oficinas de estadística y los ministerios de otros países cuyas cifras usa «El mundo», en «Datos globales»: el uso de la IA, que cada país mide a su manera y no se compara entre países, y el empleo por ocupación con que se calcula la exposición. Ninguno ha revisado Faro ni lo respalda.',
  'creditos.categoria.otros-paises': 'Estadísticas de otros países',
  'creditos.categoria.estadisticas.intro':
    'Las cifras oficiales del informe, de «Datos globales» y de las fichas en PDF de la Biblioteca. Junto a cada cifra aparecen su fuente y su año. Lo que Faro calcula con ellas es elaboración propia. Ninguna de estas entidades ha revisado Faro ni lo respalda.',
  'creditos.categoria.estadisticas': 'Datos oficiales y estadísticas',
  'creditos.categoria.colaboradores.grupo': 'Colaboradores',
  'creditos.categoria.colaboradores': 'Colaboradores y marco del proyecto',
  'creditos.licencia.idescat': LICENCIA_IDESCAT,
  'creditos.grupo.idescat.licencia':
    'Aviso legal del Idescat (https://www.idescat.cat/institut/web/?lang=es) y condiciones de uso de sus API (https://www.idescat.cat/dev/api/?lang=es): reutilización permitida citando la fuente («Fuente: elaboración propia a partir de datos del Idescat») con la fecha de la última actualización, enlazando con idescat.cat, sin modificar los datos al presentarlos y sin sugerir que el Idescat apoya el uso.',
  'creditos.abre-en-otra-pestana': 'Los enlaces a otras webs se abren en otra pestaña.',
  'creditos.autoria': 'Faro lo hace el Equipo Faro.',
  'creditos.bibliotecas.country-flag-icons.uso':
    'Las banderas de los países de «El mundo», salvo las de diseño propio de Faro',
  'creditos.bibliotecas.noble.uso': 'Criptografía para comprobar las firmas de la web de Faro',
  'creditos.bibliotecas.qrcode-generator.uso': 'El código QR de «Pasar a otro dispositivo»',
  'creditos.citar': 'Cómo citar Faro',
  'creditos.citar-texto': 'Equipo Faro (2026). Faro · IA, trabajo y formación. Versión 1.0.0.',
  'creditos.colaboradores.gracias':
    'Gracias también a los organismos que publican sus datos con licencias abiertas y los mantienen al día.',
  'creditos.colaboradores.odee':
    'El Observatori Dona, Empresa i Economia facilitó a Faro la tabla por ocupación de su estudio {0} (2026).',
  'creditos.descripcion':
    'Quién hace posible Faro y de dónde salen sus datos, sus imágenes y su software, con su licencia.',
  'creditos.entradilla':
    'Quién hace posible Faro y de dónde salen sus datos, sus imágenes y su software, con la licencia de cada uno.',
  'creditos.formacion.intro':
    'Quién publica la formación, los certificados y las acreditaciones que te propone Faro. Faro enseña los datos de cada curso y enlaza su ficha oficial.',
  'creditos.fuente.acreditacion-competencias.conjunto': 'Certificados profesionales y acreditación de competencias',
  'creditos.fuente.acreditacion-competencias.licencia':
    "Condiciones del BOE, aviso legal del INE, ODC-BY 1.0 y Llicència oberta d'ús d'informació – Catalunya",
  'creditos.fuente.acreditacion-competencias.nombre': 'BOE, INE, SOC y Agència FP.CAT',
  'creditos.fuente.acreditacion-competencias.uso':
    'Los certificados profesionales relacionados con tu ocupación y el servicio de acreditación de competencias en Cataluña.',
  'creditos.fuente.actic.conjunto': 'Acreditación de competencias digitales (ACTIC)',
  'creditos.fuente.actic.licencia':
    "Disposiciones del DOGC, sin propiedad intelectual; portal: Llicència oberta d'ús d'informació – Catalunya",
  'creditos.fuente.actic.uso':
    'La acreditación ACTIC del bloque de competencias digitales, según las órdenes EMT/47/2026 y EMT/48/2026 (DOGC 9634) y EMT/136/2026 (DOGC 9712).',
  'creditos.fuente.barcelona-activa.conjunto': 'Catálogo de ocupaciones y formaciones de IA del Cibernàrium',
  'creditos.fuente.barcelona-activa.licencia':
    'Aviso legal de Barcelona Activa: Faro solo enlaza, sin copiar sus textos',
  'creditos.fuente.barcelona-activa.uso':
    'La ficha de tu ocupación en su catálogo y sus formaciones de IA, solo con el enlace.',
  'creditos.fuente.cambra.licencia': 'Permiso por escrito: citar al ODEE y a la Cambra junto al dato',
  'creditos.fuente.cambra.uso':
    'El dato de género del conjunto de Cataluña, con la página del estudio. Faro no publica su tabla.',
  'creditos.fuente.citilab-cursos.conjunto': 'Cursos de citilab.eu',
  'creditos.fuente.citilab-cursos.licencia': 'Uso informativo citando la fuente',
  'creditos.fuente.citilab-cursos.uso':
    'Los cursos presenciales de Citilab en Cornellà: solo los hechos (nombre, fechas, precio), con el enlace a su ficha.',
  'creditos.fuente.clasificaciones.conjunto':
    'Clasificación Nacional de Ocupaciones (CNO-11) y su correspondencia con la CIUO-08 (ISCO-08)',
  'creditos.fuente.clasificaciones.licencia': 'Aviso legal del INE, citando la fuente',
  'creditos.fuente.clasificaciones.uso':
    'Los nombres de los grupos de ocupación y el paso entre la clasificación española y la internacional.',
  'creditos.fuente.consorci-cursos.conjunto': 'Cursos programados',
  'creditos.fuente.consorci-cursos.licencia': LICENCIA_OBERTA_CATALUNYA,
  'creditos.fuente.consorci-cursos.uso': 'Cursos para personas que trabajan.',
  'creditos.fuente.crl.conjunto': 'Recomendaciones sobre digitalización e IA para la negociación colectiva (2025)',
  'creditos.fuente.crl.licencia': 'CC BY-NC-ND 3.0: Faro lo resume y lo enlaza',
  'creditos.fuente.crl.uso': 'El resumen de lo que recomienda sobre la IA en el trabajo, con el enlace al documento.',
  'creditos.fuente.derechos-formacion.conjunto':
    'Estatuto de los Trabajadores, Real Decreto 694/2017 y Ley Orgánica 3/2018',
  'creditos.fuente.derechos-formacion.licencia': 'Textos legales, sin propiedad intelectual; citando el BOE',
  'creditos.fuente.derechos-formacion.uso':
    'Tus derechos de formación y ante la tecnología en el trabajo, citados al pie de la letra.',
  'creditos.fuente.digcomp.conjunto': 'DigComp 3.0, marco europeo de competencias digitales',
  'creditos.fuente.digcomp.licencia': 'CC BY 4.0, citando al JRC',
  'creditos.fuente.digcomp.nombre': 'Centro Común de Investigación (JRC)',
  'creditos.fuente.digcomp.uso':
    'Los niveles de competencia digital con que se describen los cursos de competencias digitales.',
  'creditos.fuente.esco.aviso': 'Datos de ESCO adaptados; la Comisión Europea no es responsable de esta adaptación.',
  'creditos.fuente.esco.conjunto':
    'ESCO v1.2.1: clasificación europea de capacidades, competencias, cualificaciones y ocupaciones',
  'creditos.fuente.esco.licencia': LICENCIA_UE,
  'creditos.fuente.esco.uso': 'Reconocer tu ocupación por sus nombres en femenino, masculino y alternativos.',
  'creditos.fuente.eures-cosispe.conjunto': 'Correspondencia ESCO – CO-SISPE 2011',
  'creditos.fuente.eures-cosispe.licencia': LICENCIA_UE,
  'creditos.fuente.eures-cosispe.nombre': 'EURES',
  'creditos.fuente.eures-cosispe.uso': 'Relacionar tu ocupación de ESCO con las ocupaciones que usa el SEPE.',
  'creditos.fuente.idescat-censo-anual.conjunto': 'Censo anual de población',
  'creditos.fuente.idescat-censo-anual.uso': 'Cómo ha cambiado el número de personas ocupadas de tu grupo en Cataluña.',
  'creditos.fuente.idescat-classificacions.conjunto': 'CIUO-2008 y CCO-2011 en catalán',
  'creditos.fuente.idescat-classificacions.uso': 'Los nombres oficiales en catalán de los grupos de ocupación.',
  'creditos.fuente.ine-censo-2021-api.conjunto': 'Censo 2021, por edad y estudios',
  'creditos.fuente.ine-censo-2021-api.licencia': LICENCIA_INE,
  'creditos.fuente.ine-censo-2021-api.uso': 'Quién trabaja en tu grupo: edad y estudios, en el conjunto de Cataluña.',
  'creditos.fuente.ine-censo-2021.conjunto': 'Censo de Población 2021',
  'creditos.fuente.ine-censo-2021.licencia': LICENCIA_INE,
  'creditos.fuente.ine-censo-2021.uso': 'Cuántas personas trabajan en tu grupo de ocupaciones en Cataluña.',
  'creditos.fuente.ine-ees-2022.conjunto': 'Encuesta de Estructura Salarial 2022',
  'creditos.fuente.ine-ees-2022.licencia': LICENCIA_INE,
  'creditos.fuente.ine-ees-2022.uso': 'El salario medio bruto anual del gran grupo de tu ocupación en Cataluña.',
  'creditos.fuente.ine-tich-2025.conjunto': 'Encuesta sobre el uso de tecnologías en los hogares (TIC-H) 2025',
  'creditos.fuente.ine-tich-2025.licencia': LICENCIA_INE,
  'creditos.fuente.ine-tich-2025.uso':
    'Cuántas personas de tu grupo dicen usar la IA generativa: cálculo propio con los microdatos.',
  'creditos.fuente.nombres.conjunto': 'Nombres y apellidos más frecuentes',
  'creditos.fuente.nombres.licencia': LICENCIA_INE,
  'creditos.fuente.nombres.uso': 'Reconocer nombres propios en lo que escribes y quitarlos antes de enviarlo a la IA.',
  'creditos.fuente.observatori-treball.licencia': LICENCIA_OBERTA_CATALUNYA,
  'creditos.fuente.observatori-treball.uso':
    'La contratación de tu grupo en Cataluña y por provincias en los últimos doce meses.',
  'creditos.fuente.oit.cita': 'Cita y avisos de la OIT',
  'creditos.fuente.oit.conjunto': 'Índice de exposición a la IA generativa por tareas (Working Paper 140, 2025)',
  'creditos.fuente.oit.licencia': 'CC BY 4.0, con la cita y los avisos de la OIT',
  'creditos.fuente.oit.uso':
    'Las tareas oficiales de cada tipo de trabajo y su nota de exposición, con las notas por tarea que publica su autor principal. Faro las traduce con IA y las resume.',
  'creditos.fuente.sepe-especialidades.conjunto': 'Catálogo de Especialidades Formativas',
  'creditos.fuente.sepe-especialidades.licencia': LICENCIA_SEPE,
  'creditos.fuente.sepe-especialidades.uso': 'Las especialidades formativas que el SEPE relaciona con tu ocupación.',
  'creditos.fuente.sepe-observatorio.conjunto':
    'Observatorio de las Ocupaciones: necesidades formativas y certificados por ocupación',
  'creditos.fuente.sepe-observatorio.licencia': LICENCIA_SEPE,
  'creditos.fuente.sepe-observatorio.uso':
    'Qué formación pide tu ocupación y otros certificados profesionales que el SEPE relaciona con ella.',
  'creditos.fuente.soc-cursos.conjunto': 'Cursos y especialidades formativas',
  'creditos.fuente.soc-cursos.licencia': "ODC-BY 1.0 y Llicència oberta d'ús d'informació – Catalunya",
  'creditos.fuente.soc-cursos.uso':
    'Los cursos de formación para el empleo que imparten las especialidades de tu ocupación.',
  'creditos.fuente.uned-abierta.conjunto': 'Cursos abiertos en línea (iedra)',
  'creditos.fuente.uned-abierta.licencia': 'Solo enlaces, sin reutilizar sus contenidos',
  'creditos.fuente.uned-abierta.uso':
    'Cursos gratuitos en línea de competencias digitales. Faro escribe sus propias fichas y enlaza el curso.',
  'creditos.imagenes.aprendizaje.tema': 'Un bolígrafo sobre un cuaderno',
  'creditos.imagenes.aprendizaje.uso': 'Acceso a «Cómo funciona».',
  'creditos.imagenes.autoria': 'Fotografía de {0} · {1}',
  'creditos.imagenes.faro-penmon.tema': 'Faro de Trwyn Du, Penmon (Gales)',
  'creditos.imagenes.faro-penmon.uso': 'Portada de inicio y del informe.',
  'creditos.imagenes.faro-portland.tema': 'Portland Head Light, Cape Elizabeth (Estados Unidos)',
  'creditos.imagenes.faro-portland.uso': 'Acceso y cabecera de «Qué es Faro».',
  'creditos.imagenes.intro':
    'Las fotografías proceden de Unsplash y se usan con su licencia, que no exige crédito: lo damos igualmente. Solo se han redimensionado y convertido a WebP.',
  'creditos.imagenes.licencia': 'Licencia de Unsplash',
  'creditos.imagenes.marca':
    'El símbolo de Faro, sus iconos y las banderas del selector de idioma son dibujos propios.',
  'creditos.imagenes.trabajo.tema': 'Manos escribiendo en un portátil',
  'creditos.imagenes.trabajo.uso': 'Acceso y cabecera de «Qué es la IA».',
  'creditos.indice.nombre': 'En esta página',
  'creditos.licencias': 'Textos de las licencias',
  'creditos.reutilizar.1': 'Código: todos sus derechos están reservados.',
  'creditos.reutilizar.2':
    'Textos y cálculos propios de Faro (notas por ocupación, resúmenes de tareas): licencia CC BY 4.0. Si los reutilizas, cita a Faro y a la fuente original.',
  'creditos.reutilizar.3':
    'Datos de terceros: conservan su licencia. Si los reutilizas, cita la fuente original tal como figura en esta página.',
  'creditos.reutilizar.4':
    'Las tareas de la OIT que muestra Faro son traducciones hechas con IA, no traducciones oficiales: llevan el aviso de la OIT.',
  'creditos.reutilizar.5': 'La tabla del ODEE y la Cambra no se puede reutilizar desde Faro: pídela al ODEE.',
  'creditos.reutilizar.6':
    'Las guías y las lecturas de la Biblioteca son de sus autores y conservan su licencia: Faro las enlaza tal como se publican. Sus resúmenes los escribe Faro con sus propias palabras (CC BY 4.0).',
  'creditos.rotulo': 'Transparencia',
  'creditos.seccion.formacion': 'Formación',
  'creditos.seccion.imagenes': 'Imágenes y fotografía',
  'creditos.seccion.reutilizar': 'Reutilizar',
  'creditos.seccion.software': 'Software libre',
  'creditos.software.intro': 'Lo que llega a tu navegador además del código propio de Faro, con su licencia.',
  'creditos.tipografias.jetbrains-mono.uso': 'Cifras y códigos',
  'creditos.tipografias.sora.uso': 'Marca y titulares',
  'creditos.tipografias.space-grotesk.uso': 'Texto',
  'creditos.titulo': 'Créditos · Faro',
  'creditos.titulo-principal': 'Créditos',
  // ---------- Informe de ejemplo (informe-ejemplo.html; el informe lo escribe el motor) ----------
  'informe-ejemplo.aviso': 'Informe de ejemplo de Faro con un caso ficticio y datos oficiales. {0}',
  'informe-ejemplo.descripcion':
    'Ejemplo de informe de Faro con un caso ficticio: qué puede cambiar en un trabajo con la IA, tarea a tarea, y de dónde sale cada dato.',
  'informe-ejemplo.no-guarda':
    'En el recorrido, este botón borra el informe y todo lo escrito en la página. Este ejemplo no guarda nada.',
  'informe-ejemplo.titulo': 'Informe de ejemplo · Faro',
  'verificable.descripcion':
    'Faro verificable: comprueba en tu navegador que el motor y los datos que descarga Faro son los de su lista de huellas.',
  'verificable.titulo': 'Faro verificable · Faro',
  'verificable.rotulo': 'Faro verificable',
  'verificable.titulo-principal': 'Comprobar que Faro es el que se publicó',
  'verificable.entradilla':
    'Para usar Faro en este dispositivo, tu navegador descarga el motor de Faro y sus datos. Esta página los vuelve a pedir, calcula la huella SHA-256 de cada archivo y la compara con la lista de huellas de esta versión, el manifiesto.',
  'verificable.huellas.titulo': 'Huellas y firma',
  'verificable.huellas.texto':
    'Que las huellas coincidan dice que los archivos son los que nombra el manifiesto. Quién publicó el manifiesto solo lo dice su firma, que se comprueba con las claves raíz que lleva el código de Faro. Si esta versión aún no las lleva, la página lo dice y no da Faro por verificado.',
  'verificable.repetir': 'Volver a comprobar',
  'verificable.estado.comprobando': 'Comprobando…',
  'verificable.resultado.titulo': 'Resultado',
  'verificable.firma': 'Firma:',
  'verificable.firma.comprobada': 'comprobada con las claves raíz de esta versión de Faro',
  'verificable.firma.sin-activar': 'sin activar: esta versión de Faro aún no lleva las claves raíz',
  'verificable.firma.sin-comprobar': 'sin comprobar: no hay un manifiesto válido que comprobar',
  'verificable.firma.no-valida': 'no vale (motivo técnico: {motivo})',
  'verificable.paquete': 'Paquete de datos:',
  'verificable.paquete.desconocido': 'sin leer: no hay un manifiesto válido que lo diga',
  'verificable.cuantos': 'Archivos:',
  'verificable.cuantos.valor': '{coinciden} de {total} coinciden con el manifiesto',
  'verificable.archivo.coincide': 'Coincide',
  'verificable.archivo.no-coincide': 'No coincide',
  'verificable.archivo.no-disponible': 'No se ha podido descargar',
  'verificable.veredicto.verificado':
    'Verificado: la firma del manifiesto vale y los {total} archivos coinciden con él.',
  'verificable.veredicto.coinciden-sin-firma':
    'Firma sin activar; las huellas coinciden con el manifiesto: los {total} archivos son los que nombra.',
  'verificable.veredicto.no-coinciden': '{fallan} de {total} archivos no coinciden con el manifiesto.',
  'verificable.veredicto.incompleto':
    'No se han podido descargar {faltan} de {total} archivos; los demás coinciden con el manifiesto.',
  'verificable.veredicto.sin-manifiesto': 'No se ha podido descargar el manifiesto: no hay con qué comparar.',
  'verificable.veredicto.manifiesto-no-valido': 'El manifiesto no es válido: no hay con qué comparar.',
  'verificable.veredicto.firma-no-valida': 'La firma del manifiesto no vale: no se compara ningún archivo.',
  'verificable.significado.verificado':
    'Lo que usa Faro en este dispositivo es, byte a byte, lo que se firmó con las claves de Faro.',
  'verificable.significado.coinciden-sin-firma':
    'Los archivos que recibe tu navegador son los que nombra el manifiesto de esta versión. Como la firma aún no está activada, esto no demuestra quién publicó el manifiesto: llega del mismo servidor que los archivos.',
  'verificable.significado.no-coinciden':
    'Los archivos marcados no son los que nombra el manifiesto. Puede ser una actualización a medias: vuelve a comprobarlo en unos minutos. Si sigue igual, lo que recibe este dispositivo no es lo que se publicó.',
  'verificable.significado.incompleto':
    'Sin conexión, o mientras no está completa la copia para usar Faro sin conexión, algunos archivos no llegan. Lo que ha llegado coincide; vuelve a comprobarlo con conexión.',
  'verificable.significado.sin-manifiesto':
    'Sin el manifiesto no se puede comprobar nada. Revisa la conexión y vuelve a comprobarlo.',
  'verificable.significado.manifiesto-no-valido':
    'No es el manifiesto que escribe Faro al publicar una versión, así que no sirve para comparar ningún archivo.',
  'verificable.significado.firma-no-valida':
    'Una lista de huellas cuya firma no vale no dice nada de los archivos. Mientras no valga, el motor de Faro tampoco usa nada en este dispositivo.',
  'informe.compartir': 'Compartir mi informe',
  'informe.compartir.ayuda':
    'Se comparte desde tu dispositivo, con la aplicación que elijas: Faro no lo envía a ningún sitio.',
  'informe.compartir.fallo': 'No se ha podido compartir el informe desde este dispositivo. Puedes guardarlo en PDF.',
  'informe.escuchar': 'Escuchar mi informe',
  'informe.escuchar.pausar': 'Pausar la lectura',
  'informe.escuchar.seguir': 'Seguir la lectura',
  'informe.escuchar.parar': 'Parar la lectura',
  'informe.escuchar.ayuda':
    'Lo lee una voz de tu dispositivo: el texto no sale de él. Si usas un lector de pantalla, pausa su lectura mientras tanto para que no se pisen las dos voces.',
  'informe.escuchar.sin-voz':
    'Para escuchar tu informe hace falta una voz en {lengua} instalada en este dispositivo. Faro no usa voces de internet: así el texto no sale de él.',
  'informe.escuchar.fallo': 'La voz del dispositivo no ha podido leer el informe.',
  'creditos.fuente.fundae.conjunto': 'Oferta de formación subvencionada para personas trabajadoras',
  'creditos.fuente.fundae.cita':
    'FUNDAE (Fundación Estatal para la Formación en el Empleo): oferta de formación subvencionada para personas trabajadoras.',
  'creditos.fuente.fundae.uso':
    'Datos de las convocatorias, entidades y colectivos, con enlaces a sus fichas. La solicitud de inscripción no garantiza una plaza.',
  'creditos.fuente.fundae.licencia':
    'Condiciones de uso de FUNDAE. No se atribuye una licencia abierta a este catálogo.',
  'creditos.fuente.fundae.condiciones': 'Información y condiciones de FUNDAE',
  'informacion-y-creditos.datos.encuesta':
    'Si participas en el piloto de Faro, puede que te den un enlace de invitación para responder una encuesta breve al terminar el recorrido. La encuesta es anónima: el código del enlace no lleva tu nombre, no se guarda con tus respuestas y deja de servir en cuanto lo usas. Faro solo guarda cuántas personas han elegido cada respuesta.',
  'informacion-y-creditos.datos.invitacion':
    'Si llegas con una invitación del piloto, su código se guarda solo en esta pestaña hasta que respondes la encuesta o cierras la pestaña, y «Borrar todo» también lo borra. El enlace sigue en tu correo y en el historial del navegador, y si el navegador recupera la pestaña cerrada, el código vuelve con ella.',
};
