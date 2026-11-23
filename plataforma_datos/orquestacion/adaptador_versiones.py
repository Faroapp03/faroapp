"""Configuración privada de la activación y puente con el adaptador de versiones de Cloudflare.

El adaptador clasifica cada fallo: sin efecto (rechazo antes de lanzar la orden que cambia Cloudflare), rechazado
por el proveedor de forma explícita, o incierto. Solo los dos primeros demuestran que una subida o un despliegue no
se hizo; todo lo demás conserva la incertidumbre.
"""

import json
import os
import shutil
import stat
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from plataforma_datos.orquestacion.cliente_mantenimiento import validar_origen_publico
from plataforma_datos.orquestacion.contrato_activacion import (
    ERROR,
    ID_VERSION,
    ConfiguracionNoAdmitida,
    RechazoSinEfecto,
    exigir,
    json_estricto,
    objeto,
    texto,
)
from plataforma_datos.orquestacion.ejecutor_operativo import ConfiguracionEjecutorOperativo
from plataforma_datos.orquestacion.lectura_activacion import Servicio
from plataforma_datos.orquestacion.procesos import ejecutar_con_plazo

MAX_ADAPTADOR_BYTES = 16 * 1024
PLAZO_ADAPTADOR_S = 15 * 60
PORCENTAJE_COMPLETO = 100
# Códigos con los que el adaptador rechaza antes de lanzar la orden: una lectura fallida, aunque tampoco tenga
# efecto, no es un rechazo y se trata como incierta.
RECHAZOS_PREVIOS = ("entrada-invalida", "configuracion-incompatible", "artefacto-invalido", "deployment-distinto")


def _privada(configuracion: object, checkout: Path) -> None:
    exigir(isinstance(configuracion, Path))
    exigir(stat.S_ISREG(configuracion.lstat().st_mode))
    exigir(not configuracion.resolve().is_relative_to(checkout.resolve()))


def _rechazo(operacion: str, salida: str) -> None:
    """Traduce un fallo del adaptador que demuestra que no hubo efecto; cualquier otro sigue siendo incierto.

    Raises:
        ConfiguracionNoAdmitida: Rechazo de la configuración durante una lectura.
        RechazoSinEfecto: Subida o despliegue rechazados antes de lanzarse, o rechazados por Cloudflare.
    """
    try:
        error = objeto(json_estricto(salida), "version,error,efecto")
    except ValueError:
        return
    if type(error["version"]) is not int or error["version"] != 1:
        return
    if operacion == "estado" and error["error"] == "configuracion-incompatible":
        raise ConfiguracionNoAdmitida(ERROR)
    if operacion in ("subir", "desplegar"):
        if error["efecto"] == "ninguno" and error["error"] in RECHAZOS_PREVIOS:
            raise RechazoSinEfecto("rechazo-previo")
        if error["efecto"] == "rechazado":
            raise RechazoSinEfecto("rechazo-proveedor")


@dataclass(frozen=True, kw_only=True)
class ConfiguracionActivacion:
    """Configuración explícita privada del supervisor, separada del artefacto recuperado."""

    ejecucion: ConfiguracionEjecutorOperativo
    configuracion_cloudflare: Path
    configuracion_cloudflare_cursos: Path
    origen_publico: str

    def __post_init__(self) -> None:
        _privada(self.configuracion_cloudflare, self.ejecucion.checkout)
        _privada(self.configuracion_cloudflare_cursos, self.ejecucion.checkout)
        # El adaptador comprueba en cada operación que las dos forman la pareja de la instalación (binding CURSOS).
        exigir(self.configuracion_cloudflare.resolve() != self.configuracion_cloudflare_cursos.resolve())
        validar_origen_publico(self.origen_publico)


