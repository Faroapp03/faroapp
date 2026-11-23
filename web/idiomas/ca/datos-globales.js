// Textos de «Dades globals · Catalunya» i «Dades globals · Unió Europea» en català (traduïts amb IA; vegeu
// web/idiomas/README.md): portada, clau de colors, índex de preguntes, «L’essencial», capítols, figures, lectures i
// fitxes tècniques. S’incorporen al diccionari de ca.js, amb les mateixes claus i marcadors que es/datos-globales.js.

/** @type {Record<string, string>} */
export const TEXTOS_DATOS_GLOBALES = {
  'datos-globales.antetitulo': 'Dades globals · La IA a la feina',
  'datos-globales.titulo-principal': 'Catalunya davant d’Europa',
  'datos-globales.entradilla':
    'Quantes empreses fan servir intel·ligència artificial i quanta gent fa servir IA generativa, segons les estadístiques oficials. Catalunya, comparada amb Espanya, Alemanya, França i Itàlia, i amb la mitjana de la UE com a referència.',
  'datos-globales.prudencia.titulo': 'Són dades de territoris, no de persones.',
  'datos-globales.prudencia.texto':
    'Descriuen poblacions senceres i no diuen res de la feina de qui llegeix. Fer servir la IA, o estar-hi exposat, no equival a perdre la feina.',
  'datos-globales.clave-colores.nombre': 'Com es distingeixen els territoris als gràfics',
  'datos-globales.clave-colores.cataluna': 'Catalunya',
  'datos-globales.clave-colores.ue': 'Mitjana de la UE-27, com a referència',
  'datos-globales.clave-colores.resto': 'Espanya, Alemanya, França i Itàlia',
  'datos-globales.clave-colores.nota':
    'Es pot comparar perquè són enquestes europees harmonitzades: les mateixes preguntes, les mateixes edats i el mateix any. Però Espanya inclou Catalunya, i la mitjana de la UE inclou Espanya: serveixen de referència, no són rivals.',
  'datos-globales.indice.titulo': 'Les preguntes d’aquest dossier',
  'datos-globales.resumen.titulo': 'L’essencial',
  'datos-globales.margen':
    'La mostra de Catalunya és més petita que la d’un país: diferències d’un o dos punts poden no ser reals.',
  'datos-globales.margen.encuesta': 'És una enquesta per mostreig: diferències d’un o dos punts poden no ser reals.',
  'datos-globales.pagina': 'Pàgina {numero} de {total}',
  'datos-globales.paginas.nombre': 'Pàgines de capítols',
  'comun.paginas.anterior': 'Anterior',
  'comun.paginas.siguiente': 'Següent',
  'comun.paginas.anterior.nombre': 'Pàgina anterior',
  'comun.paginas.siguiente.nombre': 'Pàgina següent',
  'datos-globales.volver': 'Tornar a les preguntes',
  'datos-globales.lectura.nombre': 'Lectura de les xifres',
  'datos-globales.fuente': 'Font: {fuente}',
  'datos-globales.dos-frases': '{a} {b}',
  'datos-globales.punto-y-coma': '{a}; {b}',
  'datos-globales.paneles.misma-escala': 'Els dos panells tenen la mateixa escala.',
  'datos-globales.media-ue': 'Mitjana de la UE: {cifra}',
  'datos-globales.nombre.ue': 'UE-27',
  'datos-globales.nombre.ue-media': 'UE-27 (mitjana)',
  'datos-globales.nombre.espana': 'Espanya (amb Catalunya)',
  'datos-globales.nombre.con-cataluna': '(amb Catalunya)',
  'datos-globales.alternativa.cifra': '{territorio}: {cifra}.',
  'datos-globales.alternativa.media': 'Mitjana de la UE: {cifra}.',
  'datos-globales.cabecera.corta': 'Dif.',
  'datos-globales.anual.titulo': 'Any a any, a tots els territoris',
  'datos-globales.anual.territorio': 'Territori',
  'datos-globales.anual.sin-dato': 'Sense dada comparable',
  'datos-globales.anual.nota': '—: sense dada comparable aquell any; no es mostra.',
  'datos-globales.no-comparable.todos': '{anio}, a tots els territoris amb dada',
  'datos-globales.no-comparable.algunos': '{anio}, a {territorios}',
  'datos-globales.no-comparable.nota': 'Sense dada comparable: {lista}. No es mostra.',
  'datos-globales.no-comparable.ficha':
    '{lista}. La font marca aquestes xifres com a no comparables (una altra definició o una ruptura de sèrie): no es mostren ni entren en cap càlcul.',
  'datos-globales.no-comparable.ninguno': 'Cap: totes les xifres de la font són comparables.',
  'datos-globales.sin-cifra.nota': '{territorios}: sense xifra publicada per a {anio}.',
  'datos-globales.lectura.espana.mas': 'Més que a Espanya',
  'datos-globales.lectura.espana.parecido': 'Semblant a Espanya',
  'datos-globales.lectura.espana.menos': 'Menys que a Espanya',
  'datos-globales.lectura.ue.mas': 'Més que la mitjana de la UE',
  'datos-globales.lectura.ue.parecido': 'Semblant a la mitjana de la UE',
  'datos-globales.lectura.ue.menos': 'Menys que la mitjana de la UE',
  'datos-globales.lectura.ue.titulo': 'A la mitjana de la UE',
  'datos-globales.lectura.desde.mas': 'Més que el {desde}',
  'datos-globales.lectura.desde.parecido': 'Semblant al {desde}',
  'datos-globales.lectura.desde.menos': 'Menys que el {desde}',
  'datos-globales.ranking.delante.titulo': '{territorios}, per davant',
  'datos-globales.ranking.delante.uno':
    'És l’únic dels cinc territoris que supera Catalunya en un punt o més: {cifra} de cada 100, davant de {propia}.',
  'datos-globales.ranking.delante.varios':
    'Són els territoris que superen Catalunya en un punt o més. Catalunya: {propia} de cada 100.',
  'datos-globales.ranking.primera.titulo': 'La xifra més alta dels cinc',
  'datos-globales.ranking.primera':
    'Catalunya supera en un punt o més els altres territoris. La segueix {segundo}, amb {cifra} de cada 100.',
  'datos-globales.ranking.empate.titulo': 'Sense un primer lloc clar',
  'datos-globales.ranking.empate':
    'Cap territori no treu un punt o més a tots els altres: amb aquestes mostres, no es pot dir qui va al davant.',
  'datos-globales.ficha.resumen': 'Fitxa tècnica: què mesura i d’on surt',
  'datos-globales.ficha.que-mide': 'Què mesura',
  'datos-globales.ficha.unidad': 'Unitat',
  'datos-globales.ficha.base': 'Mateixa base',
  'datos-globales.ficha.no-se-muestran': 'Dades que no es mostren',
  'datos-globales.ficha.margen': 'Marge d’error',
  'datos-globales.ficha.calculos': 'Càlculs',
  'datos-globales.ficha.calculos.texto':
    'Les restes (en punts) i les divisions (en vegades) es fan amb les xifres sense arrodonir.',
  'datos-globales.ficha.fuente': 'Font',
  'datos-globales.ficha.tipo': 'Tipus',
  'datos-globales.ficha.no-sabe': '«No sap com fer-la servir»',
  'datos-globales.ficha.diferencia': 'Diferència',
  'datos-globales.ficha.veces': 'Vegades',
  'datos-globales.ficha.grupos': 'Grups',
  'datos-globales.ficha.francia': 'França',
  'datos-globales.ficha.anio': 'Any',
  'datos-globales.ficha.comparacion': 'Per què no es compara',
  'datos-globales.ficha.preguntas': 'Preguntes',
  'datos-globales.ficha.encuesta': 'Enquesta',
  'datos-globales.ficha.cifras': 'Xifres',
  'datos-globales.ficha.cataluna': 'Catalunya',
  'datos-globales.esencial.empresas.tema': 'Empreses · {anio}',
  'datos-globales.esencial.empresas':
    'És a dir, {cifra} de cada 100 empreses catalanes amb 10 o més persones fan servir alguna tecnologia d’IA.',
  'datos-globales.esencial.empresas.comparacion': 'De cada 100 empreses, quantes la fan servir:',
  'datos-globales.esencial.personas.tema': 'Persones · {anio}',
  'datos-globales.esencial.personas':
    'És a dir, {cifra} de cada 100 persones que fan servir internet a Catalunya van fer servir IA generativa els últims tres mesos.',
  'datos-globales.esencial.personas.comparacion': 'De cada 100 persones de 16 a 74 anys que fan servir internet:',
  'datos-globales.esencial.trabajo.tema': 'Per treballar · {anio}',
  'datos-globales.esencial.trabajo':
    'És a dir, {cifra} de cada 100 persones que fan servir internet a Catalunya van fer servir IA generativa per a la feina.',
  'datos-globales.esencial.trabajo.comparacion': 'De cada 100 persones de 16 a 74 anys que fan servir internet:',
  'datos-globales.esencial.genero.tema': 'Dones i homes · {anio}',
  'datos-globales.esencial.genero':
    'de diferència a Catalunya: fan servir IA generativa {hombres} de cada 100 homes i {mujeres} de cada 100 dones que fan servir internet.',
  'datos-globales.esencial.genero.comparacion': 'La mateixa diferència, en punts:',
  'datos-globales.esencial.genero.pie':
    'Punts: la resta entre les dues xifres de cada 100 ({hombres} − {mujeres} ≈ {puntos}).',
  'datos-globales.esencial.fuente.eurostat': 'Font: Eurostat',
  'datos-globales.esencial.fuente.idescat': 'Font: Idescat i Eurostat',
  'datos-globales.empresas.tema': 'Empreses · evolució',
  'datos-globales.empresas.pregunta': 'Quantes empreses fan servir IA?',
  'datos-globales.empresas.titular.cuarto-doble':
    'Gairebé 1 de cada 4 empreses catalanes ja fan servir IA: més del doble que el {desde}',
  'datos-globales.empresas.titular.cuarto': 'Gairebé 1 de cada 4 empreses catalanes ja fan servir IA',
  'datos-globales.empresas.titular.cifra-doble':
    '{cifra} de cada 100 empreses catalanes fan servir IA: més del doble que el {desde}',
  'datos-globales.empresas.titular.cifra': '{cifra} de cada 100 empreses catalanes fan servir IA',
  'datos-globales.empresas.titular.neutro': 'Les empreses que fan servir la IA, a Catalunya i a Europa',
  'datos-globales.empresas.entradilla':
    'El {desde} feien servir IA {inicio} de cada 100 empreses catalanes amb 10 o més persones; el {hasta}, {fin}.',
  'datos-globales.empresas.entradilla.un-anio':
    'El {hasta} fan servir IA {fin} de cada 100 empreses catalanes amb 10 o més persones.',
  'datos-globales.empresas.entradilla.comparacion':
    'A Espanya (amb Catalunya), {espana} de cada 100; a la mitjana de la UE, {ue}.',
  'datos-globales.empresas.figura': 'De cada 100 empreses, quantes fan servir almenys una tecnologia d’IA',
  'datos-globales.empresas.figura.sub':
    'Empreses amb 10 o més persones (sense agricultura, mineria ni sector financer), igual a tots els territoris. {desde}–{hasta}.',
  'datos-globales.empresas.fuente': 'Eurostat (isoc_eb_ai; Catalunya: isoc_r_eb_ain2)',
  'datos-globales.empresas.anual.leyenda': 'Empreses que fan servir IA, de cada 100, per any i per territori',
  'datos-globales.empresas.anual.sub':
    'De cada 100 empreses amb 10 o més persones, quantes fan servir IA. La barra de cada cel·la va de 0 a {maximo}.',
  'datos-globales.empresas.lectura.doble-dos': 'Més del doble en dos anys',
  'datos-globales.empresas.lectura.doble': 'Més del doble des del {desde}',
  'datos-globales.empresas.lectura.evolucion':
    'El {desde} feien servir IA {inicio} de cada 100 empreses catalanes; el {hasta}, {fin}.',
  'datos-globales.empresas.lectura.territorios':
    'El {anio}: Catalunya, {cataluna} de cada 100 empreses; Espanya (amb Catalunya), {espana}; mitjana de la UE, {ue}.',
  'datos-globales.empresas.ficha.que-mide':
    'Empreses amb 10 o més persones que fan servir almenys una de vuit tecnologies d’IA: analitzar textos, entendre la veu, generar llenguatge o codi, reconèixer imatges, aprenentatge automàtic, automatitzar tasques, robots autònoms i generar imatge, vídeo o àudio.',
  'datos-globales.empresas.ficha.desde':
    'Les xifres comencen el {desde}: abans, l’enquesta preguntava per menys tecnologies i no són comparables.',
  'datos-globales.empresas.ficha.unidad':
    'Percentatge d’empreses: de cada 100 empreses amb 10 o més persones, quantes.',
  'datos-globales.empresas.ficha.base':
    'La mateixa enquesta europea, la mateixa definició, el mateix tipus d’empreses (indústria i serveis, sense agricultura, mineria ni sector financer) i el mateix any a tots els territoris. Espanya inclou Catalunya, i la mitjana de la UE inclou Espanya.',
  'datos-globales.empresas.ficha.veces':
    'Per exemple, {fin} ÷ {inicio} = {veces}: el {hasta}, la xifra de Catalunya és {veces} vegades la del {desde}.',
  'datos-globales.empresas.ficha.fuente':
    'Eurostat, enquesta europea sobre l’ús de les TIC a les empreses: isoc_eb_ai (països i UE-27) i isoc_r_eb_ain2 (Catalunya, regió ES51); indicador E_AI_TANY, unitat PC_ENT.',
  'datos-globales.personas.tema': 'Persones · comparació',
  'datos-globales.personas.pregunta': 'Quanta gent fa servir la IA generativa?',
  'datos-globales.personas.titular.mitad':
    'Gairebé la meitat de qui fa servir internet a Catalunya ja fa servir IA generativa',
  'datos-globales.personas.titular.cifra':
    '{cifra} de cada 100 persones que fan servir internet a Catalunya fan servir IA generativa',
  'datos-globales.personas.titular.neutro': 'La IA generativa entre qui fa servir internet, a Catalunya i a Europa',
  'datos-globales.personas.entradilla':
    'El {anio}, la van fer servir {cifra} de cada 100 persones de 16 a 74 anys que fan servir internet a Catalunya, i {trabajo} de cada 100 la van fer servir per a la feina.',
  'datos-globales.personas.entradilla.primera':
    'Són les xifres més altes dels cinc territoris en els dos casos, per un punt o més.',
  'datos-globales.personas.figura':
    'De cada 100 persones que fan servir internet, quantes van fer servir IA generativa els últims tres mesos',
  'datos-globales.personas.figura.sub':
    'Persones de 16 a 74 anys que fan servir internet, igual a tots els territoris. {anio}.',
  'datos-globales.personas.panel.cualquier': 'Per a qualsevol ús',
  'datos-globales.personas.panel.trabajo': 'Per a la feina',
  'datos-globales.personas.fuente':
    'Idescat, a partir de l’enquesta TIC-H de l’INE (Catalunya, ticll25); Eurostat, isoc_ai_iaiu (països i UE-27)',
  'datos-globales.personas.nota':
    'IA generativa: assistents que escriuen textos, responen preguntes o creen imatges a partir del que se’ls demana.',
  'datos-globales.personas.lectura.espana':
    'La fan servir {cataluna} de cada 100 persones que fan servir internet a Catalunya i {espana} de cada 100 a Espanya (amb Catalunya).',
  'datos-globales.personas.lectura.ue':
    'A la mitjana de la UE la fan servir {ue} de cada 100. Per a la feina: {cataluna} a Catalunya i {ueTrabajo} a la UE.',
  'datos-globales.personas.lectura.no-sabe.titulo': 'Per què no la fan servir',
  'datos-globales.personas.lectura.no-sabe':
    'De cada 100 persones que fan servir internet a Catalunya i no fan servir IA generativa, {cifra} diuen que no saben com fer-ho. Només hi ha dada de Catalunya: no es compara.',
  'datos-globales.personas.ficha.que-mide':
    'Persones de 16 a 74 anys que van fer servir alguna eina d’IA generativa els tres mesos anteriors a l’enquesta, per a qualsevol finalitat i per a la feina.',
  'datos-globales.personas.ficha.unidad':
    'Percentatge de persones: de cada 100 persones de 16 a 74 anys que van fer servir internet els tres mesos anteriors, quantes.',
  'datos-globales.personas.ficha.base':
    'La mateixa enquesta europea harmonitzada (a Catalunya, la de l’INE, que en forma part), les mateixes edats, la mateixa base i el mateix any a tots els territoris. Es compta sobre qui fa servir internet perquè així publica l’Idescat la xifra de Catalunya. A la pàgina «Unió Europea» la base és tota la població de 16 a 74 anys: per això allà les xifres són una mica més baixes.',
  'datos-globales.personas.ficha.no-sabe':
    'De les persones que van fer servir internet i no van fer servir IA generativa, les que donen com a motiu que no saben com fer-la servir. Només ho publica l’Idescat, per a Catalunya: no es compara.',
  'datos-globales.personas.ficha.fuente':
    'Catalunya: Idescat, a partir de l’enquesta TIC-H de l’INE (taules 3.4.1 i 3.4.2 de ticll25). La resta: Eurostat, isoc_ai_iaiu (indicadors I_IUAI i I_IUAIWP, unitat PC_IND_IU3). És la mateixa enquesta europea.',
  'datos-globales.genero.tema': 'Dones i homes',
  'datos-globales.genero.pregunta': 'Hi ha diferències entre dones i homes?',
  'datos-globales.genero.titular.hombres':
    'Sí: a Catalunya la fan servir {hombres} de cada 100 homes i {mujeres} de cada 100 dones',
  'datos-globales.genero.titular.mujeres':
    'Sí: a Catalunya la fan servir {mujeres} de cada 100 dones i {hombres} de cada 100 homes',
  'datos-globales.genero.titular.parecido':
    'A Catalunya, dones i homes la fan servir de manera semblant: {mujeres} i {hombres} de cada 100',
  'datos-globales.genero.titular.neutro': 'Dones i homes davant la IA generativa',
  'datos-globales.genero.entradilla.todos':
    'Els homes fan servir més la IA generativa que les dones a tots els territoris comparats i a la mitjana de la UE.',
  'datos-globales.genero.entradilla':
    'La diferència entre dones i homes no va en el mateix sentit a tots els territoris.',
  'datos-globales.genero.entradilla.trabajo': 'Per treballar, la diferència a Catalunya és més petita.',
  'datos-globales.genero.figura':
    'De cada 100 dones i de cada 100 homes que fan servir internet, quants van fer servir IA generativa',
  'datos-globales.genero.figura.sub':
    'Persones de 16 a 74 anys que fan servir internet, els últims tres mesos. {anio}. A la dreta, la diferència en punts: la xifra dels homes menys la de les dones.',
  'datos-globales.genero.interruptor': 'Quin ús ensenya el gràfic',
  'datos-globales.genero.nota':
    'Cercle: dones. Quadrat: homes. La línia entre els dos és la diferència. Els dos usos tenen la mateixa escala.',
  'datos-globales.genero.alternativa': '{territorio}: dones, {a}; homes, {b}; diferència, {puntos} punts.',
  'datos-globales.genero.lectura.cataluna.titulo': '{puntos} punts de diferència a Catalunya',
  'datos-globales.genero.lectura.cataluna':
    'La fan servir {hombres} de cada 100 homes i {mujeres} de cada 100 dones que fan servir internet.',
  'datos-globales.genero.lectura.mayor': 'És la diferència més gran dels cinc territoris, per un punt o més.',
  'datos-globales.genero.lectura.trabajo.menor': 'Per treballar, la diferència és més petita',
  'datos-globales.genero.lectura.trabajo.titulo': 'Per treballar',
  'datos-globales.genero.lectura.trabajo':
    'La fan servir per a la feina {hombres} de cada 100 homes i {mujeres} de cada 100 dones: {puntos} punts de diferència.',
  'datos-globales.genero.lectura.ue.titulo': '{puntos} punts a la mitjana de la UE',
  'datos-globales.genero.lectura.ue':
    'La fan servir {hombres} de cada 100 homes i {mujeres} de cada 100 dones que fan servir internet.',
  'datos-globales.genero.ficha.que-mide':
    'Dones i homes de 16 a 74 anys que van fer servir alguna eina d’IA generativa els tres mesos anteriors: per a qualsevol finalitat i per a la feina.',
  'datos-globales.genero.ficha.diferencia':
    'Punts: la xifra dels homes menys la de les dones, totes dues de cada 100, calculada amb les xifres sense arrodonir. No és un percentatge de persones.',
  'datos-globales.genero.ficha.base':
    'Persones que van fer servir internet els tres mesos anteriors, amb les mateixes edats i el mateix any a tots els territoris.',
  'datos-globales.genero.ficha.fuente':
    'Idescat, ticll25 (Catalunya); Eurostat, isoc_ai_iaiu, grups F_Y16_74 i M_Y16_74, unitat PC_IND_IU3 (la resta).',
  'datos-globales.ocupacion.tema': 'Tipus de feina',
  'datos-globales.ocupacion.pregunta': 'Canvia segons el tipus de feina?',
  'datos-globales.ocupacion.titular.mucho-mas':
    'Sí: a Catalunya, {noManual} de cada 100 en feines no manuals i {manual} de cada 100 en manuals',
  'datos-globales.ocupacion.titular.mas':
    'Sí: a Catalunya, {noManual} de cada 100 en feines no manuals i {manual} de cada 100 en manuals',
  'datos-globales.ocupacion.titular.menos':
    'Sí: a Catalunya, {manual} de cada 100 en feines manuals i {noManual} de cada 100 en no manuals',
  'datos-globales.ocupacion.titular.parecido':
    'A Catalunya, la fan servir per treballar de manera semblant a les feines manuals i a les no manuals',
  'datos-globales.ocupacion.titular.neutro': 'La IA generativa a la feina, segons l’ocupació',
  'datos-globales.ocupacion.entradilla.todos':
    'Per a la feina, qui té una feina no manual fa servir la IA generativa almenys el doble que qui en té una de manual, a tots els territoris amb dada i a la mitjana de la UE.',
  'datos-globales.ocupacion.entradilla':
    'Per a la feina, qui té una feina no manual i qui en té una de manual no fan servir igual la IA generativa.',
  'datos-globales.ocupacion.grupos.breve':
    'Manual: agricultura, oficis, operadors de màquines, conducció i neteja. No manual: direcció, professions, tècnics, oficines, comerç, hostaleria i cures.',
  'datos-globales.ocupacion.figura':
    'De cada 100 persones de cada tipus de feina, quantes van fer servir IA generativa per a la feina',
  'datos-globales.ocupacion.figura.sub':
    'Persones de 16 a 74 anys que treballen i fan servir internet, els últims tres mesos. {anio}. A la dreta, quantes vegades més la fan servir a les feines no manuals.',
  'datos-globales.ocupacion.manual': 'Feina manual',
  'datos-globales.ocupacion.no-manual': 'Feina no manual',
  'datos-globales.ocupacion.cabecera': 'Vegades',
  'datos-globales.ocupacion.nota':
    'Cercle: feina manual. Quadrat: feina no manual. Vegades: la xifra de la feina no manual dividida entre la de la manual.',
  'datos-globales.ocupacion.francia': 'França no publica aquesta dada el {anio} (sí fins al {anterior}).',
  'datos-globales.ocupacion.alternativa': '{territorio}: feina manual, {a}; feina no manual, {b}; {veces} vegades.',
  'datos-globales.ocupacion.lectura.cataluna.mucho-mas': 'Molt més a les feines no manuals',
  'datos-globales.ocupacion.lectura.cataluna.mas': 'Més a les feines no manuals',
  'datos-globales.ocupacion.lectura.cataluna.parecido': 'Semblant als dos tipus de feina',
  'datos-globales.ocupacion.lectura.cataluna.menos': 'Més a les feines manuals',
  'datos-globales.ocupacion.lectura.cataluna':
    'A Catalunya la fan servir per a la feina {noManual} de cada 100 persones amb una feina no manual i {manual} de cada 100 amb una de manual: la xifra de la no manual és {veces} vegades la de la manual.',
  'datos-globales.ocupacion.tic': 'Professionals de la informàtica',
  'datos-globales.ocupacion.lectura.tic':
    'A Espanya (amb Catalunya), la fan servir per a la feina {cifra} de cada 100 professionals de la informàtica i les telecomunicacions.',
  'datos-globales.ocupacion.lectura.ue':
    'La fan servir per a la feina {noManual} de cada 100 persones amb una feina no manual i {manual} de cada 100 amb una de manual.',
  'datos-globales.ocupacion.ficha.que-mide':
    'Persones que van fer servir IA generativa per a la feina els tres mesos anteriors, segons la seva ocupació.',
  'datos-globales.ocupacion.ficha.grupos':
    'No manuals: grans grups 0 a 5 (direcció, professionals, tècnics, administratius, serveis i vendes). Manuals: grans grups 6 a 9 (agricultura, oficis, operadors de màquines i ocupacions elementals). És la mateixa divisió a Eurostat (CIUO-08) i a l’Idescat (CNO, que té els mateixos grans grups).',
  'datos-globales.ocupacion.ficha.veces':
    'La xifra de la feina no manual dividida entre la de la manual, amb les xifres sense arrodonir. A Catalunya: {noManual} ÷ {manual} = {veces}.',
  'datos-globales.ocupacion.ficha.base':
    'Persones que van fer servir internet els tres mesos anteriors, amb els mateixos grans grups d’ocupació, les mateixes edats i el mateix any a tots els territoris.',
  'datos-globales.ocupacion.ficha.francia':
    'El {anio} és l’únic país de la UE que no publica el tall manual / no manual en cap taula d’aquesta enquesta, ni a Eurostat ni a l’INSEE (sí que el va publicar fins al {anterior}). Les seves xifres per categoria socioprofessional no equivalen a aquest tall.',
  'datos-globales.ocupacion.ficha.fuente':
    'Catalunya: Idescat, ticll25, taula 3.4.1 (definicions a la seva metodologia). La resta: Eurostat, isoc_ai_iaiu, indicador I_IUAIWP (grups ISCO0_5 i ISCO6_9), unitat PC_IND_IU3.',
  'datos-globales.formacion.tema': 'Formació',
  'datos-globales.formacion.pregunta': 'Quanta gent adulta s’està formant?',
  'datos-globales.formacion.titular.primera':
    'Dels cinc territoris, Catalunya és on més adults es formen: {cifra} de cada 100',
  'datos-globales.formacion.titular.cifra': '{cifra} de cada 100 adults de Catalunya van fer algun curs l’últim mes',
  'datos-globales.formacion.titular.neutro': 'La formació dels adults, a Catalunya i a Europa',
  'datos-globales.formacion.entradilla':
    'El {anio}, de cada 100 persones de 25 a 64 anys, es van formar {cataluna} a Catalunya, {espana} a Espanya (amb Catalunya) i {ue} a la mitjana de la UE.',
  'datos-globales.formacion.cualquiera': 'Compta qualsevol formació, no només sobre IA.',
  'datos-globales.formacion.figura':
    'De cada 100 persones de 25 a 64 anys, quantes van fer algun curs o formació les quatre setmanes anteriors',
  'datos-globales.formacion.figura.sub':
    'Qualsevol formació, reglada o no, igual a tots els territoris. {desde}–{hasta}.',
  'datos-globales.formacion.fuente': 'Eurostat, enquesta de població activa (trng_lfse_04; Catalunya: regió ES51)',
  'datos-globales.formacion.anual.leyenda': 'Adults que es van formar, de cada 100, per any i per territori',
  'datos-globales.formacion.anual.sub':
    'De cada 100 persones de 25 a 64 anys, quantes es van formar l’últim mes. La barra de cada cel·la va de 0 a {maximo}.',
  'datos-globales.formacion.lectura.espana':
    'Es van formar {cataluna} de cada 100 adults a Catalunya i {espana} a Espanya (amb Catalunya).',
  'datos-globales.formacion.lectura.ue': 'A la mitjana de la UE, {ue} de cada 100.',
  'datos-globales.formacion.lectura.evolucion':
    'El {desde} es formaven {inicio} de cada 100 adults de Catalunya; el {hasta}, {fin}.',
  'datos-globales.formacion.ficha.que-mide':
    'Persones de 25 a 64 anys que van fer alguna activitat d’educació o formació, reglada o no, les quatre setmanes anteriors a l’enquesta.',
  'datos-globales.formacion.ficha.unidad': 'Percentatge de persones: de cada 100 persones de 25 a 64 anys, quantes.',
  'datos-globales.formacion.ficha.base':
    'La mateixa enquesta europea (l’enquesta de població activa), la mateixa pregunta, les mateixes edats i el mateix any a tots els territoris.',
  'datos-globales.formacion.ficha.fuente':
    'Eurostat, enquesta de població activa: trng_lfse_04 (països, UE-27 i regió ES51), unitat PC.',
  'datos-globales.opinion.tema': 'Opinió',
  'datos-globales.opinion.pregunta': 'Què opina la gent de la IA a la feina?',
  'datos-globales.opinion.titular.hallazgo':
    'La majoria veu bé la IA a la feina i, alhora, creu que es perdran més llocs de treball dels que es crearan',
  'datos-globales.opinion.titular.neutro': 'Què opina la gent dels robots i la IA a la feina',
  'datos-globales.opinion.entradilla':
    'El que opina la gent d’Espanya, Alemanya, França i Itàlia, segons una enquesta de la Comissió Europea del {anio}. És opinió, no una mesura: diu el que la gent creu, no el que passa a la seva feina.',
  'datos-globales.opinion.figura': 'De cada 100 persones de 15 anys o més, quantes estan d’acord amb cada frase',
  'datos-globales.opinion.figura.sub':
    'Eurobaròmetre especial 554, abril i maig del {anio}. Xifres senceres, com les publica.',
  'datos-globales.opinion.panel.positiva': 'Veuen bé l’ús de robots i IA a la feina',
  'datos-globales.opinion.panel.destruira': 'Creuen que desapareixeran més llocs de treball dels que es crearan',
  'datos-globales.opinion.fuente': 'Comissió Europea, Eurobaròmetre especial 554 (preguntes QB5 i QB6.1)',
  'datos-globales.opinion.sin-pregunta': 'L’Eurobaròmetre no dona xifra de Catalunya.',
  'datos-globales.opinion.nota.ceo':
    'Catalunya: una altra enquesta (la del CEO) fa una altra pregunta, amb una altra escala. {cifra} de cada 100 persones creuen probable (7 o més sobre 10) que les màquines, els programes o la IA superin o substitueixin les persones en la majoria de les feines. Per això no es posa al costat dels països.',
  'datos-globales.opinion.lectura.positiva.mayoria': 'La majoria ho veu bé',
  'datos-globales.opinion.lectura.positiva.dividida': 'Opinions dividides',
  'datos-globales.opinion.lectura.positiva':
    'Ho veuen bé entre {minimo} i {maximo} de cada 100 persones, segons el país; a la mitjana de la UE, {ue}.',
  'datos-globales.opinion.lectura.positiva.sin-ue':
    'Ho veuen bé entre {minimo} i {maximo} de cada 100 persones, segons el país.',
  'datos-globales.opinion.lectura.destruira.mayoria': 'I la majoria tem per la feina',
  'datos-globales.opinion.lectura.destruira.dividida': 'Opinions dividides sobre la feina',
  'datos-globales.opinion.lectura.destruira':
    'Creuen que es perdran més llocs de treball dels que es crearan entre {minimo} i {maximo} de cada 100 persones, segons el país; a la mitjana de la UE, {ue}.',
  'datos-globales.opinion.lectura.destruira.sin-ue':
    'Creuen que es perdran més llocs de treball dels que es crearan entre {minimo} i {maximo} de cada 100 persones, segons el país.',
  'datos-globales.opinion.ficha.preguntas':
    'QB5: «Fins a quin punt veu de manera positiva o negativa l’ús de robots i intel·ligència artificial al lloc de treball?» Suma de «molt» i «força positiva». QB6.1: «Per l’ús de robots i intel·ligència artificial, desapareixeran més llocs de treball dels que es crearan.» Suma de «totalment» i «més aviat d’acord».',
  'datos-globales.opinion.ficha.encuesta':
    'Comissió Europea, Eurobaròmetre especial 554, «Artificial Intelligence and the future of work» (onada 101.4). Entrevistes a persones de 15 anys o més (treball de camp: 25/04–22/05/2024): 1.000 a Espanya, 1.603 a Alemanya, 1.002 a França i 1.037 a Itàlia. Publicat el 2025.',
  'datos-globales.opinion.ficha.cifras':
    'L’Eurobaròmetre publica percentatges sencers (volum A, taules QB5 i QB6.1, columna de cada país i de la UE-27); es mostren sense decimals.',
  'datos-globales.opinion.ficha.cataluna':
    '{fuente}, pregunta P26, escala de 0 («gens probable») a 10 («totalment probable»). Responen de 7 a 10 el {cifra} de les respostes ponderades en línia.',
  'datos-globales.opinion.ficha.margen':
    'Unes 1.000 entrevistes per país: diferències de dos o tres punts poden no ser reals.',
  'datos-globales.dentro.tema': 'Només Catalunya',
  'datos-globales.dentro.pregunta': 'En quins llocs de treball es fa servir la IA dins de les empreses catalanes?',
  'datos-globales.dentro.titular.cualificado':
    'Es fa servir més entre el personal qualificat: en {cifra} de cada 100 establiments',
  'datos-globales.dentro.titular.poco': 'Es fa servir més entre el personal poc qualificat',
  'datos-globales.dentro.titular.parecido':
    'Als establiments catalans, la IA es fa servir de manera semblant als diferents llocs de treball',
  'datos-globales.dentro.titular.neutro': 'Qui fa servir la IA als establiments catalans',
  'datos-globales.dentro.entradilla':
    'Una enquesta de l’Idescat als establiments de Catalunya (cada centre de treball d’una empresa), del 2n trimestre del {anio}. És una altra enquesta, a establiments i no a empreses: per això no es compara amb Europa.',
  'datos-globales.dentro.figura':
    'De cada 100 establiments, en quants fa servir la IA cada grup de persones treballadores',
  'datos-globales.dentro.figura.sub':
    'Establiments de Catalunya. 2n trimestre del {anio}. Només hi ha dada de Catalunya.',
  'datos-globales.dentro.fuente': 'Idescat, Indicadors de clima empresarial, mòdul «Intel·ligència artificial»',
  'datos-globales.dentro.cualificado': 'Personal qualificat',
  'datos-globales.dentro.directivos': 'Direcció',
  'datos-globales.dentro.poco-cualificado': 'Personal poc qualificat',
  'datos-globales.dentro.lectura.puestos.mas': 'Més entre el personal qualificat',
  'datos-globales.dentro.lectura.puestos.parecido': 'Semblant als diferents llocs de treball',
  'datos-globales.dentro.lectura.puestos.menos': 'Més entre el personal poc qualificat',
  'datos-globales.dentro.lectura.puestos':
    'En {cualificado} de cada 100 establiments la fa servir el personal qualificat; en {poco}, el poc qualificat.',
  'datos-globales.dentro.lectura.direccion.titulo': 'La direcció',
  'datos-globales.dentro.lectura.direccion': 'En {cifra} de cada 100 establiments la fa servir la direcció.',
  'datos-globales.dentro.contratar': 'En contractar',
  'datos-globales.dentro.lectura.contratar':
    '{cifra} de cada 100 establiments donen molta importància a les competències digitals, IA inclosa, quan contracten (a finals del {anio}).',
  'datos-globales.dentro.nota':
    'És una altra enquesta, a establiments i no a empreses: per això no es compara amb Europa.',
  'datos-globales.dentro.ficha.que-mide':
    'Establiments de Catalunya on cada grup de persones treballadores fa servir alguna eina d’IA.',
  'datos-globales.dentro.ficha.unidad': 'Percentatge d’establiments: de cada 100, en quants.',
  'datos-globales.dentro.ficha.anio':
    '2n trimestre del {anio} (pregunta d’una sola vegada); competències en contractar, 4t trimestre del {competencias}.',
  'datos-globales.dentro.ficha.fuente':
    'Idescat, Indicadors de clima empresarial, mòduls «Intel·ligència artificial» (taula 18162) i «Necessitats formatives i ocupacionals».',
  'datos-globales.cuadro.tema': 'Quadre resum',
  'datos-globales.cuadro.pregunta': 'Totes les xifres en una taula',
  'datos-globales.cuadro.titular': 'Les xifres d’aquest dossier, territori a territori',
  'datos-globales.cuadro.texto':
    'De cada 100 de cada grup, quants. Espanya inclou Catalunya, i la mitjana de la UE inclou Espanya: hi són com a referència.',
  'datos-globales.cuadro.leyenda': 'Indicadors principals: de cada 100, quants',
  'datos-globales.cuadro.territorio': 'Territori',
  'datos-globales.cuadro.empresas': 'Empreses que fan servir IA',
  'datos-globales.cuadro.empresas.detalle': 'amb 10 o més persones · {anio}',
  'datos-globales.cuadro.personas': 'Persones que fan servir IA generativa',
  'datos-globales.cuadro.personas.detalle': '16–74 anys que fan servir internet · {anio}',
  'datos-globales.cuadro.trabajo': '… per a la feina',
  'datos-globales.cuadro.trabajo.detalle': '16–74 anys que fan servir internet · {anio}',
  'datos-globales.cuadro.formacion': 'Adults que es van formar',
  'datos-globales.cuadro.formacion.detalle': '25–64 anys · últim mes · {anio}',
  'datos-globales.cuadro.sin-cifra': '¹ Sense xifra oficial comparable publicada: no l’estimem.',
  'datos-globales.cuadro.nota':
    'Fonts: Eurostat (isoc_eb_ai, isoc_r_eb_ain2, isoc_ai_iaiu i trng_lfse_04) i Idescat (ticll25, per a les persones de Catalunya). Data de consulta: {fecha}.',
  'datos-globales.metodo.titulo': 'Com comparem',
  'datos-globales.metodo.misma.titulo': 'El mateix amb el mateix.',
  'datos-globales.metodo.misma.texto':
    'La mateixa pregunta, les mateixes edats, la mateixa base i el mateix any a cada comparació. El que no es mesura igual no es compara, i es diu. Per això no hi ha els Estats Units.',
  'datos-globales.metodo.comparable.titulo': 'Només el que és comparable.',
  'datos-globales.metodo.comparable.texto':
    'Una xifra que la font marca com a no comparable (una altra definició o una ruptura de sèrie) no es mostra ni entra en cap càlcul. Per això la sèrie d’empreses no inclou el 2021: aleshores es preguntava per menys tecnologies. Cada fitxa tècnica diu què en queda fora.',
  'datos-globales.metodo.orden.titulo': 'De més a menys.',
  'datos-globales.metodo.orden.texto':
    'A cada gràfic, els territoris van de la xifra més alta a la més baixa. A les taules, sempre en el mateix ordre: Catalunya, Espanya (amb Catalunya), Alemanya, França i Itàlia, i la mitjana de la UE al final.',
  'datos-globales.metodo.ue.titulo': 'La mitjana de la UE, com a referència.',
  'datos-globales.metodo.ue.texto':
    'És la xifra dels 27 països junts i inclou Espanya, Alemanya, França i Itàlia. Per això va en taronja i discontínua, mai com un país més. Els seus capítols són a la pàgina «Unió Europea».',
  'datos-globales.metodo.base.titulo': 'Persones: cada pàgina, la seva base.',
  'datos-globales.metodo.base.texto':
    'Aquí, les xifres de persones es compten sobre qui fa servir internet; a la pàgina «Unió Europea», sobre tota la població de 16 a 74 anys. Cada gràfic ho diu al subtítol.',
  'datos-globales.metodo.margen.titulo': 'Un punt, com a mínim.',
  'datos-globales.metodo.margen.texto':
    'La mostra de Catalunya és més petita que la d’un país. No diem que un territori va al davant si no treu almenys un punt al següent.',
  'datos-globales.metodo.sin-cifra.titulo': 'Sense dada oficial, no hi ha xifra.',
  'datos-globales.metodo.sin-cifra.texto': 'Ho diem; no ho estimem.',
  'datos-globales.metodo.medido.titulo': '{0} Mesurat',
  'datos-globales.metodo.medido.texto': 'vol dir que surt d’una enquesta oficial.',
  'datos-globales.metodo.medido.todas':
    'Totes les xifres d’aquest dossier són mesurades, llevat de les dels capítols d’opinió, marcades «{0} Enquesta d’opinió»: diuen el que la gent creu, no el que passa. La d’especialistes en TIC de la UE surt de l’enquesta de població activa i Eurostat la marca com a estimada («e»); ho diu la seva fitxa.',
  'datos-globales.metodo.no-dicen.titulo': 'El que aquestes dades no diuen',
  'datos-globales.metodo.no-dicen.texto':
    'Descriuen territoris. No diuen res d’una persona concreta, ni de la seva feina, ni del que li passarà. Fer servir la IA, o estar-hi exposat, no equival a perdre la feina.',
  'datos-globales.ue.antetitulo': 'Dades globals · Unió Europea',
  'datos-globales.ue.titulo': 'La Unió Europea',
  'datos-globales.ue.entradilla':
    'Les mateixes preguntes per al conjunt de la UE: quantes empreses fan servir IA, quanta gent fa servir IA generativa i quant falta per a les fites digitals que la UE es va fixar per al 2030.',
  'datos-globales.ue.prudencia.titulo': 'És una mitjana de 27 països.',
  'datos-globales.ue.prudencia.texto':
    'Inclou Espanya, Alemanya, França i Itàlia, i per això aquí no es compara amb ells. Són dades de territoris, no de persones: no diuen res de la feina de qui llegeix.',
  'datos-globales.ue.clave-colores.nombre': 'Com es llegeixen els gràfics d’aquesta pàgina',
  'datos-globales.ue.clave-colores.ue': 'La UE-27, protagonista d’aquesta pàgina',
  'datos-globales.ue.clave-colores.grupos': 'Grups dins de la UE: mida, edat, ocupació…',
  'datos-globales.ue.clave-colores.meta': 'Fita per al 2030',
  'datos-globales.ue.esencial.nota':
    'Xifres del conjunt dels 27 països. Les de persones es compten sobre tota la població de 16 a 74 anys, i no sobre qui fa servir internet com a «Catalunya»: per això no es creuen.',
  'datos-globales.ue.margen':
    'La mostra de tota la UE és molt gran: el marge d’error és petit, però diferències d’unes dècimes poden no ser reals.',
  'datos-globales.ue.no-comparable': '{anio}',
  'datos-globales.ue.esencial.empresas':
    'És a dir, {cifra} de cada 100 empreses de la UE amb 10 o més persones fan servir alguna tecnologia d’IA.',
  'datos-globales.ue.esencial.empresas.comparacion': 'De cada 100 empreses, quantes la feien servir cada any:',
  'datos-globales.ue.esencial.empresas.pie':
    'Des del {desde}: abans es preguntava per menys tecnologies. Font: Eurostat',
  'datos-globales.ue.esencial.personas':
    'És a dir, {cifra} de cada 100 persones de 16 a 74 anys van fer servir IA generativa els últims tres mesos.',
  'datos-globales.ue.esencial.personas.comparacion': 'De cada 100 persones de cada edat:',
  'datos-globales.ue.esencial.personas.pie': 'Sobre tota la població, faci servir o no internet. Font: Eurostat',
  'datos-globales.ue.esencial.capacidades.tema': 'Capacitats · {anio}',
  'datos-globales.ue.esencial.capacidades':
    'És a dir, {cifra} de cada 100 persones de 16 a 74 anys saben almenys el bàsic del món digital. La fita per al {anio} és {meta} de cada 100.',
  'datos-globales.ue.esencial.capacidades.comparacion': 'De cada 100 persones, cada any:',
  'datos-globales.ue.esencial.especialistas.tema': 'Especialistes TIC · {anio}',
  'datos-globales.ue.esencial.millones': 'milions',
  'datos-globales.ue.esencial.especialistas':
    'd’especialistes en tecnologies de la informació (TIC) treballen a la UE. La fita per al {anio} és de {meta} milions.',
  'datos-globales.ue.esencial.especialistas.comparacion': 'Milions d’especialistes, avui i la fita:',
  'datos-globales.ue.esencial.meta': 'Fita {anio}',
  'datos-globales.ue.esencial.especialistas.pie': 'Estimació d’Eurostat. De cada 100, {mujeres} són dones.',
  'datos-globales.numero.0': 'zero',
  'datos-globales.numero.1': 'un',
  'datos-globales.numero.2': 'dos',
  'datos-globales.numero.3': 'tres',
  'datos-globales.numero.4': 'quatre',
  'datos-globales.numero.5': 'cinc',
  'datos-globales.numero.6': 'sis',
  'datos-globales.numero.7': 'set',
  'datos-globales.numero.8': 'vuit',
  'datos-globales.numero.9': 'nou',
  'datos-globales.numero.10': 'deu',
  'datos-globales.ue.empresas.pregunta': 'Quantes empreses de la UE fan servir IA?',
  'datos-globales.ue.empresas.titular.quinto-doble':
    '1 de cada 5 empreses de la UE ja fan servir IA: més del doble que el {desde}',
  'datos-globales.ue.empresas.titular.quinto': '1 de cada 5 empreses de la UE ja fan servir IA',
  'datos-globales.ue.empresas.titular.cifra-doble':
    '{cifra} de cada 100 empreses de la UE fan servir IA: més del doble que el {desde}',
  'datos-globales.ue.empresas.titular.cifra': '{cifra} de cada 100 empreses de la UE fan servir IA',
  'datos-globales.ue.empresas.entradilla':
    'El {desde} feien servir IA {inicio} de cada 100 empreses de la UE amb 10 o més persones; el {hasta}, {fin}.',
  'datos-globales.ue.empresas.figura.evolucion':
    'De cada 100 empreses de la UE, quantes fan servir almenys una tecnologia d’IA',
  'datos-globales.ue.empresas.figura.evolucion.sub':
    'Empreses amb 10 o més persones (sense agricultura, mineria ni sector financer). UE-27, {desde}–{hasta}.',
  'datos-globales.ue.empresas.fuente': 'Eurostat (isoc_eb_ai)',
  'datos-globales.ue.empresas.figura.tamano': 'Segons la mida de l’empresa',
  'datos-globales.ue.empresas.figura.tamano.sub':
    'De cada 100 empreses de cada mida, quantes fan servir IA. UE-27, {anio}.',
  'datos-globales.ue.empresas.lectura.evolucion':
    'El {desde} feien servir IA {inicio} de cada 100 empreses de la UE; el {hasta}, {fin}.',
  'datos-globales.ue.empresas.lectura.tamano.mucho': 'Les grans, molt més',
  'datos-globales.ue.empresas.lectura.tamano.mas': 'Les grans, més',
  'datos-globales.ue.empresas.lectura.tamano':
    'La fan servir {grandes} de cada 100 empreses de 250 persones o més i {pequenas} de cada 100 de les de 10 a 49.',
  'datos-globales.ue.empresas.lectura.medianas.titulo': 'Les mitjanes',
  'datos-globales.ue.empresas.lectura.medianas': 'Entre les de 50 a 249 persones, la fan servir {cifra} de cada 100.',
  'datos-globales.ue.empresas.ficha.anios':
    'Del {desde} al {hasta}. El 2022 l’enquesta no va preguntar per la IA, i la xifra del 2021 es va mesurar amb menys tecnologies.',
  'datos-globales.ue.tecnologias.pregunta': 'Quin tipus d’IA fan servir les empreses?',
  'datos-globales.ue.tecnologias.titular.primera':
    'La IA que més fan servir les empreses de la UE és la que serveix per {tecnologia}: {cifra} de cada 100',
  'datos-globales.ue.tecnologias.entradilla':
    'Per a quin tipus de tasca fan servir IA les empreses de la UE i en quina part de la seva feina. Una empresa pot fer servir diversos tipus: per això les xifres no sumen el total.',
  'datos-globales.ue.tecnologias.figura': 'De cada 100 empreses de la UE, quantes fan servir cada tipus d’IA, i on',
  'datos-globales.ue.tecnologias.figura.sub': 'Empreses amb 10 o més persones. UE-27, {anio}.',
  'datos-globales.ue.tecnologias.panel.tipos': 'Per a quin tipus de tasca',
  'datos-globales.ue.tecnologias.panel.usos': 'En quina part de l’empresa',
  'datos-globales.ue.tecnologias.texto.frase': 'analitzar textos',
  'datos-globales.ue.tecnologias.imagen-video-sonido.frase': 'crear imatge o so',
  'datos-globales.ue.tecnologias.lenguaje.frase': 'redactar o programar',
  'datos-globales.ue.tecnologias.voz.frase': 'entendre la veu',
  'datos-globales.ue.tecnologias.automatizacion.frase': 'automatitzar tasques',
  'datos-globales.ue.tecnologias.aprendizaje-automatico.frase': 'aprendre de dades',
  'datos-globales.ue.tecnologias.reconocimiento-imagenes.frase': 'reconèixer imatges',
  'datos-globales.ue.tecnologias.robots.frase': 'moure robots autònoms',
  'datos-globales.ue.tecnologias.lectura.primera.titulo': '{tecnologia}, la primera',
  'datos-globales.ue.tecnologias.lectura.primera': 'La fan servir {cifra} de cada 100 empreses de la UE.',
  'datos-globales.ue.tecnologias.lectura.sectores':
    'Fan servir IA {j} de cada 100 empreses d’informació i comunicació i {f} de cada 100 de la construcció.',
  'datos-globales.ue.tecnologias.lectura.frena':
    '{cifra} de cada 100 empreses van pensar a fer servir IA i no la fan servir per falta de coneixements: és el motiu que més es repeteix.',
  'datos-globales.ue.personas.pregunta': 'Quanta gent fa servir la IA generativa?',
  'datos-globales.ue.personas.titular.tercio': 'Gairebé 1 de cada 3 persones de la UE van fer servir IA generativa',
  'datos-globales.ue.personas.titular.cifra': '{cifra} de cada 100 persones de la UE van fer servir IA generativa',
  'datos-globales.ue.personas.entradilla':
    'El {anio}, la van fer servir {cifra} de cada 100 persones de 16 a 74 anys de la UE, facin servir o no internet.',
  'datos-globales.ue.personas.figura':
    'De cada 100 persones de la UE, quantes van fer servir IA generativa els últims tres mesos',
  'datos-globales.ue.personas.figura.sub':
    'Tota la població de 16 a 74 anys, faci servir o no internet. UE-27, {anio}.',
  'datos-globales.ue.personas.panel.para-que': 'Per a què la van fer servir',
  'datos-globales.ue.personas.panel.edad': 'Per edat',
  'datos-globales.ue.personas.fuente': 'Eurostat (isoc_ai_iaiu)',
  'datos-globales.ue.personas.lectura.edades.mucho': 'Els joves, molt més',
  'datos-globales.ue.personas.lectura.edades.titulo': 'Joves i grans',
  'datos-globales.ue.personas.lectura.edades':
    'La van fer servir {jovenes} de cada 100 joves de 16 a 24 anys i {mayores} de cada 100 persones de 65 a 74.',
  'datos-globales.ue.personas.lectura.por-que':
    'De cada 100 persones que no la van fer servir, {necesita} diuen que no la necessiten i {sabe}, que no saben com fer-la servir.',
  'datos-globales.ue.personas.lectura.base.titulo': 'Una altra base que a Catalunya',
  'datos-globales.ue.personas.lectura.base':
    'Aquí es compta tota la població de 16 a 74 anys. Comptant només qui fa servir internet, com a «Catalunya», la van fer servir {internet} de cada 100.',
  'datos-globales.ue.genero.pregunta': 'Hi ha diferències entre dones i homes?',
  'datos-globales.ue.genero.titular.hombres':
    'Sí: a la UE la fan servir {hombres} de cada 100 homes i {mujeres} de cada 100 dones',
  'datos-globales.ue.genero.titular.mujeres':
    'Sí: a la UE la fan servir {mujeres} de cada 100 dones i {hombres} de cada 100 homes',
  'datos-globales.ue.genero.titular.parecido':
    'A la UE, dones i homes la fan servir de manera semblant: {mujeres} i {hombres} de cada 100',
  'datos-globales.ue.genero.entradilla.todos':
    'Els homes la fan servir més que les dones per a totes les finalitats que pregunta l’enquesta.',
  'datos-globales.ue.genero.entradilla.mixta':
    'La diferència no és igual en tots els usos: en algun, dones i homes la fan servir de manera semblant.',
  'datos-globales.ue.genero.figura':
    'De cada 100 dones i de cada 100 homes de la UE, quants van fer servir IA generativa, segons per a què',
  'datos-globales.ue.genero.figura.sub':
    'Tota la població de 16 a 74 anys. UE-27, {anio}. A la dreta, la diferència en punts: la xifra dels homes menys la de les dones.',
  'datos-globales.ue.genero.nota': 'Cercle: dones. Quadrat: homes. La línia entre els dos és la diferència.',
  'datos-globales.ue.genero.lectura.cualquier.titulo': '{puntos} punts de diferència',
  'datos-globales.ue.genero.lectura.cualquier':
    'Van fer servir IA generativa {hombres} de cada 100 homes i {mujeres} de cada 100 dones de 16 a 74 anys.',
  'datos-globales.ue.genero.lectura.estudios.mas': 'Per estudiar, més els homes',
  'datos-globales.ue.genero.lectura.estudios.parecido': 'Per estudiar, igual',
  'datos-globales.ue.genero.lectura.estudios.menos': 'Per estudiar, més les dones',
  'datos-globales.ue.genero.lectura.estudios':
    'La van fer servir per als estudis {mujeres} de cada 100 dones i {hombres} de cada 100 homes.',
  'datos-globales.ue.genero.lectura.capacidades':
    'Tenen almenys capacitats digitals bàsiques {mujeres} de cada 100 dones i {hombres} de cada 100 homes.',
  'datos-globales.ue.trabajo.pregunta': 'Quanta gent la fa servir per treballar?',
  'datos-globales.ue.trabajo.titular.cifra':
    'La fan servir per a la feina {cifra} de cada 100 persones que treballen a la UE',
  'datos-globales.ue.trabajo.entradilla':
    'Quant es fa servir la IA generativa per treballar segons l’ocupació i els estudis. UE-27, {anio}.',
  'datos-globales.ue.trabajo.figura':
    'De cada 100 persones de cada grup, quantes van fer servir IA generativa per a la feina',
  'datos-globales.ue.trabajo.figura.sub': 'UE-27, {anio}. Cada panell diu la seva base.',
  'datos-globales.ue.trabajo.panel.ocupacion': 'Segons l’ocupació (de cada 100 persones que treballen)',
  'datos-globales.ue.trabajo.panel.estudios': 'Segons els estudis (de cada 100 persones de 16 a 74 anys)',
  'datos-globales.ue.trabajo.lectura.ocupacion':
    'La fan servir per a la feina {noManual} de cada 100 persones amb una feina no manual i {manual} de cada 100 amb una de manual.',
  'datos-globales.ue.trabajo.lectura.tic':
    'La fan servir per a la feina {cifra} de cada 100 persones que treballen en informàtica i telecomunicacions.',
  'datos-globales.ue.trabajo.lectura.estudios.titulo': 'Segons els estudis',
  'datos-globales.ue.trabajo.lectura.estudios':
    'La fan servir per a la feina {superiores} de cada 100 persones amb estudis superiors i {bajos} de cada 100 amb estudis baixos o sense estudis.',
  'datos-globales.ue.capacidades.pregunta': 'Quanta gent sap moure’s en el món digital?',
  'datos-globales.ue.capacidades.titular.seis':
    '6 de cada 10 persones de la UE tenen almenys capacitats digitals bàsiques',
  'datos-globales.ue.capacidades.titular.cifra':
    '{cifra} de cada 100 persones de la UE tenen almenys capacitats digitals bàsiques',
  'datos-globales.ue.capacidades.entradilla':
    'El {desde} les tenien {inicio} de cada 100 persones de 16 a 74 anys; el {hasta}, {fin}.',
  'datos-globales.ue.capacidades.entradilla.meta': 'La fita de la UE per al {anio} és {meta} de cada 100.',
  'datos-globales.ue.capacidades.figura.evolucion':
    'De cada 100 persones, quantes tenen almenys capacitats digitals bàsiques',
  'datos-globales.ue.capacidades.figura.evolucion.sub':
    'Tota la població de 16 a 74 anys. Es mesura cada dos anys. UE-27, {desde}–{hasta}.',
  'datos-globales.ue.capacidades.fuente': 'Eurostat (isoc_sk_dskl_i21)',
  'datos-globales.ue.capacidades.figura': 'Nivells i àrees de les capacitats digitals',
  'datos-globales.ue.capacidades.figura.sub': 'De cada 100 persones de 16 a 74 anys. UE-27, {anio}.',
  'datos-globales.ue.capacidades.panel.niveles': 'Nivell de capacitats',
  'datos-globales.ue.capacidades.panel.areas': 'Almenys bàsiques a cada àrea',
  'datos-globales.ue.capacidades.lectura.evolucion':
    'El {desde} tenien almenys capacitats bàsiques {inicio} de cada 100 persones; el {hasta}, {fin}: {puntos} punts de diferència (la resta de les dues xifres).',
  'datos-globales.ue.capacidades.lectura.avanzadas':
    'Tenen capacitats per sobre de les bàsiques {cifra} de cada 100 persones; el {desde}, {inicio}.',
  'datos-globales.ue.capacidades.lectura.dificil':
    'Saben almenys el bàsic per {area} {cifra} de cada 100 persones: és l’àrea que menys gent domina. Per {otra}, {otraCifra} de cada 100.',
  'datos-globales.ue.metas.pregunta': 'Quant li falta a la UE per a les fites del 2030?',
  'datos-globales.ue.metas.titular.ninguna':
    'A {faltan} anys del {anio}, la UE no ha assolit cap de les seves {numero} fites digitals',
  'datos-globales.ue.metas.entradilla':
    'La més llunyana és la de {lejana}: {valorLejana} de {metaLejana}. La més propera, la de {cercana}: {valorCercana} de {metaCercana}.',
  'datos-globales.ue.metas.corto.meta-capacidades-digitales': 'capacitats digitals',
  'datos-globales.ue.metas.corto.meta-especialistas-tic': 'especialistes en TIC',
  'datos-globales.ue.metas.corto.meta-empresas-nube-datos-ia': 'empreses que fan servir núvol, anàlisi de dades o IA',
  'datos-globales.ue.metas.corto.meta-pymes-intensidad-digital': 'pimes amb intensitat digital bàsica',
  'datos-globales.ue.metas.figura': 'Última dada de la UE-27 davant de cada fita per al {anio}',
  'datos-globales.ue.metas.figura.sub':
    'Cada barra amb la seva escala real: de 0 a 100 %, o en milions de persones en especialistes. La ratlla vertical és la fita.',
  'datos-globales.ue.metas.fuente.figura':
    'Eurostat (isoc_sk_dskl_i21, isoc_sks_itspt, isoc_eb_ai i isoc_e_dii). Fites: Decisió (UE) 2022/2481, article 4',
  'datos-globales.ue.metas.nota': 'Una fita no és una previsió: el gràfic no diu si s’assolirà.',
  'datos-globales.ue.metas.rotulo.valor': '{anio}: {valor}',
  'datos-globales.ue.metas.rotulo.meta': 'Fita {anio}: {meta}',
  'datos-globales.ue.metas.rotulo.meta.mas': 'Fita {anio}: més del {meta}',
  'datos-globales.ue.metas.alcanzada': 'Fita assolida',
  'datos-globales.ue.metas.anteriores': 'Ratlles fines dins de la barra: {lista}.',
  'datos-globales.ue.metas.anterior': '{anio}, {valor}',
  'datos-globales.ue.metas.alternativa': '{nombre}: {valor} el {anio}; fita per al {anioMeta}, {meta}.',
  'datos-globales.ue.metas.lectura.capacidades-digitales.titulo': 'Falten {faltan} punts en capacitats digitals',
  'datos-globales.ue.metas.lectura.capacidades-digitales':
    'Avui saben almenys el bàsic del món digital {cifra} de cada 100 persones de 16 a 74 anys; la fita és {meta} de cada 100. Punts: la resta entre les dues xifres.',
  'datos-globales.ue.metas.lectura.especialistas-tic.titulo': 'Falten {faltan} milions d’especialistes',
  'datos-globales.ue.metas.lectura.especialistas-tic':
    'Avui treballen a la UE {cifra} milions d’especialistes en tecnologies de la informació; la fita és {meta} milions. De cada 100, {mujeres} són dones.',
  'datos-globales.ue.metas.lectura.empresas-nube-datos-ia.titulo': 'Falten {faltan} punts a les empreses',
  'datos-globales.ue.metas.lectura.empresas-nube-datos-ia':
    'Avui fan servir núvol, anàlisi de dades o IA {cifra} de cada 100 empreses; la fita és {meta} de cada 100.',
  'datos-globales.ue.especialistas.pregunta': 'Quants especialistes en tecnologia treballen a la UE?',
  'datos-globales.ue.especialistas.titular.cifra': 'A la UE treballen {cifra} milions d’especialistes en TIC',
  'datos-globales.ue.especialistas.titular.cifra-mitad':
    'A la UE treballen {cifra} milions d’especialistes en TIC, i a més de la meitat de les empreses que en busquen els costa trobar-ne',
  'datos-globales.ue.especialistas.entradilla':
    'Són persones que es dediquen sobretot a la informàtica: {empleo} de cada 100 persones ocupades, segons una estimació d’Eurostat. De cada 100 especialistes, {mujeres} són dones.',
  'datos-globales.ue.especialistas.figura': 'Les empreses de la UE i els especialistes en TIC',
  'datos-globales.ue.especialistas.figura.sub':
    'Empreses amb 10 o més persones. UE-27, {anio}. Cada panell diu la seva base.',
  'datos-globales.ue.especialistas.panel.empresas': 'De cada 100 empreses, quantes…',
  'datos-globales.ue.especialistas.panel.motivos':
    'De cada 100 que en van buscar, quantes van tenir vacants difícils, i per què',
  'datos-globales.ue.especialistas.fuente': 'Eurostat (isoc_ske_itspen2 i isoc_ske_itrcrn2)',
  'datos-globales.ue.especialistas.nota': 'Una empresa pot donar diversos motius: no sumen 100.',
  'datos-globales.ue.especialistas.lectura.vacantes.titulo': 'Vacants difícils',
  'datos-globales.ue.especialistas.lectura.vacantes':
    'De cada 100 empreses que van buscar especialistes en TIC, {cifra} van tenir vacants difícils de cobrir. El {anio}, {anterior}.',
  'datos-globales.ue.especialistas.lectura.vacantes.sola':
    'De cada 100 empreses que van buscar especialistes en TIC, {cifra} van tenir vacants difícils de cobrir.',
  'datos-globales.ue.especialistas.lectura.quien':
    '{cifra} de cada 100 empreses amb 10 o més persones tenen especialistes en TIC a la plantilla.',
  'datos-globales.ue.formacion.pregunta': 'Quanta gent adulta s’està formant?',
  'datos-globales.ue.formacion.titular.sube': 'Cada any es formen més adults a la UE: {cifra} de cada 100 el {anio}',
  'datos-globales.ue.formacion.titular.cifra': '{cifra} de cada 100 adults de la UE van fer algun curs l’últim mes',
  'datos-globales.ue.formacion.entradilla':
    'Persones de 25 a 64 anys que van fer algun curs o formació les quatre setmanes anteriors. Compta qualsevol formació, no només sobre IA.',
  'datos-globales.ue.formacion.figura.evolucion':
    'De cada 100 adults de 25 a 64 anys, quants es van formar l’últim mes',
  'datos-globales.ue.formacion.figura.evolucion.sub': 'Enquesta de població activa. UE-27, {desde}–{hasta}.',
  'datos-globales.ue.formacion.fuente': 'Eurostat (trng_lfse_04)',
  'datos-globales.ue.formacion.figura':
    'De cada 100 empreses de la UE, quantes van formar el seu personal en informàtica',
  'datos-globales.ue.formacion.figura.sub': 'Empreses amb 10 o més persones. UE-27, {anio}.',
  'datos-globales.ue.formacion.fuente.empresas': 'Eurostat (isoc_ske_ittn2)',
  'datos-globales.ue.formacion.lectura.evolucion':
    'El {desde} es formaven {inicio} de cada 100 adults de la UE; el {hasta}, {fin}.',
  'datos-globales.ue.formacion.lectura.sexo':
    'Es van formar {mujeres} de cada 100 dones i {hombres} de cada 100 homes de 25 a 64 anys.',
  'datos-globales.ue.formacion.lectura.empresas.titulo': 'A les empreses',
  'datos-globales.ue.formacion.lectura.empresas':
    '{cifra} de cada 100 empreses van formar el seu personal en informàtica el {anio}.',
  'datos-globales.ue.opinion.pregunta': 'Què opina la gent de la IA a la feina?',
  'datos-globales.ue.opinion.entradilla':
    'El que opina la gent dels 27 països, segons una enquesta de la Comissió Europea del {anio}. És opinió, no una mesura: diu el que la gent creu, no el que passa a la seva feina.',
  'datos-globales.ue.opinion.figura':
    'De cada 100 persones de 15 anys o més de la UE, quantes estan d’acord amb cada frase o veuen important cada regla',
  'datos-globales.ue.opinion.figura.sub':
    'Eurobaròmetre especial 554, abril i maig del {anio}. Xifres senceres, com les publica.',
  'datos-globales.ue.opinion.panel.frases': 'Els robots i la IA a la feina',
  'datos-globales.ue.opinion.panel.reglas': 'Regles per a la IA a la feina',
  'datos-globales.ue.opinion.fuente': 'Comissió Europea, Eurobaròmetre especial 554 ({preguntas})',
  'datos-globales.ue.opinion.lectura.positiva':
    'Veuen bé l’ús de robots i IA a la feina {cifra} de cada 100 persones de la UE.',
  'datos-globales.ue.opinion.lectura.destruira':
    'Creuen que desapareixeran més llocs de treball dels que es crearan {cifra} de cada 100.',
  'datos-globales.ue.opinion.lectura.herramientas':
    'De cada 100 persones que treballen per a una empresa o un cap, {cifra} diuen que els donen les eines o la formació per treballar amb la IA.',
  'datos-globales.ue.opinion.lectura.trabajo': '{pregunta}: {cifra} de cada 100.',
  'datos-globales.ue.opinion.lectura.reglas.titulo': 'I demanen regles',
  'datos-globales.ue.opinion.lectura.reglas':
    'Veuen important cada regla entre {minimo} i {maximo} de cada 100 persones.',
  'datos-globales.ue.opinion.ficha.margen': 'Més de 26.000 entrevistes a tota la UE: el marge d’error és petit.',
  'globo.ficha.anio-grafico': '{anio}.',
  'globo.ficha.anios-grafico': 'Del {desde} al {hasta}, amb els anys al seu lloc proporcional.',
  'globo.ficha.no-comparable':
    'Sense dada comparable el {anios}: la font la marca com a no comparable (una altra definició o una ruptura de sèrie). No es mostra.',
  'globo.ficha.genero.nota':
    'Cercle: dones. Quadrat: homes. A la dreta, la diferència en punts: la xifra dels homes menys la de les dones.',
};
