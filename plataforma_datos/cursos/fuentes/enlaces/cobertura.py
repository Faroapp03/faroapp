"""Qué acredita un ciclo de la comprobación de enlaces: haber consultado su turno, no todos los enlaces.

La fuente reparte su trabajo entre ciclos (`lector.comprobar_ciclo`): consulta los enlaces más atrasados hasta un tope
de consultas o de tiempo, o hasta que un dominio pide que se le deje en paz, y deja el resto para los ciclos siguientes.
Que queden enlaces sin consultar es el diseño, no un fallo. Un ciclo queda acreditado si su conjunto se validó, consultó
su turno entero, dejó una observación propia de cada enlace consultado y alguna fue concluyente; si todo fueron cortes
de red, errores de servidor o dominios que piden que se les deje en paz, no hay nada que acreditar.
"""

import json
from datetime import datetime
from pathlib import Path

from plataforma_datos.comun.entrada_salida import entradas_procedencia, leer_json, sha256_bytes
from plataforma_datos.comun.nucleo import ARCHIVO_DE_PROCEDENCIA, DATOS_RELATIVOS, ErrorFuente
from plataforma_datos.cursos.fuentes.enlaces import lector
from plataforma_datos.cursos.fuentes.enlaces.observaciones import CONJUNTOS, INCONCLUYENTE
from plataforma_datos.orquestacion.admision import exigir_admitido

# Un ciclo cortado por el plazo dura el plazo menos, como mucho, el segundo que pierde un instante sin fracción.
MARGEN_DEL_PLAZO_S = 1


def _ciclo_admitido(raiz: Path) -> tuple[dict, dict]:
    """Las observaciones guardadas por el último ciclo, comprobadas contra su procedencia y su validación admitida.

    Returns:
        Las observaciones y el ciclo que las escribió.

    Raises:
        ErrorFuente: Si la validación no se admitió, no es la de estas observaciones o su conjunto falta.
    """
    originales = raiz / DATOS_RELATIVOS / "originales" / lector.FUENTE
    validados = raiz / DATOS_RELATIVOS / "validados" / lector.FUENTE
    informe = exigir_admitido(lector.FUENTE, ruta=validados / "validacion.json")
    contenido = (originales / lector.OBSERVACIONES).read_bytes()
    [entrada] = entradas_procedencia(leer_json(originales / ARCHIVO_DE_PROCEDENCIA))
    observaciones = json.loads(contenido)
    ciclo = observaciones["ciclo"]
    cobertura = informe["cobertura"]
    coherente = (
        entrada["archivo"] == lector.OBSERVACIONES
        and entrada["sha256"] == informe["observaciones_sha256"] == sha256_bytes(contenido)
        and observaciones["version"] == lector.VERSION
        and informe["comprobado_utc"] == ciclo["terminado_utc"]
        and cobertura["candidatos"] == ciclo["candidatos"]
        and cobertura["consultadas"] == ciclo["consultadas"]
        and (validados / f"{lector.FUENTE}.json").is_file()
    )
    if not coherente:
        raise ErrorFuente("enlaces: la validación admitida no es la de las últimas observaciones")
    return observaciones, ciclo


def _turno_consultado(ciclo: dict, duracion_s: float) -> bool:
    """Si el ciclo consultó los enlaces que le tocaban: todos, o hasta su tope, su plazo o el freno de un dominio.

    Returns:
        False si los recuentos no cuadran, no consultó nada o dejó enlaces sin que nada lo explique.
    """
    candidatos, consultadas, pendientes = ciclo["candidatos"], ciclo["consultadas"], ciclo["sin_consultar"]
    corte, frenados = ciclo["corte"], ciclo.get("dominios_con_limite", [])
    if not all(type(n) is int for n in (candidatos, consultadas, pendientes)):
        return False
    if consultadas < 1 or consultadas + pendientes != candidatos:
        return False
    # El día de la pasada larga, el ciclo tiene sus propios topes (`porcion.topes_del_dia`).
    largo = ciclo.get("dia_largo") is True
    if corte == lector.TOPE:
        return consultadas >= (lector.MAX_CONSULTAS_DIA_LARGO if largo else lector.MAX_CONSULTAS)
    if corte == lector.PLAZO:
        return duracion_s >= (lector.PLAZO_S_DIA_LARGO if largo else lector.PLAZO_S) - MARGEN_DEL_PLAZO_S
    return corte is None and (pendientes == 0 or bool(frenados))


def comprobada(raiz: Path, evidencia: dict) -> bool:
    """Exige el conjunto validado del ciclo, su turno consultado, una observación de cada consulta y alguna concluyente.

    La evidencia es la recepción de la descarga: las observaciones han de ser de su ventana de tiempo y quedar
    vinculadas por su huella a la procedencia que admitió la validación. Cualquier forma inesperada da False.

    Returns:
        True solo si el ciclo acredita su turno; False si falta algo o ninguna consulta fue concluyente.
    """
    peticiones = evidencia.get("peticiones")
    if not isinstance(peticiones, list) or not peticiones:
        return False
    try:
        observaciones, ciclo = _ciclo_admitido(raiz)
        comienzo = datetime.fromisoformat(evidencia["comienzo_utc"]).replace(microsecond=0)
        fin = datetime.fromisoformat(evidencia["fin_utc"])
        terminado = datetime.fromisoformat(ciclo["terminado_utc"])
        if not comienzo <= terminado <= fin or not _turno_consultado(ciclo, (terminado - comienzo).total_seconds()):
            return False
        estado = observaciones["enlaces"]
        propias = [
            ultima
            for conjunto in CONJUNTOS
            for enlace in estado[conjunto].values()
            if (ultima := enlace["ultima"]) is not None
            and comienzo <= datetime.fromisoformat(ultima["observado_el"]) <= terminado
        ]
        return len(propias) == ciclo["consultadas"] and any(o["resultado"] != INCONCLUYENTE for o in propias)
    except (ErrorFuente, OSError, ValueError, KeyError, TypeError, AttributeError):
        return False
