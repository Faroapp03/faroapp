// Textos de «Datos globales · Cataluña» y «Datos globales · Unión Europea» en castellano: portada, clave de
// colores, índice de preguntas, «Lo esencial», capítulos, figuras, lecturas y fichas técnicas. Se incorporan al
// diccionario de es.js. Las cifras no van aquí: llegan como valores ({cifra}, {anio}) calculados con los datos.
// Lo común a las tres páginas (pestañas, estado, «El mundo» y los gráficos del globo) sigue en es/paginas.js.

/** @type {Record<string, string>} */
export const TEXTOS_DATOS_GLOBALES = {
  // ---------- Portada de «Cataluña» ----------
  'datos-globales.antetitulo': 'Datos globales · La IA en el trabajo',
  'datos-globales.titulo-principal': 'Cataluña frente a Europa',
  'datos-globales.entradilla':
    'Cuántas empresas usan inteligencia artificial y cuánta gente usa IA generativa, según las estadísticas oficiales. Cataluña, comparada con España, Alemania, Francia e Italia, y con la media de la UE como referencia.',
  'datos-globales.prudencia.titulo': 'Son datos de territorios, no de personas.',
  'datos-globales.prudencia.texto':
    'Describen poblaciones enteras y no dicen nada del empleo de quien lee. Usar la IA, o estar expuesto a ella, no equivale a perder el trabajo.',
  'datos-globales.clave-colores.nombre': 'Cómo se distinguen los territorios en los gráficos',
  'datos-globales.clave-colores.cataluna': 'Cataluña',
  'datos-globales.clave-colores.ue': 'Media de la UE-27, como referencia',
  'datos-globales.clave-colores.resto': 'España, Alemania, Francia e Italia',
  'datos-globales.clave-colores.nota':
    'Se puede comparar porque son encuestas europeas armonizadas: mismas preguntas, mismas edades y mismo año. Pero España incluye a Cataluña, y la media de la UE incluye a España: sirven de referencia, no son rivales.',
  'datos-globales.indice.titulo': 'Las preguntas de este dossier',
  'datos-globales.resumen.titulo': 'Lo esencial',
  'datos-globales.margen':
    'La muestra de Cataluña es más pequeña que la de un país: diferencias de uno o dos puntos pueden no ser reales.',
  'datos-globales.margen.encuesta':
    'Es una encuesta por muestreo: diferencias de uno o dos puntos pueden no ser reales.',

  // ---------- Piezas comunes ----------
  // «Anterior» y «Siguiente» de las paginaciones (scripts/pasos-de-pagina.js), también los de la Biblioteca.
  'comun.paginas.anterior': 'Anterior',
  'comun.paginas.siguiente': 'Siguiente',
  'comun.paginas.anterior.nombre': 'Página anterior',
  'comun.paginas.siguiente.nombre': 'Página siguiente',
  'datos-globales.pagina': 'Página {numero} de {total}',
  'datos-globales.paginas.nombre': 'Páginas de capítulos',
  'datos-globales.volver': 'Volver a las preguntas',
  'datos-globales.lectura.nombre': 'Lectura de las cifras',
  'datos-globales.fuente': 'Fuente: {fuente}',
  'datos-globales.dos-frases': '{a} {b}',
  'datos-globales.punto-y-coma': '{a}; {b}',
  'datos-globales.paneles.misma-escala': 'Los dos paneles tienen la misma escala.',
  'datos-globales.media-ue': 'Media de la UE: {cifra}',
  'datos-globales.nombre.ue': 'UE-27',
  'datos-globales.nombre.ue-media': 'UE-27 (media)',
  'datos-globales.nombre.espana': 'España (con Cataluña)',
  'datos-globales.nombre.con-cataluna': '(con Cataluña)',
  'datos-globales.alternativa.cifra': '{territorio}: {cifra}.',
  'datos-globales.alternativa.media': 'Media de la UE: {cifra}.',
  'datos-globales.cabecera.corta': 'Dif.',
  'datos-globales.anual.titulo': 'Año a año, en todos los territorios',
  'datos-globales.anual.territorio': 'Territorio',
  'datos-globales.anual.sin-dato': 'Sin dato comparable',
  'datos-globales.anual.nota': '—: sin dato comparable ese año; no se muestra.',
  'datos-globales.no-comparable.todos': '{anio}, en todos los territorios con dato',
  'datos-globales.no-comparable.algunos': '{anio}, en {territorios}',
  'datos-globales.no-comparable.nota': 'Sin dato comparable: {lista}. No se muestra.',
  'datos-globales.no-comparable.ficha':
    '{lista}. La fuente marca esas cifras como no comparables (otra definición o una ruptura de serie): no se muestran ni entran en ningún cálculo.',
  'datos-globales.no-comparable.ninguno': 'Ninguno: todas las cifras de la fuente son comparables.',
  'datos-globales.sin-cifra.nota': '{territorios}: sin cifra publicada para {anio}.',
  'datos-globales.lectura.espana.mas': 'Más que en España',
  'datos-globales.lectura.espana.parecido': 'Parecido a España',
  'datos-globales.lectura.espana.menos': 'Menos que en España',
  'datos-globales.lectura.ue.mas': 'Más que la media de la UE',
  'datos-globales.lectura.ue.parecido': 'Parecido a la media de la UE',
  'datos-globales.lectura.ue.menos': 'Menos que la media de la UE',
  'datos-globales.lectura.ue.titulo': 'En la media de la UE',
  'datos-globales.lectura.desde.mas': 'Más que en {desde}',
  'datos-globales.lectura.desde.parecido': 'Parecido a {desde}',
  'datos-globales.lectura.desde.menos': 'Menos que en {desde}',
  'datos-globales.ranking.delante.titulo': '{territorios}, por delante',
  'datos-globales.ranking.delante.uno':
    'Es el único de los cinco territorios que supera a Cataluña en un punto o más: {cifra} de cada 100, frente a {propia}.',
  'datos-globales.ranking.delante.varios':
    'Son los territorios que superan a Cataluña en un punto o más. Cataluña: {propia} de cada 100.',
  'datos-globales.ranking.primera.titulo': 'La cifra más alta de los cinco',
  'datos-globales.ranking.primera':
    'Cataluña supera en un punto o más a los otros territorios. Le sigue {segundo}, con {cifra} de cada 100.',
  'datos-globales.ranking.empate.titulo': 'Sin un primer puesto claro',
  'datos-globales.ranking.empate':
    'Ningún territorio saca un punto o más a todos los demás: con estas muestras, no se puede decir quién va delante.',

  // ---------- Ficha técnica: solo el método ----------
  'datos-globales.ficha.resumen': 'Ficha técnica: qué mide y de dónde sale',
  'datos-globales.ficha.que-mide': 'Qué mide',
  'datos-globales.ficha.unidad': 'Unidad',
  'datos-globales.ficha.base': 'Misma base',
  'datos-globales.ficha.no-se-muestran': 'Datos que no se muestran',
  'datos-globales.ficha.margen': 'Margen de error',
  'datos-globales.ficha.calculos': 'Cálculos',
  'datos-globales.ficha.calculos.texto':
    'Las restas (en puntos) y las divisiones (en veces) se hacen con las cifras sin redondear.',
  'datos-globales.ficha.fuente': 'Fuente',
  'datos-globales.ficha.tipo': 'Tipo',
  'datos-globales.ficha.no-sabe': '«No sabe cómo usarla»',
  'datos-globales.ficha.diferencia': 'Diferencia',
  'datos-globales.ficha.veces': 'Veces',
  'datos-globales.ficha.grupos': 'Grupos',
  'datos-globales.ficha.francia': 'Francia',
  'datos-globales.ficha.anio': 'Año',
  'datos-globales.ficha.comparacion': 'Por qué no se compara',
  'datos-globales.ficha.preguntas': 'Preguntas',
  'datos-globales.ficha.encuesta': 'Encuesta',
  'datos-globales.ficha.cifras': 'Cifras',
  'datos-globales.ficha.cataluna': 'Cataluña',

  // ---------- Lo esencial ----------
  'datos-globales.esencial.empresas.tema': 'Empresas · {anio}',
  'datos-globales.esencial.empresas':
    'Es decir, {cifra} de cada 100 empresas catalanas con 10 o más personas usan alguna tecnología de IA.',
  'datos-globales.esencial.empresas.comparacion': 'De cada 100 empresas, cuántas la usan:',
  'datos-globales.esencial.personas.tema': 'Personas · {anio}',
  'datos-globales.esencial.personas':
    'Es decir, {cifra} de cada 100 personas que usan internet en Cataluña usaron IA generativa en los últimos tres meses.',
  'datos-globales.esencial.personas.comparacion': 'De cada 100 personas de 16 a 74 años que usan internet:',
  'datos-globales.esencial.trabajo.tema': 'Para trabajar · {anio}',
  'datos-globales.esencial.trabajo':
    'Es decir, {cifra} de cada 100 personas que usan internet en Cataluña usaron IA generativa para su trabajo.',
  'datos-globales.esencial.trabajo.comparacion': 'De cada 100 personas de 16 a 74 años que usan internet:',
  'datos-globales.esencial.genero.tema': 'Mujeres y hombres · {anio}',
  'datos-globales.esencial.genero':
    'de diferencia en Cataluña: usan IA generativa {hombres} de cada 100 hombres y {mujeres} de cada 100 mujeres que usan internet.',
  'datos-globales.esencial.genero.comparacion': 'La misma diferencia, en puntos:',
  'datos-globales.esencial.genero.pie':
    'Puntos: la resta entre las dos cifras de cada 100 ({hombres} − {mujeres} ≈ {puntos}).',
  'datos-globales.esencial.fuente.eurostat': 'Fuente: Eurostat',
  'datos-globales.esencial.fuente.idescat': 'Fuente: Idescat y Eurostat',

  // ---------- 01 · Empresas ----------
  'datos-globales.empresas.tema': 'Empresas · evolución',
  'datos-globales.empresas.pregunta': '¿Cuántas empresas usan IA?',
  'datos-globales.empresas.titular.cuarto-doble':
    'Casi 1 de cada 4 empresas catalanas ya usan IA: más del doble que en {desde}',
  'datos-globales.empresas.titular.cuarto': 'Casi 1 de cada 4 empresas catalanas ya usan IA',
  'datos-globales.empresas.titular.cifra-doble':
    '{cifra} de cada 100 empresas catalanas usan IA: más del doble que en {desde}',
  'datos-globales.empresas.titular.cifra': '{cifra} de cada 100 empresas catalanas usan IA',
  'datos-globales.empresas.titular.neutro': 'Las empresas que usan IA, en Cataluña y en Europa',
  'datos-globales.empresas.entradilla':
    'En {desde} usaban IA {inicio} de cada 100 empresas catalanas con 10 o más personas; en {hasta}, {fin}.',
  'datos-globales.empresas.entradilla.un-anio':
    'En {hasta} usan IA {fin} de cada 100 empresas catalanas con 10 o más personas.',
  'datos-globales.empresas.entradilla.comparacion':
    'En España (con Cataluña), {espana} de cada 100; en la media de la UE, {ue}.',
  'datos-globales.empresas.figura': 'De cada 100 empresas, cuántas usan al menos una tecnología de IA',
  'datos-globales.empresas.figura.sub':
    'Empresas con 10 o más personas (sin agricultura, minería ni sector financiero), igual en todos los territorios. {desde}–{hasta}.',
  'datos-globales.empresas.fuente': 'Eurostat (isoc_eb_ai; Cataluña: isoc_r_eb_ain2)',
  'datos-globales.empresas.anual.leyenda': 'Empresas que usan IA, de cada 100, por año y por territorio',
  'datos-globales.empresas.anual.sub':
    'De cada 100 empresas con 10 o más personas, cuántas usan IA. La barra de cada celda va de 0 a {maximo}.',
  'datos-globales.empresas.lectura.doble-dos': 'Más del doble en dos años',
  'datos-globales.empresas.lectura.doble': 'Más del doble desde {desde}',
  'datos-globales.empresas.lectura.evolucion':
    'En {desde} usaban IA {inicio} de cada 100 empresas catalanas; en {hasta}, {fin}.',
  'datos-globales.empresas.lectura.territorios':
    'En {anio}: Cataluña, {cataluna} de cada 100 empresas; España (con Cataluña), {espana}; media de la UE, {ue}.',
  'datos-globales.empresas.ficha.que-mide':
    'Empresas con 10 o más personas que usan al menos una de ocho tecnologías de IA: analizar textos, entender la voz, generar lenguaje o código, reconocer imágenes, aprendizaje automático, automatizar tareas, robots autónomos y generar imagen, vídeo o audio.',
  'datos-globales.empresas.ficha.desde':
    'Las cifras empiezan en {desde}: antes, la encuesta preguntaba por menos tecnologías y no son comparables.',
  'datos-globales.empresas.ficha.unidad':
    'Porcentaje de empresas: de cada 100 empresas con 10 o más personas, cuántas.',
  'datos-globales.empresas.ficha.base':
    'La misma encuesta europea, la misma definición, el mismo tipo de empresas (industria y servicios, sin agricultura, minería ni sector financiero) y el mismo año en todos los territorios. España incluye a Cataluña, y la media de la UE incluye a España.',
  'datos-globales.empresas.ficha.veces':
    'Por ejemplo, {fin} ÷ {inicio} = {veces}: en {hasta}, la cifra de Cataluña es {veces} veces la de {desde}.',
  'datos-globales.empresas.ficha.fuente':
    'Eurostat, encuesta europea sobre el uso de las TIC en las empresas: isoc_eb_ai (países y UE-27) e isoc_r_eb_ain2 (Cataluña, región ES51); indicador E_AI_TANY, unidad PC_ENT.',

  // ---------- 02 · Personas ----------
  'datos-globales.personas.tema': 'Personas · comparación',
  'datos-globales.personas.pregunta': '¿Cuánta gente usa la IA generativa?',
  'datos-globales.personas.titular.mitad': 'Casi la mitad de quienes usan internet en Cataluña ya usa IA generativa',
  'datos-globales.personas.titular.cifra':
    '{cifra} de cada 100 personas que usan internet en Cataluña usan IA generativa',
  'datos-globales.personas.titular.neutro': 'La IA generativa entre quienes usan internet, en Cataluña y en Europa',
  'datos-globales.personas.entradilla':
    'En {anio}, la usaron {cifra} de cada 100 personas de 16 a 74 años que usan internet en Cataluña, y {trabajo} de cada 100 la usaron para su trabajo.',
  'datos-globales.personas.entradilla.primera':
    'Son las cifras más altas de los cinco territorios en los dos casos, por un punto o más.',
  'datos-globales.personas.figura':
    'De cada 100 personas que usan internet, cuántas usaron IA generativa en los últimos tres meses',
  'datos-globales.personas.figura.sub':
    'Personas de 16 a 74 años que usan internet, igual en todos los territorios. {anio}.',
  'datos-globales.personas.panel.cualquier': 'Para cualquier uso',
  'datos-globales.personas.panel.trabajo': 'Para su trabajo',
  'datos-globales.personas.fuente':
    'Idescat, a partir de la encuesta TIC-H del INE (Cataluña, ticll25); Eurostat, isoc_ai_iaiu (países y UE-27)',
  'datos-globales.personas.nota':
    'IA generativa: asistentes que escriben textos, responden preguntas o crean imágenes a partir de lo que se les pide.',
  'datos-globales.personas.lectura.espana':
    'La usan {cataluna} de cada 100 personas que usan internet en Cataluña y {espana} de cada 100 en España (con Cataluña).',
  'datos-globales.personas.lectura.ue':
    'En la media de la UE la usan {ue} de cada 100. Para el trabajo: {cataluna} en Cataluña y {ueTrabajo} en la UE.',
  'datos-globales.personas.lectura.no-sabe.titulo': 'Por qué no la usan',
  'datos-globales.personas.lectura.no-sabe':
    'De cada 100 personas que usan internet en Cataluña y no usan IA generativa, {cifra} dicen que no saben cómo hacerlo. Solo hay dato de Cataluña: no se compara.',
  'datos-globales.personas.ficha.que-mide':
    'Personas de 16 a 74 años que usaron alguna herramienta de IA generativa en los tres meses anteriores a la encuesta, para cualquier fin y para su trabajo.',
  'datos-globales.personas.ficha.unidad':
    'Porcentaje de personas: de cada 100 personas de 16 a 74 años que usaron internet en los tres meses anteriores, cuántas.',
  'datos-globales.personas.ficha.base':
    'La misma encuesta europea armonizada (en Cataluña, la del INE, que forma parte de ella), las mismas edades, la misma base y el mismo año en todos los territorios. Se cuenta sobre quienes usan internet porque así publica el Idescat la cifra de Cataluña. En la página «Unión Europea» la base es toda la población de 16 a 74 años: por eso allí las cifras son algo más bajas.',
  'datos-globales.personas.ficha.no-sabe':
    'De las personas que usaron internet y no usaron IA generativa, las que dan como motivo que no saben cómo usarla. Solo lo publica el Idescat, para Cataluña: no se compara.',
  'datos-globales.personas.ficha.fuente':
    'Cataluña: Idescat, a partir de la encuesta TIC-H del INE (tablas 3.4.1 y 3.4.2 de ticll25). Resto: Eurostat, isoc_ai_iaiu (indicadores I_IUAI e I_IUAIWP, unidad PC_IND_IU3). Es la misma encuesta europea.',

  // ---------- 03 · Mujeres y hombres ----------
  'datos-globales.genero.tema': 'Mujeres y hombres',
  'datos-globales.genero.pregunta': '¿Hay diferencias entre mujeres y hombres?',
  'datos-globales.genero.titular.hombres':
    'Sí: en Cataluña la usan {hombres} de cada 100 hombres y {mujeres} de cada 100 mujeres',
  'datos-globales.genero.titular.mujeres':
    'Sí: en Cataluña la usan {mujeres} de cada 100 mujeres y {hombres} de cada 100 hombres',
  'datos-globales.genero.titular.parecido':
    'En Cataluña, mujeres y hombres la usan de forma parecida: {mujeres} y {hombres} de cada 100',
  'datos-globales.genero.titular.neutro': 'Mujeres y hombres ante la IA generativa',
  'datos-globales.genero.entradilla.todos':
    'Los hombres usan más la IA generativa que las mujeres en todos los territorios comparados y en la media de la UE.',
  'datos-globales.genero.entradilla':
    'La diferencia entre mujeres y hombres no va en el mismo sentido en todos los territorios.',
  'datos-globales.genero.entradilla.trabajo': 'Para trabajar, la diferencia en Cataluña es menor.',
  'datos-globales.genero.figura':
    'De cada 100 mujeres y de cada 100 hombres que usan internet, cuántos usaron IA generativa',
  'datos-globales.genero.figura.sub':
    'Personas de 16 a 74 años que usan internet, en los últimos tres meses. {anio}. A la derecha, la diferencia en puntos: la cifra de los hombres menos la de las mujeres.',
  'datos-globales.genero.interruptor': 'Qué uso enseña el gráfico',
  'datos-globales.genero.nota':
    'Círculo: mujeres. Cuadrado: hombres. La línea entre los dos es la diferencia. Los dos usos tienen la misma escala.',
  'datos-globales.genero.alternativa': '{territorio}: mujeres, {a}; hombres, {b}; diferencia, {puntos} puntos.',
  'datos-globales.genero.lectura.cataluna.titulo': '{puntos} puntos de diferencia en Cataluña',
  'datos-globales.genero.lectura.cataluna':
    'La usan {hombres} de cada 100 hombres y {mujeres} de cada 100 mujeres que usan internet.',
  'datos-globales.genero.lectura.mayor': 'Es la diferencia más grande de los cinco territorios, por un punto o más.',
  'datos-globales.genero.lectura.trabajo.menor': 'Para trabajar, la diferencia es menor',
  'datos-globales.genero.lectura.trabajo.titulo': 'Para trabajar',
  'datos-globales.genero.lectura.trabajo':
    'La usan para su trabajo {hombres} de cada 100 hombres y {mujeres} de cada 100 mujeres: {puntos} puntos de diferencia.',
  'datos-globales.genero.lectura.ue.titulo': '{puntos} puntos en la media de la UE',
  'datos-globales.genero.lectura.ue':
    'La usan {hombres} de cada 100 hombres y {mujeres} de cada 100 mujeres que usan internet.',
  'datos-globales.genero.ficha.que-mide':
    'Mujeres y hombres de 16 a 74 años que usaron alguna herramienta de IA generativa en los tres meses anteriores: para cualquier fin y para su trabajo.',
  'datos-globales.genero.ficha.diferencia':
    'Puntos: la cifra de los hombres menos la de las mujeres, las dos de cada 100, calculada con las cifras sin redondear. No es un porcentaje de personas.',
  'datos-globales.genero.ficha.base':
    'Personas que usaron internet en los tres meses anteriores, con las mismas edades y el mismo año en todos los territorios.',
  'datos-globales.genero.ficha.fuente':
    'Idescat, ticll25 (Cataluña); Eurostat, isoc_ai_iaiu, grupos F_Y16_74 y M_Y16_74, unidad PC_IND_IU3 (resto).',

  // ---------- 04 · Tipo de trabajo ----------
  'datos-globales.ocupacion.tema': 'Tipo de trabajo',
  'datos-globales.ocupacion.pregunta': '¿Cambia según el tipo de trabajo?',
  'datos-globales.ocupacion.titular.mucho-mas':
    'Sí: en Cataluña, {noManual} de cada 100 en trabajos no manuales y {manual} de cada 100 en manuales',
  'datos-globales.ocupacion.titular.mas':
    'Sí: en Cataluña, {noManual} de cada 100 en trabajos no manuales y {manual} de cada 100 en manuales',
  'datos-globales.ocupacion.titular.menos':
    'Sí: en Cataluña, {manual} de cada 100 en trabajos manuales y {noManual} de cada 100 en no manuales',
  'datos-globales.ocupacion.titular.parecido':
    'En Cataluña, la usan para trabajar de forma parecida en los trabajos manuales y en los no manuales',
  'datos-globales.ocupacion.titular.neutro': 'La IA generativa en el trabajo, según la ocupación',
  'datos-globales.ocupacion.entradilla.todos':
    'Para su trabajo, quienes tienen un trabajo no manual usan la IA generativa al menos el doble que quienes tienen uno manual, en todos los territorios con dato y en la media de la UE.',
  'datos-globales.ocupacion.entradilla':
    'Para su trabajo, quienes tienen un trabajo no manual y quienes tienen uno manual no usan igual la IA generativa.',
  'datos-globales.ocupacion.grupos.breve':
    'Manual: agricultura, oficios, operadores de máquinas, conducción y limpieza. No manual: dirección, profesiones, técnicos, oficinas, comercio, hostelería y cuidados.',
  'datos-globales.ocupacion.figura':
    'De cada 100 personas de cada tipo de trabajo, cuántas usaron IA generativa para su trabajo',
  'datos-globales.ocupacion.figura.sub':
    'Personas de 16 a 74 años que trabajan y usan internet, en los últimos tres meses. {anio}. A la derecha, cuántas veces más la usan en los trabajos no manuales.',
  'datos-globales.ocupacion.manual': 'Trabajo manual',
  'datos-globales.ocupacion.no-manual': 'Trabajo no manual',
  'datos-globales.ocupacion.cabecera': 'Veces',
  'datos-globales.ocupacion.nota':
    'Círculo: trabajo manual. Cuadrado: trabajo no manual. Veces: la cifra del trabajo no manual dividida entre la del manual.',
  'datos-globales.ocupacion.francia': 'Francia no publica este dato en {anio} (sí hasta {anterior}).',
  'datos-globales.ocupacion.alternativa': '{territorio}: trabajo manual, {a}; trabajo no manual, {b}; {veces} veces.',
  'datos-globales.ocupacion.lectura.cataluna.mucho-mas': 'Mucho más en los trabajos no manuales',
  'datos-globales.ocupacion.lectura.cataluna.mas': 'Más en los trabajos no manuales',
  'datos-globales.ocupacion.lectura.cataluna.parecido': 'Parecido en los dos tipos de trabajo',
  'datos-globales.ocupacion.lectura.cataluna.menos': 'Más en los trabajos manuales',
  'datos-globales.ocupacion.lectura.cataluna':
    'En Cataluña la usan para su trabajo {noManual} de cada 100 personas con un trabajo no manual y {manual} de cada 100 con uno manual: la cifra del no manual es {veces} veces la del manual.',
  'datos-globales.ocupacion.tic': 'Profesionales de la informática',
  'datos-globales.ocupacion.lectura.tic':
    'En España (con Cataluña), la usan para su trabajo {cifra} de cada 100 profesionales de la informática y las telecomunicaciones.',
  'datos-globales.ocupacion.lectura.ue':
    'La usan para su trabajo {noManual} de cada 100 personas con un trabajo no manual y {manual} de cada 100 con uno manual.',
  'datos-globales.ocupacion.ficha.que-mide':
    'Personas que usaron IA generativa para su trabajo en los tres meses anteriores, según su ocupación.',
  'datos-globales.ocupacion.ficha.grupos':
    'No manuales: grandes grupos 0 a 5 (dirección, profesionales, técnicos, administrativos, servicios y ventas). Manuales: grandes grupos 6 a 9 (agricultura, oficios, operadores de máquinas y ocupaciones elementales). Es la misma división en Eurostat (CIUO-08) y en el Idescat (CNO, que tiene los mismos grandes grupos).',
  'datos-globales.ocupacion.ficha.veces':
    'La cifra del trabajo no manual dividida entre la del manual, con las cifras sin redondear. En Cataluña: {noManual} ÷ {manual} = {veces}.',
  'datos-globales.ocupacion.ficha.base':
    'Personas que usaron internet en los tres meses anteriores, con los mismos grandes grupos de ocupación, las mismas edades y el mismo año en todos los territorios.',
  'datos-globales.ocupacion.ficha.francia':
    'En {anio} es el único país de la UE que no publica el corte manual / no manual en ninguna tabla de esta encuesta, ni en Eurostat ni en el INSEE (sí lo publicó hasta {anterior}). Sus cifras por categoría socioprofesional no equivalen a este corte.',
  'datos-globales.ocupacion.ficha.fuente':
    'Cataluña: Idescat, ticll25, tabla 3.4.1 (definiciones en su metodología). Resto: Eurostat, isoc_ai_iaiu, indicador I_IUAIWP (grupos ISCO0_5 e ISCO6_9), unidad PC_IND_IU3.',

  // ---------- 05 · Formación ----------
  'datos-globales.formacion.tema': 'Formación',
  'datos-globales.formacion.pregunta': '¿Cuánta gente adulta se está formando?',
  'datos-globales.formacion.titular.primera':
    'De los cinco territorios, Cataluña es donde más adultos se forman: {cifra} de cada 100',
  'datos-globales.formacion.titular.cifra':
    '{cifra} de cada 100 adultos de Cataluña hicieron algún curso en el último mes',
  'datos-globales.formacion.titular.neutro': 'La formación de los adultos, en Cataluña y en Europa',
  'datos-globales.formacion.entradilla':
    'En {anio}, de cada 100 personas de 25 a 64 años, se formaron {cataluna} en Cataluña, {espana} en España (con Cataluña) y {ue} en la media de la UE.',
  'datos-globales.formacion.cualquiera': 'Cuenta cualquier formación, no solo sobre IA.',
  'datos-globales.formacion.figura':
    'De cada 100 personas de 25 a 64 años, cuántas hicieron algún curso o formación en las cuatro semanas anteriores',
  'datos-globales.formacion.figura.sub':
    'Cualquier formación, reglada o no, igual en todos los territorios. {desde}–{hasta}.',
  'datos-globales.formacion.fuente': 'Eurostat, encuesta de población activa (trng_lfse_04; Cataluña: región ES51)',
  'datos-globales.formacion.anual.leyenda': 'Adultos que se formaron, de cada 100, por año y por territorio',
  'datos-globales.formacion.anual.sub':
    'De cada 100 personas de 25 a 64 años, cuántas se formaron en el último mes. La barra de cada celda va de 0 a {maximo}.',
  'datos-globales.formacion.lectura.espana':
    'Se formaron {cataluna} de cada 100 adultos en Cataluña y {espana} en España (con Cataluña).',
  'datos-globales.formacion.lectura.ue': 'En la media de la UE, {ue} de cada 100.',
  'datos-globales.formacion.lectura.evolucion':
    'En {desde} se formaban {inicio} de cada 100 adultos de Cataluña; en {hasta}, {fin}.',
  'datos-globales.formacion.ficha.que-mide':
    'Personas de 25 a 64 años que hicieron alguna actividad de educación o formación, reglada o no, en las cuatro semanas anteriores a la encuesta.',
  'datos-globales.formacion.ficha.unidad': 'Porcentaje de personas: de cada 100 personas de 25 a 64 años, cuántas.',
  'datos-globales.formacion.ficha.base':
    'La misma encuesta europea (la encuesta de población activa), la misma pregunta, las mismas edades y el mismo año en todos los territorios.',
  'datos-globales.formacion.ficha.fuente':
    'Eurostat, encuesta de población activa: trng_lfse_04 (países, UE-27 y región ES51), unidad PC.',

  // ---------- 06 · Opinión ----------
  'datos-globales.opinion.tema': 'Opinión',
  'datos-globales.opinion.pregunta': '¿Qué opina la gente de la IA en el trabajo?',
  'datos-globales.opinion.titular.hallazgo':
    'La mayoría ve bien la IA en el trabajo y, a la vez, cree que se perderán más empleos de los que se crearán',
  'datos-globales.opinion.titular.neutro': 'Qué opina la gente de los robots y la IA en el trabajo',
  'datos-globales.opinion.entradilla':
    'Lo que opina la gente de España, Alemania, Francia e Italia, según una encuesta de la Comisión Europea de {anio}. Es opinión, no una medida: dice lo que la gente cree, no lo que pasa en su empleo.',
  'datos-globales.opinion.figura': 'De cada 100 personas de 15 años o más, cuántas están de acuerdo con cada frase',
  'datos-globales.opinion.figura.sub':
    'Eurobarómetro especial 554, abril y mayo de {anio}. Cifras enteras, como las publica.',
  'datos-globales.opinion.panel.positiva': 'Ven bien el uso de robots e IA en el trabajo',
  'datos-globales.opinion.panel.destruira': 'Creen que desaparecerán más empleos de los que se crearán',
  'datos-globales.opinion.fuente': 'Comisión Europea, Eurobarómetro especial 554 (preguntas QB5 y QB6.1)',
  'datos-globales.opinion.sin-pregunta': 'El Eurobarómetro no da cifra de Cataluña.',
  'datos-globales.opinion.nota.ceo':
    'Cataluña: otra encuesta (la del CEO) hace otra pregunta, con otra escala. {cifra} de cada 100 personas creen probable (7 o más sobre 10) que las máquinas, los programas o la IA superen o sustituyan a las personas en la mayoría de los trabajos. Por eso no se pone al lado de los países.',
  'datos-globales.opinion.lectura.positiva.mayoria': 'La mayoría lo ve bien',
  'datos-globales.opinion.lectura.positiva.dividida': 'Opiniones divididas',
  'datos-globales.opinion.lectura.positiva':
    'Lo ven bien entre {minimo} y {maximo} de cada 100 personas, según el país; en la media de la UE, {ue}.',
  'datos-globales.opinion.lectura.positiva.sin-ue':
    'Lo ven bien entre {minimo} y {maximo} de cada 100 personas, según el país.',
  'datos-globales.opinion.lectura.destruira.mayoria': 'Y la mayoría teme por el empleo',
  'datos-globales.opinion.lectura.destruira.dividida': 'Opiniones divididas sobre el empleo',
  'datos-globales.opinion.lectura.destruira':
    'Creen que se perderán más empleos de los que se crearán entre {minimo} y {maximo} de cada 100 personas, según el país; en la media de la UE, {ue}.',
  'datos-globales.opinion.lectura.destruira.sin-ue':
    'Creen que se perderán más empleos de los que se crearán entre {minimo} y {maximo} de cada 100 personas, según el país.',
  'datos-globales.opinion.ficha.preguntas':
    'QB5: «¿Hasta qué punto ve de forma positiva o negativa el uso de robots e inteligencia artificial en el lugar de trabajo?» Suma de «muy» y «bastante positiva». QB6.1: «Por el uso de robots e inteligencia artificial, desaparecerán más empleos de los que se crearán.» Suma de «totalmente» y «más bien de acuerdo».',
  'datos-globales.opinion.ficha.encuesta':
    'Comisión Europea, Eurobarómetro especial 554, «Artificial Intelligence and the future of work» (oleada 101.4). Entrevistas a personas de 15 años o más (trabajo de campo: 25/04–22/05/2024): 1.000 en España, 1.603 en Alemania, 1.002 en Francia y 1.037 en Italia. Publicado en 2025.',
  'datos-globales.opinion.ficha.cifras':
    'El Eurobarómetro publica porcentajes enteros (volumen A, tablas QB5 y QB6.1, columna de cada país y de la UE-27); se muestran sin decimales.',
  'datos-globales.opinion.ficha.cataluna':
    '{fuente}, pregunta P26, escala de 0 («gens probable») a 10 («totalment probable»). Responden de 7 a 10 el {cifra} de las respuestas ponderadas en línea.',
  'datos-globales.opinion.ficha.margen':
    'Unas 1.000 entrevistas por país: diferencias de dos o tres puntos pueden no ser reales.',

  // ---------- 07 · Dentro de las empresas catalanas ----------
  'datos-globales.dentro.tema': 'Solo Cataluña',
  'datos-globales.dentro.pregunta': '¿En qué puestos se usa la IA dentro de las empresas catalanas?',
  'datos-globales.dentro.titular.cualificado':
    'Se usa más entre el personal cualificado: en {cifra} de cada 100 establecimientos',
  'datos-globales.dentro.titular.poco': 'Se usa más entre el personal poco cualificado',
  'datos-globales.dentro.titular.parecido':
    'En los establecimientos catalanes, la IA se usa de forma parecida en los distintos puestos',
  'datos-globales.dentro.titular.neutro': 'Quién usa la IA en los establecimientos catalanes',
  'datos-globales.dentro.entradilla':
    'Una encuesta del Idescat a los establecimientos de Cataluña (cada centro de trabajo de una empresa), del 2.º trimestre de {anio}. Es otra encuesta, a establecimientos y no a empresas: por eso no se compara con Europa.',
  'datos-globales.dentro.figura':
    'De cada 100 establecimientos, en cuántos usa la IA cada grupo de personas trabajadoras',
  'datos-globales.dentro.figura.sub':
    'Establecimientos de Cataluña. 2.º trimestre de {anio}. Solo hay dato de Cataluña.',
  'datos-globales.dentro.fuente': 'Idescat, Indicadores de clima empresarial, módulo «Inteligencia artificial»',
  'datos-globales.dentro.cualificado': 'Personal cualificado',
  'datos-globales.dentro.directivos': 'Dirección',
  'datos-globales.dentro.poco-cualificado': 'Personal poco cualificado',
  'datos-globales.dentro.lectura.puestos.mas': 'Más entre el personal cualificado',
  'datos-globales.dentro.lectura.puestos.parecido': 'Parecido en los distintos puestos',
  'datos-globales.dentro.lectura.puestos.menos': 'Más entre el personal poco cualificado',
  'datos-globales.dentro.lectura.puestos':
    'En {cualificado} de cada 100 establecimientos la usa el personal cualificado; en {poco}, el poco cualificado.',
  'datos-globales.dentro.lectura.direccion.titulo': 'La dirección',
  'datos-globales.dentro.lectura.direccion': 'En {cifra} de cada 100 establecimientos la usa la dirección.',
  'datos-globales.dentro.contratar': 'Al contratar',
  'datos-globales.dentro.lectura.contratar':
    '{cifra} de cada 100 establecimientos dan mucha importancia a las competencias digitales, IA incluida, cuando contratan (a finales de {anio}).',
  'datos-globales.dentro.nota':
    'Es otra encuesta, a establecimientos y no a empresas: por eso no se compara con Europa.',
  'datos-globales.dentro.ficha.que-mide':
    'Establecimientos de Cataluña en los que cada grupo de personas trabajadoras usa alguna herramienta de IA.',
  'datos-globales.dentro.ficha.unidad': 'Porcentaje de establecimientos: de cada 100, en cuántos.',
  'datos-globales.dentro.ficha.anio':
    '2.º trimestre de {anio} (pregunta de una sola vez); competencias al contratar, 4.º trimestre de {competencias}.',
  'datos-globales.dentro.ficha.fuente':
    'Idescat, Indicadores de clima empresarial, módulos «Inteligencia artificial» (tabla 18162) y «Necesidades formativas y ocupacionales».',

  // ---------- 08 · Cuadro ----------
  'datos-globales.cuadro.tema': 'Cuadro resumen',
  'datos-globales.cuadro.pregunta': 'Todas las cifras en una tabla',
  'datos-globales.cuadro.titular': 'Las cifras de este dossier, territorio a territorio',
  'datos-globales.cuadro.texto':
    'De cada 100 de cada grupo, cuántos. España incluye a Cataluña, y la media de la UE incluye a España: van como referencia.',
  'datos-globales.cuadro.leyenda': 'Indicadores principales: de cada 100, cuántos',
  'datos-globales.cuadro.territorio': 'Territorio',
  'datos-globales.cuadro.empresas': 'Empresas que usan IA',
  'datos-globales.cuadro.empresas.detalle': 'con 10 o más personas · {anio}',
  'datos-globales.cuadro.personas': 'Personas que usan IA generativa',
  'datos-globales.cuadro.personas.detalle': '16–74 años que usan internet · {anio}',
  'datos-globales.cuadro.trabajo': '… para su trabajo',
  'datos-globales.cuadro.trabajo.detalle': '16–74 años que usan internet · {anio}',
  'datos-globales.cuadro.formacion': 'Adultos que se formaron',
  'datos-globales.cuadro.formacion.detalle': '25–64 años · último mes · {anio}',
  'datos-globales.cuadro.sin-cifra': '¹ Sin cifra oficial comparable publicada: no la estimamos.',
  'datos-globales.cuadro.nota':
    'Fuentes: Eurostat (isoc_eb_ai, isoc_r_eb_ain2, isoc_ai_iaiu y trng_lfse_04) e Idescat (ticll25, para las personas de Cataluña). Fecha de consulta: {fecha}.',

  // ---------- Método ----------
  'datos-globales.metodo.titulo': 'Cómo comparamos',
  'datos-globales.metodo.misma.titulo': 'Lo mismo con lo mismo.',
  'datos-globales.metodo.misma.texto':
    'Misma pregunta, mismas edades, misma base y mismo año en cada comparación. Lo que no se mide igual no se compara, y se dice. Por eso no está Estados Unidos.',
  'datos-globales.metodo.comparable.titulo': 'Solo lo comparable.',
  'datos-globales.metodo.comparable.texto':
    'Una cifra que la fuente marca como no comparable (otra definición o una ruptura de serie) no se muestra ni entra en ningún cálculo. Por eso la serie de empresas no incluye 2021: entonces se preguntaba por menos tecnologías. Cada ficha técnica dice qué se queda fuera.',
  'datos-globales.metodo.orden.titulo': 'De mayor a menor.',
  'datos-globales.metodo.orden.texto':
    'En cada gráfico, los territorios van de la cifra más alta a la más baja. En las tablas, siempre en el mismo orden: Cataluña, España (con Cataluña), Alemania, Francia e Italia, y la media de la UE al final.',
  'datos-globales.metodo.ue.titulo': 'La media de la UE, como referencia.',
  'datos-globales.metodo.ue.texto':
    'Es la cifra de los 27 países juntos e incluye a España, Alemania, Francia e Italia. Por eso va en naranja y discontinua, nunca como un país más. Sus propios capítulos están en la página «Unión Europea».',
  'datos-globales.metodo.base.titulo': 'Personas: cada página, su base.',
  'datos-globales.metodo.base.texto':
    'Aquí, las cifras de personas se cuentan sobre quienes usan internet; en la página «Unión Europea», sobre toda la población de 16 a 74 años. Cada gráfico lo dice en su subtítulo.',
  'datos-globales.metodo.margen.titulo': 'Un punto, como mínimo.',
  'datos-globales.metodo.margen.texto':
    'La muestra de Cataluña es más pequeña que la de un país. No decimos que un territorio va por delante si no le saca al menos un punto al siguiente.',
  'datos-globales.metodo.sin-cifra.titulo': 'Sin dato oficial, no hay cifra.',
  'datos-globales.metodo.sin-cifra.texto': 'Lo decimos; no lo estimamos.',
  'datos-globales.metodo.medido.titulo': '{0} Medido',
  'datos-globales.metodo.medido.texto': 'quiere decir que sale de una encuesta oficial.',
  'datos-globales.metodo.medido.todas':
    'Todas las cifras de este dossier son medidas, salvo las de los capítulos de opinión, marcadas «{0} Encuesta de opinión»: dicen lo que la gente cree, no lo que pasa. La de especialistas en TIC de la UE sale de la encuesta de población activa y Eurostat la marca como estimada («e»); lo dice su ficha.',
  'datos-globales.metodo.no-dicen.titulo': 'Lo que estos datos no dicen',
  'datos-globales.metodo.no-dicen.texto':
    'Describen territorios. No dicen nada de una persona concreta, ni de su empleo, ni de lo que le va a pasar. Usar la IA, o estar expuesto a ella, no equivale a perder el trabajo.',

  // ---------- Página «Unión Europea» ----------
  'datos-globales.ue.antetitulo': 'Datos globales · Unión Europea',
  'datos-globales.ue.titulo': 'La Unión Europea',
  'datos-globales.ue.entradilla':
    'Las mismas preguntas para el conjunto de la UE: cuántas empresas usan IA, cuánta gente usa IA generativa y cuánto falta para las metas digitales que la UE se fijó para 2030.',
  'datos-globales.ue.prudencia.titulo': 'Es una media de 27 países.',
  'datos-globales.ue.prudencia.texto':
    'Incluye a España, Alemania, Francia e Italia, y por eso aquí no se compara con ellos. Son datos de territorios, no de personas: no dicen nada del empleo de quien lee.',
  'datos-globales.ue.clave-colores.nombre': 'Cómo se leen los gráficos de esta página',
  'datos-globales.ue.clave-colores.ue': 'La UE-27, protagonista de esta página',
  'datos-globales.ue.clave-colores.grupos': 'Grupos dentro de la UE: tamaño, edad, ocupación…',
  'datos-globales.ue.clave-colores.meta': 'Meta para 2030',
  'datos-globales.ue.esencial.nota':
    'Cifras del conjunto de los 27 países. Las de personas se cuentan sobre toda la población de 16 a 74 años, y no sobre quienes usan internet como en «Cataluña»: por eso no se cruzan.',
  'datos-globales.ue.margen':
    'La muestra de toda la UE es muy grande: el margen de error es pequeño, pero diferencias de unas décimas pueden no ser reales.',
  'datos-globales.ue.no-comparable': '{anio}',
  'datos-globales.ue.esencial.empresas':
    'Es decir, {cifra} de cada 100 empresas de la UE con 10 o más personas usan alguna tecnología de IA.',
  'datos-globales.ue.esencial.empresas.comparacion': 'De cada 100 empresas, cuántas la usaban cada año:',
  'datos-globales.ue.esencial.empresas.pie':
    'Desde {desde}: antes se preguntaba por menos tecnologías. Fuente: Eurostat',
  'datos-globales.ue.esencial.personas':
    'Es decir, {cifra} de cada 100 personas de 16 a 74 años usaron IA generativa en los últimos tres meses.',
  'datos-globales.ue.esencial.personas.comparacion': 'De cada 100 personas de cada edad:',
  'datos-globales.ue.esencial.personas.pie': 'Sobre toda la población, use o no internet. Fuente: Eurostat',
  'datos-globales.ue.esencial.capacidades.tema': 'Capacidades · {anio}',
  'datos-globales.ue.esencial.capacidades':
    'Es decir, {cifra} de cada 100 personas de 16 a 74 años saben al menos lo básico de lo digital. La meta para {anio} es {meta} de cada 100.',
  'datos-globales.ue.esencial.capacidades.comparacion': 'De cada 100 personas, cada año:',
  'datos-globales.ue.esencial.especialistas.tema': 'Especialistas TIC · {anio}',
  'datos-globales.ue.esencial.millones': 'millones',
  'datos-globales.ue.esencial.especialistas':
    'de especialistas en tecnologías de la información (TIC) trabajan en la UE. La meta para {anio} es de {meta} millones.',
  'datos-globales.ue.esencial.especialistas.comparacion': 'Millones de especialistas, hoy y la meta:',
  'datos-globales.ue.esencial.meta': 'Meta {anio}',
  'datos-globales.ue.esencial.especialistas.pie': 'Estimación de Eurostat. De cada 100, {mujeres} son mujeres.',
  'datos-globales.numero.0': 'cero',
  'datos-globales.numero.1': 'un',
  'datos-globales.numero.2': 'dos',
  'datos-globales.numero.3': 'tres',
  'datos-globales.numero.4': 'cuatro',
  'datos-globales.numero.5': 'cinco',
  'datos-globales.numero.6': 'seis',
  'datos-globales.numero.7': 'siete',
  'datos-globales.numero.8': 'ocho',
  'datos-globales.numero.9': 'nueve',
  'datos-globales.numero.10': 'diez',

  // 01 · Empresas (UE)
  'datos-globales.ue.empresas.pregunta': '¿Cuántas empresas de la UE usan IA?',
  'datos-globales.ue.empresas.titular.quinto-doble':
    '1 de cada 5 empresas de la UE ya usan IA: más del doble que en {desde}',
  'datos-globales.ue.empresas.titular.quinto': '1 de cada 5 empresas de la UE ya usan IA',
  'datos-globales.ue.empresas.titular.cifra-doble':
    '{cifra} de cada 100 empresas de la UE usan IA: más del doble que en {desde}',
  'datos-globales.ue.empresas.titular.cifra': '{cifra} de cada 100 empresas de la UE usan IA',
  'datos-globales.ue.empresas.entradilla':
    'En {desde} usaban IA {inicio} de cada 100 empresas de la UE con 10 o más personas; en {hasta}, {fin}.',
  'datos-globales.ue.empresas.figura.evolucion':
    'De cada 100 empresas de la UE, cuántas usan al menos una tecnología de IA',
  'datos-globales.ue.empresas.figura.evolucion.sub':
    'Empresas con 10 o más personas (sin agricultura, minería ni sector financiero). UE-27, {desde}–{hasta}.',
  'datos-globales.ue.empresas.fuente': 'Eurostat (isoc_eb_ai)',
  'datos-globales.ue.empresas.figura.tamano': 'Según el tamaño de la empresa',
  'datos-globales.ue.empresas.figura.tamano.sub':
    'De cada 100 empresas de cada tamaño, cuántas usan IA. UE-27, {anio}.',
  'datos-globales.ue.empresas.lectura.evolucion':
    'En {desde} usaban IA {inicio} de cada 100 empresas de la UE; en {hasta}, {fin}.',
  'datos-globales.ue.empresas.lectura.tamano.mucho': 'Las grandes, mucho más',
  'datos-globales.ue.empresas.lectura.tamano.mas': 'Las grandes, más',
  'datos-globales.ue.empresas.lectura.tamano':
    'La usan {grandes} de cada 100 empresas de 250 personas o más y {pequenas} de cada 100 de las de 10 a 49.',
  'datos-globales.ue.empresas.lectura.medianas.titulo': 'Las medianas',
  'datos-globales.ue.empresas.lectura.medianas': 'Entre las de 50 a 249 personas, la usan {cifra} de cada 100.',
  'datos-globales.ue.empresas.ficha.anios':
    'De {desde} a {hasta}. En 2022 la encuesta no preguntó por la IA, y la cifra de 2021 se midió con menos tecnologías.',

  // 02 · Tecnologías (UE)
  'datos-globales.ue.tecnologias.pregunta': '¿Qué tipo de IA usan las empresas?',
  'datos-globales.ue.tecnologias.titular.primera':
    'La IA que más usan las empresas de la UE es la que sirve para {tecnologia}: {cifra} de cada 100',
  'datos-globales.ue.tecnologias.entradilla':
    'Para qué tipo de tarea usan IA las empresas de la UE y en qué parte de su trabajo. Una empresa puede usar varios tipos: por eso las cifras no suman el total.',
  'datos-globales.ue.tecnologias.figura': 'De cada 100 empresas de la UE, cuántas usan cada tipo de IA, y dónde',
  'datos-globales.ue.tecnologias.figura.sub': 'Empresas con 10 o más personas. UE-27, {anio}.',
  'datos-globales.ue.tecnologias.panel.tipos': 'Para qué tipo de tarea',
  'datos-globales.ue.tecnologias.panel.usos': 'En qué parte de la empresa',
  'datos-globales.ue.tecnologias.texto.frase': 'analizar textos',
  'datos-globales.ue.tecnologias.imagen-video-sonido.frase': 'crear imagen o sonido',
  'datos-globales.ue.tecnologias.lenguaje.frase': 'redactar o programar',
  'datos-globales.ue.tecnologias.voz.frase': 'entender la voz',
  'datos-globales.ue.tecnologias.automatizacion.frase': 'automatizar tareas',
  'datos-globales.ue.tecnologias.aprendizaje-automatico.frase': 'aprender de datos',
  'datos-globales.ue.tecnologias.reconocimiento-imagenes.frase': 'reconocer imágenes',
  'datos-globales.ue.tecnologias.robots.frase': 'mover robots autónomos',
  'datos-globales.ue.tecnologias.lectura.primera.titulo': '{tecnologia}, la primera',
  'datos-globales.ue.tecnologias.lectura.primera': 'La usan {cifra} de cada 100 empresas de la UE.',
  'datos-globales.ue.tecnologias.lectura.sectores':
    'Usan IA {j} de cada 100 empresas de información y comunicación y {f} de cada 100 de la construcción.',
  'datos-globales.ue.tecnologias.lectura.frena':
    '{cifra} de cada 100 empresas pensaron en usar IA y no la usan por falta de conocimientos: es el motivo que más se repite.',

  // 03 · Personas (UE)
  'datos-globales.ue.personas.pregunta': '¿Cuánta gente usa la IA generativa?',
  'datos-globales.ue.personas.titular.tercio': 'Casi 1 de cada 3 personas de la UE usaron IA generativa',
  'datos-globales.ue.personas.titular.cifra': '{cifra} de cada 100 personas de la UE usaron IA generativa',
  'datos-globales.ue.personas.entradilla':
    'En {anio}, la usaron {cifra} de cada 100 personas de 16 a 74 años de la UE, usen o no internet.',
  'datos-globales.ue.personas.figura':
    'De cada 100 personas de la UE, cuántas usaron IA generativa en los últimos tres meses',
  'datos-globales.ue.personas.figura.sub': 'Toda la población de 16 a 74 años, use o no internet. UE-27, {anio}.',
  'datos-globales.ue.personas.panel.para-que': 'Para qué la usaron',
  'datos-globales.ue.personas.panel.edad': 'Por edad',
  'datos-globales.ue.personas.fuente': 'Eurostat (isoc_ai_iaiu)',
  'datos-globales.ue.personas.lectura.edades.mucho': 'Los jóvenes, mucho más',
  'datos-globales.ue.personas.lectura.edades.titulo': 'Jóvenes y mayores',
  'datos-globales.ue.personas.lectura.edades':
    'La usaron {jovenes} de cada 100 jóvenes de 16 a 24 años y {mayores} de cada 100 personas de 65 a 74.',
  'datos-globales.ue.personas.lectura.por-que':
    'De cada 100 personas que no la usaron, {necesita} dicen que no la necesitan y {sabe}, que no saben cómo usarla.',
  'datos-globales.ue.personas.lectura.base.titulo': 'Otra base que en Cataluña',
  'datos-globales.ue.personas.lectura.base':
    'Aquí se cuenta a toda la población de 16 a 74 años. Contando solo a quienes usan internet, como en «Cataluña», la usaron {internet} de cada 100.',

  // 04 · Mujeres y hombres (UE)
  'datos-globales.ue.genero.pregunta': '¿Hay diferencias entre mujeres y hombres?',
  'datos-globales.ue.genero.titular.hombres':
    'Sí: en la UE la usan {hombres} de cada 100 hombres y {mujeres} de cada 100 mujeres',
  'datos-globales.ue.genero.titular.mujeres':
    'Sí: en la UE la usan {mujeres} de cada 100 mujeres y {hombres} de cada 100 hombres',
  'datos-globales.ue.genero.titular.parecido':
    'En la UE, mujeres y hombres la usan de forma parecida: {mujeres} y {hombres} de cada 100',
  'datos-globales.ue.genero.entradilla.todos':
    'Los hombres la usan más que las mujeres para todos los fines que pregunta la encuesta.',
  'datos-globales.ue.genero.entradilla.mixta':
    'La diferencia no es igual en todos los usos: en alguno, mujeres y hombres la usan de forma parecida.',
  'datos-globales.ue.genero.figura':
    'De cada 100 mujeres y de cada 100 hombres de la UE, cuántos usaron IA generativa, según para qué',
  'datos-globales.ue.genero.figura.sub':
    'Toda la población de 16 a 74 años. UE-27, {anio}. A la derecha, la diferencia en puntos: la cifra de los hombres menos la de las mujeres.',
  'datos-globales.ue.genero.nota': 'Círculo: mujeres. Cuadrado: hombres. La línea entre los dos es la diferencia.',
  'datos-globales.ue.genero.lectura.cualquier.titulo': '{puntos} puntos de diferencia',
  'datos-globales.ue.genero.lectura.cualquier':
    'Usaron IA generativa {hombres} de cada 100 hombres y {mujeres} de cada 100 mujeres de 16 a 74 años.',
  'datos-globales.ue.genero.lectura.estudios.mas': 'Para estudiar, más los hombres',
  'datos-globales.ue.genero.lectura.estudios.parecido': 'Para estudiar, igual',
  'datos-globales.ue.genero.lectura.estudios.menos': 'Para estudiar, más las mujeres',
  'datos-globales.ue.genero.lectura.estudios':
    'La usaron para sus estudios {mujeres} de cada 100 mujeres y {hombres} de cada 100 hombres.',
  'datos-globales.ue.genero.lectura.capacidades':
    'Tienen al menos capacidades digitales básicas {mujeres} de cada 100 mujeres y {hombres} de cada 100 hombres.',

  // 05 · Trabajo (UE)
  'datos-globales.ue.trabajo.pregunta': '¿Cuánta gente la usa para trabajar?',
  'datos-globales.ue.trabajo.titular.cifra':
    'La usan para su trabajo {cifra} de cada 100 personas que trabajan en la UE',
  'datos-globales.ue.trabajo.entradilla':
    'Cuánto se usa la IA generativa para trabajar según la ocupación y los estudios. UE-27, {anio}.',
  'datos-globales.ue.trabajo.figura':
    'De cada 100 personas de cada grupo, cuántas usaron IA generativa para su trabajo',
  'datos-globales.ue.trabajo.figura.sub': 'UE-27, {anio}. Cada panel dice su base.',
  'datos-globales.ue.trabajo.panel.ocupacion': 'Según la ocupación (de cada 100 personas que trabajan)',
  'datos-globales.ue.trabajo.panel.estudios': 'Según los estudios (de cada 100 personas de 16 a 74 años)',
  'datos-globales.ue.trabajo.lectura.ocupacion':
    'La usan para su trabajo {noManual} de cada 100 personas con un trabajo no manual y {manual} de cada 100 con uno manual.',
  'datos-globales.ue.trabajo.lectura.tic':
    'La usan para su trabajo {cifra} de cada 100 personas que trabajan en informática y telecomunicaciones.',
  'datos-globales.ue.trabajo.lectura.estudios.titulo': 'Según los estudios',
  'datos-globales.ue.trabajo.lectura.estudios':
    'La usan para su trabajo {superiores} de cada 100 personas con estudios superiores y {bajos} de cada 100 con estudios bajos o sin estudios.',

  // 06 · Capacidades (UE)
  'datos-globales.ue.capacidades.pregunta': '¿Cuánta gente sabe manejarse con lo digital?',
  'datos-globales.ue.capacidades.titular.seis':
    '6 de cada 10 personas de la UE tienen al menos capacidades digitales básicas',
  'datos-globales.ue.capacidades.titular.cifra':
    '{cifra} de cada 100 personas de la UE tienen al menos capacidades digitales básicas',
  'datos-globales.ue.capacidades.entradilla':
    'En {desde} las tenían {inicio} de cada 100 personas de 16 a 74 años; en {hasta}, {fin}.',
  'datos-globales.ue.capacidades.entradilla.meta': 'La meta de la UE para {anio} es {meta} de cada 100.',
  'datos-globales.ue.capacidades.figura.evolucion':
    'De cada 100 personas, cuántas tienen al menos capacidades digitales básicas',
  'datos-globales.ue.capacidades.figura.evolucion.sub':
    'Toda la población de 16 a 74 años. Se mide cada dos años. UE-27, {desde}–{hasta}.',
  'datos-globales.ue.capacidades.fuente': 'Eurostat (isoc_sk_dskl_i21)',
  'datos-globales.ue.capacidades.figura': 'Niveles y áreas de las capacidades digitales',
  'datos-globales.ue.capacidades.figura.sub': 'De cada 100 personas de 16 a 74 años. UE-27, {anio}.',
  'datos-globales.ue.capacidades.panel.niveles': 'Nivel de capacidades',
  'datos-globales.ue.capacidades.panel.areas': 'Al menos básicas en cada área',
  'datos-globales.ue.capacidades.lectura.evolucion':
    'En {desde} tenían al menos capacidades básicas {inicio} de cada 100 personas; en {hasta}, {fin}: {puntos} puntos de diferencia (la resta de las dos cifras).',
  'datos-globales.ue.capacidades.lectura.avanzadas':
    'Tienen capacidades por encima de las básicas {cifra} de cada 100 personas; en {desde}, {inicio}.',
  'datos-globales.ue.capacidades.lectura.dificil':
    'Saben al menos lo básico para {area} {cifra} de cada 100 personas: es el área que menos gente domina. Para {otra}, {otraCifra} de cada 100.',

  // 07 · Metas para 2030 (UE)
  'datos-globales.ue.metas.pregunta': '¿Cuánto le falta a la UE para sus metas de 2030?',
  'datos-globales.ue.metas.titular.ninguna':
    'A {faltan} años de {anio}, la UE no ha alcanzado ninguna de sus {numero} metas digitales',
  'datos-globales.ue.metas.entradilla':
    'La más lejana es la de {lejana}: {valorLejana} de {metaLejana}. La más cercana, la de {cercana}: {valorCercana} de {metaCercana}.',
  'datos-globales.ue.metas.corto.meta-capacidades-digitales': 'capacidades digitales',
  'datos-globales.ue.metas.corto.meta-especialistas-tic': 'especialistas en TIC',
  'datos-globales.ue.metas.corto.meta-empresas-nube-datos-ia': 'empresas que usan nube, análisis de datos o IA',
  'datos-globales.ue.metas.corto.meta-pymes-intensidad-digital': 'pymes con intensidad digital básica',
  'datos-globales.ue.metas.figura': 'Último dato de la UE-27 frente a cada meta para {anio}',
  'datos-globales.ue.metas.figura.sub':
    'Cada barra con su escala real: de 0 a 100 %, o en millones de personas en especialistas. La raya vertical es la meta.',
  'datos-globales.ue.metas.fuente.figura':
    'Eurostat (isoc_sk_dskl_i21, isoc_sks_itspt, isoc_eb_ai e isoc_e_dii). Metas: Decisión (UE) 2022/2481, artículo 4',
  'datos-globales.ue.metas.nota': 'Una meta no es una previsión: el gráfico no dice si se alcanzará.',
  'datos-globales.ue.metas.rotulo.valor': '{anio}: {valor}',
  'datos-globales.ue.metas.rotulo.meta': 'Meta {anio}: {meta}',
  'datos-globales.ue.metas.rotulo.meta.mas': 'Meta {anio}: más del {meta}',
  'datos-globales.ue.metas.alcanzada': 'Meta alcanzada',
  'datos-globales.ue.metas.anteriores': 'Rayas finas dentro de la barra: {lista}.',
  'datos-globales.ue.metas.anterior': '{anio}, {valor}',
  'datos-globales.ue.metas.alternativa': '{nombre}: {valor} en {anio}; meta para {anioMeta}, {meta}.',
  'datos-globales.ue.metas.lectura.capacidades-digitales.titulo': 'Faltan {faltan} puntos en capacidades digitales',
  'datos-globales.ue.metas.lectura.capacidades-digitales':
    'Hoy saben al menos lo básico de lo digital {cifra} de cada 100 personas de 16 a 74 años; la meta es {meta} de cada 100. Puntos: la resta entre las dos cifras.',
  'datos-globales.ue.metas.lectura.especialistas-tic.titulo': 'Faltan {faltan} millones de especialistas',
  'datos-globales.ue.metas.lectura.especialistas-tic':
    'Hoy trabajan en la UE {cifra} millones de especialistas en tecnologías de la información; la meta es {meta} millones. De cada 100, {mujeres} son mujeres.',
  'datos-globales.ue.metas.lectura.empresas-nube-datos-ia.titulo': 'Faltan {faltan} puntos en las empresas',
  'datos-globales.ue.metas.lectura.empresas-nube-datos-ia':
    'Hoy usan nube, análisis de datos o IA {cifra} de cada 100 empresas; la meta es {meta} de cada 100.',

  // 08 · Especialistas (UE)
  'datos-globales.ue.especialistas.pregunta': '¿Cuántos especialistas en tecnología trabajan en la UE?',
  'datos-globales.ue.especialistas.titular.cifra': 'En la UE trabajan {cifra} millones de especialistas en TIC',
  'datos-globales.ue.especialistas.titular.cifra-mitad':
    'En la UE trabajan {cifra} millones de especialistas en TIC, y a más de la mitad de las empresas que los buscan les cuesta encontrarlos',
  'datos-globales.ue.especialistas.entradilla':
    'Son personas que se dedican sobre todo a la informática: {empleo} de cada 100 personas con empleo, según una estimación de Eurostat. De cada 100 especialistas, {mujeres} son mujeres.',
  'datos-globales.ue.especialistas.figura': 'Las empresas de la UE y los especialistas en TIC',
  'datos-globales.ue.especialistas.figura.sub':
    'Empresas con 10 o más personas. UE-27, {anio}. Cada panel dice su base.',
  'datos-globales.ue.especialistas.panel.empresas': 'De cada 100 empresas, cuántas…',
  'datos-globales.ue.especialistas.panel.motivos':
    'De cada 100 que buscaron, cuántas tuvieron vacantes difíciles, y por qué',
  'datos-globales.ue.especialistas.fuente': 'Eurostat (isoc_ske_itspen2 e isoc_ske_itrcrn2)',
  'datos-globales.ue.especialistas.nota': 'Una empresa puede dar varios motivos: no suman 100.',
  'datos-globales.ue.especialistas.lectura.vacantes.titulo': 'Vacantes difíciles',
  'datos-globales.ue.especialistas.lectura.vacantes':
    'De cada 100 empresas que buscaron especialistas en TIC, {cifra} tuvieron vacantes difíciles de cubrir. En {anio}, {anterior}.',
  'datos-globales.ue.especialistas.lectura.vacantes.sola':
    'De cada 100 empresas que buscaron especialistas en TIC, {cifra} tuvieron vacantes difíciles de cubrir.',
  'datos-globales.ue.especialistas.lectura.quien':
    '{cifra} de cada 100 empresas con 10 o más personas tienen especialistas en TIC en plantilla.',

  // 09 · Formación (UE)
  'datos-globales.ue.formacion.pregunta': '¿Cuánta gente adulta se está formando?',
  'datos-globales.ue.formacion.titular.sube': 'Cada año se forman más adultos en la UE: {cifra} de cada 100 en {anio}',
  'datos-globales.ue.formacion.titular.cifra':
    '{cifra} de cada 100 adultos de la UE hicieron algún curso en el último mes',
  'datos-globales.ue.formacion.entradilla':
    'Personas de 25 a 64 años que hicieron algún curso o formación en las cuatro semanas anteriores. Cuenta cualquier formación, no solo sobre IA.',
  'datos-globales.ue.formacion.figura.evolucion':
    'De cada 100 adultos de 25 a 64 años, cuántos se formaron en el último mes',
  'datos-globales.ue.formacion.figura.evolucion.sub': 'Encuesta de población activa. UE-27, {desde}–{hasta}.',
  'datos-globales.ue.formacion.fuente': 'Eurostat (trng_lfse_04)',
  'datos-globales.ue.formacion.figura': 'De cada 100 empresas de la UE, cuántas formaron a su personal en informática',
  'datos-globales.ue.formacion.figura.sub': 'Empresas con 10 o más personas. UE-27, {anio}.',
  'datos-globales.ue.formacion.fuente.empresas': 'Eurostat (isoc_ske_ittn2)',
  'datos-globales.ue.formacion.lectura.evolucion':
    'En {desde} se formaban {inicio} de cada 100 adultos de la UE; en {hasta}, {fin}.',
  'datos-globales.ue.formacion.lectura.sexo':
    'Se formaron {mujeres} de cada 100 mujeres y {hombres} de cada 100 hombres de 25 a 64 años.',
  'datos-globales.ue.formacion.lectura.empresas.titulo': 'En las empresas',
  'datos-globales.ue.formacion.lectura.empresas':
    '{cifra} de cada 100 empresas formaron a su personal en informática en {anio}.',

  // 10 · Opinión (UE)
  'datos-globales.ue.opinion.pregunta': '¿Qué opina la gente de la IA en el trabajo?',
  'datos-globales.ue.opinion.entradilla':
    'Lo que opina la gente de los 27 países, según una encuesta de la Comisión Europea de {anio}. Es opinión, no una medida: dice lo que la gente cree, no lo que pasa en su empleo.',
  'datos-globales.ue.opinion.figura':
    'De cada 100 personas de 15 años o más de la UE, cuántas están de acuerdo con cada frase o ven importante cada regla',
  'datos-globales.ue.opinion.figura.sub':
    'Eurobarómetro especial 554, abril y mayo de {anio}. Cifras enteras, como las publica.',
  'datos-globales.ue.opinion.panel.frases': 'Los robots y la IA en el trabajo',
  'datos-globales.ue.opinion.panel.reglas': 'Reglas para la IA en el trabajo',
  'datos-globales.ue.opinion.fuente': 'Comisión Europea, Eurobarómetro especial 554 ({preguntas})',
  'datos-globales.ue.opinion.lectura.positiva':
    'Ven bien el uso de robots e IA en el trabajo {cifra} de cada 100 personas de la UE.',
  'datos-globales.ue.opinion.lectura.destruira':
    'Creen que desaparecerán más empleos de los que se crearán {cifra} de cada 100.',
  'datos-globales.ue.opinion.lectura.herramientas':
    'De cada 100 personas que trabajan para una empresa o un jefe, {cifra} dicen que les dan las herramientas o la formación para trabajar con la IA.',
  'datos-globales.ue.opinion.lectura.trabajo': '{pregunta}: {cifra} de cada 100.',
  'datos-globales.ue.opinion.lectura.reglas.titulo': 'Y piden reglas',
  'datos-globales.ue.opinion.lectura.reglas':
    'Ven importante cada regla entre {minimo} y {maximo} de cada 100 personas.',
  'datos-globales.ue.opinion.ficha.margen': 'Más de 26.000 entrevistas en toda la UE: el margen de error es pequeño.',
  // ---------- Fichas de «El mundo» (scripts/globo/ficha.js): las figuras del mismo sistema ----------
  'globo.ficha.anio-grafico': '{anio}.',
  'globo.ficha.anios-grafico': 'De {desde} a {hasta}, con los años en su sitio proporcional.',
  'globo.ficha.no-comparable':
    'Sin dato comparable en {anios}: la fuente lo marca como no comparable (otra definición o una ruptura de serie). No se muestra.',
  'globo.ficha.genero.nota':
    'Círculo: mujeres. Cuadrado: hombres. A la derecha, la diferencia en puntos: la cifra de los hombres menos la de las mujeres.',
};
