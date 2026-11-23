"""Traducciones vigentes y nombres oficiales, a partir de las entradas admitidas."""

import sys

from plataforma_datos.comun.entrada_salida import relativa, ruta_del_conjunto
from plataforma_datos.comun.fuentes.catalan.lector import TRADUCCIONES as TRADUCCIONES_CATALAN
from plataforma_datos.comun.fuentes.catalan.lector import archivos_validados as catalan_validado
from plataforma_datos.comun.fuentes.catalan.lector import combinar as combinar_catalan
from plataforma_datos.orquestacion.admision import exigir_admitido
from plataforma_datos.orquestacion.exportacion.comun import Paquete


def paquete_catalan() -> Paquete | None:
    """Compone el catalán opcional desde los mismos archivos cuya huella se ha comprobado.

    Las traducciones cuyo castellano ha cambiado se omiten: el motor conserva el texto
    castellano. Los nombres de grupos proceden del Idescat, no de las traducciones.

    Returns:
        El contenido con sus orígenes; None, con un aviso, si no hay carpeta de traducciones.
    """
    if not TRADUCCIONES_CATALAN.exists():
        print(f"Aviso: falta {relativa(TRADUCCIONES_CATALAN)}; sin traducciones al catalán", file=sys.stderr)
        return None
    archivos = catalan_validado()
    exigir_admitido("idescat")
    return Paquete(combinar_catalan(archivos=archivos), [*archivos, ruta_del_conjunto("idescat")])
