"""La lectura de la oferta del Consorci: lo que cada descarga deja dicho en el registro de lecturas.

Al terminar de conservar la copia del día, la descarga entrega aquí su carpeta de originales y se emiten dos lecturas,
una por ámbito: las ediciones con fecha (qv5z-dgk3) y las acciones previstas sin fecha (hhvr-cedj). Se emiten antes de
que la validación decida si la copia se admite: una copia que luego no se admite también queda registrada. Solo se
registra: nada de lo que se publica cambia. La hora de cada lectura es la de la descarga de sus filas que anota la
procedencia, nunca la del reloj.

Decisiones de esta fuente (las de la tabla de `lecturas/como-engancha-una-fuente-su-lectura.md`), por ámbito:

| Decisión | Ediciones (`consorci:edicion`) | Acciones previstas (`consorci:prevista`) |
|---|---|---|
| Censo | cada edición de qv5z-dgk3 | cada acción de hhvr-cedj |
| Identificador | el de la preparación (`id_de_edicion`) | su `identificador` |
| Hora | `descargado_utc` de sus filas | `descargado_utc` de sus filas |
| Incompleto | con `LIMITE_FILAS` filas: `limite_alcanzado` | ídem |
| Total declarado | filas que dicen sus metadatos | ídem |
| Bruto | filas de la captura | filas de la captura |
| Vigente | las que no han terminado ese día | todas: no publican fecha |
| Forma | nivel `edicion`; rutas `edicion.<campo>` | nivel `programa`; rutas `programa.<campo>` |
| Vocabulario | `edicion.modalitat` (`MODALIDADES`) | `programa.modalitat` (`MODALIDADES_PREVISTAS`) |
| Explicar salida | su fin, que lleva el identificador | ninguna: ni fecha ni estado |
| Baja declarada | ninguna: no publica estados | ninguna |
| Declaraciones | `fin_publicado`, hasta el fin del día | ninguna |

Un censo no se declara incompleto por una consulta caída: la copia se conserva entera o no se conserva. Una edición o
una acción prevista que sale sin haber llegado a su fin queda sin explicar: el Consorci no dice nada de ellas. El día de
fin aún cuenta, como en el motor y en la validación (`momento_en`).
"""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from typing import Any

from plataforma_datos.comun.dia_de_consulta import ZONA_DE_CATALUNA, dia_en_cataluna
from plataforma_datos.comun.entrada_salida import entradas_procedencia, leer_json, original, procedencia
from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.comun.nucleo import DATOS_RELATIVOS, ErrorFuente
from plataforma_datos.comun.socrata import LIMITE_FILAS, Conjunto, metadatos, nombre_de_datos, nombre_de_metadatos
from plataforma_datos.comun.textos_y_cifras import texto
from plataforma_datos.cursos.fuentes.consorci.constantes import (
    ACCIONES,
    ACCIONES_PREVISTAS,
    FUENTE,
    MODALIDADES,
    MODALIDADES_PREVISTAS,
)
from plataforma_datos.cursos.fuentes.consorci.filas_publicadas import (
    fechas_de_la_edicion,
    id_de_edicion,
    modalidad_de_la_edicion,
)
from plataforma_datos.cursos.lecturas.contrato_lectura import FORMATO_INSTANTE, ValorNuevo, huella_de_ids
from plataforma_datos.cursos.lecturas.emision import Censo, Emision, emitir_lectura
from plataforma_datos.cursos.retirada_por_evidencia import Declaracion
from plataforma_datos.cursos.tipos_json import ObjetoJson

AMBITO_EDICIONES = "consorci:edicion"
AMBITO_PREVISTAS = "consorci:prevista"
# Las ediciones tienen fecha; las acciones previstas son el curso que una entidad puede programar, sin fecha.
NIVEL_DE_LAS_EDICIONES = "edicion"
NIVEL_DE_LAS_PREVISTAS = "programa"
CAMPO_MODALIDAD_DE_LAS_EDICIONES = "edicion.modalitat"
CAMPO_MODALIDAD_DE_LAS_PREVISTAS = "programa.modalitat"
# Lo que la preparación necesita de cada fila para identificarla y clasificarla.
CAMPOS_DE_LAS_EDICIONES = ("identificador", "num_grup", "data_inici", "data_final", "modalitat")
CAMPOS_DE_LAS_PREVISTAS = ("identificador", "modalitat")
# Sin uno de estos valores no hay identificador ni modalidad que anotar.
CAMPOS_CON_VALOR = ("identificador", "modalitat")
# Los campos de las fechas literales que sostienen el fin publicado de una edición.
CAMPOS_DEL_CALENDARIO = ("data_inici", "data_final")


