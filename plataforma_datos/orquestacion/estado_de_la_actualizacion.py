"""Estado de cada módulo tras cada actualización: var/actualizacion/ejecuciones/estado.json.

Por módulo (modulos.py): el último intento (instante UTC en que empezó la actualización que lo ejecutó), su veredicto y
su motivo, la última versión buena publicada (instante en que se publicó y huella de sus carpetas), los fallos seguidos
y el próximo reintento. Veredictos: «verde» (publicó su versión nueva o no tenía cambios), «ámbar» (falló y conserva su
última versión buena publicada) y «rojo» (no pudo quedar en un estado coherente). Tras un fallo, el próximo reintento
llega a los días de ESPERAS_EN_DIAS según los fallos seguidos, y después cada tanto como la última: `actualizar
--pendientes` ejecuta solo los módulos cuyo reintento ha vencido. Un módulo que no se ejecutó conserva lo anterior.
Una recomposición sin descarga no resuelve el fallo de una consulta: si el módulo esperaba un reintento y la
recomposición no publica nada nuevo ni queda en rojo, su registro no cambia (ni el intento ni el reintento).

Cada cambio de veredicto de un módulo se avisa (`avisar`): una línea en ejecuciones/avisos.log y, si el despliegue
define la variable FARO_AVISO con una orden, esa orden con el aviso como argumento. El archivo de estado se escribe
entero o nada (sustitucion.escribir_atomico), con el cerrojo de la actualización.

Repetir la última operación (mismo comienzo y ruta única de informe) con resultados ya aplicados no reescribe,
no cuenta otro fallo ni vuelve a avisar. Un informe distinto identifica otro intento incluso en el mismo segundo.
El estado v5 distingue huella conservada y payload histórico no conservado. Los formatos anteriores
solo se aceptan en migrar_estado_actualizacion; ni el lector ni una actualización los convierten implícitamente. La
única excepción es un estado v5 al que solo le faltan módulos dados de alta: la actualización lo amplía sola al
arrancar, bajo su cerrojo y con respaldo (migrar_estado_actualizacion.ampliar_al_arrancar).
Un intento histórico sin huella no acredita replay. Una operación real nueva conserva los registros omitidos
y guarda su propio payload completo. No es un diario de operaciones históricas arbitrarias.
"""

import hashlib
import json
import os
import re
import subprocess
from collections.abc import Callable, Mapping
from datetime import datetime, timedelta
from pathlib import Path
from typing import NamedTuple

from plataforma_datos.comun.entrada_salida import leer_json
from plataforma_datos.comun.nucleo import FormatoInesperado, exigir
from plataforma_datos.orquestacion.modulos import IDS, MODULOS, MODULOS_DE_APOYO, PAQUETE
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import CARPETA_DE_INFORMES
from plataforma_datos.orquestacion.procesos import ejecutar_con_plazo
from plataforma_datos.orquestacion.sustitucion import escribir_atomico

ARCHIVO = "estado.json"
VERSION_REGISTRO = 5
VERSION_CON_HUELLA = 4
HUELLA_CONSERVADA = "huella_conservada"
SIN_HUELLA_HISTORICA = "no_conservada"
ARCHIVO_DE_AVISOS = "avisos.log"
VARIABLE_DEL_AVISO = "FARO_AVISO"
SEGUNDOS_DEL_AVISO = 30  # tope de la orden de aviso del despliegue
VERDE, AMBAR, ROJO = "verde", "ámbar", "rojo"
# Días de espera antes de reintentar un módulo tras 1, 2, 3 y 4 o más fallos seguidos.
ESPERAS_EN_DIAS = (1, 2, 4, 8)
SIN_INTENTO = {
    "ultimo_intento_utc": None,
    "veredicto": None,
    "motivo": None,
    "ultima_version_buena": None,
    "fallos_seguidos": 0,
    "proximo_reintento_utc": None,
}

Aviso = Callable[[Path, str], None]


class ResultadoDelModulo(NamedTuple):
    """Lo que dejó un módulo en esta actualización: veredicto, motivo y huella de lo publicado (None si no publicó)."""

    veredicto: str
    motivo: str = ""
    publicado: str | None = None


def hay_rojo_que_bloquea(resultados: Mapping[str, ResultadoDelModulo]) -> bool:
    """Si algún módulo en rojo impide exportar el paquete: todos, salvo los de apoyo, que solo avisan en el estado.

    Returns:
        True si hay un rojo que bloquea.
    """
    return any(r.veredicto == ROJO and nombre not in MODULOS_DE_APOYO for nombre, r in resultados.items())


