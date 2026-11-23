"""Censo de Población 2021 del INE (API): ocupados por municipio de residencia y de trabajo, y perfil de cada grupo.

Consultas POST a la API del Censo 2021 (tabla `viv.ppal`, personas ocupadas de 16 y más años, 1 de enero de 2021):

- por municipio de residencia y por municipio del establecimiento de trabajo, CNO-11 a 3 y a 2 cifras y sexo; se
  guardan Cornellà de Llobregat y los municipios de su entorno (`ENTORNO`);
- en Cataluña, por grupo de la CNO-11 a 3 y a 2 cifras: nivel de estudios (con la FP de grado medio y la de grado
  superior por separado), situación profesional (indefinido, temporal, por cuenta propia) y nacionalidad (española o
  extranjera).

Regla de las celdas pequeñas: el INE perturba cada cifra ±3 por confidencialidad, en cada consulta. Una cifra
municipal de menos de `MIN_PERSONAS` (100) no pasa al paquete y su grupo se da a 2 cifras, la cifra que publica el
INE para el subgrupo, si llega a 100; si tampoco llega, no se da nada. Un perfil (porcentajes de estudios, situación y
nacionalidad) solo se da con `MIN_PERSONAS_PERFIL` (1.000) personas o más: suma hasta doce cifras perturbadas, y con
1.000 personas ninguna mueve un porcentaje más de 0,3 puntos.

La API devuelve cifras distintas en cada consulta (la perturbación cambia): una copia nueva nunca coincide con la
huella de la anterior. Por eso `descargar` solo consulta la API con `--aceptar-cambio`; sin él, comprueba las copias.

En el informe: contexto del grupo de ocupación, en un bloque aparte de la nota; la nacionalidad, solo como dato del
grupo, nunca para nada de la persona. La situación profesional es de enero de 2021, antes de la reforma laboral de 2022.
Depende de las validaciones de clasificaciones, cataluna y ocupados. Python estándar.

Uso: python3 -m plataforma_datos.mercado.fuentes.censo.lector {descargar,preparar,validar,todo} [--aceptar-cambio]
"""

import json
import sys
from collections import Counter
from collections.abc import Iterable
from typing import Any

from plataforma_datos.comun.dia_de_consulta import dia_iso_en_cataluna
from plataforma_datos.comun.entrada_salida import (
    ahora_utc,
    comprobar_originales,
    controles_de_huella,
    guardar_jsonl,
    leer_json,
    leer_jsonl,
    original,
)
from plataforma_datos.comun.estadisticas import LICENCIA_INE, LICENCIA_TEXTO_INE
from plataforma_datos.comun.nucleo import (
    SEGUNDOS_DESCARGA,
    Controles,
    Descarga,
    exigir,
)
from plataforma_datos.comun.red import descargar_url
from plataforma_datos.comun.textos_y_cifras import numero_es, pct
from plataforma_datos.mercado.fuentes.cataluna.piezas.constantes_cataluna import CONTEXTO as CONTEXTO_DE_CATALUNA
from plataforma_datos.mercado.fuentes.censo.piezas.constantes_censo import (
    API,
    CABECERAS_DE_LA_API,
    CATALUNA,
    CIFRAS_SUMADAS,
    CITA,
    CONSULTAS,
    CONTRASTE_CON_EL_IDESCAT,
    DATOS_DE_LA_RESPUESTA,
    DOCUMENTACION,
    ENTORNO,
    FECHA_DE_REFERENCIA,
    FUENTE,
    LUGAR,
    MARGEN_SUMA_PORCENTAJES,
    METRICA,
    MIN_PERSONAS,
    MIN_PERSONAS_PERFIL,
    MUNICIPIOS,
    NOMBRE_FUENTE,
    NOTA_PERTURBACION,
    OCUPACION,
    ORIGINAL,
    PERFIL,
    PERFILES,
    PERTURBACION,
    PROCEDENCIA,
    SEXOS_DE_LA_API,
)
from plataforma_datos.mercado.fuentes.censo.piezas.consultas_del_censo import CopiasDelCenso, descargar_consultas
from plataforma_datos.mercado.fuentes.ocupados.piezas.constantes_ocupados import TERRITORIOS_CNO2
from plataforma_datos.ocupaciones.fuentes.clasificaciones.lector import (
    CODIGO_NO_CONSTA,
    codigo_de_ocupacion,
    codigos_en_cno,
)
from plataforma_datos.orquestacion.admision import cerrar_validacion, exigir_admitido, leer_validado
from plataforma_datos.orquestacion.ordenes import principal_fuente_con_descarga

