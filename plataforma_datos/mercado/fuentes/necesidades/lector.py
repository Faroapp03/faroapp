"""Necesidades formativas por ocupación del Observatorio de las Ocupaciones del SEPE.

El buscador del Observatorio publica, para cada grupo primario de la CNO-11 (4 cifras) con al menos dos respuestas
de empresas, una ficha «Necesidades formativas de la ocupación»: el año del estudio y las competencias que las
empresas señalaron como necesidad de formación, por tipo (técnico-profesionales, digitales, personales, idiomas y
otras transversales), cada una con un porcentaje. Es la pieza que dice qué formación pide el mercado para una
ocupación, al lado de lo que Faro ya sabe de sus tareas.

El porcentaje se conserva como lo publica la ficha, con el alcance y las limitaciones de NOTA_PORCENTAJE y
LIMITES. Los originales son capturas HTML manuales: no hay API ni descarga directa. La validación marca las fichas
que nombran la inteligencia artificial entre sus competencias técnicas. Python estándar.

Uso: python3 -m plataforma_datos.mercado.fuentes.necesidades.lector {descargar,preparar,validar,todo}
"""

import re
import sys
import unicodedata
from html.parser import HTMLParser
from types import MappingProxyType
from typing import Any

from plataforma_datos.comun.dia_de_consulta import dia_iso_en_cataluna
from plataforma_datos.comun.entrada_salida import (
    ahora_utc,
    carpetas,
    comprobar_originales,
    conserva_su_huella,
    guardar_jsonl,
    leer_json,
    leer_jsonl,
)
from plataforma_datos.comun.nucleo import ARCHIVO_DE_PROCEDENCIA, Controles, FormatoInesperado, exigir
from plataforma_datos.comun.red import aviso_descarga_manual
from plataforma_datos.comun.textos_y_cifras import numero_es
from plataforma_datos.orquestacion.admision import cerrar_validacion, leer_validado
from plataforma_datos.orquestacion.ordenes import principal_fuente

FUENTE = "sepe-necesidades"
ORIGINAL, PREPARADO, VALIDADO = carpetas(FUENTE)
PROCEDENCIA = ORIGINAL / ARCHIVO_DE_PROCEDENCIA
# Lo que escribe preparar y lee validar: una fila por ficha (grupo primario de la CNO-11).
FICHAS = PREPARADO / "fichas.jsonl"

NOMBRE_FUENTE = "SEPE · Observatorio de las Ocupaciones: necesidades formativas por ocupación"
NOTA_PORCENTAJE = (
    "Porcentaje publicado en la ficha, tal cual. El SEPE no define en su metodología sobre qué total se calcula (el "
    "Informe de prospección y detección de necesidades formativas 2025, p. 12, dice que la aplicación «pueda contar y "
    "ofrecer porcentajes de las competencias registradas de un modo directo»): no es un % de empresas ni de personas."
)
LIMITES = (
    "Necesidad de formación que las empresas señalan para la ocupación en España, no una carencia de quien consulta. "
    "Solo hay ficha para las ocupaciones con al menos dos respuestas sobre necesidades técnico-profesionales (informe "
    "2025, p. 13); cada ficha tiene su año de estudio, y no todas son de 2026. Las fichas anteriores a 2025 publican "
    "0 % en todas sus competencias técnicas: el mismo informe (p. 12) sitúa en ese ejercicio la mejora de la "
    "aplicación para ofrecer porcentajes, así que en ellas la cifra no se usa como medida (`todo_a_cero`)."
)

# Cifras de la copia del 06/10/2026: si cambian, la validación se detiene hasta revisar la copia nueva.
FICHAS_ESPERADAS = 375
FICHAS_DEL_ULTIMO_ANIO = 315
ANIOS = range(2016, 2027)
# Dos páginas se sirvieron cortadas justo después de abrir la tabla técnica: la ficha existe, sin competencias.
SIN_COMPETENCIAS_TECNICAS = frozenset({"5110", "5120"})
FICHAS_CON_IA = 57
# Desde este año las fichas publican porcentajes distintos de 0: véase NOTA_PORCENTAJE.
PRIMER_ANIO_CON_PORCENTAJES = 2025