class AdaptadorVersiones:
    """Invoca exclusivamente la CLI confiable fijada, mediante un archivo privado y sin shell."""

    def __init__(self, configuracion: ConfiguracionActivacion, directorio: Path) -> None:
        self.configuracion = configuracion
        self.directorio = directorio
        self.artefacto: dict[str, Any] | None = None

    def operar(self, operacion: str, *, servicio: str, **campos: object) -> dict[str, Any]:
        """Ejecuta una operación oficial; los errores de transporte conservan incertidumbre.

        Returns:
            Respuesta JSON acotada del adaptador confiable.

        Raises:
            ConfiguracionNoAdmitida: Rechazo explícito durante una lectura sin efecto remoto.
        """
        configuracion = self.configuracion
        nodo = shutil.which("node")
        exigir(nodo is not None)
        # Solo la lectura del estado puede ir sin artefacto: es lo que usa el abandono cuando ya no se conserva.
        exigir(self.artefacto is not None or operacion == "estado")
        solicitud = {
            "version": 1,
            "operacion": operacion,
            "servicio": servicio,
            "configuracion": str(configuracion.configuracion_cloudflare.resolve()),
            "configuracionCursos": str(configuracion.configuracion_cloudflare_cursos.resolve()),
            "intencionId": configuracion.ejecucion.solicitud_id,
            "artefacto": self.artefacto,
            **campos,
        }
        with tempfile.NamedTemporaryFile(dir=self.directorio, prefix=".versiones-", suffix=".json") as archivo:
            archivo.write(json.dumps(solicitud, separators=(",", ":"), allow_nan=False).encode())
            archivo.flush()
            # El adaptador solo recibe las credenciales del proveedor; nunca OIDC ni claves del almacén.
            entorno = {"PATH": os.environ.get("PATH", os.defpath), "TMPDIR": str(self.directorio)}
            for clave in ("CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"):
                if clave in os.environ:
                    entorno[clave] = os.environ[clave]
            resultado = ejecutar_con_plazo(
                [nodo, str(configuracion.ejecucion.checkout / "herramientas/cloudflare/versiones.ts"), archivo.name],
                configuracion.ejecucion.checkout,
                PLAZO_ADAPTADOR_S,
                entorno,
            )
        exigir(0 < len(resultado.stdout.encode()) <= MAX_ADAPTADOR_BYTES)
        if resultado.returncode != 0:
            _rechazo(operacion, resultado.stdout)
        exigir(resultado.returncode == 0)
        documento = objeto(
            json_estricto(resultado.stdout), "version,operacion,servicio,intencionId,artefacto,resultado"
        )
        esperado = (
            None
            if self.artefacto is None
            else {k: self.artefacto[k] for k in ("revisionCodigo", "huellaPaquete", "sha256Artefacto")}
        )
        exigir(type(documento["version"]) is int and documento["version"] == 1)
        exigir(documento["operacion"] == operacion and documento["intencionId"] == solicitud["intencionId"])
        exigir(documento["servicio"] == servicio)
        exigir(documento["artefacto"] == esperado and type(documento["resultado"]) is dict)
        respuesta = documento["resultado"]
        if operacion == "subir":
            objeto(respuesta, "versionId")
            texto(respuesta["versionId"], ID_VERSION)
        elif operacion in ("estado", "desplegar"):
            objeto(respuesta, "deploymentId,versiones")
            texto(respuesta["deploymentId"], ID_VERSION)
            exigir(type(respuesta["versiones"]) is list)
        else:
            objeto(respuesta, "versiones")
            exigir(type(respuesta["versiones"]) is list)
            for version in respuesta["versiones"]:
                objeto(version, "versionId,tag,message")
                texto(version["versionId"], ID_VERSION)
                exigir(version["tag"] is None or isinstance(version["tag"], str))
                exigir(version["message"] is None or isinstance(version["message"], str))
        return respuesta


def version_unica(estado: dict[str, Any]) -> str:
    """Versión que sirve un Worker con un único despliegue al 100 %.

    Returns:
        Identificador de la versión.
    """
    o = objeto(estado, "deploymentId,versiones")
    exigir(type(o["versiones"]) is list and len(o["versiones"]) == 1)
    version = objeto(o["versiones"][0], "versionId,porcentaje")
    exigir(type(version["porcentaje"]) in (int, float) and version["porcentaje"] == PORCENTAJE_COMPLETO)
    texto(o["deploymentId"], ID_VERSION)
    texto(version["versionId"], ID_VERSION)
    return version["versionId"]


def desplegado(adaptador: AdaptadorVersiones, servicio: Servicio) -> dict[str, str]:
    """Lo que sirve ahora el Worker indicado.

    Returns:
        Su versión única al 100 % y su despliegue.
    """
    observado = adaptador.operar("estado", servicio=servicio.nombre)
    return {"versionId": version_unica(observado), "deploymentId": observado["deploymentId"]}
