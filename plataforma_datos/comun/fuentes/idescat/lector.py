"""Nombres oficiales en catalán de los grupos de ocupación, del Idescat: CIUO-2008 (ca) y CCO-2011 (ca).

La CIUO-2008 (ca) es la versión catalana oficial de la ISCO-08, y la CCO-2011 (ca), la clasificación catalana de
ocupaciones del Decret 27/2012, que se corresponde con la CNO-11. Con ellas, Faro enseña en catalán el nombre oficial
de cada grupo, literal: las condiciones del Idescat no permiten modificar los datos al presentarlos.

La CNO-11 y la CCO-2011 tienen la misma estructura de 1 a 3 cifras y los mismos códigos, y a 4 cifras la
correspondencia oficial del Idescat une 498 de los 502 grupos CNO-11 con un único grupo CCO-2011. Los otros 4 la CCO
los parte en dos (PARTICIONES): no tienen un único nombre catalán, así que no se les da ninguno y el motor los enseña
en castellano. Se descarga del Idescat (`f=ssv`, CSV con `;`), no de la copia de Socrata, parada desde 2021.
Python estándar.

Uso: python3 -m plataforma_datos.comun.fuentes.idescat.lector {descargar,preparar,validar,todo} [--aceptar-cambio]
"""

import csv
import sys
from types import MappingProxyType
from typing import Any

from plataforma_datos.comun.dia_de_consulta import dia_iso_en_cataluna
from plataforma_datos.comun.entrada_salida import (
    ahora_utc,
    carpetas,
    controles_de_huella,
    guardar_json,
    leer_json,
    original,
)
from plataforma_datos.comun.estadisticas import CITA_IDESCAT, LICENCIA_IDESCAT, LICENCIA_TEXTO_IDESCAT
from plataforma_datos.comun.nucleo import (
    ARCHIVO_DE_PROCEDENCIA,
    ArchivoDescargable,
    Controles,
    FormatoInesperado,
    exigir,
)
from plataforma_datos.comun.red import descargar_originales
from plataforma_datos.orquestacion.admision import cerrar_validacion, leer_validado
from plataforma_datos.orquestacion.ordenes import principal_fuente_con_descarga

FUENTE = "idescat"
ORIGINAL, PREPARADO, VALIDADO = carpetas(FUENTE)
PROCEDENCIA = ORIGINAL / ARCHIVO_DE_PROCEDENCIA
# Lo que escribe preparar y lee validar: las dos clasificaciones y la correspondencia, tal como las publica el Idescat.
CLASIFICACIONES = PREPARADO / "clasificaciones.json"

