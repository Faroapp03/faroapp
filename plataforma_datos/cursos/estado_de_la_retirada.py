"""El estado de la regla de retirada de cada fuente, guardado con la base como las lecturas: un registro por ciclo.

Cada ciclo en que la regla decide algo de una fuente deja un registro inmutable y numerado en
`var/actualizacion/validados/<fuente>/retirada/<número>.json`: el modo con que se decidió el ciclo, el estado que queda
después, la evidencia acumulada, las comprobaciones de página o de API que la sostienen (la regla de cada una dice de
dónde sale) y el cambio, si lo hubo. El estado vigente es el del registro de número más alto. Viaja con la
generación, porque la generación conserva todo el árbol validado de la fuente, y así el ciclo siguiente parte del
mismo estado.
"""

import json
import re
from pathlib import Path

from plataforma_datos.comun.nucleo import DATOS_RELATIVOS
from plataforma_datos.cursos.activacion_de_la_retirada import CAMBIOS, ESTADOS, Estado
from plataforma_datos.cursos.comprobacion_api.contrato import validar_comprobacion_guardada
from plataforma_datos.cursos.lecturas.almacen_lecturas import bytes_guardados, guardar_inmutable
from plataforma_datos.cursos.lecturas.contrato_lectura import FUENTE, INSTANTE, SHA256, bytes_de
from plataforma_datos.cursos.tipos_json import ObjetoJson, ValorJson

CARPETA = "retirada"
VERSION = 1
NOMBRE = re.compile(r"(?P<numero>\d{8})\.json")
CAMPOS = (
    "version",
    "fuente",
    "numero",
    "ciclo",
    "lecturas",
    "observado_utc",
    "en_el_ciclo",
    "estado",
    "cambio",
    "ultimo_cambio",
    "confirmadas",
    "ciclos",
    "aplicadas",
    "consulta",
    "comprobaciones",
    "aplicada_contradicha",
    "salud_con_historia",
    "criterio",
)
CAMPOS_CAMBIO = ("cambio", "decisiones", "observado_utc")
CAMPOS_CONSULTA = ("confirman", "contradicen", "no_se_sabe", "sin_comprobar", "motivo")
MOTIVOS_DE_LA_CONSULTA = ("pagina-no-decide", "sin-tiempo")
MAX_LECTURAS = 10_000


class ErrorEstadoDeLaRetirada(ValueError):
    """Un registro del estado de la regla de retirada que no cumple su forma o no es el que le toca."""


def _exigir(condicion: object, motivo: str) -> None:
    if not condicion:
        raise ErrorEstadoDeLaRetirada(f"estado-retirada: {motivo}")


def _recuento(valor: ValorJson) -> bool:
    return type(valor) is int and valor >= 0


def _consulta(consulta: ValorJson) -> None:
    _exigir(isinstance(consulta, dict) and tuple(sorted(consulta)) == tuple(sorted(CAMPOS_CONSULTA)), "consulta")
    _exigir(all(_recuento(consulta[c]) for c in CAMPOS_CONSULTA[:-1]), "consulta: recuentos")
    _exigir(consulta["motivo"] is None or consulta["motivo"] in MOTIVOS_DE_LA_CONSULTA, "consulta: motivo")


# El último cambio de modo de la fuente, que se arrastra de registro en registro: es lo que avisa el panel.
def _ultimo_cambio(cambio: ValorJson, registro: ObjetoJson) -> None:
    if cambio is None:
        _exigir(registro["cambio"] is None, "ultimo_cambio: falta el de este ciclo")
        return
    _exigir(isinstance(cambio, dict) and tuple(sorted(cambio)) == CAMPOS_CAMBIO, "ultimo_cambio")
    _exigir(cambio["cambio"] in CAMBIOS and _recuento(cambio["decisiones"]), "ultimo_cambio: cambio o decisiones")
    _exigir(isinstance(cambio["observado_utc"], str) and INSTANTE.fullmatch(cambio["observado_utc"]), "ultimo_cambio")
    if registro["cambio"] is not None:
        _exigir(cambio["cambio"] == registro["cambio"], "ultimo_cambio: no es el de este ciclo")
        _exigir(cambio["observado_utc"] == registro["observado_utc"], "ultimo_cambio: no es la hora de este ciclo")


def _identificadores(valor: ValorJson, lugar: str) -> None:
    _exigir(isinstance(valor, list) and len(valor) <= MAX_LECTURAS, lugar)
    _exigir(all(isinstance(x, str) and SHA256.fullmatch(x) for x in valor), f"{lugar}: identificadores")
    _exigir(valor == sorted(set(valor)), f"{lugar}: sin orden o repetidos")


