"""Confirma la oferta del SOC que quedó pendiente por perder demasiados cursos frente a la copia anterior.

Una persona revisa antes las cifras de soc-cursos-pendiente-de-confirmacion.json (cursos de la oferta y de la copia
anterior) y pasa la huella de la oferta revisada: si la pendiente es ya otra, no se confirma nada. La oferta se admite
con la fecha de su consulta remota, no con la de la confirmación.

Uso: python3 -m plataforma_datos.cursos.fuentes.formacion.confirmar_censo HUELLA
"""

import argparse
import hashlib
import sys

from plataforma_datos.comun.entrada_salida import carpetas, comprobar_originales, leer_json, procedencia
from plataforma_datos.comun.nucleo import Descarga, exigir
from plataforma_datos.cursos.fuentes.formacion import censo_soc, lector
from plataforma_datos.cursos.fuentes.formacion.constantes import FUENTE
from plataforma_datos.orquestacion.ordenes import con_motivo


def confirmar_censo_pendiente(huella: str) -> None:
    """Admite la oferta pendiente revisada como copia, con la fecha de su consulta remota.

    Args:
        huella: SHA-256 de la oferta que la persona ha revisado.

    Raises:
        FormatoInesperado: Si no hay oferta pendiente, si es otra que la revisada o si sus bytes ya no son los que
            registran sus cifras.
    """
    comprobar_originales(FUENTE)
    carpeta = carpetas(FUENTE).original
    exigir((carpeta / censo_soc.CIFRAS_PENDIENTE).is_file(), "SOC: no hay oferta pendiente de confirmación")
    cifras = leer_json(carpeta / censo_soc.CIFRAS_PENDIENTE)
    exigir(cifras["sha256"] == huella, "SOC: la oferta pendiente no es la revisada; revisa sus cifras otra vez")
    datos = (carpeta / censo_soc.OFERTA_PENDIENTE).read_bytes()
    exigir(hashlib.sha256(datos).hexdigest() == huella, "SOC: la oferta pendiente no coincide con sus cifras")
    descarga = Descarga(datos, lector.URL_OFERTA_SOC, "application/json")
    exigir(
        lector.comprobar_descarga_soc(descarga) == cifras["cursos"],
        "SOC: la oferta pendiente no coincide con sus cifras",
    )
    lector.conservar_oferta_soc(descarga, procedencia(FUENTE), cifras["comprobado_remoto_utc"], aceptar_cambio=True)
    censo_soc.retirar_pendiente()


def main(argv: list[str] | None = None) -> int:
    """Confirma la oferta pendiente con el tratamiento común de errores.

    Returns:
        El código de salida: 0 si se admite y 1 si no hay oferta pendiente válida o no es la revisada.
    """
    analizador = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    analizador.add_argument("huella", help="SHA-256 de la oferta revisada (campo sha256 de sus cifras)")
    huella = analizador.parse_args(argv).huella
    return con_motivo(lambda: confirmar_censo_pendiente(huella))


if __name__ == "__main__":
    sys.exit(main())
