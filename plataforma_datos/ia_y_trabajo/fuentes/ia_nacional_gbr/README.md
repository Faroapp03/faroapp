# Reino Unido: uso de IA en empresas, medida nacional

Generado de `fuente.json`; editar el descriptor y regenerar.

Uso de la IA por las empresas del Reino Unido (ONS, BICS, 10 o más personas): su propio módulo de actualización.

ID: `ia_nacional_gbr` · tema: `ia_y_trabajo` · institución: Office for National Statistics (ONS).
Lector estático: `plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_gbr.lector`. Casa de datos: `ia-nacional-gbr`.

## Alcance

- La Office for National Statistics pregunta en su encuesta quincenal Business Insights and Conditions Survey (BICS) qué tecnologías de IA usa la empresa ahora, de una lista de seis más «Other». La serie que se lee es la de la figura 1 del artículo «Artificial intelligence in UK businesses: 2023 to 2026» (estimaciones ponderadas, solo empresas de 10 o más personas empleadas): el último período publicado. Es una estadística oficial en desarrollo («official statistics in development») y la respuesta es voluntaria. La cifra de todas las empresas (también las de 0 a 9 personas) es otra base y no se mezcla con esta: la nota de la figura que dice el universo se comprueba literal. Python estándar.

## Recursos y condiciones de uso

- `recurso-01` (url): Office for National Statistics, BICS: empresas de 10 o más personas que usan IA, serie de la figura 1 del artículo «Artificial intelligence in UK businesses: 2023 to 2026» (CSV)
  Ubicación: https://www.ons.gov.uk/generator?uri=/businessindustryandtrade/business/businessservices/articles/artificialintelligenceinukbusinesses/2023to2026/808491a0&format=csv. Licencia: Open Government Licence v3.0 (https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/): «Contains public sector information licensed under the Open Government Licence v3.0.» Se cita a la Office for National Statistics (ONS).
- `recurso-02` (url): ONS, Artificial intelligence in UK businesses, ediciones publicadas
  Ubicación: https://www.ons.gov.uk/businessindustryandtrade/business/businessservices/articles/artificialintelligenceinukbusinesses/previousreleases. Licencia: Open Government Licence v3.0 (https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/): «Contains public sector information licensed under the Open Government Licence v3.0.» Se cita a la Office for National Statistics (ONS).

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `consulta` (remoto): Catálogo de ediciones de la ONS, artículo y CSV de la figura 1. El lector valida literalmente universo, pregunta y periodo antes de admitir la serie.
  Recursos: recurso-01, recurso-02. Autenticación: El lector no configura credenciales de autenticación para estos recursos públicos; no acredita acceso a otros servicios.
  - Cuotas y límites oficiales de servicio no acreditados por este descriptor; rigen los límites de transporte y validación del lector.
  - Este descriptor no acredita la disponibilidad remota actual; una URL conservada no acredita consulta satisfactoria ni una tarea instalada.
  - Medida nacional con su universo, pregunta, periodo y licencia propios; el contrato la declara no comparable entre países ni con Eurostat.

## Operación actual

Política: `edición`. Consulta red: sí.
Frecuencia declarada: trimestral (artículo de la ONS con la serie de BICS). Aviso de renovación: no definido días.
Originales: `ia-nacional-gbr`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| ia_nacional_gbr | cambiante | descubre-edicion | descargar | 30 |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: ninguna declarada.
Contratos y controles: lector.py:preparar, lector.py:validar, plataforma_datos/orquestacion/admision.py:exigir_admitido.

Retirada: Se conserva la admisión del conjunto y sus guardas actuales. Un fallo o una ausencia de captura no se convierte en retirada de entidades ni en disponibilidad confirmada.

Conservación: Originales, procedencias, preparados y validaciones conservan sus casas actuales en var/actualizacion. Esta ficha no habilita limpieza automática ni cambia fechas históricas, periodos, licencias o retención.

## Reproducción

```sh
python -m plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_gbr.lector preparar
python -m plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_gbr.lector validar
python -m plataforma_datos.contratos.fuentes --fuente ia_nacional_gbr --tema ia_y_trabajo --comprobar
```
