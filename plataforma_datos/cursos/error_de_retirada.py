"""Medida del error de retirada: cuántos cursos retirados vuelven a aparecer en una lectura sana de su fuente.

Un curso retirado que reaparece en una lectura sana posterior de su fuente es un error de retirada observado: se
retiró algo que seguía disponible. Es un límite inferior del error real. Solo se ven los errores que reaparecen: un
curso retirado por error que la fuente nunca vuelve a listar no cuenta, y tampoco el que se retiró y no tuvo después
una lectura sana en la que mirar.

Una retirada es el momento en que el registro de decisiones dice `retirar` para un curso que no estaba ya retirado: las
decisiones siguientes mientras el curso sigue ausente son la misma retirada. Solo es comprobable si hubo al menos una
lectura sana y completa de su fuente posterior; una lectura anómala, incompleta o reconstruida no es una observación:
ni su presencia ni su ausencia cuentan. Con cero comprobables no hay tasa, y con cero errores tampoco: se da la cota
superior del intervalo de Jeffreys, nunca un 0 %.

La presencia de un curso en cada lectura se rehace siguiendo la cadena de lecturas de su ámbito, con la huella de cada
censo como comprobación. Una lectura cuyo censo no se puede rehacer no se usa y se cuenta aparte, para que se vea.
Es una función pura: no consulta la red, el reloj ni el disco (la lectura del almacén está en
`lectura_error_de_retirada.py`).
"""

from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass

from plataforma_datos.cursos.decisiones_retirada import validar_registro
from plataforma_datos.cursos.intervalo_de_jeffreys import intervalo_de_jeffreys
from plataforma_datos.cursos.lecturas.contrato_lectura import huella_de_ids, validar_lectura
from plataforma_datos.cursos.tipos_json import ObjetoJson

NATURALEZA = "limite_inferior"
# Qué sostuvo la retirada: lo afirma la fuente; el censo y la página a la vez; o varias ausencias sanas sin página.
GRUPOS = ("fuente", "censo_y_pagina", "censo_repetido")


class ErrorDeMedida(ValueError):
    """Las decisiones y las lecturas no son coherentes entre sí: no se mide con datos que se contradicen."""


@dataclass(frozen=True, kw_only=True)
class _Retirada:
    """Una retirada observada: dónde empezó, quién la decidió y si fue comprobable o reapareció."""

    grupo: str
    comprobable: bool
    reaparecida: bool


def _exigir(condicion: object, motivo: str) -> None:
    if not condicion:
        raise ErrorDeMedida(f"error-de-retirada: {motivo}")


def _grupo_de(decision: ObjetoJson) -> str:
    """El grupo que sostiene una retirada: la fuente si la afirma; si no, el censo con la página o el censo repetido.

    Returns:
        Uno de `GRUPOS`.
    """
    grupos = {evidencia["grupo"] for evidencia in decision["evidencias"]}
    if "fuente" in grupos:
        return "fuente"
    return "censo_y_pagina" if "pagina" in grupos else "censo_repetido"


def _censos(cadena: list[ObjetoJson]) -> tuple[list[frozenset[str] | None], int]:
    """El censo de cada lectura de un ámbito, de la más antigua a la más reciente; `None` si no se puede rehacer.

    Una lectura enlaza con la inmediatamente anterior o empieza cadena (`anterior` vacío, y entonces lista todo su
    censo como entradas). Un enlace a otra lectura o una huella que no cuadra dejan esa lectura y las que cuelgan de
    ella sin censo: calcular presencias con un censo equivocado inventaría reapariciones.

    Returns:
        Los censos, en el orden de la cadena, y cuántas lecturas se quedaron sin censo.
    """
    censos: list[frozenset[str] | None] = []
    anterior_id: str | None = None
    previo: frozenset[str] | None = None
    for lectura in cadena:
        enlace = lectura["anterior"]
        if enlace is None:
            base: frozenset[str] | None = frozenset()
        else:
            base = previo if enlace == anterior_id else None
        censo = None
        if base is not None:
            censo = (base | set(lectura["entradas"])) - {salida["id"] for salida in lectura["salidas"]}
            if huella_de_ids(censo) != lectura["ids_sha256"]:
                censo = None
        censos.append(censo)
        anterior_id, previo = lectura["lectura_id"], censo
    return censos, censos.count(None)


