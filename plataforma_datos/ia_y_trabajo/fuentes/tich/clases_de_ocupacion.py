"""La clase, manual o no manual, de cada grupo ISCO-08 de 2 cifras: un hecho observado en cada edición.

El INE clasifica a cada persona ocupada como manual o no manual (`OCUPACION1`). Un grupo de 2 cifras tiene la clase que
reúne al menos el `UMBRAL_DE_CLASE` por ciento de sus entrevistas en esa edición; si ninguna llega, el grupo no tiene
clase: el dato lo declara (`grupos_sin_clase`) y el informe no da para él lo que depende de la clase (de quienes no
usan la IA generativa, cuántos no sabían cómo). El reparto en entrevistas de cada grupo que no es entero queda en el
informe de validación como evidencia, tenga o no clase.
"""

from collections.abc import Mapping
from typing import Any

from plataforma_datos.comun.nucleo import Controles

# La clase es de cada persona, según el INE; el grupo es de una clase cuando lo son prácticamente todas sus personas.
# Unas pocas entrevistas sueltas de la otra clase no cambian la clase del grupo; un reparto más parejo, sí.
UMBRAL_DE_CLASE = 95


def _es_dominante(entrevistas: int, total: int) -> bool:
    """Si las entrevistas de una clase reúnen al menos el `UMBRAL_DE_CLASE` por ciento del total.

    Returns:
        True si las reúnen.
    """
    return entrevistas * 100 >= UMBRAL_DE_CLASE * total


def clase_de_cada_grupo(reparto: dict[str, dict[str, int]]) -> dict[str, str]:
    """La clase de los grupos que reúnen en una clase al menos el `UMBRAL_DE_CLASE` por ciento de sus entrevistas.

    Args:
        reparto: {grupo: {clase: entrevistas}} (estimacion.clases_por_isco2).

    Returns:
        {grupo: clase} de los grupos con clase.
    """
    clases = {}
    for grupo, entrevistas in reparto.items():
        clase = max(entrevistas, key=lambda nombre: entrevistas[nombre], default=None)
        if clase is not None and _es_dominante(entrevistas[clase], sum(entrevistas.values())):
            clases[grupo] = clase
    return clases


def sin_clase(reparto: dict[str, dict[str, int]]) -> list[str]:
    """Los grupos en que ninguna clase reúne el `UMBRAL_DE_CLASE` por ciento de las entrevistas.

    Returns:
        Los grupos, en orden.
    """
    return sorted(set(reparto) - set(clase_de_cada_grupo(reparto)))


def con_las_dos_clases(reparto: dict[str, dict[str, int]]) -> dict[str, dict[str, int]]:
    """Los grupos con entrevistas de las dos clases, tengan clase o no, con su reparto en entrevistas.

    Returns:
        {grupo: {"manual": entrevistas, "no_manual": entrevistas}}, en orden de grupo.
    """
    return {grupo: dict(clases) for grupo, clases in sorted(reparto.items()) if len(clases) > 1}


def control_de_las_clases(controles: Controles, reparto: dict[str, dict[str, int]], conjunto: dict[str, Any]) -> None:
    """Coherencia de las clases del dato: cada clase declarada reúne el umbral de su grupo y el resto, sin clase."""
    con_clase, declarados = conjunto["clase_por_isco2"], conjunto["grupos_sin_clase"]
    controles.comprobar(
        declarados == sorted(set(reparto) - set(con_clase))
        and set(con_clase) <= set(reparto)
        and all(
            _es_dominante(reparto[grupo].get(clase, 0), sum(reparto[grupo].values()))
            for grupo, clase in con_clase.items()
        )
        and all(not _es_dominante(max(reparto[grupo].values()), sum(reparto[grupo].values())) for grupo in declarados),
        f"los {len(con_clase)} grupos ISCO-08 de 2 cifras con clase reúnen en una, manual o no manual, al menos el "
        f"{UMBRAL_DE_CLASE} % de sus entrevistas"
        + (f", y los {len(declarados)} que no llegan se declaran sin clase: {declarados}" if declarados else ""),
    )


def control_de_los_cambios_de_clase(
    controles: Controles, admitida: Mapping[str, Any], candidata: Mapping[str, Any]
) -> dict[str, list[str]]:
    """Ningún grupo con clase en la edición admitida pasa a la contraria en la candidata.

    Pasar a «sin clase» o salir de ella no detiene: se declara.

    Returns:
        Los grupos que cambian: `clase_contraria`, `a_sin_clase` y `desde_sin_clase`, en orden.
    """
    antes, ahora = admitida["clase_por_isco2"], candidata["clase_por_isco2"]
    cambios = {
        "clase_contraria": sorted(grupo for grupo, clase in antes.items() if ahora.get(grupo, clase) != clase),
        "a_sin_clase": sorted(set(antes) & set(candidata["grupos_sin_clase"])),
        "desde_sin_clase": sorted(set(admitida["grupos_sin_clase"]) & set(ahora)),
    }
    contrarios = cambios["clase_contraria"]
    controles.comprobar(
        not contrarios,
        "ningún grupo ISCO-08 de 2 cifras pasa de manual a no manual, ni al revés, respecto de la edición admitida"
        + (f": pasan {contrarios}" if contrarios else ""),
    )
    return cambios


def frase_de_los_sin_clase(conjunto: dict[str, Any]) -> str:
    """La frase de límites sobre la clase de los grupos, verdadera con grupos sin clase y sin ellos.

    Returns:
        La frase.
    """
    grupos = conjunto["grupos_sin_clase"]
    clase = (
        f" Un grupo es manual o no manual si una de las dos clases del INE reúne al menos el {UMBRAL_DE_CLASE} % de "
        "sus entrevistas."
    )
    if not grupos:
        return f"{clase} En esta edición todos los grupos tienen clase."
    return (
        f"{clase} En esta edición, los grupos {', '.join(grupos)} no la tienen (grupos_sin_clase), y el informe no da "
        "para ellos cuántos no sabían cómo usar la IA generativa."
    )
