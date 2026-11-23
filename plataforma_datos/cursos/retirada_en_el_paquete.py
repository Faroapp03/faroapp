"""Lo que la regla de retirada activa del SOC, del Consorci o de Citilab quita de su archivo del paquete de datos.

Esas tres fuentes no pasan por la selección del catálogo de cursos: publican sus cursos en el paquete
(`paquete_servido`). Con la fuente `activa`, la exportación quita de la lista de su ámbito los cursos que la regla
retira en las lecturas de su último ciclo (`aplicacion_de_la_retirada.retiradas_por_la_regla`), y los archivos de la
regla entran entre los orígenes de su entrada del manifiesto, para que lo exportado se pueda reproducir. Con la fuente
en `sombra` el archivo sale tal cual, sin un byte distinto. Cada fuente solo toca su archivo.
"""

from pathlib import Path

from plataforma_datos.cursos.activacion_de_la_retirada import ACTIVA
from plataforma_datos.cursos.altas_en_sombra import ALTAS
from plataforma_datos.cursos.aplicacion_de_la_retirada import retiradas_por_la_regla
from plataforma_datos.cursos.decisiones_retirada import ruta_del_registro
from plataforma_datos.cursos.estado_de_la_retirada import carpeta_del_estado, ultimo_registro
from plataforma_datos.cursos.paquete_servido import EXPORTADOS
from plataforma_datos.orquestacion.exportacion.comun import Paquete

# La fuente de cada archivo del paquete que publica cursos, con la lista donde están sus unidades.
EN_EL_PAQUETE: dict[str, tuple[str, str]] = {
    EXPORTADOS[alta.ambito].archivo: (alta.fuente, EXPORTADOS[alta.ambito].lista)
    for alta in ALTAS
    if alta.en_el_paquete
}


def archivos_de_la_regla(raiz: Path, fuente: str) -> list[Path]:
    """Los archivos de los que sale lo que retira la regla activa de una fuente.

    Returns:
        Su registro de estado vigente y los registros de decisiones de sus lecturas; ninguno si está en sombra.
    """
    registro = ultimo_registro(raiz, fuente)
    if registro is None or registro["estado"] != ACTIVA:
        return []
    return [
        carpeta_del_estado(raiz, fuente) / f"{registro['numero']:08d}.json",
        *(ruta_del_registro(raiz, fuente, lectura_id) for lectura_id in registro["lecturas"]),
    ]


def sin_las_retiradas(raiz: Path, nombre: str, paquete: Paquete) -> Paquete:
    """Quita de un archivo del paquete lo que retira la regla activa de su fuente.

    Un archivo que no publica cursos, o cuya fuente está en sombra, sale tal cual.

    Returns:
        El paquete sin las unidades retiradas y con los archivos de la regla entre sus orígenes.
    """
    if nombre not in EN_EL_PAQUETE:
        return paquete
    fuente, lista = EN_EL_PAQUETE[nombre]
    archivos = archivos_de_la_regla(raiz, fuente)
    if not archivos:
        return paquete
    retiradas = retiradas_por_la_regla(raiz, fuente)
    unidades = [unidad for unidad in paquete.datos[lista] if str(unidad["id"]) not in retiradas]
    return Paquete({**paquete.datos, lista: unidades}, [*paquete.origenes, *archivos])
