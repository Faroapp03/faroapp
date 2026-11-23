"""Textos y cifras de las fuentes: normalización, claves de comparación, códigos, números en castellano y %."""

import html
import re

from plataforma_datos.comun.nucleo import exigir

# ---------------------------------------------------------------------------------------------------------------------
# Texto
# ---------------------------------------------------------------------------------------------------------------------


def texto(valor: object) -> str:
    """Texto con los espacios en blanco agrupados y recortado; `None` es el texto vacío.

    Returns:
        El texto normalizado.
    """
    if valor is None:
        return ""
    return re.sub(r"\s+", " ", str(valor)).strip()


# Los caracteres de control C1 (U+0080-U+009F) que deja un texto escrito en Windows-1252 y leído como Latin-1: en
# Windows-1252 esos bytes son puntuación (0x92 es el apóstrofo tipográfico, «’»). Ninguna fuente usa los controles C1.
_CONTROLES_DE_WINDOWS = re.compile("[\x80-\x9f]")


def texto_sin_controles_de_windows(valor: object) -> str:
    """Texto (`texto`) con cada control C1 cambiado por el carácter que es en Windows-1252.

    «d», U+0092 e «instal·lacions» es «d’instal·lacions». Los cinco bytes que Windows-1252 no define (0x81, 0x8D,
    0x8F, 0x90 y 0x9D) no son texto de ninguna fuente: se quitan.

    Returns:
        El texto reparado y normalizado.
    """
    return _CONTROLES_DE_WINDOWS.sub(
        lambda control: bytes([ord(control.group())]).decode("cp1252", errors="ignore"), texto(valor)
    )


def clave_de_comparacion(valor: object) -> str:
    """Reduce un texto a la clave con que se emparejan dos textos.

    Quedan las minúsculas del castellano (a-z, á, é, í, ó, ú, ü, ñ), las cifras y un espacio entre palabras. Todo lo
    demás separa como un espacio: signos y apóstrofos (también «‚Äô», el tipográfico mal decodificado) y las letras de
    fuera de esa lista, como à, è, ò, ï o ç.

    Args:
        valor: El texto; `None` es el texto vacío.

    Returns:
        La clave de comparación.
    """
    return re.sub(r"[^a-z0-9áéíóúüñ]+", " ", texto(valor).lower()).strip()


def texto_plano(marcado: str) -> str:
    """Saca el texto de un fragmento HTML.

    Primero se quitan las etiquetas (cada una deja un espacio, para que «a<br>b» no junte «ab») y después se resuelven
    las entidades: una entidad que escribe «&lt;b&gt;» queda como el texto «<b>», no como etiqueta. Por último se
    agrupan los espacios con `texto`.

    Args:
        marcado: El fragmento HTML.

    Returns:
        El texto sin etiquetas, con las entidades resueltas y los espacios agrupados.
    """
    return texto(html.unescape(re.sub(r"<[^>]+>", " ", marcado)))


def codigo(valor: object) -> str:
    """Código de clasificación como texto: Excel guarda algunos como número (1113.0); los que empiezan por 0, no.

    Args:
        valor: La celda, como número o como texto.

    Returns:
        El código como texto.

    Raises:
        FormatoInesperado: Si la celda es un número con decimales, NaN o infinito: no es un código.
    """
    if isinstance(valor, float):
        exigir(valor.is_integer(), f"código de clasificación no entero: {valor!r}")
        return str(int(valor))
    return texto(valor)


def numero_es(numero: float, decimales: int = 0) -> str:
    """Número con la tipografía española: punto de miles, coma decimal y signo menos (−).

    Returns:
        El número escrito con la tipografía española.
    """
    # Se intercambian los separadores ingleses pasando por un espacio, para no pisar uno con otro.
    cifra = f"{abs(numero):,.{decimales}f}".replace(",", " ").replace(".", ",").replace(" ", ".")
    signo = "−" if numero < 0 else ""
    return signo + cifra


def numero_con_coma(texto: str) -> float:
    """Número escrito con punto de miles y coma decimal, como lo publican el INE y el Idescat: «37.132.240» o «33,7».

    Returns:
        El número.
    """
    return float(texto.replace(".", "").replace(",", "."))


# ---------------------------------------------------------------------------------------------------------------------
# Cifras
# ---------------------------------------------------------------------------------------------------------------------


def pct(parte: float, total: float) -> float | None:
    """Porcentaje con un decimal; `None` si el total es cero (no hay sobre qué calcularlo).

    Returns:
        El porcentaje, o None si el total es cero.
    """
    if not total:
        return None
    return round(100 * parte / total, 1)


def personas_anteriores(personas: float | None, variacion: float | None) -> int | None:
    """Personas antes de la variación relativa; sin cifra o con una variación imposible, no se deducen.

    Returns:
        Las personas anteriores, o None si no se pueden deducir.
    """
    if personas is None or variacion is None or variacion <= -1:
        return None
    return round(personas / (1 + variacion))
