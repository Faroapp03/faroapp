"""Derechos de quien trabaja, de formación y ante la tecnología: las citas literales que el informe muestra a todas.

El informe recuerda, igual para todas, tres derechos que convierten una formación «de pago» en tiempo de trabajo o en
tiempo de la empresa: el Estatuto de los Trabajadores, art. 23.1.d (la formación para adaptarse a los cambios del
puesto corre a cargo de la empresa y es tiempo de trabajo) y art. 23.3 (veinte horas anuales retribuidas), y el
permiso individual de formación del Real Decreto 694/2017, art. 29 (formación oficial, con un máximo de 200 horas
financiadas por permiso; y cómo se pide). Se citan literalmente, del BOE, con su enlace, sin prometer nada.

El segundo grupo, «Tus derechos ante la IA y la tecnología en el trabajo», sale de tecnologia.py: citas del
Estatuto (art. 64.4.d) y de la LOPDGDD (arts. 87 a 90) del texto consolidado del BOE, los pasajes del documento del
Consell de Relacions Laborals (2025) en que se apoya el resumen que hace Faro de sus recomendaciones y las nueve
cláusulas sectoriales de su anexo, que van solo en los datos.

`descargar` lee los dos artículos vigentes de la API de datos abiertos del BOE y las páginas de los demás originales
(los textos consolidados, el PDF del CRL y los dos convenios del BOE), una petición cada uno, con una pausa entre ellas;
la extracción de texto del PDF no se descarga: se conserva con su huella y la del PDF del que sale. `preparar`
comprueba que cada fragmento citado está, letra a letra, en la versión vigente de su artículo, y lo guarda con su
enlace y su fecha; `validar` lo vuelve a comprobar con la huella de cada original. Las pruebas del motor exigen que el
informe cite estos mismos fragmentos. Python estándar.

Uso: python3 -m plataforma_datos.derechos.fuentes.derechos.lector {descargar,preparar,validar,todo} [--aceptar-cambio]
"""

import re
import shutil
import sys
import tempfile
import time
from collections.abc import Callable
from copy import deepcopy
from datetime import date
from operator import itemgetter
from pathlib import Path
from typing import Any, NamedTuple
from xml.etree import ElementTree

import plataforma_datos.derechos.fuentes.derechos.piezas.tecnologia as tecnologia
from plataforma_datos.comun.entrada_salida import (
    ahora_utc,
    carpetas,
    controles_de_huella,
    guardar_json,
    hoy_utc,
    leer_json,
    procedencia,
    sha256,
    ultimo_original,
)
from plataforma_datos.comun.nucleo import (
    ARCHIVO_DE_PROCEDENCIA,
    Controles,
    ErrorFuente,
    FormatoInesperado,
    ReglaDeCambio,
    exigir,
)
from plataforma_datos.comun.observacion_remota import observar_original
from plataforma_datos.comun.red import conservar_o_sustituir, descargar_url, registro_descarga, registros_previos
from plataforma_datos.orquestacion.admision import cerrar_validacion
from plataforma_datos.orquestacion.ordenes import principal_fuente_con_descarga

FUENTE = "derechos"
ORIGINAL, PREPARADO, VALIDADO = carpetas(FUENTE)
PROCEDENCIA = ORIGINAL / ARCHIVO_DE_PROCEDENCIA
CITAS = PREPARADO / "citas.json"
# Segundos entre dos peticiones a la API del BOE: su robots.txt no fija ninguna pausa.
PAUSA_ENTRE_PETICIONES_S = 2.0
API_DEL_BOE = "https://www.boe.es/datosabiertos/api/legislacion-consolidada/id/{norma}/texto/bloque/{bloque}"
# La API del BOE solo responde si se le pide XML.
CABECERAS = {"Accept": "application/xml"}
LICENCIA = (
    "Aviso legal del BOE: reutilización de sus contenidos citando la fuente (Ley 37/2007); las disposiciones legales "
    "no son objeto de propiedad intelectual (Real Decreto Legislativo 1/1996, art. 13)."
)
LICENCIA_CRL = (
    "Generalitat de Catalunya: Llicència oberta d'ús d'informació – Catalunya. El documento declara además «Los "
    "contenidos de esta obra están sujetos a una licencia de Reconocimiento - No comercial - Sin obras derivadas 3.0 "
    "de Creative Commons» (p. 3): Faro solo resume con sus palabras, cita pasajes breves y enlaza el original."
)
CITA = (
    "Real Decreto Legislativo 2/2015, Estatuto de los Trabajadores (BOE-A-2015-11430), arts. 23 y 64; Real Decreto "
    "694/2017 (BOE-A-2017-7769), art. 29; Ley Orgánica 3/2018, de Protección de Datos Personales y garantía de los "
    "derechos digitales (BOE-A-2018-16673), arts. 87 a 90; Consell de Relacions Laborals de Catalunya, Recomendaciones "
    "a la negociación colectiva para la implementación de la digitalización y la inteligencia artificial en las "
    "empresas (septiembre de 2025)."
)


