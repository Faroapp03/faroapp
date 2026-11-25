"""La tabla completa del ODEE y la Cambra (`datos/cambra.json`): privada, fuera del paquete y fijada por su huella.

El permiso del ODEE y la Cambra cubre mostrar en Faro el nivel de exposición agregado, no repartir su tabla. El paquete
solo lleva esa parte pública (`exposicion-cambra.json`, exportacion.py); la tabla completa solo la necesitan las pruebas
que comprueban los cálculos del estudio. No está en Git: quien las ejecuta la recibe aparte y la comprueba contra la
huella que el manifiesto versionado (`datos/manifiesto.json`) registra como origen de la parte pública. La integración
continua la recupera del almacén privado, donde cada generación guarda sus archivos por contenido. En el ciclo de
actualización no hay copia aparte: vale el conjunto validado que la cadena acaba de admitir, por la misma huella.

Esta es la única regla para encontrarla: las pruebas Python la leen con `leer` y las de Node piden su ruta con la orden
`ruta` (pruebas/paquetes/tabla-privada-cambra.ts).

Uso: python3 -m plataforma_datos.ia_y_trabajo.fuentes.cambra.tabla_privada {comprobar,recuperar,ruta} [--raiz RAIZ]
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

from plataforma_datos.comun.entrada_salida import sha256
from plataforma_datos.comun.nucleo import RAIZ, ErrorFuente
from plataforma_datos.ia_y_trabajo.fuentes.cambra.exportacion import ARCHIVO_PUBLICO
from plataforma_datos.orquestacion.almacen_s3 import AlmacenS3
from plataforma_datos.orquestacion.transferir_generacion import configuracion_privada

ARCHIVO = "cambra.json"
RUTA = Path("datos") / ARCHIVO
MANIFIESTO = Path("datos") / "manifiesto.json"
# Así registra el manifiesto el conjunto validado del que sale la parte pública: su huella es la de la tabla completa.
ORIGEN = "var/actualizacion/validados/cambra/cambra.json"
# Dónde se busca, por este orden: la copia recibida aparte y, si no vale o no está, el conjunto validado.
CANDIDATAS = (RUTA, Path(ORIGEN))
# La tabla ocupa unas decenas de kilobytes: un objeto mayor no es ella.
MAX_BYTES = 1024**2
SHA256 = re.compile(r"[0-9a-f]{64}")
COMO_OBTENERLA = (
    "Solo la usan las pruebas de los cálculos del estudio, y no está en el repositorio porque el permiso del ODEE y la "
    "Cambra no cubre repartirla. Pide la copia a Equipo Faro "
    "o recupérala del almacén privado con `.venv/bin/python -m plataforma_datos.ia_y_trabajo.fuentes.cambra."
    "tabla_privada recuperar` (datos/README.md, «cambra.json»)."
)
ERROR_ALMACEN = "No se pudo recuperar datos/cambra.json del almacén privado: comprueba sus tres secretos y su huella."
ERROR_MANIFIESTO = "No se pudo leer datos/manifiesto.json: es el archivo versionado que fija la huella de la tabla."


class TablaPrivadaAusente(ErrorFuente):
    """No están ni `datos/cambra.json` ni el conjunto validado del que sale la parte pública."""


class TablaPrivadaDistinta(ErrorFuente):
    """Ninguna de las tablas presentes es el archivo que fija el manifiesto."""


def huella_fijada(raiz: Path) -> str:
    """La huella SHA-256 de la tabla: la del origen de la parte pública en el manifiesto versionado del paquete.

    Returns:
        La huella en 64 cifras hexadecimales.

    Raises:
        ErrorFuente: Si el manifiesto no fija una huella válida para la tabla.
    """
    entrada = json.loads((raiz / MANIFIESTO).read_text(encoding="utf-8")).get(ARCHIVO_PUBLICO)
    origenes = entrada.get("origenes") if isinstance(entrada, dict) else None
    huella = origenes.get(ORIGEN) if isinstance(origenes, dict) else None
    if not isinstance(huella, str) or SHA256.fullmatch(huella) is None:
        raise ErrorFuente(f"{MANIFIESTO} no fija la huella de {RUTA}.")
    return huella


def comprobar(raiz: Path) -> Path:
    """Comprueba que la instalación tiene la tabla fijada por el manifiesto.

    Returns:
        La ruta de la tabla comprobada.

    Raises:
        TablaPrivadaAusente: Si no está ni la copia ni el conjunto validado.
        TablaPrivadaDistinta: Si ninguna de las que hay tiene la huella fijada.
    """
    # La copia recibida aparte o, donde la cadena de datos acaba de admitirla (el ciclo de actualización), el propio
    # conjunto validado: es el origen que nombra el manifiesto, y su huella decide igual.
    presentes = [candidata for candidata in CANDIDATAS if (raiz / candidata).is_file()]
    if not presentes:
        raise TablaPrivadaAusente(
            f"Falta {RUTA}, la tabla del ODEE y la Cambra de Comerç de Barcelona, y tampoco está su conjunto validado "
            f"({ORIGEN}). {COMO_OBTENERLA}"
        )
    huella = huella_fijada(raiz)
    for ruta in presentes:
        if sha256(raiz / ruta) == huella:
            return raiz / ruta
    nombres = " ni ".join(ruta.as_posix() for ruta in presentes)
    verbo = "es" if len(presentes) == 1 else "son"
    raise TablaPrivadaDistinta(
        f"{nombres} no {verbo} la tabla que fija {MANIFIESTO} (su huella es otra). Sustitúyela por la copia "
        f"verificada. {COMO_OBTENERLA}"
    )


def leer(raiz: Path) -> dict[str, Any]:
    """Lee la tabla después de comprobarla.

    Returns:
        El conjunto de la Cambra tal como lo exportó la cadena de datos.
    """
    return json.loads(comprobar(raiz).read_text(encoding="utf-8"))


def recuperar(raiz: Path, entorno: dict[str, str]) -> None:
    """Trae la tabla fijada del almacén privado si la instalación no la tiene; nunca sustituye una que ya está.

    Raises:
        TablaPrivadaDistinta: Si ya hay una tabla y no es la fijada.
    """
    destino = raiz / RUTA
    try:
        comprobar(raiz)
    except TablaPrivadaAusente:
        huella = huella_fijada(raiz)
    else:
        return
    # El almacén guarda cada archivo de una generación por su contenido y coteja la huella al descargarlo.
    with AlmacenS3(configuracion_privada(entorno)) as almacen:
        almacen.recuperar(f"blobs/{huella}", destino, huella, MAX_BYTES)
    comprobar(raiz)


def main(argv: list[str] | None = None) -> int:
    """CLI: comprobar la tabla de la instalación, recuperarla del almacén o dar su ruta. Nunca imprime su contenido.

    `ruta` escribe solo la ruta comprobada, relativa a la raíz: así la leen las pruebas de Node, con esta misma regla.

    Returns:
        Cero si la instalación queda con la tabla fijada; uno en otro caso.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("accion", choices=("comprobar", "recuperar", "ruta"))
    parser.add_argument("--raiz", type=Path, default=None, help="la instalación; por omisión, la de este repositorio")
    argumentos = parser.parse_args(argv)
    accion = argumentos.accion
    raiz = argumentos.raiz or RAIZ
    try:
        if accion == "recuperar":
            recuperar(raiz, dict(os.environ))
        ruta = comprobar(raiz).relative_to(raiz).as_posix()
    except ErrorFuente as error:
        print(error, file=sys.stderr)
        return 1
    except (OSError, ValueError):
        print(ERROR_ALMACEN if accion == "recuperar" else ERROR_MANIFIESTO, file=sys.stderr)
        return 1
    print(ruta if accion == "ruta" else f"{ruta}: es la tabla fijada por {MANIFIESTO}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