def _observaciones(cadena: list[ObjetoJson], censos: list[frozenset[str] | None]) -> list[tuple[int, frozenset[str]]]:
    """Las únicas lecturas que observan algo: las sanas con el censo rehecho, con su posición en la cadena.

    Returns:
        Pares (posición, censo), de la más antigua a la más reciente.
    """
    return [
        (indice, censo)
        for indice, (lectura, censo) in enumerate(zip(cadena, censos, strict=True))
        if lectura["estado"] == "sana" and censo is not None
    ]


def _retirada(
    grupo: str, curso: str, desde: int, observaciones: list[tuple[int, frozenset[str]]]
) -> tuple[_Retirada, int | None]:
    """Mira las lecturas sanas posteriores a la retirada: si hubo alguna y si el curso reapareció en alguna.

    Returns:
        La retirada y la posición de la primera lectura sana donde reapareció (`None` si no reapareció).
    """
    posteriores = [(indice, censo) for indice, censo in observaciones if indice > desde]
    cierre = next((indice for indice, censo in posteriores if curso in censo), None)
    retirada = _Retirada(grupo=grupo, comprobable=bool(posteriores), reaparecida=cierre is not None)
    return retirada, cierre


def _retiradas_del_ambito(cadena: list[ObjetoJson], registros: list[ObjetoJson]) -> tuple[list[_Retirada], int]:
    """Las retiradas de un ámbito, cada una contada una sola vez, con su grupo y su comprobación.

    Una retirada es el paso a `retirar`. Las decisiones `retirar` siguientes son la misma retirada hasta que el curso
    deja de estar retirado: un registro posterior que no lo retira (lo mantiene o lo deja pendiente, visible en los
    dos casos) o, en una lectura sin registro, su reaparición en el censo sano. Así no cuenta dos veces un curso
    ausente varios días ni uno que la fuente sigue listando con su fin ya pasado.

    Returns:
        Las retiradas y cuántas lecturas del ámbito no se usaron por no poder rehacer su censo.
    """
    censos, sin_censo = _censos(cadena)
    observaciones = _observaciones(cadena, censos)
    posicion = {lectura["lectura_id"]: indice for indice, lectura in enumerate(cadena)}
    con_registro = {posicion[registro["lectura_id"]] for registro in registros}
    # La posición de la primera reaparición sana sin registro de cada retirada abierta (`None` si no la hubo).
    abiertas: dict[str, int | None] = {}
    retiradas = []
    for registro in sorted(registros, key=lambda r: posicion[r["lectura_id"]]):
        indice = posicion[registro["lectura_id"]]
        retira = {d["curso"]: d for d in registro["decisiones"] if d["decision"] == "retirar"}
        abiertas = {curso: cierre for curso, cierre in abiertas.items() if curso in retira}
        for curso, decision in sorted(retira.items()):
            if curso in abiertas and (abiertas[curso] is None or indice < abiertas[curso]):
                continue
            retiradas.append(_retirada(_grupo_de(decision), curso, indice, observaciones)[0])
            abiertas[curso] = _reaparicion_sin_registro(curso, indice, observaciones, con_registro)
    return retiradas, sin_censo


def _reaparicion_sin_registro(
    curso: str, desde: int, observaciones: list[tuple[int, frozenset[str]]], con_registro: set[int]
) -> int | None:
    """La primera lectura sana posterior, sin registro de decisiones, en la que el curso vuelve a estar.

    Returns:
        Su posición en la cadena, o `None` si no la hay.
    """
    return next(
        (indice for indice, censo in observaciones if indice > desde and indice not in con_registro and curso in censo),
        None,
    )


