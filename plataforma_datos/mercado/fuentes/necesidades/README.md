# SEPE: necesidades formativas por ocupación

Generado de `fuente.json`; editar el descriptor y regenerar.

Competencias señaladas como necesidades formativas en fichas ocupacionales del SEPE; conserva porcentajes literales cuyo denominador no define la fuente, sin atribuir carencias a una persona.

ID: `necesidades` · tema: `mercado` · institución: SEPE, Observatorio de las Ocupaciones.
Lector estático: `plataforma_datos.mercado.fuentes.necesidades.lector`. Casa de datos: `sepe-necesidades`.

## Alcance

- CNO-11 a cuatro cifras y año propio de cada ficha; solo ocupaciones con al menos dos respuestas sobre necesidades técnicas.
- Tipos técnicos, digitales, personales, idiomas y otras transversales; marca IA solo donde la ficha la nombra.
- Fichas anteriores a 2025 con todo cero no se usan como medida; capturas truncadas conocidas permanecen identificadas.

## Recursos y condiciones de uso

- `fichas` (familia): Capturas HTML manuales con procedencia y huella; no API ni descarga directa en este lector.
  Ubicación: var/actualizacion/originales/sepe-necesidades/. Licencia: desconocida; no acreditada por este descriptor.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `manual` (local): Entrada manual, sin consulta remota automática.
  Recursos: fichas. Autenticación: No aplicable al procesamiento local; no acredita acceso remoto ni una cuenta configurada.
  - La renovación es humana; descargar solo explica el procedimiento y verifica huellas.
  - Conservar año y NOTA_PORCENTAJE/LIMITES; no expresar porcentajes como porcentaje de empresas o personas.

## Operación actual

Política: `manual`. Consulta red: no.
Frecuencia declarada: anual (informe del SEPE). Aviso de renovación: 365 días.
Originales: `sepe-necesidades`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| necesidades | manual | copia-local | revision | no automático |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: clasificaciones.
Contratos y controles: lector.py:validar.

Retirada: Se mantienen los controles de admisión y reconstrucción del lector; un fallo de consulta o una lectura parcial no autoriza una retirada ni una cifra cero.

Conservación: Las rutas, originales, procedencias y revisiones actuales en var/actualizacion se conservan; este descriptor no activa limpieza automática ni fija nuevos plazos de retención.

## Reproducción

```sh
python -m plataforma_datos.mercado.fuentes.necesidades.lector preparar
python -m plataforma_datos.mercado.fuentes.necesidades.lector validar
python -m plataforma_datos.contratos.fuentes --fuente necesidades --tema mercado --comprobar
```