class Articulo(NamedTuple):
    """Un artículo citado: su norma y su bloque en la API del BOE, el nombre de su original y su título."""

    norma: str
    bloque: str
    archivo: str
    titulo: str

    @property
    def api(self) -> str:
        """La dirección del artículo en la API de datos abiertos del BOE."""
        return API_DEL_BOE.format(norma=self.norma, bloque=self.bloque)

    @property
    def enlace(self) -> str:
        """El artículo en el texto consolidado de la norma, donde lo lee la persona."""
        return f"https://www.boe.es/buscar/act.php?id={self.norma}#{self.bloque}"


ESTATUTO = Articulo("BOE-A-2015-11430", "a23", "estatuto-art-23", "Estatuto de los Trabajadores, artículo 23")
PERMISO = Articulo("BOE-A-2017-7769", "a2-11", "rd-694-2017-art-29", "Real Decreto 694/2017, artículo 29")
ARTICULOS = (ESTATUTO, PERMISO)
# Lo que el informe cita de cada artículo: fragmentos literales, que se muestran unidos por «[…]».
CITADAS = (
    {
        "id": "estatuto-23-1-d",
        "fuente": "Estatuto de los Trabajadores, art. 23.1.d",
        "enlace": ESTATUTO.enlace,
        "fragmentos": [
            "A la formación necesaria para su adaptación a las modificaciones operadas en el puesto de trabajo. La "
            "misma correrá a cargo de la empresa",
            "El tiempo destinado a la formación se considerará en todo caso tiempo de trabajo efectivo.",
        ],
    },
    {
        "id": "estatuto-23-3",
        "fuente": "Estatuto de los Trabajadores, art. 23.3",
        "enlace": ESTATUTO.enlace,
        "fragmentos": [
            "Los trabajadores con al menos un año de antigüedad en la empresa tienen derecho a un permiso retribuido "
            "de veinte horas anuales de formación profesional para el empleo, vinculada a la actividad de la empresa, "
            "acumulables por un periodo de hasta cinco años."
        ],
    },
    {
        "id": "rd-694-2017-29",
        "fuente": "Real Decreto 694/2017, art. 29",
        "enlace": PERMISO.enlace,
        "fragmentos": [
            "El permiso individual de formación es el que la empresa autoriza a un trabajador para la realización de "
            "una acción formativa que esté reconocida mediante una titulación o acreditación oficial",
            "La financiación de los costes salariales de cada permiso estará limitada a un máximo de 200 horas "
            "laborales por permiso y curso académico o año natural",
        ],
    },
    {
        "id": "rd-694-2017-29-solicitud",
        "fuente": "Real Decreto 694/2017, art. 29",
        "enlace": PERMISO.enlace,
        "fragmentos": [
            "el modelo de solicitud de autorización del permiso individual de formación que las empresas pondrán a "
            "disposición de los trabajadores",
            "La denegación de la autorización del permiso por parte de la empresa deberá estar motivada por razones "
            "organizativas o de producción, comunicándolo al trabajador.",
        ],
    },
)


class Pagina(NamedTuple):
    """Un original que se descarga como página (HTML o PDF): su nombre, su extensión, su dirección y su licencia."""

    archivo: str
    extension: str
    url: str
    titulo: str
    licencia: str


