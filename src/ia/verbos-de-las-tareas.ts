// Verbos con que empiezan las tareas oficiales ISCO-08 (OIT) del paquete, y las primeras personas de esos
// verbos que las tareas usan también como nombre. Los usa ia/infinitivo.ts. Archivo generado, no se edita a mano:
// Se obtiene de las primeras palabras de las tareas y de sus usos como nombre.
// Procedencia: la primera palabra de «corto» y «texto_es» de datos/textos.json
// sha256 c45556e3a8316778f262aec7433daf0d704c6b9093f969a1796ec278cfa42407
// y de «corto» y «texto» de datos/catalan.json
// sha256 f943ee30786b8b156a7ec63a9111f734f8595ee3226fcf6a09a88d53b4766d21.

function lista(texto: string): Set<string> {
  return new Set(texto.trim().split(/\s+/));
}

/** Infinitivos con que empieza alguna tarea oficial en castellano. */
export const VERBOS_ES = lista(`
abastecerse ablandar abonar abordar abrillantar abrir acabar acarrear acceder accionar aceitar aceptar
acercarse acompañar aconsejar acopiar acordar actualizar actuar acudir adaptar aderezar adiestrar administrar
adobar adoptar adquirir advertir afeitar afilar afinar ahumar aislar ajustar alimentar alinear alisar aliviar
almacenar alquilar amolar ampliar analizar anotar anudar anunciar apartar apilar aplicar aportar apoyar
aprender aprobar arbitrar archivar armonizar arrastrar asear asegurar asegurarse aserrar asesorar asignar
asistir aspirar asumir atar atender auditar autorizar averiguar avisar ayudar añadir barrer bañar blanquear
bobinar bordar buscar calcar calcular calentar calibrar cambiar caminar cantar captar cargar cartografiar
catalogar cavar cazar cebar celebrar cerrar cifrar circular clasificar clavar cobrar cocinar codificar
colaborar colocar combatir combinar comentar comercializar compactar comparar compartir competir compilar
completar componer comprar comprobar comunicar comunicarse concebir concertar conducir conectar confeccionar
configurar confirmar conseguir conservar construir consultar contactar contar contener contratar controlar
convertir coordinar coordinarse copiar corregir cortar cosechar coser crear criar cuajar cubrir cuidar
cultivar cumplimentar cumplir curar curtir custodiar dar debatir decidir declarar decorar defender definir
demostrar depositar derivar derribar desarrollar desatascar desbastar desbrozar descargar descender descoser
describir desechar desembalar desempeñar desenredar deshilachar deshollinar deshuesar desmontar desollar
despertar desplazarse desplegar desvenar detallar detectar detener determinar devolver diagnosticar dibujar
dictar difundir digitalizar dirigir diseñar dispensar disponer distribuir dividir doblar documentar dominar
dragar editar educar ejecutar elaborar elegir elevar eliminar embalajar embalar embalsamar embellecer embolsar
emitir empalmar emplatar emplear encargar encarnar encoger encontrar encuadernar enganchar engrasar enhebrar
enjaezar enlucir enrollar ensamblar ensayar enseñar entregar entrenar entrevistar entrevistarse envasar enviar
envolver escanear escoltar escribir especificar establecer esterilizar estimar estimular estirar estudiar
etiquetar evaluar evitar examinar excavar exhibir expedir experimentar explicar exponer extender extraer
fabricar facilitar facturar fijar filtrar firmar fomentar forjar formalizar formar formular fotocopiar fumigar
fundir garantizar gestionar gobernar grabar guiar hablar hacer hacerse hervir hilar hincar humectar idear
identificar igualar ilustrar impartir impermeabilizar implantar imponer importar imprimir impulsar indicar
informar iniciar inocular insertar inspeccionar instalar instruir insuflar integrar intercambiar interpretar
introducir inventariar investigar jugar juzgar lavar leer levantar liderar limitar limpiar llamar llenar
llevar localizar mandar manejar maniobrar mantener mantenerse marcar matar matizar mecanizar mecanografiar
medir mejorar mezclar modelar modificar moldear montar mostrar motivar mover movilizar narrar negociar nivelar
notificar observar obtener ofrecer operar optimizar ordenar ordeñar organizar orientar pagar palear participar
partir pasar patronar patrullar pedir peinar perforar perpetuar pesar pescar pilotar pinchar pintar planificar
plantar platear plegar podar ponderar poner posar posicionar practicar predecir predicar prensar preparar
prescribir presentar presentarse presidir prestar presupuestar prevenir prever probar procesar producir
programar promocionar promover propagar proponer proporcionar proteger pulir pulverizar quitar racionar raspar
rastrear rastrillar realizar reavivar rebuscar recabar recalentar rechazar recibir reciclar reclamar recoger
recolectar recomendar reconstruir recopilar recorrer recortar rectificar recubrir recuperar redactar reducir
reensamblar regar registrar regular rellenar remachar remendar reparar repartir reponer representar
representarse reproducir rescatar reservar resolver respetar responder restaurar retirar retocar reunir
reunirse revelar revisar sacrificar salar sancionar secar seleccionar sellar sembrar separar servir simular
soldar solicitar soplar subastar subir sujetar sumergirse supervisar sustituir taladrar talar tallar talllar
tapar tapizar tejer tender teñir tocar tomar trabajar traducir tramitar transcribir transferir transformar
transmitir transportar trasladar tratar trazar trefilar trepar tricotar unir usar utilizar vaciar vacunar
valorar velar vender verificar verter vestir viajar vigilar vincular visitar
`);

