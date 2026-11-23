// Textos de l’enquesta del pilot (encuesta.html i scripts/encuesta.js) en català. S’incorporen al diccionari de ca.js.

/**
 * Diccionari de només lectura (clau -> text) en català amb els textos de l’enquesta.
 * @type {Readonly<Record<string, string>>}
 */
export const TEXTOS_ENCUESTA = {
  'encuesta.titulo': 'Enquesta · Faro',
  'encuesta.descripcion': 'Explica’ns amb unes poques respostes tancades què t’ha semblat Faro. L’enquesta és anònima.',
  'encuesta.rotulo': 'Enquesta',
  'encuesta.titulo-principal': 'La teva opinió sobre Faro',
  'encuesta.entradilla':
    'Aquesta enquesta ens ajuda a saber si Faro t’ha estat útil i què hem de millorar. Són cinc preguntes tancades i es responen en menys de dos minuts. És anònima: no et demanem el nom ni cap dada sobre tu, i Faro només guarda quantes vegades s’ha triat cada resposta. Respondre és voluntari: pots deixar-la quan vulguis sense enviar res. Pots llegir {0}.',
  'encuesta.entradilla-profesional':
    'Aquesta enquesta recull la teva valoració com a professional d’orientació després de fer servir Faro a les teves sessions. Són cinc preguntes tancades i es responen en uns dos minuts. És anònima i voluntària: no et demanem el nom ni el de la teva entitat, i Faro només guarda quantes vegades s’ha triat cada resposta.',
  'encuesta.entradilla.enlace': 'com es protegeixen les teves respostes',
  'encuesta.codigo.titulo': 'El teu codi',
  'encuesta.codigo.ayuda':
    'Enganxa o escriu el codi de la teva invitació. Si obres aquesta pàgina amb el teu enllaç d’invitació, el codi ja hi és posat.',
  'encuesta.codigo.etiqueta': 'Codi de la invitació',
  'encuesta.codigo.formato': 'Comença per PART o PROF i continua amb set grups de quatre lletres o xifres.',
  'encuesta.codigo.continuar': 'Continuar',
  'encuesta.codigo.cambiar': 'Utilitzar un altre codi',
  'encuesta.escala.1': 'Gens',
  'encuesta.escala.2': 'Poc',
  'encuesta.escala.3': 'Una mica',
  'encuesta.escala.4': 'Força',
  'encuesta.escala.5': 'Molt',
  'encuesta.participante.titulo': 'Les teves respostes',
  'encuesta.participante.informe': 'Has pogut veure el teu informe de Faro?',
  'encuesta.participante.informe.visto': 'Sí, he vist el meu informe',
  'encuesta.participante.informe.sin-ver': 'No he pogut arribar a veure’l',
  'encuesta.participante.ocupacion': 'L’ocupació que apareix al teu informe es correspon amb la teva feina?',
  'encuesta.participante.ocupacion.si': 'Sí',
  'encuesta.participante.ocupacion.en-parte': 'En part',
  'encuesta.participante.ocupacion.no': 'No',
  'encuesta.participante.comprension':
    'Fins a quin punt t’ha ajudat el teu informe a entendre com pot canviar la IA les tasques de la teva feina?',
  'encuesta.participante.formacion': 'Fins a quin punt t’ha ajudat Faro a decidir quina formació buscar?',
  'encuesta.participante.formacion.sin-ver': 'No he arribat a veure la proposta de formació',
  'encuesta.participante.dificultad': 'Quina part t’ha costat més?',
  'encuesta.participante.dificultad.describir-trabajo': 'Descriure la meva feina',
  'encuesta.participante.dificultad.elegir-tareas': 'Triar les meves tasques',
  'encuesta.participante.dificultad.entender-informe': 'Entendre l’informe',
  'encuesta.participante.dificultad.encontrar-formacion': 'Trobar formació que m’encaixi',
  'encuesta.participante.dificultad.nada': 'Res en especial',
  'encuesta.profesional.titulo': 'La teva valoració com a professional',
  'encuesta.profesional.ayuda-orientacion':
    'Fins a quin punt t’ha ajudat Faro en la teva feina d’orientació amb les persones que has atès?',
  'encuesta.profesional.explicar-cambio':
    'Fins a quin punt t’ha ajudat Faro a explicar com pot canviar la IA les tasques de cada persona?',
  'encuesta.profesional.encaje-formacion':
    'Fins a quin punt encaixa la formació que proposa Faro amb el que necessitaven aquestes persones?',
  'encuesta.profesional.fiabilidad': 'Fins a quin punt et sembla fiable la informació que mostra Faro?',
  'encuesta.profesional.mejora': 'Què milloraries primer per fer servir Faro a les teves sessions?',
  'encuesta.profesional.mejora.explicacion-informe': 'L’explicació de l’informe',
  'encuesta.profesional.mejora.ocupacion': 'L’ocupació que proposa',
  'encuesta.profesional.mejora.datos-fuentes': 'Les dades i les seves fonts',
  'encuesta.profesional.mejora.formacion': 'La proposta de formació',
  'encuesta.profesional.mejora.uso-sesion': 'L’ús durant la sessió',
  'encuesta.profesional.mejora.accesibilidad': 'L’accessibilitat',
  'encuesta.profesional.mejora.nada': 'Res en especial',
  'encuesta.enviar': 'Enviar les meves respostes',
  'encuesta.estado.enviando': 'S’estan enviant les teves respostes…',
  'encuesta.estado.codigo-formato':
    'Aquest codi no té la forma dels codis de l’enquesta. Revisa que l’has copiat sencer, tal com apareix a la teva invitació.',
  'encuesta.estado.codigo-no-valido':
    'Aquest codi no serveix: potser està mal escrit, ja s’ha utilitzat o l’enquesta ja s’ha acabat. Revisa que l’has escrit tal com apareix a la teva invitació; si el teu enllaç ja s’ha fet servir, demana’n un altre a qui te l’ha enviat.',
  'encuesta.estado.faltan': 'Falta alguna resposta. Tria una opció a cada pregunta i torna a enviar.',
  'encuesta.estado.muchos': 'Ara mateix arriben moltes respostes alhora. Espera un minut i torna a enviar les teves.',
  'encuesta.estado.sin-conexion':
    'No s’han pogut enviar les teves respostes. Comprova la connexió i torna-ho a provar: continuen marcades.',
  'encuesta.estado.no-disponible':
    'Ara mateix Faro no pot rebre respostes. Torna-ho a provar d’aquí a uns minuts: continuen marcades.',
  'encuesta.gracias.titulo': 'Gràcies pel teu temps',
  'encuesta.gracias.texto':
    'Les teves respostes s’han sumat a les de la resta; Faro no guarda què ha respost cada persona. El teu codi ja no serveix i pots tancar aquesta pàgina.',
};
