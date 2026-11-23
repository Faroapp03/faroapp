"""Regla `retirada-por-evidencia` versión 1: decide, con evidencias, si un curso deja de publicarse.

Un curso deja de publicarse cuando lo afirma la propia fuente o cuando hay al menos dos evidencias independientes de su
baja. Las evidencias se cuentan por grupo de origen, porque dos señales que salen del mismo listado fallan a la vez:

- `fuente`: la fuente lo afirma (fin publicado alcanzado a la hora de una lectura, baja declarada, estado cerrado,
  inscripción cerrada o sin plazas). Basta por sí solo.
- `censo`: el curso falta en una lectura sana del censo. Una lectura anómala, incompleta o reconstruida no es una
  observación: su ausencia no cuenta.
- `pagina`: la comprobación de su página dice `cerrado` o `no_existe`.

Se retira con la fuente; con el censo y la página; o, solo en las fuentes sin canal de página, con dos lecturas sanas
distintas en las que falta. Con una sola evidencia la decisión es `pendiente` y el curso sigue visible. Que el curso
vuelva a aparecer en cualquier lectura posterior anula lo anterior: una lectura que no es sana puede impedir una
retirada, nunca provocarla.

Es una función pura: sin red, sin reloj y sin estado global. Nada se decide por el paso de los días: la única hora que
cuenta es la de cada observación. El resultado no depende del orden en que llegan las lecturas ni las comprobaciones.
"""

import hashlib
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.cursos.clasificacion.contrato import Regla
from plataforma_datos.cursos.lecturas.contrato_lectura import AMBITO, FUENTE, INSTANTE, SHA256, validar_lectura
from plataforma_datos.cursos.tipos_json import ObjetoJson

IDENTIFICADOR = "retirada-por-evidencia"
VERSION = 1
# La huella del código entra en la de la regla: cambiar cómo se decide cambia la regla que firma cada decisión.
HUELLA_DEL_CODIGO = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
DECISIONES = ("retirar", "mantener", "pendiente")
GRUPOS = ("fuente", "censo", "pagina")
CANALES_DE_LA_FUENTE = ("fin_publicado", "baja_declarada", "estado_cerrado", "inscripcion_cerrada", "sin_plazas")
CANALES = {"fuente": CANALES_DE_LA_FUENTE, "censo": ("ausencia",), "pagina": ("cerrado", "no_existe")}
VEREDICTOS = ("disponible", "cerrado", "no_existe", "dudoso", "sin_respuesta")
VEREDICTOS_DE_BAJA = ("cerrado", "no_existe")
# La salida de una lectura sana que ya explica la propia fuente es una afirmación de la fuente.
CANAL_DE_LA_SALIDA = {"fin_publicado": "fin_publicado", "fuente_declara_baja": "baja_declarada"}
# Fuera de lo que afirma la fuente, ninguna retirada descansa en una sola evidencia.
MINIMO_DE_EVIDENCIAS = 2


class ErrorRetirada(ValueError):
    """Lo que se pide decidir no es coherente: la cadena de lecturas, una declaración o una comprobación."""


def _exigir(condicion: object, motivo: str) -> None:
    if not condicion:
        raise ErrorRetirada(f"{IDENTIFICADOR}: {motivo}")


def _exigir_huella(valor: object, lugar: str) -> None:
    _exigir(isinstance(valor, str) and SHA256.fullmatch(valor) is not None, f"{lugar}: huella SHA-256 no válida")


def _exigir_instante(valor: object, lugar: str) -> None:
    _exigir(isinstance(valor, str) and INSTANTE.fullmatch(valor) is not None, f"{lugar}: hora UTC no válida")


@dataclass(frozen=True, kw_only=True)
class Parametros:
    """Lo que la regla fija como parámetro; entra en su huella, así que cambiarlo cambia la regla."""

    # Las fuentes cuya página se comprueba: en ellas el censo solo no retira nunca, hace falta la página.
    fuentes_con_pagina: frozenset[str]
    # Lecturas sanas distintas en las que debe faltar el curso de una fuente sin canal de página.
    ausencias_sin_pagina: int

    def __post_init__(self) -> None:
        """Rechaza unos parámetros con fuentes mal escritas o que retirarían con menos de dos lecturas."""
        _exigir(all(FUENTE.fullmatch(fuente) for fuente in self.fuentes_con_pagina), "fuente con página no válida")
        _exigir(
            type(self.ausencias_sin_pagina) is int and self.ausencias_sin_pagina >= MINIMO_DE_EVIDENCIAS,
            "una fuente sin página necesita al menos dos ausencias en lecturas sanas",
        )

    def a_json(self) -> ObjetoJson:
        """Devuelve los parámetros tal como entran en la huella de la regla.

        Returns:
            El objeto con las fuentes ordenadas y las ausencias exigidas.
        """
        return {
            "ausencias_sin_pagina": self.ausencias_sin_pagina,
            "fuentes_con_pagina": sorted(self.fuentes_con_pagina),
        }


