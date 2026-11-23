"""Contrato `comprobacion-api` versión 1: lo que respondió la API de una fuente sobre un curso y qué dice de él.

Una comprobación guarda la dirección de la API que se pidió, la hora, el estado HTTP, el tipo y la huella del cuerpo,
el dato literal de la fuente que sostiene el veredicto, el veredicto, su motivo y la regla que lo decidió. Los
veredictos son los mismos que los de la página (`comprobacion_pagina.contrato.VEREDICTOS`), así que una retirada se
cuenta igual venga de una o de otra; la regla de cada comprobación dice de dónde sale.
"""

from dataclasses import dataclass

from plataforma_datos.cursos.clasificacion.contrato import CAMPOS_REGLA, Regla
from plataforma_datos.cursos.comprobacion_pagina import contrato as de_pagina
from plataforma_datos.cursos.lecturas.contrato_lectura import FUENTE, INSTANTE, MAX_FUENTE, SHA256
from plataforma_datos.cursos.tipos_json import ObjetoJson, ValorJson

CONTRATO = "comprobacion-api"
VERSION = 1
CAMPOS = (
    "version",
    "curso",
    "fuente",
    "url",
    "pedido_utc",
    "http",
    "tipo",
    "sha256_cuerpo",
    "dato",
    "veredicto",
    "motivo",
    "regla",
)
VEREDICTOS = de_pagina.VEREDICTOS
# Qué motivos admite cada veredicto: el motivo dice qué respondió la API, con una regla de la lista.
MOTIVOS: dict[str, tuple[str, ...]] = {
    "disponible": ("en_la_oferta_de_hoy", "material_disponible", "plazo_abierto"),
    "cerrado": ("fin_pasado", "material_borrado", "material_descatalogado", "plazo_terminado"),
    "no_existe": ("ausente_de_la_oferta", "http_no_encontrada"),
    "dudoso": (
        "acceso_rechazado",
        "estado_desconocido",
        "fechas_ilegibles",
        "filtro_no_aplicado",
        "identificador_distinto",
        "pagina_de_comprobacion",
        "plazo_sin_abrir",
        "respuesta_con_otra_forma",
    ),
    "sin_respuesta": ("error_de_red", "error_del_servidor"),
}
MAX_TIPO = 200


def exigir(condicion: object, motivo: str) -> None:
    """Rechaza un incumplimiento con un mensaje que dice qué campo falla y por qué.

    Raises:
        ErrorComprobacion: Si la condición no se cumple.
    """
    if not condicion:
        raise de_pagina.ErrorComprobacion(f"{CONTRATO}: {motivo}")


def _texto(valor: ValorJson, lugar: str, maximo: int = de_pagina.MAX_TEXTO) -> None:
    exigir(isinstance(valor, str) and 0 < len(valor) <= maximo, f"{lugar}: texto vacío o demasiado largo")
    imprimible = all(ord(c) >= de_pagina.PRIMER_IMPRIMIBLE and ord(c) != de_pagina.BORRAR for c in valor)
    exigir(imprimible, f"{lugar}: texto con caracteres de control")


def _respuesta(comprobacion: ObjetoJson) -> None:
    http, tipo = comprobacion["http"], comprobacion["tipo"]
    exigir(http is None or (type(http) is int and de_pagina.PRIMER_HTTP <= http <= de_pagina.ULTIMO_HTTP), "http")
    exigir(http is not None or tipo is None, "una API sin respuesta no lleva tipo")
    if tipo is not None:
        _texto(tipo, "tipo", MAX_TIPO)
    huella = comprobacion["sha256_cuerpo"]
    exigir(isinstance(huella, str) and SHA256.fullmatch(huella) is not None, "sha256_cuerpo: huella no válida")


