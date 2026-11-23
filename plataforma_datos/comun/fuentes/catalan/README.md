# Traducciones al catalán conservadas y comprobadas

Generado de `fuente.json`; editar el descriptor y regenerar.

Traducción de Faro al catalán de los datos oficiales: origen, procedencia, validación sin IA y combinación.

ID: `catalan` · tema: `comun` · institución: Equipo Faro.
Lector estático: `plataforma_datos.comun.fuentes.catalan.lector`. Casa de datos: `catalan`.

## Alcance

- No es una fuente oficial: ESCO y las tareas de la OIT no tienen versión catalana, y esta es una traducción de Faro hecha con IA, con el aviso de traducción de la OIT. Los nombres de los grupos sí la tienen: el paquete lleva los oficiales del Idescat (comun/fuentes/idescat/lector.py), literales, y no su traducción, que se conserva solo como texto de contraste. Sigue la cadena de las demás fuentes, en var/actualizacion/preparados/catalan/:
- origen/<tipo>-<parte>.json lo que hay que traducir, en castellano: lo escribe `descargar` a partir del castellano validado, en partes que no se solapan (una `muestra` y el resto) traducciones/<tipo>-<parte>.json la traducción de una parte, con su procedencia (modelo, fecha, estado y marca): la escribe una persona o un modelo, fuera de esta cadena y sin la API de Faro procedencia.json huella y claves de cada archivo, y el aviso de traducción de la OIT (`preparar`)
- Tipos y claves: `tareas` («<id>.corto», «<id>.texto» y, si existen, «<id>.ia_podria» y «<id>.lo_tuyo»), `grupos` (código ISCO-08 de 1 a 4 cifras) y `ocupaciones` (código ESCO). `validar` comprueba cada traducción sin IA y escribe var/actualizacion/validados/catalan/validacion.json; lo que no está traducido, o cuyo castellano ya no es el vigente, no es un error: no se exporta y el motor lo muestra en castellano. Depende de las validaciones de la OIT, de las clasificaciones, de ESCO y de los textos. Python estándar.

## Recursos y condiciones de uso

- `entradas-conservadas` (familia): Orígenes y traducciones conservados con procedencia y huellas; no constituyen una nueva traducción.
  Ubicación: var/actualizacion/preparados/catalan/. Licencia: desconocida; no acreditada por este descriptor.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `revision-editorial` (editorial): Solo validación local de traducciones y orígenes conservados. La cadena la trata como SOLO_VALIDAR: no ejecuta descargar/preparar ni genera traducciones o llamadas LLM.
  Recursos: entradas-conservadas. Autenticación: No aplicable al procesamiento local; no acredita cuenta, disponibilidad o tarea instalada.
  - Rigen los controles y límites del lector; no se acredita una cuota remota nueva.
  - Sin consulta de red nueva en esta preparación; URL conservada no acredita disponibilidad actual.

## Operación actual

Política: `redactada`. Consulta red: no.
Frecuencia declarada: traducción de Faro con IA, revisada aparte; aquí solo se valida. Aviso de renovación: no definido días.
Sin carpeta de originales declarada.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| catalan | editorial | copia-local | revision | no automático |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: esco, oit, clasificaciones, textos, idescat.
Contratos y controles: lector.py:validar.

Retirada: No se retira contenido por fallo de consulta o ausencia de un original; se conservan las guardas de admisión existentes.

Conservación: Casas y bytes operativos en var/actualizacion conservados. Este descriptor no rejuvenece fechas, no genera traducciones, no limpia originales ni cambia la política de admisión.

## Reproducción

```sh
python -m plataforma_datos.comun.fuentes.catalan.lector preparar
python -m plataforma_datos.comun.fuentes.catalan.lector validar
python -m plataforma_datos.contratos.fuentes --fuente catalan --tema comun --comprobar
```
