# SEPE: certificados nombrados en perfiles ocupacionales

Generado de `fuente.json`; editar el descriptor y regenerar.

Relaciones explícitas entre perfil, año, grupo CNO-11 y certificado nombrado en perfiles de oferta de empleo 2016–2025; no equivalencia individual ni oferta formativa vigente.

ID: `perfiles` · tema: `mercado` · institución: SEPE, Observatorio de las Ocupaciones.
Lector estático: `plataforma_datos.mercado.fuentes.perfiles.lector`. Casa de datos: `perfiles`.

## Alcance

- Conserva mención literal/página y código presente en catálogo de acreditación; no expande rangos.
- Elige perfil más reciente y aplica solo a ESCO con un único CNO-11 de cuatro cifras; excluye relaciones ya comprobadas o descartadas por revisión.
- Advertencia solo-SEPE separada de relaciones verificadas por Faro; años distintos no son una nueva comprobación.

## Recursos y condiciones de uso

- `apartados` (archivo): Tabla manual de apartados nombrados con perfil/año/CNO/certificado/tipo/página/línea literal y procedencia.
  Ubicación: var/actualizacion/originales/perfiles/apartados-de-certificados.tsv. Licencia: desconocida; no acreditada por este descriptor.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `manual` (local): Entrada operativa manual del Observatorio.
  Recursos: apartados. Autenticación: No aplicable al procesamiento local; no acredita acceso remoto ni una cuenta configurada.
  - La renovación es humana; no se descargan perfiles automáticamente.
  - Solo códigos nombrados explícitamente y presentes en catálogo; conservar revisión y límites del productor.

## Operación actual

Política: `manual`. Consulta red: no.
Frecuencia declarada: continua (perfiles del SEPE). Aviso de renovación: 180 días.
Originales: `perfiles`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| perfiles | manual | copia-local | revision | no automático |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: esco, clasificaciones, cataluna, formacion, agencia, acreditacion.
Contratos y controles: lector.py:validar.

Retirada: Se mantienen los controles de admisión y reconstrucción del lector; un fallo de consulta o una lectura parcial no autoriza una retirada ni una cifra cero.

Conservación: Las rutas, originales, procedencias y revisiones actuales en var/actualizacion se conservan; este descriptor no activa limpieza automática ni fija nuevos plazos de retención.

## Reproducción

```sh
python -m plataforma_datos.mercado.fuentes.perfiles.lector preparar
python -m plataforma_datos.mercado.fuentes.perfiles.lector validar
python -m plataforma_datos.contratos.fuentes --fuente perfiles --tema mercado --comprobar
```
