"""Metadatos estables únicos y datos por evento, con reconstrucción exacta por SHA.

No decide resultados ni sustituye consultas. El envoltorio conserva todos los
campos del documento lógico y su SHA; el escritor conserva ambos archivos bajo
su exclusión/transacción existente. Los recibos históricos íntegros se mantienen.
"""

import hashlib
import json

from plataforma_datos.cursos.contrato_entrega_catalogo import exigir

VERSION = 1


def canonico(dato: dict) -> bytes:
    """Serializa igual que los informes y recibos de Cursos.

    Returns:
        Bytes JSON protegidos, con un único salto final.
    """
    return (
        json.dumps(dato, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n"
    ).encode()


def separar(contenido: bytes, *, campos_evento: frozenset[str]) -> tuple[bytes, bytes]:
    """Separa campos explícitos; ningún dato se resume ni descarta.

    Returns:
        Metadatos estables y evento que permite verificar el documento original exacto.
    """
    dato = leer_json(contenido)
    exigir(isinstance(dato, dict) and canonico(dato) == contenido, "Documento compartido no canónico")
    estables = {k: v for k, v in dato.items() if k not in campos_evento}
    evento = {k: v for k, v in dato.items() if k in campos_evento}
    metadatos = canonico(estables)
    envoltorio = {
        "formato_recibo": VERSION,
        "metadatos_sha256": hashlib.sha256(metadatos).hexdigest(),
        "datos": evento,
        "contenido_sha256": hashlib.sha256(contenido).hexdigest(),
    }
    return metadatos, canonico(envoltorio)


def _pares(pares: list) -> dict:
    dato = {}
    for clave, valor in pares:
        exigir(clave not in dato, "Campo repetido en recibo")
        dato[clave] = valor
    return dato


def _constante(_valor: str) -> None:
    raise ValueError("Número no JSON en recibo")


def leer_json(contenido: bytes) -> dict:
    """Lee JSON sin duplicados ni constantes no finitas.

    Returns:
        Objeto cuya forma concreta sigue validando el lector de su contrato.
    """
    return json.loads(contenido, object_pairs_hook=_pares, parse_constant=_constante)


def reconstruir(evento: bytes, metadatos: bytes) -> bytes:
    """Comprueba referencias y restaura todos los bytes del recibo lógico.

    Returns:
        Documento canónico original, protegido por su SHA completo.
    """
    dato = leer_json(evento)
    exigir(
        isinstance(dato, dict)
        and set(dato) == {"formato_recibo", "metadatos_sha256", "datos", "contenido_sha256"}
        and type(dato["formato_recibo"]) is int
        and dato["formato_recibo"] == VERSION,
        "Formato de recibo compartido incompatible",
    )
    exigir(hashlib.sha256(metadatos).hexdigest() == dato["metadatos_sha256"], "Metadatos de recibo alterados")
    estables = leer_json(metadatos)
    exigir(
        isinstance(estables, dict) and isinstance(dato["datos"], dict) and not set(estables) & set(dato["datos"]),
        "Campos de recibo compartido incompatibles",
    )
    contenido = canonico({**estables, **dato["datos"]})
    exigir(hashlib.sha256(contenido).hexdigest() == dato["contenido_sha256"], "Recibo lógico alterado")
    return contenido
