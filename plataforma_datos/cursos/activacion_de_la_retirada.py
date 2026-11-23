"""Cuándo la regla de retirada de una fuente deja de correr en sombra y pasa a decidir de verdad, y cuándo vuelve.

Cada fuente empieza en `sombra`: la regla decide, se anota y no retira nada. Pasa a `activa` sola cuando la realidad
le ha dado la razón bastantes veces: decisiones de retirar comprobadas en la página del curso, ninguna contradicha,
repartidas en bastantes ciclos distintos, y con la salud de la lectura ya calibrada con la historia de la fuente.
Vuelve a `sombra` sola en cuanto una retirada aplicada se contradice: el curso reaparece en una lectura sana o su
página sigue viva. Lo que se cuenta son decisiones contrastadas con la realidad, nunca días.

Es una función pura: el estado anterior y lo observado en un ciclo dan el estado siguiente. No lee ni escribe nada.
"""

from dataclasses import dataclass, replace

from plataforma_datos.cursos.tipos_json import ObjetoJson

SOMBRA = "sombra"
ACTIVA = "activa"
ESTADOS = (SOMBRA, ACTIVA)
ACTIVADA = "activada"
VUELTA_A_SOMBRA = "vuelta-a-sombra"
CAMBIOS = (ACTIVADA, VUELTA_A_SOMBRA)


@dataclass(frozen=True, kw_only=True)
class Criterio:
    """Cuánta evidencia hace falta para activar la regla de una fuente."""

    decisiones_minimas: int
    ciclos_minimos: int

    def a_json(self) -> ObjetoJson:
        """Devuelve el criterio tal como se guarda con cada estado.

        Returns:
            El objeto con los dos mínimos.
        """
        return {"decisiones_minimas": self.decisiones_minimas, "ciclos_minimos": self.ciclos_minimos}


# El único sitio donde se fijan:
# - 30 decisiones comprobadas y ninguna contradicha: con 0 errores, es el menor número de casos con el que la cota
#   superior de Jeffreys al 95 % (intervalo_de_jeffreys) baja del 8 % (7,97 %; con 29 casos es del 8,23 % y con 20,
#   del 11,66 %). Por debajo, cero errores no distinguen una regla fiable de una que acierta por suerte. La medida
#   diaria del error (error_de_retirada) sigue vigilando después.
# - 7 ciclos distintos: que la evidencia no venga de un solo día raro de la fuente ni de una sola tanda de bajas; es
#   el mismo mínimo de observaciones independientes que pide la salud calibrada (calibracion_de_salidas).
CRITERIO = Criterio(decisiones_minimas=30, ciclos_minimos=7)


@dataclass(frozen=True, kw_only=True)
class Ciclo:
    """Lo que se observó de una fuente en un ciclo.

    `confirman` y `contradicen` son las retiradas de la regla cuya página se consultó y dijo que el curso está
    cerrado o no existe, o que sigue abierto. `aplicada_contradicha` dice si alguna retirada aplicada mientras la
    fuente estaba activa reaparece ya en una lectura sana. `salud_con_historia` dice si la salud de las lecturas del
    ciclo ya está calibrada con la historia de la fuente.
    """

    ciclo: str
    confirman: int
    contradicen: int
    aplicada_contradicha: bool
    salud_con_historia: bool


@dataclass(frozen=True, kw_only=True)
class Estado:
    """El modo de la regla de una fuente y la evidencia acumulada desde el último error.

    `cambio` es lo que pasó en el último ciclo (activada, vuelta a sombra o nada) y `decisiones` las comprobadas que
    sostienen el estado: son las que dice el aviso del panel.
    """

    estado: str = SOMBRA
    confirmadas: int = 0
    ciclos: int = 0
    cambio: str | None = None
    ultimo_ciclo: str | None = None

    def __post_init__(self) -> None:
        """Rechaza un estado fuera de su forma.

        Raises:
            ValueError: Si el modo o el cambio no son de la lista o un recuento es negativo.
        """
        if (
            self.estado not in ESTADOS
            or (self.cambio is not None and self.cambio not in CAMBIOS)
            or self.confirmadas < 0
            or self.ciclos < 0
        ):
            raise ValueError("estado de la regla de retirada fuera de su forma")


def puede_activarse(estado: Estado, salud_con_historia: bool, criterio: Criterio = CRITERIO) -> bool:
    """La evidencia acumulada alcanza el criterio y la salud de la fuente ya se calibra con su historia.

    Returns:
        Si la regla de la fuente puede pasar a decidir de verdad.
    """
    return (
        salud_con_historia
        and estado.confirmadas >= criterio.decisiones_minimas
        and estado.ciclos >= criterio.ciclos_minimos
    )


def siguiente(estado: Estado, ciclo: Ciclo, criterio: Criterio = CRITERIO) -> Estado:
    """El estado de la regla tras un ciclo; un ciclo ya contado no cambia nada.

    Un error reinicia la cuenta: con la regla activa, cualquier contradicción (la página de una retirada sigue viva
    o un curso retirado reaparece) la devuelve a sombra; en sombra, una retirada que la página contradice deja la
    cuenta a cero. Sin errores, las confirmaciones se suman y el ciclo cuenta si confirmó alguna.

    Returns:
        El estado siguiente, con el cambio de este ciclo.
    """
    if ciclo.ciclo == estado.ultimo_ciclo:
        return estado
    error = ciclo.contradicen > 0 or ciclo.aplicada_contradicha
    if error:
        cambio = VUELTA_A_SOMBRA if estado.estado == ACTIVA else None
        return Estado(estado=SOMBRA, cambio=cambio, ultimo_ciclo=ciclo.ciclo)
    acumulado = replace(
        estado,
        confirmadas=estado.confirmadas + ciclo.confirman,
        ciclos=estado.ciclos + (ciclo.confirman > 0),
        cambio=None,
        ultimo_ciclo=ciclo.ciclo,
    )
    if acumulado.estado == SOMBRA and puede_activarse(acumulado, ciclo.salud_con_historia, criterio):
        return replace(acumulado, estado=ACTIVA, cambio=ACTIVADA)
    return acumulado
