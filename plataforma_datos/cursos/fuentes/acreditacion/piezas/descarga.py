"""Descarga de la acreditación: índice y anexos del BOE, PDF originales y normas, respetando su robots.txt."""

import re
import time
from collections import defaultdict
from typing import Any, NamedTuple
from urllib.parse import urlsplit

from plataforma_datos.comun import boe
from plataforma_datos.comun.entrada_salida import ahora_utc, sha256_bytes
from plataforma_datos.comun.estadisticas import RESUMEN_LICENCIA_INE
from plataforma_datos.comun.nucleo import (
    ArchivoDescargable,
    EntradaDeDescarga,
    ErrorFuente,
    FormatoInesperado,
    exigir,
)
from plataforma_datos.comun.red import descargar_originales, descargar_url
from plataforma_datos.comun.robots import permitido
from plataforma_datos.comun.textos_y_cifras import texto
from plataforma_datos.cursos.fuentes.acreditacion.piezas.constantes import (
    ARCHIVO_CNO94,
    ARCHIVO_DEL_INDICE,
    BOE,
    CORRESPONDENCIA_CNO94,
    EQUIVALENCIAS,
    FECHAS_POSTERIORES,
    INDICE,
    LARGO_CODIGO_OFICIAL,
    LEY,
    ORIGINAL,
    PAUSA_ENTRE_PETICIONES_S,
    REGLAMENTO,
    Pagina,
)

# ---------------------------------------------------------------------------------------------------------------------
# Nombres, direcciones y lector
# ---------------------------------------------------------------------------------------------------------------------


class TextoConsolidado(NamedTuple):
    """Lo que se lee del texto consolidado de un real decreto."""

    anexos: set[str]
    enlace_pdf: str | None


class Lector:
    """Descarga respetando el robots.txt de cada sitio y una pausa entre peticiones; anota cada robots.txt leído."""

    def __init__(self, aceptar_cambio: bool) -> None:
        self.aceptar_cambio = aceptar_cambio
        self.robots: dict[str, dict[str, str]] = {}
        self._textos: dict[str, str] = {}

    def _robots_de(self, host: str) -> str:
        """Descarga el robots.txt de un sitio la primera vez que se pide, lo anota en `self.robots` y espera la pausa.

        Returns:
            El texto del robots.txt del sitio.
        """
        if host not in self._textos:
            url_robots = f"https://{host}/robots.txt"
            descarga = descargar_url(url_robots)
            self._textos[host] = descarga.datos.decode("utf-8", "replace")
            self.robots[host] = {
                "url": url_robots,
                "sha256": sha256_bytes(descarga.datos),
                "consultado_utc": ahora_utc(),
            }
            time.sleep(PAUSA_ENTRE_PETICIONES_S)
        return self._textos[host]

    def descargar(self, pagina: Pagina) -> tuple[EntradaDeDescarga, bytes]:
        """Descarga una página si su robots.txt lo permite; devuelve su entrada de procedencia y sus bytes.

        Returns:
            La entrada de procedencia de la página y sus bytes.
        """
        host = urlsplit(pagina.url).netloc
        exigir(permitido(self._robots_de(host), pagina.url), f"el robots.txt de {host} no permite {pagina.url}")
        archivo: ArchivoDescargable = {
            "archivo": pagina.archivo,
            "nivel": "oficial",
            "titulo": pagina.titulo,
            "url": pagina.url,
            "licencia": pagina.licencia,
        }
        registro = descargar_originales([archivo], ORIGINAL, self.aceptar_cambio)[0]
        time.sleep(PAUSA_ENTRE_PETICIONES_S)
        return registro, (ORIGINAL / pagina.archivo).read_bytes()


def _textos_consolidados(
    lector: Lector, paginas: list[Pagina]
) -> tuple[list[EntradaDeDescarga], dict[str, TextoConsolidado]]:
    """El texto consolidado de cada real decreto: sus registros y, de cada uno, sus certificados y su PDF.

    Returns:
        Los registros de los textos y, por cada real decreto, sus certificados y su PDF.
    """
    registros: list[EntradaDeDescarga] = []
    codigos: dict[str, TextoConsolidado] = {}
    for pagina in paginas:
        registro, contenido = lector.descargar(pagina)
        registros.append(registro)
        codigos[numero_del_archivo(pagina.archivo)] = leer_consolidado(contenido)
    return registros, codigos


