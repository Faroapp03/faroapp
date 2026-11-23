# Certificados y relaciones de acreditación

Generado de `fuente.json`; editar el descriptor y regenerar.

Catálogo de certificados y relaciones revisadas con ocupaciones, con norma, cita y procedencia; la propuesta de una regla no sustituye una admisión.

ID: `acreditacion` · tema: `cursos` · institución: BOE; INE; SOC; Agència FP.CAT.
Lector estático: `plataforma_datos.cursos.fuentes.acreditacion.lector`. Casa de datos: `acreditacion`.

## Alcance

- URL/SHA/fecha captura/robots; citas, revisión admitidas/descartadas y huella de regla; advertencia manual a los 60 días
- Solo si casa con seguridad oferta Agència; no coincidencia => sin comprobar, no indisponible

## Recursos y condiciones de uso

- `boe` (familia): Reales decretos y normas explícitos de piezas/constantes.py y descarga.py; texto consolidado o PDF de anexo.
  Ubicación: desconocida. Licencia: desconocida; no acreditada por este descriptor.
- `correspondencia-ine` (familia): Correspondencia CNO-94/CNO-11 declarada en el lector; relaciona grupos, no equivalencia de ocupaciones individuales.
  Ubicación: desconocida. Licencia: desconocida; no acreditada por este descriptor.
- `soc` (archivo): Original SOC conservado por Formación; no otra ingesta independiente.
  Ubicación: var/actualizacion/originales/formacion/soc-especialidades.json. Licencia: ODC-BY, según declaración del lector de acreditación.
- `revision` (familia): Admitidas, descartadas y páginas registradas manualmente; no se fabrican al generar este descriptor.
  Ubicación: var/actualizacion/revisiones/acreditacion/. Licencia: desconocida; no acreditada por este descriptor.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `corpus-remoto` (remoto): Corpus acotado de normativa y correspondencia, con robots y pausas comunes; no una API de cursos
  Recursos: boe, correspondencia-ine. Autenticación: Sin autenticación configurada en lector.
  - Índice histórico RD 189/2013 + lista posterior explícita + RD de original SOC; no descubre sucesoras, páginas manuales no se consultan por red
- `entradas-locales` (local): Original SOC ya conservado y revisiones manuales; no concede otras descargas.
  Recursos: soc, revision. Autenticación: No aplicable al procesamiento de originales y revisiones locales.
  - Original SOC ya registrado; las relaciones requieren citas y listas de admitidas/descartadas con la huella de su regla. Este canal local no descubre publicaciones ni descarga páginas manuales.

## Operación actual

Política: `mensual`. Consulta red: sí.
Frecuencia declarada: cuando el BOE consolida un real decreto. Aviso de renovación: no definido días.
Originales: `acreditacion`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| acreditacion | cambiante | contenido-actual-acotado | descargar | 7 |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: esco, clasificaciones, cataluna, formacion, agencia.
Contratos y controles: lector.py:validar.

Retirada: Se mantienen los controles de admisión y reconstrucción del lector actual; no se declara una conciliación genérica de entidades ni se interpreta un fallo como baja.

Conservación: Se conservan las rutas, originales, procedencias y revisiones actuales en var/actualizacion; este descriptor no habilita limpieza automática ni fija nuevos plazos de retención.

## Reproducción

```sh
python -m plataforma_datos.cursos.fuentes.acreditacion.lector preparar
python -m plataforma_datos.cursos.fuentes.acreditacion.lector validar
python -m plataforma_datos.contratos.fuentes --fuente acreditacion --tema cursos --comprobar
```
