"""Confirma las fichas de Citilab que se quedan sin fecha de fin tras revisar su texto.

Una persona abre fechas-pendientes-de-confirmacion.json, revisa en citilab.eu cada ficha y, si su texto de verdad no
da un fin legible, pasa la huella de la lista revisada. Después se vuelve a ejecutar `validar` de Citilab.

Uso: python3 -m plataforma_datos.cursos.fuentes.citilab.confirmar_fechas HUELLA
"""

import argparse
import sys

from plataforma_datos.comun.entrada_salida import carpetas
from plataforma_datos.cursos.fuentes.citilab.constantes import FUENTE
from plataforma_datos.cursos.fuentes.citilab.lectura_de_fechas import confirmar
from plataforma_datos.orquestacion.ordenes import con_motivo


def main(argv: list[str] | None = None) -> int:
    """Confirma la lista pendiente con el tratamiento común de errores.

    Returns:
        El código de salida: 0 si se confirma y 1 si no hay lista pendiente o no es la revisada.
    """
    analizador = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    analizador.add_argument("huella", help="huella de la lista revisada (campo huella de las fichas pendientes)")
    huella = analizador.parse_args(argv).huella

    def confirmar_lista() -> None:
        print(f"Fichas confirmadas: {confirmar(carpetas(FUENTE).original, huella)}")

    return con_motivo(confirmar_lista)


if __name__ == "__main__":
    sys.exit(main())
