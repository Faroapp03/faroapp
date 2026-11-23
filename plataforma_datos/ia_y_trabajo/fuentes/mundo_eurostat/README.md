# Eurostat: IA, formación y empleo por país

Generado de `fuente.json`; editar el descriptor y regenerar.

Uso de la IA en Europa, de Eurostat: empresas que usan IA y personas que usan IA generativa, por país.

ID: `mundo_eurostat` · tema: `ia_y_trabajo` · institución: Eurostat.
Lector estático: `plataforma_datos.ia_y_trabajo.fuentes.mundo_eurostat.lector`. Casa de datos: `mundo-eurostat`.

## Alcance

- Las encuestas comunitarias (uso de las TIC en las empresas y en los hogares, y la EPA) hacen la misma pregunta en todos los países europeos, así que sus cifras se comparan entre sí. Cada cifra se guarda desde 2023 (las empresas con IA y la formación de adultos, desde 2021), la más reciente primero, para dibujar su evolución. Se guardan, de la versión vigente de cada tabla:
- - `isoc_eb_ai`: % de empresas de 10 o más personas que usan alguna tecnología de IA (`E_AI_TANY`), desde 2021 (2022 no preguntó por la IA); la cifra de 2021 lleva la nota «definicion_anterior»: la encuesta preguntaba por menos tecnologías; - `isoc_ai_iaiu`: % de personas de 16 a 74 años que usaron IA generativa en tres meses (`I_IUAI`) y para trabajar (`I_IUAIWP`), en total, por sexo y en las ocupaciones no manuales, manuales y TIC (solo hay 2025); - `trng_lfse_04`: % de personas de 25 a 64 años en educación o formación en las 4 últimas semanas (EPA), en total y por sexo, desde 2021, en los países, la UE-27 y Cataluña (región NUTS 2 ES51); - `lfsa_egai2d`: personas ocupadas por gran grupo ISCO-08 en Alemania, España, Francia e Italia, que no llega al paquete del motor: se guarda en el conjunto validado para el contraste del empleo de ILOSTAT (`mercado/fuentes/ilostat/lector.py`).
- La etiqueta oficial de cada código se guarda al preparar y la validación se detiene si cambia: una definición que cambia (como la entrada de la generación de imagen, vídeo o audio en `E_AI_TANY`) no se compara con la anterior sin que una persona lo decida. Cada cifra conserva su marca. Python estándar.

## Recursos y condiciones de uso

- `recurso-01` (url): Eurostat, isoc_eb_ai: empresas de 10 o más personas que usan alguna tecnología de IA, por país
  Ubicación: https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/isoc_eb_ai?format=JSON&lang=EN&indic_is=E_AI_TANY&unit=PC_ENT&size_emp=GE10. Licencia: Aviso de copyright de Eurostat (https://ec.europa.eu/eurostat/help/copyright-notice, consultado el 06/10/2026), que aplica la Decisión 2011/833/UE de la Comisión: reutilización autorizada, también comercial, citando la fuente; una versión filtrada se cita con el enlace del conjunto y la fecha de consulta.
- `recurso-02` (url): Eurostat, isoc_ai_iaiu: personas que usan IA generativa (total, por sexo y por ocupación), por país, en % de toda la población y de los usuarios de internet
  Ubicación: https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/isoc_ai_iaiu?format=JSON&lang=EN&unit=PC_IND&unit=PC_IND_IU3&indic_is=I_IUAI&indic_is=I_IUAIWP&ind_type=IND_TOTAL&ind_type=F_Y16_74&ind_type=M_Y16_74&ind_type=ISCO0_5&ind_type=ISCO6_9&ind_type=ISCO_ICT. Licencia: Aviso de copyright de Eurostat (https://ec.europa.eu/eurostat/help/copyright-notice, consultado el 06/10/2026), que aplica la Decisión 2011/833/UE de la Comisión: reutilización autorizada, también comercial, citando la fuente; una versión filtrada se cita con el enlace del conjunto y la fecha de consulta.
- `recurso-03` (url): Eurostat, trng_lfse_04: personas de 25 a 64 años en educación o formación en las 4 últimas semanas, por sexo, países y regiones NUTS 2, desde 2021
  Ubicación: https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/trng_lfse_04?format=JSON&lang=EN&age=Y25-64&unit=PC&sinceTimePeriod=2021. Licencia: Aviso de copyright de Eurostat (https://ec.europa.eu/eurostat/help/copyright-notice, consultado el 06/10/2026), que aplica la Decisión 2011/833/UE de la Comisión: reutilización autorizada, también comercial, citando la fuente; una versión filtrada se cita con el enlace del conjunto y la fecha de consulta.
- `recurso-04` (url): Eurostat, lfsa_egai2d: personas ocupadas de 15 años o más por gran grupo ISCO-08 y sexo, DE, ES, FR e IT, desde 2023 (contraste del empleo de ILOSTAT)
  Ubicación: https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/lfsa_egai2d?format=JSON&lang=EN&unit=THS_PER&age=Y_GE15&sex=T&sex=F&geo=DE&geo=ES&geo=FR&geo=IT&isco08=TOTAL&isco08=OC1&isco08=OC2&isco08=OC3&isco08=OC4&isco08=OC5&isco08=OC6&isco08=OC7&isco08=OC8&isco08=OC9&isco08=OC0&sinceTimePeriod=2023. Licencia: Aviso de copyright de Eurostat (https://ec.europa.eu/eurostat/help/copyright-notice, consultado el 06/10/2026), que aplica la Decisión 2011/833/UE de la Comisión: reutilización autorizada, también comercial, citando la fuente; una versión filtrada se cita con el enlace del conjunto y la fecha de consulta.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `consulta` (remoto): API oficial de estadísticas Eurostat: indicadores de IA, formación y empleo con filtros explícitos. La serie se conserva por año, geografía, base y marcas de cada tabla.
  Recursos: recurso-01, recurso-02, recurso-03, recurso-04. Autenticación: El lector no configura credenciales de autenticación para estos recursos públicos; no acredita acceso a otros servicios.
  - Cuotas y límites oficiales de servicio no acreditados por este descriptor; rigen los límites de transporte y validación del lector.
  - Este descriptor no acredita la disponibilidad remota actual; una URL conservada no acredita consulta satisfactoria ni una tarea instalada.

## Operación actual

Política: `mensual`. Consulta red: sí.
Frecuencia declarada: anual (encuestas TIC y EPA de Eurostat). Aviso de renovación: no definido días.
Originales: `mundo-eurostat`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| mundo_eurostat | cambiante | serie-abierta | descargar | 30 |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: tich, empresas.
Contratos y controles: lector.py:preparar, lector.py:validar, plataforma_datos/orquestacion/admision.py:exigir_admitido.

Retirada: Se conserva la admisión del conjunto y sus guardas actuales. Un fallo o una ausencia de captura no se convierte en retirada de entidades ni en disponibilidad confirmada.

Conservación: Originales, procedencias, preparados y validaciones conservan sus casas actuales en var/actualizacion. Esta ficha no habilita limpieza automática ni cambia fechas históricas, periodos, licencias o retención.

## Reproducción

```sh
python -m plataforma_datos.ia_y_trabajo.fuentes.mundo_eurostat.lector preparar
python -m plataforma_datos.ia_y_trabajo.fuentes.mundo_eurostat.lector validar
python -m plataforma_datos.contratos.fuentes --fuente mundo_eurostat --tema ia_y_trabajo --comprobar
```
