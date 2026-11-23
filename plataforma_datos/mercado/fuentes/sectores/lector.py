"""Sectores de actividad de cada grupo de ocupación: Censo de Población 2021 del INE (API).

Dos consultas POST a la API del Censo 2021 (tabla `viv.ppal`, personas ocupadas de 16 y más años, 1 de enero de
2021), por provincia del lugar de trabajo, ocupación (CNO-11 a 3 y a 2 cifras) y actividad del establecimiento donde se
trabaja (CNAE-09 a 2 cifras). De ellas salen la provincia de Barcelona y Cataluña, que es la suma de sus cuatro
provincias: la consulta por comunidad autónoma, con la ocupación a 3 cifras, la API la atiende unas veces y otras
responde vacía, y la de provincias no falla. Responden a «¿en qué sectores trabaja la gente de este grupo?»: el reparto
de un grupo, nunca el sector de una persona.

Regla de las celdas: el INE perturba cada cifra ±3 en cada consulta (y una cifra de Cataluña, que suma cuatro
provincias, hasta ±12). Un sector se da si reúne `MIN_PERSONAS_SECTOR` (100) personas o más y el `MIN_PCT_SECTOR` (3 %)
del grupo; los demás van juntos en «otros sectores». Un grupo de 3 cifras con menos de `MIN_PERSONAS_GRUPO` (1.000)
personas no se reparte: se da el de su grupo de 2 cifras, que lo contiene. Con 1.000 personas, la perturbación mueve el
porcentaje de un sector 0,3 puntos como mucho en la provincia y 1,2 en Cataluña.

Lo que hay que saber al leerlo: la actividad es la del establecimiento que consta en los registros (la cuenta de
cotización), así que quien trabaja a través de una empresa de trabajo temporal cuenta en su actividad (CNAE 78), no en
la de la empresa usuaria; quien no tiene un lugar de trabajo consignado no está. La ocupación la imputa el INE en casi
una de cada cinco personas. La API devuelve otra perturbación en cada consulta: `descargar` solo la consulta con
`--aceptar-cambio`. Depende de las validaciones de clasificaciones y cataluna. Python estándar.

Uso: python3 -m plataforma_datos.mercado.fuentes.sectores.lector {descargar,preparar,validar,todo} [--aceptar-cambio]
"""

import json
import math
import sys
import time
from collections import Counter
from collections.abc import Iterable
from http import HTTPStatus
from typing import Any
from urllib.error import HTTPError

from plataforma_datos.comun import vigencia
from plataforma_datos.comun.dia_de_consulta import dia_en_cataluna
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
from plataforma_datos.comun.estadisticas import CITA_INE, LICENCIA_INE, LICENCIA_TEXTO_INE
from plataforma_datos.comun.nucleo import (
    ARCHIVO_DE_PROCEDENCIA,
    SEGUNDOS_DESCARGA,
    Controles,
    Descarga,
    FormatoInesperado,
    exigir,
)
from plataforma_datos.comun.red import descargar_url
from plataforma_datos.comun.textos_y_cifras import numero_es
from plataforma_datos.mercado.fuentes.censo.piezas.constantes_censo import (
    API,
    CABECERAS_DE_LA_API,
    FECHA_DE_REFERENCIA,
    MARGEN_SUMA_PORCENTAJES,
    METRICA,
    NOTA_PERTURBACION,
    OCUPACION,
    PERTURBACION,
    TABLA,
)
from plataforma_datos.mercado.fuentes.censo.piezas.consultas_del_censo import CopiasDelCenso, descargar_consultas
from plataforma_datos.ocupaciones.fuentes.clasificaciones.lector import CODIGO_NO_CONSTA as NO_CONSTA
from plataforma_datos.ocupaciones.fuentes.clasificaciones.lector import codigos_en_cno
from plataforma_datos.orquestacion.admision import cerrar_validacion, leer_validado
from plataforma_datos.orquestacion.ordenes import principal_fuente_con_descarga

