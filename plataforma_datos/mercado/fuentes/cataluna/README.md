# Contexto por ocupación en Cataluña: Censo 2021 y contratación

Generado de `fuente.json`; editar el descriptor y regenerar.

Personas ocupadas, sexo y edad del Censo 2021 y personas contratadas en doce meses; son cifras del grupo ocupacional, no atributos de quien consulta.

ID: `cataluna` · tema: `mercado` · institución: INE; Observatori del Treball i Model Productiu.
Lector estático: `plataforma_datos.mercado.fuentes.cataluna.lector`. Casa de datos: `cataluna`.

## Alcance

- CNO-11 a dos/tres cifras para censo y cuatro para contratación; contraste con clasificaciones y Cambra.
- Periodo contractual obtenido de los ficheros vigentes, no escrito a mano; no confundir personas contratadas con contratos.
- Tres ficheros del visor se consultan en un mismo corte; los cuatro originales censales de 2021 se conservan.

## Recursos y condiciones de uso

- `censo2021` (familia): Cuatro originales censales fijos a dos/tres cifras; no se rejuvenecen con la contratación.
  Ubicación: var/actualizacion/originales/cataluna/. Licencia: Creative Commons Reconocimiento 4.0 (CC BY 4.0), según el aviso legal del INE (https://www.ine.es/dyngs/AYU/index.htm?cid=125): citar la fuente («Elaboración propia con datos extraídos del sitio web del INE: www.ine.es»), mencionar la fecha de la última actualización y no sugerir que el INE participa, patrocina o apoya la reutilización.
- `visor` (familia): C_P1_IND_PRINCIPALS_TOT_CAT, C_P2_MES_IND y C_P3_PC1_SEXE del mismo periodo.
  Ubicación: https://treballperocupacions.observatoritreball.gencat.cat/treballperocupacions/assets/datas. Licencia: Aviso legal del propio visor «Treball per ocupacions» (pie de la página, texto global.pie.texto de assets/i18n/cat.json; consultado el 07/10/2026): reutilización de los contenidos y los datos citando la fuente y la fecha de actualización, sin desnaturalizar la información (art. 17.1 de la Ley 19/2014 y art. 8 de la Ley 37/2007); los ficheros de datos no declaran licencia específica. Es el régimen de la Llicència oberta d'ús d'informació – Catalunya del aviso legal de la Generalitat (https://tramits.gencat.cat/ca/ajuda/avis_legal/).

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `visor` (remoto): Captura las tres tablas vigentes; la fecha editorial puede seguir desconocida.
  Recursos: visor. Autenticación: No se configura autenticación de cuenta en el lector.
  - Ficheros del visor, no una API documentada; no publica calendario de actualización.
  - Exige mismo periodo y cobertura; un fallo o cambio metodológico no equivale a retirada.
- `censo` (local): Originales de 2021 conservados.
  Recursos: censo2021. Autenticación: No aplicable al procesamiento local; no acredita acceso remoto ni una cuenta configurada.
  - Censo fijo admitido, huellas y contrastes; no se vuelve a consultar automáticamente.

## Operación actual

Política: `mensual`. Consulta red: sí.
Frecuencia declarada: trimestral (Observatori del Treball); Censo 2021 fijo. Aviso de renovación: no definido días.
Originales: `cataluna`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| cataluna | cambiante | catalogo-actual | descargar | 30 |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: clasificaciones, cambra.
Contratos y controles: lector.py:validar.

Retirada: Se mantienen los controles de admisión y reconstrucción del lector; un fallo de consulta o una lectura parcial no autoriza una retirada ni una cifra cero.

Conservación: Las rutas, originales, procedencias y revisiones actuales en var/actualizacion se conservan; este descriptor no activa limpieza automática ni fija nuevos plazos de retención.

## Reproducción

```sh
python -m plataforma_datos.mercado.fuentes.cataluna.lector preparar
python -m plataforma_datos.mercado.fuentes.cataluna.lector validar
python -m plataforma_datos.contratos.fuentes --fuente cataluna --tema mercado --comprobar
```
