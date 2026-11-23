// Textos del recorrido, la conversación y la hoja de ruta en catalán. Se incorporan al diccionario de ca.js.

import { ERRORES_RECORRIDO } from './errores-recorrido.js';

/**
 * Diccionario de solo lectura (clave -> texto) en catalán con los textos del recorrido, la conversación y la hoja de ruta.
 * @type {Readonly<Record<string, string>>}
 */
export const TEXTOS_RECORRIDO = {
  // ---------- El recorrido (recorrido.html y scripts/recorrido/) ----------
  'recorrido.abre-en-otra-pestana': 'S’obre en una altra pestanya: la teva conversa continua en aquesta.',
  'recorrido.autor.faro': 'Faro',
  'recorrido.autor.persona': 'Tu',
  'recorrido.aviso-del-motor.datos-personales':
    'Faro ha tret del text processat les dades personals que ha reconegut. Evita incloure dades personals.',
  'recorrido.aviso-del-motor.fuera-de-tema':
    'Només et puc ajudar amb la descripció de la teva feina. Explica’m quines tasques fas.',
  'recorrido.ayuda.024':
    "Si estàs passant per un moment difícil, truca al {0}, el telèfon d'atenció a la conducta suïcida: és gratuït, confidencial i està disponible les 24 hores del dia, els 365 dies de l'any. En cas d'emergència vital imminent, truca al {1}.",
  'recorrido.ayudas.boton': '{0}Ajuda',
  'recorrido.ayudas.cerrar': 'Tancar l’ajuda',
  'recorrido.ayudas.nota': 'S’afegeix al que ja has escrit. Tu decideixes quan l’envies.',
  'recorrido.ayudas.relato.1': 'Treballo de…',
  'recorrido.ayudas.relato.2': 'M’ocupo de…',
  'recorrido.ayudas.relato.3': 'En un dia normal…',
  'recorrido.ayudas.relato.4': 'El que em porta més temps és…',
  'recorrido.ayudas.relato.descripcion': 'Tria un inici i acaba’l amb les teves paraules.',
  'recorrido.ayudas.tareas.1': 'M’encarrego de…',
  'recorrido.ayudas.tareas.2': 'Cada dia…',
  'recorrido.ayudas.tareas.3': 'Cada setmana…',
  'recorrido.ayudas.tareas.4': 'De vegades també…',
  'recorrido.ayudas.tareas.descripcion': 'Una tasca s’entén millor si diu què fas. Tria un inici i acaba’l.',
  'recorrido.ayudas.titulo': 'Ajuda per començar',
  'recorrido.compositor.ampliar': 'Ampliar',
  'recorrido.compositor.aviso-ia': 'Faro és una IA i es pot equivocar.',
  'recorrido.compositor.traduccion': 'Títols i tasques traduïts amb IA',
  'recorrido.compositor.contador': '{escritas} de {limite} caràcters',
  'recorrido.compositor.enter': 'Enter per enviar',
  'recorrido.compositor.enter-ampliado': '{tecla} + Enter per enviar',
  'recorrido.compositor.enviar': 'Enviar a Faro',
  'recorrido.compositor.etiqueta': 'El teu missatge per a Faro',
  'recorrido.compositor.maximo': 'El teu text ja té el màxim de {maximo} caràcters.',
  'recorrido.compositor.ocupacion.etiqueta': 'A què et dediques',
  'recorrido.compositor.reducir': 'Reduir',
  'recorrido.compositor.respuesta.marcador': 'Escriu aquí la teva resposta…',
  'recorrido.compositor.sin-nombres': 'No cal que hi posis el teu nom, el de la teva empresa, companys o clients.',
  'recorrido.compositor.tarea.marcador': 'Fas alguna cosa més? Escriu-ho aquí…',
  'recorrido.compositor.teclas':
    ' Enter envia i Majúscules més Enter fa un salt de línia; amb l’escriptura ampliada, Enter fa un salt de línia i Control o Ordre més Enter envia. ',
  'recorrido.confirmar.alternativas': 'O és algun d’aquests?',
  'recorrido.confirmar.con-subgrupo':
    'L’OIT no publica tasques d’aquest tipus de feina. Pots descriure les teves i triar una referència oficial si correspon; sense referència acreditada quedaran sense nota.',
  'recorrido.confirmar.filtro': 'Cerca la teva ocupació en aquesta llista',
  'recorrido.confirmar.leyenda': 'Ocupacions d’aquest tipus de feina',
  'recorrido.confirmar.ninguna-pero-tipo': 'Cap d’aquestes, però és aquest tipus de feina',
  'recorrido.confirmar.queda-una': 'Queda una ocupació.',
  'recorrido.confirmar.quedan': 'Queden {numero} ocupacions.',
  'recorrido.confirmar.si-es-este': 'Sí, és aquest tipus de feina',
  'recorrido.confirmar.sin-referencias':
    'No hi ha tasques oficials de referència per a aquest tipus de feina: les que descriguis es conservaran sense nota, com a informació insuficient.',
  'recorrido.confirmar.sin-resultados':
    'Cap ocupació d’aquest grup no conté «{palabra}». Prova amb una altra paraula o tria «Cap d’aquestes, però és aquest tipus de feina».',
  'recorrido.confirmar.sin-tareas':
    'L’OIT no publica tasques d’aquest tipus de feina: continuarem amb les tasques que m’expliquis.',
  'recorrido.confirmar.tambien': 'També tindré en compte: {titulo}.',
  'recorrido.continuar': 'Continuar',
  'recorrido.conversacion.aviso':
    'Faro és una IA i es pot equivocar. No cal que posis el teu nom ni el de la teva empresa.',
  'recorrido.conversacion.hoy': 'Avui',
  'recorrido.conversacion.titulo': 'Conversa amb Faro',
  'recorrido.descripcion':
    'Faro: explica a Faro a què et dediques, tria la teva ocupació, marca les teves tasques i rep el teu informe sobre la IA, tasca a tasca.',
  'recorrido.dialogo.aviso': 'Les notes venen de l’OIT; les tasques sense referència oficial apareixen sense nota.',
  'recorrido.dialogo.enlaces': 'Més sobre Faro',
  'recorrido.dialogo.texto': 'Una conversa, quatre passos. Pots tornar enrere quan vulguis.',
  'recorrido.documento.hoja': '1 full',
  'recorrido.documento.hojas': '{numero} fulls',
  'recorrido.documento.imprimir': 'Desar en PDF o imprimir',
  'recorrido.documento.leer': 'Llegir l’informe',
  'recorrido.documento.titulo': 'La IA i la teva feina',
  ...ERRORES_RECORRIDO,
  'recorrido.espera.buscando-clasificacion': 'Cercant a la classificació oficial…',
  'recorrido.espera.buscando-grupo': 'Cercant les ocupacions d’aquest tipus de feina…',
  'recorrido.espera.informe': 'Estic preparant el teu informe…',
  'recorrido.espera.leyendo-tareas': 'Llegint el que fas i cercant-ne la tasca oficial…',
  'recorrido.espera.pensando': 'Estic pensant en el que em dius…',
  'recorrido.espera.preparando-tareas': 'Cercant les tasques oficials de la teva ocupació…',
  'recorrido.espera.terminando-informe': 'Estic acabant el teu informe…',
  'recorrido.explorar.buscar': 'Cercar a la classificació oficial',
  'recorrido.explorar.candidatas': 'Pel que m’has dit, podria ser una d’aquestes',
  'recorrido.explorar.clasificacion': 'Classificació oficial d’ocupacions',
  'recorrido.explorar.contar': 'Prefereixo explicar-t’ho amb les meves paraules',
  'recorrido.explorar.dentro': 'Dins de «{titulo}»',
  'recorrido.explorar.dentro-de': 'Dins de «{titulo}», quina s’assembla més a la teva feina?',
  'recorrido.explorar.inicio':
    'Aquesta és la classificació oficial d’ocupacions. Tria el grup que s’assembla més a la teva feina: anirem del més general al més concret.',
  'recorrido.explorar.limite':
    'Per no fer-te més preguntes, cerquem la teva ocupació a la classificació oficial, del més general al més concret.',
  'recorrido.explorar.limite-candidatas':
    'Per no fer-te més preguntes, a dalt tens el que encaixa amb el que m’has dit.',
  'recorrido.explorar.nombre-candidata': '{titulo} · {grupo}',
  'recorrido.explorar.ocupaciones': '{numero} ocupacions',
  'recorrido.explorar.si-no-es-ninguna':
    'Si no és cap d’aquestes, cerca la teva a la classificació oficial, del més general al més concret.',
  'recorrido.explorar.sin-grupo':
    'No he trobat la teva ocupació amb aquestes paraules. Cerca-la a la classificació oficial, del més general al més concret, o explica-m’ho amb les teves paraules.',
  'recorrido.explorar.sin-grupo-candidatas':
    'No tinc clar de quin tipus és la teva feina. Aquestes ocupacions s’assemblen al que em dius.',
  'recorrido.explorar.una-ocupacion': 'Una ocupació',
  'recorrido.explorar.vacio': 'Aquí no hi ha més grups. Torna enrere o explica-m’ho amb les teves paraules.',
  'recorrido.explorar.volvemos-a': 'Tornem a «{titulo}».',
  'recorrido.explorar.volvemos-al-principio': 'Tornem al principi de la classificació oficial.',
  'recorrido.guia.alternar': 'Guia del recorregut',
  'recorrido.guia.lema': 'Una mica de claredat, pas a pas.',
  'recorrido.guia.mostrar': 'Mostrar la guia',
  'recorrido.guia.ocultar': 'Amagar la guia',
  'recorrido.guia.titulo': 'El teu espai',
  'recorrido.identidad.lema': 'La teva feina i la intel·ligència artificial',
  'recorrido.agente.avanzamos': 'Avancem cap a la part de formació?',
  'recorrido.agente.encargando': 'Preparant el teu informe',
  'recorrido.agente.entregando': 'Estic preparant el teu informe.',
  'recorrido.agente.fallo': 'No s’ha pogut acabar',
  'recorrido.agente.fallo-nota':
    'Pots tornar-ho a provar ara o continuar amb el teu full de ruta. Al final t’ho tornaré a oferir.',
  'recorrido.agente.listo': 'El teu informe ja és a punt.',
  'recorrido.agente.paralelo': 'Pots continuar amb el teu full de ruta',
  'recorrido.agente.preparando': 'Faro està preparant el teu informe en aquest moment.',
  'recorrido.agente.si': 'Sí, avancem',
  'recorrido.agente.sin-terminar': 'El teu informe no s’ha pogut acabar.',
  'recorrido.agente.solo-informe': 'Ara no, només l’informe',
  'recorrido.agente.terminado': 'Acabat · {numero} fulls',
  'recorrido.agente.terminado-una': 'Acabat · 1 full',
  'recorrido.agente.titulo': 'La IA i la teva feina',
  'recorrido.agente.trabajando': 'En preparació',
  'recorrido.agente.ya-estaba-listo': 'El teu informe ja era a punt',
  'recorrido.carpeta.aqui-dos': 'Aquí tens els teus dos documents:',
  'recorrido.carpeta.aqui-informe': 'Aquí tens el teu informe:',
  'recorrido.carpeta.guardar-los-dos': 'Desar-los tots dos',
  'recorrido.carpeta.hoja-dos-cursos': 'Pla amb dos cursos',
  'recorrido.carpeta.hoja-leer': 'Llegir el full de ruta',
  'recorrido.carpeta.hoja-sin-documento': 'No he pogut preparar aquest document. T’ho explico just a sota.',
  'recorrido.carpeta.hoja-titulo': 'Full de ruta',
  'recorrido.carpeta.hoja-un-curso': 'Pla amb un curs',
  'recorrido.carpeta.justo-arriba': 'Tens els dos documents a la teva carpeta, aquí dalt.',
  'recorrido.carpeta.titulo': 'La teva carpeta',

  'recorrido.hoja-doc.fallo':
    'No he pogut preparar el document del teu full de ruta. El teu full continua confirmat: torna-ho a provar.',

  'recorrido.hoja-doc.lista': 'Fet: aquí tens el teu full de ruta.',

  'recorrido.hoja.preparar': 'Preparar el meu full de ruta',

  'recorrido.informe.fallo-al-prepararlo':
    'Faro no ha pogut preparar el teu informe complet. Pots tornar-ho a provar o preparar ara un informe només amb les tasques oficials que has marcat.',
  'recorrido.informe.hecho-sin-las-tuyas':
    'Aquest informe inclou només les tasques oficials que has marcat. Les que has escrit amb les teves paraules sense una tasca oficial s’han quedat fora aquesta vegada.',
  'recorrido.informe.hecho-solo-oficiales': 'Aquí tens el teu informe amb les tasques oficials que has marcat.',
  'recorrido.informe.no-admitida':
    'No puc preparar el teu informe amb la teva tasca {numeros} tal com està escrita. Treu-la, o torna a les teves tasques i escriu-la d’una altra manera.',
  'recorrido.informe.no-admitidas':
    'No puc preparar el teu informe amb les teves tasques {numeros} tal com estan escrites. Treu-les, o torna a les teves tasques i escriu-les d’una altra manera.',
  'recorrido.informe.otro-idioma':
    'El teu informe està escrit en l’idioma en què el vas demanar: canviar el de la pàgina no el tradueix. Torna a les teves tasques i demana’l una altra vegada per llegir-lo en aquest idioma.',
  'recorrido.informe.pedir': 'Veure el meu informe',
  'recorrido.informe.quitar-una': 'Treure-la i veure el meu informe',
  'recorrido.informe.quitar-varias': 'Treure-les i veure el meu informe',
  'recorrido.informe.solo-oficiales': 'Preparar-lo només amb les tasques oficials',

  'recorrido.informe.sin-citar-una':
    'La teva tasca {numeros} va sense nota al teu informe: {motivo} Apareix com a informació insuficient; si vols, treu-la o escriu-la d’una altra manera.',
  'recorrido.informe.sin-citar-varias':
    'Les teves tasques {numeros} van sense nota al teu informe: {motivo} Apareixen com a informació insuficient; si vols, treu-les o escriu-les d’una altra manera.',
  'recorrido.informe.sin-estimar-una':
    'La tasca que has escrit, «{tarea}», no correspon a cap tasca oficial i per això va sense nota: {motivo} A l’informe apareix com a informació insuficient.',
  'recorrido.informe.sin-estimar-varias':
    'Les {numero} tasques que has escrit ({tareas}) no corresponen a cap tasca oficial i per això van sense nota: {motivo} A l’informe apareixen com a informació insuficient.',
  'recorrido.informe.sin-paso':
    'No he pogut preparar el teu informe: no ha arribat una part de Faro. Comprova la connexió i torna a prémer «Veure el meu informe». El que has fet continua aquí.',
  'recorrido.informe.version-nueva':
    'No puc preparar el teu informe en aquesta pàgina: Faro s’ha actualitzat mentre feies el recorregut. Per continuar cal tornar-la a carregar, i això esborra el que has fet: apunta abans el que vulguis conservar.',
  'recorrido.informe.volver-tareas': 'Tornar a les meves tasques',
  'recorrido.lector.faro': 'Faro: ',
  'recorrido.lector.persona': 'Tu: ',
  'recorrido.lista.y': '{inicio} i {ultimo}',
  'recorrido.borrado-en-otra-pestana':
    'Has esborrat les teves dades de Faro en una altra pestanya, així que aquí també he tornat a començar.',

  'recorrido.motivo.contenido': 'Faro no pot valorar aquest text.',
  'recorrido.motivo.otro': 'alguna cosa ha fallat a Faro.',
  'recorrido.motivo.salida': 'Faro no ha pogut processar aquesta tasca.',
  'recorrido.motivo.sin-estimacion-acreditada': 'Faro només posa nota a les tasques oficials.',
  'recorrido.motivo.sin-limpieza': 'no he pogut preparar el filtre de dades personals en aquest dispositiu.',
  'recorrido.motivo.sin-referencias':
    'l’OIT no publica tasques de referència per al teu tipus de feina ni per als semblants.',
  'recorrido.motivo.tarda': 'la resposta de Faro no ha arribat a temps.',
  'recorrido.nueva.borrar': 'Començar de nou',
  'recorrido.nueva.boton': '{0}Nova conversa',

  'recorrido.nueva.seguir': 'Quedar-me aquí',
  'recorrido.nueva.texto':
    'S’esborraran aquesta conversa i tot el teu recorregut. Si ho prefereixes, et quedes aquí i continues quan vulguis.',
  'recorrido.nueva.titulo': 'Nova conversa',
  'recorrido.ocupacion.buscar': 'Prefereixo cercar-la a la classificació oficial',
  'recorrido.ocupacion.como-seguir': 'Aleshores, com prefereixes continuar?',
  'recorrido.ocupacion.contar': 'T’ho explico amb les meves paraules',
  'recorrido.ocupacion.creo-que': 'Crec que la teva feina és d’aquest tipus:',
  'recorrido.ocupacion.cual-es-la-tuya': 'Quina d’aquestes ocupacions és la teva?',
  'recorrido.ocupacion.cuentame-mas': 'Explica-m’ho una mica més: a què et dediques?',
  'recorrido.ocupacion.dicho-grupo': 'La meva feina és d’aquest tipus: {titulo}',
  'recorrido.ocupacion.dicho-ninguna': 'No és cap d’aquestes. Fes-me més preguntes.',
  'recorrido.ocupacion.dicho-parecida': 'S’assembla a «{titulo}», però no és exactament la meva ocupació.',
  'recorrido.ocupacion.elige-en-lista': 'Si és així, tria la teva ocupació a la llista.',
  'recorrido.ocupacion.elige-o-ninguna':
    'Tria la teva ocupació a la llista o prem «Cap d’aquestes, però és aquest tipus de feina».',
  'recorrido.ocupacion.entendido': 'Entesos: «{titulo}».',
  'recorrido.ocupacion.es-tu-trabajo': 'És aquesta la teva feina?',
  'recorrido.ocupacion.grupo-te-dedicas': '«{titulo}». Et dediques a això?',
  'recorrido.ocupacion.la-mas-parecida': 'La més semblant',
  'recorrido.ocupacion.leyenda': 'Les ocupacions que et proposo',
  'recorrido.ocupacion.mas-preguntas': 'Fes-me més preguntes per afinar',
  'recorrido.ocupacion.ninguna': 'Cap no és la meva',
  'recorrido.ocupacion.ninguna-buscar': 'Cap d’aquestes: prefereixo cercar la meva ocupació',
  'recorrido.ocupacion.ninguna-entendido': 'D’acord, no és cap d’aquestes. Et faré alguna pregunta més per afinar.',
  'recorrido.ocupacion.otra-cosa': 'No, és una altra cosa',
  'recorrido.ocupacion.otra-vez': 'D’acord. Explica’m una altra vegada a què et dediques.',
  'recorrido.ocupacion.otras-palabras': 'D’acord. Explica’m amb altres paraules a què et dediques.',
  'recorrido.ocupacion.parecida': 'S’assembla a «{titulo}», però no és exactament aquesta',
  'recorrido.ocupacion.por-lo-que-dices': 'Pel que em dius («{cita}»), crec que la teva feina és d’aquest tipus:',
  'recorrido.ocupacion.propuesta-una':
    'Pel que m’expliques, crec que aquesta és la teva ocupació. Si és així, prem «Continuar».',
  'recorrido.ocupacion.propuesta-varias':
    'Pel que m’expliques, la teva ocupació pot ser una d’aquestes. He marcat la més semblant; si la teva és una altra, tria-la. Després, prem «Continuar».',
  'recorrido.ocupacion.te-dedicas': 'Et dediques a això?',
  'recorrido.ocupacion.te-dedicas-elige': 'Et dediques a això? Si és així, tria la teva ocupació a la llista.',
  'recorrido.ocupacion.volvemos-a-grupo': 'Tornem a «{titulo}». Et dediques a això?',
  'recorrido.ocupacion.volvemos-a-pregunta': 'Tornem a la meva pregunta.',
  'recorrido.pasar.aviso':
    'Qui escanegi el codi o rebi l’enllaç podrà veure el teu informe amb la teva ocupació i les tasques oficials que has triat: el codi no va xifrat. No porta res del que has escrit amb les teves paraules. Aquell dispositiu pot recordar l’enllaç al seu historial.',
  'recorrido.pasar.copiado': 'Enllaç copiat.',
  'recorrido.pasar.copiar': 'Copiar l’enllaç',
  'recorrido.pasar.en-curso':
    'Per obrir l’informe d’un altre dispositiu, comença abans una conversa nova i torna a obrir l’enllaç: així no es barreja amb aquest recorregut.',
  'recorrido.pasar.enlace': 'O obre aquest enllaç a l’altre dispositiu',
  'recorrido.pasar.entrada': 'Passar a un altre dispositiu',
  'recorrido.pasar.fallo': 'Ara no puc refer aquest informe. Torna a obrir l’enllaç d’aquí a un moment.',
  'recorrido.pasar.no-valido':
    'Aquest codi no es pot llegir: pot estar malmès o incomplet. Demana’n un de nou a l’altre dispositiu.',
  'recorrido.pasar.qr': 'Codi QR amb l’enllaç al teu informe. El mateix enllaç és a sota.',
  'recorrido.pasar.recibido':
    'Aquest és l’informe que has passat des d’un altre dispositiu, refet aquí amb les dades de Faro.',
  'recorrido.pasar.seleccionado': 'Enllaç seleccionat: copia’l amb el menú del navegador.',
  'recorrido.pasar.sin-viajar':
    'Les tasques que vas explicar amb les teves paraules s’han quedat a l’altre dispositiu: el que escrius no viatja.',
  'recorrido.pasar.titulo': 'Passar a un altre dispositiu',
  'recorrido.paso.1.detalle': 'Explica’m com treballes',
  'recorrido.paso.1.nombre': 'El teu dia a dia',
  'recorrido.paso.2.detalle': 'Cerco on encaixa',
  'recorrido.paso.2.nombre': 'La teva ocupació',
  'recorrido.paso.3.detalle': 'Revisa el que fas',
  'recorrido.paso.3.nombre': 'Les teves tasques',
  'recorrido.paso.4.detalle': 'Resultats i orientació',
  'recorrido.paso.4.nombre': 'El teu informe',
  'recorrido.paso.pastilla': 'Pas {paso} de {total}',
  'recorrido.pasos.titulo': 'El teu recorregut',
  'recorrido.pensamiento.barra': 'Faro està pensant…',
  'recorrido.pensamiento.paso.analizar': 'Analitzant la teva resposta',
  'recorrido.pensamiento.paso.clasificador': 'Contrastant el tipus de feina',
  'recorrido.pensamiento.paso.comparar': 'Comparant amb les ocupacions oficials',
  'recorrido.pensamiento.paso.corregir': 'Corregint l’ortografia',
  'recorrido.pensamiento.paso.elegir': 'Triant la més semblant',
  'recorrido.pensamiento.paso.ordenar': 'Ordenant les {numero} més semblants',
  'recorrido.pensamiento.paso.preguntar': 'Preparant una pregunta',
  'recorrido.pensamiento.paso.significado': 'Cercant feines semblants',
  'recorrido.pensamiento.paso.tareas-buscar': 'Cercant les tasques de la teva ocupació',
  'recorrido.pensamiento.paso.tareas-cercana': 'Sumant les d’una ocupació propera',
  'recorrido.pensamiento.paso.tareas-reunir': 'Reunint {numero} tasques oficials',
  'recorrido.pensamiento.pensando': 'Pensant…',
  'recorrido.pensamiento.resumen': 'Com ho he pensat',
  'recorrido.persona.mi-ocupacion': 'La meva ocupació: {titulo}',
  'recorrido.privacidad.boton': '{0}Privadesa',
  'recorrido.privacidad.local':
    'Faro és un sistema d’IA amb models propis que funcionen en aquest dispositiu. Utilitza dades oficials per orientar-te sobre la teva feina. Evita escriure el teu nom, el de la teva empresa, dades de salut o dades d’altres persones.',
  'recorrido.privacidad.mas': 'Més sobre les teves dades i els teus drets',
  'recorrido.privacidad.texto-2':
    'El que escrius només viu en aquesta pàgina: quan la tanques o esborres el teu informe, desapareix de Faro.',
  'recorrido.privacidad.titulo': 'Què fem amb el teu text',
  'recorrido.reintentar': 'Tornar-ho a provar',
  'recorrido.revision.cambiada-una': 'Has canviat una tasca: revisa’n la tasca oficial abans de demanar l’informe.',
  'recorrido.revision.cambiadas': 'Has canviat {numero} tasques: revisa’n la tasca oficial abans de demanar l’informe.',
  'recorrido.revision.corta': 'Cada tasca necessita almenys {minimo} lletres. Completa la tasca {numero}.',
  'recorrido.revision.falta-tiempo': 'Em falta saber quant de temps dediques a les {numero} tasques marcades.',
  'recorrido.revision.falta-tiempo-una': 'Em falta saber quant de temps dediques a la tasca marcada.',
  'recorrido.revision.sin-tareas':
    'Necessito almenys una tasca per preparar el teu informe. Escriu-la a sota o afegeix-ne una de la llista oficial.',
  'recorrido.saludo.hola': 'Hola, soc Faro.',
  'recorrido.saludo.pregunta': 'A què et dediques?',
  'recorrido.saludo.tras-borrar': 'He esborrat la nostra conversa i tot el que m’havies explicat. Tornem a començar.',

  'recorrido.sin-textos': 'No s’han pogut carregar els textos de Faro. Comprova la connexió i {0}.',
  'recorrido.sin-textos.recargar': 'torna a carregar la pàgina',
  'recorrido.tarea.cambiada':
    'Has canviat la tasca: torna a triar-ne la tasca oficial. Sense una referència, quedarà sense nota.',
  'recorrido.tarea.cambiada-anuncio': 'Tasca {numero}: has canviat el text; torna a triar-ne la tasca oficial.',
  'recorrido.tarea.de-grupo': 'De: {grupo}',
  'recorrido.tarea.en-ingles': '{0} (en anglès)',
  'recorrido.tarea.en-ingles-en-lista': '{texto} (en anglès)',
  'recorrido.tarea.ninguna': 'Cap: conservar la tasca sense nota',
  'recorrido.tarea.nota-oit': 'Nota de l’OIT: {nota}',
  'recorrido.tarea.numero': 'Tasca {numero}',
  'recorrido.tarea.oficial-etiqueta': 'Tasca oficial de l’OIT que li correspon',
  'recorrido.tarea.origen.elegida': 'Triada per tu.',
  'recorrido.tarea.origen.propuesta': 'Proposta de Faro. La pots canviar.',
  'recorrido.tarea.origen.sin': 'Sense tasca oficial: es conserva el text sense atribuir-li una nota.',
  'recorrido.tarea.origen.ya-contada':
    'La referència «{oficial}» ja es compta en una altra tasca. Si és la mateixa tasca, retira aquesta per no comptar-la dues vegades; si no, conserva-la sense atribuir-li aquesta referència.',
  'recorrido.tarea.quitar': 'Treure',
  'recorrido.tarea.quitar-nombre': 'Treure la tasca {numero}',
  'recorrido.tarea.rotulo': '{nombre} · nota OIT {nota}',
  'recorrido.tarea.rotulo-grupo': '{nombre} · nota OIT {nota} · {grupo}',
  'recorrido.tarea.sin-oit':
    'L’OIT no publica tasques d’aquest grup. Sense una referència oficial acreditada, la tasca queda sense nota.',
  'recorrido.tarea.sin-referencias':
    'No hi ha una referència oficial acreditada per a aquesta tasca: a l’informe apareixerà com a informació insuficient.',
  'recorrido.tarea.ya-la-cuentas': 'Ja la comptes a la teva tasca «{tarea}».',
  'recorrido.tareas.algo-mas': 'Fas alguna cosa més?',
  'recorrido.tareas.algo-mas-abajo':
    'Fas alguna cosa més? Prem «Afegir una altra tasca» i explica-m’ho amb les teves paraules.',
  'recorrido.tareas.algo-mas-nota':
    'Prem «Afegir una altra tasca» i escriu-ho amb les teves paraules. Si correspon a una tasca oficial, tria-la a la seva llista; si no, es conserva al teu informe sense nota.',
  'recorrido.tareas.anadida': 'He afegit a la teva llista {tareas}. Quant de temps hi dediques?',
  'recorrido.tareas.anadidas': 'He afegit a la teva llista {tareas}. Quant de temps dediques a cadascuna?',
  'recorrido.tareas.anadir': '{0}Afegir una altra tasca',
  'recorrido.tareas.apuntado':
    'També he apuntat el que m’has explicat, amb la tasca oficial que li correspon: la pots canviar.',
  'recorrido.tareas.apuntado-sin-oficial':
    'He conservat el que has escrit. Tria una tasca oficial si correspon; sense referència, quedarà sense nota.',
  'recorrido.tareas.aqui-tienes':
    'Aquí tens les teves tasques. Canvia el que vulguis i torna a demanar el teu informe.',
  'recorrido.tareas.aviso-ocupacion':
    'Cap de les teves tasques no coincideix amb les tasques oficials de «{titulo}». Si no és la teva ocupació, torna enrere i tria’n una altra.',
  'recorrido.tareas.como': 'Com a {titulo}',
  'recorrido.tareas.confirmado': 'Confirmat',
  'recorrido.tareas.confirmar': 'Confirmar',
  'recorrido.tareas.cuantas': '{numero} tasques',
  'recorrido.tareas.cuantas.0': 'cap tasca',
  'recorrido.tareas.cuantas.1': 'una sola tasca',
  'recorrido.tareas.cuantas.2': 'dues tasques',
  'recorrido.tareas.cuentame':
    'Explica’m a sota les teves tasques amb les teves paraules i digues-me quant de temps dediques a cadascuna: {estimacion}',
  'recorrido.tareas.debajo': 'A sota, a «També faig…», hi ha les de «{titulo}».',
  'recorrido.tareas.desmarcada': 'Tasca desmarcada.',
  'recorrido.tareas.estas-son':
    'Aquestes són les tasques oficials de «{titulo}», segons l’Organització Internacional del Treball (OIT). Marca les que fas i digues-me quant de temps dediques a cadascuna.',

  'recorrido.tareas.falta.escribe': 'Explica’m les tasques que fas.',
  'recorrido.tareas.falta.lista-una': 'Una tasca, tot a punt.',
  'recorrido.tareas.falta.listas': '{numero} tasques, tot a punt.',
  'recorrido.tareas.falta.marca': 'Marca les tasques que fas.',
  'recorrido.tareas.falta.tiempo': 'Falta el temps de {numero} tasques.',
  'recorrido.tareas.falta.tiempo-una': 'Falta el temps d’una tasca.',
  'recorrido.tareas.limitado': 'Amb {cuantas} l’informe serà molt limitat.',
  'recorrido.tareas.limitado-donde':
    'Amb {cuantas} l’informe serà molt limitat. Marca les que facis a la llista oficial o escriu-ne d’altres a sota.',
  'recorrido.tareas.marcada': 'Tasca marcada. Indica a sota quant de temps hi dediques.',
  'recorrido.tareas.mas-detalle':
    'Escriu-me la tasca amb una mica més de detall; millor si comença amb un verb: «Preparar les comandes».',
  'recorrido.tareas.maximo': 'Faro admet fins a {numero} tasques. Treu-ne alguna si en vols afegir una altra.',
  'recorrido.tareas.ninguna-donde':
    'Encara no hi ha cap tasca. Marca les que facis a la llista oficial o escriu-ne d’altres a sota.',
  'recorrido.tareas.ninguna-escribe': 'Encara no hi ha cap tasca. Escriu la primera a sota.',
  'recorrido.tareas.no-estimara':
    'Les tasques sense una referència oficial acreditada es conserven sense nota, com a informació insuficient.',
  'recorrido.tareas.oficiales-de': 'Tasques oficials de «{titulo}»',
  'recorrido.tareas.oficiales-explicacion':
    'Marca les que fas. Les publica l’OIT per a aquest tipus de feina, cadascuna amb la seva nota.',
  'recorrido.tareas.oficiales-secundario': 'Tasques oficials de «{titulo}». Marca també les que fas.',
  'recorrido.tareas.que-mas':
    'Què més fas? Escriu-ho a sota amb les teves paraules; millor si comença amb un verb: «Preparar les comandes».',
  'recorrido.tareas.quitada': 'Tasca {numero} treta.',
  'recorrido.tareas.retirada':
    'He retirat de la teva llista la tasca oficial que havies marcat per a «{titulo}»: és d’un altre tipus de feina.',
  'recorrido.tareas.retiradas':
    'He retirat de la teva llista les {numero} tasques oficials que havies marcat per a «{titulo}»: són d’un altre tipus de feina.',
  'recorrido.tareas.revisar': 'Revisar la meva ocupació',
  'recorrido.tareas.sin-oficiales': 'L’OIT no publica tasques oficials per a «{titulo}».',
  'recorrido.tareas.tambien-hago': 'També faig…',
  'recorrido.tareas.vacio': 'Encara no hi ha tasques. Escriu la primera a sota.',
  'recorrido.tareas.ya-contada':
    '«{tarea}» s’assembla a «{oficial}», que ja comptes: per no comptar-la dues vegades, no l’he enllaçada.',
  'recorrido.tiempo.algo': 'Una part',
  'recorrido.tiempo.mucho': 'La major part',
  'recorrido.tiempo.poco': 'Molt poc',
  'recorrido.tiempo.pregunta': 'Quant de temps hi dediques?',
  'recorrido.titulo': 'El teu recorregut · Faro',
  'recorrido.titulo-principal': 'El teu recorregut amb Faro',
  'recorrido.volver': 'Tornar',
  'recorrido.volver-inicio': 'Tornar a l’inici de Faro',
  // Textos del motor local y su preparación.
  'recorrido.local.aclarar.texto': 'M’expliques què fas en un dia normal?',
  'recorrido.local.aclarar.titulo': 'No t’he entès del tot',
  'recorrido.local.comparacion-reducida':
    'Aquesta vegada he pogut comparar menys informació de l’habitual. Revisa amb atenció l’ocupació que et proposo.',
  'recorrido.local.cortesia.como-estas':
    'Hola! Molt bé, gràcies. Explica’m a què et dediques: el teu lloc de feina o què fas en un dia normal.',
  'recorrido.local.cortesia.despedida':
    'Fins aviat! Si vols continuar, explica’m a què et dediques: el teu lloc de feina o què fas en un dia normal.',
  'recorrido.local.cortesia.gracias':
    'De res! Quan vulguis, explica’m a què et dediques: el teu lloc de feina o què fas en un dia normal.',
  'recorrido.local.cortesia.saludo':
    'Hola! Explica’m a què et dediques: el teu lloc de feina o què fas en un dia normal.',
  'recorrido.local.cortesia.sobre-faro':
    'Soc Faro i no soc un xat: amb el que m’expliquis de la teva feina, busco la teva ocupació i les seves tasques oficials. Explica’m a què et dediques: el teu lloc de feina o què fas en un dia normal.',
  'recorrido.local.familias.sin-entender':
    'Encara no ho entenc bé, perdona. Busquem la teva ocupació per famílies: aquí hi són totes.',
  'recorrido.local.familias.tras-rechazos':
    'No l’he encertada. Busquem la teva ocupació per famílies: aquí hi són totes.',
  'recorrido.local.grupo-oficial': 'Tipus de feina oficial: {grupo} (CIUO-08 {codigo})',
  'recorrido.local.guiado.cortesia':
    'Continuo aquí. Per no fer-te donar més voltes, tria la família de la teva feina; també pots escriure una paraula al filtre.',
  'recorrido.local.guiado.sin-cambios':
    'Amb el que m’expliques continuo veient el mateix. Per no fer-te donar més voltes, tria la família de la teva feina; també pots escriure una paraula al filtre o tornar al que et proposava.',
  'recorrido.local.lo-cuento.anadido': 'Ho tinc en compte, amb el que ja m’has dit.',
  'recorrido.local.lo-cuento.boton': 'Ho explico amb les meves paraules',
  'recorrido.local.lo-cuento.ejemplo': 'Per exemple: «Faig les nòmines i els contractes».',
  'recorrido.local.lo-cuento.etiqueta': 'Explica’m què fas, amb les teves paraules',
  'recorrido.local.preparando':
    'Faro s’està preparant al teu dispositiu per entendre’t sense enviar res. Només passa la primera vegada i pot trigar una mica: continuarà sol quan estigui a punt.',
  'recorrido.local.preparando.anuncio': 'Preparant Faro: {porcentaje} %.',
  'recorrido.local.preparando.anuncio-listo': 'Faro està a punt.',
  'recorrido.local.preparando.archivos': '{guardados} de {archivos} arxius',
  'recorrido.local.preparando.avance': 'Preparant Faro al teu dispositiu: {porcentaje} % ({detalle})',
  'recorrido.local.preparando.barra': 'Preparació de Faro al teu dispositiu',
  'recorrido.local.preparando.fase.datos': 'carregant les dades',
  'recorrido.local.preparando.fase.ia': 'carregant la IA de Faro',
  'recorrido.local.preparando.fase.listo': 'a punt',
  'recorrido.local.preparando.fase.motor': 'preparant Faro per respondre',
  'recorrido.local.preparando.fase.reintento': 'tornant-ho a provar…',
  'recorrido.local.preparando.megas': '{hechos} de {total} MB',
};