# Título de cada sección, tal como lo escribe el SEPE, y su clave. «Actividades económicas más representativas en
# la contratación» no es una lista de competencias: se reconoce pero no se prepara.
TIPOS = MappingProxyType(
    {
        "competencias técnico - profesionales": "tecnicas",
        "competencias digitales": "digitales",
        "competencias personales": "personales",
        "competencias de idiomas": "idiomas",
        "otras competencias": "otras",
        "actividades económicas más representativas": None,
    }
)
PORCENTAJE = re.compile(r"(\d{1,3}(?:,\d+)?)\s*%")
# El tope de un porcentaje publicado: de 0 a 100.
PORCENTAJE_ENTERO = 100
# La sigla de la IA: en mayúsculas y como palabra aparte («Herramientas de IA», no «media»).
SIGLA_IA = re.compile(r"\bIA\b")


# ---------------------------------------------------------------------------------------------------------------------
# Lectura de una ficha
# ---------------------------------------------------------------------------------------------------------------------


def limpio(texto: str) -> str:
    """Reduce a uno los espacios y saltos de línea del HTML en el texto de una celda.

    Returns:
        El texto limpio.
    """
    return " ".join(texto.split())


class LectorDeFicha(HTMLParser):
    """Recorre el HTML de una ficha: cabecera (ocupación y año) y, por sección, sus tablas en celdas de texto."""

    def __init__(self) -> None:
        super().__init__()
        self.cabecera: dict[str, str] = {}
        self.secciones: list[dict[str, Any]] = []
        self._clase = ""
        self._texto: list[str] | None = None
        self._en_boton = False
        self._en_cabecera = False

    def handle_starttag(self, etiqueta: str, atributos: list[tuple[str, str | None]]) -> None:
        """Abre una sección (botón desplegable), un dato de la cabecera, una fila o una celda."""
        clase = dict(atributos).get("class") or ""
        if etiqueta == "button" and "botonDesplegable" in clase:
            self._en_boton = True
            self.secciones.append({"titulo": "", "cabeceras": [], "filas": []})
        elif etiqueta == "span" and clase.startswith("informacion-perfiles--"):
            self._clase, self._texto = clase, []
        elif etiqueta == "thead":
            self._en_cabecera = True
        elif etiqueta == "tr" and self.secciones:
            # Las filas de <thead> son los nombres de las columnas (idiomas, nivel), no competencias.
            self.secciones[-1]["cabeceras" if self._en_cabecera else "filas"].append([])
        elif etiqueta in ("td", "th") and self.secciones:
            self._texto = []

    def handle_endtag(self, etiqueta: str) -> None:
        """Cierra lo que abrió `handle_starttag` y guarda su texto."""
        if etiqueta == "button":
            self._en_boton = False
        elif etiqueta == "thead":
            self._en_cabecera = False
        elif etiqueta == "span" and self._clase:
            self.cabecera[self._clase] = limpio("".join(self._texto or []))
            self._clase, self._texto = "", None
        elif etiqueta in ("td", "th") and self._texto is not None:
            filas = self.secciones[-1]["cabeceras" if self._en_cabecera else "filas"]
            if filas:
                filas[-1].append(limpio("".join(self._texto)))
            self._texto = None

    def handle_data(self, datos: str) -> None:
        """Acumula el texto del título de la sección, de la celda abierta o del dato de cabecera."""
        if self._en_boton and self.secciones:
            self.secciones[-1]["titulo"] += datos
        if self._texto is not None:
            self._texto.append(datos)


def porcentaje(texto: str) -> float | None:
    """Lee el número de una celda «21,05%» (21.05).

    Returns:
        El número, o None si la celda no es un porcentaje (un nivel, una letra, vacía).
    """
    encontrado = PORCENTAJE.fullmatch(texto)
    return float(encontrado.group(1).replace(",", ".")) if encontrado else None


def tipo_de(titulo: str) -> str | None:
    """Busca la clave de una sección por su título; un título desconocido detiene la lectura.

    Returns:
        La clave de la sección, o None si es una sección que no se lee (las actividades económicas).

    Raises:
        FormatoInesperado: Si el título no corresponde a una sola sección conocida.
    """
    minusculas = limpio(titulo).lower()
    claves = [clave for parte, clave in TIPOS.items() if parte in minusculas]
    exigir(len(claves) == 1, f"sección desconocida en una ficha del SEPE: «{limpio(titulo)}»")
    return claves[0]


def competencia(celdas: list[str]) -> dict[str, Any]:
    """Lee una fila de técnicas, digitales, personales u otras: nombre, porcentaje publicado y, si lo hay, el nivel.

    Returns:
        La competencia con su nombre, su porcentaje (texto y número) y su nivel.
    """
    textos = [celda for celda in celdas[1:] if celda]
    publicado = next((texto for texto in textos if porcentaje(texto) is not None), None)
    fila: dict[str, Any] = {"competencia": celdas[0], "porcentaje_publicado": publicado}
    fila["porcentaje"] = None if publicado is None else porcentaje(publicado)
    nivel = [texto for texto in textos if texto != publicado]
    if nivel:
        fila["nivel"] = " ".join(nivel)
    return fila


