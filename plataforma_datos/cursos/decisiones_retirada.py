"""Contrato `decisiones-retirada` versión 1: lo que la regla de retirada decidió tras cada lectura de una fuente.

Hay un archivo inmutable por lectura, `var/actualizacion/validados/<fuente>/decisiones/<lectura_id>.json`, en el mismo
JSON canónico que las lecturas. Guarda las decisiones que no son `mantener` (`retirar` y `pendiente`), cada una con sus
evidencias, y solo el recuento de las que sí lo son: un curso que se mantiene no tiene nada que explicar. La regla que
firma el archivo es la misma para todas sus decisiones.

Guardar dos veces el mismo registro no cambia nada; guardar otro para la misma lectura es un error, porque lo decidido
con una regla no se reescribe. La lectura es estricta: forma canónica, campos cerrados y decisiones coherentes con sus
evidencias. No consulta la red ni el reloj.
"""

import json
from collections.abc import Iterable
from pathlib import Path

from plataforma_datos.comun.entrada_salida import escribir_bytes_entero
from plataforma_datos.comun.nucleo import DATOS_RELATIVOS
from plataforma_datos.cursos.clasificacion.contrato import CAMPOS_REGLA, Regla
from plataforma_datos.cursos.lecturas.contrato_lectura import (
    AMBITO,
    FUENTE,
    INSTANTE,
    MAX_BYTES,
    SHA256,
    bytes_de,
    validar_lectura,
)
from plataforma_datos.cursos.retirada_por_evidencia import (
    CANALES,
    GRUPOS,
    IDENTIFICADOR,
    MINIMO_DE_EVIDENCIAS,
    Decision,
    clave_de_evidencia,
)
from plataforma_datos.cursos.retirada_por_evidencia import (
    VERSION as VERSION_DE_LA_REGLA,
)
from plataforma_datos.cursos.tipos_json import ObjetoJson, ValorJson

CONTRATO = "decisiones-retirada"
VERSION = 1
CARPETA = "decisiones"
CAMPOS = ("version", "fuente", "ambito", "lectura_id", "regla", "decisiones", "mantenidas")
CAMPOS_DECISION = ("curso", "decision", "evidencias")
CAMPOS_EVIDENCIA = ("grupo", "canal", "ref_sha256", "observado_utc")
# Lo que se registra uno a uno; `mantener` solo se cuenta.
REGISTRADAS = ("retirar", "pendiente")
MAX_DECISIONES = 50_000
MAX_TEXTO = 512


class ErrorDecisiones(ValueError):
    """Un registro de decisiones que no cumple el contrato: no se guarda ni se lee como válido."""


def _exigir(condicion: object, motivo: str) -> None:
    if not condicion:
        raise ErrorDecisiones(f"{CONTRATO}: {motivo}")


def _campos(valor: ValorJson, campos: tuple[str, ...], lugar: str) -> None:
    """Exige un objeto con exactamente esos campos: el contrato es cerrado."""
    _exigir(isinstance(valor, dict), f"{lugar} debe ser un objeto")
    sobran = sorted(set(valor) - set(campos))
    faltan = [campo for campo in campos if campo not in valor]
    _exigir(not sobran, f"{lugar}: campo no admitido «{', '.join(sobran)}»")
    _exigir(not faltan, f"{lugar}: falta el campo «{', '.join(faltan)}»")


def _huella(valor: ValorJson, lugar: str) -> None:
    _exigir(isinstance(valor, str) and SHA256.fullmatch(valor) is not None, f"{lugar}: huella SHA-256 no válida")


def _evidencia(evidencia: ValorJson) -> None:
    _campos(evidencia, CAMPOS_EVIDENCIA, "evidencia")
    _exigir(evidencia["grupo"] in GRUPOS, "evidencia: grupo no admitido")
    _exigir(evidencia["canal"] in CANALES[evidencia["grupo"]], "evidencia: canal no admitido en su grupo")
    _huella(evidencia["ref_sha256"], "evidencia.ref_sha256")
    hora = evidencia["observado_utc"]
    _exigir(isinstance(hora, str) and INSTANTE.fullmatch(hora) is not None, "evidencia: hora UTC no válida")


