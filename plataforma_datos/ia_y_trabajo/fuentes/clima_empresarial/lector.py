"""La IA y las competencias en los establecimientos de Cataluña: Enquesta de clima empresarial del Idescat.

El módulo de actualidad trata temas variables; algunos se repiten sin una periodicidad fija. Dos de sus ediciones
alimentan Faro, con las tablas de Cataluña (columna «Total»), literales, en `f=ssv`:

- «Intel·ligència artificial» (2.º trimestre de 2024): % de establecimientos que usan alguna tecnología de IA, IA
  generativa, y qué trabajadores la usan (personal cualificado, directivo o poco cualificado);
- «Necessitats formatives i ocupacionals» (4.º trimestre de 2025): % de establecimientos que dan «mucha» importancia
  a las competencias tecnológicas y digitales (la IA incluida) al contratar.

Son porcentajes de establecimientos, no de empresas ni de personas, y su universo no es el de la encuesta europea
(Eurostat cuenta empresas de 10 o más personas): son de Cataluña y no se comparan con Europa. El Idescat no permite
modificar sus datos: cada cifra va tal como la publica, con su fila y su columna comprobadas por su texto. Python
estándar.

Uso: python3 -m plataforma_datos.ia_y_trabajo.fuentes.clima_empresarial.lector {descargar,preparar,validar,todo}
    [--aceptar-cambio]
"""

import csv
import math
import re
import sys
from datetime import datetime
from typing import Any, NamedTuple

from plataforma_datos.comun.entrada_salida import (
    ahora_utc,
    carpetas,
    comprobar_originales,
    controles_de_huella,
    guardar_json,
    leer_json,
    original,
)
from plataforma_datos.comun.estadisticas import CITA_IDESCAT, LICENCIA_IDESCAT, LICENCIA_TEXTO_IDESCAT
from plataforma_datos.comun.nucleo import ARCHIVO_DE_PROCEDENCIA, Controles, FormatoInesperado, exigir
from plataforma_datos.comun.red import descargar_originales
from plataforma_datos.orquestacion.admision import cerrar_validacion
from plataforma_datos.orquestacion.ordenes import principal_fuente_con_descarga

FUENTE = "clima-empresarial"
ORIGINAL, PREPARADO, _ = carpetas(FUENTE)
PROCEDENCIA = ORIGINAL / ARCHIVO_DE_PROCEDENCIA
# Lo que escribe preparar y lee validar: por tabla, su título, su periodo y sus cifras por bloque y fila.
TABLAS = PREPARADO / "tablas.json"

PUBLICACION = "https://www.idescat.cat/pub/?id=clem"


# Cada tabla: su número en la publicación, su título y su periodo literales (la validación se detiene si cambian).
class TablaDelIdescat(NamedTuple):
    """Título y periodo literales que identifican una tabla oficial."""

    titulo: str
    periodo: str


class CifraDelIdescat(NamedTuple):
    """Localización de un indicador y año de su encuesta."""

    tabla: str
    bloque: str
    fila: str
    anio: int


def _nombre_del_archivo(numero: str) -> str:
    """Nombre del original de una tabla.

    Returns:
        El nombre SSV con el número oficial.
    """
    return f"idescat-clem-{numero}.ssv"


