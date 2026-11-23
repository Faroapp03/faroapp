"""La pieza común con la que cada fuente emite la lectura de su censo: la calcula, la califica y la guarda.

Una fuente solo aporta lo que sabe tras leer su censo (`Censo`). La emisión busca en el almacén la lectura anterior del
mismo ámbito y la referencia (la última sana o aceptada por una persona), calcula qué cursos entran y salen, pide a la
regla de salud el veredicto y guarda la lectura. Es determinista: sin reloj ni red, la hora llega en el censo.

Lo que cuenta es que la lectura de hoy no se pierda, también la de un día malo. Si el almacén no se puede leer o la
cadena no cuadra, la lectura se guarda como primera de una cadena nueva y el resultado dice por qué.
"""

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from plataforma_datos.cursos.lecturas.aceptaciones import ErrorAceptacion, listar_aceptaciones
from plataforma_datos.cursos.lecturas.almacen_lecturas import guardar_lectura, listar_lecturas
from plataforma_datos.cursos.lecturas.cadena import CadenaRota, censo_de, referencia
from plataforma_datos.cursos.lecturas.contrato_lectura import (
    ErrorLectura,
    HuellaForma,
    Salida,
    ValorNuevo,
    huella_de_campos,
    huella_de_ids,
)
from plataforma_datos.cursos.lecturas.salud import Observacion, Veredicto, calificar
from plataforma_datos.cursos.tipos_json import ObjetoJson


class ErrorEmision(ValueError):
    """La lectura no se puede emitir sin contradecir las que ya están guardadas."""


@dataclass(frozen=True, kw_only=True)
class Censo:
    """Lo que una fuente sabe tras leer su censo, tal como lo calcula su adquisición.

    `explicar_salida` recibe el identificador de un curso que estaba en la lectura anterior y ya no está, y devuelve
    `"fin_publicado"`, `"fuente_declara_baja"` o `None` si nada lo explica.
    """

    fuente: str
    ambito: str
    observado_utc: str
    completa: bool
    motivo_incompleta: str | None = None
    ids: frozenset[str]
    recuento_bruto: int
    recuento_vigente: int
    total_declarado: int | None = None
    niveles: tuple[str, ...] = ()
    rutas_de_campos: tuple[str, ...]
    valores_nuevos: tuple[ValorNuevo, ...] = ()
    explicar_salida: Callable[[str], str | None]


@dataclass(frozen=True, kw_only=True)
class Emision:
    """La lectura emitida, dónde quedó guardada y lo que impidió compararla con su historia, si algo lo impidió."""

    lectura: ObjetoJson
    ruta: Path
    problemas: tuple[str, ...]


@dataclass(frozen=True, kw_only=True)
class _Historia:
    """Lo que el almacén dice del ámbito antes de la lectura nueva."""

    todas: list[ObjetoJson]
    previas: list[ObjetoJson]
    censo_anterior: frozenset[str]
    aceptadas: set[str]


def _lecturas(raiz: Path, censo: Censo, problemas: list[str]) -> list[ObjetoJson]:
    try:
        return listar_lecturas(raiz, censo.fuente)
    except ErrorLectura as error:
        problemas.append(f"el almacén de lecturas no se puede leer ({error}); esta lectura empieza una cadena nueva")
        return []


def _aceptadas(raiz: Path, censo: Censo, problemas: list[str]) -> set[str]:
    """Las lecturas del ámbito aceptadas antes de la observación: una aceptación posterior no cambia el pasado.

    Returns:
        Los identificadores de las lecturas aceptadas; vacío si las aceptaciones no se pueden leer.
    """
    try:
        aceptaciones = listar_aceptaciones(raiz, censo.fuente)
    except (ErrorAceptacion, ErrorLectura) as error:
        problemas.append(f"las aceptaciones no se pueden leer ({error}); la referencia es la última lectura sana")
        return set()
    return {
        a["lectura_id"] for a in aceptaciones if a["ambito"] == censo.ambito and a["aceptada_utc"] < censo.observado_utc
    }