def _coherente(decision: ObjetoJson) -> None:
    """La decisión es la que sostienen sus evidencias: un `pendiente` no tiene lo que basta para retirar."""
    grupos = [evidencia["grupo"] for evidencia in decision["evidencias"]]
    suficiente = "fuente" in grupos or {"censo", "pagina"} <= set(grupos)
    if decision["decision"] == "pendiente":
        _exigir(not suficiente, "un pendiente con evidencias que bastan para retirar")
    else:
        # Las ausencias sanas bastan solas en una fuente sin página; qué fuentes la tienen lo fija la regla firmada.
        varias_ausencias = grupos.count("censo") >= MINIMO_DE_EVIDENCIAS
        _exigir(suficiente or varias_ausencias, "una retirada sin evidencias suficientes")


def _decision(decision: ValorJson) -> None:
    _campos(decision, CAMPOS_DECISION, "decisión")
    curso = decision["curso"]
    _exigir(isinstance(curso, str) and 0 < len(curso) <= MAX_TEXTO, "decisión: curso no válido")
    _exigir(decision["decision"] in REGISTRADAS, "decisión: solo se registran «retirar» y «pendiente»")
    evidencias = decision["evidencias"]
    _exigir(isinstance(evidencias, list) and evidencias, "decisión: sin evidencias")
    for evidencia in evidencias:
        _evidencia(evidencia)
    claves = [clave_de_evidencia(evidencia) for evidencia in evidencias]
    _exigir(claves == sorted(set(claves)), "decisión: evidencias sin orden canónico o repetidas")
    _coherente(decision)


def _regla(regla: ValorJson) -> None:
    _campos(regla, CAMPOS_REGLA, "regla")
    _exigir(regla["id"] == IDENTIFICADOR, "regla: no es la regla de retirada")
    _exigir(type(regla["version"]) is int and regla["version"] == VERSION_DE_LA_REGLA, "regla: versión no admitida")
    _huella(regla["sha256"], "regla.sha256")


def validar_registro(registro: ValorJson) -> None:
    """Valida un registro de decisiones tal como se guarda.

    Raises:
        ErrorDecisiones: Si incumple el contrato; el mensaje dice qué campo falla.
    """
    _campos(registro, CAMPOS, "registro")
    _exigir(type(registro["version"]) is int and registro["version"] == VERSION, "versión no admitida")
    _exigir(isinstance(registro["fuente"], str) and FUENTE.fullmatch(registro["fuente"]), "fuente no admitida")
    _exigir(isinstance(registro["ambito"], str) and AMBITO.fullmatch(registro["ambito"]), "ámbito no admitido")
    _huella(registro["lectura_id"], "lectura_id")
    _regla(registro["regla"])
    decisiones = registro["decisiones"]
    _exigir(isinstance(decisiones, list) and len(decisiones) <= MAX_DECISIONES, "decisiones: lista no válida")
    for decision in decisiones:
        _decision(decision)
    cursos = [decision["curso"] for decision in decisiones]
    _exigir(cursos == sorted(set(cursos)), "decisiones sin orden canónico o con un curso repetido")
    mantenidas = registro["mantenidas"]
    _exigir(type(mantenidas) is int and 0 <= mantenidas <= MAX_DECISIONES, "mantenidas: recuento no válido")


