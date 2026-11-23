# Corea del Sur: uso de IA generativa por personas, medida nacional

Generado de `fuente.json`; editar el descriptor y regenerar.

Uso de la IA generativa por las personas de Corea del Sur (MSIT, encuesta de uso de internet): su propio módulo.

ID: `ia_nacional_kor` · tema: `ia_y_trabajo` · institución: Ministerio de Ciencia y TIC (MSIT) y NIA.
Lector estático: `plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_kor.lector`. Casa de datos: `ia-nacional-kor`.

## Alcance

- El Ministerio de Ciencia y TIC de Corea (MSIT), con la agencia NIA, publica cada año la encuesta de uso de internet (estadística nacional aprobada). La edición de 2025 (comunicado del 31/03/2026) encuesta a 50 750 personas de 3 o más años de 22 671 hogares y da el porcentaje que ha usado alguna vez un servicio basado en IA generativa. Es una medida de personas, aparte de las de empresas, y no es la europea: cuenta el uso «alguna vez» (la europea, los tres últimos meses), empieza a los 3 años (la europea, a los 16) y el boletín no dice si la base es toda la población encuestada o quienes usan internet. Por eso va como medida nacional, con su definición y sin comparar. Se lee la fila «생성형 AI 기반 서비스 경험률» del cuadro de resultados principales, columna del último año.
- El original es el boletín del comunicado (ODT), que el portal oficial korea.kr publica con la licencia KOGL tipo 1. Python estándar.

## Recursos y condiciones de uso

- `recurso-01` (url): Ministerio de Ciencia y TIC de Corea (MSIT), comunicado de la encuesta de uso de internet 2025, con el cuadro de resultados principales (ODT)
  Ubicación: https://www.korea.kr/common/download.do?fileId=198408434&tblKey=GMN. Licencia: Korea Open Government License (공공누리), tipo 1, atribución (https://www.kogl.or.kr/info/licenseType1.do): uso libre, también comercial, con obras derivadas; se indica la fuente con su enlace y no se presenta como respaldado por el organismo. «본 저작물은 '과학기술정보통신부'에서 '2026년' 작성하여 공공누리 제1유형으로 개방한 '「2025 인터넷이용실태조사」 결과 발표(작성자: 과학기술정보통신부)'을 이용하였으며, 해당 저작물은 '대한민국 정책브리핑, https://www.korea.kr/briefing/pressReleaseView.do?newsId=156751949'에서 무료로 다운받으실 수 있습니다.».

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `consulta` (remoto): ODT del comunicado oficial publicado en korea.kr, edición conocida. Se conservan universo y uso alguna vez; la base poblacional que el boletín no aclara sigue desconocida.
  Recursos: recurso-01. Autenticación: El lector no configura credenciales de autenticación para estos recursos públicos; no acredita acceso a otros servicios.
  - Cuotas y límites oficiales de servicio no acreditados por este descriptor; rigen los límites de transporte y validación del lector.
  - Este descriptor no acredita la disponibilidad remota actual; una URL conservada no acredita consulta satisfactoria ni una tarea instalada.
  - La comprobación del recurso conocido no acredita una revisión general de ediciones o disposiciones posteriores.
  - Medida nacional con su universo, pregunta, periodo y licencia propios; el contrato la declara no comparable entre países ni con Eurostat.

## Operación actual

Política: `edición`. Consulta red: sí.
Frecuencia declarada: anual (encuesta de uso de internet del MSIT y la NIA). Aviso de renovación: no definido días.
Originales: `ia-nacional-kor`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| ia_nacional_kor | cambiante | edicion-conocida | descargar | 30 |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: ninguna declarada.
Contratos y controles: lector.py:preparar, lector.py:validar, plataforma_datos/orquestacion/admision.py:exigir_admitido.

Retirada: Se conserva la admisión del conjunto y sus guardas actuales. Un fallo o una ausencia de captura no se convierte en retirada de entidades ni en disponibilidad confirmada.

Conservación: Originales, procedencias, preparados y validaciones conservan sus casas actuales en var/actualizacion. Esta ficha no habilita limpieza automática ni cambia fechas históricas, periodos, licencias o retención.

## Reproducción

```sh
python -m plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_kor.lector preparar
python -m plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_kor.lector validar
python -m plataforma_datos.contratos.fuentes --fuente ia_nacional_kor --tema ia_y_trabajo --comprobar
```