TABLAS_DEL_IDESCAT = {
    "18149": TablaDelIdescat(
        "Ús de tecnologies d'intel·ligència artificial. Per sector d'activitat",
        "Catalunya. 2n trimestre del 2024",
    ),
    "18162": TablaDelIdescat(
        "Treballadors que fan servir tecnologies d'intel·ligència artificial a l'establiment. Per sector d'activitat",
        "Catalunya. 2n trimestre del 2024",
    ),
    "22205": TablaDelIdescat(
        "Valoració de la importància de diferents habilitats o competències per realitzar contractacions de personal. "
        "Per sector d'activitat",
        "Catalunya. 4t trimestre del 2025",
    ),
}
ARCHIVOS = [
    {
        "archivo": _nombre_del_archivo(numero),
        "nivel": "oficial",
        "titulo": f"Idescat, Enquesta de clima empresarial, mòdul d'actualitat: {titulo} ({periodo})",
        "url": f"{PUBLICACION}&n={numero}&lang=es&f=ssv",
        "licencia": LICENCIA_IDESCAT,
    }
    for numero, (titulo, periodo) in TABLAS_DEL_IDESCAT.items()
]
# Cada indicador: tabla, bloque (vacío si la tabla no tiene) y fila, literales, y el año de la encuesta.
CIFRAS_DE_CADA_INDICADOR = {
    "establecimientos-ia": CifraDelIdescat("18149", "", "Ús de tecnologies d'intel·ligència artificial", 2024),
    "establecimientos-ia-generativa": CifraDelIdescat(
        "18149",
        "Tipus de tecnologies d'IA",
        "Tecnologies d'IA generativa (com ara ChatGPT)",
        2024,
    ),
    "establecimientos-ia-personal-cualificado": CifraDelIdescat(
        "18162", "", "Treballadors qualificats o molt qualificats", 2024
    ),
    "establecimientos-ia-directivos": CifraDelIdescat("18162", "", "Directius, gerents, gestors, etc.", 2024),
    "establecimientos-ia-personal-poco-cualificado": CifraDelIdescat(
        "18162",
        "",
        "Treballadors no qualificats o poc qualificats",
        2024,
    ),
    "establecimientos-competencias-digitales": CifraDelIdescat(
        "22205",
        "Competències tecnològiques i digitals (ofimàtica, sistemes TIC, programació, ciberseguretat, intel·ligència "
        "artificial, etc.)",
        "Molta",
        2025,
    ),
}
PORCENTAJE_MAXIMO = 100
COLUMNA = "Total"
SIN_DATO = ".."
# Una cifra del Idescat en el CSV: entera o con coma decimal, quizá negativa.
CIFRA = re.compile(r"-?[0-9]+(?:,[0-9]+)?")
# Cada tabla empieza por una cabecera (título, periodo, unidades, fuente, nota y dirección) antes de la fila de las
# columnas: las tres primeras líneas son el título, el periodo y las unidades.
LINEAS_DE_TITULO_PERIODO_Y_UNIDADES = 3
# Las unidades que la tercera línea de cada tabla debe declarar.
UNIDADES = "Unitats: % d'establiments."
# Cifras de referencia de las tablas oficiales: la lectura tiene que darlas.
REFERENCIA = {
    "establecimientos-ia": 11.6,
    "establecimientos-ia-generativa": 9.0,
    "establecimientos-ia-personal-cualificado": 9.8,
    "establecimientos-ia-directivos": 8.4,
    "establecimientos-ia-personal-poco-cualificado": 1.9,
    "establecimientos-competencias-digitales": 19.7,
}
CITA = f"{CITA_IDESCAT} (Enquesta de clima empresarial, mòdul d'actualitat empresarial, tablas 18149, 18162 y 22205)."


def _cifra_de_la_celda(valor: str, donde: str) -> float | None:
    """La cifra de una celda, o None si está vacía o es «..»; otra marca detiene la lectura diciendo dónde.

    Returns:
        La cifra, o None si la celda está vacía o es «..».
    """
    if valor in ("", SIN_DATO):
        return None
    exigir(bool(CIFRA.fullmatch(valor)), f"clima empresarial: cifra inesperada «{valor}» en {donde}")
    cifra = float(valor.replace(",", "."))
    exigir(math.isfinite(cifra), f"clima empresarial: cifra no finita «{valor}» en {donde}")
    return cifra