def construir_registro(lectura: ObjetoJson, regla: Regla, decisiones: Iterable[Decision]) -> ObjetoJson:
    """El registro de lo decidido tras una lectura: las retiradas y los pendientes, y cuántos cursos se mantienen.

    Returns:
        El registro validado, listo para guardarse.

    Raises:
        ErrorDecisiones: Si una decisión la firmó otra regla, un curso se repite o el registro no cumple el contrato.
    """
    validar_lectura(lectura)
    registradas, mantenidas = [], 0
    for decision in decisiones:
        _exigir(decision.regla == regla, f"la decisión de {decision.curso} la firmó otra regla")
        if decision.decision == "mantener":
            mantenidas += 1
            continue
        evidencias = [evidencia.a_json() for evidencia in decision.evidencias]
        registradas.append({"curso": decision.curso, "decision": decision.decision, "evidencias": evidencias})
    registro = {
        "version": VERSION,
        "fuente": lectura["fuente"],
        "ambito": lectura["ambito"],
        "lectura_id": lectura["lectura_id"],
        "regla": regla.a_json(),
        "decisiones": sorted(registradas, key=lambda decision: decision["curso"]),
        "mantenidas": mantenidas,
    }
    validar_registro(registro)
    return registro


def leer_registro(contenido: bytes) -> ObjetoJson:
    """Lee un registro guardado: JSON en UTF-8, en forma canónica exacta y conforme al contrato.

    La forma canónica exacta también rechaza las claves repetidas y los números no finitos: ninguno de los dos
    sobrevive a volver a escribir el registro en forma canónica.

    Returns:
        El registro validado.

    Raises:
        ErrorDecisiones: Si los bytes no son un registro válido en forma canónica.
    """
    _exigir(len(contenido) <= MAX_BYTES, "registro demasiado grande")
    try:
        registro = json.loads(contenido.decode("utf-8"))
        canonico = bytes_de(registro)
    except (UnicodeDecodeError, ValueError) as error:
        raise ErrorDecisiones(f"{CONTRATO}: no es JSON canónico en UTF-8") from error
    _exigir(canonico == contenido, "el registro no está en forma canónica")
    validar_registro(registro)
    return registro


def ruta_del_registro(raiz: Path, fuente: str, lectura_id: str) -> Path:
    """Dónde se guarda el registro de una lectura dentro de una instalación.

    Returns:
        `var/actualizacion/validados/<fuente>/decisiones/<lectura_id>.json` bajo `raiz`.
    """
    _exigir(FUENTE.fullmatch(fuente) is not None, "fuente no admitida")
    _huella(lectura_id, "lectura_id")
    return raiz / DATOS_RELATIVOS / "validados" / fuente / CARPETA / f"{lectura_id}.json"


def _bytes_guardados(ruta: Path) -> bytes:
    _exigir(not ruta.is_symlink() and ruta.is_file(), f"{ruta.name} no es un archivo propio")
    _exigir(ruta.stat().st_size <= MAX_BYTES, f"{ruta.name} es demasiado grande")
    return ruta.read_bytes()


def guardar_registro(raiz: Path, registro: ObjetoJson) -> Path:
    """Guarda el registro de una lectura; si ya está guardado igual, no hace nada.

    Returns:
        La ruta del archivo del registro.

    Raises:
        ErrorDecisiones: Si el registro no es válido o si ya hay otro distinto para la misma lectura.
    """
    validar_registro(registro)
    contenido = bytes_de(registro)
    destino = ruta_del_registro(raiz, registro["fuente"], registro["lectura_id"])
    if destino.exists() or destino.is_symlink():
        _exigir(_bytes_guardados(destino) == contenido, "ya hay otro registro para esta lectura; lo decidido no cambia")
        return destino
    destino.parent.mkdir(parents=True, exist_ok=True)
    escribir_bytes_entero(destino, contenido)
    return destino


def cargar_registro(raiz: Path, fuente: str, lectura_id: str) -> ObjetoJson:
    """Lee el registro guardado de una lectura y exige que sea el de esa fuente y esa lectura.

    Returns:
        El registro validado.

    Raises:
        ErrorDecisiones: Si el archivo no existe, no es válido o guarda el registro de otra lectura.
    """
    ruta = ruta_del_registro(raiz, fuente, lectura_id)
    registro = leer_registro(_bytes_guardados(ruta))
    _exigir((registro["fuente"], registro["lectura_id"]) == (fuente, lectura_id), f"{ruta.name} guarda otro registro")
    return registro
