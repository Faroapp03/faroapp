"""Certificados de profesionalidad que el SEPE relaciona con cada ocupación en sus perfiles de la oferta de empleo.

El Observatorio de las Ocupaciones del SEPE publica perfiles profesionales (2016–2025) con un apartado de la formación
que se relaciona con la ocupación, y en él certificados de profesionalidad por su código. Es una segunda fuente para
el bloque de acreditación: lo que el SEPE dice, tal cual y con su aviso, al lado de lo que Faro ha comprobado.

Relación = (perfil, año, grupo CNO-11 de 4 cifras, certificado), solo con el código nombrado expresamente en el apartado
y presente en el catálogo de la acreditación; los rangos («De X a Y») no se expanden ni se enseñan. Una ocupación ESCO
recibe las de su grupo solo si tiene un único grupo CNO-11 de 4 cifras, sin los certificados que Faro ya enseña como
comprobados y sin los que la revisión de Faro descartó para esa ocupación. Python estándar.

Uso: python3 -m plataforma_datos.mercado.fuentes.perfiles.lector {descargar,preparar,validar,todo}
"""

import csv
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import plataforma_datos.cursos.fuentes.acreditacion.piezas.validacion as validacion
from plataforma_datos.comun.entrada_salida import (
    ahora_utc,
    carpetas,
    comprobar_originales,
    guardar_jsonl,
    leer_json,
    leer_jsonl,
)
from plataforma_datos.comun.nucleo import ARCHIVO_DE_PROCEDENCIA, Controles, FormatoInesperado, exigir
from plataforma_datos.comun.red import aviso_descarga_manual
from plataforma_datos.cursos.fuentes.acreditacion.piezas.relacion_con_ocupaciones import (
    Relaciones,
    de_la_ocupacion,
    leer_cadena,
)
from plataforma_datos.cursos.fuentes.acreditacion.piezas.revision import leer_descartadas_en_la_revision
from plataforma_datos.orquestacion.admision import cerrar_validacion, leer_validado
from plataforma_datos.orquestacion.ordenes import principal_fuente

FUENTE = "perfiles"
ORIGINAL, PREPARADO, VALIDADO = carpetas(FUENTE)
PROCEDENCIA = ORIGINAL / ARCHIVO_DE_PROCEDENCIA
APARTADOS = "apartados-de-certificados.tsv"
COLUMNAS = ("perfil_id", "perfil", "anio", "cno4", "certificado", "tipo", "pagina", "linea_literal")
# Lo que escribe preparar y lee validar: una fila por (grupo CNO-11, certificado), con el perfil más reciente
# que lo nombra.
RELACIONES = PREPARADO / "relaciones.jsonl"

NOMBRE_FUENTE = (
    "SEPE · Observatorio de las Ocupaciones: certificados que relacionan los perfiles de la oferta de empleo"
)
NOMBRADOS = {"directo", "directo-normalizado"}
LIMITES = (
    "Lo dice el SEPE en sus perfiles de la oferta de empleo, que son de años distintos (2016–2025); Faro no lo ha "
    "comprobado una a una. Solo se usan los certificados nombrados por su código; los rangos no. Una ocupación ESCO "
    "recibe las relaciones solo si tiene un único grupo CNO-11 de 4 cifras."
)
# Con lo que relaciona el SEPE, la cobertura cuenta como relación por el grupo tanto lo comprobado por Faro como lo que
# solo dice el SEPE (el bloque enseña esto último aparte, como «solo-sepe»): la clave lo dice para no leerla como la
# variante «por-grupo» del bloque.
POR_GRUPO_O_SEPE = "por-grupo-o-sepe"


# ---------------------------------------------------------------------------------------------------------------------
# Descargar: los originales se guardan a mano
# ---------------------------------------------------------------------------------------------------------------------


def descargar() -> None:
    """Explica que los originales no se descargan con código y comprueba sus huellas."""
    aviso_descarga_manual(
        FUENTE,
        "La entrada operativa es la tabla de apartados de certificados de los perfiles del Observatorio de las "
        "Ocupaciones, con su procedencia y huella registradas.",
    )


# ---------------------------------------------------------------------------------------------------------------------
# Preparar: las menciones nombradas, una por (grupo CNO-11, certificado)
# ---------------------------------------------------------------------------------------------------------------------


