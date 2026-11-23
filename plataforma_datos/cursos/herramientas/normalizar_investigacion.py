"""Convierte investigación contrastada a fichas uniformes; no clasifica niveles Faro."""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import pathlib
import re
import unicodedata
from dataclasses import dataclass
from typing import NoReturn

from plataforma_datos.cursos.catalogo import cargar_lotes, validar_lote
from plataforma_datos.cursos.contrato_fichas import normalizar_datos_edicion, validar_lote_fichas
from plataforma_datos.cursos.tipos_json import ObjetoJson, ValorJson

LONGITUD_SHA256_HEXADECIMAL = 64


def _leer_json(p: pathlib.Path) -> ValorJson:
    return json.loads(p.read_text())


def _huella(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def _texto_plano(s: ValorJson) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub("<[^>]+>", " ", str(s or "")))).strip()


def _normalizar_busqueda(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s.casefold()) if not unicodedata.combining(c))


TEMAS = {
    "inteligencia_artificial": (
        "intel[·.]?ligencia artificial|inteligencia artificial|artificial"
        " intelligence|machine learning|aprendizaje automatico|chatgpt|\\b"
        "copilot\\b|\\bia\\b|\\bllm\\b"
    ),
    "programacion": r"python|programaci|programar|\bjava\b|javascript|\bphp\b|\bgo\b|\bgit\b|github|software|algoritm",
    "datos": (
        "datos|dades|\\bsql\\b|mysql|mariadb|power bi|power query|power piv"
        "ot|big data|base de|bases de|data science|ciencia de datos|\\bqgi"
        "s\\b"
    ),
    "ofimatica_productividad": (
        "excel|office|\\bword\\b|powerpoint|outlook|libreoffice|ofim.tica|ofim.atica|productiv|organiza|organitza"
    ),
    "ciberseguridad": (
        "cibersegur|cybersecurity|seguridad en red|amenazas cibern|seguretat|privacidad|privacitat|protecci.n de datos"
    ),
    "web_diseno": (
        "\\bhtml\\b|\\bcss\\b|web|wordpress|woocommerce|figma|\\bux\\b|disseny|diseno|illustrator|indesign|photoshop"
    ),
    "contenido_digital": r"contenido|contingut|audiovisual|video|p.dcast|podcast|canva|shotcut|davinci|youtube|creativ",
    "redes_sistemas": (
        "linux|redes|xarxes|cloud|nuvol|nube|blockchain|internet de las c"
        "osas|\\biot\\b|sistemas operativos|sistema operatiu|5g"
    ),
    "competencias_digitales": (
        "alfabetiza|actic|competenc|thunderbird|correo|tr.mit|administrac"
        "i.n p.blica|iniciaci.n digital|iniciaci. digital|m.bil|movil|int"
        "ernet"
    ),
    "negocio_digital": (
        "m.rqueting|marketing|\\bseo\\b|salesforce|comer[cç]|negoci|negocio"
        "|emprendimiento|instagram|linkedin|social commerce"
    ),
    "tecnologia_educativa": r"moodle|learning|docen|educaci|aprendizaje|aprendre|gamific|videojuegos|videojocs",
    "hardware_robotica": r"rob.tic|electr.nica|maker|3d|ingenieria|engin|tecnologia inmersiva",
}


def etiquetas(titulo: str, url: str) -> list[ObjetoJson]:
    """Propone temas léxicos con la coincidencia publicada como evidencia.

    Returns:
        Propuestas léxicas con su coincidencia literal y URL de evidencia.
    """
    return [
        {
            "codigo": k,
            "estado": "propuesta",
            "metodo": "tema-lexico-v1-solo-descubrimiento",
            "evidencia": {"url": url, "campo": "titulo", "coincidencia": m.group(0)},
        }
        for k, p in TEMAS.items()
        if (m := re.search(p, _normalizar_busqueda(titulo)))
    ]


