# Uso empresarial de IA, plantilla y formación TIC: ETICCE y Eurostat

Generado de `fuente.json`; editar el descriptor y regenerar.

Uso de IA por actividad, tamaño y territorio en las empresas; conserva las definiciones y denominadores de ETICCE/Eurostat y no calcula una probabilidad de uso individual. Las tablas de especialistas y formación TIC conservan cada medida y sus bases de empresas o personal por separado; formación TIC no equivale a formación en IA.

ID: `empresas` · tema: `mercado` · institución: INE; Eurostat.
Lector estático: `plataforma_datos.mercado.fuentes.empresas.lector`. Casa de datos: `empresas`.

## Alcance

- Descubre edición ETICCE en índice y cuatro capítulos; conserva sectores, comunidades, menos de diez personas y errores de muestreo.
- Edición revisada desde 2026 con CNAE-2025 y denominador admitido por contrato; no reparte o convierte categorías por parecido.
- Eurostat conserva periodo propio, marcas y ventana regional; la continuidad de originales previos requiere prueba explícita y no acredita una descarga fresca ni rejuvenece su fecha.
- En los mismos capítulos de actividad y comunidades descubre las tablas Especialistas TIC; el contrato revisado de 2026 admite 82386/82408 y conserva las 5.304 series sin fusionar códigos de cuestionario.
- Las variables con 2025 explícito mantienen ese año. I.1/I.1.1 sin año conservan el periodo compuesto literal 2025 o primer trimestre de 2026; no representan una observación anual o trimestral única.
- El bloque plantilla_tic se añade al conjunto validado de empresas; no tiene exportación ni consumidor en el informe o motores.

## Recursos y condiciones de uso

- `ine-eticce` (familia): Índice, cuatro capítulos, tablas IA y especialistas TIC y sus notas del INE.
  Ubicación: https://www.ine.es/dyngs/INEbase/es/operacion.htm?c=Estadistica_C&cid=1254736176743&menu=resultados&idp=1254735576692. Licencia: Creative Commons Reconocimiento 4.0 (CC BY 4.0), según el aviso legal del INE (https://www.ine.es/dyngs/AYU/index.htm?cid=125): citar la fuente («Elaboración propia con datos extraídos del sitio web del INE: www.ine.es»), mencionar la fecha de la última actualización y no sugerir que el INE participa, patrocina o apoya la reutilización.
- `eurostat` (familia): isoc_eb_ain2 España e isoc_r_eb_ain2 Cataluña, con marcas y definición conservadas.
  Ubicación: https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data. Licencia: Aviso de copyright de Eurostat (https://ec.europa.eu/eurostat/help/copyright-notice, consultado el 06/10/2026), que aplica la Decisión 2011/833/UE de la Comisión: reutilización autorizada, también comercial, citando la fuente; una versión filtrada se cita con el enlace del conjunto y la fecha de consulta.
- `calendario-ine` (url): Calendario de publicaciones del INE (iCalendar): da la fecha de publicación de cada edición de la encuesta y, si ya la trae, la de la siguiente; se captura con los demás originales.
  Ubicación: https://www.ine.es/dynt3/Calendario/calendario.ics. Licencia: Creative Commons Reconocimiento 4.0 (CC BY 4.0), según el aviso legal del INE (https://www.ine.es/dyngs/AYU/index.htm?cid=125): citar la fuente («Elaboración propia con datos extraídos del sitio web del INE: www.ine.es»), mencionar la fecha de la última actualización y no sugerir que el INE participa, patrocina o apoya la reutilización.
- `contratos` (familia): empresas-eticce2026.json y empresas-cnae2025.json; rutas y SHA contractuales permanecen actuales.
  Ubicación: plataforma_datos/mercado/fuentes/empresas/contratos/. Licencia: desconocida; no acreditada por este descriptor.
- `contrato-plantilla-tic` (archivo): Firma, literales, bases y periodos revisados de plantilla TIC; sus bytes se vinculan por SHA cuando se admite ese bloque.
  Ubicación: plataforma_datos/mercado/fuentes/empresas/piezas/plantilla-tic2026.json. Licencia: desconocida; no acreditada por este descriptor.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `oficial` (remoto): HTML de descubrimiento y API estadísticas, sin cuentas configuradas por el lector.
  Recursos: ine-eticce, eurostat, calendario-ine. Autenticación: No se configura autenticación de cuenta en el lector.
  - Vincula índice, capítulos, tablas y notas INE y recursos Eurostat según el contrato aplicable, con edición, definición y periodos comprobados.
  - El permiso de sustituir bytes no autoriza cambiar metodología; la continuidad Eurostat conserva su periodo y su procedencia histórica, con contraste declarado pendiente cuando corresponde.
- `contratos` (local): Admisión contractual CNAE-2025 y ETICCE.
  Recursos: contratos, contrato-plantilla-tic. Autenticación: No aplicable al procesamiento local; no acredita acceso remoto ni una cuenta configurada.
  - Los dos contratos históricos se leen y vinculan por SHA durante validación. La ampliación plantilla_tic exige además el tercer recurso, leído una sola vez y comprobado otra vez al admitir.

## Operación actual

Política: `mensual`. Consulta red: sí.
Frecuencia declarada: anual (ETICCE del INE y Eurostat). Aviso de renovación: no definido días.
Originales: `empresas`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| empresas | cambiante | descubre-edicion | descargar | 30 |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: sectores.
Contratos y controles: lector.py:validar, plataforma_datos/mercado/fuentes/empresas/contratos/empresas-eticce2026.json, plataforma_datos/mercado/fuentes/empresas/contratos/empresas-cnae2025.json, plataforma_datos/mercado/fuentes/empresas/piezas/plantilla-tic2026.json.

Retirada: Se mantienen los controles de admisión y reconstrucción del lector; un fallo de consulta o una lectura parcial no autoriza una retirada ni una cifra cero.

Conservación: Las rutas, originales, procedencias y revisiones actuales en var/actualizacion se conservan; este descriptor no activa limpieza automática ni fija nuevos plazos de retención.

## Reproducción

```sh
python -m plataforma_datos.mercado.fuentes.empresas.lector preparar
python -m plataforma_datos.mercado.fuentes.empresas.lector validar
python -m plataforma_datos.contratos.fuentes --fuente empresas --tema mercado --comprobar
```
