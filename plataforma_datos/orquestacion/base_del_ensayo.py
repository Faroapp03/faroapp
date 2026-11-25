"""La base y el candidato de un ensayo con datos grabados, y cómo se trata en él cada fuente.

La base se lee del almacén privado con un intermediario que solo deja leer (`AlmacenSoloLectura`), o de una carpeta ya
descargada. El candidato se compone con el commit actual, que tiene que ser exactamente el árbol de trabajo: así las
huellas del ensayo son las de ese commit, sin cambios sin confirmar mezclados.

Una fuente cuyo lote de originales con procedencia propia no viene en la base no se puede volver a preparar sin
descargar: reutiliza su validado vigente y solo lo valida. El recibo y las huellas lo dicen, fuente por fuente.
"""

import json
import subprocess
from pathlib import Path
from typing import Any

from plataforma_datos.comun.nucleo import DATOS_RELATIVOS, RAIZ
from plataforma_datos.cursos.fuentes.barcelonactiva import censo_ia
from plataforma_datos.cursos.fuentes.fundae import ediciones as ediciones_fundae
from plataforma_datos.orquestacion import recuperar_ediciones
from plataforma_datos.orquestacion.almacen_generaciones import recuperar_generacion
from plataforma_datos.orquestacion.almacen_s3 import AlmacenS3
from plataforma_datos.orquestacion.almacen_trabajos import leer_referencia
from plataforma_datos.orquestacion.aprovisionar_candidato import aprovisionar_candidato
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import FUENTES
from plataforma_datos.orquestacion.reconstruir import SOLO_VALIDAR

APOYO = "ediciones-fundae.zip"
DEPENDENCIAS = ("node_modules", ".venv")
# Lo que el recibo y las huellas dicen de cada fuente, para que el banco no aparente cubrir lo que no cubre.
PREPARADA = "preparada desde sus originales"
REUTILIZADA = "reutiliza su validado vigente: la base no trae sus originales"
SOLO_SE_VALIDA = "solo se valida, como en cada ciclo"


class AlmacenSoloLectura:
    """Deja pasar únicamente las dos lecturas del almacén; cualquier otra operación se rechaza antes de llegar a él."""

    def __init__(self, almacen: AlmacenS3) -> None:
        self._almacen = almacen

    def __enter__(self) -> "AlmacenSoloLectura":
        self._almacen.__enter__()
        return self

    def __exit__(self, *excepcion: object) -> None:
        self._almacen.__exit__(*excepcion)

    def leer_control(self, clave: str, bytes_maximos: int) -> tuple[bytes, str] | None:
        """Lee un control del almacén.

        Returns:
            Sus bytes y su versión, o None si no existe.
        """
        return self._almacen.leer_control(clave, bytes_maximos)

    def recuperar(self, clave: str, destino: Path, huella: str, bytes_maximos: int) -> None:
        """Copia un objeto del almacén a un destino nuevo, comprobado por su huella."""
        self._almacen.recuperar(clave, destino, huella, bytes_maximos)

    def guardar(self, *_argumentos: object, **_opciones: object) -> None:
        """Declarada para cumplir el protocolo del almacén; el ensayo nunca escribe.

        Raises:
            PermissionError: Siempre.
        """
        raise PermissionError("el ensayo con datos grabados no escribe en el almacén")

    def guardar_control(self, *_argumentos: object, **_opciones: object) -> bool:
        """Declarada para cumplir el protocolo del almacén; el ensayo nunca escribe.

        Raises:
            PermissionError: Siempre.
        """
        raise PermissionError("el ensayo con datos grabados no escribe en el almacén")

    def __getattr__(self, nombre: str) -> None:
        raise PermissionError(f"el ensayo con datos grabados solo lee del almacén, no {nombre}")


