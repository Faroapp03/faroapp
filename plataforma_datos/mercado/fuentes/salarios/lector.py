"""Salarios por grupo de ocupación: Encuesta de Estructura Salarial 2022 del INE, Cataluña y España.

Tres tablas de la EES 2022 (Tempus, con metadatos), filtradas a Cataluña: salario medio bruto anual por trabajador por
gran grupo de la CNO-11 y nivel de estudios (36862), edad (36865) y antigüedad en el empleo (36866). Se toma «Ambos
sexos»: el informe da el dato del grupo, nunca uno que dependa del sexo de la persona.

Lo que el INE marca no pasa al paquete: un salario con signo «−» se apoya en 100 a 500 observaciones y está «sujeto a
gran variabilidad», y uno sin valor, en menos de 100. Así se lee en las notas de cada cifra, que el original trae.

En el informe: contexto del grupo, con su año (2022), en un bloque aparte de la nota. Es una media de todo el gran
grupo, que mezcla jornadas y puestos: dice cuánto cobran de media quienes tienen unos estudios, no cuánto cobraría la
persona si los tuviera.

Una cuarta tabla, la 36830, da para toda España la ganancia anual por subgrupo de la CNO-11 (dos cifras): la media y
los percentiles 10, 25, 50, 75 y 90. Es más fina que el gran grupo, pero no es de Cataluña; va en su propio bloque,
con su ámbito, su año, su medida y su cita, y con las mismas reglas: ambos sexos y sin las cifras que el INE marca.
`validar` comprueba también cómo se llega a ella desde la ocupación de la persona (ISCO-08 o CNO-11 a 4 cifras), con
la correspondencia oficial del INE de `clasificaciones`. Python estándar.

Antes de descargar las cuatro tablas, se consulta el bloque cuatrienal del catálogo oficial. Una nueva edición,
publicación o formato incompatible detiene la descarga hasta revisar el contrato y sus consumidores. La encuesta
anual de la misma página no sustituye esta EES. Preparar y validar los originales históricos no consulta la red.

Uso: python3 -m plataforma_datos.mercado.fuentes.salarios.lector {descargar,preparar,validar,todo} [--aceptar-cambio]
"""

import math
import re
import sys
import time
from collections import Counter
from collections.abc import Iterable
from datetime import datetime
from html.parser import HTMLParser
from typing import Any

from plataforma_datos.comun import red
from plataforma_datos.comun.entrada_salida import (
    ahora_utc,
    carpetas,
    comprobar_originales,
    controles_de_huella,
    guardar_json,
    guardar_jsonl,
    leer_json,
    leer_jsonl,
    original,
)
from plataforma_datos.comun.estadisticas import (
    API_TEMPUS,
    CITA_INE,
    LICENCIA_INE,
    LICENCIA_TEXTO_INE,
    VARIABLE_OCUPACIONES,
    CeldaTempus,
    celdas_tempus,
)
from plataforma_datos.comun.nucleo import (
    ARCHIVO_DE_PROCEDENCIA,
    ArchivoDescargable,
    Controles,
    FormatoInesperado,
    exigir,
)
from plataforma_datos.comun.red import descargar_originales
from plataforma_datos.comun.textos_y_cifras import numero_es
from plataforma_datos.ocupaciones.fuentes.clasificaciones.lector import TOTAL_OCUPACIONES
from plataforma_datos.orquestacion.admision import cerrar_validacion, leer_validado
from plataforma_datos.orquestacion.ordenes import principal_fuente_con_descarga

FUENTE = "salarios"
ORIGINAL, PREPARADO, VALIDADO = carpetas(FUENTE)
PROCEDENCIA = ORIGINAL / ARCHIVO_DE_PROCEDENCIA
# Lo que escribe preparar y lee validar: una fila por tabla, gran grupo y categoría; en España, por subgrupo y medida.
SALARIOS = PREPARADO / "salarios-cataluna.jsonl"
SALARIOS_ESPANA = PREPARADO / "salarios-espana.jsonl"

