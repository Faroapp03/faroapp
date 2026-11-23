# Ofertas de empleo del SOC y Feina Activa

Generado de `fuente.json`; editar el descriptor y regenerar.

Puestos ofertados por el SOC y Feina Activa en Cataluña, acumulados de enero al mes vigente, por ocupación de cuatro cifras (las 50 más ofertadas), subgrupo y gran grupo de la CCO-2011, frente al mismo periodo del año anterior.

ID: `ofertas` · tema: `mercado` · institución: Observatori del Treball i Model Productiu (Generalitat de Catalunya).
Lector estático: `plataforma_datos.mercado.fuentes.ofertas.lector`. Casa de datos: `ofertas`.

## Alcance

- Libro mensual Ofertes_AAAAMM.xlsx: hojas «2 OCUPACIONS_ANY», «2 GRUPS_OCUPACIÓ» y «2 CARACTERÍSTIQUES», que tienen que cuadrar entre sí.
- El mes vigente se descubre consultando la dirección de cada mes, del en curso al último conocido incluido (así se ve una revisión de ese libro); el libro anterior es el del mismo mes del año anterior, elegido por su fecha.
- Si no se encuentra el libro del año anterior, la fuente se detiene con su motivo, retira el libro nuevo de originales/ y conserva lo publicado; las variaciones del propio libro no se usan.

## Recursos y condiciones de uso

- `libros-mensuales` (familia): Un libro por mes en {año}/arxius/Ofertes_{AAAAMM}.xlsx, enlazado desde https://observatoritreball.gencat.cat/ca/ambits_tematics/treball/ofertes_llocs_treball/.
  Ubicación: https://observatoritreball.gencat.cat/web/.content/generic/documents/treball/estadistica/ofertes/. Licencia: Avís legal de la Generalitat (https://tramits.gencat.cat/ca/ajuda/avis_legal/), régimen de la Llicència oberta d'ús d'informació – Catalunya: reutilización citando la fuente y la fecha de actualización, sin desnaturalizar la información (art. 17.1 de la Ley 19/2014 y art. 8 de la Ley 37/2007). El Excel no declara licencia específica.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `portal` (remoto): Portal público del Observatori del Treball.
  Recursos: libros-mensuales. Autenticación: No se configura autenticación de cuenta en el lector.
  - Solo libros XLSX del mismo origen, con respuesta 200 y un tope de 32 MB; un 404 o un 410 significa que ese mes aún no está publicado.
  - Una consulta por mes desde el en curso hasta el último conocido incluido, con la pausa común entre peticiones; sin calendario de publicación.

## Operación actual

Política: `mensual`. Consulta red: sí.
Frecuencia declarada: mensual (Observatori del Treball). Aviso de renovación: no definido días.
Originales: `ofertas`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| ofertas | cambiante | serie-abierta | descargar | 7 |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: ninguna declarada.
Contratos y controles: lector.py:validar.

Retirada: Se mantienen los controles de admisión del lector; un mes sin libro del año anterior, una respuesta que no es un libro o un mes que retrocede no autoriza una retirada ni una cifra cero: se conserva lo validado.

Conservación: Las rutas, originales, procedencias y revisiones actuales en var/actualizacion se conservan; este descriptor no activa limpieza automática ni fija nuevos plazos de retención.

## Reproducción

```sh
python -m plataforma_datos.mercado.fuentes.ofertas.lector preparar
python -m plataforma_datos.mercado.fuentes.ofertas.lector validar
python -m plataforma_datos.contratos.fuentes --fuente ofertas --tema mercado --comprobar
```
