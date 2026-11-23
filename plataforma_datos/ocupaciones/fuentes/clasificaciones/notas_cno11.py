"""Denominaciones oficiales de ocupaciones de las Notas explicativas de la CNO-11 del INE, por grupo primario.

Cada grupo primario de las notas trae «Ejemplos de ocupaciones incluidas en este grupo primario» («Limpiadores de
oficinas», «Carretilleros almaceneros», «Camioneros asalariados») y «Ocupaciones afines no incluidas…», cada una con
el código del grupo al que sí pertenece («Dependientes en tiendas y almacenes, 5220»). Las dos listas son
denominaciones oficiales del INE ligadas a un grupo de la CNO-11; el buscador de ocupaciones las usa como nombres
alternativos (motores/ocupaciones/src/busqueda/denominaciones.ts). Entra todo lo que las notas dicen, sin elegir.

Lee el PDF original (var/actualizacion/originales/notas-cno11/, con su procedencia) y escribe
motores/ocupaciones/src/busqueda/denominaciones-cno11.json. Python estándar: los flujos del PDF se descomprimen con
zlib y el texto se saca de los operadores de texto (Tj, TJ); las líneas partidas por la maquetación se vuelven a juntar.

Uso: python3 -m plataforma_datos.ocupaciones.fuentes.clasificaciones.notas_cno11
"""

import json
import re
import zlib
from pathlib import Path

from plataforma_datos.comun.dia_de_consulta import dia_iso_en_cataluna
from plataforma_datos.comun.nucleo import ORIGINALES, RAIZ

ORIGINAL = ORIGINALES / "notas-cno11"
SALIDA = RAIZ / "motores/ocupaciones/src/busqueda/denominaciones-cno11.json"
INICIO_DE_FLUJO = re.compile(rb"stream\r?\n")
FIN_DE_FLUJO = b"endstream"
TOKEN = re.compile(rb"\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]+>|-?\d*\.?\d+|\bT[*dD]\b|\bTJ\b|\bTj\b|\bET\b|\bBDC\b|'")
NUMERO = re.compile(rb"-?\d*\.?\d+")
ESCAPES = {ord("n"): 10, ord("r"): 13, ord("t"): 9, ord("b"): 8, ord("f"): 12}
OCTAL = range(0x30, 0x38)
MAX_CIFRAS_OCTALES = 3
BARRA = 0x5C
BYTE = 0xFF
DESPLAZAMIENTO_DE_LA_MISMA_LINEA = 0.5
OPERANDOS_DE_TD = 2
CIFRAS_POR_BYTE = 2
MARCA_DE_IDIOMA = "es-ES"
VINETA = "-"
CABECERA = re.compile(r"^(\d{4}) ([A-ZÁÉÍÓÚÑ].{3,})$")
OTRA_CABECERA = re.compile(r"^\d{1,4} [A-ZÁÉÍÓÚÑ]")
FRAGMENTO = re.compile(r"^[a-záéíóúñü]{1,3}$")
CON_CODIGO = re.compile(r"^(.*?),\s*(\d{4})$")
INCLUIDAS = "Ejemplos de ocupaciones incluidas"
AFINES = "Ocupaciones afines no incluidas"
MIN_LETRAS = 4
MAX_LETRAS = 110
MESES = {
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
}


def _literal(cadena: bytes) -> str:
    """Una cadena literal de PDF, con sus escapes, en Windows-1252 (la codificación de las fuentes de las notas).

    Returns:
        El texto de la cadena.
    """
    salida = bytearray()
    i = 0
    while i < len(cadena):
        if cadena[i] != BARRA or i + 1 >= len(cadena):
            salida.append(cadena[i])
            i += 1
            continue
        siguiente = cadena[i + 1]
        if siguiente in OCTAL:
            j, valor = i + 1, 0
            while j < len(cadena) and j - i <= MAX_CIFRAS_OCTALES and cadena[j] in OCTAL:
                valor = valor * 8 + cadena[j] - 0x30
                j += 1
            salida.append(valor & BYTE)
            i = j
            continue
        salida.append(ESCAPES.get(siguiente, siguiente))
        i += 2
    return bytes(salida).decode("cp1252", errors="replace")


