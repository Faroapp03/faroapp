# Salarios por ocupación: Encuesta de Estructura Salarial 2022

Generado de `fuente.json`; editar el descriptor y regenerar.

EES cuatrienal 2022: medias anuales brutas por gran grupo en Cataluña y media/percentiles por subgrupo en España; no es la EAES anual ni una predicción salarial individual.

ID: `salarios` · tema: `mercado` · institución: INE.
Lector estático: `plataforma_datos.mercado.fuentes.salarios.lector`. Casa de datos: `salarios`.

## Alcance

- Cataluña: tablas 36862, 36865 y 36866; ambos sexos y desgloses por estudios, edad y antigüedad.
- España: tabla 36830, media y percentiles 10,25,50,75,90 por subgrupo; ámbito separado.
- Marcas de gran variabilidad y valores ausentes no pasan como cifras firmes; una edición incompatible exige revisión.

## Recursos y condiciones de uso

- `catalogo` (familia): Catálogo oficial del bloque cuatrienal EES, distinguido de la encuesta anual.
  Ubicación: https://www.ine.es/dyngs/INEbase/es/operacion.htm?c=Estadistica_C&cid=1254736177025&menu=resultados&idp=1254735976596. Licencia: Creative Commons Reconocimiento 4.0 (CC BY 4.0), según el aviso legal del INE (https://www.ine.es/dyngs/AYU/index.htm?cid=125): citar la fuente («Elaboración propia con datos extraídos del sitio web del INE: www.ine.es»), mencionar la fecha de la última actualización y no sugerir que el INE participa, patrocina o apoya la reutilización.
- `tablas` (familia): Cuatro tablas EES 2022 con sus metadatos, filtros y notas estadísticas.
  Ubicación: https://servicios.ine.es/wstempus/js/ES/DATOS_TABLA. Licencia: Creative Commons Reconocimiento 4.0 (CC BY 4.0), según el aviso legal del INE (https://www.ine.es/dyngs/AYU/index.htm?cid=125): citar la fuente («Elaboración propia con datos extraídos del sitio web del INE: www.ine.es»), mencionar la fecha de la última actualización y no sugerir que el INE participa, patrocina o apoya la reutilización.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `ine` (remoto): Catálogo HTML y tablas Tempus públicas; no se declara cuota o SLA desde el lector.
  Recursos: catalogo, tablas. Autenticación: No se configura autenticación de cuenta en el lector.
  - Consulta el bloque cuatrienal antes de descargar; edición, publicación o formato incompatible detiene el proceso.
  - Los originales históricos se pueden preparar/validar sin red; no convierte la encuesta anual en EES.

## Operación actual

Política: `edición`. Consulta red: sí.
Frecuencia declarada: cuatrienal (EES del INE). Aviso de renovación: no definido días.
Originales: `salarios`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| salarios | cambiante | descubre-edicion | descargar | 30 |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: clasificaciones.
Contratos y controles: lector.py:validar.

Retirada: Se mantienen los controles de admisión y reconstrucción del lector; un fallo de consulta o una lectura parcial no autoriza una retirada ni una cifra cero.

Conservación: Las rutas, originales, procedencias y revisiones actuales en var/actualizacion se conservan; este descriptor no activa limpieza automática ni fija nuevos plazos de retención.

## Reproducción

```sh
python -m plataforma_datos.mercado.fuentes.salarios.lector preparar
python -m plataforma_datos.mercado.fuentes.salarios.lector validar
python -m plataforma_datos.contratos.fuentes --fuente salarios --tema mercado --comprobar
```
