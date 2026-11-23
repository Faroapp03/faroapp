# Banco de 240 personas de la hoja de ruta personal

Es una de las fuentes de anclaje del [banco de necesidades](../banco-necesidades/README.md). Su registro de
procedencia (`../banco-necesidades/procedencia.json`, fuente `banco-240`) fija la huella de `personas.json`, y
`comprobarReferenciaHistorica` de `pruebas/ayudas/banco-necesidades.ts` la comprueba;
`pruebas/formacion/banco-necesidades.test.ts` la ejecuta sobre el producto y sobre una copia alterada. Cuatro de los
anclajes de `../banco-necesidades/anclajes.json` proceden de este banco. `etiquetas.tsv` consta en ese registro como
etiqueta histórica «ocupación|curso»: ninguna prueba la lee y no valida la personalización. El banco no acredita la
utilidad para cada persona ni fija el criterio de aceptación del selector.

## Qué hay

- `personas.json`: 240 personas sintéticas, 2 por cada una de 120 ocupaciones. Cada persona tiene su ocupación (ESCO e
  ISCO-08), su situación laboral, el sector de su empresa, su provincia, cómo prefiere formarse, para qué, su nivel,
  sus horas y la posición de la tarea que quiere mejorar.
- `etiquetas.tsv`: 1.401 pares «ocupación|curso» con su etiqueta de referencia. P quiere decir que el curso le sirve,
  Pa que le sirve a medias y N que no le sirve. La columna `ronda` dice en qué ronda se etiquetó cada par.

## Procedencia

- Las personas son sintéticas. Se sortearon con semilla fija (20261021) a partir de proporciones de diseño, y la
  muestra de 240 se estratificó por gran grupo, situación, modalidad, para qué y horas. Ninguna es una persona real.
  Solo tienen valores de listas cerradas, sin nombres ni texto libre.
- La comarca no está en el banco. Se supone la de la capital de su provincia (Barcelonès, Gironès, Segrià o
  Tarragonès), y solo para quien no quiere formarse solo a distancia.
- Captura incorporada del 21/10/2026. Los originales de los que sale son externos al repositorio y no se entregan; de
  ellos solo se conservan sus huellas SHA-256:
  - `banco/personas.json` (las 960 personas): `2587bc75…74dd`;
  - `muestra-240.json`: `e50e70a7…5472`;
  - `etiquetas-temario.tsv`: `6335b8bb…d39c`;
  - `etiquetas-hoja-personal.tsv`: `e6f33e16…98d3`;
  - `etiquetas-hoja-personal-r4.tsv`: `f8f8e95d…7962`.

## Cómo se etiquetó

- Se siguió la rúbrica v2.1. Cada par lo etiquetaron dos evaluadores de IA a ciegas, y un tercero resolvió los
  desacuerdos. No fue una revisión humana. El registro de este banco no identifica las versiones de los evaluadores: no
  permite acreditar su independencia respecto al juez y al entrenamiento del ordenador.
- Ronda 2: 360 pares, con un acuerdo del 89,2 % y una kappa de 0,82.
- Ronda 3: 600 pares, con un acuerdo del 94,3 % y una kappa de 0,90. Hubo 34 desempates.
- Ronda 4: 441 pares, con un acuerdo del 95,7 % y una kappa de 0,93. Hubo 19 desempates.
- En ninguna ronda hubo un desacuerdo grave, es decir, un evaluador marcó P y el otro N.

## Cifras del 21/10/2026

Se midió con el paquete del repositorio y la bolsa de cursos de ese día. Los intervalos son del 95 % y se calcularon
remuestreando ocupaciones (2.000 veces, con semilla 20261021). El programa de esa medición no está en el repositorio.

| | Antes de las reglas de acceso | Con las reglas |
|---|---|---|
| Hojas vacías | 2 | 10 |
| Cursos elegidos (media por hoja) | 732 (3,05) | 646 (2,69) |
| Incompatibles (motor y verificador) | 0 | 0 |
| Cursos con etiqueta | 100 % | 100 % |
| Le sirve (P) | 24,0 % [20,4; 28,9] | 24,8 % [20,9; 30,0] |
| P o Pa | 78,3 % [74,2; 83,6] | 77,1 % [72,7; 83,1] |
| No le sirve (N) | 21,7 % [16,4; 25,8] | 22,9 % [16,9; 27,3] |

- Las 8 hojas que se vacían con las reglas son de personas que quieren formarse solo de forma presencial y que viven
  fuera del Barcelonès. Lo único que tenían eran acciones previstas del Consorci (una en siete hojas y dos en la
  otra), que son presenciales y no publican dónde se imparten.
- Las 2 hojas que ya estaban vacías son de personas en paro que quieren formarse de forma presencial en Girona y en
  Lleida.

## Alcance

Ninguna prueba repite la medición del 21/10/2026 ni aplica umbrales sobre ella: sus cifras describen esa medición y no
son criterios de calidad para entregar el selector. Las etiquetas son «ocupación|curso», no «persona|necesidad|curso»:
no distinguen dos personas del mismo oficio con conocimientos u objetivos diferentes. El acuerdo entre evaluadores mide
la consistencia de la rúbrica, no la utilidad real.