@dataclass
class _EvidenciasCurso:
    """Fuentes principal y auxiliares de una ficha bajo sus roles independientes."""

    investigacion: _Investigacion
    ev: list[ObjetoJson]
    roles: dict[str, list[ObjetoJson]]

    def auxiliar(self, u: str, rol: str, obligatorio: bool = True) -> None:
        """Prepara los datos locales de auxiliar.

        Raises:
            ValueError: Si los datos o la operación local no cumplen el contrato declarado.
        """
        pruebas = self.investigacion.seleccionar(u)
        if not pruebas:
            if obligatorio:
                raise ValueError("Fuente auxiliar declarada sin captura verificable: " + u)
            return
        self.roles[rol + ":" + _huella(u)[:20]] = pruebas
        self.ev.extend(pruebas)

    def ampliar(self, x: ObjetoJson, prov: str) -> None:
        """Vincula las fuentes auxiliares declaradas sin renovar la evidencia principal."""
        if prov == "upv":
            self.auxiliar("https://www.edx.org/resources/how-to-audit-an-edx-class", "condiciones-auditoria-edx", False)
            self.auxiliar("https://upvx.es/faq", "condiciones-upvx", False)
        for k in ["fuentes_generales", "fuentes_condiciones"]:
            for u in x.get(k, []):
                self.auxiliar(u, k)
        for k in ["fuente_gratuidad", "fuente_condiciones", "fuente_edicion"]:
            if x.get(k):
                self.auxiliar(x[k], k)
        for e in x.get("evidencias", []):
            if e.get("url"):
                self.auxiliar(e["url"], "evidencia-adicional")


