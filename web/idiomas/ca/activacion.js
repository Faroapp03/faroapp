// Activación de una invitación institucional, sin recuperar secretos.
/** @type {Readonly<Record<string,string>>} */
export const TEXTOS_ACTIVACION = {
  'activacion.titulo': 'Activar l’accés · Faro',
  'activacion.descripcion': 'Activa l’accés de la teva institució a les dades de Faro.',
  'activacion.encabezado': 'Activar l’accés',
  'activacion.encabezado-nombre': 'Activar l’accés de {nombre}',
  'activacion.intro': 'Aquesta invitació permet generar una clau d’accés per a la teva institució.',
  'activacion.estado.consultando': 'Comprovant la invitació…',
  'activacion.estado.preparada': 'La invitació està disponible. Prem «Generar clau» quan puguis desar-la.',
  'activacion.estado.generando': 'Generant la clau. Espera la resposta sense tancar aquesta pàgina.',
  'activacion.estado.clave': 'Clau generada. L’enllaç ja s’ha consumit.',
  'activacion.estado.retirada':
    'La invitació s’ha retirat d’aquesta pàgina. Torna a obrir l’enllaç original si encara no l’has utilitzat.',
  'activacion.estado.invitacion-no-disponible':
    'La invitació no està disponible. Pot haver caducat o haver-se utilitzat. Demana una nova invitació.',
  'activacion.estado.servicio-no-disponible': 'No s’ha pogut comprovar la invitació. Torna-ho a provar.',
  'activacion.estado.sin-conexion': 'No es pot comprovar la invitació sense connexió. Connecta’t i torna-ho a provar.',
  'activacion.estado.respuesta-invalida': 'La resposta no permet comprovar la invitació. Demana una nova invitació.',
  'activacion.estado.resultado-desconocido':
    'No s’ha pogut confirmar la generació. La clau podria haver-se creat i no es pot recuperar. Demana una nova invitació; no tornis a utilitzar aquest enllaç.',
  'activacion.generar': 'Generar clau',
  'activacion.repetir': 'Tornar a comprovar',
  'activacion.caduca': 'La invitació caduca {fecha}.',
  'activacion.clave.titulo': 'Desa les teves credencials',
  'activacion.clave.una-vez': 'Desa els dos valors ara. Faro no pot tornar a mostrar-los.',
  'activacion.cliente': 'Identificador de la institució (client_id)',
  'activacion.secreto': 'Clau secreta (client_secret)',
  'activacion.servidor':
    'La clau es desa només al servidor de la teva institució. No la incloguis mai en un web ni en codi que s’executi en un navegador.',
  'activacion.copiar': 'Copiar credencials',
  'activacion.copiado': 'Credencials copiades. Desa-les al servidor de la teva institució.',
  'activacion.copia-manual': 'Copia i desa l’identificador i la clau secreta. Pots seleccionar cada camp.',
  'activacion.enlace':
    'L’enllaç caduca al cap de set dies i es consumeix en generar la clau. Si perds la clau o la resposta no arriba, demana una nova invitació a qui administra Faro.',
  'activacion.sin-script':
    'Activa JavaScript per fer servir la invitació. L’enllaç no es consumeix en obrir aquesta pàgina.',
};
