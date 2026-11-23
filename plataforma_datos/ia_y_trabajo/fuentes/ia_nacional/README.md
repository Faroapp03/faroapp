# Uso de IA en empresas: Australia, Canadá y Estados Unidos

Generado de `fuente.json`; editar el descriptor y regenerar.

Productor externo existente de medidas nacionales oficiales de uso de IA, con una definición propia por país y comparable:false. Su conjunto se consume previamente admitido, sin FUENTES/MODULOS activos ni cadencia automática.

ID: `ia_nacional` · tema: `ia_y_trabajo` · institución: Australian Bureau of Statistics; Statistics Canada; U.S. Census Bureau.
Lector estático: `plataforma_datos.ia_y_trabajo.fuentes.ia_nacional.lector`. Casa de datos: `ia-nacional`.

## Alcance

- Australia: Characteristics of Australian Business 2024–25, BCSDC06 tabla 2, universo propio y cautela ABS. Canadá: tabla 33-10-1167-01, CSBC segundo trimestre 2026, pregunta de uso en los 12 meses anteriores.
- Estados Unidos: BTOS nacional quincenal, última fila de la pregunta nueva any of its business functions desde periodo 202524; no encadena con la serie anterior.
- La periodicidad de cada encuesta no es una cadencia de consulta configurada. No descubre nuevas tablas ABS/StatCan; conserva recursos fijados y validación de pregunta, rangos, calidad y periodos. Ninguna tasa se compara entre países o con Eurostat.

## Recursos y condiciones de uso

- `recurso-01` (url): Australian Bureau of Statistics, Characteristics of Australian Business 2024–25, libro BCSDC06 (uso de tecnologías de la información y la comunicación)
  Ubicación: https://www.abs.gov.au/statistics/industry/technology-and-innovation/characteristics-australian-business/2024-25/BCSDC06_2024%E2%80%9325.xlsx. Licencia: © Commonwealth of Australia: Creative Commons Attribution 4.0 International (https://www.abs.gov.au/website-privacy-copyright-and-disclaimer), citando a la ABS.
- `recurso-02` (url): Statistics Canada, tabla 33-10-1167-01: uso de IA para producir bienes o prestar servicios en los últimos 12 meses, 2.º trimestre de 2026 (CSV)
  Ubicación: https://www150.statcan.gc.ca/n1/tbl/csv/33101167-eng.zip. Licencia: Statistics Canada Open Licence (https://www.statcan.gc.ca/en/terms-conditions/open-licence), citando a Statistics Canada.
- `recurso-03` (url): U.S. Census Bureau, Business Trends and Outlook Survey: estimaciones nacionales por período
  Ubicación: https://www.census.gov/hfp/btos/downloads/National.xlsx. Licencia: Obra del Gobierno federal de EE. UU.: dominio público (17 U.S.C. § 105). Se cita al U.S. Census Bureau.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `archivos-oficiales` (remoto): Descarga libros XLSX de ABS/Census y ZIP CSV de StatCan con procedencia. preparar/validar operan sobre originales locales conservados.
  Recursos: recurso-01, recurso-02, recurso-03. Autenticación: El productor existente no configura credenciales para estas URLs públicas; no se ha comprobado acceso remoto en este cierre.
  - Cuotas oficiales no acreditadas por el descriptor; conserva transporte, seguridad y validación del productor.
  - Descarga solo al ejecutar su CLI explícita; no hay registro automático ni intervalo nuevo.
  - Conserva licencia y atribución particular de cada oficina; una URL no acredita disponibilidad actual.

## Operación actual

Modalidad: `productor-externo`.
Sin política de actualización en el registro principal ni consulta automática habilitada.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| ia_nacional | externa | productor-externo | revision | no automático |

Dependencias: ninguna declarada.
Contratos y controles: lector.py:ARCHIVOS, lector.py:INDICADORES_NACIONALES, lector.py:preparar, lector.py:validar, plataforma_datos/orquestacion/admision.py:cerrar_validacion.

Retirada: Productor externo al registro principal: un error o captura ausente no acredita retirada ni sustituye un conjunto previamente admitido. Se conservan sus validaciones y límites semánticos existentes.

Conservación: Originales, procedencia, preparados y admisión conservan la casa actual. Este descriptor no ejecuta limpieza ni rejuvenece capturas, periodos o licencias; los microdatos no se incorporan a Git ni a entregas públicas.

## Reproducción

```sh
python -m plataforma_datos.ia_y_trabajo.fuentes.ia_nacional.lector preparar
python -m plataforma_datos.ia_y_trabajo.fuentes.ia_nacional.lector validar
python -m plataforma_datos.contratos.fuentes --fuente ia_nacional --tema ia_y_trabajo --comprobar
```
