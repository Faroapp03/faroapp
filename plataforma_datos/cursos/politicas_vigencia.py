"""Carga explícita de políticas internas Faro; no consulta red ni decide disponibilidad.

El recurso versionado es la única configuración del plazo de revisión interna
(TTL), que solo avisa en el panel. Las versiones anteriores siguen registradas e
intactas porque el historial las cita por huella. El índice estático
identifica su casa y bytes revisados, no duplica valores operativos. No convierte
cadencia del descriptor en TTL ni adopta una zona de la máquina. La referencia
conserva SHA del artefacto real, sin fingir una captura o URL del proveedor.
"""

import hashlib
import json
import stat
from copy import deepcopy
from pathlib import Path

from plataforma_datos.cursos.tipos_json import ObjetoJson
from plataforma_datos.cursos.vigencia import CAMPOS_POLITICA, ErrorVigencia

RAIZ_POLITICAS = Path(__file__).parent
MAX_POLITICA_BYTES = 16 * 1024
# Estados de `revision_equipo_faro.estado` admitidos al cargar: el criterio aprobado o propuesto por el equipo. Es un
# registro editorial y no activa ni desactiva ofertas (significado de cada uno en el README de Cursos).
ESTADOS_REVISION = frozenset({"criterio-aprobado-sin-activacion", "criterio-propuesto-sin-activacion"})
CAMPOS_REVISION = {"estado", "fecha", "alcance"}
POLITICAS = {
    ("fundae", "1"): (
        "fuentes/fundae/politica_vigencia_v1.json",
        "1d1058152d6d4064f89c8734ed822bc6c1bdc998d415d57b2200f454d110788d",
    ),
    ("cibervoluntarios", "1"): (
        "fuentes/cibervoluntarios/politica_vigencia_v1.json",
        "e79001c51e63f4986c002b8b1a17239f0df6015f7369f0c3c2f8dc4d9878b527",
    ),
    ("claude_academy", "1"): (
        "fuentes/claude_academy/politica_vigencia_v1.json",
        "e1689e313dc05e3d5433391745d756cb31d35099785c899b45b9588217a0f2a8",
    ),
    ("hp_life", "1"): (
        "fuentes/hp_life/politica_vigencia_v1.json",
        "53392daf582789f0886589e3488abc56b9dd4fddf78fc2615b9b91766a52b8f7",
    ),
    ("barcelonactiva", "1"): (
        "fuentes/barcelonactiva/politica_vigencia_v1.json",
        "2bc5e6c370a3a428db00de5c91130d29ef295206cb7c5232c80103c2657d9fcd",
    ),
    ("barcelonactiva", "2"): (
        "fuentes/barcelonactiva/politica_vigencia_v2.json",
        "188956c9e0c820c00b44a865d3ec084660a7bc10ca2394fe978a7aa16ae789e7",
    ),
    ("fundae", "2"): (
        "fuentes/fundae/politica_vigencia_v2.json",
        "767f163a66ebd1c9e1d78c95088a2cd3a441e310e21a33b3875a004d227e0952",
    ),
    ("fundae", "3"): (
        "fuentes/fundae/politica_vigencia_v3.json",
        "e60b55992ec68f1b1a84bb2f035b2e5cca520eedceb5d44850617b5d49efcde3",
    ),
    ("cibervoluntarios", "2"): (
        "fuentes/cibervoluntarios/politica_vigencia_v2.json",
        "cdadbf8529e1328edc6332b779677569ca85098ff73a2d578676146ae1487277",
    ),
    ("claude_academy", "2"): (
        "fuentes/claude_academy/politica_vigencia_v2.json",
        "d140a81a0719118ddfe1542b4a7407aa306a49a0d15aba05a030b7be8ac79331",
    ),
    ("hp_life", "2"): (
        "fuentes/hp_life/politica_vigencia_v2.json",
        "f851d38df9b214e9a731c0a36e2ba611670eee7c9ab7e10c12e9d13222f1b822",
    ),
    ("cibervoluntarios", "3"): (
        "fuentes/cibervoluntarios/politica_vigencia_v3.json",
        "98438af807f77fb9dd1e3c5d5c22e948cb7082d09aed226cf67b1146a3705a9e",
    ),
    ("hp_life", "3"): (
        "fuentes/hp_life/politica_vigencia_v3.json",
        "453972d7dd8e4b32b606742c9b98b847cca47889b3fa74fbd8df594b34ac1f84",
    ),
    ("barcelonactiva", "3"): (
        "fuentes/barcelonactiva/politica_vigencia_v3.json",
        "6cbc99d5145a2a82c3ae574b408f720d6116ab64965da3d2f770fcbdb9fa5dc1",
    ),
}


