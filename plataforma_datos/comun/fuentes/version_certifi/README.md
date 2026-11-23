# Última versión publicada de certifi

Generado de `fuente.json`; editar el descriptor y regenerar.

La última versión publicada del almacén de certificados raíz certifi, frente a la fijada en plataforma_datos/comun/confianza_tls.py; no renueva nada.

ID: `version_certifi` · tema: `comun` · institución: Python Package Index (PyPI).
Lector estático: `plataforma_datos.comun.fuentes.version_certifi.lector`. Casa de datos: `version_certifi`.

## Alcance

- Lee info.version del índice JSON de PyPI del paquete certifi y la compara con CERTIFI_VERSION.
- Si son distintas, el conjunto validado lleva un aviso con forma cerrada (clave, fijada, publicada, consultado y texto en castellano y catalán) para el panel.
- Renovar la confianza TLS sigue siendo una decisión con revisión: cambia código, requisitos y lock. Solo está registrada como productor candidato (PRODUCTORES_CANDIDATOS en plataforma_datos/orquestacion/modulos.py).

## Recursos y condiciones de uso

- `pypi-certifi` (url): Índice JSON público de PyPI del paquete certifi; solo se lee el número de la última versión.
  Ubicación: https://pypi.org/pypi/certifi/json. Licencia: desconocida; no acreditada por este descriptor.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `pypi` (remoto): No conectado ni activado: el aviso lo presenta el panel cuando se incorpore.
  Recursos: pypi-certifi. Autenticación: API pública sin cuenta ni clave configurada.
  - Transporte central con identidad genérica y la pausa común por dominio; una sola petición por consulta, JSON del mismo origen y un tope de 8 MB.
  - La cadencia de 30 días es una decisión operativa local, no la frecuencia de publicación de certifi.

## Operación actual

Política: `mensual`. Consulta red: sí.
Frecuencia declarada: Consulta técnica local cada 30 días; no describe un calendario de publicaciones de certifi. Aviso de renovación: 30 días.
Originales: `version_certifi`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| version_certifi | cambiante | descubre-edicion | descargar | 30 |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: ninguna declarada.
Contratos y controles: lector.py:ultima_publicada, lector.py:aviso, lector.py:validar.

Retirada: Un fallo de consulta o una respuesta que no es el índice no cambia lo validado ni el almacén fijado.

Conservación: El índice capturado y su procedencia se conservan en var/actualizacion; este descriptor no activa limpieza automática.

## Reproducción

```sh
python -m plataforma_datos.comun.fuentes.version_certifi.lector preparar
python -m plataforma_datos.comun.fuentes.version_certifi.lector validar
python -m plataforma_datos.contratos.fuentes --fuente version_certifi --tema comun --comprobar
```
