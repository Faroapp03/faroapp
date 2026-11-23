"""Contrato de la oferta SOC dentro de formacion.json: qué puede cambiar sin tocar el catálogo fijado.

La comparación del paquete (piezas_de_la_actualizacion) concede a formacion.json una excepción delimitada: pueden
cambiar sus cursos, la fecha de su copia y sus dos contadores de cobertura si ambos documentos cumplen el contrato
conocido y conservan íntegros los catálogos, las correspondencias, las citas y su orden.
"""

import json
import re
from datetime import date
from pathlib import Path

from plataforma_datos.comun.entrada_salida import Json
from plataforma_datos.cursos.fuentes.formacion.constantes import DESTINATARIOS_POR_TIPO, FICHA_CURSO

# Contrato revisado de la oferta: un campo nuevo del exportador no recibe esta excepción automáticamente.
CAMPOS_CURSO_SOC = "id,nombre,especialidades,modalidad,municipio,inicio,fin,horas,estado,centro,enlace,destinatarios"
CAMPOS_RELACION_EURES = ("codigo", "relacion", "etiqueta")


def _objeto_con_campos(valor: Json, campos: str) -> bool:
    """Reconoce una forma cerrada antes de conceder la excepción SOC.

    Returns:
        Si es un objeto con exactamente los campos indicados.
    """
    return isinstance(valor, dict) and set(valor) == set(campos.split(","))


def fecha_soc(valor: Json) -> bool:
    """Reconoce una fecha ISO real.

    Returns:
        Si el valor es una fecha completa de calendario.
    """
    if not isinstance(valor, str) or re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", valor) is None:
        return False
    try:
        date.fromisoformat(valor)
    except ValueError:
        return False
    return True


def _curso_soc_conocido(curso: Json) -> bool:
    """Reconoce los campos exportados de un curso, sin ignorar ampliaciones del contrato.

    Returns:
        Si conserva la forma conocida, identidad, fechas y destinatarios admitidos.
    """
    if not _objeto_con_campos(curso, CAMPOS_CURSO_SOC) or not isinstance(curso, dict):
        return False
    textos = set(CAMPOS_CURSO_SOC.split(",")) - {"especialidades", "inicio", "fin", "destinatarios"}
    return (
        all(isinstance(curso[campo], str) for campo in textos)
        and bool(curso["id"])
        and isinstance(curso["enlace"], str)
        and curso["enlace"].startswith(FICHA_CURSO)
        and (curso["horas"] == "" or re.fullmatch(r"[1-9][0-9]*", curso["horas"]) is not None)
        and isinstance(curso["especialidades"], list)
        and all(isinstance(codigo, str) for codigo in curso["especialidades"])
        and all(curso[campo] is None or fecha_soc(curso[campo]) for campo in ("inicio", "fin"))
        and (not curso["inicio"] or not curso["fin"] or curso["inicio"] <= curso["fin"])
        and curso["destinatarios"] in (None, *DESTINATARIOS_POR_TIPO.values())
    )


def _catalogo_formacion_conocido(datos: dict[str, Json]) -> bool:
    """Comprueba la forma de los insumos fijados del catálogo.

    Returns:
        Si las especialidades y correspondencias tienen sus campos y tipos conocidos.
    """
    campos = "nombre,nivel,horas,familia,modalidad,ocupaciones,ficha"
    for especialidad in datos["especialidades"].values():
        if not (
            _objeto_con_campos(especialidad, campos)
            and all(isinstance(valor, str) for clave, valor in especialidad.items() if clave != "ocupaciones")
            and isinstance(especialidad["ocupaciones"], list)
            and all(isinstance(codigo, str) for codigo in especialidad["ocupaciones"])
        ):
            return False
    for relaciones in datos["ocupaciones"].values():
        if not isinstance(relaciones, list):
            return False
        for relacion in relaciones:
            if not (
                isinstance(relacion, list)
                and len(relacion) == len(CAMPOS_RELACION_EURES)
                and all(isinstance(v, str) for v in relacion)
                and relacion[1] in ("exacta", "cercana", "amplia", "estrecha")
            ):
                return False
    return True