URL_CLASIFICACIONES = "https://www.idescat.cat/classificacions/"
CIUO = "ciuo-2008-ca.ssv"
CCO = "cco-2011-ca.ssv"
CORRESPONDENCIA = "correspondencia-cco2011-cno2011-4.ssv"
ARCHIVOS: list[ArchivoDescargable] = [
    {
        "archivo": CIUO,
        "nivel": "oficial",
        "titulo": "Idescat, CIUO-2008 (ca): Classificació internacional uniforme d'ocupacions 2008, versión catalana",
        "url": f"{URL_CLASIFICACIONES}?tc=1&v0=2&id=ciuo-2008-ca&f=ssv",
        "licencia": LICENCIA_IDESCAT,
    },
    {
        "archivo": CCO,
        "nivel": "oficial",
        "titulo": "Idescat, CCO-2011 (ca): Classificació catalana d'ocupacions 2011 (Decret 27/2012)",
        "url": f"{URL_CLASIFICACIONES}?tc=1&v0=2&id=cco-2011-ca&f=ssv",
        "licencia": LICENCIA_IDESCAT,
    },
    {
        "archivo": CORRESPONDENCIA,
        "nivel": "oficial",
        "titulo": "Idescat, correspondencia CCO-2011 (ca) ↔ CNO-2011 (es), 4 cifras",
        "url": f"{URL_CLASIFICACIONES}?tc=30&v0=2&id=cco-2011-ca&v4=102&v5=346&f=ssv",
        "licencia": LICENCIA_IDESCAT,
    },
]
# Cabecera de cada archivo: título, organismo y dirección, y después la fila con los nombres de las columnas.
LINEAS_DE_CABECERA = 3
# Columnas que se leen de cada archivo: las rúbricas de una clasificación y los pares de la correspondencia.
COLUMNAS_RUBRICAS = ("Nivell", "Codi", "Descripció")
COLUMNAS_CORRESPONDENCIA = ("CCO-2011 (ca)", "CNO-2011 (es)")
# Cifras de un grupo primario (el nivel más fino de la CNO-11 y de la CCO-2011); los códigos más cortos son de los
# niveles superiores, que las dos clasificaciones comparten.
CIFRAS_DEL_GRUPO = 4
# Los grupos CNO-11 de 4 cifras que la CCO-2011 parte en dos, según la correspondencia oficial.
PARTICIONES = MappingProxyType(
    {"2599": ("2593", "2598"), "2824": ("2826", "2827"), "5993": ("5994", "5995"), "5999": ("5996", "5998")}
)
# Recuentos de CIUO y CCO completos en los originales SSV; procedencia.json conserva sus huellas y fecha de descarga.
RUBRICAS_CIUO = 619
RUBRICAS_CCO = 765
CITA = f"{CITA_IDESCAT} (CIUO-2008 (ca), CCO-2011 (ca) y su correspondencia con la CNO-2011)."


def filas(texto: str, esperadas: tuple[str, ...], nombre: str) -> list[dict[str, str]]:
    """Lee las filas de un archivo `f=ssv` del Idescat por el nombre de su columna, sin la cabecera ni filas vacías.

    Args:
        texto: Contenido del archivo, con su marca de orden si la trae.
        esperadas: Columnas que deben estar en la fila de nombres.
        nombre: Nombre del archivo, para el motivo de un error.

    Returns:
        Una fila por línea con algún valor: {columna: valor sin espacios en los extremos}.

    Raises:
        FormatoInesperado: Si falta la fila de nombres o una columna esperada, o si una fila no tiene tantos campos
            como columnas.
    """
    lineas = texto.lstrip("\ufeff").splitlines()[LINEAS_DE_CABECERA:]
    try:
        lector = csv.reader(lineas, delimiter=";", strict=True)
        columnas = next(lector, None)
        exigir(columnas is not None, f"{FUENTE}: {nombre} no tiene la fila con los nombres de las columnas")
        columnas = columnas or []
        nombradas = [columna for columna in columnas if columna]
        exigir(len(nombradas) == len(set(nombradas)), f"{FUENTE}: {nombre} tiene columnas repetidas")
        faltan = [columna for columna in esperadas if columna not in columnas]
        exigir(not faltan, f"{FUENTE}: a {nombre} le faltan las columnas {faltan}")
        resultado = []
        for fila in lector:
            if not any(valor.strip() for valor in fila):
                continue
            exigir(
                len(fila) == len(columnas),
                f"{FUENTE}: una fila de {nombre} tiene {len(fila)} campos y la cabecera {len(columnas)}",
            )
            resultado.append({columna: valor.strip() for columna, valor in zip(columnas, fila, strict=True) if columna})
        return resultado
    except csv.Error as error:
        raise FormatoInesperado(f"{FUENTE}: {nombre} no es SSV válido: {error}") from error


def rubricas(texto: str, nombre: str) -> dict[str, dict[str, str]]:
    """Lee cada código de una clasificación con su nivel y su descripción oficial, literal.

    Args:
        texto: Contenido del archivo de la clasificación.
        nombre: Nombre del archivo, para el motivo de un error.

    Returns:
        El nivel y el título de cada código.
    """
    resultado: dict[str, dict[str, str]] = {}
    for fila in filas(texto, COLUMNAS_RUBRICAS, nombre):
        codigo = fila["Codi"]
        exigir(codigo not in resultado, f"{FUENTE}: {nombre} tiene código repetido {codigo}")
        resultado[codigo] = {"nivel": fila["Nivell"], "titulo": fila["Descripció"]}
    return resultado


