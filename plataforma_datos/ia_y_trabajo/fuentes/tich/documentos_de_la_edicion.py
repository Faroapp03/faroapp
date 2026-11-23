"""Lo que cada edición de la TIC-H dice de sí misma en sus documentos: el enunciado de la pregunta y su muestra.

Se comprueba al ejecutar, con los documentos de la edición candidata (la admitida guarda en su estado lo que dijeron
los suyos al admitirla, edicion.py):

- el enunciado, por partes (`PARTES`): la pregunta, su periodo de referencia, la opción de uso por trabajo y los
  códigos. En el diseño de registro, la descripción de `IAG` e `IAG_TRAB` contiene cada parte y su lista es `T_SINO`
  (1 sí y 6 no); en el cuestionario, cada fragmento de cada parte aparece una sola vez. El texto se compara sin
  espacios ni mayúsculas, porque la extracción del PDF parte palabras («dispon ible»), y sin el número de la pregunta,
  que cambia de una edición a otra. Una parte que no casa es un motivo cerrado de la candidata («enunciado-distinto»,
  con las partes), no un fallo de lectura;
- la muestra: las secciones censales en muestra de España y de Cataluña, leídas de la metodología (el tamaño muestral
  y la fila de Cataluña de su distribución), con la huella del PDF.

Un retoque del enunciado que no cambia lo que se pregunta se acepta como variante de ese año en `VARIANTES_ACEPTADAS`,
con su evidencia (el procedimiento está en el README de la fuente). Los PDF se leen con la biblioteca `pypdf`.
"""

import io
import re
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from pypdf import PdfReader
from pypdf.errors import PyPdfError

from plataforma_datos.comun.entrada_salida import sha256_bytes
from plataforma_datos.comun.nucleo import FormatoInesperado, exigir

PARTES = ("pregunta", "periodo", "opciones", "codigos")
# Cada parte en la descripción de cada variable del diseño de registro.
DISENO_DE_LA_PREGUNTA: Mapping[str, Mapping[str, str]] = {
    "IAG": {"pregunta": "Uso de alguna herramienta de IA Generativa", "periodo": "(últimos 3 meses)"},
    "IAG_TRAB": {
        "pregunta": "Finalidad del uso de IA Generativa",
        "opciones": "Fines profesionales o relacionados con el trabajo",
    },
}
LISTA_SI_NO = "T_SINO"
CODIGOS_SI_NO = {"1": "Sí", "6": "No"}
# Cada parte en el cuestionario: fragmentos que aparecen una sola vez y no comparten texto con los de otra parte, para
# que un cambio en una no se cuente también en otra. El periodo de la segunda pregunta se ancla con lo que lo sigue, el
# arranque de su primera opción («a) Para»): la pregunta de las razones para no usar IA generativa, que la sigue en el
# cuestionario de 2025, acaba con la misma frase («en los últimos 3 meses? SÍ NO»), pero su primera opción es otra.
CUESTIONARIO_DE_LA_PREGUNTA: Mapping[str, tuple[str, ...]] = {
    "pregunta": (
        "alguna herramienta de IA Generativa (ChatGPT, Copilot, Gemini, LlaMA, Midjourney, etc) para crear contenido "
        "como texto, imágenes, código de programación o vídeos?",
        "¿Para qué ha utilizado herramientas de IA Generativa",
    ),
    "periodo": (
        "¿Ha utilizado en los últimos tres meses",
        "en los últimos 3 meses? SÍ NO a) Para",
    ),
    "opciones": ("b) Para fines profesionales o relacionados con el trabajo",),
    "codigos": ("o vídeos? SÍ 1", "relacionados con el trabajo 1 6"),
}
# Variantes aceptadas del enunciado, por año y por parte: los fragmentos que sustituyen a los de la serie en el
# cuestionario de ese año. Cada una se añade con su evidencia (README de la fuente).
VARIANTES_ACEPTADAS: Mapping[str, Mapping[str, tuple[str, ...]]] = {}
# Variantes aceptadas del diseño de registro, por año, variable y parte: el fragmento de su descripción que sustituye
# al de la serie (`DISENO_DE_LA_PREGUNTA`) ese año. Se añaden igual, con su evidencia (README de la fuente).
VARIANTES_DEL_DISENO: Mapping[str, Mapping[str, Mapping[str, str]]] = {}
TAMANO_MUESTRAL = re.compile(r"tamaño muestral de ([0-9]{1,2}\.[0-9]{3}|[0-9]{3,5}) secciones censales")
FILA_DE_CATALUNA = re.compile(r"Castilla - La Mancha [0-9]+ Cataluña ([0-9]{2,4}) Comunitat Valenciana")


def partes_distintas(diferencias: list[dict[str, str]]) -> list[str]:
    """Las partes del enunciado que difieren, en el orden de `PARTES`.

    Returns:
        Las partes.
    """
    return [parte for parte in PARTES if any(diferencia["parte"] == parte for diferencia in diferencias)]


class EnunciadoDistinto(FormatoInesperado):
    """El diseño de registro de la edición no trae la pregunta de la serie: no es un fallo de lectura."""

    def __init__(self, diferencias: list[dict[str, str]]) -> None:
        super().__init__(f"TIC-H: el enunciado es distinto en {partes_distintas(diferencias)}: {diferencias}")
        self.diferencias = diferencias


