# Lecturas por fuente

Una **lectura** es el resumen de una consulta al censo de una fuente: el listado de cursos que publica una casa
(Cibernàrium, FUNDAE, HP LIFE, Cibervoluntarios, Anthropic, el SOC…). Cada día, cada fuente deja una lectura por
ámbito (por ejemplo, las ediciones de Cibernàrium o la preinscripción de FUNDAE). Con ellas el sistema sabe, de cada
lectura, si fue sana o anómala, y puede explicar cada curso que entra o sale.

El contrato es `lectura-fuente` versión 1 (`contrato_lectura.py`, descrito también en `lectura_fuente.json`). El
almacén (`almacen_lecturas.py`) guarda cada lectura en
`var/actualizacion/validados/<fuente>/lecturas/<lectura_id>.json`. Esa carpeta viaja con la generación que el ciclo
archiva y recupera, de modo que el registro no depende de volver a leer los originales.

## Qué dice una lectura

- `fuente` y `ambito`: de qué casa y de qué censo es.
- `observado_utc`: cuándo se leyó, en UTC y al segundo. La hora llega como dato; nada consulta el reloj.
- `completa` y `motivo_incompleta`: si el censo llegó entero y, si no, por qué.
- `recuento_bruto`, `recuento_vigente` y `total_declarado`: cuántos registros trajo la captura, cuántos siguen
  vigentes y cuántos dice tener la propia fuente (o `null` si no lo dice).
- `ids_sha256`: la huella del conjunto de identificadores del censo.
- `anterior`, `entradas` y `salidas`: la lectura anterior del mismo ámbito y los cursos que entran y salen respecto a
  ella. La primera lectura no tiene anterior: lista todo su censo como entradas y no tiene salidas. Por eso, siguiendo
  la cadena, se sabe qué cursos tenía el censo en cada lectura y se comprueba con `ids_sha256`.
- Cada salida lleva `explicada_por`: `fin_publicado` (su fecha de fin ya llegó), `fuente_declara_baja` (la fuente la
  da de baja) o `null` (nada la explica).
- `huella_forma`: la huella de los campos de la captura, los niveles que trae (`actividad`, `edicion`, `programa`) y
  los valores nuevos que aparecen en un vocabulario cerrado.
- `estado`, `motivos` y `regla`: el veredicto y la regla que lo decidió, con su identificador, su versión y su huella.
- `calibracion`, solo en las lecturas completas que califica una regla que calibra (`salud-lectura` desde la versión
  2): el límite de salidas sin explicar que se aplicó y de dónde salió (ver «El límite según la historia»). Es parte de
  la decisión, como el estado. Las lecturas calificadas con la versión 1 no lo llevan y se leen igual.
- `lectura_id`: la huella de todo lo observado (todo salvo el estado, los motivos, la regla y la calibración). La misma observación
  tiene siempre el mismo identificador, y su veredicto no se puede reescribir: guardar otra vez la misma lectura no
  cambia nada, pero guardar otro veredicto para lo mismo es un error.

## Estados

- `sana`: el censo llegó completo y nada en él es extraño. Sus ausencias cuentan como observaciones.
- `anomala`: el censo llegó completo, pero algo en él no encaja (lleva al menos un motivo). Sus ausencias no cuentan.
- `incompleta`: el censo no llegó entero. Sus ausencias no cuentan.
- `reconstruida`: rehecha después a partir del historial, no observada en el momento.

## Motivos de anomalía

- `forma_cambiada`: la captura ya no tiene la forma de la última lectura sana (falta un nivel o un campo).
- `total_declarado_distinto`: la fuente declara un total distinto del que trae la captura.
- `valor_desconocido`: un campo de vocabulario cerrado trae un valor que no se reconoce; va siempre con sus valores
  nuevos en `huella_forma`.
- `salidas_no_explicadas_en_bloque`: salen de golpe muchos cursos sin nada que lo explique.

## Motivos de un censo incompleto

- `sin_censo`: la fuente no publica un listado completo; la ausencia de un curso no acredita nada.
- `consulta_fallida`: alguna consulta del censo no respondió entera o respondió con un fallo.
- `limite_alcanzado`: se agotó el tope de consultas o de tiempo antes de terminar.

## La invariante

