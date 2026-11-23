# Banco de mutaciones de Cursos

Cada prueba de esta carpeta parte de un ciclo sano de una fuente, cambia una sola cosa de lo que esa fuente publica
y mira qué hace la cadena real con el cambio: si las etapas de la fuente terminan, qué decide la vigencia de cada
curso, si el catálogo de Cursos se compone y qué veredicto da el ciclo. Todo corre sin red, en carpetas temporales.

## Qué recorre cada prueba

| Archivo | Fuente | Tramo recorrido |
|---|---|---|
| `test_mutaciones_ciber.py` | Cibervoluntarios | recepción con transporte falso, preparación, validación, aplicación al almacén, vigencia, proyección, publicación y panel |
| `test_mutaciones_cibernarium.py` | Cibernàrium | el mismo tramo que Cibervoluntarios |
| `test_mutaciones_fundae.py` | FUNDAE, ediciones | descarga del índice y de las fichas, lectura, composición con la salida del día anterior y controles de la validación; para M3, además, aplicación al almacén, vigencia y proyección de la entrega |
| `test_mutaciones_salud.py` | una fuente de 500 cursos con dos semanas de lecturas sanas | solo la calificación de la lectura con la regla de salud calibrada: M7, una caída del 10 % en una lectura; M8, una degradación lenta del 9 % diario, también con una regla mutada sin techo para demostrar que el techo es la guarda |

El último tramo, el de los subprocesos de la orquestación, no se lanza. `arnes.veredicto_del_ciclo` traduce lo
observado a lo que hacen `ejecutar_modulo` (una etapa de la fuente que falla deja su módulo en ámbar) y
`ejecutar_paquete` (una composición que falla deja el paquete en ámbar), y pasa ese resultado por el `decidir` real.
Si la prueba no llega a la composición, `catalogo_compuesto` vale `None` y no hay veredicto del ciclo.

## Cómo se añade una mutación

1. Elige la instalación de la fuente. Las de Cibervoluntarios y Cibernàrium sirven cada página desde una función
   del módulo de la prueba de la fuente (`_cuerpo_pagina`, `_cuerpo`); el método `cuerpos` de cada prueba la
   envuelve. Para FUNDAE, `respuestas()` devuelve las respuestas de la API simulada.
2. Declara la mutación con `arnes.Mutacion(nombre, fuente, que_cambia)` y aplícala solo en el segundo ciclo, el
   que sigue al ciclo sano del `setUp`.
3. Recoge lo observado en un `arnes.Observado`: si la fuente quedó en verde, si el catálogo se compuso, la decisión
   de cada unidad antes y después y qué unidades toca la mutación.
4. Comprueba `arnes.cambiadas`, `arnes.alcance` y, si se recorrió la composición, `arnes.veredicto_del_ciclo`.

Solo entra como prueba la mutación cuyo resultado de hoy es el correcto: el daño no pasa de la fuente afectada y
ningún curso sano cambia de estado. Una mutación que hoy daña más de lo debido no se escribe aquí como prueba en
rojo ni como fallo esperado: se describe en el informe del lote, con el punto exacto del código, y su prueba llega
con el arreglo.
