"""La lectura del censo de Cibernàrium: lo que cada adquisición deja dicho en el registro de lecturas.

Al terminar de recibir el censo, la adquisición entrega aquí lo que ya sabe (la primera página, las actividades
leídas, si alguna página cayó y las ediciones del catálogo instalado) y se emiten dos lecturas, una por ámbito:
las ediciones y los programas. Solo se registra: nada de lo que se publica cambia.

Una salida se explica por su fin publicado cuando ya llegó a la hora de la lectura; la de un programa, cuando
terminaron todas sus ediciones conocidas. Cibernàrium no da de baja nada en su censo: su inscripción cerrada y la
falta de plazas son declaraciones de la fuente para la regla de retirada (`declaraciones`), no explicaciones de una
salida. La hora de la lectura es la de la captura, nunca la del reloj.
"""

from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.comun.nucleo import DATOS_RELATIVOS
from plataforma_datos.cursos.fuentes.barcelonactiva import edicion_ia, matricula_actual
from plataforma_datos.cursos.fuentes.barcelonactiva import robot_cibernarium as robot
from plataforma_datos.cursos.lecturas.contrato_lectura import FORMATO_INSTANTE, ValorNuevo, huella_de_ids
from plataforma_datos.cursos.lecturas.emision import Censo, Emision, emitir_lectura
from plataforma_datos.cursos.retirada_por_evidencia import Declaracion
from plataforma_datos.cursos.tipos_json import ObjetoJson

FUENTE = "barcelonactiva"
CANAL = "cibernarium"
AMBITO_EDICIONES = "cibernarium:edicion"
AMBITO_PROGRAMAS = "cibernarium:programa"
PREFIJO_PROGRAMA = "cibernarium:"
PREFIJO_EDICION = "cibernarium-edicion:"
# La API anida las ediciones en cada actividad; Cibernàrium no publica un nivel de programa aparte.
NIVELES = ("actividad", "edicion")
CAMPO_MATRICULA = "edicion.registrationCode"
# Los códigos de matrícula que la fuente reconoce: los del ámbito de IA y el cierre que acredita la matrícula actual
# (`matricula_actual.estado_inscripcion`). Cualquier otro es un valor nuevo en un vocabulario cerrado.
CODIGOS_DE_MATRICULA = edicion_ia.CODIGOS_INSCRIPCION | {"DISP2"}
# Lo que la matrícula actual lee como afirmación de la fuente, con el canal que espera la regla de retirada.
CANAL_DE_LA_MATRICULA = {"cerrada": "inscripcion_cerrada", "sin-plazas": "sin_plazas"}


class ErrorLecturaCibernarium(ValueError):
    """Lo que se pide no corresponde a una lectura de Cibernàrium o a su carpeta de originales."""


@dataclass(frozen=True, kw_only=True)
class Captura:
    """Lo que la adquisición sabe del censo recibido: hora, si llegó entero, el total que declara y sus actividades."""

    observado_utc: str
    completa: bool
    total_declarado: int
    actividades: tuple[ObjetoJson, ...]


@dataclass(frozen=True, kw_only=True)
class Resultado:
    """Las lecturas emitidas y lo que impidió emitirlas o compararlas con su historia (vacío si nada)."""

    emisiones: tuple[Emision, ...]
    problemas: tuple[str, ...]


def instante(momento: datetime) -> str:
    """Escribe un instante como lo guarda el registro de lecturas: en UTC y al segundo.

    Returns:
        El texto `AAAA-MM-DDTHH:MM:SSZ`.

    Raises:
        ErrorLecturaCibernarium: Si el instante no dice su zona.
    """
    if momento.tzinfo is None:
        raise ErrorLecturaCibernarium("un instante sin zona no se puede situar en UTC")
    return momento.astimezone(UTC).strftime(FORMATO_INSTANTE)


def _ediciones(captura: Captura) -> Iterator[tuple[ObjetoJson, ObjetoJson]]:
    for actividad in captura.actividades:
        for edicion in actividad["listEditions"]:
            yield actividad, edicion


def _fin_leido(actividad: ObjetoJson, edicion: ObjetoJson) -> datetime | None:
    """El fin publicado de una edición de la captura, tal como lo normaliza el robot del canal.

    Returns:
        El fin, o None si no se publica o si la edición no se puede interpretar (la adquisición ya la anota).
    """
    programa = PREFIJO_PROGRAMA + robot.identificador(actividad["activityId"])
    try:
        fin = robot.normalizar_edicion(programa, actividad, edicion)["datos"]["fechas_publicadas"]["fin"]
    except robot.ErrorRobot:
        return None
    return None if fin is None else datetime.fromisoformat(fin)


