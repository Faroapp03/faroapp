"""Proyecciones de fuente versionadas para el cargador temporal existente.

La clave del canal liga el contrato canónico; la procedencia de la preparación
conserva también su artefacto. No interpreta páginas ni atribuye retrospectivamente
campos a canales históricos. Sin contrato se mantiene el freno conservador.
"""

import re
from copy import deepcopy
from dataclasses import dataclass

from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.cursos.tipos_json import ObjetoJson, ValorJson

PREFIJO = "atribucion-campos:"
IDENTIFICADOR = re.compile(r"[a-z][a-z0-9_-]*")
MIN_PARTES_DATO = 2
ENTIDADES = frozenset({"programa", "edicion", "variante", "centro", "anuncio"})


class ErrorAtribucion(ValueError):
    """El mapa o el cambio no permiten demostrar continuidad por campos."""


def _partes(puntero: str) -> tuple[str, ...]:
    if not isinstance(puntero, str) or not puntero.startswith("/"):
        raise ErrorAtribucion("Puntero de campo inválido")
    partes = puntero[1:].split("/")
    if any(not p or re.search(r"~(?![01])|[\x00-\x20*]", p) for p in partes):
        raise ErrorAtribucion("Puntero ambiguo, vacío o con comodines")
    salida = tuple(p.replace("~1", "/").replace("~0", "~") for p in partes)
    if salida != ("titulo",) and (salida[0] != "datos" or len(salida) < MIN_PARTES_DATO):
        raise ErrorAtribucion("El mapa no permite cambiar identidad ni abarcar todo el negocio")
    return salida


def _solapan(primera: tuple[str, ...], segunda: tuple[str, ...]) -> bool:
    return primera[: len(segunda)] == segunda or segunda[: len(primera)] == primera


@dataclass(frozen=True, kw_only=True)
class ContratoCanal:
    """Contrato inmutable; su clave persistida cambia si varía cualquier proyección."""

    id: str
    version: int
    entidad: str
    campos: tuple[str, ...]

    def __post_init__(self) -> None:
        if (
            not isinstance(self.id, str)
            or IDENTIFICADOR.fullmatch(self.id) is None
            or type(self.version) is not int
            or self.version < 1
            or not isinstance(self.entidad, str)
            or self.entidad not in ENTIDADES
            or type(self.campos) is not tuple
            or not self.campos
        ):
            raise ErrorAtribucion("Contrato de atribución inválido")
        partes = [_partes(c) for c in self.campos]
        if any(_solapan(a, b) for i, a in enumerate(partes) for b in partes[i + 1 :]):
            raise ErrorAtribucion("Campos duplicados o solapados")

    def documento(self) -> ObjetoJson:
        """Devuelve el material canónico que identifica la definición.

        Returns:
            Identidad, versión y punteros, sin reloj ni datos de la fuente.
        """
        return {
            "schema_version": 1,
            "id": self.id,
            "version": self.version,
            "entidad": self.entidad,
            "campos": list(self.campos),
        }

    @property
    def clave(self) -> str:
        """Liga la definición a una clave de canal ya almacenable.

        Returns:
            Clave que no admite otro mapa bajo la misma identidad.
        """
        return f"{PREFIJO}{self.id}:{self.version}:{sha256_json(self.documento())}"


def validar_contratos(contratos: tuple[ContratoCanal, ...]) -> None:
    """Exige definiciones propias, inmutables y sin ámbitos superpuestos.

    Raises:
        ErrorAtribucion: Si hay duplicados, solapes o una definición no tipada.
    """
    if type(contratos) is not tuple or any(type(c) is not ContratoCanal for c in contratos):
        raise ErrorAtribucion("Se requiere una tupla de contratos de canal")
    for i, contrato in enumerate(contratos):
        for otro in contratos[i + 1 :]:
            if contrato.clave == otro.clave:
                raise ErrorAtribucion("Contrato de canal duplicado")
            if contrato.entidad == otro.entidad and any(
                _solapan(_partes(a), _partes(b)) for a in contrato.campos for b in otro.campos
            ):
                raise ErrorAtribucion("Proyecciones de canales solapadas")


