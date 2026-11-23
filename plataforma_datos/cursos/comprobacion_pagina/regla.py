"""La regla que firma cada comprobación: su identificador, su versión y la huella de su código y de lo que declara."""

import hashlib
import json
from dataclasses import asdict
from pathlib import Path

from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.cursos.clasificacion.contrato import Regla
from plataforma_datos.cursos.comprobacion_pagina.reconocedores import RECONOCEDORES
from plataforma_datos.cursos.comprobacion_pagina.vocabulario import APERTURA, CIERRE

IDENTIFICADOR = "comprobacion-pagina"
VERSION = 1
# Los módulos que deciden: cambiar cómo se lee una página cambia la regla que firma cada comprobación.
MODULOS_QUE_DECIDEN = ("analisis.py", "documento.py", "reconocedores.py", "sonda.py", "veredicto.py", "vocabulario.py")


def _huella_del_codigo() -> str:
    carpeta = Path(__file__).parent
    return hashlib.sha256(b"".join((carpeta / modulo).read_bytes() for modulo in MODULOS_QUE_DECIDEN)).hexdigest()


def regla_de_comprobacion() -> Regla:
    """La regla con la huella del código que decide y de los reconocedores y el vocabulario que declara.

    Returns:
        La regla `comprobacion-pagina` versión 1.
    """
    declarado = {
        "apertura": APERTURA,
        "cierre": CIERRE,
        "reconocedores": {fuente: asdict(reconocedor) for fuente, reconocedor in sorted(RECONOCEDORES.items())},
    }
    huella = sha256_json(
        {"codigo_sha256": _huella_del_codigo(), "declarado": json.loads(json.dumps(declarado, sort_keys=True))}
    )
    return Regla(id=IDENTIFICADOR, version=VERSION, sha256=huella)
