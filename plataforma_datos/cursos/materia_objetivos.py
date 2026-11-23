"""Proyecta temas de objetivos publicados en fuentes admitidas, sin copiar prosa."""

import hashlib
import json
from pathlib import Path
from urllib.parse import urlsplit

from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.cursos import nivel_objetivos_fundae
from plataforma_datos.cursos.materia_sugerencias_cibernarium import NEGACION, normalizar

RUTA_REGLAS = Path(__file__).resolve().parents[2] / "src/catalogo-cursos/indicadores-objetivos.json"


def leer_reglas() -> tuple[dict, str]:
    """Lee reglas y su huella canónica.

    Returns:
        Reglas y SHA.
    """
    reglas = json.loads(RUTA_REGLAS.read_bytes())
    return reglas, sha256_json(reglas)


def sugerir(textos: list, reglas: dict) -> list[str]:
    """Encuentra coincidencias en un mismo objetivo.

    Returns:
        Temas con evidencia afirmativa.
    """
    fragmentos = [normalizar(t) for t in textos if isinstance(t, str)]
    fragmentos = [f for f in fragmentos if f and not NEGACION.search(f)]
    return [
        tema
        for tema, grupos in reglas.items()
        if any(all(f" {normalizar(p)} " in f" {f} " for p in grupo) for f in fragmentos for grupo in grupos)
    ]


def _registro(  # noqa: PLR0913, PLR0917
    unidad: str, programa: str, titulo: str, ref: dict, localizador: str, temas: list[str], huella: str
) -> dict:
    return {
        "unidad_id": unidad,
        "programa_id": programa,
        "titulo": titulo,
        "url": ref["url"],
        "sha256": ref["sha256"],
        "localizador": localizador,
        "reglas_sha256": huella,
        "temas": temas,
    }


def _aplicar_nivel(  # noqa: PLR0913, PLR0917
    e: dict, p: dict, ref: dict, curso: dict, localizador: str, huella: str
) -> None:
    nivel = nivel_objetivos_fundae.orientar(curso.get("objetivos"))
    if nivel:
        e["nivel_objetivos"] = {
            "unidad_id": e["id"],
            "programa_id": p["id"],
            "titulo": p["titulo"],
            "url": ref["url"],
            "sha256": ref["sha256"],
            "localizador": localizador,
            "reglas_sha256": huella,
            **nivel,
        }


def aplicar_fundae(colecciones: dict, referencias: dict) -> None:  # noqa: C901
    """Acredita código, denominación y bytes de la lista FUNDAE de cada edición."""
    reglas, huella = leer_reglas()
    programas = {p["id"]: p for p in colecciones["unidades"] if p["proveedor_id"] == "fundae:publicador:catalogo:3"}
    cache = {}
    huella_nivel = hashlib.sha256(Path(nivel_objetivos_fundae.__file__).read_bytes()).hexdigest()
    for e in colecciones["ediciones"]:
        p = programas.get(e["programa_id"])
        if p is None:
            continue
        e.pop("nivel_objetivos", None)
        codigo = p["id"].removeprefix("fundae:oferta:programa:")
        for ref in sorted(e.get("referencias", []), key=lambda r: r["fecha_referencia"], reverse=True):
            url = urlsplit(ref["url"])
            if url.netloc != "agora.fundae.es" or url.path != "/Buscador/BuscarRecursosFormativosFundaeSEB":
                continue
            archivo = referencias.get(ref["sha256"])
            if archivo is None:
                continue
            sha = ref["sha256"]
            if sha not in cache:
                cuerpo = archivo.ruta.read_bytes()
                if hashlib.sha256(cuerpo).hexdigest() != sha:
                    continue
                try:
                    cache[sha] = json.loads(cuerpo).get("respuesta", [])
                except (ValueError, UnicodeDecodeError):
                    continue
            for i, curso in enumerate(cache[sha]):
                if curso.get("codigoTitulacion") != codigo or curso.get("denominacion") != p["titulo"]:
                    continue
                temas = sugerir([curso.get("objetivos")], reglas)
                _aplicar_nivel(e, p, ref, curso, f"/respuesta/{i}/objetivos", huella_nivel)
                if temas:
                    e["evidencia_temas"] = _registro(
                        e["id"], p["id"], p["titulo"], ref, f"/respuesta/{i}/objetivos", temas, huella
                    )
                break
            if "evidencia_temas" in e or "nivel_objetivos" in e:
                break


def aplicar_ciber(colecciones: dict, seleccionados: dict) -> None:
    """Material y bloque de aprendizaje verificados por el lector del control actual."""
    reglas, huella = leer_reglas()
    programas = {p["id"]: p for p in colecciones["unidades"] if p["proveedor_id"] == "cibervoluntarios"}
    for id, (material, _ctx) in seleccionados.items():
        p = programas.get(id)
        if not p or id != f"cibervoluntarios:material:{material.id}" or p["titulo"] != material.titulo:
            continue
        contenido = material.material_publicado
        # Solo descripción del material y objetivos didácticos explícitos, nunca áreas o marcas.
        textos = [contenido.get("description"), contenido.get("aprenderContent")]
        temas = sugerir(textos, reglas)
        ref = next(
            (
                r
                for r in p.get("referencias", [])
                if r["url"] == material.captura.url and r["sha256"] == material.captura.sha256
            ),
            None,
        )
        if temas and ref:
            p["evidencia_temas"] = _registro(id, id, p["titulo"], ref, material.localizador, temas, huella)
