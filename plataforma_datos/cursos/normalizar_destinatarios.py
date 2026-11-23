"""Destinatarios versionados: alias exactos y procedencia.

Configuraciones explícitas, sin IO ni inferencia sobre literales o acceso personal.
Las categorías conservadas son clasificaciones de origen; no prueban publicación,
exclusividad ni admisión. Un código compuesto o propuesto conserva ese carácter.
"""

from copy import deepcopy

from plataforma_datos.comun import huella_json
from plataforma_datos.cursos.tipos_json import ObjetoJson, ValorJson

VERSION = "destinatarios-1.0.0"
SHA_VOCABULARIO = "7d69f972c7f129ca38e52cee6aea4bd1edcd35540a743818f6c2cf1c6cd138a9"
SHA_ALIASES = "abdf74841022fed016f840f51a6004dc922560f204ae20c8fb8cabf1953e2155"


class ErrorDestinatario(ValueError):
    """Configuración, procedencia o precondición de destinatario incoherente."""


def sha256_json(valor: ValorJson) -> str:
    """Calcula SHA-256 de JSON canónico, diferenciando booleanos y números, con el error de este contrato.

    El cálculo es el de `comun.huella_json`; quien importa la huella desde aquí recibe `ErrorDestinatario`.

    Returns:
        Huella UTF-8 con claves ordenadas, sin espacios y sin números no finitos.

    Raises:
        ErrorDestinatario: Si el valor no es JSON canónico.
    """
    try:
        return huella_json.sha256_json(valor)
    except huella_json.JsonNoCanonico as error:
        raise ErrorDestinatario(str(error)) from error


def _configurar(vocabulario: ObjetoJson, aliases: ObjetoJson) -> tuple[set[str], dict[str, ObjetoJson]]:
    if sha256_json(vocabulario) != SHA_VOCABULARIO or sha256_json(aliases) != SHA_ALIASES:
        raise ErrorDestinatario("Configuración distinta de destinatarios-1.0.0; requiere revisión y nueva versión")
    codigos = {valor["codigo"] for valor in vocabulario["valores"]}
    reglas = {regla["origen"]: regla for regla in aliases["reglas"]}
    return codigos, reglas


def _resolver(origen: str, codigos: set[str], reglas: dict[str, ObjetoJson]) -> tuple[str | None, str]:
    if origen in codigos:
        return origen, "identidad-v1"
    if origen in reglas:
        return reglas[origen]["destino"], reglas[origen]["id"]
    return None, "pendiente-vocabulario-v1"


def normalizar_categorias(
    categorias: ValorJson, vocabulario: ObjetoJson, aliases: ObjetoJson, *, estricto: bool = False
) -> ObjetoJson:
    """Traduce códigos exactos conservando todas las ocurrencias y desconocidos.

    Returns:
        Categorías únicas en orden de aparición, estado y traza por ocurrencia.

    Raises:
        ErrorDestinatario: Si la configuración, el tipo o el modo estricto lo rechazan.
    """
    codigos, reglas = _configurar(vocabulario, aliases)
    if categorias is not None and (
        not isinstance(categorias, list) or any(not isinstance(elemento, str) for elemento in categorias)
    ):
        raise ErrorDestinatario("categorias debe ser lista de cadenas o null")
    salida: list[ValorJson] = []
    desconocidas: list[ValorJson] = []
    traza: list[ValorJson] = []
    for indice, origen in enumerate(categorias or []):
        destino, regla = _resolver(origen, codigos, reglas)
        if regla == "pendiente-vocabulario-v1" and origen not in desconocidas:
            desconocidas.append(origen)
        duplicado = destino is not None and destino in salida
        traza.append(
            {"indice": indice, "origen": origen, "destino": destino, "regla": regla, "duplicado_salida": duplicado}
        )
        if destino is not None and not duplicado:
            salida.append(destino)
    if desconocidas and estricto:
        raise ErrorDestinatario("Categorías sin regla: " + repr(desconocidas))
    estado = "pendiente_vocabulario" if desconocidas else ("normalizado" if salida else "no_indicado")
    return {"categorias": salida, "estado": estado, "desconocidas": desconocidas, "reglas": traza}


def _original(destinatario: ObjetoJson) -> ObjetoJson:
    if "normalizacion_categorias" not in destinatario:
        return deepcopy(destinatario)
    previo = destinatario["normalizacion_categorias"]
    if not isinstance(previo, dict) or previo.get("version") != VERSION:
        raise ErrorDestinatario("Normalización incompatible; migración explícita necesaria")
    original = previo.get("original")
    if not isinstance(original, dict) or "normalizacion_categorias" in original:
        raise ErrorDestinatario("Procedencia ausente, inválida o recursiva")
    return deepcopy(original)


def normalizar_destinatario(
    destinatario: ValorJson, vocabulario: ObjetoJson, aliases: ObjetoJson, *, estricto: bool = False
) -> ObjetoJson | None:
    """Conserva campos, literales y evidencias; cambia solo categorías y añade traza.

    Returns:
        Objeto independiente, o null conservado; una repetición mantiene el primer original.

    Raises:
        ErrorDestinatario: Si hay una modificación o procedencia incompatible.
    """
    _configurar(vocabulario, aliases)
    sha256_json(destinatario)
    if destinatario is None:
        return None
    if not isinstance(destinatario, dict):
        raise ErrorDestinatario("destinatario debe ser objeto o null")
    original = _original(destinatario)
    literal = original.get("texto_literal")
    if literal is not None and not isinstance(literal, str):
        raise ErrorDestinatario("texto_literal debe ser texto o null")
    calculo = normalizar_categorias(original.get("categorias"), vocabulario, aliases, estricto=estricto)
    resultado = deepcopy(original)
    resultado["categorias"] = calculo.pop("categorias")
    resultado["normalizacion_categorias"] = {
        "version": VERSION,
        "metodo": "alias-exacto-sin-inferencia-v1",
        "campo_origen": "/destinatario/categorias",
        "original": original,
        **calculo,
    }
    if "normalizacion_categorias" in destinatario and sha256_json(resultado) != sha256_json(destinatario):
        raise ErrorDestinatario("Objeto normalizado alterado; no se descarta la modificación")
    return resultado