FUENTE = "sectores"
ORIGINAL, PREPARADO, VALIDADO = carpetas(FUENTE)
PROCEDENCIA = ORIGINAL / ARCHIVO_DE_PROCEDENCIA
# Lo que escribe preparar y lee validar: el reparto completo de cada grupo, y el nombre de cada actividad y las
# provincias que trae cada consulta.
GRUPOS = PREPARADO / "grupos.jsonl"
RESUMEN = PREPARADO / "consultas.json"

# La provincia del lugar de trabajo, como la nombra la API, y los dos territorios, cada uno con las provincias que
# suma.
LUGAR = "ID_LUGAR_TRAB_N2"
TERRITORIOS = {
    "cataluna": (("08 Barcelona", "17 Girona", "25 Lleida", "43 Tarragona"), "Cataluña"),
    "barcelona": (("08 Barcelona",), "Provincia de Barcelona"),
}
ACTIVIDAD = "ID_ACT89"
# La API responde a veces sin datos, o con un error del servidor, a una consulta grande que otras veces sí atiende: se
# repite hasta este número de veces, con una pausa creciente, antes de darla por fallida.
INTENTOS = 4
SEGUNDOS_ENTRE_INTENTOS = 30
# La API solo admite POST con el cuerpo en JSON, y tarda en atender una consulta tan grande: el triple del tiempo de
# espera de una descarga.
SEGUNDOS_CONSULTA_CENSO = 3 * SEGUNDOS_DESCARGA
# La CNAE-2009 tiene 88 divisiones (2 cifras), de la 01 a la 99 con huecos (Real Decreto 475/2007).
DIVISIONES_CNAE = 88
# Cifras del código de una división de la CNAE-09.
CIFRAS_DE_DIVISION = 2

# Regla de las celdas (ver la cabecera).
MIN_PERSONAS_SECTOR = 100
MIN_PCT_SECTOR = 3.0
MIN_PERSONAS_GRUPO = 1000
# Por lugar de trabajo y por residencia, el mismo grupo en Cataluña difiere poco: no cuenta quien no tiene lugar de
# trabajo consignado (el 2 % en España) y sí quien vive fuera y trabaja dentro. En los grupos de 1.000 personas o más,
# más de un 35 % de diferencia sería otra población o un código cruzado; en el total, más de un 5 %.
MAX_DIFERENCIA_GRUPO_RESIDENCIA = 0.35
MAX_DIFERENCIA_TOTAL_RESIDENCIA = 0.05
# Ancla: el grupo 910 (empleados domésticos) trabaja casi entero para hogares (CNAE 97). Si no, la actividad o la
# ocupación se han leído cruzadas.
ANCLA = ("910", "97", 90.0)

NOMBRE_FUENTE = "INE · Censo de Población 2021 (API): sectores de actividad de cada grupo de ocupación"
CITA = (
    f"{CITA_INE} (Censos de Población y Viviendas 2021, API del Sistema de Difusión de los Censos 2021, tabla "
    f"«{TABLA}», personas ocupadas de 16 y más años por lugar de trabajo, ocupación y actividad del establecimiento; "
    f"fecha de referencia: {FECHA_DE_REFERENCIA})."
)


CALENDARIO = (
    "El Censo 2021 es decenal y el INE aún no ha publicado la fecha del siguiente. Los censos anuales del INE no "
    "cruzan la ocupación con la actividad a este detalle."
)


def archivo_de_la_consulta(nivel: str) -> str:
    """Nombre del original de la consulta a un nivel de la CNO-11.

    Returns:
        El nombre del archivo.
    """
    return f"ine-censo2021-provincias-trabajo-ocu{nivel}-act2.json"


