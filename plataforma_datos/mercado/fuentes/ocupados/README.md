# Ocupados por ocupación: censos INE e Idescat

Generado de `fuente.json`; editar el descriptor y regenerar.

Población ocupada censal por ocupación y sexo a uno de enero, con Cataluña, comarcas y municipios publicados; no es la EPA.

ID: `ocupados` · tema: `mercado` · institución: INE; Idescat.
Lector estático: `plataforma_datos.mercado.fuentes.ocupados.lector`. Casa de datos: `ocupados`.

## Alcance

- CNO-11 a tres cifras en Cataluña y dos en territorios; año 2021 decenal y desde 2022 anual con otro método.
- Solo variaciones entre años comparables desde 2022; publicación desde cien personas y redondeo oficial.
- Metadatos determinan años y particiones; contrastes INE, Cambra y Censo 2021 preservados.

## Recursos y condiciones de uso

- `idescat-censos` (familia): Metadatos y datos de los nodos 17980/21518 y 17977/21517, por territorios y años disponibles.
  Ubicación: https://api.idescat.cat/taules/v2/censph. Licencia: Aviso legal del Idescat (https://www.idescat.cat/institut/web/?lang=es) y condiciones de uso de sus API (https://www.idescat.cat/dev/api/?lang=es): reutilización permitida citando la fuente («Fuente: elaboración propia a partir de datos del Idescat») con la fecha de la última actualización, enlazando con idescat.cat, sin modificar los datos al presentarlos y sin sugerir que el Idescat apoya el uso.
- `nomenclator` (url): Pertenencia municipal a comarcas.
  Ubicación: https://api.idescat.cat/emex/v1/nodes.json?lang=es&tipus=com,mun. Licencia: Aviso legal del Idescat (https://www.idescat.cat/institut/web/?lang=es) y condiciones de uso de sus API (https://www.idescat.cat/dev/api/?lang=es): reutilización permitida citando la fuente («Fuente: elaboración propia a partir de datos del Idescat») con la fecha de la última actualización, enlazando con idescat.cat, sin modificar los datos al presentarlos y sin sugerir que el Idescat apoya el uso.
- `ine-control` (familia): Tablas 69959 y 69979 de control por Cataluña y ciudades publicadas.
  Ubicación: https://servicios.ine.es/wstempus/js/ES/DATOS_TABLA. Licencia: Creative Commons Reconocimiento 4.0 (CC BY 4.0), según el aviso legal del INE (https://www.ine.es/dyngs/AYU/index.htm?cid=125): citar la fuente («Elaboración propia con datos extraídos del sitio web del INE: www.ine.es»), mencionar la fecha de la última actualización y no sugerir que el INE participa, patrocina o apoya la reutilización.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `api` (remoto): JSON-stat de Idescat y Tempus del INE; se conservan los periodos reales.
  Recursos: idescat-censos, nomenclator, ine-control. Autenticación: No se configura autenticación de cuenta en el lector.
  - Idescat limita a veinte mil celdas por petición: el lector parte por años según metadatos.
  - Exige cobertura exacta de partes, periodos/categorías y controles; no amplía municipios por inferencia.

## Operación actual

Política: `mensual`. Consulta red: sí.
Frecuencia declarada: anual (Idescat e INE). Aviso de renovación: no definido días.
Originales: `ocupados`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| ocupados | cambiante | serie-abierta | descargar | 30 |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: clasificaciones, cambra, cataluna.
Contratos y controles: lector.py:validar.

Retirada: Se mantienen los controles de admisión y reconstrucción del lector; un fallo de consulta o una lectura parcial no autoriza una retirada ni una cifra cero.

Conservación: Las rutas, originales, procedencias y revisiones actuales en var/actualizacion se conservan; este descriptor no activa limpieza automática ni fija nuevos plazos de retención.

## Reproducción

```sh
python -m plataforma_datos.mercado.fuentes.ocupados.lector preparar
python -m plataforma_datos.mercado.fuentes.ocupados.lector validar
python -m plataforma_datos.contratos.fuentes --fuente ocupados --tema mercado --comprobar
```
