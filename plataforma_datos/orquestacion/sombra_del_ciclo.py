"""El paso del ciclo que aplica en sombra la regla de retirada a las lecturas que las fuentes emitieron en él.

Antes de que lea ninguna fuente se toma una foto de lo publicado: las lecturas guardadas de cada fuente y las unidades
publicadas, las del catálogo de cursos servido y las del paquete de datos. Cuando el ciclo ya publicó el paquete, cada
ámbito con una lectura que no estaba en la foto se decide con `decisiones_en_sombra`, y lo publicado de antes y de
después dice qué retiró producción. Un ámbito sin lectura nueva, que no publica unidades propias o de una fuente sin
versión admitida se salta, diciéndolo.

Es telemetría: nunca detiene ni cambia el ciclo. `en_sombra` es la frontera: cualquier error de la sombra, también uno
inesperado, se anota con su tipo y el ciclo empieza, termina y devuelve lo mismo que sin ella. Las notas quedan en las
ejecuciones del ciclo (`notas_de_la_sombra`), de donde el supervisor las pasa a su diario, y se escriben también en la
salida del ciclo. Un ensayo no decide nada, porque no conserva lo que lee.

La decisión tiene su propio tope (`TOPE_DE_LA_DECISION_S`): pasado, los ámbitos que faltan se saltan con el motivo
«sin-tiempo» y el ciclo sigue. Se mira antes de cada ámbito, porque un ámbito no se puede cortar a medias sin dejar su
registro de decisiones a medio escribir. La consulta de páginas tampoco empieza una petición que la hora límite del
motor (`hora_limite_del_motor`) cortaría: lo que ya no cabe queda sin comprobar con el motivo «sin-tiempo».
"""

from collections.abc import Callable, Iterable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

from plataforma_datos.comun.nucleo import DATOS_RELATIVOS, ErrorFuente
from plataforma_datos.cursos.altas_en_sombra import ALTAS
from plataforma_datos.cursos.catalogo_servido import fichas_servidas
from plataforma_datos.cursos.comprobacion_pagina.consulta_de_retirados import PARAMETROS, Ficha
from plataforma_datos.cursos.decisiones_en_sombra import Alta, decidir_lectura
from plataforma_datos.cursos.lecturas.almacen_lecturas import listar_lecturas
from plataforma_datos.cursos.paquete_servido import Publicado, publicado
from plataforma_datos.cursos.tipos_json import ObjetoJson
from plataforma_datos.orquestacion import notas_de_la_sombra
from plataforma_datos.orquestacion.activacion_en_el_ciclo import Transporte, actualizar_fuente, transporte_real
from plataforma_datos.orquestacion.formas_del_diario import tipo_de_error
from plataforma_datos.orquestacion.hora_limite_del_motor import MARGEN, segundos_hasta_la_hora_limite
from plataforma_datos.orquestacion.modulos import FUENTES_CATALOGO
from plataforma_datos.orquestacion.notas_de_la_sombra import SIN_TIEMPO, Nota

# Los errores de los datos, del disco y de la lectura conservada de una fuente: se anotan y se sigue con las demás.
ERRORES_DE_LA_SOMBRA = (OSError, ValueError, ErrorFuente)
# Lo que puede tardar la decisión en sombra de todos los ámbitos: es telemetría, y el plazo del motor es del ciclo.
TOPE_DE_LA_DECISION_S = 300
# Lo que la consulta de páginas necesita antes de la hora límite del motor: su tope, con el margen que pide el paquete.
# Si no queda, no empieza ninguna petición, porque el corte del motor la dejaría a medias y sin anotar.
RESERVA_DE_LA_CONSULTA_S = round(PARAMETROS.tope_s * MARGEN)


@dataclass(frozen=True, kw_only=True)
class Foto:
    """Lo publicado antes de la ronda: las lecturas guardadas por fuente, las unidades y la página de cada una.

    La página de un curso que el ciclo deja de servir solo está en la foto.
    """

    lecturas: dict[str, frozenset[str] | None]
    servidas: Publicado | None
    fichas: dict[str, Ficha] | None = None


def _anotar(notas: list[Nota], nota: Nota) -> None:
    notas.append(nota)
    detalle = ", ".join(f"{k}={v}" for k, v in vars(nota).items() if v is not None and k != "estado")
    print(f"Retirada en sombra: {nota.estado} ({detalle})")


