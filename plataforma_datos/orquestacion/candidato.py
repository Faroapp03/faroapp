"""Ejecuta operaciones cerradas de datos sobre una instalación candidata hidratada y sin tráfico.

La raíz es configuración privada del ejecutor, no una ruta recibida por HTTP. El recibo describe un candidato,
no una versión activa. La CLI deja el JSON fuera del candidato y solo imprime mensajes cerrados.

Un intento en ámbar sin ningún rojo y con el paquete en verde se valida: el paquete publica lo que sí se actualizó y
cada módulo que falló conserva su última versión publicada entera (actualizar.ejecutar_modulo la restaura y la comprueba
por huella). La composición de Cursos solo lee el conjunto admitido de cada fuente y los originales que cita por
huella, así que unos originales nuevos de una consulta fallida no entran en el paquete. «conservados» lista esos
módulos con la fecha de la versión que conservan.
"""

import argparse
import json
import os
import re
import sys
import tempfile
from contextlib import redirect_stderr, redirect_stdout
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from plataforma_datos.comun.nucleo import ErrorFuente
from plataforma_datos.orquestacion import actualizar
from plataforma_datos.orquestacion.almacen_trabajos import ACCIONES, VERSION_RECIBO_CONSERVADOS, conservados_del_estado
from plataforma_datos.orquestacion.estado_de_la_actualizacion import ROJO, VERDE
from plataforma_datos.orquestacion.estado_panel import EstadoPanelInvalido, estado_panel
from plataforma_datos.orquestacion.modulos import PAQUETE
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import CARPETA_DE_INFORMES
from plataforma_datos.orquestacion.seleccion_por_tema import MODULOS_DE_CURSOS_DIARIOS

MAX_INFORME_BYTES = 256 * 1024
# La identidad procede del mismo contrato que usan la publicación y el servidor; no se recalcula en Python.
CODIGO_IDENTIDAD = """import {paqueteParaPublicar} from './src/plataforma/node/paquete-publicado.ts';
console.log(JSON.stringify({version:paqueteParaPublicar('./datos').version}));"""
ORDEN_IDENTIDAD = ("node", "--input-type=module", "-e", CODIGO_IDENTIDAD)
VERSION_PUBLICA = re.compile(r"[0-9a-f]{16}")
type Accion = Literal[
    "actualizar-datos", "reintentar-pendientes", "comprobar-programada", "comprobar-vencidas", "actualizar-cursos"
]


def _exigir(condicion: bool) -> None:
    if not condicion:
        raise EstadoPanelInvalido("Candidato no verificable")


def _utc(momento: datetime) -> str:
    return momento.isoformat(timespec="seconds").replace("+00:00", "Z")


def _recibo(accion: str, resultado: str, estado: dict | None, veredicto: str | None = None) -> dict[str, Any]:
    return {
        "version": VERSION_RECIBO_CONSERVADOS,
        "catalogo": None,
        "accion": accion,
        "resultado": resultado,
        "veredicto": veredicto,
        "terminadoEn": _utc(datetime.now(UTC)),
        "estado": estado,
        "huellaPaquete": None,
        "error": None,
        "conservados": conservados_del_estado(estado),
    }


def _informe(raiz: Path, intento: actualizar.ResultadoActualizacion) -> None:
    _exigir(intento.comienzo is not None and intento.informe is not None)
    ruta = intento.informe.with_suffix(".json")
    _exigir(ruta.parent == raiz / CARPETA_DE_INFORMES and not ruta.is_symlink())
    with ruta.open("rb") as archivo:
        datos = archivo.read(MAX_INFORME_BYTES + 1)
    _exigir(len(datos) <= MAX_INFORME_BYTES)
    informe = json.loads(datos)
    _exigir(isinstance(informe, dict))
    momento = datetime.fromisoformat(informe["utc"])
    _exigir(momento.utcoffset() == UTC.utcoffset(momento))
    _exigir(intento.comienzo.replace(microsecond=0) <= momento <= datetime.now(UTC))
    veredicto = actualizar.decidir(intento.resultados, False)
    _exigir(informe["veredicto"] == veredicto.texto)
    _exigir(intento.codigo == actualizar.CODIGO_DE_SALIDA[veredicto.estado])


