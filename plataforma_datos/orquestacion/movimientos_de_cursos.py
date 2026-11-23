"""Compara las fichas que proyecta el lector web de la propia candidata al principio y al cierre del motor."""

import hashlib
import json
import re
import subprocess
import tempfile
from pathlib import Path

from plataforma_datos.orquestacion import archivo_diario
from plataforma_datos.orquestacion import diario_mantenimiento as diario
from plataforma_datos.orquestacion.almacen_trabajos import AlmacenTrabajos
from plataforma_datos.orquestacion.formas_del_diario import ID_CURSO

CAMPOS = ("tema", "nivel", "idioma", "modalidad", "ficha")
COTA = 32 * 1024 * 1024
HUELLA = re.compile(r"[0-9a-f]{64}")
FILTRO = re.compile(r"[a-z0-9-]{1,48}(?:,[a-z0-9-]{1,48}){0,30}")


def _campos(valores: list[str]) -> bool:
    return (
        len(valores) == len(CAMPOS)
        and all(isinstance(v, str) and FILTRO.fullmatch(v) for v in valores[:-1])
        and isinstance(valores[-1], str)
        and bool(HUELLA.fullmatch(valores[-1]))
    )


def _exigir(condicion: bool) -> None:
    if not condicion:
        raise ValueError("Inventario no verificable")


def inventario(raiz: Path, entorno: dict[str, str]) -> dict[str, list[str]] | None:
    """Lee el inventario con el entorno del candidato. Cualquier fallo de observación queda en el diario.

    Returns:
        Huellas por identidad de oferta y campo, o ausencia de una proyección legible.
    """
    if not diario.activo():
        return None
    try:
        salida = subprocess.run(
            ["node", "herramientas/mantenimiento/inventario-cursos.ts"],
            cwd=raiz,
            env=entorno,
            check=True,
            capture_output=True,
            timeout=90,
        ).stdout
        _exigir(len(salida) <= COTA)
        datos = json.loads(salida)
        if datos is None:
            diario.anotar("inventario-cursos", "sin-proyeccion")
            return None
        filas = {}
        for identidad, *huellas in datos:
            tipo, identificador = json.loads(identidad)
            _exigir(tipo in ("edicion", "recurso") and _campos(huellas))
            referencia = (
                identificador if ID_CURSO.fullmatch(identificador) else hashlib.sha256(identidad.encode()).hexdigest()
            )
            clave = tipo + "/" + referencia
            _exigir(clave not in filas)
            filas[clave] = huellas
        return filas
    except (ValueError, OSError, TypeError, subprocess.SubprocessError):
        diario.anotar("inventario-cursos", "error", causa="proyeccion-no-verificable")
        return None


def anterior(almacen: AlmacenTrabajos, referencia: dict, checkout: Path, entorno: dict[str, str]) -> dict | None:
    """Lee la proyección del último candidato validado, aunque haya habido ciclos sin cambios entre medias.

    Returns:
        Inventario verificado o la proyección del código de entrega para la semilla inicial.
    """
    if not diario.activo():
        return None
    base = referencia["ultimaValidada"] or referencia["baseOperativa"]
    clave = f"inventarios/cursos/v1/{base['sha256Manifiesto']}.json"
    try:
        datos = json.loads(archivo_diario.leer_contenido(clave, almacen))
        _exigir(isinstance(datos, dict) and all(_campos(v) for v in datos.values()))
        diario.anotar("inventario-base", "recuperado", sha256Manifiesto=base["sha256Manifiesto"])
        return datos
    except FileNotFoundError:
        if referencia["revisionReserva"] == 0:
            diario.anotar("inventario-base", "semilla", origen="proyeccion-del-codigo")
            filas = inventario(checkout, entorno)
            guardar(almacen, base, filas)
            return filas
    except (TypeError, ValueError, OSError):
        diario.anotar("inventario-base", "error", causa="inventario-no-verificable")
    return None


def guardar(almacen: AlmacenTrabajos, generacion: dict, filas: dict | None) -> None:
    """Vincula la proyección verificada a la generación que se podrá recuperar en el próximo ciclo."""
    if filas is None:
        return
    clave = f"inventarios/cursos/v1/{generacion['sha256Manifiesto']}.json"
    with tempfile.TemporaryDirectory() as area:
        ruta = Path(area) / "inventario.json"
        ruta.write_text(json.dumps(filas, sort_keys=True, separators=(",", ":")))
        archivo_diario.guardar_contenido(clave, ruta, almacen)


def comparar(antes: dict[str, list[str]] | None, despues: dict[str, list[str]] | None) -> None:
    """Anota cambios de la proyección candidata por identidad estable y separa una ausencia de un catálogo vacío."""
    if antes is None or despues is None:
        diario.anotar("cambios-cursos", "sin-comparacion")
        return
    contador = {"alta": 0, "retirada": 0, "modificacion": 0}
    for curso in sorted(antes.keys() | despues.keys()):
        campos = []
        if curso not in antes:
            cambio = "alta"
        elif curso not in despues:
            cambio = "retirada"
        else:
            campos = [nombre for nombre, a, b in zip(CAMPOS, antes[curso], despues[curso], strict=True) if a != b]
            if not campos:
                continue
            cambio = "modificacion"
        contador[cambio] += 1
        valores = {}
        for nombre, proyeccion in (("anterior", antes), ("nueva", despues)):
            if curso in proyeccion:
                valores[nombre] = dict(zip(CAMPOS[:-1], proyeccion[curso][:-1], strict=True))
        diario.anotar("curso-candidato", cambio, curso=curso, campos=campos, **valores)
    diario.anotar("cambios-cursos", "comparado", antes=len(antes), despues=len(despues), **contador)
