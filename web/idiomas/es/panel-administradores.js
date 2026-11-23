// Administradores del Panel de Control: lista, alta, retirada, avisos y la página para quien no puede entrar.
export const TEXTOS_ADMINISTRADORES = {
  'panel.administradores.titulo': 'Administradores',
  'panel.administradores.explicacion':
    'Quién puede entrar en el Panel de Control. Cada administrador entra con su correo y un segundo factor; para añadir o retirar a alguien necesitas tener abierta la sesión única.',
  'panel.administradores.resumen.total.uno': '{cantidad} administrador',
  'panel.administradores.resumen.total.varios': '{cantidad} administradores',
  'panel.administradores.resumen.pendientes.uno': '{cantidad} invitación pendiente',
  'panel.administradores.resumen.pendientes.varios': '{cantidad} invitaciones pendientes',
  'panel.administradores.leyendo': 'Estamos leyendo la lista de administradores; aparecerá aquí en unos segundos.',
  'panel.administradores.releer': 'Volver a leer la lista',
  'panel.administradores.error.lectura':
    'No se ha podido leer la lista de administradores. Vuelve a leerla con el botón de abajo dentro de unos minutos.',
  'panel.administradores.csv.usuario': 'Usuario',
  'panel.administradores.csv.estado': 'Estado',
  'panel.administradores.csv.anadido-por': 'Añadido por',
  'panel.administradores.csv.fecha': 'Fecha de alta',
  'panel.administradores.csv.entrada': 'Última entrada',
  'panel.administradores.csv.segundo-factor': 'Segundo factor',
  'panel.administradores.csv.si': 'Sí',
  'panel.administradores.csv.no': 'No',
  'panel.administradores.tu': 'tú',
  'panel.administradores.columna.usuario': 'Usuario',
  'panel.administradores.columna.estado': 'Estado',
  'panel.administradores.columna.anadido': 'Añadido',
  'panel.administradores.columna.entrada': 'Última entrada',
  'panel.administradores.columna.accion': 'Retirar',
  'panel.administradores.estado.activo': 'Activo',
  'panel.administradores.estado.pendiente': 'Pendiente',
  'panel.administradores.estado.retirada-pendiente': 'Retirada pendiente en Cloudflare',
  'panel.administradores.anadido.instalacion': 'al instalar el servicio',
  'panel.administradores.anadido.por': 'por {correo}',
  'panel.administradores.entrada.nunca': 'Todavía no ha entrado',
  'panel.administradores.entrada.con-segundo-factor': 'con segundo factor',
  'panel.administradores.entrada.sin-segundo-factor': 'sin segundo factor',
  'panel.administradores.retirar': 'Retirar',
  'panel.administradores.retirar-a': 'Retirar a {correo}',
  'panel.administradores.reintentar': 'Reintentar',
  'panel.administradores.reintentar-a': 'Reintentar en Cloudflare la retirada de {correo}',
  'panel.administradores.aviso.vacia':
    'Todavía no hay administradores en la lista, así que ahora basta con Cloudflare Access para entrar. Añade primero tu correo y después el de las personas que deben administrar el Panel de Control.',
  'panel.administradores.aviso.sin-configurar':
    'La conexión con Cloudflare Access no está completa en la configuración del servicio. La lista se aplica en Faro, pero las altas y retiradas no llegan a Cloudflare: pide a quien mantiene el servicio que la complete.',
  'panel.administradores.aviso.retirada-pendiente':
    'Requiere atención: {correo} ya no puede entrar en el Panel de Control, pero Cloudflare Access todavía no ha confirmado su retirada. Pulsa «Reintentar» en su fila.',
  'panel.administradores.pie':
    'El último administrador activo no se puede retirar. Cada alta y cada retirada quedan en el registro del panel.',
  'panel.administradores.alta.titulo': 'Añadir administrador',
  'panel.administradores.alta.correo': 'Correo electrónico',
  'panel.administradores.alta.ejemplo': 'nombre@institucion.cat',
  'panel.administradores.alta.enviar': 'Añadir',
  'panel.administradores.alta.ayuda':
    'La persona figurará como «Pendiente» hasta que entre por primera vez. Al entrar, Cloudflare le pedirá confirmar su correo y registrar su segundo factor.',
  'panel.administradores.hecho.anadir': 'Administrador añadido.',
  'panel.administradores.hecho.retirar': 'Administrador retirado. Ya no puede entrar en el Panel de Control.',
  'panel.administradores.hecho.reintentar': 'Retirada completada también en Cloudflare Access.',
  'panel.administradores.hecho.retirada-pendiente':
    'Ya no puede entrar en el Panel de Control, pero Cloudflare Access no ha respondido. Puedes reintentarlo desde su fila.',
  'panel.administradores.error.correo_no_valido': 'Ese correo no es válido. Revísalo y vuelve a intentarlo.',
  'panel.administradores.error.administrador_duplicado': 'Ese correo ya está en la lista de administradores.',
  'panel.administradores.error.lista_llena':
    'La lista ha llegado al máximo de administradores. Retira a alguien antes de añadir a otra persona.',
  'panel.administradores.error.alta_propia_primero':
    'La lista está vacía: añade primero tu propio correo, para no quedarte fuera del Panel de Control.',
  'panel.administradores.error.administrador_no_encontrado':
    'Ese administrador ya no está en la lista. Se ha actualizado para que veas cómo está ahora.',
  'panel.administradores.error.ultimo_activo':
    'No se puede retirar al último administrador activo. Añade antes a otra persona y espera a que entre.',
  'panel.administradores.error.cloudflare_no_disponible':
    'Cloudflare Access no ha confirmado el alta, así que no se ha añadido. Puedes volver a intentarlo en unos minutos.',
  'panel.administradores.error.cloudflare_sin_configurar':
    'La sincronización con Cloudflare Access no está configurada, así que no se puede reintentar desde aquí.',
  'panel.administradores.error.sesion_inactiva': 'Para cambiar la lista, abre primero la sesión única.',
  'panel.administradores.error.sesion_sustituida':
    'Tu sesión única se ha cerrado porque la has abierto en otro dispositivo. Vuelve a abrirla aquí para seguir.',
  'panel.administradores.error.no_es_administrador':
    'Tu correo no figura como administrador de este Panel de Control. Pide a un administrador que te añada.',
  'panel.administradores.error.segundo_factor_requerido':
    'Para entrar en el Panel de Control tienes que registrar un segundo factor: una app de códigos, una llave de seguridad o la biometría de tu dispositivo. Sal, vuelve a entrar y sigue los pasos que te muestre Cloudflare.',
  'panel.administradores.error.no_disponible': 'No se ha podido completar ahora. Vuelve a intentarlo en unos minutos.',
  'panel.administradores.sin-permiso.titulo': 'No puedes entrar en el Panel de Control',
};
