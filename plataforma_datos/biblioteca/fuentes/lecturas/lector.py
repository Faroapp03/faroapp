"""Productor editorial local de Biblioteca; conserva bytes, fechas y condiciones por lectura.

La autoría está en catalogo.json y su procedencia en git. Python orquesta archivos;
el puente Node reutiliza las guardas TypeScript de la Biblioteca sin construir web
ni consultar enlaces. Exportar exige una admisión ligada a las entradas y contratos
actuales. Una ejecución local nunca acredita vigencia remota ni revisión editorial
nueva: sin plazo declarado, esa revisión queda pendiente.
"""

import json
import subprocess
import sys
from datetime import date
from pathlib import Path
from typing import NamedTuple

from plataforma_datos.comun.entrada_salida import (
    ahora_utc,
    carpetas,
    guardar_validacion,
    sha256,
    sha256_bytes,
    temporal_hermano,
)
from plataforma_datos.comun.nucleo import Controles, FormatoInesperado, ValidacionFallida
from plataforma_datos.contratos.fuentes import (
    DescriptorFuente,
    ErrorDescriptor,
    comprobar_lector,
    validar_descriptor,
)
from plataforma_datos.orquestacion.admision import exigir_admitido
from plataforma_datos.orquestacion.ordenes import principal_fuente

FUENTE = "lecturas"
MODULO = "plataforma_datos.biblioteca.fuentes.lecturas.lector"
CASA = Path(__file__).resolve().parent
RAIZ = CASA.parents[3]
CATALOGO = CASA / "catalogo.json"
PROCEDENCIA = CASA / "procedencia.json"
DESCRIPTOR = CASA / "fuente.json"
PUENTE = CASA / "validar_catalogo.ts"
PLAZO_NODE_S = 30
CONTRATOS_TS = (
    "herramientas/web/lecturas/registro.ts",
    "herramientas/web/lecturas/referencias.ts",
    "src/comun/idioma.ts",
    "src/comun/json.ts",
    "compartido/contratos/idioma.ts",
)


class Entradas(NamedTuple):
    """Bytes editoriales y contrato local efectivamente comprobado."""

    contenido: bytes
    revision: str | None
    total: int
    huellas: dict[str, str]


def _objeto(ruta: Path) -> dict[str, object]:
    """Lee un objeto JSON sin corregir ni sustituir sus campos.

    Returns:
        Objeto del archivo.

    Raises:
        FormatoInesperado: Si el documento no es JSON UTF-8 o no es un objeto.
    """
    try:
        valor: object = json.loads(ruta.read_text(encoding="utf-8"))
    except (ValueError, UnicodeError) as error:
        raise FormatoInesperado(f"{ruta.name}: JSON no válido") from error
    if not isinstance(valor, dict):
        raise FormatoInesperado(f"{ruta.name}: se esperaba un objeto")
    return valor


def descriptor() -> DescriptorFuente:
    """Comprueba identidad y política del único productor editorial local.

    Returns:
        Descriptor operativo validado.

    Raises:
        FormatoInesperado: Si el descriptor no corresponde a este productor local.
    """
    try:
        declarado = validar_descriptor(_objeto(DESCRIPTOR))
        comprobar_lector(declarado, identificador=FUENTE, modulo=MODULO, casa=FUENTE)
    except ErrorDescriptor as error:
        raise FormatoInesperado(f"lecturas: {error}") from error
    if declarado.tema != "biblioteca" or declarado.actualizacion.red:
        raise FormatoInesperado("lecturas: tema distinto o red habilitada en el productor local")
    return declarado


def _contrato_ts() -> dict[str, object]:
    """Valida el catálogo con el mismo contrato de tipos e idiomas que la web.

    Returns:
        Recuento y revisión declarada; los datos del catálogo no se transforman.

    Raises:
        FormatoInesperado: Si Node falta, vence su plazo o el contrato rechaza la entrada.
    """
    try:
        resultado = subprocess.run(
            ["node", str(PUENTE), str(CATALOGO)],
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=PLAZO_NODE_S,
        )
    except subprocess.TimeoutExpired as error:
        raise FormatoInesperado("lecturas: Node superó el plazo de validación local") from error
    except OSError as error:
        raise FormatoInesperado("lecturas: no se pudo ejecutar Node local") from error
    if resultado.returncode:
        raise FormatoInesperado("lecturas: contrato TypeScript rechazado: " + resultado.stderr.strip())
    try:
        resumen: object = json.loads(resultado.stdout)
    except ValueError as error:
        raise FormatoInesperado("lecturas: respuesta no JSON del validador local") from error
    if not isinstance(resumen, dict):
        raise FormatoInesperado("lecturas: respuesta inesperada del validador local")
    return resumen


