import { TEXTOS_PILOTO } from './panel-piloto.js';
// Textos del apartado Servicio, de las revisiones manuales, de la confirmación de cambios y de las fechas del panel.
/** @type {Readonly<Record<string,string>>} */
export const TEXTOS_SERVICIO = {
  ...TEXTOS_PILOTO,
  'panel.fecha.a-las': 'a les {hora}',
  'panel.fecha.a-la': 'a la {hora}',
  'panel.fecha.hoy': 'avui {hora}',
  'panel.fecha.ayer': 'ahir {hora}',
  'panel.fecha.manana': 'demà {hora}',
  'panel.fecha.pasado': 'fa {dias} dies, {fecha} {hora}',
  'panel.fecha.futuro': 'd’aquí a {dias} dies, {fecha} {hora}',
  'panel.dia.hoy': 'avui',
  'panel.dia.ayer': 'ahir',
  'panel.dia.manana': 'demà',
  'panel.dia.pasado': 'fa {dias} dies, {fecha}',
  'panel.dia.futuro': 'd’aquí a {dias} dies, {fecha}',
  'panel.fecha.utc': 'registre en UTC: {fecha}',
  'panel.servicio.titulo': 'Estat de les dades',
  'panel.servicio.intro':
    'Una fila per tema i una altra per a les dades noves. Cada estat surt de l’última lectura del servidor; si alguna cosa no s’ha pogut llegir, la veuràs com a «sense comprovar».',
  'panel.servicio.sin-comprobar': 'Sense comprovar',
  'panel.servicio.sin-intento': 'No consta cap intent',
  'panel.servicio.sin-resultado': 'resultat no conservat',
  'panel.servicio.intento': '{fecha} · {resultado}',
  'panel.servicio.ultimo-intento': 'Últim intent',
  'panel.servicio.ultima-valida': 'Última comprovació vàlida',
  'panel.servicio.que-hacer': 'Què cal fer: {accion}',
  'panel.servicio.accion.ninguna': 'No cal fer res.',
  'panel.servicio.accion.actualizar': 'Prem Actualitzar dades, a Actualitzacions.',
  'panel.servicio.accion.equipo': 'Avisa l’equip tècnic.',
  'panel.servicio.accion.esperar': 'Espera que acabi; pots veure com va a Actualitzacions.',
  'panel.servicio.accion.consultar': 'Torna a obrir el tauler o consulta la lectura al seu apartat.',
  'panel.servicio.causa.atencion':
    'L’última preparació de dades de {fuentes} necessita revisió. Faro no canvia les dades publicades per aquesta fallada.',
  'panel.servicio.causa.incidencia':
    'L’última consulta a {fuentes} no va acabar bé. Faro no canvia les dades publicades per aquesta fallada.',
  'panel.servicio.causa.pendiente':
    'Ja toca tornar a consultar {fuentes}. Mentrestant, Faro no canvia les dades publicades.',
  'panel.servicio.causa.sin-observacion': 'No consta cap comprovació de {fuentes}.',
  'panel.servicio.causa.revision': 'Toca revisar a mà {fuentes}.',
  'panel.servicio.causa.local': 'Les dades de {fuentes} es comproven dins de Faro, sense consultar la font oficial.',
  'panel.servicio.causa.comprobada': 'Les fonts d’aquest tema es van consultar bé en l’última comprovació.',
  'panel.servicio.causa.candidata': 'Encara no es fan servir en les actualitzacions: {fuentes}.',
  'panel.servicio.causa.externa': 'Les dades de {fuentes} les revisa una altra entitat.',
  'panel.servicio.causa.productor-local': 'Les dades de {fuentes} les calcula Faro a partir d’altres fonts.',
  'panel.servicio.fuentes.titulo': 'Fonts',
  'panel.servicio.fuentes.sin-lectura':
    'No s’ha pogut llegir l’estat de les fonts, així que no es pot dir si estan al dia.',
  'panel.servicio.publicacion.titulo': 'Dades noves i publicació',
  'panel.servicio.publicacion.etiqueta': 'Última publicació registrada',
  'panel.servicio.publicacion.ninguna': 'Encara no en consta cap',
  'panel.servicio.publicacion.registrada': '{fase} · {fecha}',
  'panel.servicio.nuevos.etiqueta': 'Dades noves',
  'panel.servicio.nuevos.sin-lectura':
    'No s’ha pogut llegir l’última actualització, així que no se sap si hi ha dades noves.',
  'panel.servicio.nuevos.ninguno': 'Encara no s’ha demanat cap actualització, així que no hi ha dades noves pendents.',
  'panel.servicio.nuevos.en-curso': 'Hi ha una actualització demanada {fecha}, i encara no ha acabat.',
  'panel.servicio.nuevos.sin-cambios':
    'L’última actualització va acabar {fecha} sense res pendent i no va preparar dades noves.',
  'panel.servicio.nuevos.sin-datos':
    'L’última actualització va acabar {fecha} sense preparar dades noves. Faro no canvia les dades publicades per aquesta fallada.',
  'panel.servicio.nuevos.preparados-sin-comprobar':
    'Hi ha dades noves preparades {fecha}, però no s’ha pogut llegir si ja estan publicades.',
  'panel.servicio.nuevos.pendientes': 'Dades noves preparades {fecha}, encara no publicades.',
  'panel.servicio.nuevos.publicados':
    'Segons el registre del servidor, les dades preparades {fecha} es van publicar {publicados}.',
  'panel.servicio.nuevos.rechazados':
    'Les dades preparades {fecha} no s’han pogut publicar. Faro no canvia les dades publicades per aquesta fallada.',
  'panel.servicio.nuevos.publicandose': 'Les dades preparades {fecha} s’estan publicant.',
  'panel.servicio.servida.etiqueta': 'Versió que veuen les persones',
  'panel.servicio.servida.sin-comprobar': 'Sense comprovar: el servidor encara no ofereix aquesta lectura.',
  'panel.servicio.indicador.al-dia': 'Res pendent',
  'panel.servicio.indicador.pendiente': 'Encara sense publicar',
  'panel.servicio.indicador.en-curso': 'Sense acabar',
  'panel.servicio.indicador.atencion': 'Necessita atenció',
  'panel.servicio.indicador.sin-comprobar': 'Sense comprovar',
  'panel.revisiones.titulo': 'Revisions que toquen',
  'panel.revisiones.intro':
    'Revisions que es fan a mà i que el servidor ja té calculades. Són un recordatori: no canvien el que veuen les persones.',
  'panel.revisiones.sin-comprobar': 'Sense comprovar: no s’ha pogut llegir l’estat de les dades.',
  'panel.revisiones.ninguna': 'No consta cap revisió manual pendent en aquesta lectura.',
  'panel.revisiones.estado.vencida': 'Toca ja',
  'panel.revisiones.estado.prevista': 'Prevista',
  'panel.revisiones.estado.manual': 'Revisió manual',
  'panel.revisiones.fichas-vencida': 'La revisió de les fitxes està pendent: va vèncer {dia}.',
  'panel.revisiones.fichas-prevista': 'La revisió de les fitxes toca {dia}.',
  'panel.revisiones.manual': 'Última comprovació registrada {fecha}.',
  'panel.revisiones.manual-sin-registro': 'No consta cap comprovació anterior.',
  'panel.revisiones.fuente-sin-nombre': 'Dades d’una altra entitat',
  'panel.confirmar.intro': 'Desaràs aquests canvis:',
  'panel.confirmar.pregunta': 'Vols desar-los?',
  'panel.confirmar.seccion.cerrar':
    'Tancar «{nombre}»: les persones deixaran de veure aquesta pàgina i els seus enllaços.{efecto}',
  'panel.confirmar.seccion.abrir':
    'Obrir «{nombre}»: les persones tornaran a veure aquesta pàgina i els seus enllaços.{efecto}',
  'panel.confirmar.recorrido.cerrar': 'Ningú no podrà començar el recorregut ni veure l’informe d’exemple.',
  'panel.confirmar.recorrido.abrir': 'Les persones podran començar el recorregut i veure l’informe d’exemple.',
  'panel.confirmar.encuesta.cerrar':
    'El recorregut deixarà d’oferir-la, però les invitacions no es perden: quan la tornis a mostrar, els mateixos enllaços serviran.',
  'panel.confirmar.encuesta.abrir': 'Les persones amb una invitació la podran tornar a respondre amb el mateix enllaç.',
  'panel.confirmar.sin-conexion': 'Qui faci servir Faro sense connexió veurà el canvi quan torni a connectar-se.',
  'panel.confirmar.api.apagar':
    'Apagar l’API per a aplicacions: les institucions deixaran de poder consultar Faro des dels seus sistemes. Les seves claus es conserven.',
  'panel.confirmar.api.encender':
    'Encendre l’API per a aplicacions: les institucions amb clau podran consultar Faro des dels seus sistemes.',
  'panel.confirmar.mcp.apagar': 'Apagar la connexió per a assistents d’IA: deixaran de poder consultar Faro.',
  'panel.confirmar.mcp.encender':
    'Encendre la connexió per a assistents d’IA: podran consultar les dades públiques de Faro.',
  'panel.confirmar.a2a.apagar': 'Apagar la connexió per a agents d’IA: deixaran de poder consultar Faro.',
  'panel.confirmar.a2a.encender':
    'Encendre la connexió per a agents d’IA: podran consultar les dades públiques de Faro.',
  'panel.confirmar.web-sigue': 'El web continua funcionant igual per a les persones.',
  'panel.fecha.registro-dia': 'dia registrat: {fecha}',
  'panel.servicio.nuevos.retirado': 'L’actualització es va retirar {fecha} i no va preparar dades noves.',
  'panel.servicio.nuevos.solo-ultima':
    'Només es coneix l’última actualització. Si una actualització anterior va preparar dades, aquí no es pot saber si es van publicar.',
  'panel.servicio.accion.revisar-publicacion':
    'Si esperaves dades d’una actualització anterior, consulta «Publicació de les dades» o avisa l’equip tècnic.',
  'panel.servicio.indicador.solo-ultima': 'Sense comprovar del tot',
  'panel.servicio.sin-conexion': 'Sense connexió no es pot llegir l’estat de les dades.',
  'panel.servicio.ver-detalle': 'Veure el detall de cada font de {tema}',
};
