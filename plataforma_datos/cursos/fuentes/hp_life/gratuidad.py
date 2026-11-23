"""Control de la declaración de gratuidad de HP LIFE: su ayuda en español dice que sus cursos son gratuitos.

La declaración es el encabezado literal «Los cursos de HP LIFE son gratuitos» de la página de ayuda
(`https://www.life-global.org/es/help`, en el JSON `staticHelpTopics`) con un párrafo que la dirige a todas las
personas. Cada consulta pide esa página. Si no responde, no se lee, no trae el encabezado o su texto ya no dice eso, la
declaración queda sin comprobar: es un fallo de método, no un hecho de la oferta. Faro no afirma entonces que los
cursos sean de pago ni gratuitos: las comprobaciones de los cursos de esa consulta quedan como fallos, la oferta
conserva lo último comprobado y no se renueva, la fuente queda sin acreditar entera y el panel recibe el aviso
`gratuidad-de-hp-life-sin-comprobar`.
"""

from collections.abc import Callable
from http import HTTPStatus

from plataforma_datos.cursos.fuentes.hp_life import lector
from plataforma_datos.cursos.fuentes.hp_life.recepciones import leer_recepcion
from plataforma_datos.cursos.tipos_json import ObjetoJson

URL_AYUDA = "https://www.life-global.org/es/help"
AVISO = "gratuidad-de-hp-life-sin-comprobar"
MOTIVO_DE_FALLO = "declaracion_de_gratuidad_no_comprobada"


def estado(captura: ObjetoJson | None, leer: Callable[[ObjetoJson], bytes]) -> ObjetoJson | None:
    """Lee la página de ayuda de ayuda de una consulta y dice si la declaración sigue intacta.

    Returns:
        `intacta` y la captura de la página, o None si la consulta no pidió la página de ayuda.
    """
    if captura is None:
        return None
    if captura.get("cuerpo") is None or captura.get("recibo") is None:
        return {"intacta": False, "captura": captura}
    try:
        recepcion = leer_recepcion(leer(captura["cuerpo"]), leer(captura["recibo"]))
        if recepcion.captura.http != HTTPStatus.OK or recepcion.captura.completo is not True:
            return {"intacta": False, "captura": captura}
        condiciones = lector.extraer_condiciones_generales(recepcion.cuerpo, recepcion.captura)
    except lector.ErrorFichaHpLife:
        return {"intacta": False, "captura": captura}
    return {"intacta": bool(condiciones.destinatarios), "captura": captura}


def motivo_de_alta_pendiente(intacta: bool | None) -> str:
    """Dice por qué una alta queda pendiente: por la gratuidad sin comprobar o porque nada la acredita.

    Returns:
        El motivo que lleva el pendiente.
    """
    return MOTIVO_DE_FALLO if intacta is False else "alta sin ficha o sin índice que la acredite"


def condicionar(observacion: ObjetoJson, intacta: bool | None) -> ObjetoJson:
    """Deja la comprobación de un curso como fallo de método si la declaración de gratuidad no está intacta.

    No afirma nada de su gratuidad: el fallo conserva las evidencias y toma una identidad propia.

    Returns:
        La observación tal cual, o con resultado fallo y su motivo si `intacta` es falso.
    """
    if intacta is not False:
        return observacion
    return {
        **observacion,
        "id": observacion["id"] + ":" + MOTIVO_DE_FALLO,
        "resultado": "fallo",
        "detalle": {"motivo": MOTIVO_DE_FALLO},
    }
