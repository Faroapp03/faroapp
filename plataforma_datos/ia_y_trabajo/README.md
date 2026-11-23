# IA y trabajo

Cada fuente conserva una sola implementación en `fuentes/<id>/lector.py`.
El registro estático de la cadena decide qué productor se ejecuta y en qué orden;
los descriptores documentan y contrastan su política, sus recursos y sus dependencias.
Los originales, preparados y conjuntos admitidos mantienen sus casas en
`var/actualizacion`, con sus fechas, periodos y licencias.

Los quince productores registrados son `cambra`, `tich`, `mundo_eurostat`,
`tic_llars`, `clima_empresarial`, `ue_eurostat`, `decada_digital`, `eurobarometro`,
`ceo_panel` y las seis medidas nacionales de Islandia, Reino Unido, Brasil, Suiza,
Israel y Corea del Sur (`ia_nacional_isl`, `_gbr`, `_bra`, `_che`, `_isr`, `_kor`).
Cada uno dispone de su ficha operativa y su documentación derivada.

Las medidas conservan su significado. La exposición potencial no es uso de IA ni
pérdida de empleo. Los porcentajes de empresas, establecimientos y personas tienen
bases diferentes. Las medidas nacionales que el contrato declara no comparables
mantienen ese alcance. Las respuestas del Eurobarómetro y el CEO son opinión.
Las metas de la Década Digital son un texto normativo, no resultados medidos.

`ia_nacional` y `encuestas_isco4` son productores externos al registro principal.
Sus códigos están en este tema, pero el registro principal no los incluye ni les
concede una consulta automática: su conjunto de comprobación declara `"fuente": null`
y la operación `revision`. Se ejecutan a mano, con las órdenes de «Reproducción» del
README de cada uno, y sus conjuntos validados son entradas externas de la cadena
(`ENTRADAS_EXTERNAS` en `plataforma_datos/orquestacion/modulos.py`).
La composición global consume sus conjuntos previamente admitidos. Para reconstruirlos
se necesitan sus propias entradas operativas; una copia que solo conserve los
conjuntos admitidos no acredita esa reconstrucción.

Los auxiliares nacionales compartidos están en `comun/`; los de TIC-H y encuestas,
en la casa de su fuente. La exportación TIC-H conserva por separado la procedencia
del uso y de los motivos de no uso del Idescat. Los contratos y catálogos compartidos
con otros temas no se duplican.

OIT y los textos de tareas conservan su casa en Ocupaciones. Las estadísticas de
uso de IA en empresas por sector permanecen en Mercado. El agregado global sigue
siendo una composición derivada de varios temas.

Preparar y validar una fuente con sus originales conservados son operaciones locales:

```sh
python -m plataforma_datos.ia_y_trabajo.fuentes.tich.lector preparar
python -m plataforma_datos.ia_y_trabajo.fuentes.tich.lector validar
```

Estas órdenes no acreditan una consulta remota nueva. El intervalo de comprobación
no es la frecuencia de publicación ni demuestra que exista un programador instalado.
Las condiciones particulares de uso y atribución se conservan en la ficha de cada
fuente; la licencia del código no sustituye las de los datos.


## Condiciones del consenso ocupacional

[`condiciones-metodos.json`](condiciones-metodos.json) conserva la declaración comprobada de licencia,
el recurso al que se aplica, la fecha de lectura y la huella del documento oficial. El compositor de
`metodos.json` la incorpora a su procedencia sin modificar la captura original, la fecha del cálculo
ni sus resultados. La distinción entre licencia de datos y licencia de código se mantiene al exportar.
Una declaración de un recurso no se aplica automáticamente a otro.
