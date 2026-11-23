"""La lectura de la formación de Citilab: lo que cada descarga deja dicho en el registro de lecturas.

Al terminar de descargar las fichas y los dos vocabularios que las clasifican, la descarga entrega aquí las entradas de
procedencia que acaba de escribir y los totales que declaró la API, y se emite una lectura de las fichas. Es lo
primero que ocurre con la copia recibida, antes de preparar y validar: una copia que la validación deje pendiente
también queda registrada. Solo se registra: nada de lo que se publica cambia. La hora de la lectura es la del recibo de
la copia, nunca la del reloj.

Decisiones de esta fuente (la tabla de `lecturas/como-engancha-una-fuente-su-lectura.md`):

| Decisión | Citilab (formación) |
|---|---|
| Ámbitos | `citilab:formacio`: cada ficha de `/wp-json/wp/v2/formacio`, por su `id` |
| Hora de la lectura | la más reciente de las horas de recibo de las páginas de la copia (fichas y vocabularios) |
| Censo incompleto | nunca: cualquier página caída o descuadrada detiene la descarga (`paginacion.py`) antes de emitir |
| Total declarado | `x-wp-total` de las fichas, el que ya registra la descarga en `totales.formacio.total` |
| Vigente | sin fin publicado anterior al día de la lectura en Cataluña, como lo ofrece el motor |
| Forma | nivel `edicion` (cada ficha es una convocatoria con fechas); rutas `edicion.<campo>` de toda la copia |
| Vocabulario cerrado | `edicion.public` y `edicion.tipus-formacio`: los de la copia; `edicion.estat`: 532 y 533 |
| Explicar una salida | su fin publicado en los cursos preparados (lo que se ve) ya pasó el día de la lectura |
| Baja declarada | ninguna: la API no publica bajas; una ficha sale de la lista sin decir por qué |
| Declaraciones | `fin_publicado` por ficha con fin cierto: termina al acabar su día de fin en Cataluña |

El fin de una ficha sale del texto de su sección de duración, que sabe leer el lector; lo recibe quien llama. Un fin
anterior al inicio no dice cuándo acaba el curso: no cuenta como fin. `estat` es una taxonomía de la API cuyos nombres
no se descargan: no se interpreta, y sus dos términos conocidos son el vocabulario de la lectura, de modo que uno
nuevo queda anotado. Una ficha que sale sin haber llegado a su fin queda sin explicar.
"""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from typing import Any

from plataforma_datos.comun.dia_de_consulta import ZONA_DE_CATALUNA, dia_en_cataluna
from plataforma_datos.comun.entrada_salida import comprobar_huella, leer_json
from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.comun.nucleo import DATOS_RELATIVOS, ErrorFuente
from plataforma_datos.cursos.fuentes.citilab.constantes import CONSULTAS, FUENTE, VOCABULARIOS
from plataforma_datos.cursos.lecturas.contrato_lectura import FORMATO_INSTANTE, ValorNuevo, huella_de_ids
from plataforma_datos.cursos.lecturas.emision import Censo, Emision, emitir_lectura
from plataforma_datos.cursos.retirada_por_evidencia import Declaracion
from plataforma_datos.cursos.tipos_json import ObjetoJson

AMBITO = "citilab:formacio"
NIVELES = ("edicion",)
RECURSO = CONSULTAS[0][0]
# Los términos de `estat` que traen las copias conocidas, escritos como los anota un valor nuevo.
ESTADOS_CONOCIDOS = frozenset({"532", "533"})
# Las líneas de la sección de duración de una ficha, su fecha de inicio y su fecha de fin (cada una None si no consta).
Calendario = tuple[list[str], str | None, str | None]
LeerCalendario = Callable[[ObjetoJson], Calendario]


class ErrorLecturaCitilab(ValueError):
    """Lo que se pide no corresponde a una lectura de Citilab, a su carpeta de originales o a sus fichas."""


@dataclass(frozen=True, kw_only=True)
class Captura:
    """Lo que la descarga sabe de la copia recibida: hora, total declarado, fichas y términos de cada vocabulario."""

    observado_utc: str
    total_declarado: int
    fichas: tuple[ObjetoJson, ...]
    vocabularios: Mapping[str, frozenset[str]]