def _texto_de_un_flujo(flujo: bytes) -> list[str]:
    """Las líneas de texto de un flujo de contenido: un desplazamiento vertical o el fin de un bloque cierran la línea.

    Returns:
        Las líneas, en orden.
    """
    lineas: list[str] = []
    linea: list[str] = []
    numeros: list[float] = []
    for token in TOKEN.finditer(flujo):
        valor = token.group(0)
        if NUMERO.fullmatch(valor):
            numeros.append(float(valor))
            continue
        misma_linea = (
            valor in {b"Td", b"TD"}
            and len(numeros) >= OPERANDOS_DE_TD
            and abs(numeros[-1]) < DESPLAZAMIENTO_DE_LA_MISMA_LINEA
        )
        numeros = []
        if valor.startswith(b"("):
            linea.append(_literal(valor[1:-1]))
        elif valor.startswith(b"<"):
            cifras = re.sub(rb"\s", b"", valor[1:-1])
            par = len(cifras) % CIFRAS_POR_BYTE == 0
            linea.append(bytes.fromhex(cifras.decode()).decode("cp1252", errors="replace") if par else "")
        elif valor in {b"Td", b"TD", b"T*", b"ET", b"'"} and not misma_linea:
            lineas.append("".join(linea))
            linea = []
    lineas.append("".join(linea))
    return lineas


def lineas_del_pdf(ruta: Path) -> list[str]:
    """Las líneas de texto de un PDF, sin las marcas de idioma del contenido marcado.

    Returns:
        Las líneas no vacías, en el orden de los flujos.
    """
    datos = ruta.read_bytes()
    lineas: list[str] = []
    for inicio in INICIO_DE_FLUJO.finditer(datos):
        crudo = datos[inicio.end() : datos.find(FIN_DE_FLUJO, inicio.end())]
        try:
            flujo = zlib.decompressobj().decompress(crudo)
        except zlib.error:
            continue
        if b"BT" in flujo and (b"Tj" in flujo or b"TJ" in flujo):
            lineas.extend(_texto_de_un_flujo(flujo))
    return [linea.replace(MARCA_DE_IDIOMA, "") for linea in lineas if linea.replace(MARCA_DE_IDIOMA, "").strip()]


def _es_continuacion(linea: str, anterior: str) -> bool:
    """Si la línea sigue la denominación anterior: empieza en minúscula, es un trozo o la anterior acaba en guion.

    Returns:
        Si es continuación.
    """
    limpia = linea.strip()
    return bool(limpia) and (limpia[0].islower() or anterior.endswith(("-", ",")) or bool(FRAGMENTO.match(limpia)))


class _Denominacion:
    """Una denominación que se va leyendo en varias líneas de la maquetación."""

    def __init__(self, texto: str) -> None:
        self.texto = texto.strip()
        self.pegar = False

    def seguir(self, linea: str) -> None:
        """Añade una línea: un trozo de palabra («educat» + «i» + «vo») o lo que sigue a un guion, sin espacio."""
        limpia = linea.strip()
        if FRAGMENTO.match(limpia):
            self.texto += limpia
            self.pegar = True
        elif self.pegar:
            self.texto += limpia
            self.pegar = False
        elif self.texto.endswith("-"):
            self.texto = self.texto[:-1] + limpia
        else:
            self.texto = f"{self.texto} {limpia}"


def _con_la_anterior(limpia: str, encontradas: list[tuple[str, str, str]], seccion: tuple[str, str]) -> str:
    """El comienzo de una denominación, junto con la anterior si empieza en minúscula.

    Un guion de compuesto («Bomberos-conductores») sale en el PDF como una viñeta suelta: la parte que lo sigue empieza
    en minúscula y se vuelve a juntar con la anterior de la misma lista, que se quita de las encontradas.

    Returns:
        El texto con que empieza la denominación.
    """
    if limpia[0].islower() and encontradas and encontradas[-1][:2] == seccion:
        return f"{encontradas.pop()[2]}-{limpia}"
    return limpia


