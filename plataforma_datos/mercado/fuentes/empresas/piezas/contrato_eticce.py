"""Contrato revisado de la ETICCE con CNAE-2025: definición y notas del denominador.

Las cifras no forman parte de la firma. Un cambio de categoría, pregunta o nota exige revisar el contrato; ni un
nuevo año ni aceptar bytes distintos autorizan a cambiar el significado. El original se contrasta antes de usarlo.
"""

import hashlib
import json
import re
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

from plataforma_datos.comun.nucleo import RAIZ, ValidacionFallida, exigir
from plataforma_datos.orquestacion.cobertura_originales import leer_archivo

RUTA_CONTRATO = (
    RAIZ / "plataforma_datos" / "mercado" / "fuentes" / "empresas" / "contratos" / "empresas-eticce2026.json"
)
IDENTIFICADOR = "eticce-cnae2025-internet"
PRIMERA_EDICION_REVISADA = 2026
_RECURSOS: ContextVar[dict[Path, bytes] | None] = ContextVar("recursos_eticce", default=None)
_RUTA_RELATIVA_ETICCE = "plataforma_datos/mercado/fuentes/empresas/contratos/empresas-eticce2026.json"
_RUTA_RELATIVA_CNAE = "plataforma_datos/mercado/fuentes/empresas/contratos/empresas-cnae2025.json"
RUTA_RELATIVA_PLANTILLA = "plataforma_datos/mercado/fuentes/empresas/piezas/plantilla-tic2026.json"
RUTA_PLANTILLA = Path(__file__).with_name("plantilla-tic2026.json")


def _rutas(*, incluir_plantilla: bool = False) -> dict[str, Path]:
    from plataforma_datos.mercado.fuentes.empresas.piezas.correspondencia_cnae import _CONTRATO

    rutas = {_RUTA_RELATIVA_ETICCE: RUTA_CONTRATO, _RUTA_RELATIVA_CNAE: _CONTRATO}
    if incluir_plantilla:
        rutas[RUTA_RELATIVA_PLANTILLA] = RUTA_PLANTILLA
    return rutas


def _leer(ruta: Path) -> bytes:
    return leer_archivo(ruta.parent, ruta.name, 1 << 20)


def cargar_recurso(ruta: Path) -> dict[str, Any]:
    """Carga el recurso, usando los mismos bytes durante toda una validación.

    Returns:
        El objeto contractual, independiente de las demás lecturas del mismo recurso.
    """
    capturados = _RECURSOS.get()
    return json.loads(capturados[ruta] if capturados is not None else _leer(ruta))


@contextmanager
def recursos_en_uso(*, incluir_plantilla: bool = False) -> Iterator[dict[str, str]]:
    """Fija una sola lectura de ambos contratos para calcular y registrar la validación.

    Yields:
        Rutas relativas portables y SHA256 de los bytes efectivamente utilizados.
    """
    rutas = _rutas(incluir_plantilla=incluir_plantilla)
    cuerpos = {ruta: _leer(ruta) for ruta in rutas.values()}
    token = _RECURSOS.set(cuerpos)
    try:
        yield {nombre: hashlib.sha256(cuerpos[ruta]).hexdigest() for nombre, ruta in rutas.items()}
    finally:
        _RECURSOS.reset(token)


def vinculos_actuales(*, incluir_plantilla: bool = False) -> dict[str, str]:
    """Lee las huellas actuales del disco, incluso dentro de una validación con recursos fijados.

    Returns:
        Los dos vínculos ruta/huella que una admisión actual debe conservar.
    """
    return {
        nombre: hashlib.sha256(_leer(ruta)).hexdigest()
        for nombre, ruta in _rutas(incluir_plantilla=incluir_plantilla).items()
    }


def _edicion_revisada(nombre: object) -> bool:
    coincidencia = re.search(r"1T(\d{4})$", nombre) if isinstance(nombre, str) else None
    return coincidencia is not None and int(coincidencia[1]) >= PRIMERA_EDICION_REVISADA


