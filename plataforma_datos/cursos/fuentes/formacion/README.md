# Formación SOC, SEPE, EURES y DigComp

Generado de `fuente.json`; editar el descriptor y regenerar.

Relaciona ocupaciones ESCO con especialidades formativas y oferta SOC; conserva DigComp como marco con versión.

ID: `formacion` · tema: `cursos` · institución: SOC; SEPE; EURES; Comisión Europea (JRC).
Lector estático: `plataforma_datos.cursos.fuentes.formacion.lector`. Casa de datos: `formacion`.

## Alcance

- Captura, URL, SHA y tamaño en procedencia; no metadatos remotos de catálogo completo o actualización SOC exigidos por este canal
- Estado estat_curs y fechas publicados; no garantiza plazas

## Recursos y condiciones de uso

- `soc-oferta` (url): Oferta pública SOC; único canal de descarga automática de este productor.
  Ubicación: https://oficinadetreball.gencat.cat/opendata/recursos/ofertaCursos.json. Licencia: desconocida; no acreditada por este descriptor.
- `catalogos` (familia): EURES, SOC y originales DigComp registrados por edición; fuentes y licencias diferenciadas en procedencia.
  Ubicación: var/actualizacion/originales/formacion/. Licencia: desconocida; no acreditada por este descriptor.
- `sepe` (familia): Catálogo SEPE recibido manualmente; entrada operativa externa.
  Ubicación: var/actualizacion/originales/sepe/. Licencia: desconocida; no acreditada por este descriptor.
- `digcomp` (archivo): Marco DigComp 3.0: competencias, resultados y niveles publicados; genera el registro compartido y contrasta su revisión admitida. No atribuye niveles a personas ni cursos.
  Ubicación: var/actualizacion/originales/formacion/digcomp-3.0.jsonld. Licencia: CC BY 4.0, según la declaración conservada en el lector.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `soc-oferta` (remoto): Solo la oferta SOC se descarga automáticamente.
  Recursos: soc-oferta. Autenticación: No se configura autenticación en el lector.
  - SOC 16 MiB; JSON estricto, campos/IDs/fechas, destino final exacto; no cuota ni SLA documentado en el material leído
- `catalogos` (local): Catálogos recibidos y revisados por edición; no se descargan automáticamente.
  Recursos: catalogos, sepe, digcomp. Autenticación: No aplicable al procesamiento local; este canal no acredita condiciones de acceso remoto.
  - Catálogos conservados por edición con comprobación de huella y formatos propios de EURES, SEPE, SOC y DigComp; no hay un límite común de tamaño o una cuota declarados para este canal local.

## Operación actual

Política: `mensual`. Consulta red: sí.
Frecuencia declarada: oferta SOC diaria; catálogos por edición. Aviso de renovación: 90 días.
Originales: `formacion`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| soc-oferta | cambiante | catalogo-actual | descargar | 1 |
| formacion-catalogos | manual | copia-local | revision | no automático |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: esco.
Contratos y controles: lector.py:validar.

Retirada: Se mantienen los controles de admisión y reconstrucción del lector actual; no se declara una conciliación genérica de entidades ni se interpreta un fallo como baja.

Conservación: Se conservan las rutas, originales, procedencias y revisiones actuales en var/actualizacion; este descriptor no habilita limpieza automática ni fija nuevos plazos de retención.

## Reproducción

```sh
python -m plataforma_datos.cursos.fuentes.formacion.lector preparar
python -m plataforma_datos.cursos.fuentes.formacion.lector validar
python -m plataforma_datos.contratos.fuentes --fuente formacion --tema cursos --comprobar
```
