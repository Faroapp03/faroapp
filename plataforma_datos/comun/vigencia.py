"""El bloque `vigencia` que lleva cada archivo nuevo del paquete: de cuándo es el dato y cuándo llega el siguiente.

Cinco campos, siempre los mismos, para que quien lo presente pueda decir el periodo de cada cifra sin adivinarlo:

- `periodo`: a qué fecha o a qué intervalo se refiere el dato («2021-01-01», «2025-07/2026-06», «2025»…);
- `publicado`: cuándo lo publicó su fuente (fecha ISO o el año); `None` si la fuente no lo proporciona;
- `siguiente_prevista`: la fecha de la siguiente edición según el calendario oficial de la fuente, o `None` si no
  hay ninguna en él;
- `calendario`: de dónde sale la previsión y, si no hay fecha, qué cabe esperar y por qué;
- `fuente`: el organismo y la operación, en una línea.

El bloque no avisa por la edad de un dato: un censo de 2021 es el último que da su detalle, y decirlo una vez basta.
Lo que sí se comprueba es que sus fechas sean coherentes entre sí. Python estándar.
"""

import datetime
import re
from typing import Any, TypedDict

from plataforma_datos.comun.dia_de_consulta import dia_iso_en_cataluna
from plataforma_datos.comun.nucleo import Controles, FormatoInesperado, exigir

CALENDARIO_INE = "calendario de publicaciones del INE (https://www.ine.es/dynt3/Calendario/calendario.ics)"
CAMPOS = ("periodo", "publicado", "siguiente_prevista", "calendario", "fuente")
# Una fecha ISO 8601 de año, año y mes o día completo, solo con cifras ASCII y meses y días posibles.
FECHA = re.compile(r"[0-9]{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12][0-9]|3[01]))?)?")
# Largo de una fecha con día (AAAA-MM-DD): solo esa forma puede nombrar un día que no existe (2026-02-30).
LARGO_FECHA_CON_DIA = len("AAAA-MM-DD")


class Vigencia(TypedDict):
    """El bloque `vigencia` de un archivo del paquete (los campos, en la cabecera)."""

    periodo: str
    publicado: str | None
    siguiente_prevista: str | None
    calendario: str
    fuente: str


def bloque(
    periodo: str, publicado: str | None, siguiente_prevista: str | None, calendario: str, fuente: str
) -> Vigencia:
    """El bloque `vigencia` de un archivo del paquete, con sus campos en el orden de siempre.

    Returns:
        El bloque.
    """
    return {
        "periodo": periodo,
        "publicado": publicado,
        "siguiente_prevista": siguiente_prevista,
        "calendario": calendario,
        "fuente": fuente,
    }


def fecha_valida(valor: object) -> bool:
    """Indica si un valor es una fecha ISO 8601 bien escrita (AAAA, AAAA-MM o AAAA-MM-DD) que existe.

    Args:
        valor: El valor leído del bloque; puede no ser un texto si el JSON lo trae mal.

    Returns:
        True si es un texto con la forma de FECHA y, con día, un día del calendario.
    """
    if not isinstance(valor, str) or not FECHA.fullmatch(valor) or valor.startswith("0000"):
        return False
    if len(valor) == LARGO_FECHA_CON_DIA:
        try:
            datetime.date.fromisoformat(valor)
        except ValueError:
            return False
    return True


