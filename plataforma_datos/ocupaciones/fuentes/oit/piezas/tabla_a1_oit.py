"""Lectura de la tabla A1 del WP140 y equivalencia entre sus capturas HTML oficiales."""

import math
import re
from collections.abc import Callable
from html.parser import HTMLParser
from typing import Any

from plataforma_datos.comun.nucleo import FormatoInesperado, exigir
from plataforma_datos.comun.textos_y_cifras import texto
from plataforma_datos.ocupaciones.fuentes.oit.piezas.constantes_oit import (
    CABECERA_TABLA_A1,
    DOCUMENTO,
    GRADIENTES,
    ORIGINAL,
    TITULO_TABLA_A1,
)


def _filas_a1(documento: str) -> list[list[str]]:
    """Lee las filas de la tabla A1 del documento HTML.

    Args:
        documento: La página HTML del WP140.

    Returns:
        Cada fila como lista de celdas de texto, la cabecera incluida.

    Raises:
        FormatoInesperado: Si no aparece el título de la tabla o su cierre «</table>».
    """
    inicio = documento.find(TITULO_TABLA_A1)
    exigir(inicio > 0, "tabla A1 no localizada")
    fin = documento.find("</table>", inicio)
    # Sin cierre, find da -1 y el recorte llegaría hasta el final del documento, con las filas de otras tablas.
    exigir(fin >= 0, "fin de la tabla A1 no localizado")
    filas = []
    for fila_html in re.findall(r"<tr[^>]*>(.*?)</tr>", documento[inicio:fin], flags=re.S):
        celdas_html = re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", fila_html, flags=re.S)
        celdas = [texto(re.sub(r"<[^>]+>", " ", celda)) for celda in celdas_html]
        if celdas:
            filas.append(celdas)
    return filas


def decodificar_html(datos: bytes) -> str:
    """Decodifica una página HTML descargada; los bytes no válidos en UTF-8 no impiden leerla.

    Args:
        datos: Los bytes de la página.

    Returns:
        El texto, con U+FFFD en lugar de cada byte no válido.
    """
    return datos.decode("utf-8", "replace")


def _correo_cloudflare(valor: str) -> str:
    """Decodifica la clave XOR variable de Cloudflare sin descartar la identidad del correo.

    Returns:
        La dirección que representa la secuencia hexadecimal.

    Raises:
        FormatoInesperado: Si la secuencia no contiene un correo UTF-8 decodificable.
    """
    try:
        datos = bytes.fromhex(valor)
        exigir(len(datos) > 1, "correo ofuscado incompleto en WP140")
        return bytes(byte ^ datos[0] for byte in datos[1:]).decode("utf-8", "strict")
    except (ValueError, UnicodeError):
        raise FormatoInesperado("correo ofuscado no verificable en WP140") from None