CRL = "https://treball.gencat.cat/web/.content/13_-_consell_relacions_laborals/documents/04_-_recursos/publicacions/"
CRL_ES = CRL + "Negociacio-collectiva/Recomanacions-IA/Recomendaciones-Digitalitzacion-IA-Cast-Acc-DEF.pdf"
CRL_CA = CRL + "Negociacio-collectiva/Recomanacions-IA/Recomanacions-Digitalitzacio-IA-Cat-v4.pdf"
NORMAS = {
    tecnologia.ESTATUTO: Pagina(
        "estatuto-consolidado",
        "html",
        "https://www.boe.es/buscar/act.php?id=BOE-A-2015-11430",
        "Estatuto de los Trabajadores, texto consolidado (BOE)",
        LICENCIA,
    ),
    tecnologia.LOPDGDD: Pagina(
        "lopdgdd-consolidada",
        "html",
        "https://www.boe.es/buscar/act.php?id=BOE-A-2018-16673",
        "Ley Orgánica 3/2018 (LOPDGDD), texto consolidado (BOE)",
        LICENCIA,
    ),
}
CONVENIOS = {
    boe_id: Pagina(f"convenio-{nombre}", "html", f"https://www.boe.es/diario_boe/txt.php?id={boe_id}", titulo, LICENCIA)
    for boe_id, nombre, titulo in (
        ("BOE-A-2025-3083", "quimica", "XXI Convenio colectivo general de la industria química (BOE)"),
        ("BOE-A-2025-47", "banca", "XXV Convenio colectivo del sector de la banca (BOE)"),
    )
}
RECOMENDACIONES = Pagina(
    "crl-recomendaciones-ia",
    "pdf",
    CRL_ES,
    "CRL: Recomendaciones a la negociación colectiva para la implementación de la digitalización y la IA (2025)",
    LICENCIA_CRL,
)
PAGINAS = (*NORMAS.values(), RECOMENDACIONES, *CONVENIOS.values())
# Los textos consolidados cambian de bytes sin cambiar de texto: se comparan por sus artículos citados.
EQUIVALENCIAS = {pagina: tecnologia.equivalencia(boe_id) for boe_id, pagina in NORMAS.items()}
# La extracción de texto por páginas del PDF del CRL: no se descarga, se conserva con su huella (ver el módulo).
EXTRACCION = "crl-recomendaciones-ia-paginas"
# Las cláusulas sectoriales de convenios que se citan (banca y química, entre otras).
CLAUSULAS_SECTORIALES = 9


def _dia_legal(texto: str) -> date:
    """Exige una fecha real de vigencia en el formato AAAAMMDD del BOE.

    Returns:
        El día de vigencia.

    Raises:
        FormatoInesperado: Si la fecha no tiene el formato o no existe en el calendario.
    """
    exigir(re.fullmatch(r"\d{8}", texto) is not None, f"fecha de vigencia del BOE inválida: {texto!r}")
    try:
        return date(int(texto[:4]), int(texto[4:6]), int(texto[6:]))
    except ValueError as error:
        raise FormatoInesperado(f"fecha de vigencia del BOE inválida: {texto!r}") from error


def _texto_de_version(elemento: ElementTree.Element) -> list[str]:
    """Recoge texto XML e hijos, excluyendo las notas de modificación del BOE.

    Returns:
        Los fragmentos de texto en su orden, sin las notas blockquote.
    """
    textos = []
    pendientes: list[ElementTree.Element | str] = [elemento]
    while pendientes:
        actual = pendientes.pop()
        if isinstance(actual, str):
            textos.append(actual)
            continue
        textos.append(actual.text or "")
        for hijo in reversed(actual):
            pendientes.append(hijo.tail or "")
            if hijo.tag != "blockquote":
                pendientes.append(hijo)
    return textos


def version_vigente(xml: str, dia: date | None = None) -> tuple[str, str]:
    """La última versión que ya rige el día de la copia, con fecha AAAAMMDD y texto sin las notas del BOE.

    Args:
        xml: La respuesta de la API de legislación consolidada.
        dia: El día del original; por defecto, hoy en UTC.

    Returns:
        La fecha de vigencia (AAAAMMDD) y el texto plano de la versión.

    Raises:
        FormatoInesperado: Si el XML o una fecha es inválido, o no hay versión vigente en ese día.
    """
    try:
        documento = ElementTree.fromstring(xml)
    except ElementTree.ParseError as error:
        raise FormatoInesperado(f"respuesta XML del BOE inválida: {error}") from error
    limite = dia or hoy_utc()
    versiones = [
        (elemento.get("fecha_vigencia", ""), elemento)
        for elemento in documento.iter("version")
        if _dia_legal(elemento.get("fecha_vigencia", "")) <= limite
    ]
    exigir(bool(versiones), f"la respuesta del BOE no trae ninguna versión vigente el {limite.isoformat()}")
    vigencia, cuerpo = max(versiones, key=itemgetter(0))
    return vigencia, " ".join(" ".join(_texto_de_version(cuerpo)).split())


