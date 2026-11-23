"""Nombres de pila y apellidos de las personas residentes en España (INE): la lista oficial de nombres propios.

Estadística del INE «Apellidos y nombres más frecuentes», a partir del Censo de población anual a 1 de enero de 2025
(publicada el 23/04/2026): todos los nombres de pila y todos los primeros apellidos que llevan 20 personas o más, de
cualquier nacionalidad, y los más frecuentes de las nacionalidades con más presencia, con los que se contrasta la lista
general. El motor la usa para reconocer un nombre propio sin adivinarlo: la limpieza de datos personales quita el que
sigue a una presentación aunque esté en minúsculas («soy laura pérez») y el buscador de ocupaciones no lo toma por una
palabra de oficio («Soy Pastora, cajera»). Se exportan también los nombres que son a la vez la primera palabra de una
ocupación ESCO (pastor, pastora…), para que ninguna de las dos piezas se coma un oficio, y lo que no es un nombre
aunque se escriba con mayúscula tras «soy»: los oficios y las palabras corrientes de los textos oficiales en castellano
y en catalán. Con ello la limpieza quita también un nombre que la lista no tiene («Hola, soy Nkechi»).

Descarga, prepara y valida. Python estándar. Depende de las validaciones de ESCO, de los textos de las tareas, de la
traducción al catalán, de los datos de Cataluña, del Idescat y de la formación: si cambia alguna, se vuelve a validar.

Uso: python3 -m plataforma_datos.comun.fuentes.nombres.lector {descargar,preparar,validar,todo} [--aceptar-cambio]
"""

import re
import sys
import time
import unicodedata
from collections.abc import Iterable
from itertools import pairwise
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
)
from plataforma_datos.comun.estadisticas import AVISO_LEGAL_INE as AVISO_LEGAL
from plataforma_datos.comun.estadisticas import LICENCIA_TEXTO_INE as LICENCIA_TEXTO
from plataforma_datos.comun.fuentes.catalan.lector import archivos_validados as catalan_validado
from plataforma_datos.comun.fuentes.catalan.lector import traducciones as traducciones_catalan
from plataforma_datos.comun.fuentes.nombres.piezas.ediciones_nombres import edicion_del_catalogo
from plataforma_datos.comun.hojas import filas_xlsx, leer_xls
from plataforma_datos.comun.nucleo import ARCHIVO_DE_PROCEDENCIA, ArchivoDescargable, Controles, exigir
from plataforma_datos.comun.red import descargar_originales
from plataforma_datos.comun.textos_y_cifras import texto
from plataforma_datos.cursos.fuentes.formacion.constantes import PREPARADOS as PREPARADOS_FORMACION
from plataforma_datos.mercado.fuentes.cataluna.lector import CONTRATACION as CONTRATACION_CATALUNA
from plataforma_datos.ocupaciones.fuentes.esco.lector import PREPARADOS as PREPARADOS_ESCO
from plataforma_datos.ocupaciones.fuentes.esco.piezas.consultas import ocupaciones_preparadas
from plataforma_datos.ocupaciones.fuentes.textos.lector import CAMPOS_REDACCION
from plataforma_datos.ocupaciones.fuentes.textos.lector import archivos_validados as textos_validados
from plataforma_datos.ocupaciones.fuentes.textos.lector import combinar as combinar_textos
from plataforma_datos.orquestacion.admision import cerrar_validacion, exigir_admitido, leer_validado
from plataforma_datos.orquestacion.ordenes import principal_fuente_con_descarga

