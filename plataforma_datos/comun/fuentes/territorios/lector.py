"""Nombres de los países en castellano y en catalán, y su código ISO 3166-1 de dos y de tres letras (Unicode CLDR).

`datos-globales.json` nombra cada país en las dos lenguas de la web y lo identifica por su código ISO 3166-1 alfa-3,
el que casa con las fronteras de Natural Earth. Eurostat publica los países con dos letras (con dos excepciones
propias: «EL» para Grecia y «UK» para el Reino Unido) e ILOSTAT, con tres. El Common Locale Data Repository de
Unicode es la referencia de los nombres de territorio por lengua (la que usan los navegadores y los sistemas) y trae la
correspondencia entre los códigos de dos y de tres letras. Se fija una versión publicada: es una fuente fija, que solo
cambia con un cambio de proyecto. Python estándar.

Uso: python3 -m plataforma_datos.comun.fuentes.territorios.lector {descargar,preparar,validar,todo} [--aceptar-cambio]
"""

import re
import sys
from typing import Any

from plataforma_datos.comun.entrada_salida import (
    ahora_utc,
    carpetas,
    comprobar_originales,
    controles_de_huella,
    guardar_json,
    leer_json,
    original,
)
from plataforma_datos.comun.fuentes.territorios.constantes import CITA_CLDR, LICENCIA_CLDR
from plataforma_datos.comun.nucleo import ARCHIVO_DE_PROCEDENCIA, ArchivoDescargable, Controles, exigir
from plataforma_datos.comun.red import descargar_originales
from plataforma_datos.orquestacion.admision import cerrar_validacion
from plataforma_datos.orquestacion.ordenes import principal_fuente_con_descarga

FUENTE = "territorios"
ORIGINAL, PREPARADO, VALIDADO = carpetas(FUENTE)
PROCEDENCIA = ORIGINAL / ARCHIVO_DE_PROCEDENCIA
# Lo que escribe preparar y lee validar: por código de dos letras, su código de tres y sus nombres.
NOMBRES = PREPARADO / "nombres.json"

