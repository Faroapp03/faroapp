// Textos del recorrido, la conversación y la hoja de ruta en castellano. Se incorporan al diccionario de es.js.

import { ERRORES_RECORRIDO } from './errores-recorrido.js';

/**
 * Los textos del recorrido, la conversación y la hoja de ruta, por clave: de solo lectura, los mismos para todas
 * las páginas (es.js los reúne en el diccionario).
 * @type {Readonly<Record<string, string>>}
 */
export const TEXTOS_RECORRIDO = {
  // ---------- El recorrido (recorrido.html y scripts/recorrido/) ----------
  'recorrido.abre-en-otra-pestana': 'Se abre en otra pestaña: tu conversación sigue en esta.',
  'recorrido.autor.faro': 'Faro',
  'recorrido.autor.persona': 'Tú',
  'recorrido.aviso-del-motor.datos-personales':
    'Faro ha quitado del texto procesado los datos personales que ha reconocido. Evita incluir datos personales.',
  'recorrido.aviso-del-motor.fuera-de-tema':
    'Solo puedo ayudarte con la descripción de tu trabajo. Cuéntame qué tareas haces.',
  'recorrido.ayuda.024':
    'Si estás pasando por un momento difícil, llama al {0}, la línea de atención a la conducta suicida: es gratuita, confidencial y está disponible las 24 horas del día, los 365 días del año. En caso de emergencia vital inminente, llama al {1}.',
  'recorrido.ayudas.boton': '{0}Ayuda',
  'recorrido.ayudas.cerrar': 'Cerrar la ayuda',
  'recorrido.ayudas.nota': 'Se añade a lo que llevas escrito. Tú decides cuándo enviarlo.',
  'recorrido.ayudas.relato.1': 'Trabajo como…',
  'recorrido.ayudas.relato.2': 'Me ocupo de…',
  'recorrido.ayudas.relato.3': 'En un día normal…',
  'recorrido.ayudas.relato.4': 'Lo que más tiempo me lleva es…',
  'recorrido.ayudas.relato.descripcion': 'Elige un comienzo y termínalo con tus palabras.',
  'recorrido.ayudas.tareas.1': 'Me encargo de…',
  'recorrido.ayudas.tareas.2': 'Cada día…',
  'recorrido.ayudas.tareas.3': 'Cada semana…',
  'recorrido.ayudas.tareas.4': 'A veces también…',
  'recorrido.ayudas.tareas.descripcion':
    'Una tarea se entiende mejor si dice qué haces. Elige un comienzo y termínalo.',
  'recorrido.ayudas.titulo': 'Ayuda para empezar',
  'recorrido.borrado-en-otra-pestana':
    'Has borrado tus datos de Faro en otra pestaña, así que aquí también he empezado de nuevo.',
  'recorrido.compositor.ampliar': 'Ampliar',
  'recorrido.compositor.aviso-ia': 'Faro es una IA y puede equivocarse.',
  'recorrido.compositor.contador': '{escritas} de {limite} caracteres',
  'recorrido.compositor.enter': 'Enter para enviar',
  'recorrido.compositor.enter-ampliado': '{tecla} + Enter para enviar',
  'recorrido.compositor.enviar': 'Enviar a Faro',
  'recorrido.compositor.etiqueta': 'Tu mensaje para Faro',
  'recorrido.compositor.maximo': 'Tu texto ya tiene el máximo de {maximo} caracteres.',
  'recorrido.compositor.ocupacion.etiqueta': 'A qué te dedicas',
  'recorrido.compositor.reducir': 'Reducir',
  'recorrido.compositor.respuesta.marcador': 'Escribe aquí tu respuesta…',
  'recorrido.compositor.sin-nombres': 'No hace falta que pongas tu nombre, el de tu empresa, compañeros o clientes.',
  'recorrido.compositor.tarea.marcador': '¿Haces algo más? Escríbelo aquí…',
  'recorrido.compositor.teclas':
    ' Enter envía y Mayúsculas más Enter hace un salto de línea; con la escritura ampliada, Enter hace un salto de línea y Control o Comando más Enter envía. ',
  'recorrido.compositor.traduccion': 'Títulos y tareas traducidos con IA',
  'recorrido.confirmar.alternativas': '¿O es alguno de estos?',
  'recorrido.confirmar.con-subgrupo':
    'La OIT no publica tareas de este tipo de trabajo. Puedes describir las tuyas y elegir una referencia oficial si corresponde; sin referencia acreditada quedarán sin nota.',
  'recorrido.confirmar.filtro': 'Busca tu ocupación en esta lista',
  'recorrido.confirmar.leyenda': 'Ocupaciones de este tipo de trabajo',
  'recorrido.confirmar.ninguna-pero-tipo': 'Ninguna de estas, pero es este tipo de trabajo',
  'recorrido.confirmar.queda-una': 'Queda una ocupación.',
  'recorrido.confirmar.quedan': 'Quedan {numero} ocupaciones.',
  'recorrido.confirmar.si-es-este': 'Sí, es este tipo de trabajo',
  'recorrido.confirmar.sin-referencias':
    'No hay tareas oficiales de referencia para este tipo de trabajo: las que describas se conservarán sin nota, como información insuficiente.',
  'recorrido.confirmar.sin-resultados':
    'Ninguna ocupación de este grupo contiene «{palabra}». Prueba con otra palabra o elige «Ninguna de estas, pero es este tipo de trabajo».',
  'recorrido.confirmar.sin-tareas':
    'La OIT no publica tareas de este tipo de trabajo: seguiremos con las tareas que me cuentes.',
  'recorrido.confirmar.tambien': 'También tendré en cuenta: {titulo}.',
  'recorrido.continuar': 'Continuar',
  'recorrido.conversacion.aviso':
    'Faro es una IA y puede equivocarse. No hace falta que pongas tu nombre ni el de tu empresa.',
  'recorrido.conversacion.hoy': 'Hoy',
  'recorrido.conversacion.titulo': 'Conversación con Faro',
  'recorrido.descripcion':
    'Faro: cuéntale a Faro a qué te dedicas, elige tu ocupación, marca tus tareas y recibe tu informe sobre la IA, tarea a tarea.',
  'recorrido.dialogo.aviso': 'Las notas vienen de la OIT; las tareas sin referencia oficial aparecen sin nota.',
  'recorrido.dialogo.enlaces': 'Más sobre Faro',
  'recorrido.dialogo.texto': 'Una conversación, cuatro pasos. Puedes volver atrás cuando quieras.',
  'recorrido.documento.hoja': '1 hoja',
  'recorrido.documento.hojas': '{numero} hojas',
  'recorrido.documento.imprimir': 'Guardar en PDF o imprimir',
  'recorrido.documento.leer': 'Leer el informe',
  'recorrido.documento.titulo': 'La IA y tu trabajo',
  ...ERRORES_RECORRIDO,
  'recorrido.espera.buscando-clasificacion': 'Buscando en la clasificación oficial…',
  'recorrido.espera.buscando-grupo': 'Buscando las ocupaciones de este tipo de trabajo…',
  'recorrido.espera.informe': 'Estoy preparando tu informe…',
  'recorrido.espera.leyendo-tareas': 'Leyendo lo que haces y buscando su tarea oficial…',
  'recorrido.espera.pensando': 'Estoy pensando en lo que me dices…',
  'recorrido.espera.preparando-tareas': 'Buscando las tareas oficiales de tu ocupación…',
  'recorrido.espera.terminando-informe': 'Estoy terminando tu informe…',
  'recorrido.explorar.buscar': 'Buscar en la clasificación oficial',
  'recorrido.explorar.candidatas': 'Por lo que me has dicho, podría ser una de estas',
  'recorrido.explorar.clasificacion': 'Clasificación oficial de ocupaciones',
  'recorrido.explorar.contar': 'Prefiero contártelo con mis palabras',
  'recorrido.explorar.dentro': 'Dentro de «{titulo}»',
  'recorrido.explorar.dentro-de': 'Dentro de «{titulo}», ¿cuál se parece más a tu trabajo?',
  'recorrido.explorar.inicio':
    'Esta es la clasificación oficial de ocupaciones. Elige el grupo que más se parece a tu trabajo: iremos de lo general a lo concreto.',
  'recorrido.explorar.limite':
    'Para no hacerte más preguntas, busquemos tu ocupación en la clasificación oficial, de lo general a lo concreto.',
  'recorrido.explorar.limite-candidatas':
    'Para no hacerte más preguntas, arriba tienes lo que encaja con lo que me has dicho.',
  'recorrido.explorar.nombre-candidata': '{titulo} · {grupo}',
  'recorrido.explorar.ocupaciones': '{numero} ocupaciones',
  'recorrido.explorar.si-no-es-ninguna':
    'Si no es ninguna, busca la tuya en la clasificación oficial, de lo general a lo concreto.',
  'recorrido.explorar.sin-grupo':
    'No he encontrado tu ocupación con esas palabras. Búscala en la clasificación oficial, de lo general a lo concreto, o cuéntamelo con tus palabras.',
  'recorrido.explorar.sin-grupo-candidatas':
    'No tengo claro de qué tipo es tu trabajo. Estas ocupaciones se parecen a lo que me dices.',
  'recorrido.explorar.una-ocupacion': 'Una ocupación',
  'recorrido.explorar.vacio': 'Aquí no hay más grupos. Vuelve atrás o cuéntamelo con tus palabras.',
  'recorrido.explorar.volvemos-a': 'Volvemos a «{titulo}».',
  'recorrido.explorar.volvemos-al-principio': 'Volvemos al principio de la clasificación oficial.',
  'recorrido.guia.alternar': 'Guía del recorrido',
  'recorrido.guia.lema': 'Un poco de claridad, paso a paso.',
  'recorrido.guia.mostrar': 'Mostrar la guía',
  'recorrido.guia.ocultar': 'Ocultar la guía',
  'recorrido.guia.titulo': 'Tu espacio',
  'recorrido.identidad.lema': 'Tu trabajo y la inteligencia artificial',
  'recorrido.agente.avanzamos': '¿Avanzamos hacia la parte de formación?',
  'recorrido.agente.encargando': 'Preparando tu informe',
  'recorrido.agente.entregando': 'Estoy preparando tu informe.',
  'recorrido.agente.fallo': 'No se ha podido terminar',
  'recorrido.agente.fallo-nota':
    'Puedes volver a intentarlo ahora o seguir con tu hoja de ruta. Al final te lo vuelvo a ofrecer.',
  'recorrido.agente.listo': 'Tu informe ya está listo.',
  'recorrido.agente.paralelo': 'Puedes continuar con tu hoja de ruta',
  'recorrido.agente.preparando': 'Faro está preparando tu informe en este momento.',
  'recorrido.agente.si': 'Sí, avancemos',
  'recorrido.agente.sin-terminar': 'Tu informe no se ha podido terminar.',
  'recorrido.agente.solo-informe': 'Ahora no, solo el informe',
  'recorrido.agente.terminado': 'Terminado · {numero} hojas',
  'recorrido.agente.terminado-una': 'Terminado · 1 hoja',
  'recorrido.agente.titulo': 'La IA y tu trabajo',
  'recorrido.agente.trabajando': 'En preparación',
  'recorrido.agente.ya-estaba-listo': 'Tu informe ya estaba listo',
  'recorrido.carpeta.aqui-dos': 'Aquí tienes tus dos documentos:',
  'recorrido.carpeta.aqui-informe': 'Aquí tienes tu informe:',
  'recorrido.carpeta.guardar-los-dos': 'Guardar los dos',
  'recorrido.carpeta.hoja-dos-cursos': 'Plan con dos cursos',
  'recorrido.carpeta.hoja-leer': 'Leer la hoja de ruta',
  'recorrido.carpeta.hoja-sin-documento': 'No he podido preparar este documento. Te lo explico justo debajo.',
  'recorrido.carpeta.hoja-titulo': 'Hoja de ruta',
  'recorrido.carpeta.hoja-un-curso': 'Plan con un curso',
  'recorrido.carpeta.justo-arriba': 'Tienes los dos documentos en tu carpeta, aquí arriba.',
  'recorrido.carpeta.titulo': 'Tu carpeta',

  'recorrido.hoja-doc.fallo':
    'No he podido preparar el documento de tu hoja de ruta. Tu hoja sigue confirmada: vuelve a intentarlo.',

  'recorrido.hoja-doc.lista': 'Ya está: aquí tienes tu hoja de ruta.',

  'recorrido.hoja.preparar': 'Preparar mi hoja de ruta',

  'recorrido.informe.fallo-al-prepararlo':
    'Faro no ha podido preparar tu informe completo. Puedes volver a intentarlo o preparar ahora un informe solo con las tareas oficiales que has marcado.',
  'recorrido.informe.hecho-sin-las-tuyas':
    'Este informe incluye solo las tareas oficiales que has marcado. Las que escribiste con tus palabras sin una tarea oficial se han quedado fuera esta vez.',
  'recorrido.informe.hecho-solo-oficiales': 'Aquí tienes tu informe con las tareas oficiales que has marcado.',
  'recorrido.informe.no-admitida':
    'No puedo preparar tu informe con tu tarea {numeros} tal como está escrita. Quítala, o vuelve a tus tareas y escríbela de otra manera.',
  'recorrido.informe.no-admitidas':
    'No puedo preparar tu informe con tus tareas {numeros} tal como están escritas. Quítalas, o vuelve a tus tareas y escríbelas de otra manera.',
  'recorrido.informe.otro-idioma':
    'Tu informe está escrito en el idioma en que lo pediste: cambiar el de la página no lo traduce. Vuelve a tus tareas y pídelo otra vez para leerlo en este idioma.',
  'recorrido.informe.pedir': 'Ver mi informe',
  'recorrido.informe.quitar-una': 'Quitarla y ver mi informe',
  'recorrido.informe.quitar-varias': 'Quitarlas y ver mi informe',
  'recorrido.informe.solo-oficiales': 'Prepararlo solo con las tareas oficiales',

  'recorrido.informe.sin-citar-una':
    'Tu tarea {numeros} va sin nota en tu informe: {motivo} Aparece como información insuficiente; si quieres, quítala o escríbela de otra manera.',
  'recorrido.informe.sin-citar-varias':
    'Tus tareas {numeros} van sin nota en tu informe: {motivo} Aparecen como información insuficiente; si quieres, quítalas o escríbelas de otra manera.',
  'recorrido.informe.sin-estimar-una':
    'La tarea que escribiste, «{tarea}», no corresponde a ninguna tarea oficial y por eso va sin nota: {motivo} En el informe aparece como información insuficiente.',
  'recorrido.informe.sin-estimar-varias':
    'Las {numero} tareas que escribiste ({tareas}) no corresponden a ninguna tarea oficial y por eso van sin nota: {motivo} En el informe aparecen como información insuficiente.',
  'recorrido.informe.sin-paso':
    'No he podido preparar tu informe: no ha llegado una parte de Faro. Comprueba tu conexión y vuelve a pulsar «Ver mi informe». Lo que llevas hecho sigue aquí.',
  'recorrido.informe.version-nueva':
    'No puedo preparar tu informe en esta página: Faro se ha actualizado mientras hacías el recorrido. Para seguir hay que volver a cargarla, y eso borra lo que llevas hecho: apunta antes lo que quieras conservar.',
  'recorrido.informe.volver-tareas': 'Volver a mis tareas',
  'recorrido.lector.faro': 'Faro: ',
  'recorrido.lector.persona': 'Tú: ',
  'recorrido.lista.y': '{inicio} y {ultimo}',

  'recorrido.motivo.contenido': 'Faro no puede valorar este texto.',
  'recorrido.motivo.otro': 'algo ha fallado en Faro.',
  'recorrido.motivo.salida': 'Faro no ha podido procesar esta tarea.',
  'recorrido.motivo.sin-estimacion-acreditada': 'Faro solo pone nota a las tareas oficiales.',
  'recorrido.motivo.sin-limpieza': 'no he podido preparar el filtro de datos personales en este dispositivo.',
  'recorrido.motivo.sin-referencias':
    'la OIT no publica tareas de referencia para tu tipo de trabajo ni para los parecidos.',
  'recorrido.motivo.tarda': 'la respuesta de Faro no ha llegado a tiempo.',
  'recorrido.nueva.borrar': 'Empezar de nuevo',
  'recorrido.nueva.boton': '{0}Nueva conversación',

  'recorrido.nueva.seguir': 'Seguir aquí',
  'recorrido.nueva.texto':
    'Se borrarán esta conversación y todo tu recorrido. Si prefieres, te quedas aquí y sigues cuando quieras.',
  'recorrido.nueva.titulo': 'Nueva conversación',
  'recorrido.ocupacion.buscar': 'Prefiero buscarla en la clasificación oficial',
  'recorrido.ocupacion.como-seguir': 'Entonces, ¿cómo prefieres seguir?',
  'recorrido.ocupacion.contar': 'Te lo cuento con mis palabras',
  'recorrido.ocupacion.creo-que': 'Creo que tu trabajo es de este tipo:',
  'recorrido.ocupacion.cual-es-la-tuya': '¿Cuál de estas ocupaciones es la tuya?',
  'recorrido.ocupacion.cuentame-mas': 'Cuéntame un poco más: ¿a qué te dedicas?',
  'recorrido.ocupacion.dicho-grupo': 'Mi trabajo es de este tipo: {titulo}',
  'recorrido.ocupacion.dicho-ninguna': 'No es ninguna de estas. Hazme más preguntas.',
  'recorrido.ocupacion.dicho-parecida': 'Se parece a «{titulo}», pero no es exactamente mi ocupación.',
  'recorrido.ocupacion.elige-en-lista': 'Si es así, elige tu ocupación en la lista.',
  'recorrido.ocupacion.elige-o-ninguna':
    'Elige tu ocupación en la lista o pulsa «Ninguna de estas, pero es este tipo de trabajo».',
  'recorrido.ocupacion.entendido': 'Entendido: «{titulo}».',
  'recorrido.ocupacion.es-tu-trabajo': '¿Es este tu trabajo?',
  'recorrido.ocupacion.grupo-te-dedicas': '«{titulo}». ¿Te dedicas a esto?',
  'recorrido.ocupacion.la-mas-parecida': 'La más parecida',
  'recorrido.ocupacion.leyenda': 'Las ocupaciones que te propongo',
  'recorrido.ocupacion.mas-preguntas': 'Hazme más preguntas para afinar',
  'recorrido.ocupacion.ninguna': 'Ninguna es la mía',
  'recorrido.ocupacion.ninguna-buscar': 'Ninguna de estas: prefiero buscar mi ocupación',
  'recorrido.ocupacion.ninguna-entendido':
    'De acuerdo, no es ninguna de estas. Te haré alguna pregunta más para afinar.',
  'recorrido.ocupacion.otra-cosa': 'No, es otra cosa',
  'recorrido.ocupacion.otra-vez': 'De acuerdo. Cuéntame otra vez a qué te dedicas.',
  'recorrido.ocupacion.otras-palabras': 'De acuerdo. Cuéntame con otras palabras a qué te dedicas.',
  'recorrido.ocupacion.parecida': 'Se parece a «{titulo}», pero no es exactamente esa',
  'recorrido.ocupacion.por-lo-que-dices': 'Por lo que me dices («{cita}»), creo que tu trabajo es de este tipo:',
  'recorrido.ocupacion.propuesta-una':
    'Por lo que me cuentas, creo que esta es tu ocupación. Si es así, pulsa «Continuar».',
  'recorrido.ocupacion.propuesta-varias':
    'Por lo que me cuentas, tu ocupación puede ser una de estas. He marcado la más parecida; si la tuya es otra, elígela. Después, pulsa «Continuar».',
  'recorrido.ocupacion.te-dedicas': '¿Te dedicas a esto?',
  'recorrido.ocupacion.te-dedicas-elige': '¿Te dedicas a esto? Si es así, elige tu ocupación en la lista.',
  'recorrido.ocupacion.volvemos-a-grupo': 'Volvemos a «{titulo}». ¿Te dedicas a esto?',
  'recorrido.ocupacion.volvemos-a-pregunta': 'Volvemos a mi pregunta.',
  'recorrido.pasar.aviso':
    'Quien escanee el código o reciba el enlace podrá ver tu informe con tu ocupación y las tareas oficiales que has elegido: el código no va cifrado. No lleva nada de lo que has escrito con tus palabras. Ese dispositivo puede recordar el enlace en su historial.',
  'recorrido.pasar.copiado': 'Enlace copiado.',
  'recorrido.pasar.copiar': 'Copiar el enlace',
  'recorrido.pasar.en-curso':
    'Para abrir el informe de otro dispositivo, empieza antes una conversación nueva y vuelve a abrir el enlace: así no se mezcla con este recorrido.',
  'recorrido.pasar.enlace': 'O abre este enlace en el otro dispositivo',
  'recorrido.pasar.entrada': 'Pasar a otro dispositivo',
  'recorrido.pasar.fallo': 'Ahora no puedo rehacer este informe. Vuelve a abrir el enlace en un momento.',
  'recorrido.pasar.no-valido':
    'Este código no se puede leer: puede estar dañado o incompleto. Pide uno nuevo en el otro dispositivo.',
  'recorrido.pasar.qr': 'Código QR con el enlace a tu informe. El mismo enlace está debajo.',
  'recorrido.pasar.recibido':
    'Este es el informe que has pasado desde otro dispositivo, rehecho aquí con los datos de Faro.',
  'recorrido.pasar.seleccionado': 'Enlace seleccionado: cópialo con el menú del navegador.',
  'recorrido.pasar.sin-viajar':
    'Las tareas que contaste con tus palabras se han quedado en el otro dispositivo: lo que escribes no viaja.',
  'recorrido.pasar.titulo': 'Pasar a otro dispositivo',
  'recorrido.paso.1.detalle': 'Cuéntame cómo trabajas',
  'recorrido.paso.1.nombre': 'Tu día a día',
  'recorrido.paso.2.detalle': 'Busco dónde encaja',
  'recorrido.paso.2.nombre': 'Tu ocupación',
  'recorrido.paso.3.detalle': 'Revisa lo que haces',
  'recorrido.paso.3.nombre': 'Tus tareas',
  'recorrido.paso.4.detalle': 'Resultados y orientación',
  'recorrido.paso.4.nombre': 'Tu informe',
  'recorrido.paso.pastilla': 'Paso {paso} de {total}',
  'recorrido.pasos.titulo': 'Tu recorrido',
  'recorrido.pensamiento.barra': 'Faro está pensando…',
  'recorrido.pensamiento.paso.analizar': 'Analizando tu respuesta',
  'recorrido.pensamiento.paso.clasificador': 'Contrastando el tipo de trabajo',
  'recorrido.pensamiento.paso.comparar': 'Comparando con las ocupaciones oficiales',
  'recorrido.pensamiento.paso.corregir': 'Corrigiendo la ortografía',
  'recorrido.pensamiento.paso.elegir': 'Eligiendo la más parecida',
  'recorrido.pensamiento.paso.ordenar': 'Ordenando las {numero} más parecidas',
  'recorrido.pensamiento.paso.preguntar': 'Preparando una pregunta',
  'recorrido.pensamiento.paso.significado': 'Buscando trabajos parecidos',
  'recorrido.pensamiento.paso.tareas-buscar': 'Buscando las tareas de tu ocupación',
  'recorrido.pensamiento.paso.tareas-cercana': 'Sumando las de una ocupación cercana',
  'recorrido.pensamiento.paso.tareas-reunir': 'Reuniendo {numero} tareas oficiales',
  'recorrido.pensamiento.pensando': 'Pensando…',
  'recorrido.pensamiento.resumen': 'Cómo lo he pensado',
  'recorrido.persona.mi-ocupacion': 'Mi ocupación: {titulo}',
  'recorrido.privacidad.boton': '{0}Privacidad',
  'recorrido.privacidad.local':
    'Faro es un sistema de IA con modelos propios que funcionan en este dispositivo. Utiliza datos oficiales para orientarte sobre tu trabajo. Evita escribir tu nombre, el de tu empresa, datos de salud o datos de otras personas.',
  'recorrido.privacidad.mas': 'Más sobre tus datos y tus derechos',
  'recorrido.privacidad.texto-2':
    'Lo que escribes solo vive en esta página: al cerrarla o al borrar tu informe, desaparece de Faro.',
  'recorrido.privacidad.titulo': 'Qué hacemos con tu texto',
  'recorrido.reintentar': 'Volver a intentarlo',
  'recorrido.revision.cambiada-una': 'Has cambiado una tarea: revisa su tarea oficial antes de pedir el informe.',
  'recorrido.revision.cambiadas': 'Has cambiado {numero} tareas: revisa su tarea oficial antes de pedir el informe.',
  'recorrido.revision.corta': 'Cada tarea necesita al menos {minimo} letras. Completa la tarea {numero}.',
  'recorrido.revision.falta-tiempo': 'Me falta saber cuánto tiempo dedicas a las {numero} tareas marcadas.',
  'recorrido.revision.falta-tiempo-una': 'Me falta saber cuánto tiempo dedicas a la tarea marcada.',
  'recorrido.revision.sin-tareas':
    'Necesito al menos una tarea para preparar tu informe. Escríbela abajo o añade una de la lista oficial.',
  'recorrido.saludo.hola': 'Hola, soy Faro.',
  'recorrido.saludo.pregunta': '¿A qué te dedicas?',
  'recorrido.saludo.tras-borrar':
    'He borrado nuestra conversación y todo lo que me habías contado. Empezamos de nuevo.',

  'recorrido.sin-textos': 'No se han podido cargar los textos de Faro. Comprueba tu conexión y {0}.',
  'recorrido.sin-textos.recargar': 'vuelve a cargar la página',
  'recorrido.tarea.cambiada':
    'Has cambiado la tarea: vuelve a elegir su tarea oficial. Sin una referencia, quedará sin nota.',
  'recorrido.tarea.cambiada-anuncio': 'Tarea {numero}: has cambiado el texto; vuelve a elegir su tarea oficial.',
  'recorrido.tarea.de-grupo': 'De: {grupo}',
  'recorrido.tarea.en-ingles': '{0} (en inglés)',
  'recorrido.tarea.en-ingles-en-lista': '{texto} (en inglés)',
  'recorrido.tarea.ninguna': 'Ninguna: conservar la tarea sin nota',
  'recorrido.tarea.nota-oit': 'Nota de la OIT: {nota}',
  'recorrido.tarea.numero': 'Tarea {numero}',
  'recorrido.tarea.oficial-etiqueta': 'Tarea oficial de la OIT que le corresponde',
  'recorrido.tarea.origen.elegida': 'Elegida por ti.',
  'recorrido.tarea.origen.propuesta': 'Propuesta de Faro. Puedes cambiarla.',
  'recorrido.tarea.origen.sin': 'Sin tarea oficial: se conserva el texto sin atribuirle una nota.',
  'recorrido.tarea.origen.ya-contada':
    'La referencia «{oficial}» ya se cuenta en otra tarea. Si es la misma tarea, retira esta para no contarla dos veces; si no, consérvala sin atribuirle esa referencia.',
  'recorrido.tarea.quitar': 'Quitar',
  'recorrido.tarea.quitar-nombre': 'Quitar la tarea {numero}',
  'recorrido.tarea.rotulo': '{nombre} · nota OIT {nota}',
  'recorrido.tarea.rotulo-grupo': '{nombre} · nota OIT {nota} · {grupo}',
  'recorrido.tarea.sin-oit':
    'La OIT no publica tareas de este grupo. Sin una referencia oficial acreditada, la tarea queda sin nota.',
  'recorrido.tarea.sin-referencias':
    'No hay una referencia oficial acreditada para esta tarea: en el informe aparecerá como información insuficiente.',
  'recorrido.tarea.ya-la-cuentas': 'Ya la cuentas en tu tarea «{tarea}».',
  'recorrido.tareas.algo-mas': '¿Haces algo más?',
  'recorrido.tareas.algo-mas-abajo': '¿Haces algo más? Pulsa «Añadir otra tarea» y cuéntamelo con tus palabras.',
  'recorrido.tareas.algo-mas-nota':
    'Pulsa «Añadir otra tarea» y escríbelo con tus palabras. Si corresponde a una tarea oficial, elígela en su lista; si no, se conserva en tu informe sin nota.',
  'recorrido.tareas.anadida': 'He añadido a tu lista {tareas}. ¿Cuánto tiempo le dedicas?',
  'recorrido.tareas.anadidas': 'He añadido a tu lista {tareas}. ¿Cuánto tiempo dedicas a cada una?',
  'recorrido.tareas.anadir': '{0}Añadir otra tarea',
  'recorrido.tareas.apuntado':
    'He apuntado también lo que me contaste, con la tarea oficial que le corresponde: puedes cambiarla.',
  'recorrido.tareas.apuntado-sin-oficial':
    'He conservado lo que escribiste. Elige una tarea oficial si corresponde; sin referencia, quedará sin nota.',
  'recorrido.tareas.aqui-tienes': 'Aquí tienes tus tareas. Cambia lo que quieras y vuelve a pedir tu informe.',
  'recorrido.tareas.aviso-ocupacion':
    'Ninguna de tus tareas coincide con las tareas oficiales de «{titulo}». Si no es tu ocupación, vuelve atrás y elige otra.',
  'recorrido.tareas.como': 'Como {titulo}',
  'recorrido.tareas.confirmado': 'Confirmado',
  'recorrido.tareas.confirmar': 'Confirmar',
  'recorrido.tareas.cuantas': '{numero} tareas',
  'recorrido.tareas.cuantas.0': 'ninguna tarea',
  'recorrido.tareas.cuantas.1': 'una sola tarea',
  'recorrido.tareas.cuantas.2': 'dos tareas',
  'recorrido.tareas.cuentame':
    'Cuéntame abajo tus tareas con tus palabras y dime cuánto tiempo dedicas a cada una: {estimacion}',
  'recorrido.tareas.debajo': 'Debajo, en «También hago…», están las de «{titulo}».',
  'recorrido.tareas.desmarcada': 'Tarea desmarcada.',
  'recorrido.tareas.estas-son':
    'Estas son las tareas oficiales de «{titulo}», según la Organización Internacional del Trabajo (OIT). Marca las que haces y dime cuánto tiempo dedicas a cada una.',

  'recorrido.tareas.falta.escribe': 'Cuéntame las tareas que haces.',
  'recorrido.tareas.falta.lista-una': 'Una tarea, todo listo.',
  'recorrido.tareas.falta.listas': '{numero} tareas, todo listo.',
  'recorrido.tareas.falta.marca': 'Marca las tareas que haces.',
  'recorrido.tareas.falta.tiempo': 'Falta el tiempo de {numero} tareas.',
  'recorrido.tareas.falta.tiempo-una': 'Falta el tiempo de una tarea.',
  'recorrido.tareas.limitado': 'Con {cuantas} el informe será muy limitado.',
  'recorrido.tareas.limitado-donde':
    'Con {cuantas} el informe será muy limitado. Marca las que hagas en la lista oficial o escribe otras abajo.',
  'recorrido.tareas.marcada': 'Tarea marcada. Indica debajo cuánto tiempo le dedicas.',
  'recorrido.tareas.mas-detalle':
    'Escríbeme la tarea con algo más de detalle; mejor si empieza por un verbo: «Preparar los pedidos».',
  'recorrido.tareas.maximo': 'Faro admite hasta {numero} tareas. Quita alguna si quieres añadir otra.',
  'recorrido.tareas.ninguna-donde':
    'Todavía no hay ninguna tarea. Marca las que hagas en la lista oficial o escribe otras abajo.',
  'recorrido.tareas.ninguna-escribe': 'Todavía no hay ninguna tarea. Escribe abajo la primera.',
  'recorrido.tareas.no-estimara':
    'Las tareas sin una referencia oficial acreditada se conservan sin nota, como información insuficiente.',
  'recorrido.tareas.oficiales-de': 'Tareas oficiales de «{titulo}»',
  'recorrido.tareas.oficiales-explicacion':
    'Marca las que haces. Las publica la OIT para este tipo de trabajo, cada una con su nota.',
  'recorrido.tareas.oficiales-secundario': 'Tareas oficiales de «{titulo}». Marca también las que haces.',
  'recorrido.tareas.que-mas':
    '¿Qué más haces? Escríbelo abajo con tus palabras; mejor si empieza por un verbo: «Preparar los pedidos».',
  'recorrido.tareas.quitada': 'Tarea {numero} quitada.',
  'recorrido.tareas.retirada':
    'He retirado de tu lista la tarea oficial que habías marcado para «{titulo}»: es de otro tipo de trabajo.',
  'recorrido.tareas.retiradas':
    'He retirado de tu lista las {numero} tareas oficiales que habías marcado para «{titulo}»: son de otro tipo de trabajo.',
  'recorrido.tareas.revisar': 'Revisar mi ocupación',
  'recorrido.tareas.sin-oficiales': 'La OIT no publica tareas oficiales para «{titulo}».',
  'recorrido.tareas.tambien-hago': 'También hago…',
  'recorrido.tareas.vacio': 'Todavía no hay tareas. Escribe abajo la primera.',
  'recorrido.tareas.ya-contada':
    '«{tarea}» se parece a «{oficial}», que ya cuentas: para no contarla dos veces, no la he enlazado.',
  'recorrido.tiempo.algo': 'Una parte',
  'recorrido.tiempo.mucho': 'La mayor parte',
  'recorrido.tiempo.poco': 'Muy poco',
  'recorrido.tiempo.pregunta': '¿Cuánto tiempo le dedicas?',
  'recorrido.titulo': 'Tu recorrido · Faro',
  'recorrido.titulo-principal': 'Tu recorrido con Faro',
  'recorrido.volver': 'Volver',
  'recorrido.volver-inicio': 'Volver al inicio de Faro',
  // Textos del motor local y su preparación.
  'recorrido.local.aclarar.texto': '¿Me cuentas qué haces en un día normal?',
  'recorrido.local.aclarar.titulo': 'No te he entendido del todo',
  'recorrido.local.comparacion-reducida':
    'Esta vez he podido comparar menos información de lo habitual. Revisa con atención la ocupación que te propongo.',
  'recorrido.local.cortesia.como-estas':
    '¡Hola! Muy bien, gracias. Cuéntame a qué te dedicas: tu puesto o lo que haces en un día normal.',
  'recorrido.local.cortesia.despedida':
    '¡Hasta pronto! Si quieres seguir, cuéntame a qué te dedicas: tu puesto o lo que haces en un día normal.',
  'recorrido.local.cortesia.gracias':
    '¡De nada! Cuando quieras, cuéntame a qué te dedicas: tu puesto o lo que haces en un día normal.',
  'recorrido.local.cortesia.saludo': '¡Hola! Cuéntame a qué te dedicas: tu puesto o lo que haces en un día normal.',
  'recorrido.local.cortesia.sobre-faro':
    'Soy Faro y no soy un chat: con lo que me cuentes de tu trabajo, busco tu ocupación y sus tareas oficiales. Cuéntame a qué te dedicas: tu puesto o lo que haces en un día normal.',
  'recorrido.local.familias.sin-entender':
    'Sigo sin entenderlo bien, perdona. Busquemos tu ocupación por familias: aquí están todas.',
  'recorrido.local.familias.tras-rechazos': 'No la he acertado. Busquemos tu ocupación por familias: aquí están todas.',
  'recorrido.local.grupo-oficial': 'Tipo de trabajo oficial: {grupo} (CIUO-08 {codigo})',
  'recorrido.local.guiado.cortesia':
    'Sigo aquí. Para no darte más vueltas, elige la familia de tu trabajo; también puedes escribir una palabra en el filtro.',
  'recorrido.local.guiado.sin-cambios':
    'Con lo que me cuentas sigo viendo lo mismo. Para no darte más vueltas, elige la familia de tu trabajo; también puedes escribir una palabra en el filtro o volver a lo que te proponía.',
  'recorrido.local.lo-cuento.anadido': 'Lo tengo en cuenta, junto con lo que ya me has dicho.',
  'recorrido.local.lo-cuento.boton': 'Lo cuento con mis palabras',
  'recorrido.local.lo-cuento.ejemplo': 'Por ejemplo: «Hago las nóminas y los contratos».',
  'recorrido.local.lo-cuento.etiqueta': 'Cuéntame qué haces, con tus palabras',
  'recorrido.local.preparando':
    'Faro se está preparando en tu dispositivo para entenderte sin enviar nada. Solo pasa la primera vez y puede tardar un poco: seguirá solo en cuanto esté listo.',
  'recorrido.local.preparando.anuncio': 'Preparando Faro: {porcentaje} %.',
  'recorrido.local.preparando.anuncio-listo': 'Faro está listo.',
  'recorrido.local.preparando.archivos': '{guardados} de {archivos} archivos',
  'recorrido.local.preparando.avance': 'Preparando Faro en tu dispositivo: {porcentaje} % ({detalle})',
  'recorrido.local.preparando.barra': 'Preparación de Faro en tu dispositivo',
  'recorrido.local.preparando.fase.datos': 'cargando los datos',
  'recorrido.local.preparando.fase.ia': 'cargando la IA de Faro',
  'recorrido.local.preparando.fase.listo': 'listo',
  'recorrido.local.preparando.fase.motor': 'preparando Faro para responder',
  'recorrido.local.preparando.fase.reintento': 'reintentando…',
  'recorrido.local.preparando.megas': '{hechos} de {total} MB',
};
