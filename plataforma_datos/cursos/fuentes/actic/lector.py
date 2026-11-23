"""ACTIC: la acreditación oficial de competencias digitales de la Generalitat de Catalunya.

El bloque digital transversal ofrece, además de formación, la posibilidad de certificar lo que ya se sabe con la
acreditación oficial de la Generalitat (ACTIC): tres niveles (básico, medio y avanzado) sobre las cinco áreas
competenciales del modelo vigente desde el 15/09/2026. Este conjunto reúne sus datos con la disposición en que se
apoya cada uno:
- contenidos (niveles, áreas y competencias): Ordre EMT/47/2026, de 17 de març (DOGC 9634, 27/03/2026);
- normas (solicitud, tasa, exenciones, prueba): Ordre EMT/48/2026, de 17 de març (DOGC 9634, 27/03/2026);
- modificación y régimen transitorio de la equivalencia COMPETIC: Ordre EMT/136/2026, de 10 de juliol (DOGC 9712,
  21/07/2026);
- lo que solo dice el portal oficial (el nivel 3 exige el 2; el certificado no caduca): actic.gencat.cat.
Los datos son una tabla escrita aquí. La validación comprueba que los pasajes de PASAJES y los nombres de las áreas y
competencias constan en su original, normalizando espacios y comillas: si falta alguno, la validación se detiene.
Esos pasajes cubren los niveles, las áreas y competencias, la duración y la sesión única de la prueba, la
fecha de entrada en vigor, el régimen transitorio, la equivalencia COMPETIC, el requisito del nivel 3, que el
certificado no caduca, el trámite telemático, la franja horaria y quién puede pedir la exención o la bonificación.
Lo demás no tiene pasaje propio y se transcribió a mano de las mismas disposiciones: la sede tramits.gencat.cat, los
artículos citados (art. 2.1, 3, 4 y 6.3 de la EMT/48) y la remisión a la ley de tasas. El control de «tres niveles y
cinco áreas» es una autocomprobación de la tabla escrita aquí, no una lectura del original. Las normas no fijan el
importe de la tasa (remiten a la ley de tasas), así que el conjunto no lo da. Python estándar.
La descarga consulta únicamente las tres disposiciones y las dos páginas declaradas: no descubre sucesoras ni
comprueba que la selección siga cubriendo toda la normativa aplicable. Eso requiere revisión editorial.

Uso: python3 -m plataforma_datos.cursos.fuentes.actic.lector {descargar,preparar,validar,todo} [--aceptar-cambio]
"""

import re
import sys
from collections.abc import Callable
from typing import Any, NamedTuple

from plataforma_datos.comun import boe, pdf, vigencia
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
from plataforma_datos.orquestacion.admision import cerrar_validacion
from plataforma_datos.orquestacion.ordenes import principal_fuente_con_descarga

FUENTE = "actic"
ORIGINAL, PREPARADO, VALIDADO = carpetas(FUENTE)
PROCEDENCIA = ORIGINAL / ARCHIVO_DE_PROCEDENCIA
# Lo que escribe preparar y lee validar: de cada original, los pasajes buscados que están literales en su texto.
PASAJES_LEIDOS = PREPARADO / "pasajes.json"

ENLACE_OFICIAL = "https://actic.gencat.cat/"
LICENCIA_DOGC = (
    "DOGC: las disposiciones normativas no son objeto de propiedad intelectual (art. 13 del texto refundido de la Ley "
    "de Propiedad Intelectual)."
)
LICENCIA_GENCAT = (
    "Portal de la Generalitat de Catalunya (actic.gencat.cat): Llicència oberta d'ús d'informació, reutilización "
    "citando la fuente y sin desnaturalizar la información (aviso legal de gencat.cat)."
)
CITA = (
    "Generalitat de Catalunya: Ordre EMT/47/2026 y Ordre EMT/48/2026, de 17 de març (DOGC núm. 9634), Ordre "
    "EMT/136/2026, de 10 de juliol (DOGC núm. 9712), y portal ACTIC (actic.gencat.cat)."
)
NOMBRE_FUENTE = "Generalitat de Catalunya · ACTIC, acreditación de competencias en tecnologías de la información"