def bloquear_paquete(raiz: Path, resultados: dict[str, ResultadoDelModulo], interrumpida: bool) -> list[str]:
    """Anota en `resultados` por qué no se exporta el paquete, sin inventar otro intento de las fuentes omitidas.

    No se exporta tras una ronda interrumpida (el área puede no estar restaurada, sea de quien sea el rojo) ni con un
    módulo conservado en rojo desde un ciclo anterior que esta selección no ejecuta. Un módulo de apoyo en rojo no
    bloquea, pero no puede dejar el ciclo en verde.

    Args:
        raiz: La raíz del repositorio, de donde se lee el estado anterior.
        resultados: Lo que dejó cada módulo en esta ronda; se completa con el paquete en rojo si no se exporta.
        interrumpida: Si la ronda se interrumpió.

    Returns:
        Los módulos de apoyo que quedaron en rojo antes y no se ejecutaron ahora.
    """
    previos = leer_estado(raiz)
    en_rojo = [m.id for m in MODULOS if m.id not in resultados and previos.get(m.id, {}).get("veredicto") == ROJO]
    if interrumpida:
        resultados[PAQUETE] = ResultadoDelModulo(ROJO, "no se exporta: la ronda se interrumpió")
    elif not hay_rojo_que_bloquea(resultados) and (pendientes := [m for m in en_rojo if m not in MODULOS_DE_APOYO]):
        resultados[PAQUETE] = ResultadoDelModulo(
            ROJO, "no se exporta: módulos conservados sin compatibilidad acreditada: " + ", ".join(pendientes)
        )
    return [m for m in en_rojo if m in MODULOS_DE_APOYO]


class Intento(NamedTuple):
    """Una actualización: cuándo empezó, su veredicto y su informe."""

    comienzo: datetime
    veredicto: str
    informe: Path


def avisar(raiz: Path, mensaje: str) -> None:
    """Anota el aviso y ejecuta FARO_AVISO si está definido; registra también los fallos de esa orden."""
    linea = mensaje.replace("\n", " ")
    orden = os.environ.get(VARIABLE_DEL_AVISO)
    if orden:
        try:
            ejecutar_con_plazo([orden, linea], cwd=raiz, plazo=SEGUNDOS_DEL_AVISO).check_returncode()
        except (OSError, subprocess.SubprocessError) as error:
            linea += f" (la orden de aviso falló: {error})"
    with (raiz / CARPETA_DE_INFORMES / ARCHIVO_DE_AVISOS).open("a", encoding="utf-8") as archivo:
        archivo.write(linea + "\n")


def espera(fallos_seguidos: int) -> timedelta:
    """Espera antes del próximo intento tras `fallos_seguidos` (≥ 1) fallos: 1, 2, 4 y 8 días, y 8 desde entonces.

    Returns:
        El plazo hasta el próximo intento, en días enteros (1, 2, 4 u 8).

    Raises:
        ValueError: Si la cuenta no es un entero positivo.
    """
    if type(fallos_seguidos) is not int or fallos_seguidos < 1:
        raise ValueError("fallos_seguidos debe ser un entero positivo")
    return timedelta(days=ESPERAS_EN_DIAS[min(fallos_seguidos, len(ESPERAS_EN_DIAS)) - 1])


def nombre_respaldo_migracion(huella: str) -> str:
    """Identifica el original exacto que conserva y traslada una migración.

    Returns:
        Nombre local del respaldo, sin rutas recibidas desde JSON.
    """
    exigir(
        isinstance(huella, str) and re.fullmatch(r"[0-9a-f]{64}", huella) is not None, "huella de respaldo no válida"
    )
    return f"estado-pre-v5-{huella}.json"


def comprobar_cabecera_estado(documento: dict) -> None:
    """Exige v5 y distingue una huella conservada de un payload histórico desconocido."""
    exigir(
        type(documento.get("version")) is int and documento["version"] == VERSION_REGISTRO,
        "versión del estado no admitida; migrar explícitamente antes de ejecutar",
    )
    exigir(
        set(documento) == {"version", "actualizacion", "modulos", "origen_migracion"}, "campos del estado no válidos"
    )
    actualizacion = documento["actualizacion"]
    exigir(
        isinstance(actualizacion, dict)
        and set(actualizacion)
        == {"comienzo_utc", "veredicto", "informe", "huella_resultados", "integridad_resultados"},
        "campos de la actualización no válidos",
    )
    origen = documento["origen_migracion"]
    exigir(
        origen is None
        or isinstance(origen, dict)
        and set(origen) == {"version", "sha256_estado"}
        and (origen["version"] is None or type(origen["version"]) is int and origen["version"] in (2, 3, 4))
        and isinstance(origen["sha256_estado"], str)
        and re.fullmatch(r"[0-9a-f]{64}", origen["sha256_estado"]) is not None,
        "origen de migración no válido",
    )
    huella, integridad = actualizacion["huella_resultados"], actualizacion["integridad_resultados"]
    exigir(
        isinstance(huella, str)
        and re.fullmatch(r"[0-9a-f]{64}", huella) is not None
        and integridad == HUELLA_CONSERVADA
        or huella is None
        and integridad == SIN_HUELLA_HISTORICA
        and origen is not None
        and origen["version"] != VERSION_CON_HUELLA,
        "huella o integridad de resultados no válidas",
    )