def citas_comprobadas(textos: dict[str, str]) -> list[dict[str, Any]]:
    """Las citas, solo si cada fragmento está letra a letra en su artículo (`textos`, por enlace).

    Returns:
        Una copia de cada cita comprobada.
    """
    for cita in CITADAS:
        exigir(cita["enlace"] in textos, f"falta el texto del artículo {cita['enlace']}")
        for fragmento in cita["fragmentos"]:
            exigir(fragmento in textos[cita["enlace"]], f"{cita['id']}: «{fragmento[:40]}…» no está en la fuente")
    return deepcopy(list(CITADAS))


def nombre_del_original(archivo: str, dia: str, extension: str) -> str:
    """El nombre de un original en la copia de un día: `<archivo>-<AAAA-MM-DD>.<extension>`.

    Returns:
        El nombre del original con el día de la copia.
    """
    return f"{archivo}-{dia}.{extension}"


def archivos_de_la_copia(dia: str) -> list[dict[str, Any]]:
    """Los originales que se descargan: uno por artículo de la API y uno por página, con su dirección y su licencia.

    Returns:
        Una entrada por original, con su archivo, su dirección, su licencia y sus cabeceras.
    """
    articulos = [
        {
            "archivo": nombre_del_original(articulo.archivo, dia, "xml"),
            "nivel": "oficial",
            "titulo": f"{articulo.titulo}, todas sus versiones (API de datos abiertos del BOE)",
            "url": articulo.api,
            "licencia": LICENCIA,
            "cabeceras": CABECERAS,
        }
        for articulo in ARTICULOS
    ]
    paginas = [
        {
            "archivo": nombre_del_original(pagina.archivo, dia, pagina.extension),
            "nivel": "oficial",
            "titulo": pagina.titulo,
            "url": pagina.url,
            "licencia": pagina.licencia,
            "cabeceras": {},
            "equivalentes": EQUIVALENCIAS.get(pagina),
        }
        for pagina in PAGINAS
    ]
    return articulos + paginas


def descargar(aceptar_cambio: bool = False, hoy: date | None = None) -> None:
    """Descarga los artículos y las páginas, con una pausa entre ellos, y registra su procedencia.

    Cada original se descarga aquí con su cabecera (la API del BOE solo responde si se le pide XML) y se conserva con
    las mismas reglas que los de las demás fuentes. La extracción de texto del PDF del CRL no se descarga: su registro
    se conserva tal cual, y `validar` exige que su PDF de origen sea el registrado.
    """
    dia = (hoy or hoy_utc()).isoformat()
    previos = registros_previos(PROCEDENCIA)
    ORIGINAL.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".derechos-", dir=ORIGINAL.parent) as temporal:
        carpeta = Path(temporal)
        registros = _capturar_copia(carpeta, dia, previos, aceptar_cambio)
        extracciones = [registro for registro in previos.values() if registro["nivel"] == "extracción"]
        guardar_json(
            carpeta / ARCHIVO_DE_PROCEDENCIA,
            {
                "fuente": "Derechos en el trabajo",
                "licencia": LICENCIA,
                "cita": CITA,
                "copia": dia,
                "archivos": registros + extracciones,
            },
        )
        # Solo se publica después de recibir y comprobar toda la captura. La sustitución es por archivo, no una
        # transacción de directorio: un fallo de disco al publicar requiere restaurar la copia registrada.
        ORIGINAL.mkdir(parents=True, exist_ok=True)
        for registro in registros:
            (carpeta / registro["archivo"]).replace(ORIGINAL / registro["archivo"])
        (carpeta / ARCHIVO_DE_PROCEDENCIA).replace(PROCEDENCIA)