# Piezas internas

# Cifras del código INE de un municipio («08073»): el territorio de la API empieza por él.
LONGITUD_CODIGO_MUNICIPIO = 5
# El año de la fecha de referencia («2021»), como lo escribe el Idescat.
ANIO_DE_REFERENCIA = FECHA_DE_REFERENCIA.rsplit(" ", 1)[1]
# Las cifras por sexo de una fila municipal.
SEXOS = ("hombres", "mujeres")
# Cuántos casos fuera de tolerancia se muestran en el mensaje de un control.
MAX_EJEMPLOS = 5
# Las dos variables del conjunto de Cataluña (estudios y situación profesional): la nacionalidad no se compara.
VARIABLES_DEL_CONJUNTO = ("estudios", "situacion")
# El nombre de cada variable del perfil, en el orden de PERFIL.
NOMBRES_DEL_PERFIL = tuple(nombre for nombre, _ in PERFIL.values())


def _consultar_api(cuerpo: dict[str, Any]) -> Descarga:
    """Envía una consulta a la API del Censo 2021, que solo admite POST, por la descarga común (agente y tope).

    Returns:
        La respuesta de la API, con sus bytes, su dirección final y su tipo.
    """
    return descargar_url(API, CABECERAS_DE_LA_API, SEGUNDOS_DESCARGA, cuerpo=json.dumps(cuerpo).encode("utf-8"))


def respuesta_con_datos(datos: bytes) -> bool:
    """Si una respuesta de la API es JSON con su «data»: una lista no vacía de filas (objetos).

    Args:
        datos: Los bytes de la respuesta, tal como llegan.

    Returns:
        True si se analiza como JSON y su «data» es una lista no vacía de objetos; False si no.
    """
    try:
        respuesta = json.loads(datos)
    except ValueError:
        return False
    filas = respuesta.get(DATOS_DE_LA_RESPUESTA) if isinstance(respuesta, dict) else None
    return isinstance(filas, list) and bool(filas) and all(isinstance(fila, dict) for fila in filas)


def _consultar_con_datos(consulta: dict[str, Any]) -> Descarga:
    """Consulta la API y exige que la respuesta traiga sus filas antes de guardar sus bytes.

    Args:
        consulta: Una de las consultas de `CONSULTAS`, con su archivo y su cuerpo.

    Returns:
        La descarga, con filas en su «data».

    Raises:
        FormatoInesperado: Si la respuesta no es JSON o su «data» no es una lista no vacía de filas.
    """
    descarga = _consultar_api(consulta["cuerpo"])
    exigir(respuesta_con_datos(descarga.datos), f"{consulta['archivo']}: la API no devolvió datos (filas en «data»)")
    return descarga


def _filas(nombre: str) -> list[dict[str, Any]]:
    """Filas de una consulta guardada de la API.

    Returns:
        Las filas («data») de la consulta.
    """
    return leer_json(original(FUENTE, nombre))[DATOS_DE_LA_RESPUESTA]


def _personas_por_sexo(
    filas: Iterable[dict[str, Any]], campos: tuple[str, str]
) -> dict[tuple[str, str], dict[str, int]]:
    """Hombres, mujeres y total por (territorio, código): `campos` dice la columna del territorio y la ocupación.

    Returns:
        Por (territorio, código), las personas hombres, mujeres y en total.
    """
    territorio, ocupacion = campos
    personas: dict[tuple[str, str], dict[str, int]] = {}
    for fila in filas:
        clave = (fila[territorio], codigo_de_ocupacion(fila[ocupacion]))
        cifras = personas.setdefault(clave, {"hombres": 0, "mujeres": 0})
        cifras[SEXOS_DE_LA_API[fila["ID_SEXO"]]] += round(fila[METRICA])
    for cifras in personas.values():
        cifras["total"] = cifras["hombres"] + cifras["mujeres"]
    return personas


