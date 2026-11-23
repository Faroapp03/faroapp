"""Reaudita una admisión histórica de Cursos en una copia privada de una generación autenticada."""

import hashlib
import re
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import replace
from pathlib import Path

from plataforma_datos.comun.entrada_salida import comprobar_huella
from plataforma_datos.cursos import admision_catalogo as admision
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.orquestacion.archivos_de_generacion import _camino, _exigir, _json, _propio

# Son identificadores del código que produjo el informe. Ninguna de estas rutas se abre ni se ejecuta.
RUTA_FIRMADA = re.compile(r"plataforma_datos/(?:[a-zA-Z0-9_-]+/)+[a-zA-Z0-9_-]+\.(?:py|json)")
HUELLA = re.compile(r"[0-9a-f]{64}")


def firma_anterior(raiz: Path, codigo_candidato: Path | None = None) -> dict[str, str] | None:
    """Lee un informe cuya integridad física ya se cotejó con el manifiesto.

    Returns:
        Firma histórica bien formada, o None si la comprobación estricta habitual es suficiente.
    """
    ruta = raiz / almacen.RUTA / "validacion.json"
    if not ruta.exists():
        return None
    _exigir(ruta.stat().st_size <= admision.MAX_INFORME)
    informe = _json(ruta)
    _exigir(isinstance(informe, dict))
    firma = informe.get("codigo_sha256")
    vigente = admision.firma_codigo()
    if codigo_candidato is not None:
        # Incluso un informe con la firma del ejecutor debe corresponder al checkout que leerá sus datos.
        for relativa, huella in vigente.items():
            fuente = _camino(codigo_candidato, relativa)
            _propio(fuente)
            comprobar_huella(fuente, huella)
    if firma == vigente:
        return None
    _exigir(isinstance(firma, dict) and "plataforma_datos/cursos/admision_catalogo.py" in firma)
    _exigir(all(RUTA_FIRMADA.fullmatch(k) and isinstance(v, str) and HUELLA.fullmatch(v) for k, v in firma.items()))
    return firma


@contextmanager
def admision_en_copia(copia: Path, huella_sellada: str | None, codigo_candidato: Path | None) -> Iterator[None]:
    """Presenta a los lectores nativos la admisión comprobada y solo la retiene en la copia de trabajo.

    Solo se usa en el directorio privado y exclusivo de la descarga o restauración, tras verificar su inventario.
    El destino de la auditoría queda fuera de la copia y cualquier fallo impide la promoción de esta.
    """
    anterior = firma_anterior(copia, codigo_candidato)
    if anterior is None:
        yield
        return
    _exigir(huella_sellada is not None)
    solicitud = almacen.solicitud(copia / almacen.RUTA)
    informe = solicitud.validacion_destino
    with tempfile.TemporaryDirectory(prefix=".admision-restaurada-", dir=copia.parent) as directorio:
        temporal = Path(directorio)
        lectura = temporal / "vigente.json"
        nuevo = admision.admitir_snapshot(replace(solicitud, validacion_destino=lectura))
        # El ancla externa acredita el informe histórico y su firma; la auditoría acredita cada uno de los demás
        # campos. Una cobertura, decisión, entrada o representación JSON distinta impide reutilizar la generación.
        _exigir(informe.read_bytes() == admision.bytes_json_admision({**nuevo, "codigo_sha256": anterior}))
        retener = False
        conservado = temporal / "historico.json"
        informe.rename(conservado)
        try:
            lectura.rename(informe)
            yield
            if codigo_candidato is not None:
                comprobar_huella(informe, hashlib.sha256(admision.bytes_json_admision(nuevo)).hexdigest())
                retener = True
        finally:
            if not retener:
                conservado.replace(informe)
                comprobar_huella(informe, huella_sellada)
