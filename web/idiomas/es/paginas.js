// Textos comunes y de las páginas de presentación en castellano. Se incorporan al diccionario de es.js.

/**
 * Diccionario de solo lectura (clave -> texto) en castellano con los textos de las páginas comunes y de presentación.
 * @type {Readonly<Record<string, string>>}
 */
export const TEXTOS_PAGINAS = {
  'contacto.titulo': 'Contacto de publicación',
  'contacto.responsable': 'Responsable: {0}',
  'contacto.correo': 'Correo de contacto: {0}',
  'contacto.no-disponible': 'No hay un correo de contacto disponible.',

  // ---------- Común a todas las páginas: cabecera, menú, navegación, pie y selector de idioma ----------
  'comun.accion.conocer-faro': 'Conocer Faro',
  'comun.accion.entender-ia': 'Entender la IA',
  'comun.accion.ir-biblioteca': 'Ir a la Biblioteca',
  'comun.aviso.nombre': 'Información sobre Faro',
  'comun.cerrar': 'Cerrar',
  'comun.etapas.anterior': 'Anterior',
  'comun.etapas.controles': 'Cambiar de etapa',
  'comun.etapas.nombre': 'Etapas de la página',
  'comun.etapas.paso': 'Paso {numero} de {total} · {nombre}',
  'comun.etapas.rotulo': 'Recorrido · Paso {numero} de {total}',
  'comun.etapas.segmento': 'Apartado {numero} de {total} · {nombre}',
  'comun.etapas.siguiente': 'Siguiente · {0} de {1}',
  'comun.etapas.vista': ', ya vista',
  'comun.idioma.aviso-nombre': 'Aviso sobre el idioma',
  'comun.idioma.boton': 'Idioma: Castellano',
  'comun.idioma.no-cargado': 'No se ha podido cargar el {idioma}. Comprueba tu conexión y vuelve a elegirlo.',
  'comun.idioma.no-cargado-version':
    'No se ha podido cargar el {idioma}: Faro se ha actualizado desde que abriste esta página. Vuelve a cargarla para cambiar de idioma; al recargar se borra lo que llevas hecho en ella.',
  'comun.idioma.nombre.ca': 'catalán',
  'comun.idioma.nombre.es': 'castellano',
  'comun.idioma.titulo': 'Idioma',
  'comun.marca.inicio': 'Faro, inicio',
  'comun.menu.abrir': 'Abrir menú',
  'comun.menu.cerrar': 'Cerrar menú',
  'comun.menu.nombre': 'Menú principal',
  'comun.menu.pasar': 'Pasar a otro dispositivo',

  'comun.pie.creditos': 'Créditos',
  'comun.pie.derechos': '© 2026 Equipo Faro',
  'comun.pie.doctor': 'Comprobar Faro',
  'comun.pie.instalar': 'Instalar Faro',
  'comun.pie.datos': 'Tus datos',
  'comun.pie.nombre': 'Información y ayuda',
  'comun.referencia': 'Referencia ',
  'comun.referencias': 'Referencias',
  'comun.saltar': 'Saltar al contenido',
  'comun.seccion.biblioteca': 'Biblioteca',
  'comun.seccion.como': 'Cómo funciona',
  'comun.seccion.empezar': 'Empezar',
  'comun.seccion.ia': 'Qué es la IA',
  'comun.seccion.inicio': 'Inicio',
  'comun.siguiente.nombre': 'Continuar en Faro',
  'comun.siguiente.paso': 'Siguiente paso',
  'comun.siguiente.seccion': 'Siguiente sección',
  'comun.tema.a-dia': 'Cambiar a modo día',
  'comun.tema.a-noche': 'Cambiar a modo noche',
  'comun.tema.titulo': 'Modo día / noche',
  'comun.titulo.faro': 'Qué es Faro',
  'comun.pie.accesibilidad': 'Accesibilidad',
  'comun.pie.verificable': 'Faro verificable',
  'comun.seccion.datos-globales': 'Datos globales',

  // ---------- Inicio (inicio.html) y su buscador de secciones ----------
  'inicio.buscar.ayuda': 'Encuentra la sección que necesitas.',
  'inicio.buscar.boton': 'Buscar',
  'inicio.buscar.cerrar': 'Cerrar búsqueda',
  'inicio.buscar.como': 'Los cuatro pasos y lo que obtienes.',
  'inicio.buscar.ejemplo': 'Formación, tareas, informe…',
  'inicio.buscar.empezar': 'Dinos a qué te dedicas, marca tus tareas y recibe tu informe, tarea a tarea.',
  'inicio.buscar.encontrada': '{numero} sección encontrada.',
  'inicio.buscar.encontradas': '{numero} secciones encontradas.',
  'inicio.buscar.etiqueta': 'Buscar una sección por tema',
  'inicio.buscar.faro': 'Para qué sirve y cómo puede ayudarte.',
  'inicio.buscar.ia': 'Qué hace y qué conviene tener en cuenta.',
  'inicio.buscar.nombre': 'Buscar en Faro',
  'inicio.buscar.titulo': '¿Qué quieres encontrar?',
  'inicio.buscar.vacio': 'Faro no encuentra esa sección. Prueba con «IA», «trabajo» o «formación».',
  'inicio.descripcion':
    'Entiende cómo puede cambiar tu trabajo con la inteligencia artificial, tarea a tarea, y consulta la formación oficial relacionada con tu ocupación.',
  'inicio.explorar.titulo': 'Elige por dónde empezar.',
  'inicio.historia.faro.numero': '02 / Conocer',
  'inicio.historia.faro.texto': 'Una herramienta para explorar cambios en tu trabajo y opciones de formación.',
  'inicio.historia.ia.numero': '01 / Entender',
  'inicio.historia.ia.texto': 'Qué es, cómo aprende y qué precauciones tomar, con un desafío al final.',
  'inicio.historia.proceso.numero': '03 / Prepararte',
  'inicio.historia.proceso.texto':
    'Guías, informes y notas de fuentes oficiales, de lo más sencillo a lo más avanzado.',
  'inicio.portada.ejemplo': 'Ver un informe de ejemplo',
  'inicio.portada.foto': 'Faro de Trwyn Du en Penmon, Gales, rodeado por el mar en calma bajo un cielo azul y rosado.',
  'inicio.portada.hecho.dispositivo': 'Lo que escribes se queda en tu dispositivo',
  'inicio.portada.hecho.gratis': 'Gratis',
  'inicio.portada.hecho.registro': 'Sin registro',
  'inicio.portada.intro': 'Descubre cómo la IA puede cambiar el trabajo y decide en qué quieres formarte.',
  'inicio.portada.titulo-1': 'IA y tu futuro',
  'inicio.portada.titulo-2': 'profesional.',
  'inicio.titulo': 'Faro · IA y tu futuro profesional',

  // Los textos de «Qué es Faro» (que-es-faro.html) están en es/faro.js.

  // ---------- Tus datos (informacion-y-creditos.html) ----------
  'informacion-y-creditos.borrar.boton': 'Borrar todo',
  'informacion-y-creditos.borrar.confirmar':
    '¿Borrar todo lo que Faro ha guardado en este navegador? No se puede deshacer.',
  'informacion-y-creditos.borrar.error':
    'No se ha podido borrar todo. Cierra las otras pestañas de Faro y vuelve a intentarlo.',
  'informacion-y-creditos.borrar.nota':
    'Borra tus datos y ajustes de este dispositivo. Después, la página vuelve al inicio.',
  'informacion-y-creditos.datos.1': 'Para hacer el recorrido y consultar los cursos no necesitas una cuenta.',
  'informacion-y-creditos.datos.2':
    'El recorrido se conserva en la página abierta y desaparece al cerrarla o al empezar de nuevo. El navegador guarda las preferencias de tema e idioma, una clave aleatoria local para reconocer los cálculos del dispositivo y copias de páginas y datos públicos para usarlos sin conexión.',

  'informacion-y-creditos.datos.5':
    'Faro no guarda tu informe ni lo comparte con empresas ni con servicios públicos: lo ves tú y, si quieres, lo guardas en PDF.',
  'informacion-y-creditos.descripcion': 'Qué pasa con lo que escribes en Faro y cómo borrarlo.',
  'informacion-y-creditos.datos.local':
    'Faro procesa lo que escribes en este dispositivo. El filtro quita los datos personales que reconoce. Puede no reconocerlos todos: no escribas tu nombre, el de tu empresa, datos de salud ni datos de otras personas.',
  'informacion-y-creditos.intro':
    'Qué pasa con lo que escribes en Faro y cómo borrarlo. De dónde salen los datos y con qué licencia, en {0}.',
  'informacion-y-creditos.rotulo': 'Privacidad',
  'informacion-y-creditos.titulo': 'Tus datos · Faro',
  'informacion-y-creditos.titulo-principal': 'Tus datos',
  'informacion-y-creditos.datos.titulo': 'Lo que pasa con lo que escribes',
  'datos-globales.descripcion':
    'Datos globales: la IA en el trabajo en Cataluña, España y Europa, con estadísticas oficiales de territorios, cada cifra con su fuente y su año.',
  'datos-globales.titulo': 'Datos globales · Faro',
  'datos-globales.rotulo': 'Dossier · Datos globales',
  'datos-globales.muestra': 'Cifras de muestra para probar la página: no son datos reales.',
  'datos-globales.sin-script':
    'Las cifras se dibujan en tu navegador: para verlas hace falta tener JavaScript activado.',
  'datos-globales.estado.cargando': 'Cargando los datos…',
  'datos-globales.estado.no-disponibles':
    'Los datos globales no están disponibles ahora. Vuelve a intentarlo más tarde.',
  'datos-globales.estado.no-validos':
    'Los datos globales de esta versión no se pueden enseñar: no cumplen su formato, y Faro no enseña cifras que no ha podido comprobar.',
  'datos-globales.globo.nombre': 'Globo con los datos de cada país',
  'datos-globales.grafico.fuente': 'Fuente: {fuente}',
  'datos-globales.sin-cifra': 'Sin cifra oficial publicada',
  'datos-globales.unidad.puntos': 'puntos',
  'datos-globales.puntos': '{puntos} puntos',
  'datos-globales.naturaleza.medido': 'Medido',
  'datos-globales.naturaleza.estimado': 'Estimado',
  'datos-globales.naturaleza.opinion': 'Encuesta de opinión',
  'datos-globales.ficha.ambito': 'Ámbito',
  'datos-globales.ficha.anios': 'Años',
  'datos-globales.ficha.tecnologias': 'Tecnologías',
  'datos-globales.ficha.usos': 'Usos',
  'datos-globales.ficha.motivos': 'Motivos',
  'datos-globales.ficha.calculo': 'Cálculo',
  'datos-globales.ficha.metas': 'Metas',
  'datos-globales.ficha.capacidades': 'Capacidades',
  'datos-globales.ficha.especialistas': 'Especialistas',
  'datos-globales.ficha.empresas': 'Empresas',
  'datos-globales.ficha.pymes': 'Pymes',
  'datos-globales.ficha.niveles': 'Niveles',
  'datos-globales.ficha.formacion': 'Formación',
  'datos-globales.ue.empresas.tema': 'Empresas',
  'datos-globales.ue.empresas.todas': 'Todas (10 o más)',
  'datos-globales.ue.empresas.10-49': 'De 10 a 49',
  'datos-globales.ue.empresas.50-249': 'De 50 a 249',
  'datos-globales.ue.empresas.250': '250 o más',
  'datos-globales.ue.empresas.ficha.que-mide':
    'Empresas con 10 o más trabajadores que usan al menos una tecnología de IA (analizar textos, entender la voz, generar textos, voz o código, reconocer imágenes, aprendizaje automático, automatizar tareas, robots autónomos y, con dato solo en 2025, generar imágenes, vídeo o audio).',
  'datos-globales.ue.empresas.ficha.ambito':
    'UE-27 (EU27_2020): los 27 países juntos. Industria y servicios, sin agricultura ni finanzas.',
  'datos-globales.ue.empresas.ficha.fuente':
    'Eurostat, encuesta europea sobre el uso de las TIC en las empresas: isoc_eb_ai, indicador E_AI_TANY, unidad PC_ENT (% de empresas), por tamaño (size_emp).',
  'datos-globales.ue.tecnologias.tema': 'Tecnologías',
  'datos-globales.ue.tecnologias.titular.neutro': 'Qué tipo de IA usan las empresas de la UE',
  'datos-globales.ue.tecnologias.alguna': 'Alguna de ellas',
  'datos-globales.ue.tecnologias.texto': 'Analizar textos',
  'datos-globales.ue.tecnologias.imagen-video-sonido': 'Crear imagen o sonido',
  'datos-globales.ue.tecnologias.lenguaje': 'Redactar o programar',
  'datos-globales.ue.tecnologias.voz': 'Entender la voz',
  'datos-globales.ue.tecnologias.automatizacion': 'Automatizar tareas',
  'datos-globales.ue.tecnologias.aprendizaje-automatico': 'Aprender de datos',
  'datos-globales.ue.tecnologias.reconocimiento-imagenes': 'Reconocer imágenes',
  'datos-globales.ue.tecnologias.robots': 'Robots autónomos',
  'datos-globales.ue.tecnologias.uso.marketing-ventas': 'Marketing o ventas',
  'datos-globales.ue.tecnologias.uso.administracion': 'Administración',
  'datos-globales.ue.tecnologias.uso.finanzas': 'Contabilidad',
  'datos-globales.ue.tecnologias.uso.produccion': 'Producción',
  'datos-globales.ue.tecnologias.uso.seguridad-informatica': 'Ciberseguridad',
  'datos-globales.ue.tecnologias.uso.id-innovacion': 'I+D e innovación',
  'datos-globales.ue.tecnologias.uso.logistica': 'Logística',
  'datos-globales.ue.tecnologias.sectores': 'Por sectores',
  'datos-globales.ue.tecnologias.frena': 'Lo que más frena',
  'datos-globales.ue.tecnologias.nota':
    'Una empresa puede usar varios tipos de IA: por eso las cifras no suman el total.',
  'datos-globales.ue.tecnologias.ficha.que-mide':
    'Empresas con 10 o más trabajadores que usan cada tecnología de IA y para qué la usan, de cada 100 empresas.',
  'datos-globales.ue.tecnologias.ficha.tecnologias':
    'Analizar textos: minería de textos. Entender la voz: reconocimiento del habla. Redactar o programar: generar lenguaje escrito o hablado, o código. Crear imagen o sonido: generar imágenes, vídeo o audio; solo se pregunta desde 2025. Aprender de datos: aprendizaje automático. Automatizar tareas: automatización robótica de procesos y ayuda a decidir. Robots autónomos: robots, vehículos y drones que se mueven solos.',
  'datos-globales.ue.tecnologias.ficha.usos':
    'Administración: organización administrativa o dirección de la empresa. Contabilidad: contabilidad, control o gestión financiera. Ciberseguridad: seguridad de las TIC.',
  'datos-globales.ue.tecnologias.ficha.sectores':
    'Información y comunicación (sección J de la NACE): {j} %. Construcción (sección F): {f} %. Tabla isoc_eb_ain2.',
  'datos-globales.ue.tecnologias.ficha.motivos':
    'Se pregunta a las empresas que no usan IA pero han pensado en usarla ({penso} de cada 100). Los tres más citados: falta de conocimientos ({conocimientos}), dudas sobre las consecuencias legales ({legales}) y protección de datos y privacidad ({datos}), de cada 100 empresas.',
  'datos-globales.ue.tecnologias.ficha.fuente':
    'Eurostat, isoc_eb_ai (indicadores E_AI_T*, E_AI_P* y E_AI_B*) e isoc_eb_ain2 (E_AI_TANY por sector), unidad PC_ENT, UE-27.',
  'datos-globales.ue.personas.tema': 'Personas',
  'datos-globales.ue.personas.cualquier': 'Para cualquier cosa',
  'datos-globales.ue.personas.privada': 'Para su vida privada',
  'datos-globales.ue.personas.trabajo': 'Para su trabajo',
  'datos-globales.ue.personas.estudios': 'Para sus estudios',
  'datos-globales.ue.edad.16-24': 'De 16 a 24 años',
  'datos-globales.ue.edad.25-34': 'De 25 a 34 años',
  'datos-globales.ue.edad.35-44': 'De 35 a 44 años',
  'datos-globales.ue.edad.45-54': 'De 45 a 54 años',
  'datos-globales.ue.edad.55-64': 'De 55 a 64 años',
  'datos-globales.ue.edad.65-74': 'De 65 a 74 años',
  'datos-globales.ue.personas.por-que': 'Por qué no la usan',
  'datos-globales.ue.personas.ficha.que-mide':
    'Personas de 16 a 74 años que usaron alguna herramienta de IA generativa en los tres meses anteriores a la encuesta, en total y según para qué.',
  'datos-globales.ue.personas.ficha.base':
    'Todas las personas de 16 a 74 años de la UE, usen o no internet (unidad PC_IND). Sobre quienes usaron internet en los tres meses anteriores (PC_IND_IU3, la base de la página «Cataluña»), la cifra total es {internet}.',
  'datos-globales.ue.personas.ficha.motivos':
    'Sobre quienes no usaron IA generativa (PC_IND_IUAIX): no la necesitan, {necesita}; no saben cómo usarla, {sabe}; no sabían que existía, {existia}; les preocupa la privacidad o la seguridad, {privacidad}. Tabla isoc_ai_iaiuxr.',
  'datos-globales.ue.personas.ficha.anio': '{anio} (primera vez que se pregunta)',
  'datos-globales.ue.personas.ficha.fuente':
    'Eurostat, encuesta europea sobre el uso de las TIC en los hogares: isoc_ai_iaiu (I_IUAI, I_IUAIPR, I_IUAIWP, I_IUAIFE) e isoc_ai_iaiuxr, UE-27.',
  'datos-globales.ue.genero.tema': 'Mujeres y hombres',
  'datos-globales.ue.genero.capacidades': 'Capacidades digitales',
  'datos-globales.ue.genero.ficha.que-mide':
    'Mujeres y hombres de 16 a 74 años que usaron alguna herramienta de IA generativa en los tres meses anteriores, según para qué.',
  'datos-globales.ue.genero.ficha.base':
    'Todas las mujeres y todos los hombres de 16 a 74 años, usen o no internet (PC_IND).',
  'datos-globales.ue.genero.ficha.calculo':
    'Las diferencias se calculan con las cifras sin redondear; por eso, a veces, no coinciden en una décima con la resta de las cifras redondeadas.',
  'datos-globales.ue.genero.ficha.anio': '{anio}',
  'datos-globales.ue.genero.ficha.fuente':
    'Eurostat, isoc_ai_iaiu (grupos F_Y16_74 y M_Y16_74) e isoc_sk_dskl_i21 (I_DSK2_BAB), UE-27.',
  'datos-globales.ue.trabajo.tema': 'Trabajo y estudios',
  'datos-globales.ue.trabajo.titular.neutro': 'La IA generativa en el trabajo, según la ocupación y los estudios',
  'datos-globales.ue.trabajo.todas': 'Todas',
  'datos-globales.ue.trabajo.tic': 'Profesionales TIC',
  'datos-globales.ue.trabajo.no-manual': 'Ocupación no manual',
  'datos-globales.ue.trabajo.manual': 'Ocupación manual',
  'datos-globales.ue.trabajo.superiores': 'Superiores',
  'datos-globales.ue.trabajo.medios': 'Medios',
  'datos-globales.ue.trabajo.bajos': 'Bajos o sin estudios',
  'datos-globales.ue.trabajo.tic.titulo': 'Profesionales de las TIC',
  'datos-globales.ue.trabajo.ficha.que-mide':
    'Personas de 16 a 74 años que usaron IA generativa para su trabajo en los tres meses anteriores, según su ocupación y sus estudios.',
  'datos-globales.ue.trabajo.ficha.grupos':
    'Que trabajan: asalariados, autónomos y ayudas familiares. No manuales: grandes grupos 0 a 5 de la CIUO-08; manuales: 6 a 9 (la misma división que en la página «Cataluña»). Profesionales de las TIC: definición de Eurostat; también cuentan entre los no manuales. Estudios: bajos, CINE 0–2; medios, 3–4; superiores, 5–8.',
  'datos-globales.ue.trabajo.ficha.base': 'Toda la población de cada grupo, use o no internet (PC_IND).',
  'datos-globales.ue.trabajo.ficha.anio': '{anio}',
  'datos-globales.ue.trabajo.ficha.fuente':
    'Eurostat, isoc_ai_iaiu, indicador I_IUAIWP (grupos SAL_SELF_FAM, ISCO_ICT, ISCO0_5, ISCO6_9, IND_TOTAL, I5_8, I3_4 e I0_2), UE-27.',
  'datos-globales.ue.capacidades.tema': 'Capacidades digitales',
  'datos-globales.ue.capacidades.al-menos': 'Al menos básicas',
  'datos-globales.ue.capacidades.avanzadas': 'Por encima de básicas',
  'datos-globales.ue.capacidades.solo-basicas': 'Básicas',
  'datos-globales.ue.capacidades.bajas': 'Bajas',
  'datos-globales.ue.capacidades.reducidas': 'Escasas',
  'datos-globales.ue.capacidades.limitadas': 'Limitadas',
  'datos-globales.ue.capacidades.ninguna': 'Ninguna',
  'datos-globales.ue.capacidades.sin-evaluar': 'No usaron internet',
  'datos-globales.ue.capacidades.las-cinco': 'Las cinco a la vez',
  'datos-globales.ue.capacidades.area.comunicacion': 'Comunicarse',
  'datos-globales.ue.capacidades.area.informacion': 'Buscar información',
  'datos-globales.ue.capacidades.area.resolucion-problemas': 'Resolver problemas',
  'datos-globales.ue.capacidades.area.seguridad': 'Seguridad',
  'datos-globales.ue.capacidades.area.contenidos': 'Crear contenidos',
  'datos-globales.ue.capacidades.area.comunicacion.frase': 'comunicarse',
  'datos-globales.ue.capacidades.area.informacion.frase': 'buscar información',
  'datos-globales.ue.capacidades.area.resolucion-problemas.frase': 'resolver problemas',
  'datos-globales.ue.capacidades.area.seguridad.frase': 'usar internet con seguridad',
  'datos-globales.ue.capacidades.area.contenidos.frase': 'crear contenidos digitales',
  'datos-globales.ue.capacidades.avanzadas.titulo': 'Por encima de básicas',
  'datos-globales.ue.capacidades.dificil': 'El área más difícil',
  'datos-globales.ue.capacidades.nota':
    '«Al menos básicas» pide las cinco áreas a la vez; por eso es más bajo que cada área por separado.',
  'datos-globales.ue.capacidades.ficha.que-mide':
    'El indicador de capacidades digitales de Eurostat (versión 2.0): a partir de lo que cada persona dice haber hecho en internet en los tres meses anteriores, puntúa cinco áreas: información y datos, comunicación y colaboración, creación de contenidos, seguridad y resolución de problemas.',
  'datos-globales.ue.capacidades.ficha.niveles':
    'Por encima de básicas: las cinco áreas por encima de lo básico. Básicas: las cinco al menos en nivel básico, sin estar todas por encima. Bajas: cuatro de cinco. Escasas: tres de cinco. Limitadas: dos de cinco. Ninguna: ninguna área. No usaron internet: no se pueden medir. Los ocho niveles suman 100 (sin contar la fila «Al menos básicas», que es la suma de las dos primeras).',
  'datos-globales.ue.capacidades.ficha.base': 'Todas las personas de 16 a 74 años (PC_IND).',
  'datos-globales.ue.capacidades.ficha.anios': 'Se mide cada dos años: 2021, 2023 y 2025.',
  'datos-globales.ue.capacidades.ficha.fuente':
    'Eurostat, isoc_sk_dskl_i21: I_DSK2_BAB, I_DSK2_AB, I_DSK2_B, I_DSK2_LW, I_DSK2_N, I_DSK2_LM, I_DSK2_X, I_DSK2_NA y, por áreas, I_DSK2_CC_BAB, I_DSK2_IL_BAB, I_DSK2_PS_BAB, I_DSK2_SF_BAB e I_DSK2_DCC_BAB; UE-27.',
  'datos-globales.ue.capacidades.ficha.formacion':
    'No hay una tabla actual de Eurostat sobre personas que se forman para mejorar sus capacidades digitales: la última («Way of obtaining ICT skills», isoc_sk_how_i) acaba en 2018.',
  'datos-globales.ue.metas.tema': 'Metas para 2030',
  'datos-globales.ue.metas.titular.neutro': 'Cómo va la UE hacia sus metas digitales para 2030',
  'datos-globales.ue.metas.millones': '{cifra} millones',
  'datos-globales.ue.metas.faltan.puntos': 'Faltan {faltan} puntos para la meta del {meta}.',
  'datos-globales.ue.metas.faltan.millones': 'Faltan {faltan} millones para la meta de {meta} millones.',
  'datos-globales.ue.metas.meta-capacidades-digitales':
    'Personas de 16 a 74 años con capacidades digitales al menos básicas',
  'datos-globales.ue.metas.meta-especialistas-tic': 'Especialistas en TIC que trabajan en la UE',
  'datos-globales.ue.metas.meta-empresas-nube-datos-ia': 'Empresas que usan al menos una: nube, análisis de datos o IA',
  'datos-globales.ue.metas.meta-pymes-intensidad-digital':
    'Pymes (de 10 a 249 trabajadores) con una intensidad digital al menos básica',
  'datos-globales.ue.metas.ficha.metas':
    'Decisión (UE) 2022/2481, por la que se establece el programa estratégico de la Década Digital para 2030, artículo 4 (texto literal): {textos}',
  'datos-globales.ue.metas.ficha.capacidades':
    'Eurostat, isoc_sk_dskl_i21, indicador I_DSK2_BAB (las cinco áreas en nivel básico o superior), PC_IND. Se mide cada dos años.',
  'datos-globales.ue.metas.ficha.especialistas':
    'Eurostat, isoc_sks_itspt (miles de personas y % del empleo total) e isoc_sks_itsps (% de mujeres), encuesta de población activa. Eurostat marca las cifras de la UE con «e» (estimadas).',
  'datos-globales.ue.metas.ficha.empresas':
    'Eurostat, isoc_eb_ai, indicador E_AI_CC1SI_DA_ANY: empresas que usan IA, o compran servicios de nube sofisticados o intermedios, o analizan datos. La ley dice «macrodatos» y la encuesta pregunta por análisis de datos.',
  'datos-globales.ue.metas.ficha.pymes':
    'Eurostat, isoc_e_dii, indicador E_DI3_GELO (índice de intensidad digital, versión 3), empresas de 10 a 249 trabajadores, PC_ENT. «Básica» es usar al menos cuatro de doce tecnologías. {version4}; las dos versiones no se comparan entre sí.',
  'datos-globales.ue.metas.ficha.pymes.version4': 'La versión 4 (años pares) dio el {cifra} en {anio}',
  'datos-globales.ue.metas.ficha.pymes.version4.sin-dato': 'La versión 4 (años pares), sin dato',
  'datos-globales.ue.especialistas.tema': 'Especialistas en TIC',
  'datos-globales.ue.especialistas.titular.neutro': 'Las empresas de la UE y los especialistas en TIC',
  'datos-globales.ue.especialistas.emplean': 'Los emplean',
  'datos-globales.ue.especialistas.buscan': 'Intentaron contratar',
  'datos-globales.ue.especialistas.vacantes': 'Vacantes difíciles',
  'datos-globales.ue.especialistas.faltan-candidaturas': 'Pocas candidaturas',
  'datos-globales.ue.especialistas.salarios': 'Sueldos pedidos altos',
  'datos-globales.ue.especialistas.formacion': 'Falta de formación',
  'datos-globales.ue.especialistas.experiencia': 'Falta de experiencia',
  'datos-globales.ue.especialistas.mitad': 'Más de la mitad',
  'datos-globales.ue.especialistas.quien': 'Quién los emplea',
  'datos-globales.ue.especialistas.ficha.que-mide':
    'Empresas con 10 o más trabajadores que emplean especialistas en TIC (personas cuyo trabajo principal es la informática), que intentaron contratarlos el año anterior y que tuvieron vacantes difíciles de cubrir, y por qué les costó.',
  'datos-globales.ue.especialistas.ficha.base':
    'Primer gráfico: todas las empresas (PC_ENT). Segundo gráfico: empresas que contrataron o intentaron contratar especialistas en TIC (PC_ENT_ITSPRCR2). Una empresa puede dar varios motivos.',
  'datos-globales.ue.especialistas.ficha.anios': 'La encuesta lo pregunta cada dos años ({anterior}).',
  'datos-globales.ue.especialistas.ficha.anios.anterior': '{anio}: {cifra} con vacantes difíciles',
  'datos-globales.ue.especialistas.ficha.anios.sin-dato': 'edición anterior, sin dato',
  'datos-globales.ue.especialistas.ficha.fuente':
    'Eurostat, encuesta europea sobre el uso de las TIC en las empresas: isoc_ske_itspen2 (E_ITSP2) e isoc_ske_itrcrn2 (E_ITSPRCR2, E_ITSPVAC2, E_ITSPDLA, E_ITSPDSAL, E_ITSPDLET, E_ITSPDLWE), UE-27, industria y servicios sin finanzas.',
  'datos-globales.ue.formacion.tema': 'Formación',
  'datos-globales.ue.formacion.su-personal': 'A su personal',
  'datos-globales.ue.formacion.otro': 'A otro personal',
  'datos-globales.ue.formacion.especialistas': 'A especialistas TIC',
  'datos-globales.ue.formacion.sexo': 'Mujeres y hombres',
  'datos-globales.ue.formacion.ficha.que-mide':
    'Personas de 25 a 64 años que hicieron alguna actividad de educación o formación en las cuatro semanas anteriores a la encuesta. Y empresas con 10 o más trabajadores que dieron formación en informática (TIC) a su personal: a cualquiera (E_ITT2), a sus especialistas en TIC (E_ITSPT2) o al resto del personal (E_ITUST2).',
  'datos-globales.ue.formacion.ficha.anios':
    'Adultos: la serie empieza en 2021, cuando cambió la encuesta de población activa (Eurostat lo marca con «b»). Empresas: la encuesta lo pregunta cada dos años.',
  'datos-globales.ue.formacion.ficha.fuente':
    'Eurostat, trng_lfse_04 (encuesta de población activa, % de personas, UE-27) e isoc_ske_ittn2 (E_ITT2, E_ITUST2 y E_ITSPT2, PC_ENT, UE-27).',
  'datos-globales.ue.opinion.tema': 'Opinión',
  'datos-globales.ue.opinion.titular.hallazgo': 'En la UE, la mayoría ve bien la IA en el trabajo',
  'datos-globales.ue.opinion.titular.neutro': 'Qué opina la gente de la UE de la IA en el trabajo',
  'datos-globales.ue.opinion.titular.reglas': 'En la UE, la mayoría ve bien la IA en el trabajo y pide reglas',
  'datos-globales.ue.opinion.trabajo': 'Quienes trabajan para una empresa o un jefe',
  'datos-globales.ue.opinion.cuidado': 'Hay que gestionarlos con cuidado',
  'datos-globales.ue.opinion.destruira': 'Quitarán más empleos de los que crearán',
  'datos-globales.ue.opinion.sociedad': 'Son buenos para la sociedad',
  'datos-globales.ue.opinion.positiva': 'Ven bien su uso en el trabajo',
  'datos-globales.ue.opinion.regla.intimidad': 'Proteger la intimidad',
  'datos-globales.ue.opinion.regla.trabajadores': 'Contar con los trabajadores',
  'datos-globales.ue.opinion.regla.transparencia': 'Más transparencia en personal',
  'datos-globales.ue.opinion.regla.decisiones': 'Prohibir decisiones solo automáticas',
  'datos-globales.ue.opinion.regla.vigilancia': 'Limitar la vigilancia automática',
  'datos-globales.ue.opinion.herramientas': 'Herramientas y formación',
  'datos-globales.ue.opinion.ficha.preguntas':
    'Las del cuestionario que trae el archivo de datos, con su número: {preguntas}. Cada fila de los gráficos y cada tarjeta es una pregunta, con su nombre.',
  'datos-globales.ue.opinion.ficha.base':
    'Las de QB3 se hacen solo a quienes trabajan para una empresa o un jefe; las demás, a todas las personas de 15 años o más.',
  'datos-globales.ue.opinion.ficha.cifras':
    'Suma de las respuestas de acuerdo, positivas o importantes. El Eurobarómetro publica porcentajes enteros; se muestran sin decimales.',
  'datos-globales.ue.opinion.ficha.encuesta':
    'Comisión Europea, Eurobarómetro especial 554, «Artificial Intelligence and the future of work» (oleada 101.4): 26.415 entrevistas a personas de 15 años o más en los 27 países (trabajo de campo: 25/04–22/05/2024). Publicado en 2025.',
  'datos-globales.ficha.sectores': 'Sectores',
  'datos-globales.genero.mujeres': 'Mujeres',
  'datos-globales.genero.hombres': 'Hombres',
  'datos-globales.genero.cabecera': 'Diferencia',
  'datos-globales.fuentes.titulo': 'Fuentes',
  'datos-globales.fuentes.eurostat': 'Eurostat. {0} ({1}). Actualización: {2}.',
  'datos-globales.fuentes.eurostat.dos': 'Eurostat. {0} ({1}) y {2} ({3}). Actualización: {4}.',
  'datos-globales.fuentes.eurobarometro':
    'Comisión Europea. {0} (oleada 101.4, abril y mayo de 2024), volumen A. Encuesta de opinión.',
  'datos-globales.fuentes.ceo': 'Centre d’Estudis d’Opinió. {0} (REO 1151), pregunta P26. Encuesta de opinión.',
  'datos-globales.fuentes.decada-digital':
    'Decisión (UE) 2022/2481 del Parlamento Europeo y del Consejo, de 14 de diciembre de 2022, por la que se establece el programa estratégico de la Década Digital para 2030 (DO L 323 de 19/12/2022), artículo 4, «Metas digitales».',
  'datos-globales.fuentes.tic-h':
    'Idescat, a partir de la encuesta TIC-H del INE. {0}, tablas 3.4.1 y 3.4.2 («IA generativa»). Publicación: {1}.',
  'datos-globales.fuentes.clima': 'Idescat. {0}, módulo «Intel·ligència artificial», 2.º trimestre de 2024.',
  'datos-globales.fuentes.consultadas': 'Fecha de consulta: {fecha}.',
  'datos-globales.fuentes.licencias':
    'Eurostat y la Comisión Europea (Decisión 2011/833/UE) permiten reutilizar sus datos citando la fuente; el Idescat, citando «Font: Idescat»; el CEO, con la Llicència oberta d’ús d’informació – Catalunya, citándolo y enlazando con la licencia.',
  'globo.descripcion': 'Globo terráqueo con la imagen de satélite de la NASA. Territorio elegido: {territorio}.',
  'globo.descripcion.ninguno': 'Globo terráqueo con la imagen de satélite de la NASA. Ningún territorio elegido.',
  'globo.mandos': 'Mover el globo',
  'globo.mando.izquierda': 'Girar a la izquierda',
  'globo.mando.derecha': 'Girar a la derecha',
  'globo.mando.arriba': 'Girar hacia arriba',
  'globo.mando.abajo': 'Girar hacia abajo',
  'globo.mando.centrar': 'Volver a mi país',
  'globo.vista-plana': 'Vista plana: este navegador no dibuja el globo en 3D.',
  'globo.mando.acercar': 'Acercar',
  'globo.mando.alejar': 'Alejar',
  'datos-globales.pestanas.nombre': 'Páginas de Datos globales',
  'datos-globales.pestanas.paises': 'Cataluña',
  'datos-globales.pestanas.ue': 'Unión Europea',
  'datos-globales.pestanas.mundo': 'El mundo',
  'datos-globales.ue.titulo-pagina': 'Unión Europea · Datos globales · Faro',
  'datos-globales.ue.descripcion':
    'Datos globales: la IA en el trabajo en la Unión Europea, los 27 países juntos, con estadísticas oficiales, cada cifra con su fuente y su año.',
  'datos-globales.ue.fuentes.licencias':
    'Eurostat y la Comisión Europea (Decisión 2011/833/UE) permiten reutilizar sus datos citando la fuente.',
  'datos-globales.mundo.titulo-pagina': 'El mundo · Datos globales · Faro',
  'datos-globales.mundo.descripcion':
    'Datos globales: la IA en el mundo, país por país, con estadísticas oficiales, cada cifra con su fuente y su año.',
  'datos-globales.mundo.titulo': 'El trabajo en el mundo',
  'datos-globales.mundo.entradilla':
    'La IA en cada país: cuánto se usa, donde una estadística oficial lo mide. Gira el globo o busca tu país.',
  'datos-globales.mundo.creditos': 'Fuentes y licencias de estas cifras:',
  'datos-globales.mundo.creditos.enlace': 'Créditos · Datos globales',
  'globo.panel.ia': 'La IA en {territorio}',
  'globo.instrucciones':
    'Cada marca es un país o una región con datos: púlsala para ver su ficha. La del país elegido es amarilla y más grande. Arrastra el globo para girarlo; con el teclado: flechas, + y −.',
  'globo.sin-webgl': 'Este navegador no puede dibujar el globo. El selector de país y la ficha funcionan igual.',
  'globo.no-carga': 'No se ha podido cargar el globo. El selector de país y la ficha funcionan igual.',
  'globo.sin-datos': 'Faro no tiene datos de este país. Los que tienen datos están en «Escribe o elige tu país».',
  'globo.buscar': 'Escribe o elige tu país',
  'globo.selector.abrir': 'Ver todos los países',
  'globo.selector.lista': 'Países y regiones con datos',
  'globo.selector.region': '(región de España)',
  'globo.selector.ninguno': 'Ningún país con datos se llama así.',
  'globo.panel.anuncio': 'Ficha del país: {territorio}.',
  'globo.panel.anuncio-region': 'Ficha de la región: {territorio}.',
  'globo.ficha.antetitulo': 'Ficha del país',
  'globo.ficha.antetitulo-region': 'Ficha de la región',
  'globo.ficha.sin-dato.titulo': 'Sin dato para {territorio}',
  'globo.ficha.sin-dato.nota':
    'Para estas cifras, el globo usa en cada país la base de toda la población de 16 a 74 años (Eurostat) o los datos de la OIT, que no se publican para Cataluña. No se pone en su lugar la cifra de España. Las del Idescat para Cataluña, con la base de quienes usan internet, están en «Cataluña».',
  'globo.ficha.datos': 'Últimos datos: {anios} · {fuentes}',
  'globo.ficha.anios': '{desde} a {hasta}',
  'globo.ficha.cualquier-uso': 'Para cualquier uso',
  'globo.ficha.para-trabajar': 'Para trabajar',
  'globo.ficha.empresas.titulo': 'Empresas que usan IA',
  'globo.ficha.empresas.frase': 'De cada 100 empresas con 10 o más trabajadores, {n} usan IA ({anio}).',
  'globo.ficha.empresas.grafico': 'Empresas con 10 o más trabajadores que usan IA, de cada 100',
  'globo.ficha.personas.titulo': 'Personas que usan IA generativa',
  'globo.ficha.personas.frase':
    'De cada 100 personas de 16 a 74 años, {n} usaron IA generativa en los últimos tres meses ({anio}).',
  'globo.ficha.personas.frase-trabajo':
    'De cada 100 personas de 16 a 74 años, {n} usaron IA generativa en los últimos tres meses y {trabajo} la usaron para trabajar ({anio}).',
  'globo.ficha.personas.grafico': 'Personas de 16 a 74 años que usaron IA generativa, de cada 100',
  'globo.ficha.genero.titulo': 'Mujeres y hombres',
  'globo.ficha.genero.frase':
    'De cada 100 mujeres de 16 a 74 años, {a} usaron IA generativa; de cada 100 hombres, {b} ({anio}).',
  'globo.ficha.genero.grafico': 'Mujeres y hombres de 16 a 74 años que usaron IA generativa, de cada 100 de cada sexo',
  'globo.ficha.trabajo.titulo': 'Según el tipo de trabajo',
  'globo.ficha.trabajo.frase':
    'De cada 100 personas con trabajos no manuales, {a} usaron IA generativa para trabajar; con trabajos manuales, {b} ({anio}).',
  'globo.ficha.trabajo.grafico': 'Personas ocupadas que usaron IA generativa para trabajar, de cada 100 de cada grupo',
  'globo.ficha.trabajo.no-manual': 'Trabajos no manuales',
  'globo.ficha.trabajo.manual': 'Trabajos manuales',
  'globo.ficha.trabajo.tic': 'Profesionales de las TIC',
  'globo.ficha.nacional.titulo': 'Empresas que usan IA, según la estadística del país',
  'globo.ficha.nacional.frase': 'De cada 100 empresas, {n} usan IA según la encuesta nacional ({anio}).',
  'globo.ficha.nacional.grafico': 'Empresas que usan IA según la encuesta nacional, de cada 100',
  'globo.ficha.nacional-personas.titulo': 'Personas que han usado IA generativa, según la estadística del país',
  'globo.ficha.nacional-personas.frase':
    'De cada 100 personas, {n} han usado alguna vez IA generativa según la encuesta nacional ({anio}).',
  'globo.ficha.exposicion.titulo': 'Exposición a la IA generativa (calculada)',
  'globo.ficha.exposicion.alta':
    'De cada 100 personas ocupadas, {n} trabajan en ocupaciones con exposición alta a la IA generativa según el índice de la OIT ({anio}).',
  'globo.ficha.exposicion.alta.cotas':
    'De cada 100 personas ocupadas, entre {inferior} y {superior} trabajan en ocupaciones con exposición alta a la IA generativa según el índice de la OIT ({anio}).',
  'globo.ficha.exposicion.alguna':
    'Con alguna exposición a la IA generativa, la que sea, trabajan {n} de cada 100 ({anio}).',
  'globo.ficha.exposicion.alguna.cotas':
    'Con alguna exposición a la IA generativa, la que sea, trabajan entre {inferior} y {superior} de cada 100 ({anio}).',
  'globo.ficha.exposicion.intervalo':
    'Calculada con una encuesta: con un 95 % de confianza, está entre {desde} y {hasta}.',
  'globo.ficha.exposicion.sin-correspondencia':
    'El {parte} % del empleo no se puede asignar con exactitud a una ocupación del índice: por eso se da entre qué cifras está.',
  'globo.ficha.exposicion.nota':
    'Es la exposición de las ocupaciones por sus tareas, calculada: no es el uso de la IA ni una predicción de empleos perdidos o creados.',
  'globo.ficha.empleo.resumen':
    'El grupo de ocupaciones más numeroso es «{grupo}»: {n} de cada 100 personas que trabajan ({anio}).',
  'globo.ficha.empleo.titulo': 'Cómo se reparte el empleo',
  'globo.ficha.empleo.grupos': 'Personas que trabajan, por grupo de ocupación',
  'globo.ficha.empleo.mujeres.titulo': 'Mujeres en cada grupo de ocupación',
  'globo.ficha.empleo.grafico': 'De cada 100 personas que trabajan, cuántas hay en cada gran grupo de ocupación',
  'globo.ficha.empleo.mujeres': 'De cada 100 personas de cada gran grupo, cuántas son mujeres',
  'globo.ficha.empleo.grupo.1': 'Directores y gerentes',
  'globo.ficha.empleo.grupo.2': 'Científicos e intelectuales',
  'globo.ficha.empleo.grupo.3': 'Técnicos de nivel medio',
  'globo.ficha.empleo.grupo.4': 'Apoyo administrativo',
  'globo.ficha.empleo.grupo.5': 'Servicios y comercio',
  'globo.ficha.empleo.grupo.6': 'Agricultura, bosques y pesca',
  'globo.ficha.empleo.grupo.7': 'Oficios y artesanía',
  'globo.ficha.empleo.grupo.8': 'Operadores de máquinas',
  'globo.ficha.empleo.grupo.9': 'Ocupaciones elementales',
  // ---------- Declaración de accesibilidad (accesibilidad.html) ----------
  'accesibilidad.titulo': 'Accesibilidad · Faro',
  'accesibilidad.descripcion': 'Declaración de accesibilidad de Faro: hasta dónde cumple, qué falta y cómo avisarnos.',
  'accesibilidad.rotulo': 'Accesibilidad',
  'accesibilidad.titulo-principal': 'Declaración de accesibilidad',
  'accesibilidad.intro':
    'Faro quiere que lo pueda usar cualquier persona y se compromete a hacerlo accesible de conformidad con el Real Decreto 1112/2018, de 7 de septiembre, sobre accesibilidad de los sitios web y aplicaciones para dispositivos móviles del sector público. Esta declaración vale para esta web y para la aplicación que se instala desde ella, que es la misma.',
  'accesibilidad.situacion.titulo': 'Situación de cumplimiento',
  'accesibilidad.situacion.texto':
    'Faro es parcialmente conforme con el Real Decreto 1112/2018, por las faltas de conformidad que se enumeran abajo y porque falta la revisión con personas que usan lectores de pantalla y otras ayudas técnicas. La referencia es el nivel AA de las Pautas de Accesibilidad para el Contenido Web (WCAG) 2.2 y la norma EN\u00a0301\u00a0549\u00a0V4.1.1.',
  'accesibilidad.contenido.titulo': 'Contenido no accesible',
  'accesibilidad.contenido.intro': 'Falta de conformidad con los requisitos, y su alternativa cuando la hay:',
  'accesibilidad.contenido.pdf':
    'El informe se puede leer con lector de pantalla en la propia página y descargar en PDF. Ese PDF, y el de la hoja de ruta, los crea el navegador al imprimir: Faro no puede garantizar que salgan etiquetados para lectores de pantalla (EN\u00a0301\u00a0549, capítulo 10). Alternativa: el informe en la propia página y la hoja de ruta en HTML, con el mismo contenido.',
  'accesibilidad.preparacion.titulo': 'Preparación de esta declaración',
  'accesibilidad.preparacion.texto':
    'Esta declaración se preparó el 10 de octubre de 2026 con una evaluación propia del equipo de Faro, sin auditoría externa: revisión del código de la web criterio a criterio y comprobaciones automáticas de la estructura de cada página (idioma, título, encabezado principal, enlace para saltar al contenido, etiquetas de los campos, textos alternativos de las imágenes y referencias internas). Falta la revisión manual con lectores de pantalla, ampliadores y control por voz. Última revisión: 10 de octubre de 2026.',
  'accesibilidad.contacto.titulo': 'Observaciones y datos de contacto',
  'accesibilidad.contacto.texto':
    'Para avisar de una dificultad de accesibilidad, pedir información en un formato accesible o presentar una queja, escribe a {0}.',
  'accesibilidad.reclamacion.titulo': 'Procedimiento de aplicación',
  'accesibilidad.reclamacion.texto': 'Puedes dirigir una reclamación sobre accesibilidad a {0}.',
  'informacion-y-creditos.datos.avisos':
    'Para detectar fallos de carga y de seguridad, Faro recibe avisos técnicos del navegador. Conserva el tipo, un código de una lista limitada, el origen de la web y la hora aproximada; no conserva la ruta, el texto del recorrido ni el contenido libre del aviso.',
  'informacion-y-creditos.alojamiento.titulo': 'Cuando te conectas a la web',
  'informacion-y-creditos.alojamiento.texto':
    'El servicio de alojamiento recibe la dirección IP y datos técnicos de la conexión necesarios para entregar las páginas y proteger el servicio. En las instalaciones alojadas en Cloudflare, ese tratamiento se describe en su {0}. El texto del recorrido se procesa en el dispositivo y no se envía al alojamiento.',
  'informacion-y-creditos.alojamiento.enlace': 'política de privacidad',
  'informacion-y-creditos.servicios.titulo': 'Conexiones de instituciones y asistentes',
  'informacion-y-creditos.servicios.texto':
    'Cuando se habilita la conectividad, Faro registra las consultas institucionales: fecha, institución, operación y resultado. Las consultas de asistentes y agentes se cuentan por día y operación; el nombre del asistente es declarado, no una identidad verificada. Este registro no guarda los argumentos, las cabeceras ni las direcciones IP y conserva hasta 10.000 filas durante un máximo de 30 días.',
  'informacion-y-creditos.servicios.acceso':
    'Para gestionar el acceso institucional, el panel conserva el nombre de la entidad, su correo de contacto si se facilita, el estado de su acceso y las huellas de las credenciales. Las invitaciones caducan a los siete días. Las claves secretas se muestran una sola vez y no se guardan en claro.',
  'informacion-y-creditos.derechos.titulo': 'Control y derechos',
  'informacion-y-creditos.derechos.texto':
    'El botón «Borrar todo» elimina los datos que Faro guarda en este navegador; no elimina los PDF que hayas guardado ni los registros del alojamiento. Puedes dirigirte a la entidad responsable para ejercer los derechos de acceso, rectificación, supresión, oposición, limitación y portabilidad cuando correspondan, y reclamar ante la autoridad de protección de datos competente. Consulta la {0}.',
  'informacion-y-creditos.derechos.enlace': 'información de la AEPD sobre estos derechos',
};
