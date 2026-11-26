"""Conserva el contexto de una admisión legada antes de instalar otro catálogo."""

import json
from pathlib import Path

from plataforma_datos.comun.nucleo import FormatoInesperado, exigir
from plataforma_datos.cursos import identidades_de_admision, operacion_fuente
from plataforma_datos.cursos.almacen_catalogo import ruta_relativa
from plataforma_datos.cursos.exigencias_entrega_catalogo import ErrorEntregaCatalogo
from plataforma_datos.orquestacion.archivos_de_generacion import GeneracionInvalida, _json


def exigir_informe_fuera_del_paquete(raiz: Path, informe: Path) -> None:
    """Impide cambiar bytes que el manifiesto del paquete ya cita como origen.

    Raises:
        FormatoInesperado: Si el manifiesto no es verificable o cita el informe.
    """
    error = "Manifiesto de paquete no verificable al sellar el censo"
    try:
        informe = ruta_relativa(raiz, informe.relative_to(raiz).as_posix())
        manifiesto = ruta_relativa(raiz, "datos/manifiesto.json")
        if not manifiesto.exists():
            return
        documento = _json(manifiesto)
    except (
        ErrorEntregaCatalogo,
        GeneracionInvalida,
        json.JSONDecodeError,
        UnicodeDecodeError,
        RecursionError,
    ) as causa:
        raise FormatoInesperado(error) from causa
    exigir(isinstance(documento, dict), error, FormatoInesperado)
    for entrada in documento.values():
        exigir(isinstance(entrada, dict), error, FormatoInesperado)
        origenes = entrada.get("origenes", {})
        exigir(isinstance(origenes, dict), error, FormatoInesperado)
        for relativa in origenes:
            try:
                origen = ruta_relativa(raiz, relativa)
            except ErrorEntregaCatalogo as causa:
                raise FormatoInesperado("Ruta de origen no canónica al sellar el censo") from causa
            exigir(
                not origen.exists() or not origen.samefile(informe),
                "El paquete cita el informe de admisión del censo",
                FormatoInesperado,
            )


def sellar_legados(raiz: Path) -> None:
    """Fija las identidades de partida de cada censo sin registrar una nueva comprobación."""
    for fuente in sorted(identidades_de_admision.FUENTES):
        operacion_fuente.sellar_identidades_historicas(fuente, raiz)
