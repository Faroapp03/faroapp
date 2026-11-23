// Textos de instalación, copia sin conexión y diagnóstico en catalán. Se incorporan al diccionario de ca.js.

/**
 * Diccionario de solo lectura (clave -> texto) en catalán con los textos de instalación, copia sin conexión y
 * diagnóstico.
 * @type {Readonly<Record<string, string>>}
 */
export const TEXTOS_INSTALACION = {
  // ---------- Comprovar Faro (doctor.html y scripts/doctor/) ----------
  'doctor.descripcion':
    'Comprovar Faro: comprova en uns segons si Faro funciona bé en aquest dispositiu i què cal fer si alguna cosa falla.',
  'doctor.titulo': 'Comprovació · Faro',
  'doctor.rotulo': 'Comprovar Faro',
  'doctor.titulo-principal': 'Comprovar Faro en aquest dispositiu',
  'doctor.entradilla':
    'En uns segons, Faro mira el teu navegador, la connexió, el servidor i la còpia desada per fer-lo servir sense connexió, i et diu què cal fer en cada cas.',
  'doctor.privacidad.titulo': 'El que es mira i el que no',
  'doctor.privacidad.texto':
    'Només es mira com funciona Faro. Res teu: ni el que has explicat, ni les teves tasques, ni el teu informe, ni la teva ocupació. Més avall veus l’informe sencer tal com sortirà, i no surt res d’aquest dispositiu si tu no el descarregues o l’envies.',
  'doctor.repetir': 'Tornar a comprovar',
  'doctor.estado.comprobando': 'S’està comprovant…',
  'doctor.estado.hecho': 'Comprovat: {bien} bé, {atencion} que convé revisar i {fallo} que no funcionen.',
  'doctor.resultado.titulo': 'Resultat',
  'doctor.fecha': 'Data:',
  'doctor.version': 'Versió de Faro:',
  'doctor.version.desconocida': 'desconeguda (el servidor no respon)',
  'doctor.navegador': 'Navegador:',
  'doctor.que-hacer': 'Què cal fer:',
  'doctor.semaforo.bien': 'Bé',
  'doctor.semaforo.atencion': 'Atenció',
  'doctor.semaforo.fallo': 'No funciona',
  'doctor.informe.titulo': 'El que porta l’informe',
  'doctor.informe.texto': 'Aquest és l’informe sencer. És l’únic que porta el PDF i, si l’envies, el correu.',
  'doctor.informe.cabecera': 'Comprovar Faro: informe tècnic',
  'doctor.pdf': 'Descarregar l’informe (PDF)',
  'doctor.pdf.archivo': 'Comprovar Faro · informe {fecha}',
  'doctor.pdf.ayuda': 'A la finestra que s’obre, tria «Desa com a PDF».',
  'doctor.correo': 'Enviar per correu',
  'doctor.correo.ayuda': 'S’obre el teu programa de correu amb el resum escrit; adjunta-hi el PDF abans d’enviar-lo.',
  'doctor.correo.asunto': 'Comprovar Faro: informe {fecha}',
  'doctor.correo.adjunto': 'Adjunto l’informe en PDF.',
  'doctor.navegador.nombre': 'Navegador',
  'doctor.navegador.completo.detalle': 'Té tot el que Faro necessita.',
  'doctor.navegador.completo.accion': 'No cal fer res.',
  'doctor.navegador.sin-copia.detalle': 'Li falta: {faltan}.',
  'doctor.navegador.sin-copia.accion':
    'Faro funciona, però no podrà desar una còpia per fer-lo servir sense connexió. Si pots, actualitza el navegador.',
  'doctor.navegador.viejo.detalle': 'Li falta: {faltan}.',
  'doctor.navegador.viejo.accion': 'Actualitza el navegador o obre Faro amb un altre de més recent.',
  'doctor.conexion.nombre': 'Connexió',
  'doctor.conexion.con-red.detalle': 'Hi ha connexió amb el servidor de Faro.',
  'doctor.conexion.con-red.accion': 'No cal fer res.',
  'doctor.conexion.sin-red.detalle': 'Aquest dispositiu no té connexió a internet.',
  'doctor.conexion.sin-red.accion':
    'Sense connexió pots llegir les pàgines desades. Per fer el recorregut, la descàrrega per fer-lo servir sense connexió ha d’haver acabat. Si l’accés està protegit, necessites connexió per comprovar-lo.',
  'doctor.conexion.sin-servidor.detalle': 'Hi ha xarxa, però el servidor de Faro no contesta.',
  'doctor.conexion.sin-servidor.accion':
    'Torna a comprovar-ho d’aquí a uns minuts. Si continua, desa aquest informe de comprovació.',
  'doctor.servidor.nombre': 'Servidor de Faro',
  'doctor.servidor.responde.detalle': 'Respon. Versió {version}.',
  'doctor.servidor.responde.accion': 'No cal fer res.',
  'doctor.servidor.sin-respuesta.detalle': 'No respon.',
  'doctor.servidor.sin-respuesta.accion': 'Mira primer la connexió.',
  'doctor.servidor.error.detalle': 'Ha respost amb un error ({estado}).',
  'doctor.servidor.error.accion': 'Torna a carregar la pàgina. Si continua, desa aquest informe de comprovació.',
  'doctor.copia.nombre': 'Còpia per fer-lo servir sense connexió',
  'doctor.copia.no-admite.detalle': 'Aquest navegador no desa còpies de Faro.',
  'doctor.copia.no-admite.accion': 'Faro funciona igual amb connexió.',
  'doctor.copia.sin-copia.detalle': 'Encara no hi ha cap còpia desada.',
  'doctor.copia.sin-copia.accion': 'Torna a carregar la pàgina un cop amb connexió.',
  'doctor.copia.anterior.detalle': 'La còpia desada ({instalada}) és anterior a la del servidor ({publicada}).',
  'doctor.copia.anterior.accion': 'Tanca totes les pestanyes de Faro i torna’l a obrir: s’actualitzarà.',
  'doctor.copia.al-dia.detalle': 'Desada i al dia ({instalada}).',
  'doctor.copia.al-dia.accion': 'No cal fer res.',
  'doctor.copia.sin-comparar.detalle': 'Desada ({instalada}); sense connexió no es pot comparar amb la del servidor.',
  'doctor.copia.sin-comparar.accion': 'No cal fer res.',
  'doctor.espacio.nombre': 'Espai',
  'doctor.espacio.holgado.detalle': 'Faro fa servir {usado}; en queden {libre} de lliures.',
  'doctor.espacio.holgado.accion': 'No cal fer res.',
  'doctor.espacio.justo.detalle': 'Queda poc espai: {libre}.',
  'doctor.espacio.justo.accion': 'Allibera espai al dispositiu perquè Faro pugui desar la seva còpia.',
  'doctor.espacio.sin-dato.detalle': 'El navegador no diu quant espai queda.',
  'doctor.espacio.sin-dato.accion': 'No cal fer res.',
  'doctor.idioma.nombre': 'Idioma',
  'doctor.idioma.castellano.detalle': 'Faro és en castellà; el teu navegador prefereix «{navegador}».',
  'doctor.idioma.castellano.accion': 'Pots canviar d’idioma amb el botó de la bandera, a dalt.',
  'doctor.idioma.catalan.detalle': 'Faro és en català; el teu navegador prefereix «{navegador}».',
  'doctor.idioma.catalan.accion': 'Pots canviar d’idioma amb el botó de la bandera, a dalt.',
  'doctor.verificable':
    'Per comprovar que el motor i les dades que descarrega Faro són els que es van publicar, obre {0}.',

  // ---------- Sin conexión (sin-conexion.html) ----------
  'sin-conexion.descripcion':
    'Faro sense connexió: aquesta pàgina no està disponible ara. Torna-ho a provar quan tinguis connexió.',
  'sin-conexion.rotulo': 'Sense connexió',
  'sin-conexion.texto':
    'Pots llegir les seccions desades o tornar-ho a provar amb connexió. Per fer el recorregut, la descàrrega per fer-lo servir sense connexió ha d’haver acabat.',
  'sin-conexion.titulo': 'Sense connexió · Faro',
  'sin-conexion.titulo-principal': 'Aquesta pàgina no està disponible',
  'sin-conexion.volver': 'Tornar a l’inici',

  // ---------- Página que no existe (no-existe.html) ----------
  'no-existe.descripcion':
    'Pot ser que l’adreça estigui mal escrita o que la pàgina hagi canviat de lloc. Pots tornar a l’inici i continuar des d’allà.',
  'no-existe.texto':
    'Pot ser que l’adreça estigui mal escrita o que la pàgina hagi canviat de lloc. Pots tornar a l’inici i continuar des d’allà.',
  'no-existe.titulo': 'Pàgina no trobada · Faro',
  'no-existe.titulo-principal': 'Aquesta pàgina no existeix',
  'no-existe.volver': 'Ves a l’inici',

  // ---------- Páginas de estado del service worker (herramientas/web/servicio/politica-del-servicio.ts) ----------
  'servicio.acceso-sin-conexion': 'Per comprovar el teu accés cal connexió. Torna-ho a provar quan tinguis connexió.',
  'servicio.no-comprobada':
    'No s’ha pogut comprovar si aquesta secció està disponible. Torna-ho a provar d’aquí a una estona.',
  'servicio.otra-version':
    'Aquesta pàgina és d’una altra versió de Faro. Torna a l’inici per carregar la versió actual.',
  'servicio.retirada': 'Aquesta secció està desactivada. Pots tornar a l’inici per continuar fent servir Faro.',

  // ---------- Copia sin conexión del recorrido (scripts/recorrido/preparacion.js) ----------
  'copia-sin-conexion.detenida':
    'La còpia sense connexió no s’ha pogut completar. Faro continua funcionant amb connexió.',
  'copia-sin-conexion.empezar': 'Ja pots començar. La còpia sense connexió es continua preparant.',
  'copia-sin-conexion.lista': 'La còpia sense connexió està preparada.',

  // ---------- Enlace «Instalar Faro» y aviso de versión nueva (scripts/instalacion.js) ----------
  'instalacion.actualizar': 'Actualitzar',
  'instalacion.confirmar':
    'En actualitzar, la pàgina es torna a carregar i s’esborra el que hi has fet, perquè Faro no ho desa enlloc. Vols actualitzar ara?',
  'instalacion.mas-tarde': 'Més tard',
  'instalacion.mas-tarde-nombre': 'Actualitzar més tard',
  'instalacion.otra-pestana':
    'Faro està obert en una altra pestanya amb alguna cosa a mig fer. Acaba allà o tanca aquella pestanya, i torna a prémer «Actualitzar».',
  'instalacion.titulo': 'Instal·lar Faro',
  'instalacion.version-anuncio':
    'Hi ha una versió nova de Faro. Actualitzar torna a carregar la pàgina i esborra el que hi has fet. Si vols, acaba abans o desa el teu informe en PDF, i prem «Actualitzar» quan acabis.',
  'instalacion.version-nombre': 'Versió nova de Faro',
  'instalacion.version-nueva':
    'Hi ha una versió nova de Faro. Actualitzar torna a carregar la pàgina i esborra el que hi has fet: si vols, acaba abans o desa el teu informe en PDF.',

  // ---------- Instalar Faro (instalar.html y scripts/instalar.js) ----------
  // Els passos de cada navegador segueixen la seva ajuda oficial; on no hi ha ajuda en català, es descriuen sense citar
  // el nom literal del menú de cada navegador.
  'instalar.descripcion':
    'Instal·la Faro com una aplicació a l’ordinador o al mòbil: com fer-ho a Brave, Chrome, Edge, Safari i Firefox.',
  'instalar.titulo': 'Instal·lació · Faro',
  'instalar.rotulo': 'Aplicació',
  'instalar.entradilla':
    'Fes servir Faro com una aplicació a l’ordinador o al mòbil, amb la seva pròpia icona i en la seva pròpia finestra. És el mateix web, amb les mateixes dades i la mateixa privadesa. Tria el teu navegador.',
  'instalar.navegadores': 'Instal·lar segons el navegador',
  'instalar.chromium.titulo': 'Brave, Chrome i Edge',
  'instalar.chromium.intro': 'Aquests navegadors poden instal·lar Faro com una aplicació.',
  'instalar.boton': 'Descarregar i instal·lar Faro',
  'instalar.boton.nota': 'S’obre la finestra del navegador que et pregunta si el vols instal·lar.',
  'instalar.abierta': 'Faro ja està instal·lat: l’estàs fent servir com a aplicació.',
  'instalar.instalada': 'Faro està instal·lat. Ja el pots obrir des de la seva icona, com qualsevol altra aplicació.',
  'instalar.manual':
    'Ara el navegador no obre la seva finestra d’instal·lació des d’aquesta pàgina. Instal·la’l des de la icona d’instal·lar de la barra d’adreces o des del menú del navegador:',
  'instalar.brave':
    '{0}: la icona d’instal·lar de la barra d’adreces o, al menú principal, l’opció de desar i compartir i, després, la d’instal·lar Faro.',
  'instalar.chrome':
    '{0}: el botó «Instal·la» de la barra d’adreces o, al menú Més, «Emet, desa i comparteix» › «Instal·la la pàgina com a aplicació…». A Android, Més › «Instal·la i crea una drecera» › «Instal·la».',
  'instalar.edge':
    '{0}: avisa quan es pot instal·lar; si no, al menú de configuració (els tres punts), entra a les eines i a les aplicacions i tria instal·lar aquest lloc com a aplicació.',
  'instalar.ya-instalada': 'Si ja l’has instal·lat, busca’l entre les teves aplicacions.',
  'instalar.safari-firefox.titulo': 'Safari i Firefox',
  'instalar.mac.titulo': 'Safari al Mac',
  'instalar.mac.1': 'Obre Faro al Safari. Cal macOS Sonoma 14 o posterior.',
  'instalar.mac.2':
    'A la barra d’eines, fes clic al botó «Comparteix» i tria «Afegeix al Dock». També ho trobaràs al menú de fitxers de la barra de menús.',
  'instalar.mac.3': 'Fes clic a «Afegeix». Faro queda al Dock i a les apps de l’Spotlight.',
  'instalar.iphone.titulo': 'Safari a l’iPhone o l’iPad',
  'instalar.iphone.1': 'Obre Faro al Safari.',
  'instalar.iphone.2':
    'Toca el botó «Menú de pàgina» i, després, «Comparteix». Si les pestanyes són a dalt o a baix, toca directament el botó «Comparteix».',
  'instalar.iphone.3':
    'Desplaça’t per la llista i toca «Afegeix a la pantalla d’inici». Si no hi és, al final de la llista toca «Edita les accions» i afegeix-la.',
  'instalar.iphone.4': 'Activa «Obre com a app web» i toca «Afegeix».',
  'instalar.iphone.otros':
    'A l’iPhone i l’iPad també ho pots fer des del menú per compartir de Chrome, Edge o Firefox.',
  'instalar.firefox.titulo': 'Firefox',
  'instalar.firefox.ordenador':
    'A l’ordinador, Firefox no instal·la Faro com a aplicació al Mac ni a Linux. A Windows, des de la versió 143, el pot fixar a la barra de tasques per obrir-lo en una finestra senzilla.',
  'instalar.firefox.android':
    'A Android, Firefox no l’instal·la com a aplicació: pot afegir a la pantalla d’inici una drecera que obre Faro al navegador. La trobaràs al menú del Firefox.',
  'instalar.alternativa':
    'Si el teu navegador no permet instal·lar-lo, pots fer servir Faro en una pestanya, amb tot el que ofereix, o instal·lar-lo des de Brave, Chrome o Edge.',
};
