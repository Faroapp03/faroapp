# Versiones publicadas de Chrome Windows estable

Generado de `fuente.json`; editar el descriptor y regenerar.

Metadatos de publicaciones activas de Chrome Windows estable para proponer un perfil reducido; no mide navegadores instalados.

ID: `versiones_navegadores` · tema: `comun` · institución: Google Chrome.
Lector estático: `plataforma_datos.comun.fuentes.versiones_navegadores.lector`. Casa de datos: `versiones_navegadores`.

## Alcance

- Solo Chrome, plataforma win y canal stable de VersionHistory. Edge y otros productos necesitan publicaciones independientes.
- Selecciona la mayor versión numérica con fraction positiva y ventana serving vigente a la recepción. Deduplica versiones entre grupos de rollout; fraction positiva no acredita disponibilidad universal.
- Conserva versión completa, inicio de publicación, fecha real de cada recepción y perfil major.0.0.0 con pistas major. Una nueva recepción puede reevaluar serving aunque el cuerpo no cambie. No escribe curlrc ni activa el perfil. Solo está registrada como productor candidato (PRODUCTORES_CANDIDATOS en plataforma_datos/orquestacion/modulos.py): ninguna actualización automática la descarga, y VERSION_CHROME de plataforma_datos/comun/perfil_web.py se cambia a mano con la versión admitida a la vista.
- La captura histórica aportada sin recibo verificable solo sirve de fixture estructural. No se admite como consulta nueva.

## Recursos y condiciones de uso

- `chrome-stable-win` (url): API pública VersionHistory: publicaciones Chrome Windows stable sin endtime, ordenadas por versión descendente. Licencia de respuesta no acreditada en este tramo.
  Ubicación: https://versionhistory.googleapis.com/v1/chrome/platforms/win/channels/stable/versions/all/releases?filter=endtime=none&order_by=version%20desc. Licencia: desconocida; no acreditada por este descriptor.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `versionhistory` (remoto): No conectado ni activado. Las futuras adquisiciones generan procedencia y recepción remota mediante las interfaces comunes. No se deduce Edge de Chrome.
  Recursos: chrome-stable-win. Autenticación: API pública sin cuenta ni clave configurada.
  - Transporte central, identidad genérica configurada y pausas por dominio; ninguna red nueva durante implementación.
  - Captura máxima de 2 MiB y 10000 releases al interpretar. Respuesta paginada se rechaza como incompleta; no se supone completa la primera página.
  - Cuotas remotas no acreditadas; la cadencia mensual es decisión operativa local, no frecuencia de publicación de Google.

## Operación actual

Política: `mensual`. Consulta red: sí.
Frecuencia declarada: Consulta técnica local cada 30 días; no describe calendario de publicaciones de Google. Aviso de renovación: 30 días.
Originales: `versiones_navegadores`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| versiones_navegadores | cambiante | descubre-edicion | descargar | 30 |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: ninguna declarada.
Contratos y controles: lector.py:seleccionar, lector.py:validar, lector.py:admitido, ../../perfil_web.py:perfil_chrome, procedencia.json:v2 enumera cuerpos y observaciones; observaciones/*.json:v1 conserva recepción completa inmutable.

Retirada: Un error, respuesta incompleta, publicación futura o retroceso no sustituye la última admisión. Una reversión requiere revisión explícita fuera de este flujo automático.

Conservación: Cuerpos chrome-SHA.json deduplicados; observaciones/chrome-SHA.json identifica por huella los metadatos completos disponibles de cada recepción, incluida su fecha real, URL y destino, MIME, tamaño y huella del cuerpo. Procedencia v2 enumera ambos con tipo, bytes y SHA; cada observación v1 contiene version y recepcion. Repetir exactamente esa captura conserva fecha/bytes/mtime; una consulta posterior conserva una observación nueva sin alterar la anterior ni la fecha de publicación. Rechazos por destino o MIME no sustituyen la entrada referenciada por la última buena. El formato experimental previo nunca activado se rechaza sin migración silenciosa ni borrado: requiere adquisición explícita en una instalación nueva. Reutilización comprueba observación, cuerpo, conjunto y firmas de lector, descriptor y generador. La CLI prepara conjunto e informe con su SHA antes de promover la carpeta mediante el mecanismo común de sustitución y recuperación. Ante excepciones observadas intenta restaurar ambos; si la recuperación falla informa las rutas y conserva área, diario y respaldos. No garantiza lectura concurrente atómica ni atomicidad ante muerte abrupta; un respaldo pendiente exige revisión antes de otra admisión. Tras un cambio de código o descriptor, admitido() exige firmas vigentes. Preparar y validar permiten revalidar explícitamente una anterior íntegra con firmas antiguas bien formadas solo si todos los demás campos siguen siendo reproducibles; no renuevan la captura remota. Un cambio semántico incompatible, alteración, retroceso o fecha anterior sigue pendiente/rechazado.

## Reproducción

```sh
python -m plataforma_datos.comun.fuentes.versiones_navegadores.lector preparar
python -m plataforma_datos.comun.fuentes.versiones_navegadores.lector validar
python -m plataforma_datos.contratos.fuentes --fuente versiones_navegadores --tema comun --comprobar
```
