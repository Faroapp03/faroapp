"""FUNDAE: el estado de cada recurso conocido de Digitalízate en un ciclo, de una sola decisión.

De ella salen la observación de catálogo (lectura completa y presencia) y el aviso del día. La regla:
- presente solo por la ficha de un proveedor de la lista activa, con `baja: false`, tipo «Curso» y destino válido;
  si el buscador del catálogo 1 no lo lista, sigue presente y avisa;
- retirado por lo que dice la ficha de un proveedor activo: `baja: true` o un tipo declarado distinto de «Curso»;
- retirado si falta de las fichas activas (su proveedor está en la lista activa, en la de baja o ya no existe en el
  catálogo) y el buscador respondido en el ciclo tampoco lo lista; si lo lista, sin noticia y aviso;
- sin noticia si su proveedor contradice a las listas, si el recurso trae una forma inesperada o si el censo no es
  completo (entonces solo cuenta lo visto como presente).
"""

from typing import Any

from plataforma_datos.cursos.fuentes.fundae import censo_digitalizate, digitalizate


def estado(
    lectura: dict[str, Any], id_recurso: int, proveedor: int | None, en_indice: bool | None
) -> tuple[bool, bool | None, str | None]:
    """El estado de un recurso conocido.

    Args:
        lectura: La lectura del censo.
        id_recurso: El recurso conocido.
        proveedor: Su proveedor conocido, o None si no consta.
        en_indice: Si lo lista el buscador del catálogo 1 de ese ciclo; None si no respondió.

    Returns:
        (lectura_completa, presente, aviso): presente True, False (retirado con evidencia) o None (sin noticia), y el
        motivo del aviso, si lo hay.
    """
    visto = lectura["recursos"].get(id_recurso)
    if not lectura["completo"]:
        activo = (
            visto is not None and visto["recurso"]["baja"] is False and censo_digitalizate.es_curso(visto["recurso"])
        )
        return False, True if activo else None, None
    if id_recurso in lectura["sin_noticia"]:
        return False, None, censo_digitalizate.FORMA
    if visto is not None:
        return _visto(visto["recurso"], en_indice)
    return _ausente(lectura, proveedor, en_indice)


def _visto(recurso: dict[str, Any], en_indice: bool | None) -> tuple[bool, bool | None, str | None]:
    """El de un recurso que trae la ficha de un proveedor activo en un censo completo.

    Returns:
        Retirado por su baja o su tipo; sin noticia sin destino válido; si no, presente (con aviso si el buscador no
        lo lista).
    """
    if recurso["baja"] is True or not censo_digitalizate.es_curso(recurso):
        return True, False, None
    if digitalizate._destino(recurso.get("urlCurso"))[0] is None:
        return False, None, None
    return True, True, censo_digitalizate.CONTRADICE if en_indice is False else None


def _ausente(
    lectura: dict[str, Any], proveedor: int | None, en_indice: bool | None
) -> tuple[bool, bool | None, str | None]:
    """El de un recurso que no trae ninguna ficha activa de un censo completo.

    Returns:
        Retirado si el buscador tampoco lo lista; si lo lista, o su proveedor contradice a las listas, sin noticia y
        aviso; con el buscador caído, sin noticia.
    """
    if proveedor in lectura["contradicen_listas"]:
        return False, None, censo_digitalizate.CONTRADICE
    if en_indice is False:
        return True, False, None
    return False, None, censo_digitalizate.CONTRADICE if en_indice else None
