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
  'panel.titulo': 'Tauler de Control · Faro',
  'panel.ver-web': 'Veure el web',
  'panel.encabezado': 'Tauler de Control',
  'panel.sesion.inicial': 'Obre la sessió única per consultar i canviar el servei.',
  'panel.reconectar': 'Comprovar la connexió',
  'panel.sin-script': 'El panell necessita JavaScript per comprovar la sessió i aplicar els canvis.',
  'panel.controles.titulo': 'Controls',
  'panel.controles.consultar': 'Consultar els controls',
  'panel.controles.leyenda': 'Configuració dels serveis',
  'panel.conectividad.titulo': 'Connectivitat',
  'panel.api': 'API per a aplicacions',
  'panel.api.ayuda':
    'Apagar l’API conserva les claus de les institucions. Per retirar una clau o un accés, fes servir Institucions.',
  'panel.conectividad.ayuda':
    'Cada connexió es gestiona de manera independent. El web pot continuar funcionant amb aquestes connexions apagades.',
  'panel.secciones.titulo': 'Seccions públiques',
  'panel.secciones.intro':
    'Obre o tanca aquestes pàgines i els seus enllaços. Les connexions per a aplicacions i assistents d’IA es gestionen a Connectivitat.',
  'panel.secciones.copias':
    'Qui faci servir Faro sense connexió veurà l’últim estat que va conèixer fins que torni a connectar-se. L’inici i les pàgines legals, d’accessibilitat i de verificació sempre estan disponibles.',
  'panel.secciones.consultar': 'Consultar les seccions',
  'panel.secciones.leyenda': 'Pàgines disponibles',
  'panel.seccion.ia': 'Què és la IA',
  'panel.seccion.faro': 'Què és Faro',
  'panel.seccion.recorrido': 'Començar: recorregut i informe d’exemple',
  'panel.seccion.cursos': 'Cursos',
  'panel.seccion.biblioteca': 'Biblioteca',
  'panel.seccion.globales': 'Dades globals: Catalunya, UE i món',
  'panel.seccion.doctor': 'Comprovar',
  'panel.seccion.encuesta': 'Enquesta',
  'panel.secciones.guardar': 'Desar les seccions',
  'panel.datos.titulo': 'Estat de les fonts',
  'panel.datos.intro':
    'Comprova quines fonts s’han consultat bé, quines necessiten atenció i què convé fer. Aquesta lectura no diu quina versió de les dades veuen ara les persones.',
  'panel.datos.consultar': 'Consultar l’estat de les dades',
  'panel.trabajos.titulo': 'Comprovar actualitzacions',
  'panel.trabajos.intro':
    'Faro busca dades noves a les fonts i les revisa abans de preparar-les. Les dades preparades no es veuen al web fins que es publiquen.',
  'panel.trabajos.consultar': 'Veure com va l’actualització',
  'panel.trabajos.buscar': 'Actualitzar dades',
  'panel.trabajos.reintentar': 'Tornar a intentar el que va quedar pendent',
  'panel.trabajos.vencidas': 'Comprovar les fonts que toquen avui',
  'panel.trabajos.cursos': 'Actualitzar només els cursos',
  'panel.trabajos.ayuda':
    'Torna a consultar només les fonts que no es van poder comprovar l’última vegada. Si no queda res pendent, acaba sense canvis.',
  'panel.trabajos.retirar': 'Retirar la sol·licitud',
  'panel.trabajos.reconciliar': 'Comprovar com va acabar',
  'panel.trabajos.limites':
    'Retirar la sol·licitud no atura una actualització que ja ha començat. «Comprovar com va acabar» pregunta pel resultat i l’anota; no publica dades.',
  'panel.activacion.titulo': 'Publicació de les dades',
  'panel.activacion.intro':
    'Mostra l’última publicació de dades anotada pel servidor. No comprova quina versió veuen ara les persones.',
  'panel.activacion.consultar': 'Consultar l’última publicació',
  'panel.reserva': 'Accés reservat als usuaris administradors autoritzats.',
  'panel.revision': 'Configuració confirmada pel servidor.',
  'panel.sesion.comprobando': 'Comprovant el servei…',
  'panel.sesion.activa': 'Sessió activa. Els controls reflecteixen l’última configuració confirmada.',
  'panel.sesion.cargando': 'Comprovant el panell…',
  'panel.sesion.cerrada': 'El panell està tancat.',
  'panel.sesion.caducada': 'La sessió ja no està activa.',
  'panel.sesion.error': 'No s’ha pogut obrir la sessió única. Torna-ho a provar d’aquí a un moment.',
  'panel.sesion.desconectada': 'Comprova la connexió per recuperar l’estat.',
  'panel.controles.no_disponibles': 'La modificació d’aquests serveis no està disponible en aquest entorn.',
  'panel.controles.pendientes':
    'La configuració ha canviat en una altra sessió. Consulta els controls abans de desar; es conserva el que has marcat.',
  'panel.secciones.confirmadas': 'El servidor ha confirmat quines pàgines estan obertes.',
  'panel.secciones.pendientes':
    'Consulta les seccions per revisar-ne la disponibilitat abans de desar. Es conserva qualsevol esborrany mostrat.',
  'panel.secciones.reemplazar': 'Vols consultar les seccions i substituir l’esborrany pels valors confirmats?',
  'panel.controles.reemplazar': 'Vols consultar els controls i substituir l’esborrany pels valors confirmats?',
  'panel.seguimiento.limitado':
    'Seguiment automàtic limitat mentre aquesta pestanya sigui visible. Pots consultar l’estat manualment.',
  'panel.seguimiento.finalizado':
    'El seguiment automàtic ha acabat. Prem «Veure com va l’actualització» per continuar.',
  'panel.fecha-no-representable': 'Data no representable',
  'panel.trabajo.detalle': 'La sol·licitud es va crear {fecha}.',
  'panel.trabajo.confirmar-retirada':
    'Vols retirar aquesta sol·licitud? {detalle} Si l’actualització ja ha començat, no s’aturarà. El servidor només la retira si encara és possible.',
  'panel.trabajo.confirmar-reconciliacion':
    'Vols comprovar com va acabar aquesta actualització? {detalle} Faro en preguntarà el resultat i l’anotarà. No es publica cap dada.',
  'panel.trabajo.cambiado':
    'L’actualització que veies ha canviat. Revisa’n l’estat abans de confirmar una altra operació.',
  'panel.aviso.secciones_no_disponibles':
    'No s’han pogut consultar les seccions. Torna-les a consultar abans de desar.',
  'panel.aviso.secciones_inciertas':
    'No s’ha confirmat el canvi de seccions. Consulta les seccions i els controls abans d’un altre canvi.',
  'panel.aviso.revision_secciones_conflictiva':
    'La configuració ha canviat. Consulta les seccions per revisar els valors actuals abans de desar.',
  'panel.aviso.secciones_guardadas':
    'Seccions desades. Consulta els controls abans de canviar-los per veure’n la configuració actual.',
  'panel.aviso.sin_conexion': 'No s’ha pogut comprovar la connexió. Els controls estan bloquejats.',
  'panel.aviso.tiempo_agotado': 'La comprovació ha trigat massa. Torna a comprovar la connexió.',
  'panel.aviso.respuesta_invalida': 'No s’ha pogut comprovar la resposta del servei.',
  'panel.aviso.resultado_desconocido':
    'No s’ha pogut confirmar el resultat. Comprova l’estat abans de tornar-lo a canviar.',
  'panel.aviso.acceso_denegado': 'L’accés no està autoritzat. Torna a identificar-te per entrar al panell.',
  'panel.aviso.no_disponible': 'El panell no està disponible en aquest moment.',
  'panel.aviso.solicitud_rechazada':
    'El servidor no ha admès l’operació. Revisa l’estat confirmat abans de tornar a actuar.',
  'panel.aviso.revision_conflictiva': 'La configuració ha canviat. Revisa els valors actualitzats abans de desar.',
  'panel.aviso.sesion_sustituida': 'La teva sessió s’ha tancat perquè el panell s’ha obert en un altre lloc',
  'panel.aviso.sesion_inactiva': 'La sessió ja no està activa. Pots tornar a obrir el panell.',
  'panel.aviso.trabajos_no_disponibles':
    'No s’ha pogut consultar l’actualització. Torna-la a consultar per poder-ne demanar una altra.',
  'panel.aviso.actualizacion_incierta':
    'No s’ha pogut confirmar que s’hagi demanat l’actualització. Consulta com va abans de tornar-la a demanar.',
  'panel.aviso.trabajo_ocupado': 'Ja hi ha una actualització en marxa. Consulta com va.',
  'panel.aviso.revision_trabajos_conflictiva':
    'L’actualització ha canviat o ja no admet aquesta operació. Revisa’n l’estat abans de tornar a actuar.',
  'panel.aviso.recuperacion_incierta':
    'No s’ha pogut confirmar l’operació. Consulta com va l’actualització abans de tornar a actuar.',
  'panel.aviso.trabajo_retirado': 'Sol·licitud retirada. Si l’actualització ja havia començat, no s’ha aturat.',
  'panel.aviso.trabajo_en_curso': 'L’actualització continua en marxa. Encara no hi ha resultat i no s’ha publicat res.',
  'panel.aviso.trabajo_sin_ejecucion':
    'Aquesta actualització encara no ha començat, així que no hi ha cap resultat per comprovar. Consulta com va.',
  'panel.aviso.trabajo_terminado':
    'L’actualització ja ha acabat. Revisa’n el resultat; aquesta comprovació no publica dades.',
  'panel.aviso.activacion_no_disponible':
    'No s’ha pogut consultar l’última publicació. Torna-ho a provar d’aquí a uns minuts.',
  'panel.aviso.datos_no_disponibles':
    'No s’ha pogut consultar l’estat de les dades. Si hi ha una actualització en marxa, torna-ho a consultar quan acabi; la resta d’apartats continuen disponibles.',
  'panel.datos.local.verde': 'Preparació correcta',
  'panel.datos.local.ambar': 'Es conserva la versió anterior',
  'panel.datos.local.rojo': 'Requereix revisió',
  'panel.datos.operacion.en-curso': 'En marxa segons el registre; no garanteix que continuï funcionant',
  'panel.datos.operacion.interrumpido': 'Interrompuda',
  'panel.datos.operacion.comprobada': 'Consulta correcta',
  'panel.datos.operacion.completa': 'Consulta completa; la font no ho cobreix tot',
  'panel.datos.operacion.parcial': 'Consulta incompleta',
  'panel.datos.operacion.fallo': 'Consulta fallida',
  'panel.datos.operacion.local': 'Comprovació dins de Faro, sense consultar la font oficial',
  'panel.datos.alcance.copia-local': 'Còpia local conservada',
  'panel.datos.alcance.edicion-conocida': 'Edició coneguda',
  'panel.datos.alcance.catalogo-actual': 'Catàleg actual consultable',
  'panel.datos.alcance.serie-abierta': 'Sèrie oberta consultable',
  'panel.datos.alcance.descubre-edicion': 'Consulta que busca una edició nova',
  'panel.datos.alcance.contenido-actual-acotado': 'Contingut actual acotat',
  'panel.datos.alcance.recurso-actual-sin-edicion': 'Recurs actual sense edició identificada',
  'panel.datos.alcance.entradas-admitidas': 'Entrades admeses per a recomposició local',
  'panel.datos.alcance.productor-externo': 'Productor extern',
  'panel.datos.limite.copia-local': 'La còpia local no acredita una consulta oficial.',
  'panel.datos.limite.edicion-conocida': 'No acredita que s’hagin descobert edicions posteriors.',
  'panel.datos.limite.catalogo-actual': 'La comprovació es limita al catàleg declarat.',
  'panel.datos.limite.serie-abierta': 'La comprovació es limita a la sèrie declarada.',
  'panel.datos.limite.descubre-edicion': 'La cerca es limita a les edicions del recurs declarat.',
  'panel.datos.limite.contenido-actual-acotado': 'No acredita una revisió completa del contingut oficial.',
  'panel.datos.limite.recurso-actual-sin-edicion': 'No identifica cap edició ni acredita el descobriment d’una altra.',
  'panel.datos.limite.entradas-admitidas': 'Recompondre les entrades no consulta els seus productors.',
  'panel.datos.limite.productor-externo': 'La consulta al productor extern no està automatitzada per aquesta cadena.',
  'panel.datos.conjunto.descargar': 'Consulta remota planificada',
  'panel.datos.conjunto.revision': 'Revisió manual',
  'panel.datos.conjunto.integridad': 'Integritat local',
  'panel.datos.conjunto.recomponer': 'Recomposició local',
  'panel.no-consta': 'No consta',
  'panel.si': 'Sí',
  'panel.no': 'No',
  'panel.sin-registro': 'Sense registre',
  'panel.datos.sin-operacion': 'Sense cap operació registrada en aquesta observació.',
  'panel.datos.sin-comprobacion': 'Sense registre en aquesta observació',
  'panel.datos.sin-resultado-remoto': 'Sense resultat remot conservat; no es dedueix de la data d’un intent.',
  'panel.datos.revision-manual': 'Requereix revisió manual, encara que hi consti una comprovació oficial.',
  'panel.datos.tabla.titulo': 'Fonts que consulta Faro',
  'panel.datos.tabla.fuente': 'Font',
  'panel.datos.tabla.local': 'Preparació a Faro',
  'panel.datos.tabla.consulta': 'Consulta oficial',
  'panel.datos.tabla.cobertura': 'Cobertura',
  'panel.datos.tabla.limites': 'Límits i revisió',
  'panel.datos.tabla.region': 'Estat de les fonts; taula desplaçable',
  'panel.datos.sin-intento': 'Sense intent registrat',
  'panel.datos.sin-resultado-local': 'Sense resultat local registrat',
  'panel.datos.sin-consulta': 'Evidència de consulta oficial no disponible en aquesta observació.',
  'panel.datos.sin-cobertura': 'Cobertura no disponible en aquesta observació.',
  'panel.datos.sin-revision':
    'Aquesta observació no permet determinar la revisió necessària ni si hi va haver una consulta oficial.',
  'panel.datos.externos': 'Productors externs',
  'panel.datos.observacion': 'Observació del panell',
  'panel.datos.reconstruccion-pendiente':
    'Hi ha una preparació de dades pendent segons el registre; no vol dir que estigui en marxa.',
  'panel.datos.detalle': 'Detall tècnic de l’observació',
  'panel.datos.no-disponible': 'No disponible en aquesta observació',
  'panel.fecha-no-valida': 'Data no vàlida',
  'panel.datos.ultima-comprobacion': 'Última comprovació registrada',
  'panel.datos.diagnostico': 'Diagnòstic i passos següents',
  'panel.datos.ultimo-intento': 'Últim intent de consulta',
  'panel.datos.no-conservado': 'No conservat en aquesta observació',
  'panel.datos.reintento': 'Reintent previst en el registre',
  'panel.datos.todas': 'Totes',
  'panel.datos.estado-comprobacion': 'Estat de comprovació',
  'panel.datos.comprobacion-fuentes': 'Comprovació de les fonts',
  'panel.datos.estado-global': 'Estat global de les comprovacions',
  'panel.datos.que-indican': 'Què indiquen aquests indicadors',
  'panel.datos.alcance-luces':
    'Indiquen com va anar l’última comprovació de cada font i quines necessiten atenció. La vigència dels cursos i la versió publicada es comproven a part. El termini indica cada quant toca consultar la font.',
  'panel.datos.otras': 'Fonts en preparació i fonts d’altres entitats',
  'panel.datos.otras-limite': 'Aquestes fonts no compten en el resum. Que apareguin aquí no les posa en marxa.',
  'panel.trabajo.solicitada-incierta':
    'Sol·licitud enviada, però no s’ha confirmat que l’actualització hagi començat. Consulta com va abans de tornar-la a demanar.',
  'panel.trabajo.en-curso': 'Sol·licitud enviada al sistema d’actualització; encara no hi ha resultat.',
  'panel.trabajo.resultado.validado':
    'Dades noves preparades, encara no publicades. Es publiquen al web en un pas a part.',
  'panel.trabajo.resultado.sin-pendientes':
    'L’actualització ha acabat sense res pendent. Això no garanteix que totes les fonts estiguin al dia.',
  'panel.trabajo.resultado.rechazado': 'L’actualització no ha preparat dades noves perquè no han superat la revisió.',
  'panel.trabajo.resultado.despacho-rechazado': 'L’actualització no ha pogut començar. Avisa l’equip tècnic.',
  'panel.trabajo.resultado.retirado': 'Sol·licitud retirada abans que comencés l’actualització.',
  'panel.trabajo.resultado.ejecucion-sin-recibo':
    'L’actualització ha acabat sense deixar un resultat que es pugui comprovar. Avisa l’equip tècnic.',
  'panel.trabajo.sin-resultado': 'Resultat no disponible.',
  'panel.trabajo.consulta-inicial': 'Consulta com va l’actualització per poder-ne demanar una altra.',
  'panel.trabajo.sin-trabajos': 'Encara no s’ha demanat cap actualització. Pots demanar-ne una ara.',
  'panel.trabajo.programada': 'Comprovació automàtica programada',
  'panel.trabajo.error.actualizacion_no_completada': 'L’actualització no s’ha completat.',
  'panel.trabajo.error.actualizacion_no_admitida': 'El resultat de l’actualització no ha superat la validació.',
  'panel.trabajo.error.candidato_no_verificable': 'No s’han pogut comprovar les dades preparades.',
  'panel.salud.estado.atencion': 'Necessita atenció',
  'panel.salud.estado.incidencia': 'No s’ha pogut comprovar',
  'panel.salud.estado.pendiente': 'Consulta pendent',
  'panel.salud.estado.revision': 'Revisió manual',
  'panel.salud.estado.sin-observacion': 'Sense comprovació registrada',
  'panel.salud.estado.local': 'Comprovada dins de Faro',
  'panel.salud.estado.comprobada': 'Comprovada',
  'panel.salud.estado.candidata': 'En preparació',
  'panel.salud.estado.externa': 'Revisada per una altra entitat',
  'panel.salud.estado.productor-local': 'Calculada per Faro',
  'panel.tema.cursos': 'Cursos',
  'panel.tema.ocupaciones': 'Ocupacions',
  'panel.tema.ia_y_trabajo': 'IA i treball',
  'panel.tema.mercado': 'Mercat',
  'panel.tema.derechos': 'Drets',
  'panel.tema.biblioteca': 'Biblioteca',
  'panel.tema.comun': 'Dades comunes',
  'panel.tema.derivados': 'Dades derivades',
  'panel.tema.sin-tema': 'Tema no conservat en aquesta observació',
  'panel.salud.mensaje.atencion': 'L’última preparació de dades necessita revisió. No s’ha publicat res de nou.',
  'panel.salud.accion.atencion': 'Avisa l’equip tècnic abans de demanar una altra actualització.',
  'panel.salud.mensaje.incidencia':
    'L’última consulta a aquesta font no va acabar bé. Faro no canvia les dades publicades per aquesta fallada.',
  'panel.salud.accion.incidencia':
    'Prem Actualitzar dades o «Tornar a intentar el que va quedar pendent». Si torna a fallar, avisa l’equip tècnic.',
  'panel.salud.mensaje.pendiente':
    'Ja toca tornar a consultar aquesta font, o falta confirmar com va acabar l’última consulta. No vol dir que les dades estiguin malament.',
  'panel.salud.accion.pendiente': 'Mira com va l’actualització; si no n’hi ha cap en marxa, prem Actualitzar dades.',
  'panel.salud.mensaje.revision': 'Aquesta font es revisa a mà.',
  'panel.salud.accion.revision':
    'Avisa l’equip tècnic quan toqui revisar-la; tornar-la a baixar no substitueix aquesta revisió.',
  'panel.salud.mensaje.sin-observacion': 'No consta cap comprovació d’aquesta font.',
  'panel.salud.accion.sin-observacion':
    'Avisa l’equip tècnic. Que no consti una comprovació no vol dir que la font hagi fallat.',
  'panel.salud.mensaje.local': 'Aquestes dades es comproven dins de Faro, sense consultar la font oficial.',
  'panel.salud.accion.local': 'No cal fer res.',
  'panel.salud.mensaje.comprobada': 'La font es va consultar bé en l’última comprovació.',
  'panel.salud.accion.comprobada': 'No cal fer res. Faro la tornarà a consultar quan toqui.',
  'panel.salud.mensaje.candidata': 'Aquesta font està preparada, però encara no es fa servir en les actualitzacions.',
  'panel.salud.accion.candidata': 'No cal fer res. L’equip tècnic decideix quan incorporar-la.',
  'panel.salud.mensaje.productor-local': 'Aquestes dades les calcula Faro a partir d’altres fonts ja desades.',
  'panel.salud.accion.productor-local':
    'No cal fer res. Si canvien les seves fonts, l’equip tècnic les torna a calcular.',
  'panel.salud.mensaje.externa': 'Aquestes dades les revisa una altra entitat, fora de l’actualització automàtica.',
  'panel.salud.accion.externa': 'No cal fer res. Si dubtes de la seva vigència, consulta l’equip tècnic.',
  'panel.datos.ultima-operacion': 'Última operació: {v0}.',
  'panel.datos.inicio-fin': 'Inici: {v0}. Fi: {v1}.',
  'panel.datos.remota-prevista': 'Consulta remota prevista en aquesta operació: {v0}.',
  'panel.datos.ultimo-remoto': 'Últim intent remot: {v0}.',
  'panel.datos.conjunto-comprobacion': '{v0} · Última comprovació oficial registrada: {v1}.',
  'panel.datos.resultado-remoto': 'Últim resultat remot conservat: {v0}. Inici: {v1}. Fi: {v2}.',
  'panel.datos.comprobacion-pendiente': '{v0} · Comprovació pendent, iniciada {v1}; resultat: {v2}.',
  'panel.datos.intervalo': '; interval previst: {v0} dies',
  'panel.datos.politica-fecha': 'Política: {v0}. Data de referència: {v1}.',
  'panel.datos.ultimo-local': 'Últim intent local: {v0}.',
  'panel.datos.ultima-buena': 'Última versió bona conservada: {v0}.',
  'panel.datos.consultado': 'Estat consultat: {v0}.',
  'panel.datos.registro': 'Registre de comprovacions: {v0}.',
  'panel.datos.resultado-consulta': 'Resultat d’aquesta consulta: {v0}.',
  'panel.datos.que-hacer': 'Què cal fer: {v0}',
  'panel.datos.proxima-consulta': 'Pròxima consulta: {v0}.',
  'panel.datos.fallos-seguidos': 'Intents fallits seguits: {v0}.',
  'panel.datos.consulta-parcial':
    'Consulta parcial: {v0} de {v1} unitats sense resposta; es conserva la seva última comprovació.',
  'panel.datos.revision-pendiente': 'La revisió de les fitxes de Formació oberta està pendent: va vèncer {v0}.',
  'panel.datos.revision-prevista': 'La revisió de les fitxes de Formació oberta venç {v0}.',
  'panel.datos.cobertura-limitada': 'Cobertura limitada: {v0}.',
  'panel.datos.cobertura-limitada.censo-con-copias-fijadas':
    'la consulta renova el cens de Cibernàrium, però el catàleg d’ocupacions i les pàgines històriques conserven les seves dates pròpies',
  'panel.datos.cobertura-limitada.indices-sin-censo':
    'els índexs públics registren la presència de programes, però no aporten un cens complet ni renoven les edicions conservades',
  'panel.datos.recuento': '{v0} de {v1} fonts en ús en aquesta lectura.',
  'panel.solicitud-id': 'Sol·licitud: {v0}.',
  'panel.trabajo.fecha-solicitud': '{v0}. Sol·licitada {v1}.',
  'panel.trabajo.finalizada': 'Acabada {v0}.',
  'panel.instituciones.titulo': 'Institucions',
  'panel.instituciones.intro':
    'Convida una institució, lliura l’enllaç i gestiona les seves claus. Faro no envia correus. L’estat de la institució descriu les seves credencials; l’API s’encén o s’apaga a Connectivitat.',
  'panel.instituciones.consultar': 'Consultar les institucions',
  'panel.instituciones.consultar-primero': 'Consulta les institucions abans de convidar o retirar un accés.',
  'panel.instituciones.nueva': 'Nova institució',
  'panel.instituciones.nombre': 'Nom de la institució o del sistema',
  'panel.instituciones.correo': 'Correu',
  'panel.instituciones.correo-opcional': 'Correu de la institució (opcional)',
  'panel.instituciones.correo-ayuda': 'Només s’anota en aquesta fitxa. L’enviament de l’enllaç és manual.',
  'panel.instituciones.invitar': 'Convidar',
  'panel.instituciones.entrega': 'Lliura aquest enllaç',
  'panel.instituciones.enlace-ayuda':
    'L’enllaç és d’un sol ús i caduca al cap de set dies. No es pot recuperar en tornar a consultar la llista.',
  'panel.instituciones.enlace': 'Enllaç d’invitació',
  'panel.instituciones.copiar': 'Copiar l’enllaç',
  'panel.instituciones.enviar': 'Obrir el correu per lliurar-lo',
  'panel.instituciones.descartar': 'Amagar i oblidar l’enllaç',
  'panel.instituciones.sin-registros': 'No hi ha institucions registrades en aquesta lectura.',
  'panel.instituciones.sin-correo': 'No anotat',
  'panel.instituciones.estado': 'Estat',
  'panel.instituciones.estado.invitada': 'Convidada',
  'panel.instituciones.estado.activa': 'Activa',
  'panel.instituciones.estado.retirada': 'Retirada',
  'panel.instituciones.ultima-conexion': 'Última connexió registrada',
  'panel.instituciones.sin-conexion': 'Sense connexió registrada',
  'panel.instituciones.consultas': 'Consultes registrades',
  'panel.instituciones.caducidad': 'Caducitat de la invitació',
  'panel.instituciones.clave-id': 'Identificador de la clau',
  'panel.instituciones.clave-creada': 'Clau creada',
  'panel.instituciones.retirar-clave': 'Retirar aquesta clau',
  'panel.instituciones.renovar': 'Nova invitació',
  'panel.instituciones.retirar': 'Retirar l’accés',
  'panel.instituciones.confirmar-clave':
    'Vols retirar la clau {id} de {nombre}? Deixarà de servir per a noves consultes quan el servidor ho confirmi.',
  'panel.instituciones.confirmar-renovar':
    'Vols crear una nova invitació per a {nombre}? Substituirà la invitació pendent. Les claus actives es conserven fins que les retiris.',
  'panel.instituciones.confirmar-retirar':
    'Vols retirar l’accés de {nombre}? Se n’invalidaran la invitació, les claus i els tokens quan el servidor ho confirmi.',
  'panel.instituciones.dos-claves':
    'Hi ha dues claus actives durant el relleu. Retira’n una abans de crear una altra invitació.',
  'panel.instituciones.enlace-caduca': 'La invitació caduca {fecha}.',
  'panel.instituciones.copiado': 'Enllaç copiat. Lliura’l només a la institució convidada.',
  'panel.instituciones.copia-manual': 'Selecciona l’enllaç i copia’l.',
  'panel.instituciones.correo-manual':
    'Revisa el missatge a la teva aplicació de correu abans d’enviar-lo. Faro no l’envia.',
  'panel.instituciones.correo-asunto': 'Invitació d’accés a Faro',
  'panel.instituciones.correo-cuerpo':
    'La teva institució pot activar l’accés a Faro amb aquest enllaç: {direccion}\n\nCaduca al cap de set dies i només es pot utilitzar una vegada. Prem «Generar clau» quan puguis desar-la. La clau es desa al servidor de la teva institució, mai en un web ni en un navegador.',
  'panel.aviso.instituciones_no_disponibles':
    'No s’han pogut consultar les institucions. Torna-les a consultar abans de canviar un accés.',
  'panel.aviso.instituciones_inciertas':
    'No s’ha confirmat el canvi. Consulta la llista abans d’una altra operació. Si es va crear una invitació i es va perdre la resposta, demana una nova invitació des de la seva fitxa.',
  'panel.aviso.revision_instituciones_conflictiva':
    'La llista ha canviat. Consulta les institucions i revisa els valors abans de tornar a actuar.',
  'panel.aviso.limite_instituciones':
    'S’ha arribat al límit d’institucions. Consulta la llista abans de revisar els accessos.',
  'panel.aviso.dos_claves_activas':
    'La institució ja té dues claus actives. Consulta’n la fitxa i retira’n una abans de renovar.',
  'panel.aviso.institucion_no_encontrada':
    'La institució o la clau ja no està disponible. Consulta la llista abans d’una altra operació.',
  'panel.aviso.instituciones_confirmadas': 'Llista confirmada pel servidor.',
  'panel.accesos.titulo': 'Accessos',
  'panel.accesos.intro':
    'Consulta els registres conservats dels tres serveis. La paginació reuneix fins a 50 files entre tots els canals. Els recomptes diaris poden incloure diverses consultes en una sola fila.',
  'panel.accesos.privacidad':
    'El registre no conté el contingut ni els arguments de les consultes. El nom de client MCP és una declaració del client, sense verificar-ne la identitat.',
  'panel.accesos.consultar': 'Consultar els accessos des de la primera pàgina',
  'panel.accesos.consultar-primero': 'Consulta els accessos per obtenir una pàgina confirmada del registre.',
  'panel.accesos.lectura':
    'Última pàgina confirmada. Aquesta lectura no canvia els controls ni renova l’activitat de la sessió.',
  'panel.accesos.resumen': 'Pàgina {pagina} · Registres en aquesta pàgina: {cantidad}. Conservats en total: {total}.',
  'panel.accesos.anterior': 'Més recents',
  'panel.accesos.siguiente': 'Més antics',
  'panel.accesos.api': 'Institucions · API',
  'panel.accesos.mcp': 'Assistents d’IA · MCP',
  'panel.accesos.a2a': 'Agents d’IA · A2A',
  'panel.accesos.fecha': 'Data i hora',
  'panel.accesos.dia': 'Dia (UTC)',
  'panel.accesos.institucion': 'Institució',
  'panel.accesos.consulta': 'Consulta',
  'panel.accesos.resultado': 'Resultat HTTP',
  'panel.accesos.herramienta': 'Eina',
  'panel.accesos.cliente': 'Client declarat (sense verificar)',
  'panel.accesos.consultas': 'Consultes del dia',
  'panel.accesos.habilidad': 'Habilitat',
  'panel.accesos.cliente.no_declarado': 'Nom no declarat',
  'panel.accesos.cliente.omitido': 'Nom no conservat',
  'panel.accesos.cliente.otros': 'Altres clients agrupats',
  'panel.accesos.sin-canal': 'Sense registres d’aquest canal en aquesta pàgina.',
  'panel.aviso.accesos_no_disponibles':
    'No s’han pogut consultar els accessos. No es pot deduir que el registre estigui buit. Torna’l a consultar.',
  'panel.ocultas.titulo': 'Ofertes retingudes del catàleg',
  'panel.ocultas.intro':
    'Decisions conservades del registre admès. No confirma que una retirada s’hagi publicat. Aquesta consulta no torna a avaluar cursos ni consulta els seus proveïdors.',
  'panel.ocultas.consultar': 'Consultar des de la primera pàgina',
  'panel.ocultas.filtro': 'Tipus d’unitat',
  'panel.ocultas.todos': 'Tots',
  'panel.ocultas.recurso': 'Recurs',
  'panel.ocultas.edicion': 'Edició',
  'panel.ocultas.anterior': 'Pàgina anterior',
  'panel.ocultas.siguiente': 'Pàgina següent',
  'panel.ocultas.sin-registro': 'Sense registre disponible. No es pot deduir que no hi hagi ofertes retingudes.',
  'panel.ocultas.observada':
    'Decisions al tall conservat; publicació efectiva i estat a l’hora present sense confirmar.',
  'panel.ocultas.resumen':
    'Tall de les decisions: {v2}. {v0} unitats retingudes · pàgina {v1} · tancament del rebut: {v3}',
  'panel.ocultas.vacia': 'Aquest registre acreditat no conté unitats retingudes per al filtre triat.',
  'panel.ocultas.unidad': 'Unitat',
  'panel.ocultas.codigo': 'Codi de la causa',
  'panel.ocultas.decision': 'Decisió conservada',
  'panel.ocultas.comprobado': 'Darrera comprovació vàlida de la unitat',
  'panel.ocultas.cierra': 'Data límit publicada per la font',
  'panel.ocultas.revisar': 'Propera revisió interna de Faro',
  'panel.ocultas.intento-fallido': 'Darrera consulta sense resposta vàlida',
  'panel.ocultas.aviso.revision':
    'Revisió pendent: va vèncer {v0}. És un avís intern: no canvia l’oferta ni el que veu la persona.',
  'panel.ocultas.aviso.fallo':
    'La darrera consulta va fallar {v0}. Es conserven la darrera comprovació vàlida i el que veu la persona.',
  'panel.ocultas.causa.limite_publicado_alcanzado': 'S’ha arribat a una data límit publicada per la font',
  'panel.ocultas.causa.enlace_de_ficha_no_encontrado':
    'L’adreça exacta de la fitxa va respondre que no existeix; no consta un tancament del curs',
  'panel.ocultas.intento': 'Darrer intent conservat de la unitat',
  'panel.ocultas.fin': 'Final d’aquest intent',
  'panel.ocultas.fuente-intento':
    'Darrer intent del mòdul de la font (pot ser local; no acredita consulta d’aquesta unitat)',
  'panel.ocultas.evidencias': 'Causa i referències conservades',
  'panel.ocultas.causas': 'Motius de l’avaluador',
  'panel.ocultas.evaluado': 'Tall de l’avaluació',
  'panel.ocultas.firma': 'Signatura de l’avaluador',
  'panel.ocultas.parametros': 'Paràmetres i fragment omesos',
  'panel.ocultas.sin-evidencias': 'No hi ha referències presentables conservades per a aquesta unitat.',
  'panel.ocultas.decision.disponible-publicamente': 'Disponible segons la decisió conservada',
  'panel.ocultas.decision.no-disponible-publicamente': 'No disponible segons la decisió conservada',
  'panel.ocultas.decision.apertura-futura': 'Obertura futura',
  'panel.ocultas.decision.sin-confirmar': 'Sense confirmar',
  'panel.ocultas.decision.comprobacion-caducada': 'Comprovació caducada',
  'panel.ocultas.motivo.otro': 'El registre conserva una causa que requereix revisió. No acredita una oferta pública.',
  'panel.ocultas.motivo.sin_evaluacion': 'La unitat no té una avaluació conservada.',
  'panel.ocultas.motivo.evaluador_modificado_requiere_evaluacion':
    'La signatura de l’avaluador ha canviat; l’avaluació anterior no acredita el contracte actual.',
  'panel.ocultas.motivo.edicion_modificada_requiere_evaluacion':
    'L’edició ha canviat i requereix una avaluació del contingut nou.',
  'panel.ocultas.motivo.recurso_modificado_requiere_evaluacion':
    'El recurs ha canviat i requereix una avaluació del contingut nou.',
  'panel.ocultas.motivo.decision_registrada_no_acredita_oferta':
    'La decisió conservada no acredita disponibilitat pública.',
  'panel.ocultas.motivo.confirmacion_vencida_en_corte': 'La comprovació ja havia vençut al tall conservat.',
  'panel.ocultas.publicadas.revision':
    'Cursos publicats amb la revisió interna pendent: {v0} (la més antiga va vèncer {v1}). Continuen publicats: és un avís intern.',
  'panel.ocultas.publicadas.enlace':
    'Cursos publicats l’adreça dels quals va donar un error a la darrera revisió: {v0}. Continuen publicats amb el seu enllaç.',
  'panel.ocultas.incidencia-enlace': 'Error de l’adreça a la darrera revisió',
  'panel.ocultas.incidencia-enlace.ficha': 'Error de l’adreça de la fitxa a la darrera revisió',
  'panel.ocultas.incidencia-enlace.catalogo': 'Error de l’adreça del catàleg de la font a la darrera revisió',
  'panel.ocultas.publicadas.fallo':
    'Cursos publicats la darrera consulta dels quals ha fallat: {v0}. Continuen publicats amb la darrera comprovació vàlida.',
  'panel.ocultas.motivo.resultado_de_evaluacion_anterior':
    'L’avaluació conservada té el format anterior i està pendent de reavaluar-se amb la regla actual.',
  'panel.ocultas.motivo.limite_publicado_alcanzado_en_corte':
    'Al tall conservat ja s’havia arribat a la data límit publicada per la font.',
  'panel.ocultas.motivo.acceso_o_calendario_indispensable_sin_soporte':
    'Falta evidència indispensable d’accés o calendari.',
  'panel.ocultas.motivo.confirmacion_sin_fechas_o_url_indispensables':
    'Falten dates o adreça indispensables per publicar.',
  'panel.ocultas.motivo.confirmacion_posterior_o_fechas_incoherentes':
    'Les dates conservades no permeten confirmar l’oferta en aquest tall.',
  'panel.ocultas.motivo.entradas_evaluadas_incompatibles_con_contrato':
    'Les entrades de l’avaluació no compleixen el contracte actual.',
  'panel.ocultas.motivo.catalogo_obligatorio_sin_comprobacion_acreditada':
    'Falta la comprovació obligatòria del catàleg del proveïdor.',
  'panel.ocultas.motivo.politica_continua_no_registrada': 'La regla d’oferta contínua no està registrada.',
  'panel.ocultas.motivo.confirmacion_sin_fecha_acreditada': 'La confirmació no té una data acreditada.',
  'panel.aviso.ocultas_no_disponibles':
    'No s’ha pogut renovar la consulta. Es conserva la darrera observació coneguda mentre aquesta sessió continuï autoritzada.',
  'panel.ocultas.error': 'La consulta ha fallat i no hi ha cap observació anterior disponible.',
  'panel.datos.ultima-comprobacion-parte': 'Última comprovació registrada, part {v0} de {v1}',
  'panel.datos.proxima': 'Pròxima consulta prevista',
  'panel.datos.proxima-parte': 'Pròxima consulta prevista, part {v0} de {v1}',
};