def _formacion_con_oferta_conocida(datos: Json) -> bool:
    """Comprueba el contrato cerrado y los contadores que sí puede renovar la oferta.

    Returns:
        Si el documento admite una comparación semántica de oferta SOC.
    """
    if not _objeto_con_campos(datos, "fuentes,fecha_cursos,cobertura,ocupaciones,especialidades,cursos"):
        return False
    if not isinstance(datos, dict):
        return False
    cobertura, cursos = datos["cobertura"], datos["cursos"]
    campos = "ocupaciones_con_especialidad_sepe,ocupaciones_esco,cursos_con_relacion_oficial,cursos"
    return (
        _objeto_con_campos(datos["fuentes"], "sepe,soc,eures")
        and isinstance(datos["fuentes"], dict)
        and all(isinstance(cita, str) for cita in datos["fuentes"].values())
        and isinstance(datos["ocupaciones"], dict)
        and isinstance(datos["especialidades"], dict)
        and _catalogo_formacion_conocido(datos)
        and fecha_soc(datos["fecha_cursos"])
        and _objeto_con_campos(cobertura, campos)
        and isinstance(cobertura, dict)
        and all(type(valor) is int and valor >= 0 for valor in cobertura.values())
        and isinstance(cursos, list)
        and bool(cursos)
        and all(_curso_soc_conocido(curso) for curso in cursos)
        and len({curso["id"] for curso in cursos}) == len(cursos)
        and cobertura["cursos"] == len(cursos)
        and cobertura["cursos_con_relacion_oficial"]
        == sum(
            any(datos["especialidades"].get(codigo, {}).get("ocupaciones") for codigo in curso["especialidades"])
            for curso in cursos
        )
    )


def sin_claves_repetidas(pares: list[tuple[str, Json]]) -> dict[str, Json]:
    """Lee objetos JSON sin perder claves duplicadas.

    Returns:
        El objeto completo, con el orden de sus claves.

    Raises:
        ValueError: Si una clave se repite.
    """
    resultado: dict[str, Json] = {}
    for clave, valor in pares:
        if clave in resultado:
            raise ValueError("Clave JSON repetida")
        resultado[clave] = valor
    return resultado


def _proyeccion_fijada_formacion(ruta: Path) -> tuple[str, int] | None:
    """Retira únicamente la oferta variable de un documento conocido.

    Returns:
        El complemento serializado con su orden y el número de cursos, o None si no es verificable.
    """
    try:
        datos = json.loads(ruta.read_text(encoding="utf-8"), object_pairs_hook=sin_claves_repetidas)
    except (OSError, ValueError, RecursionError):
        return None
    if not _formacion_con_oferta_conocida(datos):
        return None
    cursos = len(datos["cursos"])
    del datos["cursos"], datos["fecha_cursos"]
    del datos["cobertura"]["cursos"], datos["cobertura"]["cursos_con_relacion_oficial"]
    # No ordenar claves: el catálogo y los desempates estables conservan su orden, además del contenido íntegro.
    return json.dumps(datos, ensure_ascii=False, allow_nan=False, separators=(",", ":")), cursos


def comparar_oferta_soc(paquetes: tuple[Path, Path] | None) -> tuple[bool, tuple[int, int] | None]:
    """Compara el contenido fijado real, además de los manifiestos y sus recuentos.

    Returns:
        Si solo cambia oferta y sus dos recuentos explícitos; sin documentos verificables, ninguna excepción.
    """
    if paquetes is None:
        return False, None
    antes, despues = (_proyeccion_fijada_formacion(carpeta / "formacion.json") for carpeta in paquetes)
    if antes is None or despues is None:
        return False, None
    return antes[0] == despues[0], (antes[1], despues[1])
