// Textos comunes y de las páginas de presentación en catalán. Se incorporan al diccionario de ca.js.

/**
 * Diccionario de solo lectura (clave -> texto) en catalán con los textos de las páginas comunes y de presentación.
 * @type {Readonly<Record<string, string>>}
 */
export const TEXTOS_PAGINAS = {
  'contacto.titulo': 'Contacte de publicació',
  'contacto.responsable': 'Responsable: {0}',
  'contacto.correo': 'Correu de contacte: {0}',
  'contacto.no-disponible': 'No hi ha cap correu de contacte disponible.',

  // ---------- Común a todas las páginas: cabecera, menú, navegación, pie y selector de idioma ----------
  'comun.accion.conocer-faro': 'Conèixer Faro',
  'comun.accion.entender-ia': 'Entendre la IA',
  'comun.accion.ir-biblioteca': 'Anar a la Biblioteca',
  'comun.aviso.nombre': 'Informació sobre Faro',
  'comun.cerrar': 'Tancar',
  'comun.etapas.anterior': 'Anterior',
  'comun.etapas.controles': 'Canviar d’etapa',
  'comun.etapas.nombre': 'Etapes de la pàgina',
  'comun.etapas.paso': 'Pas {numero} de {total} · {nombre}',
  'comun.etapas.rotulo': 'Recorregut · Pas {numero} de {total}',
  'comun.etapas.segmento': 'Apartat {numero} de {total} · {nombre}',
  'comun.etapas.siguiente': 'Següent · {0} de {1}',
  'comun.etapas.vista': ', ja vista',
  'comun.idioma.aviso-nombre': 'Avís sobre l’idioma',
  'comun.idioma.boton': 'Idioma: Català',
  'comun.idioma.no-cargado': 'No s’ha pogut carregar el {idioma}. Comprova la connexió i torna’l a triar.',
  'comun.idioma.no-cargado-version':
    'No s’ha pogut carregar el {idioma}: Faro s’ha actualitzat des que vas obrir aquesta pàgina. Torna-la a carregar per canviar d’idioma; en recarregar s’esborra el que hi has fet.',
  'comun.idioma.nombre.ca': 'català',
  'comun.idioma.nombre.es': 'castellà',
  'comun.idioma.titulo': 'Idioma',
  'comun.marca.inicio': 'Faro, inici',
  'comun.menu.abrir': 'Obrir el menú',
  'comun.menu.cerrar': 'Tancar el menú',
  'comun.menu.nombre': 'Menú principal',
  'comun.menu.pasar': 'Passar a un altre dispositiu',

  'comun.pie.creditos': 'Crèdits',
  'comun.pie.derechos': '© 2026 Equip Faro',
  'comun.pie.doctor': 'Comprovar Faro',
  'comun.pie.instalar': 'Instal·lar Faro',
  'comun.pie.datos': 'Les teves dades',
  'comun.pie.nombre': 'Informació i ajuda',
  'comun.referencia': 'Referència ',
  'comun.referencias': 'Referències',
  'comun.saltar': 'Anar al contingut',
  'comun.seccion.biblioteca': 'Biblioteca',
  'comun.seccion.como': 'Com funciona',
  'comun.seccion.empezar': 'Començar',
  'comun.seccion.ia': 'Què és la IA',
  'comun.seccion.inicio': 'Inici',
  'comun.siguiente.nombre': 'Continuar a Faro',
  'comun.siguiente.paso': 'Pas següent',
  'comun.siguiente.seccion': 'Secció següent',
  'comun.tema.a-dia': 'Canviar al mode dia',
  'comun.tema.a-noche': 'Canviar al mode nit',
  'comun.tema.titulo': 'Mode dia / nit',
  'comun.titulo.faro': 'Què és Faro',
  'comun.pie.accesibilidad': 'Accessibilitat',
  'comun.pie.verificable': 'Faro verificable',
  'comun.seccion.datos-globales': 'Dades globals',

  // ---------- Inicio (inicio.html) y su buscador de secciones ----------
  'inicio.buscar.ayuda': 'Troba la secció que necessites.',
  'inicio.buscar.boton': 'Cercar',
  'inicio.buscar.cerrar': 'Tancar la cerca',
  'inicio.buscar.como': 'Els quatre passos i què n’obtens.',
  'inicio.buscar.ejemplo': 'Formació, tasques, informe…',
  'inicio.buscar.empezar': 'Digues-nos a què et dediques, marca les teves tasques i rep el teu informe, tasca a tasca.',
  'inicio.buscar.encontrada': '{numero} secció trobada.',
  'inicio.buscar.encontradas': '{numero} seccions trobades.',
  'inicio.buscar.etiqueta': 'Cercar una secció per tema',
  'inicio.buscar.faro': 'Per a què serveix i com et pot ajudar.',
  'inicio.buscar.ia': 'Què fa i què convé tenir en compte.',
  'inicio.buscar.nombre': 'Cercar a Faro',
  'inicio.buscar.titulo': 'Què vols trobar?',
  'inicio.buscar.vacio': 'Faro no troba aquesta secció. Prova amb «IA», «feina» o «formació».',
  'inicio.descripcion':
    'Entén com pot canviar la teva feina amb la intel·ligència artificial, tasca a tasca, i consulta la formació oficial relacionada amb la teva ocupació.',
  'inicio.explorar.titulo': 'Tria per on començar.',
  'inicio.historia.faro.numero': '02 / Conèixer',
  'inicio.historia.faro.texto': 'Una eina per explorar canvis en la teva feina i opcions de formació.',
  'inicio.historia.ia.numero': '01 / Entendre',
  'inicio.historia.ia.texto': 'Què és, com aprèn i quines precaucions cal prendre, amb un desafiament al final.',
  'inicio.historia.proceso.numero': '03 / Preparar-te',
  'inicio.historia.proceso.texto': 'Guies, informes i notes de fonts oficials, del més senzill al més avançat.',
  'inicio.portada.ejemplo': 'Veure un informe d’exemple',
  'inicio.portada.foto': 'Far de Trwyn Du a Penmon, Gal·les, envoltat pel mar en calma sota un cel blau i rosat.',
  'inicio.portada.hecho.dispositivo': 'El que escrius es queda al teu dispositiu',
  'inicio.portada.hecho.gratis': 'Gratuït',
  'inicio.portada.hecho.registro': 'Sense registre',
  'inicio.portada.intro': 'Descobreix com la IA pot canviar la feina i decideix en què et vols formar.',
  'inicio.portada.titulo-1': 'IA i el teu futur',
  'inicio.portada.titulo-2': 'professional.',
  'inicio.titulo': 'Faro · IA i el teu futur professional',

  // Els textos de «Què és Faro» (que-es-faro.html) són a ca/faro.js.

  // ---------- Les teves dades (informacion-y-creditos.html) ----------
  'informacion-y-creditos.borrar.boton': 'Esborrar-ho tot',
  'informacion-y-creditos.borrar.confirmar':
    'Vols esborrar tot el que Faro ha desat en aquest navegador? No es pot desfer.',
  'informacion-y-creditos.borrar.error':
    'No s’ha pogut esborrar tot. Tanca les altres pestanyes de Faro i torna-ho a provar.',
  'informacion-y-creditos.borrar.nota':
    'Esborra les teves dades i els teus ajustos d’aquest dispositiu. Després, la pàgina torna a l’inici.',
  'informacion-y-creditos.datos.1': 'Per fer el recorregut i consultar els cursos no necessites cap compte.',
  'informacion-y-creditos.datos.2':
    'El recorregut es conserva a la pàgina oberta i desapareix quan la tanques o tornes a començar. El navegador desa les preferències de tema i idioma, una clau aleatòria local per reconèixer els càlculs del dispositiu i còpies de pàgines i dades públiques per fer-les servir sense connexió.',

  'informacion-y-creditos.datos.5':
    'Faro no desa el teu informe ni el comparteix amb empreses ni amb serveis públics: el veus tu i, si vols, el deses en PDF.',
  'informacion-y-creditos.descripcion': 'Què passa amb el que escrius a Faro i com esborrar-ho.',
  'informacion-y-creditos.datos.local':
    'Faro processa el que escrius en aquest dispositiu. El filtre treu les dades personals que reconeix. Pot no reconèixer-les totes: no escriguis el teu nom, el de la teva empresa, dades de salut ni dades d’altres persones.',
  'informacion-y-creditos.intro':
    'Què passa amb el que escrius a Faro i com esborrar-ho. D’on surten les dades i amb quina llicència, a {0}.',
  'informacion-y-creditos.rotulo': 'Privadesa',
  'informacion-y-creditos.titulo': 'Les teves dades · Faro',
  'informacion-y-creditos.titulo-principal': 'Les teves dades',
  'informacion-y-creditos.datos.titulo': 'Què passa amb el que escrius',
  'datos-globales.descripcion':
    'Dades globals: la IA a la feina a Catalunya, Espanya i Europa, amb estadístiques oficials de territoris, cada xifra amb la seva font i el seu any.',
  'datos-globales.titulo': 'Dades globals · Faro',
  'datos-globales.rotulo': 'Dossier · Dades globals',
  'datos-globales.muestra': 'Xifres de mostra per provar la pàgina: no són dades reals.',
  'datos-globales.sin-script':
    'Les xifres es dibuixen al teu navegador: per veure-les cal tenir el JavaScript activat.',
  'datos-globales.estado.cargando': 'Carregant les dades…',
  'datos-globales.estado.no-disponibles': 'Les dades globals no estan disponibles ara. Torna-ho a provar més tard.',
  'datos-globales.estado.no-validos':
    'Les dades globals d’aquesta versió no es poden mostrar: no compleixen el seu format, i Faro no mostra xifres que no ha pogut comprovar.',
  'datos-globales.globo.nombre': 'Globus amb les dades de cada país',
  'datos-globales.grafico.fuente': 'Font: {fuente}',
  'datos-globales.sin-cifra': 'Sense xifra oficial publicada',
  'datos-globales.unidad.puntos': 'punts',
  'datos-globales.puntos': '{puntos} punts',
  'datos-globales.naturaleza.medido': 'Mesurat',
  'datos-globales.naturaleza.estimado': 'Estimat',
  'datos-globales.naturaleza.opinion': 'Enquesta d’opinió',
  'datos-globales.ficha.ambito': 'Àmbit',
  'datos-globales.ficha.anios': 'Anys',
  'datos-globales.ficha.tecnologias': 'Tecnologies',
  'datos-globales.ficha.usos': 'Usos',
  'datos-globales.ficha.motivos': 'Motius',
  'datos-globales.ficha.calculo': 'Càlcul',
  'datos-globales.ficha.metas': 'Metes',
  'datos-globales.ficha.capacidades': 'Capacitats',
  'datos-globales.ficha.especialistas': 'Especialistes',
  'datos-globales.ficha.empresas': 'Empreses',
  'datos-globales.ficha.pymes': 'Pimes',
  'datos-globales.ficha.niveles': 'Nivells',
  'datos-globales.ficha.formacion': 'Formació',
  'datos-globales.ue.empresas.tema': 'Empreses',
  'datos-globales.ue.empresas.todas': 'Totes (10 o més)',
  'datos-globales.ue.empresas.10-49': 'De 10 a 49',
  'datos-globales.ue.empresas.50-249': 'De 50 a 249',
  'datos-globales.ue.empresas.250': '250 o més',
  'datos-globales.ue.empresas.ficha.que-mide':
    'Empreses amb 10 o més treballadors que fan servir almenys una tecnologia d’IA (analitzar textos, entendre la veu, generar textos, veu o codi, reconèixer imatges, aprenentatge automàtic, automatitzar tasques, robots autònoms i, amb dada només el 2025, generar imatges, vídeo o àudio).',
  'datos-globales.ue.empresas.ficha.ambito':
    'UE-27 (EU27_2020): els 27 països junts. Indústria i serveis, sense agricultura ni finances.',
  'datos-globales.ue.empresas.ficha.fuente':
    'Eurostat, enquesta europea sobre l’ús de les TIC a les empreses: isoc_eb_ai, indicador E_AI_TANY, unitat PC_ENT (% d’empreses), per mida (size_emp).',
  'datos-globales.ue.tecnologias.tema': 'Tecnologies',
  'datos-globales.ue.tecnologias.titular.neutro': 'Quin tipus d’IA fan servir les empreses de la UE',
  'datos-globales.ue.tecnologias.alguna': 'Alguna d’elles',
  'datos-globales.ue.tecnologias.texto': 'Analitzar textos',
  'datos-globales.ue.tecnologias.imagen-video-sonido': 'Crear imatge o so',
  'datos-globales.ue.tecnologias.lenguaje': 'Redactar o programar',
  'datos-globales.ue.tecnologias.voz': 'Entendre la veu',
  'datos-globales.ue.tecnologias.automatizacion': 'Automatitzar tasques',
  'datos-globales.ue.tecnologias.aprendizaje-automatico': 'Aprendre de dades',
  'datos-globales.ue.tecnologias.reconocimiento-imagenes': 'Reconèixer imatges',
  'datos-globales.ue.tecnologias.robots': 'Robots autònoms',
  'datos-globales.ue.tecnologias.uso.marketing-ventas': 'Màrqueting o vendes',
  'datos-globales.ue.tecnologias.uso.administracion': 'Administració',
  'datos-globales.ue.tecnologias.uso.finanzas': 'Comptabilitat',
  'datos-globales.ue.tecnologias.uso.produccion': 'Producció',
  'datos-globales.ue.tecnologias.uso.seguridad-informatica': 'Ciberseguretat',
  'datos-globales.ue.tecnologias.uso.id-innovacion': 'R+D i innovació',
  'datos-globales.ue.tecnologias.uso.logistica': 'Logística',
  'datos-globales.ue.tecnologias.sectores': 'Per sectors',
  'datos-globales.ue.tecnologias.frena': 'El que més frena',
  'datos-globales.ue.tecnologias.nota':
    'Una empresa pot fer servir diversos tipus d’IA: per això les xifres no sumen el total.',
  'datos-globales.ue.tecnologias.ficha.que-mide':
    'Empreses amb 10 o més treballadors que fan servir cada tecnologia d’IA i per a què la fan servir, de cada 100 empreses.',
  'datos-globales.ue.tecnologias.ficha.tecnologias':
    'Analitzar textos: mineria de textos. Entendre la veu: reconeixement de la parla. Redactar o programar: generar llenguatge escrit o parlat, o codi. Crear imatge o so: generar imatges, vídeo o àudio; només es pregunta des del 2025. Aprendre de dades: aprenentatge automàtic. Automatitzar tasques: automatització robòtica de processos i ajuda a decidir. Robots autònoms: robots, vehicles i drons que es mouen sols.',
  'datos-globales.ue.tecnologias.ficha.usos':
    'Administració: organització administrativa o direcció de l’empresa. Comptabilitat: comptabilitat, control o gestió financera. Ciberseguretat: seguretat de les TIC.',
  'datos-globales.ue.tecnologias.ficha.sectores':
    'Informació i comunicació (secció J de la NACE): {j} %. Construcció (secció F): {f} %. Taula isoc_eb_ain2.',
  'datos-globales.ue.tecnologias.ficha.motivos':
    'Es pregunta a les empreses que no fan servir la IA però han pensat a fer-la servir ({penso} de cada 100). Els tres més citats: falta de coneixements ({conocimientos}), dubtes sobre les conseqüències legals ({legales}) i protecció de dades i privadesa ({datos}), de cada 100 empreses.',
  'datos-globales.ue.tecnologias.ficha.fuente':
    'Eurostat, isoc_eb_ai (indicadors E_AI_T*, E_AI_P* i E_AI_B*) i isoc_eb_ain2 (E_AI_TANY per sector), unitat PC_ENT, UE-27.',
  'datos-globales.ue.personas.tema': 'Persones',
  'datos-globales.ue.personas.cualquier': 'Per a qualsevol cosa',
  'datos-globales.ue.personas.privada': 'Per a la vida privada',
  'datos-globales.ue.personas.trabajo': 'Per a la feina',
  'datos-globales.ue.personas.estudios': 'Per als estudis',
  'datos-globales.ue.edad.16-24': 'De 16 a 24 anys',
  'datos-globales.ue.edad.25-34': 'De 25 a 34 anys',
  'datos-globales.ue.edad.35-44': 'De 35 a 44 anys',
  'datos-globales.ue.edad.45-54': 'De 45 a 54 anys',
  'datos-globales.ue.edad.55-64': 'De 55 a 64 anys',
  'datos-globales.ue.edad.65-74': 'De 65 a 74 anys',
  'datos-globales.ue.personas.por-que': 'Per què no la fan servir',
  'datos-globales.ue.personas.ficha.que-mide':
    'Persones de 16 a 74 anys que van fer servir alguna eina d’IA generativa els tres mesos anteriors a l’enquesta, en total i segons per a què.',
  'datos-globales.ue.personas.ficha.base':
    'Totes les persones de 16 a 74 anys de la UE, facin servir internet o no (unitat PC_IND). Sobre qui va fer servir internet els tres mesos anteriors (PC_IND_IU3, la base de la pàgina «Catalunya»), la xifra total és {internet}.',
  'datos-globales.ue.personas.ficha.motivos':
    'Sobre qui no va fer servir la IA generativa (PC_IND_IUAIX): no la necessiten, {necesita}; no saben com fer-la servir, {sabe}; no sabien que existia, {existia}; els preocupa la privadesa o la seguretat, {privacidad}. Taula isoc_ai_iaiuxr.',
  'datos-globales.ue.personas.ficha.anio': '{anio} (primera vegada que es pregunta)',
  'datos-globales.ue.personas.ficha.fuente':
    'Eurostat, enquesta europea sobre l’ús de les TIC a les llars: isoc_ai_iaiu (I_IUAI, I_IUAIPR, I_IUAIWP, I_IUAIFE) i isoc_ai_iaiuxr, UE-27.',
  'datos-globales.ue.genero.tema': 'Dones i homes',
  'datos-globales.ue.genero.capacidades': 'Capacitats digitals',
  'datos-globales.ue.genero.ficha.que-mide':
    'Dones i homes de 16 a 74 anys que van fer servir alguna eina d’IA generativa els tres mesos anteriors, segons per a què.',
  'datos-globales.ue.genero.ficha.base':
    'Totes les dones i tots els homes de 16 a 74 anys, facin servir internet o no (PC_IND).',
  'datos-globales.ue.genero.ficha.calculo':
    'Les diferències es calculen amb les xifres sense arrodonir; per això, de vegades, no coincideixen en una dècima amb la resta de les xifres arrodonides.',
  'datos-globales.ue.genero.ficha.anio': '{anio}',
  'datos-globales.ue.genero.ficha.fuente':
    'Eurostat, isoc_ai_iaiu (grups F_Y16_74 i M_Y16_74) i isoc_sk_dskl_i21 (I_DSK2_BAB), UE-27.',
  'datos-globales.ue.trabajo.tema': 'Feina i estudis',
  'datos-globales.ue.trabajo.titular.neutro': 'La IA generativa a la feina, segons l’ocupació i els estudis',
  'datos-globales.ue.trabajo.todas': 'Totes',
  'datos-globales.ue.trabajo.tic': 'Professionals TIC',
  'datos-globales.ue.trabajo.no-manual': 'Ocupació no manual',
  'datos-globales.ue.trabajo.manual': 'Ocupació manual',
  'datos-globales.ue.trabajo.superiores': 'Superiors',
  'datos-globales.ue.trabajo.medios': 'Mitjans',
  'datos-globales.ue.trabajo.bajos': 'Baixos o sense estudis',
  'datos-globales.ue.trabajo.tic.titulo': 'Professionals de les TIC',
  'datos-globales.ue.trabajo.ficha.que-mide':
    'Persones de 16 a 74 anys que van fer servir la IA generativa per a la feina els tres mesos anteriors, segons l’ocupació i els estudis.',
  'datos-globales.ue.trabajo.ficha.grupos':
    'Que treballen: assalariats, autònoms i ajudes familiars. No manuals: grans grups 0 a 5 de la CIUO-08; manuals: 6 a 9 (la mateixa divisió que a la pàgina «Catalunya»). Professionals de les TIC: definició d’Eurostat; també compten entre els no manuals. Estudis: baixos, CINE 0–2; mitjans, 3–4; superiors, 5–8.',
  'datos-globales.ue.trabajo.ficha.base': 'Tota la població de cada grup, faci servir internet o no (PC_IND).',
  'datos-globales.ue.trabajo.ficha.anio': '{anio}',
  'datos-globales.ue.trabajo.ficha.fuente':
    'Eurostat, isoc_ai_iaiu, indicador I_IUAIWP (grups SAL_SELF_FAM, ISCO_ICT, ISCO0_5, ISCO6_9, IND_TOTAL, I5_8, I3_4 i I0_2), UE-27.',
  'datos-globales.ue.capacidades.tema': 'Capacitats digitals',
  'datos-globales.ue.capacidades.al-menos': 'Almenys bàsiques',
  'datos-globales.ue.capacidades.avanzadas': 'Per sobre de bàsiques',
  'datos-globales.ue.capacidades.solo-basicas': 'Bàsiques',
  'datos-globales.ue.capacidades.bajas': 'Baixes',
  'datos-globales.ue.capacidades.reducidas': 'Escasses',
  'datos-globales.ue.capacidades.limitadas': 'Limitades',
  'datos-globales.ue.capacidades.ninguna': 'Cap',
  'datos-globales.ue.capacidades.sin-evaluar': 'No van fer servir internet',
  'datos-globales.ue.capacidades.las-cinco': 'Les cinc alhora',
  'datos-globales.ue.capacidades.area.comunicacion': 'Comunicar-se',
  'datos-globales.ue.capacidades.area.informacion': 'Buscar informació',
  'datos-globales.ue.capacidades.area.resolucion-problemas': 'Resoldre problemes',
  'datos-globales.ue.capacidades.area.seguridad': 'Seguretat',
  'datos-globales.ue.capacidades.area.contenidos': 'Crear continguts',
  'datos-globales.ue.capacidades.area.comunicacion.frase': 'comunicar-se',
  'datos-globales.ue.capacidades.area.informacion.frase': 'buscar informació',
  'datos-globales.ue.capacidades.area.resolucion-problemas.frase': 'resoldre problemes',
  'datos-globales.ue.capacidades.area.seguridad.frase': 'fer servir internet amb seguretat',
  'datos-globales.ue.capacidades.area.contenidos.frase': 'crear continguts digitals',
  'datos-globales.ue.capacidades.avanzadas.titulo': 'Per sobre de bàsiques',
  'datos-globales.ue.capacidades.dificil': 'L’àrea més difícil',
  'datos-globales.ue.capacidades.nota':
    '«Almenys bàsiques» demana les cinc àrees alhora; per això és més baix que cada àrea per separat.',
  'datos-globales.ue.capacidades.ficha.que-mide':
    'L’indicador de capacitats digitals d’Eurostat (versió 2.0): a partir del que cada persona diu que ha fet a internet els tres mesos anteriors, puntua cinc àrees: informació i dades, comunicació i col·laboració, creació de continguts, seguretat i resolució de problemes.',
  'datos-globales.ue.capacidades.ficha.niveles':
    'Per sobre de bàsiques: les cinc àrees per sobre del bàsic. Bàsiques: les cinc almenys en nivell bàsic, sense ser-hi totes per sobre. Baixes: quatre de cinc. Escasses: tres de cinc. Limitades: dues de cinc. Cap: cap àrea. No van fer servir internet: no es poden mesurar. Els vuit nivells sumen 100 (sense comptar la fila «Almenys bàsiques», que és la suma de les dues primeres).',
  'datos-globales.ue.capacidades.ficha.base': 'Totes les persones de 16 a 74 anys (PC_IND).',
  'datos-globales.ue.capacidades.ficha.anios': 'Es mesura cada dos anys: 2021, 2023 i 2025.',
  'datos-globales.ue.capacidades.ficha.fuente':
    'Eurostat, isoc_sk_dskl_i21: I_DSK2_BAB, I_DSK2_AB, I_DSK2_B, I_DSK2_LW, I_DSK2_N, I_DSK2_LM, I_DSK2_X, I_DSK2_NA i, per àrees, I_DSK2_CC_BAB, I_DSK2_IL_BAB, I_DSK2_PS_BAB, I_DSK2_SF_BAB i I_DSK2_DCC_BAB; UE-27.',
  'datos-globales.ue.capacidades.ficha.formacion':
    'No hi ha una taula actual d’Eurostat sobre persones que es formen per millorar les capacitats digitals: l’última («Way of obtaining ICT skills», isoc_sk_how_i) acaba el 2018.',
  'datos-globales.ue.metas.tema': 'Metes per al 2030',
  'datos-globales.ue.metas.titular.neutro': 'Com va la UE cap a les seves metes digitals per al 2030',
  'datos-globales.ue.metas.millones': '{cifra} milions',
  'datos-globales.ue.metas.faltan.puntos': 'Falten {faltan} punts per a la meta del {meta}.',
  'datos-globales.ue.metas.faltan.millones': 'Falten {faltan} milions per a la meta de {meta} milions.',
  'datos-globales.ue.metas.meta-capacidades-digitales':
    'Persones de 16 a 74 anys amb capacitats digitals almenys bàsiques',
  'datos-globales.ue.metas.meta-especialistas-tic': 'Especialistes en TIC que treballen a la UE',
  'datos-globales.ue.metas.meta-empresas-nube-datos-ia':
    'Empreses que fan servir almenys una: núvol, anàlisi de dades o IA',
  'datos-globales.ue.metas.meta-pymes-intensidad-digital':
    'Pimes (de 10 a 249 treballadors) amb una intensitat digital almenys bàsica',
  'datos-globales.ue.metas.ficha.metas':
    'Decisió (UE) 2022/2481, per la qual s’estableix el programa estratègic de la Dècada Digital per al 2030, article 4 (text literal de la versió castellana del DO): {textos}',
  'datos-globales.ue.metas.ficha.capacidades':
    'Eurostat, isoc_sk_dskl_i21, indicador I_DSK2_BAB (les cinc àrees en nivell bàsic o superior), PC_IND. Es mesura cada dos anys.',
  'datos-globales.ue.metas.ficha.especialistas':
    'Eurostat, isoc_sks_itspt (milers de persones i % de l’ocupació total) i isoc_sks_itsps (% de dones), enquesta de població activa. Eurostat marca les xifres de la UE amb «e» (estimades).',
  'datos-globales.ue.metas.ficha.empresas':
    'Eurostat, isoc_eb_ai, indicador E_AI_CC1SI_DA_ANY: empreses que fan servir la IA, o compren serveis de núvol sofisticats o intermedis, o analitzen dades. La llei diu «macrodades» i l’enquesta pregunta per anàlisi de dades.',
  'datos-globales.ue.metas.ficha.pymes':
    'Eurostat, isoc_e_dii, indicador E_DI3_GELO (índex d’intensitat digital, versió 3), empreses de 10 a 249 treballadors, PC_ENT. «Bàsica» és fer servir almenys quatre de dotze tecnologies. {version4}; les dues versions no es comparen entre si.',
  'datos-globales.ue.metas.ficha.pymes.version4': 'La versió 4 (anys parells) va donar el {cifra} el {anio}',
  'datos-globales.ue.metas.ficha.pymes.version4.sin-dato': 'La versió 4 (anys parells), sense dada',
  'datos-globales.ue.especialistas.tema': 'Especialistes en TIC',
  'datos-globales.ue.especialistas.titular.neutro': 'Les empreses de la UE i els especialistes en TIC',
  'datos-globales.ue.especialistas.emplean': 'En tenen',
  'datos-globales.ue.especialistas.buscan': 'Van intentar contractar-ne',
  'datos-globales.ue.especialistas.vacantes': 'Vacants difícils',
  'datos-globales.ue.especialistas.faltan-candidaturas': 'Poques candidatures',
  'datos-globales.ue.especialistas.salarios': 'Sous demanats alts',
  'datos-globales.ue.especialistas.formacion': 'Falta de formació',
  'datos-globales.ue.especialistas.experiencia': 'Falta d’experiència',
  'datos-globales.ue.especialistas.mitad': 'Més de la meitat',
  'datos-globales.ue.especialistas.quien': 'Qui en té',
  'datos-globales.ue.especialistas.ficha.que-mide':
    'Empreses amb 10 o més treballadors que tenen especialistes en TIC (persones la feina principal de les quals és la informàtica), que van intentar contractar-ne l’any anterior i que van tenir vacants difícils de cobrir, i per què els va costar.',
  'datos-globales.ue.especialistas.ficha.base':
    'Primer gràfic: totes les empreses (PC_ENT). Segon gràfic: empreses que van contractar o intentar contractar especialistes en TIC (PC_ENT_ITSPRCR2). Una empresa pot donar diversos motius.',
  'datos-globales.ue.especialistas.ficha.anios': 'L’enquesta ho pregunta cada dos anys ({anterior}).',
  'datos-globales.ue.especialistas.ficha.anios.anterior': '{anio}: {cifra} amb vacants difícils',
  'datos-globales.ue.especialistas.ficha.anios.sin-dato': 'edició anterior, sense dada',
  'datos-globales.ue.especialistas.ficha.fuente':
    'Eurostat, enquesta europea sobre l’ús de les TIC a les empreses: isoc_ske_itspen2 (E_ITSP2) i isoc_ske_itrcrn2 (E_ITSPRCR2, E_ITSPVAC2, E_ITSPDLA, E_ITSPDSAL, E_ITSPDLET, E_ITSPDLWE), UE-27, indústria i serveis sense finances.',
  'datos-globales.ue.formacion.tema': 'Formació',
  'datos-globales.ue.formacion.su-personal': 'El seu personal',
  'datos-globales.ue.formacion.otro': 'Altre personal',
  'datos-globales.ue.formacion.especialistas': 'Especialistes TIC',
  'datos-globales.ue.formacion.sexo': 'Dones i homes',
  'datos-globales.ue.formacion.ficha.que-mide':
    'Persones de 25 a 64 anys que van fer alguna activitat d’educació o formació les quatre setmanes anteriors a l’enquesta. I empreses amb 10 o més treballadors que van donar formació en informàtica (TIC) al seu personal: a qualsevol (E_ITT2), als especialistes en TIC (E_ITSPT2) o a la resta del personal (E_ITUST2).',
  'datos-globales.ue.formacion.ficha.anios':
    'Adults: la sèrie comença el 2021, quan va canviar l’enquesta de població activa (Eurostat ho marca amb «b»). Empreses: l’enquesta ho pregunta cada dos anys.',
  'datos-globales.ue.formacion.ficha.fuente':
    'Eurostat, trng_lfse_04 (enquesta de població activa, % de persones, UE-27) i isoc_ske_ittn2 (E_ITT2, E_ITUST2 i E_ITSPT2, PC_ENT, UE-27).',
  'datos-globales.ue.opinion.tema': 'Opinió',
  'datos-globales.ue.opinion.titular.hallazgo': 'A la UE, la majoria veu bé la IA a la feina',
  'datos-globales.ue.opinion.titular.neutro': 'Què opina la gent de la UE de la IA a la feina',
  'datos-globales.ue.opinion.titular.reglas': 'A la UE, la majoria veu bé la IA a la feina i demana regles',
  'datos-globales.ue.opinion.trabajo': 'Qui treballa per a una empresa o un cap',
  'datos-globales.ue.opinion.cuidado': 'Cal gestionar-los amb cura',
  'datos-globales.ue.opinion.destruira': 'Trauran més llocs de treball dels que crearan',
  'datos-globales.ue.opinion.sociedad': 'Són bons per a la societat',
  'datos-globales.ue.opinion.positiva': 'Veuen bé que es facin servir a la feina',
  'datos-globales.ue.opinion.regla.intimidad': 'Protegir la intimitat',
  'datos-globales.ue.opinion.regla.trabajadores': 'Comptar amb els treballadors',
  'datos-globales.ue.opinion.regla.transparencia': 'Més transparència en personal',
  'datos-globales.ue.opinion.regla.decisiones': 'Prohibir decisions només automàtiques',
  'datos-globales.ue.opinion.regla.vigilancia': 'Limitar la vigilància automàtica',
  'datos-globales.ue.opinion.herramientas': 'Eines i formació',
  'datos-globales.ue.opinion.ficha.preguntas':
    'Les del qüestionari que porta l’arxiu de dades, amb el seu número: {preguntas}. Cada fila dels gràfics i cada targeta és una pregunta, amb el seu nom.',
  'datos-globales.ue.opinion.ficha.base':
    'Les de QB3 només es fan a qui treballa per a una empresa o un cap; les altres, a totes les persones de 15 anys o més.',
  'datos-globales.ue.opinion.ficha.cifras':
    'Suma de les respostes d’acord, positives o importants. L’Eurobaròmetre publica percentatges enters; es mostren sense decimals.',
  'datos-globales.ue.opinion.ficha.encuesta':
    'Comissió Europea, Eurobaròmetre especial 554, «Artificial Intelligence and the future of work» (onada 101.4): 26.415 entrevistes a persones de 15 anys o més als 27 països (treball de camp: 25/04–22/05/2024). Publicat el 2025.',
  'datos-globales.ficha.sectores': 'Sectors',
  'datos-globales.genero.mujeres': 'Dones',
  'datos-globales.genero.hombres': 'Homes',
  'datos-globales.genero.cabecera': 'Diferència',
  'datos-globales.fuentes.titulo': 'Fonts',
  'datos-globales.fuentes.eurostat': 'Eurostat. {0} ({1}). Actualització: {2}.',
  'datos-globales.fuentes.eurostat.dos': 'Eurostat. {0} ({1}) i {2} ({3}). Actualització: {4}.',
  'datos-globales.fuentes.eurobarometro':
    'Comissió Europea. {0} (onada 101.4, abril i maig del 2024), volum A. Enquesta d’opinió.',
  'datos-globales.fuentes.ceo': 'Centre d’Estudis d’Opinió. {0} (REO 1151), pregunta P26. Enquesta d’opinió.',
  'datos-globales.fuentes.decada-digital':
    'Decisió (UE) 2022/2481 del Parlament Europeu i del Consell, de 14 de desembre de 2022, per la qual s’estableix el programa estratègic de la Dècada Digital per al 2030 (DO L 323 de 19/12/2022), article 4, «Metes digitals».',
  'datos-globales.fuentes.tic-h':
    'Idescat, a partir de l’enquesta TIC-H de l’INE. {0}, taules 3.4.1 i 3.4.2 («IA generativa»). Publicació: {1}.',
  'datos-globales.fuentes.clima': 'Idescat. {0}, mòdul «Intel·ligència artificial», 2n trimestre del 2024.',
  'datos-globales.fuentes.consultadas': 'Data de consulta: {fecha}.',
  'datos-globales.fuentes.licencias':
    'Eurostat i la Comissió Europea (Decisió 2011/833/UE) permeten reutilitzar les seves dades citant-ne la font; l’Idescat, citant «Font: Idescat»; el CEO, amb la Llicència oberta d’ús d’informació – Catalunya, citant-lo i enllaçant amb la llicència.',
  'globo.descripcion': 'Globus terraqüi amb la imatge de satèl·lit de la NASA. Territori triat: {territorio}.',
  'globo.descripcion.ninguno': 'Globus terraqüi amb la imatge de satèl·lit de la NASA. Cap territori triat.',
  'globo.mandos': 'Moure el globus',
  'globo.mando.izquierda': 'Girar cap a l’esquerra',
  'globo.mando.derecha': 'Girar cap a la dreta',
  'globo.mando.arriba': 'Girar cap amunt',
  'globo.mando.abajo': 'Girar cap avall',
  'globo.mando.centrar': 'Tornar al meu país',
  'globo.vista-plana': 'Vista plana: aquest navegador no dibuixa el globus en 3D.',
  'globo.mando.acercar': 'Apropar',
  'globo.mando.alejar': 'Allunyar',
  'datos-globales.pestanas.nombre': 'Pàgines de Dades globals',
  'datos-globales.pestanas.paises': 'Catalunya',
  'datos-globales.pestanas.ue': 'Unió Europea',
  'datos-globales.pestanas.mundo': 'El món',
  'datos-globales.ue.titulo-pagina': 'Unió Europea · Dades globals · Faro',
  'datos-globales.ue.descripcion':
    'Dades globals: la IA a la feina a la Unió Europea, els 27 països junts, amb estadístiques oficials, cada xifra amb la seva font i el seu any.',
  'datos-globales.ue.fuentes.licencias':
    'Eurostat i la Comissió Europea (Decisió 2011/833/UE) permeten reutilitzar les seves dades citant-ne la font.',
  'datos-globales.mundo.titulo-pagina': 'El món · Dades globals · Faro',
  'datos-globales.mundo.descripcion':
    'Dades globals: la IA al món, país per país, amb estadístiques oficials, cada xifra amb la seva font i el seu any.',
  'datos-globales.mundo.titulo': 'El treball al món',
  'datos-globales.mundo.entradilla':
    'La IA a cada país: quant es fa servir, on una estadística oficial ho mesura. Gira el globus o cerca el teu país.',
  'datos-globales.mundo.creditos': 'Fonts i llicències d’aquestes xifres:',
  'datos-globales.mundo.creditos.enlace': 'Crèdits · Dades globals',
  'globo.panel.ia': 'La IA a {territorio}',
  'globo.instrucciones':
    'Cada marca és un país o una regió amb dades: prem-la per veure’n la fitxa. La del país triat és groga i més gran. Arrossega el globus per girar-lo; amb el teclat: fletxes, + i −.',
  'globo.sin-webgl': 'Aquest navegador no pot dibuixar el globus. El selector de país i la fitxa funcionen igual.',
  'globo.no-carga': 'No s’ha pogut carregar el globus. El selector de país i la fitxa funcionen igual.',
  'globo.sin-datos': 'Faro no té dades d’aquest país. Els que en tenen són a «Escriu o tria el teu país».',
  'globo.buscar': 'Escriu o tria el teu país',
  'globo.selector.abrir': 'Veure tots els països',
  'globo.selector.lista': 'Països i regions amb dades',
  'globo.selector.region': '(regió d’Espanya)',
  'globo.selector.ninguno': 'Cap país amb dades no es diu així.',
  'globo.panel.anuncio': 'Fitxa del país: {territorio}.',
  'globo.panel.anuncio-region': 'Fitxa de la regió: {territorio}.',
  'globo.ficha.antetitulo': 'Fitxa del país',
  'globo.ficha.antetitulo-region': 'Fitxa de la regió',
  'globo.ficha.sin-dato.titulo': 'Sense dada per a {territorio}',
  'globo.ficha.sin-dato.nota':
    'Per a aquestes xifres, el globus fa servir a cada país la base de tota la població de 16 a 74 anys (Eurostat) o les dades de l’OIT, que no es publiquen per a Catalunya. No s’hi posa la xifra d’Espanya. Les de l’Idescat per a Catalunya, amb la base de les persones que fan servir internet, són a «Catalunya».',
  'globo.ficha.datos': 'Últimes dades: {anios} · {fuentes}',
  'globo.ficha.anios': '{desde} a {hasta}',
  'globo.ficha.cualquier-uso': 'Per a qualsevol ús',
  'globo.ficha.para-trabajar': 'Per treballar',
  'globo.ficha.empresas.titulo': 'Empreses que fan servir IA',
  'globo.ficha.empresas.frase': 'De cada 100 empreses amb 10 o més treballadors, {n} fan servir IA ({anio}).',
  'globo.ficha.empresas.grafico': 'Empreses amb 10 o més treballadors que fan servir IA, de cada 100',
  'globo.ficha.personas.titulo': 'Persones que fan servir IA generativa',
  'globo.ficha.personas.frase':
    'De cada 100 persones de 16 a 74 anys, {n} van fer servir IA generativa en els últims tres mesos ({anio}).',
  'globo.ficha.personas.frase-trabajo':
    'De cada 100 persones de 16 a 74 anys, {n} van fer servir IA generativa en els últims tres mesos i {trabajo} la van fer servir per treballar ({anio}).',
  'globo.ficha.personas.grafico': 'Persones de 16 a 74 anys que van fer servir IA generativa, de cada 100',
  'globo.ficha.genero.titulo': 'Dones i homes',
  'globo.ficha.genero.frase':
    'De cada 100 dones de 16 a 74 anys, {a} van fer servir IA generativa; de cada 100 homes, {b} ({anio}).',
  'globo.ficha.genero.grafico':
    'Dones i homes de 16 a 74 anys que van fer servir IA generativa, de cada 100 de cada sexe',
  'globo.ficha.trabajo.titulo': 'Segons el tipus de feina',
  'globo.ficha.trabajo.frase':
    'De cada 100 persones amb feines no manuals, {a} van fer servir IA generativa per treballar; amb feines manuals, {b} ({anio}).',
  'globo.ficha.trabajo.grafico':
    'Persones ocupades que van fer servir IA generativa per treballar, de cada 100 de cada grup',
  'globo.ficha.trabajo.no-manual': 'Feines no manuals',
  'globo.ficha.trabajo.manual': 'Feines manuals',
  'globo.ficha.trabajo.tic': 'Professionals de les TIC',
  'globo.ficha.nacional.titulo': 'Empreses que fan servir IA, segons l’estadística del país',
  'globo.ficha.nacional.frase': 'De cada 100 empreses, {n} fan servir IA segons l’enquesta nacional ({anio}).',
  'globo.ficha.nacional.grafico': 'Empreses que fan servir IA segons l’enquesta nacional, de cada 100',
  'globo.ficha.nacional-personas.titulo': 'Persones que han fet servir IA generativa, segons l’estadística del país',
  'globo.ficha.nacional-personas.frase':
    'De cada 100 persones, {n} han fet servir alguna vegada IA generativa segons l’enquesta nacional ({anio}).',
  'globo.ficha.exposicion.titulo': 'Exposició a la IA generativa (calculada)',
  'globo.ficha.exposicion.alta':
    'De cada 100 persones ocupades, {n} treballen en ocupacions amb exposició alta a la IA generativa segons l’índex de l’OIT ({anio}).',
  'globo.ficha.exposicion.alta.cotas':
    'De cada 100 persones ocupades, entre {inferior} i {superior} treballen en ocupacions amb exposició alta a la IA generativa segons l’índex de l’OIT ({anio}).',
  'globo.ficha.exposicion.alguna':
    'Amb alguna exposició a la IA generativa, la que sigui, hi treballen {n} de cada 100 ({anio}).',
  'globo.ficha.exposicion.alguna.cotas':
    'Amb alguna exposició a la IA generativa, la que sigui, hi treballen entre {inferior} i {superior} de cada 100 ({anio}).',
  'globo.ficha.exposicion.intervalo':
    'Calculada amb una enquesta: amb un 95 % de confiança, és entre {desde} i {hasta}.',
  'globo.ficha.exposicion.sin-correspondencia':
    'El {parte} % de l’ocupació no es pot assignar amb exactitud a una ocupació de l’índex: per això es dona entre quines xifres és.',
  'globo.ficha.exposicion.nota':
    'És l’exposició de les ocupacions per les seves tasques, calculada: no és l’ús de la IA ni una predicció de llocs de treball perduts o creats.',
  'globo.ficha.empleo.resumen':
    'El grup d’ocupacions més nombrós és «{grupo}»: {n} de cada 100 persones que treballen ({anio}).',
  'globo.ficha.empleo.titulo': 'Com es reparteix l’ocupació',
  'globo.ficha.empleo.grupos': 'Persones que treballen, per grup d’ocupació',
  'globo.ficha.empleo.mujeres.titulo': 'Dones a cada grup d’ocupació',
  'globo.ficha.empleo.grafico': 'De cada 100 persones que treballen, quantes n’hi ha a cada gran grup d’ocupació',
  'globo.ficha.empleo.mujeres': 'De cada 100 persones de cada gran grup, quantes són dones',
  'globo.ficha.empleo.grupo.1': 'Directors i gerents',
  'globo.ficha.empleo.grupo.2': 'Científics i intel·lectuals',
  'globo.ficha.empleo.grupo.3': 'Tècnics de nivell mitjà',
  'globo.ficha.empleo.grupo.4': 'Suport administratiu',
  'globo.ficha.empleo.grupo.5': 'Serveis i comerç',
  'globo.ficha.empleo.grupo.6': 'Agricultura, boscos i pesca',
  'globo.ficha.empleo.grupo.7': 'Oficis i artesania',
  'globo.ficha.empleo.grupo.8': 'Operadors de màquines',
  'globo.ficha.empleo.grupo.9': 'Ocupacions elementals',
  // ---------- Declaración de accesibilidad (accesibilidad.html) ----------
  'accesibilidad.titulo': 'Accessibilitat · Faro',
  'accesibilidad.descripcion': 'Declaració d’accessibilitat de Faro: fins on compleix, què falta i com avisar-nos.',
  'accesibilidad.rotulo': 'Accessibilitat',
  'accesibilidad.titulo-principal': 'Declaració d’accessibilitat',
  'accesibilidad.intro':
    'Faro vol que el pugui fer servir qualsevol persona i es compromet a fer-lo accessible de conformitat amb el Reial decret 1112/2018, de 7 de setembre, sobre accessibilitat dels llocs web i aplicacions per a dispositius mòbils del sector públic. Aquesta declaració val per a aquest web i per a l’aplicació que s’hi instal·la, que és la mateixa.',
  'accesibilidad.situacion.titulo': 'Situació de compliment',
  'accesibilidad.situacion.texto':
    'Faro és parcialment conforme amb el Reial decret 1112/2018, per les faltes de conformitat que s’enumeren a sota i perquè falta la revisió amb persones que fan servir lectors de pantalla i altres ajudes tècniques. La referència és el nivell AA de les Pautes d’Accessibilitat per al Contingut Web (WCAG) 2.2 i la norma EN 301 549 V4.1.1.',
  'accesibilidad.contenido.titulo': 'Contingut no accessible',
  'accesibilidad.contenido.intro': 'Falta de conformitat amb els requisits, i la seva alternativa quan n’hi ha:',
  'accesibilidad.contenido.pdf':
    'L’informe es pot llegir amb lector de pantalla a la mateixa pàgina i descarregar en PDF. Aquest PDF, i el del full de ruta, els crea el navegador en imprimir: Faro no pot garantir que surtin etiquetats per a lectors de pantalla (EN 301 549, capítol 10). Alternativa: l’informe a la mateixa pàgina i el full de ruta en HTML, amb el mateix contingut.',
  'accesibilidad.preparacion.titulo': 'Preparació d’aquesta declaració',
  'accesibilidad.preparacion.texto':
    'Aquesta declaració es va preparar el 10 d’octubre del 2026 amb una avaluació pròpia de l’equip de Faro, sense auditoria externa: revisió del codi del web criteri a criteri i comprovacions automàtiques de l’estructura de cada pàgina (idioma, títol, encapçalament principal, enllaç per saltar al contingut, etiquetes dels camps, textos alternatius de les imatges i referències internes). Falta la revisió manual amb lectors de pantalla, ampliadors i control per veu. Darrera revisió: 10 d’octubre del 2026.',
  'accesibilidad.contacto.titulo': 'Observacions i dades de contacte',
  'accesibilidad.contacto.texto':
    'Per avisar d’una dificultat d’accessibilitat, demanar informació en un format accessible o presentar una queixa, escriu a {0}.',
  'accesibilidad.reclamacion.titulo': 'Procediment d’aplicació',
  'accesibilidad.reclamacion.texto': 'Pots adreçar una reclamació sobre accessibilitat a {0}.',
  'informacion-y-creditos.datos.avisos':
    'Per detectar errors de càrrega i de seguretat, Faro rep avisos tècnics del navegador. Conserva el tipus, un codi d’una llista limitada, l’origen de la web i l’hora aproximada; no conserva la ruta, el text del recorregut ni el contingut lliure de l’avís.',
  'informacion-y-creditos.alojamiento.titulo': 'Quan et connectes a la web',
  'informacion-y-creditos.alojamiento.texto':
    'El servei d’allotjament rep l’adreça IP i dades tècniques de la connexió necessàries per lliurar les pàgines i protegir el servei. En les instal·lacions allotjades a Cloudflare, aquest tractament es descriu a la seva {0}. El text del recorregut es processa al dispositiu i no s’envia a l’allotjament.',
  'informacion-y-creditos.alojamiento.enlace': 'política de privadesa',
  'informacion-y-creditos.servicios.titulo': 'Connexions d’institucions i assistents',
  'informacion-y-creditos.servicios.texto':
    'Quan s’habilita la connectivitat, Faro registra les consultes institucionals: data, institució, operació i resultat. Les consultes d’assistents i agents es compten per dia i operació; el nom de l’assistent és declarat, no una identitat verificada. Aquest registre no desa els arguments, les capçaleres ni les adreces IP i conserva fins a 10.000 files durant un màxim de 30 dies.',
  'informacion-y-creditos.servicios.acceso':
    'Per gestionar l’accés institucional, el panell conserva el nom de l’entitat, el seu correu de contacte si es facilita, l’estat de l’accés i les empremtes de les credencials. Les invitacions caduquen al cap de set dies. Les claus secretes es mostren una sola vegada i no es desen en clar.',
  'informacion-y-creditos.derechos.titulo': 'Control i drets',
  'informacion-y-creditos.derechos.texto':
    'El botó «Esborrar-ho tot» elimina les dades que Faro desa en aquest navegador; no elimina els PDF que hagis desat ni els registres de l’allotjament. Pots adreçar-te a l’entitat responsable per exercir els drets d’accés, rectificació, supressió, oposició, limitació i portabilitat quan corresponguin, i reclamar davant l’autoritat de protecció de dades competent. Consulta la {0}.',
  'informacion-y-creditos.derechos.enlace': 'informació de l’AEPD sobre aquests drets',
};