def correspondencia(texto: str, nombre: str) -> dict[str, list[str]]:
    """Lee la correspondencia oficial entre la CNO-11 y la CCO-2011.

    Args:
        texto: Contenido del archivo de la correspondencia.
        nombre: Nombre del archivo, para el motivo de un error.

    Returns:
        Por código CNO-11 de 4 cifras, los códigos CCO-2011 que le corresponden, en orden.
    """
    resultado: dict[str, list[str]] = {}
    for fila in filas(texto, COLUMNAS_CORRESPONDENCIA, nombre):
        resultado.setdefault(fila["CNO-2011 (es)"], []).append(fila["CCO-2011 (ca)"])
    return {cno: sorted(cco) for cno, cco in sorted(resultado.items())}


def nombres_cno11(cco: dict[str, dict[str, str]], pares: dict[str, list[str]]) -> dict[str, str]:
    """El nombre catalán oficial de cada código CNO-11.

    El de la CCO-2011 con el mismo código de 1 a 3 cifras y, a 4 cifras, el del único grupo CCO-2011 que le da la
    correspondencia; los que la CCO parte en dos no tienen ninguno. Un destino que no existe en la CCO-2011 no da
    nombre: lo señala el control de la validación, que así puede escribir su informe.

    Args:
        cco: Rúbricas de la CCO-2011, por código.
        pares: Correspondencia de `correspondencia`.

    Returns:
        El nombre catalán de cada código CNO-11 que lo tiene, ordenado por código.
    """
    nombres = {codigo: rubrica["titulo"] for codigo, rubrica in cco.items() if len(codigo) < CIFRAS_DEL_GRUPO}
    nombres.update(
        {cno: cco[unico[0]]["titulo"] for cno, unico in pares.items() if len(unico) == 1 and unico[0] in cco}
    )
    return dict(sorted(nombres.items()))


def descargar(aceptar_cambio: bool = False) -> None:
    """Descarga las dos clasificaciones y la correspondencia del Idescat y registra su procedencia."""
    guardar_json(
        PROCEDENCIA,
        {
            "fuente": "Idescat · Clasificaciones de ocupaciones en catalán",
            "cita": CITA,
            "licencia": LICENCIA_IDESCAT,
            "licencia_texto": LICENCIA_TEXTO_IDESCAT,
            "archivos": descargar_originales(ARCHIVOS, ORIGINAL, aceptar_cambio),
        },
    )


def _texto(nombre: str) -> str:
    """Lee un original del Idescat como texto, tras comprobar su huella.

    Args:
        nombre: Nombre del archivo original.

    Returns:
        El contenido del archivo.
    """
    return original(FUENTE, nombre).read_text(encoding="utf-8")


def preparar() -> None:
    """Pasa cada archivo a códigos y nombres literales."""
    datos = {
        "ciuo08": rubricas(_texto(CIUO), CIUO),
        "cco11": rubricas(_texto(CCO), CCO),
        "cno11_a_cco11": correspondencia(_texto(CORRESPONDENCIA), CORRESPONDENCIA),
    }
    guardar_json(CLASIFICACIONES, datos)
    ciuo = len(datos["ciuo08"])
    cco = len(datos["cco11"])
    pares = len(datos["cno11_a_cco11"])
    print(f"{ciuo} rúbricas CIUO-2008, {cco} CCO-2011 y {pares} grupos CNO-11 en la correspondencia")


