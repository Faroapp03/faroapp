"""Personas ocupadas por ocupación, desde 2021: censos del INE, publicado por el Idescat para Cataluña.

Dos nodos del Idescat (API Taules, JSON-stat), a 1 de enero de cada año: 17980 (tabla 21518, Cataluña, CNO-11
a 3 cifras y sexo) y 17977 (tabla 21517, CNO-11 a 2 cifras y sexo) para Cataluña, el Baix Llobregat, el
Barcelonès y sus municipios de 10.000 habitantes o más, que son los que publica. Dos tablas del INE (Tempus)
sirven de control: la 69959 (Cataluña, 2 cifras) y la 69979 (las ciudades que publica, nueve de ellas en esas
dos comarcas). La pertenencia de cada municipio a su comarca sale del nomenclátor del Idescat (El municipi en
xifres, nodos).

Controles con alarma: la tabla de la Cambra que Faro ya guarda es la 17980 de 2022 (163 de 163 grupos iguales, por
sexo); el año 2021 cuadra con el Censo 2021 del INE que usa `mercado/fuentes/cataluna/lector.py`; el Idescat cuadra con
el INE en Cataluña y en las nueve ciudades; las sumas cuadran con sus totales dentro del redondeo publicado.

En el informe: contexto del grupo de ocupación, en un bloque aparte de la nota. 2021 sale del censo decenal y desde 2022
del anual, con otro método: la variación solo se da desde 2022. El paquete lleva los años comparables y solo las
cifras de 100 personas o más. Depende de las validaciones de clasificaciones, cambra y cataluna. Python estándar.

Uso: python3 -m plataforma_datos.mercado.fuentes.ocupados.lector {descargar,preparar,validar,todo} [--aceptar-cambio]
"""

import itertools
import json
import math
import re
import sys
from collections.abc import Iterable, Mapping
from typing import Any

from plataforma_datos.comun.entrada_salida import (
    ahora_utc,
    comprobar_originales,
    controles_de_huella,
    guardar_json,
    guardar_jsonl,
    leer_json,
    leer_jsonl,
    original,
)
from plataforma_datos.comun.estadisticas import (
    CITA_IDESCAT,
    LICENCIA_TEXTO_IDESCAT,
    LICENCIA_TEXTO_INE,
    VARIABLE_OCUPACIONES,
    celdas_jsonstat,
    celdas_tempus,
    etiquetas_jsonstat,
)
from plataforma_datos.comun.lugares import CODIGO_INE_DE_CATALUNA, COMARCAS_DE_LA_ZONA
from plataforma_datos.comun.nucleo import Controles, ValidacionFallida, exigir
from plataforma_datos.comun.red import descargar_originales
from plataforma_datos.comun.textos_y_cifras import numero_es, pct
from plataforma_datos.mercado.fuentes.ocupados.piezas.constantes_ocupados import (
    ANIOS,
    ANIOS_HISTORICOS,
    ARCHIVOS,
    ARCHIVOS_AUXILIARES,
    CATALUNA_CNO3,
    CATALUNA_IDESCAT,
    CIUDADES_INE,
    CONTEXTO,
    CONTRASTE_CON_EL_CENSO_2021,
    CONTROL_INE,
    DESCUADRE_POR_SEXO,
    DIMENSION_OCUPACION,
    ESPECIALES,
    FUENTE,
    IDESCAT_PARTES,
    LICENCIA,
    MAX_PROCEDENCIA_BYTES,
    METADATOS_IDESCAT,
    MIN_PERSONAS,
    MUNICIPIOS,
    NO_PUBLICADO,
    NOMENCLATOR,
    ORIGINAL,
    PLANTILLA_CITA,
    PLANTILLA_DEL_TITULO,
    PLANTILLA_NOMBRE_FUENTE,
    PRIMER_ANIO_COMPARABLE,
    PROCEDENCIA,
    REDONDEO_IDESCAT,
    SEXO_IDESCAT,
    SEXO_INE,
    SEXOS,
    SIN_CIFRA_A_3,
    SUBGRUPO_CON_CIFRA_A_2,
    TABLA_17977,
    TABLA_17980,
    TABLA_69959,
    TABLA_69979,
    TERRITORIOS_CNO2,
)
from plataforma_datos.mercado.fuentes.ocupados.piezas.ocupados_idescat import (
    comprobar_datos,
    comprobar_plan,
    planificar_partes,
    tablas_del_plan,
)
from plataforma_datos.mercado.fuentes.ocupados.piezas.ocupados_idescat import fecha_actualizada as _fecha_actualizada
from plataforma_datos.mercado.fuentes.ocupados.piezas.rotulos_ocupados import de_los_anios
from plataforma_datos.ocupaciones.fuentes.clasificaciones.lector import (
    CODIGO_NO_CONSTA,
    TOTAL_OCUPACIONES,
    codigos_en_cno,
)
from plataforma_datos.orquestacion.admision import cerrar_validacion, leer_validado
from plataforma_datos.orquestacion.ordenes import principal_fuente_con_descarga

# Las dimensiones de las tablas JSON-stat del Idescat y las variables de las tablas de Tempus del INE.
DIMENSION_ANIO = "YEAR"
DIMENSION_SEXO = "SEX"
DIMENSION_CATALUNA = "CAT"
DIMENSION_COMARCA = "COM"
DIMENSION_MUNICIPIO = "MUN"
VARIABLE_SEXO_INE = "Sexo"
VARIABLE_COMUNIDADES_INE = "Comunidades y Ciudades Autónomas"
VARIABLE_MUNICIPIOS_INE = "Municipios"
# El año del Censo 2021 del INE (`mercado/fuentes/cataluna/lector.py`) y el de la tabla de la Cambra
# (`ia_y_trabajo/fuentes/cambra/lector.py`), con los que se contrasta.
ANIO_DEL_CENSO_2021 = "2021"
ANIO_DE_LA_CAMBRA = "2022"
# Lo que estas cifras son y no son; se publica en la validación.
PLANTILLA_LIMITES = (
    "Datos del grupo de ocupación, no de personas. La ocupación del censo sale de registros administrativos "
    "(contratos, en su mayoría) y una parte la imputa el INE. 2021 es el censo decenal y {periodo_anual} el anual, con "
    "otro método: solo se comparan {comparables}. Es población ocupada que reside en el territorio, no contratación ni "
    "vacantes. Cifras redondeadas al azar a múltiplos de 3 por el Idescat."
)
LIMITES = de_los_anios(PLANTILLA_LIMITES, ANIOS_HISTORICOS)

