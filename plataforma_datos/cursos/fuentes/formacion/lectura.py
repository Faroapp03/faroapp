"""La lectura de la oferta de cursos del SOC: lo que cada descarga deja dicho en el registro de lecturas.

Al recibir una oferta válida, la descarga entrega aquí sus bytes y la hora de su consulta, y se emite una lectura de
los cursos. Se emite antes de decidir si la oferta se admite: la que queda pendiente de confirmación por perder
demasiados cursos también queda registrada. Solo se registra: nada de lo que se publica cambia. La hora de la lectura
es la de la consulta que anota la descarga, nunca la del reloj.

Decisiones de esta fuente (la tabla de `lecturas/como-engancha-una-fuente-su-lectura.md`):

| Decisión | SOC (formación) |
|---|---|
| Ámbitos | `soc:curso`: cada curso distinto («curs») de `ofertaCursos.json`, por su `identificador_curs` |
| Hora de la lectura | la consulta remota de la oferta (`comprobado_remoto_utc` de su copia) |
| Censo incompleto | nunca parcial: la oferta es un solo archivo que se valida entero; caída o rechazada, sin lectura |
| Total declarado | `None`: el SOC no declara cuántos cursos publica |
| Vigente | sin fin publicado anterior al día de la lectura en Cataluña, como lo ofrece el motor |
| Forma | nivel `edicion` (cada curso es una convocatoria con fechas y centro); rutas `edicion.<campo>` de las filas |
| Vocabulario cerrado | ninguno: la fuente no valida `estat_curs`, `tipus` ni `modalitat` contra una lista |
| Explicar una salida | su fin publicado en los cursos preparados (lo que se ve) ya pasó el día de la lectura |
| Baja declarada | ninguna: el SOC no publica bajas ni estados de cierre; un curso sale de la lista sin decir por qué |
| Declaraciones | `fin_publicado` por curso: termina al acabar su día de fin en Cataluña |

Un curso que sale de la lista sin haber llegado a su fin queda sin explicar: la oferta no dice nada de él.
"""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path

from plataforma_datos.comun.dia_de_consulta import ZONA_DE_CATALUNA, dia_en_cataluna
from plataforma_datos.comun.entrada_salida import leer_jsonl
from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.comun.nucleo import DATOS_RELATIVOS, ErrorFuente
from plataforma_datos.cursos.fuentes.formacion.calendario_soc import calendario_curso
from plataforma_datos.cursos.fuentes.formacion.constantes import FUENTE, PREPARADOS
from plataforma_datos.cursos.fuentes.formacion.json_soc import leer_json_latin1
from plataforma_datos.cursos.lecturas.contrato_lectura import FORMATO_INSTANTE, huella_de_ids
from plataforma_datos.cursos.lecturas.emision import Censo, Emision, emitir_lectura
from plataforma_datos.cursos.retirada_por_evidencia import Declaracion
from plataforma_datos.cursos.tipos_json import ObjetoJson

AMBITO = "soc:curso"
NIVELES = ("edicion",)
# Los campos de la oferta que sostienen el fin publicado de un curso.
CAMPOS_DEL_CALENDARIO = ("data_inici", "data_fi")


class ErrorLecturaSoc(ValueError):
    """Lo que se pide no corresponde a una lectura del SOC o a su carpeta de originales."""


@dataclass(frozen=True, kw_only=True)
class Resultado:
    """La lectura emitida y lo que impidió emitirla o compararla con su historia (vacío si nada)."""

    emisiones: tuple[Emision, ...]
    problemas: tuple[str, ...]


def instante(texto: str) -> str:
    """Escribe el instante de la consulta como lo guarda el registro de lecturas: en UTC y al segundo.

    Returns:
        El texto `AAAA-MM-DDTHH:MM:SSZ`.

    Raises:
        ErrorLecturaSoc: Si el instante no dice su zona.
    """
    momento = datetime.fromisoformat(texto)
    if momento.tzinfo is None:
        raise ErrorLecturaSoc("un instante sin zona no se puede situar en UTC")
    return momento.astimezone(UTC).strftime(FORMATO_INSTANTE)


def cursos_de_la_oferta(filas: list[ObjetoJson]) -> dict[str, ObjetoJson]:
    """Los cursos distintos de la oferta, con la primera fila que publica de cada uno, como la preparación.

    La fuente identifica cada curso por «curs» y lo publica por `identificador_curs`; su validación exige que cada
    curso tenga un identificador propio.

    Returns:
        La primera fila de cada curso, por su identificador publicado.
    """
    primeras: dict[str, ObjetoJson] = {}
    for fila in filas:
        primeras.setdefault(fila["curs"], fila)
    return {fila["identificador_curs"]: fila for fila in primeras.values()}


def _fin_publicado(fila: ObjetoJson) -> str | None:
    return calendario_curso(fila)["fin"]


def ha_terminado(fin: str | None, dia: date) -> bool:
    """Si un curso con ese fin publicado ya terminó el día de la lectura: el día de fin aún cuenta, como en el motor.

    Returns:
        True si el fin consta y es anterior al día.
    """
    return fin is not None and date.fromisoformat(fin) < dia


def cierre(fin: str) -> str:
    """El instante en que termina el día de fin de un curso en Cataluña, en UTC.

    Returns:
        El comienzo del día siguiente en Cataluña, escrito en UTC y al segundo.
    """
    siguiente = datetime.combine(date.fromisoformat(fin) + timedelta(days=1), time(), tzinfo=ZONA_DE_CATALUNA)
    return siguiente.astimezone(UTC).strftime(FORMATO_INSTANTE)


