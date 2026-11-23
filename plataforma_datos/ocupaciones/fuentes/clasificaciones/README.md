# Clasificaciones oficiales y correspondencia CNO-11/CIUO-08

Generado de `fuente.json`; editar el descriptor y regenerar.

Clasificaciones oficiales de ocupaciones: CNO-11, su correspondencia con ISCO-08 y los títulos ISCO-08 en español.

ID: `clasificaciones` · tema: `ocupaciones` · institución: INE y Organización Internacional del Trabajo.
Lector estático: `plataforma_datos.ocupaciones.fuentes.clasificaciones.lector`. Casa de datos: `clasificaciones`.

## Alcance

- CNO-11 y su correspondencia con ISCO-08 son del INE; los títulos oficiales en español de ISCO-08, de la OIT. Descarga, prepara y valida. Python estándar. Depende de la validación de la OIT (grupos ISCO-08 en inglés).

## Recursos y condiciones de uso

- `recurso-01` (url): INE · CNO-11: estructura oficial de 1 a 4 dígitos y grupos principales
  Ubicación: https://www.ine.es/daco/daco42/clasificaciones/cno11_estructura.xls. Licencia: Aviso legal del INE: reutilización permitida citando la fuente y sin desnaturalizar la información.
- `recurso-02` (url): INE · Correspondencia oficial CNO-11 / CIUO-08 (ISCO-08) a 4 dígitos
  Ubicación: https://www.ine.es/daco/daco42/clasificaciones/corr_cno11_ciuo08.xls. Licencia: Aviso legal del INE: reutilización permitida citando la fuente y sin desnaturalizar la información.
- `recurso-03` (url): OIT · CIUO-08 (ISCO-08): estructura oficial en español
  Ubicación: https://www.ilo.org/public/spanish/bureau/stat/isco/docs/struct08.xls. Licencia: Clasificación oficial de la OIT anterior a 2023: se usa como clasificación de referencia, citando la fuente.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `originales` (remoto): Descarga de la edición conocida, sin activar aceptación automática de cambios. No acredita vigencia posterior de clasificaciones ni nuevas ediciones descubiertas.
  Recursos: recurso-01, recurso-02, recurso-03. Autenticación: No se configura una cuenta en el lector.
  - Se conserva el transporte común y sus controles de procedencia; no se declara una cuota publicada de la fuente.

## Operación actual

Política: `edición`. Consulta red: sí.
Frecuencia declarada: con cada revisión de la CNO o la CIUO. Aviso de renovación: no definido días.
Originales: `clasificaciones`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| clasificaciones | referencia-versionada | edicion-conocida | descargar | 30 |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: oit.
Contratos y controles: lector.py:validar.

Retirada: Se conservan las guardas actuales; un fallo no acredita ausencia ni retira la última versión admitida.

Conservación: Casas operativas y bytes del paquete conservados; no cambia modelos, motor, sello, datos ni criterios.

## Reproducción

```sh
python -m plataforma_datos.ocupaciones.fuentes.clasificaciones.lector preparar
python -m plataforma_datos.ocupaciones.fuentes.clasificaciones.lector validar
python -m plataforma_datos.contratos.fuentes --fuente clasificaciones --tema ocupaciones --comprobar
```
