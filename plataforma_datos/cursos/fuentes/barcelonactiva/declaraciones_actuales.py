"""Condiciones generales de los bloques FAQ actuales, sin inferir admisión personal.

La gratuidad se vincula a CG12; una mención en un menú, un título o la FAQ de
otro servicio no la acredita. Se reutiliza la interpretación del robot para
los requisitos generales NU2/NU3, conservando el alcance de declaración general.
"""

import hashlib
import html
import re
from html.parser import HTMLParser
from http import HTTPStatus

from plataforma_datos.comun.nucleo import FormatoInesperado, exigir
from plataforma_datos.cursos.fuentes.barcelonactiva import robot_cibernarium as robot
from plataforma_datos.cursos.tipos_json import ObjetoJson

VACIAS = frozenset(
    {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
)
MAX_PROFUNDIDAD = 256
PREGUNTA_COSTE = "CG12 Les activitats del Cibernàrium són de pagament o són gratuïtes?"
GRATUIDAD = "Totes les activitats de Barcelona Activa són gratuïtes"


class _Faqs(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.pila: list[str] = []
        self.listas: list[dict] = []
        self.bloques: dict[str, dict] = {}

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag not in VACIAS:
            self.pila.append(tag)
        exigir(len(self.pila) <= MAX_PROFUNDIDAD, "FAQ Cibernàrium excesivamente profunda", FormatoInesperado)
        atributos = dict(attrs)
        if tag == "li":
            self.listas.append(
                {
                    "nivel": len(self.pila),
                    "pregunta": [],
                    "respuesta": [],
                    "boton": None,
                    "panel": None,
                    "botones": 0,
                    "paneles": 0,
                    "clases_item": (atributos.get("class") or "").split(),
                    "grupos": [],
                }
            )
        if not self.listas:
            return
        bloque = self.listas[-1]
        if tag == "button" and "faq-accordion" in (atributos.get("class") or "").split():
            bloque["boton"] = len(self.pila)
            bloque["botones"] += 1
            bloque["grupos"] = [c for c in (atributos.get("class") or "").split() if c.isdecimal()]
        if tag == "div" and "panel-faqs" in (atributos.get("class") or "").split():
            bloque["panel"] = len(self.pila)
            bloque["paneles"] += 1

    def handle_data(self, data: str) -> None:
        if {"script", "style"}.intersection(self.pila):
            return
        for bloque in self.listas:
            if bloque["boton"] is not None:
                bloque["pregunta"].append(data)
            if bloque["panel"] is not None:
                bloque["respuesta"].append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag in VACIAS or tag not in self.pila:
            return
        indice = len(self.pila) - 1 - self.pila[::-1].index(tag)
        del self.pila[indice:]
        for bloque in self.listas:
            for campo in ("boton", "panel"):
                if bloque[campo] is not None and len(self.pila) < bloque[campo]:
                    bloque[campo] = None
        while self.listas and self.listas[-1]["nivel"] > len(self.pila):
            bloque = self.listas.pop()
            pregunta = " ".join(" ".join(bloque["pregunta"]).split())
            clave = pregunta.split(" ", 1)[0]
            if clave not in {"NU2", "NU3", "CG12"}:
                continue
            exigir(
                bloque["botones"] == bloque["paneles"] == 1 and clave not in self.bloques,
                "Bloque FAQ Cibernàrium ambiguo",
                FormatoInesperado,
            )
            items = [c for c in bloque["clases_item"] if re.fullmatch(r"item-\d+", c)]
            exigir(len(items) == len(bloque["grupos"]) == 1, "FAQ sin localizador nativo inequívoco", FormatoInesperado)
            selector = (
                'li[class~="'
                + items[0]
                + '"]:has(> button.faq-accordion[class~="'
                + bloque["grupos"][0]
                + '"]) > .panel-faqs'
            )
            self.bloques[clave] = {
                "pregunta": pregunta,
                "respuesta": " ".join(" ".join(bloque["respuesta"]).split()),
                "selector": selector,
            }


def extraer(cuerpo: bytes, meta: ObjetoJson) -> ObjetoJson:
    """Localiza cada condición en su FAQ y conserva recepción y alcance.

    Returns:
        Condiciones acreditadas; las declaraciones no reconocidas quedan desconocidas.
    """
    exigir(
        meta["http"] == HTTPStatus.OK
        and meta["completo"] is True
        and meta["url_final"] == robot.ORIGEN + "/ca/normesfaqs"
        and hashlib.sha256(cuerpo).hexdigest() == meta["cuerpo_sha256"],
        "Normas Cibernàrium sin captura identificada",
        FormatoInesperado,
    )
    exigir(
        robot.fecha_utc(meta["inicio_utc"]) <= robot.fecha_utc(meta["fin_utc"]),
        "Intervalo de normas invertido",
        FormatoInesperado,
    )
    parser = _Faqs()
    parser.feed(cuerpo.decode("utf-8"))
    parser.close()

    def soporte(clave: str) -> ObjetoJson:
        return {
            "url": meta["url_final"],
            "capturado_utc": meta["fin_utc"],
            "sha256": meta["cuerpo_sha256"],
            "localizador": {"tipo": "selector", "valor": parser.bloques[clave]["selector"]},
        }

    coste = parser.bloques.get("CG12", {})
    gratuito = coste.get("pregunta") == PREGUNTA_COSTE and coste.get("respuesta") in {GRATUIDAD, GRATUIDAD + "."}
    textos = [parser.bloques[k]["respuesta"] for k in ("NU2", "NU3") if k in parser.bloques]
    generales = robot.normas_generales("".join("<p>" + html.escape(t) + "</p>" for t in textos).encode())
    resultado = {"formacion": None, "inscripcion": None, "acceso_general": None, "diagnosticos": []}
    if gratuito:
        resultado["formacion"] = {
            "valor": "gratis_formacion",
            "alcance": "declaracion_general",
            "evidencia": soporte("CG12"),
        }
    else:
        resultado["diagnosticos"].append({"campo": "formacion", "motivo": "declaracion_general_no_reconocida"})
    if generales["registro_previo"] is True:
        resultado["inscripcion"] = {
            "registro_previo_para_inscribirse": True,
            "alcance": "declaracion_general",
            "evidencia": soporte("NU3"),
        }
    if generales["edad"] is not None:
        resultado["acceso_general"] = {
            "edad": generales["edad"],
            "documentos_identidad": generales["documentos_identidad"],
            "situacion_laboral_exigida": generales["situacion_laboral_exigida"],
            "sector_profesional_exigido": generales["sector_profesional_exigido"],
            "residencia_exigida_en_norma_general": generales["residencia_exigida_en_norma_general"],
            "alcance": "declaracion_general",
            "evidencia": soporte("NU2"),
        }
    return resultado