def _veredicto(comprobacion: ObjetoJson) -> None:
    veredicto, motivo, http = comprobacion["veredicto"], comprobacion["motivo"], comprobacion["http"]
    exigir(veredicto in VEREDICTOS, "veredicto no admitido")
    exigir(motivo in MOTIVOS[veredicto], "motivo no admitido para ese veredicto")
    if veredicto == "sin_respuesta":
        exigir(de_pagina.falla_el_servidor(http), "sin_respuesta solo cabe sin estado HTTP o con un error del servidor")
        return
    exigir(not de_pagina.falla_el_servidor(http), f"{veredicto} necesita una respuesta del servidor sin error")


def _regla(regla: ValorJson) -> None:
    exigir(isinstance(regla, dict) and set(regla) == set(CAMPOS_REGLA), "regla: campos")
    exigir(regla["id"] == CONTRATO and regla["version"] == VERSION, "regla: no es la de la comprobación por API")
    exigir(isinstance(regla["sha256"], str) and SHA256.fullmatch(regla["sha256"]) is not None, "regla.sha256")


def validar_comprobacion(comprobacion: ValorJson) -> None:
    """Valida una comprobación por API tal como se guarda: cerrada y coherente consigo misma.

    Raises:
        ErrorComprobacion: Si la comprobación incumple el contrato; el mensaje dice qué campo falla.
    """
    exigir(isinstance(comprobacion, dict), "la comprobación debe ser un objeto")
    exigir(tuple(sorted(comprobacion)) == tuple(sorted(CAMPOS)), "campos: deben ser exactamente los del contrato")
    exigir(type(comprobacion["version"]) is int and comprobacion["version"] == VERSION, "versión no admitida")
    _texto(comprobacion["curso"], "curso")
    fuente = comprobacion["fuente"]
    exigir(isinstance(fuente, str) and len(fuente) <= MAX_FUENTE and FUENTE.fullmatch(fuente), "fuente no admitida")
    _texto(comprobacion["url"], "url", de_pagina.MAX_URL)
    exigir(comprobacion["url"].startswith("https://"), "url: debe ser una dirección https")
    exigir(isinstance(comprobacion["pedido_utc"], str) and INSTANTE.fullmatch(comprobacion["pedido_utc"]), "hora")
    _respuesta(comprobacion)
    if comprobacion["dato"] is not None:
        _texto(comprobacion["dato"], "dato")
    _veredicto(comprobacion)
    _regla(comprobacion["regla"])


def validar_comprobacion_guardada(comprobacion: ValorJson) -> None:
    """Valida una comprobación guardada con el contrato de donde sale: la página del curso o la API de su fuente.

    Raises:
        ErrorComprobacion: Si la comprobación incumple su contrato.
    """
    regla = comprobacion.get("regla") if isinstance(comprobacion, dict) else None
    if isinstance(regla, dict) and regla.get("id") == CONTRATO:
        validar_comprobacion(comprobacion)
        return
    de_pagina.validar_comprobacion(comprobacion)


@dataclass(frozen=True, kw_only=True)
class ComprobacionApi:
    """La comprobación por API de un curso; al construirla se valida exactamente lo que se guardará."""

    curso: str
    fuente: str
    url: str
    pedido_utc: str
    http: int | None
    tipo: str | None
    sha256_cuerpo: str
    dato: str | None
    veredicto: str
    motivo: str
    regla: Regla

    def __post_init__(self) -> None:
        """Rechaza al construirla una comprobación que no cumple el contrato."""
        validar_comprobacion(self.a_json())

    def a_json(self) -> ObjetoJson:
        """Devuelve la comprobación tal como se guarda.

        Returns:
            El objeto de la comprobación, con los campos en el orden del contrato.
        """
        return {
            "version": VERSION,
            "curso": self.curso,
            "fuente": self.fuente,
            "url": self.url,
            "pedido_utc": self.pedido_utc,
            "http": self.http,
            "tipo": self.tipo,
            "sha256_cuerpo": self.sha256_cuerpo,
            "dato": self.dato,
            "veredicto": self.veredicto,
            "motivo": self.motivo,
            "regla": self.regla.a_json(),
        }
