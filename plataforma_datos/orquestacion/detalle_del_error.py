"""El detalle con que el diario anota un paso que falla, saneado y en su forma cerrada (`formas_del_diario`).

Un fallo que nadie esperaba lleva la causa por omisión del diario, `comprobacion-fallida`; sin más, no se sabría qué
pasó ni dónde. El detalle lo dice sin sacar del ciclo nada privado: nombres de clases, módulos con su línea y, solo
cuando nadie esperaba el fallo, un mensaje saneado y acotado. Un fallo esperado ya tiene su causa y su mensaje puede
llevar datos del almacén, así que no se copia.

El saneado quita lo que puede ser privado: lo que Python y este código citan entre comillas (valores, órdenes, rutas,
claves), cualquier palabra con barras, arrobas o signos de igual (rutas, direcciones, correos, pares clave=valor), las
cifras largas (identificadores, teléfonos, documentos) y las palabras con forma de credencial.
"""

import re
import subprocess
import traceback
from types import TracebackType

from plataforma_datos.orquestacion.formas_del_diario import LUGAR, MAX_LUGARES, MAX_MENSAJE, tipo_de_error

# Causas encadenadas (`raise ... from`) que se siguen como mucho hasta la primera.
MAX_CADENA = 8
OCULTO = "…"
_ENTRE_COMILLAS = re.compile(r"'[^']*'|\"[^\"]*\"|«[^»]*»")
_PALABRA_PRIVADA = re.compile(r"\S*[/\\@=]\S*")
_CIFRAS_LARGAS = re.compile(r"\w*[0-9]{6,}\w*")
_CREDENCIAL = re.compile(r"\b(?=\w*[0-9])(?=\w*[A-Za-z])\w{20,}\b")
# Lo que queda de esos caracteres (una comilla suelta, por ejemplo) se vuelve un espacio: la forma no los admite.
_FUERA_DE_LA_FORMA = re.compile(r"[\x00-\x1f\x7f'\"/\\@=]+")


def origen(error: BaseException) -> BaseException:
    """Sigue las causas explícitas de una excepción hasta la primera.

    Returns:
        La excepción que provocó las demás, o la misma si nadie la provocó.
    """
    actual = error
    for _ in range(MAX_CADENA):
        if actual.__cause__ is None:
            break
        actual = actual.__cause__
    return actual


def mensaje_saneado(error: BaseException) -> str | None:
    """Sanea el texto de una excepción para el diario.

    Returns:
        El texto sin nada que pueda ser privado, de `MAX_MENSAJE` caracteres como mucho, o `None` si solo quedan
        huecos de lo quitado.
    """
    texto = str(error)
    for patron in (_ENTRE_COMILLAS, _PALABRA_PRIVADA, _CIFRAS_LARGAS, _CREDENCIAL):
        texto = patron.sub(OCULTO, texto)
    texto = " ".join(_FUERA_DE_LA_FORMA.sub(" ", texto).split())
    if len(texto) > MAX_MENSAJE:
        texto = texto[: MAX_MENSAJE - len(OCULTO)] + OCULTO
    return texto if texto.replace(OCULTO, "").strip() else None


def lugares(traza: TracebackType | None) -> list[str]:
    """Nombra los últimos lugares del código propio de una traza, del más externo al más interno.

    Returns:
        Hasta `MAX_LUGARES` lugares `módulo:línea`; el código ajeno (Python, bibliotecas) no se nombra.
    """
    propios = [
        f"{marco.f_globals.get('__name__')}:{linea}"
        for marco, linea in traceback.walk_tb(traza)
        if LUGAR.fullmatch(f"{marco.f_globals.get('__name__')}:{linea}")
    ]
    return propios[-MAX_LUGARES:]


def detalle(
    error: BaseException, paso_de_origen: str, traza: TracebackType | None, *, esperado: bool
) -> dict[str, object]:
    """Compone el detalle de un paso que falla.

    Args:
        error: La excepción que sale del paso.
        paso_de_origen: El paso más interno por el que salió esta misma excepción.
        traza: Su traza desde donde se ejecutó el paso hasta donde se lanzó.
        esperado: Si el fallo tiene una causa propia en el diario; entonces no se copia su mensaje.

    Returns:
        Los campos del detalle, con la forma de `formas_del_diario.es_detalle_de_error`.
    """
    primera = origen(error)
    datos: dict[str, object] = {"tipo": tipo_de_error(error), "pasoDeOrigen": paso_de_origen, "lugares": lugares(traza)}
    if primera is not error:
        datos["origen"] = tipo_de_error(primera)
    if isinstance(primera, subprocess.TimeoutExpired):
        # El plazo que se agotó dice cuánto se esperó: con la hora del inicio del paso, cuándo se cortó.
        datos["plazoSegundos"] = round(primera.timeout)
    mensaje = None if esperado else mensaje_saneado(primera)
    if mensaje is not None:
        datos["mensaje"] = mensaje
    return datos
