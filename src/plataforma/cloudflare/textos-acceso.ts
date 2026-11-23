/**
 * Textos del acceso privado en los dos idiomas, con una sola fuente. La pantalla de acceso del portal
 * (acceso-web-pagina.ts) los usa todos: su guion los aplica y su HTML inicial lleva los del catalán, salvo el aviso de
 * carga fallida, que se ve justo cuando el guion no ha arrancado y por eso el HTML lleva las dos frases. El acceso al
 * recorrido (acceso-recorrido.ts) toma de aquí los avisos de demasiados intentos, de saturación y de servicio no
 * disponible. Viven aparte de la pantalla para que el acceso al recorrido no cargue con la imagen ni el estilo de la
 * portada.
 */
/**
 * Un 429 por saturación lo marca esta cabecera: la red no ha agotado sus intentos, llegan demasiadas peticiones a la
 * vez. Sin ella, el 429 es el de la propia red. Los guiones de las dos pantallas eligen así el aviso.
 */
export const CABECERA_LIMITE = 'x-faro-limite';
export const LIMITE_SATURADO = 'saturado';
export const TEXTOS_ACCESO = {
  es: {
    pestana: 'Faro · Acceso privado',
    titulo: 'Acceso privado',
    descripcion: 'Escribe tu usuario y tu contraseña para entrar.',
    usuario: 'Usuario',
    clave: 'Contraseña',
    continuar: 'Continuar',
    volver: 'Cambiar de usuario',
    entrar: 'Entrar',
    'error-credenciales': 'El usuario o la contraseña no son correctos. Compruébalos y vuelve a intentarlo.',
    'error-intentos': 'Has hecho muchos intentos seguidos. Espera un cuarto de hora y vuelve a intentarlo.',
    'error-saturacion': 'Ahora mismo llegan demasiadas peticiones a la vez. Espera unos minutos y vuelve a intentarlo.',
    'error-servicio': 'Ahora no se puede entrar en Faro. Vuelve a intentarlo dentro de un rato.',
    progreso: 'Entrando…',
    'carga-fallida': 'El acceso no se ha podido cargar. Recarga la página para volver a intentarlo.',
    idioma: 'Cambiar el idioma al catalán',
    portada: 'Faro, volver a la portada',
  },
  ca: {
    pestana: 'Faro · Accés privat',
    titulo: 'Accés privat',
    descripcion: 'Escriu el teu usuari i la contrasenya per entrar.',
    usuario: 'Usuari',
    clave: 'Contrasenya',
    continuar: 'Continua',
    volver: 'Canvia d’usuari',
    entrar: 'Entra',
    'error-credenciales': 'L’usuari o la contrasenya no són correctes. Comprova’ls i torna-ho a provar.',
    'error-intentos': 'Has fet molts intents seguits. Espera un quart d’hora i torna-ho a provar.',
    'error-saturacion': 'Ara mateix arriben massa peticions alhora. Espera uns minuts i torna-ho a provar.',
    'error-servicio': 'Ara no es pot entrar a Faro. Torna-ho a provar d’aquí a una estona.',
    progreso: 'Entrant…',
    'carga-fallida': 'L’accés no s’ha pogut carregar. Torna a carregar la pàgina per tornar-ho a provar.',
    idioma: 'Canvia l’idioma al castellà',
    portada: 'Faro, torna a la portada',
  },
} as const;
