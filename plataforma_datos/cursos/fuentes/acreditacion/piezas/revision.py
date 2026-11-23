"""La revisión de las relaciones: se enseña lo que admite, con su cita, y se quita lo que descarta."""

import csv
import re
from collections.abc import Container
from datetime import date
from pathlib import Path
from typing import Any, NamedTuple

from plataforma_datos.comun.nucleo import RAIZ, ArchivoFaltante, ErrorFuente
from plataforma_datos.cursos.fuentes.acreditacion.piezas.constantes import (
    ADMITIDAS,
    CABECERA_DE_LA_REVISION,
    DESCARTADAS_EN_LA_REVISION,
    ESTRATOS_POR_OCUPACION,
    FUENTE,
    HUELLA_DE_LA_REGLA,
    JUICIOS_DE_LA_REVISION,
    LARGO_HUELLA_EN_LA_LISTA,
    MINIMO_DE_JUICIOS_C,
)
from plataforma_datos.cursos.fuentes.acreditacion.piezas.relacion_con_ocupaciones import (
    Cadena,
    Relaciones,
    de_los_grupos,
    sin_descartadas,
)

# ---------------------------------------------------------------------------------------------------------------------
# La revisión: se enseña lo que la revisión admite, lo proponga la regla o no
# ---------------------------------------------------------------------------------------------------------------------


class Revision(NamedTuple):
    """La procedencia de una relación admitida: cuándo se decidió, con qué regla, qué fila es y por qué se revisó."""

    fecha: str
    regla: str
    id: str
    estratos: frozenset[str]


# Campos de cada relación exportada: código del certificado y tipo de relación.
CAMPOS_DE_LA_RELACION = 2

# Columnas de la lista de relaciones descartadas por la revisión, en su orden.
CABECERA_DE_LAS_DESCARTADAS = ("esco", "certificado", "v2_A", "v2_B", "v3_A", "v3_B", "id")


def _no_se_puede_usar(ruta: Path, motivo: str) -> str:
    """El mensaje de una lista de la revisión que no se puede usar: no se exporta ninguna relación.

    Returns:
        El mensaje, con la ruta y el motivo.
    """
    return f"{FUENTE}: {ruta} no se puede usar ({motivo}); no se exporta ninguna relación sin revisar"


def _filas_completas(ruta: Path, cabecera: tuple[str, ...]) -> list[tuple[int, dict[str, str]]]:
    """Las filas de una lista TSV de la revisión, con su número de línea, si su forma es la esperada.

    csv.DictReader rellena con None las columnas que faltan en una fila corta y guarda bajo la clave None las que
    sobran: una fila así se rechaza con su línea en vez de fallar después sin decir dónde.

    Returns:
        Cada fila con el número de su línea en el archivo.

    Raises:
        ErrorFuente: Si no es UTF-8, la cabecera no es `cabecera` o alguna fila tiene columnas de menos o de más.
    """
    try:
        with ruta.open(newline="", encoding="utf-8") as archivo:
            lector = csv.DictReader(archivo, delimiter="\t")
            if tuple(lector.fieldnames or ()) != cabecera:
                raise ErrorFuente(_no_se_puede_usar(ruta, f"cabecera {lector.fieldnames}, no {list(cabecera)}"))
            filas: list[tuple[int, dict[str, str]]] = []
            for fila in lector:
                if None in fila or None in fila.values():
                    raise ErrorFuente(
                        _no_se_puede_usar(ruta, f"línea {lector.line_num}: fila con columnas de menos o de más")
                    )
                filas.append((lector.line_num, fila))
    except UnicodeDecodeError as error:
        raise ErrorFuente(_no_se_puede_usar(ruta, "contenido no válido como UTF-8")) from error
    return filas


def _con_su_cita(fila: dict[str, str]) -> bool:
    """La fila cumple la regla: al menos MINIMO_DE_JUICIOS_C de los cuatro juicios son C, y lleva la cita de uno.

    Que la cita sea literal lo comprueba la revisión (un C sin cita literal ya cuenta como D); aquí, que esté.

    Returns:
        Si la fila cumple la regla.
    """
    juicios_c = sum(fila[juicio] == "C" for juicio in JUICIOS_DE_LA_REVISION)
    return juicios_c >= MINIMO_DE_JUICIOS_C and bool(fila["cita"].strip())