def _consulta(nivel: str) -> dict[str, Any]:
    """Un original: el archivo donde se guarda y la consulta POST que lo obtiene.

    Returns:
        El archivo y la consulta.
    """
    cuerpo = {"idioma": "ES", "metrica": [METRICA], "tabla": TABLA, "variables": [LUGAR, OCUPACION[nivel], ACTIVIDAD]}
    return {
        "archivo": archivo_de_la_consulta(nivel),
        "nivel": "oficial",
        "titulo": f"INE, Censo 2021: ocupados por provincia del lugar de trabajo, CNO-11 a {nivel} cifras y CNAE-09 a "
        "2 cifras",
        "url": API,
        "cuerpo": cuerpo,
    }


CONSULTAS = [_consulta(nivel) for nivel in OCUPACION]


# Piezas internas


def _consultar_con_datos(consulta: dict[str, Any]) -> Descarga:
    """Una consulta, repetida hasta `INTENTOS` veces si la API responde sin filas o con un error del servidor.

    Args:
        consulta: El original: su archivo y el cuerpo de la consulta POST.

    Returns:
        La descarga con filas.

    Raises:
        HTTPError: Si la API responde con un error que no es del servidor (4xx): repetir no lo arregla.
        FormatoInesperado: Si tras `INTENTOS` intentos sigue sin filas.
    """
    cuerpo = json.dumps(consulta["cuerpo"]).encode("utf-8")
    for intento in range(1, INTENTOS + 1):
        try:
            descarga = descargar_url(API, CABECERAS_DE_LA_API, SEGUNDOS_CONSULTA_CENSO, cuerpo)
        except HTTPError as error:
            if error.code < HTTPStatus.INTERNAL_SERVER_ERROR:
                raise
        else:
            if con_datos(descarga.datos):
                return descarga
        if intento < INTENTOS:
            time.sleep(SEGUNDOS_ENTRE_INTENTOS * intento)
    raise FormatoInesperado(f"{consulta['archivo']}: la API no devolvió datos en {INTENTOS} intentos")


def _filas(nivel: str) -> list[dict[str, Any]]:
    """Filas de una consulta guardada de la API.

    Returns:
        Las filas.
    """
    return leer_json(original(FUENTE, archivo_de_la_consulta(nivel)))["data"]


def _nombres_de_actividades(filas: Iterable[dict[str, Any]]) -> dict[str, str]:
    """Nombre de cada división de la CNAE-09 tal como lo publica la API.

    Returns:
        {división CNAE-09: nombre}.
    """
    return dict(sorted(codigo_y_nombre(fila[ACTIVIDAD]) for fila in filas))


def _por_clave(grupos: list[dict[str, Any]]) -> dict[tuple[str, str], dict[str, dict[str, Any]]]:
    """Filas preparadas por (territorio, nivel) y grupo.

    Returns:
        {(territorio, nivel): {grupo: fila}}.
    """
    indice: dict[tuple[str, str], dict[str, dict[str, Any]]] = {}
    for fila in grupos:
        indice.setdefault((fila["territorio"], fila["nivel"]), {})[fila["cno11"]] = fila
    return indice


def _controles_cobertura(
    controles: Controles, grupos: list[dict[str, Any]], resumen: dict[str, Any], cno: dict[str, Any]
) -> bool:
    """Registra las cuatro provincias de Cataluña en las dos consultas, las 88 divisiones de la CNAE-09 y los códigos.

    Args:
        controles: Donde se registran.
        grupos: Las filas preparadas.
        resumen: Las provincias y las actividades que trae cada consulta.
        cno: Los códigos de la CNO-11.

    Returns:
        True si están todas las consultas y provincias: los controles siguientes leen cada (territorio, nivel).
    """
    indice = _por_clave(grupos)
    provincias = set(TERRITORIOS["cataluna"][0])
    completa = controles.comprobar(
        set(indice) == {(territorio, nivel) for territorio in TERRITORIOS for nivel in OCUPACION}
        and set(resumen["provincias"]) == set(OCUPACION)
        and all(provincias <= set(publicadas) for publicadas in resumen["provincias"].values()),
        "las dos consultas (CNO-11 a 3 y a 2 cifras) traen las cuatro provincias de Cataluña, por lugar de trabajo",
    )
    divisiones = [codigo for codigo in resumen["actividades"] if codigo != NO_CONSTA]
    controles.comprobar(
        len(divisiones) == DIVISIONES_CNAE
        and all(len(codigo) == CIFRAS_DE_DIVISION and codigo.isdigit() for codigo in divisiones),
        f"las {DIVISIONES_CNAE} divisiones de la CNAE-09 (2 cifras) y ninguna otra",
    )
    controles.comprobar(
        all(
            codigos_en_cno([codigo for codigo in filas if codigo != NO_CONSTA], cno, nivel)
            for (_, nivel), filas in indice.items()
        ),
        "todos los códigos de ocupación de las consultas existen en la CNO-11",
    )
    return completa


