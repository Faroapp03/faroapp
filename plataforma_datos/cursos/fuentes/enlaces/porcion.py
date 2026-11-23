"""La porción de enlaces de cada ciclo: sus topes, su orden y qué hacer si un dominio la hace fallar de golpe.

La pausa de cortesía por dominio fija el ritmo y casi todos los enlaces son programas del SEPE, un solo dominio: un
ciclo corto no los recorre todos. Por eso cada ciclo consulta una porción acotada, declarada en `porcion_diaria.json`,
ordenada por lo que importa a la persona (`observaciones.orden_de_consulta`): lo pendiente, lo que falló por primera
vez, lo que la persona ve junto a un curso publicado y lleva más de `expuesto_max_dias` sin comprobarse, los programas
que se enlazan sin un curso al lado y llevan más de `ensenado_max_dias` y, por último, el resto por antigüedad. Un día
de la semana (`dia_largo`, del 1, lunes, al 7, domingo) la porción dura `minutos_dia_largo` para que lo nunca
consultado, que no se enseña hasta que responde, no espere meses. El día sale de la fecha del ciclo; la porción solo
cambia cuánto trabajo se hace, no qué se oculta ni qué se enseña.

Las fichas de los cursos del SOC se piden en una muestra pequeña y rotatoria (`fichas_por_ciclo`): la página responde
lo mismo para cualquier código, así que su código HTTP solo sirve para ver si el sitio sigue en pie o ha cambiado de
dirección. Si un curso sigue en la oferta lo decide el censo del SOC.
"""

from collections import Counter
from collections.abc import Iterable
from datetime import datetime, timedelta
from pathlib import Path
from typing import Final, NamedTuple
from urllib.parse import urlsplit

from plataforma_datos.comun.entrada_salida import leer_json
from plataforma_datos.comun.nucleo import exigir
from plataforma_datos.cursos.fuentes.enlaces.candidatos import Candidato
from plataforma_datos.cursos.fuentes.enlaces.observaciones import (
    CURSOS,
    NO_EXISTE,
    PROGRAMAS,
    RESPONDE,
    Estado,
    Observacion,
    esta_visible_el_programa,
    orden_de_consulta,
)

CONFIGURACION: Final = Path(__file__).with_name("porcion_diaria.json")
VERSION_DE_LA_CONFIGURACION: Final = 3
TOPES_DE_LA_CONFIGURACION: Final = (
    "max_consultas",
    "plazo_minutos",
    "expuesto_max_dias",
    "ensenado_max_dias",
    "fichas_por_ciclo",
    "anomalia_min_consultas",
    "anomalia_porcentaje",
    "dia_largo",
    "max_consultas_dia_largo",
    "minutos_dia_largo",
)
PORCENTAJE_ENTERO: Final = 100
DIAS_DE_LA_SEMANA: Final = 7


class Porcion(NamedTuple):
    """Los topes de un ciclo, tal como se declaran, con el plazo ya en segundos."""

    max_consultas: int
    plazo_s: float
    expuesto_max_dias: int
    ensenado_max_dias: int
    fichas_por_ciclo: int
    anomalia_min_consultas: int
    anomalia_porcentaje: int
    dia_largo: int
    max_consultas_dia_largo: int
    plazo_s_dia_largo: float