def mas_reciente(menciones: list[dict[str, str]]) -> dict[str, str]:
    """Elige la mención que se cita de un (grupo, certificado).

    Args:
        menciones: Las menciones del mismo (grupo, certificado); al menos una.

    Returns:
        La del perfil más reciente y, a igual año, la primera por nombre de perfil.
    """
    return sorted(menciones, key=lambda fila: (-int(fila["anio"]), fila["perfil"]))[0]


def relaciones_nombradas(filas: list[dict[str, str]]) -> list[dict[str, Any]]:
    """Reúne una relación por (grupo CNO-11, certificado) nombrado por su código.

    Args:
        filas: Las menciones del original, una por línea del TSV.

    Returns:
        Las relaciones ordenadas por (grupo, certificado), sin rangos ni perfiles sin grupo, cada una con la mención
        que se cita y el número de perfiles distintos que la nombran.
    """
    menciones: dict[tuple[str, str], list[dict[str, str]]] = defaultdict(list)
    for fila in filas:
        if fila["tipo"] in NOMBRADOS and fila["cno4"]:
            menciones[(fila["cno4"], fila["certificado"])].append(fila)
    relaciones = []
    for (cno4, certificado), lista in sorted(menciones.items()):
        citada = mas_reciente(lista)
        relaciones.append(
            {
                "cno4": cno4,
                "certificado": certificado,
                "perfil": citada["perfil"],
                "anio": int(citada["anio"]),
                "pagina": int(citada["pagina"]),
                "linea": citada["linea_literal"],
                "perfiles": len({fila["perfil_id"] for fila in lista}),
            }
        )
    return relaciones


def leer_apartados(ruta: Path) -> list[dict[str, str]]:
    """Lee el TSV manual sin reparar ni descartar celdas defectuosas.

    Args:
        ruta: El original cuya huella ya se ha comprobado.

    Returns:
        Las menciones con sus valores literales, en el orden del archivo.

    Raises:
        FormatoInesperado: Si faltan columnas o filas, una fila es irregular o no se puede leer una cita.
    """
    try:
        with ruta.open(encoding="utf-8", newline="") as archivo:
            lector = csv.DictReader(archivo, delimiter="\t", strict=True)
            cabecera = lector.fieldnames or []
            faltan = sorted(set(COLUMNAS) - set(cabecera))
            exigir(not faltan, f"{ruta.name}: faltan columnas: {', '.join(faltan)}")
            exigir(len(cabecera) == len(set(cabecera)), f"{ruta.name}: hay columnas duplicadas")
            filas = []
            for fila in lector:
                contexto = f"{ruta.name}, línea {lector.line_num}"
                exigir(None not in fila and None not in fila.values(), f"{contexto}: número de celdas incorrecto")
                if fila["tipo"] in NOMBRADOS and fila["cno4"]:
                    for campo in ("anio", "pagina"):
                        try:
                            numero = int(fila[campo])
                        except ValueError as error:
                            raise FormatoInesperado(f"{contexto}: {campo} no es un entero: {fila[campo]!r}") from error
                        exigir(numero > 0, f"{contexto}: {campo} debe ser positivo: {fila[campo]!r}")
                filas.append(fila)
    except UnicodeDecodeError as error:
        raise FormatoInesperado(f"{ruta.name}: el TSV no está codificado en UTF-8") from error
    except csv.Error as error:
        raise FormatoInesperado(f"{ruta.name}: no se puede leer el TSV: {error}") from error
    exigir(bool(filas), f"{ruta.name}: no hay menciones")
    return filas


def preparar() -> None:
    """Lee las menciones del original y escribe las relaciones nombradas."""
    rutas = comprobar_originales(FUENTE)
    exigir(
        [ruta.name for ruta in rutas] == [APARTADOS],
        f"{FUENTE}: la procedencia debe registrar un solo original, {APARTADOS}",
    )
    filas = leer_apartados(rutas[0])
    relaciones = relaciones_nombradas(filas)
    guardar_jsonl(RELACIONES, relaciones)
    rangos = sum(1 for fila in filas if fila["tipo"] == "rango")
    print(f"{len(relaciones)} relaciones nombradas del SEPE; {rangos} menciones por rango, sin usar")