def _fuera_de_la_perturbacion(
    tres: dict[str, dict[str, Any]], dos: dict[str, dict[str, Any]], sumadas: int
) -> list[str]:
    """Grupos de 2 cifras y actividades donde sus grupos de 3 cifras no suman su cifra dentro de la perturbación.

    Cada cifra suma `sumadas` cifras perturbadas, una por provincia. Una celda pequeña puede quedar en 0 y no llegar,
    así que el margen cuenta todos los grupos de 3 cifras del grupo de 2, tengan o no cifra en esa actividad.

    Returns:
        Las descripciones de los que no suman dentro de la perturbación.
    """
    subgrupos = Counter(codigo[:2] for codigo in tres if codigo != NO_CONSTA)
    sumas: dict[tuple[str, str], int] = {}
    for codigo, fila in tres.items():
        if codigo == NO_CONSTA:
            continue
        for actividad, personas in fila["actividades"].items():
            sumas[(codigo[:2], actividad)] = sumas.get((codigo[:2], actividad), 0) + personas
    # También las actividades del grupo de 2 cifras sin ninguna cifra en sus grupos de 3: su suma es 0. Un grupo de 2
    # cifras sin ningún grupo de 3 en la consulta no se desglosa (el 59, protección y seguridad, no lo publica el INE
    # a 3 cifras en esta tabla): no hay suma que comparar.
    de_dos = {
        (grupo, actividad)
        for grupo, fila in dos.items()
        if grupo != NO_CONSTA and subgrupos[grupo]
        for actividad in fila["actividades"]
    }
    return [
        f"{grupo}·{actividad}"
        for grupo, actividad in [*sumas, *sorted(de_dos - sumas.keys())]
        if abs(sumas.get((grupo, actividad), 0) - dos.get(grupo, {}).get("actividades", {}).get(actividad, 0))
        > PERTURBACION * sumadas * (subgrupos[grupo] + 1)
    ]


def _controles_coherencia(controles: Controles, grupos: list[dict[str, Any]]) -> None:
    """En cada territorio, los grupos de 3 cifras suman su grupo de 2 cifras, actividad a actividad."""
    indice = _por_clave(grupos)
    for territorio, (provincias, nombre) in TERRITORIOS.items():
        fuera = _fuera_de_la_perturbacion(indice[(territorio, "3")], indice[(territorio, "2")], len(provincias))
        controles.comprobar(
            not fuera,
            f"{nombre}: en cada grupo de 2 cifras y actividad, sus grupos de 3 cifras suman su cifra dentro de la "
            "perturbación del INE" + (f"; fuera: {fuera[:5]}" if fuera else ""),
        )


