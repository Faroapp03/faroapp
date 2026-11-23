"""Regla `salud-lectura` versión 2: califica una lectura del censo de una fuente por lo que explica su cambio.

Cuánto cambia un recuento no distingue una caída legítima de una rotura: una fuente pequeña pierde dos cursos que
terminan y ya supera cualquier porcentaje, y una fuente puede cambiar de forma sin mover su recuento. Por eso esta regla
no mira cuánto cambia el censo, sino si el cambio tiene explicación: la misma forma que la última lectura sana, el total
que declara la fuente, vocabularios conocidos y salidas explicadas por un fin publicado o una baja declarada. Cuántas
salidas sin explicar son normales lo dice la historia de cada fuente (calibracion_de_salidas.py): con poca historia vale
el umbral fijo de esta regla, que hace de suelo.

La regla solo califica la lectura; no decide nada sobre ningún curso. Lo que se sigue de su veredicto lo fija el
contrato: las ausencias de una lectura sana cuentan como observaciones y las de una lectura anómala o incompleta no
cuentan. Así, una lectura que la regla no da por sana solo puede impedir cambios, nunca provocarlos.

Es una función pura: sin red, sin reloj y sin estado global. Recibe lo observado y la referencia del mismo ámbito, tal
como la guarda el almacén: la última lectura sana o una lectura de censo completo que una persona aceptó como nueva
referencia tras un cambio legítimo de forma; y las lecturas anteriores del ámbito, de las que sale la calibración.
Devuelve el veredicto con el que se construye la lectura del contrato. Las lecturas guardadas con la versión 1 no llevan
calibración y se siguen leyendo igual.
"""

import hashlib
from collections.abc import Sequence
from dataclasses import dataclass, fields
from pathlib import Path

from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.cursos.clasificacion.contrato import Regla
from plataforma_datos.cursos.lecturas.calibracion_de_salidas import (
    PARAMETROS,
    Calibracion,
    ParametrosDeCalibracion,
    calibrar,
    techo_de,
)
from plataforma_datos.cursos.lecturas.contrato_lectura import HuellaForma, Lectura, Salida, validar_lectura
from plataforma_datos.cursos.lecturas.historia_de_salidas import exposicion_entre, historia_de_salidas
from plataforma_datos.cursos.tipos_json import ObjetoJson

IDENTIFICADOR = "salud-lectura"
VERSION = 2
# La huella del código entra en la de la regla: cambiar cómo se decide cambia la regla que firma cada lectura.
HUELLA_DEL_CODIGO = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
HUELLA_DE_LA_CALIBRACION = hashlib.sha256(
    b"".join(
        (Path(__file__).parent / nombre).read_bytes()
        for nombre in ("calibracion_de_salidas.py", "historia_de_salidas.py")
    )
    + (Path(__file__).parents[1] / "tasa_de_poisson.py").read_bytes()
).hexdigest()
PORCENTAJE_ENTERO = 100


class ErrorSalud(ValueError):
    """Lo que se pide calificar no se puede comparar: la referencia no es una lectura sana o aceptada del ámbito."""


def _exigir(condicion: object, motivo: str) -> None:
    if not condicion:
        raise ErrorSalud(f"{IDENTIFICADOR}: {motivo}")