FUENTE = "nombres"
ORIGINAL, PREPARADO, VALIDADO = carpetas(FUENTE)
PROCEDENCIA = ORIGINAL / ARCHIVO_DE_PROCEDENCIA
# Lo que escribe preparar y lee validar: las tres listas generales y las tablas por nacionalidad.
PREPARADOS = {
    "hombre": PREPARADO / "nombres-hombres.jsonl",
    "mujer": PREPARADO / "nombres-mujeres.jsonl",
    "apellidos": PREPARADO / "apellidos.jsonl",
    "nacionalidades": PREPARADO / "nacionalidades.json",
}
# Las ocupaciones ESCO preparadas, con las que se marcan los nombres que son también un oficio.
OCUPACIONES_ESCO = PREPARADOS_ESCO["ocupaciones"]
NOMBRE_FUENTE = "INE · nombres y apellidos de las personas residentes en España"
FECHA_DE_LOS_DATOS = "1 de enero de 2025"
PUBLICADO = "23/04/2026"
VERSION = f"Censo de población anual a {FECHA_DE_LOS_DATOS}; publicado el {PUBLICADO}"
PAGINA = (
    "https://www.ine.es/dyngs/INEbase/operacion.htm?c=Estadistica_C&cid=1254736177009&menu=resultados&idp=1254735572981"
)
# La cita que pide el aviso legal del INE cuando los datos se tratan, con la fecha de la última actualización.
CITA = (
    "Elaboración propia con datos extraídos del sitio web del INE: www.ine.es. Apellidos y nombres más frecuentes "
    f"de los residentes en España (Censo de población anual a {FECHA_DE_LOS_DATOS}; publicado el {PUBLICADO})."
)
LICENCIA = (
    f"Creative Commons Reconocimiento 4.0 (CC BY 4.0), según el aviso legal del INE ({AVISO_LEGAL}): citar la fuente "
    "(«Elaboración propia con datos extraídos del sitio web del INE: www.ine.es»), mencionar la fecha de la última "
    "actualización y no sugerir que el INE participa en la reutilización."
)
# LICENCIA_TEXTO procede de estadisticas: el literal del apartado «Reutilización de la información contenida en
# este sitio web» del aviso legal del INE, consultado para esta fuente el 03/10/2026.
URL_BASE = "https://www.ine.es/daco/daco42/nombyapel/"
NOMBRES = "nombres-frecuencia-20.xlsx"
NOMBRES_NACIONALIDADES = "nombres-nacionalidades.xlsx"
APELLIDOS = "apellidos-frecuencia-20.xls"
APELLIDOS_NACIONALIDADES = "apellidos-nacionalidades.xls"
# Los originales del INE: su nombre en disco, el del archivo publicado y su título en la página de resultados.
ARCHIVOS = [
    {"archivo": nombre, "nivel": "oficial", "titulo": titulo, "url": URL_BASE + publicado, "licencia": LICENCIA}
    for nombre, publicado, titulo in (
        (NOMBRES, "nombres_por_edad_media.xlsx", "INE · Todos los nombres con frecuencia igual o mayor a 20"),
        (
            NOMBRES_NACIONALIDADES,
            "nombres_por_nacionalidades.xlsx",
            "INE · Los 10 nombres más frecuentes de las nacionalidades más representativas",
        ),
        (APELLIDOS, "apellidos_frecuencia.xls", "INE · Apellidos con frecuencia igual o mayor a 20"),
        (
            APELLIDOS_NACIONALIDADES,
            "apellidos_por_nacionalidad.xls",
            "INE · Los 20 apellidos más frecuentes de las nacionalidades más representativas",
        ),
        ("nota-nombres.pdf", "nota_nombres.pdf", "INE · Nombres: descripción metodológica"),
        ("nota-apellidos.pdf", "nota_apellidos.pdf", "INE · Apellidos: descripción metodológica"),
    )
]
CATALOGO: ArchivoDescargable = {
    "archivo": "catalogo-residentes.html",
    "nivel": "oficial",
    "titulo": "INEbase · edición de nombres y apellidos de residentes",
    "url": PAGINA,
    "licencia": LICENCIA,
}
# Notas metodológicas del INE: se publica cada nombre y cada primer apellido que llevan al menos 20 personas, sin
# tildes ni diéresis, con el apóstrofo y la cedilla como únicos signos (y un punto volado en un apellido).
FRECUENCIA_MINIMA = 20
CARACTERES_DEL_INE = re.compile(r"[A-ZÑÇ' ·]+")
# Hojas del libro de nombres (1: hombres, 2: mujeres): la cabecera «Orden, Nombre, Frecuencia» va en la fila 7.
HOJAS_NOMBRES = {"hombre": 1, "mujer": 2}
FILA_CABECERA_NOMBRES = 6
CABECERA_NOMBRES = ["Orden", "Nombre", "Frecuencia"]
# Libro de apellidos: dos hojas (100 o más y de 20 a 99) con la cabecera «Orden, Apellido, Total» en la fila 5.
FILA_CABECERA_APELLIDOS = 4
CABECERA_APELLIDOS = ["Orden", "Apellido", "Total"]
# Libros por nacionalidad: una hoja por continente; en cada una, una tabla de tres columnas (nombre, frecuencia y por
# mil) por nacionalidad, y debajo de la de hombres, la de mujeres.
HOJAS_NACIONALIDADES = range(2, 6)
FILA_NACIONALIDADES_HOMBRES, FILA_NACIONALIDADES_MUJERES = 2, 15
NOMBRES_POR_NACIONALIDAD = 10
FILA_NACIONALIDADES_APELLIDOS = 3
APELLIDOS_POR_NACIONALIDAD = 20
COLUMNAS_POR_NACIONALIDAD = 3
# Última columna de un libro XLSX: XFD. Evita reservar filas de ancho arbitrario ante una referencia dañada.
MAX_COLUMNAS_XLSX = 16_384
# Lo que se quita al comparar un nombre, igual que en el motor (src/comun/nombres-propios.ts).
SIGNOS_DEL_NOMBRE = re.compile(r"['’·.]")
# La raíz con que el buscador iguala masculino y femenino (motores/ocupaciones/src/busqueda/palabras.ts): «pastor» y
# «pastora».
MAX_LETRAS_SIN_RAIZ = 4
TERMINACION_DE_GENERO_Y_NUMERO = re.compile(r"(as|os|es|a|o|e|s)$")
# Una palabra de un texto: letras, con el punto volado dentro («col·legi»); el apóstrofo la separa («l'Exèrcit»).
PALABRA = re.compile(r"[^\W\d_]+(?:·[^\W\d_]+)*")
# Los textos de una tarea oficial en castellano (plataforma_datos/ocupaciones/fuentes/textos/lector.py).
CAMPOS_DE_TAREA = ("corto", "texto_es", *CAMPOS_REDACCION)


