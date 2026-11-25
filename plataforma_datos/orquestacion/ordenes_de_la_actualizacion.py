"""Las órdenes fijas de la actualización: revalidar el catálogo antes de las fuentes y los pasos del paquete.

Cada orden lleva su tope: lo que puede tardar antes de que la actualización la corte y la dé por agotada. El de las
comprobaciones de los datos cubre la suma de los plazos que `npm run verificar:datos` se da por dentro
(`pruebas/test_ordenes_de_la_actualizacion.py` lo exige); las demás no declaran el suyo y se quedan en el tope general
de una orden (`actualizar.TOPE_POR_ORDEN`), que es también el de las órdenes de las fuentes.
"""

import sys
from collections.abc import Mapping, Sequence
from typing import NamedTuple

from plataforma_datos.comun.nucleo import DATOS_RELATIVOS
from plataforma_datos.orquestacion.modulos import CARPETA_DEL_PAQUETE

PYTHON = sys.executable
# Los plazos internos de verificar:datos suman 80 minutos (seis comprobaciones de 2, las pruebas de unidad 18, las de
# Python 45, que es el de cada uno de sus procesos y corren a la vez, y el humo 5); los cinco de más son para arrancar
# Node y leer la base ESCO antes del primer plazo.
TOPE_DE_LAS_COMPROBACIONES = 85 * 60


class Orden(NamedTuple):
    """Una orden de la actualización: su rótulo, lo que se ejecuta y, si es una etapa de una fuente, cuáles.

    La conducta (pausa entre fuentes de red, reintento de una descarga) se decide por `fuente` y `etapa`, nunca por
    el rótulo, que es solo para personas. `tope` es lo que puede tardar, en segundos; sin él, el tope general.
    """

    nombre: str
    orden: Sequence[str]
    fuente: str | None = None
    etapa: str | None = None
    tope: int | None = None


COMPROBAR_LOS_DATOS = ("npm", "run", "verificar:datos")
COMPROBACIONES = (Orden("Comprobaciones de los datos nuevos", COMPROBAR_LOS_DATOS, tope=TOPE_DE_LAS_COMPROBACIONES),)

# Primer paso de cada actualización: un cambio del código que admite el catálogo de Cursos exige repetir su auditoría
# antes de que las fuentes o el seguimiento lo lean; sin él, la actualización quedaría bloqueada antes de componer.
REVALIDAR_EL_CATALOGO = Orden(
    "Revalidar el catálogo de Cursos con el código vigente",
    (PYTHON, "-m", "plataforma_datos.cursos.revalidar_catalogo"),
)

EXPORTAR_EL_PAQUETE = Orden(
    "Exportar el paquete del motor", (PYTHON, "-m", "plataforma_datos.orquestacion.exportar_paquete")
)
COMPONER_EL_CATALOGO = Orden(
    "Componer el catálogo admitido de Cursos", (PYTHON, "-m", "plataforma_datos.cursos.componer_catalogo")
)
ENSAMBLADO = (
    Orden("Incorporar datos globales admitidos", (PYTHON, "-m", "plataforma_datos.orquestacion.publicar_globales")),
    Orden("Preparar datos globales de la web", ("npm", "run", "globales:generar")),
    Orden("Preparar Biblioteca con sus enlaces admitidos", ("npm", "run", "lecturas:generar")),
    Orden("Preparar el informe de ejemplo", ("npm", "run", "informe:ejemplo")),
)
COTEJO_DE_ARTEFACTOS = Orden("Construir la web local y comprobar sus artefactos", ("npm", "run", "web:preparar"))
ORDENES_DEL_PAQUETE = (EXPORTAR_EL_PAQUETE, COMPONER_EL_CATALOGO, *ENSAMBLADO, COTEJO_DE_ARTEFACTOS, *COMPROBACIONES)
# En el ciclo operativo, la exportación completa además los renombres del paquete
# (exportar_paquete.renombres_por_completar): su base sale del almacén y publicaba el nombre antiguo. Solo allí: en una
# instalación de trabajo, un archivo con el nombre antiguo puede ser la tabla privada de la Cambra, aunque alguien haya
# restaurado a mano un manifiesto anterior. La señal la fija solo el supervisor del ejecutor privado en el entorno de su
# candidato (ejecutor_operativo); no está en actualizar.ENTORNO_HEREDADO, así que ninguna orden la hereda. Un ensayo
# que quiera reproducir el ciclo operativo debe fijarla también.
COMPLETAR_RENOMBRES = "FARO_COMPLETAR_RENOMBRES"
SI = "si"
EXPORTAR_EN_EL_CICLO_OPERATIVO = EXPORTAR_EL_PAQUETE._replace(
    orden=(*EXPORTAR_EL_PAQUETE.orden, "--completar-renombres")
)
RUTAS_DE_LA_ENTREGA = (
    CARPETA_DEL_PAQUETE,
    "web",
    f"{DATOS_RELATIVOS.as_posix()}/validados/catalogo-cursos",
)
_TOPES = {tuple(o.orden): o.tope for o in (REVALIDAR_EL_CATALOGO, *ORDENES_DEL_PAQUETE) if o.tope is not None}


def ordenes_del_paquete(entorno: Mapping[str, str]) -> tuple[Orden, ...]:
    """Las órdenes del paquete en este entorno.

    El ciclo operativo se reconoce por su señal propia, `COMPLETAR_RENOMBRES` con el valor `SI`, que solo fija el
    supervisor del ejecutor privado para su candidato; una ejecución en el Mac no la tiene.

    Returns:
        `ORDENES_DEL_PAQUETE`, con la exportación que completa los renombres si es el ciclo operativo.
    """
    if entorno.get(COMPLETAR_RENOMBRES) != SI:
        return ORDENES_DEL_PAQUETE
    return (EXPORTAR_EN_EL_CICLO_OPERATIVO, *ORDENES_DEL_PAQUETE[1:])


def tope_de(orden: Sequence[str], general: int) -> int:
    """Dice cuánto puede tardar una orden antes de cortarla.

    Returns:
        El tope que declara la orden fija que coincide con ella o, si no declara ninguno, el general.
    """
    return _TOPES.get(tuple(orden), general)
