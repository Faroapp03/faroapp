# Panel Ciutadà 2025, tercera oleada, pregunta 26

Generado de `fuente.json`; editar el descriptor y regenerar.

Opinión, no medida: el Panel Ciutadà del CEO (Enquesta longitudinal, 3a onada, 2025; REO 1151), pregunta 26.

ID: `ceo_panel` · tema: `ia_y_trabajo` · institución: Centre d’Estudis d’Opinió (CEO).
Lector estático: `plataforma_datos.ia_y_trabajo.fuentes.ceo_panel.lector`. Casa de datos: `ceo-panel`.

## Alcance

- El Centre d'Estudis d'Opinió de la Generalitat pregunta a una muestra probabilística de la población de 16 años o más residente en Cataluña (6.706 personas, del 9/10 al 9/12/2025) por la probabilidad, de 0 («Gens probable») a 10 («Totalment probable»), de que las personas sean superadas o sustituidas por máquinas, programas informáticos o la inteligencia artificial en la mayoría de los trabajos. La pregunta solo se hizo en el cuestionario en línea: su base son quienes respondieron en línea, ponderados con `PONDERA_ENLINIA` (5.840). Se lee de los microdatos anonimizados (CSV, Dades obertes de la Generalitat), no de las tablas en PDF: la cifra es la parte ponderada de 7 a 10 sobre esa base, con las omisiones dentro, como la da la tabla de frecuencias del CEO. Las frecuencias ponderadas de 7 a 10, la base, la media y las etiquetas de la escala se comparan con las publicadas en esas tablas (pregunta 26). Es opinión de Cataluña, sin otro territorio con la misma pregunta: va en el bloque `encuestas` de los datos globales con `naturaleza: "opinion"`, cobertura «cataluna» y sin comparar. Python estándar.

## Recursos y condiciones de uso

- `recurso-01` (url): CEO, Enquesta longitudinal. 3a onada. 2025 (REO 1151), microdades anonimitzades (CSV)
  Ubicación: https://documents.dadesobertes.gencat.cat/ceo/docs/REO1151_microdades_anonimitzades.csv. Licencia: Llicència oberta d'ús d'informació – Catalunya (Dades obertes de la Generalitat): reutilización permitida citando al Centre d'Estudis d'Opinió como fuente y enlazando con la licencia.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `consulta` (remoto): Descarga soportada del CSV anonimizado de REO 1151. El plan operativo actual comprueba integridad histórica; no se declara descubrimiento de nuevas oleadas ni consulta periódica de la ficha Socrata.
  Recursos: recurso-01. Autenticación: El lector no configura credenciales de autenticación para estos recursos públicos; no acredita acceso a otros servicios.
  - Cuotas y límites oficiales de servicio no acreditados por este descriptor; rigen los límites de transporte y validación del lector.
  - Este descriptor no acredita la disponibilidad remota actual; una URL conservada no acredita consulta satisfactoria ni una tarea instalada.
  - La comprobación del recurso conocido no acredita una revisión general de ediciones o disposiciones posteriores.
  - Opinión con su pregunta y base, no adopción ni exposición medida; se conserva el año y el trabajo de campo publicados.

## Operación actual

Política: `fija`. Consulta red: sí.
Frecuencia declarada: cerrada (3a onada, 2025; cada ola es otro estudio del REO). Aviso de renovación: no definido días.
Originales: `ceo-panel`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| ceo_panel | historica | edicion-conocida | integridad | no automático |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: ninguna declarada.
Contratos y controles: lector.py:preparar, lector.py:validar, plataforma_datos/orquestacion/admision.py:exigir_admitido.

Retirada: Se conserva la admisión del conjunto y sus guardas actuales. Un fallo o una ausencia de captura no se convierte en retirada de entidades ni en disponibilidad confirmada.

Conservación: Originales, procedencias, preparados y validaciones conservan sus casas actuales en var/actualizacion. Esta ficha no habilita limpieza automática ni cambia fechas históricas, periodos, licencias o retención.

## Reproducción

```sh
python -m plataforma_datos.ia_y_trabajo.fuentes.ceo_panel.lector preparar
python -m plataforma_datos.ia_y_trabajo.fuentes.ceo_panel.lector validar
python -m plataforma_datos.contratos.fuentes --fuente ceo_panel --tema ia_y_trabajo --comprobar
```
