"""Contrato `comprobacion-pagina` versión 1: lo que se observó en la página de un curso y qué dice de él.

Una comprobación guarda la respuesta que dio la página (estado, dirección final, saltos, huella del cuerpo), las
señales literales que sostienen el veredicto, la huella de la sonda con la que se comparó, el veredicto, su motivo y la
regla que lo decidió. El veredicto es de una lista cerrada y cada uno tiene sus motivos; este contrato no decide nada:
exige que la comprobación sea coherente consigo misma.

`sin_respuesta` no es evidencia de nada: es lo que queda cuando la página no contestó o el servidor falló.
"""

from dataclasses import dataclass
from datetime import datetime

from plataforma_datos.cursos.clasificacion.contrato import (
    CAMPOS_REGLA,
    IDENTIFICADOR_REGLA,
    MAX_IDENTIFICADOR_REGLA,
    Regla,
)
from plataforma_datos.cursos.lecturas.contrato_lectura import FORMATO_INSTANTE, FUENTE, INSTANTE, MAX_FUENTE, SHA256
from plataforma_datos.cursos.tipos_json import ObjetoJson, ValorJson

CONTRATO = "comprobacion-pagina"
VERSION = 1
CAMPOS = (
    "version",
    "curso",
    "fuente",
    "url",
    "pedido_utc",
    "http",
    "url_final",
    "saltos",
    "longitud_texto",
    "sha256_cuerpo",
    "titulo_presente",
    "senales",
    "sonda_sha256",
    "veredicto",
    "motivo",
    "regla",
)
VEREDICTOS = ("disponible", "cerrado", "no_existe", "dudoso", "sin_respuesta")
# Qué motivos admite cada veredicto: el motivo dice por qué la página se leyó así, con una regla de la lista.
MOTIVOS: dict[str, tuple[str, ...]] = {
    "disponible": ("ficha_con_senal_de_apertura", "datos_publicados_en_la_ficha"),
    "cerrado": ("senal_de_cierre",),
    "no_existe": ("http_no_encontrada", "igual_a_la_sonda"),
    "dudoso": (
        "acceso_rechazado",
        "contenido_con_javascript",
        "datos_con_otro_titulo",
        "datos_sin_publicar",
        "ficha_sin_datos_del_curso",
        "fuente_sin_reconocedor",
        "igual_a_la_sonda_con_titulo",
        "pagina_identica_para_todo",
        "redirige_fuera_de_la_ficha",
        "senales_contradictorias",
        "servidor_igual_a_la_sonda",
        "sin_senal_de_apertura",
        "sin_sonda",
        "texto_muy_corto",
        "titulo_ausente",
    ),
    "sin_respuesta": ("error_de_red", "error_del_servidor"),
}
PRIMER_HTTP = 100
ULTIMO_HTTP = 599
PRIMER_ERROR_DEL_SERVIDOR = 500
LIMITE_DE_PETICIONES = 429
MAX_SALTOS = 20
MAX_URL = 2048
MAX_TEXTO = 512
MAX_SENALES = 16
PRIMER_IMPRIMIBLE = 32
BORRAR = 127


class ErrorComprobacion(ValueError):
    """Una comprobación de página que no cumple el contrato: no se guarda ni se usa como evidencia."""


def exigir(condicion: object, motivo: str) -> None:
    """Rechaza un incumplimiento con un mensaje que dice qué campo falla y por qué.

    Raises:
        ErrorComprobacion: Si la condición no se cumple.
    """
    if not condicion:
        raise ErrorComprobacion(f"{CONTRATO}: {motivo}")


def _sin_control(texto: str) -> bool:
    return all(ord(c) >= PRIMER_IMPRIMIBLE and ord(c) != BORRAR for c in texto)


def _texto(valor: ValorJson, lugar: str, maximo: int = MAX_TEXTO) -> None:
    exigir(isinstance(valor, str) and 0 < len(valor) <= maximo, f"{lugar}: texto vacío o demasiado largo")
    exigir(_sin_control(valor), f"{lugar}: texto con caracteres de control")


def _direccion(valor: ValorJson, lugar: str) -> None:
    _texto(valor, lugar, MAX_URL)
    exigir(valor.startswith(("http://", "https://")), f"{lugar}: debe ser una dirección http o https")


def _sha256(valor: ValorJson, lugar: str) -> None:
    exigir(isinstance(valor, str) and SHA256.fullmatch(valor) is not None, f"{lugar}: huella SHA-256 no válida")


def _entero(valor: ValorJson, lugar: str) -> None:
    # `bool` es un `int` en Python; un recuento es siempre un entero de verdad.
    exigir(type(valor) is int and valor >= 0, f"{lugar}: entero no válido")


def _instante(valor: ValorJson) -> None:
    exigir(isinstance(valor, str) and INSTANTE.fullmatch(valor) is not None, "pedido_utc: hora UTC no válida")
    try:
        datetime.strptime(valor, FORMATO_INSTANTE)
    except ValueError as error:
        raise ErrorComprobacion(f"{CONTRATO}: pedido_utc: fecha inexistente") from error


def _regla(regla: ValorJson) -> None:
    exigir(isinstance(regla, dict), "regla debe ser un objeto")
    exigir(set(regla) == set(CAMPOS_REGLA), f"regla: debe tener exactamente los campos {', '.join(CAMPOS_REGLA)}")
    identificador = regla["id"]
    exigir(
        isinstance(identificador, str)
        and len(identificador) <= MAX_IDENTIFICADOR_REGLA
        and IDENTIFICADOR_REGLA.fullmatch(identificador) is not None,
        "regla: identificador no admitido",
    )
    exigir(type(regla["version"]) is int and regla["version"] >= 1, "regla: versión no admitida")
    _sha256(regla["sha256"], "regla.sha256")


