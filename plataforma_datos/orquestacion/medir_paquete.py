"""Mide la fase del paquete sola, sobre lo publicado en esta instalación, para conocer su duración en el Mac.

Orden, desde la raíz del repositorio:

    .venv/bin/python -m plataforma_datos.orquestacion.medir_paquete

Copia la instalación a un área de ensayo temporal, ejecuta en ella solo las órdenes del paquete
(`ordenes_de_la_actualizacion.ORDENES_DEL_PAQUETE`) con el mismo ejecutor y los mismos topes que el ciclo, escribe lo
que tardó cada paso y borra el área. No ejecuta ninguna orden de las fuentes, así que no descarga nada: el paquete se
compone con lo que ya está publicado. Es un ensayo: nada de lo publicado se sustituye.

La medida que sirve para el plazo del motor es la del runner; esta orden da la del Mac, para comparar y para saber qué
paso pesa más antes de lanzar un ciclo real.
"""

import argparse
import shutil
import tempfile
from pathlib import Path

from plataforma_datos.comun.nucleo import RAIZ
from plataforma_datos.orquestacion.actualizar import Ejecutor, Opciones, Paso, ejecutar_orden, ejecutar_paquete
from plataforma_datos.orquestacion.area_de_ensayo import comprobar_area, preparar_area
from plataforma_datos.orquestacion.estado_de_la_actualizacion import ResultadoDelModulo


def medir(raiz: Path, ejecutor: Ejecutor = ejecutar_orden) -> tuple[list[Paso], ResultadoDelModulo]:
    """Ejecuta la fase del paquete en un área de ensayo propia y la borra al terminar.

    Returns:
        Los pasos con sus segundos y el resultado que habría tenido el paquete.
    """
    carpeta = Path(tempfile.mkdtemp(prefix="faro-medir-paquete-"))
    area = carpeta / "repositorio"
    try:
        comprobar_area(raiz, area)
        preparar_area(raiz, area)
        pasos, _comparacion, resultado = ejecutar_paquete(raiz, area, ejecutor, Opciones(ensayo=True))
    finally:
        shutil.rmtree(carpeta)
    return pasos, resultado


def main(argv: list[str] | None = None) -> int:
    """Mide la fase del paquete y escribe los minutos de cada paso.

    Returns:
        Cero si todos los pasos terminaron bien; uno si alguno falló (el último escrito es el que falló).
    """
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--raiz", type=Path, default=RAIZ, help="instalación cuya fase del paquete se mide")
    argumentos = parser.parse_args(argv)
    pasos, resultado = medir(argumentos.raiz.resolve())
    for paso in pasos:
        print(f"{paso.nombre}: {paso.segundos / 60:.1f} min (código {paso.codigo})")
    print(f"Total: {sum(paso.segundos for paso in pasos) / 60:.1f} min. Paquete: {resultado.veredicto}.")
    return 0 if pasos and all(paso.en_verde for paso in pasos) else 1


if __name__ == "__main__":
    raise SystemExit(main())
