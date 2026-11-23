# Suiza: uso de IA en empresas, medida nacional

Generado de `fuente.json`; editar el descriptor y regenerar.

Uso de la IA por las empresas de Suiza (BFS, encuesta de innovación del KOF): su propio módulo de actualización.

ID: `ia_nacional_che` · tema: `ia_y_trabajo` · institución: Bundesamt für Statistik (BFS), con datos de KOF.
Lector estático: `plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_che.lector`. Casa de datos: `ia-nacional-che`.

## Alcance

- La Oficina Federal de Estadística de Suiza (Bundesamt für Statistik, BFS) publica, con los datos de la encuesta de innovación del KOF (centro de estudios económicos de la ETH de Zúrich, módulo de uso de las TIC), la proporción de empresas que usan sistemas basados en inteligencia artificial, por tamaño, cada dos años. Eurostat no publica a Suiza en su indicador de empresas, así que la cifra no está dos veces. No es la medida europea: la encuesta empieza en las empresas de 5 personas empleadas (la clase menor es «Kleine (5-49)»), usa una versión simplificada de la definición de IA de Eurostat y en 2023 respondió el 21,9 % de las empresas invitadas (2 040 de 9 307, según el BFS). Por eso va como medida nacional, con su definición y sin comparar. Se lee la fila «Total», columna del último año.
- El original es el CSV de los datos del gráfico gr-d-16.04-30207a-ind del BFS, que sirve su visor de gráficos. Python estándar.

## Recursos y condiciones de uso

- `recurso-01` (url): Bundesamt für Statistik, gráfico gr-d-16.04-30207a-ind: empresas que usan sistemas basados en IA, por tamaño, 2019–2023 (CSV de los datos del gráfico)
  Ubicación: https://datawrapper.dwcdn.net/9b56ee691380d1d034579031dfcc3f9d/2/dataset.csv. Licencia: Condiciones OPEN-BY del BFS, en la ficha del gráfico (https://www.bfs.admin.ch/asset/de/34948994): «Freie Nutzung - Quellenangabe ist Pflicht»: uso libre, también comercial, con la cita obligatoria del autor, el título y el enlace al conjunto de datos.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `consulta` (remoto): CSV del gráfico BFS servido mediante Datawrapper, vinculado por el lector al recurso oficial BFS. No se declara una API institucional general ni descubrimiento de nueva edición.
  Recursos: recurso-01. Autenticación: El lector no configura credenciales de autenticación para estos recursos públicos; no acredita acceso a otros servicios.
  - Cuotas y límites oficiales de servicio no acreditados por este descriptor; rigen los límites de transporte y validación del lector.
  - Este descriptor no acredita la disponibilidad remota actual; una URL conservada no acredita consulta satisfactoria ni una tarea instalada.
  - La comprobación del recurso conocido no acredita una revisión general de ediciones o disposiciones posteriores.
  - Medida nacional con su universo, pregunta, periodo y licencia propios; el contrato la declara no comparable entre países ni con Eurostat.

## Operación actual

Política: `edición`. Consulta red: sí.
Frecuencia declarada: bienal (encuesta de innovación del KOF, publicada por el BFS). Aviso de renovación: no definido días.
Originales: `ia-nacional-che`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| ia_nacional_che | cambiante | edicion-conocida | descargar | 30 |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: ninguna declarada.
Contratos y controles: lector.py:preparar, lector.py:validar, plataforma_datos/orquestacion/admision.py:exigir_admitido.

Retirada: Se conserva la admisión del conjunto y sus guardas actuales. Un fallo o una ausencia de captura no se convierte en retirada de entidades ni en disponibilidad confirmada.

Conservación: Originales, procedencias, preparados y validaciones conservan sus casas actuales en var/actualizacion. Esta ficha no habilita limpieza automática ni cambia fechas históricas, periodos, licencias o retención.

## Reproducción

```sh
python -m plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_che.lector preparar
python -m plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_che.lector validar
python -m plataforma_datos.contratos.fuentes --fuente ia_nacional_che --tema ia_y_trabajo --comprobar
```
