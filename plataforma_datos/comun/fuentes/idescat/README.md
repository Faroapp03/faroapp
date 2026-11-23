# Nombres oficiales catalanes de clasificaciones ocupacionales

Generado de `fuente.json`; editar el descriptor y regenerar.

Nombres oficiales en catalán de los grupos de ocupación, del Idescat: CIUO-2008 (ca) y CCO-2011 (ca).

ID: `idescat` · tema: `comun` · institución: Institut d’Estadística de Catalunya.
Lector estático: `plataforma_datos.comun.fuentes.idescat.lector`. Casa de datos: `idescat`.

## Alcance

- La CIUO-2008 (ca) es la versión catalana oficial de la ISCO-08, y la CCO-2011 (ca), la clasificación catalana de ocupaciones del Decret 27/2012, que se corresponde con la CNO-11. Con ellas, Faro enseña en catalán el nombre oficial de cada grupo, literal: las condiciones del Idescat no permiten modificar los datos al presentarlos.
- La CNO-11 y la CCO-2011 tienen la misma estructura de 1 a 3 cifras y los mismos códigos, y a 4 cifras la correspondencia oficial del Idescat une 498 de los 502 grupos CNO-11 con un único grupo CCO-2011. Los otros 4 la CCO los parte en dos (PARTICIONES): no tienen un único nombre catalán, así que no se les da ninguno y el motor los enseña en castellano. Se descarga del Idescat (`f=ssv`, CSV con `;`), no de la copia de Socrata, parada desde 2021. Python estándar.

## Recursos y condiciones de uso

- `recurso-01` (url): Idescat, CIUO-2008 (ca): Classificació internacional uniforme d'ocupacions 2008, versión catalana
  Ubicación: https://www.idescat.cat/classificacions/?tc=1&v0=2&id=ciuo-2008-ca&f=ssv. Licencia: Aviso legal del Idescat (https://www.idescat.cat/institut/web/?lang=es) y condiciones de uso de sus API (https://www.idescat.cat/dev/api/?lang=es): reutilización permitida citando la fuente («Fuente: elaboración propia a partir de datos del Idescat») con la fecha de la última actualización, enlazando con idescat.cat, sin modificar los datos al presentarlos y sin sugerir que el Idescat apoya el uso.
- `recurso-02` (url): Idescat, CCO-2011 (ca): Classificació catalana d'ocupacions 2011 (Decret 27/2012)
  Ubicación: https://www.idescat.cat/classificacions/?tc=1&v0=2&id=cco-2011-ca&f=ssv. Licencia: Aviso legal del Idescat (https://www.idescat.cat/institut/web/?lang=es) y condiciones de uso de sus API (https://www.idescat.cat/dev/api/?lang=es): reutilización permitida citando la fuente («Fuente: elaboración propia a partir de datos del Idescat») con la fecha de la última actualización, enlazando con idescat.cat, sin modificar los datos al presentarlos y sin sugerir que el Idescat apoya el uso.
- `recurso-03` (url): Idescat, correspondencia CCO-2011 (ca) ↔ CNO-2011 (es), 4 cifras
  Ubicación: https://www.idescat.cat/classificacions/?tc=30&v0=2&id=cco-2011-ca&v4=102&v5=346&f=ssv. Licencia: Aviso legal del Idescat (https://www.idescat.cat/institut/web/?lang=es) y condiciones de uso de sus API (https://www.idescat.cat/dev/api/?lang=es): reutilización permitida citando la fuente («Fuente: elaboración propia a partir de datos del Idescat») con la fecha de la última actualización, enlazando con idescat.cat, sin modificar los datos al presentarlos y sin sugerir que el Idescat apoya el uso.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `consulta` (remoto): Descarga CSV oficiales y correspondencia de clasificaciones; las versiones y códigos se validan antes de publicar nombres oficiales.
  Recursos: recurso-01, recurso-02, recurso-03. Autenticación: No se configura autenticación de cuenta en este lector.
  - Rigen los controles y límites del lector; no se acredita una cuota remota nueva.
  - Sin consulta de red nueva en esta preparación; URL conservada no acredita disponibilidad actual.

## Operación actual

Política: `edición`. Consulta red: sí.
Frecuencia declarada: con cada revisión de la clasificación. Aviso de renovación: no definido días.
Originales: `idescat`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| idescat | referencia-versionada | edicion-conocida | descargar | 30 |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: clasificaciones.
Contratos y controles: lector.py:validar.

Retirada: No se retira contenido por fallo de consulta o ausencia de un original; se conservan las guardas de admisión existentes.

Conservación: Casas y bytes operativos en var/actualizacion conservados. Este descriptor no rejuvenece fechas, no genera traducciones, no limpia originales ni cambia la política de admisión.

## Reproducción

```sh
python -m plataforma_datos.comun.fuentes.idescat.lector preparar
python -m plataforma_datos.comun.fuentes.idescat.lector validar
python -m plataforma_datos.contratos.fuentes --fuente idescat --tema comun --comprobar
```