def archivo_de_disposicion(clave: str) -> str:
    """Nombra el PDF guardado de una disposición del DOGC.

    Args:
        clave: La clave de la disposición («emt47-2026»).

    Returns:
        El nombre del archivo («dogc-emt47-2026.pdf»).
    """
    return f"dogc-{clave}.pdf"


def archivo_de_pagina(clave: str) -> str:
    """Nombra la copia guardada de una página del portal ACTIC.

    Args:
        clave: La clave de la página («procediment»).

    Returns:
        El nombre del archivo («actic-procediment.html»).
    """
    return f"actic-{clave}.html"


def _disposicion(clave: str, eli: str, titulo: str, norma: dict[str, str]) -> ArchivoDescargable:
    """Describe un original del DOGC: su PDF por la dirección ELI del Portal Jurídic, con su fecha, DOGC y CVE.

    Args:
        clave: La clave de la disposición, que nombra su archivo («emt47-2026»).
        eli: El identificador de la orden en su dirección ELI («emt47»).
        titulo: El título oficial.
        norma: Fecha (AAAA-MM-DD), número del DOGC, fecha de publicación y CVE.

    Returns:
        La entrada de ARCHIVOS.
    """
    anio, mes, dia = norma["fecha"].split("-")
    return {
        "archivo": archivo_de_disposicion(clave),
        "nivel": "oficial",
        "titulo": titulo,
        "url": f"https://portaljuridic.gencat.cat/eli/es-ct/o/{anio}/{mes}/{dia}/{eli}/dof/cat/pdf",
        "licencia": LICENCIA_DOGC,
        "norma": norma,
    }


def _pagina(clave: str, titulo: str, ruta: str) -> ArchivoDescargable:
    """Describe una página del portal ACTIC.

    Args:
        clave: La clave de la página, que nombra su archivo.
        titulo: Su título.
        ruta: Su ruta en el portal, sin el idioma ni la barra final.

    Returns:
        La entrada de ARCHIVOS.
    """
    return {
        "archivo": archivo_de_pagina(clave),
        "nivel": "oficial",
        "titulo": titulo,
        "url": f"{ENLACE_OFICIAL}ca/{ruta}/",
        "licencia": LICENCIA_GENCAT,
    }


# Cada original se nombra una vez, por su clave; su archivo y su dirección se derivan de ella.
CLAVE_CONTENIDOS, CLAVE_NORMAS, CLAVE_MODIFICACION = "emt47-2026", "emt48-2026", "emt136-2026"
CLAVE_PROCEDIMIENTO, CLAVE_NIVELES_WEB = "procediment", "competencies-nivells"
CONTENIDOS = archivo_de_disposicion(CLAVE_CONTENIDOS)
NORMAS = archivo_de_disposicion(CLAVE_NORMAS)
MODIFICACION = archivo_de_disposicion(CLAVE_MODIFICACION)
PROCEDIMIENTO = archivo_de_pagina(CLAVE_PROCEDIMIENTO)
NIVELES_WEB = archivo_de_pagina(CLAVE_NIVELES_WEB)
ARCHIVOS = [
    _disposicion(
        CLAVE_CONTENIDOS,
        "emt47",
        "Ordre EMT/47/2026, de 17 de març, per la qual s'aproven els continguts actualitzats per a l'acreditació de "
        "competències en tecnologies de la informació i la comunicació (ACTIC)",
        {"fecha": "2026-03-17", "dogc": "9634", "publicado": "2026-03-27", "cve": "DOGC-A-26084039-2026"},
    ),
    _disposicion(
        CLAVE_NORMAS,
        "emt48",
        "Ordre EMT/48/2026, de 17 de març, per la qual s'aproven les normes complementàries en relació amb "
        "l'acreditació de competències en tecnologies de la informació i la comunicació (ACTIC)",
        {"fecha": "2026-03-17", "dogc": "9634", "publicado": "2026-03-27", "cve": "DOGC-A-26084038-2026"},
    ),
    _disposicion(
        CLAVE_MODIFICACION,
        "emt136",
        "Ordre EMT/136/2026, de 10 de juliol, per la qual es modifica l'Ordre EMT/47/2026, de 17 de març (ACTIC)",
        {"fecha": "2026-07-10", "dogc": "9712", "publicado": "2026-07-21", "cve": "DOGC-A-26198048-2026"},
    ),
    _pagina(CLAVE_PROCEDIMIENTO, "ACTIC: procediment per obtenir l'acreditació", "ciutadania/procediment"),
    _pagina(CLAVE_NIVELES_WEB, "ACTIC: competències, nivells i certificats", "actic/competencies_nivells"),
]