def _estadistica(retiradas: list[_Retirada]) -> ObjetoJson:
    """Los recuentos de un conjunto de retiradas y su tasa y su cota de Jeffreys, si hay algo comprobable.

    La tasa solo existe si hubo algún error: con cero errores se da la cota y no un 0 %.

    Returns:
        `retiradas`, `con_lectura_posterior`, `reaparecidas`, `tasa` y `cota95` (proporciones de 0 a 1, o `None`).
    """
    comprobables = sum(1 for r in retiradas if r.comprobable)
    errores = sum(1 for r in retiradas if r.reaparecida)
    tasa = errores / comprobables if errores else None
    cota = intervalo_de_jeffreys(errores, comprobables)[1] if comprobables else None
    return {
        "retiradas": len(retiradas),
        "con_lectura_posterior": comprobables,
        "reaparecidas": errores,
        "tasa": tasa,
        "cota95": cota,
    }


def _fila(fuente: str, retiradas: list[_Retirada], lecturas_sin_censo: int) -> ObjetoJson:
    return {
        "fuente": fuente,
        **_estadistica(retiradas),
        "por_grupo": [{"grupo": grupo, **_estadistica([r for r in retiradas if r.grupo == grupo])} for grupo in GRUPOS],
        "lecturas_sin_censo": lecturas_sin_censo,
        "naturaleza": NATURALEZA,
    }


def medir_error(registros: Iterable[ObjetoJson], lecturas: Iterable[ObjetoJson]) -> list[ObjetoJson]:
    """Mide, por fuente, las retiradas que reaparecen en una lectura sana posterior.

    Args:
        registros: Los registros `decisiones-retirada` guardados, de cualquier lectura y fuente.
        lecturas: Todas las lecturas guardadas de esas fuentes.

    Returns:
        Una fila por fuente, ordenada por nombre: `fuente`, `retiradas`, `con_lectura_posterior`, `reaparecidas`,
        `tasa`, `cota95` (la cota superior del intervalo de Jeffreys al 95 %), `por_grupo` (lo mismo por cada grupo que
        sostuvo la retirada), `lecturas_sin_censo` y `naturaleza` (`limite_inferior`).

    Raises:
        ErrorDeMedida: Si un registro cita una lectura que no está, o la lectura de otro ámbito o fuente.
        ErrorLectura: Si una lectura no cumple el contrato.
        ErrorDecisiones: Si un registro no cumple el contrato.
    """
    por_ambito: dict[tuple[str, str], list[ObjetoJson]] = defaultdict(list)
    ambito_de: dict[str, tuple[str, str]] = {}
    for lectura in lecturas:
        validar_lectura(lectura)
        por_ambito[(lectura["fuente"], lectura["ambito"])].append(lectura)
        ambito_de[lectura["lectura_id"]] = (lectura["fuente"], lectura["ambito"])
    registros_por_ambito: dict[tuple[str, str], list[ObjetoJson]] = defaultdict(list)
    for registro in registros:
        validar_registro(registro)
        _exigir(registro["lectura_id"] in ambito_de, "un registro de decisiones cita una lectura que no está")
        _exigir(
            ambito_de[registro["lectura_id"]] == (registro["fuente"], registro["ambito"]),
            "un registro de decisiones es de otra fuente u otro ámbito que su lectura",
        )
        registros_por_ambito[(registro["fuente"], registro["ambito"])].append(registro)
    retiradas: dict[str, list[_Retirada]] = defaultdict(list)
    sin_censo: dict[str, int] = defaultdict(int)
    for clave in sorted(por_ambito):
        cadena = sorted(por_ambito[clave], key=lambda lectura: (lectura["observado_utc"], lectura["lectura_id"]))
        encontradas, descartadas = _retiradas_del_ambito(cadena, registros_por_ambito[clave])
        retiradas[clave[0]].extend(encontradas)
        sin_censo[clave[0]] += descartadas
    return [_fila(fuente, retiradas[fuente], sin_censo[fuente]) for fuente in sorted(sin_censo)]
