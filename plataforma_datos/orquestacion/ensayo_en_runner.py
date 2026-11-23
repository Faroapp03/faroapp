"""Ensayo a demanda desde el runner real. La autoridad y la base remotas solo reciben lecturas."""

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

from plataforma_datos.comun.nucleo import RAIZ, ErrorFuente
from plataforma_datos.orquestacion import diario_mantenimiento as diario
from plataforma_datos.orquestacion import recuperar_ediciones
from plataforma_datos.orquestacion.almacen_generaciones import recuperar_generacion
from plataforma_datos.orquestacion.almacen_s3 import AlmacenS3
from plataforma_datos.orquestacion.almacen_trabajos import ACCIONES, leer_referencia
from plataforma_datos.orquestacion.cliente_mantenimiento import ClienteMantenimientoGitHub
from plataforma_datos.orquestacion.ejecutar_mantenimiento import _checkout_limpio
from plataforma_datos.orquestacion.generacion_operativa import REVISION
from plataforma_datos.orquestacion.simular_mantenimiento import main as ensayo_local
from plataforma_datos.orquestacion.transferir_generacion import configuracion_privada


def _preparar(raiz: Path) -> Path:
    with (
        diario.paso("cliente-privado"),
        ClienteMantenimientoGitHub(
            os.environ["FARO_ACTUALIZACION_ORIGEN"],
            os.environ["ACTIONS_ID_TOKEN_REQUEST_URL"],
            os.environ["ACTIONS_ID_TOKEN_REQUEST_TOKEN"],
        ) as cliente,
        diario.paso("autenticacion-lectura"),
    ):
        cliente.observar_construccion()
    with AlmacenS3(configuracion_privada(os.environ)) as almacen:
        referencia = diario.leer_con_reintento("referencia", lambda: leer_referencia(almacen))
        base = referencia["baseOperativa"]
        generacion = raiz / ("generacion-" + base["revisionCodigo"])
        diario.leer_con_reintento(
            "descargar-base",
            lambda: recuperar_generacion(generacion, base["revisionCodigo"], base["sha256Manifiesto"], almacen),
        )
        if recuperar_ediciones.faltan(
            generacion / "contenido",
            recuperar_ediciones.indice_del_sello(generacion, base["revisionCodigo"], base["sha256Manifiesto"]),
        ):
            diario.leer_con_reintento(
                "archivo-ediciones",
                lambda: recuperar_ediciones.descargar(generacion / "contenido", raiz / "fundae.zip", almacen),
            )
    sello = raiz / "sello.json"
    sello.write_text(json.dumps(base))
    return sello


def main(argv: list[str] | None = None) -> int:
    """Selecciona el mismo entorno de producción y ejecuta la preparación o un ciclo con destino privado local.

    Returns:
        Código del ensayo aislado, o un fallo si la lectura autenticada no se completa.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("modo", choices=("preparar", "simular"))
    parser.add_argument("--accion", choices=ACCIONES, required=True)
    args = parser.parse_args(argv)
    revision = os.environ.get("GITHUB_SHA", "")
    if os.environ.get("GITHUB_EVENT_NAME") != "workflow_dispatch" or not REVISION.fullmatch(revision):
        return 1
    with tempfile.TemporaryDirectory(dir=os.environ["RUNNER_TEMP"]) as zona:
        raiz = Path(zona).resolve()
        with diario.abrir(raiz / "diario.jsonl", {"operacion": "ensayo", "revisionCodigo": revision}):
            try:
                with diario.paso("configuracion"):
                    _checkout_limpio(RAIZ, revision)
                sello = _preparar(raiz)
                return ensayo_local(
                    [
                        args.modo,
                        *(["--apoyo-fundae", str(raiz / "fundae.zip")] if (raiz / "fundae.zip").exists() else []),
                        "--sello",
                        str(sello),
                        "--area",
                        str(raiz / "ensayos"),
                        "--accion",
                        args.accion,
                        "--variante",
                        os.environ["FARO_CLOUDFLARE_VARIANTE"],
                    ]
                )
            except (ErrorFuente, OSError, ValueError, KeyError):
                return 1


if __name__ == "__main__":
    sys.exit(main())
