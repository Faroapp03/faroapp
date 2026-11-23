"""La lectura del censo de Digitalízate (catálogo 1 de FUNDAE): lo que cada ciclo deja dicho en el registro de lecturas.

El censo se recibe por partes: la lista de proveedores activos, la de los dados de baja y la ficha de cada proveedor
con sus recursos. Al terminar de recibirlo, la adquisición entrega aquí lo que conservó y se emite una sola lectura,
la de los recursos (`fundae:1:<id>`, el identificador de su programa en el catálogo). Solo se registra: nada de lo que
se publica cambia.

El censo es completo cuando lo da por completo `censo_digitalizate.leer`: las dos listas y todas las fichas
respondieron, cada ficha cuadra su recuento con el que declara su lista y ninguna trae una forma inesperada. Sin la
lista de proveedores no hay censo y no se emite nada.

Un recurso con `baja: true` en la ficha de un proveedor activo es una baja que declara la fuente. Sigue en el censo,
porque la fuente lo lista, pero no es vigente y es una declaración para la regla de retirada (`declaraciones`), que
solo admite declaraciones de cursos presentes en la lectura. Cuando después deja de listarse, su salida queda
explicada por `fuente_declara_baja`: se sabe por el censo del ciclo anterior. Digitalízate no publica fin de curso, y
que un proveedor figure en la lista de bajas no explica la salida de sus recursos: su ficha sigue respondiendo con ellos
como activos. La hora de la lectura es la de la captura, nunca la del reloj.

Este módulo no importa `censo_digitalizate` porque ese módulo importa la adquisición, que importa este. La lectura
del censo la entrega quien llama.
"""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.comun.nucleo import DATOS_RELATIVOS, FormatoInesperado
from plataforma_datos.cursos.lecturas.contrato_lectura import FORMATO_INSTANTE, huella_de_ids
from plataforma_datos.cursos.lecturas.emision import Censo, Emision, emitir_lectura
from plataforma_datos.cursos.retirada_por_evidencia import Declaracion
from plataforma_datos.cursos.tipos_json import ObjetoJson

FUENTE = "fundae"
CANAL = "catalogos"
AMBITO = "fundae:digitalizate"
PREFIJO = "fundae:1:"
# Cada recurso del censo es el programa de Faro: Digitalízate no publica un nivel de edición.
NIVELES = ("programa",)
# El par que identifica un recurso del tipo «Curso»; es el de `censo_digitalizate.CURSO`.
CURSO = (1, "Curso")
# Lo que lee un lector del censo: la carpeta de originales y la procedencia que lleva el documento del censo.
LectorDelCenso = Callable[[Path, ObjetoJson], ObjetoJson | None]


class ErrorLecturaFundae(ValueError):
    """Lo que se pide no corresponde a una lectura de Digitalízate o a su carpeta de originales."""


@dataclass(frozen=True, kw_only=True)
class Resultado:
    """Las lecturas emitidas y lo que impidió emitirlas o compararlas con su historia (vacío si nada)."""

    emisiones: tuple[Emision, ...]
    problemas: tuple[str, ...]


def _con_baja(leido: ObjetoJson) -> dict[int, ObjetoJson]:
    return {rid: v["recurso"] for rid, v in leido["recursos"].items() if v["recurso"]["baja"] is True}


def _presentes(leido: ObjetoJson) -> frozenset[str]:
    """Los recursos que trajo la captura, también los que declaran su baja y los que no se pudieron leer.

    Returns:
        Sus identificadores de programa.
    """
    return frozenset(PREFIJO + str(rid) for rid in {*leido["recursos"], *leido["sin_noticia"]})


def _es_curso(recurso: ObjetoJson) -> bool:
    return (recurso.get("idTipoRecurso"), recurso.get("tipoRecurso")) == CURSO


def _rutas_de_campos(leido: ObjetoJson) -> tuple[str, ...]:
    return tuple(sorted({"programa." + campo for v in leido["recursos"].values() for campo in v["recurso"]}))


def _hora(leido: ObjetoJson) -> str:
    """La hora de la captura: cuando terminó de responder la lista de proveedores activos, que abre el censo.

    Returns:
        El instante en UTC y al segundo.

    Raises:
        ErrorLecturaFundae: Si la lista no dejó su evidencia.
    """
    if not leido["evidencias"]:
        raise ErrorLecturaFundae("el censo no conserva la consulta de la lista de proveedores")
    recibido = datetime.fromisoformat(leido["evidencias"][0]["consultado_utc"])
    return recibido.astimezone(UTC).strftime(FORMATO_INSTANTE)


def _explicar(con_baja_antes: frozenset[str]) -> Callable[[str], str | None]:
    """Explica la salida de un recurso que el ciclo anterior ya tenía con la baja declarada.

    Returns:
        La función que la emisión aplica a cada recurso que sale.
    """

    def explicar(id: str) -> str | None:
        return "fuente_declara_baja" if id in con_baja_antes else None

    return explicar


def censo_de_recursos(leido: ObjetoJson, con_baja_antes: frozenset[str] = frozenset()) -> Censo:
    """El censo de los recursos de Digitalízate que dejó `censo_digitalizate.leer`.

    El total declarado es la suma de los `numeroCursos` de la lista de proveedores activos; cuenta todos los recursos
    de cada ficha, de cualquier tipo, igual que el bruto. Un recurso es vigente si es del tipo «Curso» y no declara
    su baja. `con_baja_antes` son los recursos que el censo del ciclo anterior ya traía con la baja declarada.

    Returns:
        El censo listo para emitir.
    """
    recursos = [v["recurso"] for v in leido["recursos"].values()]
    return Censo(
        fuente=FUENTE,
        ambito=AMBITO,
        observado_utc=_hora(leido),
        completa=leido["completo"],
        motivo_incompleta=None if leido["completo"] else "consulta_fallida",
        ids=_presentes(leido),
        recuento_bruto=len(recursos) + len(leido["sin_noticia"]),
        recuento_vigente=sum(_es_curso(r) and r["baja"] is False for r in recursos),
        total_declarado=sum(p["numeroCursos"] for p in leido["proveedores"].values()),
        niveles=NIVELES,
        rutas_de_campos=_rutas_de_campos(leido),
        explicar_salida=_explicar(con_baja_antes),
    )