# Los tres niveles: su nombre en el anexo de la EMT/47 y su duración máxima de prueba (EMT/48, art. 7.1).
NIVELES = [
    {"nivel": 1, "clave": "basico", "ca": "bàsic", "es": "básico", "perfil_ca": "Participant", "minutos": 120},
    {"nivel": 2, "clave": "medio", "ca": "mitjà", "es": "medio", "perfil_ca": "Actiu", "minutos": 120},
    {"nivel": 3, "clave": "avanzado", "ca": "avançat", "es": "avanzado", "perfil_ca": "Transformador", "minutos": 120},
]


class Area(NamedTuple):
    """Un área competencial del anexo de la EMT/47: número, nombre en catalán y castellano, y competencias."""

    numero: int
    ca: str
    es: str
    competencias: list[str]


# Las cinco áreas competenciales del anexo de la EMT/47, con sus competencias (texto oficial en catalán). El formato
# automático desplegaría cada competencia en su línea; escritas así, cada área se lee de un vistazo.
AREAS = [
    Area(1, "Cerca, gestió i anàlisi de la informació", "Búsqueda, gestión y análisis de la información",
     ["Cerca, selecciona i contrasta informació amb eines digitals",
      "Organitza la informació i les dades amb eines digitals",
      "Analitza, explota i visualitza dades amb eines digitals"]),
    Area(2, "Comunicació i col·laboració", "Comunicación y colaboración",
     ["Interacciona i comparteix informació i continguts digitals",
      "Col·labora amb altres persones mitjançant tecnologies digitals",
      "Participa en la transformació social i cultural a través de la societat digital"]),
    Area(3, "Creació de continguts, programació i fabricació d'objectes",
     "Creación de contenidos, programación y fabricación de objetos",
     ["Crea i edita continguts digitals", "Dissenya, integra i reelabora continguts digitals amb formats diversos",
      "Dissenya i fabrica objectes mitjançant tecnologia digital", "Programa"]),
    Area(4, "Seguretat, benestar i civisme", "Seguridad, bienestar y civismo",
     ["Protegeix sistemes, dispositius i continguts digitals", "Protegeix dades personals i la seva privacitat",
      "Protegeix la salut, el benestar i l'entorn", "Gestiona la identitat i els perfils digitals",
      "Actua cívicament en l'entorn digital"]),
    Area(5, "Autonomia i resolució de problemes", "Autonomía y resolución de problemas",
     ["Comprèn els fonaments de la tecnologia digital i la utilitza",
      "Identifica necessitats personals i professionals i aplica solucions digitals",
      "S'actualitza en competència digital", "Resol problemes tècnics"]),
]  # fmt: skip
VIGENTE_DESDE = "2026-09-15"
VIGENTE_DESDE_ES = "/".join(reversed(VIGENTE_DESDE.split("-")))  # DD/MM/AAAA, como lo dicen los textos del conjunto
# La publicación más reciente de las disposiciones: la fecha de los datos en su bloque de vigencia.
PUBLICADO = max(norma["publicado"] for archivo in ARCHIVOS if isinstance(norma := archivo.get("norma"), dict))
# Los pasajes comprobados, por original; la cabecera distingue la transcripción sin pasaje propio.
PASAJES = {
    CONTENIDOS: [
        "Aquesta Ordre entrarà en vigor el dia 15 de setembre de 2026.",
        "Nivell bàsic - Participant",
        "Nivell mitjà - Actiu",
        "Nivell avançat - Transformador",
        "se'ls aplicaran els continguts aprovats per l'Ordre PRE/18/2016",
    ],
    NORMAS: [
        "Aquesta Ordre entrarà en vigor el dia 15 de setembre de 2026.",
        "Per al nivell 1 (certificat bàsic): 120 minuts.",
        "Per al nivell 2 (certificat mitjà): 120 minuts.",
        "Per al nivell 3 (certificat avançat): 120 minuts.",
        "La prova d'avaluació es farà en una única sessió.",
        "poden demanar l'exempció les persones amb una discapacitat reconeguda, les persones desocupades, les persones "
        "jubilades i les persones internes en centres penitenciaris",
        "Poden demanar la bonificació els membres de famílies nombroses o monoparentals",
        "triant una de les franges horàries d'avaluació que ofereixi el centre col·laborador escollit",
    ],
    MODIFICACION: [
        "S'hi addiciona una disposició transitòria segona",
        "de reconeixement de l'equivalència entre els certificats de competència digital de l'educació de persones "
        "adultes (COMPETIC) i els certificats d'acreditació de competències en tecnologies de la informació i la "
        "comunicació (ACTIC)",
    ],
    PROCEDIMIENTO: ["La tramitació és telemàtica.", "per presentar-se al nivell 3 cal tenir acreditat el 2"],
    NIVELES_WEB: ["Tots els nivells avaluen les 5 àrees competencials.", "no caduca"],
}