def problemas(vigencia: dict[str, Any]) -> list[str]:
    """Lo que no cuadra en un bloque: campos que faltan, fechas mal escritas o una siguiente edición no posterior.

    Returns:
        Lo que no cuadra; vacía si nada.
    """
    faltan = [campo for campo in CAMPOS if campo not in vigencia]
    if faltan:
        return [f"faltan {faltan}"]
    # Publicación desconocida solo se admite sin una fecha siguiente cuya posterioridad no se puede comprobar.
    mal = [
        campo
        for campo in ("publicado", "siguiente_prevista")
        if not fecha_valida(vigencia[campo]) and vigencia[campo] is not None
    ]
    mal += [campo for campo in ("periodo", "fuente", "calendario") if not vigencia[campo]]
    if mal:
        return [f"campos vacíos o fechas mal escritas: {mal}"]
    # Se conserva la precisión publicada y su orden como texto ISO. Si los periodos de dos fechas parciales
    # se solapan, este orden no acredita que la siguiente edición sea cronológicamente posterior.
    siguiente = vigencia["siguiente_prevista"]
    if vigencia["publicado"] is None:
        return [] if siguiente is None else ["fecha siguiente sin una publicación conocida"]
    if siguiente is not None and siguiente <= vigencia["publicado"]:
        return [f"la siguiente edición ({siguiente}) no es posterior a la publicada ({vigencia['publicado']})"]
    return []


def comprobar(controles: Controles, partes: dict[str, dict[str, Any]]) -> None:
    """Registra un control para todos los bloques `vigencia` de un conjunto, nombrando los que no cuadran.

    Args:
        controles: Donde se registra.
        partes: Los bloques, por el nombre de la parte del conjunto.
    """
    fallos = {nombre: problemas(vigencia) for nombre, vigencia in partes.items()}
    fallos = {nombre: lista for nombre, lista in fallos.items() if lista}
    controles.comprobar(
        not fallos,
        f"vigencia de {', '.join(partes)}: periodo, fecha de publicación, siguiente edición según su calendario y "
        "fuente" + (f"; no cuadran: {fallos}" if fallos else ""),
    )


def de_eurostat(
    filas: list[dict[str, Any]], tablas: dict[str, Any], procedencia: dict[str, Any]
) -> tuple[dict[str, str], dict[str, Vigencia]]:
    """La consulta de cada original y la vigencia de cada tabla Eurostat, con el día de consulta en la hora de Cataluña.

    La comparten los conjuntos de Eurostat de «Datos globales». La fuente no publica una fecha para su siguiente
    versión; la cita lleva la consulta del original correspondiente a cada tabla.

    Returns:
        La fecha de consulta por original y la vigencia por tabla.

    Raises:
        FormatoInesperado: Si falta un original, una tabla no tiene filas o sus fechas no son válidas.
    """
    exigir(bool(tablas), "Eurostat: preparado sin tablas para determinar su vigencia")
    consultado: dict[str, str] = {}
    for archivo in procedencia["archivos"]:
        nombre, instante = archivo["archivo"], archivo.get("descargado_utc")
        exigir(isinstance(instante, str), f"{nombre}: fecha de descarga inválida: {instante!r}")
        try:
            consultado[nombre] = dia_iso_en_cataluna(instante)
        except FormatoInesperado as error:
            raise FormatoInesperado(f"{nombre}: fecha de descarga inválida: {instante!r}") from error
    vigencias: dict[str, Vigencia] = {}
    for tabla, datos in tablas.items():
        nombre = f"eurostat-{tabla}.json"
        exigir(nombre in consultado, f"{tabla}: falta el original {nombre} en la procedencia")
        anios = [fila["anio"] for fila in filas if fila["tabla"] == tabla]
        exigir(bool(anios), f"{tabla}: tabla sin filas para determinar su periodo")
        publicado = datos.get("actualizado")
        exigir(
            fecha_valida(publicado) and len(publicado) == LARGO_FECHA_CON_DIA,
            f"{tabla}: fecha de publicación inválida: {publicado!r}",
        )
        vigencias[tabla] = bloque(
            periodo=str(max(anios)),
            publicado=publicado,
            siguiente_prevista=None,
            calendario="Eurostat no publica una fecha para la versión siguiente: se actualiza cuando llega la encuesta "
            "de cada país.",
            fuente=f"Eurostat, {tabla} (https://doi.org/10.2908/{tabla.upper()}), versión filtrada, consultada el "
            + datetime.date.fromisoformat(consultado[nombre]).strftime("%d/%m/%Y"),
        )
    return consultado, vigencias