@dataclass(frozen=True, kw_only=True)
class Resultado:
    """La lectura emitida y lo que impidió emitirla o compararla con su historia (vacío si nada)."""

    emisiones: tuple[Emision, ...]
    problemas: tuple[str, ...]


def instante(texto: str) -> str:
    """Escribe un instante de recibo como lo guarda el registro de lecturas: en UTC y al segundo.

    Returns:
        El texto `AAAA-MM-DDTHH:MM:SSZ`.

    Raises:
        ErrorLecturaCitilab: Si el instante no dice su zona.
    """
    momento = datetime.fromisoformat(texto)
    if momento.tzinfo is None:
        raise ErrorLecturaCitilab("un instante sin zona no se puede situar en UTC")
    return momento.astimezone(UTC).strftime(FORMATO_INSTANTE)


def fin_cierto(inicio: str | None, fin: str | None) -> str | None:
    """El fin de un curso, si sus fechas no se contradicen: un fin anterior al inicio no dice cuándo acaba.

    Returns:
        El fin, o None si no consta o si es anterior al inicio.
    """
    return None if fin is None or (inicio is not None and fin < inicio) else fin


def ha_terminado(fin: str | None, dia: date) -> bool:
    """Si un curso con ese fin ya terminó el día de la lectura: el día de fin aún cuenta, como en el motor.

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


def _exigir_ficha(ficha: object) -> ObjetoJson:
    """Las fichas de la copia son objetos con el identificador y el texto que la lectura necesita.

    Returns:
        La misma ficha.

    Raises:
        ErrorLecturaCitilab: Si no es un objeto, no tiene un id entero positivo o no trae su texto renderizado.
    """
    contenido = ficha.get("content") if isinstance(ficha, dict) else None
    identificador = ficha.get("id") if isinstance(ficha, dict) else None
    legible = (
        type(identificador) is int
        and identificador > 0
        and isinstance(contenido, dict)
        and isinstance(contenido.get("rendered"), str)
    )
    if not legible:
        raise ErrorLecturaCitilab(f"una ficha de la copia no tiene id ni texto que leer: {str(ficha)[:80]}")
    return ficha


def _paginas(original: Path, entradas: Sequence[Mapping[str, str]]) -> list[Any]:
    """Los elementos de las páginas de un recurso, en su orden, comprobados con la huella de su procedencia.

    Returns:
        Los elementos de todas las páginas.

    Raises:
        ErrorLecturaCitilab: Si una página no es una lista.
    """
    elementos: list[Any] = []
    for entrada in entradas:
        pagina = leer_json(comprobar_huella(original / entrada["archivo"], entrada["sha256"]))
        if not isinstance(pagina, list):
            raise ErrorLecturaCitilab(f"{entrada['archivo']} no es una lista")
        elementos += pagina
    return elementos


def _por_recurso(
    registros: Sequence[Mapping[str, str]], totales: Mapping[str, Mapping[str, int]]
) -> dict[str, Sequence[Mapping[str, str]]]:
    """Reparte las entradas de procedencia entre los recursos: van en el orden de las consultas, una por página.

    Returns:
        Las entradas de cada recurso.

    Raises:
        ErrorLecturaCitilab: Si las entradas no son las páginas que declaran los totales.
    """
    repartidas: dict[str, Sequence[Mapping[str, str]]] = {}
    desde = 0
    for recurso, _, _ in CONSULTAS:
        hasta = desde + max(1, totales[recurso]["paginas"])
        repartidas[recurso] = registros[desde:hasta]
        desde = hasta
    if desde != len(registros):
        raise ErrorLecturaCitilab("las entradas de procedencia no son las páginas que declaran los totales")
    return repartidas


def _ids_de_terminos(vocabulario: list[Any]) -> frozenset[str]:
    return frozenset(str(termino["id"]) for termino in vocabulario if isinstance(termino, dict) and "id" in termino)


def _terminos_de(valor: object) -> list[object]:
    return valor if isinstance(valor, list) else [valor]


def leer_captura(
    original: Path, registros: Sequence[Mapping[str, str]], totales: Mapping[str, Mapping[str, int]]
) -> Captura:
    """Lee la copia recién descargada: fichas, términos de los vocabularios, total declarado y hora de recibo.

    Returns:
        La captura lista para calcular su censo.
    """
    entradas = _por_recurso(registros, totales)
    return Captura(
        observado_utc=max(instante(entrada["descargado_utc"]) for entrada in registros),
        total_declarado=totales[RECURSO]["total"],
        fichas=tuple(_exigir_ficha(ficha) for ficha in _paginas(original, entradas[RECURSO])),
        vocabularios={recurso: _ids_de_terminos(_paginas(original, entradas[recurso])) for recurso in VOCABULARIOS},
    )


def publicados(raiz: Path) -> dict[str, ObjetoJson]:
    """Los cursos que se ven hoy, tal como los dejó la última preparación: lo último que se supo de cada ficha.

    Returns:
        Los cursos preparados por identificador; vacío si la instalación aún no ha preparado ninguno.

    Raises:
        ErrorLecturaCitilab: Si los cursos preparados no tienen la forma que escribe la preparación.
    """
    ruta = raiz / DATOS_RELATIVOS / "preparados" / FUENTE / "cursos.json"
    if not ruta.is_file():
        return {}
    preparados = leer_json(ruta)
    cursos = preparados.get("cursos") if isinstance(preparados, dict) else None
    if not isinstance(cursos, list) or not all(isinstance(curso, dict) and "id" in curso for curso in cursos):
        raise ErrorLecturaCitilab(f"{ruta.name} no tiene la forma que escribe la preparación")
    return {str(curso["id"]): curso for curso in cursos}


def explicar_salida(conocidos: Mapping[str, ObjetoJson], dia: date) -> Callable[[str], str | None]:
    """Explica la salida de una ficha por su fin publicado, si ya pasó el día de la lectura.

    Returns:
        La función que la emisión aplica a cada ficha que sale.
    """

    def explicar(id: str) -> str | None:
        curso = conocidos.get(id) or {}
        return "fin_publicado" if ha_terminado(fin_cierto(curso.get("inicio"), curso.get("fin")), dia) else None

    return explicar


def valores_nuevos(captura: Captura) -> tuple[ValorNuevo, ...]:
    """Los términos de las fichas que su vocabulario no reconoce, con el campo en que aparecen.

    Returns:
        Cada término desconocido una sola vez por campo, en orden.
    """
    reconocidos = {**captura.vocabularios, "estat": ESTADOS_CONOCIDOS}
    nuevos = {
        ("edicion." + campo, str(termino))
        for ficha in captura.fichas
        for campo, validos in reconocidos.items()
        for termino in _terminos_de(ficha.get(campo, []))
        if str(termino) not in validos
    }
    return tuple(ValorNuevo(campo=campo, valor=termino) for campo, termino in sorted(nuevos))


def censo_de(captura: Captura, calendario: LeerCalendario, conocidos: Mapping[str, ObjetoJson]) -> Censo:
    """El censo de las fichas de una copia recibida.

    Returns:
        El censo listo para emitir; siempre completo, porque una copia incompleta no llega a emitirse.
    """
    dia = dia_en_cataluna(captura.observado_utc)
    fines = [fin_cierto(*calendario(ficha)[1:]) for ficha in captura.fichas]
    return Censo(
        fuente=FUENTE,
        ambito=AMBITO,
        observado_utc=captura.observado_utc,
        completa=True,
        ids=frozenset(str(ficha["id"]) for ficha in captura.fichas),
        recuento_bruto=len(captura.fichas),
        recuento_vigente=sum(not ha_terminado(fin, dia) for fin in fines),
        total_declarado=captura.total_declarado,
        niveles=NIVELES,
        rutas_de_campos=tuple(sorted({"edicion." + campo for ficha in captura.fichas for campo in ficha})),
        valores_nuevos=valores_nuevos(captura),
        explicar_salida=explicar_salida(conocidos, dia),
    )


def raiz_de(original: Path) -> Path:
    """La instalación a la que pertenece la carpeta de originales de Citilab.

    Returns:
        La raíz bajo la que viven `var/actualizacion/originales` y el registro de lecturas.

    Raises:
        ErrorLecturaCitilab: Si la carpeta no es la de originales de Citilab de una instalación.
    """
    niveles = len(DATOS_RELATIVOS.parts) + 1
    raiz = original.parents[niveles] if len(original.parents) > niveles else None
    if raiz is None or raiz / DATOS_RELATIVOS / "originales" / FUENTE != original:
        raise ErrorLecturaCitilab(f"{original} no es la carpeta de originales de Citilab de una instalación")
    return raiz


def emitir(
    original: Path,
    registros: Sequence[Mapping[str, str]],
    totales: Mapping[str, Mapping[str, int]],
    calendario: LeerCalendario,
) -> Resultado:
    """Emite la lectura de las fichas de una copia recién descargada.

    El registro es telemetría: si algo impide emitir la lectura, se dice en el resultado y la descarga sigue como
    habría seguido. Solo se recogen los errores de los datos (también los de la fuente, como un original que ya no
    tiene su huella) y del disco; un defecto del código no se esconde.

    Args:
        original: La carpeta de originales de Citilab de la instalación.
        registros: Las entradas de procedencia de las páginas descargadas, en el orden de las consultas.
        totales: Los totales que declaró la API por recurso (`total` y `paginas`).
        calendario: Lo que el lector lee de una ficha: sus líneas de duración, su inicio y su fin.

    Returns:
        La lectura emitida y los problemas, si los hubo.
    """
    try:
        raiz = raiz_de(original)
        censo = censo_de(leer_captura(original, registros, totales), calendario, publicados(raiz))
        emision = emitir_lectura(raiz, censo)
    except (OSError, ValueError, ErrorFuente) as error:
        return Resultado(emisiones=(), problemas=(f"la lectura de {AMBITO} no se pudo emitir ({error})",))
    return Resultado(emisiones=(emision,), problemas=emision.problemas)


def _declaracion_de_la_ficha(lectura_id: str, calendario: Calendario) -> tuple[Declaracion, ...]:
    """Lo que la ficha afirma de sí misma: su fin, con la huella de las líneas de duración de donde se lee.

    Returns:
        La declaración de su fin, o nada si no lo publica o si sus fechas se contradicen.
    """
    duracion, inicio, fin = calendario
    cierto = fin_cierto(inicio, fin)
    if cierto is None:
        return ()
    literal = sha256_json({"duracion": duracion})
    return (Declaracion(lectura_id=lectura_id, canal="fin_publicado", sha256=literal, cierra_el=cierre(cierto)),)


def declaraciones(
    lectura: ObjetoJson, fichas: Sequence[ObjetoJson], calendario: LeerCalendario
) -> dict[str, tuple[Declaracion, ...]]:
    """Las declaraciones de las fichas de una lectura, para la regla de retirada.

    Las fichas tienen que ser las de la copia de esa lectura: sus identificadores deben dar la huella de la lectura.

    Returns:
        Las declaraciones por identificador de ficha; una ficha sin nada declarado no aparece.

    Raises:
        ErrorLecturaCitilab: Si la lectura no es de la formación de Citilab o no es la de esas fichas.
    """
    if lectura["fuente"] != FUENTE or lectura["ambito"] != AMBITO:
        raise ErrorLecturaCitilab("las declaraciones salen de una lectura de la formación de Citilab")
    identificadas = {str(_exigir_ficha(ficha)["id"]): ficha for ficha in fichas}
    if huella_de_ids(identificadas) != lectura["ids_sha256"]:
        raise ErrorLecturaCitilab("las fichas no son las de la copia de esta lectura")
    todas = {
        id: _declaracion_de_la_ficha(lectura["lectura_id"], calendario(ficha)) for id, ficha in identificadas.items()
    }
    return {id: declaradas for id, declaradas in todas.items() if declaradas}
