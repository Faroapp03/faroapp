"""Las metas de la Década Digital para 2030: el texto literal del artículo 4 de la Decisión (UE) 2022/2481.

Se descarga el texto original español del Diario Oficial de la Oficina de Publicaciones (Cellar) y se guarda el
artículo 4. La validación exige que el texto de cada meta de `catalogo_ue.METAS` (la que mide un indicador del archivo)
esté en ese original, letra por letra. Esta consulta no comprueba la vigencia, las modificaciones ni las versiones
consolidadas de la decisión; requieren una revisión aparte. Es la ley, no una medida: el archivo de datos globales
lo lleva en su bloque `metas`, aparte de las cifras. Python estándar.

Uso: python3 -m plataforma_datos.ia_y_trabajo.fuentes.decada_digital.lector {descargar,preparar,validar,todo}
    [--aceptar-cambio]
"""

import re
import sys
from datetime import datetime
from html.parser import HTMLParser

from plataforma_datos.comun.entrada_salida import (
    ahora_utc,
    carpetas,
    comprobar_originales,
    controles_de_huella,
    guardar_json,
    leer_json,
    original,
)
from plataforma_datos.comun.nucleo import (
    ARCHIVO_DE_PROCEDENCIA,
    ArchivoDescargable,
    Controles,
    FormatoInesperado,
    exigir,
)
from plataforma_datos.comun.red import descargar_originales
from plataforma_datos.derivados.fuentes.datos_globales.piezas.catalogo_ue import METAS
from plataforma_datos.orquestacion.admision import cerrar_validacion
from plataforma_datos.orquestacion.ordenes import principal_fuente_con_descarga

FUENTE = "decada-digital"
ORIGINAL, PREPARADO, VALIDADO = carpetas(FUENTE)
PROCEDENCIA = ORIGINAL / ARCHIVO_DE_PROCEDENCIA
ARTICULO = PREPARADO / "articulo-4.json"
ARCHIVO = "decision-2022-2481-es.xhtml"
# La manifestación en español (xhtml) del Diario Oficial a la que lleva `resource/celex/32022D2481` en Cellar.
URL = "https://publications.europa.eu/resource/cellar/26514cb9-7f40-11ed-9887-01aa75ed71a1.0023.03/DOC_1"
ELI = "https://eur-lex.europa.eu/eli/dec/2022/2481/oj"
LICENCIA_EUR_LEX = (
    "Aviso jurídico de EUR-Lex (https://eur-lex.europa.eu/content/legal-notice/legal-notice.html), que aplica la "
    "Decisión 2011/833/UE de la Comisión: reutilización autorizada citando la fuente. Solo da fe la edición impresa o "
    "electrónica del Diario Oficial de la Unión Europea."
)
CITA = (
    "Decisión (UE) 2022/2481 del Parlamento Europeo y del Consejo, de 14 de diciembre de 2022, artículo 4 (DO L 323)."
)
ARCHIVOS: list[ArchivoDescargable] = [
    {
        "archivo": ARCHIVO,
        "nivel": "oficial",
        "titulo": "Decisión (UE) 2022/2481 (programa estratégico de la Década Digital para 2030), versión española",
        "url": URL,
        "licencia": LICENCIA_EUR_LEX,
    }
]


# Los rótulos con que el texto español de la decisión abre el artículo 4 y el siguiente: el artículo es lo que va entre
# los dos. Si la versión publicada los cambia, la preparación se detiene diciendo cuál falta.
TITULO_DEL_ARTICULO_4 = "Artículo 4 Metas digitales"
INICIO_DEL_ARTICULO_5 = "Artículo 5"