class _DocumentoWP140(HTMLParser):
    """Lee el estudio, derechos y notas; excluye navegación, pie y código de la página.

    Los tres contenedores son el contrato de esta edición HTML. Si faltan, se duplican o quedan abiertos,
    la descarga necesita revisión; no se deduce equivalencia de un fragmento vacío.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.profundidad = 0
        self.raiz: str | None = None
        self.inicio = 0
        self.omitir_div: int | None = None
        self.omitir_codigo: str | None = None
        self.textos: dict[str, list[str]] = {}
        self.recursos: dict[str, list[tuple[str, str]]] = {}

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        consumidos = [nombre for nombre, _ in attrs if nombre in {"id", "class", "href", "src", "alt", "data-cfemail"}]
        exigir(len(set(consumidos)) == len(consumidos), "atributo HTML repetido en WP140")
        atributos = dict(attrs)
        if self.omitir_codigo is not None:
            return
        if tag in {"script", "style"}:
            self.omitir_codigo = tag
            return
        if tag == "div":
            self.profundidad += 1
            identificador = atributos.get("id")
            clases = (atributos.get("class") or "").split()
            raiz = identificador if identificador in {"wp-main", "copyright"} else None
            if "ilo-footnotes-repo" in clases:
                raiz = "notas"
            if raiz is not None:
                exigir(self.raiz is None and raiz not in self.textos, "contenedor repetido o anidado en WP140")
                self.raiz, self.inicio = raiz, self.profundidad
                self.textos[raiz], self.recursos[raiz] = [], []
            if self.raiz is not None and "overlay-button" in clases:
                self.omitir_div = self.profundidad
        if self.raiz is None or self.omitir_div is not None:
            return
        self._registrar_recursos(atributos)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        exigir(tag != "div", "contenedor div autocerrado en WP140")
        super().handle_startendtag(tag, attrs)

    def _registrar_recursos(self, atributos: dict[str, str | None]) -> None:
        for atributo in ("href", "src", "alt", "data-cfemail"):
            valor = atributos.get(atributo)
            if valor is None or (atributo == "href" and valor.startswith("#")):
                continue
            if atributo == "data-cfemail":
                valor = _correo_cloudflare(valor)
            elif atributo == "href" and valor.startswith("/cdn-cgi/l/email-protection#"):
                valor = "mailto:" + _correo_cloudflare(valor.partition("#")[2])
            self.recursos[self.raiz].append((atributo, valor))

    def handle_endtag(self, tag: str) -> None:
        if self.omitir_codigo is not None:
            if tag == self.omitir_codigo:
                self.omitir_codigo = None
            return
        if tag != "div":
            return
        exigir(self.profundidad > 0, "cierre inesperado en WP140")
        if self.omitir_div == self.profundidad:
            self.omitir_div = None
        if self.raiz is not None and self.inicio == self.profundidad:
            self.raiz = None
        self.profundidad -= 1

    def handle_data(self, data: str) -> None:
        if self.raiz is not None and self.omitir_div is None and self.omitir_codigo is None:
            self.textos[self.raiz].append(data)


def _contenido_documental(datos: bytes) -> tuple[tuple[str, str, tuple[tuple[str, str], ...]], ...]:
    """Compara prosa, identidad, cifras, avisos, enlaces y referencias a figuras de esta edición.

    Las imágenes referenciadas no se descargan ni se comparan por su contenido.

    Returns:
        Texto y recursos por contenedor documental, conservando su orden.

    Raises:
        FormatoInesperado: Si el documento no es UTF-8 o sus contenedores no permiten una lectura íntegra.
    """
    lector = _DocumentoWP140()
    try:
        documento = datos.decode("utf-8-sig", "strict")
    except UnicodeError:
        raise FormatoInesperado("documento WP140 no válido en UTF-8") from None
    lector.feed(documento)
    lector.close()
    exigir(
        lector.raiz is None
        and lector.profundidad == 0
        and lector.omitir_codigo is None
        and lector.omitir_div is None
        and set(lector.textos) == {"wp-main", "copyright", "notas"},
        "contenedores del estudio WP140 incompletos",
    )
    contenido = tuple(
        (raiz, texto(" ".join(lector.textos[raiz])), tuple(lector.recursos[raiz]))
        for raiz in ("wp-main", "copyright", "notas")
    )
    exigir(all(plano for _, plano, _ in contenido), "contenedor documental vacío en WP140")
    return contenido


def equivalencia_del_original(archivo: dict[str, Any]) -> Callable[[bytes, bytes], bool] | None:
    """Da la regla para conservar un original existente cuando la descarga nueva difiere en bytes.

    Args:
        archivo: La entrada del archivo en el catálogo de descargas.

    Returns:
        La comparación entre la copia previa y la nueva (True si son equivalentes), o None si el archivo no tiene
        regla y cualquier diferencia de bytes cuenta como cambio.
    """
    if archivo.get("conservar_primera_captura"):
        return lambda previo, nuevo: True
    if archivo["archivo"] == DOCUMENTO:
        # Igual A1 no basta: una revisión de método, identidad o licencia también requiere revisión humana.
        # La plantilla, los scripts y una nueva clave de ofuscación del mismo correo no son otro estudio.
        return lambda previo, nuevo: (
            _filas_a1(decodificar_html(previo)) == _filas_a1(decodificar_html(nuevo))
            and _contenido_documental(previo) == _contenido_documental(nuevo)
        )
    return None


def _cifra(valor: str, codigo: str) -> float:
    """Lee una cifra de la tabla A1.

    Args:
        valor: La celda, como texto.
        codigo: El código ISCO-08 de la fila, para el motivo del error.

    Returns:
        La cifra.

    Raises:
        FormatoInesperado: Si la celda no es un número finito.
    """
    try:
        cifra = float(valor)
    except ValueError:
        cifra = math.nan
    exigir(math.isfinite(cifra), f"cifra no válida en la tabla A1, código {codigo}: {valor!r}")
    return cifra


def _tabla_a1(filas: list[list[str]]) -> dict[str, dict[str, Any]]:
    """Convierte las filas de la tabla A1 en la nota por ocupación.

    Args:
        filas: Las filas que da `_filas_a1`, la cabecera incluida.

    Returns:
        {código ISCO-08: gradiente, media, desviación y título}.

    Raises:
        FormatoInesperado: Si la cabecera no es la esperada, o una fila es corta, repite código, trae un gradiente
            desconocido o una cifra que no lo es.
    """
    exigir(bool(filas) and filas[0] == CABECERA_TABLA_A1, f"cabecera inesperada de la tabla A1: {filas[:1]}")
    tabla: dict[str, dict[str, Any]] = {}
    for fila in filas[1:]:
        exigir(len(fila) >= len(CABECERA_TABLA_A1), f"fila incompleta en la tabla A1: {fila}")
        gradiente, codigo, titulo, media, sd = fila[: len(CABECERA_TABLA_A1)]
        exigir(codigo not in tabla, f"código repetido en la tabla A1: {codigo}")
        exigir(gradiente in GRADIENTES, f"gradiente desconocido en la tabla A1: {gradiente}")
        tabla[codigo] = {
            "gradiente": GRADIENTES[gradiente],
            "media": _cifra(media, codigo),
            "sd": _cifra(sd, codigo),
            "titulo_a1": titulo,
        }
    return tabla


def leer_tabla_a1() -> dict[str, dict[str, Any]]:
    """Lee la nota oficial por ocupación de la copia registrada del WP140.

    Returns:
        {código ISCO-08: gradiente, media, desviación y título}.
    """
    return _tabla_a1(_filas_a1((ORIGINAL / DOCUMENTO).read_text(encoding="utf-8", errors="replace")))