def raiz_de(original: Path) -> Path:
    """La instalación a la que pertenece la carpeta de originales del canal.

    Returns:
        La raíz bajo la que viven `var/actualizacion/originales` y el registro de lecturas.

    Raises:
        ErrorLecturaFundae: Si la carpeta no es la de originales del canal de catálogos de FUNDAE de una instalación.
    """
    niveles = len(DATOS_RELATIVOS.parts) + 2
    raiz = original.parents[niveles] if len(original.parents) > niveles else None
    if raiz is None or raiz / DATOS_RELATIVOS / "originales" / FUENTE / CANAL != original:
        raise ErrorLecturaFundae(f"{original} no es la carpeta de originales de FUNDAE de una instalación")
    return raiz


def _con_baja_antes(
    original: Path, anterior: ObjetoJson, leer_censo: LectorDelCenso, problemas: list[str]
) -> frozenset[str]:
    """Los recursos con la baja declarada en el censo del ciclo anterior.

    Sin ese censo, o si no se puede leer, no se explica ninguna salida y se dice por qué: la lectura de hoy no depende
    de ello.

    Returns:
        Sus identificadores de programa.
    """
    try:
        previo = leer_censo(original, anterior)
    except (OSError, ValueError, FormatoInesperado) as error:
        problemas.append(f"el censo anterior de Digitalízate no se pudo leer ({error}); sus bajas no explican salidas")
        return frozenset()
    return frozenset() if previo is None else frozenset(PREFIJO + str(rid) for rid in _con_baja(previo))


def _preparar(
    original: Path, censo: ObjetoJson, anterior: ObjetoJson, leer_censo: LectorDelCenso
) -> tuple[Path, Censo, list[str]]:
    """Lee el censo conservado y lo convierte en lo que sabe la emisión.

    Returns:
        La raíz de la instalación, el censo de recursos y lo que no se pudo leer del ciclo anterior.

    Raises:
        ErrorLecturaFundae: Si no hay censo que registrar: la carpeta no es de una instalación o la lista de
            proveedores no se pudo leer.
    """
    raiz = raiz_de(original)
    leido = leer_censo(original, {"censo": censo})
    if leido is None or not leido["proveedores"]:
        motivo = "sin censo" if leido is None else leido["motivo"]
        raise ErrorLecturaFundae(f"no hay censo de Digitalízate que registrar ({motivo})")
    problemas: list[str] = []
    return raiz, censo_de_recursos(leido, _con_baja_antes(original, anterior, leer_censo, problemas)), problemas


def emitir(original: Path, censo: ObjetoJson, anterior: ObjetoJson, leer_censo: LectorDelCenso) -> Resultado:
    """Emite la lectura de los recursos de un censo de Digitalízate recién recibido.

    `anterior` es la procedencia del ciclo anterior, con su censo. El registro es telemetría: si algo impide emitir la
    lectura, se dice en el resultado y la adquisición sigue como habría seguido. Solo se recogen los errores de los
    datos y del disco; un defecto del código no se esconde.

    Returns:
        La lectura emitida y los problemas, si los hubo.
    """
    try:
        raiz, preparado, problemas = _preparar(original, censo, anterior, leer_censo)
    except (OSError, ValueError, FormatoInesperado) as error:
        return Resultado(emisiones=(), problemas=(f"la lectura de Digitalízate no se pudo preparar ({error})",))
    try:
        emision = emitir_lectura(raiz, preparado)
    except (OSError, ValueError) as error:
        return Resultado(emisiones=(), problemas=(*problemas, f"la lectura de {AMBITO} no se pudo emitir ({error})"))
    return Resultado(emisiones=(emision,), problemas=(*problemas, *emision.problemas))


def declaraciones(lectura: ObjetoJson, leido: ObjetoJson) -> dict[str, tuple[Declaracion, ...]]:
    """Las bajas que declara la fuente en una lectura, para la regla de retirada.

    `leido` tiene que ser el censo de esa lectura: sus recursos presentes deben dar la huella de identificadores de la
    lectura. Cada baja lleva la huella de los campos literales de la ficha que la dicen.

    Returns:
        Las declaraciones por identificador de programa; un recurso que no declara su baja no aparece.

    Raises:
        ErrorLecturaFundae: Si la lectura no es la de los recursos de Digitalízate o no es la de ese censo.
    """
    if lectura["fuente"] != FUENTE or lectura["ambito"] != AMBITO:
        raise ErrorLecturaFundae("las declaraciones salen de una lectura de los recursos de Digitalízate")
    if huella_de_ids(_presentes(leido)) != lectura["ids_sha256"]:
        raise ErrorLecturaFundae("el censo no es el de la captura de esta lectura")
    return {
        PREFIJO + str(rid): (
            Declaracion(
                lectura_id=lectura["lectura_id"],
                canal="baja_declarada",
                sha256=sha256_json({"idRecursoFormativo": rid, "baja": True}),
            ),
        )
        for rid in sorted(_con_baja(leido))
    }