def _controles(controles: Controles, datos: dict[str, Any], isco08_es: dict[str, str], cno11: dict[str, Any]) -> None:
    """Comprueba clasificaciones enteras, con los códigos del paquete, y una correspondencia que cubre la CNO-11.

    Args:
        controles: Controles de la validación, que reciben uno por regla.
        datos: Clasificaciones preparadas.
        isco08_es: Rúbricas ISCO-08 del paquete, por código.
        cno11: Rúbricas CNO-11 del paquete, por código.
    """
    ciuo, cco, pares = datos["ciuo08"], datos["cco11"], datos["cno11_a_cco11"]
    controles.comprobar(
        len(ciuo) == RUBRICAS_CIUO and set(ciuo) == set(isco08_es),
        f"la CIUO-2008 (ca) tiene las {RUBRICAS_CIUO} rúbricas y son los códigos ISCO-08 del paquete, de 1 a 4 cifras",
    )
    controles.comprobar(len(cco) == RUBRICAS_CCO, f"la CCO-2011 (ca) tiene sus {RUBRICAS_CCO} rúbricas")
    controles.comprobar(
        {codigo for codigo in cco if len(codigo) < CIFRAS_DEL_GRUPO}
        == {codigo for codigo in cno11 if len(codigo) < CIFRAS_DEL_GRUPO},
        "de 1 a 3 cifras, la CCO-2011 y la CNO-11 tienen los mismos códigos",
    )
    controles.comprobar(
        set(pares) == {codigo for codigo in cno11 if len(codigo) == CIFRAS_DEL_GRUPO},
        "la correspondencia oficial da cada grupo CNO-11 de 4 cifras, y ninguno más",
    )
    controles.comprobar(
        all(all(codigo in cco for codigo in destino) for destino in pares.values()),
        "cada código CCO-2011 de la correspondencia existe en la CCO-2011",
    )
    controles.comprobar(
        {cno: destino for cno, destino in pares.items() if len(destino) > 1}
        == {codigo: list(destino) for codigo, destino in PARTICIONES.items()},
        "solo los 4 grupos conocidos se parten en dos: " + ", ".join(PARTICIONES),
    )
    textos = [rubrica["titulo"] for rubrica in (*ciuo.values(), *cco.values())]
    controles.comprobar(all(textos), "ningún nombre vacío")


def validar() -> None:
    """Comprueba las clasificaciones frente a las del paquete y guarda los nombres que lee el motor."""
    datos = leer_json(CLASIFICACIONES)
    procedencia = leer_json(PROCEDENCIA)
    clasificaciones = leer_validado("clasificaciones")
    controles = Controles()
    controles_de_huella(controles, ORIGINAL, procedencia)
    _controles(controles, datos, clasificaciones["isco08_es"], clasificaciones["cno11"])
    nombres_ca = nombres_cno11(datos["cco11"], datos["cno11_a_cco11"])
    consultado = min(dia_iso_en_cataluna(archivo["descargado_utc"]) for archivo in procedencia["archivos"])
    conjunto = {
        "fuente": procedencia["fuente"],
        "cita": CITA,
        "licencia": LICENCIA_IDESCAT,
        "consultado": consultado,
        "isco08_ca": {codigo: rubrica["titulo"] for codigo, rubrica in datos["ciuo08"].items()},
        "cno11_ca": nombres_ca,
        "cno11_sin_nombre_unico": {codigo: list(destino) for codigo, destino in PARTICIONES.items()},
    }
    informe = {
        "estado": controles.estado,
        "comprobado_utc": ahora_utc(),
        "cobertura": {
            "isco08_ca": len(conjunto["isco08_ca"]),
            "cno11_ca": len(nombres_ca),
            "cno11": len(clasificaciones["cno11"]),
        },
        "limites": (
            "Nombres oficiales, literales. Los 4 grupos CNO-11 que la CCO-2011 parte en dos no tienen un único nombre "
            "catalán y se enseñan en castellano. Las ocupaciones ESCO y las tareas de la OIT no tienen versión "
            "catalana oficial: no están aquí."
        ),
        "controles": controles.lista,
    }
    cerrar_validacion(FUENTE, informe, controles, lambda: conjunto)


def main(argv: list[str] | None = None) -> int:
    """Ejecuta la etapa pedida de las clasificaciones del Idescat: descargar, preparar, validar o todo.

    Args:
        argv: Argumentos de la línea de órdenes; `None` lee los del proceso.

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
