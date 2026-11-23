# Israel: uso de IA en empresas, medida nacional

Generado de `fuente.json`; editar el descriptor y regenerar.

Uso de la IA por las empresas de Israel (CBS, encuesta de coyuntura, junio de 2025): su propio módulo.

ID: `ia_nacional_isr` · tema: `ia_y_trabajo` · institución: Central Bureau of Statistics (CBS).
Lector estático: `plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_isr.lector`. Casa de datos: `ia-nacional-isr`.

## Alcance

- La Oficina Central de Estadística de Israel (Central Bureau of Statistics, CBS) preguntó en el tema rotatorio de su encuesta de coyuntura empresarial (Business Tendency Survey) de junio de 2025 si la empresa había usado inteligencia artificial en los seis meses anteriores para producir bienes, prestar servicios o en su trabajo habitual, gratuita o de pago (comunicado 216/2025). Según el comunicado, la encuesta abarca las empresas con 10 o más puestos de trabajo asalariados de las ramas de esa encuesta; la clase de tamaño menor de la tabla es «11-50 employees». Eurostat no publica a Israel, así que la cifra no está dos veces. No es la medida europea: es una encuesta de coyuntura, sin la lista de tecnologías del cuestionario europeo, con un plazo de seis meses y en su primera edición. Por eso va como medida nacional, con su definición y sin comparar.
- El original es la tabla en porcentaje de empresas del comunicado (archivo 31_25_216t2.xlsx). Se lee la fila «Total» de «Total of Industries»: la cifra es la suma de «Yes, which are provided for free only» y «Yes, including those that are paid», que con «No» suman el 100 %. El año es el de la edición del comunicado (junio de 2025), que la tabla no repite. Python estándar.

## Recursos y condiciones de uso

- `recurso-01` (url): Central Bureau of Statistics (Israel), comunicado 216/2025: uso de la IA en las empresas en los seis meses anteriores, por rama y tamaño, en porcentaje de empresas (junio de 2025)
  Ubicación: https://www.cbs.gov.il/he/mediarelease/DocLib/2025/216/31_25_216t2.xlsx. Licencia: Licencia abierta del Central Bureau of Statistics (CBS) de Israel (https://www.cbs.gov.il/en/Pages/Enduser-license.aspx): uso libre, también comercial, con obras derivadas; se cita la fuente en la forma que fija la licencia y no se presenta como respaldado por el CBS ni por el Estado de Israel.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `consulta` (remoto): XLSX oficial del comunicado CBS 216/2025, edición conocida. Se conservan pregunta y plazo de seis meses; no se declara descubrimiento de nuevas ediciones.
  Recursos: recurso-01. Autenticación: El lector no configura credenciales de autenticación para estos recursos públicos; no acredita acceso a otros servicios.
  - Cuotas y límites oficiales de servicio no acreditados por este descriptor; rigen los límites de transporte y validación del lector.
  - Este descriptor no acredita la disponibilidad remota actual; una URL conservada no acredita consulta satisfactoria ni una tarea instalada.
  - La comprobación del recurso conocido no acredita una revisión general de ediciones o disposiciones posteriores.
  - Medida nacional con su universo, pregunta, periodo y licencia propios; el contrato la declara no comparable entre países ni con Eurostat.

## Operación actual

Política: `edición`. Consulta red: sí.
Frecuencia declarada: por tema rotatorio (encuesta de coyuntura empresarial del CBS). Aviso de renovación: no definido días.
Originales: `ia-nacional-isr`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| ia_nacional_isr | cambiante | edicion-conocida | descargar | 30 |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: ninguna declarada.
Contratos y controles: lector.py:preparar, lector.py:validar, plataforma_datos/orquestacion/admision.py:exigir_admitido.

Retirada: Se conserva la admisión del conjunto y sus guardas actuales. Un fallo o una ausencia de captura no se convierte en retirada de entidades ni en disponibilidad confirmada.

Conservación: Originales, procedencias, preparados y validaciones conservan sus casas actuales en var/actualizacion. Esta ficha no habilita limpieza automática ni cambia fechas históricas, periodos, licencias o retención.

## Reproducción

```sh
python -m plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_isr.lector preparar
python -m plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_isr.lector validar
python -m plataforma_datos.contratos.fuentes --fuente ia_nacional_isr --tema ia_y_trabajo --comprobar
```
