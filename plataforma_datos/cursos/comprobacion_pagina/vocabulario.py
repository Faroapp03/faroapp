"""Las frases con las que una página pública dice que un curso está cerrado o abierto, en cada idioma.

Los patrones se escriben ya normalizados (minúsculas y sin tildes) porque se buscan en el texto visible normalizado de
la misma manera. Cada fuente elige en `reconocedores.py` los idiomas que lee; aquí solo está el vocabulario.
"""

IDIOMAS = ("ca", "en", "es")

CIERRE: dict[str, tuple[str, ...]] = {
    "ca": (
        r"inscripcions? tancad",
        r"inscripcio tancada",
        r"curs finalitzat",
        r"curs (tancat|cancel·lat)",
        r"no disponible",
        r"places esgotades",
        r"places exhaurides",
        r"llista d'espera",
        r"sense places",
        r"complet\b",
        r"ja no es disponible",
        r"activitat finalitzada",
        r"pagina no trobada",
        r"no s'ha trobat",
    ),
    "en": (
        r"registration (is )?closed",
        r"enrol?ment (is )?closed",
        r"course (is )?(closed|unavailable|retired)",
        r"no longer available",
        r"sold out",
        r"page not found",
        r"\b404\b",
    ),
    "es": (
        r"inscripcion(es)? cerrada",
        r"plazo de inscripcion (cerrado|finalizado)",
        r"curso finalizado",
        r"curso (cerrado|cancelado)",
        r"no disponible",
        r"plazas agotadas",
        r"sin plazas",
        r"completo\b(?! de)",
        r"ya no esta disponible",
        r"este curso ha (finalizado|terminado)",
        r"la pagina (que buscas )?no existe",
        r"pagina no encontrada",
        r"no se ha encontrado",
    ),
}

APERTURA: dict[str, tuple[str, ...]] = {
    "ca": (
        r"inscriu-te",
        r"inscripcio oberta",
        r"inscripcions obertes",
        r"fes la inscripcio",
        r"matricula't",
        r"comenca (el )?curs",
        r"inscriure'?m",
    ),
    "en": (
        r"\benroll\b",
        r"\benrol\b",
        r"start (the )?course",
        r"start learning",
        r"register now",
        r"sign up",
    ),
    "es": (
        r"inscribete",
        r"inscripcion abierta",
        r"plazo de inscripcion abierto",
        r"solicita (tu )?plaza",
        r"matriculate",
        r"empezar (el )?curso",
        r"comenzar (el )?curso",
        r"acceder al curso",
        r"inscribirme",
    ),
}
