"""Contrato de la clasificación que viaja en cada oferta: idioma, nivel y materia, con su estado y su apoyo.

Cada dato dice qué valor tiene, quién lo afirma (la fuente oficial, una regla de Faro o nadie todavía), con qué
alcance y certeza, y en qué evidencias o regla se apoya. Solo lleva códigos de vocabularios cerrados: los textos que
lee la persona los pone la web a partir de esos códigos, en castellano y en catalán.
"""

import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol
from urllib.parse import urlsplit

from plataforma_datos.cursos import catalogo, vigencia
from plataforma_datos.cursos.exigencias_entrega_catalogo import exigir, exigir_campos, exigir_texto, exigir_url
from plataforma_datos.cursos.materia_sugerencias_cibernarium import TEMAS_VALIDOS
from plataforma_datos.cursos.tipos_json import ObjetoJson, ValorJson

# Los códigos de idioma que la web reconoce y muestra en Cursos (castellano, catalán e inglés).
IDIOMAS = ("ca", "en", "es")
NIVELES = ("inicial", "intermedio", "avanzado")
MATERIAS = tuple(sorted(TEMAS_VALIDOS))
VOCABULARIOS = {"idioma": IDIOMAS, "nivel": NIVELES, "materia": MATERIAS}
# El nivel es único; un curso puede tener varios idiomas o materias.
DATOS_CON_VARIOS_VALORES = ("idioma", "materia")
ESTADOS = ("fuente", "orientacion-faro", "por-confirmar")
ALCANCES = ("edicion", "programa", "norma-general", "actividad")
CERTEZAS = ("alta", "media", "baja")
MOTIVOS_POR_CONFIRMAR = ("fuente_no_publica", "conflicto_evidencias", "sin_captura")
CAMPOS_EVIDENCIA = ("url", "sha256", "capturado_utc", "localizador")
CAMPOS_REGLA = ("id", "version", "sha256")
CAMPOS_DATO = ("estado", "alcance", "certeza", "regla", "evidencias", "motivo_por_confirmar")
IDENTIFICADOR_REGLA = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
MAX_IDENTIFICADOR_REGLA = 80
MAX_EVIDENCIAS = 50
# Cuántas evidencias acreditan cada motivo: ninguna si no hay captura, la captura que no publica el dato o al menos
# dos capturas que chocan.
EVIDENCIAS_DEL_MOTIVO = {
    "sin_captura": (0, 0),
    "fuente_no_publica": (1, MAX_EVIDENCIAS),
    "conflicto_evidencias": (2, MAX_EVIDENCIAS),
}


def campo_de_valor(nombre: str) -> str:
    """Devuelve el campo que lleva el valor de un dato: `valores` (lista) o `valor` (uno solo).

    Returns:
        «valores» para el idioma y la materia; «valor» para el nivel.
    """
    return "valores" if nombre in DATOS_CON_VARIOS_VALORES else "valor"


def _evidencia(pieza: ValorJson, corte: str | None) -> None:
    exigir_campos(pieza, CAMPOS_EVIDENCIA, "evidencia de clasificación")
    exigir_url(pieza["url"], "evidencia de clasificación")
    # Como las evidencias de materia, se identifican por dominio público, nunca por una IP literal.
    host = urlsplit(pieza["url"]).hostname
    exigir(
        host is not None and re.fullmatch(r"[A-Za-z][A-Za-z0-9-]*", host.rsplit(".", 1)[-1]) is not None,
        "Evidencia de clasificación sin dominio público",
    )
    catalogo.exigir_sha256(pieza["sha256"], "evidencia de clasificación")
    exigir_texto(pieza["localizador"])
    capturado = vigencia.instante_utc(pieza["capturado_utc"], "captura de la evidencia")
    if corte is not None:
        exigir(capturado <= vigencia.instante_utc(corte, "corte"), "Evidencia de clasificación posterior al corte")