def recursos_registrados(validacion: dict[str, Any], conjunto: dict[str, Any] | None = None) -> dict[str, str] | None:
    """Exige el inventario contractual de una admisión, también cuando se conserva como prueba histórica.

    Returns:
        Las rutas y huellas registradas, o None solo para el contrato histórico anterior a estos recursos.
    """
    encuesta = conjunto.get("encuesta", {}) if isinstance(conjunto, dict) else {}
    cobertura = validacion.get("cobertura", {})
    exigir(
        isinstance(encuesta, dict) and isinstance(cobertura, dict),
        "empresas: metadatos de admisión inválidos",
        ValidacionFallida,
    )
    revisada = (
        _edicion_revisada(cobertura.get("edicion"))
        or _edicion_revisada(encuesta.get("edicion"))
        or encuesta.get("clasificacion") == "CNAE-2025"
    )
    incluir_plantilla = "plantilla_tic" in cobertura or isinstance(conjunto, dict) and "plantilla_tic" in conjunto
    registrados = validacion.get("recursos_de_validacion")
    if not revisada and registrados is None:
        return None
    exigir(
        isinstance(registrados, dict)
        and set(registrados) == set(_rutas(incluir_plantilla=incluir_plantilla))
        and all(isinstance(h, str) and re.fullmatch(r"[0-9a-f]{64}", h) for h in registrados.values()),
        "empresas: falta el inventario de contratos utilizados; preparar y validar de nuevo",
        ValidacionFallida,
    )
    return registrados


def comprobar_admision(validacion: dict[str, Any], conjunto: dict[str, Any] | None = None) -> None:
    """Rechaza una admisión cuyo contrato falta o ya no coincide con el código activo.

    El contrato histórico de 2025 no utilizaba estos recursos. Una edición nueva o un conjunto CNAE-2025 no puede
    pasar como histórico por omitir el vínculo. Las rutas admitidas son las dos fijas, nunca rutas del documento.

    Raises:
        ValidacionFallida: Si falta el vínculo obligatorio, su inventario cambia o difiere algún recurso actual.
    """
    registrados = recursos_registrados(validacion, conjunto)
    if registrados is None:
        return
    try:
        actuales = vinculos_actuales(incluir_plantilla=RUTA_RELATIVA_PLANTILLA in registrados)
    except (OSError, ValueError) as error:
        raise ValidacionFallida("empresas: no se pueden comprobar los recursos de la validación") from error
    exigir(
        registrados == actuales,
        "empresas: faltan o han cambiado los contratos utilizados; preparar y validar de nuevo",
        ValidacionFallida,
    )


def contrato() -> dict[str, Any]:
    """El contrato de la publicación revisada, sin estado ni accesos externos.

    Returns:
        Definición y notas revisadas de las cuatro partes.
    """
    return cargar_recurso(RUTA_CONTRATO)


def definicion_conocida(parte: str, firma: list[tuple[tuple[str, str], ...]]) -> bool:
    """Compara variables y categorías con el contrato revisado.

    Returns:
        True solo para la firma semántica completa revisada.
    """
    serializada = json.dumps(firma, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(serializada).hexdigest() == contrato()["partes"][parte]["sha256_definicion"]


class _Notas(HTMLParser):
    """Lee exclusivamente el listado de notas de una tabla de INEbase."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.profundidad = 0
        self.listados = 0
        self.textos: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "ul":
            if dict(attrs).get("id") == "capaListadoNotas":
                self.listados += 1
                self.profundidad += 1
            elif self.profundidad:
                self.profundidad += 1
        if self.profundidad:
            self.textos.append(" ")

    def handle_endtag(self, tag: str) -> None:
        if tag == "ul" and self.profundidad:
            self.profundidad -= 1
        self.textos.append(" ")

    def handle_data(self, data: str) -> None:
        if self.profundidad:
            self.textos.append(data)


def notas_publicadas(pagina: str) -> str:
    """Lee un único listado de notas completo.

    Returns:
        Texto normalizado del listado, sin contenido ajeno a sus notas.
    """
    lector = _Notas()
    lector.feed(pagina)
    lector.close()
    texto = " ".join("".join(lector.textos).split())
    exigir(lector.listados == 1 and lector.profundidad == 0, "empresas: listado de notas del INE incompleto o ambiguo")
    return texto


def comprobar_notas(parte: str, pagina: str) -> None:
    """Exige el denominador y las demás notas revisadas, sin usar la nota de prensa como sustituto."""
    exigir(
        notas_publicadas(pagina) == contrato()["partes"][parte]["notas"],
        f"empresas: cambian las notas o el denominador en {parte}",
    )


def es_contrato_2026(edicion: dict[str, Any]) -> bool:
    """Comprueba el contrato declarado, sin inferirlo del año de la edición.

    Returns:
        True cuando la edición declara el identificador revisado.
    """
    identificador = edicion.get("contrato_ine")
    exigir(identificador in (None, IDENTIFICADOR), "empresas: contrato de edición desconocido")
    exigir(
        not _edicion_revisada(edicion.get("nombre")) or identificador == IDENTIFICADOR,
        "empresas: una edición nueva debe declarar el contrato revisado",
    )
    return identificador == IDENTIFICADOR