def idioma(celdas: list[str], destrezas: list[str]) -> dict[str, Any]:
    """Lee una fila de idiomas: «INGLÉS 50%» con su porcentaje y el valor publicado de cada destreza.

    Returns:
        El idioma con su porcentaje y sus destrezas.
    """
    exigir(len(celdas) == len(destrezas) + 1, "idiomas: el número de celdas no coincide con sus destrezas")
    encontrado = re.fullmatch(rf"(.*?)\s*({PORCENTAJE.pattern})?", celdas[0])
    exigir(encontrado is not None, f"idioma con formato desconocido: {celdas[0]!r}")
    nombre, publicado = encontrado.group(1, 2)
    return {
        "competencia": nombre,
        "porcentaje_publicado": publicado,
        "porcentaje": None if publicado is None else porcentaje(publicado),
        "destrezas": [
            {"destreza": destreza, "valor_publicado": valor, "porcentaje": porcentaje(valor)}
            for destreza, valor in zip(destrezas, celdas[1:], strict=True)
        ],
    }


def leer_ficha(html: str) -> dict[str, Any]:
    """Lee el código, la ocupación, el año del estudio y las competencias por tipo de una ficha del SEPE.

    Returns:
        La ficha leída.
    """
    lector = LectorDeFicha()
    lector.feed(html)
    lector.close()
    perfil = re.fullmatch(r"(\d{4}) - (.+)", lector.cabecera.get("informacion-perfiles--perfil", ""))
    anio = re.fullmatch(r"Año de estudio - (\d{4})", lector.cabecera.get("informacion-perfiles--fecha", ""))
    exigir(perfil is not None and anio is not None, "ficha del SEPE sin «código - ocupación» o sin año de estudio")
    competencias: dict[str, list[dict[str, Any]]] = {}
    for seccion in lector.secciones:
        tipo = tipo_de(seccion["titulo"])
        if tipo is None:
            continue
        filas = [celdas for celdas in seccion["filas"] if celdas]
        if tipo == "idiomas":
            exigir(bool(seccion["cabeceras"]), "idiomas: sección sin cabecera de destrezas")
            destrezas = seccion["cabeceras"][0][1:]
            competencias[tipo] = [idioma(celdas, destrezas) for celdas in filas]
        else:
            competencias[tipo] = [competencia(celdas) for celdas in filas]
    return {
        "cno": perfil.group(1),
        "ocupacion": perfil.group(2),
        "anio": int(anio.group(1)),
        "competencias": competencias,
    }


def nombra_la_ia(texto: str) -> bool:
    """Comprueba si un texto nombra la IA: «inteligencia artificial» sin distinguir mayúsculas ni tildes, o «IA».

    Returns:
        True si la nombra.
    """
    sin_tildes = "".join(letra for letra in unicodedata.normalize("NFD", texto) if unicodedata.category(letra) != "Mn")
    return "inteligencia artificial" in sin_tildes.lower() or SIGLA_IA.search(texto) is not None


def competencias_con_ia(ficha: dict[str, Any]) -> list[str]:
    """Busca las competencias técnico-profesionales de una ficha que nombran la inteligencia artificial.

    Returns:
        Sus nombres, en el orden de la ficha.
    """
    return [
        fila["competencia"] for fila in ficha["competencias"].get("tecnicas", []) if nombra_la_ia(fila["competencia"])
    ]


# ---------------------------------------------------------------------------------------------------------------------
# Etapas
# ---------------------------------------------------------------------------------------------------------------------


def descargar() -> None:
    """Los originales no se descargan con código: lo explica y comprueba sus huellas."""
    aviso_descarga_manual(
        FUENTE,
        "Son las páginas del buscador de necesidades formativas del Observatorio de las Ocupaciones, guardadas "
        "íntegras el 06/10/2026; el SEPE no ofrece descarga directa ni API.",
    )


