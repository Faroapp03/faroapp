"""El uso de la IA generativa en Cataluña: Idescat, Enquesta TIC a les llars 2025 (tablas 3.4.1 y 3.4.2).

El Idescat tabula para Cataluña la TIC-H del INE, que es la encuesta europea del uso de las TIC en los hogares: sus
cifras se comparan con las de Eurostat en la misma base, las personas de 16 a 74 años que usaron internet en los tres
meses anteriores (`isoc_ai_iaiu`, unidad `PC_IND_IU3`), nunca con las de toda la población (`PC_IND`). Se guardan,
literales: el uso de alguna herramienta de IA generativa y el uso para el trabajo, en total y por sexo (3.4.1), y,
entre quienes no la usan, quienes no saben cómo (3.4.2); y, de la segunda tabla de cada página, lo mismo por
ocupación principal. La metodología de la encuesta define «treballador manual» como los grandes grupos 6 a 9 de la
CNO-94 y «no manual» como los grupos 0 y 1 a 5: la misma división que los grupos ISCO 6–9 y 0–5 de Eurostat, así que
el uso para trabajar de unos y otros es la cifra de Cataluña de esos indicadores en su base de usuarios de internet, y
se contrasta con el cálculo de Faro con los microdatos de la TIC-H (`tich`). «Treballador TIC» es una lista propia de
grupos primarios de la CNO-94, no la de Eurostat: va en su propio indicador, solo de Cataluña, como quienes no saben
usarla por ocupación. Esa misma división hace que el motivo «no sabe cómo» de manuales y no manuales sea la línea del
informe para la clase de la ocupación de la persona (`motivos_no_uso`, que exportar_paquete añade a tich.json con su
procedencia): la validación comprueba que la clase de cada grupo ISCO-08 de 2 cifras en `tich` es la del Idescat. Las
tablas no se publican en `f=ssv`: se leen de su HTML, y cada cifra se busca por el texto de su fila y de su columna.
Python estándar.

El conjunto validado declara si se contrastó con el cálculo de Faro (`contraste_con_la_tich`: «misma-edicion») o si se
validó sin contraste por ser otra edición de la TIC-H («edicion-distinta»); en ese caso el panel lo avisa en la fila de
la fuente (`avisoEdicion`: «sin-contraste-con-la-tich»).

Con la misma edición de la TIC-H, «no sabía cómo» de cada clase debe caer dentro del intervalo del 95 % del cálculo de
Faro con los microdatos (`contraste_no_sabe_como` de la validación de `tich`, con dos entrevistas o más): el Idescat
explota los mismos microdatos públicos del INE y su factor, y con los de 2025 el cálculo da las mismas cifras (45,8 % y
33,5 %, con 120 y 234 entrevistas). La descripción de `IAG_NO3` en el diseño de registro tiene que decir, tras los dos
puntos y sin contar mayúsculas, espacios, forma Unicode ni puntuación final, «no sabía cómo utilizarlas»; si no, el
contraste se detiene. Sin cálculo, o sin nadie en la base, no hay contraste: el conjunto lo declara
(`contraste_con_la_tich`: «motivo-sin-calculo») y el panel lo avisa, sin detener la fuente. La prueba de lectura usa las
dos páginas reales de 2025 conservadas en las pruebas, con su huella.

Uso: python3 -m plataforma_datos.ia_y_trabajo.fuentes.tic_llars.lector {descargar,preparar,validar,todo}
    [--aceptar-cambio]
"""

import re
import sys
import time
from datetime import datetime
from html.parser import HTMLParser
from typing import Any
from urllib.parse import parse_qs, urljoin, urlparse

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
from plataforma_datos.comun.red import (
    PAUSA_ENTRE_PETICIONES_S,
    descargar_originales,
    descubrir_edicion,
)
from plataforma_datos.comun.textos_y_cifras import numero_con_coma, texto
from plataforma_datos.ia_y_trabajo.fuentes.tic_llars.coherencia import (
    control_del_motivo,
    incoherencias,
    motivo_calculado_por_tich,
)
from plataforma_datos.orquestacion.admision import cerrar_validacion, leer_validado
from plataforma_datos.orquestacion.ordenes import principal_fuente_con_descarga

