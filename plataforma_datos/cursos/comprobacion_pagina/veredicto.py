"""El veredicto de la página de un curso: si su casa dice que sigue abierto, que está cerrado o que no existe.

Es una función pura de lo observado: la respuesta de la página, el título con que se publica el curso, la fuente y la
respuesta de la sonda del mismo dominio. No pide nada a la red ni mira el reloj; la hora llega como dato.

Las reglas se aplican en orden y la primera que reconoce la página decide. Lo que ninguna reconoce no se da por
abierto ni por cerrado: un curso solo es `disponible` si la propia ficha lo dice, y solo es `cerrado` o `no_existe`
si hay una señal literal, un 404 o una respuesta igual a la de lo inexistente. Todo lo demás es `dudoso`, y una página
que no contestó es `sin_respuesta`, que no prueba nada.
"""

import hashlib
from collections.abc import Callable
from dataclasses import dataclass
from urllib.parse import parse_qsl, unquote, urlsplit

from plataforma_datos.cursos.comprobacion_pagina.analisis import AUSENTE, Analisis, analizar
from plataforma_datos.cursos.comprobacion_pagina.contrato import Comprobacion, falla_el_servidor
from plataforma_datos.cursos.comprobacion_pagina.reconocedores import RECONOCEDORES, Reconocedor
from plataforma_datos.cursos.comprobacion_pagina.regla import regla_de_comprobacion
from plataforma_datos.cursos.comprobacion_pagina.respuesta import Curso, Respuesta
from plataforma_datos.cursos.comprobacion_pagina.sonda import Huellas, es_igual_a_la_sonda

# Una ficha con menos texto visible que esto y con scripts es un molde que el navegador rellena.
TEXTO_MINIMO_SIN_JAVASCRIPT = 400
# Una ficha con menos texto visible que esto no es una ficha de curso.
TEXTO_MINIMO_DE_FICHA = 300
MAX_SENALES = 8
NO_ENCONTRADA = (404, 410)
ERROR_DE_PETICIONES = 429
PRIMER_ERROR_DE_CLIENTE = 400
SIN_RECONOCEDOR = Reconocedor(idiomas=())


@dataclass(frozen=True, kw_only=True)
class _Caso:
    """Todo lo que una regla necesita para leer una página."""

    curso: Curso
    respuesta: Respuesta
    reconocedor: Reconocedor | None
    analisis: Analisis
    sonda: Huellas | None
    igual_a_la_sonda: bool
    final_de_la_sonda: bool


@dataclass(frozen=True)
class _Decision:
    veredicto: str
    motivo: str
    senales: tuple[str, ...] = ()


# El trozo que identifica la ficha: el valor del último parámetro o el último segmento del camino.
def _identificador_en_la_direccion(url: str) -> str:
    partes = urlsplit(url)
    consulta = parse_qsl(partes.query)
    if consulta:
        return consulta[-1][1]
    return unquote(partes.path.rstrip("/").split("/")[-1])


# Las frases literales de cierre y de apertura que se leyeron, sin repetir y en orden.
def _frases(caso: _Caso) -> tuple[str, ...]:
    leidas = {s.frase for s in (*caso.analisis.cierre, *caso.analisis.apertura, *caso.analisis.apertura_propia)}
    return tuple(sorted(leidas))[:MAX_SENALES]


def _sin_respuesta(caso: _Caso) -> _Decision | None:
    if caso.respuesta.http is None:
        return _Decision("sin_respuesta", "error_de_red")
    return None


# Un sitio que responde 5xx a lo inexistente no distingue un curso retirado de una caída.
def _servidor_como_la_sonda(caso: _Caso) -> _Decision | None:
    if falla_el_servidor(caso.respuesta.http) and caso.igual_a_la_sonda:
        return _Decision("dudoso", "servidor_igual_a_la_sonda")
    return None


def _error_del_servidor(caso: _Caso) -> _Decision | None:
    if falla_el_servidor(caso.respuesta.http):
        return _Decision("sin_respuesta", "error_del_servidor")
    return None


def _no_encontrada(caso: _Caso) -> _Decision | None:
    if caso.respuesta.http in NO_ENCONTRADA:
        return _Decision("no_existe", "http_no_encontrada")
    return None


