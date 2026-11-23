"""Comprueba hechos editoriales con el mismo contrato TypeScript que consume el informe.

La autoría es registro.json en git. Validar no revisa fuentes ni renueva fechas; escribe
solo una admisión estructural ligada a los bytes y contratos actuales. No exporta un
paquete opcional, no descarga, no prepara originales y no modifica cifras.
"""

import json
import subprocess
import sys
from datetime import date
from pathlib import Path

from plataforma_datos.comun.entrada_salida import ahora_utc, sha256, sha256_bytes
from plataforma_datos.comun.nucleo import Controles, FormatoInesperado
from plataforma_datos.orquestacion.admision import cerrar_validacion
from plataforma_datos.orquestacion.ordenes import principal_fuente

FUENTE = "hechos_informe"
CASA = Path(__file__).resolve().parent
RAIZ = CASA.parents[3]
REGISTRO_RELATIVO = "plataforma_datos/ia_y_trabajo/fuentes/hechos_informe/registro.json"
REGISTRO = CASA / "registro.json"
COMPROBADOR = RAIZ / "herramientas/web/comprobar-hechos-informe.ts"
PLAZO_NODE_S = 30
CONTRATOS = (
    "src/dominio/registro-hechos-del-informe.ts",
    "src/comun/json.ts",
    "src/comun/tiempo.ts",
    "herramientas/web/comprobar-hechos-informe.ts",
    "plataforma_datos/ia_y_trabajo/fuentes/hechos_informe/fuente.json",
    "plataforma_datos/ia_y_trabajo/fuentes/hechos_informe/lector.py",
)


def fecha_revision(raiz: Path) -> date | None:
    """Fecha editorial declarada; nunca usa la fecha de ejecutar ni el mtime.

    Returns:
        Fecha del registro, o None si todavía no está en la copia observada.

    Raises:
        FormatoInesperado: Si la revisión presente no es JSON o una fecha ISO completa.
    """
    ruta = raiz / REGISTRO_RELATIVO
    if not ruta.exists():
        return None
    try:
        valor = json.loads(ruta.read_text(encoding="utf-8"))["revision"]["fecha"]
        declarada = date.fromisoformat(valor)
    except (ValueError, TypeError, KeyError, UnicodeError) as error:
        raise FormatoInesperado("hechos_informe: revisión editorial no válida") from error
    if declarada.isoformat() != valor:
        raise FormatoInesperado("hechos_informe: revisión editorial no canónica")
    return declarada


def validar() -> None:
    """Admite el contrato y registra el plazo sin fingir revisión humana nueva.

    Raises:
        FormatoInesperado: Si Node falla o cambia la entrada durante su comprobación.
    """
    contenido = REGISTRO.read_bytes()
    try:
        resultado = subprocess.run(
            ["node", str(COMPROBADOR), str(REGISTRO)],
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=PLAZO_NODE_S,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise FormatoInesperado("hechos_informe: comprobador local no disponible o fuera de plazo") from error
    if resultado.returncode:
        raise FormatoInesperado("hechos_informe: " + resultado.stderr.strip())
    try:
        resumen = json.loads(resultado.stdout)
        registro = json.loads(contenido)
    except (ValueError, UnicodeError) as error:
        raise FormatoInesperado("hechos_informe: respuesta local o registro no JSON") from error
    if (
        not isinstance(resumen, dict)
        or resumen.get("remoto") is not False
        or resumen.get("revision") != registro["revision"]["fecha"]
        or REGISTRO.read_bytes() != contenido
    ):
        raise FormatoInesperado("hechos_informe: resultado incoherente o entrada cambiada durante la validación")
    controles = Controles()
    controles.comprobar(True, "contrato TS de significado, magnitudes y procedencia por afirmación")
    controles.comprobar(True, "plazo editorial calculado sin invalidar hechos ni renovar la revisión")
    controles.comprobar(True, "bytes del registro iguales antes y después de comprobar")
    informe = {
        "estado": controles.estado,
        "comprobado_utc": ahora_utc(),
        "entradas": {REGISTRO_RELATIVO: sha256_bytes(contenido), **{p: sha256(RAIZ / p) for p in CONTRATOS}},
        "conjunto_sha256": sha256_bytes(contenido),
        "revision_editorial": {
            "fecha_declarada": resumen["revision"],
            "vence": resumen["vence"],
            "pendiente": resumen["revision_pendiente"],
        },
        "comprobacion_remota": False,
        "controles": controles.lista,
    }
    cerrar_validacion(FUENTE, informe, controles, conjunto=lambda: registro)


def main(argv: list[str] | None = None) -> int:
    """Solo validar: otras etapas se rechazan antes de escribir.

    Returns:
        Código de la interfaz común.
    """
    return principal_fuente(__doc__, {"validar": validar}, argv)


if __name__ == "__main__":
    sys.exit(main())
