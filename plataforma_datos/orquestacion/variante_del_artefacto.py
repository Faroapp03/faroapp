"""Comprueba que el artefacto conservado es de la variante de Cloudflare que declara la instalación.

Solo lee su descriptor, que es pequeño: un artefacto de otra variante se rechaza sin descargarlo y sin ninguna
operación en Cloudflare.
"""

from typing import Any

from plataforma_datos.orquestacion.almacen_artefactos import leer_descriptor_artefacto
from plataforma_datos.orquestacion.almacen_trabajos import AlmacenTrabajos
from plataforma_datos.orquestacion.contrato_activacion import RechazoPrevioActivacion

ERROR_VARIANTE = (
    "Activación rechazada: la construcción conservada no es de la variante de Cloudflare declarada para esta "
    "instalación. No se ha subido nada; revisa FARO_CLOUDFLARE_VARIANTE y lanza una actualización nueva."
)


class VarianteNoAdmitida(RechazoPrevioActivacion):
    """El artefacto es de otra variante que la instalación: subirlo cambiaría su Worker principal por otro."""

    codigo = "despliegue_no_admitido"


def descriptor_de_la_variante(artefacto: dict[str, Any], variante: str, almacen: AlmacenTrabajos) -> dict[str, Any]:
    """Lee el descriptor del artefacto y exige que sea de la variante declarada.

    Returns:
        El descriptor validado.

    Raises:
        VarianteNoAdmitida: Si el descriptor es de otra variante o no declara ninguna.
    """
    descriptor = leer_descriptor_artefacto(
        artefacto["revisionCodigo"], artefacto["huellaPaquete"], artefacto["sha256Artefacto"], almacen
    )
    # Un descriptor sin variante no acredita ninguna: no se supone la privada ni la oficial.
    if descriptor.get("destino") != variante:
        raise VarianteNoAdmitida(ERROR_VARIANTE)
    return descriptor