def _acceso_rechazado(caso: _Caso) -> _Decision | None:
    if (caso.respuesta.http or 0) >= PRIMER_ERROR_DE_CLIENTE:
        return _Decision("dudoso", "acceso_rechazado")
    return None


def _fuente_sin_reconocedor(caso: _Caso) -> _Decision | None:
    if caso.reconocedor is None:
        return _Decision("dudoso", "fuente_sin_reconocedor")
    return None


# La fuente que incrusta el curso en la página se lee por esos datos y por nada más.
def _datos_de_la_ficha(caso: _Caso) -> _Decision | None:
    declarado = None if caso.reconocedor is None else caso.reconocedor.datos_embebidos
    if declarado is None:
        return None
    curso = caso.analisis.datos_del_curso
    if curso is None:
        return _Decision("dudoso", "ficha_sin_datos_del_curso")
    senales = tuple(sorted((f"status={curso.estado}", f"privacyLevel={curso.privacidad}")))
    if not curso.titulo_coincide:
        return _Decision("dudoso", "datos_con_otro_titulo", senales)
    if (curso.estado, curso.privacidad) == (declarado.estado_publicado, declarado.privacidad_publica):
        return _Decision("disponible", "datos_publicados_en_la_ficha", senales)
    return _Decision("dudoso", "datos_sin_publicar", senales)


def _ficha_que_no_decide(caso: _Caso) -> _Decision | None:
    if caso.reconocedor is not None and not caso.reconocedor.ficha_decide:
        return _Decision("dudoso", "pagina_identica_para_todo", _frases(caso))
    return None


def _contenido_con_javascript(caso: _Caso) -> _Decision | None:
    analisis = caso.analisis
    sin_texto = analisis.longitud_texto < TEXTO_MINIMO_SIN_JAVASCRIPT and analisis.scripts > 0
    if sin_texto or (analisis.hay_datos_next and analisis.titulo == AUSENTE):
        return _Decision("dudoso", "contenido_con_javascript", _frases(caso))
    return None


def _igual_a_la_sonda(caso: _Caso) -> _Decision | None:
    if not (caso.igual_a_la_sonda or caso.final_de_la_sonda):
        return None
    if caso.analisis.titulo != AUSENTE:
        return _Decision("dudoso", "igual_a_la_sonda_con_titulo", _frases(caso))
    return _Decision("no_existe", "igual_a_la_sonda", _frases(caso))


def _redirigida_fuera_de_la_ficha(caso: _Caso) -> _Decision | None:
    final = caso.respuesta.url_final or caso.respuesta.url
    pedida = caso.respuesta.url
    identificador = _identificador_en_la_direccion(pedida)
    if final.rstrip("/") != pedida.rstrip("/") and identificador and identificador not in unquote(final):
        return _Decision("dudoso", "redirige_fuera_de_la_ficha", _frases(caso))
    return None


def _texto_muy_corto(caso: _Caso) -> _Decision | None:
    if caso.analisis.longitud_texto < TEXTO_MINIMO_DE_FICHA:
        return _Decision("dudoso", "texto_muy_corto", _frases(caso))
    return None


def _senales_de_cierre(caso: _Caso) -> _Decision | None:
    if not caso.analisis.cierre:
        return None
    if caso.analisis.apertura:
        return _Decision("dudoso", "senales_contradictorias", _frases(caso))
    return _Decision("cerrado", "senal_de_cierre", _frases(caso))


def _titulo_ausente(caso: _Caso) -> _Decision | None:
    if caso.analisis.titulo == AUSENTE:
        return _Decision("dudoso", "titulo_ausente", _frases(caso))
    return None


def _sin_senal_de_apertura(caso: _Caso) -> _Decision | None:
    if not caso.analisis.apertura_propia:
        return _Decision("dudoso", "sin_senal_de_apertura", _frases(caso))
    return None


# Sin la sonda no se sabe si el sitio responde igual a lo inexistente, así que no se da por abierto.
def _sin_sonda(caso: _Caso) -> _Decision | None:
    if caso.sonda is None:
        return _Decision("dudoso", "sin_sonda", _frases(caso))
    return None


def _disponible(caso: _Caso) -> _Decision | None:
    return _Decision("disponible", "ficha_con_senal_de_apertura", _frases(caso))