# Piezas internas


def _codigo_idescat(codigo: str) -> str:
    """Traduce un código del Idescat, que lleva delante la letra del grupo principal («E430» → «430»).

    Args:
        codigo: El código del Idescat.

    Returns:
        El código CNO-11 (o el nombre del total y de «no consta»).
    """
    return ESPECIALES.get(codigo, codigo[1:])


def _codigo_ine(codigo: str) -> str:
    """Traduce un código de Tempus; el total y «No consta» llegan por su nombre.

    Args:
        codigo: El código de Tempus.

    Returns:
        El código CNO-11 (o el nombre del total y de «no consta»).
    """
    return ESPECIALES.get(codigo, codigo)


def _anadir(
    filas: dict[tuple[str, str, str], dict[str, Any]], clave: tuple[str, str, str], sexo: str, valor: int | None
) -> None:
    """Pone la cifra de un sexo en la fila de su territorio, grupo y año (la crea la primera vez).

    Args:
        filas: Las filas por (territorio, grupo, año); se modifica.
        clave: (territorio, grupo, año).
        sexo: «hombres», «mujeres» o «total».
        valor: La cifra, o None si no se publica.
    """
    fila = filas.setdefault(clave, {"territorio": clave[0], "cno11": clave[1], "anio": clave[2]})
    exigir(sexo not in fila, f"ocupados: observación duplicada {clave}, {sexo}")
    fila[sexo] = valor


def _anios(filas: Iterable[dict[str, Any]]) -> tuple[str, ...]:
    """Lee los años canónicos de las observaciones, sin deducirlos del reloj.

    Returns:
        Años observados en orden cronológico.
    """
    anios = {fila["anio"] for fila in filas}
    exigir(
        bool(anios)
        and all(
            isinstance(anio, str) and re.fullmatch(r"[0-9]{4}", anio) and anio >= ANIO_DEL_CENSO_2021 for anio in anios
        ),
        "ocupados: año ausente o no anual canónico desde 2021",
    )
    return tuple(sorted(anios))


def _personas(valor: object) -> int | None:
    """Exige un recuento entero no negativo, sin convertir porcentajes o unidades.

    Returns:
        Personas publicadas o None.
    """
    exigir(
        valor is None
        or (
            isinstance(valor, (int, float))
            and not isinstance(valor, bool)
            and math.isfinite(valor)
            and valor >= 0
            and valor == int(valor)
        ),
        f"ocupados: recuento de personas no válido: {valor!r}",
    )
    return None if valor is None else int(valor)


def _comprobar_tabla_idescat(tabla: dict[str, Any], territorio: str) -> None:
    """Comprueba el contrato de una captura histórica completa."""
    comprobar_datos(tabla, territorio)


def _filas_idescat(nombre: str, dimension_territorio: str) -> list[dict[str, Any]]:
    """Lee las filas de una tabla del Idescat: territorio, grupo, año y las cifras de hombres, mujeres y total.

    Una cifra que el Idescat no publica («..», confidencial o poco fiable) queda como `None`.

    Args:
        nombre: El archivo de la tabla.
        dimension_territorio: La dimensión del territorio en la tabla.

    Returns:
        Una fila por territorio, grupo y año.
    """
    tabla = leer_json(original(FUENTE, nombre))
    _comprobar_tabla_idescat(tabla, dimension_territorio)
    return _filas_de_tabla(tabla, dimension_territorio)


def _filas_de_tabla(tabla: dict[str, Any], dimension_territorio: str) -> list[dict[str, Any]]:
    """Lee celdas de una tabla completa o parte cuyo alcance ya se ha comprobado.

    Returns:
        Filas por territorio, grupo y año, con los tres sexos.
    """
    filas: dict[tuple[str, str, str], dict[str, Any]] = {}
    for celda in celdas_jsonstat(tabla):
        exigir(celda.estado in (None, NO_PUBLICADO), f"ocupados Idescat: estado desconocido {celda.estado!r}")
        exigir(celda.valor is not None or celda.estado == NO_PUBLICADO, "ocupados Idescat: cifra ausente sin estado")
        valor = None if celda.estado == NO_PUBLICADO else _personas(celda.valor)
        codigo = _codigo_idescat(celda.claves[DIMENSION_OCUPACION])
        clave = (celda.claves[dimension_territorio], codigo, celda.claves[DIMENSION_ANIO])
        _anadir(filas, clave, SEXO_IDESCAT[celda.claves[DIMENSION_SEXO]], valor)
    return list(filas.values())


def _nombres_de_territorios(tablas: Mapping[str, dict[str, Any]] | None = None) -> dict[str, str]:
    """Lee el nombre de cada comarca y municipio tal como lo publica el Idescat en la tabla 17977.

    Returns:
        Código del territorio → su nombre.
    """
    nombres = {}
    for nivel, dimension in (("comarca", DIMENSION_COMARCA), ("municipio", DIMENSION_MUNICIPIO)):
        tabla = tablas[TABLA_17977[nivel]] if tablas is not None else leer_json(original(FUENTE, TABLA_17977[nivel]))
        nombres.update(etiquetas_jsonstat(tabla, dimension))
    return nombres


