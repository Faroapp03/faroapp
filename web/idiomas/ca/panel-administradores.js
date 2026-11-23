// Administradors del Tauler de Control: llista, alta, retirada, avisos i la pàgina per a qui no hi pot entrar.
export const TEXTOS_ADMINISTRADORES = {
  'panel.administradores.titulo': 'Administradors',
  'panel.administradores.explicacion':
    'Qui pot entrar al Tauler de Control. Cada administrador hi entra amb el seu correu i un segon factor; per afegir o retirar algú cal que tinguis oberta la sessió única.',
  'panel.administradores.resumen.total.uno': '{cantidad} administrador',
  'panel.administradores.resumen.total.varios': '{cantidad} administradors',
  'panel.administradores.resumen.pendientes.uno': '{cantidad} invitació pendent',
  'panel.administradores.resumen.pendientes.varios': '{cantidad} invitacions pendents',
  'panel.administradores.leyendo': 'Estem llegint la llista d’administradors; apareixerà aquí d’aquí a uns segons.',
  'panel.administradores.releer': 'Tornar a llegir la llista',
  'panel.administradores.error.lectura':
    'No s’ha pogut llegir la llista d’administradors. Torna-la a llegir amb el botó de sota d’aquí a uns minuts.',
  'panel.administradores.csv.usuario': 'Usuari',
  'panel.administradores.csv.estado': 'Estat',
  'panel.administradores.csv.anadido-por': 'Afegit per',
  'panel.administradores.csv.fecha': 'Data d’alta',
  'panel.administradores.csv.entrada': 'Darrera entrada',
  'panel.administradores.csv.segundo-factor': 'Segon factor',
  'panel.administradores.csv.si': 'Sí',
  'panel.administradores.csv.no': 'No',
  'panel.administradores.tu': 'tu',
  'panel.administradores.columna.usuario': 'Usuari',
  'panel.administradores.columna.estado': 'Estat',
  'panel.administradores.columna.anadido': 'Afegit',
  'panel.administradores.columna.entrada': 'Darrera entrada',
  'panel.administradores.columna.accion': 'Retirar',
  'panel.administradores.estado.activo': 'Actiu',
  'panel.administradores.estado.pendiente': 'Pendent',
  'panel.administradores.estado.retirada-pendiente': 'Retirada pendent a Cloudflare',
  'panel.administradores.anadido.instalacion': 'en instal·lar el servei',
  'panel.administradores.anadido.por': 'per {correo}',
  'panel.administradores.entrada.nunca': 'Encara no hi ha entrat',
  'panel.administradores.entrada.con-segundo-factor': 'amb segon factor',
  'panel.administradores.entrada.sin-segundo-factor': 'sense segon factor',
  'panel.administradores.retirar': 'Retirar',
  'panel.administradores.retirar-a': 'Retirar {correo}',
  'panel.administradores.reintentar': 'Tornar a provar',
  'panel.administradores.reintentar-a': 'Tornar a provar a Cloudflare la retirada de {correo}',
  'panel.administradores.aviso.vacia':
    'Encara no hi ha administradors a la llista, així que ara n’hi ha prou amb Cloudflare Access per entrar. Afegeix primer el teu correu i després el de les persones que han d’administrar el Tauler de Control.',
  'panel.administradores.aviso.sin-configurar':
    'La connexió amb Cloudflare Access no està completa a la configuració del servei. La llista s’aplica a Faro, però les altes i retirades no arriben a Cloudflare: demana a qui manté el servei que la completi.',
  'panel.administradores.aviso.retirada-pendiente':
    'Requereix atenció: {correo} ja no pot entrar al Tauler de Control, però Cloudflare Access encara no ha confirmat la retirada. Prem «Tornar a provar» a la seva fila.',
  'panel.administradores.pie':
    'No es pot retirar l’últim administrador actiu. Cada alta i cada retirada queden al registre del tauler.',
  'panel.administradores.alta.titulo': 'Afegir administrador',
  'panel.administradores.alta.correo': 'Correu electrònic',
  'panel.administradores.alta.ejemplo': 'nom@institucio.cat',
  'panel.administradores.alta.enviar': 'Afegir',
  'panel.administradores.alta.ayuda':
    'La persona constarà com a «Pendent» fins que hi entri per primera vegada. En entrar, Cloudflare li demanarà que confirmi el correu i que registri el segon factor.',
  'panel.administradores.hecho.anadir': 'Administrador afegit.',
  'panel.administradores.hecho.retirar': 'Administrador retirat. Ja no pot entrar al Tauler de Control.',
  'panel.administradores.hecho.reintentar': 'Retirada completada també a Cloudflare Access.',
  'panel.administradores.hecho.retirada-pendiente':
    'Ja no pot entrar al Tauler de Control, però Cloudflare Access no ha respost. Pots tornar-ho a provar des de la seva fila.',
  'panel.administradores.error.correo_no_valido': 'Aquest correu no és vàlid. Revisa’l i torna-ho a provar.',
  'panel.administradores.error.administrador_duplicado': 'Aquest correu ja és a la llista d’administradors.',
  'panel.administradores.error.lista_llena':
    'La llista ha arribat al màxim d’administradors. Retira algú abans d’afegir una altra persona.',
  'panel.administradores.error.alta_propia_primero':
    'La llista és buida: afegeix primer el teu propi correu, per no quedar-te fora del Tauler de Control.',
  'panel.administradores.error.administrador_no_encontrado':
    'Aquest administrador ja no és a la llista. S’ha actualitzat perquè vegis com està ara.',
  'panel.administradores.error.ultimo_activo':
    'No es pot retirar l’últim administrador actiu. Afegeix abans una altra persona i espera que hi entri.',
  'panel.administradores.error.cloudflare_no_disponible':
    'Cloudflare Access no ha confirmat l’alta, així que no s’ha afegit. Ho pots tornar a provar d’aquí a uns minuts.',
  'panel.administradores.error.cloudflare_sin_configurar':
    'La sincronització amb Cloudflare Access no està configurada, així que no es pot tornar a provar des d’aquí.',
  'panel.administradores.error.sesion_inactiva': 'Per canviar la llista, obre primer la sessió única.',
  'panel.administradores.error.sesion_sustituida':
    'La teva sessió única s’ha tancat perquè l’has oberta en un altre dispositiu. Torna-la a obrir aquí per continuar.',
  'panel.administradores.error.no_es_administrador':
    'El teu correu no consta com a administrador d’aquest Tauler de Control. Demana a un administrador que t’hi afegeixi.',
  'panel.administradores.error.segundo_factor_requerido':
    'Per entrar al Tauler de Control has de registrar un segon factor: una app de codis, una clau de seguretat o la biometria del teu dispositiu. Surt, torna a entrar i segueix els passos que et mostri Cloudflare.',
  'panel.administradores.error.no_disponible': 'No s’ha pogut completar ara. Torna-ho a provar d’aquí a uns minuts.',
  'panel.administradores.sin-permiso.titulo': 'No pots entrar al Tauler de Control',
};