# ---------------------------------------------------------------------------------------------------------------------
# Piezas internas de preparar
# ---------------------------------------------------------------------------------------------------------------------


def _entero(valor: object) -> int:
    """Lee una frecuencia o un orden del INE como entero (las hojas los guardan como texto o como número).

    Returns:
        El entero.
    """
    contenido = texto(valor)
    exigir(re.fullmatch(r"[0-9]+(?:\.0+)?", contenido) is not None, f"entero inesperado del INE: {contenido!r}")
    return int(contenido.split(".", 1)[0])


def _filas_numeradas(filas: Iterable[list[object]], columnas: int) -> list[list[Any]]:
    """Extrae las filas de datos de una tabla del INE: las que empiezan por su número de orden.

    Returns:
        Cada fila como `[orden, texto, n]`, en su orden.
    """
    numeradas = []
    for fila in filas:
        if len(fila) >= columnas and re.fullmatch(r"\d+(\.0)?", texto(fila[0])) and texto(fila[1]):
            numeradas.append([_entero(fila[0]), texto(fila[1]), _entero(fila[2])])
    return numeradas


def _nombres_de_pila() -> dict[str, list[list[Any]]]:
    """Lee, por sexo, los nombres publicados en el orden del INE.

    Returns:
        Sexo → filas `[orden, nombre, frecuencia]`.
    """
    por_sexo = {}
    for sexo, hoja in HOJAS_NOMBRES.items():
        filas = filas_xlsx(ORIGINAL / NOMBRES, hoja)
        cabecera = [filas[FILA_CABECERA_NOMBRES].get(columna, "") for columna in "ABC"]
        exigir(cabecera == CABECERA_NOMBRES, f"cabecera inesperada de los nombres ({sexo}): {cabecera}")
        tabla = [[fila.get(columna, "") for columna in "ABC"] for fila in filas[FILA_CABECERA_NOMBRES + 1 :]]
        por_sexo[sexo] = _filas_numeradas(tabla, len(CABECERA_NOMBRES))
    return por_sexo


def _apellidos() -> list[list[Any]]:
    """Lee los primeros apellidos publicados, de las dos hojas y en su orden.

    Returns:
        Las filas `[orden, apellido, frecuencia]`.
    """
    filas = []
    for nombre_hoja, hoja in leer_xls(ORIGINAL / APELLIDOS).items():
        cabecera = [texto(celda) for celda in hoja[FILA_CABECERA_APELLIDOS][: len(CABECERA_APELLIDOS)]]
        exigir(cabecera == CABECERA_APELLIDOS, f"cabecera inesperada de los apellidos ({nombre_hoja}): {cabecera}")
        filas += _filas_numeradas(hoja[FILA_CABECERA_APELLIDOS + 1 :], len(CABECERA_APELLIDOS))
    return sorted(filas)


