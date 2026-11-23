# Hechos editoriales del informe laboral

Generado de `fuente.json`; editar el descriptor y regenerar.

Afirmaciones generales del informe: resultado de ensayo, proporción de anuncios, previsión de publicación y aplicación normativa, cada una con significado y procedencia propios.

ID: `hechos_informe` · tema: `ia_y_trabajo` · institución: no declarada.
Lector estático: `plataforma_datos.ia_y_trabajo.fuentes.hechos_informe.lector`. Casa de datos: `hechos_informe`.

## Alcance

- Registro editorial versionado en registro.json; el adaptador TypeScript consume directamente las cuatro afirmaciones y comprueba su contrato y procedencia.
- Revisión editorial explícita cada siete días como decisión local, no frecuencia de las fuentes. La fecha declarada no se renueva al validar; comprobar estructura no acredita revisión humana ni acceso remoto nuevos.
- Conserva 20,6 %, 1,6 horas, 13 %, 11/11/2026 como fecha de la TIC-H del año 2026, publicada según el calendario del INE capturado el 15/11/2026 (su evento ya trae los valores publicados; el calendario llega al 30/12/2026 y no trae fecha para la del año 2027; los datos detallados los acredita la observación del catálogo de la fuente `tich`) y 02/12/2027 como aplicación de la parte de alto riesgo declarada. No infiere una capacidad personal ni cobertura de todo el Reglamento.
- La revisión vencida abre un aviso, no invalida estadísticas de su periodo ni bloquea su construcción. La revisión de una captura y su fecha de obtención remota son hechos distintos; una fecha de captura desconocida permanece nula.

## Recursos y condiciones de uso

- `registro` (archivo): Cuatro afirmaciones revisadas con URL primaria, localizador, significado, periodo y huella de captura.
  Ubicación: plataforma_datos/ia_y_trabajo/fuentes/hechos_informe/registro.json. Licencia: Registro editorial de hechos y referencias; no redistribuye las publicaciones ni sus capturas.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `revision-editorial` (editorial): Comprobación local del contrato TS y del plazo declarado; las revisiones remotas se realizan explícitamente por una persona antes de actualizar el registro.
  Recursos: registro. Autenticación: Ninguna; lectura local del registro versionado.
  - No hay descargador ni rastreo automático.
  - Las capturas primarias completas se conservan como evidencia externa y no se sirven desde este registro.
  - Validar no consulta fuentes, no transforma previsiones en publicaciones y no renueva revisión.

## Operación actual

Política: `redactada`. Consulta red: no.
Frecuencia declarada: revisión editorial explícita cada siete días; no actualización remota autónoma. Aviso de renovación: 7 días.
Sin carpeta de originales declarada.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| hechos_informe | editorial | copia-local | revision | no automático |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: ninguna declarada.
Contratos y controles: registro.json:revision y afirmaciones, src/dominio/registro-hechos-del-informe.ts:leerHechosDelInforme, herramientas/web/comprobar-hechos-informe.ts:comprobarHechosDelInforme, src/dominio/hechos-del-informe-breve.ts:adaptador, lector.py:validar.

Retirada: Un error de comprobación conserva la última admisión; no elimina cifras ni inventa una nueva edición. Cambiar una afirmación exige revisión editorial explícita y nueva evidencia.

Conservación: Registro y procedencia por afirmación versionados en git; la casa operativa guarda admisión estructural, no una fecha de consulta remota. No se cambia la fecha de revisión al validar, ni se descargan originales o limpian datos.

## Reproducción

```sh
python -m plataforma_datos.ia_y_trabajo.fuentes.hechos_informe.lector validar
python -m plataforma_datos.contratos.fuentes --fuente hechos_informe --tema ia_y_trabajo --comprobar
```
