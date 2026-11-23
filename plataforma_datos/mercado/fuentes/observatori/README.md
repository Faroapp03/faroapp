# Observatori: comarcas, series y demanda por ocupación

Generado de `fuente.json`; editar el descriptor y regenerar.

Contratos, personas contratadas y demandantes por ocupación del visor Treball per ocupacions; distingue sus unidades y deriva provincias desde comarcas con correspondencia versionada.

ID: `observatori` · tema: `mercado` · institución: Observatori del Treball i Model Productiu; Idescat.
Lector estático: `plataforma_datos.mercado.fuentes.observatori.lector`. Casa de datos: `observatori`.

## Alcance

- CNO-11 a cuatro cifras; comarca, total catalán y series de trece/cuarenta y nueve meses según indicador.
- Demanda puede contar a una persona en varias ocupaciones; DONO no se declara idéntico al paro EPA.
- Mismo corte que cataluna; metodología textual debe conservar subárbol registrado, sin retirar datos por fallo o lectura parcial.

## Recursos y condiciones de uso

- `visor` (familia): Cinco tablas complementarias y textos metodológicos assets/i18n/cat.json; comparte C_P2_MES_IND ya conservada por cataluna.
  Ubicación: https://treballperocupacions.observatoritreball.gencat.cat/treballperocupacions/assets/datas. Licencia: Aviso legal del propio visor «Treball per ocupacions» (pie de la página, texto global.pie.texto de assets/i18n/cat.json; consultado el 07/10/2026): reutilización de los contenidos y los datos citando la fuente y la fecha de actualización, sin desnaturalizar la información (art. 17.1 de la Ley 19/2014 y art. 8 de la Ley 37/2007); los ficheros de datos no declaran licencia específica. Es el régimen de la Llicència oberta d'ús d'informació – Catalunya del aviso legal de la Generalitat (https://tramits.gencat.cat/ca/ajuda/avis_legal/).
- `comarca-provincia` (archivo): Tabla versionada a mano a partir de los códigos territoriales y el padrón (EMEX) del Idescat, que preparar y validar leen como entrada adicional; conserva URL, fecha, huella y la cita de la fuente.
  Ubicación: var/actualizacion/preparados/observatori/comarca-provincia.json. Licencia: Aviso legal del Idescat (https://www.idescat.cat/institut/web/?lang=es) y condiciones de uso de sus API (https://www.idescat.cat/dev/api/?lang=es): reutilización permitida citando la fuente («Fuente: elaboración propia a partir de datos del Idescat») con la fecha de la última actualización, enlazando con idescat.cat, sin modificar los datos al presentarlos y sin sugerir que el Idescat apoya el uso.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `visor` (remoto): Captura acotada del visor, sin duplicar el productor cataluna.
  Recursos: visor. Autenticación: No se configura autenticación de cuenta en el lector.
  - Ficheros de visor, no API documentada; las tablas deben tener el periodo de cataluna.
  - Respeta bases mínimas y metodología; no lee el portal institucional prohibido en este lector.
- `correspondencia` (local): Derivación provincial declarada, no desglose publicado directamente por el Observatori.
  Recursos: comarca-provincia. Autenticación: No aplicable al procesamiento local; no acredita acceso remoto ni una cuenta configurada.
  - Provincia de mayoría de municipios; se conserva la tabla y su procedencia.

## Operación actual

Política: `mensual`. Consulta red: sí.
Frecuencia declarada: trimestral (Observatori del Treball). Aviso de renovación: no definido días.
Originales: `observatori`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| observatori | cambiante | catalogo-actual | descargar | 30 |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: clasificaciones, cataluna.
Contratos y controles: lector.py:validar.

Retirada: Se mantienen los controles de admisión y reconstrucción del lector; un fallo de consulta o una lectura parcial no autoriza una retirada ni una cifra cero.

Conservación: Las rutas, originales, procedencias y revisiones actuales en var/actualizacion se conservan; este descriptor no activa limpieza automática ni fija nuevos plazos de retención.

## Reproducción

```sh
python -m plataforma_datos.mercado.fuentes.observatori.lector preparar
python -m plataforma_datos.mercado.fuentes.observatori.lector validar
python -m plataforma_datos.contratos.fuentes --fuente observatori --tema mercado --comprobar
```