ANIO = 2022
PUBLICADO = "23/09/2024"
CATALOGO: ArchivoDescargable = {
    "archivo": "ine-ees-resultados.html",
    "nivel": "oficial",
    "titulo": "INE, Encuestas de estructura salarial: resultados de la encuesta cuatrienal",
    "url": "https://www.ine.es/dyngs/INEbase/es/operacion.htm?c=Estadistica_C&cid=1254736177025"
    "&menu=resultados&idp=1254735976596",
    "licencia": LICENCIA_INE,
}
# Cataluña es el valor 9005 de la variable 70 (comunidades autónomas) en Tempus.
FILTRO_CATALUNA = "tv=70:9005"
TABLAS = {
    "estudios": ("36862", "nivel de formación alcanzado"),
    "edad": ("36865", "edad"),
    "antiguedad": ("36866", "antigüedad en el empleo"),
}
# España por subgrupo: la tabla entera (los tres sexos, el total, los grandes grupos y los 62 subgrupos), 1,2 MB.
TABLA_ESPANA = "36830"
ARCHIVO_ESPANA = f"ine-{TABLA_ESPANA}-espana.json"
# Las tres tablas de Cataluña y, al final, la de España.
ARCHIVOS: list[ArchivoDescargable] = [
    *(
        {
            "archivo": f"ine-{tabla}-cataluna.json",
            "nivel": "oficial",
            "titulo": f"INE, EES 2022, tabla {tabla}: salario medio anual por gran grupo de la CNO-11, sexo y "
            f"{nombre}. Cataluña",
            "url": f"{API_TEMPUS}/{tabla}?{FILTRO_CATALUNA}&tip=AM",
            "licencia": LICENCIA_INE,
        }
        for tabla, nombre in TABLAS.values()
    ),
    {
        "archivo": ARCHIVO_ESPANA,
        "nivel": "oficial",
        "titulo": f"INE, EES 2022, tabla {TABLA_ESPANA}: ganancia anual por trabajador, media y percentiles, por "
        "sexo y subgrupo de la CNO-11. España",
        "url": f"{API_TEMPUS}/{TABLA_ESPANA}?tip=AM",
        "licencia": LICENCIA_INE,
    },
]
NOMBRE_FUENTE = (
    "INE · Encuesta de Estructura Salarial 2022: salario medio por gran grupo de ocupación en Cataluña y ganancia "
    "anual por subgrupo de ocupación en España"
)
CITA = (
    f"{CITA_INE} (Encuesta de Estructura Salarial {ANIO}, datos definitivos publicados el {PUBLICADO}; tablas 36862, "
    "36865 y 36866: salario medio bruto anual por trabajador, Cataluña)."
)
CITA_ESPANA = (
    f"{CITA_INE} (Encuesta de Estructura Salarial {ANIO}, datos definitivos publicados el {PUBLICADO}; tabla "
    f"{TABLA_ESPANA}: ganancia bruta anual por trabajador, media y percentiles, por subgrupo de ocupación, España)."
)
AMBITO_ESPANA = "España"
MEDIDA_ESPANA = (
    "Ganancia bruta anual por trabajador, en euros, con todas las jornadas (completa y parcial); ambos sexos"
)

AMBOS_SEXOS = "Ambos sexos"
TODAS = "Todas las ocupaciones"
TOTAL_CATEGORIAS = "total"
# Cómo nombra Tempus, en cada tabla, las variables de sus categorías y la de su total. En la de antigüedad, el total
# es una categoría más, «Total».
CATEGORIAS = {
    "estudios": ("NIVELES DE FORMACIÓN ALCANZADO - CNED-A", "AGRUPACIONES NIVELES DE FORMACIÓN"),
    "edad": ("Grupos de edad", "Semiintervalos de edad"),
    "antiguedad": ("Antigüedad en el empleo",),
}
VARIABLES_DE_TOTAL = ("TOTALES CLASIFICACION EDUCACIÓN", "Totales de edad")
CATEGORIA_TOTAL = "Total"
# Las dos notas del INE que marcan una cifra poco fiable (texto literal de las notas de Tempus).
NOTA_VARIABILIDAD = "Un signo '-' antes del dato, indica que el número de observaciones muestrales está comprendido"
NOTA_SIN_DATO = "El número de observaciones muestrales es inferior a 100"
FIABLE, VARIABILIDAD_ALTA, SIN_DATO = "fiable", "variabilidad_alta", "sin_dato"
# Grandes grupos de la CNO-11 (1 a 9 y 0, ocupaciones militares).
GRANDES_GRUPOS = tuple("1234567890")
# Cifras del código de un subgrupo principal de la CNO-11 y de un grupo primario de la ISCO-08.
CIFRAS_SUBGRUPO = 2
CIFRAS_GRUPO_PRIMARIO = 4
# El INE publica el salario medio con dos decimales; el total de cada gran grupo es el mismo en las tres tablas.
MARGEN_EUROS = 0.005

