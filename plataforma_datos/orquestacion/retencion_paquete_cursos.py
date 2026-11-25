"""Conserva la salida del motor que también publica una fuente de Cursos retenida."""

import re
from pathlib import Path

from plataforma_datos.comun.entrada_salida import guardar_json, leer_json, sha256
from plataforma_datos.comun.nucleo import DATOS_RELATIVOS
from plataforma_datos.cursos import admision_catalogo, retencion_composicion
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.orquestacion.cuarentena_del_paquete import CuarentenaImposible, conservar_en_cuarentena
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import Comparacion, EnCuarentena, fila_del_paquete

FUENTES_CON_SALIDA = frozenset({"barcelonactiva", "fundae"})
ARCHIVO_PRIVADO = almacen.RUTA / "retenciones-paquete"


def _exigir(condicion: object, motivo: str) -> None:
    if not condicion:
        raise CuarentenaImposible(motivo)


def _coincide(raiz: Path, relativa: str, huella: str) -> bool:
    ruta = almacen.ruta_relativa(raiz, relativa)
    return (
        ruta.is_file()
        and ruta.stat().st_nlink == 1
        and ruta.stat().st_size <= admision_catalogo.MAX_DOCUMENTO
        and sha256(ruta) == huella
    )


def _referencias_del_archivo(previa: dict, fuente: str) -> tuple[str, str, str, str]:
    nombre = fuente + ".json"
    _exigir(isinstance(previa, dict) and set(previa) == {"sha256", "origenes"}, f"{nombre} sin procedencia previa")
    huella = previa["sha256"]
    _exigir(isinstance(huella, str) and re.fullmatch(r"[0-9a-f]{64}", huella), f"{nombre} sin huella previa")
    directo = (DATOS_RELATIVOS / "validados" / fuente / nombre).as_posix()
    archivado = (ARCHIVO_PRIVADO / fuente / (huella + ".json")).as_posix()
    _exigir(previa["origenes"] in ({directo: huella}, {archivado: huella}), f"{nombre} sin copia exacta de origen")
    return nombre, huella, directo, archivado


def _exigir_independencia(manifiesto: dict, nombre: str, directo: str, archivado: str) -> None:
    # El archivo exportado es una copia íntegra de un único validado. No se combinan archivos que compartan entradas.
    otros = (m.get("origenes") or {} for n, m in manifiesto.items() if n != nombre)
    fuente = nombre.removesuffix(".json")
    prefijos = tuple(
        f"{DATOS_RELATIVOS.as_posix()}/{etapa}/{fuente}/" for etapa in ("originales", "preparados", "validados")
    )
    _exigir(
        not any(r in (directo, archivado) or r.startswith(prefijos) for origenes in otros for r in origenes),
        f"{nombre} comparte procedencia con otra salida del paquete",
    )


def _conservar_origen(
    vigente: Path, candidata: Path, fuente: str, manifiestos: tuple[dict, dict]
) -> tuple[str, dict] | None:
    publicado, exportado = manifiestos
    nombre = fuente + ".json"
    if nombre not in publicado and nombre not in exportado:
        return None
    anterior = publicado.get(nombre)
    nombre, huella, directo, archivado = _referencias_del_archivo(anterior, fuente)
    _exigir_independencia(publicado, nombre, directo, archivado)
    _exigir_independencia(exportado, nombre, directo, archivado)
    _exigir(_coincide(vigente, f"datos/{nombre}", huella), f"{nombre} vigente alterado")
    if archivado in anterior["origenes"]:
        _exigir(_coincide(vigente, archivado, huella), f"Origen retenido de {nombre} alterado")
    if _coincide(candidata, directo, huella):
        return nombre, {"sha256": huella, "origenes": {directo: huella}}
    # El exportador de esta fuente copiaba el validado sin transformación. El manifiesto anterior
    # acredita la igualdad byte a byte; se conserva esa versión cuando el productor ya tiene otra.
    destino = almacen.ruta_relativa(candidata, archivado)
    destino.parent.mkdir(parents=True, exist_ok=True)
    if not destino.exists():
        with destino.open("xb") as archivo:
            archivo.write((vigente / "datos" / nombre).read_bytes())
    _exigir(_coincide(candidata, archivado, huella), f"Origen previo de {nombre} no verificable")
    return nombre, {"sha256": huella, "origenes": {archivado: huella}}


def _comparar_lo_conservado(
    comparacion: Comparacion, carpetas: tuple[Path, Path], manifiestos: tuple[dict, dict], entradas: dict
) -> Comparacion:
    publicado, exportado = manifiestos
    final = {**exportado, **entradas}
    # Una aceptación que no llegó al paquete sigue registrada para el primer ciclo que pueda aplicarla.
    pendientes = tuple(
        EnCuarentena(archivo=nombre, grupo=[nombre], exportado_sha256=exportado[nombre]["sha256"])
        for nombre in comparacion.aceptados
        if nombre in entradas
    )
    filas = [
        fila_del_paquete(fila["archivo"], *carpetas, (publicado, final)) if fila["archivo"] in entradas else fila
        for fila in comparacion.paquete or []
    ]
    return comparacion._replace(
        paquete=filas,
        cuarentena=(*comparacion.cuarentena, *pendientes),
        aceptados=tuple(nombre for nombre in comparacion.aceptados if nombre not in entradas),
    )


def conservar(vigente: Path, candidata: Path, comparacion: Comparacion) -> Comparacion:
    """Conserva las salidas y orígenes de cada fuente retenida antes del ensamblado.

    Returns:
        Comparación del paquete con las versiones conservadas y las aceptaciones aún pendientes.
    """
    fuentes = retencion_composicion.leer(candidata / almacen.RUTA).keys() & FUENTES_CON_SALIDA
    if not fuentes:
        return comparacion
    carpetas = vigente / "datos", candidata / "datos"
    manifiestos = tuple(leer_json(p / "manifiesto.json") for p in carpetas)
    entradas = dict(
        entrada for fuente in sorted(fuentes) if (entrada := _conservar_origen(vigente, candidata, fuente, manifiestos))
    )
    if not entradas:
        return comparacion
    conservar_en_cuarentena(*carpetas, frozenset(entradas))
    guardar_json(carpetas[1] / "manifiesto.json", {**manifiestos[1], **entradas})
    return _comparar_lo_conservado(comparacion, carpetas, manifiestos, entradas)


def comprobar(raiz: Path, manifiesto: dict) -> None:
    """Verifica las referencias de toda salida retenida en el manifiesto de la generación."""
    prefijo = ARCHIVO_PRIVADO.as_posix() + "/"
    retenidas = retencion_composicion.leer(raiz / almacen.RUTA)
    for nombre, entrada in manifiesto.items():
        origenes = entrada.get("origenes") or {}
        fuente = nombre.removesuffix(".json")
        if fuente in retenidas and fuente in FUENTES_CON_SALIDA:
            _, huella, _, _ = _referencias_del_archivo(entrada, fuente)
            _exigir(_coincide(raiz, next(iter(origenes)), huella), "Origen de salida retenida alterado")
        else:
            _exigir(
                not any(ruta.startswith(prefijo) for ruta in origenes), "Origen archivado de una salida sin retención"
            )