def leer_porcion(ruta: Path = CONFIGURACION) -> Porcion:
    """Los topes de la porción diaria, tal como los declara la configuración de la fuente.

    Returns:
        Los topes del ciclo.

    Raises:
        FormatoInesperado: Si a la configuración le falta o le sobra un campo, o un tope no es un entero positivo.
    """
    datos = leer_json(ruta)
    exigir(
        isinstance(datos, dict)
        and set(datos) == {"version", *TOPES_DE_LA_CONFIGURACION}
        and datos["version"] == VERSION_DE_LA_CONFIGURACION,
        f"enlaces: {ruta.name} debe traer su versión y sus topes: {', '.join(TOPES_DE_LA_CONFIGURACION)}",
    )
    topes = [datos[campo] for campo in TOPES_DE_LA_CONFIGURACION]  # type: ignore[index]
    exigir(all(type(tope) is int and tope >= 1 for tope in topes), f"enlaces: los topes de {ruta.name} son enteros")
    leidos = dict(zip(TOPES_DE_LA_CONFIGURACION, topes, strict=True))
    exigir(leidos["anomalia_porcentaje"] <= PORCENTAJE_ENTERO, f"enlaces: el porcentaje de {ruta.name} no pasa de 100")
    exigir(leidos["dia_largo"] <= DIAS_DE_LA_SEMANA, f"enlaces: el día largo de {ruta.name} va del 1 (lunes) al 7")
    return Porcion(
        max_consultas=leidos["max_consultas"],
        plazo_s=leidos["plazo_minutos"] * 60.0,
        expuesto_max_dias=leidos["expuesto_max_dias"],
        ensenado_max_dias=leidos["ensenado_max_dias"],
        fichas_por_ciclo=leidos["fichas_por_ciclo"],
        anomalia_min_consultas=leidos["anomalia_min_consultas"],
        anomalia_porcentaje=leidos["anomalia_porcentaje"],
        dia_largo=leidos["dia_largo"],
        max_consultas_dia_largo=leidos["max_consultas_dia_largo"],
        plazo_s_dia_largo=leidos["minutos_dia_largo"] * 60.0,
    )


def es_dia_largo(porcion: Porcion, hoy: datetime) -> bool:
    """Si la fecha del ciclo cae en el día de la semana de la pasada larga.

    Returns:
        True el día declarado en `dia_largo`.
    """
    return hoy.isoweekday() == porcion.dia_largo


def topes_del_dia(porcion: Porcion, hoy: datetime) -> tuple[int, float]:
    """El tope de consultas y el plazo, en segundos, que corresponden a la fecha del ciclo.

    Returns:
        Los topes largos el día de la pasada larga; los cortos, el resto.
    """
    if es_dia_largo(porcion, hoy):
        return porcion.max_consultas_dia_largo, porcion.plazo_s_dia_largo
    return porcion.max_consultas, porcion.plazo_s


def _dominio(url: str) -> str:
    return urlsplit(url).hostname or ""


def _vencido(estado: Estado | None, limite: datetime) -> bool:
    """Si la última consulta de un enlace es anterior al límite.

    Returns:
        True también si el enlace nunca se ha consultado.
    """
    ultima = None if estado is None else estado["ultima"] or estado["concluyente"]
    return ultima is None or datetime.fromisoformat(ultima["observado_el"]) < limite


class OrdenDelCiclo(NamedTuple):
    """Lo que consulta un ciclo, en orden, y lo que queda fuera de la muestra de fichas."""

    por_consultar: list[Candidato]
    fichas_fuera_de_la_muestra: int


def _vencimientos(
    candidato: Candidato,
    guardado: Estado | None,
    expuestos: frozenset[tuple[str, str]],
    hoy: datetime,
    porcion: Porcion,
) -> tuple[bool, bool]:
    """Si un enlace expuesto o un programa enseñado sin curso pasan de su antigüedad máxima.

    Returns:
        (expuesto y vencido, enseñado sin curso y vencido).
    """
    if (candidato.conjunto, candidato.url) in expuestos:
        return _vencido(guardado, hoy - timedelta(days=porcion.expuesto_max_dias)), False
    if candidato.conjunto == PROGRAMAS and esta_visible_el_programa(guardado):
        return False, _vencido(guardado, hoy - timedelta(days=porcion.ensenado_max_dias))
    return False, False


