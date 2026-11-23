# Consorci de formación continua

Generado de `fuente.json`; editar el descriptor y regenerar.

Ediciones programadas, cursos en programación y acciones previstas para personas trabajadoras; no son una sola unidad de disponibilidad.

ID: `consorci` · tema: `cursos` · institución: Consorci per a la Formació Contínua de Catalunya.
Lector estático: `plataforma_datos.cursos.fuentes.consorci.lector`. Casa de datos: `consorci`.

## Alcance

- rowsUpdatedAt, recuento y reparto por origen; copias exactas de filas/metadatos, historial admitido jdcj para contraste
- Programación, ediciones con fecha y previstas separadas; iniciado no equivale a matrícula abierta

## Recursos y condiciones de uso

- `jdcj-za6r` (url): Cursos programados y en programación.
  Ubicación: https://analisi.transparenciacatalunya.cat/resource/jdcj-za6r.json. Licencia: Condiciones de reutilización de la Generalitat declaradas en socrata.py; atribución y conservación del sentido.
- `7vig-4syr` (url): Oferta FPCAT: solo filas de origen CFCC; no todo el conjunto.
  Ubicación: https://analisi.transparenciacatalunya.cat/resource/7vig-4syr.json. Licencia: Condiciones de reutilización de la Generalitat declaradas en socrata.py; atribución y conservación del sentido.
- `qv5z-dgk3` (url): Acciones programadas con fechas.
  Ubicación: https://analisi.transparenciacatalunya.cat/resource/qv5z-dgk3.json. Licencia: Condiciones de reutilización de la Generalitat declaradas en socrata.py; atribución y conservación del sentido.
- `hhvr-cedj` (url): Acciones previstas sin fecha.
  Ubicación: https://analisi.transparenciacatalunya.cat/resource/hhvr-cedj.json. Licencia: Condiciones de reutilización de la Generalitat declaradas en socrata.py; atribución y conservación del sentido.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `consorci` (remoto): jdcj-za6r, 7vig-4syr filtrado CFCC, qv5z-dgk3, hhvr-cedj; ocho recursos por copia
  Recursos: jdcj-za6r, 7vig-4syr, qv5z-dgk3, hhvr-cedj. Autenticación: No token ni cuenta configurados por este lector/Socrata.
  - 50 000 filas por petición; se exige estrictamente menos y recuento igual a metadatos; no paginación ni cuota de servidor acreditada

## Operación actual

Política: `diaria`. Consulta red: sí.
Frecuencia declarada: Consulta diaria de Dades Obertes de Catalunya; el panel avisa de revisar la copia con el mismo plazo que la aplicación. Aviso de renovación: 30 días.
Originales: `consorci`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| consorci | cambiante | catalogo-actual | descargar | 1 |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: formacion.
Contratos y controles: lector.py:validar.

Retirada: Se mantienen los controles de admisión y reconstrucción del lector actual; no se declara una conciliación genérica de entidades ni se interpreta un fallo como baja.

Conservación: Se conservan las rutas, originales, procedencias y revisiones actuales en var/actualizacion; este descriptor no habilita limpieza automática ni fija nuevos plazos de retención.

## Reproducción

```sh
python -m plataforma_datos.cursos.fuentes.consorci.lector preparar
python -m plataforma_datos.cursos.fuentes.consorci.lector validar
python -m plataforma_datos.contratos.fuentes --fuente consorci --tema cursos --comprobar
```
