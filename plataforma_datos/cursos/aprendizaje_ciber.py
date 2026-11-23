"""Aprendizaje literal de un material Ciber actual, con condiciones revisadas aparte."""

import copy
from dataclasses import dataclass

from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.cursos.contrato_entrega_catalogo import exigir
from plataforma_datos.cursos.fuentes.cibervoluntarios import lector
from plataforma_datos.cursos.fuentes.cibervoluntarios.control_actual import MATERIAL_ALIAS_FUNDAE

CAMPOS = ("aprenderContent", "paraTiContent", "descriptionContent", "description")
CONDICIONES = ("paraTiContent", "descriptionContent", "description")
METODO = "ciber-aprendizaje-campos-publicados:1"
MAX_CAMPO_BYTES = 64 * 1024
MAX_BLOQUES = 128


@dataclass(frozen=True, kw_only=True)
class BloqueCiber:
    """Texto completo, campo semántico y captura original que lo contiene."""

    texto: str
    firma: str
    evidencia: dict


@dataclass(frozen=True, kw_only=True)
class TemarioCiber:
    """Material de la identidad nativa y del contexto admitido seleccionado."""

    programa_id: str
    idioma: str | None
    bloques: tuple[BloqueCiber, ...]
    contexto_condiciones_sha256: str


def _bloques_html(texto: object, url: str) -> list[tuple[str, str, str]]:
    """Reutiliza el parser de bloques/contextos que ya contrasta Academy.

    Returns:
        Texto, firma semántica y localizador relativo; scripts o entidades ajenas no acreditan objetivos.
    """
    if not isinstance(texto, str) or not texto.strip() or len(texto.encode("utf-8")) > MAX_CAMPO_BYTES:
        return []
    # Importación local: el generador despacha TemarioCiber, pero el parser es común.
    from plataforma_datos.cursos.aprendizaje_entrega import BloquesDeAprendizaje

    parser = BloquesDeAprendizaje(url)
    parser.en_main = True
    parser.feed(texto)
    parser.close()
    if len(parser.bloques) > MAX_BLOQUES:
        return []
    if not parser.bloques and "<" not in texto:
        plano = " ".join(texto.split())
        return [(plano, sha256_json(["texto", plano]), "texto")]
    return [
        (t, f, f"html/bloque[{i + 1}] ({tag}, línea {pos[0]}, columna {pos[1] + 1})")
        for i, (t, f, tag, pos) in enumerate(
            zip(parser.bloques, parser.firmas, parser.etiquetas, parser.posiciones, strict=True)
        )
    ]


def construir(programa_id: str, material: lector.MaterialCiber, ctx: dict, url_ficha: str) -> TemarioCiber:
    """Extrae campos del material español, sin confundir interés con requisito.

    Returns:
        Bloques y huella de todas las declaraciones pertinentes de condiciones.
    """
    exigir(
        programa_id == "cibervoluntarios:material:" + str(material.id)
        or programa_id == "fundae:1:3462"
        and material.id == MATERIAL_ALIAS_FUNDAE,
        "Identidad del temario Ciber incompatible",
    )
    exigir(material.idioma_publicado == "Español", "Aprendizaje Ciber sin material español seleccionado")
    bloques, contexto = [], {}
    for campo in CAMPOS:
        extraidos = _bloques_html(material.material_publicado.get(campo), url_ficha)
        if campo in CONDICIONES:
            contexto[campo] = [[t, f] for t, f, _ in extraidos]
        for texto, firma, localizador in extraidos:
            bloques.append(
                BloqueCiber(
                    texto=texto,
                    firma=sha256_json([METODO, campo, firma]),
                    evidencia={
                        "url": material.captura.url,
                        "capturado_utc": material.captura.recibido_utc,
                        "sha256": material.captura.sha256,
                        "localizador": material.localizador + "/" + campo + "/" + localizador,
                    },
                )
            )
    declaracion = ctx["declaraciones"].get("requisitos")
    contexto["requisitos_generales"] = declaracion["literal"] if declaracion is not None else None
    if declaracion is not None:
        meta = ctx["capturas"]["declaraciones"]
        bloques.append(
            BloqueCiber(
                texto=declaracion["literal"],
                firma=sha256_json([METODO, "requisitos_generales", declaracion["literal"]]),
                evidencia={
                    "url": meta["url"],
                    "capturado_utc": meta["fin_utc"],
                    "sha256": meta["cuerpo_sha256"],
                    "localizador": declaracion["localizador"],
                },
            )
        )
    return TemarioCiber(
        programa_id=programa_id,
        idioma="es",
        bloques=tuple(bloques),
        contexto_condiciones_sha256=sha256_json([METODO, material.id, material.actividad_id, contexto]),
    )


def proyectar(ficha: dict, actual: object) -> dict:
    """Conserva solo afirmaciones vigentes en el mismo campo, contexto e identidad.

    Returns:
        Ficha filtrada; un cambio de condiciones requiere nueva revisión sin borrar otros objetivos.
    """
    if not isinstance(actual, TemarioCiber) or actual.programa_id != ficha["programa_id"]:
        actual = None
    salida = copy.deepcopy(ficha)
    firmas = salida.pop("firmas_semanticas")
    contexto = salida.pop("contexto_condiciones_sha256")
    salida["idioma_ficha"] = actual.idioma if actual is not None else None
    conservadas = []
    for afirmacion in salida["aprendizaje"]["afirmaciones"]:
        posiciones = []
        for e, firma in zip(afirmacion["evidencias"], firmas[afirmacion["id"]], strict=True):
            candidatas = [b for b in actual.bloques if b.texto == e["fragmento"] and b.firma == firma] if actual else []
            posiciones.append(candidatas[0] if len(candidatas) == 1 else None)
        if not posiciones or any(p is None for p in posiciones):
            continue
        for e, bloque in zip(afirmacion["evidencias"], posiciones, strict=True):
            e.update({k: v for k, v in bloque.evidencia.items() if k != "localizador"})
            e["localizador"]["valor"] = bloque.evidencia["localizador"]
        conservadas.append(afirmacion)
    ids = {a["id"] for a in conservadas}
    salida["aprendizaje"]["afirmaciones"] = conservadas
    salida["aprendizaje"]["contenido_observado"] = actual is not None
    salida["cobertura"] = [c for c in salida["cobertura"] if all(a in ids for a in c["afirmaciones"])]
    if (
        actual is None
        or contexto != actual.contexto_condiciones_sha256
        or any(
            a["dimension"] == "requisito_entrada" and a["id"] not in ids for a in ficha["aprendizaje"]["afirmaciones"]
        )
    ):
        salida["requisitos"] = "sin_verificar"
    return salida
