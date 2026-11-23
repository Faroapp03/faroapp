"""Hechos de recepción HTTP separados de identidad, editorial y capturas históricas."""

from collections.abc import Callable, Mapping
from datetime import datetime
from urllib.parse import urlsplit

from plataforma_datos.biblioteca.fuentes.enlaces_lecturas.contrato import url_web
from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.comun.perfil_web import PAGINA, Uso

HTTP_PARCIAL = 206
CABECERAS_TECNICAS = frozenset(
    {"content-type", "content-length", "content-range", "content-encoding", "transfer-encoding"}
)


class RespuestaParcial(FormatoInesperado):
    """Una respuesta parcial no es una comprobación completa ni evidencia de retirada."""


class CabecerasContradictorias(FormatoInesperado):
    """La respuesta no declara un tipo de contenido único verificable."""


class DestinoNoSeguro(FormatoInesperado):
    """La respuesta recibida dejó de utilizar una URL HTTPS sin credenciales."""


def perfil_objetivo(url: str) -> tuple[dict[str, str], Uso]:
    """Negocia PDF como datos y HTML sin preferencia que cambie la variante lingüística.

    Returns:
        Cabeceras de negociación y elección del perfil central; ninguna identidad propia.
    """
    if urlsplit(url).path.lower().endswith(".pdf"):
        return {"Accept": "application/pdf"}, "datos"
    return {k: v for k, v in PAGINA.items() if k.lower() != "accept-language"}, "idioma-original"


def cabeceras_tecnicas(cabeceras: Mapping[str, str]) -> dict[str, list[str]]:
    """Conserva valores y multiplicidad con nombres normalizados, sin cookies ni credenciales.

    Returns:
        Solo los cinco campos técnicos necesarios para verificar framing, formato y límites.
    """
    resultado: dict[str, list[str]] = {}
    for nombre, valor in cabeceras.items():
        clave = nombre.lower()
        if clave in CABECERAS_TECNICAS:
            resultado.setdefault(clave, []).append(valor)
    return resultado


class ControlHTTP:
    """Guarda lo realmente recibido antes de validar formato o identidad del documento."""

    def __init__(self, url: str, reloj: Callable[[], datetime]) -> None:
        """Inicia una observación sin inventar status ni fecha de respuesta."""
        self.url = url
        self.reloj = reloj
        self.codigo: int | None = None
        self.destino: str | None = None
        self.cabeceras: dict[str, list[str]] = {}
        self.fecha_cabeceras: str | None = None

    def anotar(self, codigo: int, destino: str, cabeceras: Mapping[str, str]) -> None:
        """Conserva cabeceras también cuando urllib rechaza un status HTTP."""
        self.codigo = codigo
        self.destino = destino
        self.cabeceras = cabeceras_tecnicas(cabeceras)
        self.fecha_cabeceras = self.reloj().isoformat()

    def comprobar(self, codigo: int, destino: str, cabeceras: Mapping[str, str]) -> None:
        """Rechaza parciales antes de leer; la cabecera recibida no acredita identidad.

        Raises:
            RespuestaParcial: Si es 206 o existe cualquier Content-Range.
            CabecerasContradictorias: Si declara tipos de contenido incompatibles.
            DestinoNoSeguro: Si el destino dejó de ser HTTPS público.
        """
        self.anotar(codigo, destino, cabeceras)
        if codigo == HTTP_PARCIAL or "content-range" in self.cabeceras:
            raise RespuestaParcial("enlaces_lecturas: respuesta HTTP parcial, sin comprobación completa")
        tipos = {tipo.strip().lower() for tipo in self.cabeceras.get("content-type", [])}
        if len(tipos) > 1:
            raise CabecerasContradictorias("enlaces_lecturas: tipos HTTP contradictorios")
        try:
            url_web(destino)
        except FormatoInesperado as error:
            raise DestinoNoSeguro("enlaces_lecturas: destino de respuesta no seguro") from error

    def hechos(self, completa: bool) -> dict[str, object]:
        """Expone hechos acotados, sin copiar el cuerpo ni atribuir acceso a un error.

        Returns:
            Documento versionado sin ninguna fecha de captura fabricada.

        Raises:
            FormatoInesperado: Si el transporte no invocó el control antes de declarar éxito.
        """
        if completa and self.codigo is None:
            raise FormatoInesperado("enlaces_lecturas: respuesta sin control HTTP")
        return {
            "version": 1,
            "url": self.url,
            "url_final": self.destino,
            "codigo_http": self.codigo,
            "cabeceras": self.cabeceras,
            "cabeceras_recibidas_utc": self.fecha_cabeceras,
            "cuerpo_completo": completa,
        }
