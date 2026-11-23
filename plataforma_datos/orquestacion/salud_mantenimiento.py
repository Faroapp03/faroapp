"""Interpreta hechos JSONL del supervisor para operadores y para la recuperación de un recibo."""

import argparse
import json
import sys
from collections.abc import Iterable
from pathlib import Path

from plataforma_datos.orquestacion.archivo_diario import MAX_DIARIO


def _eventos(lineas: Iterable[str]) -> Iterable[dict]:
    identidad = None
    total = 0
    for linea in lineas:
        total += len(linea.encode())
        evento = json.loads(linea)
        if (
            total > MAX_DIARIO
            or not isinstance(evento, dict)
            or type(evento.get("version")) is not int
            or evento["version"] != 1
        ):
            raise ValueError("Diario inválido")
        propia = tuple(evento.get(k) for k in ("intencion", "run", "intento", "operacion", "reserva", "revisionCodigo"))
        if identidad is not None and propia != identidad:
            raise ValueError("Diario de varias ejecuciones")
        identidad = propia
        yield evento
    if identidad is None:
        raise ValueError("Diario vacío")


def _accion_ante_error(fase: str, causa: str | None, respuesta: dict) -> str:
    if respuesta.get("http") in (401, 403):
        return "revisar-identidad-del-runner"
    if causa == "archivo-ediciones-ausente":
        return "recuperar-originales-del-archivo-sellado"
    if fase == "confirmar-resultado":
        return "reenviar-recibo-conservado"
    if causa == "almacen-no-disponible" and fase in ("referencia", "buscar-recibo", "descargar-base"):
        return "revisar-acceso-almacen"
    return "revisar"


def _observar(evento: dict, observaciones: dict, calendarios_soc: set) -> None:
    """Recoge los hechos que se informan sin cambiar el estado ni la acción del ciclo."""
    nombre, hecho = evento["fase"], evento["estado"]
    if nombre == "calendario-curso" and hecho == "por-confirmar" and evento.get("fuente") == "formacion":
        calendarios_soc.add(evento["curso"])
        observaciones["calendariosSocPorConfirmar"] = len(calendarios_soc)
    elif nombre == "archivo-resumen" and hecho == "pendiente":
        # No es un fallo del ciclo: el panel no tendrá el resumen de esta ejecución.
        observaciones["resumenNoArchivado"] = evento.get("causa")


def diagnostico(lineas: Iterable[str]) -> dict:
    """Obtiene la fase alcanzada y la acción permitida para un único ciclo.

    Returns:
        Estado, fase, decisión y último resultado confirmado de la invocación.

    Raises:
        ValueError: Si los datos no son eventos completos de la misma invocación.
    """
    estado, fase, accion, resultado = "incompleto", "inicio", "consultar-estado", None
    respuesta = {}
    calendarios_soc = set()
    observaciones = {}
    for evento in _eventos(lineas):
        nombre, hecho = evento["fase"], evento["estado"]
        _observar(evento, observaciones, calendarios_soc)
        if nombre == "respuesta-http" and hecho == "rechazada":
            respuesta = {k: evento[k] for k in ("servicio", "http")}
            continue
        if hecho == "error" and estado == "error" and nombre != "confirmar-resultado":
            continue
        if hecho == "error":
            estado, fase = "error", nombre
            accion = _accion_ante_error(fase, evento.get("causa"), respuesta)
        elif hecho == "inicio":
            estado, fase, accion = "en-curso", nombre, "consultar-estado"
            respuesta = {}
        elif nombre in ("candidato", "operacion") and hecho == "resultado":
            resultado = evento.get("resultado")
        elif nombre in ("supervisor", "ensayo") and hecho == "confirmado":
            estado, fase = "confirmado", nombre
            accion = "revisar-rechazo" if resultado == "rechazado" else "ninguna"
        elif nombre == "archivo-diario" and hecho == "pendiente":
            accion = "consultar-log-del-job"
    return {"estado": estado, "fase": fase, "accion": accion, "resultado": resultado, **respuesta, **observaciones}


def main(argv: list[str] | None = None) -> int:
    """Lee el archivo o la entrada estándar y devuelve un diagnóstico JSON.

    Returns:
        Cero para un cierre confirmado y aceptado, dos para una incidencia y uno para un registro ilegible.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archivo", type=Path, nargs="?", help="Diario JSONL. Por defecto lee la entrada estándar.")
    args = parser.parse_args(argv)
    try:
        if args.archivo is None:
            resumen = diagnostico(sys.stdin)
        else:
            with args.archivo.open(encoding="utf-8") as entrada:
                resumen = diagnostico(entrada)
    except (OSError, ValueError, KeyError, TypeError):
        print("Registro ilegible o incompleto.", file=sys.stderr)
        return 1
    print(json.dumps(resumen, ensure_ascii=False))
    return 0 if resumen["estado"] == "confirmado" and resumen["accion"] == "ninguna" else 2


if __name__ == "__main__":
    sys.exit(main())