# El único sitio donde se declara qué fuentes tienen canal de página: las que ya piden la ficha de cada curso.
PARAMETROS = Parametros(
    fuentes_con_pagina=frozenset({"barcelonactiva", "cibervoluntarios", "fundae", "hp_life"}), ausencias_sin_pagina=2
)


def regla_de_retirada(parametros: Parametros = PARAMETROS) -> Regla:
    """La regla que firma cada decisión: su identificador, su versión y la huella de su código y sus parámetros.

    Returns:
        La regla con la huella de este módulo y de los parámetros con que se decide.
    """
    huella = sha256_json({"codigo_sha256": HUELLA_DEL_CODIGO, "parametros": parametros.a_json()})
    return Regla(id=IDENTIFICADOR, version=VERSION, sha256=huella)


@dataclass(frozen=True, kw_only=True)
class Declaracion:
    """Lo que la fuente afirma de un curso en una lectura, con la huella del dato literal que lo dice.

    `cierra_el` es el fin publicado en UTC y solo lo lleva el canal `fin_publicado`.
    """

    lectura_id: str
    canal: str
    sha256: str
    cierra_el: str | None = None

    def __post_init__(self) -> None:
        """Rechaza una declaración de un canal desconocido o con el fin donde no corresponde."""
        _exigir_huella(self.lectura_id, "declaración.lectura_id")
        _exigir_huella(self.sha256, "declaración.sha256")
        _exigir(self.canal in CANALES_DE_LA_FUENTE, "declaración: canal no admitido")
        if self.canal == "fin_publicado":
            _exigir_instante(self.cierra_el, "declaración.cierra_el")
        else:
            _exigir(self.cierra_el is None, "declaración: solo el fin publicado lleva cierra_el")


@dataclass(frozen=True, kw_only=True)
class ComprobacionPagina:
    """La forma mínima de una comprobación de la página de un curso: su veredicto, cuándo se pidió y su huella."""

    veredicto: str
    pedido_utc: str
    sha256: str

    def __post_init__(self) -> None:
        """Rechaza un veredicto fuera de la lista cerrada, una hora mal escrita o una huella no válida."""
        _exigir(self.veredicto in VEREDICTOS, "comprobación: veredicto no admitido")
        _exigir_instante(self.pedido_utc, "comprobación.pedido_utc")
        _exigir_huella(self.sha256, "comprobación.sha256")


@dataclass(frozen=True, kw_only=True)
class Curso:
    """El curso que se decide: su identificador en el censo, su fuente, su ámbito y lo que la fuente declara de él."""

    id: str
    fuente: str
    ambito: str
    declaraciones: tuple[Declaracion, ...] = ()

    def __post_init__(self) -> None:
        """Rechaza un curso sin identificador o con una fuente o un ámbito mal escritos."""
        _exigir(isinstance(self.id, str) and self.id, "curso sin identificador")
        _exigir(FUENTE.fullmatch(self.fuente) is not None, "curso: fuente no admitida")
        _exigir(AMBITO.fullmatch(self.ambito) is not None, "curso: ámbito no admitido")


@dataclass(frozen=True, kw_only=True)
class Evidencia:
    """Una observación de baja: su grupo de origen, su canal, la huella de lo que la sostiene y su hora."""

    grupo: str
    canal: str
    ref_sha256: str
    observado_utc: str

    def a_json(self) -> ObjetoJson:
        """Devuelve la evidencia tal como se registra.

        Returns:
            El objeto de la evidencia.
        """
        return {
            "grupo": self.grupo,
            "canal": self.canal,
            "ref_sha256": self.ref_sha256,
            "observado_utc": self.observado_utc,
        }


def clave_de_evidencia(evidencia: ObjetoJson) -> tuple[int, str, str, str]:
    """El orden canónico de las evidencias: por grupo, canal, hora y huella.

    Returns:
        La clave con la que se ordenan.
    """
    return GRUPOS.index(evidencia["grupo"]), evidencia["canal"], evidencia["observado_utc"], evidencia["ref_sha256"]