# Tabla 36830. La variable de la medida cambia según sea la media o un percentil.
VARIABLES_DE_MEDIDA = ("Medidas estadísticas", "Percentiles simples")
MEDIDAS = {
    "Media": "media",
    "Percentil 10": "p10",
    "Cuartil inferior": "p25",
    "Mediana": "p50",
    "Cuartil superior": "p75",
    "Percentil 90": "p90",
}
ORDEN_MEDIDAS = tuple(MEDIDAS.values())
PERCENTILES = ORDEN_MEDIDAS[1:]
# Cifras de referencia, sin céntimos, que el estudio de datos abiertos leyó en la web del INE; 1 € de margen.
CIFRAS_DEL_ESTUDIO = {("43", "p25"): 16926, ("43", "p50"): 23576, ("43", "p75"): 29627, ("57", "p50"): 10641}
MARGEN_ESTUDIO = 1.0


# Piezas internas


class _CatalogoEES(HTMLParser):
    """Lee solo el bloque cuatrienal; la operación también publica una encuesta anual."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.bloques = 0
        self.profundidad = 0
        self.textos: list[str] = []
        self.enlaces: list[str | None] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        atributos = dict(attrs)
        if tag == "div" and atributos.get("id") == "tabs-1254736195109":
            self.bloques += 1
            exigir(self.bloques == 1, "salarios: catálogo cuatrienal ambiguo")
            self.profundidad = 1
        elif self.profundidad and tag == "div":
            self.profundidad += 1
        if self.profundidad:
            self.textos.append(" ")
            if tag == "a":
                self.enlaces.append(atributos.get("href"))

    def handle_endtag(self, tag: str) -> None:
        if self.profundidad:
            self.textos.append(" ")
            if tag == "div":
                self.profundidad -= 1

    def handle_data(self, data: str) -> None:
        if self.profundidad:
            self.textos.append(data)


def edicion_del_catalogo(contenido: bytes) -> dict[str, Any]:
    """La edición definitiva cuatrienal y su publicación; nunca el máximo año de toda la página.

    Returns:
        Año y fecha publicados, comprobados con la nota EES del mismo bloque.

    Raises:
        FormatoInesperado: Si falta el bloque, es ambiguo o no anuncia datos definitivos coherentes.
    """
    lector = _CatalogoEES()
    try:
        lector.feed(contenido.decode("utf-8", "strict"))
        lector.close()
    except UnicodeError as error:
        raise FormatoInesperado("salarios: catálogo del INE sin UTF-8 válido") from error
    exigir(lector.bloques == 1 and lector.profundidad == 0, "salarios: catálogo cuatrienal incompleto")
    texto = " ".join("".join(lector.textos).split())
    periodos = re.findall(r"\b(?:Definitivos|Provisionales|Avance)\s+[0-9]{4}\b", texto)
    ediciones = re.findall(r"\bDefinitivos ([0-9]{4}) Publicado: ([0-9]{2}/[0-9]{2}/[0-9]{4})\b", texto)
    exigir(len(periodos) == len(ediciones) == 1, "salarios: edición cuatrienal no definitiva o ambigua")
    anio_texto, publicado = ediciones[0]
    try:
        fecha = datetime.strptime(publicado, "%d/%m/%Y").date()
    except ValueError as error:
        raise FormatoInesperado("salarios: fecha de publicación cuatrienal inválida") from error
    anio = int(anio_texto)
    exigir(fecha.year >= anio, "salarios: publicación anterior a la edición cuatrienal")
    notas = [enlace for enlace in lector.enlaces if enlace and "/Prensa/" in enlace]
    exigir(notas == [f"/dyngs/Prensa/EES{anio}.htm"], "salarios: nota y edición cuatrienal no coinciden")
    return {"anio": anio, "publicado": publicado}


def comprobar_edicion(edicion: dict[str, Any]) -> None:
    """Detiene otra edición o publicación hasta revisar método, referencias y consumidores."""
    exigir(
        type(edicion) is dict
        and type(edicion.get("anio")) is int
        and edicion == {"anio": ANIO, "publicado": PUBLICADO},
        f"salarios: EES cuatrienal {edicion}; revisar el contrato antes de sustituir la EES {ANIO}",
    )


def _categoria(celda: CeldaTempus, dimension: str) -> str:
    """Categoría de una cifra en su tabla («Educación primaria», «De 25 a 34 años»…) o «total».

    Returns:
        La categoría, o «total».
    """
    for variable in CATEGORIAS[dimension]:
        if variable in celda.nombres:
            nombre = celda.nombres[variable]
            return TOTAL_CATEGORIAS if nombre == CATEGORIA_TOTAL else nombre
    exigir(
        any(variable in celda.nombres for variable in VARIABLES_DE_TOTAL),
        f"{dimension}: cifra sin categoría reconocible {celda.nombres}",
    )
    return TOTAL_CATEGORIAS


def _gran_grupo(celda: CeldaTempus) -> str:
    """Gran grupo de la CNO-11 de una cifra (su primera cifra), «total» para todas las ocupaciones.

    Returns:
        El gran grupo, o «total».
    """
    if VARIABLE_OCUPACIONES in celda.codigos:
        return celda.codigos[VARIABLE_OCUPACIONES]
    return TOTAL_OCUPACIONES


def _filas(dimension: str) -> list[dict[str, Any]]:
    """Las cifras de «Ambos sexos» de una tabla, con su gran grupo, su categoría y su fiabilidad.

    Returns:
        Una fila por cifra, con su gran grupo, su categoría y su fiabilidad.
    """
    tabla, _ = TABLAS[dimension]
    filas = []
    for celda in celdas_tempus(leer_json(original(FUENTE, f"ine-{tabla}-cataluna.json"))):
        if celda.nombres.get("Sexo") != AMBOS_SEXOS:
            continue
        exigir(celda.anio == ANIO, f"tabla {tabla}: año {celda.anio}, se esperaba {ANIO}")
        estado = fiabilidad(celda.valor, celda.notas)
        filas.append(
            {
                "tabla": tabla,
                "dimension": dimension,
                "gran_grupo": _gran_grupo(celda),
                "categoria": _categoria(celda, dimension),
                "salario": None if celda.valor is None else abs(celda.valor),
                "fiabilidad": estado,
            }
        )
    return filas


def _mismo_total(totales: dict[tuple[str, str], float | None], grupo: str) -> bool:
    """Si el salario medio de un gran grupo es el mismo en las tres tablas (o en ninguna se publica).

    Returns:
        True si coincide en las tres tablas o no se publica en ninguna.
    """
    publicados = {totales[(dimension, grupo)] for dimension in TABLAS}
    if publicados == {None}:
        return True
    return None not in publicados and max(publicados) - min(publicados) <= MARGEN_EUROS


def _controles_tablas(controles: Controles, filas: list[dict[str, Any]]) -> None:
    """Registra que las tres tablas están completas y con el mismo total de cada gran grupo.

    El segundo control lee los totales que exige el primero: si falta alguno, no se calcula y queda el primero
    fallido en el informe.

    Args:
        controles: Donde se registran.
        filas: Las cifras de las tres tablas.
    """
    totales = {
        (fila["dimension"], fila["gran_grupo"]): fila["salario"]
        for fila in filas
        if fila["categoria"] == TOTAL_CATEGORIAS
    }
    grupos = (*GRANDES_GRUPOS, TOTAL_OCUPACIONES)
    completas = controles.comprobar(
        all((dimension, grupo) in totales for dimension in TABLAS for grupo in grupos),
        "las tres tablas traen el total de Cataluña y el de los diez grandes grupos",
    )
    if not completas:
        return
    total_cataluna = totales[("estudios", TOTAL_OCUPACIONES)]
    total_escrito = "sin dato" if total_cataluna is None else f"{numero_es(total_cataluna, 2)} €"
    controles.comprobar(
        all(_mismo_total(totales, grupo) for grupo in grupos),
        f"el salario medio de cada gran grupo es el mismo en las tres tablas (Cataluña: {total_escrito})",
    )


def _claves_del_conjunto(conjunto: dict[str, Any]) -> set[tuple[str, str, str]]:
    """(dimensión, gran grupo, categoría) de cada salario del conjunto; el total de un grupo cuenta en las tres.

    Returns:
        Las claves (dimensión, gran grupo, categoría).
    """
    claves = set()
    for grupo, datos in conjunto["grandes_grupos"].items():
        for dimension in TABLAS:
            claves.update((dimension, grupo, categoria) for categoria in datos.get(dimension, {}))
            if "total" in datos:
                claves.add((dimension, grupo, TOTAL_CATEGORIAS))
    return claves


def _controles_paquete(controles: Controles, filas: list[dict[str, Any]], conjunto: dict[str, Any]) -> None:
    """Ninguna cifra que el INE marca llega al paquete, y todas las demás sí."""
    fiables = {
        (fila["dimension"], fila["gran_grupo"], fila["categoria"]) for fila in filas if fila["fiabilidad"] == FIABLE
    }
    marcadas = {
        fiabilidad: sum(fila["fiabilidad"] == fiabilidad for fila in filas)
        for fiabilidad in (VARIABILIDAD_ALTA, SIN_DATO)
    }
    controles.comprobar(
        _claves_del_conjunto(conjunto) == fiables,
        f"pasan al paquete las {len(fiables)} cifras fiables; no pasan las {marcadas[VARIABILIDAD_ALTA]} de "
        f"variabilidad alta (100 a 500 observaciones) ni las {marcadas[SIN_DATO]} sin dato (menos de 100)",
    )


def _conjunto_validado(filas: list[dict[str, Any]], filas_de_espana: list[dict[str, Any]]) -> dict[str, Any]:
    """Versión para el motor: por gran grupo y dimensión, y España por subgrupo, solo lo que el INE no marca.

    Returns:
        El conjunto para el motor.
    """
    grupos: dict[str, dict[str, Any]] = {}
    for fila in filas:
        if fila["fiabilidad"] != FIABLE:
            continue
        grupo = grupos.setdefault(fila["gran_grupo"], {})
        if fila["categoria"] == TOTAL_CATEGORIAS:
            grupo["total"] = fila["salario"]
        else:
            grupo.setdefault(fila["dimension"], {})[fila["categoria"]] = fila["salario"]
    return {
        "fuentes": {"salarios": CITA},
        "anio": ANIO,
        "territorio": "Cataluña",
        "medida": "Salario medio bruto anual por trabajador, en euros; ambos sexos",
        "grandes_grupos": dict(sorted(grupos.items())),
        "espana": bloque_espana(filas_de_espana),
    }


def _subgrupo(celda: CeldaTempus) -> str | None:
    """Subgrupo de la CNO-11 de dos cifras; None para el total y para los grupos con letra (A a Q).

    Returns:
        El subgrupo, o None.
    """
    codigo = celda.codigos.get(VARIABLE_OCUPACIONES, "")
    return codigo if len(codigo) == CIFRAS_SUBGRUPO and codigo.isascii() and codigo.isdigit() else None


def _medida(celda: CeldaTempus) -> str:
    """Qué mide una cifra: «media» o un percentil, de «p10» a «p90».

    Returns:
        «media» o el percentil.
    """
    nombres = [celda.nombres[variable] for variable in VARIABLES_DE_MEDIDA if variable in celda.nombres]
    exigir(len(nombres) == 1 and nombres[0] in MEDIDAS, f"tabla {TABLA_ESPANA}: medida no reconocida {celda.nombres}")
    return MEDIDAS[nombres[0]]


def _controles_espana(controles: Controles, filas: list[dict[str, Any]], subgrupos: set[str]) -> None:
    """La tabla de España completa, ordenada y con las cifras del estudio."""
    claves = [(fila["subgrupo"], fila["medida"]) for fila in filas]
    esperadas = {(subgrupo, medida) for subgrupo in subgrupos for medida in ORDEN_MEDIDAS}
    controles.comprobar(
        len(claves) == len(set(claves)) and set(claves) == esperadas,
        f"la tabla {TABLA_ESPANA} trae los {len(subgrupos)} subgrupos de la CNO-11, cada uno con su media y sus cinco "
        "percentiles, una sola vez",
    )
    controles.comprobar(
        not percentiles_desordenados(filas), "en cada subgrupo, las cifras fiables crecen del percentil 10 al 90"
    )
    referencia = "; ".join(
        f"{subgrupo}, {medida.upper()} {numero_es(cifra, 0)} €"
        for (subgrupo, medida), cifra in CIFRAS_DEL_ESTUDIO.items()
    )
    controles.comprobar(
        not distintas_del_estudio(filas), f"coinciden, con 1 € de margen, las cifras del estudio ({referencia})"
    )


def _controles_paquete_espana(controles: Controles, filas: list[dict[str, Any]], bloque: dict[str, Any]) -> None:
    """De España, ninguna cifra que el INE marca llega al paquete, y todas las demás sí."""
    fiables = {(fila["subgrupo"], fila["medida"]) for fila in filas if fila["fiabilidad"] == FIABLE}
    en_el_paquete = {(subgrupo, medida) for subgrupo, cifras in bloque["subgrupos"].items() for medida in cifras}
    marcadas = Counter(fila["fiabilidad"] for fila in filas)
    controles.comprobar(
        en_el_paquete == fiables,
        f"España: pasan al paquete las {len(fiables)} cifras fiables; no pasan las {marcadas[VARIABILIDAD_ALTA]} de "
        f"variabilidad alta ni las {marcadas[SIN_DATO]} sin dato",
    )


# Funciones públicas


def fiabilidad(valor: float | None, notas: Iterable[str]) -> str:
    """Qué dice el INE de una cifra: fiable, de variabilidad alta (signo −, 100–500 observaciones) o sin dato.

    Returns:
        «fiable», «variabilidad_alta» o «sin_dato».
    """
    textos = tuple(notas)
    if valor is None:
        exigir(
            any(nota.startswith(NOTA_SIN_DATO) for nota in textos) or not textos, "cifra vacía con una nota distinta"
        )
        return SIN_DATO
    exigir(
        isinstance(valor, (int, float))
        and not isinstance(valor, bool)
        and (not isinstance(valor, float) or math.isfinite(valor)),
        f"salario no numérico o no finito: {valor!r}",
    )
    if valor < 0:
        exigir(any(nota.startswith(NOTA_VARIABILIDAD) for nota in textos), "cifra negativa sin la nota del INE")
        return VARIABILIDAD_ALTA
    return FIABLE


def filas_espana(series: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Las cifras de «Ambos sexos» de cada subgrupo, con su medida y su fiabilidad (la misma regla que Cataluña).

    Returns:
        Una fila por cifra, con su subgrupo, su medida y su fiabilidad.
    """
    filas = []
    for celda in celdas_tempus(series):
        subgrupo = _subgrupo(celda)
        if celda.nombres.get("Sexo") != AMBOS_SEXOS or subgrupo is None:
            continue
        exigir(celda.anio == ANIO, f"tabla {TABLA_ESPANA}: año {celda.anio}, se esperaba {ANIO}")
        estado = fiabilidad(celda.valor, celda.notas)
        filas.append(
            {
                "tabla": TABLA_ESPANA,
                "subgrupo": subgrupo,
                "medida": _medida(celda),
                "salario": None if celda.valor is None else abs(celda.valor),
                "fiabilidad": estado,
            }
        )
    return sorted(filas, key=lambda fila: (fila["subgrupo"], ORDEN_MEDIDAS.index(fila["medida"])))