def foto(raiz: Path, altas: Iterable[Alta] = ALTAS) -> Foto:
    """Toma la foto de lo publicado antes de la ronda; lo que no se puede leer queda sin foto y se dice después.

    Returns:
        Las lecturas guardadas por fuente y lo publicado (`None` lo que no se pudo leer).
    """
    lecturas: dict[str, frozenset[str] | None] = {}
    for fuente in dict.fromkeys(alta.fuente for alta in altas):
        try:
            lecturas[fuente] = frozenset(x["lectura_id"] for x in listar_lecturas(raiz, fuente))
        except ERRORES_DE_LA_SOMBRA:
            lecturas[fuente] = None
    try:
        servidas, fichas = publicado(raiz), fichas_servidas(raiz)
    except ERRORES_DE_LA_SOMBRA:
        servidas, fichas = None, None
    return Foto(lecturas=lecturas, servidas=servidas, fichas=fichas)


def fin_de_la_consulta(ahora: float, quedan: float | None) -> float:
    """El instante, en el reloj del transporte, a partir del cual la consulta de páginas no empieza ninguna petición.

    Args:
        ahora: El reloj del transporte al empezar la consulta.
        quedan: Los segundos hasta la hora límite del motor, o `None` si no la hay.

    Returns:
        El final de su tope o, si llega antes, el último momento que aún deja su reserva antes de la hora límite.
    """
    fin = ahora + PARAMETROS.tope_s
    return fin if quedan is None else min(fin, ahora + quedan - RESERVA_DE_LA_CONSULTA_S)


def _sin_version_admitida(raiz: Path, fuente: str) -> bool:
    """Una fuente del catálogo aún sin versión admitida: su carpeta validada solo puede guardar sus lecturas.

    Returns:
        Si es así; la generación no admitiría otros archivos en ella (`generacion_operativa._admitidos`).
    """
    validacion = raiz / DATOS_RELATIVOS / "validados" / fuente / "validacion.json"
    return fuente in FUENTES_CATALOGO and not validacion.exists()


def _decidir_ambito(raiz: Path, alta: Alta, antes: Foto, servidas: Publicado, notas: list[Nota]) -> ObjetoJson | None:
    guardadas = antes.lecturas.get(alta.fuente)
    if guardadas is None or antes.servidas is None:
        _anotar(notas, Nota(estado="saltada", ambito=alta.ambito, motivo="sin-foto"))
        return None
    lecturas = listar_lecturas(raiz, alta.fuente)
    nuevas = [x for x in lecturas if x["ambito"] == alta.ambito and x["lectura_id"] not in guardadas]
    motivo = (
        "no-publica"
        if not alta.publica
        else "sin-lectura-nueva"
        if not nuevas
        else "sin-version-admitida"
        if _sin_version_admitida(raiz, alta.fuente)
        else None
    )
    if motivo is not None:
        _anotar(notas, Nota(estado="saltada", ambito=alta.ambito, motivo=motivo))
        return None
    comparacion = decidir_lectura(raiz, alta, nuevas[-1], lecturas, (antes.servidas, servidas))
    _anotar(
        notas,
        Nota(
            estado="decidida",
            ambito=alta.ambito,
            produccion_retira=comparacion["produccion_retira"],
            solo_la_regla_retira=comparacion["la_regla_retira_y_produccion_mantiene"],
        ),
    )
    return nuevas[-1]


def _activar_por_evidencia(
    raiz: Path,
    decididas: dict[str, list[ObjetoJson]],
    fichas: dict[str, Ficha],
    transporte: Transporte,
    quedan: float | None,
) -> list[Nota]:
    """Contrasta con la realidad las retiradas de cada fuente decidida y deja su modo; una fuente no toca a otra.

    El tope de la consulta de páginas es uno para todo el ciclo y no pasa de la hora límite del motor menos su reserva
    (`fin_de_la_consulta`, con `quedan` los segundos hasta ella): lo que no cabe queda sin comprobar y se dice.

    Returns:
        Las notas de cada fuente: lo que dijo la página, el cambio de modo o el problema que lo impidió.
    """
    notas: list[Nota] = []
    hasta = fin_de_la_consulta(transporte.reloj(), quedan)
    for fuente, lecturas in decididas.items():
        try:
            for nota in actualizar_fuente(raiz, fuente, lecturas, fichas=fichas, transporte=transporte, hasta=hasta):
                _anotar(notas, nota)
        except ERRORES_DE_LA_SOMBRA as error:
            _anotar(notas, Nota(estado="problema", fuente=fuente, motivo="fallo", tipo=tipo_de_error(error)))
    return notas