def _revision(procedencia: dict[str, object], resumen: dict[str, object]) -> str | None:
    """Exige una fecha editorial declarada sin confundirla con fechas de cada lectura.

    Returns:
        Fecha ISO original del campo revisado, o None si se declara desconocida.

    Raises:
        FormatoInesperado: Si no es una fecha completa o difiere de la procedencia.
    """
    revision = resumen.get("revisado")
    if "revision_declarada" not in procedencia or revision != procedencia["revision_declarada"]:
        raise FormatoInesperado("lecturas: revisión editorial distinta de su procedencia")
    if revision is None:
        return None
    if not isinstance(revision, str):
        raise FormatoInesperado("lecturas: revisión editorial no es una fecha o nulo")
    try:
        canonica = date.fromisoformat(revision).isoformat()
    except ValueError as error:
        raise FormatoInesperado("lecturas: revisión editorial no es una fecha ISO completa") from error
    if canonica != revision:
        raise FormatoInesperado("lecturas: revisión editorial no es una fecha ISO completa")
    return revision


def _huellas() -> dict[str, str]:
    """Firma cada entrada y contrato efectivo con rutas portables del repositorio.

    Returns:
        Rutas relativas estables y sus SHA-256.
    """
    recursos = {
        "plataforma_datos/biblioteca/fuentes/lecturas/catalogo.json": CATALOGO,
        "plataforma_datos/biblioteca/fuentes/lecturas/procedencia.json": PROCEDENCIA,
        "plataforma_datos/biblioteca/fuentes/lecturas/fuente.json": DESCRIPTOR,
        "plataforma_datos/biblioteca/fuentes/lecturas/lector.py": Path(__file__).resolve(),
        "plataforma_datos/biblioteca/fuentes/lecturas/validar_catalogo.ts": PUENTE,
        **{ruta: RAIZ / ruta for ruta in CONTRATOS_TS},
    }
    return {nombre: sha256(ruta) for nombre, ruta in recursos.items()}


def _entradas() -> Entradas:
    """Verifica autoría, huella, metadatos editoriales y el contrato TS real.

    Returns:
        Entradas vinculadas a los bytes leídos.

    Raises:
        FormatoInesperado: Si la procedencia, la huella o el resumen no son coherentes.
    """
    huellas = _huellas()
    descriptor()
    procedencia = _objeto(PROCEDENCIA)
    contenido = CATALOGO.read_bytes()
    if (
        type(procedencia.get("schema_version")) is not int
        or procedencia.get("schema_version") != 1
        or procedencia.get("tipo") != "catalogo-editorial-versionado"
        or procedencia.get("archivo") != "catalogo.json"
        or procedencia.get("sha256") != sha256_bytes(contenido)
        or procedencia.get("plazo_vigencia_dias") is not None
    ):
        raise FormatoInesperado("lecturas: procedencia editorial o huella no coincide")
    resumen = _contrato_ts()
    revision = _revision(procedencia, resumen)
    total = resumen.get("lecturas")
    if type(total) is not int or total <= 0:
        raise FormatoInesperado("lecturas: recuento inesperado del contrato TS")
    if _huellas() != huellas:
        raise FormatoInesperado("lecturas: entrada o contrato cambió durante la comprobación")
    return Entradas(contenido, revision, total, huellas)


