// Textos dels avisos de l’estat de les dades: l’edició que publica una enquesta, el que la última sortida no recull i la fallada del magatzem de cursos.
/** @type {Readonly<Record<string,string>>} */
export const TEXTOS_AVISOS_DATOS = {
  'panel.datos.almacen.almacen-ausente':
    'Falta el magatzem del catàleg de cursos en aquesta instal·lació. Faro no ha compost un catàleg nou. Què cal fer: avisa l’equip tècnic perquè restauri la còpia conservada del magatzem o, si no n’hi ha cap, en creï un de nou.',
  'panel.datos.almacen.almacen-ilegible':
    'El magatzem del catàleg de cursos no es pot llegir correctament. Faro no ha compost un catàleg nou. Què cal fer: avisa l’equip tècnic perquè restauri la còpia conservada del magatzem.',
  'panel.datos.almacen.almacen-vacio':
    'El magatzem del catàleg de cursos no té cap curs després d’aplicar les fonts. Faro no publica un catàleg buit. Què cal fer: avisa l’equip tècnic perquè restauri la còpia conservada del magatzem o esperi que una font aporti cursos.',
  'panel.datos.aviso-instalacion': 'Avís sobre les dades d’aquesta instal·lació',
  'panel.datos.atencion-por-aviso': 'Aquesta font necessita que una persona la revisi: l’avís de sota diu què cal fer.',
  'panel.datos.edicion-nueva.publicada-sin-microdatos':
    'Edició {v0} publicada, encara sense les microdades. Observat: {v1}.',
  'panel.datos.edicion-nueva.pendiente-de-incorporar':
    'Edició {v0} publicada amb les microdades; Faro continua mostrant l’anterior. Observat: {v1}.',
  'panel.datos.aviso-edicion.edicion-no-verificable':
    'No s’ha pogut comprovar quina edició anuncia l’INE; es continua mostrant la que hi ha.',
  'panel.datos.aviso-edicion.observacion-anterior-descartada':
    'L’última consulta va descartar un registre anterior que no es podia llegir; la data de l’edició nova és la d’aquesta consulta.',
  'panel.datos.aviso-edicion.sin-contraste-con-la-tich':
    'Les xifres de l’Idescat són d’una edició anterior a la de l’enquesta de l’INE que fa servir Faro; es contrastaran quan l’Idescat publiqui la mateixa edició.',
  'panel.datos.aviso-edicion.sin-contraste-del-motivo':
    'Les xifres de l’Idescat sobre les persones que no sabien fer servir la IA no s’han pogut contrastar amb el càlcul de Faro, perquè encara no hi ha aquest càlcul per a la mateixa edició. Les altres xifres sí que s’han comprovat.',
  'panel.datos.grupos-en-su-gran-grupo.uno':
    '{v0} grup d’ocupació es mostra amb la xifra del seu gran grup perquè l’EPA no confirma com es reparteixen.',
  'panel.datos.grupos-en-su-gran-grupo.otros':
    '{v0} grups d’ocupació es mostren amb la xifra del seu gran grup perquè l’EPA no confirma com es reparteixen.',
  'panel.datos.salida-parcial': 'L’última actualització publicada d’aquesta font no ho inclou tot: {v0}.',
  'panel.datos.salida-parcial.descartadas.uno': '{v0} fitxa descartada',
  'panel.datos.salida-parcial.descartadas.otros': '{v0} fitxes descartades',
  'panel.datos.salida-parcial.motivo.indice-caido':
    'El catàleg de FUNDAE no ha respost: es manté l’oferta anterior. Faro el tornarà a consultar en la propera actualització.',
  'panel.datos.salida-parcial.motivo.fichas-fallidas':
    'Algunes fitxes no han respost: els cursos d’aquestes fitxes es mantenen com estaven fins a la propera consulta.',
  'panel.datos.salida-parcial.motivo.tope-de-consultas':
    'La consulta s’ha aturat en arribar al límit de peticions: el que no s’ha consultat es manté com estava i es consultarà en la propera actualització.',
  'panel.datos.salida-parcial.motivo.plazo-de-la-descarga':
    'La consulta s’ha aturat en esgotar el temps: el que no s’ha consultat es manté com estava i es consultarà en la propera actualització.',
  'panel.datos.salida-parcial.motivo.censo-ia-parcial':
    'El llistat de formacions d’IA del Cibernàrium ha arribat incomplet: es manté l’anterior.',
  'panel.datos.salida-parcial.motivo.censo-del-canal-sin-admitir-completo':
    'No s’ha pogut comprovar el catàleg complet del Cibernàrium: es manté el llistat anterior.',
  'panel.datos.salida-parcial.motivo.pagina-de-ambitos-caida':
    'La pàgina d’àmbits del Cibernàrium no ha respost: no s’ha consultat la seva llista de formacions d’IA i es manté el llistat anterior.',
  'panel.datos.salida-parcial.motivo.portlet-no-encontrado':
    'No s’ha trobat a la pàgina del Cibernàrium l’adreça de la seva consulta: es manté el llistat anterior. Què cal fer: avisa l’equip tècnic perquè revisi la pàgina de filtres del Cibernàrium.',
  'panel.datos.salida-parcial.motivo.ambito-ia-sin-nombre':
    'La pàgina d’àmbits del Cibernàrium ja no mostra l’àmbit d’Intel·ligència Artificial: es manté el llistat anterior. Què cal fer: avisa l’equip tècnic perquè revisi la pàgina de filtres.',
  'panel.datos.salida-parcial.motivo.ambito-ia-cambiado':
    'El Cibernàrium ha canviat el nom del seu àmbit d’Intel·ligència Artificial: es manté el llistat anterior. Què cal fer: avisa l’equip tècnic perquè comprovi com es diu ara.',
  'panel.datos.salida-parcial.motivo.portlet-cambiado':
    'El Cibernàrium ha canviat l’adreça de la seva consulta: s’ha fet servir la nova. No cal fer res.',
  'panel.datos.salida-parcial.motivo.codigo-de-inscripcion-desconocido':
    'Una o més formacions del Cibernàrium porten un estat d’inscripció que Faro no coneix: les places no consten. Què cal fer: avisa l’equip tècnic perquè ho revisi.',
  'panel.datos.salida-parcial.motivo.texto-de-plazas-desconocido':
    'Una o més formacions del Cibernàrium donen les places amb un altre text: no consten. Què cal fer: avisa l’equip tècnic perquè ho revisi.',
  'panel.datos.edicion-nueva.detenida-por-controles':
    'Edició {v0} aturada: no ha superat totes les comprovacions i es continua publicant l’anterior. Observat: {v1}.',
  'panel.datos.edicion-nueva.motivo.enunciado-distinto':
    'La pregunta de l’edició nova no està formulada igual que a la sèrie. Què cal fer: avisa l’equip tècnic perquè la revisi abans d’incorporar-la.',
  'panel.datos.edicion-nueva.motivo.tablas':
    'No s’han pogut localitzar o descarregar les taules, els documents o les dades. Què cal fer: avisa l’equip tècnic.',
  'panel.datos.edicion-nueva.motivo.controles':
    'Les dades no han superat una comprovació. Què cal fer: avisa l’equip tècnic.',
  'panel.datos.edicion-nueva.parte.pregunta': 'Ha canviat la pregunta.',
  'panel.datos.edicion-nueva.parte.periodo': 'Ha canviat el període pel qual es pregunta.',
  'panel.datos.edicion-nueva.parte.opciones': 'Han canviat les opcions de resposta sobre l’ús de la IA a la feina.',
  'panel.datos.edicion-nueva.parte.codigos': 'Han canviat els valors de resposta.',
  'panel.datos.aviso-edicion.edicion-no-coincide':
    'L’any de l’edició publicada no coincideix amb el de l’edició que Faro té en ús. Què cal fer: avisa l’equip tècnic perquè ho revisi.',
  'panel.datos.grupos-sin-clase.uno':
    '{v0} grup d’ocupació no té classe manual ni no manual en aquesta edició; el seu informe no diu quantes persones no sabien fer servir la IA.',
  'panel.datos.grupos-sin-clase.otros':
    '{v0} grups d’ocupació no tenen classe manual ni no manual en aquesta edició; el seu informe no diu quantes persones no sabien fer servir la IA.',
  'panel.datos.enlaces': 'Enllaços dels cursos: {v0}.',
  'panel.datos.enlaces.comprobados.uno': '{v0} enllaç comprovat',
  'panel.datos.enlaces.comprobados.otros': '{v0} enllaços comprovats',
  'panel.datos.enlaces.ocultos.uno': '{v0} enllaç amagat perquè la seva pàgina ja no existeix',
  'panel.datos.enlaces.ocultos.otros': '{v0} enllaços amagats perquè la seva pàgina ja no existeix',
  'panel.datos.enlaces.sin-comprobar.uno': '{v0} enllaç encara sense comprovar',
  'panel.datos.enlaces.sin-comprobar.otros': '{v0} enllaços encara sense comprovar',
  'panel.datos.salida-parcial.motivo.censo-digitalizate-sin-lista':
    'La llista de proveïdors de Digitalízate no ha respost: avui no hi ha altes ni baixes dels seus cursos.',
  'panel.datos.salida-parcial.motivo.censo-digitalizate-sin-lista-de-baja':
    'La llista de proveïdors donats de baixa de Digitalízate no ha respost: avui no hi ha altes ni baixes dels seus cursos.',
  'panel.datos.salida-parcial.motivo.censo-digitalizate-fichas-fallidas':
    'Alguna de les fitxes dels proveïdors de Digitalízate no ha respost: avui no hi ha altes ni baixes dels seus cursos.',
  'panel.datos.salida-parcial.motivo.censo-digitalizate-recuento-descuadrado':
    'Les fitxes dels proveïdors de Digitalízate no porten els cursos que anuncia la seva llista: avui no hi ha altes ni baixes dels seus cursos.',
  'panel.datos.salida-parcial.motivo.censo-digitalizate-forma-inesperada':
    'Les fitxes dels proveïdors de Digitalízate han canviat de format: els cursos afectats es queden com estaven. Què cal fer: avisa l’equip tècnic perquè ho revisi.',
  'panel.datos.salida-parcial.motivo.censo-digitalizate-tope-de-proveedores':
    'Digitalízate llista més proveïdors dels que Faro consulta en un dia: avui no hi ha altes ni baixes dels seus cursos. Què cal fer: avisa l’equip tècnic.',
  'panel.datos.salida-parcial.motivo.censo-digitalizate-contradice-al-indice':
    'Les fitxes dels proveïdors de Digitalízate i el seu cercador no coincideixen en algun curs: val el que diuen les fitxes dels proveïdors actius i el que és dubtós es queda com estava.',
  'panel.datos.salida-parcial.motivo.fundae-conjunto-sin-aplicar':
    'Hi ha una actualització de FUNDAE preparada amb un catàleg de cursos diferent de l’actual: no s’ha aplicat i es conserva. Què cal fer: demana a l’equip tècnic que la revisi.',
  'panel.datos.salida-parcial.motivo.dominio-con-limite':
    'Un web ha demanat que el consultin menys: la resta dels seus enllaços es deixa per a la propera actualització.',
  'panel.datos.salida-parcial.motivo.indice-de-hp-life-sin-completar':
    'Faro no ha pogut llegir sencera la llista de cursos d’HP LIFE. Continua amb els cursos que ja coneix i no en retira cap fins que la pugui comprovar.',
  'panel.datos.salida-parcial.motivo.ficha-integra-fuera-del-listado':
    'Un o més cursos ja no apareixen al catàleg d’HP LIFE, però la seva pàgina continua funcionant. Faro els manté i els tornarà a revisar.',
  'panel.datos.salida-parcial.motivo.ausente-del-listado-sin-confirmar':
    'Un o més cursos ja no apareixen al catàleg d’HP LIFE i la seva pàgina no s’ha pogut comprovar. Faro els manté i els tornarà a revisar.',
  'panel.datos.salida-parcial.motivo.gratuidad-de-hp-life-sin-comprobar':
    'Faro no ha pogut comprovar que HP LIFE continuï declarant gratuïts els seus cursos. Manté l’últim que ha comprovat i no el renova fins que ho pugui comprovar.',
  'panel.datos.salida-parcial.motivo.curso-fuera-del-catalogo-con-su-pagina':
    'Un o més cursos ja no apareixen al catàleg de Cibervoluntarios, però la pàgina del curs continua funcionant. Faro els manté i els tornarà a revisar.',
  'panel.datos.salida-parcial.motivo.curso-fuera-del-catalogo-sin-confirmar':
    'Un o més cursos ja no apareixen al catàleg de Cibervoluntarios i la seva pàgina no s’ha pogut comprovar. Faro els manté i els tornarà a revisar.',
  'panel.datos.salida-parcial.motivo.estado-desconocido-en-el-catalogo':
    'El catàleg de Cibervoluntarios porta un estat que Faro no coneix: avui no es retira cap curs. Què cal fer: avisa l’equip tècnic perquè ho revisi.',
  'panel.datos.salida-parcial.a-revisar.uno':
    '{v0} especialitat de FUNDAE exclosa sembla tractar d’IA, de l’àmbit digital o de les dades. L’equip tècnic pot decidir si s’hi inclou.',
  'panel.datos.salida-parcial.a-revisar.otros':
    '{v0} especialitats de FUNDAE excloses semblen tractar d’IA, de l’àmbit digital o de les dades. L’equip tècnic pot decidir si s’hi inclouen.',
};