class ErrorLecturaConsorci(ValueError):
    """Lo que se pide no corresponde a una lectura del Consorci o a su carpeta de originales."""


@dataclass(frozen=True, kw_only=True)
class Captura:
    """Lo que la copia conservada dice de un conjunto: la hora de su descarga, sus filas y las que declara tener."""

    observado_utc: str
    filas: tuple[ObjetoJson, ...]
    total_declarado: int


@dataclass(frozen=True, kw_only=True)
class Resultado:
    """Las lecturas emitidas y lo que impidió emitirlas o compararlas con su historia (vacío si nada)."""

    emisiones: tuple[Emision, ...]
    problemas: tuple[str, ...]


def instante(texto_del_instante: str) -> str:
    """Escribe el instante de una descarga como lo guarda el registro de lecturas: en UTC y al segundo.

    Returns:
        El texto `AAAA-MM-DDTHH:MM:SSZ`.

    Raises:
        ErrorLecturaConsorci: Si el instante no dice su zona.
    """
    momento = datetime.fromisoformat(texto_del_instante)
    if momento.tzinfo is None:
        raise ErrorLecturaConsorci("un instante sin zona no se puede situar en UTC")
    return momento.astimezone(UTC).strftime(FORMATO_INSTANTE)


def fin_publicado(inicio: str | None, fin: str | None) -> str | None:
    """El fin de una edición, si es un fin cierto: unas fechas que se contradicen no dicen que haya terminado.

    Returns:
        El fin, o None si no consta o si es anterior al inicio.
    """
    return None if fin is None or (inicio is not None and inicio > fin) else fin


def ha_terminado(fin: str | None, dia: date) -> bool:
    """Si una edición con ese fin ya terminó el día de la lectura: el día de fin aún cuenta, como en el motor.

    Returns:
        True si el fin consta y es anterior al día.
    """
    return fin is not None and date.fromisoformat(fin) < dia


def cierre(fin: str) -> str:
    """El instante en que termina el día de fin de una edición en Cataluña, en UTC.

    Returns:
        El comienzo del día siguiente en Cataluña, escrito en UTC y al segundo.
    """
    siguiente = datetime.combine(date.fromisoformat(fin) + timedelta(days=1), time(), tzinfo=ZONA_DE_CATALUNA)
    return siguiente.astimezone(UTC).strftime(FORMATO_INSTANTE)


def _fin_de_la_fila(fila: ObjetoJson) -> str | None:
    return fin_publicado(*fechas_de_la_edicion(id_de_edicion(fila)))


def _exigir_filas(filas: tuple[ObjetoJson, ...], campos: tuple[str, ...]) -> None:
    """Cada fila trae los campos con que la preparación la identifica, y con valor los que la nombran.

    Raises:
        ErrorLecturaConsorci: Si una fila no publica un campo o publica vacío uno que no puede faltar.
    """
    for numero, fila in enumerate(filas, start=1):
        for campo in campos:
            if campo not in fila:
                raise ErrorLecturaConsorci(f"la fila {numero} no publica «{campo}»")
            if campo in CAMPOS_CON_VALOR and not texto(fila[campo]):
                raise ErrorLecturaConsorci(f"la fila {numero} publica «{campo}» vacío")


def _rutas_de_campos(filas: tuple[ObjetoJson, ...], nivel: str) -> tuple[str, ...]:
    return tuple(sorted({f"{nivel}.{campo}" for fila in filas for campo in fila}))


def _valores_nuevos(valores: set[str], reconocidos: tuple[str, ...], campo: str) -> tuple[ValorNuevo, ...]:
    return tuple(ValorNuevo(campo=campo, valor=valor) for valor in sorted(valores - set(reconocidos)))


def _comun(captura: Captura) -> dict[str, Any]:
    """Lo que comparten las dos lecturas de una copia: fuente, hora, totales y si la descarga pudo cortarse.

    Returns:
        Los argumentos comunes del `Censo`.
    """
    completa = len(captura.filas) < LIMITE_FILAS
    return {
        "fuente": FUENTE,
        "observado_utc": captura.observado_utc,
        "completa": completa,
        "motivo_incompleta": None if completa else "limite_alcanzado",
        "recuento_bruto": len(captura.filas),
        "total_declarado": captura.total_declarado,
    }


