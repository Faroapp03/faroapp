// Avisos y acciones del estado del vigilante.
import { TEXTOS_AVISOS } from './panel-avisos.js';

export const TEXTOS_VIGILANTE = {
  ...TEXTOS_AVISOS,
  'panel.vigilante.fila-origen.recibo': 'Origen: rebut de manteniment.',
  'panel.vigilante.fila-origen.lectura-local': 'Origen: lectura local.',
  'panel.vigilante.fila-origen.no-registrado': 'Origen no registrat.',
  'panel.vigilante.no-disponible': 'El vigilant no està configurat o no està disponible.',
  'panel.vigilante.accion-general': 'Revisa l’estat i les proves disponibles.',
  'panel.vigilante.accion-mantenimiento': 'Revisa el manteniment i el rebut.',
  'panel.vigilante.accion-programacion': 'Revisa la programació i l’esdeveniment esperat.',
  'panel.vigilante.accion-programacion-apagada':
    'Engega-la o, si l’has aturada expressament, indica fins a quin dia dura la pausa a la configuració del servei.',
  'panel.vigilante.fecha-dato': 'Data de les dades de {fuente}: {fecha}.',
  'panel.vigilante.programacion-no-evaluada': 'No s’ha avaluat la programació.',
  'panel.vigilante.programacion-en-pausa': 'La programació està aturada expressament. Últim dia de la pausa: {fecha}.',
  'panel.aviso.vigilante_conflicto':
    'L’estat del vigilant ha canviat. Torna a consultar l’historial abans de continuar.',
  'panel.aviso.vigilante_no_disponible':
    'El vigilant no està preparat o disponible. Revisa’n la preparació abans de tornar a comprovar.',
  'panel.aviso.vigilante_configuracion_invalida':
    'La configuració del vigilant no és vàlida. Corregeix-la a la configuració del servei i torna a comprovar l’estat.',
  'panel.vigilante.trabajo-actualizado': 'Última actualització del treball: {fecha}.',
  'panel.vigilante.motivo.sin_trabajo_reservado': 'No hi ha cap treball reservat.',
  'panel.vigilante.motivo.trabajo_terminado_sin_resultado_admitido': 'El treball ha acabat sense un resultat admès.',
  'panel.vigilante.motivo.trabajo_terminado': 'El treball ha acabat.',
  'panel.vigilante.motivo.inicio_no_confirmado': 'L’inici del treball no està confirmat.',
  'panel.vigilante.motivo.inicio_rechazado':
    'GitHub ha executat una revisió del codi que aquest servidor encara no té autoritzada, així que l’actualització no ha començat.',
  'panel.vigilante.motivo.inicio_confirmado_sin_cierre':
    'El treball ha començat, però no hi ha un tancament confirmat.',
  'panel.vigilante.motivo.evento_esperado_sin_registro': 'No consta l’esdeveniment esperat.',
  'panel.vigilante.motivo.sin_evento_vencido': 'No consta cap esdeveniment vençut.',
  'panel.vigilante.motivo.programacion_apagada':
    'La programació està aturada i no hi ha cap pausa declarada: les dades no s’actualitzen soles.',
  'panel.vigilante.motivo.programacion_en_pausa': 'La programació està en una pausa declarada.',
  'panel.vigilante.motivo.sin_observacion_correlacionada': 'No hi ha cap observació relacionada.',
  'panel.vigilante.motivo.lectura_local_no_disponible': 'No s’ha pogut llegir l’estat local.',
  'panel.vigilante.motivo.observacion_de_mantenimiento_antigua': 'L’observació de manteniment és anterior.',
  'panel.vigilante.motivo.observacion_disponible': 'Hi ha una observació de manteniment.',
  'panel.vigilante.motivo.lectura_local_disponible': 'La lectura local està disponible.',
  'panel.vigilante.motivo.legado_sin_comprobaciones_por_conjunto':
    'L’estat anterior no detalla les comprovacions per conjunt.',
  'panel.vigilante.motivo.contrato_con_comprobaciones': 'Hi ha comprovacions detallades per conjunt.',
  'panel.vigilante.motivo.comprobacion_sin-observacion': 'No consta cap observació de la comprovació.',
  'panel.vigilante.motivo.comprobacion_vencida': 'La comprovació està vençuda.',
  'panel.vigilante.motivo.comprobacion_comprobada': 'La comprovació està registrada.',
  'panel.vigilante.motivo.mantenimiento_incidencia': 'El manteniment comunica una incidència.',
  'panel.vigilante.motivo.datos_validados_sin_publicar':
    'Hi ha dades validades que encara no s’han publicat al web. Si les has publicat a mà, aquest avís continua fins a la propera publicació confirmada.',
  'panel.vigilante.motivo.sin_datos_validados_por_publicar': 'No consta cap dada validada pendent de publicar.',
  'panel.vigilante.motivo.mantenimiento_atencion': 'El manteniment requereix atenció.',
  'panel.vigilante.motivo.mantenimiento_comprobada': 'El manteniment comunica una comprovació.',
  'panel.vigilante.motivo.mantenimiento_local': 'El manteniment prové d’una lectura local.',

  'panel.vigilante.decidido': 'Decisió: {fecha}.',
  'panel.vigilante.areas': 'Àrees avaluades en aquesta comprovació:',
  'panel.vigilante.titulo': 'Comprovar estat',
  'panel.vigilante.intro': 'Avalua les proves disponibles sense iniciar una actualització de dades.',
  'panel.vigilante.comprobar': 'Comprovar estat',
  'panel.vigilante.historial': 'Consultar historial',
  'panel.vigilante.siguiente': 'Pàgina següent',
  'panel.vigilante.sin-comprobar': 'Estat sense comprovar.',
  'panel.vigilante.error-comprobar':
    'No s’ha pogut confirmar la comprovació. Consulta l’historial abans de tornar-ho a provar.',
  'panel.vigilante.error-historial': 'No s’ha pogut consultar l’historial. Torna a carregar-lo.',
  'panel.vigilante.evaluado': 'Avaluat: {fecha}.',
  'panel.vigilante.observado': 'Observat: {fecha}.',
  'panel.vigilante.limite': 'El pols continu no està instrumentat i no s’ha comprovat el lliurament actiu.',
  'panel.vigilante.origen-recibo': 'La comprovació busca proves en el rebut de manteniment.',
  'panel.vigilante.origen-local': 'L’avaluació fa servir una lectura local.',
  'panel.vigilante.incidencias': 'Hi ha incidències que cal revisar.',
  'panel.vigilante.sin-incidencias': 'No hi ha incidències actives registrades. Això no confirma el lliurament actiu.',
  'panel.vigilante.conforme': 'Sense incidència en aquesta avaluació.',
  'panel.vigilante.accion-trabajo': 'Revisa l’últim treball i el resultat abans d’actuar.',
  'panel.vigilante.accion-inicio-rechazado': 'Publica aquesta revisió o torna a executar l’autoritzada.',
  'panel.vigilante.accion-local': 'Revisa la disponibilitat de la lectura local.',
  'panel.vigilante.accion-comprobacion': 'Revisa la font i torna a comprovar-ne l’estat.',
  'panel.vigilante.historial-revision': 'Historial · revisió {revision}.',
  'panel.vigilante.eventos.titulo': 'Comprovacions programades registrades pel servidor:',
  'panel.vigilante.eventos.ninguno': 'No consta cap comprovació programada al registre.',
  'panel.vigilante.eventos.fila': '{fecha}: {resultado} {motivo}',
  'panel.vigilante.eventos.resultado.nueva': 'Es va llançar una comprovació de dades.',
  'panel.vigilante.eventos.resultado.omitida-tardia': 'No es va llançar perquè l’avís va arribar fora del seu horari.',
  'panel.vigilante.eventos.resultado.omitida-candidato':
    'No es va llançar perquè hi havia dades noves preparades per resoldre.',
  'panel.vigilante.eventos.resultado.omitida-ocupado':
    'No es va llançar perquè ja hi havia una actualització en marxa.',
  'panel.vigilante.eventos.resultado.fallida': 'No es va poder fer la comprovació diària: va fallar {fase}. {fallo}',
  'panel.vigilante.eventos.fila-despacho':
    '{fecha}: {motivo} Es va reservar la comprovació, però no se’n va poder confirmar l’inici. {fallo} Faro ho comprovarà a la propera comprovació diària.',
  'panel.vigilante.eventos.fase.configuracion': 'la lectura de la configuració',
  'panel.vigilante.eventos.fase.validacion': 'la comprovació de l’horari',
  'panel.vigilante.eventos.fase.preparacion': 'la preparació del tauler',
  'panel.vigilante.eventos.fase.reconciliacion': 'la consulta a GitHub, on s’executa l’actualització',
  'panel.vigilante.eventos.fase.reserva': 'la reserva de l’actualització',
  'panel.vigilante.eventos.fase.despacho': 'l’inici a GitHub',
  'panel.vigilante.eventos.motivo-fallo.error': 'No va acabar correctament.',
  'panel.vigilante.eventos.motivo-fallo.plazo-agotado': 'Va trigar massa.',
  'panel.vigilante.eventos.motivo.sin-trabajo-pendiente': 'No hi havia cap altra actualització oberta.',
  'panel.vigilante.eventos.motivo.evento-sin-consumir':
    'Es tornarà a provar demà; si es repeteix, revisa la configuració.',
  'panel.vigilante.eventos.motivo.reserva-sin-inicio-liberada':
    'Una sol·licitud anterior que no va arribar a començar es va donar per acabada.',
  'panel.vigilante.eventos.motivo.ejecucion-cerrada-sin-recibo':
    'L’actualització anterior va acabar sense deixar un resultat comprovable.',
  'panel.vigilante.eventos.motivo.evento-fuera-de-ventana':
    'L’avís va arribar massa tard per a la comprovació del dia.',
  'panel.vigilante.eventos.motivo.activacion-sin-resolver': 'Hi ha una publicació de dades sense acabar.',
  'panel.vigilante.eventos.motivo.candidato-en-plazo': 'Les dades noves preparades encara es poden publicar.',
  'panel.vigilante.eventos.motivo.trabajo-en-plazo': 'L’actualització en marxa encara és dins del seu termini.',
  'panel.vigilante.eventos.motivo.requiere-atencion':
    'L’actualització anterior necessita que l’equip tècnic la revisi.',
};