def bloque_espana(filas: list[dict[str, Any]]) -> dict[str, Any]:
    """El bloque de España: rótulo (ámbito, año, medida y cita), que vale para cada cifra, y las cifras fiables.

    Returns:
        El bloque de España, con su rótulo y sus cifras fiables.
    """
    subgrupos: dict[str, dict[str, float]] = {}
    for fila in filas:
        if fila["fiabilidad"] == FIABLE:
            subgrupos.setdefault(fila["subgrupo"], {})[fila["medida"]] = fila["salario"]
    return {
        "ambito": AMBITO_ESPANA,
        "anio": ANIO,
        "medida": MEDIDA_ESPANA,
        "fuente": CITA_ESPANA,
        "subgrupos": dict(sorted(subgrupos.items())),
    }


def percentiles_desordenados(filas: list[dict[str, Any]]) -> list[str]:
    """Subgrupos cuyas cifras fiables no crecen del percentil 10 al 90 (con huecos, se comparan las que hay).

    Returns:
        Los subgrupos con percentiles desordenados.
    """
    cifras: dict[str, dict[str, float]] = {}
    for fila in filas:
        if fila["fiabilidad"] == FIABLE and fila["medida"] in PERCENTILES:
            cifras.setdefault(fila["subgrupo"], {})[fila["medida"]] = fila["salario"]
    desordenados = []
    for subgrupo, suyas in sorted(cifras.items()):
        en_orden = [suyas[percentil] for percentil in PERCENTILES if percentil in suyas]
        if en_orden != sorted(en_orden):
            desordenados.append(subgrupo)
    return desordenados