def texto_del_pdf(datos: bytes, nombre: str) -> str:
    """El texto de un PDF, con los espacios reducidos a uno.

    Returns:
        El texto.

    Raises:
        FormatoInesperado: Si no se puede leer como PDF.
    """
    try:
        paginas = PdfReader(io.BytesIO(datos)).pages
        return " ".join(" ".join((pagina.extract_text() or "") for pagina in paginas).split())
    except (PyPdfError, ValueError, KeyError, OSError) as error:
        raise FormatoInesperado(f"TIC-H: {nombre} no se puede leer como PDF") from error


def _compacto(texto: str) -> str:
    return "".join(texto.split()).casefold()


def diferencias_del_diseno(diseno: dict[str, Any], anio: str) -> list[dict[str, str]]:
    """Las partes de la pregunta que no casan en el diseño de registro: descripciones y códigos.

    Una variante aceptada para ese año y esa parte (`VARIANTES_DEL_DISENO`) sustituye al fragmento de la serie.

    Returns:
        Una diferencia por parte y variable (`parte`, `donde`, `detalle`); vacía si casan todas.
    """
    diferencias = []
    variables = {campo.get("name"): campo for campo in diseno.get("layout", []) if isinstance(campo, dict)}
    for variable, partes in DISENO_DE_LA_PREGUNTA.items():
        campo = variables.get(variable)
        if campo is None:
            diferencias.append({"parte": "pregunta", "donde": "diseño", "detalle": f"no trae {variable}"})
            continue
        descripcion = str(campo.get("description"))
        variantes = VARIANTES_DEL_DISENO.get(anio, {}).get(variable, {})
        for parte, de_la_serie in partes.items():
            if variantes.get(parte, de_la_serie) not in descripcion:
                diferencias.append({"parte": parte, "donde": "diseño", "detalle": f"{variable}: «{descripcion}»"})
        if campo.get("codelist_ref") != LISTA_SI_NO:
            diferencias.append({"parte": "codigos", "donde": "diseño", "detalle": f"{variable}: otra lista"})
    if diseno.get("codelists", {}).get(LISTA_SI_NO) != CODIGOS_SI_NO:
        diferencias.append({"parte": "codigos", "donde": "diseño", "detalle": f"{LISTA_SI_NO} no es {CODIGOS_SI_NO}"})
    return diferencias


def diferencias_del_enunciado(diseno: dict[str, Any], cuestionario: str, anio: str) -> list[dict[str, str]]:
    """Las partes del enunciado que no casan, en el diseño de registro y en el cuestionario de la edición.

    Returns:
        Una diferencia por parte y lugar; vacía si el enunciado es el de la serie o una variante aceptada del año.
    """
    diferencias = diferencias_del_diseno(diseno, anio)
    texto = _compacto(cuestionario)
    for parte, fragmentos in CUESTIONARIO_DE_LA_PREGUNTA.items():
        for fragmento in VARIANTES_ACEPTADAS.get(anio, {}).get(parte) or fragmentos:
            veces = texto.count(_compacto(fragmento))
            if veces != 1:
                diferencias.append({"parte": parte, "donde": "cuestionario", "detalle": f"{veces} veces «{fragmento}»"})
    return diferencias


def secciones_en_muestra(datos: bytes, nombre: str) -> dict[str, Any]:
    """Las secciones censales en muestra de España y de Cataluña, leídas del PDF de metodología, con su huella.

    Returns:
        `espana`, `cataluna` y `sha256` del PDF.

    Raises:
        FormatoInesperado: Si el PDF no trae una sola vez cada cifra.
    """
    texto = texto_del_pdf(datos, nombre)
    espana = {coincidencia.replace(".", "") for coincidencia in TAMANO_MUESTRAL.findall(texto)}
    cataluna = set(FILA_DE_CATALUNA.findall(texto))
    exigir(
        len(espana) == 1 and len(cataluna) == 1,
        f"TIC-H: {nombre} no da una sola vez las secciones en muestra de España y de Cataluña "
        f"({sorted(espana)}, {sorted(cataluna)})",
    )
    return {"espana": int(espana.pop()), "cataluna": int(cataluna.pop()), "sha256": sha256_bytes(datos)}


def leer_documentos(diseno: dict[str, Any], metodologia: Path, cuestionario: Path, anio: str) -> dict[str, Any]:
    """Las secciones en muestra y el enunciado de la edición candidata, leídos una vez de sus documentos.

    Returns:
        `secciones_en_muestra` (con la huella de la metodología) y `enunciado` (diferencias y huella del cuestionario).
    """
    del_cuestionario = cuestionario.read_bytes()
    texto = texto_del_pdf(del_cuestionario, cuestionario.name)
    return {
        "secciones_en_muestra": secciones_en_muestra(metodologia.read_bytes(), metodologia.name),
        "enunciado": {
            "diferencias": diferencias_del_enunciado(diseno, texto, anio),
            "sha256_cuestionario": sha256_bytes(del_cuestionario),
        },
    }


def de_la_admitida(
    diseno: dict[str, Any], secciones: Mapping[str, int], documentos: Mapping[str, str], anio: str
) -> dict[str, Any]:
    """Lo que la edición admitida sabe de sus documentos, del estado de la edición, sin leer sus PDF.

    El diseño de registro sí se comprueba, porque llega con los microdatos que se calculan.

    Returns:
        `secciones_en_muestra` y `enunciado`, con la forma de `leer_documentos`.
    """
    return {
        "secciones_en_muestra": {**secciones, "sha256": documentos["metodologia"]},
        "enunciado": {
            "diferencias": diferencias_del_diseno(diseno, anio),
            "sha256_cuestionario": documentos["cuestionario"],
        },
    }
