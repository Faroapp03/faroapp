// Textos de los avisos del estado de los datos: la edición que publica una encuesta, lo que la última salida no recoge y el fallo del almacén de cursos.
/** @type {Readonly<Record<string,string>>} */
export const TEXTOS_AVISOS_DATOS = {
  'panel.datos.almacen.almacen-ausente':
    'Falta el almacén del catálogo de cursos en esta instalación. Faro no ha compuesto un catálogo nuevo. Qué hacer: avisa al equipo técnico para que restaure la copia conservada del almacén o, si no hay ninguna, cree uno nuevo.',
  'panel.datos.almacen.almacen-ilegible':
    'El almacén del catálogo de cursos no se puede leer correctamente. Faro no ha compuesto un catálogo nuevo. Qué hacer: avisa al equipo técnico para que restaure la copia conservada del almacén.',
  'panel.datos.almacen.almacen-vacio':
    'El almacén del catálogo de cursos no tiene ningún curso después de aplicar las fuentes. Faro no publica un catálogo vacío. Qué hacer: avisa al equipo técnico para que restaure la copia conservada del almacén o espere a que una fuente aporte cursos.',
  'panel.datos.aviso-instalacion': 'Aviso sobre los datos de esta instalación',
  'panel.datos.atencion-por-aviso': 'Esta fuente necesita que una persona la revise: el aviso de abajo dice qué hacer.',
  'panel.datos.edicion-nueva.publicada-sin-microdatos':
    'Edición {v0} publicada, todavía sin sus microdatos. Observado: {v1}.',
  'panel.datos.edicion-nueva.pendiente-de-incorporar':
    'Edición {v0} publicada con sus microdatos; Faro sigue mostrando la anterior. Observado: {v1}.',
  'panel.datos.aviso-edicion.edicion-no-verificable':
    'No se ha podido comprobar qué edición anuncia el INE; se sigue mostrando la que hay.',
  'panel.datos.aviso-edicion.observacion-anterior-descartada':
    'La última consulta descartó un registro anterior que no se podía leer; la fecha de la edición nueva es la de esa consulta.',
  'panel.datos.aviso-edicion.sin-contraste-con-la-tich':
    'Las cifras del Idescat son de una edición anterior a la de la encuesta del INE que usa Faro; se contrastarán cuando el Idescat publique la misma edición.',
  'panel.datos.aviso-edicion.sin-contraste-del-motivo':
    'Las cifras del Idescat sobre quienes no sabían usar la IA no se han podido contrastar con el cálculo de Faro, porque todavía no hay ese cálculo para la misma edición. Las demás cifras sí se han comprobado.',
  'panel.datos.grupos-en-su-gran-grupo.uno':
    '{v0} grupo de ocupación se muestra con la cifra de su gran grupo porque la EPA no confirma cómo se reparten.',
  'panel.datos.grupos-en-su-gran-grupo.otros':
    '{v0} grupos de ocupación se muestran con la cifra de su gran grupo porque la EPA no confirma cómo se reparten.',
  'panel.datos.salida-parcial': 'La última actualización publicada de esta fuente no lo incluye todo: {v0}.',
  'panel.datos.salida-parcial.descartadas.uno': '{v0} ficha descartada',
  'panel.datos.salida-parcial.descartadas.otros': '{v0} fichas descartadas',
  'panel.datos.salida-parcial.motivo.indice-caido':
    'El catálogo de FUNDAE no respondió: se mantiene la oferta anterior. Faro volverá a consultarlo en la próxima actualización.',
  'panel.datos.salida-parcial.motivo.fichas-fallidas':
    'Algunas fichas no respondieron: los cursos de esas fichas se mantienen como estaban hasta la próxima consulta.',
  'panel.datos.salida-parcial.motivo.tope-de-consultas':
    'La consulta se detuvo al llegar a su límite de peticiones: lo que no se consultó se mantiene como estaba y se consultará en la próxima actualización.',
  'panel.datos.salida-parcial.motivo.plazo-de-la-descarga':
    'La consulta se detuvo al agotar su tiempo: lo que no se consultó se mantiene como estaba y se consultará en la próxima actualización.',
  'panel.datos.salida-parcial.motivo.censo-ia-parcial':
    'El listado de formaciones de IA del Cibernàrium llegó incompleto: se mantiene el anterior.',
  'panel.datos.salida-parcial.motivo.censo-del-canal-sin-admitir-completo':
    'No se pudo comprobar el catálogo completo del Cibernàrium: se mantiene el listado anterior.',
  'panel.datos.salida-parcial.motivo.pagina-de-ambitos-caida':
    'La página de ámbitos del Cibernàrium no respondió: no se ha consultado su lista de formaciones de IA y se mantiene el listado anterior.',
  'panel.datos.salida-parcial.motivo.portlet-no-encontrado':
    'No se encontró en la página del Cibernàrium la dirección de su consulta: se mantiene el listado anterior. Qué hacer: avisa al equipo técnico para que revise la página de filtros del Cibernàrium.',
  'panel.datos.salida-parcial.motivo.ambito-ia-sin-nombre':
    'La página de ámbitos del Cibernàrium ya no muestra el ámbito de Inteligencia Artificial: se mantiene el listado anterior. Qué hacer: avisa al equipo técnico para que revise la página de filtros.',
  'panel.datos.salida-parcial.motivo.ambito-ia-cambiado':
    'El Cibernàrium ha cambiado el nombre de su ámbito de Inteligencia Artificial: se mantiene el listado anterior. Qué hacer: avisa al equipo técnico para que compruebe cómo se llama ahora.',
  'panel.datos.salida-parcial.motivo.portlet-cambiado':
    'El Cibernàrium cambió la dirección de su consulta: se ha usado la nueva. No hace falta hacer nada.',
  'panel.datos.salida-parcial.motivo.codigo-de-inscripcion-desconocido':
    'Una o más formaciones del Cibernàrium traen un estado de inscripción que Faro no conoce: sus plazas no constan. Qué hacer: avisa al equipo técnico para que lo revise.',
  'panel.datos.salida-parcial.motivo.texto-de-plazas-desconocido':
    'Una o más formaciones del Cibernàrium dan sus plazas con otro texto: no constan. Qué hacer: avisa al equipo técnico para que lo revise.',
  'panel.datos.edicion-nueva.detenida-por-controles':
    'Edición {v0} detenida: no ha pasado todas sus comprobaciones y se sigue publicando la anterior. Observado: {v1}.',
  'panel.datos.edicion-nueva.motivo.enunciado-distinto':
    'La pregunta de la edición nueva no está formulada igual que en la serie. Qué hacer: avisa al equipo técnico para que la revise antes de incorporarla.',
  'panel.datos.edicion-nueva.motivo.tablas':
    'No se han podido localizar o descargar sus tablas, documentos o datos. Qué hacer: avisa al equipo técnico.',
  'panel.datos.edicion-nueva.motivo.controles':
    'Sus datos no han superado una comprobación. Qué hacer: avisa al equipo técnico.',
  'panel.datos.edicion-nueva.parte.pregunta': 'Ha cambiado la pregunta.',
  'panel.datos.edicion-nueva.parte.periodo': 'Ha cambiado el periodo por el que se pregunta.',
  'panel.datos.edicion-nueva.parte.opciones':
    'Han cambiado las opciones de respuesta sobre el uso de la IA en el trabajo.',
  'panel.datos.edicion-nueva.parte.codigos': 'Han cambiado los valores de respuesta.',
  'panel.datos.aviso-edicion.edicion-no-coincide':
    'El año de la edición publicada no coincide con el de la edición que Faro tiene en uso. Qué hacer: avisa al equipo técnico para que lo revise.',
  'panel.datos.grupos-sin-clase.uno':
    '{v0} grupo de ocupación no tiene clase manual ni no manual en esta edición; su informe no dice cuántas personas no sabían usar la IA.',
  'panel.datos.grupos-sin-clase.otros':
    '{v0} grupos de ocupación no tienen clase manual ni no manual en esta edición; su informe no dice cuántas personas no sabían usar la IA.',
  'panel.datos.enlaces': 'Enlaces de los cursos: {v0}.',
  'panel.datos.enlaces.comprobados.uno': '{v0} enlace comprobado',
  'panel.datos.enlaces.comprobados.otros': '{v0} enlaces comprobados',
  'panel.datos.enlaces.ocultos.uno': '{v0} enlace oculto porque su página ya no existe',
  'panel.datos.enlaces.ocultos.otros': '{v0} enlaces ocultos porque su página ya no existe',
  'panel.datos.enlaces.sin-comprobar.uno': '{v0} enlace sin comprobar todavía',
  'panel.datos.enlaces.sin-comprobar.otros': '{v0} enlaces sin comprobar todavía',
  'panel.datos.salida-parcial.motivo.censo-digitalizate-sin-lista':
    'La lista de proveedores de Digitalízate no respondió: hoy no se dan altas ni bajas de sus cursos.',
  'panel.datos.salida-parcial.motivo.censo-digitalizate-sin-lista-de-baja':
    'La lista de proveedores dados de baja de Digitalízate no respondió: hoy no se dan altas ni bajas de sus cursos.',
  'panel.datos.salida-parcial.motivo.censo-digitalizate-fichas-fallidas':
    'Alguna de las fichas de los proveedores de Digitalízate no respondió: hoy no se dan altas ni bajas de sus cursos.',
  'panel.datos.salida-parcial.motivo.censo-digitalizate-recuento-descuadrado':
    'Las fichas de los proveedores de Digitalízate no traen los cursos que anuncia su lista: hoy no se dan altas ni bajas de sus cursos.',
  'panel.datos.salida-parcial.motivo.censo-digitalizate-forma-inesperada':
    'Las fichas de los proveedores de Digitalízate han cambiado de formato: los cursos afectados se quedan como estaban. Qué hacer: avisa al equipo técnico para que lo revise.',
  'panel.datos.salida-parcial.motivo.censo-digitalizate-tope-de-proveedores':
    'Digitalízate lista más proveedores de los que Faro consulta en un día: hoy no se dan altas ni bajas de sus cursos. Qué hacer: avisa al equipo técnico.',
  'panel.datos.salida-parcial.motivo.censo-digitalizate-contradice-al-indice':
    'Las fichas de los proveedores de Digitalízate y su buscador no coinciden en algún curso: vale lo que dicen las fichas de los proveedores activos y lo dudoso se queda como estaba.',
  'panel.datos.salida-parcial.motivo.fundae-conjunto-sin-aplicar':
    'Hay una actualización de FUNDAE preparada con un catálogo de cursos distinto del actual: no se ha aplicado y se conserva. Qué hacer: pide al equipo técnico que la revise.',
  'panel.datos.salida-parcial.motivo.dominio-con-limite':
    'Una web ha pedido que se le consulte menos: el resto de sus enlaces se deja para la próxima actualización.',
  'panel.datos.salida-parcial.motivo.indice-de-hp-life-sin-completar':
    'Faro no ha podido leer entera la lista de cursos de HP LIFE. Sigue con los cursos que ya conoce y no retira ninguno hasta poder comprobarla.',
  'panel.datos.salida-parcial.motivo.ficha-integra-fuera-del-listado':
    'Uno o más cursos ya no aparecen en el catálogo de HP LIFE, pero su página sigue funcionando. Faro los mantiene y los volverá a revisar.',
  'panel.datos.salida-parcial.motivo.ausente-del-listado-sin-confirmar':
    'Uno o más cursos ya no aparecen en el catálogo de HP LIFE y su página no se ha podido comprobar. Faro los mantiene y los volverá a revisar.',
  'panel.datos.salida-parcial.motivo.gratuidad-de-hp-life-sin-comprobar':
    'Faro no ha podido comprobar que HP LIFE siga declarando gratuitos sus cursos. Mantiene lo último comprobado y no lo renueva hasta poder comprobarlo.',
  'panel.datos.salida-parcial.motivo.curso-fuera-del-catalogo-con-su-pagina':
    'Uno o más cursos ya no aparecen en el catálogo de Cibervoluntarios, pero la página del curso sigue funcionando. Faro los mantiene y los volverá a revisar.',
  'panel.datos.salida-parcial.motivo.curso-fuera-del-catalogo-sin-confirmar':
    'Uno o más cursos ya no aparecen en el catálogo de Cibervoluntarios y su página no se ha podido comprobar. Faro los mantiene y los volverá a revisar.',
  'panel.datos.salida-parcial.motivo.estado-desconocido-en-el-catalogo':
    'El catálogo de Cibervoluntarios trae un estado que Faro no conoce: hoy no se retira ningún curso. Qué hacer: avisa al equipo técnico para que lo revise.',
  'panel.datos.salida-parcial.a-revisar.uno':
    '{v0} especialidad de FUNDAE excluida parece tratar de IA, de lo digital o de los datos. El equipo técnico puede decidir si se incluye.',
  'panel.datos.salida-parcial.a-revisar.otros':
    '{v0} especialidades de FUNDAE excluidas parecen tratar de IA, de lo digital o de los datos. El equipo técnico puede decidir si se incluyen.',
};
