"""Qué dice cada consulta de un enlace y cuándo cambia lo que ve la persona, sin red ni disco.

Cada enlace guarda su última observación y la última que fue concluyente. Solo una respuesta que dice algo del enlace
es concluyente: una página que responde, un 404 o un 410 (la regla de `cursos/vigencia.py`: describen la dirección
consultada) o, en un programa, una respuesta que no es un PDF. Un corte de red, un plazo agotado, un 5xx o cualquier
otro código no dicen nada del enlace: se anotan y se conserva lo concluyente anterior. Ningún número de fallos seguidos
cambia lo que se enseña.

- webs y cursos: se ocultan mientras su última observación concluyente sea un 404 o un 410;
- programas: se enlaza el PDF mientras su última observación concluyente sea un PDF que responde.
"""

from typing import Any, Final

from plataforma_datos.cursos.vigencia import CODIGOS_ENLACE_NO_ENCONTRADO

PROGRAMAS: Final = "programas"
WEBS: Final = "webs"
CURSOS: Final = "cursos"
CONJUNTOS: Final = (WEBS, CURSOS, PROGRAMAS)

RESPONDE: Final = "responde"
NO_EXISTE: Final = "no-existe"
OTRO_CONTENIDO: Final = "otro-contenido"
INCONCLUYENTE: Final = "inconcluyente"
RESULTADOS: Final = (RESPONDE, NO_EXISTE, OTRO_CONTENIDO, INCONCLUYENTE)
# Por qué una consulta no concluyó: un corte, un plazo, un servidor caído o una respuesta que no dice nada del enlace.
# Un 404 o un 410 que llega tras una redirección a otro origen no es del enlace pedido: se anota sin concluir. Tampoco
# concluye un 404 de un dominio en el que esa porción ve desaparecer de golpe lo que se enseña (`porcion.py`).
MOTIVOS_INCONCLUYENTE: Final = ("red", "plazo", "servidor", "respuesta", "limite", "otro-origen", "anomalia-de-dominio")
CAMPOS_OBSERVACION: Final = ("observado_el", "resultado", "codigo_http", "url_final", "otro_origen", "huella", "motivo")

CODIGOS_NO_EXISTE: Final = frozenset(int(codigo) for codigo in CODIGOS_ENLACE_NO_ENCONTRADO)
PRIMER_CODIGO_CORRECTO: Final = 200
PRIMER_CODIGO_DE_REDIRECCION: Final = 300
PRIMER_CODIGO_DE_SERVIDOR: Final = 500
# Los cinco grupos del orden de consulta, del primero al último (`orden_de_consulta`).
GRUPO_PENDIENTE, GRUPO_REINTENTO, GRUPO_EXPUESTO, GRUPO_ENSENADO, GRUPO_EN_TURNO = 0, 1, 2, 3, 4

type Observacion = dict[str, Any]
type Estado = dict[str, Any]


def observacion(  # noqa: PLR0913 - Los hechos de una consulta, con nombre.
    observado_el: str,
    codigo_http: int | None,
    url_final: str | None,
    *,
    es_pdf: bool | None = None,
    huella: str | None = None,
    motivo: str | None = None,
    otro_origen: bool = False,
) -> Observacion:
    """Lo observado en una consulta, con su resultado deducido del código, del contenido y del motivo.

    Args:
        observado_el: El instante de la consulta, en UTC.
        codigo_http: El código recibido, o None si no hubo respuesta.
        url_final: Dónde terminó la consulta tras las redirecciones, o None sin respuesta.
        es_pdf: Si lo recibido es un PDF; None si el conjunto no comprueba el contenido.
        huella: El SHA-256 del PDF recibido.
        motivo: Por qué no hubo respuesta, si un fallo de red, un plazo o un límite la impidió.
        otro_origen: Si la consulta terminó en otro origen que la dirección pedida.

    Returns:
        La observación, con los campos de `CAMPOS_OBSERVACION`.
    """
    motivo_final = motivo
    if motivo is not None:
        resultado = INCONCLUYENTE
    elif codigo_http in CODIGOS_NO_EXISTE and otro_origen:
        resultado, motivo_final = INCONCLUYENTE, "otro-origen"
    elif codigo_http in CODIGOS_NO_EXISTE:
        resultado = NO_EXISTE
    elif codigo_http is not None and PRIMER_CODIGO_CORRECTO <= codigo_http < PRIMER_CODIGO_DE_REDIRECCION:
        resultado = OTRO_CONTENIDO if es_pdf is False else RESPONDE
    else:
        resultado = INCONCLUYENTE
        servidor = codigo_http is not None and codigo_http >= PRIMER_CODIGO_DE_SERVIDOR
        motivo_final = "servidor" if servidor else "respuesta"
    return {
        "observado_el": observado_el,
        "resultado": resultado,
        "codigo_http": codigo_http,
        "url_final": url_final,
        "otro_origen": otro_origen,
        "huella": huella if resultado == RESPONDE else None,
        "motivo": motivo_final,
    }


