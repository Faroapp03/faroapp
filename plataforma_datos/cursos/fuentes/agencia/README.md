# Oferta de acreditación FP.CAT

Generado de `fuente.json`; editar el descriptor y regenerar.

Oferta de acreditación, cualificaciones no disponibles y requisitos publicados; una coincidencia no comprobada no significa indisponibilidad.

ID: `agencia` · tema: `cursos` · institución: Agència FP.CAT.
Lector estático: `plataforma_datos.cursos.fuentes.agencia.lector`. Casa de datos: `agencia`.

## Alcance

- Procedencia con SHA; fecha oferta 12/09/2025, no disponibles febrero 2025, guía agosto 2024
- Oferta de acreditación; no calendario/plazas de cursos

## Recursos y condiciones de uso

- `oferta` (archivo): Oferta de agrupaciones de ECP del 12/09/2025.
  Ubicación: var/actualizacion/originales/agencia/agencia-oferta-ecp-2025-09-12.pdf. Licencia: Llicència oberta d'ús d'informació – Catalunya, declarada por el lector; conservar atribución.
- `no-disponibles` (archivo): Lista de no disponibles de febrero de 2025.
  Ubicación: var/actualizacion/originales/agencia/agencia-ecp-no-disponibles-2025-02.pdf. Licencia: Llicència oberta d'ús d'informació – Catalunya, declarada por el lector; conservar atribución.
- `guia` (archivo): Guía de la persona usuaria de agosto de 2024.
  Ubicación: var/actualizacion/originales/agencia/agencia-guia-persona-usuaria-2024-08.pdf. Licencia: Llicència oberta d'ús d'informació – Catalunya, declarada por el lector; conservar atribución.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `agencia` (local): No hay descarga automática en el lector.
  Recursos: oferta, no-disponibles, guia. Autenticación: No aplicable al lector; requisito de la web desconocido aquí.
  - Robots fp.gencat.cat impide descarga automatizada según declaración local; edición y recuentos fijados, no API acreditada

## Operación actual

Política: `manual`. Consulta red: no.
Frecuencia declarada: cuando la Agència publica una oferta nueva. Aviso de renovación: 180 días.
Originales: `agencia`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| agencia | manual | copia-local | revision | no automático |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: ninguna declarada.
Contratos y controles: lector.py:validar.

Retirada: Se mantienen los controles de admisión y reconstrucción del lector actual; no se declara una conciliación genérica de entidades ni se interpreta un fallo como baja.

Conservación: Se conservan las rutas, originales, procedencias y revisiones actuales en var/actualizacion; este descriptor no habilita limpieza automática ni fija nuevos plazos de retención.

## Reproducción

```sh
python -m plataforma_datos.cursos.fuentes.agencia.lector preparar
python -m plataforma_datos.cursos.fuentes.agencia.lector validar
python -m plataforma_datos.contratos.fuentes --fuente agencia --tema cursos --comprobar
```
