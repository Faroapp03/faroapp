// Textos de Guías y Biblioteca en catalán, incorporados al diccionario de ca.js.
// El tramo entre marcas lo genera `node herramientas/web/lecturas.ts` desde datos/lecturas.json.
// No se edita a mano ese tramo.

/**
 * Diccionario de solo lectura (clave -> texto) en catalán con los textos de Guías y Biblioteca.
 * @type {Readonly<Record<string, string>>}
 */
export const TEXTOS_LECTURAS = {
  // ---------- Guías y Biblioteca: lo escribe herramientas/web/lecturas.ts ----------
  'biblioteca.antetitulo': 'Lectures i informes',
  'biblioteca.aviso':
    'Selecció de l’Equip Faro, revisada el 7/10/2026. Cap d’aquestes entitats no ha revisat Faro ni l’avala. Els resums són nostres: davant de qualsevol dubte, val el document original.',
  'biblioteca.comprobado': 'Comprovat: {fecha}',
  'biblioteca.comprobado-con-incidencia':
    'Comprovat: {fecha}. A la darrera revisió, aquest enllaç no va respondre com s’esperava. Si no s’obre, cerca el document pel seu títol al web de la font.',
  'biblioteca.cuenta': 'Es mostren {vistas} de {total} lectures.',
  'biblioteca.descripcion':
    'Biblioteca de Faro: lectures breus i informes sobre la IA i la feina, cadascun amb la seva font, la seva data i un resum propi.',
  'biblioteca.enlace-incidencia':
    'A la darrera revisió, aquest enllaç no va respondre com s’esperava. Si no s’obre, cerca el document pel seu títol al web de la font.',
  'biblioteca.enlace-no-disponible': 'Enllaç no disponible',
  'biblioteca.entradilla': 'Lectures breus i informes sobre la IA i la feina, de fonts oficials i de recerca.',
  'biblioteca.filtrar-por': 'Filtrar per',
  'biblioteca.filtros': 'Filtra la biblioteca',
  'biblioteca.pagina': 'Pàgina {numero} de {total}',
  'biblioteca.paginas': 'Pàgines',
  'biblioteca.quitar-filtros': 'Treure els filtres',
  'biblioteca.recuento': '{total} lectures',
  'biblioteca.recuento-parcial': '{vistas} de {total} lectures',
  'biblioteca.segmentos': 'Apartats de la biblioteca',
  'biblioteca.tipos.guia': 'Guies',
  'biblioteca.tipos.nota': 'Notes',
  'biblioteca.titulo': 'Biblioteca · Faro',
  'biblioteca.todos': 'Tots',
  'guias.aviso':
    'Selecció de l’Equip Faro, revisada el 7/10/2026. Cap de les entitats citades no ha revisat Faro ni l’avala. Les guies donen informació general: no són assessorament jurídic.',
  'lecturas.abre.pagina-faro': 'Pàgina de Faro',
  'lecturas.adopcion-ia-empresas-espanolas-banco-espana.interes':
    'Dona la visió de les empreses, útil per contrastar-la amb la de les persones treballadores. Fa servir vocabulari econòmic.',
  'lecturas.adopcion-ia-empresas-espanolas-banco-espana.resumen':
    'Article del Butlletí Econòmic del Banc d’Espanya basat en la seva enquesta a empreses: gairebé el 20 % fa servir sistemes d’IA, la majoria encara en proves. El principal obstacle és la manca de personal qualificat, seguit dels costos i la manca de dades. El 80 % de les empreses creu que la IA no afectarà la seva ocupació. En castellà.',
  'lecturas.adopcion-ia-empresas-espanolas-banco-espana.titulo':
    'Com adopten la IA les empreses espanyoles (Banc d’Espanya, 2025)',
  'lecturas.anonimitzar-actes-amb-ia-aoc.interes':
    'Mostra com pot canviar una tasca administrativa real i per què l’última decisió continua sent d’una persona. És una prova de la mateixa entitat, no una avaluació independent.',
  'lecturas.anonimitzar-actes-amb-ia-aoc.resumen':
    'El Consorci AOC explica una prova d’IA generativa que proposa quines dades personals cal amagar a les actes dels plens municipals, tenint en compte el context. Una persona revisa i corregeix la proposta abans de publicar. En 52 actes de 9 ajuntaments, el 96 % del que va marcar estava ben marcat.',
  'lecturas.anonimitzar-actes-amb-ia-aoc.titulo':
    'IA per amagar dades personals a les actes municipals, amb revisió humana',
  'lecturas.barometre-de-la-innovacio-a.interes': 'Indica cap on es mouen les empreses del teu entorn.',
  'lecturas.barometre-de-la-innovacio-a.resumen':
    'Enquesta d’ACCIÓ, l’agència de la Generalitat per a la competitivitat de l’empresa, sobre innovació i transformació digital de les empreses catalanes. El 30,4 % de les empreses de més de nou persones treballadores va invertir en IA el 2025, davant del 24,0 % el 2024.',
  'lecturas.bones-practiques-xatbot-ia-generativa-aoc.interes':
    'Mostra quins controls hauria de tenir un xatbot d’atenció a la ciutadania. Està escrita per a qui l’implanta i fa servir termes tècnics.',
  'lecturas.bones-practiques-xatbot-ia-generativa-aoc.resumen':
    'Guia del Consorci Administració Oberta de Catalunya (AOC) per a administracions que volen un xatbot d’atenció: triar la solució, complir els requisits, dissenyar-lo, protegir-lo, entrenar-lo i avaluar-lo. Es basa en l’experiència de la mateixa entitat.',
  'lecturas.bones-practiques-xatbot-ia-generativa-aoc.titulo':
    'Bones pràctiques per posar en marxa un xatbot amb IA generativa',
  'lecturas.brecha-digital-genero-ontsi-2026.interes':
    'Dona les dades oficials de la bretxa digital per gènere i per edat: entre les persones de 75 anys o més, les dones que no han fet servir mai internet són el 53 %. És una bretxa d’ús, no de capacitat. Les pàgines 2 i 3 resumeixen el principal.',
  'lecturas.brecha-digital-genero-ontsi-2026.resumen':
    'Informe de l’Observatorio Nacional de Tecnología y Sociedad (ONTSI) que compara dones i homes en l’ús d’internet, les competències digitals, els estudis, l’ocupació i la seguretat, amb dades del 2025. El 39,9 % dels homes i el 35,9 % de les dones van fer servir IA generativa en els tres últims mesos, i elles són més prudents davant dels seus riscos. Les dones són el 19,6 % de les persones especialistes digitals. En castellà.',
  'lecturas.brecha-digital-genero-ontsi-2026.titulo': 'Bretxa digital de gènere a Espanya (ONTSI, edició 2026)',
  'lecturas.brecha-digital-ia-resumen-ugt.interes':
    'Mostra que l’edat, els estudis i el gènere pesen en qui aprèn a fer servir la IA. És l’entrada curta a l’informe complet del sindicat.',
  'lecturas.brecha-digital-ia-resumen-ugt.resumen':
    'Resum executiu de l’informe del Servei d’Estudis d’UGT sobre bretxa digital i IA. Amb dades de l’INE, el 37,9 % de la població fa servir IA generativa i més de 23 milions de persones no la fan servir. Entre qui no la fa servir, el 55,5 % són dones i l’edat mitjana és de 56 anys; la diferència per nivell d’estudis supera els 50 punts. En castellà.',
  'lecturas.brecha-digital-ia-resumen-ugt.titulo': 'Qui es queda fora de la IA: resum de l’informe d’UGT',
  'lecturas.chatbots-demasiada-confianza-cuando-se-equivocan.interes':
    'Recorda que una resposta dita amb seguretat no és una resposta comprovada. Són versions del 2025: les xifres no valen per a totes les eines actuals.',
  'lecturas.chatbots-demasiada-confianza-cuando-se-equivocan.resumen':
    'Notícia sobre un estudi de la Universitat Carnegie Mellon (Estats Units) que va comparar persones i quatre models de llenguatge en tasques com preguntes de cultura general. Tots van sobreestimar els seus encerts, però només les persones van corregir la seva confiança després d’equivocar-se. En castellà.',
  'lecturas.chatbots-demasiada-confianza-cuando-se-equivocan.titulo': 'Els xatbots s’equivoquen amb massa seguretat',
  'lecturas.como-implanta-algoritmos-un-ayuntamiento.interes':
    'Ensenya quines garanties haurien d’acompanyar l’ús públic d’algorismes.',
  'lecturas.como-implanta-algoritmos-un-ayuntamiento.resumen':
    'Protocol de l’Ajuntament de Barcelona que recorre, pas a pas, la vida d’un sistema algorítmic municipal, de la idea a la seva retirada: avaluació d’impacte, transparència, contractació, qualitat de les dades i supervisió. És del 2022, anterior a la llei europea d’IA.',
  'lecturas.como-implanta-algoritmos-un-ayuntamiento.titulo':
    'Com implanta algorismes un ajuntament: mètode i protocols',
  'lecturas.consells-ciberseguretat-gent-gran.interes':
    'És un bon punt de partida si et costa moure’t per internet o si vols ajudar una persona gran del teu entorn.',
  'lecturas.consells-ciberseguretat-gent-gran.resumen':
    'Pàgina de l’Agència de Ciberseguretat de Catalunya amb consells per a la gent gran: no donar dades personals per telèfon ni per internet, fer servir contrasenyes fortes, comprar amb seguretat, configurar el mòbil i detectar notícies falses i imatges creades amb IA. Inclou infografies i vídeos curts. Anomena alguns serveis comercials.',
  'lecturas.consells-ciberseguretat-gent-gran.titulo': 'Consells de seguretat digital per a la gent gran',
  'lecturas.dades-compartides-ia-agencia-ciberseguretat.interes':
    'Et dona quatre gestos senzills per protegir les teves dades quan fas servir un xatbot. Repeteix part del decàleg de l’AEPD, però hi afegeix el control de permisos i de l’historial.',
  'lecturas.dades-compartides-ia-agencia-ciberseguretat.resumen':
    'Pàgina de l’Agència de Ciberseguretat de Catalunya: explica quines dades recullen les aplicacions d’IA (personals, d’ubicació, el que escrius i puges, dades tècniques) i els seus riscos, com perfils, filtracions o suplantació. Acaba amb quatre consells: no compartir dades personals, valorar desactivar l’historial, revisar el que ja has compartit i controlar els permisos de les aplicacions.',
  'lecturas.dades-compartides-ia-agencia-ciberseguretat.titulo': 'Quines dades guarda la IA i com protegir-les',
  'lecturas.de-los-chatbots-a-las.interes':
    'Ajuda a valorar una eina nova per com canvia les teves condicions de treball.',
  'lecturas.de-los-chatbots-a-las.resumen':
    'Resumeix una revisió d’estudis sobre la IA a la feina: usos que prevenen riscos i problemes com la vigilància, l’opacitat o la manca de formació.',
  'lecturas.de-los-chatbots-a-las.titulo': 'Dels xatbots a les cadenes de muntatge: IA i seguretat laboral',
  'lecturas.derecho-revision-humana-decisiones-automatizadas.interes':
    'Et diu quan pots demanar que intervingui una persona, donar el teu punt de vista i impugnar la decisió. És del 2024, anterior al Reial decret 723/2026.',
  'lecturas.derecho-revision-humana-decisiones-automatizadas.resumen':
    'Pàgina de l’AEPD sobre el dret a no ser objecte de decisions basades només en un tractament automàtic de les teves dades, inclosos els perfils, quan t’afecten de manera important; cita com a exemple el rendiment a la feina. Explica les excepcions i enllaça un formulari per exercir-lo. En castellà.',
  'lecturas.derecho-revision-humana-decisiones-automatizadas.titulo':
    'El teu dret que una persona revisi una decisió automàtica',
  'lecturas.detectar-noticies-falses-agencia-ciberseguretat.interes':
    'Et dona una rutina curta per comprovar una notícia abans de compartir-la.',
  'lecturas.detectar-noticies-falses-agencia-ciberseguretat.resumen':
    'Pàgina de l’Agència de Ciberseguretat de Catalunya sobre la desinformació: per què costa detectar-la i cinc passos per comprovar una notícia, com mirar la font, llegir el text sencer, buscar altres fonts i fixar-se en imatges que poden estar manipulades amb IA. Cita extensions comercials del navegador com a exemple.',
  'lecturas.detectar-noticies-falses-agencia-ciberseguretat.titulo': 'Com detectar una notícia falsa',
  'lecturas.detectar-sesgos-respuestas-ia-ehu.interes':
    'Et dona preguntes concretes per revisar una resposta de la IA abans de fer-la servir, per exemple en una oferta de feina. No tracta només els biaixos de gènere.',
  'lecturas.detectar-sesgos-respuestas-ia-ehu.resumen':
    'Pàgina de la UPV/EHU amb estratègies senzilles per reconèixer biaixos: fixar-se si els exemples repeteixen sempre el mateix perfil de gènere, edat o cultura, buscar estereotips en els papers professionals, demanar la mateixa resposta des d’altres perspectives i comparar diverses respostes. En castellà.',
  'lecturas.detectar-sesgos-respuestas-ia-ehu.titulo': 'Com detectar biaixos en les respostes de la IA',
  'lecturas.detectar-y-reducir-alucinaciones-ia.interes':
    'T’ajuda a no refiar-te d’una resposta només perquè sona convincent. Els exemples són de la universitat, però serveixen per a qualsevol feina.',
  'lecturas.detectar-y-reducir-alucinaciones-ia.resumen':
    'La Universitat del País Basc (UPV/EHU) explica que la IA pot escriure amb seguretat una cosa falsa, el que s’anomena «al·lucinació». Dona senyals per sospitar-ne, com xifres molt precises sense font o respostes que canvien quan repeteixes la pregunta, i set hàbits, com demanar-li que no s’inventi res i comprovar a mà el que és important. En castellà.',
  'lecturas.detectar-y-reducir-alucinaciones-ia.titulo': 'Com detectar i reduir els errors inventats de la IA',
  'lecturas.dones-en-les-tic-2025.interes':
    'Dona les dades de Catalunya sobre la bretxa de gènere en l’ús de la IA. L’apartat d’IA és a les pàgines 17 a 19.',
  'lecturas.dones-en-les-tic-2025.resumen':
    'Dossier estadístic de l’Institut Català de les Dones sobre dones i tecnologia a Catalunya: ús d’internet, formació, ocupació, recerca i ciberseguretat. El 2025 va fer servir la IA generativa el 49 % dels homes i el 42,9 % de les dones de 16 a 74 anys; entre qui no la fa servir, a elles els preocupen més la privadesa i la seguretat.',
  'lecturas.dones-en-les-tic-2025.titulo': 'Dones en les TIC 2025: dades de Catalunya',
  'lecturas.en-esta-pestana': 'en aquesta pestanya',
  'lecturas.en-otra-pestana': 'en una altra pestanya',
  'lecturas.estafas-fraudes-financieros-ia-autoridades-europeas.interes':
    'És una llista pràctica per reconèixer un frau fet amb IA, fins i tot si sembla que ve del teu banc o d’algú que coneixes. Se centra en els diners, no en la feina.',
  'lecturas.estafas-fraudes-financieros-ia-autoridades-europeas.resumen':
    'Fullet de les tres autoritats financeres europees (bancària, d’assegurances i de valors), que publica en castellà la Comissió Nacional del Mercat de Valors (CNMV). Dona una llista de senyals d’alerta, com veus o vídeos falsos i presses per pagar, passos per protegir-te, com verificar per un canal conegut o acordar una paraula de seguretat a la família, i què fer si ja t’han estafat. En castellà.',
  'lecturas.estafas-fraudes-financieros-ia-autoridades-europeas.titulo':
    'Estafes financeres amb IA: senyals d’alerta i com protegir-te',
  'lecturas.estafes-amb-intelligencia-artificial-consells.interes':
    'Serveix per reconèixer una trucada o un vídeo fals que demana diners o dades, també si sembla que ve d’algú de la teva empresa.',
  'lecturas.estafes-amb-intelligencia-artificial-consells.resumen':
    'L’Agència de Ciberseguretat de Catalunya explica com es fa servir la IA per estafar: veus i vídeos falsos, missatges personalitzats amb dades de les xarxes socials i identitats inventades. Dona consells com desconfiar de les presses, comprovar-ho per una altra via amb la persona implicada i no compartir dades biomètriques.',
  'lecturas.estafes-amb-intelligencia-artificial-consells.titulo':
    'Estafes amb intel·ligència artificial: com evitar-les',
  'lecturas.estereotipos-de-genero-en-los.interes':
    'Mostra que els models de llenguatge poden repetir estereotips de gènere en els textos que escriuen. L’estudi va fer servir models anteriors al 2024; els actuals es poden comportar d’una altra manera.',
  'lecturas.estereotipos-de-genero-en-los.resumen':
    'Comunicat de la UNESCO (7/3/2024) sobre el seu estudi de diversos models de llenguatge: va trobar que associaven les dones amb paraules com «llar» i «família», i els homes amb «negocis», «salari» o «carrera». En castellà; l’informe complet és en anglès.',
  'lecturas.estereotipos-de-genero-en-los.titulo': 'Estereotips de gènere en els models de llenguatge',
  'lecturas.eurobarometro-ia-lugar-de-trabajo.interes':
    'Mostra que molta gent accepta la IA a la feina, però demana regles clares. Són opinions, no dades sobre el seu ús real.',
  'lecturas.eurobarometro-ia-lugar-de-trabajo.resumen':
    'Nota de premsa de la Comissió Europea amb els resultats d’una enquesta Eurobaròmetre del 2025: més del 60 % de les persones a Europa veu amb bons ulls els robots i la IA a la feina, i el 84 % creu que cal gestionar-la amb cura per protegir la privacitat i ser transparents. En castellà.',
  'lecturas.eurobarometro-ia-lugar-de-trabajo.titulo':
    'Què opina la gent a Europa de la IA a la feina (Eurobaròmetre 2025)',
  'lecturas.formato.web': 'Pàgina web',
  'lecturas.gestionar-personas-con-ia-oit.interes':
    'T’ajuda a preguntar què mesura de debò un filtre de candidatures o una avaluació automàtica.',
  'lecturas.gestionar-personas-con-ia-oit.resumen':
    'Article d’una economista de l’OIT sobre la IA en recursos humans: contractació, sous, horaris i avaluació de l’acompliment. Explica que un sistema funciona bé o malament segons el seu objectiu, les dades amb què aprèn i com està programat, i dona exemples de proves de selecció que mesuren coses dubtoses. En castellà.',
  'lecturas.gestionar-personas-con-ia-oit.titulo': 'Gestionar persones amb IA: funciona de debò?',
  'lecturas.guia-practica-ejemplos-reglamento-ia-aesia.interes':
    'Els exemples acosten la llei a situacions de feina reals. Complementa la introducció de la mateixa agència.',
  'lecturas.guia-practica-ejemplos-reglamento-ia-aesia.resumen':
    'Guia de l’Agència Espanyola de Supervisió de la Intel·ligència Artificial (AESIA) per a empreses que comencen a conèixer el Reglament d’IA. Explica les obligacions amb exemples, com un sistema d’identificació biomètrica a la feina. Està actualitzada després de l’Òmnibus Digital i no és vinculant. En castellà.',
  'lecturas.guia-practica-ejemplos-reglamento-ia-aesia.titulo': 'La llei europea d’IA amb exemples pràctics',
  'lecturas.guia-uso-seguro-ia-cyberzaintza.interes':
    'Serveix si al teu equip cal decidir com es fa servir la IA. Està pensada sobretot per a organitzacions, però cada pas porta precaucions que també serveixen a qui la fa servir cada dia.',
  'lecturas.guia-uso-seguro-ia-cyberzaintza.resumen':
    'Guia del Centre Basc de Ciberseguretat amb cinc passos per fer servir la IA de manera segura: regular-ne l’ús, inventariar els casos, analitzar els riscos, controlar l’ús i avaluar els resultats. Avisa de riscos com posar dades personals o confidencials en eines no autoritzades, les respostes inventades i els biaixos. Declara que es va escriure en part amb ajuda d’IA i que el centre la va revisar. En castellà.',
  'lecturas.guia-uso-seguro-ia-cyberzaintza.titulo': 'Fer servir la IA amb seguretat: cinc passos',
  'lecturas.ia-brechas-genero-empleo-bie.interes':
    'Recorda que la representació legal de la plantilla té dret a conèixer els criteris dels algorismes (article 64.4.d de l’Estatut dels treballadors). Les recomanacions s’adrecen a empreses i administracions.',
  'lecturas.ia-brechas-genero-empleo-bie.resumen':
    'Butlletí d’Igualtat en l’Ocupació del Ministeri d’Igualtat: revisa com la IA pot ampliar o reduir les desigualtats entre dones i homes a la feina, per exemple en la selecció i l’avaluació. Repassa la normativa i recomana avaluar l’impacte de gènere abans de fer servir un sistema, auditar els algorismes i formar en igualtat. En castellà.',
  'lecturas.ia-brechas-genero-empleo-bie.titulo': 'Com afecta la IA les bretxes de gènere en l’ocupació',
  'lecturas.ia-empleo-personas-con-discapacidad-oit.interes':
    'Mostra quan una eina és un suport i quan pot crear una barrera nova. S’adreça sobretot a qui desenvolupa, compra o regula aquestes eines.',
  'lecturas.ia-empleo-personas-con-discapacidad-oit.resumen':
    'Article de l’OIT: eines com passar text a veu o subtitular en temps real ajuden moltes persones amb discapacitat, però els sistemes que filtren candidatures les poden excloure, per exemple si penalitzen cares o maneres de parlar «no estàndard». Demana incloure-les en el disseny de les eines i una revisió humana real de les decisions. En castellà.',
  'lecturas.ia-empleo-personas-con-discapacidad-oit.titulo':
    'La doble cara de la IA per a l’ocupació de les persones amb discapacitat',
  'lecturas.ia-en-la-seleccion-de.interes':
    'Ajuda a preguntar pels filtres automàtics que es fan servir per contractar o promocionar.',
  'lecturas.ia-en-la-seleccion-de.resumen':
    'Especialistes de la UOC expliquen com les dades i els criteris d’un filtre automàtic poden repetir desigualtats entre dones i homes, i quines garanties proposen.',
  'lecturas.ia-en-la-seleccion-de.titulo': 'IA en la selecció de personal i discriminació de gènere',
  'lecturas.ia-generativa-empleo-oit-2025.interes':
    'Explica com es mesura l’exposició i els seus límits: la mateixa OIT diu que busca la direcció del canvi, no xifres exactes.',
  'lecturas.ia-generativa-empleo-oit-2025.resumen':
    'Nota de recerca de l’OIT, en castellà, que resumeix l’actualització del seu índex d’exposició a la IA generativa: una de cada quatre persones ocupades al món té una feina amb algun grau d’exposició, però la majoria dels llocs es transformaran més que no pas desapareixeran, perquè continuen necessitant persones. L’exposició és més gran en l’ocupació de les dones.',
  'lecturas.ia-generativa-empleo-oit-2025.titulo': 'IA generativa i ocupació: l’actualització del 2025 de l’OIT',
  'lecturas.ia-gestion-trabajadores-salud-eu-osha.interes':
    'Dona arguments per demanar participació i prevenció quan arriba a la teva feina un sistema que organitza o controla les teves tasques. Són 24 pàgines de llenguatge tècnic.',
  'lecturas.ia-gestion-trabajadores-salud-eu-osha.resumen':
    'Resum en castellà d’un informe de l’Agència Europea per a la Seguretat i la Salut en el Treball (EU-OSHA). Els sistemes d’IA que assignen tasques, vigilen o avaluen el personal poden ajudar a controlar perills, però porten riscos, sobretot psicosocials. Proposa dissenyar-los amb les persones treballadores, amb transparència i per donar-los suport, no per substituir-les.',
  'lecturas.ia-gestion-trabajadores-salud-eu-osha.titulo':
    'IA per gestionar personal: riscos per a la salut i la seguretat a la feina',
  'lecturas.ia-homogeniza-lenguaje-sinc.interes':
    'Convida a revisar el que la IA reescriu per tu, perquè pot treure trets propis al teu text. Els autors avisen que això pot afectar les avaluacions basades en el llenguatge, també en la selecció de personal. Fa servir termes tècnics.',
  'lecturas.ia-homogeniza-lenguaje-sinc.resumen':
    'Notícia sobre un estudi de la Universitat del Sud de Califòrnia (Estats Units): va analitzar més de 880.000 textos i va demanar a tres models de llenguatge que en reescrivissin milers. Els textos reescrits conservaven gairebé sempre el significat, però perdien diferències d’estil entre persones. En castellà.',
  'lecturas.ia-homogeniza-lenguaje-sinc.titulo': 'Escriure amb IA fa que els textos s’assemblin més entre si',
  'lecturas.ia-hospitales-limites-lectura-facil.interes':
    'És una lectura molt curta i senzilla sobre una idea clau: la IA ajuda, però una persona n’ha de revisar la feina.',
  'lecturas.ia-hospitales-limites-lectura-facil.resumen':
    'Notícia en lectura fàcil de Planeta Fácil, de Plena inclusión, amb glossari (en castellà): alguns hospitals fan servir programes d’IA per revisar proves o valorar riscos abans d’una operació, però els metges han de revisar sempre el que diuen. És un resum d’una notícia de La Vanguardia.',
  'lecturas.ia-hospitales-limites-lectura-facil.titulo': 'La IA ajuda als hospitals, però té límits (lectura fàcil)',
  'lecturas.ia-mercado-trabajo-espana-funcas.interes':
    'És una estimació espanyola recent que explica els seus supòsits i els seus límits. No és una predicció sobre cap feina concreta: els paràmetres són supòsits presos d’altres estudis.',
  'lecturas.ia-mercado-trabajo-espana-funcas.resumen':
    'Document de treball de Funcas, fundació d’estudis econòmics, que adapta un índex internacional d’exposició a les ocupacions espanyoles. El seu model estima, a deu anys, una destrucció bruta d’1,7 a 2,3 milions de llocs de treball amb una incertesa que el mateix autor qualifica de «molt elevada», compensada en part per noves ocupacions i per la millora de productivitat d’entre 2,8 i 3,5 milions de persones. En castellà.',
  'lecturas.ia-mercado-trabajo-espana-funcas.titulo':
    'IA i mercat de treball a Espanya: exposició, ocupació i empreses',
  'lecturas.ia-mujeres-en-cifras-inmujeres-2026.interes':
    'Reuneix en una pàgina com fan servir i veuen la IA dones i homes. Les dades són de fonts i anys diferents (del 2019 al 2023) i no coincideixen amb les de l’INE del 2025: no les barregis. És una imatge, i els lectors de pantalla no en llegeixen el text.',
  'lecturas.ia-mujeres-en-cifras-inmujeres-2026.resumen':
    'Infografia de l’Instituto de las Mujeres amb dades de diverses fonts sobre la bretxa de gènere en la IA. El 2023, el 42,1 % de la població a Espanya havia fet servir IA: el 38,6 % de les dones i el 45,9 % dels homes. Les dones són el 19,5 % de les persones especialistes digitals i associen més la IA amb l’atur (27,8 % davant del 19,0 %). En castellà.',
  'lecturas.ia-mujeres-en-cifras-inmujeres-2026.titulo': 'Dones i intel·ligència artificial, en xifres (2026)',
  'lecturas.ia-necessita-bones-dades-aoc.interes':
    'Explica per què ordenar i revisar registres forma part de fer servir bé la IA en una oficina. Fa servir termes tècnics com «metadades» o «dades mestres».',
  'lecturas.ia-necessita-bones-dades-aoc.resumen':
    'Article del Consorci AOC per a ajuntaments: abans de fer servir IA cal saber quin problema es vol resoldre i quines dades es tenen. Explica com unes dades incompletes o mal descrites porten a resultats equivocats i per què la supervisió humana és una garantia, no un tràmit. En part presenta iniciatives de la Diputació de Barcelona i del mateix AOC.',
  'lecturas.ia-necessita-bones-dades-aoc.titulo': 'La IA necessita bones dades, no només bons algorismes',
  'lecturas.ia-seleccion-personal-sesgos-genero.interes':
    'Està escrita per a empreses, però les seves claus et serveixen per saber si un procés de selecció amb IA té en compte la igualtat, tant si busques feina com si representes la plantilla.',
  'lecturas.ia-seleccion-personal-sesgos-genero.resumen':
    'Full de recomanacions de la Fundación Mujeres per a empreses que fan servir IA per seleccionar personal, en tres moments: abans (triar l’eina, revisar les dades i informar la representació legal i les candidatures), durant (mantenir la supervisió humana) i després (comparar els resultats de dones i homes i corregir les diferències injustificades). En castellà.',
  'lecturas.ia-seleccion-personal-sesgos-genero.titulo':
    'IA i selecció de personal: claus per evitar els biaixos de gènere',
  'lecturas.ideas-equivocadas-sobre-la-ia.interes':
    'Ajuda a entendre com pensa un regulador de protecció de dades sobre la IA generativa. No és una guia per a qui la fa servir.',
  'lecturas.ideas-equivocadas-sobre-la-ia.resumen':
    'Entrada del blog de l’AEPD (11/3/2025) que tradueix set aclariments del regulador britànic de protecció de dades sobre la IA generativa; per exemple, que tractar dades «sense voler» continua sent tractar-les. Va adreçada a qui desenvolupa aquests sistemes. En castellà.',
  'lecturas.ideas-equivocadas-sobre-la-ia.titulo': 'Idees equivocades sobre la IA i les dades personals',
  'lecturas.idiomas.ca': 'Català',
  'lecturas.idiomas.es': 'Castellà',
  'lecturas.idiomas.es-ca': 'Castellà i català',
  'lecturas.impacte-ia-generativa-mercat-laboral-cambra.interes':
    'És l’estudi que millor descriu les ocupacions administratives a Catalunya. El seu indicador mesura el potencial de transformació, no el risc de perdre la feina.',
  'lecturas.impacte-ia-generativa-mercat-laboral-cambra.resumen':
    'Estudi de l’Observatori Dona, Empresa i Economia de la Cambra de Comerç de Barcelona. Mesura, amb dades del Cens i el mètode de l’OIT, l’exposició de 163 ocupacions de Catalunya a la IA generativa. Les més exposades es concentren en tasques administratives i de gestió de la informació, amb molta presència de dones. Analitza també la contractació i els acomiadaments col·lectius entre el 2023 i el 2025.',
  'lecturas.impacte-ia-generativa-mercat-laboral-cambra.titulo':
    'L’impacte de la IA generativa en el mercat laboral català, amb perspectiva de gènere i edat',
  'lecturas.impacte-ia-mercat-laboral-presentacio-cambra.interes':
    'És l’entrada curta a l’estudi, amb frases breus i gràfics. L’exposició mesura quant poden canviar les tasques, no el risc de perdre la feina; les dades del Cens són anteriors a l’arribada de la IA generativa.',
  'lecturas.impacte-ia-mercat-laboral-presentacio-cambra.resumen':
    'Presentació dels resultats de l’estudi de la Cambra de Comerç de Barcelona (maig del 2026). Amb dades del Cens del 2021-2022 i el mètode de l’OIT, el 26 % de les persones ocupades a Catalunya té una exposició mitjana o alta a la IA generativa: el 30 % de les dones i el 23 % dels homes. Les ocupacions més exposades són administratives i d’atenció al públic, amb molta presència de dones.',
  'lecturas.impacte-ia-mercat-laboral-presentacio-cambra.titulo':
    'La IA generativa i l’ocupació a Catalunya, per gènere i edat: els resultats',
  'lecturas.impacto-socioeconomico-laboral-cambio-tecnologico-ces.interes':
    'És una anàlisi llarga i en castellà que reuneix diversos punts de vista. Convé llegir només els apartats que t’interessin.',
  'lecturas.impacto-socioeconomico-laboral-cambio-tecnologico-ces.resumen':
    'Document del Consell Econòmic i Social d’Espanya (CES), òrgan en què participen sindicats, organitzacions empresarials i altres entitats. Analitza els efectes de la IA en l’economia, l’ocupació, el diàleg social i la negociació col·lectiva i la protecció social, amb un apartat sobre els biaixos de gènere. En castellà.',
  'lecturas.impacto-socioeconomico-laboral-cambio-tecnologico-ces.titulo':
    'L’impacte econòmic, laboral i social de la IA (CES, 2025)',
  'lecturas.indicadores-uso-ia-espana-ontsi-2026.interes':
    'Aplega en un document les dades oficials sobre empreses i persones, amb comparacions internacionals. Té moltes taules i gràfics; les pàgines 4 i 5 en resumeixen el principal.',
  'lecturas.indicadores-uso-ia-espana-ontsi-2026.resumen':
    'Informe de l’Observatori Nacional de Tecnologia i Societat (ONTSI) amb dades del 2025: el 20,5 % de les empreses de 10 o més persones ocupades fa servir IA, per sobre de la mitjana de la Unió Europea i de l’OCDE, i el 55,2 % de qui fa servir internet ha fet servir IA generativa. Recull també què opina la ciutadania del seu impacte. En castellà.',
  'lecturas.indicadores-uso-ia-espana-ontsi-2026.titulo':
    'Indicadors d’ús de la intel·ligència artificial a Espanya (2026)',
  'lecturas.ine-uso-ia-empresas-2025.interes':
    'Dona una idea de quantes empreses han començat a fer servir IA. Parla d’empreses, no de quantes persones la fan servir al seu lloc de treball.',
  'lecturas.ine-uso-ia-empresas-2025.resumen':
    'Principals resultats de l’enquesta de l’INE a empreses, publicats a la seva secció de premsa: el primer trimestre del 2025, el 21,1 % de les empreses de 10 o més persones ocupades feia servir intel·ligència artificial, 8,7 punts més que un any abans. El sector serveis és el que més la fa servir. Madrid, Catalunya i el País Basc tenen el major ús de tecnologies digitals. En castellà.',
  'lecturas.ine-uso-ia-empresas-2025.titulo': 'Quantes empreses fan servir IA a Espanya (INE, 2025)',
  'lecturas.ine-uso-tic-hogares-2025.interes':
    'És la xifra oficial més recent d’ús de la IA a Espanya, amb la diferència entre dones i homes. Mesura si es fa servir, no com de bé.',
  'lecturas.ine-uso-tic-hogares-2025.resumen':
    'Principals resultats de l’enquesta de l’Institut Nacional d’Estadística (INE) del 2025, publicats a la seva secció de premsa: el 37,9 % de les persones de 16 a 74 anys va fer servir eines d’IA generativa en els tres últims mesos; el 39,9 % dels homes i el 35,9 % de les dones. També dona l’ús d’internet i les habilitats digitals. En castellà.',
  'lecturas.ine-uso-tic-hogares-2025.titulo': 'Quanta gent fa servir la IA generativa a Espanya (INE, 2025)',
  'lecturas.informacion-algoritmica-en-el-trabajo.interes':
    'Et dona preguntes concretes quan un algorisme influeix en els teus horaris, el sou o l’avaluació.',
  'lecturas.informacion-algoritmica-en-el-trabajo.resumen':
    'Quina informació sobre els algorismes de l’empresa pot demanar la representació de la plantilla, amb una llista de preguntes per fer-ho. És anterior a la llei europea d’IA.',
  'lecturas.informacion-algoritmica-en-el-trabajo.titulo': 'Informació algorítmica a la feina: guia i eina',
  'lecturas.inteligencia-artificial-genero-trabajo-uclm.interes':
    'Analitza amb perspectiva de gènere què passa quan un algorisme organitza o avalua la feina. És un text acadèmic i llarg.',
  'lecturas.inteligencia-artificial-genero-trabajo-uclm.resumen':
    'Article jurídic d’una catedràtica de Dret del Treball de la Universitat de Castella-la Manxa (UCLM). Explica per què els algorismes poden repetir la discriminació de les dones (dades desiguals i equips sobretot masculins) i quins efectes té la gestió de la feina amb algorismes: avaluacions esbiaixades, control estricte i més dificultat per conciliar. En castellà.',
  'lecturas.inteligencia-artificial-genero-trabajo-uclm.titulo': 'Intel·ligència artificial, gènere i treball',
  'lecturas.interes': 'Per què et pot interessar.',
  'lecturas.intervencion-sindical-en-la-gestion.interes':
    'Està escrita per a qui representa la plantilla: dona senyals i models de petició per quan l’empresa fa servir algorismes. És llarga i jurídica.',
  'lecturas.intervencion-sindical-en-la-gestion.resumen':
    'Guia de CCOO per a la representació sindical: explica què és la gestió algorítmica, com pot discriminar i què diuen les normes europees i espanyoles. Té una part pràctica amb senyals per saber si l’empresa fa servir IA i models d’escrit per demanar-li informació. Edició actualitzada l’abril del 2026. En castellà.',
  'lecturas.intervencion-sindical-en-la-gestion.titulo':
    'Intervenció sindical en la gestió algorítmica (edició del 2026)',
  'lecturas.introduccion-ia-lectura-facil-plena-inclusion.interes':
    'Està en lectura fàcil: frases curtes, paraules senzilles i definicions al marge. Quan parla de pèrdua de feina, tingues en compte que els estudis mesuren tasques exposades, no llocs que hagin de desaparèixer.',
  'lecturas.introduccion-ia-lectura-facil-plena-inclusion.resumen':
    'Manual en lectura fàcil (en castellà), amb frases curtes i paraules explicades. Explica què és la IA, per a què serveix, que també s’equivoca, els avantatges i els inconvenients, qui ha de decidir i com demanar-li coses. Anomena programes comercials com a exemples.',
  'lecturas.introduccion-ia-lectura-facil-plena-inclusion.titulo':
    'Introducció a la intel·ligència artificial, en lectura fàcil',
  'lecturas.la-estrategia-de-barcelona-para.interes':
    'Explica què pot exigir la ciutadania a una institució que fa servir IA.',
  'lecturas.la-estrategia-de-barcelona-para.resumen':
    'Mesura de govern de l’Ajuntament de Barcelona (abril del 2021) que fixa com introduir algorismes amb garanties: drets digitals, transparència i participació. Inclou casos pilot i recomanacions tècniques. És anterior a la llei europea d’IA i a l’arribada de la IA generativa.',
  'lecturas.la-estrategia-de-barcelona-para.titulo': 'L’estratègia de Barcelona per a una IA municipal ètica',
  'lecturas.la-exposicion-a-la-ia-2.interes': 'Aplica a Espanya el mètode de l’OIT amb dades obertes, en castellà.',
  'lecturas.la-exposicion-a-la-ia-2.resumen':
    'Butlletí trimestral de Fedea i BBVA Research (setembre del 2026). La primera part repassa l’ocupació i l’atur; la segona aplica l’índex de l’OIT a les ocupacions espanyoles: una mica més del 30 % de l’ocupació és al grup més exposat, i des del 2022 l’ocupació ha crescut en tots els grups. Els mateixos autors avisen que són dades descriptives, que no proven causes.',
  'lecturas.la-exposicion-a-la-ia-2.titulo': 'L’exposició a la IA a les ocupacions espanyoles',
  'lecturas.la-ia-discrimina-por-edad.interes':
    'Ajuda a detectar prejudicis sobre el que pots aprendre o fer segons la teva edat. Són cinc eines: no demostra que la IA ja no tingui biaixos de gènere.',
  'lecturas.la-ia-discrimina-por-edad.resumen':
    'Un estudi amb participació de la Universitat Oberta de Catalunya (UOC) va «entrevistar» cinc xatbots amb situacions inventades. Evitaven assignar papers per gènere, però no per edat: relacionaven la gent gran amb ajuda i simplificació, i la gent jove amb creativitat i aprenentatge. En castellà.',
  'lecturas.la-ia-discrimina-por-edad.titulo': 'Els xatbots eviten més el sexisme que els prejudicis per edat',
  'lecturas.la-ley-europea-de-ia.interes':
    'Aclareix què obliga la llei i a qui. Les autoritats nacionals en vigilen el compliment des del 2/8/2026.',
  'lecturas.la-ley-europea-de-ia.resumen':
    'Pàgina de la Comissió Europea sobre l’article 4 del Reglament d’IA, modificat pel Reglament Òmnibus Digital: qui ofereix o fa servir sistemes d’IA en una organització ha d’adoptar mesures per formar el seu personal, sense que s’exigeixi un nivell concret a cap persona. La pàgina repassa també els plans europeus de formació i talent en IA. És una traducció automàtica al castellà.',
  'lecturas.la-ley-europea-de-ia.titulo': 'La llei europea d’IA i l’alfabetització (article 4)',
  'lecturas.la-recomendacion-de-la-unesco.interes':
    'És un punt de partida per conèixer els principis ètics que es van acordar entre països. El text complet és llarg.',
  'lecturas.la-recomendacion-de-la-unesco.resumen':
    'Pàgina breu de la UNESCO que presenta la seva Recomanació sobre l’ètica de la IA, el primer marc mundial sobre el tema, adoptat pels seus 193 estats membres el novembre del 2021. Enllaça al text complet. En castellà.',
  'lecturas.la-recomendacion-de-la-unesco.titulo': 'La recomanació de la UNESCO sobre l’ètica de la IA',
  'lecturas.min': 'minuts',
  'lecturas.model-avaluacio-impacte-drets-fonamentals-apdcat.interes':
    'Mostra quines preguntes s’hauria de fer una organització abans de fer servir IA per decidir sobre persones, també sobre la seva plantilla. Està escrita per a especialistes en protecció de dades.',
  'lecturas.model-avaluacio-impacte-drets-fonamentals-apdcat.resumen':
    'Guia de l’Autoritat Catalana de Protecció de Dades (APDCAT) amb un model per avaluar, abans de fer servir un sistema d’IA, com pot afectar els drets de les persones: planificar, analitzar els riscos amb unes taules de probabilitat i gravetat i decidir mesures. L’aplica a casos reals, entre els quals una eina de gestió de recursos humans.',
  'lecturas.model-avaluacio-impacte-drets-fonamentals-apdcat.titulo':
    'Com avaluar l’impacte d’un sistema d’IA en els drets fonamentals',
  'lecturas.modelos-lenguaje-confunden-creencias-hechos.interes':
    'Explica amb dades un límit poc conegut de la IA. Fa servir termes tècnics i anomena models concrets.',
  'lecturas.modelos-lenguaje-confunden-creencias-hechos.resumen':
    'Notícia sobre un estudi de la Universitat de Stanford amb 24 models de llenguatge i 13.000 preguntes. Descriu respostes que accepten una afirmació falsa de qui pregunta i els riscos en medicina, dret o periodisme. En castellà.',
  'lecturas.modelos-lenguaje-confunden-creencias-hechos.titulo':
    'Els models de llenguatge confonen el que algú creu amb el que és cert',
  'lecturas.nivel': 'Nivell',
  'lecturas.niveles.empezar': 'Inicial',
  'lecturas.niveles.investigacion': 'Avançat',
  'lecturas.niveles.profundizar': 'Intermedi',
  'lecturas.oit-uno-de-cada-cuatro-empleos.interes':
    'Explica en pocs minuts què vol dir «exposició» i per què no equival a perdre la feina.',
  'lecturas.oit-uno-de-cada-cuatro-empleos.resumen':
    'Nota de premsa de l’OIT sobre el seu índex del 2025: el 25 % de l’ocupació mundial és en ocupacions potencialment exposades a la IA generativa (el 34 % als països d’ingressos alts). Les feines administratives són les més exposades, i les dones més que els homes. La transformació és més probable que la substitució. En castellà.',
  'lecturas.oit-uno-de-cada-cuatro-empleos.titulo':
    'Una de cada quatre feines, exposada a la IA generativa (OIT, 2025)',
  'lecturas.osh-pulse-2025-digitalizacion-infografia.interes':
    'Posa xifres europees a la gestió de la feina amb algorismes i als seus efectes en la salut. Són dades de tota la UE, no només d’Espanya; la fitxa d’Espanya de la mateixa enquesta també és a la Biblioteca. Cal llegir gràfics.',
  'lecturas.osh-pulse-2025-digitalizacion-infografia.resumen':
    'Infografia de l’Agència Europea per a la Seguretat i la Salut en el Treball (EU-OSHA) amb la seva enquesta del 2025 a 25.688 persones treballadores de la Unió Europea. Mostra quanta gent fa servir tecnologies digitals i programes o màquines amb IA, quins efectes diu notar (més ritme, més càrrega, més aïllament) i a quantes persones un algorisme els assigna tasques o torns, les avalua o les vigila. En castellà.',
  'lecturas.osh-pulse-2025-digitalizacion-infografia.titulo':
    'Tecnologia digital, algorismes i salut a la feina a Europa (OSH Pulse 2025)',
  'lecturas.osh-pulse-2025-espana-ficha.interes':
    'Mostra amb gràfics com es viu la tecnologia a la feina, també el control automàtic de tasques i horaris. Cal llegir gràfics de barres.',
  'lecturas.osh-pulse-2025-espana-ficha.resumen':
    'Fitxa d’Espanya d’una enquesta de l’Agència Europea per a la Seguretat i la Salut en el Treball (EU-OSHA) a 1.006 persones treballadores el 2025. Compara Espanya amb la Unió Europea en estrès i problemes de salut lligats a la feina, en l’ús de tecnologies digitals, incloses les eines amb IA, i en com afecten el ritme i la càrrega de treball. En castellà.',
  'lecturas.osh-pulse-2025-espana-ficha.titulo': 'Salut mental i tecnologia a la feina a Espanya (OSH Pulse 2025)',
  'lecturas.personas-mayores-y-exclusion-tecnologica.interes':
    'Recorda que aprendre tecnologia necessita accessibilitat, acompanyament i alternatives.',
  'lecturas.personas-mayores-y-exclusion-tecnologica.resumen':
    'Estudi del Servei d’Estudis d’UGT (agost del 2025) que revisa amb dades estadístiques les barreres digitals de les persones grans en l’administració electrònica, la salut, la banca i la informació, i proposa suports. Tracta la tecnologia digital en general; la IA hi apareix només de passada. En castellà.',
  'lecturas.personas-mayores-y-exclusion-tecnologica.titulo': 'Persones grans i exclusió tecnològica',
  'lecturas.que-es-la-alfabetizacion-en.interes':
    'Explica d’on surt l’obligació de formar en IA i què s’espera d’empreses i administracions. És llarga i està pensada per a qui organitza aquesta formació.',
  'lecturas.que-es-la-alfabetizacion-en.resumen':
    'Preguntes i respostes de la Comissió Europea sobre l’article 4 del Reglament d’IA: a qui obliga, què va canviar amb l’Òmnibus Digital (ja no s’exigeix un nivell «suficient») i com poden les organitzacions donar suport a la formació del seu personal. És una traducció automàtica al castellà i el primer paràgraf encara fa servir la redacció antiga.',
  'lecturas.que-es-la-alfabetizacion-en.titulo': 'Què és l’alfabetització en IA, en preguntes i respostes',
  'lecturas.que-es-la-ia-generativa.interes':
    'És el punt de partida si mai no t’han explicat com funciona la IA, i el desafiament et diu què convé repassar.',
  'lecturas.que-es-la-ia-generativa.resumen':
    'Què és la intel·ligència artificial, com aprèn, com escriu un assistent, quines precaucions cal prendre i què pot canviar en la teva feina. Amb un glossari de 30 paraules i un desafiament de 12 preguntes.',
  'lecturas.que-es-la-ia-generativa.titulo': 'Què és la IA: la guia de Faro',
  'lecturas.que-es-un-deepfake.interes':
    'És una definició clara en un minut i et porta a casos reals per aprendre a dubtar.',
  'lecturas.que-es-un-deepfake.resumen':
    'Fitxa breu de l’Institut Nacional de Ciberseguretat (INCIBE): defineix el deepfake com un vídeo manipulat amb IA que canvia cares o veus per fer creure que algú va dir o fer una cosa que no va passar, i per a què es fa servir, com desinformar o desacreditar. Enllaça a altres recursos de l’INCIBE. En castellà.',
  'lecturas.que-es-un-deepfake.titulo': 'Què és un deepfake',
  'lecturas.recomendaciones-sobre-la-ia-en.interes': 'Explica en quins drets ja reconeguts es basa cada recomanació.',
  'lecturas.recomendaciones-sobre-la-ia-en.resumen':
    'Proposa com tractar la digitalització i la IA als convenis: informació a la representació sense que l’hagi de demanar, formació quan arriba una eina nova i anàlisi de l’impacte dels algorismes entre dones i homes.',
  'lecturas.recomendaciones-sobre-la-ia-en.titulo': 'Recomanacions sobre la IA en la negociació col·lectiva',
  'lecturas.registro-de-sistemas-de-ia.interes':
    'Mostra casos reals d’IA en serveis públics i quant continua decidint una persona.',
  'lecturas.registro-de-sistemas-de-ia.resumen':
    'Registre públic de la Generalitat amb 35 sistemes (31 d’IA i 4 algorismes), 33 en ús i 2 en desenvolupament. Indica per a cadascun la finalitat, el risc que declara i quant hi intervé una persona. Dades obertes.',
  'lecturas.registro-de-sistemas-de-ia.titulo': 'Registre de sistemes d’IA de la Generalitat',
  'lecturas.repensar-impacto-ia-futuro-trabajo.interes':
    'T’ajuda a llegir amb calma els titulars sobre IA i ocupació. Són opinions del seu autor, amb una mirada mundial.',
  'lecturas.repensar-impacto-ia-futuro-trabajo.resumen':
    'Preguntes i respostes amb un assessor de l’Organització Internacional del Treball (OIT): el debat sobre la IA no s’hauria de fixar només en la pèrdua de feines, sinó també en els salaris, les condicions de treball i la desigualtat. Recorda que les dones estan més exposades perquè abunden en les feines administratives i que encara no hi ha conclusions definitives. En castellà.',
  'lecturas.repensar-impacto-ia-futuro-trabajo.titulo': 'Més enllà de quantes feines: la IA i la qualitat del treball',
  'lecturas.resumen-recomendaciones-ia-generativa-aepd.interes':
    'És un model concret de normes per fer servir la IA en una oficina pública. Està escrita per a qui implanta la IA i fa servir termes tècnics, però l’últim apartat val per a qualsevol persona que la faci servir a la feina.',
  'lecturas.resumen-recomendaciones-ia-generativa-aepd.resumen':
    'Resum de 4 pàgines de l’Agència Espanyola de Protecció de Dades (AEPD) amb les obligacions i recomanacions que es posa a si mateixa per fer servir IA generativa: govern, protecció de dades, transparència, seguretat, contractació i formació. Acaba amb el que ha de saber cada persona usuària: fer servir només eines autoritzades, revisar a mà els resultats, no introduir dades personals ni confidencials i no fer servir textos generats en documents oficials sense revisió humana. En castellà.',
  'lecturas.resumen-recomendaciones-ia-generativa-aepd.titulo':
    'Com s’ha d’organitzar l’ús de la IA generativa en una administració: llista de l’AEPD',
  'lecturas.riesgos-laborales-de-la-digitalizacion.interes':
    'Està escrita per a qui representa la plantilla o negocia un conveni a Catalunya.',
  'lecturas.riesgos-laborales-de-la-digitalizacion.resumen':
    'Guia de salut laboral de CCOO de Catalunya per a delegades i delegats de prevenció: explica els riscos de la digitalització, algorismes inclosos, i dona indicacions per a l’acció sindical i la negociació, amb perspectiva de gènere.',
  'lecturas.riesgos-laborales-de-la-digitalizacion.titulo':
    'Riscos laborals de la digitalització i negociació col·lectiva',
  'lecturas.sesgos-genero-ia-perspectiva-interseccional.interes':
    'És l’informe oficial espanyol de referència sobre biaixos de gènere en la IA. El seu llenguatge és dens i conceptual.',
  'lecturas.sesgos-genero-ia-perspectiva-interseccional.resumen':
    'Informe de l’Instituto de las Mujeres que explica on neix la discriminació en els sistemes algorítmics: en les dades, en els algorismes o en els equips que els fan. En recorre el cicle de vida, diversos sectors d’aplicació i la regulació, i proposa recomanacions. És del 2023. En castellà.',
  'lecturas.sesgos-genero-ia-perspectiva-interseccional.titulo':
    'Biaixos de gènere en la IA, amb perspectiva interseccional',
  'lecturas.supervision-humana-de-los-sistemas.interes':
    'Mostra com s’espera que una empresa que crea un sistema d’IA organitzi la supervisió humana. És tècnica.',
  'lecturas.supervision-humana-de-los-sistemas.resumen':
    'Com s’ha d’organitzar la revisió per persones d’un sistema d’IA perquè sigui real: qui revisa, amb quina preparació i amb quin poder per corregir. Està escrita per a empreses que desenvolupen sistemes d’IA. En castellà.',
  'lecturas.supervision-humana-de-los-sistemas.titulo': 'Supervisió humana dels sistemes d’IA',
  'lecturas.tendencias-mercado-trabajo-sepe-2026.interes':
    'Situa la IA dins del conjunt de l’ocupació a Espanya. El resum no explica què vol dir «afectades»: pren-la com una xifra orientativa.',
  'lecturas.tendencias-mercado-trabajo-sepe-2026.resumen':
    'Resum del Servei Públic d’Ocupació Estatal (SEPE) sobre l’economia, els sectors, les ocupacions amb millors perspectives i les necessitats de formació. Té un apartat breu sobre la IA: diu que dues de cada deu feines estan «afectades» per aquesta tecnologia i que es fa servir més en les activitats de tecnologia i professionals. En castellà.',
  'lecturas.tendencias-mercado-trabajo-sepe-2026.titulo': 'Tendències del mercat de treball a Espanya 2026 (resum)',
  'lecturas.tipo.guia': 'Guia',
  'lecturas.transcripcion-voz-ia-responsabilidad-derechos.interes':
    'És útil si a la teva feina es graven reunions o trucades per transcriure-les amb IA. Està escrita per a organitzacions i fa servir llenguatge jurídic.',
  'lecturas.transcripcion-voz-ia-responsabilidad-derechos.resumen':
    'Entrada del blog de l’AEPD, segona d’una sèrie: quan una organització fa servir IA per passar converses a text, com actes o trucades, és responsable d’aquestes dades. Tracta els errors de transcripció, la informació a les persones i com atendre els seus drets. En castellà.',
  'lecturas.transcripcion-voz-ia-responsabilidad-derechos.titulo':
    'Transcriure converses amb IA: responsabilitats i drets',
  'lecturas.transparencia-que-deben-explicarte-de.interes':
    'Explica quina informació ha de donar qui crea un sistema a qui el fa servir. És tècnica.',
  'lecturas.transparencia-que-deben-explicarte-de.resumen':
    'Quina informació necessita qui fa servir un sistema d’IA per entendre per a què serveix, els seus límits i com llegir-ne els resultats. Està escrita per a empreses que desenvolupen sistemes d’IA. En castellà.',
  'lecturas.transparencia-que-deben-explicarte-de.titulo': 'Transparència: què ha d’explicar qui crea un sistema d’IA',
  'lecturas.tus-derechos-ante-la-ia.interes':
    'Aplega en 8 pàgines quina informació t’han de donar si un algorisme decideix sobre la teva feina. Està escrita sobretot per a empreses i fa servir llenguatge jurídic.',
  'lecturas.tus-derechos-ante-la-ia.resumen':
    'Nota de l’AEPD (7/10/2026) sobre el Reial decret 723/2026: l’empresa ha d’informar per escrit que fa servir sistemes algorítmics i, si decideixen sobre condicions de treball, dels seus criteris i regles. Explica també una advertència de l’AEPD sobre una eina d’IA per puntuar candidatures i ho relaciona amb el Reglament general de protecció de dades (RGPD) i amb els drets de la representació legal. En castellà.',
  'lecturas.tus-derechos-ante-la-ia.titulo': 'Algorismes a la feina: transparència i protecció de dades',
  'lecturas.un-radar-para-anticipar-las.interes':
    'Ensenya a llegir amb prudència les dades amb què es parla de competències del futur.',
  'lecturas.un-radar-para-anticipar-las.resumen':
    'Com combina la UOC ofertes de feina, classificacions de competències i entrevistes, i per què els anuncis no expliquen per si sols tota la demanda.',
  'lecturas.un-radar-para-anticipar-las.titulo': 'Un radar per anticipar les competències que demanarà l’ocupació',
  'lecturas.unos': 'uns',
  'lecturas.us-segur-ia-empresa-agencia-ciberseguretat.interes':
    'T’ajuda a saber què no convé posar en una IA a la feina i què pots demanar a la teva empresa: normes clares i formació. Algunes mesures són per a l’equip informàtic.',
  'lecturas.us-segur-ia-empresa-agencia-ciberseguretat.resumen':
    'Pàgina de l’Agència de Ciberseguretat de Catalunya sobre la «IA a l’ombra»: l’ús d’eines d’IA a la feina sense permís de l’empresa. Amb exemples d’oficina, com redactar un informe o respondre clients, explica els riscos (fuita de dades, incomplir la protecció de dades, dany a la reputació) i recomana una política d’ús, eines autoritzades i formació.',
  'lecturas.us-segur-ia-empresa-agencia-ciberseguretat.titulo':
    'Fer servir la IA a la feina sense posar en risc les dades de l’empresa',
  'lecturas.usar-la-ia-en-el.interes':
    'És una llista clara del que no convé escriure en un xatbot, amb un consell específic per a qui el fa servir a la feina.',
  'lecturas.usar-la-ia-en-el.resumen':
    'Deu consells de l’Agència Espanyola de Protecció de Dades (AEPD) per fer servir la IA sense posar en risc la teva privacitat: no pujar dades personals ni informació delicada, respectar les dades d’altres persones, no incloure informació confidencial de la feina, revisar les condicions del servei i no creure’s tot el que respon.',
  'lecturas.usar-la-ia-en-el.titulo': 'Compte amb el que confies a la IA: deu consells',
  'lecturas.viejas-competencias-nuevas-tecnologias-oit.interes':
    'Ajuda a no donar per fet que cal ser especialista en IA per continuar treballant. Les dades són d’anuncis d’altres països i no prediuen què passarà a la teva feina.',
  'lecturas.viejas-competencias-nuevas-tecnologias-oit.resumen':
    'Article de dues economistes de l’Organització Internacional del Treball (OIT) basat en milions d’ofertes de feina publicades a internet en set països, cap d’europeu. Les empreses demanen sobretot competències cognitives i socioemocionals; els coneixements especialitzats en IA suposen al voltant de l’1 % del que demanen o menys. En castellà.',
  'lecturas.viejas-competencias-nuevas-tecnologias-oit.titulo':
    'Serveixen les competències de sempre per treballar amb IA?',
  'lecturas.vistazo.abre': 'S’obre',
  'lecturas.vistazo.idioma': 'Idioma',
  'lecturas.vistazo.lectura': 'Lectura',
  'lecturas.xatejar-amb-la-ia-agencia-ciberseguretat.interes':
    'Resumeix en pocs minuts els límits d’un xatbot, també per a decisions de feina o de salut.',
  'lecturas.xatejar-amb-la-ia-agencia-ciberseguretat.resumen':
    'Pàgina de l’Agència de Ciberseguretat de Catalunya: la IA genera respostes, però no entén les persones ni substitueix un professional. Avisa que pot inventar dades amb seguretat i donar consells inadequats, i aconsella contrastar sempre el que diu i no prendre decisions importants només amb ella. Insisteix que no serveix com a suport emocional i dona el 061 com a telèfon d’ajuda.',
  'lecturas.xatejar-amb-la-ia-agencia-ciberseguretat.titulo': 'Xatejar amb la IA: què pot fer i què no',
  // ---------- Fin de Guías y Biblioteca ----------
};
