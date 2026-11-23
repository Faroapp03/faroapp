"""Recepciones privadas por proceso de descarga; ninguna variable ambiental concede una comprobación remota."""

import hashlib
import json
import re
import sys
import tempfile
import uuid
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import NamedTuple

from plataforma_datos.comun.nucleo import FormatoInesperado, exigir
from plataforma_datos.comun.observacion_remota import (
    MAX_RECEPCION_BYTES,
    VARIABLE_RECEPCION,
    leer_recepcion,
    validar_recepcion,
)
from plataforma_datos.cursos.fuentes.citilab.constantes import PAGINA_DE_COMPROBACION
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import CARPETA_DE_INFORMES, FUENTES, parametros_de_etapa
from plataforma_datos.orquestacion.reconstruir import FUENTES_EN_ORDEN
from plataforma_datos.orquestacion.sustitucion import escribir_atomico

ETAPAS = frozenset({"descargar", "preparar", "validar"})
ARGUMENTOS_BASICOS = 4
CARPETA_DE_INTENTOS = "intentos"
VERSION_INTENTO = 1
MAX_INTENTO_BYTES = MAX_RECEPCION_BYTES + 4096  # recibo cerrado (8 MiB) y metadatos propios acotados
MAX_TIPO_ERROR = 80


class Recepcion(NamedTuple):
    """Un destino nuevo y una identidad no reutilizable por el siguiente intento."""

    entorno: dict[str, str]
    ruta: Path | None = None
    fuente: str = ""
    intento: str = ""

    def leer(self) -> dict | None:
        """Lee solo el recibo de este proceso; ausencia no significa éxito remoto.

        Returns:
            Observaciones verificadas, o None si no hubo recepción.
        """
        if self.ruta is None:
            return None
        return leer_recepcion(self.ruta, self.fuente, self.intento)


def etapa_de_fuente(orden: Sequence[str]) -> tuple[str, str] | None:
    """Reconoce exclusivamente una etapa canónica de una fuente registrada.

    Returns:
        Fuente y etapa, o None para cualquier otra orden.
    """
    if len(orden) not in (ARGUMENTOS_BASICOS, ARGUMENTOS_BASICOS + 1):
        return None
    if tuple(orden[:2]) != (sys.executable, "-m"):
        return None
    modulo, etapa = orden[2:4]
    registradas = {adaptador.__name__: nombre for nombre, adaptador in FUENTES_EN_ORDEN}
    fuente = registradas.get(modulo)
    if fuente not in FUENTES or etapa not in ETAPAS:
        return None
    return (fuente, etapa) if tuple(orden[4:]) == parametros_de_etapa(fuente, etapa) else None


@contextmanager
def recepcion_de_orden(orden: Sequence[str], entorno: Mapping[str, str]) -> Iterator[Recepcion]:
    """Aísla la recepción fuera del área y la elimina al concluir su único proceso.

    Yields:
        Entorno y receptor de la descarga, o un receptor vacío para otras órdenes.
    """
    filtrado = {clave: valor for clave, valor in entorno.items() if clave != VARIABLE_RECEPCION}
    etapa = etapa_de_fuente(orden)
    if etapa is None or etapa[1] != "descargar":
        yield Recepcion(filtrado)
        return
    with tempfile.TemporaryDirectory(prefix="consulta-remota-") as temporal:
        ruta = Path(temporal) / "recepcion.json"
        intento = str(uuid.uuid4())
        filtrado[VARIABLE_RECEPCION] = json.dumps({"ruta": str(ruta), "fuente": etapa[0], "intento": intento})
        yield Recepcion(filtrado, ruta, etapa[0], intento)


