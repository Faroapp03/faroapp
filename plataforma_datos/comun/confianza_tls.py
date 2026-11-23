"""CA oficial de certifi, explícita y fijada, para runtime y bootstrap anterior al venv.

El bootstrap usa únicamente la semilla pública íntegra del mismo artefacto. Runtime exige el certifi instalado
correspondiente; nunca recurre al almacén del sistema o a variables de entorno. Las huellas se actualizan juntas
con la versión, los requisitos y el lock tras verificar el nuevo artefacto oficial. El checkout y el venv deben
ser privados, sin escritores concurrentes durante su uso; no se modifica ssl globalmente ni se abre red aquí.

Dos listas cerradas completan esa confianza sin aflojar la verificación: los certificados intermedios conocidos, que
solo ayudan a completar la cadena de servidores que no la envían entera, y los cifrados heredados que se permiten a
un dominio exacto. Ninguna de las dos añade raíces ni apaga la verificación del certificado ni del nombre.
"""

import hashlib
import os
import ssl
import stat
import sys
import time
from dataclasses import dataclass
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

CERTIFI_VERSION = "2026.10.23"
PIP_VERSION = "26.2.2"
CA_SHA256 = "2ef52ad56b4803e264045c915e55c236cbfa045b84b81efefc218a19eb44bd2b"
CA_BYTES = 235863
PROCEDENCIA_SHA256 = "f66fcd5e7d3f23a566094875ac7021772af41cde72f6ad65655f9b68baa2611a"
PROCEDENCIA_BYTES = 1874
LICENCIA_SHA256 = "e93716da6b9c0d5a4a1df60fe695b370f0695603d21f6f83f053e42cfc10caf7"
LICENCIA_BYTES = 989
RECURSOS = Path(__file__).with_suffix("")
ERROR = "No se ha verificado la confianza TLS de esta instalación."


@dataclass(frozen=True)
class Intermedio:
    """Un certificado intermedio conocido, con lo que se comprueba de él antes de cargarlo.

    Attributes:
        nombre: Nombre de la autoridad, para los avisos.
        archivo: PEM dentro de `confianza_tls/intermedios/`.
        sha256: Huella del certificado en DER, en minúsculas.
        tamano: Bytes del certificado en DER.
        emisor: Último componente del nombre del emisor (el nombre común o, si no lo tiene, la unidad).
        caduca: Fecha de caducidad (AAAA-MM-DD).
        origen: Dirección pública de donde se obtuvo, o quién lo envió.
        obtenido: Fecha en que se obtuvo (AAAA-MM-DD).
    """

    nombre: str
    archivo: str
    sha256: str
    tamano: int
    emisor: str
    caduca: str
    origen: str
    obtenido: str


# Cadena de «AC SERVIDORES SEGUROS TIPO2 G2R», el emisor de los certificados de agora.fundae.es, que su servidor no
# envía. Ambos encadenan con la raíz «AC RAIZ FNMT-RCM» de la lista de certifi.
INTERMEDIOS = (
    Intermedio(
        nombre="AC RAIZ FNMT-RCM SERVIDORES SEGUROS G2R",
        archivo="ac-raiz-fnmt-servidores-seguros-g2r.pem",
        sha256="327ec93955c9145261b087c6fc5eac8a71262bf2568e8d36f7c2fedbd1b1077a",
        tamano=1664,
        emisor="AC RAIZ FNMT-RCM",
        caduca="2029-12-16",
        origen="Enviado por agora.fundae.es en su cadena de certificados; su emisor se publica en "
        "http://www.cert.fnmt.es/certs/ACRAIZFNMT.crt",
        obtenido="2026-11-15",
    ),
    Intermedio(
        nombre="AC SERVIDORES SEGUROS TIPO2 G2R",
        archivo="ac-servidores-seguros-tipo2-g2r.pem",
        sha256="b45ab8e079025df9783535a720862129c9b2d22672b9be8dfe7cd2eda33f62a3",
        tamano=1750,
        emisor="AC RAIZ FNMT-RCM SERVIDORES SEGUROS G2R",
        caduca="2035-12-14",
        origen="http://www.cert.fnmt.es/certs/ACSS2G2R.crt",
        obtenido="2026-11-15",
    ),
)
TOPE_PEM_BYTES = 16384


@dataclass(frozen=True)
class CifradoHeredado:
    """Un cifrado antiguo que se permite, además de los modernos, al conectar con un dominio concreto.

    Attributes:
        cifrado: Nombre OpenSSL del cifrado (TLS 1.2).
        motivo: Por qué hace falta y qué se pierde.
        evidencia: Fecha (AAAA-MM-DD) de la comprobación de que el servidor no ofrece otro.
    """

    cifrado: str
    motivo: str
    evidencia: str


