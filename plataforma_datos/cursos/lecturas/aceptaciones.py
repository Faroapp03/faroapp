"""Contrato `aceptacion-lectura` versión 1: una persona acepta una lectura como referencia de su ámbito.

La regla de salud compara cada lectura con una referencia. Cuando una fuente cambia de forma de manera legítima, todas
las lecturas siguientes saldrían anómalas por compararse con una forma que ya no existe. Una aceptación deja constancia
de que una persona ha revisado una lectura y la toma como la nueva referencia: qué lectura, cuándo y por qué.

Cada aceptación se guarda una sola vez, junto a las lecturas de su fuente, en
`var/actualizacion/validados/<fuente>/lecturas/aceptacion-<aceptacion_id>.json`, y nunca cambia. Su identificador es
la huella de todo lo demás, así que la misma aceptación tiene siempre el mismo archivo. No consulta el reloj: la hora
de la aceptación llega como dato.
"""

import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.cursos.lecturas.almacen_lecturas import (
    NOMBRE_DE_ACEPTACION,
    PREFIJO_DE_ACEPTACION,
    bytes_guardados,
    carpeta_de_lecturas,
    guardar_inmutable,
)
from plataforma_datos.cursos.lecturas.contrato_lectura import (
    AMBITO,
    BORRAR,
    FORMATO_INSTANTE,
    INSTANTE,
    MAX_AMBITO,
    MAX_TEXTO,
    PRIMER_IMPRIMIBLE,
    SHA256,
    ErrorLectura,
    bytes_de,
    exigir_fuente,
)
from plataforma_datos.cursos.tipos_json import ObjetoJson, ValorJson

CONTRATO = "aceptacion-lectura"
VERSION = 1
CAMPOS = ("version", "aceptacion_id", "fuente", "ambito", "lectura_id", "aceptada_utc", "motivo")
MAX_BYTES = 64 * 1024


class ErrorAceptacion(ValueError):
    """Una aceptación que no cumple el contrato: no se guarda ni cambia ninguna referencia."""


def _exigir(condicion: object, motivo: str) -> None:
    if not condicion:
        raise ErrorAceptacion(f"{CONTRATO}: {motivo}")


def _texto_legible(valor: ValorJson) -> bool:
    return (
        isinstance(valor, str)
        and 0 < len(valor) <= MAX_TEXTO
        and all(ord(c) >= PRIMER_IMPRIMIBLE and ord(c) != BORRAR for c in valor)
    )


def _instante(valor: ValorJson) -> None:
    _exigir(isinstance(valor, str) and INSTANTE.fullmatch(valor) is not None, "aceptada_utc: hora UTC no válida")
    try:
        datetime.strptime(valor, FORMATO_INSTANTE)
    except ValueError as error:
        raise ErrorAceptacion(f"{CONTRATO}: aceptada_utc: fecha inexistente") from error


def identificador_de(aceptacion: ObjetoJson) -> str:
    """El identificador de una aceptación: la huella de todos sus campos salvo el propio identificador.

    Returns:
        El SHA-256 que nombra la aceptación en el almacén.
    """
    return sha256_json({k: v for k, v in aceptacion.items() if k != "aceptacion_id"})


def validar_aceptacion(dato: ValorJson) -> None:
    """Valida una aceptación tal como se guarda: cerrada, con textos legibles y con el identificador que le toca.

    Raises:
        ErrorAceptacion: Si incumple el contrato; el mensaje dice qué campo falla.
    """
    _exigir(isinstance(dato, dict), "la aceptación debe ser un objeto")
    sobran, faltan = sorted(set(dato) - set(CAMPOS)), [c for c in CAMPOS if c not in dato]
    _exigir(not sobran, f"campo no admitido «{', '.join(sobran)}»")
    _exigir(not faltan, f"falta el campo «{', '.join(faltan)}»")
    _exigir(type(dato["version"]) is int and dato["version"] == VERSION, "versión no admitida")
    try:
        exigir_fuente(dato["fuente"])
    except ErrorLectura as error:
        raise ErrorAceptacion(f"{CONTRATO}: fuente no admitida") from error
    ambito = dato["ambito"]
    _exigir(
        isinstance(ambito, str) and len(ambito) <= MAX_AMBITO and AMBITO.fullmatch(ambito) is not None,
        "ámbito no admitido",
    )
    for campo in ("lectura_id", "aceptacion_id"):
        _exigir(isinstance(dato[campo], str) and SHA256.fullmatch(dato[campo]) is not None, f"{campo} no válido")
    _instante(dato["aceptada_utc"])
    # El motivo lo escribe una persona y es lo que justifica la nueva referencia: no puede faltar.
    _exigir(_texto_legible(dato["motivo"]), "motivo vacío, demasiado largo o con caracteres de control")
    _exigir(dato["aceptacion_id"] == identificador_de(dato), "aceptacion_id no es la huella de la aceptación")


