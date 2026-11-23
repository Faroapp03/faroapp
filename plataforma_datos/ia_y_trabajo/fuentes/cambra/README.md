# ODEE / Cambra de Comerç de Barcelona

Generado de `fuente.json`; editar el descriptor y regenerar.

ODEE / Cambra de Comerç de Barcelona (2026): exposición a la IA y personas ocupadas por sexo en Cataluña.

ID: `cambra` · tema: `ia_y_trabajo` · institución: ODEE / Cambra de Comerç de Barcelona.
Lector estático: `plataforma_datos.ia_y_trabajo.fuentes.cambra.lector`. Casa de datos: `cambra`.

## Alcance

- El ODEE y la Cambra enviaron la tabla completa de su estudio, con autorización escrita para usarla en Faro (ver la procedencia): para cada una de las 163 ocupaciones de la CNO-11 a 3 cifras, la puntuación de exposición potencial de la OIT (media y máximo de las ocupaciones ISCO-08 de 4 cifras del grupo ISCO de 3 cifras que le corresponde), su nivel en la escala propia del estudio (cinco tramos de 0,1: nivel 1 por debajo de 0,2 … nivel 5 desde 0,5; no son los gradientes de la OIT ni las franjas de Faro) y las personas ocupadas por sexo (Cens de població i habitatges 2022). Se lee con el lector propio de .xls (hojas.py) y se comprueba que reproduce exactamente las cifras que publica el estudio: el reparto por sexo (pág. impresa 14) y la Taula 4 (pág. impresa 21).
- La Taula 13 (personas contratadas por ocupación, pág. impresa 38) no está en la tabla: sus cifras se transcriben del PDF publicado, con su página, y se comprueban con sus variaciones e índices y, en `mercado/fuentes/cataluna/lector.py`, con el Observatori.
- Uso en el informe: solo el reparto por sexo de toda Cataluña, citado con su escala y su censo (2022), como contexto colectivo: nunca ajusta la nota de una persona. Es exposición potencial, no adopción en las empresas ni pérdida de empleo. Las cifras por ocupación del informe salen del INE (Censo 2021) y del Observatori del Treball para todas las ocupaciones (`mercado/fuentes/cataluna/lector.py`), que se contrastan con la Taula 4 y la Taula 13. Depende de la validación de las clasificaciones (códigos CNO-11). Python estándar.

## Recursos y condiciones de uso

- `recurso-01` (url): Impacte de la IA generativa sobre el mercat laboral (PDF publicado: es el informe completo, aunque el archivo se llame «PORTADA»)
  Ubicación: https://www.donaempresaeconomia.org/wp-content/uploads/2026/06/ESTUDI-IMPACTE-IA_PORTADA.pdf. Licencia: Sin licencia abierta. Autorización escrita del ODEE para usar los datos del estudio en Faro, con las condiciones de «autorizacion».
- `recurso-02` (archivo): Exposición a la IA generativa y personas ocupadas por sexo de las 163 ocupaciones de la CNO-11 a 3 cifras, Cataluña, 2022
  Ubicación: var/actualizacion/originales/cambra/iaexpo-desagregados-2022-genero.xls. Licencia: Sin licencia abierta. Autorización escrita del ODEE para usar los datos del estudio en Faro, con las condiciones de «autorizacion».

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `capturas` (local): Copias conservadas manualmente del PDF publicado y la tabla cedida por ODEE/Cambra con autorización escrita declarada en la procedencia. El lector no descarga esos originales: `descargar` solo avisa de que se registran a mano.
  Recursos: recurso-01, recurso-02. Autenticación: No aplicable al lector local.
  - Cuotas y límites oficiales de servicio no acreditados por este descriptor; rigen los límites de transporte y validación del lector.
  - Este descriptor no acredita la disponibilidad remota actual; una URL conservada no acredita consulta satisfactoria ni una tarea instalada.
  - Citar expresamente al ODEE (Observatori Dona, Empresa i Economia) y a la Cambra de Comerç de Barcelona como fuente de los datos.
  - Informarles de cualquier publicación, herramienta o proyecto en el que se usen los datos, con su enlace o referencia.

## Operación actual

Política: `manual`. Consulta red: no.
Frecuencia declarada: anual (tabla de la Cambra). Aviso de renovación: 365 días.
Originales: `cambra`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| cambra | manual | copia-local | revision | no automático |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: clasificaciones.
Contratos y controles: lector.py:preparar, lector.py:validar, plataforma_datos/orquestacion/admision.py:exigir_admitido.

Retirada: Se conserva la admisión del conjunto y sus guardas actuales. Un fallo o una ausencia de captura no se convierte en retirada de entidades ni en disponibilidad confirmada.

Conservación: Originales, procedencias, preparados y validaciones conservan sus casas actuales en var/actualizacion. Esta ficha no habilita limpieza automática ni cambia fechas históricas, periodos, licencias o retención.

## Reproducción

```sh
python -m plataforma_datos.ia_y_trabajo.fuentes.cambra.lector preparar
python -m plataforma_datos.ia_y_trabajo.fuentes.cambra.lector validar
python -m plataforma_datos.contratos.fuentes --fuente cambra --tema ia_y_trabajo --comprobar
```
