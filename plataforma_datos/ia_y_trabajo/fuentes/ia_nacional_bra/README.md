# Brasil: uso de IA en empresas, medida nacional

Generado de `fuente.json`; editar el descriptor y regenerar.

Uso de la IA por las empresas de Brasil (Cetic.br/NIC.br, TIC Empresas 2025, tabla H9): su propio módulo.

ID: `ia_nacional_bra` · tema: `ia_y_trabajo` · institución: Cetic.br / NIC.br.
Lector estático: `plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_bra.lector`. Casa de datos: `ia-nacional-bra`.

## Alcance

- Cetic.br, del Núcleo de Informação e Coordenação do Ponto BR (NIC.br), pregunta en TIC Empresas si la empresa usó alguna tecnología de IA, con la lista de siete tecnologías que usó la encuesta europea hasta 2024. Universo: empresas activas de 10 o más personas ocupadas. La pregunta solo se hizo a las empresas con especialistas, área o departamento de TI, y el resultado se da sobre el total de empresas: la cifra es un mínimo. Se lee la fila «TOTAL», columna «Sim», de la página de la tabla H9, y se comprueban literales su título, su base y su nota al pie. Python estándar.

## Recursos y condiciones de uso

- `recurso-01` (url): Cetic.br/NIC.br, TIC Empresas 2025, tabla H9: empresas que usaron tecnologías de IA (HTML)
  Ubicación: https://cetic.br/en/tics/pesquisa/2025/empresas/H9/. Licencia: Creative Commons Atribuição-CompartilhaIgual 4.0 Internacional (CC BY-SA 4.0, https://creativecommons.org/licenses/by-sa/4.0/): se cita a Cetic.br/NIC.br; la cifra se toma sin cambios y lo que se adapte de esta tabla se comparte con la misma licencia.
- `recurso-02` (url): Cetic.br, TIC Empresas, ediciones disponibles
  Ubicación: https://cetic.br/en/pesquisa/empresas/indicadores/. Licencia: Creative Commons Atribuição-CompartilhaIgual 4.0 Internacional (CC BY-SA 4.0, https://creativecommons.org/licenses/by-sa/4.0/): se cita a Cetic.br/NIC.br; la cifra se toma sin cambios y lo que se adapte de esta tabla se comparte con la misma licencia.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `consulta` (remoto): Catálogo de ediciones y tabla HTML H9 del portal oficial Cetic.br. El lector contrasta título, base y nota de la tabla, sin convertir el mínimo en tasa comparable europea.
  Recursos: recurso-01, recurso-02. Autenticación: El lector no configura credenciales de autenticación para estos recursos públicos; no acredita acceso a otros servicios.
  - Cuotas y límites oficiales de servicio no acreditados por este descriptor; rigen los límites de transporte y validación del lector.
  - Este descriptor no acredita la disponibilidad remota actual; una URL conservada no acredita consulta satisfactoria ni una tarea instalada.
  - Medida nacional con su universo, pregunta, periodo y licencia propios; el contrato la declara no comparable entre países ni con Eurostat.

## Operación actual

Política: `edición`. Consulta red: sí.
Frecuencia declarada: anual (TIC Empresas de Cetic.br). Aviso de renovación: no definido días.
Originales: `ia-nacional-bra`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| ia_nacional_bra | cambiante | descubre-edicion | descargar | 30 |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: ninguna declarada.
Contratos y controles: lector.py:preparar, lector.py:validar, plataforma_datos/orquestacion/admision.py:exigir_admitido.

Retirada: Se conserva la admisión del conjunto y sus guardas actuales. Un fallo o una ausencia de captura no se convierte en retirada de entidades ni en disponibilidad confirmada.

Conservación: Originales, procedencias, preparados y validaciones conservan sus casas actuales en var/actualizacion. Esta ficha no habilita limpieza automática ni cambia fechas históricas, periodos, licencias o retención.

## Reproducción

```sh
python -m plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_bra.lector preparar
python -m plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_bra.lector validar
python -m plataforma_datos.contratos.fuentes --fuente ia_nacional_bra --tema ia_y_trabajo --comprobar
```
