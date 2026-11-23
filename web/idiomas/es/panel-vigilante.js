// Avisos y acciones del estado del vigilante.
import { TEXTOS_AVISOS } from './panel-avisos.js';

export const TEXTOS_VIGILANTE = {
  ...TEXTOS_AVISOS,
  'panel.vigilante.fila-origen.recibo': 'Origen: recibo de mantenimiento.',
  'panel.vigilante.fila-origen.lectura-local': 'Origen: lectura local.',
  'panel.vigilante.fila-origen.no-registrado': 'Origen no registrado.',
  'panel.vigilante.no-disponible': 'El vigilante no está configurado o no está disponible.',
  'panel.vigilante.accion-general': 'Revisa el estado y la evidencia disponible.',
  'panel.vigilante.accion-mantenimiento': 'Revisa el mantenimiento y su recibo.',
  'panel.vigilante.accion-programacion': 'Revisa la programación y el evento esperado.',
  'panel.vigilante.accion-programacion-apagada':
    'Enciéndela o, si la has apagado a propósito, indica hasta qué día dura la pausa en la configuración del servicio.',
  'panel.vigilante.fecha-dato': 'Fecha de los datos de {fuente}: {fecha}.',
  'panel.vigilante.programacion-no-evaluada': 'No se ha evaluado la programación.',
  'panel.vigilante.programacion-en-pausa': 'La programación está apagada a propósito. Último día de la pausa: {fecha}.',
  'panel.aviso.vigilante_conflicto':
    'El estado del vigilante ha cambiado. Vuelve a consultar el historial antes de continuar.',
  'panel.aviso.vigilante_no_disponible':
    'El vigilante no está preparado o disponible. Revisa su preparación antes de volver a comprobar.',
  'panel.aviso.vigilante_configuracion_invalida':
    'La configuración del vigilante no es válida. Corrígela en la configuración del servicio y vuelve a comprobar el estado.',
  'panel.vigilante.trabajo-actualizado': 'Última actualización del trabajo: {fecha}.',
  'panel.vigilante.motivo.sin_trabajo_reservado': 'No hay un trabajo reservado.',
  'panel.vigilante.motivo.trabajo_terminado_sin_resultado_admitido': 'El trabajo terminó sin un resultado admitido.',
  'panel.vigilante.motivo.trabajo_terminado': 'El trabajo terminó.',
  'panel.vigilante.motivo.inicio_no_confirmado': 'El inicio del trabajo no está confirmado.',
  'panel.vigilante.motivo.inicio_rechazado':
    'GitHub ha ejecutado una revisión del código que este servidor todavía no tiene autorizada, así que la actualización no ha empezado.',
  'panel.vigilante.motivo.inicio_confirmado_sin_cierre': 'El trabajo empezó, pero no hay cierre confirmado.',
  'panel.vigilante.motivo.evento_esperado_sin_registro': 'No consta el evento esperado.',
  'panel.vigilante.motivo.sin_evento_vencido': 'No consta un evento vencido.',
  'panel.vigilante.motivo.programacion_apagada':
    'La programación está apagada y no hay ninguna pausa declarada: los datos no se actualizan solos.',
  'panel.vigilante.motivo.programacion_en_pausa': 'La programación está en una pausa declarada.',
  'panel.vigilante.motivo.sin_observacion_correlacionada': 'No hay una observación relacionada.',
  'panel.vigilante.motivo.lectura_local_no_disponible': 'No se ha podido leer el estado local.',
  'panel.vigilante.motivo.observacion_de_mantenimiento_antigua': 'La observación de mantenimiento es anterior.',
  'panel.vigilante.motivo.observacion_disponible': 'Hay una observación de mantenimiento.',
  'panel.vigilante.motivo.lectura_local_disponible': 'La lectura local está disponible.',
  'panel.vigilante.motivo.legado_sin_comprobaciones_por_conjunto':
    'El estado anterior no detalla las comprobaciones por conjunto.',
  'panel.vigilante.motivo.contrato_con_comprobaciones': 'Hay comprobaciones detalladas por conjunto.',
  'panel.vigilante.motivo.comprobacion_sin-observacion': 'No consta una observación de la comprobación.',
  'panel.vigilante.motivo.comprobacion_vencida': 'La comprobación está vencida.',
  'panel.vigilante.motivo.comprobacion_comprobada': 'La comprobación está registrada.',
  'panel.vigilante.motivo.mantenimiento_incidencia': 'El mantenimiento comunica una incidencia.',
  'panel.vigilante.motivo.datos_validados_sin_publicar':
    'Hay datos validados que todavía no se han publicado en la web. Si los has publicado a mano, este aviso sigue hasta la próxima publicación confirmada.',
  'panel.vigilante.motivo.sin_datos_validados_por_publicar': 'No consta ningún dato validado pendiente de publicar.',
  'panel.vigilante.motivo.mantenimiento_atencion': 'El mantenimiento requiere atención.',
  'panel.vigilante.motivo.mantenimiento_comprobada': 'El mantenimiento comunica una comprobación.',
  'panel.vigilante.motivo.mantenimiento_local': 'El mantenimiento procede de una lectura local.',

  'panel.vigilante.decidido': 'Decisión: {fecha}.',
  'panel.vigilante.areas': 'Áreas evaluadas en esta comprobación:',
  'panel.vigilante.titulo': 'Comprobar estado',
  'panel.vigilante.intro': 'Evalúa la evidencia disponible sin iniciar una actualización de datos.',
  'panel.vigilante.comprobar': 'Comprobar estado',
  'panel.vigilante.historial': 'Consultar historial',
  'panel.vigilante.siguiente': 'Página siguiente',
  'panel.vigilante.sin-comprobar': 'Estado sin comprobar.',
  'panel.vigilante.error-comprobar':
    'No se ha podido confirmar la comprobación. Consulta el historial antes de volver a intentarlo.',
  'panel.vigilante.error-historial': 'No se ha podido consultar el historial. Vuelve a cargarlo.',
  'panel.vigilante.evaluado': 'Evaluado: {fecha}.',
  'panel.vigilante.observado': 'Observado: {fecha}.',
  'panel.vigilante.limite': 'El pulso continuo no está instrumentado y no se ha comprobado la entrega activa.',
  'panel.vigilante.origen-recibo': 'La comprobación busca evidencia en el recibo de mantenimiento.',
  'panel.vigilante.origen-local': 'La evaluación usa una lectura local.',
  'panel.vigilante.incidencias': 'Hay incidencias que requieren revisión.',
  'panel.vigilante.sin-incidencias': 'No hay incidencias activas registradas. Esto no confirma la entrega activa.',
  'panel.vigilante.conforme': 'Sin incidencia en esta evaluación.',
  'panel.vigilante.accion-trabajo': 'Revisa el último trabajo y su resultado antes de actuar.',
  'panel.vigilante.accion-inicio-rechazado': 'Publica esa revisión o vuelve a ejecutar la autorizada.',
  'panel.vigilante.accion-local': 'Revisa la disponibilidad de la lectura local.',
  'panel.vigilante.accion-comprobacion': 'Revisa la fuente y vuelve a comprobar su estado.',
  'panel.vigilante.historial-revision': 'Historial · revisión {revision}.',
  'panel.vigilante.eventos.titulo': 'Comprobaciones programadas registradas por el servidor:',
  'panel.vigilante.eventos.ninguno': 'No consta ninguna comprobación programada en el registro.',
  'panel.vigilante.eventos.fila': '{fecha}: {resultado} {motivo}',
  'panel.vigilante.eventos.resultado.nueva': 'Se lanzó una comprobación de datos.',
  'panel.vigilante.eventos.resultado.omitida-tardia': 'No se lanzó porque el aviso llegó fuera de su horario.',
  'panel.vigilante.eventos.resultado.omitida-candidato':
    'No se lanzó porque había datos nuevos preparados por resolver.',
  'panel.vigilante.eventos.resultado.omitida-ocupado': 'No se lanzó porque ya había una actualización en marcha.',
  'panel.vigilante.eventos.resultado.fallida': 'No se pudo hacer la comprobación diaria: falló {fase}. {fallo}',
  'panel.vigilante.eventos.fila-despacho':
    '{fecha}: {motivo} Se reservó la comprobación, pero no se pudo confirmar su lanzamiento. {fallo} Faro lo comprobará en la próxima comprobación diaria.',
  'panel.vigilante.eventos.fase.configuracion': 'la lectura de la configuración',
  'panel.vigilante.eventos.fase.validacion': 'la comprobación del horario',
  'panel.vigilante.eventos.fase.preparacion': 'la preparación del panel',
  'panel.vigilante.eventos.fase.reconciliacion': 'la consulta a GitHub, donde se ejecuta la actualización',
  'panel.vigilante.eventos.fase.reserva': 'la reserva de la actualización',
  'panel.vigilante.eventos.fase.despacho': 'el lanzamiento en GitHub',
  'panel.vigilante.eventos.motivo-fallo.error': 'No terminó correctamente.',
  'panel.vigilante.eventos.motivo-fallo.plazo-agotado': 'Tardó demasiado.',
  'panel.vigilante.eventos.motivo.sin-trabajo-pendiente': 'No había ninguna otra actualización abierta.',
  'panel.vigilante.eventos.motivo.evento-sin-consumir':
    'Se volverá a intentar mañana; si se repite, revisa la configuración.',
  'panel.vigilante.eventos.motivo.reserva-sin-inicio-liberada':
    'Una solicitud anterior que no llegó a empezar se dio por terminada.',
  'panel.vigilante.eventos.motivo.ejecucion-cerrada-sin-recibo':
    'La actualización anterior terminó sin dejar un resultado comprobable.',
  'panel.vigilante.eventos.motivo.evento-fuera-de-ventana':
    'El aviso llegó demasiado tarde para la comprobación del día.',
  'panel.vigilante.eventos.motivo.activacion-sin-resolver': 'Hay una publicación de datos sin terminar.',
  'panel.vigilante.eventos.motivo.candidato-en-plazo': 'Los datos nuevos preparados todavía pueden publicarse.',
  'panel.vigilante.eventos.motivo.trabajo-en-plazo': 'La actualización en marcha sigue dentro de su plazo.',
  'panel.vigilante.eventos.motivo.requiere-atencion':
    'La actualización anterior necesita que el equipo técnico la revise.',
};
