// Activación de una invitación institucional, sin recuperar secretos.
/** @type {Readonly<Record<string,string>>} */
export const TEXTOS_ACTIVACION = {
  'activacion.titulo': 'Activar el acceso · Faro',
  'activacion.descripcion': 'Activa el acceso de tu institución a los datos de Faro.',
  'activacion.encabezado': 'Activar el acceso',
  'activacion.encabezado-nombre': 'Activar el acceso de {nombre}',
  'activacion.intro': 'Esta invitación permite generar una clave de acceso para tu institución.',
  'activacion.estado.consultando': 'Comprobando la invitación…',
  'activacion.estado.preparada': 'La invitación está disponible. Pulsa «Generar clave» cuando puedas guardarla.',
  'activacion.estado.generando': 'Generando la clave. Espera la respuesta sin cerrar esta página.',
  'activacion.estado.clave': 'Clave generada. El enlace ya se ha consumido.',
  'activacion.estado.retirada':
    'La invitación se ha retirado de esta página. Vuelve a abrir el enlace original si aún no lo has utilizado.',
  'activacion.estado.invitacion-no-disponible':
    'La invitación no está disponible. Puede haber caducado o haberse utilizado. Pide una nueva invitación.',
  'activacion.estado.servicio-no-disponible': 'No se ha podido comprobar la invitación. Vuelve a intentarlo.',
  'activacion.estado.sin-conexion':
    'No se puede comprobar la invitación sin conexión. Conéctate y vuelve a intentarlo.',
  'activacion.estado.respuesta-invalida': 'La respuesta no permite comprobar la invitación. Pide una nueva invitación.',
  'activacion.estado.resultado-desconocido':
    'No se ha podido confirmar la generación. La clave podría haberse creado y no se puede recuperar. Pide una nueva invitación; no vuelvas a usar este enlace.',
  'activacion.generar': 'Generar clave',
  'activacion.repetir': 'Volver a comprobar',
  'activacion.caduca': 'La invitación caduca {fecha}.',
  'activacion.clave.titulo': 'Guarda tus credenciales',
  'activacion.clave.una-vez': 'Guarda los dos valores ahora. Faro no puede volver a mostrarlos.',
  'activacion.cliente': 'Identificador de la institución (client_id)',
  'activacion.secreto': 'Clave secreta (client_secret)',
  'activacion.servidor':
    'La clave se guarda solo en el servidor de tu institución. Nunca la incluyas en una web ni en código que se ejecute en un navegador.',
  'activacion.copiar': 'Copiar credenciales',
  'activacion.copiado': 'Credenciales copiadas. Guárdalas en el servidor de tu institución.',
  'activacion.copia-manual': 'Copia y guarda el identificador y la clave secreta. Puedes seleccionar cada campo.',
  'activacion.enlace':
    'El enlace caduca a los siete días y se consume al generar la clave. Si pierdes la clave o la respuesta no llega, pide una nueva invitación a quien administra Faro.',
  'activacion.sin-script': 'Activa JavaScript para usar la invitación. El enlace no se consume al abrir esta página.',
};