def decidir_en_sombra(  # noqa: PLR0913 - Los relojes, los topes y la hora límite llegan como dato para probarlos.
    raiz: Path,
    antes: Foto,
    altas: Iterable[Alta] = ALTAS,
    transporte: Transporte | None = None,
    *,
    tope_s: float = TOPE_DE_LA_DECISION_S,
    hora_limite: Callable[[], float | None] = segundos_hasta_la_hora_limite,
) -> list[Nota]:
    """Decide en sombra cada ámbito con lectura nueva desde la foto y contrasta sus retiradas con la realidad.

    Un ámbito que falla no detiene a los demás, y uno que empezaría pasado el tope se salta con el motivo
    «sin-tiempo». Después, cada fuente con algún ámbito decidido consulta la página de una muestra de sus retiradas y
    actualiza el modo de su regla (`activacion_en_el_ciclo`). El reloj de los dos topes es el del transporte;
    `hora_limite` dice cuántos segundos quedan hasta la hora límite del motor, que acota la consulta de páginas.

    Returns:
        Lo que se anotó de cada ámbito y de cada fuente: decidido, saltado, comprobado, el cambio de modo o el
        problema que lo impidió.
    """
    notas: list[Nota] = []
    transporte = transporte or transporte_real()
    reloj = transporte.reloj
    hasta = reloj() + tope_s
    servidas = publicado(raiz)
    fichas = {**(antes.fichas or {}), **fichas_servidas(raiz)}
    decididas: dict[str, list[ObjetoJson]] = {}
    for alta in altas:
        if reloj() >= hasta:
            _anotar(notas, Nota(estado="saltada", ambito=alta.ambito, motivo=SIN_TIEMPO))
            continue
        try:
            lectura = _decidir_ambito(raiz, alta, antes, servidas, notas)
        except ERRORES_DE_LA_SOMBRA as error:
            _anotar(notas, Nota(estado="problema", ambito=alta.ambito, motivo="fallo", tipo=tipo_de_error(error)))
            continue
        if lectura is not None:
            decididas.setdefault(alta.fuente, []).append(lectura)
    return notas + _activar_por_evidencia(raiz, decididas, fichas, transporte, hora_limite())


def _en_la_frontera[T](paso: Callable[[], T], notas: list[Nota]) -> T | None:
    """Ejecuta un paso de la sombra sin que nada de lo que falle salga de ella.

    Aquí, y solo aquí, se recoge cualquier error: la sombra es telemetría y no puede cambiar el ciclo. No se esconde:
    queda anotado con su tipo, que `tipo_de_error` nombra siempre con la forma de la nota: un nombre de clase fuera de
    esa forma no puede hacer fallar la nota dentro de la propia frontera.

    Returns:
        Lo que devuelve el paso, o `None` si falló.
    """
    try:
        return paso()
    # La frontera de la telemetría: cualquier error se anota con su tipo y el ciclo sigue.
    except Exception as error:
        _anotar(notas, Nota(estado="problema", motivo="fallo", tipo=tipo_de_error(error)))
        return None


def _guardar_notas(raiz: Path, notas: list[Nota]) -> None:
    _en_la_frontera(lambda: notas_de_la_sombra.guardar(raiz, notas), [])


@contextmanager
def en_sombra(raiz: Path, *, ensayo: bool) -> Iterator[None]:
    """Envuelve un ciclo: foto antes de que lea ninguna fuente y decisión en sombra cuando ya publicó el paquete.

    Solo decide si el ciclo termina: uno que se corta no deja lecturas que decidir con lo publicado a medias, y lo dice
    con la nota «ciclo-cortado»; su excepción es del ciclo y sigue su camino. Nada de lo que falle en la sombra sale de
    aquí.
    """
    if ensayo:
        yield
        return
    notas: list[Nota] = []
    antes = _en_la_frontera(lambda: foto(raiz), notas)
    _guardar_notas(raiz, [*notas, Nota(estado=notas_de_la_sombra.EN_CURSO)])
    try:
        yield
    except BaseException:
        _guardar_notas(raiz, [*notas, Nota(**notas_de_la_sombra.CICLO_CORTADO)])
        raise
    if antes is not None:
        notas += _en_la_frontera(lambda: decidir_en_sombra(raiz, antes), notas) or []
    _guardar_notas(raiz, notas)