def _guardar_intento(ruta: Path, documento: dict) -> None:
    """Persiste solo metadatos propios y recibos validados; no salida, órdenes, URLs ni cuerpos HTTP."""
    contenido = json.dumps(documento, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n"
    exigir(len(contenido.encode()) <= MAX_INTENTO_BYTES, "el intento técnico excede su límite")
    escribir_atomico(ruta, contenido)


# Frases propias que una etapa escribe en su salida y la causa cerrada que corresponde a cada una.
MARCAS_DE_SALIDA = (
    (PAGINA_DE_COMPROBACION, "pagina-de-comprobacion"),
    ("✗ cada edición tiene la evidencia conservada", "evidencias-ediciones-incompletas"),
)


def causa_de_salida(codigo: int, salida: str) -> str:
    """Reconoce únicamente causas que se pueden registrar sin incluir cuerpos, rutas ni mensajes de terceros.

    Returns:
        Código cerrado que describe la señal observada en el proceso.
    """
    http = re.search(r"\bHTTP(?: Error|:)? ([45][0-9]{2})\b", salida)
    if http:
        return "http-" + http[1]
    for marca, causa in MARCAS_DE_SALIDA:
        if marca in salida:
            return causa
    if "no se pudo ejecutar " in salida:
        return "proceso-no-disponible"
    if "se pasó del tope de " in salida or "timed out" in salida:
        return "plazo-agotado"
    if "CERTIFICATE_VERIFY_FAILED" in salida:
        return "certificado-no-verificable"
    return "etapa-rechazada" if codigo else "correcta"


class IntentoRegistrado(NamedTuple):
    """Una operación técnica privada; su existencia no acredita cobertura, admisión ni publicación."""

    ruta: Path
    documento: dict

    def terminar(self, codigo: int, evidencia: dict | None, salida: str = "") -> None:
        """Conserva código y recibo aun cuando el proceso termina en rojo; nunca inventa uno ausente."""
        exigir(type(codigo) is int, "código de intento técnico no válido")
        recibo = None
        if evidencia is not None:
            recibo = validar_recepcion(evidencia, self.documento["fuente"], evidencia.get("intento"))
            contenido = json.dumps(recibo, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()
            exigir(len(contenido) <= MAX_RECEPCION_BYTES, "el recibo técnico excede su límite")
        fin = datetime.now(UTC).isoformat()
        exigir(fin >= self.documento["inicio_utc"], "el reloj del intento técnico retrocede")
        terminado = {
            **self.documento,
            "fin_utc": fin,
            "estado": "terminado",
            "codigo": codigo,
            "causa": causa_de_salida(codigo, salida) if codigo else None,
            "recibo": recibo,
            "recibo_sha256": hashlib.sha256(contenido).hexdigest() if recibo is not None else None,
        }
        # Son hechos ya observados, aunque la persistencia falle. El manejador conserva esos hechos
        # y marca la excepción de cierre; actualizar memoria no acredita que el primer guardado se completó.
        self.documento.update(terminado)
        _guardar_intento(self.ruta, terminado)

    def fallar(self, error: BaseException) -> None:
        """Registra el fin de la llamada con excepción, sin guardar textos arbitrarios ni inventar código HTTP."""
        fallido = {
            **self.documento,
            "fin_utc": self.documento["fin_utc"] or datetime.now(UTC).isoformat(),
            "estado": "excepcion",
            "tipo_error": type(error).__name__[:MAX_TIPO_ERROR],
        }
        _guardar_intento(self.ruta, fallido)
        self.documento.update(fallido)


@contextmanager
def intento_de_fuente(raiz: Path, ciclo: str, fuente: str, etapa: str) -> Iterator[IntentoRegistrado]:
    """Reserva y registra antes de ejecutar; un corte deja inicio y fin=null, no un éxito ficticio.

    El motor llama bajo su cerrojo. Cada invocación nueva recibe UUID distinto; el registro es un diario técnico,
    no una autoridad de disponibilidad. Cada archivo se limita a MAX_INTENTO_BYTES y no duplica cuerpos HTTP ni
    stdout/stderr. Crece linealmente con intentos reales; no hay purga automática ni una política destructiva de
    retención implícita. Una política futura de archivo deberá conservar referencias e historia de negocio.
    Ensayos/llamadas directas sin Seguimiento no producen este diario persistente.

    Yields:
        Identidad y ruta del único intento, que el llamador termina con su resultado.

    Raises:
        FormatoInesperado: Si la identidad, el recibo o el cierre no son válidos.
        OSError: Si no se puede conservar el intento; nunca se continúa silenciosamente sin diario.
    """
    exigir(fuente in FUENTES and etapa in ETAPAS, "identidad de intento técnico no válida")
    exigir(str(uuid.UUID(ciclo)) == ciclo, "ciclo de intento técnico no válido")
    carpeta = raiz / CARPETA_DE_INFORMES / CARPETA_DE_INTENTOS / str(uuid.uuid4())
    carpeta.mkdir(mode=0o700, parents=True)
    documento = {
        "version": VERSION_INTENTO,
        "id": carpeta.name,
        "ciclo": ciclo,
        "fuente": fuente,
        "etapa": etapa,
        "remoto": etapa == "descargar" and FUENTES[fuente].red,
        "inicio_utc": datetime.now(UTC).isoformat(),
        "fin_utc": None,
        "estado": "en-curso",
        "codigo": None,
        "recibo": None,
        "recibo_sha256": None,
        "tipo_error": None,
    }
    intento = IntentoRegistrado(carpeta / "intento.json", documento)
    _guardar_intento(intento.ruta, documento)
    try:
        yield intento
        exigir(documento["estado"] != "en-curso", "el intento técnico no recibió resultado")
    except BaseException as error:
        try:
            intento.fallar(error)
        except (OSError, ValueError, FormatoInesperado) as fallo_registro:
            raise error from fallo_registro
        raise