def descargar_base(almacen: AlmacenSoloLectura, base: Path) -> dict[str, Any]:
    """Recupera la base operativa vigente en una carpeta base nueva: sello, generación y, si faltan, sus originales.

    Returns:
        El resumen de la generación recuperada.
    """
    base.mkdir(mode=0o700)
    sello = leer_referencia(almacen)["baseOperativa"]
    revision, huella = sello["revisionCodigo"], sello["sha256Manifiesto"]
    resumen = recuperar_generacion(base / "generacion", revision, huella, almacen)
    indice = recuperar_ediciones.indice_del_sello(base / "generacion", revision, huella)
    if recuperar_ediciones.faltan(base / "generacion" / "contenido", indice):
        recuperar_ediciones.descargar(base / "generacion" / "contenido", base / APOYO, almacen)
    (base / "sello.json").write_text(json.dumps({"revisionCodigo": revision, "sha256Manifiesto": huella}) + "\n")
    return resumen


def revision_limpia(raiz: Path = RAIZ) -> str:
    """El commit actual, si el árbol de trabajo es exactamente ese commit.

    Returns:
        El SHA completo de HEAD.

    Raises:
        ValueError: Si hay cambios sin confirmar o archivos sin seguimiento: las huellas no serían las de HEAD.
    """
    if subprocess.check_output(["git", "-C", str(raiz), "status", "--porcelain"], text=True).strip():
        raise ValueError("el árbol de trabajo tiene cambios sin confirmar: el ensayo se ejecuta sobre un commit")
    return subprocess.check_output(["git", "-C", str(raiz), "rev-parse", "HEAD"], text=True).strip()


def preparar_candidato(base: Path, candidato: Path, revision: str) -> dict[str, Any]:
    """Compone el candidato del ciclo con el código de `revision` y la generación de la base, y enlaza sus dependencias.

    Returns:
        El resumen del aprovisionamiento.
    """
    sello = json.loads((base / "sello.json").read_bytes())
    resumen = aprovisionar_candidato(
        RAIZ,
        candidato,
        revision,
        base / "generacion",
        sello["revisionCodigo"],
        sello["sha256Manifiesto"],
        apoyo=base / APOYO if (base / APOYO).exists() else None,
    )
    for nombre in DEPENDENCIAS:
        (candidato / nombre).symlink_to((RAIZ / nombre).resolve(), target_is_directory=True)
    return resumen


def lotes_con_procedencia(candidato: Path) -> dict[str, str]:
    """Los lotes de originales con procedencia propia que la preparación de su fuente exige.

    Son los que declara cada lector: las ediciones de FUNDAE, el censo de IA del Cibernàrium y la edición vigente de
    la TIC-H (la de su validado). La generación no los traslada, así que sin descargar no hay de dónde prepararlos.

    Returns:
        La carpeta del lote de cada una de esas fuentes, dentro de sus originales.
    """
    edicion = candidato / DATOS_RELATIVOS / "validados" / "tich" / "edicion.json"
    lotes = {"fundae": ediciones_fundae.CARPETA, "barcelonactiva": censo_ia.CARPETA}
    return lotes | ({"tich": json.loads(edicion.read_bytes())["anio"]} if edicion.exists() else {})


def fuentes_sin_originales(candidato: Path) -> tuple[str, ...]:
    """Las fuentes cuyo lote de originales no está en la base: sin él no se pueden volver a preparar sin descargar.

    Returns:
        Esas fuentes, en el orden de FUENTES.
    """
    originales = candidato / DATOS_RELATIVOS / "originales"
    lotes = lotes_con_procedencia(candidato)
    return tuple(
        fuente
        for fuente in FUENTES
        if fuente in lotes and not (originales / fuente / lotes[fuente] / "procedencia.json").exists()
    )


def cobertura(reutilizadas: tuple[str, ...]) -> dict[str, str]:
    """Cómo trató el ensayo cada fuente.

    Returns:
        Por fuente: preparada desde sus originales, reutiliza su validado o solo se valida.
    """
    return {
        fuente: REUTILIZADA if fuente in reutilizadas else SOLO_SE_VALIDA if fuente in SOLO_VALIDAR else PREPARADA
        for fuente in FUENTES
    }
