"""El paso del ciclo que contrasta con la realidad las retiradas de la regla y deja el modo de cada fuente.

Cuando la sombra ya decidió las lecturas del ciclo, se toman de cada fuente los cursos que la regla retiraría, se
consulta una muestra de ellos en su página (consulta_de_retirados) o, en las fuentes cuya página no decide, en la API
que lee su descarga (consulta_por_api), y se mide si alguna retirada aplicada con la regla activa reaparece ya en una
lectura sana (error_de_retirada). Con eso, el estado anterior de la fuente da el siguiente
(activacion_de_la_retirada) y se guarda como un registro más del ciclo (estado_de_la_retirada). Cada fuente se trata
por separado: lo que pasa en una no cambia el estado de otra.
"""

import time
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.cursos.activacion_de_la_retirada import ACTIVA, ACTIVADA, CRITERIO, Ciclo, Estado, siguiente
from plataforma_datos.cursos.comprobacion_api.consulta_por_api import comprobar_por_api
from plataforma_datos.cursos.comprobacion_api.consultores import se_comprueba_por_api
from plataforma_datos.cursos.comprobacion_pagina.consulta_de_retirados import (
    CONFIRMA,
    CONTRADICE,
    NO_SE_SABE,
    Consulta,
    Ficha,
    Pedir,
    comprobar_retiradas,
)
from plataforma_datos.cursos.comprobacion_pagina.respuesta import Respuesta
from plataforma_datos.cursos.comprobacion_pagina.transporte import pedir_datos, pedir_pagina
from plataforma_datos.cursos.decisiones_retirada import cargar_registro, ruta_del_registro
from plataforma_datos.cursos.error_de_retirada import medir_error
from plataforma_datos.cursos.estado_de_la_retirada import estado_del_registro, guardar_registro, ultimo_registro
from plataforma_datos.cursos.lecturas.almacen_lecturas import listar_lecturas
from plataforma_datos.cursos.tipos_json import ObjetoJson
from plataforma_datos.orquestacion.notas_de_la_sombra import Nota

# La salud de una lectura está calibrada con la historia de su fuente cuando su límite no es el suelo fijo
# (calibracion_de_salidas: «suelo» es la falta de historia suficiente).
ORIGENES_CON_HISTORIA = ("historia", "techo")


class TransporteSinDatos(RuntimeError):
    """Un transporte que no dice cómo pedir las API de las fuentes y al que se le pidió una."""


def _sin_datos(url: str, _hasta: float) -> Respuesta:
    raise TransporteSinDatos(f"el transporte no pide datos a las API: {url}")


@dataclass(frozen=True, kw_only=True)
class Transporte:
    """Cómo se piden páginas y API, y con qué reloj y qué hora: el real en el ciclo y uno grabado en las pruebas.

    Un transporte que no dice cómo pedir las API no las pide: falla al primer intento, para que uno grabado que solo
    responde páginas nunca salga a la red.
    """

    pedir: Pedir
    reloj: Callable[[], float]
    instante: Callable[[], str]
    pedir_datos: Pedir = _sin_datos


def _instante_utc() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def transporte_real() -> Transporte:
    """El transporte del ciclo: la red con la identidad genérica, el reloj monotónico y la hora UTC al segundo.

    Returns:
        El transporte real, que pide las páginas con el perfil de página y las API con el de datos.
    """
    return Transporte(pedir=pedir_pagina, reloj=time.monotonic, instante=_instante_utc, pedir_datos=pedir_datos)


def salud_con_historia(lecturas: Iterable[ObjetoJson]) -> bool:
    """Si la salud de todas las lecturas del ciclo ya está calibrada con la historia de la fuente.

    Returns:
        Falso si alguna lectura no trae calibración (no es completa) o su límite es aún el suelo.
    """
    origenes = [(lectura.get("calibracion") or {}).get("origen") for lectura in lecturas]
    return bool(origenes) and all(origen in ORIGENES_CON_HISTORIA for origen in origenes)


def _retiradas(raiz: Path, fuente: str, lecturas: Iterable[ObjetoJson]) -> set[str]:
    return {
        decision["curso"]
        for lectura in lecturas
        if ruta_del_registro(raiz, fuente, lectura["lectura_id"]).exists()
        for decision in cargar_registro(raiz, fuente, lectura["lectura_id"])["decisiones"]
        if decision["decision"] == "retirar"
    }


# Si alguna retirada aplicada con la regla activa reaparece en una lectura sana posterior: lo mide error_de_retirada.
def _aplicada_contradicha(raiz: Path, fuente: str, aplicadas: list[str], guardadas: list[ObjetoJson]) -> bool:
    if not aplicadas:
        return False
    registros = [cargar_registro(raiz, fuente, lectura_id) for lectura_id in aplicadas]
    return any(fila["reaparecidas"] > 0 for fila in medir_error(registros, guardadas))


