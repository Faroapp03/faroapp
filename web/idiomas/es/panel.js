import { TEXTOS_CLASIFICACION } from './panel-clasificacion.js';
import { TEXTOS_AVISOS_DATOS } from './panel-datos.js';
import { TEXTOS_NAVEGACION } from './panel-navegacion.js';
import { TEXTOS_RECORRIDO } from './panel-recorrido.js';
import { TEXTOS_RETENIDOS } from './panel-retenidos.js';
import { TEXTOS_SERVICIO } from './panel-servicio.js';
// Presentación del panel; las claves no deciden autoridad ni cambian operaciones.
/** @type {Readonly<Record<string,string>>} */
export const TEXTOS_PANEL = {
  ...TEXTOS_CLASIFICACION,
  ...TEXTOS_AVISOS_DATOS,
  ...TEXTOS_NAVEGACION,
  ...TEXTOS_RECORRIDO,
  ...TEXTOS_RETENIDOS,
  ...TEXTOS_SERVICIO,
  'panel.titulo': 'Panel de Control · Faro',
  'panel.ver-web': 'Ver la web',
  'panel.encabezado': 'Panel de Control',
  'panel.sesion.inicial': 'Abre la sesión única para consultar y cambiar el servicio.',
  'panel.reconectar': 'Comprobar conexión',
  'panel.sin-script': 'El panel necesita JavaScript para comprobar la sesión y aplicar los cambios.',
  'panel.controles.titulo': 'Controles',
  'panel.controles.consultar': 'Consultar controles',
  'panel.controles.leyenda': 'Configuración de los servicios',
  'panel.conectividad.titulo': 'Conectividad',
  'panel.api': 'API para aplicaciones',
  'panel.api.ayuda':
    'Apagar la API conserva las claves de las instituciones. Para retirar una clave o un acceso, usa Instituciones.',
  'panel.conectividad.ayuda':
    'Cada conexión se gestiona de forma independiente. La web puede seguir funcionando con estas conexiones apagadas.',
  'panel.secciones.titulo': 'Secciones públicas',
  'panel.secciones.intro':
    'Abre o cierra estas páginas y sus enlaces. Las conexiones para aplicaciones y asistentes de IA se gestionan en Conectividad.',
  'panel.secciones.copias':
    'Quien use Faro sin conexión verá el último estado que conoció hasta que vuelva a conectarse. Inicio y las páginas legales, de accesibilidad y de verificación siempre están disponibles.',
  'panel.secciones.consultar': 'Consultar secciones',
  'panel.secciones.leyenda': 'Páginas disponibles',
  'panel.seccion.ia': 'Qué es IA',
  'panel.seccion.faro': 'Qué es Faro',
  'panel.seccion.recorrido': 'Empezar: recorrido e informe de ejemplo',
  'panel.seccion.cursos': 'Cursos',
  'panel.seccion.biblioteca': 'Biblioteca',
  'panel.seccion.globales': 'Datos globales: Cataluña, UE y mundo',
  'panel.seccion.doctor': 'Comprobar',
  'panel.seccion.encuesta': 'Encuesta',
  'panel.secciones.guardar': 'Guardar secciones',
  'panel.datos.titulo': 'Estado de las fuentes',
  'panel.datos.intro':
    'Comprueba qué fuentes se han consultado bien, cuáles necesitan atención y qué conviene hacer. Esta lectura no dice qué versión de los datos ven ahora las personas.',
  'panel.datos.consultar': 'Consultar estado de los datos',
  'panel.trabajos.titulo': 'Comprobar actualizaciones',
  'panel.trabajos.intro':
    'Faro busca datos nuevos en las fuentes y los revisa antes de prepararlos. Los datos preparados no se ven en la web hasta que se publican.',
  'panel.trabajos.consultar': 'Ver cómo va la actualización',
  'panel.trabajos.buscar': 'Actualizar datos',
  'panel.trabajos.reintentar': 'Volver a intentar lo que quedó pendiente',
  'panel.trabajos.vencidas': 'Comprobar las fuentes que tocan hoy',
  'panel.trabajos.cursos': 'Actualizar solo los cursos',
  'panel.trabajos.ayuda':
    'Vuelve a consultar solo las fuentes que no se pudieron comprobar la última vez. Si no queda nada pendiente, termina sin cambios.',
  'panel.trabajos.retirar': 'Retirar la solicitud',
  'panel.trabajos.reconciliar': 'Comprobar cómo terminó',
  'panel.trabajos.limites':
    'Retirar la solicitud no detiene una actualización que ya ha empezado. «Comprobar cómo terminó» pregunta por su resultado y lo anota; no publica datos.',
  'panel.activacion.titulo': 'Publicación de los datos',
  'panel.activacion.intro':
    'Muestra la última publicación de datos anotada por el servidor. No comprueba qué versión ven ahora las personas.',
  'panel.activacion.consultar': 'Consultar la última publicación',
  'panel.reserva': 'Acceso reservado a los usuarios administradores autorizados.',
  'panel.revision': 'Configuración confirmada por el servidor.',
  'panel.sesion.comprobando': 'Comprobando el servicio…',
  'panel.sesion.activa': 'Sesión activa. Los controles reflejan la última configuración confirmada.',
  'panel.sesion.cargando': 'Comprobando el panel…',
  'panel.sesion.cerrada': 'El panel está cerrado.',
  'panel.sesion.caducada': 'La sesión ya no está activa.',
  'panel.sesion.error': 'No se ha podido abrir la sesión única. Vuelve a intentarlo dentro de un momento.',
  'panel.sesion.desconectada': 'Comprueba la conexión para recuperar el estado.',
  'panel.controles.no_disponibles': 'La modificación de estos servicios no está disponible en este entorno.',
  'panel.controles.pendientes':
    'La configuración ha cambiado en otra sesión. Consulta los controles antes de guardar; se conserva lo que has marcado.',
  'panel.secciones.confirmadas': 'El servidor ha confirmado qué páginas están abiertas.',
  'panel.secciones.pendientes':
    'Consulta las secciones para revisar su disponibilidad antes de guardar. Se conserva cualquier borrador mostrado.',
  'panel.secciones.reemplazar': '¿Consultar las secciones y reemplazar el borrador por los valores confirmados?',
  'panel.controles.reemplazar': '¿Consultar los controles y reemplazar el borrador por los valores confirmados?',
  'panel.seguimiento.limitado':
    'Seguimiento automático limitado mientras esta pestaña esté visible. Puedes consultar el estado manualmente.',
  'panel.seguimiento.finalizado':
    'El seguimiento automático ha terminado. Pulsa «Ver cómo va la actualización» para continuar.',
  'panel.fecha-no-representable': 'Fecha no representable',
  'panel.trabajo.detalle': 'La solicitud se creó {fecha}.',
  'panel.trabajo.confirmar-retirada':
    '¿Quieres retirar esta solicitud? {detalle} Si la actualización ya ha empezado, no se detendrá. El servidor solo la retira si todavía es posible.',
  'panel.trabajo.confirmar-reconciliacion':
    '¿Quieres comprobar cómo terminó esta actualización? {detalle} Faro preguntará por su resultado y lo anotará. No se publica ningún dato.',
  'panel.trabajo.cambiado':
    'La actualización que veías ha cambiado. Revisa su estado antes de confirmar otra operación.',
  'panel.aviso.secciones_no_disponibles':
    'No se han podido consultar las secciones. Consulta de nuevo antes de guardar.',
  'panel.aviso.secciones_inciertas':
    'No se ha confirmado el cambio de secciones. Consulta las secciones y los controles antes de otro cambio.',
  'panel.aviso.revision_secciones_conflictiva':
    'La configuración ha cambiado. Consulta las secciones para revisar los valores actuales antes de guardar.',
  'panel.aviso.secciones_guardadas':
    'Secciones guardadas. Consulta los controles antes de cambiarlos para ver su configuración actual.',
  'panel.aviso.sin_conexion': 'No se ha podido comprobar la conexión. Los controles están bloqueados.',
  'panel.aviso.tiempo_agotado': 'La comprobación ha tardado demasiado. Vuelve a comprobar la conexión.',
  'panel.aviso.respuesta_invalida': 'No se ha podido comprobar la respuesta del servicio.',
  'panel.aviso.resultado_desconocido':
    'No se ha podido confirmar el resultado. Comprueba el estado antes de volver a cambiarlo.',
  'panel.aviso.acceso_denegado': 'El acceso no está autorizado. Vuelve a identificarte para entrar al panel.',
  'panel.aviso.no_disponible': 'El panel no está disponible en este momento.',
  'panel.aviso.solicitud_rechazada':
    'El servidor no ha admitido la operación. Revisa el estado confirmado antes de volver a actuar.',
  'panel.aviso.revision_conflictiva': 'La configuración ha cambiado. Revisa los valores actualizados antes de guardar.',
  'panel.aviso.sesion_sustituida': 'Tu sesión se ha cerrado porque el panel se ha abierto en otro lugar',
  'panel.aviso.sesion_inactiva': 'La sesión ya no está activa. Puedes abrir el panel de nuevo.',
  'panel.aviso.trabajos_no_disponibles':
    'No se ha podido consultar la actualización. Vuelve a consultarla para poder pedir otra.',
  'panel.aviso.actualizacion_incierta':
    'No se ha podido confirmar que la actualización se haya pedido. Consulta cómo va antes de pedirla otra vez.',
  'panel.aviso.trabajo_ocupado': 'Ya hay una actualización en marcha. Consulta cómo va.',
  'panel.aviso.revision_trabajos_conflictiva':
    'La actualización ha cambiado o ya no admite esta operación. Revisa su estado antes de volver a actuar.',
  'panel.aviso.recuperacion_incierta':
    'No se ha podido confirmar la operación. Consulta cómo va la actualización antes de volver a actuar.',
  'panel.aviso.trabajo_retirado': 'Solicitud retirada. Si la actualización ya había empezado, no se ha detenido.',
  'panel.aviso.trabajo_en_curso':
    'La actualización sigue en marcha. Todavía no hay resultado y no se ha publicado nada.',
  'panel.aviso.trabajo_sin_ejecucion':
    'Esta actualización todavía no ha empezado, así que no hay un resultado que comprobar. Consulta cómo va.',
  'panel.aviso.trabajo_terminado':
    'La actualización ya ha terminado. Revisa su resultado; esta comprobación no publica datos.',
  'panel.aviso.activacion_no_disponible':
    'No se ha podido consultar la última publicación. Vuelve a intentarlo en unos minutos.',
  'panel.aviso.datos_no_disponibles':
    'No se ha podido consultar el estado de los datos. Si hay una actualización en marcha, vuelve a consultarlo cuando termine; los demás apartados siguen disponibles.',
  'panel.datos.local.verde': 'Preparación correcta',
  'panel.datos.local.ambar': 'Se conserva la versión anterior',
  'panel.datos.local.rojo': 'Requiere revisión',
  'panel.datos.operacion.en-curso': 'En marcha según el registro; no garantiza que siga funcionando',
  'panel.datos.operacion.interrumpido': 'Interrumpida',
  'panel.datos.operacion.comprobada': 'Consulta correcta',
  'panel.datos.operacion.completa': 'Consulta completa; la fuente no lo cubre todo',
  'panel.datos.operacion.parcial': 'Consulta incompleta',
  'panel.datos.operacion.fallo': 'Consulta fallida',
  'panel.datos.operacion.local': 'Comprobación dentro de Faro, sin consultar la fuente oficial',
  'panel.datos.alcance.copia-local': 'Copia local conservada',
  'panel.datos.alcance.edicion-conocida': 'Edición conocida',
  'panel.datos.alcance.catalogo-actual': 'Catálogo actual consultable',
  'panel.datos.alcance.serie-abierta': 'Serie abierta consultable',
  'panel.datos.alcance.descubre-edicion': 'Consulta que busca una edición nueva',
  'panel.datos.alcance.contenido-actual-acotado': 'Contenido actual acotado',
  'panel.datos.alcance.recurso-actual-sin-edicion': 'Recurso actual sin edición identificada',
  'panel.datos.alcance.entradas-admitidas': 'Entradas admitidas para recomposición local',
  'panel.datos.alcance.productor-externo': 'Productor externo',
  'panel.datos.limite.copia-local': 'La copia local no acredita una consulta oficial.',
  'panel.datos.limite.edicion-conocida': 'No acredita que se hayan descubierto ediciones posteriores.',
  'panel.datos.limite.catalogo-actual': 'La comprobación se limita al catálogo declarado.',
  'panel.datos.limite.serie-abierta': 'La comprobación se limita a la serie declarada.',
  'panel.datos.limite.descubre-edicion': 'La búsqueda se limita a las ediciones del recurso declarado.',
  'panel.datos.limite.contenido-actual-acotado': 'No acredita una revisión completa del contenido oficial.',
  'panel.datos.limite.recurso-actual-sin-edicion': 'No identifica una edición ni acredita el descubrimiento de otra.',
  'panel.datos.limite.entradas-admitidas': 'Recomponer las entradas no consulta a sus productores.',
  'panel.datos.limite.productor-externo': 'La consulta al productor externo no está automatizada por esta cadena.',
  'panel.datos.conjunto.descargar': 'Consulta remota planificada',
  'panel.datos.conjunto.revision': 'Revisión manual',
  'panel.datos.conjunto.integridad': 'Integridad local',
  'panel.datos.conjunto.recomponer': 'Recomposición local',
  'panel.no-consta': 'No consta',
  'panel.si': 'Sí',
  'panel.no': 'No',
  'panel.sin-registro': 'Sin registro',
  'panel.datos.sin-operacion': 'Sin operación registrada en esta observación.',
  'panel.datos.sin-comprobacion': 'Sin registro en esta observación',
  'panel.datos.sin-resultado-remoto': 'Sin resultado remoto conservado; no se deduce de la fecha de un intento.',
  'panel.datos.revision-manual': 'Requiere revisión manual, aunque conste una comprobación oficial.',
  'panel.datos.tabla.titulo': 'Fuentes que consulta Faro',
  'panel.datos.tabla.fuente': 'Fuente',
  'panel.datos.tabla.local': 'Preparación en Faro',
  'panel.datos.tabla.consulta': 'Consulta oficial',
  'panel.datos.tabla.cobertura': 'Cobertura',
  'panel.datos.tabla.limites': 'Límites y revisión',
  'panel.datos.tabla.region': 'Estado de las fuentes; tabla desplazable',
  'panel.datos.sin-intento': 'Sin intento registrado',
  'panel.datos.sin-resultado-local': 'Sin resultado local registrado',
  'panel.datos.sin-consulta': 'Evidencia de consulta oficial no disponible en esta observación.',
  'panel.datos.sin-cobertura': 'Cobertura no disponible en esta observación.',
  'panel.datos.sin-revision':
    'Esta observación no permite determinar la revisión necesaria ni si hubo una consulta oficial.',
  'panel.datos.externos': 'Productores externos',
  'panel.datos.observacion': 'Observación del panel',
  'panel.datos.reconstruccion-pendiente':
    'Hay una preparación de datos pendiente según el registro; no significa que esté en marcha.',
  'panel.datos.detalle': 'Detalle técnico de la observación',
  'panel.datos.no-disponible': 'No disponible en esta observación',
  'panel.fecha-no-valida': 'Fecha no válida',
  'panel.datos.ultima-comprobacion': 'Última comprobación registrada',
  'panel.datos.diagnostico': 'Diagnóstico y siguientes pasos',
  'panel.datos.ultimo-intento': 'Último intento de consulta',
  'panel.datos.no-conservado': 'No conservado en esta observación',
  'panel.datos.reintento': 'Reintento previsto en el registro',
  'panel.datos.todas': 'Todas',
  'panel.datos.estado-comprobacion': 'Estado de comprobación',
  'panel.datos.comprobacion-fuentes': 'Comprobación de las fuentes',
  'panel.datos.estado-global': 'Estado global de las comprobaciones',
  'panel.datos.que-indican': 'Qué indican estas luces',
  'panel.datos.alcance-luces':
    'Indican cómo fue la última comprobación de cada fuente y cuáles necesitan atención. La vigencia de los cursos y la versión publicada se comprueban aparte. El plazo indica cada cuánto toca consultar la fuente.',
  'panel.datos.otras': 'Fuentes en preparación y fuentes de otras entidades',
  'panel.datos.otras-limite': 'Estas fuentes no cuentan en el resumen. Que aparezcan aquí no las pone en marcha.',
  'panel.trabajo.solicitada-incierta':
    'Solicitud enviada, pero no se ha confirmado que la actualización haya empezado. Consulta cómo va antes de pedirla otra vez.',
  'panel.trabajo.en-curso': 'Solicitud enviada al sistema de actualización; todavía no hay resultado.',
  'panel.trabajo.resultado.validado':
    'Datos nuevos preparados, aún no publicados. Se publican en la web en un paso aparte.',
  'panel.trabajo.resultado.sin-pendientes':
    'La actualización ha terminado sin nada pendiente. Esto no garantiza que todas las fuentes estén al día.',
  'panel.trabajo.resultado.rechazado':
    'La actualización no ha preparado datos nuevos porque no han superado la revisión.',
  'panel.trabajo.resultado.despacho-rechazado': 'La actualización no ha podido empezar. Avisa al equipo técnico.',
  'panel.trabajo.resultado.retirado': 'Solicitud retirada antes de que empezara la actualización.',
  'panel.trabajo.resultado.ejecucion-sin-recibo':
    'La actualización ha terminado sin dejar un resultado que se pueda comprobar. Avisa al equipo técnico.',
  'panel.trabajo.sin-resultado': 'Resultado no disponible.',
  'panel.trabajo.consulta-inicial': 'Consulta cómo va la actualización para poder pedir otra.',
  'panel.trabajo.sin-trabajos': 'Todavía no se ha pedido ninguna actualización. Puedes pedir una ahora.',
  'panel.trabajo.programada': 'Comprobación automática programada',
  'panel.trabajo.error.actualizacion_no_completada': 'La actualización no se ha completado.',
  'panel.trabajo.error.actualizacion_no_admitida': 'El resultado de la actualización no ha superado la validación.',
  'panel.trabajo.error.candidato_no_verificable': 'No se han podido comprobar los datos preparados.',
  'panel.salud.estado.atencion': 'Necesita atención',
  'panel.salud.estado.incidencia': 'No se pudo comprobar',
  'panel.salud.estado.pendiente': 'Consulta pendiente',
  'panel.salud.estado.revision': 'Revisión manual',
  'panel.salud.estado.sin-observacion': 'Sin comprobación registrada',
  'panel.salud.estado.local': 'Comprobada dentro de Faro',
  'panel.salud.estado.comprobada': 'Comprobada',
  'panel.salud.estado.candidata': 'En preparación',
  'panel.salud.estado.externa': 'Revisada por otra entidad',
  'panel.salud.estado.productor-local': 'Calculada por Faro',
  'panel.tema.cursos': 'Cursos',
  'panel.tema.ocupaciones': 'Ocupaciones',
  'panel.tema.ia_y_trabajo': 'IA y trabajo',
  'panel.tema.mercado': 'Mercado',
  'panel.tema.derechos': 'Derechos',
  'panel.tema.biblioteca': 'Biblioteca',
  'panel.tema.comun': 'Datos comunes',
  'panel.tema.derivados': 'Datos derivados',
  'panel.tema.sin-tema': 'Tema no conservado en esta observación',
  'panel.salud.mensaje.atencion': 'La última preparación de datos necesita revisión. No se ha publicado nada nuevo.',
  'panel.salud.accion.atencion': 'Avisa al equipo técnico antes de pedir otra actualización.',
  'panel.salud.mensaje.incidencia':
    'La última consulta a esta fuente no terminó bien. Faro no cambia los datos publicados por este fallo.',
  'panel.salud.accion.incidencia':
    'Pulsa Actualizar datos o «Volver a intentar lo que quedó pendiente». Si vuelve a fallar, avisa al equipo técnico.',
  'panel.salud.mensaje.pendiente':
    'Ya toca volver a consultar esta fuente, o falta confirmar cómo terminó la última consulta. No significa que los datos estén mal.',
  'panel.salud.accion.pendiente': 'Mira cómo va la actualización; si no hay ninguna en marcha, pulsa Actualizar datos.',
  'panel.salud.mensaje.revision': 'Esta fuente se revisa a mano.',
  'panel.salud.accion.revision':
    'Avisa al equipo técnico cuando toque revisarla; volver a descargarla no sustituye esa revisión.',
  'panel.salud.mensaje.sin-observacion': 'No consta ninguna comprobación de esta fuente.',
  'panel.salud.accion.sin-observacion':
    'Avisa al equipo técnico. Que no conste una comprobación no significa que la fuente haya fallado.',
  'panel.salud.mensaje.local': 'Estos datos se comprueban dentro de Faro, sin consultar la fuente oficial.',
  'panel.salud.accion.local': 'No hace falta hacer nada.',
  'panel.salud.mensaje.comprobada': 'La fuente se consultó bien en su última comprobación.',
  'panel.salud.accion.comprobada': 'No hace falta hacer nada. Faro la volverá a consultar cuando toque.',
  'panel.salud.mensaje.candidata': 'Esta fuente está preparada, pero todavía no se usa en las actualizaciones.',
  'panel.salud.accion.candidata': 'No hace falta hacer nada. El equipo técnico decide cuándo incorporarla.',
  'panel.salud.mensaje.productor-local': 'Estos datos los calcula Faro a partir de otras fuentes ya guardadas.',
  'panel.salud.accion.productor-local':
    'No hace falta hacer nada. Si cambian sus fuentes, el equipo técnico los vuelve a calcular.',
  'panel.salud.mensaje.externa': 'Estos datos los revisa otra entidad, fuera de la actualización automática.',
  'panel.salud.accion.externa': 'No hace falta hacer nada. Si dudas de su vigencia, consulta al equipo técnico.',
  'panel.datos.ultima-operacion': 'Última operación: {v0}.',
  'panel.datos.inicio-fin': 'Inicio: {v0}. Fin: {v1}.',
  'panel.datos.remota-prevista': 'Consulta remota prevista en esta operación: {v0}.',
  'panel.datos.ultimo-remoto': 'Último intento remoto: {v0}.',
  'panel.datos.conjunto-comprobacion': '{v0} · Última comprobación oficial registrada: {v1}.',
  'panel.datos.resultado-remoto': 'Último resultado remoto conservado: {v0}. Inicio: {v1}. Fin: {v2}.',
  'panel.datos.comprobacion-pendiente': '{v0} · Comprobación pendiente, iniciada {v1}; resultado: {v2}.',
  'panel.datos.intervalo': '; intervalo previsto: {v0} días',
  'panel.datos.politica-fecha': 'Política: {v0}. Fecha de referencia: {v1}.',
  'panel.datos.ultimo-local': 'Último intento local: {v0}.',
  'panel.datos.ultima-buena': 'Última versión buena conservada: {v0}.',
  'panel.datos.consultado': 'Estado consultado: {v0}.',
  'panel.datos.registro': 'Registro de comprobaciones: {v0}.',
  'panel.datos.resultado-consulta': 'Resultado de esa consulta: {v0}.',
  'panel.datos.que-hacer': 'Qué hacer: {v0}',
  'panel.datos.proxima-consulta': 'Próxima consulta: {v0}.',
  'panel.datos.fallos-seguidos': 'Fallos seguidos: {v0}.',
  'panel.datos.consulta-parcial':
    'Consulta parcial: {v0} de {v1} unidades sin respuesta; se conserva su última comprobación.',
  'panel.datos.revision-pendiente': 'La revisión de las fichas de Formación abierta está pendiente: venció {v0}.',
  'panel.datos.revision-prevista': 'La revisión de las fichas de Formación abierta vence {v0}.',
  'panel.datos.cobertura-limitada': 'Cobertura limitada: {v0}.',
  'panel.datos.cobertura-limitada.censo-con-copias-fijadas':
    'la consulta renueva el censo de Cibernàrium, pero el catálogo de ocupaciones y las páginas históricas conservan sus fechas propias',
  'panel.datos.cobertura-limitada.indices-sin-censo':
    'los índices públicos registran la presencia de programas, pero no aportan un censo completo ni renuevan las ediciones conservadas',
  'panel.datos.recuento': '{v0} de {v1} fuentes en uso en esta lectura.',
  'panel.solicitud-id': 'Solicitud: {v0}.',
  'panel.trabajo.fecha-solicitud': '{v0}. Solicitada {v1}.',
  'panel.trabajo.finalizada': 'Terminada {v0}.',
  'panel.instituciones.titulo': 'Instituciones',
  'panel.instituciones.intro':
    'Invita a una institución, entrega el enlace y gestiona sus claves. Faro no envía correos. El estado de la institución describe sus credenciales; la API se enciende o apaga en Conectividad.',
  'panel.instituciones.consultar': 'Consultar instituciones',
  'panel.instituciones.consultar-primero': 'Consulta las instituciones antes de invitar o retirar un acceso.',
  'panel.instituciones.nueva': 'Nueva institución',
  'panel.instituciones.nombre': 'Nombre de la institución o del sistema',
  'panel.instituciones.correo': 'Correo',
  'panel.instituciones.correo-opcional': 'Correo de la institución (opcional)',
  'panel.instituciones.correo-ayuda': 'Solo se anota en esta ficha. El envío del enlace es manual.',
  'panel.instituciones.invitar': 'Invitar',
  'panel.instituciones.entrega': 'Entrega este enlace',
  'panel.instituciones.enlace-ayuda':
    'El enlace es de un solo uso y caduca a los siete días. No se puede recuperar al volver a consultar la lista.',
  'panel.instituciones.enlace': 'Enlace de invitación',
  'panel.instituciones.copiar': 'Copiar enlace',
  'panel.instituciones.enviar': 'Abrir correo para entregar',
  'panel.instituciones.descartar': 'Ocultar y olvidar el enlace',
  'panel.instituciones.sin-registros': 'No hay instituciones registradas en esta lectura.',
  'panel.instituciones.sin-correo': 'No anotado',
  'panel.instituciones.estado': 'Estado',
  'panel.instituciones.estado.invitada': 'Invitada',
  'panel.instituciones.estado.activa': 'Activa',
  'panel.instituciones.estado.retirada': 'Retirada',
  'panel.instituciones.ultima-conexion': 'Última conexión registrada',
  'panel.instituciones.sin-conexion': 'Sin conexión registrada',
  'panel.instituciones.consultas': 'Consultas registradas',
  'panel.instituciones.caducidad': 'Caducidad de la invitación',
  'panel.instituciones.clave-id': 'Identificador de la clave',
  'panel.instituciones.clave-creada': 'Clave creada',
  'panel.instituciones.retirar-clave': 'Retirar esta clave',
  'panel.instituciones.renovar': 'Nueva invitación',
  'panel.instituciones.retirar': 'Retirar acceso',
  'panel.instituciones.confirmar-clave':
    '¿Retirar la clave {id} de {nombre}? Dejará de servir para nuevas consultas al confirmar el servidor.',
  'panel.instituciones.confirmar-renovar':
    '¿Crear una nueva invitación para {nombre}? Sustituirá la invitación pendiente. Las claves activas se conservan hasta que las retires.',
  'panel.instituciones.confirmar-retirar':
    '¿Retirar el acceso de {nombre}? Se invalidarán su invitación, sus claves y sus tokens al confirmar el servidor.',
  'panel.instituciones.dos-claves':
    'Hay dos claves activas durante el relevo. Retira una antes de crear otra invitación.',
  'panel.instituciones.enlace-caduca': 'La invitación caduca {fecha}.',
  'panel.instituciones.copiado': 'Enlace copiado. Entrégalo solo a la institución invitada.',
  'panel.instituciones.copia-manual': 'Selecciona el enlace y cópialo.',
  'panel.instituciones.correo-manual':
    'Revisa el mensaje en tu aplicación de correo antes de enviarlo. Faro no lo envía.',
  'panel.instituciones.correo-asunto': 'Invitación de acceso a Faro',
  'panel.instituciones.correo-cuerpo':
    'Tu institución puede activar su acceso a Faro con este enlace: {direccion}\n\nCaduca a los siete días y solo se puede utilizar una vez. Pulsa «Generar clave» cuando puedas guardarla. La clave se guarda en el servidor de tu institución, nunca en una web ni en un navegador.',
  'panel.aviso.instituciones_no_disponibles':
    'No se han podido consultar las instituciones. Consulta de nuevo antes de cambiar un acceso.',
  'panel.aviso.instituciones_inciertas':
    'No se ha confirmado el cambio. Consulta la lista antes de otra operación. Si se creó una invitación y se perdió la respuesta, pide una nueva invitación desde su ficha.',
  'panel.aviso.revision_instituciones_conflictiva':
    'La lista ha cambiado. Consulta las instituciones y revisa los valores antes de volver a actuar.',
  'panel.aviso.limite_instituciones':
    'Se ha alcanzado el límite de instituciones. Consulta la lista antes de revisar los accesos.',
  'panel.aviso.dos_claves_activas':
    'La institución ya tiene dos claves activas. Consulta su ficha y retira una antes de renovar.',
  'panel.aviso.institucion_no_encontrada':
    'La institución o la clave ya no está disponible. Consulta la lista antes de otra operación.',
  'panel.aviso.instituciones_confirmadas': 'Lista confirmada por el servidor.',
  'panel.accesos.titulo': 'Accesos',
  'panel.accesos.intro':
    'Consulta los registros conservados de los tres servicios. La paginación reúne hasta 50 filas entre todos los canales. Los recuentos diarios pueden incluir varias consultas en una sola fila.',
  'panel.accesos.privacidad':
    'El registro no contiene el contenido ni los argumentos de las consultas. El nombre de cliente MCP es una declaración del cliente, sin verificar su identidad.',
  'panel.accesos.consultar': 'Consultar accesos desde la primera página',
  'panel.accesos.consultar-primero': 'Consulta los accesos para obtener una página confirmada del registro.',
  'panel.accesos.lectura':
    'Última página confirmada. Esta lectura no cambia los controles ni renueva la actividad de la sesión.',
  'panel.accesos.resumen': 'Página {pagina} · Registros en esta página: {cantidad}. Conservados en total: {total}.',
  'panel.accesos.anterior': 'Más recientes',
  'panel.accesos.siguiente': 'Más antiguos',
  'panel.accesos.api': 'Instituciones · API',
  'panel.accesos.mcp': 'Asistentes de IA · MCP',
  'panel.accesos.a2a': 'Agentes de IA · A2A',
  'panel.accesos.fecha': 'Fecha y hora',
  'panel.accesos.dia': 'Día (UTC)',
  'panel.accesos.institucion': 'Institución',
  'panel.accesos.consulta': 'Consulta',
  'panel.accesos.resultado': 'Resultado HTTP',
  'panel.accesos.herramienta': 'Herramienta',
  'panel.accesos.cliente': 'Cliente declarado (sin verificar)',
  'panel.accesos.consultas': 'Consultas del día',
  'panel.accesos.habilidad': 'Habilidad',
  'panel.accesos.cliente.no_declarado': 'Nombre no declarado',
  'panel.accesos.cliente.omitido': 'Nombre no conservado',
  'panel.accesos.cliente.otros': 'Otros clientes agrupados',
  'panel.accesos.sin-canal': 'Sin registros de este canal en esta página.',
  'panel.aviso.accesos_no_disponibles':
    'No se han podido consultar los accesos. No se puede deducir que el registro esté vacío. Vuelve a consultarlo.',
  'panel.ocultas.titulo': 'Ofertas retenidas del catálogo',
  'panel.ocultas.intro':
    'Decisiones conservadas del registro admitido. No confirma que una retirada se haya publicado. Esta consulta no vuelve a evaluar cursos ni consulta a sus proveedores.',
  'panel.ocultas.consultar': 'Consultar desde la primera página',
  'panel.ocultas.filtro': 'Tipo de unidad',
  'panel.ocultas.todos': 'Todos',
  'panel.ocultas.recurso': 'Recurso',
  'panel.ocultas.edicion': 'Edición',
  'panel.ocultas.anterior': 'Página anterior',
  'panel.ocultas.siguiente': 'Página siguiente',
  'panel.ocultas.sin-registro': 'Sin registro disponible. No se puede deducir que no haya ofertas retenidas.',
  'panel.ocultas.observada':
    'Decisiones en el corte conservado; publicación efectiva y estado a la hora presente sin confirmar.',
  'panel.ocultas.resumen':
    'Corte de las decisiones: {v2}. {v0} unidades retenidas · página {v1} · cierre del recibo: {v3}',
  'panel.ocultas.vacia': 'Este registro acreditado no contiene unidades retenidas para el filtro elegido.',
  'panel.ocultas.unidad': 'Unidad',
  'panel.ocultas.codigo': 'Código de la causa',
  'panel.ocultas.decision': 'Decisión conservada',
  'panel.ocultas.comprobado': 'Última comprobación válida de la unidad',
  'panel.ocultas.cierra': 'Fecha límite publicada por la fuente',
  'panel.ocultas.revisar': 'Próxima revisión interna de Faro',
  'panel.ocultas.intento-fallido': 'Última consulta sin respuesta válida',
  'panel.ocultas.aviso.revision':
    'Revisión pendiente: venció {v0}. Es un aviso interno: no cambia la oferta ni lo que ve la persona.',
  'panel.ocultas.aviso.fallo':
    'La última consulta falló {v0}. Se conservan la última comprobación válida y lo que ve la persona.',
  'panel.ocultas.causa.limite_publicado_alcanzado': 'Se alcanzó una fecha límite publicada por la fuente',
  'panel.ocultas.causa.enlace_de_ficha_no_encontrado':
    'La dirección exacta de la ficha respondió que no existe; no consta un cierre del curso',
  'panel.ocultas.intento': 'Último intento conservado de la unidad',
  'panel.ocultas.fin': 'Fin de ese intento',
  'panel.ocultas.fuente-intento':
    'Último intento del módulo de la fuente (puede ser local; no acredita consulta de esta unidad)',
  'panel.ocultas.evidencias': 'Causa y referencias conservadas',
  'panel.ocultas.causas': 'Motivos del evaluador',
  'panel.ocultas.evaluado': 'Corte de la evaluación',
  'panel.ocultas.firma': 'Firma del evaluador',
  'panel.ocultas.parametros': 'Parámetros y fragmento omitidos',
  'panel.ocultas.sin-evidencias': 'No hay referencias presentables conservadas para esta unidad.',
  'panel.ocultas.decision.disponible-publicamente': 'Disponible según la decisión conservada',
  'panel.ocultas.decision.no-disponible-publicamente': 'No disponible según la decisión conservada',
  'panel.ocultas.decision.apertura-futura': 'Apertura futura',
  'panel.ocultas.decision.sin-confirmar': 'Sin confirmar',
  'panel.ocultas.decision.comprobacion-caducada': 'Comprobación caducada',
  'panel.ocultas.motivo.otro': 'El registro conserva una causa que requiere revisión. No acredita una oferta pública.',
  'panel.ocultas.motivo.sin_evaluacion': 'La unidad no tiene una evaluación conservada.',
  'panel.ocultas.motivo.evaluador_modificado_requiere_evaluacion':
    'La firma del evaluador cambió; la evaluación anterior no acredita el contrato actual.',
  'panel.ocultas.motivo.edicion_modificada_requiere_evaluacion':
    'La edición cambió y requiere una evaluación del nuevo contenido.',
  'panel.ocultas.motivo.recurso_modificado_requiere_evaluacion':
    'El recurso cambió y requiere una evaluación del nuevo contenido.',
  'panel.ocultas.motivo.decision_registrada_no_acredita_oferta':
    'La decisión conservada no acredita disponibilidad pública.',
  'panel.ocultas.motivo.confirmacion_vencida_en_corte': 'La comprobación ya había vencido en el corte conservado.',
  'panel.ocultas.publicadas.revision':
    'Cursos publicados con la revisión interna pendiente: {v0} (la más antigua venció {v1}). Siguen publicados: es un aviso interno.',
  'panel.ocultas.publicadas.enlace':
    'Cursos publicados cuya dirección dio un error en la última revisión: {v0}. Siguen publicados con su enlace.',
  'panel.ocultas.incidencia-enlace': 'Error de la dirección en la última revisión',
  'panel.ocultas.incidencia-enlace.ficha': 'Error de la dirección de la ficha en la última revisión',
  'panel.ocultas.incidencia-enlace.catalogo': 'Error de la dirección del catálogo de la fuente en la última revisión',
  'panel.ocultas.publicadas.fallo':
    'Cursos publicados cuya última consulta falló: {v0}. Siguen publicados con su última comprobación válida.',
  'panel.ocultas.motivo.resultado_de_evaluacion_anterior':
    'La evaluación conservada tiene el formato anterior y está pendiente de reevaluarse con la regla actual.',
  'panel.ocultas.motivo.limite_publicado_alcanzado_en_corte':
    'En el corte conservado ya se había alcanzado la fecha límite publicada por la fuente.',
  'panel.ocultas.motivo.acceso_o_calendario_indispensable_sin_soporte':
    'Falta evidencia indispensable de acceso o calendario.',
  'panel.ocultas.motivo.confirmacion_sin_fechas_o_url_indispensables':
    'Faltan fechas o dirección indispensables para publicar.',
  'panel.ocultas.motivo.confirmacion_posterior_o_fechas_incoherentes':
    'Las fechas conservadas no permiten confirmar la oferta en este corte.',
  'panel.ocultas.motivo.entradas_evaluadas_incompatibles_con_contrato':
    'Las entradas de la evaluación no cumplen el contrato actual.',
  'panel.ocultas.motivo.catalogo_obligatorio_sin_comprobacion_acreditada':
    'Falta la comprobación obligatoria del catálogo del proveedor.',
  'panel.ocultas.motivo.politica_continua_no_registrada': 'La regla de oferta continua no está registrada.',
  'panel.ocultas.motivo.confirmacion_sin_fecha_acreditada': 'La confirmación no tiene una fecha acreditada.',
  'panel.aviso.ocultas_no_disponibles':
    'No se pudo renovar la consulta. Se conserva la última observación conocida mientras siga autorizada esta sesión.',
  'panel.ocultas.error': 'La consulta falló y no hay una observación anterior disponible.',
  'panel.datos.ultima-comprobacion-parte': 'Última comprobación registrada, parte {v0} de {v1}',
  'panel.datos.proxima': 'Próxima consulta prevista',
  'panel.datos.proxima-parte': 'Próxima consulta prevista, parte {v0} de {v1}',
};