def explicar_edicion(dia: date) -> Callable[[str], str | None]:
    """Explica la salida de una edición por su fin publicado, que lleva dentro su identificador.

    Returns:
        La función que la emisión aplica a cada edición que sale.
    """

    def explicar(id: str) -> str | None:
        return "fin_publicado" if ha_terminado(fin_publicado(*fechas_de_la_edicion(id)), dia) else None

    return explicar


def sin_explicacion(_id: str) -> None:
    """Una acción prevista no publica fecha ni estado: nada explica que salga de la lista.

    Returns:
        Siempre None.
    """
    return None


def censo_de_ediciones(captura: Captura) -> Censo:
    """El censo de las ediciones de la copia, con el total de filas que declara el conjunto.

    Returns:
        El censo listo para emitir.
    """
    _exigir_filas(captura.filas, CAMPOS_DE_LAS_EDICIONES)
    dia = dia_en_cataluna(captura.observado_utc)
    modalidades = {modalidad_de_la_edicion(fila) for fila in captura.filas}
    return Censo(
        **_comun(captura),
        ambito=AMBITO_EDICIONES,
        ids=frozenset(id_de_edicion(fila) for fila in captura.filas),
        recuento_vigente=sum(not ha_terminado(_fin_de_la_fila(fila), dia) for fila in captura.filas),
        niveles=(NIVEL_DE_LAS_EDICIONES,),
        rutas_de_campos=_rutas_de_campos(captura.filas, NIVEL_DE_LAS_EDICIONES),
        valores_nuevos=_valores_nuevos(modalidades, MODALIDADES, CAMPO_MODALIDAD_DE_LAS_EDICIONES),
        explicar_salida=explicar_edicion(dia),
    )


def censo_de_previstas(captura: Captura) -> Censo:
    """El censo de las acciones previstas de la copia: todas siguen previstas mientras la lista las publica.

    Returns:
        El censo listo para emitir.
    """
    _exigir_filas(captura.filas, CAMPOS_DE_LAS_PREVISTAS)
    modalidades = {texto(fila["modalitat"]) for fila in captura.filas}
    return Censo(
        **_comun(captura),
        ambito=AMBITO_PREVISTAS,
        ids=frozenset(texto(fila["identificador"]) for fila in captura.filas),
        recuento_vigente=len(captura.filas),
        niveles=(NIVEL_DE_LAS_PREVISTAS,),
        rutas_de_campos=_rutas_de_campos(captura.filas, NIVEL_DE_LAS_PREVISTAS),
        valores_nuevos=_valores_nuevos(modalidades, MODALIDADES_PREVISTAS, CAMPO_MODALIDAD_DE_LAS_PREVISTAS),
        explicar_salida=sin_explicacion,
    )


def leer_captura(carpeta: Path, conjunto: Conjunto) -> Captura:
    """Lo que la copia conservada en `carpeta` dice de un conjunto, con cada original comprobado contra su huella.

    Returns:
        La hora de su descarga, sus filas y las que declaran sus metadatos.

    Raises:
        ErrorLecturaConsorci: Si la procedencia no registra su descarga o sus filas no son una lista de objetos.
    """
    registrada = procedencia(FUENTE, carpeta)
    nombre = nombre_de_datos(conjunto, registrada["copia"])
    descargas = {entrada["archivo"]: entrada["descargado_utc"] for entrada in entradas_procedencia(registrada)}
    if nombre not in descargas:
        raise ErrorLecturaConsorci(f"la procedencia no registra la descarga de {nombre}")
    filas = leer_json(original(FUENTE, nombre, carpeta))
    if not isinstance(filas, list) or not all(isinstance(fila, dict) for fila in filas):
        raise ErrorLecturaConsorci(f"{nombre} no es una lista de filas")
    nombre_metadatos = nombre_de_metadatos(conjunto, registrada["copia"])
    declaradas = metadatos(leer_json(original(FUENTE, nombre_metadatos, carpeta)), nombre_metadatos)
    return Captura(
        observado_utc=instante(descargas[nombre]),
        filas=tuple(filas),
        total_declarado=declaradas["filas_segun_metadatos"],
    )