class _TextoDeLaDecision(HTMLParser):
    """Lee el contenido de las etiquetas sin confundir un «>» dentro de un atributo con su cierre."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.partes: list[str] = []

    def handle_data(self, data: str) -> None:
        self.partes.append(data)


def articulo_4(xhtml: str) -> str:
    """El texto del artículo 4, sin marcas y con los espacios normalizados, desde su título hasta el artículo 5.

    Las entidades se descodifican antes de normalizar los espacios: un «&nbsp;» también cuenta como espacio.

    Returns:
        El texto plano del artículo 4.
    """
    lector = _TextoDeLaDecision()
    lector.feed(xhtml)
    lector.close()
    texto = re.sub(r"\s+", " ", " ".join(lector.partes))
    inicio = texto.find(TITULO_DEL_ARTICULO_4)
    exigir(inicio >= 0, f"la decisión no tiene el artículo 4 («{TITULO_DEL_ARTICULO_4}»)")
    fin = texto.find(INICIO_DEL_ARTICULO_5, inicio)
    exigir(fin > inicio, "la decisión no tiene el artículo 5 después del 4")
    return texto[inicio:fin].strip()


def descargar(aceptar_cambio: bool = False) -> None:
    """Descarga la decisión; una versión distinta se detiene hasta aceptarla a propósito."""
    guardar_json(
        PROCEDENCIA,
        {
            "fuente": "Oficina de Publicaciones de la Unión Europea · Decisión (UE) 2022/2481",
            "cita": CITA,
            "licencia": LICENCIA_EUR_LEX,
            "archivos": descargar_originales(ARCHIVOS, ORIGINAL, aceptar_cambio),
        },
    )


def preparar() -> None:
    """Guarda el texto del artículo 4."""
    comprobar_originales(FUENTE)
    guardar_json(ARTICULO, {"articulo_4": articulo_4(original(FUENTE, ARCHIVO).read_text(encoding="utf-8"))})
    print("artículo 4 de la Decisión (UE) 2022/2481")


def _consulta(procedencia: object) -> str:
    """Valida la fecha de la única descarga de la decisión.

    Returns:
        El día civil de la consulta en formato ISO, sin convertir su huso horario.

    Raises:
        FormatoInesperado: Si la procedencia o descargado_utc no identifica una consulta válida del original.
    """
    archivos = procedencia.get("archivos") if isinstance(procedencia, dict) else None
    exigir(
        isinstance(archivos, list)
        and len(archivos) == 1
        and isinstance(archivos[0], dict)
        and archivos[0].get("archivo") == ARCHIVO,
        f"{ARCHIVO}: la procedencia debe tener una sola entrada de este original",
    )
    instante = archivos[0].get("descargado_utc")
    motivo = f"{ARCHIVO}: descargado_utc inválido: {instante!r}"
    exigir(isinstance(instante, str) and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", instante[:10]) is not None, motivo)
    try:
        return datetime.fromisoformat(instante).date().isoformat()
    except ValueError as error:
        raise FormatoInesperado(motivo) from error


def validar() -> None:
    """Comprueba que el texto literal de cada meta siga en el artículo 4 y guarda las metas."""
    preparado = leer_json(ARTICULO)
    exigir(
        isinstance(preparado, dict) and isinstance(preparado.get("articulo_4"), str),
        f"{ARTICULO.name}: articulo_4 debe ser un texto",
    )
    texto = preparado["articulo_4"]
    procedencia = leer_json(PROCEDENCIA)
    consulta = _consulta(procedencia)
    controles = Controles()
    controles_de_huella(controles, ORIGINAL, procedencia)
    del_original = articulo_4(original(FUENTE, ARCHIVO).read_text(encoding="utf-8"))
    controles.comprobar(texto == del_original, "el artículo 4 preparado es el del original cuya huella se registra")
    faltan = [meta.id for meta in METAS if meta.texto not in texto]
    controles.comprobar(
        not faltan, "el texto literal de cada meta está en el artículo 4" + (f"; no está: {faltan}" if faltan else "")
    )
    conjunto = {
        "cita": CITA,
        "licencia": LICENCIA_EUR_LEX,
        "url": ELI,
        "consultado": consulta,
        "articulo_4": texto,
    }
    informe = {
        "estado": controles.estado,
        "comprobado_utc": ahora_utc(),
        "cobertura": {"metas": len(METAS)},
        "limites": "Solo las metas que mide un indicador del archivo (capacidades, especialistas, empresas y pymes); "
        "las de infraestructuras y servicios públicos no tienen aquí cifra. Es la ley, no una medida.",
        "controles": controles.lista,
    }
    cerrar_validacion(FUENTE, informe, controles, lambda: conjunto)


def main(argv: list[str] | None = None) -> int:
    """Interfaz de línea de órdenes: descargar, preparar, validar o todo.

    Returns:
        El código de salida de la orden: 0 si todo va bien.
    """
    return principal_fuente_con_descarga(
        __doc__,
        descargar=descargar,
        preparacion_y_validacion={"preparar": preparar, "validar": validar},
        argumentos=argv,
    )


if __name__ == "__main__":
    sys.exit(main())