VERSION_CLDR = "48.0.0"
CLDR = f"https://raw.githubusercontent.com/unicode-org/cldr-json/{VERSION_CLDR}"
# La etiqueta de versión en una dirección de cldr-json, la que fija la versión de los archivos de nombres.
ETIQUETA_DE_CLDR_JSON = re.compile(r"/cldr-json/([^/]+)/")
NOMBRES_ES = "cldr-territorios-es.json"
NOMBRES_CA = "cldr-territorios-ca.json"
CODIGOS = "cldr-codigos.json"
AVISO = "cldr-licencia.txt"
ARCHIVOS: list[ArchivoDescargable] = [
    {
        "archivo": NOMBRES_ES,
        "nivel": "oficial",
        "titulo": f"Unicode CLDR {VERSION_CLDR}: nombres de territorios en castellano (es)",
        "url": f"{CLDR}/cldr-json/cldr-localenames-full/main/es/territories.json",
        "licencia": LICENCIA_CLDR,
    },
    {
        "archivo": NOMBRES_CA,
        "nivel": "oficial",
        "titulo": f"Unicode CLDR {VERSION_CLDR}: nombres de territorios en catalán (ca)",
        "url": f"{CLDR}/cldr-json/cldr-localenames-full/main/ca/territories.json",
        "licencia": LICENCIA_CLDR,
    },
    {
        "archivo": CODIGOS,
        "nivel": "oficial",
        "titulo": f"Unicode CLDR {VERSION_CLDR}: correspondencia de los códigos de territorio (ISO 3166-1)",
        "url": f"{CLDR}/cldr-json/cldr-core/supplemental/codeMappings.json",
        "licencia": LICENCIA_CLDR,
    },
    {
        "archivo": AVISO,
        "nivel": "oficial",
        "titulo": f"Unicode CLDR {VERSION_CLDR}: aviso de copyright y permiso (Unicode License v3)",
        "url": f"{CLDR}/LICENSE",
        "licencia": LICENCIA_CLDR,
    },
]
# Un país es un código de dos letras; los de tres cifras son regiones del mundo (UN M.49) y no entran.
CODIGO_DE_PAIS = re.compile(r"[A-Z]{2}")
CODIGO_ISO3 = re.compile(r"[A-Z]{3}")
# Los códigos de dos letras que ISO 3166-1 no asigna a un país (apartado 7), que CLDR también nombra: los
# reservados excepcionalmente (Ascensión, Clipperton, Diego García, Canarias, Tristán de Acuña, agrupaciones…) y los de
# uso del usuario, que se excluyen por regla: AA, QM a QZ, XA a XZ y ZZ (CLDR los usa para «Oceanía lejana», QO, las
# pseudolenguas, XA y XB, o lo desconocido, ZZ). Kosovo (XK) es la excepción: CLDR y ILOSTAT lo tratan como país.
RESERVADOS_EXCEPCIONALMENTE = ("AC", "CP", "DG", "EA", "EU", "EZ", "FX", "IC", "SU", "TA", "UK", "UN")
KOSOVO = "XK"
USO_DEL_USUARIO_FIJOS = ("AA", "ZZ")
PRIMER_QM = "QM"
ULTIMO_QZ = "QZ"
PREFIJO_X = "X"
# Los códigos propios de Eurostat (glosario «Country codes»): Grecia y el Reino Unido con otras dos letras que ISO.
DE_EUROSTAT_A_ISO = {"EL": "GR", "UK": "GB"}
# Lo mínimo que tiene que nombrar: los territorios de la comparación y los de ILOSTAT que más pesan.
IMPRESCINDIBLES = ("ES", "DE", "FR", "IT", "US", "GR", "GB", "XK", "CN", "IN", "BR")
# ISO 3166-1 asigna 249 códigos a países; CLDR no nombra alguno en las dos lenguas y trae algunos territorios más,
# así que 240 deja un margen holgado sin aceptar una descarga recortada.
MIN_PAISES = 240
CITA = f"{CITA_CLDR} © Unicode, Inc. Unicode License v3."


def _objeto_en(contenido: object, archivo: str, ruta: tuple[str, ...]) -> dict[str, Any]:
    """Lee un objeto de CLDR sin perder el archivo ni la ruta del campo defectuoso.

    Returns:
        El objeto de la ruta, comprobados todos sus niveles.
    """
    valor = contenido
    for posicion, clave in enumerate(ruta):
        campo = ".".join(ruta[: posicion + 1])
        exigir(isinstance(valor, dict), f"CLDR: {archivo}: {campo} requiere un objeto")
        valor = valor.get(clave)
        exigir(isinstance(valor, dict), f"CLDR: {archivo}: {campo} falta o no es un objeto")
    return valor


def _territorios(contenido: dict[str, Any], lengua: str) -> dict[str, str]:
    """Los nombres de territorio de un archivo de CLDR, sin variantes («-alt-short», «-alt-variant»).

    Returns:
        Los nombres de territorio por código.
    """
    archivo = NOMBRES_ES if lengua == "es" else NOMBRES_CA
    nombres = _objeto_en(contenido, archivo, ("main", lengua, "localeDisplayNames", "territories"))
    for codigo, nombre in nombres.items():
        exigir(isinstance(codigo, str), f"CLDR: {archivo}: código de territorio no textual: {codigo!r}")
        exigir(isinstance(nombre, str) and bool(nombre), f"CLDR: {archivo}: nombre de {codigo} vacío o no textual")
    return {codigo: nombre for codigo, nombre in nombres.items() if "-alt-" not in codigo}


def es_pais(codigo: str) -> bool:
    """Si un código de territorio de CLDR es el de un país: dos letras, ni de uso del usuario ni reservado.

    Returns:
        Si es el código de un país.
    """
    if not CODIGO_DE_PAIS.fullmatch(codigo):
        return False
    if codigo == KOSOVO:
        return True
    de_uso_del_usuario = (
        codigo in USO_DEL_USUARIO_FIJOS or PRIMER_QM <= codigo <= ULTIMO_QZ or codigo.startswith(PREFIJO_X)
    )
    return not de_uso_del_usuario and codigo not in RESERVADOS_EXCEPCIONALMENTE