FUENTE = "tic-llars"
ORIGINAL, PREPARADO, VALIDADO = carpetas(FUENTE)
PROCEDENCIA = ORIGINAL / ARCHIVO_DE_PROCEDENCIA
# Lo que escribe preparar y lee validar: por tabla, su título y su cifra por fila y columna.
TABLAS = PREPARADO / "tablas.json"

PUBLICACION = "https://www.idescat.cat/pub/?id=ticll25"
CATALOGO = {
    "archivo": "idescat-ticll-catalogo.html",
    "nivel": "oficial",
    "titulo": "Idescat, Encuesta sobre equipamiento y uso de TIC en los hogares, años disponibles",
    "url": "https://www.idescat.cat/estad/ticl?lang=es",
    "licencia": LICENCIA_IDESCAT,
}
MAX_CATALOGO_BYTES = 1 << 20
TABLAS_DEL_IDESCAT = ("3.4.1", "3.4.2")
ARCHIVOS = [
    {
        "archivo": f"idescat-ticll25-{numero}.html",
        "nivel": "oficial",
        "titulo": f"Idescat, Enquesta sobre equipament i ús de TIC a les llars 2025, taula {numero} (IA generativa)",
        "url": f"{PUBLICACION}&n={numero}&lang=es",
        "licencia": LICENCIA_IDESCAT,
    }
    for numero in TABLAS_DEL_IDESCAT
]
# La segunda tabla de cada página (por ocupación principal) se guarda con este sufijo tras su número.
POR_OCUPACION = "-ocupacion"
# El título de cada tabla, literal: dice su base; si cambia, la validación se detiene.
TITULOS = {
    "3.4.1-ocupacion": "Persones de 16 a 74 anys que han fet servir internet en els darrers 3 mesos. Catalunya. 2025 "
    "Per característiques socioeconòmiques i finalitat de l'ús d'eines d'IA generativa",
    "3.4.2-ocupacion": "Persones de 16 a 74 anys que no han fet servir eines d'IA generativa en els darrers 3 mesos. "
    "Catalunya. 2025 Per característiques socioeconòmiques i motius per no usar eines d'IA generativa",
    "3.4.1": "Persones de 16 a 74 anys que han fet servir internet en els darrers 3 mesos. Catalunya. 2025 Per "
    "característiques demogràfiques i finalitat de l'ús d'eines d'IA generativa",
    "3.4.2": "Persones de 16 a 74 anys que no han fet servir eines d'IA generativa en els darrers 3 mesos. Catalunya. "
    "2025 Per característiques demogràfiques i motius per no fer servir eines d'IA generativa",
}
USO = "Ús d'alguna eina d'IA generativa"
TRABAJO = "Amb finalitats professionals o relacionades amb la feina"
NO_SABE = "No sap com fer-les servir"
# Cada indicador: tabla, fila y columna, literales.
CIFRAS_DE_CADA_INDICADOR = {
    "personas-ia-generativa-usuarios-internet": ("3.4.1", "Total", USO),
    "personas-ia-generativa-trabajo-usuarios-internet": ("3.4.1", "Total", TRABAJO),
    "mujeres-ia-generativa-usuarios-internet": ("3.4.1", "Dona", USO),
    "hombres-ia-generativa-usuarios-internet": ("3.4.1", "Home", USO),
    "mujeres-ia-generativa-trabajo-usuarios-internet": ("3.4.1", "Dona", TRABAJO),
    "hombres-ia-generativa-trabajo-usuarios-internet": ("3.4.1", "Home", TRABAJO),
    "ia-generativa-no-sabe-usarla": ("3.4.2", "Total", NO_SABE),
    # Ocupación principal. Manual (grandes grupos 6 a 9 de la CNO-94) y no manual (0 y 1 a 5) son la división de
    # Eurostat (ISCO6_9 e ISCO0_5; constantes_datos_globales.CON_CATALUNA_DEL_IDESCAT): el uso para trabajar toma sus
    # ids. «Treballador TIC» (lista propia del Idescat) y el motivo «no sabe cómo» van en indicadores solo de Cataluña.
    "ia-generativa-trabajo-manual-usuarios-internet": ("3.4.1-ocupacion", "Treballador manual", TRABAJO),
    "ia-generativa-trabajo-no-manual-usuarios-internet": ("3.4.1-ocupacion", "Treballador no manual", TRABAJO),
    "ia-generativa-trabajo-trabajador-tic": ("3.4.1-ocupacion", "Treballador TIC", TRABAJO),
    "ia-generativa-no-sabe-usarla-trabajador-manual": ("3.4.2-ocupacion", "Treballador manual", NO_SABE),
    "ia-generativa-no-sabe-usarla-trabajador-no-manual": ("3.4.2-ocupacion", "Treballador no manual", NO_SABE),
}
ANIO = 2025
CITA = f"{CITA_IDESCAT}, a partir de la TIC-H del INE (Enquesta TIC a les llars 2025, taules 3.4.1 i 3.4.2)."
# Manual y no manual en el cálculo de Faro con los microdatos de la TIC-H (`tich`, cataluna_grupos), de la CNO-11 a los
# grandes grupos. Su base son todas las personas ocupadas, no solo las que usaron internet: no se exige la misma cifra,
# sino que la del Idescat caiga dentro de su intervalo del 95 %. Una división distinta de la ocupación no cabría.
CLASE_EN_TICH = {
    "ia-generativa-trabajo-manual-usuarios-internet": "manual",
    "ia-generativa-trabajo-no-manual-usuarios-internet": "no_manual",
}
# El motivo «no sabe cómo» de cada clase de ocupación de Faro (`clase_por_isco2` de `tich`): la línea del informe.
NO_SABE_POR_CLASE = {
    "manual": "ia-generativa-no-sabe-usarla-trabajador-manual",
    "no_manual": "ia-generativa-no-sabe-usarla-trabajador-no-manual",
}
# La tabla de esas cifras y su base, literal del título (TITULOS), para quien lea el paquete.
TABLA_NO_SABE = "3.4.2"
BASE_NO_SABE = (
    "Personas de 16 a 74 años que usaron internet en los tres meses anteriores y no usaron herramientas de IA "
    "generativa, por ocupación principal: manual (grandes grupos 6 a 9 de la CNO-94) o no manual (0 a 5)"
)
# Las cifras son porcentajes de personas: ninguna pasa de este máximo.
MAX_PORCENTAJE = 100
# Grandes grupos manuales según la metodología de la encuesta; los demás (0 a 5) son no manuales.
GRANDES_GRUPOS_MANUALES = frozenset("6789")


