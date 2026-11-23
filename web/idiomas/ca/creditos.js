// Textos de créditos, fuentes y ejemplo del informe en catalán. Se incorporan al diccionario de ca.js.

/** Una licencia que comparten varias fuentes: la de los datos del INE. */
const LICENCIA_INE = 'CC BY 4.0, citant l’INE';
/** Una licencia que comparten varias fuentes: la de los datos de la Unión Europea. */
const LICENCIA_UE = '© Unió Europea; reutilització citant la font';
/** Una licencia que comparten varias fuentes: la de los datos del Idescat. */
const LICENCIA_IDESCAT = 'Avís legal de l’Idescat: citar la font i la data, sense modificar les dades';
/** Una licencia que comparten varias fuentes: la de los datos del SEPE ({0}, su cita). */
const LICENCIA_SEPE = 'Avís legal del SEPE: «{0}» i la data';
/** Una licencia que comparten varias fuentes: la de los datos abiertos de la Generalitat. */
const LICENCIA_OBERTA_CATALUNYA = "Llicència oberta d'ús d'informació – Catalunya";

/**
 * Diccionario de solo lectura (clave -> texto) en catalán con los créditos, las fuentes y el ejemplo del informe.
 * @type {Readonly<Record<string, string>>}
 */
export const TEXTOS_CREDITOS = {
  'creditos.vectores.uso':
    'Vectors per relacionar textos, ocupacions i cursos. Ajustats i destil·lats per Faro amb dades d’ESCO i de l’OIT.',
  'creditos.vectores.avisos': 'Atribució i modificacions de Faro',
  'creditos.vectores.condiciones': 'Política d’usos prohibits de Gemma',

  // ---------- Créditos (creditos.html) ----------
  'creditos.colaboradores.i2tic':
    'Col·labora amb Faro aportant la seva recerca sobre la intel·ligència artificial i la transformació de l’ocupació.',
  'creditos.colaboradores.i2tic.organismo': 'Grup de recerca de la Universitat Oberta de Catalunya (UOC)',
  'creditos.colaboradores.sintech':
    'Col·labora en l’estudi de viabilitat i en el desenvolupament de Faro amb la perspectiva sindical i acadèmica sobre la IA i el treball: ajuda a identificar possibles impactes, biaixos i aspectes de millora.',
  'creditos.marco':
    'Faro s’ha desenvolupat en el marc de la Compra Pública Innovadora 2026 del {0} (Fundació pel Foment de la Societat del Coneixement), en resposta al repte de dissenyar una eina d’IA que ajudi les persones treballadores a comprendre l’impacte de la IA en la seva ocupació i les competències que necessiten. Faro i els seus continguts són responsabilitat exclusiva del seu autor.',
  'creditos.categoria.colaboradores.marco': 'Marc del projecte',
  'creditos.colaboradores.odee.cita': 'Font de les dades: ODEE i Cambra de Comerç de Barcelona.',
  'creditos.globo.natural-earth.licencia': 'Domini públic. {0}',
  'creditos.globo.natural-earth.uso':
    'Les fronteres del globus: països a escala 1:110 m; Catalunya, de les seves províncies a 1:10 m. Són fronteres de facto: el mapa no pren posició sobre les fronteres en disputa.',
  'creditos.globo.nasa.licencia':
    'Segons les condicions d’ús de la NASA, el seu contingut, en general, no està subjecte a drets d’autor als Estats Units; es reconeix la NASA com a font, sense suggerir-ne el suport.',
  'creditos.globo.nasa.uso': 'La imatge de la Terra del globus de «Dades globals».',
  'creditos.globo.nasa.obra': 'Blue Marble: Next Generation (juliol de 2004)',
  'creditos.campo.version': 'Versió',
  'creditos.colaboracion.oit-nask': 'OIT en col·laboració amb NASK',
  'creditos.colaboracion.ine-oit': 'INE en col·laboració amb l’OIT',
  'creditos.organismo.msit': 'MSIT i NIA (Corea del Sud)',
  'creditos.organismo.union-europea': 'Unió Europea',
  'creditos.organismo.comision-europea': 'Comissió Europea',
  'creditos.indice.unidad': 'crèdits',
  'creditos.licencia.eurostat': 'Avís de drets d’autor d’Eurostat (Decisió 2011/833/UE)',
  'creditos.grupo.condiciones': 'Condicions comunes del grup',
  'creditos.campo.codigo': 'Codi:',
  'creditos.campo.autoria': 'Autoria',
  'creditos.campo.avisos': 'Avisos',
  'creditos.campo.fuente': 'Font',
  'creditos.campo.consulta': 'Data de consulta',
  'creditos.campo.cita': 'Cita',
  'creditos.campo.licencia': 'Llicència',
  'creditos.campo.uso': 'Ús a Faro',
  'creditos.campo.papel': 'Paper',
  'creditos.campo.organismo': 'Organisme',
  'creditos.categoria.tipografias.intro':
    'Les tres famílies tipogràfiques de Faro. Se serveixen des del mateix web, amb la SIL Open Font License 1.1.',
  'creditos.categoria.tipografias': 'Tipografies',
  'creditos.categoria.imagenes.intro': 'Les fotografies de les portades.',
  'creditos.categoria.mapas.intro': 'La imatge de la Terra i les fronteres del globus de «Dades globals».',
  'creditos.categoria.mapas': 'Geografia i mapes',
  'creditos.categoria.normativa.intro':
    'Les lleis, les decisions i les recomanacions que Faro cita o resumeix, amb l’enllaç al text oficial.',
  'creditos.categoria.normativa': 'Normativa i documents de referència',
  'creditos.categoria.clasificaciones.intro':
    'Classificacions, marcs de referència i vocabularis amb què Faro ordena les ocupacions i les competències i reconeix noms propis.',
  'creditos.categoria.clasificaciones': 'Classificacions i vocabularis',
  'creditos.categoria.otros-paises.intro':
    'Les oficines d’estadística i els ministeris d’altres països les xifres dels quals fa servir «El món», a «Dades globals»: l’ús de la IA, que cada país mesura a la seva manera i no es compara entre països, i l’ocupació per professió amb què es calcula l’exposició. Cap no ha revisat Faro ni li dona suport.',
  'creditos.categoria.otros-paises': 'Estadístiques d’altres països',
  'creditos.categoria.estadisticas.intro':
    'Les xifres oficials de l’informe, de «Dades globals» i de les fitxes en PDF de la Biblioteca. Al costat de cada xifra hi ha la seva font i el seu any. El que Faro calcula amb aquestes dades és elaboració pròpia. Cap d’aquestes entitats ha revisat Faro ni li dona suport.',
  'creditos.categoria.estadisticas': 'Dades oficials i estadístiques',
  'creditos.categoria.colaboradores.grupo': 'Col·laboradors',
  'creditos.categoria.colaboradores': 'Col·laboradors i marc del projecte',
  'creditos.licencia.idescat': LICENCIA_IDESCAT,
  'creditos.grupo.idescat.licencia':
    "Avís legal de l’Idescat (https://www.idescat.cat/institut/web/?lang=ca) i condicions d’ús de les seves API (https://www.idescat.cat/dev/api/?lang=ca): reutilització permesa citant la font («Font: elaboració pròpia a partir de dades de l'Idescat») amb la data de l’última actualització, enllaçant amb idescat.cat, sense modificar les dades en presentar-les i sense suggerir que l’Idescat dona suport a l’ús.",
  'creditos.abre-en-otra-pestana': 'Els enllaços a altres webs s’obren en una altra pestanya.',
  'creditos.autoria': 'Faro el fa l’Equip Faro.',
  'creditos.bibliotecas.country-flag-icons.uso':
    'Les banderes dels països d’«El món», tret de les de disseny propi de Faro',
  'creditos.bibliotecas.noble.uso': 'Criptografia per comprovar les signatures del web de Faro',
  'creditos.bibliotecas.qrcode-generator.uso': 'El codi QR de «Passar a un altre dispositiu»',
  'creditos.citar': 'Com citar Faro',
  'creditos.citar-texto': 'Equip Faro (2026). Faro · IA, treball i formació. Versió 1.0.0.',
  'creditos.colaboradores.gracias':
    'Gràcies també als organismes que publiquen les seves dades amb llicències obertes i les mantenen al dia.',
  'creditos.colaboradores.odee':
    'L’Observatori Dona, Empresa i Economia va facilitar a Faro la taula per ocupació del seu estudi {0} (2026).',
  'creditos.descripcion':
    'Qui fa possible Faro i d’on surten les seves dades, les seves imatges i el seu programari, amb la seva llicència.',
  'creditos.entradilla':
    'Qui fa possible Faro i d’on surten les seves dades, les seves imatges i el seu programari, amb la llicència de cadascun.',
  'creditos.formacion.intro':
    'Qui publica la formació, els certificats i les acreditacions que et proposa Faro. Faro mostra les dades de cada curs i enllaça la seva fitxa oficial.',
  'creditos.fuente.acreditacion-competencias.conjunto': 'Certificats professionals i acreditació de competències',
  'creditos.fuente.acreditacion-competencias.licencia':
    "Condicions del BOE, avís legal de l’INE, ODC-BY 1.0 i Llicència oberta d'ús d'informació – Catalunya",
  'creditos.fuente.acreditacion-competencias.nombre': 'BOE, INE, SOC i Agència FP.CAT',
  'creditos.fuente.acreditacion-competencias.uso':
    'Els certificats professionals relacionats amb la teva ocupació i el servei d’acreditació de competències a Catalunya.',
  'creditos.fuente.actic.conjunto': 'Acreditació de competències digitals (ACTIC)',
  'creditos.fuente.actic.licencia':
    "Disposicions del DOGC, sense propietat intel·lectual; portal: Llicència oberta d'ús d'informació – Catalunya",
  'creditos.fuente.actic.uso':
    'L’acreditació ACTIC del bloc de competències digitals, segons les ordres EMT/47/2026 i EMT/48/2026 (DOGC 9634) i EMT/136/2026 (DOGC 9712).',
  'creditos.fuente.barcelona-activa.conjunto': 'Catàleg d’ocupacions i formacions d’IA del Cibernàrium',
  'creditos.fuente.barcelona-activa.licencia':
    'Avís legal de Barcelona Activa: Faro només enllaça, sense copiar-ne els textos',
  'creditos.fuente.barcelona-activa.uso':
    'La fitxa de la teva ocupació al seu catàleg i les seves formacions d’IA, només amb l’enllaç.',
  'creditos.fuente.cambra.licencia': 'Permís per escrit: citar l’ODEE i la Cambra al costat de la dada',
  'creditos.fuente.cambra.uso':
    'La dada de gènere del conjunt de Catalunya, amb la pàgina de l’estudi. Faro no publica la taula.',
  'creditos.fuente.citilab-cursos.conjunto': 'Cursos de citilab.eu',
  'creditos.fuente.citilab-cursos.licencia': 'Ús informatiu citant la font',
  'creditos.fuente.citilab-cursos.uso':
    'Els cursos presencials del Citilab a Cornellà: només els fets (nom, dates, preu), amb l’enllaç a la seva fitxa.',
  'creditos.fuente.clasificaciones.conjunto':
    'Classificació Nacional d’Ocupacions (CNO-11) i la seva correspondència amb la CIUO-08 (ISCO-08)',
  'creditos.fuente.clasificaciones.licencia': 'Avís legal de l’INE, citant la font',
  'creditos.fuente.clasificaciones.uso':
    'Els noms dels grups d’ocupació i el pas entre la classificació espanyola i la internacional.',
  'creditos.fuente.consorci-cursos.conjunto': 'Cursos programats',
  'creditos.fuente.consorci-cursos.licencia': LICENCIA_OBERTA_CATALUNYA,
  'creditos.fuente.consorci-cursos.uso': 'Cursos per a persones que treballen.',
  'creditos.fuente.crl.conjunto': 'Recomanacions sobre digitalització i IA per a la negociació col·lectiva (2025)',
  'creditos.fuente.crl.licencia': 'CC BY-NC-ND 3.0: Faro el resumeix i l’enllaça',
  'creditos.fuente.crl.uso': 'El resum del que recomana sobre la IA a la feina, amb l’enllaç al document.',
  'creditos.fuente.derechos-formacion.conjunto':
    'Estatut dels Treballadors, Reial decret 694/2017 i Llei orgànica 3/2018',
  'creditos.fuente.derechos-formacion.licencia': 'Textos legals, sense propietat intel·lectual; citant el BOE',
  'creditos.fuente.derechos-formacion.uso':
    'Els teus drets de formació i davant la tecnologia a la feina, citats al peu de la lletra.',
  'creditos.fuente.digcomp.conjunto': 'DigComp 3.0, marc europeu de competències digitals',
  'creditos.fuente.digcomp.licencia': 'CC BY 4.0, citant el JRC',
  'creditos.fuente.digcomp.nombre': 'Centre Comú de Recerca (JRC)',
  'creditos.fuente.digcomp.uso':
    'Els nivells de competència digital amb què es descriuen els cursos de competències digitals.',
  'creditos.fuente.esco.aviso': 'Dades d’ESCO adaptades; la Comissió Europea no és responsable d’aquesta adaptació.',
  'creditos.fuente.esco.conjunto':
    'ESCO v1.2.1: classificació europea de capacitats, competències, qualificacions i ocupacions',
  'creditos.fuente.esco.licencia': LICENCIA_UE,
  'creditos.fuente.esco.uso': 'Reconèixer la teva ocupació pels seus noms en femení, masculí i alternatius.',
  'creditos.fuente.eures-cosispe.conjunto': 'Correspondència ESCO – CO-SISPE 2011',
  'creditos.fuente.eures-cosispe.licencia': LICENCIA_UE,
  'creditos.fuente.eures-cosispe.nombre': 'EURES',
  'creditos.fuente.eures-cosispe.uso': 'Relacionar la teva ocupació d’ESCO amb les ocupacions que fa servir el SEPE.',
  'creditos.fuente.idescat-censo-anual.conjunto': 'Cens anual de població',
  'creditos.fuente.idescat-censo-anual.uso': 'Com ha canviat el nombre de persones ocupades del teu grup a Catalunya.',
  'creditos.fuente.idescat-classificacions.conjunto': 'CIUO-2008 i CCO-2011 en català',
  'creditos.fuente.idescat-classificacions.uso': 'Els noms oficials en català dels grups d’ocupació.',
  'creditos.fuente.ine-censo-2021-api.conjunto': 'Cens 2021, per edat i estudis',
  'creditos.fuente.ine-censo-2021-api.licencia': LICENCIA_INE,
  'creditos.fuente.ine-censo-2021-api.uso': 'Qui treballa al teu grup: edat i estudis, al conjunt de Catalunya.',
  'creditos.fuente.ine-censo-2021.conjunto': 'Cens de Població 2021',
  'creditos.fuente.ine-censo-2021.licencia': LICENCIA_INE,
  'creditos.fuente.ine-censo-2021.uso': 'Quantes persones treballen al teu grup d’ocupacions a Catalunya.',
  'creditos.fuente.ine-ees-2022.conjunto': 'Enquesta d’Estructura Salarial 2022',
  'creditos.fuente.ine-ees-2022.licencia': LICENCIA_INE,
  'creditos.fuente.ine-ees-2022.uso': 'El salari mitjà brut anual del gran grup de la teva ocupació a Catalunya.',
  'creditos.fuente.ine-tich-2025.conjunto': 'Enquesta sobre l’ús de tecnologies a les llars (TIC-H) 2025',
  'creditos.fuente.ine-tich-2025.licencia': LICENCIA_INE,
  'creditos.fuente.ine-tich-2025.uso':
    'Quantes persones del teu grup diuen que fan servir la IA generativa: càlcul propi amb les microdades.',
  'creditos.fuente.nombres.conjunto': 'Noms i cognoms més freqüents',
  'creditos.fuente.nombres.licencia': LICENCIA_INE,
  'creditos.fuente.nombres.uso': 'Reconèixer noms propis en el que escrius i treure’ls abans d’enviar-ho a la IA.',
  'creditos.fuente.observatori-treball.licencia': LICENCIA_OBERTA_CATALUNYA,
  'creditos.fuente.observatori-treball.uso':
    'La contractació del teu grup a Catalunya i per províncies en els darrers dotze mesos.',
  'creditos.fuente.oit.cita': 'Cita i avisos de l’OIT',
  'creditos.fuente.oit.conjunto': 'Índex d’exposició a la IA generativa per tasques (Working Paper 140, 2025)',
  'creditos.fuente.oit.licencia': 'CC BY 4.0, amb la cita i els avisos de l’OIT',
  'creditos.fuente.oit.uso':
    'Les tasques oficials de cada tipus de feina i la seva nota d’exposició, amb les notes per tasca que publica el seu autor principal. Faro les tradueix amb IA i les resumeix.',
  'creditos.fuente.sepe-especialidades.conjunto': 'Catàleg d’Especialitats Formatives',
  'creditos.fuente.sepe-especialidades.licencia': LICENCIA_SEPE,
  'creditos.fuente.sepe-especialidades.uso': 'Les especialitats formatives que el SEPE relaciona amb la teva ocupació.',
  'creditos.fuente.sepe-observatorio.conjunto':
    'Observatorio de las Ocupaciones: necessitats formatives i certificats per ocupació',
  'creditos.fuente.sepe-observatorio.licencia': LICENCIA_SEPE,
  'creditos.fuente.sepe-observatorio.uso':
    'Quina formació demana la teva ocupació i altres certificats professionals que el SEPE hi relaciona.',
  'creditos.fuente.soc-cursos.conjunto': 'Cursos i especialitats formatives',
  'creditos.fuente.soc-cursos.licencia': "ODC-BY 1.0 i Llicència oberta d'ús d'informació – Catalunya",
  'creditos.fuente.soc-cursos.uso':
    'Els cursos de formació per a l’ocupació que imparteixen les especialitats de la teva ocupació.',
  'creditos.fuente.uned-abierta.conjunto': 'Cursos oberts en línia (iedra)',
  'creditos.fuente.uned-abierta.licencia': 'Només enllaços, sense reutilitzar-ne els continguts',
  'creditos.fuente.uned-abierta.uso':
    'Cursos gratuïts en línia de competències digitals. Faro escriu les seves fitxes i enllaça el curs.',
  'creditos.imagenes.aprendizaje.tema': 'Un bolígraf sobre una llibreta',
  'creditos.imagenes.aprendizaje.uso': 'Accés a «Com funciona».',
  'creditos.imagenes.autoria': 'Fotografia de {0} · {1}',
  'creditos.imagenes.faro-penmon.tema': 'Far de Trwyn Du, Penmon (Gal·les)',
  'creditos.imagenes.faro-penmon.uso': 'Portada d’inici i de l’informe.',
  'creditos.imagenes.faro-portland.tema': 'Portland Head Light, Cape Elizabeth (Estats Units)',
  'creditos.imagenes.faro-portland.uso': 'Accés i capçalera de «Què és Faro».',
  'creditos.imagenes.intro':
    'Les fotografies són d’Unsplash i es fan servir amb la seva llicència, que no exigeix crèdit: el donem igualment. Només s’han redimensionat i convertit a WebP.',
  'creditos.imagenes.licencia': 'Llicència d’Unsplash',
  'creditos.imagenes.marca': 'El símbol de Faro, les icones i les banderes del selector d’idioma són dibuixos propis.',
  'creditos.imagenes.trabajo.tema': 'Mans escrivint en un portàtil',
  'creditos.imagenes.trabajo.uso': 'Accés i capçalera de «Què és la IA».',
  'creditos.indice.nombre': 'En aquesta pàgina',
  'creditos.licencias': 'Textos de les llicències',
  'creditos.reutilizar.1': 'Codi: tots els seus drets estan reservats.',
  'creditos.reutilizar.2':
    'Textos i càlculs propis de Faro (notes per ocupació, resums de tasques): llicència CC BY 4.0. Si els reutilitzes, cita Faro i la font original.',
  'creditos.reutilizar.3':
    'Dades de tercers: conserven la seva llicència. Si les reutilitzes, cita la font original tal com figura en aquesta pàgina.',
  'creditos.reutilizar.4':
    'Les tasques de l’OIT que mostra Faro són traduccions fetes amb IA, no traduccions oficials: porten l’avís de l’OIT.',
  'creditos.reutilizar.5': 'La taula de l’ODEE i la Cambra no es pot reutilitzar des de Faro: demana-la a l’ODEE.',
  'creditos.reutilizar.6':
    'Les guies i les lectures de la Biblioteca són dels seus autors i conserven la seva llicència: Faro les enllaça tal com es publiquen. Els resums els escriu Faro amb paraules pròpies (CC BY 4.0).',
  'creditos.rotulo': 'Transparència',
  'creditos.seccion.formacion': 'Formació',
  'creditos.seccion.imagenes': 'Imatges i fotografia',
  'creditos.seccion.reutilizar': 'Reutilitzar',
  'creditos.seccion.software': 'Programari lliure',
  'creditos.software.intro': 'El que arriba al teu navegador a més del codi propi de Faro, amb la seva llicència.',
  'creditos.tipografias.jetbrains-mono.uso': 'Xifres i codis',
  'creditos.tipografias.sora.uso': 'Marca i titulars',
  'creditos.tipografias.space-grotesk.uso': 'Text',
  'creditos.titulo': 'Crèdits · Faro',
  'creditos.titulo-principal': 'Crèdits',
  // ---------- Informe de ejemplo (informe-ejemplo.html; el informe lo escribe el motor) ----------
  'informe-ejemplo.aviso': 'Informe d’exemple de Faro amb un cas fictici i dades oficials. {0}',
  'informe-ejemplo.descripcion':
    'Exemple d’informe de Faro amb un cas fictici: què pot canviar en una feina amb la IA, tasca a tasca, i d’on surt cada dada.',
  'informe-ejemplo.no-guarda':
    'Al recorregut, aquest botó esborra l’informe i tot el que s’ha escrit a la pàgina. Aquest exemple no desa res.',
  'informe-ejemplo.titulo': 'Informe d’exemple · Faro',
  'verificable.descripcion':
    'Faro verificable: comprova al teu navegador que el motor i les dades que descarrega Faro són els de la seva llista d’empremtes.',
  'verificable.titulo': 'Faro verificable · Faro',
  'verificable.rotulo': 'Faro verificable',
  'verificable.titulo-principal': 'Comprovar que Faro és el que es va publicar',
  'verificable.entradilla':
    'Per fer servir Faro en aquest dispositiu, el teu navegador descarrega el motor de Faro i les seves dades. Aquesta pàgina els torna a demanar, calcula l’empremta SHA-256 de cada fitxer i la compara amb la llista d’empremtes d’aquesta versió, el manifest.',
  'verificable.huellas.titulo': 'Empremtes i signatura',
  'verificable.huellas.texto':
    'Que les empremtes coincideixin diu que els fitxers són els que anomena el manifest. Qui va publicar el manifest només ho diu la seva signatura, que es comprova amb les claus arrel que porta el codi de Faro. Si aquesta versió encara no les porta, la pàgina ho diu i no dona Faro per verificat.',
  'verificable.repetir': 'Tornar a comprovar',
  'verificable.estado.comprobando': 'S’està comprovant…',
  'verificable.resultado.titulo': 'Resultat',
  'verificable.firma': 'Signatura:',
  'verificable.firma.comprobada': 'comprovada amb les claus arrel d’aquesta versió de Faro',
  'verificable.firma.sin-activar': 'sense activar: aquesta versió de Faro encara no porta les claus arrel',
  'verificable.firma.sin-comprobar': 'sense comprovar: no hi ha cap manifest vàlid per comprovar',
  'verificable.firma.no-valida': 'no és vàlida (motiu tècnic: {motivo})',
  'verificable.paquete': 'Paquet de dades:',
  'verificable.paquete.desconocido': 'sense llegir: no hi ha cap manifest vàlid que ho digui',
  'verificable.cuantos': 'Fitxers:',
  'verificable.cuantos.valor': '{coinciden} de {total} coincideixen amb el manifest',
  'verificable.archivo.coincide': 'Coincideix',
  'verificable.archivo.no-coincide': 'No coincideix',
  'verificable.archivo.no-disponible': 'No s’ha pogut descarregar',
  'verificable.veredicto.verificado':
    'Verificat: la signatura del manifest és vàlida i els {total} fitxers hi coincideixen.',
  'verificable.veredicto.coinciden-sin-firma':
    'Signatura sense activar; les empremtes coincideixen amb el manifest: els {total} fitxers són els que anomena.',
  'verificable.veredicto.no-coinciden': '{fallan} de {total} fitxers no coincideixen amb el manifest.',
  'verificable.veredicto.incompleto':
    'No s’han pogut descarregar {faltan} de {total} fitxers; els altres coincideixen amb el manifest.',
  'verificable.veredicto.sin-manifiesto': 'No s’ha pogut descarregar el manifest: no hi ha amb què comparar.',
  'verificable.veredicto.manifiesto-no-valido': 'El manifest no és vàlid: no hi ha amb què comparar.',
  'verificable.veredicto.firma-no-valida': 'La signatura del manifest no és vàlida: no es compara cap fitxer.',
  'verificable.significado.verificado':
    'El que fa servir Faro en aquest dispositiu és, byte a byte, el que es va signar amb les claus de Faro.',
  'verificable.significado.coinciden-sin-firma':
    'Els fitxers que rep el teu navegador són els que anomena el manifest d’aquesta versió. Com que la signatura encara no està activada, això no demostra qui va publicar el manifest: arriba del mateix servidor que els fitxers.',
  'verificable.significado.no-coinciden':
    'Els fitxers marcats no són els que anomena el manifest. Pot ser una actualització a mitges: torna-ho a comprovar d’aquí a uns minuts. Si continua igual, el que rep aquest dispositiu no és el que es va publicar.',
  'verificable.significado.incompleto':
    'Sense connexió, o mentre no és completa la còpia per fer servir Faro sense connexió, alguns fitxers no arriben. El que ha arribat coincideix; torna-ho a comprovar amb connexió.',
  'verificable.significado.sin-manifiesto':
    'Sense el manifest no es pot comprovar res. Revisa la connexió i torna-ho a comprovar.',
  'verificable.significado.manifiesto-no-valido':
    'No és el manifest que escriu Faro en publicar una versió, així que no serveix per comparar cap fitxer.',
  'verificable.significado.firma-no-valida':
    'Una llista d’empremtes amb una signatura que no és vàlida no diu res dels fitxers. Mentre no sigui vàlida, el motor de Faro tampoc no fa servir res en aquest dispositiu.',
  'informe.compartir': 'Compartir el meu informe',
  'informe.compartir.ayuda': 'Es comparteix des del teu dispositiu, amb l’aplicació que triïs: Faro no l’envia enlloc.',
  'informe.compartir.fallo': 'No s’ha pogut compartir l’informe des d’aquest dispositiu. El pots desar en PDF.',
  'informe.escuchar': 'Escoltar el meu informe',
  'informe.escuchar.pausar': 'Fer una pausa en la lectura',
  'informe.escuchar.seguir': 'Reprendre la lectura',
  'informe.escuchar.parar': 'Aturar la lectura',
  'informe.escuchar.ayuda':
    'El llegeix una veu del teu dispositiu: el text no en surt. Si fas servir un lector de pantalla, posa’l en pausa mentrestant perquè les dues veus no es trepitgin.',
  'informe.escuchar.sin-voz':
    'Per escoltar el teu informe cal una veu en {lengua} instal·lada en aquest dispositiu. Faro no fa servir veus d’internet: així el text no en surt.',
  'informe.escuchar.fallo': 'La veu del dispositiu no ha pogut llegir l’informe.',
  'creditos.fuente.fundae.conjunto': 'Oferta de formació subvencionada per a persones treballadores',
  'creditos.fuente.fundae.cita':
    'FUNDAE (Fundación Estatal para la Formación en el Empleo): oferta de formació subvencionada per a persones treballadores.',
  'creditos.fuente.fundae.uso':
    'Dades de les convocatòries, entitats i col·lectius, amb enllaços a les seves fitxes. La sol·licitud d’inscripció no garanteix una plaça.',
  'creditos.fuente.fundae.licencia': 'Condicions d’ús de FUNDAE. No s’atribueix una llicència oberta a aquest catàleg.',
  'creditos.fuente.fundae.condiciones': 'Informació i condicions de FUNDAE',
  'informacion-y-creditos.datos.encuesta':
    'Si participes en la prova pilot de Faro, potser et donaran un enllaç d’invitació per respondre una enquesta breu en acabar el recorregut. L’enquesta és anònima: el codi de l’enllaç no porta el teu nom, no es desa amb les teves respostes i deixa de servir quan l’utilitzes. Faro només desa quantes persones han triat cada resposta.',
  'informacion-y-creditos.datos.invitacion':
    'Si arribes amb una invitació de la prova pilot, el seu codi es desa només en aquesta pestanya fins que respons l’enquesta o tanques la pestanya, i «Esborrar-ho tot» també l’esborra. L’enllaç continua al teu correu i a l’historial del navegador, i si el navegador recupera la pestanya tancada, el codi hi torna.',
};