def nombres_de_paises(es: dict[str, Any], ca: dict[str, Any], codigos: dict[str, Any]) -> dict[str, dict[str, str]]:
    """Por código ISO de dos letras, su código de tres y sus nombres en castellano y en catalán, ordenados.

    Se omite todo territorio que no es un país (es_pais), que no tiene código de tres letras en la correspondencia
    o que no tiene nombre catalán. La validación exige el mínimo MIN_PAISES y los países IMPRESCINDIBLES.
    Un dato presente con otro tipo o formato es un error, no una ausencia.

    Returns:
        Por código de dos letras, su código de tres y sus nombres en los dos idiomas.
    """
    nombres_es, nombres_ca = _territorios(es, "es"), _territorios(ca, "ca")
    correspondencias = _objeto_en(codigos, CODIGOS, ("supplemental", "codeMappings"))
    paises: dict[str, dict[str, str]] = {}
    for codigo, nombre in sorted(nombres_es.items()):
        if not es_pais(codigo):
            continue
        correspondencia = correspondencias.get(codigo, {})
        exigir(isinstance(correspondencia, dict), f"CLDR: {CODIGOS}: correspondencia de {codigo} no es un objeto")
        tres = correspondencia.get("_alpha3")
        exigir(
            tres is None or (isinstance(tres, str) and (not tres or bool(CODIGO_ISO3.fullmatch(tres)))),
            f"CLDR: {CODIGOS}: {codigo}._alpha3 no son tres mayúsculas: {tres!r}",
        )
        if bool(tres) and codigo in nombres_ca:
            paises[codigo] = {"iso3": tres, "es": nombre, "ca": nombres_ca[codigo]}
    return paises


def comprobar_versiones(codigos: dict[str, Any], procedencia: dict[str, Any]) -> None:
    """Que los tres originales sean de la versión fijada de CLDR; si no, dice cuál y qué versión trae.

    La correspondencia de códigos declara su versión mayor (`supplemental.version._cldrVersion`). Los archivos de
    nombres de cldr-json solo traen su lengua en `identity`: su versión es la etiqueta de la dirección de la que se
    descargaron, en la procedencia, cuya huella ya ha comprobado `comprobar_originales`.
    """
    exigir(isinstance(procedencia, dict), "CLDR: procedencia.json no es un objeto")
    archivos = procedencia.get("archivos")
    exigir(isinstance(archivos, list), "CLDR: procedencia.json: archivos falta o no es una lista")
    direcciones = {}
    for posicion, entrada in enumerate(archivos):
        exigir(isinstance(entrada, dict), f"CLDR: procedencia.json: archivos[{posicion}] no es un objeto")
        nombre, direccion = entrada.get("archivo"), entrada.get("url")
        exigir(
            isinstance(nombre, str) and isinstance(direccion, str),
            f"CLDR: procedencia.json: archivos[{posicion}] necesita archivo y url textuales",
        )
        direcciones[nombre] = direccion
    leidas = {nombre: _etiqueta(direcciones.get(nombre, "")) for nombre in (NOMBRES_ES, NOMBRES_CA)}
    version = _objeto_en(codigos, CODIGOS, ("supplemental", "version"))
    leidas[CODIGOS] = version.get("_cldrVersion")
    esperadas = {NOMBRES_ES: VERSION_CLDR, NOMBRES_CA: VERSION_CLDR, CODIGOS: VERSION_CLDR.split(".")[0]}
    otras = {nombre: version for nombre, version in leidas.items() if version != esperadas[nombre]}
    exigir(not otras, f"CLDR: se espera la versión {VERSION_CLDR}; leídas {otras}")


def _etiqueta(direccion: str) -> str:
    """La etiqueta de versión de una dirección de cldr-json («…/cldr-json/48.0.0/…» → «48.0.0»), o «sin etiqueta».

    Returns:
        La etiqueta de versión.
    """
    encontrada = ETIQUETA_DE_CLDR_JSON.search(direccion)
    return encontrada.group(1) if encontrada else "sin etiqueta"