def _guardar_bytes(ruta: Path, contenido: bytes) -> None:
    """Reemplaza con un temporal propio cerrado; si los bytes coinciden no reescribe."""
    if ruta.exists() and ruta.read_bytes() == contenido:
        return
    ruta.parent.mkdir(parents=True, exist_ok=True)
    temporal = None
    try:
        with temporal_hermano(ruta.parent, prefijo=f".{ruta.name}-") as archivo:
            temporal = Path(archivo.name)
            archivo.write(contenido)
        temporal.replace(ruta)
    finally:
        if temporal is not None:
            temporal.unlink(missing_ok=True)


def _guardar_informe(informe: dict[str, object]) -> None:
    """Conserva bytes, fecha y mtime del informe si el resultado no ha cambiado."""
    ruta = carpetas(FUENTE).validacion
    if ruta.exists():
        previo = _objeto(ruta)
        previo.pop("comprobado_utc", None)
        actual = {k: v for k, v in informe.items() if k != "comprobado_utc"}
        if previo == actual:
            return
    guardar_validacion(ruta, informe)


def descargar() -> None:
    """No consulta la red: explica la edición manual y comprueba los recursos en git."""
    _entradas()
    print("lecturas: catálogo editorial local; revisar catálogo y procedencia en git, sin descarga automática")


def preparar() -> None:
    """Comprueba las entradas y conserva sus bytes en la casa operativa aislable."""
    entradas = _entradas()
    _guardar_bytes(carpetas(FUENTE).preparado / "lecturas.json", entradas.contenido)
    print(f"lecturas: {entradas.total} lecturas preparadas sin transformar")


def validar() -> None:
    """Admite únicamente los bytes editoriales preparados y firma sus contratos actuales.

    Raises:
        ValidacionFallida: Si el preparado no reproduce el catálogo actual.
    """
    entradas = _entradas()
    preparado = carpetas(FUENTE).preparado / "lecturas.json"
    if preparado.read_bytes() != entradas.contenido:
        raise ValidacionFallida("lecturas: preparado distinto del catálogo editorial actual")
    controles = Controles()
    controles.comprobar(True, "procedencia y huella editorial coherentes")
    controles.comprobar(True, "contratos TypeScript de tipos, idiomas, referencias e IDs")
    controles.comprobar(True, "preparado idéntico byte a byte al catálogo editorial")
    informe = {
        "estado": "Admitido",
        "comprobado_utc": ahora_utc(),
        "entradas": entradas.huellas,
        "conjunto_sha256": sha256_bytes(entradas.contenido),
        "cobertura": {"lecturas": entradas.total},
        "revision_editorial": {
            "fecha_declarada": entradas.revision,
            "alcance": "Campo revisado del registro; las fechas individuales no se sustituyen.",
            "plazo_vigencia_dias": None,
            "estado": "vigencia_no_acreditada_revision_pendiente",
        },
        "comprobacion_remota": False,
        "limites": "Admisión estructural editorial; no acredita vigencia de enlaces o publicaciones externas.",
        "controles": controles.lista,
    }
    _guardar_bytes(carpetas(FUENTE).validado / "lecturas.json", entradas.contenido)
    _guardar_informe(informe)
    controles.imprimir()


def exportar(destino: Path) -> Path:
    """Entrega bytes admitidos a un destino explícito con reemplazo atómico local.

    Returns:
        El destino solicitado, sin reescritura si ya contiene los mismos bytes.

    Raises:
        ValidacionFallida: Si cambió una entrada, un contrato o el conjunto validado.
    """
    entradas = _entradas()
    informe = exigir_admitido(FUENTE)
    validado = carpetas(FUENTE).validado / "lecturas.json"
    contenido = validado.read_bytes()
    if (
        informe.get("entradas") != entradas.huellas
        or informe.get("conjunto_sha256") != sha256_bytes(contenido)
        or contenido != entradas.contenido
    ):
        raise ValidacionFallida("lecturas: admisión desactualizada o conjunto alterado; preparar y validar de nuevo")
    _guardar_bytes(Path(destino), contenido)
    return destino


def main(argv: list[str] | None = None) -> int:
    """Ejecuta las etapas locales con la interfaz común; exportar requiere destino en Python.

    Returns:
        Código de salida de la orden común.
    """
    return principal_fuente(__doc__, {"descargar": descargar, "preparar": preparar, "validar": validar}, argv)


if __name__ == "__main__":
    sys.exit(main())
