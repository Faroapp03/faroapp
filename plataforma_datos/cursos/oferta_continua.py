"""Contrato explícito de oferta publicada continua, distinto de acceso sin registro.

El adaptador debe contrastar cada declaración y su alcance; este contrato liga
sus criterios a evidencia localizada. No interpreta lenguaje, títulos, marcas
o HTTP200 genérico. No crea plazos, gratuidad de prácticas o admisión personal.
"""

from plataforma_datos.cursos.tipos_json import ObjetoJson

METODO = "oferta-publicada-continua-1"
CAMPO = "oferta_publicada_continua"
CRITERIOS = (
    "curso_completo",
    "formacion_gratuita",
    "cta_identificado",
    "destino_identificado",
    "destinatarios_constatados",
    "requisitos_constatados",
)


class ErrorOfertaContinua(ValueError):
    """La declaración o su vínculo con las evidencias no conserva el contrato."""


def _exigir(condicion: object, mensaje: str) -> None:
    if not condicion:
        raise ErrorOfertaContinua(mensaje)


def validar(observacion: ObjetoJson, oferta: ObjetoJson) -> None:
    """Exige criterios explícitos y apoyos localizados de la misma identidad.

    Returns:
        None tras validar; no interpreta o concede una oferta por sí mismo.

    Raises:
        ErrorOfertaContinua: Si hay campos, tipos, identidad o apoyos no verificables.
    """
    declaracion = observacion["detalle"][CAMPO]
    _exigir(
        isinstance(declaracion, dict) and set(declaracion) == {"version", "metodo", "curso_id", "criterios"},
        "Declaración continua incompatible",
    )
    _exigir(
        type(declaracion["version"]) is int
        and declaracion["version"] == 1
        and declaracion["metodo"] == METODO
        and declaracion["curso_id"] == oferta["id"],
        "Método o identidad de oferta continua distinto",
    )
    criterios = declaracion["criterios"]
    _exigir(isinstance(criterios, dict) and set(criterios) == set(CRITERIOS), "Criterios continuos incompletos")
    evidencias = observacion["evidencias"]
    _exigir(isinstance(evidencias, list), "Evidencias continuas deben ser una lista")
    for criterio in criterios.values():
        _exigir(isinstance(criterio, dict) and set(criterio) == {"valor", "apoyos"}, "Criterio continuo incompatible")
        _exigir(criterio["valor"] is None or type(criterio["valor"]) is bool, "Criterio requiere booleano o null")
        apoyos = criterio["apoyos"]
        _exigir(
            isinstance(apoyos, list)
            and all(type(i) is int and 0 <= i < len(evidencias) for i in apoyos)
            and len(apoyos) == len(set(apoyos)),
            "Índices de apoyo no válidos",
        )
        _exigir(criterio["valor"] is not True or bool(apoyos), "Criterio positivo sin apoyo")
        _exigir(
            all(
                isinstance(evidencias[i], dict)
                and evidencias[i].get("alcance") == "disponibilidad"
                and evidencias[i].get("localizador") is not None
                and isinstance(evidencias[i].get("url"), str)
                for i in apoyos
            ),
            "Apoyo sin alcance o localizador de disponibilidad",
        )


def urls_apoyadas(observacion: ObjetoJson) -> set[str]:
    """Selecciona únicamente las URL de los apoyos declarados, sin consultarlas.

    Returns:
        URL que aún deberán pasar la validación pública y temporal común.
    """
    criterios = observacion["detalle"][CAMPO]["criterios"]
    return {observacion["evidencias"][i]["url"] for c in criterios.values() for i in c["apoyos"]}


def acreditada(detalle: ObjetoJson) -> bool:
    """No sustituye un desconocido, una muestra o una contradicción por apertura.

    Returns:
        True solo si están constatados los seis criterios versionados.
    """
    declaracion = detalle.get(CAMPO)
    return isinstance(declaracion, dict) and all(declaracion["criterios"][k]["valor"] is True for k in CRITERIOS)