def _normalizado(lineas: list[str]) -> str:
    """Une unas líneas en una sola, con los espacios agrupados y las comillas curvas cambiadas por rectas.

    Cambia «’» por «'» y «“» y «”» por «"». Se aplica tanto al original como al pasaje buscado.

    Args:
        lineas: Las líneas de un texto.

    Returns:
        Una sola línea.
    """
    return re.sub(r"\s+", " ", " ".join(lineas)).replace("’", "'").replace("“", '"').replace("”", '"')


def texto_del_original(archivo: str, contenido: bytes) -> str:
    """Extrae el texto de un original: el de un PDF del DOGC (pdf.py) o el de una página del portal.

    Args:
        archivo: El nombre del original (.pdf o .html).
        contenido: Sus bytes.

    Returns:
        El texto normalizado en una línea.
    """
    return _normalizado(pdf.texto(contenido) if archivo.endswith(".pdf") else boe.texto_de_html(contenido))


def pasajes_buscados() -> dict[str, list[str]]:
    """Reúne los pasajes de cada original y, en la EMT/47, los nombres de las cinco áreas y sus competencias.

    Returns:
        Los pasajes buscados, por archivo.
    """
    buscados = {archivo: list(pasajes) for archivo, pasajes in PASAJES.items()}
    for area in AREAS:
        buscados[CONTENIDOS] += [area.ca, *area.competencias]
    return buscados


def pasajes_encontrados(textos: dict[str, str]) -> dict[str, list[str]]:
    """Busca en cada original los pasajes que deben estar literales en su texto.

    Args:
        textos: El texto normalizado de cada original, por archivo.

    Returns:
        Por archivo, los pasajes buscados que están en su texto.
    """
    return {
        archivo: [pasaje for pasaje in lista if _normalizado([pasaje]) in textos[archivo]]
        for archivo, lista in pasajes_buscados().items()
    }


def pasajes_que_faltan(leidos: dict[str, list[str]]) -> list[str]:
    """Lista los pasajes buscados que no se encontraron en su original.

    Args:
        leidos: Los pasajes encontrados en cada original (lo que guardó preparar).

    Returns:
        «archivo: «pasaje»» por cada pasaje que falta.
    """
    return [
        f"{archivo}: «{pasaje}»"
        for archivo, lista in pasajes_buscados().items()
        for pasaje in lista
        if pasaje not in leidos.get(archivo, [])
    ]