def _capturar_copia(
    carpeta: Path, dia: str, previos: dict[str, dict[str, Any]], aceptar_cambio: bool
) -> list[dict[str, Any]]:
    """Recibe y comprueba los originales en un área temporal, sin cambiar la copia publicada.

    Returns:
        Los registros de los originales ya recibidos y comprobados.
    """
    registros = []
    for indice, archivo in enumerate(archivos_de_la_copia(dia)):
        if indice:
            time.sleep(PAUSA_ENTRE_PETICIONES_S)
        previo = previos.get(archivo["archivo"])
        regla = ReglaDeCambio(archivo.get("equivalentes"), previo["sha256"] if previo else None, aceptar_cambio)
        destino = carpeta / archivo["archivo"]
        conservado = ORIGINAL / archivo["archivo"]
        if conservado.exists():
            shutil.copyfile(conservado, destino)
        descarga = descargar_url(archivo["url"], archivo["cabeceras"])
        datos = conservar_o_sustituir(destino, descarga, regla)
        observar_original(archivo["url"], descarga, datos)
        registros.append(registro_descarga(archivo, descarga, datos, previo))
        print(archivo["archivo"], len(datos), "bytes")
    return registros


class Copia(NamedTuple):
    """Lo leído de los originales registrados, comprobados con su huella."""

    dia: str
    vigencias: dict[str, str]
    textos: dict[str, str]
    normas: dict[str, bytes]
    paginas: dict[int, str]
    convenios: dict[str, bytes]
    consultados: dict[str, str]


def mas_reciente(archivo: str, extension: str) -> Path:
    """El original registrado más reciente de un archivo, sea cual sea el día de su copia.

    Returns:
        La ruta del original más reciente de ese archivo.
    """
    return ultimo_original(FUENTE, rf"{re.escape(archivo)}-\d{{4}}-\d{{2}}-\d{{2}}\.{extension}")


def dia_del_original(ruta: Path) -> str:
    """El día de la copia de un original, que va en su nombre.

    Returns:
        El día de la copia, AAAA-MM-DD.

    Raises:
        FormatoInesperado: Si el día del nombre no es una fecha real.
    """
    dia = re.search(r"(\d{4}-\d{2}-\d{2})\.\w+$", ruta.name)
    exigir(dia is not None, f"{ruta.name}: el nombre no dice el día de su copia")
    texto = dia.group(1)
    try:
        date.fromisoformat(texto)
    except ValueError as error:
        raise FormatoInesperado(f"{ruta.name}: el día de la copia no es una fecha real") from error
    return texto


def paginas_del_crl() -> dict[int, str]:
    """El texto de cada página del PDF del CRL, de su extracción, si esta sale del PDF registrado.

    Returns:
        El texto de cada página del PDF, por su número.
    """
    pdf = mas_reciente(RECOMENDACIONES.archivo, RECOMENDACIONES.extension)
    extraccion = mas_reciente(EXTRACCION, "json")
    registro = registros_previos(PROCEDENCIA).get(extraccion.name)
    exigir(isinstance(registro, dict), "la extracción del CRL no está registrada")
    huella = registro.get("sha256_de_origen")
    exigir(isinstance(huella, str) and bool(huella), "la extracción del CRL no registra la huella del PDF de origen")
    exigir(huella == sha256(pdf), "la extracción de texto no sale del PDF registrado del CRL")
    contenido = leer_json(extraccion)
    exigir(
        isinstance(contenido, list) and bool(contenido), f"{extraccion.name}: la extracción del CRL no tiene páginas"
    )
    paginas = {}
    for pagina in contenido:
        exigir(
            isinstance(pagina, dict)
            and type(pagina.get("pagina")) is int
            and pagina["pagina"] > 0
            and isinstance(pagina.get("texto"), str),
            f"{extraccion.name}: una página de la extracción del CRL no tiene número positivo y texto",
        )
        numero = pagina["pagina"]
        exigir(numero not in paginas, f"{extraccion.name}: página duplicada de la extracción del CRL: {numero}")
        paginas[numero] = tecnologia.texto_de_pagina(pagina["texto"])
    return paginas


