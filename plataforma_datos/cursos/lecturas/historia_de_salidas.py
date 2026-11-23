"""Cuántos cursos se van de verdad sin que la fuente diga por qué: lo que enseña la historia de lecturas de un ámbito.

Una salida sin explicar queda confirmada cuando el curso no vuelve en ninguna lectura posterior y hay después al menos
una lectura completa que lo acredita ausente; queda desmentida si el curso reaparece. Las confirmadas son el ritmo
natural de la fuente; las desmentidas son fallos de una lectura y no entran en la cuenta: así una lectura rota no
enseña que romperse es normal.

La exposición se cuenta en cursos por segundo: el tiempo entre una lectura y la anterior por los cursos expuestos, el
mayor de los dos recuentos brutos. Una fuente con el doble de cursos pierde el doble en el mismo tiempo, y dos lecturas
separadas tres días exponen tres veces más que dos separadas uno. Se toma el mayor para que una lectura rota a un lado
del tramo no recorte la exposición: el otro lado sí tenía esos cursos. Es una función pura, sin reloj: el tiempo sale
de la hora de cada lectura.
"""

import calendar
import time
from dataclasses import dataclass

from plataforma_datos.cursos.lecturas.contrato_lectura import FORMATO_INSTANTE
from plataforma_datos.cursos.tipos_json import ObjetoJson

# Para juzgar una salida hace falta una lectura completa antes (la que la ve salir) y otra después (la que la acredita).
COMPLETAS_PARA_JUZGAR = 2


@dataclass(frozen=True, kw_only=True)
class HistoriaDeSalidas:
    """Lo que se sabe de las salidas sin explicar de un ámbito antes de una lectura nueva."""

    lecturas: int = 0
    confirmadas: int = 0
    desmentidas: int = 0
    segundos: int = 0
    exposicion: int = 0
    # Cada lectura juzgada, como sus salidas confirmadas y su exposición: de ahí se mide la dispersión.
    tramos: tuple[tuple[int, int], ...] = ()


def segundos_de(instante: str) -> int:
    """Los segundos de la época de una hora de lectura (`2026-11-18T10:00:00Z`), en UTC y sin reloj.

    Returns:
        Los segundos desde el 1 de enero de 1970 en UTC.
    """
    return calendar.timegm(time.strptime(instante, FORMATO_INSTANTE))


def exposicion_entre(anterior: ObjetoJson, observado_utc: str, recuento_bruto: int) -> int:
    """La exposición de una lectura respecto a la anterior: segundos entre las dos por el mayor de sus dos brutos.

    Returns:
        Los cursos por segundo que estuvieron expuestos a salir.
    """
    expuestos = max(anterior["recuento_bruto"], recuento_bruto)
    return (segundos_de(observado_utc) - segundos_de(anterior["observado_utc"])) * expuestos


def historia_de_salidas(previas: list[ObjetoJson]) -> HistoriaDeSalidas:
    """Cuenta las salidas sin explicar que la historia ya confirma o desmiente, y la exposición que las sostiene.

    Solo se juzgan las salidas de las lecturas que van desde la primera lectura completa hasta la penúltima completa
    (incluidas las incompletas de en medio): las de después aún no tienen una lectura completa posterior que las
    acredite. Un curso que reaparece en cualquier lectura posterior desmiente su salida.

    Args:
        previas: Las lecturas del ámbito anteriores a la nueva, de la más antigua a la más reciente.

    Returns:
        Las lecturas completas juzgadas, las salidas confirmadas y desmentidas, los segundos que abarcan y su
        exposición en cursos por segundo.
    """
    completas = [indice for indice, lectura in enumerate(previas) if lectura["completa"]]
    if len(completas) < COMPLETAS_PARA_JUZGAR:
        return HistoriaDeSalidas()
    primera, ultima_juzgada = completas[0], completas[-2]
    desmentidas = 0
    tramos: list[tuple[int, int]] = []
    reaparecen: set[str] = set()
    # De la más reciente a la más antigua: al llegar a una lectura, `reaparecen` tiene lo que entró después de ella.
    for indice in range(len(previas) - 1, primera, -1):
        lectura = previas[indice]
        if indice <= ultima_juzgada:
            sin_explicar = [salida["id"] for salida in lectura["salidas"] if salida["explicada_por"] is None]
            vuelven = sum(1 for curso in sin_explicar if curso in reaparecen)
            desmentidas += vuelven
            tramos.append(
                (
                    len(sin_explicar) - vuelven,
                    exposicion_entre(previas[indice - 1], lectura["observado_utc"], lectura["recuento_bruto"]),
                )
            )
        reaparecen.update(lectura["entradas"])
    segundos = segundos_de(previas[ultima_juzgada]["observado_utc"]) - segundos_de(previas[primera]["observado_utc"])
    return HistoriaDeSalidas(
        lecturas=len(completas) - 2,
        confirmadas=sum(confirmadas for confirmadas, _ in tramos),
        desmentidas=desmentidas,
        segundos=segundos,
        exposicion=sum(exposicion for _, exposicion in tramos),
        tramos=tuple(reversed(tramos)),
    )