def _denominaciones(lineas: list[str]) -> list[tuple[str, str, str]]:
    """Las denominaciones de las notas: (grupo de la sección, tipo de lista, texto), en orden.

    Returns:
        Las denominaciones, sin limpiar.
    """
    grupo, lista = "", ""
    actual: _Denominacion | None = None
    encontradas: list[tuple[str, str, str]] = []
    for linea in [*lineas, ""]:
        limpia = linea.strip()
        if actual is not None and limpia and limpia != VINETA and _es_continuacion(linea, actual.texto):
            actual.seguir(linea)
            continue
        if actual is not None:
            encontradas.append((grupo, lista, actual.texto))
            actual = None
        cabecera = CABECERA.match(limpia)
        if cabecera or OTRA_CABECERA.match(limpia):
            grupo, lista = (cabecera.group(1), "") if cabecera else (grupo, "")
        elif limpia.startswith(INCLUIDAS):
            lista = "incluidas"
        elif limpia.startswith(AFINES):
            lista = "afines"
        elif limpia == VINETA:
            continue
        elif lista and limpia and not limpia.startswith(("Entre sus tareas", "Los ", "Las ")):
            actual = _Denominacion(_con_la_anterior(limpia, encontradas, (grupo, lista)))
        elif limpia:
            lista = ""
    return encontradas


def _valida(nombre: str) -> bool:
    """Si una línea es una denominación.

    De largo razonable, sin cifras al principio, sin paréntesis a medias y sin ser una fecha del pie de página.

    Returns:
        Si se queda.
    """
    return (
        MIN_LETRAS <= len(nombre) <= MAX_LETRAS
        and not nombre[0].isdigit()
        and nombre.count("(") == nombre.count(")")
        and nombre.lower() not in MESES
    )


def denominaciones_por_grupo(lineas: list[str]) -> dict[str, list[str]]:
    """Cada grupo primario de la CNO-11 → sus denominaciones: las incluidas y las afines que remiten a él.

    Returns:
        Los grupos en orden de código, cada uno con sus denominaciones sin repetir.
    """
    grupos: dict[str, list[str]] = {}
    for grupo, lista, texto in _denominaciones(lineas):
        destino, nombre = grupo, texto
        if lista == "afines":
            con_codigo = CON_CODIGO.match(texto)
            if not con_codigo:
                continue
            nombre, destino = con_codigo.group(1), con_codigo.group(2)
        nombre = re.sub(r"\s+", " ", nombre).strip(" .;,")
        if _valida(nombre) and destino:
            lista_del_grupo = grupos.setdefault(destino, [])
            if nombre not in lista_del_grupo:
                lista_del_grupo.append(nombre)
    return dict(sorted(grupos.items()))


def principal() -> None:
    """Escribe motores/ocupaciones/src/busqueda/denominaciones-cno11.json con la procedencia del original."""
    procedencia = json.loads((ORIGINAL / "procedencia.json").read_text(encoding="utf-8"))
    original = procedencia["archivos"][0]
    grupos = denominaciones_por_grupo(lineas_del_pdf(ORIGINAL / original["archivo"]))
    salida = {
        "fuente": procedencia["fuente"],
        "cita": procedencia["cita"],
        "licencia": procedencia["licencia"],
        "url": original["url"],
        "sha256": original["sha256"],
        "consultado": dia_iso_en_cataluna(original["descargado_utc"]),
        "nota": "Denominaciones de «Ejemplos de ocupaciones incluidas» y de «Ocupaciones afines no incluidas» (con el "
        "código del grupo al que remiten), extraídas del PDF sin elegir ni corregir.",
        "grupos": grupos,
    }
    SALIDA.write_text(json.dumps(salida, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    total = sum(len(nombres) for nombres in grupos.values())
    print(f"{total} denominaciones en {len(grupos)} grupos primarios → {SALIDA.relative_to(RAIZ)}")


if __name__ == "__main__":
    principal()