@dataclass(frozen=True, kw_only=True)
class CanalesAtribuidos:
    """Canales por lote y sus contratos inseparables; no cambia las APIs de listas previas."""

    canales_por_lote: tuple[tuple[ObjetoJson, ...], ...]
    contratos: tuple[ContratoCanal, ...]

    def __post_init__(self) -> None:
        validar_contratos(self.contratos)
        if type(self.canales_por_lote) is not tuple or any(
            type(lote) is not tuple or any(not isinstance(canal, dict) for canal in lote)
            for lote in self.canales_por_lote
        ):
            raise ErrorAtribucion("Canales por lote deben usar colecciones explícitas e inmutables")

    def lotes(self) -> list[list[ObjetoJson]]:
        """Aísla las estructuras JSON del llamador antes de validar o escribir.

        Returns:
            Copia de las listas; ninguna se utiliza como definición del contrato.
        """
        return deepcopy([list(c) for c in self.canales_por_lote])

    def unico(self) -> list[ObjetoJson]:
        """Exige la cardinalidad de cargar_lote, sin escoger el primer lote.

        Returns:
            Canales del único lote declarado.

        Raises:
            ErrorAtribucion: Si se intenta entregar cero o varios lotes como uno solo.
        """
        if len(self.canales_por_lote) != 1:
            raise ErrorAtribucion("cargar_lote exige exactamente un conjunto de canales")
        return self.lotes()[0]


def _proyeccion(objeto: ObjetoJson, partes: tuple[str, ...]) -> ObjetoJson:
    valor: ValorJson = objeto
    for parte in partes:
        if not isinstance(valor, dict) or parte not in valor:
            return {"presente": False}
        valor = valor[parte]
    return {"presente": True, "valor": valor}


def _sin_campos(objeto: ObjetoJson, contratos: tuple[ContratoCanal, ...]) -> ObjetoJson:
    salida = deepcopy(objeto)
    for contrato in contratos:
        for puntero in contrato.campos:
            partes = _partes(puntero)
            destino: ValorJson = salida
            for parte in partes[:-1]:
                destino = destino.get(parte) if isinstance(destino, dict) else None
            if isinstance(destino, dict):
                destino.pop(partes[-1], None)
    return salida


def comprobar_cambio(
    anterior: ObjetoJson | None,
    nuevo: ObjetoJson,
    contratos: tuple[ContratoCanal, ...],
    previos: set[str],
    repetidos: set[str],
) -> None:
    """Comprueba anclaje o diff real después del cotejo temporal de las capturas.

    La primera atribución solo se ancla sobre negocio íntegro idéntico. Las
    definiciones previas no pueden desaparecer ni cambiar sin una transición
    explícita, que este contrato no ejecuta. Los canales históricos conservan
    sus evidencias sin inventar qué campos produjeron.

    Raises:
        ErrorAtribucion: Si cambia el mapa, un campo ajeno o una proyección sin recaptura.
    """
    claves = {c.clave for c in contratos}
    protegidos = {c for c in previos if c.startswith(PREFIJO)}
    if not protegidos <= claves:
        raise ErrorAtribucion("Falta la definición del contrato de canal protegido")
    if claves - protegidos:
        if protegidos:
            raise ErrorAtribucion("Cambio de mapa o versión requiere transición explícita")
        if anterior is None or sha256_json(anterior) != sha256_json(nuevo):
            raise ErrorAtribucion("Anclaje exige negocio íntegro idéntico")
    if anterior is None or not contratos:
        return
    if sha256_json(_sin_campos(anterior, contratos)) != sha256_json(_sin_campos(nuevo, contratos)):
        raise ErrorAtribucion("Cambio de campos no atribuidos")
    for contrato in contratos:
        for campo in contrato.campos:
            partes = _partes(campo)
            if contrato.clave in repetidos and sha256_json(_proyeccion(anterior, partes)) != sha256_json(
                _proyeccion(nuevo, partes)
            ):
                raise ErrorAtribucion("Cambio de proyección sin captura estrictamente nueva")
