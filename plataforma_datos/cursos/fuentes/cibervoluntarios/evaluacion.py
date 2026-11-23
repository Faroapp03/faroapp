"""Pruebas conservadas y evaluación de vigencia de una unidad Cibervoluntarios en una candidata de catálogo."""

import sqlite3
from contextlib import closing
from pathlib import Path

from plataforma_datos.cursos import admision_catalogo as admision
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import operacion_fuente as fuente
from plataforma_datos.cursos import politicas_vigencia
from plataforma_datos.cursos import registro_vigencia as registro
from plataforma_datos.cursos.contrato_entrega_catalogo import exigir
from plataforma_datos.cursos.fuentes.cibervoluntarios import adquisicion

VERSION_POLITICA = "3"


def conservar(original: Path, fila: dict, destino: Path, inventario: dict) -> list[dict]:
    """Copia a la candidata el cuerpo, el recibo y los metadatos de una recepción y los describe como pruebas.

    Returns:
        Una prueba por archivo conservado, con la dirección consultada y la hora de su recepción.
    """
    # El intento de una página caída y la lectura de un destino se conservan con su recibo; no se leen como censo.
    lectura = fila.get("lectura", {})
    generica = "fallo" in lectura or lectura.get("tipo") == "destino"
    meta = fuente.leer_recibo(original, fila) if generica else adquisicion.pagina(original, fila)[1]
    salida = []
    for campo, sufijo in (("cuerpo", ".body"), ("recibo", ".recibo.json"), ("metadatos", ".metadatos.json")):
        ref = fila[campo]
        if ref is None:
            continue
        archivo = next(
            (n for n, h in sorted(inventario.items()) if h == ref["sha256"] and n.startswith("evidencias/")),
            "evidencias/cibervoluntarios/" + ref["sha256"] + sufijo,
        )
        prueba = admision.ReferenciaArchivo(ruta=almacen.ruta_relativa(original, ref["archivo"]), sha256=ref["sha256"])
        almacen.copiar_evidencia(prueba, almacen.ruta_relativa(destino, archivo))
        inventario[archivo] = ref["sha256"]
        salida.append(
            {
                "url": meta["url"],
                "capturado_utc": meta["fin_utc"],
                "sha256": ref["sha256"],
                "archivo": archivo.removeprefix("evidencias/"),
            }
        )
    return salida


def evaluar(base: Path, programa: dict, nuevas: list[dict], corte: str) -> dict:
    """Registra las observaciones nuevas de la unidad junto a su historial y la evalúa con la política vigente.

    Returns:
        La evaluación registrada de la unidad.
    """
    id = programa["id"]
    historial = registro.observaciones_hasta(base, tipo="recurso", id=id, corte=corte)
    registradas = {o["id"]: o for o in historial}
    for observacion in nuevas:
        exigir(
            registradas.get(observacion["id"], observacion) == observacion,
            "Observación Ciber de la misma recepción en conflicto",
        )
    pendientes = [o for o in nuevas if o["id"] not in registradas]
    with closing(sqlite3.connect(base)) as conexion:
        huella = conexion.execute("SELECT huella FROM programas WHERE id=?", (id,)).fetchone()[0]
    return registro.registrar_unidad(
        base,
        registro.SolicitudEvaluacionUnidad(
            unidad=registro.UnidadEvaluable(tipo="recurso", id=id, huella=huella),
            oferta={"id": id, "fuente_id": "cibervoluntarios", "url": programa["url"]},
            observaciones=[*historial, *pendientes],
            politica=politicas_vigencia.leer_politica("cibervoluntarios", VERSION_POLITICA),
            ahora=corte,
        ),
    )
