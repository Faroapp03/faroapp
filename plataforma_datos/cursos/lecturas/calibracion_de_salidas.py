"""Cuántas salidas sin explicar admite una lectura, según la historia de su propia fuente.

Lo normal en una fuente lo dice su historia: el SOC pierde cada día unos cursos de su lista sin publicar por qué y una
fuente que nunca pierde cursos no. Con las salidas confirmadas y su exposición (historia_de_salidas.py), la cota
superior de Jeffreys da el ritmo más alto creíble; con él y la exposición de esta lectura, el límite es el recuento que
solo se superaría con la probabilidad de falsa alarma declarada. Por encima, la lectura es anómala.

Con poca historia vale el suelo (el umbral fijo de la regla); y la historia nunca sube el límite por encima del techo,
una fracción del bruto, para que una degradación lenta y sostenida no se normalice sola. Todo lo que decide el límite
queda en la calibración que se guarda con la lectura, para que cualquiera pueda rehacer la cuenta.
"""

from dataclasses import dataclass

from plataforma_datos.cursos.lecturas.historia_de_salidas import HistoriaDeSalidas
from plataforma_datos.cursos.tasa_de_poisson import (
    cota_superior_de_la_dispersion,
    cota_superior_de_la_tasa,
    limite_de_poisson,
)
from plataforma_datos.cursos.tipos_json import ObjetoJson

SEGUNDOS_POR_DIA = 86_400
PORCENTAJE_ENTERO = 100


@dataclass(frozen=True, kw_only=True)
class ParametrosDeCalibracion:
    """Los parámetros de la calibración; entran en la huella de la regla, así que cambiarlos es cambiar de regla."""

    probabilidad_de_falsa_alarma: float
    nivel_de_la_cota: float
    lecturas_minimas: int
    dias_minimos: int
    techo_del_bruto: int

    def a_json(self) -> ObjetoJson:
        """Devuelve los parámetros tal como entran en la huella de la regla.

        Returns:
            El objeto con los cinco parámetros.
        """
        return {
            "probabilidad_de_falsa_alarma": self.probabilidad_de_falsa_alarma,
            "nivel_de_la_cota": self.nivel_de_la_cota,
            "lecturas_minimas": self.lecturas_minimas,
            "dias_minimos": self.dias_minimos,
            "techo_del_bruto": self.techo_del_bruto,
        }


# El único sitio donde se fijan. Su porqué está en la guía de las lecturas (README.md, «El límite según la historia»):
# - 1 entre 1.000: con unas 12 lecturas diarias entre todas las fuentes, unas 4 falsas alarmas al año en total.
# - 0,975: el extremo alto del intervalo de Jeffreys al 95 %, el mismo nivel que el resto de cotas de la plataforma;
#   vale para la cota del ritmo y para la de la dispersión.
# - 7 lecturas juzgadas y 7 días: al menos una semana entera, el ciclo con que publican las fuentes (días laborables y
#   fin de semana), y varias observaciones independientes; es un supuesto, no una medida.
# - 8 % del bruto de la lectura anterior: por encima del límite diario de Poisson que darían los ritmos más altos
#   estimados (el Consorci, un 1,6 % por curso y día, da un 6,0 % de un censo de 168; el SOC, un 1,7 %, un 4,6 % de 453)
#   y por debajo del 10 %, una caída que así se detecta siempre.
PARAMETROS = ParametrosDeCalibracion(
    probabilidad_de_falsa_alarma=0.001,
    nivel_de_la_cota=0.975,
    lecturas_minimas=7,
    dias_minimos=7,
    techo_del_bruto=8,
)


@dataclass(frozen=True, kw_only=True)
class Calibracion:
    """El límite aplicado a una lectura, de dónde salió y la historia que lo sostiene."""

    limite: int
    origen: str
    sin_explicar: int
    suelo: int
    techo: int
    historia: HistoriaDeSalidas
    exposicion: int
    ritmo: float | None = None
    dispersion: float | None = None
    cota: float | None = None
    esperadas: float | None = None

    def a_json(self) -> ObjetoJson:
        """Devuelve la calibración tal como se guarda en la lectura; el ritmo y su cota, por curso y día.

        Returns:
            El objeto de la calibración.
        """
        return {
            "limite": self.limite,
            "origen": self.origen,
            "sin_explicar": self.sin_explicar,
            "suelo": self.suelo,
            "techo": self.techo,
            "lecturas_de_historia": self.historia.lecturas,
            "confirmadas": self.historia.confirmadas,
            "desmentidas": self.historia.desmentidas,
            "exposicion_de_historia": self.historia.exposicion,
            "exposicion": self.exposicion,
            "ritmo_por_curso_y_dia": self.ritmo,
            "dispersion": self.dispersion,
            "cota_por_curso_y_dia": self.cota,
            "esperadas_con_la_cota": self.esperadas,
        }


def techo_de(suelo: int, bruto_de_referencia: int, parametros: ParametrosDeCalibracion = PARAMETROS) -> int:
    """El límite más alto que la historia puede dar: el techo del bruto, nunca por debajo del suelo.

    Returns:
        El mayor entre el suelo y el porcentaje de techo del bruto, redondeado hacia arriba.
    """
    # Redondeo hacia arriba con enteros: la misma cifra en cualquier máquina.
    return max(suelo, -(-bruto_de_referencia * parametros.techo_del_bruto // PORCENTAJE_ENTERO))


def historia_suficiente(historia: HistoriaDeSalidas, parametros: ParametrosDeCalibracion = PARAMETROS) -> bool:
    """La historia tiene bastantes lecturas juzgadas y abarca bastantes días para estimar el ritmo.

    Returns:
        Si la historia alcanza los dos mínimos y tiene exposición.
    """
    return (
        historia.lecturas >= parametros.lecturas_minimas
        and historia.segundos >= parametros.dias_minimos * SEGUNDOS_POR_DIA
        and historia.exposicion > 0
    )


def calibrar(
    *,
    sin_explicar: int,
    suelo: int,
    techo: int,
    historia: HistoriaDeSalidas,
    exposicion: int,
) -> Calibracion:
    """El límite de salidas sin explicar de una lectura con esa exposición, según la historia de su ámbito.

    Returns:
        La calibración: el suelo si la historia no basta o la lectura no tiene exposición; si no, el límite con la
        cota del ritmo y la dispersión medida en la historia, recortado al techo.
    """
    comun = {"sin_explicar": sin_explicar, "suelo": suelo, "techo": techo, "historia": historia}
    parametros = PARAMETROS
    if exposicion <= 0 or not historia_suficiente(historia, parametros):
        return Calibracion(limite=suelo, origen="suelo", exposicion=max(exposicion, 0), **comun)
    dispersion = cota_superior_de_la_dispersion(historia.tramos, parametros.nivel_de_la_cota)
    cota = cota_superior_de_la_tasa(historia.confirmadas, historia.exposicion, parametros.nivel_de_la_cota, dispersion)
    esperadas = cota * exposicion
    calibrado = limite_de_poisson(esperadas, parametros.probabilidad_de_falsa_alarma, dispersion)
    return Calibracion(
        limite=min(calibrado, techo),
        origen="techo" if calibrado > techo else "historia",
        exposicion=exposicion,
        ritmo=historia.confirmadas / historia.exposicion * SEGUNDOS_POR_DIA,
        dispersion=dispersion,
        cota=cota * SEGUNDOS_POR_DIA,
        esperadas=esperadas,
        **comun,
    )