def preparar() -> None:
    """Lee cada ficha y escribe una fila por ocupación, con la huella del original del que sale.

    Raises:
        FormatoInesperado: Si una ficha no tiene la estructura esperada, indicando su archivo.
    """
    huellas = {entrada["archivo"]: entrada for entrada in leer_json(PROCEDENCIA)["archivos"]}
    filas = []
    for ruta in comprobar_originales(FUENTE):
        try:
            ficha = leer_ficha(ruta.read_text(encoding="utf-8"))
        except FormatoInesperado as error:
            raise FormatoInesperado(f"{ruta.name}: {error}") from error
        entrada = huellas[ruta.name]
        ficha.update({"url": entrada["url"], "archivo": ruta.name, "sha256": entrada["sha256"]})
        ficha["competencias_ia"] = competencias_con_ia(ficha)
        filas.append(ficha)
    filas.sort(key=lambda ficha: ficha["cno"])
    guardar_jsonl(FICHAS, filas)
    con_ia = sum(1 for ficha in filas if ficha["competencias_ia"])
    print(f"{len(filas)} fichas del SEPE; {con_ia} nombran la IA entre sus competencias técnicas")


def todo_a_cero(ficha: dict[str, Any]) -> bool:
    """Comprueba si todas las competencias técnicas de la ficha publican 0 % (las fichas anteriores a 2025).

    Returns:
        True si todas publican 0 %.
    """
    valores = [fila["porcentaje"] for fila in ficha["competencias"].get("tecnicas", [])]
    return bool(valores) and all(valor == 0 for valor in valores)


def _para_el_paquete(competencias: dict[str, list[dict[str, Any]]]) -> dict[str, list[dict[str, Any]]]:
    """Quita a las competencias el texto literal del porcentaje, que queda en el preparado: basta su número.

    Returns:
        Las competencias por tipo, sin ese texto.
    """
    return {
        tipo: [{clave: valor for clave, valor in fila.items() if clave != "porcentaje_publicado"} for fila in filas]
        for tipo, filas in competencias.items()
    }


def _conjunto_validado(fichas: list[dict[str, Any]], procedencia: dict[str, Any]) -> dict[str, Any]:
    """Compone la versión para el paquete: por ocupación, su año y sus competencias con el porcentaje publicado.

    Returns:
        El conjunto validado.
    """
    return {
        "fuente": NOMBRE_FUENTE,
        "cita": procedencia["cita"],
        "licencia": procedencia["licencia"],
        "consulta": min(dia_iso_en_cataluna(entrada["consultado_utc"]) for entrada in procedencia["archivos"]),
        "nota_porcentaje": NOTA_PORCENTAJE,
        "limites": LIMITES,
        "todo_a_cero": [ficha["cno"] for ficha in fichas if todo_a_cero(ficha)],
        "ocupaciones": {
            ficha["cno"]: {
                "ocupacion": ficha["ocupacion"],
                "anio": ficha["anio"],
                "url": ficha["url"],
                "competencias": _para_el_paquete(ficha["competencias"]),
                "competencias_ia": ficha["competencias_ia"],
            }
            for ficha in fichas
        },
    }


def porcentajes(ficha: dict[str, Any]) -> list[float]:
    """Reúne los porcentajes numéricos de una ficha: los de cada competencia y los de cada destreza de idiomas.

    Returns:
        Los porcentajes, en el orden de la ficha.
    """
    filas = [fila for lista in ficha["competencias"].values() for fila in lista]
    destrezas = [destreza for fila in filas for destreza in fila.get("destrezas", [])]
    return [fila["porcentaje"] for fila in filas + destrezas if fila["porcentaje"] is not None]


