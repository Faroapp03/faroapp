"""Causas cerradas de lo que un ciclo no pudo admitir o conservar, para el diario del supervisor.

El diario y su resumen solo llevan palabras de listas cerradas: nunca el motivo libre del informe, rutas ni datos. Este
módulo traduce a esas listas el paso del paquete que quedó en rojo, las alarmas de su comparación y la comprobación que
impidió exportar la generación de un intento. Así se sabe por qué se retuvo un ciclo sin entrar en el runner.
"""

import inspect
import json
import re
import traceback
from pathlib import Path, PurePosixPath
from typing import Any

from plataforma_datos.orquestacion import diario_mantenimiento as diario
from plataforma_datos.orquestacion import generacion_operativa
from plataforma_datos.orquestacion.actualizar import (
    CODIGO_TIEMPO_AGOTADO,
    COMPONER_EL_CATALOGO,
    COMPROBACIONES,
    COTEJO_DE_ARTEFACTOS,
    ENSAMBLADO,
    EXPORTAR_EL_PAQUETE,
)
from plataforma_datos.orquestacion.estado_de_la_actualizacion import VERDE
from plataforma_datos.orquestacion.hora_limite_del_motor import CAUSA as CAUSA_SIN_TIEMPO
from plataforma_datos.orquestacion.hora_limite_del_motor import MOTIVO as MOTIVO_SIN_TIEMPO
from plataforma_datos.orquestacion.modulos import PAQUETE
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import CARPETA_DE_INFORMES, NOMBRE_DE_INFORME

MAX_DOCUMENTO_BYTES = 4 * 1024 * 1024
MAX_ALARMAS = 20
ESTADO = f"{CARPETA_DE_INFORMES}/estado.json"
# Cada paso del paquete, por el rótulo con que lo anota el informe.
PASOS_DEL_PAQUETE = {
    EXPORTAR_EL_PAQUETE.nombre: "exportar",
    COMPONER_EL_CATALOGO.nombre: "componer-catalogo",
    ENSAMBLADO[0].nombre: "incorporar-globales",
    ENSAMBLADO[1].nombre: "preparar-globales",
    ENSAMBLADO[2].nombre: "preparar-biblioteca",
    ENSAMBLADO[3].nombre: "preparar-informe",
    COTEJO_DE_ARTEFACTOS.nombre: "cotejar-web",
    COMPROBACIONES[0].nombre: "comprobar-datos",
}
# «sustituir» es la sustitución final de datos y web; «sin-empezar», un paquete que no empezó porque no cabía antes de
# la hora límite del motor; «otro», un paso que esta lista aún no nombra.
PASOS = (*PASOS_DEL_PAQUETE.values(), "sustituir", "sin-empezar", "otro")
ARCHIVO_DEL_PAQUETE = re.compile(r"[a-z0-9-]+\.json")
# Las alarmas de piezas_de_la_actualizacion.alarmas_del_paquete, por su forma; la que no encaja es «otra».
ALARMAS = (
    ("desaparece", re.compile(r"([a-z0-9-]+\.json) desaparece del paquete")),
    ("entrada-fijada-cambia", re.compile(r"([a-z0-9-]+\.json) cambia y es una entrada fijada .*")),
    ("vectores-desfasados", re.compile(r"([a-z0-9-]+\.json) cambia: los vectores de significado .*")),
)
TIPOS_DE_ALARMA = (*(tipo for tipo, _ in ALARMAS), "otra")
# Las comprobaciones de la exportación son las funciones de generacion_operativa: una lista que fija el propio código.
COMPROBACIONES_DE_LA_GENERACION = tuple(
    sorted(
        nombre.lstrip("_")
        for nombre, funcion in inspect.getmembers(generacion_operativa, inspect.isfunction)
        if funcion.__module__ == generacion_operativa.__name__
    )
)
CAUSAS_DE_LA_GENERACION = {
    "comprobar_originales_del_paquete": "paquete-cita-otros-originales",
    "sin_recuperacion": "recuperacion-pendiente",
    "originales_de_la_fuente": "originales-incoherentes",
    "carpetas_fuentes": "originales-incoherentes",
    "datos": "paquete-incoherente",
    "origenes_operativos": "paquete-incoherente",
    "catalogo": "catalogo-no-admitido",
    "admitidos": "admision-no-verificable",
}
CAUSAS_DE_LA_GENERACION_NO_CONSERVADA = (*sorted(set(CAUSAS_DE_LA_GENERACION.values())), "comprobacion-fallida")
CLASES_DE_ERROR = (
    "GeneracionInvalida",
    "HuellaIncorrecta",
    "FormatoInesperado",
    "ErrorFuente",
    "ActualizacionEnCurso",
    "FileNotFoundError",
    "PermissionError",
    "OSError",
    "ValueError",
    "KeyError",
    "TypeError",
)


def _documento(raiz: Path, relativa: str) -> Any:  # noqa: ANN401 - JSON del candidato, validado por quien lo usa.
    ruta = raiz / relativa
    if ruta.is_symlink() or not ruta.is_file() or ruta.stat().st_size > MAX_DOCUMENTO_BYTES:
        raise ValueError("Documento del candidato ilegible")
    return json.loads(ruta.read_bytes())


