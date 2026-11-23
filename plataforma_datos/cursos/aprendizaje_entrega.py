"""Compañero de aprendizaje desde temario admitido y revisión editorial por afirmación.

No consulta fuentes, cambia SQLite o acredita dominio. Renovar una entrega no
revisa de nuevo lo que conserva exactamente su contenido pertinente. Un cambio
retiene solo la afirmación afectada y su cobertura, sin recuperar otra por título.
"""

import copy
import hashlib
import json
import re
from datetime import datetime, timedelta
from html.parser import HTMLParser
from pathlib import Path

from plataforma_datos.cursos import aprendizaje_ciber
from plataforma_datos.cursos.aprendizaje_ciber import TemarioCiber
from plataforma_datos.cursos.contenido_academy import TemarioAcademy, datos_para_entrega
from plataforma_datos.cursos.contrato_aprendizaje import cargar_registro, validar_aprendizaje
from plataforma_datos.cursos.contrato_entrega_catalogo import exigir, validar_publico
from plataforma_datos.cursos.fuentes.claude_academy.lector import IGNORADOS, VACIOS
from plataforma_datos.cursos.fuentes.hp_life.lector import FichaHpLife
from plataforma_datos.cursos.tipos_json import ObjetoJson, ValorJson


class _Bloques(HTMLParser):
    """Identifica bloques completos y su contexto pedagógico, no subcadenas."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.activos: list[tuple[str, list[str], tuple[str, str], tuple[int, int]]] = []
        self.listas: list[tuple[str, str]] = []
        self.encabezado = ""
        self.parrafo = ""
        self.bloques: list[str] = []
        self.firmas: list[str] = []
        self.posiciones: list[tuple[int, int]] = []
        self.etiquetas: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        """Abre el contenido principal o aparta etiquetas excluidas."""
        if tag in {"ul", "ol"}:
            self.listas.append((self.encabezado, self.parrafo))
        elif tag in {"li", "p", "h1", "h2", "h3", "h4", "h5", "h6"}:
            contexto = self.listas[-1] if self.listas else (self.encabezado, self.parrafo)
            self.activos.append((tag, [], contexto, self.getpos()))
        elif tag == "br":
            self.handle_data(" ")

    def handle_data(self, data: str) -> None:
        """Recoge texto solo dentro del contenido principal."""
        for _, texto, _, _ in self.activos:
            texto.append(data)

    def handle_endtag(self, tag: str) -> None:
        """Cierra el contenido principal o la etiqueta apartada."""
        if tag in {"ul", "ol"} and self.listas:
            self.listas.pop()
        elif self.activos and self.activos[-1][0] == tag:
            _, partes, contexto, posicion = self.activos.pop()
            texto = " ".join("".join(partes).split())
            self.bloques.append(texto)
            self.posiciones.append(posicion)
            self.etiquetas.append(tag)
            firma = json.dumps([tag, *contexto, texto], ensure_ascii=False, separators=(",", ":"))
            self.firmas.append(hashlib.sha256(firma.encode()).hexdigest())
            if tag.startswith("h"):
                self.encabezado = texto
            elif tag == "p":
                self.parrafo = texto


class BloquesDeAprendizaje(_Bloques):
    """Acota el contexto revisado al main propio, excluyendo scripts y entidades ajenas."""

    def __init__(self, url: str) -> None:
        super().__init__()
        self.url = url
        self.en_main = False
        self.excluidos: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        """Abre el contenido principal o aparta etiquetas excluidas."""
        if self.excluidos:
            if tag not in VACIOS:
                self.excluidos.append(tag)
            return
        if tag == "main":
            self.en_main = True
        if not self.en_main:
            return
        atributos = dict(attrs)
        ajeno = atributos.get("itemid") not in {None, "", self.url}
        if tag in IGNORADOS or ajeno:
            if tag not in VACIOS:
                self.excluidos.append(tag)
            return
        super().handle_starttag(tag, attrs)

    def handle_data(self, data: str) -> None:
        """Recoge texto solo dentro del contenido principal."""
        if self.en_main and not self.excluidos:
            super().handle_data(data)

    def handle_endtag(self, tag: str) -> None:
        """Cierra el contenido principal o la etiqueta apartada."""
        if self.excluidos:
            if tag in self.excluidos:
                while self.excluidos.pop() != tag:
                    pass
            return
        if self.en_main:
            super().handle_endtag(tag)
        if tag == "main":
            self.en_main = False


def _referencia_actual(actual: FichaHpLife | TemarioAcademy) -> ObjetoJson:
    if isinstance(actual, TemarioAcademy):
        return {
            "url": actual.ficha.url,
            "capturado_utc": actual.ficha.capturado_utc,
            "sha256": actual.ficha.sha256_captura,
        }
    return {
        "url": actual.captura.url_final,
        "capturado_utc": actual.captura.recibido_utc,
        "sha256": actual.captura.sha256_cuerpo,
    }


def _fecha(valor: ValorJson, nombre: str) -> None:
    exigir(isinstance(valor, str), nombre + ": fecha obligatoria")
    fecha = datetime.fromisoformat(valor)
    exigir(fecha.utcoffset() == timedelta(0), nombre + ": UTC obligatorio")


def _requisitos_academy_iguales(ficha: ObjetoJson, actual: TemarioAcademy) -> bool:
    revisados = " ".join(
        e["fragmento"]
        for a in ficha["aprendizaje"]["afirmaciones"]
        if a["dimension"] == "requisito_entrada"
        for e in a["evidencias"]
    )
    declarados = " ".join(e.texto for e in actual.ficha.requisitos or ())
    return " ".join(revisados.split()) == " ".join(declarados.split())


def _localizador_actual(actual: FichaHpLife | TemarioAcademy, bloques: _Bloques, posicion: int) -> str | None:
    if not isinstance(actual, TemarioAcademy):
        return f"__NEXT_DATA__/props/pageProps/initialCourseData/body/bloque[{posicion + 1}]"
    linea, columna = bloques.posiciones[posicion]
    sufijo = f" (línea {linea}, columna {columna + 1})"
    candidatos = [
        b.localizador
        for b in actual.ficha.bloques
        if b.tipo == bloques.etiquetas[posicion]
        and " ".join(b.texto.split()) == bloques.bloques[posicion]
        and b.localizador.endswith(sufijo)
    ]
    return candidatos[0] if len(candidatos) == 1 else None


def _ficha_actual(ficha: ObjetoJson, actual: FichaHpLife | TemarioAcademy | TemarioCiber | None) -> ObjetoJson:
    if "contexto_condiciones_sha256" in ficha:
        return aprendizaje_ciber.proyectar(ficha, actual)
    return _ficha_hp_academy(ficha, actual if isinstance(actual, (FichaHpLife, TemarioAcademy)) else None)


def _ficha_hp_academy(ficha: ObjetoJson, actual: FichaHpLife | TemarioAcademy | None) -> ObjetoJson:
    if isinstance(actual, TemarioAcademy) and ficha["programa_id"] != "claude-academy:" + actual.ficha.id:
        actual = None
    salida = copy.deepcopy(ficha)
    salida["idioma_ficha"] = actual.idioma if actual is not None else None
    bloques = BloquesDeAprendizaje(actual.ficha.url) if isinstance(actual, TemarioAcademy) else _Bloques()
    if actual is not None:
        bloques.feed(actual.cuerpo_html)
        bloques.close()
    firmas = salida.pop("firmas_semanticas")
    conservadas = []
    for afirmacion in salida["aprendizaje"]["afirmaciones"]:
        evidencias = afirmacion["evidencias"]
        esperadas = firmas[afirmacion["id"]]
        exigir(len(esperadas) == len(evidencias), "Soporte semántico incompleto")
        posiciones = []
        for evidencia, firma in zip(evidencias, esperadas, strict=True):
            texto = " ".join(evidencia["fragmento"].split())
            posiciones.append(
                next((i for i, t in enumerate(bloques.bloques) if t == texto and bloques.firmas[i] == firma), None)
            )
        if not evidencias or actual is None or any(p is None for p in posiciones):
            continue
        localizadores = [_localizador_actual(actual, bloques, p) for p in posiciones]
        if any(localizador is None for localizador in localizadores):
            continue
        for evidencia, localizador in zip(evidencias, localizadores, strict=True):
            evidencia.update(_referencia_actual(actual))
            evidencia["localizador"]["valor"] = localizador
        conservadas.append(afirmacion)
    ids = {a["id"] for a in conservadas}
    salida["aprendizaje"]["afirmaciones"] = conservadas
    salida["aprendizaje"]["contenido_observado"] = actual is not None
    salida["cobertura"] = [c for c in salida["cobertura"] if all(a in ids for a in c["afirmaciones"])]
    perdidos = any(
        a["dimension"] == "requisito_entrada" and a["id"] not in ids for a in ficha["aprendizaje"]["afirmaciones"]
    )
    requisitos_actuales = (
        actual.ficha.requisitos
        if isinstance(actual, TemarioAcademy)
        else actual.requisitos_curso
        if actual is not None
        else None
    )
    if (
        isinstance(actual, TemarioAcademy)
        and salida["requisitos"] == "publicados"
        and not _requisitos_academy_iguales(ficha, actual)
    ):
        salida["requisitos"] = "sin_verificar"
    if perdidos or actual is None or (salida["requisitos"] == "no_publicados" and requisitos_actuales is not None):
        salida["requisitos"] = "sin_verificar"
    return salida


def _agregar_condicion_inscripcion(
    ficha: ObjetoJson, actual: FichaHpLife | TemarioAcademy | TemarioCiber | None, corte: str
) -> None:
    """Explica una declaración general de inscripción, no un muro de lectura."""
    if not isinstance(actual, TemarioAcademy):
        return
    inscripcion = datos_para_entrega(actual, corte).get("inscripcion")
    if inscripcion is None:
        return
    e = inscripcion["evidencia"]
    ficha["aprendizaje"]["afirmaciones"].append(
        {
            "id": "academy-inscripcion-progreso-1",
            "competencia": None,
            "dimension": "requisito_entrada",
            "descripcion": (
                "Enrollment and progress: a free Claude account saves course progress and enables completion badges. "
                "This does not establish a login requirement for reading all material."
            ),
            "nivel": {"escala": None, "valor": None},
            "origen": "extraccion_oficial",
            "estado": "extraida",
            "metodo": {"nombre": "academy-inscripcion-progreso", "version": "1"},
            "revision": None,
            "evidencias": [
                {
                    "url": e["url"],
                    "capturado_utc": e["capturado_utc"],
                    "sha256": e["sha256"],
                    "localizador": {"tipo": "requisito", "valor": e["localizador"]},
                    "fragmento": inscripcion["fragmento"],
                }
            ],
            "discrepancias": [],
            "revision_requerida": False,
        }
    )


CRITERIOS = {
    "tarea_sencilla",
    "privacidad",
    "contraste",
    "tarea_real",
    "mejorar_instrucciones",
    "criterios_explicitos",
    "procedimiento_verificable",
    "fuentes_y_limites",
    "caso_complejo",
}


def _revision(revision: ObjetoJson) -> None:
    exigir(set(revision) == {"tipo", "referencia", "metodo", "fecha_utc"}, "Revisión editorial incompatible")
    exigir(revision["tipo"] in {"humana", "automatizada"}, "Tipo de revisión editorial desconocido")
    exigir(isinstance(revision["referencia"], str) and bool(revision["referencia"].strip()), "Revisión sin referencia")
    exigir(set(revision["metodo"]) == {"nombre", "version"}, "Método de revisión incompatible")
    exigir(all(isinstance(v, str) and bool(v.strip()) for v in revision["metodo"].values()), "Método vacío")
    _fecha(revision["fecha_utc"], "revisión editorial")


def _texto_revisado(valor: ValorJson) -> None:
    exigir(
        isinstance(valor, dict)
        and set(valor) == {"es", "ca"}
        and all(isinstance(v, str) and bool(v.strip()) for v in valor.values()),
        "Razón sin texto completo ES/CA",
    )


def _validar_ficha(ficha: ObjetoJson, registro: ObjetoJson, huella: str) -> None:
    campos = {"programa_id", "aprendizaje", "requisitos", "cobertura", "revision", "firmas_semanticas"}
    ciber = isinstance(ficha.get("programa_id"), str) and (
        ficha["programa_id"].startswith("cibervoluntarios:material:") or ficha["programa_id"] == "fundae:1:3462"
    )
    exigir(
        set(ficha) == (campos | {"contexto_condiciones_sha256"} if ciber else campos), "Ficha editorial incompatible"
    )
    if ciber:
        exigir(
            isinstance(ficha["contexto_condiciones_sha256"], str)
            and re.fullmatch(r"[a-f0-9]{64}", ficha["contexto_condiciones_sha256"]) is not None,
            "Contexto editorial Ciber incompatible",
        )
    _revision(ficha["revision"])
    exigir(ficha["requisitos"] in {"publicados", "no_publicados", "sin_verificar"}, "Requisitos desconocidos")
    afirmaciones = ficha["aprendizaje"]["afirmaciones"]
    capturas = [e for a in afirmaciones for e in a["evidencias"]]
    validar_aprendizaje(ficha["aprendizaje"], capturas, registro, huella, _fecha)
    exigir(set(ficha["firmas_semanticas"]) == {a["id"] for a in afirmaciones}, "Firmas semánticas incompletas")
    for firmas in ficha["firmas_semanticas"].values():
        exigir(
            isinstance(firmas, list) and all(isinstance(f, str) and re.fullmatch("[a-f0-9]{64}", f) for f in firmas),
            "Firma semántica no válida",
        )
    criterios = []
    for cobertura in ficha["cobertura"]:
        exigir(set(cobertura) == {"criterio", "afirmaciones", "justificacion", "via"}, "Cobertura incompatible")
        exigir(cobertura["criterio"] in CRITERIOS, "Criterio de cobertura desconocido")
        _texto_revisado(cobertura["justificacion"])
        exigir(
            cobertura["afirmaciones"]
            and all(
                any(a["id"] == id and a["dimension"] == "resultado_previsto" for a in afirmaciones)
                for id in cobertura["afirmaciones"]
            ),
            "Cobertura sin resultado",
        )
        exigir((cobertura["criterio"] == "caso_complejo") == (cobertura["via"] is not None), "Vía avanzada incoherente")
        exigir(cobertura["via"] in {None, "verificacion_rigurosa", "automatizacion_supervisada"}, "Vía no admitida")
        criterios.append(cobertura["criterio"])
    exigir(len(criterios) == len(set(criterios)), "Cobertura repetida")


def _validar_definicion(definicion: ObjetoJson, registro: ObjetoJson, huella: str) -> None:
    exigir(set(definicion) == {"schema_version", "registro", "fichas", "caminos"}, "Definición editorial incompatible")
    exigir(
        type(definicion["schema_version"]) is int and definicion["schema_version"] == 1,
        "Versión editorial incompatible",
    )
    exigir(isinstance(definicion["fichas"], list) and isinstance(definicion["caminos"], list), "Revisión sin listas")
    ids = [f["programa_id"] for f in definicion["fichas"]]
    exigir(len(ids) == len(set(ids)), "Programa editorial repetido")
    for ficha in definicion["fichas"]:
        _validar_ficha(ficha, registro, huella)
    caminos = []
    for camino in definicion["caminos"]:
        exigir(set(camino) == {"id", "etapa", "programas", "justificacion", "revision"}, "Camino incompatible")
        exigir(camino["etapa"] in {"inicial", "intermedio", "avanzado"}, "Etapa desconocida")
        exigir(isinstance(camino["id"], str) and bool(camino["id"].strip()), "Camino sin identidad")
        _texto_revisado(camino["justificacion"])
        programas = camino["programas"]
        exigir(
            isinstance(programas, list)
            and programas
            and len(programas) == len(set(programas))
            and all(p in ids for p in programas),
            "Camino sin fichas revisadas o repetidas",
        )
        _revision(camino["revision"])
        caminos.append(camino["id"])
    exigir(len(caminos) == len(set(caminos)), "Camino repetido")


def generar_companero(
    publico_bytes: bytes, contenidos: dict[str, FichaHpLife | TemarioAcademy | TemarioCiber], definicion: ObjetoJson
) -> ObjetoJson:
    """Proyecta una revisión pertinente sobre las mismas ofertas de una entrega admitida.

    El llamador acredita la instantánea y los bytes públicos mediante la admisión común.
    No se confunden las referencias históricas con vigencia: además de conservar
    su evidencia literal, cada afirmación debe seguir en el cuerpo de la instantánea.

    Returns:
        Compañero ligado a bytes/revisión de esta entrega, sin datos privados.
    """
    publico = json.loads(publico_bytes)
    validar_publico(publico)
    registro, huella = cargar_registro()
    _validar_definicion(definicion, registro, huella)
    referencia_registro = {"id": registro["id"], "version": registro["version"], "sha256": huella}
    exigir(definicion["registro"] == referencia_registro, "Revisión de otro registro de competencias")
    fichas = []
    for ficha in definicion["fichas"]:
        identidad = ficha["programa_id"]
        ofertas = [o for o in publico["ofertas"] if o["unidad"]["programa_id"] == identidad]
        if not ofertas:
            continue
        exigir(
            all(o["unidad"]["tipo"] == "recurso" and o["unidad"]["id"] == identidad for o in ofertas),
            "El aprendizaje de esta versión solo admite recursos sin ediciones",
        )
        referencias = [r for o in ofertas for r in o["referencias"]]
        capturas = [
            {"url": r["url"], "capturado_utc": r["fecha_referencia"], "sha256": r["sha256"]} for r in referencias
        ]
        actual = _ficha_actual(ficha, contenidos.get(identidad))
        _agregar_condicion_inscripcion(actual, contenidos.get(identidad), publico["corte_proyeccion_utc"])
        validar_aprendizaje(actual["aprendizaje"], capturas, registro, huella, _fecha)
        fichas.append(actual)
    # La secuencia editorial conserva también recursos temporalmente ausentes:
    # el selector los declara pendientes y no da el camino por completado.
    registro_bytes = (Path(__file__).parent / "esquemas/registro_aprendizaje.json").read_text()
    return {
        "schema_version": 1,
        "catalogo": {
            "sha256": hashlib.sha256(publico_bytes).hexdigest(),
            "bytes": len(publico_bytes),
            "revision": publico["revision"],
        },
        "registro": referencia_registro,
        "registro_json": registro_bytes,
        "fichas": fichas,
        "caminos": copy.deepcopy(definicion["caminos"]),
    }
