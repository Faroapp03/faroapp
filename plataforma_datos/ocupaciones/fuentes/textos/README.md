# Textos de Faro en castellano sobre tareas oficiales

Generado de `fuente.json`; editar el descriptor y regenerar.

Textos en castellano de las tareas oficiales de la OIT: procedencia, validación y combinación para el motor.

ID: `textos` · tema: `ocupaciones` · institución: Equipo Faro.
Lector estático: `plataforma_datos.ocupaciones.fuentes.textos.lector`. Casa de datos: `textos`.

## Alcance

- No es una fuente oficial: son textos de Faro sobre las tareas oficiales ISCO-08 (con el aviso de traducción de la OIT), que se aportan a mano como capturas de autoría en var/actualizacion/preparados/textos/ (véase README):
- tareas-piloto.json redacción manual del caso piloto tareas-generadas.jsonl redactado con IA tareas-traducidas.jsonl traducido con IA
- Las herramientas de IA que redactaron y tradujeron los textos no forman parte de este producto: `descargar` muestra de cuáles proceden y la procedencia registra su nombre de origen.
- Las etapas siguen la interfaz común: `descargar` explica de dónde salen, `preparar` registra su procedencia (huella de cada archivo y, de lo generado con IA, modelo, fecha y huella de las instrucciones) y `validar` los contrasta con las tareas oficiales validadas de la OIT. Depende de la validación de la OIT. Python estándar.

## Recursos y condiciones de uso

- `tareas-piloto-json` (archivo): Captura de autoría conservada: Redacción manual del caso piloto (recepcionista 4226 y contable 4311).
  Ubicación: var/actualizacion/preparados/textos/tareas-piloto.json. Licencia: desconocida; no acreditada por este descriptor.
- `tareas-generadas-jsonl` (archivo): Captura de autoría conservada: Redacción completa con IA a partir de las justificaciones publicadas con la nota de la OIT.
  Ubicación: var/actualizacion/preparados/textos/tareas-generadas.jsonl. Licencia: desconocida; no acreditada por este descriptor.
- `tareas-traducidas-jsonl` (archivo): Captura de autoría conservada: Traducción con IA del título y el texto de las tareas oficiales en inglés.
  Ubicación: var/actualizacion/preparados/textos/tareas-traducidas.jsonl. Licencia: desconocida; no acreditada por este descriptor.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `capturas-autoria` (editorial): Se registran y validan capturas ya aportadas. No genera, traduce ni llama a herramientas de IA.
  Recursos: tareas-piloto-json, tareas-generadas-jsonl, tareas-traducidas-jsonl. Autenticación: No aplicable a lectura local.
  - Modelo, fecha y huella de instrucciones se conservan cuando constan; el aviso OIT proviene de originales/oit/procedencia.json.
  - Los controles de forma y procedencia no acreditan fidelidad semántica del texto.

## Operación actual

Política: `redactada`. Consulta red: no.
Frecuencia declarada: revisión de Equipo Faro. Aviso de renovación: no definido días.
Sin carpeta de originales declarada.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| textos | editorial | copia-local | revision | no automático |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: oit.
Contratos y controles: lector.py:validar.

Retirada: Se conservan las guardas actuales; un fallo no acredita ausencia ni retira la última versión admitida.

Conservación: Casas operativas y bytes del paquete conservados; no cambia modelos, motor, sello, datos ni criterios.

## Reproducción

```sh
python -m plataforma_datos.ocupaciones.fuentes.textos.lector preparar
python -m plataforma_datos.ocupaciones.fuentes.textos.lector validar
python -m plataforma_datos.contratos.fuentes --fuente textos --tema ocupaciones --comprobar
```
