"""Lo que se observó al pedir una dirección: la forma común de la página de un curso y de la sonda de su dominio."""

from dataclasses import dataclass


@dataclass(frozen=True, kw_only=True)
class Respuesta:
    """La respuesta a una petición GET, tal como la dejó el transporte.

    `http` es `None` cuando no hubo respuesta (error de red, plazo o certificado). `url_final` es la dirección tras
    seguir las redirecciones y `saltos` cuántas fueron.
    """

    url: str
    http: int | None
    url_final: str | None = None
    saltos: int = 0
    tipo: str | None = None
    cuerpo: bytes = b""


@dataclass(frozen=True, kw_only=True)
class Curso:
    """El curso cuya página se comprueba: su identificador, su fuente y el título con que se publica."""

    id: str
    fuente: str
    titulo: str