def _controles(controles: Controles, fichas: list[dict[str, Any]], procedencia: dict[str, Any], cno4: set[str]) -> None:
    """Número de fichas, códigos, años, porcentajes y trazabilidad de cada fila a su original."""
    huellas = {entrada["archivo"]: entrada["sha256"] for entrada in procedencia["archivos"]}
    codigos = [ficha["cno"] for ficha in fichas]
    controles.comprobar(
        len(codigos) == len(set(codigos)) == FICHAS_ESPERADAS and set(codigos) <= cno4,
        f"{numero_es(FICHAS_ESPERADAS)} fichas, una por grupo primario de la CNO-11 validada (4 cifras, sin repetir)",
    )
    anios = [ficha["anio"] for ficha in fichas]
    controles.comprobar(
        all(anio in ANIOS for anio in anios) and anios.count(ANIOS[-1]) == FICHAS_DEL_ULTIMO_ANIO,
        f"años del estudio entre {ANIOS[0]} y {ANIOS[-1]}; {FICHAS_DEL_ULTIMO_ANIO} fichas de {ANIOS[-1]}",
    )
    valores = [valor for ficha in fichas for valor in porcentajes(ficha)]
    controles.comprobar(
        bool(valores) and all(0 <= valor <= PORCENTAJE_ENTERO for valor in valores),
        f"los {numero_es(len(valores))} porcentajes publicados están entre 0 y 100",
    )
    controles.comprobar(
        all(huellas.get(ficha["archivo"]) == ficha["sha256"] for ficha in fichas),
        "cada ficha lleva el archivo y la huella de su original registrados en la procedencia",
    )
    sin_tecnicas = {ficha["cno"] for ficha in fichas if not ficha["competencias"].get("tecnicas")}
    controles.comprobar(
        all("tecnicas" in ficha["competencias"] for ficha in fichas) and sin_tecnicas == SIN_COMPETENCIAS_TECNICAS,
        "cada ficha tiene su sección técnico-profesional; vacía solo en "
        f"{', '.join(sorted(SIN_COMPETENCIAS_TECNICAS))} (páginas servidas cortadas)",
    )
    a_cero = {ficha["cno"] for ficha in fichas if todo_a_cero(ficha)}
    anteriores = {ficha["cno"] for ficha in fichas if ficha["anio"] < PRIMER_ANIO_CON_PORCENTAJES}
    controles.comprobar(
        a_cero == anteriores - SIN_COMPETENCIAS_TECNICAS,
        f"las {len(anteriores)} fichas anteriores a {PRIMER_ANIO_CON_PORCENTAJES}, y solo ellas, publican 0 % en todas "
        "sus competencias técnicas",
    )
    con_ia = sum(1 for ficha in fichas if ficha["competencias_ia"])
    controles.comprobar(
        con_ia == FICHAS_CON_IA,
        f"{FICHAS_CON_IA} fichas nombran la inteligencia artificial entre sus competencias técnico-profesionales",
    )


def _cobertura(fichas: list[dict[str, Any]]) -> dict[str, Any]:
    """Cuenta las fichas por año y por tipo de competencia, y las filas en total.

    Returns:
        Los recuentos.
    """
    tipos = [tipo for tipo in TIPOS.values() if tipo]
    return {
        "fichas": len(fichas),
        "anios": {
            str(anio): sum(1 for ficha in fichas if ficha["anio"] == anio)
            for anio in sorted({ficha["anio"] for ficha in fichas})
        },
        "fichas_por_tipo": {tipo: sum(1 for ficha in fichas if tipo in ficha["competencias"]) for tipo in tipos},
        "competencias": sum(len(lista) for ficha in fichas for lista in ficha["competencias"].values()),
        "fichas_con_ia": sum(1 for ficha in fichas if ficha["competencias_ia"]),
        "fichas_todo_a_cero": sum(1 for ficha in fichas if todo_a_cero(ficha)),
        "sin_competencias_tecnicas": sorted(SIN_COMPETENCIAS_TECNICAS),
    }


def grupos_primarios() -> set[str]:
    """Reúne los códigos de 4 cifras de la CNO-11 validada.

    Returns:
        Los códigos de los grupos primarios.
    """
    return {codigo for codigo, grupo in leer_validado("clasificaciones")["cno11"].items() if grupo["nivel"] == "4"}


def validar() -> None:
    """Comprueba las fichas preparadas y guarda el conjunto."""
    fichas = leer_jsonl(FICHAS)
    procedencia = leer_json(PROCEDENCIA)
    cno4 = grupos_primarios()
    controles = Controles()
    # Un control para todas las huellas: el informe de la validación se lee de un vistazo.
    conservan = sum(1 for entrada in procedencia["archivos"] if conserva_su_huella(ORIGINAL, entrada))
    controles.comprobar(
        conservan == len(procedencia["archivos"]) == FICHAS_ESPERADAS,
        f"los {numero_es(FICHAS_ESPERADAS)} originales conservan la huella de su procedencia",
    )
    _controles(controles, fichas, procedencia, cno4)
    informe = {
        "estado": controles.estado,
        "comprobado_utc": ahora_utc(),
        "cobertura": _cobertura(fichas),
        "porcentaje": NOTA_PORCENTAJE,
        "limites": LIMITES,
        "controles": controles.lista,
    }
    cerrar_validacion(FUENTE, informe, controles, lambda: _conjunto_validado(fichas, procedencia), compacto=True)


def main(argv: list[str] | None = None) -> int:
    """Ejecuta la interfaz de línea de órdenes: descargar (solo comprueba los originales), preparar, validar o todo.

    Returns:
        El código de salida de la orden.
    """
    etapas = {"descargar": descargar, "preparar": preparar, "validar": validar}
    return principal_fuente(__doc__, etapas, argv)


if __name__ == "__main__":
    sys.exit(main())
