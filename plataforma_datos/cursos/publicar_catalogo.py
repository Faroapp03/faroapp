"""Publica catálogo y aprendizaje con una referencia común desde una entrega admitida.

No descarga, evalúa o habilita secciones. Ejecutar fuera de una web que sirva
tráfico y regenerar después su integridad/SW con la construcción existente.
"""

import hashlib
import json
import re
import tempfile
from pathlib import Path

from plataforma_datos.comun.entrada_salida import temporal_hermano
from plataforma_datos.cursos import entrega_catalogo as entrega
from plataforma_datos.cursos.aprendizaje_entrega import generar_companero
from plataforma_datos.cursos.contenido_aprendizaje import contenidos_actuales
from plataforma_datos.cursos.contrato_entrega_catalogo import exigir

DEFINICION = Path(__file__).resolve().parents[2] / "config/formacion/aprendizaje-revisado.json"
RUTA_REFERENCIA = Path("scripts/catalogo-cursos/referencia.js")


def _propio(ruta: Path) -> None:
    exigir(all(not p.is_symlink() for p in (ruta.absolute(), *ruta.absolute().parents)), "Publicación enlazada")
    exigir(not ruta.exists() or (ruta.is_file() and ruta.stat().st_nlink == 1), "Publicación no es archivo propio")


def _guardar(ruta: Path, cuerpo: bytes) -> None:
    _propio(ruta)
    if ruta.exists() and ruta.read_bytes() == cuerpo:
        return
    ruta.parent.mkdir(parents=True, exist_ok=True)
    temporal = None
    try:
        with temporal_hermano(ruta.parent, prefijo=".catalogo-") as archivo:
            temporal = Path(archivo.name)
            archivo.write(cuerpo)
        _propio(ruta)
        temporal.replace(ruta)
    finally:
        if temporal is not None:
            temporal.unlink(missing_ok=True)


def _retirar_generaciones(destino: Path) -> None:
    """Retira solo DTO reproducibles de la misma casa tras confirmar el puntero.

    La candidata no sirve tráfico. Ante un fallo, su promoción común se detiene;
    repetir termina la limpieza. No se recorren otras carpetas ni evidencias.
    """
    for anterior in destino.parent.iterdir():
        if anterior != destino and re.fullmatch(r"[0-9a-f]{64}\.json", anterior.name):
            _propio(anterior)
            anterior.unlink()


def publicar(solicitud: entrega.SolicitudEntrega, *, web: Path) -> dict[str, str | int]:
    """Exporta con la guarda común; el puntero se cambia únicamente al final.

    Returns:
        Referencia pública sin rutas del almacén privado. Repetir conserva bytes/mtime.
    """
    referencia = web / RUTA_REFERENCIA
    # La misma frontera del exportador cubre también el nuevo puntero público.
    frontera = entrega.frontera_de_entrega(solicitud)
    exigir(
        all(not p.resolve().is_relative_to(web.resolve()) for p in frontera.entradas),
        "La raíz pública contiene una entrada privada",
    )
    frontera.comprobar(referencia, publica=True)
    _propio(referencia)
    web.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=web.parent, prefix=".publicacion-cursos-") as temporal:
        salida = entrega.exportar(solicitud, destino=Path(temporal) / entrega.PUBLICO)
        cuerpo = salida.read_bytes()
        informe = json.loads((solicitud.area / "validado/validacion.json").read_bytes())
        sha = hashlib.sha256(cuerpo).hexdigest()
        exigir(sha == informe["conjunto_sha256"], "Exportación distinta del informe admitido")
        entrada = entrega.comprobar_entradas_de_entrega(solicitud)
        definicion = entrega.leer_json_de_entrega(DEFINICION, entrega.MAX_FILA)
        contenidos = contenidos_actuales(solicitud.admision, (f["programa_id"] for f in definicion["fichas"]))
        aprendizaje = entrega.bytes_json(generar_companero(cuerpo, contenidos, definicion))
        exigir(
            entrada == entrega.comprobar_entradas_de_entrega(solicitud), "Entradas cambiaron al preparar aprendizaje"
        )
        sha_aprendizaje = hashlib.sha256(aprendizaje).hexdigest()
        ruta_aprendizaje = f"datos/catalogo-aprendizaje/{sha_aprendizaje}.json"
        destino_aprendizaje = web / ruta_aprendizaje
        entrega.frontera_de_entrega(solicitud).comprobar(destino_aprendizaje, publica=True)
        _guardar(destino_aprendizaje, aprendizaje)
        dato = json.loads(cuerpo)
        relativa = f"datos/catalogo-cursos/{sha}.json"
        destino = web / relativa
        entrega.frontera_de_entrega(solicitud).comprobar(destino, publica=True)
        _guardar(destino, cuerpo)
        resultado = {"ruta": relativa, "sha256": sha, "bytes": len(cuerpo), "revision": dato["revision"]}
        codigo = (
            "// Referencia generada desde una exportación admitida. No editar.\n"
            "export const REFERENCIA = Object.freeze({\n"
            f"  ruta: '{relativa}',\n  sha256: '{sha}',\n  bytes: {len(cuerpo)},\n"
            f"  revision: '{dato['revision']}',\n"
            "});\n"
            "export const APRENDIZAJE = Object.freeze({\n"
            f"  ruta: '{ruta_aprendizaje}',\n  sha256: '{sha_aprendizaje}',\n  bytes: {len(aprendizaje)},\n"
            "});\n"
        )
        entrega.exportar(solicitud, destino=salida)
        _guardar(referencia, codigo.encode())
        _retirar_generaciones(destino)
        _retirar_generaciones(destino_aprendizaje)
    return resultado