def orden_de_la_porcion(
    candidatos: Iterable[Candidato],
    estado: dict[str, dict[str, Estado]],
    expuestos: frozenset[tuple[str, str]],
    hoy: datetime,
    porcion: Porcion,
) -> OrdenDelCiclo:
    """Los enlaces del ciclo en el orden en que se consultan, sin repetir una dirección dentro de su conjunto.

    Dos cursos pueden enseñar la misma ficha: la dirección se consulta, y se cuenta, una vez por conjunto. De las fichas
    solo entran las `fichas_por_ciclo` primeras de ese orden, que rotan por antigüedad.

    Args:
        candidatos: Los enlaces que Faro enseña hoy.
        estado: Las observaciones guardadas.
        expuestos: Los (conjunto, dirección) que la persona ve hoy junto a un curso publicado.
        hoy: El instante del ciclo, en UTC.
        porcion: Los topes del ciclo.

    Returns:
        Los candidatos por prioridad y cuántas fichas esperan a otro ciclo. El orden depende solo de las direcciones,
        su estado, lo expuesto y el instante.
    """

    def clave(c: Candidato) -> tuple[int, str, int, str]:
        guardado = estado[c.conjunto].get(c.url)
        expuesto, ensenado = _vencimientos(c, guardado, expuestos, hoy, porcion)
        return orden_de_consulta(c.url, guardado, c.conjunto, expuesto_vencido=expuesto, ensenado_vencido=ensenado)

    ordenados = sorted({(c.conjunto, c.url): c for c in candidatos}.values(), key=clave)
    fichas = [c for c in ordenados if c.conjunto == CURSOS]
    fuera = {c.url for c in fichas[porcion.fichas_por_ciclo :]}
    por_consultar = [c for c in ordenados if not (c.conjunto == CURSOS and c.url in fuera)]
    return OrdenDelCiclo(por_consultar, len(fuera))


def vencimientos_tras_el_ciclo(
    candidatos: Iterable[Candidato],
    estado: dict[str, dict[str, Estado]],
    expuestos: frozenset[tuple[str, str]],
    hoy: datetime,
    porcion: Porcion,
) -> dict[str, int]:
    """Cuánto hay en los dos niveles con plazo y cuánto pasa, tras el ciclo, de su antigüedad máxima.

    Returns:
        `expuestos` y `expuestos_vencidos`, `ensenados` (programas enlazados sin un curso al lado) y
        `ensenados_vencidos`. Un vencido distinto de cero dice que ese nivel no cupo en la porción.
    """
    unicos = {(c.conjunto, c.url): c for c in candidatos}.values()
    cuenta = Counter[str]()
    for c in unicos:
        guardado = estado[c.conjunto].get(c.url)
        expuesto, ensenado = _vencimientos(c, guardado, expuestos, hoy, porcion)
        if (c.conjunto, c.url) in expuestos:
            cuenta["expuestos"] += 1
            cuenta["expuestos_vencidos"] += expuesto
        elif c.conjunto == PROGRAMAS and esta_visible_el_programa(guardado):
            cuenta["ensenados"] += 1
            cuenta["ensenados_vencidos"] += ensenado
    return {campo: cuenta[campo] for campo in ("expuestos", "expuestos_vencidos", "ensenados", "ensenados_vencidos")}


def dominios_con_anomalia(
    consultas: Iterable[tuple[str, Estado | None, Observacion]], porcion: Porcion
) -> frozenset[str]:
    """Los dominios en los que esta porción vería desaparecer de golpe una parte desproporcionada de lo que se enseña.

    Un sitio que cambia de carpeta o que responde 404 a todo da cientos de 404 en una mañana: es una señal del dominio,
    no cientos de enlaces retirados. Cuentan los enlaces que se enseñaban (su última observación concluyente respondía):
    con al menos `anomalia_min_consultas` de ellos consultados en un dominio y un `anomalia_porcentaje` o más con 404 o
    410, el dominio se anota y esos 404 no cambian lo que se enseña. Un enlace que nunca respondió no cuenta: su 404 no
    retira nada.

    Args:
        consultas: Cada dirección consultada en el ciclo, con su estado anterior y su observación nueva.
        porcion: Los topes del ciclo, con el mínimo de consultas y el porcentaje.

    Returns:
        Los dominios con anomalía.
    """
    ensenados, desaparecidos = Counter[str](), Counter[str]()
    for url, antes, nueva in consultas:
        if antes is None or antes["concluyente"] is None or antes["concluyente"]["resultado"] != RESPONDE:
            continue
        ensenados[_dominio(url)] += 1
        desaparecidos[_dominio(url)] += nueva["resultado"] == NO_EXISTE
    return frozenset(
        dominio
        for dominio, total in ensenados.items()
        if total >= porcion.anomalia_min_consultas
        and desaparecidos[dominio] * PORCENTAJE_ENTERO >= porcion.anomalia_porcentaje * total
    )
