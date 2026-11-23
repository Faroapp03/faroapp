// Textos de la guía «Qué es la IA» (entender-ia.html) en castellano: sus siete partes, el ejemplo de la palabra
// siguiente (scripts/ejemplo-ia.js), el glosario (scripts/glosario.js) y el desafío (scripts/desafio-ia.js). Se
// incorporan al diccionario de es.js. El HTML de la página lleva los mismos textos escritos, con su clave en
// data-texto: sin JavaScript se lee en castellano.

/**
 * Diccionario de solo lectura (clave -> texto) en castellano con los textos de la guía «Qué es la IA».
 * @type {Readonly<Record<string, string>>}
 */
export const TEXTOS_GUIA_IA = {
  // ---------- Cabecera y partes ----------
  'entender-ia.titulo': 'Qué es la IA · Faro',
  'entender-ia.descripcion':
    'Guía de Faro sobre inteligencia artificial: qué es, cómo aprende, qué precauciones tomar y qué puede cambiar en tu trabajo. Con un glosario y un desafío para ponerte a prueba.',
  'entender-ia.antetitulo': 'Qué es la IA · Guía de Faro',
  'entender-ia.titulo-principal': 'Inteligencia artificial',
  'entender-ia.intro':
    'Lo esencial para entender qué es, cómo funciona, qué precauciones tomar y qué puede cambiar en tu trabajo. Se lee en unos minutos y, al final, puedes ponerte a prueba con el desafío. Si una palabra te frena, mírala en el {0}.',
  'entender-ia.intro.glosario': 'glosario',
  'entender-ia.etapas.nombre': 'Partes de la guía',
  'entender-ia.etapas.controles': 'Cambiar de parte',
  'entender-ia.etapas.rotulo': 'Guía de Faro · {numero} de {total}',
  'entender-ia.etapas.paso': '{numero} de {total} · {nombre}',
  'entender-ia.etapas.final': 'Final de la guía',
  'entender-ia.etapas.empezar': 'Empezar tu recorrido',
  'entender-ia.etapa.1': 'Qué es la IA',
  'entender-ia.etapa.2': 'Cómo aprende',
  'entender-ia.etapa.3': 'La IA que escribe',
  'entender-ia.etapa.4': 'Precauciones',
  'entender-ia.etapa.5': 'La IA en tu trabajo',
  'entender-ia.etapa.6': 'Glosario',
  'entender-ia.etapa.7': 'Desafío',
  'entender-ia.etapa.7.largo': 'Desafío: ¿cuánto sabes de IA?',

  // ---------- 1 · Qué es la IA ----------
  'entender-ia.p1.titulo': 'Qué es la inteligencia artificial',
  'entender-ia.p1.definicion':
    'La inteligencia artificial (IA) es una tecnología que aprende de muchísimos ejemplos para hacer tareas como entender lo que dices, traducir un texto o escribir un correo. No piensa ni entiende como una persona: busca parecidos con lo que ya ha visto y da la respuesta que le parece más probable.',
  'entender-ia.p1.usos':
    'Seguramente ya la usas sin darte cuenta. Está en el teclado del móvil que te sugiere la palabra siguiente, en el correo que aparta el spam, en el dictado que convierte tu voz en texto y en los subtítulos automáticos de un vídeo. En el trabajo aparece, por ejemplo, en el traductor que te ayuda a entender un mensaje en otro idioma. Los cursos de divulgación la resumen en dos rasgos: hace tareas sin que nadie le indique cada paso y mejora a medida que ve más ejemplos{0}.',
  'entender-ia.p1.ahora.titulo': 'Qué ha cambiado',
  'entender-ia.p1.ahora':
    'La IA lleva años funcionando en segundo plano, sin que la veamos. Lo nuevo es que, desde finales de 2022, cualquiera puede conversar con asistentes de IA que escriben, resumen, traducen y responden con frases completas. Basta con escribirles lo que necesitas en tu idioma, sin saber nada de informática. Por eso se nota tanto en el trabajo de oficina, que en buena parte consiste en leer y escribir: correos, informes, actas o respuestas a clientes. A esta IA que crea textos, imágenes o voces se le llama {0}, y es la que más espacio ocupa en esta guía.',
  'entender-ia.p1.termino.generativa': 'IA generativa',
  'entender-ia.p1.no-es.titulo': 'Lo que no es',
  'entender-ia.p1.no-es':
    'El nombre engaña un poco. «Inteligencia» hace pensar en alguien que piensa, y no es así. La IA no tiene opiniones, intenciones ni conciencia, y no sabe si lo que dice es verdad: solo sabe qué es probable. Por eso, aunque acierta muy a menudo, suena igual de segura cuando se equivoca. Tampoco es un robot ni una sola máquina: es una tecnología que va dentro de muchas aplicaciones que ya conoces.',
  'entender-ia.p1.ley.titulo': 'Por qué te conviene entenderla',
  'entender-ia.p1.ley':
    'La Unión Europea tiene una ley propia sobre la IA{0}. Desde febrero de 2025 pide a las organizaciones que la crean o la usan que ayuden a su personal a entenderla. Esta guía te da esa base, sin tecnicismos: cómo aprende, qué precauciones conviene tomar y qué puede cambiar en tu trabajo.',
  'entender-ia.p1.cierre':
    'Bien usada, la IA te ahorra tiempo cuando tienes que leer, escribir o resumir. La última palabra, y la responsabilidad de lo que envías, siguen siendo tuyas.',

  // ---------- 2 · Cómo aprende ----------
  'entender-ia.p2.titulo': 'Cómo aprende',
  'entender-ia.p2.cancion':
    'Piensa en una canción que has oído muchas veces. Suenan las primeras notas en la radio y ya sabes cuál es. Nadie te dio una regla para reconocerla: la has escuchado tanto que tu oído reconoce lo que se repite. La IA aprende de una forma parecida, con muchísimos más ejemplos. A esto se le llama {0}{1}.',
  'entender-ia.p2.termino.aprendizaje': 'aprendizaje automático',
  'entender-ia.p2.correo.titulo': 'Un ejemplo: el filtro del correo',
  'entender-ia.p2.correo':
    'El filtro de spam empieza viendo miles de mensajes que otras personas ya marcaron como spam o no. Con ellos descubre lo que se repite: palabras como «premio» o «gratis», remitentes desconocidos, enlaces extraños. Cuando llega un correo nuevo, mira a qué grupo se parece más y lo deja en tu bandeja o lo aparta.',
  'entender-ia.p2.fallo':
    'Por eso a veces se equivoca. El aviso de un «taller gratis» del ayuntamiento puede acabar en el spam. Merece la pena echar un vistazo a esa carpeta de vez en cuando.',
  'entender-ia.p2.ejemplos.titulo': 'Tan buena como sus ejemplos',
  'entender-ia.p2.ejemplos':
    'A la fase de aprender se le llama {0}, y a lo aprendido, {1}. De ahí sale una idea importante: la IA es tan buena como los ejemplos de los que aprendió. Si son pocos, antiguos o no reflejan bien la realidad, sus respuestas fallarán. Y si esos ejemplos arrastran prejuicios, la IA los aprende con ellos.',
  'entender-ia.p2.termino.entrenamiento': 'entrenamiento',
  'entender-ia.p2.termino.modelo': 'modelo',

  // ---------- 3 · La IA que escribe, con el ejemplo de la palabra siguiente ----------
  'entender-ia.p3.titulo': 'La IA que escribe',
  'entender-ia.p3.intro':
    'Cuando escribes una pregunta en un asistente de IA y la respuesta aparece palabra a palabra, estás usando un {0}. Es la forma más conocida de {1}, la que crea textos, imágenes o voces nuevas.',
  'entender-ia.p3.termino.lenguaje': 'modelo de lenguaje',
  'entender-ia.p3.termino.generativa': 'IA generativa',
  'entender-ia.p3.teclado':
    'Su idea básica ya la conoces: el teclado del móvil que te sugiere la palabra siguiente{0}. Un modelo de lenguaje hace lo mismo a lo grande. Ha aprendido de enormes cantidades de textos y calcula qué palabra es más probable que venga después de lo que ya está escrito{1}. La añade, vuelve a calcular y así, palabra a palabra, escribe textos enteros.',
  'entender-ia.ejemplo.titulo': 'Pruébalo: elige un principio de frase',
  'entender-ia.ejemplo.leyenda': 'Principios de frase',
  'entender-ia.ejemplo.0.frase': 'Esta mañana he ido al…',
  'entender-ia.ejemplo.1.frase': 'Para preparar una factura necesito los datos del…',
  'entender-ia.ejemplo.2.frase': 'El plazo para presentar la reclamación es de dos…',
  'entender-ia.ejemplo.cabecera': 'Palabras que pueden venir después, de más a menos probable',
  'entender-ia.ejemplo.mas': 'Ver 15 palabras más',
  'entender-ia.ejemplo.menos': 'Ver solo las 5 primeras',
  'entender-ia.ejemplo.resumen':
    'Estas {numero} palabras suman {suma} de las posibilidades. Queda {resto} para miles de palabras más (y algún signo, como el punto), y ninguna de ellas supera {tope}.',
  'entender-ia.ejemplo.cifra': 'el {cifra}',
  'entender-ia.ejemplo.cifra.vocal': 'el {cifra}',
  'entender-ia.ejemplo.nota':
    'Son porcentajes reales de Salamandra 2B, un modelo de lenguaje abierto del Barcelona Supercomputing Center, calculados el 19 de octubre de 2026. El modelo reparte el 100 % entre todas las palabras que conoce; aquí se ven las más probables.',
  'entender-ia.p3.probable':
    'Esa es la base de todo lo que escribe, y por eso escribe con tanta soltura. La idea de fondo es sencilla: {0}. Muchas veces es lo mismo, pero no siempre. Si le preguntas por el plazo de una reclamación sin explicarle tu caso ni dejarle consultar fuentes, puede darte el que más se repite en los textos, no necesariamente el tuyo. Y no siempre se queda con la primera palabra de la lista: elige entre las más probables, como con un dado trucado en el que las de arriba salen más a menudo, para no escribir siempre lo mismo. Por eso la misma pregunta puede darte respuestas algo distintas.',
  'entender-ia.p3.probable.idea': 'elige lo probable, no lo cierto',
  'entender-ia.p3.pedir.titulo': 'Cómo pedirle las cosas',
  'entender-ia.p3.pedir':
    'Lo que le escribes se llama {0}; en inglés, {1}. Es su único punto de partida. No es lo mismo pedir «escribe un correo» que «escribe un correo breve y amable a un cliente que espera su pedido desde hace una semana». Cuanto más contexto le das, mejor se ajusta la respuesta a lo que necesitas.',
  'entender-ia.p3.termino.instruccion': 'instrucción',

  // ---------- 4 · Precauciones ----------
  'entender-ia.p4.titulo': 'Precauciones',
  'entender-ia.p4.bien':
    'Los asistentes de IA actuales hacen muy bien muchas tareas de texto. Redactan, resumen, traducen y explican con mucha calidad, y analizan los documentos que tú les das: un contrato, un informe o una hoja de cálculo. Algunos, además, buscan información y citan de dónde la sacan. Usados con cuidado, ahorran mucho tiempo.',
  'entender-ia.p4.alucinaciones.titulo': 'La precaución principal: las alucinaciones',
  'entender-ia.p4.alucinaciones':
    'A veces la IA inventa, con toda seguridad, un dato, una cifra, una cita, una norma o una referencia que no existe. A esto se le llama {0}. Ocurre porque genera la respuesta más probable, no una respuesta comprobada. Cada vez pasa menos, sobre todo con los modelos nuevos y cuando consultan fuentes, pero sigue pasando. Además, cada modelo aprendió con textos reunidos hasta una fecha, su fecha de corte: de lo que ha pasado después no sabe nada, salvo que lo busque en internet o en otras fuentes actuales. Por eso, ten especial cuidado con las cifras, las fechas, las citas, las leyes, los nombres y los hechos muy concretos o muy recientes.',
  'entender-ia.p4.termino.alucinacion': 'alucinación',
  'entender-ia.p4.oficina':
    'Un ejemplo de oficina: pides a la IA un correo para un cliente con el precio del mantenimiento, pero no le das la tarifa. El correo sale impecable y dice: «El mantenimiento anual cuesta 240 €». Esa cifra no estaba en ninguna parte: la ha puesto porque suena razonable, y la dice con el mismo tono seguro que todo lo demás.',
  'entender-ia.p4.habitos.titulo': 'Cinco precauciones prácticas',
  'entender-ia.p4.habitos.1':
    'Comprueba en la fuente original lo que importe. Como recuerda la Agencia Española de Protección de Datos (AEPD), esa comprobación es responsabilidad de cada persona{0}.',
  'entender-ia.p4.habitos.2': 'Pídele las fuentes y ábrelas: que cite un documento no garantiza que diga eso.',
  'entender-ia.p4.habitos.3': 'Dale contexto, porque de tu caso solo sabe lo que tú le cuentas.',
  'entender-ia.p4.habitos.4':
    'No pegues datos personales ni confidenciales, tuyos ni de nadie, y sigue las normas de tu organización sobre qué herramientas usar.',
  'entender-ia.p4.habitos.5':
    'Fíjate en posibles sesgos cuando hable de personas: puede repetir prejuicios de los textos de los que aprendió, como asociar ciertas profesiones más a hombres que a mujeres{0}.',
  'entender-ia.p4.cierre':
    'Con estas precauciones, la IA es una buena ayuda. Y recuerda que lo que envías lo firmas tú: su respuesta es un punto de partida, no la última palabra.',

  // ---------- 5 · La IA en tu trabajo ----------
  'entender-ia.p5.titulo': 'Qué implica para tu trabajo',
  'entender-ia.p5.pregunta':
    'Cuando se habla de IA y empleo, la pregunta habitual es: «¿Va a desaparecer mi puesto?». La pregunta útil es otra: ¿qué tareas de mi puesto podría hacer o cambiar la IA? Un puesto es un conjunto de tareas, y la IA no las toca todas por igual. La Organización Internacional del Trabajo (OIT) concluye que la mayoría de las ocupaciones solo están expuestas en parte, y que lo más probable es que la IA generativa complemente el trabajo más que sustituirlo{0}.',
  'entender-ia.p5.recepcion':
    'Piensa en el personal de recepción de una oficina o una clínica. En el índice de la OIT que usa Faro, dar citas tiene el doble de puntuación de exposición que recibir a quien llega{0}. Que una tarea esté expuesta no quiere decir que vaya a desaparecer: la IA podría hacer una parte o cambiar la forma de hacerla. Lo que ocurra depende también de las empresas, de las leyes y de quienes trabajan.',
  'entender-ia.p5.accion.titulo': 'Qué puedes hacer',
  'entender-ia.p5.accion':
    'Mirar tu trabajo tarea a tarea te ayuda a decidir con información. En unas tareas, la IA puede ahorrarte tiempo, como al preparar borradores o resumir documentos. Otras dependen de lo que aporta una persona: el trato con la gente, la experiencia y el criterio. Saber cuáles son te sirve para elegir qué habilidades reforzar o qué formación buscar.',
  'entender-ia.p5.cierre':
    'Al final, la IA propone y tú decides. Faro te enseña los datos tarea a tarea, sin decirte qué hacer. Cuando quieras verlo aplicado a tu trabajo, {0}.',
  'entender-ia.p5.cierre.enlace': 'empieza tu recorrido',

  // ---------- 6 · Glosario (scripts/glosario.js lo ordena según la lengua) ----------
  'entender-ia.glosario.titulo': 'Glosario',
  'entender-ia.glosario.intro': 'Las palabras de la IA, explicadas en una frase.',
  'entender-ia.glosario.explicado': 'Lo explicamos en: {0}',
  'entender-ia.glosario.algoritmo.termino': 'Algoritmo',
  'entender-ia.glosario.algoritmo.definicion':
    'Serie de pasos ordenados para resolver una tarea, como una receta. La IA también usa algoritmos, pero aprende parte de lo que hace a partir de ejemplos.',
  'entender-ia.glosario.algoritmo.ejemplo': 'Ejemplo: los pasos que sigue el móvil para ordenar tus fotos por fecha.',
  'entender-ia.glosario.aprendizaje.termino': 'Aprendizaje automático ({0})',
  'entender-ia.glosario.aprendizaje.definicion':
    'La forma en que aprende la IA: a partir de muchos ejemplos, sin que nadie le explique cada paso.',
  'entender-ia.glosario.aprendizaje.ejemplo':
    'Ejemplo: el filtro de spam aprende de miles de correos que otras personas ya marcaron.',
  'entender-ia.glosario.profundo.termino': 'Aprendizaje profundo ({0})',
  'entender-ia.glosario.profundo.definicion':
    'Forma de aprendizaje automático que usa redes neuronales de muchas capas. Es la base de casi toda la IA actual, de la que reconoce voces e imágenes a la que escribe textos.',
  'entender-ia.glosario.profundo.ejemplo':
    'Ejemplo: el dictado del móvil, que entiende lo que dices aunque haya ruido.',
  'entender-ia.glosario.generativa.termino': 'IA generativa',
  'entender-ia.glosario.generativa.definicion':
    'La IA que crea contenido nuevo a partir de lo que le pides: textos, imágenes, audio o vídeo.',
  'entender-ia.glosario.generativa.ejemplo': 'Ejemplo: pedirle el borrador de una carta o una imagen para un cartel.',
  'entender-ia.glosario.ia.termino': 'Inteligencia artificial (IA)',
  'entender-ia.glosario.ia.definicion':
    'Tecnología que aprende de muchísimos ejemplos para hacer tareas y da la respuesta que le parece más probable. No piensa ni entiende como una persona.',
  'entender-ia.glosario.ia.ejemplo': 'Ejemplo: el teclado del móvil que te sugiere la palabra siguiente.',
  'entender-ia.glosario.modelo.termino': 'Modelo',
  'entender-ia.glosario.modelo.definicion':
    'Lo que la IA ha aprendido en el entrenamiento y usa después para responder.',
  'entender-ia.glosario.modelo.ejemplo': 'Ejemplo: lo que permite al móvil reconocer tu cara aunque lleves gafas.',
  'entender-ia.glosario.red.termino': 'Red neuronal',
  'entender-ia.glosario.red.definicion':
    'Modelo formado por muchas piezas de cálculo conectadas en capas, inspirado de lejos en las neuronas del cerebro. Durante el entrenamiento se ajusta la fuerza de cada conexión.',
  'entender-ia.glosario.red.ejemplo': 'Ejemplo: la red que reconoce tu cara para desbloquear el móvil.',
  'entender-ia.glosario.sistema.termino': 'Sistema de IA',
  'entender-ia.glosario.sistema.definicion':
    'Así llama la ley europea a una máquina o programa que funciona con cierta autonomía y que, a partir de lo que recibe, genera resultados como predicciones, contenidos, recomendaciones o decisiones.',
  'entender-ia.glosario.sistema.ejemplo':
    'Ejemplo: un programa que clasifica las solicitudes que llegan a una oficina.',
  'entender-ia.glosario.datos-entrenamiento.termino': 'Datos de entrenamiento',
  'entender-ia.glosario.datos-entrenamiento.definicion':
    'Los ejemplos concretos de los que aprendió un modelo. Si tienen errores o prejuicios, el modelo los hereda.',
  'entender-ia.glosario.datos-entrenamiento.ejemplo':
    'Ejemplo: veinte años de contrataciones con los que aprende una IA que ayuda a elegir candidaturas.',
  'entender-ia.glosario.entrenamiento.termino': 'Entrenamiento',
  'entender-ia.glosario.entrenamiento.definicion':
    'La fase en la que la IA mira muchísimos ejemplos y aprende lo que se repite en ellos.',
  'entender-ia.glosario.entrenamiento.ejemplo':
    'Ejemplo: antes de llegar a tu correo, el filtro de spam ya ha visto miles de mensajes.',
  'entender-ia.glosario.fecha-corte.termino': 'Fecha de corte ({0})',
  'entender-ia.glosario.fecha-corte.definicion':
    'Momento hasta el que se reunieron los textos de entrenamiento. Lo que pasó después, el modelo no lo sabe, salvo que consulte fuentes actuales.',
  'entender-ia.glosario.fecha-corte.ejemplo':
    'Ejemplo: una norma que cambió hace poco y que el asistente cita en su versión antigua.',
  'entender-ia.glosario.multimodal.termino': 'IA multimodal',
  'entender-ia.glosario.multimodal.definicion':
    'IA que trabaja con varios tipos de información a la vez: texto, imágenes, sonido o vídeo.',
  'entender-ia.glosario.multimodal.ejemplo': 'Ejemplo: le das la foto de una factura y te resume lo que pone.',
  'entender-ia.glosario.lenguaje.termino': 'Modelo de lenguaje ({0})',
  'entender-ia.glosario.lenguaje.definicion':
    'IA generativa que trabaja con texto: calcula qué palabra es más probable que venga después y así escribe, palabra a palabra.',
  'entender-ia.glosario.lenguaje.ejemplo': 'Ejemplo: lo que hay detrás de un asistente que redacta un correo.',
  'entender-ia.glosario.parametros.termino': 'Parámetros',
  'entender-ia.glosario.parametros.definicion':
    'Los valores internos que un modelo ajusta durante el entrenamiento y que guardan lo que ha aprendido. Los modelos de lenguaje actuales tienen miles de millones.',
  'entender-ia.glosario.parametros.ejemplo':
    'Ejemplo: si una noticia dice que un modelo tiene «70.000 millones de parámetros», habla de su tamaño.',
  'entender-ia.glosario.token.termino': 'Token',
  'entender-ia.glosario.token.definicion':
    'Trozo de texto con el que trabaja un modelo de lenguaje: una palabra, una parte de una palabra o un signo. Lee y escribe token a token, y muchos servicios cuentan su uso en tokens.',
  'entender-ia.glosario.token.ejemplo':
    'Ejemplo: una palabra larga, como «inteligencia», puede ocupar dos o tres tokens.',
  'entender-ia.glosario.contexto.termino': 'Contexto (ventana de contexto)',
  'entender-ia.glosario.contexto.definicion':
    'Lo que la IA tiene en cuenta en una conversación: lo que le has escrito, los documentos que le das y sus respuestas anteriores. Tiene un límite, la ventana de contexto: si algo se queda fuera, no lo «recuerda».',
  'entender-ia.glosario.contexto.ejemplo':
    'Ejemplo: en una conversación muy larga, el asistente puede no tener en cuenta lo que le dijiste al principio.',
  'entender-ia.glosario.agente.termino': 'Agente de IA',
  'entender-ia.glosario.agente.definicion':
    'Asistente de IA que, además de responder, hace tareas de varios pasos por su cuenta: buscar información, usar otros programas o rellenar formularios. Pide aún más supervisión.',
  'entender-ia.glosario.agente.ejemplo':
    'Ejemplo: un agente que busca vuelos, compara precios y prepara la reserva para que tú la confirmes.',
  'entender-ia.glosario.asistente.termino': 'Asistente de IA ({0})',
  'entender-ia.glosario.asistente.definicion':
    'Servicio con el que conversas por escrito o en voz alta y que te responde con IA generativa.',
  'entender-ia.glosario.asistente.ejemplo':
    'Ejemplo: el chat de una web que te ayuda a redactar un correo o a resumir un documento.',
  'entender-ia.glosario.respuesta.termino': '{0} (respuesta o resultado)',
  'entender-ia.glosario.respuesta.definicion':
    'Lo que la IA te devuelve: un texto, una imagen, una clasificación o una cifra. Antes de usarlo, revísalo.',
  'entender-ia.glosario.respuesta.ejemplo': 'Ejemplo: el resumen que te da el asistente después de tu instrucción.',
  'entender-ia.glosario.instruccion.termino': '{0} (instrucción)',
  'entender-ia.glosario.instruccion.definicion':
    'Lo que escribes o dices para pedirle algo a una IA generativa. Es su punto de partida.',
  'entender-ia.glosario.instruccion.ejemplo':
    'Ejemplo: «Resume esta acta en cinco puntos para una compañera que no pudo venir».',
  'entender-ia.glosario.alfabetizacion.termino': 'Alfabetización en IA',
  'entender-ia.glosario.alfabetizacion.definicion':
    'Los conocimientos básicos para usar la IA con criterio: qué hace, cómo aprende, qué precauciones pide y qué riesgos tiene. La ley europea la recoge en su artículo 4.',
  'entender-ia.glosario.alfabetizacion.ejemplo':
    'Ejemplo: saber que un asistente puede inventar una cifra y que conviene comprobarla antes de usarla.',
  'entender-ia.glosario.alucinacion.termino': 'Alucinación',
  'entender-ia.glosario.alucinacion.definicion':
    'Dato, cita, norma o referencia que la IA presenta como real y es inventado. Es cada vez menos frecuente, pero sigue ocurriendo, y lo dice con el mismo tono seguro.',
  'entender-ia.glosario.alucinacion.ejemplo': 'Ejemplo: el número de una ley, con un formato perfecto, que no existe.',
  'entender-ia.glosario.decision.termino': 'Decisión automatizada',
  'entender-ia.glosario.decision.definicion':
    'Decisión que toma un sistema sin que intervenga una persona. Si te afecta de forma importante, la normativa de protección de datos te da derechos, como pedir que intervenga una persona.',
  'entender-ia.glosario.decision.ejemplo': 'Ejemplo: una solicitud que se rechaza solo por el cálculo de un programa.',
  'entender-ia.glosario.deepfake.termino': 'Deepfake',
  'entender-ia.glosario.deepfake.definicion': 'Imagen, vídeo o audio falsos hechos con IA que parecen reales.',
  'entender-ia.glosario.deepfake.ejemplo':
    'Ejemplo: un audio con la voz de tu jefa que te pide un pago urgente. Ante la duda, confírmalo por otra vía.',
  'entender-ia.glosario.uso-general.termino': 'IA de uso general',
  'entender-ia.glosario.uso-general.definicion':
    'Modelo de IA que sirve para tareas muy distintas, como los grandes modelos de lenguaje, y sobre el que se construyen muchos asistentes. La ley europea da obligaciones propias a quienes los crean.',
  'entender-ia.glosario.uso-general.ejemplo':
    'Ejemplo: un mismo modelo que traduce, resume, escribe código y responde preguntas.',
  'entender-ia.glosario.reglamento.termino': 'Reglamento europeo de IA ({0})',
  'entender-ia.glosario.reglamento.definicion':
    'La ley de la Unión Europea sobre inteligencia artificial (Reglamento 2024/1689). Pone más condiciones a los usos de alto riesgo y pide a las organizaciones que la crean o la usan que ayuden a su personal a entenderla.',
  'entender-ia.glosario.reglamento.ejemplo':
    'Ejemplo: una IA que ayuda a elegir candidaturas para un empleo se considera de alto riesgo.',
  'entender-ia.glosario.sesgo.termino': 'Sesgo algorítmico',
  'entender-ia.glosario.sesgo.definicion':
    'Inclinación injusta que un sistema de IA hereda de sus datos o de su diseño y que repite en sus respuestas o decisiones.',
  'entender-ia.glosario.sesgo.ejemplo': 'Ejemplo: asociar ciertas profesiones más a hombres que a mujeres.',
  'entender-ia.glosario.supervision.termino': 'Supervisión humana',
  'entender-ia.glosario.supervision.definicion':
    'Que una persona vigile lo que hace la IA, pueda corregirlo y tenga la última palabra. La ley europea la exige en los sistemas de alto riesgo.',
  'entender-ia.glosario.supervision.ejemplo':
    'Ejemplo: una persona revisa las candidaturas que la IA ha descartado antes de decidir.',

  // ---------- 7 · Desafío (scripts/desafio-ia.js): textos fijos, del guion y las doce situaciones ----------
  'entender-ia.desafio.titulo': '¿Cuánto sabes de IA?',
  'entender-ia.desafio.intro':
    'Doce situaciones para poner a prueba lo que has leído. Toca la respuesta que te parezca mejor y verás por qué es o no es la correcta. No hay tiempo y no se guarda nada.',
  'entender-ia.desafio.ver-respuesta': 'Ver la respuesta',
  'entender-ia.desafio.progreso': 'Pregunta {numero} de {total}',
  'entender-ia.desafio.siguiente': 'Siguiente pregunta',
  'entender-ia.desafio.ver-resultado': 'Ver el resultado',
  'entender-ia.desafio.correcto': 'Correcto.',
  'entender-ia.desafio.incorrecto': 'No es correcto.',
  'entender-ia.desafio.marca.correcta': 'Correcta',
  'entender-ia.desafio.marca.incorrecta': 'Incorrecta',
  'entender-ia.desafio.marca.tuya': 'Tu respuesta',
  'entender-ia.desafio.resultado.titulo': 'Tu resultado',
  'entender-ia.desafio.resultado': '{aciertos} de {total}',
  'entender-ia.desafio.todas': 'Has acertado todas. Tienes una buena base para usar la IA con criterio.',
  'entender-ia.desafio.bien': 'Buen resultado. Si quieres afinar, puedes releer:',
  'entender-ia.desafio.repasar': 'Merece la pena volver a leer estas partes de la guía:',
  'entender-ia.desafio.cuenta.una': '(1 pregunta)',
  'entender-ia.desafio.cuenta.varias': '({n} preguntas)',
  'entender-ia.desafio.repetir': 'Volver a empezar',
  'entender-ia.desafio.1.pregunta': '¿Esto es IA? El móvil se desbloquea al reconocer tu cara.',
  'entender-ia.desafio.1.a': 'Sí: aprendió a reconocer caras viendo muchísimas fotos.',
  'entender-ia.desafio.1.a.porque':
    'Reconoce tu cara con otra luz o con gafas porque aprendió de muchísimos ejemplos de rostros.',
  'entender-ia.desafio.1.b': 'No: es un sensor, como el interruptor de la luz.',
  'entender-ia.desafio.1.b.porque':
    'Un interruptor no reconoce nada. El móvil aprendió a distinguir caras a partir de muchos ejemplos.',
  'entender-ia.desafio.1.c': 'Solo es IA si el móvil está conectado a internet.',
  'entender-ia.desafio.1.c.porque': 'Muchas IA funcionan dentro del propio aparato, sin conexión.',
  'entender-ia.desafio.2.pregunta': '¿Esto es IA? La alarma del despertador.',
  'entender-ia.desafio.2.a': 'Sí, porque suena sola cada mañana.',
  'entender-ia.desafio.2.a.porque':
    'Hacer algo sola no basta. La alarma no aprende de ejemplos: suena a la hora que pusiste.',
  'entender-ia.desafio.2.b': 'No: suena a la hora que tú pusiste y no aprende nada.',
  'entender-ia.desafio.2.b.porque': 'Hace siempre lo mismo. No busca parecidos ni mejora con ejemplos.',
  'entender-ia.desafio.2.c': 'Sí, si es la alarma del móvil.',
  'entender-ia.desafio.2.c.porque':
    'Estar en el móvil no la convierte en IA. El móvil usa IA en algunas funciones, no en todas.',
  'entender-ia.desafio.3.pregunta': 'Un asistente de IA te contesta con mucha seguridad. ¿Qué quiere decir eso?',
  'entender-ia.desafio.3.a': 'Que sabe que lo que dice es verdad.',
  'entender-ia.desafio.3.a.porque':
    'La IA no sabe si algo es verdad. Suena igual de segura cuando acierta y cuando se equivoca.',
  'entender-ia.desafio.3.b': 'Que una persona experta ha revisado la respuesta.',
  'entender-ia.desafio.3.b.porque': 'Nadie la revisa antes de que la leas. Esa revisión te toca a ti.',
  'entender-ia.desafio.3.c': 'Que ha dado la respuesta que le parece más probable.',
  'entender-ia.desafio.3.c.porque':
    'Busca parecidos con lo que ha visto y da lo más probable, que puede no ser lo cierto.',
  'entender-ia.desafio.4.pregunta':
    'Un aviso real del ayuntamiento sobre un «taller gratis» acaba en la carpeta de spam. ¿Por qué?',
  'entender-ia.desafio.4.a': 'Se parece al spam que el filtro vio al aprender.',
  'entender-ia.desafio.4.a.porque':
    '«Gratis» se repetía mucho en el spam y el filtro se fía de ese parecido. Por eso conviene revisar esa carpeta.',
  'entender-ia.desafio.4.b': 'El filtro está estropeado.',
  'entender-ia.desafio.4.b.porque': 'Funciona como debe: decide por parecidos, y a veces los parecidos engañan.',
  'entender-ia.desafio.4.c': 'Alguien del servicio de correo lo leyó y lo apartó.',
  'entender-ia.desafio.4.c.porque': 'Nadie lee tu correo para filtrarlo. Lo decide la IA según lo que aprendió.',
  'entender-ia.desafio.5.pregunta':
    'Una IA reparte las solicitudes de tu oficina. Aprendió solo con solicitudes escritas a ordenador. Hoy llega una escrita a mano. ¿Qué es lo más probable?',
  'entender-ia.desafio.5.a': 'Que la reparta igual de bien que las demás.',
  'entender-ia.desafio.5.a.porque':
    'Solo trata bien lo que se parece a sus ejemplos, y una solicitud a mano es algo que no vio.',
  'entender-ia.desafio.5.b': 'Que avise de que no sabe leerla.',
  'entender-ia.desafio.5.b.porque': 'Lo normal es que no avise: da igualmente su respuesta más probable.',
  'entender-ia.desafio.5.c': 'Que se equivoque más con ella.',
  'entender-ia.desafio.5.c.porque':
    'La IA es tan buena como sus ejemplos. Ante un caso distinto de los que vio, falla más.',
  'entender-ia.desafio.6.pregunta':
    'Pides a un asistente de IA un correo para un cliente y escribe «Su pedido llegará el jueves». Tú no le diste ninguna fecha. ¿De dónde sale «jueves»?',
  'entender-ia.desafio.6.a': 'De los pedidos de tu empresa, que el asistente consulta por su cuenta.',
  'entender-ia.desafio.6.a.porque': 'Solo podría saberlo si le dieras ese dato. No lo hiciste.',
  'entender-ia.desafio.6.b': 'Es la continuación que le pareció más probable.',
  'entender-ia.desafio.6.b.porque':
    'Ha completado la frase con algo que suena bien. Hay que comprobar la fecha o quitarla.',
  'entender-ia.desafio.6.c': 'El asistente sabe cuánto tardan los envíos.',
  'entender-ia.desafio.6.c.porque': 'No sabe nada de tu pedido: imita cómo suelen escribirse estos correos.',
  'entender-ia.desafio.7.pregunta':
    'Quieres resumir un acta para una compañera que no pudo ir a la reunión. ¿Qué instrucción funciona mejor?',
  'entender-ia.desafio.7.a':
    '«Resume esta acta en cinco puntos para una compañera que no vino. Di quién hace cada tarea y para cuándo.»',
  'entender-ia.desafio.7.a.porque':
    'Explica para quién es y qué debe incluir. Con más contexto, la respuesta se ajusta mejor.',
  'entender-ia.desafio.7.b': '«Resume esto.»',
  'entender-ia.desafio.7.b.porque': 'Es demasiado escueta. Sin contexto, la IA no sabe qué te importa.',
  'entender-ia.desafio.7.c': '«Hazlo perfecto y sin errores.»',
  'entender-ia.desafio.7.c.porque': 'Pedirlo no lo garantiza. Lo que mejora la respuesta es el contexto.',
  'entender-ia.desafio.8.pregunta':
    'Una compañera usa un asistente de IA para resumir un acta. ¿Qué debe comprobar antes de enviarla?',
  'entender-ia.desafio.8.a': 'Que no tenga faltas de ortografía.',
  'entender-ia.desafio.8.a.porque': 'Suele escribir sin faltas. El riesgo está en el contenido.',
  'entender-ia.desafio.8.b': 'Nada, si el resumen suena claro y seguro.',
  'entender-ia.desafio.8.b.porque': 'Un tono seguro no garantiza nada: suena igual cuando se equivoca.',
  'entender-ia.desafio.8.c': 'Que los nombres, las fechas y los acuerdos coincidan con el acta original.',
  'entender-ia.desafio.8.c.porque':
    'Puede convertir una propuesta en un acuerdo o inventar algo. Hay que compararlo con el original.',
  'entender-ia.desafio.9.pregunta':
    'Una IA que ayuda a elegir candidaturas aprendió de veinte años de contrataciones en las que casi todos los puestos de dirección fueron para hombres. ¿Qué riesgo hay?',
  'entender-ia.desafio.9.a': 'Ninguno, porque los datos son reales.',
  'entender-ia.desafio.9.a.porque':
    'Que sean reales no los hace justos. Si el pasado tenía un desequilibrio, la IA lo aprende.',
  'entender-ia.desafio.9.b': 'Que repita ese desequilibrio y favorezca a los hombres.',
  'entender-ia.desafio.9.b.porque':
    'Es un sesgo: la IA hereda las inclinaciones de sus ejemplos. Por eso hace falta supervisión humana.',
  'entender-ia.desafio.9.c': 'Que tarde más en decidir.',
  'entender-ia.desafio.9.c.porque': 'El problema no es la velocidad, sino que repita una inclinación injusta.',
  'entender-ia.desafio.10.pregunta':
    'Lucía pide a un asistente de IA que la ayude a responder a un cliente molesto. ¿Qué no debería escribir?',
  'entender-ia.desafio.10.a': 'Que el pedido lleva una semana de retraso.',
  'entender-ia.desafio.10.a.porque': 'Ese contexto ayuda y no identifica a nadie.',
  'entender-ia.desafio.10.b': 'Que quiere un tono amable y de usted.',
  'entender-ia.desafio.10.b.porque': 'Indicar el tono mejora la respuesta.',
  'entender-ia.desafio.10.c': 'El nombre completo del cliente, su dirección y su número de documento de identidad.',
  'entender-ia.desafio.10.c.porque':
    'Los datos personales no deben salir de donde están. Lucía los añade ella al final, en su correo.',
  'entender-ia.desafio.11.pregunta':
    'Trabajas en recepción. En Faro ves que «dar citas» es una de tus tareas más expuestas a la IA. ¿Qué significa?',
  'entender-ia.desafio.11.a': 'Que la IA podría hacer una parte de esa tarea o cambiar cómo se hace.',
  'entender-ia.desafio.11.a.porque': 'Es información para decidir, no una sentencia.',
  'entender-ia.desafio.11.b': 'Que tu puesto va a desaparecer.',
  'entender-ia.desafio.11.b.porque': 'La exposición habla de tareas, no de puestos, y no dice qué va a pasar.',
  'entender-ia.desafio.11.c': 'Que ya no necesitas saber hacer esa tarea.',
  'entender-ia.desafio.11.c.porque': 'Al contrario: conocerla bien te ayuda a revisar lo que proponga la IA.',
  'entender-ia.desafio.12.pregunta':
    'En una reunión alguien dice: «Mejora el prompt y revisa el output». ¿Qué quiere decir?',
  'entender-ia.desafio.12.a': 'Que actualices el programa y lo vuelvas a instalar.',
  'entender-ia.desafio.12.a.porque':
    'No hay nada que instalar. Son las palabras inglesas para la instrucción y la respuesta.',
  'entender-ia.desafio.12.b': 'Que mejores lo que le pides a la IA y revises lo que te devuelve.',
  'entender-ia.desafio.12.b.porque':
    'El prompt es la instrucción que le das y el output, su respuesta. Pedir bien y revisar te toca a ti.',
  'entender-ia.desafio.12.c': 'Que cambies el asistente de IA por otro mejor.',
  'entender-ia.desafio.12.c.porque':
    'No hace falta cambiar de herramienta: se refiere a lo que le pides y a lo que te devuelve.',

  // ---------- Referencias con texto propio ----------
  'entender-ia.referencias.titulo': 'Referencias',
  'entender-ia.referencia.1': 'Russell, S. y Norvig, P. (2021). {0}, 4.ª ed. Pearson. Capítulos 19 a 21.',
  'entender-ia.referencia.3':
    'Gmyrek, P., Berg, J. y Bescond, D. (2023). {0}. ILO Working Paper 96. Ginebra: Organización Internacional del Trabajo. {1}',
  'entender-ia.referencia.5':
    'Reglamento (UE) 2024/1689 del Parlamento Europeo y del Consejo, de 13 de junio de 2024, de Inteligencia Artificial. Diario Oficial de la Unión Europea, serie L, 12 de julio de 2024. Artículos 3.1, 4, 14 y 113. {0} Los artículos 4 y 113 se citan con la redacción que les da el Reglamento (UE) 2026/1744, de 8 de julio de 2026 (Diario Oficial de la Unión Europea, serie L, 24 de julio de 2026). {1}',
  'entender-ia.referencia.6':
    'Universidad de Helsinki y MinnaLearn. {0} (curso en línea, versión para España), capítulo 1.1. {1}',
  'entender-ia.referencia.7': 'Maldita.es (24 de junio de 2025). {0}. {1}',
  'entender-ia.referencia.8': 'España Digital (27 de enero de 2026). {0}. {1}',
};
