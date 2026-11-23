# Regla de las relaciones admitidas de la acreditación

El bloque de acreditación de competencias dice qué certificados de profesionalidad podría acreditar una persona con la
experiencia de su ocupación. Una relación ocupación ESCO → certificado solo se enseña si está en la lista de relaciones
admitidas, `datos/revisiones/acreditacion/admitidas.tsv`, y esa lista sigue esta regla.
`cadena_de_datos/fuentes/admitidas.py` la aplica a los juicios y escribe la lista; la misma entrada da siempre el mismo
archivo. La cadena fija la huella SHA-256 de este documento (`HUELLA_DE_LA_REGLA`) y cada fila de la lista lleva sus 12
primeros caracteres: si este documento cambia, la lista no se lee hasta que se fija la huella nueva y se regenera.

## Juicios

Cada relación tiene cuatro juicios independientes con el texto oficial delante (el anexo del real decreto del
certificado): dos revisiones, v2 y v3, con dos revisores cada una, A y B. Cada revisor, un modelo de lenguaje, responde
C (sí), X (no) o D (no se puede decidir), con una cita literal del texto oficial. Una C sin cita literal válida cuenta
como D.

## Regla

| Clase | Condición | ¿Entra en la lista? |
|---|---|---|
| Admitida | al menos 3 de los 4 juicios (v2-A, v2-B, v3-A y v3-B) son C con cita literal válida | sí |
| Descartada | al menos 3 de los 4 juicios son X | no; va a `descartadas.tsv` |
| Dudosa | las demás | no |

La regla vale igual para las relaciones de calibración con respuesta correcta conocida, que son relaciones reales de la
cadena (el anexo nombra la ocupación con su código exacto). Las de calibración con respuesta falsa conocida, fabricadas
o descartadas, no entran nunca en la lista.

Se enseña cada relación admitida cuya ocupación ESCO y cuyo certificado están en el paquete, la proponga o no la regla
automática de la cadena (`cadena_de_datos/fuentes/relaciones.py`); las relaciones descartadas a mano en la cadena
(`DESCARTADAS`) mandan sobre todo.

## La lista

Cada fila lleva la ocupación y el certificado, los estratos por los que la relación entró en la revisión, si la regla
automática de la cadena la propone, la decisión (C), los cuatro juicios, la cita del primero que dice C (en el orden
v3-A, v3-B, v2-A y v2-B), la fecha de la regla, los 12 primeros caracteres de la huella de este documento y el
identificador de la relación en la v3.

| | Cifra |
|---|---|
| Relaciones revisadas (sin calibración) | 2.045 |
| Admitidas (3 o 4 C) | 984 |
| Con 3 o 4 X | 589 |
| Dudosas | 472 |
| Calibración correcta que pasa la regla | 53 de 57 (0,93) |
| Calibración falsa que pasa la regla | 0 de 45; techo de Wilson al 95 %, 7,9 % |
| En la lista | 1.037 (984 revisadas y 53 de calibración correcta) |

`admitidas.py` imprime estas cifras al escribir la lista.

## Límites

- La regla no está fijada antes de ver los juicios: la sostiene la calibración, medida con la misma regla.
- La tasa de relaciones falsas admitidas no está medida con precisión: con 45 casos falsos, solo se puede decir que no
  pasa del 7,9 %.
- La regla excluye relaciones correctas: las dudosas no se enseñan.
