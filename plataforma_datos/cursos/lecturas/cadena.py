"""La cadena de lecturas de un ámbito: qué censo tenía cada lectura y cuál sirve de referencia a la siguiente.

Una lectura no guarda su censo entero, solo lo que entra y sale respecto a la anterior. Siguiendo `anterior` desde la
primera lectura de la cadena se rehace el censo de cada una, y en cada paso se comprueba con su `ids_sha256`: si un
eslabón falta o no cuadra, la cadena no se usa, porque calcular salidas con un censo equivocado inventaría bajas.
"""

from plataforma_datos.cursos.lecturas.contrato_lectura import huella_de_ids
from plataforma_datos.cursos.tipos_json import ObjetoJson

# Estados que puede tener una lectura aceptada como referencia: solo las de un censo completo dicen qué forma tiene.
ESTADOS_ACEPTABLES = ("sana", "anomala")


class CadenaRota(ValueError):
    """La cadena de lecturas de un ámbito no permite rehacer el censo de su última lectura."""


def censo_de(lectura: ObjetoJson, por_id: dict[str, ObjetoJson]) -> frozenset[str]:
    """Rehace el conjunto de identificadores que tenía el censo de una lectura, siguiendo su cadena.

    Returns:
        Los identificadores del censo de esa lectura.

    Raises:
        CadenaRota: Si falta una lectura de la cadena o el censo rehecho no tiene la huella guardada.
    """
    eslabones = [lectura]
    while eslabones[-1]["anterior"] is not None:
        anterior = por_id.get(eslabones[-1]["anterior"])
        if anterior is None or len(eslabones) > len(por_id):
            raise CadenaRota(f"falta la lectura {eslabones[-1]['anterior']} de la cadena")
        eslabones.append(anterior)
    censo: frozenset[str] = frozenset()
    for eslabon in reversed(eslabones):
        censo = (censo | set(eslabon["entradas"])) - {salida["id"] for salida in eslabon["salidas"]}
        if huella_de_ids(censo) != eslabon["ids_sha256"]:
            raise CadenaRota(f"el censo rehecho de la lectura {eslabon['lectura_id']} no coincide con su huella")
    return censo


def referencia(previas: list[ObjetoJson], aceptadas: set[str]) -> ObjetoJson | None:
    """La lectura con la que se compara la siguiente: la última sana o aceptada por una persona.

    Args:
        previas: Las lecturas anteriores del mismo ámbito, de la más antigua a la más reciente.
        aceptadas: Los identificadores de las lecturas que una persona aceptó como referencia antes de la nueva.

    Returns:
        La más reciente de las sanas y de las aceptadas con censo completo; `None` si no hay ninguna.
    """
    for lectura in reversed(previas):
        if lectura["estado"] == "sana":
            return lectura
        if lectura["lectura_id"] in aceptadas and lectura["estado"] in ESTADOS_ACEPTABLES:
            return lectura
    return None
