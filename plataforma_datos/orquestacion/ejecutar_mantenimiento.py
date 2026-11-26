"""Punto de entrada privado del mantenimiento y su activación explícita por fases.

El runner proporciona su identidad y los tres argumentos del despacho. Las credenciales
del almacén y de OIDC permanecen en el supervisor, separadas del proceso candidato.
"""

import argparse
import json
import os
import re
import subprocess
import sys
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from plataforma_datos.comun.nucleo import RAIZ, ErrorFuente
from plataforma_datos.orquestacion import archivo_diario
from plataforma_datos.orquestacion import diario_mantenimiento as diario
from plataforma_datos.orquestacion.activacion import ConfiguracionActivacion, activar_trabajo
from plataforma_datos.orquestacion.almacen_generaciones import guardar_generacion
from plataforma_datos.orquestacion.almacen_s3 import AlmacenS3
from plataforma_datos.orquestacion.almacen_trabajos import inicializar_referencia
from plataforma_datos.orquestacion.cliente_mantenimiento import ClienteMantenimientoGitHub, ErrorMantenimiento
from plataforma_datos.orquestacion.contrato_activacion import RechazoSinEfecto
from plataforma_datos.orquestacion.ejecutor_operativo import (
    VARIANTES_CLOUDFLARE,
    ConfiguracionEjecutorOperativo,
    ejecutar_trabajo,
)
from plataforma_datos.orquestacion.reanudacion_de_entradas import ReanudacionNoDisponible
from plataforma_datos.orquestacion.salud_mantenimiento import diagnostico
from plataforma_datos.orquestacion.transferir_generacion import configuracion_privada

ERROR_GENERICO = "Mantenimiento no confirmado: revisa la configuración y el estado privado del trabajo."
ERROR_VARIANTE = (
    "Mantenimiento no iniciado: declara en FARO_CLOUDFLARE_VARIANTE la variante de Cloudflare de la instalación, "
    "oficial o privado."
)
PLAZO_GIT_S = 30


class VarianteNoDeclarada(ValueError):
    """La instalación no declara una variante de Cloudflare admitida; no se abre ninguna conexión."""


def _checkout_limpio(checkout: Path, revision: str) -> None:
    """Exige el commit del evento y sus archivos versionados intactos en el checkout privado.

    Raises:
        ValueError: Si la raíz o el commit no coinciden con los autorizados.
        subprocess.SubprocessError: Si Git no confirma un árbol versionado intacto a tiempo.
    """
    entorno = {
        "PATH": os.defpath,
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_GLOBAL": os.devnull,
        "GIT_NO_REPLACE_OBJECTS": "1",
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_NO_LAZY_FETCH": "1",
    }
    for argumentos, esperado in (
        (["rev-parse", "--show-toplevel"], str(checkout)),
        (["rev-parse", "HEAD"], revision),
        (["diff", "--quiet", "--no-ext-diff", "HEAD", "--"], ""),
    ):
        resultado = subprocess.run(
            ["git", "-C", str(checkout), *argumentos],
            env=entorno,
            capture_output=True,
            check=True,
            text=True,
            timeout=PLAZO_GIT_S,
        )
        if resultado.stdout.rstrip("\n") != esperado:
            raise ValueError(ERROR_GENERICO)