def leer_copia() -> Copia:
    """Los originales registrados más recientes, comprobados con su huella: textos, páginas y día de cada uno.

    Returns:
        Los textos de los artículos por enlace, las páginas por archivo y el día de la copia de cada original.
    """
    vigencias, textos, consultados = {}, {}, {}
    for articulo in ARTICULOS:
        ruta = mas_reciente(articulo.archivo, "xml")
        consultados[articulo.enlace] = dia_del_original(ruta)
        vigencias[articulo.enlace], textos[articulo.enlace] = version_vigente(
            ruta.read_text(encoding="utf-8"), date.fromisoformat(consultados[articulo.enlace])
        )
    normas, convenios = {}, {}
    for boe_id, pagina in NORMAS.items():
        ruta = mas_reciente(pagina.archivo, pagina.extension)
        normas[boe_id], consultados[boe_id] = ruta.read_bytes(), dia_del_original(ruta)
    for boe_id, pagina in CONVENIOS.items():
        convenios[boe_id] = mas_reciente(pagina.archivo, pagina.extension).read_bytes()
    dia = procedencia(FUENTE)["copia"]
    return Copia(dia, vigencias, textos, normas, paginas_del_crl(), convenios, consultados)


def conjunto(copia: Copia) -> dict[str, Any]:
    """Las citas y los datos de los dos grupos de derechos, comprobados contra la copia.

    Returns:
        Las citas comprobadas y los datos de los dos grupos de derechos.
    """
    citas = [{**cita, "consultado": copia.consultados[cita["enlace"]]} for cita in citas_comprobadas(copia.textos)]
    dia_normas = max(copia.consultados[boe_id] for boe_id in NORMAS)
    return {
        "copia": copia.dia,
        "vigencias": copia.vigencias,
        "citas": citas,
        "tecnologia": {
            "citas": tecnologia.citas_comprobadas(copia.normas, dia_normas),
            "recomendaciones": {
                "titulo": RECOMENDACIONES.titulo,
                "edicion": "Consell de Relacions Laborals de Catalunya, septiembre de 2025",
                "enlace": CRL_ES,
                "enlace_ca": CRL_CA,
                "licencia": LICENCIA_CRL,
                "puntos": tecnologia.recomendaciones_comprobadas(copia.paginas),
            },
        },
        "clausulas_sectoriales": {
            "fuente": CRL_ES,
            "metodo": "Los ejemplos de convenios sectoriales del anexo del documento del CRL (pp. 57–65), sin los "
            "acuerdos de empresa; el resumen de cada uno es propio.",
            "limites": "Referencias documentadas por el CRL en 2025: no se presume que sigan vigentes ni que se "
            "apliquen a una persona concreta. No se muestran en el informe.",
            "registros": tecnologia.clausulas_comprobadas(copia.paginas, copia.convenios),
        },
    }


def preparar() -> None:
    """Comprueba cada cita, punto y cláusula contra los originales y guarda el conjunto con sus enlaces y sus fechas."""
    preparado = conjunto(leer_copia())
    guardar_json(CITAS, preparado)
    tecnica = preparado["tecnologia"]
    print(
        f"Copia del {preparado['copia']}: {len(preparado['citas'])} citas de formación, {len(tecnica['citas'])} ante "
        f"la tecnología, {len(tecnica['recomendaciones']['puntos'])} puntos del CRL y "
        f"{len(preparado['clausulas_sectoriales']['registros'])} cláusulas sectoriales"
    )


def se_comprueba[T](comprobacion: Callable[[], T]) -> tuple[T | None, str]:
    """El resultado de una comprobación y, si los originales no la sostienen, por qué (y entonces el control falla).

    Returns:
        Lo que devuelve la comprobación y un motivo vacío; o None y el mensaje del ErrorFuente que lanza.
    """
    try:
        return comprobacion(), ""
    except ErrorFuente as error:
        return None, str(error)


def _con_motivo(control: str, motivo: str) -> str:
    """El texto de un control, con el motivo del fallo detrás si lo hay.

    Returns:
        `control`, o `control; motivo` si hay motivo.
    """
    return f"{control}; {motivo}" if motivo else control