def anotar(previo: Estado | None, nueva: Observacion) -> Estado:
    """El estado de un enlace tras una consulta: la última observación y la última concluyente.

    Args:
        previo: El estado guardado del enlace, o None si es la primera vez.
        nueva: La observación de esta consulta.

    Returns:
        El estado nuevo; el anterior no se modifica. Una consulta inconcluyente conserva la concluyente anterior y
        cuenta un fallo más; una concluyente lo pone a cero.
    """
    concluyente = previo["concluyente"] if previo else None
    fallos = previo["fallos_seguidos"] if previo else 0
    if nueva["resultado"] == INCONCLUYENTE:
        fallos += 1
    else:
        concluyente, fallos = nueva, 0
    return {"ultima": nueva, "concluyente": concluyente, "fallos_seguidos": fallos}


def estado_heredado(observado_el: str, *, oculto: bool = False) -> Estado:
    """El estado de un enlace que la comprobación anterior dio por bueno o por oculto sin guardar el código recibido.

    Se mantiene tal cual hasta que una consulta propia diga otra cosa: un enlace oculto sigue oculto y uno enlazado
    sigue enlazado. No inventa código ni huella.

    Args:
        observado_el: El día de la comprobación anterior, como instante UTC.
        oculto: Si esa comprobación lo daba por oculto (una web rota o un curso fuera de la oferta).

    Returns:
        El estado, sin consultas propias.
    """
    anterior = {
        "observado_el": observado_el,
        "resultado": NO_EXISTE if oculto else RESPONDE,
        "codigo_http": None,
        "url_final": None,
        "otro_origen": False,
        "huella": None,
        "motivo": None,
    }
    return {"ultima": None, "concluyente": anterior, "fallos_seguidos": 0}


def estado_con_evidencia(evidencia_guardada: Estado) -> Estado:
    """El estado de un enlace que el paquete publicado ya traía oculto con su código, su fecha y su destino.

    Args:
        evidencia_guardada: La evidencia del paquete: `codigo_http`, `observado_el` y `url_final`.

    Returns:
        El estado, con esa observación como última concluyente y sin consultas de este ciclo.
    """
    concluyente = {
        "observado_el": evidencia_guardada["observado_el"],
        "resultado": NO_EXISTE,
        "codigo_http": evidencia_guardada["codigo_http"],
        "url_final": evidencia_guardada["url_final"],
        "otro_origen": False,
        "huella": None,
        "motivo": None,
    }
    return {"ultima": None, "concluyente": concluyente, "fallos_seguidos": 0}


def es_heredado(estado: Estado | None) -> bool:
    """Si lo último concluyente de un enlace viene del paquete anterior, sin código recibido.

    Returns:
        True mientras ninguna consulta propia lo haya sustituido.
    """
    concluyente = estado["concluyente"] if estado else None
    return concluyente is not None and concluyente["codigo_http"] is None


