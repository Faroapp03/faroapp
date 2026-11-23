"""Señales explícitas de nivel del contenido ya validado de Cibernàrium."""

import re
import unicodedata

REGLA = "nivel-cibernarium-v3"
PRINCIPIANTES = re.compile(
    r"\b(?:per a|para|dirigit a|dirigido a|adreçat a)\s+(?:persones\s+)?(?:principiants|principiantes)\b",
    re.IGNORECASE,
)

SIN_PREVIOS = re.compile(
    r"\bno\s+(?:es\s+requereixen|calen|se\s+requieren|hacen\s+falta)\s+"
    r"(?:coneixements|conocimientos)\s+(?:previs|previos?)\b",
    re.IGNORECASE,
)
SIN_TECNICOS = re.compile(
    r"\b(?:sense\s+coneixements\s+t[eè]cnics|sin\s+conocimientos\s+t[eé]cnicos|"
    r"no\s+(?:tens|tienes)\s+coneixements\s+t[eè]cnics)\b",
    re.IGNORECASE,
)
CONTINUIDAD = re.compile(
    r"\b(?:ja\s+tens|ya\s+tienes)\s+un\s+(?:projecte|proyecto)\s+funcionant\b.*\b(?:aprofund|perfeccion)",
    re.IGNORECASE | re.DOTALL,
)
BASE_ESTABLECIDA = re.compile(
    r"\b(?:un\s+cop\s+establertes\s+les\s+bases|una\s+vez\s+establecidas\s+las\s+bases)\b.*"
    r"\b(?:ja\s+s.ha\s+comen[cç]at\s+a\s+utilitzar|ya\s+se\s+ha\s+empezado\s+a\s+utilizar)",
    re.IGNORECASE | re.DOTALL,
)
SCRIPTS = re.compile(
    r"\b(?:automatitza\w*|automatiza\w*|automatizar)\b.*\b(?:crear|crea\w*)\s+scripts\b",
    re.IGNORECASE | re.DOTALL,
)
CONSOLIDAR = re.compile(
    r"\b(?:un\s+pas\s+m[eé]s|un\s+paso\s+m[aá]s)\b.*\bconsolidar\s+coneixements\b",
    re.IGNORECASE | re.DOTALL,
)
FUNDAMENTOS = re.compile(
    r"\b(?:conceptes\s+b[aà]sics|conceptos\s+b[aá]sicos)\b.*\b(?:fluxos\s+senzills|flujos\s+sencillos)\b",
    re.IGNORECASE | re.DOTALL,
)
CERTIFICACION_EXPERTA = re.compile(
    r"\b(?:certificaci[oó]|certificaci[oó]n)\b.*\bexpert\b.*\bcompet[eè]ncies\s+avan[cç]ades\b",
    re.IGNORECASE | re.DOTALL,
)
PROYECTO_COMERCIO = re.compile(
    r"\bcrear\s+i\s+gestionar\s+un\s+comer[cç]\s+electr[oò]nic\b.*\bconfigurar",
    re.IGNORECASE | re.DOTALL,
)
PLAN_ANALISIS = re.compile(
    r"\bdefineix\s+l.estrat[eè]gia\b.*\bcrea\s+un\s+pla\b.*\b(?:auditar|analitzar)",
    re.IGNORECASE | re.DOTALL,
)
INFORMES_PERSONALIZADOS = re.compile(
    r"\b(?:analitzar|analizar)\b.*\b(?:personalitzar|personalizar)\b.*\binformes\b",
    re.IGNORECASE | re.DOTALL,
)
PROYECTO_PREPARADO = re.compile(
    r"\b(?:capturar\s+i\s+editar|capturar\s+y\s+editar)\s+dades\b.*\b(?:projecte|proyecto)\s+preparat\b",
    re.IGNORECASE | re.DOTALL,
)
NEGACION_ACCION = re.compile(
    r"\b(?:no|sin|sense|never|without)\b[^.!?;]{0,45}\b(?:crear|crea\w*|automatitzar|automatizar|aprofund\w*|consolidar|configurar|anticip\w*|detect\w*|mitig\w*|transform\w*|despleg\w*|revis\w*|analiz\w*|compar\w*)",
    re.IGNORECASE,
)
REQUISITO_TEMA = re.compile(
    r"\b(?:requereix|requiere|requieren)\s+(?:coneixements|conocimientos)\s+b[aàá]sic(?:s|os|as|o|a)?\s+de\s+([^.!?;]+)",
    re.IGNORECASE,
)
CONTRADICCION = re.compile(
    r"\b(?:requereix|requieren|requiere|es\s+requereixen|calen|exige|exigeix|necessita|necesita)\s+"
    r"(?:tenir\s+|tener\s+)?(?:coneixements|conocimientos|experi[eè]ncia|experiencia)\b|"
    r"\b(?:no\s+[eé]s\s+cert|no\s+es\s+cierto|no\s+es\s+verdad)\s+que\b|"
    r"\b(?:nivell|nivel)\s+(?:avan[cç]at|avanzado|intermedi|intermedio)\b",
    re.IGNORECASE,
)