@dataclass(frozen=True, kw_only=True)
class Decision:
    """Lo que la regla decide de un curso, con las evidencias en orden canónico y la regla que lo decidió."""

    curso: str
    decision: str
    evidencias: tuple[Evidencia, ...]
    regla: Regla


@dataclass(frozen=True, kw_only=True)
class _Paso:
    """Una lectura de la cadena con lo que dice del curso: si está y, si acaba de salir, cómo se explica."""

    lectura: ObjetoJson
    presente: bool
    salida: ObjetoJson | None

    @property
    def sana(self) -> bool:
        return self.lectura["estado"] == "sana"


def _cadena(curso: Curso, lecturas: Iterable[ObjetoJson]) -> list[ObjetoJson]:
    """Ordena las lecturas por su encadenamiento, no por cómo llegan, y exige una cadena completa y sin ramas.

    Returns:
        Las lecturas de la primera a la última.
    """
    por_anterior: dict[str | None, ObjetoJson] = {}
    vistas = set()
    for lectura in lecturas:
        validar_lectura(lectura)
        _exigir((lectura["fuente"], lectura["ambito"]) == (curso.fuente, curso.ambito), "lectura de otro ámbito")
        _exigir(lectura["lectura_id"] not in vistas, "lectura repetida")
        _exigir(lectura["anterior"] not in por_anterior, "la cadena de lecturas tiene dos ramas")
        vistas.add(lectura["lectura_id"])
        por_anterior[lectura["anterior"]] = lectura
    cadena = []
    siguiente = por_anterior.get(None)
    while siguiente is not None:
        cadena.append(siguiente)
        siguiente = por_anterior.get(siguiente["lectura_id"])
    _exigir(len(cadena) == len(vistas), "la cadena de lecturas está rota: falta una lectura intermedia")
    horas = [lectura["observado_utc"] for lectura in cadena]
    _exigir(horas == sorted(set(horas)), "la cadena de lecturas no avanza en el tiempo")
    return cadena


def _pasos(curso: Curso, cadena: list[ObjetoJson]) -> list[_Paso]:
    """Recorre la cadena y anota si el curso está en cada lectura; la primera lista todo su censo como entradas.

    Returns:
        Un paso por lectura, en el orden de la cadena.
    """
    pasos, presente = [], False
    for lectura in cadena:
        salida = next((s for s in lectura["salidas"] if s["id"] == curso.id), None)
        if curso.id in lectura["entradas"]:
            _exigir(not presente, "la cadena hace entrar un curso que ya estaba")
            presente = True
        elif salida is not None:
            _exigir(presente, "la cadena hace salir un curso que no estaba")
            presente = False
        pasos.append(_Paso(lectura=lectura, presente=presente, salida=salida))
    return pasos


def _de_la_fuente(curso: Curso, ultima: _Paso | None, despues: list[_Paso], ultima_sana: ObjetoJson) -> list[Evidencia]:
    """Lo que afirma la fuente desde la última vez que listó el curso.

    Solo cuenta lo que declaró en esa última lectura, si es sana: una declaración anterior queda superada por lo que
    la fuente dijo después. El fin publicado se compara con la hora de la última lectura sana, nunca con el reloj.

    Returns:
        Las evidencias del grupo `fuente`.
    """
    evidencias = []
    if ultima is not None and ultima.sana:
        lectura = ultima.lectura
        for declaracion in curso.declaraciones:
            if declaracion.lectura_id != lectura["lectura_id"]:
                continue
            hora = lectura["observado_utc"]
            if declaracion.canal == "fin_publicado":
                if ultima_sana["observado_utc"] < declaracion.cierra_el:
                    continue
                hora = ultima_sana["observado_utc"]
            evidencias.append(
                Evidencia(grupo="fuente", canal=declaracion.canal, ref_sha256=declaracion.sha256, observado_utc=hora)
            )
    salida = despues[0] if despues else None
    if salida is not None and salida.sana and salida.salida["explicada_por"] in CANAL_DE_LA_SALIDA:
        canal = CANAL_DE_LA_SALIDA[salida.salida["explicada_por"]]
        lectura = salida.lectura
        evidencias.append(
            Evidencia(
                grupo="fuente", canal=canal, ref_sha256=lectura["lectura_id"], observado_utc=lectura["observado_utc"]
            )
        )
    return evidencias


def _del_censo(despues: list[_Paso]) -> list[Evidencia]:
    """Las lecturas sanas en las que falta el curso desde la última vez que se listó.

    Returns:
        Una evidencia del grupo `censo` por lectura sana.
    """
    return [
        Evidencia(
            grupo="censo",
            canal="ausencia",
            ref_sha256=paso.lectura["lectura_id"],
            observado_utc=paso.lectura["observado_utc"],
        )
        for paso in despues
        if paso.sana
    ]


