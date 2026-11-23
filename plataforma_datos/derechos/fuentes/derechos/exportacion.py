"""Proyección de derechos: publica las citas utilizadas por el informe, conservando su origen validado."""

from plataforma_datos.comun.entrada_salida import ruta_del_conjunto
from plataforma_datos.comun.nucleo import exigir
from plataforma_datos.orquestacion.admision import leer_validado
from plataforma_datos.orquestacion.exportacion.comun import Paquete


def paquete_derechos() -> Paquete:
    """Selecciona las citas de formación y tecnología, sin exportar pasajes CRL ni cláusulas sectoriales.

    Returns:
        El paquete selectivo y el conjunto validado completo como único origen.
    """
    validado = leer_validado("derechos")
    exigir(isinstance(validado, dict), "derechos: el conjunto validado no es un objeto")
    tecnologia = validado.get("tecnologia")
    exigir(
        isinstance(validado.get("citas"), list)
        and isinstance(tecnologia, dict)
        and isinstance(tecnologia.get("citas"), list),
        "derechos: el conjunto validado no trae sus dos listas de citas",
    )
    datos = {"citas": validado["citas"], "tecnologia": {"citas": tecnologia["citas"]}}
    return Paquete(datos, [ruta_del_conjunto("derechos")])