class _Investigacion:
    """Estado de lectura y conversión de las fichas, sin mezclar fechas de fuentes."""

    def __init__(self, raiz: pathlib.Path) -> None:
        self.raiz = raiz
        self.evidencias: dict[str, ObjetoJson] = {}
        self.alternativas: dict[str, list[ObjetoJson]] = {}
        self.inc: list[ObjetoJson] = []
        self.roles_entidad: dict[tuple[str, str], dict[str, list[ObjetoJson]]] = {}
        self.proveedores: dict[str, ObjetoJson] = {}
        self.programas: dict[str, ObjetoJson] = {}
        self.ediciones: dict[str, ObjetoJson] = {}

    def metadato(self, d: ValorJson, carpeta: pathlib.Path) -> None:
        """Prepara los datos locales de metadato.

        Raises:
            ValueError: Si los datos o la operación local no cumplen el contrato declarado.
        """
        if not isinstance(d, dict):
            return
        sha = d.get("sha256")
        url = d.get("url") or d.get("url_solicitada") or d.get("urlSolicitada")
        if not (isinstance(sha, str) and len(sha) == LONGITUD_SHA256_HEXADECIMAL and url):
            return
        fecha = d.get("utc") or d.get("captura_utc") or d.get("fecha_utc") or d.get("consultadoUTC")
        archivo = d.get("archivo") or (str(d.get("key")) + ".html" if d.get("key") else None)
        if not fecha or not archivo:
            return
        p = carpeta / archivo
        if not p.exists():
            return
        if hashlib.sha256(p.read_bytes()).hexdigest() != sha:
            raise ValueError("Huella distinta: " + str(p))
        e = {"url": url, "capturado_utc": fecha, "sha256": sha, "archivo": str(p.relative_to(self.raiz))}
        for alias in [url] + [d[k] for k in ("final_url", "url_final", "urlFinal") if d.get(k)]:
            lista = self.alternativas.setdefault(alias, [])
            if not any(
                (p["capturado_utc"], p["sha256"], p["url"]) == (e["capturado_utc"], e["sha256"], e["url"])
                for p in lista
            ):
                lista.append(e)
            self.evidencias.setdefault(alias, e)

    def seleccionar(self, u: str, referencia: ObjetoJson | None = None) -> list[ObjetoJson]:
        """Prepara los datos locales de seleccionar.

        Returns:
            Resultado de la operación con los valores y el orden de la fuente.

        Raises:
            ValueError: Si los datos o la operación local no cumplen el contrato declarado.
        """
        opciones = self.alternativas.get(u, [])
        if isinstance(referencia, dict) and referencia.get("sha256") and referencia.get("utc"):
            opciones = [
                e
                for e in opciones
                if e["sha256"] == referencia["sha256"]
                and e["capturado_utc"] == referencia["utc"]
                and (
                    not referencia.get("archivo_html") or pathlib.Path(e["archivo"]).name == referencia["archivo_html"]
                )
            ]
            if len(opciones) != 1:
                raise ValueError("Referencia de captura principal no demostrada: " + u)
        elif len(opciones) > 1:
            cuerpos = {(e["archivo"], e["url"], e["sha256"]) for e in opciones}
            if len(cuerpos) != 1:
                raise ValueError("Capturas ambiguas sin selección explícita: " + u)
            aviso = {
                "url": u,
                "motivo": "Anotaciones temporales discrepantes del mismo archivo y cuerpo; no acredita dos consultas",
                "capturas": sorted(e["capturado_utc"] for e in opciones),
                "decision": "conservar vector; sucesión estricta de su intervalo, sin captura autoritativa",
            }
            if aviso not in self.inc:
                self.inc.append(aviso)
        return sorted(opciones, key=lambda e: json.dumps(e, sort_keys=True))

    def alta(
        self,
        x: ObjetoJson,
        proveedor: tuple[str, str, str, str],
        *,
        tipo: str = "curso",
        tipo_fechas: str | None = None,
    ) -> None:
        """Convierte la ficha y sus ediciones manteniendo las fuentes por canal.

        Raises:
            ValueError: Si falta la URL oficial o una evidencia necesaria.
        """
        prov, nombre, region, naturaleza = proveedor
        url = x.get("url_oficial_curso") or x.get("url") or x.get("url_publica")
        titulo = _texto_plano(x["titulo"])
        if not url:
            raise ValueError("Falta URL " + titulo)
        ident = prov + ":" + _huella(url + "|" + titulo if prov == "mentor" else url)[:20]
        seleccionar = self.seleccionar
        principales = seleccionar(url, x.get("evidencia"))
        if not principales:
            self.inc.append(
                {
                    "titulo": titulo,
                    "url": url,
                    "motivo": "No se ha vinculado captura principal verificable; no se importa",
                }
            )
            return
        ev = list(principales)
        roles = {"ficha-principal": principales}
        ampliacion = _EvidenciasCurso(self, ev, roles)
        ampliacion.ampliar(x, prov)
        ev = list({(e["url"], e["sha256"], e["capturado_utc"]): e for e in ev}.values())
        self.roles_entidad["programa", ident] = roles
        self.proveedores[prov] = {"id": prov, "nombre": nombre, "territorio": region, "naturaleza": naturaleza}
        idiomas = x.get("idioma") or x.get("idioma_edicion")
        prog = {
            "id": ident,
            "proveedor_id": prov,
            "titulo": titulo,
            "url": url,
            "tipo_unidad": tipo,
            "datos": {
                "idioma_publicado": idiomas,
                "nivel_publicado": x.get("nivel_publicado") or x.get("nivel"),
                "nivel_faro": None,
                "capacidades_revisadas": None,
                "temario_huella": None,
                "contenido_huella": _huella(
                    json.dumps(
                        {
                            "titulo": titulo,
                            "resumen": _texto_plano(x.get("contenido") or x.get("objetivo_temario")),
                            "requisitos": _texto_plano(x.get("requisitos")),
                        },
                        ensure_ascii=False,
                        sort_keys=True,
                    )
                ),
                "contenido_huella_alcance": "titulo, resumen observado y requisitos; no acredita temario completo",
                "resumen_investigacion": _texto_plano(x.get("contenido") or x.get("objetivo_temario"))[:400] or None,
                "requisitos_publicados": _texto_plano(x.get("requisitos")) or None,
                "vinculo_programa": (
                    "ficha oficial; agrupacion entre ediciones pendiente cuando fuente no ofrece ID de programa"
                ),
            },
            "evidencias": ev,
            "etiquetas": etiquetas(titulo, url),
        }
        self.programas[ident] = prog
        runs = x.get("runs") or [x.get("datos_publicos_run") or {}]
        for run in runs:
            eid = ident + ":" + str(run.get("key") or "edicion-publicada")
            d = {
                "modalidad_publicada": x.get("modalidad"),
                "sincronia_publicada": x.get("sincronia"),
                "limite_gratuidad": x.get("limite_gratuidad"),
                "coste_formacion_publicado": x.get("coste_formacion"),
                "coste_certificado_publicado": x.get("coste_certificado") or x.get("coste_certificado_insignia"),
                "coste_herramientas": x.get("licencias") or x.get("licencias_materiales"),
                "estado_inscripcion_evidencia": x.get("inscripcion") or x.get("estado") or x.get("gestion_matricula"),
                "condicion_territorial_publicada": x.get("territorio") or x.get("alcance") or x.get("acceso_espana"),
                "colectivo_publicado": x.get("colectivo") or x.get("edad_colectivo"),
                "edad_publicada": x.get("edad"),
                "situacion_laboral_publicada": x.get("empleo"),
                "matricula_publicada": x.get("como_acceder")
                or x.get("acceso")
                or x.get("alta")
                or x.get("gestion_matricula"),
                "revision_necesaria": [
                    "Clasificacion pedagogica",
                    "Encaje con perfil y calendario",
                    "Condiciones de herramientas si necesarias",
                ],
            }
            d.update(normalizar_datos_edicion(x, run, tipo_fechas=tipo_fechas))
            if run:
                d["run_fuente"] = run
            self.roles_entidad["edicion", eid] = roles
            self.ediciones[eid] = {"id": eid, "programa_id": ident, "datos": d, "evidencias": ev}