def leer_tabla(texto: str) -> dict[str, Any]:
    """Una tabla `f=ssv` del módulo: título, periodo, unidades y, por bloque y fila, la cifra de cada columna.

    Una fila sin ninguna cifra abre un bloque (por ejemplo, una competencia, con sus filas «Gens»…«Molta»); «..» es
    un dato confidencial, poco fiable o no disponible, y queda sin cifra.

    Returns:
        El título, el periodo, las unidades y, por bloque y fila, la cifra de cada columna.
    """
    lineas = texto.lstrip("\ufeff").splitlines()
    exigir(len(lineas) > LINEAS_DE_TITULO_PERIODO_Y_UNIDADES, "clima empresarial: tabla vacía")
    cabecera = next((indice for indice, linea in enumerate(lineas) if linea.startswith(";")), None)
    exigir(cabecera is not None, "clima empresarial: falta la fila de columnas")
    exigir(
        cabecera >= LINEAS_DE_TITULO_PERIODO_Y_UNIDADES,
        "clima empresarial: las columnas preceden al título, periodo o unidades",
    )
    filas = list(csv.reader(lineas[cabecera:], delimiter=";"))
    columnas = filas[0][1:]
    exigir(all(columna.strip() for columna in columnas), "clima empresarial: columnas sin nombre")
    exigir(len(set(columnas)) == len(columnas), "clima empresarial: columnas repetidas")
    exigir(COLUMNA in columnas, "clima empresarial: falta la columna Total")
    cifras: dict[str, dict[str, dict[str, float | None]]] = {}
    bloque = ""
    bloques: set[str] = set()
    for fila in filas[1:]:
        if not fila or not fila[0].strip():
            continue
        valores = [valor.strip() for valor in fila[1:]]
        etiqueta = fila[0].strip()
        exigir(
            len(valores) == len(columnas),
            f"clima empresarial: la fila «{etiqueta}» tiene {len(valores)} celdas y la tabla, {len(columnas)} columnas",
        )
        if not any(valores):
            exigir(etiqueta not in bloques, f"clima empresarial: el bloque «{etiqueta}» se repite")
            bloques.add(etiqueta)
            bloque = etiqueta
            continue
        del_bloque = cifras.setdefault(bloque, {})
        exigir(etiqueta not in del_bloque, f"clima empresarial: la fila «{etiqueta}» se repite en el bloque «{bloque}»")
        del_bloque[etiqueta] = {
            columna: _cifra_de_la_celda(valor, f"{etiqueta} / {columna}")
            for columna, valor in zip(columnas, valores, strict=True)
        }
    exigir(bool(cifras), "clima empresarial: tabla sin filas de cifras")
    titulo, periodo, unidades = lineas[:LINEAS_DE_TITULO_PERIODO_Y_UNIDADES]
    return {"titulo": titulo.strip(), "periodo": periodo.strip(), "unidades": unidades.strip(), "cifras": cifras}


def cifra(tablas: dict[str, Any], indicador: str) -> float | None:
    """La cifra de Cataluña (columna «Total») de un indicador, o None si la tabla no la trae.

    Returns:
        La cifra, o None si la tabla no la trae.
    """
    ubicacion = CIFRAS_DE_CADA_INDICADOR[indicador]
    return tablas[ubicacion.tabla]["cifras"].get(ubicacion.bloque, {}).get(ubicacion.fila, {}).get(COLUMNA)


def descargar(aceptar_cambio: bool = False) -> None:
    """Descarga las tres tablas del módulo en `f=ssv` y registra su procedencia."""
    guardar_json(
        PROCEDENCIA,
        {
            "fuente": "Idescat · Enquesta de clima empresarial, mòdul d'actualitat (IA y necesidades formativas)",
            "cita": CITA,
            "licencia": LICENCIA_IDESCAT,
            "licencia_texto": LICENCIA_TEXTO_IDESCAT,
            "archivos": descargar_originales(ARCHIVOS, ORIGINAL, aceptar_cambio),
        },
    )


def preparar() -> None:
    """Lee cada tabla tal como la publica el Idescat.

    Raises:
        FormatoInesperado: Si una tabla no tiene la forma esperada, con el nombre del SSV.
    """
    comprobar_originales(FUENTE)
    tablas = {}
    for numero in TABLAS_DEL_IDESCAT:
        nombre = _nombre_del_archivo(numero)
        texto = original(FUENTE, nombre).read_text(encoding="utf-8")
        try:
            tablas[numero] = leer_tabla(texto)
        except FormatoInesperado as error:
            raise FormatoInesperado(f"{nombre}: {error}") from error
    guardar_json(TABLAS, tablas)
    print(f"{len(tablas)} tablas del módulo de actualidad")