def _leer_estado(raiz: Path) -> tuple[dict, dict[str, dict]]:
    """Lee únicamente el contrato vigente, sin migraciones implícitas.

    Returns:
        Ambos objetos vacíos si no hay registro; documento y módulos completos en otro caso.

    Raises:
        FormatoInesperado: Si el documento no satisface el contrato vigente.
    """
    ruta = raiz / CARPETA_DE_INFORMES / ARCHIVO
    if not ruta.exists():
        return {}, {}
    documento = leer_json(ruta)
    exigir(isinstance(documento, dict), f"{ruta}: el estado debe ser un objeto")
    try:
        comprobar_cabecera_estado(documento)
    except FormatoInesperado as error:
        raise FormatoInesperado(f"{ruta}: {error}") from error
    modulos = documento["modulos"]
    exigir(
        isinstance(modulos, dict) and set(modulos) == set(IDS),
        f"{ruta}: inventario del registro incompleto o desconocido; conviértelo con python -m "
        "plataforma_datos.orquestacion.migrar_estado_actualizacion --raiz <raíz> --sha256-estado <huella del estado>",
    )
    for nombre, registro in modulos.items():
        contexto = f"{ruta}: {nombre}"
        exigir(
            isinstance(registro, dict) and set(registro) == set(SIN_INTENTO),
            f"{contexto}: campos del módulo incompletos o desconocidos",
        )
        fallos = registro["fallos_seguidos"]
        exigir(type(fallos) is int and fallos >= 0, f"{contexto}: fallos_seguidos debe ser un entero no negativo")
        buena = registro["ultima_version_buena"]
        exigir(buena is None or isinstance(buena, dict), f"{contexto}: ultima_version_buena debe ser un objeto o null")
    return documento, modulos


def leer_estado(raiz: Path) -> dict[str, dict]:
    """Devuelve el estado de cada módulo; vacío si aún no hay actualización registrada.

    Returns:
        Proyección validada del registro, sin modificar el archivo ni sus fechas.
    """
    return _leer_estado(raiz)[1]


def pendientes(raiz: Path, ahora: datetime) -> tuple[str, ...]:
    """Los módulos cuyo próximo reintento ya ha llegado, en el orden del registro.

    Returns:
        Los ids de los módulos que toca reintentar ya, en el orden del registro.

    Raises:
        FormatoInesperado: Si un reintento registrado no es un instante válido con zona horaria.
    """
    previas = leer_estado(raiz)
    vencidos = []
    for modulo in IDS:
        reintento = previas.get(modulo, {}).get("proximo_reintento_utc")
        if reintento is None:
            continue
        contexto = f"{raiz / CARPETA_DE_INFORMES / ARCHIVO}: {modulo}: proximo_reintento_utc"
        exigir(isinstance(reintento, str), f"{contexto} debe ser un instante ISO 8601 con zona horaria")
        try:
            fecha = datetime.fromisoformat(reintento)
        except ValueError as error:
            raise FormatoInesperado(f"{contexto} no es un instante válido: {error}") from error
        exigir(fecha.utcoffset() is not None, f"{contexto} debe incluir zona horaria")
        if fecha <= ahora:
            vencidos.append(modulo)
    return tuple(vencidos)


def _registro(antes: dict, resultado: ResultadoDelModulo, comienzo: datetime) -> dict:
    """El registro nuevo de un módulo a partir del anterior y de lo que dejó en esta actualización.

    Returns:
        El registro del módulo (instantes en UTC, ISO 8601), listo para escribir en estado.json.
    """
    instante = comienzo.isoformat(timespec="seconds")
    fallos = 0 if resultado.veredicto == VERDE else antes["fallos_seguidos"] + 1
    buena = antes["ultima_version_buena"]
    if resultado.publicado is not None:
        buena = {"publicada_utc": instante, "huella": resultado.publicado}
    return {
        "ultimo_intento_utc": instante,
        "veredicto": resultado.veredicto,
        "motivo": resultado.motivo or None,
        "ultima_version_buena": buena,
        "fallos_seguidos": fallos,
        "proximo_reintento_utc": (comienzo + espera(fallos)).isoformat(timespec="seconds") if fallos else None,
    }


