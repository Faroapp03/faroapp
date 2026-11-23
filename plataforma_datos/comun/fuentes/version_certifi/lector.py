"""La última versión publicada de certifi frente a la fijada en `comun/confianza_tls.py`, con su aviso para el panel.

El almacén de certificados raíz está fijado a una versión de certifi con su huella, y renovarlo es una decisión con
revisión: cambia código, requisitos y lock. Esta comprobación solo observa: consulta el índice JSON de PyPI del
paquete, lee su última versión publicada y, si es distinta de la fijada, deja en el conjunto validado un aviso con
forma cerrada, en castellano y en catalán, para que el panel lo muestre. No cambia nada sola. Python estándar.

Uso: python3 -m plataforma_datos.comun.fuentes.version_certifi.lector {descargar,preparar,validar,todo}
"""

import json
import re
import sys
from pathlib import Path
from typing import Any

from plataforma_datos.comun.confianza_tls import CERTIFI_VERSION
from plataforma_datos.comun.descarga_acotada import Contrato, descargar_acotados
from plataforma_datos.comun.dia_de_consulta import dia_de_consulta
from plataforma_datos.comun.entrada_salida import (
    ahora_utc,
    carpetas,
    comprobar_originales,
    controles_de_huella,
    guardar_json,
    leer_json,
    original,
)
from plataforma_datos.comun.nucleo import (
    ARCHIVO_DE_PROCEDENCIA,
    ArchivoDescargable,
    Controles,
    FormatoInesperado,
    exigir,
)
from plataforma_datos.orquestacion.admision import cerrar_validacion
from plataforma_datos.orquestacion.ordenes import principal_fuente_con_descarga

FUENTE = "version_certifi"
URL = "https://pypi.org/pypi/certifi/json"
ARCHIVO = "pypi-certifi.json"
INDICE: ArchivoDescargable = {
    "archivo": ARCHIVO,
    "nivel": "oficial",
    "titulo": "PyPI, índice JSON del paquete certifi",
    "url": URL,
    "licencia": "Metadatos públicos de PyPI; solo se lee el número de la última versión publicada.",
}
# certifi numera sus versiones con la fecha de su publicación: AAAA.MM.DD.
VERSION = re.compile(r"[0-9]{4}\.[0-9]{2}\.[0-9]{2}")
PREPARADO = "version.json"
CLAVE_DEL_AVISO = "certifi-version-nueva"
TEXTOS_DEL_AVISO = {
    "es": "Hay una versión nueva del almacén de certificados raíz (certifi {publicada}); Faro usa la {fijada}. "
    "Renovarlo es una decisión con revisión: Faro no lo cambia solo.",
    "ca": "Hi ha una versió nova del magatzem de certificats arrel (certifi {publicada}); Faro fa servir la {fijada}. "
    "Renovar-lo és una decisió amb revisió: Faro no el canvia tot sol.",
}


def ultima_publicada(datos: bytes) -> str:
    """La última versión publicada, del campo `info.version` del índice JSON de PyPI.

    Returns:
        La versión (AAAA.MM.DD).

    Raises:
        FormatoInesperado: Si la respuesta no es el índice o la versión no tiene la forma de las de certifi.
    """
    try:
        indice = json.loads(datos.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise FormatoInesperado("certifi: el índice de PyPI no es JSON") from error
    exigir(isinstance(indice, dict) and isinstance(indice.get("info"), dict), "certifi: el índice no trae «info»")
    exigir(indice["info"].get("name") == "certifi", "certifi: el índice es de otro paquete")
    publicada = indice["info"].get("version")
    exigir(isinstance(publicada, str) and VERSION.fullmatch(publicada) is not None, f"certifi: versión {publicada!r}")
    return publicada


CONTRATO = Contrato(("application/json",), 8 * 1024 * 1024, ultima_publicada)


def aviso(fijada: str, publicada: str, consultado: str) -> dict[str, Any] | None:
    """El aviso para el panel si la versión publicada no es la fijada; nada si son la misma.

    Returns:
        {clave, fijada, publicada, consultado, texto: {es, ca}}, o None.
    """
    if publicada == fijada:
        return None
    return {
        "clave": CLAVE_DEL_AVISO,
        "fijada": fijada,
        "publicada": publicada,
        "consultado": consultado,
        "texto": {
            idioma: texto.format(publicada=publicada, fijada=fijada) for idioma, texto in TEXTOS_DEL_AVISO.items()
        },
    }


def _procedencia() -> Path:
    return carpetas(FUENTE).original / ARCHIVO_DE_PROCEDENCIA


def descargar(aceptar_cambio: bool = False) -> None:
    """Consulta el índice de PyPI con las guardas comunes; la procedencia guarda huella y fecha de la consulta.

    El índice cambia cuando PyPI publica una versión nueva, que es lo que esta fuente detecta: se acepta siempre con su
    huella nueva, sea cual sea `aceptar_cambio`.
    """
    entradas = descargar_acotados([INDICE], carpetas(FUENTE).original, True, CONTRATO)
    guardar_json(_procedencia(), {"fuente": "PyPI · certifi", "archivos": entradas})


def preparar() -> None:
    """Lee la última versión publicada del índice capturado."""
    comprobar_originales(FUENTE)
    publicada = ultima_publicada(original(FUENTE, ARCHIVO).read_bytes())
    guardar_json(carpetas(FUENTE).preparado / PREPARADO, {"publicada": publicada, "fijada": CERTIFI_VERSION})
    print(f"certifi: publicada {publicada}; fijada {CERTIFI_VERSION}")


def validar() -> None:
    """Comprueba la versión y deja el aviso, si lo hay, en el conjunto validado."""
    preparado, procedencia = leer_json(carpetas(FUENTE).preparado / PREPARADO), leer_json(_procedencia())
    publicada, fijada = preparado["publicada"], preparado["fijada"]
    controles = Controles()
    controles_de_huella(controles, carpetas(FUENTE).original, procedencia)
    controles.comprobar(fijada == CERTIFI_VERSION, f"la versión fijada es la de confianza_tls ({CERTIFI_VERSION})")
    controles.comprobar(
        VERSION.fullmatch(publicada) is not None and publicada >= fijada,
        f"la versión publicada ({publicada}) tiene forma de certifi y no es anterior a la fijada ({fijada})",
    )
    consultado = dia_de_consulta(procedencia["archivos"][0]["descargado_utc"])
    informe = {
        "estado": controles.estado,
        "comprobado_utc": ahora_utc(),
        "cobertura": {"publicada": publicada, "fijada": fijada},
        "limites": "Solo observa la última versión publicada; renovar el almacén de certificados es una decisión "
        "con revisión.",
        "controles": controles.lista,
    }
    cerrar_validacion(
        FUENTE,
        informe,
        controles,
        lambda: {
            "fijada": fijada,
            "publicada": publicada,
            "consultado": consultado,
            "aviso": aviso(fijada, publicada, consultado),
        },
    )


def main(argv: list[str] | None = None) -> int:
    """Interfaz de línea de órdenes: descargar, preparar, validar o todo.

    Args:
        argv: Los argumentos; None toma los de la línea de órdenes.

    Returns:
        El código de salida del proceso.
    """
    return principal_fuente_con_descarga(
        __doc__,
        descargar=descargar,
        preparacion_y_validacion={"preparar": preparar, "validar": validar},
        argumentos=argv,
    )


if __name__ == "__main__":
    sys.exit(main())