def _fin_conocido(edicion: ObjetoJson | None) -> datetime | None:
    """El fin publicado de una edición del catálogo instalado, que es lo último que se supo de ella.

    Returns:
        El fin, o None si no consta.

    Raises:
        ErrorLecturaCibernarium: Si el fin guardado no dice su zona.
    """
    fin = ((edicion or {}).get("datos", {}).get("fechas_publicadas") or {}).get("fin")
    if fin is None:
        return None
    momento = datetime.fromisoformat(fin)
    if momento.tzinfo is None:
        raise ErrorLecturaCibernarium(f"el fin guardado de {edicion.get('id')} no dice su zona")
    return momento


def _vigente(actividad: ObjetoJson, edicion: ObjetoJson, hora: datetime) -> bool:
    fin = _fin_leido(actividad, edicion)
    terminada = fin is not None and fin <= hora
    return not terminada and matricula_actual.estado_inscripcion(edicion) != "cerrada"


def _rutas_de_campos(captura: Captura) -> tuple[str, ...]:
    rutas = {"actividad." + campo for actividad in captura.actividades for campo in actividad}
    rutas.update("edicion." + campo for _, edicion in _ediciones(captura) for campo in edicion)
    return tuple(sorted(rutas))


def _valores_nuevos(captura: Captura) -> tuple[ValorNuevo, ...]:
    codigos = {edicion.get("registrationCode") for _, edicion in _ediciones(captura)}
    nuevos = sorted(c for c in codigos if isinstance(c, str) and c not in CODIGOS_DE_MATRICULA)
    return tuple(ValorNuevo(campo=CAMPO_MATRICULA, valor=codigo) for codigo in nuevos)


def _hora(captura: Captura) -> datetime:
    return datetime.strptime(captura.observado_utc, FORMATO_INSTANTE).replace(tzinfo=UTC)


def _comun(captura: Captura) -> ObjetoJson:
    """Lo que comparten las dos lecturas de una misma captura: fuente, hora, censo completo y forma.

    Returns:
        Los argumentos comunes del `Censo`.
    """
    return {
        "fuente": FUENTE,
        "observado_utc": captura.observado_utc,
        "completa": captura.completa,
        "motivo_incompleta": None if captura.completa else "consulta_fallida",
        "niveles": NIVELES,
        "rutas_de_campos": _rutas_de_campos(captura),
        "valores_nuevos": _valores_nuevos(captura),
    }


def explicar_edicion(conocidas: dict[str, ObjetoJson], hora: datetime) -> Callable[[str], str | None]:
    """Explica la salida de una edición por su fin publicado, si ya llegó a la hora de la lectura.

    Returns:
        La función que la emisión aplica a cada edición que sale.
    """

    def explicar(id: str) -> str | None:
        fin = _fin_conocido(conocidas.get(id))
        return "fin_publicado" if fin is not None and fin <= hora else None

    return explicar


def explicar_programa(conocidas: dict[str, ObjetoJson], hora: datetime) -> Callable[[str], str | None]:
    """Explica la salida de un programa cuando terminaron todas sus ediciones conocidas.

    Returns:
        La función que la emisión aplica a cada programa que sale.
    """

    def explicar(id: str) -> str | None:
        fines = [_fin_conocido(e) for e in conocidas.values() if e.get("programa_id") == id]
        return "fin_publicado" if fines and all(f is not None and f <= hora for f in fines) else None

    return explicar


def censo_de_ediciones(captura: Captura, conocidas: dict[str, ObjetoJson]) -> Censo:
    """El censo de las ediciones: cada `listEditions` de cada actividad recibida.

    La API no declara cuántas ediciones tiene: su total declarado no consta.

    Returns:
        El censo listo para emitir.
    """
    hora = _hora(captura)
    pares = list(_ediciones(captura))
    return Censo(
        **_comun(captura),
        ambito=AMBITO_EDICIONES,
        ids=frozenset(PREFIJO_EDICION + robot.identificador(e["activityId"]) for _, e in pares),
        recuento_bruto=len(pares),
        recuento_vigente=sum(_vigente(a, e, hora) for a, e in pares),
        explicar_salida=explicar_edicion(conocidas, hora),
    )


def censo_de_programas(captura: Captura, conocidas: dict[str, ObjetoJson]) -> Censo:
    """El censo de los programas: cada actividad recibida, con el total que declara la API.

    Returns:
        El censo listo para emitir.
    """
    hora = _hora(captura)
    return Censo(
        **_comun(captura),
        ambito=AMBITO_PROGRAMAS,
        ids=frozenset(PREFIJO_PROGRAMA + robot.identificador(a["activityId"]) for a in captura.actividades),
        recuento_bruto=len(captura.actividades),
        recuento_vigente=sum(any(_vigente(a, e, hora) for e in a["listEditions"]) for a in captura.actividades),
        total_declarado=captura.total_declarado,
        explicar_salida=explicar_programa(conocidas, hora),
    )