def _registro_recompuesto(antes: dict, resultado: ResultadoDelModulo, comienzo: datetime) -> dict:
    """Registro tras recomponer sin descargar: conserva un reintento pendiente que la recomposición no resuelve.

    Una publicación nueva o un rojo sí se registran: el rojo protege a los consumidores y lo publicado debe
    constar con su fecha. El reintento de la consulta sigue además en el registro de comprobaciones.

    Returns:
        El registro anterior, intacto, o el de _registro cuando la recomposición cambia lo publicado o queda en rojo.
    """
    reintento_pendiente = antes["veredicto"] == AMBAR and antes["fallos_seguidos"] > 0
    if reintento_pendiente and resultado.veredicto != ROJO and resultado.publicado is None:
        return antes
    return _registro(antes, resultado, comienzo)


def _huella_resultados(resultados: Mapping[str, ResultadoDelModulo]) -> str:
    """Identifica el payload completo: conjunto de módulos y todos sus valores, incluidos los null.

    Returns:
        SHA-256 de JSON canónico independiente del orden de las claves de entrada.
    """
    exigir(set(resultados) <= set(IDS), "resultados de módulos desconocidos")
    contenido = {nombre: resultado._asdict() for nombre, resultado in resultados.items()}
    return hashlib.sha256(
        json.dumps(contenido, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    ).hexdigest()


def _repeticion(documento: dict, actualizacion: dict) -> bool:
    """Reconoce la última operación por comienzo e informe y comprueba su payload completo.

    Returns:
        True solo para la misma operación íntegra; no reproduce operaciones históricas arbitrarias.

    Raises:
        FormatoInesperado: Si la operación contradice la registrada o el legado carece de huella para comprobarla.
    """
    anterior = documento.get("actualizacion")
    if not isinstance(anterior, dict) or any(
        anterior.get(campo) != actualizacion[campo] for campo in ("comienzo_utc", "informe")
    ):
        return False
    exigir(
        anterior.get("integridad_resultados") == HUELLA_CONSERVADA,
        "repetición no verificable del mismo intento histórico sin payload",
    )
    exigir(anterior == actualizacion, "el mismo intento ya tiene otro resultado o veredicto")
    return True


def registrar_estado(
    raiz: Path,
    resultados: Mapping[str, ResultadoDelModulo],
    intento: Intento,
    aviso: Aviso = avisar,
    *,
    recompuestos: frozenset[str] = frozenset(),
) -> Path:
    """Escribe ejecuciones/estado.json con esta actualización y avisa de cada módulo que cambia de veredicto.

    `recompuestos` son los módulos ejecutados sin ninguna descarga en esta actualización.

    Returns:
        La ruta de estado.json, ya escrito de forma atómica.
    """
    ruta = raiz / CARPETA_DE_INFORMES / ARCHIVO
    documento, previas = _leer_estado(raiz)
    actualizacion = {
        "comienzo_utc": intento.comienzo.isoformat(timespec="seconds"),
        "veredicto": intento.veredicto,
        "informe": intento.informe.relative_to(raiz).as_posix(),
        "huella_resultados": _huella_resultados(resultados),
        "integridad_resultados": HUELLA_CONSERVADA,
    }
    if _repeticion(documento, actualizacion):
        return ruta
    modulos = {}
    for modulo in IDS:
        antes = {**SIN_INTENTO, **previas.get(modulo, {})}
        resultado = resultados.get(modulo)
        if resultado is None:
            modulos[modulo] = antes
        elif modulo in recompuestos:
            modulos[modulo] = _registro_recompuesto(antes, resultado, intento.comienzo)
        else:
            modulos[modulo] = _registro(antes, resultado, intento.comienzo)
    estado = {
        "version": VERSION_REGISTRO,
        "origen_migracion": documento.get("origen_migracion"),
        "actualizacion": actualizacion,
        "modulos": modulos,
    }
    escribir_atomico(ruta, json.dumps(estado, ensure_ascii=False, indent=2) + "\n")
    for nombre, registro in modulos.items():
        if registro["veredicto"] not in (previas.get(nombre, {}).get("veredicto") or VERDE, None):
            motivo = f" · {registro['motivo']}" if registro["motivo"] else ""
            aviso(raiz, f"{registro['ultimo_intento_utc']} · {nombre} · {registro['veredicto']}{motivo}")
    return ruta