def leer_consolidado(contenido: bytes) -> TextoConsolidado:
    """Extrae los anexos y la dirección PDF que determinan las descargas adicionales.

    Returns:
        Los códigos de certificado leídos y el enlace al PDF original, si consta.
    """
    return TextoConsolidado(set(boe.anexos(boe.texto_de_html(contenido))), boe.enlace_al_pdf(contenido))


def _pdf_necesarios(codigos: dict[str, TextoConsolidado], certificados: dict[str, dict[str, Any]]) -> list[str]:
    """Los reales decretos cuyo PDF original hace falta.

    Son los que no traen ningún anexo en su consolidado y los de un certificado del SOC que no está en ninguno.

    Returns:
        Los números de los reales decretos que necesitan su PDF.
    """
    leidos = {codigo_leido for encontrados, _ in codigos.values() for codigo_leido in encontrados}
    necesarios = {numero for numero, (encontrados, _) in codigos.items() if not encontrados}
    for codigo_soc, certificado in certificados.items():
        numero = real_decreto_del_soc(certificado)
        if codigo_soc[:LARGO_CODIGO_OFICIAL] not in leidos and numero in codigos:
            necesarios.add(numero)
    return sorted(necesarios, key=orden_de_numero)


def _partir_numero(numero: str) -> tuple[str, str]:
    """Lee un número de real decreto, con motivo si no tiene la forma número/año.

    Returns:
        El número y su año, conservando sus cifras.

    Raises:
        FormatoInesperado: Si el número no tiene la forma esperada.
    """
    encontrado = re.fullmatch(r"([0-9]+)/([0-9]{4})", numero)
    if encontrado is None:
        raise FormatoInesperado(f"Real Decreto {numero!r}: se espera número/año de cuatro cifras")
    return encontrado.group(1), encontrado.group(2)


def nombre_de_disposicion(numero: str, extension: str = "html") -> str:
    """Archivo del texto de un real decreto: «645/2011» da «boe-rd-2011-645.html».

    Returns:
        El nombre del archivo.
    """
    cifra, anio = _partir_numero(numero)
    return f"boe-rd-{anio}-{cifra}.{extension}"


def numero_del_archivo(archivo: str) -> str:
    """El real decreto de un archivo: «boe-rd-2011-645.html» da «645/2011».

    Returns:
        El número del real decreto, en la forma «número/año».

    Raises:
        FormatoInesperado: Si el archivo no tiene la forma esperada.
    """
    encontrado = re.fullmatch(r"boe-rd-([0-9]{4})-([0-9]+)\.[a-z]+", archivo)
    if encontrado is None:
        raise FormatoInesperado(f"archivo de Real Decreto no válido: {archivo!r}")
    anio, cifra = encontrado.groups()
    return f"{cifra}/{anio}"


def orden_de_numero(numero: str) -> tuple[str, int]:
    """Para ordenar reales decretos por año y número.

    Returns:
        La clave de ordenación: año y número.
    """
    cifra, anio = _partir_numero(numero)
    return anio, int(cifra)


