"""Marco DigComp 3.0: lee su JSON-LD y extrae competencias, resultados de aprendizaje y niveles de dominio.

Solo interpreta el documento que recibe: no lo descarga, no lo guarda y no atribuye competencias ni niveles a cursos o
personas. Python estándar.
"""

from typing import Any

from plataforma_datos.comun.entrada_salida import Json
from plataforma_datos.comun.nucleo import exigir


def _propiedad_sin_prefijo(propiedad: str) -> str:
    """Quita a una propiedad JSON-LD su prefijo y su espacio de nombres: «dc:identifier» da «identifier».

    Args:
        propiedad: Nombre de la propiedad tal como aparece en el nodo.

    Returns:
        El nombre local de la propiedad, en minúsculas.
    """
    return propiedad.split(":")[-1].split("/")[-1].split("#")[-1].lower()


def _literal(valor: Json) -> Json:
    """Reduce el valor de una propiedad JSON-LD a uno simple.

    Args:
        valor: Valor de la propiedad: un literal, un objeto o una lista de ellos.

    Returns:
        El primero de una lista y, de un objeto, su `@value` (o su `@id`); `None` si la lista está vacía.
    """
    primero = valor
    if isinstance(valor, list):
        primero = valor[0] if valor else None
    if isinstance(primero, dict):
        return primero.get("@value", primero.get("@id"))
    return primero


def _valor(nodo: dict[str, Json], *claves: str) -> Json:
    """Busca en un nodo JSON-LD la primera de `claves` presente, sin mirar prefijo ni espacio de nombres.

    Args:
        nodo: Nodo del grafo JSON-LD.
        *claves: Nombres locales de propiedad, por orden de preferencia.

    Returns:
        El valor simple (`_literal`) de la primera propiedad encontrada, o `None` si no hay ninguna.
    """
    for clave in claves:
        for propiedad, valor in nodo.items():
            if _propiedad_sin_prefijo(propiedad) == clave.lower():
                return _literal(valor)
    return None


def _competencia_digcomp(nodo: dict[str, Any]) -> dict[str, Any]:
    """Extrae una competencia de DigComp.

    Args:
        nodo: Nodo JSON-LD de tipo competencia.

    Returns:
        Su identificador, su título y su descripción.
    """
    return {
        "id": _valor(nodo, "identifier", "notation", "@id"),
        "titulo": _valor(nodo, "prefLabel", "name", "title", "label"),
        "descripcion": _valor(nodo, "definition", "description"),
    }


def _resultado_digcomp(nodo: dict[str, Any]) -> dict[str, Any]:
    """Extrae un resultado de aprendizaje de DigComp.

    Args:
        nodo: Nodo JSON-LD de tipo resultado de aprendizaje.

    Returns:
        Su identificador, texto, etiqueta de IA, competencia, tipo y nivel de cuatro tramos.
    """
    return {
        "id": _valor(nodo, "identifier", "notation", "@id"),
        "texto": _valor(nodo, "prefLabel", "description", "text", "label", "name"),
        "ia": _valor(nodo, "ai_label", "aiLabel", "AI label"),
        "competencia": _valor(nodo, "competence_id", "competence", "isPartOf", "broader", "relatedCompetence"),
        "tipo": _valor(nodo, "type_of_outcome", "outcomeType", "category", "type"),
        "nivel": _valor(nodo, "four_levels_proficiency_name"),
    }


def digcomp(grafo: Json) -> dict[str, Any]:
    """Extrae del JSON-LD de DigComp 3.0 las competencias y los resultados de aprendizaje con su etiqueta de IA.

    Args:
        grafo: Documento JSON-LD: un objeto con «@graph» o directamente la lista de nodos.

    Returns:
        La fuente, competencias, resultados y niveles en las escalas publicadas.

    Raises:
        FormatoInesperado: Si el documento no es un objeto ni una lista, o si algún nodo no es un objeto.
    """
    exigir(isinstance(grafo, (dict, list)), "DigComp 3.0: el JSON-LD no es un objeto ni una lista de nodos")
    nodos = grafo if isinstance(grafo, list) else grafo.get("@graph", [])
    exigir(
        isinstance(nodos, list) and all(isinstance(nodo, dict) for nodo in nodos),
        "DigComp 3.0: el grafo JSON-LD no es una lista de nodos",
    )
    competencias: list[dict[str, Any]] = []
    resultados: list[dict[str, Any]] = []
    niveles: list[dict[str, Any]] = []
    for nodo in nodos:
        tipos = nodo.get("@type", "")
        if not isinstance(tipos, list):
            tipos = [tipos]
        for valor_tipo in tipos:
            tipo = str(valor_tipo).lower()
            if tipo == "proficiencylevel":
                niveles.append(
                    {
                        "id": _valor(nodo, "@id"),
                        "nivel_cuatro": _valor(nodo, "four_levels_name"),
                        "nivel_ocho": _valor(nodo, "eight_levels_mapping"),
                        "nivel_seis": _valor(nodo, "six_levels_mapping"),
                        "descripcion_cuatro": _valor(nodo, "four_levels_description"),
                        "descripcion_ocho": _valor(nodo, "eight_levels_description"),
                        "alcance": _valor(nodo, "applies_to"),
                    }
                )
                break
            if "competence" in tipo and "statement" not in tipo and "area" not in tipo:
                competencias.append(_competencia_digcomp(nodo))
                break
            if "learningoutcome" in tipo.replace(" ", "").replace("_", ""):
                resultados.append(_resultado_digcomp(nodo))
                break
    return {
        "fuente": "Comisión Europea, JRC. DigComp 3.0: European Digital Competence Framework (2025). CC BY 4.0.",
        "competencias": competencias,
        "resultados": resultados,
        "niveles": niveles,
    }
