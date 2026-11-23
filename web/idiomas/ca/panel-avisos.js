// La targeta «Avisos» del tauler i l’estat de cada canal a la comprovació del vigilant.
export const TEXTOS_AVISOS = {
  'panel.avisos.titulo': 'Avisos',
  'panel.avisos.intro':
    'Si l’actualització de les dades s’atura o necessita atenció, Faro t’avisa per correu. Aquí tries a quina adreça arriben els avisos.',
  'panel.avisos.campo': 'Adreça de correu',
  'panel.avisos.guardar': 'Desa',
  'panel.avisos.probar': 'Envia un avís de prova',
  'panel.avisos.quitar': 'Treure',
  'panel.avisos.reintentar': 'Torna a consultar',
  'panel.avisos.en-curso.leer': 'S’està consultant on arriben els avisos…',
  'panel.avisos.en-curso.cambiar': 'S’està desant l’adreça…',
  'panel.avisos.en-curso.quitar': 'S’està traient l’adreça…',
  'panel.avisos.en-curso.probar': 'S’està enviant l’avís de prova…',
  'panel.avisos.resumen.sin_destino':
    'Encara no hi ha cap adreça: ningú no rebrà cap avís si l’actualització s’atura. Escriu una adreça i desa-la.',
  'panel.avisos.resumen.pendiente':
    'Els avisos aniran a {correo} quan la confirmis. Pendent de confirmar: envia un avís de prova.',
  'panel.avisos.resumen.verificado': 'Els avisos arriben a {correo}.',
  'panel.avisos.resumen.no-leido':
    'No s’ha pogut consultar on arriben els avisos. Comprova la connexió i prem «Torna a consultar».',
  'panel.avisos.resumen.no-disponible':
    'Aquesta instal·lació de Faro no envia avisos per correu, així que aquí no es pot desar cap adreça.',
  'panel.avisos.resultado.guardado': 'Has desat l’adreça. Per confirmar-la, envia un avís de prova.',
  'panel.avisos.resultado.quitado': 'Has tret l’adreça. Ja no arribarà cap avís per correu.',
  'panel.avisos.resultado.conflicto': 'Algú ha canviat l’adreça mentrestant: revisa la nova abans de tornar a desar.',
  'panel.avisos.resultado.correo-invalido':
    'Aquesta adreça no és vàlida. Escriu-la amb la forma nom@domini, sense espais, i torna a desar-la.',
  'panel.avisos.resultado.vacio': 'Escriu una adreça de correu abans de desar.',
  'panel.avisos.resultado.prueba-enviada':
    'Hem enviat l’avís de prova i l’adreça ha quedat confirmada: a partir d’ara els avisos hi arribaran. Si no el trobes, mira a la carpeta de correu brossa.',
  'panel.avisos.resultado.prueba-fallida': 'L’avís de prova no s’ha pogut lliurar. {motivo}',
  'panel.avisos.resultado.prueba-no-enviada': 'No s’ha enviat l’avís de prova. {motivo}',
  'panel.avisos.resultado.fallo':
    'No s’ha pogut completar l’acció. Comprova la connexió i torna-ho a provar d’aquí a un moment.',
  'panel.avisos.resultado.desconocido':
    'No sabem si el canvi s’ha completat. Prem «Torna a consultar» per veure l’adreça actual abans de tornar-ho a provar.',
  'panel.avisos.confirmar.guardar':
    'Els avisos arribaran a {correo}. Per confirmar l’adreça, després hauràs d’enviar un avís de prova.',
  'panel.avisos.confirmar.quitar':
    'Trauràs l’adreça {correo}. Ningú no rebrà cap avís per correu si l’actualització s’atura. Vols treure-la?',
  'panel.avisos.canal.no-configurado':
    'Aquesta instal·lació de Faro encara no pot enviar avisos per correu. Pots desar l’adreça: els avisos sortiran quan qui manté el servei activi l’enviament.',
  'panel.avisos.canal.remitente-no-admitido':
    'Els avisos per correu no poden sortir perquè l’adreça des de la qual els envia Faro no és del domini del servei. Demana a qui manté el servei que la corregeixi.',
  'panel.avisos.ultimo.enviado': 'L’últim avís es va enviar {fecha}.',
  'panel.avisos.ultimo.fallido': 'L’últim avís no s’ha pogut lliurar {fecha}. {motivo}',
  'panel.avisos.comprobaciones-desactivadas':
    'Ara mateix no sortirà cap avís, perquè les comprovacions automàtiques de l’actualització estan desactivades. Pots desar l’adreça igualment: els avisos arribaran quan es tornin a activar.',
  'panel.avisos.motivo.remitente-no-configurado':
    'El servei de correu de Faro encara no està preparat per enviar avisos. Demana a qui manté el servei que l’acabi de configurar.',
  'panel.avisos.motivo.destinatario-no-permitido':
    'El servei de correu encara no admet aquesta adreça. Demana a qui manté el servei que la doni d’alta i torna a provar.',
  'panel.avisos.motivo.limite-alcanzado':
    'S’han enviat massa correus en poc temps. Espera una estona i torna a provar.',
  'panel.avisos.motivo.rechazo-del-destino':
    'La bústia d’aquesta adreça no ha acceptat l’avís. Comprova que l’adreça està ben escrita i que la bústia no està plena.',
  'panel.avisos.motivo.error-temporal':
    'El servei de correu ha tingut un problema passatger. Torna a provar d’aquí a uns minuts.',
  'panel.avisos.motivo.plazo-agotado':
    'El servei de correu ha trigat massa a respondre. Torna a provar d’aquí a uns minuts.',
  'panel.avisos.motivo.envio-rechazado':
    'El servei de correu no ha acceptat l’avís. Torna a provar més tard; si es repeteix, demana a qui manté el servei que ho revisi.',
  'panel.avisos.motivo.destino-no-admitido':
    'Aquesta adreça no es pot fer servir per enviar avisos. Escriu-ne una altra amb la forma nom@domini i desa-la.',
  'panel.avisos.motivo.sin-destino': 'Encara no hi ha cap adreça. Desa’n una abans d’enviar l’avís de prova.',
  'panel.avisos.motivo.destino-sin-verificar':
    'L’adreça encara no està confirmada. Envia un avís de prova per confirmar-la.',
  'panel.avisos.motivo.canal-no-configurado':
    'Aquesta instal·lació de Faro encara no pot enviar correus. Demana a qui manté el servei que activi l’enviament d’avisos.',
  'panel.avisos.motivo.limite-de-pruebas':
    'S’ha enviat un avís de prova fa molt poc. Espera deu minuts i torna a provar.',
  'panel.vigilante.avisos.ninguno':
    'Els avisos no estan configurats: ningú no rebrà cap avís si l’actualització s’atura. Per activar-los, desa una adreça de correu a «Avisos».',
  'panel.vigilante.avisos.correo.no-configurado': 'Aquesta instal·lació de Faro ja no pot enviar avisos per correu.',
  'panel.vigilante.avisos.correo.remitente-no-admitido':
    'Els avisos per correu no poden sortir: l’adreça des de la qual els envia Faro no és del domini del servei. Demana a qui manté el servei que la corregeixi.',
  'panel.vigilante.avisos.correo.sin-destino':
    'Encara no hi ha cap adreça per als avisos per correu. Desa-la a «Avisos».',
  'panel.vigilante.avisos.correo.pendiente':
    'L’adreça dels avisos per correu està pendent de confirmar: envia un avís de prova des d’«Avisos».',
  'panel.vigilante.avisos.correo.verificado': 'Els avisos arriben per correu a l’adreça confirmada a «Avisos».',
  'panel.vigilante.avisos.correo.intento.enviado': 'L’últim avís per correu es va enviar {fecha}.',
  'panel.vigilante.avisos.correo.intento.fallido':
    'L’últim avís per correu no s’ha pogut lliurar {fecha}. {motivo} Es tornarà a provar a la propera comprovació diària.',
  'panel.vigilante.avisos.url.no-configurados': 'Els avisos a l’adreça web del servei ja no estan configurats.',
  'panel.vigilante.avisos.url.configurados': 'Els avisos també arriben a l’adreça web configurada al servei.',
  'panel.vigilante.avisos.url.destino-no-admitido':
    'L’adreça web dels avisos no és vàlida: ha de començar per https i no pot incloure usuari ni contrasenya. Demana a qui manté el servei que la corregeixi.',
  'panel.vigilante.avisos.url.intento.enviado': 'L’últim avís a l’adreça web es va enviar {fecha}.',
  'panel.vigilante.avisos.url.intento.fallido.respuesta-no-admitida':
    'L’últim avís a l’adreça web no s’ha pogut lliurar {fecha}: el servei que rep els avisos no l’ha acceptat. Es tornarà a provar a la propera comprovació diària.',
  'panel.vigilante.avisos.url.intento.fallido.sin-respuesta':
    'L’últim avís a l’adreça web no s’ha pogut lliurar {fecha}: el servei que rep els avisos no ha respost. Es tornarà a provar a la propera comprovació diària.',
  'panel.vigilante.avisos.url.intento.fallido.plazo-agotado':
    'L’últim avís a l’adreça web no s’ha pogut lliurar {fecha}: el servei que rep els avisos ha trigat massa. Es tornarà a provar a la propera comprovació diària.',
  'panel.vigilante.avisos.url.intento.fallido.destino-no-admitido':
    'L’últim avís a l’adreça web no es va enviar {fecha} perquè l’adreça no és vàlida. Demana a qui manté el servei que la corregeixi.',
};