# ---------------------------------------------------------------------------------------------------------------------
# Validar: por ocupación ESCO, lo que el SEPE añade a lo comprobado, y la cobertura del bloque
# ---------------------------------------------------------------------------------------------------------------------


def en_el_catalogo(relaciones: list[dict[str, Any]], catalogo: set[str]) -> list[dict[str, Any]]:
    """Filtra las relaciones por el catálogo de la acreditación.

    Args:
        relaciones: Las relaciones nombradas.
        catalogo: Los códigos de los certificados vigentes.

    Returns:
        Las relaciones cuyo certificado está en el catálogo.
    """
    return [fila for fila in relaciones if fila["certificado"] in catalogo]


def ocupaciones_de_un_grupo(grupos_de: dict[str, set[str]]) -> dict[str, str]:
    """Da el grupo de cada ocupación ESCO que tiene uno solo: la única regla de qué ocupaciones reciben las del SEPE.

    Args:
        grupos_de: Los grupos CNO-11 de 4 cifras de cada ocupación ESCO.

    Returns:
        {ocupación ESCO: su único grupo}, sin las ocupaciones con ninguno o con varios.
    """
    return {esco: next(iter(grupos)) for esco, grupos in sorted(grupos_de.items()) if len(grupos) == 1}


def _por_grupo(relaciones: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """Agrupa las relaciones por su grupo CNO-11.

    Args:
        relaciones: Las relaciones nombradas.

    Returns:
        {grupo CNO-11: sus relaciones, en el orden de entrada}.
    """
    del_grupo: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for fila in relaciones:
        del_grupo[fila["cno4"]].append(fila)
    return del_grupo


def por_ocupacion(
    relaciones: list[dict[str, Any]],
    grupos_de: dict[str, set[str]],
    comprobadas: dict[str, dict[str, str]],
    descartadas: set[tuple[str, str]],
) -> dict[str, list[dict[str, Any]]]:
    """Reparte las relaciones del SEPE entre las ocupaciones ESCO con un único grupo CNO-11.

    Args:
        relaciones: Las relaciones del catálogo.
        grupos_de: Los grupos CNO-11 de cada ocupación ESCO.
        comprobadas: Lo que Faro ya enseña comprobado, por ocupación ESCO y certificado.
        descartadas: Las parejas (ocupación ESCO, certificado) que la revisión descartó (tres o más de cuatro
            juicios X).

    Returns:
        {ocupación ESCO: sus relaciones nuevas}, sin las comprobadas ni las descartadas; solo ocupaciones con alguna.
    """
    del_grupo = _por_grupo(relaciones)
    resultado = {}
    for esco, grupo in ocupaciones_de_un_grupo(grupos_de).items():
        nuevas = [
            fila
            for fila in del_grupo.get(grupo, [])
            if fila["certificado"] not in comprobadas.get(esco, {}) and (esco, fila["certificado"]) not in descartadas
        ]
        if nuevas:
            resultado[esco] = nuevas
    return resultado


def descartadas_por_la_revision(
    relaciones: list[dict[str, Any]], grupos_de: dict[str, set[str]], descartadas: set[tuple[str, str]]
) -> int:
    """Cuenta las parejas que el SEPE relaciona y la revisión de Faro descartó.

    Args:
        relaciones: Las relaciones del catálogo.
        grupos_de: Los grupos CNO-11 de cada ocupación ESCO.
        descartadas: Las parejas (ocupación ESCO, certificado) que la revisión descartó.

    Returns:
        Las parejas (ocupación ESCO de un único grupo, relación de ese grupo) que la revisión descartó.
    """
    del_grupo = _por_grupo(relaciones)
    return sum(
        1
        for esco, grupo in ocupaciones_de_un_grupo(grupos_de).items()
        for fila in del_grupo.get(grupo, [])
        if (esco, fila["certificado"]) in descartadas
    )


def relaciones_comprobadas(validado: dict[str, Any], ocupaciones: list[str]) -> Relaciones:
    """Lee lo que el bloque enseña hoy del conjunto validado de la acreditación.

    Args:
        validado: El conjunto validado de la acreditación.
        ocupaciones: Todas las ocupaciones ESCO de la cadena.

    Returns:
        Las relaciones por ocupación (vacías si no tiene) y por grupo ISCO.
    """
    de_las_ocupaciones = {esco: dict(pares) for esco, pares in validado["relaciones"]["ocupaciones"].items()}
    grupos = {isco: dict.fromkeys(lista, "grupo") for isco, lista in validado["relaciones"]["grupos"].items()}
    return Relaciones({esco: de_las_ocupaciones.get(esco, {}) for esco in ocupaciones}, grupos)


def resumen_de_cobertura(calculada: dict[str, Any], con_sepe: bool = False) -> dict[str, Any]:
    """Resume la cobertura del bloque por ocupación ESCO y por personas ocupadas.

    Args:
        calculada: La cobertura que da la validación de la acreditación.
        con_sepe: Si las relaciones lo son por el grupo o según el SEPE; entonces su clave es POR_GRUPO_O_SEPE.

    Returns:
        Las variantes del bloque por ocupación ESCO y las personas que alcanza, en % del total con un decimal.
    """
    personas = calculada["personas"]
    exigir(personas["total"] > 0, "perfiles: el total de personas de la cobertura debe ser positivo")
    variantes = Counter(calculada["ocupaciones"].values())
    if con_sepe and "por-grupo" in variantes:
        variantes[POR_GRUPO_O_SEPE] = variantes.pop("por-grupo")
    return {
        "ocupaciones_esco": dict(sorted(variantes.items())),
        "personas_pct": {
            clave: round(100 * personas[clave] / personas["total"], 1)
            for clave in ("cota_baja", "estimacion", "cota_alta")
        },
    }


def _conjunto_validado(nuevas: dict[str, list[dict[str, Any]]], procedencia: dict[str, Any]) -> dict[str, Any]:
    """Compone la versión para el paquete.

    Args:
        nuevas: Las relaciones del SEPE por ocupación ESCO.
        procedencia: La procedencia de los originales, con su cita y su licencia.

    Returns:
        Los perfiles citados y, por ocupación ESCO, cada certificado con la posición de su perfil.
    """
    perfiles = sorted({(fila["perfil"], fila["anio"]) for lista in nuevas.values() for fila in lista})
    indice = {perfil: posicion for posicion, perfil in enumerate(perfiles)}
    return {
        "fuente": NOMBRE_FUENTE,
        "cita": procedencia["cita"],
        "licencia": procedencia["licencia"],
        "limites": LIMITES,
        "perfiles": [list(perfil) for perfil in perfiles],
        "ocupaciones": {
            esco: [[fila["certificado"], indice[(fila["perfil"], fila["anio"])]] for fila in lista]
            for esco, lista in nuevas.items()
        },
    }


def _controles(
    controles: Controles,
    relaciones: list[dict[str, Any]],
    nuevas: dict[str, list[dict[str, Any]]],
    descartadas: set[tuple[str, str]],
    hoy: Relaciones,
) -> None:
    """Registra lo que tiene que cumplir el conjunto.

    Args:
        controles: Donde se registran.
        relaciones: Las relaciones nombradas.
        nuevas: Las relaciones del SEPE por ocupación ESCO.
        descartadas: Las parejas que la revisión descartó.
        hoy: Lo que el bloque enseña comprobado.
    """
    exigir(bool(relaciones), "perfiles: no hay relaciones nombradas para validar")
    cno4 = {codigo for codigo, grupo in leer_validado("clasificaciones")["cno11"].items() if grupo["nivel"] == "4"}
    controles.comprobar(all(fila["cno4"] in cno4 for fila in relaciones), "cada grupo es de 4 cifras de la CNO-11")
    controles.comprobar(
        not any((esco, fila["certificado"]) in descartadas for esco, lista in nuevas.items() for fila in lista),
        f"ninguna de las {len(descartadas)} parejas (ocupación ESCO, certificado) que la revisión descartó se usa",
    )
    controles.comprobar(
        all(fila["certificado"] not in hoy.ocupaciones[esco] for esco, lista in nuevas.items() for fila in lista),
        "lo comprobado por Faro manda: ningún certificado se enseña a la vez como comprobado y como del SEPE",
    )


def _con_sepe(hoy: Relaciones, nuevas: dict[str, list[dict[str, Any]]]) -> Relaciones:
    """Suma a lo comprobado lo que relaciona el SEPE; lo comprobado manda si un certificado está en los dos.

    Args:
        hoy: Lo que el bloque enseña comprobado.
        nuevas: Las relaciones del SEPE por ocupación ESCO.

    Returns:
        Las relaciones de hoy con las del SEPE añadidas como «grupo».
    """
    return Relaciones(
        {
            esco: {**{fila["certificado"]: "grupo" for fila in nuevas.get(esco, [])}, **propias}
            for esco, propias in hoy.ocupaciones.items()
        },
        hoy.grupos,
    )


def _cobertura(
    relaciones: list[dict[str, Any]],
    usadas: list[dict[str, Any]],
    nuevas: dict[str, list[dict[str, Any]]],
    hoy: Relaciones,
) -> dict[str, int]:
    """Cuenta lo que el conjunto alcanza.

    Args:
        relaciones: Las relaciones nombradas.
        usadas: Las del catálogo.
        nuevas: Las relaciones del SEPE por ocupación ESCO.
        hoy: Lo que el bloque enseña comprobado.

    Returns:
        Relaciones, grupos, perfiles, ocupaciones y parejas, por su nombre en el informe.
    """
    return {
        "relaciones_nombradas": len(relaciones),
        "relaciones_usadas": len(usadas),
        "grupos_cno4": len({fila["cno4"] for fila in usadas}),
        "perfiles_citados": len({(fila["perfil"], fila["anio"]) for lista in nuevas.values() for fila in lista}),
        "ocupaciones_esco_con_sepe": len(nuevas),
        "ocupaciones_esco_solo_con_sepe": sum(1 for esco in nuevas if not hoy.ocupaciones[esco]),
        "parejas_esco_certificado": sum(len(lista) for lista in nuevas.values()),
    }


def validar() -> None:
    """Calcula las relaciones de cada ocupación ESCO, la cobertura de hoy y la nueva, y guarda el conjunto."""
    relaciones = leer_jsonl(RELACIONES)
    procedencia = leer_json(PROCEDENCIA)
    validado = leer_validado("acreditacion")
    usadas = en_el_catalogo(relaciones, set(validado["certificados"]))
    descartadas = leer_descartadas_en_la_revision()
    cadena = leer_cadena()
    grupos_de = {esco: set(de_la_ocupacion(esco, cadena).grupos) for esco in cadena.ocupaciones}
    hoy = relaciones_comprobadas(validado, list(cadena.ocupaciones))
    nuevas = por_ocupacion(usadas, grupos_de, hoy.ocupaciones, descartadas)
    certificados = validacion.certificados_para_cobertura(validado["certificados"])
    censo = leer_validado("cataluna")
    controles = Controles()
    _controles(controles, relaciones, nuevas, descartadas, hoy)
    informe = {
        "estado": controles.estado,
        "comprobado_utc": ahora_utc(),
        "cobertura": _cobertura(relaciones, usadas, nuevas, hoy),
        "descartadas_por_la_revision": descartadas_por_la_revision(usadas, grupos_de, descartadas),
        # El mismo cálculo que la validación de la acreditación (cobertura()), sin y con lo que relaciona el SEPE.
        "cobertura_del_bloque": {
            "hoy": resumen_de_cobertura(validacion.cobertura(cadena, certificados, hoy, censo)),
            "con_sepe": resumen_de_cobertura(
                validacion.cobertura(cadena, certificados, _con_sepe(hoy, nuevas), censo), con_sepe=True
            ),
        },
        "limites": LIMITES,
        "controles": controles.lista,
    }
    cerrar_validacion(FUENTE, informe, controles, lambda: _conjunto_validado(nuevas, procedencia), compacto=True)


def main(argv: list[str] | None = None) -> int:
    """Ejecuta la interfaz de línea de órdenes: descargar (solo comprueba los originales), preparar, validar o todo.

    Args:
        argv: Los argumentos; None toma los de la línea de órdenes.

    Returns:
        El código de salida del proceso.
    """
    etapas = {"descargar": descargar, "preparar": preparar, "validar": validar}
    return principal_fuente(__doc__, etapas, argv)


if __name__ == "__main__":
    sys.exit(main())