# El orden es la regla: la primera que reconoce la página decide, y `_disponible` solo se alcanza con todo a favor.
REGLAS: tuple[Callable[[_Caso], _Decision | None], ...] = (
    _sin_respuesta,
    _servidor_como_la_sonda,
    _error_del_servidor,
    _no_encontrada,
    _acceso_rechazado,
    _fuente_sin_reconocedor,
    _datos_de_la_ficha,
    _ficha_que_no_decide,
    _contenido_con_javascript,
    _igual_a_la_sonda,
    _redirigida_fuera_de_la_ficha,
    _texto_muy_corto,
    _senales_de_cierre,
    _titulo_ausente,
    _sin_senal_de_apertura,
    _sin_sonda,
    _disponible,
)


def _huellas(respuesta: Respuesta, analisis: Analisis) -> Huellas:
    return Huellas(
        http=respuesta.http,
        sha256_cuerpo=hashlib.sha256(respuesta.cuerpo).hexdigest(),
        huella_texto=analisis.huella_texto,
        longitud_texto=analisis.longitud_texto,
        longitud_cuerpo=len(respuesta.cuerpo),
    )


# Las huellas de la sonda, o `None` si no se pidió o no hubo respuesta: entonces no sirve de comparación.
def _huellas_de_la_sonda(sonda: Respuesta | None, reconocedor: Reconocedor) -> Huellas | None:
    if sonda is None or sonda.http is None:
        return None
    return _huellas(sonda, analizar(sonda.cuerpo, sonda.tipo, "", reconocedor))


# Si la sonda terminó en otra dirección y la página termina en esa misma, el sitio manda lo inexistente allí.
def _redirige_a_un_sitio_fijo(sonda: Respuesta | None, final: str) -> bool:
    if sonda is None or not sonda.url_final or sonda.url_final == sonda.url:
        return False
    return sonda.url_final == final


def _titulo_presente(analisis: Analisis) -> bool:
    datos = analisis.datos_del_curso
    return analisis.titulo != AUSENTE or (datos is not None and datos.titulo_coincide)


def comprobar_pagina(curso: Curso, respuesta: Respuesta, sonda: Respuesta | None, *, pedido_utc: str) -> Comprobacion:
    """Decide qué dice la página pública de un curso de su estado.

    Args:
        curso: El curso, con su fuente y el título con que se publica.
        respuesta: Lo que se observó al pedir la página del curso.
        sonda: Lo que se observó al pedir una ficha inexistente del mismo dominio, o `None` si no se pidió.
        pedido_utc: La hora UTC, al segundo, en que se pidió la página.

    Returns:
        La comprobación con su veredicto, su motivo, las señales literales que lo sostienen y la regla que lo decidió.
    """
    reconocedor = RECONOCEDORES.get(curso.fuente)
    analisis = analizar(respuesta.cuerpo, respuesta.tipo, curso.titulo, reconocedor or SIN_RECONOCEDOR)
    huellas_sonda = _huellas_de_la_sonda(sonda, reconocedor or SIN_RECONOCEDOR)
    final = respuesta.url_final or respuesta.url
    caso = _Caso(
        curso=curso,
        respuesta=respuesta,
        reconocedor=reconocedor,
        analisis=analisis,
        sonda=huellas_sonda,
        igual_a_la_sonda=es_igual_a_la_sonda(_huellas(respuesta, analisis), huellas_sonda),
        final_de_la_sonda=_redirige_a_un_sitio_fijo(sonda, final),
    )
    decision = next(d for regla in REGLAS if (d := regla(caso)) is not None)
    return Comprobacion(
        curso=curso.id,
        fuente=curso.fuente,
        url=respuesta.url,
        pedido_utc=pedido_utc,
        http=respuesta.http,
        url_final=None if respuesta.http is None else final,
        saltos=0 if respuesta.http is None else respuesta.saltos,
        longitud_texto=analisis.longitud_texto,
        sha256_cuerpo=hashlib.sha256(respuesta.cuerpo).hexdigest(),
        titulo_presente=_titulo_presente(analisis),
        senales=decision.senales,
        sonda_sha256=None if sonda is None or sonda.http is None else hashlib.sha256(sonda.cuerpo).hexdigest(),
        veredicto=decision.veredicto,
        motivo=decision.motivo,
        regla=regla_de_comprobacion(),
    )