def _controles_contraste(controles: Controles, grupos: list[dict[str, Any]], residencia: dict[str, Any]) -> None:
    """Cataluña por lugar de trabajo frente a Cataluña por residencia (Censo 2021).

    La residencia es la del censo que guarda `mercado/fuentes/cataluna/lector.py`.
    """
    trabajo = _por_clave(grupos)[("cataluna", "3")]
    grandes = {
        codigo: fila["personas"] / residencia[codigo]["ocupados"] - 1
        for codigo, fila in trabajo.items()
        if codigo in residencia and residencia[codigo]["ocupados"] >= MIN_PERSONAS_GRUPO
    }
    fuera = sorted(
        codigo for codigo, diferencia in grandes.items() if abs(diferencia) > MAX_DIFERENCIA_GRUPO_RESIDENCIA
    )
    total_trabajo = sum(fila["personas"] for fila in trabajo.values())
    total_residencia = sum(fila["ocupados"] for fila in residencia.values())
    if total_residencia <= 0:
        controles.comprobar(False, "Cataluña por residencia: el censo de cataluna no trae personas ocupadas")
        return
    diferencia_total = total_trabajo / total_residencia - 1
    controles.comprobar(
        not fuera and abs(diferencia_total) <= MAX_DIFERENCIA_TOTAL_RESIDENCIA,
        f"Cataluña por lugar de trabajo ({numero_es(total_trabajo)}) frente a residencia "
        f"({numero_es(total_residencia)}): {numero_es(100 * diferencia_total, 1)} % en el total y menos del "
        f"{round(100 * MAX_DIFERENCIA_GRUPO_RESIDENCIA)} % en cada uno de los {len(grandes)} grupos de "
        f"{numero_es(MIN_PERSONAS_GRUPO)} personas o más" + (f"; fuera: {fuera[:5]}" if fuera else ""),
    )


def _controles_ancla(controles: Controles, grupos: list[dict[str, Any]]) -> None:
    """Ancla: los empleados domésticos de la provincia de Barcelona trabajan para hogares (CNAE 97)."""
    grupo, actividad, minimo = ANCLA
    fila = _por_clave(grupos)[("barcelona", "3")].get(grupo, {"personas": 0, "actividades": {}})
    porcentaje = 100 * fila["actividades"].get(actividad, 0) / max(fila["personas"], 1)
    controles.comprobar(
        porcentaje >= minimo,
        f"ancla: el {numero_es(porcentaje, 1)} % del grupo {grupo} de la provincia de Barcelona trabaja en la "
        f"actividad {actividad} (hogares); se exige el {numero_es(minimo)} % o más",
    )


def _grupos_del_paquete(filas: dict[str, dict[str, Any]], nivel: str) -> dict[str, dict[str, Any]]:
    """Reparto de cada grupo de un nivel, con la regla de las celdas.

    Con menos de 1.000 personas no se reparte por sectores: un grupo de 3 cifras pequeño remite a su grupo de 2 cifras
    y uno de 2 cifras pequeño se queda sin reparto.

    Returns:
        {grupo: reparto con la regla de las celdas}.
    """
    paquete: dict[str, dict[str, Any]] = {}
    for codigo, fila in sorted(filas.items()):
        if codigo == NO_CONSTA:
            continue
        if fila["personas"] >= MIN_PERSONAS_GRUPO:
            paquete[codigo] = reparto(fila["actividades"])
        elif nivel == "3":
            paquete[codigo] = {"personas": fila["personas"], "ver_cno2": codigo[:2]}
        else:
            paquete[codigo] = {"personas": fila["personas"], "sin_reparto": True}
    return paquete


def _conjunto_validado(grupos: list[dict[str, Any]], actividades: dict[str, str], fecha: str) -> dict[str, Any]:
    """Versión para el motor: el reparto por sectores de cada grupo, por territorio, con la regla de las celdas.

    Returns:
        El conjunto para el motor.
    """
    indice = _por_clave(grupos)
    cita = f"{CITA} Consulta del {fecha}."
    return {
        "vigencia": vigencia.bloque("2021-01-01", "2023", None, CALENDARIO, cita),
        "fuentes": {"sectores": cita},
        "fecha_de_referencia": FECHA_DE_REFERENCIA,
        "lugar": "lugar de trabajo",
        "min_personas_sector": MIN_PERSONAS_SECTOR,
        "min_pct_sector": MIN_PCT_SECTOR,
        "min_personas_grupo": MIN_PERSONAS_GRUPO,
        "actividades": {codigo: nombre for codigo, nombre in actividades.items() if codigo != NO_CONSTA},
        "territorios": {
            territorio: {
                "nombre": nombre,
                "cno3": _grupos_del_paquete(indice[(territorio, "3")], "3"),
                "cno2": _grupos_del_paquete(indice[(territorio, "2")], "2"),
            }
            for territorio, (_, nombre) in TERRITORIOS.items()
        },
    }


