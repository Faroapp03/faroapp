import { TEXTOS_PILOTO } from './panel-piloto.js';
// Textos del apartado Servicio, de las revisiones manuales, de la confirmación de cambios y de las fechas del panel.
/** @type {Readonly<Record<string,string>>} */
export const TEXTOS_SERVICIO = {
  ...TEXTOS_PILOTO,
  'panel.fecha.a-las': 'a las {hora}',
  'panel.fecha.a-la': 'a la {hora}',
  'panel.fecha.hoy': 'hoy {hora}',
  'panel.fecha.ayer': 'ayer {hora}',
  'panel.fecha.manana': 'mañana {hora}',
  'panel.fecha.pasado': 'hace {dias} días, {fecha} {hora}',
  'panel.fecha.futuro': 'dentro de {dias} días, {fecha} {hora}',
  'panel.dia.hoy': 'hoy',
  'panel.dia.ayer': 'ayer',
  'panel.dia.manana': 'mañana',
  'panel.dia.pasado': 'hace {dias} días, {fecha}',
  'panel.dia.futuro': 'dentro de {dias} días, {fecha}',
  'panel.fecha.utc': 'registro en UTC: {fecha}',
  'panel.servicio.titulo': 'Estado de los datos',
  'panel.servicio.intro':
    'Una fila por tema y otra para los datos nuevos. Cada estado sale de la última lectura del servidor; si algo no se ha podido leer, lo verás como «sin comprobar».',
  'panel.servicio.sin-comprobar': 'Sin comprobar',
  'panel.servicio.sin-intento': 'No consta ningún intento',
  'panel.servicio.sin-resultado': 'resultado no conservado',
  'panel.servicio.intento': '{fecha} · {resultado}',
  'panel.servicio.ultimo-intento': 'Último intento',
  'panel.servicio.ultima-valida': 'Última comprobación válida',
  'panel.servicio.que-hacer': 'Qué hacer: {accion}',
  'panel.servicio.accion.ninguna': 'No hace falta hacer nada.',
  'panel.servicio.accion.actualizar': 'Pulsa Actualizar datos, en Actualizaciones.',
  'panel.servicio.accion.equipo': 'Avisa al equipo técnico.',
  'panel.servicio.accion.esperar': 'Espera a que termine; puedes ver cómo va en Actualizaciones.',
  'panel.servicio.accion.consultar': 'Vuelve a abrir el panel o consulta la lectura en su apartado.',
  'panel.servicio.causa.atencion':
    'La última preparación de datos de {fuentes} necesita revisión. Faro no cambia los datos publicados por este fallo.',
  'panel.servicio.causa.incidencia':
    'La última consulta a {fuentes} no terminó bien. Faro no cambia los datos publicados por este fallo.',
  'panel.servicio.causa.pendiente':
    'Ya toca volver a consultar {fuentes}. Mientras tanto, Faro no cambia los datos publicados.',
  'panel.servicio.causa.sin-observacion': 'No consta ninguna comprobación de {fuentes}.',
  'panel.servicio.causa.revision': 'Toca revisar a mano {fuentes}.',
  'panel.servicio.causa.local': 'Los datos de {fuentes} se comprueban dentro de Faro, sin consultar la fuente oficial.',
  'panel.servicio.causa.comprobada': 'Las fuentes de este tema se consultaron bien en su última comprobación.',
  'panel.servicio.causa.candidata': 'Todavía no se usan en las actualizaciones: {fuentes}.',
  'panel.servicio.causa.externa': 'Los datos de {fuentes} los revisa otra entidad.',
  'panel.servicio.causa.productor-local': 'Los datos de {fuentes} los calcula Faro a partir de otras fuentes.',
  'panel.servicio.fuentes.titulo': 'Fuentes',
  'panel.servicio.fuentes.sin-lectura':
    'No se ha podido leer el estado de las fuentes, así que no se puede decir si están al día.',
  'panel.servicio.publicacion.titulo': 'Datos nuevos y publicación',
  'panel.servicio.publicacion.etiqueta': 'Última publicación registrada',
  'panel.servicio.publicacion.ninguna': 'Todavía no consta ninguna',
  'panel.servicio.publicacion.registrada': '{fase} · {fecha}',
  'panel.servicio.nuevos.etiqueta': 'Datos nuevos',
  'panel.servicio.nuevos.sin-lectura':
    'No se ha podido leer la última actualización, así que no se sabe si hay datos nuevos.',
  'panel.servicio.nuevos.ninguno':
    'Todavía no se ha pedido ninguna actualización, así que no hay datos nuevos pendientes.',
  'panel.servicio.nuevos.en-curso': 'Hay una actualización pedida {fecha}, y todavía no ha terminado.',
  'panel.servicio.nuevos.sin-cambios':
    'La última actualización terminó {fecha} sin nada pendiente y no preparó datos nuevos.',
  'panel.servicio.nuevos.sin-datos':
    'La última actualización terminó {fecha} sin preparar datos nuevos. Faro no cambia los datos publicados por este fallo.',
  'panel.servicio.nuevos.preparados-sin-comprobar':
    'Hay datos nuevos preparados {fecha}, pero no se ha podido leer si ya están publicados.',
  'panel.servicio.nuevos.pendientes': 'Datos nuevos preparados {fecha}, aún no publicados.',
  'panel.servicio.nuevos.publicados':
    'Según el registro del servidor, los datos preparados {fecha} se publicaron {publicados}.',
  'panel.servicio.nuevos.rechazados':
    'Los datos preparados {fecha} no se han podido publicar. Faro no cambia los datos publicados por este fallo.',
  'panel.servicio.nuevos.publicandose': 'Los datos preparados {fecha} se están publicando.',
  'panel.servicio.servida.etiqueta': 'Versión que ven las personas',
  'panel.servicio.servida.sin-comprobar': 'Sin comprobar: el servidor todavía no ofrece esta lectura.',
  'panel.servicio.indicador.al-dia': 'Nada pendiente',
  'panel.servicio.indicador.pendiente': 'Sin publicar todavía',
  'panel.servicio.indicador.en-curso': 'Sin terminar',
  'panel.servicio.indicador.atencion': 'Necesita atención',
  'panel.servicio.indicador.sin-comprobar': 'Sin comprobar',
  'panel.revisiones.titulo': 'Revisiones que tocan',
  'panel.revisiones.intro':
    'Revisiones que se hacen a mano y que el servidor ya tiene calculadas. Son un recordatorio: no cambian lo que ven las personas.',
  'panel.revisiones.sin-comprobar': 'Sin comprobar: no se ha podido leer el estado de los datos.',
  'panel.revisiones.ninguna': 'No consta ninguna revisión manual pendiente en esta lectura.',
  'panel.revisiones.estado.vencida': 'Toca ya',
  'panel.revisiones.estado.prevista': 'Prevista',
  'panel.revisiones.estado.manual': 'Revisión manual',
  'panel.revisiones.fichas-vencida': 'La revisión de las fichas está pendiente: venció {dia}.',
  'panel.revisiones.fichas-prevista': 'La revisión de las fichas toca {dia}.',
  'panel.revisiones.manual': 'Última comprobación registrada {fecha}.',
  'panel.revisiones.manual-sin-registro': 'No consta ninguna comprobación anterior.',
  'panel.revisiones.fuente-sin-nombre': 'Datos de otra entidad',
  'panel.confirmar.intro': 'Vas a guardar estos cambios:',
  'panel.confirmar.pregunta': '¿Quieres guardarlos?',
  'panel.confirmar.seccion.cerrar': 'Cerrar «{nombre}»: las personas dejarán de ver esta página y sus enlaces.{efecto}',
  'panel.confirmar.seccion.abrir': 'Abrir «{nombre}»: las personas volverán a ver esta página y sus enlaces.{efecto}',
  'panel.confirmar.recorrido.cerrar': 'Nadie podrá empezar el recorrido ni ver el informe de ejemplo.',
  'panel.confirmar.recorrido.abrir': 'Las personas podrán empezar el recorrido y ver el informe de ejemplo.',
  'panel.confirmar.encuesta.cerrar':
    'El recorrido dejará de ofrecerla, pero las invitaciones no se pierden: cuando vuelvas a mostrarla, los mismos enlaces servirán.',
  'panel.confirmar.encuesta.abrir': 'Las personas con una invitación podrán volver a responderla con su mismo enlace.',
  'panel.confirmar.sin-conexion': 'Quien use Faro sin conexión verá el cambio cuando vuelva a conectarse.',
  'panel.confirmar.api.apagar':
    'Apagar la API para aplicaciones: las instituciones dejarán de poder consultar Faro desde sus sistemas. Sus claves se conservan.',
  'panel.confirmar.api.encender':
    'Encender la API para aplicaciones: las instituciones con clave podrán consultar Faro desde sus sistemas.',
  'panel.confirmar.mcp.apagar': 'Apagar la conexión para asistentes de IA: dejarán de poder consultar Faro.',
  'panel.confirmar.mcp.encender':
    'Encender la conexión para asistentes de IA: podrán consultar los datos públicos de Faro.',
  'panel.confirmar.a2a.apagar': 'Apagar la conexión para agentes de IA: dejarán de poder consultar Faro.',
  'panel.confirmar.a2a.encender':
    'Encender la conexión para agentes de IA: podrán consultar los datos públicos de Faro.',
  'panel.confirmar.web-sigue': 'La web sigue funcionando igual para las personas.',
  'panel.fecha.registro-dia': 'día registrado: {fecha}',
  'panel.servicio.nuevos.retirado': 'La actualización se retiró {fecha} y no preparó datos nuevos.',
  'panel.servicio.nuevos.solo-ultima':
    'Solo se conoce la última actualización. Si una anterior preparó datos, aquí no se puede saber si se publicaron.',
  'panel.servicio.accion.revisar-publicacion':
    'Si esperabas datos de una actualización anterior, consulta «Publicación de los datos» o avisa al equipo técnico.',
  'panel.servicio.indicador.solo-ultima': 'Sin comprobar del todo',
  'panel.servicio.sin-conexion': 'Sin conexión no se puede leer el estado de los datos.',
  'panel.servicio.ver-detalle': 'Ver el detalle de cada fuente de {tema}',
};