def consulta_de_originales(procedencia: dict[str, Any]) -> str:
    """Último día civil de descarga de las tres tablas, presentes una sola vez.

    Returns:
        La última fecha de consulta, sin convertir zonas horarias.

    Raises:
        FormatoInesperado: Si faltan originales, se repiten o sus fechas son inválidas.
    """
    archivos = procedencia.get("archivos")
    exigir(isinstance(archivos, list), "clima empresarial: falta la lista de originales")
    esperados = {_nombre_del_archivo(numero) for numero in TABLAS_DEL_IDESCAT}
    nombres = [archivo.get("archivo") for archivo in archivos if isinstance(archivo, dict)]
    exigir(
        len(nombres) == len(archivos) == len(esperados) and all(nombres.count(nombre) == 1 for nombre in esperados),
        "clima empresarial: cada original esperado debe figurar una vez: " + ", ".join(sorted(esperados)),
    )
    fechas = []
    for archivo in archivos:
        nombre, instante = archivo["archivo"], archivo.get("descargado_utc")
        motivo = f"{nombre}: descargado_utc inválido: {instante!r}"
        exigir(isinstance(instante, str), motivo)
        try:
            fechas.append(datetime.fromisoformat(instante).date().isoformat())
        except ValueError as error:
            raise FormatoInesperado(motivo) from error
    return max(fechas)


def validar() -> None:
    """Comprueba títulos, periodos, unidades, rangos y las cifras de referencia; guarda las de Cataluña."""
    tablas, procedencia = leer_json(TABLAS), leer_json(PROCEDENCIA)
    exigir(isinstance(tablas, dict), "clima empresarial: el preparado no contiene las tablas")
    for numero in TABLAS_DEL_IDESCAT:
        exigir(numero in tablas, f"clima empresarial: falta la tabla {numero} en el preparado")
    consultado = consulta_de_originales(procedencia)
    controles = Controles()
    controles_de_huella(controles, ORIGINAL, procedencia)
    cambiadas = [
        numero
        for numero, (titulo, periodo) in TABLAS_DEL_IDESCAT.items()
        if (tablas[numero]["titulo"], tablas[numero]["periodo"], tablas[numero]["unidades"])
        != (titulo, periodo, UNIDADES)
    ]
    controles.comprobar(
        not cambiadas, "título, periodo y unidades de cada tabla, literales" + (f": {cambiadas}" if cambiadas else "")
    )
    cifras = {indicador: cifra(tablas, indicador) for indicador in CIFRAS_DE_CADA_INDICADOR}
    controles.comprobar(
        all(valor is not None for valor in cifras.values()), "cada indicador tiene su cifra de Cataluña"
    )
    controles.comprobar(
        all(valor is None or 0 <= valor <= PORCENTAJE_MAXIMO for valor in cifras.values()),
        "las cifras están entre 0 y 100",
    )
    distintas = {indicador: cifras[indicador] for indicador, valor in REFERENCIA.items() if cifras[indicador] != valor}
    controles.comprobar(
        not distintas,
        "las cifras de referencia leídas en la web del Idescat" + (f"; distintas: {distintas}" if distintas else ""),
    )
    # «nota» forma parte del contrato común de las cifras, también cuando esta fuente no aporta una nota.
    # «consultado» fecha la última descarga del grupo de tablas, sin atribuirla a cada original.
    conjunto = {
        "cita": CITA,
        "licencia": LICENCIA_IDESCAT,
        "consultado": consultado,
        "cifras": {
            indicador: {"valor": cifras[indicador], "anio": ubicacion.anio, "nota": None}
            for indicador, ubicacion in CIFRAS_DE_CADA_INDICADOR.items()
        },
    }
    informe = {
        "estado": controles.estado,
        "comprobado_utc": ahora_utc(),
        "cobertura": {"tablas": len(tablas), "indicadores": len(cifras)},
        "limites": "Porcentajes de establecimientos de Cataluña (no de empresas ni de personas), de módulos temáticos "
        "sin periodicidad fija; otro universo que la encuesta europea de las empresas: no se comparan.",
        "controles": controles.lista,
    }
    cerrar_validacion(FUENTE, informe, controles, lambda: conjunto)


def main(argv: list[str] | None = None) -> int:
    """Interfaz de línea de órdenes: descargar, preparar, validar o todo.

    Returns:
        El código de salida de la orden: 0 si cada etapa termina bien.
    """
    return principal_fuente_con_descarga(
        __doc__,
        descargar=descargar,
        preparacion_y_validacion={"preparar": preparar, "validar": validar},
        argumentos=argv,
    )


if __name__ == "__main__":
    sys.exit(main())