def _controles_del_conjunto(controles: Controles, conjunto: dict[str, Any]) -> None:
    """Repartos con mínimos y suma 100; cada grupo pequeño remite a uno de 2 cifras repartido o sin reparto."""
    repartidos = [
        grupo
        for territorio in conjunto["territorios"].values()
        for nivel in ("cno3", "cno2")
        for grupo in territorio[nivel].values()
        if "sectores" in grupo
    ]
    controles.comprobar(
        all(
            abs(sum(porcentaje for _, porcentaje, _ in grupo["sectores"]) + grupo["otros_pct"] - 100)
            <= MARGEN_SUMA_PORCENTAJES
            for grupo in repartidos
        ),
        f"los {len(repartidos)} repartos suman 100 % con «otros sectores» (± {MARGEN_SUMA_PORCENTAJES} por redondeo)",
    )
    controles.comprobar(
        all(
            personas >= MIN_PERSONAS_SECTOR and porcentaje >= MIN_PCT_SECTOR
            for grupo in repartidos
            for _, porcentaje, personas in grupo["sectores"]
        ),
        f"ningún sector se da con menos de {MIN_PERSONAS_SECTOR} personas o del {numero_es(MIN_PCT_SECTOR)} % del "
        "grupo",
    )
    remiten = [
        (territorio, grupo["ver_cno2"])
        for territorio, datos in conjunto["territorios"].items()
        for grupo in datos["cno3"].values()
        if "ver_cno2" in grupo
    ]
    sin_reparto = [
        (territorio, codigo)
        for territorio, codigo in remiten
        if "sectores" not in conjunto["territorios"][territorio]["cno2"].get(codigo, {})
    ]
    controles.comprobar(
        all(
            "sin_reparto" in conjunto["territorios"][territorio]["cno2"].get(codigo, {})
            for territorio, codigo in sin_reparto
        ),
        f"los {len(remiten)} grupos de 3 cifras con menos de {numero_es(MIN_PERSONAS_GRUPO)} personas remiten a su "
        f"grupo de 2 cifras; {len(sin_reparto)} de ellos, a uno que tampoco llega y se queda sin reparto",
    )
    vigencia.comprobar(controles, {"sectores": conjunto["vigencia"]})


# Funciones públicas


def con_datos(datos: bytes) -> bool:
    """Indica si una respuesta de la API trae filas: a veces llega con la lista `data` vacía.

    Args:
        datos: El cuerpo de la respuesta.

    Returns:
        True si es un objeto JSON con filas en `data`; False si no es JSON, si es otro valor (lista, null…) o si
        `data` no es una lista no vacía de filas (objetos).
    """
    try:
        contenido = json.loads(datos)
    except ValueError:
        return False
    if not isinstance(contenido, dict):
        return False
    filas = contenido.get("data")
    return isinstance(filas, list) and bool(filas) and all(isinstance(fila, dict) for fila in filas)


def codigo_y_nombre(etiqueta: str) -> tuple[str, str]:
    """Código y nombre de una etiqueta de la API («82 - Actividades…» → «82», «Actividades…»); «No consta» aparte.

    Returns:
        (código, nombre).
    """
    if not etiqueta[:1].isdigit():
        return NO_CONSTA, etiqueta
    codigo, _, nombre = etiqueta.partition(" - ")
    return codigo.strip(), nombre.strip()


