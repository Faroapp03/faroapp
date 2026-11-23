"""La regla que firma cada comprobación por API: su identificador, su versión y la huella del código que decide."""

import hashlib
from functools import cache
from pathlib import Path

from plataforma_datos.cursos.clasificacion.contrato import Regla
from plataforma_datos.cursos.comprobacion_api.consultores import MODULOS_QUE_DECIDEN
from plataforma_datos.cursos.comprobacion_api.contrato import CONTRATO, VERSION


@cache
def regla_de_la_api() -> Regla:
    """La regla con la huella de los consultores, de lo común que comparten y del contrato con sus motivos.

    Returns:
        La regla `comprobacion-api` versión 1.
    """
    carpeta = Path(__file__).parent
    huella = hashlib.sha256(b"".join((carpeta / modulo).read_bytes() for modulo in MODULOS_QUE_DECIDEN)).hexdigest()
    return Regla(id=CONTRATO, version=VERSION, sha256=huella)
