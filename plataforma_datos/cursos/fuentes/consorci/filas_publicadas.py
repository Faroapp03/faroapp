"""Lo que dicen por sí solas las filas de qv5z-dgk3: sus fechas, su modalidad y el identificador de cada edición.

Lo comparten la preparación (`lector.py`) y el registro de lecturas (`lectura.py`): así el identificador de una edición
se define en un solo lugar y el registro no necesita importar la descarga.
"""

import re
from datetime import date, datetime
from typing import Any

from plataforma_datos.comun.textos_y_cifras import texto
from plataforma_datos.cursos.fuentes.consorci.constantes import LETRA_DE_MODALIDAD

# Las dos fechas de una edición dentro de su identificador: «…-20261112-20261126-p». Una fecha que la fila no publica
# deja su hueco vacío.
_FECHAS_DEL_IDENTIFICADOR = re.compile(r"-(\d{8})?-(\d{8})?-[a-z]$")


def fecha_iso(fecha: str) -> str | None:
    """Fecha de la API (ISO con hora, o dd/mm/aaaa en jdcj-za6r) en AAAA-MM-DD; None si no es una fecha.

    Returns:
        La fecha AAAA-MM-DD, o None si el valor no es una fecha posible.
    """
    valor = texto(fecha)
    try:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}T.*", valor):
            return date.fromisoformat(valor[:10]).isoformat()
        if re.fullmatch(r"\d{2}/\d{2}/\d{4}", valor):
            return datetime.strptime(valor, "%d/%m/%Y").date().isoformat()
    except ValueError:
        # Una fecha con su forma pero imposible («31/02/2026»): no se inventa, la fila se queda sin esa fecha.
        return None
    return None


def clave_de_edicion(fila: dict[str, Any]) -> tuple[str, ...]:
    """Lo que identifica una edición: acción, grupo, fechas, entidad, municipio y modalidad.

    Dos filas iguales en todo esto son la misma edición repetida.

    Returns:
        Los campos que la identifican, normalizados.
    """
    campos = (
        "identificador",
        "num_grup",
        "data_inici",
        "data_final",
        "nif_entitat_formaci",
        "codi_municipi",
        "modalitat",
    )
    return tuple(texto(fila.get(campo)) for campo in campos)


def modalidad_de_la_edicion(fila: dict[str, Any]) -> str:
    """Modalidad de una edición tal como la guarda Faro: la publicada, con la primera letra en mayúscula.

    «adaptada a Aula virtual» empieza en minúscula; las demás modalidades, no.

    Returns:
        La modalidad normalizada.
    """
    modalidad = texto(fila["modalitat"])
    return modalidad[:1].upper() + modalidad[1:]


def id_de_edicion(fila: dict[str, Any]) -> str:
    """Identificador de una edición: acción, grupo, fechas de inicio y fin, y la letra de su modalidad.

    Una misma acción se publica a veces con las mismas fechas en dos modalidades, que son dos ediciones.

    Returns:
        El identificador de la edición.
    """
    inicio, fin = fecha_iso(fila["data_inici"]), fecha_iso(fila["data_final"])
    fechas = f"{(inicio or '').replace('-', '')}-{(fin or '').replace('-', '')}"
    letra = LETRA_DE_MODALIDAD.get(modalidad_de_la_edicion(fila), "x")
    return f"{texto(fila.get('identificador'))}-{texto(fila.get('num_grup'))}-{fechas}-{letra}"


def fechas_de_la_edicion(identificador: str) -> tuple[str | None, str | None]:
    """Inicio y fin que lleva dentro el identificador de una edición, en AAAA-MM-DD.

    Returns:
        El inicio y el fin; None en la fecha que la fila no publicó o si el identificador no es de una edición.
    """
    coincidencia = _FECHAS_DEL_IDENTIFICADOR.search(identificador)
    if coincidencia is None:
        return None, None
    inicio, fin = (None if f is None else f"{f[:4]}-{f[4:6]}-{f[6:]}" for f in coincidencia.groups())
    return inicio, fin