def _cargar_universidades(investigacion: _Investigacion, uni: pathlib.Path) -> None:
    informe_ia = _leer_json(uni / "informe-ia-universidades.json")
    for fuente in informe_ia["resultados"]:
        if "UPV" in fuente["proveedor"] or "Politècnica de València" in fuente["proveedor"]:
            continue
        if "Granada" in fuente["proveedor"]:
            investigacion.alta(
                fuente, ("ugr", "Universidad de Granada", "Andalucía", "publica"), tipo_fechas="periodo-formativo"
            )
        else:
            investigacion.alta(fuente, ("uned", "UNED", "Estatal", "publica"))
    informe_tecnologia = _leer_json(uni / "informe-tecnologia-andalucia-valencia.json")
    for fuente in informe_tecnologia["universidad_granada"]:
        investigacion.alta(
            fuente, ("ugr", "Universidad de Granada", "Andalucía", "publica"), tipo_fechas="periodo-formativo"
        )
    for fuente in informe_tecnologia["upv_cursos_tecnologia_audit_parcial"]:
        investigacion.alta(fuente, ("upv", "Universitat Politècnica de València", "Comunitat Valenciana", "publica"))


def _cargar_otras_entidades(investigacion: _Investigacion, otras: pathlib.Path) -> None:
    for fuente in _leer_json(otras / "fichas-verificadas.json")["fichas"]:
        investigacion.alta(
            fuente,
            ("microsoft", "Microsoft Learn", "Internacional", "privada"),
            tipo="ruta_modular" if "/paths/" in fuente["url"] else "modulo",
        )
    informe_ampliacion = _leer_json(otras / "ampliacion-tecnologia.json")
    for fuente in informe_ampliacion["disponibles_saps"]:
        investigacion.alta(fuente, ("saps", "Generalitat Valenciana · SAPS", "Comunitat Valenciana", "publica"))
    for fuente in informe_ampliacion["ediciones_regionales_condicionadas"]:
        investigacion.alta(
            fuente,
            ("cyldigital", "Junta de Castilla y León · CyL Digital", "Castilla y León", "publica"),
            tipo_fechas="periodo-formativo",
        )
    for fuente in _leer_json(otras / "mentor-12-cursos.json")["cursos"]:
        if "Física" in fuente["titulo"]:
            investigacion.inc.append(
                {
                    "titulo": fuente["titulo"],
                    "motivo": "Fuera del ámbito tecnológico directo; conservar en informe fuente",
                }
            )
            continue
        investigacion.alta(
            fuente,
            ("mentor", "Ministerio de Educación · Aula Mentor", "Estatal", "publica"),
            tipo_fechas="periodo-formativo",
        )
    for fuente in _leer_json(otras / "cursos-territoriales.json")["cursos_con_ficha_y_condiciones"]:
        if "kzgunea" in fuente["url"]:
            investigacion.alta(fuente, ("kzgunea", "Gobierno Vasco · KZgunea", "País Vasco", "publica"))
        else:
            investigacion.alta(fuente, ("formacarm", "Región de Murcia · Formacarm", "Región de Murcia", "publica"))


def _construir_lotes(
    proveedores: dict[str, ObjetoJson],
    programas: dict[str, ObjetoJson],
    ediciones: dict[str, ObjetoJson],
    roles_entidad: dict[tuple[str, str], dict[str, list[ObjetoJson]]],
    raiz: pathlib.Path,
) -> tuple[list[ObjetoJson], list[list[ObjetoJson]]]:
    lotes, canales = ([], [])
    for prov, proveedor in proveedores.items():
        principal = next(p["evidencias"][0] for p in programas.values() if p["proveedor_id"] == prov)
        lotes.append(
            {
                "schema_version": 1,
                "observado_utc": principal["capturado_utc"],
                "fuente_lote": "investigacion-nacional-2026-10-22-no-exhaustiva",
                "proveedores": [proveedor],
                "programas": [],
                "ediciones": [],
            }
        )
        canales.append([])
    for grupo, entidad, objetos in (("programas", "programa", programas), ("ediciones", "edicion", ediciones)):
        for ident, objeto in objetos.items():
            lote = {
                "schema_version": 1,
                "observado_utc": objeto["evidencias"][0]["capturado_utc"],
                "fuente_lote": "investigacion-nacional-2026-10-22-no-exhaustiva",
                "proveedores": [],
                "programas": [],
                "ediciones": [],
            }
            lote[grupo] = [objeto]
            validar_lote(lote, True, raiz)
            validar_lote_fichas(lote)
            lotes.append(lote)
            canales.append(
                [
                    {"entidad": entidad, "id": ident, "canal": rol, "evidencias": pruebas}
                    for rol, pruebas in roles_entidad[entidad, ident].items()
                ]
            )
    return (lotes, canales)


