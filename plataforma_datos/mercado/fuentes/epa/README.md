# EPA: personas ocupadas por gran grupo en Cataluña

Generado de `fuente.json`; editar el descriptor y regenerar.

Personas ocupadas en Cataluña, ambos sexos, por gran grupo de la CNO-11, en miles, de la Encuesta de Población Activa (tabla 65314); es una encuesta por muestreo, no un recuento.

ID: `epa` · tema: `mercado` · institución: Instituto Nacional de Estadística (INE).
Lector estático: `plataforma_datos.mercado.fuentes.epa.lector`. Casa de datos: `epa`.

## Alcance

- Últimos 17 trimestres de la tabla 65314 y códigos de su variable de ocupación; solo las series de Cataluña, ambos sexos, en valor absoluto.
- El último trimestre se lee de los datos; se admite si la serie sigue completa, es consecutiva y no retrocede respecto a lo validado.
- La cita dice el último trimestre leído; las medias de cuatro trimestres y su variación las calcula la exportación de mercado.

## Recursos y condiciones de uso

- `tabla-65314` (url): Ocupados por sexo, comunidad autónoma y gran grupo de ocupación, últimos 17 trimestres (JSON de la API Tempus).
  Ubicación: https://servicios.ine.es/wstempus/js/ES/DATOS_TABLA/65314?nult=17. Licencia: Creative Commons Reconocimiento 4.0 (CC BY 4.0), según el aviso legal del INE (https://www.ine.es/dyngs/AYU/index.htm?cid=125): citar la fuente («Elaboración propia con datos extraídos del sitio web del INE: www.ine.es»), mencionar la fecha de la última actualización y no sugerir que el INE participa, patrocina o apoya la reutilización.
- `ocupaciones-65314` (url): Valores y códigos de la variable «Ocupación CNO-11» de la tabla (grandes grupos).
  Ubicación: https://servicios.ine.es/wstempus/js/ES/VALORES_GRUPOSTABLA/65314/133119. Licencia: Creative Commons Reconocimiento 4.0 (CC BY 4.0), según el aviso legal del INE (https://www.ine.es/dyngs/AYU/index.htm?cid=125): citar la fuente («Elaboración propia con datos extraídos del sitio web del INE: www.ine.es»), mencionar la fecha de la última actualización y no sugerir que el INE participa, patrocina o apoya la reutilización.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `tempus` (remoto): API Tempus pública del INE; la tabla no trae el error de muestreo de cada cifra.
  Recursos: tabla-65314, ocupaciones-65314. Autenticación: No se configura autenticación de cuenta en el lector.
  - Solo JSON del mismo origen, con respuesta 200 y un tope de 16 MB por archivo; una respuesta mal formada no sustituye el original.
  - No se acredita un calendario de publicación: el trimestre nuevo se conoce al consultar la tabla.

## Operación actual

Política: `mensual`. Consulta red: sí.
Frecuencia declarada: trimestral (INE). Aviso de renovación: no definido días.
Originales: `epa`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| epa | cambiante | serie-abierta | descargar | 30 |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: ninguna declarada.
Contratos y controles: lector.py:validar.

Retirada: Se mantienen los controles de admisión del lector; un fallo de consulta, una respuesta mal formada o un trimestre que retrocede no autoriza una retirada ni una cifra cero: se conserva lo validado.

Conservación: Las rutas, originales, procedencias y revisiones actuales en var/actualizacion se conservan; este descriptor no activa limpieza automática ni fija nuevos plazos de retención.

## Reproducción

```sh
python -m plataforma_datos.mercado.fuentes.epa.lector preparar
python -m plataforma_datos.mercado.fuentes.epa.lector validar
python -m plataforma_datos.contratos.fuentes --fuente epa --tema mercado --comprobar
```