Una lectura anómala solo puede impedir cambios, nunca provocarlos. Si una lectura no es sana, lo que falta en ella no
retira ningún curso: como mucho deja las cosas como estaban hasta la siguiente lectura sana.

Este contrato no decide el estado: comprueba que la lectura es coherente consigo misma (una lectura sana no lleva
motivos, una anómala lleva al menos uno, una incompleta no tiene el censo completo, cada motivo va con el hecho que lo
justifica). Decidir el estado es trabajo de la regla de salud de la lectura.

## La regla de salud de la lectura

La regla `salud-lectura` versión 2 (`salud.py`) decide el estado. Es una función pura, sin red, sin reloj y sin estado
global: `calificar(observacion, ultima_sana, previas=...)` recibe lo observado (`Observacion`, todo lo de la lectura
salvo la decisión), la última lectura sana del mismo ámbito tal como la devuelve el almacén (o `None`) y las lecturas
anteriores del ámbito. Devuelve un `Veredicto` con el estado, los motivos, la regla y la calibración, y
`observacion.lectura(veredicto)` construye la lectura del contrato. La regla solo califica la lectura: no dice nada de
ningún curso.

Por qué no mira cuánto cambia el recuento: el historial enseña que un recuento no separa una caída legítima de una
rotura. Las diez omisiones que luego se desmintieron cayeron todas en la lectura del 15/11, y FUNDAE dejó de emitir el
nivel de programa el 18/11 con sus 186 ediciones intactas. Por eso la regla mira si el cambio tiene explicación.

- Un censo incompleto es `incompleta` y no se juzga. Solo lleva `valor_desconocido` si la captura trae valores
  nuevos, porque el contrato ata ese motivo a sus valores.
- Un censo completo es `anomala` si tiene algún motivo y `sana` si no tiene ninguno:
  - `forma_cambiada`: la huella de campos o los niveles no son los de la última lectura sana;
  - `total_declarado_distinto`: la fuente declara un total distinto del recuento bruto;
  - `valor_desconocido`: la captura trae valores nuevos en un vocabulario cerrado;
  - `salidas_no_explicadas_en_bloque`: salen sin fin publicado ni baja declarada más cursos de los que admite el
    límite de la calibración.
- Sin lectura sana anterior no hay comparación de forma: una primera lectura no puede ser anómala por comparación. Si
  hay lectura anterior pero ninguna sana, el umbral solo admite su mínimo de cursos.

### El suelo: el umbral fijo de salidas sin explicación

Mientras la historia de un ámbito no basta para calibrar (ver «El límite según la historia»), vale este umbral fijo.
Se declara en un solo sitio, `UMBRAL` en `salud.py`, y entra en la huella de la regla junto con la del código: cambiar
el umbral es cambiar de regla. Una lectura es anómala si salen sin explicación **más de** `max(3, ⌈2 % del recuento
bruto de la última lectura sana⌉)` cursos. En una fuente pequeña manda el mínimo, y allí se cuentan cursos: en una de
9, salir 3 sin explicación se admite y salir 4 no.

El valor es la propuesta del diseño, contrastada con el historial real del 21/10 al 18/11 (lecturas reconstruidas de
observaciones y ejecuciones del catálogo; la explicación de cada salida es su fecha de fin publicada, anterior al día de
la lectura en que falta). Salidas sin explicar frente al bruto de la última lectura sana:

| Ámbito | 15/11 | 18/11 |
|---|---|---|
| Cibernàrium · edición | 15 de 616 (7 volvieron el 18/11) | 8, frente a la misma referencia de 616 |
| Cibernàrium · programa | 27 de 288 (1 volvió) | 17 de 288 |
| Cibervoluntarios | 4 de 242 (2 volvieron) | 0 |

Lo que marca cada valor candidato (con el mínimo de 3 cursos):

| Porcentaje | Lecturas que marca | ¿La de ediciones del 15/11? |
|---|---|---|
| 1 % | ediciones 15/11 y 18/11; programas 15/11 y 18/11; Cibervoluntarios 15/11 | sí |
| 1,5 % | ediciones 15/11; programas 15/11 y 18/11 | sí |
| 2 % | ediciones 15/11; programas 15/11 y 18/11 | sí |
| 2,5 %, 3 % y 5 % | programas 15/11 y 18/11 | no |

