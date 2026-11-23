"""FUNDAE: las ediciones que se publican, compuestas desde la última consulta de fichas y la salida anterior.

Son las reglas de vigencia del proyecto (plataforma_datos/cursos/vigencia.py) aplicadas a una edición:
- entra la edición que el índice descubre con la preinscripción abierta en su ficha, con la evidencia de sus fichas;
- una edición publicada que falta en el índice, o cuya consulta falla, se conserva tal como estaba, con su
  evidencia anterior: una ausencia o un fallo de consulta no dan de baja ni rejuvenecen;
- el plazo individual publicado puede cerrar la preinscripción aunque la consulta del día falle;
- una edición sin evidencia de sus fichas no se conserva.
"""

from http import HTTPStatus
from typing import Any

from plataforma_datos.cursos.fuentes.fundae import hechos

FICHAS = ("indice", "difusiones", "centro", "colectivos")


def con_evidencia(evidencias: dict[str, Any], identificador: str) -> bool:
    """Si una edición tiene la evidencia completa de su índice y sus tres fichas, todas respondidas con 200.

    Returns:
        True si cada consulta tiene dirección, código 200, hora, cuerpo y recibo.
    """
    prueba = evidencias.get(identificador)
    return isinstance(prueba, dict) and all(
        isinstance(prueba.get(n), dict)
        and prueba[n].get("http") == HTTPStatus.OK
        and isinstance(prueba[n].get("cuerpo"), dict)
        and isinstance(prueba[n].get("recibo"), dict)
        and isinstance(prueba[n].get("consultado_utc"), str)
        for n in FICHAS
    )


def motivo_de_retirada(edicion: dict[str, Any], lectura: dict[str, Any]) -> str | None:
    """Por qué deja de publicarse una edición que no ha vuelto a entrar, si consta una evidencia para ello.

    Returns:
        El motivo observado, o None si no hay evidencia que la cierre.
    """
    plazo = lectura["plazos"].get(edicion["id"])
    if plazo is not None and not plazo["inicio"] <= plazo["dia"] <= plazo["fin"]:
        return "plazo-no-abierto-en-su-ficha"
    if edicion["preinscripcion"]["fin"] < hechos.dia_civil(lectura["indice"]["consultado_utc"]):
        return "plazo-vencido"
    return None


def componer(lectura: dict[str, Any], anterior: dict[str, Any] | None) -> dict[str, Any]:
    """Une las ediciones nuevas de la consulta con las anteriores que ninguna evidencia cierra.

    Args:
        lectura: Lo que devuelve `ediciones.leer` para una consulta con el índice respondido.
        anterior: Las ediciones y evidencias de la última salida admitida, o None si no la hay.

    Returns:
        Ediciones ordenadas, su evidencia, y qué se conservó y qué se retiró, con su motivo.
    """
    nuevas = {e["id"]: e for e in lectura["ediciones"]}
    evidencias = {id: lectura["evidencias"][id] for id in nuevas}
    conservadas, retiradas = [], []
    previas = anterior or {"ediciones": [], "evidencias": {}}
    for edicion in previas["ediciones"]:
        if edicion["id"] in nuevas:
            continue
        motivo = (
            motivo_de_retirada(edicion, lectura)
            if con_evidencia(previas["evidencias"], edicion["id"])
            else "sin-evidencia-de-sus-fichas"
        )
        if motivo is not None:
            retiradas.append({"id": edicion["id"], "motivo": motivo})
            continue
        conservadas.append(edicion)
        evidencias[edicion["id"]] = previas["evidencias"][edicion["id"]]
    publicadas = sorted([*nuevas.values(), *conservadas], key=lambda e: (e["especialidad"], int(e["id"])))
    return {
        "ediciones": publicadas,
        "evidencias": evidencias,
        "conservadas": sorted(e["id"] for e in conservadas),
        "retiradas": retiradas,
    }