def _comprobar_tabla_ine(tabla: list[dict[str, Any]], territorio: str) -> None:
    """Comprueba base, unidad, sexo y referencia anual de las series de control del INE."""
    exigir(isinstance(tabla, list) and bool(tabla), "ocupados INE: no hay series")
    variables = {territorio, VARIABLE_OCUPACIONES, VARIABLE_SEXO_INE, "Tipo de dato", "Relación con la actividad"}
    for serie in tabla:
        exigir(
            serie.get("T3_Unidad") == "Personas" and serie.get("T3_Escala") == " ",
            "ocupados INE: unidad o escala distinta de personas",
        )
        metadatos = serie.get("MetaData", [])
        exigir(
            len(metadatos) == len(variables) and {m.get("T3_Variable") for m in metadatos} == variables,
            "ocupados INE: dimensiones distintas o duplicadas",
        )
        codigos = {m["T3_Variable"]: m.get("Codigo") or m.get("Nombre") for m in metadatos}
        exigir(
            codigos["Tipo de dato"] == "Dato base"
            and codigos["Relación con la actividad"] == "2"
            and codigos[VARIABLE_SEXO_INE] in SEXO_INE,
            "ocupados INE: base, actividad o sexo distinto",
        )
        exigir(isinstance(serie.get("Data"), list) and bool(serie["Data"]), "ocupados INE: serie sin datos")
        for dato in serie["Data"]:
            anio = dato.get("Anyo")
            exigir(
                type(anio) is int and ANIO_DEL_CENSO_2021 <= str(anio) <= "9999",
                f"ocupados INE: año no válido {anio!r}",
            )
            exigir(
                dato.get("T3_Periodo") == "A" and dato.get("T3_TipoDato") == "Definitivo" and not dato.get("Notas"),
                "ocupados INE: periodo, estado o notas no compatibles",
            )
            fecha = dato.get("Fecha")
            exigir(
                isinstance(fecha, str)
                and re.fullmatch(rf"{anio}-01-01T00:00:00(?:\.0+)?(?:Z|[+-][0-9]{{2}}:[0-9]{{2}})", fecha) is not None,
                f"ocupados INE: fecha distinta del 1 de enero de {anio}: {fecha!r}",
            )


def _filas_ine(nombre: str, variable_territorio: str) -> list[dict[str, Any]]:
    """Lee las filas de una tabla de Tempus del censo anual con la misma forma que las del Idescat.

    Args:
        nombre: El archivo de la tabla.
        variable_territorio: La variable del territorio en la tabla.

    Returns:
        Una fila por territorio, grupo y año, con el nombre de la tabla.
    """
    filas: dict[tuple[str, str, str], dict[str, Any]] = {}
    tabla = leer_json(original(FUENTE, nombre))
    _comprobar_tabla_ine(tabla, variable_territorio)
    for celda in celdas_tempus(tabla):
        territorio = celda.codigos[variable_territorio]
        clave = (territorio, _codigo_ine(celda.codigos[VARIABLE_OCUPACIONES]), str(celda.anio))
        exigir(celda.valor is not None, "ocupados INE: recuento ausente en el control")
        valor = _personas(celda.valor)
        _anadir(filas, clave, SEXO_INE[celda.codigos[VARIABLE_SEXO_INE]], valor)
    return [dict(fila, tabla=nombre) for fila in filas.values()]


def _comarcas_del_nomenclator() -> dict[str, str]:
    """Lee la comarca de cada municipio en el nomenclátor del Idescat (los nodos de El municipi en xifres).

    Returns:
        Código del municipio → código de su comarca.

    Raises:
        FormatoInesperado: Si la respuesta no tiene la lista `fitxes.v` de comarcas, cada una con su `id` y sus
            municipios (`v`), cada uno con su `id`.
    """
    respuesta = leer_json(original(FUENTE, NOMENCLATOR))
    fichas = respuesta.get("fitxes") if isinstance(respuesta, dict) else None
    nodos = fichas.get("v") if isinstance(fichas, dict) else None
    exigir(isinstance(nodos, list), f"{NOMENCLATOR}: no trae la lista fitxes.v de comarcas")
    comarca_de = {}
    for comarca in nodos:
        exigir(isinstance(comarca, dict) and "id" in comarca and "v" in comarca, f"{NOMENCLATOR}: comarca sin id o v")
        municipios = comarca["v"] if isinstance(comarca["v"], list) else [comarca["v"]]
        exigir(
            all(isinstance(municipio, dict) and "id" in municipio for municipio in municipios),
            f"{NOMENCLATOR}: un municipio de la comarca {comarca['id']} no tiene id",
        )
        comarca_de.update({municipio["id"]: comarca["id"] for municipio in municipios})
    return comarca_de