# Dominios exactos (sin comodines ni subdominios). El resto de dominios solo negocia los cifrados modernos.
CIFRADOS_HEREDADOS = {
    "portaldogc.gencat.cat": CifradoHeredado(
        cifrado="AES256-SHA",
        motivo="El portal del DOGC solo negocia TLS 1.2 con este cifrado, que no da secreto hacia delante; rechaza los "
        "ECDHE y GCM. Su certificado se verifica igual.",
        evidencia="2026-11-15",
    ),
}
# Cada aviso de un intermedio no cargado se da una vez por proceso, no en cada conexión.
_AVISADOS: set[tuple[str, str]] = set()


class ErrorConfianzaTLS(ValueError):
    """CA, procedencia o paquete no verificables; no se permite una confianza alternativa implícita."""


def _leer(ruta: Path, huella: str, cantidad: int) -> bytes:
    try:
        descriptor = os.open(ruta, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
        with os.fdopen(descriptor, "rb") as archivo:
            estado = os.fstat(archivo.fileno())
            if not stat.S_ISREG(estado.st_mode) or estado.st_size != cantidad:
                raise ErrorConfianzaTLS(ERROR)
            contenido = archivo.read(cantidad + 1)
        if len(contenido) != cantidad or hashlib.sha256(contenido).hexdigest() != huella:
            raise ErrorConfianzaTLS(ERROR)
    except OSError as error:
        raise ErrorConfianzaTLS(ERROR) from error
    return contenido


class _IntermedioRechazado(Exception):
    """Un intermedio que no pasa sus comprobaciones; el texto es el motivo, para el aviso."""


def _leer_pem(ruta: Path) -> bytes:
    """Lee un PEM de un archivo regular, sin seguir enlaces y con un tope de tamaño.

    Returns:
        El contenido del archivo.

    Raises:
        _IntermedioRechazado: Si no se puede leer, no es un archivo regular o supera el tope.
    """
    try:
        descriptor = os.open(ruta, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
        with os.fdopen(descriptor, "rb") as archivo:
            if not stat.S_ISREG(os.fstat(archivo.fileno()).st_mode):
                raise _IntermedioRechazado("no es un archivo regular")
            contenido = archivo.read(TOPE_PEM_BYTES + 1)
    except OSError as error:
        raise _IntermedioRechazado("no se puede leer") from error
    if len(contenido) > TOPE_PEM_BYTES:
        raise _IntermedioRechazado("supera el tamaño admitido")
    return contenido


def _ultimo_componente(nombre: tuple[tuple[tuple[str, str], ...], ...]) -> str:
    """El valor del último componente de un nombre de certificado, como lo devuelve `get_ca_certs`.

    Returns:
        El valor, o una cadena vacía si el nombre no tiene componentes.
    """
    return nombre[-1][-1][1] if nombre and nombre[-1] else ""


def _verificar_intermedio(intermedio: Intermedio, recursos: Path, ahora: float) -> bytes:
    """Comprueba un intermedio: huella y tamaño, autoridad, que no sea autofirmado, emisor y vigencia.

    Returns:
        El certificado en DER, listo para cargarlo.

    Raises:
        _IntermedioRechazado: Con el motivo, si falla cualquiera de las comprobaciones.
    """
    try:
        der = ssl.PEM_cert_to_DER_cert(_leer_pem(recursos / intermedio.archivo).decode("ascii"))
    except ValueError as error:
        raise _IntermedioRechazado("no es un certificado PEM") from error
    if len(der) != intermedio.tamano or hashlib.sha256(der).hexdigest() != intermedio.sha256:
        raise _IntermedioRechazado("no es el certificado declarado")
    examen = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    try:
        examen.load_verify_locations(cadata=der)
    except ssl.SSLError as error:
        raise _IntermedioRechazado("OpenSSL no lo acepta") from error
    # `get_ca_certs` solo devuelve los certificados con CA:TRUE.
    autoridades = examen.get_ca_certs()
    if len(autoridades) != 1:
        raise _IntermedioRechazado("no es un certificado de autoridad")
    certificado = autoridades[0]
    if certificado["issuer"] == certificado["subject"]:
        raise _IntermedioRechazado("es autofirmado, no un intermedio")
    if _ultimo_componente(certificado["issuer"]) != intermedio.emisor:
        raise _IntermedioRechazado("su emisor no es el esperado")
    if ssl.cert_time_to_seconds(certificado["notAfter"]) <= ahora:
        raise _IntermedioRechazado("ha caducado")
    return der


def _avisar(intermedio: Intermedio, motivo: str) -> None:
    if (intermedio.archivo, motivo) in _AVISADOS:
        return
    _AVISADOS.add((intermedio.archivo, motivo))
    print(
        f"Aviso: Faro no carga el certificado intermedio «{intermedio.nombre}» ({motivo}) y sigue con los demás. "
        "Las conexiones que dependen de él pueden fallar hasta que se revise.",
        file=sys.stderr,
    )


def _cargar_intermedios(
    contexto: ssl.SSLContext, intermedios: tuple[Intermedio, ...], recursos: Path, ahora: float
) -> None:
    """Añade al contexto los intermedios que pasan todas sus comprobaciones; avisa de los demás y sigue."""
    for intermedio in intermedios:
        try:
            contexto.load_verify_locations(cadata=_verificar_intermedio(intermedio, recursos, ahora))
        except _IntermedioRechazado as rechazo:
            _avisar(intermedio, str(rechazo))
        except ssl.SSLError:
            _avisar(intermedio, "OpenSSL no lo acepta")


def _ahora() -> float:
    return time.time()


def _permitir_cifrado(contexto: ssl.SSLContext, cifrado: str) -> None:
    """Añade un cifrado a los que el contexto ya negocia, sin cambiar nada más.

    Raises:
        ErrorConfianzaTLS: Si OpenSSL no admite el cifrado.
    """
    try:
        contexto.set_ciphers(":".join([*(c["name"] for c in contexto.get_ciphers()), cifrado]))
    except ssl.SSLError as error:
        raise ErrorConfianzaTLS(ERROR) from error
    # OpenSSL ignora un nombre desconocido si el resto de la lista es válido.
    if cifrado not in {c["name"] for c in contexto.get_ciphers()}:
        raise ErrorConfianzaTLS(ERROR)


def _procedencia() -> None:
    # La huella fija también el esquema y los valores del documento de procedencia, no su interpretación dinámica.
    _leer(RECURSOS / "procedencia.json", PROCEDENCIA_SHA256, PROCEDENCIA_BYTES)


def _runtime() -> tuple[Path, bytes]:
    _procedencia()
    try:
        import certifi

        if version("certifi") != CERTIFI_VERSION:
            raise ErrorConfianzaTLS(ERROR)
        ruta = Path(certifi.where())
    except (ImportError, PackageNotFoundError) as error:
        raise ErrorConfianzaTLS(ERROR) from error
    return ruta, _leer(ruta, CA_SHA256, CA_BYTES)


def _contexto(contenido: bytes) -> ssl.SSLContext:
    try:
        # No usar create_default_context: también interpreta SSLKEYLOGFILE del ambiente.
        contexto = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        contexto.minimum_version = ssl.TLSVersion.TLSv1_2
        contexto.load_verify_locations(cadata=contenido.decode("ascii"))
        return contexto
    except (UnicodeError, ssl.SSLError) as error:
        raise ErrorConfianzaTLS(ERROR) from error


def contexto_tls(dominio: str | None = None) -> ssl.SSLContext:
    """Construye TLS verificado exclusivamente con el certifi fijado del runtime y los intermedios conocidos.

    Los intermedios completan cadenas, no son raíces: un servidor que no envía su cadena entera conecta, y la cadena
    parcial sigue apagada. Un intermedio que no pasa sus comprobaciones no se carga y se avisa de él.

    Args:
        dominio: El dominio al que se va a conectar. Si es uno de `CIFRADOS_HEREDADOS` (nombre exacto), el contexto
            admite además su cifrado heredado; con cualquier otro valor o con None, solo los modernos.

    Returns:
        Contexto con verificación de certificado y hostname, sin CA ambientales.

    Raises:
        ErrorConfianzaTLS: Si el paquete, la versión o sus bytes no coinciden.
    """
    contexto = _contexto(_runtime()[1])
    _cargar_intermedios(contexto, INTERMEDIOS, RECURSOS / "intermedios", _ahora())
    if dominio in CIFRADOS_HEREDADOS:
        _permitir_cifrado(contexto, CIFRADOS_HEREDADOS[dominio].cifrado)
    return contexto


def ruta_ca_runtime_verificada() -> Path:
    """Resuelve la misma CA para SDK que requieren una ruta en vez de un SSLContext.

    Returns:
        Ruta de certifi cuyos bytes se acaban de verificar; no la de una variable ambiental.

    Raises:
        ErrorConfianzaTLS: Si el paquete, la versión o sus bytes no coinciden.
    """
    return _runtime()[0]


def contexto_tls_bootstrap() -> ssl.SSLContext:
    """Usa la semilla del checkout antes de instalar dependencias, sin importar certifi.

    Returns:
        Contexto verificado con el PEM oficial íntegro, idéntico al del runtime admitido.

    Raises:
        ErrorConfianzaTLS: Si la semilla, su licencia o procedencia faltan o cambian.
    """
    _procedencia()
    _leer(RECURSOS / "LICENSE", LICENCIA_SHA256, LICENCIA_BYTES)
    return _contexto(_leer(RECURSOS / "cacert.pem", CA_SHA256, CA_BYTES))


def comprobar_instalacion() -> None:
    """Verifica las dos versiones instaladas después del bootstrap offline.

    Raises:
        ErrorConfianzaTLS: Si certifi, sus bytes o la versión de pip no coinciden.
    """
    ruta_ca_runtime_verificada()
    try:
        if version("pip") != PIP_VERSION:
            raise ErrorConfianzaTLS(ERROR)
    except PackageNotFoundError as error:
        raise ErrorConfianzaTLS(ERROR) from error


if __name__ == "__main__":
    try:
        comprobar_instalacion()
    except ErrorConfianzaTLS:
        sys.exit(ERROR)
