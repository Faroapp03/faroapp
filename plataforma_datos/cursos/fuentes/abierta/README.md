# Formación abierta editorial

Generado de `fuente.json`; editar el descriptor y regenerar.

Fichas multifuente redactadas por Equipo Faro según criterio v1.1; no es una institución externa ni una API propia.

ID: `abierta` · tema: `cursos` · institución: no declarada.
Lector estático: `plataforma_datos.cursos.fuentes.abierta.lector`. Casa de datos: `abierta`.

## Alcance

- Requisitos con evidencia/notas, plataforma/condiciones/fecha de comprobación y SHA del documento
- No comprueba plazas ni inscripciones

## Recursos y condiciones de uso

- `fichas` (archivo): Hechos y evidencias de los requisitos R1–R10; condiciones particulares por plataforma.
  Ubicación: var/actualizacion/preparados/abierta/fichas.json. Licencia: desconocida; no acreditada por este descriptor.
- `criterio` (archivo): Criterio editorial aplicado por el lector; no concede permisos sobre las plataformas externas.
  Ubicación: docs/criterio-formacion-abierta.md. Licencia: desconocida; no acreditada por este descriptor.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `abierta` (editorial): No hay descarga automática en el lector.
  Recursos: fichas, criterio. Autenticación: No configurada; depende de plataforma, desconocido sin comprobación individual.
  - Criterio v1.1 R1–R10, solo hechos/enlaces, revisión mensual: a los 90 días solo aviso (desde 30 antes), sin retirar fichas; una ficha sale al llegar su fin publicado, curso ya iniciado al comprobarlo, sin límite de antigüedad; FARO_HOY para reproducir

## Operación actual

Política: `redactada`. Consulta red: no.
Frecuencia declarada: revisión de Equipo Faro. Aviso de renovación: no definido días.
Sin carpeta de originales declarada.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| abierta | editorial | copia-local | revision | no automático |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: ninguna declarada.
Contratos y controles: lector.py:validar.

Retirada: Se mantienen los controles de admisión y reconstrucción del lector actual; no se declara una conciliación genérica de entidades ni se interpreta un fallo como baja.

Conservación: Se conservan las rutas, originales, procedencias y revisiones actuales en var/actualizacion; este descriptor no habilita limpieza automática ni fija nuevos plazos de retención.

## Reproducción

```sh
python -m plataforma_datos.cursos.fuentes.abierta.lector preparar
python -m plataforma_datos.cursos.fuentes.abierta.lector validar
python -m plataforma_datos.contratos.fuentes --fuente abierta --tema cursos --comprobar
```