def distintas_del_estudio(filas: list[dict[str, Any]]) -> list[str]:
    """Cifras de referencia del estudio que la tabla no da fiables o da con más de 1 € de diferencia.

    Returns:
        Las cifras de referencia que no coinciden.
    """
    publicadas = {(fila["subgrupo"], fila["medida"]): fila for fila in filas}
    distintas = []
    for clave, euros in CIFRAS_DEL_ESTUDIO.items():
        fila = publicadas.get(clave)
        if fila is None or fila["fiabilidad"] != FIABLE or abs(fila["salario"] - euros) > MARGEN_ESTUDIO:
            distintas.append(" ".join(clave))
    return distintas


def correspondencia(clasificaciones: dict[str, Any], con_mediana: set[str]) -> dict[str, Any]:
    """Cómo se llega de la ocupación de la persona a su subgrupo de la CNO-11 con mediana publicada.

    Una CNO-11 a 4 cifras está en el subgrupo de sus dos primeras. Un grupo ISCO-08 a 4 cifras pasa a la CNO-11 por
    la correspondencia oficial del INE; si esta lo reparte entre varios subgrupos, no se elige uno por la persona.

    Returns:
        La correspondencia de cada ocupación con su subgrupo.
    """
    cno = sorted(codigo for codigo, grupo in clasificaciones["cno11"].items() if grupo["nivel"] == "4")
    isco = sorted(codigo for codigo in clasificaciones["isco08_es"] if len(codigo) == CIFRAS_GRUPO_PRIMARIO)
    destinos = clasificaciones["isco08_a_cno11"]
    en_varios, sin_mediana, sin_correspondencia = {}, {}, []
    for codigo in isco:
        subgrupos = sorted({destino["cno11"][:2] for destino in destinos.get(codigo, [])})
        if not subgrupos:
            sin_correspondencia.append(codigo)
        elif len(subgrupos) > 1:
            en_varios[codigo] = subgrupos
        elif subgrupos[0] not in con_mediana:
            sin_mediana[codigo] = subgrupos[0]
    cno_sin_mediana = [codigo for codigo in cno if codigo[:2] not in con_mediana]
    return {
        "regla": "CNO-11 a 4 cifras: sus dos primeras cifras. ISCO-08 a 4 cifras: correspondencia oficial del INE "
        "(clasificaciones) y, si todas sus CNO-11 caen en un subgrupo con mediana publicada, ese subgrupo.",
        "cno11_4_cifras": {"grupos": len(cno), "sin_mediana": cno_sin_mediana},
        "isco08_4_cifras": {
            "grupos": len(isco),
            "con_subgrupo": len(isco) - len(en_varios) - len(sin_mediana) - len(sin_correspondencia),
            "en_varios_subgrupos": en_varios,
            "subgrupo_sin_mediana": sin_mediana,
            "sin_correspondencia": sin_correspondencia,
        },
    }


