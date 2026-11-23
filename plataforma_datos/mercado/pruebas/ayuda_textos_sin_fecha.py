"""Una ayuda de las pruebas: lo que delata una fecha esperada o una previsión en un texto que llega a la persona."""

import re
from datetime import UTC, datetime

# Un día escrito (22/10, 22-10-2026), un mes con nombre, o una previsión o deducción con palabras.
FECHA_ESPERADA = re.compile(
    r"\b\d{1,2}[/-]\d{1,2}\b|\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|"
    r"diciembre)\b|se esperan?\b|\bhacia\b|previst|\bsuele\b|\bsuelen\b|deducci|\bsale el\b|\bsaldrá\b|"
    r"se prevé|\bprevé\b|próxim|\bpronto\b",
    re.IGNORECASE,
)
# Las fechas que salen de una evidencia capturada: la consulta de una captura y una fecha del calendario oficial.
CON_EVIDENCIA = re.compile(
    r"consultad[oa] el [0-9]{2}/[0-9]{2}/[0-9]{4}|anunciada en el calendario del INE para el [0-9]{2}/[0-9]{2}/[0-9]{4}"
)
# Un año suelto, fuera de un intervalo como «2026–2027» (que nombra una edición, no una fecha).
ANIO_SUELTO = re.compile(r"(?<![0-9–-])(20[0-9]{2})(?![0-9–-])")


def fechas_esperadas(texto: str, anio_en_curso: int | None = None) -> list[str]:
    """Lo que en el texto parece una fecha, una previsión o un año futuro, aparte de las fechas con evidencia.

    Args:
        texto: El texto.
        anio_en_curso: El año de hoy; None toma el del reloj.

    Returns:
        Las coincidencias; vacía si no hay ninguna.
    """
    hoy = datetime.now(UTC).year if anio_en_curso is None else anio_en_curso
    texto = CON_EVIDENCIA.sub("", texto)
    encontradas = [coincidencia.group(0) for coincidencia in FECHA_ESPERADA.finditer(texto)]
    return encontradas + [anio for anio in ANIO_SUELTO.findall(texto) if int(anio) > hoy]
