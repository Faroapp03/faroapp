"""Acceso de solo lectura a los datos de la medida del error de retirada: lee el almacén y llama a la función pura.

Abre las lecturas de cada fuente (`lecturas/`) y los registros de decisiones que existen para ellas (`decisiones/`) bajo
`var/actualizacion/validados/` de una instalación, y no escribe nada. Una lectura sin registro de decisiones es una
lectura en la que la regla de retirada no decidió nada, y no aporta retiradas. Es lo que llama el parte diario.
"""

from pathlib import Path

from plataforma_datos.comun.nucleo import DATOS_RELATIVOS
from plataforma_datos.cursos.decisiones_retirada import cargar_registro, ruta_del_registro
from plataforma_datos.cursos.error_de_retirada import medir_error
from plataforma_datos.cursos.lecturas.almacen_lecturas import CARPETA, listar_lecturas
from plataforma_datos.cursos.tipos_json import ObjetoJson


def fuentes_con_lecturas(raiz: Path) -> list[str]:
    """Las fuentes que tienen una carpeta de lecturas en la instalación, por orden alfabético.

    Returns:
        Los nombres de fuente; vacía si la instalación aún no tiene ninguna.
    """
    validados = raiz / DATOS_RELATIVOS / "validados"
    if not validados.is_dir():
        return []
    return sorted(carpeta.name for carpeta in validados.iterdir() if (carpeta / CARPETA).is_dir())


def medir_error_guardado(raiz: Path) -> list[ObjetoJson]:
    """Mide el error de retirada con todo lo guardado en una instalación.

    Returns:
        Una fila por fuente, tal como la devuelve `medir_error`.

    Raises:
        ErrorLectura: Si una lectura guardada no es válida.
        ErrorDecisiones: Si un registro de decisiones guardado no es válido.
        ErrorDeMedida: Si lo guardado se contradice.
    """
    lecturas, registros = [], []
    for fuente in fuentes_con_lecturas(raiz):
        guardadas = listar_lecturas(raiz, fuente)
        lecturas.extend(guardadas)
        registros.extend(
            cargar_registro(raiz, fuente, lectura["lectura_id"])
            for lectura in guardadas
            if ruta_del_registro(raiz, fuente, lectura["lectura_id"]).exists()
        )
    return medir_error(registros, lecturas)
