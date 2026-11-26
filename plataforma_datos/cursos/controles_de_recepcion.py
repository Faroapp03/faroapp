"""Clasificación de los fallos de consulta y criterios de admisión de recepciones de Cursos."""

from http import HTTPStatus

from plataforma_datos.cursos.tipos_json import ObjetoJson

# Fuentes cuya consulta es una URL por unidad: el fallo de una no anula a las demás.
FALLOS_POR_UNIDAD = frozenset({"hp_life", "claude_academy"})
# Respuestas que no contradicen la oferta: el evaluador común las trata como fallo de consulta.
CODIGOS_FALLO_CONSULTA = frozenset(
    {
        HTTPStatus.UNAUTHORIZED,
        HTTPStatus.FORBIDDEN,
        HTTPStatus.PROXY_AUTHENTICATION_REQUIRED,
        HTTPStatus.REQUEST_TIMEOUT,
        HTTPStatus.TOO_MANY_REQUESTS,
    }
)


def codigo_de_fallo(http: int | None) -> bool:
    """Indica si un código HTTP (o su ausencia) es un fallo de consulta, no un hecho de la oferta.

    Returns:
        True ante transporte sin respuesta, 3xx, 5xx o bloqueos de autenticación o ritmo.
    """
    return (
        http is None
        or http in CODIGOS_FALLO_CONSULTA
        or http >= HTTPStatus.INTERNAL_SERVER_ERROR
        or HTTPStatus.MULTIPLE_CHOICES <= http < HTTPStatus.BAD_REQUEST
    )


def fallo_de_consulta(lectura: ObjetoJson) -> bool:
    """Clasifica una lectura de unidad como fallo de su consulta.

    Returns:
        True si no hubo respuesta, fue incompleta o su código es un fallo de consulta.
    """
    return "fallo" in lectura or lectura["completo"] is not True or codigo_de_fallo(lectura["http"])


def respuestas_interpretables(fuente: str, conjunto: ObjetoJson) -> bool:
    """Comprueba que las recepciones admitidas cumplen el contrato de su fuente.

    Returns:
        Verdadero si se puede interpretar el conjunto con su cobertura declarada.
    """
    # Un censo incompleto solo se admite como consulta parcial declarada: lo no visto no se lee como ausencia.
    if fuente == "barcelonactiva" and conjunto.get("censo_completo") is not True and "consulta_parcial" not in conjunto:
        return False
    if fuente == "fundae":
        # Un índice caído no anula los otros: queda como fallo de consulta de sus unidades.
        caidos = {f["canal"] for f in conjunto["fallos"]}
        return (
            all(f["http"] == HTTPStatus.OK or codigo_de_fallo(f["http"]) for f in conjunto["fallos"])
            and bool(caidos) == ("consulta_parcial" in conjunto)
            and not caidos & set(conjunto["cobertura"])
            and set(conjunto["cobertura"]) | caidos == {"catalogos", "digitalizate", "subvencionada"}
            and all(type(n) is int and n > 0 for n in conjunto["cobertura"].values())
            and bool({"digitalizate", "subvencionada"} & set(conjunto["cobertura"]))
            # Tras una siembra no hay entidades que observar: entonces bastan las altas del censo completo.
            and bool(conjunto["observaciones_catalogo"] or conjunto.get("censo", {}).get("altas"))
        )
    # Solo HP tiene un puente revisado para la retirada explícita por 404/410.
    # Una denegación o redirección no es una comprobación válida de ninguna fuente.
    admitidos = (HTTPStatus.OK, HTTPStatus.NOT_FOUND, HTTPStatus.GONE) if fuente == "hp_life" else (HTTPStatus.OK,)
    filas = [*conjunto.get("pendientes", []), *conjunto["recepciones"]]
    validas = [
        f["lectura"]["completo"] is True and f["lectura"]["http"] in admitidos and "fallo" not in f["lectura"]
        for f in filas
    ]
    if fuente in FALLOS_POR_UNIDAD:
        # Un fallo de consulta es la observación de fallo de su unidad, no una lectura inválida.
        fallos = [fallo_de_consulta(f["lectura"]) for f in filas]
        return any(validas) and all(v or f for v, f in zip(validas, fallos, strict=True))
    return bool(validas) and all(validas)