def _tablas_contiguas(filas: list[list[object]], fila_titulos: int, cuantas: int) -> list[dict[str, Any]]:
    """Separa las tablas de una hoja por nacionalidad, una al lado de otra.

    Returns:
        Una tabla por nacionalidad: `{nacionalidad, filas: [[nombre, n], ...]}`.
    """
    titulos = filas[fila_titulos]
    tablas = []
    for columna in range(1, len(titulos), COLUMNAS_POR_NACIONALIDAD):
        nacionalidad = texto(titulos[columna])
        if not nacionalidad:
            continue
        datos = filas[fila_titulos + 2 : fila_titulos + 2 + cuantas]
        filas_tabla = [[texto(fila[columna]), _entero(fila[columna + 1])] for fila in datos if texto(fila[columna])]
        tablas.append({"nacionalidad": nacionalidad, "filas": filas_tabla})
    return tablas


def _como_tabla(filas: list[dict[str, str]]) -> list[list[object]]:
    """Pasa las filas de un .xlsx (`{columna: valor}`) a una tabla de celdas, con las columnas en su orden (A, B… AA…).

    Returns:
        Las filas como listas de celdas.
    """
    posiciones: dict[str, int] = {}
    for columna in {columna for fila in filas for columna in fila}:
        posicion = 0
        for letra in columna:
            posicion = posicion * 26 + ord(letra) - ord("A") + 1
        exigir(1 <= posicion <= MAX_COLUMNAS_XLSX, f"columna del INE fuera del libro XLSX: {columna}")
        posiciones[columna] = posicion - 1
    ancho = max(posiciones.values(), default=-1) + 1
    tabla: list[list[object]] = []
    for fila in filas:
        celdas: list[object] = [""] * ancho
        for columna, valor in fila.items():
            celdas[posiciones[columna]] = valor
        tabla.append(celdas)
    return tabla


def _nombres_por_nacionalidad() -> list[dict[str, Any]]:
    """Lee los 10 nombres más frecuentes de cada nacionalidad publicada, por sexo.

    Returns:
        Una tabla por nacionalidad y sexo: `{nacionalidad, sexo, filas}`.
    """
    tablas = []
    for hoja in HOJAS_NACIONALIDADES:
        filas = _como_tabla(filas_xlsx(ORIGINAL / NOMBRES_NACIONALIDADES, hoja))
        for sexo, fila in (("hombre", FILA_NACIONALIDADES_HOMBRES), ("mujer", FILA_NACIONALIDADES_MUJERES)):
            tablas += [dict(tabla, sexo=sexo) for tabla in _tablas_contiguas(filas, fila, NOMBRES_POR_NACIONALIDAD)]
    return tablas


def _apellidos_por_nacionalidad() -> list[dict[str, Any]]:
    """Lee los 20 primeros apellidos más frecuentes de cada nacionalidad publicada.

    Returns:
        Una tabla por nacionalidad: `{nacionalidad, filas}`.
    """
    tablas = []
    for nombre_hoja, filas in leer_xls(ORIGINAL / APELLIDOS_NACIONALIDADES).items():
        if nombre_hoja.lower().startswith(("índice", "indice")):
            continue
        tablas += _tablas_contiguas(filas, FILA_NACIONALIDADES_APELLIDOS, APELLIDOS_POR_NACIONALIDAD)
    return tablas


# ---------------------------------------------------------------------------------------------------------------------
# Formas que usa el motor
# ---------------------------------------------------------------------------------------------------------------------


def forma(nombre: str) -> str:
    """Compara nombres en minúsculas, sin tildes, «ñ», «ç», apóstrofos, puntos volados ni puntos.

    Es la de `formaDeNombre` en src/comun/nombres-propios.ts: las pruebas comprueban que las dos dan lo mismo
    con cada nombre y apellido publicado.

    Returns:
        La forma del nombre.
    """
    descompuesto = unicodedata.normalize("NFD", nombre.lower())
    sin_marcas = "".join(caracter for caracter in descompuesto if not unicodedata.combining(caracter))
    return SIGNOS_DEL_NOMBRE.sub("", sin_marcas)


def raiz(palabra: str) -> str:
    """Da la raíz con que el buscador iguala género y número: «pastora» y «pastores» → «pastor».

    Returns:
        La raíz de la palabra.
    """
    return palabra if len(palabra) <= MAX_LETRAS_SIN_RAIZ else TERMINACION_DE_GENERO_Y_NUMERO.sub("", palabra)


