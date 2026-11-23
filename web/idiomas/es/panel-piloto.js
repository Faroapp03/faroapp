// Textos del apartado Encuesta: rondas, lotes de invitaciones, enlaces, cierre y resultados de cada ronda.
/** @type {Readonly<Record<string,string>>} */
export const TEXTOS_PILOTO = {
  'panel.piloto.titulo': 'Encuesta de valoración',
  'panel.piloto.intro':
    'Cada uso de la encuesta con un grupo es una ronda. En la ronda abierta, crea un lote de invitaciones para cada entidad colaboradora y envíale sus enlaces. Cada enlace es para una sola persona: con él hace el recorrido y responde una encuesta anónima al terminar.',
  'panel.piloto.consultar': 'Consultar la encuesta',
  'panel.piloto.consulta-inicial': 'Consulta la encuesta para ver sus lotes y poder crear invitaciones.',
  'panel.piloto.consultando': 'Consultando la encuesta…',
  'panel.piloto.consultada-abierta': 'La ronda {nombre} está abierta. Puedes crear lotes de invitaciones.',
  'panel.piloto.consultada-cerrada': 'La ronda {nombre} está cerrada. Ya puedes ver y descargar sus resultados.',
  'panel.piloto.nuevo-lote': 'Nuevo lote de invitaciones',
  'panel.piloto.nombre': 'Nombre de la entidad colaboradora',
  'panel.piloto.nombre-ayuda': 'De 1 a 60 caracteres. Sirve para reconocer el lote y nombrar el archivo de enlaces.',
  'panel.piloto.quien': '¿Quién responderá?',
  'panel.piloto.tipo.participante': 'Participantes',
  'panel.piloto.tipo.profesional': 'Profesionales de orientación',
  'panel.piloto.cantidad': '¿Cuántas invitaciones?',
  'panel.piloto.cantidad-ayuda':
    'Entre 3 y 200. Con menos de 3, el uso del lote dejaría ver si una persona concreta ha respondido.',
  'panel.piloto.crear': 'Crear las invitaciones',
  'panel.piloto.creando': 'Creando las invitaciones…',
  'panel.piloto.creado': 'Se han creado {cantidad} invitaciones para {nombre}. Sus enlaces están debajo.',
  'panel.piloto.error.nombre':
    'Escribe el nombre de la entidad: de 1 a 60 caracteres, en una sola línea y sin tabuladores ni caracteres invisibles.',
  'panel.piloto.error.cantidad': 'Escribe un número entero de invitaciones entre {minimo} y {maximo}.',
  'panel.piloto.error.sin-conexion':
    'No hay conexión, así que no se ha creado nada. Comprueba la conexión y vuelve a intentarlo.',
  'panel.piloto.enlaces.titulo': 'Enlaces para {nombre} ({cantidad})',
  'panel.piloto.enlaces.aviso':
    'Estos enlaces solo se pueden ver ahora: Faro no los guarda y desaparecen al salir de este apartado. Cópialos o descárgalos antes de seguir. Si se pierden, crea otro lote.',
  'panel.piloto.enlaces.encabezado': 'Enlaces para enviar',
  'panel.piloto.enlaces.lista': 'Enlaces, uno por línea',
  'panel.piloto.copiar': 'Copiar todos los enlaces',
  'panel.piloto.descargar': 'Descargar los enlaces en un archivo de texto',
  'panel.piloto.olvidar': 'Ocultar y olvidar los enlaces',
  'panel.piloto.olvidados': 'Los enlaces se han retirado de la pantalla y no se pueden volver a ver.',
  'panel.piloto.copiados': 'Enlaces copiados. Pégalos en el correo a la entidad.',
  'panel.piloto.correo': 'Texto para el correo a la entidad',
  'panel.piloto.copiar-correo': 'Copiar el texto del correo',
  'panel.piloto.correo-copiado': 'Texto del correo copiado.',
  'panel.piloto.copia-manual':
    'No se ha podido copiar automáticamente. El texto está seleccionado: cópialo con el teclado.',
  'panel.piloto.correo.saludo': 'Hola, equipo de {nombre}:',
  'panel.piloto.correo.participante':
    'Os enviamos {cantidad} enlaces de invitación para el piloto de Faro. Cada enlace es para una sola persona: dadle uno a cada participante, sin anotar quién recibe cuál. Con su enlace, la persona hace el recorrido de Faro y, al terminar, responde unas pocas preguntas.',
  'panel.piloto.correo.profesional':
    'Os enviamos {cantidad} enlaces de invitación para profesionales de orientación del piloto de Faro. Cada enlace es para una sola persona: dadle uno a cada profesional, sin anotar quién recibe cuál. Con su enlace, responde unas pocas preguntas sobre la sesión.',
  'panel.piloto.correo.anonimo':
    'La encuesta es anónima: Faro no sabe qué enlace tiene cada persona ni guarda quién responde. Cada enlace sirve para responder una sola vez.',
  'panel.piloto.correo.contrasena':
    'Para entrar en Faro hace falta además la contraseña general del sitio, que os enviamos por separado.',
  'panel.piloto.correo.enlaces': 'Los enlaces van a continuación, uno por línea (o en el archivo adjunto):',
  'panel.piloto.correo.despedida': 'Gracias por colaborar.',
  'panel.piloto.lotes': 'Lotes de invitaciones',
  'panel.piloto.sin-lotes': 'Todavía no hay lotes de invitaciones.',
  'panel.piloto.sin-nombre': 'Sin nombre',
  'panel.piloto.columna.lote': 'Lote',
  'panel.piloto.columna.entidad': 'Entidad',
  'panel.piloto.columna.tipo': 'Para',
  'panel.piloto.columna.emitidas': 'Emitidas',
  'panel.piloto.columna.usadas': 'Usadas',
  'panel.piloto.columna.quedan': 'Sin usar',
  'panel.piloto.abierta':
    'Mientras la ronda está abierta no se muestran respuestas: comparar dos lecturas seguidas dejaría ver qué ha respondido una persona concreta. Los recuentos aparecen al cerrarla.',
  'panel.piloto.cerrar': 'Cerrar la ronda',
  'panel.piloto.cerrar-ayuda':
    'Ciérrala cuando el grupo haya terminado. Es definitivo para esta ronda: no se puede volver a abrir, pero después puedes abrir otra.',
  'panel.piloto.confirmar-cierre':
    '¿Quieres cerrar la ronda {nombre}? Es definitivo: no se podrá volver a abrir ni crear lotes nuevos en ella, y los enlaces que no se hayan usado dejarán de valer. Después podrás ver y descargar sus resultados y abrir otra ronda.',
  'panel.piloto.cerrando': 'Cerrando la ronda…',
  'panel.piloto.cerrada-ahora':
    'La ronda se ha cerrado. Los enlaces sin usar ya no valen. Los resultados están debajo.',
  'panel.piloto.cerrada':
    'Esta ronda está cerrada. Cada cifra dice cuántas personas eligieron esa respuesta y sobre cuántas se cuenta.',
  'panel.piloto.resultados.participante': 'Participantes',
  'panel.piloto.resultados.profesional': 'Profesionales de orientación',
  'panel.piloto.respuestas': 'Respuestas recibidas: {n}.',
  'panel.piloto.grupo-pequeno':
    'Solo hay {n} respuestas de este grupo. Con tan pocas, quien sepa quién respondió podría deducir respuestas concretas: compártelas con cuidado.',
  'panel.piloto.recuento': '{valor}: {n} de {total} ({porcentaje} %)',
  'panel.piloto.recuento-sin-base': '{valor}: {n} de {total}',
  'panel.piloto.cuestionario': 'Cuestionario: {id}.',
  'panel.piloto.metas-referencia':
    'Las metas del piloto aparecen como referencia. Con una muestra pequeña y elegida por invitación, un resultado describe a quienes respondieron y no se puede generalizar.',
  'panel.piloto.media': 'Media: {media} sobre 5, con {n} respuestas.',
  'panel.piloto.media-sin-respuestas': 'Media: todavía no hay respuestas.',
  'panel.piloto.meta.media': 'Meta del piloto: una media de al menos {objetivo} sobre 5.',
  'panel.piloto.meta.proporcion':
    'Meta del piloto: al menos el {objetivo} %. Resultado: {favorables} de {base} ({porcentaje} %).',
  'panel.piloto.meta.proporcion-sin-base':
    'Meta del piloto: al menos el {objetivo} %. Todavía no hay respuestas que cuenten para ella.',
  'panel.piloto.meta.fuera':
    'Quedan fuera de la base porque no llegaron a ver la propuesta de formación: {n} de {total}.',
  'panel.piloto.csv.cuestionario': 'Cuestionario de la encuesta',
  'panel.piloto.csv.media': 'Media sobre 5 (suma de puntos y respuestas)',
  'panel.piloto.csv.meta-media': 'Meta del piloto: media de al menos {objetivo} sobre 5',
  'panel.piloto.csv.meta-proporcion': 'Meta del piloto: al menos el {objetivo} % de respuestas favorables',
  'panel.piloto.csv.fuera': 'Fuera de la base: no llegaron a ver la propuesta de formación',
  'panel.piloto.error.cuestionario_anterior':
    'Esta instalación guarda respuestas de un cuestionario anterior, así que Faro no abre la encuesta para no mezclarlas con las del cuestionario actual. Vuelve a poner en marcha la versión de Faro que recogió esas respuestas, cierra allí la ronda abierta y descarga sus resultados; después, abre el cuestionario actual en una instalación nueva. La guía de la encuesta explica cada paso.',
  'panel.piloto.csv': 'Descargar los resultados (CSV)',
  'panel.piloto.archivo.enlaces': 'faro-invitaciones',
  'panel.piloto.archivo.resultados': 'faro-resultados',
  'panel.piloto.csv.emitidas': 'Invitaciones emitidas',
  'panel.piloto.csv.usadas': 'Invitaciones usadas',
  'panel.piloto.csv.respuestas': 'Respuestas recibidas',
  'panel.piloto.error.lote_demasiado_pequeno':
    'Un lote necesita al menos 3 invitaciones, para que su uso no deje ver si una persona concreta ha respondido. Escribe un número mayor.',
  'panel.piloto.error.encuesta_cerrada':
    'No hay ninguna ronda abierta, así que no se pueden crear lotes nuevos. Abre una ronda nueva para invitar a otro grupo.',
  'panel.piloto.error.limite_lotes':
    'Esta ronda ya tiene 50 lotes, el máximo. Si una entidad necesita más invitaciones, avisa al equipo técnico.',
  'panel.piloto.error.incierta':
    'No se ha podido confirmar la operación. Consulta la encuesta antes de repetirla: si se creó un lote, sus enlaces ya no se pueden ver y tendrás que crear otro.',
  'panel.deshacer.boton': 'Deshacer el último cambio',
  'panel.deshacer.cambiado':
    'La configuración ha cambiado desde tu cambio, así que ya no se puede deshacer. Revisa los valores actuales antes de volver a cambiarlos.',
  'panel.piloto.grupo-pequeno-uno':
    'Solo hay 1 respuesta de este grupo: quien sepa quién respondió podría saber qué contestó. Compártela con cuidado.',
  'panel.piloto.csv.fecha': 'Descargado: {fecha}, hora de Cataluña',
  'panel.piloto.rondas': 'Rondas de la encuesta',
  'panel.piloto.rondas-intro':
    'Cada uso de la encuesta con un grupo es una ronda, con sus invitaciones y sus resultados. Solo puede haber una ronda abierta a la vez, y los resultados de cada ronda se pueden consultar y descargar siempre.',
  'panel.piloto.columna.ronda': 'Ronda',
  'panel.piloto.columna.estado': 'Estado',
  'panel.piloto.columna.inicio': 'Apertura',
  'panel.piloto.columna.cierre': 'Cierre',
  'panel.piloto.columna.invitaciones': 'Invitaciones',
  'panel.piloto.columna.respuestas': 'Respuestas',
  'panel.piloto.columna.acciones': 'Resultados',
  'panel.piloto.ronda.abierta': 'Abierta',
  'panel.piloto.ronda.cerrada': 'Cerrada',
  'panel.piloto.ronda.sin-fecha': 'Sin dato',
  'panel.piloto.ronda.ver': 'Ver {nombre}',
  'panel.piloto.ronda.nueva': 'Abrir una ronda nueva',
  'panel.piloto.ronda.nombre': 'Nombre de la ronda',
  'panel.piloto.ronda.nombre-ayuda': 'De 1 a 60 caracteres; por ejemplo, el grupo o la entidad con que se hace.',
  'panel.piloto.ronda.abrir': 'Abrir la ronda',
  'panel.piloto.ronda.abriendo': 'Abriendo la ronda…',
  'panel.piloto.ronda.abierta-ahora': 'Se ha abierto la ronda {nombre}. Ya puedes crear sus lotes de invitaciones.',
  'panel.piloto.ronda.solo-cerrada': 'Para abrir una ronda nueva, cierra antes la ronda abierta.',
  'panel.piloto.error.nombre-ronda':
    'Escribe el nombre de la ronda: de 1 a 60 caracteres, en una sola línea y sin tabuladores ni caracteres invisibles.',
  'panel.piloto.error.ronda_abierta':
    'Ya hay una ronda abierta, así que no se ha abierto otra. Ciérrala antes de abrir la siguiente.',
  'panel.piloto.error.limite_rondas':
    'La encuesta ya tiene 20 rondas, el máximo. Si necesitas otra, avisa al equipo técnico.',
  'panel.encuesta.visibilidad.titulo': 'En la web',
  'panel.encuesta.visibilidad.interruptor': 'Visible en la web',
  'panel.encuesta.visibilidad.ayuda':
    'Oculta, la página de la encuesta se muestra como cualquier sección cerrada y el recorrido no la ofrece. Las invitaciones no se pierden: cuando vuelvas a mostrarla, los mismos enlaces servirán.',
  'panel.encuesta.visibilidad.visible': 'La encuesta está visible en la web.',
  'panel.encuesta.visibilidad.oculta': 'La encuesta está oculta en la web.',
  'panel.encuesta.visibilidad.sin-dato': 'Sin dato: consulta las secciones para saber si la encuesta está visible.',
  'panel.encuesta.ronda.titulo': 'Ronda en curso',
  'panel.encuesta.ronda.nombre': 'Nombre',
  'panel.encuesta.ronda.estado': 'Estado',
  'panel.encuesta.ronda.invitaciones': 'Invitaciones',
  'panel.encuesta.ronda.respuestas': 'Respuestas',
  'panel.encuesta.ronda.abierta': 'Abierta',
  'panel.encuesta.ronda.cerrada': 'Cerrada',
  'panel.encuesta.ronda.sin-dato': 'Sin dato',
};
