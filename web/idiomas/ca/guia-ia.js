// Textos de la guia «Què és la IA» (entender-ia.html) en català: les set parts, l'exemple de la paraula següent
// (scripts/ejemplo-ia.js), el glossari (scripts/glosario.js) i el desafiament (scripts/desafio-ia.js). S'incorporen
// al diccionari de ca.js, amb les mateixes claus i els mateixos marcadors que es/guia-ia.js.

/**
 * Diccionari de només lectura (clau -> text) en català amb els textos de la guia «Què és la IA».
 * @type {Readonly<Record<string, string>>}
 */
export const TEXTOS_GUIA_IA = {
  // ---------- Capçalera i parts ----------
  'entender-ia.titulo': 'Què és la IA · Faro',
  'entender-ia.descripcion':
    'Guia de Faro sobre intel·ligència artificial: què és, com aprèn, quines precaucions cal prendre i què pot canviar en la teva feina. Amb un glossari i un desafiament per posar-te a prova.',
  'entender-ia.antetitulo': 'Què és la IA · Guia de Faro',
  'entender-ia.titulo-principal': 'Intel·ligència artificial',
  'entender-ia.intro':
    'El que és essencial per entendre què és, com funciona, quines precaucions cal prendre i què pot canviar en la teva feina. Es llegeix en uns minuts i, al final, pots posar-te a prova amb el desafiament. Si una paraula t’atura, mira-la al {0}.',
  'entender-ia.intro.glosario': 'glossari',
  'entender-ia.etapas.nombre': 'Parts de la guia',
  'entender-ia.etapas.controles': 'Canviar de part',
  'entender-ia.etapas.rotulo': 'Guia de Faro · {numero} de {total}',
  'entender-ia.etapas.paso': '{numero} de {total} · {nombre}',
  'entender-ia.etapas.final': 'Final de la guia',
  'entender-ia.etapas.empezar': 'Començar el teu recorregut',
  'entender-ia.etapa.1': 'Què és la IA',
  'entender-ia.etapa.2': 'Com aprèn',
  'entender-ia.etapa.3': 'La IA que escriu',
  'entender-ia.etapa.4': 'Precaucions',
  'entender-ia.etapa.5': 'La IA en la teva feina',
  'entender-ia.etapa.6': 'Glossari',
  'entender-ia.etapa.7': 'Desafiament',
  'entender-ia.etapa.7.largo': 'Desafiament: quant en saps, de la IA?',

  // ---------- 1 · Què és la IA ----------
  'entender-ia.p1.titulo': 'Què és la intel·ligència artificial',
  'entender-ia.p1.definicion':
    'La intel·ligència artificial (IA) és una tecnologia que aprèn de moltíssims exemples per fer tasques com entendre el que dius, traduir un text o escriure un correu. No pensa ni entén com una persona: busca semblances amb el que ja ha vist i dona la resposta que li sembla més probable.',
  'entender-ia.p1.usos':
    'Segurament ja la fas servir sense adonar-te’n. És al teclat del mòbil que et suggereix la paraula següent, al correu que aparta l’spam, al dictat que converteix la teva veu en text i als subtítols automàtics d’un vídeo. A la feina apareix, per exemple, al traductor que t’ajuda a entendre un missatge en una altra llengua. Els cursos de divulgació la resumeixen en dos trets: fa tasques sense que ningú li indiqui cada pas i millora a mesura que veu més exemples{0}.',
  'entender-ia.p1.ahora.titulo': 'Què ha canviat',
  'entender-ia.p1.ahora':
    'La IA fa anys que funciona en segon pla, sense que la vegem. El que és nou és que, des de finals del 2022, qualsevol persona pot conversar amb assistents d’IA que escriuen, resumeixen, tradueixen i responen amb frases completes. N’hi ha prou d’escriure’ls el que necessites en la teva llengua, sense saber res d’informàtica. Per això es nota tant en la feina d’oficina, que en bona part consisteix a llegir i escriure: correus, informes, actes o respostes a clients. Aquesta IA que crea textos, imatges o veus s’anomena {0}, i és la que ocupa més espai en aquesta guia.',
  'entender-ia.p1.termino.generativa': 'IA generativa',
  'entender-ia.p1.no-es.titulo': 'El que no és',
  'entender-ia.p1.no-es':
    'El nom enganya una mica. «Intel·ligència» fa pensar en algú que pensa, i no és així. La IA no té opinions, intencions ni consciència, i no sap si el que diu és veritat: només sap què és probable. Per això, tot i que l’encerta molt sovint, sona igual de segura quan s’equivoca. Tampoc no és un robot ni una sola màquina: és una tecnologia que va dins de moltes aplicacions que ja coneixes.',
  'entender-ia.p1.ley.titulo': 'Per què et convé entendre-la',
  'entender-ia.p1.ley':
    'La Unió Europea té una llei pròpia sobre la IA{0}. Des del febrer del 2025 demana a les organitzacions que la creen o la fan servir que ajudin el seu personal a entendre-la. Aquesta guia et dona aquesta base, sense tecnicismes: com aprèn, quines precaucions convé prendre i què pot canviar en la teva feina.',
  'entender-ia.p1.cierre':
    'Ben utilitzada, la IA t’estalvia temps quan has de llegir, escriure o resumir. L’última paraula, i la responsabilitat del que envies, continuen sent teves.',

  // ---------- 2 · Com aprèn ----------
  'entender-ia.p2.titulo': 'Com aprèn',
  'entender-ia.p2.cancion':
    'Pensa en una cançó que has sentit moltes vegades. Sonen les primeres notes a la ràdio i ja saps quina és. Ningú no et va donar cap regla per reconèixer-la: l’has escoltada tant que la teva oïda reconeix el que es repeteix. La IA aprèn d’una manera semblant, amb moltíssims més exemples. Això s’anomena {0}{1}.',
  'entender-ia.p2.termino.aprendizaje': 'aprenentatge automàtic',
  'entender-ia.p2.correo.titulo': 'Un exemple: el filtre del correu',
  'entender-ia.p2.correo':
    'El filtre d’spam comença veient milers de missatges que altres persones ja van marcar com a spam o no. Amb aquests missatges descobreix el que es repeteix: paraules com «premi» o «gratis», remitents desconeguts, enllaços estranys. Quan arriba un correu nou, mira a quin grup s’assembla més i el deixa a la safata o l’aparta.',
  'entender-ia.p2.fallo':
    'Per això de vegades s’equivoca. L’avís d’un «taller gratuït» de l’ajuntament pot acabar a l’spam. Val la pena fer un cop d’ull a aquesta carpeta de tant en tant.',
  'entender-ia.p2.ejemplos.titulo': 'Tan bona com els seus exemples',
  'entender-ia.p2.ejemplos':
    'La fase d’aprendre s’anomena {0}, i el que ha après, {1}. D’aquí surt una idea important: la IA és tan bona com els exemples dels quals va aprendre. Si són pocs, antics o no reflecteixen bé la realitat, les seves respostes fallaran. I si aquests exemples arrosseguen prejudicis, la IA els aprèn amb ells.',
  'entender-ia.p2.termino.entrenamiento': 'entrenament',
  'entender-ia.p2.termino.modelo': 'model',

  // ---------- 3 · La IA que escriu, amb l'exemple de la paraula següent ----------
  'entender-ia.p3.titulo': 'La IA que escriu',
  'entender-ia.p3.intro':
    'Quan escrius una pregunta en un assistent d’IA i la resposta apareix paraula per paraula, estàs fent servir un {0}. És la forma més coneguda d’{1}, la que crea textos, imatges o veus noves.',
  'entender-ia.p3.termino.lenguaje': 'model de llenguatge',
  'entender-ia.p3.termino.generativa': 'IA generativa',
  'entender-ia.p3.teclado':
    'La seva idea bàsica ja la coneixes: el teclat del mòbil que et suggereix la paraula següent{0}. Un model de llenguatge fa el mateix a gran escala. Ha après d’enormes quantitats de textos i calcula quina paraula és més probable que vingui després del que ja està escrit{1}. L’afegeix, torna a calcular i així, paraula per paraula, escriu textos sencers.',
  'entender-ia.ejemplo.titulo': 'Prova-ho: tria un inici de frase',
  'entender-ia.ejemplo.leyenda': 'Inicis de frase',
  'entender-ia.ejemplo.0.frase': 'Aquest matí he anat al…',
  'entender-ia.ejemplo.1.frase': 'Per preparar una factura necessito les dades del…',
  'entender-ia.ejemplo.2.frase': 'El termini per presentar la reclamació és de dos…',
  'entender-ia.ejemplo.cabecera': 'Paraules que poden venir després, de més a menys probable',
  'entender-ia.ejemplo.mas': 'Veure 15 paraules més',
  'entender-ia.ejemplo.menos': 'Veure només les 5 primeres',
  'entender-ia.ejemplo.resumen':
    'Aquestes {numero} paraules sumen {suma} de les possibilitats. Queda {resto} per a milers de paraules més (i algun signe, com el punt), i cap d’elles no supera {tope}.',
  'entender-ia.ejemplo.cifra': 'el {cifra}',
  'entender-ia.ejemplo.cifra.vocal': 'l’{cifra}',
  'entender-ia.ejemplo.nota':
    'Són percentatges reals de Salamandra 2B, un model de llenguatge obert del Barcelona Supercomputing Center, calculats el 19 d’octubre del 2026. El model reparteix el 100 % entre totes les paraules que coneix; aquí es veuen les més probables.',
  'entender-ia.p3.probable':
    'Aquesta és la base de tot el que escriu, i per això escriu amb tanta facilitat. La idea de fons és senzilla: {0}. Moltes vegades és el mateix, però no sempre. Si li preguntes pel termini d’una reclamació sense explicar-li el teu cas ni deixar-li consultar fonts, et pot donar el que es repeteix més en els textos, no necessàriament el teu. I no sempre es queda amb la primera paraula de la llista: tria entre les més probables, com amb un dau trucat en què les de dalt surten més sovint, per no escriure sempre el mateix. Per això la mateixa pregunta et pot donar respostes una mica diferents.',
  'entender-ia.p3.probable.idea': 'tria el que és probable, no el que és cert',
  'entender-ia.p3.pedir.titulo': 'Com demanar-li les coses',
  'entender-ia.p3.pedir':
    'El que li escrius s’anomena {0}; en anglès, {1}. És el seu únic punt de partida. No és el mateix demanar «escriu un correu» que «escriu un correu breu i amable a un client que espera la seva comanda des de fa una setmana». Com més context li dones, més s’ajusta la resposta al que necessites.',
  'entender-ia.p3.termino.instruccion': 'instrucció',

  // ---------- 4 · Precaucions ----------
  'entender-ia.p4.titulo': 'Precaucions',
  'entender-ia.p4.bien':
    'Els assistents d’IA actuals fan molt bé moltes tasques de text. Redacten, resumeixen, tradueixen i expliquen amb molta qualitat, i analitzen els documents que tu els dones: un contracte, un informe o un full de càlcul. Alguns, a més, busquen informació i citen d’on la treuen. Utilitzats amb cura, estalvien molt de temps.',
  'entender-ia.p4.alucinaciones.titulo': 'La precaució principal: les al·lucinacions',
  'entender-ia.p4.alucinaciones':
    'De vegades la IA s’inventa, amb tota seguretat, una dada, una xifra, una cita, una norma o una referència que no existeix. Això s’anomena {0}. Passa perquè genera la resposta més probable, no una resposta comprovada. Cada vegada passa menys, sobretot amb els models nous i quan consulten fonts, però continua passant. A més, cada model va aprendre amb textos recollits fins a una data, la seva data de tall: del que ha passat després no en sap res, tret que ho busqui a internet o en altres fonts actuals. Per això, vés amb especial compte amb les xifres, les dates, les cites, les lleis, els noms i els fets molt concrets o molt recents.',
  'entender-ia.p4.termino.alucinacion': 'al·lucinació',
  'entender-ia.p4.oficina':
    'Un exemple d’oficina: demanes a la IA un correu per a un client amb el preu del manteniment, però no li dones la tarifa. El correu surt impecable i diu: «El manteniment anual costa 240 €». Aquesta xifra no era enlloc: l’ha posada perquè sembla raonable, i la diu amb el mateix to segur que tota la resta.',
  'entender-ia.p4.habitos.titulo': 'Cinc precaucions pràctiques',
  'entender-ia.p4.habitos.1':
    'Comprova a la font original el que importi. Com recorda l’Agència Espanyola de Protecció de Dades (AEPD), aquesta comprovació és responsabilitat de cada persona{0}.',
  'entender-ia.p4.habitos.2': 'Demana-li les fonts i obre-les: que citi un document no garanteix que digui això.',
  'entender-ia.p4.habitos.3': 'Dona-li context, perquè del teu cas només sap el que tu li expliques.',
  'entender-ia.p4.habitos.4':
    'No enganxis dades personals ni confidencials, teves ni de ningú, i segueix les normes de la teva organització sobre quines eines utilitzar.',
  'entender-ia.p4.habitos.5':
    'Fixa’t en possibles biaixos quan parli de persones: pot repetir prejudicis dels textos dels quals va aprendre, com associar certes professions més a homes que a dones{0}.',
  'entender-ia.p4.cierre':
    'Amb aquestes precaucions, la IA és una bona ajuda. I recorda que el que envies ho signes tu: la seva resposta és un punt de partida, no l’última paraula.',

  // ---------- 5 · La IA en la teva feina ----------
  'entender-ia.p5.titulo': 'Què implica per a la teva feina',
  'entender-ia.p5.pregunta':
    'Quan es parla d’IA i ocupació, la pregunta habitual és: «Desapareixerà el meu lloc de treball?». La pregunta útil és una altra: quines tasques del meu lloc de treball podria fer o canviar la IA? Un lloc de treball és un conjunt de tasques, i la IA no les toca totes igual. L’Organització Internacional del Treball (OIT) conclou que la majoria de les ocupacions només estan exposades en part, i que el més probable és que la IA generativa complementi la feina més que no pas que la substitueixi{0}.',
  'entender-ia.p5.recepcion':
    'Pensa en el personal de recepció d’una oficina o d’una clínica. En l’índex de l’OIT que fa servir Faro, donar hora té el doble de puntuació d’exposició que rebre qui arriba{0}. Que una tasca estigui exposada no vol dir que hagi de desaparèixer: la IA en podria fer una part o canviar la manera de fer-la. El que passi depèn també de les empreses, de les lleis i de les persones que hi treballen.',
  'entender-ia.p5.accion.titulo': 'Què pots fer',
  'entender-ia.p5.accion':
    'Mirar la teva feina tasca per tasca t’ajuda a decidir amb informació. En unes tasques, la IA et pot estalviar temps, com quan prepares esborranys o resumeixes documents. D’altres depenen del que aporta una persona: el tracte amb la gent, l’experiència i el criteri. Saber quines són et serveix per triar quines habilitats reforçar o quina formació buscar.',
  'entender-ia.p5.cierre':
    'Al final, la IA proposa i tu decideixes. Faro t’ensenya les dades tasca per tasca, sense dir-te què has de fer. Quan vulguis veure-ho aplicat a la teva feina, {0}.',
  'entender-ia.p5.cierre.enlace': 'comença el teu recorregut',

  // ---------- 6 · Glossari (scripts/glosario.js l'ordena segons la llengua) ----------
  'entender-ia.glosario.titulo': 'Glossari',
  'entender-ia.glosario.intro': 'Les paraules de la IA, explicades en una frase.',
  'entender-ia.glosario.explicado': 'Ho expliquem a: {0}',
  'entender-ia.glosario.algoritmo.termino': 'Algorisme',
  'entender-ia.glosario.algoritmo.definicion':
    'Sèrie de passos ordenats per resoldre una tasca, com una recepta. La IA també fa servir algorismes, però aprèn una part del que fa a partir d’exemples.',
  'entender-ia.glosario.algoritmo.ejemplo':
    'Exemple: els passos que segueix el mòbil per ordenar les teves fotos per data.',
  'entender-ia.glosario.aprendizaje.termino': 'Aprenentatge automàtic ({0})',
  'entender-ia.glosario.aprendizaje.definicion':
    'La manera com aprèn la IA: a partir de molts exemples, sense que ningú li expliqui cada pas.',
  'entender-ia.glosario.aprendizaje.ejemplo':
    'Exemple: el filtre d’spam aprèn de milers de correus que altres persones ja han marcat.',
  'entender-ia.glosario.profundo.termino': 'Aprenentatge profund ({0})',
  'entender-ia.glosario.profundo.definicion':
    'Forma d’aprenentatge automàtic que fa servir xarxes neuronals de moltes capes. És la base de gairebé tota la IA actual, des de la que reconeix veus i imatges fins a la que escriu textos.',
  'entender-ia.glosario.profundo.ejemplo':
    'Exemple: el dictat del mòbil, que entén el que dius encara que hi hagi soroll.',
  'entender-ia.glosario.generativa.termino': 'IA generativa',
  'entender-ia.glosario.generativa.definicion':
    'La IA que crea contingut nou a partir del que li demanes: textos, imatges, àudio o vídeo.',
  'entender-ia.glosario.generativa.ejemplo':
    'Exemple: demanar-li l’esborrany d’una carta o una imatge per a un cartell.',
  'entender-ia.glosario.ia.termino': 'Intel·ligència artificial (IA)',
  'entender-ia.glosario.ia.definicion':
    'Tecnologia que aprèn de moltíssims exemples per fer tasques i dona la resposta que li sembla més probable. No pensa ni entén com una persona.',
  'entender-ia.glosario.ia.ejemplo': 'Exemple: el teclat del mòbil que et suggereix la paraula següent.',
  'entender-ia.glosario.modelo.termino': 'Model',
  'entender-ia.glosario.modelo.definicion': 'El que la IA ha après en l’entrenament i fa servir després per respondre.',
  'entender-ia.glosario.modelo.ejemplo':
    'Exemple: el que permet al mòbil reconèixer la teva cara encara que portis ulleres.',
  'entender-ia.glosario.red.termino': 'Xarxa neuronal',
  'entender-ia.glosario.red.definicion':
    'Model format per moltes peces de càlcul connectades en capes, inspirat de lluny en les neurones del cervell. Durant l’entrenament s’ajusta la força de cada connexió.',
  'entender-ia.glosario.red.ejemplo': 'Exemple: la xarxa que reconeix la teva cara per desbloquejar el mòbil.',
  'entender-ia.glosario.sistema.termino': 'Sistema d’IA',
  'entender-ia.glosario.sistema.definicion':
    'Així anomena la llei europea una màquina o un programa que funciona amb una certa autonomia i que, a partir del que rep, genera resultats com prediccions, continguts, recomanacions o decisions.',
  'entender-ia.glosario.sistema.ejemplo':
    'Exemple: un programa que classifica les sol·licituds que arriben a una oficina.',
  'entender-ia.glosario.datos-entrenamiento.termino': 'Dades d’entrenament',
  'entender-ia.glosario.datos-entrenamiento.definicion':
    'Els exemples concrets dels quals va aprendre un model. Si tenen errors o prejudicis, el model els hereta.',
  'entender-ia.glosario.datos-entrenamiento.ejemplo':
    'Exemple: vint anys de contractacions amb què aprèn una IA que ajuda a triar candidatures.',
  'entender-ia.glosario.entrenamiento.termino': 'Entrenament',
  'entender-ia.glosario.entrenamiento.definicion':
    'La fase en què la IA mira moltíssims exemples i aprèn el que s’hi repeteix.',
  'entender-ia.glosario.entrenamiento.ejemplo':
    'Exemple: abans d’arribar al teu correu, el filtre d’spam ja ha vist milers de missatges.',
  'entender-ia.glosario.fecha-corte.termino': 'Data de tall ({0})',
  'entender-ia.glosario.fecha-corte.definicion':
    'Moment fins al qual es van reunir els textos d’entrenament. El que va passar després, el model no ho sap, tret que consulti fonts actuals.',
  'entender-ia.glosario.fecha-corte.ejemplo':
    'Exemple: una norma que ha canviat fa poc i que l’assistent cita en la versió antiga.',
  'entender-ia.glosario.multimodal.termino': 'IA multimodal',
  'entender-ia.glosario.multimodal.definicion':
    'IA que treballa amb diversos tipus d’informació alhora: text, imatges, so o vídeo.',
  'entender-ia.glosario.multimodal.ejemplo': 'Exemple: li dones la foto d’una factura i et resumeix el que hi diu.',
  'entender-ia.glosario.lenguaje.termino': 'Model de llenguatge ({0})',
  'entender-ia.glosario.lenguaje.definicion':
    'IA generativa que treballa amb text: calcula quina paraula és més probable que vingui després i així escriu, paraula per paraula.',
  'entender-ia.glosario.lenguaje.ejemplo': 'Exemple: el que hi ha darrere d’un assistent que redacta un correu.',
  'entender-ia.glosario.parametros.termino': 'Paràmetres',
  'entender-ia.glosario.parametros.definicion':
    'Els valors interns que un model ajusta durant l’entrenament i que guarden el que ha après. Els models de llenguatge actuals en tenen milers de milions.',
  'entender-ia.glosario.parametros.ejemplo':
    'Exemple: si una notícia diu que un model té «70.000 milions de paràmetres», parla de la seva mida.',
  'entender-ia.glosario.token.termino': 'Token',
  'entender-ia.glosario.token.definicion':
    'Tros de text amb què treballa un model de llenguatge: una paraula, una part d’una paraula o un signe. Llegeix i escriu token per token, i molts serveis compten l’ús en tokens.',
  'entender-ia.glosario.token.ejemplo':
    'Exemple: una paraula llarga, com «intel·ligència», pot ocupar dos o tres tokens.',
  'entender-ia.glosario.contexto.termino': 'Context (finestra de context)',
  'entender-ia.glosario.contexto.definicion':
    'El que la IA té en compte en una conversa: el que li has escrit, els documents que li dones i les seves respostes anteriors. Té un límit, la finestra de context: si alguna cosa en queda fora, no la «recorda».',
  'entender-ia.glosario.contexto.ejemplo':
    'Exemple: en una conversa molt llarga, l’assistent pot no tenir en compte el que li vas dir al principi.',
  'entender-ia.glosario.agente.termino': 'Agent d’IA',
  'entender-ia.glosario.agente.definicion':
    'Assistent d’IA que, a més de respondre, fa tasques de diversos passos pel seu compte: buscar informació, fer servir altres programes o omplir formularis. Demana encara més supervisió.',
  'entender-ia.glosario.agente.ejemplo':
    'Exemple: un agent que busca vols, compara preus i prepara la reserva perquè tu la confirmis.',
  'entender-ia.glosario.asistente.termino': 'Assistent d’IA ({0})',
  'entender-ia.glosario.asistente.definicion':
    'Servei amb el qual converses per escrit o en veu alta i que et respon amb IA generativa.',
  'entender-ia.glosario.asistente.ejemplo':
    'Exemple: el xat d’un web que t’ajuda a redactar un correu o a resumir un document.',
  'entender-ia.glosario.respuesta.termino': '{0} (resposta o resultat)',
  'entender-ia.glosario.respuesta.definicion':
    'El que la IA et torna: un text, una imatge, una classificació o una xifra. Abans de fer-lo servir, revisa’l.',
  'entender-ia.glosario.respuesta.ejemplo': 'Exemple: el resum que et dona l’assistent després de la teva instrucció.',
  'entender-ia.glosario.instruccion.termino': '{0} (instrucció)',
  'entender-ia.glosario.instruccion.definicion':
    'El que escrius o dius per demanar alguna cosa a una IA generativa. És el seu punt de partida.',
  'entender-ia.glosario.instruccion.ejemplo':
    'Exemple: «Resumeix aquesta acta en cinc punts per a una companya que no hi va poder venir».',
  'entender-ia.glosario.alfabetizacion.termino': 'Alfabetització en IA',
  'entender-ia.glosario.alfabetizacion.definicion':
    'Els coneixements bàsics per fer servir la IA amb criteri: què fa, com aprèn, quines precaucions demana i quins riscos té. La llei europea la recull en el seu article 4.',
  'entender-ia.glosario.alfabetizacion.ejemplo':
    'Exemple: saber que un assistent es pot inventar una xifra i que convé comprovar-la abans de fer-la servir.',
  'entender-ia.glosario.alucinacion.termino': 'Al·lucinació',
  'entender-ia.glosario.alucinacion.definicion':
    'Dada, cita, norma o referència que la IA presenta com a real i és inventada. Cada vegada és menys freqüent, però continua passant, i ho diu amb el mateix to segur.',
  'entender-ia.glosario.alucinacion.ejemplo': 'Exemple: el número d’una llei, amb un format perfecte, que no existeix.',
  'entender-ia.glosario.decision.termino': 'Decisió automatitzada',
  'entender-ia.glosario.decision.definicion':
    'Decisió que pren un sistema sense que hi intervingui cap persona. Si t’afecta de manera important, la normativa de protecció de dades et dona drets, com demanar que hi intervingui una persona.',
  'entender-ia.glosario.decision.ejemplo': 'Exemple: una sol·licitud que es rebutja només pel càlcul d’un programa.',
  'entender-ia.glosario.deepfake.termino': 'Deepfake',
  'entender-ia.glosario.deepfake.definicion': 'Imatge, vídeo o àudio falsos fets amb IA que semblen reals.',
  'entender-ia.glosario.deepfake.ejemplo':
    'Exemple: un àudio amb la veu de la teva cap que et demana un pagament urgent. Si tens dubtes, confirma-ho per una altra via.',
  'entender-ia.glosario.uso-general.termino': 'IA d’ús general',
  'entender-ia.glosario.uso-general.definicion':
    'Model d’IA que serveix per a tasques molt diferents, com els grans models de llenguatge, i sobre el qual es construeixen molts assistents. La llei europea dona obligacions pròpies a qui els crea.',
  'entender-ia.glosario.uso-general.ejemplo':
    'Exemple: un mateix model que tradueix, resumeix, escriu codi i respon preguntes.',
  'entender-ia.glosario.reglamento.termino': 'Reglament europeu d’IA ({0})',
  'entender-ia.glosario.reglamento.definicion':
    'La llei de la Unió Europea sobre intel·ligència artificial (Reglament 2024/1689). Posa més condicions als usos d’alt risc i demana a les organitzacions que la creen o la fan servir que ajudin el seu personal a entendre-la.',
  'entender-ia.glosario.reglamento.ejemplo':
    'Exemple: una IA que ajuda a triar candidatures per a una feina es considera d’alt risc.',
  'entender-ia.glosario.sesgo.termino': 'Biaix algorítmic',
  'entender-ia.glosario.sesgo.definicion':
    'Inclinació injusta que un sistema d’IA hereta de les seves dades o del seu disseny i que repeteix en les seves respostes o decisions.',
  'entender-ia.glosario.sesgo.ejemplo': 'Exemple: associar certes professions més a homes que a dones.',
  'entender-ia.glosario.supervision.termino': 'Supervisió humana',
  'entender-ia.glosario.supervision.definicion':
    'Que una persona vigili el que fa la IA, ho pugui corregir i tingui l’última paraula. La llei europea l’exigeix en els sistemes d’alt risc.',
  'entender-ia.glosario.supervision.ejemplo':
    'Exemple: una persona revisa les candidatures que la IA ha descartat abans de decidir.',

  // ---------- 7 · Desafiament (scripts/desafio-ia.js): textos fixos, del guió i les dotze situacions ----------
  'entender-ia.desafio.titulo': 'Quant en saps, de la IA?',
  'entender-ia.desafio.intro':
    'Dotze situacions per posar a prova el que has llegit. Toca la resposta que et sembli millor i veuràs per què és o no és la correcta. No hi ha temps i no es desa res.',
  'entender-ia.desafio.ver-respuesta': 'Veure la resposta',
  'entender-ia.desafio.progreso': 'Pregunta {numero} de {total}',
  'entender-ia.desafio.siguiente': 'Pregunta següent',
  'entender-ia.desafio.ver-resultado': 'Veure el resultat',
  'entender-ia.desafio.correcto': 'Correcte.',
  'entender-ia.desafio.incorrecto': 'No és correcte.',
  'entender-ia.desafio.marca.correcta': 'Correcta',
  'entender-ia.desafio.marca.incorrecta': 'Incorrecta',
  'entender-ia.desafio.marca.tuya': 'La teva resposta',
  'entender-ia.desafio.resultado.titulo': 'El teu resultat',
  'entender-ia.desafio.resultado': '{aciertos} de {total}',
  'entender-ia.desafio.todas': 'Les has encertades totes. Tens una bona base per fer servir la IA amb criteri.',
  'entender-ia.desafio.bien': 'Bon resultat. Si vols afinar, pots tornar a llegir:',
  'entender-ia.desafio.repasar': 'Val la pena tornar a llegir aquestes parts de la guia:',
  'entender-ia.desafio.cuenta.una': '(1 pregunta)',
  'entender-ia.desafio.cuenta.varias': '({n} preguntes)',
  'entender-ia.desafio.repetir': 'Començar de nou',
  'entender-ia.desafio.1.pregunta': 'Això és IA? El mòbil es desbloqueja en reconèixer la teva cara.',
  'entender-ia.desafio.1.a': 'Sí: va aprendre a reconèixer cares veient moltíssimes fotos.',
  'entender-ia.desafio.1.a.porque':
    'Reconeix la teva cara amb una altra llum o amb ulleres perquè va aprendre de moltíssims exemples de rostres.',
  'entender-ia.desafio.1.b': 'No: és un sensor, com l’interruptor del llum.',
  'entender-ia.desafio.1.b.porque':
    'Un interruptor no reconeix res. El mòbil va aprendre a distingir cares a partir de molts exemples.',
  'entender-ia.desafio.1.c': 'Només és IA si el mòbil està connectat a internet.',
  'entender-ia.desafio.1.c.porque': 'Moltes IA funcionen dins del mateix aparell, sense connexió.',
  'entender-ia.desafio.2.pregunta': 'Això és IA? L’alarma del despertador.',
  'entender-ia.desafio.2.a': 'Sí, perquè sona sola cada matí.',
  'entender-ia.desafio.2.a.porque':
    'Fer una cosa sola no n’hi ha prou. L’alarma no aprèn d’exemples: sona a l’hora que vas posar.',
  'entender-ia.desafio.2.b': 'No: sona a l’hora que tu vas posar i no aprèn res.',
  'entender-ia.desafio.2.b.porque': 'Fa sempre el mateix. No busca semblances ni millora amb exemples.',
  'entender-ia.desafio.2.c': 'Sí, si és l’alarma del mòbil.',
  'entender-ia.desafio.2.c.porque':
    'Ser al mòbil no la converteix en IA. El mòbil fa servir IA en algunes funcions, no en totes.',
  'entender-ia.desafio.3.pregunta': 'Un assistent d’IA et contesta amb molta seguretat. Què vol dir això?',
  'entender-ia.desafio.3.a': 'Que sap que el que diu és veritat.',
  'entender-ia.desafio.3.a.porque':
    'La IA no sap si una cosa és veritat. Sona igual de segura quan l’encerta i quan s’equivoca.',
  'entender-ia.desafio.3.b': 'Que una persona experta ha revisat la resposta.',
  'entender-ia.desafio.3.b.porque': 'Ningú no la revisa abans que la llegeixis. Aquesta revisió et toca a tu.',
  'entender-ia.desafio.3.c': 'Que ha donat la resposta que li sembla més probable.',
  'entender-ia.desafio.3.c.porque':
    'Busca semblances amb el que ha vist i dona el més probable, que pot no ser el cert.',
  'entender-ia.desafio.4.pregunta':
    'Un avís real de l’ajuntament sobre un «taller gratuït» acaba a la carpeta d’spam. Per què?',
  'entender-ia.desafio.4.a': 'S’assembla a l’spam que el filtre va veure en aprendre.',
  'entender-ia.desafio.4.a.porque':
    '«Gratis» i «gratuït» es repetien molt a l’spam i el filtre es refia d’aquesta semblança. Per això convé revisar aquesta carpeta.',
  'entender-ia.desafio.4.b': 'El filtre està espatllat.',
  'entender-ia.desafio.4.b.porque':
    'Funciona com ha de funcionar: decideix per semblances, i de vegades les semblances enganyen.',
  'entender-ia.desafio.4.c': 'Algú del servei de correu el va llegir i el va apartar.',
  'entender-ia.desafio.4.c.porque':
    'Ningú no llegeix el teu correu per filtrar-lo. Ho decideix la IA segons el que ha après.',
  'entender-ia.desafio.5.pregunta':
    'Una IA reparteix les sol·licituds de la teva oficina. Va aprendre només amb sol·licituds escrites a l’ordinador. Avui n’arriba una d’escrita a mà. Què és el més probable?',
  'entender-ia.desafio.5.a': 'Que la reparteixi igual de bé que les altres.',
  'entender-ia.desafio.5.a.porque':
    'Només tracta bé el que s’assembla als seus exemples, i una sol·licitud a mà és una cosa que no va veure.',
  'entender-ia.desafio.5.b': 'Que avisi que no la sap llegir.',
  'entender-ia.desafio.5.b.porque': 'El més normal és que no avisi: dona igualment la seva resposta més probable.',
  'entender-ia.desafio.5.c': 'Que s’hi equivoqui més.',
  'entender-ia.desafio.5.c.porque':
    'La IA és tan bona com els seus exemples. Davant d’un cas diferent dels que va veure, falla més.',
  'entender-ia.desafio.6.pregunta':
    'Demanes a un assistent d’IA un correu per a un client i escriu «La seva comanda arribarà dijous». Tu no li vas donar cap data. D’on surt «dijous»?',
  'entender-ia.desafio.6.a': 'De les comandes de la teva empresa, que l’assistent consulta pel seu compte.',
  'entender-ia.desafio.6.a.porque': 'Només ho podria saber si li donessis aquesta dada. No ho vas fer.',
  'entender-ia.desafio.6.b': 'És la continuació que li va semblar més probable.',
  'entender-ia.desafio.6.b.porque':
    'Ha completat la frase amb una cosa que sona bé. Cal comprovar la data o treure-la.',
  'entender-ia.desafio.6.c': 'L’assistent sap quant tarden els enviaments.',
  'entender-ia.desafio.6.c.porque': 'No sap res de la teva comanda: imita com s’acostumen a escriure aquests correus.',
  'entender-ia.desafio.7.pregunta':
    'Vols resumir una acta per a una companya que no va poder anar a la reunió. Quina instrucció funciona millor?',
  'entender-ia.desafio.7.a':
    '«Resumeix aquesta acta en cinc punts per a una companya que no hi va ser. Digues qui fa cada tasca i per a quan.»',
  'entender-ia.desafio.7.a.porque':
    'Explica per a qui és i què ha d’incloure. Amb més context, la resposta s’ajusta millor.',
  'entender-ia.desafio.7.b': '«Resumeix això.»',
  'entender-ia.desafio.7.b.porque': 'És massa escarida. Sense context, la IA no sap què t’importa.',
  'entender-ia.desafio.7.c': '«Fes-ho perfecte i sense errors.»',
  'entender-ia.desafio.7.c.porque': 'Demanar-ho no ho garanteix. El que millora la resposta és el context.',
  'entender-ia.desafio.8.pregunta':
    'Una companya fa servir un assistent d’IA per resumir una acta. Què ha de comprovar abans d’enviar-la?',
  'entender-ia.desafio.8.a': 'Que no tingui faltes d’ortografia.',
  'entender-ia.desafio.8.a.porque': 'Acostuma a escriure sense faltes. El risc és en el contingut.',
  'entender-ia.desafio.8.b': 'Res, si el resum sona clar i segur.',
  'entender-ia.desafio.8.b.porque': 'Un to segur no garanteix res: sona igual quan s’equivoca.',
  'entender-ia.desafio.8.c': 'Que els noms, les dates i els acords coincideixin amb l’acta original.',
  'entender-ia.desafio.8.c.porque':
    'Pot convertir una proposta en un acord o inventar-se alguna cosa. Cal comparar-ho amb l’original.',
  'entender-ia.desafio.9.pregunta':
    'Una IA que ajuda a triar candidatures va aprendre de vint anys de contractacions en què gairebé tots els llocs de direcció van ser per a homes. Quin risc hi ha?',
  'entender-ia.desafio.9.a': 'Cap, perquè les dades són reals.',
  'entender-ia.desafio.9.a.porque':
    'Que siguin reals no les fa justes. Si el passat tenia un desequilibri, la IA l’aprèn.',
  'entender-ia.desafio.9.b': 'Que repeteixi aquest desequilibri i afavoreixi els homes.',
  'entender-ia.desafio.9.b.porque':
    'És un biaix: la IA hereta les inclinacions dels seus exemples. Per això cal supervisió humana.',
  'entender-ia.desafio.9.c': 'Que trigui més a decidir.',
  'entender-ia.desafio.9.c.porque': 'El problema no és la velocitat, sinó que repeteixi una inclinació injusta.',
  'entender-ia.desafio.10.pregunta':
    'La Lucía demana a un assistent d’IA que l’ajudi a respondre un client molest. Què no hauria d’escriure?',
  'entender-ia.desafio.10.a': 'Que la comanda porta una setmana de retard.',
  'entender-ia.desafio.10.a.porque': 'Aquest context ajuda i no identifica ningú.',
  'entender-ia.desafio.10.b': 'Que vol un to amable i de vostè.',
  'entender-ia.desafio.10.b.porque': 'Indicar el to millora la resposta.',
  'entender-ia.desafio.10.c': 'El nom complet del client, la seva adreça i el número del seu document d’identitat.',
  'entender-ia.desafio.10.c.porque':
    'Les dades personals no han de sortir d’on són. La Lucía les afegeix ella al final, al seu correu.',
  'entender-ia.desafio.11.pregunta':
    'Treballes a recepció. A Faro veus que «donar hora» és una de les teves tasques més exposades a la IA. Què vol dir?',
  'entender-ia.desafio.11.a': 'Que la IA podria fer una part d’aquesta tasca o canviar com es fa.',
  'entender-ia.desafio.11.a.porque': 'És informació per decidir, no una sentència.',
  'entender-ia.desafio.11.b': 'Que el teu lloc de treball desapareixerà.',
  'entender-ia.desafio.11.b.porque': 'L’exposició parla de tasques, no de llocs de treball, i no diu què passarà.',
  'entender-ia.desafio.11.c': 'Que ja no necessites saber fer aquesta tasca.',
  'entender-ia.desafio.11.c.porque': 'Al contrari: conèixer-la bé t’ajuda a revisar el que proposi la IA.',
  'entender-ia.desafio.12.pregunta': 'En una reunió algú diu: «Millora el prompt i revisa l’output». Què vol dir?',
  'entender-ia.desafio.12.a': 'Que actualitzis el programa i el tornis a instal·lar.',
  'entender-ia.desafio.12.a.porque':
    'No hi ha res a instal·lar. Són les paraules angleses per a la instrucció i la resposta.',
  'entender-ia.desafio.12.b': 'Que milloris el que demanes a la IA i revisis el que et torna.',
  'entender-ia.desafio.12.b.porque':
    'El prompt és la instrucció que li dones i l’output, la seva resposta. Demanar bé i revisar et toca a tu.',
  'entender-ia.desafio.12.c': 'Que canviïs l’assistent d’IA per un altre de millor.',
  'entender-ia.desafio.12.c.porque': 'No cal canviar d’eina: es refereix al que li demanes i al que et torna.',

  // ---------- Referències amb text propi ----------
  'entender-ia.referencias.titulo': 'Referències',
  'entender-ia.referencia.1': 'Russell, S. i Norvig, P. (2021). {0}, 4a ed. Pearson. Capítols 19 a 21.',
  'entender-ia.referencia.3':
    'Gmyrek, P., Berg, J. i Bescond, D. (2023). {0}. ILO Working Paper 96. Ginebra: Organització Internacional del Treball. {1}',
  'entender-ia.referencia.5':
    'Reglament (UE) 2024/1689 del Parlament Europeu i del Consell, de 13 de juny de 2024, d’Intel·ligència Artificial. Diari Oficial de la Unió Europea, sèrie L, 12 de juliol de 2024. Articles 3.1, 4, 14 i 113. {0} Els articles 4 i 113 es citen amb la redacció que els dona el Reglament (UE) 2026/1744, de 8 de juliol de 2026 (Diari Oficial de la Unió Europea, sèrie L, 24 de juliol de 2026). {1}',
  'entender-ia.referencia.6':
    'Universitat de Hèlsinki i MinnaLearn. {0} (curs en línia, versió per a Espanya), capítol 1.1. {1}',
  'entender-ia.referencia.7': 'Maldita.es (24 de juny de 2025). {0}. {1}',
  'entender-ia.referencia.8': 'España Digital (27 de gener de 2026). {0}. {1}',
};
