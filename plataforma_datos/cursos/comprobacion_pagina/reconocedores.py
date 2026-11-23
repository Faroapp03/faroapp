"""Cómo se lee la página de cada fuente: el único sitio donde se declara lo que cada casa publica en sus fichas.

Cada reconocedor dice qué idiomas lee la fuente, qué frases son de menú o de pie y no hablan del curso, qué señal
propia trae una ficha abierta y si su página basta para decidir. Una fuente que no está aquí no se lee: su página
queda `dudosa`. Lo que una fuente publica distinto de lo declarado nunca se da por abierto ni por cerrado.
"""

from dataclasses import dataclass

from plataforma_datos.cursos.comprobacion_pagina.vocabulario import APERTURA, CIERRE


@dataclass(frozen=True, kw_only=True)
class DatosEmbebidos:
    """El curso que la propia página incrusta en sus datos (Next.js) y los valores con que está publicado."""

    estado_publicado: str
    privacidad_publica: str


@dataclass(frozen=True, kw_only=True)
class Reconocedor:
    """Lo que se sabe de las fichas de una fuente.

    `plantilla`: frases de menú o de pie, ya normalizadas, que se descartan antes de buscar señales.
    `apertura_propia`: patrón de la señal que solo trae una ficha abierta de esta fuente; sin ella, un curso no se da
    por disponible. `ficha_decide` es falso cuando la ficha se pinta con JavaScript y es idéntica para cualquier
    identificador: la página no dice nada del curso. `datos_embebidos` es lo que lee la fuente que incrusta el curso.
    """

    idiomas: tuple[str, ...]
    plantilla: tuple[str, ...] = ()
    apertura_propia: str | None = None
    ficha_decide: bool = True
    datos_embebidos: DatosEmbebidos | None = None

    def cierre(self) -> tuple[tuple[str, str], ...]:
        """Los patrones de cierre de sus idiomas.

        Returns:
            Pares (idioma, patrón).
        """
        return tuple((idioma, patron) for idioma in self.idiomas for patron in CIERRE[idioma])

    def apertura(self) -> tuple[tuple[str, str], ...]:
        """Los patrones de apertura de sus idiomas.

        Returns:
            Pares (idioma, patrón).
        """
        return tuple((idioma, patron) for idioma in self.idiomas for patron in APERTURA[idioma])


RECONOCEDORES: dict[str, Reconocedor] = {
    # La ficha de una edición abierta trae su botón «Inscriure'm»; lo inexistente responde 200 con una ficha genérica
    # sin título. «Inscriu-te a la IT Academy» está en el pie de toda la web.
    "barcelonactiva": Reconocedor(
        idiomas=("ca", "es"), plantilla=("inscriu-te a la it academy",), apertura_propia=r"inscriure'?m"
    ),
    "claude_academy": Reconocedor(idiomas=("en",), apertura_propia=r"start (the )?course"),
    # La página no trae texto visible, pero sí el curso en sus datos de Next.js; lo inexistente responde 500.
    "hp_life": Reconocedor(
        idiomas=("en", "es"), datos_embebidos=DatosEmbebidos(estado_publicado="Published", privacidad_publica="Public")
    ),
    # La ficha la pinta el navegador y la respuesta es la misma para cualquier identificador.
    "cibervoluntarios": Reconocedor(idiomas=("es",), ficha_decide=False),
    "fundae": Reconocedor(idiomas=("es",), ficha_decide=False),
}
