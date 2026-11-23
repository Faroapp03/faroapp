"""Extracción PDF aislada: texto extraído no acredita revisión visual ni identidad por sí solo."""

import hashlib
import io
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import BinaryIO

VERSION_PYPDF = "6.21.2"
MAX_BYTES = 8 * 1024 * 1024
MAX_PAGINAS = 20
MAX_CARACTERES = 1_000_000
MAX_STREAM = 4 * 1024 * 1024
MEMORIA_BYTES = 512 * 1024 * 1024
CPU_S = 5
PLAZO_S = 10
MAX_SALIDA = 8192


INTERVALO_RSS_S = 0.05
PLAZO_PS_S = 1
BYTES_POR_KIB = 1024


def _rss_bytes(pid: int) -> int | None:
    """Consulta solo el PID hijo propio; no simula cero si ps falla.

    Returns:
        RSS en bytes, o None cuando no pudo comprobarse.
    """
    try:
        resultado = subprocess.run(
            ["/bin/ps", "-o", "rss=", "-p", str(pid)],
            capture_output=True,
            text=True,
            timeout=PLAZO_PS_S,
            check=False,
        )
        valor = resultado.stdout.strip()
        if resultado.returncode or not valor.isascii() or not valor.isdigit():
            return None
        return int(valor) * BYTES_POR_KIB
    except (OSError, subprocess.TimeoutExpired):
        return None


def _supervisar(hijo: subprocess.Popen[bytes], salida: BinaryIO) -> str | None:
    """Vigila plazo/salida y RSS en macOS; es supervisión periódica, no techo estricto.

    Returns:
        Motivo de rechazo o None al terminar dentro del alcance de las cotas.
    """
    limite = time.monotonic() + PLAZO_S
    rss_visto = False
    while hijo.poll() is None:
        if time.monotonic() >= limite:
            return "pdf_plazo_excedido"
        if salida.tell() > MAX_SALIDA:
            return "pdf_limite_salida"
        if sys.platform == "darwin":
            memoria = _rss_bytes(hijo.pid)
            rss_visto = rss_visto or memoria is not None
            if memoria is None and hijo.poll() is None:
                return "pdf_memoria_no_verificable"
            if memoria is not None and memoria > MEMORIA_BYTES:
                return "pdf_memoria_excedida"
        time.sleep(INTERVALO_RSS_S)
    return _fin_supervision(limite, rss_visto)


def _fin_supervision(limite: float, rss_visto: bool) -> str | None:
    """Rechaza también una terminación tardía o sin muestra de memoria.

    Returns:
        Motivo de rechazo, o None si el final conserva las garantías declaradas.
    """
    if time.monotonic() >= limite:
        return "pdf_plazo_excedido"
    if sys.platform == "darwin" and not rss_visto:
        return "pdf_memoria_no_verificable"
    return None


def _proceso(cuerpo: bytes) -> dict[str, object]:
    """Usa archivos temporales propios para evitar bloqueos de pipes y recolecta siempre al hijo.

    Returns:
        Diagnóstico o salida JSON acotada del extractor.
    """
    with tempfile.TemporaryFile() as entrada, tempfile.TemporaryFile() as salida:
        entrada.write(cuerpo)
        entrada.seek(0)
        argv = [sys.executable, "-I", str(Path(__file__).resolve())]
        if sys.platform == "darwin":
            argv.append("--rss-supervisado")
        hijo = subprocess.Popen(argv, stdin=entrada, stdout=salida, stderr=subprocess.DEVNULL)
        try:
            fallo = _supervisar(hijo, salida)
            if fallo:
                return {"estado": fallo}
            if hijo.returncode:
                return {"estado": "pdf_extraccion_fallida"}
            salida.seek(0)
            datos = salida.read(MAX_SALIDA + 1)
            if len(datos) > MAX_SALIDA:
                return {"estado": "pdf_limite_salida"}
            documento: object = json.loads(datos)
            if isinstance(documento, dict) and isinstance(documento.get("estado"), str):
                return documento
            return {"estado": "pdf_extraccion_fallida"}
        finally:
            if hijo.poll() is None:
                hijo.kill()
            hijo.wait()