CALENDARIO = "Sin calendario: el modelo cambia por orden del departamento, publicada en el DOGC."
# La prueba de acreditación según la EMT/48.
PRUEBA = {
    "tramite": "telemático, en actic.gencat.cat o tramits.gencat.cat (EMT/48, art. 2.1)",
    "lugar": "un centro colaborador ACTIC, con reserva de día y hora (EMT/48, art. 6.3)",
    "sesion_unica": True,
    "tasa_importe": None,
    "tasa_motivo": "Las normas (EMT/48, art. 3 y 4) remiten a la ley de tasas de la Generalitat y no fijan el importe.",
    # Quién puede pedir la exención o la bonificación de la tasa (EMT/48, art. 3.1), por clave.
    "exencion": ["discapacidad", "desempleo", "jubilacion", "centro-penitenciario"],
    "bonificacion": ["familia-numerosa", "familia-monoparental"],
}
# El régimen transitorio del modelo anterior (EMT/47 y EMT/136).
TRANSITORIO = (
    f"Las solicitudes de inscripción anteriores al {VIGENTE_DESDE_ES} siguen con los contenidos de la Ordre "
    "PRE/18/2016 (EMT/47, disposición transitoria)."
)
COMPETIC = (
    "Para la equivalencia COMPETIC–ACTIC (Ordre PRE/206/2017), las matriculaciones al COMPETIC anteriores al "
    f"{VIGENTE_DESDE_ES} siguen con los contenidos de la Ordre PRE/18/2016 (EMT/136, disposición transitoria segunda)."
)


def conjunto(procedencia: dict[str, Any]) -> dict[str, Any]:
    """Construye la versión para el motor: niveles, áreas, cómo se obtiene, vigencia y la disposición de cada parte.

    Args:
        procedencia: La procedencia de los originales, con la huella y la fecha de consulta de cada uno.

    Returns:
        El conjunto validado.
    """
    disposiciones = [
        {
            "titulo": entrada["titulo"],
            "url": entrada["url"],
            "sha256": entrada["sha256"],
            "consultado_utc": entrada["descargado_utc"],
            **entrada["norma"],
        }
        for entrada in procedencia["archivos"]
        if "norma" in entrada
    ]
    return {
        "vigencia": vigencia.bloque(VIGENTE_DESDE, PUBLICADO, None, CALENDARIO, CITA),
        "fuentes": {"actic": CITA},
        "enlace": ENLACE_OFICIAL,
        "niveles": NIVELES,
        "requisito_nivel_3": "nivel 2",
        "areas": [
            {"area": area.numero, "ca": area.ca, "es": area.es, "competencias_ca": area.competencias} for area in AREAS
        ],
        "prueba": PRUEBA,
        "modelo": {
            "vigente_desde": VIGENTE_DESDE,
            "transitorio": TRANSITORIO,
            "competic": COMPETIC,
            "certificado_caduca": False,
        },
        "disposiciones": disposiciones,
    }


def guardar_procedencia(registros: list[dict[str, Any]]) -> None:
    """La procedencia de los originales, con su cita y sus dos licencias."""
    guardar_json(
        PROCEDENCIA,
        {
            "fuente": NOMBRE_FUENTE,
            "cita": CITA,
            "licencia": f"{LICENCIA_DOGC} {LICENCIA_GENCAT}",
            "archivos": registros,
        },
    )


def _mismo_texto(archivo: ArchivoDescargable) -> Callable[[bytes, bytes], bool] | None:
    """Elige cómo comparar una copia nueva con la guardada: una página del portal, por su texto.

    Una página del portal cambia de bytes en cada visita (su plantilla): vale como igual si su texto no cambia.

    Args:
        archivo: La entrada de ARCHIVOS.

    Returns:
        La comparación por texto para una página; None (comparación por bytes) para un PDF.
    """
    nombre = archivo["archivo"]
    if not nombre.endswith(".html"):
        return None
    return lambda antes, ahora: texto_del_original(nombre, antes) == texto_del_original(nombre, ahora)


def descargar(aceptar_cambio: bool = False) -> None:
    """Descarga las tres disposiciones y las dos páginas del portal y registra su procedencia."""
    guardar_procedencia(descargar_originales(ARCHIVOS, ORIGINAL, aceptar_cambio, _mismo_texto))


def preparar() -> None:
    """Lee el texto de cada original y anota qué pasajes buscados están en él."""
    comprobar_originales(FUENTE)
    nombres = [archivo["archivo"] for archivo in ARCHIVOS]
    textos = {nombre: texto_del_original(nombre, original(FUENTE, nombre).read_bytes()) for nombre in nombres}
    leidos = pasajes_encontrados(textos)
    guardar_json(PASAJES_LEIDOS, leidos)
    print(f"{sum(map(len, leidos.values()))} pasajes encontrados en {len(textos)} originales")