Lo que esto permite afirmar y lo que no:
- En las ediciones de Cibernàrium, el 2 % separa la lectura del 15/11 (15 frente a 13 admitidas) de la del 18/11 (8
  frente a 13). El margen es de dos cursos y descansa en una lectura mala y una normal: cualquier porcentaje mayor que
  el 1,14 % y hasta el 2,27 % da la misma separación; por encima, la del 15/11 sale sana.
- En los programas de Cibernàrium el 2 % no separa las dos lecturas: sus salidas no traen fin publicado, así que todas
  cuentan como no explicadas y ambas salen anómalas. Solo un porcentaje mayor que el 5,56 % y hasta el 9,03 % las
  separaría, y con él las ediciones del 15/11 saldrían sanas. Hace falta que la fuente explique la salida de un
  programa (por ejemplo, porque terminaron todas sus ediciones).
- En Cibervoluntarios la lectura del 15/11 (4 salidas, 2 desmentidas) solo sale anómala con un porcentaje del 1,24 % o
  menos. Entre el 1,14 % y el 1,24 % se marcarían las tres lecturas del 15/11 y ninguna del 18/11 de ediciones, pero
  es una franja de una décima ajustada a tres casos: no se adopta. Con el 2 %, el umbral no ve esta lectura.

### El límite según la historia

Un umbral igual para todas las fuentes no sirve: el SOC pierde cada día unos ocho cursos de su lista sin publicar por
qué y el Consorci suelta ediciones a los pocos días de empezar, así que sus lecturas saldrían anómalas casi a diario;
y en una fuente que nunca pierde cursos, tres salidas sin explicar de golpe ya son una señal. Lo normal en cada fuente
lo dice su propia historia, estimada con estadística (`historia_de_salidas.py`, `calibracion_de_salidas.py` y
`../tasa_de_poisson.py`):

1. **Qué salidas fueron reales.** Una salida sin explicar queda *confirmada* si el curso no vuelve en ninguna lectura
   posterior y hay después al menos una lectura completa; queda *desmentida* si reaparece. Solo las confirmadas
   cuentan: una lectura rota no enseña a la regla que romperse es normal. Se juzgan las salidas de las lecturas que van
   de la primera completa a la penúltima completa.
2. **El ritmo.** Salidas confirmadas por curso y por día. La exposición de cada tramo es el tiempo entre dos lecturas
   por el mayor de sus dos recuentos brutos (una lectura rota a un lado no recorta la exposición). La cota superior de
   Jeffreys al 97,5 % (gamma de forma `k/φ + 0,5`, razón `E/φ`) da el ritmo más alto creíble, también sin ninguna
   salida vista.
3. **La dispersión.** Si los recuentos de cada tramo varían más de lo que permite un Poisson, el factor de Pearson lo
   recoge. Con pocos tramos el factor medido sale a menudo por debajo del real, así que se usa su cota superior al
   97,5 %, `φ = X² / χ²₀,₀₂₅(n − 1)` (nunca menor que 1): la cota del ritmo se calcula con `k/φ` sucesos en `E/φ` de
   exposición y el límite, con una binomial negativa de varianza `φ` veces la media. Es el precio de cumplir la
   probabilidad declarada también cuando el ritmo varía: con dos semanas de historia el límite es más ancho que el de
   un Poisson puro y se estrecha a medida que la historia crece.
4. **El límite.** El menor recuento que, con ese ritmo y la exposición de esta lectura, solo se supera con
   probabilidad 1 entre 1.000. Por encima, la lectura es anómala.
5. **Suelo y techo.** Con menos de 7 lecturas juzgadas o menos de 7 días de historia vale el suelo (el umbral fijo de
   arriba). La historia puede bajar el límite por debajo del suelo (una fuente que nunca pierde cursos), pero nunca
   subirlo por encima del techo: el 8 % del bruto de la lectura anterior, o el suelo si es mayor. Así una caída del 10 %
   en una lectura se ve siempre y una degradación lenta no se normaliza sola.

Los parámetros están en un solo sitio, `PARAMETROS` en `calibracion_de_salidas.py`, con su porqué al lado, y entran en
la huella de la regla junto con el código de las tres piezas. Cada lectura completa guarda su `calibracion`: el límite,
su origen (`suelo`, `historia` o `techo`), las salidas sin explicar, el suelo y el techo, las lecturas, confirmadas y
desmentidas de la historia, las dos exposiciones en cursos por segundo, el ritmo y su cota por curso y día, la
dispersión y las salidas esperadas con la cota. Con eso se rehace la cuenta. El contrato comprueba que la calibración
cuadra con las salidas y con el motivo.

