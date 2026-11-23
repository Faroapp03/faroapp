# EAES: ganancia media anual por grupo de ocupación

Generado de `fuente.json`; editar el descriptor y regenerar.

Ganancia media anual por trabajador en España por grupo de ocupación A a Q y sexo, de la Encuesta Anual de Estructura Salarial (tabla 28186), con los subgrupos principales de la CNO-11 de cada grupo.

ID: `eaes` · tema: `mercado` · institución: Instituto Nacional de Estadística (INE).
Lector estático: `plataforma_datos.mercado.fuentes.eaes.lector`. Casa de datos: `eaes`.

## Alcance

- Últimos tres años de la tabla 28186, valores de su variable de ocupación y subgrupos de dos cifras de cada grupo según la jerarquía de la variable 456.
- El último año se lee de los datos; se admite si sus datos son definitivos, los años son consecutivos y no retrocede respecto a lo validado.
- Se conservan el signo «-» (gran variabilidad) y el nulo (menos de 100 observaciones) del INE; la cita dice el último año leído.

## Recursos y condiciones de uso

- `tabla-28186` (url): Ganancia media anual por trabajador por grupo de ocupación y sexo, España, últimos tres años (JSON de la API Tempus).
  Ubicación: https://servicios.ine.es/wstempus/js/ES/DATOS_TABLA/28186?nult=3. Licencia: Creative Commons Reconocimiento 4.0 (CC BY 4.0), según el aviso legal del INE (https://www.ine.es/dyngs/AYU/index.htm?cid=125): citar la fuente («Elaboración propia con datos extraídos del sitio web del INE: www.ine.es»), mencionar la fecha de la última actualización y no sugerir que el INE participa, patrocina o apoya la reutilización.
- `grupos-28186` (url): Valores y códigos de la variable de ocupación de la tabla (grupos A a Q y todas las ocupaciones).
  Ubicación: https://servicios.ine.es/wstempus/js/ES/VALORES_GRUPOSTABLA/28186/88012. Licencia: Creative Commons Reconocimiento 4.0 (CC BY 4.0), según el aviso legal del INE (https://www.ine.es/dyngs/AYU/index.htm?cid=125): citar la fuente («Elaboración propia con datos extraídos del sitio web del INE: www.ine.es»), mencionar la fecha de la última actualización y no sugerir que el INE participa, patrocina o apoya la reutilización.
- `subgrupos-456` (familia): Hijos de cada grupo en la variable OCUPACIONES (456), por el identificador que da la tabla de grupos.
  Ubicación: https://servicios.ine.es/wstempus/js/ES/VALORES_HIJOS/456. Licencia: Creative Commons Reconocimiento 4.0 (CC BY 4.0), según el aviso legal del INE (https://www.ine.es/dyngs/AYU/index.htm?cid=125): citar la fuente («Elaboración propia con datos extraídos del sitio web del INE: www.ine.es»), mencionar la fecha de la última actualización y no sugerir que el INE participa, patrocina o apoya la reutilización.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `tempus` (remoto): API Tempus pública del INE. El tipo de dato 1 es «Definitivo»: la misma tabla pedida con tip=A trae T3_TipoDato «Definitivo» en esos datos.
  Recursos: tabla-28186, grupos-28186, subgrupos-456. Autenticación: No se configura autenticación de cuenta en el lector.
  - Solo JSON del mismo origen, con respuesta 200 y un tope de 4 MB por archivo; una respuesta mal formada no sustituye el original.
  - No se acredita un calendario de publicación: el año nuevo se conoce al consultar la tabla.

## Operación actual

Política: `mensual`. Consulta red: sí.
Frecuencia declarada: anual (INE). Aviso de renovación: no definido días.
Originales: `eaes`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| eaes | cambiante | serie-abierta | descargar | 30 |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: ninguna declarada.
Contratos y controles: lector.py:validar.

Retirada: Se mantienen los controles de admisión del lector; un fallo de consulta, una respuesta mal formada o un año que retrocede no autoriza una retirada ni una cifra cero: se conserva lo validado.

Conservación: Las rutas, originales, procedencias y revisiones actuales en var/actualizacion se conservan; este descriptor no activa limpieza automática ni fija nuevos plazos de retención.

## Reproducción

```sh
python -m plataforma_datos.mercado.fuentes.eaes.lector preparar
python -m plataforma_datos.mercado.fuentes.eaes.lector validar
python -m plataforma_datos.contratos.fuentes --fuente eaes --tema mercado --comprobar
```
