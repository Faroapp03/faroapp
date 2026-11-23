// Textos del registro de la última publicación de datos en el panel: fase, error, fechas y límite de la consulta.
/** @type {Readonly<Record<string,string>>} */
export const TEXTOS_PANEL_ACTIVACION = {
  'panel.activacion.consulta-inicial': 'Consulta la última publicación para ver qué ha anotado el servidor.',
  'panel.activacion.sin-registro': 'Todavía no consta ninguna publicación de datos.',
  'panel.activacion.fase.reservada': 'Publicación solicitada; todavía no consta como terminada.',
  'panel.activacion.fase.preparada': 'Publicación preparada; todavía no consta como terminada.',
  'panel.activacion.fase.subiendo-cursos':
    'Se está subiendo la formación; la publicación todavía no consta como terminada.',
  'panel.activacion.fase.cursos-subida': 'Formación subida; la publicación todavía no consta como terminada.',
  'panel.activacion.fase.promoviendo-cursos':
    'Se está publicando la formación nueva; mientras tanto, la formación puede figurar como no disponible.',
  'panel.activacion.fase.cursos-confirmado':
    'La formación nueva ya está publicada, pero no se mostrará hasta terminar de publicar el resto de la web; mientras tanto figura como no disponible.',
  'panel.activacion.fase-dos-servicios.subiendo':
    'Se está subiendo el resto de la web; hasta terminar, la formación figura como no disponible.',
  'panel.activacion.fase-dos-servicios.subida':
    'El resto de la web ya está subido, pero todavía no se ha publicado; hasta terminar, la formación figura como no disponible.',
  'panel.activacion.fase-dos-servicios.promoviendo':
    'Se está publicando el resto de la web; hasta terminar, la formación figura como no disponible.',
  'panel.activacion.fase.subiendo': 'Se están subiendo los datos; la publicación todavía no consta como terminada.',
  'panel.activacion.fase.subida': 'Datos subidos; la publicación todavía no consta como terminada.',
  'panel.activacion.fase.promoviendo': 'Publicación en curso; todavía no consta como terminada.',
  'panel.activacion.fase.confirmada': 'Publicación terminada según el registro del servidor.',
  'panel.activacion.fase.rechazada': 'La publicación no se ha completado según el registro del servidor.',
  'panel.activacion.fase.abandonada':
    'La publicación se ha cerrado sin terminar y se sigue sirviendo la versión anterior de la web.',
  'panel.activacion.abandono.a-mano':
    'Se ha cerrado a mano y se sigue sirviendo la versión anterior. Faro no volverá a intentarlo solo: para publicar estos datos, hazlo a mano siguiendo la guía de actualización remota.',
  'panel.activacion.abandono.rechazo-previo':
    'Se ha cerrado sola porque algo cambió en el alojamiento de la web antes de publicar, y la web no se llegó a modificar. Faro volverá a intentarlo solo en la próxima actualización.',
  'panel.activacion.abandono.rechazo-previo-sin-reintento':
    'Se ha cerrado sola porque algo cambió en el alojamiento de la web antes de publicar, y la web no se llegó a modificar. Faro no volverá a intentarlo solo: para publicar estos datos, hazlo a mano siguiendo la guía de actualización remota.',
  'panel.activacion.abandono.rechazo-previo-reintento':
    'El segundo intento también se ha cerrado porque algo cambió en el alojamiento de la web antes de publicar, y la web no se llegó a modificar. Faro no volverá a intentarlo solo: para publicar estos datos, hazlo a mano siguiendo la guía de actualización remota.',
  'panel.activacion.abandono.rechazo-proveedor':
    'Se ha cerrado sola porque el alojamiento de la web rechazó la publicación, y la web no se llegó a modificar. Faro no volverá a intentarlo solo: para publicar estos datos, hazlo a mano siguiendo la guía de actualización remota.',
  'panel.activacion.reintento':
    'Es el segundo intento de publicar unos datos que no se pudieron publicar la primera vez.',
  'panel.activacion.sin-publicar-reintento':
    'Hay datos validados sin publicar desde {v0}; Faro está volviendo a intentar publicarlos.',
  'panel.activacion.abandono.rechazo-previo-sin-artefacto':
    'Faro no ha podido volver a intentarlo porque el paquete ya no se conserva. Para publicar estos datos, hazlo a mano siguiendo la guía de actualización remota.',
  'panel.activacion.sin-publicar':
    'Hay datos validados sin publicar desde {v0}. Mientras tanto, la web sigue mostrando los anteriores.',
  'panel.activacion.detenida.rechazo-previo':
    'La publicación se ha detenido porque algo cambió en el alojamiento de la web antes de publicar, y no se llegó a hacer ese paso.',
  'panel.activacion.detenida.rechazo-proveedor':
    'La publicación se ha detenido porque el alojamiento de la web rechazó ese paso, y no se llegó a hacer.',
  'panel.activacion.detenida.cambiado':
    'Lo que sirve la web ha cambiado fuera de esta publicación. Comprueba qué versión sirve cada parte siguiendo la guía de actualización remota antes de terminarla o cerrarla.',
  'panel.activacion.detenida.desconocido':
    'No se ha podido comprobar qué sirve la web. Compruébalo siguiendo la guía de actualización remota antes de terminarla o cerrarla.',
  'panel.activacion.detenida.sin-formacion':
    'La formación nueva ya está publicada y figura como no disponible hasta terminar; el resto de la web sigue en la versión anterior. Para terminarla o volver atrás, sigue la guía de actualización remota.',
  'panel.activacion.error.candidato_no_verificable': 'No se han podido comprobar los datos que se iban a publicar.',
  'panel.activacion.error.despliegue_no_admitido': 'El alojamiento de la web no ha aceptado la publicación.',
  'panel.activacion.error.servido_distinto':
    'No se ha vuelto a intentar porque la web ha cambiado desde que se cerró la publicación, y así no se deshace lo que se haya publicado entre medias. Para publicar estos datos, hazlo a mano siguiendo la guía de actualización remota.',
  'panel.activacion.cierre.boton': 'Cerrar esta publicación',
  'panel.activacion.cierre.confirmar':
    'Faro cerrará esta publicación sin terminarla, y solo si la web sigue sirviendo la versión anterior. Para hacerlo, Faro pondrá en marcha una actualización; si encuentra datos nuevos, los publicará después. ¿Quieres cerrarla?',
  'panel.activacion.cierre.en-curso':
    'Has pedido cerrar esta publicación. Faro lo hará cuando termine la actualización que acaba de poner en marcha; verás aquí el resultado.',
  'panel.activacion.cierre.no-cumplido': 'El cierre que pediste no se ha llegado a hacer. Puedes volver a pedirlo.',
  'panel.activacion.cierre.sin-constancia':
    'La actualización que tenía que cerrar esta publicación ha terminado, pero el cierre todavía no consta. Si dentro de unos minutos sigue igual, vuelve a pedirlo.',
  'panel.activacion.cierre.web-cambiada':
    'No se ha cerrado porque la web ya no sirve la versión anterior. Comprueba qué versión sirve cada parte siguiendo la guía de actualización remota y vuelve a pedirlo.',
  'panel.activacion.cierre.ejecucion-en-curso':
    'Todavía no se puede cerrar porque la publicación sigue en marcha. Espera a que termine y vuelve a intentarlo.',
  'panel.activacion.cierre.sin-confirmacion':
    'No se ha podido comprobar si la publicación ha terminado. Vuelve a intentarlo en unos minutos.',
  'panel.activacion.cierre.no-despachado':
    'No se ha podido poner en marcha el cierre. Vuelve a intentarlo en unos minutos.',
  'panel.activacion.cierre.conflicto':
    'No se ha podido pedir el cierre porque la publicación o una actualización han cambiado mientras lo pedías. Revisa su estado y vuelve a intentarlo si hace falta.',
  'panel.activacion.limite':
    'Este registro no comprueba qué versión ven ahora las personas ni que todas las fuentes estén al día.',
  'panel.activacion.fechas': 'Registrada {v0}. Último cambio {v1}.',
  'panel.activacion.version': 'Versión registrada: {v0}.',
  'panel.activacion.despliegue': 'Despliegue registrado: {v0}.',
};
