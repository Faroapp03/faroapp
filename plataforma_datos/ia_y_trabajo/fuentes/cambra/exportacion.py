"""La parte pública de la tabla del ODEE y la Cambra: el nivel de exposición agregado de cada ocupación y su cita.

El permiso del ODEE y la Cambra cubre mostrar en Faro el nivel de exposición agregado, citándoles; no repartir su
tabla. Por eso el paquete que llega al navegador no es el conjunto validado: es una derivación con un contrato cerrado
(CONTRATO), sin puntuaciones, personas ocupadas ni desgloses. El conjunto completo se queda en los datos privados y
validados de la cadena, y el manifiesto lo registra como origen de esta parte.
"""

from typing import Any

from plataforma_datos.comun.entrada_salida import ruta_del_conjunto
from plataforma_datos.comun.nucleo import FormatoInesperado, exigir
from plataforma_datos.orquestacion.admision import leer_validado
from plataforma_datos.orquestacion.exportacion.comun import Paquete

FUENTE = "cambra"
ARCHIVO_PUBLICO = "exposicion-cambra.json"

# Lo único que lee el producto, campo a campo: la cita (fuente), los cortes de la escala, el nivel de cada grupo
# CNO-11 de tres cifras y el reparto por sexo que el estudio publica en su página 14, con esa página.
CAMPOS_DE_LA_ESCALA = ("cortes",)
CAMPOS_DE_CADA_OCUPACION = ("nivel",)
CAMPOS_DEL_GENERO = ("mujeres_exposicion_media_o_alta", "hombres_exposicion_media_o_alta", "pagina_impresa")
CONTRATO: dict[str, tuple[str, ...] | None] = {
    "fuente": None,
    "escala": CAMPOS_DE_LA_ESCALA,
    "ocupaciones_cno3": CAMPOS_DE_CADA_OCUPACION,
    "genero": CAMPOS_DEL_GENERO,
}


def _solo(origen: dict[str, Any], campos: tuple[str, ...], donde: str) -> dict[str, Any]:
    """Los campos pedidos de un objeto del conjunto, en ese orden; si falta uno, la exportación se detiene.

    Returns:
        Un objeto nuevo solo con esos campos y sus valores tal cual.
    """
    faltan = [campo for campo in campos if campo not in origen]
    exigir(not faltan, f"{FUENTE}: a {donde} le faltan {', '.join(faltan)}", FormatoInesperado)
    return {campo: origen[campo] for campo in campos}


def nivel_agregado(conjunto: dict[str, Any]) -> dict[str, Any]:
    """Deriva del conjunto validado la parte pública, con el contrato cerrado y sin transformar ningún valor.

    Args:
        conjunto: El conjunto validado de la Cambra, completo.

    Returns:
        La cita, la escala, el nivel de cada ocupación y el reparto por sexo publicado.

    Raises:
        FormatoInesperado: Si al conjunto le falta alguno de los campos del contrato.
    """
    exigir(isinstance(conjunto.get("fuente"), str), f"{FUENTE}: el conjunto no trae su cita", FormatoInesperado)
    return {
        "fuente": conjunto["fuente"],
        "escala": _solo(conjunto["escala"], CAMPOS_DE_LA_ESCALA, "la escala"),
        "ocupaciones_cno3": {
            codigo: _solo(fila, CAMPOS_DE_CADA_OCUPACION, f"la ocupación {codigo}")
            for codigo, fila in conjunto["ocupaciones_cno3"].items()
        },
        "genero": _solo(conjunto["genero"], CAMPOS_DEL_GENERO, "el reparto por sexo"),
    }


def campos_fuera_del_contrato(publico: dict[str, Any]) -> list[str]:
    """Los campos de un archivo público que el contrato no admite, con su ruta («genero.pagina_pdf»).

    Args:
        publico: El contenido del archivo público.

    Returns:
        Las rutas de los campos sobrantes, en orden; vacía si cumple el contrato.
    """
    sobrantes = [campo for campo in publico if campo not in CONTRATO]
    for campo, admitidos in CONTRATO.items():
        valor = publico.get(campo)
        if admitidos is None or not isinstance(valor, dict):
            continue
        objetos = valor.items() if campo == "ocupaciones_cno3" else [("", valor)]
        for codigo, objeto in objetos:
            prefijo = f"{campo}.{codigo}." if codigo else f"{campo}."
            sobrantes += [f"{prefijo}{clave}" for clave in objeto if clave not in admitidos]
    return sobrantes


def paquete_cambra() -> Paquete:
    """La parte pública del conjunto validado de la Cambra, con ese conjunto como origen.

    Returns:
        El contenido público y, como origen, el conjunto validado completo.
    """
    return Paquete(nivel_agregado(leer_validado(FUENTE)), [ruta_del_conjunto(FUENTE)])