def configuracion_ejecucion(
    checkout: Path, directorio_trabajo: Path, entorno: Mapping[str, str], *, recuperacion: bool = False
) -> ConfiguracionEjecutorOperativo:
    """Valida la identidad del runner y el despacho antes de abrir conexiones privadas.

    Returns:
        Identidad actual real del supervisor, ligada al checkout y al modo explícito.

    Raises:
        ValueError: Si el contexto del runner o los argumentos no corresponden al protocolo.
        VarianteNoDeclarada: Si la instalación no declara una variante de Cloudflare admitida.
    """
    if entorno.get("GITHUB_ACTIONS") != "true" or entorno.get("GITHUB_EVENT_NAME") != "workflow_dispatch":
        raise ValueError(ERROR_GENERICO)
    revision = entorno.get("GITHUB_SHA", "")
    reserva = entorno.get("FARO_REVISION_RESERVA", "")
    if re.fullmatch(r"[0-9a-f]{40}", revision) is None or re.fullmatch(r"[1-9][0-9]{0,15}", reserva) is None:
        raise ValueError(ERROR_GENERICO)
    variante = entorno.get("FARO_CLOUDFLARE_VARIANTE", "")
    if variante not in VARIANTES_CLOUDFLARE:
        raise VarianteNoDeclarada(ERROR_VARIANTE)
    checkout = checkout.resolve(strict=True)
    workspace = entorno.get("GITHUB_WORKSPACE", "")
    if not workspace or Path(workspace).resolve(strict=True) != checkout or checkout != RAIZ.resolve():
        raise ValueError(ERROR_GENERICO)
    # Solo «si» descarga las fuentes en paralelo; cualquier otro valor, o ninguno, deja la serie. La lista de fuentes
    # que se quedan en serie (separadas por comas) solo cuenta con el paralelo: en serie se ignora, aunque exista.
    en_paralelo = entorno.get("FARO_FUENTES_EN_PARALELO") == "si"
    en_serie = entorno.get("FARO_FUENTES_EN_SERIE", "") if en_paralelo else ""
    reanudar_entradas = entorno.get("FARO_REANUDAR_ENTRADAS", "no")
    if reanudar_entradas not in ("si", "no"):
        raise ValueError(ERROR_GENERICO)
    configuracion = ConfiguracionEjecutorOperativo(
        checkout=checkout,
        directorio_trabajo=directorio_trabajo,
        revision_codigo=revision,
        solicitud_id=entorno.get("FARO_SOLICITUD_ID", ""),
        revision_reserva=int(reserva),
        run_id=entorno.get("GITHUB_RUN_ID", ""),
        run_attempt=entorno.get("GITHUB_RUN_ATTEMPT", ""),
        accion=entorno.get("FARO_ACCION", ""),
        variante_cloudflare=variante,
        recuperacion_activacion=recuperacion,
        revisar_paquete_pendiente=entorno.get("FARO_REVISAR_PAQUETE_PENDIENTE") == "si",
        reanudar_entradas=reanudar_entradas == "si",
        en_paralelo=en_paralelo,
        fuentes_en_serie=tuple(fuente.strip() for fuente in en_serie.split(",") if fuente.strip()),
    )
    _checkout_limpio(checkout, revision)
    return configuracion


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    acciones = parser.add_subparsers(dest="accion", required=True)
    for nombre in ("ejecutar", "reanudar", "activar", "reconciliar", "recuperar"):
        accion = acciones.add_parser(nombre)
        accion.add_argument("checkout", type=Path)
        accion.add_argument("directorio_trabajo", type=Path)
        accion.add_argument("--registro", type=Path, help="Diario privado JSONL del supervisor y del almacén.")
        if nombre in ("activar", "reconciliar", "recuperar"):
            accion.add_argument("--configuracion-cloudflare", type=Path, required=True)
            accion.add_argument("--configuracion-cloudflare-cursos", type=Path, required=True)
            accion.add_argument("--origen-publico", required=True)
    registro = acciones.add_parser("registro", help="Leer el diario privado conservado por un job.")
    registro.add_argument("run")
    registro.add_argument("--intento", default="1")
    registro.add_argument("--operacion", choices=archivo_diario.OPERACIONES, default="ejecutar")
    inicializar = acciones.add_parser("inicializar")
    inicializar.add_argument("generacion", type=Path)
    inicializar.add_argument("--revision-generacion", required=True)
    inicializar.add_argument("--sha256-manifiesto", required=True)
    return parser


def raiz_del_ciclo(configuracion: ConfiguracionEjecutorOperativo) -> Path:
    """La instalación que el motor rellena en este job, donde quedan las lecturas del ciclo.

    Es el candidato del directorio `run-<ejecución>-1` que crea `ejecutor_operativo` al iniciar; una orden que no
    lee fuentes (activar, reconciliar, recuperar, reanudar un recibo) no lo crea, y su parte dice que no hubo lecturas.

    Returns:
        La ruta del candidato, exista o no.
    """
    return configuracion.directorio_trabajo.resolve() / f"run-{configuracion.run_id}-1" / "candidato"