def _leer_recurso(ruta: Path, esperada: str) -> ObjetoJson:
    """Lee un recurso propio acotado y exige los bytes revisados.

    Returns:
        Documento JSON cuya huella coincide con el índice estático.

    Raises:
        ErrorVigencia: Si el archivo no es regular, se alteró o no tiene forma JSON de objeto.
    """
    try:
        informacion = ruta.lstat()
        if not stat.S_ISREG(informacion.st_mode) or informacion.st_nlink != 1:
            raise ErrorVigencia("La política interna exige un recurso regular propio")
        with ruta.open("rb") as archivo:
            contenido = archivo.read(MAX_POLITICA_BYTES + 1)
    except OSError as error:
        raise ErrorVigencia("El recurso de política interna no está disponible") from error
    if len(contenido) > MAX_POLITICA_BYTES or hashlib.sha256(contenido).hexdigest() != esperada:
        raise ErrorVigencia("La política interna no conserva su huella revisada")
    documento = json.loads(contenido)
    if not isinstance(documento, dict):
        raise ErrorVigencia("La política interna debe ser un objeto")
    return documento


def _exigir_revision(documento: ObjetoJson) -> None:
    """Exige un registro de revisión cerrado: estado de ESTADOS_REVISION, sin fecha de activación y con alcance.

    Raises:
        ErrorVigencia: Si falta, tiene otros campos o un estado desconocido.
    """
    revision = documento.get("revision_equipo_faro")
    if (
        not isinstance(revision, dict)
        or set(revision) != CAMPOS_REVISION
        or revision["estado"] not in ESTADOS_REVISION
        or revision["fecha"] is not None
        or not isinstance(revision["alcance"], str)
        or not revision["alcance"].strip()
    ):
        raise ErrorVigencia("La política interna no tiene un estado de revisión admitido")


def leer_politica(fuente_id: str, version: str) -> ObjetoJson:
    """Construye la política del evaluador a partir de un recurso estático verificado.

    Returns:
        Política y referencia interna tipada; no realiza evaluación ni activación.

    Raises:
        ErrorVigencia: Si no existe la versión estática o no coincide con su contrato.
    """
    referencia = POLITICAS.get((fuente_id, version))
    if referencia is None:
        raise ErrorVigencia("Política interna o versión no registrada")
    relativa, sha256 = referencia
    documento = _leer_recurso(RAIZ_POLITICAS / relativa, sha256)
    # plazo_tecnico es opcional al leer porque hay versiones registradas sin él; el evaluador lo exige para evaluar.
    base = set(CAMPOS_POLITICA) - {"fuente_id", "version", "evidencias", "plazo_tecnico"}
    if (
        documento.get("schema_version") != 1
        or documento.get("id") != "faro:vigencia:" + fuente_id
        or documento.get("fuente_id") != fuente_id
        or documento.get("version") != version
        or documento.get("naturaleza") != "politica-interna-operativa"
        or not isinstance(documento.get("criterios"), dict)
        or set(documento["criterios"])
        not in (
            base,
            base | {"regla_disponibilidad"},
            base | {"plazo_tecnico"},
            base | {"plazo_tecnico", "regla_disponibilidad"},
        )
    ):
        raise ErrorVigencia("Contrato de política interna no coherente")
    _exigir_revision(documento)
    return {
        "fuente_id": fuente_id,
        "version": version,
        **deepcopy(documento["criterios"]),
        "evidencias": [
            {
                "alcance": "politica",
                "tipo": "interna-faro",
                "documento_id": documento["id"],
                "version": version,
                "sha256": sha256,
                "localizador": {"tipo": "campo", "valor": "/criterios"},
            }
        ],
    }
