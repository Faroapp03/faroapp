# Nombres y apellidos frecuentes de residentes en España

Generado de `fuente.json`; editar el descriptor y regenerar.

Nombres de pila y apellidos de las personas residentes en España (INE): la lista oficial de nombres propios.

ID: `nombres` · tema: `comun` · institución: Instituto Nacional de Estadística.
Lector estático: `plataforma_datos.comun.fuentes.nombres.lector`. Casa de datos: `nombres`.

## Alcance

- Estadística del INE «Apellidos y nombres más frecuentes», a partir del Censo de población anual a 1 de enero de 2025 (publicada el 23/04/2026): todos los nombres de pila y todos los primeros apellidos que llevan 20 personas o más, de cualquier nacionalidad, y los más frecuentes de las nacionalidades con más presencia, con los que se contrasta la lista general. El motor la usa para reconocer un nombre propio sin adivinarlo: la limpieza de datos personales quita el que sigue a una presentación aunque esté en minúsculas («soy laura pérez») y el buscador de ocupaciones no lo toma por una palabra de oficio («Soy Pastora, cajera»). Se exportan también los nombres que son a la vez la primera palabra de una ocupación ESCO (pastor, pastora…), para que ninguna de las dos piezas se coma un oficio, y lo que no es un nombre aunque se escriba con mayúscula tras «soy»: los oficios y las palabras corrientes de los textos oficiales en castellano y en catalán. Con ello la limpieza quita también un nombre que la lista no tiene («Hola, soy Nkechi»).
- Descarga, prepara y valida. Python estándar. Depende de las validaciones de ESCO, de los textos de las tareas, de la traducción al catalán, de los datos de Cataluña, del Idescat y de la formación: si cambia alguna, se vuelve a validar.

## Recursos y condiciones de uso

- `recurso-01` (url): INE · Todos los nombres con frecuencia igual o mayor a 20
  Ubicación: https://www.ine.es/daco/daco42/nombyapel/nombres_por_edad_media.xlsx. Licencia: Creative Commons Reconocimiento 4.0 (CC BY 4.0), según el aviso legal del INE (https://www.ine.es/dyngs/AYU/index.htm?cid=125): citar la fuente («Elaboración propia con datos extraídos del sitio web del INE: www.ine.es»), mencionar la fecha de la última actualización y no sugerir que el INE participa en la reutilización.
- `recurso-02` (url): INE · Los 10 nombres más frecuentes de las nacionalidades más representativas
  Ubicación: https://www.ine.es/daco/daco42/nombyapel/nombres_por_nacionalidades.xlsx. Licencia: Creative Commons Reconocimiento 4.0 (CC BY 4.0), según el aviso legal del INE (https://www.ine.es/dyngs/AYU/index.htm?cid=125): citar la fuente («Elaboración propia con datos extraídos del sitio web del INE: www.ine.es»), mencionar la fecha de la última actualización y no sugerir que el INE participa en la reutilización.
- `recurso-03` (url): INE · Apellidos con frecuencia igual o mayor a 20
  Ubicación: https://www.ine.es/daco/daco42/nombyapel/apellidos_frecuencia.xls. Licencia: Creative Commons Reconocimiento 4.0 (CC BY 4.0), según el aviso legal del INE (https://www.ine.es/dyngs/AYU/index.htm?cid=125): citar la fuente («Elaboración propia con datos extraídos del sitio web del INE: www.ine.es»), mencionar la fecha de la última actualización y no sugerir que el INE participa en la reutilización.
- `recurso-04` (url): INE · Los 20 apellidos más frecuentes de las nacionalidades más representativas
  Ubicación: https://www.ine.es/daco/daco42/nombyapel/apellidos_por_nacionalidad.xls. Licencia: Creative Commons Reconocimiento 4.0 (CC BY 4.0), según el aviso legal del INE (https://www.ine.es/dyngs/AYU/index.htm?cid=125): citar la fuente («Elaboración propia con datos extraídos del sitio web del INE: www.ine.es»), mencionar la fecha de la última actualización y no sugerir que el INE participa en la reutilización.
- `recurso-05` (url): INE · Nombres: descripción metodológica
  Ubicación: https://www.ine.es/daco/daco42/nombyapel/nota_nombres.pdf. Licencia: Creative Commons Reconocimiento 4.0 (CC BY 4.0), según el aviso legal del INE (https://www.ine.es/dyngs/AYU/index.htm?cid=125): citar la fuente («Elaboración propia con datos extraídos del sitio web del INE: www.ine.es»), mencionar la fecha de la última actualización y no sugerir que el INE participa en la reutilización.
- `recurso-06` (url): INE · Apellidos: descripción metodológica
  Ubicación: https://www.ine.es/daco/daco42/nombyapel/nota_apellidos.pdf. Licencia: Creative Commons Reconocimiento 4.0 (CC BY 4.0), según el aviso legal del INE (https://www.ine.es/dyngs/AYU/index.htm?cid=125): citar la fuente («Elaboración propia con datos extraídos del sitio web del INE: www.ine.es»), mencionar la fecha de la última actualización y no sugerir que el INE participa en la reutilización.
- `recurso-07` (url): INEbase · edición de nombres y apellidos de residentes
  Ubicación: https://www.ine.es/dyngs/INEbase/operacion.htm?c=Estadistica_C&cid=1254736177009&menu=resultados&idp=1254735572981. Licencia: Creative Commons Reconocimiento 4.0 (CC BY 4.0), según el aviso legal del INE (https://www.ine.es/dyngs/AYU/index.htm?cid=125): citar la fuente («Elaboración propia con datos extraídos del sitio web del INE: www.ine.es»), mencionar la fecha de la última actualización y no sugerir que el INE participa en la reutilización.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `consulta` (remoto): Catálogo INEbase y libros de nombres/apellidos de residentes; se verifica edición, fechas y seis enlaces, sin confundir residentes con recién nacidos.
  Recursos: recurso-01, recurso-02, recurso-03, recurso-04, recurso-05, recurso-06, recurso-07. Autenticación: No se configura autenticación de cuenta en este lector.
  - Rigen los controles y límites del lector; no se acredita una cuota remota nueva.
  - Sin consulta de red nueva en esta preparación; URL conservada no acredita disponibilidad actual.

## Operación actual

Política: `edición`. Consulta red: sí.
Frecuencia declarada: anual (padrón del INE). Aviso de renovación: no definido días.
Originales: `nombres`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| nombres | cambiante | descubre-edicion | descargar | 30 |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: esco, oit, cataluna, formacion, textos, idescat, catalan.
Contratos y controles: lector.py:validar.

Retirada: No se retira contenido por fallo de consulta o ausencia de un original; se conservan las guardas de admisión existentes.

Conservación: Casas y bytes operativos en var/actualizacion conservados. Este descriptor no rejuvenece fechas, no genera traducciones, no limpia originales ni cambia la política de admisión.

## Reproducción

```sh
python -m plataforma_datos.comun.fuentes.nombres.lector preparar
python -m plataforma_datos.comun.fuentes.nombres.lector validar
python -m plataforma_datos.contratos.fuentes --fuente nombres --tema comun --comprobar
```
