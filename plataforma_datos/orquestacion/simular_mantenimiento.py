"""Ensayar un ciclo del supervisor con un commit y una base sellada, con almacenamiento y permisos locales."""

import argparse
import fcntl
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import uuid
from contextlib import closing
from pathlib import Path
from typing import Any

from plataforma_datos.comun.nucleo import RAIZ, ErrorFuente
from plataforma_datos.orquestacion import diario_mantenimiento as diario
from plataforma_datos.orquestacion import recuperar_ediciones
from plataforma_datos.orquestacion.almacen_artefactos import recuperar_artefacto
from plataforma_datos.orquestacion.almacen_de_ensayo import AlmacenDeEnsayo
from plataforma_datos.orquestacion.almacen_trabajos import (
    ACCIONES,
    REFERENCIA,
    UUID,
    inicializar_referencia,
    recuperar_trabajo,
)
from plataforma_datos.orquestacion.aprovisionar_candidato import aprovisionar_candidato
from plataforma_datos.orquestacion.bloques_almacen import guardar_archivos
from plataforma_datos.orquestacion.ejecutar_mantenimiento import _checkout_limpio
from plataforma_datos.orquestacion.ejecutor_operativo import ConfiguracionEjecutorOperativo, ejecutar_trabajo
from plataforma_datos.orquestacion.generacion_operativa import REVISION, SHA256, leer_manifiesto_generacion


class PermisoLocal:
    """Representa solo la autoridad aislada de un ensayo bajo su cerrojo exclusivo."""

    def __init__(self, carpeta: Path) -> None:
        self.carpeta = carpeta

    def confirmar_inicio(self, _solicitud: str, _reserva: int, _accion: str) -> str:
        """Reserva el único comienzo del motor para esta intención.

        Returns:
            Acuse aplicado o repetido de esta autoridad local.
        """
        try:
            with (self.carpeta / "inicio").open("xb") as archivo:
                archivo.flush()
                os.fsync(archivo.fileno())
        except FileExistsError:
            return "repetido"
        return "aplicado"

    def enviar_resultado(self, recibo: bytes) -> str:
        """Confirma exactamente el recibo conservado incluso si se perdió una respuesta previa.

        Returns:
            Acuse del receptor local para estos bytes.
        """
        with tempfile.NamedTemporaryFile(dir=self.carpeta) as temporal:
            temporal.write(recibo)
            temporal.flush()
            os.fsync(temporal.fileno())
            try:
                os.link(temporal.name, self.carpeta / "recibo.json")
            except FileExistsError:
                _exigir((self.carpeta / "recibo.json").read_bytes() == recibo)
                return "repetido"
        return "aplicado"


def _exigir(condicion: bool) -> None:
    if not condicion:
        raise ValueError("Configuración, base o intención de ensayo incompatible")


def _sembrar(generacion: Path, base: dict[str, str], almacen: AlmacenDeEnsayo) -> None:
    if almacen.leer_control(REFERENCIA, 8192) is not None:
        return
    manifiesto = leer_manifiesto_generacion(generacion, base["revisionCodigo"], base["sha256Manifiesto"])
    marcador = f"generaciones/{base['sha256Manifiesto']}.json"
    guardar_archivos(generacion / "contenido", manifiesto["archivos"], marcador, almacen)
    origen = generacion / "manifiesto.json"
    almacen.guardar(marcador, origen, base["sha256Manifiesto"], origen.stat().st_size)
    inicializar_referencia(base, almacen)


def _simular(args: argparse.Namespace, identidad: dict[str, str], generacion: Path, carpeta: Path) -> dict[str, Any]:
    base = {"revisionCodigo": identidad["revisionBase"], "sha256Manifiesto": identidad["sha256Manifiesto"]}
    with tempfile.TemporaryDirectory(dir=carpeta, prefix=".trabajo-") as temporal:
        trabajo = Path(temporal)
        if args.modo == "preparar":
            with diario.paso("restaurar-base"):
                return aprovisionar_candidato(
                    RAIZ,
                    trabajo / "candidato",
                    identidad["revisionCodigo"],
                    generacion,
                    base["revisionCodigo"],
                    base["sha256Manifiesto"],
                    apoyo=args.apoyo_fundae,
                )
        with closing(sqlite3.connect(carpeta / "controles.sqlite")) as conexion:
            almacen = AlmacenDeEnsayo(carpeta.parent / "objetos", conexion)
            with diario.paso("semilla"):
                _sembrar(generacion, base, almacen)
            config = ConfiguracionEjecutorOperativo(
                checkout=RAIZ,
                directorio_trabajo=trabajo,
                revision_codigo=identidad["revisionCodigo"],
                solicitud_id=identidad["intencion"],
                revision_reserva=1,
                run_id="1",
                run_attempt="1",
                accion=args.accion,
                variante_cloudflare=args.variante,
            )
            apoyo = args.apoyo_fundae
            if apoyo is None and recuperar_ediciones.faltan(
                generacion / "contenido",
                recuperar_ediciones.indice_del_sello(generacion, base["revisionCodigo"], base["sha256Manifiesto"]),
            ):
                apoyo = trabajo / "ediciones-fundae.zip"
                recuperar_ediciones.construir(generacion / "contenido", RAIZ, apoyo)
            resultado = ejecutar_trabajo(config, PermisoLocal(carpeta), almacen, apoyo_fundae=apoyo)
            if resultado["resultado"] == "validado":
                with diario.paso("verificar-artefacto-aislado"):
                    conservado = recuperar_trabajo(config.solicitud_id, 1, "1", almacen)
                    _exigir(conservado is not None)
                    artefacto = conservado[0]["artefacto"]
                    recuperado = recuperar_artefacto(
                        trabajo / "publicacion-aislada",
                        artefacto["revisionCodigo"],
                        artefacto["huellaPaquete"],
                        artefacto["sha256Artefacto"],
                        almacen,
                    )
                    diario.anotar("artefacto-aislado", "verificado", sha256=recuperado["sha256Artefacto"])
            return resultado