def raiz_de(carpeta: Path) -> Path:
    """La instalación a la que pertenece la carpeta de originales del Consorci.

    Returns:
        La raíz bajo la que viven `var/actualizacion/originales` y el registro de lecturas.

    Raises:
        ErrorLecturaConsorci: Si la carpeta no es la de originales del Consorci de una instalación.
    """
    niveles = len(DATOS_RELATIVOS.parts) + 1
    raiz = carpeta.parents[niveles] if len(carpeta.parents) > niveles else None
    if raiz is None or raiz / DATOS_RELATIVOS / "originales" / FUENTE != carpeta:
        raise ErrorLecturaConsorci(f"{carpeta} no es la carpeta de originales del Consorci de una instalación")
    return raiz


def emitir(carpeta: Path) -> Resultado:
    """Emite las lecturas de las ediciones y de las acciones previstas de la copia recién conservada.

    El registro es telemetría: si algo impide emitir una lectura, se dice en el resultado y la descarga sigue como
    habría seguido; la lectura de un ámbito no depende de la del otro. Solo se recogen los errores de los datos y del
    disco; un defecto del código no se esconde.

    Returns:
        Las lecturas emitidas y los problemas, si los hubo.
    """
    try:
        raiz = raiz_de(carpeta)
    except ErrorLecturaConsorci as error:
        return Resultado(emisiones=(), problemas=(f"las lecturas del Consorci no se pudieron emitir ({error})",))
    emisiones: list[Emision] = []
    problemas: list[str] = []
    for ambito, conjunto, censo_de in (
        (AMBITO_EDICIONES, ACCIONES, censo_de_ediciones),
        (AMBITO_PREVISTAS, ACCIONES_PREVISTAS, censo_de_previstas),
    ):
        try:
            emision = emitir_lectura(raiz, censo_de(leer_captura(carpeta, conjunto)))
        except (OSError, ValueError, ErrorFuente) as error:
            problemas.append(f"la lectura de {ambito} no se pudo emitir ({error})")
            continue
        emisiones.append(emision)
        problemas.extend(emision.problemas)
    return Resultado(emisiones=tuple(emisiones), problemas=tuple(problemas))


def _declaraciones_de_la_edicion(lectura_id: str, fila: ObjetoJson) -> tuple[Declaracion, ...]:
    """Lo que el Consorci afirma de una edición: solo su fin publicado, con la huella de sus fechas literales.

    Returns:
        La declaración de su fin, o nada si no lo publica o si sus fechas se contradicen.
    """
    fin = _fin_de_la_fila(fila)
    if fin is None:
        return ()
    literal = {campo: fila[campo] for campo in CAMPOS_DEL_CALENDARIO}
    return (
        Declaracion(lectura_id=lectura_id, canal="fin_publicado", sha256=sha256_json(literal), cierra_el=cierre(fin)),
    )


def declaraciones(lectura: ObjetoJson, filas: list[ObjetoJson]) -> dict[str, tuple[Declaracion, ...]]:
    """Las declaraciones del Consorci sobre cada edición de una lectura, para la regla de retirada.

    Las filas tienen que ser las de la captura de esa lectura: sus ediciones deben dar la huella de identificadores.

    Returns:
        Las declaraciones por identificador de edición; una edición sin nada declarado no aparece.

    Raises:
        ErrorLecturaConsorci: Si la lectura no es de las ediciones del Consorci o no es la de esas filas.
    """
    if lectura["fuente"] != FUENTE or lectura["ambito"] != AMBITO_EDICIONES:
        raise ErrorLecturaConsorci("las declaraciones salen de una lectura de las ediciones del Consorci")
    _exigir_filas(tuple(filas), CAMPOS_DE_LAS_EDICIONES)
    por_edicion: dict[str, ObjetoJson] = {}
    for fila in filas:
        por_edicion.setdefault(id_de_edicion(fila), fila)
    if huella_de_ids(por_edicion) != lectura["ids_sha256"]:
        raise ErrorLecturaConsorci("las filas no son las de la captura de esta lectura")
    todas = {id: _declaraciones_de_la_edicion(lectura["lectura_id"], fila) for id, fila in por_edicion.items()}
    return {id: declaradas for id, declaradas in todas.items() if declaradas}