def _estado_del_intento(raiz: Path, intento: actualizar.ResultadoActualizacion) -> dict[str, Any]:
    _informe(raiz, intento)
    snapshot = estado_panel(raiz, datetime.now(UTC))
    modulos = {modulo["id"]: modulo for modulo in snapshot["modulos"]}
    _exigir(intento.comienzo is not None)
    for nombre, resultado in intento.resultados.items():
        modulo = modulos[nombre]
        _exigir(modulo["ultimoIntento"] == _utc(intento.comienzo) and modulo["veredicto"] == resultado.veredicto)
    return snapshot


def _identidad(raiz: Path, ejecutor: actualizar.Ejecutor) -> str:
    # La web local ya se construyó y comprobó en el área con estos mismos datos y fuentes, antes de publicarlos en la
    # raíz (`actualizar.ejecutar_paquete`): un paquete en verde lo acredita y la identidad solo lee el paquete.
    respuesta = ejecutor(ORDEN_IDENTIDAD, raiz)
    _exigir(respuesta.codigo == 0)
    documento = json.loads(respuesta.salida)
    _exigir(isinstance(documento, dict) and set(documento) == {"version"})
    version = documento["version"]
    _exigir(isinstance(version, str) and VERSION_PUBLICA.fullmatch(version) is not None)
    return version


def opciones_de_la_accion(accion: Accion, revisar_paquete_pendiente: bool = False) -> actualizar.Opciones:
    """Traduce una acción cerrada del trabajo a las opciones de la actualización.

    «comprobar-vencidas» selecciona lo mismo que la programada y solo cambia cómo se anota el ciclo.
    «actualizar-cursos» es la búsqueda forzada de «actualizar-datos» acotada a los cursos que se leen a diario.

    Returns:
        Las opciones con que el motor ejecuta la acción.
    """
    return actualizar.Opciones(
        reintentar_pendientes=accion == "reintentar-pendientes",
        programada=accion in ("comprobar-programada", "comprobar-vencidas"),
        a_demanda=accion == "comprobar-vencidas",
        solo=MODULOS_DE_CURSOS_DIARIOS if accion == "actualizar-cursos" else None,
        revisar_paquete_pendiente=revisar_paquete_pendiente,
        forzar_comprobaciones=accion in ("actualizar-datos", "actualizar-cursos"),
    )


def _ejecutar(
    raiz: Path, accion: Accion, ejecutor: actualizar.Ejecutor, revisar_paquete_pendiente: bool
) -> dict[str, Any]:
    opciones = opciones_de_la_accion(accion, revisar_paquete_pendiente)
    intento = actualizar.actualizar_con_resultado(raiz, opciones, ejecutor, comprobar_entrada=estado_panel)
    if (
        (opciones.programada or opciones.reintentar_pendientes)
        and type(intento.codigo) is int
        and intento.codigo == 0
        and intento.comienzo is None
        and intento.informe is None
        and type(intento.resultados) is dict
        and not intento.resultados
    ):
        return _recibo(accion, "sin-pendientes", estado_panel(raiz, datetime.now(UTC)))
    if intento.comienzo is None or intento.informe is None:
        return {**_recibo(accion, "rechazado", None), "error": "actualizacion_no_completada"}
    snapshot = _estado_del_intento(raiz, intento)
    veredicto = actualizar.decidir(intento.resultados, False).estado
    paquete = intento.resultados.get(PAQUETE)
    # En ámbar sin paquete nuevo no hay nada que publicar: se rechaza y «conservados» dice qué quedó atrás.
    sin_novedad = veredicto != VERDE and paquete is not None and paquete.publicado is None
    if veredicto == ROJO or paquete is None or paquete.veredicto != VERDE or sin_novedad:
        return {**_recibo(accion, "rechazado", snapshot, veredicto), "error": "actualizacion_no_admitida"}
    version = _identidad(raiz, ejecutor)
    return {**_recibo(accion, "validado", snapshot, veredicto), "huellaPaquete": version}


