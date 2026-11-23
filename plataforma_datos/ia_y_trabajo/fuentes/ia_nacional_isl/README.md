# Islandia: uso de IA en empresas, medida nacional

Generado de `fuente.json`; editar el descriptor y regenerar.

Uso de la IA por las empresas de Islandia (Statistics Iceland, tabla STI03266): su propio módulo de actualización.

ID: `ia_nacional_isl` · tema: `ia_y_trabajo` · institución: Statistics Iceland (Hagstofa Íslands).
Lector estático: `plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_isl.lector`. Casa de datos: `ia-nacional-isl`.

## Alcance

- Statistics Iceland (Hagstofa Íslands) pregunta por el uso de la IA en su encuesta de uso de las tecnologías de la información en las empresas, con la lista de ocho tecnologías del cuestionario europeo de 2025. Eurostat no publica a Islandia, así que la cifra no está dos veces. No es la medida europea: la tabla da las clases de tamaño desde «1 til 9 starfsmenn» (de 1 a 9 personas empleadas; la traducción inglesa de la tabla dice «10 to 19», pero los códigos y la nota de prensa de Statistics Iceland dicen 1–9), no dice cómo se pondera el total y su muestra es pequeña (848 empresas, 62 % de respuesta, según la nota de prensa). Por eso va como medida nacional, con su definición y sin comparar. Se lee la fila «All companies» (código A12), columna «Any of the specified technologies» (código A9).
- El original es el archivo PC-Axis de la tabla, que la propia base de datos sirve por GET. Python estándar.

## Recursos y condiciones de uso

- `recurso-01` (url): Statistics Iceland, tabla STI03266: uso de la IA por las empresas por tecnología, 2025 (PC-Axis)
  Ubicación: https://px.hagstofa.is/pxen/Resources/PX/Databases/Atvinnuvegir/visinditaekni/Upplysingataekninotkunfyrirtaekja/1_gervigreind/STI03266.px. Licencia: Creative Commons Attribution 4.0 International (CC BY 4.0), https://statice.is/publications/open-data-access: se cita a Statistics Iceland (Hagstofa Íslands) como autora.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `consulta` (remoto): Archivo PC-Axis de la tabla STI03266 servido por la base oficial de Statistics Iceland. Recurso conocido sin descubrimiento general de sucesores.
  Recursos: recurso-01. Autenticación: El lector no configura credenciales de autenticación para estos recursos públicos; no acredita acceso a otros servicios.
  - Cuotas y límites oficiales de servicio no acreditados por este descriptor; rigen los límites de transporte y validación del lector.
  - Este descriptor no acredita la disponibilidad remota actual; una URL conservada no acredita consulta satisfactoria ni una tarea instalada.
  - La comprobación del recurso conocido no acredita una revisión general de ediciones o disposiciones posteriores.
  - Medida nacional con su universo, pregunta, periodo y licencia propios; el contrato la declara no comparable entre países ni con Eurostat.

## Operación actual

Política: `edición`. Consulta red: sí.
Frecuencia declarada: anual (encuesta TIC en las empresas de Statistics Iceland). Aviso de renovación: no definido días.
Originales: `ia-nacional-isl`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| ia_nacional_isl | cambiante | recurso-actual-sin-edicion | descargar | 30 |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: ninguna declarada.
Contratos y controles: lector.py:preparar, lector.py:validar, plataforma_datos/orquestacion/admision.py:exigir_admitido.

Retirada: Se conserva la admisión del conjunto y sus guardas actuales. Un fallo o una ausencia de captura no se convierte en retirada de entidades ni en disponibilidad confirmada.

Conservación: Originales, procedencias, preparados y validaciones conservan sus casas actuales en var/actualizacion. Esta ficha no habilita limpieza automática ni cambia fechas históricas, periodos, licencias o retención.

## Reproducción

```sh
python -m plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_isl.lector preparar
python -m plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_isl.lector validar
python -m plataforma_datos.contratos.fuentes --fuente ia_nacional_isl --tema ia_y_trabajo --comprobar
```
