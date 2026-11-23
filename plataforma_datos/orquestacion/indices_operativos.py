"""Índices propios de las carpetas operativas de una generación: deben coincidir con el manifiesto del paquete.

Los vectores del móvil y el clasificador declaran sus huellas en `huellas.json`; los recursos fijados, en el registro y
la captura ZIP de la que salen. La selección de la generación solo admite esas carpetas si sus índices y el manifiesto
dicen lo mismo.
"""

import hashlib
import stat
import zipfile
from pathlib import Path

from plataforma_datos.orquestacion.archivos_de_generacion import (
    ERROR_GENERICO,
    GeneracionInvalida,
    _camino,
    _exigir,
    _json,
)

# La captura conserva como registro la comprobación de enlaces de la forma sin versión, que sirve de punto de partida
# a la fuente `enlaces` y no se publica desde la captura. Solo los vectores son recursos fijados del paquete.
CAPTURAS_FIJADAS = frozenset({"vectores-formacion.json", "vectores-oit.json", "enlaces-comprobados.json"})
RECURSOS_FIJADOS_DEL_PAQUETE = CAPTURAS_FIJADAS - {"enlaces-comprobados.json"}
MAX_ENTRADA_CAPTURA = 128 * 1024 * 1024
MAX_DESCRIPCION_CAPTURA = 1024


def comprobar_indices_operativos(raiz: Path, manifiesto: dict, carpetas: set[str]) -> None:
    """Exige que el índice de cada carpeta operativa presente coincida con las huellas del manifiesto del paquete.

    Raises:
        GeneracionInvalida: Si un índice no coincide o la captura de los recursos fijados no se puede verificar.
    """
    for carpeta, salida in (("vectores-movil", "vectores-movil.json"),):
        if carpeta in carpetas:
            origenes = manifiesto[salida]["origenes"]
            esperado = {Path(n).name: sha for n, sha in origenes.items()}
            _exigir(_json(_camino(raiz, f"datos/{carpeta}/huellas.json")) == esperado)
    if "fuentes/clasificador" in carpetas:
        _exigir(
            _json(_camino(raiz, "datos/fuentes/clasificador/huellas.json"))
            == {
                "clasificador-movil.json": manifiesto["clasificador-movil.json"]["sha256"],
                "control.json": manifiesto["clasificador-movil.json"]["origenes"][
                    "datos/fuentes/clasificador/control.json"
                ],
            }
        )
    if "fuentes/recursos-fijados" in carpetas:
        _capturas_operativas(raiz, manifiesto)


def _capturas_operativas(raiz: Path, manifiesto: dict) -> None:
    carpeta = "datos/fuentes/recursos-fijados"
    registro = _json(_camino(raiz, f"{carpeta}/registro.json"))
    _exigir(isinstance(registro, dict) and set(registro) == CAPTURAS_FIJADAS)
    for nombre, entrada in registro.items():
        _exigir(
            isinstance(entrada, dict)
            and set(entrada) == {"sha256", "tipo"}
            and isinstance(entrada["tipo"], str)
            and bool(entrada["tipo"])
            and len(entrada["tipo"]) <= MAX_DESCRIPCION_CAPTURA
        )
        _exigir(nombre not in RECURSOS_FIJADOS_DEL_PAQUETE or entrada["sha256"] == manifiesto[nombre]["sha256"])
    try:
        with zipfile.ZipFile(_camino(raiz, f"{carpeta}/captura.zip")) as captura:
            entradas = captura.infolist()
            _exigir(len(entradas) == len(CAPTURAS_FIJADAS) and {i.filename for i in entradas} == CAPTURAS_FIJADAS)
            for entrada in entradas:
                _exigir(
                    entrada.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)
                    and not entrada.flag_bits & 1
                    and 0 <= entrada.file_size <= MAX_ENTRADA_CAPTURA
                    and stat.S_IFMT(entrada.external_attr >> 16) in (0, stat.S_IFREG)
                )
                with captura.open(entrada) as archivo:
                    _exigir(hashlib.file_digest(archivo, "sha256").hexdigest() == registro[entrada.filename]["sha256"])
    except zipfile.BadZipFile as error:
        raise GeneracionInvalida(ERROR_GENERICO) from error
