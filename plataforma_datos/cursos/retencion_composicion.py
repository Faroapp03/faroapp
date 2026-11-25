"""Aviso duradero del catálogo cuando un productor conserva su última entrada aplicada."""

import json
import stat
from datetime import datetime
from pathlib import Path

from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import contenido_aprendizaje, materia_cibernarium, recibos_compartidos
from plataforma_datos.cursos.contrato_entrega_catalogo import exigir
from plataforma_datos.orquestacion.contrato_comprobaciones_panel import instante_panel, validar_retencion_composicion
from plataforma_datos.orquestacion.sustitucion import escribir_atomico

ARCHIVO = "retenciones-composicion.json"
DOCUMENTO_EXCESIVO = "documento-excesivo"
# La fecha viene del recibo admitido al aplicar, nunca del último intento o de una reevaluación.
RECIBOS = {
    "hp_life": (("recibo-admision", "corte_utc"),),
    "cibervoluntarios": (("recibo-ciber", "corte_evaluacion_utc"),),
    "claude_academy": (("recibo-academy", "corte_evaluacion_utc"),),
    "fundae": (("recibo-fundae", "corte_evaluacion_utc"), ("recibo-preinscripcion-fundae", "corte")),
    "barcelonactiva": (("recibo-cibernarium", "corte_evaluacion_utc"),),
}
MAX_AVISOS = 2048


def fecha_admitida(base: Path, fuente: str, corte: str) -> str | None:
    """Lee la fecha de la aplicación del productor que ya consta en el almacén.

    Returns:
        Fecha UTC original, o None si falta una versión admisible de esa fuente.
    """
    entrada = almacen.solicitud(base)
    por_sha = contenido_aprendizaje.referencias_de_evidencia_indexadas(entrada)
    fechas = [
        instante_panel(almacen.leer_documento_indexado(ref, por_sha)[campo])
        for nombre, campo in RECIBOS[fuente]
        if (ref := entrada.procedencia.get(nombre)) is not None
    ]
    if not fechas:
        return None
    fecha = iso_utc(max(fechas))
    return materia_cibernarium.corte_proyeccion(entrada, fecha, corte) if fuente == "barcelonactiva" else fecha


def iso_utc(fecha: datetime) -> str:
    """Conserva segundos y, cuando los hay, microsegundos.

    Returns:
        La fecha UTC con sufijo Z.
    """
    return fecha.isoformat().replace("+00:00", "Z")


def leer(area: Path) -> dict[str, dict]:
    """Lee los avisos propios de los productores con un motivo cerrado.

    Returns:
        Avisos por fuente retenida.
    """
    ruta = almacen.ruta_relativa(area, ARCHIVO)
    if not ruta.exists():
        return {}
    datos = ruta.lstat()
    exigir(stat.S_ISREG(datos.st_mode) and datos.st_nlink == 1 and datos.st_size <= MAX_AVISOS, "Avisos inválidos")
    with ruta.open("rb") as archivo:
        contenido = archivo.read(MAX_AVISOS + 1)
    exigir(len(contenido) <= MAX_AVISOS, "Avisos excesivos")
    avisos = recibos_compartidos.leer_json(contenido)
    exigir(isinstance(avisos, dict) and avisos.keys() <= RECIBOS.keys(), "Fuentes de retención incompatibles")
    for aviso in avisos.values():
        validar_retencion_composicion(aviso)
    return avisos


def guardar(area: Path, avisos: dict[str, dict]) -> None:
    """Cambia el aviso únicamente cuando cambia la retención de la candidata."""
    if avisos == leer(area):
        return
    ruta = almacen.ruta_relativa(area, ARCHIVO)
    if not avisos:
        ruta.unlink()
    else:
        escribir_atomico(ruta, json.dumps(avisos, sort_keys=True) + "\n")
