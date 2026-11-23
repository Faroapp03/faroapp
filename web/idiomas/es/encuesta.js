// Textos de la encuesta del piloto (encuesta.html y scripts/encuesta.js) en castellano. Se incorporan al diccionario
// de es.js.

/**
 * Diccionario de solo lectura (clave -> texto) en castellano con los textos de la encuesta.
 * @type {Readonly<Record<string, string>>}
 */
export const TEXTOS_ENCUESTA = {
  'encuesta.titulo': 'Encuesta · Faro',
  'encuesta.descripcion':
    'Cuéntanos con unas pocas respuestas cerradas qué te ha parecido Faro. La encuesta es anónima.',
  'encuesta.rotulo': 'Encuesta',
  'encuesta.titulo-principal': 'Tu opinión sobre Faro',
  'encuesta.entradilla':
    'Esta encuesta nos ayuda a saber si Faro te ha servido y qué debemos mejorar. Son cinco preguntas cerradas y se responden en menos de dos minutos. Es anónima: no te pedimos tu nombre ni ningún dato sobre ti, y Faro solo guarda cuántas veces se ha elegido cada respuesta. Responder es voluntario: puedes dejarla cuando quieras sin enviar nada. Puedes leer {0}.',
  'encuesta.entradilla-profesional':
    'Esta encuesta recoge tu valoración como profesional de orientación después de usar Faro en tus sesiones. Son cinco preguntas cerradas y se responden en unos dos minutos. Es anónima y voluntaria: no te pedimos tu nombre ni el de tu entidad, y Faro solo guarda cuántas veces se ha elegido cada respuesta.',
  'encuesta.entradilla.enlace': 'cómo se protegen tus respuestas',
  'encuesta.codigo.titulo': 'Tu código',
  'encuesta.codigo.ayuda':
    'Pega o escribe el código de tu invitación. Si abres esta página con tu enlace de invitación, el código ya está puesto.',
  'encuesta.codigo.etiqueta': 'Código de la invitación',
  'encuesta.codigo.formato': 'Empieza por PART o PROF y sigue con siete grupos de cuatro letras o cifras.',
  'encuesta.codigo.continuar': 'Continuar',
  'encuesta.codigo.cambiar': 'Usar otro código',
  'encuesta.escala.1': 'Nada',
  'encuesta.escala.2': 'Poco',
  'encuesta.escala.3': 'Algo',
  'encuesta.escala.4': 'Bastante',
  'encuesta.escala.5': 'Mucho',
  'encuesta.participante.titulo': 'Tus respuestas',
  'encuesta.participante.informe': '¿Has podido ver tu informe de Faro?',
  'encuesta.participante.informe.visto': 'Sí, he visto mi informe',
  'encuesta.participante.informe.sin-ver': 'No he podido llegar a verlo',
  'encuesta.participante.ocupacion': '¿La ocupación que aparece en tu informe se corresponde con tu trabajo?',
  'encuesta.participante.ocupacion.si': 'Sí',
  'encuesta.participante.ocupacion.en-parte': 'En parte',
  'encuesta.participante.ocupacion.no': 'No',
  'encuesta.participante.comprension':
    '¿Cuánto te ha ayudado tu informe a entender cómo puede cambiar la IA las tareas de tu trabajo?',
  'encuesta.participante.formacion': '¿Cuánto te ha ayudado Faro a decidir qué formación buscar?',
  'encuesta.participante.formacion.sin-ver': 'No he llegado a ver la propuesta de formación',
  'encuesta.participante.dificultad': '¿Qué parte te ha costado más?',
  'encuesta.participante.dificultad.describir-trabajo': 'Describir mi trabajo',
  'encuesta.participante.dificultad.elegir-tareas': 'Elegir mis tareas',
  'encuesta.participante.dificultad.entender-informe': 'Entender el informe',
  'encuesta.participante.dificultad.encontrar-formacion': 'Encontrar formación que me encaje',
  'encuesta.participante.dificultad.nada': 'Nada en especial',
  'encuesta.profesional.titulo': 'Tu valoración como profesional',
  'encuesta.profesional.ayuda-orientacion':
    '¿Cuánto te ha ayudado Faro en tu trabajo de orientación con las personas que has atendido?',
  'encuesta.profesional.explicar-cambio':
    '¿Cuánto te ha ayudado Faro a explicar cómo puede cambiar la IA las tareas de cada persona?',
  'encuesta.profesional.encaje-formacion':
    '¿Hasta qué punto encaja la formación que propone Faro con lo que necesitaban esas personas?',
  'encuesta.profesional.fiabilidad': '¿Hasta qué punto te parece fiable la información que muestra Faro?',
  'encuesta.profesional.mejora': '¿Qué mejorarías primero para usar Faro en tus sesiones?',
  'encuesta.profesional.mejora.explicacion-informe': 'La explicación del informe',
  'encuesta.profesional.mejora.ocupacion': 'La ocupación que propone',
  'encuesta.profesional.mejora.datos-fuentes': 'Los datos y sus fuentes',
  'encuesta.profesional.mejora.formacion': 'La propuesta de formación',
  'encuesta.profesional.mejora.uso-sesion': 'Su uso durante la sesión',
  'encuesta.profesional.mejora.accesibilidad': 'La accesibilidad',
  'encuesta.profesional.mejora.nada': 'Nada en especial',
  'encuesta.enviar': 'Enviar mis respuestas',
  'encuesta.estado.enviando': 'Enviando tus respuestas…',
  'encuesta.estado.codigo-formato':
    'Este código no tiene la forma de los códigos de la encuesta. Revisa que lo has copiado entero, tal como aparece en tu invitación.',
  'encuesta.estado.codigo-no-valido':
    'Este código no sirve: puede que esté mal escrito, que ya se haya usado o que la encuesta haya terminado. Revisa que lo has escrito tal como aparece en tu invitación; si tu enlace ya se usó, pide otro a quien te lo envió.',
  'encuesta.estado.faltan': 'Falta alguna respuesta. Elige una opción en cada pregunta y vuelve a enviar.',
  'encuesta.estado.muchos':
    'Ahora mismo llegan muchas respuestas a la vez. Espera un minuto y vuelve a enviar las tuyas.',
  'encuesta.estado.sin-conexion':
    'No se han podido enviar tus respuestas. Comprueba la conexión y vuelve a intentarlo: siguen marcadas.',
  'encuesta.estado.no-disponible':
    'Ahora mismo Faro no puede recibir respuestas. Vuelve a intentarlo en unos minutos: siguen marcadas.',
  'encuesta.gracias.titulo': 'Gracias por tu tiempo',
  'encuesta.gracias.texto':
    'Tus respuestas se han sumado a las del resto; Faro no guarda qué ha respondido cada persona. Tu código ya no sirve y puedes cerrar esta página.',
};