/** Infinitivos con que empieza alguna tarea oficial en catalán. */
export const VERBOS_CA = lista(`
abocar abonar abordar abrillantar acabar accedir acceptar accionar acoblar acompanyar aconseguir aconsellar
acordar actualitzar actuar adaptar administrar adobar adoptar adquirir adreçar advertir afaitar afegir afinar
aixecar ajudar ajustar alimentar alinear alleujar allisar ampliar analitzar anar anivellar anotar anunciar
apartar apedaçar apilar aplegar aplicar aportar aprendre aprestar aprovar arbitrar argentar arrebossar
arrossegar arxivar aspirar assajar assecar assegurar assessorar assignar assistir assumir atendre aturar
auditar autoritzar avaluar avisar aïllar banyar barrejar blanquejar bobinar brodar bufar buidar bullir buscar
cabdellar calcar calcular calibrar caminar cantar canviar captar carregar cartografiar catalogar cavar caçar
celebrar cercar circular classificar clavar cobrar cobrir codificar collir col·laborar col·locar comandar
combatre combinar comentar comercialitzar compactar comparar compartir competir compilar completar complir
compondre comprar comprovar comptar comunicar concebre concertar conduir confeccionar configurar confirmar
connectar conrear conservar construir consultar contactar contenir contractar controlar convertir coordinar
copiar corregir cosir crear criar cuinar curar custodiar debatre decidir declarar decorar defensar definir
demanar demostrar derivar desbastar desbrossar descarregar descartar descendir descosir descriure desembalar
desembolicar desembussar desenvolupar desmuntar desnervar desossar desparar despertar desplaçar desplegar
detallar detectar detenir determinar diagnosticar dibuixar dictar difondre digitalitzar dipositar dirigir
dispensar disposar dissenyar distribuir dividir doblegar documentar dominar donar dragar dur editar educar
elaborar elevar eliminar embalar embalsamar embellir embolicar emetre emmagatzemar emmotllar empalmar emplatar
emplenar emprar emprovar encarnar encarregar encongir enderrocar enfilar enganxar engegar enquadernar
enregistrar ensenyar ensinistrar entapissar entrenar entrevistar envasar enviar esbrinar escalfar escanejar
escombrar escortar escorxar escriure escurar esfilagarsar esmolar especificar esquerar establir estendre
esterilitzar estimar estimular estirar estovar estudiar etiquetar evitar examinar excavar executar exercir
exhibir expedir experimentar explicar exposar extreure fabricar facilitar facturar fer filar filtrar fixar
fomentar fondre forjar formalitzar formar formular fotocopiar fumar fumigar garantir gestionar governar gravar
greixar guarnir guiar harmonitzar humectar idear identificar igualar il·lustrar impartir impermeabilitzar
implantar importar imposar imprimir impulsar indicar informar iniciar inocular inserir inspeccionar instal·lar
instruir insuflar integrar intercanviar interpretar introduir inventariar investigar jugar jutjar liderar
limitar llegir lligar lliurar llogar localitzar manejar maniobrar mantenir marcar matar matisar mecanitzar
mecanografiar menar mesurar millorar mobilitzar modelar modificar mostrar motivar moure muntar munyir narrar
negociar netejar notificar nuar obrir observar obtenir oferir olejar omplir operar optimitzar ordenar
organitzar orientar pagar parar parlar participar partir passar patronar patrullar pentinar perforar perpetuar
pesar pescar pilotar pintar planificar plantar plegar podar polir polvoritzar ponderar portar posar posicionar
practicar predicar predir premsar prendre preparar prescriure presentar presidir pressupostar prestar prevenir
preveure processar produir programar promocionar promoure propagar proporcionar proposar protegir provar
proveir pujar punxar quallar racionar raspar rastellar rastrejar reavivar reblar rebre rebutjar reciclar
reclamar recobrir recollir recol·lectar recomanar reconstruir recopilar rectificar recuperar recórrer redactar
reduir regar registrar regular remenar rentar reparar repartir reposar representar reproduir rescatar reservar
resoldre respectar respondre restaurar retallar retirar retocar retornar reunir revelar revisar sacrificar
salar sancionar segellar seleccionar sembrar separar serrar servir signar simular soldar sol·licitar subhastar
subjectar submergir substituir supervisar talar tallar tancar tapar teixir telefonar tenir tenyir tocar tornar
tractar traduir traginar tramitar transcriure transferir transformar transmetre transportar traslladar traçar
treballar trefilar trepar treure triar tricotar trobar unir utilitzar vacunar valorar vendre verificar vestir
vetllar viatjar vigilar vincular visitar visualitzar xifrar
`);

/** Primeras personas que las tareas oficiales usan también como nombre, sin acentos («registro», «cambio»). */
export const NOMBRES = lista(`
apoyo aseo cambio canto contacto contrato cultivo desarrollo desempeño diagnostico dibujo diseño empleo
encargo ensayo envio estudio hilo inicio intercambio inventario manejo marco ordeño pago parto paso peso
presupuesto proceso punxo rechazo registro salo sujeto trabajo traslado uno uso vacio
`);
