"""El único sitio donde se declara qué fuentes se comprueban por su API: aquellas cuya página no decide.

La página de FUNDAE y de Cibervoluntarios se pinta con JavaScript igual para cualquier curso, y el SOC, el Consorci y
Citilab publican sus cursos en el paquete de datos sin ficha propia que leer: su realidad está en la API que ya leen
sus descargas. Cibernàrium no está: su página decide, y su API es una búsqueda paginada sin consulta por edición.
"""

from plataforma_datos.cursos.comprobacion_api import cibervoluntarios, citilab, consorci, fundae, soc
from plataforma_datos.cursos.comprobacion_api.consultor import Consultor
from plataforma_datos.cursos.fuentes.cibervoluntarios.lectura import FUENTE as CIBERVOLUNTARIOS
from plataforma_datos.cursos.fuentes.citilab.constantes import FUENTE as CITILAB
from plataforma_datos.cursos.fuentes.consorci.constantes import FUENTE as CONSORCI
from plataforma_datos.cursos.fuentes.formacion.constantes import FUENTE as SOC
from plataforma_datos.cursos.fuentes.fundae.lectura import FUENTE as FUNDAE

CONSULTORES: dict[str, Consultor] = {
    CIBERVOLUNTARIOS: cibervoluntarios.CONSULTOR,
    CITILAB: citilab.CONSULTOR,
    CONSORCI: consorci.CONSULTOR,
    SOC: soc.CONSULTOR,
    FUNDAE: fundae.CONSULTOR,
}
# Los módulos que deciden: cambiar cómo se lee una API cambia la regla que firma cada comprobación.
MODULOS_QUE_DECIDEN = (
    "cibervoluntarios.py",
    "citilab.py",
    "consorci.py",
    "consultor.py",
    "consultores.py",
    "contrato.py",
    "fundae.py",
    "soc.py",
)


def se_comprueba_por_api(fuente: str) -> bool:
    """Si las retiradas de la fuente se comprueban por su API y no por su página.

    Returns:
        Si la fuente tiene consultor.
    """
    return fuente in CONSULTORES