def validar_registro(registro: ValorJson) -> None:
    """Exige la forma cerrada del registro y que sus partes cuadren entre sí.

    Raises:
        ErrorEstadoDeLaRetirada: Si un campo falta, sobra o no tiene su forma.
        ErrorComprobacion: Si una comprobación guardada, de página o de API, no cumple su contrato.
    """
    _exigir(isinstance(registro, dict) and tuple(sorted(registro)) == tuple(sorted(CAMPOS)), "campos")
    _exigir(registro["version"] == VERSION, "versión")
    _exigir(isinstance(registro["fuente"], str) and FUENTE.fullmatch(registro["fuente"]), "fuente")
    _exigir(type(registro["numero"]) is int and registro["numero"] >= 1, "número")
    _exigir(isinstance(registro["ciclo"], str) and SHA256.fullmatch(registro["ciclo"]), "ciclo")
    _identificadores(registro["lecturas"], "lecturas")
    _identificadores(registro["aplicadas"], "aplicadas")
    _exigir(isinstance(registro["observado_utc"], str) and INSTANTE.fullmatch(registro["observado_utc"]), "hora")
    _exigir(registro["en_el_ciclo"] in ESTADOS and registro["estado"] in ESTADOS, "estado")
    _exigir(registro["cambio"] is None or registro["cambio"] in CAMBIOS, "cambio")
    _ultimo_cambio(registro["ultimo_cambio"], registro)
    _exigir(_recuento(registro["confirmadas"]) and _recuento(registro["ciclos"]), "evidencia acumulada")
    _exigir(type(registro["aplicada_contradicha"]) is bool and type(registro["salud_con_historia"]) is bool, "marcas")
    criterio = registro["criterio"]
    _exigir(isinstance(criterio, dict) and sorted(criterio) == ["ciclos_minimos", "decisiones_minimas"], "criterio")
    _exigir(all(_recuento(v) for v in criterio.values()), "criterio: mínimos")
    _consulta(registro["consulta"])
    _exigir(isinstance(registro["comprobaciones"], list), "comprobaciones")
    for comprobacion in registro["comprobaciones"]:
        validar_comprobacion_guardada(comprobacion)
        _exigir(comprobacion["fuente"] == registro["fuente"], "comprobación de otra fuente")


def estado_del_registro(registro: ObjetoJson) -> Estado:
    """El estado de la regla que deja un registro.

    Returns:
        El modo, la evidencia acumulada, el cambio y el ciclo del registro.
    """
    return Estado(
        estado=registro["estado"],
        confirmadas=registro["confirmadas"],
        ciclos=registro["ciclos"],
        cambio=registro["cambio"],
        ultimo_ciclo=registro["ciclo"],
    )


def carpeta_del_estado(raiz: Path, fuente: str) -> Path:
    """La carpeta de los registros del estado de una fuente.

    Returns:
        `var/actualizacion/validados/<fuente>/retirada` bajo `raiz`.
    """
    _exigir(FUENTE.fullmatch(fuente), "fuente")
    return raiz / DATOS_RELATIVOS / "validados" / fuente / CARPETA


def ultimo_registro(raiz: Path, fuente: str) -> ObjetoJson | None:
    """El registro vigente de la fuente: el de número más alto, validado y con el nombre que le toca.

    Returns:
        El registro, o `None` si la regla de la fuente aún no ha dejado ninguno (sigue en sombra).

    Raises:
        ErrorEstadoDeLaRetirada: Si el registro vigente no cumple su forma o no corresponde a su nombre.
        ErrorLectura: Si no es un archivo propio o es demasiado grande.
    """
    carpeta = carpeta_del_estado(raiz, fuente)
    if not carpeta.is_dir():
        return None
    nombres = sorted(ruta.name for ruta in carpeta.iterdir() if NOMBRE.fullmatch(ruta.name))
    if not nombres:
        return None
    contenido = bytes_guardados(carpeta / nombres[-1])
    registro = json.loads(contenido)
    validar_registro(registro)
    _exigir(bytes_de(registro) == contenido, "bytes no canónicos")
    _exigir(registro["fuente"] == fuente and f"{registro['numero']:08d}.json" == nombres[-1], "nombre")
    return registro


def guardar_registro(raiz: Path, registro: ObjetoJson) -> Path:
    """Guarda el registro de un ciclo; un registro guardado no cambia.

    Returns:
        La ruta del registro.

    Raises:
        ErrorEstadoDeLaRetirada: Si el registro no cumple su forma.
        ErrorLectura: Si ya hay otro registro con ese número.
    """
    validar_registro(registro)
    destino = carpeta_del_estado(raiz, registro["fuente"]) / f"{registro['numero']:08d}.json"
    return guardar_inmutable(destino, bytes_de(registro), "estado de la retirada")
