"""Comprobaciones sin IA de la traducción al catalán: cada texto frente a su original y cada archivo de traducción.

Las comprobaciones de un texto (COMPROBACIONES) miden la forma, no la fidelidad: números, siglas, marcadores, longitud y
caracteres del catalán. Las de un archivo revisan su forma (se escribe fuera de la cadena), su procedencia, sus claves
frente al origen y los textos iguales al castellano. Las usa la validación del lector de la fuente. Python estándar.
"""

import unicodedata
from collections.abc import Callable
from datetime import date
from typing import Any

from plataforma_datos.comun.fuentes.catalan.piezas.constantes_catalan import (
    CAMPOS_PROCEDENCIA,
    CARACTERES_AJENOS,
    CIFRAS,
    ELE_CON_PUNTO,
    ESTADO,
    FECHA_ISO,
    HOLGURA_CARACTERES,
    MARCA,
    MARCADORES,
    PUNTO_VOLADO,
    PUNTO_VOLADO_EN_ELE_GEMINADA,
    RELACION_MAXIMA,
    RELACION_MINIMA,
    SIGLAS,
)

# ---------------------------------------------------------------------------------------------------------------------
# Comprobaciones de un texto traducido (sin IA)
# ---------------------------------------------------------------------------------------------------------------------


def no_vacio(_original: str, traducido: str) -> bool:
    """Comprueba que el texto traducido tiene algo más que espacios.

    Args:
        original: El texto en castellano.
        traducido: Su traducción.

    Returns:
        True si no está vacío.
    """
    return bool(traducido.strip())


def mismos_numeros(original: str, traducido: str) -> bool:
    """Comprueba que la traducción conserva las secuencias de cifras, tantas veces como en el original.

    Args:
        original: El texto en castellano.
        traducido: Su traducción.

    Returns:
        True si las secuencias de cifras coinciden.
    """
    return sorted(CIFRAS.findall(original)) == sorted(CIFRAS.findall(traducido))


def mismas_siglas(original: str, traducido: str) -> bool:
    """Comprueba que la traducción conserva las siglas (palabras de 2 o más mayúsculas), tantas veces como el original.

    Args:
        original: El texto en castellano.
        traducido: Su traducción.

    Returns:
        True si las siglas coinciden.
    """
    return sorted(SIGLAS.findall(original)) == sorted(SIGLAS.findall(traducido))


def mismos_marcadores(original: str, traducido: str) -> bool:
    """La misma cantidad de «/», paréntesis, comillas angulares y %.

    Una «/» suelta al final del original es una errata de la fuente (en ESCO, «…/directora de desarrollo de prendas
    de vestir/»): no se exige copiarla, ni se rechaza copiarla. Por eso se quita del final de los dos textos.

    Args:
        original: El texto en castellano.
        traducido: Su traducción.

    Returns:
        True si cada marcador de MARCADORES aparece las mismas veces en los dos.
    """
    original, traducido = original.strip(), traducido.strip()
    if original.endswith("/"):
        original, traducido = original.rstrip("/"), traducido.rstrip("/")
    return all(original.count(marcador) == traducido.count(marcador) for marcador in MARCADORES)


def longitud_razonable(original: str, traducido: str) -> bool:
    """Comprueba que la traducción no está cortada ni inflada.

    Args:
        original: El texto en castellano.
        traducido: Su traducción.

    Returns:
        True si su longitud está entre RELACION_MINIMA y RELACION_MAXIMA de la del original, con HOLGURA_CARACTERES.
    """
    minima = len(original) * RELACION_MINIMA - HOLGURA_CARACTERES
    maxima = len(original) * RELACION_MAXIMA + HOLGURA_CARACTERES
    return minima <= len(traducido) <= maxima


def caracteres_catalanes(_original: str, traducido: str) -> bool:
    """Comprueba que la traducción no tiene letras ni signos ajenos al catalán.

    Args:
        original: El texto en castellano.
        traducido: Su traducción.

    Returns:
        True si no hay caracteres ajenos ni «l.l» y el punto volado solo aparece en «l·l».
    """
    # Solo se normaliza la copia que se comprueba; los bytes originales y la traducción publicada se conservan.
    traducido = unicodedata.normalize("NFC", traducido)
    if CARACTERES_AJENOS.intersection(traducido) or ELE_CON_PUNTO.search(traducido):
        return False
    return traducido.count(PUNTO_VOLADO) == len(PUNTO_VOLADO_EN_ELE_GEMINADA.findall(traducido))


def solo_siglas_y_numeros(texto: str) -> bool:
    """Indica si un texto no tiene minúsculas (siglas, códigos y números) y puede quedar igual que el castellano.

    Args:
        texto: El texto.

    Returns:
        True si no está vacío y no tiene minúsculas.
    """
    return bool(texto.strip()) and not any(caracter.islower() for caracter in texto)


# Cada comprobación, con lo que se dice de ella en la validación. Se aplican a cada texto con su original, salvo a
# los que la traducción declara iguales al castellano (un nombre propio, una sigla), que ya se comprueban por igualdad.
COMPROBACIONES: tuple[tuple[str, Callable[[str, str], bool]], ...] = (
    ("ningún texto vacío", no_vacio),
    ("se conservan los números (las mismas secuencias de cifras)", mismos_numeros),
    ("se conservan las siglas (palabras de 2 o más mayúsculas)", mismas_siglas),
    ("se conservan los marcadores («/», paréntesis, «», %)", mismos_marcadores),
    ("longitud razonable frente al original", longitud_razonable),
    (
        "caracteres válidos en catalán (sin ñ, á, ì, ù, ¿, ¡; punto volado solo en l·l; apóstrofo ' o ’)",
        caracteres_catalanes,
    ),
)


