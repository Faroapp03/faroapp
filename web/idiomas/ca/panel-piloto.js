// Textos del apartado Encuesta: rondas, lotes de invitaciones, enlaces, cierre y resultados de cada ronda.
/** @type {Readonly<Record<string,string>>} */
export const TEXTOS_PILOTO = {
  'panel.piloto.titulo': 'Enquesta de valoració',
  'panel.piloto.intro':
    'Cada ús de l’enquesta amb un grup és una ronda. A la ronda oberta, crea un lot d’invitacions per a cada entitat col·laboradora i envia-li els seus enllaços. Cada enllaç és per a una sola persona: amb ell fa el recorregut i respon una enquesta anònima en acabar.',
  'panel.piloto.consultar': 'Consultar l’enquesta',
  'panel.piloto.consulta-inicial': 'Consulta l’enquesta per veure’n els lots i poder crear invitacions.',
  'panel.piloto.consultando': 'S’està consultant l’enquesta…',
  'panel.piloto.consultada-abierta': 'La ronda {nombre} està oberta. Pots crear lots d’invitacions.',
  'panel.piloto.consultada-cerrada': 'La ronda {nombre} està tancada. Ja pots veure i baixar-ne els resultats.',
  'panel.piloto.nuevo-lote': 'Nou lot d’invitacions',
  'panel.piloto.nombre': 'Nom de l’entitat col·laboradora',
  'panel.piloto.nombre-ayuda': 'D’1 a 60 caràcters. Serveix per reconèixer el lot i posar nom al fitxer d’enllaços.',
  'panel.piloto.quien': 'Qui respondrà?',
  'panel.piloto.tipo.participante': 'Participants',
  'panel.piloto.tipo.profesional': 'Professionals d’orientació',
  'panel.piloto.cantidad': 'Quantes invitacions?',
  'panel.piloto.cantidad-ayuda':
    'Entre 3 i 200. Amb menys de 3, l’ús del lot deixaria veure si una persona concreta ha respost.',
  'panel.piloto.crear': 'Crear les invitacions',
  'panel.piloto.creando': 'S’estan creant les invitacions…',
  'panel.piloto.creado': 'S’han creat {cantidad} invitacions per a {nombre}. Els enllaços són a sota.',
  'panel.piloto.error.nombre':
    'Escriu el nom de l’entitat: d’1 a 60 caràcters, en una sola línia i sense tabuladors ni caràcters invisibles.',
  'panel.piloto.error.cantidad': 'Escriu un nombre enter d’invitacions entre {minimo} i {maximo}.',
  'panel.piloto.error.sin-conexion':
    'No hi ha connexió, així que no s’ha creat res. Comprova la connexió i torna-ho a provar.',
  'panel.piloto.enlaces.titulo': 'Enllaços per a {nombre} ({cantidad})',
  'panel.piloto.enlaces.aviso':
    'Aquests enllaços només es poden veure ara: Faro no els desa i desapareixen en sortir d’aquest apartat. Copia’ls o baixa’ls abans de continuar. Si es perden, crea un altre lot.',
  'panel.piloto.enlaces.encabezado': 'Enllaços per enviar',
  'panel.piloto.enlaces.lista': 'Enllaços, un per línia',
  'panel.piloto.copiar': 'Copiar tots els enllaços',
  'panel.piloto.descargar': 'Baixar els enllaços en un fitxer de text',
  'panel.piloto.olvidar': 'Amagar i oblidar els enllaços',
  'panel.piloto.olvidados': 'Els enllaços s’han retirat de la pantalla i no es poden tornar a veure.',
  'panel.piloto.copiados': 'Enllaços copiats. Enganxa’ls al correu per a l’entitat.',
  'panel.piloto.correo': 'Text del correu per a l’entitat',
  'panel.piloto.copiar-correo': 'Copiar el text del correu',
  'panel.piloto.correo-copiado': 'Text del correu copiat.',
  'panel.piloto.copia-manual': 'No s’ha pogut copiar automàticament. El text està seleccionat: copia’l amb el teclat.',
  'panel.piloto.correo.saludo': 'Hola, equip de {nombre}:',
  'panel.piloto.correo.participante':
    'Us enviem {cantidad} enllaços d’invitació per a la prova pilot de Faro. Cada enllaç és per a una sola persona: doneu-ne un a cada participant, sense anotar qui rep quin. Amb el seu enllaç, la persona fa el recorregut de Faro i, en acabar, respon unes poques preguntes.',
  'panel.piloto.correo.profesional':
    'Us enviem {cantidad} enllaços d’invitació per a professionals d’orientació de la prova pilot de Faro. Cada enllaç és per a una sola persona: doneu-ne un a cada professional, sense anotar qui rep quin. Amb el seu enllaç, respon unes poques preguntes sobre la sessió.',
  'panel.piloto.correo.anonimo':
    'L’enquesta és anònima: Faro no sap quin enllaç té cada persona ni desa qui respon. Cada enllaç serveix per respondre una sola vegada.',
  'panel.piloto.correo.contrasena':
    'Per entrar a Faro cal, a més, la contrasenya general del lloc, que us enviem per separat.',
  'panel.piloto.correo.enlaces': 'Els enllaços van a continuació, un per línia (o al fitxer adjunt):',
  'panel.piloto.correo.despedida': 'Gràcies per col·laborar.',
  'panel.piloto.lotes': 'Lots d’invitacions',
  'panel.piloto.sin-lotes': 'Encara no hi ha lots d’invitacions.',
  'panel.piloto.sin-nombre': 'Sense nom',
  'panel.piloto.columna.lote': 'Lot',
  'panel.piloto.columna.entidad': 'Entitat',
  'panel.piloto.columna.tipo': 'Per a',
  'panel.piloto.columna.emitidas': 'Emeses',
  'panel.piloto.columna.usadas': 'Utilitzades',
  'panel.piloto.columna.quedan': 'Sense utilitzar',
  'panel.piloto.abierta':
    'Mentre la ronda està oberta no es mostren respostes: comparar dues lectures seguides deixaria veure què ha respost una persona concreta. Els recomptes apareixen quan es tanca.',
  'panel.piloto.cerrar': 'Tancar la ronda',
  'panel.piloto.cerrar-ayuda':
    'Tanca-la quan el grup hagi acabat. És definitiu per a aquesta ronda: no es pot tornar a obrir, però després en pots obrir una altra.',
  'panel.piloto.confirmar-cierre':
    'Vols tancar la ronda {nombre}? És definitiu: no es podrà tornar a obrir ni crear-hi lots nous, i els enllaços que no s’hagin utilitzat deixaran de valer. Després podràs veure i baixar-ne els resultats i obrir una altra ronda.',
  'panel.piloto.cerrando': 'S’està tancant la ronda…',
  'panel.piloto.cerrada-ahora':
    'La ronda s’ha tancat. Els enllaços sense utilitzar ja no valen. Els resultats són a sota.',
  'panel.piloto.cerrada':
    'Aquesta ronda està tancada. Cada xifra diu quantes persones van triar aquesta resposta i sobre quantes es compta.',
  'panel.piloto.resultados.participante': 'Participants',
  'panel.piloto.resultados.profesional': 'Professionals d’orientació',
  'panel.piloto.respuestas': 'Respostes rebudes: {n}.',
  'panel.piloto.grupo-pequeno':
    'Només hi ha {n} respostes d’aquest grup. Amb tan poques, qui sàpiga qui va respondre podria deduir respostes concretes: comparteix-les amb cura.',
  'panel.piloto.recuento': '{valor}: {n} de {total} ({porcentaje} %)',
  'panel.piloto.recuento-sin-base': '{valor}: {n} de {total}',
  'panel.piloto.cuestionario': 'Qüestionari: {id}.',
  'panel.piloto.metas-referencia':
    'Les metes del pilot apareixen com a referència. Amb una mostra petita i triada per invitació, un resultat descriu qui ha respost i no es pot generalitzar.',
  'panel.piloto.media': 'Mitjana: {media} sobre 5, amb {n} respostes.',
  'panel.piloto.media-sin-respuestas': 'Mitjana: encara no hi ha respostes.',
  'panel.piloto.meta.media': 'Meta del pilot: una mitjana d’almenys {objetivo} sobre 5.',
  'panel.piloto.meta.proporcion':
    'Meta del pilot: almenys el {objetivo} %. Resultat: {favorables} de {base} ({porcentaje} %).',
  'panel.piloto.meta.proporcion-sin-base':
    'Meta del pilot: almenys el {objetivo} %. Encara no hi ha respostes que hi comptin.',
  'panel.piloto.meta.fuera':
    'Queden fora de la base perquè no van arribar a veure la proposta de formació: {n} de {total}.',
  'panel.piloto.csv.cuestionario': 'Qüestionari de l’enquesta',
  'panel.piloto.csv.media': 'Mitjana sobre 5 (suma de punts i respostes)',
  'panel.piloto.csv.meta-media': 'Meta del pilot: mitjana d’almenys {objetivo} sobre 5',
  'panel.piloto.csv.meta-proporcion': 'Meta del pilot: almenys el {objetivo} % de respostes favorables',
  'panel.piloto.csv.fuera': 'Fora de la base: no van arribar a veure la proposta de formació',
  'panel.piloto.error.cuestionario_anterior':
    'Aquesta instal·lació guarda respostes d’un qüestionari anterior, així que Faro no obre l’enquesta per no barrejar-les amb les del qüestionari actual. Torna a posar en marxa la versió de Faro que va recollir aquestes respostes, tanca-hi la ronda oberta i baixa’n els resultats; després, obre el qüestionari actual en una instal·lació nova. La guia de l’enquesta explica cada pas.',
  'panel.piloto.csv': 'Baixar els resultats (CSV)',
  'panel.piloto.archivo.enlaces': 'faro-invitacions',
  'panel.piloto.archivo.resultados': 'faro-resultats',
  'panel.piloto.csv.emitidas': 'Invitacions emeses',
  'panel.piloto.csv.usadas': 'Invitacions utilitzades',
  'panel.piloto.csv.respuestas': 'Respostes rebudes',
  'panel.piloto.error.lote_demasiado_pequeno':
    'Un lot necessita almenys 3 invitacions, perquè el seu ús no deixi veure si una persona concreta ha respost. Escriu un nombre més gran.',
  'panel.piloto.error.encuesta_cerrada':
    'No hi ha cap ronda oberta, així que no es poden crear lots nous. Obre una ronda nova per convidar un altre grup.',
  'panel.piloto.error.limite_lotes':
    'Aquesta ronda ja té 50 lots, el màxim. Si una entitat necessita més invitacions, avisa l’equip tècnic.',
  'panel.piloto.error.incierta':
    'No s’ha pogut confirmar l’operació. Consulta l’enquesta abans de repetir-la: si es va crear un lot, els seus enllaços ja no es poden veure i n’hauràs de crear un altre.',
  'panel.deshacer.boton': 'Desfer l’últim canvi',
  'panel.deshacer.cambiado':
    'La configuració ha canviat des del teu canvi, així que ja no es pot desfer. Revisa els valors actuals abans de tornar-los a canviar.',
  'panel.piloto.grupo-pequeno-uno':
    'Només hi ha 1 resposta d’aquest grup: qui sàpiga qui va respondre podria saber què va contestar. Comparteix-la amb cura.',
  'panel.piloto.csv.fecha': 'Baixat: {fecha}, hora de Catalunya',
  'panel.piloto.rondas': 'Rondes de l’enquesta',
  'panel.piloto.rondas-intro':
    'Cada ús de l’enquesta amb un grup és una ronda, amb les seves invitacions i els seus resultats. Només hi pot haver una ronda oberta alhora, i els resultats de cada ronda es poden consultar i baixar sempre.',
  'panel.piloto.columna.ronda': 'Ronda',
  'panel.piloto.columna.estado': 'Estat',
  'panel.piloto.columna.inicio': 'Obertura',
  'panel.piloto.columna.cierre': 'Tancament',
  'panel.piloto.columna.invitaciones': 'Invitacions',
  'panel.piloto.columna.respuestas': 'Respostes',
  'panel.piloto.columna.acciones': 'Resultats',
  'panel.piloto.ronda.abierta': 'Oberta',
  'panel.piloto.ronda.cerrada': 'Tancada',
  'panel.piloto.ronda.sin-fecha': 'Sense dada',
  'panel.piloto.ronda.ver': 'Veure {nombre}',
  'panel.piloto.ronda.nueva': 'Obrir una ronda nova',
  'panel.piloto.ronda.nombre': 'Nom de la ronda',
  'panel.piloto.ronda.nombre-ayuda': 'D’1 a 60 caràcters; per exemple, el grup o l’entitat amb què es fa.',
  'panel.piloto.ronda.abrir': 'Obrir la ronda',
  'panel.piloto.ronda.abriendo': 'S’està obrint la ronda…',
  'panel.piloto.ronda.abierta-ahora': 'S’ha obert la ronda {nombre}. Ja pots crear-ne els lots d’invitacions.',
  'panel.piloto.ronda.solo-cerrada': 'Per obrir una ronda nova, tanca abans la ronda oberta.',
  'panel.piloto.error.nombre-ronda':
    'Escriu el nom de la ronda: d’1 a 60 caràcters, en una sola línia i sense tabuladors ni caràcters invisibles.',
  'panel.piloto.error.ronda_abierta':
    'Ja hi ha una ronda oberta, així que no se n’ha obert cap altra. Tanca-la abans d’obrir la següent.',
  'panel.piloto.error.limite_rondas':
    'L’enquesta ja té 20 rondes, el màxim. Si en necessites una altra, avisa l’equip tècnic.',
  'panel.encuesta.visibilidad.titulo': 'Al web',
  'panel.encuesta.visibilidad.interruptor': 'Visible al web',
  'panel.encuesta.visibilidad.ayuda':
    'Oculta, la pàgina de l’enquesta es mostra com qualsevol secció tancada i el recorregut no l’ofereix. Les invitacions no es perden: quan la tornis a mostrar, els mateixos enllaços serviran.',
  'panel.encuesta.visibilidad.visible': 'L’enquesta és visible al web.',
  'panel.encuesta.visibilidad.oculta': 'L’enquesta està oculta al web.',
  'panel.encuesta.visibilidad.sin-dato': 'Sense dada: consulta les seccions per saber si l’enquesta és visible.',
  'panel.encuesta.ronda.titulo': 'Ronda en curs',
  'panel.encuesta.ronda.nombre': 'Nom',
  'panel.encuesta.ronda.estado': 'Estat',
  'panel.encuesta.ronda.invitaciones': 'Invitacions',
  'panel.encuesta.ronda.respuestas': 'Respostes',
  'panel.encuesta.ronda.abierta': 'Oberta',
  'panel.encuesta.ronda.cerrada': 'Tancada',
  'panel.encuesta.ronda.sin-dato': 'Sense dada',
};
