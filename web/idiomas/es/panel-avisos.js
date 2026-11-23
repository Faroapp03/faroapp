// La tarjeta «Avisos» del panel y el estado de cada canal en la comprobación del vigilante.
export const TEXTOS_AVISOS = {
  'panel.avisos.titulo': 'Avisos',
  'panel.avisos.intro':
    'Si la actualización de los datos se para o necesita atención, Faro te avisa por correo. Aquí eliges a qué dirección llegan los avisos.',
  'panel.avisos.campo': 'Dirección de correo',
  'panel.avisos.guardar': 'Guardar',
  'panel.avisos.probar': 'Enviar un aviso de prueba',
  'panel.avisos.quitar': 'Quitar',
  'panel.avisos.reintentar': 'Volver a consultar',
  'panel.avisos.en-curso.leer': 'Consultando a dónde llegan los avisos…',
  'panel.avisos.en-curso.cambiar': 'Guardando la dirección…',
  'panel.avisos.en-curso.quitar': 'Quitando la dirección…',
  'panel.avisos.en-curso.probar': 'Enviando el aviso de prueba…',
  'panel.avisos.resumen.sin_destino':
    'Todavía no hay ninguna dirección: nadie recibirá un aviso si la actualización se para. Escribe una dirección y guárdala.',
  'panel.avisos.resumen.pendiente':
    'Los avisos irán a {correo} cuando la confirmes. Pendiente de confirmar: envía un aviso de prueba.',
  'panel.avisos.resumen.verificado': 'Los avisos llegan a {correo}.',
  'panel.avisos.resumen.no-leido':
    'No se ha podido consultar a dónde llegan los avisos. Comprueba la conexión y pulsa «Volver a consultar».',
  'panel.avisos.resumen.no-disponible':
    'Esta instalación de Faro no envía avisos por correo, así que aquí no se puede guardar ninguna dirección.',
  'panel.avisos.resultado.guardado': 'Has guardado la dirección. Para confirmarla, envía un aviso de prueba.',
  'panel.avisos.resultado.quitado': 'Has quitado la dirección. Ya no llegará ningún aviso por correo.',
  'panel.avisos.resultado.conflicto':
    'Alguien cambió la dirección mientras tanto: revisa la nueva antes de volver a guardar.',
  'panel.avisos.resultado.correo-invalido':
    'Esa dirección no es válida. Escríbela con la forma nombre@dominio, sin espacios, y vuelve a guardarla.',
  'panel.avisos.resultado.vacio': 'Escribe una dirección de correo antes de guardar.',
  'panel.avisos.resultado.prueba-enviada':
    'Hemos enviado el aviso de prueba y la dirección ha quedado confirmada: desde ahora los avisos llegarán ahí. Si no lo encuentras, mira en la carpeta de correo no deseado.',
  'panel.avisos.resultado.prueba-fallida': 'El aviso de prueba no se pudo entregar. {motivo}',
  'panel.avisos.resultado.prueba-no-enviada': 'No se ha enviado el aviso de prueba. {motivo}',
  'panel.avisos.resultado.fallo':
    'No se ha podido completar la acción. Comprueba la conexión y vuelve a intentarlo dentro de un momento.',
  'panel.avisos.resultado.desconocido':
    'No sabemos si el cambio se ha completado. Pulsa «Volver a consultar» para ver la dirección actual antes de intentarlo otra vez.',
  'panel.avisos.confirmar.guardar':
    'Los avisos llegarán a {correo}. Para confirmar la dirección, después tendrás que enviar un aviso de prueba.',
  'panel.avisos.confirmar.quitar':
    'Vas a quitar la dirección {correo}. Nadie recibirá un aviso por correo si la actualización se para. ¿Quieres quitarla?',
  'panel.avisos.canal.no-configurado':
    'Esta instalación de Faro todavía no puede enviar avisos por correo. Puedes guardar la dirección: los avisos saldrán cuando quien mantiene el servicio active el envío.',
  'panel.avisos.canal.remitente-no-admitido':
    'Los avisos por correo no pueden salir porque la dirección desde la que los envía Faro no es del dominio del servicio. Pide a quien mantiene el servicio que la corrija.',
  'panel.avisos.ultimo.enviado': 'El último aviso se envió {fecha}.',
  'panel.avisos.ultimo.fallido': 'El último aviso no se pudo entregar {fecha}. {motivo}',
  'panel.avisos.comprobaciones-desactivadas':
    'Ahora mismo no saldrá ningún aviso, porque las comprobaciones automáticas de la actualización están desactivadas. Puedes guardar la dirección igualmente: los avisos llegarán cuando se vuelvan a activar.',
  'panel.avisos.motivo.remitente-no-configurado':
    'El servicio de correo de Faro todavía no está preparado para enviar avisos. Pide a quien mantiene el servicio que termine de configurarlo.',
  'panel.avisos.motivo.destinatario-no-permitido':
    'El servicio de correo todavía no admite esta dirección. Pide a quien mantiene el servicio que la dé de alta y vuelve a probar.',
  'panel.avisos.motivo.limite-alcanzado':
    'Se han enviado demasiados correos en poco tiempo. Espera un rato y vuelve a probar.',
  'panel.avisos.motivo.rechazo-del-destino':
    'El buzón de esta dirección no ha aceptado el aviso. Comprueba que la dirección está bien escrita y que el buzón no está lleno.',
  'panel.avisos.motivo.error-temporal':
    'El servicio de correo ha tenido un problema pasajero. Vuelve a probar dentro de unos minutos.',
  'panel.avisos.motivo.plazo-agotado':
    'El servicio de correo ha tardado demasiado en responder. Vuelve a probar dentro de unos minutos.',
  'panel.avisos.motivo.envio-rechazado':
    'El servicio de correo no ha aceptado el aviso. Vuelve a probar más tarde; si se repite, pide a quien mantiene el servicio que lo revise.',
  'panel.avisos.motivo.destino-no-admitido':
    'Esta dirección no se puede usar para enviar avisos. Escribe otra con la forma nombre@dominio y guárdala.',
  'panel.avisos.motivo.sin-destino': 'Todavía no hay ninguna dirección. Guarda una antes de enviar el aviso de prueba.',
  'panel.avisos.motivo.destino-sin-verificar':
    'La dirección todavía no está confirmada. Envía un aviso de prueba para confirmarla.',
  'panel.avisos.motivo.canal-no-configurado':
    'Esta instalación de Faro todavía no puede enviar correos. Pide a quien mantiene el servicio que active el envío de avisos.',
  'panel.avisos.motivo.limite-de-pruebas':
    'Se ha enviado un aviso de prueba hace muy poco. Espera diez minutos y vuelve a probar.',
  'panel.vigilante.avisos.ninguno':
    'Los avisos no están configurados: nadie recibirá un aviso si la actualización se para. Para activarlos, guarda una dirección de correo en «Avisos».',
  'panel.vigilante.avisos.correo.no-configurado': 'Esta instalación de Faro ya no puede enviar avisos por correo.',
  'panel.vigilante.avisos.correo.remitente-no-admitido':
    'Los avisos por correo no pueden salir: la dirección desde la que los envía Faro no es del dominio del servicio. Pide a quien mantiene el servicio que la corrija.',
  'panel.vigilante.avisos.correo.sin-destino':
    'Todavía no hay ninguna dirección para los avisos por correo. Guárdala en «Avisos».',
  'panel.vigilante.avisos.correo.pendiente':
    'La dirección de los avisos por correo está pendiente de confirmar: envía un aviso de prueba desde «Avisos».',
  'panel.vigilante.avisos.correo.verificado': 'Los avisos llegan por correo a la dirección confirmada en «Avisos».',
  'panel.vigilante.avisos.correo.intento.enviado': 'El último aviso por correo se envió {fecha}.',
  'panel.vigilante.avisos.correo.intento.fallido':
    'El último aviso por correo no se pudo entregar {fecha}. {motivo} Se volverá a intentar en la próxima comprobación diaria.',
  'panel.vigilante.avisos.url.no-configurados': 'Los avisos a la dirección web del servicio ya no están configurados.',
  'panel.vigilante.avisos.url.configurados': 'Los avisos también llegan a la dirección web configurada en el servicio.',
  'panel.vigilante.avisos.url.destino-no-admitido':
    'La dirección web de los avisos no es válida: tiene que empezar por https y no incluir usuario ni contraseña. Pide a quien mantiene el servicio que la corrija.',
  'panel.vigilante.avisos.url.intento.enviado': 'El último aviso a la dirección web se envió {fecha}.',
  'panel.vigilante.avisos.url.intento.fallido.respuesta-no-admitida':
    'El último aviso a la dirección web no se pudo entregar {fecha}: el servicio que recibe los avisos no lo aceptó. Se volverá a intentar en la próxima comprobación diaria.',
  'panel.vigilante.avisos.url.intento.fallido.sin-respuesta':
    'El último aviso a la dirección web no se pudo entregar {fecha}: el servicio que recibe los avisos no respondió. Se volverá a intentar en la próxima comprobación diaria.',
  'panel.vigilante.avisos.url.intento.fallido.plazo-agotado':
    'El último aviso a la dirección web no se pudo entregar {fecha}: el servicio que recibe los avisos tardó demasiado. Se volverá a intentar en la próxima comprobación diaria.',
  'panel.vigilante.avisos.url.intento.fallido.destino-no-admitido':
    'El último aviso a la dirección web no se envió {fecha} porque la dirección no es válida. Pide a quien mantiene el servicio que la corrija.',
};
