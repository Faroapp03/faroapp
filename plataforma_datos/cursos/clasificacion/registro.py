"""Qué clasificador decide la clasificación de las ofertas de cada proveedor del catálogo de Cursos.

Una sola tabla, explícita y con importaciones normales: cada proveedor que puede aparecer en la entrega tiene el
clasificador de su fuente, en `fuentes/<fuente>/clasificacion.py`. Un proveedor que no está en la tabla no tiene quien
decida sus datos en el productor: sus ofertas viajan sin bloque. La prueba de paridad exige que cada proveedor del
catálogo publicado esté en la tabla, para que ninguna fuente quede fuera sin que nadie lo decida.
"""

from plataforma_datos.cursos.clasificacion.contrato import Clasificador
from plataforma_datos.cursos.fuentes.barcelonactiva import clasificacion as barcelonactiva
from plataforma_datos.cursos.fuentes.cibervoluntarios import clasificacion as cibervoluntarios
from plataforma_datos.cursos.fuentes.claude_academy import clasificacion as claude_academy
from plataforma_datos.cursos.fuentes.fundae import clasificacion as fundae
from plataforma_datos.cursos.fuentes.hp_life import clasificacion as hp_life

# El proveedor de cada oferta (`proveedor_id`) y la carpeta de su fuente. FUNDAE publica dos catálogos con un mismo
# clasificador.
FUENTES = {
    "anthropic": "claude_academy",
    "cibernarium": "barcelonactiva",
    "cibervoluntarios": "cibervoluntarios",
    "fundae:publicador:catalogo:1": "fundae",
    "fundae:publicador:catalogo:3": "fundae",
    "hp-life": "hp_life",
}
CLASIFICADORES: dict[str, Clasificador] = {
    "barcelonactiva": barcelonactiva.clasificar,
    "cibervoluntarios": cibervoluntarios.clasificar,
    "claude_academy": claude_academy.clasificar,
    "fundae": fundae.clasificar,
    "hp_life": hp_life.clasificar,
}
# El código que ejecuta la clasificación de la entrega, relativo a `plataforma_datos/cursos/`: entra en la huella de
# la proyección, porque un cambio en cualquiera de estos archivos puede cambiar la entrega.
CODIGO = (
    "exigencias_entrega_catalogo.py",
    "clasificacion/__init__.py",
    "clasificacion/contrato.py",
    "clasificacion/registro.py",
    "clasificacion/emision.py",
    *("fuentes/" + fuente + "/clasificacion.py" for fuente in sorted(CLASIFICADORES)),
)


def clasificador_de(proveedor_id: str) -> Clasificador | None:
    """Devuelve el clasificador de la fuente de un proveedor.

    Returns:
        La función `clasificar` de la fuente, o `None` si el proveedor no está en la tabla.
    """
    fuente = FUENTES.get(proveedor_id)
    return None if fuente is None else CLASIFICADORES[fuente]
