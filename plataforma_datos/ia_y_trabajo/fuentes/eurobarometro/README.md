# Eurobarómetro especial 554: opinión sobre IA y trabajo

Generado de `fuente.json`; editar el descriptor y regenerar.

Opinión, no medida: el Eurobarómetro especial 554 («Artificial Intelligence and the future of work», 2024).

ID: `eurobarometro` · tema: `ia_y_trabajo` · institución: Comisión Europea.
Lector estático: `plataforma_datos.ia_y_trabajo.fuentes.eurobarometro.lector`. Casa de datos: `eurobarometro`.

## Alcance

- Encuesta de opinión de la Comisión Europea (oleada 101.4, campo del 25/04 al 22/05/2024, personas de 15 años o más). No mide la exposición a la IA ni su uso: dice lo que la gente opina. Por eso va en el bloque `encuestas` del archivo de datos globales, con `naturaleza: "opinion"`, nunca entre los indicadores medidos. Se leen del volumen A (resultados por país, xlsx) las diez preguntas que publica Faro: QB5 (percepción de los robots y la IA en el trabajo, «Total 'Positively'»), QB6.1, QB6.2 y QB6.3 (afirmaciones sobre los robots y la IA, «Total 'Agree'»), QB11.1 a QB11.5 (importancia de cada regla para la IA en el trabajo, «Total 'Important'») y QB3 (el empleador da herramientas o formación, «Total 'Agree'», solo quienes trabajan para un empleador), en la UE-27, España, Alemania, Francia e Italia, como porcentajes enteros, como los publica el Eurobarómetro. El texto literal de cada pregunta, su base y su campo se vigilan. El xlsx se lee con la biblioteca estándar (zip y XML). Python estándar.

## Recursos y condiciones de uso

- `recurso-01` (url): Eurobarómetro especial 554, volumen A (resultados por país), xlsx
  Ubicación: https://webgate.ec.europa.eu/ebsm/api/public/odp/download?key=C94326A822DF47FB19DF4F6700A24CE1. Licencia: Política de reutilización de la Comisión Europea (Decisión 2011/833/UE): reutilización autorizada, también comercial, citando la fuente (© Unión Europea, Eurobarómetro especial 554).

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `consulta` (remoto): Descarga soportada del volumen A XLSX de la edición conocida. El plan operativo actual comprueba integridad histórica, sin consulta remota periódica concedida.
  Recursos: recurso-01. Autenticación: El lector no configura credenciales de autenticación para estos recursos públicos; no acredita acceso a otros servicios.
  - Cuotas y límites oficiales de servicio no acreditados por este descriptor; rigen los límites de transporte y validación del lector.
  - Este descriptor no acredita la disponibilidad remota actual; una URL conservada no acredita consulta satisfactoria ni una tarea instalada.
  - La comprobación del recurso conocido no acredita una revisión general de ediciones o disposiciones posteriores.
  - Opinión con su pregunta y base, no adopción ni exposición medida; se conserva el año y el trabajo de campo publicados.

## Operación actual

Política: `fija`. Consulta red: sí.
Frecuencia declarada: cerrada (Eurobarómetro especial 554, 2024). Aviso de renovación: no definido días.
Originales: `eurobarometro`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| eurobarometro | historica | edicion-conocida | integridad | no automático |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: ninguna declarada.
Contratos y controles: lector.py:preparar, lector.py:validar, plataforma_datos/orquestacion/admision.py:exigir_admitido.

Retirada: Se conserva la admisión del conjunto y sus guardas actuales. Un fallo o una ausencia de captura no se convierte en retirada de entidades ni en disponibilidad confirmada.

Conservación: Originales, procedencias, preparados y validaciones conservan sus casas actuales en var/actualizacion. Esta ficha no habilita limpieza automática ni cambia fechas históricas, periodos, licencias o retención.

## Reproducción

```sh
python -m plataforma_datos.ia_y_trabajo.fuentes.eurobarometro.lector preparar
python -m plataforma_datos.ia_y_trabajo.fuentes.eurobarometro.lector validar
python -m plataforma_datos.contratos.fuentes --fuente eurobarometro --tema ia_y_trabajo --comprobar
```