# El estado HTTP, la dirección final y los saltos: sin estado no hay respuesta, y entonces no hay nada más.
def _respuesta(comprobacion: ObjetoJson) -> None:
    http, url_final, saltos = comprobacion["http"], comprobacion["url_final"], comprobacion["saltos"]
    if http is None:
        exigir(url_final is None and saltos == 0, "una página sin respuesta no lleva dirección final ni saltos")
        return
    exigir(type(http) is int and PRIMER_HTTP <= http <= ULTIMO_HTTP, "http: estado no válido")
    _direccion(url_final, "url_final")
    exigir(type(saltos) is int and 0 <= saltos <= MAX_SALTOS, "saltos: número no válido")


def _senales(senales: ValorJson) -> None:
    exigir(isinstance(senales, list) and len(senales) <= MAX_SENALES, "senales: lista no válida")
    for senal in senales:
        _texto(senal, "senales")
    exigir(senales == sorted(set(senales)), "senales: sin orden canónico o con repetidos")


def falla_el_servidor(http: int | None) -> bool:
    """Si el estado HTTP dice que el servidor no pudo contestar: sin estado, error 5xx o límite de peticiones.

    Returns:
        Verdadero si no hubo respuesta, si fue un error del servidor o si se superó el límite de peticiones.
    """
    return http is None or http >= PRIMER_ERROR_DEL_SERVIDOR or http == LIMITE_DE_PETICIONES


# Qué motivos admite cada veredicto y qué respuesta HTTP supone.
def _veredicto(comprobacion: ObjetoJson) -> None:
    veredicto, motivo, http = comprobacion["veredicto"], comprobacion["motivo"], comprobacion["http"]
    exigir(veredicto in VEREDICTOS, "veredicto no admitido")
    exigir(motivo in MOTIVOS[veredicto], "motivo no admitido para ese veredicto")
    if veredicto == "sin_respuesta":
        exigir(falla_el_servidor(http), "sin_respuesta solo cabe sin estado HTTP o con un error del servidor")
        exigir(not comprobacion["senales"], "sin_respuesta no lleva señales")
        return
    exigir(
        not falla_el_servidor(http) or motivo == "servidor_igual_a_la_sonda",
        f"{veredicto} necesita una respuesta del servidor sin error",
    )


def validar_comprobacion(comprobacion: ValorJson) -> None:
    """Valida una comprobación tal como se guarda: cerrada y coherente consigo misma.

    Raises:
        ErrorComprobacion: Si la comprobación incumple el contrato; el mensaje dice qué campo falla.
    """
    exigir(isinstance(comprobacion, dict), "la comprobación debe ser un objeto")
    sobran = sorted(set(comprobacion) - set(CAMPOS))
    faltan = [campo for campo in CAMPOS if campo not in comprobacion]
    exigir(not sobran, f"campo no admitido «{', '.join(sobran)}»")
    exigir(not faltan, f"falta el campo «{', '.join(faltan)}»")
    exigir(type(comprobacion["version"]) is int and comprobacion["version"] == VERSION, "versión no admitida")
    _texto(comprobacion["curso"], "curso")
    exigir(
        isinstance(comprobacion["fuente"], str)
        and len(comprobacion["fuente"]) <= MAX_FUENTE
        and FUENTE.fullmatch(comprobacion["fuente"]) is not None,
        "fuente no admitida",
    )
    _direccion(comprobacion["url"], "url")
    _instante(comprobacion["pedido_utc"])
    _respuesta(comprobacion)
    _entero(comprobacion["longitud_texto"], "longitud_texto")
    _sha256(comprobacion["sha256_cuerpo"], "sha256_cuerpo")
    exigir(type(comprobacion["titulo_presente"]) is bool, "titulo_presente debe ser verdadero o falso")
    _senales(comprobacion["senales"])
    if comprobacion["sonda_sha256"] is not None:
        _sha256(comprobacion["sonda_sha256"], "sonda_sha256")
    _veredicto(comprobacion)
    _regla(comprobacion["regla"])


@dataclass(frozen=True, kw_only=True)
class Comprobacion:
    """La comprobación de la página de un curso; al construirla se valida exactamente lo que se guardará."""

    curso: str
    fuente: str
    url: str
    pedido_utc: str
    http: int | None
    url_final: str | None
    saltos: int
    longitud_texto: int
    sha256_cuerpo: str
    titulo_presente: bool
    senales: tuple[str, ...]
    sonda_sha256: str | None
    veredicto: str
    motivo: str
    regla: Regla

    def __post_init__(self) -> None:
        """Rechaza al construirla una comprobación que no cumple el contrato."""
        validar_comprobacion(self.a_json())

    def a_json(self) -> ObjetoJson:
        """Devuelve la comprobación tal como se guarda, con sus señales en orden canónico.

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
            "url_final": self.url_final,
            "saltos": self.saltos,
            "longitud_texto": self.longitud_texto,
            "sha256_cuerpo": self.sha256_cuerpo,
            "titulo_presente": self.titulo_presente,
            "senales": sorted(self.senales),
            "sonda_sha256": self.sonda_sha256,
            "veredicto": self.veredicto,
            "motivo": self.motivo,
            "regla": self.regla.a_json(),
        }