def extraer(cuerpo: bytes) -> dict[str, object]:
    """Extrae en hijo propio con cotas; no admite memoria desconocida ni contenido truncado.

    Returns:
        Diagnóstico explícito; límites o falta de dependencia nunca acreditan legibilidad.
    """
    if len(cuerpo) > MAX_BYTES:
        return {"estado": "pdf_limite_bytes"}
    try:
        return _proceso(cuerpo)
    except (OSError, ValueError):
        return {"estado": "pdf_extraccion_fallida"}


def _extraer(cuerpo: bytes) -> dict[str, object]:
    """Usa el pin exacto después de instalar las cotas del proceso.

    Returns:
        Huella del texto completo dentro de las cotas; nunca texto parcial como completo.

    Raises:
        ValueError: Si el parser instalado no corresponde al pin admitido.
    """
    import pypdf

    if pypdf.__version__ != VERSION_PYPDF:
        raise ValueError("version PDF no admitida")
    lector = pypdf.PdfReader(io.BytesIO(cuerpo), strict=True)
    if lector.is_encrypted:
        return {"estado": "pdf_cifrado"}
    if len(lector.pages) > MAX_PAGINAS:
        return {"estado": "pdf_limite_paginas"}
    textos: list[str] = []
    for pagina in lector.pages:
        contenido = pagina.get_contents()
        if contenido is not None and len(contenido.get_data()) > MAX_STREAM:
            return {"estado": "pdf_limite_contenido"}
        textos.append(pagina.extract_text() or "")
        if sum(map(len, textos)) > MAX_CARACTERES:
            return {"estado": "pdf_limite_texto"}
    texto = " ".join(" ".join(textos).split())
    if not texto:
        return {"estado": "pdf_sin_texto_extraible"}
    return {
        "estado": "legible_texto_extraido",
        "metodo": f"pypdf-{VERSION_PYPDF}-extract_text",
        "texto_sha256": hashlib.sha256(texto.encode()).hexdigest(),
        "caracteres": len(texto),
        "paginas": len(lector.pages),
        "revision_visual": False,
    }


def _limites() -> str:
    """Instala cotas solo en el hijo; macOS exige supervisor RSS real cuando AS falla.

    Returns:
        Método de protección de memoria efectivo.

    Raises:
        ValueError: Si falta techo AS y no existe supervisor explícito de macOS.
    """
    import resource

    _blando, duro = resource.getrlimit(resource.RLIMIT_AS)
    objetivo = min(MEMORIA_BYTES, duro) if duro != resource.RLIM_INFINITY else MEMORIA_BYTES
    metodo = "RLIMIT_AS_blando"
    try:
        resource.setrlimit(resource.RLIMIT_AS, (objetivo, duro))
    except ValueError:
        if sys.platform != "darwin" or sys.argv[1:] != ["--rss-supervisado"]:
            raise
        metodo = "RSS_supervisado_pausa_50ms_ps_max1s_no_techo_estricto"
    resource.setrlimit(resource.RLIMIT_CPU, (CPU_S, CPU_S))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_SALIDA, MAX_SALIDA))
    return metodo


def main() -> int:
    """Instala límites antes de leer o importar el parser; no confirma fallos de aislamiento.

    Returns:
        Cero con diagnóstico JSON acotado, incluso cuando no puede leerse el PDF.
    """
    try:
        proteccion = _limites()
        cuerpo = sys.stdin.buffer.read(MAX_BYTES + 1)
        resultado = {"estado": "pdf_limite_bytes"} if len(cuerpo) > MAX_BYTES else _extraer(cuerpo)
        resultado["proteccion_memoria"] = proteccion
    except ImportError:
        resultado = {"estado": "pdf_dependencia_no_disponible"}
    except Exception as error:
        # El hijo aísla un lector de documentos externos: cualquier fallo suyo es una extracción fallida. Solo sale la
        # clase del error, que no lleva rutas ni contenido del documento.
        resultado = {"estado": "pdf_extraccion_fallida", "tipo_error": type(error).__name__}
    print(json.dumps(resultado, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