def raiz_de(original: Path) -> Path:
    """La instalación a la que pertenece la carpeta de originales del canal.

    Returns:
        La raíz bajo la que viven `var/actualizacion/originales` y el registro de lecturas.

    Raises:
        ErrorLecturaCibernarium: Si la carpeta no es la de originales de Cibernàrium de una instalación.
    """
    niveles = len(DATOS_RELATIVOS.parts) + 2
    raiz = original.parents[niveles] if len(original.parents) > niveles else None
    if raiz is None or raiz / DATOS_RELATIVOS / "originales" / FUENTE / CANAL != original:
        raise ErrorLecturaCibernarium(f"{original} no es la carpeta de originales de Cibernàrium de una instalación")
    return raiz


def emitir(
    original: Path,
    primera: ObjetoJson,
    actividades: list[ObjetoJson],
    conocidas: dict[str, ObjetoJson],
    *,
    completa: bool,
) -> Resultado:
    """Emite las lecturas de ediciones y de programas de un censo recién recibido.

    El registro es telemetría: si algo impide emitir una lectura, se dice en el resultado y la adquisición sigue
    como habría seguido. Solo se recogen los errores de los datos y del disco; un defecto del código no se esconde.

    Returns:
        Las lecturas emitidas y los problemas, si los hubo.
    """
    try:
        raiz = raiz_de(original)
        captura = Captura(
            observado_utc=instante(robot.fecha_utc(primera["fin_utc"])),
            completa=completa,
            total_declarado=primera["total_actividades"],
            actividades=tuple(actividades),
        )
        censos = (censo_de_ediciones(captura, conocidas), censo_de_programas(captura, conocidas))
    except (OSError, ValueError) as error:
        return Resultado(emisiones=(), problemas=(f"la lectura de Cibernàrium no se pudo preparar ({error})",))
    emisiones, problemas = [], []
    for censo in censos:
        try:
            emision = emitir_lectura(raiz, censo)
        except (OSError, ValueError) as error:
            problemas.append(f"la lectura de {censo.ambito} no se pudo emitir ({error})")
            continue
        emisiones.append(emision)
        problemas.extend(emision.problemas)
    return Resultado(emisiones=tuple(emisiones), problemas=tuple(problemas))


def _declaraciones_de_edicion(lectura_id: str, actividad: ObjetoJson, edicion: ObjetoJson) -> tuple[Declaracion, ...]:
    """Lo que la fuente afirma de una edición: su fin publicado y su inscripción cerrada o sin plazas.

    Cada declaración lleva la huella de los campos literales de la API que la sostienen.

    Returns:
        Las declaraciones de la edición en esa lectura.
    """
    declaradas = []
    fin = _fin_leido(actividad, edicion)
    if fin is not None:
        calendario = {"listSessions": edicion.get("listSessions"), "sessionsOnline": edicion.get("sessionsOnline")}
        declaradas.append(
            Declaracion(
                lectura_id=lectura_id, canal="fin_publicado", sha256=sha256_json(calendario), cierra_el=instante(fin)
            )
        )
    canal = CANAL_DE_LA_MATRICULA.get(matricula_actual.estado_inscripcion(edicion))
    if canal is not None:
        registro = {campo: edicion.get(campo) for campo in matricula_actual.REGISTRO}
        declaradas.append(Declaracion(lectura_id=lectura_id, canal=canal, sha256=sha256_json(registro)))
    return tuple(declaradas)


def declaraciones(lectura: ObjetoJson, actividades: list[ObjetoJson]) -> dict[str, tuple[Declaracion, ...]]:
    """Las declaraciones de la fuente sobre cada edición de una lectura, para la regla de retirada.

    Las actividades tienen que ser las de la captura de esa lectura: el conjunto de sus ediciones debe dar la huella
    de identificadores de la lectura.

    Returns:
        Las declaraciones por identificador de edición; una edición sin nada declarado no aparece.

    Raises:
        ErrorLecturaCibernarium: Si la lectura no es de las ediciones de Cibernàrium o no es la de esas actividades.
    """
    if lectura["fuente"] != FUENTE or lectura["ambito"] != AMBITO_EDICIONES:
        raise ErrorLecturaCibernarium("las declaraciones salen de una lectura de las ediciones de Cibernàrium")
    pares = [(a, e) for a in actividades for e in a["listEditions"]]
    ids = [PREFIJO_EDICION + robot.identificador(e["activityId"]) for _, e in pares]
    if huella_de_ids(ids) != lectura["ids_sha256"]:
        raise ErrorLecturaCibernarium("las actividades no son las de la captura de esta lectura")
    todas = {id: _declaraciones_de_edicion(lectura["lectura_id"], a, e) for id, (a, e) in zip(ids, pares, strict=True)}
    return {id: declaradas for id, declaradas in todas.items() if declaradas}
