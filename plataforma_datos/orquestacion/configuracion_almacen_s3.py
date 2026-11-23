"""Configuración privada del almacén S3 y el error de entrada no admitida que comparte con su adaptador.

La configuración se valida entera antes de construir ningún cliente; sus credenciales no forman parte de su
representación ni de los mensajes de error.
"""

import re
from dataclasses import dataclass, field
from urllib.parse import urlsplit

MAX_PREFIJO = 200
MAX_ACCESS_KEY = 256
MAX_SECRET_KEY = 1024
ERROR_INVALIDO = "Entrada del almacén privado no válida."


class AlmacenS3Invalido(ValueError):
    """Entrada, destino o integridad que no cumple el contrato privado."""


def _exigir(condicion: bool) -> None:
    if not condicion:
        raise AlmacenS3Invalido(ERROR_INVALIDO)


@dataclass(frozen=True, kw_only=True)
class ConfiguracionAlmacenS3:
    """Configuración privada explícita; nunca consulta el entorno ni representa credenciales."""

    endpoint: str
    bucket: str
    prefijo: str
    region: str
    access_key_id: str = field(repr=False)
    secret_access_key: str = field(repr=False)

    def __post_init__(self) -> None:
        """Rechaza configuración inválida antes de construir cualquier cliente del SDK.

        Raises:
            AlmacenS3Invalido: Si falta una expectativa o tiene una forma no admitida.
        """
        try:
            comprobar_configuracion(self)
        except (TypeError, ValueError):
            raise AlmacenS3Invalido(ERROR_INVALIDO) from None


def comprobar_configuracion(configuracion: ConfiguracionAlmacenS3) -> None:
    """Exige destino HTTPS sin credenciales en la URL, bucket, prefijo y región cerrados y credenciales acotadas.

    Raises:
        AlmacenS3Invalido: Si algún campo no tiene la forma admitida.
    """
    _exigir(isinstance(configuracion, ConfiguracionAlmacenS3))
    _exigir(all(isinstance(getattr(configuracion, campo), str) for campo in configuracion.__dataclass_fields__))
    endpoint = urlsplit(configuracion.endpoint)
    _exigir(endpoint.scheme == "https" and bool(endpoint.hostname) and endpoint.netloc.isascii())
    _exigir(endpoint.username is None and endpoint.password is None and not endpoint.path)
    _exigir(not endpoint.query and not endpoint.fragment and endpoint.port != 0)
    _exigir(endpoint.geturl() == configuracion.endpoint and not re.search(r"[\s\x00-\x1f\x7f]", configuracion.endpoint))
    _exigir(re.fullmatch(r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]", configuracion.bucket) is not None)
    _exigir(".." not in configuracion.bucket)
    _exigir(isinstance(configuracion.prefijo, str) and len(configuracion.prefijo) <= MAX_PREFIJO)
    for parte in configuracion.prefijo.split("/") if configuracion.prefijo else ():
        _exigir(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", parte) is not None and parte not in (".", ".."))
    _exigir(re.fullmatch(r"[a-z0-9][a-z0-9-]{0,62}", configuracion.region) is not None)
    for valor, limite in (
        (configuracion.access_key_id, MAX_ACCESS_KEY),
        (configuracion.secret_access_key, MAX_SECRET_KEY),
    ):
        _exigir(
            isinstance(valor, str) and 0 < len(valor) <= limite and re.fullmatch(r"[\x21-\x7e]+", valor) is not None
        )