def formas_simples(filas: Iterable[list[Any]]) -> list[str]:
    """Reúne las formas de los nombres de una sola palabra, sin repetir y ordenadas.

    Los compuestos («MARIA CARMEN», «DE LA TORRE») no entran: sus partes con sentido propio ya están como nombres
    simples, y las demás son partículas («de», «del», «el») que no identifican a nadie.

    Returns:
        Las formas, ordenadas.
    """
    return sorted({forma(nombre) for _, nombre, _ in filas if " " not in nombre})


def _cabeza(titulo: str) -> str | None:
    """Da la raíz de la primera palabra de un título de ocupación («Cocineras de colectividades» → «cociner»).

    Returns:
        La raíz, o None si el título no tiene ninguna palabra.
    """
    palabras = re.findall(r"[a-z0-9]+", forma(titulo))
    return raiz(palabras[0]) if palabras else None


def cabezas_de_ocupacion(ocupaciones: Iterable[dict[str, Any]]) -> set[str]:
    """Reúne las raíces de la primera palabra de cada nombre de una ocupación ESCO (título y alternativos): los oficios.

    Returns:
        Las raíces.
    """
    variantes = [
        variante
        for ocupacion in ocupaciones
        for variante in [*ocupacion["titulo_es"].split("/"), *ocupacion.get("nombres_alternativos_es", [])]
    ]
    return {cabeza for cabeza in map(_cabeza, variantes) if cabeza}


def cabezas_de_titulos(titulos: Iterable[str]) -> set[str]:
    """Reúne las raíces de la primera palabra de cada título, y de cada forma de un título doble («cuiner/cuinera»).

    Returns:
        Las raíces.
    """
    return {cabeza for titulo in titulos for cabeza in map(_cabeza, titulo.split("/")) if cabeza}


def palabras_corrientes(texto: str | None) -> set[str]:
    """Reúne las raíces de las palabras que un texto escribe en minúscula: las corrientes, no los nombres propios.

    En un texto escrito todo en mayúsculas no hay nombres propios que separar: cuentan todas sus palabras.

    Returns:
        Las raíces.
    """
    palabras = PALABRA.findall(texto or "")
    en_mayusculas = bool(texto) and texto == texto.upper()
    return {raiz(forma(palabra)) for palabra in palabras if en_mayusculas or palabra == palabra.lower()}


def tambien_oficio(formas: Iterable[str], cabezas: set[str]) -> list[str]:
    """Busca los nombres cuya raíz es la de un oficio («pastor», «pastora»): las dos formas de género, por construcción.

    Returns:
        Los nombres, ordenados.
    """
    return sorted({nombre for nombre in formas if raiz(nombre) in cabezas})


# ---------------------------------------------------------------------------------------------------------------------
# Piezas internas de validar
# ---------------------------------------------------------------------------------------------------------------------


def _numeradas_sin_huecos(filas: list[list[Any]]) -> bool:
    """Comprueba que el orden del INE va de 1 en 1 desde 1, sin huecos ni repeticiones: no se ha perdido ninguna fila.

    Returns:
        True si no falta ni sobra ninguna fila.
    """
    return bool(filas) and [orden for orden, _, _ in filas] == list(range(1, len(filas) + 1))


def _de_mas_a_menos(filas: list[list[Any]]) -> bool:
    """Comprueba que las frecuencias van de la mayor a la menor, como las publica el INE.

    Returns:
        True si están en ese orden.
    """
    return all(anterior[2] >= siguiente[2] for anterior, siguiente in pairwise(filas))


def _contrastar(tablas: list[dict[str, Any]], generales: dict[str, set[str]]) -> list[str]:
    """Busca los nombres de una tabla por nacionalidad con 20 o más personas que faltan en la lista general de su sexo.

    Returns:
        Los nombres que faltan.
    """
    faltan = []
    for tabla in tablas:
        lista = generales[tabla.get("sexo", "apellido")]
        faltan += [
            f"{tabla['nacionalidad']}: {nombre}"
            for nombre, frecuencia in tabla["filas"]
            if frecuencia >= FRECUENCIA_MINIMA and nombre not in lista
        ]
    return faltan