def repartos(filas: Iterable[dict[str, Any]], territorio: str, nivel: str) -> dict[str, dict[str, int]]:
    """Personas de un territorio por grupo y actividad: {grupo: {actividad: personas}}, sin las celdas vacías.

    Returns:
        {grupo: {actividad: personas}}, sin las celdas vacías.
    """
    provincias, _ = TERRITORIOS[territorio]
    grupos: dict[str, dict[str, int]] = {}
    for numero, fila in enumerate(filas, start=1):
        contexto = f"{archivo_de_la_consulta(nivel)}, fila {numero}"
        exigir(
            isinstance(fila, dict)
            and all(isinstance(fila.get(campo), str) and fila[campo] for campo in (LUGAR, OCUPACION[nivel], ACTIVIDAD)),
            f"{contexto}: faltan etiquetas de lugar, ocupación o actividad válidas",
        )
        valor = fila.get(METRICA)
        try:
            cifra_finita = type(valor) in (int, float) and math.isfinite(valor)
        except OverflowError:
            cifra_finita = False
        exigir(cifra_finita, f"{contexto}: {METRICA} no es una cifra finita: {valor!r}")
        personas = round(valor)
        if fila[LUGAR] not in provincias or personas <= 0:
            continue
        grupo, _ = codigo_y_nombre(fila[OCUPACION[nivel]])
        actividad, _ = codigo_y_nombre(fila[ACTIVIDAD])
        actividades = grupos.setdefault(grupo, {})
        actividades[actividad] = actividades.get(actividad, 0) + personas
    return grupos


def provincias_de(filas: Iterable[dict[str, Any]]) -> list[str]:
    """Las provincias de una consulta, como las nombra la API («08 Barcelona»…).

    Returns:
        Los nombres de las provincias, como los escribe la API.
    """
    return sorted({fila[LUGAR] for fila in filas})


def reparto(actividades: dict[str, int]) -> dict[str, Any]:
    """Los sectores que pasan la regla, de mayor a menor, como `[actividad, %, personas]`, y el % del resto.

    Returns:
        Los sectores que pasan la regla y el porcentaje del resto.
    """
    total = sum(actividades.values())
    exigir(total > 0, "sectores: las personas de un reparto deben tener un total positivo")
    ordenadas = sorted(actividades.items(), key=lambda par: (-par[1], par[0]))
    sectores = [
        [actividad, round(100 * personas / total, 1), personas]
        for actividad, personas in ordenadas
        if actividad != NO_CONSTA and personas >= MIN_PERSONAS_SECTOR and 100 * personas / total >= MIN_PCT_SECTOR
    ]
    otros = round(100 - sum(sector[1] for sector in sectores), 1)
    return {"personas": total, "sectores": sectores, "otros_pct": max(otros, 0.0)}


def descargar(aceptar_cambio: bool = False) -> None:
    """Con `aceptar_cambio`, consulta de nuevo la API y registra las copias; sin él, comprueba las que hay."""
    descargar_consultas(
        CopiasDelCenso(FUENTE, ORIGINAL, PROCEDENCIA),
        CONSULTAS,
        _consultar_con_datos,
        {
            "fuente": NOMBRE_FUENTE,
            "cita": CITA,
            "licencia": LICENCIA_INE,
            "licencia_texto": LICENCIA_TEXTO_INE,
            "documentacion": "https://www.ine.es/censos2021/SDC21_variables_disponibles.xlsx",
            "nota": NOTA_PERTURBACION,
        },
        aceptar_cambio,
    )


def preparar() -> None:
    """Resume las consultas: el reparto completo de cada grupo por actividad y el nombre de cada actividad."""
    comprobar_originales(FUENTE)
    filas: list[dict[str, Any]] = []
    nombres: dict[str, str] = {}
    provincias: dict[str, list[str]] = {}
    for nivel in OCUPACION:
        consulta = _filas(nivel)
        for territorio in TERRITORIOS:
            for grupo, actividades in sorted(repartos(consulta, territorio, nivel).items()):
                filas.append(
                    {
                        "territorio": territorio,
                        "nivel": nivel,
                        "cno11": grupo,
                        "personas": sum(actividades.values()),
                        "actividades": dict(sorted(actividades.items())),
                    }
                )
        nombres.update(_nombres_de_actividades(consulta))
        provincias[nivel] = provincias_de(consulta)
    filas.sort(key=lambda fila: (fila["territorio"], fila["nivel"], fila["cno11"]))
    guardar_jsonl(GRUPOS, filas)
    guardar_json(RESUMEN, {"actividades": dict(sorted(nombres.items())), "provincias": provincias})
    print(f"{len(filas)} grupos con su reparto · {len(nombres)} actividades")


