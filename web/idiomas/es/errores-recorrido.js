// Textos de errores y reparación del recorrido.

/** @type {Readonly<Record<string, string>>} */
export const ERRORES_RECORRIDO = {
  'recorrido.error.actualizar':
    'Esta página de Faro necesita actualizarse. Recárgala para seguir; al recargar se borra lo que llevas hecho.',
  'recorrido.error.cancelada': 'Petición cancelada.',
  'recorrido.error.contenido':
    'Faro no ha podido usar este texto. Escríbelo de otra manera, contando qué haces en tu trabajo, y vuelve a enviarlo.',
  'recorrido.error.formato': 'No he podido leer las tareas. Revísalas y vuelve a intentarlo.',
  'recorrido.error.generico': 'Algo ha fallado en Faro. Vuelve a intentarlo.',
  'recorrido.error.motor-no-coincide':
    'Es necesario reparar la copia de Faro guardada en este dispositivo. Conéctate a Internet y pulsa «Reparar Faro». Tus preferencias se conservarán. Al completar la reparación, esta conversación volverá a empezar.',
  'recorrido.reparar': 'Reparar Faro',
  'recorrido.reparando': 'Faro se está reparando…',
  'recorrido.reparado': 'Faro ya está reparado.',
  'recorrido.error.reparar-sin-completar': 'No se ha podido reparar Faro. Comprueba la conexión y vuelve a intentarlo.',
  'recorrido.error.reparar-no-coincide': 'No se ha podido reparar Faro ahora. Inténtalo de nuevo más tarde.',
  'recorrido.error.instalacion-no-coincide':
    'Faro no ha podido cargarse correctamente en este dispositivo. Inténtalo de nuevo más tarde.',
  'recorrido.error.motor-local':
    'Faro no ha podido responder en este dispositivo. Vuelve a intentarlo. Si sigue sin responder, recarga la página; al recargar se borra lo que llevas hecho.',
  'recorrido.error.reloj-atrasado':
    'La fecha de este dispositivo parece atrasada: es anterior a la de los datos de Faro. Corrige la fecha y la hora del dispositivo y vuelve a intentarlo.',
  'recorrido.error.sin-datos': 'Faro aún no ha terminado de prepararse. Vuelve a intentarlo dentro de un momento.',
  'recorrido.error.bloqueo': 'Faro no ha podido prepararse. Vuelve a intentarlo.',
  'recorrido.error.service-worker-no-disponible':
    'Este navegador no permite preparar Faro. Usa un navegador compatible para continuar.',
  'recorrido.error.sin-service-worker':
    'No he podido preparar Faro en este navegador. Vuelve a cargar la página para intentarlo de nuevo.',
  'recorrido.error.sin-resultado': 'Faro no ha podido obtener un resultado esta vez. Vuelve a intentarlo.',
  'recorrido.error.sin-limpieza':
    'No he podido preparar el texto en este dispositivo. Puedes buscar tu ocupación en la clasificación oficial o recargar la página y volver a intentarlo. Al recargar se borra lo que llevas hecho.',
  'recorrido.error.tarda': 'Faro está tardando demasiado en responder. Vuelve a intentarlo en unos minutos.',
};