def _controles_de_tabla(controles: Controles, nombre: str, filas: list[list[Any]]) -> None:
    """Cobertura y forma de una lista general: orden sin huecos, frecuencia mínima, orden y caracteres del INE."""
    controles.comprobar(_numeradas_sin_huecos(filas), f"{nombre}: {len(filas)} filas, numeradas sin huecos")
    controles.comprobar(
        all(frecuencia >= FRECUENCIA_MINIMA for _, _, frecuencia in filas),
        f"{nombre}: todas con {FRECUENCIA_MINIMA} personas o más",
    )
    controles.comprobar(_de_mas_a_menos(filas), f"{nombre}: de la más frecuente a la menos")
    controles.comprobar(
        all(CARACTERES_DEL_INE.fullmatch(texto_nombre) for _, texto_nombre, _ in filas),
        f"{nombre}: solo letras sin tildes, «Ñ», «Ç», apóstrofo y punto volado",
    )


def _controles(preparados: dict[str, Any], procedencia: dict[str, Any]) -> Controles:
    """Registra los controles de huellas, cobertura y forma de las listas generales y el contraste por nacionalidad.

    Returns:
        Los controles registrados.
    """
    controles = Controles()
    controles_de_huella(controles, ORIGINAL, procedencia)
    for sexo in HOJAS_NOMBRES:
        _controles_de_tabla(controles, f"nombres ({sexo})", preparados[sexo])
    _controles_de_tabla(controles, "primeros apellidos", preparados["apellidos"])
    generales = {clave: {nombre for _, nombre, _ in preparados[clave]} for clave in (*HOJAS_NOMBRES, "apellidos")}
    generales["apellido"] = generales.pop("apellidos")
    faltan_nombres = _contrastar(preparados["nombres_nacionalidades"], generales)
    controles.comprobar(
        not faltan_nombres,
        "los nombres más frecuentes de cada nacionalidad con 20 personas o más están en la lista general de su sexo"
        + (f" (faltan: {', '.join(faltan_nombres)})" if faltan_nombres else ""),
    )
    faltan_apellidos = _contrastar(preparados["apellidos_nacionalidades"], generales)
    controles.comprobar(
        not faltan_apellidos,
        "los primeros apellidos más frecuentes de cada nacionalidad con 20 personas o más están en la lista general"
        + (f" (faltan: {', '.join(faltan_apellidos)})" if faltan_apellidos else ""),
    )
    return controles


# ---------------------------------------------------------------------------------------------------------------------
# Palabras que no son un nombre
# ---------------------------------------------------------------------------------------------------------------------


def _textos_de_ocupacion(ocupacion: dict[str, Any]) -> list[str]:
    """Reúne el título, los nombres alternativos y la descripción de una ocupación ESCO.

    Returns:
        Los textos.
    """
    return [ocupacion["titulo_es"], *ocupacion.get("nombres_alternativos_es", []), ocupacion.get("descripcion_es", "")]


def _textos_de_tareas() -> list[str]:
    """Lee los textos en castellano de las tareas oficiales, solo si son los validados.

    La validación es la del lector de textos (ocupaciones/fuentes/textos/lector.py).

    Returns:
        Los textos de las tareas.
    """
    archivos = textos_validados()
    tareas = combinar_textos(archivos=archivos)["tareas"].values()
    return [tarea[campo] for tarea in tareas for campo in CAMPOS_DE_TAREA if tarea.get(campo)]


def _traduccion_al_catalan() -> dict[str, list[str]]:
    """Lee los textos de la traducción al catalán por tipo («tareas», «grupos», «ocupaciones»), si son los validados.

    Returns:
        Tipo → sus textos en catalán.
    """
    archivos = catalan_validado()
    por_tipo: dict[str, list[str]] = {}
    for nombre, traduccion in traducciones_catalan(archivos=archivos).items():
        por_tipo.setdefault(nombre.split("-", 1)[0], []).extend(traduccion["textos"].values())
    return por_tipo


def _nombres_oficiales_en_catalan() -> list[str]:
    """Lee los nombres oficiales en catalán de los grupos que enseña Faro: CIUO-2008 (ca) y CCO-2011 (ca), del Idescat.

    Returns:
        Los nombres.
    """
    exigir_admitido("idescat")
    oficiales = leer_validado("idescat")
    return [*oficiales["isco08_ca"].values(), *oficiales["cno11_ca"].values()]


def _titulos_del_observatori() -> list[dict[str, Any]]:
    """Lee las ocupaciones del Observatori del Treball, con su título en catalán y en castellano (cataluna admitida).

    Returns:
        Las ocupaciones con sus títulos.
    """
    exigir_admitido("cataluna")
    return leer_jsonl(CONTRATACION_CATALUNA)


