# Banco del motor de ocupaciones

Las entradas con las que se comprueba que un cambio del motor no altera lo que vive cada persona en la pantalla. Lo
mide `../herramientas/medir-casos.ts`, que simula una persona por cada grupo válido de cada frase y guarda lo que vio
y respondió en cada paso.

## Qué contiene

| Archivo | Nombre en los resultados | Frases | Qué mide | SHA-256 |
| --- | --- | --- | --- | --- |
| `casos-100.json` | `banco-100` | 100 | Descripciones realistas de la búsqueda de ocupaciones, en castellano y catalán | `18e505a24b5856e32508c1f37edadaa64cef65012fb3023f02f4a11e54c84889` |
| `casos-propios.json` | `propios-12` | 12 | Casos de regresión sacados de pruebas manuales de la pantalla | `1dc714dc655ad48c37d6aea4db06df06c0ed611816256fc0e1be77f747ce2be6` |
| `frases-2000.json` | `cobertura-2000` | 2.000 | Cobertura: 20 lotes de 100, 60 % castellano y 40 % catalán, ponderados por ocupados en Cataluña | `a2efb3d9f403d737d684d92dae0deb84b24731ada71ccfb237f7f19145690631` |

`bancos.json` da el orden en que se miden, el nombre de cada uno en los resultados y su clave de ruido. En total, 2.112
frases y 2.473 personas simuladas. Las frases se escribieron a ciegas, sin ejecutar el motor. Los tres bancos han
orientado cambios del motor: son de desarrollo y regresión, no un examen.

## Cómo se mide

Tres variantes, cada una una comparación independiente:

```sh
npm run ocupaciones:medir -- --traza --salida normal.json
npm run ocupaciones:medir -- --traza --ruido personas --salida ruido.json
npm run ocupaciones:medir -- --traza --sin-vectores --salida sin-vectores.json
```

Por omisión mide el producto que lo contiene con estos tres bancos.

## La clave de ruido

El ruido de cada persona se sortea con «clave/id#grupo», donde la clave es el campo `clave_de_ruido` del banco en
`bancos.json`. Es explícita y fija: la misma persona responde igual a la misma pregunta en cada medición, y renombrar
el archivo de un banco (con su campo `archivo` en `bancos.json`) no cambia ninguna tirada ni ningún resultado. Un banco
sin `clave_de_ruido` hace fallar la medición.

El nombre del banco en `bancos.json` no entra en el sorteo, pero sí en el campo `banco` de cada resultado. Cambiarlo
cambia la salida, y la medición queda como `"derivado"`, no comparable con la referencia.

## La referencia

Persona por persona: se ignora solo el objeto `base` (fecha, etiqueta, tiempos y huellas de lo medido) y `resultados`
tiene que ser idéntico en forma, valores y orden. La referencia de estos bancos son las huellas SHA-256 de su
`resultados` (`JSON.stringify` del arreglo):

| Variante | Huella de `resultados` | Acaban en su grupo |
| --- | --- | --- |
| sin ruido | `f16605878434dd99b8375c8c3dcbfce0660d6a4104091f8d78bff19d5b214e69` | 2.473 de 2.473 |
| con ruido | `6db958bdf21a2d8f11bbd3bd120f399f964f460f8173e42e3e02301de880ab6e` | 2.444 de 2.473 |
| sin vectores | `da06e668ce40964851d0622401eb9187f2c4cccfbbfd50d2294cbbd690ef0a45` | 2.473 de 2.473 |

Igualdad de trayectorias y acierto son medidas distintas.

## Relación con la referencia anterior

Estos bancos son una versión limpia de los tres con que se midió la referencia anterior del motor, que se conservan
fuera del producto: `313964a5c479be90e250abdbcba26f2cc30748fca64186b242bac33dbb7eace3` (100 casos),
`c18650bad735609525315e7a1f3e5b5a48225f50f5db91d64fdca748350896a5` (12 casos) y
`9b23086d64eccaf2dd9787b1fcb3ef597774922edc3a4571eff49d5e4cb6315f` (2.000 frases). De cada frase conservan `id`,
`idioma`, `texto`, `esperadas`, `grupo`, `lote` y `tipo`. Cambian los metadatos (sin fecha de creación, una
`descripcion` que solo describe el contenido y sin notas en el banco de 12 casos), el nombre de ese banco
(`propios-12`), sus ids (`pr01`…`pr12`) y tres rasgos (`caso_propio`, `prueba_manual` y
`ampliacion_sectores`). La tabla de correspondencia va con los bancos anteriores.

Con el mismo motor, frente a la referencia anterior (`resultados` con huellas
`e822b6215fa3f18f04d1c37b77259cd5f6084682f7ff9d50edaf9c498a3c9b59` sin ruido,
`225d0cef02e02dfc8b92a853f1400080761ad9861137de330869c41500e541fa` con ruido y
`a3aa86b7f9ef1fa0701364f151cafd8a7340cdc335199e5620e16bd4fdfd29a9` sin vectores), y aplicando solo esos renombres
(el nombre del banco, sus ids y los tres rasgos):

- sin ruido y sin vectores, idéntica: 0 casos y 0 personas distintos;
- con ruido, 2 casos y 5 personas distintos, todos del banco `propios-12` (con los mismos 2.444 aciertos), porque
  su clave de ruido y sus ids, que entran en el sorteo, son otros. Con la clave y los ids de la referencia anterior
  (que no están en el producto), el ruido es idéntico byte a byte a esa referencia; está acreditado en Desarrollo, con
  los bancos anteriores. El motor es el mismo.

## Qué es comparable

El medidor anota en `base`:

- `origen_bancos: "original"` solo si midió enteros estos tres bancos (con estas huellas, estas claves de ruido, estos
  nombres y en este orden), sin `--banco`, `--casos` ni `--limite`; si no, `"derivado"`.
- `comparable_con_la_referencia: true` solo si además midió exactamente una de las tres variantes (normal,
  `--ruido personas` o `--sin-vectores`), con `--traza` y sin más opciones que `--etiqueta`, `--salida`, `--producto` y
  `--bancos`. Cualquier otra
  (`--semilla`, `--max-pasos`, `--respuesta-estable`, `--sensibilidad-alternativas`, `--ruido persistente`,
  `--clasificador`, `--sin-clasificador`) la pone a `false`: sirve para explorar, nunca para afirmar equivalencia.

`base.huellas.sello_motor` identifica el motor medido por su sello. `true` quiere decir comparable byte a byte con la
referencia de este README. Con la referencia anterior no se compara directamente: hay que aplicar los renombres (el
nombre del banco, sus identificadores y tres rasgos), y con ruido también la clave anterior.
