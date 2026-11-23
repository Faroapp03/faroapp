"""Lectura de la matrícula en el bloque HTML de una edición conocida de Cibernàrium."""

import re
from dataclasses import dataclass, field
from datetime import datetime
from html.parser import HTMLParser
from zoneinfo import ZoneInfo

from plataforma_datos.comun.nucleo import FormatoInesperado, exigir
from plataforma_datos.cursos.fuentes.barcelonactiva import robot_cibernarium as robot
from plataforma_datos.cursos.fuentes.barcelonactiva.declaraciones_actuales import MAX_PROFUNDIDAD, VACIAS

_MESES = (
    "gener",
    "febrer",
    "març",
    "abril",
    "maig",
    "juny",
    "juliol",
    "agost",
    "setembre",
    "octubre",
    "novembre",
    "desembre",
)
_DIAS = ("dilluns", "dimarts", "dimecres", "dijous", "divendres", "dissabte", "diumenge")
_ZONA = ZoneInfo("Europe/Madrid")
_BOTON = re.compile(
    r"javascript:_com_davinci_ba_ciber_activity_record_CibernariumActivityRecordPortlet_INSTANCE_"
    r"[A-Za-z0-9]+_setRedirect\(([1-9]\d*),\s*([1-9]\d*)\);?"
)
_ESTADOS = {("code-DISP2", "inscripció tancada."): "cerrada", ("code-DISP3", "sense places."): "sin-plazas"}


def url(id: str) -> str:
    """Forma la URL pública de la ficha por la identidad numérica de la edición.

    Returns:
        Ficha del proveedor, sin parámetros de sesión.
    """
    return robot.ORIGEN + "/formacio?activityId=" + robot.identificador(id)


def _texto(s: str) -> str:
    return " ".join(s.casefold().replace("’", "'").split())


@dataclass
class _Campo:
    tipo: str
    clases: set[str]
    accion: str
    partes: list[str] = field(default_factory=list)

    @property
    def texto(self) -> str:
        return _texto(" ".join(self.partes))


@dataclass
class _Bloque:
    selector: str
    campos: list[_Campo] = field(default_factory=list)