def _evidencias(lista: ValorJson, corte: str | None) -> None:
    exigir(isinstance(lista, list) and len(lista) <= MAX_EVIDENCIAS, "Evidencias de clasificación inválidas")
    for pieza in lista:
        _evidencia(pieza, corte)
    claves = [tuple(pieza[c] for c in CAMPOS_EVIDENCIA) for pieza in lista]
    exigir(claves == sorted(set(claves)), "Evidencias de clasificación repetidas o sin orden canónico")


def _regla(regla: ValorJson) -> None:
    exigir_campos(regla, CAMPOS_REGLA, "regla de clasificación")
    identificador = regla["id"]
    exigir(
        isinstance(identificador, str)
        and len(identificador) <= MAX_IDENTIFICADOR_REGLA
        and IDENTIFICADOR_REGLA.fullmatch(identificador) is not None,
        "Identificador de regla no admitido",
    )
    exigir(type(regla["version"]) is int and regla["version"] >= 1, "Versión de regla no admitida")
    catalogo.exigir_sha256(regla["sha256"], "regla de clasificación")


def _valor(nombre: str, valor: ValorJson) -> None:
    vocabulario = VOCABULARIOS[nombre]
    if nombre in DATOS_CON_VARIOS_VALORES:
        exigir(
            isinstance(valor, list) and valor and all(isinstance(v, str) and v in vocabulario for v in valor),
            "Valor de clasificación fuera de vocabulario",
        )
        exigir(valor == sorted(set(valor)), "Valores de clasificación repetidos o sin orden canónico")
    else:
        exigir(isinstance(valor, str) and valor in vocabulario, "Valor de clasificación fuera de vocabulario")


def _estado(dato: dict, valor: ValorJson) -> None:
    """Las reglas que atan el estado al valor, a su apoyo y al motivo de lo que queda por confirmar."""
    estado, motivo, evidencias = dato["estado"], dato["motivo_por_confirmar"], dato["evidencias"]
    exigir(estado in ESTADOS, "Estado de clasificación desconocido")
    if estado == "por-confirmar":
        exigir(valor is None, "Un dato por confirmar no lleva valor")
        exigir(dato["alcance"] is None and dato["certeza"] is None, "Un dato por confirmar no lleva alcance ni certeza")
        exigir(dato["regla"] is None, "Un dato por confirmar no lleva regla")
        exigir(motivo in MOTIVOS_POR_CONFIRMAR, "Dato por confirmar sin motivo admitido")
        minimo, maximo = EVIDENCIAS_DEL_MOTIVO[motivo]
        exigir(minimo <= len(evidencias) <= maximo, "Motivo por confirmar sin las evidencias que lo acreditan")
        return
    exigir(motivo is None, "Motivo por confirmar en un dato con valor")
    exigir(valor is not None, "Dato clasificado sin valor")
    exigir(dato["alcance"] in ALCANCES, "Alcance de clasificación desconocido")
    exigir(dato["certeza"] in CERTEZAS, "Certeza de clasificación desconocida")
    if estado == "fuente":
        exigir(evidencias, "Dato de la fuente sin evidencia")
        exigir(dato["regla"] is None, "Un dato de la fuente no lleva regla de Faro")
    else:
        exigir(dato["regla"] is not None, "Orientación de Faro sin regla")
        _regla(dato["regla"])


def validar_dato(nombre: str, dato: ValorJson, corte: str | None) -> None:
    """Valida un dato de la clasificación tal como viaja en el paquete.

    Args:
        nombre: `idioma`, `nivel` o `materia`.
        dato: El objeto del dato.
        corte: El corte de la proyección; con él, ninguna evidencia puede ser posterior.
    """
    campo = campo_de_valor(nombre)
    exigir_campos(dato, (campo, *CAMPOS_DATO), "dato de clasificación")
    _evidencias(dato["evidencias"], corte)
    valor = dato[campo]
    if valor is not None:
        _valor(nombre, valor)
    _estado(dato, valor)


def validar_bloque(bloque: ValorJson, corte: str | None) -> None:
    """Valida el bloque `clasificacion` de una oferta: al menos uno de sus tres datos y cada uno válido.

    Raises:
        ErrorEntregaCatalogo: Si el bloque o alguno de sus datos incumple el contrato.
    """
    exigir(isinstance(bloque, dict) and bloque, "Clasificación vacía")
    exigir(set(bloque) <= set(VOCABULARIOS), "clasificación: campos no admitidos")
    for nombre, dato in bloque.items():
        validar_dato(nombre, dato, corte)