def _registro(
    previo: ObjetoJson | None, fuente: str, lecturas: list[ObjetoJson], antes: Estado, despues: Estado
) -> ObjetoJson:
    observado = max(lectura["observado_utc"] for lectura in lecturas)
    ultimo_cambio = None if previo is None else previo["ultimo_cambio"]
    if despues.cambio is not None:
        decisiones = despues.confirmadas if despues.cambio == ACTIVADA else antes.confirmadas
        ultimo_cambio = {"cambio": despues.cambio, "decisiones": decisiones, "observado_utc": observado}
    return {
        "version": 1,
        "fuente": fuente,
        "numero": 1 if previo is None else previo["numero"] + 1,
        "ciclo": despues.ultimo_ciclo,
        "lecturas": sorted(lectura["lectura_id"] for lectura in lecturas),
        "observado_utc": observado,
        "en_el_ciclo": antes.estado,
        "estado": despues.estado,
        "cambio": despues.cambio,
        "ultimo_cambio": ultimo_cambio,
        "confirmadas": despues.confirmadas,
        "ciclos": despues.ciclos,
        "criterio": CRITERIO.a_json(),
    }


def _consulta_json(consulta: Consulta) -> ObjetoJson:
    return {
        "confirman": consulta.cuenta(CONFIRMA),
        "contradicen": consulta.cuenta(CONTRADICE),
        "no_se_sabe": consulta.cuenta(NO_SE_SABE),
        "sin_comprobar": consulta.sin_comprobar,
        "motivo": consulta.motivo,
    }


def actualizar_fuente(  # noqa: PLR0913 - El ciclo, la fuente y lo que necesita la consulta, explícitos.
    raiz: Path,
    fuente: str,
    lecturas: list[ObjetoJson],
    *,
    fichas: Mapping[str, Ficha],
    transporte: Transporte,
    hasta: float,
) -> list[Nota]:
    """Contrasta las retiradas de la fuente en este ciclo y guarda su estado siguiente.

    `lecturas` son las que la sombra decidió de la fuente en este ciclo. Con la regla activa, las decisiones de este
    ciclo son las aplicadas: se añaden a las que la medida del error vigila hasta que la regla vuelva a sombra.

    Returns:
        Las notas del ciclo: lo que dijo la página o la API y, si lo hubo, el cambio de modo.
    """
    previo = ultimo_registro(raiz, fuente)
    antes = Estado() if previo is None else estado_del_registro(previo)
    aplicadas = [] if previo is None or antes.estado != ACTIVA else list(previo["aplicadas"])
    ids = sorted(lectura["lectura_id"] for lectura in lecturas)
    ciclo_id = sha256_json(ids)
    por_api = se_comprueba_por_api(fuente)
    consulta = (comprobar_por_api if por_api else comprobar_retiradas)(
        fuente,
        _retiradas(raiz, fuente, lecturas),
        fichas,
        semilla=ciclo_id,
        pedir=transporte.pedir_datos if por_api else transporte.pedir,
        reloj=transporte.reloj,
        instante=transporte.instante,
        hasta=hasta,
    )
    contradicha = _aplicada_contradicha(raiz, fuente, aplicadas, listar_lecturas(raiz, fuente))
    ciclo = Ciclo(
        ciclo=ciclo_id,
        confirman=consulta.cuenta(CONFIRMA),
        contradicen=consulta.cuenta(CONTRADICE),
        aplicada_contradicha=contradicha,
        salud_con_historia=salud_con_historia(lecturas),
    )
    despues = siguiente(antes, ciclo)
    if despues is antes:
        return []
    vigiladas = sorted({*aplicadas, *ids}) if antes.estado == ACTIVA else []
    registro = _registro(previo, fuente, lecturas, antes, despues)
    registro |= {
        "aplicadas": vigiladas if despues.estado == ACTIVA else [],
        "consulta": _consulta_json(consulta),
        "comprobaciones": list(consulta.comprobaciones),
        "aplicada_contradicha": contradicha,
        "salud_con_historia": ciclo.salud_con_historia,
    }
    guardar_registro(raiz, registro)
    notas = [Nota(estado="comprobada", fuente=fuente, **_consulta_json(consulta))]
    if despues.cambio is not None:
        decisiones = despues.confirmadas if despues.cambio == ACTIVADA else None
        notas.append(Nota(estado=despues.cambio, fuente=fuente, confirman=decisiones))
    return notas