def ejecutar_candidato(
    raiz_candidata: Path,
    accion: Accion,
    ejecutor: actualizar.Ejecutor = actualizar.ejecutar_orden,
    *,
    revisar_paquete_pendiente: bool = False,
) -> dict[str, Any]:
    """Actualiza solo la raíz candidata explícita y entrega un recibo saneado.

    Args:
        raiz_candidata: Checkout privado, hidratado, exclusivo de este job y sin tráfico.
        accion: Una de las operaciones cerradas.
        ejecutor: Ejecutor de órdenes fijadas; permite dobles sin red en pruebas.
        revisar_paquete_pendiente: Recompone la generación privada si un trabajo anterior quedó sin activar.

    Returns:
        Recibo v4 con estado, módulos conservados y proyección privada admitida; no acredita una publicación
        efectiva.
    """
    _exigir(accion in ACCIONES)
    try:
        _exigir(raiz_candidata.is_dir() and not raiz_candidata.is_symlink())
        with (
            tempfile.TemporaryFile(mode="w+", encoding="utf-8") as diagnostico,
            redirect_stdout(diagnostico),
            redirect_stderr(diagnostico),
        ):
            recibo = _ejecutar(raiz_candidata.resolve(), accion, ejecutor, revisar_paquete_pendiente)
            if recibo["estado"] is not None:
                from plataforma_datos.cursos.panel_catalogo import crear

                recibo["catalogo"] = crear(raiz_candidata.resolve(), corte_utc=_utc(datetime.now(UTC)))
            recibo["terminadoEn"] = _utc(datetime.now(UTC))
            return recibo
    except (ErrorFuente, OSError, ValueError, TypeError, KeyError, OverflowError, RecursionError):
        return {**_recibo(accion, "rechazado", None), "error": "candidato_no_verificable"}


def _crear_recibo(ruta: Path, raiz: Path, accion: Accion, revisar_paquete_pendiente: bool = False) -> dict[str, Any]:
    """Reserva el temporal antes de ejecutar y publica bytes completos sin sobrescribir.

    El enlace atómico es no-clobber en macOS/Linux; el temporal pertenece al mismo sistema de archivos.
    Un corte puede dejar el temporal, pero nunca un recibo final parcialmente escrito.

    Returns:
        El mismo recibo del motor, una vez promovido a su destino exclusivo.
    """
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=ruta.parent, prefix=f".{ruta.name}.", suffix=".tmp", delete=False
    ) as archivo:
        temporal = Path(archivo.name)
        try:
            recibo = ejecutar_candidato(raiz, accion, revisar_paquete_pendiente=revisar_paquete_pendiente)
            json.dump(recibo, archivo, ensure_ascii=False, separators=(",", ":"))
            archivo.write("\n")
            archivo.flush()
            os.fsync(archivo.fileno())
            os.link(temporal, ruta, follow_symlinks=False)
        finally:
            temporal.unlink()
    return recibo


def main(argv: list[str] | None = None) -> int:
    """Guarda un recibo fuera del candidato; stdout no contiene informes o errores libres.

    Args:
        argv: Argumentos privados del ejecutor, nunca parámetros de una petición HTTP.

    Returns:
        Cero para validado/sin pendientes; uno para rechazo o error de salida.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("accion", choices=ACCIONES)
    parser.add_argument("raiz", type=Path)
    parser.add_argument("--recibo", type=Path, required=True)
    parser.add_argument("--revisar-paquete-pendiente", action="store_true")
    argumentos = parser.parse_args(argv)
    try:
        _exigir(not argumentos.recibo.resolve().is_relative_to(argumentos.raiz.resolve()))
        _exigir(not argumentos.recibo.exists() and not argumentos.recibo.is_symlink())
        recibo = _crear_recibo(
            argumentos.recibo, argumentos.raiz, argumentos.accion, argumentos.revisar_paquete_pendiente
        )
    except (OSError, ValueError):
        print("No se pudo preparar el recibo del candidato.", file=sys.stderr)
        return 1
    print(f"Candidato: {recibo['resultado']}.")
    return 1 if recibo["resultado"] == "rechazado" else 0


if __name__ == "__main__":
    sys.exit(main())
