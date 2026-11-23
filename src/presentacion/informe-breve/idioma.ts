// Traducciones completas y explícitas de la presentación breve. La clave es el texto castellano de partida;
// los marcadores numerados solo interpolan valores, nunca traducen datos ni alteran sus cifras.
import type { Idioma } from '../../comun/idioma.ts';

export const TEXTOS_BREVES_CA = {
  'Ejemplo ficticio': 'Exemple fictici',
  'Ejemplo ficticio · {0}': 'Exemple fictici · {0}',
  Nota: 'Nota',
  'Detalle de todas las tareas': 'Detall de totes les tasques',
  'En esta hoja caben {0} de tus {1} tareas.': 'En aquest full hi caben {0} de les teves {1} tasques.',
  'En esta hoja cabe 1 de tus {0} tareas.': 'En aquest full hi cap 1 de les teves {0} tasques.',
  'Las demás están en el informe en pantalla, en «{0}».': 'La resta són a l’informe en pantalla, a «{0}».',
  'La que falta está en el informe en pantalla, en «{0}».': 'La que falta és a l’informe en pantalla, a «{0}».',
  'Tu tarea está en el informe en pantalla, en «{0}».': 'La teva tasca és a l’informe en pantalla, a «{0}».',
  'Tu tarea menos expuesta está en el informe en pantalla, en «{0}».':
    'La teva tasca menys exposada és a l’informe en pantalla, a «{0}».',
  'Tus {0} tareas están en el informe en pantalla, en «{1}».':
    'Les teves {0} tasques són a l’informe en pantalla, a «{1}».',
  'Tus {0} tareas menos expuestas están en el informe en pantalla, en «{1}».':
    'Les teves {0} tasques menys exposades són a l’informe en pantalla, a «{1}».',
  'En esta hoja cabe 1 de tus {0} tareas menos expuestas. La otra está en el informe en pantalla, en «{1}».':
    'En aquest full hi cap 1 de les teves {0} tasques menys exposades. L’altra és a l’informe en pantalla, a «{1}».',
  'Todas tus tareas, en el mismo orden y con los mismos números que «Tus tareas, una a una». Las notas y los márgenes se expresan de 0 a 100; un margen no es una probabilidad.':
    'Totes les teves tasques, en el mateix ordre i amb els mateixos números que «Les teves tasques, una a una». Les notes i els marges s’expressen de 0 a 100; un marge no és una probabilitat.',
  Margen: 'Marge',
  Incierta: 'Incerta',

  'Tabla oficial': 'Taula oficial',
  'Notas metodológicas': 'Notes metodològiques',
  'Copia: {0}': 'Còpia: {0}',
  'Contexto censal del grupo ({0})': 'Context censal del grup ({0})',
  'La fuente remite del grupo {0} al grupo {1}.': 'La font remet del grup {0} al grup {1}.',
  'Grupo CNO-11 {0}: {1} personas ocupadas de 16 o más años, por lugar de trabajo del establecimiento.':
    'Grup CNO-11 {0}: {1} persones ocupades de 16 anys o més, per lloc de treball de l’establiment.',
  'Actividad CNAE-2009. Este reparto corresponde al grupo de ocupación; no identifica el sector de tu empresa ni mide su uso de IA.':
    'Activitat CNAE-2009. Aquest repartiment correspon al grup d’ocupació; no identifica el sector de la teva empresa ni en mesura l’ús d’IA.',
  'Sectores publicados del grupo, no sectores de la persona': 'Sectors publicats del grup, no sectors de la persona',
  Actividad: 'Activitat',
  'Porcentaje del grupo': 'Percentatge del grup',
  Personas: 'Persones',
  'Otros sectores (resto de la fuente)': 'Altres sectors (resta de la font)',
  'La fuente publica sectores de al menos {0} personas y el {1} del grupo; conserva el resto agrupado cuando lo declara.':
    'La font publica sectors d’almenys {0} persones i el {1} del grup; conserva la resta agrupada quan la declara.',
  'Cada celda de actividad suma cuatro provincias con cifras perturbadas por el INE: hasta ±12 personas por celda. Las empresas de trabajo temporal cuentan en su propia actividad, no en la de la empresa usuaria.':
    'Cada cel·la d’activitat suma quatre províncies amb xifres pertorbades per l’INE: fins a ±12 persones per cel·la. Les empreses de treball temporal compten en la seva pròpia activitat, no en la de l’empresa usuària.',
  'No incluye a quienes no tienen lugar de trabajo consignado; el INE imputa la ocupación en casi una de cada cinco personas.':
    'No inclou les persones sense lloc de treball consignat; l’INE imputa l’ocupació en gairebé una de cada cinc persones.',

  'Edición: {0}.': 'Edició: {0}.',
  'Publicado: {0}.': 'Publicat: {0}.',
  'Definición original publicada': 'Definició original publicada',
  'Base de la encuesta empresarial': 'Base de l’enquesta empresarial',
  'Describe empresas, no personas ni el uso de IA en tu puesto.':
    'Descriu empreses, no persones ni l’ús d’IA al teu lloc de treball.',
  'Periodo: {0}.': 'Període: {0}.',
  'Uso de IA: empresas catalanas con Internet (10 o más personas)':
    'Ús d’IA: empreses catalanes amb Internet (10 persones o més)',
  'Ruptura de serie; sin comparación': 'Ruptura de sèrie; sense comparació',
  'Sin serie comparable en este paquete': 'Sense sèrie comparable en aquest paquet',
  'INE ETICCE ({0})': 'INE ETICCE ({0})',

  alta: 'alta',
  media: 'mitjana',
  baja: 'baixa',
  'Tus tareas están muy expuestas': 'Les teves tasques estan molt exposades',
  'Tus tareas están expuestas en parte': 'Les teves tasques estan exposades en part',
  'Tus tareas están poco expuestas': 'Les teves tasques estan poc exposades',
  'Ya se usa en empleos como el tuyo': 'Ja es fa servir en feines com la teva',
  'Se usa en algunos empleos como el tuyo': 'Es fa servir en algunes feines com la teva',
  'Aún se usa poco en empleos como el tuyo': 'Encara es fa servir poc en feines com la teva',
  'en las fuerzas armadas': 'a les forces armades',
  'de las fuerzas armadas': 'de les forces armades',
  'fuerzas armadas': 'forces armades',
  'el empleo en las fuerzas armadas': 'l’ocupació a les forces armades',
  'en puestos de dirección y gerencia': 'en llocs de direcció i gerència',
  'dirección y gerencia': 'direcció i gerència',
  'el empleo en dirección y gerencia': 'l’ocupació en direcció i gerència',
  'en profesiones científicas e intelectuales': 'en professions científiques i intel·lectuals',
  'profesiones científicas e intelectuales': 'professions científiques i intel·lectuals',
  'el empleo en profesiones científicas e intelectuales': 'l’ocupació en professions científiques i intel·lectuals',
  'en empleos técnicos y de apoyo': 'en feines tècniques i de suport',
  'con empleos técnicos y de apoyo': 'amb feines tècniques i de suport',
  'empleos técnicos y de apoyo': 'feines tècniques i de suport',
  'el empleo técnico y de apoyo': 'l’ocupació tècnica i de suport',
  'en empleos administrativos': 'en feines administratives',
  'con empleos administrativos': 'amb feines administratives',
  'empleos administrativos': 'feines administratives',
  'el empleo administrativo': 'l’ocupació administrativa',
  'en empleos de servicios, cuidados, protección y comercio': 'en feines de serveis, cures, protecció i comerç',
  'servicios, cuidados, protección y comercio': 'serveis, cures, protecció i comerç',
  'el empleo en servicios y comercio': 'l’ocupació en serveis i comerç',
  'en la agricultura, la ganadería, la silvicultura y la pesca':
    'en l’agricultura, la ramaderia, la silvicultura i la pesca',
  'agricultura, ganadería y pesca': 'agricultura, ramaderia i pesca',
  'el empleo agrario y pesquero': 'l’ocupació agrària i pesquera',
  'en oficios de la industria y la construcción': 'en oficis de la indústria i la construcció',
  'oficios de la industria y la construcción': 'oficis de la indústria i la construcció',
  'el empleo en oficios de la industria y la construcción': 'l’ocupació en oficis de la indústria i la construcció',
  'en el manejo de instalaciones, máquinas y montaje': 'en el maneig d’instal·lacions, màquines i muntatge',
  'que manejan instalaciones y máquinas': 'que manegen instal·lacions i màquines',
  'operación de instalaciones y máquinas': 'operació d’instal·lacions i màquines',
  'el empleo de quienes manejan instalaciones y máquinas': 'l’ocupació de qui maneja instal·lacions i màquines',
  'en ocupaciones elementales': 'en ocupacions elementals',
  'ocupaciones elementales': 'ocupacions elementals',
  'el empleo en ocupaciones elementales': 'l’ocupació en ocupacions elementals',
  'el empleo de tu grupo': 'l’ocupació del teu grup',
  'personas {0}': 'persones {0}',
  'personas del grupo «{0}»': 'persones del grup «{0}»',
  'personas ocupadas': 'persones ocupades',
  'parte de tu tiempo va a tareas sin nota.': 'una part del teu temps es dedica a tasques sense nota.',
  'los dos modelos de la OIT se separan mucho.': 'els dos models de l’OIT s’allunyen molt.',
  'el margen de las estimaciones de la OIT y de Faro es muy ancho.':
    'el marge de les estimacions de l’OIT i de Faro és molt ample.',
  'el margen de las estimaciones de Faro es muy ancho.': 'el marge de les estimacions de Faro és molt ample.',
  '{0} de {1} métodos coinciden.': '{0} de {1} mètodes coincideixen.',
  'estimación de la OIT; sus dos modelos dan entre {0} y {1}.':
    'estimació de l’OIT; els seus dos models donen entre {0} i {1}.',
  'estimación de la OIT y de Faro; su margen va de {0} a {1}.':
    'estimació de l’OIT i de Faro; el seu marge va de {0} a {1}.',
  'estimación de Faro; su margen va de {0} a {1}.': 'estimació de Faro; el seu marge va de {0} a {1}.',
  'entre las más expuestas': 'entre les més exposades',
  'en la zona media': 'a la zona mitjana',
  'entre las menos expuestas': 'entre les menys exposades',
  'Los {0} métodos de medida que Faro ha comprobado sitúan tu ocupación {1}.':
    'Els {0} mètodes de mesura que Faro ha comprovat situen la teva ocupació {1}.',
  'Los {0} métodos de medida que Faro ha comprobado, entre ellos el índice de la OIT, sitúan tu ocupación {1}.':
    'Els {0} mètodes de mesura que Faro ha comprovat, entre els quals l’índex de l’OIT, situen la teva ocupació {1}.',
  'Faro estima cada tarea con los criterios de puntuación de la OIT, de 0 (la IA no puede hacerla) a 100 (podría hacerla entera). La media de tus tareas, según el tiempo que dedicas a cada una, es <b>{0}</b>.':
    'Faro estima cada tasca amb els criteris de puntuació de l’OIT, de 0 (la IA no la pot fer) a 100 (la podria fer sencera). La mitjana de les teves tasques, segons el temps que dediques a cadascuna, és <b>{0}</b>.',
  '{0} de los {1} métodos de medida que Faro ha comprobado sitúan tu ocupación {2}, como la OIT.':
    '{0} dels {1} mètodes de mesura que Faro ha comprovat situen la teva ocupació {2}, com l’OIT.',
  'es un grupo amplio': 'és un grup ampli',
  'es todo el grupo de {0}': 'és tot el grup de {0}',
  'tu ocupación': 'la teva ocupació',
  'muestra pequeña; ': 'mostra petita; ',
  'datos de España; ': 'dades d’Espanya; ',
  Baja: 'Baixa',
  Sube: 'Puja',
  Estable: 'Estable',
  'Sin comparación': 'Sense comparació',
  'lo mismo': 'el mateix',
  más: 'més',
  menos: 'menys',
  'un {0} {1}': 'un {0} {1}',
  'Muchas {0} que la media': 'Moltes {0} que la mitjana',
  'Más que la media': 'Més que la mitjana',
  'Menos que la media': 'Menys que la mitjana',
  'Algo {0} que la media': 'Una mica {0} que la mitjana',
  'Igual que la media': 'Igual que la mitjana',
  'Mujeres y hombres a partes parecidas': 'Dones i homes en proporcions semblants',
  'Con mayoría de mujeres': 'Amb majoria de dones',
  'Con mayoría de hombres': 'Amb majoria d’homes',
  'más jóvenes': 'més joves',
  'menos jóvenes': 'menys joves',
  'tantos jóvenes': 'tants joves',
  'más estudios universitarios': 'més estudis universitaris',
  'menos estudios universitarios': 'menys estudis universitaris',
  'tantos estudios universitarios': 'tants estudis universitaris',
  ' que la media de Cataluña': ' que la mitjana de Catalunya',
  'ha bajado': 'ha baixat',
  'han bajado': 'han baixat',
  'ha subido': 'ha pujat',
  'han subido': 'han pujat',
  'se ha mantenido': 's’ha mantingut',
  'se han mantenido': 's’han mantingut',
  'En el último año, {0}.': 'El darrer any, {0}.',
  'Tus tareas no tienen nota en el índice de la OIT, así que este informe no puede decir cuánto podría hacer la IA en ellas.':
    'Les teves tasques no tenen nota a l’índex de l’OIT, de manera que aquest informe no pot dir quina part en podria fer la IA.',
  'Las tareas de tu ocupación tienen una exposición {0} a la IA generativa: {1} sobre 100 según el índice de la OIT, ponderado por el tiempo que dedicas a cada una.':
    'Les tasques de la teva ocupació tenen una exposició {0} a la IA generativa: {1} sobre 100 segons l’índex de l’OIT, ponderat pel temps que dediques a cadascuna.',
  'Las tareas de tu ocupación tienen una exposición {0} a la IA generativa: {1} sobre 100 según la OIT y la estimación de Faro, ponderado por el tiempo que dedicas a cada una.':
    'Les tasques de la teva ocupació tenen una exposició {0} a la IA generativa: {1} sobre 100 segons l’OIT i l’estimació de Faro, ponderat pel temps que dediques a cadascuna.',
  'Las tareas de tu ocupación tienen una exposición {0} a la IA generativa: {1} sobre 100 según la estimación de Faro, ponderado por el tiempo que dedicas a cada una.':
    'Les tasques de la teva ocupació tenen una exposició {0} a la IA generativa: {1} sobre 100 segons l’estimació de Faro, ponderat pel temps que dediques a cadascuna.',
  'En Cataluña': 'A Catalunya',
  'En España': 'A Espanya',
  '{0}, {1} de cada 100 {2} la usaron para trabajar en {3}.':
    '{0}, {1} de cada 100 {2} la van fer servir per treballar el {3}.',
  'Los estudios publicados hasta 2026 no encuentran una pérdida general de empleo causada por la IA, y estos datos no permiten atribuirle esos cambios.':
    'Els estudis publicats fins al 2026 no troben una pèrdua general d’ocupació causada per la IA, i aquestes dades no permeten atribuir-li aquests canvis.',
  'Revisar:': 'Revisar:',
  'la IA puede equivocarse o inventar datos; comprobarlos sigue siendo trabajo de una persona.':
    'la IA es pot equivocar o inventar dades; comprovar-les continua sent feina d’una persona.',
  'Atender a las personas': 'Atendre les persones',
  'cuando el caso no es el habitual.': 'quan el cas no és l’habitual.',
  Decidir: 'Decidir',
  'qué se hace, con qué prioridad y quién responde.': 'què es fa, amb quina prioritat i qui en respon.',
  Tú: 'Tu',
  'Dato oficial': 'Dada oficial',
  Estudio: 'Estudi',
  Norma: 'Norma',
  'Cálculo de Faro': 'Càlcul de Faro',
  IA: 'IA',
  'Confianza {0}': 'Confiança {0}',
  'Uso personal': 'Ús personal',
  Orientativo: 'Orientatiu',
  'Hoja {0} de {1}': 'Full {0} de {1}',
  'Imprimir o guardar en PDF': 'Imprimir o desar en PDF',
  'Borrar el informe y lo escrito': 'Esborrar l’informe i el que has escrit',
  'Empezar de nuevo': 'Començar de nou',
  'La IA y tu trabajo · {0}': 'La IA i la teva feina · {0}',
  'Grupo {0}': 'Grup {0}',
  'datos hasta {0}': 'dades fins {0}',
  'Informe Faro': 'Informe Faro',
  'Tu trabajo y la IA': 'La teva feina i la IA',
  Ocupación: 'Ocupació',
  Ámbito: 'Àmbit',
  Cataluña: 'Catalunya',
  Fecha: 'Data',
  'la contratación': 'la contractació',
  'En pocas palabras': 'En poques paraules',
  'Una de tus tareas no tiene nota y no cuenta': 'Una de les teves tasques no té nota i no compta',
  '{0} de tus tareas no tienen nota y no cuentan': '{0} de les teves tasques no tenen nota i no compten',
  ' en la media.': ' en la mitjana.',
  '{0} de 100, con un margen de {1} a {2}': '{0} de 100, amb un marge de {1} a {2}',
  'La OIT puntúa cada tarea de 0 (la IA no puede hacerla) a 100 (podría hacerla entera). La media de tus tareas, según el tiempo que dedicas a cada una, es <b>{0}</b>.':
    'L’OIT puntua cada tasca de 0 (la IA no la pot fer) a 100 (la podria fer sencera). La mitjana de les teves tasques, segons el temps que dediques a cadascuna, és <b>{0}</b>.',
  'tus tiempos': 'els teus temps',
  'de 100': 'de 100',
  'Las estimaciones van de {0} a {1}': 'Les estimacions van de {0} a {1}',
  ' No hay respuestas suficientes de Cataluña para este grupo.':
    ' No hi ha prou respostes de Catalunya per a aquest grup.',
  '{0}, <b>{1} de cada 100</b> {2} usaron IA generativa para trabajar en {3}.{4}':
    '{0}, <b>{1} de cada 100</b> {2} van fer servir IA generativa per treballar el {3}.{4}',
  'de cada 100': 'de cada 100',
  'Margen de la encuesta: de {0} a {1}': 'Marge de l’enquesta: de {0} a {1}',
  'Aún completa pocos trabajos largos': 'Encara completa poques feines llargues',
  'La mejor IA resolvió el <b>{0} %</b> de las tareas largas de ordenador. Solo contaba el resultado final.':
    'La millor IA va resoldre el <b>{0} %</b> de les tasques llargues d’ordinador. Puntuava el resultat final.',
  'pruebas de laboratorio, no tu puesto de trabajo.': 'proves de laboratori, no el teu lloc de treball.',
  '{0} de cada 100 trabajos completados': '{0} de cada 100 feines completades',
  'Trabajos largos completados': 'Feines llargues completades',
  'Sin nota': 'Sense nota',
  Mucho: 'Molt',
  Algo: 'Una mica',
  Poco: 'Poc',
  'Tus tareas, una a una': 'Les teves tasques, una a una',
  'De 0 a 100: cuánto podría hacer la IA. Es potencial, no lo que ya pasa en tu trabajo.':
    'De 0 a 100: quina part en podria fer la IA. És potencial, no el que ja passa a la teva feina.',
  Tarea: 'Tasca',
  Tiempo: 'Temps',
  'Más oscuro, más expuesta': 'Més fosc, més exposada',
  'el tiempo de cada tarea': 'el temps de cada tasca',
  'Tus tareas menos expuestas': 'Les teves tasques menys exposades',
  'Según la OIT, son las que la IA podría hacer en menor parte.':
    'Segons l’OIT, són les que la IA podria fer en menor part.',
  'Según la OIT y la estimación de Faro, son las que la IA podría hacer en menor parte.':
    'Segons l’OIT i l’estimació de Faro, són les que la IA podria fer en menor part.',
  'Según la estimación de Faro, son las que la IA podría hacer en menor parte.':
    'Segons l’estimació de Faro, són les que la IA podria fer en menor part.',
  'Lo que la IA no hace por ti': 'El que la IA no fa per tu',
  'redactado con IA': 'redactat amb IA',
  Conclusiones: 'Conclusions',
  'Hoja 1, tu trabajo y la IA': 'Full 1, la teva feina i la IA',
  'Faro · Informe de {0} · Las fuentes, en la hoja 2': 'Faro · Informe de {0} · Les fonts, al full 2',
  ': las mismas que {0}': ': les mateixes que {0}',
  ': {0} que {1}': ': {0} que {1}',
  ', hasta {0}': ', fins {0}',
  'suma de los recuentos de personas contratadas en {0} grupos de ocupación durante':
    'suma dels recomptes de persones contractades en {0} grups d’ocupació durant',
  'personas contratadas en': 'persones contractades',
  'el año anterior': 'l’any anterior',
  Contratación: 'Contractació',
  '{0} el último año{1}{2}.': '{0} el darrer any{1}{2}.',
  ' La relación era de {0} hace un año.': ' La relació era de {0} fa un any.',
  'Suma de recuentos de {0} grupos de ocupación: ': 'Suma de recomptes de {0} grups d’ocupació: ',
  Búsqueda: 'Cerca',
  'Contratación y demanda': 'Contractació i demanda',
  'Relación al alza': 'Relació a l’alça',
  'Relación a la baja': 'Relació a la baixa',
  'Relación estable': 'Relació estable',
  'contratadas / demandantes · aprox.': 'contractades / demandants · aprox.',
  ' Hace un año: ≈{0}/100.': ' Fa un any: ≈{0}/100.',
  '{0}{1} personas contratadas; {2} demandantes no ocupados ({3}). Grupos distintos: no predice tus opciones de empleo.{4}':
    '{0}{1} persones contractades; {2} demandants no ocupats ({3}). Grups diferents: no prediu les teves opcions de feina.{4}',
  'por demandante': 'per demandant',
  '{0}{1} personas contratadas y {2} demandantes de empleo no ocupados ({3}). Son recuentos de poblaciones distintas, no una tasa de colocación.{4}':
    '{0}{1} persones contractades i {2} demandants d’ocupació no ocupats ({3}). Són recomptes de poblacions diferents, no una taxa de col·locació.{4}',
  'personas {0} en Cataluña de media en los cuatro últimos trimestres, {1} que en los cuatro anteriores ({2}). Son estimaciones de una encuesta por muestreo y la diferencia puede deberse en parte a la muestra: con estas cifras no se puede asegurar si el empleo ha subido o bajado.':
    'persones {0} a Catalunya de mitjana en els quatre darrers trimestres, {1} que en els quatre anteriors ({2}). Són estimacions d’una enquesta per mostratge i la diferència pot deure’s en part a la mostra: amb aquestes xifres no es pot assegurar si l’ocupació ha pujat o baixat.',
  'personas {0} en Cataluña de media en los cuatro últimos trimestres.':
    'persones {0} a Catalunya de mitjana en els quatre darrers trimestres.',
  'No concluyente': 'No concloent',
  'un año antes': 'un any abans',
  'personas en el grupo «{0}» en Cataluña (a 1 de enero de {1}){2}.':
    'persones del grup «{0}» a Catalunya (a 1 de gener del {1}){2}.',
  Empleo: 'Ocupació',
  ' Las mujeres cobran un {0} menos.': ' Les dones cobren un {0} menys.',
  ' Las mujeres cobran un {0} más.': ' Les dones cobren un {0} més.',
  ' Mujeres y hombres cobran lo mismo de media.': ' Dones i homes cobren el mateix de mitjana.',
  ': {0} que en {1}': ': {0} que el {1}',
  Salario: 'Salari',
  '€ al año': '€ l’any',
  'España, {0}{1}.{2} Próximo dato: {3}.': 'Espanya, {0}{1}.{2} Propera dada: {3}.',
  'Contratos: casi los mismos que el año anterior. No son personas.':
    'Contractes: gairebé els mateixos que l’any anterior. No són persones.',
  'Contratos: un {0} {1} que el año anterior. No son personas.':
    'Contractes: un {0} {1} que l’any anterior. No són persones.',
  'de {0} a {1}': 'de {0} a {1}',
  'De {0} a {1}.': 'De {0} a {1}.',
  '−{0} desde el máximo': '−{0} des del màxim',
  ' Desde el máximo, {0} menos.': ' Des del màxim, {0} menys.',
  'Contratos por año, {0}: {1}.{2}': 'Contractes per any, {0}: {1}.{2}',
  'años anteriores': 'anys anteriors',
  'Contratos por año': 'Contractes per any',
  'La otra comarca': 'L’altra comarca',
  'Las otras {0} comarcas': 'Les altres {0} comarques',
  'Dónde se contrata': 'On es contracta',
  'De cada 100 contratos, último año.': 'De cada 100 contractes, darrer any.',
  Mujeres: 'Dones',
  'Menores de 30 años': 'Menors de 30 anys',
  '55 años o más': '55 anys o més',
  'Estudios universitarios': 'Estudis universitaris',
  '{0}: {1} de cada 100; media de Cataluña, {2}': '{0}: {1} de cada 100; mitjana de Catalunya, {2}',
  'media {0}': 'mitjana {0}',
  'Por cada 10 menores de 30 años hay {0} personas de 55 o más (en todas las ocupaciones, {1}).':
    'Per cada 10 menors de 30 anys hi ha {0} persones de 55 o més (en totes les ocupacions, {1}).',
  'Quién trabaja en tu ocupación': 'Qui treballa en la teva ocupació',
  'Cataluña.': 'Catalunya.',
  'Idescat e INE, {0}': 'Idescat i INE, {0}',
  'Sin fecha fija': 'Sense data fixa',
  'En aplicación {0}': 'En aplicació {0}',
  'Fecha prevista: {0}': 'Data prevista: {0}',
  'Fecha por confirmar': 'Data per confirmar',
  'Publicada la de {0}': 'Publicada la del {0}',
  'El INE publicó la edición de {0}; Faro lo comprobó {1}. La incorporará cuando el INE publique los datos detallados de la encuesta.':
    'L’INE va publicar l’edició del {0}; Faro ho va comprovar {1}. La incorporarà quan l’INE en publiqui les dades detallades.',
  'El INE publicó la edición de {0}; Faro lo comprobó {1}. La incorporará cuando haya comprobado que se puede comparar con la anterior.':
    'L’INE va publicar l’edició del {0}; Faro ho va comprovar {1}. La incorporarà quan hagi comprovat que es pot comparar amb l’anterior.',
  'Empresas catalanas que usan IA': 'Empreses catalanes que fan servir IA',
  'Sube ({0} en 2023, {1} en 2024)': 'Puja ({0} el 2023, {1} el 2024)',
  ', en España': ', a Espanya',
  'Personas de tu grupo ({0}) que usan IA para trabajar{1}':
    'Persones del teu grup ({0}) que fan servir IA per treballar{1}',
  'Primer año que se mide': 'Primer any que es mesura',
  'Se mide desde {0}': 'Es mesura des del {0}',
  'Ofertas de empleo que mencionan la IA, en España': 'Ofertes d’ocupació que esmenten la IA, a Espanya',
  'Normas europeas para la IA que selecciona, evalúa o despide personas<small>Antes, la empresa deberá avisar a la plantilla.</small>':
    'Normes europees per a la IA que selecciona, avalua o acomiada persones<small>Abans, l’empresa haurà d’avisar la plantilla.</small>',
  'Aprobadas, aún sin aplicar': 'Aprovades, encara sense aplicar',
  'Aprobadas y en aplicación': 'Aprovades i en aplicació',
  'Aplazadas: iban a aplicarse en {0}': 'Ajornades: s’havien d’aplicar {0}',
  'Qué mirar': 'Què cal mirar',
  'Situación hoy': 'Situació avui',
  'Cómo ha ido': 'Com ha anat',
  'Próxima fecha': 'Propera data',
  'Qué vigilar': 'Què cal seguir',
  'Datos y normas con fecha.': 'Dades i normes amb data.',
  'Reglamento de IA': 'Reglament d’IA',
  'lo que contaste': 'el que vas explicar',
  'lo propuso la IA': 'ho va proposar la IA',
  'Cómo leer este informe': 'Com llegir aquest informe',
  'De dónde sale cada dato': 'D’on surt cada dada',
  'Confianza y colores': 'Confiança i colors',
  ' · azul: exposición a la IA.': ' · blau: exposició a la IA.',
  'Ten en cuenta': 'Tingues en compte',
  'Las cifras son de grupos de personas y no sirven para predecir tu caso ni para evaluarte. La IA puede equivocarse.':
    'Les xifres són de grups de persones i no serveixen per predir el teu cas ni per avaluar-te. La IA es pot equivocar.',
  'Idescat e INE: censos': 'Idescat i INE: censos',
  'Reglamento (UE) 2024/1689 y 2026/1744': 'Reglament (UE) 2024/1689 i 2026/1744',
  Fuentes: 'Fonts',
  'No hay datos del mercado de trabajo de esta ocupación en Cataluña.':
    'No hi ha dades del mercat de treball d’aquesta ocupació a Catalunya.',
  'El mercado laboral': 'El mercat laboral',
  '{0} en Cataluña': '{0} a Catalunya',
  'Observatori del Treball e INE': 'Observatori del Treball i INE',
  'Hoja 2, el mercado laboral': 'Full 2, el mercat laboral',
  'Faro · Informe de {0} · {1}': 'Faro · Informe de {0} · {1}',
} as const;

