# Relaciones históricas SEPE 2016

Generado de `fuente.json`; editar el descriptor y regenerar.

Relaciones ocupación-certificado-unidad publicadas en anexos del informe de 2016; no son oferta formativa abierta.

ID: `certificados2016` · tema: `cursos` · institución: SEPE · Observatorio de las Ocupaciones.
Lector estático: `plataforma_datos.cursos.fuentes.certificados2016.lector`. Casa de datos: `certificados2016`.

## Alcance

- Archivo, SHA y método de extracción en procedencia; página/fila/ámbito por relación
- Relación histórica ocupación-certificado, no oferta abierta

## Recursos y condiciones de uso

- `informe` (familia): PDF histórico y celdas JSONL registradas de anexos III/IV; la preparación no ejecuta el extractor histórico.
  Ubicación: var/actualizacion/originales/certificados2016/. Licencia: desconocida; no acreditada por este descriptor.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `certificados2016` (local): No hay descarga automática en el lector.
  Recursos: informe. Autenticación: No aplicable al lector local.
  - Edición cerrada 2016; extractor histórico PDFKit fuera del flujo; solo certificados/unidades vigentes y precedencia/rechazos revisados

## Operación actual

Política: `manual`. Consulta red: no.
Frecuencia declarada: cerrada (informe de 2016). Aviso de renovación: no definido días.
Originales: `certificados2016`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| certificados2016 | historica | copia-local | integridad | no automático |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: esco, clasificaciones, cataluna, formacion, agencia, acreditacion, perfiles.
Contratos y controles: lector.py:validar.

Retirada: Se mantienen los controles de admisión y reconstrucción del lector actual; no se declara una conciliación genérica de entidades ni se interpreta un fallo como baja.

Conservación: Se conservan las rutas, originales, procedencias y revisiones actuales en var/actualizacion; este descriptor no habilita limpieza automática ni fija nuevos plazos de retención.

## Reproducción

```sh
python -m plataforma_datos.cursos.fuentes.certificados2016.lector preparar
python -m plataforma_datos.cursos.fuentes.certificados2016.lector validar
python -m plataforma_datos.contratos.fuentes --fuente certificados2016 --tema cursos --comprobar
```