def _del_entorno(lugar: str, nivel: str) -> list[dict[str, Any]]:
    """Filas de los municipios del entorno en una consulta: por residencia o por trabajo, a 3 o a 2 cifras.

    Returns:
        Una fila por municipio del entorno y código, con sus hombres, mujeres y total.
    """
    consulta = _filas(f"ine-censo2021-{lugar}-ocu{nivel}-sexo.json")
    personas = _personas_por_sexo(consulta, (LUGAR[lugar], OCUPACION[nivel]))
    filas: list[dict[str, Any]] = []
    for (territorio, codigo), cifras in personas.items():
        # La API nombra cada municipio por su código y su nombre: «08073 Cornellà de Llobregat».
        municipio, _, nombre = territorio.partition(" ")
        if municipio in ENTORNO:
            filas.append(
                {"municipio": municipio, "nombre": nombre, "lugar": lugar, "nivel": nivel, "cno11": codigo, **cifras}
            )
    return filas


def _municipios() -> list[dict[str, Any]]:
    """Ocupados del entorno por municipio de residencia y de trabajo, a 3 y a 2 cifras y por sexo.

    Returns:
        Las filas de los municipios del entorno, ordenadas por municipio, lugar, nivel y código.
    """
    filas = [fila for lugar in LUGAR for nivel in OCUPACION for fila in _del_entorno(lugar, nivel)]
    return sorted(filas, key=lambda fila: (fila["municipio"], fila["lugar"], fila["nivel"], fila["cno11"]))


def _perfil(nivel: str) -> dict[str, dict[str, Any]]:
    """Personas de Cataluña por grupo de un nivel y por categoría agrupada de estudios, situación y nacionalidad.

    Returns:
        Por código, el perfil del grupo con las personas de cada categoría y las cifras sumadas.
    """
    perfiles: dict[str, dict[str, Any]] = {}
    for variable, (nombre, agrupacion) in PERFIL.items():
        for fila in _filas(f"ine-censo2021-cataluna-ocu{nivel}-{nombre}.json"):
            if fila["ID_RESIDENCIA_N1"] != CATALUNA:
                continue
            exigir(fila[variable] in agrupacion, f"{nombre}: categoría desconocida «{fila[variable]}»")
            codigo = codigo_de_ocupacion(fila[OCUPACION[nivel]])
            perfil = perfiles.setdefault(codigo, {"cno11": codigo, "nivel": nivel})
            # Todas las categorías empiezan en 0: la API no devuelve las filas sin personas.
            categorias = perfil.setdefault(nombre, {**dict.fromkeys(agrupacion.values(), 0), CIFRAS_SUMADAS: 0})
            categorias[agrupacion[fila[variable]]] += round(fila[METRICA])
            categorias[CIFRAS_SUMADAS] += 1
    return perfiles


def _suma(categorias: dict[str, int]) -> int:
    """Personas de un perfil: la suma de sus categorías (sin el recuento de cifras sumadas).

    Returns:
        Las personas del perfil.
    """
    return sum(personas for categoria, personas in categorias.items() if categoria != CIFRAS_SUMADAS)