def _comprobar_preparado(preparadas: object) -> None:
    """Exige la estructura mínima que se compara con la copia reconstruida, sin normalizar sus valores."""
    exigir(isinstance(preparadas, dict), "citas.json no es un objeto")
    exigir(
        isinstance(preparadas.get("copia"), str) and isinstance(preparadas.get("vigencias"), dict),
        "citas.json no tiene copia y vigencias",
    )
    citas = preparadas.get("citas")
    exigir(
        isinstance(citas, list) and all(isinstance(cita, dict) and isinstance(cita.get("id"), str) for cita in citas),
        "citas.json no tiene una lista de citas con identificador",
    )
    tecnica = preparadas.get("tecnologia")
    exigir(
        isinstance(tecnica, dict)
        and isinstance(tecnica.get("citas"), list)
        and isinstance(tecnica.get("recomendaciones"), dict),
        "citas.json no tiene citas y recomendaciones de tecnología",
    )
    clausulas = preparadas.get("clausulas_sectoriales")
    exigir(
        isinstance(clausulas, dict) and isinstance(clausulas.get("registros"), list),
        "citas.json no tiene registros de cláusulas sectoriales",
    )


def validar() -> None:
    """Vuelve a comprobarlo todo contra los originales registrados y guarda su validación y su conjunto."""
    controles = Controles()
    controles_de_huella(controles, ORIGINAL, procedencia(FUENTE))
    preparadas = leer_json(CITAS)
    _comprobar_preparado(preparadas)
    copia, motivo = se_comprueba(leer_copia)
    controles.comprobar(
        copia is not None,
        _con_motivo("los originales registrados se leen con su huella y el texto del CRL sale de su PDF", motivo),
    )
    rehecho, motivo = se_comprueba(lambda: conjunto(copia)) if copia is not None else (None, "sin copia")
    controles.comprobar(rehecho is not None, _con_motivo("las citas y los datos se rehacen desde la copia", motivo))
    controles.comprobar(preparadas["copia"] == procedencia(FUENTE)["copia"], "las citas son de la copia registrada")
    controles.comprobar(
        bool(rehecho) and preparadas["vigencias"] == rehecho["vigencias"], "cada artículo citado es su versión vigente"
    )
    controles.comprobar(
        bool(rehecho) and preparadas["citas"] == rehecho["citas"], "cada fragmento está, letra a letra, en su artículo"
    )
    controles.comprobar(
        [cita["id"] for cita in preparadas["citas"]] == [cita["id"] for cita in CITADAS],
        f"las {len(CITADAS)} citas, en su orden",
    )
    tecnica = preparadas.get("tecnologia", {})
    controles.comprobar(
        bool(rehecho) and tecnica.get("citas") == rehecho["tecnologia"]["citas"],
        "cada cita ante la tecnología está, letra a letra, en su artículo consolidado, con su fecha",
    )
    controles.comprobar(
        bool(rehecho) and tecnica.get("recomendaciones") == rehecho["tecnologia"]["recomendaciones"],
        "cada punto del resumen del CRL se apoya en un pasaje literal de su página",
    )
    clausulas = preparadas.get("clausulas_sectoriales", {}).get("registros", [])
    controles.comprobar(
        bool(rehecho)
        and len(clausulas) == CLAUSULAS_SECTORIALES
        and clausulas == rehecho["clausulas_sectoriales"]["registros"],
        f"las {CLAUSULAS_SECTORIALES} cláusulas sectoriales, con su referencia y su artículo en la página citada "
        "(banca y química, "
        "también en su texto del BOE)",
    )
    informe = {
        "estado": controles.estado,
        "comprobado_utc": ahora_utc(),
        "copia": preparadas["copia"],
        "limites": "Citas literales, sin interpretarlas: cómo se aplica cada derecho depende del contrato y del "
        "convenio de cada persona. El resumen del CRL es de Faro y cada punto se apoya en un pasaje del documento; las "
        "cláusulas sectoriales son ejemplos de 2025 que no se muestran. Si un original cambia, la copia nueva lo "
        "detiene hasta revisarlo.",
        "controles": controles.lista,
    }
    cerrar_validacion(FUENTE, informe, controles, lambda: preparadas)


def main(argv: list[str] | None = None) -> int:
    """Interfaz de línea de órdenes: descargar, preparar, validar o todo.

    Returns:
        El código de salida de la orden: 0 si todo va bien.
    """
    etapas = {"preparar": preparar, "validar": validar}
    return principal_fuente_con_descarga(__doc__, descargar, etapas, argv)


if __name__ == "__main__":
    sys.exit(main())