def descargar(aceptar_cambio: bool = False) -> None:
    """Comprueba primero la edición cuatrienal; solo después descarga sus cuatro tablas conocidas."""
    # El índice cambia también por la encuesta anual: se conserva tras comprobar su semántica cuatrienal.
    edicion, registrar = red.descubrir_edicion(
        CATALOGO,
        ORIGINAL,
        redireccion="salarios: redirección inesperada del catálogo del INE",
        leer=edicion_del_catalogo,
        comprobar=comprobar_edicion,
        previo=lambda: red.primer_descubrimiento_previo(PROCEDENCIA, CATALOGO["archivo"]),
    )
    descubrimiento = registrar()
    time.sleep(red.PAUSA_ENTRE_PETICIONES_S)
    registros = descargar_originales(ARCHIVOS, ORIGINAL, aceptar_cambio)
    guardar_json(
        PROCEDENCIA,
        {
            "fuente": NOMBRE_FUENTE,
            "cita": f"{CITA} {CITA_ESPANA}",
            "licencia": LICENCIA_INE,
            "licencia_texto": LICENCIA_TEXTO_INE,
            "nota": "Tempus marca los datos como «Avance»; la nota de prensa del 23/09/2024 los presenta como datos "
            "definitivos de la EES 2022.",
            "archivos": registros,
            "descubrimiento": [descubrimiento],
            "edicion": edicion,
        },
    )