def _controles_municipios(controles: Controles, municipios: list[dict[str, Any]], cno: dict[str, Any]) -> None:
    """Cada municipio del entorno en las cuatro consultas, códigos que existen y 3 cifras que suman su subgrupo."""
    presentes = {(fila["municipio"], fila["lugar"], fila["nivel"]) for fila in municipios}
    esperados = {(municipio, lugar, nivel) for municipio in ENTORNO for lugar in LUGAR for nivel in OCUPACION}
    controles.comprobar(
        presentes == esperados,
        f"los {len(ENTORNO)} municipios del entorno están en las consultas por residencia y por trabajo, a 3 y a 2 "
        "cifras",
    )
    codigos = {(fila["nivel"], fila["cno11"]) for fila in municipios if fila["cno11"] != CODIGO_NO_CONSTA}
    controles.comprobar(
        all(
            codigos_en_cno([codigo for nivel_del_codigo, codigo in codigos if nivel_del_codigo == nivel], cno, nivel)
            for nivel in OCUPACION
        ),
        "todos los códigos de las consultas municipales existen en la CNO-11",
    )
    subgrupos = {
        (fila["municipio"], fila["lugar"], fila["cno11"]): fila["total"] for fila in municipios if fila["nivel"] == "2"
    }
    sumas: dict[tuple[str, str, str], list[int]] = {}
    for fila in municipios:
        if fila["nivel"] == "3" and fila["cno11"] != CODIGO_NO_CONSTA:
            sumas.setdefault((fila["municipio"], fila["lugar"], fila["cno11"][:2]), []).append(fila["total"])
    # Cada grupo suma dos cifras perturbadas (hombres y mujeres), y la del subgrupo, otras dos.
    fuera = [
        clave
        for clave, totales in sumas.items()
        if abs(sum(totales) - subgrupos.get(clave, 0)) > PERTURBACION * 2 * (len(totales) + 1)
    ]
    controles.comprobar(
        not fuera,
        f"en los {len(sumas)} subgrupos de cada municipio y lugar, los grupos de 3 cifras suman la cifra a 2 cifras "
        "dentro de la perturbación del INE" + (f"; fuera: {fuera[:MAX_EJEMPLOS]}" if fuera else ""),
    )


def _controles_contraste(controles: Controles, municipios: list[dict[str, Any]]) -> None:
    """Residentes del entorno, a 2 cifras y por sexo, frente a la tabla 17977 del Idescat (2021).

    La tabla es la que guarda `mercado/fuentes/ocupados/lector.py`.
    """
    exigir_admitido("ocupados")
    idescat = {
        (fila["territorio"][:LONGITUD_CODIGO_MUNICIPIO], fila["cno11"]): fila
        for fila in leer_jsonl(TERRITORIOS_CNO2)
        if fila["anio"] == ANIO_DE_REFERENCIA and fila["territorio"][:LONGITUD_CODIGO_MUNICIPIO] in ENTORNO
    }
    diferencias = []
    for fila in municipios:
        if fila["lugar"] != "residencia" or fila["nivel"] != "2":
            continue
        del_idescat = idescat.get((fila["municipio"], fila["cno11"]))
        if del_idescat is not None:
            diferencias += [abs(fila[sexo] - del_idescat[sexo]) for sexo in SEXOS if del_idescat[sexo] is not None]
    # Sin ninguna cifra que cruzar, el control falla (no hay contraste) en lugar de detener la validación.
    peor = max(diferencias, default=None)
    controles.comprobar(
        peor is not None and peor <= CONTRASTE_CON_EL_IDESCAT,
        f"residentes del entorno, 2 cifras y sexo: {len(diferencias)} cifras cuadran con el Idescat (tabla 17977, "
        f"2021; diferencia máxima {peor}, perturbación ±3 y redondeo)",
    )


def _controles_perfiles(controles: Controles, perfiles: list[dict[str, Any]], censo: dict[str, Any]) -> None:
    """Cada perfil suma las personas ocupadas del grupo en el censo de Cataluña, con sus tres variables.

    El censo es el que guarda `mercado/fuentes/cataluna/lector.py`.
    """
    fuera: list[str] = []
    con_referencia = 0
    referencias_presentes: set[tuple[str, str]] = set()
    for perfil in perfiles:
        referencia = censo[f"ocupados_cno{perfil['nivel']}"].get(perfil["cno11"])
        for nombre in NOMBRES_DEL_PERFIL:
            categorias = perfil[nombre]
            # Una perturbación por cifra sumada, más dos por la cifra de referencia del censo (hombres y mujeres).
            admitido = PERTURBACION * (categorias[CIFRAS_SUMADAS] + 2)
            if referencia and abs(_suma(categorias) - referencia["ocupados"]) > admitido:
                fuera.append(f"{perfil['cno11']} ({nombre})")
        if referencia:
            con_referencia += 1
            referencias_presentes.add((perfil["nivel"], perfil["cno11"]))
    controles.comprobar(
        not fuera
        and con_referencia == len(referencias_presentes) == len(censo["ocupados_cno3"]) + len(censo["ocupados_cno2"]),
        f"estudios, situación y nacionalidad suman, en los {con_referencia} grupos de 3 y 2 cifras, las personas "
        "ocupadas del Censo 2021 de la fuente cataluna dentro de la perturbación"
        + (f"; fuera: {fuera[:MAX_EJEMPLOS]}" if fuera else ""),
    )