def _exigir_procedencia_declarada(procedencia: object) -> None:
    """Impide publicar disposiciones omitidas, repetidas o con metadatos distintos de la tabla declarada.

    Raises:
        FormatoInesperado: La procedencia no es un objeto o no corresponde a los originales declarados.
    """
    if not isinstance(procedencia, dict):
        raise FormatoInesperado("actic: la procedencia debe ser un objeto JSON")
    entradas = procedencia.get("archivos")
    exigir(isinstance(entradas, list), "actic: la procedencia no contiene la lista de archivos")
    exigir(
        all(isinstance(entrada, dict) and isinstance(entrada.get("archivo"), str) for entrada in entradas),
        "actic: la procedencia contiene entradas sin nombre de archivo",
    )
    nombres = [entrada["archivo"] for entrada in entradas]
    declarados = {archivo["archivo"]: archivo for archivo in ARCHIVOS}
    exigir(
        len(nombres) == len(set(nombres)) and set(nombres) == set(declarados),
        "actic: la procedencia debe contener una vez cada original declarado",
    )
    for entrada in entradas:
        nombre = entrada["archivo"]
        exigir(
            ("norma" in entrada) == ("norma" in declarados[nombre])
            and entrada.get("norma") == declarados[nombre].get("norma"),
            f"actic: {nombre}: los metadatos de la norma no coinciden con la disposición declarada",
        )
        exigir(
            all(
                isinstance(entrada.get(campo), str) and entrada[campo].strip()
                for campo in ("titulo", "url", "sha256", "descargado_utc")
            ),
            f"actic: {nombre}: faltan título, URL, huella o fecha de consulta en la procedencia",
        )


def validar() -> None:
    """Comprueba las huellas y los pasajes literales y guarda el conjunto."""
    procedencia = leer_json(PROCEDENCIA)
    _exigir_procedencia_declarada(procedencia)
    controles = Controles()
    controles_de_huella(controles, ORIGINAL, procedencia)
    faltan = pasajes_que_faltan(leer_json(PASAJES_LEIDOS))
    controles.comprobar(
        not faltan,
        "los pasajes declarados y los nombres de áreas y competencias constan en el preparado de sus originales"
        + (f"; faltan: {'; '.join(faltan)}" if faltan else ""),
    )
    controles.comprobar(
        [nivel["clave"] for nivel in NIVELES] == ["basico", "medio", "avanzado"]
        and [area.numero for area in AREAS] == [1, 2, 3, 4, 5]
        and [len(area.competencias) for area in AREAS] == [3, 3, 4, 5, 4],
        "autocomprobación de la tabla transcrita: tres niveles y cinco áreas, con 3, 3, 4, 5 y 4 competencias",
    )
    datos = conjunto(procedencia)
    vigencia.comprobar(controles, {"actic": datos["vigencia"]})
    informe = {
        "estado": controles.estado,
        "comprobado_utc": ahora_utc(),
        "cobertura": {
            "niveles": len(NIVELES),
            "areas": len(AREAS),
            "competencias": sum(len(area.competencias) for area in AREAS),
        },
        "limites": (
            "Describe el modelo y el trámite; no evalúa a nadie ni dice qué nivel tiene una persona. El importe de la "
            "tasa no está en las normas y no se da. Las páginas del portal pueden cambiar sin aviso: la validación "
            "lo detecta por sus pasajes."
        ),
        "controles": controles.lista,
    }
    cerrar_validacion(FUENTE, informe, controles, lambda: datos)


def main(argv: list[str] | None = None) -> int:
    """Ejecuta la interfaz de línea de órdenes: descargar, preparar, validar o todo.

    Args:
        argv: Los argumentos (sin el nombre del programa); None lee los del proceso.

    Returns:
        El código de salida de la orden.
    """
    return principal_fuente_con_descarga(
        __doc__,
        descargar=descargar,
        preparacion_y_validacion={"preparar": preparar, "validar": validar},
        argumentos=argv,
    )


if __name__ == "__main__":
    sys.exit(main())