def publicados(raiz: Path) -> dict[str, ObjetoJson]:
    """Los cursos que se ven hoy, tal como los dejó la última preparación: lo último que se supo de cada uno.

    Returns:
        Los cursos preparados por identificador; vacío si la instalación aún no ha preparado ninguno.
    """
    ruta = raiz / DATOS_RELATIVOS / "preparados" / FUENTE / PREPARADOS["cursos"].name
    return {curso["id"]: curso for curso in leer_jsonl(ruta)} if ruta.is_file() else {}


def explicar_salida(conocidos: dict[str, ObjetoJson], dia: date) -> Callable[[str], str | None]:
    """Explica la salida de un curso por su fin publicado, si ya pasó el día de la lectura.

    Returns:
        La función que la emisión aplica a cada curso que sale.
    """

    def explicar(id: str) -> str | None:
        return "fin_publicado" if ha_terminado((conocidos.get(id) or {}).get("fin"), dia) else None

    return explicar


def censo_de_la_oferta(datos: bytes, observado: str, conocidos: dict[str, ObjetoJson]) -> Censo:
    """El censo de los cursos de una oferta recibida y válida.

    Returns:
        El censo listo para emitir.
    """
    dia = dia_en_cataluna(observado)
    filas = leer_json_latin1(datos)
    cursos = cursos_de_la_oferta(filas)
    return Censo(
        fuente=FUENTE,
        ambito=AMBITO,
        observado_utc=instante(observado),
        completa=True,
        ids=frozenset(cursos),
        recuento_bruto=len(cursos),
        recuento_vigente=sum(not ha_terminado(_fin_publicado(fila), dia) for fila in cursos.values()),
        niveles=NIVELES,
        rutas_de_campos=tuple(sorted({"edicion." + campo for fila in filas for campo in fila})),
        explicar_salida=explicar_salida(conocidos, dia),
    )


def raiz_de(original: Path) -> Path:
    """La instalación a la que pertenece la carpeta de originales de la formación.

    Returns:
        La raíz bajo la que viven `var/actualizacion/originales` y el registro de lecturas.

    Raises:
        ErrorLecturaSoc: Si la carpeta no es la de originales de la formación de una instalación.
    """
    niveles = len(DATOS_RELATIVOS.parts) + 1
    raiz = original.parents[niveles] if len(original.parents) > niveles else None
    if raiz is None or raiz / DATOS_RELATIVOS / "originales" / FUENTE != original:
        raise ErrorLecturaSoc(f"{original} no es la carpeta de originales de la formación de una instalación")
    return raiz


def emitir(original: Path, datos: bytes, observado: str) -> Resultado:
    """Emite la lectura de los cursos de una oferta recién recibida y válida.

    El registro es telemetría: si algo impide emitir la lectura, se dice en el resultado y la descarga sigue como
    habría seguido. Solo se recogen los errores de los datos (también los de la fuente, como unos cursos preparados
    ilegibles) y del disco; un defecto del código no se esconde.

    Returns:
        La lectura emitida y los problemas, si los hubo.
    """
    try:
        raiz = raiz_de(original)
        emision = emitir_lectura(raiz, censo_de_la_oferta(datos, observado, publicados(raiz)))
    except (OSError, ValueError, ErrorFuente) as error:
        return Resultado(emisiones=(), problemas=(f"la lectura de {AMBITO} no se pudo emitir ({error})",))
    return Resultado(emisiones=(emision,), problemas=emision.problemas)


def _declaraciones_del_curso(lectura_id: str, fila: ObjetoJson) -> tuple[Declaracion, ...]:
    """Lo que la oferta afirma de un curso: solo su fin publicado, con la huella de las fechas literales.

    Returns:
        La declaración de su fin, o nada si no lo publica o si sus fechas se contradicen.
    """
    fin = _fin_publicado(fila)
    if fin is None:
        return ()
    literal = {campo: fila[campo] for campo in CAMPOS_DEL_CALENDARIO}
    return (
        Declaracion(lectura_id=lectura_id, canal="fin_publicado", sha256=sha256_json(literal), cierra_el=cierre(fin)),
    )


def declaraciones(lectura: ObjetoJson, datos: bytes) -> dict[str, tuple[Declaracion, ...]]:
    """Las declaraciones de la oferta sobre cada curso de una lectura, para la regla de retirada.

    La oferta tiene que ser la de la captura de esa lectura: sus cursos deben dar la huella de identificadores.

    Returns:
        Las declaraciones por identificador de curso; un curso sin nada declarado no aparece.

    Raises:
        ErrorLecturaSoc: Si la lectura no es de los cursos del SOC o no es la de esa oferta.
    """
    if lectura["fuente"] != FUENTE or lectura["ambito"] != AMBITO:
        raise ErrorLecturaSoc("las declaraciones salen de una lectura de los cursos del SOC")
    cursos = cursos_de_la_oferta(leer_json_latin1(datos))
    if huella_de_ids(cursos) != lectura["ids_sha256"]:
        raise ErrorLecturaSoc("la oferta no es la de la captura de esta lectura")
    todas = {id: _declaraciones_del_curso(lectura["lectura_id"], fila) for id, fila in cursos.items()}
    return {id: declaradas for id, declaradas in todas.items() if declaradas}