def validar() -> None:
    """Comprueba las consultas entre sí y frente al censo por residencia, y guarda el conjunto.

    Raises:
        FormatoInesperado: Si una fecha de consulta de la procedencia no existe.
    """
    cno = leer_validado("clasificaciones")["cno11"]
    grupos, resumen = leer_jsonl(GRUPOS), leer_json(RESUMEN)
    procedencia = leer_json(PROCEDENCIA)
    controles = Controles()
    controles_de_huella(controles, ORIGINAL, procedencia)
    if not _controles_cobertura(controles, grupos, resumen, cno):
        # Sin todas las consultas y provincias, lo demás leería tablas que no están: el informe dice por qué se para.
        informe = {"estado": controles.estado, "comprobado_utc": ahora_utc(), "controles": controles.lista}
        cerrar_validacion(FUENTE, informe, controles)
        return
    _controles_coherencia(controles, grupos)
    _controles_contraste(controles, grupos, leer_validado("cataluna")["ocupados_cno3"])
    _controles_ancla(controles, grupos)
    try:
        fecha = min(dia_en_cataluna(e["descargado_utc"]) for e in procedencia["archivos"]).strftime("%d/%m/%Y")
    except FormatoInesperado as error:
        raise FormatoInesperado(f"{PROCEDENCIA.name}: fecha de consulta inválida: {error}") from error
    conjunto = _conjunto_validado(grupos, resumen["actividades"], fecha)
    _controles_del_conjunto(controles, conjunto)
    informe = {
        "estado": controles.estado,
        "comprobado_utc": ahora_utc(),
        "cobertura": {
            territorio: {
                "grupos_cno3_con_reparto": sum("sectores" in grupo for grupo in datos["cno3"].values()),
                "grupos_cno3_que_remiten_a_2_cifras": sum("ver_cno2" in grupo for grupo in datos["cno3"].values()),
                "grupos_cno2_con_reparto": sum("sectores" in grupo for grupo in datos["cno2"].values()),
            }
            for territorio, datos in conjunto["territorios"].items()
        },
        "limites": "Reparto del grupo de ocupación a 1 de enero de 2021, no de personas. La actividad es la del "
        "establecimiento que consta en los registros: quien trabaja a través de una empresa de trabajo temporal cuenta "
        "en la CNAE 78, y quien no tiene lugar de trabajo consignado no está. Casi una de cada cinco ocupaciones la "
        "imputa el INE. Cifras perturbadas ±3 por el INE.",
        "regla_celdas": f"Sectores de {MIN_PERSONAS_SECTOR} personas o más y del {numero_es(MIN_PCT_SECTOR)} % del "
        f"grupo o más; grupos de 3 cifras de {numero_es(MIN_PERSONAS_GRUPO)} personas o más (si no, su grupo de 2 "
        "cifras).",
        "controles": controles.lista,
    }
    cerrar_validacion(FUENTE, informe, controles, lambda: conjunto, compacto=True)


def main(argv: list[str] | None = None) -> int:
    """Interfaz de línea de órdenes: descargar, preparar, validar o todo.

    Args:
        argv: Los argumentos; None toma los de la línea de órdenes.

    Returns:
        El código de salida del proceso.
    """
    etapas = {"preparar": preparar, "validar": validar}
    return principal_fuente_con_descarga(__doc__, descargar, etapas, argv)


if __name__ == "__main__":
    sys.exit(main())