def _especialidades_formativas() -> list[str]:
    """Lee los nombres de las especialidades formativas del SOC (catalán y castellano) y del SEPE (formación admitida).

    Returns:
        Los nombres.
    """
    exigir_admitido("formacion")
    soc = leer_jsonl(PREPARADOS_FORMACION["soc"])
    sepe = leer_jsonl(PREPARADOS_FORMACION["especialidades"])
    return [
        *(especialidad[campo] for especialidad in soc for campo in ("nombre_ca", "nombre_es")),
        *(especialidad["denominacion"] for especialidad in sepe),
    ]


def palabras_que_no_son_nombre(ocupaciones: list[dict[str, Any]]) -> dict[str, list[str]]:
    """Reúne lo que, escrito con mayúscula tras «soy» o «sóc», no es un nombre: oficios y palabras corrientes.

    Los oficios son la raíz de la primera palabra de cada título de ocupación: ESCO en castellano, la traducción al
    catalán de ESCO y de la ISCO-08, los nombres oficiales en catalán de los grupos (Idescat) y el Observatori del
    Treball. Las palabras corrientes, la raíz de cada palabra escrita en minúscula en los textos oficiales en castellano
    y en catalán: títulos y descripciones de ESCO, textos de las tareas, la traducción al catalán, los nombres oficiales
    de los grupos, los títulos del Observatori y las especialidades formativas. La raíz iguala el masculino y el
    femenino, el singular y el plural.

    Returns:
        «oficios» y «palabras_corrientes» → sus raíces, ordenadas.
    """
    catalan = _traduccion_al_catalan()
    oficiales = _nombres_oficiales_en_catalan()
    observatori = _titulos_del_observatori()
    titulos_catalanes = [*catalan.get("grupos", []), *catalan.get("ocupaciones", []), *oficiales]
    oficios = cabezas_de_ocupacion(ocupaciones) | cabezas_de_titulos(
        [*titulos_catalanes, *(fila["nombre_ca"] for fila in observatori)]
    )
    textos = [
        *(variante for ocupacion in ocupaciones for variante in _textos_de_ocupacion(ocupacion)),
        *_textos_de_tareas(),
        *(texto_catalan for textos_del_tipo in catalan.values() for texto_catalan in textos_del_tipo),
        *oficiales,
        *(fila[campo] for fila in observatori for campo in ("nombre_ca", "titulo")),
        *_especialidades_formativas(),
    ]
    corrientes = set().union(*map(palabras_corrientes, textos))
    return {"oficios": sorted(oficios), "palabras_corrientes": sorted(corrientes)}


def _conjunto_validado(preparados: dict[str, Any], procedencia: dict[str, Any]) -> dict[str, Any]:
    """Compone lo que usa el motor: nombres y apellidos simples, los que son también un oficio y lo que no es nombre.

    Returns:
        El conjunto validado.
    """
    nombres = formas_simples([*preparados["hombre"], *preparados["mujer"]])
    apellidos = formas_simples(preparados["apellidos"])
    ocupaciones = ocupaciones_preparadas(OCUPACIONES_ESCO)
    return {
        "fuente": NOMBRE_FUENTE,
        "cita": procedencia["cita"],
        "licencia": "CC BY 4.0",
        "frecuencia_minima": FRECUENCIA_MINIMA,
        "nombres": nombres,
        "apellidos": apellidos,
        "tambien_oficio": tambien_oficio([*nombres, *apellidos], cabezas_de_ocupacion(ocupaciones)),
        **palabras_que_no_son_nombre(ocupaciones),
    }


def _cobertura(preparados: dict[str, Any], conjunto: dict[str, Any]) -> dict[str, Any]:
    """Cuenta los nombres y apellidos que se leen y las formas que llegan al motor.

    Returns:
        Los recuentos.
    """
    return {
        "nombres_hombres": len(preparados["hombre"]),
        "nombres_mujeres": len(preparados["mujer"]),
        "primeros_apellidos": len(preparados["apellidos"]),
        "formas_de_nombre_simple": len(conjunto["nombres"]),
        "formas_de_apellido_simple": len(conjunto["apellidos"]),
        "tablas_por_nacionalidad": {
            "nombres": len(preparados["nombres_nacionalidades"]),
            "apellidos": len(preparados["apellidos_nacionalidades"]),
        },
        "tambien_oficio": conjunto["tambien_oficio"],
        "oficios": len(conjunto["oficios"]),
        "palabras_corrientes": len(conjunto["palabras_corrientes"]),
    }


