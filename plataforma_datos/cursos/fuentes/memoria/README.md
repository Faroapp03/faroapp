# Memòria del Sistema FPCAT 2025

Generado de `fuente.json`; editar el descriptor y regenerar.

Tres cifras de escala del procedimiento ordinario de acreditación en Cataluña, periodo 2022–2025; no son un plazo individual ni oferta disponible.

ID: `memoria` · tema: `cursos` · institución: Agència FP.CAT.
Lector estático: `plataforma_datos.cursos.fuentes.memoria.lector`. Casa de datos: `memoria-fpcat`.

## Alcance

- URL, cita, SHA y captura; periodo 2022–2025
- Contexto de escala/espera de acreditación, no disponibilidad de una solicitud/curso

## Recursos y condiciones de uso

- `memoria` (url): PDF conservado manualmente; lectura de tres rótulos y cifras de la página 9.
  Ubicación: https://fp.gencat.cat/content/dam/agenciafpcat/01_sistemafpcat/memories-sistema-fpcat/Memoria-AFPCAT-2025.pdf. Licencia: Llicència oberta d'ús d'informació – Catalunya, declarada por el lector; conservar atribución.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `memoria` (local): No hay descarga automática en el lector.
  Recursos: memoria. Autenticación: No aplicable al lector local.
  - FP.CAT robots impide lectura automática según evidencia declarada; página 9 y tres rótulos/valores exactos; no API acreditada

## Operación actual

Política: `manual`. Consulta red: no.
Frecuencia declarada: anual (memoria de la Agència FP.CAT). Aviso de renovación: 365 días.
Originales: `memoria-fpcat`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| memoria | manual | copia-local | revision | no automático |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: ninguna declarada.
Contratos y controles: lector.py:validar.

Retirada: Se mantienen los controles de admisión y reconstrucción del lector actual; no se declara una conciliación genérica de entidades ni se interpreta un fallo como baja.

Conservación: Se conservan las rutas, originales, procedencias y revisiones actuales en var/actualizacion; este descriptor no habilita limpieza automática ni fija nuevos plazos de retención.

## Reproducción

```sh
python -m plataforma_datos.cursos.fuentes.memoria.lector preparar
python -m plataforma_datos.cursos.fuentes.memoria.lector validar
python -m plataforma_datos.contratos.fuentes --fuente memoria --tema cursos --comprobar
```
