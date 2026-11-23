# Biblioteca ESCO en español

Generado de `fuente.json`; editar el descriptor y regenerar.

Biblioteca ESCO española: captura oficial, preparación y validación.

ID: `esco` · tema: `ocupaciones` · institución: Comisión Europea.
Lector estático: `plataforma_datos.ocupaciones.fuentes.esco.lector`. Casa de datos: `esco`.

## Alcance

- Captura completa de ocupaciones y capacidades/conocimientos de la API oficial (versión fija), preparada en JSON Lines y en una base SQLite con búsqueda de texto completo. Python estándar; sin modelos ni claves privadas. Las consultas a la base (buscar, ficha, relaciones) están en consultas.py.

## Recursos y condiciones de uso

- `api-search` (url): Búsqueda oficial de ocupaciones y competencias activas; versión solicitada v1.2.1 y lengua es. La respuesta no trae versión explícita.
  Ubicación: https://ec.europa.eu/esco/api/search. Licencia: © Unión Europea. Reutilización autorizada según la Decisión 2011/833/UE de la Comisión y su aviso legal (https://commission.europa.eu/legal-notice_en), citando la fuente e indicando las modificaciones.
- `captura-local` (archivo): Captura conservada de las páginas API, comprobada contra procedencia y huellas.
  Ubicación: var/actualizacion/originales/esco/biblioteca-api.zip. Licencia: © Unión Europea. Reutilización autorizada según la Decisión 2011/833/UE de la Comisión y su aviso legal (https://commission.europa.eu/legal-notice_en), citando la fuente e indicando las modificaciones.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `api-captura-manual` (remoto): Capacidad de la orden individual descargar. La política operativa sigue fija/red=false: no se añade descarga programada ni se cambia versión.
  Recursos: api-search. Autenticación: No se configura una cuenta en el lector.
  - Página de 100 registros; máximo 3 hilos, 4 intentos y 90 segundos por petición según constantes del lector.
  - No se acredita una cuota publicada del servicio.
- `captura-conservada` (local): Preparación y validación local de la captura existente; no introduce modelos.
  Recursos: captura-local. Autenticación: No aplicable a lectura local.
  - Huella ZIP y de páginas, totales, URI, relaciones directas/inversas, preparados y SQLite comprobados por el lector.

## Operación actual

Política: `fija`. Consulta red: no.
Frecuencia declarada: por versión (v1.2.1). Aviso de renovación: no definido días.
Originales: `esco`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| esco | referencia-versionada | copia-local | revision | no automático |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: ninguna declarada.
Contratos y controles: lector.py:validar.

Retirada: Se conservan las guardas actuales; un fallo no acredita ausencia ni retira la última versión admitida.

Conservación: Casas operativas y bytes del paquete conservados; no cambia modelos, motor, sello, datos ni criterios.

## Reproducción

```sh
python -m plataforma_datos.ocupaciones.fuentes.esco.lector preparar
python -m plataforma_datos.ocupaciones.fuentes.esco.lector validar
python -m plataforma_datos.contratos.fuentes --fuente esco --tema ocupaciones --comprobar
```