def preparar_importacion(raiz: str | pathlib.Path) -> ObjetoJson:
    """Prepara lotes y canales conservando las evidencias y fechas de captura.

    Returns:
        Lotes, canales de entidad e incidencias de la investigación.
    """
    raiz = pathlib.Path(raiz).resolve()
    fuentes = raiz / "fuentes-investigadas"
    uni = fuentes / "universidades"
    otras = fuentes / "otras-entidades"
    investigacion = _Investigacion(raiz)
    metadato = investigacion.metadato
    for p in sorted(uni.rglob("*.json")):
        d = _leer_json(p)
        if isinstance(d, dict):
            metadato(d, p.parent)
    for nombre in [
        "manifest-capturas.json",
        "capturas-nuevas.json",
        "ampliacion-capturas.json",
        "territorio-capturas.json",
    ]:
        d = _leer_json(otras / nombre)
        for x in d if isinstance(d, list) else d.get("capturas", []):
            metadato(x, otras)
    _cargar_universidades(investigacion, uni)
    _cargar_otras_entidades(investigacion, otras)
    lotes, canales = _construir_lotes(
        investigacion.proveedores, investigacion.programas, investigacion.ediciones, investigacion.roles_entidad, raiz
    )
    inc = investigacion.inc
    return {
        "lotes": lotes,
        "canales_temporales": canales,
        "incidencias": inc,
        "control": {
            "conciliacion": False,
            "semantica_temporal": (
                "capturas por entidad y canal; observado_utc es solo referencia cuando hay vector de anotaciones"
            ),
            "anotaciones_duplicadas_no_acreditan_consultas_distintas": True,
        },
    }


def construir(raiz: str | pathlib.Path) -> NoReturn:
    """No entrega el agregado antiguo con una fecha global engañosa.

    Raises:
        ValueError: Si los datos o la operación local no cumplen el contrato declarado.
    """
    preparado = preparar_importacion(raiz)
    raise ValueError(
        f"Usar preparar_importacion/importar_captura: {len(preparado['lotes'])} lotes con canales temporales"
    )


def importar_captura(base: str | pathlib.Path, raiz: str | pathlib.Path) -> ObjetoJson:
    """Importa la captura mediante la transacción pública del catálogo.

    Returns:
        Resultados de la transacción pública y control de la captura importada.
    """
    preparado = preparar_importacion(raiz)
    return {
        "importaciones": cargar_lotes(
            base,
            preparado["lotes"],
            True,
            raiz,
            canales_temporales=preparado["canales_temporales"],
        ),
        "incidencias": preparado["incidencias"],
        "control": preparado["control"],
    }


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--raiz", type=pathlib.Path, required=True)
    a = p.parse_args()
    preparado = preparar_importacion(a.raiz)
    inc = preparado["incidencias"]
    (a.raiz / "lotes-investigacion.json").write_text(json.dumps(preparado, ensure_ascii=False, indent=2) + "\n")
    (a.raiz / "incidencias-normalizacion.json").write_text(json.dumps(inc, ensure_ascii=False, indent=2) + "\n")
    (a.raiz / "taxonomia-temas.json").write_text(
        json.dumps(
            {
                "version": 1,
                "uso": (
                    "Propuestas para descubrimiento; no decide utilidad, nivel ni acceso. Requiere revisión pedagógica."
                ),
                "temas": list(TEMAS),
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n"
    )
    print(
        json.dumps(
            {
                "proveedores": sum(len(lote["proveedores"]) for lote in preparado["lotes"]),
                "programas": sum(len(lote["programas"]) for lote in preparado["lotes"]),
                "ediciones": sum(len(lote["ediciones"]) for lote in preparado["lotes"]),
                "incidencias": len(inc),
            },
            ensure_ascii=False,
        )
    )
