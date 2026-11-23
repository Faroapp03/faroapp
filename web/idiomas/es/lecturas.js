// Textos de Guías y Biblioteca en castellano, incorporados al diccionario de es.js.
// El tramo entre marcas lo genera `node herramientas/web/lecturas.ts` desde datos/lecturas.json.
// No se edita a mano ese tramo.

/**
 * Diccionario de solo lectura (clave -> texto) en castellano con los textos de Guías y Biblioteca.
 * @type {Readonly<Record<string, string>>}
 */
export const TEXTOS_LECTURAS = {
  // ---------- Guías y Biblioteca: lo escribe herramientas/web/lecturas.ts ----------
  'biblioteca.antetitulo': 'Lecturas e informes',
  'biblioteca.aviso':
    'Selección del Equipo Faro, revisada el 7/10/2026. Ninguna de estas entidades ha revisado Faro ni lo respalda. Los resúmenes son nuestros: ante cualquier duda, vale el documento original.',
  'biblioteca.comprobado': 'Comprobado: {fecha}',
  'biblioteca.comprobado-con-incidencia':
    'Comprobado: {fecha}. En la última revisión, este enlace no respondió como se esperaba. Si no se abre, busca el documento por su título en la web de la fuente.',
  'biblioteca.cuenta': 'Se muestran {vistas} de {total} lecturas.',
  'biblioteca.descripcion':
    'Biblioteca de Faro: lecturas cortas e informes sobre la IA y el trabajo, cada uno con su fuente, su fecha y un resumen propio.',
  'biblioteca.enlace-incidencia':
    'En la última revisión, este enlace no respondió como se esperaba. Si no se abre, busca el documento por su título en la web de la fuente.',
  'biblioteca.enlace-no-disponible': 'Enlace no disponible',
  'biblioteca.entradilla':
    'Lecturas cortas e informes sobre la IA y el trabajo, de fuentes oficiales y de investigación.',
  'biblioteca.filtrar-por': 'Filtrar por',
  'biblioteca.filtros': 'Filtrar la biblioteca',
  'biblioteca.pagina': 'Página {numero} de {total}',
  'biblioteca.paginas': 'Páginas',
  'biblioteca.quitar-filtros': 'Quitar filtros',
  'biblioteca.recuento': '{total} lecturas',
  'biblioteca.recuento-parcial': '{vistas} de {total} lecturas',
  'biblioteca.segmentos': 'Apartados de la biblioteca',
  'biblioteca.tipos.guia': 'Guías',
  'biblioteca.tipos.nota': 'Notas',
  'biblioteca.titulo': 'Biblioteca · Faro',
  'biblioteca.todos': 'Todos',
  'guias.aviso':
    'Selección del Equipo Faro, revisada el 7/10/2026. Ninguna de las entidades citadas ha revisado Faro ni lo respalda. Las guías dan información general: no son asesoramiento jurídico.',
  'lecturas.abre.pagina-faro': 'Página de Faro',
  'lecturas.adopcion-ia-empresas-espanolas-banco-espana.interes':
    'Da la visión de las empresas, útil para contrastarla con la de las personas trabajadoras. Usa vocabulario económico.',
  'lecturas.adopcion-ia-empresas-espanolas-banco-espana.resumen':
    'Artículo del Boletín Económico del Banco de España basado en su encuesta a empresas: casi el 20 % usa sistemas de IA, la mayoría aún en pruebas. El principal obstáculo es la falta de personal cualificado, seguido de los costes y la falta de datos. El 80 % de las empresas cree que la IA no afectará a su empleo.',
  'lecturas.adopcion-ia-empresas-espanolas-banco-espana.titulo':
    'Cómo adoptan la IA las empresas españolas (Banco de España, 2025)',
  'lecturas.anonimitzar-actes-amb-ia-aoc.interes':
    'Muestra cómo puede cambiar una tarea administrativa real y por qué la última decisión sigue siendo de una persona. Es una prueba de la propia entidad, no una evaluación independiente.',
  'lecturas.anonimitzar-actes-amb-ia-aoc.resumen':
    'El Consorcio AOC explica una prueba de IA generativa que propone qué datos personales ocultar en las actas de los plenos municipales, teniendo en cuenta el contexto. Una persona revisa y corrige la propuesta antes de publicar. En 52 actas de 9 ayuntamientos, el 96 % de lo que marcó estaba bien marcado.',
  'lecturas.anonimitzar-actes-amb-ia-aoc.titulo':
    'IA para ocultar datos personales en actas municipales, con revisión humana',
  'lecturas.barometre-de-la-innovacio-a.interes': 'Indica hacia dónde se mueven las empresas de tu entorno.',
  'lecturas.barometre-de-la-innovacio-a.resumen':
    'Encuesta de ACCIÓ, la agencia de la Generalitat para la competitividad de la empresa, sobre innovación y transformación digital de las empresas catalanas. El 30,4 % de las empresas de más de nueve personas trabajadoras invirtió en IA en 2025, frente al 24,0 % en 2024.',
  'lecturas.bones-practiques-xatbot-ia-generativa-aoc.interes':
    'Muestra qué controles debería tener un chatbot de atención a la ciudadanía. Está escrita para quien lo implanta y usa términos técnicos.',
  'lecturas.bones-practiques-xatbot-ia-generativa-aoc.resumen':
    'Guía del Consorcio Administración Abierta de Cataluña (AOC) para administraciones que quieren un chatbot de atención: elegir la solución, cumplir los requisitos, diseñarlo, protegerlo, entrenarlo y evaluarlo. Se basa en la experiencia de la propia entidad.',
  'lecturas.bones-practiques-xatbot-ia-generativa-aoc.titulo':
    'Buenas prácticas para poner en marcha un chatbot con IA generativa',
  'lecturas.brecha-digital-genero-ontsi-2026.interes':
    'Da los datos oficiales de la brecha digital por género y por edad: entre las personas de 75 años o más, las mujeres que nunca han usado internet son el 53 %. Es una brecha de uso, no de capacidad. Las páginas 2 y 3 resumen lo principal.',
  'lecturas.brecha-digital-genero-ontsi-2026.resumen':
    'Informe del Observatorio Nacional de Tecnología y Sociedad (ONTSI) que compara a mujeres y hombres en uso de internet, competencias digitales, estudios, empleo y seguridad, con datos de 2025. El 39,9 % de los hombres y el 35,9 % de las mujeres usaron IA generativa en los tres últimos meses, y ellas son más cautas ante sus riesgos. Las mujeres son el 19,6 % de las personas especialistas digitales.',
  'lecturas.brecha-digital-genero-ontsi-2026.titulo': 'Brecha digital de género en España (ONTSI, edición 2026)',
  'lecturas.brecha-digital-ia-resumen-ugt.interes':
    'Muestra que la edad, los estudios y el género pesan en quién aprende a usar la IA. Es la entrada corta al informe completo del sindicato.',
  'lecturas.brecha-digital-ia-resumen-ugt.resumen':
    'Resumen ejecutivo del informe del Servicio de Estudios de UGT sobre brecha digital e IA. Con datos del INE, el 37,9 % de la población usa IA generativa y más de 23 millones de personas no la usan. Entre quienes no la usan, el 55,5 % son mujeres y la edad media es de 56 años; la diferencia por nivel de estudios supera los 50 puntos.',
  'lecturas.brecha-digital-ia-resumen-ugt.titulo': 'Quién se queda fuera de la IA: resumen del informe de UGT',
  'lecturas.chatbots-demasiada-confianza-cuando-se-equivocan.interes':
    'Recuerda que una respuesta dicha con seguridad no es una respuesta comprobada. Son versiones de 2025: las cifras no valen para todas las herramientas actuales.',
  'lecturas.chatbots-demasiada-confianza-cuando-se-equivocan.resumen':
    'Noticia sobre un estudio de la Universidad Carnegie Mellon (Estados Unidos) que comparó a personas y a cuatro modelos de lenguaje en tareas como preguntas de cultura general. Todos sobrestimaron sus aciertos, pero solo las personas corrigieron su confianza después de fallar.',
  'lecturas.chatbots-demasiada-confianza-cuando-se-equivocan.titulo':
    'Los chatbots se equivocan con demasiada seguridad',
  'lecturas.como-implanta-algoritmos-un-ayuntamiento.interes':
    'Enseña qué garantías deberían acompañar el uso público de algoritmos.',
  'lecturas.como-implanta-algoritmos-un-ayuntamiento.resumen':
    'Protocolo del Ayuntamiento de Barcelona que recorre, paso a paso, la vida de un sistema algorítmico municipal, de la idea a su retirada: evaluación de impacto, transparencia, contratación, calidad de los datos y supervisión. Es de 2022, anterior a la ley europea de IA.',
  'lecturas.como-implanta-algoritmos-un-ayuntamiento.titulo':
    'Cómo implanta algoritmos un ayuntamiento: método y protocolos',
  'lecturas.consells-ciberseguretat-gent-gran.interes':
    'Es un buen punto de partida si te cuesta moverte por internet o si quieres ayudar a una persona mayor de tu entorno.',
  'lecturas.consells-ciberseguretat-gent-gran.resumen':
    'Página de la Agència de Ciberseguretat de Catalunya con consejos para personas mayores: no dar datos personales por teléfono ni por internet, usar contraseñas fuertes, comprar con seguridad, configurar el móvil y detectar noticias falsas e imágenes creadas con IA. Incluye infografías y vídeos cortos. Nombra algunos servicios comerciales.',
  'lecturas.consells-ciberseguretat-gent-gran.titulo': 'Consejos de seguridad digital para personas mayores',
  'lecturas.dades-compartides-ia-agencia-ciberseguretat.interes':
    'Te da cuatro gestos sencillos para proteger tus datos al usar un chatbot. Repite parte del decálogo de la AEPD, pero añade el control de permisos y del historial.',
  'lecturas.dades-compartides-ia-agencia-ciberseguretat.resumen':
    'Página de la Agència de Ciberseguretat de Catalunya: explica qué datos recogen las aplicaciones de IA (personales, de ubicación, lo que escribes y subes, datos técnicos) y sus riesgos, como perfiles, filtraciones o suplantación. Termina con cuatro consejos: no compartir datos personales, valorar desactivar el historial, revisar lo que ya has compartido y controlar los permisos de las aplicaciones.',
  'lecturas.dades-compartides-ia-agencia-ciberseguretat.titulo': 'Qué datos guarda la IA y cómo protegerlos',
  'lecturas.de-los-chatbots-a-las.interes':
    'Ayuda a valorar una herramienta nueva por cómo cambia tus condiciones de trabajo.',
  'lecturas.de-los-chatbots-a-las.resumen':
    'Resume una revisión de estudios sobre la IA en el trabajo: usos que previenen riesgos y problemas como la vigilancia, la opacidad o la falta de formación.',
  'lecturas.de-los-chatbots-a-las.titulo': 'De los chatbots a las cadenas de montaje: IA y seguridad laboral',
  'lecturas.derecho-revision-humana-decisiones-automatizadas.interes':
    'Te dice cuándo puedes pedir que intervenga una persona, dar tu punto de vista e impugnar la decisión. Es de 2024, anterior al Real Decreto 723/2026.',
  'lecturas.derecho-revision-humana-decisiones-automatizadas.resumen':
    'Página de la AEPD sobre el derecho a no ser objeto de decisiones basadas solo en un tratamiento automático de tus datos, incluidos los perfiles, cuando te afectan de forma importante; cita como ejemplo el rendimiento en el trabajo. Explica las excepciones y enlaza un formulario para ejercerlo.',
  'lecturas.derecho-revision-humana-decisiones-automatizadas.titulo':
    'Tu derecho a que una persona revise una decisión automática',
  'lecturas.detectar-noticies-falses-agencia-ciberseguretat.interes':
    'Te da una rutina corta para comprobar una noticia antes de compartirla.',
  'lecturas.detectar-noticies-falses-agencia-ciberseguretat.resumen':
    'Página de la Agència de Ciberseguretat de Catalunya sobre la desinformación: por qué cuesta detectarla y cinco pasos para comprobar una noticia, como mirar la fuente, leer el texto entero, buscar otras fuentes y fijarse en imágenes que pueden estar manipuladas con IA. Cita extensiones comerciales del navegador como ejemplo.',
  'lecturas.detectar-noticies-falses-agencia-ciberseguretat.titulo': 'Cómo detectar una noticia falsa',
  'lecturas.detectar-sesgos-respuestas-ia-ehu.interes':
    'Te da preguntas concretas para revisar una respuesta de la IA antes de usarla, por ejemplo en una oferta de empleo. No trata solo los sesgos de género.',
  'lecturas.detectar-sesgos-respuestas-ia-ehu.resumen':
    'Página de la UPV/EHU con estrategias sencillas para reconocer sesgos: fijarse en si los ejemplos repiten siempre el mismo perfil de género, edad o cultura, buscar estereotipos en los papeles profesionales, pedir la misma respuesta desde otras perspectivas y comparar varias respuestas.',
  'lecturas.detectar-sesgos-respuestas-ia-ehu.titulo': 'Cómo detectar sesgos en las respuestas de la IA',
  'lecturas.detectar-y-reducir-alucinaciones-ia.interes':
    'Te ayuda a no fiarte de una respuesta solo porque suena convincente. Los ejemplos son de la universidad, pero sirven para cualquier trabajo.',
  'lecturas.detectar-y-reducir-alucinaciones-ia.resumen':
    'La Universidad del País Vasco (UPV/EHU) explica que la IA puede escribir con seguridad algo falso, lo que se llama «alucinación». Da señales para sospechar, como cifras muy precisas sin fuente o respuestas que cambian al repetir la pregunta, y siete hábitos, como pedirle que no invente y comprobar a mano lo importante.',
  'lecturas.detectar-y-reducir-alucinaciones-ia.titulo': 'Cómo detectar y reducir los errores inventados de la IA',
  'lecturas.dones-en-les-tic-2025.interes':
    'Da los datos de Cataluña sobre la brecha de género en el uso de la IA. El apartado de IA está en las páginas 17 a 19.',
  'lecturas.dones-en-les-tic-2025.resumen':
    'Dosier estadístico del Institut Català de les Dones sobre mujeres y tecnología en Cataluña: uso de internet, formación, empleo, investigación y ciberseguridad. En 2025 usó la IA generativa el 49 % de los hombres y el 42,9 % de las mujeres de 16 a 74 años; entre quienes no la usan, a ellas les preocupan más la privacidad y la seguridad.',
  'lecturas.dones-en-les-tic-2025.titulo': 'Mujeres en las TIC 2025: datos de Cataluña',
  'lecturas.en-esta-pestana': 'en esta pestaña',
  'lecturas.en-otra-pestana': 'en otra pestaña',
  'lecturas.estafas-fraudes-financieros-ia-autoridades-europeas.interes':
    'Es una lista práctica para reconocer un fraude hecho con IA, incluso si parece venir de tu banco o de alguien que conoces. Se centra en el dinero, no en el trabajo.',
  'lecturas.estafas-fraudes-financieros-ia-autoridades-europeas.resumen':
    'Folleto de las tres autoridades financieras europeas (bancaria, de seguros y de valores), que publica en castellano la Comisión Nacional del Mercado de Valores (CNMV). Da una lista de señales de alerta, como voces o vídeos falsos y prisas por pagar, pasos para protegerte, como verificar por un canal conocido o acordar una palabra de seguridad en la familia, y qué hacer si ya te han estafado.',
  'lecturas.estafas-fraudes-financieros-ia-autoridades-europeas.titulo':
    'Estafas financieras con IA: señales de alerta y cómo protegerte',
  'lecturas.estafes-amb-intelligencia-artificial-consells.interes':
    'Sirve para reconocer una llamada o un vídeo falso que pide dinero o datos, también si parece venir de alguien de tu empresa.',
  'lecturas.estafes-amb-intelligencia-artificial-consells.resumen':
    'La Agència de Ciberseguretat de Catalunya explica cómo se usa la IA para estafar: voces y vídeos falsos, mensajes personalizados con datos de las redes sociales e identidades inventadas. Da consejos como desconfiar de las prisas, comprobarlo por otra vía con la persona implicada y no compartir datos biométricos.',
  'lecturas.estafes-amb-intelligencia-artificial-consells.titulo':
    'Estafas con inteligencia artificial: cómo evitarlas',
  'lecturas.estereotipos-de-genero-en-los.interes':
    'Muestra que los modelos de lenguaje pueden repetir estereotipos de género en los textos que escriben. El estudio usó modelos anteriores a 2024; los actuales pueden comportarse de otra manera.',
  'lecturas.estereotipos-de-genero-en-los.resumen':
    'Comunicado de la UNESCO (7/3/2024) sobre su estudio de varios modelos de lenguaje: encontró que asociaban a las mujeres con palabras como «hogar» y «familia», y a los hombres con «negocios», «salario» o «carrera». El informe completo está en inglés.',
  'lecturas.estereotipos-de-genero-en-los.titulo': 'Estereotipos de género en los modelos de lenguaje',
  'lecturas.eurobarometro-ia-lugar-de-trabajo.interes':
    'Muestra que mucha gente acepta la IA en el trabajo, pero pide reglas claras. Son opiniones, no datos sobre su uso real.',
  'lecturas.eurobarometro-ia-lugar-de-trabajo.resumen':
    'Nota de prensa de la Comisión Europea con los resultados de una encuesta Eurobarómetro de 2025: más del 60 % de las personas en Europa ve con buenos ojos los robots y la IA en el trabajo, y el 84 % cree que hace falta gestionarla con cuidado para proteger la privacidad y ser transparentes.',
  'lecturas.eurobarometro-ia-lugar-de-trabajo.titulo':
    'Qué opina la gente en Europa de la IA en el trabajo (Eurobarómetro 2025)',
  'lecturas.formato.web': 'Página web',
  'lecturas.gestionar-personas-con-ia-oit.interes':
    'Te ayuda a preguntar qué mide de verdad un filtro de candidaturas o una evaluación automática.',
  'lecturas.gestionar-personas-con-ia-oit.resumen':
    'Artículo de una economista de la OIT sobre la IA en recursos humanos: contratación, salarios, horarios y evaluación del desempeño. Explica que un sistema funciona bien o mal según su objetivo, los datos con que aprende y cómo está programado, y da ejemplos de pruebas de selección que miden cosas dudosas.',
  'lecturas.gestionar-personas-con-ia-oit.titulo': 'Gestionar personas con IA: ¿funciona de verdad?',
  'lecturas.guia-practica-ejemplos-reglamento-ia-aesia.interes':
    'Los ejemplos acercan la ley a situaciones de trabajo reales. Complementa la introducción de la misma agencia.',
  'lecturas.guia-practica-ejemplos-reglamento-ia-aesia.resumen':
    'Guía de la Agencia Española de Supervisión de la Inteligencia Artificial (AESIA) para empresas que empiezan a conocer el Reglamento de IA. Explica sus obligaciones con ejemplos, como un sistema de identificación biométrica en el trabajo. Está actualizada tras el Ómnibus Digital y no es vinculante.',
  'lecturas.guia-practica-ejemplos-reglamento-ia-aesia.titulo': 'La ley europea de IA con ejemplos prácticos',
  'lecturas.guia-uso-seguro-ia-cyberzaintza.interes':
    'Sirve si en tu equipo hay que decidir cómo se usa la IA. Está pensada sobre todo para organizaciones, pero cada paso trae precauciones que también sirven a quien la usa a diario.',
  'lecturas.guia-uso-seguro-ia-cyberzaintza.resumen':
    'Guía del Centro Vasco de Ciberseguridad con cinco pasos para usar la IA de forma segura: regular su uso, inventariar los casos, analizar los riesgos, controlar el uso y evaluar los resultados. Avisa de riesgos como meter datos personales o confidenciales en herramientas no autorizadas, las respuestas inventadas y los sesgos. Declara que se escribió en parte con ayuda de IA y que la revisó el centro.',
  'lecturas.guia-uso-seguro-ia-cyberzaintza.titulo': 'Usar la IA con seguridad: cinco pasos',
  'lecturas.ia-brechas-genero-empleo-bie.interes':
    'Recuerda que la representación legal de la plantilla tiene derecho a conocer los criterios de los algoritmos (artículo 64.4.d del Estatuto de los Trabajadores). Las recomendaciones se dirigen a empresas y administraciones.',
  'lecturas.ia-brechas-genero-empleo-bie.resumen':
    'Boletín de Igualdad en el Empleo del Ministerio de Igualdad: revisa cómo la IA puede ampliar o reducir las desigualdades entre mujeres y hombres en el trabajo, por ejemplo en la selección y la evaluación. Repasa la normativa y recomienda evaluar el impacto de género antes de usar un sistema, auditar los algoritmos y formar en igualdad.',
  'lecturas.ia-brechas-genero-empleo-bie.titulo': 'Cómo afecta la IA a las brechas de género en el empleo',
  'lecturas.ia-empleo-personas-con-discapacidad-oit.interes':
    'Muestra cuándo una herramienta es un apoyo y cuándo puede crear una barrera nueva. Se dirige sobre todo a quien desarrolla, compra o regula estas herramientas.',
  'lecturas.ia-empleo-personas-con-discapacidad-oit.resumen':
    'Artículo de la OIT: herramientas como pasar texto a voz o subtitular en tiempo real ayudan a muchas personas con discapacidad, pero los sistemas que filtran candidaturas pueden excluirlas, por ejemplo si penalizan rostros o formas de hablar «no estándar». Pide incluirlas en el diseño de las herramientas y una revisión humana real de las decisiones.',
  'lecturas.ia-empleo-personas-con-discapacidad-oit.titulo':
    'La doble cara de la IA para el empleo de las personas con discapacidad',
  'lecturas.ia-en-la-seleccion-de.interes':
    'Ayuda a preguntar por los filtros automáticos que se usan al contratar o al promocionar.',
  'lecturas.ia-en-la-seleccion-de.resumen':
    'Especialistas de la UOC explican cómo los datos y los criterios de un filtro automático pueden repetir desigualdades entre mujeres y hombres, y qué garantías proponen.',
  'lecturas.ia-en-la-seleccion-de.titulo': 'IA en la selección de personal y discriminación de género',
  'lecturas.ia-generativa-empleo-oit-2025.interes':
    'Explica cómo se mide la exposición y sus límites: la propia OIT dice que busca la dirección del cambio, no cifras exactas.',
  'lecturas.ia-generativa-empleo-oit-2025.resumen':
    'Nota de investigación de la OIT, en castellano, que resume la actualización de su índice de exposición a la IA generativa: una de cada cuatro personas ocupadas en el mundo tiene un empleo con algún grado de exposición, pero la mayoría de los puestos se transformarán más que desaparecer, porque siguen necesitando a personas. La exposición es mayor en el empleo de las mujeres.',
  'lecturas.ia-generativa-empleo-oit-2025.titulo': 'IA generativa y empleo: la actualización de 2025 de la OIT',
  'lecturas.ia-gestion-trabajadores-salud-eu-osha.interes':
    'Da argumentos para pedir participación y prevención cuando llega a tu trabajo un sistema que organiza o controla tus tareas. Son 24 páginas de lenguaje técnico.',
  'lecturas.ia-gestion-trabajadores-salud-eu-osha.resumen':
    'Resumen en castellano de un informe de la Agencia Europea para la Seguridad y la Salud en el Trabajo (EU-OSHA). Los sistemas de IA que asignan tareas, vigilan o evalúan al personal pueden ayudar a controlar peligros, pero traen riesgos, sobre todo psicosociales. Propone diseñarlos con las personas trabajadoras, con transparencia y para apoyarlas, no para sustituirlas.',
  'lecturas.ia-gestion-trabajadores-salud-eu-osha.titulo':
    'IA para gestionar personal: riesgos para la salud y la seguridad en el trabajo',
  'lecturas.ia-homogeniza-lenguaje-sinc.interes':
    'Invita a revisar lo que la IA reescribe por ti, porque puede quitarle rasgos propios a tu texto. Los autores avisan de que esto puede afectar a las evaluaciones basadas en el lenguaje, también en la selección de personal. Usa términos técnicos.',
  'lecturas.ia-homogeniza-lenguaje-sinc.resumen':
    'Noticia sobre un estudio de la Universidad del Sur de California (Estados Unidos): analizó más de 880.000 textos y pidió a tres modelos de lenguaje que reescribieran miles de ellos. Los textos reescritos conservaban casi siempre el significado, pero perdían diferencias de estilo entre personas.',
  'lecturas.ia-homogeniza-lenguaje-sinc.titulo': 'Escribir con IA hace que los textos se parezcan más entre sí',
  'lecturas.ia-hospitales-limites-lectura-facil.interes':
    'Es una lectura muy corta y sencilla sobre una idea clave: la IA ayuda, pero una persona tiene que revisar su trabajo.',
  'lecturas.ia-hospitales-limites-lectura-facil.resumen':
    'Noticia en lectura fácil de Planeta Fácil, de Plena inclusión, con glosario: algunos hospitales usan programas de IA para revisar pruebas o valorar riesgos antes de una operación, pero los médicos deben revisar siempre lo que dicen. Es un resumen de una noticia de La Vanguardia.',
  'lecturas.ia-hospitales-limites-lectura-facil.titulo':
    'La IA ayuda en los hospitales, pero tiene límites (lectura fácil)',
  'lecturas.ia-mercado-trabajo-espana-funcas.interes':
    'Es una estimación española reciente que explica sus supuestos y sus límites. No es una predicción sobre ningún empleo concreto: los parámetros son supuestos tomados de otros estudios.',
  'lecturas.ia-mercado-trabajo-espana-funcas.resumen':
    'Documento de trabajo de Funcas, fundación de estudios económicos, que adapta un índice internacional de exposición a las ocupaciones españolas. Su modelo estima, a diez años, una destrucción bruta de 1,7 a 2,3 millones de empleos con una incertidumbre que el propio autor califica de «muy elevada», compensada en parte por nuevas ocupaciones y por la mejora de productividad de 2,8 a 3,5 millones de personas.',
  'lecturas.ia-mercado-trabajo-espana-funcas.titulo':
    'IA y mercado de trabajo en España: exposición, empleo y empresas',
  'lecturas.ia-mujeres-en-cifras-inmujeres-2026.interes':
    'Reúne en una página cómo usan y ven la IA mujeres y hombres. Los datos son de fuentes y años distintos (de 2019 a 2023) y no coinciden con los del INE de 2025: no los mezcles. Es una imagen, y los lectores de pantalla no leen su texto.',
  'lecturas.ia-mujeres-en-cifras-inmujeres-2026.resumen':
    'Infografía del Instituto de las Mujeres con datos de varias fuentes sobre la brecha de género en la IA. En 2023, el 42,1 % de la población en España había usado IA: el 38,6 % de las mujeres y el 45,9 % de los hombres. Las mujeres son el 19,5 % de las personas especialistas digitales y asocian más la IA con el desempleo (27,8 % frente a 19,0 %).',
  'lecturas.ia-mujeres-en-cifras-inmujeres-2026.titulo': 'Mujeres e inteligencia artificial, en cifras (2026)',
  'lecturas.ia-necessita-bones-dades-aoc.interes':
    'Explica por qué ordenar y revisar registros forma parte de usar bien la IA en una oficina. Usa términos técnicos como «metadatos» o «datos maestros».',
  'lecturas.ia-necessita-bones-dades-aoc.resumen':
    'Artículo del Consorcio AOC para ayuntamientos: antes de usar IA hay que saber qué problema se quiere resolver y qué datos se tienen. Explica cómo unos datos incompletos o mal descritos llevan a resultados equivocados y por qué la supervisión humana es una garantía, no un trámite. En parte presenta iniciativas de la Diputació de Barcelona y del propio AOC.',
  'lecturas.ia-necessita-bones-dades-aoc.titulo': 'La IA necesita buenos datos, no solo buenos algoritmos',
  'lecturas.ia-seleccion-personal-sesgos-genero.interes':
    'Está escrita para empresas, pero sus claves te sirven para saber si un proceso de selección con IA tiene en cuenta la igualdad, tanto si buscas empleo como si representas a la plantilla.',
  'lecturas.ia-seleccion-personal-sesgos-genero.resumen':
    'Hoja de recomendaciones de la Fundación Mujeres para empresas que usan IA al seleccionar personal, en tres momentos: antes (elegir la herramienta, revisar los datos e informar a la representación legal y a las candidaturas), durante (mantener la supervisión humana) y después (comparar los resultados de mujeres y hombres y corregir las diferencias injustificadas).',
  'lecturas.ia-seleccion-personal-sesgos-genero.titulo':
    'IA y selección de personal: claves para evitar los sesgos de género',
  'lecturas.ideas-equivocadas-sobre-la-ia.interes':
    'Ayuda a entender cómo piensa un regulador de protección de datos sobre la IA generativa. No es una guía para quien la usa.',
  'lecturas.ideas-equivocadas-sobre-la-ia.resumen':
    'Entrada del blog de la AEPD (11/3/2025) que traduce siete aclaraciones del regulador británico de protección de datos sobre la IA generativa; por ejemplo, que tratar datos «sin querer» sigue siendo tratarlos. Va dirigida a quienes desarrollan estos sistemas.',
  'lecturas.ideas-equivocadas-sobre-la-ia.titulo': 'Ideas equivocadas sobre la IA y los datos personales',
  'lecturas.idiomas.ca': 'Catalán',
  'lecturas.idiomas.es': 'Castellano',
  'lecturas.idiomas.es-ca': 'Castellano y catalán',
  'lecturas.impacte-ia-generativa-mercat-laboral-cambra.interes':
    'Es el estudio que mejor describe las ocupaciones administrativas en Cataluña. Su indicador mide el potencial de transformación, no el riesgo de perder el empleo.',
  'lecturas.impacte-ia-generativa-mercat-laboral-cambra.resumen':
    'Estudio del Observatorio Mujer, Empresa y Economía de la Cámara de Comercio de Barcelona. Mide, con datos del Censo y el método de la OIT, la exposición de 163 ocupaciones de Cataluña a la IA generativa. Las más expuestas se concentran en tareas administrativas y de gestión de la información, con mucha presencia de mujeres. Analiza también la contratación y los despidos colectivos entre 2023 y 2025.',
  'lecturas.impacte-ia-generativa-mercat-laboral-cambra.titulo':
    'El impacto de la IA generativa en el mercado laboral catalán, con perspectiva de género y edad',
  'lecturas.impacte-ia-mercat-laboral-presentacio-cambra.interes':
    'Es la entrada corta al estudio, con frases breves y gráficos. La exposición mide cuánto pueden cambiar las tareas, no el riesgo de perder el empleo; los datos del Censo son anteriores a la llegada de la IA generativa.',
  'lecturas.impacte-ia-mercat-laboral-presentacio-cambra.resumen':
    'Presentación de los resultados del estudio de la Cámara de Comercio de Barcelona (mayo de 2026). Con datos del Censo de 2021-2022 y el método de la OIT, el 26 % de las personas ocupadas en Cataluña tiene una exposición media o alta a la IA generativa: el 30 % de las mujeres y el 23 % de los hombres. Las ocupaciones más expuestas son administrativas y de atención al público, con mucha presencia de mujeres.',
  'lecturas.impacte-ia-mercat-laboral-presentacio-cambra.titulo':
    'La IA generativa y el empleo en Cataluña, por género y edad: los resultados',
  'lecturas.impacto-socioeconomico-laboral-cambio-tecnologico-ces.interes':
    'Es un análisis largo y en castellano que reúne varios puntos de vista. Conviene leer solo los apartados que te interesen.',
  'lecturas.impacto-socioeconomico-laboral-cambio-tecnologico-ces.resumen':
    'Documento del Consejo Económico y Social (CES), órgano en el que participan sindicatos, organizaciones empresariales y otras entidades. Analiza los efectos de la IA en la economía, el empleo, el diálogo social y la negociación colectiva y la protección social, con un apartado sobre los sesgos de género.',
  'lecturas.impacto-socioeconomico-laboral-cambio-tecnologico-ces.titulo':
    'El impacto económico, laboral y social de la IA (CES, 2025)',
  'lecturas.indicadores-uso-ia-espana-ontsi-2026.interes':
    'Reúne en un documento los datos oficiales sobre empresas y personas, con comparaciones internacionales. Tiene muchas tablas y gráficos; las páginas 4 y 5 resumen lo principal.',
  'lecturas.indicadores-uso-ia-espana-ontsi-2026.resumen':
    'Informe del Observatorio Nacional de Tecnología y Sociedad (ONTSI) con datos de 2025: el 20,5 % de las empresas de 10 o más personas empleadas usa IA, por encima de la media de la Unión Europea y de la OCDE, y el 55,2 % de quienes usan internet ha usado IA generativa. Recoge también qué opina la ciudadanía de su impacto.',
  'lecturas.indicadores-uso-ia-espana-ontsi-2026.titulo':
    'Indicadores de uso de la inteligencia artificial en España (2026)',
  'lecturas.ine-uso-ia-empresas-2025.interes':
    'Da una idea de cuántas empresas han empezado a usar IA. Habla de empresas, no de cuántas personas la usan en su puesto.',
  'lecturas.ine-uso-ia-empresas-2025.resumen':
    'Principales resultados de la encuesta del INE a empresas, publicados en su sección de prensa: en el primer trimestre de 2025, el 21,1 % de las empresas de 10 o más personas empleadas usaba inteligencia artificial, 8,7 puntos más que un año antes. El sector servicios es el que más la usa. Madrid, Cataluña y el País Vasco tienen el mayor uso de tecnologías digitales.',
  'lecturas.ine-uso-ia-empresas-2025.titulo': 'Cuántas empresas usan IA en España (INE, 2025)',
  'lecturas.ine-uso-tic-hogares-2025.interes':
    'Es la cifra oficial más reciente de uso de la IA en España, con la diferencia entre mujeres y hombres. Mide si se usa, no cómo de bien.',
  'lecturas.ine-uso-tic-hogares-2025.resumen':
    'Principales resultados de la encuesta del Instituto Nacional de Estadística (INE) de 2025, publicados en su sección de prensa: el 37,9 % de las personas de 16 a 74 años usó herramientas de IA generativa en los tres últimos meses; el 39,9 % de los hombres y el 35,9 % de las mujeres. También da el uso de internet y las habilidades digitales.',
  'lecturas.ine-uso-tic-hogares-2025.titulo': 'Cuánta gente usa la IA generativa en España (INE, 2025)',
  'lecturas.informacion-algoritmica-en-el-trabajo.interes':
    'Te da preguntas concretas cuando un algoritmo influye en tus horarios, tu sueldo o tu evaluación.',
  'lecturas.informacion-algoritmica-en-el-trabajo.resumen':
    'Qué información sobre los algoritmos de la empresa puede pedir la representación de la plantilla, con una lista de preguntas para hacerlo. Es anterior a la ley europea de IA.',
  'lecturas.informacion-algoritmica-en-el-trabajo.titulo': 'Información algorítmica en el trabajo: guía y herramienta',
  'lecturas.inteligencia-artificial-genero-trabajo-uclm.interes':
    'Analiza con perspectiva de género lo que pasa cuando un algoritmo organiza o evalúa el trabajo. Es un texto académico y largo.',
  'lecturas.inteligencia-artificial-genero-trabajo-uclm.resumen':
    'Artículo jurídico de una catedrática de Derecho del Trabajo de la Universidad de Castilla-La Mancha (UCLM). Explica por qué los algoritmos pueden repetir la discriminación de las mujeres (datos desiguales y equipos sobre todo masculinos) y qué efectos tiene la gestión del trabajo con algoritmos: evaluaciones sesgadas, control estricto y más dificultad para conciliar.',
  'lecturas.inteligencia-artificial-genero-trabajo-uclm.titulo': 'Inteligencia artificial, género y trabajo',
  'lecturas.interes': 'Por qué te puede interesar.',
  'lecturas.intervencion-sindical-en-la-gestion.interes':
    'Está escrita para quien representa a la plantilla: da señales y modelos de petición para cuando la empresa usa algoritmos. Es larga y jurídica.',
  'lecturas.intervencion-sindical-en-la-gestion.resumen':
    'Guía de CCOO para la representación sindical: explica qué es la gestión algorítmica, cómo puede discriminar y qué dicen las normas europeas y españolas. Tiene una parte práctica con señales para saber si la empresa usa IA y modelos de escrito para pedirle información. Edición actualizada en abril de 2026.',
  'lecturas.intervencion-sindical-en-la-gestion.titulo':
    'Intervención sindical en la gestión algorítmica (edición de 2026)',
  'lecturas.introduccion-ia-lectura-facil-plena-inclusion.interes':
    'Está en lectura fácil: frases cortas, palabras sencillas y definiciones al margen. Cuando habla de pérdida de empleo, ten en cuenta que los estudios miden tareas expuestas, no puestos que vayan a desaparecer.',
  'lecturas.introduccion-ia-lectura-facil-plena-inclusion.resumen':
    'Manual en lectura fácil, con frases cortas y palabras explicadas. Cuenta qué es la IA, para qué sirve, que también se equivoca, sus ventajas y desventajas, quién debe decidir y cómo pedirle cosas. Nombra programas comerciales como ejemplos.',
  'lecturas.introduccion-ia-lectura-facil-plena-inclusion.titulo':
    'Introducción a la inteligencia artificial, en lectura fácil',
  'lecturas.la-estrategia-de-barcelona-para.interes':
    'Explica qué puede exigir la ciudadanía a una institución que usa IA.',
  'lecturas.la-estrategia-de-barcelona-para.resumen':
    'Medida de gobierno del Ayuntamiento de Barcelona (abril de 2021) que fija cómo introducir algoritmos con garantías: derechos digitales, transparencia y participación. Incluye casos piloto y recomendaciones técnicas. Es anterior a la ley europea de IA y a la llegada de la IA generativa.',
  'lecturas.la-estrategia-de-barcelona-para.titulo': 'La estrategia de Barcelona para una IA municipal ética',
  'lecturas.la-exposicion-a-la-ia-2.interes': 'Aplica a España el método de la OIT con datos abiertos y en castellano.',
  'lecturas.la-exposicion-a-la-ia-2.resumen':
    'Boletín trimestral de Fedea y BBVA Research (septiembre de 2026). La primera parte repasa el empleo y el paro; la segunda aplica el índice de la OIT a las ocupaciones españolas: algo más del 30 % del empleo está en el grupo más expuesto, y desde 2022 el empleo ha crecido en todos los grupos. Los propios autores avisan de que son datos descriptivos, que no prueban causas.',
  'lecturas.la-exposicion-a-la-ia-2.titulo': 'La exposición a la IA en las ocupaciones españolas',
  'lecturas.la-ia-discrimina-por-edad.interes':
    'Ayuda a detectar prejuicios sobre lo que puedes aprender o hacer según tu edad. Son cinco herramientas: no demuestra que la IA ya no tenga sesgos de género.',
  'lecturas.la-ia-discrimina-por-edad.resumen':
    'Un estudio con participación de la Universitat Oberta de Catalunya (UOC) «entrevistó» a cinco chatbots con situaciones inventadas. Evitaban asignar papeles por género, pero no por edad: relacionaban a las personas mayores con ayuda y simplificación, y a las jóvenes con creatividad y aprendizaje.',
  'lecturas.la-ia-discrimina-por-edad.titulo': 'Los chatbots evitan más el sexismo que los prejuicios por edad',
  'lecturas.la-ley-europea-de-ia.interes':
    'Aclara qué obliga la ley y a quién. Las autoridades nacionales vigilan su cumplimiento desde el 2/8/2026.',
  'lecturas.la-ley-europea-de-ia.resumen':
    'Página de la Comisión Europea sobre el artículo 4 del Reglamento de IA, cambiado por el Reglamento Ómnibus Digital: quienes ofrecen o usan sistemas de IA en una organización deben adoptar medidas para formar a su personal, sin que se exija un nivel concreto a ninguna persona. La página repasa también los planes europeos de formación y talento en IA. Es una traducción automática.',
  'lecturas.la-ley-europea-de-ia.titulo': 'La ley europea de IA y la alfabetización (artículo 4)',
  'lecturas.la-recomendacion-de-la-unesco.interes':
    'Es un punto de partida para conocer los principios éticos que se acordaron entre países. El texto completo es largo.',
  'lecturas.la-recomendacion-de-la-unesco.resumen':
    'Página breve de la UNESCO que presenta su Recomendación sobre la ética de la IA, el primer marco mundial sobre el tema, adoptado por sus 193 Estados miembros en noviembre de 2021. Enlaza al texto completo.',
  'lecturas.la-recomendacion-de-la-unesco.titulo': 'La recomendación de la UNESCO sobre la ética de la IA',
  'lecturas.min': 'minutos',
  'lecturas.model-avaluacio-impacte-drets-fonamentals-apdcat.interes':
    'Muestra qué preguntas debería hacerse una organización antes de usar IA para decidir sobre personas, también sobre su plantilla. Está escrita para especialistas en protección de datos.',
  'lecturas.model-avaluacio-impacte-drets-fonamentals-apdcat.resumen':
    'Guía de la Autoridad Catalana de Protección de Datos (APDCAT) con un modelo para evaluar, antes de usar un sistema de IA, cómo puede afectar a los derechos de las personas: planificar, analizar los riesgos con unas tablas de probabilidad y gravedad y decidir medidas. Lo aplica a casos reales, entre ellos una herramienta de gestión de recursos humanos.',
  'lecturas.model-avaluacio-impacte-drets-fonamentals-apdcat.titulo':
    'Cómo evaluar el impacto de un sistema de IA en los derechos fundamentales',
  'lecturas.modelos-lenguaje-confunden-creencias-hechos.interes':
    'Explica con datos un límite poco conocido de la IA. Usa términos técnicos y nombra modelos concretos.',
  'lecturas.modelos-lenguaje-confunden-creencias-hechos.resumen':
    'Noticia sobre un estudio de la Universidad de Stanford con 24 modelos de lenguaje y 13.000 preguntas. Describe respuestas que aceptan una afirmación falsa de quien pregunta y sus riesgos en medicina, derecho o periodismo.',
  'lecturas.modelos-lenguaje-confunden-creencias-hechos.titulo':
    'Los modelos de lenguaje confunden lo que alguien cree con lo que es cierto',
  'lecturas.nivel': 'Nivel',
  'lecturas.niveles.empezar': 'Inicial',
  'lecturas.niveles.investigacion': 'Avanzado',
  'lecturas.niveles.profundizar': 'Intermedio',
  'lecturas.oit-uno-de-cada-cuatro-empleos.interes':
    'Explica en pocos minutos qué significa «exposición» y por qué no equivale a perder el empleo.',
  'lecturas.oit-uno-de-cada-cuatro-empleos.resumen':
    'Nota de prensa de la OIT sobre su índice de 2025: el 25 % del empleo mundial está en ocupaciones potencialmente expuestas a la IA generativa (el 34 % en los países de ingresos altos). Los trabajos administrativos son los más expuestos, y las mujeres más que los hombres. La transformación es más probable que la sustitución.',
  'lecturas.oit-uno-de-cada-cuatro-empleos.titulo':
    'Uno de cada cuatro empleos, expuesto a la IA generativa (OIT, 2025)',
  'lecturas.osh-pulse-2025-digitalizacion-infografia.interes':
    'Pone cifras europeas a la gestión del trabajo con algoritmos y a sus efectos en la salud. Son datos de toda la UE, no solo de España; la ficha de España de la misma encuesta está también en la Biblioteca. Hay que leer gráficos.',
  'lecturas.osh-pulse-2025-digitalizacion-infografia.resumen':
    'Infografía de la Agencia Europea para la Seguridad y la Salud en el Trabajo (EU-OSHA) con su encuesta de 2025 a 25.688 personas trabajadoras de la Unión Europea. Muestra cuánta gente usa tecnologías digitales y programas o máquinas con IA, qué efectos dice notar (más ritmo, más carga, más aislamiento) y a cuántas personas un algoritmo les asigna tareas o turnos, las evalúa o las vigila.',
  'lecturas.osh-pulse-2025-digitalizacion-infografia.titulo':
    'Tecnología digital, algoritmos y salud en el trabajo en Europa (OSH Pulse 2025)',
  'lecturas.osh-pulse-2025-espana-ficha.interes':
    'Muestra con gráficos cómo se vive la tecnología en el trabajo, también el control automático de tareas y horarios. Hay que leer gráficos de barras.',
  'lecturas.osh-pulse-2025-espana-ficha.resumen':
    'Ficha de España de una encuesta de la Agencia Europea para la Seguridad y la Salud en el Trabajo (EU-OSHA) a 1.006 personas trabajadoras en 2025. Compara España con la Unión Europea en estrés y problemas de salud ligados al trabajo, en el uso de tecnologías digitales, incluidas las herramientas con IA, y en cómo afectan al ritmo y a la carga de trabajo.',
  'lecturas.osh-pulse-2025-espana-ficha.titulo': 'Salud mental y tecnología en el trabajo en España (OSH Pulse 2025)',
  'lecturas.personas-mayores-y-exclusion-tecnologica.interes':
    'Recuerda que aprender tecnología necesita accesibilidad, acompañamiento y alternativas.',
  'lecturas.personas-mayores-y-exclusion-tecnologica.resumen':
    'Estudio del Servicio de Estudios de UGT (agosto de 2025) que revisa con datos estadísticos las barreras digitales de las personas mayores en la administración electrónica, la salud, la banca y la información, y propone apoyos. Trata la tecnología digital en general; la IA aparece solo de pasada.',
  'lecturas.personas-mayores-y-exclusion-tecnologica.titulo': 'Personas mayores y exclusión tecnológica',
  'lecturas.que-es-la-alfabetizacion-en.interes':
    'Explica de dónde sale la obligación de formar en IA y qué se espera de empresas y administraciones. Es larga y está pensada para quien organiza esa formación.',
  'lecturas.que-es-la-alfabetizacion-en.resumen':
    'Preguntas y respuestas de la Comisión Europea sobre el artículo 4 del Reglamento de IA: a quién obliga, qué cambió con el Ómnibus Digital (ya no se exige un nivel «suficiente») y cómo pueden las organizaciones apoyar la formación de su personal. Es una traducción automática y su primer párrafo aún usa la redacción antigua.',
  'lecturas.que-es-la-alfabetizacion-en.titulo': 'Qué es la alfabetización en IA, en preguntas y respuestas',
  'lecturas.que-es-la-ia-generativa.interes':
    'Es el punto de partida si nunca te han explicado cómo funciona la IA, y el desafío te dice qué conviene repasar.',
  'lecturas.que-es-la-ia-generativa.resumen':
    'Qué es la inteligencia artificial, cómo aprende, cómo escribe un asistente, qué precauciones tomar y qué puede cambiar en tu trabajo. Con un glosario de 30 palabras y un desafío de 12 preguntas.',
  'lecturas.que-es-la-ia-generativa.titulo': 'Qué es la IA: la guía de Faro',
  'lecturas.que-es-un-deepfake.interes':
    'Es una definición clara en un minuto y te lleva a casos reales para aprender a dudar.',
  'lecturas.que-es-un-deepfake.resumen':
    'Ficha breve del Instituto Nacional de Ciberseguridad (INCIBE): define el deepfake como un vídeo manipulado con IA que cambia rostros o voces para hacer creer que alguien dijo o hizo algo que no ocurrió, y para qué se usa, como desinformar o desacreditar. Enlaza a otros recursos del INCIBE.',
  'lecturas.que-es-un-deepfake.titulo': 'Qué es un deepfake',
  'lecturas.recomendaciones-sobre-la-ia-en.interes':
    'Explica en qué derechos ya reconocidos se apoya cada recomendación.',
  'lecturas.recomendaciones-sobre-la-ia-en.resumen':
    'Propone cómo tratar la digitalización y la IA en los convenios: información a la representación sin que tenga que pedirla, formación cuando llega una herramienta nueva y análisis del impacto de los algoritmos entre mujeres y hombres.',
  'lecturas.recomendaciones-sobre-la-ia-en.titulo': 'Recomendaciones sobre la IA en la negociación colectiva',
  'lecturas.registro-de-sistemas-de-ia.interes':
    'Muestra casos reales de IA en servicios públicos y cuánto sigue decidiendo una persona.',
  'lecturas.registro-de-sistemas-de-ia.resumen':
    'Registro público de la Generalitat con 35 sistemas (31 de IA y 4 algoritmos), 33 en uso y 2 en desarrollo. Indica para cada uno su finalidad, el riesgo que declara y cuánto interviene una persona. Datos abiertos.',
  'lecturas.registro-de-sistemas-de-ia.titulo': 'Registro de sistemas de IA de la Generalitat',
  'lecturas.repensar-impacto-ia-futuro-trabajo.interes':
    'Te ayuda a leer con calma los titulares sobre IA y empleo. Son opiniones de su autor, con una mirada mundial.',
  'lecturas.repensar-impacto-ia-futuro-trabajo.resumen':
    'Preguntas y respuestas con un asesor de la Organización Internacional del Trabajo (OIT): el debate sobre la IA no debería fijarse solo en la pérdida de empleos, sino también en los salarios, las condiciones de trabajo y la desigualdad. Recuerda que las mujeres están más expuestas porque abundan en los trabajos administrativos y que aún no hay conclusiones definitivas.',
  'lecturas.repensar-impacto-ia-futuro-trabajo.titulo': 'Más allá de cuántos empleos: la IA y la calidad del trabajo',
  'lecturas.resumen-recomendaciones-ia-generativa-aepd.interes':
    'Es un modelo concreto de normas para usar la IA en una oficina pública. Está escrita para quien implanta la IA y usa términos técnicos, pero el último apartado vale para cualquier persona que la use en su trabajo.',
  'lecturas.resumen-recomendaciones-ia-generativa-aepd.resumen':
    'Resumen de 4 páginas de la Agencia Española de Protección de Datos (AEPD) con las obligaciones y recomendaciones que se pone a sí misma para usar IA generativa: gobierno, protección de datos, transparencia, seguridad, contratación y formación. Termina con lo que debe saber cada persona usuaria: usar solo herramientas autorizadas, revisar a mano los resultados, no introducir datos personales ni confidenciales y no usar textos generados en documentos oficiales sin revisión humana.',
  'lecturas.resumen-recomendaciones-ia-generativa-aepd.titulo':
    'Cómo debe organizarse el uso de la IA generativa en una administración: lista de la AEPD',
  'lecturas.riesgos-laborales-de-la-digitalizacion.interes':
    'Está escrita para quien representa a la plantilla o negocia un convenio en Cataluña.',
  'lecturas.riesgos-laborales-de-la-digitalizacion.resumen':
    'Guía de salud laboral de CCOO de Catalunya para delegadas y delegados de prevención: explica los riesgos de la digitalización, algoritmos incluidos, y da indicaciones para la acción sindical y la negociación, con perspectiva de género.',
  'lecturas.riesgos-laborales-de-la-digitalizacion.titulo':
    'Riesgos laborales de la digitalización y negociación colectiva',
  'lecturas.sesgos-genero-ia-perspectiva-interseccional.interes':
    'Es el informe oficial español de referencia sobre sesgos de género en la IA. Su lenguaje es denso y conceptual.',
  'lecturas.sesgos-genero-ia-perspectiva-interseccional.resumen':
    'Informe del Instituto de las Mujeres que explica dónde nace la discriminación en los sistemas algorítmicos: en los datos, en los algoritmos o en los equipos que los hacen. Recorre su ciclo de vida, varios sectores de aplicación y la regulación, y propone recomendaciones. Es de 2023.',
  'lecturas.sesgos-genero-ia-perspectiva-interseccional.titulo':
    'Sesgos de género en la IA, con perspectiva interseccional',
  'lecturas.supervision-humana-de-los-sistemas.interes':
    'Muestra cómo se espera que una empresa que crea un sistema de IA organice la supervisión humana. Es técnica.',
  'lecturas.supervision-humana-de-los-sistemas.resumen':
    'Cómo debe organizarse la revisión por personas de un sistema de IA para que sea real: quién revisa, con qué preparación y con qué poder para corregir. Está escrita para empresas que desarrollan sistemas de IA.',
  'lecturas.supervision-humana-de-los-sistemas.titulo': 'Supervisión humana de los sistemas de IA',
  'lecturas.tendencias-mercado-trabajo-sepe-2026.interes':
    'Sitúa la IA dentro del conjunto del empleo en España. El resumen no explica qué significa «afectados»: tómalo como una cifra orientativa.',
  'lecturas.tendencias-mercado-trabajo-sepe-2026.resumen':
    'Resumen del Servicio Público de Empleo Estatal (SEPE) sobre la economía, los sectores, las ocupaciones con mejores perspectivas y las necesidades de formación. Tiene un apartado breve sobre la IA: dice que dos de cada diez empleos están «afectados» por esta tecnología y que se usa más en las actividades de tecnología y profesionales.',
  'lecturas.tendencias-mercado-trabajo-sepe-2026.titulo': 'Tendencias del mercado de trabajo en España 2026 (resumen)',
  'lecturas.tipo.guia': 'Guía',
  'lecturas.transcripcion-voz-ia-responsabilidad-derechos.interes':
    'Es útil si en tu trabajo se graban reuniones o llamadas para transcribirlas con IA. Está escrita para organizaciones y usa lenguaje jurídico.',
  'lecturas.transcripcion-voz-ia-responsabilidad-derechos.resumen':
    'Entrada del blog de la AEPD, segunda de una serie: cuando una organización usa IA para pasar conversaciones a texto, como actas o llamadas, es responsable de esos datos. Trata los errores de transcripción, la información a las personas y cómo atender sus derechos.',
  'lecturas.transcripcion-voz-ia-responsabilidad-derechos.titulo':
    'Transcribir conversaciones con IA: responsabilidades y derechos',
  'lecturas.transparencia-que-deben-explicarte-de.interes':
    'Explica qué información debe dar quien crea un sistema a quien lo usa. Es técnica.',
  'lecturas.transparencia-que-deben-explicarte-de.resumen':
    'Qué información necesita quien usa un sistema de IA para entender para qué sirve, sus límites y cómo leer sus resultados. Está escrita para empresas que desarrollan sistemas de IA.',
  'lecturas.transparencia-que-deben-explicarte-de.titulo':
    'Transparencia: qué debe explicar quien crea un sistema de IA',
  'lecturas.tus-derechos-ante-la-ia.interes':
    'Reúne en 8 páginas qué información te deben dar si un algoritmo decide sobre tu trabajo. Está escrita sobre todo para empresas y usa lenguaje jurídico.',
  'lecturas.tus-derechos-ante-la-ia.resumen':
    'Nota de la AEPD (7/10/2026) sobre el Real Decreto 723/2026: la empresa debe informar por escrito de que usa sistemas algorítmicos y, si deciden sobre condiciones de trabajo, de sus criterios y reglas. Explica también una advertencia de la AEPD sobre una herramienta de IA para puntuar candidaturas y lo relaciona con el Reglamento General de Protección de Datos (RGPD) y con los derechos de la representación legal.',
  'lecturas.tus-derechos-ante-la-ia.titulo': 'Algoritmos en el trabajo: transparencia y protección de datos',
  'lecturas.un-radar-para-anticipar-las.interes':
    'Enseña a leer con prudencia los datos con que se habla de competencias del futuro.',
  'lecturas.un-radar-para-anticipar-las.resumen':
    'Cómo combina la UOC ofertas de empleo, clasificaciones de competencias y entrevistas, y por qué los anuncios no cuentan por sí solos toda la demanda.',
  'lecturas.un-radar-para-anticipar-las.titulo': 'Un radar para anticipar las competencias que pedirá el empleo',
  'lecturas.unos': 'unos',
  'lecturas.us-segur-ia-empresa-agencia-ciberseguretat.interes':
    'Te ayuda a saber qué no conviene meter en una IA en tu trabajo y qué puedes pedir a tu empresa: normas claras y formación. Algunas medidas son para el equipo informático.',
  'lecturas.us-segur-ia-empresa-agencia-ciberseguretat.resumen':
    'Página de la Agència de Ciberseguretat de Catalunya sobre la «IA en la sombra»: el uso de herramientas de IA en el trabajo sin permiso de la empresa. Con ejemplos de oficina, como redactar un informe o responder a clientes, explica los riesgos (fuga de datos, incumplir la protección de datos, daño a la reputación) y recomienda una política de uso, herramientas autorizadas y formación.',
  'lecturas.us-segur-ia-empresa-agencia-ciberseguretat.titulo':
    'Usar la IA en el trabajo sin poner en riesgo los datos de la empresa',
  'lecturas.usar-la-ia-en-el.interes':
    'Es una lista clara de lo que no conviene escribir en un chatbot, con un consejo propio para quien lo usa en el trabajo.',
  'lecturas.usar-la-ia-en-el.resumen':
    'Diez consejos de la Agencia Española de Protección de Datos (AEPD) para usar la IA sin poner en riesgo tu privacidad: no subir datos personales ni información delicada, respetar los datos de otras personas, no incluir información confidencial del trabajo, revisar las condiciones del servicio y no creerse todo lo que responde.',
  'lecturas.usar-la-ia-en-el.titulo': 'Cuidado con lo que le confías a la IA: diez consejos',
  'lecturas.viejas-competencias-nuevas-tecnologias-oit.interes':
    'Ayuda a no dar por hecho que hace falta ser especialista en IA para seguir trabajando. Los datos son de anuncios de otros países y no predicen lo que pasará en tu empleo.',
  'lecturas.viejas-competencias-nuevas-tecnologias-oit.resumen':
    'Artículo de dos economistas de la Organización Internacional del Trabajo (OIT) basado en millones de ofertas de empleo publicadas en internet en siete países, ninguno europeo. Las empresas piden sobre todo competencias cognitivas y socioemocionales; los conocimientos especializados en IA suponen en torno al 1 % de lo que piden o menos.',
  'lecturas.viejas-competencias-nuevas-tecnologias-oit.titulo':
    '¿Sirven las competencias de siempre para trabajar con IA?',
  'lecturas.vistazo.abre': 'Se abre',
  'lecturas.vistazo.idioma': 'Idioma',
  'lecturas.vistazo.lectura': 'Lectura',
  'lecturas.xatejar-amb-la-ia-agencia-ciberseguretat.interes':
    'Resume en pocos minutos los límites de un chatbot, también para decisiones de trabajo o de salud.',
  'lecturas.xatejar-amb-la-ia-agencia-ciberseguretat.resumen':
    'Página de la Agència de Ciberseguretat de Catalunya: la IA genera respuestas, pero no entiende a las personas ni sustituye a un profesional. Avisa de que puede inventar datos con seguridad y dar consejos inadecuados, y aconseja contrastar siempre lo que dice y no tomar decisiones importantes solo con ella. Insiste en que no sirve como apoyo emocional y da el 061 como teléfono de ayuda.',
  'lecturas.xatejar-amb-la-ia-agencia-ciberseguretat.titulo': 'Chatear con la IA: qué puede y qué no puede hacer',
  // ---------- Fin de Guías y Biblioteca ----------
};
