// Textos del registro de la última publicación de datos en el panel: fase, error, fechas y límite de la consulta.
/** @type {Readonly<Record<string,string>>} */
export const TEXTOS_PANEL_ACTIVACION = {
  'panel.activacion.consulta-inicial': 'Consulta l’última publicació per veure què ha anotat el servidor.',
  'panel.activacion.sin-registro': 'Encara no consta cap publicació de dades.',
  'panel.activacion.fase.reservada': 'Publicació sol·licitada; encara no consta com a acabada.',
  'panel.activacion.fase.preparada': 'Publicació preparada; encara no consta com a acabada.',
  'panel.activacion.fase.subiendo-cursos': 'S’està pujant la formació; la publicació encara no consta com a acabada.',
  'panel.activacion.fase.cursos-subida': 'Formació pujada; la publicació encara no consta com a acabada.',
  'panel.activacion.fase.promoviendo-cursos':
    'S’està publicant la formació nova; mentrestant, la formació pot figurar com a no disponible.',
  'panel.activacion.fase.cursos-confirmado':
    'La formació nova ja està publicada, però no es mostrarà fins que s’acabi de publicar la resta del web; mentrestant figura com a no disponible.',
  'panel.activacion.fase-dos-servicios.subiendo':
    'S’està pujant la resta del web; fins que s’acabi, la formació figura com a no disponible.',
  'panel.activacion.fase-dos-servicios.subida':
    'La resta del web ja està pujada, però encara no s’ha publicat; fins que s’acabi, la formació figura com a no disponible.',
  'panel.activacion.fase-dos-servicios.promoviendo':
    'S’està publicant la resta del web; fins que s’acabi, la formació figura com a no disponible.',
  'panel.activacion.fase.subiendo': 'S’estan pujant les dades; la publicació encara no consta com a acabada.',
  'panel.activacion.fase.subida': 'Dades pujades; la publicació encara no consta com a acabada.',
  'panel.activacion.fase.promoviendo': 'Publicació en curs; encara no consta com a acabada.',
  'panel.activacion.fase.confirmada': 'Publicació acabada segons el registre del servidor.',
  'panel.activacion.fase.rechazada': 'La publicació no s’ha completat segons el registre del servidor.',
  'panel.activacion.fase.abandonada':
    'La publicació s’ha tancat sense acabar i se segueix servint la versió anterior del web.',
  'panel.activacion.abandono.a-mano':
    'S’ha tancat a mà i se segueix servint la versió anterior. Faro no ho tornarà a intentar sol: per publicar aquestes dades, fes-ho a mà seguint la guia d’actualització remota.',
  'panel.activacion.abandono.rechazo-previo':
    'S’ha tancat sola perquè alguna cosa va canviar a l’allotjament del web abans de publicar, i el web no es va arribar a modificar. Faro ho tornarà a intentar sol en la propera actualització.',
  'panel.activacion.abandono.rechazo-previo-sin-reintento':
    'S’ha tancat sola perquè alguna cosa va canviar a l’allotjament del web abans de publicar, i el web no es va arribar a modificar. Faro no ho tornarà a intentar sol: per publicar aquestes dades, fes-ho a mà seguint la guia d’actualització remota.',
  'panel.activacion.abandono.rechazo-previo-reintento':
    'El segon intent també s’ha tancat perquè alguna cosa va canviar a l’allotjament del web abans de publicar, i el web no es va arribar a modificar. Faro no ho tornarà a intentar sol: per publicar aquestes dades, fes-ho a mà seguint la guia d’actualització remota.',
  'panel.activacion.abandono.rechazo-proveedor':
    'S’ha tancat sola perquè l’allotjament del web va rebutjar la publicació, i el web no es va arribar a modificar. Faro no ho tornarà a intentar sol: per publicar aquestes dades, fes-ho a mà seguint la guia d’actualització remota.',
  'panel.activacion.reintento':
    'És el segon intent de publicar unes dades que no es van poder publicar la primera vegada.',
  'panel.activacion.sin-publicar-reintento':
    'Hi ha dades validades sense publicar des de {v0}; Faro està tornant a intentar publicar-les.',
  'panel.activacion.abandono.rechazo-previo-sin-artefacto':
    'Faro no ho ha pogut tornar a intentar perquè el paquet ja no es conserva. Per publicar aquestes dades, fes-ho a mà seguint la guia d’actualització remota.',
  'panel.activacion.sin-publicar':
    'Hi ha dades validades sense publicar des de {v0}. Mentrestant, el web continua mostrant les anteriors.',
  'panel.activacion.detenida.rechazo-previo':
    'La publicació s’ha aturat perquè alguna cosa va canviar a l’allotjament del web abans de publicar, i no es va arribar a fer aquest pas.',
  'panel.activacion.detenida.rechazo-proveedor':
    'La publicació s’ha aturat perquè l’allotjament del web va rebutjar aquest pas, i no es va arribar a fer.',
  'panel.activacion.detenida.cambiado':
    'El que serveix el web ha canviat fora d’aquesta publicació. Comprova quina versió serveix cada part seguint la guia d’actualització remota abans d’acabar-la o tancar-la.',
  'panel.activacion.detenida.desconocido':
    'No s’ha pogut comprovar què serveix el web. Comprova-ho seguint la guia d’actualització remota abans d’acabar-la o tancar-la.',
  'panel.activacion.detenida.sin-formacion':
    'La formació nova ja està publicada i figura com a no disponible fins que s’acabi; la resta del web continua en la versió anterior. Per acabar-la o tornar enrere, segueix la guia d’actualització remota.',
  'panel.activacion.error.candidato_no_verificable': 'No s’han pogut comprovar les dades que s’havien de publicar.',
  'panel.activacion.error.despliegue_no_admitido': 'L’allotjament del web no ha acceptat la publicació.',
  'panel.activacion.error.servido_distinto':
    'No s’ha tornat a intentar perquè el web ha canviat des que es va tancar la publicació, i així no es desfà el que s’hagi publicat entremig. Per publicar aquestes dades, fes-ho a mà seguint la guia d’actualització remota.',
  'panel.activacion.cierre.boton': 'Tanca aquesta publicació',
  'panel.activacion.cierre.confirmar':
    'Faro tancarà aquesta publicació sense acabar-la, i només si el web continua servint la versió anterior. Per fer-ho, Faro posarà en marxa una actualització; si troba dades noves, les publicarà després. Vols tancar-la?',
  'panel.activacion.cierre.en-curso':
    'Has demanat tancar aquesta publicació. Faro ho farà quan acabi l’actualització que acaba de posar en marxa; en veuràs aquí el resultat.',
  'panel.activacion.cierre.no-cumplido':
    'El tancament que vas demanar no s’ha arribat a fer. Pots tornar-ho a demanar.',
  'panel.activacion.cierre.sin-constancia':
    'L’actualització que havia de tancar aquesta publicació ha acabat, però el tancament encara no consta. Si d’aquí a uns minuts continua igual, torna-ho a demanar.',
  'panel.activacion.cierre.web-cambiada':
    'No s’ha tancat perquè el web ja no serveix la versió anterior. Comprova quina versió serveix cada part seguint la guia d’actualització remota i torna-ho a demanar.',
  'panel.activacion.cierre.ejecucion-en-curso':
    'Encara no es pot tancar perquè la publicació continua en marxa. Espera que acabi i torna-ho a intentar.',
  'panel.activacion.cierre.sin-confirmacion':
    'No s’ha pogut comprovar si la publicació ha acabat. Torna-ho a intentar d’aquí a uns minuts.',
  'panel.activacion.cierre.no-despachado':
    'No s’ha pogut posar en marxa el tancament. Torna-ho a intentar d’aquí a uns minuts.',
  'panel.activacion.cierre.conflicto':
    'No s’ha pogut demanar el tancament perquè la publicació o una actualització han canviat mentre ho demanaves. Revisa’n l’estat i torna-ho a intentar si cal.',
  'panel.activacion.limite':
    'Aquest registre no comprova quina versió veuen ara les persones ni que totes les fonts estiguin al dia.',
  'panel.activacion.fechas': 'Registrada {v0}. Últim canvi {v1}.',
  'panel.activacion.version': 'Versió registrada: {v0}.',
  'panel.activacion.despliegue': 'Desplegament registrat: {v0}.',
};