@dataclass(frozen=True, kw_only=True)
class Evidencia:
    """Documento capturado en que se apoya un dato: dónde está, su huella, cuándo se capturó y dónde mirar."""

    url: str
    sha256: str
    capturado_utc: str
    localizador: str

    def a_json(self) -> ObjetoJson:
        """Devuelve la evidencia tal como viaja en el paquete.

        Returns:
            El objeto de la evidencia.
        """
        return {c: getattr(self, c) for c in CAMPOS_EVIDENCIA}


@dataclass(frozen=True, kw_only=True)
class Regla:
    """Regla de Faro que decide una orientación, identificada por su nombre, su versión y la huella de su código."""

    id: str
    version: int
    sha256: str

    def a_json(self) -> ObjetoJson:
        """Devuelve la regla tal como viaja en el paquete.

        Returns:
            El objeto de la regla.
        """
        return {c: getattr(self, c) for c in CAMPOS_REGLA}


@dataclass(frozen=True, kw_only=True)
class DatoClasificado:
    """Un dato (idioma, nivel o materia) con sus valores, su estado y su apoyo; el nivel lleva un solo valor."""

    valores: tuple[str, ...] = ()
    estado: str
    alcance: str | None = None
    certeza: str | None = None
    regla: Regla | None = None
    evidencias: tuple[Evidencia, ...] = ()
    motivo_por_confirmar: str | None = None

    def a_json(self, nombre: str) -> ObjetoJson:
        """Devuelve el dato tal como viaja en el paquete, con su valor en el campo que le corresponde.

        Returns:
            El objeto del dato.
        """
        if nombre in DATOS_CON_VARIOS_VALORES:
            valor = sorted(self.valores) or None
        else:
            exigir(len(self.valores) <= 1, "El nivel lleva un solo valor")
            valor = self.valores[0] if self.valores else None
        evidencias = sorted(self.evidencias, key=lambda e: tuple(getattr(e, c) for c in CAMPOS_EVIDENCIA))
        return {
            campo_de_valor(nombre): valor,
            "estado": self.estado,
            "alcance": self.alcance,
            "certeza": self.certeza,
            "regla": None if self.regla is None else self.regla.a_json(),
            "evidencias": [e.a_json() for e in evidencias],
            "motivo_por_confirmar": self.motivo_por_confirmar,
        }


@dataclass(frozen=True, kw_only=True)
class Clasificacion:
    """La clasificación de una oferta; un dato ausente es uno que su fuente todavía no clasifica en el productor."""

    idioma: DatoClasificado | None = None
    nivel: DatoClasificado | None = None
    materia: DatoClasificado | None = None

    def __post_init__(self) -> None:
        """Rechaza al construirla una clasificación que no cumple el contrato, salvo el corte, que fija la entrega."""
        validar_bloque(self.a_json(), corte=None)

    def a_json(self) -> ObjetoJson:
        """Devuelve el bloque `clasificacion` con los datos presentes.

        Returns:
            El objeto del bloque.
        """
        datos = {"idioma": self.idioma, "nivel": self.nivel, "materia": self.materia}
        return {nombre: dato.a_json(nombre) for nombre, dato in datos.items() if dato is not None}


class Clasificador(Protocol):
    """La interfaz que implementa cada fuente en `fuentes/<fuente>/clasificacion.py`."""

    def __call__(self, oferta: ObjetoJson, evidencias: Sequence[Evidencia]) -> Clasificacion | None:
        """Clasifica una oferta con las evidencias capturadas para ella.

        Args:
            oferta: La oferta tal como viaja en la entrega, sin el bloque `clasificacion`.
            evidencias: Las capturas de la fuente vinculadas a esa oferta.

        Returns:
            La clasificación de la oferta, donde un dato que la fuente no clasifica queda ausente; `None` si la fuente
            no clasifica ninguno, porque un bloque no puede ir vacío.
        """
        ...