Lo que sostienen los datos reales y lo que no (cifras del 25/10 al 22/11; el detalle está en la entrega del lote B3b):
- Con las lecturas que hay, ninguna fuente tiene historia suficiente: todas usan el suelo y salen igual que con la
  versión 1. La de ediciones de Cibernàrium del 15/11 sigue anómala (15 frente a 13) y la del 18/11, sana (8 frente
  a 13).
- Las capturas están separadas por semanas. Un intervalo largo cuenta de menos: no ve los cursos que entran y salen
  dentro de él. Los ritmos medidos así son cotas inferiores: SOC 1,0 % por curso y día del 27/09 al 15/11 y 1,7 % del
  15/11 al 22/11; Consorci 1,6 %; ediciones de Cibernàrium 0,06 %.
- Los dos tramos del SOC difieren más de lo que permite un Poisson (`φ` ≈ 13), pero con dos tramos de 49 y 7 días no se
  separa una dispersión real del sesgo del intervalo largo. Lo dirán las lecturas diarias: con una al día, la décima
  lectura completa seguida es la primera calibrada, y la dispersión se mide con solidez a partir de unas cuatro semanas.

## Cómo emite una fuente su lectura

Tras leer su censo, la fuente llama a `emitir_lectura(raiz, Censo(...))` (`emision.py`) con lo que ya sabe: fuente,
ámbito, hora de la captura en UTC, si el censo llegó completo y por qué no, los identificadores presentes, los recuentos
bruto y vigente, el total que declara la fuente, los niveles y las rutas de campos de la captura, los valores nuevos de
sus vocabularios cerrados y una función que explica cada salida. La emisión busca la lectura anterior del mismo ámbito
y rehace su censo siguiendo la cadena; calcula entradas y salidas; toma como referencia la última lectura sana o
aceptada; la califica con la regla de salud, que recibe también las lecturas anteriores del ámbito, y la guarda. Devuelve la lectura, su ruta y los problemas, si los hubo.
Si el almacén o la cadena no se pueden leer, la lectura se guarda como primera de una cadena nueva y `problemas` lo
dice. Emitir dos veces el mismo censo no cambia nada; uno anterior a la última lectura del ámbito se rechaza.

```python
emision = emitir_lectura(
    raiz,
    Censo(
        fuente="cibervoluntarios",
        ambito="catalogo",
        observado_utc="2026-11-16T05:00:00Z",
        completa=True,
        ids=frozenset(ids),
        recuento_bruto=len(ids),
        recuento_vigente=vigentes,
        total_declarado=None,
        niveles=(),
        rutas_de_campos=("id", "titulo", "estado"),
        explicar_salida=bajas.get,
    ),
)
```

Si el módulo de la fuente falla ese día y su área vuelve a lo publicado, sus lecturas nuevas pasan antes a lo
publicado (`orquestacion/restauracion_del_area.py`), salvo en un ensayo. El registro nunca detiene la ronda: un
archivo ilegible no se conserva y el motivo del módulo lo dice. Una fuente que aún no tiene ninguna versión
admitida puede guardar sus lecturas: su carpeta validada con solo `lecturas/` no impide archivar la generación.

## Aceptar una forma nueva

Cuando una fuente cambia de forma de manera legítima, una persona puede aceptar una lectura como nueva referencia
(`aceptaciones.py`, contrato `aceptacion-lectura` versión 1): qué lectura, cuándo (`aceptada_utc`) y por qué
(`motivo`). Se guarda una sola vez en `lecturas/aceptacion-<aceptacion_id>.json` y nunca cambia. La emisión solo
cuenta las aceptaciones anteriores a la hora de la lectura nueva, así que volver a emitir un censo da siempre lo mismo.
La emisión avisa a la regla de que la referencia es una lectura aceptada (`calificar(..., aceptada=True)`), y la regla
la admite aunque sea anómala, siempre que su censo llegara completo: la siguiente lectura con esa forma sale sana. La
lectura aceptada no se reescribe: conserva su estado y sus motivos.