def _historia(raiz: Path, censo: Censo, problemas: list[str]) -> _Historia:
    todas = _lecturas(raiz, censo, problemas)
    previas = [otra for otra in todas if otra["ambito"] == censo.ambito and otra["observado_utc"] < censo.observado_utc]
    censo_anterior: frozenset[str] = frozenset()
    if previas:
        try:
            censo_anterior = censo_de(previas[-1], {otra["lectura_id"]: otra for otra in todas})
        except CadenaRota as error:
            problemas.append(f"la cadena de {censo.ambito} no se puede rehacer ({error}); empieza una cadena nueva")
            previas = []
    return _Historia(
        todas=todas, previas=previas, censo_anterior=censo_anterior, aceptadas=_aceptadas(raiz, censo, problemas)
    )


def _observacion(censo: Censo, historia: _Historia) -> Observacion:
    presentes = frozenset(censo.ids)
    salen = sorted(historia.censo_anterior - presentes)
    return Observacion(
        fuente=censo.fuente,
        ambito=censo.ambito,
        anterior=historia.previas[-1]["lectura_id"] if historia.previas else None,
        observado_utc=censo.observado_utc,
        completa=censo.completa,
        motivo_incompleta=censo.motivo_incompleta,
        recuento_bruto=censo.recuento_bruto,
        recuento_vigente=censo.recuento_vigente,
        total_declarado=censo.total_declarado,
        ids_sha256=huella_de_ids(presentes),
        entradas=tuple(sorted(presentes - historia.censo_anterior)),
        salidas=tuple(Salida(id=curso, explicada_por=censo.explicar_salida(curso)) for curso in salen),
        huella_forma=HuellaForma(
            campos_sha256=huella_de_campos(censo.rutas_de_campos),
            niveles=censo.niveles,
            valores_nuevos=censo.valores_nuevos,
        ),
    )


def _veredicto(observacion: Observacion, historia: _Historia) -> Veredicto:
    """Califica con la referencia y las lecturas previas del ámbito, diciendo si la referencia fue aceptada.

    De las lecturas previas la regla saca cuántas salidas sin explicar son normales en el ámbito.

    Returns:
        El veredicto de la regla de salud.
    """
    elegida = referencia(historia.previas, historia.aceptadas)
    aceptada = elegida is not None and elegida["lectura_id"] in historia.aceptadas
    return calificar(observacion, elegida, aceptada=aceptada, previas=historia.previas)


def _exigir_orden(lectura: ObjetoJson, historia: _Historia) -> None:
    """Las lecturas de un ámbito se emiten en orden: otra igual de reciente o posterior partiría la cadena.

    Raises:
        ErrorEmision: Si ya hay otra lectura del ámbito igual de reciente o posterior.
    """
    posteriores = [
        otra["lectura_id"]
        for otra in historia.todas
        if otra["ambito"] == lectura["ambito"]
        and otra["observado_utc"] >= lectura["observado_utc"]
        and otra["lectura_id"] != lectura["lectura_id"]
    ]
    if posteriores:
        raise ErrorEmision(
            f"ya hay una lectura de {lectura['ambito']} igual de reciente o posterior ({posteriores[0]}); "
            "las lecturas de un ámbito se emiten en orden"
        )


def emitir_lectura(raiz: Path, censo: Censo) -> Emision:
    """Calcula, califica y guarda la lectura de un censo en el almacén de su fuente bajo `raiz`.

    Emitir dos veces el mismo censo no cambia nada: da la misma lectura y el mismo archivo.

    Returns:
        La lectura guardada, su ruta y los problemas que obligaron a empezar una cadena nueva o a prescindir de las
        aceptaciones (vacío si ninguno).

    Raises:
        ErrorEmision: Si ya hay una lectura del mismo ámbito igual de reciente o posterior y distinta.
        ErrorLectura: Si el censo no da una lectura válida según el contrato.
    """
    problemas: list[str] = []
    historia = _historia(raiz, censo, problemas)
    observacion = _observacion(censo, historia)
    lectura = observacion.lectura(_veredicto(observacion, historia))
    dato = lectura.a_json()
    _exigir_orden(dato, historia)
    return Emision(lectura=dato, ruta=guardar_lectura(raiz, lectura), problemas=tuple(problemas))