class _EdicionesIdescat(HTMLParser):
    """Los enlaces del bloque de años disponibles, sin interpretar scripts ni otras secciones."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.profundidad = 0
        self.bloques = 0
        self.terminado = False
        self.encabezado: list[str] | None = None
        self.encabezados: list[str] = []
        self.leyendo_anios = False
        self.enlace: tuple[str, list[str]] | None = None
        self.enlaces: list[tuple[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        atributos = dict(attrs)
        if tag == "div":
            if self.profundidad:
                self.profundidad += 1
            elif atributos.get("id") == "result_":
                self.profundidad = 1
                self.bloques += 1
        if self.profundidad:
            if tag == "h2":
                self.encabezado = []
                self.leyendo_anios = False
            elif tag == "a" and self.leyendo_anios:
                exigir(self.enlace is None, "TIC a les llars: catálogo con enlaces anidados")
                self.enlace = (atributos.get("href") or "", [])

    def handle_data(self, data: str) -> None:
        if self.encabezado is not None:
            self.encabezado.append(data)
        if self.enlace is not None:
            self.enlace[1].append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "h2" and self.encabezado is not None:
            self.encabezados.append(texto(" ".join(self.encabezado)))
            self.leyendo_anios = self.encabezados[-1] == "Años disponibles"
            self.encabezado = None
        elif tag == "a" and self.enlace is not None:
            self.enlaces.append((self.enlace[0], texto(" ".join(self.enlace[1]))))
            self.enlace = None
        elif tag == "div" and self.profundidad:
            self.profundidad -= 1
            if not self.profundidad:
                self.terminado = True
                self.leyendo_anios = False


def ediciones_disponibles(pagina: str) -> tuple[int, ...]:
    """Enumera los años publicados del catálogo oficial; no deduce sucesoras ni fechas de publicación.

    Returns:
        Los años únicos en orden creciente.
    """
    catalogo = _EdicionesIdescat()
    catalogo.feed(pagina)
    catalogo.close()
    exigir(
        catalogo.bloques == 1
        and catalogo.terminado
        and catalogo.enlace is None
        and catalogo.encabezado is None
        and catalogo.encabezados[:1] == ["Años disponibles"]
        and catalogo.encabezados.count("Años disponibles") == 1,
        "TIC a les llars: catálogo sin bloque completo de años disponibles",
    )
    anios = []
    for href, rotulo in catalogo.enlaces:
        exigir(re.fullmatch(r"[0-9]{4}", rotulo) is not None, "TIC a les llars: año de catálogo inválido")
        url = urlparse(urljoin(CATALOGO["url"], href))
        parametros = parse_qs(url.query, keep_blank_values=True)
        exigir(
            url.scheme == "https"
            and url.netloc == "www.idescat.cat"
            and url.path == "/pub/"
            and not url.fragment
            and parametros == {"id": [f"ticll{rotulo[-2:]}"], "lang": ["es"]},
            f"TIC a les llars: enlace de catálogo incoherente para {rotulo}",
        )
        anios.append(int(rotulo))
    exigir(bool(anios) and len(set(anios)) == len(anios), "TIC a les llars: catálogo vacío o con años repetidos")
    return tuple(sorted(anios))


def edicion_del_catalogo(contenido: bytes) -> int:
    """Lee la última edición del catálogo observado, con límite de tamaño y UTF-8 estricto.

    Returns:
        El año más reciente anunciado por el catálogo.

    Raises:
        FormatoInesperado: Si el cuerpo no es UTF-8 o no satisface el contrato del catálogo.
    """
    exigir(0 < len(contenido) <= MAX_CATALOGO_BYTES, "TIC a les llars: catálogo fuera de tamaño")
    try:
        pagina = contenido.decode("utf-8")
    except UnicodeDecodeError as error:
        raise FormatoInesperado("TIC a les llars: catálogo no es UTF-8") from error
    return max(ediciones_disponibles(pagina))


def comprobar_edicion(edicion: int) -> None:
    """La edición anunciada debe ser la del contrato; aceptar cambios no abre un año distinto."""
    exigir(
        type(edicion) is int and edicion == ANIO,
        f"TIC a les llars: última edición anunciada {edicion}; contrato compatible {ANIO}. Revisar la nueva edición "
        "y su comparabilidad con TIC-H antes de descargar las tablas",
    )


def _descubrir_edicion() -> list[dict[str, Any]]:
    """Conserva el catálogo solo si su última edición es compatible con el contrato conocido.

    Returns:
        La procedencia del catálogo, separada de las tablas operativas.
    """
    _, registrar = descubrir_edicion(
        CATALOGO,
        ORIGINAL,
        redireccion="TIC a les llars: URL final del catálogo inesperada",
        leer=edicion_del_catalogo,
        comprobar=comprobar_edicion,
        previo=_descubrimiento_previo,
    )
    return [registrar()]


def _descubrimiento_previo() -> dict[str, Any] | None:
    """La entrada anterior del catálogo en la procedencia; un catálogo repetido no se normaliza.

    Returns:
        Esa entrada, o None si no la hay.
    """
    previos = leer_json(PROCEDENCIA).get("descubrimiento", []) if PROCEDENCIA.exists() else []
    previos = [registro for registro in previos if registro.get("archivo") == CATALOGO["archivo"]]
    exigir(len(previos) <= 1, "TIC a les llars: catálogo duplicado en la procedencia anterior")
    return previos[0] if previos else None


class _TablaIdescat(HTMLParser):
    """Lee la estructura de una tabla sin interpretar atributos como texto o mezclar tablas anidadas."""

    def __init__(self, posicion: int) -> None:
        super().__init__(convert_charrefs=True)
        self.posicion = posicion
        self.indice = -1
        self.dentro = False
        self.terminada = False
        self.seccion = ""
        self.titulo: list[str] | None = None
        self.celda: list[str] | None = None
        self.fila: list[str] = []
        self.cabecera: list[str] = []
        self.filas: list[list[str]] = []
        self.tiene_cuerpo = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "table":
            exigir(not self.dentro, "TIC a les llars: tabla anidada")
            self.indice += 1
            self.dentro = self.indice == self.posicion
        if not self.dentro:
            return
        if tag in ("thead", "tbody", "caption"):
            self.seccion = tag
            if tag == "caption":
                self.titulo = []
            elif tag == "tbody":
                self.tiene_cuerpo = True
        elif tag == "tr":
            self.fila = []
        elif tag in ("th", "td"):
            self.celda = []

    def handle_data(self, data: str) -> None:
        if not self.dentro:
            return
        if self.seccion == "caption" and self.titulo is not None:
            self.titulo.append(data)
        elif self.celda is not None:
            self.celda.append(data)

    def handle_endtag(self, tag: str) -> None:
        if not self.dentro:
            return
        if tag in ("th", "td") and self.celda is not None:
            self.fila.append(texto(" ".join(self.celda)))
            self.celda = None
        elif tag == "tr":
            if self.seccion == "thead":
                self.cabecera = self.fila
            elif self.seccion == "tbody":
                self.filas.append(self.fila)
        elif tag in ("thead", "tbody", "caption"):
            self.seccion = ""
        elif tag == "table":
            self.dentro = False
            self.terminada = True


def leer_tabla(pagina: str, posicion: int = 0) -> dict[str, Any]:
    """La tabla demográfica (0) o socioeconómica (1), por fila y columna, sin la población.

    Raises:
        FormatoInesperado: Si faltan partes, hay tablas anidadas, rótulos repetidos, filas de otro ancho o cifras
            ilegibles. Las cabeceras de agrupación del cuerpo solo tienen una celda y no contienen datos.

    Returns:
        El título literal y las cifras por fila y columna.
    """
    exigir(posicion >= 0, f"TIC a les llars: posición de tabla inválida: {posicion}")
    tabla = _TablaIdescat(posicion)
    tabla.feed(pagina)
    tabla.close()
    contexto = f"TIC a les llars: tabla {posicion + 1}"
    exigir(tabla.terminada, f"{contexto}: la página no trae la tabla completa")
    exigir(tabla.titulo is not None and bool(tabla.cabecera), f"{contexto}: sin título o sin cabecera")
    exigir(tabla.tiene_cuerpo, f"{contexto}: tabla sin cuerpo")
    columnas = tabla.cabecera[2:]
    exigir(bool(columnas) and all(columnas), f"{contexto}: sin columnas de datos")
    exigir(len(set(columnas)) == len(columnas), f"{contexto}: columna repetida en {columnas}")
    cifras: dict[str, dict[str, float | None]] = {}
    for celdas in tabla.filas:
        if len(celdas) == 1:
            continue
        fila = celdas[0] if celdas else "sin rótulo"
        exigir(len(celdas) == len(columnas) + 2, f"{contexto}: fila {fila}: número de celdas distinto de la cabecera")
        exigir(fila not in cifras, f"{contexto}: fila repetida: {fila}")
        valores: dict[str, float | None] = {}
        for columna, valor in zip(columnas, celdas[2:], strict=True):
            try:
                valores[columna] = None if valor in ("", "..") else numero_con_coma(valor)
            except ValueError as error:
                raise FormatoInesperado(
                    f"{contexto}: fila {fila}, columna {columna}: cifra inválida {valor!r}"
                ) from error
        cifras[fila] = valores
    return {"titulo": texto(" ".join(tabla.titulo)), "cifras": cifras}


def cifra(tablas: dict[str, Any], indicador: str) -> float | None:
    """La cifra de un indicador en Cataluña, o None si la tabla no la trae.

    Returns:
        La cifra, o None.
    """
    tabla, fila, columna = CIFRAS_DE_CADA_INDICADOR[indicador]
    exigir(tabla in tablas, f"TIC a les llars: falta tabla {tabla} del indicador {indicador}")
    return tablas[tabla]["cifras"].get(fila, {}).get(columna)


def fuera_del_calculo_de_faro(
    cifras: dict[str, float | None], grupos: dict[str, Any]
) -> dict[str, tuple[float | None, list[float]]]:
    """Clases disponibles que no caen en el intervalo del 95 % del cálculo de Faro (`grupos`), con ese intervalo.

    Una clase ausente del validado no tiene cifra publicable: no se infiere su intervalo.

    Returns:
        {clase: (cifra del Idescat, intervalo de Faro)} de las que no caen en el intervalo.
    """
    fuera = {}
    for indicador, clase in CLASE_EN_TICH.items():
        if clase not in grupos:
            continue
        bajo, alto = grupos[clase]["ic95"]
        valor = cifras[indicador]
        if valor is None or not bajo <= valor <= alto:
            fuera[indicador] = (valor, [bajo, alto])
    return fuera


def clases_distintas(clase_por_isco2: dict[str, str]) -> dict[str, str]:
    """Los grupos ISCO-08 de 2 cifras cuya clase en `tich` no es la del Idescat (manual, los grandes grupos 6 a 9).

    Returns:
        {grupo: clase en `tich`} de los que no coinciden.
    """
    return {
        grupo: clase
        for grupo, clase in clase_por_isco2.items()
        if clase != ("manual" if grupo[:1] in GRANDES_GRUPOS_MANUALES else "no_manual")
    }


def motivos_no_uso(conjunto: dict[str, Any]) -> dict[str, Any]:
    """Para el informe: quienes no saben cómo usar la IA generativa, por clase de ocupación, con su procedencia.

    Sale del conjunto validado de esta fuente (`conjunto`), que guarda la procedencia de cada tabla: no se vuelve a
    leer ninguna tabla. El año sale como texto, según el contrato de `MotivosDeNoUso` del paquete TIC-H.

    Returns:
        Los motivos por clase de ocupación, con su procedencia.
    """
    cifras = {clase: conjunto["cifras"].get(indicador, {}) for clase, indicador in NO_SABE_POR_CLASE.items()}
    for clase, dato in cifras.items():
        valor = dato.get("valor")
        exigir(
            type(valor) in (int, float) and 0 <= valor <= MAX_PORCENTAJE,
            f"TIC a les llars: «no sabe cómo», {clase}: valor inválido {valor!r}",
        )
    for clase, dato in cifras.items():
        anio = dato.get("anio")
        exigir(
            type(anio) is int and re.fullmatch(r"[0-9]{4}", str(anio)) is not None,
            f"TIC a les llars: «no sabe cómo», {clase}: año inválido {anio!r}",
        )
    exigir(len({dato["anio"] for dato in cifras.values()}) == 1, "TIC a les llars: «no sabe cómo», de años distintos")
    tabla = conjunto["tablas"][TABLA_NO_SABE]
    return {
        "fuente": conjunto["cita"],
        "tabla": TABLA_NO_SABE,
        "url": tabla["url"],
        "sha256": tabla["sha256"],
        "consultado": _fecha_de_consulta(tabla, f"tabla {TABLA_NO_SABE}"),
        "anio": str(cifras["manual"]["anio"]),
        "base": BASE_NO_SABE,
        "no_sabia_como_utilizarlas": {clase: dato["valor"] for clase, dato in cifras.items()},
    }


def descargar(aceptar_cambio: bool = False) -> None:
    """Comprueba el catálogo antes de descargar las dos tablas del contrato anual conocido."""
    descubrimiento = _descubrir_edicion()
    archivos = []
    for archivo in ARCHIVOS:
        time.sleep(PAUSA_ENTRE_PETICIONES_S)
        archivos.extend(descargar_originales([archivo], ORIGINAL, aceptar_cambio))
    guardar_json(
        PROCEDENCIA,
        {
            "fuente": "Idescat · Enquesta sobre equipament i ús de TIC a les llars 2025 (IA generativa)",
            "cita": CITA,
            "licencia": LICENCIA_IDESCAT,
            "licencia_texto": LICENCIA_TEXTO_IDESCAT,
            "archivos": archivos,
            "descubrimiento": descubrimiento,
        },
    )


def preparar() -> None:
    """Lee cada tabla tal como la publica el Idescat.

    Raises:
        FormatoInesperado: Si una tabla no se puede interpretar, con el nombre del HTML.
    """
    comprobar_originales(FUENTE)
    tablas: dict[str, Any] = {}
    for numero in TABLAS_DEL_IDESCAT:
        nombre = f"idescat-ticll25-{numero}.html"
        pagina = original(FUENTE, nombre).read_text(encoding="utf-8")
        try:
            tablas[numero] = leer_tabla(pagina)
            tablas[f"{numero}{POR_OCUPACION}"] = leer_tabla(pagina, 1)
        except FormatoInesperado as error:
            raise FormatoInesperado(f"{nombre}: {error}") from error
    # El orden del preparado es primero las demográficas y después las socioeconómicas.
    tablas = {
        **{numero: tablas[numero] for numero in TABLAS_DEL_IDESCAT},
        **{f"{numero}{POR_OCUPACION}": tablas[f"{numero}{POR_OCUPACION}"] for numero in TABLAS_DEL_IDESCAT},
    }
    guardar_json(TABLAS, tablas)
    print(f"{len(tablas)} tablas de la encuesta TIC a les llars")


def _control_del_contraste_tich(controles: Controles, cifras: dict[str, float | None], grupos: dict[str, Any]) -> None:
    """Contrasta las clases disponibles y deja su alcance explícito, sin admitir un contraste vacío."""
    comparadas = [clase for clase in CLASE_EN_TICH.values() if clase in grupos]
    sin_contraste = [clase for clase in CLASE_EN_TICH.values() if clase not in grupos]
    fuera = fuera_del_calculo_de_faro(cifras, grupos)
    controles.comprobar(
        bool(comparadas) and not fuera,
        "contraste con el intervalo del 95 % del cálculo de Faro con los microdatos de la TIC-H (tich); "
        f"clases comparadas: {', '.join(comparadas) or 'ninguna'}; "
        "sin contraste por no tener cifra publicable en el validado tich: "
        + (", ".join(sin_contraste) or "ninguna")
        + (f"; fuera: {fuera}" if fuera else ""),
    )


def _controles(
    controles: Controles, tablas: dict[str, Any], cifras: dict[str, float | None], tich: dict[str, Any]
) -> bool | None:
    """Registra los títulos (la base), los rangos, la coherencia de las tablas y el contraste con `tich`.

    Args:
        controles: Donde se registran.
        tablas: Las tablas preparadas, por número.
        cifras: La cifra de cada indicador en Cataluña.
        tich: El conjunto validado de la TIC-H, con el cálculo de contraste del motivo de su validación
            (`contraste_no_sabe_como`).

    Returns:
        None si la TIC-H es de otra edición; si es la misma, si se pudo contrastar el motivo «no sabía cómo».
    """
    contrastado = None
    cambiados = [numero for numero, titulo in TITULOS.items() if tablas[numero]["titulo"] != titulo]
    controles.comprobar(
        not cambiados, "el título de cada tabla (su base), literal" + (f": {cambiados}" if cambiados else "")
    )
    controles.comprobar(
        all(valor is not None and 0 <= valor <= MAX_PORCENTAJE for valor in cifras.values()),
        f"cada cifra, entre 0 y {MAX_PORCENTAJE}",
    )
    incoherentes = incoherencias(cifras)
    controles.comprobar(
        not incoherentes,
        "coherencia de las tablas capturadas: el total entre mujeres y hombres, y el uso para trabajar no mayor que el "
        "uso total" + (f"; incoherentes: {incoherentes}" if incoherentes else ""),
    )
    anio_tich = tich.get("anio")
    valido = isinstance(anio_tich, str) and re.fullmatch(r"[0-9]{4}", anio_tich) is not None
    if anio_tich == str(ANIO):
        _control_del_contraste_tich(controles, cifras, tich["cataluna_grupos"])
        contrastado = control_del_motivo(controles, cifras, NO_SABE_POR_CLASE, tich.get("contraste_no_sabe_como"))
    distinta = clases_distintas(tich["clase_por_isco2"])
    controles.comprobar(
        not distinta,
        f"la clase de los {len(tich['clase_por_isco2'])} grupos ISCO-08 de 2 cifras de tich es la del Idescat (manual, "
        "grandes grupos 6 a 9)" + (f"; distintas: {distinta}" if distinta else ""),
    )
    # El Idescat explota la TIC-H del INE después de que este la publique: con la TIC-H de un año posterior, cada
    # cifra declara su año y el contraste con el cálculo de Faro espera a la misma edición.
    controles.comprobar(
        valido and int(anio_tich) >= ANIO,
        f"el año de TIC-H ({anio_tich!r}) no es anterior al de las tablas del Idescat ({ANIO})"
        + ("" if anio_tich == str(ANIO) else "; sin contraste con el cálculo de Faro hasta tener la misma edición"),
    )
    return contrastado


def _fecha_de_consulta(archivo: dict[str, Any], nombre: str) -> str:
    """El día civil de la descarga, sin convertirlo a otra zona horaria.

    Returns:
        La fecha ISO de consulta.

    Raises:
        FormatoInesperado: Si descargado_utc no es una fecha válida, con el original o la tabla.
    """
    instante = archivo.get("descargado_utc")
    exigir(isinstance(instante, str), f"{nombre}: descargado_utc inválido: {instante!r}")
    try:
        return datetime.fromisoformat(instante).date().isoformat()
    except ValueError as error:
        raise FormatoInesperado(f"{nombre}: descargado_utc inválido: {instante!r}") from error


def _conjunto(procedencia: dict[str, Any], cifras: dict[str, float | None]) -> dict[str, Any]:
    """Compone el conjunto validado.

    Args:
        procedencia: La procedencia de los originales.
        cifras: La cifra de cada indicador en Cataluña.

    Returns:
        La cita, la licencia, la fecha de consulta, de dónde sale cada tabla y las cifras con su año.
    """
    tablas = {}
    for numero in TABLAS_DEL_IDESCAT:
        nombre = f"idescat-ticll25-{numero}.html"
        archivos = [archivo for archivo in procedencia["archivos"] if archivo["archivo"] == nombre]
        exigir(
            len(archivos) == 1,
            f"TIC a les llars: {nombre}: se esperaba una entrada de procedencia, hay {len(archivos)}",
        )
        tablas[numero] = {campo: archivos[0][campo] for campo in ("url", "sha256", "descargado_utc")}
    return {
        "cita": CITA,
        "licencia": LICENCIA_IDESCAT,
        "consultado": max(_fecha_de_consulta(archivo, archivo["archivo"]) for archivo in procedencia["archivos"]),
        # De dónde sale cada tabla: lo lleva al paquete motivos_no_uso.
        "tablas": tablas,
        "cifras": {indicador: {"valor": valor, "anio": ANIO, "nota": None} for indicador, valor in cifras.items()},
    }


def _informe(controles: Controles, tablas: dict[str, Any], cifras: dict[str, float | None]) -> dict[str, Any]:
    """Compone el informe de validación.

    Args:
        controles: Los controles registrados.
        tablas: Las tablas preparadas, por número.
        cifras: La cifra de cada indicador en Cataluña.

    Returns:
        El estado, la fecha, la cobertura, los límites y los controles.
    """
    return {
        "estado": controles.estado,
        "comprobado_utc": ahora_utc(),
        "cobertura": {"tablas": len(tablas), "indicadores": len(cifras)},
        "limites": "Base: personas de 16 a 74 años que usaron internet en los tres meses anteriores (no toda la "
        "población): se comparan con Eurostat en esa misma base (PC_IND_IU3). Por ocupación, manual (grandes grupos "
        "6 a 9 de la CNO-94) y no manual (0 y 1 a 5) son la división de Eurostat (ISCO6_9 e ISCO0_5), según la "
        "metodología de la encuesta; «treballador TIC» es una lista propia del Idescat: solo de Cataluña, sin "
        "comparar.",
        "controles": controles.lista,
    }


def validar() -> None:
    """Comprueba bases, referencias y rangos con el validado de `tich`; guarda las cifras de Cataluña."""
    tablas, procedencia = leer_json(TABLAS), leer_json(PROCEDENCIA)
    controles = Controles()
    controles_de_huella(controles, ORIGINAL, procedencia)
    cifras = {indicador: cifra(tablas, indicador) for indicador in CIFRAS_DE_CADA_INDICADOR}
    # El cálculo de contraste del motivo va en la validación de tich, no en su conjunto publicado.
    tich = {**leer_validado("tich"), "contraste_no_sabe_como": motivo_calculado_por_tich()}
    # Si el contraste con el cálculo de Faro espera a la misma edición de la TIC-H, o al cálculo del motivo, el dato lo
    # declara (y el panel lo avisa).
    contrastado = _controles(controles, tablas, cifras, tich)
    contraste = "edicion-distinta" if contrastado is None else "misma-edicion" if contrastado else "motivo-sin-calculo"
    conjunto = {**_conjunto(procedencia, cifras), "contraste_con_la_tich": contraste}
    cerrar_validacion(FUENTE, _informe(controles, tablas, cifras), controles, lambda: conjunto)


def main(argv: list[str] | None = None) -> int:
    """Interfaz de línea de órdenes: descargar, preparar, validar o todo.

    Args:
        argv: Los argumentos; None toma los de la línea de órdenes.

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
