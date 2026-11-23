"""Observación de un fallo de consulta: el intento de leer una unidad conocida que no obtuvo una respuesta válida.

El fallo solo informa del intento: no aporta cuerpo, no retira la oferta y no renueva la última comprobación válida
de la unidad. Cada fuente valida su intento y calcula el `id` con su propio método, que no cambia, porque el
registro de vigencia deduplica por él; aquí solo se ensambla la entrada del evaluador común (`vigencia`), con el
recibo del intento como evidencia de diagnóstico.
"""

from typing import Literal

from plataforma_datos.cursos.tipos_json import ObjetoJson


def observacion_de_fallo(  # noqa: PLR0913 - Cada dato del intento, explícito y con nombre.
    *,
    id: str,
    intentado_el: str,
    terminado_el: str,
    url: str,
    motivo: str,
    sha256: str,
    localizador: Literal["/error", "/http"],
) -> ObjetoJson:
    """Ensambla el fallo de consulta con el intervalo real del intento.

    Args:
        id: Identidad de la observación, calculada por la fuente con su método.
        intentado_el: Inicio del intento, en UTC.
        terminado_el: Fin del intento, en UTC; también es la captura de la evidencia.
        url: Dirección consultada.
        motivo: Motivo del fallo, propio de la fuente.
        sha256: Huella del recibo del intento.
        localizador: `/error` si el intento no tuvo respuesta; `/http` si la tuvo y no era válida.

    Returns:
        Entrada del evaluador común.
    """
    return {
        "id": id,
        "tipo": "ficha",
        "intentado_el": intentado_el,
        "terminado_el": terminado_el,
        "resultado": "fallo",
        "url_consultada": url,
        "detalle": {"motivo": motivo},
        "evidencias": [
            {
                "alcance": "diagnostico",
                "url": url,
                "capturado_utc": terminado_el,
                "sha256": sha256,
                "localizador": {"tipo": "campo", "valor": localizador},
            }
        ],
    }