def certificados_del_soc(filas: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Las filas de cada certificado del SOC (las especialidades con real decreto), por código.

    Returns:
        Las filas de cada certificado, por código.
    """
    certificados: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for numero, fila in enumerate(filas, start=1):
        if texto(fila.get("certprof")) not in ("", "undefined"):
            codigo_soc = fila.get("codiespecialitat")
            exigir(
                isinstance(codigo_soc, str) and bool(codigo_soc.strip()),
                f"SOC: fila {numero} de certificado sin código de especialidad válido",
            )
            certificados[codigo_soc].append(fila)
    return {codigo_soc: {"filas": lista} for codigo_soc, lista in sorted(certificados.items())}


def real_decreto_del_soc(certificado: dict[str, Any]) -> str | None:
    """El real decreto («número/año») que el SOC da a un certificado; None si su campo no lo dice.

    Returns:
        El real decreto, o None si el campo no lo dice.
    """
    coincidencia = re.search(r"(\d+)\s*/\s*(\d{4})", texto(certificado["filas"][0].get("certprof")))
    return f"{coincidencia.group(1)}/{coincidencia.group(2)}" if coincidencia else None


# Los reales decretos de FECHAS_POSTERIORES, en la forma «número/año»: se calculan una vez.
REALES_DECRETOS_POSTERIORES = tuple(
    f"{cifra}/{fecha[:4]}" for fecha, numeros in FECHAS_POSTERIORES.items() for cifra in numeros
)


def posteriores() -> list[str]:
    """Los reales decretos de certificados posteriores al índice, con su fecha conocida.

    Returns:
        Los números de los reales decretos posteriores al índice.
    """
    return list(REALES_DECRETOS_POSTERIORES)


def url_de_disposicion(numero: str, indice: dict[str, boe.Disposicion]) -> str:
    """Dirección del texto consolidado de un real decreto: por su identificador del índice o por su ELI y su fecha.

    Returns:
        La dirección del texto consolidado.

    Raises:
        ErrorFuente: Si el índice no trae el real decreto y no hay forma de construir su dirección.
    """
    if numero in indice:
        return f"{BOE}/buscar/act.php?id={indice[numero].boe}"
    cifra, anio = _partir_numero(numero)
    for fecha, numeros in FECHAS_POSTERIORES.items():
        if fecha.startswith(anio) and int(cifra) in numeros:
            return f"{BOE}/eli/es/rd/{fecha.replace('-', '/')}/{cifra}"
    raise ErrorFuente(f"Real Decreto {numero}: no está en el índice ni en FECHAS_POSTERIORES; añade su fecha")


# ---------------------------------------------------------------------------------------------------------------------
# Lo que se descarga
# ---------------------------------------------------------------------------------------------------------------------


def pagina_del_indice() -> Pagina:
    """Describe el índice histórico declarado, sin atribuirle descubrimiento de sucesoras.

    Returns:
        La página de análisis del Real Decreto 189/2013.
    """
    return Pagina(ARCHIVO_DEL_INDICE, f"{BOE}/buscar/doc.php?id={INDICE}", "Real Decreto 189/2013: análisis")


def paginas_consolidadas(indice: dict[str, boe.Disposicion], certificados: dict[str, dict[str, Any]]) -> list[Pagina]:
    """Deriva el corpus declarado del índice, las fechas registradas y la copia local del SOC.

    Returns:
        El mismo inventario ordenado que consume la descarga; no es un catálogo normativo universal.
    """
    del_soc = {
        numero for certificado in certificados.values() if (numero := real_decreto_del_soc(certificado)) is not None
    }
    numeros = sorted(set(indice) | set(posteriores()) | del_soc, key=orden_de_numero)
    return [Pagina(nombre_de_disposicion(n), url_de_disposicion(n, indice), f"Real Decreto {n}") for n in numeros]


def paginas_pdf(codigos: dict[str, TextoConsolidado], certificados: dict[str, dict[str, Any]]) -> list[Pagina]:
    """Describe los PDF que faltan para leer el corpus declarado.

    Returns:
        Los originales necesarios, por su enlace ELI publicado en cada consolidado.

    Raises:
        FormatoInesperado: Si un texto que necesita PDF no lo declara.
    """
    paginas = []
    for numero in _pdf_necesarios(codigos, certificados):
        enlace = codigos[numero].enlace_pdf
        if enlace is None:
            raise FormatoInesperado(f"Real Decreto {numero}: su texto no trae los anexos ni declara su PDF")
        paginas.append(Pagina(nombre_de_disposicion(numero, "pdf"), enlace, f"Real Decreto {numero}: PDF original"))
    return paginas


def disposiciones(lector: Lector, certificados: dict[str, dict[str, Any]]) -> list[EntradaDeDescarga]:
    """El índice, el texto consolidado de cada real decreto de certificados y, si hace falta, su PDF original.

    Returns:
        Los registros de procedencia del índice, los textos y los PDF.

    Raises:
        FormatoInesperado: Si un real decreto sin anexos en su texto tampoco declara su PDF.
    """
    registro, contenido = lector.descargar(pagina_del_indice())
    indice = boe.referencias_anteriores(contenido)
    registros, codigos = _textos_consolidados(lector, paginas_consolidadas(indice, certificados))
    for pdf_original in paginas_pdf(codigos, certificados):
        registros.append(lector.descargar(pdf_original)[0])
    return [registro, *registros]


def complementarias() -> list[Pagina]:
    """Las normas cuyos pasajes se comprueban y la correspondencia CNO-94 / CNO-11 del INE.

    Returns:
        Las páginas complementarias que se descargan.
    """
    normas = [
        Pagina(norma.archivo, f"{BOE}/buscar/act.php?id={norma.boe}", norma.titulo)
        for norma in (EQUIVALENCIAS, REGLAMENTO, LEY)
    ]
    ine = Pagina(ARCHIVO_CNO94, CORRESPONDENCIA_CNO94, "INE · correspondencia CNO-94 / CNO-11", RESUMEN_LICENCIA_INE)
    return [*normas, ine]
