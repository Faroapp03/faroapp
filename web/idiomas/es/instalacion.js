// Textos de instalación, copia sin conexión y diagnóstico en castellano. Se incorporan al diccionario de es.js.

/**
 * Diccionario de solo lectura (clave -> texto) en castellano con los textos de instalación, copia sin conexión y
 * diagnóstico.
 * @type {Readonly<Record<string, string>>}
 */
export const TEXTOS_INSTALACION = {
  // ---------- Comprobar Faro (doctor.html y scripts/doctor/) ----------
  'doctor.descripcion':
    'Comprobar Faro: comprueba en unos segundos si Faro funciona bien en este dispositivo y qué hacer si algo falla.',
  'doctor.titulo': 'Comprobación · Faro',
  'doctor.rotulo': 'Comprobar Faro',
  'doctor.titulo-principal': 'Comprobar Faro en este dispositivo',
  'doctor.entradilla':
    'En unos segundos, Faro mira tu navegador, la conexión, el servidor y la copia guardada para usarlo sin conexión, y te dice qué hacer en cada caso.',
  'doctor.privacidad.titulo': 'Lo que se mira y lo que no',
  'doctor.privacidad.texto':
    'Solo se mira cómo funciona Faro. Nada tuyo: ni lo que has contado, ni tus tareas, ni tu informe, ni tu ocupación. Más abajo ves el informe entero tal como saldrá, y nada sale de este dispositivo si tú no lo descargas o lo envías.',
  'doctor.repetir': 'Volver a comprobar',
  'doctor.estado.comprobando': 'Comprobando…',
  'doctor.estado.hecho': 'Comprobado: {bien} bien, {atencion} que conviene revisar y {fallo} que no funcionan.',
  'doctor.resultado.titulo': 'Resultado',
  'doctor.fecha': 'Fecha:',
  'doctor.version': 'Versión de Faro:',
  'doctor.version.desconocida': 'desconocida (el servidor no responde)',
  'doctor.navegador': 'Navegador:',
  'doctor.que-hacer': 'Qué hacer:',
  'doctor.semaforo.bien': 'Bien',
  'doctor.semaforo.atencion': 'Atención',
  'doctor.semaforo.fallo': 'No funciona',
  'doctor.informe.titulo': 'Lo que lleva el informe',
  'doctor.informe.texto': 'Este es el informe entero. Es lo único que lleva el PDF y, si lo envías, el correo.',
  'doctor.informe.cabecera': 'Comprobar Faro: informe técnico',
  'doctor.pdf': 'Descargar informe (PDF)',
  'doctor.pdf.archivo': 'Comprobar Faro · informe {fecha}',
  'doctor.pdf.ayuda': 'En la ventana que se abre, elige «Guardar como PDF».',
  'doctor.correo': 'Enviar por correo',
  'doctor.correo.ayuda': 'Se abre tu programa de correo con el resumen escrito; adjunta el PDF antes de enviarlo.',
  'doctor.correo.asunto': 'Comprobar Faro: informe {fecha}',
  'doctor.correo.adjunto': 'Adjunto el informe en PDF.',
  'doctor.navegador.nombre': 'Navegador',
  'doctor.navegador.completo.detalle': 'Tiene todo lo que Faro necesita.',
  'doctor.navegador.completo.accion': 'No hace falta hacer nada.',
  'doctor.navegador.sin-copia.detalle': 'Le falta: {faltan}.',
  'doctor.navegador.sin-copia.accion':
    'Faro funciona, pero no podrá guardar una copia para usarlo sin conexión. Si puedes, actualiza el navegador.',
  'doctor.navegador.viejo.detalle': 'Le falta: {faltan}.',
  'doctor.navegador.viejo.accion': 'Actualiza el navegador o abre Faro con otro más reciente.',
  'doctor.conexion.nombre': 'Conexión',
  'doctor.conexion.con-red.detalle': 'Hay conexión con el servidor de Faro.',
  'doctor.conexion.con-red.accion': 'No hace falta hacer nada.',
  'doctor.conexion.sin-red.detalle': 'Este dispositivo no tiene conexión a internet.',
  'doctor.conexion.sin-red.accion':
    'Sin conexión puedes leer las páginas guardadas. Para hacer el recorrido, su descarga para uso sin conexión debe haber terminado. Si el acceso está protegido, necesitas conexión para comprobarlo.',
  'doctor.conexion.sin-servidor.detalle': 'Hay red, pero el servidor de Faro no contesta.',
  'doctor.conexion.sin-servidor.accion':
    'Vuelve a comprobarlo en unos minutos. Si continúa, guarda este informe de comprobación.',
  'doctor.servidor.nombre': 'Servidor de Faro',
  'doctor.servidor.responde.detalle': 'Responde. Versión {version}.',
  'doctor.servidor.responde.accion': 'No hace falta hacer nada.',
  'doctor.servidor.sin-respuesta.detalle': 'No responde.',
  'doctor.servidor.sin-respuesta.accion': 'Mira primero la conexión.',
  'doctor.servidor.error.detalle': 'Ha respondido con un error ({estado}).',
  'doctor.servidor.error.accion': 'Recarga la página. Si continúa, guarda este informe de comprobación.',
  'doctor.copia.nombre': 'Copia para usar sin conexión',
  'doctor.copia.no-admite.detalle': 'Este navegador no guarda copias de Faro.',
  'doctor.copia.no-admite.accion': 'Faro funciona igual con conexión.',
  'doctor.copia.sin-copia.detalle': 'Todavía no hay copia guardada.',
  'doctor.copia.sin-copia.accion': 'Recarga la página una vez con conexión.',
  'doctor.copia.anterior.detalle': 'La copia guardada ({instalada}) es anterior a la del servidor ({publicada}).',
  'doctor.copia.anterior.accion': 'Cierra todas las pestañas de Faro y vuelve a abrirlo: se pondrá al día.',
  'doctor.copia.al-dia.detalle': 'Guardada y al día ({instalada}).',
  'doctor.copia.al-dia.accion': 'No hace falta hacer nada.',
  'doctor.copia.sin-comparar.detalle': 'Guardada ({instalada}); sin conexión no se puede comparar con la del servidor.',
  'doctor.copia.sin-comparar.accion': 'No hace falta hacer nada.',
  'doctor.espacio.nombre': 'Espacio',
  'doctor.espacio.holgado.detalle': 'Faro usa {usado}; quedan {libre} libres.',
  'doctor.espacio.holgado.accion': 'No hace falta hacer nada.',
  'doctor.espacio.justo.detalle': 'Queda poco espacio: {libre}.',
  'doctor.espacio.justo.accion': 'Libera espacio en el dispositivo para que Faro pueda guardar su copia.',
  'doctor.espacio.sin-dato.detalle': 'El navegador no dice cuánto espacio queda.',
  'doctor.espacio.sin-dato.accion': 'No hace falta hacer nada.',
  'doctor.idioma.nombre': 'Idioma',
  'doctor.idioma.castellano.detalle': 'Faro está en castellano; tu navegador prefiere «{navegador}».',
  'doctor.idioma.castellano.accion': 'Puedes cambiar de idioma con el botón de la bandera, arriba.',
  'doctor.idioma.catalan.detalle': 'Faro está en catalán; tu navegador prefiere «{navegador}».',
  'doctor.idioma.catalan.accion': 'Puedes cambiar de idioma con el botón de la bandera, arriba.',
  'doctor.verificable':
    'Para comprobar que el motor y los datos que descarga Faro son los que se publicaron, abre {0}.',

  // ---------- Sin conexión (sin-conexion.html) ----------
  'sin-conexion.descripcion':
    'Faro sin conexión: esta página no está disponible ahora. Vuelve a intentarlo cuando tengas conexión.',
  'sin-conexion.rotulo': 'Sin conexión',
  'sin-conexion.texto':
    'Puedes leer las secciones guardadas o volver a intentarlo con conexión. Para hacer el recorrido, su descarga para uso sin conexión debe haber terminado.',
  'sin-conexion.titulo': 'Sin conexión · Faro',
  'sin-conexion.titulo-principal': 'Esta página no está disponible',
  'sin-conexion.volver': 'Volver al inicio',

  // ---------- Página que no existe (no-existe.html) ----------
  'no-existe.descripcion':
    'Puede que la dirección esté mal escrita o que la página haya cambiado de sitio. Puedes volver al inicio y seguir desde allí.',
  'no-existe.texto':
    'Puede que la dirección esté mal escrita o que la página haya cambiado de sitio. Puedes volver al inicio y seguir desde allí.',
  'no-existe.titulo': 'Página no encontrada · Faro',
  'no-existe.titulo-principal': 'Esta página no existe',
  'no-existe.volver': 'Ir al inicio',

  // ---------- Páginas de estado del service worker (herramientas/web/servicio/politica-del-servicio.ts) ----------
  'servicio.acceso-sin-conexion':
    'Para comprobar tu acceso hace falta conexión. Vuelve a intentarlo cuando tengas conexión.',
  'servicio.no-comprobada':
    'No se ha podido comprobar si esta sección está disponible. Vuelve a intentarlo dentro de un rato.',
  'servicio.otra-version': 'Esta página es de otra versión de Faro. Vuelve al inicio para cargar la versión actual.',
  'servicio.retirada': 'Esta sección está desactivada. Puedes volver al inicio para seguir usando Faro.',

  // ---------- Copia sin conexión del recorrido (scripts/recorrido/preparacion.js) ----------
  'copia-sin-conexion.detenida':
    'La copia sin conexión no se ha podido completar. Faro sigue funcionando con conexión.',
  'copia-sin-conexion.empezar': 'Ya puedes empezar. La copia sin conexión sigue preparándose.',
  'copia-sin-conexion.lista': 'La copia sin conexión está lista.',

  // ---------- Enlace «Instalar Faro» y aviso de versión nueva (scripts/instalacion.js) ----------
  'instalacion.actualizar': 'Actualizar',
  'instalacion.confirmar':
    'Al actualizar, la página se vuelve a cargar y se borra lo que llevas hecho en ella, porque Faro no lo guarda en ninguna parte. ¿Actualizar ahora?',
  'instalacion.mas-tarde': 'Más tarde',
  'instalacion.mas-tarde-nombre': 'Actualizar más tarde',
  'instalacion.otra-pestana':
    'Faro está abierto en otra pestaña con algo a medias. Termina allí o cierra esa pestaña, y vuelve a pulsar «Actualizar».',
  'instalacion.titulo': 'Instalar Faro',
  'instalacion.version-anuncio':
    'Hay una nueva versión de Faro. Actualizar vuelve a cargar la página y borra lo que llevas hecho en ella. Si quieres, termina antes o guarda tu informe en PDF, y pulsa «Actualizar» cuando acabes.',
  'instalacion.version-nombre': 'Versión nueva de Faro',
  'instalacion.version-nueva':
    'Hay una nueva versión de Faro. Actualizar vuelve a cargar la página y borra lo que llevas hecho en ella: si quieres, termina antes o guarda tu informe en PDF.',

  // ---------- Instalar Faro (instalar.html y scripts/instalar.js) ----------
  // Los pasos conservan los nombres literales de los menús de cada navegador.
  'instalar.descripcion':
    'Instala Faro como una aplicación en tu ordenador o tu móvil: cómo hacerlo en Brave, Chrome, Edge, Safari y Firefox.',
  'instalar.titulo': 'Instalación · Faro',
  'instalar.rotulo': 'Aplicación',
  'instalar.entradilla':
    'Usa Faro como una aplicación en tu ordenador o tu móvil, con su propio icono y en su propia ventana. Es la misma web, con los mismos datos y la misma privacidad. Elige tu navegador.',
  'instalar.navegadores': 'Instalar según el navegador',
  'instalar.chromium.titulo': 'Brave, Chrome y Edge',
  'instalar.chromium.intro': 'Estos navegadores pueden instalar Faro como una aplicación.',
  'instalar.boton': 'Descargar e instalar Faro',
  'instalar.boton.nota': 'Se abre la ventana del navegador que te pregunta si quieres instalarlo.',
  'instalar.abierta': 'Faro ya está instalado: lo estás usando como aplicación.',
  'instalar.instalada': 'Faro está instalado. Ya puedes abrirlo desde su icono, como cualquier otra aplicación.',
  'instalar.manual':
    'Ahora el navegador no abre su ventana de instalación desde esta página. Instálalo desde el icono de instalar de la barra de direcciones o desde el menú del navegador:',
  'instalar.brave':
    '{0}: el icono «Instalar» de la barra de direcciones o, en el menú principal, «Guardar y compartir» › «Instalar Faro…».',
  'instalar.chrome':
    '{0}: el botón «Instalar» de la barra de direcciones o, en el menú Más, «Enviar, guardar y compartir» › «Instalar página como aplicación…». En Android, Más › «Instalar y crear acceso directo» › «Instalar».',
  'instalar.edge':
    '{0}: avisa cuando se puede instalar; si no, en «Configuración y más» (…), «Más herramientas» › «Aplicaciones» › «Instala este sitio como una aplicación».',
  'instalar.ya-instalada': 'Si ya lo instalaste, búscalo entre tus aplicaciones.',
  'instalar.safari-firefox.titulo': 'Safari y Firefox',
  'instalar.mac.titulo': 'Safari en Mac',
  'instalar.mac.1': 'Abre Faro en Safari. Hace falta macOS Sonoma 14 o posterior.',
  'instalar.mac.2':
    'En la barra de menús, elige Archivo › «Añadir al Dock». También puedes pulsar el botón Compartir de la barra de herramientas y elegir «Añadir al Dock».',
  'instalar.mac.3': 'Haz clic en «Añadir». Faro queda en el Dock y en las aplicaciones de Spotlight.',
  'instalar.iphone.titulo': 'Safari en iPhone o iPad',
  'instalar.iphone.1': 'Abre Faro en Safari.',
  'instalar.iphone.2':
    'Toca el botón «Menú de página» y después «Compartir». Si tus pestañas están arriba o abajo, toca directamente el botón «Compartir».',
  'instalar.iphone.3':
    'Desplázate por la lista y toca «Añadir a pantalla de inicio». Si no está, al final de la lista toca «Editar acciones» y añádela.',
  'instalar.iphone.4': 'Activa «Abrir como app web» y toca «Añadir».',
  'instalar.iphone.otros': 'En iPhone y iPad también puedes hacerlo desde el menú Compartir de Chrome, Edge o Firefox.',
  'instalar.firefox.titulo': 'Firefox',
  'instalar.firefox.ordenador':
    'En el ordenador, Firefox no instala Faro como aplicación en Mac ni en Linux. En Windows, desde la versión 143, puede fijarlo en la barra de tareas para abrirlo en una ventana sencilla.',
  'instalar.firefox.android':
    'En Android, Firefox no lo instala como aplicación: puede añadir a la pantalla de inicio un acceso directo que abre Faro en el navegador. Búscalo en el menú de Firefox.',
  'instalar.alternativa':
    'Si tu navegador no permite instalarlo, puedes usar Faro en una pestaña, con todo lo que ofrece, o instalarlo desde Brave, Chrome o Edge.',
};
