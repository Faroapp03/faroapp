"""Identidades de DigComp desde el marco preparado, sin correspondencias ni niveles de cursos."""

import re
from typing import Any

from plataforma_datos.comun.nucleo import exigir
from plataforma_datos.cursos.contrato_aprendizaje import validar_registro
from plataforma_datos.cursos.fuentes.formacion.constantes import MIN_RESULTADOS_DIGCOMP, TIPOS_RESULTADO_DIGCOMP

URL_SUPLEMENTO = "https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/DIGCOMP/DIGCOMP3.0/"
NIVELES_CUATRO = ("Basic", "Intermediate", "Advanced", "Highly advanced")
NIVELES_SEIS = ("A1", "A2", "B1", "B2", "C1", "C1", "C2", "C2")
COMPETENCIAS = tuple(
    f"Competence/{area}.{numero}"
    for area, total in ((1, 3), (2, 6), (3, 4), (4, 4), (5, 4))
    for numero in range(1, total + 1)
)


def _texto(valor: object) -> bool:
    return isinstance(valor, str) and bool(valor.strip()) and valor.isprintable()


def _niveles(marco: dict[str, Any]) -> None:
    niveles = marco.get("niveles")
    exigir(isinstance(niveles, list) and len(niveles) == len(NIVELES_SEIS), "DigComp: escala oficial incompleta")
    exigir(
        all(isinstance(n, dict) and type(n.get("nivel_ocho")) is int for n in niveles),
        "DigComp: nivel sin identidad entera",
    )
    por_numero = {n["nivel_ocho"]: n for n in niveles}
    exigir(set(por_numero) == set(range(1, len(NIVELES_SEIS) + 1)), "DigComp: niveles ausentes o duplicados")
    for numero, seis in enumerate(NIVELES_SEIS, start=1):
        nivel = por_numero[numero]
        cuatro = NIVELES_CUATRO[(numero - 1) // 2]
        exigir(type(nivel["nivel_ocho"]) is int, "DigComp: identificador de nivel no entero")
        exigir(
            nivel.get("nivel_cuatro") == cuatro
            and nivel.get("nivel_seis") == seis
            and nivel.get("id") == f"ProficiencyLevel/{cuatro}_{numero}",
            "DigComp: cambió la correspondencia publicada entre escalas; requiere revisión",
        )
        exigir(
            all(_texto(nivel.get(c)) for c in ("descripcion_cuatro", "descripcion_ocho", "alcance")),
            "DigComp: nivel sin descripción o alcance",
        )
    for cuatro in NIVELES_CUATRO:
        descripciones = {n["descripcion_cuatro"] for n in niveles if n["nivel_cuatro"] == cuatro}
        exigir(len(descripciones) == 1, "DigComp: descripciones contradictorias para el mismo nivel")


def _resultados(marco: dict[str, Any]) -> None:
    resultados = marco.get("resultados")
    exigir(
        isinstance(resultados, list) and len(resultados) >= MIN_RESULTADOS_DIGCOMP,
        "DigComp: resultados de aprendizaje incompletos",
    )
    ids: set[str] = set()
    for resultado in resultados:
        exigir(isinstance(resultado, dict), "DigComp: resultado no estructurado")
        identidad = resultado.get("id")
        exigir(_texto(identidad) and identidad not in ids, "DigComp: resultado sin identidad o duplicado")
        ids.add(identidad)
        exigir(resultado.get("competencia") in COMPETENCIAS, "DigComp: resultado sin competencia conocida")
        exigir(
            resultado.get("nivel") in tuple(f"ProficiencyLevel/{n}" for n in NIVELES_CUATRO),
            "DigComp: resultado sin nivel publicado conocido",
        )
        exigir(
            isinstance(resultado.get("tipo"), str)
            and resultado["tipo"] in TIPOS_RESULTADO_DIGCOMP
            and _texto(resultado.get("texto")),
            "DigComp: resultado sin tipo o descripción",
        )


def registro_desde_marco(marco: dict[str, Any], procedencia: dict[str, Any]) -> dict[str, Any]:
    """Construye identidades reproducibles; la captura debe comprobarse antes de prepararla.

    El suplemento define escalas propias. No establece equivalencias con ACTIC,
    ESCO ni las etapas de un camino, ni acredita que un curso las enseñe.

    Returns:
        Registro de competencias y etiquetas literales con la referencia de su captura.
    """
    exigir(
        procedencia.get("archivo") == "digcomp-3.0.jsonld" and procedencia.get("url") == URL_SUPLEMENTO,
        "DigComp: procedencia ajena al suplemento oficial",
    )
    huella = procedencia.get("sha256")
    exigir(isinstance(huella, str) and re.fullmatch(r"[a-f0-9]{64}", huella), "DigComp: huella no válida")
    competencias = marco.get("competencias")
    exigir(isinstance(competencias, list), "DigComp: competencias ausentes")
    exigir(
        all(isinstance(c, dict) and _texto(c.get("id")) for c in competencias),
        "DigComp: competencia sin identidad textual",
    )
    exigir(
        len(competencias) == len(COMPETENCIAS)
        and {c.get("id") for c in competencias if isinstance(c, dict)} == set(COMPETENCIAS),
        "DigComp: competencias incompletas, duplicadas o de otra clasificación",
    )
    exigir(all(_texto(c.get("titulo")) for c in competencias), "DigComp: competencia sin denominación")
    _niveles(marco)
    _resultados(marco)
    referencia = f"{URL_SUPLEMENTO} (DigComp 3.0 Data Supplement, JSON-LD, sha256:{huella})"
    por_id = {c["id"]: c for c in competencias}
    registro = {
        "id": "registro-compartido-formacion",
        "version": "digcomp-3.0-captura-" + huella[:12],
        "competencias": [
            {
                "marco": "DigComp",
                "version": "3.0",
                "codigo": codigo,
                "denominacion": por_id[codigo]["titulo"],
                "fuente": referencia + "; " + codigo,
            }
            for codigo in COMPETENCIAS
        ],
        "escalas": [
            {
                "id": "digcomp-four-levels",
                "version": "3.0",
                "denominacion": "four_levels_name (etiquetas literales del suplemento DigComp 3.0)",
                "fuente": referencia,
                "valores": list(NIVELES_CUATRO),
            }
        ],
    }
    validar_registro(registro)
    return registro