def _ejecutar(argumentos: argparse.Namespace, entorno: Mapping[str, str]) -> dict[str, Any]:
    with diario.paso("configuracion"):
        configuracion = configuracion_ejecucion(
            argumentos.checkout, argumentos.directorio_trabajo, entorno, recuperacion=argumentos.accion == "recuperar"
        )
        almacen_config = configuracion_privada(entorno)
    with AlmacenS3(almacen_config) as almacen:
        try:
            with (
                diario.paso("supervisor"),
                ClienteMantenimientoGitHub(
                    entorno.get("FARO_ACTUALIZACION_ORIGEN", ""),
                    entorno.get("ACTIONS_ID_TOKEN_REQUEST_URL", ""),
                    entorno.get("ACTIONS_ID_TOKEN_REQUEST_TOKEN", ""),
                ) as cliente,
            ):
                try:
                    resumen = _operar(argumentos, configuracion, cliente, almacen)
                except (ErrorMantenimiento, OSError):
                    if argumentos.accion != "ejecutar" or not argumentos.registro:
                        raise
                    with argumentos.registro.open(encoding="utf-8") as eventos:
                        decision = diagnostico(eventos)["accion"]
                    if decision != "reenviar-recibo-conservado":
                        raise
                    diario.anotar("recuperacion", "iniciada", accion=decision)
                    resumen = ejecutar_trabajo(configuracion, cliente, almacen, reanudar=True)
                diario.anotar(
                    "operacion", "resultado", resultado=resumen.get("resultado"), faseFinal=resumen.get("fase")
                )
                return resumen
        finally:
            if argumentos.registro and argumentos.registro.exists():
                try:
                    archivo_diario.archivar(
                        argumentos.registro,
                        almacen,
                        archivo_diario.Ejecucion(configuracion.run_id, configuracion.run_attempt, argumentos.accion),
                        raiz_del_ciclo(configuracion),
                    )
                except (OSError, ValueError):
                    # Una incidencia al archivar no autoriza repetir un efecto ya confirmado.
                    diario.anotar("archivo-diario", "pendiente", copia="log-del-job")


def _operar(
    argumentos: argparse.Namespace,
    configuracion: ConfiguracionEjecutorOperativo,
    cliente: ClienteMantenimientoGitHub,
    almacen: AlmacenS3,
) -> dict[str, Any]:
    if argumentos.accion in ("activar", "reconciliar", "recuperar"):
        activacion = ConfiguracionActivacion(
            ejecucion=configuracion,
            configuracion_cloudflare=argumentos.configuracion_cloudflare,
            configuracion_cloudflare_cursos=argumentos.configuracion_cloudflare_cursos,
            origen_publico=argumentos.origen_publico,
        )
        return activar_trabajo(
            activacion,
            cliente,
            almacen,
            reconciliar=argumentos.accion == "reconciliar",
            recuperar=argumentos.accion == "recuperar",
        )
    return ejecutar_trabajo(configuracion, cliente, almacen, reanudar=argumentos.accion == "reanudar")


def main(argv: list[str] | None = None) -> int:
    """Imprime solo un resumen confirmado; los errores no revelan rutas, cuerpos ni secretos.

    Returns:
        Cero cuando se confirma la operación; uno ante fallo o resultado incierto.
    """
    argumentos = _parser().parse_args(argv)
    try:
        if argumentos.accion == "registro":
            with AlmacenS3(configuracion_privada(os.environ)) as almacen:
                print(archivo_diario.leer(almacen, argumentos.run, argumentos.intento, argumentos.operacion), end="")
            return 0
        if argumentos.accion == "inicializar":
            with AlmacenS3(configuracion_privada(os.environ)) as almacen:
                guardar_generacion(
                    argumentos.generacion, argumentos.revision_generacion, argumentos.sha256_manifiesto, almacen
                )
                resumen = inicializar_referencia(
                    {
                        "revisionCodigo": argumentos.revision_generacion,
                        "sha256Manifiesto": argumentos.sha256_manifiesto,
                    },
                    almacen,
                )
        else:
            identidad = {"operacion": argumentos.accion}
            for nombre, patron, campo in (
                ("GITHUB_RUN_ID", r"[1-9][0-9]{0,15}", "run"),
                ("GITHUB_RUN_ATTEMPT", r"[1-9][0-9]{0,15}", "intento"),
                ("GITHUB_SHA", r"[0-9a-f]{40}", "revisionCodigo"),
                ("FARO_REVISION_RESERVA", r"[1-9][0-9]{0,15}", "reserva"),
            ):
                valor = os.environ.get(nombre, "")
                if re.fullmatch(patron, valor):
                    identidad[campo] = valor
            with diario.abrir(argumentos.registro, identidad):
                resumen = _ejecutar(argumentos, os.environ)
    except (VarianteNoDeclarada, RechazoSinEfecto, ReanudacionNoDisponible) as error:
        # Su texto solo nombra la variable que falta o el motivo del rechazo: no contiene rutas, cuerpos ni secretos.
        print(error, file=sys.stderr)
        return 1
    except (ErrorFuente, OSError, ValueError, RecursionError, subprocess.SubprocessError):
        print(ERROR_GENERICO, file=sys.stderr)
        return 1
    print(json.dumps(resumen, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
