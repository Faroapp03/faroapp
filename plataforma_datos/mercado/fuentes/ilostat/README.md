# ILOSTAT: empleo por ocupación y país

Generado de `fuente.json`; editar el descriptor y regenerar.

Empleo medido por gran grupo ISCO-08 y sexo, en miles, del último año de encuesta de fuerza de trabajo de cada país; no estima exposición a IA ni usa empleo modelado.

ID: `ilostat` · tema: `mercado` · institución: Organización Internacional del Trabajo (ILOSTAT).
Lector estático: `plataforma_datos.mercado.fuentes.ilostat.lector`. Casa de datos: `ilostat`.

## Alcance

- Indicador EMP_TEMP_SEX_OCU_NB_A desde 2016; selecciona fuentes BA y excluye XA, censos y otras encuestas de hogares.
- Cada país conserva su propio periodo y marcas; porcentajes de empleo/mujeres son cálculos sobre los recuentos publicados.
- Contrasta con Eurostat en el último año común, con cobertura suficiente; ausencia no se convierte en cero.

## Recursos y condiciones de uso

- `empleo` (url): CSV anual de empleo, sexo y ocupación con códigos y marcas oficiales.
  Ubicación: https://rplumber.ilo.org/data/indicator/?id=EMP_TEMP_SEX_OCU_NB_A&timefrom=2016&type=code&format=.csv. Licencia: Política de acceso abierto de la OIT (https://www.ilo.org/es/derechos-y-autorizaciones; su captura es un original de la fuente `oit`): desde el 3/5/2023, los materiales publicados o puestos a disposición por la OIT, bases de datos incluidas, se reutilizan con la licencia CC BY 4.0, citando a la OIT e indicando los cambios. Faro no traduce sus cifras: calcula porcentajes sobre ellas y lo dice.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `ilostat` (remoto): Consulta pública del indicador; la ejecución del robot requiere configuración aparte.
  Recursos: empleo. Autenticación: No se configura autenticación de cuenta en el lector.
  - Conserva unidad miles, años, sexo, fuente de encuesta y marcas; no mezcla un censo o una estimación modelada.
  - No se acredita un calendario de publicación común por país.

## Operación actual

Política: `mensual`. Consulta red: sí.
Frecuencia declarada: continua (cada país, cuando la OIT publica su encuesta). Aviso de renovación: no definido días.
Originales: `ilostat`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| ilostat | cambiante | serie-abierta | descargar | 30 |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: territorios, mundo_eurostat.
Contratos y controles: lector.py:validar.

Retirada: Se mantienen los controles de admisión y reconstrucción del lector; un fallo de consulta o una lectura parcial no autoriza una retirada ni una cifra cero.

Conservación: Las rutas, originales, procedencias y revisiones actuales en var/actualizacion se conservan; este descriptor no activa limpieza automática ni fija nuevos plazos de retención.

## Reproducción

```sh
python -m plataforma_datos.mercado.fuentes.ilostat.lector preparar
python -m plataforma_datos.mercado.fuentes.ilostat.lector validar
python -m plataforma_datos.contratos.fuentes --fuente ilostat --tema mercado --comprobar
```
