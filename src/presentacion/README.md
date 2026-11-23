# Presentación del informe

`informe-breve.ts` es la presentación laboral de dos hojas del recorrido, del ejemplo público y de REST tanto con `formato=html` como con `formato=breve`. Recibe el `Informe` completo y su proyección `InformeBreve`. La formación tiene su propio documento. La salida REST HTML y el ejemplo exponen su marca de procedencia; el breve habitual sigue acompañado por el JSON completo.

Las hojas y textos breves viven en `informe-breve/`; `web/estilos/informe-breve.css` compone su presentación e impresión en A4. El recorrido real y el ejemplo preparan su HTML con `web/scripts/informe.js`. La plantilla impresa recupera el formato de dos hojas elegido para la V1: los apartados ampliados de consulta permanecen en pantalla y, en papel, la serie anual de contratos aparece como una tabla de las mismas cifras en lugar del gráfico de pantalla. Las fuentes y marcas de procedencia permanecen en el informe.

El cierre de cada hoja reúne su último bloque y el pie para evitar separarlos. Cada caso debe medirse con el motor de impresión: los saltos efectivos dependen del contenido y del navegador y el formato por sí solo no acredita que cualquier entrada quepa en dos páginas.

`html.ts` escapa el contenido dinámico; `lengua-html.ts` conserva el idioma del informe y marca los datos oficiales que se muestran sin traducir. Los títulos y fuentes se escapan antes de insertarlos. La página receptora aporta estilos y controles.

Las pruebas del informe comprueban ambos idiomas, datos, procedencia y composición. Los ensayos de PDF cotejan el contenido previsto para el papel; los apartados ampliados se consultan en pantalla. La impresión restaura el estado temporal de los desplegables al terminar o cancelar.