class _Ficha(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.urls: set[str] = set()
        self.titulos: set[str] = set()
        self.bloques: list[_Bloque] = []
        self.pila: list[tuple[str, bool, _Bloque | None, _Campo | None, bool]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        atributos = {k: v or "" for k, v in attrs}
        _, lista, bloque, campo, excluido = self.pila[-1] if self.pila else ("", False, None, None, False)
        excluido = (
            excluido
            or bool({"hidden", "disabled", "inert"} & atributos.keys())
            or any(atributos.get(k, "").strip().lower() == "true" for k in ("aria-hidden", "aria-disabled"))
        )
        if tag == "meta" and not excluido:
            self._meta(atributos)
        if tag in VACIAS:
            return
        exigir(len(self.pila) < MAX_PROFUNDIDAD, "Ficha de Cibernàrium excesivamente profunda", FormatoInesperado)
        if excluido:
            self.pila.append((tag, False, None, None, True))
            return
        lista = lista or tag == "div" and atributos.get("id") == "edicionesList"
        clases = set(atributos.get("class", "").split())
        if lista and tag == "div" and {"item-ediciones", "izq"} <= clases:
            nombres = [c for c in clases if re.fullmatch(r"item[1-9]\d*", c)]
            bloque = _Bloque("#edicionesList .item-ediciones.izq." + nombres[0]) if len(nombres) == 1 else None
            if bloque is not None:
                self.bloques.append(bloque)
            campo = None
        if bloque is not None:
            tipo = self._tipo(tag, clases)
            if tipo:
                campo = _Campo(tipo, clases, atributos.get("onclick", ""))
                bloque.campos.append(campo)
        self.pila.append((tag, lista, bloque, campo, False))

    def _meta(self, atributos: dict[str, str]) -> None:
        valor = atributos.get("content", "")
        if atributos.get("property") == "og:url" and "activityId=" in valor:
            self.urls.add(valor)
        if atributos.get("property") == "og:title":
            self.titulos.add(_texto(valor).removesuffix(" - cibernarium"))

    @staticmethod
    def _tipo(tag: str, clases: set[str]) -> str:
        for etiqueta, clase in (
            ("li", "activity-session-date"),
            ("div", "dates"),
            ("span", "next-edition"),
            ("a", "botonRosaDerecha"),
        ):
            if tag == etiqueta and clase in clases:
                return clase
        return ""

    def handle_data(self, data: str) -> None:
        if self.pila:
            tag, _, _, campo, _ = self.pila[-1]
            if campo is not None and tag not in ("script", "style"):
                campo.partes.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag in VACIAS:
            return
        for i in range(len(self.pila) - 1, -1, -1):
            if self.pila[i][0] == tag:
                del self.pila[i:]
                return


@dataclass(frozen=True)
class LecturaFicha:
    """Alcance de la ficha recibida y localizador de la prueba en sus propios bytes."""

    estado: str
    selector: str
    identificada: bool = True


def instante_de_calendario(valor: str | None) -> datetime | None:
    """Lee horas del calendario admitido con su zona explícita.

    Returns:
        Hora de Barcelona, o None cuando falta precisión para cotejar un horario.
    """
    if not isinstance(valor, str):
        return None
    try:
        fecha = datetime.fromisoformat(valor)
    except ValueError:
        return None
    return fecha.astimezone(_ZONA) if fecha.utcoffset() is not None else None


def _fecha_hora(sesion: dict) -> tuple[str, datetime] | None:
    inicio, fin = (instante_de_calendario(sesion.get(k)) for k in ("inicio", "fin"))
    if inicio is None or fin is None or inicio.date() != fin.date() or fin <= inicio:
        return None
    mes = _MESES[inicio.month - 1]
    articulo = "d'" if mes[0] in "aeiou" else "de "
    return f"{_DIAS[inicio.weekday()]} {inicio.day} {articulo}{mes}, {inicio:%H:%M}h - {fin:%H:%M}h", inicio


def _calendario(bloque: _Bloque, esperadas: list[tuple[str, datetime]]) -> tuple[bool, bool | None]:
    dias = [f.texto for f in bloque.campos if f.tipo == "activity-session-date"]
    rotulos = {f.texto for f in bloque.campos if f.tipo == "dates"}
    literales = [t for t, _ in esperadas]
    if dias != literales and not (len(literales) == 1 and not dias and rotulos == {"data: " + literales[0]}):
        return False, False
    desde, hasta = esperadas[0][1], esperadas[-1][1]
    if rotulos == {f"dates: del {desde:%d/%m/%Y} al {hasta:%d/%m/%Y}"}:
        return True, True
    if not rotulos or (len(literales) == 1 and rotulos == {"data: " + literales[0]}):
        return True, False
    # Los horarios coinciden, pero el rótulo contradice el calendario o cambió de formato.
    return True, None


def contrastar(cuerpo: bytes, *, id: str, titulo: str, edicion: dict) -> LecturaFicha:
    """Coteja título, URL y el horario completo antes de atribuir un botón o un estado de matrícula.

    Returns:
        Estado del bloque inequívoco. Las fechas de otra edición nunca acreditan la solicitada.
    """
    lector = _Ficha()
    lector.feed(cuerpo.decode("utf-8"))
    lector.close()
    if lector.urls != {url(id)} or _texto(titulo) not in lector.titulos or not lector.bloques:
        return LecturaFicha("sin-contraste", "meta[property='og:url']", identificada=False)
    sesiones = edicion["datos"].get("sesiones") or []
    esperadas = [hora for s in sesiones if isinstance(s, dict) and (hora := _fecha_hora(s)) is not None]
    if not esperadas or len(esperadas) != len(sesiones):
        return LecturaFicha("sin-contraste", "#edicionesList")
    candidatas = []
    for bloque in lector.bloques:
        coincide, ano = _calendario(bloque, esperadas)
        if coincide:
            candidatas.append((bloque, ano))
    if len(candidatas) != 1:
        return LecturaFicha("otra-edicion" if not candidatas else "sin-contraste", "#edicionesList")
    bloque, ano = candidatas[0]
    botones = [f for f in bloque.campos if f.tipo == "botonRosaDerecha"]
    estados = [f for f in bloque.campos if f.tipo == "next-edition"]
    if (
        ano is not None
        and len(botones) == 1
        and not estados
        and (m := _BOTON.fullmatch(botones[0].accion))
        and m[2] == id
        and botones[0].texto == "inscriure'm"
    ):
        return LecturaFicha("boton-de-inscripcion", bloque.selector + " a.botonRosaDerecha")
    if ano and len(estados) == 1 and not botones:
        codigos = [c for c in estados[0].clases if c.startswith("code-")]
        if len(codigos) == 1 and (estado := _ESTADOS.get((codigos[0], estados[0].texto))):
            return LecturaFicha(estado, bloque.selector + " .next-edition." + codigos[0])
    return LecturaFicha("sin-contraste", bloque.selector)