def esta_oculto(estado: Estado | None) -> bool:
    """Si una web o un curso se oculta: su última observación concluyente dice que la dirección no existe.

    Returns:
        True solo con un 404 o un 410 observados y vigentes.
    """
    concluyente = estado["concluyente"] if estado else None
    return concluyente is not None and concluyente["resultado"] == NO_EXISTE


def esta_visible_el_programa(estado: Estado | None) -> bool:
    """Si el PDF de un programa se enlaza: su última observación concluyente es un PDF que responde.

    Returns:
        True si el enlace consta como un PDF que responde.
    """
    concluyente = estado["concluyente"] if estado else None
    return concluyente is not None and concluyente["resultado"] == RESPONDE


def tiene_consulta_propia(estado: Estado | None) -> bool:
    """Si el enlace tiene una observación concluyente hecha por consulta y no heredada.

    Returns:
        True si su última observación concluyente lleva el código recibido.
    """
    concluyente = estado["concluyente"] if estado else None
    return concluyente is not None and concluyente["codigo_http"] is not None


def evidencia(url: str, estado: Estado) -> dict[str, Any]:
    """La evidencia de que un enlace está oculto: qué se pidió, qué se recibió y cuándo.

    Returns:
        La dirección, el código, el destino y el instante de la observación concluyente.
    """
    concluyente = estado["concluyente"]
    return {
        "url": url,
        "codigo_http": concluyente["codigo_http"],
        "observado_el": concluyente["observado_el"],
        "url_final": concluyente["url_final"],
    }


def orden_de_consulta(
    url: str,
    estado: Estado | None,
    conjunto: str,
    *,
    expuesto_vencido: bool = False,
    ensenado_vencido: bool = False,
) -> tuple[int, str, int, str]:
    """La clave que ordena qué enlaces se consultan antes, por lo que importa a la persona.

    1. Pendientes: lo que la persona ve hoy junto a un curso publicado y nunca se ha consultado, y lo que el paquete
       anterior daba por oculto sin una consulta propia concluyente, aunque una consulta suya no concluyera.
    2. Reintentos: lo que falló por primera vez en su última consulta (un corte, un plazo o un 5xx), para saber pronto
       si fue pasajero. Un enlace que vuelve a fallar no repite el adelanto: así un dominio caído no acapara la porción
       y ninguna vuelta completa pasa del doble de ciclos que sin fallos.
    3. Expuestos: lo que la persona ve hoy junto a un curso publicado y lleva más de su antigüedad máxima sin
       comprobarse (`expuesto_vencido`).
    4. Enseñados: los programas que se enlazan sin un curso al lado, en las especialidades de una ocupación, y llevan
       más de su antigüedad máxima sin comprobarse (`ensenado_vencido`).
    5. El resto: primero lo nunca consultado, que no se enseña hasta que responda, y luego por la fecha de la última
       consulta, la más antigua primero.

    Dentro de cada grupo, primero los sin consulta propia y luego por la fecha de la última, la más antigua primero:
    así, con un dominio frenado, cada ciclo se intentan otros enlaces y ninguno queda sin alcanzar. A igualdad, las
    webs, los cursos y los programas, por ese orden, y después la dirección. Un enlace heredado enlazado cuenta como
    consultado el día de su comprobación anterior.

    Returns:
        La clave de orden.
    """
    pendiente = (estado is None and expuesto_vencido) or (
        estado is not None and es_heredado(estado) and esta_oculto(estado)
    )
    ultima = None
    if estado is not None:
        ultima = estado["ultima"] or (None if pendiente else estado["concluyente"])
    grupo = GRUPO_EN_TURNO
    if pendiente:
        grupo = GRUPO_PENDIENTE
    elif estado is not None and estado["fallos_seguidos"] == 1:
        grupo = GRUPO_REINTENTO
    elif expuesto_vencido:
        grupo = GRUPO_EXPUESTO
    elif ensenado_vencido:
        grupo = GRUPO_ENSENADO
    return (grupo, "" if ultima is None else ultima["observado_el"], CONJUNTOS.index(conjunto), url)