def _normalizar(texto: str) -> str:
    sin_tildes = "".join(c for c in unicodedata.normalize("NFKD", texto.casefold()) if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", sin_tildes).strip()


def _contiene(texto: str, *grupos: tuple[str, ...]) -> bool:
    return all(any(opcion in texto for opcion in grupo) for grupo in grupos)


def _nivel_tareas(descripcion: str) -> str | None:
    """Estima el alcance de las tareas descritas, no las capacidades de quien participa.

    Returns:
        Orientación por tareas o None si faltan señales o son contradictorias.
    """
    texto = _normalizar(descripcion)
    avanzadas = (
        _contiene(texto, ("maquina virtual",), ("contenidors", "contenedores"), ("kubernetes",), ("serverless",)),
        _contiene(
            texto,
            ("anticipa", "anticipar"),
            ("detecta", "detectar"),
            ("mitiga", "mitigar"),
            ("ciberseguretat", "ciberseguridad"),
        ),
        _contiene(texto, ("github actions",), ("codespaces",), ("pull requests",), ("seguretat", "seguridad")),
    )
    intermedias = (
        _contiene(
            texto,
            ("tecniques classiques de generacio d idees", "tecnicas clasicas de generacion de ideas"),
            ("dissenyar instruccions creatives", "disenar instrucciones creativas"),
        ),
        _contiene(
            texto,
            ("investigacio de paraules clau", "investigacion de palabras clave"),
            ("optimitzacio", "optimizacion"),
            ("monitoratge", "monitorizacion"),
        ),
        _contiene(
            texto,
            ("interficie", "interfaz"),
            ("navegacio", "navegacion"),
            ("gestio de l estat", "gestion del estado"),
            ("multiplataforma",),
        ),
        _contiene(
            texto, ("transformar",), ("aplicacio android existent", "aplicacion android existente"), ("experiencia xr",)
        ),
        _contiene(
            texto,
            ("conceptes basics", "conceptos basicos"),
            ("tecniques avancades", "tecnicas avanzadas"),
            ("analisi", "analisis"),
        ),
        _contiene(
            texto,
            ("aplicacions web", "aplicaciones web"),
            ("servidors eficients", "servidores eficientes"),
            ("contenidors", "contenedores"),
        ),
        _contiene(texto, ("prompt mestre", "prompt maestro"), ("canals", "canales"), ("coherencia de marca",)),
        _contiene(
            texto,
            ("relats digitals", "relatos digitales"),
            ("formats multimedia", "formatos multimedia"),
            ("transformar",),
        ),
        _contiene(
            texto,
            ("crear i utilitzar agents", "crear y utilizar agentes"),
            ("configuracio", "configuracion"),
            ("implantacio", "implantacion"),
        ),
        _contiene(texto, ("publicar continguts", "publicar contenidos"), ("feedback",), ("vendes", "ventas")),
    )
    iniciales = (
        _contiene(
            texto,
            ("ni haver de tenir coneixements tecnics", "sin tener conocimientos tecnicos"),
            ("aspectes principals", "aspectos principales"),
        ),
        _contiene(
            texto,
            ("nova funcio", "nueva funcion"),
            ("practicarem", "practicaremos"),
            ("editarem videos", "editaremos videos"),
        ),
        _contiene(texto, ("capsula veurem exemples", "capsula veremos ejemplos"), ("xarxa", "red social")),
        _contiene(texto, ("coneixer be l eina", "conocer bien la herramienta"), ("familiaritzar", "familiarizar")),
        _contiene(
            texto,
            ("perfil que generi confianca", "perfil que genere confianza"),
            ("utilitzar totes les opcions", "utilizar todas las opciones"),
        ),
        _contiene(
            texto,
            ("com funciona aquest nou paradigma", "como funciona este nuevo paradigma"),
            ("verificar les respostes", "verificar las respuestas"),
        ),
    )
    niveles = {
        valor
        for valor, reglas in (("inicial", iniciales), ("intermedio", intermedias), ("avanzado", avanzadas))
        if any(reglas)
    }
    return next(iter(niveles)) if len(niveles) == 1 else None


def sugerir(actividad: dict) -> dict | None:
    """Lee categoría de nivel o destinatarios explícitos, sin redistribuir la descripción.

    Returns:
        Sugerencia orientativa o None cuando no hay una señal precisa.
    """
    categoria = actividad.get("category")
    if categoria == "Formació tecnològica bàsica":
        return {"valor": "inicial", "origen": "categoria", "regla": REGLA}
    if categoria == "Formació tecnològica avançada - IT Academy":
        return {"valor": "avanzado", "origen": "categoria", "regla": REGLA}
    descripcion = actividad.get("description")
    if isinstance(descripcion, str):
        sin_previos = SIN_TECNICOS.sub("", SIN_PREVIOS.sub("", descripcion))
        inicial = any(p.search(descripcion) for p in (PRINCIPIANTES, SIN_PREVIOS, SIN_TECNICOS, FUNDAMENTOS))
        intermedio = any(
            p.search(descripcion)
            for p in (
                CONTINUIDAD,
                BASE_ESTABLECIDA,
                SCRIPTS,
                CONSOLIDAR,
                PROYECTO_COMERCIO,
                PLAN_ANALISIS,
                INFORMES_PERSONALIZADOS,
                PROYECTO_PREPARADO,
            )
        )
        # Un requisito básico solo cuenta si se refiere al mismo entorno tratado en el título.
        requisito = REQUISITO_TEMA.search(descripcion)
        titulo = actividad.get("title")
        negado = bool(
            requisito
            and re.search(
                r"\b(?:no|sin|sense)\s*$",
                descripcion[max(0, requisito.start() - 12) : requisito.start()],
                re.IGNORECASE,
            )
        )
        mismo_entorno = bool(
            requisito
            and not negado
            and isinstance(titulo, str)
            and requisito.group(1).strip().casefold() in titulo.casefold()
        )
        intermedio = intermedio or mismo_entorno
        if mismo_entorno:
            sin_previos = REQUISITO_TEMA.sub("", sin_previos)
        por_tareas = _nivel_tareas(descripcion)
        inicial = inicial or por_tareas == "inicial"
        intermedio = intermedio or por_tareas == "intermedio"
        avanzado = bool(CERTIFICACION_EXPERTA.search(descripcion)) or por_tareas == "avanzado"
        if inicial and not intermedio and not avanzado and not CONTRADICCION.search(sin_previos):
            return {"valor": "inicial", "origen": "descripcion", "regla": REGLA}
        if (
            intermedio
            and not inicial
            and not avanzado
            and not CONTRADICCION.search(sin_previos)
            and not NEGACION_ACCION.search(descripcion)
        ):
            return {"valor": "intermedio", "origen": "descripcion", "regla": REGLA}
        if avanzado and not inicial and not intermedio and not NEGACION_ACCION.search(descripcion):
            return {"valor": "avanzado", "origen": "descripcion", "regla": REGLA}
    return None