def preparar() -> None:
    """Pasa las tablas a filas de «Ambos sexos» con su grupo, su categoría o medida y su fiabilidad."""
    comprobar_originales(FUENTE)
    filas = [fila for dimension in TABLAS for fila in _filas(dimension)]
    guardar_jsonl(SALARIOS, sorted(filas, key=lambda fila: (fila["tabla"], fila["gran_grupo"], fila["categoria"])))
    print(f"{len(filas)} salarios de Cataluña ({', '.join(tabla for tabla, _ in TABLAS.values())})")
    filas_de_espana = filas_espana(leer_json(original(FUENTE, ARCHIVO_ESPANA)))
    guardar_jsonl(SALARIOS_ESPANA, filas_de_espana)
    print(f"{len(filas_de_espana)} cifras de España por subgrupo ({TABLA_ESPANA})")


def validar() -> None:
    """Comprueba las tablas y guarda la validación y el conjunto para el motor."""
    filas = leer_jsonl(SALARIOS)
    filas_de_espana = leer_jsonl(SALARIOS_ESPANA)
    clasificaciones = leer_validado("clasificaciones")
    subgrupos = {codigo for codigo, grupo in clasificaciones["cno11"].items() if grupo["nivel"] == "2"}
    controles = Controles()
    controles_de_huella(controles, ORIGINAL, leer_json(PROCEDENCIA))
    _controles_tablas(controles, filas)
    _controles_espana(controles, filas_de_espana, subgrupos)
    conjunto = _conjunto_validado(filas, filas_de_espana)
    _controles_paquete(controles, filas, conjunto)
    _controles_paquete_espana(controles, filas_de_espana, conjunto["espana"])
    con_mediana = {subgrupo for subgrupo, cifras in conjunto["espana"]["subgrupos"].items() if "p50" in cifras}
    informe = {
        "estado": controles.estado,
        "comprobado_utc": ahora_utc(),
        "cobertura": {
            "cifras": len(filas),
            "cifras_en_el_paquete": sum(fila["fiabilidad"] == FIABLE for fila in filas),
            "cifras_espana": len(filas_de_espana),
            "cifras_espana_en_el_paquete": sum(fila["fiabilidad"] == FIABLE for fila in filas_de_espana),
        },
        "limites": "Media del gran grupo de ocupación (diez grupos), no de la ocupación de la persona; mezcla "
        "jornadas completas y parciales. Año 2022. Correlación, no efecto: no dice cuánto cobraría alguien al "
        "cambiar de estudios. La «educación secundaria segunda etapa» reúne el bachillerato y la FP de grado medio. "
        "España: subgrupo de la CNO-11 (62), no la ocupación de la persona ni Cataluña; ganancia de quienes "
        "trabajaron en 2022, con todas las jornadas; un percentil dice cómo se reparte el grupo, no dónde está "
        "alguien.",
        "correspondencia": correspondencia(clasificaciones, con_mediana),
        "controles": controles.lista,
    }
    cerrar_validacion(FUENTE, informe, controles, lambda: conjunto)


def main(argv: list[str] | None = None) -> int:
    """Ejecuta las etapas de los salarios del INE desde la línea de órdenes: descargar, preparar, validar o todo.

    Args:
        argv: Los argumentos; None toma los de la línea de órdenes.

    Returns:
        El código de salida del proceso.
    """
    return principal_fuente_con_descarga(
        __doc__,
        descargar=descargar,
        preparacion_y_validacion={"preparar": preparar, "validar": validar},
        argumentos=argv,
    )


if __name__ == "__main__":
    sys.exit(main())