export type ClaveBreve = keyof typeof TEXTOS_BREVES_CA;

/** Interpola únicamente la plantilla elegida; un valor que contenga llaves no vuelve a interpretarse. */
function interpolar(plantilla: string, valores: readonly (string | number)[]): string {
  const partes: string[] = [];
  let desde = 0;
  for (;;) {
    const inicio = plantilla.indexOf('{', desde);
    if (inicio < 0) {
      return partes.join('') + plantilla.slice(desde);
    }
    const fin = plantilla.indexOf('}', inicio);
    if (fin < 0) {
      throw new Error('Marcador incompleto del informe breve');
    }
    const indice = Number(plantilla.slice(inicio + 1, fin));
    const valor = valores[indice];
    if (valor === undefined) {
      throw new Error('Falta un valor del texto del informe breve');
    }
    partes.push(plantilla.slice(desde, inicio), String(valor));
    desde = fin + 1;
  }
}

/**
 * Un texto que viene de un registro (una cita de fuente) en el idioma del informe. Solo se admite si el catálogo lo
 * traduce: si el registro cambia, el informe falla en vez de enseñarlo sin traducir.
 */
export function textoRegistrado(idioma: Idioma, registrado: string): string {
  if (!Object.hasOwn(TEXTOS_BREVES_CA, registrado)) {
    throw new Error(`El informe breve no tiene traducción para el texto registrado «${registrado}»`);
  }
  return texto(idioma, registrado as ClaveBreve);
}

/** Selección explícita del idioma de un texto propio. Los nombres oficiales no son claves de este catálogo. */
export function texto(idioma: Idioma, clave: ClaveBreve, ...valores: readonly (string | number)[]): string {
  return interpolar(idioma === 'ca' ? TEXTOS_BREVES_CA[clave] : clave, valores);
}
