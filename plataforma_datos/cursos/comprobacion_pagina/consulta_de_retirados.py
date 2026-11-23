"""La comprobación contra la realidad de los cursos que la regla de retirada retiraría en un ciclo.

De cada fuente se consulta una muestra pequeña de esos cursos en su página pública, con el veredicto de página, y se
anota si la página confirma la retirada (cerrado o no existe), la contradice (sigue abierto) o no permite saberlo.
Las consultas son sanas: pocas, una tras otra con la pausa por dominio del transporte común y con la identidad
genérica del producto. Tienen un tope de tiempo propio: lo que no cabe se deja sin comprobar y se dice.

Una fuente cuya página no decide (se pinta con JavaScript igual para cualquier curso, o no tiene reconocedor) no se
consulta aquí: cualquier respuesta saldría «no se sabe» y solo gastaría peticiones. Las que tienen una API que decide
se comprueban por ella, con la misma muestra y el mismo tope (`comprobacion_api.consulta_por_api`). El transporte,
el reloj y la hora llegan como datos, así que las pruebas usan respuestas grabadas.
"""

import hashlib
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from urllib.parse import urlsplit

from plataforma_datos.cursos.comprobacion_pagina.reconocedores import RECONOCEDORES
from plataforma_datos.cursos.comprobacion_pagina.respuesta import Curso, Respuesta
from plataforma_datos.cursos.comprobacion_pagina.sonda import url_de_la_sonda
from plataforma_datos.cursos.comprobacion_pagina.veredicto import comprobar_pagina
from plataforma_datos.cursos.tipos_json import ObjetoJson

CONFIRMA = "confirma"
CONTRADICE = "contradice"
NO_SE_SABE = "no-se-sabe"
# Lo que cada veredicto de página dice de una retirada: solo un cierre o una ficha inexistente la confirman, y solo
# una ficha abierta la contradice. Una página dudosa o que no contestó no prueba nada.
RESULTADO_DEL_VEREDICTO = {
    "cerrado": CONFIRMA,
    "no_existe": CONFIRMA,
    "disponible": CONTRADICE,
    "dudoso": NO_SE_SABE,
    "sin_respuesta": NO_SE_SABE,
}
PAGINA_NO_DECIDE = "pagina-no-decide"
SIN_TIEMPO = "sin-tiempo"

# Pide una dirección sin pasar del instante monotónico dado y devuelve lo observado.
type Pedir = Callable[[str, float], Respuesta]


@dataclass(frozen=True, kw_only=True)
class ParametrosDeLaConsulta:
    """Cuántos cursos se consultan de cada fuente en un ciclo y cuánto tiempo puede durar la consulta entera."""

    muestra_por_fuente: int
    tope_s: float


# El único sitio donde se fijan:
# - 4 cursos por fuente y ciclo: con la pausa de cortesía por dominio y lo que tarda una ficha de Cibernàrium (de 7 a
#   10 s en el piloto del censo de verdad), 4 fichas y la sonda caben en un minuto; y 4 por ciclo reúnen las 30
#   decisiones del criterio de activación en 8 ciclos, por encima de los 7 que pide.
# - 60 s para toda la consulta del ciclo: corre cuando el paquete ya está publicado, y un minuto es poco frente al
#   plazo del motor; lo que no cabe se deja sin comprobar en ese ciclo.
PARAMETROS = ParametrosDeLaConsulta(muestra_por_fuente=4, tope_s=60.0)


@dataclass(frozen=True, kw_only=True)
class Ficha:
    """La página pública con que se publica un curso y su título."""

    url: str
    titulo: str


@dataclass(frozen=True, kw_only=True)
class Consulta:
    """Lo que se comprobó de una fuente en un ciclo: las comprobaciones, cuántas quedaron sin hacer y por qué."""

    comprobaciones: tuple[ObjetoJson, ...] = ()
    sin_comprobar: int = 0
    motivo: str | None = None

    def cuenta(self, resultado: str) -> int:
        """Cuántas comprobaciones dieron ese resultado.

        Returns:
            El recuento de `confirma`, `contradice` o `no-se-sabe`.
        """
        return sum(RESULTADO_DEL_VEREDICTO[c["veredicto"]] == resultado for c in self.comprobaciones)


def la_pagina_decide(fuente: str) -> bool:
    """Si la página de los cursos de la fuente puede confirmar o contradecir una retirada.

    Returns:
        Si la fuente tiene reconocedor y su ficha decide.
    """
    reconocedor = RECONOCEDORES.get(fuente)
    return reconocedor is not None and reconocedor.ficha_decide


def muestra(cursos: Iterable[str], semilla: str, cantidad: int) -> list[str]:
    """Una muestra determinista de los cursos: la misma para la misma semilla, distinta de un ciclo a otro.

    Returns:
        Como mucho `cantidad` cursos, ordenados por la huella de la semilla con su identificador.
    """
    return sorted(set(cursos), key=lambda curso: hashlib.sha256(f"{semilla}|{curso}".encode()).hexdigest())[:cantidad]


def comprobar_retiradas(  # noqa: PLR0913 - Cada dependencia llega como dato para probarla sin red ni reloj.
    fuente: str,
    retiradas: Iterable[str],
    fichas: Mapping[str, Ficha],
    *,
    semilla: str,
    pedir: Pedir,
    reloj: Callable[[], float],
    instante: Callable[[], str],
    hasta: float,
    parametros: ParametrosDeLaConsulta = PARAMETROS,
) -> Consulta:
    """Consulta la página de una muestra de las retiradas de una fuente sin pasar del instante `hasta`.

    `hasta` es el final del tope de la consulta de todo el ciclo, en el reloj monotónico `reloj`, y lo comparten
    todas las fuentes. Se pide una sonda por dominio, la primera vez que hace falta, y después cada ficha. Antes de
    cada petición se mira el reloj: lo que ya no cabe queda sin comprobar con el motivo `sin-tiempo`.

    Returns:
        Las comprobaciones hechas, cuántas retiradas quedaron sin comprobar y el motivo si la consulta se cortó o
        no se hizo.
    """
    pendientes = sorted(set(retiradas))
    if not pendientes:
        return Consulta()
    if not la_pagina_decide(fuente):
        return Consulta(sin_comprobar=len(pendientes), motivo=PAGINA_NO_DECIDE)
    elegidos = muestra((curso for curso in pendientes if curso in fichas), semilla, parametros.muestra_por_fuente)
    sondas: dict[str, Respuesta] = {}
    hechas: list[ObjetoJson] = []
    for curso in elegidos:
        ficha = fichas[curso]
        dominio = urlsplit(ficha.url).netloc
        if dominio not in sondas:
            if reloj() >= hasta:
                break
            sondas[dominio] = pedir(url_de_la_sonda(ficha.url, semilla), hasta)
        if reloj() >= hasta:
            break
        pedido_utc = instante()
        respuesta = pedir(ficha.url, hasta)
        comprobacion = comprobar_pagina(
            Curso(id=curso, fuente=fuente, titulo=ficha.titulo), respuesta, sondas[dominio], pedido_utc=pedido_utc
        )
        hechas.append(comprobacion.a_json())
    cortada = len(hechas) < len(elegidos)
    return Consulta(
        comprobaciones=tuple(hechas),
        sin_comprobar=len(pendientes) - len(hechas),
        motivo=SIN_TIEMPO if cortada else None,
    )