def _de_la_pagina(comprobaciones: Iterable[ComprobacionPagina], desde: str | None) -> list[Evidencia]:
    """El último veredicto de la página posterior a la última vez que el censo listó el curso.

    `sin_respuesta` no es una observación de la página. Si a la misma hora hay veredictos distintos, solo cuenta
    como baja si todos lo son: ante la duda, el curso sigue visible.

    Returns:
        Las evidencias del grupo `pagina` (como mucho una hora).
    """
    observadas = [
        c for c in comprobaciones if c.veredicto != "sin_respuesta" and (desde is None or c.pedido_utc > desde)
    ]
    if not observadas:
        return []
    hora = max(c.pedido_utc for c in observadas)
    ultimas = [c for c in observadas if c.pedido_utc == hora]
    if not all(c.veredicto in VEREDICTOS_DE_BAJA for c in ultimas):
        return []
    return [Evidencia(grupo="pagina", canal=c.veredicto, ref_sha256=c.sha256, observado_utc=hora) for c in ultimas]


def _exigir_declaraciones(curso: Curso, pasos: list[_Paso]) -> None:
    """Cada declaración cita una lectura de la cadena en la que el curso está: la fuente habla de lo que lista."""
    presente_en = {paso.lectura["lectura_id"] for paso in pasos if paso.presente}
    citadas = {paso.lectura["lectura_id"] for paso in pasos}
    for declaracion in curso.declaraciones:
        _exigir(declaracion.lectura_id in citadas, "la declaración cita una lectura que no está en la cadena")
        _exigir(declaracion.lectura_id in presente_en, "la declaración cita una lectura en la que el curso no está")


def _veredicto(curso: Curso, evidencias: list[Evidencia], parametros: Parametros) -> str:
    """Retira con la fuente, con el censo y la página, o con varias ausencias sanas si la fuente no tiene página.

    Returns:
        `retirar`, `pendiente` o `mantener`.
    """
    grupos = [evidencia.grupo for evidencia in evidencias]
    if "fuente" in grupos or {"censo", "pagina"} <= set(grupos):
        return "retirar"
    sin_pagina = curso.fuente not in parametros.fuentes_con_pagina
    if sin_pagina and grupos.count("censo") >= parametros.ausencias_sin_pagina:
        return "retirar"
    return "pendiente" if evidencias else "mantener"


def decidir(
    curso: Curso,
    lecturas: Iterable[ObjetoJson],
    comprobaciones: Iterable[ComprobacionPagina] = (),
    parametros: Parametros = PARAMETROS,
) -> Decision:
    """Decide si un curso se retira, se mantiene o queda pendiente de una segunda evidencia.

    Recibe todas las lecturas del ámbito del curso, tal como las guarda el almacén, y las comprobaciones de su página.
    Sin ninguna lectura sana no hay observación del censo y el curso se mantiene. La última vez que una lectura lista
    el curso, sea cual sea su estado, anula las ausencias y los veredictos de página anteriores.

    Returns:
        La decisión con sus evidencias en orden canónico y la regla que la firma.

    Raises:
        ErrorRetirada: Si las lecturas no forman una cadena completa del ámbito del curso, o si una declaración cita
            una lectura de fuera de la cadena o en la que el curso no está.
    """
    regla = regla_de_retirada(parametros)
    pasos = _pasos(curso, _cadena(curso, lecturas))
    _exigir_declaraciones(curso, pasos)
    sanas = [paso.lectura for paso in pasos if paso.sana]
    if not sanas:
        return Decision(curso=curso.id, decision="mantener", evidencias=(), regla=regla)
    indice = max((i for i, paso in enumerate(pasos) if paso.presente), default=None)
    ultima = None if indice is None else pasos[indice]
    despues = [] if indice is None else pasos[indice + 1 :]
    desde = None if ultima is None else ultima.lectura["observado_utc"]
    evidencias = [
        *_de_la_fuente(curso, ultima, despues, sanas[-1]),
        *_del_censo(despues),
        *_de_la_pagina(comprobaciones, desde),
    ]
    ordenadas = tuple(sorted(evidencias, key=lambda evidencia: clave_de_evidencia(evidencia.a_json())))
    return Decision(
        curso=curso.id, decision=_veredicto(curso, evidencias, parametros), evidencias=ordenadas, regla=regla
    )