def _municipios_del_paquete(municipios: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Por municipio, lugar y nivel, las cifras de 100 personas o más (sin «no consta»).

    Returns:
        Por municipio, su nombre y, por lugar y nivel, las cifras de cada grupo que llegan a MIN_PERSONAS.
    """
    paquete: dict[str, dict[str, Any]] = {}
    for fila in municipios:
        cifras = cifras_municipales(fila)
        if fila["cno11"] == CODIGO_NO_CONSTA or cifras is None:
            continue
        municipio = paquete.setdefault(fila["municipio"], {"nombre": fila["nombre"]})
        municipio.setdefault(fila["lugar"], {}).setdefault(f"cno{fila['nivel']}", {})[fila["cno11"]] = cifras
    return dict(sorted(paquete.items()))


def _perfiles_del_paquete(perfiles: list[dict[str, Any]], nivel: str) -> dict[str, dict[str, Any]]:
    """Perfiles de 1.000 personas o más de un nivel de la CNO-11 (sin «no consta»).

    Returns:
        Por código, sus personas y sus porcentajes de estudios, situación y nacionalidad.
    """
    paquete: dict[str, dict[str, Any]] = {}
    for perfil in perfiles:
        if perfil["nivel"] != nivel or perfil["cno11"] == CODIGO_NO_CONSTA:
            continue
        variables = {nombre: porcentajes(perfil[nombre]) for nombre in NOMBRES_DEL_PERFIL}
        if None not in variables.values():
            paquete[perfil["cno11"]] = {"personas": _suma(perfil["estudios"]), **variables}
    return dict(sorted(paquete.items()))


def _conjunto_validado(
    municipios: list[dict[str, Any]], perfiles: list[dict[str, Any]], fecha: str, ocupados_cataluna: dict[str, Any]
) -> dict[str, Any]:
    """Versión para el motor: municipios del entorno y perfiles de Cataluña, con la regla de las celdas pequeñas.

    Returns:
        El conjunto que exporta el paquete (censo.json).
    """
    return {
        "fuentes": {"censo": f"{CITA} Consulta del {fecha}."},
        "fecha_de_referencia": FECHA_DE_REFERENCIA,
        "min_personas": MIN_PERSONAS,
        "min_personas_perfil": MIN_PERSONAS_PERFIL,
        "municipios": _municipios_del_paquete(municipios),
        "perfil_cno3": _perfiles_del_paquete(perfiles, "3"),
        "perfil_cno2": _perfiles_del_paquete(perfiles, "2"),
        "perfil_cataluna": perfil_de_cataluna(perfiles),
        "ocupados_cataluna": ocupados_cataluna,
    }


def _controles_perfil_de_cataluna(
    controles: Controles, perfiles: list[dict[str, Any]], ocupados_cataluna: dict[str, Any]
) -> None:
    """El perfil de Cataluña suma las personas del conjunto de Cataluña dentro de la perturbación de sus cifras.

    El conjunto es el de `mercado/fuentes/cataluna/lector.py`.
    """
    conjunto = perfil_de_cataluna(perfiles)
    grupos = [perfil for perfil in perfiles if perfil["nivel"] == "2" and perfil["cno11"] != CODIGO_NO_CONSTA]
    cifras = sum(perfil["estudios"][CIFRAS_SUMADAS] for perfil in grupos)
    referencia = ocupados_cataluna["ocupados"]
    controles.comprobar(
        abs(conjunto["personas"] - referencia) <= PERTURBACION * cifras,
        f"el perfil de Cataluña ({numero_es(conjunto['personas'])} personas, {len(grupos)} grupos de 2 cifras) cuadra "
        f"con los {numero_es(referencia)} ocupados del conjunto de la fuente cataluna dentro de la perturbación",
    )


def _controles_del_conjunto(controles: Controles, conjunto: dict[str, Any]) -> None:
    """Los porcentajes de cada perfil suman 100 y ninguna cifra municipal del paquete baja de MIN_PERSONAS."""
    sumas = [
        sum(perfil[nombre].values())
        for nivel in ("perfil_cno3", "perfil_cno2")
        for perfil in conjunto[nivel].values()
        for nombre in NOMBRES_DEL_PERFIL
    ]
    sumas += [sum(conjunto["perfil_cataluna"][nombre].values()) for nombre in VARIABLES_DEL_CONJUNTO]
    controles.comprobar(
        all(abs(suma - 100) <= MARGEN_SUMA_PORCENTAJES for suma in sumas),
        f"los {len(sumas)} repartos de los perfiles suman 100 % (± {MARGEN_SUMA_PORCENTAJES} por redondeo)",
    )
    cifras = [
        grupo["ocupados"]
        for municipio in conjunto["municipios"].values()
        for lugar in LUGAR
        for grupos in municipio.get(lugar, {}).values()
        for grupo in grupos.values()
    ]
    # Sin cifras municipales en el paquete, el control falla (el conjunto está vacío) en lugar de detener la validación.
    menor = min(cifras, default=None)
    controles.comprobar(
        menor is not None and menor >= MIN_PERSONAS,
        f"ninguna de las {len(cifras)} cifras municipales del paquete baja de {MIN_PERSONAS}",
    )


# Funciones públicas


def cifras_municipales(fila: dict[str, Any]) -> dict[str, Any] | None:
    """Personas ocupadas y % de mujeres de una fila municipal si llega a MIN_PERSONAS; si no, `None`.

    Returns:
        Las personas ocupadas y el % de mujeres, o None si la fila no llega a MIN_PERSONAS.
    """
    if fila["total"] < MIN_PERSONAS:
        return None
    return {"ocupados": fila["total"], "pct_mujeres": pct(fila["mujeres"], fila["total"])}


def porcentajes(categorias: dict[str, int]) -> dict[str, float | None] | None:
    """Porcentaje de cada categoría de un perfil si suma MIN_PERSONAS_PERFIL personas o más; si no, `None`.

    Returns:
        El porcentaje de cada categoría, o None si el perfil no llega a MIN_PERSONAS_PERFIL.
    """
    total = _suma(categorias)
    if total < MIN_PERSONAS_PERFIL:
        return None
    return {
        categoria: pct(personas, total)
        for categoria, personas in sorted(categorias.items())
        if categoria != CIFRAS_SUMADAS
    }


def perfil_de_cataluna(perfiles: list[dict[str, Any]]) -> dict[str, Any]:
    """Estudios y situación profesional de todas las ocupaciones de Cataluña.

    Suma las personas de los grupos de 2 cifras antes de dividir (sin «no consta»). La nacionalidad del conjunto no se
    da: el informe no la compara.

    Returns:
        Las personas y los porcentajes de estudios y de situación profesional del conjunto.
    """
    grupos = [perfil for perfil in perfiles if perfil["nivel"] == "2" and perfil["cno11"] != CODIGO_NO_CONSTA]
    conjunto: dict[str, Any] = {}
    for nombre in VARIABLES_DEL_CONJUNTO:
        sumadas: Counter[str] = Counter()
        for perfil in grupos:
            for categoria, personas in perfil[nombre].items():
                if categoria != CIFRAS_SUMADAS:
                    sumadas[categoria] += personas
        conjunto[nombre] = dict(sumadas)
    return {
        "personas": _suma(conjunto["estudios"]),
        **{nombre: porcentajes(categorias) for nombre, categorias in conjunto.items()},
    }


def ocupados_de_cataluna() -> dict[str, Any]:
    """Ocupados, % de mujeres y edad de todas las ocupaciones (Censo 2021), sumados al preparar Cataluña.

    Los suma `mercado/fuentes/cataluna/lector.py`; van en este conjunto y no en el suyo porque cataluna.json es
    entrada de análisis publicados y no cambia.

    Returns:
        Las personas ocupadas y los porcentajes de mujeres y de edad del conjunto de Cataluña.
    """
    return leer_json(CONTEXTO_DE_CATALUNA)["conjunto_censo"]


def descargar(aceptar_cambio: bool = False) -> None:
    """Con `aceptar_cambio`, consulta de nuevo la API y registra las copias; sin él, comprueba las que hay.

    Cada consulta devuelve cifras perturbadas de otra forma: una copia nueva sustituye a la anterior solo a propósito.
    """
    descargar_consultas(
        CopiasDelCenso(FUENTE, ORIGINAL, PROCEDENCIA),
        CONSULTAS,
        _consultar_con_datos,
        {
            "fuente": NOMBRE_FUENTE,
            "cita": CITA,
            "licencia": LICENCIA_INE,
            "licencia_texto": LICENCIA_TEXTO_INE,
            "documentacion": DOCUMENTACION,
            "nota": NOTA_PERTURBACION,
        },
        aceptar_cambio,
    )


def preparar() -> None:
    """Resume las consultas: los municipios del entorno y el perfil de cada grupo en Cataluña."""
    comprobar_originales(FUENTE)
    municipios = _municipios()
    perfiles = [*_perfil("3").values(), *_perfil("2").values()]
    guardar_jsonl(MUNICIPIOS, municipios)
    guardar_jsonl(PERFILES, sorted(perfiles, key=lambda perfil: (perfil["nivel"], perfil["cno11"])))
    print(f"municipios: {len(municipios)} filas · perfiles: {len(perfiles)} grupos")


def validar() -> None:
    """Contrasta las consultas entre sí, con el Idescat y con el censo de Cataluña, y guarda el conjunto.

    El censo de Cataluña es el que guarda `mercado/fuentes/cataluna/lector.py`.
    """
    cno = leer_validado("clasificaciones")["cno11"]
    municipios, perfiles = leer_jsonl(MUNICIPIOS), leer_jsonl(PERFILES)
    procedencia = leer_json(PROCEDENCIA)
    controles = Controles()
    controles_de_huella(controles, ORIGINAL, procedencia)
    _controles_municipios(controles, municipios, cno)
    _controles_contraste(controles, municipios)
    ocupados_cataluna = ocupados_de_cataluna()
    _controles_perfiles(controles, perfiles, leer_validado("cataluna"))
    _controles_perfil_de_cataluna(controles, perfiles, ocupados_cataluna)
    fecha = min(dia_iso_en_cataluna(entrada["descargado_utc"]) for entrada in procedencia["archivos"])
    conjunto = _conjunto_validado(municipios, perfiles, "/".join(reversed(fecha.split("-"))), ocupados_cataluna)
    _controles_del_conjunto(controles, conjunto)
    informe = {
        "estado": controles.estado,
        "comprobado_utc": ahora_utc(),
        "cobertura": {
            "municipios": len(conjunto["municipios"]),
            "perfiles_cno3": len(conjunto["perfil_cno3"]),
            "perfiles_cno2": len(conjunto["perfil_cno2"]),
        },
        "limites": "Datos del grupo de ocupación a 1 de enero de 2021, no de personas. La ocupación sale de "
        "registros (contratos, en su mayoría) y casi una de cada cinco la imputa el INE. El lugar de trabajo es el "
        "establecimiento que consta en los registros: no recoge el teletrabajo ni el trabajo en varios municipios. "
        "La temporalidad es anterior a la reforma laboral de 2022. Cifras perturbadas ±3 por el INE.",
        "regla_celdas_pequenas": f"Cifras municipales de {MIN_PERSONAS} personas o más; por debajo, el subgrupo de 2 "
        f"cifras si llega. Perfiles de {numero_es(MIN_PERSONAS_PERFIL)} personas o más.",
        "controles": controles.lista,
    }
    cerrar_validacion(FUENTE, informe, controles, lambda: conjunto, compacto=True)


def main(argv: list[str] | None = None) -> int:
    """Interfaz de línea de órdenes de la fuente con su ejecutor común.

    Returns:
        El código de salida de la orden: 0 si cada etapa termina bien.
    """
    etapas = {"preparar": preparar, "validar": validar}
    return principal_fuente_con_descarga(__doc__, descargar=descargar, preparacion_y_validacion=etapas, argumentos=argv)


if __name__ == "__main__":
    sys.exit(main())
