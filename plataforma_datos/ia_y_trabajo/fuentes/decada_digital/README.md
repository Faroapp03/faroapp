# Programa estratégico de la Década Digital para 2030

Generado de `fuente.json`; editar el descriptor y regenerar.

Las metas de la Década Digital para 2030: el texto literal del artículo 4 de la Decisión (UE) 2022/2481.

ID: `decada_digital` · tema: `ia_y_trabajo` · institución: Unión Europea.
Lector estático: `plataforma_datos.ia_y_trabajo.fuentes.decada_digital.lector`. Casa de datos: `decada-digital`.

## Alcance

- Se descarga el texto original español del Diario Oficial de la Oficina de Publicaciones (Cellar) y se guarda el artículo 4. La validación exige que el texto de cada meta de `catalogo_ue.METAS` (la que mide un indicador del archivo) esté en ese original, letra por letra. Esta consulta no comprueba la vigencia, las modificaciones ni las versiones consolidadas de la decisión; requieren una revisión aparte. Es la ley, no una medida: el archivo de datos globales lo lleva en su bloque `metas`, aparte de las cifras. Python estándar.

## Recursos y condiciones de uso

- `recurso-01` (url): Decisión (UE) 2022/2481 (programa estratégico de la Década Digital para 2030), versión española
  Ubicación: https://publications.europa.eu/resource/cellar/26514cb9-7f40-11ed-9887-01aa75ed71a1.0023.03/DOC_1. Licencia: Aviso jurídico de EUR-Lex (https://eur-lex.europa.eu/content/legal-notice/legal-notice.html), que aplica la Decisión 2011/833/UE de la Comisión: reutilización autorizada citando la fuente. Solo da fe la edición impresa o electrónica del Diario Oficial de la Unión Europea.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `consulta` (remoto): Documento XHTML oficial de EUR-Lex de la Decisión (UE) 2022/2481. El lector extrae el artículo 4; una consulta del texto conocido no descubre por sí misma disposiciones posteriores.
  Recursos: recurso-01. Autenticación: El lector no configura credenciales de autenticación para estos recursos públicos; no acredita acceso a otros servicios.
  - Cuotas y límites oficiales de servicio no acreditados por este descriptor; rigen los límites de transporte y validación del lector.
  - Este descriptor no acredita la disponibilidad remota actual; una URL conservada no acredita consulta satisfactoria ni una tarea instalada.
  - La comprobación del recurso conocido no acredita una revisión general de ediciones o disposiciones posteriores.

## Operación actual

Política: `fija`. Consulta red: sí.
Frecuencia declarada: cuando se modifique la Decisión (UE) 2022/2481. Aviso de renovación: no definido días.
Originales: `decada-digital`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| decada_digital | cambiante | edicion-conocida | descargar | 7 |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: ninguna declarada.
Contratos y controles: lector.py:preparar, lector.py:validar, plataforma_datos/orquestacion/admision.py:exigir_admitido.

Retirada: Se conserva la admisión del conjunto y sus guardas actuales. Un fallo o una ausencia de captura no se convierte en retirada de entidades ni en disponibilidad confirmada.

Conservación: Originales, procedencias, preparados y validaciones conservan sus casas actuales en var/actualizacion. Esta ficha no habilita limpieza automática ni cambia fechas históricas, periodos, licencias o retención.

## Reproducción

```sh
python -m plataforma_datos.ia_y_trabajo.fuentes.decada_digital.lector preparar
python -m plataforma_datos.ia_y_trabajo.fuentes.decada_digital.lector validar
python -m plataforma_datos.contratos.fuentes --fuente decada_digital --tema ia_y_trabajo --comprobar
```
