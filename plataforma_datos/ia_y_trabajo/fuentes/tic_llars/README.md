# Idescat: IA generativa en Cataluña, TIC de los hogares

Generado de `fuente.json`; editar el descriptor y regenerar.

El uso de la IA generativa en Cataluña: Idescat, Enquesta TIC a les llars 2025 (tablas 3.4.1 y 3.4.2).

ID: `tic_llars` · tema: `ia_y_trabajo` · institución: Idescat, a partir de la encuesta TIC-H del INE.
Lector estático: `plataforma_datos.ia_y_trabajo.fuentes.tic_llars.lector`. Casa de datos: `tic-llars`.

## Alcance

- El Idescat tabula para Cataluña la TIC-H del INE, que es la encuesta europea del uso de las TIC en los hogares: sus cifras se comparan con las de Eurostat en la misma base, las personas de 16 a 74 años que usaron internet en los tres meses anteriores (`isoc_ai_iaiu`, unidad `PC_IND_IU3`), nunca con las de toda la población (`PC_IND`). Se guardan, literales: el uso de alguna herramienta de IA generativa y el uso para el trabajo, en total y por sexo (3.4.1), y, entre quienes no la usan, quienes no saben cómo (3.4.2); y, de la segunda tabla de cada página, lo mismo por ocupación principal. La metodología de la encuesta define «treballador manual» como los grandes grupos 6 a 9 de la CNO-94 y «no manual» como los grupos 0 y 1 a 5: la misma división que los grupos ISCO 6–9 y 0–5 de Eurostat, así que el uso para trabajar de unos y otros es la cifra de Cataluña de esos indicadores en su base de usuarios de internet, y se contrasta con el cálculo de Faro con los microdatos de la TIC-H (`tich`). «Treballador TIC» es una lista propia de grupos primarios de la CNO-94, no la de Eurostat: va en su propio indicador, solo de Cataluña, como quienes no saben usarla por ocupación. Esa misma división hace que el motivo «no sabe cómo» de manuales y no manuales sea la línea del informe para la clase de la ocupación de la persona (`motivos_no_uso`, que exportar_paquete añade a tich.json con su procedencia): la validación comprueba que la clase de cada grupo ISCO-08 de 2 cifras en `tich` es la del Idescat. Las tablas no se publican en `f=ssv`: se leen de su HTML, y cada cifra se busca por el texto de su fila y de su columna. Python estándar.
- El conjunto validado declara si se contrastó con el cálculo de Faro (`contraste_con_la_tich`: «misma-edicion») o si se validó sin contraste por ser otra edición de la TIC-H («edicion-distinta»); en ese caso el panel lo avisa en la fila de la fuente (`avisoEdicion`: «sin-contraste-con-la-tich»).
- Con la misma edición de la TIC-H, «no sabía cómo» de cada clase debe caer dentro del intervalo del 95 % del cálculo de Faro con los microdatos (`contraste_no_sabe_como` de la validación de `tich`, con dos entrevistas o más): el Idescat explota los mismos microdatos públicos del INE y su factor, y con los de 2025 el cálculo da las mismas cifras (45,8 % y 33,5 %, con 120 y 234 entrevistas). La descripción de `IAG_NO3` en el diseño de registro tiene que decir, tras los dos puntos y sin contar mayúsculas, espacios, forma Unicode ni puntuación final, «no sabía cómo utilizarlas»; si no, el contraste se detiene. Sin cálculo, o sin nadie en la base, no hay contraste: el conjunto lo declara (`contraste_con_la_tich`: «motivo-sin-calculo») y el panel lo avisa, sin detener la fuente. La prueba de lectura usa las dos páginas reales de 2025 conservadas en las pruebas, con su huella.

## Recursos y condiciones de uso

- `recurso-01` (url): Idescat, Enquesta sobre equipament i ús de TIC a les llars 2025, taula 3.4.1 (IA generativa)
  Ubicación: https://www.idescat.cat/pub/?id=ticll25&n=3.4.1&lang=es. Licencia: Aviso legal del Idescat (https://www.idescat.cat/institut/web/?lang=es) y condiciones de uso de sus API (https://www.idescat.cat/dev/api/?lang=es): reutilización permitida citando la fuente («Fuente: elaboración propia a partir de datos del Idescat») con la fecha de la última actualización, enlazando con idescat.cat, sin modificar los datos al presentarlos y sin sugerir que el Idescat apoya el uso.
- `recurso-02` (url): Idescat, Enquesta sobre equipament i ús de TIC a les llars 2025, taula 3.4.2 (IA generativa)
  Ubicación: https://www.idescat.cat/pub/?id=ticll25&n=3.4.2&lang=es. Licencia: Aviso legal del Idescat (https://www.idescat.cat/institut/web/?lang=es) y condiciones de uso de sus API (https://www.idescat.cat/dev/api/?lang=es): reutilización permitida citando la fuente («Fuente: elaboración propia a partir de datos del Idescat») con la fecha de la última actualización, enlazando con idescat.cat, sin modificar los datos al presentarlos y sin sugerir que el Idescat apoya el uso.
- `recurso-03` (url): Idescat, Encuesta sobre equipamiento y uso de TIC en los hogares, años disponibles
  Ubicación: https://www.idescat.cat/estad/ticl?lang=es. Licencia: Aviso legal del Idescat (https://www.idescat.cat/institut/web/?lang=es) y condiciones de uso de sus API (https://www.idescat.cat/dev/api/?lang=es): reutilización permitida citando la fuente («Fuente: elaboración propia a partir de datos del Idescat») con la fecha de la última actualización, enlazando con idescat.cat, sin modificar los datos al presentarlos y sin sugerir que el Idescat apoya el uso.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `consulta` (remoto): Tablas HTML oficiales del Idescat, con descubrimiento de edición y lectura de celdas y notas concretas; no se declara una API distinta de la realmente usada.
  Recursos: recurso-01, recurso-02, recurso-03. Autenticación: El lector no configura credenciales de autenticación para estos recursos públicos; no acredita acceso a otros servicios.
  - Cuotas y límites oficiales de servicio no acreditados por este descriptor; rigen los límites de transporte y validación del lector.
  - Este descriptor no acredita la disponibilidad remota actual; una URL conservada no acredita consulta satisfactoria ni una tarea instalada.

## Operación actual

Política: `edición`. Consulta red: sí.
Frecuencia declarada: anual (Idescat, a partir de la TIC-H del INE). Aviso de renovación: no definido días.
Originales: `tic-llars`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| tic_llars | cambiante | descubre-edicion | descargar | 30 |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: tich.
Contratos y controles: lector.py:preparar, lector.py:validar, plataforma_datos/orquestacion/admision.py:exigir_admitido.

Retirada: Se conserva la admisión del conjunto y sus guardas actuales. Un fallo o una ausencia de captura no se convierte en retirada de entidades ni en disponibilidad confirmada.

Conservación: Originales, procedencias, preparados y validaciones conservan sus casas actuales en var/actualizacion. Esta ficha no habilita limpieza automática ni cambia fechas históricas, periodos, licencias o retención.

## Reproducción

```sh
python -m plataforma_datos.ia_y_trabajo.fuentes.tic_llars.lector preparar
python -m plataforma_datos.ia_y_trabajo.fuentes.tic_llars.lector validar
python -m plataforma_datos.contratos.fuentes --fuente tic_llars --tema ia_y_trabajo --comprobar
```
