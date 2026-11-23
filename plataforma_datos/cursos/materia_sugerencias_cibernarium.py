"""Sugerencias reproducibles a partir de objetivos de una descripción ya admitida.

No devuelve ni distribuye la prosa original; una coincidencia es orientación temática,
no una declaración de nivel ni una sustitución de una revisión editorial firmada.
"""

import json
import re
import unicodedata
from pathlib import Path

from plataforma_datos.comun.huella_json import sha256_json

RUTA_REGLAS = Path(__file__).resolve().parents[2] / "src" / "catalogo-cursos" / "indicadores-tema.json"
LONGITUD_MINIMA = 4
TEMAS_VALIDOS = frozenset(
    {
        "ia",
        "digital",
        "ofimatica",
        "datos",
        "seguridad",
        "empresa",
        "oficio",
        "diseno",
        "web",
        "comunicacion",
        "empleo",
        "ciudadania",
        "educacion",
        "sistemas",
    }
)
# Solo frases que expresan contenido o aprendizaje; se excluyen frases negativas o de requisitos.
OBJETIVO = re.compile(
    r"\b(apren\w*|aplic\w*|crea\w*|constru\w*|desenvolup\w*|desarroll\w*|domin\w*|edit\w*|"
    r"formacio centrada|formacion centrada|gestionar\w*|identific\w*|implement\w*|introduc\w*|"
    r"practic\w*|program\w*|treballar\w*|utilitz\w*|utiliz\w*|analitz\w*|analiz\w*|learn\w*|build\w*)\b"
)
NEGACION = re.compile(r"\b(no|sin|sense|ni|nunca|never|without|avoid|evitar|exclou|excepto|except|not|don t|doesn t)\b")


def normalizar(texto: str) -> str:
    """Unifica acentos, mayúsculas y separadores.

    Returns:
        Texto comparable sin acentos ni signos.
    """
    sin_acentos = "".join(c for c in unicodedata.normalize("NFKD", texto.casefold()) if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", sin_acentos).strip()


def leer_reglas() -> tuple[dict, str]:
    """Carga la tabla común.

    Returns:
        Indicadores y huella del JSON canónico de las reglas.

    Raises:
        ValueError: Si el tesauro es incompatible.
    """
    bruto = RUTA_REGLAS.read_bytes()
    datos = json.loads(bruto)
    if not isinstance(datos, dict) or not set(datos) <= TEMAS_VALIDOS:
        raise ValueError("Tesauro de temas incompatible")
    if any(not isinstance(v, list) or any(not isinstance(x, str) or not x for x in v) for v in datos.values()):
        raise ValueError("Indicadores de tema inválidos")
    return datos, sha256_json(datos)


def _fragmentos(description: str, categoria: str) -> list[str]:
    texto = re.sub(r"<[^>]*>", " ", description)
    frases = re.split(r"[.!?;\n\r]+", texto)
    salida = []
    for frase in frases:
        f = normalizar(frase)
        if f and OBJETIVO.search(f) and not NEGACION.search(f):
            salida.append(f)
    # La categoría publicada es una etiqueta del temario, no una frase publicitaria.
    cat = normalizar(categoria)
    if cat and not NEGACION.search(cat):
        salida.append(cat)
    return salida


def sugerir(actividad: dict, reglas: dict) -> list[str]:
    """Busca materias en evidencia afirmativa.

    Returns:
        Materias detectadas, en el orden del tesauro.
    """
    descripcion = actividad.get("description")
    if not isinstance(descripcion, str) or not descripcion.strip():
        return []
    categoria = actividad.get("category")
    fragmentos = _fragmentos(descripcion, categoria if isinstance(categoria, str) else "")
    salida = []
    for tema, indicadores in reglas.items():
        for indicador in indicadores:
            termino = normalizar(indicador)
            # IA/AI en prosa larga puede aparecer incidentalmente y no tiene precisión suficiente.
            if len(termino) < LONGITUD_MINIMA:
                continue
            if termino and any(f" {termino} " in f" {frase} " for frase in fragmentos):
                salida.append(tema)
                break
    return salida