@dataclass(frozen=True, kw_only=True)
class Aceptacion:
    """Una persona toma una lectura de un ámbito como referencia desde `aceptada_utc`, por `motivo`."""

    fuente: str
    ambito: str
    lectura_id: str
    aceptada_utc: str
    motivo: str

    def __post_init__(self) -> None:
        """Rechaza al construirla una aceptación que no cumple el contrato."""
        validar_aceptacion(self.a_json())

    def a_json(self) -> ObjetoJson:
        """Devuelve la aceptación tal como se guarda, con su identificador calculado.

        Returns:
            El objeto de la aceptación.
        """
        dato: ObjetoJson = {
            "version": VERSION,
            "fuente": self.fuente,
            "ambito": self.ambito,
            "lectura_id": self.lectura_id,
            "aceptada_utc": self.aceptada_utc,
            "motivo": self.motivo,
        }
        return {"aceptacion_id": identificador_de(dato), **dato}


def _pares_unicos(pares: list[tuple[str, ValorJson]]) -> ObjetoJson:
    resultado = {}
    for clave, valor in pares:
        _exigir(clave not in resultado, f"clave repetida «{clave}»")
        resultado[clave] = valor
    return resultado


def _numero_no_finito(texto: str) -> None:
    raise ErrorAceptacion(f"{CONTRATO}: número no finito «{texto}»")


def leer_aceptacion(contenido: bytes) -> ObjetoJson:
    """Lee una aceptación guardada: JSON estricto, en forma canónica y conforme al contrato.

    Returns:
        La aceptación validada.

    Raises:
        ErrorAceptacion: Si los bytes no son una aceptación válida en forma canónica.
    """
    _exigir(len(contenido) <= MAX_BYTES, "aceptación demasiado grande")
    try:
        dato = json.loads(contenido.decode("utf-8"), object_pairs_hook=_pares_unicos, parse_constant=_numero_no_finito)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ErrorAceptacion(f"{CONTRATO}: no es JSON en UTF-8") from error
    validar_aceptacion(dato)
    _exigir(bytes_de(dato) == contenido, "la aceptación no está en forma canónica")
    return dato


def guardar_aceptacion(raiz: Path, aceptacion: Aceptacion) -> Path:
    """Guarda una aceptación junto a las lecturas de su fuente; si ya está guardada igual, no hace nada.

    Returns:
        La ruta del archivo de la aceptación.

    Raises:
        ErrorLectura: Si ya hay otra aceptación con el mismo identificador y otro contenido.
    """
    dato = aceptacion.a_json()
    destino = carpeta_de_lecturas(raiz, aceptacion.fuente) / f"{PREFIJO_DE_ACEPTACION}{dato['aceptacion_id']}.json"
    return guardar_inmutable(destino, bytes_de(dato), "aceptación")


def listar_aceptaciones(raiz: Path, fuente: str) -> list[ObjetoJson]:
    """Lee todas las aceptaciones de una fuente, validadas, de la más antigua a la más reciente.

    Returns:
        Las aceptaciones ordenadas por su hora y, a igual hora, por su identificador; vacía si no hay ninguna.

    Raises:
        ErrorAceptacion: Si un archivo de aceptación no es válido, guarda otra o es de otra fuente.
        ErrorLectura: Si un archivo de aceptación no es un archivo propio o es demasiado grande.
    """
    carpeta = carpeta_de_lecturas(raiz, fuente)
    if not carpeta.exists():
        return []
    _exigir(not carpeta.is_symlink() and carpeta.is_dir(), f"la carpeta de lecturas de {fuente} no es propia")
    aceptaciones = []
    for ruta in sorted(carpeta.iterdir()):
        nombre = NOMBRE_DE_ACEPTACION.fullmatch(ruta.name)
        if nombre is None:
            continue
        aceptacion = leer_aceptacion(bytes_guardados(ruta))
        _exigir(aceptacion["aceptacion_id"] == nombre["aceptacion_id"], f"{ruta.name} guarda otra aceptación")
        _exigir(aceptacion["fuente"] == fuente, f"{ruta.name} es una aceptación de otra fuente")
        aceptaciones.append(aceptacion)
    return sorted(aceptaciones, key=lambda a: (a["aceptada_utc"], a["aceptacion_id"]))