def iso2_de_eurostat(codigo: str) -> str:
    """El código ISO de dos letras de un país de Eurostat («EL» → «GR»).

    Returns:
        El código ISO de dos letras.
    """
    return DE_EUROSTAT_A_ISO.get(codigo, codigo)


def descargar(aceptar_cambio: bool = False) -> None:
    """Descarga los nombres, la correspondencia de códigos y el aviso de la versión fijada de CLDR."""
    guardar_json(
        PROCEDENCIA,
        {
            "fuente": f"Unicode CLDR {VERSION_CLDR} · nombres de territorios y códigos ISO 3166-1",
            "cita": CITA,
            "licencia": LICENCIA_CLDR,
            "archivos": descargar_originales(ARCHIVOS, ORIGINAL, aceptar_cambio),
        },
    )


def preparar() -> None:
    """Deja, por código de dos letras, el de tres letras y los nombres en las dos lenguas."""
    comprobar_originales(FUENTE)
    es, ca, codigos = (leer_json(original(FUENTE, nombre)) for nombre in (NOMBRES_ES, NOMBRES_CA, CODIGOS))
    comprobar_versiones(codigos, leer_json(PROCEDENCIA))
    paises = nombres_de_paises(es, ca, codigos)
    guardar_json(NOMBRES, {"version": VERSION_CLDR, "paises": paises})
    print(f"{len(paises)} países con código de tres letras y nombre en castellano y en catalán")


def validar() -> None:
    """Comprueba que estén todos los países necesarios, con nombre y con códigos únicos."""
    preparado, procedencia = leer_json(NOMBRES), leer_json(PROCEDENCIA)
    paises = preparado["paises"]
    controles = Controles()
    controles_de_huella(controles, ORIGINAL, procedencia)
    controles.comprobar(len(paises) >= MIN_PAISES, f"{len(paises)} países; al menos {MIN_PAISES}")
    faltan = [codigo for codigo in IMPRESCINDIBLES if codigo not in paises]
    controles.comprobar(
        not faltan,
        "están los países de la comparación y los principales de ILOSTAT" + (f"; faltan: {faltan}" if faltan else ""),
    )
    tres = [pais["iso3"] for pais in paises.values()]
    controles.comprobar(len(set(tres)) == len(tres), "cada código de tres letras es de un solo país")
    controles.comprobar(
        all(CODIGO_ISO3.fullmatch(codigo) for codigo in tres), "los códigos de tres letras son tres mayúsculas"
    )
    controles.comprobar(all(pais["es"] and pais["ca"] for pais in paises.values()), "ningún nombre vacío")
    no_paises = sorted(codigo for codigo in paises if not es_pais(codigo))
    controles.comprobar(
        not no_paises,
        "ningún código reservado ni de uso del usuario (ISO 3166-1, apartado 7) entra como país"
        + (f": {no_paises}" if no_paises else ""),
    )
    conjunto = {"fuente": procedencia["fuente"], "cita": CITA, "licencia": LICENCIA_CLDR, "paises": paises}
    informe = {
        "estado": "Admitido" if controles.admitido else "Con errores",
        "comprobado_utc": ahora_utc(),
        "cobertura": {"paises": len(paises), "version": preparado["version"]},
        "limites": "Nombres de uso común de cada lengua, no nombres oficiales de Estado. Kosovo tiene en CLDR un "
        "código de tres letras propio (XKK), no asignado por ISO 3166-1.",
        "controles": controles.lista,
    }
    cerrar_validacion(FUENTE, informe, controles, lambda: conjunto)


def main(argv: list[str] | None = None) -> int:
    """Interfaz de línea de órdenes: descargar, preparar, validar o todo.

    Returns:
        El código de salida del proceso: 0 si todo va bien.
    """
    return principal_fuente_con_descarga(
        __doc__,
        descargar=descargar,
        preparacion_y_validacion={"preparar": preparar, "validar": validar},
        argumentos=argv,
    )


if __name__ == "__main__":
    sys.exit(main())