def _leer_preparados() -> dict[str, Any]:
    """Lee los preparados de la fuente, por clave: hombre, mujer, apellidos y las dos tablas por nacionalidad.

    Returns:
        Clave → su preparado.
    """
    nacionalidades = leer_json(PREPARADOS["nacionalidades"])
    return {
        **{clave: leer_jsonl(PREPARADOS[clave]) for clave in ("hombre", "mujer", "apellidos")},
        "nombres_nacionalidades": nacionalidades["nombres"],
        "apellidos_nacionalidades": nacionalidades["apellidos"],
    }


# ---------------------------------------------------------------------------------------------------------------------
# Etapas
# ---------------------------------------------------------------------------------------------------------------------


def comprobar_edicion(edicion: dict[str, str]) -> None:
    """Detiene otra edición hasta revisar el método, las listas y las mediciones de privacidad."""
    exigir(
        edicion == {"fecha_datos": "01/01/2025", "publicado": PUBLICADO}
        and all(type(valor) is str for valor in edicion.values()),
        "nombres: edición distinta del contrato admitido (01/01/2025, publicado 23/04/2026); "
        "revisar método, listas, consumidores y mediciones de privacidad antes de admitirla",
    )


def descargar(aceptar_cambio: bool = False) -> None:
    """Descarga cada original desde su dirección oficial en el INE y registra su procedencia.

    Otra edición se detiene antes de escribir, también con `aceptar_cambio`; aceptar bytes no revisa la privacidad.
    """
    edicion, registrar = red.descubrir_edicion(
        CATALOGO,
        ORIGINAL,
        redireccion="nombres: redirección inesperada del catálogo del INE",
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
            "pagina": PAGINA,
            "version": VERSION,
            "cita": CITA,
            "licencia": LICENCIA,
            "licencia_texto": LICENCIA_TEXTO,
            "archivos": registros,
            "descubrimiento": [descubrimiento],
            "edicion": edicion,
        },
    )


def preparar() -> None:
    """Lee los cuatro libros del INE y guarda las listas generales y las tablas por nacionalidad."""
    comprobar_originales(FUENTE)
    nombres = _nombres_de_pila()
    apellidos = _apellidos()
    guardar_jsonl(PREPARADOS["hombre"], nombres["hombre"])
    guardar_jsonl(PREPARADOS["mujer"], nombres["mujer"])
    guardar_jsonl(PREPARADOS["apellidos"], apellidos)
    nacionalidades = {"nombres": _nombres_por_nacionalidad(), "apellidos": _apellidos_por_nacionalidad()}
    guardar_json(PREPARADOS["nacionalidades"], nacionalidades)
    print("nombres", len(nombres["hombre"]), "+", len(nombres["mujer"]), "· apellidos", len(apellidos))


def validar() -> None:
    """Comprueba cobertura y forma de las listas, las contrasta y guarda la validación y el conjunto para el motor."""
    preparados = _leer_preparados()
    procedencia = leer_json(PROCEDENCIA)
    controles = _controles(preparados, procedencia)
    informe: dict[str, Any] = {
        "estado": controles.estado,
        "comprobado_utc": ahora_utc(),
        "cobertura": None,
        "limite": (
            "Solo nombres y primeros apellidos con 20 personas o más en toda España: uno más raro no está. "
            "Muchos son también palabras corrientes (Rosa, Luz, Mesa, Calle): la lista dice qué puede ser un "
            "nombre, no qué lo es; el contexto lo decide el motor."
        ),
        "controles": controles.lista,
    }

    if not controles.admitido:
        informe.pop("cobertura")  # Sin conjunto admitido no se atribuye una cobertura.

    def conjunto_admitido() -> dict[str, Any]:
        """Compone el conjunto y su cobertura solo después de superar los controles propios.

        Returns:
            El conjunto admitido para el motor.
        """
        conjunto = _conjunto_validado(preparados, procedencia)
        informe["cobertura"] = _cobertura(preparados, conjunto)
        return conjunto

    cerrar_validacion(FUENTE, informe, controles, conjunto_admitido, compacto=True)


def main(argv: list[str] | None = None) -> int:
    """Ejecuta la interfaz de línea de órdenes: descargar, preparar, validar o todo.

    Returns:
        El código de salida de la orden.
    """
    etapas = {"preparar": preparar, "validar": validar}
    return principal_fuente_con_descarga(__doc__, descargar, etapas, argv)


if __name__ == "__main__":
    sys.exit(main())