@dataclass(frozen=True, kw_only=True)
class UmbralDeSalidas:
    """El suelo: cuántas salidas sin explicación admite una lectura cuando la historia aún no basta para calibrarlo.

    Las omisiones del historial no llegan sueltas, sino todas en la misma lectura; por eso un bloque de salidas sin
    explicación delata la lectura y no los cursos. El umbral es el mayor de un mínimo de cursos y un porcentaje del
    recuento bruto de la última lectura sana: en una fuente pequeña manda el mínimo, y allí se cuentan cursos.
    """

    minimo_de_cursos: int
    porcentaje_del_bruto: int

    def __post_init__(self) -> None:
        """Rechaza un umbral que no sea un número entero de cursos y un porcentaje entero entre 0 y 100."""
        _exigir(type(self.minimo_de_cursos) is int and self.minimo_de_cursos >= 0, "mínimo de cursos no válido")
        _exigir(
            type(self.porcentaje_del_bruto) is int and 0 <= self.porcentaje_del_bruto <= PORCENTAJE_ENTERO,
            "porcentaje no válido",
        )

    def admitidas(self, bruto_de_referencia: int) -> int:
        """Las salidas sin explicación que se admiten frente a un censo de ese tamaño.

        Returns:
            El mayor entre el mínimo de cursos y el porcentaje del bruto redondeado hacia arriba.
        """
        # Redondeo hacia arriba con enteros: la misma cifra en cualquier máquina, sin decimales de por medio.
        proporcional = -(-bruto_de_referencia * self.porcentaje_del_bruto // PORCENTAJE_ENTERO)
        return max(self.minimo_de_cursos, proporcional)

    def a_json(self) -> ObjetoJson:
        """Devuelve el umbral tal como entra en la huella de la regla.

        Returns:
            El objeto con el mínimo y el porcentaje.
        """
        return {"minimo_de_cursos": self.minimo_de_cursos, "porcentaje_del_bruto": self.porcentaje_del_bruto}


# El único sitio donde se fija el suelo. Contrastado con el historial de Cibernàrium y Cibervoluntarios del 21/10
# al 18/11 (la tabla está en el README): marca la lectura de ediciones del 15/11 y no la del 18/11.
UMBRAL = UmbralDeSalidas(minimo_de_cursos=3, porcentaje_del_bruto=2)


def regla_de_salud(umbral: UmbralDeSalidas = UMBRAL, parametros: ParametrosDeCalibracion = PARAMETROS) -> Regla:
    """La regla que firma cada veredicto: su identificador, su versión y la huella de su código y sus parámetros.

    Returns:
        La regla con la huella de este módulo, de la calibración, del umbral y de los parámetros con que se califica.
    """
    huella = sha256_json(
        {
            "codigo_sha256": HUELLA_DEL_CODIGO,
            "calibracion_sha256": HUELLA_DE_LA_CALIBRACION,
            "umbral": umbral.a_json(),
            "calibracion": parametros.a_json(),
        }
    )
    return Regla(id=IDENTIFICADOR, version=VERSION, sha256=huella)


@dataclass(frozen=True, kw_only=True)
class Veredicto:
    """Lo que la regla decide de una lectura: su estado, sus motivos, su calibración y la regla. Nada sobre cursos.

    Una lectura incompleta no se juzga y no lleva calibración.
    """

    estado: str
    motivos: tuple[str, ...]
    regla: Regla
    calibracion: Calibracion | None = None


@dataclass(frozen=True, kw_only=True)
class Observacion:
    """Lo observado en una lectura del censo: lo de la lectura del contrato salvo el estado, los motivos y la regla."""

    fuente: str
    ambito: str
    anterior: str | None
    observado_utc: str
    completa: bool
    motivo_incompleta: str | None = None
    recuento_bruto: int
    recuento_vigente: int
    total_declarado: int | None = None
    ids_sha256: str
    entradas: tuple[str, ...] = ()
    salidas: tuple[Salida, ...] = ()
    huella_forma: HuellaForma

    def lectura(self, veredicto: Veredicto) -> Lectura:
        """La lectura del contrato con este veredicto; al construirla, el contrato la valida entera.

        Returns:
            La lectura lista para guardarse.
        """
        observado = {campo.name: getattr(self, campo.name) for campo in fields(self)}
        calibracion = None if veredicto.calibracion is None else veredicto.calibracion.a_json()
        return Lectura(
            **observado,
            estado=veredicto.estado,
            motivos=veredicto.motivos,
            regla=veredicto.regla,
            calibracion=calibracion,
        )


def _exigir_referencia(observacion: Observacion, ultima_sana: ObjetoJson | None, aceptada: bool) -> None:
    """La referencia es una lectura sana, o anómala y aceptada por una persona, válida, del ámbito y anterior."""
    if ultima_sana is None:
        return
    validar_lectura(ultima_sana)
    # Una aceptación toma como referencia una lectura de censo completo: una incompleta no dice qué forma tiene.
    admitidos = ("sana", "anomala") if aceptada else ("sana",)
    _exigir(ultima_sana["estado"] in admitidos, "la referencia no es una lectura sana ni una aceptada completa")
    _exigir(
        (ultima_sana["fuente"], ultima_sana["ambito"]) == (observacion.fuente, observacion.ambito),
        "la referencia es de otra fuente o de otro ámbito",
    )
    _exigir(ultima_sana["observado_utc"] < observacion.observado_utc, "la referencia no es anterior a lo observado")
    _exigir(observacion.anterior is not None, "una primera lectura no tiene lectura sana anterior")


def _exigir_previas(observacion: Observacion, previas: Sequence[ObjetoJson]) -> None:
    """Las lecturas previas son del ámbito, van en orden, son anteriores y la última es la anterior de esta."""
    _exigir(
        all((otra["fuente"], otra["ambito"]) == (observacion.fuente, observacion.ambito) for otra in previas),
        "una lectura previa es de otra fuente o de otro ámbito",
    )
    horas = [otra["observado_utc"] for otra in previas] + [observacion.observado_utc]
    _exigir(all(antes < despues for antes, despues in zip(horas, horas[1:], strict=False)), "previas fuera de orden")
    _exigir(
        not previas or previas[-1]["lectura_id"] == observacion.anterior,
        "la última lectura previa no es la anterior de esta",
    )


def _forma_cambiada(forma: HuellaForma, ultima_sana: ObjetoJson | None) -> bool:
    """La captura trae otros niveles u otros campos que la última lectura sana; sin referencia no hay comparación.

    Returns:
        Si la forma no coincide con la de la referencia.
    """
    if ultima_sana is None:
        return False
    referencia = ultima_sana["huella_forma"]
    return forma.campos_sha256 != referencia["campos_sha256"] or sorted(forma.niveles) != referencia["niveles"]


def calibracion_de(
    observacion: Observacion,
    ultima_sana: ObjetoJson | None,
    previas: list[ObjetoJson],
    umbral: UmbralDeSalidas = UMBRAL,
) -> Calibracion:
    """Cuántas salidas sin explicación admite esta lectura, con su suelo y su techo.

    El suelo sale del bruto de la referencia y el techo, del bruto de la lectura anterior, que es el censo del que
    salen los cursos.

    Sin lectura sana de referencia, el bruto de referencia es cero y el suelo es el mínimo de cursos: una lectura que
    no se puede comparar con ninguna sana no se da por buena con un bloque de salidas sin explicar. El techo se mide
    contra la anterior y no contra la referencia para que una fuente que se encoge cada día no quede, con el tiempo,
    por debajo de una fracción de un censo que ya no tiene.

    Returns:
        La calibración, con el límite y de dónde salió.
    """
    bruto_de_referencia = 0 if ultima_sana is None else ultima_sana["recuento_bruto"]
    suelo = umbral.admitidas(bruto_de_referencia)
    return calibrar(
        sin_explicar=sum(1 for salida in observacion.salidas if salida.explicada_por is None),
        suelo=suelo,
        techo=techo_de(suelo, previas[-1]["recuento_bruto"] if previas else 0),
        historia=historia_de_salidas(previas),
        exposicion=(
            exposicion_entre(previas[-1], observacion.observado_utc, observacion.recuento_bruto) if previas else 0
        ),
    )


def motivos_de_anomalia(
    observacion: Observacion, ultima_sana: ObjetoJson | None, calibracion: Calibracion
) -> tuple[str, ...]:
    """Lo que no encaja en una lectura de censo completo, en el orden canónico del contrato.

    Returns:
        Los motivos de anomalía, ordenados; vacío si nada en la lectura es extraño.
    """
    motivos = []
    if _forma_cambiada(observacion.huella_forma, ultima_sana):
        motivos.append("forma_cambiada")
    declarado = observacion.total_declarado
    if declarado is not None and declarado != observacion.recuento_bruto:
        motivos.append("total_declarado_distinto")
    if observacion.huella_forma.valores_nuevos:
        motivos.append("valor_desconocido")
    if calibracion.sin_explicar > calibracion.limite:
        motivos.append("salidas_no_explicadas_en_bloque")
    return tuple(sorted(motivos))


def calificar(
    observacion: Observacion,
    ultima_sana: ObjetoJson | None,
    umbral: UmbralDeSalidas = UMBRAL,
    *,
    aceptada: bool = False,
    previas: Sequence[ObjetoJson] = (),
) -> Veredicto:
    """Decide si una lectura es sana, anómala o incompleta, y con qué motivos.

    Un censo incompleto es incompleto y no se juzga: lo que falta en él ya no acredita nada. Solo lleva
    `valor_desconocido` cuando la captura trae valores nuevos, porque el contrato ata ese motivo a sus valores. Un censo
    completo es anómalo si tiene algún motivo y sano si no tiene ninguno. Sin lectura sana de referencia, la forma no se
    compara: una primera lectura no puede ser anómala por comparación. Con `aceptada`, la referencia es una lectura que
    una persona aceptó (aceptaciones.py) y puede ser anómala: su forma pasa a ser la buena. `previas` son las lecturas
    del ámbito anteriores a esta, de la más antigua a la más reciente; sin ellas vale el suelo.

    Returns:
        El veredicto, firmado por la regla con sus parámetros y, si el censo es completo, con su calibración.

    Raises:
        ErrorSalud: Si la referencia no es una lectura sana o aceptada, anterior, de la misma fuente y del mismo ámbito,
            o si las lecturas previas no son las del ámbito terminadas en la anterior de esta.
    """
    _exigir_referencia(observacion, ultima_sana, aceptada)
    _exigir_previas(observacion, previas)
    regla = regla_de_salud(umbral)
    if not observacion.completa:
        motivos = ("valor_desconocido",) if observacion.huella_forma.valores_nuevos else ()
        return Veredicto(estado="incompleta", motivos=motivos, regla=regla)
    calibracion = calibracion_de(observacion, ultima_sana, list(previas), umbral)
    motivos = motivos_de_anomalia(observacion, ultima_sana, calibracion)
    return Veredicto(estado="anomala" if motivos else "sana", motivos=motivos, regla=regla, calibracion=calibracion)