def _ordenadas(filas: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Ordena las filas por (territorio, grupo, año), para que preparar escriba siempre lo mismo.

    Args:
        filas: Las filas.

    Returns:
        Las filas ordenadas.
    """
    return sorted(filas, key=lambda fila: (fila["territorio"], fila["cno11"], fila["anio"]))


def _contexto(tablas: Mapping[str, dict[str, Any]] | None = None) -> dict[str, Any]:
    """Reúne las notas, los territorios y una fecha de actualización conservadora de las cuatro tablas.

    Usa la más antigua para no atribuir la publicación más reciente de una tabla a las demás.

    Returns:
        El contexto que se guarda junto a los preparados.

    Raises:
        FormatoInesperado: Si la tabla no trae su fecha de actualización (`updated`) o su fuente (`source`).
    """
    if tablas is None:
        tablas = {nombre: leer_json(original(FUENTE, nombre)) for nombre in (TABLA_17980, *TABLA_17977.values())}
    tabla = tablas[TABLA_17977["municipio"]]
    exigir(
        isinstance(tabla, dict) and "updated" in tabla and "source" in tabla,
        f"{TABLA_17977['municipio']}: sin fecha de actualización (updated) o sin fuente (source)",
    )
    fechas = [_fecha_actualizada(contenido.get("updated")) for contenido in tablas.values()]
    comarca_de = _comarcas_del_nomenclator()
    return {
        "actualizado_idescat": min(fechas).isoformat(),
        "fuente_idescat": tabla["source"],
        "notas_idescat": tabla.get("note", []),
        "nombres": _nombres_de_territorios(tablas),
        "comarca_de": {municipio: comarca_de.get(municipio) for municipio in MUNICIPIOS},
    }


def _indice(filas: Iterable[dict[str, Any]]) -> dict[tuple[str, str, str], dict[str, Any]]:
    """Indexa las filas por (territorio, grupo, año).

    Args:
        filas: Las filas.

    Returns:
        Cada fila por su clave.
    """
    return {(fila["territorio"], fila["cno11"], fila["anio"]): fila for fila in filas}


def _grupos(filas: Iterable[dict[str, Any]]) -> set[str]:
    """Reúne los códigos CNO-11 de unas filas, sin el total ni «no consta».

    Args:
        filas: Las filas.

    Returns:
        Los códigos de grupo.
    """
    return {fila["cno11"] for fila in filas} - {TOTAL_OCUPACIONES, CODIGO_NO_CONSTA}


def _diferencias(
    unas: dict[tuple[str, str, str], dict[str, Any]], otras: dict[tuple[str, str, str], dict[str, Any]]
) -> list[int]:
    """Calcula la diferencia absoluta de cada cifra publicada en las dos tablas, para las claves que tienen las dos.

    Args:
        unas: Las filas de una tabla por clave.
        otras: Las de la otra.

    Returns:
        Las diferencias, en personas.
    """
    return [
        abs(unas[clave][sexo] - otras[clave][sexo])
        for clave in unas.keys() & otras.keys()
        for sexo in SEXOS
        if unas[clave].get(sexo) is not None and otras[clave].get(sexo) is not None
    ]


def _descuadre_suma(filas: list[dict[str, Any]], anio: str, sexo: str) -> tuple[int, int]:
    """Compara el total de Cataluña con la suma de sus grupos (con «no consta»).

    Args:
        filas: Las filas de la tabla 17980.
        anio: El año.
        sexo: «hombres», «mujeres» o «total».

    Returns:
        La diferencia absoluta, en personas, y cuántas cifras se suman.

    Raises:
        ValidacionFallida: Si la tabla no trae el total de Cataluña de ese año y sexo.
    """
    del_anio = [fila for fila in filas if fila["anio"] == anio and fila["cno11"] != TOTAL_OCUPACIONES]
    sumandos = [fila[sexo] for fila in del_anio if fila[sexo] is not None]
    total = next((fila[sexo] for fila in filas if fila["anio"] == anio and fila["cno11"] == TOTAL_OCUPACIONES), None)
    exigir(total is not None, f"la tabla 17980 no trae el total de Cataluña de {anio} ({sexo})", ValidacionFallida)
    return abs(total - sum(sumandos)), len(sumandos)


def _matriz_completa(
    filas: list[dict[str, Any]], territorios: Iterable[str], grupos: set[str], descripcion: str
) -> tuple[str, ...]:
    """Exige todas las combinaciones solicitadas en cada periodo observado.

    Returns:
        Los años de la matriz completa.
    """
    anios = _anios(filas)
    exigir(
        set(ANIOS) <= set(anios) and list(anios) == [str(anio) for anio in range(int(anios[0]), int(anios[-1]) + 1)],
        f"ocupados {descripcion}: años históricos ausentes o serie con huecos",
        ValidacionFallida,
    )
    claves = [(fila["territorio"], fila["cno11"], fila["anio"]) for fila in filas]
    esperadas = set(itertools.product(territorios, grupos, anios))
    exigir(
        len(claves) == len(set(claves)) and set(claves) == esperadas,
        f"ocupados {descripcion}: matriz incompleta, duplicada o con territorio/grupo no solicitado",
        ValidacionFallida,
    )
    for fila in filas:
        exigir(all(sexo in fila for sexo in SEXOS), f"ocupados {descripcion}: sexos incompletos", ValidacionFallida)
        for sexo in SEXOS:
            _personas(fila[sexo])
    return anios


def _comprobar_cobertura(
    cno3: list[dict[str, Any]], cno2: list[dict[str, Any]], ine: list[dict[str, Any]], cno: dict[str, Any]
) -> None:
    """Exige cobertura fija del producto y periodos completos antes de publicar un año nuevo."""
    especiales = {TOTAL_OCUPACIONES, CODIGO_NO_CONSTA}
    grupos3 = {codigo for codigo, grupo in cno.items() if grupo["nivel"] == "3"} | especiales
    grupos2 = {codigo for codigo, grupo in cno.items() if grupo["nivel"] == "2"} | especiales
    anios3 = _matriz_completa(cno3, (CATALUNA_IDESCAT,), grupos3, "17980")
    anios2 = _matriz_completa(cno2, (CATALUNA_IDESCAT, *COMARCAS_DE_LA_ZONA, *MUNICIPIOS), grupos2, "17977")
    exigir(anios3 == anios2, "ocupados Idescat: años distintos entre tablas o territorios", ValidacionFallida)
    for filas, no_publicados, descripcion in ((cno3, SIN_CIFRA_A_3, "17980"), (cno2, {"00"}, "17977")):
        exigir(
            all((fila[sexo] is None) == (fila["cno11"] in no_publicados) for fila in filas for sexo in SEXOS),
            f"ocupados {descripcion}: supresiones distintas o recuentos incompletos",
            ValidacionFallida,
        )
    exigir(
        all(fila.get("tabla") in (TABLA_69959, TABLA_69979) for fila in ine),
        "ocupados INE: tabla de control no solicitada",
        ValidacionFallida,
    )
    for tabla, territorios in ((TABLA_69959, (CODIGO_INE_DE_CATALUNA,)), (TABLA_69979, CIUDADES_INE)):
        del_ine = [fila for fila in ine if fila["tabla"] == tabla]
        _matriz_completa(del_ine, territorios, grupos2 - {"00"}, tabla)
        exigir(
            all(fila[sexo] is not None for fila in del_ine for sexo in SEXOS),
            f"ocupados {tabla}: recuentos incompletos en el control",
            ValidacionFallida,
        )


def _controles_17980(
    controles: Controles, cno3: list[dict[str, Any]], cno2: list[dict[str, Any]], cno: dict[str, Any]
) -> None:
    """Comprueba los años, los códigos, las cifras no publicadas y las sumas de la tabla 17980 (Cataluña, 3 cifras).

    Args:
        controles: Donde se registran los controles.
        cno3: Las filas de la 17980.
        cno2: Las filas de la 17977.
        cno: La CNO-11 validada.
    """
    controles.comprobar(
        {fila["anio"] for fila in cno3} >= set(ANIOS), f"la tabla 17980 trae los años {', '.join(_anios(cno3))}"
    )
    controles.comprobar(codigos_en_cno(_grupos(cno3), cno, "3"), "todos los grupos de la 17980 existen en la CNO-11")
    sin_dato = {fila["cno11"] for fila in cno3 if fila["total"] is None}
    ausencias = all(
        {fila["cno11"] for fila in cno3 if fila["anio"] == anio and fila["total"] is None} == SIN_CIFRA_A_3
        for anio in _anios(cno3)
    )
    publicados_a_2 = {
        fila["cno11"] for fila in cno2 if fila["territorio"] == CATALUNA_IDESCAT and fila["total"] is not None
    }
    controles.comprobar(
        ausencias and SUBGRUPO_CON_CIFRA_A_2 in publicados_a_2,
        f"solo faltan a 3 cifras los grupos que tampoco publica el Censo 2021 ({', '.join(sorted(sin_dato))}); el "
        f"subgrupo {SUBGRUPO_CON_CIFRA_A_2} sí tiene cifra a 2",
    )
    descuadres = [_descuadre_suma(cno3, anio, sexo) for anio in _anios(cno3) for sexo in SEXOS]
    peor = max(descuadre for descuadre, _ in descuadres)
    controles.comprobar(
        all(descuadre <= REDONDEO_IDESCAT * cifras for descuadre, cifras in descuadres),
        f"cada año y sexo, los grupos y «no consta» suman el total de Cataluña (descuadre máximo {peor})",
    )


def _controles_tres_y_dos_cifras(controles: Controles, cno3: list[dict[str, Any]], cno2: list[dict[str, Any]]) -> None:
    """Comprueba que los grupos de 3 cifras de cada subgrupo suman la cifra del subgrupo en la 17977 (Cataluña).

    Args:
        controles: Donde se registran los controles.
        cno3: Las filas de la 17980.
        cno2: Las filas de la 17977.

    Raises:
        ValidacionFallida: Si un subgrupo de la 17980 no está en la 17977 de Cataluña.
    """
    por_subgrupo: dict[tuple[str, str, str], list[int | None]] = {}
    for fila in cno3:
        if fila["cno11"] in (TOTAL_OCUPACIONES, CODIGO_NO_CONSTA):
            continue
        for sexo in SEXOS:
            por_subgrupo.setdefault((fila["cno11"][:2], fila["anio"], sexo), []).append(fila[sexo])
    cataluna2 = {(fila["cno11"], fila["anio"]): fila for fila in cno2 if fila["territorio"] == CATALUNA_IDESCAT}
    sin_subgrupo = sorted({(grupo, anio) for grupo, anio, _ in por_subgrupo} - cataluna2.keys())
    exigir(not sin_subgrupo, f"subgrupos de la 17980 sin cifra en la 17977: {sin_subgrupo}", ValidacionFallida)
    # Cada cifra sumada puede llevar su redondeo: el descuadre admitido crece con el número de grupos del subgrupo.
    descuadres = [
        (abs(sum(cifras) - cataluna2[(grupo, anio)][sexo]), REDONDEO_IDESCAT * len(cifras))
        for (grupo, anio, sexo), cifras in por_subgrupo.items()
        if None not in cifras and cataluna2[(grupo, anio)][sexo] is not None
    ]
    controles.comprobar(
        bool(descuadres) and all(descuadre <= admitido for descuadre, admitido in descuadres),
        f"los grupos de 3 cifras suman su subgrupo de 2 cifras en {len(descuadres)} cifras de Cataluña (descuadre "
        f"máximo {max((descuadre for descuadre, _ in descuadres), default=0)})",
    )


def _controles_contraste(
    controles: Controles, cno3: list[dict[str, Any]], cataluna: dict[str, Any], cambra: dict[str, Any]
) -> None:
    """Contrasta 2021 con el Censo 2021 del INE y 2022 con la tabla de la Cambra.

    Los dos conjuntos son los de `mercado/fuentes/cataluna/lector.py` y `ia_y_trabajo/fuentes/cambra/lector.py`.

    Un grupo del censo o de la Cambra que falta en la 17980 (o sin cifra) no cuenta, y el control falla.

    Args:
        controles: Donde se registran los controles.
        cno3: Las filas de la 17980.
        cataluna: El conjunto validado de cataluna.
        cambra: El conjunto validado de cambra.
    """
    de_2021 = {fila["cno11"]: fila["total"] for fila in cno3 if fila["anio"] == ANIO_DEL_CENSO_2021}
    diferencias = [
        abs(de_2021[codigo] - grupo["ocupados"])
        for codigo, grupo in cataluna["ocupados_cno3"].items()
        if de_2021.get(codigo) is not None
    ]
    maxima = max(diferencias, default=0)
    controles.comprobar(
        bool(diferencias)
        and len(diferencias) == len(cataluna["ocupados_cno3"])
        and maxima <= CONTRASTE_CON_EL_CENSO_2021,
        f"2021: los {len(diferencias)} grupos del Censo 2021 del INE cuadran con el Idescat (diferencia máxima "
        f"{maxima}; el INE ajusta ±3 y el Idescat redondea)",
    )
    de_2022 = {fila["cno11"]: fila for fila in cno3 if fila["anio"] == ANIO_DE_LA_CAMBRA}
    iguales = [
        codigo
        for codigo, grupo in cambra["ocupaciones_cno3"].items()
        if codigo in de_2022
        and (de_2022[codigo]["hombres"], de_2022[codigo]["mujeres"]) == (grupo["hombres"], grupo["mujeres"])
    ]
    controles.comprobar(
        len(iguales) == len(cambra["ocupaciones_cno3"]),
        f"2022: la tabla de la Cambra es la 17980 del Idescat ({len(iguales)} de {len(cambra['ocupaciones_cno3'])} "
        "grupos iguales en hombres y en mujeres)",
    )


def _territorio_ine(territorio: str) -> str:
    """Traduce un territorio del Idescat al código del INE.

    Args:
        territorio: El código del Idescat.

    Returns:
        Cataluña, «09»; un municipio, su código sin la cifra de control.
    """
    if territorio == CATALUNA_IDESCAT:
        return CODIGO_INE_DE_CATALUNA
    return territorio[:5]


def _controles_ine(controles: Controles, cno2: list[dict[str, Any]], ine: list[dict[str, Any]]) -> None:
    """Contrasta la 17977 del Idescat con las tablas 69959 (Cataluña) y 69979 (ciudades) del INE.

    Args:
        controles: Donde se registran los controles.
        cno2: Las filas de la 17977.
        ine: Las filas de control del INE.
    """
    idescat = _indice(dict(fila, territorio=_territorio_ine(fila["territorio"])) for fila in cno2)
    for tabla, descripcion in ((TABLA_69959, "Cataluña (69959)"), (TABLA_69979, "las nueve ciudades (69979)")):
        todas_ine = [fila for fila in ine if fila["tabla"] == tabla]
        anios_idescat = {fila["anio"] for fila in cno2}
        anios_ine = {fila["anio"] for fila in todas_ine}
        comunes = anios_idescat & anios_ine
        del_ine = _indice(fila for fila in todas_ine if fila["anio"] in comunes)
        diferencias = _diferencias(idescat, del_ine)
        cifras_completas = all(
            fila[sexo] is not None and idescat.get(clave, {}).get(sexo) is not None
            for clave, fila in del_ine.items()
            for sexo in SEXOS
        )
        periodo = ""
        if anios_idescat != anios_ine:
            periodo = (
                f"; años comunes {', '.join(sorted(comunes))}; Idescat {', '.join(sorted(anios_idescat))}; "
                f"INE {', '.join(sorted(anios_ine))}"
            )
        maxima = max(diferencias, default=0)
        controles.comprobar(
            bool(diferencias) and cifras_completas and del_ine.keys() <= idescat.keys() and maxima <= REDONDEO_IDESCAT,
            f"el Idescat cuadra con el INE en {descripcion}: {len(diferencias)} cifras, diferencia máxima "
            f"{maxima} (redondeo a múltiplos de 3){periodo}",
        )


def _municipios_dentro_de_su_comarca(cno2: list[dict[str, Any]], comarca_de: dict[str, str]) -> bool:
    """Comprueba que, cada año, los municipios publicados de cada comarca suman como mucho lo que la comarca entera.

    Args:
        cno2: Las filas de la 17977.
        comarca_de: Código del municipio → código de su comarca.

    Returns:
        True si se cumple en cada comarca y año; False si falta un total o una pertenencia comarcal conocida.
    """
    if any(comarca_de.get(municipio) not in COMARCAS_DE_LA_ZONA for municipio in MUNICIPIOS):
        return False
    totales = {(fila["territorio"], fila["anio"]): fila["total"] for fila in cno2 if fila["cno11"] == TOTAL_OCUPACIONES}
    territorios = [*COMARCAS_DE_LA_ZONA, *MUNICIPIOS]
    anios = _anios(cno2)
    if any(totales.get((territorio, anio)) is None for territorio in territorios for anio in anios):
        return False
    for comarca in COMARCAS_DE_LA_ZONA:
        suyos = [municipio for municipio in MUNICIPIOS if comarca_de[municipio] == comarca]
        if any(sum(totales[(municipio, anio)] for municipio in suyos) > totales[(comarca, anio)] for anio in anios):
            return False
    return True


def _controles_territorios(controles: Controles, cno2: list[dict[str, Any]], contexto: dict[str, Any]) -> None:
    """Comprueba los municipios en su comarca y con cifras, y que los sexos suman el total dentro del redondeo.

    Args:
        controles: Donde se registran los controles.
        cno2: Las filas de la 17977.
        contexto: El contexto preparado, con la comarca de cada municipio.
    """
    comarca_de = contexto["comarca_de"]
    con_cifras = {fila["territorio"] for fila in cno2 if fila["total"] is not None}
    controles.comprobar(
        all(comarca_de.get(municipio) in COMARCAS_DE_LA_ZONA and municipio in con_cifras for municipio in MUNICIPIOS),
        f"los {len(MUNICIPIOS)} municipios tienen cifras y son del Baix Llobregat o del Barcelonès según el "
        "nomenclátor del Idescat",
    )
    completas = [fila for fila in cno2 if None not in (fila["hombres"], fila["mujeres"], fila["total"])]
    descuadre = max((abs(fila["hombres"] + fila["mujeres"] - fila["total"]) for fila in completas), default=0)
    controles.comprobar(
        bool(completas) and descuadre <= DESCUADRE_POR_SEXO,
        f"en las {numero_es(len(completas))} filas con las tres cifras, hombres + mujeres = total (descuadre máximo "
        f"{descuadre}; cada cifra se redondea por separado)",
    )
    controles.comprobar(
        _municipios_dentro_de_su_comarca(cno2, comarca_de),
        "en cada comarca y año, sus municipios publicados no suman más que la comarca",
    )


def _por_grupo(filas: Iterable[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Reúne las cifras publicables de cada grupo en los años del paquete; un grupo sin ninguna no aparece.

    Args:
        filas: Las filas de un territorio.

    Returns:
        Código del grupo → año → sus cifras publicables, por código.
    """
    grupos: dict[str, dict[str, Any]] = {}
    for fila in filas:
        if fila["anio"] < PRIMER_ANIO_COMPARABLE or fila["cno11"] == CODIGO_NO_CONSTA:
            continue
        cifras = cifras_publicables(fila)
        if cifras is not None:
            grupos.setdefault(fila["cno11"], {})[fila["anio"]] = cifras
    return dict(sorted(grupos.items()))


def _territorios(cno2: list[dict[str, Any]], contexto: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Compone las comarcas y los municipios con su nombre, su tipo y sus grupos de 2 cifras.

    Args:
        cno2: Las filas de la 17977.
        contexto: El contexto preparado.

    Returns:
        Código del territorio → su ficha.

    Raises:
        ValidacionFallida: Si falta la pertenencia de un municipio a una comarca conocida.
    """
    territorios = {}
    for codigo in [*COMARCAS_DE_LA_ZONA, *MUNICIPIOS]:
        es_comarca = codigo in COMARCAS_DE_LA_ZONA
        exigir(
            es_comarca or contexto["comarca_de"].get(codigo) in COMARCAS_DE_LA_ZONA,
            f"pertenencia comarcal no válida del municipio {codigo}",
            ValidacionFallida,
        )
        territorios[codigo] = {
            "nombre": contexto["nombres"][codigo],
            "tipo": "comarca" if es_comarca else "municipio",
            "comarca": None if es_comarca else contexto["comarca_de"][codigo],
            "cno2": _por_grupo(fila for fila in cno2 if fila["territorio"] == codigo),
        }
    return territorios


def _fuentes(contexto: dict[str, Any]) -> dict[str, str]:
    """Compone las citas que acompañan a cada cifra, con la fecha de actualización del Idescat (DD/MM/AAAA).

    Args:
        contexto: El contexto preparado.

    Returns:
        Organismo → su cita.

    Raises:
        FormatoInesperado: Si la fecha de actualización no es una fecha AAAA-MM-DD.
    """
    fecha = _fecha_actualizada(contexto["actualizado_idescat"]).strftime("%d/%m/%Y")
    return {
        "idescat": f"{CITA_IDESCAT}. Población ocupada por subgrupos de ocupación y sexo (tablas 17980 y 17977), a 1 "
        f"de enero de cada año; actualizado el {fecha}. {contexto['fuente_idescat']}",
    }


def _conjunto_validado(
    cno3: list[dict[str, Any]], cno2: list[dict[str, Any]], contexto: dict[str, Any]
) -> dict[str, Any]:
    """Compone la versión para el motor: Cataluña a 3 y a 2 cifras y los territorios, de MIN_PERSONAS o más.

    Args:
        cno3: Las filas de la 17980.
        cno2: Las filas de la 17977.
        contexto: El contexto preparado.

    Returns:
        El conjunto validado, con todos los años comparables publicados.
    """
    return {
        "fuentes": _fuentes(contexto),
        "anios": [anio for anio in _anios(cno3) if anio >= PRIMER_ANIO_COMPARABLE],
        "fecha_de_referencia": "1 de enero de cada año",
        "comparable_desde": PRIMER_ANIO_COMPARABLE,
        "min_personas": MIN_PERSONAS,
        "cataluna_cno3": _por_grupo(cno3),
        "cataluna_cno2": _por_grupo(fila for fila in cno2 if fila["territorio"] == CATALUNA_IDESCAT),
        "territorios": _territorios(cno2, contexto),
    }


def _cobertura(cno3: list[dict[str, Any]], conjunto: dict[str, Any]) -> dict[str, int]:
    """Resume los grupos de la 17980 y lo que pasa al paquete.

    Args:
        cno3: Las filas de la 17980.
        conjunto: El conjunto validado.

    Returns:
        Los recuentos de grupos, territorios y cifras.
    """
    grupos_en_el_paquete = conjunto["cataluna_cno3"].keys() - {TOTAL_OCUPACIONES}
    return {
        "grupos_cno3": len(_grupos(cno3)),
        "grupos_cno3_en_el_paquete": len(grupos_en_el_paquete),
        "territorios": len(conjunto["territorios"]),
        "cifras_de_territorios_en_el_paquete": sum(
            len(anios) for territorio in conjunto["territorios"].values() for anios in territorio["cno2"].values()
        ),
    }


# Funciones públicas


def cifras_publicables(fila: dict[str, Any]) -> dict[str, Any] | None:
    """Calcula las cifras que se publican de una fila.

    Args:
        fila: Una fila con hombres, mujeres y total.

    Returns:
        Las personas ocupadas y el % de mujeres si el total llega a MIN_PERSONAS; si no, o si no se publica, None.
    """
    if fila["total"] is None or fila["total"] < MIN_PERSONAS:
        return None
    mujeres = None if fila["mujeres"] is None else pct(fila["mujeres"], fila["total"])
    return {"ocupados": fila["total"], "pct_mujeres": mujeres}


def _exigir_inventario(procedencia: dict[str, Any], archivos: Iterable[dict[str, Any]]) -> None:
    """Rechaza capturas ambiguas o mezcladas; nunca deduce partes a partir de un glob del directorio."""
    registros = procedencia.get("archivos")
    exigir(
        isinstance(registros, list) and all(isinstance(registro, dict) for registro in registros),
        "ocupados: inventario de originales ausente",
    )
    esperados = {archivo["archivo"]: archivo["url"] for archivo in archivos}
    nombres = [registro.get("archivo") for registro in registros]
    exigir(
        all(isinstance(nombre, str) for nombre in nombres)
        and len(nombres) == len(set(nombres))
        and set(nombres) == set(esperados),
        "ocupados: inventario incompleto, duplicado o ajeno a su modalidad",
    )
    exigir(
        all(registro.get("url") == esperados[registro["archivo"]] for registro in registros),
        "ocupados: URL de original distinta del plan",
    )


def _captura_idescat() -> tuple[dict[str, dict[str, Any]] | None, list[dict[str, Any]]]:
    """Distingue la captura histórica completa de la modalidad explícita de metadatos y partes.

    Returns:
        Metadatos y plan de la captura nueva; None y lista vacía para los siete originales históricos exactos.
    """
    procedencia = leer_json(PROCEDENCIA)
    if IDESCAT_PARTES not in procedencia:
        _exigir_inventario(procedencia, ARCHIVOS)
        return None, []
    exigir(
        type(procedencia[IDESCAT_PARTES]) is int and procedencia[IDESCAT_PARTES] == 1,
        "ocupados: modalidad de partes Idescat desconocida",
    )
    metadatos = {archivo["archivo"]: leer_json(original(FUENTE, archivo["archivo"])) for archivo in METADATOS_IDESCAT}
    partes = planificar_partes(metadatos)
    _exigir_inventario(procedencia, [*METADATOS_IDESCAT, *partes, *ARCHIVOS_AUXILIARES])
    return metadatos, partes


def descargar(aceptar_cambio: bool = False) -> None:
    """Conserva los cuatro metadatos abiertos, todas sus partes YEAR y los tres originales auxiliares."""
    registros = descargar_originales(list(METADATOS_IDESCAT), ORIGINAL, aceptar_cambio)
    metadatos = {archivo["archivo"]: leer_json(ORIGINAL / archivo["archivo"]) for archivo in METADATOS_IDESCAT}
    partes = planificar_partes(metadatos)
    registros.extend(descargar_originales([*partes, *ARCHIVOS_AUXILIARES], ORIGINAL, aceptar_cambio))
    comprobar_plan(metadatos, partes, lambda nombre: leer_json(ORIGINAL / nombre))
    anios = _anios(
        {"anio": anio} for anio in etiquetas_jsonstat(metadatos[METADATOS_IDESCAT[0]["archivo"]], DIMENSION_ANIO)
    )
    for registro in registros:
        if registro["archivo"] in (TABLA_69959, TABLA_69979):
            periodo = _anios(
                {"anio": str(celda.anio)} for celda in celdas_tempus(leer_json(ORIGINAL / registro["archivo"]))
            )
            registro["titulo"] = de_los_anios(PLANTILLA_DEL_TITULO[registro["archivo"]], periodo)
    procedencia = {
        "fuente": de_los_anios(PLANTILLA_NOMBRE_FUENTE, anios),
        "cita": de_los_anios(PLANTILLA_CITA, anios),
        "licencia": LICENCIA,
        "licencia_texto": {"idescat": LICENCIA_TEXTO_IDESCAT, "ine": LICENCIA_TEXTO_INE},
        IDESCAT_PARTES: 1,
        "archivos": registros,
    }
    texto = json.dumps(procedencia, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    exigir(
        len(texto.encode("utf-8")) <= MAX_PROCEDENCIA_BYTES,
        "ocupados: la procedencia completa supera el límite de tamaño; requiere revisión",
    )
    guardar_json(PROCEDENCIA, procedencia)


def preparar() -> None:
    """Pasa las tablas a filas por territorio, grupo y año, y guarda el contexto de las tablas."""
    comprobar_originales(FUENTE)
    metadatos, partes = _captura_idescat()
    if metadatos is None:
        cno3 = _filas_idescat(TABLA_17980, DIMENSION_CATALUNA)
        cno2 = [
            *_filas_idescat(TABLA_17977["cataluna"], DIMENSION_CATALUNA),
            *_filas_idescat(TABLA_17977["comarca"], DIMENSION_COMARCA),
            *_filas_idescat(TABLA_17977["municipio"], DIMENSION_MUNICIPIO),
        ]
        contexto = _contexto()
    else:
        cno3, cno2 = [], []
        for nombre, tabla in tablas_del_plan(metadatos, partes, lambda nombre: leer_json(original(FUENTE, nombre))):
            destino = cno3 if nombre == TABLA_17980 else cno2
            destino.extend(_filas_de_tabla(tabla, tabla["id"][1]))
        tablas = {
            archivo["archivo"]: metadatos[meta["archivo"]]
            for archivo, meta in zip(ARCHIVOS[:4], METADATOS_IDESCAT, strict=True)
        }
        contexto = _contexto(tablas)
    ine = [
        *_filas_ine(TABLA_69959, VARIABLE_COMUNIDADES_INE),
        *_filas_ine(TABLA_69979, VARIABLE_MUNICIPIOS_INE),
    ]
    guardar_jsonl(CATALUNA_CNO3, _ordenadas(cno3))
    guardar_jsonl(TERRITORIOS_CNO2, _ordenadas(cno2))
    guardar_jsonl(CONTROL_INE, _ordenadas(ine))
    guardar_json(CONTEXTO, contexto)
    print(f"17980: {len(cno3)} filas · 17977: {len(cno2)} · INE (control): {len(ine)}")


def validar() -> None:
    """Contrasta las tablas entre sí y con el INE, la Cambra y el Censo 2021, y guarda la validación y el conjunto."""
    cno = leer_validado("clasificaciones")["cno11"]
    cno3, cno2 = leer_jsonl(CATALUNA_CNO3), leer_jsonl(TERRITORIOS_CNO2)
    contexto = leer_json(CONTEXTO)
    controles = Controles()
    controles_de_huella(controles, ORIGINAL, leer_json(PROCEDENCIA))
    _comprobar_cobertura(cno3, cno2, leer_jsonl(CONTROL_INE), cno)
    _controles_17980(controles, cno3, cno2, cno)
    _controles_tres_y_dos_cifras(controles, cno3, cno2)
    _controles_contraste(controles, cno3, leer_validado("cataluna"), leer_validado("cambra"))
    _controles_ine(controles, cno2, leer_jsonl(CONTROL_INE))
    _controles_territorios(controles, cno2, contexto)
    conjunto = _conjunto_validado(cno3, cno2, contexto)
    informe = {
        "estado": controles.estado,
        "comprobado_utc": ahora_utc(),
        "cobertura": _cobertura(cno3, conjunto),
        "limites": de_los_anios(PLANTILLA_LIMITES, tuple(conjunto["anios"])),
        "controles": controles.lista,
    }
    cerrar_validacion(FUENTE, informe, controles, lambda: conjunto, compacto=True)


def main(argv: list[str] | None = None) -> int:
    """Ejecuta la orden de la fuente de las personas ocupadas: descargar, preparar, validar o todo.

    Args:
        argv: Los argumentos de la línea de órdenes; sin ellos, los del proceso.

    Returns:
        El código de salida de la orden.
    """
    etapas = {"preparar": preparar, "validar": validar}
    return principal_fuente_con_descarga(__doc__, descargar=descargar, preparacion_y_validacion=etapas, argumentos=argv)


if __name__ == "__main__":
    sys.exit(main())
