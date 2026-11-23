"""Migración explícita del almacén del catálogo y de los originales de cursos a trozos.

Antes de tocar nada admite el almacén tal como está. Después sustituye, uno a uno,
los cuerpos grandes por su manifiesto, cada uno solo cuando su reconstrucción
coincide byte a byte con la huella del inventario y mediante reemplazo atómico.
Una interrupción deja cada cuerpo entero o ya verificado por trozos, y repetir la
orden termina el trabajo. El inventario y las referencias no cambian, y la
admisión final debe coincidir con la inicial.
"""

import argparse
import hashlib
import json
import os
import re
import time
from pathlib import Path

from plataforma_datos.cursos import admision_catalogo as admision
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import indices_evidencias, trozos_catalogo
from plataforma_datos.cursos import operacion_fuente as fuente_comun
from plataforma_datos.cursos.contrato_entrega_catalogo import exigir

FUENTES_CURSOS = ("hp_life", "cibervoluntarios", "claude_academy", "fundae", "barcelonactiva")


def bytes_almacenados(area: Path) -> int:
    """Suma los archivos regulares del almacén tal como ocupan el disco lógico.

    Returns:
        Total de bytes de archivos regulares, sin seguir enlaces.
    """
    total = 0
    for carpeta, _, archivos in os.walk(area):
        for nombre in archivos:
            dato = (Path(carpeta) / nombre).lstat()
            total += dato.st_size
    return total


def _inventario(area: Path) -> tuple[indices_evidencias.PruebaIndexada, ...]:
    with (area / almacen.CONTROL).open("rb") as archivo:
        return indices_evidencias.leer_indice(archivo.read(indices_evidencias.MAX_INDICE + 1))


def migrar(area: Path) -> dict:
    """Convierte el almacén indicado; repetirla sobre un almacén migrado no cambia nada.

    Returns:
        Resumen con bytes antes y después, cuerpos migrados y verificados y tiempos.
    """
    inicio = time.perf_counter()
    antes = bytes_almacenados(area)
    informe_previo = admision.admitir_snapshot(almacen.solicitud(area))
    migrados, verificados = 0, 0
    for prueba in _inventario(area):
        ruta = almacen.ruta_relativa(area, prueba.archivo)
        trozos_catalogo.retirar_temporales(ruta.parent)
        if ruta.stat().st_size >= trozos_catalogo.UMBRAL or trozos_catalogo.manifiesto_de(
            ruta, prueba.sha256, limite=admision.MAX_ENTRADA
        ):
            migrados += trozos_catalogo.migrar_archivo(ruta, prueba.sha256)
            verificados += 1
    lectura = time.perf_counter()
    for prueba in _inventario(area):
        almacen.leer_evidencia(
            almacen.ruta_relativa(area, prueba.archivo), prueba.sha256, "Evidencia no reconstruida tras migrar"
        )
    lectura = time.perf_counter() - lectura
    informe = admision.admitir_snapshot(almacen.solicitud(area))
    exigir(informe == informe_previo, "La admisión cambió con la migración")
    return {
        "bytes_antes": antes,
        "bytes_despues": bytes_almacenados(area),
        "cuerpos_migrados": migrados,
        "cuerpos_por_trozos": verificados,
        "evidencias_reconstruidas": len(_inventario(area)),
        "segundos_lectura_verificada": round(lectura, 2),
        "segundos": round(time.perf_counter() - inicio, 2),
    }


def _comprobaciones_fuente(fuente: str, raiz: Path) -> dict:
    """Huellas del conjunto admitido y del recalculado desde sus cuerpos y recibos.

    Returns:
        Huellas que deben coincidir antes y después de migrar.
    """
    resultado = {}
    validado = fuente_comun.leer_validado(fuente, raiz)
    if validado is not None:
        resultado["validado"] = hashlib.sha256(fuente_comun.json_bytes(validado)).hexdigest()
    original, _, _ = fuente_comun.rutas_de_la_fuente(fuente, raiz)
    if (original / "procedencia.json").is_file():
        calculado = fuente_comun.calcular_recepciones_de_fuente(fuente, raiz)
        resultado["calculado"] = hashlib.sha256(fuente_comun.json_bytes(calculado)).hexdigest()
    return resultado


def migrar_originales(raiz: Path) -> dict:
    """Convierte los cuerpos grandes de los originales de cada fuente de cursos.

    El nombre de cada cuerpo es su huella (conservar_bytes), que se verifica antes de
    reemplazarlo. La validación de la fuente y su recálculo deben coincidir antes y después.

    Returns:
        Resumen por fuente con bytes antes y después y cuerpos migrados.
    """
    resumen = {}
    for fuente in FUENTES_CURSOS:
        original, _, _ = fuente_comun.rutas_de_la_fuente(fuente, raiz)
        cuerpos = original / trozos_catalogo.CARPETA_CUERPOS
        if not cuerpos.is_dir():
            continue
        inicio = time.perf_counter()
        antes, previas = bytes_almacenados(original), _comprobaciones_fuente(fuente, raiz)
        trozos_catalogo.retirar_temporales(cuerpos)
        migrados = por_trozos = 0
        for ruta in sorted(cuerpos.glob("*.body")):
            exigir(re.fullmatch("[0-9a-f]{64}", ruta.stem) is not None, "Cuerpo original sin nombre por huella")
            if ruta.stat().st_size >= trozos_catalogo.UMBRAL or trozos_catalogo.manifiesto_de(
                ruta, ruta.stem, limite=admision.MAX_ENTRADA
            ):
                migrados += trozos_catalogo.migrar_archivo(ruta, ruta.stem)
                por_trozos += 1
        exigir(_comprobaciones_fuente(fuente, raiz) == previas, "La validación de la fuente cambió con la migración")
        resumen[fuente] = {
            "bytes_antes": antes,
            "bytes_despues": bytes_almacenados(original),
            "cuerpos_migrados": migrados,
            "cuerpos_por_trozos": por_trozos,
            "validacion_y_recalculo_iguales": sorted(previas),
            "segundos": round(time.perf_counter() - inicio, 2),
        }
    return resumen


def main() -> None:
    """Migra solo lo que el operador indica: un almacén, los originales de una raíz o ambos."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--almacen", type=Path)
    parser.add_argument("--originales-de", type=Path, help="Raíz de la instalación cuyos originales de cursos migrar")
    opciones = parser.parse_args()
    if opciones.almacen is None and opciones.originales_de is None:
        parser.error("Indica --almacen, --originales-de o ambos")
    resultado = {}
    # Primero el almacén: su admisión con el código vigente es la que consultan las fuentes al validar.
    # Rutas absolutas: las fuentes abren su SQLite por URI de archivo, que no admite rutas relativas.
    if opciones.almacen is not None:
        resultado["almacen"] = migrar(opciones.almacen.resolve())
    if opciones.originales_de is not None:
        resultado["originales"] = migrar_originales(opciones.originales_de.resolve())
    print(json.dumps(resultado, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