# ---------------------------------------------------------------------------------------------------------------------
# Comprobaciones de los archivos
# ---------------------------------------------------------------------------------------------------------------------


def problemas_de_procedencia(traduccion: dict[str, Any]) -> list[str]:
    """Revisa la procedencia de una traducción.

    Args:
        traduccion: El contenido del archivo de traducción.

    Returns:
        Lo que falta o no cuadra; vacía si está completa.
    """
    procedencia = traduccion.get("procedencia")
    if not isinstance(procedencia, dict):
        return ["sin procedencia"]
    faltan = [
        campo
        for campo in CAMPOS_PROCEDENCIA
        if not (isinstance(procedencia.get(campo), str) and procedencia[campo].strip())
    ]
    problemas = [f"falta {campo}" for campo in faltan]
    if "fecha" not in faltan:
        fecha = procedencia["fecha"]
        if not FECHA_ISO.fullmatch(fecha):
            problemas.append("fecha que no es AAAA-MM-DD")
        else:
            try:
                date.fromisoformat(fecha)
            except ValueError:
                problemas.append("fecha que no existe en el calendario")
    if procedencia.get("estado") != ESTADO:
        problemas.append(f"estado distinto de «{ESTADO}»")
    if procedencia.get("marca") != MARCA:
        problemas.append(f"marca distinta de «{MARCA}»")
    return problemas


def problemas_de_claves(traduccion: dict[str, Any], origen: dict[str, Any]) -> list[str]:
    """Compara las claves de una traducción con las de su origen.

    Args:
        traduccion: El contenido del archivo de traducción, con su forma comprobada.
        origen: El contenido de su archivo de origen.

    Returns:
        «falta <clave>» y «sobra <clave>», en orden.
    """
    propias, esperadas = set(traduccion.get("textos", {})), set(origen.get("textos", {}))
    return [f"falta {clave}" for clave in sorted(esperadas - propias)] + [
        f"sobra {clave}" for clave in sorted(propias - esperadas)
    ]


def problemas_de_iguales(traduccion: dict[str, Any], origen: dict[str, Any]) -> list[str]:
    """Busca textos iguales al castellano sin motivo, y declaraciones de iguales que no lo son o no dicen por qué.

    Args:
        traduccion: El contenido del archivo de traducción, con su forma comprobada.
        origen: El contenido de su archivo de origen.

    Returns:
        Un problema por clave, «<clave>: <motivo>».
    """
    iguales = traduccion.get("iguales_al_castellano", {})
    textos, originales = traduccion.get("textos", {}), origen.get("textos", {})
    problemas = []
    for clave, motivo in iguales.items():
        if clave not in textos or clave not in originales:
            problemas.append(f"{clave}: declaración sin clave en traducción y origen")
        elif not str(motivo).strip():
            problemas.append(f"{clave}: igual sin motivo")
        elif textos.get(clave) != originales.get(clave):
            problemas.append(f"{clave}: declarada igual y no lo es")
    for clave, texto in textos.items():
        igual = texto == originales.get(clave)
        if igual and clave not in iguales and not solo_siglas_y_numeros(texto):
            problemas.append(f"{clave}: igual al castellano")
    return problemas


def problemas_por_comprobacion(traduccion: dict[str, Any], origen: dict[str, Any]) -> dict[str, list[str]]:
    """Aplica cada comprobación de COMPROBACIONES a los textos de una traducción.

    Args:
        traduccion: El contenido del archivo de traducción, con su forma comprobada.
        origen: El contenido de su archivo de origen.

    Returns:
        Por descripción de la comprobación, las claves que no la cumplen.
    """
    iguales = traduccion.get("iguales_al_castellano", {})
    originales = origen.get("textos", {})
    problemas: dict[str, list[str]] = {descripcion: [] for descripcion, _ in COMPROBACIONES}
    for clave, texto in traduccion.get("textos", {}).items():
        if clave in iguales or clave not in originales:
            continue
        for descripcion, cumple in COMPROBACIONES:
            if not isinstance(texto, str) or not cumple(originales[clave], texto):
                problemas[descripcion].append(clave)
    return problemas


def _es_objeto_de_textos(valor: object) -> bool:
    """Indica si un valor es un objeto de JSON de textos: claves y valores de tipo texto.

    Args:
        valor: El valor leído del archivo.

    Returns:
        True si es un dict cuyas claves y valores son str.
    """
    return isinstance(valor, dict) and all(
        isinstance(clave, str) and isinstance(texto, str) for clave, texto in valor.items()
    )


def problemas_de_forma(traduccion: object) -> list[str]:
    """Comprueba la forma de un archivo de traducción antes de leerlo, porque se escribe fuera de esta cadena.

    Args:
        traduccion: El contenido del archivo.

    Returns:
        Lo que no tiene su forma: un objeto con «textos» y, si lo lleva, «iguales_al_castellano», los dos objetos
        de textos. Vacía si la forma es correcta.
    """
    if not isinstance(traduccion, dict):
        return ["no es un objeto"]
    problemas = [] if _es_objeto_de_textos(traduccion.get("textos")) else ["«textos» no es un objeto de textos"]
    if not _es_objeto_de_textos(traduccion.get("iguales_al_castellano", {})):
        problemas.append("«iguales_al_castellano» no es un objeto de textos")
    return problemas