def _escribir_json(ruta: Path, valor: dict) -> None:
    with tempfile.NamedTemporaryFile(dir=ruta.parent) as temporal:
        temporal.write(json.dumps(valor, sort_keys=True, ensure_ascii=False).encode())
        temporal.flush()
        os.fsync(temporal.fileno())
        os.link(temporal.name, ruta)


def ensayar(args: argparse.Namespace) -> dict:
    """Resuelve el sello, inmoviliza los parámetros de la intención y ejecuta el flujo solicitado.

    Returns:
        Resumen de comprobaciones o recibo de la simulación. Un cierre repetido se consulta por su misma identidad.
    """
    revision = subprocess.check_output(["git", "-C", str(RAIZ), "rev-parse", "HEAD"], text=True).strip()
    _checkout_limpio(RAIZ, revision)
    sello = json.loads(args.sello.read_bytes())
    base, huella = sello["revisionCodigo"], sello["sha256Manifiesto"]
    _exigir(REVISION.fullmatch(base) is not None and SHA256.fullmatch(huella) is not None)
    generacion = (args.generacion or args.sello.parent / f"generacion-{base}").resolve(strict=True)
    area = args.area.resolve()
    _exigir(all(not area.is_relative_to(p) and not p.is_relative_to(area) for p in (RAIZ.resolve(), generacion)))
    intencion = args.intencion or str(uuid.uuid4())
    _exigir(UUID.fullmatch(intencion) is not None)
    carpeta = area / intencion
    carpeta.mkdir(parents=True, exist_ok=True, mode=0o700)
    identidad = {
        "intencion": intencion,
        "modo": args.modo,
        "accion": args.accion,
        "variante": args.variante,
        "revisionCodigo": revision,
        "revisionBase": base,
        "sha256Manifiesto": huella,
    }
    with (carpeta / "cerrojo").open("a+b") as cerrojo, diario.abrir(carpeta / "diario.jsonl", identidad):
        fcntl.flock(cerrojo, fcntl.LOCK_EX)
        ruta = carpeta / "intencion.json"
        if ruta.exists():
            _exigir(json.loads(ruta.read_bytes()) == identidad)
        else:
            _escribir_json(ruta, identidad)
        cierre = carpeta / "resultado.json"
        if cierre.exists():
            diario.anotar("intencion", "repetida")
            return json.loads(cierre.read_bytes())
        with diario.paso("ensayo"):
            resultado = _simular(args, identidad, generacion, carpeta)
            diario.anotar("operacion", "resultado", resultado=resultado.get("resultado", "preparado"))
            resumen = {"intencion": intencion, "modo": args.modo, "resultado": resultado}
            _escribir_json(cierre, resumen)
            return resumen


def main(argv: list[str] | None = None) -> int:
    """Ejecuta el ensayo desde la terminal o cron, con un resumen JSON y un diario por intención.

    Returns:
        Cero tras una preparación correcta o resultado admitido, uno ante rechazo o fallo.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("modo", choices=("preparar", "simular"))
    parser.add_argument("--sello", type=Path, required=True, help="Sello de confianza de la generación inicial.")
    parser.add_argument("--generacion", type=Path, help="Directorio de la generación si se archivó con otro nombre.")
    parser.add_argument("--area", type=Path, required=True, help="Directorio privado de ensayos fuera del checkout.")
    parser.add_argument("--apoyo-fundae", type=Path, help="Archivo de originales para una generación histórica.")
    parser.add_argument("--intencion", help="UUID v4 para consultar o reanudar el mismo ensayo.")
    parser.add_argument("--accion", choices=ACCIONES, default="comprobar-programada")
    parser.add_argument("--variante", choices=("oficial", "privado"), default="oficial")
    args = parser.parse_args(argv)
    try:
        resumen = ensayar(args)
    except (ErrorFuente, OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
        print("Ensayo sin confirmar. Consulta el diario de la intención y el sello de entrada.", file=sys.stderr)
        return 1
    print(json.dumps(resumen, ensure_ascii=False, sort_keys=True))
    return int(resumen["resultado"].get("resultado") == "rechazado")


if __name__ == "__main__":
    sys.exit(main())