def _paso_en_rojo(pasos: list[dict[str, Any]]) -> tuple[str, int | None] | None:
    for paso in reversed(pasos):
        if paso.get("nombre") in PASOS_DEL_PAQUETE and type(paso.get("codigo")) is int and paso["codigo"] != 0:
            return PASOS_DEL_PAQUETE[paso["nombre"]], max(-255, min(255, paso["codigo"]))
    return None


def alarma_cerrada(texto: object) -> dict[str, str | None]:
    """Reduce una alarma del informe a su tipo y al archivo del paquete al que afecta.

    Returns:
        Tipo de la lista cerrada y nombre del archivo, o «otra» sin archivo si la alarma no tiene una forma conocida.
    """
    for tipo, patron in ALARMAS:
        encaje = patron.fullmatch(texto) if isinstance(texto, str) else None
        if encaje is not None:
            return {"tipo": tipo, "archivo": encaje[1]}
    return {"tipo": "otra", "archivo": None}


def causas_del_paquete(candidato: Path) -> dict[str, Any] | None:
    """Explica con palabras cerradas por qué el paquete de este ciclo no quedó en verde.

    Returns:
        El paso en rojo con su código y las alarmas, o None si el paquete de este ciclo quedó en verde o no se ejecutó.

    Raises:
        ValueError: Si el estado o el informe del candidato no tienen la forma que escribe la actualización.
    """
    estado = _documento(candidato, ESTADO)
    actualizacion, paquete = estado["actualizacion"], estado["modulos"][PAQUETE]
    if paquete["ultimo_intento_utc"] != actualizacion["comienzo_utc"] or paquete["veredicto"] == VERDE:
        return None
    relativa = PurePosixPath(actualizacion["informe"]).with_suffix(".json")
    if relativa.parent.as_posix() != CARPETA_DE_INFORMES or NOMBRE_DE_INFORME.fullmatch(relativa.name) is None:
        raise ValueError("Informe del candidato fuera de su carpeta")
    informe = _documento(candidato, relativa.as_posix())
    rojo = _paso_en_rojo(informe["pasos"])
    alarmas = [alarma_cerrada(texto) for texto in informe["comparacion"]["alarmas"][:MAX_ALARMAS]]
    if rojo is None and not alarmas:
        # Sin paso en rojo ni alarma, lo único que deja el paquete en ámbar es su sustitución final.
        motivo = str(paquete.get("motivo") or "")
        sin_empezar = motivo == MOTIVO_SIN_TIEMPO
        rojo = (
            "sustituir" if motivo.startswith("no se pudo sustituir") else "sin-empezar" if sin_empezar else "otro",
            None,
        )
    paso, codigo = rojo or (None, None)
    return {"paso": paso, "codigo": codigo, "alarmas": alarmas}


def registrar_paquete(candidato: Path, resultado: str) -> None:
    """Anota en el diario por qué se retuvo el paquete de un candidato rechazado; no anota nada si quedó en verde."""
    if not diario.activo() or resultado != "rechazado":
        return
    try:
        causas = causas_del_paquete(candidato)
    except (OSError, ValueError, KeyError, TypeError):
        # Es telemetría: un estado o informe ilegible se anota como tal y no detiene al supervisor.
        diario.anotar("paquete", "ilegible")
        return
    if causas is not None:
        diario.anotar("paquete", "retenido", **causas, **_causa_del_paquete(causas))


def _causa_del_paquete(causas: dict[str, Any]) -> dict[str, str]:
    """La causa de un paquete retenido por el tiempo: cortado por el tope de su paso o sin empezar por la hora límite.

    Returns:
        `{"causa": ...}` si el tiempo fue la causa; vacío si no.
    """
    if causas["codigo"] == CODIGO_TIEMPO_AGOTADO:
        return {"causa": "plazo-agotado"}
    return {"causa": CAUSA_SIN_TIEMPO} if causas["paso"] == "sin-empezar" else {}


def causa_de_la_generacion(error: BaseException) -> dict[str, str]:
    """Nombra la comprobación de la exportación que rechazó la generación de un intento, sin su mensaje.

    Returns:
        Clase del error, comprobación de generacion_operativa más interna en la traza y su causa cerrada.
    """
    propio = Path(generacion_operativa.__file__).resolve()
    marcos = [m for m in traceback.extract_tb(error.__traceback__) if Path(m.filename).resolve() == propio]
    comprobacion = marcos[-1].name.lstrip("_") if marcos else "otra"
    if comprobacion not in COMPROBACIONES_DE_LA_GENERACION:
        comprobacion = "otra"
    clase = type(error).__name__
    return {
        "clase": clase if clase in CLASES_DE_ERROR else "otra",
        "comprobacion": comprobacion,
        "causa": CAUSAS_DE_LA_GENERACION.get(comprobacion, "comprobacion-fallida"),
    }


def registrar_generacion_no_conservada(error: BaseException) -> None:
    """Anota en el diario en qué comprobación falló la exportación de la generación del intento."""
    diario.anotar("generacion", "no-conservada", **causa_de_la_generacion(error))
