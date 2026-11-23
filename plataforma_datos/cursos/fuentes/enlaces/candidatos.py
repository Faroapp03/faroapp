"""Los enlaces que Faro enseña a la persona y que este productor comprueba.

Salen del conjunto validado del Consorci y de la composición de formación del paquete (`cursos` y `especialidades`).

- webs: la de cada edición y la de cada entidad del Consorci;
- cursos: la ficha del SOC de cada curso de la oferta de la copia;
- programas: el PDF del programa oficial de cada especialidad del catálogo del SEPE.
"""

from typing import Any, Final, NamedTuple
from urllib.parse import quote

from plataforma_datos.comun.nucleo import FormatoInesperado, exigir
from plataforma_datos.cursos.fuentes.enlaces.observaciones import CURSOS, PROGRAMAS, WEBS

# La carpeta donde el SEPE publica el programa de cada especialidad, con su código en el nombre del PDF.
CARPETA_DE_PROGRAMAS: Final = "https://sede.sepe.gob.es/es/portaltrabaja/resources/pdf/especialidades/"
ESQUEMAS: Final = ("https://", "http://")
# Los caracteres que encodeURIComponent deja sin escapar: la dirección del PDF es la misma que arma el motor de cursos.
SIN_ESCAPAR: Final = "!~*'()"


class Candidato(NamedTuple):
    """Un enlace por comprobar: su dirección, el conjunto al que pertenece y la clave con que el motor lo reconoce."""

    url: str
    conjunto: str
    clave: str


def direccion_del_programa(codigo: str) -> str:
    """La dirección en que el SEPE publica el programa de una especialidad.

    Returns:
        La dirección del PDF.
    """
    return f"{CARPETA_DE_PROGRAMAS}{quote(codigo, safe=SIN_ESCAPAR)}.pdf"


def _web(valor: object) -> str | None:
    """La web de una entidad si es una dirección web; None si falta o está vacía.

    Returns:
        La dirección, o None.

    Raises:
        FormatoInesperado: Si hay un valor que no es una dirección http o https.
    """
    if valor is None or valor == "":
        return None
    exigir(isinstance(valor, str) and valor.startswith(ESQUEMAS), f"enlaces: web con forma inesperada: {valor!r}")
    return str(valor)


def _webs_del_consorci(consorci: dict[str, Any]) -> list[Candidato]:
    """Las webs distintas de las ediciones y de las entidades del Consorci.

    Returns:
        Un candidato por dirección distinta.
    """
    exigir(
        isinstance(consorci.get("ediciones"), list) and isinstance(consorci.get("entidades"), dict),
        "enlaces: el Consorci no trae ediciones y entidades",
    )
    registros = [*consorci["ediciones"], *consorci["entidades"].values()]
    webs = {web for registro in registros if (web := _web(registro.get("web"))) is not None}
    return [Candidato(web, WEBS, web) for web in webs]


def _fichas_de_cursos(formacion: dict[str, Any]) -> list[Candidato]:
    """La ficha de cada curso de la oferta del SOC.

    Returns:
        Un candidato por curso con ficha, clave su identificador.
    """
    exigir(isinstance(formacion.get("cursos"), list), "enlaces: la formación no trae cursos")
    cursos = [(curso["id"], _web(curso.get("enlace"))) for curso in formacion["cursos"]]
    return [Candidato(enlace, CURSOS, identificador) for identificador, enlace in cursos if enlace is not None]


def _programas(formacion: dict[str, Any]) -> list[Candidato]:
    """El PDF del programa de cada especialidad del catálogo.

    Returns:
        Un candidato por especialidad, clave su código.
    """
    exigir(isinstance(formacion.get("especialidades"), dict), "enlaces: la formación no trae especialidades")
    return [Candidato(direccion_del_programa(codigo), PROGRAMAS, codigo) for codigo in formacion["especialidades"]]


def candidatos(consorci: dict[str, Any], formacion: dict[str, Any]) -> list[Candidato]:
    """Todos los enlaces por comprobar, sin repetir dirección dentro de un conjunto.

    Returns:
        Los candidatos de las webs, los cursos y los programas.

    Raises:
        FormatoInesperado: Si un conjunto de origen no tiene la forma esperada o repite una clave.
    """
    todos = [*_webs_del_consorci(consorci), *_fichas_de_cursos(formacion), *_programas(formacion)]
    claves = {(c.conjunto, c.clave) for c in todos}
    if len(claves) != len(todos):
        raise FormatoInesperado("enlaces: un conjunto repite una clave de enlace")
    return sorted(todos, key=lambda c: (c.conjunto, c.url))


def expuestos(consorci: dict[str, Any], formacion: dict[str, Any]) -> frozenset[tuple[str, str]]:
    """Los enlaces que la persona ve hoy junto a un curso publicado, por (conjunto, dirección).

    Son el programa de cada especialidad que cita un curso del SOC o una edición del Consorci, la web de cada edición y
    la de cada entidad que imparte alguna. Las fichas de los cursos no entran: su página responde igual para cualquier
    código y la presencia de un curso la decide el censo del SOC.

    Returns:
        Los programas y las webs expuestos.
    """
    ediciones = consorci["ediciones"]
    especialidades = {codigo for curso in formacion["cursos"] for codigo in curso.get("especialidades", [])}
    especialidades |= {edicion["especialidad"] for edicion in ediciones if edicion.get("especialidad")}
    con_cursos = {edicion.get("entidad") for edicion in ediciones}
    entidades = [entidad for entidad in consorci["entidades"].values() if entidad.get("entidad") in con_cursos]
    webs = {web for registro in [*ediciones, *entidades] if (web := _web(registro.get("web"))) is not None}
    return frozenset(
        {(PROGRAMAS, direccion_del_programa(codigo)) for codigo in especialidades} | {(WEBS, web) for web in webs}
    )