def _fecha_iso(fecha: object) -> bool:
    """Comprueba una fecha de calendario escrita como AAAA-MM-DD con cifras ASCII.

    Returns:
        Si el valor es una fecha ISO válida.
    """
    if not isinstance(fecha, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", fecha):
        return False
    try:
        date.fromisoformat(fecha)
    except ValueError:
        return False
    return True


def _motivo_de_la_fila(fila: dict[str, str], huella: str) -> str | None:
    """Por qué una fila de la lista no vale, o None si vale.

    Returns:
        El motivo, o None si la fila vale.
    """
    if fila["decision"] != "C":
        return f"decision {fila['decision']!r}, no C"
    if fila["regla_sha256"] != huella:
        return f"regla {fila['regla_sha256']!r}, no la fijada ({huella})"
    if not _fecha_iso(fila["fecha"]):
        return f"fecha {fila['fecha']!r}, no ISO"
    if not re.fullmatch(r"R-[0-9a-f]{7}", fila["id"]):
        return f"id {fila['id']!r}, no R- y 7 cifras hexadecimales"
    if not _con_su_cita(fila):
        return f"sin {MINIMO_DE_JUICIOS_C} juicios C de {len(JUICIOS_DE_LA_REVISION)} o sin cita"
    return None


def leer_descartadas_en_la_revision(ruta: Path = DESCARTADAS_EN_LA_REVISION) -> set[tuple[str, str]]:
    """Las parejas (ocupación ESCO, certificado) que la revisión descartó.

    Sin la lista no se usa ninguna fuente que relacione certificados con grupos enteros.

    Returns:
        Las parejas descartadas.

    Raises:
        ArchivoFaltante: Si no está la lista.
        ErrorFuente: Si su cabecera o alguna fila no tienen la forma esperada, o si está vacía.
    """
    if not ruta.exists():
        raise ArchivoFaltante(f"{FUENTE}: falta la lista de relaciones descartadas por la revisión ({ruta})")
    filas = _filas_completas(ruta, CABECERA_DE_LAS_DESCARTADAS)
    if not filas:
        raise ErrorFuente(_no_se_puede_usar(ruta, "no tiene ninguna fila"))
    return {(fila["esco"], fila["certificado"]) for _, fila in filas}


def leer_admitidas(ruta: Path, regla: str | None) -> dict[tuple[str, str], Revision]:
    """Las parejas (ocupación ESCO, certificado) que admitió la revisión, con su procedencia.

    Comprueba la cabecera, la huella de la regla fijada, la decisión, la fecha, el id y la cita de cada fila, y que no
    se repita ninguna pareja. Cualquier fallo para la exportación: una lista a medias no se usa.

    Returns:
        Cada pareja admitida con su revisión.

    Raises:
        ArchivoFaltante: Si no está la lista.
        ErrorFuente: Si la cabecera, la regla o alguna fila no valen.
    """
    if not ruta.exists():
        raise ArchivoFaltante(
            f"{FUENTE}: falta la lista de relaciones admitidas por la revisión ({ruta}); sin ella no se exporta "
            "ninguna relación sin revisar. Copia ahí la admitidas.tsv del cierre de la revisión y fija "
            "HUELLA_DE_LA_REGLA con la huella de la decisión que la regula."
        )
    if not regla or not re.fullmatch(r"[0-9a-f]{64}", regla):
        motivo = "falta fijar HUELLA_DE_LA_REGLA, la huella SHA-256 de la decisión que la regula"
        raise ErrorFuente(_no_se_puede_usar(ruta, motivo))
    filas = _filas_completas(ruta, CABECERA_DE_LA_REVISION)
    admitidas: dict[tuple[str, str], Revision] = {}
    for numero, fila in filas:
        pareja = (fila["esco"], fila["certificado"])
        motivo = _motivo_de_la_fila(fila, regla[:LARGO_HUELLA_EN_LA_LISTA])
        if motivo is None and pareja in admitidas:
            motivo = "pareja repetida"
        if motivo is None and admitidas and fila["fecha"] != next(iter(admitidas.values())).fecha:
            motivo = f"fecha {fila['fecha']!r}, no la de la decisión, como las demás filas"
        if motivo:
            raise ErrorFuente(_no_se_puede_usar(ruta, f"línea {numero}, {pareja[0]}→{pareja[1]}: {motivo}"))
        estratos = frozenset(fila["estratos"].split(","))
        admitidas[pareja] = Revision(fila["fecha"], fila["regla_sha256"], fila["id"], estratos)
    return admitidas


def relacion_sin_proponer(revision: Revision) -> str:
    """El tipo de una relación admitida que la regla no propone, por sus estratos (ESTRATOS_POR_OCUPACION).

    Returns:
        El tipo de relación que le corresponde por sus estratos.
    """
    return "ocupacion" if revision.estratos & ESTRATOS_POR_OCUPACION else "grupo"


def lo_que_se_ensena(
    cadena: Cadena, propuestas: Relaciones, admitidas: dict[tuple[str, str], Revision], catalogo: Container[str]
) -> Relaciones:
    """Lo que se enseña: cada relación admitida con su ocupación y su certificado en el paquete, sin las descartadas.

    La revisión manda: una relación admitida entra aunque la regla no la proponga. Con el tipo de la regla si la
    propone y, si no, con el de sus estratos. Los grupos ISCO-08 se calculan por mayoría solo con esas.

    Returns:
        Las relaciones que se enseñan, por ocupación y por grupo.
    """
    por_ocupacion: dict[str, dict[str, str]] = {esco: {} for esco in propuestas.ocupaciones}
    for (esco, certificado), revision in sorted(admitidas.items()):
        if esco in por_ocupacion and certificado in catalogo:
            propuesta = propuestas.ocupaciones[esco].get(certificado)
            por_ocupacion[esco][certificado] = propuesta or relacion_sin_proponer(revision)
    por_ocupacion = {esco: sin_descartadas(esco, encontradas) for esco, encontradas in por_ocupacion.items()}
    return Relaciones(por_ocupacion, de_los_grupos(cadena, por_ocupacion))


def procedencia_de_la_revision(todas: Relaciones, admitidas: dict[tuple[str, str], Revision]) -> dict[str, Any]:
    """La procedencia de lo que se enseña, compacta: la regla, la fecha y la lista una vez, y el id de cada relación.

    Solo las relaciones de una ocupación llevan id (su fila en la lista); las de un grupo salen por mayoría de esas.

    Returns:
        La procedencia compacta de la revisión.
    """
    ids = {
        esco: {codigo: admitidas[esco, codigo].id for codigo in encontradas}
        for esco, encontradas in todas.ocupaciones.items()
        if encontradas
    }
    fechas = {revision.fecha for revision in admitidas.values()}
    return {
        "regla_sha256": HUELLA_DE_LA_REGLA,
        "fecha": min(fechas) if fechas else None,
        "lista": ADMITIDAS.relative_to(RAIZ).as_posix(),
        "ids": ids,
    }


def _faltas_de_ids(ocupaciones: dict[str, Any], ids: object) -> list[str]:
    """Comprueba las listas de relaciones y el objeto que identifica sus filas de revisión.

    Returns:
        Faltas de estructura o de identificadores, sin interpretar entradas dañadas como listas vacías.
    """
    if not isinstance(ids, dict):
        return ["falta el objeto «ids» de la revisión"]
    faltas: list[str] = []
    sin_id: list[str] = []
    for esco, lista in ocupaciones.items():
        if not isinstance(lista, list) or any(
            not isinstance(pareja, list)
            or len(pareja) != CAMPOS_DE_LA_RELACION
            or not all(isinstance(valor, str) for valor in pareja)
            for pareja in lista
        ):
            faltas.append(f"relaciones de {esco}: no es una lista de parejas de cadenas")
            continue
        de_la_ocupacion = ids.get(esco, {})
        if not isinstance(de_la_ocupacion, dict):
            faltas.append(f"ids de la revisión de {esco}: no es un objeto")
            continue
        sin_id.extend(
            f"{esco}→{codigo}"
            for codigo, _ in lista
            if not re.fullmatch(r"R-[0-9a-f]{7}", str(de_la_ocupacion.get(codigo)))
        )
    if sin_id:
        faltas.append(f"relaciones sin id de la revisión: {', '.join(sin_id[:20])}")
    return faltas


def faltas_de_procedencia(conjunto: dict[str, Any]) -> list[str]:
    """Lo que le falta a la procedencia de la revisión de un conjunto exportado: nada, si cada relación la tiene.

    La exige el compositor del paquete: la regla, la fecha, la lista y el id permiten rastrear cada
    relación hasta su fila. Los campos dañados se informan antes de escribir el paquete.

    Returns:
        Lo que falta, una línea por motivo; vacía si no falta nada.
    """
    revision = conjunto.get("revision")
    if not isinstance(revision, dict):
        return ["falta el bloque «revision»"]
    faltas = []
    if revision.get("regla_sha256") != HUELLA_DE_LA_REGLA:
        faltas.append(f"regla {revision.get('regla_sha256')!r}, no la fijada (HUELLA_DE_LA_REGLA)")
    if not _fecha_iso(revision.get("fecha")):
        faltas.append(f"fecha {revision.get('fecha')!r}, no ISO")
    lista = revision.get("lista")
    if not isinstance(lista, str) or not lista.strip():
        faltas.append(f"lista {lista!r}, falta la ruta de la lista de revisión")
    relaciones = conjunto.get("relaciones")
    if not isinstance(relaciones, dict) or not isinstance(relaciones.get("ocupaciones"), dict):
        faltas.append("falta el objeto «relaciones.ocupaciones»")
    else:
        faltas.extend(_faltas_de_ids(relaciones["ocupaciones"], revision.get("ids")))
    return faltas
